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

    /**
     * When true, a direct renderer.render() is injected before the next TSL
     * render to compile any uncompiled materials (new objects, gizmo handles).
     * The TSL pipeline clears and overwrites it in the same frame, so there
     * is no user-visible ghost or flash.
     */
    this._needsTslCompile = false;

    /** @type {BloomNode|null} — TSL bloom node for WebGPU; live param updates via .strength/.radius/.threshold */
    this._tslBloomNode = null;

    /** Bloom parameters persisted across pipeline rebuilds (shared by WebGL & TSL) */
    this._bloomParams = { enabled: true, strength: 0.8, radius: 0.4, threshold: 0.85 };

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
    this._tslPipelineActive  = false;
    this._needsTslCompile    = false;
    this._tslBloomNode       = null;
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
    if (this._compileRT) {
      this._compileRT.dispose();
      this._compileRT = null;
    }
    this._tslNodes = null;
    this.engine.setPipelineActive(false);
  }

  async _buildWebGPUPipeline(renderer, scene, camera) {
    this._tslPipelineActive = false;
    this._tslBloomNode = null;
    try {
      const webgpuMod = await import('three/webgpu');
      const { RenderPipeline, TSL } = webgpuMod;
      const {
        pass, mrt, normalView, output,
        vec3, vec4,
      } = TSL;
      const [{ ao }, { bloom: bloomFn }] = await Promise.all([
        import('three/addons/tsl/display/GTAONode.js'),
        import('three/addons/tsl/display/BloomNode.js'),
      ]);

      this._tslPipeline = new RenderPipeline(renderer);

      let outputNode;
      let sceneColorNode; // node representing scene colour, passed to bloom

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
        // Force alpha=1 on the output — QuadMesh.render() uses autoClear=false, so any
        // pixel with alpha<1 would let the previous canvas frame bleed through (ghosting).
        const compositeNode = vec4(scenePassColor.rgb.mul(vec3(aoTex.r)), 1);

        // AO-only diagnostic output (greyscale occlusion map)
        const aoOnlyNode = vec4(vec3(aoTex.r), 1);

        // Store nodes for output-mode switching (no rebuild needed)
        this._tslNodes = {
          composite: compositeNode,
          aoOnly:    aoOnlyNode,
        };

        const outputMode = p.output ?? 0;
        sceneColorNode = scenePassColor;
        outputNode = outputMode === 4 ? aoOnlyNode : compositeNode;
      } else {
        // AO disabled — render scene directly, no post-processing.
        // Use scenePass directly (not swizzled) so RenderPipeline can traverse
        // the PassNode and render the scene.  Swizzling (e.g. scenePass.rgb)
        // breaks graph traversal and produces a black viewport.
        const scenePass = pass(scene, camera);
        this._tslNodes  = { sceneOnly: scenePass };
        sceneColorNode  = scenePass;
        outputNode      = scenePass;
      }

      // ── Bloom ──────────────────────────────────────────────────────────────
      // Always build the bloom node so enabling/disabling is live via
      // this._tslBloomNode.strength.value without a pipeline rebuild.
      {
        const bp = this._bloomParams;
        const initStrength = (bp.enabled !== false) ? (bp.strength ?? 0.8) : 0;
        this._tslBloomNode = bloomFn(sceneColorNode, initStrength, bp.radius ?? 0.4, bp.threshold ?? 0.85);
        outputNode = outputNode.add(this._tslBloomNode);
      }

      this._tslPipeline.outputNode = outputNode;

      // Flag a compile pass on the first tick so all scene materials are
      // compiled in the correct NodeMaterial context.  The compile render
      // happens inside _onTick right before TSL, which then clears and
      // overwrites it — zero visual artifact.
      this._needsTslCompile = true;

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
   * Mark that a compile pass is needed on the next tick.
   * The compile render (renderer.render) runs inside _onTick immediately
   * before _tslPipeline.render(), which clears and overwrites it in the same
   * animation frame — camera position is identical so there is no ghost.
   */
  _scheduleTslCompile() {
    console.log('[CYCO:COMPILE] _scheduleTslCompile() — materials will compile offscreen next frame');
    this._needsTslCompile = true;
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
    // In WebGPU mode _composer is null — use _tslPipelineActive instead.
    this.engine.setPipelineActive(!!v && (!!this._composer || this._tslPipelineActive));
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
    // ── Debug instrumentation (reads window.CYCO_DEBUG_RENDER set in ViewportEngine._tick) ──
    const _D  = window.CYCO_DEBUG_RENDER === true;
    const _fr = window._cycoDbgFrame || '?';
    // ─────────────────────────────────────────────────────────────────────────

    // ── TSL pipeline (WebGPU native post-processing) ──────────────────────────
    if (this._tslPipelineActive && this._tslPipeline && this._pipelineEnabled) {
      const renderer = this.engine.rendererManager?.renderer;
      const scene    = this.engine.scene;
      const camera   = this.engine.camera;

      if (_D) {
        const rt = renderer?.getRenderTarget();
        console.group(
          `%c  [CYCO:PP] Frame #${_fr} — TSL pipeline`,
          'color:#8cf;font-weight:bold'
        );
        console.log(
          `%c    [STATE] autoClear=${renderer?.autoClear}  clearAlpha=${renderer?.clearAlpha}` +
          `  RT=${rt ? `RT(${rt.width}×${rt.height})` : 'null→CANVAS'}`,
          'color:#aaa'
        );
        console.log(
          `%c    [STATE] _needsTslCompile=${this._needsTslCompile}` +
          `  _tslPipelineActive=${this._tslPipelineActive}` +
          `  _pipelineEnabled=${this._pipelineEnabled}` +
          `  hasAO=${!!this._tslAoPass}`,
          'color:#aaa'
        );
      }

      // If new materials need compiling, run a compile pass into an offscreen
      // render target so it never touches the visible canvas — no ghosting.
      if (this._needsTslCompile) {
        this._needsTslCompile = false;
        if (renderer && scene && camera) {
          // Allocate a tiny offscreen render target on first use.
          // WebGLRenderTarget from three.module uses duck-typed interface that
          // the WebGPU renderer (forceWebGL) accepts — no instanceof check.
          if (!this._compileRT) {
            this._compileRT = new THREE.WebGLRenderTarget(1, 1);
          }
          const prev = renderer.getRenderTarget();
          console.log(
            `[CYCO:COMPILE] frame #${_fr} — setRenderTarget(1×1)  prev=${prev ? `RT(${prev.width}×${prev.height})` : 'null(CANVAS)'}  canvas NOT written`
          );
          renderer.setRenderTarget(this._compileRT);
          renderer.render(scene, camera);
          renderer.setRenderTarget(prev);
          const _rtAfter = renderer.getRenderTarget();
          console.log(
            `[CYCO:COMPILE] done  RT restored=${_rtAfter ? `RT(${_rtAfter.width}×${_rtAfter.height})` : 'null(CANVAS)'}`
          );
        }
      }

      if (_D) {
        const rt = renderer?.getRenderTarget();
        console.log(
          `%c    [TSL-RENDER] → _tslPipeline.render()  RT=${rt ? `RT(${rt.width}×${rt.height})` : 'null→CANVAS'}` +
          `  autoClear=${renderer?.autoClear}`,
          'color:#4cf;font-weight:bold'
        );
      }
      try {
        // Ensure we're targeting the canvas (null RT) before clearing and blitting.
        // A previous operation (e.g. compile pass, contact-shadows) may have left
        // the renderer pointing at an offscreen RT — clearing that would leave the
        // canvas untouched and render transparent-black pixels.
        renderer.setRenderTarget(null);

        // Sync clear colour to the scene background so the canvas background
        // matches when the TSL PassNode blits transparent pixels (the PassNode
        // renders objects but leaves empty-space pixels transparent/alpha=0;
        // the canvas clear colour fills those holes via src-alpha blending).
        const bg = scene?.background;
        if (bg?.isColor) {
          renderer.setClearColor(bg, 1);
        } else {
          // No solid background — clear to transparent so empty canvas areas
          // (including the ViewHelper gizmo background) show the page CSS
          // background instead of an opaque black box.
          // NB: renderer.clear() runs BEFORE _tslPipeline.render(), so the
          // previous frame is always fully wiped — no ghosting occurs here.
          renderer.setClearColor(0x000000, 0);
        }

        // Explicitly clear the canvas before the TSL composite quad draws.
        // QuadMesh.render() sets autoClear=false internally, so without this any
        // pixel with alpha<1 in the output would blend with the previous frame.
        renderer.clear();
        this._tslPipeline.render();
        window._cycoDbgCanvasWrites = (window._cycoDbgCanvasWrites || 0) + 1;
        if (_D) {
          const rt = renderer?.getRenderTarget();
          console.log(
            `%c    [TSL-RENDER] ✓ done  RT after=${rt ? `RT(${rt.width}×${rt.height})` : 'null→CANVAS'}` +
            `  → canvas written (quad blit)`,
            'color:#4cf'
          );
        }
      } catch (err) {
        if (_D) console.log('%c    [TSL-RENDER] ✗ threw — disabling pipeline', 'color:#f44', err);
        console.error('[PostProcessingPipeline] TSL pipeline render error — disabling:', err);
        this._disposeTslPipeline();
      }
      if (_D) console.groupEnd();
      return;
    }

    // ── WebGL EffectComposer pipeline ─────────────────────────────────────────
    if (!this._composer || !this._pipelineEnabled) {
      if (_D) console.log(
        `%c  [CYCO:PP] Frame #${_fr} — SKIP (composer=${!!this._composer}` +
        ` pipelineEnabled=${this._pipelineEnabled}` +
        ` tslActive=${this._tslPipelineActive})`,
        'color:#888'
      );
      return;
    }

    if (_D) {
      const renderer = this.engine.rendererManager?.renderer;
      const rt = renderer?.getRenderTarget();
      console.group(
        `%c  [CYCO:PP] Frame #${_fr} — WebGL EffectComposer`,
        'color:#c8f;font-weight:bold'
      );
      console.log(
        `%c    [STATE] autoClear=${renderer?.autoClear}  RT=${rt ? `RT(${rt.width}×${rt.height})` : 'null→CANVAS'}`,
        'color:#aaa'
      );
    }
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
    if (_D) console.log('%c    [COMPOSER] → composer.render()', 'color:#c8f;font-weight:bold');
    try {
      this._composer.render();
      window._cycoDbgCanvasWrites = (window._cycoDbgCanvasWrites || 0) + 1;
      if (_D) {
        const renderer = this.engine.rendererManager?.renderer;
        const rt = renderer?.getRenderTarget();
        console.log(
          `%c    [COMPOSER] ✓ done  RT after=${rt ? `RT(${rt.width}×${rt.height})` : 'null→CANVAS'}` +
          `  → canvas written`,
          'color:#c8f'
        );
      }
    } catch (err) {
      if (_D) console.log('%c    [COMPOSER] ✗ threw — falling back', 'color:#f44', err);
      console.error('[PostProcessingPipeline] Composer render error — falling back to direct rendering:', err);
      this._disposeWebGLPipeline(); // clears _composer and sets pipelineActive = false
    }
    if (_D) console.groupEnd();
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
        // WebGL UnrealBloomPass
        if (this.bloomPass && prop in this.bloomPass) this.bloomPass[prop] = value;
        // TSL BloomNode (WebGPU) — live uniform updates without pipeline rebuild
        if (this._tslBloomNode) {
          if (prop === 'enabled') {
            this._bloomParams.enabled = value;
            this._tslBloomNode.strength.value = value
              ? (this._bloomParams.strength ?? 0.8)
              : 0;
          } else if (prop === 'strength') {
            this._bloomParams.strength = value;
            if (this._bloomParams.enabled !== false) this._tslBloomNode.strength.value = value;
          } else if (prop === 'radius') {
            this._bloomParams.radius = value;
            this._tslBloomNode.radius.value = value;
          } else if (prop === 'threshold') {
            this._bloomParams.threshold = value;
            this._tslBloomNode.threshold.value = value;
          }
        }
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
