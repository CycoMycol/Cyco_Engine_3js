#!/usr/bin/env node
import * as THREE from '../editor/libs/three/build/three.module.min.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as url from 'node:url';

const emPath = path.resolve('editor/src/CycoModeler/EditableMesh.js');
const emSrc = await fs.readFile(emPath, 'utf8');
const emPatched = emSrc.replace(/from\s+['"]three['"]/, "from '../editor/libs/three/build/three.module.min.js'");
const tmpPath = path.resolve('tools/.tmp-deep-EditableMesh.mjs');
await fs.writeFile(tmpPath, emPatched, 'utf8');
const { EditableMesh } = await import(url.pathToFileURL(tmpPath).href);

const cage = EditableMesh.boxFromBounds(
  new THREE.Vector3(-50, 0, -50),
  new THREE.Vector3(50, 100, 50),
);

for (const algo of ['CC', 'Simple', 'Loop']) {
  for (const level of [1, 2, 3, 4, 5]) {
    let r;
    if (algo === 'CC') r = cage.subdivideCatmullClark(level);
    else if (algo === 'Simple') r = cage.subdivideSimple(level);
    else r = cage.subdivideLoop(level);
    const fg = r.faceGroups || [];
    const sfg = r._sourceFaceGroup || [];
    const spfc = r._sourceFacesPerCageFace || [];
    const uniqueFG = new Set(fg).size;
    const uniqueSFG = new Set(sfg).size;
    const uniqueSPFC = new Set(spfc).size;
    console.log(`${algo} L${level}: faces=${r.faces.length} faceLen=${r.faces[0]?.length} uniqueFG=${uniqueFG} uniqueSFG=${uniqueSFG} uniqueSPFC=${uniqueSPFC}`);
    if (level === 2) {
      console.log(`  fg sample: [${fg.slice(0,10).join(',')}]`);
      console.log(`  sfg sample: [${sfg.slice(0,10).join(',')}]`);
      console.log(`  spfc sample: [${spfc.slice(0,10).join(',')}]`);
    }
  }
}