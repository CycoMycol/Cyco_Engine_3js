/**
 * TransformGizmo.js
 * Minimal skeleton - translate/rotate/scale/universal gizmo code removed.
 * Kept as a no-op shell so main.js, GameRuntime, and CameraViewPanel
 * can still reference the class without crashing.
 */

export class TransformGizmo {
  constructor(viewportEngine, selectionManager) {
    this.engine = viewportEngine;
    this.selectionManager = selectionManager;
    this._controls = null;
    this._targetObject = null;
  }

  get controls() { return this._controls; }
  set controls(v) { this._controls = v; }

  detach() {
    this._targetObject = null;
    if (this._controls) { try { this._controls.detach(); } catch(_) {} }
  }

  suspend() { this.detach(); }
  restore() {}
  dispose() { this.detach(); }
}