// Build a self-contained HTML harness rendering all primitives with the
// NEW view-aligned ribbon.  Verifies the visual fix for the
// wireframe-coverage and jittery-ribbon bugs.
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
  { name: 'Icosahedron', fn: () => EditableMesh.icosahedron(2, 2, 2) },
  { name: 'Stair',   fn: () => EditableMesh.stair(2, 4, 6, 8) },
];

const row = document.getElementById('row');
const cams = [
  { pos: [7, 5, 9], target: [0, 0, 0], label: 'oblique' },
  { pos: [0, 0, 8], target: [0, 0, 0], label: 'front' },
  { pos: [0, 6, 0.001], target: [0, 0, 0], label: 'topdown' },
];

// Build a row per camera, columns per primitive
for (const cam of cams) {
  const camLabel = document.createElement('div');
  camLabel.style.cssText = 'color:#0ff;font-weight:600;padding:8px;font-size:14px;width:100%';
  camLabel.textContent = 'Camera: ' + cam.label;
  row.appendChild(camLabel);
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
    camera.position.set(...cam.pos);
    camera.lookAt(...cam.target);
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

    // Build the ribbon using the new view-aligned logic. The ribbon
    // geometry is in mesh-local space; the mesh's matrixWorld handles
    // the scale/rotation.
    const wireGeom = editable.toEdgesGeometry(1);
    // Compute world-space ribbon width based on canvas height.
    const fov = camera.fov * Math.PI / 180;
    const canvasH = canvas.clientHeight || 380;
    const worldPerPx = (2 * Math.tan(fov / 2) * camera.position.length()) / canvasH;
    const ribbonWidthWorld = 12 * worldPerPx; // 12px wireframe (very visible)
    // Apply the mesh's local-to-world so the ribbon lines up with the
    // visible mesh. The ribbon is built in *local* space, so the
    // parent world matrix passed here is the mesh's own matrix.
    mesh.updateWorldMatrix(true, false);
    // Add the ribbon as a CHILD of the mesh so it inherits the mesh's
    // transform (scale 2). Otherwise the ribbon would render at local
    // space size while the mesh renders at 2x → mesh occludes ribbon.
    const ribbonGeom = buildRibbon(wireGeom, ribbonWidthWorld, camera, mesh.matrixWorld);
    // Pre-apply the world matrix to the ribbon vertices since the
    // ribbon is added directly to the scene (not as a child of mesh).
    const pos = ribbonGeom.attributes.position;
    const rv = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      rv.set(pos.getX(i), pos.getY(i), pos.getZ(i));
      rv.applyMatrix4(mesh.matrixWorld);
      pos.setXYZ(i, rv.x, rv.y, rv.z);
    }
    pos.needsUpdate = true;
    ribbonGeom.computeBoundingSphere();
    if (t.name === 'Sphere' && cam.label === 'oblique') {
      // Debug: log ribbon extent
      const pos = ribbonGeom.attributes.position;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      }
      console.log('Sphere ribbon bbox:', { minX, maxX, minY, maxY, minZ, maxZ, verts: pos.count });
    }
    const ribbonMat = new THREE.MeshBasicMaterial({
      color: 0xff6a00,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
      depthTest: true,  // Back-side ribbons should be occluded by the mesh
      depthWrite: false,
    });
    const ribbon = new THREE.Mesh(ribbonGeom, ribbonMat);
    ribbon.renderOrder = 9999;
    scene.add(ribbon);

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dl = new THREE.DirectionalLight(0xffffff, 1.0);
    dl.position.set(5, 8, 5);
    scene.add(dl);
    const dl2 = new THREE.DirectionalLight(0x8888ff, 0.4);
    dl2.position.set(-5, 4, -3);
    scene.add(dl2);

    const grid = new THREE.GridHelper(12, 12, 0x444444, 0x222222);
    grid.position.y = (bb.min.y - center.y) * scale - 0.01;
    scene.add(grid);

    renderer.render(scene, camera);

    const v = editable.vertices.length;
    const f = editable.faces.length;
    const e = wireGeom.attributes.position.count / 2;
    sub.textContent = 'v:' + v + ' f:' + f + ' wire:' + e + ' (12px ribbon)';
  }
}
window.__ready = true;
</script></body></html>`;

const outPath = path.join(ROOT, 'tools/.tmp-ribbon-visual.html');
fs.writeFileSync(outPath, html);
console.log('Wrote ' + outPath);
console.log('Open: file:///' + outPath.replace(/\\/g, '/'));
