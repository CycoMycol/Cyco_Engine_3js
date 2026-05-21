/**
 * RenderModeManager.js
 * Manages viewport shading modes: Solid, Wireframe, Material Preview, Rendered, Unlit.
 * Overrides materials per mode; restores originals on mode switch.
 *
 * Depends on: ViewportEngine (injected)
 *
 * Events consumed:
 *   cyco-vp-rendermode  { mode: 'solid'|'wireframe'|'matpreview'|'rendered'|'unlit' }
 */

import * as THREE from 'three';

export class RenderModeManager {
  /**
   * @param {import('./ViewportEngine.js').ViewportEngine} viewportEngine
   */
  constructor(viewportEngine) {
    this.engine = viewportEngine;
    this._mode  = 'solid';

    /**
     * Original materials cache for restoring after mode change.
     * Map<mesh.uuid, THREE.Material | THREE.Material[]>
     */
    this._originalMaterials = new Map();

    this._onRenderMode = this._onRenderMode.bind(this);
    window.addEventListener('cyco-vp-rendermode', this._onRenderMode);
  }

  get mode() { return this._mode; }

  // ─── Mode switching ───────────────────────────────────────────────────────

  _onRenderMode(event) {
    const { mode } = event.detail;
    if (mode === this._mode) return;
    this._restoreAll();
    this._mode = mode;
    this._apply();
  }

  _apply() {
    const scene = this.engine.scene;
    if (!scene) return;

    switch (this._mode) {
      case 'wireframe':
        this._overrideAll(mesh => {
          const mat = mesh.material.clone();
          mat.wireframe = true;
          return mat;
        });
        break;

      case 'matpreview':
        this._overrideAll(() => new THREE.MeshNormalMaterial());
        break;

      case 'unlit':
        this._overrideAll(mesh => {
          const orig = [mesh.material].flat()[0];
          const mat  = new THREE.MeshBasicMaterial({
            color: orig?.color ?? new THREE.Color(0x888888),
          });
          return mat;
        });
        break;

      case 'solid':
      case 'rendered':
        // Materials already restored by _restoreAll() above
        break;
    }
  }

  _overrideAll(matFactory) {
    const scene = this.engine.scene;
    scene.traverse(child => {
      if (!child.isMesh) return;
      if (this._originalMaterials.has(child.uuid)) return; // already overridden
      this._originalMaterials.set(child.uuid, child.material);
      child.material = matFactory(child);
    });
  }

  _restoreAll() {
    this._originalMaterials.forEach((mat, uuid) => {
      // Find the mesh in the scene by traversal
      const mesh = this._findByUuid(uuid);
      if (mesh) {
        // Dispose the override material to prevent GPU leaks
        if (mesh.material !== mat) {
          [mesh.material].flat().forEach(m => m?.dispose());
        }
        mesh.material = mat;
      }
    });
    this._originalMaterials.clear();
  }

  _findByUuid(uuid) {
    const scene = this.engine.scene;
    if (!scene) return null;
    let found = null;
    scene.traverse(child => {
      if (!found && child.uuid === uuid) found = child;
    });
    return found;
  }

  // ─── Disposal ─────────────────────────────────────────────────────────────

  dispose() {
    this._restoreAll();
    window.removeEventListener('cyco-vp-rendermode', this._onRenderMode);
  }
}
