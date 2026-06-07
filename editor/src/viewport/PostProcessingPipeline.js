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
import { GodRays }         from './GodRays.js';

// ─── WebGL post-FX shader definitions ────────────────────────────────────────

const ChromaticAberrationShader = {
  uniforms: {
    tDiffuse: { value: null },
    strength: { value: 0.002 },
    enabled:  { value: 0.0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float strength;
    uniform float enabled;
    varying vec2 vUv;
    void main() {
      if (enabled < 0.5) { gl_FragColor = texture2D(tDiffuse, vUv); return; }
      vec2 offset = (vUv - 0.5) * strength;
      float r = texture2D(tDiffuse, vUv + offset).r;
      float g = texture2D(tDiffuse, vUv        ).g;
      float b = texture2D(tDiffuse, vUv - offset).b;
      gl_FragColor = vec4(r, g, b, 1.0);
    }
  `,
};

const VignetteShader = {
  uniforms: {
    tDiffuse: { value: null },
    offset:   { value: 1.0 },
    darkness: { value: 1.0 },
    enabled:  { value: 0.0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float offset;
    uniform float darkness;
    uniform float enabled;
    varying vec2 vUv;
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      if (enabled > 0.5) {
        float dist = distance(vUv, vec2(0.5));
        color.rgb *= smoothstep(0.8, offset * 0.799, dist * (darkness + offset));
      }
      gl_FragColor = color;
    }
  `,
};

const FilmGrainShader = {
  uniforms: {
    tDiffuse:  { value: null },
    time:      { value: 0.0 },
    intensity: { value: 0.1 },
    enabled:   { value: 0.0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform float intensity;
    uniform float enabled;
    varying vec2 vUv;
    float rand(vec2 co) {
      return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
    }
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      if (enabled > 0.5) {
        float grain = rand(vUv + vec2(time * 0.001)) * 2.0 - 1.0;
        color.rgb += grain * intensity;
      }
      gl_FragColor = color;
    }
  `,
};

// ─────────────────────────────────────────────────────────────────────────────

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

    /** Whether the TSL pipeline has been driven by the cyco-vp-tick event. */
    this._tickHandledByEvent = false;

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
    // threshold: 1.5 — only emissives / very-bright HDR pixels bloom; the sky sun
    //   (clamped to 4.5) and the gradient-sky disc (SDR ≤ 1.0) no longer cause a
    //   giant white halo at default settings.  Users can dial it down if desired.
    this._bloomParams = { enabled: true, strength: 0.6, radius: 0.3, threshold: 1.5 };

    // ── Chromatic Aberration ──────────────────────────────────────────────────
    /** @type {ShaderPass|null} */
    this.chromaPass        = null;
    this._chromaEnabled    = false;
    this._chromaStrength   = 0.002;

    // ── Vignette ─────────────────────────────────────────────────────────────
    /** @type {ShaderPass|null} */
    this.vignettePass       = null;
    this._vignetteEnabled   = false;
    this._vignetteOffset    = 1.0;
    this._vignetteDarkness  = 1.0;

    // ── Film Grain ───────────────────────────────────────────────────────────
    /** @type {ShaderPass|null} */
    this.filmGrainPass       = null;
    this._filmGrainEnabled   = false;
    this._filmGrainIntensity = 0.1;

    // ── God Rays ──────────────────────────────────────────────────────────────
    this.godRays         = new GodRays(viewportEngine);
    this._godRaysEnabled = false;
    this._godRaysParams  = { density: 0.96, weight: 0.60, decay: 0.92, exposure: 0.90, samples: 60 };

    /**
     * Live-update param store for TSL reference nodes (WebGPU post FX).
     * Reference nodes read from this object every frame, so setting a property
     * here is the only update needed — no uniform.needsUpdate required.
     * @type {{ chromaStrength: number, grainIntensity: number, vigOffset: number, vigDarkness: number }}
     */
    this._pp = {
      chromaStrength: 0.0,
      grainIntensity: 0.0,
      vigOffset:      1.0,
      vigDarkness:    0.0,
    };

    this._onVpReady           = this._onVpReady.bind(this);
    this._onRendererChanged   = this._onRendererChanged.bind(this);
    this._onTick              = this._onTick.bind(this);
    this._onResize            = this._onResize.bind(this);
    this._onSelectNode        = this._onSelectNode.bind(this);
    this._onDeselectAll       = this._onDeselectAll.bind(this);
    this._onHoverObject       = this._onHoverObject.bind(this);
    this._onPpSettings        = this._onPpSettings.bind(this);
    this._onPostFxChange      = this._onPostFxChange.bind(this);
    this._onSceneChildAdded    = this._onSceneChildAdded.bind(this);
    this._onVpTool             = this._onVpTool.bind(this);
    this._onEditorCameraChanged = this._onEditorCameraChanged.bind(this);

    window.addEventListener('cyco-vp-ready',                this._onVpReady);
    window.addEventListener('cyco-renderer-changed',        this._onRendererChanged);
    window.addEventListener('cyco-vp-tick',                 this._onTick);
    window.addEventListener('cyco-vp-resize',               this._onResize);
    window.addEventListener('cyco-select-node',             this._onSelectNode);
    window.addEventListener('cyco-deselect-all',            this._onDeselectAll);
    window.addEventListener('cyco-hover-object',            this._onHoverObject);
    window.addEventListener('cyco-pp-settings',             this._onPpSettings);
    window.addEventListener('cyco-postfx-change',           this._onPostFxChange);
    window.addEventListener('cyco-vp-tool',                 this._onVpTool);
    window.addEventListener('cyco-editor-camera-changed',   this._onEditorCameraChanged);

    // If the viewport was already initialized before this pipeline was
    // constructed, rebuild immediately so the composer is available.
    if (this.engine.rendererManager?.renderer && this.engine.scene && this.engine.camera) {
      requestAnimationFrame(() => this._onVpReady());
    }
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
    //    threshold=1.5 — prevents the sky sun disc from creating an oversaturated halo.
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.6, 0.3, 1.5);
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

    // 6. Chromatic Aberration — operates on the SDR/sRGB image after tone mapping.
    this.chromaPass = new ShaderPass(ChromaticAberrationShader);
    this.chromaPass.uniforms['enabled'].value  = this._chromaEnabled  ? 1.0 : 0.0;
    this.chromaPass.uniforms['strength'].value = this._chromaStrength;
    this._composer.addPass(this.chromaPass);

    // 7. Vignette
    this.vignettePass = new ShaderPass(VignetteShader);
    this.vignettePass.uniforms['enabled'].value  = this._vignetteEnabled  ? 1.0 : 0.0;
    this.vignettePass.uniforms['offset'].value   = this._vignetteOffset;
    this.vignettePass.uniforms['darkness'].value = this._vignetteDarkness;
    this._composer.addPass(this.vignettePass);

    // 8. Film Grain — time is updated every tick in _onTick().
    this.filmGrainPass = new ShaderPass(FilmGrainShader);
    this.filmGrainPass.uniforms['enabled'].value   = this._filmGrainEnabled  ? 1.0 : 0.0;
    this.filmGrainPass.uniforms['intensity'].value = this._filmGrainIntensity;
    this._composer.addPass(this.filmGrainPass);

    // 9. FXAA — must come AFTER OutputPass (operates on final LDR/sRGB image).
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

    // 8. God Rays — additive screen-space radial blur, rendered over the final LDR frame.
    this.godRays.build(renderer, w, h);
    this.godRays.setEnabled(this._godRaysEnabled);
    this.godRays.setParams(this._godRaysParams);
    this._composer.addPass(this.godRays.pass);

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
    this.chromaPass    = null;
    this.vignettePass  = null;
    this.filmGrainPass = null;
    this.godRays?.dispose();
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
    // Yield rendering control to the fallback direct-render path while the
    // async pipeline is rebuilding.  Without this, _pipelineActive stays true
    // but _tslPipelineActive is false, which produces blank frames.
    this.engine.setPipelineActive(false);
    try {
      const webgpuMod = await import('three/webgpu');
      const { RenderPipeline, TSL } = webgpuMod;
      const {
        pass, mrt, normalView, output,
        vec2, vec3, vec4, float,
        Fn, uv, smoothstep, reference,
        clamp, max, mix, convertToTexture,
      } = TSL;
      const [{ ao }, { bloom: bloomFn }, { chromaticAberration }, { film }] = await Promise.all([
        import('three/addons/tsl/display/GTAONode.js'),
        import('three/addons/tsl/display/BloomNode.js'),
        import('three/addons/tsl/display/ChromaticAberrationNode.js'),
        import('three/addons/tsl/display/FilmNode.js'),
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
        // AO disabled — render scene directly.
        // Keep PassNode as outputNode root so RenderPipeline traverses/renders the scene.
        // Separately expose the TextureNode so god rays can sample at arbitrary UVs.
        const scenePass    = pass(scene, camera);
        const sceneColorTex = scenePass.getTextureNode();
        this._tslNodes  = { sceneOnly: scenePass };
        sceneColorNode  = sceneColorTex;  // TextureNode — supports .uv() sampling
        // Force alpha=1 on the final scene output so transparent background
        // pixels do not render as fully transparent and leave the canvas blank.
        outputNode      = vec4(sceneColorTex.rgb, 1);
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

      // ── God Rays (WebGPU TSL screen-space radial blur) ───────────────────────────
      // Additive: accumulates scatter from bright pixels along rays toward sun.
      // exposure=0 when disabled — no pipeline rebuild needed on toggle.
      {
        if (!this._godRaysGPUParams) {
          this._godRaysGPUParams = {
            sunX:     0.5,
            sunY:     0.5,
            density:  this._godRaysParams.density  ?? 0.96,
            weight:   this._godRaysParams.weight   ?? 0.60,
            decay:    this._godRaysParams.decay    ?? 0.92,
            exposure: this._godRaysEnabled ? (this._godRaysParams.exposure ?? 0.90) : 0.0,
          };
        } else {
          // Preserve sun pos across rebuilds; sync enabled state
          this._godRaysGPUParams.exposure = this._godRaysEnabled
            ? (this._godRaysParams.exposure ?? 0.90) : 0.0;
        }
        const grp        = this._godRaysGPUParams;
        const grSunX     = reference('sunX',     'float', grp);
        const grSunY     = reference('sunY',     'float', grp);
        const grDensity  = reference('density',  'float', grp);
        const grWeight   = reference('weight',   'float', grp);
        const grExposure = reference('exposure', 'float', grp);

        // convertToTexture captures the full pipeline output (scene + bloom) into
        // a render target texture so the god rays Fn can sample at arbitrary UVs.
        // This is the same pattern as chromaticAberration(outputNode, ...) which
        // calls convertToTexture(node) internally — we just do it explicitly.
        const godRaysTex = convertToTexture(outputNode);

        // Radial blur god rays — 24 samples marching from pixel toward sun.
        // Only pixels brighter than 0.80 luminance contribute (sky background ≈ 0.5–0.7,
        // sun disc ≈ 0.95+). This avoids the diffuse sky haze drowning out directional rays.
        // godRaysTex is a CLOSURE (not a Fn arg), exactly like ChromaticAberrationNode
        // uses textureNode as a closure — that's the only pattern where .sample(UV) works.
        const GodRaysFn = Fn(([sunX, sunY, density, weight, exposure]) => {
          const texUV = uv();
          const sunUV = vec2(sunX, sunY);
          const N     = 24;
          const DECAY = 0.92;
          let   grAccum = float(0.0);

          for (let i = 1; i <= N; i++) {
            // Interpolate from current pixel toward sun: t=1/N…1, scaled by density
            const t   = float(i / N);
            const sUV = texUV.add(sunUV.sub(texUV).mul(t.mul(density)));
            const cUV = clamp(sUV, vec2(0.0, 0.0), vec2(1.0, 1.0));
            const col = godRaysTex.sample(cUV);   // closure w/ convertToTexture
            const lum = col.r.mul(0.2126).add(col.g.mul(0.7152)).add(col.b.mul(0.0722));
            // Threshold: 0.80 — only the bright sun disc contributes, not the sky haze
            grAccum   = grAccum.add(max(float(0.0), lum.sub(float(0.80))).mul(float(Math.pow(DECAY, i))));
          }

          return vec4(
            vec3(1.0, 0.92, 0.75).mul(grAccum.mul(weight).mul(exposure).div(float(N))),
            float(0.0),
          );
        });

        outputNode = outputNode.add(GodRaysFn(grSunX, grSunY, grDensity, grWeight, grExposure));
      }

      // ── Post FX: Chromatic Aberration, Film Grain, Vignette (WebGPU) ──────────
      // Use reference() nodes so live updates to this._pp propagate every frame
      // without any uniform.needsUpdate call or pipeline rebuild.
      {
        const pp = this._pp;
        pp.chromaStrength = this._chromaEnabled   ? (this._chromaStrength   ?? 0.002) : 0.0;
        pp.grainIntensity = this._filmGrainEnabled ? (this._filmGrainIntensity ?? 0.1)  : 0.0;
        pp.vigOffset      = this._vignetteOffset   ?? 1.0;
        pp.vigDarkness    = this._vignetteEnabled  ? (this._vignetteDarkness ?? 1.0)   : 0.0;

        const chromaRef = reference('chromaStrength', 'float', pp);
        const grainRef  = reference('grainIntensity',  'float', pp);
        const vigOffRef = reference('vigOffset',       'float', pp);
        const vigDrkRef = reference('vigDarkness',     'float', pp);

        // Chromatic Aberration (native TSL node)
        outputNode = chromaticAberration(outputNode, chromaRef, null, 1.1);

        // Film Grain (native TSL node — uses built-in `time` node, no manual tick needed)
        outputNode = film(outputNode, grainRef);

        // Vignette (custom TSL Fn — no official VignetteNode in Three.js r184)
        const VignetteFn = Fn(([texColor, vigOffset, vigDarkness]) => {
          const uvCoord  = uv();
          const dist     = uvCoord.sub(vec2(0.5, 0.5)).length();
          const vignette = smoothstep(float(0.8), vigOffset.mul(0.799), dist.mul(vigDarkness.add(vigOffset)));
          return vec4(texColor.rgb.mul(vignette), texColor.a);
        });
        outputNode = VignetteFn(outputNode, vigOffRef, vigDrkRef);
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

  /** Editor viewport camera was swapped (e.g. perspective ↔ orthographic).
   *  The TSL pass() node captures the camera by reference at build time, so
   *  a full pipeline rebuild is required to pick up the new camera type.
   */
  _onEditorCameraChanged() {
    const renderer = this.engine.rendererManager?.renderer;
    const type     = this.engine.rendererManager?.activeType ?? 'webgl';
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

  // ─── God Rays API ─────────────────────────────────────────────────────────────

  setGodRaysEnabled(v) {
    this._godRaysEnabled = !!v;
    this.godRays?.setEnabled(v);  // WebGL path
    // WebGPU path: toggle via exposure reference (no rebuild needed)
    if (this._godRaysGPUParams) {
      this._godRaysGPUParams.exposure = v ? (this._godRaysParams.exposure ?? 0.90) : 0.0;
    }
  }

  updateGodRaysParams(opts) {
    Object.assign(this._godRaysParams, opts);
    this.godRays?.setParams(opts);  // WebGL path
    // WebGPU path: sync live-update reference objects
    if (this._godRaysGPUParams) {
      if (opts.density  !== undefined) this._godRaysGPUParams.density  = opts.density;
      if (opts.weight   !== undefined) this._godRaysGPUParams.weight   = opts.weight;
      if (opts.decay    !== undefined) this._godRaysGPUParams.decay    = opts.decay;
      if (opts.exposure !== undefined && this._godRaysEnabled)
        this._godRaysGPUParams.exposure = opts.exposure;
    }
  }

  /** Update the sun screen-space UV for WebGPU god rays (called every frame). */
  updateGodRaysSunPos(x, y) {
    if (this._godRaysGPUParams) {
      this._godRaysGPUParams.sunX = x;
      this._godRaysGPUParams.sunY = y;
    }
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

  // ─── Tone Mapping API ─────────────────────────────────────────────────────────

  /**
   * Set the renderer tone mapping mode.
   * @param {'aces'|'agx'|'reinhard'|'cineon'|'linear'|'none'} mode
   */
  setToneMapping(mode) {
    const renderer = this.engine?.rendererManager?.renderer;
    if (!renderer) return;
    const map = {
      aces:     THREE.ACESFilmicToneMapping,
      agx:      THREE.AgXToneMapping,
      reinhard: THREE.ReinhardToneMapping,
      cineon:   THREE.CineonToneMapping,
      linear:   THREE.LinearToneMapping,
      none:     THREE.NoToneMapping,
    };
    renderer.toneMapping = map[mode] ?? THREE.ACESFilmicToneMapping;
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
    this._tickHandledByEvent = true;
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
    // Animate film grain — update time uniform so the noise pattern changes each frame.
    if (this.filmGrainPass) {
      this.filmGrainPass.uniforms['time'].value = performance.now();
    }

    // Update god rays occluder pass each frame (runs BEFORE composer.render)
    if (this._godRaysEnabled) {
      const ve      = this.engine;
      const skyObj  = ve?.gradientSky;
      const sunDir  = skyObj?._p?.sunDir;
      if (sunDir && ve.camera) this.godRays.update(ve.camera, sunDir);
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
    // God rays occluder render target is 1/4 resolution — resize separately.
    this.godRays?.resize(w, h);
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

  // ─── cyco-postfx-change handler ───────────────────────────────────────────

  /**
   * Handles the `cyco-postfx-change` event dispatched by EnvironmentProperties.
   * Updates both the WebGL ShaderPass uniforms and the WebGPU _pp reference-node
   * values. No pipeline rebuild is needed for any param change.
   */
  _onPostFxChange({ detail } = {}) {
    if (!detail) return;

    // ── Bloom ────────────────────────────────────────────────────────────────
    if (detail.bloom) {
      const b = detail.bloom;
      if (this.bloomPass) {
        if (b.enabled   !== undefined) this.bloomPass.enabled   = b.enabled;
        if (b.strength  !== undefined) this.bloomPass.strength  = b.strength;
        if (b.radius    !== undefined) this.bloomPass.radius    = b.radius;
        if (b.threshold !== undefined) this.bloomPass.threshold = b.threshold;
      }
      if (this._tslBloomNode) {
        if (b.enabled !== undefined) {
          this._bloomParams.enabled = b.enabled;
          this._tslBloomNode.strength.value = b.enabled
            ? (this._bloomParams.strength ?? 0.8)
            : 0;
        }
        if (b.strength  !== undefined && this._bloomParams.enabled !== false) {
          this._bloomParams.strength = b.strength;
          this._tslBloomNode.strength.value = b.strength;
        }
        if (b.radius    !== undefined) { this._bloomParams.radius    = b.radius;    this._tslBloomNode.radius.value    = b.radius; }
        if (b.threshold !== undefined) { this._bloomParams.threshold = b.threshold; this._tslBloomNode.threshold.value = b.threshold; }
      }
    }

    // ── Chromatic Aberration ─────────────────────────────────────────────────
    if (detail.chroma) {
      const c = detail.chroma;
      if (c.enabled  !== undefined) {
        this._chromaEnabled = c.enabled;
        if (this.chromaPass) this.chromaPass.uniforms['enabled'].value = c.enabled ? 1.0 : 0.0;
        // WebGPU: set to 0 to passthrough without rebuild
        this._pp.chromaStrength = c.enabled ? (this._chromaStrength ?? 0.002) : 0.0;
      }
      if (c.strength !== undefined) {
        this._chromaStrength = c.strength;
        if (this.chromaPass) this.chromaPass.uniforms['strength'].value = c.strength;
        if (this._chromaEnabled) this._pp.chromaStrength = c.strength;
      }
    }

    // ── Vignette ─────────────────────────────────────────────────────────────
    if (detail.vignette) {
      const v = detail.vignette;
      if (v.enabled  !== undefined) {
        this._vignetteEnabled = v.enabled;
        if (this.vignettePass) this.vignettePass.uniforms['enabled'].value = v.enabled ? 1.0 : 0.0;
        this._pp.vigDarkness = v.enabled ? (this._vignetteDarkness ?? 1.0) : 0.0;
      }
      if (v.offset   !== undefined) {
        this._vignetteOffset = v.offset;
        if (this.vignettePass) this.vignettePass.uniforms['offset'].value = v.offset;
        this._pp.vigOffset = v.offset;
      }
      if (v.darkness !== undefined) {
        this._vignetteDarkness = v.darkness;
        if (this.vignettePass) this.vignettePass.uniforms['darkness'].value = v.darkness;
        if (this._vignetteEnabled) this._pp.vigDarkness = v.darkness;
      }
    }

    // ── Film Grain ───────────────────────────────────────────────────────────
    if (detail.grain) {
      const g = detail.grain;
      if (g.enabled   !== undefined) {
        this._filmGrainEnabled = g.enabled;
        if (this.filmGrainPass) this.filmGrainPass.uniforms['enabled'].value = g.enabled ? 1.0 : 0.0;
        this._pp.grainIntensity = g.enabled ? (this._filmGrainIntensity ?? 0.1) : 0.0;
      }
      if (g.intensity !== undefined) {
        this._filmGrainIntensity = g.intensity;
        if (this.filmGrainPass) this.filmGrainPass.uniforms['intensity'].value = g.intensity;
        if (this._filmGrainEnabled) this._pp.grainIntensity = g.intensity;
      }
    }

    // ── Tone Mapping ─────────────────────────────────────────────────────────
    if (detail.toneMapping) {
      this.setToneMapping(detail.toneMapping);
    }

    // ── LUT ──────────────────────────────────────────────────────────────────
    if (detail.lut) {
      const l = detail.lut;
      if (l.enabled   !== undefined) this.setLutEnabled(l.enabled);
      if (l.intensity !== undefined) this.setLutIntensity(l.intensity);
      if (l.file)                    this.loadLutFromFile(l.file);
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
    window.removeEventListener('cyco-postfx-change',     this._onPostFxChange);
    window.removeEventListener('cyco-vp-tool',                 this._onVpTool);
    window.removeEventListener('cyco-editor-camera-changed',   this._onEditorCameraChanged);
  }
}

