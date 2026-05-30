/**
 * GradientSky.js — Gradient-based sky with sun disc, moon disc, lens flare and sun lighting.
 *
 * Replaces THREE.Sky.  Renders a large BackSide sphere that always follows the
 * camera.  The sky colour is sampled from a 256-sample gradient texture built
 * from user-defined colour stops.  The sun disc is SDR (no bloom contamination);
 * a Three.js Lensflare provides the sun glow/flare effect.  A single
 * DirectionalLight tracks the sun.
 *
 * Public API:
 *   setEnabled(bool)
 *   setParams(opts)   — elevation, azimuth, colorStops, opacityStops,
 *                       showSun, sunColor, sunGlowStrength,
 *                       showMoon, moonColor, moonGlowStrength, exposure,
 *                       lensflareEnabled, lensflareSize, lensflareOpacity
 *   getGradient()     — { colorStops, opacityStops }
 *   update()          — call every frame
 *   dispose()
 */

import * as THREE from 'three';
import { Lensflare, LensflareElement } from 'three/addons/objects/Lensflare.js';

// ── GLSL ──────────────────────────────────────────────────────────────────────

const SKY_VERT = /* glsl */`
varying vec3 vLocalPos;

void main() {
  vLocalPos = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  // Push to the far plane so the sky never z-clips.
  gl_Position.z = gl_Position.w;
}
`;

const SKY_FRAG = /* glsl */`
precision highp float;

uniform sampler2D uGradientTex;
uniform float     uSkyBrightness;
uniform float     uExposure;
uniform float     uSaturation;  // 0=greyscale, 1=unchanged, >1=vivid
uniform float     uContrast;    // 1=unchanged, >1=more contrast

// Sun — all SDR (max 1.0); lens flare handled separately in JS
uniform vec3  uSunDir;
uniform float uSunInner;    // cos(inner radius)
uniform float uSunOuter;    // cos(outer fade radius)
uniform vec3  uSunColor;    // SDR 0-1
uniform float uSunVisible;
uniform float uSunGlowStrength;

// Moon
uniform vec3  uMoonDir;
uniform float uMoonInner;
uniform float uMoonOuter;
uniform vec3  uMoonColor;
uniform float uMoonVisible;
uniform float uMoonGlowStrength;

varying vec3 vLocalPos;

void main() {
  vec3 dir = normalize(vLocalPos);

  // Sample gradient: y goes -1 (nadir) → +1 (zenith); map to 0→1
  float skyT = clamp(dir.y * 0.5 + 0.5, 0.001, 0.999);
  vec3 skyColor = texture2D(uGradientTex, vec2(skyT, 0.5)).rgb * uSkyBrightness;

  // ── Sun (SDR — no bloom contamination; lens flare object provides glow) ─
  if (uSunVisible > 0.0) {
    float sunDot   = dot(dir, normalize(uSunDir));
    float sunAngle = acos(clamp(sunDot, -1.0, 1.0));

    // Atmospheric glow band around sun (SDR)
    float glow = exp(-sunAngle * 5.0) * uSunGlowStrength * uSunVisible;
    skyColor += uSunColor * glow * 0.5;

    // Hard disc — clamped to SDR so it never triggers bloom
    float disc = smoothstep(uSunOuter, uSunInner, sunDot);
    vec3 discColor = min(uSunColor, vec3(1.0));
    skyColor = mix(skyColor, discColor, disc * uSunVisible);
  }

  // ── Moon ────────────────────────────────────────────────────────────
  if (uMoonVisible > 0.0) {
    float moonDot   = dot(dir, normalize(uMoonDir));
    float moonAngle = acos(clamp(moonDot, -1.0, 1.0));

    float glow = exp(-moonAngle * 8.0) * uMoonGlowStrength * uMoonVisible;
    skyColor += uMoonColor * glow;

    float disc = smoothstep(uMoonOuter, uMoonInner, moonDot);
    skyColor = mix(skyColor, uMoonColor, disc * uMoonVisible);
  }

  // ── Contrast (pivot at 0.5) ──────────────────────────────────────────
  skyColor = clamp((skyColor - 0.5) * uContrast + 0.5, 0.0, 2.0);

  // ── Saturation ───────────────────────────────────────────────────────
  float lum = dot(skyColor, vec3(0.299, 0.587, 0.114));
  skyColor = max(mix(vec3(lum), skyColor, uSaturation), vec3(0.0));

  gl_FragColor = vec4(skyColor * uExposure, 1.0);
}
`;

// ── Gradient texture builder ──────────────────────────────────────────────────

const SAMPLES = 256;

function buildGradientTex(colorStops, existing) {
  const sorted = [...colorStops].sort((a, b) => a.pos - b.pos);
  const data   = new Uint8Array(SAMPLES * 4); // RGBA

  const parse = (hex) => {
    const n = parseInt(hex.replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };

  // Linear pass
  const linear = new Float32Array(SAMPLES * 3);
  for (let i = 0; i < SAMPLES; i++) {
    const t = i / (SAMPLES - 1);
    let r, g, b;

    if (!sorted.length) {
      r = g = b = 128;
    } else if (t <= sorted[0].pos) {
      [r, g, b] = parse(sorted[0].color);
    } else if (t >= sorted[sorted.length - 1].pos) {
      [r, g, b] = parse(sorted[sorted.length - 1].color);
    } else {
      let s0 = sorted[0], s1 = sorted[sorted.length - 1];
      for (let j = 0; j < sorted.length - 1; j++) {
        if (t >= sorted[j].pos && t <= sorted[j + 1].pos) {
          s0 = sorted[j]; s1 = sorted[j + 1]; break;
        }
      }
      const rawT = (t - s0.pos) / (s1.pos - s0.pos + 1e-9);
      const [r0, g0, b0] = parse(s0.color);
      const [r1, g1, b1] = parse(s1.color);
      r = r0 + (r1 - r0) * rawT;
      g = g0 + (g1 - g0) * rawT;
      b = b0 + (b1 - b0) * rawT;
    }
    linear[i * 3] = r; linear[i * 3 + 1] = g; linear[i * 3 + 2] = b;
  }

  // Per-segment Gaussian blur for softer transitions
  const output = linear.slice();
  for (let si = 0; si < sorted.length - 1; si++) {
    const s0 = sorted[si], s1 = sorted[si + 1];
    const bAmt = Math.max(s0.blend ?? 0, s1.blend ?? 0);
    if (bAmt < 0.001) continue;
    const x0 = Math.round(s0.pos * (SAMPLES - 1));
    const x1 = Math.round(s1.pos * (SAMPLES - 1));
    const span = Math.max(x1 - x0, 1);
    const radius = Math.ceil(bAmt * span * 8.0);
    const sigma  = radius / 2.5 + 1;
    const bx0 = Math.max(0, x0 - radius);
    const bx1 = Math.min(SAMPLES - 1, x1 + radius);
    for (let x = bx0; x <= bx1; x++) {
      let sr = 0, sg = 0, sb = 0, sw = 0;
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = Math.max(0, Math.min(SAMPLES - 1, x + dx));
        const wk = Math.exp(-0.5 * (dx / sigma) ** 2);
        sr += wk * linear[nx * 3]; sg += wk * linear[nx * 3 + 1]; sb += wk * linear[nx * 3 + 2];
        sw += wk;
      }
      if (sw > 0) { output[x * 3] = sr / sw; output[x * 3 + 1] = sg / sw; output[x * 3 + 2] = sb / sw; }
    }
  }

  for (let i = 0; i < SAMPLES; i++) {
    data[i * 4]     = Math.round(output[i * 3]);
    data[i * 4 + 1] = Math.round(output[i * 3 + 1]);
    data[i * 4 + 2] = Math.round(output[i * 3 + 2]);
    data[i * 4 + 3] = 255;
  }

  if (existing) {
    existing.image.data.set(data);
    existing.needsUpdate = true;
    return existing;
  }
  const tex = new THREE.DataTexture(data, SAMPLES, 1, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

// ── Angle constants ───────────────────────────────────────────────────────────

// Sun: inner = 1.5°, outer = 2.5° (soft edge between them)
const SUN_INNER = Math.cos(THREE.MathUtils.degToRad(1.5));
const SUN_OUTER = Math.cos(THREE.MathUtils.degToRad(2.5));

// Moon: slightly smaller than sun
const MOON_INNER = Math.cos(THREE.MathUtils.degToRad(1.2));
const MOON_OUTER = Math.cos(THREE.MathUtils.degToRad(2.0));

// Reusable Vector3 scratch objects — avoids per-frame heap allocation in update()
const _tmpV3a = new THREE.Vector3();
const _tmpV3b = new THREE.Vector3();
const _tmpV3c = new THREE.Vector3();

// ── GradientSky class ─────────────────────────────────────────────────────────

export class GradientSky {
  constructor(viewportEngine) {
    this._vpe             = viewportEngine;
    this._mesh            = null;
    this._gradientTex     = null;
    this._tslUniforms     = null;
    this._isWebGPU        = false;
    this._sunLight        = null;
    this._lensflare       = null;   // Three.js Lensflare (WebGL only)
    this._lensflareSprites = null;  // Sprite array for WebGPU lensflare
    this._enabled         = false;

    this._p = {
      elevation:          30,
      azimuth:            180,
      colorStops: [
        { pos: 0.0,  color: '#0a0814' },
        { pos: 0.45, color: '#d4732a' },
        { pos: 0.52, color: '#87CEEB' },
        { pos: 1.0,  color: '#1565C0' },
      ],
      opacityStops: [
        { pos: 0.0, opacity: 1.0 },
        { pos: 1.0, opacity: 1.0 },
      ],
      showSun:            true,
      sunColor:           new THREE.Color(1.0, 0.95, 0.80),  // SDR — no bloom
      sunGlowStrength:    0.5,
      showMoon:           true,
      moonColor:          new THREE.Color(0.75, 0.80, 0.92),
      moonGlowStrength:   0.3,
      exposure:           1.0,
      saturation:         1.0,
      contrast:           1.0,
      lensflareEnabled:   true,
      lensflareSize:      300,
      lensflareOpacity:   0.7,
      sunDir:             new THREE.Vector3(),
      moonDir:            new THREE.Vector3(),
    };

    this._updateDirs();
    this._initSunLight();
  }

  get enabled() { return this._enabled; }

  /** Return current gradient data (for panel re-init). */
  getGradient() {
    return {
      colorStops:   this._p.colorStops.map(s => ({ ...s })),
      opacityStops: this._p.opacityStops.map(s => ({ ...s })),
    };
  }

  /** The Three.js DirectionalLight that represents the sun (may be null if sky disabled). */
  get sunLight() { return this._sunLight; }

  setEnabled(v) {
    this._enabled = !!v;
    if (v && !this._mesh) this._createMesh();
    else if (!v)          this._destroyMesh();
  }

  /** Dispatch to WebGL or WebGPU mesh creation based on the active renderer. */
  _createMesh() {
    const renderer = this._vpe?.rendererManager?.renderer;
    if (renderer?.isWebGPURenderer) {
      this._createMeshWebGPU().catch(err => {
        console.error('[GradientSky] WebGPU sky failed, trying node-compatible fallback:', err);
        this._createMeshWebGPUFallback();
      });
    } else {
      this._createMeshWebGL();
    }
  }

  /**
   * @param {object} opts
   * @param {number}  [opts.elevation]
   * @param {number}  [opts.azimuth]
   * @param {Array}   [opts.colorStops]
   * @param {Array}   [opts.opacityStops]
   * @param {boolean} [opts.showSun]
   * @param {string}  [opts.sunColor]
   * @param {number}  [opts.sunGlowStrength]
   * @param {boolean} [opts.showMoon]
   * @param {string}  [opts.moonColor]
   * @param {number}  [opts.moonGlowStrength]
   * @param {number}  [opts.exposure]         sky-level exposure multiplier
   * @param {boolean} [opts.lensflareEnabled]
   * @param {number}  [opts.lensflareSize]
   * @param {number}  [opts.lensflareOpacity]
   */
  setParams(opts = {}) {
    const p = this._p;
    if (opts.elevation          !== undefined) p.elevation          = opts.elevation;
    if (opts.azimuth            !== undefined) p.azimuth            = opts.azimuth;
    if (opts.showSun            !== undefined) p.showSun            = opts.showSun;
    if (opts.sunGlowStrength    !== undefined) p.sunGlowStrength    = opts.sunGlowStrength;
    if (opts.showMoon           !== undefined) p.showMoon           = opts.showMoon;
    if (opts.moonGlowStrength   !== undefined) p.moonGlowStrength   = opts.moonGlowStrength;
    if (opts.exposure           !== undefined) p.exposure           = opts.exposure;
    if (opts.saturation         !== undefined) p.saturation         = opts.saturation;
    if (opts.contrast           !== undefined) p.contrast           = opts.contrast;
    if (opts.lensflareEnabled   !== undefined) p.lensflareEnabled   = opts.lensflareEnabled;
    if (opts.lensflareSize      !== undefined) p.lensflareSize      = opts.lensflareSize;
    if (opts.lensflareOpacity   !== undefined) p.lensflareOpacity   = opts.lensflareOpacity;
    if (opts.sunColor)  p.sunColor.set(opts.sunColor);
    if (opts.moonColor) p.moonColor.set(opts.moonColor);

    if (opts.colorStops) {
      p.colorStops = opts.colorStops;
      this._rebuildGradientTex();
    }
    if (opts.opacityStops) {
      p.opacityStops = opts.opacityStops;
    }

    this._updateDirs();
    this._pushUniforms();
    this._updateSunLight();
    this._updateLensflare();
  }

  /** Call once per frame from ViewportEngine._tick(). */
  update() {
    if (!this._mesh) return;
    const cam = this._vpe?.camera;
    if (cam) this._mesh.position.copy(cam.position);
    // Drive WebGPU sprite lensflare positions — must happen every frame
    if (this._isWebGPU && cam) this._updateLensflareWebGPU(cam);
  }

  dispose() {
    const scene = this._vpe?.scene;
    if (this._sunLight) {
      scene?.remove(this._sunLight);
      scene?.remove(this._sunLight.target);
      this._sunLight = null;
    }
    this._destroyMesh();
  }

  // ── Private ──────────────────────────────────────────────────────────────

  _initSunLight() {
    const scene = this._vpe?.scene;
    if (!scene || this._sunLight) return;

    this._sunLight = new THREE.DirectionalLight(0xfff8e7, 2.0);
    this._sunLight.userData._isHelper = true;
    this._sunLight.name = '__cyco_sun_light';

    this._sunLight.castShadow = true;
    this._sunLight.shadow.mapSize.width  = 2048;
    this._sunLight.shadow.mapSize.height = 2048;
    this._sunLight.shadow.mapSize.width  = 2048;
    this._sunLight.shadow.mapSize.height = 2048;
    this._sunLight.shadow.camera.near   = 0.5;
    this._sunLight.shadow.camera.far    = 1000;
    this._sunLight.shadow.camera.left   = -50;
    this._sunLight.shadow.camera.right  =  50;
    this._sunLight.shadow.camera.top    =  50;
    this._sunLight.shadow.camera.bottom = -50;
    this._sunLight.shadow.radius        = 1;
    this._sunLight.shadow.blurSamples   = 8;
    this._sunLight.shadow.bias          = -0.001;

    this._sunLight.target.position.set(0, 0, 0);
    this._sunLight.target.name = '__cyco_sun_target';

    this._updateSunLight();
    scene.add(this._sunLight, this._sunLight.target);
  }

  _updateDirs() {
    const { elevation, azimuth } = this._p;
    const phi   = THREE.MathUtils.degToRad(90 - elevation);
    const theta = THREE.MathUtils.degToRad(azimuth);
    this._p.sunDir.setFromSphericalCoords(1, phi, theta);

    // Moon rises opposite the sun
    const mPhi   = THREE.MathUtils.degToRad(90 + elevation);
    const mTheta = THREE.MathUtils.degToRad((azimuth + 180) % 360);
    this._p.moonDir.setFromSphericalCoords(1, mPhi, mTheta);

    // Keep derived scalar values current so reference() nodes pick them up next frame.
    this._p._skyBrightness = this._skyBrightness();
    this._p._sunVisible    = this._sunVisible();
    this._p._moonVisible   = this._moonVisible();
  }

  _skyBrightness() {
    const elev = this._p.elevation;
    // Smooth ramp: dark below -5°, full brightness above 15°
    const t = Math.max(0, Math.min(1, (elev + 5) / 20));
    return 0.04 + 0.96 * t * t * (3 - 2 * t);
  }

  _sunVisible() {
    const elev = this._p.elevation;
    return this._p.showSun ? Math.max(0, Math.min(1, (elev + 5) / 5)) : 0;
  }

  _moonVisible() {
    const elev = this._p.elevation;
    return this._p.showMoon ? Math.max(0, Math.min(1, (5 - elev) / 10)) : 0;
  }

  _rebuildGradientTex() {
    // Update in-place when texture already exists — the TSL TextureNode keeps the same
    // DataTexture reference, so GPU data is refreshed automatically via needsUpdate.
    this._gradientTex = buildGradientTex(this._p.colorStops, this._gradientTex ?? undefined);
    // Sync WebGL ShaderMaterial uniform (no-op for WebGPU path)
    const u = this._mesh?.material?.uniforms;
    if (u?.uGradientTex) u.uGradientTex.value = this._gradientTex;
  }

  _pushUniforms() {
    // WebGPU path: reference() nodes read directly from this._p each render frame —
    // no manual uniform push needed. _updateDirs() keeps derived values current.
    if (this._isWebGPU) return;

    // WebGL path: update ShaderMaterial uniforms
    const u = this._mesh?.material?.uniforms;
    if (!u) return;

    u.uSkyBrightness.value    = this._skyBrightness();
    u.uExposure.value         = this._p.exposure;
    u.uSaturation.value       = this._p.saturation;
    u.uContrast.value         = this._p.contrast;
    u.uSunDir.value.copy(this._p.sunDir);
    u.uSunColor.value.copy(this._p.sunColor);
    u.uSunVisible.value       = this._sunVisible();
    u.uSunGlowStrength.value  = this._p.sunGlowStrength;
    u.uMoonDir.value.copy(this._p.moonDir);
    u.uMoonColor.value.copy(this._p.moonColor);
    u.uMoonVisible.value      = this._moonVisible();
    u.uMoonGlowStrength.value = this._p.moonGlowStrength;
  }

  _updateSunLight() {
    if (!this._sunLight) return;
    const elev   = this._p.elevation;
    this._sunLight.position.copy(this._p.sunDir).multiplyScalar(200);
    // Intensity: 0 at night, 2 at full day
    const t = Math.max(0, Math.min(1, (elev + 5) / 20));
    this._sunLight.intensity = 2.0 * t * t * (3 - 2 * t);
    this._sunLight.color.set('#fff8e7');
  }

  /**
   * Last-resort WebGPU fallback: MeshBasicNodeMaterial with a simple gradient texture lookup.
   * Called only if the full TSL sky node fails to build.
   */
  async _createMeshWebGPUFallback() {
    const scene = this._vpe?.scene;
    if (!scene) return;
    this._destroyMesh();
    this._isWebGPU = true;

    try {
      const webgpuMod = await import('three/webgpu');
      const { MeshBasicNodeMaterial } = webgpuMod;
      const { Fn, vec2, vec4, float, positionLocal, texture, uniform, cameraFar } = webgpuMod.TSL;

      if (!this._gradientTex) this._rebuildGradientTex();
      const gradTex = this._gradientTex;
      const uExposure = uniform(this._p.exposure);
      this._tslUniforms = { uExposure, uSkyBrightness: { value: this._skyBrightness() }, uSaturation: { value: 1 }, uContrast: { value: 1 }, uSunDir: { value: this._p.sunDir.clone() }, uSunColor: { value: this._p.sunColor.clone() }, uSunVisible: { value: 0 }, uSunGlowStrength: { value: 0 }, uMoonDir: { value: this._p.moonDir.clone() }, uMoonColor: { value: this._p.moonColor.clone() }, uMoonVisible: { value: 0 }, uMoonGlowStrength: { value: 0 } };

      const colorNode = Fn(() => {
        const dir  = positionLocal.normalize();
        const skyT = dir.y.mul(0.5).add(0.5).clamp(0.001, 0.999);
        const col  = texture(gradTex, vec2(skyT, float(0.5))).rgb;
        return vec4(col.mul(uExposure), 1.0);
      })();

      const mat = new MeshBasicNodeMaterial({ side: THREE.BackSide, depthTest: false, depthWrite: false });
      mat.positionNode = positionLocal.normalize().mul(cameraFar.mul(0.99));
      mat.colorNode = colorNode;

      this._mesh = new THREE.Mesh(new THREE.SphereGeometry(450000, 32, 16), mat);
      this._mesh.name = '__cyco_gradient_sky';
      this._mesh.renderOrder = -1;
      this._mesh.raycast = () => {};
      this._mesh.userData._isHelper = true;

      const cam = this._vpe?.camera;
      if (cam) this._mesh.position.copy(cam.position);

      // Lensflare is WebGL-only — skip under WebGPU.
      scene.add(this._mesh);
      console.log('[GradientSky] WebGPU fallback sky created (gradient only).');
    } catch (err2) {
      console.error('[GradientSky] WebGPU fallback also failed:', err2);
    }
  }

  _createMeshWebGL() {
    const scene = this._vpe?.scene;
    if (!scene) return;
    this._destroyMesh();

    this._rebuildGradientTex();

    const mat = new THREE.ShaderMaterial({
      vertexShader:   SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: {
        uGradientTex:       { value: this._gradientTex },
        uSkyBrightness:     { value: this._skyBrightness() },
        uExposure:          { value: this._p.exposure },
        uSaturation:        { value: this._p.saturation },
        uContrast:          { value: this._p.contrast },
        uSunDir:            { value: this._p.sunDir.clone() },
        uSunInner:          { value: SUN_INNER },
        uSunOuter:          { value: SUN_OUTER },
        uSunColor:          { value: this._p.sunColor.clone() },
        uSunVisible:        { value: this._sunVisible() },
        uSunGlowStrength:   { value: this._p.sunGlowStrength },
        uMoonDir:           { value: this._p.moonDir.clone() },
        uMoonInner:         { value: MOON_INNER },
        uMoonOuter:         { value: MOON_OUTER },
        uMoonColor:         { value: this._p.moonColor.clone() },
        uMoonVisible:       { value: this._moonVisible() },
        uMoonGlowStrength:  { value: this._p.moonGlowStrength },
      },
      side:       THREE.BackSide,
      depthTest:  false,
      depthWrite: false,
    });

    this._mesh = new THREE.Mesh(
      new THREE.SphereGeometry(450000, 32, 16),
      mat
    );
    this._mesh.name = '__cyco_gradient_sky';
    this._mesh.renderOrder = -1; // must render before grid/scene objects
    this._mesh.raycast = () => {};
    this._mesh.userData._isHelper = true;

    const cam = this._vpe?.camera;
    if (cam) this._mesh.position.copy(cam.position);

    // Lens flare
    this._createLensflare();
    this._updateLensflare();

    scene.add(this._mesh);
    if (this._lensflare) scene.add(this._lensflare);
  }

  /** Create the sky mesh using TSL NodeMaterial for WebGPU renderers. */
  async _createMeshWebGPU() {
    const scene = this._vpe?.scene;
    if (!scene) return;
    this._destroyMesh();
    this._isWebGPU = true;

    const webgpuMod = await import('three/webgpu');
    const { MeshBasicNodeMaterial } = webgpuMod;
    const {
      Fn, vec2, vec3, vec4, float, mix, smoothstep, acos,
      positionLocal, positionGeometry, texture, uniform, reference, cameraFar,
    } = webgpuMod.TSL;

    if (!this._gradientTex) this._rebuildGradientTex();

    // ── TSL reference nodes (auto-read from this._p on every render frame) ───
    // Using reference() instead of uniform() means parameter changes in this._p
    // are automatically picked up without any manual dirty-flag management.
    const rSkyBrightness    = reference('_skyBrightness',  'float', this._p);
    const rExposure         = reference('exposure',        'float', this._p);
    const rSaturation       = reference('saturation',      'float', this._p);
    const rContrast         = reference('contrast',        'float', this._p);
    const rSunDir           = reference('sunDir',          'vec3',  this._p);
    const rSunColor         = reference('sunColor',        'color', this._p);
    const rSunVisible       = reference('_sunVisible',     'float', this._p);
    const rSunGlowStrength  = reference('sunGlowStrength', 'float', this._p);
    const rMoonDir          = reference('moonDir',         'vec3',  this._p);
    const rMoonColor        = reference('moonColor',       'color', this._p);
    const rMoonVisible      = reference('_moonVisible',    'float', this._p);
    const rMoonGlowStrength = reference('moonGlowStrength','float', this._p);

    // ── Static uniform nodes (angle constants — never change) ─────────────
    const uSunInner  = uniform(SUN_INNER);
    const uSunOuter  = uniform(SUN_OUTER);
    const uMoonInner = uniform(MOON_INNER);
    const uMoonOuter = uniform(MOON_OUTER);

    // Capture gradient texture by reference — in-place updates via needsUpdate
    // are automatically picked up by the TextureNode on the next render frame.
    const gradTex = this._gradientTex;

    const skyColorNode = Fn(() => {
      // Use positionGeometry (raw vertex attribute) for direction — this is
      // unaffected by positionNode so we get correct spherical interpolation,
      // matching the original WebGL shader behaviour near the horizon.
      const dir    = positionGeometry.normalize();
      // Map y [-1,+1] → UV [0,1]; clamp away from border pixels
      const skyT   = dir.y.mul(0.5).add(0.5).clamp(0.001, 0.999);
      const skyCol = texture(gradTex, vec2(skyT, float(0.5))).rgb.mul(rSkyBrightness).toVar();

      // ── Sun (contributions scale to zero when rSunVisible = 0) ──────────
      const sunDot  = dir.dot(rSunDir.normalize());
      const sunAng  = acos(sunDot.clamp(-1.0, 1.0));
      const sunGlow = sunAng.negate().mul(5.0).exp().mul(rSunGlowStrength).mul(rSunVisible);
      skyCol.addAssign(rSunColor.mul(sunGlow).mul(0.5));
      const sunDisc = smoothstep(uSunOuter, uSunInner, sunDot);
      skyCol.assign(mix(skyCol, rSunColor.min(vec3(1.0)), sunDisc.mul(rSunVisible)));

      // ── Moon ─────────────────────────────────────────────────────────────
      const moonDot  = dir.dot(rMoonDir.normalize());
      const moonAng  = acos(moonDot.clamp(-1.0, 1.0));
      const moonGlow = moonAng.negate().mul(8.0).exp().mul(rMoonGlowStrength).mul(rMoonVisible);
      skyCol.addAssign(rMoonColor.mul(moonGlow));
      const moonDisc = smoothstep(uMoonOuter, uMoonInner, moonDot);
      skyCol.assign(mix(skyCol, rMoonColor, moonDisc.mul(rMoonVisible)));

      // ── Contrast (pivot at 0.5) ───────────────────────────────────────────
      skyCol.assign(skyCol.sub(0.5).mul(rContrast).add(0.5).clamp(0.0, 2.0));

      // ── Saturation ────────────────────────────────────────────────────────
      const lum = skyCol.dot(vec3(0.299, 0.587, 0.114));
      skyCol.assign(mix(vec3(lum), skyCol, rSaturation).max(vec3(0.0)));

      return vec4(skyCol.mul(rExposure), 1.0);
    })();

    const material = new MeshBasicNodeMaterial({
      side:       THREE.BackSide,
      depthTest:  false,
      depthWrite: false,
    });
    // Scale vertices to 99% of camera far plane so the huge sphere isn't
    // frustum-clipped (WebGL did this via gl_Position.z = gl_Position.w).
    material.positionNode = positionLocal.normalize().mul(cameraFar.mul(0.99));
    material.colorNode = skyColorNode;

    this._mesh = new THREE.Mesh(
      new THREE.SphereGeometry(450000, 32, 16),
      material
    );
    this._mesh.name = '__cyco_gradient_sky';
    this._mesh.renderOrder = -1;
    this._mesh.raycast = () => {};
    this._mesh.userData._isHelper = true;

    const cam = this._vpe?.camera;
    if (cam) this._mesh.position.copy(cam.position);

    scene.add(this._mesh);

    // Build WebGPU-native sprite-based lensflare (Three.js Lensflare addon uses
    // renderer.renderBufferDirect() which doesn't exist on WebGPURenderer).
    this._createLensflareWebGPU(scene);
  }

  _destroyMesh() {
    const scene = this._vpe?.scene;
    if (this._mesh) {
      scene?.remove(this._mesh);
      this._mesh.geometry.dispose();
      this._mesh.material.dispose();
      this._mesh = null;
    }
    if (this._lensflare) {
      scene?.remove(this._lensflare);
      this._lensflare = null;
    }
    if (this._lensflareSprites?.length) {
      for (const sprite of this._lensflareSprites) {
        scene?.remove(sprite);
        sprite.material.map?.dispose();
        sprite.material.dispose();
      }
      this._lensflareSprites = null;
    }
    this._gradientTex?.dispose();
    this._gradientTex = null;
    this._tslUniforms = null;
    this._isWebGPU    = false;
  }

  // ── Lens flare ────────────────────────────────────────────────────────────

  /**
   * WebGPU-compatible lens flare using THREE.Sprite objects positioned in
   * screen space each frame. Avoids renderer.renderBufferDirect() which is
   * WebGL-only and crashes the TSL pipeline.
   */
  _createLensflareWebGPU(scene) {
    // Each element: sizeScale relative to lensflareSize, dist along sun→center axis
    // (dist=0 = at sun, dist=1 = at screen center, dist>1 = past center)
    const ELEMS = [
      { sizeScale: 1.00, dist: 0.00, texType: 'radial', sunTint: true  },
      { sizeScale: 0.40, dist: 0.00, texType: 'burst',  sunTint: true  },
      { sizeScale: 0.12, dist: 0.60, texType: 'ring',   sunTint: false },
      { sizeScale: 0.15, dist: 0.75, texType: 'ring',   sunTint: false },
      { sizeScale: 0.10, dist: 0.90, texType: 'ring',   sunTint: false },
      { sizeScale: 0.20, dist: 1.00, texType: 'ring',   sunTint: false },
    ];

    this._lensflareSprites = [];
    for (const el of ELEMS) {
      const texSize = el.texType === 'radial' ? 256 : el.texType === 'burst' ? 128 : 64;
      const tex = this._makeFlareTexture(texSize, el.texType);
      const mat = new THREE.SpriteMaterial({
        map:         tex,
        transparent: true,
        depthTest:   false,
        depthWrite:  false,
        blending:    THREE.AdditiveBlending,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.renderOrder     = 999;
      sprite.frustumCulled   = false;
      sprite.userData._dist      = el.dist;
      sprite.userData._sizeScale = el.sizeScale;
      sprite.userData._sunTint   = el.sunTint;
      sprite.userData._isHelper  = true;
      sprite.visible = false;
      this._lensflareSprites.push(sprite);
      scene.add(sprite);
    }
  }

  /**
   * Reposition WebGPU lensflare sprites each frame along the sun→screen-centre
   * axis in clip space, then unproject to world space at a fixed depth in front
   * of the camera. Called from update() every tick.
   */
  _updateLensflareWebGPU(camera) {
    if (!this._lensflareSprites?.length || !camera) return;
    const p   = this._p;
    const vis = this._sunVisible();
    const show = p.lensflareEnabled && vis > 0;

    if (!show) {
      this._lensflareSprites.forEach(s => { s.visible = false; });
      return;
    }

    // Project sun world position → NDC
    const sunWorld = _tmpV3a
      .copy(p.sunDir).normalize()
      .multiplyScalar(camera.far * 0.8)
      .add(camera.position);
    const sunNDC = _tmpV3b.copy(sunWorld).project(camera);

    // Hide if sun is behind the camera
    if (sunNDC.z > 1.0) {
      this._lensflareSprites.forEach(s => { s.visible = false; });
      return;
    }

    const renderer = this._vpe?.rendererManager?.renderer;
    const canvas   = renderer?.domElement;
    const vpH      = canvas?.clientHeight || 600;

    // Projection matrix elements (column-major): [0]=fx/aspect, [5]=fy=1/tan(fovY/2)
    const pe   = camera.projectionMatrix.elements;
    const DIST = Math.max(camera.near * 80, 0.5); // depth to place sprites

    // 1 pixel in world units at distance DIST:
    //   half-viewport-height in world = DIST / pe[5]
    //   → worldPerPixel = 2 * DIST / (pe[5] * vpH)
    const worldPerPx = 2 * DIST / (pe[5] * vpH);

    this._lensflareSprites.forEach(sprite => {
      const d         = sprite.userData._dist;
      const sizeScale = sprite.userData._sizeScale;
      const sunTint   = sprite.userData._sunTint;

      // Interpolate NDC from sun toward screen centre (0,0)
      const ndcX = sunNDC.x * (1 - d);
      const ndcY = sunNDC.y * (1 - d);

      // Convert NDC + desired depth to camera-local space:
      //   NDC.x = pe[0] * camX / (-camZ)  →  camX = ndcX * DIST / pe[0]
      //   NDC.y = pe[5] * camY / (-camZ)  →  camY = ndcY * DIST / pe[5]
      const worldPos = _tmpV3c.set(
        ndcX * DIST / pe[0],
        ndcY * DIST / pe[5],
        -DIST,
      ).applyMatrix4(camera.matrixWorld);

      sprite.position.copy(worldPos);

      const worldSize = p.lensflareSize * sizeScale * worldPerPx;
      sprite.scale.set(worldSize, worldSize, 1);

      sprite.material.opacity = p.lensflareOpacity * vis;
      if (sunTint) sprite.material.color.copy(p.sunColor);
      sprite.visible = true;
    });
  }

  /** Build procedural flare textures and create the Lensflare object. */
  _createLensflare() {
    this._lensflare = new Lensflare();
    this._lensflare.userData._isHelper = true;

    // Main sun glow — large soft radial disc
    const glowTex    = this._makeFlareTexture(256, 'radial');
    // Small ring/circle flare elements
    const ringTex    = this._makeFlareTexture(64,  'ring');
    // Star burst
    const burstTex   = this._makeFlareTexture(128, 'burst');

    const p = this._p;
    const c = new THREE.Color(p.sunColor);

    // Element 0: main glow at the sun position (distance=0)
    this._lensflare.addElement(new LensflareElement(glowTex, p.lensflareSize, 0, c));
    // Element 1: star burst at sun
    this._lensflare.addElement(new LensflareElement(burstTex, p.lensflareSize * 0.4, 0));
    // Elements 2-4: secondary flares along the screen-centre axis
    this._lensflare.addElement(new LensflareElement(ringTex, 60,  0.6));
    this._lensflare.addElement(new LensflareElement(ringTex, 80,  0.75));
    this._lensflare.addElement(new LensflareElement(ringTex, 50,  0.9));
    this._lensflare.addElement(new LensflareElement(ringTex, 120, 1.0));
  }

  /** Update lensflare position, visibility and opacity. */
  _updateLensflare() {
    if (!this._lensflare) return;
    const p     = this._p;
    const vis   = this._sunVisible();
    const show  = p.lensflareEnabled && vis > 0;
    this._lensflare.visible = show;
    if (!show) return;

    // Position far away in sun direction so occlusion check works correctly
    this._lensflare.position.copy(p.sunDir).multiplyScalar(450000);

    // Update first element colour to match sun colour
    if (this._lensflare.elements?.[0]) {
      this._lensflare.elements[0].color.copy(p.sunColor);
      this._lensflare.elements[0].size  = p.lensflareSize;
    }
    if (this._lensflare.elements?.[1]) {
      this._lensflare.elements[1].size = p.lensflareSize * 0.4;
    }
    // Apply opacity to all elements
    this._lensflare.elements?.forEach(el => { el.opacity = p.lensflareOpacity * vis; });
  }

  /**
   * Generate a procedural canvas texture for lens flare.
   * @param {number} size
   * @param {'radial'|'ring'|'burst'} type
   */
  _makeFlareTexture(size, type) {
    const canvas = document.createElement('canvas');
    canvas.width  = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const c   = size / 2;

    if (type === 'radial') {
      const grad = ctx.createRadialGradient(c, c, 0, c, c, c);
      grad.addColorStop(0,    'rgba(255,255,255,1)');
      grad.addColorStop(0.15, 'rgba(255,220,150,0.9)');
      grad.addColorStop(0.5,  'rgba(255,160,60,0.3)');
      grad.addColorStop(1,    'rgba(255,120,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);

    } else if (type === 'ring') {
      ctx.clearRect(0, 0, size, size);
      ctx.strokeStyle = 'rgba(220,200,255,0.9)';
      ctx.lineWidth   = size * 0.12;
      ctx.beginPath();
      ctx.arc(c, c, c * 0.65, 0, Math.PI * 2);
      ctx.stroke();
      // small inner fill
      const grad = ctx.createRadialGradient(c, c, 0, c, c, c * 0.35);
      grad.addColorStop(0,   'rgba(255,255,255,0.7)');
      grad.addColorStop(1,   'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.fill();

    } else { // burst
      const rays = 16;
      const step = (Math.PI * 2) / rays;
      ctx.clearRect(0, 0, size, size);
      for (let i = 0; i < rays; i++) {
        const angle = i * step;
        const w     = (i % 2 === 0) ? size * 0.04 : size * 0.02;
        const len   = (i % 2 === 0) ? c * 0.9    : c * 0.6;
        ctx.save();
        ctx.translate(c, c);
        ctx.rotate(angle);
        const grad = ctx.createLinearGradient(0, 0, len, 0);
        grad.addColorStop(0,   'rgba(255,255,220,1)');
        grad.addColorStop(0.6, 'rgba(255,240,180,0.4)');
        grad.addColorStop(1,   'rgba(255,200,100,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, -w / 2, len, w);
        ctx.restore();
      }
    }

    const tex = new THREE.CanvasTexture(canvas);
    return tex;
  }
}
