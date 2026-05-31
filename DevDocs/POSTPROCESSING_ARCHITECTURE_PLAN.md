# Post-Processing Architecture Plan
## Per-Object Independent Post-Processing with a Shared Render Pipeline

---

## Overview

This document outlines the recommended architecture for Cyco Engine's post-processing system. The goal is to allow objects, the environment, and the gizmo to each independently control how much post-processing they receive (bloom intensity, outline weight, etc.) while sharing a single scene render pass — meaning the scene geometry is only drawn **once** per frame.

---

## Core Concept: MRT + FX Weight Buffer

### How It Works

Instead of rendering the scene once and applying a full-screen post-processing effect uniformly, the engine uses **Multiple Render Targets (MRT)** to simultaneously write two textures in a single geometry pass:

| Render Target | Contents | Format |
|---|---|---|
| `colorBuffer` | Scene color (HDR) | `RGBA16F` |
| `fxWeightBuffer` | Per-pixel effect weights | `RGBA8` |

The `fxWeightBuffer` encodes up to 4 independent effect weights per pixel, packed into 8 bits per channel:

| Channel | Effect |
|---|---|
| R | Bloom intensity (0.0 – 1.0) |
| G | Outline weight (0.0 – 1.0) |
| B | Reserved (future: depth-of-field, chromatic aberration) |
| A | Reserved (future: vignette, custom effect) |

Each material on each object writes its own desired weights into this buffer. The post-processing shaders then read both buffers and blend results proportionally. The scene geometry is only transformed and shaded **once**.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    GEOMETRY PASS (1× per frame)             │
│                                                             │
│  Objects / Environment / Gizmo                              │
│         │                                                   │
│         ▼                                                   │
│  ┌──────────────┐    ┌─────────────────────┐               │
│  │  colorBuffer  │    │  fxWeightBuffer     │               │
│  │  (RGBA16F)   │    │  R=bloom G=outline   │               │
│  │  HDR scene   │    │  B=reserved A=reserve│               │
│  └──────┬───────┘    └──────────┬──────────┘               │
└─────────┼───────────────────────┼──────────────────────────┘
          │                       │
          ▼                       ▼
┌─────────────────────────────────────────────────────────────┐
│                  POST-PROCESSING PASSES                      │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Bloom Pass (at 1/4 resolution)                     │   │
│  │  Reads: colorBuffer × fxWeightBuffer.R              │   │
│  │  Output: bloomTexture                               │   │
│  └──────────────────────┬──────────────────────────────┘   │
│                         │                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Outline Pass (at full or 1/2 resolution)           │   │
│  │  Reads: depth/stencil × fxWeightBuffer.G            │   │
│  │  Output: outlineTexture                             │   │
│  └──────────────────────┬──────────────────────────────┘   │
│                         │                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Composite / Tone-map Pass                          │   │
│  │  Inputs: colorBuffer + bloomTexture + outlineTexture │   │
│  │  Output: final framebuffer                          │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## Per-Domain Control

Each rendering domain sets its own FX weight values on its materials:

### Objects (Scene Meshes)
- Default bloom weight: set per-material in the properties panel
- Objects can individually opt in/out of outline and bloom via `ObjectProperties`
- Stored in scene data as material metadata

### Environment (Sky, Fog, Background)
- Sky/gradient typically has bloom = 0.0 (already bright, bloom would wash out)
- Can be enabled for stylized/neon environments
- Controlled via `EnvironmentProperties`

### Gizmo (Transform handles, selection highlights)
- Bloom weight: 0.0 (gizmo should never bloom — it's a UI element)
- Outline weight: controlled separately by `SelectionManager` highlight system
- These are hard-coded to safe defaults in the gizmo material setup

---

## Three.js Implementation Path

### WebGPU Path (Primary — Recommended)

Uses Three.js TSL (Three.js Shading Language) with the `PostProcessing` class:

```javascript
import { mrt, output, float, vec4 } from 'three/tsl';

// On each material:
material.outputNode = mrt({
  color:    output,                          // normal color output
  fxWeight: vec4(bloomIntensity, outlineWeight, 0, 0)
});
```

```javascript
// Render target with 2 outputs:
const renderTarget = new THREE.WebGLRenderTarget(w, h, {
  count: 2,   // MRT — 2 simultaneous outputs
  type: THREE.HalfFloatType
});

// Post-processing:
const postProcessing = new PostProcessing(renderer);
// Custom bloom node reads fxWeight.r as multiplier
```

### WebGL2 Path (Fallback)

Uses `WebGLMultipleRenderTargets` + `EffectComposer`:

```javascript
const mrt = new THREE.WebGLMultipleRenderTargets(w, h, 2);
mrt.texture[0].name = 'colorBuffer';
mrt.texture[1].name = 'fxWeightBuffer';
mrt.texture[1].type = THREE.UnsignedByteType; // RGBA8 — 4 packed weights

// Render scene to MRT:
renderer.setRenderTarget(mrt);
renderer.render(scene, camera);
renderer.setRenderTarget(null);
```

---

## Weight Buffer: Per-Object Assignment

Each object exposes 4 sliders in its properties panel (R/G/B/A channels of the FX weight buffer). Materials are patched with a custom `ShaderMaterial` override or `onBeforeCompile` hook that writes the object's weight values into `gl_FragData[1]` (WebGL2) or the TSL `mrt` output.

```glsl
// WebGL2 fragment shader injection (via onBeforeCompile):
// gl_FragData[0] = normal color output
// gl_FragData[1] = vec4(bloomIntensity, outlineWeight, 0.0, 1.0)
```

---

## Bloom Pass Implementation Detail

To avoid blooming pixels that don't want it, the bloom pass masks by the weight channel:

```glsl
// Bloom prefilter shader:
vec3 color     = texture2D(colorBuffer, uv).rgb;
float bloomW   = texture2D(fxWeightBuffer, uv).r;
vec3 brightPass = max(color - threshold, 0.0) * bloomW;
// brightPass feeds into the Gaussian blur chain
```

The bloom blur runs at **1/4 resolution** (standard technique — output is upscaled and additively blended onto the final composite).

---

## Outline Pass Implementation Detail

Outlines are computed from either:
- **Depth/normal discontinuities** — edge detection shader (Sobel filter)
- **Stencil buffer** — objects that want outlines write to stencil during geometry pass

The `fxWeightBuffer.G` channel modulates the outline's opacity:

```glsl
float edge      = detectEdge(depthBuffer, normalBuffer, uv);
float outlineW  = texture2D(fxWeightBuffer, uv).g;
vec4 outlineColor = selectionColor * edge * outlineW;
```

---

## Capability Tiers

Not all hardware supports MRT equally. The engine selects a tier at startup:

| Tier | Criteria | Post-Processing Mode |
|---|---|---|
| **Tier 3 — Full** | Desktop GPU, WebGPU or WebGL2 | Full MRT: color + RGBA8 weight buffer |
| **Tier 2 — Reduced** | Mid-range GPU, WebGL2 | Alpha channel only (1 effect weight) |
| **Tier 1 — Minimal** | Mobile/low-end | Binary THREE.Layers approach |
| **Tier 0 — Off** | Very low-end / explicit disable | No post-processing |

```javascript
// Tier detection at engine startup (PostProcessingPipeline.js):
const tier = detectGPUTier(renderer);
// Uses: renderer.capabilities.isWebGL2, renderer.capabilities.maxTextures,
//       optional: 'detect-gpu' npm package for GPU scoring
```

---

## Reference App Research Notes (2025)

> Analysis of CeralBnB (WebGL) and Lumen Decor Studio (WebGPU/TSL) to extract shadow, interior lighting, and post-processing patterns.

### Shadows

**CeralBnB (WebGL):**
- Uses standard Three.js PCF soft shadows (`THREE.PCFSoftShadowMap`).
- The shadow GLSL (injected via `onBeforeCompile`) uses a **Vogel disk** pattern with 5 taps:
  ```glsl
  float phi = interleavedGradientNoise(gl_FragCoord.xy) * 6.28318530718;
  for (int i = 0; i < 5; i++) {
    vec2 offset = vogelDiskSample(i, 5, phi) * filterRadius;
    shadow += texture2DShadowLerp(shadowMap, shadowCoord + offset);
  }
  shadow /= 5.0;
  ```
  Also uses VSM (Variance Shadow Maps) for some lights: shadow map stores `vec4(mean, std_dev, 0, 0)`.
- **Conclusion:** Standard Three.js shadow maps. No custom shadow pipeline needed beyond tuning `shadowMap.type` and `light.shadow.radius`.

**Lumen Decor Studio (WebGPU/TSL):**
- Uses the Three.js TSL `ShadowNode` (`dI` class in the bundle) which wraps the same shadow logic in node form.
- Three filter modes are available as TSL nodes:
  | Mode | TSL Node | Description |
  |---|---|---|
  | PCF | `F$` class | Poisson/Vogel 5-tap + `QP(Mg.xy).mul(6.28318530718)` jitter |
  | VSM | `V$` class | Ping-pong blur passes; stores mean + variance |
  | Basic | `I$` class | Single tap |
- Shadow intensity exposed as a uniform: `shadow.intensity` on the light node.
- **Conclusion:** TSL shadow nodes are drop-in equivalents to WebGL shadow maps. When Cyco Engine moves to WebGPU primary, shadows require no special handling — Three.js TSL shadow nodes are automatic.

### Interior Lighting Patterns

Both apps use only **standard Three.js lights** for interior scenes. There is no custom "interior lighting" rendering technique in either app. High-quality results come from:

1. **Tight shadow frustum** — Set `light.shadow.camera.near` and `.far` to tightly encompass only the room geometry. This maximizes shadow map resolution per texel.
2. **Small `light.distance`** for point/spot lights** — Limits falloff to room scale; prevents lights from bleeding through walls.
3. **PMREM environment map** — `scene.environment` from an interior HDRI (`RGBELoader`) handles realistic reflections and soft fill light. This is the single biggest quality driver for interior scenes.
4. **Lightmap bake** — `material.lightMap` + `material.lightMapIntensity` for static indirect lighting. Use Three.js `ProgressiveLightMap` to bake in-engine.
5. **Hemisphere light** for sky/ground ambient fill — prevents pure-black shadows in indirect areas.

```js
// Recommended interior light setup (from reference app analysis):
const ceiling = new THREE.PointLight(0xfff5e0, 2, 8, 2); // warm, 8-unit radius, quadratic falloff
ceiling.castShadow = true;
ceiling.shadow.mapSize.set(1024, 1024);
ceiling.shadow.camera.near = 0.1;
ceiling.shadow.camera.far  = 10;     // tight frustum = sharp shadows

const fill = new THREE.HemisphereLight(0x8888ff, 0x222200, 0.3); // soft sky/ground fill

// PMREM IBL:
const pmremGen = new THREE.PMREMGenerator(renderer);
pmremGen.compileEquirectangularShader();
const hdrTexture = await new RGBELoader().loadAsync('interior.hdr');
scene.environment = pmremGen.fromEquirectangular(hdrTexture).texture;
hdrTexture.dispose();
pmremGen.dispose();
```

### IBL (Image-Based Lighting) — How Lumen Does It

Lumen uses PMREM convolution internally (`BY`/`NY` functions): GGX importance sampling → spherical Gaussian blur → mip-chain. This is identical to Three.js's built-in `PMREMGenerator`. Two IBL contributions are computed per PBR fragment:
- `iblIrradiance` — diffuse contribution (lowest mip, wide filter)
- `radiance` (via `w_(...)` decode) — specular contribution (mip selected by roughness)

**Conclusion:** Three.js's built-in `PMREMGenerator` + `scene.environment` is production-grade. No custom IBL pipeline is needed.

---

## Files That Will Need Changes

| File | Change |
|---|---|
| `viewport/PostProcessingPipeline.js` | Core: implement MRT setup, bloom pass, outline pass, composite pass |
| `viewport/RendererManager.js` | Set up `WebGLMultipleRenderTargets` or WebGPU `PostProcessing` class |
| `viewport/SceneManager.js` | Hook into render loop to supply MRT target |
| `properties/ObjectProperties.js` | Add bloom weight + outline weight sliders |
| `properties/EnvironmentProperties.js` | Add environment-level FX weight controls |
| `properties/PostProcessingProperties.js` | Global threshold/intensity controls; tier override |
| `viewport/TransformGizmo.js` | Patch gizmo materials: bloom=0, outline weight = selection state |

---

## Open Questions / Future Work

- **Temporal Anti-Aliasing (TAA)**: MRT is compatible with TAA but requires accumulation buffer management
- **Shadow maps**: Unaffected — shadow maps are separate from post-processing pipeline
- **Transparency / Alpha blend**: Objects with `transparent: true` may need separate handling in the bloom prefilter (threshold should exclude UI-alpha objects)
- **WebGPU migration**: When Three.js WebGPU renderer stabilizes as the primary renderer, the TSL `mrt()` path should replace the WebGL2 path entirely
- **VR/XR**: MRT on WebXR requires `multiview` extension — separate investigation needed

---

*Last Updated: May 2026*
