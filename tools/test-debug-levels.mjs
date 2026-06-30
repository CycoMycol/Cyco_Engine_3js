#!/usr/bin/env node
import * as THREE from '../editor/libs/three/build/three.module.min.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as url from 'node:url';

const emPath = path.resolve('editor/src/CycoModeler/EditableMesh.js');
const emSrc = await fs.readFile(emPath, 'utf8');
const emPatched = emSrc.replace(/from\s+['"]three['"]/, "from '../editor/libs/three/build/three.module.min.js'");
const tmpPath = path.resolve('tools/.tmp-debug-levels-EditableMesh.mjs');
await fs.writeFile(tmpPath, emPatched, 'utf8');
const { EditableMesh } = await import(url.pathToFileURL(tmpPath).href);

const cage = EditableMesh.boxFromBounds(
  new THREE.Vector3(-50, 0, -50),
  new THREE.Vector3(50, 100, 50),
);

for (const level of [1, 2, 3, 4, 5]) {
  console.log(`\n=== Catmull-Clark level=${level} ===`);
  const r = cage.subdivideCatmullClark(level);
  const faceGroups = r.faceGroups.slice(0, 5);
  const sfg = (r._sourceFaceGroup || []).slice(0, 5);
  console.log(`faces=${r.faces.length} faceLen=${r.faces[0]?.length}`);
  console.log(`faceGroups sample: [${faceGroups.join(',')}]`);
  console.log(`_sourceFaceGroup sample: [${sfg.join(',')}]`);
  const unique = new Set(r._sourceFaceGroup || []);
  console.log(`unique _sourceFaceGroup count: ${unique.size}`);
  console.log(`unique values: ${[...unique].slice(0, 10).join(',')}${unique.size > 10 ? '...' : ''}`);
}