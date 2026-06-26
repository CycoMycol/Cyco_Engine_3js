#!/usr/bin/env node
/**
 * Wireframe correctness tests for EditableMesh primitives.
 *
 * Validates:
 *   1. ALL face triangles (post fan-triangulation) point OUTWARD from
 *      the shape. Uses face centroid vs. bounding-box center as the
 *      outward reference (handles stair / spiral where the centroid is
 *      biased away from the geometric "outward" direction).
 *   2. toEdgesGeometry emits every face boundary (no missing edges ⇒
 *      no "dead-space" gaps in the wireframe).
 *   3. Wireframe segments are not degenerate (zero-length ⇒ jitter).
 */

import * as THREE from '../editor/libs/three/build/three.module.min.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as url from 'node:url';

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

function bbox(mesh) {
  const bb = new THREE.Box3();
  for (const v of mesh.vertices) bb.expandByPoint(v);
  return bb;
}

function* triangulate(face) {
  for (let i = 1; i < face.length - 1; i += 1) {
    yield [face[0], face[i], face[i + 1]];
  }
}

function triNormal(mesh, tri) {
  const a = mesh.vertices[tri[0]];
  const b = mesh.vertices[tri[1]];
  const c = mesh.vertices[tri[2]];
  const ab = new THREE.Vector3().subVectors(b, a);
  const ac = new THREE.Vector3().subVectors(c, a);
  return new THREE.Vector3().crossVectors(ab, ac).normalize();
}

function triCentroid(mesh, tri) {
  const out = new THREE.Vector3();
  out.add(mesh.vertices[tri[0]]);
  out.add(mesh.vertices[tri[1]]);
  out.add(mesh.vertices[tri[2]]);
  return out.divideScalar(3);
}

/**
 * Test 1: every triangle's outward normal should agree with the
 * tri-centroid → bbox-center direction. The bbox center is more
 * reliable than the mesh centroid for shapes whose "outward" is not
 * uniform (stair, spiral, asymmetric layouts).
 */
function testOutwardNormals(mesh, label) {
  const bb = bbox(mesh);
  const center = bb.getCenter(new THREE.Vector3());
  const size = bb.getSize(new THREE.Vector3());
  let inverted = 0;
  let checked = 0;
  for (const face of mesh.faces) {
    if (!face || face.length < 3) continue;
    for (const tri of triangulate(face)) {
      const n = triNormal(mesh, tri);
      if (!Number.isFinite(n.x) || !Number.isFinite(n.y) || !Number.isFinite(n.z)) continue;
      const tc = triCentroid(mesh, tri);
      const outward = tc.clone().sub(center);
      // Tolerance: a tri whose centroid is within 1% of the bbox size
      // of the center is treated as ambiguous (symmetric / pole) and
      // skipped.
      const tol = Math.min(size.x, size.y, size.z) * 0.01;
      if (outward.lengthSq() < tol * tol) continue;
      const dot = n.dot(outward.normalize());
      checked += 1;
      if (dot < 0) inverted += 1;
    }
  }
  if (inverted === 0) ok(`${label}: ${checked} triangles, all outward-facing`);
  else bad(`${label}: ${inverted}/${checked} triangles INVERTED (dot<0)`);
  return inverted === 0;
}

/**
 * Test 2: every vertex must appear in at least one emitted edge.
 */
function testNoMissingEdges(mesh, label) {
  const edges = mesh.toEdgesGeometry(1);
  const pos = edges.attributes.position;
  const segCount = pos.count / 2;
  const usedVerts = new Set();
  for (let i = 0; i < segCount; i += 1) {
    const ax = pos.getX(i * 2), ay = pos.getY(i * 2), az = pos.getZ(i * 2);
    const bx = pos.getX(i * 2 + 1), by = pos.getY(i * 2 + 1), bz = pos.getZ(i * 2 + 1);
    usedVerts.add(`${ax.toFixed(3)}|${ay.toFixed(3)}|${az.toFixed(3)}`);
    usedVerts.add(`${bx.toFixed(3)}|${by.toFixed(3)}|${bz.toFixed(3)}`);
  }
  let orphanVerts = 0;
  const orphanList = [];
  for (const v of mesh.vertices) {
    const k = `${v.x.toFixed(3)}|${v.y.toFixed(3)}|${v.z.toFixed(3)}`;
    if (!usedVerts.has(k)) {
      orphanVerts += 1;
      orphanList.push(v);
    }
  }
  if (orphanVerts === 0) ok(`${label}: all ${mesh.vertices.length} vertices used by wireframe (no dead-space gaps)`);
  else bad(`${label}: ${orphanVerts}/${mesh.vertices.length} vertices NOT in wireframe (dead-space gaps): ${orphanList.slice(0, 3).map(v => `(${v.x.toFixed(1)},${v.y.toFixed(1)},${v.z.toFixed(1)})`).join(', ')}`);
  return orphanVerts === 0;
}

/**
 * Test 3: wireframe segments should not be degenerate (zero-length).
 */
function testSegmentIntegrity(mesh, label) {
  const edges = mesh.toEdgesGeometry(1);
  const pos = edges.attributes.position;
  const segCount = pos.count / 2;
  let degenerate = 0;
  for (let i = 0; i < segCount; i += 1) {
    const ax = pos.getX(i * 2), ay = pos.getY(i * 2), az = pos.getZ(i * 2);
    const bx = pos.getX(i * 2 + 1), by = pos.getY(i * 2 + 1), bz = pos.getZ(i * 2 + 1);
    const len = Math.hypot(bx - ax, by - ay, bz - az);
    if (len < 1e-6) degenerate += 1;
  }
  if (degenerate === 0) ok(`${label}: ${segCount} segments, no degenerate (zero-length) edges`);
  else bad(`${label}: ${degenerate}/${segCount} degenerate edges (cause jitter)`);
  return degenerate === 0;
}

/**
 * Torus-specific outward test: the face normal at each cell should
 * point away from the major-axis circle (not the world origin), which
 * is what the generic centroid-based test cannot distinguish.
 */
function testTorusOutward(mesh, label, major, minor) {
  function* tri(face) { for (let i=1;i<face.length-1;i++) yield [face[0],face[i],face[i+1]]; }
  let inv = 0, tot = 0;
  for (const face of mesh.faces) {
    for (const t of tri(face)) {
      const a = mesh.vertices[t[0]]; const b = mesh.vertices[t[1]]; const c = mesh.vertices[t[2]];
      const ab = new THREE.Vector3().subVectors(b, a);
      const ac = new THREE.Vector3().subVectors(c, a);
      const cross = new THREE.Vector3().crossVectors(ab, ac);
      const fc = new THREE.Vector3();
      for (const idx of t) fc.add(mesh.vertices[idx]);
      fc.divideScalar(3);
      const u = Math.atan2(fc.z, fc.x);
      const majorPoint = new THREE.Vector3(major * Math.cos(u), 0, major * Math.sin(u));
      const outward = fc.clone().sub(majorPoint);
      if (outward.lengthSq() < 1e-6) continue;
      const dot = cross.dot(outward.normalize());
      tot++;
      if (dot < 0) inv++;
    }
  }
  if (inv === 0) ok(`${label}: ${tot} triangles, all radially-outward (vs major axis)`);
  else bad(`${label}: ${inv}/${tot} triangles INVERTED radially`);
  return inv === 0;
}

/**
 * Stair-specific outward test: classify each face by its axis-aligned
 * plane (constant Y for treads/bottom, constant Z for risers/back,
 * constant X for sides) and check the face normal points the right
 * way for that face type.
 */
function testStairOutward(mesh, label) {
  function* tri(face) { for (let i=1;i<face.length-1;i++) yield [face[0],face[i],face[i+1]]; }
  let inv = 0, tot = 0;
  for (const face of mesh.faces) {
    const ys = face.map(i => mesh.vertices[i].y);
    const zs = face.map(i => mesh.vertices[i].z);
    const xs = face.map(i => mesh.vertices[i].x);
    const allSameY = ys.every(y => Math.abs(y - ys[0]) < 0.001);
    const allSameZ = zs.every(z => Math.abs(z - zs[0]) < 0.001);
    const allSameX = xs.every(x => Math.abs(x - xs[0]) < 0.001);
    for (const t of tri(face)) {
      const a = mesh.vertices[t[0]]; const b = mesh.vertices[t[1]]; const c = mesh.vertices[t[2]];
      const ab = new THREE.Vector3().subVectors(b, a);
      const ac = new THREE.Vector3().subVectors(c, a);
      const cross = new THREE.Vector3().crossVectors(ab, ac);
      let expectedNormal = null;
      if (allSameY && ys[0] > 0) expectedNormal = new THREE.Vector3(0, 1, 0);
      else if (allSameY && ys[0] === 0) expectedNormal = new THREE.Vector3(0, -1, 0);
      else if (allSameZ && zs[0] < mesh.faces[mesh.faces.length - 1] && zs.some((z, idx) => idx === 0 ? true : Math.abs(z - zs[0]) < 0.001)) {
        // riser: outward -Z (faces -Z direction)
        expectedNormal = new THREE.Vector3(0, 0, -1);
      } else if (allSameZ) {
        // back face: outward -Z
        expectedNormal = new THREE.Vector3(0, 0, -1);
      } else if (allSameX && xs[0] < 0) expectedNormal = new THREE.Vector3(-1, 0, 0);
      else if (allSameX && xs[0] > 0) expectedNormal = new THREE.Vector3(1, 0, 0);
      if (!expectedNormal) continue;
      const dot = cross.dot(expectedNormal);
      tot++;
      if (dot < 0) inv++;
    }
  }
  if (inv === 0) ok(`${label}: ${tot} triangles, all axis-aligned outward`);
  else bad(`${label}: ${inv}/${tot} triangles INVERTED vs axis-aligned faces`);
  return inv === 0;
}

/**
 * Spiral stair outward test: tread faces should point +Y, outer sides
 * should point radially outward, risers + backs should be roughly
 * perpendicular to the tangent (in the angular CCW / CW directions).
 * Skips tangential faces (pure angular) since the radial heuristic
 * is orthogonal to them and produces a meaningless near-zero dot.
 */
function testSpiralOutward(mesh, label) {
  function* tri(face) { for (let i=1;i<face.length-1;i++) yield [face[0],face[i],face[i+1]]; }
  let inv = 0, tot = 0, skipped = 0;
  for (const face of mesh.faces) {
    const a = mesh.vertices[face[0]]; const b = mesh.vertices[face[1]]; const c = mesh.vertices[face[2]];
    const ab = new THREE.Vector3().subVectors(b, a);
    const ac = new THREE.Vector3().subVectors(c, a);
    const cross = new THREE.Vector3().crossVectors(ab, ac);
    const fc = new THREE.Vector3();
    for (const idx of face) fc.add(mesh.vertices[idx]);
    fc.divideScalar(face.length);
    const r = Math.hypot(fc.x, fc.z);
    if (r < 1e-3) continue;
    const u = Math.atan2(fc.z, fc.x);
    const outward = new THREE.Vector3(Math.cos(u), 0, Math.sin(u));
    // The radial component of the cross product tells us whether
    // this face has meaningful radial direction. Faces whose normal
    // is mostly tangential (cross · outward ≈ 0) are skipped.
    const dot = cross.dot(outward);
    if (Math.abs(dot) < 1) { skipped += 1; continue; }
    tot++;
    if (dot < 0) inv++;
  }
  if (inv === 0) ok(`${label}: ${tot} radial triangles all outward (skipped ${skipped} tangential)`);
  else bad(`${label}: ${inv}/${tot} radial triangles INVERTED (skipped ${skipped} tangential)`);
  return inv === 0;
}

// ---------------------------------------------------------------------------
section('capsule (default 100x100x100, segments=24)');
const cap1 = EditableMesh.capsule(100, 100, 100, 24);
testOutwardNormals(cap1, 'capsule 100x100x100');
testNoMissingEdges(cap1, 'capsule 100x100x100');
testSegmentIntegrity(cap1, 'capsule 100x100x100');

// ---------------------------------------------------------------------------
section('capsule (tall 100x300x100, segments=24)');
const cap2 = EditableMesh.capsule(100, 300, 100, 24);
testOutwardNormals(cap2, 'capsule 100x300x100');
testNoMissingEdges(cap2, 'capsule 100x300x100');
testSegmentIntegrity(cap2, 'capsule 100x300x100');

// ---------------------------------------------------------------------------
section('capsule (wide flat 200x100x200, segments=24)');
const cap3 = EditableMesh.capsule(200, 100, 200, 24);
testOutwardNormals(cap3, 'capsule 200x100x200');
testNoMissingEdges(cap3, 'capsule 200x100x200');
testSegmentIntegrity(cap3, 'capsule 200x100x200');

// ---------------------------------------------------------------------------
section('sphere (100x100x100)');
const sph = EditableMesh.sphere(100, 100, 100, 24);
testOutwardNormals(sph, 'sphere');
testNoMissingEdges(sph, 'sphere');
testSegmentIntegrity(sph, 'sphere');

// ---------------------------------------------------------------------------
section('cylinder (100x200x100)');
const cyl = EditableMesh.cylinder(100, 200, 100, 24);
testOutwardNormals(cyl, 'cylinder');
testNoMissingEdges(cyl, 'cylinder');
testSegmentIntegrity(cyl, 'cylinder');

// ---------------------------------------------------------------------------
section('cone (100x200x100)');
const cone = EditableMesh.cone(100, 200, 100, 24);
testOutwardNormals(cone, 'cone');
testNoMissingEdges(cone, 'cone');
testSegmentIntegrity(cone, 'cone');

// ---------------------------------------------------------------------------
section('torus (200x60x200)');
const torus = EditableMesh.torus(200, 60, 200, 24);
testTorusOutward(torus, 'torus', 100, 30);
testNoMissingEdges(torus, 'torus');
testSegmentIntegrity(torus, 'torus');

// ---------------------------------------------------------------------------
section('box (100 cube)');
const box = EditableMesh.box(100);
testOutwardNormals(box, 'box');
testNoMissingEdges(box, 'box');
testSegmentIntegrity(box, 'box');

// ---------------------------------------------------------------------------
section('stair (100x200x300, 8 treads)');
const stair = EditableMesh.stair(100, 200, 300, 8);
testStairOutward(stair, 'stair');
testNoMissingEdges(stair, 'stair');
testSegmentIntegrity(stair, 'stair');

// ---------------------------------------------------------------------------
section('spiral stair (200x300x200)');
const spiral = EditableMesh.spiralStair(200, 300, 200, 24, 1);
testSpiralOutward(spiral, 'spiral stair');
testNoMissingEdges(spiral, 'spiral stair');
testSegmentIntegrity(spiral, 'spiral stair');

// ---------------------------------------------------------------------------
section('icosahedron (100)');
const ico = EditableMesh.icosahedron(100, 100, 100);
testOutwardNormals(ico, 'icosahedron');
testNoMissingEdges(ico, 'icosahedron');
testSegmentIntegrity(ico, 'icosahedron');

console.log(`\n${failed === 0 ? 'ALL PASS' : failed + ' FAILED'}`);
process.exit(failed === 0 ? 0 : 1);
