# Ambient Occlusion in Cyco Engine 4

## Overview

Cyco Engine 4 supports four ambient occlusion (AO) techniques, accessible from the **Post Processing → Ambient Occlusion** properties panel. The active AO type is stored in `PostProcessingPipeline._aoType` and the pass is inserted directly after the RenderPass (before Bloom) in the EffectComposer chain.

---

## AO Types

| Type | Class | Renderer | Import Path |
|------|-------|----------|-------------|
| GTAO | `GTAOPass` | WebGL | `three/addons/postprocessing/GTAOPass.js` |
| SAO  | `SAOPass`  | WebGL | `three/addons/postprocessing/SAOPass.js`  |
| SSAO | `SSAOPass` | WebGL | `three/addons/postprocessing/SSAOPass.js` |
| AO   | TSL `ao()` node | WebGPU only | `three/addons/tsl/display/GTAONode.js` |

---

## Critical: Camera Scale Calibration

The engine camera uses `near=0.1, far=10000`. Both SAO and SSAO have parameters
that are calibrated against the camera far plane and must be tuned for this range.
The official Three.js examples use completely different camera scales, so their
default parameter values are wrong for this engine without adjustment. See the
calibrated defaults in each section below.

---

## 1. GTAO — Ground Truth Ambient Occlusion (WebGL)

**Best quality, most expensive. Recommended for high-end scenes.**

### Pipeline Setup
```js
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';

const gtaoPass = new GTAOPass(scene, camera, width, height);
gtaoPass.output = GTAOPass.OUTPUT.Default; // 0 = composite mode
composer.addPass(gtaoPass);
// GTAOPass has needsSwap=true — reads readBuffer, writes to writeBuffer
```

### AO Parameters (via `gtaoPass.updateGtaoMaterial(params)`)

| Parameter | Default | UI Range | Description |
|-----------|---------|----------|-------------|
| `radius` | 0.25 | 0.01–1 | AO sample hemisphere radius in world units |
| `distanceExponent` | 1 | 1–4 | Controls how fast AO fades with distance |
| `thickness` | 1 | 0.01–10 | Max depth for AO occlusion thickness |
| `distanceFallOff` | 1 | 0–1 | Controls the distance falloff curve |
| `scale` | 1 | 0.01–2 | Global AO intensity scale |
| `samples` | 16 | 2–32 | Sample count (higher = better quality, slower) |
| `screenSpaceRadius` | false | bool | Use screen-space vs world-space radius |

### Poisson Denoise Parameters (via `gtaoPass.updatePdMaterial(params)`)

| Parameter | Default | UI Range | Description |
|-----------|---------|----------|-------------|
| `lumaPhi` | 10 | 0–20 | Luma bilateral weight |
| `depthPhi` | 2 | 0.01–20 | Depth bilateral weight |
| `normalPhi` | 3 | 0.01–20 | Normal bilateral weight |
| `radius` | 4 | 0–32 | Denoise sample radius |
| `radiusExponent` | 1 | 0.1–4 | Radius exponent for sample distribution |
| `rings` | 2 | 1–16 | Number of Poisson disk rings |
| `samples` | 8 | 2–32 | Number of denoise samples |

### Output Modes
```js
GTAOPass.OUTPUT = {
  'Off':     -1,  // no output (disable pass entirely)
  'Default':  0,  // composite — blend AO onto scene (use this for normal rendering)
  'Diffuse':  1,  // debug: diffuse buffer without AO applied
  'Depth':    2,  // debug: scene depth buffer (white=near, black=far)
  'Normal':   3,  // debug: per-face normals as RGB colors
  'AO':       4,  // debug: raw AO buffer (white=no occlusion, dark=occluded)
  'Denoise':  5,  // debug: denoised AO buffer before final blend
};
// Set via: gtaoPass.output = GTAOPass.OUTPUT.Default;
// Live update (no rebuild): pp.setAoOutputMode(4)
```

### Stored State (PostProcessingPipeline)
```js
this._aoGtaoParams = {
  output: 0,            // current output mode (0=composite by default)
  radius: 0.25,
  distanceExponent: 1,
  thickness: 1,
  distanceFallOff: 1,
  scale: 1,
  samples: 16,
  screenSpaceRadius: false,
};
this._aoPdParams = {
  lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4,
  radiusExponent: 1, rings: 2, samples: 8,
};
```

---

## 2. SAO — Scalable Ambient Occlusion (WebGL)

**Good performance/quality balance. Works well for mid-range scenes.**

### Pipeline Setup
```js
import { SAOPass } from 'three/addons/postprocessing/SAOPass.js';

// Note: constructor requires a THREE.Vector2 for the third arg (not width, height separately)
const saoPass = new SAOPass(scene, camera, new THREE.Vector2(width, height));
composer.addPass(saoPass);
// SAOPass has needsSwap=false — writes output in-place to readBuffer
// Live param updates: Object.assign(saoPass.params, newValues) — all read each frame
```

### Parameters (via `saoPass.params` — all read each frame, live updates work)

| Parameter | Calibrated Default | UI Range | Description |
|-----------|-------------------|----------|-------------|
| `saoBias` | 0.5 | -1–1 | Depth bias to avoid self-occlusion |
| `saoIntensity` | 0.18 | 0–1 | Overall AO strength |
| `saoScale` | **1000** | 0–10000, step 10 | Sample kernel scale (see calibration note below) |
| `saoKernelRadius` | 100 | 1–100 | Sample hemisphere radius in pixels |
| `saoMinResolution` | 0 | 0–1 | Minimum resolution threshold |
| `saoBlur` | true | bool | Enable depth-aware bilateral blur |
| `saoBlurRadius` | 8 | 0–200 | Blur radius in pixels |
| `saoBlurStdDev` | 4 | 0.5–150 | Blur Gaussian standard deviation |
| `saoBlurDepthCutoff` | 0.01 | 0–0.1 | Depth cutoff for blur edges |

### saoScale Calibration — CRITICAL

The SAO shader formula: `scaledScreenDistance = (saoScale / cameraFar) * viewDistance`

The Three.js example used `cameraFar=10, saoScale=1` giving a ratio of **0.1**.
This engine uses `cameraFar=10000`, so `saoScale` must equal **1000** to maintain
the same visual ratio. Using `saoScale=1` at `far=10000` results in an essentially
invisible or completely black AO pass.

| Camera Far | Required saoScale for same visual effect |
|------------|------------------------------------------|
| 10 (example) | 1 |
| 100 | 10 |
| 1000 | 100 |
| **10000 (this engine)** | **1000** |

### Output Modes
```js
SAOPass.OUTPUT = {
  'Default':  0,  // composite — multiplies AO into scene (CustomBlending DstColorFactor)
  'SAO':      1,  // debug: raw SAO buffer (NoBlending, overwrites readBuffer)
  'Normal':   2,  // debug: normal buffer (NoBlending, overwrites readBuffer)
};
// IMPORTANT: output is stored in saoPass.params.output (NOT saoPass.output directly)
// Live update: pp.setAoOutputMode(1) → sets saoPass.params.output = 1
```

### Stored State (PostProcessingPipeline)
```js
this._aoSaoParams = {
  output: 0,             // stored separately, applied to pass.params.output
  saoBias: 0.5,
  saoIntensity: 0.18,
  saoScale: 1000,        // calibrated for cameraFar=10000 (NOT 1 as in examples)
  saoKernelRadius: 100,
  saoMinResolution: 0,
  saoBlur: true,
  saoBlurRadius: 8,
  saoBlurStdDev: 4,
  saoBlurDepthCutoff: 0.01,
};
```

---

## 3. SSAO — Screen Space Ambient Occlusion (WebGL)

**Cheapest / fastest. Good for low-end hardware. Less accurate.**

### Pipeline Setup
```js
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';

const ssaoPass = new SSAOPass(scene, camera, width, height);
// After construction, explicitly copy camera uniforms (constructor uses values at creation time)
if (ssaoPass.ssaoMaterial && camera) {
  const u = ssaoPass.ssaoMaterial.uniforms;
  u['cameraNear'].value = camera.near;
  u['cameraFar'].value  = camera.far;
  u['cameraProjectionMatrix'].value.copy(camera.projectionMatrix);
  u['cameraInverseProjectionMatrix'].value.copy(camera.projectionMatrixInverse);
}
composer.addPass(ssaoPass);
// SSAOPass has needsSwap=false — writes output in-place to readBuffer
// Properties kernelRadius, minDistance, maxDistance are read each frame → live updates work
```

### Per-Frame Camera Uniform Update (in `_onTick`)

SSAO requires current camera projection data each frame (FOV/aspect may change).
Add this to the render loop:
```js
if (this.aoPass instanceof SSAOPass && this.aoPass.ssaoMaterial) {
  const cam = this.engine.camera;
  if (cam) {
    const u = this.aoPass.ssaoMaterial.uniforms;
    u['cameraNear'].value = cam.near;
    u['cameraFar'].value  = cam.far;
    u['cameraProjectionMatrix'].value.copy(cam.projectionMatrix);
    u['cameraInverseProjectionMatrix'].value.copy(cam.projectionMatrixInverse);
  }
}
```

### Parameters (direct properties on the pass)

| Property | Calibrated Default | UI Range | Description |
|----------|-------------------|----------|-------------|
| `kernelRadius` | 8 | 0–32, step 0.5 | AO sample kernel radius in pixels |
| `minDistance` | **0.00005** | 0–0.005, step 0.00001 | Min depth difference to count as occlusion |
| `maxDistance` | **0.001** | 0–0.05, step 0.0001 | Max depth difference for AO falloff |

### minDistance / maxDistance Calibration — CRITICAL

These values are in **normalised linear depth space** (0–1), computed by:
```
viewZToOrthographicDepth(z, near, far) = (z + near) / (near - far)
```

With `near=0.1, far=10000`: a 1-world-unit depth step at `z=10` ≈ **0.0001** normalised units.

The Three.js example was calibrated for `near=100, far=700`, giving ~0.00167 per world unit —
that's **16.7× larger** per unit than our camera. The example defaults:
- `minDistance=0.005` → requires a depth separation of **50+ world units** to trigger
- `maxDistance=0.1` → falloff over **1000+ world units** — effectively never triggers

**Calibrated values for this engine (`near=0.1, far=10000`):**
- `minDistance=0.00005` — triggers at ~0.5 world unit separation
- `maxDistance=0.001` — falloff over ~10 world units

### Output Modes
```js
SSAOPass.OUTPUT = {
  'Default':  0,  // composite — multiplies AO into scene (CustomBlending DstColorFactor)
  'SSAO':     1,  // debug: raw SSAO buffer before blur
  'Blur':     2,  // debug: blurred SSAO buffer
  'Depth':    3,  // debug: depth buffer
  'Normal':   4,  // debug: normal buffer
};
// Set via: ssaoPass.output = SSAOPass.OUTPUT.Default;
// Live update: pp.setAoOutputMode(1)
```

### Stored State (PostProcessingPipeline)
```js
this._aoSsaoParams = {
  output: 0,
  kernelRadius: 8,
  minDistance: 0.00005,   // calibrated — NOT the example default of 0.005
  maxDistance: 0.001,     // calibrated — NOT the example default of 0.1
};
```

---

## 4. AO via TSL GTAONode (WebGPU only)

**Requires WebGPU renderer. Uses Three.js Shader Language (TSL) node graph.**

### Pipeline Setup
```js
// Must use WebGPURenderer
import * as THREE from 'three/webgpu';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { pass, mrt, screenUV, normalView, velocity, directionToColor, builtinAOContext } from 'three/tsl';

// Pre-pass to capture normals + depth
const prePass = pass(scene, camera, { ...mrt({ output: directionToColor(normalView), velocity }) });
const prePassNormal = ...;
const prePassDepth = prePass.getTextureNode('depth');

// AO node
const aoPass = ao(prePassDepth, prePassNormal, camera);
aoPass.resolutionScale = 0.5;         // half-res AO
aoPass.useTemporalFiltering = true;

// Feed AO into scene context
scenePass.contextNode = builtinAOContext(aoPass.getTextureNode().sample(screenUV).r);
```

### Parameters (via `.value` accessors)

| Parameter | Default | Range | Description |
|-----------|---------|-------|-------------|
| `samples` | 16 | 4–32 | Number of AO samples |
| `distanceExponent` | 1 | 1–2 | Distance-based falloff exponent |
| `distanceFallOff` | 1 | 0.01–1 | Controls the falloff shape |
| `radius` | 0.25 | 0.1–1 | AO hemisphere radius |
| `scale` | 1 | 0.01–2 | Intensity scale |
| `thickness` | 1 | 0.01–2 | Occlusion thickness cap |

### Update Example
```js
aoPass.samples.value = params.samples;
aoPass.distanceExponent.value = params.distanceExponent;
aoPass.distanceFallOff.value = params.distanceFallOff;
aoPass.radius.value = params.radius;
aoPass.scale.value = params.scale;
aoPass.thickness.value = params.thickness;
```

---

## Engine Integration

### PostProcessingPipeline.js

**State properties:**
```js
this.aoPass     = null;       // active GTAOPass | SAOPass | SSAOPass | null
this._aoType    = 'gtao';     // 'gtao' | 'sao' | 'ssao' | 'ao_webgpu'
this._aoEnabled = false;

// Stored parameters — survive pipeline rebuilds, restored on rebuild
this._aoGtaoParams = { output: 0, radius: 0.25, distanceExponent: 1, thickness: 1,
  distanceFallOff: 1, scale: 1, samples: 16, screenSpaceRadius: false };
this._aoPdParams   = { lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4,
  radiusExponent: 1, rings: 2, samples: 8 };
this._aoSaoParams  = { output: 0, saoBias: 0.5, saoIntensity: 0.18, saoScale: 1000,
  saoKernelRadius: 100, saoMinResolution: 0, saoBlur: true, saoBlurRadius: 8,
  saoBlurStdDev: 4, saoBlurDepthCutoff: 0.01 };
this._aoSsaoParams = { output: 0, kernelRadius: 8, minDistance: 0.00005, maxDistance: 0.001 };
```

**API methods:**
```js
pipeline.setAoEnabled(bool)                         // toggle AO, triggers pipeline rebuild
pipeline.setAoType('gtao'|'sao'|'ssao'|'ao_webgpu') // switch type, triggers pipeline rebuild
pipeline.updateGtaoParams(obj)                      // live GTAO AO param update (no rebuild)
pipeline.updatePdParams(obj)                        // live Poisson denoise param update (no rebuild)
pipeline.updateSaoParams(obj)                       // live SAO param update (no rebuild)
pipeline.updateSsaoParams(obj)                      // live SSAO param update (no rebuild)
pipeline.setAoOutputMode(number)                    // switch debug output mode (no rebuild)
```

**`setAoOutputMode(mode)` — Output mode API:**
```js
// Stores the mode in the appropriate params object and applies it live to the pass.
// ALSO calls _applyAoDebugState() to toggle bloom/outline passes.
// GTAO: mode stored in _aoGtaoParams.output, applied to aoPass.output
// SAO:  mode stored in _aoSaoParams.output,  applied to aoPass.params.output  ← different property!
// SSAO: mode stored in _aoSsaoParams.output, applied to aoPass.output
pp.setAoOutputMode(0);  // composite (default)
pp.setAoOutputMode(4);  // AO Only (GTAO) / SAO Only (SAO) / SSAO Only (SSAO)
```

**Pipeline order (WebGL):**
```
RenderPass → [AO Pass] → UnrealBloomPass → OutlinePass → HoverOutlinePass
→ SMAAPass → OutputPass → FXAAPass → LUTPass
```

AO pass is inserted after `RenderPass` and before `UnrealBloomPass` so that AO darkening
is fed into the bloom pass — dark, occluded areas won't bloom, only bright emissives will.

### _buildAoPassForType — Pass Construction Details
```js
// GTAO
const p = new GTAOPass(scene, camera, w, h);
p.output = this._aoGtaoParams.output ?? GTAOPass.OUTPUT.Default;
p.updateGtaoMaterial(this._aoGtaoParams);
p.updatePdMaterial(this._aoPdParams);

// SAO — note: constructor takes THREE.Vector2, not separate w/h
//       and output is in params.output, not pass.output
const p = new SAOPass(scene, camera, new THREE.Vector2(w, h));
const { output: _out, ...rest } = this._aoSaoParams;
Object.assign(p.params, rest);
p.params.output = this._aoSaoParams.output ?? SAOPass.OUTPUT.Default;

// SSAO — copy camera uniforms immediately after construction
const p = new SSAOPass(scene, camera, w, h);
p.kernelRadius = this._aoSsaoParams.kernelRadius;
p.minDistance  = this._aoSsaoParams.minDistance;
p.maxDistance  = this._aoSsaoParams.maxDistance;
p.output       = this._aoSsaoParams.output ?? SSAOPass.OUTPUT.Default;
if (p.ssaoMaterial) {
  p.ssaoMaterial.uniforms['cameraNear'].value = camera.near;
  p.ssaoMaterial.uniforms['cameraFar'].value  = camera.far;
  p.ssaoMaterial.uniforms['cameraProjectionMatrix'].value.copy(camera.projectionMatrix);
  p.ssaoMaterial.uniforms['cameraInverseProjectionMatrix'].value.copy(camera.projectionMatrixInverse);
}
```

---

## Debug Output Mode — Bloom Bypass (CRITICAL)

### The Problem
In non-composite debug output modes (AO Only, Depth, Normal, etc.), the AO pass
writes its raw buffer directly into the EffectComposer's read buffer instead of
compositing with the scene.

`UnrealBloomPass` runs next with `threshold=0.85`. The raw AO buffer is mostly
**white** (value 1.0 = no occlusion). White is above the bloom threshold → the
entire debug view blooms into a solid white screen, hiding all AO debug information.

The same problem affects `OutlinePass` and `HoverOutlinePass`.

### The Fix — `_applyAoDebugState()`

```js
_applyAoDebugState() {
  // Determine stored output mode for the active AO type
  const output = this._aoEnabled
    ? ( this._aoType === 'gtao' ? (this._aoGtaoParams.output ?? 0)
      : this._aoType === 'sao'  ? (this._aoSaoParams.output  ?? 0)
      : this._aoType === 'ssao' ? (this._aoSsaoParams.output ?? 0)
      : 0 )
    : 0;
  const isDebug = (output !== 0);
  if (this.bloomPass)        this.bloomPass.enabled        = !isDebug;
  if (this.outlinePass)      this.outlinePass.enabled      = !isDebug;
  if (this.hoverOutlinePass) this.hoverOutlinePass.enabled = !isDebug;
}
```

This is called in two places:
1. **`setAoOutputMode(mode)`** — every time the output mode changes
2. **`_buildWebGLPipeline()`** — at the end of pipeline construction, so the state
   is correctly applied if the pipeline is rebuilt while in a debug mode

When output returns to 0 (composite), all three passes are re-enabled.

---

### PostProcessingProperties.js

The AO section contains:
- **Enabled** checkbox — `pp.setAoEnabled(v)`, triggers rebuild
- **Type** dropdown — `pp.setAoType(v)` if enabled, else `pp._aoType = v` for deferred apply
- **Output** dropdown — `pp.setAoOutputMode(+v)`, no rebuild, live
- **Dynamic controls** — switches parameter sliders based on selected type

**Output dropdown options per type:**

| Type | Options |
|------|---------|
| GTAO | `[[0,'Composite'],[4,'AO Only'],[5,'Denoise'],[1,'Diffuse'],[2,'Depth'],[3,'Normal']]` |
| SAO  | `[[0,'Composite'],[1,'AO Only'],[2,'Normal']]` |
| SSAO | `[[0,'Composite'],[1,'AO Only'],[2,'AO + Blur'],[3,'Depth'],[4,'Normal']]` |

**UI slider ranges (calibrated for this engine's camera scale):**

GTAO:
- Radius: 0.01–1
- Scale: 0.01–2
- Samples: 2–32

SAO:
- saoScale: 0–10000, step 10 (previously 0–10 — was wrong)
- saoIntensity: 0–1
- saoKernelRadius: 1–100

SSAO:
- kernelRadius: 0–32, step 0.5
- minDistance: 0–0.005, step 0.00001 (previously 0.001–0.02 — was wrong)
- maxDistance: 0–0.05, step 0.0001 (previously 0.01–0.3 — was wrong)

When "AO (WebGPU)" is selected with the WebGL renderer active, a message is shown
prompting the user to switch renderers.

---

## Pass Internals — `needsSwap` Differences

| Pass | `needsSwap` | Behavior |
|------|-------------|----------|
| GTAOPass | `true` | Reads from `readBuffer`, writes composite to `writeBuffer` |
| SAOPass  | `false` | In Default: CustomBlending multiplies onto `readBuffer`. In debug modes: NoBlending overwrites `readBuffer` |
| SSAOPass | `false` | Same as SAO — in-place to `readBuffer` |

This matters for pipeline ordering: SAO/SSAO modify `readBuffer` in place, so
subsequent passes (Bloom etc.) see the modified buffer automatically.

---

## Performance Notes

| Type | GPU Cost | Quality | Notes |
|------|----------|---------|-------|
| GTAO | High | Best | Includes Poisson denoising pass |
| SAO  | Medium | Good | Depth-aware bilateral blur |
| SSAO | Low | Basic | Simple screen-space samples |
| AO (WebGPU) | Medium | Best | Temporal filtering; WebGPU only |

---

## File Locations

| File | Path |
|------|------|
| GTAOPass | `editor/libs/three/addons/postprocessing/GTAOPass.js` |
| SAOPass  | `editor/libs/three/addons/postprocessing/SAOPass.js` |
| SSAOPass | `editor/libs/three/addons/postprocessing/SSAOPass.js` |
| GTAOShader | `editor/libs/three/addons/shaders/GTAOShader.js` |
| SAOShader  | `editor/libs/three/addons/shaders/SAOShader.js` |
| SSAOShader | `editor/libs/three/addons/shaders/SSAOShader.js` |
| PoissonDenoiseShader | `editor/libs/three/addons/shaders/PoissonDenoiseShader.js` |
| DepthLimitedBlurShader | `editor/libs/three/addons/shaders/DepthLimitedBlurShader.js` |
| PostProcessingPipeline | `editor/src/viewport/PostProcessingPipeline.js` |
| PostProcessingProperties | `editor/src/properties/PostProcessingProperties.js` |

---

## Reference App Research Notes (2025)

### CeralBnB (WebGL)
- Uses **only texture `aoMap`** — no screen-space AO pass of any kind.
- `MeshStandardMaterial.aoMapIntensity` controls baked AO strength.
- Confirms: texture AO is the lowest-cost baseline, but it only works for pre-baked/static scenes.

### Lumen Decor Studio (WebGPU / TSL)
- Uses a TSL **`AONode`** that injects into the PBR lighting model context via:
  ```js
  context.ambientOcclusion.mulAssign(this.aoNode);
  ```
  This is a multiplicative injection — exactly the same approach used by our planned `GTAONode`
  pipeline (post-multiply onto the composite output). **Confirms the planned two-pass multiplicative
  AO approach is correct.**

- The TSL PBR model (`bw` class) applies AO in two places inside the lighting loop:
  1. **Diffuse (indirect):** `indirectDiffuse.mulAssign(ao)` — standard irradiance darkening
  2. **Specular horizon occlusion:** `reflectedLight.specularIndirect.mulAssign( dotNV.clamp().add(ao).sub(1.0).pow(exp2(-16*roughness-1)).clamp() )`
     This is a horizon-based specular AO term that correctly removes specular leaking in crevices.
  3. **Clearcoat, Sheen, Iridescence** — each also multiplied by AO.

- `builtinAOContext` (the planned TSL helper that wraps the AO texture into a context node) was found
  to **not work** in the engine's current two-pass setup. The correct working approach is:
  ```js
  // Correct: manually compose the AO result using multiply blend mode
  const aoTexture = aoPass.getTextureNode().sample(screenUV).r;
  outputNode = mul(scenePassColor, aoTexture);
  ```

### Key Takeaway
Both apps confirm: **multiplicative AO compositing is the production standard** for screen-space AO
in Three.js. No app surveyed uses additive AO or a separate light-masking AO pass. The `builtinAOContext`
TSL helper is the intended API but has known integration issues; manual multiply-blend compositing
is the reliable fallback.

### TSL AO Pipeline Confirmation (from `webgpu-ao-pipeline.md` memory)
```
Pre-pass (MRT):  normals → directionToColor(normalView)  → normal texture
AO pass:         ao(depthNode, normalNode, camera)        → AO texture (0=occluded, 1=open)
Scene pass:      standard PBR render                     → color texture
Composite:       sceneColor * aoValue                    → final output
```
AO value range in open spaces: ~0.89–1.0. Cavities/corners: ~0.4–0.7.
