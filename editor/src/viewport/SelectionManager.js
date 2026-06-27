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
 *   cyco-renderer-changed { renderer }             — rebuild marquee overlay
 *   cyco-deselect      {}                          — programmatic deselect
 */

import * as THREE from 'three';

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

    /** @type {THREE.Vector2} Marquee start in NDC. */
    this._marqueeStartNDC  = new THREE.Vector2();
    /** @type {THREE.Vector2} Marquee end in NDC. */
    this._marqueeEndNDC    = new THREE.Vector2();
    /** @type {HTMLDivElement|null} Marquee rectangle overlay (lazy-created). */
    this._marqueeEl        = null;
    /** @type {{x:number,y:number}|null} Marquee origin in viewport (client) coords. */
    this._marqueeStartClient = null;
    /** @type {THREE.Object3D|null} Last hover hit used for hover outline. */
    this._selectionHelper = null; // legacy field; intentionally null

    /** Currently hovered object (for outline hover highlight) */
    this._hoveredObject = null;

    this._onVpReady          = this._onVpReady.bind(this);
    this._onRendererChanged  = this._onRendererChanged.bind(this);
    this._onPointerDown      = this._onPointerDown.bind(this);
    this._onPointerMove      = this._onPointerMove.bind(this);
    this._onPointerUp        = this._onPointerUp.bind(this);
    this._onPointerLeave     = this._onPointerLeave.bind(this);
    this._onDeselect         = this._onDeselect.bind(this);
    this._onSelectNode       = this._onSelectNode.bind(this);

    window.addEventListener('cyco-vp-ready',         this._onVpReady);
    window.addEventListener('cyco-renderer-changed', this._onRendererChanged);
    window.addEventListener('cyco-select-node',      this._onSelectNode);
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
    window.dispatchEvent(new CustomEvent('cyco-selection-changed', {
      detail: { objects: [], primary: null, type: null }
    }));
  }
  selectObject(object) {
    if (!object || this.selected.has(object)) return;
    this._selectObject(object);
  }

  /**
   * Public API — replace the entire selection with the given list of objects.
   * Filters out duplicates and non-selectable objects, then dispatches
   * `cyco-select-node` and `cyco-selection-changed`.
   * @param {THREE.Object3D[]} objects
   */
  setSelectedObjects(objects) {
    const arr = Array.isArray(objects) ? objects : [objects];
    const clean = arr.filter(o =>
      o && !this.nonSelectableSet.has(o) && !o.userData?._isGizmo
    );
    this.clearSelection();
    for (const o of clean) this.selected.add(o);
    this._dispatchSelection();
  }

  /**
   * Public API — append an object to the current selection (Ctrl+click).
   */
  addToSelection(object) {
    if (!object || this.selected.has(object)) return;
    this._selectObject(object);
  }

  /**
   * Public API — remove an object from the current selection.
   */
  removeFromSelection(object) {
    if (!object || !this.selected.has(object)) return;
    this.selected.delete(object);
    this._dispatchSelection();
  }

  /**
   * Public API — toggle an object's membership in the current selection.
   */
  toggleInSelection(object) {
    if (!object) return;
    if (this.selected.has(object)) {
      this.selected.delete(object);
      this._dispatchSelection();
    } else {
      this._selectObject(object);
    }
  }

  /** Read the current selection as an array (snapshot). */
  getSelectedObjects() {
    return [...this.selected];
  }

  /** True if there are 2+ selected objects. */
  isMultiSelection() {
    return this.selected.size > 1;
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
    this._disposeMarquee();
    this._buildSelectionBox(renderer);
  }

  _buildSelectionBox(_renderer) {
    // The marquee is a 2D HUD overlay. We manage a single `<div>` ourselves
    // (lazy-created, appended to the canvas parent, sized/positioned on drag).
    //
    // We do NOT use the three.js `SelectionHelper` here. That helper binds its
    // OWN pointerdown/pointermove/pointerup listeners to the canvas and only
    // triggers `_onSelectStart` (which appends the div) on its own pointerdown.
    // Because we toggle its `enabled` flag AFTER the drag threshold — i.e. AFTER
    // our pointerdown has already fired — the helper's internal `isDown` flag
    // is never set, the div is never appended, and the marquee is never drawn.
    // See https://github.com/mrdoob/three.js/blob/dev/examples/jsm/interactive/SelectionHelper.js
    //
    // Instead we own the lifecycle directly: `_showMarquee()` on drag start,
    // `_updateMarquee()` on every move, `_hideMarquee()` on release.
    //
    // Selection itself still uses the screen-space NDC projection routine
    // (`_selectByScreenRect`) — far more reliable than the three.js SelectionBox
    // frustum test, which only checks each candidate's bounding-sphere centre
    // against a thin cone and routinely misses objects.
    this._selectionHelper = null;
  }

  /**
   * Lazily create the marquee `<div>` and append it to the canvas parent.
   * Returns the existing element if it already exists.
   * @returns {HTMLDivElement}
   */
  _ensureMarqueeEl() {
    if (this._marqueeEl && this._marqueeEl.isConnected) return this._marqueeEl;
    const el = document.createElement('div');
    el.className = 'cyco-marquee-box';
    el.style.display = 'none';
    el.style.pointerEvents = 'none';
    const host = this._canvas?.parentElement ?? document.body;
    host.appendChild(el);
    this._marqueeEl = el;
    return el;
  }

  /**
   * Position the marquee between two client-space points and make it visible.
   *
   * The marquee origin is anchored at the pointer position (the
   * "tip of the mouse pointer"). When the user clicks and drags, the visible
   * rectangle grows in the direction the cursor moves — the cursor is always
   * at the corner of the marquee closest to its current screen position.
   * This matches the convention used by Blender, Figma, Windows Explorer
   * (rubber-band select), and most desktop file managers: the marquee
   * visually "starts at the mouse pointer" and extends in the drag direction.
   *
   * Internally, `min(start, current)` gives the corner opposite to the
   * pointer's motion (the click point), and `|current - start|` gives the
   * dimensions.
   *
   * The marquee `<div>` is appended to the canvas parent (`.ce-viewport-canvas`),
   * which is itself offset from the page origin by the panel's left/top. We
   * therefore subtract the parent rect from each client-space coordinate so
   * the div's `left`/`top` style values are relative to the parent — without
   * this fix the rectangle appears offset by `parentLeft` / `parentTop` from
   * the cursor.
   */
  _showMarquee(startClient, currentClient) {
    const el = this._ensureMarqueeEl();
    // Translate client-space coordinates into the marquee parent's coordinate
    // system so the div sits exactly under the pointer.
    const parent = el.parentElement;
    let offsetX = 0, offsetY = 0;
    if (parent) {
      const pr = parent.getBoundingClientRect();
      offsetX = pr.left;
      offsetY = pr.top;
    }
    const aX = startClient.x - offsetX;
    const aY = startClient.y - offsetY;
    const bX = currentClient.x - offsetX;
    const bY = currentClient.y - offsetY;
    const left   = Math.min(aX, bX);
    const top    = Math.min(aY, bY);
    const width  = Math.abs(bX - aX);
    const height = Math.abs(bY - aY);
    el.style.left   = left   + 'px';
    el.style.top    = top    + 'px';
    el.style.width  = width  + 'px';
    el.style.height = height + 'px';
    el.style.display = 'block';
  }

  _updateMarquee(currentClient) {
    if (!this._marqueeStartClient) return;
    this._showMarquee(this._marqueeStartClient, currentClient);
  }

  _hideMarquee() {
    if (!this._marqueeEl) return;
    this._marqueeEl.style.display = 'none';
  }

  _disposeMarquee() {
    if (this._marqueeEl?.parentElement) this._marqueeEl.parentElement.removeChild(this._marqueeEl);
    this._marqueeEl = null;
  }

  /**
   * HUD-style marquee selection. Walks the scene, projects each candidate's
   * world-space centre to NDC, and keeps the ones whose NDC X/Y falls inside
   * the marquee rectangle. Returns a deduplicated list of selectable
   * ancestors (same promotion rules as click selection).
   * @param {THREE.Vector2} startNDC
   * @param {THREE.Vector2} endNDC
   * @returns {THREE.Object3D[]}
   */
  _selectByScreenRect(startNDC, endNDC) {
    const camera = this.engine.camera;
    const scene  = this.engine.scene;
    if (!camera || !scene) return [];
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();

    const minX = Math.min(startNDC.x, endNDC.x);
    const maxX = Math.max(startNDC.x, endNDC.x);
    const minY = Math.min(startNDC.y, endNDC.y);
    const maxY = Math.max(startNDC.y, endNDC.y);

    const _wp   = new THREE.Vector3();
    const _ndc  = new THREE.Vector3();
    const _sel  = [];
    let _dbgScanned = 0, _dbgHit = 0, _dbgInRect = 0;

    scene.traverse(obj => {
      _dbgScanned++;
      if (this._isNonSelectable(obj)) return;
      // Only meshes / lines / points / instanced meshes have a meaningful
      // world position to project. Groups/empties are kept via the ancestor
      // walk below.
      if (!(obj.isMesh || obj.isLine || obj.isPoints || obj.isInstancedMesh || obj.isBatchedMesh)) return;
      // Skip anything that has no visible geometry.
      if (obj.isMesh && obj.geometry && !obj.geometry.boundingSphere) {
        try { obj.geometry.computeBoundingSphere(); } catch (e) { /* ignore */ }
      }
      obj.getWorldPosition(_wp);
      _ndc.copy(_wp).project(camera);
      _dbgHit++;
      // Skip objects behind the camera (NDC z > 1) or out of the NDC range.
      if (_ndc.z < -1 || _ndc.z > 1) return;
      if (_ndc.x < minX || _ndc.x > maxX) return;
      if (_ndc.y < minY || _ndc.y > maxY) return;
      _dbgInRect++;
      const ancestor = this._selectableAncestor(obj);
      if (ancestor && ancestor !== scene) _sel.push(ancestor);
    });
    this._lastMarqueeDebug = { scanned: _dbgScanned, hit: _dbgHit, inRect: _dbgInRect, picked: _sel.length };

    // Deduplicate (a child mesh inside a group would otherwise push the
    // group ancestor twice when the group has multiple children).
    const seen = new Set();
    return _sel.filter(o => {
      if (!o || seen.has(o.uuid)) return false;
      seen.add(o.uuid);
      return true;
    });
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
    if (window.__cyco && window.__cyco._suppressSelectionManagerClick) return;
    this._pointerDown.set(event.clientX, event.clientY);
    this._isDragging    = false;
    this._gizmoDragging = false; // failsafe reset; normally cleared by dragging-changed(false)
    this._pointerDownOnCanvas = true; // mark that the press originated on the canvas

    const ndc = this._toNDC(event);
    this._marqueeStartNDC.set(ndc.x, ndc.y);
    this._marqueeEndNDC.set(ndc.x, ndc.y);
    this._marqueeStartClient = { x: event.clientX, y: event.clientY };

    // Decide if the press landed on an existing gizmo handle / box. If so the
    // gizmo owns the drag and OrbitControls + marquee should both stay out of
    // the way. Otherwise (click on empty space or on an object) the marquee
    // owns the press, so we pre-empt OrbitControls BEFORE it gets a chance to
    // rotate the camera — the previous "wait for drag threshold" approach let
    // OrbitControls orbit a few pixels before we cut it off, which produced
    // visible camera jitter at the start of every marquee.
    const hitGizmo = this._hitGizmoAt(event);
    if (!hitGizmo && this.engine.controls) {
      this.engine.controls.enabled = false;
    }
  }

  _onPointerMove(event) {
    if (!this._active) return;

    if (event.buttons & 1) {
      // Left button held — gizmo owns its own drag, so skip
      if (this._gizmoDragging) return;
      // Marquee now owns the press (orbit was already disabled in pointerdown
      // for non-gizmo hits). Promote the drag to "active marquee" once the
      // pointer moves past the drag threshold.
      const dx = event.clientX - this._pointerDown.x;
      const dy = event.clientY - this._pointerDown.y;
      if (!this._isDragging && Math.hypot(dx, dy) > this._dragThreshold) {
        this._isDragging = true;
        // Show the marquee rectangle NOW — the drag is real, draw it from the
        // pointerdown origin to the current pointer position.
        if (this._marqueeStartClient) {
          this._showMarquee(this._marqueeStartClient, { x: event.clientX, y: event.clientY });
        }
      }
      if (this._isDragging) {
        const ndc = this._toNDC(event);
        this._marqueeEndNDC.set(ndc.x, ndc.y);
        if (this._marqueeStartClient) {
          this._updateMarquee({ x: event.clientX, y: event.clientY });
        }
      }
    } else {
      // No button held — hover highlight
      this._updateHover(event);
    }
  }

  _onPointerLeave() {
    // Don't hide the marquee mid-drag — the pointer can leave the canvas while
    // the user is still dragging (e.g. moving outside the dockview panel) and
    // we still want the rectangle visible until pointerup. We do clear hover.
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
    this._setHoveredObject(hits.length > 0 ? this._selectableAncestor(hits[0].object) : null);
  }

  /**
   * Walk up the parent chain from a hit object to the nearest object that is
   * itself selectable AND a "container-like" Object3D (Group / Empty / LOD /
   * bone / prefab instance root). If none found, return the hit itself.
   *
   * This makes clicking a child mesh inside a group or empty select the
   * container itself (so the gizmo and properties panel target the group the
   * user actually clicked on) while still letting direct clicks on a mesh
   * select the mesh.
   */
  _selectableAncestor(obj) {
    if (!obj) return obj;
    let cur = obj;
    while (cur && cur.parent) {
      const p = cur.parent;
      if (p.isScene) break;
      if (p.isGroup || p.isLOD || p.isBone || p.type === 'Object3D'
          || (p.userData && (p.userData.cycoPrefabSource || p.userData.cycoEmptyRoot))) {
        // Stop here — p is a selectable container, cur was its child.
        return cur;
      }
      cur = p;
    }
    return obj;
  }

  /**
   * Returns true when the pointerdown event landed on the gizmo helper or
   * box-edit helper. We use this to decide whether to pre-empt OrbitControls
   * — if the user is grabbing a gizmo handle, the gizmo owns the drag and
   * orbit must NOT be disabled.
   */
  _hitGizmoAt(event) {
    const tg = window.__cyco?.transformGizmo;
    if (!tg) return false;
    // The transform gizmo exposes its main Object3D via `_gizmo` and its
    // box-edit helper via `_boxGroup`. Both have child meshes we can hit.
    const helpers = [];
    if (tg._gizmo)    helpers.push(tg._gizmo);
    if (tg._boxGroup) helpers.push(tg._boxGroup);
    if (helpers.length === 0) return false;

    const ndc = this._toNDC(event);
    const camera = this.engine.camera;
    if (!camera) return false;
    this._raycaster.setFromCamera(ndc, camera);
    const hits = this._raycaster.intersectObjects(helpers, true);
    return hits.length > 0;
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

    // Always hide the marquee on any pointerup; selection outcome is decided
    // below. This catches the cases where we early-return without finishing
    // the marquee as well.
    const wasDragging = this._isDragging;
    this._hideMarquee();
    this._marqueeStartClient = null;

    // If the press did not start on the canvas (e.g. user dragged a material card
    // from another panel and released here), ignore — do NOT clear selection.
    if (!this._pointerDownOnCanvas) {
      return;
    }
    // If another system (e.g. PhysicsEditHelper) already handled selection on
    // pointerdown, it sets a suppression flag so we must skip default click handling.
    if (window.__cyco && window.__cyco._suppressSelectionManagerClick) {
      try { delete window.__cyco._suppressSelectionManagerClick; } catch (err) {}
      this._pointerDownOnCanvas = false;
      this._isDragging = false;
      return;
    }
    this._pointerDownOnCanvas = false;

    // dragging-changed(true) was received during this drag — gizmo owns it.
    // dragging-changed(false) fires on document pointerup, which is AFTER this
    // canvas handler, so _gizmoDragging is still true here. Skip selection.
    if (this._gizmoDragging) {
      this._isDragging = false;
      // Gizmo manages its own orbit on/off via dragging-changed; nothing to do.
      return;
    }

    if (this._isDragging) {
      this._isDragging = false;
      this._finishMarquee(event);
    } else {
      this._finishClick(event);
      // Safety net — if a user only just-tapped the canvas (no drag, no click
      // hit), make sure orbit is not left disabled.
      if (this.engine.controls) this.engine.controls.enabled = true;
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

    const additive = !!(event.ctrlKey || event.metaKey || event.shiftKey);

    if (hits.length > 0) {
      // Promote mesh/light hits to their containing Group/Empty so the gizmo
      // and properties panel operate on the container the user actually
      // clicked on. This also makes the OUTLINE highlight the container.
      const hitObj = this._selectableAncestor(hits[0].object);
      if (additive) {
        // Toggle: if already selected, deselect; otherwise add
        if (this.selected.has(hitObj)) {
          this.selected.delete(hitObj);
          this._dispatchSelection();
        } else {
          this._selectObject(hitObj);
        }
      } else {
        // Plain click on an object that's NOT in the current selection → replace
        // Plain click on an object that IS in the current selection → keep
        // (lets the user click on a selected sub-object without losing the
        // multi-selection).
        if (!this.selected.has(hitObj)) {
          this.clearSelection();
          this._selectObject(hitObj);
        }
      }
    } else {
      // Clicked empty space: clear unless additive
      if (!additive) {
        this.clearSelection();
        // Clicking empty space: show environment properties.
        // Tool mode is intentionally NOT changed — user stays on whatever tool they had.
        window.dispatchEvent(new CustomEvent('cyco-show-properties', { detail: { type: 'environment' } }));
      }
    }
    // Always restore orbit after a left-click — pointerdown disabled it, and
    // we want it back whether the click was a selection hit or empty space.
    if (this.engine.controls) this.engine.controls.enabled = true;
  }

  _finishMarquee(event) {
    // 2D HUD-style selection: project each candidate's world centre to NDC
    // and check whether it falls inside the marquee rectangle.
    const ndc = this._toNDC(event);
    this._marqueeEndNDC.set(ndc.x, ndc.y);

    const objects = this._selectByScreenRect(this._marqueeStartNDC, this._marqueeEndNDC);
    const additive = !!(event.ctrlKey || event.metaKey || event.shiftKey);

    if (!additive) {
      this.setSelectedObjects(objects);
    } else {
      let added = false;
      for (const obj of objects) {
        if (!this.selected.has(obj)) {
          this.selected.add(obj);
          added = true;
        }
      }
      if (added) this._dispatchSelection();
    }

    // Re-enable orbit (disabled at pointerdown while the user was
    // marquee-dragging).
    if (this.engine.controls) this.engine.controls.enabled = true;
  }

  // ─── Selection helpers ────────────────────────────────────────────────────

  _selectObject(object) {
    if (this.selected.has(object)) return; // already selected
    // Selection should always clear hover so stale hover outlines cannot linger
    // behind a moved object.
    this._setHoveredObject(null);
    this.selected.add(object);
    this._dispatchSelection();
  }

  _dispatchSelection() {
    const arr  = [...this.selected];
    // Primary = the FIRST object the user selected (the "anchor" object
    // whose properties / gizmo / outline match the single-select prefs).
    // This matches the gizmo's pivot-indicator convention (see
    // TransformGizmo._updatePivotIndicators which skips index 0) and
    // gives a consistent user-facing rule: the FIRST thing you click
    // is the one that "owns" the single-select settings — whether you
    // end up selecting one, three, or fifty objects.
    const obj  = arr[0] ?? null;
    const type = obj ? this._inferType(obj) : null;
    // Dispatch both the legacy single-object event (for the gizmo, properties
    // panel, hierarchy, etc.) and a multi-aware one.
    window.dispatchEvent(new CustomEvent('cyco-select-node', {
      detail: { object: obj, objects: arr, type }
    }));
    window.dispatchEvent(new CustomEvent('cyco-selection-changed', {
      detail: { objects: arr, primary: obj, type }
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
    if (!obj) return true;
    if (obj.userData?._isGizmo)  return true;
    if (obj.userData?._isHelper) return true;
    if (obj.userData?._editorOnly) return true;
    if (obj.type === 'GridHelper' || obj.type === 'AxesHelper') return true;
    if (obj.name === 'Main Grid') return true;
    if (this.nonSelectableSet.has(obj)) return true;
    // Also walk up the parent chain — if any ancestor is non-selectable, skip.
    // This is essential: TransformControls / Box Gizmo internals (AxisShaft,
    // AxisTip, gizmo faces, etc.) have no `_isGizmo` flag of their own, but
    // their parent group DOES.  Without this ancestor check, marquee
    // selection sweeps up these gizmo internals and the outline rebuild
    // then throws "Cannot read properties of null (reading 'getAttribute')"
    // from Box3.setFromObject on a geometry-less helper mesh.
    let p = obj.parent;
    while (p) {
      if (this.nonSelectableSet.has(p)) return true;
      if (p.userData?._isGizmo)      return true;
      if (p.userData?._isHelper)     return true;
      if (p.userData?._editorOnly)   return true;
      if (p.type === 'GridHelper' || p.type === 'AxesHelper') return true;
      if (p.name === 'Main Grid') return true;
      p = p.parent;
    }
    return false;
  }

  _onDeselect() { this.clearSelection(); }

  _onSelectNode(event) {
    const objects = Array.isArray(event.detail?.objects)
      ? event.detail.objects.filter(Boolean)
      : (event.detail?.object ? [event.detail.object] : []);

    this.selected.clear();
    for (const obj of objects) {
      this.selected.add(obj);
    }
  }

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
    window.removeEventListener('cyco-select-node',      this._onSelectNode);
    window.removeEventListener('cyco-deselect',         this._onDeselect);
    this._disposeMarquee();
    this._selectionHelper = null;
  }
}
