// Visual verification: render each primitive as a Three.js mesh with wireframe
// and save to PNG.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const EDITABLE_PATH = path.join(ROOT, 'editor/src/CycoModeler/EditableMesh.js');
const THREE_PATH = path.join(ROOT, 'editor/libs/three/build/three.module.js');

// Patch EditableMesh to use the local three.module.js via file:// URL.
const TMP = path.join(ROOT, 'tools/.tmp-EditableMesh-visual.mjs');
let src = fs.readFileSync(EDITABLE_PATH, 'utf8');
src = src.replace(
  /from\s+['"]three['"]/,
  `from 'file:///${THREE_PATH.replace(/\\/g, '/')}'`
);
fs.writeFileSync(TMP, src);

// Build an HTML harness that loads three + patched EditableMesh, renders each shape.
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#0a0a0a;font-family:sans-serif;color:#eee}
.row{display:flex;gap:8px;padding:8px;flex-wrap:wrap}
.cell{position:relative;width:380px;height:380px;background:#111;border:1px solid #333}
.cell canvas{display:block;width:100%;height:100%}
.label{position:absolute;left:6px;top:4px;font-size:13px;color:#0ff;z-index:2;text-shadow:0 1px 0 #000}
.sub{position:absolute;left:6px;top:22px;font-size:11px;color:#888;z-index:2;text-shadow:0 1px 0 #000}
</style></head><body>
<div class="row" id="row"></div>
<script type="importmap">{"imports":{
  "three":"file:///${THREE_PATH.replace(/\\/g, '/')}",
  "editable":"file:///${TMP.replace(/\\/g, '/')}"
}}</script>
<script type="module">
import * as THREE from 'three';
import { EditableMesh } from 'editable';

const tests = [
  { name: 'Capsule (h=100)', fn: () => EditableMesh.capsule(2, 2, 4, 16, 8) },
  { name: 'Capsule (h=300)', fn: () => EditableMesh.capsule(2, 2, 12, 16, 12) },
  { name: 'Stair', fn: () => EditableMesh.stair(2, 4, 6, 1) },
  { name: 'Spiral Stair', fn: () => EditableMesh.spiralStair(2, 6, 8, 1.2) },
  { name: 'Sphere', fn: () => EditableMesh.sphere(2, 16, 12) },
  { name: 'Torus', fn: () => EditableMesh.torus(2, 0.6, 16, 32) },
  { name: 'Cylinder', fn: () => EditableMesh.cylinder(2, 4, 16) },
  { name: 'Cone', fn: () => EditableMesh.cone(2, 4, 16) },
  { name: 'Box', fn: () => EditableMesh.box(2, 2, 2) },
  { name: 'Icosahedron', fn: () => EditableMesh.icosahedron(2) },
];

const row = document.getElementById('row');
const renderers = [];
for (const t of tests) {
  const cell = document.createElement('div');
  cell.className = 'cell';
  const label = document.createElement('div');
  label.className = 'label';
  label.textContent = t.name;
  const sub = document.createElement('div');
  sub.className = 'sub';
  cell.appendChild(label);
  cell.appendChild(sub);
  row.appendChild(cell);

  const canvas = document.createElement('canvas');
  canvas.width = 380; canvas.height = 380;
  cell.appendChild(canvas);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111111);

  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 200);
  camera.position.set(8, 6, 10);
  camera.lookAt(0, 1, 0);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(1);
  renderer.setSize(380, 380, false);
  renderers.push(renderer);

  // Build mesh + wireframe
  const mesh = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshStandardMaterial({ color: 0x88aacc, metalness: 0.05, roughness: 0.8, side: THREE.DoubleSide })
  );

  const editable = t.fn();
  // Center + scale to fit a 4-unit cube.
  const bb = editable.boundingBox();
  const size = new THREE.Vector3().subVectors(bb.max, bb.min);
  const center = new THREE.Vector3().addVectors(bb.max, bb.min).multiplyScalar(0.5);
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const scale = 4 / maxDim;

  const obj3 = editable.toObject3D();
  obj3.position.sub(center);
  obj3.scale.setScalar(scale);
  scene.add(obj3);

  // Wireframe using polygon edges (matches the fix in _syncWireOverlay).
  const wireGeom = editable.toEdgesGeometry(1);
  const wireMat = new THREE.LineBasicMaterial({ color: 0xff6a00 });
  const wire = new THREE.LineSegments(wireGeom, wireMat);
  wire.position.copy(obj3.position);
  wire.scale.copy(obj3.scale);
  scene.add(wire);

  // Lights
  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  const dl = new THREE.DirectionalLight(0xffffff, 0.9);
  dl.position.set(5, 8, 5);
  scene.add(dl);
  const dl2 = new THREE.DirectionalLight(0x8888ff, 0.3);
  dl2.position.set(-5, 4, -3);
  scene.add(dl2);

  // Grid
  const grid = new THREE.GridHelper(10, 10, 0x444444, 0x222222);
  grid.position.y = -2 / scale + center.y * 0; // not quite right but ok
  // Actually center the grid at object base
  grid.position.y = -2;
  scene.add(grid);

  renderer.render(scene, camera);

  // Stats
  const v = editable.vertices.length;
  const f = editable.faces.length;
  const e = wireGeom.attributes.position.count / 2;
  sub.textContent = 'v:' + v + ' f:' + f + ' wire:' + e;
}

// Wait one frame then signal ready
window.__ready = true;
</script></body></html>`;

const htmlPath = path.join(ROOT, 'tools/.tmp-primitive-visual.html');
fs.writeFileSync(htmlPath, html);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

const fileUrl = 'file:///' + htmlPath.replace(/\\/g, '/');
await page.goto(fileUrl);
await page.waitForFunction(() => window.__ready === true, { timeout: 30000 });
await page.waitForTimeout(500);

const outPath = path.join(ROOT, 'Screenshots/primitive-visual.png');
await page.screenshot({ path: outPath, fullPage: true });

if (errors.length) {
  console.log('PAGE ERRORS:');
  for (const e of errors) console.log('  ' + e);
} else {
  console.log('No page errors.');
}

await browser.close();

console.log('Saved screenshot: ' + outPath);
console.log('Cleanup tmp files...');
fs.unlinkSync(TMP);
fs.unlinkSync(htmlPath);