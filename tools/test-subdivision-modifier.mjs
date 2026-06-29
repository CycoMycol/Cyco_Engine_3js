#!/usr/bin/env node
/**
 * Tests `EditableMesh.subdivideLoop(levels)` against the
 * behavioural spec of a Blender-style Subdivision Surface modifier:
 *
 *   1. Level-0 == identity (returns an EditableMesh with the same
 *      face count, faceGroups preserved, and `_sourceFace` mapping
 *      every face back to itself).
 *   2. Level-1 on a 100x100x100 box produces exactly 4× as many
 *      triangles (12 -> 48) and 4× as many quads (6 -> 24) once
 *      you group by faceGroup.
 *   3. Cube CORNERS move on level 1 (a cube corner's triangle-
 *      soup valence is 6; Loop's vertex mask scales the corner
 *      toward the centroid of its 6 neighbours, which is the
 *      midpoint of the opposite cube corner + 4 edge midpoints
 *      at constant distance from the corner. The result is NOT
 *      the same coordinate as the input.)
 *   4. The subdivided mesh's faces all share the parent
 *      faceGroup of their cage face (so push/pull selection rolls
 *      up correctly).
 *   5. Higher levels further refine the topology without losing
 *      the faceGroup inheritance.
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
const tmpPath = path.resolve('tools/.tmp-subdivision-EditableMesh.mjs');
await fs.writeFile(tmpPath, emPatched, 'utf8');
const { EditableMesh } = await import(url.pathToFileURL(tmpPath).href);

let failed = 0;
function assert(name, cond, info) {
  if (cond) console.log(`  PASS  ${name}`);
  else { console.log(`  FAIL  ${name}  ${info ?? ''}`); failed += 1; }
}
function approx(a, b, tol = 1e-3) { return Math.abs(a - b) <= tol; }

// Build a unit box at the origin (mimics boxFromBounds with min=-h, max=+h).
const box = EditableMesh.boxFromBounds(
  new THREE.Vector3(-0.5, -0.5, -0.5),
  new THREE.Vector3(0.5, 0.5, 0.5),
);

// ── 1. Level 0 = identity ────────────────────────────────────────────
{
  const id = box.subdivideLoop(0);
  assert('level 0 preserves triangle count (12)',
    id.faces.length === 12, `got ${id.faces.length}`);
  assert('level 0 preserves faceGroups',
    JSON.stringify(id.faceGroups) === JSON.stringify(box.faceGroups));
  assert('level 0 _sourceFace maps every face to itself',
    id._sourceFace.every((idx, i) => idx === i));
  // Vertex positions unchanged.
  const same = box.vertices.every((v, i) =>
    approx(v.x, id.vertices[i].x) && approx(v.y, id.vertices[i].y) && approx(v.z, id.vertices[i].z));
  assert('level 0 vertex positions unchanged', same);
}

// ── 2. Level 1 = 4× face count, 6 faceGroups still 6 logical polygons ─
{
  const lvl1 = box.subdivideLoop(1);
  assert('level 1: 48 triangles (12 * 4)',
    lvl1.faces.length === 48, `got ${lvl1.faces.length}`);
  // The 6 cube faceGroups should each have 8 triangles now (2 tri/quad × 4 quads).
  const counts = new Map();
  for (const g of lvl1.faceGroups) counts.set(g, (counts.get(g) || 0) + 1);
  const distinctCount = counts.size;
  const valuesPerGroup = Array.from(counts.values());
  assert('level 1: faceGroups == 6 logical polygons',
    distinctCount === 6, `got ${distinctCount}`);
  assert('level 1: each faceGroup has 8 triangles',
    valuesPerGroup.every((c) => c === 8),
    `counts=${JSON.stringify(valuesPerGroup)}`);
}

// ── 3. Cube corners move (Loop's vertex mask is non-trivial for n=6)
{
  const lvl1 = box.subdivideLoop(1);
  // Find the original cube corner vertices in `lvl1` (positions
  // shifted by the mask). The original (-0.5,-0.5,-0.5) corner
  // should be at a NEW position somewhere INSIDE the box (Loop
  // pulls it toward the centroid of the 6 neighbour face centres
  // surrounding it).
  const before = box.vertices.find((v) =>
    approx(v.x, -0.5) && approx(v.y, -0.5) && approx(v.z, -0.5));
  assert('found (-0.5,-0.5,-0.5) corner in source box', !!before);
  // In a unit cube centred at origin, Loop pulls a corner 1/16
  // toward the average of its 6 neighbours (= 0 since the cube
  // is symmetric around the origin). So the corner should move
  // roughly 1/16 along each axis toward 0.
  // After: x = -0.5 * (1 - 6*3/16) + 3/16 * (sum of 6 neighbours)
  // For a centred unit cube: neighbour sum of x-coords of the 6
  // adjacent face-centres around corner (-0.5,-0.5,-0.5) is...
  //   (+x side neighbours are at +0.5/2 cap-style midpoint? No,
  //   in our tri soup each cube corner connects to 6 triangles
  //   via the 6 fan-triangulated quads around it.)
  //
  // Easier test: just confirm the corner is NOT at exactly
  // (-0.5,-0.5,-0.5) in the refined mesh.
  const stillThere = lvl1.vertices.some((v) =>
    approx(v.x, -0.5) && approx(v.y, -0.5) && approx(v.z, -0.5));
  assert('cube corner is NOT preserved at (-0.5,-0.5,-0.5) after level 1',
    !stillThere, 'corner must be displaced by Loop vertex mask');
}

// ── 4. faceGroup inheritance ─────────────────────────────────────────
{
  const lvl1 = box.subdivideLoop(1);
  // Every faceGroup in lvl1 must be one of the 6 original
  // faceGroups (no orphans).
  const orig = new Set(box.faceGroups);
  const orphans = lvl1.faceGroups.filter((g) => !orig.has(g));
  assert('level 1: no orphan faceGroups',
    orphans.length === 0, `orphans=${JSON.stringify(orphans)}`);
}

// ── 5. Higher levels ────────────────────────────────────────────────
{
  const lvl2 = box.subdivideLoop(2);
  assert('level 2: 192 triangles (12 * 4 * 4)',
    lvl2.faces.length === 192, `got ${lvl2.faces.length}`);
  const lvl3 = box.subdivideLoop(3);
  assert('level 3: 768 triangles',
    lvl3.faces.length === 768, `got ${lvl3.faces.length}`);
  // faceGroup count must hold across levels.
  const lvl3Groups = new Set(lvl3.faceGroups);
  assert('level 3 still has exactly 6 faceGroups',
    lvl3Groups.size === 6, `got ${lvl3Groups.size}`);
}

// ── 6. Result mesh is wired with the modifier metadata ─────────────
{
  const lvl1 = box.subdivideLoop(1);
  assert('level 1: _subdivisionLevels === 1',
    lvl1._subdivisionLevels === 1);
  assert('level 1: _subdivisionSource === original mesh',
    lvl1._subdivisionSource === box);
  assert('level 1: _sourceFace.length === faces.length',
    lvl1._sourceFace.length === lvl1.faces.length);
}

// ── 7. BufferGeometry output round-trip ────────────────────────────
{
  const lvl2 = box.subdivideLoop(2);
  const bg = lvl2.toBufferGeometry();
  const posAttr = bg.getAttribute('position');
  assert('level 2 BufferGeometry has position vertices',
    posAttr.count === 192 * 3, `got ${posAttr.count}`);
  const fidAttr = bg.getAttribute('faceId');
  assert('level 2 BufferGeometry has faceId per triangle',
    fidAttr.count === 192 * 3, `got ${fidAttr.count}`);
}

// ── 8. Catmull-Clark on quad topology ───────────────────────────────
// A box stores each face as 2 triangles sharing a faceGroup ID.
// CC subdivides the QUADS, so each source quad becomes 4 child quads
// (5 new quads total per parent: 1 center + 4 corners).
// Total: 6 parent quads → 6 × 5 = 30 child QUADS stored as true
// quads in the EditableMesh. `toBufferGeometry` fan-triangulates at
// render time, so the GPU buffer has 60 triangles, but the
// EditableMesh data model is QUADS-ONLY (the user requirement:
// "it's quads only, you do not under no circumstance supposed to
// have triangles" in the Subdivision Surface modifier's output).
// The polygon's picker resolves each generated triangle back to its
// parent cage face via the `faceIdMap` arg.
{
  const lvl1 = box.subdivideCatmullClark(1);
  // Data-model assertions (EditabledMesh.faces, quads-only).
  assert('CC level 1: 30 child quads (6 quads × 5 child quads)',
    lvl1.faces.length === 30, `got ${lvl1.faces.length}`);
  assert('CC level 1: every face is a true quad (4 vertices)',
    lvl1.faces.every((f) => f.length === 4),
    `non-quad face found: ${lvl1.faces.find((f) => f.length !== 4)}`);
  // Render-time buffer: each quad fan-triangulates to 2 tris.
  const lvl1Bg = lvl1.toBufferGeometry();
  const lvl1Tris = lvl1Bg.getAttribute('position').count / 3;
  assert('CC level 1: BufferGeometry has 60 triangles (30 quads × 2)',
    lvl1Tris === 60, `got ${lvl1Tris}`);
  // 6 faceGroups preserved.
  const groupCount = new Set(lvl1.faceGroups).size;
  assert('CC level 1: still 6 faceGroups (quad pairs)',
    groupCount === 6, `got ${groupCount}`);
  // Each faceGroup has 5 quads (1 center + 4 corners).
  const counts = new Map();
  for (const g of lvl1.faceGroups) counts.set(g, (counts.get(g) || 0) + 1);
  const perGroup = Array.from(counts.values());
  assert('CC level 1: each faceGroup has 5 child quads',
    perGroup.every((c) => c === 5), `counts=${JSON.stringify(perGroup)}`);
  // Cube corners should be displaced (CC pulls them inward).
  const stillThere = lvl1.vertices.some((v) =>
    approx(v.x, -0.5) && approx(v.y, -0.5) && approx(v.z, -0.5));
  assert('CC level 1: cube corner is NOT at (-0.5,-0.5,-0.5) anymore',
    !stillThere, 'corner must be displaced by CC vertex mask');
  // Just sanity-check the mesh has more vertices than the source.
  assert('CC level 1: vertex count grew',
    lvl1.vertices.length > box.vertices.length,
    `got ${lvl1.vertices.length} vs ${box.vertices.length}`);
  // Level 2: 6 quads → 30 quads → 150 quads (data model), 300 tris
  // in the GPU buffer.
  const lvl2 = box.subdivideCatmullClark(2);
  assert('CC level 2: 150 child quads',
    lvl2.faces.length === 150, `got ${lvl2.faces.length}`);
  assert('CC level 2: every face is a true quad',
    lvl2.faces.every((f) => f.length === 4));
  const lvl2Bg = lvl2.toBufferGeometry();
  const lvl2Tris = lvl2Bg.getAttribute('position').count / 3;
  assert('CC level 2: BufferGeometry has 300 triangles',
    lvl2Tris === 300, `got ${lvl2Tris}`);
}

if (failed) {
  console.log(`\n${failed} assertion(s) failed.`);
  process.exit(1);
}
console.log('\nAll subdivision tests passed.');
