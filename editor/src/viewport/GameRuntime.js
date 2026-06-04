/**
 * GameRuntime.js
 * Manages Play / Stop mode transitions.
 *
 * Play:
 *   - Serialises current scene as a restore snapshot
 *   - Locks hierarchy (disables add/remove/rename/drag in LeftPanel)
 *   - Detaches TransformGizmo
 *   - Suspends SelectionManager
 *   - Shows green "PLAYING" badge in viewport
 *
 * Stop:
 *   - Deserialises snapshot → restores scene
 *   - Re-applies IBL to restored scene
 *   - Unlocks hierarchy
 *   - Restores TransformGizmo
 *   - Resumes SelectionManager
 *   - Removes "PLAYING" badge
 *
 * Depends on:
 *   ViewportEngine, SceneManager, SelectionManager, TransformGizmo (all injected)
 *
 * Events dispatched:
 *   cyco-runtime-state  { playing: boolean }
 *
 * Events consumed:
 *   cyco-runtime-play   {}
 *   cyco-runtime-stop   {}
 */

import * as THREE from 'three';
import { PhysicsManager } from './PhysicsManager.js';

export class GameRuntime {
  /**
   * @param {import('./ViewportEngine.js').ViewportEngine}       viewportEngine
   * @param {import('./SceneManager.js').SceneManager}           sceneManager
   * @param {import('./SelectionManager.js').SelectionManager}   selectionManager
   * @param {import('./TransformGizmo.js').TransformGizmo}       transformGizmo
   */
  constructor(viewportEngine, sceneManager, selectionManager, transformGizmo) {
    this.engine           = viewportEngine;
    this.sceneManager     = sceneManager;
    this.selectionManager = selectionManager;
    this.transformGizmo   = transformGizmo;

    this.playing = false;

    /** @type {string|null} JSON snapshot of scene before play */
    this._snapshot = null;

    /** @type {string[]} Selected object cycoIds preserved across Play/Stop */
    this._selectedIds = [];

    /** @type {HTMLElement|null} */
    this._badge = null;

    /** Physics runtime — only alive during Play */
    this.physicsManager = new PhysicsManager();
    this._scriptInstances = new Map();

    this._onPlay = this._onPlay.bind(this);
    this._onStop = this._onStop.bind(this);

    window.addEventListener('cyco-runtime-play', this._onPlay);
    window.addEventListener('cyco-runtime-stop', this._onStop);
  }

  // ─── Play / Stop ─────────────────────────────────────────────────────────

  async _onPlay() {
    if (this.playing) return;
    this.playing = true;

    // 1. Serialise scene as restore point
    const sceneJson = this.sceneManager.serializeActiveScene();
    this._snapshot  = sceneJson ? JSON.stringify(sceneJson) : null;
    this._selectedIds = [...this.selectionManager.selected]
      .map(obj => obj?.userData?.cycoId)
      .filter(Boolean);

    // 2. Lock hierarchy
    window.dispatchEvent(new CustomEvent('cyco-hierarchy-lock', { detail: { locked: true } }));

    // 3. Detach gizmo
    this.transformGizmo.suspend();

    // 4. Suspend selection
    this.selectionManager.suspend();

    // 5. Show PLAYING badge
    this._showBadge();

    // 6. Start physics (if configured)
    const sceneMeta = this.sceneManager.sceneRegistry.get(this.sceneManager.activeSceneId);
    const physicsMode = sceneMeta?.physicsMode ?? 'none';
    const scene = this.sceneManager.getActiveScene();
    if (physicsMode !== 'none') {
      const gravity = sceneMeta?.gravity  ?? { x: 0, y: -9.81, z: 0 };
      const plane2d = sceneMeta?.plane2d  ?? 'xy';
      await this.physicsManager.init(scene, physicsMode, gravity, plane2d);
    }

    this._startScriptComponents(scene);

    // 7. Notify UI (play button → stop button appearance)
    window.dispatchEvent(new CustomEvent('cyco-runtime-state', { detail: { playing: true } }));

    // Future Phase 16: call onStart() on all Script components
  }

  async _onStop() {
    if (!this.playing) return;
    this.playing = false;

    // 1. Restore scene from snapshot
    if (this._snapshot) {
      try {
        const json     = JSON.parse(this._snapshot);
        const restored = this.sceneManager.deserializeScene(json);
        this.engine.replaceScene(restored);
        // Re-register restored scene in SceneManager
        this.sceneManager.sceneRegistry.set(
          this.sceneManager.activeSceneId,
          {
            ...this.sceneManager.sceneRegistry.get(this.sceneManager.activeSceneId),
            scene: restored,
            dirty: false,
          }
        );
        window.dispatchEvent(new CustomEvent('cyco-scene-switch'));
      } catch (e) {
        console.error('[GameRuntime] Scene restore failed:', e);
      }
      this._snapshot = null;
    }

    // 2. Unlock hierarchy
    window.dispatchEvent(new CustomEvent('cyco-hierarchy-lock', { detail: { locked: false } }));

    // 3. Restore gizmo
    this.transformGizmo.restore();

    // 4. Rebuild selection after scene restore
    this.selectionManager.clearSelection();
    this._restoreSelectionFromIds(this._selectedIds);
    this._selectedIds = [];
    this.selectionManager.resume();

    // 5. Remove PLAYING badge
    this._removeBadge();

    // 6. Notify UI (stop button → play button appearance)
    window.dispatchEvent(new CustomEvent('cyco-runtime-state', { detail: { playing: false } }));

    // 7. Stop scripts
    this._stopScriptComponents(this.sceneManager.getActiveScene());

    // 8. Dispose physics
    this.physicsManager.dispose();
  }

  _startScriptComponents(scene) {
    if (!scene) return;
    this._scriptInstances.clear();
    scene.traverse((obj) => {
      const comps = obj.userData?.physics?.components;
      if (!Array.isArray(comps)) return;
      comps.forEach((comp, index) => {
        if (comp?.type !== 'Script') return;
        const instance = this._createScriptInstance(obj, comp);
        if (!instance) return;
        this._scriptInstances.set(`${obj.uuid}:${index}`, instance);
        try {
          instance.onStart?.(obj, scene, comp);
        } catch (e) {
          console.warn('[GameRuntime] Script onStart failed:', e, comp.path);
        }
      });
    });
  }

  _stopScriptComponents(scene) {
    if (!scene) return;
    for (const instance of this._scriptInstances.values()) {
      try {
        instance.onDestroy?.(instance.object, scene, instance.component);
      } catch (e) {
        console.warn('[GameRuntime] Script onDestroy failed:', e, instance.component.path);
      }
    }
    this._scriptInstances.clear();
  }

  _createScriptInstance(object, comp) {
    if (!comp || comp.type !== 'Script') return null;
    const instance = {
      object,
      component: comp,
      path: comp.path || '',
      onStart: null,
      onDestroy: null,
    };

    if (typeof comp.onStart === 'string' && comp.onStart.trim()) {
      try {
        instance.onStart = new Function('object', 'scene', 'component', comp.onStart);
      } catch (e) {
        console.warn('[GameRuntime] Invalid Script onStart code:', e, comp.path);
      }
    }
    if (typeof comp.onDestroy === 'string' && comp.onDestroy.trim()) {
      try {
        instance.onDestroy = new Function('object', 'scene', 'component', comp.onDestroy);
      } catch (e) {
        console.warn('[GameRuntime] Invalid Script onDestroy code:', e, comp.path);
      }
    }

    if (!instance.onStart && !instance.onDestroy) {
      return null;
    }
    return instance;
  }

  // ─── PLAYING badge ────────────────────────────────────────────────────────

  _restoreSelectionFromIds(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return;
    const scene = this.sceneManager.getActiveScene?.();
    if (!scene) return;

    const idSet = new Set(ids);
    scene.traverse((obj) => {
      if (idSet.has(obj.userData?.cycoId)) {
        this.selectionManager.selectObject(obj);
      }
    });
  }

  _showBadge() {
    if (this._badge) return;
    const badge = document.createElement('div');
    badge.id = 'cyco-playing-badge';
    Object.assign(badge.style, {
      position:    'absolute',
      top:         '8px',
      right:       '8px',
      zIndex:      '200',
      background:  'rgba(0, 180, 60, 0.85)',
      color:       '#ffffff',
      fontFamily:  'monospace',
      fontSize:    '12px',
      fontWeight:  'bold',
      padding:     '3px 10px',
      borderRadius: '4px',
      pointerEvents: 'none',
      letterSpacing: '0.08em',
    });
    badge.textContent = '● PLAYING';
    this._badge = badge;

    const container = this.engine._container;
    if (container) container.appendChild(badge);
  }

  _removeBadge() {
    this._badge?.parentNode?.removeChild(this._badge);
    this._badge = null;
  }

  // ─── Disposal ─────────────────────────────────────────────────────────────

  dispose() {
    window.removeEventListener('cyco-runtime-play', this._onPlay);
    window.removeEventListener('cyco-runtime-stop', this._onStop);
    this._removeBadge();
  }
}
