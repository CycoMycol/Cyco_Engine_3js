/**
 * TransformGizmo.js
 * Wraps Three.js TransformControls. Attaches to selected objects,
 * handles mode switching (translate/rotate/scale), snap, and world/local space.
 * Disables OrbitControls while dragging to prevent camera rotation conflicts.
 * Records TransformCommands for undo/redo.
 *
 * Depends on: ViewportEngine (injected), SelectionManager (injected)
 *
 * Events consumed:
 *   cyco-vp-ready           { scene, camera }      — set up controls after viewport ready
 *   cyco-renderer-changed   { renderer }           — rebuild on renderer swap
 *   cyco-select-node        { object }             — attach gizmo to selection
 *   cyco-deselect-all       {}                     — detach gizmo
 *   cyco-vp-tool            { mode }               — 'translate' | 'rotate' | 'scale'
 *   cyco-rvp-snap           { enabled, value }     — snap toggle + value
 *   cyco-rvp-world          { isWorld }            — world / local space toggle
 *   cyco-gizmo-size         { size }               — from Preferences
 */

import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

export class TransformGizmo {
  /**
   * @param {import('./ViewportEngine.js').ViewportEngine} viewportEngine
   * @param {import('./SelectionManager.js').SelectionManager} selectionManager
   */
  constructor(viewportEngine, selectionManager) {
    this.engine           = viewportEngine;
    this.selectionManager = selectionManager;

    /** @type {TransformControls|null} */
    this.controls = null;

    this._snapEnabled = false;
    this._snapValue   = 0.25;
    this._mode        = 'translate';

    /** State snapshot before a drag begins (for TransformCommand undo). */
    this._matrixBefore = null;
    this._targetObject = null;

    this._onVpReady          = this._onVpReady.bind(this);
    this._onRendererChanged  = this._onRendererChanged.bind(this);
    this._onSelectNode       = this._onSelectNode.bind(this);
    this._onDeselectAll      = this._onDeselectAll.bind(this);
    this._onTool             = this._onTool.bind(this);
    this._onSnap             = this._onSnap.bind(this);
    this._onWorld            = this._onWorld.bind(this);
    this._onGizmoSize        = this._onGizmoSize.bind(this);

    window.addEventListener('cyco-vp-ready',          this._onVpReady);
    window.addEventListener('cyco-renderer-changed',  this._onRendererChanged);
    window.addEventListener('cyco-select-node',       this._onSelectNode);
    window.addEventListener('cyco-deselect-all',      this._onDeselectAll);
    window.addEventListener('cyco-hierarchy-remove',  (e) => {
      const { objectId } = e.detail ?? {};
      if (objectId && this._targetObject?.userData?.cycoId === objectId) this.detach();
    });
    window.addEventListener('cyco-vp-tool',           this._onTool);
    window.addEventListener('cyco-rvp-snap',          this._onSnap);
    window.addEventListener('cyco-rvp-world',         this._onWorld);
    window.addEventListener('cyco-gizmo-size',        this._onGizmoSize);
  }

  // ─── Build ────────────────────────────────────────────────────────────────

  _build(renderer) {
    const camera = this.engine.camera;
    const scene  = this.engine.scene;
    if (!camera || !scene || !renderer?.domElement) return;

    if (this.controls) {
      scene.remove(this.controls.getHelper());
      this.controls.dispose();
    }

    this.controls = new TransformControls(camera, renderer.domElement);
    this.controls.setMode(this._mode);
    this.controls.setSpace('world');
    this._applySnap();

    // CRITICAL — prevents camera orbiting while dragging the gizmo
    this.controls.addEventListener('dragging-changed', event => {
      const orbitControls = this.engine.controls;
      if (orbitControls) orbitControls.enabled = !event.value;
    });

    // Record matrix before drag for undo
    this.controls.addEventListener('mouseDown', () => {
      if (this._targetObject) {
        this._matrixBefore = this._targetObject.matrix.clone();
      }
    });

    // Commit TransformCommand after drag completes
    this.controls.addEventListener('mouseUp', () => {
      if (this._targetObject && this._matrixBefore) {
        const before = this._matrixBefore;
        const after  = this._targetObject.matrix.clone();
        const obj    = this._targetObject;
        window.dispatchEvent(new CustomEvent('cyco-command-execute', {
          detail: {
            name: `Transform ${obj.name}`,
            do()   { obj.matrix.copy(after);  obj.matrix.decompose(obj.position, obj.quaternion, obj.scale); },
            undo() { obj.matrix.copy(before); obj.matrix.decompose(obj.position, obj.quaternion, obj.scale); },
          }
        }));
        this._matrixBefore = null;
      }
    });

    // Make gizmo non-selectable (tag all descendants + add to nonSelectableSet)
    this._helper = this.controls.getHelper();
    this._helper.traverse(child => { child.userData._isGizmo = true; });
    this.selectionManager.addNonSelectable(this._helper);
    scene.add(this._helper);
  }

  // ─── Event handlers ───────────────────────────────────────────────────────

  _onVpReady() {
    const renderer = this.engine.rendererManager?.renderer;
    this._build(renderer);
  }

  _onRendererChanged(event) {
    this._build(event.detail?.renderer ?? this.engine.rendererManager?.renderer);
  }

  _onSelectNode(event) {
    const { object } = event.detail;
    if (!this.controls) return;

    if (object && !object.userData.cycoLocked) {
      this._targetObject = object;
      this.controls.attach(object);
    } else {
      this.detach();
    }
  }

  _onDeselectAll() { this.detach(); }

  _onTool(event) {
    const { mode } = event.detail;
    if (!['translate', 'rotate', 'scale'].includes(mode)) return;
    this._mode = mode;
    this.controls?.setMode(mode);
  }

  _onSnap(event) {
    this._snapEnabled = !!event.detail.enabled;
    this._snapValue   = event.detail.value ?? this._snapValue;
    this._applySnap();
  }

  _onWorld(event) {
    this.controls?.setSpace(event.detail.isWorld ? 'world' : 'local');
  }

  _onGizmoSize(event) {
    if (this.controls) this.controls.size = event.detail.size ?? 1;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  _applySnap() {
    if (!this.controls) return;
    this.controls.translationSnap = this._snapEnabled ? this._snapValue          : null;
    this.controls.rotationSnap    = this._snapEnabled ? (Math.PI / 12)           : null; // 15°
    this.controls.scaleSnap       = this._snapEnabled ? (this._snapValue * 0.1)  : null;
  }

  detach() {
    this._targetObject = null;
    this.controls?.detach();
  }

  /** Called by GameRuntime.play() — hides gizmo during play mode. */
  suspend() { this.detach(); if (this._helper) this._helper.visible = false; }
  /** Called by GameRuntime.stop() — restores gizmo after play mode. */
  restore()  { if (this._helper) this._helper.visible = true; }

  // ─── Disposal ─────────────────────────────────────────────────────────────

  dispose() {
    window.removeEventListener('cyco-vp-ready',          this._onVpReady);
    window.removeEventListener('cyco-renderer-changed',  this._onRendererChanged);
    window.removeEventListener('cyco-select-node',       this._onSelectNode);
    window.removeEventListener('cyco-deselect-all',      this._onDeselectAll);
    window.removeEventListener('cyco-vp-tool',           this._onTool);
    window.removeEventListener('cyco-rvp-snap',          this._onSnap);
    window.removeEventListener('cyco-rvp-world',         this._onWorld);
    window.removeEventListener('cyco-gizmo-size',        this._onGizmoSize);

    if (this.controls) {
      this.engine.scene?.remove(this.controls);
      this.controls.dispose();
    }
  }
}
