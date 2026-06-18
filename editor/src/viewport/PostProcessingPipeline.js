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
import { loadPrefs }       from '../ui/PreferencesWindow.js';

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

    /**
     * Secondary selection outlines — drawn as scene-graph LineSegments meshes
     * (NOT through the composer). Each non-primary selected object gets a
     * colored wireframe added as its child; we update the set on selection
     * changes and sync transforms every frame.
     *
     * Why not a second `OutlinePass`?  In practice, two OutlinePass instances
     * chained through the EffectComposer do NOT render correctly together
     * because three.js's OutlinePass does not call `renderer.setViewport()`
     * when it switches between its mask / downsample / blur render targets.
     * The second pass inherits the first pass's last-used viewport (typically
     * 1/4 size), causing its mask render to be clipped into a sub-rectangle
     * of the target — outlines only appear in the top-left quadrant of the
     * scene. Drawing secondary outlines as scene-graph geometry avoids this
     * entirely and is also much cheaper (no per-frame composer passes).
     *
     * These work identically under both the WebGL EffectComposer and the
     * WebGPU TSL `pass(scene, camera)` pipelines because they live in the
     * scene tree and are rendered by the active renderer's normal scene pass.
     *
     * @type {THREE.Group|null}
     */
    this.secondaryOutlineGroup = null;

    /**
     * Primary selection outline group — drawn as scene-graph LineSegments.
     * Holds the wireframe for the LAST selected object (the primary). This
     * is used:
     *   - In WebGPU mode, where no `OutlinePass` is available at all.
     *   - In WebGL mode, as a fallback when the OutlinePass is disabled
     *     (e.g. in physics-edit mode for collider objects).
     * In WebGL mode the OutlinePass also renders the primary outline (with
     * edge-detection blur), which looks smoother than the 1-pixel LineSegments
     * drawn here — so we leave the WebGL OutlinePass alone and let this
     * group ONLY be used when the OutlinePass is absent.
     *
     * @type {THREE.Group|null}
     */
    this.primaryOutlineGroup = null;

    /** @type {OutlinePass|null} — hover highlight (white outline, thinner) */
    this.hoverOutlinePass = null;

    this._selectedObjects = [];
    this._physicsEditMode = false;
    this._prefs = loadPrefs();

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
    this._onSceneSwitch        = this._onSceneSwitch.bind(this);
    this._onVpTool             = this._onVpTool.bind(this);
    this._onEditorCameraChanged = this._onEditorCameraChanged.bind(this);
    this._onPrefsChanged       = this._onPrefsChanged.bind(this);
    this._onPhysicsEditMode    = this._onPhysicsEditMode.bind(this);

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
    window.addEventListener('cyco-preferences-change',      this._onPrefsChanged);
    window.addEventListener('cyco-preferences-preview',     this._onPrefsChanged);
    window.addEventListener('cyco-physics-edit-mode',       this._onPhysicsEditMode);
    window.addEventListener('cyco-scene-switch',            this._onSceneSwitch);

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
    this._applySelectionOutlinePrefs();
    this.outlinePass.selectedObjects = this._selectedObjects;
    this._composer.addPass(this.outlinePass);

    // 3a. Secondary selection outlines — drawn as scene-graph LineSegments
    //     inside `secondaryOutlineGroup` (added to the scene root). See the
    //     field doc on `secondaryOutlineGroup` for why we don't use a second
    //     OutlinePass. We create the group lazily in `_ensureSecondaryGroup`.
    this._ensureSecondaryGroup(scene);

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
    if (this.bloomPass)              this.bloomPass.enabled              = !isDebug;
    if (this.outlinePass)            this.outlinePass.enabled            = !isDebug;
    if (this.secondaryOutlineGroup)  this.secondaryOutlineGroup.visible = !isDebug;
    if (this.hoverOutlinePass)       this.hoverOutlinePass.enabled       = !isDebug;
  }

  _disposeWebGLPipeline() {
    if (!this._composer) return;
    this._composer.passes.forEach(pass => pass.dispose?.());
    this._composer.dispose?.();
    this._composer             = null;
    this.outlinePass           = null;
    this._disposeSecondaryGroup();
    this._disposePrimaryOutlineGroup();
    this.bloomPass             = null;
    this.fxaaPass              = null;
    this.smaaPass              = null;
    this.lutPass               = null;
    this.aoPass                = null;
    this.chromaPass            = null;
    this.vignettePass          = null;
    this.filmGrainPass         = null;
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
    // Drop both outline groups too — the WebGPU pipeline is being torn
    // down; `_buildWebGPUPipeline` will recreate them on the new scene.
    this._disposeSecondaryGroup();
    this._disposePrimaryOutlineGroup();
    this.engine.setPipelineActive(false);
  }

  async _buildWebGPUPipeline(renderer, scene, camera) {
    this._tslPipelineActive = false;
    this._tslBloomNode = null;
    // Yield rendering control to the fallback direct-render path while the
    // async pipeline is rebuilding.  Without this, _pipelineActive stays true
    // but _tslPipelineActive is false, which produces blank frames.
    this.engine.setPipelineActive(false);
    // The secondary outline group is a scene-graph Group (not a composer
    // pass) so it works identically under both WebGL EffectComposer and
    // WebGPU TSL pipelines. Make sure it exists and is attached to the
    // current scene.
    this._ensureSecondaryGroup(scene);
    // In WebGPU mode there's no OutlinePass, so we also draw the primary
    // outline as scene-graph LineSegments. In WebGL mode the OutlinePass
    // renders the primary outline with edge-detection blur which looks
    // better — so the primary scene-graph group is created but stays empty
    // unless `outlinePass` is null.
    this._ensurePrimaryOutlineGroup(scene);
    // Also rebuild any pending selection outlines — the group was just
    // (re)created so its child LineSegments list is empty.
    this._refreshSecondaryOutlines();
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

      // WebGPU TSL pipeline currently produces blank frames for scene
      // backgrounds and sky/HDR modes in this environment. Fall back to
      // direct renderer.render() until the native pipeline issue is fixed.
      this._tslPipelineActive = false;
      this.engine.setPipelineActive(false);

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
   * Scene switch — re-attach the secondary-outline Group to the new active
   * scene, otherwise the Group stays parented to the old scene and the
   * outlines won't render.
   */
  _onSceneSwitch(_event) {
    if (this.secondaryOutlineGroup) {
      // Drop any cached outlines — the source objects live in the old scene.
      this._clearSecondaryOutlines();
      // Detach so `_ensureSecondaryGroup` will re-add to the current scene.
      if (this.secondaryOutlineGroup.parent) {
        this.secondaryOutlineGroup.parent.remove(this.secondaryOutlineGroup);
      }
    }
    if (this.primaryOutlineGroup) {
      this._clearPrimaryOutline();
      if (this.primaryOutlineGroup.parent) {
        this.primaryOutlineGroup.parent.remove(this.primaryOutlineGroup);
      }
    }
    const scene = this.engine.scene;
    if (scene) {
      this._ensureSecondaryGroup(scene);
      this._ensurePrimaryOutlineGroup(scene);
    }
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

    // Sync secondary-outline LineSegments transforms to their source objects.
    // These are scene-graph meshes so they need matrix updates each frame to
    // track moves/rotates/scales of the selected objects. Runs under BOTH
    // WebGL and WebGPU pipelines — the group lives in the scene and is
    // rendered by whichever renderer the engine is using.
    this._updateSecondaryOutlinesTransforms();

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

  _getSelectionObjects(detail = {}) {
    if (Array.isArray(detail.objects)) return detail.objects.filter(Boolean);
    if (detail.object) return [detail.object];
    return [];
  }

  _hasPhysicsCollider(object) {
    const comps = object?.userData?.physics?.components;
    return Array.isArray(comps) && comps.some((comp) => {
      const type = String(comp?.type || '');
      return type.includes('Collider');
    });
  }

  _applySelectionOutlinePrefs() {
    const bounds = this._prefs?.gizmo?.bounds ?? loadPrefs().gizmo.bounds;
    // thickness slider is a 0.05–4 visual-weight value; we map it to a
    // 0.001–0.10 inverted-hull relative scale (WebGPU / scene-graph
    // outline) AND forward it to the WebGL OutlinePass.edgeThickness.
    const thickness = Math.max(0.05, bounds.thickness ?? 1);
    const glowIntensity = Math.max(0, bounds.singleGlowIntensity ?? bounds.glowIntensity ?? 0.35);
    const selectedObject = this._selectedObjects[this._selectedObjects.length - 1] ?? null;
    const showSelectionOutline = !this._physicsEditMode || !this._hasPhysicsCollider(selectedObject);
    // Remember the color + shell thickness so the scene-graph primary
    // outline (used in WebGPU mode and in WebGL fallback) can use the
    // same hue and weight as the WebGL OutlinePass.
    this._primaryOutlineColor = new THREE.Color(bounds.outlineColor ?? '#e8eeff');
    // Glow color drives the secondary halo mesh behind the outline.  This
    // is the SAME field that TransformGizmo reads for the box-tool glow;
    // the user expects the Outline Glow Color to affect the outline glow.
    this._primaryGlowColor = new THREE.Color(bounds.glowColor ?? '#9b6cff');
    // 0.025 × thickness → 0.001–0.10 relative scale.  Keeps the default
    // (thickness=1) at ~2.5% shell — visibly thick, not screen-filling —
    // and lets the slider reach a chunky 10% shell at its high end.
    // Glow intensity adds a small shell-thickness bonus so "more glow"
    // feels visually heavier even on the scene-graph inverted hull.
    this._primaryShellThickness = Math.max(0.001, thickness * 0.025 + glowIntensity * 0.008);
    // Map glow intensity to opacity in [0.5..1.0].  Higher glow = more
    // saturated outline shell.
    this._primaryShellOpacity = Math.min(1.0, 0.5 + glowIntensity * 0.25);
    // Glow amount drives the halo mesh's additive opacity (0..1).  This
    // is what the user sees as the outline "glow" — a soft colored halo
    // wrapping the silhouette.  At glowIntensity=0 the halo is invisible;
    // at glowIntensity=4 it's near-saturated.
    this._primaryGlowAmount = Math.min(1.0, glowIntensity * 0.28);
    if (this.outlinePass) {
      this.outlinePass.enabled = showSelectionOutline;
      this.outlinePass.edgeStrength = Math.max(1.5, 2.4 + glowIntensity * 2.2);
      this.outlinePass.edgeGlow = Math.min(2.5, glowIntensity * 0.75);
      this.outlinePass.edgeThickness = thickness;
      // visibleEdgeColor = the "outline" color (what the user sees as the
      // outline itself); hiddenEdgeColor = the "glow" tint three.js uses
      // for the parts of the silhouette hidden behind the source mesh.
      // Together they form the OutlinePass's own visual glow.
      this.outlinePass.visibleEdgeColor.set(bounds.outlineColor ?? '#e8eeff');
      this.outlinePass.hiddenEdgeColor.set(this._primaryGlowColor);
    }
  }

  /**
   * Apply prefs to the secondary (multi-select) outline. Like the primary
   * outline in WebGPU mode, the secondary is rendered as scene-graph
   * geometry, so applying prefs just means caching the latest colour and
   * shell thickness for the next `_refreshSecondaryOutlines()` call. No
   * composer pass is required.
   *
   * The secondary color defaults to vivid orange (#ff6a3d) so it stands
   * out from the primary's near-white outline.
   */
  _applySecondaryOutlinePrefs() {
    const bounds = this._prefs?.gizmo?.bounds ?? loadPrefs().gizmo.bounds;
    this._secondaryColor = new THREE.Color(bounds.secondaryOutlineColor ?? '#ff6a3d');
    // Independent glow color for the multi-select outline.  We read from
    // `multiGlowColor` (the dedicated multi-select swatch) first so the
    // user can tint the multi-select glow independently from the primary.
    this._secondaryGlowColor = new THREE.Color(bounds.multiGlowColor ?? bounds.glowColor ?? '#ff7a3d');
    // multiThickness is a per-mode slider (defaults to the shared
    // `thickness` so older prefs files keep working).  Slider max is now
    // 8 (raised from 4) and the per-unit mapping is steeper (0.04×) so
    // multi-select outlines feel chunky even at moderate slider values.
    const multiThickness = Math.max(0.05, bounds.multiThickness ?? bounds.thickness ?? 1);
    // multiGlowIntensity drives both the scene-graph shell thickness
    // (small bonus) and the shell opacity so the slider has a visible
    // effect under WebGPU / fallback modes.  Slider max is 4 (raised
    // from 2) so glow can push the shell to a strong 1.0 opacity.
    const multiGlow = Math.max(0, bounds.multiGlowIntensity ?? bounds.glowIntensity ?? 0.35);
    this._secondaryShellThickness = Math.max(0.001, multiThickness * 0.04 + multiGlow * 0.012);
    this._secondaryShellOpacity   = Math.min(1.0, 0.5 + multiGlow * 0.18);
    // Halo opacity for the multi-select glow.  With multiGlowIntensity up
    // to 4 the halo can reach 1.0 (fully saturated additive halo).
    this._secondaryGlowAmount = Math.min(1.0, multiGlow * 0.28);
  }

  /**
   * Ensure the secondary-outline Group exists and is added to the given scene.
   * Idempotent. The Group lives as a child of the active scene, so its lines
   * participate in normal rendering (no composer pass needed). Tagged so the
   * non-selectable filter in SelectionManager skips it.
   * @param {THREE.Scene} scene
   */
  _ensureSecondaryGroup(scene) {
    if (this.secondaryOutlineGroup && this.secondaryOutlineGroup.parent === scene) return;
    if (!this.secondaryOutlineGroup) {
      this.secondaryOutlineGroup = new THREE.Group();
      this.secondaryOutlineGroup.name = '__cyco_secondary_outlines';
      this.secondaryOutlineGroup.userData._isHelper = true;
      this.secondaryOutlineGroup.userData._editorOnly = true;
      this.secondaryOutlineGroup.userData.cycoId = '__cyco_secondary_outlines';
      // Persist a single empty buffer geometry we reuse as the pool. Each
      // child gets its own LineSegments with its own geometry built from
      // the source object's EdgesGeometry.
      this.secondaryOutlineGroup.frustumCulled = false;
      this.secondaryOutlineGroup.renderOrder = 999;
    }
    if (this.secondaryOutlineGroup.parent && this.secondaryOutlineGroup.parent !== scene) {
      this.secondaryOutlineGroup.parent.remove(this.secondaryOutlineGroup);
    }
    if (scene && !this.secondaryOutlineGroup.parent) scene.add(this.secondaryOutlineGroup);
  }

  _disposeSecondaryGroup() {
    if (!this.secondaryOutlineGroup) return;
    this._clearSecondaryOutlines();
    if (this.secondaryOutlineGroup.parent) this.secondaryOutlineGroup.parent.remove(this.secondaryOutlineGroup);
    this.secondaryOutlineGroup = null;
  }

  /**
   * Remove all secondary-outline LineSegments from the group. Called when
   * the selection changes or the pipeline is rebuilt.
   */
  _clearSecondaryOutlines() {
    const g = this.secondaryOutlineGroup;
    if (!g) return;
    for (let i = g.children.length - 1; i >= 0; i--) {
      const child = g.children[i];
      g.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    }
  }

  /**
   * Ensure the primary-outline Group exists and is attached to the scene.
   * Used only in WebGPU mode (and as a fallback when OutlinePass is disabled
   * in WebGL mode) — in WebGL mode the regular OutlinePass renders the
   * primary outline with edge-detection blur which looks better.
   * @param {THREE.Scene} scene
   */
  _ensurePrimaryOutlineGroup(scene) {
    if (this.primaryOutlineGroup && this.primaryOutlineGroup.parent === scene) return;
    if (!this.primaryOutlineGroup) {
      this.primaryOutlineGroup = new THREE.Group();
      this.primaryOutlineGroup.name = '__cyco_primary_outlines';
      this.primaryOutlineGroup.userData._isHelper = true;
      this.primaryOutlineGroup.userData._editorOnly = true;
      this.primaryOutlineGroup.userData.cycoId = '__cyco_primary_outlines';
      this.primaryOutlineGroup.frustumCulled = false;
      this.primaryOutlineGroup.renderOrder = 1000; // above secondary outlines
    }
    if (this.primaryOutlineGroup.parent && this.primaryOutlineGroup.parent !== scene) {
      this.primaryOutlineGroup.parent.remove(this.primaryOutlineGroup);
    }
    if (scene && !this.primaryOutlineGroup.parent) scene.add(this.primaryOutlineGroup);
  }

  _disposePrimaryOutlineGroup() {
    if (!this.primaryOutlineGroup) return;
    this._clearPrimaryOutline();
    if (this.primaryOutlineGroup.parent) this.primaryOutlineGroup.parent.remove(this.primaryOutlineGroup);
    this.primaryOutlineGroup = null;
  }

  _clearPrimaryOutline() {
    const g = this.primaryOutlineGroup;
    if (!g) return;
    for (let i = g.children.length - 1; i >= 0; i--) {
      const child = g.children[i];
      g.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    }
  }

  /** True when the active renderer is WebGPU (no OutlinePass available). */
  _isWebGPURenderer() {
    return this.engine?.rendererManager?.activeType === 'webgpu';
  }

  /**
   * Rebuild the secondary-outline LineSegments meshes from the current
   * `_selectedObjects` (everything EXCEPT the primary — the last element).
   * Each LineSegments is parented to the secondary-outline Group, so it
   * inherits the scene's render path automatically.
   *
   * Also refreshes the primary-outline group when no OutlinePass is
   * available (WebGPU mode, or when the OutlinePass is disabled for
   * colliders in physics edit mode).
   */
  _refreshSecondaryOutlines() {
    const scene = this.engine?.scene;
    // Make sure both groups are attached to the current active scene.
    if (scene) {
      if (!this.secondaryOutlineGroup) this._ensureSecondaryGroup(scene);
      else if (this.secondaryOutlineGroup.parent !== scene) this._ensureSecondaryGroup(scene);
      if (!this.primaryOutlineGroup) this._ensurePrimaryOutlineGroup(scene);
      else if (this.primaryOutlineGroup.parent !== scene) this._ensurePrimaryOutlineGroup(scene);
    }
    this._clearSecondaryOutlines();
    this._clearPrimaryOutline();
    if (!this.secondaryOutlineGroup || !this.primaryOutlineGroup) return;
    // ── Mode isolation ───────────────────────────────────────────────────────
    // Single-select prefs (color, thickness, glow) apply ONLY to the
    // single-most-recently-selected object — call it the "primary".
    // Multi-select prefs apply ONLY to the OTHER selected objects (if any).
    //
    // When only one object is selected there are no "other" objects, so
    // multi-select prefs have nothing to act on.  When ≥2 are selected,
    // the LAST object in the array is the primary (single-select prefs)
    // and everything before it uses multi-select prefs.
    const secondaryColor      = this._secondaryColor ?? new THREE.Color('#ff6a3d');
    const secondaryGlowColor  = this._secondaryGlowColor ?? secondaryColor;
    const secondaryShell      = this._secondaryShellThickness ?? 0.03;
    const secondaryOpacity    = this._secondaryShellOpacity ?? 0.95;
    const secondaryGlowAmt    = this._secondaryGlowAmount ?? 0.4;
    const primaryColor      = this._primaryOutlineColor ?? new THREE.Color('#e8eeff');
    const primaryGlowColor  = this._primaryGlowColor ?? primaryColor;
    const primaryShell      = this._primaryShellThickness ?? 0.03;
    const primaryOpacity    = this._primaryShellOpacity ?? 0.95;
    const primaryGlowAmt    = this._primaryGlowAmount ?? 0.4;
    const all = this._selectedObjects;
    if (all.length === 0) {
      // No selection — nothing to outline. Both groups stay empty.
      return;
    }
    const primary = all[all.length - 1];
    const isMulti = all.length > 1;
    // Hide outlines while in physics edit mode for collider objects.
    const hideForPhysics = this._physicsEditMode && this._hasPhysicsCollider(primary);
    this.secondaryOutlineGroup.visible = !hideForPhysics && isMulti;
    this.primaryOutlineGroup.visible   = !hideForPhysics;
    if (hideForPhysics) return;
    // ── Primary outline (single-select prefs only) ───────────────────────────
    // The primary outline ONLY uses single-select prefs, regardless of
    // whether other objects are also selected.
    if (!this.outlinePass && primary) {
      const lines = this._buildSecondaryOutlineFor(primary, primaryColor, primaryShell, primaryOpacity, primaryGlowColor, primaryGlowAmt);
      if (lines) {
        lines.userData.cycoSourceId = primary.userData?.cycoId;
        lines.renderOrder = 1000; // ensure on top
        this.primaryOutlineGroup.add(lines);
      }
    }
    // ── Secondary outline (multi-select prefs only — never applied to a
    //    single-select object) ──────────────────────────────────────────────
    if (!isMulti) return;
    const secondary = all.slice(0, -1);
    for (const obj of secondary) {
      const lines = this._buildSecondaryOutlineFor(obj, secondaryColor, secondaryShell, secondaryOpacity, secondaryGlowColor, secondaryGlowAmt);
      if (lines) this.secondaryOutlineGroup.add(lines);
    }
  }

  /**
   * Build a two-layer inverted-hull outline group for `obj`.
   *
   * The outline is rendered as a `THREE.Group` containing two `Mesh`es,
   * both with `MeshBasicMaterial` in `side: THREE.BackSide` mode:
   *
   *   1. **Glow halo** — a slightly larger shell rendered with additive
   *      blending and the user's `glowColor`.  This is what the user
   *      sees as the "outline glow" — a soft colored halo wrapping the
   *      silhouette.  Driven by `glowAmount` (0..1).
   *
   *   2. **Core outline** — the visible outline shell in the user's
   *      `outlineColor`.  Larger than the source by `shellThickness` so
   *      the source mesh occludes the interior of the shell via depth
   *      test, leaving only the silhouette ring visible.
   *
   * The previous wireframe approach collapsed to 1-pixel hardware-line
   * width on every WebGL/WebGPU driver.  The inverted-hull technique
   * renders actual triangles whose silhouette width is proportional to
   * the source size, so the outline stays clearly visible regardless of
   * camera distance or background.
   *
   * Works identically in WebGL and WebGPU because it is plain scene
   * geometry rendered by the active renderer — no composer pass, no
   * custom shader, no addon dependency.
   *
   * For non-meshes (lights / cameras / groups), a BoxGeometry sized to
   * the object's world-space AABB is used as a fallback.
   *
   * @param {THREE.Object3D} obj
   * @param {THREE.Color} color
   * @param {number} shellThickness - relative scale for the core outline
   *        shell (e.g. 0.03 → 3% larger than the source).  Defaults to
   *        0.03 when omitted.
   * @param {number} opacity - core outline opacity 0..1, default 0.95.
   * @param {THREE.Color} [glowColor] - halo color.  When omitted or when
   *        `glowAmount` is 0, no halo mesh is created (zero overhead).
   * @param {number} [glowAmount=0] - halo additive opacity 0..1.  Drives
   *        how strongly the glow color tints the silhouette.
   * @returns {THREE.Group|null}
   */
  _buildSecondaryOutlineFor(obj, color, shellThickness = 0.03, opacity = 0.95, glowColor = null, glowAmount = 0) {
    if (!obj) return null;
    let geometry = null;
    if (obj.isMesh || obj.isInstancedMesh || obj.isSkinnedMesh) {
      try {
        geometry = obj.geometry.clone();
        // Push outward by the shell-thickness factor in local geometry
        // space.  Combined with the source's world transform (re-applied
        // every frame in `_updateOutlineGroupTransforms`), this yields a
        // uniform world-space outline shell.
        const s = 1 + Math.max(0, shellThickness);
        geometry.scale(s, s, s);
      } catch (e) {
        geometry = null;
      }
    }
    if (!geometry) {
      // Fall back to an axis-aligned bounding-box wireframe so groups / lights
      // / cameras still get a visible secondary outline.
      const box = new THREE.Box3().setFromObject(obj);
      if (!isFinite(box.min.x) || box.isEmpty()) return null;
      const size = new THREE.Vector3();
      box.getSize(size);
      const center = new THREE.Vector3();
      box.getCenter(center);
      if (size.lengthSq() < 1e-6) return null;
      // Match the inverted-hull pattern: scale the fallback AABB by the
      // same shell factor so the outline silhouette sits just outside the
      // source.
      const s = 1 + Math.max(0, shellThickness);
      geometry = new THREE.BoxGeometry(size.x * s, size.y * s, size.z * s);
      geometry.translate(-center.x, -center.y, -center.z);
    }
    // Build the core outline shell first.  We render the BackSide of the
    // enlarged geometry in the outline colour; the source mesh occludes
    // the interior of the shell via depth test, so only the silhouette
    // ring remains visible.
    //
    // polygonOffset pulls the shell toward the camera by a sub-pixel
    // amount to prevent Z-fighting at the silhouette edge on low-precision
    // depth buffers.
    const coreMaterial = new THREE.MeshBasicMaterial({
      color,
      side: THREE.BackSide,
      transparent: true,
      opacity,
      depthTest: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const core = new THREE.Mesh(geometry, coreMaterial);
    core.userData._isHelper = true;
    core.userData._editorOnly = true;
    core.userData.cycoSourceId = obj.userData?.cycoId;
    core.renderOrder = 1000;
    core.frustumCulled = false;

    // Build the glow halo group.  We skip creating this mesh entirely
    // when the user has the glow intensity at zero — saves a draw call
    // and avoids any halo bleed-through on objects that don't want one.
    const group = new THREE.Group();
    group.name = '__cyco_outline_group';
    group.userData._isHelper = true;
    group.userData._editorOnly = true;
    group.userData.cycoSourceId = obj.userData?.cycoId;
    group.frustumCulled = false;
    group.add(core);

    if (glowColor && glowAmount > 0.001) {
      // The halo geometry is a clone of the source scaled 50% wider than
      // the core shell so the halo extends visibly beyond the core.  We
      // use additive blending so it brightens whatever's behind it
      // (matching the visual semantics of a "glow"), and we render it
      // BEHIND the core outline (lower renderOrder + depthTest still
      // enabled so it gets occluded correctly by other scene geometry).
      const haloGeom = geometry.clone();
      const haloScale = 1 + Math.max(0, shellThickness) * 1.6; // 1.6× the core shell
      haloGeom.scale(haloScale, haloScale, haloScale);
      const haloMaterial = new THREE.MeshBasicMaterial({
        color: glowColor,
        side: THREE.BackSide,
        transparent: true,
        opacity: glowAmount,
        depthTest: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      });
      const halo = new THREE.Mesh(haloGeom, haloMaterial);
      halo.userData._isHalo = true;
      halo.userData._isHelper = true;
      halo.userData._editorOnly = true;
      halo.userData.cycoSourceId = obj.userData?.cycoId;
      halo.renderOrder = 999; // behind the core
      halo.frustumCulled = false;
      group.add(halo);
      group.userData.cycoHalo = halo;
    }

    return group;
  }

  /**
   * Update both primary and secondary outline meshes' transforms to match
   * their source objects every frame. Called from `_onTick` so outlines
   * follow transforms in real time without rebuilding geometry.
   */
  _updateSecondaryOutlinesTransforms() {
    this._updateOutlineGroupTransforms(this.secondaryOutlineGroup);
    this._updateOutlineGroupTransforms(this.primaryOutlineGroup);
  }

  _updateOutlineGroupTransforms(g) {
    if (!g || !g.visible) return;
    // Each child LineSegments has userData.cycoSourceId; look up the source
    // object by id from the current scene. This works even if the scene was
    // rebuilt.
    for (let i = 0; i < g.children.length; i++) {
      const lines = g.children[i];
      const sourceId = lines.userData?.cycoSourceId;
      if (!sourceId) continue;
      const source = this._findObjectByCycoId(sourceId);
      if (!source) {
        // Source object gone — drop the outline.
        g.remove(lines);
        if (lines.geometry) lines.geometry.dispose();
        if (lines.material) lines.material.dispose();
        i--;
        continue;
      }
      // Lines are children of the outline group (which is in the active
      // scene). Make their world transform match the source object. We
      // attach as a child of the source so it follows parent changes too,
      // but we need it to live under the outline group so it gets cleaned
      // up on selection change. So we re-parent only if needed.
      if (lines.parent !== g) {
        g.add(lines);
      }
      lines.position.copy(source.position);
      lines.rotation.copy(source.rotation);
      lines.scale.copy(source.scale);
      // Account for parent's world matrix if the source is not at the root.
      if (source.parent && source.parent.matrixWorld) {
        source.parent.updateMatrixWorld(true);
        const localFromParent = new THREE.Matrix4().copy(source.parent.matrixWorld).invert();
        lines.matrix.identity();
        lines.applyMatrix4(source.matrixWorld);
        lines.applyMatrix4(localFromParent);
      } else {
        lines.matrix.identity();
        lines.applyMatrix4(source.matrixWorld);
      }
      lines.matrixAutoUpdate = false;
    }
  }

  /** Look up an object in the active scene by its `userData.cycoId`. */
  _findObjectByCycoId(id) {
    if (!id) return null;
    const scene = this.engine.scene;
    if (!scene) return null;
    let found = null;
    scene.traverse(o => {
      if (!found && o.userData?.cycoId === id) found = o;
    });
    return found;
  }

  /**
   * (Legacy / unused — kept as a no-op so external code that calls it
   * doesn't crash. See `_refreshSecondaryOutlines` for the real work.)
   * @deprecated
   */
  _wrapOutlinePassForViewportReset(_outlinePass) { /* no-op */ }

  _onPrefsChanged(event) {
    this._prefs = event.detail?.prefs ?? loadPrefs();
    this._applySelectionOutlinePrefs();
    this._applySecondaryOutlinePrefs();
    // Rebuild the secondary outlines so any color/glow change is reflected.
    this._refreshSecondaryOutlines();
  }

  _onSelectNode(event) {
    this._selectedObjects = this._getSelectionObjects(event.detail);
    if (this.outlinePass) {
      this._applySelectionOutlinePrefs();
      // Only the primary (most-recently-selected) object is outlined by the
      // WebGL OutlinePass; the secondary group handles the rest so multi-
      // select uses distinct colors.
      const primary = this._selectedObjects[this._selectedObjects.length - 1];
      this.outlinePass.selectedObjects = primary ? [primary] : [];
    }
    // Refresh the scene-graph secondary outlines (the non-primary selected
    // objects each get a colored wireframe child).
    this._refreshSecondaryOutlines();
    // When selection changes with the TSL pipeline active, newly-visible gizmo
    // handles (TransformControls) may not have compiled shaders yet.  Schedule
    // a deferred compile so they appear on the very next frame.
    if (this._tslPipelineActive) this._scheduleTslCompile();
  }

  _onDeselectAll() {
    this._selectedObjects = [];
    if (this.outlinePass) this.outlinePass.selectedObjects = [];
    this._refreshSecondaryOutlines();
  }

  _onVpTool() {
    // Tool mode changed (e.g. select → translate).  TransformControls may now
    // show handles that weren't visible during the last compile run, so trigger
    // a recompile to make them visible on the first frame.
    if (this._tslPipelineActive) this._scheduleTslCompile();
  }

  _onHoverObject(event) {
    if (!this.hoverOutlinePass) return;
    if (this._physicsEditMode || this.engine.selectionManager?._gizmoDragging) {
      this.hoverOutlinePass.selectedObjects = [];
      return;
    }
    const { object } = event.detail ?? {};
    this.hoverOutlinePass.selectedObjects = object ? [object] : [];
  }

  _onPhysicsEditMode(event) {
    this._physicsEditMode = !!event.detail?.enabled;
    if (this.outlinePass) {
      this._applySelectionOutlinePrefs();
      this.outlinePass.selectedObjects = this._selectedObjects;
    }
    this._refreshSecondaryOutlines();
    if (this.hoverOutlinePass && this._physicsEditMode) {
      this.hoverOutlinePass.selectedObjects = [];
    }
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
    this._disposeSecondaryGroup();
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
    window.removeEventListener('cyco-physics-edit-mode',       this._onPhysicsEditMode);
    window.removeEventListener('cyco-editor-camera-changed',   this._onEditorCameraChanged);
    window.removeEventListener('cyco-preferences-change',      this._onPrefsChanged);
    window.removeEventListener('cyco-preferences-preview',     this._onPrefsChanged);
    window.removeEventListener('cyco-scene-switch',            this._onSceneSwitch);
  }
}

