# Rendering Alternatives & Cross-Platform Guide

> **Scope**: Visual effects, pre-processing strategies, and alternatives to traditional post-processing — with a cross-platform (Web / Mobile / Steam) development checklist.

---

## Table of Contents

1. [What Is "Pre-Processing"?](#what-is-pre-processing)
2. [Bloom Alternatives](#bloom-alternatives)
3. [Outline & Toon Alternatives](#outline--toon-alternatives)
4. [Color Grading](#color-grading-lut)
5. [Anti-Aliasing Options](#anti-aliasing-options)
6. [Advanced In-Material Effects](#advanced-in-material-effects)
7. [Performance Tools](#performance-tools)
8. [Third-Party Libraries](#third-party-libraries)
9. [Cross-Platform Recommended Setup](#cross-platform-recommended-setup)

---

## What Is "Pre-Processing"?

"Pre-processing" in real-time rendering means **baking visual results into assets or materials ahead of time**, so no GPU work is required at runtime. This is the opposite of post-processing (per-frame full-screen passes).

| Approach | When it Runs | Cost |
|---|---|---|
| Post-processing (FX passes) | Every frame | GPU per frame |
| Pre-processing / pre-baking | Once (at build/export time) | Near zero at runtime |
| In-material / shader effects | Per draw call (object-level) | Modest, scales with objects |

Pre-processing examples:
- **Light baking** (`ProgressiveLightMap`) — static scene lighting baked into lightmap textures.
- **Pre-baked LUT** — color grade a 3D LUT once, apply at near-zero cost each frame.
- **Texture atlasing** — merge multiple textures into one to cut draw calls.
- **LOD generation** — pre-build lower-detail meshes for use at distance.

---

## Bloom Alternatives

Traditional `UnrealBloomPass` is expensive (5+ blur passes, full-screen). These alternatives cost less:

### Option 1: Emissive + Tone Mapping (recommended)
- Set `material.emissive` and `material.emissiveIntensity > 1.0` on glowing objects.
- Pair with **AgX** or **ACES Filmic** tone mapping — the tone mapper naturally rolls off the overexposed emissive value and creates a soft glow appearance.
- **Cost**: zero extra GPU passes. Works on every platform including mobile WebGL.
- **Limitation**: glow is tight around the surface, not a large atmospheric bloom.

### Option 2: Additive Sprite / Billboard Flares
- Place a transparent sprite (`AdditiveBlending`) at light positions.
- Scale and tint based on camera angle.
- **Cost**: one extra draw call per flare. Works everywhere.

### Option 3: `LensflareNode` (Three.js TSL / WebGPU)
```js
import { lensflare } from 'three/addons/objects/LensflareNode.js';
```
- TSL node for WebGPU pipelines.
- Produces lens flare + bloom bloom on bright spots.

### Option 4: Keep `UnrealBloomPass` at Low Settings
- Strength ≤ 0.5, radius ≤ 0.3, threshold ≥ 0.85 reduces cost significantly.
- Use `renderToScreen = false` and only run it on frames that changed.

---

## Outline & Toon Alternatives

`OutlinePass` (EffectComposer) requires a full scene depth pre-pass and is expensive on mobile.

### Option 1: `OutlineEffect` (Three.js Addons → Effects) — **Best for games**
```js
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';
const effect = new OutlineEffect(renderer);
// Replace renderer.render(...) with effect.render(...)
```
- Uses **inverted back-face extrusion** — draws the mesh a second time scaled outward with culling flipped.
- **No post-processing pass** — runs per-object as a second draw call.
- Works on **WebGL1, WebGL2, and mobile**.
- Supports per-material outline color and thickness via `material.userData.outlineParameters`.

### Option 2: `ToonOutlinePassNode` (Three.js TSL / WebGPU)
```js
import { toonOutlinePass } from 'three/addons/toon/ToonOutlinePassNode.js';
```
- TSL node for the WebGPU `PostProcessing` system.
- Same back-face extrusion technique, but in the TSL node graph.

### Option 3: `MeshToonMaterial`
- Built-in Three.js toon shading with step-based lighting.
- No outlines by default, but pair with `OutlineEffect` for classic cel-shading.
- Works on all platforms including mobile WebGL1.

---

## Color Grading (LUT)

A 3D LUT (Look-Up Table) remaps colors from "raw" to "graded" using a precomputed 3D texture. It runs in a single texture lookup — extremely cheap.

### Implementation in Cyco Engine (now available)
The editor's Post-Processing pipeline now includes a `LUTPass` (after OutputPass).

**In the Renderer Properties panel:**
1. Open **Renderer → Color Grading**.
2. Toggle **Enable LUT**.
3. Adjust **Intensity** (0 = original, 1 = full grade).
4. Click **Load .cube File…** to import a standard Adobe `.cube` LUT file.

### Creating LUT Files
- **DaVinci Resolve** — export a custom grade as `.cube`.
- **Photoshop / Lightroom** — many plugins export `.cube` formats.
- **HaldCLUT** — open-source film emulation LUTs (search "HaldCLUT").
- **Free resources**: `https://www.freepresets.com`, Lutify.me, Film Riot.

### Three.js APIs
| System | Import |
|---|---|
| WebGL (EffectComposer) | `three/addons/postprocessing/LUTPass.js` |
| WebGPU (TSL) | `lut3D` / `Lut3DNode` from Three.js TSL |

---

## Anti-Aliasing Options

### Comparison Table

| Mode | Quality | Cost | Works On | Notes |
|---|---|---|---|---|
| None | Poor | Zero | Everywhere | Only acceptable at 2× pixel ratio |
| **FXAA** | Fair | Very low | Everywhere (WebGL1+) | Fast, slight blur |
| **SMAA** | Good | Low | Desktop, mid-range mobile | Before OutputPass in pipeline |
| **MSAA ×2** | Good | Medium | WebGL2 / WebGPU desktop | Hardware, no blur |
| **MSAA ×4** | Excellent | High | WebGL2 / WebGPU desktop | Expensive on mobile |
| TAA / TAAU | Excellent + upscale | Medium | WebGPU only | Temporal, needs motion vectors |
| TRAA | Excellent | Medium | WebGPU only | Temporal reprojection |
| FSR1 | Good + upscale | Low | WebGPU only | FidelityFX Super Resolution |

### Implementation Notes

**FXAA**: runs as a `ShaderPass` after `OutputPass` (on LDR/sRGB). Good default for web/mobile.

**SMAA**: runs before `OutputPass` (on HDR/linear). Better edge quality than FXAA with minimal extra cost. Use for desktop builds.

**MSAA**: uses `WebGLRenderTarget.samples` — no extra pass, hardware-resolved. Cannot combine with HDR bloom easily (multisampled targets have limits); the existing pipeline's `HalfFloatType` target supports MSAA in WebGL2. Requires pipeline rebuild when toggled.

**TSL AA** (TAAU, TRAA, FSR1): Available via Three.js TSL node system (WebGPU renderer only):
```js
import { taau }  from 'three/addons/tsl/display/TAA.js';   // temporal AA + upscale
import { traa }  from 'three/addons/tsl/display/TRAA.js';  // temporal reprojection AA
import { fsr1 }  from 'three/addons/tsl/display/FSR1.js';  // FidelityFX Super Res
```

### Recommendation by Platform
| Platform | Recommended AA |
|---|---|
| Mobile / low-end web | FXAA or None |
| Mid-range desktop / web | SMAA |
| High-end desktop | MSAA ×4 or SMAA |
| WebGPU desktop | TAAU or TRAA |

---

## Advanced In-Material Effects

These effects are computed **inside the shader** per draw call, requiring no extra passes.

### `MeshPhysicalMaterial` Sub-Features

All of these are available in WebGL2 and WebGPU:

| Feature | Property | Use Case |
|---|---|---|
| **Clearcoat** | `clearcoat`, `clearcoatRoughness` | Car paint, lacquered wood |
| **Iridescence** | `iridescence`, `iridescenceIOR` | Soap bubbles, oily surfaces |
| **Anisotropy** | `anisotropy`, `anisotropyRotation` | Brushed metal, hair |
| **Sheen** | `sheen`, `sheenColor`, `sheenRoughness` | Fabric, velvet |
| **Transmission** | `transmission`, `ior`, `thickness` | Glass, liquids |

### TSL Node Effects (WebGPU)
```js
import { SSSNode }    from 'three/addons/tsl/SSSNode.js';      // Subsurface scattering
import { GodraysNode } from 'three/addons/tsl/GodraysNode.js'; // Volumetric light shafts
import { GTAONode }   from 'three/addons/tsl/GTAONode.js';     // Ground-truth AO
import { SSRNode }    from 'three/addons/tsl/SSRNode.js';      // Screen-space reflections
import { SSGINode }   from 'three/addons/tsl/SSGINode.js';     // Screen-space GI
```

---

## Performance Tools

### Built into Three.js (works everywhere)

| Tool | Use Case |
|---|---|
| `LOD` | Swap mesh detail by camera distance |
| `BatchedMesh` | Merge hundreds of static meshes into one draw call |
| `ProgressiveLightMap` | Bake real-time GI into lightmap textures |
| `SceneOptimizer` | Auto-degrade settings when FPS drops below target |
| `InstancedMesh` | Render thousands of identical objects efficiently |

```js
// SceneOptimizer example
import { SceneOptimizer, SceneOptimizerOptions } from 'three/addons/misc/SceneOptimizer.js';
const options = SceneOptimizerOptions.ModerateDegradationAllowed();
SceneOptimizer.OptimizeAsync(scene, camera, () => console.log('optimized'), options);
```

### LOD Setup (recommended from day one)
```js
const lod = new THREE.LOD();
lod.addLevel(highDetailMesh,  0);    // full detail within 0–20 units
lod.addLevel(medDetailMesh,  20);    // medium detail 20–80 units
lod.addLevel(lowDetailMesh,  80);    // low detail 80+ units
scene.add(lod);
```

---

## Third-Party Libraries

### `pmndrs/postprocessing`
```js
import { EffectComposer, EffectPass, BloomEffect, SMAAEffect } from 'postprocessing';
```
- Merges N effects into **1 GPU render pass** via smart batching (vs. one pass per effect in Three.js default).
- Includes: SMAA, FXAA, SSAO, Bloom, Depth of Field, Motion Blur, Vignette, Color Average, Tone Mapping, and more.
- **Trade-off**: adds a dependency; requires its own render loop integration.
- Best for projects that need many simultaneous post effects at minimum GPU cost.

### `detect-gpu`
```js
import { getGPUTier } from 'detect-gpu';
const tier = await getGPUTier(); // tier.tier = 0 | 1 | 2 | 3
```
- Returns a GPU performance tier at runtime.
- Use to automatically select quality presets (see Cross-Platform section below).

---

## Cross-Platform Recommended Setup

### Guiding Principle
> **Design for the lowest-common target first, then layer upgrades for more powerful hardware.**

Mobile WebGL is your most constrained target. If it runs well there, desktop will be fine.

---

### Rendering Defaults (Development Workflow)

| Setting | Recommended Value | Reason |
|---|---|---|
| Renderer | WebGL | Maximum compatibility; switch to WebGPU when it's production-ready |
| Tone Mapping | **AgX** | Best for PBR; handles overexposure naturally without clipping |
| Tone Mapping Exposure | 1.0 | Neutral baseline |
| Anti-Aliasing | **SMAA** | Good quality, single pass, desktop + mid-range mobile |
| Shadows | PCF Soft | Best quality/cost ratio for cross-platform |
| Pixel Ratio | `Math.min(devicePixelRatio, 2)` | Never render more than 2× on any device |

---

### Effect Selection by Target

| Effect | Desktop WebGL | Mobile Web | Steam/Electron |
|---|---|---|---|
| Bloom | `UnrealBloomPass` (low settings) | Emissive + AgX only | `UnrealBloomPass` |
| Outlines | `OutlinePass` or `OutlineEffect` | `OutlineEffect` only | Either |
| Color Grading | `LUTPass` | `LUTPass` | `LUTPass` |
| AA | SMAA or MSAA ×4 | FXAA | MSAA ×4 or SMAA |
| AO | `GTAOPass` | None | `GTAOPass` |
| Toon | `MeshToonMaterial` + `OutlineEffect` | Same | Same |

---

### Quality Tier System (Auto-Detect at Runtime)

Pair with `detect-gpu` or your own FPS monitor:

```js
function applyQualityTier(tier, postProcessing) {
  switch (tier) {
    case 0: // Low-end mobile / integrated GPU
      postProcessing.setAntiAliasMode('fxaa');
      postProcessing.bloomPass.enabled = false;
      break;
    case 1: // Mid-range mobile / older desktop
      postProcessing.setAntiAliasMode('smaa');
      postProcessing.bloomPass.enabled = true;
      postProcessing.bloomPass.strength = 0.4;
      break;
    case 2: // Mid-range desktop / modern mobile
      postProcessing.setAntiAliasMode('smaa');
      postProcessing.bloomPass.enabled = true;
      postProcessing.bloomPass.strength = 0.8;
      break;
    case 3: // High-end desktop / dedicated GPU
      postProcessing.setAntiAliasMode('msaa4');
      postProcessing.bloomPass.enabled = true;
      postProcessing.bloomPass.strength = 1.0;
      break;
  }
}
```

---

### Platform-Specific Publishing Notes

| Platform | Key Constraint | Fix |
|---|---|---|
| Mobile browser | TBDR GPU — avoid discard/blend heavy passes | Reduce passes, use FXAA |
| Mobile browser | Battery drain | Cap to 30 fps when not focused |
| Mobile browser | Touch controls | Virtual joystick (e.g. `nipplejs`) |
| Web desktop | CORS / file loading | All assets must be served via HTTP |
| Steam / Electron | No GPU restriction | Use full pipeline |
| Steam / Electron | Frame pacing | Use `requestAnimationFrame`, not `setInterval` |

Full platform checklist: see [`DevDocs/publishing/PUBLISHING_PLATFORM_PLAN.md`](publishing/PUBLISHING_PLATFORM_PLAN.md).

---

### Tone Mapping Quick Reference

| Mode | Best For | Notes |
|---|---|---|
| None | Debug only | Raw linear, washed out |
| Linear | Old-school / retro | Clips highlights |
| Reinhard | Organic, muted | Slightly dull |
| Cineon | Film look | Classic filmic curve |
| **ACES Filmic** | Photo-realistic PBR | High contrast, saturated |
| **AgX** | Photo-realistic PBR | **Recommended** — natural, no hue shift |
| Neutral | Neutral rendering | Minimal color shift, good for UI-heavy games |

---

*Last updated: Cyco Engine 4 development session — see `DEVELOPMENT_HISTORY.md` for changelog.*
