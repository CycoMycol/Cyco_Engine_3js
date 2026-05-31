# Sky & Atmosphere System Plan
## Cyco Engine 4 — Full Implementation (All Phases)

---

## Overview & Goal

Transform the current single `GradientSky.js` system into a full multi-mode sky and atmosphere stack that matches Unreal Engine 5's Sky Atmosphere + God Rays + Volumetric Clouds experience.

### UE5 → Cyco Engine Feature Mapping

| Unreal Engine 5 Component | Cyco Engine Equivalent | Status |
|---|---|---|
| Sky Atmosphere (Hosek-Wilkie) | `PhysicalSky.js` using `THREE.Sky` | Phase 2 |
| Custom gradient sky | `GradientSky.js` | Done |
| HDRI Backdrop | Existing HDRI env map | Done (cleanup Phase 4) |
| Directional Light (Atmosphere Sun) | `DirectionalLight` in sky system | Done |
| **Sunlight Shafts / God Rays** | `GodRays.js` screen-space radial blur | **Phase 1** |
| Volumetric Clouds | `VolumetricClouds.js` | Done |
| Exponential Height Fog | `THREE.FogExp2` + height-stratified shader | Phase 3 |
| Sky Light / IBL | `RoomEnvironment` + PMREM | Done |
| Lens Flare | `GradientSky.js` 5-style system | Done |
| Aerial Perspective | Height fog + atmosphere haze | Phase 3 |

---

## Architecture: Sky Type System

All sky modes share: sun/moon directional light, lens flare, god rays, volumetric clouds.

```
Background Type: [ Solid Color | Gradient | Sky | HDRI ]
                                              v
                                  Sky Type: [ Gradient Sky | Physical Sky | HDRI Sky ]
```

### Sky Type Values

| Value | Class | Renderer Support | Description |
|---|---|---|---|
| `gradient` | `GradientSky.js` | WebGL + WebGPU | Artistic gradient + procedural sun/moon disc |
| `physical` | `PhysicalSky.js` | WebGL only (Phase 2) | `THREE.Sky` - Hosek-Wilkie atmosphere |
| `hdri` | inline `ViewportEngine.js` | WebGL + WebGPU | Equirectangular HDR panorama |

**All three modes share:** elevation/azimuth, sun light, lens flare, god rays, fog, clouds.

---

## Sky Type: Gradient / Physical / Hybrid

The **Hybrid** type is a third mode: the Hosek-Wilkie atmosphere provides the sky color distribution, but the gradient editor color stops are blended on top as an artistic tint. This lets you have physically accurate light scattering AND custom color grading at the same time.

| Value | Label | Gradient Editor | Atmosphere Params | Notes |
|---|---|---|---|---|
| `gradient` | Gradient Only | Visible, active | Hidden | Pure artistic mode |
| `physical` | Physical | Hidden | Visible | Pure physics mode (WebGL only) |
| `hybrid` | Hybrid | Visible (tint) | Visible | Physical sky + gradient tint (WebGL only) |

---

## Complete Target UI Layout (Full Panel Wireframe)

This is the final target state of the Environment Properties panel after all phases are complete.

```
🌄 Sky Atmosphere
   └ Type: [Gradient Only | Physical | Hybrid]
   └ Rayleigh Scale          (Physical / Hybrid only)
   └ Mie Scale               (Physical / Hybrid only)
   └ Mie Anisotropy          (Physical / Hybrid only)
   └ Ozone Absorption        (Physical / Hybrid only)
   └ Atmosphere Height       (Physical / Hybrid only)
   └ Aerial Perspective Scale (Physical / Hybrid only)
   └ [Gradient color pickers — kept! Hidden in Physical mode]

☀️ Sun & Moon
   └ Sun Elevation (slider + text input)
   └ Sun Azimuth   (slider + text input)
   └ Sun Intensity
   └ Sun Color     (color swatch)
   └ Sun Disk Size
   └ Sun Disk Visible (checkbox)
   └ ─────────────
   └ Moon Elevation
   └ Moon Azimuth
   └ Moon Intensity
   └ Moon Color (color swatch)
   └ Moon Disk Size

☁️ Volumetric Clouds (High Altitude)
   └ Enabled, Coverage, Density
   └ Altitude Start / End (km)
   └ Cloud Type Preset [Cumulus | Stratus | Cirrus | Cumulonimbus]
   └ Wind Speed, Wind Direction
   └ Multiple Scattering, Ground Contribution
   └ Self Shadow, Shadow Quality

☁️ Low Clouds (Atmospheric Layer)
   └ (same controls, separate layer)

🌫 Height Fog
   └ Enabled
   └ Type: [Off | Exp² | Linear]
   └ Base Density
   └ Height Falloff
   └ Fog Color (color swatch)
   └ Inscatter Color (color swatch)
   └ Start Distance
   └ Auto Color from Sky (checkbox)

💥 Lens Flare
   └ Enabled
   └ Opacity (0–1)
   └ Glare Size
   └ Star Points
   └ Flare Size
   └ Flare Speed
   └ Flare Shape [circular | oval | streak]
   └ Halo Scale
   └ Color Gain
   └ Ghost Scale
   └ Secondary Ghosts (checkbox)
   └ Additional Streaks (checkbox)
   └ Star Burst (checkbox)
   └ Anamorphic (checkbox)

🎨 Post Processing
   └ Bloom:              Enabled | Threshold | Intensity | Radius
   └ God Rays:          Enabled | Intensity | Samples
   └ Chromatic Aberr.:  Enabled | Strength
   └ Vignette:         Enabled | Offset | Darkness
   └ Film Grain:        Enabled | Intensity
   └ Tone Mapping:      [ACES | Linear | Reinhard | AgX | Cineon]
   └ LUT:               [file load button] | Intensity

🌍 Environment Map (IBL)
   └ Load HDR/EXR
   └ Show as Background (checkbox)
   └ Rotation (0–360)
   └ Background Blur
   └ Background Intensity
   └ Environment Intensity
```

---

# PHASE 0 - PRE-IMPLEMENTATION AUDIT

**Do this before writing any code.**

This audit maps what currently exists in `EnvironmentProperties.js` against the target UI layout. The gap between "what exists" and "what's needed" defines the actual implementation work per phase.

---

## P0.1 - Existing `EnvironmentProperties.js` Sections

| Section | Method | Status | Notes |
|---|---|---|---|
| Background | `_buildBackgroundSection()` | Done | Solid / Gradient / Sky / HDRI type selector |
| Sky | `_buildSkySection()` | Partial | Has gradient, sun, moon, lens flare (5-style). Needs sky type dropdown, atmosphere sub-section, Hybrid type |
| Clouds (Volumetric) | `_buildCloudSection()` | Done | High-altitude cloud layer |
| Low Clouds | `_buildLowCloudsSection()` | Done | Atmospheric cloud layer |
| Fog | `_buildFogSection()` | Partial | Basic type/color/density. Needs Inscatter Color, Height Falloff, Start Distance |
| Environment Map | `_buildEnvMapSection()` | Partial | Load + background toggle. Needs rotation, blur, intensity decoupling |
| **God Rays** | missing | Not started | Add in Phase 1 |
| **Post Processing** | missing | Not started | Add in Phase 6 |

## P0.2 - Existing Events Used

| Event | Fired by | Handled by | Status |
|---|---|---|---|
| `cyco-sky-change` | `_fireSkyChange()` | `ViewportEngine._onSkyChange()` | Done |
| `cyco-fog-change` | `_buildFogSection` fire fn | `ViewportEngine._onFogChange()` | Done |
| `cyco-env-map-change` | `_buildEnvMapSection` | `ViewportEngine._onEnvMapChange()` | Done |
| `cyco-env-background-toggle` | `_buildEnvMapSection` | `ViewportEngine._onEnvBgToggle()` | Done |
| `cyco-background-change` | `_buildBackgroundSection` | `ViewportEngine._onBackgroundChange()` | Done |
| `cyco-godrays-change` | missing | missing | Phase 1 |
| `cyco-postfx-change` | missing | missing | Phase 6 |

## P0.3 - Lens Flare Audit

The current `GradientSky.js` lens flare has 5 preset styles (classic / natural / cinematic / anamorphic / subtle) with per-style parameter sets. The target is to replace this with a fully granular control set matching the Ultimate Lens Flare API:

| Current Control | Target Control | Delta |
|---|---|---|
| Style dropdown (5 presets) | Removed — replaced by per-param controls | Replace |
| Size slider | Flare Size | Rename |
| Opacity slider | Opacity | Keep |
| Color swatch | Color Gain (tint) | Rename |
| Color intensity slider | Color Gain strength | Merge |
| Ghost Count (cinematic) | Ghost Scale | Rename |
| Streak Length (anamorphic) | Anamorphic (checkbox) | Expand |
| Brightness (natural) | Opacity | Merge |
| Ring thickness/fill/size/opacity | Halo Scale | Merge |
| missing | Glare Size | Add |
| missing | Star Points | Add |
| missing | Flare Speed | Add |
| missing | Flare Shape | Add |
| missing | Secondary Ghosts | Add |
| missing | Additional Streaks | Add |
| missing | Star Burst | Add |

## P0.4 - Post Processing Audit

PostProcessingPipeline.js already implements Bloom, AO, Outline, SMAA, FXAA, OutputPass, and LUT. However there is NO UI in EnvironmentProperties.js that exposes Bloom parameters or adds new effects. The "Post Processing" section in the target UI needs to be added entirely from scratch.

| Effect | `PostProcessingPipeline.js` | `EnvironmentProperties.js` UI | Delta |
|---|---|---|---|
| Bloom | `UnrealBloomPass` — strength/radius/threshold | None | Add UI |
| God Rays | None (Phase 1) | None (Phase 1) | Both |
| Chromatic Aberration | None | None | Add shader + UI |
| Vignette | None | None | Add shader + UI |
| Film Grain | None | None | Add shader + UI |
| Tone Mapping | `renderer.toneMapping` set at init | None | Add UI |
| LUT | `LUTPass` — enabled/intensity/texture | None | Add UI |

---

# PHASE 1 - GOD RAYS

**Priority: HIGHEST. Implement first.**

---

## P1 Overview

God rays (crepuscular light shafts) are the single most impactful missing visual. They appear at low sun elevations (5-25 degrees) where the sun is near the horizon and scene objects or clouds cast visible shadows through the atmosphere.

**Technique:** Screen-space radial blur toward sun screen position ("Volumetric Light Scattering as a Post-Process", GPU Gems 3, Ch. 13). Runs at 1/4 resolution, ~0.4ms on any mid-range GPU.

```
RenderPass -> [AO] -> BloomPass -> OutlinePass -> OutputPass -> [GodRaysPass] -> FXAAPass -> LUTPass
```

God rays are injected AFTER OutputPass (post-tone-mapping). They are an additive LDR contribution.

---

## P1.1 - Create `editor/src/viewport/GodRays.js`

Full class implementation:

```js
/**
 * GodRays.js
 * Screen-space radial blur god ray effect.
 * GPU Gems 3, Ch. 13 - "Volumetric Light Scattering as a Post-Process"
 *
 * Usage:
 *   const gr = new GodRays(viewportEngine);
 *   gr.setEnabled(true);
 *   gr.setParams({ density: 0.96, weight: 0.4, decay: 0.9, exposure: 0.65, samples: 60 });
 *   // Call gr.update(sunWorldDir, camera) each frame BEFORE composer.render()
 *   // insert gr.pass into EffectComposer after OutputPass
 */

import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// -- Radial blur shader --

const GodRaysVertShader = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const GodRaysFragShader = /* glsl */`
uniform sampler2D tOccluder;
uniform vec2      sunScreenPos;   // [0,1] screen space
uniform float     density;        // 0.96
uniform float     weight;         // 0.40
uniform float     decay;          // 0.90
uniform float     exposure;       // 0.65
uniform int       numSamples;     // 60
uniform float     enabled;        // 0 or 1

varying vec2 vUv;

void main() {
  if (enabled < 0.5) { gl_FragColor = vec4(0.0); return; }

  vec2 uv        = vUv;
  vec2 deltaUV   = (uv - sunScreenPos) * (density / float(numSamples));
  float decayVal = 1.0;
  vec3 godRay    = vec3(0.0);

  for (int i = 0; i < 100; i++) {
    if (i >= numSamples) break;
    uv -= deltaUV;
    vec3 s = texture2D(tOccluder, clamp(uv, 0.0, 1.0)).rgb;
    s     *= decayVal * weight;
    godRay += s;
    decayVal *= decay;
  }

  gl_FragColor = vec4(clamp(godRay * exposure, 0.0, 1.5), 1.0);
}
`;

export class GodRays {
  constructor(viewportEngine) {
    this._vpe = viewportEngine;
    this._enabled    = false;
    this._occluderRT = null;  // 1/4 res WebGLRenderTarget for silhouette mask
    this._blackMat   = null;  // MeshBasicMaterial: black for occluder pass
    this._pass       = null;  // ShaderPass - radial blur, additive output
    this._renderer   = null;

    this._p = {
      density:  0.96,
      weight:   0.40,
      decay:    0.90,
      exposure: 0.65,
      samples:  60,
    };
  }

  /** The ShaderPass to insert into EffectComposer after OutputPass. */
  get pass() { return this._pass; }

  setEnabled(v) {
    this._enabled = !!v;
    if (this._pass) {
      this._pass.uniforms['enabled'].value = v ? 1.0 : 0.0;
    }
  }

  setParams(opts = {}) {
    if (opts.density  !== undefined) this._p.density  = opts.density;
    if (opts.weight   !== undefined) this._p.weight   = opts.weight;
    if (opts.decay    !== undefined) this._p.decay    = opts.decay;
    if (opts.exposure !== undefined) this._p.exposure = opts.exposure;
    if (opts.samples  !== undefined) this._p.samples  = Math.round(opts.samples);
    if (this._pass) this._applyUniforms();
  }

  /**
   * Call once when the WebGL pipeline is built.
   * @param {WebGLRenderer} renderer
   * @param {number} w  Full viewport width
   * @param {number} h  Full viewport height
   */
  build(renderer, w, h) {
    this.dispose();
    this._renderer = renderer;

    // 1/4-resolution occluder render target
    this._occluderRT = new THREE.WebGLRenderTarget(
      Math.max(1, Math.floor(w / 4)),
      Math.max(1, Math.floor(h / 4)),
      {
        format:    THREE.RGBFormat,
        type:      THREE.UnsignedByteType,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
      }
    );

    // Black silhouette material for scene geometry in the occluder pass
    this._blackMat = new THREE.MeshBasicMaterial({ color: 0x000000 });

    // Radial blur ShaderPass - additive blending onto the final frame
    this._pass = new ShaderPass({
      uniforms: {
        tDiffuse:     { value: null },
        tOccluder:    { value: null },
        sunScreenPos: { value: new THREE.Vector2(0.5, 0.5) },
        density:      { value: this._p.density },
        weight:       { value: this._p.weight },
        decay:        { value: this._p.decay },
        exposure:     { value: this._p.exposure },
        numSamples:   { value: this._p.samples },
        enabled:      { value: this._enabled ? 1.0 : 0.0 },
      },
      vertexShader:   GodRaysVertShader,
      fragmentShader: GodRaysFragShader,
    });
    this._pass.material.blending    = THREE.AdditiveBlending;
    this._pass.material.depthWrite  = false;
    this._pass.material.transparent = true;
    this._pass.needsSwap = false;
  }

  /**
   * Must be called every frame BEFORE composer.render().
   * Renders the occluder pass and updates the sun screen position uniform.
   * @param {THREE.Camera} camera
   * @param {THREE.Vector3} sunWorldDir  unit vector pointing toward sun
   */
  update(camera, sunWorldDir) {
    if (!this._enabled || !this._pass || !this._occluderRT || !this._renderer) return;
    const scene = this._vpe?.scene;
    if (!scene) return;

    // 1. Project sun direction to screen UV [0,1]
    const sunPoint = sunWorldDir.clone().multiplyScalar(camera.near * 10000);
    sunPoint.add(camera.position);
    sunPoint.project(camera);  // NDC [-1,1]

    const sunScreenX = sunPoint.x * 0.5 + 0.5;
    const sunScreenY = sunPoint.y * 0.5 + 0.5;
    const sunBehind  = sunPoint.z > 1.0;

    // 2. Render occluder pass - scene = black, sky sun disc = white
    const gradSky = this._vpe?.gradientSky;

    scene.overrideMaterial = this._blackMat;
    if (gradSky?._mesh) gradSky._mesh.userData._inOccluderPass = true;

    this._renderer.setRenderTarget(this._occluderRT);
    this._renderer.setClearColor(0x000000, 1);
    this._renderer.clear();
    this._renderer.render(scene, camera);
    this._renderer.setRenderTarget(null);

    scene.overrideMaterial = null;
    if (gradSky?._mesh) gradSky._mesh.userData._inOccluderPass = false;

    // 3. Update radial blur uniforms
    const u = this._pass.uniforms;
    u['tOccluder'].value      = this._occluderRT.texture;
    u['sunScreenPos'].value.set(sunScreenX, sunScreenY);
    u['enabled'].value        = (this._enabled && !sunBehind) ? 1.0 : 0.0;
  }

  resize(w, h) {
    if (this._occluderRT) {
      this._occluderRT.setSize(
        Math.max(1, Math.floor(w / 4)),
        Math.max(1, Math.floor(h / 4))
      );
    }
  }

  dispose() {
    this._occluderRT?.dispose();
    this._blackMat?.dispose();
    this._pass?.dispose();
    this._occluderRT = null;
    this._blackMat   = null;
    this._pass       = null;
  }

  _applyUniforms() {
    const u = this._pass.uniforms;
    u['density'].value    = this._p.density;
    u['weight'].value     = this._p.weight;
    u['decay'].value      = this._p.decay;
    u['exposure'].value   = this._p.exposure;
    u['numSamples'].value = this._p.samples;
  }
}
```

---

## P1.2 - Patch `GradientSky.js`: Occluder Material

During the god rays occluder pass, the sky sphere must render the sun disc as **white** while the rest of the sky is black. Add `_createOccluderMaterial()` and patch `onBeforeRender`.

Add to the top of `GradientSky.js`, after the existing GLSL constants:

```js
// Occluder fragment shader: renders only the sun disc as white
const SKY_OCCLUDER_FRAG = /* glsl */`
precision highp float;
uniform vec3  uSunDir;
uniform float uSunInner;
uniform float uSunOuter;
uniform float uSunVisible;
varying vec3 vLocalPos;

void main() {
  vec3 dir    = normalize(vLocalPos);
  float sunDot = dot(dir, normalize(uSunDir));
  float disc   = smoothstep(uSunOuter, uSunInner, sunDot) * uSunVisible;
  gl_FragColor = vec4(vec3(disc), 1.0);
}
`;
```

Add this method inside the `GradientSky` class:

```js
_createOccluderMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uSunDir:     { value: this._p.sunDir },
      uSunInner:   { value: SUN_INNER },   // same constant used by main sky shader
      uSunOuter:   { value: SUN_OUTER },
      uSunVisible: { value: 1.0 },
    },
    vertexShader:   SKY_VERT,              // same vertex shader as main sky
    fragmentShader: SKY_OCCLUDER_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
  });
}
```

In `_createMeshWebGL()`, after `this._mesh = new THREE.Mesh(geo, mat)`:

```js
// Store reference to main material for swap
this._mainMat     = mat;
this._occluderMat = this._createOccluderMaterial();
this._mesh.userData._occluderMat = this._occluderMat;

// Swap to occluder material during god rays occluder pass
this._mesh.onBeforeRender = () => {
  if (this._mesh.userData._inOccluderPass) {
    this._mesh.material = this._occluderMat;
  } else {
    this._mesh.material = this._mainMat;
  }
};
```

Extend `_pushUniforms()` to keep occluder material in sync:

```js
// At end of _pushUniforms():
if (this._occluderMat) {
  this._occluderMat.uniforms.uSunDir.value.copy(this._p.sunDir);
  this._occluderMat.uniforms.uSunVisible.value = this._sunVisible();
}
```

---

## P1.3 - Wire God Rays into `PostProcessingPipeline.js`

**Import** at top of file:
```js
import { GodRays } from './GodRays.js';
```

**Constructor** - add after existing field declarations:
```js
this.godRays          = new GodRays(engine);
this._godRaysEnabled  = false;
this._godRaysParams   = { density: 0.96, weight: 0.40, decay: 0.90, exposure: 0.65, samples: 60 };
```

**`_buildWebGLPipeline()`** - add after `this._composer.addPass(this.lutPass)`:
```js
// 8. God Rays - additive overlay, rendered over the final LDR frame
this.godRays.build(renderer, w, h);
this.godRays.setEnabled(this._godRaysEnabled);
this.godRays.setParams(this._godRaysParams);
this._composer.addPass(this.godRays.pass);
```

**Per-frame render** - locate where `this._composer.render()` is called (in the main render method). Add immediately BEFORE it:
```js
// Update god rays occluder pass each frame
if (this._godRaysEnabled) {
  const ve     = this.engine;
  const skyType = ve?._activeSkyType;
  const skyObj  = skyType === 'physical' ? ve?.physicalSky : ve?.gradientSky;
  const sunDir  = skyObj?._p?.sunDir;
  if (sunDir) this.godRays.update(ve.camera, sunDir);
}
```

**Resize** - in the resize handler, after other pass resizes:
```js
this.godRays?.resize(w, h);
```

**`_disposeWebGLPipeline()`** - add before/after existing dispose calls:
```js
this.godRays?.dispose();
```

**New public API**:
```js
setGodRaysEnabled(v) {
  this._godRaysEnabled = !!v;
  this.godRays?.setEnabled(v);
}

updateGodRaysParams(opts) {
  Object.assign(this._godRaysParams, opts);
  this.godRays?.setParams(opts);
}
```

---

## P1.4 - Wire God Rays into `ViewportEngine.js`

**Constructor** - add to event binding block:
```js
this._onGodRaysChange = this._onGodRaysChange.bind(this);
window.addEventListener('cyco-godrays-change', this._onGodRaysChange);
```

**New handler** - add alongside `_onFogChange`:
```js
_onGodRaysChange({ detail } = {}) {
  const pp = window.__cyco?.postPipeline;
  if (!pp) return;
  const { enabled, ...params } = detail ?? {};
  if (enabled !== undefined) pp.setGodRaysEnabled(enabled);
  if (Object.keys(params).length) pp.updateGodRaysParams(params);
}
```

---

## P1.5 - Add God Rays Section to `EnvironmentProperties.js`

Add `_buildGodRaysSection(root)` method and call it from `_build()` after `_buildSkySection(root)`:

```js
_buildGodRaysSection(root) {
  const { el, body } = section('God Rays');
  root.appendChild(el);

  const _fire = () => {
    window.dispatchEvent(new CustomEvent('cyco-godrays-change', {
      detail: {
        enabled:  enabledCb.checked,
        density:  parseFloat(densitySlider.input.value),
        weight:   parseFloat(weightSlider.input.value),
        decay:    parseFloat(decaySlider.input.value),
        exposure: parseFloat(exposureSlider.input.value),
        samples:  parseInt(samplesSlider.input.value, 10),
      }
    }));
  };

  const enabledCb = checkbox({ checked: false, onChange: _fire });
  body.appendChild(row('Enable', enabledCb));

  const qualitySelect = select({
    options: [
      ['low',    'Low - 20 samples'],
      ['medium', 'Medium - 40 samples (recommended)'],
      ['high',   'High - 80 samples'],
      ['ultra',  'Ultra - 100 samples (screenshot)'],
    ],
    value: 'medium',
    onChange: (v) => {
      const presets = { low: 20, medium: 40, high: 80, ultra: 100 };
      samplesSlider.input.value = presets[v];
      _fire();
    },
  });
  body.appendChild(row('Quality', qualitySelect));

  const densitySlider = slider({ value: 0.96, min: 0.50, max: 1.00, step: 0.01, onChange: _fire });
  body.appendChild(row('Density', densitySlider.el));

  const weightSlider = slider({ value: 0.40, min: 0.05, max: 1.00, step: 0.01, onChange: _fire });
  body.appendChild(row('Weight', weightSlider.el));

  const decaySlider = slider({ value: 0.90, min: 0.70, max: 0.99, step: 0.01, onChange: _fire });
  body.appendChild(row('Decay', decaySlider.el));

  const exposureSlider = slider({ value: 0.65, min: 0.05, max: 2.00, step: 0.05, onChange: _fire });
  body.appendChild(row('Exposure', exposureSlider.el));

  const samplesSlider = slider({ value: 40, min: 10, max: 100, step: 5, onChange: _fire });
  body.appendChild(row('Samples', samplesSlider.el));

  this._godRaysControls = { enabledCb, densitySlider, weightSlider, decaySlider, exposureSlider, samplesSlider };
}
```

---

## P1.6 - God Rays Parameter Guide

| Parameter | Short-Beam | Long-Haze | Notes |
|---|---|---|---|
| Density | 0.85-0.92 | 0.96-0.99 | How far beams reach from sun |
| Weight | 0.3-0.5 | 0.15-0.3 | Per-step brightness |
| Decay | 0.80-0.88 | 0.93-0.97 | Exponential fade rate |
| Exposure | 0.5-0.8 | 0.3-0.5 | Final brightness scale |
| Samples | 30-60 | 60-100 | Quality vs performance |

Best at sun elevation 2-25 degrees. At elevation > 40 degrees god rays are nearly invisible.

---

# PHASE 2 - PHYSICAL SKY (THREE.Sky / Hosek-Wilkie)

---

## P2 Overview

`THREE.Sky` from `three/addons/objects/Sky.js` is a Hosek-Wilkie physically-based atmospheric scattering implementation equivalent to UE5 Sky Atmosphere.

**WebGPU constraint:** `THREE.Sky` uses `ShaderMaterial` with GLSL. Under `WebGPURenderer`, `ShaderMaterial` renders black. Physical Sky is WebGL-only in Phase 2. A TSL port is a Phase 4 stretch goal. Show a UI notice when WebGPU is active and Physical Sky is selected.

---

## P2.1 - Create `editor/src/viewport/PhysicalSky.js`

```js
/**
 * PhysicalSky.js - THREE.Sky-based physically-correct atmosphere.
 * Hosek-Wilkie model: Rayleigh + Mie scattering.
 * WebGL ONLY - THREE.Sky uses ShaderMaterial which is black under WebGPURenderer.
 *
 * Public API matches GradientSky.js:
 *   setEnabled(bool), setParams(opts), update(), dispose(), get sunLight()
 */

import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { Lensflare, LensflareElement } from 'three/addons/objects/Lensflare.js';

export class PhysicalSky {
  constructor(viewportEngine) {
    this._vpe      = viewportEngine;
    this._sky      = null;
    this._mesh     = null;   // alias for GodRays compatibility
    this._sunLight = null;
    this._lensflare = null;
    this._enabled  = false;

    this._p = {
      elevation:       30,
      azimuth:         180,
      turbidity:       2.0,
      rayleigh:        1.0,
      mieCoefficient:  0.005,
      mieDirectionalG: 0.8,
      exposure:        1.0,
      showSun:         true,
      sunColor:        new THREE.Color(1, 0.97, 0.88),
      lensflareEnabled: true,
      lensflareSize:   150,
      lensflareOpacity: 0.7,
      sunDir: new THREE.Vector3(),
    };

    this._updateDirs();
    this._initSunLight();
  }

  get enabled()  { return this._enabled; }
  get sunLight() { return this._sunLight; }

  setEnabled(v) {
    this._enabled = !!v;
    if (v && !this._sky) this._createSky();
    else if (!v)         this._destroySky();
  }

  setParams(opts = {}) {
    const p = this._p;
    if (opts.elevation          !== undefined) p.elevation          = opts.elevation;
    if (opts.azimuth            !== undefined) p.azimuth            = opts.azimuth;
    if (opts.turbidity          !== undefined) p.turbidity          = opts.turbidity;
    if (opts.rayleigh           !== undefined) p.rayleigh           = opts.rayleigh;
    if (opts.mieCoefficient     !== undefined) p.mieCoefficient     = opts.mieCoefficient;
    if (opts.mieDirectionalG    !== undefined) p.mieDirectionalG    = opts.mieDirectionalG;
    if (opts.exposure           !== undefined) p.exposure           = opts.exposure;
    if (opts.showSun            !== undefined) p.showSun            = opts.showSun;
    if (opts.sunColor) p.sunColor.set(opts.sunColor);
    if (opts.lensflareEnabled   !== undefined) p.lensflareEnabled   = opts.lensflareEnabled;
    if (opts.lensflareSize      !== undefined) p.lensflareSize      = opts.lensflareSize;
    if (opts.lensflareOpacity   !== undefined) p.lensflareOpacity   = opts.lensflareOpacity;

    this._updateDirs();
    this._pushUniforms();
    this._updateSunLight();
    this._updateLensflare();
  }

  update() {
    if (!this._sky) return;
    const cam = this._vpe?.camera;
    if (cam) {
      this._sky.position.copy(cam.position);
      if (this._lensflare) {
        const dist = (cam.far ?? 10000) * 0.5;
        this._lensflare.position
          .copy(this._p.sunDir)
          .multiplyScalar(dist)
          .add(cam.position);
      }
    }
  }

  dispose() {
    const scene = this._vpe?.scene;
    if (this._sunLight) {
      scene?.remove(this._sunLight, this._sunLight.target);
      this._sunLight = null;
    }
    this._destroySky();
  }

  _createSky() {
    const scene = this._vpe?.scene;
    if (!scene) return;

    this._sky  = new Sky();
    this._mesh = this._sky;
    this._sky.scale.setScalar(450000);
    this._sky.name = '__cyco_physical_sky';

    // Clamp HDR output to prevent bloom contamination (max 4.5 = SDR-safe)
    this._sky.material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        'gl_FragColor = vec4( texColor, 1.0 );',
        'gl_FragColor = vec4( min( texColor, vec3( 4.5 ) ), 1.0 );'
      );
    };

    this._pushUniforms();
    scene.add(this._sky);
    this._createLensflare(scene);
  }

  _destroySky() {
    const scene = this._vpe?.scene;
    if (this._lensflare) { scene?.remove(this._lensflare); this._lensflare = null; }
    if (this._sky) {
      scene?.remove(this._sky);
      this._sky.geometry?.dispose();
      this._sky.material?.dispose();
      this._sky  = null;
      this._mesh = null;
    }
  }

  _initSunLight() {
    const scene = this._vpe?.scene;
    if (!scene || this._sunLight) return;
    this._sunLight = new THREE.DirectionalLight(0xfff8e7, 2.0);
    this._sunLight.name = '__cyco_physical_sun_light';
    this._sunLight.userData._isHelper = true;
    this._sunLight.castShadow = true;
    this._sunLight.shadow.mapSize.set(2048, 2048);
    this._sunLight.shadow.camera.near   = 0.5;
    this._sunLight.shadow.camera.far    = 1000;
    this._sunLight.shadow.camera.left   = -50;
    this._sunLight.shadow.camera.right  =  50;
    this._sunLight.shadow.camera.top    =  50;
    this._sunLight.shadow.camera.bottom = -50;
    this._sunLight.shadow.bias = -0.001;
    this._sunLight.target.name = '__cyco_physical_sun_target';
    scene.add(this._sunLight, this._sunLight.target);
    this._updateSunLight();
  }

  _updateDirs() {
    const phi   = THREE.MathUtils.degToRad(90 - this._p.elevation);
    const theta = THREE.MathUtils.degToRad(this._p.azimuth);
    this._p.sunDir.setFromSphericalCoords(1, phi, theta);
  }

  _pushUniforms() {
    if (!this._sky) return;
    const u = this._sky.material.uniforms;
    u['turbidity'].value       = this._p.turbidity;
    u['rayleigh'].value        = this._p.rayleigh;
    u['mieCoefficient'].value  = this._p.mieCoefficient;
    u['mieDirectionalG'].value = this._p.mieDirectionalG;
    u['sunPosition'].value.copy(this._p.sunDir);
    u['up'].value.set(0, 1, 0);
  }

  _updateSunLight() {
    if (!this._sunLight) return;
    this._sunLight.position.copy(this._p.sunDir).multiplyScalar(100);
    this._sunLight.target.position.set(0, 0, 0);
    const t = Math.max(0, Math.min(1, (this._p.elevation + 5) / 20));
    this._sunLight.intensity = 2.0 * t * t * (3 - 2 * t);
    this._sunLight.visible   = this._p.elevation > -6;
    const renderer = this._vpe?.rendererManager?.renderer;
    if (renderer) renderer.toneMappingExposure = this._p.exposure;
  }

  _createLensflare(scene) {
    const lf = new Lensflare();
    lf.userData._isHelper = true;
    const dist = (this._vpe?.camera?.far ?? 10000) * 0.5;
    lf.position.copy(this._p.sunDir).multiplyScalar(dist);
    if (this._p.lensflareEnabled) {
      const tex = this._makeFlareTex(64);
      lf.addElement(new LensflareElement(tex, this._p.lensflareSize, 0, this._p.sunColor));
    }
    scene.add(lf);
    this._lensflare = lf;
  }

  _updateLensflare() {
    if (this._lensflare) this._lensflare.visible = this._p.lensflareEnabled;
  }

  _makeFlareTex(size) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
    g.addColorStop(0,   'rgba(255,255,255,1)');
    g.addColorStop(0.3, 'rgba(255,220,120,0.6)');
    g.addColorStop(1,   'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(c);
  }
}
```

---

## P2.2 - Add Sky Type Dropdown to `EnvironmentProperties.js`

Inside `_buildSkySection()`, add immediately after the `Show Sky` checkbox row:

```js
const skyTypeSelect = select({
  options: [
    ['gradient', 'Gradient Sky'],
    ['physical', 'Physical Sky (WebGL only)'],
    ['hdri',     'HDRI Panorama'],
  ],
  value: 'gradient',
  onChange: (v) => {
    // Show atmosphere sub-section only for physical sky
    atmHeader.style.display = v === 'physical' ? '' : 'none';
    atmBody.style.display   = v === 'physical' ? '' : 'none';
    // Show gradient editor only for gradient sky
    gradHeader.style.display = v === 'gradient' ? '' : 'none';
    gradBody.style.display   = v === 'gradient' ? '' : 'none';
    _fireSkyChange();
  },
});
body.appendChild(row('Sky Type', skyTypeSelect));
this._skyTypeSelect = skyTypeSelect;
```

Add the Atmosphere sub-section (show/hide based on sky type):

```js
// Atmosphere sub-section (Hosek-Wilkie controls, physical sky only)
const atmHeader = document.createElement('div');
atmHeader.textContent = 'Atmosphere';
atmHeader.style.cssText = 'font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-dim);padding:6px 8px 2px;margin-top:4px;';
const turbiditySlider  = slider({ value: 2.0, min: 1, max: 20, step: 0.1, onChange: () => _fireSkyChange() });
const rayleighSlider   = slider({ value: 1.0, min: 0, max: 4,  step: 0.05, onChange: () => _fireSkyChange() });
const mieGSlider       = slider({ value: 0.8, min: 0, max: 0.99, step: 0.01, onChange: () => _fireSkyChange() });
const mieCSlider       = slider({ value: 0.005, min: 0, max: 0.1, step: 0.001, onChange: () => _fireSkyChange() });

const atmBody = document.createElement('div');
atmBody.appendChild(row('Turbidity (Haze)',     turbiditySlider.el));
atmBody.appendChild(row('Rayleigh (Blue Sky)',  rayleighSlider.el));
atmBody.appendChild(row('Mie Anisotropy',       mieGSlider.el));
atmBody.appendChild(row('Mie Coefficient',      mieCSlider.el));

body.appendChild(atmHeader);
body.appendChild(atmBody);
atmHeader.style.display = 'none';
atmBody.style.display   = 'none';
```

Add atmosphere params to `_fireSkyChange()`:
```js
skyType:         this._skyTypeSelect?.value ?? 'gradient',
turbidity:       parseFloat(turbiditySlider.input.value),
rayleigh:        parseFloat(rayleighSlider.input.value),
mieDirectionalG: parseFloat(mieGSlider.input.value),
mieCoefficient:  parseFloat(mieCSlider.input.value),
```

---

## P2.3 - Route Sky Type in `ViewportEngine.js`

Add import:
```js
import { PhysicalSky } from './PhysicalSky.js';
```

In `init()`, after `this.gradientSky = new GradientSky(this)`:
```js
this.physicalSky    = new PhysicalSky(this);
this._activeSkyType = 'gradient';
```

Replace `_onSkyChange()` sky activation logic:
```js
_onSkyChange({ detail } = {}) {
  if (!this.scene) return;

  if (!detail?.enabled) {
    this.gradientSky?.setEnabled(false);
    this.physicalSky?.setEnabled(false);
    this.skyEnabled = false;
    this.scene.background = null;
    return;
  }

  const skyType  = detail.skyType ?? 'gradient';
  const isWebGPU = this.rendererManager?.renderer?.isWebGPURenderer;

  // Physical Sky is WebGL-only
  const resolvedType = (skyType === 'physical' && isWebGPU) ? 'gradient' : skyType;
  this._activeSkyType = resolvedType;

  // Deactivate the other sky
  if (resolvedType !== 'gradient') this.gradientSky?.setEnabled(false);
  if (resolvedType !== 'physical') this.physicalSky?.setEnabled(false);

  if (resolvedType === 'gradient') {
    // ... existing gradient sky logic unchanged ...
    this.gradientSky.setEnabled(true);
    this.gradientSky.setParams(detail);
    this.scene.background = null;
  } else if (resolvedType === 'physical') {
    this.physicalSky.setEnabled(true);
    this.physicalSky.setParams(detail);
    this.scene.background = null;
  }

  this.skyEnabled   = true;
  this.skyElevation = detail.elevation ?? this.skyElevation;
  this.skyAzimuth   = detail.azimuth   ?? this.skyAzimuth;

  const renderer = this.rendererManager?.renderer;
  if (renderer && detail.exposure !== undefined) {
    renderer.toneMappingExposure = detail.exposure;
  }
  if (detail.colorStops && renderer && resolvedType === 'gradient') {
    this._buildSkyEnvMap(detail.colorStops, renderer);
  }
  this.cloudSystem?.updateSunFromSky(detail.elevation, detail.azimuth);
  this.cloudSystem2?.updateSunFromSky(detail.elevation, detail.azimuth);
}
```

---

## P2.4 - Physical Sky Parameter Presets

| Preset | Turbidity | Rayleigh | MieG | Notes |
|---|---|---|---|---|
| Clear Earth | 2.0 | 1.0 | 0.80 | Default - blue sky, natural sunset |
| Hazy day | 6.0 | 1.0 | 0.85 | Soft sun, washed-out horizon |
| Heavy smog | 12.0 | 0.5 | 0.90 | Industrial atmosphere |
| Alien blue | 2.0 | 3.0 | 0.70 | More vivid blue scattering |
| Alien orange | 2.0 | 0.3 | 0.92 | Minimal blue, tight sun corona |
| Overcast | 8.0 | 2.0 | 0.60 | Diffuse, very low contrast |

---

# PHASE 3 - AERIAL PERSPECTIVE AND HEIGHT FOG

---

## P3 Overview

Two fog modes:
- **Exp2 Fog** (`THREE.FogExp2`) - uniform in all directions, zero cost (already partially implemented)
- **Height-Stratified Fog** - fog density falls off exponentially with world Y altitude (more realistic)

---

## P3.1 - Improve Fog Handler in `ViewportEngine.js`

Replace the existing `_onFogChange()`:

```js
_onFogChange({ detail } = {}) {
  if (!this.scene) return;
  const {
    type      = 'none',
    color     = '#aaaaaa',
    near      = 1,
    far       = 1000,
    density   = 0.0002,
    autoColor = false,
  } = detail ?? {};

  // Auto-color: sample horizon color from gradient sky
  let fogColor = color;
  if (autoColor) {
    const data = this.gradientSky?._gradientTex?.image?.data;
    if (data) {
      const idx = Math.floor(0.48 * (data.length / 4)) * 4;
      const r = data[idx] / 255, g = data[idx+1] / 255, b = data[idx+2] / 255;
      fogColor = `rgb(${Math.round(r*255)},${Math.round(g*255)},${Math.round(b*255)})`;
    }
  }

  const c = new THREE.Color(fogColor);
  if      (type === 'linear') this.scene.fog = new THREE.Fog(c, near, far);
  else if (type === 'exp2')   this.scene.fog = new THREE.FogExp2(c, density);
  else                        this.scene.fog = null;
}
```

---

## P3.2 - Revamp Fog Section in `EnvironmentProperties.js`

Replace or add `_buildFogSection(root)`:

```js
_buildFogSection(root) {
  const { el, body } = section('Fog / Aerial Perspective');
  root.appendChild(el);

  const _fire = () => {
    window.dispatchEvent(new CustomEvent('cyco-fog-change', {
      detail: {
        type:      typeSelect.value,
        color:     colorSw.el.style.getPropertyValue('--sw-color') || '#aaaaaa',
        autoColor: autoColorCb.checked,
        density:   parseFloat(densitySlider.input.value),
        near:      parseFloat(nearSlider.input.value),
        far:       parseFloat(farSlider.input.value),
      },
    }));
  };

  const typeSelect = select({
    options: [
      ['none',   'Off'],
      ['exp2',   'Exponential (recommended)'],
      ['linear', 'Linear'],
    ],
    value: 'none',
    onChange: (v) => {
      linearRows.forEach(r => { r.style.display = v === 'linear' ? '' : 'none'; });
      expRows.forEach(r    => { r.style.display = v === 'exp2'   ? '' : 'none'; });
      _fire();
    },
  });
  body.appendChild(row('Type', typeSelect));

  const colorSw = colorSwatch({ color: '#c0d0e0', onChange: _fire });
  const autoColorCb = checkbox({ checked: true, onChange: _fire });
  const colorCtrl = document.createElement('div');
  colorCtrl.style.cssText = 'display:flex;align-items:center;gap:6px;';
  colorCtrl.appendChild(colorSw.el);
  const autoLabel = document.createElement('label');
  autoLabel.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:11px;cursor:pointer;';
  autoLabel.appendChild(autoColorCb);
  autoLabel.appendChild(document.createTextNode('Auto from sky'));
  colorCtrl.appendChild(autoLabel);
  body.appendChild(row('Color', colorCtrl));

  const densitySlider = slider({ value: 0.0002, min: 0, max: 0.005, step: 0.00005, onChange: _fire });
  const nearSlider    = slider({ value: 1,    min: 0,   max: 500,   step: 1,  onChange: _fire });
  const farSlider     = slider({ value: 1000, min: 100, max: 50000, step: 50, onChange: _fire });

  const densityRow = row('Density', densitySlider.el);
  const nearRow    = row('Near',    nearSlider.el);
  const farRow     = row('Far',     farSlider.el);

  body.appendChild(densityRow);
  body.appendChild(nearRow);
  body.appendChild(farRow);

  const linearRows = [nearRow, farRow];
  const expRows    = [densityRow];
  linearRows.forEach(r => { r.style.display = 'none'; });
  expRows.forEach(r    => { r.style.display = 'none'; });
}
```

---

# PHASE 4 - POLISH AND FUTURE FEATURES

---

## P4.1 - WebGPU Physical Sky Fallback on Renderer Switch

In `ViewportEngine._onRendererChanged()`, add after the renderer swap:

```js
// If physical sky is active and we just switched to WebGPU, fall back to gradient
if (this._activeSkyType === 'physical' && newType === 'webgpu') {
  this.physicalSky?.setEnabled(false);
  this.gradientSky?.setEnabled(true);
  this._activeSkyType = 'gradient';
  // Optional: show a toast notification to the user
}
```

---

## P4.2 - WebGPU God Rays via GodraysNode

Three.js r184 may include `three/addons/tsl/display/GodraysNode.js`. In `_buildWebGPUPipeline()`:

```js
try {
  const { GodraysNode } = await import('three/addons/tsl/display/GodraysNode.js');
  const ve       = this.engine;
  const skyType  = ve?._activeSkyType;
  const skyObj   = skyType === 'physical' ? ve?.physicalSky : ve?.gradientSky;
  const sunLight = skyObj?.sunLight;
  if (sunLight && this._godRaysEnabled) {
    const godrays = new GodraysNode(sunLight, scenePassDepth);
    godrays.density.value = this._godRaysParams.density;
    godrays.decay.value   = this._godRaysParams.decay;
    godrays.weight.value  = this._godRaysParams.weight;
    outputNode = outputNode.add(godrays);
  }
} catch (e) {
  // GodraysNode not available in this build - skip silently
}
```

---

## P4.3 - TSL Physical Sky Port (WebGPU Physical Sky)

Full Hosek-Wilkie TSL port skeleton:

```js
// PhysicalSkyNode.js - Hosek-Wilkie atmosphere in TSL
// Full coefficient tables from Three.js Sky SkyShader.js must be ported

import { Fn, float, vec3, vec4, dot, exp, pow, max, normalize, mix } from 'three/tsl';
import * as THREE from 'three';

// Hosek-Wilkie evaluation (simplified skeleton):
export const hosekWilkieSky = Fn(([direction, sunDir, turbidity, rayleigh, mieG, mieC]) => {
  // 1. Compute angle between view ray and sun
  // 2. Evaluate Rayleigh phase function
  // 3. Evaluate Mie phase function
  // 4. Look up Hosek-Wilkie A-I coefficients for current turbidity
  // 5. Evaluate sky radiance distribution
  // 6. Return final RGB sky colour
  // NOTE: Full coefficient tables (9 floats x 3 channels x 10 turbidity levels)
  // are available in three/addons/objects/Sky.js SkyShader.js
  return vec4(vec3(0.5, 0.7, 1.0), 1.0); // placeholder
});

// Usage:
// const skyMat = new THREE.MeshBasicNodeMaterial();
// skyMat.colorNode = hosekWilkieSky(normalLocal, sunDirRef, turbidityRef, ...);
```

---

## P4.4 - HDRI Mode Cleanup

Planned improvements for HDRI sky mode (all properties on `scene.*`):

```js
// In ViewportEngine - add these to the cyco-sky-change handler for hdri type
if (resolvedType === 'hdri') {
  // Rotation (Three.js r163+)
  if (detail.hdriRotation !== undefined) {
    this.scene.backgroundRotation.y = THREE.MathUtils.degToRad(detail.hdriRotation);
    this.scene.environmentRotation.y = THREE.MathUtils.degToRad(detail.hdriRotation);
  }
  // Background blur (0.0 = sharp, 1.0 = fully blurred)
  if (detail.backgroundBlur !== undefined) {
    this.scene.backgroundBlurriness = detail.backgroundBlur;
  }
  // Decouple background vs IBL intensity
  if (detail.backgroundIntensity !== undefined) {
    this.scene.backgroundIntensity = detail.backgroundIntensity;
  }
  if (detail.envIntensity !== undefined) {
    this.scene.environmentIntensity = detail.envIntensity;
  }
  // Manual sun direction (since sun can't be auto-derived from HDRI)
  const phi   = THREE.MathUtils.degToRad(90 - (detail.elevation ?? 45));
  const theta = THREE.MathUtils.degToRad(detail.azimuth ?? 180);
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
  this.gradientSky?._sunLight?.position.copy(sunDir).multiplyScalar(100);
}
```

UI additions for HDRI mode in `EnvironmentProperties.js`:
- `hdriRotation` slider (0-360 degrees)
- `backgroundBlur` slider (0-1)
- `backgroundIntensity` slider (0-2)
- `envIntensity` slider (0-2)
- Sun elevation + azimuth sliders (already exist, just need to remain visible in HDRI mode)

---

# PHASE 5 - LENS FLARE REVAMP

---

## P5 Overview

Replace the current 5-preset-style system in `GradientSky.js` with a fully granular set of controls that match the Ultimate Lens Flare API. The new system gives the user direct control over every parameter rather than choosing from presets.

Reference: [R3F Ultimate Lens Flare](https://ultimate-lens-flare.vercel.app/) — all the parameters in the target UI layout are taken directly from this reference implementation.

**Applies to:** Both `GradientSky.js` (WebGL) and `PhysicalSky.js` (WebGL). The WebGPU Sprite-based fallback continues to use a simplified version.

---

## P5.1 - New Lens Flare Parameters

Add to `GradientSky._p` (replacing the old style-based params):

```js
// Old style-based params (remove these):
//   lensflareStyle, lensflareIntensity, lensflareGhostCount,
//   lensflareStreakLength, lensflareBrightness,
//   lensflareRingThickness, lensflareRingFill, lensflareRingSize, lensflareRingOpacity

// New granular params:
lensflareEnabled:       true,
lensflareOpacity:       0.7,
lensflareGlareSize:     0.4,   // radius of the base lens glare disk
lensflareStarPoints:    6,     // number of diffraction spikes (0 = none)
lensflareFlareSize:     0.25,  // overall size of the flare train
lensflareFlareSpeed:    0.0,   // animation speed (0 = static)
lensflareFlareShape:    0,     // 0=circular, 1=oval, 2=streak
lensflareHaloScale:     0.5,   // size of the halo ring
lensflareColorGain:     new THREE.Color(1, 0.97, 0.88),  // flare color tint
lensflareGhostScale:    0.3,   // size of secondary ghost elements
lensflareSecondaryGhosts: true,
lensflareAdditionalStreaks: false,
lensflareStarBurst:     false,
lensflareAnamorphic:    false, // horizontal streak mode
```

---

## P5.2 - Update `GradientSky.js` Lens Flare System

The lens flare generation in `_createWebGLFlares()` / `_createWebGPUFlares()` needs to read from the new params. Remove the switch-case on style and replace with direct param reads:

```js
// In _createWebGLFlares():
const p = this._p;

// Base glare disc
const glareTex = this._makeGlareTex(128, p.lensflareStarPoints);
this._flare.addElement(new LensflareElement(
  glareTex,
  p.lensflareGlareSize * 200,
  0,
  p.lensflareColorGain
));

// Halo ring
if (p.lensflareHaloScale > 0) {
  const haloTex = this._makeHaloTex(128);
  this._flare.addElement(new LensflareElement(
    haloTex,
    p.lensflareHaloScale * 300,
    0.6,     // offset along axis
    p.lensflareColorGain
  ));
}

// Flare train (ghost chain)
if (p.lensflareGhostScale > 0) {
  const ghostTex = this._makeGhostTex(64);
  const offsets = [0.3, -0.2, 0.7, -0.5, 1.1];
  const sizes   = [1.0,  0.7, 0.5,  0.3, 0.2];
  offsets.forEach((off, i) => {
    this._flare.addElement(new LensflareElement(
      ghostTex,
      p.lensflareGhostScale * 200 * sizes[i],
      off * p.lensflareFlareSize,
      p.lensflareColorGain
    ));
  });
  // Secondary ghosts
  if (p.lensflareSecondaryGhosts) {
    const secOffsets = [0.15, -0.35, 0.55, -0.75];
    secOffsets.forEach((off, i) => {
      this._flare.addElement(new LensflareElement(
        ghostTex,
        p.lensflareGhostScale * 100 * (0.5 + i * 0.1),
        off,
        p.lensflareColorGain
      ));
    });
  }
}

// Anamorphic horizontal streak
if (p.lensflareAnamorphic) {
  const streakTex = this._makeStreakTex(256, 32);
  this._flare.addElement(new LensflareElement(
    streakTex,
    p.lensflareFlareSize * 600,
    0,
    p.lensflareColorGain
  ));
}

// Star burst diffraction (overlaid on flare)
if (p.lensflareStarBurst) {
  const starTex = this._makeStarBurstTex(128, p.lensflareStarPoints);
  this._flare.addElement(new LensflareElement(
    starTex,
    p.lensflareGlareSize * 400,
    0,
    p.lensflareColorGain
  ));
}
```

Texture generator helpers to add to `GradientSky.js`:

```js
// Glare disc with star diffraction spikes
_makeGlareTex(size, starPoints = 6) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const cx = size / 2, cy = size / 2, r = size / 2;
  // Base glow
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0,   'rgba(255,255,255,1)');
  g.addColorStop(0.1, 'rgba(255,240,200,0.8)');
  g.addColorStop(1,   'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  // Diffraction spikes
  if (starPoints > 0) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(255,255,200,0.3)';
    ctx.lineWidth = 1;
    for (let i = 0; i < starPoints; i++) {
      const angle = (i / starPoints) * Math.PI;
      ctx.beginPath();
      ctx.moveTo(cx - Math.cos(angle) * r, cy - Math.sin(angle) * r);
      ctx.lineTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
      ctx.stroke();
    }
    ctx.restore();
  }
  return new THREE.CanvasTexture(c);
}

_makeHaloTex(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const cx = size/2, cy = size/2, r = size * 0.4;
  const g = ctx.createRadialGradient(cx, cy, r * 0.8, cx, cy, r);
  g.addColorStop(0,   'rgba(0,0,0,0)');
  g.addColorStop(0.5, 'rgba(200,200,255,0.4)');
  g.addColorStop(1,   'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

_makeGhostTex(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const cx = size/2, cy = size/2, r = size/2;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0,   'rgba(255,220,180,0.8)');
  g.addColorStop(0.5, 'rgba(200,180,255,0.3)');
  g.addColorStop(1,   'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

_makeStreakTex(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0,   'rgba(0,0,0,0)');
  g.addColorStop(0.5, 'rgba(220,200,255,0.9)');
  g.addColorStop(1,   'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  return new THREE.CanvasTexture(c);
}

_makeStarBurstTex(size, points = 6) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const cx = size/2, cy = size/2, r = size/2;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  gradient.addColorStop(0,   'rgba(255,255,255,0.9)');
  gradient.addColorStop(1,   'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  for (let i = 0; i < points; i++) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((i / points) * Math.PI);
    ctx.beginPath();
    ctx.ellipse(0, 0, r, r * 0.02, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
  return new THREE.CanvasTexture(c);
}
```

---

## P5.3 - Update Lens Flare Section in `EnvironmentProperties.js`

Replace the style-dropdown-based Lens Flare sub-section inside `_buildSkySection()` with fully granular controls:

```js
// Remove: lensflareStyleSelect, lensflareIntensitySlider, lensflareGhostCountSlider,
//         lensflareStreakLengthSlider, lensflareBrightnessSlider,
//         lensflareRingThickness/Fill/Size/Opacity sliders

// Add:
const lensflareEnabledCb = checkbox({ checked: _skyP?.lensflareEnabled ?? true, onChange: _fire });
const opacitySlider      = slider({ value: _skyP?.lensflareOpacity ?? 0.7, min: 0, max: 1, step: 0.01, onChange: _fire });
const glareSizeSlider    = slider({ value: _skyP?.lensflareGlareSize ?? 0.4, min: 0, max: 2, step: 0.01, onChange: _fire });
const starPointsSlider   = slider({ value: _skyP?.lensflareStarPoints ?? 6, min: 0, max: 12, step: 1, onChange: _fire });
const flareSizeSlider    = slider({ value: _skyP?.lensflareFlareSize ?? 0.25, min: 0, max: 2, step: 0.01, onChange: _fire });
const flareSpeedSlider   = slider({ value: _skyP?.lensflareFlareSpeed ?? 0.0, min: 0, max: 2, step: 0.01, onChange: _fire });
const haloScaleSlider    = slider({ value: _skyP?.lensflareHaloScale ?? 0.5, min: 0, max: 2, step: 0.01, onChange: _fire });
const ghostScaleSlider   = slider({ value: _skyP?.lensflareGhostScale ?? 0.3, min: 0, max: 2, step: 0.01, onChange: _fire });
const colorGainSw        = colorSwatch({ color: '#fff8e7', onChange: _fire });
const flareShapeSelect   = select({
  options: [['0','Circular'],['1','Oval'],['2','Streak']],
  value: String(_skyP?.lensflareFlareShape ?? 0),
  onChange: _fire,
});
const secondaryGhostsCb = checkbox({ checked: _skyP?.lensflareSecondaryGhosts ?? true, onChange: _fire });
const addStreaksCb       = checkbox({ checked: _skyP?.lensflareAdditionalStreaks ?? false, onChange: _fire });
const starBurstCb        = checkbox({ checked: _skyP?.lensflareStarBurst ?? false, onChange: _fire });
const anamorphicCb       = checkbox({ checked: _skyP?.lensflareAnamorphic ?? false, onChange: _fire });

flareSec.addRow(row('Enable',            lensflareEnabledCb));
flareSec.addRow(row('Opacity',           opacitySlider.el));
flareSec.addRow(row('Glare Size',        glareSizeSlider.el));
flareSec.addRow(row('Star Points',       starPointsSlider.el));
flareSec.addRow(row('Flare Size',        flareSizeSlider.el));
flareSec.addRow(row('Flare Speed',       flareSpeedSlider.el));
flareSec.addRow(row('Flare Shape',       flareShapeSelect));
flareSec.addRow(row('Halo Scale',        haloScaleSlider.el));
flareSec.addRow(row('Color Gain',        colorGainSw.el));
flareSec.addRow(row('Ghost Scale',       ghostScaleSlider.el));
flareSec.addRow(row('Secondary Ghosts',  secondaryGhostsCb));
flareSec.addRow(row('Extra Streaks',     addStreaksCb));
flareSec.addRow(row('Star Burst',        starBurstCb));
flareSec.addRow(row('Anamorphic',        anamorphicCb));
```

Update `_fireSkyChange()` to emit the new params:
```js
lensflareOpacity:           parseFloat(opacitySlider.input.value),
lensflareGlareSize:         parseFloat(glareSizeSlider.input.value),
lensflareStarPoints:        parseInt(starPointsSlider.input.value, 10),
lensflareFlareSize:         parseFloat(flareSizeSlider.input.value),
lensflareFlareSpeed:        parseFloat(flareSpeedSlider.input.value),
lensflareFlareShape:        parseInt(flareShapeSelect.value, 10),
lensflareHaloScale:         parseFloat(haloScaleSlider.input.value),
lensflareColorGain:         colorGainSw.el.style.getPropertyValue('--sw-color') || '#fff8e7',
lensflareGhostScale:        parseFloat(ghostScaleSlider.input.value),
lensflareSecondaryGhosts:   secondaryGhostsCb.checked,
lensflareAdditionalStreaks: addStreaksCb.checked,
lensflareStarBurst:         starBurstCb.checked,
lensflareAnamorphic:        anamorphicCb.checked,
```

---

---

# PHASE 6 - POST PROCESSING CONTROLS PANEL

---

## P6 Overview

Add a dedicated **Post Processing** section to `EnvironmentProperties.js` that surfaces controls for all post-processing effects. Currently `PostProcessingPipeline.js` has Bloom, AO, LUT, etc. but there is no UI to control them from the Environment panel.

Also add three new effects: **Chromatic Aberration**, **Vignette**, and **Film Grain** as `ShaderPass` instances in `PostProcessingPipeline.js`.

**Pipeline order after Phase 6:**
```
RenderPass → [AO] → BloomPass → OutlinePass → SMAA → OutputPass → [GodRays] → [ChromaticAberration] → [Vignette] → [FilmGrain] → FXAA → LUT
```

---

## P6.1 - Chromatic Aberration ShaderPass

Add to `PostProcessingPipeline.js`:

```js
// Chromatic Aberration — splits RGB channels slightly apart
const ChromaticAberrationShader = {
  uniforms: {
    tDiffuse:  { value: null },
    strength:  { value: 0.002 },
    enabled:   { value: 0.0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float strength;
    uniform float enabled;
    varying vec2 vUv;
    void main() {
      if (enabled < 0.5) { gl_FragColor = texture2D(tDiffuse, vUv); return; }
      vec2 offset = (vUv - 0.5) * strength;
      float r = texture2D(tDiffuse, vUv + offset).r;
      float g = texture2D(tDiffuse, vUv        ).g;
      float b = texture2D(tDiffuse, vUv - offset).b;
      gl_FragColor = vec4(r, g, b, 1.0);
    }
  `,
};

// In _buildWebGLPipeline(), insert after GodRays pass:
this.chromaPass = new ShaderPass(ChromaticAberrationShader);
this.chromaPass.uniforms['enabled'].value  = this._chromaEnabled ? 1.0 : 0.0;
this.chromaPass.uniforms['strength'].value = this._chromaStrength ?? 0.002;
this._composer.addPass(this.chromaPass);
```

---

## P6.2 - Vignette ShaderPass

```js
const VignetteShader = {
  uniforms: {
    tDiffuse: { value: null },
    offset:   { value: 1.0 },
    darkness: { value: 1.0 },
    enabled:  { value: 0.0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float offset;
    uniform float darkness;
    uniform float enabled;
    varying vec2 vUv;
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      if (enabled > 0.5) {
        float dist = distance(vUv, vec2(0.5));
        color.rgb *= smoothstep(0.8, offset * 0.799, dist * (darkness + offset));
      }
      gl_FragColor = color;
    }
  `,
};

// In _buildWebGLPipeline(), after chromaPass:
this.vignettePass = new ShaderPass(VignetteShader);
this.vignettePass.uniforms['enabled'].value  = this._vignetteEnabled ? 1.0 : 0.0;
this.vignettePass.uniforms['offset'].value   = this._vignetteOffset   ?? 1.0;
this.vignettePass.uniforms['darkness'].value = this._vignetteDarkness ?? 1.0;
this._composer.addPass(this.vignettePass);
```

---

## P6.3 - Film Grain ShaderPass

```js
const FilmGrainShader = {
  uniforms: {
    tDiffuse:  { value: null },
    time:      { value: 0.0 },
    intensity: { value: 0.1 },
    enabled:   { value: 0.0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform float intensity;
    uniform float enabled;
    varying vec2 vUv;
    float rand(vec2 co) {
      return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453);
    }
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      if (enabled > 0.5) {
        float grain = rand(vUv + vec2(time * 0.001)) * 2.0 - 1.0;
        color.rgb += grain * intensity;
      }
      gl_FragColor = color;
    }
  `,
};

// In _buildWebGLPipeline(), after vignettePass:
this.filmGrainPass = new ShaderPass(FilmGrainShader);
this.filmGrainPass.uniforms['enabled'].value   = this._filmGrainEnabled ? 1.0 : 0.0;
this.filmGrainPass.uniforms['intensity'].value = this._filmGrainIntensity ?? 0.1;
this._composer.addPass(this.filmGrainPass);

// In the per-frame render loop, update time uniform:
if (this.filmGrainPass) {
  this.filmGrainPass.uniforms['time'].value = performance.now();
}
```

---

## P6.4 - Tone Mapping Selector

Add `setToneMapping(mode)` to `PostProcessingPipeline.js` or directly to `ViewportEngine.js`:

```js
// Tone mapping constants in Three.js:
// THREE.NoToneMapping        = 0
// THREE.LinearToneMapping    = 1
// THREE.ReinhardToneMapping  = 2
// THREE.CineonToneMapping    = 3
// THREE.ACESFilmicToneMapping = 4
// THREE.AgXToneMapping       = 6  (r152+)
// THREE.NeutralToneMapping   = 7  (r163+)

setToneMapping(mode) {
  const renderer = this.engine?.rendererManager?.renderer;
  if (!renderer) return;
  const map = {
    aces:     THREE.ACESFilmicToneMapping,
    linear:   THREE.LinearToneMapping,
    reinhard: THREE.ReinhardToneMapping,
    agx:      THREE.AgXToneMapping,
    cineon:   THREE.CineonToneMapping,
    none:     THREE.NoToneMapping,
  };
  renderer.toneMapping = map[mode] ?? THREE.ACESFilmicToneMapping;
}
```

---

## P6.5 - Add Post Processing Section to `EnvironmentProperties.js`

Add `_buildPostProcessingSection(root)` and call it from `_build()` after `_buildEnvMapSection`:

```js
_buildPostProcessingSection(root) {
  const { el, body } = section('Post Processing');
  root.appendChild(el);

  const _firePP = (opts) => {
    window.dispatchEvent(new CustomEvent('cyco-postfx-change', { detail: opts }));
  };

  // ── Bloom ──────────────────────────────────────────────────────────────────
  const bloomHeader = _subSectionHeader('Bloom');
  body.appendChild(bloomHeader);
  const bloomEnabledCb = checkbox({ checked: true, onChange: (v) => _firePP({ bloom: { enabled: v } }) });
  const bloomThreshSlider = slider({ value: 0.85, min: 0, max: 2, step: 0.01,
    onChange: (v) => _firePP({ bloom: { threshold: v } }) });
  const bloomStrengthSlider = slider({ value: 0.8, min: 0, max: 3, step: 0.05,
    onChange: (v) => _firePP({ bloom: { strength: v } }) });
  const bloomRadiusSlider = slider({ value: 0.4, min: 0, max: 1, step: 0.01,
    onChange: (v) => _firePP({ bloom: { radius: v } }) });
  body.appendChild(row('Bloom Enable',    bloomEnabledCb));
  body.appendChild(row('Threshold',       bloomThreshSlider.el));
  body.appendChild(row('Intensity',       bloomStrengthSlider.el));
  body.appendChild(row('Radius',          bloomRadiusSlider.el));

  // ── God Rays (mirrored from God Rays section for convenience) ───────────────
  // (Keep the dedicated God Rays section under Sky; this is just Intensity+Samples)

  // ── Chromatic Aberration ────────────────────────────────────────────────────
  const chromaHeader = _subSectionHeader('Chromatic Aberration');
  body.appendChild(chromaHeader);
  const chromaEnabledCb = checkbox({ checked: false, onChange: (v) => _firePP({ chroma: { enabled: v } }) });
  const chromaStrengthSlider = slider({ value: 0.002, min: 0, max: 0.02, step: 0.0005,
    onChange: (v) => _firePP({ chroma: { strength: v } }) });
  body.appendChild(row('Chroma Enable',   chromaEnabledCb));
  body.appendChild(row('Strength',        chromaStrengthSlider.el));

  // ── Vignette ──────────────────────────────────────────────────────────────
  const vigHeader = _subSectionHeader('Vignette');
  body.appendChild(vigHeader);
  const vigEnabledCb = checkbox({ checked: false, onChange: (v) => _firePP({ vignette: { enabled: v } }) });
  const vigOffsetSlider  = slider({ value: 1.0, min: 0, max: 2, step: 0.05,
    onChange: (v) => _firePP({ vignette: { offset: v } }) });
  const vigDarkSlider = slider({ value: 1.0, min: 0, max: 3, step: 0.05,
    onChange: (v) => _firePP({ vignette: { darkness: v } }) });
  body.appendChild(row('Vignette Enable', vigEnabledCb));
  body.appendChild(row('Offset',          vigOffsetSlider.el));
  body.appendChild(row('Darkness',        vigDarkSlider.el));

  // ── Film Grain ─────────────────────────────────────────────────────────────
  const grainHeader = _subSectionHeader('Film Grain');
  body.appendChild(grainHeader);
  const grainEnabledCb = checkbox({ checked: false, onChange: (v) => _firePP({ grain: { enabled: v } }) });
  const grainIntensitySlider = slider({ value: 0.08, min: 0, max: 0.5, step: 0.005,
    onChange: (v) => _firePP({ grain: { intensity: v } }) });
  body.appendChild(row('Grain Enable',    grainEnabledCb));
  body.appendChild(row('Intensity',       grainIntensitySlider.el));

  // ── Tone Mapping ───────────────────────────────────────────────────────────
  const tmHeader = _subSectionHeader('Tone Mapping');
  body.appendChild(tmHeader);
  const tmSelect = select({
    options: [
      ['aces',     'ACES Filmic (default)'],
      ['agx',      'AgX (r152+)'],
      ['reinhard', 'Reinhard'],
      ['cineon',   'Cineon'],
      ['linear',   'Linear'],
      ['none',     'None (raw)'],
    ],
    value: 'aces',
    onChange: (v) => _firePP({ toneMapping: v }),
  });
  body.appendChild(row('Tone Mapping', tmSelect));

  // ── LUT ─────────────────────────────────────────────────────────────────────
  const lutHeader = _subSectionHeader('LUT Color Grading');
  body.appendChild(lutHeader);
  const lutEnabledCb = checkbox({ checked: false, onChange: (v) => _firePP({ lut: { enabled: v } }) });
  const lutIntensitySlider = slider({ value: 1.0, min: 0, max: 1, step: 0.01,
    onChange: (v) => _firePP({ lut: { intensity: v } }) });
  const lutLoadBtn = document.createElement('button');
  lutLoadBtn.textContent = 'Load LUT file...';
  lutLoadBtn.className   = 'cyco-btn cyco-btn--sm';
  lutLoadBtn.onclick     = () => {
    const inp = document.createElement('input');
    inp.type   = 'file';
    inp.accept = '.cube,.png,.jpg';
    inp.onchange = (e) => {
      const file = e.target.files[0];
      if (file) _firePP({ lut: { file } });
    };
    inp.click();
  };
  body.appendChild(row('LUT Enable',   lutEnabledCb));
  body.appendChild(row('LUT Intensity', lutIntensitySlider.el));
  body.appendChild(row('LUT File',      lutLoadBtn));
}
```

---

## P6.6 - Wire `cyco-postfx-change` in `ViewportEngine.js`

```js
// Constructor:
this._onPostFxChange = this._onPostFxChange.bind(this);
window.addEventListener('cyco-postfx-change', this._onPostFxChange);

// Handler:
_onPostFxChange({ detail } = {}) {
  const pp = window.__cyco?.postPipeline;
  if (!pp || !detail) return;

  if (detail.bloom) {
    if (detail.bloom.enabled  !== undefined) pp.bloomPass.enabled       = detail.bloom.enabled;
    if (detail.bloom.strength !== undefined) pp.bloomPass.strength      = detail.bloom.strength;
    if (detail.bloom.radius   !== undefined) pp.bloomPass.radius        = detail.bloom.radius;
    if (detail.bloom.threshold !== undefined) pp.bloomPass.threshold   = detail.bloom.threshold;
  }
  if (detail.chroma) {
    if (detail.chroma.enabled  !== undefined) pp.chromaPass.uniforms['enabled'].value  = detail.chroma.enabled  ? 1.0 : 0.0;
    if (detail.chroma.strength !== undefined) pp.chromaPass.uniforms['strength'].value = detail.chroma.strength;
  }
  if (detail.vignette) {
    if (detail.vignette.enabled  !== undefined) pp.vignettePass.uniforms['enabled'].value  = detail.vignette.enabled ? 1.0 : 0.0;
    if (detail.vignette.offset   !== undefined) pp.vignettePass.uniforms['offset'].value   = detail.vignette.offset;
    if (detail.vignette.darkness !== undefined) pp.vignettePass.uniforms['darkness'].value = detail.vignette.darkness;
  }
  if (detail.grain) {
    if (detail.grain.enabled   !== undefined) pp.filmGrainPass.uniforms['enabled'].value   = detail.grain.enabled ? 1.0 : 0.0;
    if (detail.grain.intensity !== undefined) pp.filmGrainPass.uniforms['intensity'].value = detail.grain.intensity;
  }
  if (detail.toneMapping) {
    pp.setToneMapping(detail.toneMapping);
  }
  if (detail.lut) {
    if (detail.lut.enabled   !== undefined) { pp.lutPass.enabled   = detail.lut.enabled; }
    if (detail.lut.intensity !== undefined) { pp.lutPass.intensity = detail.lut.intensity; }
    if (detail.lut.file) {
      // Load .cube file using LUTCubeLoader or .png using LUTImageLoader
      // See three/addons/loaders/LUTCubeLoader.js
      import('three/addons/loaders/LUTCubeLoader.js').then(({ LUTCubeLoader }) => {
        const url = URL.createObjectURL(detail.lut.file);
        new LUTCubeLoader().load(url, (lut) => {
          pp.lutPass.lut = lut.texture3D ?? lut.texture;
          URL.revokeObjectURL(url);
        });
      }).catch(() => {
        console.warn('[CycoEngine] LUT file loading failed — ensure .cube format');
      });
    }
  }
}
```

---

# FILES CHANGED SUMMARY

## New Files

| File | Purpose | Phase |
|---|---|---|
| `editor/src/viewport/GodRays.js` | Screen-space radial blur god rays | Phase 1 |
| `editor/src/viewport/PhysicalSky.js` | THREE.Sky Hosek-Wilkie atmosphere | Phase 2 |

## Modified Files

| File | What Changes | Phase |
|---|---|---|
| `editor/src/viewport/GradientSky.js` | Add `_createOccluderMaterial()`, `_occluderMat`, `onBeforeRender` swap logic | 1 |
| `editor/src/viewport/PostProcessingPipeline.js` | Add `GodRays` field, build/update/resize/dispose calls, `setGodRaysEnabled()`, `updateGodRaysParams()`. WebGPU GodraysNode. Add `ChromaticAberrationShader`, `VignetteShader`, `FilmGrainShader` passes, `setToneMapping()`. | 1, 4, 6 |
| `editor/src/viewport/ViewportEngine.js` | Add `physicalSky`, `_activeSkyType`, route `skyType` in `_onSkyChange()`, add `_onGodRaysChange()`, `_onPostFxChange()`, improve fog handler, HDRI properties | 1, 2, 3, 4, 6 |
| `editor/src/properties/EnvironmentProperties.js` | Add `_buildGodRaysSection()`, `_buildPostProcessingSection()`, Sky Type dropdown + Atmosphere sub-section, revamp Lens Flare sub-section (granular params), revamp fog section, HDRI controls | 1, 2, 3, 5, 6 |

---

# IMPLEMENTATION ORDER

```
Phase 1 (God Rays):
  1. Create GodRays.js
  2. GradientSky.js - add occluder material + onBeforeRender swap
  3. PostProcessingPipeline.js - wire GodRays (build, update frame, resize, dispose, API)
  4. ViewportEngine.js - add _onGodRaysChange listener + handler
  5. EnvironmentProperties.js - add God Rays section
  TEST Phase 1

Phase 2 (Physical Sky):
  6. Create PhysicalSky.js
  7. EnvironmentProperties.js - Sky Type dropdown + Atmosphere sub-section
  8. ViewportEngine.js - add physicalSky, route skyType, _activeSkyType
  TEST Phase 2

Phase 3 (Fog):
  9.  EnvironmentProperties.js - revamp fog section (type selector, auto-color)
  10. ViewportEngine.js - improve _onFogChange (auto-color from gradient)
  TEST Phase 3

Phase 4 (Polish):
  11. ViewportEngine.js - renderer switch fallback for physical sky
  12. PostProcessingPipeline.js - WebGPU GodraysNode attempt
  13. HDRI mode cleanup (rotation, blur, intensity decoupling)
  14. (Stretch) TSL Hosek-Wilkie port for WebGPU physical sky
  TEST Phase 4

Phase 5 (Lens Flare Revamp):
  15. GradientSky.js - add _makeGlareTex, _makeHaloTex, _makeGhostTex, _makeStreakTex, _makeStarBurstTex helpers
  16. GradientSky.js - rewrite _createWebGLFlares() to use new granular _p params
  17. GradientSky._p - replace style-based params with granular params
  18. EnvironmentProperties.js - rewrite Lens Flare sub-section in _buildSkySection()
  19. EnvironmentProperties.js - update _fireSkyChange() to emit new lens flare fields
  TEST Phase 5

Phase 6 (Post Processing Controls Panel):
  20. PostProcessingPipeline.js - add ChromaticAberrationShader + chromaPass
  21. PostProcessingPipeline.js - add VignetteShader + vignettePass
  22. PostProcessingPipeline.js - add FilmGrainShader + filmGrainPass (animate time in render loop)
  23. PostProcessingPipeline.js - add setToneMapping() method
  24. ViewportEngine.js - add _onPostFxChange() handler
  25. EnvironmentProperties.js - add _buildPostProcessingSection() and call from _build()
  TEST Phase 6
```

---

*References: GPU Gems 3 Ch.13, THREE.Sky addon, UE5 Sky Atmosphere docs, Cyco Engine codebase*
