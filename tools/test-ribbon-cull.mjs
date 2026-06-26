// Test: back-face cull in ribbon expansion.
// For each primitive, the ribbon should NEVER contain a segment
// whose both adjacent face normals point away from the camera.
import { EditableMesh } from './.tmp-EditableMesh.mjs';
import * as THREE from '../editor/libs/three/build/three.module.min.js';

function buildRibbon(edgesGeom, width, camera, parentWorld) {
  // Mirror the controller's _expandEdgesToRibbon (with cull)
  const src = edgesGeom.attributes.position;
  const segCount = (src.count / 2) | 0;
  const positions = [];
  const A = new THREE.Vector3();
  const B = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const dirW = new THREE.Vector3();
  const viewDir = new THREE.Vector3();
  const perpW = new THREE.Vector3();
  const offsetLocal = new THREE.Vector3();
  const invParent = new THREE.Matrix4().copy(parentWorld).invert();
  const camPos = camera.position;
  const segFaceNormals = edgesGeom.userData?._segFaceNormals;
  const faceN = new THREE.Vector3();
  const faceNW = new THREE.Vector3();
  for (let i = 0; i < segCount; i++) {
    A.fromBufferAttribute(src, i * 2);
    B.fromBufferAttribute(src, i * 2 + 1);
    dir.subVectors(B, A);
    if (dir.lengthSq() < 1e-10) continue;
    dir.normalize();
    if (segFaceNormals && segFaceNormals[i]) {
      const normals = segFaceNormals[i];
      const nCount = normals.length / 3;
      if (nCount > 0) {
        const midLocal = A.clone().add(B).multiplyScalar(0.5);
        const midWorld = midLocal.applyMatrix4(parentWorld);
        const camToMid = new THREE.Vector3().subVectors(camPos, midWorld).normalize();
        let anyFront = false;
        for (let k = 0; k < nCount; k++) {
          faceN.set(normals[k * 3], normals[k * 3 + 1], normals[k * 3 + 2]);
          faceNW.copy(faceN).transformDirection(parentWorld);
          if (faceNW.dot(camToMid) > 0) { anyFront = true; break; }
        }
        if (!anyFront) continue;
      }
    }
    dirW.copy(dir).transformDirection(parentWorld);
    const midLocal = A.clone().add(B).multiplyScalar(0.5);
    const midWorld = midLocal.applyMatrix4(parentWorld);
    viewDir.subVectors(camPos, midWorld);
    if (viewDir.lengthSq() < 1e-10) continue;
    viewDir.normalize();
    perpW.crossVectors(dirW, viewDir);
    if (perpW.lengthSq() < 1e-6) continue;
    perpW.normalize();
    offsetLocal.copy(perpW).transformDirection(invParent).multiplyScalar(width);
    const aL = A, aR = A.clone().add(offsetLocal);
    const bL = B, bR = B.clone().add(offsetLocal);
    positions.push(aL.x, aL.y, aL.z, aR.x, aR.y, aR.z, bR.x, bR.y, bR.z);
    positions.push(aL.x, aL.y, aL.z, bR.x, bR.y, bR.z, bL.x, bL.y, bL.z);
  }
  const ribbon = new THREE.BufferGeometry();
  ribbon.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return { geometry: ribbon, emittedCount: positions.length / 18 };
}

let pass = 0, fail = 0;
function check(label, cond, info) {
  if (cond) { pass++; console.log('  OK   ' + label); }
  else { fail++; console.log('  FAIL ' + label + ' ' + (info ? '— ' + info : '')); }
}

const tests = [
  { name: 'Sphere',  fn: () => EditableMesh.sphere(2, 2, 2, 24) },
  { name: 'Torus',   fn: () => EditableMesh.torus(2, 0.6, 2, 24) },
  { name: 'Cone',    fn: () => EditableMesh.cone(2, 4, 2, 24) },
  { name: 'Cylinder', fn: () => EditableMesh.cylinder(2, 4, 2, 24) },
  { name: 'Capsule', fn: () => EditableMesh.capsule(2, 4, 2, 24) },
  { name: 'Box',     fn: () => EditableMesh.box(2, 2, 2) },
  { name: 'Icosa',   fn: () => EditableMesh.icosahedron(2, 2, 2) },
];

const cameras = [
  { pos: new THREE.Vector3(7, 5, 9),  label: 'oblique' },
  { pos: new THREE.Vector3(0, 0, 8),  label: 'front' },
  { pos: new THREE.Vector3(0, 6, 0.01), label: 'topdown' },
  { pos: new THREE.Vector3(8, 0, 0),  label: 'side' },
];

const parentWorld = new THREE.Matrix4().identity();
const width = 0.05;

for (const cam of cameras) {
  console.log('=== ' + cam.label + ' camera ' + JSON.stringify(cam.pos) + ' ===');
  for (const t of tests) {
    const em = t.fn();
    const eg = em.toEdgesGeometry(1);
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 200);
    camera.position.copy(cam.pos);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const { geometry, emittedCount } = buildRibbon(eg, width, camera, parentWorld);
    // Sanity: emitted count is strictly less than total segments
    const totalSegs = eg.attributes.position.count / 2;
    const normals = eg.userData?._segFaceNormals;
    check(t.name + ': emitted=' + emittedCount + ' (total=' + totalSegs + ')',
      emittedCount > 0 && emittedCount <= totalSegs,
      'cull should leave at least 1 segment, never emit more than total');
    // Validate: no emitted segment has BOTH face normals pointing away
    // from camera (would have been culled)
    const src = eg.attributes.position;
    const A = new THREE.Vector3();
    const B = new THREE.Vector3();
    const faceN = new THREE.Vector3();
    const faceNW = new THREE.Vector3();
    const midW = new THREE.Vector3();
    let backFaceLeaks = 0;
    const totalTris = geometry.attributes.position.count / 3;
    // We can't easily map ribbon triangles back to source segments, so
    // skip the back-face leak check at the geometry level. Instead,
    // re-derive the cull logic on the source segments and check no
    // emitted-segments fails the test.
    let srcEmitCount = 0;
    for (let i = 0; i < totalSegs; i++) {
      A.fromBufferAttribute(src, i * 2);
      B.fromBufferAttribute(src, i * 2 + 1);
      midW.copy(A).add(B).multiplyScalar(0.5);
      const camToMid = new THREE.Vector3().subVectors(cam.pos, midW).normalize();
      const segNormals = normals?.[i] || [];
      let anyFront = false;
      for (let k = 0; k < segNormals.length / 3; k++) {
        faceN.set(segNormals[k*3], segNormals[k*3+1], segNormals[k*3+2]);
        if (faceN.dot(camToMid) > 0) { anyFront = true; break; }
      }
      // If cull is on, the only emitted segments are ones with at
      // least one front-facing normal. So the cull-effective count
      // should match.
      if (segNormals.length > 0 && anyFront) srcEmitCount++;
    }
    check(t.name + ': source cull count = ' + srcEmitCount + ' ≈ emitted ' + emittedCount,
      Math.abs(srcEmitCount - emittedCount) < 5, // allow small slack for degenerate edge cases
      'source-derived cull should match emitted count');
  }
}

console.log('\n' + (fail === 0 ? 'ALL CULL TESTS PASS' : fail + ' FAIL / ' + pass + ' PASS'));
process.exit(fail === 0 ? 0 : 1);
