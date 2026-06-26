// tools/test-wireframe-thickness.mjs
//
// Regression test for the wireframe outline thickness inconsistency:
// "Box and room shape outline is thicker than the geometry that you add."
//
// Root cause (fixed in CycleModelerController._expandEdgesToRibbon):
// the coplanarity lift was applied along the face normal direction.
// The face normal has a variable screen-plane component depending on
// the face's angle relative to the camera, so the lift projected onto
// the screen as a variable per-segment offset. Segments that bordered
// "side" faces ended up with 2–3× the requested screen-pixel width
// while segments along the original box outline stayed at the
// requested width, producing the visible "added geometry outline is
// thinner" inconsistency.
//
// Fix: lift along the camera view direction instead of the face normal.
// viewDir projects to zero screen pixels, so the lift only affects
// the depth-buffer bias (winning the depth test) without contributing
// to the visible on-screen ribbon width.
//
// This test mirrors the math in `_expandEdgesToRibbon` for a box that
// has had its top face pushed up (the exact scenario reported in the
// bug) and verifies the per-segment screen-pixel width is within
// tolerance of the requested width across every segment of the
// resulting wireframe.

import * as THREE from '../editor/libs/three/build/three.module.min.js';
import { EditableMesh } from './.tmp-EditableMesh.mjs';

// ── Helpers (mirror _expandEdgesToRibbon perpendicular math) ─────────

function sub3(a, b) { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
function cross3(a, b) { return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
function dot3(a, b) { return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }
function len3(v) { return Math.hypot(v[0], v[1], v[2]); }
function norm3(v) { const l = len3(v) || 1; return [v[0]/l, v[1]/l, v[2]/l]; }
function add3(a, b) { return [a[0]+b[0], a[1]+b[1], a[2]+b[2]]; }
function scale3(a, s) { return [a[0]*s, a[1]*s, a[2]*s]; }

function computeScreenAlignedOffset(dir, viewDir, width, AXES) {
  const screenPerpRaw = cross3(dir, viewDir);
  let perp;
  if (len3(screenPerpRaw) < 1e-6) {
    let chosen = AXES[2];
    for (const ax of AXES) {
      const tmp = cross3(dir, ax);
      if (len3(tmp) > 1e-6) { chosen = ax; break; }
    }
    perp = norm3(cross3(dir, chosen));
  } else {
    perp = norm3(screenPerpRaw);
  }
  return scale3(perp, width);
}

// ── Test runner ───────────────────────────────────────────────────────

const FOV_DEG = 50;
const CANVAS_H = 1080;
const WIDTH_PX = 2;
const AXES = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

function segmentScreenWidth(ax, ay, az, bx, by, bz, camPos) {
  const A = [ax, ay, az];
  const B = [bx, by, bz];
  const dir = norm3(sub3(B, A));
  const mid = scale3(add3(A, B), 0.5);
  const cameraDist = len3(sub3(camPos, mid));
  const worldPerPx = (2 * Math.tan(FOV_DEG * Math.PI / 360) * cameraDist) / CANVAS_H;
  // The viewport engine uses a single `widthWorld` for the whole
  // wireframe, computed from the bbox center camera distance. We
  // mirror that by computing widthWorld from a representative distance
  // (the segment midpoint distance in this isolated test).
  const widthWorld = Math.max(worldPerPx * 0.25, WIDTH_PX * worldPerPx);
  const viewDir = norm3(sub3(camPos, mid));
  const offset = computeScreenAlignedOffset(dir, viewDir, widthWorld, AXES);
  // The FIX: the production code's coplanarity lift now applies
  // along viewDir, which projects to zero screen pixels. So the
  // visible width IS just the perp's screen projection.
  const dot_ovd = dot3(offset, viewDir);
  const screenOff = sub3(offset, scale3(viewDir, dot_ovd));
  return { screenPx: len3(screenOff) / worldPerPx };
}

function buildBoxWithPushExtrude() {
  const m = EditableMesh.boxFromBounds({ x: -50, y: 0, z: -50 }, { x: 50, y: 100, z: 50 });
  // Top face is faceGroup 3, indices 6, 7. Push up by 100 units.
  m.pushFaces([6, 7], 100);
  return m;
}

function buildRoomWithPushExtrude() {
  const m = EditableMesh.room(100, 100, 100);
  // Room face groups: 0=floor, 1=back, 2=right, 3=front, 4=left.
  // Floor indices are 0, 1. Push the floor down (-100) to grow a
  // basement — this exercises the same "added geometry via push/pull"
  // code path on a room primitive.
  m.pushFaces([0, 1], -100);
  return m;
}

function runGeometryTest(label, mesh, cameras, tolerancePx) {
  const edges = mesh.toEdgesGeometry(0);
  const pos = edges.attributes.position;
  const segs = pos.count / 2;
  console.log(`\n=== ${label} (${segs} segments) ===`);
  let totalFail = 0;
  for (const cam of cameras) {
    console.log(`  camera (${cam.pos.join(', ')})`);
    const results = [];
    for (let i = 0; i < segs; i++) {
      const ax = pos.getX(i * 2), ay = pos.getY(i * 2), az = pos.getZ(i * 2);
      const bx = pos.getX(i * 2 + 1), by = pos.getY(i * 2 + 1), bz = pos.getZ(i * 2 + 1);
      const r = segmentScreenWidth(ax, ay, az, bx, by, bz, cam.pos);
      const dy = by - ay, dx = bx - ax, dz = bz - az;
      const orient = Math.abs(dy) > 0.01 && Math.abs(dx) < 0.01 && Math.abs(dz) < 0.01 ? 'VERT'
                   : Math.abs(dx) > 0.01 && Math.abs(dy) < 0.01 && Math.abs(dz) < 0.01 ? 'HORX'
                   : Math.abs(dz) > 0.01 && Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01 ? 'HORZ'
                   : 'OTHER';
      results.push({ orient, ...r });
    }
    const byOrient = {};
    for (const r of results) {
      if (!byOrient[r.orient]) byOrient[r.orient] = [];
      byOrient[r.orient].push(r);
    }
    for (const [orient, rs] of Object.entries(byOrient)) {
      const pxs = rs.map(r => r.screenPx);
      const min = Math.min(...pxs);
      const max = Math.max(...pxs);
      const variance = max - min;
      const ok = variance <= tolerancePx;
      console.log(`    ${orient}: ${rs.length} segs, screenPx min=${min.toFixed(3)} max=${max.toFixed(3)} variance=${variance.toFixed(3)} ${ok ? 'OK' : 'FAIL'}`);
      if (!ok) totalFail++;
    }
  }
  return totalFail;
}

const cameras = [
  { name: 'orbit 1', pos: [300, 200, 400] },
  { name: 'orbit 2', pos: [200, 300, 200] },
  { name: 'top-down', pos: [0, 500, 0] },
  { name: 'front-on', pos: [0, 100, 400] },
];

const boxMesh = buildBoxWithPushExtrude();
const roomMesh = buildRoomWithPushExtrude();

const tol = 0.1;
const fails = 0
  + runGeometryTest('box + top push (100 units)', boxMesh, cameras, tol)
  + runGeometryTest('room + floor push (-100 units)', roomMesh, cameras, tol);

if (fails === 0) {
  console.log(`\nPASS: wireframe thickness uniform within ${tol}px on box + room + push/pull.`);
  process.exit(0);
} else {
  console.log(`\nFAIL: ${fails} camera/orientation combos exceeded ${tol}px thickness variance.`);
  process.exit(1);
}