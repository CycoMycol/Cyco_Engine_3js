#!/usr/bin/env node
/**
 * Validates the Display Cage toggle:
 *
 *   - When Display Cage is OFF (default), `_previewEditableMesh`
 *     writes the refined-mesh JSON to `cycoModeler._subdivisionRefinedMesh`
 *     and stamps `_subdivisionSelectionMode = "cage"`. The polygon's
 *     `faceId` attribute is a mapping back to the cage face index.
 *   - When Display Cage is ON, `_previewEditableMesh(... "refined")`
 *     flips `_subdivisionSelectionMode = "refined"` and the polygon's
 *     `faceId` attribute points at the refined face index.
 *
 * The test exercises toBufferGeometry with both faceIdMap modes and
 * asserts the resulting tri count + faceId attribute are consistent
 * with each branch.
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
const tmpPath = path.resolve('tools/.tmp-cage-toggle-EditableMesh.mjs');
await fs.writeFile(tmpPath, emPatched, 'utf8');
const { EditableMesh } = await import(url.pathToFileURL(tmpPath).href);

let failed = 0;
function assert(name, cond, info) {
  if (cond) console.log(`  PASS  ${name}`);
  else { console.log(`  FAIL  ${name}  ${info ?? ''}`); failed += 1; }
}

const box = EditableMesh.boxFromBounds(
  new THREE.Vector3(-100, -100, -100),
  new THREE.Vector3(100, 100, 100),
);
const refined = box.subdivideLoop(1);

// ── Mode "cage": faceIdMap = _sourceFace (12 → 4 per cage face) ────
const cageMap = refined._sourceFace;
assert('_sourceFace has 48 entries (matches face count)',
  cageMap.length === 48);
const bgCage = refined.toBufferGeometry({ faceIdMap: cageMap });
const fidCage = bgCage.getAttribute('faceId');
assert('cage mode: every 3 consecutive faceId values are equal',
  (() => {
    for (let i = 0; i < fidCage.count; i += 3) {
      if (fidCage.getX(i) !== fidCage.getX(i + 1) ||
          fidCage.getX(i + 1) !== fidCage.getX(i + 2)) return false;
    }
    return true;
  })());
assert('cage mode: every 4 triangles share one faceId (12 unique values)',
  (() => {
    const s = new Set();
    for (let i = 0; i < fidCage.count; i += 3) s.add(fidCage.getX(i));
    return s.size === 12;
  })());

// ── Mode "refined": faceIdMap = identity ───────────────────────────
const refinedMap = refined.faces.map((_, i) => i);
const bgRefined = refined.toBufferGeometry({ faceIdMap: refinedMap });
const fidRefined = bgRefined.getAttribute('faceId');
assert('refined mode: every triangle has its own faceId (48 unique)',
  (() => {
    const s = new Set();
    for (let i = 0; i < fidRefined.count; i += 3) s.add(fidRefined.getX(i));
    return s.size === 48;
  })());
assert('refined mode: faceId for tri #N = N',
  fidRefined.getX(0) === 0 && fidRefined.getX(3) === 1 && fidRefined.getX(6) === 2);

// ── selectionGroup parity: refined mesh 8 tris per parent faceGroup ─
// In the default (Display Cage off) refined-mesh topology, each
// parent quad's two triangles split into 8 children that all share
// the parent's faceGroup. So selectionGroup on the refined mesh
// returns 8 children per parent -- which is "the entire subdivided
// quad" -- not the single triangle.
const grp8 = refined.selectionGroup(0);
assert('refined mesh (default): selectionGroup(0) returns 8 sub-tris of the parent quad',
  grp8.length === 8,
  `got ${grp8.length}: [${grp8.join(',')}]`);

// ── "Display Cage on" rebuilt: every child triangle becomes its own ─
// polygon via `uniqueFaceGroups: true`. Now selectionGroup(0) on the
// refined mesh is just [0].
const refinedUnique = box.subdivideLoop(1, { uniqueFaceGroups: true });
assert('refined mesh (Display Cage on) has 48 unique faceGroups',
  new Set(refinedUnique.faceGroups).size === 48);
const grpUnique = refinedUnique.selectionGroup(0);
assert('Display Cage on: refined.selectionGroup(0) selects just 1 sub-tri',
  grpUnique.length === 1 && grpUnique[0] === 0,
  `got ${JSON.stringify(grpUnique)}`);

// ── Same call on the CAGE mesh still returns 2 tris of the quad ────
const grp2 = box.selectionGroup(0);
assert('cage mesh: selectionGroup(0) returns 2 tris of the original quad',
  grp2.length === 2,
  `got ${grp2.length}: [${grp2.join(',')}]`);

// ── Selection parity: the two modes select different surface area ──
// This is the Blender toggle behaviour the user asked for:
//   cage mode    -> click selects the WHOLE cage face (the 2 cage tris)
//   refined mode -> click selects just the sub-tri the user actually
//                   clicked (1 tri when Display Cage is on)
assert('cage-mode selects 2 polys, refined-mode (Display Cage on) selects 1',
  grp2.length === 2 && grpUnique.length === 1);

// ── Catmull-Clark variant: same toggle semantics on quad topology ─
// CC produces 30 quads in the data model (5 child quads per parent
// quad × 6 parent quads), all 4-vertex faces. toBufferGeometry
// fan-triangulates to 60 tris on the GPU; selectionGroup operates
// on the data model and so returns 5 child quads per parent.
// Default mode: all 5 child quads of the parent quad share a
// faceGroup. Refined mode: each quad is its own polygon.
{
  const ccRefined = box.subdivideCatmullClark(1);
  assert('CC refined mesh has 30 child quads (QUADS in data model)',
    ccRefined.faces.length === 30, `got ${ccRefined.faces.length}`);
  assert('CC refined mesh: every face is a 4-vertex quad',
    ccRefined.faces.every((f) => f.length === 4));
  assert('CC default mode: 6 faceGroups preserved',
    new Set(ccRefined.faceGroups).size === 6);
  const ccGrp = ccRefined.selectionGroup(0);
  assert('CC default mode: selectionGroup(0) returns 5 quads of the parent quad',
    ccGrp.length === 5, `got ${ccGrp.length}`);

  const ccRefinedUnique = box.subdivideCatmullClark(1, { uniqueFaceGroups: true });
  assert('CC Display Cage on: 30 unique faceGroups (one per child quad)',
    new Set(ccRefinedUnique.faceGroups).size === 30,
    `got ${new Set(ccRefinedUnique.faceGroups).size}`);
  const ccGrpUnique = ccRefinedUnique.selectionGroup(0);
  assert('CC Display Cage on: selectionGroup(0) returns just 1 child quad',
    ccGrpUnique.length === 1, `got ${ccGrpUnique.length}`);
}

if (failed) {
  console.log(`\n${failed} assertion(s) failed.`);
  process.exit(1);
}
console.log('\nAll Display Cage toggle tests passed.');
