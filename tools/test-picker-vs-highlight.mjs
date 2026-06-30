#!/usr/bin/env node
/**
 * Reproduce the user's bug:
 *   - "Highlight is dark red"
 *   - "Selecting front picks the opposite side"
 *   - "Display Cage working in reverse"
 *   - "Push/Pull moves triangles, not all 4 sub-quads"
 *
 * This test exercises the picker + highlight path the same way
 * CycleModelerController._faceIndicesFromHit / _faceGeometryFromHit
 * do. It uses real raycasting against the live subdivided mesh and
 * reports which face indices the picker resolves for each ray hit.
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
const tmpPath = path.resolve('tools/.tmp-picker-EditableMesh.mjs');
await fs.writeFile(tmpPath, emPatched, 'utf8');
const { EditableMesh } = await import(url.pathToFileURL(tmpPath).href);

let failed = 0;
function assert(name, cond, info) {
  if (cond) console.log(`  PASS  ${name}`);
  else { console.log(`  FAIL  ${name}  ${info ?? ''}`); failed += 1; }
}

// ── Build a floor-anchored box (Y=0 floor) — matches the modeler. ──
const cage = EditableMesh.boxFromBounds(
  new THREE.Vector3(-50, 0, -50),
  new THREE.Vector3(50, 100, 50),
);
// Verify cage faceGroups order matches what the picker assumes.
console.log('Cage faceGroups:', cage.faceGroups);
console.log('Cage face normals (first vert):');
cage.faces.forEach((f, i) => {
  const v0 = cage.vertices[f[0]];
  const v1 = cage.vertices[f[1]];
  const v2 = cage.vertices[f[2]];
  const e1 = new THREE.Vector3().subVectors(v1, v0);
  const e2 = new THREE.Vector3().subVectors(v2, v0);
  const n = new THREE.Vector3().crossVectors(e1, e2).normalize();
  console.log(`  face ${i} (grp=${cage.faceGroups[i]}): normal=(${n.x.toFixed(2)},${n.y.toFixed(2)},${n.z.toFixed(2)})`);
});

// ── Build the refined mesh via Loop subdivision (the user is on CC or
//    Loop — both should round-trip to the same cage face). ──────────
const refined = cage.subdivideLoop(1);
console.log(`\nRefined mesh: ${refined.faces.length} triangles`);
console.log('Face groups (unique count):', new Set(refined.faceGroups).size);

// ── Bake a BufferGeometry with faceIdMap = _sourceFace (cage mode) ──
const cageMap = refined._sourceFace;
const geo = refined.toBufferGeometry({ faceIdMap: cageMap });
const faceIdAttr = geo.getAttribute('faceId');
const posAttr = geo.getAttribute('position');
console.log(`Geometry: ${faceIdAttr.count} faceId entries (${faceIdAttr.count / 3} triangles)`);

// ── Build a Three.Mesh and raycast from each of the 6 directions ────
const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
mesh.position.set(0, 0, 0);
mesh.updateMatrixWorld(true);

const raycaster = new THREE.Raycaster();
const FACE_NAMES = ['back (-Z)', 'front (+Z)', 'bottom (-Y)', 'top (+Y)', 'right (+X)', 'left (-X)'];

console.log('\n=== Raycast from each direction toward box centre ===');
for (let i = 0; i < FACE_NAMES.length; i += 1) {
  const normal = new THREE.Vector3();
  if (i === 0) normal.set(0, 0, -1);
  else if (i === 1) normal.set(0, 0, 1);
  else if (i === 2) normal.set(0, -1, 0);
  else if (i === 3) normal.set(0, 1, 0);
  else if (i === 4) normal.set(1, 0, 0);
  else normal.set(-1, 0, 0);
  // Cast from outside toward the centre of the box.
// Floor is at Y=0, top at Y=100, so the box centroid is at Y=50.
// Aim each ray at a point on the centre of each face so the ray
// hits the target face and not an adjacent one.
const FACE_CENTRES = [
  new THREE.Vector3(0, 50, -50),  // back (-Z)
  new THREE.Vector3(0, 50,  50),  // front (+Z)
  new THREE.Vector3(0,  0,   0),  // bottom (-Y)
  new THREE.Vector3(0, 100,  0),  // top (+Y)
  new THREE.Vector3(50, 50,  0),  // right (+X)
  new THREE.Vector3(-50, 50, 0),  // left (-X)
];
const target = FACE_CENTRES[i];
const origin = normal.clone().multiplyScalar(200);
origin.add(target);
  raycaster.set(origin, normal.clone().negate());
  const hits = raycaster.intersectObject(mesh, false);
  if (!hits.length) {
    console.log(`  ${FACE_NAMES[i]}: NO HIT`);
    continue;
  }
  const hit = hits[0];
  const triIndex = hit.faceIndex;
  const faceId = faceIdAttr.getX(triIndex * 3) | 0;
  // Picker logic — mirror CycleModelerController._faceIndicesFromHit:
  const meshJson = cage; // cage mode
  const e = EditableMesh.fromJSON(meshJson.toJSON());
  const sel = e.selectionGroup(faceId);
  console.log(`  ${FACE_NAMES[i]}: triIndex=${triIndex}, faceId=${faceId}, selectedFaces=[${sel.join(',')}]  -> cage faceGroups=${sel.map(s => cage.faceGroups[s]).join(',')}`);
  // What cage face is this? Map group ID -> name.
  const grpName = (g) => FACE_NAMES[g] || '?';
  const expectedGrp = i;
  const actualGrp = cage.faceGroups[sel[0]];
  assert(
    `Ray from ${FACE_NAMES[i]} picks faceGroup ${expectedGrp} (${grpName(expectedGrp)})`,
    actualGrp === expectedGrp,
    `got faceGroup=${actualGrp} (${grpName(actualGrp)})`,
  );
}

console.log(`\n=== Highlight geometry check ===`);
// When the picker returns faces [a, b] from the cage, the highlight
// mesh is built from cage.vertices — so it sits on the ORIGINAL cube
// outline, not the smoothed surface. The user wants the highlight to
// cover all 4 sub-quads on the smoothed mesh.
const selected = [0, 1]; // back cage triangles
const hlPositions = [];
for (const fi of selected) {
  const f = cage.faces[fi];
  for (let i = 1; i < f.length - 1; i += 1) {
    const a = cage.vertices[f[0]];
    const b = cage.vertices[f[i]];
    const c = cage.vertices[f[i + 1]];
    hlPositions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  }
}
const hlGeo = new THREE.BufferGeometry();
hlGeo.setAttribute('position', new THREE.Float32BufferAttribute(hlPositions, 3));
const bb = new THREE.Box3().setFromBufferAttribute(hlGeo.getAttribute('position'));
console.log('Highlight box (cage-vertex-based):', bb.min.toArray().map(v=>v.toFixed(1)), '->', bb.max.toArray().map(v=>v.toFixed(1)));
console.log('Mesh bbox:', new THREE.Box3().setFromBufferAttribute(posAttr).min.toArray().map(v=>v.toFixed(1)), '->', new THREE.Box3().setFromBufferAttribute(posAttr).max.toArray().map(v=>v.toFixed(1)));
const meshMax = new THREE.Box3().setFromBufferAttribute(posAttr).max;
console.log(`NOTE: cage-based highlight extends to Y=100 (top of cage) but subdivided mesh top is at Y=${meshMax.y.toFixed(2)}`);

console.log(`\nResult: ${failed} failure(s)`);
process.exit(failed ? 1 : 0);