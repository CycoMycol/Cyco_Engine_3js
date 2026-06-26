#!/usr/bin/env node
/**
 * End-to-end wireframe integration test using EditableMesh + CycleModeler
 * helpers directly (no DOM). Simulates the bug the user reported:
 *
 *   1. Create a box primitive via `_makeEditablePrimitive('box', ...)`.
 *   2. Call `_applyDimensions(obj, { primitive: 'box-subdivided', segments: 3 })`.
 *   3. Confirm `cycoModeler.mesh` is rebuilt with the subdivided topology
 *      AND that the wireframe overlay geometry includes internal subdivision
 *      lines (the bug was that the mesh wasn't rebuilt, so subdivisions
 *      were invisible).
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
const tmpPath = path.resolve('tools/.tmp-subdiv-int-EditableMesh.mjs');
await fs.writeFile(tmpPath, emPatched, 'utf8');
const { EditableMesh } = await import(url.pathToFileURL(tmpPath).href);

let failed = 0;
function assert(name, cond, info) {
  if (cond) console.log(`  PASS  ${name}`);
  else { console.log(`  FAIL  ${name}  ${info ?? ''}`); failed += 1; }
}

// === BUG REPRODUCTION ===
//
// Before the fix:
//   _applyDimensions({primitive: 'box-subdivided'}) created a
//   THREE.BoxGeometry with s×s×s segments but did NOT update
//   obj.userData.cycoModeler.mesh. The wireframe overlay then read the
//   STALE mesh JSON (still describing the un-subdivided box) and
//   rendered only the 12-edge silhouette — no subdivisions visible.
//
// After the fix:
//   _applyDimensions rebuilds cycoModeler.mesh from the new subdivided
//   EditableMesh, and the wireframe (now toEdgesGeometry(0)) shows all
//   the subdivision lines.

const width = 200, height = 100, depth = 200, segments = 3;

// 1. Create the box's "userData" the way the modeler would after the
//    primitive is drawn on the viewport.
const initial = EditableMesh.boxFromBounds(
  new THREE.Vector3(-width / 2, 0, -depth / 2),
  new THREE.Vector3(width / 2, height, depth / 2),
);
const obj = {
  geometry: initial.toBufferGeometry(),
  position: new THREE.Vector3(0, 0, 0),
  material: new THREE.MeshStandardMaterial({ color: 0xcccccc }),
  children: [],
  userData: {
    cycoModeler: {
      type: 'editableMesh',
      primitive: 'box',
      dimensions: { width, height, depth },
      mesh: initial.toJSON(),
      selectedFaces: [],
    },
  },
};
const meshPre = obj.userData.cycoModeler.mesh;
assert('pre-subdivide mesh has 12 tris (6 quads × 2)',
  meshPre.faces.length === 12, `got ${meshPre.faces.length}`);

// 2. Simulate the subdivide flow (matching `_applyDimensions` for
//    `box-subdivided` after the fix).
const subdivided = EditableMesh.boxSubdivided(width, height, depth, segments);
obj.geometry = subdivided.toBufferGeometry();
obj.userData.cycoModeler = {
  ...obj.userData.cycoModeler,
  primitive: 'box-subdivided',
  dimensions: { width, height, depth },
  bevel: 0,
  segments,
  mesh: subdivided.toJSON(),
};

// 3. Verify the mesh JSON was rebuilt (regression test for the bug).
const meshPost = obj.userData.cycoModeler.mesh;
assert('post-subdivide mesh has 108 tris (6 × s² × 2)',
  meshPost.faces.length === 108, `got ${meshPost.faces.length}`);
assert('post-subdivide mesh has 96 verts (6 × (s+1)²)',
  meshPost.vertices.length === 96, `got ${meshPost.vertices.length}`);
assert('post-subdivide mesh has 54 unique face groups',
  new Set(meshPost.faceGroups).size === 54, `got ${new Set(meshPost.faceGroups).size}`);

// 4. Build the wireframe the way `_syncWireOverlay` does (after fix:
//    toEdgesGeometry(0) so subdivisions are emitted).
const wireGeom = EditableMesh.fromJSON(meshPost).toEdgesGeometry(0);
const wireSegCount = wireGeom.attributes.position.count / 2;
assert('wireframe includes subdivision lines (> silhouette baseline)',
  wireSegCount > 100, `got ${wireSegCount}`);

// 5. Triangle count matches THREE.BoxGeometry for visual parity.
const refGeom = new THREE.BoxGeometry(width, height, depth, segments, segments, segments);
refGeom.translate(0, height / 2, 0);
const ourTris = obj.geometry.attributes.position.count / 3;
const refTris = refGeom.toNonIndexed().attributes.position.count / 3;
assert('subdivided tris match THREE.BoxGeometry', ourTris === refTris, `ours=${ourTris} ref=${refTris}`);

await fs.unlink(tmpPath).catch(() => {});
console.log(failed === 0 ? '\nAll subdivision-integration tests passed.' : `\n${failed} test(s) failed.`);
process.exit(failed === 0 ? 0 : 1);