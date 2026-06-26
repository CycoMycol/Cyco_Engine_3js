// Build a self-contained HTML harness rendering all primitives + wireframes.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const EDITABLE_PATH = path.join(ROOT, 'editor/src/CycoModeler/EditableMesh.js');
const THREE_PATH = path.join(ROOT, 'editor/libs/three/build/three.module.min.js');

// Read EditableMesh and inline it so the page is fully self-contained.
const editableSrc = fs.readFileSync(EDITABLE_PATH, 'utf8');
// Strip the `from 'three'` import; we'll prepend an import shim.
const patched = editableSrc.replace(
  /^import\s+\*\s+as\s+THREE\s+from\s+['"]three['"];?/m,
  '// import handled by harness'
);

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:#0a0a0a;font-family:system-ui,sans-serif;color:#eee}
.row{display:flex;gap:8px;padding:8px;flex-wrap:wrap}
.cell{position:relative;width:380px;height:380px;background:#111;border:1px solid #333;border-radius:6px;overflow:hidden}
.cell canvas{display:block;width:100%;height:100%}
.label{position:absolute;left:8px;top:6px;font-size:13px;color:#0ff;z-index:2;text-shadow:0 1px 0 #000;font-weight:600}
.sub{position:absolute;left:8px;top:24px;font-size:11px;color:#aaa;z-index:2;text-shadow:0 1px 0 #000}
</style></head><body>
<div class="row" id="row"></div>
<script type="importmap">{"imports":{
  "three":"file:///${THREE_PATH.replace(/\\/g, '/')}"
}}</script>
<script type="module">
import * as THREE from 'three';
// Inlined EditableMesh source
${patched}

// Now use it.
const tests = [
  { name: 'Capsule h=2.4', fn: () => EditableMesh.capsule(2, 4, 2, 16) },
  { name: 'Capsule h=8 (tall)', fn: () => EditableMesh.capsule(2, 12, 2, 16) },
  { name: 'Stair (8 steps)', fn: () => EditableMesh.stair(2, 4, 6, 8) },
  { name: 'Spiral Stair', fn: () => EditableMesh.spiralStair(2, 6, 8, 12, 1.2) },
  { name: 'Sphere', fn: () => EditableMesh.sphere(2, 16, 12) },
  { name: 'Torus', fn: () => EditableMesh.torus(2, 0.6, 16, 32) },
  { name: 'Cylinder', fn: () => EditableMesh.cylinder(2, 4, 16) },
  { name: 'Cone', fn: () => EditableMesh.cone(2, 4, 16) },
  { name: 'Box', fn: () => EditableMesh.box(2, 2, 2) },
  { name: 'Icosahedron', fn: () => EditableMesh.icosahedron(2, 2, 2) },
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
  camera.position.set(7, 5, 9);
  camera.lookAt(0, 1, 0);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(1);
  renderer.setSize(380, 380, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderers.push(renderer);

  const editable = t.fn();
  const buf = editable.toBufferGeometry();
  buf.computeBoundingBox();
  const bb = buf.boundingBox;
  const size = new THREE.Vector3().subVectors(bb.max, bb.min);
  const center = new THREE.Vector3().addVectors(bb.max, bb.min).multiplyScalar(0.5);
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const scale = 4.0 / maxDim;

  // Build mesh from toBufferGeometry
  const geom = editable.toBufferGeometry();
  const mat = new THREE.MeshStandardMaterial({
    color: 0x88aacc, metalness: 0.05, roughness: 0.7, side: THREE.DoubleSide
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.sub(center);
  mesh.scale.setScalar(scale);
  scene.add(mesh);

  // Wireframe from polygon edges (matches _syncWireOverlay fix)
  const wireGeom = editable.toEdgesGeometry(1);
  const wireMat = new THREE.LineBasicMaterial({ color: 0xff6a00, linewidth: 1 });
  const wire = new THREE.LineSegments(wireGeom, wireMat);
  wire.position.copy(mesh.position);
  wire.scale.copy(mesh.scale);
  scene.add(wire);

  // Lights
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dl = new THREE.DirectionalLight(0xffffff, 1.0);
  dl.position.set(5, 8, 5);
  scene.add(dl);
  const dl2 = new THREE.DirectionalLight(0x8888ff, 0.4);
  dl2.position.set(-5, 4, -3);
  scene.add(dl2);

  // Grid at object base (lowest y)
  const grid = new THREE.GridHelper(12, 12, 0x444444, 0x222222);
  grid.position.y = (bb.min.y - center.y) * scale - 0.01;
  scene.add(grid);

  renderer.render(scene, camera);

  const v = editable.vertices.length;
  const f = editable.faces.length;
  const e = wireGeom.attributes.position.count / 2;
  sub.textContent = 'v:' + v + ' f:' + f + ' wire:' + e;
}

window.__ready = true;
window.__count = tests.length;
</script></body></html>`;

const outPath = path.join(ROOT, 'tools/.tmp-primitive-visual.html');
fs.writeFileSync(outPath, html);
console.log('Wrote ' + outPath);
console.log('Open: file:///' + outPath.replace(/\\/g, '/'));