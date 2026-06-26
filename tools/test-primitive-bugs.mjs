#!/usr/bin/env node
/**
 * Smoke test for EditableMesh primitive generation.
 *
 * Validates:
 *  - capsule height > 2*radius ⇒ cylinder body has non-zero height
 *  - capsule height <= 2*radius ⇒ collapses to sphere
 *  - stair treads are planar quads (not diagonal strips)
 *  - spiral stair has no central core (per user request)
 *  - sphere / cylinder / torus produce clean quad topology
 */

import * as THREE from '../editor/libs/three/build/three.module.min.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as url from 'node:url';

// Load EditableMesh source and rewrite its `from 'three'` import to the
// local three.module.min.js so we can run it in plain Node. Write the
// patched source to a sibling temp .mjs file (data: URLs cannot resolve
// relative paths in newer Node).
const emPath = path.resolve(
  path.dirname(url.fileURLToPath(import.meta.url)),
  '..', 'editor', 'src', 'CycoModeler', 'EditableMesh.js',
);
const emSrc = await fs.readFile(emPath, 'utf8');
const emSrcPatched = emSrc.replace(
  /from\s+['"]three['"]/,
  "from '../editor/libs/three/build/three.module.min.js'",
);
const emTmp = path.resolve(
  path.dirname(url.fileURLToPath(import.meta.url)),
  '.tmp-EditableMesh.mjs',
);
await fs.writeFile(emTmp, emSrcPatched, 'utf8');
const { EditableMesh } = await import(url.pathToFileURL(emTmp).href);

let failed = 0;
const ok = (msg) => console.log(`  OK   ${msg}`);
const bad = (msg) => { failed += 1; console.log(`  FAIL ${msg}`); };
const section = (msg) => console.log(`\n=== ${msg} ===`);

// ---------------------------------------------------------------------------
section('capsule geometry');

// Standard "pill" proportions: width=100, height=300, depth=100
const cap = EditableMesh.capsule(100, 300, 100);
{
  const ys = cap.vertices.map(v => v.y);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  if (maxY - minY > 290) ok(`capsule spans expected ~300 units (got ${maxY - minY})`);
  else bad(`capsule vertical span too small: ${maxY - minY} (expected ~300)`);

  // halfMid = (300 - 100) / 2 = 100 (since radius = 50).
  const hasTopRing = ys.some(y => Math.abs(y - 100) < 0.1);
  const hasBottomRing = ys.some(y => Math.abs(y + 100) < 0.1);
  if (hasTopRing && hasBottomRing) ok('capsule has cylinder body rings at ±halfMid');
  else bad(`capsule missing body rings (top=${hasTopRing}, bottom=${hasBottomRing})`);
}

// Default-size capsule (width=height=depth=100) ⇒ cylinder body has zero
// height in the buggy version and the shape degenerates to a sphere.
// The fix caps the radius so there is always a visible cylinder body.
const defaultCap = EditableMesh.capsule(100, 100, 100);
{
  const ys = defaultCap.vertices.map(v => v.y);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  // Buggy version: only 2 pole vertices (top + bottom of the fake sphere).
  // Fixed version: full ring stacks for the body + caps.
  const ringCount = ys.filter(y => Math.abs(y) < 0.5).length;
  // The fix guarantees mid = height - 2*radius > 0, so there must be
  // cylinder body rings NOT at the poles. The simplest check is "more
  // than 2 unique Y values" — the buggy sphere-only version collapses
  // all vertices to ring Y-positions on a single great circle.
  const uniqueYs = new Set(ys.map(y => y.toFixed(2)));
  if (uniqueYs.size > 2) ok(`default capsule has multi-ring topology (${uniqueYs.size} distinct Y values)`);
  else bad(`default capsule collapsed to a 2-ring sphere (${uniqueYs.size} distinct Y values)`);
  // Range should still equal height.
  if (Math.abs(maxY - minY - 100) < 0.1) ok(`default capsule height = ${maxY - minY}`);
  else bad(`default capsule height wrong: ${maxY - minY} (expected 100)`);
  // The body height should be positive — there should be cylinder rings
  // at y = ±halfMid (= ±(height - 2*radius)/2). With height=100 and
  // radius clamped to ≤40, halfMid is at least 10.
  const halfMid = (100 - 2 * 40) / 2;
  const bodyRingCount = ys.filter(y => Math.abs(y - halfMid) < 0.5 || Math.abs(y + halfMid) < 0.5).length;
  if (bodyRingCount >= 24) ok(`default capsule has body rings at ±halfMid (${bodyRingCount} verts)`);
  else bad(`default capsule has no body rings (${bodyRingCount} verts at ±${halfMid})`);
}

// ---------------------------------------------------------------------------
section('stair geometry');

const stair = EditableMesh.stair(100, 200, 300);
console.log(`stair: ${stair.vertices.length} vertices, ${stair.faces.length} faces`);
for (let fi = 0; fi < stair.faces.length; fi += 1) {
  const f = stair.faces[fi];
  for (const idx of f) {
    if (idx === -1 || !stair.vertices[idx]) {
      console.log(`  bad face ${fi}: ${JSON.stringify(f)} → undefined at idx ${idx}`);
    }
  }
}
{
  const normals = stair.faces.map(face => {
    const a = stair.vertices[face[0]];
    const b = stair.vertices[face[1]];
    const c = stair.vertices[face[2]];
    const ab = new THREE.Vector3().subVectors(b, a);
    const ac = new THREE.Vector3().subVectors(c, a);
    return new THREE.Vector3().crossVectors(ab, ac).normalize();
  });
  const axisAligned = normals.every(n => {
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    return Math.max(ax, ay, az) > 0.99;
  });
  if (axisAligned) ok('all stair face normals are axis-aligned (no diagonals)');
  else bad('stair has non-axis-aligned faces (diagonals present)');

  // Total face count check.
  const expectedFaces = 8 + 8 + 1 + 1 + 16; // 8 treads + 8 risers + 1 bottom + 1 back + 16 sides
  if (stair.faces.length === expectedFaces) ok(`stair has ${expectedFaces} faces (8 treads + 8 risers + bottom + back + 16 sides)`);
  else bad(`stair has ${stair.faces.length} faces (expected ${expectedFaces})`);

  // Spot-check: pick the first tread (should be at y = treadRise, span the
  // full width, span exactly treadRun in z) and verify.
  const treadFaces = stair.faces.filter(f => {
    const ys = f.map(idx => stair.vertices[idx].y);
    return ys.every(y => y === ys[0]) && ys[0] > 0;
  });
  if (treadFaces.length === 8) ok(`stair has 8 treads (constant y > 0)`);
  else bad(`stair has ${treadFaces.length} treads (expected 8)`);

  // Bottom: one face at y=0 spanning the full footprint.
  const bottomFaces = stair.faces.filter(f => {
    const ys = f.map(idx => stair.vertices[idx].y);
    return ys.every(y => y === 0);
  });
  if (bottomFaces.length === 1) ok(`stair has 1 bottom face (at y=0)`);
  else bad(`stair has ${bottomFaces.length} bottom faces (expected 1)`);

  // Back: one face at z = depth (300), spanning width and height.
  const backFaces = stair.faces.filter(f => {
    const zs = f.map(idx => stair.vertices[idx].z);
    return zs.every(z => z === 300);
  });
  if (backFaces.length === 1) ok(`stair has 1 back face (at z=depth)`);
  else bad(`stair has ${backFaces.length} back faces (expected 1)`);

  // Risers: 8 vertical quads at z < depth with yMin < yMax.
  const risers = stair.faces.filter(f => {
    const zs = f.map(idx => stair.vertices[idx].z);
    const ys = f.map(idx => stair.vertices[idx].y);
    return zs.every(z => z === zs[0]) && zs[0] < 300 && Math.min(...ys) < Math.max(...ys);
  });
  if (risers.length === 8) ok(`stair has 8 risers (vertical quads at z<depth)`);
  else bad(`stair has ${risers.length} risers (expected 8)`);

  // Sides: 16 vertical quads at x = ±width/2.
  const sides = stair.faces.filter(f => {
    const xs = f.map(idx => stair.vertices[idx].x);
    return xs.every(x => x === xs[0]);
  });
  if (sides.length === 16) ok(`stair has 16 side faces (±X)`);
  else bad(`stair has ${sides.length} side faces (expected 16)`);
}

// ---------------------------------------------------------------------------
section('spiral stair geometry');

const spiral = EditableMesh.spiralStair(200, 300, 200);
{
  const coreCount = spiral.vertices.filter(v => {
    const r = Math.hypot(v.x, v.z);
    return r > 0 && r < 25;
  }).length;
  if (coreCount === 0) ok('spiral stair has no central core');
  else bad(`spiral stair still has central core (${coreCount} vertices inside r=25)`);

  const outerCount = spiral.vertices.filter(v => Math.hypot(v.x, v.z) > 80).length;
  if (outerCount > 0) ok(`spiral stair has outer step vertices (${outerCount})`);
  else bad('spiral stair missing outer step vertices');
}

// ---------------------------------------------------------------------------
section('wireframe topology');

const sph = EditableMesh.sphere(100, 100, 100);
const sphGeom = sph.toBufferGeometry();
{
  const faceId = sphGeom.attributes.faceId;
  // Sphere source has triangle caps + quad strips. With DEFAULT_SEGMENTS=24
  // and rings=12, expected: 24 (top cap) + 24*11 (quads × 2 tris) + 24 (bottom cap) = 576 tris.
  const triCount = sphGeom.attributes.position.count / 3;
  // Sphere: top cap (24) + (rings-2) ring strips × 24 quads × 2 tris + bottom cap (24)
  const expectedTris = 24 + (12 - 2) * 24 * 2 + 24;
  if (triCount === expectedTris) ok(`sphere has expected triangle count (${triCount})`);
  else bad(`sphere tris=${triCount}, expected ${expectedTris}`);

  const fid0 = faceId.getX(0);
  const fid1 = faceId.getX(1);
  const fid2 = faceId.getX(2);
  if (fid0 === fid1 && fid1 === fid2) ok('first triangle has uniform faceId');
  else bad(`first triangle faceIds not uniform: ${fid0},${fid1},${fid2}`);

  // The polygon-based edges geometry should produce a clean outline with
  // no triangulation diagonals.
  const sphereEdges = sph.toEdgesGeometry(1);
  const segCount = sphereEdges.attributes.position.count / 2;
  if (segCount > 0 && segCount < 1500) ok(`sphere edges: ${segCount} segments`);
  else bad(`sphere edges out of range: ${segCount}`);

  // Stair edges must be axis-aligned (no diagonal segments).
  const stairEdges = EditableMesh.stair(100, 200, 300).toEdgesGeometry(1);
  const stairSegCount = stairEdges.attributes.position.count / 2;
  let diagonalSegs = 0;
  for (let i = 0; i < stairSegCount; i += 1) {
    const ax = stairEdges.attributes.position.getX(i * 2);
    const ay = stairEdges.attributes.position.getY(i * 2);
    const az = stairEdges.attributes.position.getZ(i * 2);
    const bx = stairEdges.attributes.position.getX(i * 2 + 1);
    const by = stairEdges.attributes.position.getY(i * 2 + 1);
    const bz = stairEdges.attributes.position.getZ(i * 2 + 1);
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const axisAligned = (dx === 0) || (dy === 0) || (dz === 0);
    if (!axisAligned) diagonalSegs += 1;
  }
  if (diagonalSegs === 0) ok(`stair wireframe has no diagonal segments (${stairSegCount} segments)`);
  else bad(`stair wireframe has ${diagonalSegs} diagonal segments`);
}

console.log(`\n${failed === 0 ? 'ALL PASS' : failed + ' FAILED'}`);
process.exit(failed === 0 ? 0 : 1);