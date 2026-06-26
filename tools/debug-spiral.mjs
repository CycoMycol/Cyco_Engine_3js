import * as THREE from '../editor/libs/three/build/three.module.min.js';
import { EditableMesh } from './.tmp-EditableMesh.mjs';

const spiral = EditableMesh.spiralStair(200, 300, 200);
console.log(`spiral: ${spiral.vertices.length} vertices, ${spiral.faces.length} faces`);

let badFaces = 0;
for (let i = 0; i < spiral.faces.length; i += 1) {
  const f = spiral.faces[i];
  const a = spiral.vertices[f[0]];
  const b = spiral.vertices[f[1]];
  const c = spiral.vertices[f[2]];
  const d = f.length > 3 ? spiral.vertices[f[3]] : null;
  const ab = new THREE.Vector3().subVectors(b, a);
  const ac = new THREE.Vector3().subVectors(c, a);
  const n = new THREE.Vector3().crossVectors(ab, ac);
  const len = n.length();
  if (len < 1e-6) {
    console.log(`  DEGENERATE face ${i}: [${f.join(',')}] (zero area)`);
    badFaces += 1;
  }
}
console.log(`bad faces: ${badFaces}`);

console.log('\nFirst few faces:');
for (let i = 0; i < Math.min(spiral.faces.length, 8); i += 1) {
  const f = spiral.faces[i];
  const a = spiral.vertices[f[0]];
  const b = spiral.vertices[f[1]];
  const c = spiral.vertices[f[2]];
  const d = f.length > 3 ? spiral.vertices[f[3]] : null;
  console.log(`  ${i}: ${f.join(',')} A=(${a.x.toFixed(1)},${a.y.toFixed(1)},${a.z.toFixed(1)}) ${d ? `D=(${d.x.toFixed(1)},${d.y.toFixed(1)},${d.z.toFixed(1)})` : ''}`);
}