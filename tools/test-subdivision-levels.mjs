#!/usr/bin/env node
/**
 * Regression test for subdivision at HIGHER view levels (user reported
 * "moving viewport to 5 breaks polygon selection").
 */

import * as THREE from '../editor/libs/three/build/three.module.min.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as url from 'node:url';

const emPath = path.resolve('editor/src/CycoModeler/EditableMesh.js');
const emSrc = await fs.readFile(emPath, 'utf8');
const emPatched = emSrc.replace(
  /from\s+['"]three['"]/,
  "from '../editor/libs/three/build/three.module.min.js'",
);
const tmpPath = path.resolve('tools/.tmp-levels-EditableMesh.mjs');
await fs.writeFile(tmpPath, emPatched, 'utf8');
const { EditableMesh } = await import(url.pathToFileURL(tmpPath).href);

let failed = 0;
function assert(name, cond, info) {
  if (cond) console.log(`  PASS  ${name}`);
  else { console.log(`  FAIL  ${name}  ${info ?? ''}`); failed += 1; }
}

function resolveFaceIndexFromId(mesh, faceId) {
  if (!mesh?.faceGroups || faceId < 0 || faceId >= mesh.faceGroups.length) return faceId;
  if (mesh.faceGroups[faceId] === faceId) return faceId;
  for (let i = 0; i < mesh.faceGroups.length; i += 1) {
    if (mesh.faceGroups[i] === faceId) return i;
  }
  return faceId;
}

const cage = EditableMesh.boxFromBounds(
  new THREE.Vector3(-50, 0, -50),
  new THREE.Vector3(50, 100, 50),
);

function testLevel(algoName, level) {
  console.log(`\n--- ${algoName} level=${level} ---`);
  let refined;
  if (algoName === 'CC') refined = cage.subdivideCatmullClark(level);
  else if (algoName === 'Simple') refined = cage.subdivideSimple(level);
  else refined = cage.subdivideLoop(level);

  const sfg = refined._sourceFaceGroup || [];
  const uniqueGrps = new Set(sfg);
  assert(`${algoName} L${level}: _sourceFaceGroup populated`, Array.isArray(sfg));
  assert(`${algoName} L${level}: _sourceFaceGroup has exactly 6 unique values (one per cage face)`,
    uniqueGrps.size === 6,
    `got ${uniqueGrps.size}: [${[...uniqueGrps].join(',')}]`);

  const geo = refined.toBufferGeometry({ faceIdMap: sfg });
  const fidAttr = geo.getAttribute('faceId');
  const triCount = fidAttr.count / 3;

  // Pick the FRONT cage face by reading a triangle whose
  // _sourceFaceGroup === 1 (front).
  const frontGroup = 1;
  let triIndex = -1;
  for (let t = 0; t < triCount; t += 1) {
    if ((fidAttr.getX(t * 3) | 0) === frontGroup) { triIndex = t; break; }
  }
  assert(`${algoName} L${level}: found a refined triangle whose faceId = ${frontGroup} (front)`,
    triIndex >= 0,
    `triCount=${triCount}`);

  if (triIndex < 0) return;
  const faceId = fidAttr.getX(triIndex * 3) | 0;
  const resolved = resolveFaceIndexFromId(cage, faceId);
  const sel = cage.selectionGroup(resolved);
  assert(`${algoName} L${level}: selectionGroup resolves to cage faceGroup = ${frontGroup} (front)`,
    cage.faceGroups[sel[0]] === frontGroup,
    `got cage faceGroup = ${cage.faceGroups[sel[0]]} (cage triangles [${sel.join(',')}])`);

  // Pick ALL 6 cage faces and verify each maps correctly
  for (let g = 0; g < 6; g += 1) {
    let found = false;
    let firstTriIdx = -1;
    for (let t = 0; t < triCount; t += 1) {
      if ((fidAttr.getX(t * 3) | 0) === g) { found = true; firstTriIdx = t; break; }
    }
    if (!found) {
      console.log(`  FAIL  ${algoName} L${level}: no triangle has faceId=${g}`);
      failed += 1;
      continue;
    }
    const fid = fidAttr.getX(firstTriIdx * 3) | 0;
    const r = resolveFaceIndexFromId(cage, fid);
    const s = cage.selectionGroup(r);
    if (cage.faceGroups[s[0]] !== g) {
      console.log(`  FAIL  ${algoName} L${level}: face group ${g} resolved to cage group ${cage.faceGroups[s[0]]}`);
      failed += 1;
    }
  }
}

for (const algo of ['CC', 'Simple', 'Loop']) {
  for (const lvl of [1, 2, 3, 4, 5, 6]) {
    testLevel(algo, lvl);
  }
}

console.log(`\nResult: ${failed} failure(s)`);
process.exit(failed ? 1 : 0);