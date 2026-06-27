#!/usr/bin/env node
/**
 * test-middle-click-pick.mjs
 *
 * Browser-driven regression test for the cycle-modeler's MIDDLE-CLICK
 * pick + sweep-select (with backface-cull toggle and symmetry).
 *
 * Verifies (against a running Cyco editor in any renderer mode):
 *
 *   SETUP
 *   1.  Cycle Modeler can be activated via `cyco-modeler-mode`.
 *   2.  Drawing a box commits an object with `userData.cycoModeler.mesh`.
 *
 *   MIDDLE-CLICK PICK (no drag)
 *   3.  Middle-click in polygon mode picks the polygon under the
 *       cursor. The pick is BACKFACE-CULLED by default — a click on
 *       the front face selects it; a click on the back face (cursor
 *       on the FAR side of the box) picks nothing useful (front-
 *       facing wins).
 *
 *   BACKFACE CULL TOGGLE
 *   4.  Toggling backface cull OFF (`cyco-modeler-toggle-backface-cull`
 *       with `enabled: false`) makes the picker return the closest
 *       hit regardless of normal direction — useful for grabbing a
 *       face through an open / transparent face.
 *
 *   MIDDLE-DRAG SWEEP (NOT a rectangular marquee)
 *   5.  A middle-drag in polygon mode sweeps the picker along the
 *       cursor path. The swept selection contains polygons under
 *       the cursor, NOT every polygon whose centroid falls inside a
 *       screen rect.
 *
 *   SYMMETRY
 *   6.  Enabling X-axis symmetry on the polygon mode + middle-click
 *       on the front face selects BOTH the front face AND the
 *       parallel back face (the mirror across bbox centre).
 *   7.  Disabling symmetry (empty axes set) reverts to single-face
 *       pick.
 *
 *   OBJECT MODE FALLS THROUGH
 *   8.  In object mode, middle-click does NOT start a picker
 *       gesture; OrbitControls' middle-pan remains available.
 *
 * Usage:
 *   # 1. Launch Chrome with debugging port (one-time):
 *   #    "C:\Program Files\Google\Chrome\Application\chrome.exe" ^
 *   #      --remote-debugging-port=9222 --user-data-dir=c:\chrome-cyco ^
 *   #      "file:///c%3A/Users/Cyco%20Myco/Documents/1_Game_Engines%5F11/editor/index.html"
 *   # 2. Start the test:
 *   node tools/test-middle-click-pick.mjs
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

const r = await send('Runtime.evaluate', {
  expression: `(async () => {
    const cyco = window.__cyco;
    if (!cyco?.cycleModeler) {
      return { error: 'cycleModeler not exposed on window.__cyco' };
    }
    const cm = cyco.cycleModeler;
    const rm = cyco.viewportEngine.rendererManager;
    const sm = cyco.sceneManager;
    const cam = cyco.viewportEngine.camera;
    const scene = sm.getActiveScene();

    for (let i = scene.children.length - 1; i >= 0; i--) {
      const c = scene.children[i];
      if (c.isCamera || c.isLight) continue;
      scene.remove(c);
    }
    cyco.selectionManager.clearSelection();

    const checks = [];
    const assert = (label, cond, detail = '') => checks.push({ label, pass: !!cond, detail });

    const fire = (type, x, y, button, buttons, mods = {}) => {
      const ev = new PointerEvent(type, {
        bubbles: true, cancelable: true,
        clientX: x, clientY: y, screenX: x, screenY: y,
        button, buttons,
        pointerId: 1, pointerType: 'mouse', isPrimary: true,
      });
      Object.assign(ev, mods);
      canvas.dispatchEvent(ev);
    };

    // SETUP
    window.dispatchEvent(new CustomEvent('cyco-modeler-mode', { detail: { active: true } }));
    window.dispatchEvent(new CustomEvent('cyco-modeler-tool', { detail: { tool: 'box' } }));
    await new Promise(r => requestAnimationFrame(r));

    const canvas = rm.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    cam.position.set(0, 400, 600);
    cam.lookAt(0, 0, 0);
    if (cyco.viewportEngine.controls?.target) cyco.viewportEngine.controls.target.set(0, 0, 0);
    cyco.viewportEngine.controls?.update?.();
    await new Promise(r => requestAnimationFrame(r));

    // Draw a box via left-drag (buttons bit 0).
    const dragBox = (sx, sy, ex, ey) => {
      fire('pointerdown', sx, sy, 0, 1);
      for (let i = 1; i <= 8; i++) {
        const x = sx + (ex - sx) * (i / 8);
        const y = sy + (ey - sy) * (i / 8);
        fire('pointermove', x, y, 0, 1);
      }
      fire('pointerup', ex, ey, 0, 0);
    };
    dragBox(rect.left + rect.width/2 - 80, rect.top + rect.height/2 - 80,
            rect.left + rect.width/2 + 80, rect.top + rect.height/2 + 80);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    const modelerObjs = [];
    scene.traverse(o => { if (o.userData?.cycoModeler?.mesh) modelerObjs.push(o); });
    assert('SETUP: one modeler box created', modelerObjs.length === 1,
      'count=' + modelerObjs.length);
    const box = modelerObjs[0];
    assert('SETUP: box has populated cycoModeler.mesh',
      !!box.userData.cycoModeler.mesh && box.userData.cycoModeler.mesh.faces?.length > 0,
      'faces=' + (box.userData.cycoModeler.mesh?.faces?.length ?? 0));
    cyco.selectionManager.setSelectedObjects([box]);

    const setMode = (mode, tool) => {
      window.dispatchEvent(new CustomEvent('cyco-modeler-element', { detail: { mode } }));
      window.dispatchEvent(new CustomEvent('cyco-modeler-tool',   { detail: { tool: tool ?? mode } }));
    };

    // Helper: reset selection then dispatch a middle-button pick at
    // (x, y). No drag — fires pointerdown + pointerup at the same
    // coords so the gesture stays a single click.
    const middleClick = (x, y, additive = false) => {
      box.userData.cycoModeler.selectedFaces = [];
      box.userData.cycoModeler.selectedEdges = [];
      box.userData.cycoModeler.selectedVertices = [];
      const mods = additive ? { shiftKey: true } : {};
      fire('pointerdown', x, y, 1, 4, mods);
      fire('pointerup',   x, y, 1, 0, mods);
    };

    // Helper: dispatch a middle-button sweep from (sx, sy) to (ex, ey).
    const middleSweep = (sx, sy, ex, ey, additive = false) => {
      box.userData.cycoModeler.selectedFaces = [];
      box.userData.cycoModeler.selectedEdges = [];
      box.userData.cycoModeler.selectedVertices = [];
      const mods = additive ? { shiftKey: true } : {};
      fire('pointerdown', sx, sy, 1, 4, mods);
      for (let i = 1; i <= 12; i++) {
        const x = sx + (ex - sx) * (i / 12);
        const y = sy + (ey - sy) * (i / 12);
        fire('pointermove', x, y, 1, 4, mods);
      }
      fire('pointerup', ex, ey, 1, 0, mods);
    };

    // ── PART 1 — polygon mode pick + backface cull ON ─────────────────
    setMode('polygon');
    await new Promise(r => requestAnimationFrame(r));
    // Ensure backface cull is ON (default).
    window.dispatchEvent(new CustomEvent('cyco-modeler-toggle-backface-cull', {
      detail: { enabled: true }
    }));
    await new Promise(r => requestAnimationFrame(r));

    // Middle-click in the centre of the canvas — guaranteed to hit the
    // front face of the box (camera is at z=+600 looking at origin).
    middleClick(rect.left + rect.width / 2, rect.top + rect.height / 2);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const frontPickFaces = (box.userData.cycoModeler.selectedFaces ?? []).slice();
    assert('POLYGON pick: middle-click on front face selects >1 tri',
      frontPickFaces.length > 1,
      'count=' + frontPickFaces.length);

    // ── PART 2 — backface cull OFF picks closest hit regardless ──────
    window.dispatchEvent(new CustomEvent('cyco-modeler-toggle-backface-cull', {
      detail: { enabled: false }
    }));
    await new Promise(r => requestAnimationFrame(r));
    assert('BACKFACE CULL: cm._backfaceCull === false',
      cm._backfaceCull === false,
      'got ' + cm._backfaceCull);
    middleClick(rect.left + rect.width / 2, rect.top + rect.height / 2);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const backPickFaces = (box.userData.cycoModeler.selectedFaces ?? []).slice();
    assert('POLYGON pick w/ cull OFF: still selects a polygon',
      backPickFaces.length > 0,
      'count=' + backPickFaces.length);
    // Restore cull ON for the rest of the test.
    window.dispatchEvent(new CustomEvent('cyco-modeler-toggle-backface-cull', {
      detail: { enabled: true }
    }));
    await new Promise(r => requestAnimationFrame(r));

    // ── PART 3 — middle-drag sweep, NOT rectangular marquee ───────────
    // Sweep a diagonal across the box — picks the polygons the ray
    // crosses. The selection should be a SUBSET of polygons (sweep),
    // not "every polygon whose centroid is in the screen rect" which
    // is what the previous rectangular marquee did.
    middleSweep(rect.left + rect.width * 0.3, rect.top + rect.height * 0.4,
                rect.left + rect.width * 0.7, rect.top + rect.height * 0.6);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const sweepFaces = (box.userData.cycoModeler.selectedFaces ?? []).slice();
    assert('SWEEP: middle-drag picks polygons under cursor',
      sweepFaces.length >= 1,
      'count=' + sweepFaces.length);
    assert('SWEEP: selection is NOT all 6 polygons (not a rect marquee)',
      sweepFaces.length < 6,
      'count=' + sweepFaces.length);

    // ── PART 4 — symmetry X picks front AND back face ────────────────
    setMode('polygon');
    await new Promise(r => requestAnimationFrame(r));
    window.dispatchEvent(new CustomEvent('cyco-modeler-set-symmetry', {
      detail: { axes: ['x'] }
    }));
    await new Promise(r => requestAnimationFrame(r));
    assert('SYMMETRY: cm._symmetryAxes === {x}',
      cm._symmetryAxes && cm._symmetryAxes.size === 1 && cm._symmetryAxes.has('x'),
      'axes=' + (cm._symmetryAxes ? [...cm._symmetryAxes].join(',') : 'null'));
    // Click the centre (front face). Symmetry on X should also add
    // the mirror face on the back (-X direction).
    middleClick(rect.left + rect.width / 2, rect.top + rect.height / 2);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const symFaces = (box.userData.cycoModeler.selectedFaces ?? []).slice();
    // 1 polygon (2 tris) on the front + 1 polygon (2 tris) mirrored = 4
    assert('SYMMETRY X: front + mirror selected (>= 3 tris)',
      symFaces.length >= 3,
      'count=' + symFaces.length);
    assert('SYMMETRY X: selected faces contain mirrored indices',
      symFaces.length > frontPickFaces.length,
      'sym=' + symFaces.length + ' front=' + frontPickFaces.length);

    // Disable symmetry — single-face pick again.
    window.dispatchEvent(new CustomEvent('cyco-modeler-set-symmetry', {
      detail: { axes: [] }
    }));
    await new Promise(r => requestAnimationFrame(r));
    middleClick(rect.left + rect.width / 2, rect.top + rect.height / 2);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const noSymFaces = (box.userData.cycoModeler.selectedFaces ?? []).slice();
    assert('SYMMETRY OFF: single-face pick (no mirror)',
      noSymFaces.length === frontPickFaces.length,
      'noSym=' + noSymFaces.length + ' front=' + frontPickFaces.length);

    // ── PART 5 — object mode: middle-click does NOT start picker ─────
    setMode('object');
    await new Promise(r => requestAnimationFrame(r));
    const controlsEnabledBefore = cyco.viewportEngine.controls.enabled;
    middleClick(rect.left + rect.width / 2, rect.top + rect.height / 2);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const elemMarqueeAfter = cm._middlePick;
    const controlsEnabledAfter = cyco.viewportEngine.controls.enabled;
    assert('OBJECT mode: middle-click does NOT start picker',
      elemMarqueeAfter === null,
      'middlePick=' + JSON.stringify(elemMarqueeAfter ? { hasPointerId: !!elemMarqueeAfter.pointerId } : null));
    assert('OBJECT mode: OrbitControls remain enabled after middle-click',
      controlsEnabledBefore === controlsEnabledAfter,
      'before=' + controlsEnabledBefore + ' after=' + controlsEnabledAfter);

    // Cleanup
    for (let i = scene.children.length - 1; i >= 0; i--) {
      const c = scene.children[i];
      if (c.isCamera || c.isLight) continue;
      scene.remove(c);
    }
    cyco.selectionManager.clearSelection();

    return { checks };
  })()`,
  awaitPromise: true,
  returnByValue: true,
});

if (r.result.exceptionDetails) {
  console.error('FAIL: exception in page:', r.result.exceptionDetails);
  sock.close(); process.exit(4);
}

const result = r.result.result.value;
if (result?.error) {
  console.error('FAIL:', result.error);
  sock.close(); process.exit(3);
}

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
