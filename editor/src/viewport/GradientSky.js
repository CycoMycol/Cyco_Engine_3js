/**
 * GradientSky.js — Gradient-based sky with sun disc, moon disc, and sun lighting.
 *
 * Replaces THREE.Sky.  Renders a large BackSide sphere that always follows the
 * camera.  The sky colour is sampled from a 256-sample gradient texture built
 * from user-defined colour stops.  A sun disc (HDR, triggers bloom) and a moon
 * disc (SDR) are composited on top.  A single DirectionalLight tracks the sun.
 *
 * Public API:
 *   setEnabled(bool)
 *   setParams(opts)   — elevation, azimuth, colorStops, opacityStops,
 *                       showSun, sunColor, sunGlowStrength,
 *                       showMoon, moonColor
 *   getGradient()     — { colorStops, opacityStops }
 *   update()          — call every frame
 *   dispose()
 */

import * as THREE from 'three';

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

// Sun
uniform vec3  uSunDir;
uniform float uSunInner;    // cos(inner radius)
uniform float uSunOuter;    // cos(outer fade radius — slightly larger angle)
uniform vec3  uSunColor;
uniform float uSunVisible;
uniform float uSunGlowStrength;

// Moon
uniform vec3  uMoonDir;
uniform float uMoonInner;
uniform float uMoonOuter;
uniform vec3  uMoonColor;
uniform float uMoonVisible;

varying vec3 vLocalPos;

void main() {
  vec3 dir = normalize(vLocalPos);

  // Sample gradient: y goes -1 (nadir) → +1 (zenith); map to 0→1
  float skyT = clamp(dir.y * 0.5 + 0.5, 0.001, 0.999);
  vec3 skyColor = texture2D(uGradientTex, vec2(skyT, 0.5)).rgb * uSkyBrightness;

  // ── Sun ─────────────────────────────────────────────────────────────
  if (uSunVisible > 0.0) {
    float sunDot   = dot(dir, normalize(uSunDir));
    float sunAngle = acos(clamp(sunDot, -1.0, 1.0));

    // Glow (additive, SDR range)
    float glow = exp(-sunAngle * 7.0) * uSunGlowStrength * uSunVisible;
    skyColor += (uSunColor / 5.0) * glow;

    // Hard disc (HDR — will trigger bloom)
    float disc = smoothstep(uSunOuter, uSunInner, sunDot);
    skyColor = mix(skyColor, uSunColor, disc * uSunVisible);
  }

  // ── Moon ────────────────────────────────────────────────────────────
  if (uMoonVisible > 0.0) {
    float moonDot   = dot(dir, normalize(uMoonDir));
    float moonAngle = acos(clamp(moonDot, -1.0, 1.0));

    // Subtle moon glow
    float glow = exp(-moonAngle * 10.0) * 0.18 * uMoonVisible;
    skyColor += uMoonColor * glow;

    float disc = smoothstep(uMoonOuter, uMoonInner, moonDot);
    skyColor = mix(skyColor, uMoonColor, disc * uMoonVisible);
  }

  gl_FragColor = vec4(skyColor, 1.0);
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
    this._vpe  = viewportEngine;
    this._mesh = null;
    this._gradientTex = null;
    this._sunLight    = null;
    this._enabled     = false;

    this._p = {
      elevation:        30,
      azimuth:          180,
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
      showSun:          true,
      sunColor:         new THREE.Color(5.0, 4.8, 3.5),  // HDR → triggers bloom
      sunGlowStrength:  0.5,
      showMoon:         true,
      moonColor:        new THREE.Color(0.75, 0.80, 0.92),
      sunDir:           new THREE.Vector3(),
      moonDir:          new THREE.Vector3(),
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
   */
  setParams(opts = {}) {
    const p = this._p;
    if (opts.elevation        !== undefined) p.elevation        = opts.elevation;
    if (opts.azimuth          !== undefined) p.azimuth          = opts.azimuth;
    if (opts.showSun          !== undefined) p.showSun          = opts.showSun;
    if (opts.sunGlowStrength  !== undefined) p.sunGlowStrength  = opts.sunGlowStrength;
    if (opts.showMoon         !== undefined) p.showMoon         = opts.showMoon;
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

    u.uSkyBrightness.value  = this._skyBrightness();
    u.uSunDir.value.copy(this._p.sunDir);
    u.uSunColor.value.copy(this._p.sunColor);
    u.uSunVisible.value     = this._sunVisible();
    u.uSunGlowStrength.value = this._p.sunGlowStrength;
    u.uMoonDir.value.copy(this._p.moonDir);
    u.uMoonColor.value.copy(this._p.moonColor);
    u.uMoonVisible.value    = this._moonVisible();
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
        uGradientTex:     { value: this._gradientTex },
        uSkyBrightness:   { value: this._skyBrightness() },
        uSunDir:          { value: this._p.sunDir.clone() },
        uSunInner:        { value: SUN_INNER },
        uSunOuter:        { value: SUN_OUTER },
        uSunColor:        { value: this._p.sunColor.clone() },
        uSunVisible:      { value: this._sunVisible() },
        uSunGlowStrength: { value: this._p.sunGlowStrength },
        uMoonDir:         { value: this._p.moonDir.clone() },
        uMoonInner:       { value: MOON_INNER },
        uMoonOuter:       { value: MOON_OUTER },
        uMoonColor:       { value: this._p.moonColor.clone() },
        uMoonVisible:     { value: this._moonVisible() },
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
    this._mesh.renderOrder = 0;
    this._mesh.raycast = () => {};
    this._mesh.userData._isHelper = true;

    const cam = this._vpe?.camera;
    if (cam) this._mesh.position.copy(cam.position);

    // Sun directional light
    this._sunLight = new THREE.DirectionalLight(0xfff8e7, 0);
    this._sunLight.userData._isHelper = true;
    this._updateSunLight();

    scene.add(this._mesh, this._sunLight);
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
    this._gradientTex?.dispose();
    this._gradientTex = null;
  }
}
