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

function buildGradientTex(colorStops) {
  const sorted = [...colorStops].sort((a, b) => a.pos - b.pos);
  const data   = new Uint8Array(SAMPLES * 4); // RGBA

  const parse = (hex) => {
    const n = parseInt(hex.replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };

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
      const blend = (t - s0.pos) / (s1.pos - s0.pos + 1e-9);
      const [r0, g0, b0] = parse(s0.color);
      const [r1, g1, b1] = parse(s1.color);
      r = Math.round(r0 + (r1 - r0) * blend);
      g = Math.round(g0 + (g1 - g0) * blend);
      b = Math.round(b0 + (b1 - b0) * blend);
    }

    data[i * 4]     = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
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

// ── GradientSky class ─────────────────────────────────────────────────────────

export class GradientSky {
  constructor(viewportEngine) {
    this._vpe       = viewportEngine;
    this._mesh      = null;
    this._gradientTex = null;
    this._sunLight  = null;
    this._lensflare = null;
    this._enabled   = false;

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
  }

  get enabled() { return this._enabled; }

  /** Return current gradient data (for panel re-init). */
  getGradient() {
    return {
      colorStops:   this._p.colorStops.map(s => ({ ...s })),
      opacityStops: this._p.opacityStops.map(s => ({ ...s })),
    };
  }

  setEnabled(v) {
    this._enabled = !!v;
    if (v) this._createMesh();
    else   this._destroyMesh();
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
  }

  dispose() {
    this._destroyMesh();
  }

  // ── Private ──────────────────────────────────────────────────────────────

  _updateDirs() {
    const { elevation, azimuth } = this._p;
    const phi   = THREE.MathUtils.degToRad(90 - elevation);
    const theta = THREE.MathUtils.degToRad(azimuth);
    this._p.sunDir.setFromSphericalCoords(1, phi, theta);

    // Moon rises opposite the sun
    const mPhi   = THREE.MathUtils.degToRad(90 + elevation);
    const mTheta = THREE.MathUtils.degToRad((azimuth + 180) % 360);
    this._p.moonDir.setFromSphericalCoords(1, mPhi, mTheta);
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
    this._gradientTex?.dispose();
    this._gradientTex = buildGradientTex(this._p.colorStops);
    const u = this._mesh?.material?.uniforms;
    if (u) u.uGradientTex.value = this._gradientTex;
  }

  _pushUniforms() {
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

  _createMesh() {
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

    // Sun directional light
    this._sunLight = new THREE.DirectionalLight(0xfff8e7, 0);
    this._sunLight.userData._isHelper = true;
    this._updateSunLight();

    // Lens flare
    this._createLensflare();
    this._updateLensflare();

    scene.add(this._mesh, this._sunLight);
    if (this._lensflare) scene.add(this._lensflare);
  }

  _destroyMesh() {
    const scene = this._vpe?.scene;
    if (this._mesh) {
      scene?.remove(this._mesh);
      this._mesh.geometry.dispose();
      this._mesh.material.dispose();
      this._mesh = null;
    }
    if (this._sunLight) {
      scene?.remove(this._sunLight);
      this._sunLight = null;
    }
    if (this._lensflare) {
      scene?.remove(this._lensflare);
      this._lensflare = null;
    }
    this._gradientTex?.dispose();
    this._gradientTex = null;
  }

  // ── Lens flare ────────────────────────────────────────────────────────────

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
