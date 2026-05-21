/**
 * CameraViewPanel.js
 *
 * Renders the active scene from a user-placed PerspectiveCamera (or
 * OrthographicCamera) found in the scene hierarchy.
 *
 * Rules:
 *  - Owns its own dedicated WebGLRenderer — NEVER shares RendererManager's renderer.
 *  - Opened as a floating panel (320 × 240) when "Camera" is selected in
 *    CenterPanel's camera dropdown.
 *  - Fully dockable, resizable, closeable via dockview.
 *  - On close: renderer is disposed; on reopen: a fresh renderer is created.
 *
 * Listens:
 *   cyco-vp-camera  { view: 'camera' }  — raised by CenterPanel to open this panel
 */

import { BasePanel } from './BasePanel.js';
import * as THREE    from 'three';

export class CameraViewPanel extends BasePanel {
  constructor() {
    super();
    this._cameraRenderer = null;
    this._rafId          = null;
    this._resizeObserver = null;
    this._canvasWrap     = null;
    this._placeholder    = null;
  }

  // ── BasePanel overrides ───────────────────────────────────────────────────

  _buildContent() {
    const root = document.createElement('div');
    root.style.cssText = 'width:100%;height:100%;position:relative;background:#1a1a1a;overflow:hidden;';
    this._canvasWrap = root;

    // "No camera" overlay — visible until a scene camera is found
    this._placeholder = document.createElement('div');
    this._placeholder.style.cssText =
      'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
      'color:rgba(255,255,255,0.3);font-size:12px;font-family:var(--cyco-font,sans-serif);' +
      'text-align:center;pointer-events:none;padding:8px;';
    this._placeholder.textContent = 'Add a Camera object to the scene';
    root.appendChild(this._placeholder);

    // Defer renderer creation until the element is in the DOM and has size
    requestAnimationFrame(() => this._initRenderer());

    return root;
  }

  // dockview calls dispose() when the panel is closed / removed
  dispose() {
    this._teardown();
    // BasePanel has no dispose — call only if it gains one in future
    if (typeof super.dispose === 'function') super.dispose();
  }

  // ── Renderer lifecycle ────────────────────────────────────────────────────

  _initRenderer() {
    if (!this._canvasWrap) return;

    const { offsetWidth: w, offsetHeight: h } = this._canvasWrap;
    const width  = Math.max(1, w || 320);
    const height = Math.max(1, h || 240);

    this._cameraRenderer = new THREE.WebGLRenderer({ antialias: true });
    this._cameraRenderer.setSize(width, height);
    this._cameraRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._cameraRenderer.outputColorSpace = THREE.SRGBColorSpace;
    this._cameraRenderer.toneMapping      = THREE.ACESFilmicToneMapping;

    this._canvasWrap.appendChild(this._cameraRenderer.domElement);

    // Resize observer — update renderer + camera aspect when container changes
    this._resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        const pw = Math.max(1, Math.floor(entry.contentRect.width));
        const ph = Math.max(1, Math.floor(entry.contentRect.height));
        if (this._cameraRenderer) {
          this._cameraRenderer.setSize(pw, ph);
        }
        const cam = this._findSceneCamera();
        if (cam?.isPerspectiveCamera) {
          cam.aspect = pw / ph;
          cam.updateProjectionMatrix();
        }
      }
    });
    this._resizeObserver.observe(this._canvasWrap);

    // Start the render loop (separate from ViewportEngine's loop)
    const loop = () => {
      this._rafId = requestAnimationFrame(loop);
      this._renderFrame();
    };
    loop();
  }

  _teardown() {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    if (this._cameraRenderer) {
      this._cameraRenderer.dispose();
      this._cameraRenderer = null;
    }
    this._canvasWrap  = null;
    this._placeholder = null;
  }

  // ── Render helpers ────────────────────────────────────────────────────────

  /** Walk scene graph for the first user-placed camera (not the editor camera). */
  _findSceneCamera() {
    const scene = window.__cyco?.viewportEngine?.scene;
    if (!scene) return null;
    let found = null;
    scene.traverse(obj => {
      if (!found && (obj.isPerspectiveCamera || obj.isOrthographicCamera)) {
        found = obj;
      }
    });
    return found;
  }

  _renderFrame() {
    if (!this._cameraRenderer) return;
    const scene = window.__cyco?.viewportEngine?.scene;
    if (!scene) return;

    const cam = this._findSceneCamera();
    if (!cam) {
      if (this._placeholder) this._placeholder.style.display = 'flex';
      return;
    }
    if (this._placeholder) this._placeholder.style.display = 'none';
    this._cameraRenderer.render(scene, cam);
  }
}
