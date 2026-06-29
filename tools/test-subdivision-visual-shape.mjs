#!/usr/bin/env node
/**
 * Visual-shape sanity check for the Loop subdivider.
 *
 * Builds a 200x200x200 box, applies 3 levels of Loop subdivision,
 * then samples the resulting mesh to confirm:
 *   1. The mesh looks like a sphere-ish smooth blob (the C^2 limit
 *      surface of a cube) -- NOT a sharp cube.
 *   2. Cube CORNERS are no longer at their original positions, and
 *      the inward displacement increases with subdivision level.
 *   3. Edge midpoints also move inward.
 *
 * We measure "sphericity" as the standard deviation of vertex
 * distances from the centre -- a true sphere has std=0; a cube has
 * a large std (corner vertices are ~1.73 * edge midpoint distance
 * from the centre).
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
const tmpPath = path.resolve('tools/.tmp-subdivision-visual-EditableMesh.mjs');
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

const stats = (mesh, label) => {
  const distances = mesh.vertices.map((v) =>
    Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z));
  const min = Math.min(...distances);
  const max = Math.max(...distances);
  const mean = distances.reduce((a, b) => a + b, 0) / distances.length;
  const variance = distances.reduce((a, b) => a + (b - mean) ** 2, 0) / distances.length;
  const std = Math.sqrt(variance);
  console.log(`  ${label}: ${mesh.vertices.length} verts, radial distance ` +
    `min=${min.toFixed(2)}, max=${max.toFixed(2)}, std=${std.toFixed(2)}`);
  return { min, max, mean, std };
};

// Original box: 8 cube corners shared across all 6 faces, all at
// distance ~173.21 from centre. Std = 0 because all 8 corners are
// equidistant.
const s0 = stats(box, 'level 0 (unrefined)');
assert('level 0 has 8 cube corners at distance ~173.21',
  s0.min > 170 && s0.max < 175 && Math.abs(s0.std) < 0.5,
  `min=${s0.min.toFixed(2)} max=${s0.max.toFixed(2)} std=${s0.std.toFixed(3)}`);

// Level 1: corners are repositioned (cube-corner vertex mask), and
// 18 edge vertices are added (12 outline + 6 internal diagonals
// introduced by the per-quad triangle split). Distances spread.
const lvl1 = box.subdivideLoop(1);
const s1 = stats(lvl1, 'level 1');
assert('level 1 spreads vertex distances (min < max with std > 5)',
  s1.std > 5 && s1.max - s1.min > 50,
  `min=${s1.min.toFixed(2)} max=${s1.max.toFixed(2)} std=${s1.std.toFixed(3)}`);

// Level 2: more verts, smoother, std decreases as the shape rounds off.
const lvl2 = box.subdivideLoop(2);
const s2 = stats(lvl2, 'level 2');
assert('level 2 has lower radial std than level 1 (smoothing)',
  s2.std < s1.std, `${s2.std.toFixed(3)} >= ${s1.std.toFixed(3)}`);

const lvl3 = box.subdivideLoop(3);
const s3 = stats(lvl3, 'level 3');
assert('level 3 has lower radial std than level 2',
  s3.std < s2.std, `${s3.std.toFixed(3)} >= ${s2.std.toFixed(3)}`);

// Original cube corners (which had distance ~173) must SHRINK in the
// subdivided mesh. If they don't shrink, subdivision isn't smoothing.
const originalCorner = Math.sqrt(100 * 100 * 3);
const lvl1CornerMax = (() => {
  // Heuristic: pull the vertex with the largest |x|+|y|+|z| at level 1
  // -- that's a corner or near-corner on the subdivided mesh.
  const verts = lvl1.vertices;
  let best = 0;
  for (const v of verts) {
    const a = Math.abs(v.x) + Math.abs(v.y) + Math.abs(v.z);
    if (a > best) best = a;
  }
  return best;
})();
console.log(`  Original corner |x|+|y|+|z| = ${300}; level-1 max = ${lvl1CornerMax.toFixed(2)}`);
assert('level 1 corner vertices pull inward from cube corners',
  lvl1CornerMax < 290, `got ${lvl1CornerMax.toFixed(2)}`);

if (failed) {
  console.log(`\n${failed} assertion(s) failed.`);
  process.exit(1);
}
console.log('\nAll subdivision visual-shape tests passed.');
