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
import { ShaderPass }      from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass }        from 'three/addons/postprocessing/SMAAPass.js';
import { LUTPass }         from 'three/addons/postprocessing/LUTPass.js';
import { FXAAShader }      from 'three/addons/shaders/FXAAShader.js';
import { LUTCubeLoader }   from 'three/addons/loaders/LUTCubeLoader.js';

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

    /** @type {ShaderPass|null} — FXAA anti-aliasing, added after OutputPass */
    this.fxaaPass = null;

    /** @type {SMAAPass|null} — SMAA anti-aliasing, added before OutputPass */
    this.smaaPass = null;

    /** @type {LUTPass|null} — LUT color grading, added after OutputPass */
    this.lutPass = null;

    /** Whether the EffectComposer pipeline is active (vs. direct renderer.render) */
    this._pipelineEnabled = true;

    /** Current AA mode — 'none' | 'fxaa' | 'smaa' | 'msaa2' | 'msaa4' */
    this._aaMode = 'none';

    /** @deprecated kept for back-compat; use _aaMode instead */
    this._fxaaEnabled = false;

    /** LUT pass enabled state */
    this._lutEnabled = false;

    /** LUT blend intensity (0–1) */
    this._lutIntensity = 1.0;

    /** Loaded 3D LUT texture */
    this._lutTexture = null;

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

    // Use a half-float HDR render target so that physical-sky luminance values > 1.0
    // are preserved through the pipeline and correctly tone-mapped by OutputPass.
    // MSAA: set samples > 0 on the HDR render target for WebGL2 hardware anti-aliasing.
    // FXAA / SMAA are post-process passes and don't need a multisampled target.
    const msaaSamples = this._aaMode === 'msaa4' ? 4 : this._aaMode === 'msaa2' ? 2 : 0;
    const hdrTarget = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      samples: msaaSamples,
    });
    this._composer = new EffectComposer(renderer, hdrTarget);

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

    // 3. Bloom — threshold=0.85 so emissive materials (emissiveIntensity>=1.0) produce glow.
    //    Strength 0.8, radius 0.4. Sun disc is SDR + lens flare handles sun glow.
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.8, 0.4, 0.85);
    this._composer.addPass(this.bloomPass);

    // 4. SMAA — must come BEFORE OutputPass (operates on linear-sRGB HDR data).
    const dpr = renderer.getPixelRatio();
    this.smaaPass = new SMAAPass(w * dpr, h * dpr);
    this.smaaPass.enabled = (this._aaMode === 'smaa');
    this._composer.addPass(this.smaaPass);

    // 5. OutputPass — applies tone mapping + sRGB output conversion
    this._composer.addPass(new OutputPass());

    // 6. FXAA — must come AFTER OutputPass (operates on final LDR/sRGB image).
    this.fxaaPass = new ShaderPass(FXAAShader);
    this.fxaaPass.material.uniforms['resolution'].value.set(1 / (w * dpr), 1 / (h * dpr));
    this.fxaaPass.enabled = (this._aaMode === 'fxaa');
    this._composer.addPass(this.fxaaPass);

    // 7. LUT color grading — applied after tone-mapping on the LDR image.
    this.lutPass = new LUTPass();
    this.lutPass.enabled   = this._lutEnabled;
    this.lutPass.intensity = this._lutIntensity;
    if (this._lutTexture) this.lutPass.lut = this._lutTexture;
    this._composer.addPass(this.lutPass);

    // Tell ViewportEngine whether the pipeline is active (respects user toggle)
    this.engine.setPipelineActive(this._pipelineEnabled);
  }

  _disposeWebGLPipeline() {
    if (!this._composer) return;
    this._composer.passes.forEach(pass => pass.dispose?.());
    this._composer.dispose?.();
    this._composer   = null;
    this.outlinePass = null;
    this.bloomPass   = null;
    this.fxaaPass    = null;
    this.smaaPass    = null;
    this.lutPass     = null;
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

  // ─── Pipeline enabled / AA / LUT API ────────────────────────────────────────

  /** Enable or disable the entire EffectComposer pipeline. */
  get pipelineEnabled() { return this._pipelineEnabled; }
  set pipelineEnabled(v) {
    this._pipelineEnabled = !!v;
    this.engine.setPipelineActive(!!v && !!this._composer);
  }

  /**
   * Set the anti-aliasing mode.
   * @param {'none'|'fxaa'|'smaa'|'msaa2'|'msaa4'} mode
   */
  setAntiAliasMode(mode) {
    const prev = this._aaMode;
    this._aaMode = mode;
    this._fxaaEnabled = (mode === 'fxaa'); // keep legacy flag in sync

    // MSAA is a render-target property — any change to/from MSAA requires a full rebuild.
    const prevWasMsaa = (prev === 'msaa2' || prev === 'msaa4');
    const nowIsMsaa   = (mode === 'msaa2' || mode === 'msaa4');
    if (prevWasMsaa || nowIsMsaa) {
      this._rebuildForCurrentType();
    } else {
      // For FXAA / SMAA / none we can toggle passes in-place (no render-target change).
      if (this.fxaaPass) this.fxaaPass.enabled = (mode === 'fxaa');
      if (this.smaaPass) this.smaaPass.enabled = (mode === 'smaa');
    }
  }

  /** Enable or disable LUT color grading. */
  setLutEnabled(enabled) {
    this._lutEnabled = !!enabled;
    if (this.lutPass) this.lutPass.enabled = this._lutEnabled;
  }

  /** Set the LUT blend intensity (0 = original, 1 = full LUT). */
  setLutIntensity(v) {
    this._lutIntensity = v;
    if (this.lutPass) this.lutPass.intensity = v;
  }

  /**
   * Load a .cube LUT file and apply it to the LUT pass.
   * @param {File} file - A .cube file from an <input type="file"> element.
   */
  loadLutFromFile(file) {
    const url = URL.createObjectURL(file);
    new LUTCubeLoader().load(
      url,
      (result) => {
        this._lutTexture = result.texture3D;
        if (this.lutPass) this.lutPass.lut = this._lutTexture;
        URL.revokeObjectURL(url);
      },
      undefined,
      (err) => {
        console.error('[PostProcessingPipeline] Failed to load LUT file:', err);
        URL.revokeObjectURL(url);
      }
    );
  }

  /** @deprecated Use setAntiAliasMode('fxaa') / setAntiAliasMode('none') */
  setFxaaEnabled(v) {
    this.setAntiAliasMode(v ? 'fxaa' : 'none');
  }

  /** Rebuild the pipeline for the current renderer type. */
  _rebuildForCurrentType() {
    const renderer = this.engine.rendererManager?.renderer;
    const type     = this.engine.rendererManager?.activeType ?? 'webgl';
    if (renderer) this._rebuildForType(renderer, type);
  }

  // ─── Event handlers ───────────────────────────────────────────────────────

  _onTick() {
    if (!this._composer || !this._pipelineEnabled) return;
    try {
      this._composer.render();
    } catch (err) {
      console.error('[PostProcessingPipeline] Composer render error — falling back to direct rendering:', err);
      this._disposeWebGLPipeline(); // clears _composer and sets pipelineActive = false
    }
  }

  _onResize(event) {
    if (!this._composer) return;
    const renderer = this.engine.rendererManager?.renderer;
    if (!renderer) return;
    const { width, height } = event.detail;
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));

    // Resize the composer and all its passes in-place.
    // UnrealBloomPass, OutlinePass and ShaderPass all implement setSize() correctly
    // in r184 — this avoids a full rebuild that would reset every pass to its defaults
    // and leave the PostProcessingProperties UI holding stale closed-over references.
    this._composer.setSize(w, h);

    // ShaderPass (FXAA) stores resolution in a uniform; setSize() doesn't update it.
    const dpr = renderer.getPixelRatio();
    if (this.fxaaPass) {
      this.fxaaPass.material.uniforms['resolution'].value.set(1 / (w * dpr), 1 / (h * dpr));
    }
    // SMAAPass.setSize() is forwarded by EffectComposer, but it expects physical pixels.
    // The composer calls setSize with CSS pixels, so we override with the DPR-scaled values.
    if (this.smaaPass) {
      this.smaaPass.setSize(w * dpr, h * dpr);
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
