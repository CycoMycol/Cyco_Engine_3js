#!/usr/bin/env node
import * as THREE from '../editor/libs/three/build/three.module.min.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as url from 'node:url';

const emPath = path.resolve('editor/src/CycoModeler/EditableMesh.js');
const emSrc = await fs.readFile(emPath, 'utf8');
const emPatched = emSrc.replace(/from\s+['"]three['"]/, "from '../editor/libs/three/build/three.module.min.js'");
const tmpPath = path.resolve('tools/.tmp-winding2-EditableMesh.mjs');
await fs.writeFile(tmpPath, emPatched, 'utf8');
const { EditableMesh } = await import(url.pathToFileURL(tmpPath).href);

const cage = EditableMesh.boxFromBounds(
  new THREE.Vector3(-50, 0, -50),
  new THREE.Vector3(50, 100, 50),
);

const r = cage.subdivideSimple(1);
for (let i = 0; i < r.faces.length; i++) {
  const face = r.faces[i];
  const verts = face.map(idx => r.vertices[idx]);
  const e1 = new THREE.Vector3().subVectors(verts[1], verts[0]);
  const e2 = new THREE.Vector3().subVectors(verts[2], verts[0]);
  const n = new THREE.Vector3().crossVectors(e1, e2);
  const center = new THREE.Vector3();
  verts.forEach(v => center.add(v));
  center.divideScalar(verts.length);
  const dot = n.dot(center);
  const dir = dot > 0 ? 'OUT' : 'IN';
  const grp = r.faceGroups[i];
  console.log(`face ${i}: [${face.join(',')}] grp=${grp} dir=${dir} n=(${n.x.toFixed(2)},${n.y.toFixed(2)},${n.z.toFixed(2)})`);
}