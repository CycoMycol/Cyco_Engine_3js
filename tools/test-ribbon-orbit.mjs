// Build a self-contained HTML harness that ORBITS the camera around
// the primitive and exposes the wireframe state at every angle. This
// is a real test of the "wireframe disappears as you rotate" bug.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const EDITABLE_PATH = path.join(ROOT, 'editor/src/CycoModeler/EditableMesh.js');
const THREE_PATH = path.join(ROOT, 'editor/libs/three/build/three.module.min.js');

const editableSrc = fs.readFileSync(EDITABLE_PATH, 'utf8');
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
${patched}

// View-aligned ribbon builder (mirrors CycleModelerController._expandEdgesToRibbon)
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
    const aL = A;
    const aR = A.clone().add(offsetLocal);
    const bL = B;
    const bR = B.clone().add(offsetLocal);
    positions.push(aL.x, aL.y, aL.z, aR.x, aR.y, aR.z, bR.x, bR.y, bR.z);
    positions.push(aL.x, aL.y, aL.z, bR.x, bR.y, bR.z, bL.x, bL.y, bL.z);
  }
  const ribbon = new THREE.BufferGeometry();
  ribbon.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return ribbon;
}

const tests = [
  { name: 'Sphere',  fn: () => EditableMesh.sphere(2, 2, 2, 24) },
  { name: 'Torus',   fn: () => EditableMesh.torus(2, 0.6, 2, 24) },
  { name: 'Cone',    fn: () => EditableMesh.cone(2, 4, 2, 24) },
  { name: 'Cylinder', fn: () => EditableMesh.cylinder(2, 4, 2, 24) },
  { name: 'Capsule', fn: () => EditableMesh.capsule(2, 4, 2, 24) },
  { name: 'Box',     fn: () => EditableMesh.box(2, 2, 2) },
];

const row = document.getElementById('row');

// 6 camera angles around the Y axis (orbit), 1 elevated
const angles = [
  { az: 0,   el: 25, label: '0°' },
  { az: 60,  el: 25, label: '60°' },
  { az: 120, el: 25, label: '120°' },
  { az: 180, el: 25, label: '180°' },
  { az: 240, el: 25, label: '240°' },
  { az: 300, el: 25, label: '300°' },
];

window.__stats = {};

// Build a row per primitive, columns per angle
for (const t of tests) {
  const primLabel = document.createElement('div');
  primLabel.style.cssText = 'color:#0ff;font-weight:600;padding:8px;font-size:14px;width:100%';
  primLabel.textContent = 'Primitive: ' + t.name;
  row.appendChild(primLabel);
  for (const ang of angles) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    const label = document.createElement('div');
    label.className = 'label';
    label.textContent = t.name + ' @ ' + ang.label;
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
    const r = 11;
    const az = ang.az * Math.PI / 180;
    const el = ang.el * Math.PI / 180;
    camera.position.set(r * Math.cos(el) * Math.sin(az), r * Math.sin(el), r * Math.cos(el) * Math.cos(az));
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(1);
    renderer.setSize(380, 380, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const editable = t.fn();
    const buf = editable.toBufferGeometry();
    buf.computeBoundingBox();
    const bb = buf.boundingBox;
    const size = new THREE.Vector3().subVectors(bb.max, bb.min);
    const center = new THREE.Vector3().addVectors(bb.max, bb.min).multiplyScalar(0.5);
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const scale = 4.0 / maxDim;

    const geom = editable.toBufferGeometry();
    const mat = new THREE.MeshStandardMaterial({
      color: 0x88aacc, metalness: 0.05, roughness: 0.7, side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.sub(center);
    mesh.scale.setScalar(scale);
    scene.add(mesh);

    // Build the ribbon with the new view-aligned logic.
    const wireGeom = editable.toEdgesGeometry(1);
    const fov = camera.fov * Math.PI / 180;
    const canvasH = canvas.clientHeight || 380;
    const worldPerPx = (2 * Math.tan(fov / 2) * camera.position.length()) / canvasH;
    const ribbonWidthWorld = 12 * worldPerPx;
    mesh.updateWorldMatrix(true, false);
    const ribbonGeom = buildRibbon(wireGeom, ribbonWidthWorld, camera, mesh.matrixWorld);
    const pos = ribbonGeom.attributes.position;
    const rv = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      rv.set(pos.getX(i), pos.getY(i), pos.getZ(i));
      rv.applyMatrix4(mesh.matrixWorld);
      pos.setXYZ(i, rv.x, rv.y, rv.z);
    }
    pos.needsUpdate = true;
    ribbonGeom.computeBoundingSphere();
    const ribbonMat = new THREE.MeshBasicMaterial({
      color: 0xff6a00,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
      depthTest: false,  // x-ray: always show all wireframe (matches modeler)
      depthWrite: false,
    });
    const ribbon = new THREE.Mesh(ribbonGeom, ribbonMat);
    ribbon.renderOrder = 9999;
    scene.add(ribbon);

    // Count ribbon triangles for stats
    const triCount = pos.count / 3;
    const key = t.name + '@' + ang.label;
    window.__stats[key] = { tris: triCount, prim: t.name, angle: ang.label };
    sub.textContent = 'ribbon tris: ' + triCount;

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dl = new THREE.DirectionalLight(0xffffff, 1.0);
    dl.position.set(5, 8, 5);
    scene.add(dl);
    const dl2 = new THREE.DirectionalLight(0x8888ff, 0.4);
    dl2.position.set(-5, 4, -3);
    scene.add(dl2);

    const grid = new THREE.GridHelper(12, 12, 0x444444, 0x222222);
    grid.position.y = -3.5;
    scene.add(grid);

    renderer.render(scene, camera);
  }
}
window.__ready = true;
</script></body></html>`;

const outPath = path.join(ROOT, 'tools/.tmp-ribbon-orbit.html');
fs.writeFileSync(outPath, html);
console.log('Wrote ' + outPath);
console.log('Open: file:///' + outPath.replace(/\\/g, '/'));
