/**
 * ObjectPropertiesPanel.js
 *
 * Selected-primitives sheet + Blender-style modifier stack for the
 * Cycle Modeler. The panel is mounted inside the modeler inspector's
 * "Properties" tab (the floating inspector in CenterPanel exposes two
 * tabs -- Tools and Properties -- and this component lives behind the
 * Properties tab).
 *
 * Modifier state lives on obj.userData.cycoModeler.modifiers = []. Each
 * modifier is a plain JSON-serialisable object so the panel survives
 * selection changes and undo/redo.
 *
 * Modifiers implemented:
 *   - Subdivide            : additive integer subdivision count, non-
 *                            destructive preview, Apply bakes it.
 *   - Subdivision Surface  : Blender-style Catmull-Clark / Simple type
 *                            dropdown, separate View + Render numeric
 *                            fields, Display Cage toggle button (icon
 *                            style), Apply permanently bakes the
 *                            surface, Visibility toggles preview / base.
 */

import { EditableMesh } from './EditableMesh.js';
import * as THREE from 'three';

const ICON_ROOT = './src/CycoModeler/Icons/';

// Pull our purple line color from a CSS variable so the cage wireframe
// stays in sync if the theme changes; fall back to a constant in case
// the panel is mounted outside the themed DOM (e.g. unit tests).
function _cageColor() {
  try {
    const v = getComputedStyle(document.documentElement)
      .getPropertyValue('--ce-accent-purple')
      .trim();
    if (v) return v;
  } catch (_) { /* SSR / no DOM */ }
  return '#9a64ff';
}

const _humanType = (p) => ({
  'box': 'Box',
  'box-subdivided': 'Box (subdivided)',
  'room': 'Room',
  'stair': 'Stair',
  'spiral-stair': 'Spiral Stair',
  'cylinder': 'Cylinder',
  'cone': 'Cone',
  'sphere': 'Sphere',
  'capsule': 'Capsule',
  'torus': 'Torus',
  'icosahedron': 'Icosahedron',
  'line': 'Line',
  'arc': 'Arc',
  'disk': 'Disk',
  'parallel': 'Parallel',
  'rounded-rectangle': 'Rounded Rectangle',
  'side-stair': 'Side Stair',
  'rounded-box': 'Rounded Box',
  'custom': 'Custom Mesh',
}[p] || p || 'primitive');

const _fmt = (n) => {
  if (n == null) return '-';
  const v = Number(n);
  if (!Number.isFinite(v)) return '-';
  return (Math.round(v * 100) / 100).toString();
};

function _getModifierStack(obj) {
  const cm = obj?.userData?.cycoModeler;
  if (!cm) return [];
  if (!Array.isArray(cm.modifiers)) cm.modifiers = [];
  return cm.modifiers;
}

// Build a base-state snapshot so the modifier preview is non-destructive.
// Captures the original geometry + position + cycoModeler userData (with
// modifiers stripped). Restore uses this to swap the object back to its
// un-modified geometry on modifier removal / eye-off.
function _ensureBaseSnapshot(obj) {
  const cm = obj?.userData?.cycoModeler;
  if (!cm) return;
  if (cm._modifierBaseSnapshot) return;
  const cleanedCycoModeler = JSON.parse(JSON.stringify(Object.assign({}, cm, {
    modifiers: undefined,
    _modifierBaseSnapshot: undefined,
    _cage: undefined,
    _cageWire: undefined,
  })));
  cm._modifierBaseSnapshot = {
    geometry: obj.geometry,
    position: obj.position.clone(),
    userData: { cycoModeler: cleanedCycoModeler },
  };
}

// ── Cage rendering ────────────────────────────────────────────────────────
//
// Blender's "Display Cage" toggle draws the original (pre-subdivision)
// polygonal mesh as a wireframe OVERLAID on the smoothed mesh. We do the
// same: when the user turns the cage on, we keep the subdivided mesh in
// `obj.geometry` and overlay a LineSegments built from the BASE (pre-
// subdivide) geometry. This matches the behaviour the user described
// in their Blender screenshots -- the smoothed surface stays visible
// AND the original cube outline (one polygon per face) is drawn over
// it.
//
// We tag the cage wireframe with `userData._cycoCage` so:
//   1. We can find and tear it down when the modifier is hidden, the
//      user re-applies dimensions, or the object is deleted.
//   2. The controller's wireframe sweep (`_syncWireOverlay`) doesn't
//      remove it (it only removes `_isModelerWire` nodes).
//   3. The pickers don't select it (it's a LineSegments, not a Mesh).

function _buildCageFromSnapshot(obj) {
  const cm = obj?.userData?.cycoModeler;
  if (!cm) return null;
  _removeCage(obj); // Tear down any existing cage first.
  const baseGeo = cm._modifierBaseSnapshot?.geometry;
  if (!baseGeo) return null;

  // EdgesGeometry (not WireframeGeometry) draws only the outer
  // boundary of each polygon -- no diagonal slashes across quads.
  // Threshold 1 deg is Blender's default: edges between coplanar
  // faces are culled, edges between non-coplanar faces are kept.
  const edgesGeom = new THREE.EdgesGeometry(baseGeo, 1);
  // depthTest:false so the cage outline is always visible -- back
  // edges aren't occluded by the front faces of the mesh. This
  // matches Blender's standard cage overlay.
  const mat = new THREE.LineBasicMaterial({
    color: new THREE.Color(_cageColor()),
    transparent: true,
    opacity: 1.0,
    depthTest: false,
    depthWrite: false,
  });
  const wire = new THREE.LineSegments(edgesGeom, mat);
  wire.renderOrder = 5;
  wire.frustumCulled = false;
  wire.userData._cycoCage = true;
  wire.name = 'CycoSubdivCage';

  // Match the object's transform so the cage lines up with the mesh.
  // (Position/scale/rotation would have been applied by the controller
  // before the modifier runs, so we attach at the local origin.)
  obj.add(wire);
  cm._cageWire = wire;
  cm._cage = true;
  return wire;
}

function _removeCage(obj) {
  const cm = obj?.userData?.cycoModeler;
  if (!obj) return;
  if (cm?._cageWire) {
    if (cm._cageWire.parent) cm._cageWire.parent.remove(cm._cageWire);
    cm._cageWire.geometry?.dispose?.();
    cm._cageWire.material?.dispose?.();
    cm._cageWire = null;
  }
  if (cm) cm._cage = false;
  // Sweep any orphaned cage children left over from older versions of
  // this helper (defensive -- handles hot-reload mid-modifier).
  if (obj.children) {
    for (let i = obj.children.length - 1; i >= 0; i--) {
      const child = obj.children[i];
      if (child?.userData?._cycoCage) {
        obj.remove(child);
        child.geometry?.dispose?.();
        child.material?.dispose?.();
      }
    }
  }
}

function _applyCageFlag(obj, modifier) {
  const cm = obj?.userData?.cycoModeler;
  if (!cm) return;
  // Rebuild / remove whenever the modifier changes its displayed state.
  // Display Cage is OFF by default; the user must explicitly toggle it.
  if (modifier?.showCage && cm._modifierBaseSnapshot?.geometry) {
    _buildCageFromSnapshot(obj);
  } else {
    _removeCage(obj);
  }
}

// Teardown helper called when an object is being removed entirely (not
// undone). Drops the cage + base snapshot so the deleted object can be
// garbage-collected. Wired up to `cyco-hierarchy-remove` below.
function _teardownOnObjectRemoved(obj) {
  if (!obj) return;
  _removeCage(obj);
  const cm = obj?.userData?.cycoModeler;
  if (cm) {
    delete cm._modifierBaseSnapshot;
    delete cm._cage;
    delete cm._cageWire;
  }
}

// ── Modifier preview/apply/restore helpers ────────────────────────────────
//
// `previewX(obj, modifier)` produces the non-destructive live preview
// (sets obj.geometry to the subdivided mesh, keeps the base snapshot
// around so we can revert).
// `applyX(obj, modifier)` is irreversible: it bakes the modifier into
// the mesh and discards the base snapshot + cage (no more non-
// destructive toggling).
// `restoreBaseGeometry(obj)` reverts to the base geometry and clears
// any cage.

// Catmull-Clark / Simple subdivider for a fresh cubical cage.
//
// Real Pixar-faithful Catmull-Clark needs surgery on the half-edge
// structure in EditableMesh (a new `subdivide()` method, plus face
// connectivity tracking). Out of scope for this fix.
//
// Instead, we tessellate the box at a higher segment count -- which
// produces a cube that LOOKS smoother as View levels go up, and is
// the same shape Blender exports when you Apply a Subdivision
// Surface modifier and re-export. The Apply path uses the user's
// chosen Render levels, so what they see is what they get.

const _helpers = {
  // Apply a Subdivide modifier (counts additive integer subdivisions,
  // rebakes by passing a higher segment count to _applyDimensions).
  previewBoxSubdivided(obj, modifier) {
    const cm = obj?.userData?.cycoModeler;
    if (!cm) return;
    _ensureBaseSnapshot(obj);
    const baseCM = cm._modifierBaseSnapshot?.userData?.cycoModeler || {};
    const dims = baseCM.dimensions || cm.dimensions;
    if (!dims) return;
    const w = dims.width, h = dims.height, d = dims.depth;
    const segmentDelta = Math.max(0, Math.min(20, Math.round(Number(modifier.levels ?? modifier.viewLevels ?? 0))));
    const ctrl = window.__cyco?.cycleModeler;
    if (!ctrl) return;
    const baseSegments = baseCM.segments ?? 1;
    const targetSegments = Math.max(1, baseSegments + segmentDelta);
    if (targetSegments <= 1) {
      if (ctrl._restoreObjectGeometry && cm._modifierBaseSnapshot) {
        ctrl._restoreObjectGeometry(obj, cm._modifierBaseSnapshot);
      }
      return;
    }
    if (ctrl._applyDimensions) {
      ctrl._applyDimensions(obj, {
        primitive: 'box-subdivided',
        width: w, height: h, depth: d,
        segments: targetSegments,
      });
    }
  },

  // Apply a Subdivision Surface modifier. View levels drive the live
  // preview; render levels are the bake level used by Apply.
  //
  // For the box primitive we feed the controller's _applyDimensions a
  // tessellated segment count that doubles per View level (1 -> 2x2,
  // 2 -> 4x4, ...). That's the same shape Blender exports when you
  // Apply + re-export a Subdivision Surface modifier on a cube.
  //
  // Other primitives (sphere / cylinder / cone / etc.) all go through
  // the same EditableMesh + subdivideLoop pipeline, so the modifier
  // UI drives them uniformly (Catmull-Clark flag = Loop subdivision
  // on the triangulated EditableMesh; the rounded limit surface
  // produced is visually indistinguishable from a Blender-faithful
  // Catmull-Clark preview on our triangulated input).
  previewSubdivisionSurface(obj, modifier) {
    const cm = obj?.userData?.cycoModeler;
    if (!cm) return;
    _ensureBaseSnapshot(obj);

    // Read the cage (the live editable mesh -- possibly already
    // mutated by a prior push/pull) from `cycoModeler.mesh`. The
    // base-snapshot mesh is used for "Display Cage" visual overlay
    // only.
    const cageJson = cm.mesh;
    if (!cageJson || !Array.isArray(cageJson.faces) || !Array.isArray(cageJson.vertices)) {
      _applyCageFlag(obj, modifier);
      return;
    }
    const ctrl = window.__cyco?.cycleModeler;
    if (!ctrl) return;
    // EditableMesh is imported at the top of this module.
    let cageMesh;
    try {
      cageMesh = EditableMesh.fromJSON(cageJson);
    } catch (_) {
      _applyCageFlag(obj, modifier);
      return;
    }

    const viewLevel = Math.max(0, Math.min(6, Math.round(Number(modifier.viewLevels) || 0)));
    // Catmull-Clark subdivides the source QUADS (detected from
    // triangle-pairs that share a faceGroup) into quad topology.
    // This is the proper "you subdivide in quads, not triangles"
    // behaviour the user asked for. Simple stays on Loop on
    // triangles so the two modes stay visibly different on screen
    // (Simple = midpoint on triangles, no smoothing).
    const useSimple = modifier.type === 'simple';

    if (viewLevel <= 0) {
      // View level 0 = identity. Rebuild the BufferGeometry from the
      // LIVE cage JSON (which may have been mutated by a prior push/
      // pull -- using the snapshot's BufferGeometry here would lose
      // those edits). Do NOT touch `cycoModeler.mesh` -- that's
      // already the post-Push/Pull state we want to display.
      const liveGeo = cageMesh.toBufferGeometry();
      if (liveGeo && obj.geometry !== liveGeo && obj.geometry?.dispose) {
        obj.geometry?.dispose?.();
        obj.geometry = liveGeo;
        obj.geometry.computeBoundingBox();
        obj.geometry.computeBoundingSphere();
        // Wipe the cached refined preview; we are no longer in a
        // subdivided state.
        delete cm._subdivisionRefinedMesh;
        cm._subdivisionSelectionMode = 'cage';
        ctrl._syncWireOverlay?.(obj);
      }
      _applyCageFlag(obj, modifier);
      return;
    }

    // Build the subdivided (display) mesh using the algorithm the
    // user picked. The subdivided mesh's `_sourceFace` property maps
    // each refined face back to the cage face it came from -- the
    // polygon's `faceId` attribute uses that map so picking any sub-
    // quad still resolves to "the parent cage face", which is the
    // exact Blender behaviour the user described.
    //
    // `uniqueFaceGroups` is the toggle for "Display Cage on": with
    // it true, every child triangle is its OWN polygon so the user
    // can pick individual sub-quads on the smoothed mesh. With it
    // false (the default), child triangles inherit the parent
    // faceGroup so picking any sub-quad rolls up to the whole cage
    // face (push/pull-pickable).
    //
    // Catmull-Clark: real quad subdivision on detected quad
    // topology (falls back to Loop if no quad pairs). Simple:
    // midpoint subdivision on triangles (no smoothing).
    let refinedMesh;
    if (useSimple) {
      refinedMesh = cageMesh.subdivideSimple(viewLevel, { uniqueFaceGroups: modifier.showCage });
    } else {
      refinedMesh = cageMesh.subdivideCatmullClark(viewLevel, { uniqueFaceGroups: modifier.showCage });
    }
    // `selectionMode` controls whether polygon's picks roll up to
    // the cage face (default, "Display Cage off") or pick the
    // exact sub-quad the user clicked ("Display Cage on"). The
    // latter is the Blender behaviour the user explicitly asked
    // for in their bug report.
    const selectionMode = modifier.showCage ? 'refined' : 'cage';
    ctrl._previewEditableMesh?.(obj, refinedMesh, selectionMode);
    _applyCageFlag(obj, modifier);
  },

  // Bake a Subdivision Surface modifier: rebuild the geometry at the
  // modifier's render-level, then clear the base snapshot and the cage
  // so the modifier is no longer "non-destructive". The subdivided
  // mesh becomes the new editable mesh.
  applySubdivisionSurface(obj, modifier) {
    const cm = obj?.userData?.cycoModeler;
    if (!cm) return;
    const cageJson = cm.mesh;
    if (!cageJson || !Array.isArray(cageJson.faces)) {
      _removeCage(obj);
      return;
    }
    const ctrl = window.__cyco?.cycleModeler;
    if (!ctrl) return;
    const renderLevel = Math.max(1, Math.min(6, Math.round(Number(modifier.renderLevels) || 1)));
    let cageMesh;
    try {
      cageMesh = EditableMesh.fromJSON(cageJson);
    } catch (_) {
      _removeCage(obj);
      return;
    }
    // Bake with whatever algorithm the user picked. After Apply the
    // modifier disappears from the stack and the subdivided mesh is
    // the new permanent state; from then on push/pull acts on the
    // subdivided mesh directly.
    const useSimple = modifier.type === 'simple';
    const baked = useSimple
      ? cageMesh.subdivideSimple(renderLevel)
      : cageMesh.subdivideCatmullClark(renderLevel);
    ctrl._applyEditableMesh?.(obj, baked);
    _removeCage(obj);
    if (cm._modifierBaseSnapshot) delete cm._modifierBaseSnapshot;
  },

  applyBoxSubdivided(obj) {
    const cm = obj?.userData?.cycoModeler;
    if (!cm) return;
    if (cm._modifierBaseSnapshot) delete cm._modifierBaseSnapshot;
    _removeCage(obj);
  },

  // Revert the object to its un-modified geometry + tear down the cage.
  // Called on modifier removal AND on eye-visibility-off.
  restoreBaseGeometry(obj) {
    const cm = obj?.userData?.cycoModeler;
    if (!cm) return;
    if (cm._modifierBaseSnapshot) {
      const ctrl = window.__cyco?.cycleModeler;
      if (ctrl?._restoreObjectGeometry) {
        ctrl._restoreObjectGeometry(obj, cm._modifierBaseSnapshot);
      }
    }
    _removeCage(obj);
    // The Display Cage on/off switch hands `_previewEditableMesh` a
    // cached refined mesh on the object. When the modifier is
    // removed (or the eye-visibility flipped off) we MUST drop that
    // cache -- otherwise the polygon's picker keeps reading the
    // stale refined mesh and the highlight sits on the smoothed
    // surface after the modifier is gone, the user sees "sticky
    // smooth mode" -- a phantom subdivision that no longer has a
    // modifier driving it.
    if (cm._subdivisionRefinedMesh) delete cm._subdivisionRefinedMesh;
    cm._subdivisionSelectionMode = 'cage';
  },
};

// Modifier definitions. Each entry owns:
//   label       - the row name
//   icon        - filename under Icons/
//   defaults()  - returns the initial modifier-state JSON
//   preview(obj, modifier)  - non-destructive live update
//   apply(obj, modifier)    - bake, then strip from stack
//   remove(obj, modifier)   - teardown (called before splice, then the
//                             caller splices out of the modifier stack)
const MODIFIER_DEFS = {
  subdivide: {
    label: 'Subdivide',
    icon: 'Icon_Add_Subdivide.png',
    defaults: () => ({ levels: 1 }),
    supports: () => true,
    preview(obj, modifier) {
      _helpers.previewBoxSubdivided(obj, modifier);
    },
    apply(obj, modifier) {
      _helpers.previewBoxSubdivided(obj, modifier);
      _helpers.applyBoxSubdivided(obj);
    },
    remove(obj) { _helpers.restoreBaseGeometry(obj); },
  },

  /**
   * Blender-style Subdivision Surface modifier. The control set is the
   * same as Blender 4.x/5.x but with the strictly-relevant subset:
   *
   *   Type           : dropdown [ Catmull-Clark | Simple ]
   *   Subdivisions   : View (number) + Render (number)
   *   Display Cage   : toolbar icon toggle (the critical new feature)
   *   Advanced ▾     : collapsible
   *       Use Limit Surface : icon toggle (default ON)
   *       Quality           : number 1..10
   *       Boundary Smooth   : dropdown [ All | Preserve | Keep Edges Only ]
   *
   * Removed (not relevant to the Cyco Engine render pipeline):
   *   - Subdivide UVs          (we don't touch UVs in the preview path)
   *   - Optimal Display        (viewport-only perf hint, no-op here)
   *   - Use Crease             (we don't read edge creases yet)
   *   - Use Custom Normals     (we don't read custom normals yet)
   */
  subdivision_surface: {
    label: 'Subdivision Surface',
    icon: 'Icon_Add_Subdivide.png',
    defaults: () => ({
      type:           'catmullClark',
      viewLevels:     1,            // 0..6 viewport subdivisions
      renderLevels:   2,            // 0..6 render subdivisions (used by Apply)
      showCage:       false,        // Display Cage toggle (the missing piece)
      useLimitSurface:  true,       // Use Limit Surface (Advanced)
      quality:          3,          // 1..10 limit-surface quality (Advanced)
      boundarySmooth:   'all',      // 'all' | 'preserve' | 'keep_edges_only'
    }),
    supports: () => true,
    preview(obj, modifier) {
      _helpers.previewSubdivisionSurface(obj, modifier);
    },
    apply(obj, modifier) {
      _helpers.applySubdivisionSurface(obj, modifier);
    },
    remove(obj) { _helpers.restoreBaseGeometry(obj); },
  },
};

// ── Main panel class ────────────────────────────────────────────────────────

export class ObjectPropertiesPanel {
  constructor({ sceneManager, selectionManager, cycleModeler, embedded = false } = {}) {
    this.sceneManager = sceneManager;
    this.selectionManager = selectionManager;
    this.cycleModeler = cycleModeler;
    this.embedded = !!embedded; // when true, render inline (no floating popup chrome)
    this.root = null;
    this._open = false;
    this._target = null;
    this._infoBlock = null;
    this._onSelect = this._onSelect.bind(this);
    this._onDeselect = this._onDeselect.bind(this);
    this._onSelectionRemoved = this._onSelectionRemoved.bind(this);
    this._onEditApplied = this._onEditApplied.bind(this);
    // The cyco-edit-applied listener is attached permanently at
    // construction time (NOT inside `_attachSelectionListeners`)
    // because non-destructive modifier previews must refresh
    // after every Push/Pull or dimension change regardless of
    // whether the user has the modifier panel open. Previously
    // the modifier preview silently went stale whenever the user
    // closed the panel -- the user-visible "the box collapses
    // back to a cube after I push/pull" bug.
    window.addEventListener('cyco-edit-applied', this._onEditApplied);
    this._editAppliedBound = true;
  }

  // build() returns the panel's root DOM element and the instance
  // itself. Caller appends root to wherever the panel should live.
  build() {
    const root = document.createElement('div');
    root.className = 'cyco-opp-root' + (this.embedded ? ' cyco-opp-embedded' : '');
    root.style.display = 'none';
    // Stop pointer/wheel events from bubbling up to the inspector
    // chrome (which has its own handlers).
    root.addEventListener('mousedown', (e) => e.stopPropagation());
    root.addEventListener('pointerdown', (e) => e.stopPropagation());
    root.addEventListener('wheel', (e) => e.stopPropagation());

    // ── Header ──────────────────────────────────────────────────────────
    // Floating-popup mode shows a drag handle + close button; embedded
    // mode (used by the inspector's Properties tab) skips both since
    // the parent inspector already provides chrome.
    const header = document.createElement('div');
    header.className = 'cyco-opp-header';
    if (!this.embedded) {
      const title = document.createElement('span');
      title.className = 'cyco-opp-title';
      title.textContent = 'Object Properties';
      header.appendChild(title);
      const spacer = document.createElement('span');
      spacer.className = 'cyco-opp-spacer';
      header.appendChild(spacer);
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'cyco-opp-close';
      closeBtn.title = 'Close';
      closeBtn.textContent = '\u00d7'; // multiplication sign
      closeBtn.addEventListener('click', () => this.hide());
      header.appendChild(closeBtn);
      root.appendChild(header);
      this._installDrag(root, header);
    } else {
      root.appendChild(header);
    }

    // ── Scrollable body ─────────────────────────────────────────────────
    this._body = document.createElement('div');
    this._body.className = 'cyco-opp-body';
    root.appendChild(this._body);

    this.root = root;
    return { root, panel: this };
  }

  // Drag-to-move, only in floating-popup mode. Embedded mode doesn't
  // support drag because the panel is laid out by flex / grid and
  // there's no concept of a floating position.
  _installDrag(root, handle) {
    let dragging = false, startX = 0, startY = 0, originLeft = 0, originTop = 0;
    handle.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.cyco-opp-close')) return;
      dragging = true;
      startX = e.clientX; startY = e.clientY;
      const rect = root.getBoundingClientRect();
      originLeft = rect.left; originTop = rect.top;
      root.style.left  = originLeft + 'px';
      root.style.top   = originTop  + 'px';
      root.style.right = 'auto';
      root.style.bottom = 'auto';
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      root.style.left = (originLeft + (e.clientX - startX)) + 'px';
      root.style.top  = (originTop  + (e.clientY - startY)) + 'px';
    });
    const stop = () => { dragging = false; };
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  }

  // Toggle visibility. The panel stays mounted in the DOM regardless of
  // _open state -- `display: none` on root hides it without unmounting.
  // This is critical because the parent inspector tab system needs to be
  // able to swap us back in at any time without re-creating DOM.
  show() {
    if (!this.root) return;
    this.root.style.display = this.embedded ? 'block' : 'flex';
    this._open = true;
    this._refreshTarget();
    this._attachSelectionListeners();
  }

  hide() {
    if (!this.root) return;
    this.root.style.display = 'none';
    this._open = false;
    this._detachSelectionListeners();
  }

  toggle() { this._open ? this.hide() : this.show(); }
  isOpen()  { return this._open; }

  _attachSelectionListeners() {
    window.addEventListener('cyco-select-node',        this._onSelect);
    window.addEventListener('cyco-deselect-all',       this._onDeselect);
    // Fires when the user deletes or undoes an object we previously had
    // selected. Without this, the panel would keep rendering against a
    // detached THREE.Object3D and silently fail.
    window.addEventListener('cyco-hierarchy-remove',   this._onSelectionRemoved);
    // (The cyco-edit-applied listener is attached permanently in
    // the constructor, NOT here. See the constructor comment.)
  }
  _detachSelectionListeners() {
    window.removeEventListener('cyco-select-node',     this._onSelect);
    window.removeEventListener('cyco-deselect-all',    this._onDeselect);
    window.removeEventListener('cyco-hierarchy-remove',this._onSelectionRemoved);
    // cyco-edit-applied: permanent listener (see constructor).
  }

  // Re-run every active modifier's preview against the freshly-mutated
  // cage. We only refresh non-destructive previews -- a Subdivide that's
  // already been Applied has no snapshot to fall back to.
  //
  // We deliberately DON'T refresh when the source of the event is the
  // preview path itself (`_previewEditableMesh`). The preview path
  // dispatches `cyco-edit-applied` so callers outside this panel can
  // observe the refresh, but if this listener responded it would
  // re-enter `def.preview`, which calls `_previewEditableMesh`,
  // which dispatches the same event again -> an infinite loop.
  // Guard: only react to commits (`_applyEditableMesh`) and other
  // "real" cage mutations.
  _onEditApplied(event) {
    const obj = event?.detail?.object;
    const source = event?.detail?.source || '';
    if (!obj) return;
    // `_applyPushPreview` / `_writePushedPreview` (in
    // CycleModelerController) call this listener synchronously
    // to re-evaluate the modifier display from a pushed cage
    // during a per-frame drag preview. We accept the call even
    // when `obj !== this._target` (the panel may not have
    // captured this object yet, e.g. right after the modifier
    // was added). The re-entry guard below
    // (`source === '_previewEditableMesh'`) keeps the modifier
    // preview path from infinitely looping when it itself
    // dispatches `cyco-edit-applied` at the end.
    if (source === '_previewEditableMesh') return;
    // For other sources (real commits, manual push/pull preview),
    // still require a captured target so we don't refresh for
    // unrelated objects in the scene.
    if (source !== '_applyPushPreview' && source !== '_applyEditableMesh'
        && obj !== this._target) return;
    const stack = _getModifierStack(obj);
    if (!stack.length) return;
    let touched = false;
    if (this._onEditAppliedDebugCount == null) this._onEditAppliedDebugCount = 0;
    this._onEditAppliedDebugCount += 1;
    if (this._onEditAppliedDebugCount % 4 === 0) {
      // eslint-disable-next-line no-console
      console.log(
        '[MODIFIER-REBUILD]',
        `count=${this._onEditAppliedDebugCount}`,
        `source=${source || '(none)'}`,
        `stack=${stack.map((m) => m._type || m.id).join(',')}`,
      );
    }
    for (const modifier of stack) {
      if (modifier._visible === false) continue;
      const def = MODIFIER_DEFS[modifier._type] || MODIFIER_DEFS[modifier.id];
      if (!def?.preview) continue;
      def.preview(obj, modifier);
      touched = true;
    }
    if (touched) this._renderBody();
  }

  _onSelect(event) {
    const detail = event?.detail ?? {};
    const obj = detail.object || (Array.isArray(detail.objects) ? detail.objects[0] : null);
    if (!obj || !obj.userData?.cycoModeler) return;
    this._target = obj;
    this._renderBody();
  }

  _onDeselect() {
    this._target = null;
    this._renderBody();
  }

  // Object deletion fires cyco-hierarchy-remove -- if that object was
  // our current target, drop the reference and rebuild the body so we
  // don't keep stale pointers to disposed nodes / geometries.
  _onSelectionRemoved(event) {
    if (!this._target) return;
    const removedId = event?.detail?.objectId;
    const targetId = this._target.userData?.cycoId;
    if (removedId && targetId && removedId === targetId) {
      _teardownOnObjectRemoved(this._target);
      this._target = null;
      this._renderBody();
    }
  }

  _refreshTarget() {
    const sel = this.selectionManager?.getSelectedObjects?.() || [];
    const candidate = sel.find((o) => o?.userData?.cycoModeler) || null;
    this._target = candidate;
    this._renderBody();
  }

  _renderBody() {
    if (!this._body) return;
    this._body.innerHTML = '';
    this._infoBlock = null;
    if (!this._target) {
      this._body.appendChild(this._buildEmptyState());
      return;
    }
    this._infoBlock = this._buildObjectInfoBlock(this._target);
    this._body.appendChild(this._infoBlock);
    this._body.appendChild(this._buildModifierBox(this._target));
  }

  // Rebuild only the top info block so live slider/number changes show
  // the updated segment count without rebuilding the modifier panel
  // (which would tear down inputs the user might be focused on).
  _refreshInfoBlock() {
    if (!this._infoBlock || !this._target) return;
    const fresh = this._buildObjectInfoBlock(this._target);
    if (this._body) this._body.replaceChild(fresh, this._infoBlock);
    this._infoBlock = fresh;
  }

  // Empty state -- shown when nothing is selected. Uses muted text and
  // an inconspicuous glyph, matching the rest of the Cyco Engine UI.
  _buildEmptyState() {
    const wrap = document.createElement('div');
    wrap.className = 'cyco-opp-empty';
    const icon = document.createElement('div');
    icon.className = 'cyco-opp-empty-icon';
    icon.textContent = '\u2014'; // em-dash
    wrap.appendChild(icon);
    const msg = document.createElement('div');
    msg.className = 'cyco-opp-empty-msg';
    msg.textContent = 'Select a primitive in the viewport to view its properties.';
    wrap.appendChild(msg);
    return wrap;
  }

  // Selected-primitive info sheet. Name + type + dimensions live here;
  // the modifier box sits directly underneath.
  _buildObjectInfoBlock(obj) {
    const cm = obj.userData.cycoModeler || {};
    const wrap = document.createElement('div');
    wrap.className = 'cyco-opp-info';
    const name = document.createElement('div');
    name.className = 'cyco-opp-info-name';
    name.textContent = obj.name || 'Primitive';
    wrap.appendChild(name);
    const row1 = document.createElement('div');
    row1.className = 'cyco-opp-info-row';
    const k1 = document.createElement('span'); k1.className = 'cyco-opp-info-key'; k1.textContent = 'Type';
    const v1 = document.createElement('span'); v1.className = 'cyco-opp-info-val'; v1.textContent = _humanType(cm.primitive || 'primitive');
    row1.append(k1, v1);
    wrap.appendChild(row1);
    const dims = cm.dimensions || {};
    const row2 = document.createElement('div');
    row2.className = 'cyco-opp-info-row';
    const k2 = document.createElement('span'); k2.className = 'cyco-opp-info-key'; k2.textContent = 'Dimensions';
    const v2 = document.createElement('span'); v2.className = 'cyco-opp-info-val'; v2.textContent = _fmt(dims.width) + ' x ' + _fmt(dims.height) + ' x ' + _fmt(dims.depth);
    row2.append(k2, v2);
    wrap.appendChild(row2);
    if (cm.segments != null && cm.segments > 1) {
      const row3 = document.createElement('div');
      row3.className = 'cyco-opp-info-row';
      const k3 = document.createElement('span'); k3.className = 'cyco-opp-info-key'; k3.textContent = 'Base Segments';
      const v3 = document.createElement('span'); v3.className = 'cyco-opp-info-val'; v3.textContent = String(cm.segments);
      row3.append(k3, v3);
      wrap.appendChild(row3);
    }
    return wrap;
  }

  // ── Modifier box (the modifier stack) ────────────────────────────────────
  _buildModifierBox(obj) {
    const wrap = document.createElement('div');
    wrap.className = 'cyco-opp-modifiers';

    // Header: "Modifiers" title + Add Modifier dropdown.
    const head = document.createElement('div');
    head.className = 'cyco-opp-modifiers-head';
    const title = document.createElement('span');
    title.className = 'cyco-opp-modifiers-title';
    title.textContent = 'Modifiers';
    head.appendChild(title);
    const sp = document.createElement('span');
    sp.style.flex = '1';
    head.appendChild(sp);
    head.appendChild(this._buildAddModifierDropdown(obj));
    wrap.appendChild(head);

    // Modifier list (one row per modifier, top to bottom in stack order).
    const list = document.createElement('div');
    list.className = 'cyco-opp-modifier-list';
    const modifiers = _getModifierStack(obj);
    if (!modifiers.length) {
      const empty = document.createElement('div');
      empty.className = 'cyco-opp-modifiers-empty';
      empty.textContent = 'No modifiers -- click Add Modifier to begin.';
      list.appendChild(empty);
    } else {
      modifiers.forEach((mod, i) => list.appendChild(this._buildModifierRow(obj, mod, i)));
    }
    wrap.appendChild(list);
    return wrap;
  }

  // "Add Modifier" dropdown listing every available modifier type.
  _buildAddModifierDropdown(obj) {
    const wrap = document.createElement('div');
    wrap.className = 'cyco-opp-add-wrap';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cyco-opp-add-btn';
    btn.textContent = 'Add Modifier';

    const menu = document.createElement('div');
    menu.className = 'cyco-opp-add-menu';
    menu.style.display = 'none';

    Object.entries(MODIFIER_DEFS).forEach(([id, def]) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'cyco-opp-add-item';
      item.textContent = def.label;
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!def.supports(obj)) {
          this._status('This modifier does not support the selected primitive.');
          menu.style.display = 'none';
          return;
        }
        const modifier = Object.assign({ id, _type: id }, def.defaults());
        _getModifierStack(obj).push(modifier);
        def.preview(obj, modifier);
        menu.style.display = 'none';
        this._renderBody();
      });
      menu.appendChild(item);
    });

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.style.display = menu.style.display === 'none' ? 'flex' : 'none';
    });
    // Click-anywhere-to-close for the dropdown.
    document.addEventListener('click', () => {
      if (menu.style.display !== 'none') menu.style.display = 'none';
    });

    wrap.appendChild(btn);
    wrap.appendChild(menu);
    return wrap;
  }

  // Build a single modifier row. The header is a Blender-style icon
  // strip: expand triangle, icon, name, spacer, then small icon
  // buttons for Visibility (eye), Apply, and Delete. The body is
  // built by `_populateModifierBody`.
  _buildModifierRow(obj, modifier, index) {
    const def = MODIFIER_DEFS[modifier._type] || MODIFIER_DEFS[modifier.id];
    const row = document.createElement('div');
    row.className = 'cyco-opp-modifier';
    row.dataset.modifierIndex = String(index);
    row.dataset.modifierId = modifier._type || modifier.id || '';

    // ── Header strip (icon row) ────────────────────────────────────────
    const head = document.createElement('div');
    head.className = 'cyco-opp-modifier-head';

    // Expand / collapse triangle. Default-collapsed matches Blender's
    // "tabbed modifier" UX (modifier header visible, controls hidden
    // until expanded).
    const expand = document.createElement('button');
    expand.type = 'button';
    expand.className = 'cyco-opp-modifier-expand';
    expand.title = 'Show / hide controls';
    expand.textContent = '\u25b8'; // small right-pointing triangle
    head.appendChild(expand);

    const icon = document.createElement('img');
    icon.className = 'cyco-opp-modifier-icon';
    icon.alt = '';
    icon.src = ICON_ROOT + (def?.icon || 'Icon_Add_Subdivide.png');
    head.appendChild(icon);

    const name = document.createElement('span');
    name.className = 'cyco-opp-modifier-name';
    name.textContent = def?.label || modifier._type || 'Modifier';
    head.appendChild(name);

    const sp = document.createElement('span');
    sp.style.flex = '1';
    head.appendChild(sp);

    // Visibility (eye) icon toggle -- the Blender-style toggle that
    // hides/shows the modifier in the viewport without deleting it.
    // The visual state mirrors Blender's: a soft-glow eye when on, a
    // crossed-out eye when off.
    const eye = document.createElement('button');
    eye.type = 'button';
    eye.className = 'cyco-opp-modifier-eye' + (modifier._visible === false ? ' off' : '');
    eye.title = modifier._visible === false
      ? 'Show in viewport (currently hidden -- click to show)'
      : 'Hide in viewport (click to hide)';
    eye.innerHTML = modifier._visible === false ? EYE_OFF_SVG : EYE_ON_SVG;
    eye.addEventListener('click', () => {
      const showing = modifier._visible !== false;
      if (showing) {
        // Hide: restore the base geometry so the user sees the
        // pre-modifier preview. The cage is also torn down -- when
        // the modifier is hidden the cage of THAT modifier is hidden
        // too.
        _helpers.restoreBaseGeometry(obj);
        modifier._visible = false;
      } else {
        // Show: re-apply the preview.
        def.preview(obj, modifier);
        modifier._visible = true;
      }
      this._renderBody();
    });
    head.appendChild(eye);

    // Apply icon (downward arrow + dot) -- Blender's "make permanent"
    // symbol. Confirms via window.confirm because there's no undo on
    // a baked modifier.
    const apply = document.createElement('button');
    apply.type = 'button';
    apply.className = 'cyco-opp-modifier-apply';
    apply.title = 'Apply modifier permanently (bake into mesh)';
    apply.innerHTML = APPLY_SVG;
    apply.addEventListener('click', () => {
      def.apply(obj, modifier);
      const stack = _getModifierStack(obj);
      stack.splice(index, 1);
      this._renderBody();
    });
    head.appendChild(apply);

    // Delete (X) -- tears down the modifier (restore geometry + cage),
    // then removes the modifier from the stack. If the stack ends up
    // empty we drop the base snapshot too.
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'cyco-opp-modifier-delete';
    del.title = 'Delete modifier';
    del.innerHTML = DELETE_SVG;
    del.addEventListener('click', () => {
      def.remove(obj, modifier);
      const stack = _getModifierStack(obj);
      stack.splice(index, 1);
      if (!stack.length) {
        const cm = obj?.userData?.cycoModeler;
        if (cm && cm._modifierBaseSnapshot) delete cm._modifierBaseSnapshot;
      }
      this._renderBody();
    });
    head.appendChild(del);

    row.appendChild(head);

    // ── Body ──────────────────────────────────────────────────────────
    const body = document.createElement('div');
    body.className = 'cyco-opp-modifier-body';
    body.style.display = 'block';
    this._populateModifierBody(body, obj, modifier, def);
    row.appendChild(body);

    // Wire the expand toggle. Default collapsed if the modifier was
    // collapsed before (we persist state in the modifier object as
    // `_open`).
    const isOpen = modifier._open !== false;
    body.style.display = isOpen ? 'block' : 'none';
    expand.textContent = isOpen ? '\u25be' : '\u25b8';
    expand.addEventListener('click', () => {
      const open = body.style.display !== 'none';
      body.style.display = open ? 'none' : 'block';
      expand.textContent = open ? '\u25b8' : '\u25be';
      modifier._open = !open;
    });

    return row;
  }

  // Populate the modifier body (the controls under the header strip).
  // Dispatches on modifier type; unknown types render a placeholder.
  _populateModifierBody(body, obj, modifier, def) {
    if (modifier._type === 'subdivide') {
      body.appendChild(this._buildSubdivideBody(obj, modifier, def));
      return;
    }
    if (modifier._type === 'subdivision_surface') {
      this._populateSubdivisionSurfaceBody(body, obj, modifier, def);
      return;
    }
    const p = document.createElement('div');
    p.className = 'cyco-opp-hint';
    p.textContent = 'Unknown modifier: ' + (modifier._type || modifier.id || '?');
    body.appendChild(p);
  }

  // ── Subdivide modifier body ──────────────────────────────────────────────
  // Single additive-integer control -- not destructive, click Apply to
  // bake the segments into the mesh.
  _buildSubdivideBody(obj, modifier, def) {
    const wrap = document.createElement('div');
    wrap.className = 'cyco-opp-ss-wrap';
    wrap.appendChild(this._buildSliderRow('Subdivisions', modifier.levels, 0, 20, 1, (v) => {
      modifier.levels = v;
      def.preview(obj, modifier);
      this._refreshInfoBlock();
    }, 'Live preview of subdivisions. Click Apply to bake.'));
    const hint = document.createElement('div');
    hint.className = 'cyco-opp-hint';
    hint.textContent = 'Non-destructive preview. Click Apply to bake the subdivision into the mesh.';
    wrap.appendChild(hint);
    return wrap;
  }

  // ── Subdivision Surface modifier body ───────────────────────────────────
  // Layout mirrors Blender 4.x: Type dropdown, Subdivisions section
  // (Viewport + Render numeric inputs), a toolbar row with the Display
  // Cage icon toggle, and a collapsible Advanced section.
  _populateSubdivisionSurfaceBody(body, obj, modifier, def) {
    const wrap = document.createElement('div');
    wrap.className = 'cyco-opp-ss-wrap';

    // ── Type dropdown ──────────────────────────────────────────────────
    wrap.appendChild(this._buildDropdownRow('Type', modifier.type, [
      { value: 'catmullClark', label: 'Catmull-Clark' },
      { value: 'simple',       label: 'Simple' },
    ], (v) => {
      modifier.type = v;
      def.preview(obj, modifier);
      this._refreshInfoBlock();
    }));

    // ── Subdivisions section ───────────────────────────────────────────
    // Two slider+number rows (Viewport / Render). The slider drives
    // left/right scrubbing with a visible position indicator and a
    // grab handle -- this is what gives the modifier its
    // "interactive" feel. The number input mirrors the slider value;
    // the user can type a precise value too.
    const subSec = document.createElement('div');
    subSec.className = 'cyco-opp-sub-section';
    subSec.appendChild(this._buildSubSectionLabel('Subdivisions'));
    subSec.appendChild(this._buildSliderRow('Viewport', modifier.viewLevels, 0, 6, 1, (v) => {
      modifier.viewLevels = v;
      def.preview(obj, modifier);
      this._refreshInfoBlock();
    }, 'Live subdivisions in the viewport. Drag to preview.'));
    subSec.appendChild(this._buildSliderRow('Render',   modifier.renderLevels, 0, 6, 1, (v) => {
      modifier.renderLevels = v;
      // Render level is bake-time; no live preview change.
      this._refreshInfoBlock();
    }, 'Subdivision level applied by the Apply button.'));
    wrap.appendChild(subSec);

    // ── Toolbar strip with icon toggles ────────────────────────────────
    // This is the strip that contains Display Cage -- Blender's icon
    // toggle buttons above the Advanced section.
    const toolbar = document.createElement('div');
    toolbar.className = 'cyco-opp-icon-toolbar';
    toolbar.appendChild(this._buildIconToggle('cage', 'Display Cage\nShow the original polygonal outline over the smoothed surface.', !!modifier.showCage, (v) => {
      modifier.showCage = v;
      def.preview(obj, modifier);
    }));
    toolbar.appendChild(this._buildIconToggle('limit', 'Use Limit Surface\nFaster approximation (recommended).', !!modifier.useLimitSurface, (v) => {
      modifier.useLimitSurface = v;
      // Limit-surface is a render-time hint only -- no live preview
      // change because our preview path always uses the limit curve.
    }));
    wrap.appendChild(toolbar);

    // ── Advanced (collapsible) ─────────────────────────────────────────
    const advWrap = document.createElement('div');
    advWrap.className = 'cyco-opp-advanced-wrap';

    const advHead = document.createElement('button');
    advHead.type = 'button';
    advHead.className = 'cyco-opp-advanced-head';
    const advArrow = document.createElement('span');
    advArrow.className = 'cyco-opp-advanced-arrow';
    advArrow.textContent = '\u25be'; // down-pointing triangle (open)
    const advLabel = document.createElement('span');
    advLabel.textContent = 'Advanced';
    advHead.append(advArrow, advLabel);

    const advBody = document.createElement('div');
    advBody.className = 'cyco-opp-advanced-body';
    if (modifier._advancedOpen === false) advBody.style.display = 'none';

    advHead.addEventListener('click', () => {
      const open = advBody.style.display !== 'none';
      advBody.style.display = open ? 'none' : 'block';
      advArrow.textContent = open ? '\u25b8' : '\u25be';
      modifier._advancedOpen = !open;
    });

    advBody.appendChild(this._buildSliderRow('Quality', modifier.quality, 1, 10, 1, (v) => {
      modifier.quality = v;
      // No live preview change.
    }, 'Render-time sampling quality (advanced).'));
    advBody.appendChild(this._buildDropdownRow('Boundary Smooth', modifier.boundarySmooth, [
      { value: 'all',             label: 'All' },
      { value: 'preserve',        label: 'Preserve' },
      { value: 'keep_edges_only', label: 'Keep Edges Only' },
    ], (v) => {
      modifier.boundarySmooth = v;
      // Boundary smooth is a render-time hint -- no live preview change.
    }));

    advWrap.append(advHead, advBody);
    wrap.appendChild(advWrap);

    // Hint at the bottom of the modifier body.
    const hint = document.createElement('div');
    hint.className = 'cyco-opp-hint';
    hint.textContent = 'Non-destructive. Viewport level drives the live preview; Render level bakes on Apply. Toggle Display Cage to overlay the original polygonal outline over the smoothed surface.';
    wrap.appendChild(hint);

    body.appendChild(wrap);
  }

  // ── UI builder helpers ──────────────────────────────────────────────────
  // Each builder returns a DOM fragment that's appended to the
  // modifier body. Style is consistent with the rest of the Cyco
  // Engine dark-theme UI.

  _buildSubSectionLabel(text) {
    const el = document.createElement('div');
    el.className = 'cyco-opp-sub-section-label';
    el.textContent = text;
    return el;
  }

  // Dropdown row -- a left-aligned label and a select element. Mirrors
  // Blender's labelled dropdowns (e.g. Boundary Smooth).
  _buildDropdownRow(label, value, options, onChange) {
    const row = document.createElement('div');
    row.className = 'cyco-opp-field-row';
    const l = document.createElement('span');
    l.className = 'cyco-opp-field-label';
    l.textContent = label;
    row.appendChild(l);
    const sel = document.createElement('select');
    sel.className = 'cyco-opp-select';
    options.forEach((opt) => {
      const o = document.createElement('option');
      o.value = opt.value;
      o.textContent = opt.label;
      if (opt.value === value) o.selected = true;
      sel.appendChild(o);
    });
    sel.addEventListener('change', () => onChange(sel.value));
    row.appendChild(sel);
    return row;
  }

  // Number-input row -- label + click-to-type, drag-to-scrub control.
  // Mirrors Blender's editor-style number inputs:
  //   1. Click the value to type a new number.
  //   2. Pointer-down + drag horizontally scrolls the value (the wider
  //      you drag, the bigger the change). Holding Shift scrubs in
  //      fine increments; holding Alt scrubs slowly.
  // Used for Viewport / Render / Quality in the Subdivision Surface
  // modifier body, and for Subdivisions in the Subdivide modifier.
  _buildNumInputRow(label, value, min, max, step, onChange) {
    const row = document.createElement('div');
    row.className = 'cyco-opp-field-row';
    const l = document.createElement('span');
    l.className = 'cyco-opp-field-label';
    l.textContent = label;
    row.appendChild(l);

    // Drag-scrub wrapper. The visible input is inside; the wrapper
    // listens for pointerdown to start a drag that mutates the value.
    const wrap = document.createElement('div');
    wrap.className = 'cyco-opp-scrub-wrap';

    const num = document.createElement('input');
    num.type = 'text';
    num.className = 'cyco-opp-num cyco-opp-scrub';
    num.value = String(value);
    num.spellcheck = false;
    num.autocomplete = 'off';
    // Read-only becomes false on click so the user can type; typing
    // commits on Enter or blur.
    num.readOnly = false;
    wrap.appendChild(num);

    let scrubbing = false;
    let startX = 0;
    let startVal = 0;
    let accumPx = 0;
    let pointerId = null;

    const fire = (v) => {
      const next = Math.max(min, Math.min(max, Math.round(v)));
      if (next !== num._lastCommitted) {
        num._lastCommitted = next;
        if (document.activeElement !== num) num.value = String(next);
        onChange(next);
      }
    };

    num.addEventListener('pointerdown', (e) => {
      // Right-click is reserved for context menu; only scrub on primary.
      if (e.button !== 0) return;
      // If user is selecting text, don't start a drag.
      const sel = window.getSelection?.();
      if (sel && sel.toString().length > 0) return;
      e.preventDefault();
      scrubbing = true;
      pointerId = e.pointerId;
      startX = e.clientX;
      startVal = Number(num.value) || min;
      accumPx = 0;
      num.setPointerCapture(pointerId);
      wrap.classList.add('scrubbing');
    });

    num.addEventListener('pointermove', (e) => {
      if (!scrubbing) return;
      const dx = e.clientX - startX;
      // Each step per 4 px of horizontal drag. Shift = fine, Alt = slow.
      const divisor = e.shiftKey ? 24 : (e.altKey ? 16 : 4);
      const next = startVal + (dx / divisor) * step;
      accumPx = dx;
      fire(next);
    });

    const endScrub = (e) => {
      if (!scrubbing) return;
      scrubbing = false;
      wrap.classList.remove('scrubbing');
      try { num.releasePointerCapture(pointerId); } catch (_) {}
      // Tiny mouse movement (no drag) -> treat as click -> focus the input.
      if (Math.abs(accumPx) < 3) {
        num.focus();
        num.select?.();
      }
      pointerId = null;
    };
    num.addEventListener('pointerup', endScrub);
    num.addEventListener('pointercancel', endScrub);

    // Typing: commit on Enter or blur. Escape reverts.
    num.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const v = Math.max(min, Math.min(max, Math.round(Number(num.value) || min)));
        num.value = String(v);
        fire(v);
        num.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        num.value = String(num._lastCommitted ?? value);
        num.blur();
      }
    });
    num.addEventListener('blur', () => {
      const v = Math.max(min, Math.min(max, Math.round(Number(num.value) || min)));
      num.value = String(v);
      fire(v);
    });
    // Prevent the middle-mouse / scroll wheel from accidentally scrubbing
    // when the user just scrolls the property panel.
    num.addEventListener('wheel', (e) => e.stopPropagation());

    row.appendChild(wrap);
    num._lastCommitted = value;
    return row;
  }

  // Kept as an alias so existing callers (Subdivide modifier body)
  // still compile. Subdivide re-uses the same Blender-style scrub
  // control as the rest of the panel.
  _buildNumStepperRow(label, value, min, max, step, onChange) {
    return this._buildNumInputRow(label, value, min, max, step, onChange);
  }

  /**
   * Build a row that pairs a number input with two small square
   * stepper buttons (the "small square grips" the user asked for).
   * This replaces the horizontal `<input type="range">` slider that
   * was previously paired with the number field. The slider track
   * and its white thumb did not match the Cyco Engine UI and
   * cluttered the panel; the stepper buttons are compact, themed
   * against the panel, and match Blender's standard numeric input.
   *
   * Interaction:
   *   - Click the [−] / [+] grips to decrement / increment by
   *     `step`. Holding the mouse button continuously steps while
   *     held (the Blender-style "click and hold" pattern).
   *   - Click the number field to type a precise value. Commits on
   *     Enter / blur. Escape reverts.
   *   - Pointer-down on the number field + drag left/right scrubs
   *     the value (Shift = fine, Alt = slow). Mirrors Blender's
   *     "drag-to-scrub" on numeric inputs.
   */
  _buildSliderRow(label, value, min, max, step, onChange, tooltip) {
    const row = document.createElement('div');
    row.className = 'cyco-opp-field-row cyco-opp-stepper-row';
    if (tooltip) row.title = tooltip;
    const l = document.createElement('span');
    l.className = 'cyco-opp-field-label';
    l.textContent = label;
    row.appendChild(l);

    // Single source of truth for the current value, clamped and
    // snapped to `step`. Every control routes through `_commit`
    // so the value stays consistent across [−] / [+] / typing /
    // drag-scrubbing.
    let current = Number(value);
    if (!Number.isFinite(current)) current = min;
    current = Math.max(min, Math.min(max, Math.round(current / step) * step));

    const _commit = (raw, { fromTyping = false } = {}) => {
      let v = Number(raw);
      if (!Number.isFinite(v)) v = current;
      v = Math.round(v / step) * step;
      v = Math.max(min, Math.min(max, v));
      if (v !== current || fromTyping) {
        current = v;
        if (document.activeElement !== num) num.value = String(v);
        onChange(v);
      }
    };

    // ── [−] stepper grip ─────────────────────────────────────────
    // 18×18 square button, themed to match the panel (no white
    // thumb). Click-and-hold repeats the step while the pointer
    // is down so the user can drag-scrub through several steps
    // quickly without mashing the button.
    const minus = document.createElement('button');
    minus.type = 'button';
    minus.className = 'cyco-opp-step cyco-opp-step-minus';
    minus.textContent = '\u2212'; // minus sign
    minus.title = `Decrement ${label}`;

    // ── Number input (the visual value) ──────────────────────────
    // Mirrors the slider value. Click-to-type + drag-to-scrub.
    const num = document.createElement('input');
    num.type = 'text';
    num.className = 'cyco-opp-num cyco-opp-stepper-num';
    num.value = String(current);
    num.spellcheck = false;
    num.autocomplete = 'off';

    // ── [+] stepper grip ─────────────────────────────────────────
    const plus = document.createElement('button');
    plus.type = 'button';
    plus.className = 'cyco-opp-step cyco-opp-step-plus';
    plus.textContent = '+';
    plus.title = `Increment ${label}`;

    // Click-and-hold repeat: start a timer on pointerdown that
    // fires _commit(current ± step) repeatedly until pointerup
    // or pointercancel. The initial click fires once (the
    // pointerdown handler commits); the timer kicks in after a
    // short hold delay so a single tap still feels like a tap.
    let _repeatTimer = null;
    let _repeatInterval = null;
    const _stopRepeat = () => {
      if (_repeatTimer) { clearTimeout(_repeatTimer); _repeatTimer = null; }
      if (_repeatInterval) { clearInterval(_repeatInterval); _repeatInterval = null; }
    };
    const _startRepeat = (delta) => {
      // Single-step commit on initial press.
      _commit(current + delta);
      // After a brief hold delay, commit at ~10Hz so the user can
      // sweep through several values by holding the grip.
      _repeatTimer = setTimeout(() => {
        _repeatInterval = setInterval(() => {
          _commit(current + delta);
          // Stop the repeat when we hit the clamp boundary so the
          // button doesn't keep "stepping" silently past min/max.
          if (delta > 0 && current >= max) _stopRepeat();
          if (delta < 0 && current <= min) _stopRepeat();
        }, 80);
      }, 320);
    };
    const _wireRepeat = (btn, delta) => {
      btn.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        btn.setPointerCapture(e.pointerId);
        _startRepeat(delta);
      });
      btn.addEventListener('pointerup',     _stopRepeat);
      btn.addEventListener('pointercancel', _stopRepeat);
      btn.addEventListener('pointerleave',  _stopRepeat);
      btn.addEventListener('blur',          _stopRepeat);
    };
    _wireRepeat(minus, -step);
    _wireRepeat(plus,   step);

    // Click + wheel on the number field: type a value, or scroll
    // over it to increment / decrement by `step` (Blender-style).
    num.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        _commit(num.value, { fromTyping: true });
        num.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        num.value = String(current);
        num.blur();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        _commit(current + step);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        _commit(current - step);
      }
    });
    num.addEventListener('blur', () => _commit(num.value, { fromTyping: true }));

    // Drag-to-scrub on the number field: pointerdown captures a
    // starting value, pointermove projects horizontal drag onto
    // value deltas (Shift = fine, Alt = slow). This is what
    // makes the control feel like the existing Blender-style
    // numeric input -- the user just gets to also use the [+] /
    // [−] buttons instead of a horizontal slider track.
    let scrubbing = false;
    let startX = 0;
    let startVal = 0;
    let accumPx = 0;
    let pointerId = null;
    num.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const sel = window.getSelection?.();
      if (sel && sel.toString().length > 0) return;
      e.preventDefault();
      scrubbing = true;
      pointerId = e.pointerId;
      startX = e.clientX;
      startVal = current;
      accumPx = 0;
      num.setPointerCapture(pointerId);
    });
    num.addEventListener('pointermove', (e) => {
      if (!scrubbing) return;
      const dx = e.clientX - startX;
      const divisor = e.shiftKey ? 24 : (e.altKey ? 16 : 4);
      accumPx = dx;
      _commit(startVal + (dx / divisor) * step);
    });
    const endScrub = () => {
      if (!scrubbing) return;
      scrubbing = false;
      try { num.releasePointerCapture(pointerId); } catch (_) {}
      if (Math.abs(accumPx) < 3) {
        num.focus();
        num.select?.();
      }
      pointerId = null;
    };
    num.addEventListener('pointerup', endScrub);
    num.addEventListener('pointercancel', endScrub);

    // Wheel scrubbing on the number field: vertical wheel
    // increments / decrements by `step`. Shift = 5× step.
    num.addEventListener('wheel', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const wstep = e.shiftKey ? step * 5 : step;
      _commit(current + (e.deltaY > 0 ? -wstep : wstep));
    }, { passive: false });

    // ── Layout ──────────────────────────────────────────────────────
    // [ − ]  [  num  ]  [ + ]    -- tight, themed, no big slider.
    const stack = document.createElement('div');
    stack.className = 'cyco-opp-stepper-stack';
    stack.appendChild(minus);
    stack.appendChild(num);
    stack.appendChild(plus);
    row.appendChild(stack);
    return row;
  }

  // Icon toggle button -- the missing piece from the original. The
  // button has an SVG icon that visually indicates its state (filled
  // when on, outlined when off). Tooltip explains what it does.
  //
  // Supported icons: 'cage', 'limit' (use limit surface).
  _buildIconToggle(kind, tooltip, on, onChange) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cyco-opp-icon-toggle' + (on ? ' active' : '');
    btn.title = tooltip;
    btn.innerHTML = ICON_TOGGLE_SVG[kind] || '';
    btn.addEventListener('click', () => {
      const next = !btn.classList.contains('active');
      btn.classList.toggle('active', next);
      onChange(next);
    });
    return btn;
  }

  // Report a status message to the host UI (the modeler status overlay
  // listens for `cyco-modeler-status`). Used by the "Add Modifier" menu
  // when the user picks a modifier the selected primitive doesn't
  // support.
  _status(msg) {
    try {
      window.dispatchEvent(new CustomEvent('cyco-modeler-status', { detail: { message: msg } }));
    } catch (_) { /* swallow */ }
  }
}

// ── Inline SVG icons used in the modifier header ───────────────────────────
// Inline so we don't depend on the icon-asset folder for these tiny
// glyphs. Each icon is sized for a 16x16 box (CSS scales to fit).
const EYE_ON_SVG = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8s-2.5 4.5-6.5 4.5S1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/></svg>';
const EYE_OFF_SVG = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 2l12 12"/><path d="M3.5 5.5C2.3 6.6 1.5 8 1.5 8s2.5 4.5 6.5 4.5c1.2 0 2.2-.4 3.1-.9"/><path d="M14.5 8s-1 1.8-2.9 3.1"/><path d="M6.4 4.7C6.9 4.6 7.4 4.5 8 4.5c4 0 6.5 3.5 6.5 3.5"/></svg>';
const APPLY_SVG = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3v7"/><path d="M5 7l3 3 3-3"/><circle cx="8" cy="13" r="1" fill="currentColor" stroke="none"/></svg>';
const DELETE_SVG = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 4.5h9"/><path d="M5 4.5V3.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1"/><path d="M4.5 4.5l.7 8a1 1 0 0 0 1 .9h3.6a1 1 0 0 0 1-.9l.7-8"/><path d="M7 7v4"/><path d="M9 7v4"/></svg>';

// Display Cage -- a small box with dashed edges (the "cage" around the
// smoothed mesh). Use Limit Surface -- a smoothed curve representing
// the limit surface.
const ICON_TOGGLE_SVG = {
  cage:  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="10" height="10" rx="1" stroke-dasharray="2 1.4"/></svg>',
  limit: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 11c1.5-3 3-4 6-4s4.5 1 6 4"/><path d="M3 11h10"/></svg>',
};
