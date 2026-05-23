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
