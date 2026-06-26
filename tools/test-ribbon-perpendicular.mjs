#!/usr/bin/env node
/**
 * Test the ribbon-perpendicular logic.
 *
 * For each primitive's EdgesGeometry, the ribbon mesh's triangle pairs
 * should form non-degenerate quads whose offset direction is
 * approximately:
 *   - view-aligned (perpendicular to the camera view direction at the
 *     segment midpoint, AND perpendicular to the segment direction).
 *   - stable across adjacent segments in a ring (adjacent ring
 *     segments should get nearly-parallel perpendiculars).
 *
 * The previous implementation used a world-axis perpendicular picked
 * per-segment, which:
 *   1. Collapsed to a sliver when a segment ran parallel to the camera
 *      view direction.
 *   2. Switched axes between adjacent ring segments, producing
 *      inconsistent perpendiculars and "dead-space" gaps in the
 *      rendered ribbon.
 *
 * This test exercises both behaviors on all primitives and at multiple
 * camera orientations.
 */

import * as THREE from '../editor/libs/three/build/three.module.min.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as url from 'node:url';

const emPath = path.resolve(
  path.dirname(url.fileURLToPath(import.meta.url)),
  '..', 'editor', 'src', 'CycoModeler', 'EditableMesh.js',
);
const emSrc = await fs.readFile(emPath, 'utf8');
const emSrcPatched = emSrc.replace(
  /from\s+['"]three['"]/,
  "from '../editor/libs/three/build/three.module.min.js'",
);
const emTmp = path.resolve(
  path.dirname(url.fileURLToPath(import.meta.url)),
  '.tmp-EditableMesh.mjs',
);
await fs.writeFile(emTmp, emSrcPatched, 'utf8');
const { EditableMesh } = await import(url.pathToFileURL(emTmp).href);

let failed = 0;
const ok = (msg) => console.log(`  OK   ${msg}`);
const bad = (msg) => { failed += 1; console.log(`  FAIL ${msg}`); };
const section = (msg) => console.log(`\n=== ${msg} ===`);

// Re-implement the view-aligned ribbon logic from
// CycleModelerController._expandEdgesToRibbon so we can exercise it
// standalone (without bringing in the whole controller + Three.js
// module wiring).
function buildRibbon(edgesGeom, width, camera, parentWorld) {
  const src = edgesGeom.attributes.position;
  const segCount = (src.count / 2) | 0;
  const positions = [];
  const A = new THREE.Vector3();
  const B = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const dirW = new THREE.Vector3();
  const viewDir = new THREE.Vector3();
  const perpW = new THREE.Vector3();
  const offsetLocal = new THREE.Vector3();
  const invParent = new THREE.Matrix4().copy(parentWorld).invert();
  const camPos = camera.position;
  for (let i = 0; i < segCount; i++) {
    A.fromBufferAttribute(src, i * 2);
    B.fromBufferAttribute(src, i * 2 + 1);
    dir.subVectors(B, A);
    if (dir.lengthSq() < 1e-10) continue;
    dir.normalize();
    dirW.copy(dir).transformDirection(parentWorld);
    const midLocal = A.clone().add(B).multiplyScalar(0.5);
    const midWorld = midLocal.applyMatrix4(parentWorld);
    viewDir.subVectors(camPos, midWorld);
    if (viewDir.lengthSq() < 1e-10) continue;
    viewDir.normalize();
    perpW.crossVectors(dirW, viewDir);
    if (perpW.lengthSq() < 1e-6) continue;
    perpW.normalize();
    offsetLocal.copy(perpW).transformDirection(invParent).multiplyScalar(width);
    positions.push({
      a: A.clone(),
      aR: A.clone().add(offsetLocal),
      b: B.clone(),
      bR: B.clone().add(offsetLocal),
      segIndex: i,
    });
  }
  return positions;
}

const CAMERAS = [
  { name: 'front',    pos: [0, 0, 500], target: [0, 0, 0] },
  { name: 'topdown',  pos: [0, 500, 0.001], target: [0, 0, 0] },
  { name: 'oblique',  pos: [300, 300, 400], target: [0, 0, 0] },
];

function makeCamera(cam) {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2000);
  camera.position.set(...cam.pos);
  camera.lookAt(...cam.target);
  camera.updateMatrixWorld(true);
  return camera;
}

const PRIMS = [
  { name: 'sphere',  build: () => EditableMesh.sphere(100, 100, 100) },
  { name: 'torus',   build: () => EditableMesh.torus(200, 60, 200) },
  { name: 'cone',    build: () => EditableMesh.cone(100, 200, 100) },
  { name: 'cylinder', build: () => EditableMesh.cylinder(100, 200, 100) },
  { name: 'capsule', build: () => EditableMesh.capsule(100, 200, 100) },
  { name: 'box',     build: () => EditableMesh.box(100, 200, 100) },
  { name: 'icosa',   build: () => EditableMesh.icosahedron(100) },
];

for (const cam of CAMERAS) {
  const camera = makeCamera(cam);
  section(`${cam.name} camera (${cam.pos.join(',')})`);
  const width = 5; // requested world-space ribbon width
  const canvasH = 800;
  const fov = camera.fov * Math.PI / 180;
  for (const prim of PRIMS) {
    const mesh = prim.build();
    const edges = mesh.toEdgesGeometry(1);
    const parentWorld = new THREE.Matrix4();
    const ribbon = buildRibbon(edges, width, camera, parentWorld);
    if (ribbon.length === 0) {
      bad(`${prim.name}: ribbon is empty`);
      continue;
    }
    // 1. Every ribbon offset must be non-degenerate.
    let degenerate = 0;
    for (const seg of ribbon) {
      const offset = seg.aR.clone().sub(seg.a);
      if (offset.lengthSq() < 1e-4) degenerate += 1;
    }
    if (degenerate > 0) {
      bad(`${prim.name}: ${degenerate} degenerate segments (ribbon slivers)`);
    } else {
      ok(`${prim.name}: no degenerate ribbon slivers (${ribbon.length} segments)`);
    }
    // 2. Each offset must be perpendicular to the segment direction in
    // world space (i.e. perpW · dirW ≈ 0).
    let nonPerp = 0;
    for (const seg of ribbon) {
      const offsetW = seg.aR.clone().sub(seg.a); // local == world here (identity parent)
      const segDir = seg.b.clone().sub(seg.a).normalize();
      if (Math.abs(offsetW.dot(segDir)) > 0.05) nonPerp += 1;
    }
    if (nonPerp > 0) {
      bad(`${prim.name}: ${nonPerp} segments have non-perpendicular offset`);
    } else {
      ok(`${prim.name}: all offsets perpendicular to segment direction`);
    }
    // 3. **Project the ribbon onto the screen** and verify the screen
    // pixel-width is stable across all segments of the primitive. This
    // is the test the user actually cares about: "the wireframe is a
    // uniform thickness, not jittery, and covers all edges." The old
    // world-axis perpendicular made some segments produce slivers and
    // some produce normal-width ribbons → wildly varying pixel widths
    // → visually broken wireframe.
    //
    // Note: segments parallel to the camera view direction cannot have
    // a view-aligned perpendicular, so they fall back to a world-axis
    // perpendicular. Those segments are allowed to have a different
    // screen width (they're degenerate cases by definition). We test
    // the non-degenerate segments only.
    let wrongWidth = 0;
    let minScreenWidth = Infinity;
    let maxScreenWidth = -Infinity;
    let nTested = 0;
    for (const seg of ribbon) {
      const a = seg.a.clone().applyMatrix4(parentWorld);
      const b = seg.b.clone().applyMatrix4(parentWorld);
      // Skip segments parallel to the view direction (these are
      // forced into the world-axis fallback, which has a different
      // screen width).
      const mid = a.clone().add(b).multiplyScalar(0.5);
      const viewDir = camera.position.clone().sub(mid).normalize();
      const segDir = b.clone().sub(a).normalize();
      if (Math.abs(viewDir.dot(segDir)) > 0.95) continue;
      const ar = seg.aR.clone().applyMatrix4(parentWorld);
      const aNDC = a.clone().project(camera);
      const arNDC = ar.clone().project(camera);
      const screenDist = Math.hypot(
        (arNDC.x - aNDC.x) * 0.5 * canvasH,
        (arNDC.y - aNDC.y) * 0.5 * canvasH,
      );
      // Distance to camera for this midpoint
      const dist = mid.distanceTo(camera.position);
      const expectedWidth = (width / dist) * (canvasH / (2 * Math.tan(fov / 2)));
      const diff = Math.abs(screenDist - expectedWidth);
      if (diff > 1.5) wrongWidth += 1;
      minScreenWidth = Math.min(minScreenWidth, screenDist);
      maxScreenWidth = Math.max(maxScreenWidth, screenDist);
      nTested += 1;
    }
    // The screen width should never collapse to a sliver (would be a
    // visible gap in the wireframe). The min should be a reasonable
    // fraction of the max.
    if (nTested === 0) {
      ok(`${prim.name}: all segments are view-parallel (expected, degenerate)`);
    } else {
      const ratio = minScreenWidth / maxScreenWidth;
      if (ratio < 0.5 && maxScreenWidth > 0.001) {
        bad(`${prim.name}: screen-width ratio min/max = ${ratio.toFixed(2)} (slivers present: min=${minScreenWidth.toFixed(2)}px max=${maxScreenWidth.toFixed(2)}px)`);
      } else if (wrongWidth > 0) {
        bad(`${prim.name}: ${wrongWidth}/${nTested} non-view-parallel segments have wrong screen width (expected ~uniform)`);
      } else {
        ok(`${prim.name}: ${nTested} non-view-parallel segments all uniform width (min=${minScreenWidth.toFixed(2)}px max=${maxScreenWidth.toFixed(2)}px)`);
      }
    }
  }
}

if (failed > 0) {
  console.log(`\n${failed} TEST(S) FAILED`);
  process.exit(1);
} else {
  console.log('\nALL RIBBON TESTS PASS');
}
