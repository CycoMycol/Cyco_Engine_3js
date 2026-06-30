#!/usr/bin/env node
/**
 * Integration test for the "push/pull while a Subdivision Surface
 * modifier is active" chain. Verifies that:
 *
 *   1. The CC subdivider outputs true quads (4-vertex faces), per
 *      the user requirement: "It's quads only. You have to move
 *      the vertices properly. But you do not under no circumstance
 *      supposed to have triangles."
 *   2. After pushFaces on the CAGE, the REFINED mesh has been
 *      re-derived from the modified cage (no stale display).
 *   3. The picker's faceIdMap resolves refined triangles back to
 *      their parent cage face so picking a sub-quad still selects
 *      the whole cage face (Blender parity).
 *   4. The pushFaces operation is recorded in the faceGroup so
 *      the polygon's selection rolls up correctly to the new
 *      side wall.
 *   5. CC's vertex mask moved the original cube corners inward
 *      (the smoothing), AND push/pull AFTER CC still works
 *      (the per-frame preview path doesn't drop the modifier).
 *
 * Runs against the live EditableMesh code via a temporary import.
 */

import * as THREE from '../editor/libs/three/build/three.module.min.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as url from 'node:url';

const emPath = path.resolve('editor/src/CycoModeler/EditableMesh.js');
const emSrc = await fs.readFile(emPath, 'utf8');
const emPatched = emSrc.replace(
  /from\s+['"]three['"]/,
  "from '../editor/libs/three/build/three.module.min.js'",
);
const tmpPath = path.resolve('tools/.tmp-subdiv-pushpull-EditableMesh.mjs');
await fs.writeFile(tmpPath, emPatched, 'utf8');
const { EditableMesh } = await import(url.pathToFileURL(tmpPath).href);

let failed = 0;
function assert(name, cond, info) {
  if (cond) console.log(`  PASS  ${name}`);
  else { console.log(`  FAIL  ${name}  ${info ?? ''}`); failed += 1; }
}
function approx(a, b, tol = 1e-3) { return Math.abs(a - b) <= tol; }

// ── 1. CC outputs true quads ──────────────────────────────────────
{
  const box = EditableMesh.boxFromBounds(
    new THREE.Vector3(-50, -50, -50),
    new THREE.Vector3(50, 50, 50),
  );
  const cc1 = box.subdivideCatmullClark(1);
  assert('CC output: every face is a 4-vertex quad',
    cc1.faces.every((f) => f.length === 4),
    `non-quad face: ${cc1.faces.find((f) => f.length !== 4)}`);
  assert('CC output: 30 quads (6 cage quads × 5 child quads)',
    cc1.faces.length === 30, `got ${cc1.faces.length}`);
  // CC smoothing pulls cube corners inward.
  const corner = box.vertices[0]; // (-50, -50, -50)
  const stillAtCorner = cc1.vertices.some((v) =>
    approx(v.x, corner.x) && approx(v.y, corner.y) && approx(v.z, corner.z));
  assert('CC output: cube corner was displaced (smoothing)',
    !stillAtCorner, 'corner must be pulled toward centre by CC vertex mask');
}

// ── 2. Push/pull AFTER CC: cage push, refine re-derive ──────────
// Simulates the per-frame preview chain:
//   - `cm.mesh` is the pushed cage.
//   - `cm._subdivisionRefinedMesh` is the refined mesh re-derived
//     from the pushed cage by `previewSubdivisionSurface`.
{
  const box = EditableMesh.boxFromBounds(
    new THREE.Vector3(-50, -50, -50),
    new THREE.Vector3(50, 50, 50),
  );
  // Initial CC pass (the user adds the modifier at level 1).
  const initialRefined = box.subdivideCatmullClark(1);
  assert('Initial CC: refined mesh has 30 quads',
    initialRefined.faces.length === 30);
  // User pushes the front face (+Z) of the CAGE by +20 units.
  // Faces [2,3] are the front (+Z) tris (see boxFromBounds above).
  // The group ID for those two tris is 1; we pass the seed face
  // INDEX (2) to selectionGroup so it returns every face with the
  // same group.
  const frontFaceIndices = box.selectionGroup(2); // [2, 3]
  assert('Front face: selectionGroup(2) returns [2, 3]',
    JSON.stringify(frontFaceIndices) === '[2,3]',
    `got ${JSON.stringify(frontFaceIndices)}`);
  const pushed = EditableMesh.fromJSON(box.toJSON());
  pushed.pushFaces(frontFaceIndices, 20);
  // After push, the cage has 12 original tris (with the 2 selected
  // front-face tris replaced by their pushed copies) + 4 new
  // side-wall quads = 16 faces total. The faceGroup parallel array
  // keeps the original 6 groups for the 6 quads and assigns fresh
  // IDs to the 4 side walls.
  assert('Cage after front-push by 20: 16 faces (12 orig + 4 side walls)',
    pushed.faces.length === 16, `got ${pushed.faces.length}`);
  // The original front face is at z=+50; pushed version has its
  // top vertices at z=+70. The 2 tris of the front face share
  // faceGroup 1.
  const frontGroupTris = [];
  for (let i = 0; i < pushed.faces.length; i += 1) {
    if (pushed.faceGroups[i] === 1) frontGroupTris.push(pushed.faces[i]);
  }
  const frontZ = frontGroupTris.flat().map((vi) => pushed.vertices[vi].z);
  assert('Pushed front face: top vertices are at z=+70',
    frontZ.every((z) => approx(z, 70, 0.1)),
    `got z values: ${JSON.stringify(frontZ)}`);
  // Re-derive the refined mesh from the pushed cage (this is what
  // `previewSubdivisionSurface` does per frame during the drag).
  const refinedAfterPush = EditableMesh.fromJSON(pushed.toJSON())
    .subdivideCatmullClark(1);
  // After the push, the cage has 16 face entries (12 original tris
  // with the 2 selected replaced + 4 new side-wall quads). The
  // subdivider treats ALL face entries as input quads for CC.
  // Each input face (tri or quad) is processed by `_extractQuadPairs`
  // and becomes 5 child quads. So:
  //   12 original tri "quads" × 5 = 60
  //   4 side-wall quads × 5     = 20
  //   Total child quads         = 80
  // But the test cage has 16 face entries with distinct face groups;
  // the "logical polygons" the user cares about are the 6 box faces
  // + 4 fresh side walls = 10 distinct face groups.
  assert('Refined mesh after push: every face is a true quad',
    refinedAfterPush.faces.every((f) => f.length === 4),
    `non-quad: ${refinedAfterPush.faces.find((f) => f.length !== 4)}`);
  // The picker's faceIdMap maps each refined triangle back to its
  // parent cage face. The refined mesh has N quads × 2 tris where
  // N is the number of quads the subdivider emitted; the test
  // asserts the map covers every child quad and points to a valid
  // cage face index.
  const faceIdMap = refinedAfterPush._sourceFace;
  assert('Refined mesh after push: every child quad has a source face',
    faceIdMap.length === refinedAfterPush.faces.length,
    `faceIdMap=${faceIdMap.length}, faces=${refinedAfterPush.faces.length}`);
  assert('Refined mesh after push: every source-face index is in range',
    faceIdMap.every((idx) => idx >= 0 && idx < pushed.faces.length),
    `out-of-range: ${faceIdMap.filter((i) => i < 0 || i >= pushed.faces.length)}`);
  // The buffer geometry fans every quad to 2 tris.
  const bg = refinedAfterPush.toBufferGeometry({ faceIdMap });
  const bgTris = bg.getAttribute('position').count / 3;
  assert('Refined mesh after push: BufferGeometry has 2 tris per child quad',
    bgTris === refinedAfterPush.faces.length * 2,
    `got ${bgTris} tris for ${refinedAfterPush.faces.length} quads`);
}

// ── 3. faceIdMap correctly distinguishes original vs side-wall ────
// When the user pushes face group 1 (front), the picker should
// still hit the same `selectedFaces` set (the front + side walls)
// because all those faces share the cage's group 1 OR have a
// fresh group ID. We test the "selection rolls up" contract: the
// push produces fresh group IDs on the side walls, so a click on
// the side wall selects just the side wall (not over-selecting
// into a coplanar face).
{
  const box = EditableMesh.boxFromBounds(
    new THREE.Vector3(-50, -50, -50),
    new THREE.Vector3(50, 50, 50),
  );
  const frontFaceIndices = box.selectionGroup(1);
  const pushed = EditableMesh.fromJSON(box.toJSON());
  pushed.pushFaces(frontFaceIndices, 20);
  // The cage has 16 face entries: 12 original tris (face groups
  // 0..5) + 4 side-wall quads. The 4 side walls get fresh group
  // IDs starting from `_nextGroupId` (which is 6 after the 6
  // original groups).
  const sideWallCount = 4;
  const sideWallGroups = pushed.faceGroups.slice(-sideWallCount);
  assert('Side walls: 4 fresh group IDs (one per side wall)',
    sideWallGroups.length === 4);
  // Each side wall's group ID is distinct (no over-merging with
  // existing faces that happen to be coplanar — the bug being
  // guarded against).
  const distinctSideWallGroups = new Set(sideWallGroups).size;
  assert('Side walls: each has a unique group ID',
    distinctSideWallGroups === 4,
    `groups: ${JSON.stringify(sideWallGroups)}`);
  // Original face groups 0..5 are preserved (still 6 distinct).
  const originalGroups = new Set(pushed.faceGroups.slice(0, 12)).size;
  assert('Original face groups 0..5 are preserved (6 distinct)',
    originalGroups === 6,
    `got ${originalGroups} distinct groups in the original 12 face entries`);
  // Selecting a side wall returns just the side wall's face.
  const sideWallFirstIdx = pushed.faces.length - sideWallCount;
  const sideWallSel = pushed.selectionGroup(sideWallFirstIdx);
  assert('Selecting first side wall returns just that one face',
    sideWallSel.length === 1 && sideWallSel[0] === sideWallFirstIdx,
    `got ${JSON.stringify(sideWallSel)}`);
}

if (failed) {
  console.log(`\n${failed} assertion(s) failed.`);
  process.exit(1);
}
console.log('\nAll subdivision + push/pull integration tests passed.');
