#!/usr/bin/env node
import * as THREE from '../editor/libs/three/build/three.module.min.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as url from 'node:url';

const emPath = path.resolve('editor/src/CycoModeler/EditableMesh.js');
const emSrc = await fs.readFile(emPath, 'utf8');
const emPatched = emSrc.replace(/from\s+['"]three['"]/, "from '../editor/libs/three/build/three.module.min.js'");
const tmpPath = path.resolve('tools/.tmp-winding-EditableMesh.mjs');
await fs.writeFile(tmpPath, emPatched, 'utf8');
const { EditableMesh } = await import(url.pathToFileURL(tmpPath).href);

const cage = EditableMesh.boxFromBounds(
  new THREE.Vector3(-50, 0, -50),
  new THREE.Vector3(50, 100, 50),
);

for (const algo of ['CC', 'Simple', 'Loop']) {
  for (const level of [1, 2, 3]) {
    let r;
    if (algo === 'CC') r = cage.subdivideCatmullClark(level);
    else if (algo === 'Simple') r = cage.subdivideSimple(level);
    else r = cage.subdivideLoop(level);
    let outward = 0, inward = 0;
    for (let i = 0; i < r.faces.length; i++) {
      const face = r.faces[i];
      const verts = face.map(idx => r.vertices[idx]);
      const e1 = new THREE.Vector3().subVectors(verts[1], verts[0]);
      const e2 = new THREE.Vector3().subVectors(verts[2], verts[0]);
      const n = new THREE.Vector3().crossVectors(e1, e2).normalize();
      const center = new THREE.Vector3();
      verts.forEach(v => center.add(v));
      center.divideScalar(verts.length);
      if (n.dot(center) > 0) outward++;
      else inward++;
    }
    console.log(`${algo} L${level}: outward=${outward} inward=${inward} (${(inward / r.faces.length * 100).toFixed(1)}% inverted)`);
  }
}