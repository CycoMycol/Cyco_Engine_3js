/**
 * CameraViewPanel.js — camera preview panel (dockview BasePanel subclass).
 *
 * Opens as a native dockview floating window by default, so it never steals
 * space from the main viewport.  The user can drag the tab to dock it anywhere,
 * or drag the floating window title bar to a panel group to re-dock.
 *
 * Toggle:
 *   const api = window.__cyco.dockviewApi;
 *   const p   = api.getPanel('camera-view');
 *   if (p) p.api.close();
 *   else   api.addPanel({ id:'camera-view', component:'CameraViewPanel',
 *                          title:'Camera View',
 *                          floating:{ x:260, y:90, width:340, height:260 } });
 *
 * Toolbar:
 *   [camera Camera Selector v]   [spacer]   [save Save v]
 *
 * Screenshot formats: PNG · JPEG · BMP
 *
 * Resize fix: cam.aspect is temporarily set per-frame and immediately restored,
 * so the main viewport camera projection is NEVER permanently mutated.
 */

import * as THREE from 'three';
import { BasePanel } from './BasePanel.js';

import { EffectComposer }   from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }       from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass }  from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass }       from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass }       from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader }       from 'three/addons/shaders/FXAAShader.js';

// ── CSS (injected once) ───────────────────────────────────────────────────────
const _STYLE_ID = 'cyco-cvp-styles';
if (!document.getElementById(_STYLE_ID)) {
  const s = document.createElement('style');
  s.id = _STYLE_ID;
  s.textContent = `
/* ── panel wrapper ──────────────────────────────────── */
.cvp-wrap {
  display:flex; flex-direction:column; width:100%; height:100%;
  background:#111; overflow:hidden;
}
/* ── toolbar ─────────────────────────────────────────── */
.cvp-bar {
  display:flex; align-items:center; gap:4px; padding:3px 6px;
  background:#111; border-bottom:1px solid #1e1e1e; flex-shrink:0;
}
.cvp-btn {
  display:flex; align-items:center; gap:4px; padding:2px 7px; height:22px;
  background:transparent; border:1px solid transparent; border-radius:4px;
  color:#ccc; font-size:11px; font-family:inherit; cursor:pointer; white-space:nowrap;
  transition:background 80ms,border-color 80ms;
}
.cvp-btn:hover { background:rgba(224,114,40,.18); border-color:rgba(224,114,40,.4); color:#fff; }
/* ── dropdowns ──────────────────────────────────────── */
.cvp-dd-panel {
  display:none; position:absolute; top:calc(100% + 3px); left:0; z-index:2100;
  min-width:160px; background:#1e1e1e; border:1px solid #3a3a3a; border-radius:5px;
  box-shadow:0 6px 20px rgba(0,0,0,.6); overflow:hidden;
}
.cvp-dd-wrap { position:relative; }
.cvp-dd-wrap.open .cvp-dd-panel { display:block; }
.cvp-dd-row {
  display:flex; align-items:center; gap:6px; padding:5px 10px;
  font-size:11px; color:#ccc; cursor:pointer; white-space:nowrap;
}
.cvp-dd-row:hover { background:rgba(224,114,40,.18); color:#fff; }
.cvp-dd-row.selected { color:var(--ce-accent-orange,#e07228); }
.cvp-snap-wrap { position:relative; }
.cvp-fmt-panel {
  display:none; position:absolute; top:calc(100% + 3px); right:0; z-index:2100;
  background:#1e1e1e; border:1px solid #3a3a3a; border-radius:5px;
  box-shadow:0 6px 20px rgba(0,0,0,.6); overflow:hidden;
}
.cvp-snap-wrap.open .cvp-fmt-panel { display:block; }
.cvp-fmt-row {
  display:flex; align-items:center; gap:6px; padding:5px 12px;
  font-size:11px; color:#ccc; cursor:pointer; white-space:nowrap;
}
.cvp-fmt-row:hover { background:rgba(255,255,255,.07); color:#fff; }
`;
  document.head.appendChild(s);
}

// ── Icons ─────────────────────────────────────────────────────────────────────
const _ICON_CAM  = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>';
const _ICON_SNAP = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>';

// ─────────────────────────────────────────────────────────────────────────────
export class CameraViewPanel extends BasePanel {

  constructor() {
    super();
    this._cameraRenderer  = null;
    this._rafId           = null;
    this._resizeObserver  = null;
    this._canvasWrap      = null;
    this._placeholder     = null;
    this._selectedCamId   = '__main__';
    this._camLabel        = null;
    this._ddWrap          = null;
    this._snapWrap        = null;
    this._outsideHandler  = null;
    /** Whether to show transform gizmo in camera view (off by default). */
    this._showGizmo = false;
    /** Whether to show grid in camera view (off by default). */
    this._showGrid  = false;
    /** Local IBL env map generated with THIS renderer's WebGL context (mirrors sky gradient). */
    this._localEnvTex = null;
    /** Bound sky change handler — stored so it can be removed on teardown. */
    this._onSkyChangeBound = this._onSkyChange.bind(this);
    /** EffectComposer that mirrors the main viewport's post-processing pipeline. */
    this._cameraComposer   = null;
    this._cameraRenderPass = null;
    this._cameraBloomPass  = null;
    this._cameraFxaaPass   = null;
  }

  // ── dockview lifecycle ────────────────────────────────────────────────────

  init(params) {
    super.init(params);

    // Close dropdowns on outside click
    this._outsideHandler = (e) => {
      if (this._ddWrap   && !this._ddWrap.contains(e.target))   this._ddWrap.classList.remove('open');
      if (this._snapWrap && !this._snapWrap.contains(e.target))  this._snapWrap.classList.remove('open');
    };
    document.addEventListener('click', this._outsideHandler);

    // Start renderer after DOM paint so offsetWidth/Height are valid
    requestAnimationFrame(() => this._initRenderer());
  }

  dispose() {
    this._teardown();
    if (this._outsideHandler) {
      document.removeEventListener('click', this._outsideHandler);
      this._outsideHandler = null;
    }
    super.dispose?.();
  }

  // Camera view uses dockview native tab drag — skip custom float/size buttons
  _addHeaderActions(_api) { /* intentionally empty */ }

  // ── Content ───────────────────────────────────────────────────────────────

  _buildContent() {
    const wrap = document.createElement('div');
    wrap.className = 'cvp-wrap';

    wrap.appendChild(this._buildToolbar());

    this._canvasWrap = document.createElement('div');
    this._canvasWrap.style.cssText = 'flex:1;position:relative;overflow:hidden;';

    this._placeholder = document.createElement('div');
    this._placeholder.style.cssText =
      'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
      'color:rgba(255,255,255,0.3);font-size:12px;font-family:var(--cyco-font,sans-serif);' +
      'text-align:center;pointer-events:none;padding:8px;';
    this._placeholder.textContent = 'No camera available';
    this._canvasWrap.appendChild(this._placeholder);

    wrap.appendChild(this._canvasWrap);
    return wrap;
  }

  // ── Toolbar ───────────────────────────────────────────────────────────────

  _buildToolbar() {
    const bar = document.createElement('div');
    bar.className = 'cvp-bar';

    // Camera selector dropdown
    this._ddWrap = document.createElement('div');
    this._ddWrap.className = 'cvp-dd-wrap';

    const ddBtn = document.createElement('button');
    ddBtn.className = 'cvp-btn';
    this._camLabel = document.createElement('span');
    this._camLabel.textContent = 'Main Camera';
    ddBtn.innerHTML = _ICON_CAM;
    ddBtn.appendChild(this._camLabel);
    const arr = document.createElement('span');
    arr.textContent = '\u25be';
    arr.style.cssText = 'font-size:9px;opacity:.6;margin-left:2px;';
    ddBtn.appendChild(arr);

    const ddPanel = document.createElement('div');
    ddPanel.className = 'cvp-dd-panel';

    ddBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const wasOpen = this._ddWrap.classList.contains('open');
      this._ddWrap.classList.remove('open');
      this._snapWrap?.classList.remove('open');
      if (!wasOpen) {
        this._populateCameraList(ddPanel);
        this._ddWrap.classList.add('open');
      }
    });

    this._ddWrap.appendChild(ddBtn);
    this._ddWrap.appendChild(ddPanel);
    bar.appendChild(this._ddWrap);

    // Spacer
    const spacer = document.createElement('div');
    spacer.style.flex = '1';
    bar.appendChild(spacer);

    // Grid toggle button
    const gridBtn = document.createElement('button');
    gridBtn.className = 'cvp-btn';
    gridBtn.title = 'Toggle Grid';
    gridBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3h18M3 9h18M3 15h18M3 21h18M9 3v18M15 3v18M3 3v18M21 3v18"/></svg>';
    gridBtn.style.opacity = this._showGrid ? '1' : '0.4';
    gridBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._showGrid = !this._showGrid;
      gridBtn.style.opacity = this._showGrid ? '1' : '0.4';
      gridBtn.style.borderColor = this._showGrid ? 'rgba(224,114,40,.5)' : 'transparent';
    });
    bar.appendChild(gridBtn);

    // Gizmo toggle button
    const gizmoBtn = document.createElement('button');
    gizmoBtn.className = 'cvp-btn';
    gizmoBtn.title = 'Toggle Transform Gizmo';
    gizmoBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="2" x2="12" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><circle cx="12" cy="12" r="3"/></svg>';
    gizmoBtn.style.opacity = this._showGizmo ? '1' : '0.4';
    gizmoBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._showGizmo = !this._showGizmo;
      gizmoBtn.style.opacity = this._showGizmo ? '1' : '0.4';
      gizmoBtn.style.borderColor = this._showGizmo ? 'rgba(224,114,40,.5)' : 'transparent';
    });
    bar.appendChild(gizmoBtn);

    // Snapshot / Save button
    this._snapWrap = document.createElement('div');
    this._snapWrap.className = 'cvp-snap-wrap';

    const snapBtn = document.createElement('button');
    snapBtn.className = 'cvp-btn';
    snapBtn.title = 'Save Snapshot';
    snapBtn.innerHTML = _ICON_SNAP + '<span style="margin-left:2px;">Save</span>';

    const fmtPanel = document.createElement('div');
    fmtPanel.className = 'cvp-fmt-panel';
    [
      { label: 'PNG',  ext: 'png', mime: 'image/png'  },
      { label: 'JPEG', ext: 'jpg', mime: 'image/jpeg' },
      { label: 'BMP',  ext: 'bmp', mime: 'bmp'        },
    ].forEach(fmt => {
      const row = document.createElement('div');
      row.className = 'cvp-fmt-row';
      row.textContent = fmt.label;
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        this._snapWrap.classList.remove('open');
        this._saveSnapshot(fmt);
      });
      fmtPanel.appendChild(row);
    });

    snapBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const wasOpen = this._snapWrap.classList.contains('open');
      this._snapWrap.classList.remove('open');
      this._ddWrap?.classList.remove('open');
      if (!wasOpen) this._snapWrap.classList.add('open');
    });

    this._snapWrap.appendChild(snapBtn);
    this._snapWrap.appendChild(fmtPanel);
    bar.appendChild(this._snapWrap);

    return bar;
  }

  _populateCameraList(panel) {
    panel.innerHTML = '';

    const mainRow = document.createElement('div');
    mainRow.className = 'cvp-dd-row' + (this._selectedCamId === '__main__' ? ' selected' : '');
    mainRow.innerHTML = _ICON_CAM + '<span>Main Camera</span>';
    mainRow.addEventListener('click', (e) => {
      e.stopPropagation();
      this._selectedCamId = '__main__';
      this._camLabel.textContent = 'Main Camera';
      this._ddWrap.classList.remove('open');
    });
    panel.appendChild(mainRow);

    const cams = this._getSceneCameras();
    cams.forEach(cam => {
      const row = document.createElement('div');
      const lbl = cam.name || cam.type || 'Camera';
      row.className = 'cvp-dd-row' + (this._selectedCamId === cam.uuid ? ' selected' : '');
      row.innerHTML = _ICON_CAM + `<span>${lbl}</span>`;
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        this._selectedCamId = cam.uuid;
        this._camLabel.textContent = lbl;
        this._ddWrap.classList.remove('open');
      });
      panel.appendChild(row);
    });

    if (!cams.length) {
      const empty = document.createElement('div');
      empty.className = 'cvp-dd-row';
      empty.style.cssText = 'opacity:.4;pointer-events:none;';
      empty.textContent = 'No cameras in scene';
      panel.appendChild(empty);
    }
  }

  // ── Renderer lifecycle ────────────────────────────────────────────────────

  _initRenderer() {
    if (!this._canvasWrap) return;

    const { offsetWidth: w, offsetHeight: h } = this._canvasWrap;
    const width  = Math.max(1, w || 320);
    const height = Math.max(1, h || 200);

    this._cameraRenderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this._cameraRenderer.setSize(width, height);
    this._cameraRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._cameraRenderer.outputColorSpace = THREE.SRGBColorSpace;
    this._cameraRenderer.toneMapping      = THREE.ACESFilmicToneMapping;
    this._cameraRenderer.toneMappingExposure = 1.0;
    this._cameraRenderer.setClearColor(0x1a1a1a, 1);

    // Generate a sky-gradient IBL env map using THIS renderer's own WebGL context.
    // PMREM textures are context-specific — we must regenerate the gradient from the
    // same color stops that the main viewport uses.
    const initColorStops = window.__cyco?.viewportEngine?._lastSkyColorStops ?? null;
    if (initColorStops) {
      this._rebuildLocalSkyEnv(initColorStops);
    }

    // Keep env in sync when sky gradient changes
    window.addEventListener('cyco-sky-change', this._onSkyChangeBound);

    const c = this._cameraRenderer.domElement;
    c.style.cssText = 'display:block;width:100%;height:100%;';
    this._canvasWrap.appendChild(c);

    // Resize the renderer only — do NOT touch cam.aspect here.
    // The main viewport camera projection is saved/restored inside _renderFrame.
    this._resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        const pw = Math.max(1, Math.floor(entry.contentRect.width));
        const ph = Math.max(1, Math.floor(entry.contentRect.height));
        if (!this._cameraRenderer) return;
        this._cameraRenderer.setSize(pw, ph);
        this._rebuildComposer(pw, ph);
      }
    });
    this._resizeObserver.observe(this._canvasWrap);

    // Build initial EffectComposer so camera view matches viewport post-processing
    this._rebuildComposer(width, height);

    const loop = () => {
      this._rafId = requestAnimationFrame(loop);
      this._renderFrame();
    };
    loop();
  }

  _rebuildComposer(w, h) {
    // Dispose previous composer passes and buffers
    if (this._cameraComposer) {
      this._cameraComposer.passes.forEach(p => p.dispose?.());
      this._cameraComposer.dispose?.();
      this._cameraComposer   = null;
      this._cameraRenderPass = null;
      this._cameraBloomPass  = null;
      this._cameraFxaaPass   = null;
    }
    if (!this._cameraRenderer) return;

    // Match the main viewport's HDR pipeline: HalfFloat RT → RenderPass → Bloom → OutputPass → FXAA
    const hdrTarget = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType });
    this._cameraComposer = new EffectComposer(this._cameraRenderer, hdrTarget);

    // Placeholder scene/camera — updated each frame in _renderFrame()
    this._cameraRenderPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
    this._cameraComposer.addPass(this._cameraRenderPass);

    // Read bloom settings from main viewport pipeline if available, else use defaults
    const mainBloom = window.__cyco?.postPipeline?.bloomPass;
    const bStrength = mainBloom?.strength  ?? 0.8;
    const bRadius   = mainBloom?.radius    ?? 0.4;
    const bThresh   = mainBloom?.threshold ?? 0.85;
    this._cameraBloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), bStrength, bRadius, bThresh);
    this._cameraComposer.addPass(this._cameraBloomPass);

    // OutputPass — applies ACESFilmic tone mapping + sRGB colour-space conversion
    this._cameraComposer.addPass(new OutputPass());

    // FXAA — must come after OutputPass; state synced from main pipeline each frame
    const dpr = this._cameraRenderer.getPixelRatio();
    this._cameraFxaaPass = new ShaderPass(FXAAShader);
    this._cameraFxaaPass.material.uniforms['resolution'].value.set(1 / (w * dpr), 1 / (h * dpr));
    this._cameraFxaaPass.enabled = window.__cyco?.postPipeline?._fxaaEnabled ?? false;
    this._cameraComposer.addPass(this._cameraFxaaPass);
  }

  _teardown() {
    if (this._rafId !== null) { cancelAnimationFrame(this._rafId); this._rafId = null; }
    if (this._resizeObserver) { this._resizeObserver.disconnect(); this._resizeObserver = null; }
    if (this._cameraComposer) {
      this._cameraComposer.passes.forEach(p => p.dispose?.());
      this._cameraComposer.dispose?.();
      this._cameraComposer   = null;
      this._cameraRenderPass = null;
      this._cameraBloomPass  = null;
      this._cameraFxaaPass   = null;
    }
    window.removeEventListener('cyco-sky-change', this._onSkyChangeBound);
    if (this._localEnvTex) { this._localEnvTex.dispose(); this._localEnvTex = null; }
    if (this._cameraRenderer) { this._cameraRenderer.dispose(); this._cameraRenderer = null; }
    this._canvasWrap  = null;
    this._placeholder = null;
  }

  // ── Sky env mirroring ─────────────────────────────────────────────────────

  /** Called when the main viewport sky gradient changes; rebuilds the local env map. */
  _onSkyChange({ detail } = {}) {
    const { colorStops } = detail ?? {};
    if (colorStops && this._cameraRenderer) {
      this._rebuildLocalSkyEnv(colorStops);
    }
  }

  /**
   * Regenerate the sky-gradient PMREM env map using the camera renderer's own
   * WebGL context (PMREM textures cannot be shared across WebGL contexts).
   * Mirrors ViewportEngine._buildSkyEnvMap() exactly.
   * @param {Array<{pos:number,color:string}>} colorStops
   */
  _rebuildLocalSkyEnv(colorStops) {
    if (!this._cameraRenderer || !colorStops?.length) return;
    try {
      const w = 512, h = 256;
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');

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

      const pmrem = new THREE.PMREMGenerator(this._cameraRenderer);
      pmrem.compileEquirectangularShader();
      const envTex = pmrem.fromEquirectangular(tex).texture;
      pmrem.dispose();
      tex.dispose();

      if (this._localEnvTex) this._localEnvTex.dispose();
      this._localEnvTex = envTex;
    } catch (e) {
      console.warn('[CameraViewPanel] Could not build local sky env map:', e);
    }
  }

  // ── Camera resolution ─────────────────────────────────────────────────────

  _getSceneCameras() {
    const scene = window.__cyco?.viewportEngine?.scene;
    if (!scene) return [];
    const found = [];
    scene.traverse(obj => {
      if (obj.isPerspectiveCamera || obj.isOrthographicCamera) found.push(obj);
    });
    return found;
  }

  _resolveCamera() {
    const ve = window.__cyco?.viewportEngine;
    if (this._selectedCamId === '__main__') return ve?.camera ?? null;
    const scene = ve?.scene;
    if (!scene) return ve?.camera ?? null;
    let found = null;
    scene.traverse(obj => { if (!found && obj.uuid === this._selectedCamId) found = obj; });
    return found ?? ve?.camera ?? null;
  }

  // ── Render loop ───────────────────────────────────────────────────────────

  _renderFrame() {
    if (!this._cameraRenderer) return;
    const ve    = window.__cyco?.viewportEngine;
    const scene = ve?.scene;
    if (!scene) return;

    const cam = this._resolveCamera();
    if (!cam) {
      if (this._placeholder) this._placeholder.style.display = 'flex';
      return;
    }
    if (this._placeholder) this._placeholder.style.display = 'none';

    // ── Temporarily hide editor-only helpers ──────────────────────────────
    const grid    = ve.gridHelper;
    const axes    = ve.axesHelper;
    const gridWas = grid?.visible ?? false;
    const axesWas = axes?.visible ?? false;
    if (grid) grid.visible = this._showGrid;
    if (axes) axes.visible = false; // axes helper always hidden in camera view

    // ── Temporarily hide transform gizmo ──────────────────────────────────
    const gizmoHelper = window.__cyco?.transformGizmo?._helper;
    const gizmoWas    = gizmoHelper?.visible ?? false;
    if (gizmoHelper) gizmoHelper.visible = this._showGizmo && gizmoWas;

    // ── Temporarily correct aspect for this preview window ────────────────
    // Save and restore the camera projection matrix so the shared main camera
    // is NEVER permanently mutated — resizing the camera view panel cannot
    // affect the main viewport.
    let savedAspect = undefined;
    let savedMatrix = null;
    if (cam.isPerspectiveCamera) {
      const pw = this._cameraRenderer.domElement.width;
      const ph = Math.max(1, this._cameraRenderer.domElement.height);
      savedAspect = cam.aspect;
      savedMatrix = cam.projectionMatrix.clone();
      cam.aspect = pw / ph;
      cam.updateProjectionMatrix();
    }

    // ── Sync exposure with main renderer ─────────────────────────────────
    const mainExposure = window.__cyco?.rendererManager?.renderer?.toneMappingExposure ?? 1.0;
    this._cameraRenderer.toneMappingExposure = mainExposure;

    // ── Sync post-processing state from main viewport pipeline ─────────────
    const pp         = window.__cyco?.postPipeline;
    const ppEnabled  = pp?._pipelineEnabled !== false;
    const mainBloom  = pp?.bloomPass;
    if (mainBloom && this._cameraBloomPass) {
      this._cameraBloomPass.strength  = mainBloom.strength;
      this._cameraBloomPass.radius    = mainBloom.radius;
      this._cameraBloomPass.threshold = mainBloom.threshold;
      this._cameraBloomPass.enabled   = mainBloom.enabled !== false;
    }
    if (this._cameraFxaaPass) {
      this._cameraFxaaPass.enabled = pp?._fxaaEnabled ?? false;
    }

    // ── Use local IBL env map (PMREM textures are context-specific) ───────
    const prevEnv = scene.environment;
    if (this._localEnvTex) scene.environment = this._localEnvTex;

    // ── Render: use EffectComposer only when main pipeline is enabled ──────
    if (this._cameraComposer && this._cameraRenderPass && ppEnabled) {
      this._cameraRenderPass.scene  = scene;
      this._cameraRenderPass.camera = cam;
      this._cameraComposer.render();
    } else {
      this._cameraRenderer.render(scene, cam);
    }

    // Restore scene env so main renderer keeps its context-correct texture
    scene.environment = prevEnv;

    // ── Restore ───────────────────────────────────────────────────────────
    if (savedAspect !== undefined) {
      cam.aspect = savedAspect;
      cam.projectionMatrix.copy(savedMatrix);
    }
    if (grid) grid.visible = gridWas;
    if (axes) axes.visible = axesWas;
    if (gizmoHelper) gizmoHelper.visible = gizmoWas;
  }

  // ── Snapshot ──────────────────────────────────────────────────────────────

  _saveSnapshot({ ext, mime }) {
    if (!this._cameraRenderer) return;
    const canvas = this._cameraRenderer.domElement;

    if (mime === 'bmp') {
      this._saveBMP(canvas, 'camera-snapshot.bmp');
    } else {
      const url = canvas.toDataURL(mime, mime === 'image/jpeg' ? 0.92 : undefined);
      this._download(url, `camera-snapshot.${ext}`);
    }
  }

  _saveBMP(canvas, filename) {
    const tmp = document.createElement('canvas');
    tmp.width = canvas.width; tmp.height = canvas.height;
    tmp.getContext('2d').drawImage(canvas, 0, 0);
    const { data } = tmp.getContext('2d').getImageData(0, 0, tmp.width, tmp.height);

    const w = tmp.width, h = tmp.height;
    const rowBytes  = Math.ceil(w * 3 / 4) * 4;
    const pixelSize = rowBytes * h;
    const buf  = new ArrayBuffer(54 + pixelSize);
    const view = new DataView(buf);

    view.setUint8(0, 0x42); view.setUint8(1, 0x4D);
    view.setUint32(2, 54 + pixelSize, true);
    view.setUint32(6, 0, true); view.setUint32(10, 54, true);
    view.setUint32(14, 40, true);
    view.setInt32(18, w, true); view.setInt32(22, -h, true);
    view.setUint16(26, 1, true); view.setUint16(28, 24, true);
    view.setUint32(30, 0, true); view.setUint32(34, pixelSize, true);
    view.setInt32(38, 2835, true); view.setInt32(42, 2835, true);
    view.setUint32(46, 0, true); view.setUint32(50, 0, true);

    let offset = 54;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        view.setUint8(offset++, data[idx + 2]); // B
        view.setUint8(offset++, data[idx + 1]); // G
        view.setUint8(offset++, data[idx]);     // R
      }
      offset += rowBytes - w * 3;
    }
    this._download(URL.createObjectURL(new Blob([buf], { type: 'image/bmp' })), filename);
  }

  _download(url, filename) {
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    if (url.startsWith('blob:')) setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
}