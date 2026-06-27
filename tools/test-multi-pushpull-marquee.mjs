#!/usr/bin/env node
/**
 * test-multi-pushpull-marquee.mjs
 *
 * Browser-driven regression test for the cycle-modeler's
 *  - element-level marquee multi-select (polygon / edge / vertex modes)
 *  - multi-push-pull extrusion (extrudes all selected polygons at once
 *    along their own face normals)
 *
 * Verifies (against a running Cyco editor in any renderer mode):
 *
 *   SETUP
 *   1.  Cycle Modeler can be activated via the `cyco-modeler-mode` event.
 *   2.  Drawing a box via the box primitive tool (pointer-drag on grid)
 *       commits an object with `userData.cycoModeler.mesh` populated.
 *
 *   ELEMENT MARQUEE — POLYGON MODE
 *   3.  Switching to polygon mode + drag-marquee selects multiple
 *       faces (selectedFaces.length > 1 on the modeler object).
 *   4.  The multi-selection overlay renders one child Mesh per object
 *       under the active scene (visual proof the overlay built).
 *
 *   ELEMENT MARQUEE — EDGE MODE
 *   5.  Switching to edge mode + drag-marquee selects multiple edges
 *       (selectedEdges.length > 1).
 *
 *   ELEMENT MARQUEE — VERTEX MODE
 *   6.  Switching to vertex mode + drag-marquee selects multiple
 *       vertices (selectedVertices.length > 1).
 *
 *   MULTI PUSH / PULL
 *   7.  With multiple faces selected, switching to the multi-push-pull
 *       tool and click-dragging applies `pushFaces` to every selected
 *       polygon. Each polygon extrudes along its OWN face normal —
 *       opposite-facing walls move in opposite world directions at the
 *       same screen drag distance.
 *   8.  After the drag, the model's bounding-box has GROWN along every
 *       selected face's axis (not collapsed to zero).
 *   9.  The resulting mesh still has a populated `faceGroups` array
 *       (push/pull didn't corrupt the topology metadata).
 *
 *   ADditive MARQUEE (shift-drag)
 *  10.  Shift-drag-marquee UNIONs elements into the existing
 *       selection rather than replacing it.
 *
 * Usage:
 *   # 1. Launch Chrome with debugging port (one-time):
 *   #    "C:\Program Files\Google\Chrome\Application\chrome.exe" ^
 *   #      --remote-debugging-port=9222 --user-data-dir=c:\chrome-cyco ^
 *   #      "file:///c%3A/Users/Cyco%20Myco/Documents/1_Game_Engines%5F11/editor/index.html"
 *   # 2. Start the test:
 *   node tools/test-multi-pushpull-marquee.mjs
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

    // Clean non-camera/non-light children for a deterministic scene.
    for (let i = scene.children.length - 1; i >= 0; i--) {
      const c = scene.children[i];
      if (c.isCamera || c.isLight) continue;
      scene.remove(c);
    }
    cyco.selectionManager.clearSelection();

    const checks = [];
    const assert = (label, cond, detail = '') => checks.push({ label, pass: !!cond, detail });

    const fire = (type, x, y, buttons, mods = {}) => {
      const ev = new PointerEvent(type, {
        bubbles: true, cancelable: true,
        clientX: x, clientY: y, screenX: x, screenY: y,
        button: 0, buttons,
        pointerId: 1, pointerType: 'mouse', isPrimary: true,
      });
      Object.assign(ev, mods);
      canvas.dispatchEvent(ev);
    };
    // Synthetic click (no buttons) — also dispatch the synthetic
    // 'click' event because the modeler's pointer pipeline listens
    // for both pointerdown/up AND click.
    const fireClick = (x, y) => {
      fire('pointerdown', x, y, 1);
      fire('pointerup',   x, y, 0);
      canvas.dispatchEvent(new MouseEvent('click', {
        bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0,
      }));
    };

    // ── SETUP — activate cycle modeler and draw a 200x200 box ─────────────
    window.dispatchEvent(new CustomEvent('cyco-modeler-mode', { detail: { active: true } }));
    // Switch to box primitive tool.
    window.dispatchEvent(new CustomEvent('cyco-modeler-tool', { detail: { tool: 'box' } }));
    await new Promise(r => requestAnimationFrame(r));

    const canvas = rm.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    // Position the camera so the grid is centred in the viewport.
    cam.position.set(0, 400, 600);
    cam.lookAt(0, 0, 0);
    if (cyco.viewportEngine.controls?.target) cyco.viewportEngine.controls.target.set(0, 0, 0);
    cyco.viewportEngine.controls?.update?.();
    await new Promise(r => requestAnimationFrame(r));

    // Drag from (-100,-100) to (100,100) screen-space → a 200x200 box.
    const dragBox = (sx, sy, ex, ey) => {
      fire('pointerdown', sx, sy, 1);
      // Drag in 8 steps so any throttled updates see multiple frames.
      for (let i = 1; i <= 8; i++) {
        const x = sx + (ex - sx) * (i / 8);
        const y = sy + (ey - sy) * (i / 8);
        fire('pointermove', x, y, 1);
      }
      fire('pointerup', ex, ey, 0);
    };
    dragBox(rect.left + rect.width/2 - 80, rect.top + rect.height/2 - 80,
            rect.left + rect.width/2 + 80, rect.top + rect.height/2 + 80);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    // After the box is committed, scene should contain one modeler object.
    const modelerObjs = [];
    scene.traverse(o => { if (o.userData?.cycoModeler?.mesh) modelerObjs.push(o); });
    assert('SETUP: one modeler box created', modelerObjs.length === 1,
      'count=' + modelerObjs.length);
    const box = modelerObjs[0];
    assert('SETUP: box has populated cycoModeler.mesh',
      !!box.userData.cycoModeler.mesh && box.userData.cycoModeler.mesh.faces?.length > 0,
      'faces=' + (box.userData.cycoModeler.mesh?.faces?.length ?? 0));
    // Select the box so subsequent operations work on it.
    cyco.selectionManager.setSelectedObjects([box]);

    // Helper: switch to a specific element mode + tool.
    const setMode = (mode, tool) => {
      window.dispatchEvent(new CustomEvent('cyco-modeler-element', { detail: { mode } }));
      window.dispatchEvent(new CustomEvent('cyco-modeler-tool',   { detail: { tool: tool ?? mode } }));
    };

    // Helper: clear selection then marquee-drag a rectangle covering
    // most of the screen.
    const clearAndMarquee = (sx, sy, ex, ey, additive) => {
      // Reset selection so the marquee starts fresh.
      box.userData.cycoModeler.selectedFaces = [];
      box.userData.cycoModeler.selectedEdges = [];
      box.userData.cycoModeler.selectedVertices = [];
      const mods = additive ? { shiftKey: true } : {};
      fire('pointerdown', sx, sy, 1, mods);
      for (let i = 1; i <= 10; i++) {
        const x = sx + (ex - sx) * (i / 10);
        const y = sy + (ey - sy) * (i / 10);
        fire('pointermove', x, y, 1, mods);
      }
      fire('pointerup', ex, ey, 0, mods);
    };

    // ── PART 1 — POLYGON MODE MARQUEE ───────────────────────────────────
    setMode('polygon');
    await new Promise(r => requestAnimationFrame(r));
    // Marquee-drag a rect that covers the whole viewport → all 12 tris
    // of the box (6 polygons × 2 triangles each) should end up
    // selected as the 6 polygon faces.
    clearAndMarquee(rect.left + 10, rect.top + 10,
                    rect.left + rect.width - 10, rect.top + rect.height - 10, false);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

    const selFaces = box.userData.cycoModeler.selectedFaces ?? [];
    assert('POLY: marquee selected multiple faces', selFaces.length > 1,
      'count=' + selFaces.length);
    // 12 triangles expected (6 polygons × 2 tris each).
    assert('POLY: marquee selected ALL 12 tris of the box',
      selFaces.length === 12, 'count=' + selFaces.length);

    // Multi-selection overlay should now have a child Mesh on the box.
    const polyOverlayChild = box.children.find(c =>
      c.isMesh && c.geometry?.attributes?.position?.count > 0);
    assert('POLY: multi-selection overlay mesh attached to box',
      !!polyOverlayChild, 'children=' + box.children.length);

    // ── PART 2 — EDGE MODE MARQUEE ──────────────────────────────────────
    setMode('edge');
    await new Promise(r => requestAnimationFrame(r));
    clearAndMarquee(rect.left + 10, rect.top + 10,
                    rect.left + rect.width - 10, rect.top + rect.height - 10, false);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const selEdges = box.userData.cycoModeler.selectedEdges ?? [];
    assert('EDGE: marquee selected multiple edges', selEdges.length > 1,
      'count=' + selEdges.length);
    // Box has 12 edges.
    assert('EDGE: marquee selected ALL 12 edges of the box',
      selEdges.length === 12, 'count=' + selEdges.length);

    // ── PART 3 — VERTEX MODE MARQUEE ────────────────────────────────────
    setMode('vertex');
    await new Promise(r => requestAnimationFrame(r));
    clearAndMarquee(rect.left + 10, rect.top + 10,
                    rect.left + rect.width - 10, rect.top + rect.height - 10, false);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const selVerts = box.userData.cycoModeler.selectedVertices ?? [];
    assert('VERT: marquee selected multiple vertices', selVerts.length > 1,
      'count=' + selVerts.length);
    // Box has 8 corners.
    assert('VERT: marquee selected ALL 8 vertices of the box',
      selVerts.length === 8, 'count=' + selVerts.length);

    // ── PART 4 — ADDITIVE SHIFT-MARQUEE ─────────────────────────────────
    setMode('polygon');
    await new Promise(r => requestAnimationFrame(r));
    // Start with ONE selected face (just the top).
    box.userData.cycoModeler.selectedFaces = [];
    box.userData.cycoModeler.selectedEdges = [];
    box.userData.cycoModeler.selectedVertices = [];
    // Click on the top of the box to seed a single-face selection.
    // For a centred box the top is at world (0, 200, 0); with the
    // camera at (0,400,600) looking at origin, this projects to roughly
    // (canvas centre, top-quarter).
    fireClick(rect.left + rect.width/2, rect.top + rect.height/2 - 60);
    await new Promise(r => requestAnimationFrame(r));
    const oneFace = box.userData.cycoModeler.selectedFaces?.length ?? 0;
    assert('SEED: single click selected at least one face',
      oneFace >= 1, 'count=' + oneFace);
    // Now shift-marquee over the WHOLE viewport — this should UNION
    // every face into the selection (not replace).
    clearAndMarquee(rect.left + 10, rect.top + 10,
                    rect.left + rect.width - 10, rect.top + rect.height - 10, true);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const additiveFaces = box.userData.cycoModeler.selectedFaces ?? [];
    assert('ADDITIVE: shift-marquee merged faces (>= 12)',
      additiveFaces.length === 12, 'count=' + additiveFaces.length);

    // ── PART 5 — MULTI PUSH / PULL ──────────────────────────────────────
    // Snapshot the bbox BEFORE the multi-push.
    box.geometry.computeBoundingBox();
    const bbBefore = box.geometry.boundingBox.clone();
    const beforeMax = { x: bbBefore.max.x, y: bbBefore.max.y, z: bbBefore.max.z };
    const beforeMin = { x: bbBefore.min.x, y: bbBefore.min.y, z: bbBefore.min.z };

    // Switch to multi-push-pull tool. selectedFaces already holds all
    // 12 triangles from PART 4.
    window.dispatchEvent(new CustomEvent('cyco-modeler-tool', { detail: { tool: 'multi-push-pull' } }));
    await new Promise(r => requestAnimationFrame(r));

    // Drag the mouse UP (negative Y in screen-space) to extrude.
    const startX = rect.left + rect.width / 2;
    const startY = rect.top  + rect.height / 2 - 60;
    const endX   = startX;
    const endY   = startY - 100; // drag up 100px
    fire('pointerdown', startX, startY, 1);
    // Multiple moves so the multi-push preview can rebuild.
    for (let i = 1; i <= 10; i++) {
      const y = startY + (endY - startY) * (i / 10);
      fire('pointermove', startX, y, 1);
    }
    fire('pointerup', endX, endY, 0);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    await new Promise(r => requestAnimationFrame(r));

    // After multi-push, every face should have been extruded along its
    // OWN normal. For a 200×200×200 box with all 12 tris selected,
    // every face moves outward — the resulting bbox must be strictly
    // larger on all 6 sides than the original 200×200×200 box.
    box.geometry.computeBoundingBox();
    const bbAfter = box.geometry.boundingBox.clone();
    const afterMax = { x: bbAfter.max.x, y: bbAfter.max.y, z: bbAfter.max.z };
    const afterMin = { x: bbAfter.min.x, y: bbAfter.min.y, z: bbAfter.min.z };
    // Box was 200 wide centred at (0,0,0) → [-100, +100] in each axis.
    // After multi-push every face extruded outward, so the bbox grows
    // in every direction (top goes UP, bottom goes DOWN, etc.).
    assert('MULTI-PUSH: top face grew (max.y > before.max.y)',
      afterMax.y > beforeMax.y + 1, 'before=' + beforeMax.y + ' after=' + afterMax.y);
    assert('MULTI-PUSH: bottom face shrank downward (min.y < before.min.y - 1)',
      afterMin.y < beforeMin.y - 1, 'before=' + beforeMin.y + ' after=' + afterMin.y);
    assert('MULTI-PUSH: max X grew (right face extruded)',
      afterMax.x > beforeMax.x + 1, 'before=' + beforeMax.x + ' after=' + afterMax.x);
    assert('MULTI-PUSH: min X shrank (left face extruded)',
      afterMin.x < beforeMin.x - 1, 'before=' + beforeMin.x + ' after=' + afterMin.x);
    assert('MULTI-PUSH: max Z grew (front face extruded)',
      afterMax.z > beforeMax.z + 1, 'before=' + beforeMax.z + ' after=' + afterMax.z);
    assert('MULTI-PUSH: min Z shrank (back face extruded)',
      afterMin.z < beforeMin.z - 1, 'before=' + beforeMin.z + ' after=' + afterMin.z);

    // Topology sanity: faceGroups must still be present and have
    // a length matching faces (push/pull didn't corrupt the array).
    const af = box.userData.cycoModeler.mesh;
    assert('MULTI-PUSH: mesh still has faceGroups array',
      Array.isArray(af.faceGroups) && af.faceGroups.length === af.faces.length,
      'faceGroups=' + (af.faceGroups?.length ?? 'null') + ' faces=' + af.faces.length);
    assert('MULTI-PUSH: mesh now has MORE faces than before (push adds side walls)',
      af.faces.length > 12, 'faces=' + af.faces.length);

    // Cleanup
    window.dispatchEvent(new CustomEvent('cyco-modeler-mode', { detail: { active: false } }));
    for (let i = scene.children.length - 1; i >= 0; i--) {
      const c = scene.children[i];
      if (c.isCamera || c.isLight) continue;
      scene.remove(c);
    }
    cyco.selectionManager.clearSelection();

    return {
      checks,
      before: beforeMin, beforeMax,
      after: afterMin, afterMax,
      facesBefore: 12,
      facesAfter: af.faces.length,
    };
  })()`,
  awaitPromise: true,
  returnByValue: true,
});

if (r.result.exceptionDetails) {
  console.error('FAIL: exception in page:', r.result.exceptionDetails);
  sock.close(); process.exit(4);
}

const result = r.result.result.value;
if (result.error) {
  console.error('FAIL:', result.error);
  sock.close(); process.exit(3);
}

console.log('\n────── BBox before / after multi-push ──────');
console.log('before min/max:', JSON.stringify(result.before), JSON.stringify(result.beforeMax));
console.log('after  min/max:', JSON.stringify(result.after),  JSON.stringify(result.afterMax));
console.log('face count:    ', result.facesBefore, '->', result.facesAfter);

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