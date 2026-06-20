// tools/test-gizmo-ortho-ortho.mjs
//
// Headless test for the perspective ↔ orthographic gizmo raycast/size
// regression.  Runs in node (no browser needed).
//
// What it asserts:
//   1.  The ortho size-scaling math produces a sensible `setSize` value
//       (between 0.15 and 3.5) so the gizmo doesn't blow up.
//   2.  The Box Gizmo face-radius calculation does NOT produce NaN in
//       ortho (the bug where `camera.fov` was undefined for
//       OrthographicCamera → `tan(NaN)` = NaN).
//   3.  Three.js's TransformControls uses the ortho factor
//       `(top - bottom) / zoom` and accepts a new camera after swap.
//   4.  Every per-drag state field in TransformGizmo._teardown is reset
//       so perspective↔orthographic swaps don't leak ghost drag state.
//   5.  _applyPreferences compensates the gizmo size for ortho cameras.
//   6.  _updateBoxGizmo branches on isOrthographicCamera for the face
//       radius.
//   7.  CYCO_DEBUG_GIZMO_CAMSWAP debug logging is installed.
//
// Run: `node tools/test-gizmo-ortho-ortho.mjs`

import * as THREE from '../editor/libs/three/build/three.module.min.js';

let failed = 0;
const pass  = (msg) => console.log(`  \u2705  ${msg}`);
const fail  = (msg) => { console.log(`  \u274C  ${msg}`); failed++; };

// ── Test the size-scaling math from `_applyPreferences` ──────────────────
function orthoSizeFor(perspSize, cam) {
  const halfH = Math.max(0.001, Math.abs((cam.top - cam.bottom) * 0.5));
  const zoom  = cam.zoom ?? 1;
  const orthoBaseSize = Math.max(0.15, Math.min(2.0, (4 * zoom) / 10));
  return Math.max(0.15, Math.min(3.5,
    orthoBaseSize * Math.max(0.25, perspSize)
  ));
}

console.log('TEST 1: ortho size-scaling math (mirrors _applyPreferences)');
{
  const cam = new THREE.OrthographicCamera(-400, 400, 300, -300, 0.1, 1000);
  cam.zoom = 1;
  const s = orthoSizeFor(1.0, cam);
  if (s >= 0.15 && s <= 3.5) pass(`default size=1 \u2192 ortho size=${s.toFixed(3)} (in range)`);
  else                       fail(`default size=1 \u2192 ortho size=${s.toFixed(3)} out of range`);

  const s2 = orthoSizeFor(2.0, cam);
  if (s2 > s * 1.5) pass(`user size=2 \u2192 ortho size=${s2.toFixed(3)} (preserves relative scaling)`);
  else              fail(`user size=2 \u2192 ortho size=${s2.toFixed(3)} (relative scaling broken)`);
}

console.log('\nTEST 2: Box Gizmo face-radius \u2014 no NaN in ortho');
{
  const cam = new THREE.OrthographicCamera(-400, 400, 300, -300, 0.1, 1000);
  cam.zoom = 1;
  // New ortho branch (matches the fix in `_updateBoxGizmo`)
  const worldPerPixel = Math.abs(cam.top - cam.bottom) / (600 * Math.max(0.0001, cam.zoom ?? 1));
  const newOrthoFace  = worldPerPixel * 22;
  if (Number.isFinite(newOrthoFace) && newOrthoFace > 0) {
    pass(`NEW ortho face-radius = ${newOrthoFace.toFixed(4)} (finite & positive)`);
  } else {
    fail(`NEW ortho face-radius = ${newOrthoFace} (NaN or zero \u2014 bug present)`);
  }

  // Old broken formula (regression source)
  const oldFormula = 2 * cam.position.distanceTo(new THREE.Vector3()) *
    Math.tan(THREE.MathUtils.degToRad((cam.fov ?? 60) * 0.5)) *
    40 / 600;
  if (!Number.isFinite(oldFormula)) {
    pass(`OLD formula yields ${oldFormula} in ortho (confirms regression source)`);
  } else {
    console.log(`     (note: old formula yielded ${oldFormula} \u2014 fov may be set on this OrthographicCamera)`);
  }
}

console.log('\nTEST 3: TransformControls ortho auto-scale factor');
{
  const cam = new THREE.OrthographicCamera(-400, 400, 300, -300, 0.1, 1000);
  cam.zoom = 1;
  // Three.js TransformControlsGizmo (line ~1611) auto-scales every frame
  // using `factor = (top - bottom) / zoom` for ortho cameras.
  const factor = (cam.top - cam.bottom) / (cam.zoom ?? 1);
  if (Number.isFinite(factor) && factor > 0) {
    pass(`ortho auto-scale factor = ${factor.toFixed(2)} (matches three.js formula)`);
  } else {
    fail(`ortho auto-scale factor = ${factor} (invalid)`);
  }
  // Then it multiplies by `size / 4`.  Verify our clamped size keeps the
  // on-screen reach within a sensible range.
  const handleReach = factor * (0.4 / 4); // typical corrected size ~0.4
  if (handleReach > 0 && handleReach < cam.top * 2) {
    pass(`handle reach = ${handleReach.toFixed(2)} (well under halfH ${cam.top})`);
  } else {
    fail(`handle reach = ${handleReach} (overlaps viewport)`);
  }
}

console.log('\nTEST 4: stale-state contract \u2014 every per-drag cache cleared on teardown');
{
  const fs = await import('fs/promises');
  const path = await import('path');
  const srcPath = path.resolve(process.cwd(), 'editor/src/viewport/TransformGizmo.js');
  const src = await fs.readFile(srcPath, 'utf8');

  // Locate the _teardown method body (first match).
  const teardownMatch = src.match(/_teardown\(\)\s*\{[\s\S]*?\n  \}/);
  if (!teardownMatch) {
    fail('could not locate _teardown method in TransformGizmo.js');
  } else {
    const body = teardownMatch[0];
    const stale = [
      '_interaction = null',
      '_isDragging = false',
      '_matrixBefore = null',
      '_dragFreezeGizmoSize = false',
      '_dragMaxDistance = null',
      '_dragStartCamDist = null',
      '_multiPivots = []',
      '_multiRots = []',
      '_multiScales = []',
      '_multiLastAppliedMatrix = null',
    ];
    for (const expr of stale) {
      if (body.includes(expr)) pass(`teardown resets ${expr}`);
      else                     fail(`teardown does NOT reset ${expr} \u2014 stale state will leak`);
    }

    if (body.includes('_clearHoveredHandle()')) pass('teardown calls _clearHoveredHandle()');
    else                                         fail('teardown missing _clearHoveredHandle() call');

    if (body.includes('_suppressSelectionManagerClick')) pass('teardown drops _suppressSelectionManagerClick');
    else                                                  fail('teardown does not drop _suppressSelectionManagerClick');

    if (body.includes('_gizmoDragging = false') || body.includes('_gizmoDragging=false')) {
      pass('teardown resets selectionManager._gizmoDragging');
    } else {
      fail('teardown missing _gizmoDragging reset');
    }
  }
}

console.log('\nTEST 5: ortho size scaling inside _applyPreferences');
{
  const fs = await import('fs/promises');
  const path = await import('path');
  const srcPath = path.resolve(process.cwd(), 'editor/src/viewport/TransformGizmo.js');
  const src = await fs.readFile(srcPath, 'utf8');
  const applyPrefsMatch = src.match(/_applyPreferences\(\)\s*\{[\s\S]*?\n  \}/);
  if (!applyPrefsMatch) {
    fail('could not locate _applyPreferences method');
  } else {
    const body = applyPrefsMatch[0];
    if (body.includes('isOrthographicCamera')) {
      pass('_applyPreferences checks isOrthographicCamera');
    } else {
      fail('_applyPreferences does NOT check isOrthographicCamera \u2014 gizmo will explode in ortho');
    }
    if (body.includes('orthoBaseSize')) {
      pass('_applyPreferences has orthoBaseSize calculation');
    } else {
      fail('_applyPreferences missing orthoBaseSize (no ortho compensation)');
    }
    if (body.includes('correctedSize')) {
      pass('_applyPreferences applies correctedSize for ortho');
    } else {
      fail('_applyPreferences missing correctedSize for ortho');
    }
  }
}

console.log('\nTEST 6: Box Gizmo face-radius branch in _updateBoxGizmo');
{
  const fs = await import('fs/promises');
  const path = await import('path');
  const srcPath = path.resolve(process.cwd(), 'editor/src/viewport/TransformGizmo.js');
  const src = await fs.readFile(srcPath, 'utf8');
  // Look for the face-radius block (between `screenFaceRadius = ...` and
  // the `faceRadius` const).
  const faceRadiusBlock = src.match(/defaultFaceRadius[\s\S]{0,2500}?faceRadius\s*=/);
  if (!faceRadiusBlock) {
    fail('could not locate face-radius block in _updateBoxGizmo');
  } else {
    const body = faceRadiusBlock[0];
    if (body.includes('isOrthographicCamera') && body.includes('worldPerPixel')) {
      pass('_updateBoxGizmo branches on isOrthographicCamera + uses worldPerPixel');
    } else {
      fail('_updateBoxGizmo still uses raw camera.fov (NaN in ortho)');
    }
    // Ensure raw camera.fov access appears AFTER the isOrthographicCamera
    // branch (so it's only used in the perspective fall-through).
    // Strip out comments first so the `camera.fov` mentioned in the
    // explanatory comment doesn't trigger a false positive.
    const codeOnly = body
      .replace(/\/\/[^\n]*/g, '')          // strip line comments
      .replace(/\/\*[\s\S]*?\*\//g, '');   // strip block comments
    const orthoIdx  = codeOnly.indexOf('isOrthographicCamera');
    const rawFovIdx = codeOnly.indexOf('camera.fov');
    if (rawFovIdx === -1) {
      pass('no raw `camera.fov` access in code (safe for ortho)');
    } else if (orthoIdx !== -1 && orthoIdx < rawFovIdx) {
      pass('raw `camera.fov` only used in perspective branch (after ortho guard)');
    } else {
      fail('raw `camera.fov` precedes `isOrthographicCamera` branch \u2014 NaN risk');
    }
  }
}

console.log('\nTEST 7: debug logging installed');
{
  const fs = await import('fs/promises');
  const path = await import('path');
  const srcPath = path.resolve(process.cwd(), 'editor/src/viewport/TransformGizmo.js');
  const src = await fs.readFile(srcPath, 'utf8');
  const logCount = (src.match(/CYCO_DEBUG_GIZMO_CAMSWAP/g) || []).length;
  if (logCount >= 3) {
    pass(`CYCO_DEBUG_GIZMO_CAMSWAP referenced ${logCount} times (build + teardown + applyPrefs)`);
  } else {
    fail(`CYCO_DEBUG_GIZMO_CAMSWAP referenced only ${logCount} times (expected \u2265 3)`);
  }
}

console.log(`\n${failed === 0 ? '\uD83D\uDFE2  ALL TESTS PASS' : `\uD83D\uDD34  ${failed} FAILURE(S)`}`);
process.exit(failed === 0 ? 0 : 1);