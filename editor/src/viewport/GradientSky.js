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
    this._lensflareMesh    = null;  // LensflareMesh for WebGPU natural style
    this._enabled         = false;
    this._raycaster       = null;   // Reused for per-frame sun occlusion test (WebGPU path)

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
      lensflareEnabled:      true,
      lensflareSize:         300,
      lensflareOpacity:      0.7,
      lensflareStyle:        'classic', // 'classic'|'natural'|'cinematic'|'anamorphic'|'subtle'
      lensflareIntensity:    1.0,       // cinematic: strength multiplier
      lensflareGhostCount:   4,         // cinematic: ghost ring count
      lensflareStreakLength:  1.0,      // anamorphic: horizontal streak scale
      lensflareBrightness:   1.2,       // natural: brightness boost
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
    if (opts.lensflareEnabled      !== undefined) p.lensflareEnabled      = opts.lensflareEnabled;
    if (opts.lensflareSize         !== undefined) p.lensflareSize         = opts.lensflareSize;
    if (opts.lensflareOpacity      !== undefined) p.lensflareOpacity      = opts.lensflareOpacity;
    if (opts.lensflareIntensity    !== undefined) p.lensflareIntensity    = opts.lensflareIntensity;
    if (opts.lensflareGhostCount   !== undefined) p.lensflareGhostCount   = opts.lensflareGhostCount;
    if (opts.lensflareStreakLength  !== undefined) p.lensflareStreakLength  = opts.lensflareStreakLength;
    if (opts.lensflareBrightness   !== undefined) p.lensflareBrightness   = opts.lensflareBrightness;
    const _styleChanged = opts.lensflareStyle !== undefined && opts.lensflareStyle !== p.lensflareStyle;
    const _ghostChanged = opts.lensflareGhostCount !== undefined && opts.lensflareGhostCount !== p.lensflareGhostCount;
    if (opts.lensflareStyle        !== undefined) p.lensflareStyle        = opts.lensflareStyle;
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

    // Recreate flare when style or ghost-count changes, otherwise live-update
    if (_styleChanged || _ghostChanged) {
      this._destroyFlares();
      this._createFlares();
    } else {
      this._updateLensflare();
    }
  }

  /** Call once per frame from ViewportEngine._tick(). */
  update() {
    if (!this._mesh) return;
    const cam = this._vpe?.camera;
    if (cam) {
      this._mesh.position.copy(cam.position);
      // Keep LensflareMesh (natural WebGPU style) in sync with sun direction
      if (this._lensflareMesh) {
        this._lensflareMesh.position
          .copy(this._p.sunDir).multiplyScalar(450000)
          .add(cam.position);
      }
    }
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
    if (this._lensflareMesh) {
      scene?.remove(this._lensflareMesh);
      this._lensflareMesh.dispose?.();
      this._lensflareMesh = null;
    }
    this._gradientTex?.dispose();
    this._gradientTex = null;
    this._tslUniforms = null;
    this._isWebGPU    = false;
  }

  // ── Lens flare ────────────────────────────────────────────────────────────

  /** Remove any active lens flare objects from the scene without destroying the sky mesh. */
  _destroyFlares() {
    const scene = this._vpe?.scene;
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
    if (this._lensflareMesh) {
      scene?.remove(this._lensflareMesh);
      this._lensflareMesh.dispose?.();
      this._lensflareMesh = null;
    }
  }

  /** (Re-)create the lens flare for the current style + renderer type. */
  _createFlares() {
    const scene = this._vpe?.scene;
    if (!scene || !this._mesh) return;
    if (this._isWebGPU) {
      this._createLensflareWebGPU(scene);
    } else {
      this._createLensflare();
      if (this._lensflare) scene.add(this._lensflare);
    }
    this._updateLensflare();
  }

  /**
   * Style-aware WebGPU lens flare creation.
   * Dispatches to the appropriate implementation based on this._p.lensflareStyle.
   */
  _createLensflareWebGPU(scene) {
    const style = this._p.lensflareStyle ?? 'classic';
    if (style === 'natural') {
      this._createLensflareNaturalWebGPU(scene); // async — falls back if LensflareMesh unavailable
    } else if (style === 'anamorphic') {
      this._createLensflareAnamorphicWebGPU(scene);
    } else {
      this._createLensflareSpritesWebGPU(scene, style);
    }
  }

  /**
   * WebGPU "natural" style — uses LensflareMesh for proper GPU-native occlusion + visibility.
   * Falls back to classic sprites if import fails.
   */
  async _createLensflareNaturalWebGPU(scene) {
    try {
      const { LensflareMesh, LensflareElement: LFE } =
        await import('three/addons/objects/LensflareMesh.js');
      const lensflare = new LensflareMesh();
      lensflare.userData._isHelper = true;

      const p          = this._p;
      const brightness = p.lensflareBrightness ?? 1.2;
      const size       = p.lensflareSize * brightness;
      const c          = new THREE.Color(p.sunColor);

      const glowTex  = this._makeFlareTexture(256, 'radial');
      const ringTex  = this._makeFlareTexture(64,  'ring');
      const burstTex = this._makeFlareTexture(128, 'burst');
      // sRGB color space required for correct WebGPU rendering
      glowTex.colorSpace  = THREE.SRGBColorSpace;
      ringTex.colorSpace  = THREE.SRGBColorSpace;
      burstTex.colorSpace = THREE.SRGBColorSpace;

      lensflare.addElement(new LFE(glowTex,  size,        0,    c));
      lensflare.addElement(new LFE(burstTex, size * 0.35, 0));
      lensflare.addElement(new LFE(ringTex,  50,  0.50));
      lensflare.addElement(new LFE(ringTex,  70,  0.65));
      lensflare.addElement(new LFE(ringTex,  40,  0.80));
      lensflare.addElement(new LFE(ringTex, 100,  0.95));
      lensflare.addElement(new LFE(ringTex,  60,  1.10));

      // Place at sun (camera-relative; kept in sync every frame in update())
      const cam = this._vpe?.camera;
      lensflare.position
        .copy(p.sunDir).multiplyScalar(450000)
        .add(cam ? cam.position : new THREE.Vector3());

      this._lensflareMesh = lensflare;
      scene.add(lensflare);
      console.log('[GradientSky] LensflareMesh (natural) created ✓');
    } catch (err) {
      console.warn('[GradientSky] LensflareMesh failed — using sprite fallback:', err);
      this._createLensflareSpritesWebGPU(scene, 'natural');
    }
  }

  /** WebGPU anamorphic style — wide horizontal streak sprites. */
  _createLensflareAnamorphicWebGPU(scene) {
    const p         = this._p;
    const streakLen = p.lensflareStreakLength ?? 1.0;
    const ELEMS = [
      { sizeScaleX: 3.0 * streakLen, sizeScaleY: 0.03,  dist: 0.00, texType: 'streak1', sunTint: true  },
      { sizeScaleX: 2.0 * streakLen, sizeScaleY: 0.015, dist: 0.00, texType: 'streak2', sunTint: true  },
      { sizeScaleX: 0.60,            sizeScaleY: 0.60,  dist: 0.00, texType: 'radial',  sunTint: true  },
      { sizeScaleX: 0.12,            sizeScaleY: 0.12,  dist: 0.55, texType: 'ring',    sunTint: false },
      { sizeScaleX: 0.10,            sizeScaleY: 0.10,  dist: 0.80, texType: 'ring',    sunTint: false },
    ];

    this._lensflareSprites = [];
    for (const el of ELEMS) {
      const isStreak = el.texType.startsWith('streak');
      let tex;
      if (isStreak) {
        const tint = el.texType === 'streak1' ? '#a0d0ff' : '#6090ff';
        tex = this._makeAnamorphicTexture(512, 64, tint);
      } else {
        const sz = el.texType === 'radial' ? 256 : 64;
        tex = this._makeFlareTexture(sz, el.texType === 'radial' ? 'radial' : 'ring');
      }
      const mat = new THREE.SpriteMaterial({
        map: tex, transparent: true,
        depthTest: false, depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.renderOrder   = 999;
      sprite.frustumCulled = false;
      sprite.userData._dist       = el.dist;
      sprite.userData._sizeScaleX = el.sizeScaleX;
      sprite.userData._sizeScaleY = el.sizeScaleY;
      sprite.userData._sizeScale  = Math.max(el.sizeScaleX, el.sizeScaleY);
      sprite.userData._sunTint    = el.sunTint;
      sprite.userData._isHelper   = true;
      sprite.visible = false;
      this._lensflareSprites.push(sprite);
      scene.add(sprite);
    }
  }

  /**
   * Sprite-based WebGPU lens flare for classic / cinematic / subtle / natural(fallback) styles.
   * @param {THREE.Scene} scene
   * @param {'classic'|'cinematic'|'subtle'|'natural'} style
   */
  _createLensflareSpritesWebGPU(scene, style) {
    const p = this._p;
    let ELEMS;
    if (style === 'cinematic') {
      const ghosts = Math.max(2, Math.min(10, Math.round(p.lensflareGhostCount ?? 4)));
      ELEMS = [
        { sizeScale: 1.80, dist: 0.00, texType: 'radial', sunTint: true  },
        { sizeScale: 0.60, dist: 0.00, texType: 'burst',  sunTint: true  },
      ];
      for (let i = 0; i < ghosts; i++) {
        const d = 0.3 + (i / ghosts) * 0.85;
        const s = 0.08 + 0.05 * Math.abs(Math.sin(i * 2.3));
        ELEMS.push({ sizeScale: s, dist: d, texType: 'ring', sunTint: false });
      }
      ELEMS.push({ sizeScale: 0.30, dist: 1.25, texType: 'radial', sunTint: false });
    } else if (style === 'subtle') {
      ELEMS = [
        { sizeScale: 0.80, dist: 0.00, texType: 'radial', sunTint: true },
      ];
    } else {
      // classic / natural-fallback
      ELEMS = [
        { sizeScale: 1.00, dist: 0.00, texType: 'radial', sunTint: true  },
        { sizeScale: 0.40, dist: 0.00, texType: 'burst',  sunTint: true  },
        { sizeScale: 0.12, dist: 0.60, texType: 'ring',   sunTint: false },
        { sizeScale: 0.15, dist: 0.75, texType: 'ring',   sunTint: false },
        { sizeScale: 0.10, dist: 0.90, texType: 'ring',   sunTint: false },
        { sizeScale: 0.20, dist: 1.00, texType: 'ring',   sunTint: false },
      ];
    }

    this._lensflareSprites = [];
    for (const el of ELEMS) {
      const texSize = el.texType === 'radial' ? 256 : el.texType === 'burst' ? 128 : 64;
      const tex     = this._makeFlareTexture(texSize, el.texType);
      const mat     = new THREE.SpriteMaterial({
        map: tex, transparent: true,
        depthTest: false, depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.renderOrder   = 999;
      sprite.frustumCulled = false;
      sprite.userData._dist       = el.dist;
      sprite.userData._sizeScale  = el.sizeScale;
      sprite.userData._sizeScaleX = el.sizeScale;
      sprite.userData._sizeScaleY = el.sizeScale;
      sprite.userData._sunTint    = el.sunTint;
      sprite.userData._isHelper   = true;
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
    // If using LensflareMesh (natural style), handle visibility only
    if (this._lensflareMesh) {
      const p   = this._p;
      const vis = this._sunVisible();
      this._lensflareMesh.visible = p.lensflareEnabled && vis > 0;
      // Position is updated in update() each frame
    }

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

    // ── Occlusion test: hide if any scene mesh blocks the line to the sun ──────
    const scene = this._vpe?.scene;
    if (scene) {
      if (!this._raycaster) this._raycaster = new THREE.Raycaster();
      this._raycaster.set(camera.position, p.sunDir);
      this._raycaster.far = camera.far;
      const occluders = [];
      scene.traverseVisible(obj => {
        if ((obj.isMesh || obj.isInstancedMesh) && !obj.userData._isHelper) occluders.push(obj);
      });
      if (occluders.length > 0 && this._raycaster.intersectObjects(occluders, false).length > 0) {
        this._lensflareSprites.forEach(s => { s.visible = false; });
        return;
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    const renderer = this._vpe?.rendererManager?.renderer;
    const canvas   = renderer?.domElement;
    const vpH      = canvas?.clientHeight || 600;

    const pe   = camera.projectionMatrix.elements;
    const DIST = Math.max(camera.near * 80, 0.5);
    const worldPerPx = 2 * DIST / (pe[5] * vpH);

    // Cinematic intensity multiplier
    const intensity = (p.lensflareStyle === 'cinematic') ? (p.lensflareIntensity ?? 1.0) : 1.0;

    this._lensflareSprites.forEach(sprite => {
      const d          = sprite.userData._dist;
      const sizeScaleX = sprite.userData._sizeScaleX ?? sprite.userData._sizeScale;
      const sizeScaleY = sprite.userData._sizeScaleY ?? sprite.userData._sizeScale;
      const sunTint    = sprite.userData._sunTint;

      const ndcX = sunNDC.x * (1 - d);
      const ndcY = sunNDC.y * (1 - d);

      const worldPos = _tmpV3c.set(
        ndcX * DIST / pe[0],
        ndcY * DIST / pe[5],
        -DIST,
      ).applyMatrix4(camera.matrixWorld);

      sprite.position.copy(worldPos);

      const worldSizeX = p.lensflareSize * sizeScaleX * intensity * worldPerPx;
      const worldSizeY = p.lensflareSize * sizeScaleY * intensity * worldPerPx;
      sprite.scale.set(worldSizeX, worldSizeY, 1);

      sprite.material.opacity = p.lensflareOpacity * vis;
      if (sunTint) sprite.material.color.copy(p.sunColor);
      sprite.visible = true;
    });
  }

  /** Build procedural flare textures and create the Lensflare object for the current style. Does NOT add to scene. */
  _createLensflare() {
    const style = this._p.lensflareStyle ?? 'classic';
    switch (style) {
      case 'natural':    this._buildNaturalWebGL();    break;
      case 'cinematic':  this._buildCinematicWebGL();  break;
      case 'anamorphic': this._buildAnamorphicWebGL(); break;
      case 'subtle':     this._buildSubtleWebGL();     break;
      default:           this._buildClassicWebGL();    break;
    }
  }

  _buildClassicWebGL() {
    this._lensflare = new Lensflare();
    this._lensflare.userData._isHelper = true;
    const glowTex  = this._makeFlareTexture(256, 'radial');
    const ringTex  = this._makeFlareTexture(64,  'ring');
    const burstTex = this._makeFlareTexture(128, 'burst');
    const p = this._p;
    const c = new THREE.Color(p.sunColor);
    this._lensflare.addElement(new LensflareElement(glowTex,  p.lensflareSize,       0,    c));
    this._lensflare.addElement(new LensflareElement(burstTex, p.lensflareSize * 0.4, 0));
    this._lensflare.addElement(new LensflareElement(ringTex,  60,  0.60));
    this._lensflare.addElement(new LensflareElement(ringTex,  80,  0.75));
    this._lensflare.addElement(new LensflareElement(ringTex,  50,  0.90));
    this._lensflare.addElement(new LensflareElement(ringTex, 120,  1.00));
  }

  _buildNaturalWebGL() {
    this._lensflare = new Lensflare();
    this._lensflare.userData._isHelper = true;
    const glowTex  = this._makeFlareTexture(256, 'radial');
    const ringTex  = this._makeFlareTexture(64,  'ring');
    const burstTex = this._makeFlareTexture(128, 'burst');
    // SRGBColorSpace for correct color reproduction (per three.js WebGPU example)
    glowTex.colorSpace  = THREE.SRGBColorSpace;
    ringTex.colorSpace  = THREE.SRGBColorSpace;
    burstTex.colorSpace = THREE.SRGBColorSpace;
    const p          = this._p;
    const brightness = p.lensflareBrightness ?? 1.2;
    const size       = p.lensflareSize * brightness;
    const c          = new THREE.Color(p.sunColor);
    this._lensflare.addElement(new LensflareElement(glowTex,  size,        0,    c));
    this._lensflare.addElement(new LensflareElement(burstTex, size * 0.35, 0));
    this._lensflare.addElement(new LensflareElement(ringTex,  50,  0.50));
    this._lensflare.addElement(new LensflareElement(ringTex,  70,  0.65));
    this._lensflare.addElement(new LensflareElement(ringTex,  40,  0.80));
    this._lensflare.addElement(new LensflareElement(ringTex, 100,  0.95));
    this._lensflare.addElement(new LensflareElement(ringTex,  60,  1.10));
  }

  _buildCinematicWebGL() {
    this._lensflare = new Lensflare();
    this._lensflare.userData._isHelper = true;
    const glowTex  = this._makeFlareTexture(256, 'radial');
    const ringTex  = this._makeFlareTexture(64,  'ring');
    const burstTex = this._makeFlareTexture(128, 'burst');
    const p         = this._p;
    const intensity = p.lensflareIntensity ?? 1.0;
    const ghosts    = Math.max(2, Math.min(10, Math.round(p.lensflareGhostCount ?? 4)));
    const c         = new THREE.Color(p.sunColor);
    this._lensflare.addElement(new LensflareElement(glowTex,  p.lensflareSize * 1.5 * intensity, 0, c));
    this._lensflare.addElement(new LensflareElement(burstTex, p.lensflareSize * 0.6 * intensity, 0));
    for (let i = 0; i < ghosts; i++) {
      const d    = 0.3 + (i / ghosts) * 0.85;
      const size = 30 + Math.abs(Math.sin(i * 2.3)) * 50 + 20;
      this._lensflare.addElement(new LensflareElement(ringTex, size, d));
    }
    this._lensflare.addElement(new LensflareElement(glowTex, p.lensflareSize * 0.25 * intensity, 1.25));
  }

  _buildAnamorphicWebGL() {
    this._lensflare = new Lensflare();
    this._lensflare.userData._isHelper = true;
    const p         = this._p;
    const streakLen = p.lensflareStreakLength ?? 1.0;
    const c         = new THREE.Color(p.sunColor);
    const glowTex    = this._makeFlareTexture(256, 'radial');
    const streakTex1 = this._makeAnamorphicTexture(512, 64, '#a0d0ff');
    const streakTex2 = this._makeAnamorphicTexture(512, 32, '#6090ff');
    const ringTex    = this._makeFlareTexture(48, 'ring');
    this._lensflare.addElement(new LensflareElement(glowTex,    p.lensflareSize * 0.6,             0,    c));
    this._lensflare.addElement(new LensflareElement(streakTex1, p.lensflareSize * 2.0 * streakLen, 0));
    this._lensflare.addElement(new LensflareElement(streakTex2, p.lensflareSize * 1.5 * streakLen, 0));
    this._lensflare.addElement(new LensflareElement(ringTex, 30, 0.50));
    this._lensflare.addElement(new LensflareElement(ringTex, 40, 0.80));
  }

  _buildSubtleWebGL() {
    this._lensflare = new Lensflare();
    this._lensflare.userData._isHelper = true;
    const p       = this._p;
    const c       = new THREE.Color(p.sunColor);
    const glowTex = this._makeFlareTexture(256, 'radial');
    this._lensflare.addElement(new LensflareElement(glowTex, p.lensflareSize * 0.8, 0, c));
  }

  /** Update lensflare position, visibility and opacity (WebGL + LensflareMesh). */
  _updateLensflare() {
    const p    = this._p;
    const vis  = this._sunVisible();
    const show = p.lensflareEnabled && vis > 0;

    // Update LensflareMesh visibility (natural style, WebGPU)
    if (this._lensflareMesh) {
      this._lensflareMesh.visible = show;
      // Position is kept in sync each frame in update()
    }

    // Update WebGL Lensflare
    if (this._lensflare) {
      this._lensflare.visible = show;
      if (!show) return;

      this._lensflare.position.copy(p.sunDir).multiplyScalar(450000);

      const style      = p.lensflareStyle ?? 'classic';
      const intensity  = p.lensflareIntensity  ?? 1.0;
      const brightness = p.lensflareBrightness ?? 1.2;
      const streakLen  = p.lensflareStreakLength ?? 1.0;

      const lfElems     = this._lensflare.elements;
      const opacityScale = (p.lensflareOpacity ?? 1.0) * vis;
      if (lfElems?.[0]) {
        // element[0] color = sunColor * opacity (preserves hue, scales brightness)
        lfElems[0].color.copy(p.sunColor).multiplyScalar(opacityScale);
        let mainSize;
        switch (style) {
          case 'cinematic':  mainSize = p.lensflareSize * 1.5 * intensity; break;
          case 'natural':    mainSize = p.lensflareSize * brightness;      break;
          case 'anamorphic': mainSize = p.lensflareSize * 0.6;             break;
          case 'subtle':     mainSize = p.lensflareSize * 0.8;             break;
          default:           mainSize = p.lensflareSize;                   break;
        }
        lfElems[0].size = mainSize;
      }
      if (lfElems?.[1]) {
        switch (style) {
          case 'cinematic':  lfElems[1].size = p.lensflareSize * 0.6 * intensity;   break;
          case 'natural':    lfElems[1].size = p.lensflareSize * brightness * 0.35; break;
          case 'anamorphic': lfElems[1].size = p.lensflareSize * 2.0 * streakLen;   break;
          default:           lfElems[1].size = p.lensflareSize * 0.4;               break;
        }
      }
      // Apply opacity to all secondary elements via color grey-scale (setScalar resets each frame)
      if (lfElems) {
        for (let i = 1; i < lfElems.length; i++) lfElems[i].color.setScalar(opacityScale);
      }
    }
    // Sprite array visibility/size is updated per-frame in _updateLensflareWebGPU
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

  /**
   * Generate a horizontal streak (anamorphic) canvas texture.
   * @param {number} width
   * @param {number} height
   * @param {string} tintColor  CSS hex color for tint, e.g. '#a0d0ff'
   */
  _makeAnamorphicTexture(width, height, tintColor) {
    const canvas  = document.createElement('canvas');
    canvas.width  = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const w = width, h = height;
    const cx = w / 2, cy = h / 2;
    ctx.clearRect(0, 0, w, h);

    const c = new THREE.Color(tintColor);
    const r = Math.round(c.r * 255);
    const g = Math.round(c.g * 255);
    const b = Math.round(c.b * 255);

    // Horizontal streak with feathered edges
    const streakH = Math.max(2, h * 0.18);
    const grad = ctx.createLinearGradient(0, cy, w, cy);
    grad.addColorStop(0,    `rgba(${r},${g},${b},0)`);
    grad.addColorStop(0.25, `rgba(${r},${g},${b},0.3)`);
    grad.addColorStop(0.45, `rgba(${r},${g},${b},0.8)`);
    grad.addColorStop(0.50, `rgba(255,255,255,1)`);
    grad.addColorStop(0.55, `rgba(${r},${g},${b},0.8)`);
    grad.addColorStop(0.75, `rgba(${r},${g},${b},0.3)`);
    grad.addColorStop(1,    `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, cy - streakH / 2, w, streakH);

    // Bright core dot at center
    const dotGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, h * 0.45);
    dotGrad.addColorStop(0,   'rgba(255,255,255,1)');
    dotGrad.addColorStop(0.3, `rgba(${r},${g},${b},0.5)`);
    dotGrad.addColorStop(1,   `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = dotGrad;
    ctx.fillRect(cx - h * 0.45, 0, h * 0.9, h);

    const tex = new THREE.CanvasTexture(canvas);
    return tex;
  }
}
