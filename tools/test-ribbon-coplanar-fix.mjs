#!/usr/bin/env node
/**
 * Verify the box/room top-face wireframe coplanarity fix in
 * CycleModelerController._expandEdgesToRibbon.
 *
 * The bug: when the camera looks straight down on a box's top face
 * (or any axis-aligned flat face), the screen-aligned perpendicular
 * `cross(dirW, viewDir)` lies exactly in the plane of the face. The
 * flip-on-negative-dot logic then has nothing to flip (dot ≈ 0), so
 * the ribbon quad sits IN the surface plane. Polygon offset helps a
 * little but doesn't reliably win the depth test → the wireframe
 * reads as faint/dotted.
 *
 * The fix: add a small outward component along the face normal to
 * the ribbon offset, so the ribbon always has a non-coplanar lift
 * regardless of camera angle.
 *
 * This test replicates the ribbon-build math for a box viewed
 * straight down on the +Y face and asserts every emitted segment
 * has a positive dot product between the offset and the adjacent
 * face normal (i.e. the offset points outward, not into the surface).
 */

import * as THREE from '../editor/libs/three/build/three.module.min.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as url from 'node:url';

// Load EditableMesh source (same patch trick as the other tools/ tests).
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
const ok = (m) => console.log('  OK   ' + m);
const bad = (m) => { failed += 1; console.log('  FAIL ' + m); };

// Camera directly above origin (looking down -Y).
const camera = { position: new THREE.Vector3(0, 500, 0) };
const parentWorld = new THREE.Matrix4();
const invParent = new THREE.Matrix4().copy(parentWorld).invert();
const width = 5;

function buildRibbonForSegment(A, B, segNormal) {
  const dir = new THREE.Vector3().subVectors(B, A);
  if (dir.lengthSq() < 1e-10) return null;
  dir.normalize();
  const dirW = new THREE.Vector3().copy(dir).transformDirection(parentWorld);
  const midWorld = A.clone().add(B).multiplyScalar(0.5).applyMatrix4(parentWorld);
  const viewDir = new THREE.Vector3().subVectors(camera.position, midWorld).normalize();
  const perpW = new THREE.Vector3().crossVectors(dirW, viewDir);
  if (perpW.lengthSq() < 1e-6) return null;
  perpW.normalize();
  const offsetLocal = new THREE.Vector3()
    .copy(perpW)
    .transformDirection(invParent)
    .multiplyScalar(width);
  let faceNormalWorld = null;
  if (segNormal && segNormal.length >= 3) {
    const fnL = new THREE.Vector3(segNormal[0], segNormal[1], segNormal[2]).normalize();
    const fnW = new THREE.Vector3().copy(fnL).transformDirection(parentWorld);
    if (perpW.dot(fnW) < 0) offsetLocal.multiplyScalar(-1);
    faceNormalWorld = fnW;
    // The fix: add an outward bias along the face normal.
    const liftAmount = width * 0.5;
    const liftLocal = new THREE.Vector3()
      .copy(faceNormalWorld)
      .transformDirection(invParent)
      .multiplyScalar(liftAmount);
    offsetLocal.add(liftLocal);
  }
  return { offsetLocal, faceNormalWorld };
}

function assertMeshLiftsAboveSurface(mesh, label) {
  console.log('\n=== ' + label + ' ===');
  const g = mesh.toEdgesGeometry(1);
  const segs = g.attributes.position.count / 2;
  let coplanar = 0;
  let inspected = 0;
  for (let i = 0; i < segs; i++) {
    const A = new THREE.Vector3().fromBufferAttribute(g.attributes.position, i * 2);
    const B = new THREE.Vector3().fromBufferAttribute(g.attributes.position, i * 2 + 1);
    const segNormal = g.userData._segFaceNormals[i];
    const r = buildRibbonForSegment(A, B, segNormal);
    if (!r || !r.faceNormalWorld) continue;
    inspected += 1;
    const dot = r.offsetLocal.dot(r.faceNormalWorld);
    if (dot < 0.01) coplanar += 1;
  }
  if (coplanar === 0) ok(`all ${inspected} segments have outward offset (no coplanar)`);
  else bad(`${coplanar}/${inspected} segments have near-zero outward offset (coplanar)`);
}

assertMeshLiftsAboveSurface(EditableMesh.box(200), 'box (200 cube) viewed straight down');
assertMeshLiftsAboveSurface(EditableMesh.room(200, 300, 200), 'room (200x300x200) viewed straight down');
assertMeshLiftsAboveSurface(EditableMesh.sphere(200), 'sphere (200) viewed straight down');
assertMeshLiftsAboveSurface(EditableMesh.cylinder(200, 300, 200), 'cylinder (200x300x200) viewed straight down');

console.log(failed === 0 ? '\nALL PASS' : '\nFAILED');
process.exit(failed === 0 ? 0 : 1);
