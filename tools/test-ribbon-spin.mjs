// Single-canvas harness: ANIMATE the camera in a continuous orbit
// around each primitive. This is the test the user is asking for:
// "as you rotate and orbit around it, does the wireframe stay
// correct?"
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
.bar{position:absolute;left:8px;right:8px;bottom:8px;height:6px;background:#222;border-radius:3px;z-index:2;overflow:hidden}
.bar>div{height:100%;background:#0f0;width:0%;transition:width 0.1s}
</style></head><body>
<div class="row" id="row"></div>
<script type="importmap">{"imports":{
  "three":"file:///${THREE_PATH.replace(/\\/g, '/')}"
}}</script>
<script type="module">
import * as THREE from 'three';
${patched}

// View-aligned ribbon builder (matches controller, with back-face cull)
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
  const segFaceNormals = edgesGeom.userData?._segFaceNormals;
  const faceN = new THREE.Vector3();
  const faceNW = new THREE.Vector3();
  for (let i = 0; i < segCount; i++) {
    A.fromBufferAttribute(src, i * 2);
    B.fromBufferAttribute(src, i * 2 + 1);
    dir.subVectors(B, A);
    if (dir.lengthSq() < 1e-10) continue;
    dir.normalize();
    // Back-face cull: skip segment if every adjacent face normal
    // points away from the camera.
    if (segFaceNormals && segFaceNormals[i]) {
      const normals = segFaceNormals[i];
      const nCount = normals.length / 3;
      if (nCount > 0) {
        const midLocal = A.clone().add(B).multiplyScalar(0.5);
        const midWorld = midLocal.applyMatrix4(parentWorld);
        const camToMid = new THREE.Vector3().subVectors(camPos, midWorld).normalize();
        let anyFront = false;
        for (let k = 0; k < nCount; k++) {
          faceN.set(normals[k * 3], normals[k * 3 + 1], normals[k * 3 + 2]);
          faceNW.copy(faceN).transformDirection(parentWorld);
          if (faceNW.dot(camToMid) > 0) { anyFront = true; break; }
        }
        if (!anyFront) continue;
      }
    }
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

// 1 cell per primitive, each with its own context and an animated orbit
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
  const bar = document.createElement('div');
  bar.className = 'bar';
  const barInner = document.createElement('div');
  bar.appendChild(barInner);
  cell.appendChild(bar);
  row.appendChild(cell);

  const canvas = document.createElement('canvas');
  canvas.width = 380; canvas.height = 380;
  cell.appendChild(canvas);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111111);

  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 200);
  camera.position.set(11, 5, 0);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(1);
  renderer.setSize(380, 380, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const editable = t.fn();
  const geom = editable.toBufferGeometry();
  const mat = new THREE.MeshStandardMaterial({
    color: 0x88aacc, metalness: 0.05, roughness: 0.7, side: THREE.DoubleSide
  });
  const mesh = new THREE.Mesh(geom, mat);
  scene.add(mesh);

  // Build initial ribbon
  const wireGeom = editable.toEdgesGeometry(1);
  mesh.updateWorldMatrix(true, false);
  const fov = camera.fov * Math.PI / 180;
  const canvasH = 380;
  const worldPerPx = (2 * Math.tan(fov / 2) * 11) / canvasH;
  const ribbonWidthWorld = 4 * worldPerPx;
  let ribbonGeom = buildRibbon(wireGeom, ribbonWidthWorld, camera, mesh.matrixWorld);
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
    depthTest: false,  // x-ray: front-facing wireframe shows through mesh
    depthWrite: false,
  });
  let ribbon = new THREE.Mesh(ribbonGeom, ribbonMat);
  ribbon.renderOrder = 9999;
  scene.add(ribbon);

  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dl = new THREE.DirectionalLight(0xffffff, 1.0);
  dl.position.set(5, 8, 5);
  scene.add(dl);

  const grid = new THREE.GridHelper(12, 12, 0x444444, 0x222222);
  grid.position.y = -3.5;
  scene.add(grid);

  // Animate: orbit camera around Y, full 360° in 6 seconds
  const r = 11;
  const el = 25 * Math.PI / 180;
  let frame = 0;
  const start = performance.now();
  const totalFrames = 360;  // 6 sec at 60fps

  function tick() {
    const t2 = (performance.now() - start) / 6000;
    const az = t2 * Math.PI * 2;
    camera.position.set(
      r * Math.cos(el) * Math.sin(az),
      r * Math.sin(el),
      r * Math.cos(el) * Math.cos(az)
    );
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);

    // Rebuild ribbon every frame (mirrors what the controller's
    // onBeforeRender does).
    const newGeom = buildRibbon(wireGeom, ribbonWidthWorld, camera, mesh.matrixWorld);
    const newPos = newGeom.attributes.position;
    for (let i = 0; i < newPos.count; i++) {
      rv.set(newPos.getX(i), newPos.getY(i), newPos.getZ(i));
      rv.applyMatrix4(mesh.matrixWorld);
      newPos.setXYZ(i, rv.x, rv.y, rv.z);
    }
    newPos.needsUpdate = true;
    newGeom.computeBoundingSphere();
    const old = ribbon.geometry;
    ribbon.geometry = newGeom;
    if (old) old.dispose();

    renderer.render(scene, camera);

    frame++;
    const pct = Math.min(100, (frame / totalFrames) * 100);
    barInner.style.width = pct + '%';
    sub.textContent = 'frame ' + frame + ' / ' + totalFrames + ' — ' + (t2 < 1 ? 'orbiting' : 'done');

    if (frame < totalFrames) {
      requestAnimationFrame(tick);
    } else {
      // Loop
      frame = 0;
      requestAnimationFrame(tick);
    }
  }
  tick();
}
window.__ready = true;
</script></body></html>`;

const outPath = path.join(ROOT, 'tools/.tmp-ribbon-spin.html');
fs.writeFileSync(outPath, html);
console.log('Wrote ' + outPath);
