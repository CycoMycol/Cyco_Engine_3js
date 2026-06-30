#!/usr/bin/env node
import * as THREE from '../editor/libs/three/build/three.module.min.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as url from 'node:url';

const emPath = path.resolve('editor/src/CycoModeler/EditableMesh.js');
const emSrc = await fs.readFile(emPath, 'utf8');
const emPatched = emSrc.replace(/from\s+['"]three['"]/, "from '../editor/libs/three/build/three.module.min.js'");
const tmpPath = path.resolve('tools/.tmp-simple-EditableMesh.mjs');
await fs.writeFile(tmpPath, emPatched, 'utf8');
const { EditableMesh } = await import(url.pathToFileURL(tmpPath).href);

const cage = EditableMesh.boxFromBounds(
  new THREE.Vector3(-50, 0, -50),
  new THREE.Vector3(50, 100, 50),
);

for (const level of [1, 2, 3]) {
  console.log(`\n=== Simple level=${level} ===`);
  const r = cage.subdivideSimple(level);
  console.log(`faces=${r.faces.length} faceLen=${r.faces[0]?.length}`);
  console.log(`faceGroups sample: [${r.faceGroups.slice(0, 12).join(',')}]`);
  console.log(`unique faceGroups: ${[...new Set(r.faceGroups)].join(',')}`);
  const sfg = r._sourceFaceGroup || [];
  console.log(`_sourceFaceGroup sample: [${sfg.slice(0, 12).join(',')}]`);
  console.log(`unique _sourceFaceGroup count: ${[...new Set(sfg)].length}`);
}