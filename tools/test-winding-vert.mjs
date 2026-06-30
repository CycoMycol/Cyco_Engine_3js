#!/usr/bin/env node
import * as THREE from '../editor/libs/three/build/three.module.min.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as url from 'node:url';

const emPath = path.resolve('editor/src/CycoModeler/EditableMesh.js');
const emSrc = await fs.readFile(emPath, 'utf8');
const emPatched = emSrc.replace(/from\s+['"]three['"]/, "from '../editor/libs/three/build/three.module.min.js'");
const tmpPath = path.resolve('tools/.tmp-winding3-EditableMesh.mjs');
await fs.writeFile(tmpPath, emPatched, 'utf8');
const { EditableMesh } = await import(url.pathToFileURL(tmpPath).href);

const cage = EditableMesh.boxFromBounds(
  new THREE.Vector3(-50, 0, -50),
  new THREE.Vector3(50, 100, 50),
);

console.log('Cage vertices:');
cage.vertices.forEach((v, i) => console.log(`  v${i}: (${v.x}, ${v.y}, ${v.z})`));
console.log('Cage faces:');
cage.faces.forEach((f, i) => {
  const verts = f.map(idx => cage.vertices[idx]);
  const e1 = new THREE.Vector3().subVectors(verts[1], verts[0]);
  const e2 = new THREE.Vector3().subVectors(verts[2], verts[0]);
  const n = new THREE.Vector3().crossVectors(e1, e2);
  const center = new THREE.Vector3();
  verts.forEach(v => center.add(v));
  center.divideScalar(verts.length);
  const dot = n.dot(center);
  console.log(`  face ${i}: [${f.join(',')}] grp=${cage.faceGroups[i]} n=(${n.x.toFixed(0)},${n.y.toFixed(0)},${n.z.toFixed(0)}) c=(${center.x.toFixed(0)},${center.y.toFixed(0)},${center.z.toFixed(0)}) dot=${dot.toFixed(0)}`);
});

const r = cage.subdivideSimple(1);
console.log(`\nSimple L1: ${r.faces.length} faces`);
console.log('Sample child face 16 (should be on bottom):');
const face = r.faces[16];
const verts = face.map(idx => r.vertices[idx]);
console.log(`  face [${face.join(',')}] grp=${r.faceGroups[16]}`);
verts.forEach((v, j) => console.log(`  v${face[j]}: (${v.x}, ${v.y}, ${v.z})`));
const e1 = new THREE.Vector3().subVectors(verts[1], verts[0]);
const e2 = new THREE.Vector3().subVectors(verts[2], verts[0]);
const n = new THREE.Vector3().crossVectors(e1, e2);
const center = new THREE.Vector3();
verts.forEach(v => center.add(v));
center.divideScalar(verts.length);
console.log(`  e1=(${e1.x},${e1.y},${e1.z}) e2=(${e2.x},${e2.y},${e2.z})`);
console.log(`  n=(${n.x.toFixed(2)},${n.y.toFixed(2)},${n.z.toFixed(2)}) c=(${center.x.toFixed(2)},${center.y.toFixed(2)},${center.z.toFixed(2)}) dot=${n.dot(center).toFixed(2)}`);