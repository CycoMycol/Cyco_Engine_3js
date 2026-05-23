/**
 * SelectionManager.js
 * Manages object selection state via raycasting (click) and box marquee (drag).
 * Applies/removes selection highlights via OutlinePass only.
 *
 * Depends on: ViewportEngine (injected)
 *
 * Events dispatched:
 *   cyco-select-node   { object, objects, type }  — selection changed
 *   cyco-deselect-all  {}                          — all deselected
 *
 * Events consumed:
 *   cyco-vp-ready      { scene, camera }           — grab scene + camera ref
 *   cyco-renderer-changed { renderer }             — rebuild SelectionHelper
 *   cyco-deselect      {}                          — programmatic deselect
 */

import * as THREE from 'three';
import { SelectionBox }    from 'three/addons/interactive/SelectionBox.js';
import { SelectionHelper } from 'three/addons/interactive/SelectionHelper.js';

export class SelectionManager {
  /**
   * @param {import('./ViewportEngine.js').ViewportEngine} viewportEngine
   */
  constructor(viewportEngine) {
    this.engine = viewportEngine;

    /** @type {Set<THREE.Object3D>} Single source of truth for selected objects. */
    this.selected = new Set();

    /**
     * Objects that cannot be selected via raycasting/marquee.
     * Populated by ViewportEngine (grid, axes), TransformGizmo, ViewHelper.
     * @type {Set<THREE.Object3D>}
     */
    this.nonSelectableSet = new Set();

    /** Whether selection interactions are enabled (disabled during play mode). */
    this._active = true;

    this._raycaster      = new THREE.Raycaster();
    this._pointer        = new THREE.Vector2();
    this._pointerDown    = new THREE.Vector2();
    this._isDragging     = false;
    this._gizmoDragging  = false; // true while TransformControls is actively dragging
    this._dragThreshold  = 5; // pixels

    /** @type {SelectionBox|null} */
    this._selectionBox   = null;
    /** @type {SelectionHelper|null} */
    this._selectionHelper = null;

    /** Currently hovered object (for outline hover highlight) */
    this._hoveredObject = null;

    this._onVpReady          = this._onVpReady.bind(this);
    this._onRendererChanged  = this._onRendererChanged.bind(this);
    this._onPointerDown      = this._onPointerDown.bind(this);
    this._onPointerMove      = this._onPointerMove.bind(this);
    this._onPointerUp        = this._onPointerUp.bind(this);
    this._onPointerLeave     = this._onPointerLeave.bind(this);
    this._onDeselect         = this._onDeselect.bind(this);

    window.addEventListener('cyco-vp-ready',         this._onVpReady);
    window.addEventListener('cyco-renderer-changed', this._onRendererChanged);
    window.addEventListener('cyco-deselect',         this._onDeselect);
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  suspend() { this._active = false; this.clearSelection(); }
  resume()  { this._active = true; }

  /**
   * Add an object to the non-selectable set (e.g. helpers, gizmos).
   * Call this for every object that should be invisible to raycasting.
   * @param {THREE.Object3D} obj
   */
  addNonSelectable(obj) {
    this.nonSelectableSet.add(obj);
  }

  clearSelection() {
    this.selected.clear();
    this._setHoveredObject(null); // also clear hover outline
    window.dispatchEvent(new CustomEvent('cyco-deselect-all'));
  }

  // ─── Initialisation ───────────────────────────────────────────────────────

  _onVpReady(event) {
    const renderer = this.engine.rendererManager?.renderer;
    if (!renderer?.domElement) return;
    this._attachPointerEvents(renderer.domElement);
    this._buildSelectionBox(renderer);

    // Register non-selectables from engine
    if (this.engine.gridHelper)  this.nonSelectableSet.add(this.engine.gridHelper);
    if (this.engine.axesHelper)  this.nonSelectableSet.add(this.engine.axesHelper);
    if (this.engine.viewHelper)  this.nonSelectableSet.add(this.engine.viewHelper);
  }

  _onRendererChanged(event) {
    const { renderer } = event.detail;
    if (!renderer?.domElement) return;
    // Re-attach events to new canvas
    this._detachPointerEvents();
    this._attachPointerEvents(renderer.domElement);
    this._selectionHelper = null; // will be rebuilt
    this._buildSelectionBox(renderer);
  }

  _buildSelectionBox(renderer) {
    const camera = this.engine.camera;
    const scene  = this.engine.scene;
    if (!camera || !scene) return;
    this._selectionBox    = new SelectionBox(camera, scene);
    this._selectionHelper = new SelectionHelper(renderer, 'selectBox');
    this._selectionHelper.enabled = false; // only active during drag
  }

  // ─── Pointer events ───────────────────────────────────────────────────────

  _attachPointerEvents(canvas) {
    this._canvas = canvas;
    canvas.addEventListener('pointerdown',  this._onPointerDown);
    canvas.addEventListener('pointermove',  this._onPointerMove);
    canvas.addEventListener('pointerup',    this._onPointerUp);
    canvas.addEventListener('pointerleave', this._onPointerLeave);
  }

  _detachPointerEvents() {
    if (!this._canvas) return;
    this._canvas.removeEventListener('pointerdown',  this._onPointerDown);
    this._canvas.removeEventListener('pointermove',  this._onPointerMove);
    this._canvas.removeEventListener('pointerup',    this._onPointerUp);
    this._canvas.removeEventListener('pointerleave', this._onPointerLeave);
    this._canvas = null;
  }

  _onPointerDown(event) {
    if (!this._active || event.button !== 0) return; // left button only
    this._pointerDown.set(event.clientX, event.clientY);
    this._isDragging    = false;
    this._gizmoDragging = false; // failsafe reset; normally cleared by dragging-changed(false)
    this._pointerDownOnCanvas = true; // mark that the press originated on the canvas

    const ndc = this._toNDC(event);
    if (this._selectionBox) {
      this._selectionBox.startPoint.set(ndc.x, ndc.y, 0.5);
    }
  }

  _onPointerMove(event) {
    if (!this._active) return;

    if (event.buttons & 1) {
      // Left button held — marquee drag logic
      if (this._gizmoDragging) return;
      const dx = event.clientX - this._pointerDown.x;
      const dy = event.clientY - this._pointerDown.y;
      if (!this._isDragging && Math.hypot(dx, dy) > this._dragThreshold) {
        this._isDragging = true;
        if (this._selectionHelper) this._selectionHelper.enabled = true;
      }
      if (this._isDragging && this._selectionBox) {
        const ndc = this._toNDC(event);
        this._selectionBox.endPoint.set(ndc.x, ndc.y, 0.5);
        this._selectionBox.select(); // live preview
      }
    } else {
      // No button held — hover highlight
      this._updateHover(event);
    }
  }

  _onPointerLeave() {
    this._setHoveredObject(null);
  }

  _updateHover(event) {
    const ndc = this._toNDC(event);
    const camera = this.engine.camera;
    const scene  = this.engine.scene;
    if (!camera || !scene) return;
    this._raycaster.setFromCamera(ndc, camera);
    const hits = this._raycaster
      .intersectObjects(scene.children, true)
      .filter(h => !this._isNonSelectable(h.object));
    this._setHoveredObject(hits.length > 0 ? hits[0].object : null);
  }

  _setHoveredObject(obj) {
    if (this._hoveredObject === obj) return;
    this._hoveredObject = obj;
    // Only show hover outline for objects that are NOT already selected
    const showHover = obj && !this.selected.has(obj) ? obj : null;
    window.dispatchEvent(new CustomEvent('cyco-hover-object', { detail: { object: showHover } }));
  }

  _onPointerUp(event) {
    if (!this._active || event.button !== 0) return;

    // If the press did not start on the canvas (e.g. user dragged a material card
    // from another panel and released here), ignore — do NOT clear selection.
    if (!this._pointerDownOnCanvas) {
      if (this._selectionHelper) this._selectionHelper.enabled = false;
      return;
    }
    this._pointerDownOnCanvas = false;

    if (this._selectionHelper) this._selectionHelper.enabled = false;

    // dragging-changed(true) was received during this drag — gizmo owns it.
    // dragging-changed(false) fires on document pointerup, which is AFTER this
    // canvas handler, so _gizmoDragging is still true here. Skip selection.
    if (this._gizmoDragging) {
      this._isDragging = false;
      return;
    }

    if (this._isDragging) {
      this._isDragging = false;
      this._finishMarquee(event);
    } else {
      this._finishClick(event);
    }
  }

  _finishClick(event) {
    const ndc = this._toNDC(event);
    const camera = this.engine.camera;
    const scene  = this.engine.scene;
    if (!camera || !scene) return;

    this._raycaster.setFromCamera(ndc, camera);
    const hits = this._raycaster
      .intersectObjects(scene.children, true)
      .filter(h => !this._isNonSelectable(h.object));

    if (hits.length > 0) {
      // Multi-select with Shift/Ctrl; otherwise replace selection
      if (!event.shiftKey && !event.ctrlKey) {
        this.clearSelection();
      }
      this._selectObject(hits[0].object);
    } else {
      if (!event.shiftKey && !event.ctrlKey) {
        this.clearSelection();
        // Clicking empty space: show environment properties.
        // Tool mode is intentionally NOT changed — user stays on whatever tool they had.
        window.dispatchEvent(new CustomEvent('cyco-show-properties', { detail: { type: 'environment' } }));
      }
    }
  }

  _finishMarquee(event) {
    const ndc = this._toNDC(event);
    if (!this._selectionBox) return;
    this._selectionBox.endPoint.set(ndc.x, ndc.y, 0.5);
    const objects = this._selectionBox
      .select()
      .filter(obj => !this._isNonSelectable(obj));

    if (!event.shiftKey && !event.ctrlKey) this.clearSelection();
    objects.forEach(obj => this._selectObject(obj));
  }

  // ─── Selection helpers ────────────────────────────────────────────────────

  _selectObject(object) {
    if (this.selected.has(object)) return; // already selected
    // If this object was being hovered, clear the hover outline — selection outline takes over
    if (this._hoveredObject === object) {
      window.dispatchEvent(new CustomEvent('cyco-hover-object', { detail: { object: null } }));
    }
    this.selected.add(object);
    this._dispatchSelection();
  }

  _dispatchSelection() {
    const arr  = [...this.selected];
    const obj  = arr[arr.length - 1] ?? null;
    const type = obj ? this._inferType(obj) : null;
    window.dispatchEvent(new CustomEvent('cyco-select-node', {
      detail: { object: obj, objects: arr, type }
    }));
  }

  _inferType(obj) {
    if (obj.isLight)         return 'light';
    if (obj.isCamera)        return 'camera';
    if (obj.isInstancedMesh) return 'instanced';
    if (obj.isSkinnedMesh)   return 'mesh';
    if (obj.isMesh)          return 'mesh';
    if (obj.isGroup)         return 'group';
    if (obj.isLOD)           return 'lod';
    return 'object';
  }

  _isNonSelectable(obj) {
    if (obj.userData?._isGizmo)  return true;
    if (obj.userData?._isHelper) return true;
    if (this.nonSelectableSet.has(obj)) return true;
    // Also walk up the parent chain — if any ancestor is non-selectable, skip
    let p = obj.parent;
    while (p) {
      if (this.nonSelectableSet.has(p)) return true;
      p = p.parent;
    }
    return false;
  }

  _onDeselect() { this.clearSelection(); }

  // ——— Hover / outline helpers ——————————————————————————————————————

  clearHover() {
    this._setHoveredObject(null);
  }

  // ─── Coordinate helpers ───────────────────────────────────────────────────

  _toNDC(event) {
    const canvas = this._canvas ?? this.engine.rendererManager?.domElement;
    if (!canvas) return this._pointer.set(0, 0);
    const rect = canvas.getBoundingClientRect();
    return this._pointer.set(
      ((event.clientX - rect.left)  / rect.width)  * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
  }

  // ─── Disposal ─────────────────────────────────────────────────────────────

  dispose() {
    this._detachPointerEvents();
    window.removeEventListener('cyco-vp-ready',         this._onVpReady);
    window.removeEventListener('cyco-renderer-changed', this._onRendererChanged);
    window.removeEventListener('cyco-deselect',         this._onDeselect);
    this._selectionHelper = null;
  }
}
