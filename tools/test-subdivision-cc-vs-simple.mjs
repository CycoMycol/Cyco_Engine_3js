#!/usr/bin/env node
/**
 * Validates the visible-difference contract between the Catmull-Clark
 * and Simple subdivision algorithms in the Subdivision Surface
 * modifier dropdown.
 *
 *   - Catmull-Clark (Loop on triangles): cube corners pull inward by
 *     a measurable amount after level 1; the radial-distance std
 *     shrinks as level increases.
 *   - Simple (midpoint, no smoothing): cube corners stay at their
 *     original coordinates; the radial-distance std STAYS HIGH
 *     because the cube is just diced into more tris.
 *
 * Both algorithms produce the same triangle count for the same level
 * (face count is purely topological), so the topology-only assertions
 * (faceGroup inheritance, _sourceFace mapping) continue to hold for
 * Simple as they did for Loop.
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
const tmpPath = path.resolve('tools/.tmp-cc-vs-simple-EditableMesh.mjs');
await fs.writeFile(tmpPath, emPatched, 'utf8');
const { EditableMesh } = await import(url.pathToFileURL(tmpPath).href);

let failed = 0;
function assert(name, cond, info) {
  if (cond) console.log(`  PASS  ${name}`);
  else { console.log(`  FAIL  ${name}  ${info ?? ''}`); failed += 1; }
}

const box = EditableMesh.boxFromBounds(
  new THREE.Vector3(-100, -100, -100),
  new THREE.Vector3(100, 100, 100),
);

// ── Catmull-Clark (quad subdivision) ─────────────────────────────
// Real CC on quad topology -- the box's faces are stored as two
// fan-triangulated triangles that share a faceGroup ID, which CC
// recognizes as a single quad and subdivides accordingly.
const cc1 = box.subdivideCatmullClark(1);
// Find the cube corner in the refined mesh. Box corners are at
// (±100, ±100, ±100) in source space. After Loop, the original 8
// vertices are repositioned (Loop's vertex mask) -- they should
// NOT coincide with source cube corners anymore.
const ccCornerFound = cc1.vertices.some((v) =>
  Math.abs(v.x - 100) < 0.5 && Math.abs(v.y - 100) < 0.5 && Math.abs(v.z - 100) < 0.5);
assert('Catmull-Clark: cube corner does NOT stay at (100, 100, 100)',
  !ccCornerFound,
  'the smoothed cube must displace original vertices');

// ── Simple: cube corner MUST stay put ──────────────────────────────
const sm1 = box.subdivideSimple(1);
const smCornerFound = sm1.vertices.some((v) =>
  Math.abs(v.x - 100) < 0.5 && Math.abs(v.y - 100) < 0.5 && Math.abs(v.z - 100) < 0.5);
assert('Simple: cube corner DOES stay at (100, 100, 100)',
  smCornerFound,
  'Simple must preserve original vertex positions exactly');

// ── Topology: CC on quads produces 5 child quads per parent quad,
// Simple on triangles produces 4 child triangles per parent tri.
// Both still preserve the 6-polygon faceGroup structure.
// CC: 6 quads × (1 center + 4 corners) = 30 child QUADS stored as
//     true quads in the EditableMesh (the user requirement).
//     toBufferGeometry fan-triangulates to 60 triangles for the GPU.
// Simple: 12 tris × 4 = 48 tris (already triangles, no change).
assert('Catmull-Clark on quads: 30 child quads (QUADS in data model)',
  cc1.faces.length === 30, `got ${cc1.faces.length}`);
assert('Catmull-Clark on quads: every child face is a 4-vertex quad',
  cc1.faces.every((f) => f.length === 4));
assert('Catmull-Clark on quads: BufferGeometry has 60 triangles (fan)',
  (() => {
    const bg = cc1.toBufferGeometry();
    return bg.getAttribute('position').count / 3 === 60;
  })());
assert('Simple on triangles: 48 triangles at level 1',
  sm1.faces.length === 48, `got ${sm1.faces.length}`);

// ── Same faceGroup inheritance ──────────────────────────────────
assert('Catmull-Clark still has 6 faceGroups',
  new Set(cc1.faceGroups).size === 6);
assert('Simple still has 6 faceGroups',
  new Set(sm1.faceGroups).size === 6);

// ── _sourceFace mapping preserved for both algorithms ─────────────
// CC: 30 quads / 6 cage quad-faces = 5 quads per cage quad.
//     The _sourceFace array is 30 entries (one per child quad), each
//     pointing at its parent cage quad index (qi ∈ [0..5]).
// Simple: 48 tris / 12 cage tris = 4 tris per cage tri.
assert('Catmull-Clark _sourceFace maps every child quad to its cage quad',
  cc1._sourceFace.length === 30 &&
  cc1._sourceFace.every((idx) => idx >= 0 && idx < 6) &&
  // The 5 child quads of each source quad (1 center + 4 corners) all
  // share the same _sourceFace value.
  cc1._sourceFace.every((idx, i) => idx === Math.floor(i / 5)));
assert('Simple _sourceFace maps every face back to its cage face',
  sm1._sourceFace.every((idx, i) => idx === Math.floor(i / 4)));

// ── Radial-distance std divergence ────────────────────────────────
// CC rounds the box, so std drops; Simple dices the box, so std
// stays high (the cube vertices are still 173.21 from the centre,
// and the new midpoints are at varying distances).
const _std = (mesh) => {
  const d = mesh.vertices.map((v) => Math.sqrt(v.x*v.x + v.y*v.y + v.z*v.z));
  const m = d.reduce((a, b) => a + b, 0) / d.length;
  return Math.sqrt(d.reduce((a, b) => a + (b - m) ** 2, 0) / d.length);
};
const ccStd = _std(cc1);
const smStd = _std(sm1);
console.log(`  CC std=${ccStd.toFixed(2)}, Simple std=${smStd.toFixed(2)}`);
assert('Catmull-Clark has lower radial std than Simple (rounding)',
  ccStd < smStd, `cc=${ccStd.toFixed(2)}, simple=${smStd.toFixed(2)}`);

// ── Higher-level Simple iteration: still no vertex movement ───────
const sm2 = box.subdivideSimple(2);
const sm2Corner = sm2.vertices.some((v) =>
  Math.abs(v.x - 100) < 0.5 && Math.abs(v.y - 100) < 0.5 && Math.abs(v.z - 100) < 0.5);
assert('Simple at level 2: cube corner still preserved',
  sm2Corner);

// ── Algorithm tag for inspection ─────────────────────────────────
assert('CC result tagged with _subdivisionAlgorithm = "catmullClark"',
  cc1._subdivisionAlgorithm === 'catmullClark');
assert('Simple result tagged with _subdivisionAlgorithm = "simple"',
  sm1._subdivisionAlgorithm === 'simple');

if (failed) {
  console.log(`\n${failed} assertion(s) failed.`);
  process.exit(1);
}
console.log('\nAll Catmull-Clark vs Simple tests passed.');
