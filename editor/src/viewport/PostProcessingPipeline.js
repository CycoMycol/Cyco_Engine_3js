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
import { GTAOPass }        from 'three/addons/postprocessing/GTAOPass.js';
import { SAOPass }         from 'three/addons/postprocessing/SAOPass.js';
import { SSAOPass }        from 'three/addons/postprocessing/SSAOPass.js';
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

    /** @type {OutlinePass|null} — hover highlight (white outline, thinner) */
    this.hoverOutlinePass = null;

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

    /** @type {GTAOPass|SAOPass|SSAOPass|null} — active ambient occlusion pass */
    this.aoPass = null;

    /** AO type: 'gtao' | 'sao' | 'ssao' | 'ao_webgpu' */
    this._aoType = 'gtao';

    /** Whether AO is active in the pipeline */
    this._aoEnabled = false;

    /** GTAO AO material parameters — survive pipeline rebuilds */
    this._aoGtaoParams = {
      output: 0,
      radius: 0.25, distanceExponent: 1, thickness: 1, distanceFallOff: 1,
      scale: 1, samples: 16, screenSpaceRadius: false,
    };

    /** GTAO Poisson Denoise parameters */
    this._aoPdParams = {
      lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4,
      radiusExponent: 1, rings: 2, samples: 8,
    };

    /** SAO parameters.
     *  saoScale must compensate for cameraFar — the SAO shader formula:
     *  scaledScreenDistance = (saoScale / cameraFar) * viewDistance
     *  At cameraFar=10000 we need saoScale=1000 to match the three.js example
     *  (which used cameraFar=10, saoScale=1 giving the same ratio 0.1). */
    this._aoSaoParams = {
      output: 0,
      saoBias: 0.5, saoIntensity: 0.18, saoScale: 1000, saoKernelRadius: 100,
      saoMinResolution: 0, saoBlur: true, saoBlurRadius: 8,
      saoBlurStdDev: 4, saoBlurDepthCutoff: 0.01,
    };

    /** SSAO parameters.
     *  minDistance / maxDistance are in normalised linear depth space (0–1) via
     *  viewZToOrthographicDepth(z, near, far).  With camera near=0.1, far=10000
     *  a 1-world-unit depth step at z=10 ≈ 0.0001 normalised units, so the
     *  three.js example defaults (minDistance=0.005, maxDistance=0.1) calibrated
     *  for near=100/far=700 are ~100× too large for our scene scale. */
    this._aoSsaoParams = {
      output: 0,
      kernelRadius: 8, minDistance: 0.00005, maxDistance: 0.001,
    };

    // ── TSL pipeline (WebGPU native post-processing) ──────────────────────────
    /** @type {import('three/webgpu').RenderPipeline|null} */
    this._tslPipeline = null;

    /** @type {import('./GTAONode.js').GTAONode|null} — TSL ambient occlusion node */
    this._tslAoPass = null;

    /** Whether the TSL RenderPipeline is ready to render */
    this._tslPipelineActive = false;

    /** Pre-built output nodes for live AO output-mode switching */
    this._tslNodes = null;

    /** Prevents reentrant offscreen-compile calls when multiple children are added at once */
    this._compilePending = false;

    this._onVpReady           = this._onVpReady.bind(this);
    this._onRendererChanged   = this._onRendererChanged.bind(this);
    this._onTick              = this._onTick.bind(this);
    this._onResize            = this._onResize.bind(this);
    this._onSelectNode        = this._onSelectNode.bind(this);
    this._onDeselectAll       = this._onDeselectAll.bind(this);
    this._onHoverObject       = this._onHoverObject.bind(this);
    this._onPpSettings        = this._onPpSettings.bind(this);
    this._onSceneChildAdded   = this._onSceneChildAdded.bind(this);
    this._onVpTool            = this._onVpTool.bind(this);

    window.addEventListener('cyco-vp-ready',          this._onVpReady);
    window.addEventListener('cyco-renderer-changed',  this._onRendererChanged);
    window.addEventListener('cyco-vp-tick',           this._onTick);
    window.addEventListener('cyco-vp-resize',         this._onResize);
    window.addEventListener('cyco-select-node',       this._onSelectNode);
    window.addEventListener('cyco-deselect-all',      this._onDeselectAll);
    window.addEventListener('cyco-hover-object',      this._onHoverObject);
    window.addEventListener('cyco-pp-settings',       this._onPpSettings);
    window.addEventListener('cyco-vp-tool',           this._onVpTool);
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

    // 1.5. Ambient Occlusion — applied right after scene render so AO darkening
    //      feeds into the bloom pass (dark areas won't bloom, only bright emissives).
    if (this._aoEnabled && this._aoType !== 'ao_webgpu') {
      this._buildAoPassForType(this._aoType, scene, camera, w, h);
      if (this.aoPass) this._composer.addPass(this.aoPass);
    }

    // 2. Bloom — runs BEFORE outline passes so the selection outline never gets bloomed.
    //    threshold=0.85 so emissive materials (emissiveIntensity>=1.0) produce glow.
    //    Strength 0.8, radius 0.4. Sun disc is SDR + lens flare handles sun glow.
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.8, 0.4, 0.85);
    this._composer.addPass(this.bloomPass);

    // 3. Outline pass — added AFTER bloom so the orange outline (0xff6600) is never
    //    treated as a bright emissive and bloomed into a yellow glow on shadows.
    this.outlinePass = new OutlinePass(new THREE.Vector2(w, h), scene, camera);
    this.outlinePass.edgeStrength = 3;
    this.outlinePass.edgeGlow     = 0;
    this.outlinePass.edgeThickness = 1;
    this.outlinePass.visibleEdgeColor.set(0xff6600);
    this.outlinePass.hiddenEdgeColor.set(0x333333);
    this._composer.addPass(this.outlinePass);

    // 3b. Hover outline pass — white outline when mousing over unselected objects
    this.hoverOutlinePass = new OutlinePass(new THREE.Vector2(w, h), scene, camera);
    this.hoverOutlinePass.edgeStrength  = 2;
    this.hoverOutlinePass.edgeGlow      = 0;
    this.hoverOutlinePass.edgeThickness = 1;
    this.hoverOutlinePass.visibleEdgeColor.set(0xffffff);
    this.hoverOutlinePass.hiddenEdgeColor.set(0x222222);
    this._composer.addPass(this.hoverOutlinePass);

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

    // Apply AO debug state: in non-composite output modes, bloom/outlines must be
    // disabled so the raw debug buffers aren't overwhelmed by bloom/outlines.
    this._applyAoDebugState();

    // Tell ViewportEngine whether the pipeline is active (respects user toggle)
    this.engine.setPipelineActive(this._pipelineEnabled);
  }

  /**
   * Disable bloom and outline passes when in an AO debug output mode (non-composite).
   * In debug modes (AO Only, Depth, Normal, Denoise, Diffuse) the raw AO buffer
   * is written into the compositor pipeline.  UnrealBloomPass would bloom the bright
   * white (no-occlusion) regions and completely white-out the debug view, so we
   * disable it while any non-default output mode is active.
   */
  _applyAoDebugState() {
    const output = this._aoEnabled
      ? ( this._aoType === 'gtao' ? (this._aoGtaoParams.output ?? 0)
        : this._aoType === 'sao'  ? (this._aoSaoParams.output  ?? 0)
        : this._aoType === 'ssao' ? (this._aoSsaoParams.output ?? 0)
        : 0 )
      : 0;
    const isDebug = (output !== 0);
    if (this.bloomPass)        this.bloomPass.enabled        = !isDebug;
    if (this.outlinePass)      this.outlinePass.enabled      = !isDebug;
    if (this.hoverOutlinePass) this.hoverOutlinePass.enabled = !isDebug;
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
    this.aoPass      = null;
    this.engine.setPipelineActive(false);
  }

  _disposeTslPipeline() {
    this._tslPipelineActive = false;
    this._compilePending = false;
    // Remove scene listener added during _buildWebGPUPipeline
    this.engine.scene?.removeEventListener('childadded', this._onSceneChildAdded);
    if (this._tslAoPass) {
      this._tslAoPass.dispose?.();
      this._tslAoPass = null;
    }
    if (this._tslPipeline) {
      this._tslPipeline.dispose?.();
      this._tslPipeline = null;
    }
    this._tslNodes = null;
    this.engine.setPipelineActive(false);
  }

  async _buildWebGPUPipeline(renderer, scene, camera) {
    this._tslPipelineActive = false;
    try {
      const webgpuMod = await import('three/webgpu');
      const { RenderPipeline, TSL } = webgpuMod;
      const {
        pass, mrt, normalView, output,
        vec3, vec4,
      } = TSL;
      const { ao } = await import('three/addons/tsl/display/GTAONode.js');

      this._tslPipeline = new RenderPipeline(renderer);

      let outputNode;

      if (this._aoEnabled && this._aoType === 'ao_webgpu') {
        // ── Single scene pass with MRT: colour + view-space normals ──────────
        // Official GTAONode approach: one pass outputs both scene colour AND
        // normals into separate render target attachments.
        // Using 'output' (the fragment output node) preserves correct scene
        // colour — do NOT replace it with normals as that causes black geometry.
        const scenePass = pass(scene, camera);
        scenePass.setMRT(mrt({
          output: output,      // standard scene colour — preserved
          normal: normalView,  // view-space normals for GTAO
        }));

        const scenePassColor  = scenePass.getTextureNode('output');
        const scenePassNormal = scenePass.getTextureNode('normal');
        const scenePassDepth  = scenePass.getTextureNode('depth');

        // ── AO node ──────────────────────────────────────────────────────────
        this._tslAoPass = ao(scenePassDepth, scenePassNormal, camera);

        const p = this._aoGtaoParams;
        this._tslAoPass.radius.value           = p.radius          ?? 0.25;
        this._tslAoPass.distanceExponent.value = p.distanceExponent ?? 1;
        this._tslAoPass.distanceFallOff.value  = p.distanceFallOff  ?? 1;
        this._tslAoPass.scale.value            = p.scale            ?? 1;
        this._tslAoPass.thickness.value        = p.thickness        ?? 1;
        this._tslAoPass.samples.value          = p.samples          ?? 16;
        this._tslAoPass.resolutionScale        = 1;

        const aoTex = this._tslAoPass.getTextureNode();

        // Post-multiply composite: scene colour × AO value (darkens occluded areas)
        const compositeNode = scenePassColor.mul(vec4(vec3(aoTex.r), 1));

        // AO-only diagnostic output (greyscale occlusion map)
        const aoOnlyNode = vec4(vec3(aoTex.r), 1);

        // Store nodes for output-mode switching (no rebuild needed)
        this._tslNodes = {
          composite: compositeNode,
          aoOnly:    aoOnlyNode,
        };

        const outputMode = p.output ?? 0;
        outputNode = outputMode === 4 ? aoOnlyNode : compositeNode;
      } else {
        // AO disabled — render scene directly, no post-processing
        const scenePass = pass(scene, camera);
        this._tslNodes  = { sceneOnly: scenePass };
        outputNode      = scenePass;
      }

      this._tslPipeline.outputNode = outputNode;

      // Pre-warm: render the scene once so all MeshStandardMaterial programs
      // are compiled in the correct NodeMaterial context.  The TSL RenderPipeline
      // uses cached compiled programs — without this call newly-added objects
      // remain invisible on the first frame.  The direct render writes one raw
      // frame to the canvas but the TSL pipeline overwrites it on the very
      // next animation frame, so the flash is imperceptible in practice.
      renderer.render(scene, camera);

      // Subscribe so objects added AFTER the pipeline is built are compiled
      // before the TSL pipeline tries to render them.
      scene.removeEventListener('childadded', this._onSceneChildAdded); // guard against double-add
      scene.addEventListener('childadded', this._onSceneChildAdded);

      this._tslPipelineActive = true;
      this.engine.setPipelineActive(true);

    } catch (err) {
      console.error('[PostProcessingPipeline] WebGPU TSL pipeline build failed:', err);
      this._tslPipelineActive = false;
      this.engine.setPipelineActive(false);
    }
  }

  // ─── Scene child-added: compile new objects for TSL pipeline ─────────────

  /**
   * Called when THREE.Object3D is added to the scene while the TSL pipeline
   * is active.  New objects' materials are not automatically compiled for the
   * TSL RenderPipeline context, so we trigger an offscreen render pass that
   * forces the renderer to compile the new material programs.
   */
  _onSceneChildAdded() {
    if (!this._tslPipelineActive) return;
    this._scheduleTslCompile();
  }

  /**
   * Schedules a deferred direct render that compiles any uncompiled material
   * programs (new objects, newly-visible gizmo handles, etc.) in the correct
   * NodeMaterial context so the TSL RenderPipeline can display them.
   * Coalesces multiple rapid calls into a single compile using _compilePending.
   */
  _scheduleTslCompile() {
    if (this._compilePending) return;
    this._compilePending = true;
    // Defer past the current call stack so the renderer is not in the middle
    // of a frame when we call render().
    setTimeout(() => {
      this._compilePending = false;
      if (!this._tslPipelineActive) return;
      const renderer = this.engine.rendererManager?.renderer;
      const scene    = this.engine.scene;
      const camera   = this.engine.camera;
      if (!renderer || !scene || !camera) return;
      // A direct render compiles the new material in the correct NodeMaterial
      // context.  The compiled programs are cached and reused by the TSL
      // RenderPipeline, so the object becomes visible on the very next frame.
      // This writes one raw frame to the canvas, but the TSL pipeline
      // overwrites it within the same vsync, so the flash is imperceptible.
      renderer.render(scene, camera);
    }, 0);
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
      this._disposeTslPipeline();
      this._buildWebGLPipeline(renderer, scene, camera, w, h);
    } else if (type === 'webgpu') {
      this._disposeWebGLPipeline();
      this._buildWebGPUPipeline(renderer, scene, camera); // async — pipeline activates when ready
    } else {
      // SVG / CSS3D / PathTracer — no post-processing
      this._disposeTslPipeline();
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

  /** Clear the loaded LUT texture and disable the pass. */
  clearLut() {
    this._lutTexture = null;
    if (this.lutPass) {
      this.lutPass.lut     = null;
      this.lutPass.enabled = false;
    }
    this._lutEnabled = false;
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

  // ─── Ambient Occlusion API ───────────────────────────────────────────────────

  /**
   * Enable or disable ambient occlusion. Rebuilds the pipeline.
   * @param {boolean} v
   */
  setAoEnabled(v) {
    this._aoEnabled = !!v;
    this._rebuildForCurrentType();
  }

  /**
   * Set the AO algorithm. Rebuilds the pipeline.
   * @param {'gtao'|'sao'|'ssao'|'ao_webgpu'} type
   */
  setAoType(type) {
    this._aoType = type;
    this._rebuildForCurrentType();
  }

  /**
   * Live-update GTAO AO material parameters (no rebuild needed).
   * @param {Partial<typeof PostProcessingPipeline.prototype._aoGtaoParams>} params
   */
  updateGtaoParams(params) {
    Object.assign(this._aoGtaoParams, params);
    if (this.aoPass instanceof GTAOPass) this.aoPass.updateGtaoMaterial(params);
    // Live-update TSL AO uniforms — no pipeline rebuild needed
    if (this._tslAoPass) {
      if (params.radius          !== undefined) this._tslAoPass.radius.value          = params.radius;
      if (params.distanceExponent !== undefined) this._tslAoPass.distanceExponent.value = params.distanceExponent;
      if (params.distanceFallOff !== undefined) this._tslAoPass.distanceFallOff.value  = params.distanceFallOff;
      if (params.scale           !== undefined) this._tslAoPass.scale.value            = params.scale;
      if (params.thickness       !== undefined) this._tslAoPass.thickness.value        = params.thickness;
      if (params.samples         !== undefined) this._tslAoPass.samples.value          = params.samples;
    }
  }

  /**
   * Live-update GTAO Poisson Denoise parameters (no rebuild needed).
   * @param {Partial<typeof PostProcessingPipeline.prototype._aoPdParams>} params
   */
  updatePdParams(params) {
    Object.assign(this._aoPdParams, params);
    if (this.aoPass instanceof GTAOPass) this.aoPass.updatePdMaterial(params);
  }

  /**
   * Live-update SAO parameters (no rebuild needed).
   * @param {Partial<typeof PostProcessingPipeline.prototype._aoSaoParams>} params
   */
  updateSaoParams(params) {
    Object.assign(this._aoSaoParams, params);
    if (this.aoPass instanceof SAOPass) Object.assign(this.aoPass.params, params);
  }

  /**
   * Live-update SSAO parameters (no rebuild needed).
   * @param {Partial<typeof PostProcessingPipeline.prototype._aoSsaoParams>} params
   */
  updateSsaoParams(params) {
    Object.assign(this._aoSsaoParams, params);
    if (this.aoPass instanceof SSAOPass) {
      if (params.kernelRadius !== undefined) this.aoPass.kernelRadius = params.kernelRadius;
      if (params.minDistance  !== undefined) this.aoPass.minDistance  = params.minDistance;
      if (params.maxDistance  !== undefined) this.aoPass.maxDistance  = params.maxDistance;
      if (params.output       !== undefined) this.aoPass.output       = params.output;
    }
  }

  /**
   * Set the debug output mode for the active AO pass (no rebuild needed).
   * GTAO: 0=Default,1=Diffuse,2=Depth,3=Normal,4=AO,5=Denoise
   * SAO:  0=Default,1=SAO,2=Normal
   * SSAO: 0=Default,1=SSAO,2=Blur,3=Depth,4=Normal
   * @param {number} mode
   */
  setAoOutputMode(mode) {
    const m = +mode;
    const type = this._aoType;

    // ── WebGPU TSL pipeline: switch output node without rebuilding ────────────
    if (type === 'ao_webgpu') {
      this._aoGtaoParams.output = m;
      if (this._tslPipeline && this._tslNodes) {
        this._tslPipeline.outputNode =
          (m === 4) ? (this._tslNodes.aoOnly    ?? this._tslNodes.sceneOnly)
                    : (this._tslNodes.composite ?? this._tslNodes.sceneOnly);
        this._tslPipeline.needsUpdate = true;
      }
      return;
    }

    if (type === 'gtao') {
      this._aoGtaoParams.output = m;
      if (this.aoPass instanceof GTAOPass) this.aoPass.output = m;
    } else if (type === 'sao') {
      this._aoSaoParams.output = m;
      if (this.aoPass instanceof SAOPass) this.aoPass.params.output = m;
    } else if (type === 'ssao') {
      this._aoSsaoParams.output = m;
      if (this.aoPass instanceof SSAOPass) this.aoPass.output = m;
    }
    // Disable bloom/outlines in debug modes so raw buffers aren't overwhelmed
    this._applyAoDebugState();
  }

  /**
   * Build the correct AO pass for the given type and store in this.aoPass.
   * @param {'gtao'|'sao'|'ssao'} type
   * @param {THREE.Scene}  scene
   * @param {THREE.Camera} camera
   * @param {number} w
   * @param {number} h
   */
  _buildAoPassForType(type, scene, camera, w, h) {
    this.aoPass = null;
    switch (type) {
      case 'gtao': {
        const p = new GTAOPass(scene, camera, w, h);
        p.output = this._aoGtaoParams.output ?? GTAOPass.OUTPUT.Default;
        p.updateGtaoMaterial(this._aoGtaoParams);
        p.updatePdMaterial(this._aoPdParams);
        this.aoPass = p;
        break;
      }
      case 'sao': {
        const p = new SAOPass(scene, camera, new THREE.Vector2(w, h));
        // output is stored as _aoSaoParams.output and maps to p.params.output
        const { output: _saoOut, ...saoRest } = this._aoSaoParams;
        Object.assign(p.params, saoRest);
        p.params.output = this._aoSaoParams.output ?? SAOPass.OUTPUT.Default;
        this.aoPass = p;
        break;
      }
      case 'ssao': {
        const p = new SSAOPass(scene, camera, w, h);
        p.kernelRadius = this._aoSsaoParams.kernelRadius;
        p.minDistance  = this._aoSsaoParams.minDistance;
        p.maxDistance  = this._aoSsaoParams.maxDistance;
        p.output       = this._aoSsaoParams.output ?? SSAOPass.OUTPUT.Default;
        // Ensure camera uniforms are current (constructor uses values at creation time)
        if (p.ssaoMaterial && camera) {
          const u = p.ssaoMaterial.uniforms;
          u['cameraNear'].value = camera.near;
          u['cameraFar'].value  = camera.far;
          u['cameraProjectionMatrix'].value.copy(camera.projectionMatrix);
          u['cameraInverseProjectionMatrix'].value.copy(camera.projectionMatrixInverse);
        }
        this.aoPass = p;
        break;
      }
      default:
        break;
    }
  }

  /** Rebuild the pipeline for the current renderer type. */
  _rebuildForCurrentType() {
    const renderer = this.engine.rendererManager?.renderer;
    const type     = this.engine.rendererManager?.activeType ?? 'webgl';
    if (renderer) this._rebuildForType(renderer, type);
  }

  // ─── Event handlers ───────────────────────────────────────────────────────

  _onTick() {
    // ── TSL pipeline (WebGPU native post-processing) ──────────────────────────
    if (this._tslPipelineActive && this._tslPipeline && this._pipelineEnabled) {
      try {
        this._tslPipeline.render();
      } catch (err) {
        console.error('[PostProcessingPipeline] TSL pipeline render error — disabling:', err);
        this._disposeTslPipeline();
      }
      return;
    }

    // ── WebGL EffectComposer pipeline ─────────────────────────────────────────
    if (!this._composer || !this._pipelineEnabled) return;
    // Keep SSAO camera uniforms current each frame (projection matrix can change on FOV/aspect updates)
    if (this.aoPass instanceof SSAOPass && this.aoPass.ssaoMaterial) {
      const cam = this.engine.camera;
      if (cam) {
        const u = this.aoPass.ssaoMaterial.uniforms;
        u['cameraNear'].value = cam.near;
        u['cameraFar'].value  = cam.far;
        u['cameraProjectionMatrix'].value.copy(cam.projectionMatrix);
        u['cameraInverseProjectionMatrix'].value.copy(cam.projectionMatrixInverse);
      }
    }
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
    if (this.outlinePass) {
      const { objects } = event.detail;
      this.outlinePass.selectedObjects = objects ?? [];
    }
    // When selection changes with the TSL pipeline active, newly-visible gizmo
    // handles (TransformControls) may not have compiled shaders yet.  Schedule
    // a deferred compile so they appear on the very next frame.
    if (this._tslPipelineActive) this._scheduleTslCompile();
  }

  _onDeselectAll() {
    if (this.outlinePass) this.outlinePass.selectedObjects = [];
  }

  _onVpTool() {
    // Tool mode changed (e.g. select → translate).  TransformControls may now
    // show handles that weren't visible during the last compile run, so trigger
    // a recompile to make them visible on the first frame.
    if (this._tslPipelineActive) this._scheduleTslCompile();
  }

  _onHoverObject(event) {
    if (!this.hoverOutlinePass) return;
    const { object } = event.detail ?? {};
    this.hoverOutlinePass.selectedObjects = object ? [object] : [];
  }

  _onPpSettings(event) {
    const { pass, prop, value } = event.detail;
    switch (pass) {
      case 'outline':
        if (this.outlinePass && prop in this.outlinePass) this.outlinePass[prop] = value;
        break;
      case 'ao':
      case 'gtao':  // legacy alias
        if (this.aoPass && prop in this.aoPass) this.aoPass[prop] = value;
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
    window.removeEventListener('cyco-hover-object',      this._onHoverObject);
    window.removeEventListener('cyco-pp-settings',       this._onPpSettings);
    window.removeEventListener('cyco-vp-tool',           this._onVpTool);
  }
}
