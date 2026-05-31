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

// ── Cloud render-quality presets ──────────────────────────────────────────────
// Each preset controls: primary ray steps, FBM base octaves, detail octaves,
// light-march steps, and max world-units per step (larger = faster but blockier).
// 'halfres'  → 'medium' quality rendered to a 1/2-res RenderTarget (Option B)
// 'impostor' → horizontal billboard planes with 2-D FBM — no ray march (Option C)
// 'compute'  → 'fast' quality rendered to a 1/4-res RenderTarget, WebGPU only (Option D)
export const CLOUD_QUALITY_CONFIGS = {
  ultra:   { steps: 48, baseOct: 6, detailOct: 3, lightSteps: 4, maxStep: 10.0 },
  high:    { steps: 32, baseOct: 5, detailOct: 2, lightSteps: 3, maxStep: 12.0 },
  medium:  { steps: 24, baseOct: 4, detailOct: 2, lightSteps: 2, maxStep: 15.0 },
  fast:    { steps: 16, baseOct: 3, detailOct: 1, lightSteps: 1, maxStep: 20.0 },
};

/** Build a GLSL fragment shader string for a given quality preset key. */
function _makeCloudFragGLSL(qKey) {
  const Q = CLOUD_QUALITY_CONFIGS[qKey] ?? CLOUD_QUALITY_CONFIGS.ultra;
  return CLOUD_FRAG_TEMPLATE
    .replace('__STEPS__',        String(Q.steps))
    .replace('__MAX_STEP_SZ__',  Q.maxStep.toFixed(1))
    .replace('__FBM_OCT__',      String(Q.baseOct))
    .replace('__LIGHT_STEPS__',  String(Q.lightSteps));
}

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
// Use _makeCloudFragGLSL(qKey) to get a quality-specific version.
const CLOUD_FRAG_TEMPLATE = /* glsl */`
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
  for (int i = 0; i < __FBM_OCT__; i++) {
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
  for (int i = 0; i < __LIGHT_STEPS__; i++) {
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
  const int   STEPS       = __STEPS__;
  const float MAX_STEP_SZ = __MAX_STEP_SZ__;
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
    this._isWebGPU   = false;  // true once WebGPU renderer detected
    this._tslTime    = 0;      // updated in update(); read by reference() nodes
    // Generation counter: incremented on every destroy so pending async creations
    // can detect they've been superseded and avoid adding orphan objects to the scene.
    this._gen        = 0;

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
      renderMode:          'ultra', // 'ultra'|'high'|'medium'|'fast'|'halfres'|'impostor'|'compute'
      sunDir:     new THREE.Vector3(0.45, 0.87, 0.22),
      sunColor:   new THREE.Color(1.0, 0.97, 0.88),
      skyHorizon: new THREE.Color(0.55, 0.70, 0.90),
      skyZenith:  new THREE.Color(0.14, 0.37, 0.80),
    };
    // Secondary state for half-res and compute RT modes
    this._halfResRT         = null;
    this._halfResScene      = null;
    this._compositeQuadMesh = null;
    this._impostorPlanes    = null;

    // Absolute cloud slab Y values used by shaders each frame.
    // For skyMode=true these equal _p.cloudBase/cloudTop (absolute world Y).
    // For skyMode=false (surround mode) these are cam.position.y + _p.cloudBase/cloudTop
    // so the slab always sits relative to the camera, not stuck at ground level.
    this._absCloudBase = this._p.cloudBase;
    this._absCloudTop  = this._p.cloudTop;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  get enabled() { return !!this._p.enabled; }

  /**
   * Switch the rendering mode. Destroys and recreates the cloud mesh.
   * @param {'ultra'|'high'|'medium'|'fast'|'halfres'|'impostor'|'compute'} mode
   */
  setRenderMode(mode) {
    if (mode === this._p.renderMode) return;
    this._p.renderMode = mode;
    if (this._p.enabled) {
      this._destroyMesh();
      this._createMesh();
    }
  }

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
    // WebGPU: reference() auto-reads this._p.sunDir each frame — no push needed.
    if (!this._isWebGPU) {
      if (this._mesh?.material?.uniforms)
        this._mesh.material.uniforms.uSunDir.value.copy(this._p.sunDir);
      if (this._shadowMesh?.material?.uniforms)
        this._shadowMesh.material.uniforms.uSunDir.value.copy(this._p.sunDir);
    }
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
      // Resume: shift _t0 so time continues from where it was frozen
      const frozenT = this._isWebGPU
        ? this._tslTime
        : (this._mesh?.material?.uniforms?.uTime?.value ?? 0);
      this._t0 = performance.now() - frozenT * 1000;
    }
  }

  /** Call once per frame from ViewportEngine._tick(). */
  update() {
    if (!this._mesh && !this._impostorPlanes?.length) return;

    const cam = this._vpe?.camera;

    // ── Animate time ────────────────────────────────────────────────────────
    if (this._p.animated) {
      const t = (performance.now() - this._t0) * 0.001;
      if (this._isWebGPU) {
        this._tslTime = t;  // reference() nodes auto-read this each frame

        // Also update GLSL impostor time uniforms when in impostor mode
        if (this._impostorPlanes?.length) {
          for (const p of this._impostorPlanes) {
            if (p.material?.uniforms?.uTime) p.material.uniforms.uTime.value = t;
          }
        }
      } else {
        if (this._mesh?.material?.uniforms)
          this._mesh.material.uniforms.uTime.value = t;
        if (this._shadowMesh?.material?.uniforms)
          this._shadowMesh.material.uniforms.uTime.value = t;
        if (this._impostorPlanes?.length) {
          for (const p of this._impostorPlanes) {
            if (p.material?.uniforms?.uTime) p.material.uniforms.uTime.value = t;
          }
        }
      }
    }

    // ── Half-res / compute RT pass ──────────────────────────────────────────
    // Render the cloud mini-scene to the reduced-resolution RT BEFORE the main
    // scene render so the composite quad has fresh data this frame.
    if (this._halfResRT && this._halfResScene && cam) {
      const renderer = this._vpe?.rendererManager?.renderer;
      if (renderer) {
        // Move cloud mesh in half-res scene to follow camera (same as primary mesh)
        if (this._mesh) this._mesh.position.copy(cam.position);

        const prevTarget    = renderer.getRenderTarget?.() ?? null;
        const prevAutoClear = renderer.autoClear;
        const prevClearAlpha = renderer.getClearAlpha?.() ?? 1;

        // CRITICAL: clear RT to fully-transparent so non-cloud pixels don't
        // overwrite the background with opaque black when composited.
        renderer.setClearAlpha(0);
        renderer.autoClear = true;
        renderer.setRenderTarget(this._halfResRT);
        renderer.render(this._halfResScene, cam);
        renderer.setRenderTarget(prevTarget);
        renderer.autoClear = prevAutoClear;
        renderer.setClearAlpha(prevClearAlpha);
      }
    }

    // ── Composite quad — position in front of camera ─────────────────────────
    if (this._compositeQuadMesh && cam) {
      const near = (cam.near ?? 0.1) + 0.002;
      const halfFovY = THREE.MathUtils.degToRad((cam.fov ?? 60) / 2);
      const h = 2 * near * Math.tan(halfFovY);
      const w = h * (cam.aspect ?? 1);
      this._compositeQuadMesh.scale.set(w, h, 1);
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
      this._compositeQuadMesh.position.copy(cam.position).addScaledVector(forward, near);
      this._compositeQuadMesh.quaternion.copy(cam.quaternion);
    }

    // ── Impostor plane positions — update each plane's world position + billboard ──
    if (this._impostorPlanes?.length && cam) {
      for (const plane of this._impostorPlanes) {
        const t = plane.userData._impPlaneT ?? 0;
        // cloudBase/cloudTop are absolute world-Y values; planes are horizontal slabs
        const worldY = this._p.cloudBase + t * (this._p.cloudTop - this._p.cloudBase);
        plane.position.set(cam.position.x, worldY, cam.position.z);
        // No billboarding — planes are horizontal (rotation.x = -PI/2 set at creation)
      }
    }

    // ── Standard box cloud mesh follows camera ───────────────────────────────
    if (this._mesh && !this._halfResRT && !this._impostorPlanes?.length && cam) {
      this._mesh.position.copy(cam.position);
    }

    // ── Compute absolute cloud slab heights ───────────────────────────────────
    // skyMode=true  → cloudBase/cloudTop are absolute world Y (high sky layer).
    // skyMode=false → treat cloudBase/cloudTop as offsets from camera Y so the
    //                 surround slab always floats around the camera, not the ground.
    if (cam) {
      if (this._p.skyMode) {
        this._absCloudBase = this._p.cloudBase;
        this._absCloudTop  = this._p.cloudTop;
      } else {
        this._absCloudBase = cam.position.y + this._p.cloudBase;
        this._absCloudTop  = cam.position.y + this._p.cloudTop;
      }
      // WebGL: push updated abs values to uniforms so the GLSL shader sees the
      // camera-relative heights (overrides the static push from _pushUniforms).
      if (!this._isWebGPU) {
        if (this._mesh?.material?.uniforms) {
          this._mesh.material.uniforms.uCloudBase.value = this._absCloudBase;
          this._mesh.material.uniforms.uCloudTop.value  = this._absCloudTop;
        }
        if (this._shadowMesh?.material?.uniforms) {
          this._shadowMesh.material.uniforms.uCloudBase.value = this._absCloudBase;
          this._shadowMesh.material.uniforms.uCloudTop.value  = this._absCloudTop;
        }
      }
      // WebGPU: reference('_absCloudBase', 'float', this) reads these per frame.
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

    // Route to WebGPU TSL implementation when running under WebGPURenderer.
    const renderer = this._vpe?.rendererManager?.renderer;
    if (renderer?.isWebGPURenderer) {
      this._createLensflareWebGPU_dispatch(scene);
      return;
    }

    // ── WebGL GLSL path ──────────────────────────────────────────────────────
    const mode = this._p.renderMode;
    if (mode === 'impostor') { this._createImpostorGLSL(scene); return; }
    // halfres + compute fall back to medium/fast for GLSL since no RT approach
    const glslQKey = (mode === 'halfres') ? 'medium' : (mode === 'compute') ? 'fast'
                   : (CLOUD_QUALITY_CONFIGS[mode] ? mode : 'ultra');
    this._destroyMesh();

    const mat = new THREE.ShaderMaterial({
      vertexShader:   CLOUD_VERT,
      fragmentShader: _makeCloudFragGLSL(glslQKey),
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
    if (this._vpe?.rendererManager?.renderer?.isWebGPURenderer) {
      this._createShadowMeshWebGPU();
      return;
    }
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
    // Invalidate any in-flight async creation so it won't add orphan objects.
    this._gen++;

    // ── Half-res / compute render target + composite quad ───────────────────
    if (this._compositeQuadMesh) {
      this._vpe?.scene?.remove(this._compositeQuadMesh);
      this._compositeQuadMesh.geometry.dispose();
      this._compositeQuadMesh.material.dispose();
      this._compositeQuadMesh = null;
    }
    if (this._halfResRT) {
      this._halfResRT.dispose();
      this._halfResRT = null;
    }
    if (this._halfResScene) {
      // Dispose all objects inside the mini-scene
      this._halfResScene.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
      });
      this._halfResScene = null;
    }

    // ── Impostor billboard planes ────────────────────────────────────────────
    if (this._impostorPlanes?.length) {
      for (const plane of this._impostorPlanes) {
        this._vpe?.scene?.remove(plane);
        plane.geometry.dispose();
        plane.material.dispose();
      }
      this._impostorPlanes = null;
    }

    // ── Standard box mesh ────────────────────────────────────────────────────
    if (this._mesh) {
      this._vpe?.scene?.remove(this._mesh);
      this._mesh.geometry.dispose();
      this._mesh.material.dispose();
      this._mesh = null;
    }
    this._isWebGPU = false;
  }

  _destroyShadowMesh() {
    if (!this._shadowMesh) return;
    this._vpe?.scene?.remove(this._shadowMesh);
    this._shadowMesh.geometry.dispose();
    this._shadowMesh.material.dispose();
    this._shadowMesh = null;
  }

  _pushUniforms() {
    if (this._isWebGPU) return;  // reference() nodes auto-read this._p each frame
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
    if (this._isWebGPU) return;  // reference() nodes auto-read this._p each frame
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

  // ── WebGPU TSL implementations ────────────────────────────────────────────

  // ── WebGPU route dispatcher (called from _createMesh when isWebGPURenderer) ──
  _createLensflareWebGPU_dispatch(scene) {
    const mode = this._p.renderMode;
    if (mode === 'impostor') {
      // WebGPURenderer (even with forceWebGL) is NodeMaterial-only; ShaderMaterial is
      // incompatible. Use the TSL NodeMaterial path (alpha already calibrated: ×2.5 / 0.45).
      this._createImpostorWebGPU(scene);
    } else if (mode === 'halfres') {
      this._createHalfResWebGPU(scene, 'medium', 2);
    } else if (mode === 'compute') {
      this._createHalfResWebGPU(scene, 'fast', 4);
    } else {
      // ultra / high / medium / fast — standard ray march at different quality
      this._destroyMesh();
      this._createMeshWebGPU(scene, mode);
    }
  }

  /**
   * Build a TSL NodeMaterial cloud mesh for WebGPU/WebGL2 renderers.
   * @param {THREE.Scene} targetScene  scene to add the mesh to
   * @param {string}      qKey         quality key ('ultra'|'high'|'medium'|'fast')
   * @returns {Promise<THREE.Mesh|null>}
   */
  async _createMeshWebGPU(targetScene, qKey = null) {
    const scn = targetScene ?? this._vpe?.scene;
    if (!scn) { console.warn('[VolumetricClouds] No scene for WebGPU clouds.'); return null; }
    this._isWebGPU = true;
    const myGen = this._gen;  // snapshot before first await

    const Q = CLOUD_QUALITY_CONFIGS[qKey ?? this._p.renderMode] ?? CLOUD_QUALITY_CONFIGS.ultra;

    try {
      const webgpuMod = await import('three/webgpu');
      const { MeshBasicNodeMaterial } = webgpuMod;
      const {
        Fn, Loop, Break, If, Discard,
        float, vec3, vec4,
        positionWorld, cameraPosition, reference,
        clamp, smoothstep, mix, normalize, dot, length, abs, max, min,
        exp, sin, cos,
        mx_fractal_noise_float,
      } = webgpuMod.TSL;

      // ── Reference nodes — auto-read from this / this._p every render frame ──
      const rTime       = reference('_tslTime',            'float', this);
      const rCoverage   = reference('coverage',            'float', this._p);
      const rDensity    = reference('density',             'float', this._p);
      const rScale      = reference('scale',               'float', this._p);
      const rWindSpeed  = reference('windSpeed',           'float', this._p);
      const rWindAngle  = reference('windAngle',           'float', this._p);
      const rMorphSpeed = reference('morphSpeed',          'float', this._p);
      const rSunDir     = reference('sunDir',              'vec3',  this._p);
      const rSunColor   = reference('sunColor',            'color', this._p);
      const rSkyHorizon = reference('skyHorizon',          'color', this._p);
      const rSkyZenith  = reference('skyZenith',           'color', this._p);
      const rCloudBase  = reference('_absCloudBase',        'float', this);
      const rCloudTop   = reference('_absCloudTop',         'float', this);
      const rBloomBrt   = reference('bloomBrightness',     'float', this._p);
      const rBloomThr   = reference('cloudBloomThreshold', 'float', this._p);

      // ── Cloud density: FBM via MaterialX fractal noise ────────────────────
      const cloudDensityFn = Fn(([p]) => {
        const h = clamp(
          p.y.sub(rCloudBase).div(max(rCloudTop.sub(rCloudBase), float(0.001))),
          float(0), float(1)
        );
        const profile = smoothstep(float(0.0), float(0.15), h)
          .mul(smoothstep(float(1.0), float(0.4), h));

        const sp  = p.div(rScale);
        const sp2 = sp.add(
          vec3(cos(rWindAngle), float(0), sin(rWindAngle))
            .mul(rTime).mul(rWindSpeed).mul(float(0.3))
        );

        // baseOct-octave FBM for large cloud shapes
        const base = mx_fractal_noise_float(sp2.mul(float(0.55)), Q.baseOct, 2.0, 0.5)
          .mul(float(0.5)).add(float(0.5));

        // detailOct-octave FBM for wisps/eroded edges
        const morphOff = vec3(
          float(4.7).add(rTime.mul(rMorphSpeed).mul(float(1.5))),
          float(9.1),
          float(2.3).sub(rTime.mul(rMorphSpeed).mul(float(1.1)))
        );
        const detail = mx_fractal_noise_float(
          sp2.mul(float(2.4)).add(morphOff), Q.detailOct, 2.0, 0.5
        ).mul(float(0.5)).add(float(0.5)).mul(float(0.28));

        const d = base.add(detail).sub(float(1.0).sub(rCoverage.mul(float(0.95))));
        return max(float(0), d).mul(profile).mul(rDensity).mul(float(2.5));
      });

      // ── Light march: Q.lightSteps samples toward sun ──────────────────────
      const lightMarchFn = Fn(([pos]) => {
        const shadow = float(0).toVar();
        const lmStep = rCloudTop.sub(rCloudBase).mul(float(0.18));
        Loop(Q.lightSteps, ({ i }) => {
          shadow.addAssign(
            cloudDensityFn(pos.add(rSunDir.mul(float(i).add(float(1)).mul(lmStep))))
          );
        });
        return exp(shadow.negate().mul(lmStep).mul(float(0.22)));
      });

      // ── Main ray-march fragment color ─────────────────────────────────────
      const colorNode = Fn(() => {
        If(rCoverage.lessThan(float(0.04)), () => { Discard(); });

        const ro = cameraPosition;
        const rd = normalize(positionWorld.sub(ro));

        // Discard near-horizontal rays; fade used per sample below
        const horizonFade = smoothstep(float(0.30), float(0.75), abs(rd.y));
        If(horizonFade.lessThan(float(0.001)), () => { Discard(); });

        const elevScale = clamp(abs(rd.y).mul(float(2.0)), float(0.0), float(1.0));

        // Infinite-slab intersection
        const invRdY = float(1.0).div(rd.y);
        const tBase  = rCloudBase.sub(ro.y).mul(invRdY);
        const tTop   = rCloudTop.sub(ro.y).mul(invRdY);
        const tNear  = min(tBase, tTop);
        const tFar   = max(tBase, tTop);
        If(tFar.lessThanEqual(float(0.0)).or(tNear.greaterThanEqual(tFar)), () => { Discard(); });

        const tStart = max(tNear, float(0.001)).toVar();
        const tEnd   = tFar.toVar();

        const STEPS = Q.steps;
        const stepSz = min(tEnd.sub(tStart).div(float(STEPS)), float(Q.maxStep)).toVar();
        tEnd.assign(min(tEnd, tStart.add(stepSz.mul(float(STEPS)))));

        const transmit  = float(1.0).toVar();
        const scattered = vec3(0, 0, 0).toVar();
        const hit       = float(0).toVar();

        Loop(STEPS, ({ i }) => {
          const t   = tStart.add(float(i).mul(stepSz));
          If(t.greaterThan(tEnd), () => { Break(); });

          const pos = ro.add(rd.mul(t));

          // Horizontal distance fade prevents hard box boundary edge
          const hDist    = length(pos.xz.sub(ro.xz));
          const distFade = float(1.0).sub(smoothstep(float(650.0), float(870.0), hDist));

          const d = cloudDensityFn(pos)
            .mul(elevScale).mul(horizonFade).mul(distFade).toVar();

          If(d.greaterThan(float(0.001)), () => {
            hit.assign(float(1));

            const ext  = d.mul(stepSz);
            const beer = exp(ext.negate().mul(float(0.9)));

            const sunAtten = lightMarchFn(pos);

            // Vertical sky-color ambient
            const hFrac = clamp(
              pos.y.sub(rCloudBase).div(max(rCloudTop.sub(rCloudBase), float(0.001))),
              float(0), float(1)
            );
            const ambient = mix(rSkyHorizon.rgb, rSkyZenith.rgb, hFrac).mul(float(0.3));

            // Forward-scatter silver lining
            const cosA    = dot(rd, rSunDir);
            const phase   = float(0.5).add(cosA.mul(float(0.45)));
            const cloudLit = rSunColor.rgb
              .mul(sunAtten)
              .mul(float(0.65).add(phase.mul(float(0.35))))
              .add(ambient).toVar();

            // Powder effect: subtle darkening on first contact
            const powder = float(1.0).sub(exp(d.negate().mul(stepSz).mul(float(1.5))));
            cloudLit.mulAssign(mix(float(1.0), powder.mul(float(1.8)), float(0.35)));

            scattered.addAssign(cloudLit.mul(transmit).mul(float(1.0).sub(beer)));
            transmit.mulAssign(beer);

            If(transmit.lessThan(float(0.005)), () => { Break(); });
          });
        });

        If(hit.lessThan(float(0.5)), () => { Discard(); });

        const alpha = clamp(float(1.0).sub(transmit), float(0.0), float(1.0));
        If(alpha.lessThan(float(0.005)), () => { Discard(); });

        // Pre-multiplied → per-channel colour
        const cloudColor = scattered.div(max(alpha, float(0.01))).toVar();

        // Per-cloud bloom threshold filter
        const lum = dot(cloudColor, vec3(float(0.2126), float(0.7152), float(0.0722)));
        If(lum.lessThan(rBloomThr), () => { cloudColor.assign(vec3(0, 0, 0)); });
        cloudColor.mulAssign(rBloomBrt);

        return vec4(cloudColor, alpha);
      })();

      const mat = new MeshBasicNodeMaterial({
        transparent: true,
        depthWrite:  false,
        depthTest:   !!this._p.skyMode,
        side:        THREE.BackSide,
      });
      mat.colorNode = colorNode;
      // Push every cloud fragment to depth 1.0 (far plane) so opaque objects
      // always appear in front when depthTest is enabled (sky-layer mode).
      if (this._p.skyMode) mat.depthNode = float(1.0);

      const geo = new THREE.BoxGeometry(1800, 1800, 1800);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name          = '__cyco_clouds';
      mesh.raycast       = () => {};
      mesh.frustumCulled = false;
      mesh.renderOrder   = 1;

      // Guard: if _destroyMesh() was called while we were awaiting, discard this mesh.
      if (this._gen !== myGen) {
        geo.dispose(); mat.dispose();
        return null;
      }

      scn.add(mesh);

      // Only track as primary mesh when added to the main scene
      if (scn === this._vpe?.scene) this._mesh = mesh;

      console.log('[VolumetricClouds] WebGPU TSL cloud mesh ready (quality:', qKey ?? this._p.renderMode, ').');
      return mesh;
    } catch (err) {
      console.error('[VolumetricClouds] WebGPU cloud mesh creation failed:', err);
      this._isWebGPU = false;
      return null;
    }
  }

  /**
   * Option B / Option D  —  Render clouds at reduced resolution into a WebGLRenderTarget,
   * then composite back into the main scene via a camera-facing quad.
   * @param {THREE.Scene} mainScene  the viewport's main scene (composite quad added here)
   * @param {string}      qKey       quality preset for the cloud pass
   * @param {number}      divisor    2 = half-res (Option B), 4 = quarter-res (Option D)
   */
  async _createHalfResWebGPU(mainScene, qKey, divisor) {
    this._destroyMesh();
    this._isWebGPU = true;
    const myGen = this._gen;  // snapshot after destroy, before awaits

    const renderer = this._vpe?.rendererManager?.renderer;
    const canvas   = renderer?.domElement;
    if (!renderer || !canvas) {
      console.warn('[VolumetricClouds] Half-res: no renderer, falling back to ray-march.');
      return this._createMeshWebGPU(mainScene, qKey);
    }

    // Use actual backing-store pixel size so 1/divisor is a true resolution reduction
    const w = Math.max(1, Math.floor((canvas.width  || canvas.clientWidth)  / divisor));
    const h = Math.max(1, Math.floor((canvas.height || canvas.clientHeight) / divisor));

    this._halfResRT = new THREE.WebGLRenderTarget(w, h, {
      minFilter:   THREE.LinearFilter,
      magFilter:   THREE.LinearFilter,
      type:        THREE.HalfFloatType,
      format:      THREE.RGBAFormat,
      depthBuffer: true,   // need depth buffer so material depthTest works reliably
    });

    // Separate mini-scene that contains only the cloud box
    this._halfResScene = new THREE.Scene();
    const cloudMesh = await this._createMeshWebGPU(this._halfResScene, qKey);
    if (!cloudMesh || this._gen !== myGen) {
      // Superseded by a newer setRenderMode call — clean up and bail.
      // NOTE: Only dispose the cloudMesh we just created (it was never added to any
      // live scene at this point). Do NOT touch this._halfResRT or this._halfResScene
      // here: _destroyMesh() was already called (which incremented _gen and disposed
      // the stale RT), and the newer call may have already set fresh values for
      // _halfResRT/_halfResScene. Nullifying them here would destroy the valid state
      // of the concurrent newer call, causing a null-dereference crash.
      cloudMesh?.geometry?.dispose();
      cloudMesh?.material?.dispose();
      return;
    }
    // In the isolated RT scene there is no other geometry — force depthTest off
    // so the cloud box always renders regardless of depth buffer state.
    if (cloudMesh.material) cloudMesh.material.depthTest = false;
    // Track mesh so enabled checks work
    this._mesh = cloudMesh;

    // Full-screen camera-facing quad.  PlaneGeometry(1,1) has local vertices at ±0.5;
    // after scale(w, h, 1) in update() the quad exactly fills the near frustum rectangle.
    // (PlaneGeometry(2,2) would be 2× the frustum — clouds end up in wrong position.)
    const quadGeo = new THREE.PlaneGeometry(1, 1);
    // WebGPURenderer (even forceWebGL) renders into a render target with the y-axis
    // inverted relative to the canvas framebuffer.  Flip the UV V-coordinate so that
    // the RT sky content (rendered at GL y=0 in the RT) maps to the top of the quad.
    const uvAttr = quadGeo.attributes.uv;
    for (let i = 0; i < uvAttr.count; i++) uvAttr.setY(i, 1 - uvAttr.getY(i));
    uvAttr.needsUpdate = true;
    const quadMat = new THREE.MeshBasicMaterial({
      map:         this._halfResRT.texture,
      transparent: true,
      blending:    THREE.NormalBlending,  // respect alpha channel from RT
      depthTest:   false,
      depthWrite:  false,
    });
    this._compositeQuadMesh = new THREE.Mesh(quadGeo, quadMat);
    this._compositeQuadMesh.name          = '__cyco_clouds_composite';
    this._compositeQuadMesh.frustumCulled = false;
    this._compositeQuadMesh.renderOrder   = 1;
    this._compositeQuadMesh.raycast       = () => {};
    mainScene.add(this._compositeQuadMesh);

    console.log(`[VolumetricClouds] Half-res (1/${divisor}) WebGPU cloud ready (quality: ${qKey}).`);
  }

  /**
   * Option C  —  Replace the ray-marcher with a stack of horizontal billboard planes,
   * each shaded with a simple 2-D FBM noise.  ~10x cheaper than the ray march.
   * @param {THREE.Scene} mainScene
   */
  async _createImpostorWebGPU(mainScene) {
    this._destroyMesh();
    this._isWebGPU    = true;
    this._impostorPlanes = [];
    const myGen = this._gen;  // snapshot after destroy, before awaits

    try {
      const webgpuMod = await import('three/webgpu');
      const { MeshBasicNodeMaterial } = webgpuMod;
      const {
        Fn, If, Discard,
        float, uniform, vec3, vec4,
        positionWorld, reference,
        clamp, smoothstep, mix, max, cos, sin,
        mx_fractal_noise_float,
      } = webgpuMod.TSL;

      const NUM_PLANES = 8;
      // Alpha calibration: default coverage gives mean cloud density ≈ 0.075 per step.
      // Multiply by 2.5 so average pixels hit ~0.19 alpha, dense cores hit the 0.45 cap.
      // Combined across 8 layers: 1-(1-0.19)^8 ≈ 0.80 opacity — clearly visible.
      const ALPHA_SCALE = 2.5;
      const ALPHA_MAX   = 0.45;

      for (let pi = 0; pi < NUM_PLANES; pi++) {
        const planeT = pi / (NUM_PLANES - 1);
        // Use uniform() instead of float() so pT is a GPU uniform, not a baked
        // ConstNode.  TSL reuses the same compiled program for all 8 planes but
        // uploads a different pT value per draw — avoids the ConstNode hash-
        // collision that caused TSL to bake pT=0 into every plane's shader.
        const pT     = uniform(planeT, 'float');
        const rTime       = reference('_tslTime',        'float', this);
        const rCoverage   = reference('coverage',        'float', this._p);
        const rDensity    = reference('density',         'float', this._p);
        const rScale      = reference('scale',           'float', this._p);
        const rWindSpeed  = reference('windSpeed',       'float', this._p);
        const rWindAngle  = reference('windAngle',       'float', this._p);
        const rSunDir     = reference('sunDir',          'vec3',  this._p);
        const rSunColor   = reference('sunColor',        'color', this._p);
        const rSkyHorizon = reference('skyHorizon',      'color', this._p);
        const rSkyZenith  = reference('skyZenith',       'color', this._p);
        const rBloomBrt   = reference('bloomBrightness', 'float', this._p);

        const colorNode = Fn(() => {
          If(rCoverage.lessThan(float(0.04)), () => { Discard(); });

          // 2-D wind drift in XZ plane
          const xz = positionWorld.xz.div(rScale);
          const drift = vec3(cos(rWindAngle), float(0), sin(rWindAngle))
            .mul(rTime).mul(rWindSpeed).mul(float(0.3));
          const dXZ = vec3(xz.x.add(drift.x), float(0), xz.y.add(drift.z));

          // 4-octave 2-D FBM (Y=0 keeps noise in a horizontal slice)
          const base = mx_fractal_noise_float(dXZ.mul(float(0.55)), 4, 2.0, 0.5)
            .mul(float(0.5)).add(float(0.5));
          const detail = mx_fractal_noise_float(dXZ.mul(float(2.4)), 2, 2.0, 0.5)
            .mul(float(0.5)).add(float(0.5)).mul(float(0.25));

          const d = base.add(detail).sub(float(1.0).sub(rCoverage.mul(float(0.95))));

          // Vertical profile: rounded top, faded base
          const profile = smoothstep(float(0.0), float(0.25), pT)
            .mul(smoothstep(float(1.0), float(0.3), pT));

          const density = max(float(0), d).mul(profile).mul(rDensity).mul(float(2.5));
          If(density.lessThan(float(0.001)), () => { Discard(); });

          // Simple directional lighting
          const ambient  = mix(rSkyHorizon.rgb, rSkyZenith.rgb, pT).mul(float(0.3));
          const cosA     = float(0.5).add(rSunDir.y.mul(float(0.5)));
          const cloudLit = rSunColor.rgb.mul(cosA).mul(float(0.8)).add(ambient);

          // Scale density to visible alpha — much more generous than ray-march accumulation
          const alpha = clamp(density.mul(float(ALPHA_SCALE)), float(0), float(ALPHA_MAX));
          return vec4(cloudLit.mul(rBloomBrt), alpha);
        })();

        const mat = new MeshBasicNodeMaterial({
          transparent: true,
          depthWrite:  false,
          depthTest:   !!this._p.skyMode,
          side:        THREE.DoubleSide,
          blending:    THREE.NormalBlending,
        });
        mat.colorNode = colorNode;

        const geo  = new THREE.PlaneGeometry(1800, 1800);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.rotation.x    = -Math.PI / 2;  // horizontal slab — same as GLSL path
        mesh.raycast       = () => {};
        mesh.frustumCulled = false;
        mesh.renderOrder   = 1;
        mesh.name          = `__cyco_cloud_imp_${pi}`;
        mesh.userData._isHelper  = true;
        mesh.userData._impPlaneT = planeT;

        // Guard: if superseded, discard all planes created so far and bail.
        if (this._gen !== myGen) {
          geo.dispose(); mat.dispose();
          for (const p of this._impostorPlanes) {
            mainScene.remove(p); p.geometry.dispose(); p.material.dispose();
          }
          this._impostorPlanes = null;
          return;
        }

        mainScene.add(mesh);
        this._impostorPlanes.push(mesh);
      }

      // Point primary mesh ref to first plane so the existing enabled checks work
      this._mesh = this._impostorPlanes[0];
      console.log('[VolumetricClouds] Impostor billboard clouds ready (8 planes).');
    } catch (err) {
      console.error('[VolumetricClouds] Impostor creation failed:', err);
      this._impostorPlanes = null;
      this._isWebGPU = false;
    }
  }

  /** WebGL fallback for impostor mode — 8 flat planes with a simple GLSL 2-D FBM shader. */
  _createImpostorGLSL(mainScene) {
    this._destroyMesh();
    this._impostorPlanes = [];

    const VERT = /* glsl */`
      varying vec3 vWorldPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `;
    const FRAG = /* glsl */`
      precision highp float;
      uniform float uTime, uCoverage, uDensity, uScale, uWindSpeed, uWindAngle;
      uniform vec3  uSunDir, uSunColor, uSkyHorizon, uSkyZenith;
      uniform float uBloomBrt, uPlaneT;
      varying vec3 vWorldPos;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      float noise2d(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i+vec2(1,0)), u.x),
                   mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y);
      }
      float fbm2d(vec2 p) {
        float v=0.0, a=0.5, f=1.0;
        for (int i=0; i<4; i++) { v += a*noise2d(p*f); a*=0.5; f*=2.1; }
        return v;
      }
      void main() {
        if (uCoverage < 0.04) discard;
        vec2 xz    = vWorldPos.xz / uScale;
        vec2 drift = vec2(cos(uWindAngle), sin(uWindAngle)) * uTime * uWindSpeed * 0.3;
        float base   = fbm2d((xz + drift) * 0.55);
        float detail = fbm2d((xz + drift) * 2.4) * 0.25;
        float d = base + detail - (1.0 - uCoverage * 0.95);
        float profile = smoothstep(0.0, 0.25, uPlaneT) * smoothstep(1.0, 0.3, uPlaneT);
        float density = max(0.0, d) * profile * uDensity * 2.5;
        if (density < 0.001) discard;
        vec3 ambient  = mix(uSkyHorizon, uSkyZenith, uPlaneT) * 0.3;
        float cosA    = 0.5 + uSunDir.y * 0.5;
        vec3 cloudLit = uSunColor * cosA * 0.8 + ambient;
        // Same alpha calibration as TSL path: scale × 2.5, cap at 0.45
        // Combined 8 layers → clearly visible cloud mass
        float alpha   = clamp(density * 2.5, 0.0, 0.45);
        gl_FragColor  = vec4(cloudLit * uBloomBrt, alpha);
      }
    `;

    const NUM_PLANES = 8;
    for (let pi = 0; pi < NUM_PLANES; pi++) {
      const planeT = pi / (NUM_PLANES - 1);
      const mat = new THREE.ShaderMaterial({
        vertexShader:   VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite:  false,
        side:        THREE.DoubleSide,
        uniforms: {
          uTime:       { value: 0 },
          uCoverage:   { value: this._p.coverage },
          uDensity:    { value: this._p.density },
          uScale:      { value: this._p.scale },
          uWindSpeed:  { value: this._p.windSpeed },
          uWindAngle:  { value: this._p.windAngle },
          uSunDir:     { value: this._p.sunDir },
          uSunColor:   { value: this._p.sunColor },
          uSkyHorizon: { value: this._p.skyHorizon },
          uSkyZenith:  { value: this._p.skyZenith },
          uBloomBrt:   { value: this._p.bloomBrightness },
          uPlaneT:     { value: planeT },
        },
      });
      const geo  = new THREE.PlaneGeometry(1800, 1800);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x    = -Math.PI / 2;
      mesh.raycast       = () => {};
      mesh.frustumCulled = false;
      mesh.renderOrder   = 1;
      mesh.name          = `__cyco_cloud_imp_${pi}`;
      mesh.userData._isHelper  = true;
      mesh.userData._impPlaneT = planeT;
      mainScene.add(mesh);
      this._impostorPlanes.push(mesh);
    }
    this._mesh = this._impostorPlanes[0];
    console.log('[VolumetricClouds] Impostor GLSL billboard clouds ready.');
  }

  /**
   * Build a TSL NodeMaterial shadow plane for WebGPU/WebGL2 renderers.
   * Marches upward from each ground fragment toward the sun and accumulates
   * cloud density to produce a multiply-blended shadow on the ground.
   */
  async _createShadowMeshWebGPU() {
    const scene = this._vpe?.scene;
    if (!scene) return;
    this._destroyShadowMesh();

    try {
      const webgpuMod = await import('three/webgpu');
      const { MeshBasicNodeMaterial } = webgpuMod;
      const {
        Fn, Loop, If, Discard,
        float, vec3, vec4,
        positionWorld, reference,
        clamp, smoothstep, max, min, exp, sin, cos,
        mx_fractal_noise_float,
      } = webgpuMod.TSL;

      const rTime       = reference('_tslTime',       'float', this);
      const rCoverage   = reference('coverage',       'float', this._p);
      const rDensity    = reference('density',        'float', this._p);
      const rScale      = reference('scale',          'float', this._p);
      const rWindSpeed  = reference('windSpeed',      'float', this._p);
      const rWindAngle  = reference('windAngle',      'float', this._p);
      const rMorphSpeed = reference('morphSpeed',     'float', this._p);
      const rSunDir     = reference('sunDir',         'vec3',  this._p);
      const rCloudBase  = reference('_absCloudBase', 'float', this);
      const rCloudTop   = reference('_absCloudTop',  'float', this);
      const rShadowStr  = reference('shadowStrength', 'float', this._p);

      // Fast 3-octave density (shadow pass does not need full 6-octave detail)
      const cloudDensityFastFn = Fn(([p]) => {
        const h = clamp(
          p.y.sub(rCloudBase).div(max(rCloudTop.sub(rCloudBase), float(0.001))),
          float(0), float(1)
        );
        const profile = smoothstep(float(0.0), float(0.15), h)
          .mul(smoothstep(float(1.0), float(0.4), h));

        const sp  = p.div(rScale);
        const sp2 = sp.add(
          vec3(cos(rWindAngle), float(0), sin(rWindAngle))
            .mul(rTime).mul(rWindSpeed).mul(float(0.3))
        );
        const v = mx_fractal_noise_float(sp2.mul(float(0.55)), 3, 2.0, 0.5)
          .mul(float(0.5)).add(float(0.5));
        const d = v.sub(float(1.0).sub(rCoverage.mul(float(0.95))));
        return max(float(0), d).mul(profile).mul(rDensity).mul(float(2.5));
      });

      const colorNode = Fn(() => {
        // No shadow when sun below horizon or clouds off
        If(rCoverage.lessThan(float(0.04)).or(rSunDir.y.lessThan(float(0.04))), () => {
          Discard();
        });

        const worldPos      = positionWorld;
        const shadowDensity = float(0).toVar();
        const slabH         = max(rCloudTop.sub(rCloudBase), float(1.0));
        const stepSz        = slabH.div(float(8));

        Loop(8, ({ i }) => {
          const y = rCloudBase.add(float(i).add(float(0.5)).mul(stepSz));
          const t = y.sub(worldPos.y).div(max(rSunDir.y, float(0.001)));
          shadowDensity.addAssign(
            cloudDensityFastFn(worldPos.add(rSunDir.mul(t))).mul(stepSz)
          );
        });

        const shadow   = float(1.0).sub(exp(shadowDensity.negate().mul(float(0.8))));
        const darkness = shadow.mul(rShadowStr);
        If(darkness.lessThan(float(0.01)), () => { Discard(); });

        const brightness = float(1.0).sub(darkness);
        return vec4(brightness, brightness, brightness, float(1.0));
      })();

      const mat = new MeshBasicNodeMaterial({
        transparent:   true,
        depthWrite:    false,
        depthTest:     false,
        blending:      THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc:      THREE.DstColorFactor,
        blendDst:      THREE.ZeroFactor,
      });
      mat.colorNode = colorNode;

      const geo  = new THREE.PlaneGeometry(12000, 12000);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x    = -Math.PI / 2;
      mesh.position.y    = this._p.shadowPlaneY;
      mesh.name          = '__cyco_cloud_shadow';
      mesh.raycast       = () => {};
      mesh.frustumCulled = false;
      mesh.renderOrder   = 3;
      this._shadowMesh   = mesh;
      scene.add(this._shadowMesh);

      console.log('[VolumetricClouds] WebGPU TSL shadow mesh ready.');
    } catch (err) {
      console.error('[VolumetricClouds] WebGPU shadow mesh creation failed:', err);
    }
  }
}
