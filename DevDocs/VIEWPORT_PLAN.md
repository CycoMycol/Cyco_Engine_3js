# Cyco Engine 4 — Viewport System Implementation Guide

> **Version:** v9 (audited against Three.js r184 docs)
> **For:** AI implementing agents — every API call, import path, dependency, and gotcha is listed explicitly.
> **Rule:** Implement phases in order. Never skip a prerequisite. Read each section fully before writing code.

---

## Table of Contents

1. [Overview & Architecture](#1-overview--architecture)
2. [Prerequisites — HTTP Server Required](#2-prerequisites--http-server-required)
3. [Library Versions & File Size Budget](#3-library-versions--file-size-budget)
4. [Directory Layout — All New Files](#4-directory-layout--all-new-files)
5. [Import Map](#5-import-map)
6. [Module Initialization Order (main.js)](#6-module-initialization-order-mainjs)
7. [5 Renderer Types](#7-5-renderer-types)
8. [Render Modes (Viewport Shading)](#8-render-modes-viewport-shading)
9. [Color Management Rules — CRITICAL](#9-color-management-rules--critical)
10. [IBL Setup — PMREMGenerator — CRITICAL](#10-ibl-setup--pmremgenerator--critical)
11. [Default Scene (Startup Without Project)](#11-default-scene-startup-without-project)
12. [ViewHelper — Axis Orientation Cube](#12-viewhelper--axis-orientation-cube)
13. [OrbitControls Configuration](#13-orbitcontrols-configuration)
14. [Selection System — Click + Box Marquee](#14-selection-system--click--box-marquee)
15. [Post-Processing: Dual Pipelines (WebGL vs WebGPU)](#15-post-processing-dual-pipelines-webgl-vs-webgpu)
16. [TransformControls / Gizmo Wiring](#16-transformcontrols--gizmo-wiring)
17. [ObjectFactory — All Addable Types](#17-objectfactory--all-addable-types)
18. [SceneManager — Scene Graph + Disposal](#18-scenemanager--scene-graph--disposal)
19. [CommandManager — Undo / Redo / History](#19-commandmanager--undo--redo--history)
20. [GameRuntime — Play / Stop Mode](#20-gameruntime--play--stop-mode)
21. [Scene Serialization & Project File System](#21-scene-serialization--project-file-system)
22. [Materials Tab — 75+ Presets](#22-materials-tab--75-presets)
23. [Property Panels (9 panels)](#23-property-panels-9-panels)
24. [Grid Settings](#24-grid-settings)
25. [Preferences Window](#25-preferences-window)
26. [InputManager — Keyboard Shortcuts + Arrow Keys](#26-inputmanager--keyboard-shortcuts--arrow-keys)
27. [LoadingManager — Progress Overlay](#27-loadingmanager--progress-overlay)
28. [File → Export Submenu](#28-file--export-submenu)
29. [Hierarchy Panel Wiring (LeftPanel.js)](#29-hierarchy-panel-wiring-leftpaneljs)
30. [Camera View Panel (Dockview)](#30-camera-view-panel-dockview)
31. [Complete Event Map — 31 Events](#31-complete-event-map--31-events)
32. [Key Files to Modify](#32-key-files-to-modify)
33. [Implementation Phases 0–14 (37 steps)](#33-implementation-phases-014-37-steps)
34. [Verification Checklist (32 tests)](#34-verification-checklist-32-tests)
35. [Future Phases 15–18](#35-future-phases-1518)

---

## 1. Overview & Architecture

Cyco Engine 4 is a browser-based 3D game engine editor built on:
- **No bundler, no npm** — pure ES modules via `<script type="importmap">`
- **Three.js r184 (0.184.0)** — core 3D rendering
- **dockview-core** — panel layout (already integrated)
- **File System Access API** — project save/load to disk
- **Custom event bus** — all cross-module communication via `window.dispatchEvent(new CustomEvent(...))`

### Module Communication Pattern
All modules communicate exclusively via custom events dispatched on `window`. No direct imports between sibling modules (only parent→child constructor injection). Event names are prefixed `cyco-`.

### Workspace Root
```
c:\Users\Cyco Myco\Documents\1_Game_Engines\Cyco_Engine_4\
```

### Editor Entry Point
```
editor/index.html  →  editor/src/main.js
```

---

## 2. Prerequisites — HTTP Server Required

> **CRITICAL:** `<script type="importmap">` is **blocked on `file://`** URLs. The editor MUST be served over HTTP.

Options:
- VS Code Live Server extension (recommended — right-click `editor/index.html` → "Open with Live Server")
- `python -m http.server 8080` run from the `editor/` folder
- Any static file server pointing at `editor/`

---

## 3. Library Versions & File Size Budget

| File | Version | Size |
|---|---|---|
| `three.module.min.js` | r184 (0.184.0) | 356 KB |
| `three.webgpu.min.js` | r184 (0.184.0) | 623 KB |
| `postprocessing/index.js` (pmndrs ESM) | 6.39.1 | 618 KB |
| `three-gpu-pathtracer/index.module.js` | 0.0.24 | 218 KB |
| `three-mesh-bvh/index.module.js` | 0.9.10 | 279 KB |
| Three.js addons (~50 JS files) | r184 | ~650 KB |
| DRACO decoder (wasm + js) | 1.5.x | ~350 KB |
| KTX2 basis_transcoder (wasm + js) | r184 | ~750 KB |
| `helvetiker_regular.typeface.json` | r184 | ~240 KB |
| **Libraries total** | | **~4.1 MB** |
| New source files (~27) | | ~215 KB |
| Existing editor source + dockview + fonts | | ~630 KB |
| **Grand Total** | | **~4.9 MB** |

### jsDelivr CDN Base URLs
```
Three.js r184:      https://cdn.jsdelivr.net/npm/three@0.184.0/
pmndrs post:        https://cdn.jsdelivr.net/npm/postprocessing@6.39.1/build/index.js
three-gpu-pathtracer: https://cdn.jsdelivr.net/npm/three-gpu-pathtracer@0.0.24/build/index.module.js
three-mesh-bvh:     https://cdn.jsdelivr.net/npm/three-mesh-bvh@0.9.10/build/index.module.js
```

---

## 4. Directory Layout — All New Files

```
editor/
  index.html                         ← MODIFY: add importmap
  libs/
    three/
      build/
        three.module.min.js          ← download
        three.webgpu.min.js          ← download
      addons/
        controls/
          OrbitControls.js           ← download
          TransformControls.js       ← download
        renderers/
          SVGRenderer.js             ← download
          CSS3DRenderer.js           ← download
        helpers/
          ViewHelper.js              ← download
        environments/
          RoomEnvironment.js         ← download
        capabilities/
          WebGPU.js                  ← download
        loaders/
          GLTFLoader.js              ← download
          DRACOLoader.js             ← download
          FBXLoader.js               ← download
          OBJLoader.js               ← download
          MTLLoader.js               ← download
          RGBELoader.js              ← download
          EXRLoader.js               ← download
          FontLoader.js              ← download
          KTX2Loader.js              ← download
          BasisTextureLoader.js      ← download
          IESLoader.js               ← download
          ColladaLoader.js           ← download
          PLYLoader.js               ← download
          STLLoader.js               ← download
          PCDLoader.js               ← download
        lights/
          RectAreaLightUniformsLib.js ← download
          RectAreaLightTexturesLib.js ← download
        objects/
          Reflector.js               ← download
          Refractor.js               ← download
          Sky.js                     ← download
          Water.js                   ← download
          Water2.js                  ← download
          GroundedSkybox.js          ← download
          Lensflare.js               ← download
          MarchingCubes.js           ← download
        postprocessing/
          EffectComposer.js          ← download
          RenderPass.js              ← download
          OutlinePass.js             ← download
          GTAOPass.js                ← download
          UnrealBloomPass.js         ← download
          OutputPass.js              ← download
        interactive/
          SelectionBox.js            ← download
          SelectionHelper.js         ← download
        utils/
          SkeletonUtils.js           ← download
          BufferGeometryUtils.js     ← download
        exporters/
          GLTFExporter.js            ← download
          OBJExporter.js             ← download
          PLYExporter.js             ← download
          STLExporter.js             ← download
          USDZExporter.js            ← download
          EXRExporter.js             ← download
        libs/
          draco/                     ← download (wasm + js decoder)
          basis/                     ← download (basis_transcoder.wasm + .js)
        fonts/
          helvetiker_regular.typeface.json  ← download
    postprocessing/
      index.js                       ← download (pmndrs)
    three-gpu-pathtracer/
      index.module.js                ← download
    three-mesh-bvh/
      index.module.js                ← download

  src/
    main.js                          ← MODIFY: bootstrap all viewport modules
    viewport/                        ← NEW FOLDER
      ViewportEngine.js              ← NEW
      RendererManager.js             ← NEW
      SceneManager.js                ← NEW
      SelectionManager.js            ← NEW
      TransformGizmo.js              ← NEW
      ObjectFactory.js               ← NEW
      RenderModeManager.js           ← NEW
      PostProcessingPipeline.js      ← NEW
      ViewportContextMenu.js         ← NEW
      MaterialLibrary.js             ← NEW
      CommandManager.js              ← NEW
      ViewportStats.js               ← NEW
      InputManager.js                ← NEW
      GameRuntime.js                 ← NEW
    panels/
      CameraViewPanel.js             ← NEW
      CenterPanel.js                 ← MODIFY
      LeftPanel.js                   ← MODIFY
      RightPanel.js                  ← MODIFY
      RightViewportPanel.js          ← MODIFY
      BottomPanel.js                 ← MODIFY
    properties/                      ← NEW FOLDER
      ObjectProperties.js            ← NEW
      CameraProperties.js            ← NEW
      RendererProperties.js          ← NEW
      LightingProperties.js          ← NEW
      EnvironmentProperties.js       ← NEW
      PostProcessingProperties.js    ← NEW
      GridProperties.js              ← NEW
      LODProperties.js               ← NEW
      InstancedMeshProperties.js     ← NEW
    ui/
      MaterialBrowser.js             ← NEW
      PreferencesWindow.js           ← NEW
      MenuBar.js                     ← MODIFY
```

---

## 5. Import Map

Add this as the **first `<script>` tag** in `editor/index.html` `<head>`, before all other scripts:

```html
<script type="importmap">
{
  "imports": {
    "three": "./libs/three/build/three.module.min.js",
    "three/webgpu": "./libs/three/build/three.webgpu.min.js",
    "three/addons/": "./libs/three/addons/",
    "postprocessing": "./libs/postprocessing/index.js",
    "three-gpu-pathtracer": "./libs/three-gpu-pathtracer/index.module.js",
    "three-mesh-bvh": "./libs/three-mesh-bvh/index.module.js"
  }
}
</script>
```

All subsequent `<script type="module">` tags resolve bare specifiers using this map.

---

## 6. Module Initialization Order (main.js)

Execute in **exactly this order** on DOMContentLoaded:

```js
// 1. Global Three.js flags — MUST be first, before any THREE import side effects
import * as THREE from 'three'
THREE.ColorManagement.enabled = true   // explicitly set (default in r152+ but be explicit)
THREE.Cache.enabled = true             // asset deduplication across loaders

// 2. Create shared LoadingManager
const loadingManager = new THREE.LoadingManager()
loadingManager.onProgress = (url, loaded, total) =>
  window.dispatchEvent(new CustomEvent('cyco-loading-progress', { detail: { url, loaded, total } }))

// 3. Instantiate modules (pass loadingManager to all that need it)
const rendererManager  = new RendererManager()
const viewportEngine   = new ViewportEngine(rendererManager, loadingManager)
const sceneManager     = new SceneManager()
const objectFactory    = new ObjectFactory(sceneManager, loadingManager)
const selectionManager = new SelectionManager(viewportEngine)
const transformGizmo   = new TransformGizmo(viewportEngine, selectionManager)
const renderModeManager = new RenderModeManager(viewportEngine)
const postPipeline     = new PostProcessingPipeline(viewportEngine)
const commandManager   = new CommandManager()
const gameRuntime      = new GameRuntime(viewportEngine, sceneManager, selectionManager, transformGizmo)
const inputManager     = new InputManager(commandManager, selectionManager, viewportEngine)
const viewportStats    = new ViewportStats(viewportEngine)
const viewportContextMenu = new ViewportContextMenu(viewportEngine, objectFactory, sceneManager)
const materialBrowser  = new MaterialBrowser()

// 4. Each module calls window.addEventListener() for its own events in constructor/init
```

---

## 7. Five Renderer Types

Exposed in `RendererProperties.js` dropdown. `RendererManager.js` owns the lifecycle.

| # | Label | Class | Import | Post-processing |
|---|---|---|---|---|
| 1 | WebGL Renderer | `THREE.WebGLRenderer` | `'three'` | three/addons EffectComposer pipeline |
| 2 | WebGPU Renderer | `WebGPURenderer` | `'three/webgpu'` | Three.js native PostProcessing (TSL) |
| 3 | SVG Renderer | `SVGRenderer` | `'three/addons/renderers/SVGRenderer.js'` | None |
| 4 | CSS3D Renderer | `CSS3DRenderer` | `'three/addons/renderers/CSS3DRenderer.js'` | None |
| 5 | GPU Path Tracer | `PathTracingRenderer` | `'three-gpu-pathtracer'` | None (path tracing IS the pipeline) |

### WebGPU Availability Check
```js
import WebGPU from 'three/addons/capabilities/WebGPU.js'
const gpuAvailable = await WebGPU.isAvailable()
// If false: fall back to WebGLRenderer, show notice in viewport
```

### RendererManager Lifecycle
```js
// On cyco-renderer-change event:
dispose()       // calls renderer.dispose(), removes canvas from DOM
createRenderer(type)  // creates new renderer, appends canvas
notifyPipeline()      // fires cyco-renderer-change so PostProcessingPipeline rebuilds
```

### GPU Path Tracer Notes
- Uses `three-mesh-bvh` for BVH acceleration: `MeshBVHHelper`, `computeBoundsTree()`
- Progressive accumulation: each frame accumulates samples; reset on camera move or scene change
- Debounce BVH rebuilds 300ms after last `cyco-hierarchy-*` event
- Dispatch `cyco-pathtrace-samples` each frame with `{ samples: n }` → RendererProperties shows counter

---

## 8. Render Modes (Viewport Shading)

`RenderModeManager.js` overrides materials per mode. Toggled by `cyco-vp-rendermode` event.

| Mode | Implementation |
|---|---|
| Solid | Normal materials (default) |
| Wireframe | `mesh.material.wireframe = true` on all meshes |
| Material Preview | Force `MeshNormalMaterial` on all meshes |
| Rendered | Normal materials + post-processing active |
| Unlit | Force `MeshBasicMaterial` clone with `mesh.material.color` preserved |

Restore original materials on switch back to Solid/Rendered. Store originals in a `Map<mesh.uuid, material>`.

---

## 9. Color Management Rules — CRITICAL

### Setup (main.js, before anything else)
```js
THREE.ColorManagement.enabled = true
```

### Texture colorSpace Rules
Apply in `ObjectFactory.js` and all loaders:

| Texture Type | colorSpace Setting |
|---|---|
| Color / albedo / diffuse | `texture.colorSpace = THREE.SRGBColorSpace` |
| Emissive map | `texture.colorSpace = THREE.SRGBColorSpace` |
| Normal map | `texture.colorSpace = THREE.LinearSRGBColorSpace` |
| Roughness map | `texture.colorSpace = THREE.LinearSRGBColorSpace` |
| Metalness map | `texture.colorSpace = THREE.LinearSRGBColorSpace` |
| AO / displacement / height | `texture.colorSpace = THREE.LinearSRGBColorSpace` |
| HDR env (RGBELoader / EXRLoader) | **Auto-set by loader — do NOT override** |
| KTX2 textures | **Auto-set by KTX2Loader — do NOT override** |

**Wrong colorspace symptoms:**
- sRGB treated as Linear → textures look washed out / too bright
- Linear treated as sRGB → textures look too dark / over-saturated

---

## 10. IBL Setup — PMREMGenerator — CRITICAL

**Must be called in `ViewportEngine.js` after renderer is created.** Without this, `MeshStandardMaterial` and `MeshPhysicalMaterial` render completely dark (no indirect lighting).

```js
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'

// Called once per renderer creation (and again on renderer swap):
function setupIBL(renderer, scene) {
  const pmrem = new THREE.PMREMGenerator(renderer)
  pmrem.compileEquirectangularShader()
  const envTexture = pmrem.fromScene(new RoomEnvironment()).texture
  pmrem.dispose()  // MUST dispose — holds WebGL render targets; leaks GPU memory if not disposed
  scene.environment = envTexture
  // Do NOT set scene.background here unless you want a room background
}
```

Re-run `setupIBL()` whenever the renderer is swapped (renderer dispose → new renderer → re-call).

---

## 11. Default Scene (Startup Without Project)

Viewport is live immediately on load — no project creation required.

### Default Scene Contents
```js
// PerspectiveCamera at (5, 5, 5) looking at origin
const camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 1000)
camera.position.set(5, 5, 5)
camera.lookAt(0, 0, 0)

// Non-hierarchy lights (managed by ViewportEngine, NOT shown in scene tree)
const ambientLight = new THREE.AmbientLight(0xffffff, 0.5)
const hemisphereLight = new THREE.HemisphereLight(0x87CEEB, 0x8B7355, 0.8)

// Non-selectable helpers
const gridHelper = new THREE.GridHelper(20, 20)
gridHelper.raycast = () => {}   // make non-selectable
const axesHelper = new THREE.AxesHelper(1)
axesHelper.raycast = () => {}   // make non-selectable

// Register in SceneManager
sceneManager.registerScene('default', scene, { isDefault: true, name: 'DefaultScene' })
```

### "Main Camera" button (RightViewportPanel)
Dispatches `cyco-select-node` with `{ object: camera, type: 'camera' }` → RightPanel shows CameraProperties.

### "Global Light" button (RightViewportPanel)
Dispatches `cyco-show-properties` with `{ type: 'global-light' }` → RightPanel shows GlobalLightProperties sub-panel (AmbientLight intensity + HemisphereLight sky/ground color sliders).

---

## 12. ViewHelper — Axis Orientation Cube

Add the clickable XYZ orientation gizmo (top-right corner of viewport, like Blender).

```js
import { ViewHelper } from 'three/addons/helpers/ViewHelper.js'

// In ViewportEngine constructor, after camera + canvas setup:
const viewHelper = new ViewHelper(camera, renderer.domElement)

// In animation loop, AFTER the main render call:
renderer.render(scene, camera)
viewHelper.render(renderer)   // renders on top of main frame
```

`ViewHelper` is interactive — clicking the X/Y/Z faces snaps the camera to that orthographic view. Add it to the `nonSelectableSet` in SelectionManager.

---

## 13. OrbitControls Configuration

```js
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.dampingFactor = 0.05
controls.mouseButtons = {
  LEFT: THREE.MOUSE.ROTATE,   // left-drag = orbit
  MIDDLE: THREE.MOUSE.PAN,    // middle-drag = pan
  RIGHT: null                 // right-click = context menu ONLY (not handled by OrbitControls)
}
controls.touches = {
  ONE: THREE.TOUCH.ROTATE,
  TWO: THREE.TOUCH.DOLLY_PAN
}
```

### Focus (F key / cyco-rvp-focus event)
```js
// Lerp controls.target to selected object's world position over 300ms
const targetPos = new THREE.Vector3()
selectedObject.getWorldPosition(targetPos)
// Animate controls.target toward targetPos over 300ms using RAF
```

### Camera Orientation Snapping (Top/Front/Right/etc.)
```js
// Temporarily disable OrbitControls while snapping
controls.enabled = false
camera.position.set(...)   // set per view
controls.target.set(0, 0, 0)
controls.update()
controls.enabled = true
```

---

## 14. Selection System — Click + Box Marquee

### SelectionManager.js State
```js
selected = new Set()       // Set<THREE.Object3D> — single source of truth
nonSelectableSet = new Set() // GridHelper, AxesHelper, TransformControls helpers, ViewHelper
```

### Click-to-Select (Raycasting)
```js
// On pointerup (not drag):
const raycaster = new THREE.Raycaster()
raycaster.setFromCamera(normalizedMouseNDC, camera)
const hits = raycaster.intersectObjects(scene.children, true)
  .filter(hit => !nonSelectableSet.has(hit.object))
if (hits.length > 0) {
  selectObject(hits[0].object)
} else {
  clearSelection()
}
```

### Box Marquee (Multi-Select)
Use built-in Three.js addons — **no custom CSS overlay needed:**

```js
import { SelectionBox } from 'three/addons/interactive/SelectionBox.js'
import { SelectionHelper } from 'three/addons/interactive/SelectionHelper.js'

const selectionBox = new SelectionBox(camera, scene)
const selectionHelper = new SelectionHelper(renderer, 'selectBox')  // auto-draws dashed rect

// pointerdown on empty area (no raycast hit):
selectionBox.startPoint.set(ndcX, ndcY, 0.5)

// pointermove:
selectionBox.endPoint.set(ndcX, ndcY, 0.5)
selectionBox.select()  // returns intersecting objects (called during drag for live preview)

// pointerup:
const objects = selectionBox.select()
  .filter(obj => !nonSelectableSet.has(obj))
objects.forEach(obj => selected.add(obj))
dispatchSelectionEvent()
```

`SelectionHelper` draws the dashed rectangle automatically on a canvas overlay — no manual DOM management needed.

### Selection Visual Highlight
Applied on every `selected` change:

```js
function applySelectionHighlight(object) {
  // 1. OutlinePass — add object to OutlinePass.selectedObjects (WebGL/WebGPU)
  outlinePass.selectedObjects = [...selected]

  // 2. Emissive tint (works on ALL renderer types incl SVG/CSS3D)
  object.traverse(child => {
    if (child.isMesh) {
      selectionEmissiveCache.set(child.uuid, child.material.emissive?.clone())
      child.material.emissive?.set(0xFF6600)  // orange accent tint
    }
  })
}

function removeSelectionHighlight(object) {
  object.traverse(child => {
    if (child.isMesh && selectionEmissiveCache.has(child.uuid)) {
      child.material.emissive?.copy(selectionEmissiveCache.get(child.uuid))
      selectionEmissiveCache.delete(child.uuid)
    }
  })
}
```

---

## 15. Post-Processing: Dual Pipelines (WebGL vs WebGPU)

`PostProcessingPipeline.js` maintains two independent pipelines and rebuilds on `cyco-renderer-change`.

### WebGL Pipeline (three/addons EffectComposer)

Pass order is **critical** — OutputPass MUST be last:

```js
import { EffectComposer }    from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass }        from 'three/addons/postprocessing/RenderPass.js'
import { OutlinePass }       from 'three/addons/postprocessing/OutlinePass.js'
import { GTAOPass }          from 'three/addons/postprocessing/GTAOPass.js'
import { UnrealBloomPass }   from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass }        from 'three/addons/postprocessing/OutputPass.js'

const composer = new EffectComposer(renderer)
composer.addPass(new RenderPass(scene, camera))
composer.addPass(new OutlinePass(new THREE.Vector2(w, h), scene, camera))  // selection highlight
composer.addPass(new GTAOPass(scene, camera, w, h))    // Ground Truth AO (preferred over SSAOPass)
composer.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.5, 0.4, 0.85))
composer.addPass(new OutputPass())  // MUST be last — tone mapping + sRGB output; without this viewport looks washed out
```

> **GTAOPass** is preferred over the older `SSAOPass`. It provides Ground Truth Ambient Occlusion which is more accurate and modern.

> **OutputPass** is non-negotiable as the final pass. It applies the renderer's tone mapping setting and converts to sRGB output color space.

### WebGPU Pipeline (Three.js native PostProcessing)

```js
import { PostProcessing } from 'three/webgpu'
import { bloom }          from 'three/addons/...'   // TSL bloom node
import { ao }             from 'three/addons/...'   // TSL AO node
import { toneMapping }    from 'three/addons/...'   // TSL toneMapping

const postProcessing = new PostProcessing(renderer)
// Selection highlight: OutlineNode (TSL) — NOT OutlinePass (WebGL only)
// AO: ao / gtao TSL node
// Bloom: bloom TSL node
// Tone mapping: toneMapping TSL function
```

### Pipeline Lifecycle

```js
// On cyco-renderer-change:
if (newRenderer === 'webgpu') {
  disposeWebGLPipeline()
  createWebGPUPipeline()
} else if (newRenderer === 'webgl') {
  disposeWebGPUPipeline()
  createWebGLPipeline()
} else {
  // SVG / CSS3D / PathTracer — no post-processing
  disposeWebGLPipeline()
  disposeWebGPUPipeline()
}
```

---

## 16. TransformControls / Gizmo Wiring

```js
import { TransformControls } from 'three/addons/controls/TransformControls.js'

const transformControls = new TransformControls(camera, renderer.domElement)
scene.add(transformControls)

// CRITICAL — prevents camera orbiting while dragging gizmo:
transformControls.addEventListener('dragging-changed', event => {
  orbitControls.enabled = !event.value
})

// On cyco-select-node (object selection):
if (object && !object.userData.cycoLocked) {
  transformControls.attach(object)
} else {
  transformControls.detach()
}

// On cyco-vp-tool (W/E/R keys or toolbar buttons):
// 'translate' | 'rotate' | 'scale'
transformControls.setMode(mode)

// On cyco-rvp-snap (snap toggle):
transformControls.translationSnap = snapEnabled ? snapValue : null  // snapValue default 0.25
transformControls.rotationSnap = snapEnabled ? Math.PI / 12 : null  // 15° increments

// On cyco-rvp-world (local/world toggle):
transformControls.setSpace(isWorld ? 'world' : 'local')
```

Add `transformControls` to `SelectionManager.nonSelectableSet` so it cannot be accidentally selected.

---

## 17. ObjectFactory — All Addable Types

`ObjectFactory.js` creates Three.js objects on demand. Every created mesh gets `castShadow = true`, `receiveShadow = true` by default. Every light gets `castShadow = true` by default (except AmbientLight, HemisphereLight, LightProbe).

### Primitives (MeshStandardMaterial default)
```
Box           → BoxGeometry(1, 1, 1)
Sphere        → SphereGeometry(0.5, 32, 16)
Cylinder      → CylinderGeometry(0.5, 0.5, 1, 32)
Cone          → ConeGeometry(0.5, 1, 32)
Capsule       → CapsuleGeometry(0.5, 1, 4, 8)
Plane         → PlaneGeometry(1, 1)
Circle        → CircleGeometry(0.5, 32)
Ring          → RingGeometry(0.1, 0.5, 32)
Torus         → TorusGeometry(0.5, 0.2, 16, 100)
TorusKnot     → TorusKnotGeometry(0.5, 0.15, 100, 16)
Dodecahedron  → DodecahedronGeometry(0.5)
Icosahedron   → IcosahedronGeometry(0.5)
Octahedron    → OctahedronGeometry(0.5)
Tetrahedron   → TetrahedronGeometry(0.5)
Tube          → TubeGeometry(curve, 20, 0.05, 8, false)
Lathe         → LatheGeometry(points, 12)
RoundedBox    → RoundedBoxGeometry(1,1,1,2,0.1)  [three/addons/geometries/RoundedBoxGeometry.js]
```

### Text (TextGeometry)
```js
import { FontLoader } from 'three/addons/loaders/FontLoader.js'
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js'
// Load helvetiker_regular.typeface.json ONCE and cache on ObjectFactory
// TextGeometry(text, { font, size: 0.5, depth: 0.1 })
```

### Lines / Points
```
Line          → new THREE.Line(geometry, LineBasicMaterial)
LineLoop      → new THREE.LineLoop(geometry, LineBasicMaterial)
LineSegments  → new THREE.LineSegments(geometry, LineBasicMaterial)
Points        → new THREE.Points(geometry, PointsMaterial({ size: 0.05 }))
Sprite        → new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffffff }))
```

### Special Scene Objects
```
Group         → new THREE.Group()
LOD           → new THREE.LOD()
InstancedMesh → new THREE.InstancedMesh(geometry, material, count)
BatchedMesh   → new THREE.BatchedMesh(maxGeometryCount, maxVertexCount, maxIndexCount, material)
Bone          → new THREE.Bone()
```

### Lights
```js
// AmbientLight — castShadow: N/A
new THREE.AmbientLight(0xffffff, 1)

// DirectionalLight
const dl = new THREE.DirectionalLight(0xffffff, 1); dl.castShadow = true

// PointLight
const pl = new THREE.PointLight(0xffffff, 1, 100); pl.castShadow = true

// SpotLight
const sl = new THREE.SpotLight(0xffffff, 1); sl.castShadow = true

// HemisphereLight — castShadow: N/A
new THREE.HemisphereLight(0x87CEEB, 0x8B7355, 1)

// RectAreaLight — MUST init BOTH libs before first use:
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js'
import { RectAreaLightTexturesLib } from 'three/addons/lights/RectAreaLightTexturesLib.js'
RectAreaLightUniformsLib.init()   // call once before first RectAreaLight
RectAreaLightTexturesLib.init()   // call once before first RectAreaLight (r152+, LTC lookup textures)
new THREE.RectAreaLight(0xffffff, 1, 4, 4)

// IESSpotLight (physically accurate IES profile spotlight)
import { IESLoader } from 'three/addons/loaders/IESLoader.js'
// Requires loading an IES profile file first

// LightProbe
new THREE.LightProbe()
```

### Light Effects
```js
// Lensflare — attach as child of PointLight or SpotLight
import { Lensflare, LensflareElement } from 'three/addons/objects/Lensflare.js'
const lensflare = new Lensflare()
lensflare.addElement(new LensflareElement(texture, 700, 0))
pointLight.add(lensflare)
```

### Environment / Special Addon Objects
```
Sky           → import from 'three/addons/objects/Sky.js'
Water         → import from 'three/addons/objects/Water.js'
Water2        → import from 'three/addons/objects/Water2.js'   (supports flow maps)
Reflector     → import from 'three/addons/objects/Reflector.js'
Refractor     → import from 'three/addons/objects/Refractor.js'
GroundedSkybox → import from 'three/addons/objects/GroundedSkybox.js'
MarchingCubes → import from 'three/addons/objects/MarchingCubes.js'
ShadowMesh    → import from 'three/addons/objects/ShadowMesh.js'
```

### Model Loaders
```js
// GLTF (primary)
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
const dracoLoader = new DRACOLoader(loadingManager)
dracoLoader.setDecoderPath('./libs/three/addons/libs/draco/')  // MUST set before attaching
const gltfLoader = new GLTFLoader(loadingManager)
gltfLoader.setDRACOLoader(dracoLoader)
// After load: check gltf.animations.length > 0 → register AnimationMixer in SceneManager

// FBX
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js'
new FBXLoader(loadingManager)

// OBJ + MTL
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js'
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js'

// KTX2 compressed textures
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'
const ktx2Loader = new KTX2Loader(loadingManager)
ktx2Loader.setTranscoderPath('./libs/three/addons/libs/basis/')
ktx2Loader.detectSupport(renderer)  // MUST call with active renderer

// HDR environments
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js'  // .hdr files
import { EXRLoader }  from 'three/addons/loaders/EXRLoader.js'   // .exr files
// These set texture.colorSpace automatically — do NOT override
```

---

## 18. SceneManager — Scene Graph + Disposal

```js
// Scene registry
sceneRegistry = new Map()   // Map<id, { name, scene: THREE.Scene, dirty: boolean }>
animationMixers = new Map() // Map<object3d.uuid, THREE.AnimationMixer>
activeSceneId = null

// Correct object disposal (call before scene.remove):
disposeObject(obj) {
  obj.traverse(child => {
    child.geometry?.dispose()
    ;[child.material].flat().forEach(m => {
      if (!m) return
      Object.values(m).forEach(v => v?.isTexture && v.dispose())
      m.dispose()
    })
  })
}

// SkinnedMesh duplication — CRITICAL:
// Regular obj.clone() on SkinnedMesh breaks bone-to-mesh binding.
// ALWAYS use SkeletonUtils.clone for SkinnedMesh:
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js'
duplicateObject(obj) {
  return obj.isSkinnedMesh ? skeletonClone(obj) : obj.clone()
}

// Scene duplication (for scene switcher Duplicate button):
duplicateScene(id) {
  const json = this.sceneRegistry.get(id).scene.toJSON()
  return new THREE.ObjectLoader().parse(json)
}

// Play mode serialization note:
// scene.toJSON() / ObjectLoader.parse() works for standard Three.js primitives + standard materials.
// For WebGPU NodeMaterials: use NodeObjectLoader instead of ObjectLoader.
// For externally loaded GLTF/FBX: SceneManager re-triggers the loader on GameRuntime.stop()
// rather than relying on JSON round-trip (custom geometries may not serialize cleanly).
```

---

## 19. CommandManager — Undo / Redo / History

### API (singleton)
```js
CommandManager.execute(command)  // runs command.do(), pushes to stack, clears redo branch
CommandManager.undo()            // runs command.undo(), moves pointer back
CommandManager.redo()            // runs command.redo(), moves pointer forward
CommandManager.jumpTo(index)     // undo/redo to reach target history index (Photoshop-style)
CommandManager.history           // getter → [{ name, timestamp }]
CommandManager.currentIndex      // getter → current stack pointer position
```

### Command Interface
Each command implements `{ name: string, do(), undo() }`:

| Command | do() | undo() |
|---|---|---|
| `AddObjectCommand` | `sceneManager.addObject(obj)` | `sceneManager.removeObject(id)` |
| `RemoveObjectCommand` | `sceneManager.removeObject(id)` | re-add with same parent + index |
| `TransformCommand` | `object.matrix.copy(newMatrix)` | `object.matrix.copy(oldMatrix)` |
| `ApplyMaterialCommand` | `mesh.material = newMat` | `mesh.material = oldMat` |
| `RenameNodeCommand` | `object.name = newName` | `object.name = oldName` |
| `CameraTypeChangeCommand` | replace camera in scene | restore original camera |
| `HierarchyReorderCommand` | reparent object | restore original parent + index |
| `DuplicateCommand` | `sceneManager.duplicateObject(obj)` | `sceneManager.removeObject(dupId)` |

### CenterPanel Toolbar Layout
```
[RenderMode ▼]  [Camera ▼]  |  [← Undo]  [H ▼]  [Redo →]  |  [▶ Play]  |  [📊 Stats]  |  [⊡ Float]
```
- **← Undo**: white left-arrow; `CommandManager.undo()`; opacity 0.4 when nothing to undo
- **H**: orange background (`var(--cyco-accent)`); dropdown list of history entries; click any → `CommandManager.jumpTo(i)`
- **→ Redo**: white right-arrow; `CommandManager.redo()`; opacity 0.4 when nothing to redo

---

## 20. GameRuntime — Play / Stop Mode

### Play Button Appearance
- Idle: green filled triangle `▶` icon
- Playing: red 8-sided octagon `⬡` icon (stop sign shape)

### `play()` — called on `cyco-runtime-play`
```js
async play() {
  this.snapshot = JSON.stringify(scene.toJSON())   // serialize restore point
  this.lockHierarchy()                             // disable add/remove/rename/drag in LeftPanel
  this.transformGizmo.detach()                     // hide all gizmos
  this.selectionManager.suspend()                  // disable raycasting during play
  this.showPlayingBadge()                          // green "PLAYING" overlay top-right of viewport
  // Future Phase 16: call onStart() on all Script components
}
```

### `stop()` — called on `cyco-runtime-stop`
```js
async stop() {
  const json = JSON.parse(this.snapshot)
  const restoredScene = new THREE.ObjectLoader().parse(json)  // or NodeObjectLoader for WebGPU
  this.viewportEngine.replaceScene(restoredScene)
  this.unlockHierarchy()
  this.transformGizmo.restore()
  this.selectionManager.resume()
  this.removePlayingBadge()
  // Future Phase 16: call onDestroy() on all Script components
  this.snapshot = null
}
```

---

## 21. Scene Serialization & Project File System

### Project Directory Structure on Disk
```
MyProject/
  project.json              ← { name, version, activeScene, engineVersion: '4.0' }
  assets/
    scenes/
      MainScene.scene.json  ← scene.toJSON() output
      Level2.scene.json
    textures/
    models/
    fonts/
```

### File System Access API (Chrome/Edge over HTTP)
```js
// New Project
const dirHandle = await window.showDirectoryPicker()
// → write project.json
// → create assets/scenes/ subdirectory
// → save initial default scene

// Open Project
const dirHandle = await window.showDirectoryPicker()
const projectJson = await readFile(dirHandle, 'project.json')
// → SceneManager.loadScene(sceneJson)

// Save
const sceneJson = JSON.stringify(scene.toJSON())
const fileHandle = await dirHandle.getFileHandle('assets/scenes/ActiveScene.scene.json', { create: true })
const writable = await fileHandle.createWritable()
await writable.write(sceneJson)
await writable.close()

// Fallback (Safari / Firefox / file://)
// Save: new Blob([json]) → URL.createObjectURL → <a download>.click()
// Load: <input type="file" accept=".json"> → FileReader.readAsText()
```

### Scene Switcher (LeftPanel — already built, needs wiring)
| Action | Three.js operation |
|---|---|
| Add Scene | `new THREE.Scene()` → PMREMGenerator IBL setup → `sceneManager.registerScene()` |
| Duplicate Scene | `scene.toJSON()` → `new ObjectLoader().parse(json)` → new ID |
| Rename Scene | update `sceneRegistry` name entry |
| Remove Scene | `sceneManager.disposeScene(id)` → switch to adjacent scene |
| Switch Scene | `viewportEngine.setActiveScene(scene)` → LeftPanel re-renders hierarchy |

---

## 22. Materials Tab — 75+ Presets

New tab in `BottomPanel.js` labeled "Materials". Rendered by `MaterialBrowser.js`. Data defined in `MaterialLibrary.js` (plain config objects — no Three.js constructors called at definition time, only at drag-drop apply time).

### Material Categories
| # | Category | Class | Count |
|---|---|---|---|
| 1–15 | PBR Standard | `MeshStandardMaterial` | 15 |
| 16–25 | PBR Physical | `MeshPhysicalMaterial` | 10 |
| 26–30 | Phong / Lambert | `MeshPhongMaterial` / `MeshLambertMaterial` | 5 |
| 31–35 | Toon / Cell Shading | `MeshToonMaterial` | 5 |
| 36–40 | Emissive / Glow | `MeshStandardMaterial` (emissive) | 5 |
| 41–50 | Special / Utility | Various | 10 |
| 51–55 | Procedural Shader | `ShaderMaterial` (GLSL) | 5 |
| 56–75 | TSL / Node Materials | `*NodeMaterial` — **WebGPU preferred** | 20 |

> Node materials (56–75) are tagged `{ requiresWebGPU: true }`. MaterialBrowser.js dims them and shows a "WebGPU" badge when WebGL renderer is active.

### Drag-and-Drop Apply System
```js
// Material card in MaterialBrowser:
card.setAttribute('draggable', 'true')
card.addEventListener('dragstart', e => e.dataTransfer.setData('materialId', preset.id))

// Viewport canvas in ViewportEngine:
canvas.addEventListener('dragover', e => e.preventDefault())
canvas.addEventListener('drop', e => {
  const materialId = e.dataTransfer.getData('materialId')
  const hits = raycaster.intersectObjects(scene.children, true)
  if (hits.length > 0) {
    window.dispatchEvent(new CustomEvent('cyco-apply-material', {
      detail: { materialId, targetObjectId: hits[0].object.userData.cycoId }
    }))
  }
})

// SceneManager listens for cyco-apply-material:
// → clones the preset material from MaterialLibrary
// → mesh.material = clonedMaterial
// → wraps in ApplyMaterialCommand for undo
```

---

## 23. Property Panels (9 panels)

All panels live in `editor/src/properties/`. They are mounted/unmounted by `RightPanel.js` based on selection type.

### RightPanel Swapper Logic
```js
// RightPanel listens for:
// cyco-select-node  → { type: 'mesh'|'light'|'camera'|'group'|..., object }
// cyco-show-properties → { type: 'grid'|'global-light'|'environment'|'renderer'|... }

// Mount the appropriate properties component:
switch(type) {
  case 'mesh':        mount(ObjectProperties, object); break
  case 'camera':      mount(CameraProperties, object); break
  case 'light':       mount(LightingProperties, object); break
  case 'grid':        mount(GridProperties); break
  case 'global-light': mount(GlobalLightProperties); break
  case 'environment': mount(EnvironmentProperties); break
  case 'renderer':    mount(RendererProperties); break
  // etc.
}
```

### ObjectProperties.js
- Position / Rotation (Euler degrees) / Scale — number inputs with live update
- Material slot — shows material name, click to open MaterialProperties sub-panel
- **Sub-panels** (conditionally visible):
  - **Animations** — visible when `sceneManager.animationMixers.has(object.uuid)`; clip list + play/pause/loop/scrub
  - **SkeletonHelper** — visible when `object instanceof THREE.SkinnedMesh`; toggle creates/removes `new THREE.SkeletonHelper(mesh)` added as non-selectable helper
  - **LOD** (LODProperties.js) — visible when `object instanceof THREE.LOD`; level list with mesh slot + distance; active level indicator
  - **InstancedMesh** (InstancedMeshProperties.js) — visible when `object instanceof THREE.InstancedMesh`; per-instance matrix table; `instanceMatrix.needsUpdate = true` on edit

### CameraProperties.js
"Camera Type" dropdown at top — changing creates a new camera preserving position/rotation, dispatches `cyco-camera-type-change`:
- **PerspectiveCamera**: fov (1–180 slider), near, far, zoom, filmGauge, filmOffset
- **OrthographicCamera**: left/right/top/bottom (auto from viewport aspect), near, far, zoom
- **ArrayCamera**: sub-camera list editor (fov + viewport xywh normalized)
- **CubeCamera**: near, far, renderTarget resolution (128/256/512), manual "Update" button
- **StereoCamera**: eyeSep (0.064), aspect; read-only cameraL/cameraR layer display

### RendererProperties.js
- 5-type dropdown (dispatches `cyco-renderer-change`)
- Sample counter display (for Path Tracer — updates on `cyco-pathtrace-samples`)
- Shadow map type selector (PCFSoft / PCF / Basic / VSM)
- Post-processing disabled notice for SVG/CSS3D/PathTracer

### PostProcessingProperties.js
- **WebGL controls**: OutlinePass (color, thickness), GTAOPass (radius, intensity, distanceExponent), UnrealBloomPass (threshold, strength, radius), OutputPass tone mapping mode (ACES Filmic / Linear / Cineon / ReinhardToneMapping)
- **WebGPU controls**: same effects mapped to TSL node equivalents
- Entire panel disabled when SVG / CSS3D / PathTracer renderer active

### EnvironmentProperties.js
- Sky addon toggle + sun elevation/azimuth sliders
- Fog type (None / Fog / FogExp2) + color + density/near/far
- Environment map slot: accepts `.hdr` (RGBELoader) or `.exr` (EXRLoader) via drag-drop or file picker

---

## 24. Grid Settings

### Grid Settings Button (RightViewportPanel.js)
New icon button added **between the Grid Snap button and the Focus button**. Uses a grid SVG icon. Click → `window.dispatchEvent(new CustomEvent('cyco-show-properties', { detail: { type: 'grid' } }))`.

### GridProperties.js Controls
```
Divisions        number input  default: 20
Size             number input  default: 20 (world units)
Grid color       CeColorPicker default: #444444
Center line color CeColorPicker default: #888888
X axis color     CeColorPicker default: #FF4444 (red)
Z axis color     CeColorPicker default: #4444FF (blue)
Opacity          range 0–1     default: 1.0
Show grid        checkbox      default: true
Show axes        checkbox      default: true
```

Settings persist in `localStorage['cyco-grid-settings']`. Also accessible via Preferences → Grid tab.

### ViewportEngine Rebuild on Change
```js
// On cyco-grid-settings-change:
scene.remove(gridHelper); gridHelper.dispose?.()
scene.remove(axesHelper); axesHelper.dispose?.()
if (settings.gridVisible) {
  gridHelper = new THREE.GridHelper(settings.size, settings.divisions, settings.centerColor, settings.gridColor)
  gridHelper.material.opacity = settings.opacity
  gridHelper.material.transparent = settings.opacity < 1
  gridHelper.raycast = () => {}
  scene.add(gridHelper)
}
if (settings.axesVisible) {
  axesHelper = new THREE.AxesHelper(settings.size * 0.05)
  axesHelper.raycast = () => {}
  scene.add(axesHelper)
}
```

---

## 25. Preferences Window

Triggered by `Edit → Preferences` in MenuBar. Same floating modal pattern as `ThemeDialog.js`. Stores all settings in `localStorage['cyco-prefs']`. Dispatches `cyco-preferences-change` on any change.

### Tab 1 — Keyboard Shortcuts

| Action | Default Key |
|---|---|
| Delete selected | Delete |
| Undo | Ctrl+Z |
| Redo | Ctrl+Y (also Ctrl+Shift+Z) |
| Focus selected | F |
| Deselect | Escape |
| Duplicate | Ctrl+D |
| Translate mode | W |
| Rotate mode | E |
| Scale mode | R |
| Move camera (no selection) | Arrow keys |
| Move object (with selection) | Arrow keys |
| Toggle grid | G |
| Toggle stats | ` (backtick) |

Each row is editable: click key field → capture next key press → save.

### Tab 2 — Gizmo
- Gizmo size: slider 0.5–3, default 1 (`transformControls.size = value`)
- Axis colors: X (red), Y (green), Z (blue) — CeColorPicker each

### Tab 3 — Grid
Reuses `GridProperties.js` component directly.

### Tab 4 — Renderer Defaults
- Default renderer on startup: WebGL / WebGPU dropdown
- Shadow map type: PCFSoft / PCF / Basic / VSM
- Pixel ratio: 1x / Device / 2x

### Tab 5 — General
- Auto-save interval: Off / 1 min / 5 min / 10 min
- Show welcome screen on startup: checkbox

---

## 26. InputManager — Keyboard Shortcuts + Arrow Keys

```js
// Reads keybindings from localStorage on init + on cyco-preferences-change
// document.addEventListener('keydown', handler)

// Arrow keys — context-sensitive:
if (selectionManager.selected.size === 0) {
  // Pan camera
  const panStep = snapEnabled ? snapValue : 1.0
  controls.target.x += (key === 'ArrowRight') ? panStep : (key === 'ArrowLeft') ? -panStep : 0
  controls.target.z += (key === 'ArrowDown')  ? panStep : (key === 'ArrowUp')   ? -panStep : 0
  controls.update()
} else {
  // Move selected objects — wrap in TransformCommand
  const step = snapEnabled ? snapValue : 0.1
  const multiplier = event.shiftKey ? 10 : 1
  selectedObjects.forEach(obj => {
    const cmd = new TransformCommand(obj, obj.matrix.clone())
    obj.position.x += (key === 'ArrowRight') ? step * multiplier : ...
    CommandManager.execute(cmd)
  })
}
```

---

## 27. LoadingManager — Progress Overlay

```js
// Created in main.js, passed to all loaders
const loadingManager = new THREE.LoadingManager()

loadingManager.onStart = (url, loaded, total) => {
  showLoadingOverlay()   // show progress bar div over viewport
}
loadingManager.onProgress = (url, loaded, total) => {
  const pct = Math.round((loaded / total) * 100)
  window.dispatchEvent(new CustomEvent('cyco-loading-progress', { detail: { url, loaded, total, pct } }))
  updateProgressBar(pct)
}
loadingManager.onLoad = () => {
  hideLoadingOverlay()   // remove progress bar
}
loadingManager.onError = url => {
  console.error('LoadingManager error:', url)
  hideLoadingOverlay()
}
```

Pass `loadingManager` as first argument to: `GLTFLoader`, `FBXLoader`, `OBJLoader`, `MTLLoader`, `RGBELoader`, `EXRLoader`, `KTX2Loader`, `FontLoader`, `IESLoader`.

---

## 28. File → Export Submenu

Wired in `MenuBar.js`. Pure client-side — output delivered via `<a download>` blob URL. No server needed.

```js
// File → Export → GLTF (.glb)
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
const exporter = new GLTFExporter()
const target = selectionManager.selected.size > 0
  ? [...selectionManager.selected][0]
  : scene
exporter.parse(target, gltf => {
  const blob = new Blob([gltf], { type: 'application/octet-stream' })
  triggerDownload(blob, 'export.glb')
}, err => console.error(err), { binary: true })

// Other exporters follow same pattern:
// OBJExporter   → text output → new Blob([text], { type: 'text/plain' })
// PLYExporter   → binary ArrayBuffer → new Blob([buffer])
// STLExporter   → binary → new Blob([buffer])
// USDZExporter  → binary → new Blob([buffer])
// EXRExporter   → binary → new Blob([buffer])
```

---

## 29. Hierarchy Panel Wiring (LeftPanel.js)

The LeftPanel UI is already built. It only needs Three.js event wiring — **no UI changes required**.

| Existing UI Element | Three.js Wiring |
|---|---|
| Eye toggle (per row) | `object.visible = !object.visible` → dispatch `cyco-object-visibility-change` |
| Lock toggle (per row) | `object.userData.cycoLocked = !locked` → TransformGizmo checks before attaching |
| Checkbox (per row) | `selectionManager.selected.add/delete(object)` → dispatch `cyco-select-node` with array |
| Group button | Wrap selected in `new THREE.Group()`, parent at centroid → `AddGroupCommand` |
| Drag & drop reorder | Update `object.parent` in Three.js → `HierarchyReorderCommand` |
| Scene add button | `new THREE.Scene()` → PMREMGenerator IBL setup → `sceneManager.registerScene()` |
| Scene duplicate | `scene.toJSON()` → `new ObjectLoader().parse(json)` → new ID |
| Scene rename | Update `sceneRegistry` name entry |
| Scene remove | `sceneManager.disposeScene(id)` |
| Scene switch | `viewportEngine.setActiveScene(scene)` |
| "Add Object" submenu | `objectFactory.create(type)` → `sceneManager.addObject(obj)` → `AddObjectCommand` |

---

## 30. Camera View Panel (Dockview)

`CameraViewPanel.js` extends `BasePanel`. Registered in `layout-manager.js` as `'camera-view-panel'`.

- **Opens as floating panel** (320×240 default) when "Camera" is selected in the CenterPanel camera dropdown
- **Owns its own dedicated `WebGLRenderer`** — NEVER shares RendererManager's renderer
- Renders the scene from the user-placed scene camera (not the editor's orbit camera)
- Fully dockable, resizable, closeable via dockview
- On close: call `cameraRenderer.dispose()`; on reopen: recreate renderer

```js
// CameraViewPanel setup:
const cameraRenderer = new THREE.WebGLRenderer({ antialias: true })
cameraRenderer.setSize(320, 240)
cameraRenderer.setPixelRatio(window.devicePixelRatio)
panelElement.appendChild(cameraRenderer.domElement)

// In animation loop (separate from ViewportEngine's loop):
cameraRenderer.render(scene, userCamera)
```

---

## 31. Complete Event Map — 31 Events

All events dispatched on `window`. All details are in `event.detail`.

| Event | Fired By | Listened By | Detail |
|---|---|---|---|
| `cyco-vp-tool` | LeftToolbarPanel | TransformGizmo | `{ mode: 'translate'|'rotate'|'scale' }` |
| `cyco-vp-viewmode` | LeftToolbarPanel | ViewportEngine | `{ mode: string }` |
| `cyco-vp-rendermode` | CenterPanel | RenderModeManager | `{ mode: string }` |
| `cyco-vp-camera` | CenterPanel | ViewportEngine + CameraViewPanel | `{ view: 'top'|'front'|'right'|... }` |
| `cyco-vp-stats-toggle` | CenterPanel (Stats btn) | ViewportStats | (no detail) |
| `cyco-vp-contextmenu` | ViewportEngine (right-click) | ViewportContextMenu | `{ x, y, hit }` |
| `cyco-select-node` | SelectionManager / LeftPanel | RightPanel + TransformGizmo + OutlinePass | `{ object, type }` or `{ objects: [] }` or `null` |
| `cyco-hierarchy-add` | LeftPanel / ObjectFactory | SceneManager | `{ object, parentId }` |
| `cyco-hierarchy-remove` | LeftPanel | SceneManager | `{ id }` |
| `cyco-show-properties` | MenuBar / RightViewportPanel | RightPanel | `{ type: string, object? }` |
| `cyco-rvp-world` | RightViewportPanel | TransformGizmo | `{ isWorld: bool }` |
| `cyco-rvp-snap` | RightViewportPanel | TransformGizmo | `{ enabled: bool, value: number }` |
| `cyco-rvp-focus` | RightViewportPanel | ViewportEngine | (no detail — focus on selected) |
| `cyco-renderer-change` | RendererProperties | RendererManager + PostProcessingPipeline | `{ type: string }` |
| `cyco-apply-material` | MaterialBrowser (drag-drop) | SceneManager | `{ materialId, targetObjectId }` |
| `cyco-pathtrace-samples` | RendererManager (PathTracer) | RendererProperties | `{ samples: number }` |
| `cyco-camera-type-change` | CameraProperties | SceneManager | `{ newCamera, oldCamera }` |
| `cyco-command-execute` | any panel | CommandManager | `{ command }` |
| `cyco-history-change` | CommandManager | CenterPanel | `{ history, currentIndex }` |
| `cyco-scene-switch` | LeftPanel | SceneManager + ViewportEngine | `{ id }` |
| `cyco-scene-add` | LeftPanel | SceneManager | `{ name }` |
| `cyco-scene-remove` | LeftPanel | SceneManager | `{ id }` |
| `cyco-runtime-play` | CenterPanel (▶ btn) | GameRuntime + TransformGizmo + LeftPanel + SelectionManager | (no detail) |
| `cyco-runtime-stop` | CenterPanel (⬡ btn) | GameRuntime + TransformGizmo + LeftPanel + SelectionManager | (no detail) |
| `cyco-grid-settings-change` | GridProperties / Preferences | ViewportEngine + TransformGizmo | `{ divisions, size, color, axisColors, opacity, gridVisible, axesVisible }` |
| `cyco-preferences-change` | PreferencesWindow | InputManager + TransformGizmo + ViewportStats + RendererManager | `{ prefs }` (full prefs object) |
| `cyco-object-visibility-change` | LeftPanel (eye toggle) | SceneManager | `{ id, visible }` |
| `cyco-loading-progress` | LoadingManager | ViewportEngine (progress overlay) | `{ url, loaded, total, pct }` |
| `cyco-camera-type-change` | CameraProperties | SceneManager | `{ newCamera }` |
| `cyco-show-properties` | MenuBar / RightViewportPanel | RightPanel | `{ type, object? }` |
| `cyco-vp-contextmenu` | ViewportEngine | ViewportContextMenu | `{ x, y, hit? }` |

---

## 32. Key Files to Modify

| File | Change |
|---|---|
| `editor/index.html` | Add `<script type="importmap">` |
| `editor/src/main.js` | Initialize + wire all viewport modules |
| `editor/src/panels/CenterPanel.js` | Add toolbar buttons: Undo/H/Redo, ▶Play/⬡Stop, Stats; wire dropdowns |
| `editor/src/panels/RightPanel.js` | Dynamic property panel swapper |
| `editor/src/panels/LeftPanel.js` | Wire eye/lock/checkbox/group/drag-drop + scene switcher to Three.js |
| `editor/src/panels/RightViewportPanel.js` | Add Grid Settings button between Snap and Focus |
| `editor/src/panels/BottomPanel.js` | Add "Materials" tab; mount MaterialBrowser |
| `editor/src/ui/MenuBar.js` | Wire File (New/Open/Save/Export) + Edit (Undo/Redo/Preferences) + Environment |
| `editor/src/layout-manager.js` | Register `'camera-view-panel'` component |
| `editor/src/project/ProjectManager.js` | Implement File System Access API for project save/load/open |

---

## 33. Implementation Phases 0–14 (37 Steps)

Execute phases in order. Steps within a phase can be parallelized if their dependency is satisfied.

### Phase 0 — Docs (complete — this file)
1. ✅ Create `DevDocs/VIEWPORT_PLAN.md`

### Phase 1 — Download Libraries (no deps)
2. Run PowerShell `Invoke-WebRequest` script to download all files from jsDelivr to `editor/libs/`:
   - `three/build/three.module.min.js`
   - `three/build/three.webgpu.min.js`
   - All `three/addons/` JS files listed in Section 4
   - DRACO decoder wasm+js to `three/addons/libs/draco/`
   - KTX2 basis_transcoder to `three/addons/libs/basis/`
   - `fonts/helvetiker_regular.typeface.json`
   - `postprocessing/index.js` (pmndrs)
   - `three-gpu-pathtracer/index.module.js`
   - `three-mesh-bvh/index.module.js`

### Phase 2 — Import Map (depends on 1)
3. Add `<script type="importmap">` to `editor/index.html` (see Section 5)

### Phase 3 — Core Renderer (depends on 2)
4. Create `editor/src/viewport/RendererManager.js`
5. Create `editor/src/viewport/ViewportEngine.js` (includes IBL, Timer, ViewHelper, LoadingManager)
6. Create `editor/src/viewport/ViewportStats.js`

### Phase 4 — Scene & Objects (depends on 3)
7. Create `editor/src/viewport/SceneManager.js`
8. Create `editor/src/viewport/ObjectFactory.js`

### Phase 4.5 — Selection + Input (parallel with 4)
9. Create `editor/src/viewport/SelectionManager.js` (uses SelectionBox + SelectionHelper)
10. Create `editor/src/viewport/InputManager.js`

### Phase 5 — Gizmos (depends on 4)
11. Create `editor/src/viewport/TransformGizmo.js`

### Phase 6 — Render Modes + Post-Processing (depends on 3)
12. Create `editor/src/viewport/RenderModeManager.js`
13. Create `editor/src/viewport/PostProcessingPipeline.js`

### Phase 6.5 — CommandManager + GameRuntime (parallel with 6)
14. Create `editor/src/viewport/CommandManager.js`
15. Create `editor/src/viewport/GameRuntime.js`

### Phase 7 — Camera View Panel (depends on 3)
16. Create `editor/src/panels/CameraViewPanel.js`
17. Update `editor/src/layout-manager.js` — register `'camera-view-panel'`
18. Update `editor/src/panels/CenterPanel.js` — toolbar buttons + dropdowns

### Phase 8 — Properties Panels (depends on 5, parallel with 7)
19. Create `editor/src/properties/ObjectProperties.js`
20. Create `editor/src/properties/CameraProperties.js`
21. Create `editor/src/properties/RendererProperties.js`
22. Create `editor/src/properties/LightingProperties.js`
23. Create `editor/src/properties/EnvironmentProperties.js`
24. Create `editor/src/properties/PostProcessingProperties.js`
25. Create `editor/src/properties/GridProperties.js`
26. Create `editor/src/properties/LODProperties.js`
27. Create `editor/src/properties/InstancedMeshProperties.js`

### Phase 8.5 — Preferences (parallel with 8)
28. Create `editor/src/ui/PreferencesWindow.js`
29. Update `editor/src/ui/MenuBar.js` — add Edit → Preferences

### Phase 9 — Materials Tab (depends on 3)
30. Create `editor/src/viewport/MaterialLibrary.js`
31. Create `editor/src/ui/MaterialBrowser.js`
32. Update `editor/src/panels/BottomPanel.js` — add Materials tab

### Phase 10 — Project Save/Load (depends on 4)
33. Update `editor/src/project/ProjectManager.js` — File System Access API

### Phase 11 — RightPanel Swapper (depends on 8, 9)
34. Update `editor/src/panels/RightPanel.js` — dynamic property swapper

### Phase 12 — Hierarchy + MenuBar (parallel with 11)
35. Update `editor/src/panels/LeftPanel.js` — Three.js wiring
36. Update `editor/src/ui/MenuBar.js` — File/Edit/Environment wiring + Export submenu
37. Update `editor/src/panels/RightViewportPanel.js` — Grid Settings button

### Phase 13 — Context Menu (depends on 4)
38. Create `editor/src/viewport/ViewportContextMenu.js`

### Phase 14 — Bootstrap (depends on all)
39. Update `editor/src/main.js` — instantiate + wire all modules (see Section 6)

---

## 34. Verification Checklist (32 Tests)

Run these tests after full implementation. Each must pass before shipping.

1. Chrome loads `editor/index.html` via HTTP — viewport is immediately live with default scene (grid, ambient+hemi light, perspective camera). No project required.
2. Console is clean — no `THREE.ColorManagement` warnings, no texture colorspace errors.
3. IBL: `MeshStandardMaterial` sphere is lit by room environment (not black). Confirm PMREMGenerator disposed (no leak warning).
4. Left-click drag = orbit; middle-click drag = pan; scroll = zoom; right-click = context menu (no orbit).
5. Click a mesh → orange outline (OutlinePass) + faint emissive tint. Click empty → deselect.
6. Box marquee: click-drag on empty area → `SelectionHelper` draws dashed rectangle → release → enclosed objects enter `SelectionManager.selected`. No custom CSS overlay used.
7. W / E / R keys switch gizmo mode (Translate / Rotate / Scale). Gizmo appears on selected object.
8. Drag gizmo handle → object moves; camera does NOT orbit during drag.
9. Locked object (lock icon in hierarchy) → gizmo does NOT attach.
10. ViewHelper (top-right corner) shows XYZ axes. Clicking an axis snaps camera to that view.
11. **▶ Play** (green) → "PLAYING" badge appears top-right, hierarchy locked, gizmo hidden, button becomes red ⬡.
12. **⬡ Stop** (red) → scene restored from snapshot, hierarchy unlocked, button returns to ▶.
13. Camera dropdown: Top / Front / Left / Right / Bottom snaps view. "Camera" opens `CameraViewPanel` floating panel.
14. CameraViewPanel renders from scene camera; dockable / resizable / closeable.
15. Renderer dropdown: cycle all 5 types. WebGPU: shows "unavailable" notice if browser lacks WebGPU.
16. Post-processing (WebGL): GTAOPass shows AO on ground plane. UnrealBloomPass glow on emissive object. OutputPass applies tone mapping (not washed out).
17. PostProcessingProperties sliders update effects live.
18. Render mode "Wireframe" → all meshes show wireframe. Switching back restores originals.
19. Add RectAreaLight from hierarchy → no console error about `RectAreaLightTexturesLib`. Light illuminates scene correctly.
20. Lensflare added as child of PointLight → flare visible in viewport.
21. Stats button → FPS + draw calls + triangles overlay. Toggle off → overlay hidden.
22. Ctrl+Z / Ctrl+Y undo/redo works. H dropdown shows history list. Clicking past entry restores that state.
23. Undo/Redo toolbar buttons (← →) are disabled (opacity 0.4) at stack boundaries.
24. Grid Settings button (RightViewportPanel) → GridProperties in right panel. Change divisions → grid rebuilds instantly.
25. Edit → Preferences → rebind a key → works immediately (no reload required, persists in localStorage).
26. File → New Project → directory picker → project.json written. File → Save → scene JSON written to `assets/scenes/`. File → Open → scene reloads.
27. Scene switcher: add / rename / switch / remove scenes. Switching updates viewport hierarchy.
28. SkinnedMesh selected → SkeletonHelper toggle in ObjectProperties shows bone wireframe. Duplicate SkinnedMesh → skeleton intact (via `SkeletonUtils.clone`).
29. LOD selected → LOD sub-panel; add a level; active level indicator updates as camera moves.
30. InstancedMesh selected → instance count field + per-instance matrix table.
31. Drop GLTF with animations onto viewport → loading bar appears → model loads → Animations sub-panel shows clip list → play/pause/scrub works.
32. File → Export → GLTF → `.glb` downloads. OBJ → `.obj` downloads. No server required.

---

## 35. Future Phases 15–18

These are **not implemented** in this rollout. Hooks are stubbed in GameRuntime.

### Phase 15 — Physics Engine
- Library: `@dimforge/rapier3d-compat` (WASM)
- Files: `PhysicsManager.js`, collider component in ObjectProperties
- GameRuntime hook: `PhysicsManager.step(delta)` per frame
- Collider wireframe visualizer (RapierHelper from Three.js addons)

### Phase 16 — Scripting / Component System
- Script component in ObjectProperties (file path → JS module)
- `onStart()` / `onUpdate(delta)` / `onDestroy()` hooks
- GameRuntime calls: `onStart()` at play(), `onUpdate(delta)` each frame, `onDestroy()` at stop()
- Auto-exposed properties inspector (serialize script exported variables to properties panel)

### Phase 17 — Timeline / Animation Editor
- New BottomPanel tab: "Timeline"
- Keyframe diamonds on timeline tracks
- Curve editor (bezier handles)
- `THREE.AnimationClip` + `THREE.KeyframeTrack` authoring
- Export to GLTF with embedded animations

### Phase 18 — WebXR
- `renderer.xr.enabled = true`
- `VRButton` and `ARButton` from `three/addons/webxr/VRButton.js` / `ARButton.js`
- Toggle in RendererProperties
- XR controller raycasting for in-headset scene interaction
