#!/usr/bin/env node
import * as THREE from '../editor/libs/three/build/three.module.min.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as url from 'node:url';

const emPath = path.resolve('editor/src/CycoModeler/EditableMesh.js');
const emSrc = await fs.readFile(emPath, 'utf8');
const emPatched = emSrc.replace(/from\s+['"]three['"]/, "from '../editor/libs/three/build/three.module.min.js'");
const tmpPath = path.resolve('tools/.tmp-stat-EditableMesh.mjs');
await fs.writeFile(tmpPath, emPatched, 'utf8');
const { EditableMesh } = await import(url.pathToFileURL(tmpPath).href);

const cage = EditableMesh.boxFromBounds(
  new THREE.Vector3(-50, 0, -50),
  new THREE.Vector3(50, 100, 50),
);
console.log(`Cage: faces=${cage.faces.length}, faceLen[0]=${cage.faces[0].length}`);
console.log(`Cage faceGroups: [${cage.faceGroups.join(',')}]`);
console.log(`Cage unique faceGroups: [${[...new Set(cage.faceGroups)].join(',')}]`);

const cc = cage.subdivideCatmullClark(5);
console.log(`\nCC L5: faces=${cc.faces.length}, faceLen[0]=${cc.faces[0].length}`);
console.log(`CC L5 unique faceGroups: [${[...new Set(cc.faceGroups)].join(',')}]`);

// Now check: are faces visible from outside? For each face, compute normal
// and check if it points outward (away from origin)
let outward = 0, inward = 0;
for (let i = 0; i < cc.faces.length; i++) {
  const face = cc.faces[i];
  const verts = face.map(idx => cc.vertices[idx]);
  const e1 = new THREE.Vector3().subVectors(verts[1], verts[0]);
  const e2 = new THREE.Vector3().subVectors(verts[2], verts[0]);
  const n = new THREE.Vector3().crossVectors(e1, e2).normalize();
  const center = new THREE.Vector3();
  verts.forEach(v => center.add(v));
  center.divideScalar(verts.length);
  // Outward = normal points away from center of box (origin)
  if (n.dot(center) > 0) outward++;
  else inward++;
}
console.log(`CC L5 outward: ${outward}, inward: ${inward}`);

// Check _sourceFacesPerCageFace chain
console.log(`\nCC L5 _sourceFacesPerCageFace sample (first 30): [${(cc._sourceFacesPerCageFace || []).slice(0, 30).join(',')}]`);
console.log(`CC L5 _sourceFaceGroup sample (first 30): [${(cc._sourceFaceGroup || []).slice(0, 30).join(',')}]`);