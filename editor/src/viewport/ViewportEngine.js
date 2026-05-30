/**
 * ViewportEngine.js
 * The central coordinator for the 3D viewport.
 * Owns: scene, camera, render loop, IBL, OrbitControls, ViewHelper, resize observer.
 *
 * Depends on: RendererManager (injected), THREE.LoadingManager (injected)
 *
 * Events dispatched:
 *   cyco-vp-ready          { scene, camera }   — viewport is fully initialised
 *   cyco-vp-resize         { width, height }   — viewport was resized
 *   cyco-loading-progress  { url, loaded, total } — forwarded from LoadingManager
 *
 * Events consumed:
 *   cyco-renderer-changed  { renderer, type }  — rebuild IBL + pipeline on renderer swap
 *   cyco-rvp-focus         { object }          — lerp camera target to object
 *   cyco-vp-camera         { view }            — snap to Top/Front/Right/etc.
 *   cyco-show-properties   { type:'grid'|... } — (no action here, forwarded to RightPanel)
 *   cyco-scene-switch      { sceneId }         — swap rendered scene to new active scene
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ViewHelper } from 'three/addons/helpers/ViewHelper.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { VolumetricClouds } from './VolumetricClouds.js';
import { GradientSky }     from './GradientSky.js';
import { ContactShadows }  from './ContactShadows.js';

/** Sentinel value: no active focus animation. */
const NO_FOCUS = null;

/** Return just the filename part of a URL for display in the loading overlay. */
function _shortFilename(url) {
  if (!url) return '…';
  try { return decodeURIComponent(url.split('/').pop().split('?')[0]) || url; }
  catch { return url; }
}

export class ViewportEngine {
  /**
   * @param {import('./RendererManager.js').RendererManager} rendererManager
   * @param {THREE.LoadingManager} loadingManager
   */
  constructor(rendererManager, loadingManager) {
    this.rendererManager = rendererManager;
    this.loadingManager  = loadingManager;

    /** @type {THREE.Scene} */
    this.scene    = null;
    /** @type {THREE.PerspectiveCamera} */
    this.camera   = null;
    /** @type {OrbitControls} */
    this.controls = null;
    /** @type {ViewHelper} */
    this.viewHelper = null;
    /** @type {THREE.GridHelper} */
    this.gridHelper = null;
    /** @type {THREE.AxesHelper} */
    this.axesHelper = null;

    /** @type {THREE.AmbientLight} */
    this._ambientLight = null;
    /** @type {THREE.HemisphereLight} */
    this._hemisphereLight = null;

    /** @type {number|null} RAF handle */
    this._rafId = null;

    /** Focus animation state */
    this._focusAnim = NO_FOCUS; // { target, start, duration, startTime }

    /** THREE.Timer for deterministic deltaTime */
    this._timer = new THREE.Timer();

    /** ResizeObserver for container size changes */
    this._resizeObserver = null;
    this._container = null;

    /** Secondary WebGLRenderer + canvas for the ViewHelper gizmo overlay (WebGPU mode) */
    this._helperOverlayRenderer = null;
    this._helperOverlayCanvas   = null;

    // ── event bindings ──
    this._onRendererChanged    = this._onRendererChanged.bind(this);
    this._onFocus               = this._onFocus.bind(this);
    this._onCameraSnap          = this._onCameraSnap.bind(this);
    this._onContainerReady      = this._onContainerReady.bind(this);
    this._onSceneSwitch         = this._onSceneSwitch.bind(this);
    this._onSkyChange           = this._onSkyChange.bind(this);
    this._onFogChange           = this._onFogChange.bind(this);
    this._onEnvMapChange        = this._onEnvMapChange.bind(this);
    this._onEnvBgToggle         = this._onEnvBgToggle.bind(this);
    this._onBackgroundChange    = this._onBackgroundChange.bind(this);
    this._onEnvPreset           = this._onEnvPreset.bind(this);
    this._onEnvIntensity        = this._onEnvIntensity.bind(this);
    this._onGridSettings        = this._onGridSettings.bind(this);
    this._onLoadingStart        = this._onLoadingStart.bind(this);
    this._onLoadingProgress     = this._onLoadingProgress.bind(this);
    this._onLoadingDone         = this._onLoadingDone.bind(this);
    this._onLoadingError        = this._onLoadingError.bind(this);

    window.addEventListener('cyco-renderer-changed',        this._onRendererChanged);
    window.addEventListener('cyco-rvp-focus',               this._onFocus);
    window.addEventListener('cyco-vp-camera',               this._onCameraSnap);
    window.addEventListener('cyco-viewport-container-ready', this._onContainerReady);
    window.addEventListener('cyco-scene-switch',            this._onSceneSwitch);
    window.addEventListener('cyco-sky-change',              this._onSkyChange);
    window.addEventListener('cyco-fog-change',              this._onFogChange);
    window.addEventListener('cyco-env-map-change',          this._onEnvMapChange);
    window.addEventListener('cyco-env-background-toggle',   this._onEnvBgToggle);
    window.addEventListener('cyco-background-change',       this._onBackgroundChange);
    window.addEventListener('cyco-env-preset',              this._onEnvPreset);
    window.addEventListener('cyco-env-intensity',           this._onEnvIntensity);
    window.addEventListener('cyco-grid-settings-change',    this._onGridSettings);
    window.addEventListener('cyco-loading-start',           this._onLoadingStart);
    window.addEventListener('cyco-loading-progress',        this._onLoadingProgress);
    window.addEventListener('cyco-loading-done',            this._onLoadingDone);
    window.addEventListener('cyco-loading-error',           this._onLoadingError);
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Initialise the viewport. Call once from main.js after DOM is ready.
   * Also called automatically via 'cyco-viewport-container-ready' event from CenterPanel.
   * @param {HTMLElement} container  The element that hosts the canvas.
   */
  async init(container) {
    this._container = container;
    const { width, height } = container.getBoundingClientRect();
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));

    // Init renderer (async — retries up to 3× if context creation is blocked)
    try {
      await this.rendererManager.init(container, w, h);
    } catch (err) {
      console.error('[ViewportEngine] Failed to create WebGL renderer after all retries:', err.message);
      // Show user-visible error in the container
      const msg = document.createElement('div');
      msg.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#e07228;font-size:14px;padding:20px;text-align:center;';
      msg.textContent = 'Unable to initialise WebGL. Please reload the page.';
      container.appendChild(msg);
      return;
    }

    // Build scene + camera
    this._buildScene(w, h);

    // IBL — must be called after renderer + scene exist
    this._setupIBL();

    // Volumetric cloud system (WebGL ray marching) — sky-layer high clouds
    this.cloudSystem = new VolumetricClouds(this);

    // Second cloud layer — low-altitude atmospheric clouds that cast shadows
    this.cloudSystem2 = new VolumetricClouds(this);
    this.cloudSystem2._p.skyMode        = false;
    this.cloudSystem2._p.cloudBase      = 5;
    this.cloudSystem2._p.cloudTop       = 85;
    this.cloudSystem2._p.coverage       = 0.3;
    this.cloudSystem2._p.density        = 0.8;
    this.cloudSystem2._p.windSpeed      = 0.8;
    this.cloudSystem2._p.scale          = 30;
    this.cloudSystem2._p.shadowEnabled  = true;
    this.cloudSystem2._p.shadowStrength = 0.4;
    this.cloudSystem2._p.morphSpeed     = 0.12;

    // Gradient sky + sun/moon system
    this.gradientSky = new GradientSky(this);

    // Contact shadow system (ground-plane fake shadows)
    this.contactShadows = new ContactShadows();
    this.contactShadows.init(this.rendererManager.renderer, this.scene);

    // OrbitControls
    this._buildControls();

    // ViewHelper (axis cube, top-right)
    this._buildViewHelper();

    // Resize observer
    this._buildResizeObserver(container);

    // Deferred size sync — on cold load, getBoundingClientRect() above may
    // return a pre-layout (e.g. zero) size if dockview hasn't finished its
    // initial layout pass yet. The ResizeObserver won't fire again if the
    // container was already at its final size when observe() was called.
    // Two nested RAFs guarantee we read after CSS layout has settled.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!this._container) return;
        const { width, height } = this._container.getBoundingClientRect();
        const w = Math.max(1, Math.floor(width));
        const h = Math.max(1, Math.floor(height));
        if (w > 1 && h > 1) this._handleResize(w, h);
      });
    });

    // Right-click context menu
    this._buildContextMenu(container);

    // Loading overlay (sits above the canvas, shows asset load progress)
    this._buildLoadingOverlay(container);

    // Start render loop
    this._startLoop();

    window.dispatchEvent(new CustomEvent('cyco-vp-ready', {
      detail: { scene: this.scene, camera: this.camera }
    }));
  }

  /**
   * Replace the active scene (e.g. after GameRuntime.stop()).
   * @param {THREE.Scene} newScene
   */
  replaceScene(newScene) {
    this.scene = newScene;
    this._setupIBL();
  }

  /** Called when SceneManager switches the active scene. */
  _onSceneSwitch({ detail } = {}) {
    const sm = window.__cyco?.sceneManager;
    if (!sm) return;
    const newScene = sm.getActiveScene?.();
    if (newScene) this.replaceScene(newScene);
  }

  /** Apply gradient sky + sun/moon to the active scene. */
  _onSkyChange({ detail } = {}) {
    const {
      enabled,
      elevation = 30, azimuth = 180,
      colorStops, opacityStops,
      showSun = true, sunColor, sunGlowStrength,
      showMoon = true, moonColor, moonGlowStrength,
      exposure, saturation, contrast,
      lensflareEnabled, lensflareSize, lensflareOpacity,
      lensflareStyle, lensflareColor, lensflareColorIntensity, lensflareIntensity, lensflareGhostCount, lensflareStreakLength, lensflareBrightness,
      lensflareRingThickness, lensflareRingFill, lensflareRingSize, lensflareRingOpacity,
    } = detail ?? {};
    console.log(
      `[CYCO:ENV] cyco-sky-change  enabled=${enabled}  elevation=${elevation}°  azimuth=${azimuth}°` +
      `  exposure=${exposure ?? 'n/a'}  saturation=${saturation ?? 'n/a'}  showSun=${showSun}  showMoon=${showMoon}`
    );
    if (!this.scene) return;

    if (!enabled) {
      this.gradientSky?.setEnabled(false);
      this.skyEnabled = false;
      // Only fall back to solid colour when the current bg type isn't gradient/hdri
      if (this._bgType !== 'gradient' && this._bgType !== 'hdri') {
        if (!(this.scene.background instanceof THREE.Color)) {
          this.scene.background = new THREE.Color(0x1a1a1a);
        }
      }
      return;
    }

    const params = { elevation, azimuth, showSun, showMoon };
    if (colorStops)               params.colorStops       = colorStops;
    if (opacityStops)             params.opacityStops     = opacityStops;
    if (sunColor)                 params.sunColor         = sunColor;
    if (sunGlowStrength !== undefined) params.sunGlowStrength = sunGlowStrength;
    if (moonColor)                params.moonColor        = moonColor;
    if (moonGlowStrength !== undefined) params.moonGlowStrength = moonGlowStrength;
    if (exposure !== undefined)   params.exposure         = exposure;
    if (saturation !== undefined) params.saturation       = saturation;
    if (contrast !== undefined)   params.contrast         = contrast;
    if (lensflareEnabled      !== undefined) params.lensflareEnabled      = lensflareEnabled;
    if (lensflareSize         !== undefined) params.lensflareSize         = lensflareSize;
    if (lensflareOpacity      !== undefined) params.lensflareOpacity      = lensflareOpacity;
    if (lensflareStyle        !== undefined) params.lensflareStyle        = lensflareStyle;
    if (lensflareIntensity    !== undefined) params.lensflareIntensity    = lensflareIntensity;
    if (lensflareGhostCount   !== undefined) params.lensflareGhostCount   = lensflareGhostCount;
    if (lensflareStreakLength  !== undefined) params.lensflareStreakLength  = lensflareStreakLength;
    if (lensflareBrightness   !== undefined) params.lensflareBrightness   = lensflareBrightness;
    if (lensflareColor) params.lensflareColor = lensflareColor;
    if (lensflareColorIntensity !== undefined) params.lensflareColorIntensity = lensflareColorIntensity;
    if (lensflareRingThickness  !== undefined) params.lensflareRingThickness  = lensflareRingThickness;
    if (lensflareRingFill        !== undefined) params.lensflareRingFill        = lensflareRingFill;
    if (lensflareRingSize        !== undefined) params.lensflareRingSize        = lensflareRingSize;
    if (lensflareRingOpacity     !== undefined) params.lensflareRingOpacity     = lensflareRingOpacity;

    this.gradientSky.setEnabled(true);
    this.gradientSky.setParams(params);

    // Update renderer exposure from sky exposure slider
    const renderer = this.rendererManager?.renderer;
    if (renderer && exposure !== undefined) {
      renderer.toneMappingExposure = exposure;
    }

    // Build a sky-gradient env map so metals/glass reflect the sky colours.
    // Only regenerate when the gradient colours actually change (not on every elevation tick).
    if (colorStops && renderer) {
      this._lastSkyColorStops = colorStops;
      this._buildSkyEnvMap(colorStops, renderer);
    }

    // Sky mesh handles the background — clear any solid/colour background
    this.scene.background = null;
    this.skyEnabled   = true;
    this.skyElevation = elevation;
    this.skyAzimuth   = azimuth;

    // Sync cloud sun direction
    this.cloudSystem?.updateSunFromSky(elevation, azimuth);
    this.cloudSystem2?.updateSunFromSky(elevation, azimuth);
  }

  /** Apply fog to the active scene. */
  _onFogChange({ detail } = {}) {
    if (!this.scene) return;
    const { type, color = '#aaaaaa', near = 1, far = 1000, density = 0.002 } = detail ?? {};
    console.log(
      `[CYCO:ENV] cyco-fog-change  type=${type ?? 'none'}  color=${color}  near=${near}  far=${far}  density=${density}`
    );
    const c = new THREE.Color(color);
    if (type === 'linear') {
      this.scene.fog = new THREE.Fog(c, near, far);
    } else if (type === 'exp2') {
      this.scene.fog = new THREE.FogExp2(c, density);
    } else {
      this.scene.fog = null;
    }
  }

  /** Load and apply an HDR/EXR environment map. */
  async _onEnvMapChange({ detail } = {}) {
    const { url, isHDR } = detail ?? {};
    console.log(`[CYCO:ENV] cyco-env-map-change  url=${url}  isHDR=${isHDR}`);
    if (!url || !this.scene) return;
    let renderer = this.rendererManager.renderer;
    if (!renderer) return;
    // PathTracingRenderer wraps an inner WebGLRenderer — use that
    renderer = renderer._webglRenderer ?? renderer;

    let PMREMGen;
    if (renderer.isWebGLRenderer) {
      PMREMGen = THREE.PMREMGenerator;
    } else if (renderer.isWebGPURenderer) {
      try {
        const mod = await import('three/webgpu');
        PMREMGen = mod.PMREMGenerator;
      } catch (e) {
        console.warn('[ViewportEngine] HDRI env map not supported with current renderer:', e);
        return;
      }
    } else {
      console.warn('[ViewportEngine] HDRI env map not supported with current renderer — switch to WebGL/WebGPU first.');
      return;
    }
    const pmrem = new PMREMGen(renderer);
    if (typeof pmrem.compileEquirectangularShader === 'function') {
      pmrem.compileEquirectangularShader();
    }
    try {
      const { RGBELoader } = await import('three/addons/loaders/RGBELoader.js');
      const { EXRLoader }  = await import('three/addons/loaders/EXRLoader.js');
      const loader = isHDR ? new RGBELoader() : new EXRLoader();
      const texture = await new Promise((resolve, reject) => {
        loader.load(url, resolve, undefined, reject);
      });
      const envMap = pmrem.fromEquirectangular(texture).texture;
      this.scene.environment = envMap;
      this._lastEnvMap = envMap;
      texture.dispose();
      console.log('[CYCO:ENV] env map loaded ✓  scene.environment set');
    } catch (e) {
      console.warn('[ViewportEngine] env map load failed:', e);
      console.log('[CYCO:ENV] env map FAILED ✗  ' + e.message);
    } finally {
      pmrem.dispose();
    }
  }

  /** Toggle whether the env map is shown as scene background. */
  _onEnvBgToggle({ detail } = {}) {
    if (!this.scene) return;
    console.log(`[CYCO:ENV] cyco-env-background-toggle  enabled=${detail?.enabled}  hasLastEnvMap=${!!this._lastEnvMap}`);
    this.scene.background = detail?.enabled ? (this._lastEnvMap ?? null) : null;
  }

  /**
   * Handle background type change from EnvironmentProperties.
   * Types: 'solid' | 'gradient' | 'sky' | 'hdri'
   */
  _onBackgroundChange({ detail } = {}) {
    if (!this.scene) return;
    const { type, color, colorStops = [] } = detail ?? {};
    console.log(`[CYCO:ENV] cyco-background-change  type=${type}  stops=${colorStops.length}`);

    // Track type so _onSkyChange knows not to overwrite a gradient/hdri background
    this._bgType = type;

    // Remove sky if switching away from it
    if (type !== 'sky') {
      const sky = this.scene.getObjectByName('__cyco_sky');
      if (sky) { this.scene.remove(sky); sky.geometry?.dispose(); }
      this.skyEnabled = false;
    }

    // Dispose previous gradient texture to free GPU memory
    if (this._bgGradTex) {
      this._bgGradTex.dispose();
      this._bgGradTex = null;
    }

    if (type === 'solid') {
      this.scene.background = new THREE.Color(color ?? '#1a1a1a');
    } else if (type === 'gradient') {
      this._bgGradTex = this._makeGradientTexture(colorStops);
      this.scene.background = this._bgGradTex;
    } else if (type === 'hdri') {
      this.scene.background = this._lastEnvMap ?? new THREE.Color(0x1a1a1a);
    } else if (type === 'sky') {
      this.scene.background = null;
    }
  }

  /**
   * Build a tall canvas texture from GradientEditor colorStops.
   * Supports multi-stop gradients with per-stop Gaussian blend softening.
   * Works in both WebGL and WebGPU renderers.
   * @param {Array<{pos:number,color:string,blend?:number}>} colorStops
   * @returns {THREE.CanvasTexture}
   */
  _makeGradientTexture(colorStops) {
    const h = 512;
    const canvas = document.createElement('canvas');
    canvas.width  = 2;
    canvas.height = h;
    const ctx = canvas.getContext('2d');

    const stops = Array.isArray(colorStops) && colorStops.length
      ? [...colorStops].sort((a, b) => a.pos - b.pos)
      : [{ pos: 0, color: '#87ceeb' }, { pos: 0.5, color: '#d4a56a' }, { pos: 1, color: '#4a3b2a' }];

    const hasBlend = stops.some(s => (s.blend ?? 0) > 0.001);

    if (!hasBlend) {
      // Fast path: native canvas gradient
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      stops.forEach(s => { try { grad.addColorStop(s.pos, s.color); } catch {} });
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 2, h);
    } else {
      // Per-pixel path with Gaussian blur for blend softening
      const parse = hex => {
        const n = parseInt(hex.replace('#', ''), 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      };
      const linear = new Float32Array(h * 3);
      for (let y = 0; y < h; y++) {
        const t = y / (h - 1);
        let r, g, b;
        if (t <= stops[0].pos) {
          [r, g, b] = parse(stops[0].color);
        } else if (t >= stops[stops.length - 1].pos) {
          [r, g, b] = parse(stops[stops.length - 1].color);
        } else {
          let s0 = stops[0], s1 = stops[stops.length - 1];
          for (let j = 0; j < stops.length - 1; j++) {
            if (t >= stops[j].pos && t <= stops[j + 1].pos) { s0 = stops[j]; s1 = stops[j + 1]; break; }
          }
          const rawT = (t - s0.pos) / (s1.pos - s0.pos + 1e-9);
          const [r0, g0, b0] = parse(s0.color);
          const [r1, g1, b1] = parse(s1.color);
          r = r0 + (r1 - r0) * rawT; g = g0 + (g1 - g0) * rawT; b = b0 + (b1 - b0) * rawT;
        }
        linear[y * 3] = r; linear[y * 3 + 1] = g; linear[y * 3 + 2] = b;
      }
      const output = linear.slice();
      for (let si = 0; si < stops.length - 1; si++) {
        const s0 = stops[si], s1 = stops[si + 1];
        const bAmt = Math.max(s0.blend ?? 0, s1.blend ?? 0);
        if (bAmt < 0.001) continue;
        const y0 = Math.round(s0.pos * (h - 1));
        const y1 = Math.round(s1.pos * (h - 1));
        const radius = Math.ceil(bAmt * Math.max(y1 - y0, 1) * 8.0);
        const sigma  = radius / 2.5 + 1;
        for (let y = Math.max(0, y0 - radius); y <= Math.min(h - 1, y1 + radius); y++) {
          let sr = 0, sg = 0, sb = 0, sw = 0;
          for (let dy = -radius; dy <= radius; dy++) {
            const ny = Math.max(0, Math.min(h - 1, y + dy));
            const wk = Math.exp(-0.5 * (dy / sigma) ** 2);
            sr += wk * linear[ny * 3]; sg += wk * linear[ny * 3 + 1]; sb += wk * linear[ny * 3 + 2]; sw += wk;
          }
          if (sw > 0) { output[y * 3] = sr / sw; output[y * 3 + 1] = sg / sw; output[y * 3 + 2] = sb / sw; }
        }
      }
      const imgData = ctx.createImageData(2, h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < 2; x++) {
          const pi = (y * 2 + x) * 4;
          imgData.data[pi]     = Math.round(output[y * 3]);
          imgData.data[pi + 1] = Math.round(output[y * 3 + 1]);
          imgData.data[pi + 2] = Math.round(output[y * 3 + 2]);
          imgData.data[pi + 3] = 255;
        }
      }
      ctx.putImageData(imgData, 0, 0);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }

  /** Restore or switch the env map preset. */
  _onEnvPreset({ detail } = {}) {
    const preset = detail?.preset;
    console.log(`[CYCO:ENV] cyco-env-preset  preset=${preset}`);
    if (preset === 'room') {
      this._setupIBL();
      return;
    }
    // Sky presets — build gradient env map directly without touching the sky render mesh
    const SKY_PRESETS = {
      'sunny':     { top: '#87CEEB', mid: '#d0e8ff', bot: '#c8daf0' },
      'golden':    { top: '#3a3a6a', mid: '#e07040', bot: '#f0a060' },
      'overcast':  { top: '#888888', mid: '#aaaaaa', bot: '#bbbbbb' },
      'night':     { top: '#000010', mid: '#000020', bot: '#050520' },
      'studio':    { top: '#cccccc', mid: '#e0e0e0', bot: '#aaaaaa' },
    };
    const stops = SKY_PRESETS[preset];
    if (stops) {
      const colorStops = [
        { pos: 0,   color: stops.bot },
        { pos: 0.5, color: stops.mid },
        { pos: 1,   color: stops.top },
      ];
      const renderer = this.rendererManager.renderer;
      if (renderer) this._buildSkyEnvMap(colorStops, renderer);
    }
  }

  /** Set scene environment intensity. */
  _onEnvIntensity({ detail } = {}) {
    if (this.scene && detail?.intensity !== undefined) {
      this.scene.environmentIntensity = Math.max(0, Math.min(5, detail.intensity));
    }
  }

  /**
   * Show/hide the grid helper.
   * @param {boolean} visible
   */
  setGridVisible(visible) {
    if (this.gridHelper) this.gridHelper.visible = visible;
  }

  /** Reconfigure the grid (size + divisions). */
  setGridConfig(size, divisions) {
    if (this.gridHelper) {
      this.scene.remove(this.gridHelper);
      this.gridHelper.geometry?.dispose();
    }
    this.gridHelper = this._makeGrid(size, divisions);
    this.scene.add(this.gridHelper);
  }

  // ─── Grid helpers ─────────────────────────────────────────────────────────

  /** Fully dispose and remove the current gridHelper from the scene. */
  _disposeGridHelper() {
    if (!this.gridHelper) return;
    if (this.scene) this.scene.remove(this.gridHelper);
    this.gridHelper.geometry?.dispose();
    const mats = Array.isArray(this.gridHelper.material)
      ? this.gridHelper.material : [this.gridHelper.material];
    mats.forEach(m => m?.dispose?.());
    this.gridHelper = null;
  }

  /**
   * Handle cyco-grid-settings-change.
   * For TSL grids (infinite/checkered) already in the scene, updates uniforms in-place
   * so sliders give live feedback without shader recompilation.
   * Style changes and first-time builds use a generation counter to cancel stale async work.
   */
  _onGridSettings({ detail } = {}) {
    if (!this.scene) return;
    const d = detail ?? {};

    // Axes visibility always applies
    if (this.axesHelper) this.axesHelper.visible = d.axesVisible !== false;

    const newStyle  = d.style ?? 'standard';
    const curName   = this.gridHelper?.name ?? '';
    const isInfNow  = curName === '__cyco_infinite_grid';
    const isChkNow  = curName === '__cyco_checker_grid';

    // ── In-place uniform update (no shader rebuild needed) ──────────────────
    if (newStyle === 'infinite' && isInfNow) {
      this._updateInfiniteUniforms(d);
      this.gridHelper.visible = d.gridVisible !== false;
      return;
    }
    if ((newStyle === 'checkered' || newStyle === 'checkered-infinite') && isChkNow) {
      this._updateCheckerUniforms(d);
      this.gridHelper.visible = d.gridVisible !== false;
      return;
    }

    // ── Full rebuild ─────────────────────────────────────────────────────────
    // Increment generation to cancel any in-flight async build
    this._gridGen = (this._gridGen ?? 0) + 1;

    this._disposeGridHelper();

    if (d.gridVisible === false) return;

    if (newStyle === 'infinite') {
      const gen = this._gridGen;
      this._makeInfiniteGrid(d).then(mesh => {
        if (this._gridGen !== gen || !mesh || !this.scene) return;
        this._disposeGridHelper();   // remove any grid added between dispatch and resolve
        this.gridHelper = mesh;
        this.scene.add(mesh);
      });

    } else if (newStyle === 'checkered' || newStyle === 'checkered-infinite') {
      const gen = this._gridGen;
      this._makeCheckerGrid(d).then(mesh => {
        if (this._gridGen !== gen || !mesh || !this.scene) return;
        this._disposeGridHelper();
        this.gridHelper = mesh;
        this.scene.add(mesh);
      });

    } else {
      // Standard GridHelper — synchronous, cheap
      const gc = new THREE.Color(d.gridColor   ?? '#444444');
      const cc = new THREE.Color(d.centerColor ?? '#888888');
      const g  = new THREE.GridHelper(d.size ?? 20, d.divisions ?? 20, cc, gc);
      g.raycast        = () => {};
      g.userData._isHelper = true;
      g.castShadow     = false;
      g.receiveShadow  = false;
      const mats = Array.isArray(g.material) ? g.material : [g.material];
      mats.forEach(m => {
        m.opacity     = d.opacity ?? 1.0;
        m.transparent = (d.opacity ?? 1.0) < 1.0;
      });
      this.gridHelper = g;
      this.scene.add(g);
    }
  }

  /** Live-update uniforms for the current infinite grid mesh (no rebuild). */
  _updateInfiniteUniforms(d) {
    const u = this.gridHelper?._uniforms;
    if (!u) return;
    if (d.gridColor   !== undefined) u.uLineColor.value.set(d.gridColor);
    if (d.xAxisColor  !== undefined) u.uXColor.value.set(d.xAxisColor);
    if (d.zAxisColor  !== undefined) u.uZColor.value.set(d.zAxisColor);
    if (d.opacity     !== undefined) u.uOpacity.value = d.opacity;
    if (d.cellSize    !== undefined) u.uCellSize.value = d.cellSize;
  }

  /** Live-update uniforms for the current checker grid mesh (no rebuild). */
  _updateCheckerUniforms(d) {
    const u = this.gridHelper?._uniforms;
    if (!u) return;
    if (d.checkerColor1 !== undefined) u.uColor1.value.set(d.checkerColor1);
    if (d.checkerColor2 !== undefined) u.uColor2.value.set(d.checkerColor2);
    if (d.opacity       !== undefined) u.uOpacity.value = d.opacity;
    if (d.checkerSize   !== undefined) u.uCellSize.value = d.checkerSize;
  }

  // ─── Build helpers ────────────────────────────────────────────────────────

  /**
   * Build a simple equirectangular env map from the sky gradient colour stops
   * and apply it to scene.environment so metallic/glass materials reflect the sky.
   * @param {Array<{pos:number,color:string}>} colorStops
   * @param {THREE.WebGLRenderer|WebGPURenderer} renderer
   */
  async _buildSkyEnvMap(colorStops, renderer) {
    const glRenderer = renderer?._webglRenderer ?? renderer;
    let PMREMGen;
    if (glRenderer?.isWebGLRenderer) {
      PMREMGen = THREE.PMREMGenerator;
    } else if (glRenderer?.isWebGPURenderer || renderer?.isWebGPURenderer) {
      const actualRenderer = renderer?.isWebGPURenderer ? renderer : glRenderer;
      try {
        const mod = await import('three/webgpu');
        PMREMGen = mod.PMREMGenerator;
        // For WebGPU path, re-assign glRenderer reference used below
        Object.defineProperty(this, '_skyEnvMapGPURenderer', { value: actualRenderer, configurable: true });
      } catch { return; }
    } else {
      return;
    }
    // Resolve the renderer to use for PMREMGenerator
    const pmremRenderer = PMREMGen === THREE.PMREMGenerator ? glRenderer : (this._skyEnvMapGPURenderer ?? renderer);
    try {
      const w = 512, h = 256;
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');

      // Equirectangular: top row = zenith (pos=1), bottom = nadir (pos=0)
      const sorted = [...colorStops].sort((a, b) => a.pos - b.pos);
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      for (const s of sorted) {
        grad.addColorStop(1.0 - s.pos, s.color);
      }
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      const tex = new THREE.CanvasTexture(canvas);
      tex.mapping    = THREE.EquirectangularReflectionMapping;
      tex.colorSpace = THREE.SRGBColorSpace;

      const pmrem  = new PMREMGen(pmremRenderer);
      if (typeof pmrem.compileEquirectangularShader === 'function') {
        pmrem.compileEquirectangularShader();
      }
      const envTex = pmrem.fromEquirectangular(tex).texture;
      pmrem.dispose();
      tex.dispose();

      if (this._skyEnvTex) this._skyEnvTex.dispose();
      this._skyEnvTex    = envTex;
      this.scene.environment = envTex;
    } catch (e) {
      console.warn('[ViewportEngine] Sky env map build failed:', e);
    }
  }

  _buildScene(w, h) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a1a);

    // Default camera
    this.camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 10000);
    this.camera.position.set(5, 5, 5);
    this.camera.lookAt(0, 0, 0);

    // Non-hierarchy lights (not shown in scene tree)
    this._ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
    this._hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x888888, 0.4);
    this.scene.add(this._ambientLight, this._hemisphereLight);

    // Grid + axes (non-selectable) — use saved settings if available
    this.axesHelper = new THREE.AxesHelper(1);
    this.axesHelper.raycast = () => {};
    this.axesHelper.userData._isHelper = true;
    this.scene.add(this.axesHelper);

    // Apply persisted grid settings (may build infinite grid asynchronously)
    try {
      const saved = JSON.parse(localStorage.getItem('cyco-grid-settings') ?? '{}');
      const gridDefaults = { divisions: 20, size: 20, gridColor: '#444444', centerColor: '#888888',
        opacity: 1.0, gridVisible: true, axesVisible: true, style: 'standard' };
      this._onGridSettings({ detail: { ...gridDefaults, ...saved } });
    } catch (_) {
      this.gridHelper = this._makeGrid(20, 20);
      this.scene.add(this.gridHelper);
    }
    // IBL intensity: 1.0 ensures metallic/glass materials show full reflections.
    // Directional shadows stay visible because they are multiplicative on top of IBL.
    this.scene.environmentIntensity = 1.0;
  }

  _makeGrid(size, divisions) {
    const g = new THREE.GridHelper(size, divisions, 0x888888, 0x555555);
    g.raycast = () => {}; // non-selectable
    g.userData._isHelper = true;
    g.castShadow    = false;
    g.receiveShadow = false;
    return g;
  }

  /**
   * Infinite Unreal Engine-style grid — "Pristine Grid" algorithm (Ben Golus).
   * Uses fwidth-based AA per-axis: no aliasing at any distance, lines have true
   * perspective thickness. Red X axis, blue Z axis. 10 000×10 000 plane looks infinite.
   * All visual properties are TSL uniforms for live updates without shader recompilation.
   */
  async _makeInfiniteGrid(opts = {}) {
    try {
      const [webgpuMod, tslMod] = await Promise.all([
        import('three/webgpu'),
        import('three/tsl'),
      ]);
      const { MeshBasicNodeMaterial } = webgpuMod;
      const { Fn, abs, fract, fwidth, mix, clamp, smoothstep, vec4, float, positionWorld, max, uniform } = tslMod;

      // ── Live-update uniforms ───────────────────────────────────────────────
      const uCellSize  = uniform(opts.cellSize  ?? 1.0);
      const uLineW     = uniform(opts.lineWidth ?? 0.02);
      const uLineColor = uniform(new THREE.Color(opts.gridColor  ?? '#555555'));
      const uXColor    = uniform(new THREE.Color(opts.xAxisColor ?? '#CC2222'));
      const uZColor    = uniform(new THREE.Color(opts.zAxisColor ?? '#2244CC'));
      const uOpacity   = uniform(opts.opacity   ?? 1.0);

      // ── Pristine Grid — single axis (Bgolus technique) ────────────────────
      // fwidth gives the screen-space derivative; we clamp draw width to 0.5
      // and fade the line so it converges to the correct average brightness.
      // Moiré suppression: lerp to solid color when deriv > 0.5.
      const prisAxis = Fn(([t, lw]) => {
        const d  = fwidth(t);
        const dw = clamp(lw, d, float(0.5));
        const aa = d.mul(1.5);
        const g  = float(1.0).sub(fract(t).mul(2.0).sub(1.0).abs());    // 1 at grid line, 0 at center
        const line = smoothstep(dw.add(aa), dw.sub(aa), g)
                       .mul(clamp(lw.div(dw), float(0.0), float(1.0))); // phone-wire fade
        return mix(line, lw, clamp(d.mul(2.0).sub(1.0), float(0.0), float(1.0))); // Moiré suppress
      });

      // ── Single axis line at coord = 0 (X axis = z=0, Z axis = x=0) ───────
      const axisLine = Fn(([coord, lw]) => {
        const d  = fwidth(coord);
        const dw = clamp(lw, d, float(0.5));
        const aa = d.mul(1.5);
        const line = smoothstep(dw.add(aa), dw.sub(aa), abs(coord))
                       .mul(clamp(lw.div(dw), float(0.0), float(1.0)));
        return mix(line, lw, clamp(d.mul(2.0).sub(1.0), float(0.0), float(1.0)));
      });

      // Scale world XZ by 1/cellSize so lines are cellSize world-units apart
      const sx = positionWorld.x.div(uCellSize);
      const sz = positionWorld.z.div(uCellSize);

      const axisW  = uLineW.mul(3.0);  // axis lines 3× thicker than grid
      const gx     = prisAxis(sx, uLineW);
      const gz     = prisAxis(sz, uLineW);
      const gridMask = mix(gx, float(1.0), gz);  // premultiplied union

      // X axis (red): line at z=0; Z axis (blue): line at x=0
      const xAxis = axisLine(sz, axisW);
      const zAxis = axisLine(sx, axisW);

      // Composite colors: grid → x-axis override → z-axis override
      const colMid   = uLineColor.mix(uXColor, xAxis);
      const colFinal = colMid.mix(uZColor, zAxis);
      const alpha    = max(gridMask, max(xAxis, zAxis)).mul(uOpacity);

      const material = new MeshBasicNodeMaterial();
      material.transparent = true;
      material.depthWrite  = false;
      material.side        = THREE.DoubleSide;
      material.colorNode   = vec4(colFinal, alpha);

      const plane = new THREE.Mesh(new THREE.PlaneGeometry(10000, 10000), material);
      plane.rotation.x         = -Math.PI / 2;
      plane.renderOrder        = -1;
      plane.raycast            = () => {};
      plane.userData._isHelper = true;
      plane.castShadow         = false;
      plane.receiveShadow      = false;
      plane.name               = '__cyco_infinite_grid';
      plane._uniforms          = { uCellSize, uLineW, uLineColor, uXColor, uZColor, uOpacity };
      return plane;

    } catch (e) {
      console.warn('[ViewportEngine] Infinite grid failed, falling back to standard:', e);
      return null;
    }
  }

  /**
   * Checkerboard grid (finite or infinite depending on opts.style).
   * Hard-edge alternating squares in world XZ space.
   * 'checkered'          — large plane (400u) with radial opacity fade at edges.
   * 'checkered-infinite' — 10 000u plane, no fade.
   * All visual properties are TSL uniforms for live updates.
   */
  async _makeCheckerGrid(opts = {}) {
    try {
      const [webgpuMod, tslMod] = await Promise.all([
        import('three/webgpu'),
        import('three/tsl'),
      ]);
      const { MeshBasicNodeMaterial } = webgpuMod;
      const { Fn, floor, mod, mix, smoothstep, length, vec4, float, positionWorld, uniform } = tslMod;

      // ── Live-update uniforms ───────────────────────────────────────────────
      const uCellSize = uniform(opts.checkerSize ?? 1.0);
      const uColor1   = uniform(new THREE.Color(opts.checkerColor1 ?? '#333333'));
      const uColor2   = uniform(new THREE.Color(opts.checkerColor2 ?? '#555555'));
      const uOpacity  = uniform(opts.opacity ?? 1.0);

      const infinite = opts.style === 'checkered-infinite';

      // ── Checker pattern via world-space XZ ────────────────────────────────
      // floor(XZ / cellSize) gives integer cell coords; mod(x+z, 2) alternates 0/1
      const cellX   = floor(positionWorld.x.div(uCellSize));
      const cellZ   = floor(positionWorld.z.div(uCellSize));
      const pattern = mod(cellX.add(cellZ), float(2.0));  // exactly 0.0 or 1.0

      const checkerColor = uColor1.mix(uColor2, pattern);

      let alphaNode;
      if (infinite) {
        alphaNode = uOpacity;
      } else {
        // Fade to transparent beyond a radius so it doesn't look like a finite plane
        const fadeR  = float(80.0);
        const fadeF  = float(50.0);
        const dist   = length(positionWorld.xz);
        const fade   = smoothstep(fadeR, fadeR.sub(fadeF), dist);
        alphaNode    = uOpacity.mul(fade);
      }

      const material = new MeshBasicNodeMaterial();
      material.transparent = true;
      material.depthWrite  = false;
      material.side        = THREE.DoubleSide;
      material.colorNode   = vec4(checkerColor, alphaNode);

      const planeSize = infinite ? 10000 : 400;
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(planeSize, planeSize), material);
      plane.rotation.x         = -Math.PI / 2;
      plane.renderOrder        = -1;
      plane.raycast            = () => {};
      plane.userData._isHelper = true;
      plane.castShadow         = false;
      plane.receiveShadow      = false;
      plane.name               = '__cyco_checker_grid';
      plane._uniforms          = { uCellSize, uColor1, uColor2, uOpacity };
      return plane;

    } catch (e) {
      console.warn('[ViewportEngine] Checker grid failed, falling back to standard:', e);
      return null;
    }
  }

  /**
   * IBL setup via PMREMGenerator.
   * MUST call pmrem.dispose() after use — holds WebGL render targets.
   */
  async _setupIBL() {
    console.log('[CYCO:ENV] _setupIBL() — building RoomEnvironment IBL');
    let renderer = this.rendererManager.renderer;
    if (!renderer) return;
    // PathTracingRenderer wraps an inner WebGLRenderer — use that for IBL
    if (renderer._webglRenderer) renderer = renderer._webglRenderer;

    let PMREMGen;
    if (renderer.isWebGLRenderer) {
      PMREMGen = THREE.PMREMGenerator;
    } else if (renderer.isWebGPURenderer) {
      // WebGPURenderer (even forceWebGL) uses its own PMREMGenerator from three/webgpu
      try {
        const mod = await import('three/webgpu');
        PMREMGen = mod.PMREMGenerator;
      } catch (e) {
        console.warn('[CYCO:ENV] _setupIBL() SKIP — could not load WebGPU PMREMGenerator:', e);
        return;
      }
    } else {
      console.log('[CYCO:ENV] _setupIBL() SKIP — unsupported renderer type');
      return;
    }

    try {
      const pmrem = new PMREMGen(renderer);
      // compileEquirectangularShader() is a WebGL-only pre-warm — skip on WebGPU
      if (typeof pmrem.compileEquirectangularShader === 'function') {
        pmrem.compileEquirectangularShader();
      }
      const envTexture = pmrem.fromScene(new RoomEnvironment()).texture;
      pmrem.dispose();
      this.scene.environment = envTexture;
      console.log('[CYCO:ENV] _setupIBL() done — scene.environment set  envIntensity=' + this.scene.environmentIntensity);
    } catch (e) {
      console.warn('[ViewportEngine] IBL setup failed:', e);
    }
  }

  _buildControls() {
    const renderer = this.rendererManager.renderer;
    if (!renderer?.domElement || !this.camera) return;

    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping   = true;
    this.controls.dampingFactor   = 0.05;
    // Prevent camera from reaching the exact north/south pole where azimuth
    // rotation becomes degenerate and the orbit appears completely frozen.
    this.controls.minPolarAngle   = 0.01;             // ~0.57° from top
    this.controls.maxPolarAngle   = Math.PI - 0.01;  // ~178.9° — never south pole
    this.controls.mouseButtons    = {
      LEFT:   THREE.MOUSE.ROTATE,   // left-drag to orbit; click-only selection handled by SelectionManager
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT:  THREE.MOUSE.ROTATE,   // right-drag also orbits
    };
    this.controls.touches = {
      ONE: THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.DOLLY_PAN,
    };

    // ── Debug: orbit event listeners ─────────────────────────────────────────
    let _orbitCount = 0;
    const _camStr = () => {
      const c = this.camera;
      const t = this.controls.target;
      const polar   = (this.controls.getPolarAngle?.()    ?? 0) * 180 / Math.PI;
      const azimuth = (this.controls.getAzimuthalAngle?.() ?? 0) * 180 / Math.PI;
      return `cam=(${c.position.x.toFixed(2)},${c.position.y.toFixed(2)},${c.position.z.toFixed(2)})` +
             `  target=(${t.x.toFixed(2)},${t.y.toFixed(2)},${t.z.toFixed(2)})` +
             `  polar=${polar.toFixed(1)}°  azimuth=${azimuth.toFixed(1)}°`;
    };
    this.controls.addEventListener('start', () => {
      _orbitCount = 0;
      console.log(`%c[CYCO:ORBIT] ▶ START  ${_camStr()}`, 'color:#8f8;font-weight:bold');
    });
    this.controls.addEventListener('change', () => {
      if (window.CYCO_DEBUG_RENDER !== true) return;
      _orbitCount++;
      if (_orbitCount % 30 !== 1) return; // throttle — every 30th change event
      console.log(`%c[CYCO:ORBIT] ↺ change #${_orbitCount}  ${_camStr()}`, 'color:#8f8');
    });
    this.controls.addEventListener('end', () => {
      console.log(
        `%c[CYCO:ORBIT] ■ END (${_orbitCount} changes)  ${_camStr()}`,
        'color:#8f8;font-weight:bold'
      );
    });
  }

  _buildViewHelper() {
    this._disposeHelperOverlay();
    const renderer = this.rendererManager.renderer;
    if (!renderer?.domElement || !this.camera) return;
    this.viewHelper = new ViewHelper(this.camera, renderer.domElement);
    if (renderer.isWebGPURenderer) this._buildHelperOverlay();
  }

  /**
   * In WebGPU mode the WebGPU renderer's internal output-blit overwrites the main
   * scene in the ViewHelper region, producing a black box.  Fix: render the gizmo
   * to a tiny overlay <canvas> using a secondary plain WebGLRenderer whose canvas
   * is absolutely positioned over the viewport container.  The secondary canvas has
   * alpha=true so transparent pixels show the main scene beneath it.
   */
  _buildHelperOverlay() {
    const container = this._container;
    if (!container) return;

    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';

    const dim = 128;

    // Let Three.js create and size the canvas — avoids setPixelRatio/setSize conflicts.
    const helperRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: false });
    helperRenderer.setPixelRatio(window.devicePixelRatio || 1);
    helperRenderer.setSize(dim, dim);
    helperRenderer.setClearColor(0x000000, 0);
    helperRenderer.autoClear = false;

    const overlayCanvas = helperRenderer.domElement;
    Object.assign(overlayCanvas.style, {
      position: 'absolute', bottom: '0', right: '0',
      width: `${dim}px`, height: `${dim}px`,
      pointerEvents: 'none', zIndex: '10',
    });
    container.appendChild(overlayCanvas);

    this._helperOverlayRenderer = helperRenderer;
    this._helperOverlayCanvas   = overlayCanvas;
  }

  _disposeHelperOverlay() {
    this._helperOverlayRenderer?.dispose();
    this._helperOverlayCanvas?.remove();
    this._helperOverlayRenderer = null;
    this._helperOverlayCanvas   = null;
  }

  _buildLoadingOverlay(container) {
    // Remove any previous overlay (e.g. container swap)
    this._loadingOverlay?.remove();

    // Ensure the container is a positioning ancestor
    if (getComputedStyle(container).position === 'static') {
      container.style.position = 'relative';
    }

    // Inject spin keyframes once
    if (!document.getElementById('cyco-loading-kf')) {
      const kf = document.createElement('style');
      kf.id = 'cyco-loading-kf';
      kf.textContent = '@keyframes cyco-spin{to{transform:rotate(360deg)}}';
      document.head.appendChild(kf);
    }

    const ov = document.createElement('div');
    Object.assign(ov.style, {
      position: 'absolute', inset: '0',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      background: 'rgba(22,19,14,0.88)',
      zIndex: '999',
      opacity: '0',
      transition: 'opacity 0.2s ease',
      pointerEvents: 'none',
      userSelect: 'none',
    });

    // Spinner ring
    const spinner = document.createElement('div');
    Object.assign(spinner.style, {
      width: '30px', height: '30px',
      borderRadius: '50%',
      border: '3px solid rgba(255,255,255,0.12)',
      borderTopColor: '#e87d3e',
      animation: 'cyco-spin 0.75s linear infinite',
      marginBottom: '14px',
      flexShrink: '0',
    });

    // Filename
    const fileLabel = document.createElement('div');
    Object.assign(fileLabel.style, {
      color: 'rgba(255,255,255,0.55)',
      fontSize: '11px',
      maxWidth: '230px',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      marginBottom: '10px',
      textAlign: 'center',
    });
    fileLabel.textContent = 'Loading…';

    // Progress track
    const track = document.createElement('div');
    Object.assign(track.style, {
      width: '200px', height: '4px',
      background: 'rgba(255,255,255,0.1)',
      borderRadius: '2px',
      overflow: 'hidden',
      marginBottom: '7px',
    });

    const fill = document.createElement('div');
    Object.assign(fill.style, {
      height: '100%', width: '0%',
      background: '#e87d3e',
      borderRadius: '2px',
      transition: 'width 0.15s ease',
    });
    track.appendChild(fill);

    // "N of M" counter
    const counter = document.createElement('div');
    Object.assign(counter.style, {
      color: 'rgba(255,255,255,0.3)',
      fontSize: '10px',
    });

    ov.appendChild(spinner);
    ov.appendChild(fileLabel);
    ov.appendChild(track);
    ov.appendChild(counter);
    container.appendChild(ov);

    this._loadingOverlay   = ov;
    this._loadingFill      = fill;
    this._loadingFileLabel = fileLabel;
    this._loadingCounter   = counter;
  }

  // ─── Loading overlay handlers ─────────────────────────────────────────────

  _onLoadingStart({ detail } = {}) {
    if (!this._loadingOverlay) return;
    this._loadingFill.style.width = '0%';
    this._loadingFill.style.background = '#e87d3e';
    this._loadingFileLabel.textContent = _shortFilename(detail?.url ?? '');
    this._loadingCounter.textContent = '';
    this._loadingOverlay.style.opacity = '1';
    this._loadingOverlay.style.pointerEvents = 'auto';
    clearTimeout(this._loadingHideTimer);
  }

  _onLoadingProgress({ detail } = {}) {
    if (!this._loadingOverlay) return;
    const { url, loaded, total, pct } = detail ?? {};
    this._loadingFill.style.width = `${pct ?? 0}%`;
    this._loadingFileLabel.textContent = _shortFilename(url ?? '');
    this._loadingCounter.textContent = total > 0 ? `${loaded} of ${total}` : '';
  }

  _onLoadingDone() {
    if (!this._loadingOverlay) return;
    this._loadingFill.style.width = '100%';
    clearTimeout(this._loadingHideTimer);
    this._loadingHideTimer = setTimeout(() => {
      if (this._loadingOverlay) {
        this._loadingOverlay.style.opacity = '0';
        this._loadingOverlay.style.pointerEvents = 'none';
      }
    }, 350);
  }

  _onLoadingError({ detail } = {}) {
    if (!this._loadingOverlay) return;
    this._loadingFileLabel.textContent = `⚠ Error: ${_shortFilename(detail?.url ?? '')}`;
    this._loadingFill.style.background = '#e84040';
    clearTimeout(this._loadingHideTimer);
    this._loadingHideTimer = setTimeout(() => {
      if (this._loadingOverlay) {
        this._loadingOverlay.style.opacity = '0';
        this._loadingOverlay.style.pointerEvents = 'none';
        this._loadingFill.style.background = '#e87d3e';
      }
    }, 2500);
  }

  _buildResizeObserver(container) {
    this._resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        this._handleResize(width, height);
      }
    });
    this._resizeObserver.observe(container);
  }

  _buildContextMenu(container) {
    // _didDrag: set true whenever the right button is held and the mouse moves > 4 px.
    // Cleared on every right mousedown so each click starts fresh.
    // The contextmenu event suppresses the menu (and clears the flag) if a drag occurred.
    let _didDrag = false;
    let _rdX = 0, _rdY = 0;
    this._onRightMousedown = (e) => {
      if (e.button === 2) { _rdX = e.clientX; _rdY = e.clientY; _didDrag = false; }
    };
    this._onMousemoveCtx = (e) => {
      // e.buttons bit 2 = right button held
      if ((e.buttons & 2) && !_didDrag) {
        if (Math.hypot(e.clientX - _rdX, e.clientY - _rdY) > 4) _didDrag = true;
      }
    };
    document.addEventListener('mousedown', this._onRightMousedown);
    document.addEventListener('mousemove', this._onMousemoveCtx);

    this._onContextMenu = (e) => {
      // Only handle right-click on the viewport canvas
      const canvas = this.rendererManager.renderer?.domElement;
      if (!canvas || (!canvas.contains(e.target) && e.target !== canvas)) return;
      e.preventDefault();

      // If right button was dragged, this was an orbit/pan — skip menu
      if (_didDrag) { _didDrag = false; return; }
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const ndcX = (px / rect.width)  * 2 - 1;
      const ndcY = -(py / rect.height) * 2 + 1;

      // Raycast to find hovered object
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
      const hits = raycaster.intersectObjects(this.scene.children, true);
      const hit = hits.find(h => !h.object.userData._isGizmo && h.object.type !== 'GridHelper' && h.object.type !== 'AxesHelper')?.object ?? null;

      window.dispatchEvent(new CustomEvent('cyco-vp-contextmenu', {
        detail: { x: e.clientX, y: e.clientY, hit }
      }));
    };
    document.addEventListener('contextmenu', this._onContextMenu);
    this._contextMenuContainer = container;
  }

  _handleResize(width, height) {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));

    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();

    this.rendererManager.resize(w, h);

    window.dispatchEvent(new CustomEvent('cyco-vp-resize', { detail: { width: w, height: h } }));
  }

  // ─── Render loop ─────────────────────────────────────────────────────────

  _startLoop() {
    const loop = (timestamp) => {
      this._rafId = requestAnimationFrame(loop);
      this._tick(timestamp);
    };
    this._rafId = requestAnimationFrame(loop);
  }

  _tick(timestamp) {
    this._timer.update(timestamp);
    const delta = this._timer.getDelta();

    // ── Debug instrumentation ─────────────────────────────────────────────────
    // Enable with: window.CYCO_DEBUG_RENDER = true
    // Disable with: window.CYCO_DEBUG_RENDER = false
    if (!this._dbgFrame) this._dbgFrame = 0;
    this._dbgFrame++;
    window._cycoDbgFrame = this._dbgFrame;
    window._cycoDbgCanvasWrites = 0;
    const _D = window.CYCO_DEBUG_RENDER === true;
    // ─────────────────────────────────────────────────────────────────────────

    // Focus lerp animation
    if (this._focusAnim) {
      this._tickFocusAnim(delta);
    }

    // OrbitControls damping
    if (this.controls) this.controls.update();

    const renderer = this.rendererManager.renderer;
    if (!renderer || !this.scene || !this.camera) return;

    if (_D) {
      const rt  = renderer.getRenderTarget();
      const sz  = new THREE.Vector2();
      renderer.getSize(sz);
      const cam = this.camera;
      console.group(
        `%c[CYCO:VPE] ──── Frame #${this._dbgFrame} ────`,
        'color:#fc8;font-weight:bold;font-size:11px'
      );
      console.log(
        `%c  [RENDERER] autoClear=${renderer.autoClear}  clearAlpha=${renderer.clearAlpha}` +
        `  RT=${rt ? `RT(${rt.width}×${rt.height})` : 'null→CANVAS'}  pixelRatio=${renderer.getPixelRatio()}`,
        'color:#aaa'
      );
      console.log(
        `%c  [CANVAS]   drawingBuffer=${renderer.domElement.width}×${renderer.domElement.height}` +
        `  css=${renderer.domElement.offsetWidth}×${renderer.domElement.offsetHeight}` +
        `  logicalSize=${sz.x.toFixed(0)}×${sz.y.toFixed(0)}`,
        'color:#aaa'
      );
      console.log(
        `%c  [CAMERA]   pos=(${cam.position.x.toFixed(2)},${cam.position.y.toFixed(2)},${cam.position.z.toFixed(2)})` +
        `  near=${cam.near}  far=${cam.far}  fov=${cam.fov}`,
        'color:#aaa'
      );
      console.log(
        `%c  [PIPELINE] _pipelineActive=${this._pipelineActive}  hasContactShadows=${!!this.contactShadows}` +
        `  hasViewHelper=${!!this.viewHelper}  hasClouds=${!!this.cloudSystem}`,
        'color:#aaa'
      );
      // Per-frame light snapshot — throttled to every 120 frames to avoid flooding
      if (this._dbgFrame % 120 === 1 && this.scene) {
        const _lights = [];
        this.scene.traverse(obj => {
          if (obj.isLight) {
            const col = obj.color ? `#${obj.color.getHexString()}` : '';
            const gnd = obj.groundColor ? ` gnd=#${obj.groundColor.getHexString()}` : '';
            _lights.push(`${obj.type}(i=${obj.intensity?.toFixed(2)} col=${col}${gnd})`);
          }
        });
        console.log(
          `%c  [LIGHTS]   count=${_lights.length}  [${_lights.join(' | ')}]`,
          'color:#aaa'
        );
        const sc = this.scene;
        console.log(
          `%c  [SCENE]    envIntensity=${sc.environmentIntensity}  bg=${sc.background?.constructor?.name ?? sc.background}` +
          `  fog=${sc.fog?.constructor?.name ?? 'none'}  objs=${sc.children.length}`,
          'color:#aaa'
        );
      }
    }

    // Volumetric clouds update (time + camera follow)
    this.cloudSystem?.update();
    this.cloudSystem2?.update();

    // Gradient sky follows camera
    this.gradientSky?.update();

    // Contact shadows — renders depth pass + blur before main frame
    if (_D && this.contactShadows) {
      const rt = renderer.getRenderTarget();
      console.log(
        `%c  [CONTACT-SHADOWS] update() start  RT=${rt ? `RT(${rt.width}×${rt.height})` : 'null→CANVAS'}`,
        'color:#aaa'
      );
    }
    this.contactShadows?.update(renderer, this.scene);
    if (_D && this.contactShadows) {
      const rt = renderer.getRenderTarget();
      console.log(
        `%c  [CONTACT-SHADOWS] done  RT after=${rt ? `RT(${rt.width}×${rt.height})` : 'null→CANVAS'}` +
        `  autoClear after=${renderer.autoClear}`,
        'color:#aaa'
      );
    }

    // Dispatch tick event for PostProcessingPipeline, ViewportStats, etc.
    if (_D) console.log('%c  [TICK-EVENT] → dispatching cyco-vp-tick', 'color:#aaa');
    window.dispatchEvent(new CustomEvent('cyco-vp-tick', { detail: { delta } }));
    if (_D) {
      const rt = renderer.getRenderTarget();
      console.log(
        `%c  [TICK-EVENT] ← done  RT=${rt ? `RT(${rt.width}×${rt.height})` : 'null→CANVAS'}` +
        `  autoClear=${renderer.autoClear}  canvasWritesSoFar=${window._cycoDbgCanvasWrites}`,
        'color:#aaa'
      );
    }

    // Default render — PostProcessingPipeline overrides this via cyco-vp-tick
    // by calling composer.render() instead. If no pipeline is active, render directly.
    if (!this._pipelineActive) {
      console.warn(
        `[CYCO:ANOMALY] Frame #${this._dbgFrame} — _pipelineActive=false, rendering direct to canvas (fallback)!`
      );
      renderer.render(this.scene, this.camera);
      window._cycoDbgCanvasWrites++;
    }

    // ViewHelper renders on top of main frame.
    // In WebGPU mode: render to an isolated overlay canvas (secondary plain
    // WebGLRenderer with alpha:true) — avoids the WebGPU output-blit overwriting
    // the main scene in the helper region.
    // In WebGL mode: render directly with autoClear=false so axes draw on top.
    if (this.viewHelper && renderer?.domElement instanceof HTMLCanvasElement) {
      if (renderer.isWebGPURenderer && this._helperOverlayRenderer) {
        // ── WebGPU: overlay canvas approach ──────────────────────────────────
        const hr = this._helperOverlayRenderer;
        hr.clear();                                // transparent-clear overlay
        // Force location to (left=0, bottom=0) so the ViewHelper fills the
        // 128×128 overlay canvas exactly, then restore after render.
        const loc = this.viewHelper.location;
        const savedLeft   = loc.left;
        const savedBottom = loc.bottom;
        const savedRight  = loc.right;
        loc.left   = 0;
        loc.bottom = 0;
        loc.right  = null;
        this.viewHelper.render(hr);
        loc.left   = savedLeft;
        loc.bottom = savedBottom;
        loc.right  = savedRight;
      } else {
        // ── WebGL (or WebGPU overlay not ready): direct render ────────────────
        renderer.autoClear = false;
        this.viewHelper.render(renderer);
        renderer.autoClear = true;
        window._cycoDbgCanvasWrites++;
      }
    }

    // Anomaly check: 1 write in WebGPU mode (overlay skips main canvas), 2 in WebGL
    const _totalWrites   = window._cycoDbgCanvasWrites;
    const _expectedWrites = renderer?.isWebGPURenderer ? 1 : 2;
    if (_totalWrites > _expectedWrites || _totalWrites === 0) {
      console.warn(
        `[CYCO:ANOMALY] Frame #${this._dbgFrame} — canvas writes=${_totalWrites}` +
        ` (expected ${_expectedWrites})  _pipelineActive=${this._pipelineActive}` +
        `  hasViewHelper=${!!this.viewHelper}`
      );
    }

    if (_D) {
      const color = _totalWrites !== 2 ? 'color:#f44;font-weight:bold' : 'color:#4f4';
      const label = _totalWrites === 0 ? '⚠ NO canvas writes — pipeline dead?' :
                    (_totalWrites !== 2 ? `⚠ ${_totalWrites} writes — ANOMALY!` : '✓ OK');
      console.log(`%c  [SUMMARY] canvasWrites=${_totalWrites}  ${label}`, color);
      console.groupEnd();
    }
  }

  /** PostProcessingPipeline calls this to take over rendering for the frame. */
  setPipelineActive(active) {
    this._pipelineActive = !!active;
  }

  // ─── Focus animation ──────────────────────────────────────────────────────

  _onFocus(event) {
    const { object } = event.detail;
    if (!object) return;

    const worldPos = new THREE.Vector3();
    object.getWorldPosition(worldPos);

    this._focusAnim = {
      targetPos:  worldPos.clone(),
      startPos:   this.controls.target.clone(),
      duration:   0.3, // seconds
      elapsed:    0,
    };
  }

  _tickFocusAnim(delta) {
    const a = this._focusAnim;
    a.elapsed += delta;
    const t = Math.min(a.elapsed / a.duration, 1);
    const eased = t * t * (3 - 2 * t); // smoothstep

    this.controls.target.lerpVectors(a.startPos, a.targetPos, eased);

    if (t >= 1) this._focusAnim = NO_FOCUS;
  }

  // ─── Camera snap ─────────────────────────────────────────────────────────

  _onCameraSnap(event) {
    const { view } = event.detail;
    const dist = this.camera.position.distanceTo(this.controls.target);

    {
      const c = this.camera;
      const t = this.controls.target;
      console.log(
        `[CYCO:CAMERA] snap to '${view}'  dist=${dist.toFixed(2)}` +
        `  before: cam=(${c.position.x.toFixed(2)},${c.position.y.toFixed(2)},${c.position.z.toFixed(2)})` +
        `  target=(${t.x.toFixed(2)},${t.y.toFixed(2)},${t.z.toFixed(2)})`
      );
    }

    const snapConfigs = {
      top:    [0,  dist,    0.001],  // tiny Z offset avoids north-pole lock
      bottom: [0, -dist,   0.001],  // tiny Z offset avoids south-pole lock
      front:  [0,  0,      dist],
      back:   [0,  0,     -dist],
      right:  [dist, 0,    0],
      left:   [-dist, 0,   0],
    };

    const pos = snapConfigs[view];
    if (!pos) return;

    const center = this.controls.target.clone();
    this.controls.enabled = false;
    this.camera.position.set(
      center.x + pos[0],
      center.y + pos[1],
      center.z + pos[2],
    );
    this.camera.lookAt(center);
    this.controls.update();
    this.controls.enabled = true;

    {
      const c = this.camera;
      console.log(
        `[CYCO:CAMERA] snap done  cam=(${c.position.x.toFixed(2)},${c.position.y.toFixed(2)},${c.position.z.toFixed(2)})` +
        `  near=${c.near}  far=${c.far}  fov=${c.fov}`
      );
    }
  }

  // ─── Renderer swap ───────────────────────────────────────────────────────

  _onContainerReady(event) {
    const { container } = event.detail;
    if (!container) return;
    if (this._container === container) return; // same element, nothing to do
    if (this._initPending) return; // init already in progress, ignore duplicate event

    // Remove placeholder label in the new container
    const lbl = container.querySelector('#cyco-viewport-placeholder-label');
    if (lbl) lbl.remove();

    if (this._container && this.rendererManager?.renderer) {
      // Layout was restored — just move the existing canvas to the new container.
      // Full re-init would be wasteful and would reset camera/scene state.
      const canvas = this.rendererManager.renderer.domElement;
      if (canvas) container.appendChild(canvas);

      // Repoint resize observer
      if (this._resizeObserver) {
        this._resizeObserver.unobserve(this._container);
        this._resizeObserver.observe(container);
      }
      this._container = container;
      // Keep RendererManager's container in sync so renderer switches read the correct size
      this.rendererManager.container = container;

      // Rebuild loading overlay in the new container
      this._buildLoadingOverlay(container);

      // Use _handleResize so cyco-vp-resize fires and PostProcessingPipeline rebuilds
      const { width, height } = container.getBoundingClientRect();
      this._handleResize(Math.max(1, Math.floor(width)), Math.max(1, Math.floor(height)));
      return;
    }

    // First-time initialisation
    this._initPending = true;
    this.init(container).finally(() => { this._initPending = false; });
  }

  _onRendererChanged(event) {
    const { renderer, type } = event.detail;
    // Rebuild IBL with new renderer (SVG/CSS3D renderers are skipped inside _setupIBL)
    this._setupIBL();

    // Sync the new renderer to the container's current size. The renderer was
    // created using the container's pre-layout dimensions (which may have been
    // wrong on cold load). Re-read to get the final settled dimensions.
    if (this._container) {
      const { width, height } = this._container.getBoundingClientRect();
      const w = Math.max(1, Math.floor(width));
      const h = Math.max(1, Math.floor(height));
      if (w > 1 && h > 1) this._handleResize(w, h);
    }

    // Rebuild OrbitControls + ViewHelper with new canvas
    if (this.controls) this.controls.dispose();
    this._buildControls();
    this._buildViewHelper();

    // Rebuild sky/flare with new renderer (TSL mesh vs ShaderMaterial)
    if (this.skyEnabled && this.gradientSky) {
      this.gradientSky.setEnabled(false);
      this.gradientSky.setEnabled(true);
    }

    // TransformControls will re-wire via its own cyco-renderer-changed listener
  }

  // ─── Disposal ─────────────────────────────────────────────────────────────

  dispose() {
    if (this._rafId !== null) cancelAnimationFrame(this._rafId);
    this._resizeObserver?.disconnect();
    this.controls?.dispose();
    this._disposeHelperOverlay();
    if (this._onContextMenu) {
      document.removeEventListener('contextmenu', this._onContextMenu);
    }
    if (this._onRightMousedown) {
      document.removeEventListener('mousedown', this._onRightMousedown);
    }
    if (this._onMousemoveCtx) {
      document.removeEventListener('mousemove', this._onMousemoveCtx);
    }

    window.removeEventListener('cyco-renderer-changed',         this._onRendererChanged);
    window.removeEventListener('cyco-rvp-focus',                this._onFocus);
    window.removeEventListener('cyco-vp-camera',                this._onCameraSnap);
    window.removeEventListener('cyco-viewport-container-ready', this._onContainerReady);
    window.removeEventListener('cyco-scene-switch',             this._onSceneSwitch);
    window.removeEventListener('cyco-sky-change',               this._onSkyChange);
    window.removeEventListener('cyco-fog-change',               this._onFogChange);
    window.removeEventListener('cyco-env-map-change',           this._onEnvMapChange);
    window.removeEventListener('cyco-env-background-toggle',    this._onEnvBgToggle);
    window.removeEventListener('cyco-env-preset',               this._onEnvPreset);
    window.removeEventListener('cyco-env-intensity',            this._onEnvIntensity);
    window.removeEventListener('cyco-grid-settings-change',     this._onGridSettings);
    window.removeEventListener('cyco-loading-start',            this._onLoadingStart);
    window.removeEventListener('cyco-loading-progress',         this._onLoadingProgress);
    window.removeEventListener('cyco-loading-done',             this._onLoadingDone);
    window.removeEventListener('cyco-loading-error',            this._onLoadingError);
    clearTimeout(this._loadingHideTimer);
    this._loadingOverlay?.remove();

    // Dispose scene objects
    this.contactShadows?.dispose();
    this.scene?.traverse(child => {
      child.geometry?.dispose();
      const mats = [child.material].flat();
      mats.forEach(m => {
        if (!m) return;
        Object.values(m).forEach(v => v?.isTexture && v.dispose());
        m.dispose?.();
      });
    });
  }
}
