#!/usr/bin/env node
import * as THREE from '../editor/libs/three/build/three.module.min.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as url from 'node:url';

const emPath = path.resolve('editor/src/CycoModeler/EditableMesh.js');
const emSrc = await fs.readFile(emPath, 'utf8');
const emPatched = emSrc.replace(/from\s+['"]three['"]/, "from '../editor/libs/three/build/three.module.min.js'");
const tmpPath = path.resolve('tools/.tmp-winding4-EditableMesh.mjs');
await fs.writeFile(tmpPath, emPatched, 'utf8');
const { EditableMesh } = await import(url.pathToFileURL(tmpPath).href);

const cage = EditableMesh.boxFromBounds(
  new THREE.Vector3(-50, 0, -50),
  new THREE.Vector3(50, 100, 50),
);

// Compute expected normal direction for each face group on the cage.
const cageNormals = new Map();
for (let i = 0; i < cage.faces.length; i++) {
  const grp = cage.faceGroups[i];
  if (cageNormals.has(grp)) continue;
  const face = cage.faces[i];
  const verts = face.map(idx => cage.vertices[idx]);
  const e1 = new THREE.Vector3().subVectors(verts[1], verts[0]);
  const e2 = new THREE.Vector3().subVectors(verts[2], verts[0]);
  cageNormals.set(grp, new THREE.Vector3().crossVectors(e1, e2).normalize());
}

function check(algo, level) {
  let r;
  if (algo === 'CC') r = cage.subdivideCatmullClark(level);
  else if (algo === 'Simple') r = cage.subdivideSimple(level);
  else r = cage.subdivideLoop(level);
  let correct = 0, inverted = 0;
  for (let i = 0; i < r.faces.length; i++) {
    const face = r.faces[i];
    const verts = face.map(idx => r.vertices[idx]);
    const e1 = new THREE.Vector3().subVectors(verts[1], verts[0]);
    const e2 = new THREE.Vector3().subVectors(verts[2], verts[0]);
    const n = new THREE.Vector3().crossVectors(e1, e2).normalize();
    const grp = r.faceGroups[i];
    const expected = cageNormals.get(grp);
    if (!expected) { correct++; continue; }
    const dot = n.dot(expected);
    if (dot > 0.5) correct++;
    else inverted++;
  }
  console.log(`${algo} L${level}: ${r.faces.length} faces, correct=${correct}, inverted=${inverted} (${(inverted / r.faces.length * 100).toFixed(1)}%)`);
}

for (const algo of ['CC', 'Simple', 'Loop']) {
  for (const lvl of [1, 2, 3]) {
    check(algo, lvl);
  }
}