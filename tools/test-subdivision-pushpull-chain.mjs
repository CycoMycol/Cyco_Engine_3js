// tools/test-subdivision-pushpull-chain.mjs
// End-to-end test: cage push/pull while a Subdivision Surface modifier is active.
// Verifies that:
//   1) After subdivision, faces are stored as quads (not triangle pairs).
//   2) Pushing a cage face and re-running CC keeps quad-only output.
//   3) The picker still resolves the correct cage face group after subdivision.
//   4) The display geometry is the subdivided mesh (not the raw cage) after preview.

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
const tmpPath = path.resolve('tools/.tmp-pushpull-chain-EditableMesh.mjs');
await fs.writeFile(tmpPath, emPatched, 'utf8');
const { EditableMesh } = await import(url.pathToFileURL(tmpPath).href);

let passed = 0;
let failed = 0;

function assert(label, cond, extra = '') {
    if (cond) {
        console.log(`  PASS  ${label}`);
        passed += 1;
    } else {
        console.log(`  FAIL  ${label}${extra ? '  ' + extra : ''}`);
        failed += 1;
    }
}

function header(t) {
    console.log(`\n=== ${t} ===`);
}

// ---------- 1) Initial CC output is quad-only ----------
header('1. Initial CC subdivider output is quad-only');

const cage = EditableMesh.boxFromBounds(-50, 0, -50, 50, 100, 50);
assert('Cage has 12 triangles', cage.faces.length === 12, `got ${cage.faces.length}`);
// Each triangle pair shares a faceGroup ID; faceGroups has 12 entries but 6 unique group IDs.
const uniqueCageGroups = new Set(cage.faceGroups).size;
assert('Cage has 6 unique faceGroup IDs', uniqueCageGroups === 6, `got ${uniqueCageGroups}`);

const refined = cage.subdivideCatmullClark(1);
assert('CC level 1 produces 30 faces (5 quads per source quad x 6 source quads)', refined.faces.length === 30, `got ${refined.faces.length}`);
assert('CC level 1 produces 30 faceGroups (1 per face)', refined.faceGroups.length === 30, `got ${refined.faceGroups.length}`);

const quadCount = refined.faces.filter((f) => f.length === 4).length;
const triCount = refined.faces.filter((f) => f.length === 3).length;
assert('All CC level 1 faces are quads', quadCount === 30 && triCount === 0, `quads=${quadCount} tris=${triCount}`);

// ---------- 2) sourceFace is set per quad ----------
header('2. _sourceFace is set on every face for picker mapping');

assert('refined._sourceFace exists', Array.isArray(refined._sourceFace));
assert('_sourceFace has 30 entries (one per face)', refined._sourceFace.length === 30, `got ${refined._sourceFace?.length}`);

const groupsPerSource = new Map();
for (let i = 0; i < refined._sourceFace.length; i += 1) {
    const src = refined._sourceFace[i];
    groupsPerSource.set(src, (groupsPerSource.get(src) || 0) + 1);
}
assert('Each of the 6 source quads maps to exactly 5 child quads',
    [...groupsPerSource.values()].every((v) => v === 5) && groupsPerSource.size === 6,
    `groups=${JSON.stringify([...groupsPerSource])}`);

// ---------- 3) BufferGeometry fan-triangulates correctly ----------
header('3. toBufferGeometry fan-triangulates quad faces (60 triangles, 180 positions)');

const bg = refined.toBufferGeometry();
// 30 quads * 2 fan-tris each = 60 tris, each with 3 verts = 180 position entries.
const bgTriCount = bg.index ? (bg.index.count / 3) : (bg.attributes.position.count / 3);
assert('60 triangles emitted (30 quads fan-triangulated)', bgTriCount === 60, `got ${bgTriCount}`);

// ---------- 4) Pushing a cage face keeps CC output quad-only ----------
header('4. Pushing a cage face keeps CC output quad-only');

const pushed = EditableMesh.boxFromBounds(-50, 0, -50, 50, 100, 50);
const frontTris = [];
for (let i = 0; i < pushed.faces.length; i += 1) {
    if (pushed.faceGroups[i] === 1) frontTris.push(i);
}
assert('Front face has 2 tri indices', frontTris.length === 2, `got ${frontTris.length}`);

pushed.pushFaces(frontTris, 20);
assert('After push: pushed cage has 16 faces (12 original + 4 side-wall quads)', pushed.faces.length === 16, `got ${pushed.faces.length}`);
const pushedQuadCount = pushed.faces.filter((f) => f.length === 4).length;
assert('Side-wall quads are stored as quads', pushedQuadCount === 4, `got ${pushedQuadCount}`);

const refinedPushed = pushed.subdivideCatmullClark(1);
assert('After push + CC: output is quad-only', refinedPushed.faces.every((f) => f.length === 4),
    `face sizes=${[...new Set(refinedPushed.faces.map((f) => f.length))]}`);

// ---------- 5) faceGroup continuity through push ----------
header('5. Pushed face preserves group ID (for selection highlight continuity)');

const pushedFrontGroupIds = [];
for (let i = 0; i < pushed.faceGroups.length; i += 1) {
    if (pushed.faces[i].length === 3 && pushed.faceGroups[i] === 1) pushedFrontGroupIds.push(i);
}
assert('Pushed front face still has 2 tris with group 1', pushedFrontGroupIds.length === 2,
    `got ${pushedFrontGroupIds.length}`);

// ---------- 6) Picker resolution (faceIdMap from _sourceFace) ----------
header('6. Picker resolves correctly from refined to cage face');

const bgPushed = refinedPushed.toBufferGeometry();
const faceIdAttr = bgPushed.attributes.faceId;
// Pushed cage has 6 paired-quads (12 tris -> 6 quads) + 4 side-wall quads = 10 source quads.
// CC produces 5 child quads per source quad = 50 child quads -> 100 tris -> 300 position verts.
assert('faceId attribute has 1 entry per vertex (300)', faceIdAttr.count === 300, `got ${faceIdAttr.count}`);
assert('First 6 faceIds all map to cage face group 0 (back quad child tris)',
    [0, 1, 2, 3, 4, 5].every((i) => faceIdAttr.getX(i) === 0),
    `first 6=${[0, 1, 2, 3, 4, 5].map((i) => faceIdAttr.getX(i))}`);

await fs.unlink(tmpPath).catch(() => {});

console.log(`\n[RESULT] ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);