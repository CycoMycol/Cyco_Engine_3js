import * as THREE from '../editor/libs/three/build/three.module.min.js';
import { EditableMesh } from './.tmp-EditableMesh.mjs';

const cap = EditableMesh.capsule(100, 100, 100);
console.log('default capsule (100x100x100):');
console.log('vertices:', cap.vertices.length);
console.log('faces:', cap.faces.length);
const ys = cap.vertices.map(v => v.y);
console.log('y range:', Math.min(...ys), 'to', Math.max(...ys));
const yCount = {};
for (const y of ys) {
  const key = y.toFixed(1);
  yCount[key] = (yCount[key] || 0) + 1;
}
console.log('y distribution:');
for (const k of Object.keys(yCount).sort((a,b)=>parseFloat(a)-parseFloat(b))) {
  console.log(`  y=${k}: ${yCount[k]} verts`);
}