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
 *   cyco-vp-camera-snap    { view }            — snap to Top/Front/Right/etc.
 *   cyco-show-properties   { type:'grid'|... } — (no action here, forwarded to RightPanel)
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ViewHelper } from 'three/addons/helpers/ViewHelper.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/** Sentinel value: no active focus animation. */
const NO_FOCUS = null;

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
    this._onRendererChanged = this._onRendererChanged.bind(this);
    this._onFocus           = this._onFocus.bind(this);
    this._onCameraSnap      = this._onCameraSnap.bind(this);
    this._onContainerReady  = this._onContainerReady.bind(this);

    window.addEventListener('cyco-renderer-changed',        this._onRendererChanged);
    window.addEventListener('cyco-rvp-focus',               this._onFocus);
    window.addEventListener('cyco-vp-camera-snap',          this._onCameraSnap);
    window.addEventListener('cyco-viewport-container-ready', this._onContainerReady);
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

    // OrbitControls
    this._buildControls();

    // ViewHelper (axis cube, top-right)
    this._buildViewHelper();

    // Resize observer
    this._buildResizeObserver(container);

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

  _buildScene(w, h) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a1a);

    // Default camera
    this.camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 1000);
    this.camera.position.set(5, 5, 5);
    this.camera.lookAt(0, 0, 0);

    // Non-hierarchy lights (not shown in scene tree)
    this._ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    this._hemisphereLight = new THREE.HemisphereLight(0x87ceeb, 0x8b7355, 0.8);
    this.scene.add(this._ambientLight, this._hemisphereLight);

    // Grid + axes (non-selectable)
    this.gridHelper = this._makeGrid(20, 20);
    this.axesHelper = new THREE.AxesHelper(1);
    this.axesHelper.raycast = () => {};
    this.scene.add(this.gridHelper, this.axesHelper);
  }

  _makeGrid(size, divisions) {
    const g = new THREE.GridHelper(size, divisions, 0x555555, 0x333333);
    g.raycast = () => {}; // non-selectable
    return g;
  }

  /**
   * IBL setup via PMREMGenerator.
   * MUST call pmrem.dispose() after use — holds WebGL render targets.
   */
  _setupIBL() {
    const renderer = this.rendererManager.renderer;
    if (!renderer || typeof renderer.getSize !== 'function') return; // SVG/CSS3D renderers
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    const envTexture = pmrem.fromScene(new RoomEnvironment()).texture;
    pmrem.dispose(); // prevents GPU memory leak
    this.scene.environment = envTexture;
  }

  _buildControls() {
    const renderer = this.rendererManager.renderer;
    if (!renderer?.domElement) return;

    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping   = true;
    this.controls.dampingFactor   = 0.05;
    this.controls.mouseButtons    = {
      LEFT:   THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT:  null,   // right-click reserved for context menu
    };
    this.controls.touches = {
      ONE: THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.DOLLY_PAN,
    };
  }

  _buildViewHelper() {
    const renderer = this.rendererManager.renderer;
    if (!renderer?.domElement) return;
    this.viewHelper = new ViewHelper(this.camera, renderer.domElement);
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

    // Focus lerp animation
    if (this._focusAnim) {
      this._tickFocusAnim(delta);
    }

    // OrbitControls damping
    if (this.controls) this.controls.update();

    const renderer = this.rendererManager.renderer;
    if (!renderer || !this.scene || !this.camera) return;

    // Dispatch tick event for PostProcessingPipeline, ViewportStats, etc.
    window.dispatchEvent(new CustomEvent('cyco-vp-tick', { detail: { delta } }));

    // Default render — PostProcessingPipeline overrides this via cyco-vp-tick
    // by calling composer.render() instead. If no pipeline is active, render directly.
    if (!this._pipelineActive) {
      renderer.render(this.scene, this.camera);
    }

    // ViewHelper renders on top of main frame
    if (this.viewHelper) {
      this.viewHelper.render(renderer);
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

    const snapConfigs = {
      top:    [0,  dist, 0],
      bottom: [0, -dist, 0],
      front:  [0,  0,    dist],
      back:   [0,  0,   -dist],
      right:  [dist, 0,  0],
      left:   [-dist, 0, 0],
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

      // Sync renderer size to new (possibly resized) container
      const { width, height } = container.getBoundingClientRect();
      const w = Math.max(1, Math.floor(width));
      const h = Math.max(1, Math.floor(height));
      this.rendererManager.resize(w, h);
      if (this.camera) {
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
      }
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

    window.removeEventListener('cyco-renderer-changed',         this._onRendererChanged);
    window.removeEventListener('cyco-rvp-focus',                this._onFocus);
    window.removeEventListener('cyco-vp-camera-snap',           this._onCameraSnap);
    window.removeEventListener('cyco-viewport-container-ready', this._onContainerReady);

    // Dispose scene objects
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
