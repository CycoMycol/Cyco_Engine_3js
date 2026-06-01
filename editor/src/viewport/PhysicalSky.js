/**
 * PhysicalSky.js
 * Physically-based sky using THREE.Sky (Preetham / Hosek-Wilkie atmospheric scattering).
 * WebGL-only — falls back to gradient sky when WebGPU is active.
 *
 * Public API mirrors GradientSky.js for god-rays compatibility:
 *   setEnabled(bool)
 *   setParams(opts)
 *   update()
 *   dispose()
 *   get enabled()
 *   get sunLight()
 *   _mesh            — the Sky mesh (alias for GodRays occluder support)
 *   _mainMat         — the Hosek-Wilkie ShaderMaterial
 *   _occluderMat     — simple sun-disc occluder for god rays
 *   _p.sunDir        — current sun direction Vector3
 */

import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { Lensflare, LensflareElement } from 'three/addons/objects/Lensflare.js';

// ── Occluder shaders (same vertex layout as GradientSky) ─────────────────────

const PHYS_OCCLUDER_VERT = /* glsl */`
varying vec3 vLocalPos;
void main() {
  vLocalPos = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position.z = gl_Position.w;
}
`;

const PHYS_OCCLUDER_FRAG = /* glsl */`
precision highp float;
uniform vec3  uSunDir;
uniform float uSunInner;
uniform float uSunOuter;
uniform float uSunVisible;
varying vec3 vLocalPos;
void main() {
  vec3  dir    = normalize(vLocalPos);
  float sunDot = dot(dir, normalize(uSunDir));
  float disc   = smoothstep(uSunOuter, uSunInner, sunDot) * uSunVisible;
  gl_FragColor = vec4(vec3(disc), 1.0);
}
`;

// Sun disc angular radius: inner = 1.5°, outer = 2.5° (soft fringe)
const SUN_INNER = Math.cos(THREE.MathUtils.degToRad(1.5));
const SUN_OUTER = Math.cos(THREE.MathUtils.degToRad(2.5));

// ─────────────────────────────────────────────────────────────────────────────

export class PhysicalSky {
  constructor(viewportEngine) {
    this._vpe      = viewportEngine;
    this._sky      = null;   // THREE.Sky instance (also a Mesh)
    this._mesh     = null;   // alias → this._sky (for GodRays compatibility)
    this._mainMat  = null;   // sky.material (Hosek-Wilkie ShaderMaterial)
    this._occluderMat = null;
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
      sunDir:          new THREE.Vector3(),
    };

    this._updateDirs();
    this._initSunLight();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  get enabled()  { return this._enabled; }
  get sunLight() { return this._sunLight; }

  setEnabled(v) {
    v = !!v;
    if (v === this._enabled) return;
    this._enabled = v;
    if (v) {
      this._createSky();
    } else {
      this._destroySky();
    }
  }

  setParams(opts = {}) {
    if (opts.elevation        !== undefined) this._p.elevation        = opts.elevation;
    if (opts.azimuth          !== undefined) this._p.azimuth          = opts.azimuth;
    if (opts.turbidity        !== undefined) this._p.turbidity        = opts.turbidity;
    if (opts.rayleigh         !== undefined) this._p.rayleigh         = opts.rayleigh;
    if (opts.mieCoefficient   !== undefined) this._p.mieCoefficient   = opts.mieCoefficient;
    if (opts.mieDirectionalG  !== undefined) this._p.mieDirectionalG  = opts.mieDirectionalG;
    if (opts.exposure         !== undefined) this._p.exposure         = opts.exposure;
    if (opts.showSun          !== undefined) this._p.showSun          = opts.showSun;

    this._updateDirs();
    this._pushUniforms();
    this._updateSunLight();
    this._updateLensflare();
  }

  /** Call each frame (follows camera position). */
  update() {
    if (!this._sky) return;
    const cam = this._vpe?.camera;
    if (cam) this._sky.position.copy(cam.position);
    this._updateLensflare();
  }

  dispose() {
    this._destroySky();
    if (this._sunLight) {
      this._vpe?.scene?.remove(this._sunLight);
      this._sunLight = null;
    }
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  _createSky() {
    const scene = this._vpe?.scene;
    if (!scene) return;
    this._destroySky();

    const sky = new Sky();
    sky.scale.setScalar(450000);
    sky.name          = '__cyco_physical_sky';
    sky.renderOrder   = -1;
    sky.raycast       = () => {};
    sky.userData._isHelper = true;

    // Disable built-in 2D sky clouds (we use the dedicated VolumetricClouds system)
    sky.material.uniforms.cloudCoverage.value = 0.0;

    // === Direct fragment shader patch (works for WebGL, WebGL2, and WebGPU) ===
    // onBeforeCompile is a WebGL-only hook and may not fire in the TSL pipeline,
    // so we patch the GLSL source string directly before any compilation occurs.
    // Changes:
    //   1. Clamp HDR sun disc (prevents bloom explosion — sun was ~1M luminance)
    //   2. Fill lower hemisphere with a warm ground colour (prevents pitch-black nadir)
    sky.material.fragmentShader = sky.material.fragmentShader.replace(
      'gl_FragColor = vec4( texColor, 1.0 );',
      /* glsl */`
        // 1. Clamp HDR sun disc so bloom stays proportionate
        vec3 finalColor = min(texColor, vec3(4.5));

        // 2. Lower hemisphere fill — blend to warm ground colour below the horizon
        float belowH = max(0.0, -direction.y);
        if (belowH > 0.001) {
          float t = smoothstep(0.0, 0.15, belowH);
          float sunH = max(0.0, vSunDirection.y);
          vec3 groundDay    = vec3(0.17, 0.14, 0.10);
          vec3 groundSunset = vec3(0.22, 0.08, 0.02) * max(0.0, 1.0 - sunH * 4.0);
          vec3 groundColor  = (groundDay + groundSunset) * (vSunE * 0.000005 + 0.04);
          finalColor = mix(finalColor, groundColor, t);
        }

        gl_FragColor = vec4(finalColor, 1.0);`
    );
    sky.material.needsUpdate = true;

    this._sky     = sky;
    this._mesh    = sky;
    this._mainMat = sky.material;

    // Follow camera position so the sky is always centred on the viewer
    const cam = this._vpe?.camera;
    if (cam) sky.position.copy(cam.position);

    this._pushUniforms();
    this._occluderMat = this._createOccluderMaterial();

    scene.add(sky);
    this._createLensflare(scene);
    this._updateSunLight();
  }

  _destroySky() {
    const scene = this._vpe?.scene;
    if (this._sky) {
      scene?.remove(this._sky);
      this._sky.geometry.dispose();
      this._sky.material.dispose();
      this._sky    = null;
      this._mesh   = null;
      this._mainMat = null;
    }
    if (this._occluderMat) {
      this._occluderMat.dispose();
      this._occluderMat = null;
    }
    if (this._lensflare) {
      scene?.remove(this._lensflare);
      this._lensflare = null;
    }
  }

  /** Create a DirectionalLight that represents the physical sun. */
  _initSunLight() {
    this._sunLight = new THREE.DirectionalLight(0xfff5e0, 0.0);
    this._sunLight.name = '__cyco_physical_sun_light';
    this._sunLight.castShadow = true;
    this._sunLight.shadow.mapSize.set(2048, 2048);
    this._sunLight.shadow.camera.near   = 0.5;
    this._sunLight.shadow.camera.far    = 500;
    this._sunLight.shadow.camera.left   = -100;
    this._sunLight.shadow.camera.right  = 100;
    this._sunLight.shadow.camera.top    = 100;
    this._sunLight.shadow.camera.bottom = -100;

    const scene = this._vpe?.scene;
    if (scene) scene.add(this._sunLight);
  }

  /** Recompute spherical-to-cartesian sun direction from elevation + azimuth. */
  _updateDirs() {
    const phi   = THREE.MathUtils.degToRad(90 - this._p.elevation);
    const theta = THREE.MathUtils.degToRad(this._p.azimuth);
    this._p.sunDir.setFromSphericalCoords(1, phi, theta);
  }

  /** Push Hosek-Wilkie uniforms to the sky material. */
  _pushUniforms() {
    if (!this._sky) return;
    const u = this._sky.material.uniforms;
    u['turbidity'].value        = this._p.turbidity;
    u['rayleigh'].value         = this._p.rayleigh;
    u['mieCoefficient'].value   = this._p.mieCoefficient;
    u['mieDirectionalG'].value  = this._p.mieDirectionalG;
    u['sunPosition'].value.copy(this._p.sunDir);
    u['up'].value.set(0, 1, 0);
    u['showSunDisc'].value = this._p.showSun ? 1 : 0;

    // Sync occluder material sun direction
    if (this._occluderMat) {
      this._occluderMat.uniforms.uSunDir.value.copy(this._p.sunDir);
      this._occluderMat.uniforms.uSunVisible.value = (this._p.elevation > -6) ? 1.0 : 0.0;
    }
  }

  /** Update sun light position + intensity based on elevation. */
  _updateSunLight() {
    if (!this._sunLight) return;
    const scene = this._vpe?.scene;
    if (scene && !scene.children.includes(this._sunLight)) {
      scene.add(this._sunLight);
    }

    // Position the light in the sun direction (far away)
    this._sunLight.position.copy(this._p.sunDir).multiplyScalar(100);
    this._sunLight.target.position.set(0, 0, 0);
    if (this._sunLight.target.parent !== scene && scene) scene.add(this._sunLight.target);

    const sunVisible = this._p.elevation > -6;
    if (!sunVisible) {
      this._sunLight.intensity = 0;
      return;
    }

    // Smooth ramp: t = 0 at elevation -5°, t = 1 at elevation +15°
    const t = Math.min(1, Math.max(0, (this._p.elevation + 5) / 20));
    const smoothT = t * t * (3 - 2 * t); // smoothstep
    this._sunLight.intensity = 2.0 * smoothT;
    this._sunLight.visible   = true;
  }

  /** Build occluder material that renders only the sun disc as white. */
  _createOccluderMaterial() {
    return new THREE.ShaderMaterial({
      uniforms: {
        uSunDir:     { value: this._p.sunDir.clone() },
        uSunInner:   { value: SUN_INNER },
        uSunOuter:   { value: SUN_OUTER },
        uSunVisible: { value: (this._p.elevation > -6) ? 1.0 : 0.0 },
      },
      vertexShader:   PHYS_OCCLUDER_VERT,
      fragmentShader: PHYS_OCCLUDER_FRAG,
      side:       THREE.BackSide,
      depthTest:  false,
      depthWrite: false,
    });
  }

  /** Create a simple lens flare at the sun position (WebGL-compatible). */
  _createLensflare(scene) {
    if (this._lensflare) {
      scene.remove(this._lensflare);
      this._lensflare = null;
    }

    const flare = new Lensflare();
    const tex0  = this._makeFlareTex(256);  // main glow
    const tex1  = this._makeFlareTex(64);   // ghost

    flare.addElement(new LensflareElement(tex0, 700, 0.0, new THREE.Color(1.0, 0.95, 0.85)));
    flare.addElement(new LensflareElement(tex1, 60, 0.6));
    flare.addElement(new LensflareElement(tex1, 40, 0.8));

    // Position the flare far in the sun direction
    flare.position.copy(this._p.sunDir).multiplyScalar(4e5);
    flare.userData._isHelper = true;

    this._lensflare = flare;
    scene.add(flare);
  }

  /** Update lensflare position each frame / on param change. */
  _updateLensflare() {
    if (this._lensflare) {
      this._lensflare.position.copy(this._p.sunDir).multiplyScalar(4e5);
      this._lensflare.visible = this._p.showSun && this._p.elevation > -6;
    }
  }

  /**
   * Compute atmospheric sky colours for cloud ambient lighting.
   * Returns colours tuned to match the Hosek-Wilkie sky at the current sun elevation.
   * @returns {{ sunColor: THREE.Color, horizon: THREE.Color, zenith: THREE.Color }}
   */
  getSkyColors() {
    const el  = this._p.elevation;          // degrees, roughly -90 to 90
    const elN = Math.max(-1, Math.min(1, el / 90)); // normalised -1…+1

    // Sunset/sunrise factor: peaks when sun is near the horizon (-5° … +15°)
    const sunsetT = Math.max(0, 1.0 - Math.abs(elN) * 5.0);
    // Daytime factor: ramps up from 0° to 20°
    const dayT    = Math.min(1.0, Math.max(0, elN * 4.5));
    // Night factor: below horizon
    const nightT  = Math.max(0, -elN);

    // ── Sun colour ───────────────────────────────────────────────────────────
    // Day: warm white  |  Sunset: deep orange  |  Night: cold blue
    const sunR = Math.min(1, 1.0 * dayT + 1.0  * sunsetT + 0.20 * nightT);
    const sunG = Math.min(1, 0.97 * dayT + 0.45 * sunsetT + 0.20 * nightT);
    const sunB = Math.min(1, 0.88 * dayT + 0.05 * sunsetT + 0.45 * nightT);

    // ── Horizon colour ───────────────────────────────────────────────────────
    // Day: pale sky blue  |  Sunset: orange-red  |  Night: dark navy
    const hR = Math.min(1, 0.65 * dayT + 1.00 * sunsetT + 0.05 * nightT);
    const hG = Math.min(1, 0.75 * dayT + 0.35 * sunsetT + 0.06 * nightT);
    const hB = Math.min(1, 0.95 * dayT + 0.05 * sunsetT + 0.18 * nightT);

    // ── Zenith colour ────────────────────────────────────────────────────────
    // Day: deep blue  |  Sunset: violet/purple  |  Night: near-black
    const zR = Math.min(1, 0.22 * dayT + 0.35 * sunsetT + 0.01 * nightT);
    const zG = Math.min(1, 0.44 * dayT + 0.10 * sunsetT + 0.01 * nightT);
    const zB = Math.min(1, 0.85 * dayT + 0.30 * sunsetT + 0.06 * nightT);

    return {
      sunColor: new THREE.Color(sunR, sunG, sunB),
      horizon:  new THREE.Color(hR, hG, hB),
      zenith:   new THREE.Color(zR, zG, zB),
    };
  }

  /**
   * Create a radial-gradient canvas texture for use as a lens flare element.
   * @param {number} size Canvas width/height in pixels.
   * @returns {THREE.Texture}
   */
  _makeFlareTex(size) {
    const canvas = document.createElement('canvas');
    canvas.width  = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const r   = size / 2;
    const grad = ctx.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0,    'rgba(255,255,255,1)');
    grad.addColorStop(0.15, 'rgba(255,240,200,0.8)');
    grad.addColorStop(0.5,  'rgba(255,200,100,0.2)');
    grad.addColorStop(1,    'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }
}
