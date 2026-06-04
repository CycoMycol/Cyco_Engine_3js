/**
 * PhysicalSkyTSL.js
 * Physically-based atmospheric sky using Three.js TSL (NodeMaterial).
 * Works natively with WebGPU renderer (TSL node pipeline).
 *
 * Sky model: Preetham/Schinzel analytical Rayleigh + Mie scattering +
 * ozone absorption (Hillaire 2020) + approximate multiple scattering.
 *
 * Public API:
 *   setEnabled(bool)
 *   setParams(opts)   — elevation, azimuth, turbidity, rayleigh, mieCoefficient,
 *                       mieDirectionalG, exposure, skyBrightness, showSun, showMoon,
 *                       ozoneR, ozoneG, ozoneB,
 *                       saturation, contrast, hue,
 *                       zenithTintR/G/B, hazeTintR/G/B, nightR/G/B
 *   update()
 *   dispose()
 *   get enabled() / get sunLight()
 *   getSkyColors()
 */

import * as THREE from 'three';
import { Lensflare, LensflareElement } from 'three/addons/objects/Lensflare.js';
import { LensflareMesh, LensflareElement as LensflareElementMesh } from 'three/addons/objects/LensflareMesh.js';

export class PhysicalSkyTSL {
  constructor(viewportEngine) {
    this._vpe       = viewportEngine;
    this._mesh      = null;
    this._mainMat   = null;
    this._enabled   = false;
    this._sunLight  = null;
    this._lensflare = null;
    this._occluderMat = null;

    // TSL uniform node handles
    this._uSunPos     = null;
    this._uTurbidity  = null;
    this._uRayleigh   = null;
    this._uMieCoeff   = null;
    this._uMieG       = null;
    this._uShowSun    = null;
    this._uShowMoon   = null;
    this._uOzone      = null;
    this._uSat        = null;
    this._uContrast   = null;
    this._uHue        = null;
    this._uZenithTint = null;
    this._uHazeTint   = null;
    this._uNightColor = null;
    this._uBrightness = null;

    this._p = {
      elevation:       30,
      azimuth:         180,
      turbidity:       2.0,
      rayleigh:        1.0,
      mieCoefficient:  0.005,
      mieDirectionalG: 0.8,
      showSun:         true,
      showMoon:        true,
      ozoneR:  3.426e-7,
      ozoneG:  8.298e-7,
      ozoneB:  3.56e-8,
      saturation:  1.0,
      contrast:    1.0,
      hue:         0.0,
      zenithTintR: 1.0, zenithTintG: 1.0, zenithTintB: 1.0,
      hazeTintR:   1.0, hazeTintG:   1.0, hazeTintB:   1.0,
      nightR: 0.02, nightG: 0.05, nightB: 0.18,
      skyBrightness: 1.0,
      exposure:      1.0,
      sunColor:      new THREE.Color('#fff8e7'),
      moonColor:     new THREE.Color('#c0d4ff'),
      sunGlowStrength: 0.5,
      sunGlowSize:     0.5,
      sunScale:        1.0,
      moonGlowStrength: 0.3,
      moonGlowSize:     0.3,
      moonScale:        1.0,
      lensflareEnabled: true,
      lensflareOpacity: 0.7,
      lensflareSize: 0.4,
      shape:            'cube',
      sunDir: new THREE.Vector3(),
    };
  }

  // ── Public API ──────────────────────────────────────────────────────────

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
    const p = this._p;
    let dirtyDir = false;

    const shapeChanged = opts.shape !== undefined && opts.shape !== p.shape;
    if (shapeChanged) {
      p.shape = opts.shape;
      if (this._mesh) {
        this._destroySky();
        this._createSky();
      }
    }

    if (opts.elevation        !== undefined) { p.elevation        = opts.elevation;        dirtyDir = true; }
    if (opts.azimuth          !== undefined) { p.azimuth          = opts.azimuth;          dirtyDir = true; }
    if (opts.turbidity        !== undefined)   p.turbidity        = opts.turbidity;
    if (opts.rayleigh         !== undefined)   p.rayleigh         = opts.rayleigh;
    if (opts.mieCoefficient   !== undefined)   p.mieCoefficient   = opts.mieCoefficient;
    if (opts.mieDirectionalG  !== undefined)   p.mieDirectionalG  = opts.mieDirectionalG;
    if (opts.exposure         !== undefined)   p.exposure         = opts.exposure;
    if (opts.skyBrightness    !== undefined)   p.skyBrightness    = opts.skyBrightness;
    if (opts.showSun          !== undefined)   p.showSun          = opts.showSun;
    if (opts.showMoon         !== undefined)   p.showMoon         = opts.showMoon;
    if (opts.ozoneR           !== undefined)   p.ozoneR           = opts.ozoneR;
    if (opts.ozoneG           !== undefined)   p.ozoneG           = opts.ozoneG;
    if (opts.ozoneB           !== undefined)   p.ozoneB           = opts.ozoneB;
    if (opts.saturation       !== undefined)   p.saturation       = opts.saturation;
    if (opts.contrast         !== undefined)   p.contrast         = opts.contrast;
    if (opts.hue              !== undefined)   p.hue              = opts.hue;
    if (opts.zenithTintR      !== undefined)   p.zenithTintR      = opts.zenithTintR;
    if (opts.zenithTintG      !== undefined)   p.zenithTintG      = opts.zenithTintG;
    if (opts.zenithTintB      !== undefined)   p.zenithTintB      = opts.zenithTintB;
    if (opts.hazeTintR        !== undefined)   p.hazeTintR        = opts.hazeTintR;
    if (opts.hazeTintG        !== undefined)   p.hazeTintG        = opts.hazeTintG;
    if (opts.hazeTintB        !== undefined)   p.hazeTintB        = opts.hazeTintB;
    if (opts.nightR           !== undefined)   p.nightR           = opts.nightR;
    if (opts.nightG           !== undefined)   p.nightG           = opts.nightG;
    if (opts.nightB           !== undefined)   p.nightB           = opts.nightB;
    if (opts.sunColor         !== undefined)   p.sunColor.set(opts.sunColor);
    if (opts.moonColor        !== undefined)   p.moonColor.set(opts.moonColor);
    if (opts.sunGlowStrength  !== undefined)   p.sunGlowStrength  = opts.sunGlowStrength;
    if (opts.sunGlowSize      !== undefined)   p.sunGlowSize      = opts.sunGlowSize;
    if (opts.sunScale         !== undefined)   p.sunScale         = opts.sunScale;
    if (opts.moonGlowStrength !== undefined)   p.moonGlowStrength = opts.moonGlowStrength;
    if (opts.moonGlowSize     !== undefined)   p.moonGlowSize     = opts.moonGlowSize;
    if (opts.moonScale        !== undefined)   p.moonScale        = opts.moonScale;
    if (opts.lensflareEnabled !== undefined)   p.lensflareEnabled = opts.lensflareEnabled;
    if (opts.lensflareOpacity !== undefined)   p.lensflareOpacity = opts.lensflareOpacity;
    if (opts.lensflareSize    !== undefined)   p.lensflareSize    = opts.lensflareSize;

    if (dirtyDir) this._updateDirs();
    this._pushUniforms();
    this._updateSunLight();
    this._updateLensflare();
  }

  update() {
    if (!this._mesh) return;
    const cam = this._vpe?.camera;
    if (cam) this._mesh.position.copy(cam.position);
    this._updateLensflare();
  }

  dispose() {
    this._destroySky();
    if (this._sunLight) {
      this._vpe?.scene?.remove(this._sunLight);
      this._sunLight = null;
    }
  }

  // ── Sky creation ────────────────────────────────────────────────────────

  async _createSky() {
    const scene = this._vpe?.scene;
    if (!scene) return;
    this._destroySky();

    let MeshBasicNodeMaterial, tsl;
    try {
      const [webgpuMod, tslMod] = await Promise.all([
        import('three/webgpu'),
        import('three/tsl'),
      ]);
      MeshBasicNodeMaterial = webgpuMod.MeshBasicNodeMaterial;
      tsl = tslMod;
    } catch (err) {
      console.error('[PhysicalSkyTSL] Failed to load TSL modules:', err);
      return;
    }

    const {
      Fn, vec3, vec4, float, uniform,
      dot, normalize, max, min, clamp, exp, pow, cos, sin, acos,
      smoothstep, mix, positionWorld, cameraPosition,
    } = tsl;

    const p = this._p;

    // ── TSL uniform nodes ────────────────────────────────────────────────
    this._uSunPos     = uniform(p.sunDir.clone(), 'vec3');
    this._uTurbidity  = uniform(p.turbidity,      'float');
    this._uRayleigh   = uniform(p.rayleigh,       'float');
    this._uMieCoeff   = uniform(p.mieCoefficient, 'float');
    this._uMieG       = uniform(Math.min(p.mieDirectionalG, 0.85), 'float');
    this._uShowSun    = uniform(p.showSun  ? 1.0 : 0.0, 'float');
    this._uShowMoon   = uniform(p.showMoon ? 1.0 : 0.0, 'float');
    this._uOzone      = uniform(new THREE.Vector3(p.ozoneR, p.ozoneG, p.ozoneB), 'vec3');
    this._uSat        = uniform(p.saturation,     'float');
    this._uContrast   = uniform(p.contrast,       'float');
    this._uHue        = uniform(p.hue * Math.PI / 180, 'float');
    this._uZenithTint = uniform(new THREE.Vector3(p.zenithTintR, p.zenithTintG, p.zenithTintB), 'vec3');
    this._uHazeTint   = uniform(new THREE.Vector3(p.hazeTintR,   p.hazeTintG,   p.hazeTintB),   'vec3');
    this._uNightColor = uniform(new THREE.Vector3(p.nightR, p.nightG, p.nightB), 'vec3');
    this._uSunColor   = uniform(new THREE.Vector3(p.sunColor.r, p.sunColor.g, p.sunColor.b), 'vec3');
    this._uMoonColor  = uniform(new THREE.Vector3(p.moonColor.r, p.moonColor.g, p.moonColor.b), 'vec3');
    this._uSunGlowStrength  = uniform(p.sunGlowStrength, 'float');
    this._uSunGlowSize      = uniform(p.sunGlowSize,     'float');
    this._uSunScale         = uniform(p.sunScale,        'float');
    this._uMoonGlowStrength = uniform(p.moonGlowStrength,'float');
    this._uMoonGlowSize     = uniform(p.moonGlowSize,    'float');
    this._uMoonScale        = uniform(p.moonScale,       'float');
    this._uBrightness = uniform(p.skyBrightness,  'float');

    // Capture refs so Fn() closure doesn't reference `this`
    const uSunPos     = this._uSunPos;
    const uTurb       = this._uTurbidity;
    const uRay        = this._uRayleigh;
    const uMieCoef    = this._uMieCoeff;
    const uMieG       = this._uMieG;
    const uShowSun    = this._uShowSun;
    const uShowMoon   = this._uShowMoon;
    const uOzone      = this._uOzone;
    const uSat        = this._uSat;
    const uContrast   = this._uContrast;
    const uHue        = this._uHue;
    const uZenithTint = this._uZenithTint;
    const uHazeTint   = this._uHazeTint;
    const uNightColor = this._uNightColor;
    const uSunColor   = this._uSunColor;
    const uMoonColor  = this._uMoonColor;
    const uSunGlowStrength  = this._uSunGlowStrength;
    const uSunGlowSize      = this._uSunGlowSize;
    const uSunScale         = this._uSunScale;
    const uMoonGlowStrength = this._uMoonGlowStrength;
    const uMoonGlowSize     = this._uMoonGlowSize;
    const uMoonScale        = this._uMoonScale;
    const uBrightness = this._uBrightness;

    // ── Sky colour graph ─────────────────────────────────────────────────
    const skyColorNode = Fn(() => {

      const direction = normalize(positionWorld.sub(cameraPosition));
      const upVec     = vec3(0, 1, 0);

      // Sun direction + earth-shadow intensity
      const sunDir   = normalize(uSunPos);
      const cutoff   = float(1.6110731556870734);
      const sunDotUp = clamp(dot(sunDir, upVec), float(-1), float(1));
      const sunE = float(1000.0).mul(
        max(float(0),
          float(1).sub(exp(float(-1).mul(cutoff.sub(acos(sunDotUp)).div(float(1.5)))))
        )
      );

      // Sun fade: y/450000 << 1 for unit sunDir, so ≈1 during daytime
      const sunfade = clamp(exp(uSunPos.y.div(float(450000))), float(0), float(1));

      // Rayleigh coefficient
      const totalRayleigh = vec3(5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5);
      const betaR = totalRayleigh.mul(uRay.sub(float(1).mul(float(1).sub(sunfade))));

      // Mie coefficient
      const MieConst = vec3(1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14);
      const c        = uTurb.mul(float(0.2)).mul(float(10e-18));
      const betaM    = MieConst.mul(float(0.434)).mul(c).mul(uMieCoef);

      // Chapman optical depth — CRITICAL: clamp before acos to prevent NaN
      const zenithAngle = acos(clamp(dot(upVec, direction), float(0), float(0.9999)));
      const zenithDeg   = zenithAngle.mul(float(180.0 / Math.PI));
      const chapmanInv  = float(1).div(
        cos(zenithAngle).add(float(0.15).mul(pow(float(93.885).sub(zenithDeg), float(-1.253))))
      );
      const sR = float(8.4e3).mul(chapmanInv);
      const sM = float(1.25e3).mul(chapmanInv);

      // Ozone absorption (user-controllable via uOzone uniform)
      const sOzone = float(25000.0).mul(chapmanInv);
      const Fex = exp(float(-1).mul(betaR.mul(sR).add(betaM.mul(sM)).add(uOzone.mul(sOzone))));

      // Phase functions
      const cosTheta = dot(direction, sunDir);

      // Rayleigh: (3/16pi)(1 + cos^2)
      const rPhase     = float(0.05968310365946075).mul(float(1).add(cosTheta.mul(cosTheta)));
      const betaRTheta = betaR.mul(rPhase);

      // Mie Henyey-Greenstein: prevent singularity with max
      const g2         = uMieG.mul(uMieG);
      const hgBase     = max(float(1e-6), float(1).add(g2).sub(uMieG.mul(float(2)).mul(cosTheta)));
      const hgDenom    = pow(hgBase, float(1.5));
      const mPhase     = float(0.07957747154594767).mul(float(1).sub(g2).div(hgDenom));
      const betaMTheta = betaM.mul(mPhase);

      // In-scattering
      const betaSum = betaR.add(betaM);
      const scatter = betaRTheta.add(betaMTheta).div(betaSum);
      const Lin = pow(sunE.mul(scatter).mul(vec3(1,1,1).sub(Fex)), vec3(1.5, 1.5, 1.5));

      // Horizon blend based on view angle, not sun angle, so the sky dome fades vertically
      const horizonBlend = clamp(pow(float(1).sub(dot(upVec, direction)), float(5)), float(0), float(1));
      const LinHorizon   = pow(sunE.mul(scatter).mul(Fex), vec3(0.5, 0.5, 0.5));

      // Multiple scattering +15%
      const LinFinal = Lin.mul(mix(vec3(1,1,1), LinHorizon, horizonBlend)).mul(float(1.15));

      // Zenith / haze tints
      const zenithFactor = clamp(direction.y.mul(float(2)), float(0), float(1));
      const tintedFinal  = LinFinal.mul(mix(uHazeTint, uZenithTint, zenithFactor));

      // Ambient + sun disc
      const L0 = vec3(0.05, 0.05, 0.05).mul(Fex);
      const sunAngDiamCos = float(0.999956676946448);
      const sunDisc = smoothstep(sunAngDiamCos, sunAngDiamCos.add(float(0.00004).mul(uSunScale)), cosTheta).mul(uShowSun);
      const sunGlow = smoothstep(sunAngDiamCos.sub(float(0.0003).mul(uSunGlowSize)), sunAngDiamCos, cosTheta)
                        .mul(uShowSun).mul(uSunGlowStrength);
      const sunCore = sunDisc.mul(clamp(uSunGlowStrength.mul(float(0.6)).add(float(0.1)), float(0.0), float(1.0)));
      const sunL0     = uSunColor.mul(sunCore).mul(sunE.mul(float(4000)).mul(Fex));
      const sunGlowL0 = uSunColor.mul(sunGlow).mul(float(2200)).mul(Fex);
      const L0Final = L0.add(sunL0).add(sunGlowL0);

      // Moon disc (opposite sun, visible when sun is below horizon)
      const moonDir    = normalize(uSunPos.negate());
      const moonCosT   = dot(direction, moonDir);
      const moonVis    = clamp(uSunPos.y.negate().mul(float(6)), float(0), float(1));
      const moonAngCos = float(0.9996);  // ~1.6° half-angle for visible disc
      const moonDisc   = smoothstep(moonAngCos, moonAngCos.add(float(0.0004).mul(uMoonScale)), moonCosT)
                           .mul(uShowMoon).mul(moonVis);
      const moonGlow = smoothstep(moonAngCos.sub(float(0.00045).mul(uMoonGlowSize)), moonAngCos, moonCosT)
                         .mul(uShowMoon).mul(moonVis).mul(uMoonGlowStrength);
      const moonCore = moonDisc.mul(clamp(uMoonGlowStrength.mul(float(0.6)).add(float(0.1)), float(0.0), float(1.0)));
      const moonL0     = uMoonColor.mul(moonCore).mul(float(0.32));
      const moonGlowL0 = uMoonColor.mul(moonGlow).mul(float(0.18));

      // Scale 0.022 keeps sky body below bloom threshold 1.5
      const texColor = tintedFinal.add(L0Final)
                         .mul(float(0.022))
                         .add(vec3(0.0, 0.0001, 0.0003))
                         .mul(uBrightness)
                         .add(moonL0)
                         .add(moonGlowL0);

      // Smooth HDR compression instead of hard clamp.
      const toneMapped = texColor.div(float(1).add(texColor));

      // Night sky ambient
      const nightFactor = clamp(uSunPos.y.negate().mul(float(8)), float(0), float(1));
      const withNight   = mix(toneMapped, toneMapped.add(uNightColor.mul(nightFactor)), nightFactor);

      // Saturation
      const lumCoeff   = vec3(0.2126, 0.7152, 0.0722);
      const lum        = dot(withNight, lumCoeff);
      const saturated  = max(mix(vec3(lum, lum, lum), withNight, uSat), vec3(0,0,0));

      // Contrast
      const contrasted = max(saturated.sub(float(0.5)).mul(uContrast).add(float(0.5)), vec3(0,0,0));

      // Hue rotation (Rodrigues around (1/sqrt3, 1/sqrt3, 1/sqrt3))
      const cosH = cos(uHue);
      const sinH = sin(uHue);
      const k    = float(0.57735);
      const cr   = contrasted.x;
      const cg   = contrasted.y;
      const cb   = contrasted.z;
      const omc  = float(1).sub(cosH);
      const rOut = cr.mul(cosH.add(k.mul(k).mul(omc)))
                    .add(cg.mul(k.mul(k).mul(omc).sub(k.mul(sinH))))
                    .add(cb.mul(k.mul(k).mul(omc).add(k.mul(sinH))));
      const gOut = cr.mul(k.mul(k).mul(omc).add(k.mul(sinH)))
                    .add(cg.mul(cosH.add(k.mul(k).mul(omc))))
                    .add(cb.mul(k.mul(k).mul(omc).sub(k.mul(sinH))));
      const bOut = cr.mul(k.mul(k).mul(omc).sub(k.mul(sinH)))
                    .add(cg.mul(k.mul(k).mul(omc).add(k.mul(sinH))))
                    .add(cb.mul(cosH.add(k.mul(k).mul(omc))));
      const hueShifted = max(vec3(rOut, gOut, bOut), vec3(0,0,0));

      // Ground fill below horizon
      const belowH     = max(float(0), direction.y.negate());
      const belowBlend = smoothstep(float(0), float(0.12), belowH);
      const sunH       = max(float(0), sunDir.y);
      const groundBase   = vec3(0.15, 0.12, 0.08);
      const groundSunset = vec3(0.22, 0.08, 0.02).mul(max(float(0), float(1).sub(sunH.mul(float(5)))));
      const groundColor  = groundBase.add(groundSunset).mul(sunE.mul(float(0.000003)).add(float(0.03)));
      const finalColor   = mix(hueShifted, groundColor, belowBlend);

      return vec4(finalColor, float(1.0));
    });

    // ── NodeMaterial ─────────────────────────────────────────────────────
    const mat = new MeshBasicNodeMaterial();
    mat.colorNode = skyColorNode();
    mat.side      = THREE.BackSide;
    mat.depthTest  = false;
    mat.depthWrite = false;

    // ── Mesh ─────────────────────────────────────────────────────────────
    const geo = p.shape === 'dome'
      ? new THREE.SphereGeometry(1, 32, 16)
      : new THREE.BoxGeometry(1, 1, 1);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.scale.setScalar(450000);
    mesh.renderOrder        = -1000;
    mesh.name               = '__cyco_physical_sky_tsl';
    mesh.raycast            = () => {};
    mesh.frustumCulled      = false;
    mesh.userData._isHelper = true;

    const cam = this._vpe?.camera;
    if (cam) mesh.position.copy(cam.position);

    this._mesh    = mesh;
    this._mainMat = mat;

    // Add mesh first, THEN clear background — prevents blank frame
    scene.add(mesh);
    scene.background = null;

    this._createLensflare(scene);
    this._updateSunLight();

    console.log('[PhysicalSkyTSL] Sky mesh created (WebGPU TSL, all controls active).');
  }

  _destroySky() {
    const scene = this._vpe?.scene;
    if (this._mesh) {
      scene?.remove(this._mesh);
      this._mesh.geometry?.dispose();
      this._mesh.material?.dispose();
      this._mesh    = null;
      this._mainMat = null;
      if (scene && scene.background === null) {
        scene.background = new THREE.Color(0x1a1a1a);
      }
    }
    if (this._lensflare) {
      scene?.remove(this._lensflare);
      this._lensflare = null;
    }
    this._uSunPos = this._uTurbidity = this._uRayleigh = this._uMieCoeff = null;
    this._uMieG   = this._uShowSun   = this._uShowMoon  = this._uOzone   = null;
    this._uSat    = this._uContrast  = this._uHue        = null;
    this._uZenithTint = this._uHazeTint = this._uNightColor = this._uSunColor = null;
    this._uMoonColor = this._uSunGlowStrength = this._uSunGlowSize = null;
    this._uSunScale = this._uMoonGlowStrength = this._uMoonGlowSize = this._uMoonScale = this._uBrightness = null;
  }

  _initSunLight() {
    this._sunLight = new THREE.DirectionalLight(0xfff5e0, 0.0);
    this._sunLight.name = '__cyco_physical_sky_tsl_sun';
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

  _updateDirs() {
    const phi   = THREE.MathUtils.degToRad(90 - this._p.elevation);
    const theta = THREE.MathUtils.degToRad(this._p.azimuth);
    this._p.sunDir.setFromSphericalCoords(1, phi, theta);
  }

  _pushUniforms() {
    const p = this._p;
    if (this._uSunPos)     this._uSunPos.value.copy(p.sunDir);
    if (this._uTurbidity)  this._uTurbidity.value  = p.turbidity;
    if (this._uRayleigh)   this._uRayleigh.value   = p.rayleigh;
    if (this._uMieCoeff)   this._uMieCoeff.value   = p.mieCoefficient;
    if (this._uMieG)       this._uMieG.value        = Math.min(p.mieDirectionalG, 0.85);
    if (this._uShowSun)    this._uShowSun.value     = p.showSun  ? 1.0 : 0.0;
    if (this._uShowMoon)   this._uShowMoon.value    = p.showMoon ? 1.0 : 0.0;
    if (this._uOzone)      this._uOzone.value.set(p.ozoneR, p.ozoneG, p.ozoneB);
    if (this._uSat)        this._uSat.value         = p.saturation;
    if (this._uContrast)   this._uContrast.value    = p.contrast;
    if (this._uHue)        this._uHue.value         = p.hue * Math.PI / 180;
    if (this._uZenithTint) this._uZenithTint.value.set(p.zenithTintR, p.zenithTintG, p.zenithTintB);
    if (this._uHazeTint)   this._uHazeTint.value.set(p.hazeTintR,   p.hazeTintG,   p.hazeTintB);
    if (this._uNightColor) this._uNightColor.value.set(p.nightR,    p.nightG,      p.nightB);
    if (this._uSunColor)   this._uSunColor.value.set(p.sunColor.r, p.sunColor.g, p.sunColor.b);
    if (this._uMoonColor)  this._uMoonColor.value.set(p.moonColor.r, p.moonColor.g, p.moonColor.b);
    if (this._uSunGlowStrength)  this._uSunGlowStrength.value  = p.sunGlowStrength;
    if (this._uSunGlowSize)      this._uSunGlowSize.value      = p.sunGlowSize;
    if (this._uSunScale)         this._uSunScale.value         = p.sunScale;
    if (this._uMoonGlowStrength) this._uMoonGlowStrength.value = p.moonGlowStrength;
    if (this._uMoonGlowSize)     this._uMoonGlowSize.value     = p.moonGlowSize;
    if (this._uMoonScale)        this._uMoonScale.value        = p.moonScale;
    if (this._uBrightness) this._uBrightness.value  = p.skyBrightness;
  }

  _updateSunLight() {
    if (!this._sunLight) return;
    const scene = this._vpe?.scene;
    if (scene && !scene.children.includes(this._sunLight)) scene.add(this._sunLight);

    this._sunLight.position.copy(this._p.sunDir).multiplyScalar(100);
    this._sunLight.target.position.set(0, 0, 0);
    if (this._sunLight.target.parent !== scene && scene) scene.add(this._sunLight.target);

    const el = this._p.elevation;
    if (el < -6) {
      this._sunLight.intensity = 0;
      if (this._vpe?._hemisphereLight) {
        this._vpe._hemisphereLight.color.setRGB(0.06, 0.08, 0.20);
        this._vpe._hemisphereLight.groundColor.setRGB(0.04, 0.04, 0.06);
        this._vpe._hemisphereLight.intensity = 0.15;
      }
    } else {
      const t       = Math.min(1, Math.max(0, (el + 6) / 21));
      const smoothT = t * t * (3 - 2 * t);
      this._sunLight.intensity = 2.5 * smoothT;
      this._sunLight.visible   = true;

      const warmT = Math.max(0, 1 - Math.abs(el / 20));
      this._sunLight.color.setRGB(1.0, Math.max(0.4, 1.0 - warmT * 0.6), Math.max(0.2, 1.0 - warmT * 0.8));

      if (this._vpe?._hemisphereLight) {
        this._vpe._hemisphereLight.color.setRGB(0.6, 0.7, 0.9);
        this._vpe._hemisphereLight.groundColor.setRGB(0.3, 0.25, 0.2);
        this._vpe._hemisphereLight.intensity = 0.4 * smoothT + 0.05;
      }
    }
  }

  _createLensflare(scene) {
    if (this._lensflare) { scene?.remove(this._lensflare); this._lensflare = null; }
    // Use LensflareMesh for WebGPU, Lensflare for WebGL.
    // isWebGPURenderer is unreliable in this build — check rendererManager instead.
    const isWebGPU = this._vpe?.rendererManager?.activeType === 'webgpu';
    const sizeScale = Math.max(0.01, this._p.lensflareSize ?? 0.4);
    try {
      let flare;
      if (isWebGPU) {
        flare = new LensflareMesh();
        const e1 = new LensflareElementMesh(this._makeFlareTex(256), 700 * sizeScale, 0.0, new THREE.Color(1.0, 0.95, 0.85));
        const e2 = new LensflareElementMesh(this._makeFlareTex(64),  60 * sizeScale,  0.6);
        const e3 = new LensflareElementMesh(this._makeFlareTex(64),  40 * sizeScale,  0.8);
        e1.userData._baseSize = 700;
        e2.userData._baseSize = 60;
        e3.userData._baseSize = 40;
        flare.addElement(e1);
        flare.addElement(e2);
        flare.addElement(e3);
      } else {
        flare = new Lensflare();
        const e1 = new LensflareElement(this._makeFlareTex(256), 700 * sizeScale, 0.0, new THREE.Color(1.0, 0.95, 0.85));
        const e2 = new LensflareElement(this._makeFlareTex(64),  60 * sizeScale,  0.6);
        const e3 = new LensflareElement(this._makeFlareTex(64),  40 * sizeScale,  0.8);
        e1.userData._baseSize = 700;
        e2.userData._baseSize = 60;
        e3.userData._baseSize = 40;
        flare.addElement(e1);
        flare.addElement(e2);
        flare.addElement(e3);
      }
      flare.position.copy(this._p.sunDir).multiplyScalar(4e5);
      flare.userData._isHelper = true;
      this._lensflare = flare;
      scene?.add(flare);
    } catch (_) {}
  }

  _updateLensflare() {
    if (!this._lensflare) return;
    const p = this._p;
    this._lensflare.position.copy(p.sunDir).multiplyScalar(4e5);
    const visible = p.lensflareEnabled && p.showSun && p.elevation > -6;
    this._lensflare.visible = visible;

    const opacity = Math.max(0, Math.min(1, p.lensflareOpacity ?? 1.0));
    const sizeScale = Math.max(0.01, p.lensflareSize ?? 0.4);
    (this._lensflare.elements || []).forEach((el) => {
      if (el.material) {
        el.material.opacity = opacity;
        el.material.transparent = opacity < 1.0;
      }
      if (typeof el.size === 'number') {
        const base = el.userData?._baseSize ?? el.size;
        el.size = base * sizeScale;
      }
    });
  }

  _makeFlareTex(size) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx  = canvas.getContext('2d');
    const r    = size / 2;
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

  /**
   * Returns approximate sky colours for the current sun elevation.
   * Used by VolumetricClouds to sync cloud ambient lighting.
   */
  getSkyColors() {
    const el  = this._p.elevation;
    const elN = Math.max(-1, Math.min(1, el / 90));

    const sunsetT = Math.max(0, 1.0 - Math.abs(elN) * 5.0);
    const dayT    = Math.min(1.0, Math.max(0, elN * 4.5));
    const nightT  = Math.max(0, -elN);

    return {
      sunColor: new THREE.Color(
        Math.min(1, 1.0  * dayT + 1.0  * sunsetT + 0.20 * nightT),
        Math.min(1, 0.97 * dayT + 0.45 * sunsetT + 0.20 * nightT),
        Math.min(1, 0.88 * dayT + 0.05 * sunsetT + 0.45 * nightT)
      ),
      horizon: new THREE.Color(
        Math.min(1, 0.65 * dayT + 1.00 * sunsetT + 0.05 * nightT),
        Math.min(1, 0.75 * dayT + 0.35 * sunsetT + 0.06 * nightT),
        Math.min(1, 0.95 * dayT + 0.05 * sunsetT + 0.18 * nightT)
      ),
      zenith: new THREE.Color(
        Math.min(1, 0.22 * dayT + 0.35 * sunsetT + 0.01 * nightT),
        Math.min(1, 0.44 * dayT + 0.10 * sunsetT + 0.01 * nightT),
        Math.min(1, 0.85 * dayT + 0.30 * sunsetT + 0.06 * nightT)
      ),
    };
  }
}
