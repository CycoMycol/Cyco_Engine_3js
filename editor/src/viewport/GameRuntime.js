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

    /** @type {HTMLElement|null} */
    this._badge = null;

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

    // 2. Lock hierarchy
    window.dispatchEvent(new CustomEvent('cyco-hierarchy-lock', { detail: { locked: true } }));

    // 3. Detach gizmo
    this.transformGizmo.suspend();

    // 4. Suspend selection
    this.selectionManager.suspend();

    // 5. Show PLAYING badge
    this._showBadge();

    // 6. Notify UI (play button → stop button appearance)
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
      } catch (e) {
        console.error('[GameRuntime] Scene restore failed:', e);
      }
      this._snapshot = null;
    }

    // 2. Unlock hierarchy
    window.dispatchEvent(new CustomEvent('cyco-hierarchy-lock', { detail: { locked: false } }));

    // 3. Restore gizmo
    this.transformGizmo.restore();

    // 4. Resume selection
    this.selectionManager.resume();

    // 5. Remove PLAYING badge
    this._removeBadge();

    // 6. Notify UI (stop button → play button appearance)
    window.dispatchEvent(new CustomEvent('cyco-runtime-state', { detail: { playing: false } }));

    // Future Phase 16: call onDestroy() on all Script components
  }

  // ─── PLAYING badge ────────────────────────────────────────────────────────

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
