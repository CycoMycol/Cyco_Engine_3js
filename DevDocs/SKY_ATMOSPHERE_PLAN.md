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
| `editor/src/viewport/PostProcessingPipeline.js` | Add `GodRays` field, build/update/resize/dispose calls, `setGodRaysEnabled()`, `updateGodRaysParams()`. WebGPU GodraysNode. | 1, 4 |
| `editor/src/viewport/ViewportEngine.js` | Add `physicalSky`, `_activeSkyType`, route `skyType` in `_onSkyChange()`, add `_onGodRaysChange()`, improve fog handler, HDRI properties | 1, 2, 3, 4 |
| `editor/src/properties/EnvironmentProperties.js` | Add `_buildGodRaysSection()`, Sky Type dropdown + Atmosphere sub-section, revamp fog section, HDRI controls | 1, 2, 3, 4 |

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
```

---

*References: GPU Gems 3 Ch.13, THREE.Sky addon, UE5 Sky Atmosphere docs, Cyco Engine codebase*
