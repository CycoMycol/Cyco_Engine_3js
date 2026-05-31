# Sky & Atmosphere System Plan
## Cyco Engine 4 — Unreal Engine 5–Inspired Environment Revamp

---

## Overview

The goal is to replace the single `GradientSky.js` sky type with a **multi-mode sky system** controlled by a top-level **Sky Type** dropdown, matching the quality and feature richness of Unreal Engine's Sky Atmosphere + Volumetric Clouds stack.

### UE5 → Cyco Engine Feature Mapping

| Unreal Engine 5 Component | Cyco Engine Equivalent |
|---|---|
| Sky Atmosphere | **Physical Sky** mode (`THREE.Sky` shader) |
| Gradient sky / custom | **Gradient Sky** mode (current `GradientSky.js`) |
| HDRI Backdrop | **HDRI Sky** mode (`RGBELoader` → `EquirectangularReflectionMapping`) |
| Directional Light (Atmosphere Sun) | `DirectionalLight` in `GradientSky.js` (shared by all modes) |
| Sunlight Shafts / God Rays | **God Rays** post-process pass (new — see §5) |
| Volumetric Clouds | `VolumetricClouds.js` (already implemented) |
| Sky Light (Real-Time Capture) | `RoomEnvironment` IBL + optional PMREM sky capture |
| Exponential Height Fog | `THREE.FogExp2` + aerial perspective shader |
| Lens Flare | Lensflare system (already implemented, 5 styles) |

---

## 1. Sky Type Dropdown

The `Background` section in `EnvironmentProperties.js` gains a **Sky Type** control that replaces the current single-path. Everything else (clouds, fog, sun, god rays) is shared across all sky types.

```
Background Type:  [ Solid Color | Gradient | Sky | HDRI ]
                           ↓ (when "Sky" is selected)
Sky Type:   [ Gradient Sky | Physical Sky | HDRI Sky ]
```

### Sky Type Options

| Value | Label | Class | Description |
|---|---|---|---|
| `gradient` | Gradient Sky | `GradientSky.js` (existing) | Artistic gradient + sun disc. Artist-controlled colours, no physics. |
| `physical` | Physical Sky | `PhysicalSky.js` (new) | `THREE.Sky` shader — Hosek-Wilkie physically-based Rayleigh + Mie atmosphere. |
| `hdri` | HDRI Panorama | inline in `ViewportEngine.js` | Equirectangular HDR as a skydome. Environment map + optional visible background. |

All three modes share the same **sun/moon directional light**, **lens flare**, **god rays**, and **cloud systems**. Switching sky type is non-destructive; parameters are preserved per-type.

### Shared Sky Parameters (all modes)

These params exist regardless of sky type:

| Parameter | Description |
|---|---|
| Elevation | Sun altitude angle (−10 to 90°) |
| Azimuth/Rotation | Sun horizontal angle (0–360°) |
| Exposure | `renderer.toneMappingExposure` (0.1–4.0) |
| Show Sun | Sun disc visible |
| Sun Color | Sun disc and light colour |
| Show Moon | Moon disc visible |
| Moon Color | Moon disc colour |
| Lens Flare | Enable/disable + style (5 styles, existing) |

---

## 2. Gradient Sky (Current — `GradientSky.js`)

**Status: Complete and working.**

The current `GradientSky.js` implementation provides:
- Full gradient editor (colour stops + opacity stops → 256-sample 1D texture)
- Procedural sun disc (SDR, no bloom contamination)
- Procedural moon disc
- 5-style lens flare (Classic / Natural / Cinematic / Anamorphic / Subtle)
- Single `DirectionalLight` tracking the sun
- WebGL + WebGPU via Sprite-based fallback for lens flare (see `sky-clouds-pipeline.md`)
- TSL `reference()` nodes for WebGPU uniform updates

**Controls specific to Gradient Sky:**

| Control | Range | Description |
|---|---|---|
| Sky Colours | Gradient editor | Colour + opacity stops driving the 1D gradient texture |
| Sky Brightness | 0.1–4.0 | Overall luminance multiplier |
| Saturation | 0–3 | 0=greyscale, 1=unchanged |
| Contrast | 0.5–3 | Pivot at 0.5 |
| Sun Glow Strength | 0–10 | Atmospheric glow band radius around sun disc |
| Moon Glow Strength | 0–10 | Same for moon |

---

## 3. Physical Sky (New — `PhysicalSky.js`)

> **This is the Unreal Engine Sky Atmosphere equivalent.**

Uses `THREE.Sky` from `three/addons/objects/Sky.js` — a Hosek-Wilkie / Preetham physically-based atmospheric scattering shader. Already present in `ObjectFactory.js`; needs to be promoted to a first-class sky mode.

### How It Works

The `Sky` shader ray-marches through a parametric atmosphere model, computing the correct color for every sky pixel based on:
- **Rayleigh scattering** — small molecules; makes sky blue, sunsets red/orange
- **Mie scattering** — aerosol particles (haze/fog/pollution); creates sun halo
- **Sun position** — drives both sky colour distribution and the directional light

This is how UE5's Sky Atmosphere computes sky colour.

### Physical Sky Controls (UE5 Sky Atmosphere equivalent)

#### Atmosphere Model

| Cyco Engine Control | `THREE.Sky` Uniform | UE5 Equivalent | Range | Default | Description |
|---|---|---|---|---|---|
| Rayleigh | `rayleigh` | Rayleigh Scattering Scale | 0–4 | 1.0 | Density of air molecules. Higher = bluer sky, redder sunsets. Earth default = 1.0. |
| Mie (Turbidity) | `turbidity` | Mie Scattering Scale / Haze | 1–20 | 2.0 | Aerosol / haze density. Higher = hazier, more white horizon. |
| Mie Coefficient | `mieCoefficient` | Mie Coefficient | 0–0.1 | 0.005 | Mie scattering intensity. |
| Mie Anisotropy | `mieDirectionalG` | Mie Anisotropy | 0–0.99 | 0.8 | 0=uniform scatter, 0.8=Earth default, >0.9=tight sun halo. |

#### Artistic Controls

| Cyco Engine Control | Description | UE5 Equivalent |
|---|---|---|
| Sun Intensity | `DirectionalLight.intensity` in lux (0–200 000) | Directional Light intensity |
| Sun Angular Size | Controls sun disc size in sky shader | Sun disc size |
| Aerial Perspective | Height-based atmosphere tinting of distant objects | Aerial Perspective View Distance Scale |
| Sky Tint | Colour multiplier on sky output | Sky Tint / Sky Color |

#### Implementation Notes

```js
// PhysicalSky.js skeleton:
import { Sky } from 'three/addons/objects/Sky.js';

const sky = new Sky();
sky.scale.setScalar(450000);
scene.add(sky);

// Parameters exposed via reference() nodes for WebGPU, or direct uniform update for WebGL:
sky.material.uniforms['turbidity'].value      = params.turbidity;     // Mie haze
sky.material.uniforms['rayleigh'].value       = params.rayleigh;      // Rayleigh
sky.material.uniforms['mieCoefficient'].value = params.mieCoefficient;
sky.material.uniforms['mieDirectionalG'].value = params.mieDirectionalG; // anisotropy
sky.material.uniforms['sunPosition'].value.copy(sunDir);  // derived from elevation/azimuth

// Bloom clamping (CRITICAL — sky HDR output will trigger bloom without this):
sky.material.onBeforeCompile = (shader) => {
  shader.fragmentShader = shader.fragmentShader.replace(
    'gl_FragColor = vec4( texColor, 1.0 );',
    'gl_FragColor = vec4( min( texColor, vec3( 4.5 ) ), 1.0 );'
  );
};
```

> **WebGPU Note:** `THREE.Sky` uses `ShaderMaterial` with custom GLSL — it renders **black** under `WebGPURenderer`. For WebGPU, the sky must either:
> - Use WebGL2 fallback for this sky type, OR
> - Be rewritten as a TSL `MeshBasicNodeMaterial` (significant effort — future work)
>
> **Recommendation for Phase 1:** Physical Sky is WebGL-only. Display a note in the UI if WebGPU renderer is active.

---

## 4. HDRI Sky Mode

Uses an equirectangular HDR image as both the visible background and the environment light source.

```js
// HDRI sky setup:
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

const pmremGen = new THREE.PMREMGenerator(renderer);
pmremGen.compileEquirectangularShader();

const hdrTexture = await new RGBELoader().loadAsync(url);
scene.environment = pmremGen.fromEquirectangular(hdrTexture).texture;
scene.background  = showHDRIBackground ? scene.environment : null;
hdrTexture.dispose();
pmremGen.dispose();
```

**HDRI Sky Controls:**

| Control | Description |
|---|---|
| File | HDR file picker (`.hdr`, `.exr`) |
| Show as Background | Toggle between env-only vs visible sky |
| Rotation | Rotate the HDRI horizontally (0–360°) |
| Intensity | `scene.environmentIntensity` (0.1–5.0) |
| Background Blur | `scene.backgroundBlurriness` (0.0–1.0) |
| Background Intensity | `scene.backgroundIntensity` (0.1–5.0) |

The sun direction for god rays and lens flare is defined by a manual **Sun Azimuth** and **Elevation** slider when in HDRI mode (it cannot be auto-derived from the HDRI).

---

## 5. God Rays (Atmosphere Sunlight Shafts) — PRIORITY FEATURE

> **Unreal Engine equivalent:** _"Atmosphere Sunlight Shafts"_ — enabled via `Cast Shadow on Atmosphere` on the Directional Light.

God rays (crepuscular rays / volumetric light shafts) are the single most impactful atmosphere visual missing from the engine. They make sun at low elevation (morning/evening) look dramatic and cinematic.

### How They Work

From Nvidia GPU Gems 3, Ch. 13 — "Volumetric Light Scattering as a Post-Process":

1. **Occluder Pass (1/4 resolution):** Render the scene to a low-res texture. Sun disc pixels → bright white. Everything else → black (using `MeshBasicMaterial` colour `0x000000`, except the sky mesh which renders its sun disc colour). This creates a silhouette mask.
2. **Radial Blur Pass:** For each output pixel, march N steps from pixel toward the sun's 2D screen position. Sample the occluder texture at each step with exponential falloff. Accumulate — this creates the "beams" radiating from the sun.
3. **Composite Pass:** Additively blend the radial blur output onto the final frame.

```
Frame pipeline with god rays:
  ScenePass → OccluderPass (1/4 res) → RadialBlurPass → AdditiveBlend → Output
```

### Recommended Implementation: Screen-Space Radial Blur

This is the **recommended approach** for Cyco Engine. It:
- Works on both WebGL and WebGPU
- Runs at 1/4 resolution (extremely cheap)
- Is easy to tune (5 float parameters)
- Produces convincing results similar to UE5's ground-level shafts

#### Step 1 — Occluder Pass

```js
// Create a 1/4-res render target:
this._godRaysRT = new THREE.WebGLRenderTarget(
  Math.floor(w / 4), Math.floor(h / 4),
  { format: THREE.RGBFormat, type: THREE.UnsignedByteType }
);

// Occluder scene: clone materials to black silhouettes
// Sky mesh uses its own special occluder material that draws the sun disc white.
const occluderMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
renderer.setRenderTarget(this._godRaysRT);
scene.overrideMaterial = occluderMat;
renderer.render(scene, camera);
scene.overrideMaterial = null;
renderer.setRenderTarget(null);
```

#### Step 2 — Radial Blur ShaderPass

```glsl
// God rays fragment shader (radial blur toward sun NDC position):
uniform sampler2D tOccluder;   // 1/4-res occluder mask
uniform vec2  sunScreenPos;    // sun NDC xy in [0,1] screen space
uniform int   numSamples;      // 60 typical
uniform float density;         // 0.96 — step coverage
uniform float weight;          // 0.4  — per-sample contribution
uniform float decay;           // 0.9  — exponential falloff
uniform float exposure;        // 0.65 — final brightness scale

void main() {
  vec2 uv = vUv;
  vec2 deltaUV = (uv - sunScreenPos) * (density / float(numSamples));
  float illuminationDecay = 1.0;
  vec3 godRay = vec3(0.0);

  for (int i = 0; i < 60; i++) {
    uv -= deltaUV;
    vec3 sample = texture2D(tOccluder, uv).rgb;
    sample *= illuminationDecay * weight;
    godRay += sample;
    illuminationDecay *= decay;
  }

  gl_FragColor = vec4(godRay * exposure, 1.0);
}
```

#### Step 3 — Additive Composite in EffectComposer

```js
import { ShaderPass }      from 'three/addons/postprocessing/ShaderPass.js';
import { AdditiveBlending } from 'three';

// Add as an AdditiveBlending pass after OutputPass:
const godRaysPass = new ShaderPass(GodRaysShader);
godRaysPass.material.blending = THREE.AdditiveBlending;
godRaysPass.material.depthWrite = false;
composer.addPass(godRaysPass);
```

### God Rays — Properties Panel Controls

| Control | Default | Range | Description |
|---|---|---|---|
| **Enabled** | off | bool | Master toggle |
| **Density** | 0.96 | 0.5–1.0 | Step coverage (higher = beams reach further from sun) |
| **Weight** | 0.40 | 0.1–1.0 | Per-sample brightness contribution |
| **Decay** | 0.90 | 0.7–0.99 | Exponential falloff (lower = shorter beams) |
| **Exposure** | 0.65 | 0.1–2.0 | Final brightness scale |
| **Samples** | 60 | 20–100 | Number of radial march steps (quality vs performance) |
| **Max Angle** | 180° | 10–180° | Hide god rays when sun is beyond this angle from screen center |
| **Only From Sun** | on | bool | Only show shafts when sun disc is (partially) visible on screen |

### God Rays Quality Tiers

| Tier | Samples | Resolution | Notes |
|---|---|---|---|
| Low | 20 | 1/8 | Mobile web — barely visible, near-free |
| Medium | 40 | 1/4 | **Default** — good quality, minimal cost |
| High | 80 | 1/2 | Desktop — cinematic quality |
| Ultra | 100 | 1/2 | Use for screenshots/exports only |

### God Rays — Integration with Sky Types

| Sky Mode | God Rays Support | Sun Position Source |
|---|---|---|
| Gradient Sky | ✅ Full | `GradientSky._p.sunDir` (already a `THREE.Vector3`) |
| Physical Sky | ✅ Full | Same sun dir used for `sky.material.uniforms['sunPosition']` |
| HDRI Sky | ✅ Partial | Manual sun azimuth/elevation sliders |
| Solid Color | ❌ No | No sun defined |

### God Rays — WebGPU Path

Three.js r184 includes an experimental `GodraysNode` TSL addon:

```js
import { GodraysNode } from 'three/addons/tsl/display/GodraysNode.js';

const godrays = new GodraysNode(sunLight, sceneDepth);
godrays.density = 0.96;
godrays.decay   = 0.9;
godrays.weight  = 0.4;
postProcessing.outputNode = blend(sceneOutput, godrays, AdditiveBlending);
```

> **Note (2025):** `GodraysNode` availability must be verified against the bundled Three.js version in `editor/libs/three/`. If not available, use the screen-space radial blur with a `WebGLRenderTarget` + `ShaderPass` which works identically on `WebGL2Backend` (the WebGPU renderer's fallback).

### Recommendation for God Rays

**Start with the screen-space radial blur (WebGL ShaderPass).** It's the most battle-tested approach, identical to what shipped in AAA games (Crysis, GTA IV), takes ~0.4ms at 1/4 res on any decent GPU, and produces dramatic results at low elevations. The WebGPU `GodraysNode` can be added as the secondary path when the TSL pipeline is active.

**The single most important integration detail:** The occluder pass must render the **sky's sun disc as white** and everything else as black. For Gradient Sky, this means the sky sphere needs a second `MeshBasicMaterial` variant that only draws the sun disc area. For Physical Sky, the `THREE.Sky` mesh can be rendered normally in the occluder pass since its sun area is already bright white relative to the rest.

---

## 6. Aerial Perspective (Height Fog + Atmosphere Haze)

> **UE5 equivalent:** Sky Atmosphere's built-in Mie height fog + Exponential Height Fog component.

Aerial perspective makes distant objects appear hazier and tinted toward the sky/horizon colour. It's a cheap but powerful depth cue — it's what makes Unreal outdoor scenes feel "real".

### Implementation Options (choose one)

#### Option A: Three.js Scene Fog (Simplest)

```js
// Three.js exponential fog — matches scene background colour to horizon
scene.fog = new THREE.FogExp2(horizonColor, density);
// Live update: scene.fog.color.set(newColor); scene.fog.density = newDensity;
```

| Advantage | Disadvantage |
|---|---|
| Zero cost | Uniform in all directions — no vertical stratification |
| Works with all sky types | No sun-direction tinting |
| No extra passes | Colour doesn't adjust automatically with sky |

#### Option B: Height-Stratified Fog (Shader Injection)

Inject a height-based exponential fog function into all scene materials via `onBeforeCompile`. Fog density falls off exponentially with world Y — matches UE5's Exponential Height Fog.

```glsl
// Fragment injection:
float heightFog(vec3 worldPos, float density, float height) {
  return 1.0 - exp(-density * max(0.0, height - worldPos.y));
}
float fogFactor = heightFog(vWorldPosition, fogDensity, fogHeight);
fragColor.rgb = mix(fragColor.rgb, fogColor, fogFactor);
```

#### Option C: Physical Sky Aerial Perspective (Best, Expensive)

Use the `THREE.Sky` shader's own aerial perspective lookup to tint distant objects. Requires sampling a sky LUT at each fragment's world position. Only viable in WebGPU TSL as a node.

**Recommended for Cyco Engine Phase 1:** **Option A** (scene fog) as a baseline available immediately; **Option B** (height fog injection) as the quality upgrade when time permits.

### Aerial Perspective Controls

| Control | Default | Range | Description |
|---|---|---|---|
| **Enabled** | off | bool | Toggle fog |
| **Type** | Exp | Linear / Exp / Exp² | Three.js fog type |
| **Density** | 0.0002 | 0–0.01, step 0.0001 | Fog falloff rate |
| **Color** | auto | color picker | Fog colour (auto-sample from horizon when sky enabled) |
| **Auto Color** | on | bool | Auto-set fog colour from sky horizon gradient |
| **Height** | 0 | −100–500 | World Y above which fog starts (height fog only) |
| **Near** | 1 | 0–500 | Linear fog near plane |
| **Far** | 1000 | 100–50000 | Linear fog far plane |

---

## 7. Sun & Moon Directional Light

Both Gradient Sky and Physical Sky drive a single `THREE.DirectionalLight` from the sun's computed direction. The moon optionally drives a second `DirectionalLight` at much lower intensity.

### Sun Light Properties

| Control | Default | Range | Description |
|---|---|---|---|
| **Sun Intensity** | 2.0 | 0–200 000 | In lux (120 000 = zenith, 0 = below horizon). Non-lux scenes use 0–10. |
| **Sun Color** | `#fff8e7` | color | Warm yellow-white by default |
| **Cast Shadows** | on | bool | `sunLight.castShadow` |
| **Shadow Map Size** | 2048 | 512–4096 | `sunLight.shadow.mapSize` |
| **Shadow Near** | 0.1 | 0.01–10 | Tight near = better shadow precision |
| **Shadow Far** | 5000 | 100–50000 | Shadow frustum extent |
| **Shadow Bias** | −0.0005 | −0.01–0 | Prevent self-shadow acne |

> **UE5 Note:** For god rays to work (shadows in atmosphere), `Cast Shadow on Atmosphere` must be enabled on the Directional Light. In Cyco Engine this corresponds to having **both** `sunLight.castShadow = true` AND the **God Rays pass enabled** — the god rays occluder pass reads the sun's shadow silhouette.

### Moon Light Properties

| Control | Default | Range | Description |
|---|---|---|---|
| **Moon Intensity** | 0.02 | 0–1 | 0.26 lux at zenith (physical) |
| **Moon Color** | `#c0d4ff` | color | Cool blue-white |
| **Cast Shadows** | off | bool | Usually off for performance |

---

## 8. Volumetric Clouds (Existing — reference)

The cloud system is already implemented. See `/memories/repo/sky-clouds-pipeline.md` for full implementation details.

**Two cloud systems:**

| System | Variable | Mode | Altitude |
|---|---|---|---|
| High cirrus/cumulus | `cloudSystem` | `skyMode=true` — depth 1.0 trick | World Y 300–600 |
| Low clouds + shadow | `cloudSystem2` | `skyMode=false` + multiply shadow mesh | World Y 5–25 |

**Cloud controls (existing)** live in a separate Cloud section of `EnvironmentProperties.js`.

### Cloud–God Rays Interaction

When **god rays are enabled** and clouds are visible, the occluder pass will automatically include cloud silhouettes in the shadow mask (since clouds are rendered as opaque geometry from the occluder's perspective). This means **clouds will cast god ray shafts** — exactly matching UE5 behaviour where `Cast Cloud Shadows` enables cloud shadow in the atmosphere. No extra integration work needed.

---

## 9. Complete Environment Properties UI Layout

The redesigned `EnvironmentProperties.js` section structure, modelled on UE5's Environment Light Mixer:

```
┌ Environment ──────────────────────────────────────────┐
│                                                       │
│  ▾ Background                                         │
│    Type: [ Solid | Gradient | Sky | HDRI ]            │
│    ── if Solid: Color picker                          │
│    ── if Gradient: 3-stop gradient editor             │
│    ── if HDRI: File picker + HDRI BG toggle           │
│                                                       │
│  ▾ Sky                                               │
│    Show Sky: [✓]                                      │
│    Sky Type: [ Gradient Sky | Physical Sky | HDRI Sky ]│  ← NEW
│    Day / Night: ─────────────────────●                │
│    Elevation:  ─────────────●─────── 35.0°            │
│    Rotation:   ─────●───────────── 180°               │
│    Exposure:   ───────●──────────── 1.00              │
│    ▾ Atmosphere                                       │  ← NEW (Physical Sky only)
│       Rayleigh:       ─────●──────── 1.0              │
│       Turbidity (Mie):─────●──────── 2.0              │
│       Mie Anisotropy: ─────────●─── 0.80              │
│       Sky Tint:       [■ white]                       │
│    ▾ Sky Colours                                      │  (Gradient Sky only)
│       [ gradient editor ]                             │
│       Brightness / Saturation / Contrast              │
│    ▾ Sun                                              │
│       Sun: [✓] [■ colour] Glow: ──●── 0.5            │
│       Intensity: ─────●──────── 2.00 lux             │
│       Cast Shadows: [✓]                               │
│    ▾ Moon                                             │
│       Moon: [✓] [■ colour] Glow: ──●── 0.3           │
│       Intensity: ●─────────────── 0.02               │
│    ▾ Lens Flare                                       │
│       Enable: [✓] Style: [Classic ▾]                 │
│       Size / Opacity / Color / Intensity ...          │
│                                                       │
│  ▾ God Rays                                           │  ← NEW
│    Enable: [□]                                        │
│    Density:  ─────────────────●── 0.96               │
│    Weight:   ────────●──────── 0.40                  │
│    Decay:    ──────────────●─── 0.90                 │
│    Exposure: ──────●──────── 0.65                    │
│    Samples:  ─────────────●─── 60                    │
│    Quality: [ Medium ▾ ]                              │
│                                                       │
│  ▾ Clouds                                             │
│    [ existing cloud controls ]                        │
│                                                       │
│  ▾ Fog / Aerial Perspective                           │  ← NEW
│    Enable: [□]                                        │
│    Type: [ Exp² ▾ ]                                   │
│    Density: ─●─────────── 0.0002                     │
│    Color: [■] Auto: [✓]                               │
│                                                       │
│  ▾ Environment Map                                    │
│    [ existing IBL / HDRI controls ]                   │
└───────────────────────────────────────────────────────┘
```

---

## 10. New Event Architecture

The existing `cyco-sky-change` event will gain a `skyType` field and new `cyco-godrays-change` and `cyco-fog-change` events:

```js
// Extended sky event:
window.dispatchEvent(new CustomEvent('cyco-sky-change', { detail: {
  enabled:    true,
  skyType:    'physical',          // 'gradient' | 'physical' | 'hdri'
  elevation:  35,
  azimuth:    180,
  // Gradient Sky params:
  colorStops, opacityStops, skyBrightness, saturation, contrast,
  showSun, sunColor, sunGlowStrength,
  showMoon, moonColor, moonGlowStrength,
  lensflareEnabled, lensflareStyle, ...
  // Physical Sky params:
  turbidity, rayleigh, mieCoefficient, mieDirectionalG, skyTint,
  // HDRI params:
  hdriUrl, showHDRIBackground, hdriRotation, hdriIntensity,
}}));

// God rays event (new):
window.dispatchEvent(new CustomEvent('cyco-godrays-change', { detail: {
  enabled: true,
  density: 0.96, weight: 0.4, decay: 0.9, exposure: 0.65, samples: 60,
}}));

// Fog event (new):
window.dispatchEvent(new CustomEvent('cyco-fog-change', { detail: {
  enabled: true,
  type: 'exp2',       // 'none' | 'linear' | 'exp' | 'exp2'
  color: '#cce0ff',
  density: 0.0002,
  near: 1, far: 1000,
  autoColor: true,
}}));
```

---

## 11. New Files Required

| File | Purpose |
|---|---|
| `editor/src/viewport/PhysicalSky.js` | New — wraps `THREE.Sky`, same API as `GradientSky.js` |
| `editor/src/viewport/GodRays.js` | New — manages occluder RT + radial blur ShaderPass |
| (optional) `editor/src/shaders/GodRaysShader.js` | GLSL for the radial blur pass |

### Files Requiring Changes

| File | Change |
|---|---|
| `EnvironmentProperties.js` | Add Sky Type dropdown, God Rays section, Fog section, Physical Sky controls |
| `ViewportEngine.js` | Route `skyType` to correct sky class; add god rays + fog handlers |
| `PostProcessingPipeline.js` | Insert `GodRays` pass before output; handle WebGL + WebGPU paths |
| `GradientSky.js` | Add `_createOccluderMaterial()` for god rays occluder pass sun disc |

---

## 12. Implementation Phases

### Phase 1 — God Rays (Gradient Sky) — Highest Priority
> "I want my god rays."

1. Create `GodRays.js` with occluder RT + `ShaderPass` radial blur + additive composite
2. Add sun disc white-on-black occluder material to `GradientSky.js`
3. Pass sun NDC screen position from `GradientSky.update()` to `GodRays.update(camera)`
4. Add God Rays section to `EnvironmentProperties.js`
5. Wire `cyco-godrays-change` in `ViewportEngine.js` → `godRays.setParams()`
6. Insert `GodRays` pass into `PostProcessingPipeline.js` (additive blend, after OutputPass)

> **Expected result:** Dramatic light shafts visible at low sun elevations (5–25°) behind any object casting a shadow on the sun disc. Works with clouds casting shafts automatically.

### Phase 2 — Physical Sky

1. Create `PhysicalSky.js` wrapping `THREE.Sky` with same API as `GradientSky.js`
2. Add Sky Type dropdown to `EnvironmentProperties.js` Sky section
3. Add Atmosphere sub-section (Rayleigh, Mie, Turbidity, Anisotropy sliders) shown when Physical Sky active
4. Route `skyType` in `ViewportEngine._onSkyChange()`
5. Add `WebGPU not supported — using WebGL2` notice when Physical Sky is selected in WebGPU mode

### Phase 3 — Aerial Perspective / Fog

1. Add `cyco-fog-change` handler in `ViewportEngine.js` → `scene.fog`
2. Add Fog / Aerial Perspective section in `EnvironmentProperties.js`
3. Implement auto-color from gradient horizon for Gradient Sky mode
4. Add height fog shader injection (Option B) as separate quality tier

### Phase 4 — Polish / Future

- HDRI Sky mode cleanup (rotation, backgroundBlurriness exposure)
- `GodraysNode` TSL path for WebGPU renderer
- Physical Sky TSL port (full `THREE.Sky` shader as TSL nodes)
- Aerial perspective via Physical Sky LUT (WebGPU only)
- Real-time sky capture for environment map (updates IBL from sky colour)

---

## 13. God Rays — Key Technical Recommendations

1. **Render occluder at 1/4 resolution.** Quarter-res is barely distinguishable from half-res for god rays because the radial blur smooths everything out. This is where all the performance savings come from.

2. **Clamp god ray output to prevent over-brightening.** Add a `saturate()` clamp at the end of the radial blur — otherwise bright sun + high density + high weight will blow out to pure white.

3. **Suppress when sun is behind the camera.** Check `sunNDC.z > 1.0` (same check used for lens flare suppression). Also consider fading to 0 when `sunScreenPos` is far outside the viewport (god rays from off-screen have visible edge artifacts).

4. **Don't include the sky sphere as an occluder.** The sky sphere is almost entirely black in the occluder pass — only the sun disc area should be white. This requires either: (a) rendering sky separately in the occluder pass with a special sun-disc material, or (b) rendering the sky sphere first, then overriding all other scene materials to black while keeping the sky visible.

5. **Physical Sky + god rays = premium tier.** The combination of the physically-based Hosek-Wilkie atmosphere with screen-space god rays is the closest achievable match to UE5's Sky Atmosphere sunlight shafts.

6. **God ray length scales with `density * decay`.** For short dramatic shafts: `density=0.90, decay=0.85`. For long distant haze rays: `density=0.98, decay=0.95`.

---

*Created: May 2026*
*References: UE5 Sky Atmosphere docs, UE5 Volumetric Cloud docs, GPU Gems 3 Ch.13, Three.js Sky addon*
