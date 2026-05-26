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
uniform float uBloomBrightness;
uniform float uCloudBloomThreshold;
uniform float uWindAngle;  // radians; 0 = +X, PI/2 = +Z
uniform float uMorphSpeed; // how fast cloud shapes evolve (independent of wind drift)

varying vec3 vWorldPos;

// ── Improved value noise (Inigo Quilez) ──────────────────────────────────────
// 3D hash: maps vec3 → float with no axis-aligned correlation stripes.
// Avoids the 1D-hash-from-3D-coords pattern that caused the visible ripple artifacts.
float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

// Quintic smoothstep (C2 continuity) instead of cubic (C1).
// The cubic smoothstep has a discontinuous second derivative at grid cell boundaries,
// which creates visible Mach-band ripple artifacts. Quintic eliminates these.
float valueNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  // Quintic: 6t^5 - 15t^4 + 10t^3
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), u.x),
                 mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), u.x), u.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), u.x),
                 mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), u.x), u.y), u.z);
}

float fbm(vec3 p) {
  float val  = 0.0;
  float amp  = 0.5;
  float freq = 1.0;
  for (int i = 0; i < 6; i++) {
    val  += amp * valueNoise(p * freq);
    amp  *= 0.5;
    freq *= 2.0;  // Exact octave ratio — 2.1 created inter-octave interference patterns
  }
  return val;
}

// ── Cloud density at world position ──────────────────────────────────────────

float cloudDensity(vec3 p) {
  // Height fraction within the cloud slab: 0 = base, 1 = top
  float h = clamp((p.y - uCloudBase) / max(uCloudTop - uCloudBase, 0.001), 0.0, 1.0);

  // Vertical profile — rounded billowy tops, fade at base
  float profile = smoothstep(0.0, 0.15, h) * smoothstep(1.0, 0.4, h);

  // Wind drift along user-controlled direction
  float wCos = cos(uWindAngle);
  float wSin = sin(uWindAngle);
  // Wind drift applied in noise space (after scale division) so windSpeed directly controls
  // drift rate regardless of cloud scale. At windSpeed=1, clouds traverse one noise tile in ~6s.
  vec3 sp = p / uScale;
  sp += vec3(wCos, 0.0, wSin) * uTime * uWindSpeed * 0.3;

  // Large-scale billowy base shape
  float base = fbm(sp * 0.55);

  // Fine-scale wisps and eroded edges — evolve at a different rate than base to create visible shape morphing
  float detail = fbm(sp * 2.4 + vec3(4.7 + uTime * uMorphSpeed * 1.5, 9.1, 2.3 - uTime * uMorphSpeed * 1.1)) * 0.28;

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

  // Discard near-horizontal rays: steep rays only.  The fade below is applied
  // per-sample so the boundary dissolves into natural wisps rather than a hard circle.
  float horizonFade = smoothstep(0.30, 0.75, abs(rd.y));
  if (horizonFade < 0.001) discard;

  // Elevation density scale: converts path-length opacity to column opacity.
  float elevScale = clamp(abs(rd.y) * 2.0, 0.0, 1.0);

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
  // Fixed-step-size approach: cap each step at MAX_STEP_SZ world units.
  // A near-horizontal ray through the 300-unit slab at rd.y=0.1 is 3000 units;
  // splitting 3000 into 48 "variable" steps gives 62-unit steps where each step
  // has extinction ≈ density × 62 → instantly opaque → white bloom.
  // Capping at 10 units/step means 48 steps only reach 480 units, and density
  // per step stays physically plausible regardless of ray angle.
  const int   STEPS       = 48;
  const float MAX_STEP_SZ = 10.0;
  float stepSz = min((tEnd - tStart) / float(STEPS), MAX_STEP_SZ);
  tEnd = min(tEnd, tStart + stepSz * float(STEPS));

  // Per-pixel jitter: offset each ray's start position by a random fraction of
  // one step. This breaks up the regular sampling grid that causes Moiré /
  // banding artifacts — the same technique used by three.js webgl_volume_cloud.
  float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(127.1, 311.7))) * 43758.5453);
  tStart += jitter * stepSz;

  float transmit  = 1.0;
  vec3  scattered = vec3(0.0);
  bool  hit       = false;

  for (int i = 0; i < STEPS; i++) {
    float t   = tStart + float(i) * stepSz;
    if (t > tEnd) break;
    vec3  pos = ro + rd * t;

    // Horizontal world-space distance fade — prevents the box boundary from being
    // visible as a hard edge and naturally dissolves clouds into the far distance.
    float hDist    = length(pos.xz - ro.xz);
    float distFade = 1.0 - smoothstep(650.0, 870.0, hDist);

    // Apply all three fades to density so the cloud SHAPE thins out naturally
    // (wispy edges, breaks up near the boundary) rather than cutting alpha hard.
    float d = cloudDensity(pos) * elevScale * horizonFade * distFade;

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

  float alpha = clamp(1.0 - transmit, 0.0, 1.0);
  if (alpha < 0.005) discard;

  // Divide accumulated scattered light by alpha to get pre-multiplied colour
  vec3 cloudColor = scattered / max(alpha, 0.01);
  // Per-cloud bloom filter: threshold zeros out dim cloud pixels; brightness scales output
  float lum = dot(cloudColor, vec3(0.2126, 0.7152, 0.0722));
  if (lum < uCloudBloomThreshold) cloudColor = vec3(0.0);
  cloudColor *= uBloomBrightness;
  gl_FragColor = vec4(cloudColor, alpha);
}
`;

// ─────────────────────────────────────────────────────────────────────────────

// ── Cloud Shadow shaders ──────────────────────────────────────────────────────
// The shadow is a large flat plane at ground level (y ≈ 0).  For each fragment
// the shader fires a ray upward toward the sun through the cloud slab, integrates
// density (fast 3-octave FBM), and outputs a dark semi-transparent colour whose
// alpha is proportional to cloud density above that point.
const SHADOW_VERT = /* glsl */`
varying vec3 vWorldPos;
void main() {
  vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SHADOW_FRAG = /* glsl */`
precision highp float;

uniform float uTime;
uniform float uCoverage;
uniform float uDensity;
uniform float uScale;
uniform float uWindSpeed;
uniform float uWindAngle;
uniform vec3  uSunDir;
uniform float uCloudBase;
uniform float uCloudTop;
uniform float uShadowStrength;
uniform float uMorphSpeed;

varying vec3 vWorldPos;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float valueNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(mix(mix(hash(i),           hash(i+vec3(1,0,0)), u.x),
                 mix(hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)), u.x), u.y),
             mix(mix(hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)), u.x),
                 mix(hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)), u.x), u.y), u.z);
}

// 3-octave fast variant (shadow pass doesn't need full detail)
float cloudDensityFast(vec3 p) {
  float h = clamp((p.y - uCloudBase) / max(uCloudTop - uCloudBase, 0.001), 0.0, 1.0);
  float profile = smoothstep(0.0, 0.15, h) * smoothstep(1.0, 0.4, h);
  float wCos = cos(uWindAngle); float wSin = sin(uWindAngle);
  // Match main shader: drift in noise space (* 0.55 to stay consistent with shadow sp scale)
  vec3 sp = p / uScale * 0.55;
  sp += vec3(wCos, 0.0, wSin) * uTime * uWindSpeed * 0.3 * 0.55;
  sp += vec3(uTime * uMorphSpeed * 0.15, 0.0, -uTime * uMorphSpeed * 0.1);
  float v = 0.0, a = 0.5, fr = 1.0;
  for (int i = 0; i < 3; i++) { v += a * valueNoise(sp * fr); a *= 0.5; fr *= 2.0; }
  return max(0.0, v - (1.0 - uCoverage * 0.95)) * profile * uDensity * 2.5;
}

void main() {
  // No shadow when sun is below horizon or clouds are off
  if (uCoverage < 0.04 || uSunDir.y < 0.04) discard;

  float shadowDensity = 0.0;
  const int SHADOW_STEPS = 8;
  float slabH  = max(uCloudTop - uCloudBase, 1.0);
  float stepSz = slabH / float(SHADOW_STEPS);

  // March from ground point upward through cloud slab along sun direction
  for (int i = 0; i < SHADOW_STEPS; i++) {
    float y = uCloudBase + (float(i) + 0.5) * stepSz;
    float t = (y - vWorldPos.y) / max(uSunDir.y, 0.001);
    shadowDensity += cloudDensityFast(vWorldPos + uSunDir * t) * stepSz;
  }

  float shadow    = 1.0 - exp(-shadowDensity * 0.8);
  float darkness   = shadow * uShadowStrength;
  if (darkness < 0.01) discard;

  // MultiplyBlending: white = no change, dark = shadow
  float brightness = 1.0 - darkness;
  gl_FragColor = vec4(brightness, brightness, brightness, 1.0);
}
`;

export class VolumetricClouds {
  /**
   * @param {import('./ViewportEngine.js').ViewportEngine} vpe
   */
  constructor(vpe) {
    this._vpe        = vpe;
    this._mesh       = null;
    this._shadowMesh = null;
    this._t0         = performance.now();

    this._p = {
      enabled:             false,
      coverage:            0.45,
      density:             0.7,
      scale:               55.0,
      windSpeed:           0.4,
      windAngle:           0.0,    // radians; 0=+X(east), PI/2=+Z(south)
      cloudBase:           300.0,
      cloudTop:            600.0,
      skyMode:             true,
      shadowEnabled:       false,
      shadowStrength:      0.5,
      shadowPlaneY:        0.05,   // world Y where shadow plane sits
      bloomBrightness:     1.0,
      cloudBloomThreshold: 0.0,
      animated:            true,   // when false, uTime freezes so clouds stay in place
      morphSpeed:          0.08,   // how fast cloud shapes evolve (independent of wind drift)
      sunDir:     new THREE.Vector3(0.45, 0.87, 0.22),
      sunColor:   new THREE.Color(1.0, 0.97, 0.88),
      skyHorizon: new THREE.Color(0.55, 0.70, 0.90),
      skyZenith:  new THREE.Color(0.14, 0.37, 0.80),
    };
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  get enabled() { return !!this._p.enabled; }

  setEnabled(enabled) {
    this._p.enabled = enabled;
    if (enabled) {
      this._createMesh();
      if (this._p.shadowEnabled) this._createShadowMesh();
    } else {
      this._destroyMesh();
      this._destroyShadowMesh();
    }
  }

  /**
   * Set a cloud parameter. Special computed keys:
   *   cloudHeight    — moves whole slab (keeps thickness constant)
   *   cloudThickness — changes cloudTop (keeps base constant)
   *   windAngleDeg   — sets windAngle in degrees (0=east, 90=south)
   */
  setParam(key, value) {
    if (key === 'cloudHeight') {
      const thickness = this._p.cloudTop - this._p.cloudBase;
      this._p.cloudBase = value;
      this._p.cloudTop  = value + thickness;
    } else if (key === 'cloudThickness') {
      this._p.cloudTop = this._p.cloudBase + Math.max(10, value);
    } else if (key === 'windAngleDeg') {
      this._p.windAngle = value * (Math.PI / 180);
    } else if (key === 'morphSpeed') {
      this._p.morphSpeed = Math.max(0, value);
    } else {
      this._p[key] = value;
    }
    this._pushUniforms();
    this._pushShadowUniforms();
  }

  /** Toggle cloud shadows on/off; optionally set strength (0–1). */
  setShadows(enabled, strength) {
    this._p.shadowEnabled = enabled;
    if (strength !== undefined) this._p.shadowStrength = strength;
    if (enabled && this._p.enabled) {
      this._createShadowMesh();
    } else {
      this._destroyShadowMesh();
    }
    this._pushShadowUniforms();
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
    if (this._mesh?.material?.uniforms)
      this._mesh.material.uniforms.uSunDir.value.copy(this._p.sunDir);
    if (this._shadowMesh?.material?.uniforms)
      this._shadowMesh.material.uniforms.uSunDir.value.copy(this._p.sunDir);
  }

  /**
   * Toggle between Sky Layer mode (clouds fixed high in the sky, depth-tested)
   * and Legacy Surround mode (original: clouds wrap around the camera, no depth test).
   * Rebuilds the mesh so the material depthTest setting takes effect immediately.
   */
  setSkyMode(enabled) {
    this._p.skyMode = enabled;
    if (this._p.enabled) {
      this._destroyMesh();
      this._createMesh();
    }
  }

  /**
   * Pause or resume cloud animation.
   * When paused, uTime freezes so clouds stay in place; when resumed, time
   * continues smoothly from the frozen value.
   */
  setAnimated(v) {
    const wasAnimated = this._p.animated;
    this._p.animated = !!v;
    if (v && !wasAnimated) {
      // Resume: shift _t0 so uTime continues from where it was frozen
      const frozenT = this._mesh?.material?.uniforms?.uTime?.value ?? 0;
      this._t0 = performance.now() - frozenT * 1000;
    }
  }

  /** Call once per frame from ViewportEngine._tick(). */
  update() {
    if (!this._mesh) return;
    if (this._p.animated) {
      const t = (performance.now() - this._t0) * 0.001;
      this._mesh.material.uniforms.uTime.value = t;
      if (this._shadowMesh)
        this._shadowMesh.material.uniforms.uTime.value = t;
    }

    const cam = this._vpe?.camera;
    if (cam) {
      // Always follow camera in all 3 dimensions so the camera stays inside the BackSide
      // box regardless of altitude. Cloud heights (uCloudBase/uCloudTop) are world-space
      // uniforms in the shader — the box position doesn't affect where clouds appear.
      this._mesh.position.copy(cam.position);
    }

    if (this._shadowMesh && cam) {
      this._shadowMesh.position.set(cam.position.x, this._p.shadowPlaneY, cam.position.z);
    }
  }

  dispose() {
    this._destroyMesh();
    this._destroyShadowMesh();
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  _createMesh() {
    const scene = this._vpe?.scene;
    if (!scene) { console.warn('[VolumetricClouds] No scene — skipping create.'); return; }

    // VolumetricClouds uses ShaderMaterial (GLSL) which is not compatible with WebGPU.
    const renderer = this._vpe?.rendererManager?.renderer;
    if (renderer?.isWebGPURenderer) {
      console.warn('[VolumetricClouds] ShaderMaterial clouds are not supported in WebGPU mode. Clouds disabled.');
      return;
    }

    this._destroyMesh();

    const mat = new THREE.ShaderMaterial({
      vertexShader:   CLOUD_VERT,
      fragmentShader: CLOUD_FRAG,
      uniforms: {
        uTime:                { value: 0 },
        uCoverage:            { value: this._p.coverage },
        uDensity:             { value: this._p.density },
        uScale:               { value: this._p.scale },
        uWindSpeed:           { value: this._p.windSpeed },
        uWindAngle:           { value: this._p.windAngle },
        uSunDir:              { value: this._p.sunDir.clone() },
        uSunColor:            { value: this._p.sunColor.clone() },
        uSkyHorizon:          { value: this._p.skyHorizon.clone() },
        uSkyZenith:           { value: this._p.skyZenith.clone() },
        uCloudBase:           { value: this._p.cloudBase },
        uCloudTop:            { value: this._p.cloudTop },
        uBloomBrightness:     { value: this._p.bloomBrightness },
        uCloudBloomThreshold: { value: this._p.cloudBloomThreshold },
        uMorphSpeed:          { value: this._p.morphSpeed },
      },
      transparent: true,
      depthWrite:  false,
      depthTest:   !!this._p.skyMode,
      side:        THREE.BackSide,
    });

    const geo = new THREE.BoxGeometry(1800, 1800, 1800);
    this._mesh = new THREE.Mesh(geo, mat);
    this._mesh.name          = '__cyco_clouds';
    this._mesh.raycast       = () => {};
    this._mesh.frustumCulled = false;
    this._mesh.renderOrder   = 1;
    scene.add(this._mesh);
  }

  _createShadowMesh() {
    const scene = this._vpe?.scene;
    if (!scene) return;
    if (this._vpe?.rendererManager?.renderer?.isWebGPURenderer) return;
    this._destroyShadowMesh();

    const mat = new THREE.ShaderMaterial({
      vertexShader:   SHADOW_VERT,
      fragmentShader: SHADOW_FRAG,
      uniforms: {
        uTime:           { value: 0 },
        uCoverage:       { value: this._p.coverage },
        uDensity:        { value: this._p.density },
        uScale:          { value: this._p.scale },
        uWindSpeed:      { value: this._p.windSpeed },
        uWindAngle:      { value: this._p.windAngle },
        uSunDir:         { value: this._p.sunDir.clone() },
        uCloudBase:      { value: this._p.cloudBase },
        uCloudTop:       { value: this._p.cloudTop },
        uShadowStrength: { value: this._p.shadowStrength },
        uMorphSpeed:     { value: this._p.morphSpeed },
      },
      transparent:         true,
      depthWrite:          false,
      depthTest:           false,   // must be false to render over 3D objects, not just the ground
      blending:            THREE.CustomBlending,
      blendEquation:       THREE.AddEquation,
      blendSrc:            THREE.DstColorFactor,
      blendDst:            THREE.ZeroFactor,
    });

    // Large flat plane follows camera XZ to always cover visible ground
    const geo  = new THREE.PlaneGeometry(12000, 12000);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x    = -Math.PI / 2;
    mesh.position.y    = this._p.shadowPlaneY;
    mesh.name          = '__cyco_cloud_shadow';
    mesh.raycast       = () => {};
    mesh.frustumCulled = false;
    mesh.renderOrder   = 3;  // render after all scene objects (clouds=1) so multiply affects everything
    this._shadowMesh   = mesh;
    scene.add(this._shadowMesh);
  }

  _destroyMesh() {
    if (!this._mesh) return;
    this._vpe?.scene?.remove(this._mesh);
    this._mesh.geometry.dispose();
    this._mesh.material.dispose();
    this._mesh = null;
  }

  _destroyShadowMesh() {
    if (!this._shadowMesh) return;
    this._vpe?.scene?.remove(this._shadowMesh);
    this._shadowMesh.geometry.dispose();
    this._shadowMesh.material.dispose();
    this._shadowMesh = null;
  }

  _pushUniforms() {
    if (!this._mesh?.material?.uniforms) return;
    const u = this._mesh.material.uniforms;
    u.uCoverage.value            = this._p.coverage;
    u.uDensity.value             = this._p.density;
    u.uScale.value               = this._p.scale;
    u.uWindSpeed.value           = this._p.windSpeed;
    u.uWindAngle.value           = this._p.windAngle;
    u.uCloudBase.value           = this._p.cloudBase;
    u.uCloudTop.value            = this._p.cloudTop;
    u.uBloomBrightness.value     = this._p.bloomBrightness;
    u.uCloudBloomThreshold.value = this._p.cloudBloomThreshold;
    u.uMorphSpeed.value          = this._p.morphSpeed;
    u.uSunColor.value.copy(this._p.sunColor);
    u.uSkyHorizon.value.copy(this._p.skyHorizon);
    u.uSkyZenith.value.copy(this._p.skyZenith);
  }

  _pushShadowUniforms() {
    if (!this._shadowMesh?.material?.uniforms) return;
    const u = this._shadowMesh.material.uniforms;
    u.uCoverage.value       = this._p.coverage;
    u.uDensity.value        = this._p.density;
    u.uScale.value          = this._p.scale;
    u.uWindSpeed.value      = this._p.windSpeed;
    u.uWindAngle.value      = this._p.windAngle;
    u.uCloudBase.value      = this._p.cloudBase;
    u.uCloudTop.value       = this._p.cloudTop;
    u.uShadowStrength.value = this._p.shadowStrength;
    u.uMorphSpeed.value     = this._p.morphSpeed;
    u.uSunDir.value.copy(this._p.sunDir);
  }
}
