/**
 * VolumetricClouds.js — Real-time ray-marched volumetric cloud system for WebGL.
 *
 * Technique: The cloud "dome" is a large box (BackSide) that always follows the
 * camera, ensuring the camera is always inside.  Each fragment traces a ray from
 * the camera through a world-space cloud slab (y = cloudBase … cloudTop) using
 * FBM noise, Beer–Lambert extinction, and a short light-march for soft shadows.
 *
 * Public API:
 *   setEnabled(bool)
 *   setParam(key, value)   — coverage|density|scale|windSpeed|cloudBase|cloudTop
 *   updateSunFromSky(elevation, azimuth)
 *   update()               — call every frame from ViewportEngine._tick()
 *   dispose()
 */

import * as THREE from 'three';

// ── Vertex Shader ─────────────────────────────────────────────────────────────
const CLOUD_VERT = /* glsl */`
varying vec3 vWorldPos;

void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;

  gl_Position = projectionMatrix * viewMatrix * worldPos;
  // Sky-dome trick: clamp fragment to the far plane so the box is never clipped.
  gl_Position.z = gl_Position.w;
}
`;

// ── Fragment Shader ───────────────────────────────────────────────────────────
const CLOUD_FRAG = /* glsl */`
precision highp float;

uniform float uTime;
uniform float uCoverage;
uniform float uDensity;
uniform float uScale;
uniform float uWindSpeed;
uniform vec3  uSunDir;
uniform vec3  uSunColor;
uniform vec3  uSkyHorizon;
uniform vec3  uSkyZenith;
uniform float uCloudBase;
uniform float uCloudTop;

varying vec3 vWorldPos;

// ── Noise helpers ─────────────────────────────────────────────────────────────

float hash(float n) {
  return fract(sin(n) * 43758.5453);
}

float valueNoise(vec3 x) {
  vec3 p = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  float n = p.x + p.y * 57.0 + 113.0 * p.z;
  return mix(
    mix(mix(hash(n +   0.0), hash(n +   1.0), f.x),
        mix(hash(n +  57.0), hash(n +  58.0), f.x), f.y),
    mix(mix(hash(n + 113.0), hash(n + 114.0), f.x),
        mix(hash(n + 170.0), hash(n + 171.0), f.x), f.y),
    f.z);
}

float fbm(vec3 p) {
  float val  = 0.0;
  float amp  = 0.5;
  float freq = 1.0;
  for (int i = 0; i < 6; i++) {
    val  += amp * valueNoise(p * freq);
    amp  *= 0.5;
    freq *= 2.1;
  }
  return val;
}

// ── Cloud density at world position ──────────────────────────────────────────

float cloudDensity(vec3 p) {
  // Height fraction within the cloud slab: 0 = base, 1 = top
  float h = clamp((p.y - uCloudBase) / max(uCloudTop - uCloudBase, 0.001), 0.0, 1.0);

  // Vertical profile — rounded billowy tops, fade at base
  float profile = smoothstep(0.0, 0.15, h) * smoothstep(1.0, 0.4, h);

  // Wind drift
  vec3 windOfs = vec3(uTime * uWindSpeed, 0.0, uTime * uWindSpeed * 0.35);
  vec3 sp = (p + windOfs) / uScale;

  // Large-scale billowy base shape
  float base = fbm(sp * 0.55);

  // Fine-scale wisps and eroded edges
  float detail = fbm(sp * 2.4 + vec3(4.7, 9.1, 2.3)) * 0.28;

  float d = (base + detail) - (1.0 - uCoverage * 0.95);
  return max(0.0, d) * profile * uDensity * 2.5;
}

// ── Light march (soft sun shadowing) ─────────────────────────────────────────

float lightMarch(vec3 pos) {
  float shadow = 0.0;
  float step   = (uCloudTop - uCloudBase) * 0.18;
  for (int i = 0; i < 4; i++) {
    shadow += cloudDensity(pos + uSunDir * float(i + 1) * step);
  }
  return exp(-shadow * step * 0.22);
}

// ── Main ──────────────────────────────────────────────────────────────────────

void main() {
  // Bail out immediately if no cloud coverage
  if (uCoverage < 0.04) discard;

  vec3 ro = cameraPosition;
  vec3 rd = normalize(vWorldPos - ro);

  // Smooth fade at the horizon (avoids hard cutoff on nearly-horizontal rays)
  float horizonFade = smoothstep(0.0, 0.05, abs(rd.y));
  if (horizonFade < 0.001) discard;

  // Infinite-slab intersection: find where the ray enters / exits the cloud layer
  float invRdY = 1.0 / rd.y;
  float tBase  = (uCloudBase - ro.y) * invRdY;
  float tTop   = (uCloudTop  - ro.y) * invRdY;
  float tNear  = min(tBase, tTop);
  float tFar   = max(tBase, tTop);

  // No valid forward intersection
  if (tFar <= 0.0 || tNear >= tFar) discard;

  float tStart = max(tNear, 0.001);
  float tEnd   = tFar;

  // ── Ray march ─────────────────────────────────────────────────────────────
  const int STEPS = 32;
  float stepSz = (tEnd - tStart) / float(STEPS);

  float transmit  = 1.0;
  vec3  scattered = vec3(0.0);
  bool  hit       = false;

  for (int i = 0; i < STEPS; i++) {
    float t   = tStart + (float(i) + 0.5) * stepSz;
    vec3  pos = ro + rd * t;
    float d   = cloudDensity(pos);

    if (d > 0.001) {
      hit = true;
      float ext  = d * stepSz;
      float beer = exp(-ext * 0.9);

      // Direct sun lighting with self-shadowing
      float sunAtten = lightMarch(pos);

      // Vertical sky-color ambient
      float hFrac = clamp((pos.y - uCloudBase) / (uCloudTop - uCloudBase), 0.0, 1.0);
      vec3  ambient = mix(uSkyHorizon, uSkyZenith, hFrac) * 0.3;

      // Forward-scatter (silver lining near the sun)
      float cosA = dot(rd, uSunDir);
      float phase = 0.5 + 0.45 * cosA;
      vec3  cloudLit = uSunColor * sunAtten * (0.65 + 0.35 * phase) + ambient;

      // Powder effect: subtle darkening on first contact adds depth
      float powder = 1.0 - exp(-d * stepSz * 1.5);
      cloudLit *= mix(1.0, powder * 1.8, 0.35);

      scattered += cloudLit * transmit * (1.0 - beer);
      transmit  *= beer;

      if (transmit < 0.005) break;
    }
  }

  if (!hit) discard;

  float alpha = clamp(1.0 - transmit, 0.0, 1.0) * horizonFade;
  if (alpha < 0.005) discard;

  // Divide accumulated scattered light by alpha to get pre-multiplied colour
  gl_FragColor = vec4(scattered / max(alpha, 0.01), alpha);
}
`;

// ─────────────────────────────────────────────────────────────────────────────

export class VolumetricClouds {
  /**
   * @param {import('./ViewportEngine.js').ViewportEngine} vpe
   */
  constructor(vpe) {
    this._vpe  = vpe;
    this._mesh = null;
    this._t0   = performance.now();

    this._p = {
      enabled:    false,
      coverage:   0.45,
      density:    0.7,
      scale:      55.0,
      windSpeed:  0.4,
      cloudBase:  5.0,
      cloudTop:   25.0,
      sunDir:     new THREE.Vector3(0.45, 0.87, 0.22),
      sunColor:   new THREE.Color(1.0, 0.97, 0.88),
      skyHorizon: new THREE.Color(0.55, 0.70, 0.90),
      skyZenith:  new THREE.Color(0.14, 0.37, 0.80),
    };
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  setEnabled(enabled) {
    this._p.enabled = enabled;
    if (enabled) this._createMesh();
    else          this._destroyMesh();
  }

  /**
   * Set a named cloud parameter and push to GPU uniforms.
   * Valid keys: coverage | density | scale | windSpeed | cloudBase | cloudTop
   */
  setParam(key, value) {
    this._p[key] = value;
    this._pushUniforms();
  }

  /**
   * Sync sun direction from the sky system (degrees).
   * @param {number} elevation  −10 … 90 degrees
   * @param {number} azimuth    0 … 360 degrees
   */
  updateSunFromSky(elevation, azimuth) {
    const phi   = THREE.MathUtils.degToRad(90 - elevation);
    const theta = THREE.MathUtils.degToRad(azimuth);
    this._p.sunDir.setFromSphericalCoords(1, phi, theta);
    if (this._mesh?.material?.uniforms) {
      this._mesh.material.uniforms.uSunDir.value.copy(this._p.sunDir);
    }
  }

  /** Call once per frame from ViewportEngine._tick(). */
  update() {
    if (!this._mesh) return;
    const t = (performance.now() - this._t0) * 0.001;
    this._mesh.material.uniforms.uTime.value = t;

    // The cloud dome always follows the camera so the camera stays inside the box.
    const cam = this._vpe?.camera;
    if (cam) this._mesh.position.copy(cam.position);
  }

  dispose() {
    this._destroyMesh();
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  _createMesh() {
    const scene = this._vpe?.scene;
    if (!scene) { console.warn('[VolumetricClouds] No scene — skipping create.'); return; }
    this._destroyMesh();

    const mat = new THREE.ShaderMaterial({
      vertexShader:   CLOUD_VERT,
      fragmentShader: CLOUD_FRAG,
      uniforms: {
        uTime:       { value: 0 },
        uCoverage:   { value: this._p.coverage },
        uDensity:    { value: this._p.density },
        uScale:      { value: this._p.scale },
        uWindSpeed:  { value: this._p.windSpeed },
        uSunDir:     { value: this._p.sunDir.clone() },
        uSunColor:   { value: this._p.sunColor.clone() },
        uSkyHorizon: { value: this._p.skyHorizon.clone() },
        uSkyZenith:  { value: this._p.skyZenith.clone() },
        uCloudBase:  { value: this._p.cloudBase },
        uCloudTop:   { value: this._p.cloudTop },
      },
      transparent:    true,
      depthWrite:     false,
      depthTest:      false,   // render over everything, depth handled by alpha
      side:           THREE.BackSide,
    });

    // Large box — camera is inside; BackSide shows the inner sky-dome faces.
    const geo = new THREE.BoxGeometry(1800, 1800, 1800);

    this._mesh = new THREE.Mesh(geo, mat);
    this._mesh.name          = '__cyco_clouds';
    this._mesh.raycast       = () => {};   // non-selectable
    this._mesh.frustumCulled = false;      // always render
    this._mesh.renderOrder   = 1;          // after Sky mesh (renderOrder 0)

    scene.add(this._mesh);
  }

  _destroyMesh() {
    if (!this._mesh) return;
    this._vpe?.scene?.remove(this._mesh);
    this._mesh.geometry.dispose();
    this._mesh.material.dispose();
    this._mesh = null;
  }

  _pushUniforms() {
    if (!this._mesh?.material?.uniforms) return;
    const u = this._mesh.material.uniforms;
    u.uCoverage.value    = this._p.coverage;
    u.uDensity.value     = this._p.density;
    u.uScale.value       = this._p.scale;
    u.uWindSpeed.value   = this._p.windSpeed;
    u.uCloudBase.value   = this._p.cloudBase;
    u.uCloudTop.value    = this._p.cloudTop;
    u.uSunColor.value.copy(this._p.sunColor);
    u.uSkyHorizon.value.copy(this._p.skyHorizon);
    u.uSkyZenith.value.copy(this._p.skyZenith);
  }
}
