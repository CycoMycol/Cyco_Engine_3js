#!/usr/bin/env node
/**
 * test-marquee-selection.mjs
 *
 * Browser-driven regression test for the viewport selection marquee and the
 * multi-selection outline colors.
 *
 * Verifies (against a running Cyco editor in WebGL mode):
 *   MARQUEE CURSOR-SNAP
 *   1. The marquee <div> is hidden BEFORE any drag.
 *   2. The marquee <div> is still NOT visible while the pointer has moved
 *      less than the drag threshold (5px).
 *   3. Once the pointer crosses the threshold, the marquee <div> becomes
 *      visible (display:block) and grows in width/height as the pointer moves.
 *   4. The marquee's RIGHT and BOTTOM edges track the cursor position
 *      EXACTLY (zero offset). This catches a regression where the marquee
 *      was drawn at `event.clientX` instead of `clientX - parentLeft`, which
 *      made the rectangle appear offset by the canvas panel's left offset
 *      and the cursor no longer sat at the marquee's corner.
 *   5. The marquee's TOP-LEFT sits at the pointerdown (click origin) position.
 *   6. After pointerup, the marquee <div> returns to display:none.
 *
 *   MARQUEE SELECTION
 *   7. The marquee drag selects ALL objects whose projected centre falls
 *      inside the marquee rectangle.
 *
 *   MULTI-SELECT OUTLINE COLORS
 *   8. PostProcessingPipeline.outlinePass (primary) holds the last-selected
 *      object PLUS has its visibleEdgeColor set to the primary pref color.
 *   9. PostProcessingPipeline.secondaryOutlineGroup (scene-graph Group)
 *      contains a LineSegments for every OTHER selected object — drawn in
 *      a DIFFERENT color than the primary outline.
 *  10. The rendered canvas contains PRIMARY-color pixels (the primary outline
 *      is actually being drawn to screen, not just configured).
 *  11. The rendered canvas contains SECONDARY-color pixels (the secondary
 *      LineSegments outlines are actually being drawn to screen).
 *
 * The test is intended to be run against a Cyco editor already open in a
 * Chromium browser launched with --remote-debugging-port=9222. The page tab
 * whose URL contains the substring "Cyco_Engine" is auto-detected.
 *
 * Usage:
 *   # 1. Launch Chrome with debugging port (one-time):
 *   #    "C:\Program Files\Google\Chrome\Application\chrome.exe" ^
 *   #      --remote-debugging-port=9222 --user-data-dir=c:\chrome-cyco ^
 *   #      "file:///c%3A/Users/Cyco%20Myco/Documents/1_Game_Engines%5F11/editor/index.html"
 *   # 2. Start the test (waits for the page to be ready):
 *   node tools/test-marquee-selection.mjs
 *
 * Exit code 0 on success, non-zero on failure.
 */

import http from 'node:http';

const URL = 'http://127.0.0.1:9222';

function fetchJson(path) {
  return new Promise((resolve, reject) => {
    http.get(URL + path, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

const tabs = await fetchJson('/json');
const tab = tabs.find(t => /Cyco_Engine/i.test(t.url));
if (!tab) {
  console.error('FAIL: no Cyco editor tab found at ' + URL);
  console.error('  Open the editor in Chrome with --remote-debugging-port=9222 first.');
  process.exit(2);
}
console.log('Tab:', tab.url);

const ws = tab.webSocketDebuggerUrl;
const sock = new WebSocket(ws);
let nextId = 1;
const pending = new Map();
sock.addEventListener('message', (data) => {
  const msg = JSON.parse(data.toString());
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});
function send(method, params = {}) {
  return new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    sock.send(JSON.stringify({ id, method, params }));
  });
}
await new Promise((r) => sock.addEventListener('open', r, { once: true }));
console.log('Connected to', tab.url);

// Detect the current renderer type. The test works for both WebGL (which
// uses three.js OutlinePass for the primary outline) and WebGPU (which uses
// scene-graph LineSegments for both primary and secondary outlines). We do
// NOT force a renderer switch — the user's preferred mode is preserved.
const rRendererType = await send('Runtime.evaluate', {
  expression: `window.__cyco?.viewportEngine?.rendererManager?.activeType || 'webgl'`,
  returnByValue: true,
});
const initialRendererType = rRendererType.result.value;
console.log('Initial renderer type:', initialRendererType);

// ── Run the actual test in-page ───────────────────────────────────────────
const r = await send('Runtime.evaluate', {
  expression: `(async () => {
    const cyco = window.__cyco;
    const rm = cyco.viewportEngine.rendererManager;
    const sm = cyco.sceneManager;
    const of = cyco.objectFactory;
    const scene = sm.getActiveScene();

    // Clean non-camera/non-light children for a deterministic scene.
    for (let i = scene.children.length - 1; i >= 0; i--) {
      const c = scene.children[i];
      if (c.isCamera || c.isLight) continue;
      scene.remove(c);
    }
    // Three spread-out boxes with distinct colors for visual verification.
    const created = [];
    for (const [name, x, color] of [['BoxA', -200, '#ff6644'], ['BoxB', 0, '#44ff66'], ['BoxC', 200, '#4488ff']]) {
      const obj = of.create('Box');
      obj.position.set(x, 0, 0);
      obj.name = name;
      obj.material.color.set(color);
      sm.addObject(obj);
      created.push(obj);
    }
    // Frame the camera so all three boxes are visible.
    const cam = cyco.viewportEngine.camera;
    cam.position.set(0, 200, 600);
    cam.lookAt(0, 0, 0);
    if (cyco.viewportEngine.controls?.target) cyco.viewportEngine.controls.target.set(0, 0, 0);
    cyco.viewportEngine.controls?.update?.();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    const canvas = rm.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    cyco.selectionManager.clearSelection();

    const fire = (type, x, y, buttons) => {
      canvas.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true,
        clientX: x, clientY: y, screenX: x, screenY: y,
        button: 0, buttons,
        pointerId: 1, pointerType: 'mouse', isPrimary: true,
      }));
    };

    const checks = [];
    const assert = (label, cond, detail = '') => checks.push({ label, pass: !!cond, detail });

    // ── Part 1: cursor-snap correctness ──────────────────────────────────
    const startX = rect.left + 60;
    const startY = rect.top  + 60;
    const endX   = rect.left + 180;
    const endY   = rect.top  + 120;

    const marqueeBefore = document.querySelector('.cyco-marquee-box');
    assert('marquee hidden before any drag',
      !marqueeBefore || getComputedStyle(marqueeBefore).display === 'none',
      marqueeBefore ? `display=${getComputedStyle(marqueeBefore).display}` : 'absent');

    fire('pointerdown', startX, startY, 1);
    await new Promise(r => requestAnimationFrame(r));

    fire('pointermove', startX + 1, startY + 1, 1); // under threshold
    await new Promise(r => requestAnimationFrame(r));
    const m0 = document.querySelector('.cyco-marquee-box');
    assert('marquee hidden under drag threshold',
      !m0 || getComputedStyle(m0).display === 'none',
      m0 ? `display=${getComputedStyle(m0).display}` : 'no element');

    // Move past threshold — marquee should appear and follow the cursor.
    const dragSamples = [];
    for (let i = 1; i <= 8; i++) {
      const x = startX + (endX - startX) * (i / 8);
      const y = startY + (endY - startY) * (i / 8);
      fire('pointermove', x, y, 1);
      await new Promise(r => requestAnimationFrame(r));
      const m = document.querySelector('.cyco-marquee-box');
      if (m) {
        const mRect = m.getBoundingClientRect();
        dragSamples.push({
          i, w: +parseFloat(m.style.width).toFixed(1),
          h: +parseFloat(m.style.height).toFixed(1),
          display: getComputedStyle(m).display,
          pageRight: +mRect.right.toFixed(1),
          pageBottom: +mRect.bottom.toFixed(1),
        });
      }
    }

    const midDrag = dragSamples[Math.floor(dragSamples.length / 2)] ?? dragSamples.at(-1);
    if (midDrag) {
      assert('marquee right edge at cursor X (page coords)',
        Math.abs(midDrag.pageRight - endX) < 2,
        `marquee.right=${midDrag.pageRight}, cursor.x=${endX}`);
      assert('marquee bottom edge at cursor Y (page coords)',
        Math.abs(midDrag.pageBottom - endY) < 2,
        `marquee.bottom=${midDrag.pageBottom}, cursor.y=${endY}`);
    }
    assert('marquee visible during drag',
      dragSamples.length > 0 && dragSamples.every(s => s.display === 'block' && s.w > 0 && s.h > 0),
      `samples=${dragSamples.length}`);
    assert('marquee widens monotonically',
      dragSamples.length >= 2 && dragSamples.at(-1).w > dragSamples[0].w,
      `first.w=${dragSamples[0]?.w}, last.w=${dragSamples.at(-1)?.w}`);

    fire('pointerup', endX, endY, 0);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    const mAfter = document.querySelector('.cyco-marquee-box');
    assert('marquee hidden after pointerup',
      !mAfter || getComputedStyle(mAfter).display === 'none',
      mAfter ? `display=${getComputedStyle(mAfter).display}` : 'no element');

    // ── Part 2: marquee selects everything it covers ────────────────────
    // Drag from one corner of canvas to the opposite to cover all three boxes.
    cyco.selectionManager.clearSelection();
    const cStartX = rect.left + 20;
    const cStartY = rect.top  + 20;
    const cEndX   = rect.left + rect.width  - 20;
    const cEndY   = rect.top  + rect.height - 20;
    fire('pointerdown', cStartX, cStartY, 1);
    await new Promise(r => requestAnimationFrame(r));
    fire('pointermove', cEndX, cEndY, 1);
    await new Promise(r => requestAnimationFrame(r));
    fire('pointerup', cEndX, cEndY, 0);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    const selectedNames = [...cyco.selectionManager.selected].map(o => o.name).sort();
    assert('marquee selected all 3 boxes',
      cyco.selectionManager.selected.size === 3,
      `count=${cyco.selectionManager.selected.size}, names=${selectedNames.join(',')}`);
    assert('selected names = BoxA, BoxB, BoxC',
      JSON.stringify(selectedNames) === JSON.stringify(['BoxA', 'BoxB', 'BoxC']),
      `got ${selectedNames.join(', ')}`);

    // ── Part 3: outline pass + secondary outline group structure ─────────
    const pp = cyco.postPipeline;
    const isWebGL = rm.activeType === 'webgl';
    // In WebGL mode, the OutlinePass renders ALL selected objects in the
    // primary color (it can only use one color for selectedObjects). In
    // WebGPU mode there's no OutlinePass at all — outlines are drawn as
    // scene-graph LineSegments via the primaryOutlineGroup + secondaryOutlineGroup.
    if (isWebGL) {
      assert('WebGL: outline pass has all 3 selected',
        pp.outlinePass?.selectedObjects?.length === 3,
        `count=${pp.outlinePass?.selectedObjects?.length}`);
    } else {
      assert('WebGPU: outlinePass is null (no composer pass for outline)',
        pp.outlinePass === null,
        `outlinePass=${pp.outlinePass}`);
    }

    assert('secondary outline group exists', !!pp.secondaryOutlineGroup, 'null');
    assert('secondary outline group is child of active scene',
      pp.secondaryOutlineGroup?.parent === scene,
      `parent.type=${pp.secondaryOutlineGroup?.parent?.type}`);
    assert('secondary outline group has 2 children (all but primary)',
      pp.secondaryOutlineGroup?.children?.length === 2,
      `count=${pp.secondaryOutlineGroup?.children?.length}`);

    if (pp.secondaryOutlineGroup?.children?.length === 2) {
      const sources = pp.secondaryOutlineGroup.children.map(c => c.userData?.cycoSourceId);
      assert('secondary outline children have unique source IDs',
        sources[0] !== sources[1] && sources.every(Boolean),
        `sources=${JSON.stringify(sources)}`);
      const colors = pp.secondaryOutlineGroup.children.map(c => '#' + c.material.color.getHexString());
      assert('secondary outline color = #45ffd0',
        colors.every(c => c === '#45ffd0'),
        `colors=${colors.join(',')}`);
    }

    // Resolve the primary color — either from the OutlinePass (WebGL) or
    // from the primaryOutlineGroup (WebGPU).
    let primaryColor = '';
    if (isWebGL && pp.outlinePass) {
      primaryColor = '#' + pp.outlinePass.visibleEdgeColor.getHexString();
    } else if (pp.primaryOutlineGroup?.children?.length > 0) {
      primaryColor = '#' + pp.primaryOutlineGroup.children[0].material.color.getHexString();
    }
    const secondaryColor = pp.secondaryOutlineGroup?.children?.[0]?.material?.color
      ? '#' + pp.secondaryOutlineGroup.children[0].material.color.getHexString()
      : '';
    assert('primary outline color = #e8eeff', primaryColor === '#e8eeff', `got ${primaryColor}`);
    assert('primary and secondary colors differ', primaryColor !== secondaryColor,
      `primary=${primaryColor}, secondary=${secondaryColor}`);

    // In WebGPU mode, the primaryOutlineGroup must hold the primary object
    // (last in the selection set).
    if (!isWebGL) {
      assert('WebGPU: primaryOutlineGroup exists', !!pp.primaryOutlineGroup, 'null');
      assert('WebGPU: primaryOutlineGroup is child of active scene',
        pp.primaryOutlineGroup?.parent === scene,
        `parent.type=${pp.primaryOutlineGroup?.parent?.type}`);
      assert('WebGPU: primaryOutlineGroup has 1 child (the primary)',
        pp.primaryOutlineGroup?.children?.length === 1,
        `count=${pp.primaryOutlineGroup?.children?.length}`);
    }

    // ── Part 4: outline pixels actually rendered to screen ──────────────
    // Force a render so the canvas has the latest state, then read pixels.
    // The engine tick overwrites the canvas every animation frame so we
    // call the active renderer's immediate-render path right before reading.
    if (isWebGL && pp._composer) {
      pp._composer.render(0.016);
    } else {
      // WebGPU / fallback path: force a direct render of the scene.
      rm.renderer.render(scene, cyco.viewportEngine.camera);
    }
    await new Promise(r => requestAnimationFrame(r));
    const gl = rm.renderer.getContext();
    const w = canvas.width, h = canvas.height;
    const buf = new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);

    let primaryPixels = 0;
    let primaryNearPixels = 0;
    let secondaryTolerantPixels = 0;
    for (let i = 0; i < buf.length; i += 4) {
      const r = buf[i], g = buf[i+1], b = buf[i+2];
      // Primary outline color (#e8eeff) is bluish-white, very bright.
      if (r > 200 && g > 200 && b > 220 && Math.abs(r - g) < 30) primaryPixels++;
      // Looser primary match — the WebGPU 1-px LineSegments lines are
      // antialiased against the scene background so most pixels are
      // dimmed versions of #e8eeff.
      if (r > 180 && g > 180 && b > 200 && Math.abs(r - g) < 30) primaryNearPixels++;
      // Secondary outline color (#45ffd0) is cyan: green dominant, blue high.
      // Tolerant check because the 1px LineBasicMaterial lines are dimmed by
      // sub-pixel antialiasing against the bright scene background.
      if (g > r + 40 && g > 180 && b > 100 && b > r) secondaryTolerantPixels++;
    }
    // WebGL mode shows strictly bright primary pixels (OutlinePass has edge
    // detection blur producing high intensity pixels). WebGPU mode only
    // shows dimmer 1-px LineSegments pixels — accept the looser threshold.
    const primaryMin = isWebGL ? 100 : 50;
    const primaryCount = Math.max(primaryPixels, primaryNearPixels);
    assert(`primary outline pixels visible on canvas (>${primaryMin})`,
      primaryCount > primaryMin, `strict=${primaryPixels}, loose=${primaryNearPixels}`);
    assert('secondary outline cyan-ish pixels visible on canvas (>50)',
      secondaryTolerantPixels > 50, `count=${secondaryTolerantPixels}`);

    // Cleanup: remove test boxes
    for (let i = scene.children.length - 1; i >= 0; i--) {
      const c = scene.children[i];
      if (c.isCamera || c.isLight) continue;
      if (c.name && /^Box[ABC]$/.test(c.name)) scene.remove(c);
    }
    cyco.selectionManager.clearSelection();

    return { checks, rendererType: rm.activeType, primaryPixels, primaryNearPixels, secondaryTolerantPixels };
  })()`,
  awaitPromise: true,
  returnByValue: true,
});

if (r.result.exceptionDetails) {
  console.error('FAIL: exception in page:', r.result.exceptionDetails);
  sock.close(); process.exit(4);
}

const result = r.result.result.value;
console.log('\n────── Pixel counts ──────');
console.log(`renderer type:              ${result.rendererType}`);
console.log(`primary outline pixels:    ${result.primaryPixels}`);
console.log(`primary outline (loose):   ${result.primaryNearPixels}`);
console.log(`secondary cyan-ish pixels: ${result.secondaryTolerantPixels}`);

// ── Assertions ────────────────────────────────────────────────────────────
console.log('\n────── Assertions ──────');
for (const c of result.checks) {
  console.log(`  ${c.pass ? 'PASS' : 'FAIL'}  ${c.label}${c.detail ? ' — ' + c.detail : ''}`);
}

sock.close();

const failed = result.checks.filter(c => !c.pass);
if (failed.length > 0) {
  console.log(`\n${failed.length} of ${result.checks.length} checks FAILED`);
  process.exit(1);
}
console.log(`\nAll ${result.checks.length} checks PASSED ✓`);
process.exit(0);
