/**
 * PostProcessingPipeline.js
 * Maintains dual post-processing pipelines:
 *   - WebGL: three/addons EffectComposer (RenderPass → OutlinePass → GTAOPass → UnrealBloomPass → OutputPass)
 *   - WebGPU: Three.js native PostProcessing (TSL nodes)
 *   - SVG / CSS3D / PathTracer: no post-processing
 *
 * CRITICAL: OutputPass MUST be the last pass in the WebGL pipeline.
 * Without it, tone mapping and sRGB conversion are not applied and the viewport looks washed out.
 *
 * Depends on: ViewportEngine (injected)
 *
 * Events consumed:
 *   cyco-vp-ready           { scene, camera }       — create initial pipeline
 *   cyco-renderer-changed   { renderer, type }      — rebuild pipeline for new renderer
 *   cyco-vp-tick            { delta }               — render via composer each frame
 *   cyco-vp-resize          { width, height }       — resize composer passes
 *   cyco-select-node        { objects }             — update OutlinePass.selectedObjects
 *   cyco-deselect-all       {}                      — clear OutlinePass.selectedObjects
 *   cyco-pp-settings        { pass, prop, value }   — live tweak from PostProcessingProperties
 */

import * as THREE from 'three';
import { EffectComposer }  from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }      from 'three/addons/postprocessing/RenderPass.js';
import { OutlinePass }     from 'three/addons/postprocessing/OutlinePass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass }      from 'three/addons/postprocessing/OutputPass.js';

export class PostProcessingPipeline {
  /**
   * @param {import('./ViewportEngine.js').ViewportEngine} viewportEngine
   */
  constructor(viewportEngine) {
    this.engine = viewportEngine;

    /** @type {EffectComposer|null} */
    this._composer = null;

    /** @type {OutlinePass|null} — exposed for SelectionManager to set selectedObjects */
    this.outlinePass = null;

    /** @type {UnrealBloomPass|null} */
    this.bloomPass = null;

    this._onVpReady         = this._onVpReady.bind(this);
    this._onRendererChanged = this._onRendererChanged.bind(this);
    this._onTick            = this._onTick.bind(this);
    this._onResize          = this._onResize.bind(this);
    this._onSelectNode      = this._onSelectNode.bind(this);
    this._onDeselectAll     = this._onDeselectAll.bind(this);
    this._onPpSettings      = this._onPpSettings.bind(this);

    window.addEventListener('cyco-vp-ready',          this._onVpReady);
    window.addEventListener('cyco-renderer-changed',  this._onRendererChanged);
    window.addEventListener('cyco-vp-tick',           this._onTick);
    window.addEventListener('cyco-vp-resize',         this._onResize);
    window.addEventListener('cyco-select-node',       this._onSelectNode);
    window.addEventListener('cyco-deselect-all',      this._onDeselectAll);
    window.addEventListener('cyco-pp-settings',       this._onPpSettings);
  }

  // ─── Build pipelines ──────────────────────────────────────────────────────

  _buildWebGLPipeline(renderer, scene, camera, w, h) {
    this._disposeWebGLPipeline();

    this._composer = new EffectComposer(renderer);

    // 1. Render scene
    this._composer.addPass(new RenderPass(scene, camera));

    // 2. Outline pass — for selection highlight
    this.outlinePass = new OutlinePass(new THREE.Vector2(w, h), scene, camera);
    this.outlinePass.edgeStrength = 3;
    this.outlinePass.edgeGlow     = 0;
    this.outlinePass.edgeThickness = 1;
    this.outlinePass.visibleEdgeColor.set(0xff6600);
    this.outlinePass.hiddenEdgeColor.set(0x333333);
    this._composer.addPass(this.outlinePass);

    // 3. Bloom (GTAOPass removed — requires G-buffer/depth pre-pass not supported
    //    in a plain EffectComposer setup; re-add with MRT/depth buffer in Phase 15)
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.5, 0.4, 0.85);
    this._composer.addPass(this.bloomPass);

    // 4. OutputPass — MUST be last — applies tone mapping + sRGB output conversion
    this._composer.addPass(new OutputPass());

    // Tell ViewportEngine that the pipeline is active (it will skip direct renderer.render())
    this.engine.setPipelineActive(true);
  }

  _disposeWebGLPipeline() {
    if (!this._composer) return;
    this._composer.passes.forEach(pass => pass.dispose?.());
    this._composer.dispose?.();
    this._composer   = null;
    this.outlinePass = null;
    this.bloomPass   = null;
    this.engine.setPipelineActive(false);
  }

  _buildWebGPUPipeline(renderer, scene, camera) {
    // WebGPU PostProcessing uses TSL nodes — imported dynamically to avoid
    // pulling WebGPU code into the WebGL bundle.
    // Actual implementation deferred to Phase 15 (Future: WebGPU TSL nodes).
    // For now, WebGPU renderer falls back to direct rendering (no composer).
    this.engine.setPipelineActive(false);
    console.info('[PostProcessingPipeline] WebGPU pipeline — using direct rendering (TSL nodes deferred to Phase 15)');
  }

  // ─── Event handlers ───────────────────────────────────────────────────────

  _onVpReady() {
    const renderer = this.engine.rendererManager?.renderer;
    const type     = this.engine.rendererManager?.activeType ?? 'webgl';
    this._rebuildForType(renderer, type);
  }

  _onRendererChanged(event) {
    const { renderer, type } = event.detail;
    this._rebuildForType(renderer, type);
  }

  _rebuildForType(renderer, type) {
    const scene  = this.engine.scene;
    const camera = this.engine.camera;
    if (!renderer || !scene || !camera) return;

    const container = this.engine._container;
    const { width, height } = container?.getBoundingClientRect() ?? { width: 800, height: 600 };
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));

    if (type === 'webgl') {
      this._buildWebGLPipeline(renderer, scene, camera, w, h);
    } else if (type === 'webgpu') {
      this._disposeWebGLPipeline();
      this._buildWebGPUPipeline(renderer, scene, camera);
    } else {
      // SVG / CSS3D / PathTracer — no post-processing
      this._disposeWebGLPipeline();
      this.engine.setPipelineActive(false);
    }
  }

  _onTick() {
    if (!this._composer) return;
    try {
      this._composer.render();
    } catch (err) {
      console.error('[PostProcessingPipeline] Composer render error — falling back to direct rendering:', err);
      this._disposeWebGLPipeline(); // clears _composer and sets pipelineActive = false
    }
  }

  _onResize(event) {
    if (!this._composer) return;
    // Rebuild the entire pipeline at the new size rather than patching individual pass internals.
    // OutlinePass and UnrealBloomPass create render targets in their constructors
    // and don't reliably resize them via resolution.set() / setSize().
    const renderer = this.engine.rendererManager?.renderer;
    const type     = this.engine.rendererManager?.activeType ?? 'webgl';
    const scene    = this.engine.scene;
    const camera   = this.engine.camera;
    if (!renderer || !scene || !camera) return;
    const { width, height } = event.detail;
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    if (type === 'webgl') {
      this._buildWebGLPipeline(renderer, scene, camera, w, h);
    } else {
      this._rebuildForType(renderer, type);
    }
  }

  _onSelectNode(event) {
    if (!this.outlinePass) return;
    const { objects } = event.detail;
    this.outlinePass.selectedObjects = objects ?? [];
  }

  _onDeselectAll() {
    if (this.outlinePass) this.outlinePass.selectedObjects = [];
  }

  _onPpSettings(event) {
    const { pass, prop, value } = event.detail;
    switch (pass) {
      case 'outline':
        if (this.outlinePass && prop in this.outlinePass) this.outlinePass[prop] = value;
        break;
      case 'gtao':
        if (this.gtaoPass && prop in this.gtaoPass) this.gtaoPass[prop] = value;
        break;
      case 'bloom':
        if (this.bloomPass && prop in this.bloomPass) this.bloomPass[prop] = value;
        break;
    }
  }

  // ─── Disposal ─────────────────────────────────────────────────────────────

  dispose() {
    this._disposeWebGLPipeline();
    window.removeEventListener('cyco-vp-ready',          this._onVpReady);
    window.removeEventListener('cyco-renderer-changed',  this._onRendererChanged);
    window.removeEventListener('cyco-vp-tick',           this._onTick);
    window.removeEventListener('cyco-vp-resize',         this._onResize);
    window.removeEventListener('cyco-select-node',       this._onSelectNode);
    window.removeEventListener('cyco-deselect-all',      this._onDeselectAll);
    window.removeEventListener('cyco-pp-settings',       this._onPpSettings);
  }
}
