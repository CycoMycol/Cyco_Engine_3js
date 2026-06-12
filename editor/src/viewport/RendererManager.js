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
import ProjectSaveLog from '../project/ProjectSaveLog.js';

export class RendererManager {
  constructor() {
    /** @type {'webgl'|'webgpu'|'svg'|'css3d'|'pathtracer'} */
    this.activeType = 'webgpu';
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

  _debug(step, payload = {}) {
    ProjectSaveLog.add('RendererManager', step, payload);
  }

  _rendererSummary(renderer = this.renderer) {
    const canvas = renderer?.domElement;
    return {
      activeType: this.activeType,
      rendererClass: renderer?.constructor?.name || null,
      isWebGLRenderer: !!renderer?.isWebGLRenderer,
      isWebGPURenderer: !!renderer?.isWebGPURenderer,
      hasDomElement: !!canvas,
      canvasConnected: !!canvas?.isConnected,
      canvasWidth: canvas?.width ?? null,
      canvasHeight: canvas?.height ?? null,
      cssWidth: canvas?.offsetWidth ?? null,
      cssHeight: canvas?.offsetHeight ?? null,
      pixelRatio: typeof renderer?.getPixelRatio === 'function' ? renderer.getPixelRatio() : null,
      toneMapping: renderer?.toneMapping ?? null,
      exposure: renderer?.toneMappingExposure ?? null,
      outputColorSpace: renderer?.outputColorSpace ?? null,
    };
  }

  /**
   * Initialise the default WebGL renderer inside the given container element.
   * Must be called once from ViewportEngine.init().
   *
   * If the WebGL context fails on the first attempt (can happen in VS Code's
   * WebView2 if the GPU process hasn't fully released contexts from the previous
   * page load), this retries up to two more times with a short delay.
   *
   * @param {HTMLElement} container
   * @param {number} width
   * @param {number} height
   * @returns {Promise<THREE.WebGLRenderer>}
   */
  async init(container, width, height) {
    this.container = container;
    this._debug('init:start', {
      requestedWidth: width,
      requestedHeight: height,
      containerConnected: !!container?.isConnected,
      containerId: container?.id || null,
    });

    // Check preferences for default renderer type
    let prefType = 'webgpu';
    let legacyType = null;
    try {
      const raw = localStorage.getItem('cyco-prefs');
      if (raw) {
        const prefs = JSON.parse(raw);
        if (prefs?.renderer?.defaultType) prefType = prefs.renderer.defaultType;
      }
      legacyType = localStorage.getItem('cyco:rendererType');
    } catch (_) {}
    this._debug('init:prefs', { prefType, legacyType });
    this.activeType = prefType;

    const MAX_ATTEMPTS = 3;
    const RETRY_DELAY_MS = 400;
    let lastErr;
    if (prefType === 'webgpu') {
      try {
        this.renderer = await this._createWebGPU(width, height);
      } catch (err) {
        this._debug('init:webgpu-failed', { message: err?.message || String(err) });
        console.warn('[RendererManager] WebGPU init failed, falling back to WebGL:', err.message);
        this.activeType = 'webgl';
        try {
          this.renderer = this._createWebGL(width, height);
        } catch (webglErr) {
          this._debug('init:webgl-fallback-failed', { message: webglErr?.message || String(webglErr) });
          console.error('[RendererManager] WebGL fallback also failed:', webglErr.message);
          throw webglErr; // propagate the WebGL error if both fail
        }
      }
    } else {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          this.renderer = this._createWebGL(width, height);
          this._debug('init:webgl-created', { attempt });
          break; // success
        } catch (err) {
          lastErr = err;
          this._debug('init:webgl-create-failed', { attempt, message: err?.message || String(err) });
          if (attempt < MAX_ATTEMPTS) {
            console.warn(`[RendererManager] WebGL context creation failed (attempt ${attempt}/${MAX_ATTEMPTS}), retrying in ${RETRY_DELAY_MS}ms…`, err.message);
            await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
          }
        }
      }
    }
    if (!this.renderer) {
      throw lastErr; // all attempts exhausted — propagate for caller to handle
    }

    // Ensure the canvas is properly attached to the container
    if (this.renderer.domElement && !container.contains(this.renderer.domElement)) {
      container.appendChild(this.renderer.domElement);
    }
    
    this._debug('init:complete', this._rendererSummary(this.renderer));
    this._dispatch('cyco-renderer-ready', { renderer: this.renderer, type: this.activeType });
    return this.renderer;
  }

  // ─── Private — renderer factories ─────────────────────────────────────────

  _createWebGL(w, h) {
    this._debug('createWebGL:start', { width: w, height: h });
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
    this._debug('createWebGL:complete', this._rendererSummary(renderer));
    return renderer;
  }

  async _createWebGPU(w, h) {
    this._debug('createWebGPU:start', { width: w, height: h });
    // Dynamic import keeps three.webgpu.min.js out of initial parse
    // WebGPURenderer is a named export (not default) in three/webgpu
    const { WebGPURenderer } = await import('three/webgpu');
    // forceWebGL: true uses the WebGL2 backend, which is required for EffectComposer
    // compatibility (WebGLRenderTarget, post-processing passes, sky ShaderMaterials).
    // NodeMaterial / TSL support is backend-agnostic and works identically on WebGL2.
    // antialias: false — the TSL post-processing pipeline handles AA externally.
    // Keeping MSAA enabled on the default canvas framebuffer causes the depth-clear
    // that ViewHelper issues (renderer.clearDepth) to trigger an MSAA resolve that
    // overwrites the previously rendered TSL scene on the canvas.
    const renderer = new WebGPURenderer({ antialias: false, forceWebGL: true, preserveDrawingBuffer: true });
    this._debug('createWebGPU:constructed', {
      rendererClass: renderer?.constructor?.name || null,
      forceWebGL: true,
      preserveDrawingBuffer: true,
      antialias: false,
    });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    await renderer.init().catch(err => {
      this._debug('createWebGPU:init-error', { message: err?.message || String(err), stack: err?.stack || null });
      console.error('[RendererManager] WebGPU init() failed:', err);
      throw err;
    });
    // WebGPURenderer defaults clearAlpha=0 (transparent). An opaque clear is
    // required so that renderer.clear() before the TSL composite blit doesn't
    // leave alpha=0 in the canvas — which would let the previous frame bleed
    // through any semi-transparent pixels in the scene pass (ghosting / onion-skin).
    renderer.setClearColor(0x000000, 1);
    this._debug('createWebGPU:complete', this._rendererSummary(renderer));
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
    const { type, reason } = event.detail || {};
    this._debug('changeRequest:start', {
      requestedType: type || null,
      reason: reason || null,
      activeType: this.activeType,
      hasContainer: !!this.container,
    });
    if (!type) {
      this._debug('changeRequest:skip-no-type');
      return;
    }
    if (type === this.activeType) {
      this._debug('changeRequest:skip-same-type', { type });
      return;
    }
    if (!this.container) {
      this._debug('changeRequest:skip-no-container', { type });
      return;
    }

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
      this._debug('changeRequest:create-failed', { type, message: err?.message || String(err), stack: err?.stack || null });
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
      this._debug('changeRequest:fallback-webgl', { requestedType: type });
    }

    // Dispose old and install new
    this._disposeActive();
    this.renderer = newRenderer;
    this.activeType = resolvedType;
    this.container.appendChild(newRenderer.domElement);

    // Persist the selected renderer type so it survives page refreshes
    try { localStorage.setItem('cyco:rendererType', resolvedType); } catch (_) {}

    this._debug('changeRequest:complete', {
      requestedType: type,
      resolvedType,
      ...this._rendererSummary(newRenderer),
    });
    this._dispatch('cyco-renderer-changed', { renderer: newRenderer, type: resolvedType });
  }

  _disposeActive() {
    if (!this.renderer) return;
    this._debug('disposeActive:start', this._rendererSummary(this.renderer));
    const el = this.renderer.domElement;
    if (el && el.parentNode) el.parentNode.removeChild(el);
    if (typeof this.renderer.dispose === 'function') this.renderer.dispose();
    this.renderer = null;
    this._debug('disposeActive:complete');
  }

  /** Restore the renderer type saved in localStorage (runs once after vp-ready). */
  _onVpReady() {
    // No-op — init() now reads preferences directly.
    // The cyco:rendererType key is only set by manual user switches.
    try {
      const saved = localStorage.getItem('cyco:rendererType');
      if (saved && saved !== this.activeType) {
        this._debug('vpReady:legacy-renderer-override', {
          saved,
          activeType: this.activeType,
        });
        window.dispatchEvent(new CustomEvent('cyco-renderer-change', { detail: { type: saved, reason: 'legacy-localStorage' } }));
      } else {
        this._debug('vpReady:no-legacy-override', { saved, activeType: this.activeType });
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
    if (!this.renderer) {
      this._debug('resize:skip-no-renderer', { width, height });
      return;
    }
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    if (typeof this.renderer.setSize === 'function') {
      this.renderer.setSize(w, h);
    }
    if (typeof this.renderer.setPixelRatio === 'function') {
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    }
    this._debug('resize:complete', {
      width: w,
      height: h,
      ...this._rendererSummary(this.renderer),
    });
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
