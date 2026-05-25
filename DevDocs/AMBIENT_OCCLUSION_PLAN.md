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

## 1. GTAO — Ground Truth Ambient Occlusion (WebGL)

**Best quality, most expensive. Recommended for high-end scenes.**

### Pipeline Setup
```js
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';

const gtaoPass = new GTAOPass(scene, camera, width, height);
gtaoPass.output = GTAOPass.OUTPUT.Denoise; // composite mode
composer.addPass(gtaoPass);
```

### AO Parameters (via `gtaoPass.updateGtaoMaterial(params)`)

| Parameter | Default | Range | Description |
|-----------|---------|-------|-------------|
| `radius` | 0.25 | 0.01–1 | AO sample hemisphere radius in world units |
| `distanceExponent` | 1 | 1–4 | Controls how fast AO fades with distance |
| `thickness` | 1 | 0.01–10 | Max depth for AO occlusion thickness |
| `distanceFallOff` | 1 | 0–1 | Controls the distance falloff curve |
| `scale` | 1 | 0.01–2 | Global AO intensity scale |
| `samples` | 16 | 2–32 | Sample count (higher = better quality, slower) |
| `screenSpaceRadius` | false | bool | Use screen-space vs world-space radius |

### Poisson Denoise Parameters (via `gtaoPass.updatePdMaterial(params)`)

| Parameter | Default | Range | Description |
|-----------|---------|-------|-------------|
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
  'Off': -1,        // no output
  'Default': 0,     // standard blend
  'Diffuse': 1,     // show diffuse only
  'Depth': 2,       // show depth buffer
  'Normal': 3,      // show normal buffer
  'AO': 4,          // show raw AO
  'Denoise': 5,     // final composited AO (recommended)
};
```

---

## 2. SAO — Scalable Ambient Occlusion (WebGL)

**Good performance/quality balance. Works well for mid-range scenes.**

### Pipeline Setup
```js
import { SAOPass } from 'three/addons/postprocessing/SAOPass.js';

const saoPass = new SAOPass(scene, camera);
composer.addPass(saoPass);
```

### Parameters (via `saoPass.params`)

| Parameter | Default | Range | Description |
|-----------|---------|-------|-------------|
| `saoBias` | 0.5 | -1–1 | Depth bias to avoid self-occlusion |
| `saoIntensity` | 0.18 | 0–1 | Overall AO strength |
| `saoScale` | 1 | 0–10 | Sample kernel scale |
| `saoKernelRadius` | 100 | 1–100 | Sample hemisphere radius in pixels |
| `saoMinResolution` | 0 | 0–1 | Minimum resolution threshold |
| `saoBlur` | true | bool | Enable depth-aware bilateral blur |
| `saoBlurRadius` | 8 | 0–200 | Blur radius in pixels |
| `saoBlurStdDev` | 4 | 0.5–150 | Blur Gaussian standard deviation |
| `saoBlurDepthCutoff` | 0.01 | 0–0.1 | Depth cutoff for blur edges |

### Output Modes
```js
SAOPass.OUTPUT = { 'Default': 0, 'SAO': 1, 'Normal': 2 };
```

---

## 3. SSAO — Screen Space Ambient Occlusion (WebGL)

**Cheapest / fastest. Good for low-end hardware. Less accurate.**

### Pipeline Setup
```js
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';

const ssaoPass = new SSAOPass(scene, camera, width, height);
composer.addPass(ssaoPass);
```

### Parameters (direct properties)

| Property | Default | Range | Description |
|----------|---------|-------|-------------|
| `kernelRadius` | 8 | 0–32 | AO sample kernel radius |
| `minDistance` | 0.005 | 0.001–0.02 | Min depth difference to count as occlusion |
| `maxDistance` | 0.1 | 0.01–0.3 | Max depth difference for AO falloff |

### Output Modes
```js
SSAOPass.OUTPUT = { 'Default': 0, 'SSAO': 1, 'Blur': 2, 'Depth': 3, 'Normal': 4 };
```

---

## 4. AO via TSL GTAONode (WebGPU only)

**Requires WebGPU renderer. Uses Three.js Shader Language (TSL) node graph.**

### Pipeline Setup
```js
// Must use WebGPURenderer
import * as THREE from 'three/webgpu';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { pass, mrt, screenUV, normalView, velocity, directionToColor, colorToDirection, builtinAOContext } from 'three/tsl';

// Pre-pass to capture normals + depth
const prePass = pass(scene, camera, { ...mrt({ output: directionToColor(normalView), velocity }) });
const prePassNormal = ...;
const prePassDepth = prePass.getTextureNode('depth');

// AO node
aoPass = ao(prePassDepth, prePassNormal, camera);
aoPass.resolutionScale = 0.5;       // half-res AO
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
this.aoPass     = null;   // active GTAOPass | SAOPass | SSAOPass | null
this._aoType    = 'gtao'; // 'gtao' | 'sao' | 'ssao' | 'ao_webgpu'
this._aoEnabled = false;

// Stored parameters (survive pipeline rebuilds)
this._aoGtaoParams = { radius, distanceExponent, thickness, distanceFallOff, scale, samples, screenSpaceRadius };
this._aoPdParams   = { lumaPhi, depthPhi, normalPhi, radius, radiusExponent, rings, samples };
this._aoSaoParams  = { saoBias, saoIntensity, saoScale, saoKernelRadius, saoMinResolution, saoBlur, saoBlurRadius, saoBlurStdDev, saoBlurDepthCutoff };
this._aoSsaoParams = { kernelRadius, minDistance, maxDistance };
```

**API methods:**
```js
pipeline.setAoEnabled(bool)     // toggle, triggers rebuild
pipeline.setAoType('gtao'|'sao'|'ssao'|'ao_webgpu')  // triggers rebuild
pipeline.updateGtaoParams(obj)  // live GTAO param update (no rebuild)
pipeline.updatePdParams(obj)    // live Poisson denoise param update
pipeline.updateSaoParams(obj)   // live SAO param update
pipeline.updateSsaoParams(obj)  // live SSAO param update
```

**Pipeline order (WebGL):**
```
RenderPass → [AO Pass] → UnrealBloomPass → OutlinePass → HoverOutlinePass
→ SMAAPass → OutputPass → FXAAPass → LUTPass
```

### PostProcessingProperties.js

The AO section contains:
- **Enabled** checkbox — toggles AO on/off
- **Type** dropdown — GTAO (WebGL) / SAO (WebGL) / SSAO (WebGL) / AO (WebGPU)
- **Dynamic controls** — switches to the appropriate parameter sliders based on type

When "AO (WebGPU)" is selected with the WebGL renderer active, a message is shown prompting the user to switch renderers.

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
