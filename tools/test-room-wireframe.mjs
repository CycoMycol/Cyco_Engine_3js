#!/usr/bin/env node
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

const emPath = path.resolve('editor/src/CycoModeler/EditableMesh.js');
const emSrc = await fs.readFile(emPath, 'utf8');
const patched = emSrc.replace(
  /from\s+['"]three['"]/,
  "from '../editor/libs/three/build/three.module.min.js'",
);
const tmp = path.resolve('tools/.tmp-room.mjs');
await fs.writeFile(tmp, patched);

const { EditableMesh } = await import(pathToFileURL(tmp).href);
const m = EditableMesh.room(200, 300, 200);
console.log('faceGroups:', m.faceGroups.join(','));
const g = m.toEdgesGeometry(1);
const segs = g.attributes.position.count / 2;
console.log('segments:', segs);
const pos = g.attributes.position.array;
for (let i = 0; i < segs; i++) {
  const a = [pos[i*6], pos[i*6+1], pos[i*6+2]].map(v => v.toFixed(0));
  const b = [pos[i*6+3], pos[i*6+4], pos[i*6+5]].map(v => v.toFixed(0));
  console.log('  ' + a.join(',') + ' -> ' + b.join(','));
}
await fs.unlink(tmp);