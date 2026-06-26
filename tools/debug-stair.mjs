import * as THREE from '../editor/libs/three/build/three.module.min.js';
import { EditableMesh } from './.tmp-EditableMesh.mjs';

const stair = EditableMesh.stair(100, 200, 300);
for (let i = 0; i < stair.faces.length; i += 1) {
  const f = stair.faces[i];
  const a = stair.vertices[f[0]];
  const b = stair.vertices[f[1]];
  const c = stair.vertices[f[2]];
  const ab = new THREE.Vector3().subVectors(b, a);
  const ac = new THREE.Vector3().subVectors(c, a);
  const n = new THREE.Vector3().crossVectors(ab, ac).normalize();
  console.log(
    `face ${i.toString().padStart(2, '0')} ${f.join(',').padEnd(15)} n=(${n.x.toFixed(2)},${n.y.toFixed(2)},${n.z.toFixed(2)})  ` +
    `verts= A(${a.x},${a.y},${a.z}) B(${b.x},${b.y},${b.z}) C(${c.x},${c.y},${c.z})`
  );
}