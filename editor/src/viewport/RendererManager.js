/**
 * RendererManager.js
 * Owns the lifecycle of all renderer types (WebGL, WebGPU, SVG, CSS3D, PathTracer).
 * Creates/disposes renderers, appends/removes their canvas from the viewport container.
 *
 * Events dispatched:
 *   cyco-renderer-ready    { renderer, type }   — new renderer is live
 *   cyco-renderer-changed  { renderer, type }   — after swap complete
 *
 * Events consumed:
 *   cyco-renderer-change   { type: 'webgl'|'webgpu'|'svg'|'css3d'|'pathtracer' }
 */

import * as THREE from 'three';
import WebGPU from 'three/addons/capabilities/WebGPU.js';
import { SVGRenderer } from 'three/addons/renderers/SVGRenderer.js';
import { CSS3DRenderer } from 'three/addons/renderers/CSS3DRenderer.js';

export class RendererManager {
  constructor() {
    /** @type {'webgl'|'webgpu'|'svg'|'css3d'|'pathtracer'} */
    this.activeType = 'webgl';
    /** @type {THREE.WebGLRenderer|null} */
    this.renderer = null;
    /** @type {HTMLElement|null} */
    this.container = null;

    this._boundOnChange  = this._onChangeRequest.bind(this);
    this._boundOnVpReady = this._onVpReady.bind(this);
    window.addEventListener('cyco-renderer-change', this._boundOnChange);
    // Restore saved renderer type after the viewport is fully ready so that
    // PostProcessingPipeline and other listeners are registered before the switch.
    window.addEventListener('cyco-vp-ready', this._boundOnVpReady, { once: true });
  }

  /**
   * Initialise the default WebGL renderer inside the given container element.
   * Must be called once from ViewportEngine.init().
   * @param {HTMLElement} container
   * @param {number} width
   * @param {number} height
   * @returns {THREE.WebGLRenderer}
   */
  init(container, width, height) {
    this.container = container;
    this.renderer = this._createWebGL(width, height);
    container.appendChild(this.renderer.domElement);
    this._dispatch('cyco-renderer-ready', { renderer: this.renderer, type: this.activeType });
    return this.renderer;
  }

  // ─── Private — renderer factories ─────────────────────────────────────────

  _createWebGL(w, h) {
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;   // Default 1.0 — matches camera view; controlled by sky exposure slider
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    return renderer;
  }

  async _createWebGPU(w, h) {
    // Dynamic import keeps three.webgpu.min.js out of initial parse
    // WebGPURenderer is a named export (not default) in three/webgpu
    const { WebGPURenderer } = await import('three/webgpu');
    // forceWebGL: true uses the WebGL2 backend, which is required for EffectComposer
    // compatibility (WebGLRenderTarget, post-processing passes, sky ShaderMaterials).
    // NodeMaterial / TSL support is backend-agnostic and works identically on WebGL2.
    const renderer = new WebGPURenderer({ antialias: true, forceWebGL: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    await renderer.init();
    return renderer;
  }

  _createSVG(w, h) {
    const renderer = new SVGRenderer();
    renderer.setSize(w, h);
    renderer.domElement.style.position = 'absolute';
    renderer.domElement.style.top = '0';
    renderer.domElement.style.left = '0';
    return renderer;
  }

  _createCSS3D(w, h) {
    const renderer = new CSS3DRenderer();
    renderer.setSize(w, h);
    renderer.domElement.style.position = 'absolute';
    renderer.domElement.style.top = '0';
    renderer.domElement.style.left = '0';
    return renderer;
  }

  async _createPathTracer(w, h) {
    try {
      const { PathTracingRenderer } = await import('three-gpu-pathtracer');
      const webglRenderer = this._createWebGL(w, h);
      const ptRenderer = new PathTracingRenderer(webglRenderer);
      ptRenderer.domElement = webglRenderer.domElement;
      // Expose inner WebGLRenderer so consumers can use it for IBL etc.
      ptRenderer._webglRenderer = webglRenderer;
      return ptRenderer;
    } catch (err) {
      console.warn('[RendererManager] PathTracer unavailable:', err.message);
      window.dispatchEvent(new CustomEvent('cyco-notify', {
        detail: { message: 'Path Tracer is unavailable in this environment — falling back to WebGL.', level: 'warn' }
      }));
      return null; // caller falls back to WebGL
    }
  }

  // ─── Swap ─────────────────────────────────────────────────────────────────

  async _onChangeRequest(event) {
    const { type } = event.detail;
    if (type === this.activeType) return;

    const { width, height } = this.container.getBoundingClientRect();
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));

    // Check WebGPU availability before attempting
    if (type === 'webgpu' && !(await WebGPU.isAvailable())) {
      console.warn('[RendererManager] WebGPU not available in hardware — WebGPURenderer will use WebGL2 fallback backend');
    }

    // ── Create new renderer BEFORE disposing the old one so we can abort on failure ──
    let newRenderer;
    let resolvedType = type;
    try {
      switch (type) {
        case 'webgpu':      newRenderer = await this._createWebGPU(w, h); break;
        case 'svg':         newRenderer = this._createSVG(w, h); break;
        case 'css3d':       newRenderer = this._createCSS3D(w, h); break;
        case 'pathtracer':  newRenderer = await this._createPathTracer(w, h); break;
        default:            newRenderer = this._createWebGL(w, h); break;
      }
    } catch (err) {
      console.error('[RendererManager] Failed to create renderer:', err);
      window.dispatchEvent(new CustomEvent('cyco-notify', {
        detail: { message: `Failed to switch to ${type}: ${err.message}`, level: 'error' }
      }));
      return; // old renderer stays active
    }

    // PathTracer unavailable — fall back to standard WebGL
    if (!newRenderer) {
      newRenderer = this._createWebGL(w, h);
      resolvedType = 'webgl';
    }

    // Dispose old and install new
    this._disposeActive();
    this.renderer = newRenderer;
    this.activeType = resolvedType;
    this.container.appendChild(newRenderer.domElement);

    // Persist the selected renderer type so it survives page refreshes
    try { localStorage.setItem('cyco:rendererType', resolvedType); } catch (_) {}

    this._dispatch('cyco-renderer-changed', { renderer: newRenderer, type: resolvedType });
  }

  _disposeActive() {
    if (!this.renderer) return;
    const el = this.renderer.domElement;
    if (el && el.parentNode) el.parentNode.removeChild(el);
    if (typeof this.renderer.dispose === 'function') this.renderer.dispose();
    this.renderer = null;
  }

  /** Restore the renderer type saved in localStorage (runs once after vp-ready). */
  _onVpReady() {
    try {
      const saved = localStorage.getItem('cyco:rendererType');
      if (saved && saved !== this.activeType) {
        window.dispatchEvent(new CustomEvent('cyco-renderer-change', { detail: { type: saved } }));
      }
    } catch (_) {}
  }

  // ─── Resize ───────────────────────────────────────────────────────────────

  /**
   * Resize the active renderer canvas.
   * @param {number} width  CSS pixel width
   * @param {number} height CSS pixel height
   */
  resize(width, height) {
    if (!this.renderer) return;
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    if (typeof this.renderer.setSize === 'function') {
      this.renderer.setSize(w, h);
    }
    if (typeof this.renderer.setPixelRatio === 'function') {
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  get domElement() {
    return this.renderer?.domElement ?? null;
  }

  /** True if active renderer is a WebGLRenderer (incl PathTracer wrapper). */
  get isWebGL() {
    return this.activeType === 'webgl' || this.activeType === 'pathtracer';
  }

  /** True if active renderer is the WebGPU renderer. */
  get isWebGPU() {
    return this.activeType === 'webgpu';
  }

  /**
   * Alias for activeType — used by RendererProperties and PostProcessingProperties
   * to read the current renderer type when building their UI.
   * @returns {'webgl'|'webgpu'|'svg'|'css3d'|'pathtracer'}
   */
  get currentType() {
    return this.activeType;
  }

  _dispatch(name, detail) {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  }

  dispose() {
    window.removeEventListener('cyco-renderer-change', this._boundOnChange);
    window.removeEventListener('cyco-vp-ready',        this._boundOnVpReady);
    this._disposeActive();
  }
}
