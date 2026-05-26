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
  init(container) {
    this._container = container;
    const { width, height } = container.getBoundingClientRect();
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));

    // Init renderer
    this.rendererManager.init(container, w, h);

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
    } = detail ?? {};
    console.log(
      `[CYCO:ENV] cyco-sky-change  enabled=${enabled}  elevation=${elevation}°  azimuth=${azimuth}°` +
      `  exposure=${exposure ?? 'n/a'}  saturation=${saturation ?? 'n/a'}  showSun=${showSun}  showMoon=${showMoon}`
    );
    if (!this.scene) return;

    if (!enabled) {
      this.gradientSky?.setEnabled(false);
      this.skyEnabled = false;
      if (!(this.scene.background instanceof THREE.Color)) {
        this.scene.background = new THREE.Color(0x1a1a1a);
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
    if (lensflareEnabled !== undefined) params.lensflareEnabled = lensflareEnabled;
    if (lensflareSize !== undefined)    params.lensflareSize    = lensflareSize;
    if (lensflareOpacity !== undefined) params.lensflareOpacity = lensflareOpacity;

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
    // PMREMGenerator requires a real WebGLRenderer — use inner renderer for PathTracer wrapper
    renderer = renderer._webglRenderer ?? renderer;
    if (!renderer.isWebGLRenderer) {
      console.warn('[ViewportEngine] HDRI env map not supported with current renderer — switch to WebGL first.');
      console.log('[CYCO:ENV] env map SKIP — not a WebGLRenderer');
      return;
    }
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
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
    const { type, color, topColor, horizonColor, bottomColor } = detail ?? {};
    console.log(
      `[CYCO:ENV] cyco-background-change  type=${type}  color=${color ?? 'n/a'}` +
      `  topColor=${topColor ?? 'n/a'}  horizonColor=${horizonColor ?? 'n/a'}  bottomColor=${bottomColor ?? 'n/a'}`
    );

    // Remove sky if switching away from it
    if (type !== 'sky') {
      const sky = this.scene.getObjectByName('__cyco_sky');
      if (sky) { this.scene.remove(sky); sky.geometry?.dispose(); }
      this.skyEnabled = false;
    }

    if (type === 'solid') {
      this.scene.background = new THREE.Color(color ?? '#1a1a1a');
    } else if (type === 'gradient') {
      this.scene.background = this._makeGradientTexture(
        topColor    ?? '#87ceeb',
        horizonColor ?? '#d4a56a',
        bottomColor ?? '#4a3b2a'
      );
    } else if (type === 'hdri') {
      // Show last loaded env map as background, or fallback to solid
      this.scene.background = this._lastEnvMap ?? new THREE.Color(0x1a1a1a);
    } else if (type === 'sky') {
      // Sky background handled by _onSkyChange; just ensure background is null
      // so the sky shader is composited correctly
      this.scene.background = null;
    }
  }

  /** Build a 2-stop gradient canvas texture (top → horizon → bottom). */
  _makeGradientTexture(topColor, horizonColor, bottomColor) {
    const w = 2, h = 256;
    const canvas = document.createElement('canvas');
    canvas.width  = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0.0,  topColor);
    grad.addColorStop(0.5,  horizonColor);
    grad.addColorStop(1.0,  bottomColor);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }

  /** Restore the built-in RoomEnvironment IBL preset. */
  _onEnvPreset({ detail } = {}) {
    console.log(`[CYCO:ENV] cyco-env-preset  preset=${detail?.preset}`);
    if (detail?.preset === 'room') {
      this._setupIBL();
    }
  }

  /**
   * Show/hide the grid helper.
   * @param {boolean} visible
   */
  setGridVisible(visible) {
    if (this.gridHelper) this.gridHelper.visible = visible;
  }

  /**
   * Reconfigure the grid (size + divisions).
   * @param {number} size
   * @param {number} divisions
   */
  setGridConfig(size, divisions) {
    if (this.gridHelper) {
      this.scene.remove(this.gridHelper);
      this.gridHelper.geometry.dispose();
    }
    this.gridHelper = this._makeGrid(size, divisions);
    this.scene.add(this.gridHelper);
  }

  // ─── Build helpers ────────────────────────────────────────────────────────

  /**
   * Build a simple equirectangular env map from the sky gradient colour stops
   * and apply it to scene.environment so metallic/glass materials reflect the sky.
   * @param {Array<{pos:number,color:string}>} colorStops
   * @param {THREE.WebGLRenderer} renderer
   */
  _buildSkyEnvMap(colorStops, renderer) {
    // PMREMGenerator requires a real WebGLRenderer — skip for WebGPU/SVG/CSS3D
    const glRenderer = renderer?._webglRenderer ?? renderer;
    if (!glRenderer?.isWebGLRenderer) return;
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

      const pmrem  = new THREE.PMREMGenerator(glRenderer);
      pmrem.compileEquirectangularShader();
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

    // Grid + axes (non-selectable)
    this.gridHelper = this._makeGrid(20, 20);
    this.axesHelper = new THREE.AxesHelper(1);
    this.axesHelper.raycast = () => {};
    this.axesHelper.userData._isHelper = true;
    this.scene.add(this.gridHelper, this.axesHelper);
    // Reduce IBL contribution so directional light shadows remain visible
    this.scene.environmentIntensity = 0.4;
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
   * IBL setup via PMREMGenerator.
   * MUST call pmrem.dispose() after use — holds WebGL render targets.
   */
  _setupIBL() {
    console.log('[CYCO:ENV] _setupIBL() — building RoomEnvironment IBL');
    let renderer = this.rendererManager.renderer;
    if (!renderer) return;
    // PathTracingRenderer wraps an inner WebGLRenderer — use that for IBL
    if (renderer._webglRenderer) renderer = renderer._webglRenderer;
    // PMREMGenerator requires a real WebGLRenderer (not WebGPU/SVG/CSS3D)
    if (!renderer.isWebGLRenderer) {
      console.log('[CYCO:ENV] _setupIBL() SKIP — not a WebGLRenderer');
      return;
    }
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    const envTexture = pmrem.fromScene(new RoomEnvironment()).texture;
    pmrem.dispose(); // prevents GPU memory leak
    this.scene.environment = envTexture;
    console.log('[CYCO:ENV] _setupIBL() done — scene.environment set  envIntensity=' + this.scene.environmentIntensity);
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
    const renderer = this.rendererManager.renderer;
    if (!renderer?.domElement || !this.camera) return;
    this.viewHelper = new ViewHelper(this.camera, renderer.domElement);
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
    // Track right-mousedown position so we can distinguish a click from a drag.
    // If the mouse moved > 4 px between mousedown and contextmenu, it was an orbit
    // drag and we should NOT show the context menu.
    let _rdX = 0, _rdY = 0;
    this._onRightMousedown = (e) => {
      if (e.button === 2) { _rdX = e.clientX; _rdY = e.clientY; }
    };
    document.addEventListener('mousedown', this._onRightMousedown);

    this._onContextMenu = (e) => {
      // Only handle right-click on the viewport canvas
      const canvas = this.rendererManager.renderer?.domElement;
      if (!canvas || !canvas.contains(e.target) && e.target !== canvas) return;
      e.preventDefault();

      // If mouse dragged more than 4 px this was an orbit drag — skip menu
      if (Math.hypot(e.clientX - _rdX, e.clientY - _rdY) > 4) return;
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

    // ViewHelper renders on top of main frame — must use autoClear=false so it
    // doesn't wipe the already-rendered scene before drawing its axes widget.
    // SVGRenderer and CSS3DRenderer don't have clearDepth() — skip on those.
    if (this.viewHelper && renderer?.domElement instanceof HTMLCanvasElement) {
      if (_D) console.log(
        `%c  [VIEWHELPER] render  autoClear: true→false→render→true  RT=CANVAS`,
        'color:#aaa'
      );
      renderer.autoClear = false;

      // WebGPURenderer.render() overrides the viewport back to full-canvas for its
      // internal output pass, causing it to overwrite the previously rendered TSL
      // scene.  Enable scissor test for the ViewHelper's area so that the full-canvas
      // output pass only writes within the helper region.
      if (renderer.isWebGPURenderer) {
        const dom    = renderer.domElement;
        const dim    = 128;                                   // ViewHelper CSS size
        const loc    = this.viewHelper.location || { bottom: 20, right: 20 };
        const right  = loc.right  ?? 20;
        const bottom = loc.bottom ?? 20;
        // WebGPURenderer uses y-from-top for setViewport/setScissor (CSS pixels)
        const scX = dom.offsetWidth  - dim - right;          // CSS x from left = 152
        const scY = dom.offsetHeight - dim - bottom;         // CSS y from top  = 92
        renderer.setScissorTest(true);
        renderer.setScissor(scX, scY, dim, dim);
        this.viewHelper.render(renderer);
        renderer.setScissorTest(false);
      } else {
        this.viewHelper.render(renderer);
      }

      renderer.autoClear = true;
      window._cycoDbgCanvasWrites++;
    }

    // Always check for anomalies (wrong canvas-write count)
    const _totalWrites = window._cycoDbgCanvasWrites;
    if (_totalWrites > 2 || _totalWrites === 0) {
      console.warn(
        `[CYCO:ANOMALY] Frame #${this._dbgFrame} — canvas writes=${_totalWrites} (expected 2!)` +
        `  _pipelineActive=${this._pipelineActive}  hasViewHelper=${!!this.viewHelper}`
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
    this.init(container);
  }

  _onRendererChanged(event) {
    const { renderer, type } = event.detail;
    // Rebuild IBL with new renderer (SVG/CSS3D renderers are skipped inside _setupIBL)
    this._setupIBL();

    // Rebuild OrbitControls + ViewHelper with new canvas
    if (this.controls) this.controls.dispose();
    this._buildControls();
    this._buildViewHelper();

    // TransformControls will re-wire via its own cyco-renderer-changed listener
  }

  // ─── Disposal ─────────────────────────────────────────────────────────────

  dispose() {
    if (this._rafId !== null) cancelAnimationFrame(this._rafId);
    this._resizeObserver?.disconnect();
    this.controls?.dispose();
    if (this._onContextMenu) {
      document.removeEventListener('contextmenu', this._onContextMenu);
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
