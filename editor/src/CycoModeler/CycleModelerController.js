import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { EditableMesh } from './EditableMesh.js';

const GRID_DEFAULTS = {
  style: 'standard',
  size: 2000,
  divisions: 20,
  cellSize: 100,
  checkerSize: 100,
};

const PRIMITIVE_TOOLS = new Set([
  'box', 'room', 'stair', 'spiral-stair', 'cylinder', 'cone', 'sphere',
  'capsule', 'torus', 'icosahedron', 'line', 'arc', 'disk', 'parallel',
  'rounded-rectangle', 'side-stair'
]);
const ELEMENT_MODES = new Set(['object', 'vertex', 'edge', 'polygon']);
const TRANSFORM_TOOLS = new Set(['translate', 'rotate', 'scale']);
const UNSUPPORTED_TOOLS = new Set([
  'uv', 'vertex-color', 'polygon-color', 'smoothing-group',
  'hotspot-layout', 'polygon-group', 'uv-editor', 'confirm'
]);

export class CycleModelerController {
  constructor({ viewportEngine, sceneManager, selectionManager }) {
    this.viewportEngine = viewportEngine;
    this.sceneManager = sceneManager;
    this.selectionManager = selectionManager;
    this.active = false;
    this.elementMode = 'object';
    this.tool = 'box';
    this.primitiveTool = 'box';
    this.frame = 'world';
    this.snapEnabled = false;
    this.wireMode = 'solid-wire';
    // Visual style cache — mutated by ModelerSettings via setter hooks
    // below. Defaults mirror the factory defaults in ModelerSettings so
    // the modeler still renders correctly if settings aren't imported.
    // Hover style is per-mode (polygon/edge/vertex) so each mode can
    // have its own colour, opacity and vertex size.
    this._wireStyle = { color: 0x000000, opacity: 1.0, thickness: 2, enabled: true };
    this._hoverStyle = {
      polygon: { color: 0xff3333, opacity: 0.9, enabled: true },
      edge:    { color: 0xffaa00, opacity: 0.95, thickness: 3, enabled: true },
      vertex:  { color: 0x33ddff, opacity: 0.95, vertexSize: 6, enabled: true },
    };
    this._selGizmoStyle = {
      outlineColor: 0x9a64ff, outlineWidth: 2,
      glowColor:    0xffffff, glowWidth: 1, glowOpacity: 0.75,
      enabled: true,
    };
    // Cached viewport size in screen pixels — pushed into every LineMaterial
    // so linewidth renders correctly across resize / DPR changes.
    this._lineResolution = new THREE.Vector2(1, 1);
    this._onResize = this._onResize.bind(this);
    window.addEventListener('cyco-vp-resize', this._onResize);
    this._canvas = null;
    this._boxDrag = null;
    this._preview = null;
    this._faceDrag = null;
    this._hover = null;
    this._lastModelerObject = null;
    // Element-level marquee selection state. Set on pointerdown when
    // the user drags on a modeler object while an element mode is
    // active and the tool is not push/pull / extrude-edge. Each
    // element (face/edge/vertex) whose screen-projected centroid
    // falls inside the marquee rect is appended to the object's
    // `selectedFaces/Edges/Vertices` array — the multi-push-pull tool
    // then extrudes all of them together as a single command.
    this._elemMarquee = null;
    // Persistent overlay for the currently-selected elements. Unlike
    // `_hover` (single-element transient outline), this overlay shows
    // EVERY selected face/edge/vertex across ALL selected modeler
    // objects so the user can see exactly which polygons will be
    // affected by the next push/pull / delete / extrude command.
    this._selOverlay = null;
    // Set true on pointerdown while the click landed on an
    // already-selected element. The click handler treats it as an
    // additive toggle (ctrl/shift) rather than a destructive
    // replacement of the multi-selection.
    this._elemMarqueeAdditive = false;

    this._onMode = this._onMode.bind(this);
    this._onTool = this._onTool.bind(this);
    this._onElement = this._onElement.bind(this);
    this._onFrame = this._onFrame.bind(this);
    this._onSnap = this._onSnap.bind(this);
    this._onWire = this._onWire.bind(this);
    this._onSelectionChanged = this._onSelectionChanged.bind(this);
    this._onVpReady = this._onVpReady.bind(this);
    this._onRendererChanged = this._onRendererChanged.bind(this);
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onClick = this._onClick.bind(this);

    window.addEventListener('cyco-vp-ready', this._onVpReady);
    window.addEventListener('cyco-renderer-changed', this._onRendererChanged);
    window.addEventListener('cyco-modeler-mode', this._onMode);
    window.addEventListener('cyco-modeler-tool', this._onTool);
    window.addEventListener('cyco-modeler-element', this._onElement);
    window.addEventListener('cyco-modeler-frame', this._onFrame);
    window.addEventListener('cyco-modeler-snap', this._onSnap);
    window.addEventListener('cyco-modeler-wire', this._onWire);
    window.addEventListener('cyco-select-node', this._onSelectionChanged);
    window.addEventListener('cyco-deselect-all', this._onSelectionChanged);
    setTimeout(() => this._attachCanvas(this.viewportEngine?.rendererManager?.renderer?.domElement), 0);
  }

  _onMode(event) {
    this.active = !!event.detail?.active;
    this._attachCanvas(this.viewportEngine?.rendererManager?.renderer?.domElement);
    if (!this.active) this._cancelPreview();
    this._status(this.active ? 'Cycle Modeler ready' : 'Cycle Modeler closed');
    // Re-apply modeler-scoped visual settings whenever we enter or leave.
    if (this.active) {
      import('./ModelerSettings.js').then(({ applyModelerSettingsToScene }) => {
        applyModelerSettingsToScene();
      }).catch(() => {});
    }
  }

  _onElement(event) {
    const mode = event.detail?.mode;
    if (!ELEMENT_MODES.has(mode)) return;
    this.elementMode = mode;
    this.tool = mode;
    this._hoverClear();
    this._showElementOverlayForSelection();
    this._refreshSelectionOverlay();
    this._status(`${this._label(mode)} mode`);
  }

  _onFrame(event) {
    this.frame = event.detail?.frame === 'local' ? 'local' : 'world';
    window.dispatchEvent(new CustomEvent('cyco-vp-world', {
      detail: { isWorld: this.frame === 'world' }
    }));
  }

  _onSnap(event) {
    this.snapEnabled = !!event.detail?.enabled;
    window.dispatchEvent(new CustomEvent('cyco-rvp-snap', {
      detail: { enabled: this.snapEnabled, value: this._gridCellSize() }
    }));
  }

  _onWire(event) {
    this.wireMode = event.detail?.mode || 'solid-wire';
    const scene = this.sceneManager?.getActiveScene?.();
    scene?.traverse?.(obj => {
      if (obj.userData?.cycoModeler) this._syncWireOverlay(obj);
    });
  }

  // ── Style setters (called by ModelerSettings.applyModelerSettingsToScene) ──
  // Each setter mutates the cache, then walks the live scene to re-style any
  // existing overlays so changes show up immediately.

  _setWireOverlayStyle({ color, thickness, opacity, enabled }) {
    const thicknessChanged = (thickness != null && thickness !== this._wireStyle.thickness);
    if (color     != null) this._wireStyle.color     = (color instanceof THREE.Color) ? color.getHex() : (color | 0);
    if (thickness != null) this._wireStyle.thickness = thickness;
    if (opacity   != null) this._wireStyle.opacity   = opacity;
    if (enabled   != null) this._wireStyle.enabled   = !!enabled;
    const scene = this.sceneManager?.getActiveScene?.();
    scene?.traverse?.(obj => {
      if (!obj.userData?.cycoModeler) return;
      if (!this._wireStyle.enabled) { this._removeWireOverlay(obj); return; }
      // Thickness change requires a geometry rebuild on the WebGPU
      // fallback (the ribbon width is baked in). On WebGL LineMaterial
      // we could update in place, but rebuilding is cheap and keeps the
      // two paths identical.
      if (thicknessChanged) { this._removeWireOverlay(obj); this._syncWireOverlay(obj); return; }
      this._syncWireOverlay(obj);
    });
  }

  /**
   * Per-mode hover setter. `mode` is 'polygon' | 'edge' | 'vertex' and
   * the same options object passed by ModelerSettings for that mode.
   */
  _setHoverStyle({ mode, color, opacity, vertexSize, thickness, enabled }) {
    if (!mode || !this._hoverStyle[mode]) return;
    const s = this._hoverStyle[mode];
    // Track which fields actually changed so we can decide whether the
    // active hover/selection overlay needs a full rebuild (e.g. thickness
    // is baked into the WebGPU ribbon geometry) or just an in-place
    // material tweak.
    const thicknessChanged = mode === 'edge' && thickness != null && thickness !== s.thickness;
    const vertexSizeChanged = mode === 'vertex' && vertexSize != null && vertexSize !== s.vertexSize;
    if (color      != null) s.color      = (color instanceof THREE.Color) ? color.getHex() : (color | 0);
    if (opacity    != null) s.opacity    = opacity;
    if (vertexSize != null && mode === 'vertex') s.vertexSize = vertexSize;
    if (thickness  != null && mode === 'edge') s.thickness = thickness;
    if (enabled    != null) s.enabled    = !!enabled;
    // Refresh any active hover overlay so the new style shows up without
    // a re-hover. If this mode was just disabled, drop the overlay.
    if (this._hover && this._hover.mode === mode) {
      if (!s.enabled) { this._hoverClear(); this._hover = null; }
      else { this._hoverClear(); this._hover = null; }
    }
    // Also re-style the persistent selection overlay if it's this mode.
    // For thickness/vertex-size changes the WebGPU-fallback geometry is
    // baked at build time, so we drop the existing overlay and let
    // `_showElementOverlayForSelection` rebuild it from the cached style.
    const selObj = this._selectedModelerObjects()[0] || this._lastModelerObject;
    if (selObj && this.elementMode === mode && (thicknessChanged || vertexSizeChanged)) {
      this._hoverClear();
      this._showElementOverlayForSelection();
    }
  }

  _setSelectionGizmoStyle({ outlineColor, outlineWidth, glowColor, glowWidth, glowOpacity, enabled }) {
    // Per user instruction, the engine's OutlinePass + primary shell +
    // glow are NEVER drawn in cycle-modeler mode (see
    // applyModelerSettingsToScene — the engine outline is hidden
    // unconditionally whenever the modeler is active). So this setter
    // no longer drives any engine outline cache. The cached
    // `_selGizmoStyle` values are still kept around because the
    // primitive drag-preview reads from them while the user is drawing
    // a new box / room / cylinder on the grid.
    if (outlineColor != null) this._selGizmoStyle.outlineColor = (outlineColor instanceof THREE.Color) ? outlineColor.getHex() : (typeof outlineColor === 'string' ? new THREE.Color(outlineColor).getHex() : (outlineColor | 0));
    if (outlineWidth != null) this._selGizmoStyle.outlineWidth = outlineWidth;
    if (glowColor    != null) this._selGizmoStyle.glowColor    = (glowColor instanceof THREE.Color) ? glowColor.getHex() : (typeof glowColor === 'string' ? new THREE.Color(glowColor).getHex() : (glowColor | 0));
    if (glowWidth    != null) this._selGizmoStyle.glowWidth    = glowWidth;
    if (glowOpacity  != null) this._selGizmoStyle.glowOpacity  = glowOpacity;
    if (enabled      != null) this._selGizmoStyle.enabled      = !!enabled;
    // Drop any modeler-local purple/white ribbon children that older
    // builds attached to committed primitives so they don't render a
    // stale duplicate outline.
    const scene = this.sceneManager?.getActiveScene?.();
    scene?.traverse?.(obj => {
      // Any modeler object (mesh JSON present OR explicitly null for
      // primitives like rounded-box that don't have a polygon mesh).
      if (!obj.userData?.cycoModeler) return;
      for (const g of [...obj.children]) {
        if (!g.userData?._isModelerSelGizmo) continue;
        obj.remove(g);
        g.geometry?.dispose?.();
        g.material?.dispose?.();
      }
    });
    if (this._previewGizmo) {
      this._previewGizmo.parent?.remove(this._previewGizmo);
      this._previewGizmo = null;
    }
  }

  /**
   * Selection-changed listener: kept as a no-op hook so the constructor
   * wiring (`window.addEventListener('cyco-select-node', ...)`) doesn't
   * have to change. The modeler uses its own hover/selection layer
   * (polygon / edge / vertex highlights); the engine outline pass is
   * hidden in modeler mode.
   */
  _onSelectionChanged() {
    // No-op — modeler handles selection visuals internally.
  }

  // ── Line2 resolution / resize ─────────────────────────────────────────

  _onResize(event) {
    const w = event?.detail?.width || 1;
    const h = event?.detail?.height || 1;
    this._lineResolution.set(w, h);
    // Push the new resolution to every LineMaterial currently in the scene.
    const scene = this.sceneManager?.getActiveScene?.();
    scene?.traverse?.(obj => {
      const mats = [];
      if (obj.material?.isLineMaterial) mats.push(obj.material);
      for (const c of (obj.children || [])) {
        if (c.material?.isLineMaterial) mats.push(c.material);
      }
      for (const m of mats) m.resolution.copy(this._lineResolution);
    });
  }

  _ensureLineResolution(material) {
    if (!material?.isLineMaterial) return;
    if (this._lineResolution.x <= 1 || this._lineResolution.y <= 1) {
      const canvas = this.viewportEngine?.rendererManager?.renderer?.domElement;
      if (canvas) this._lineResolution.set(canvas.clientWidth || 1, canvas.clientHeight || 1);
    }
    material.resolution.copy(this._lineResolution);
  }

  _onTool(event) {
    const tool = event.detail?.tool;
    if (!tool) return;
    this.tool = tool;

    if (ELEMENT_MODES.has(tool)) {
      this.tool = tool;
      return;
    }

    if (TRANSFORM_TOOLS.has(tool)) {
      window.dispatchEvent(new CustomEvent('cyco-vp-tool', { detail: { mode: tool } }));
      return;
    }

    if (PRIMITIVE_TOOLS.has(tool)) {
      this.primitiveTool = tool;
      this._status(`${this._label(tool)} tool: drag on the grid to draw the footprint`);
      return;
    }

    if (tool === 'all-select') {
      this._selectAllModelerObjects();
      return;
    }

    if (tool === 'invert-select') {
      this._invertModelerSelection();
      return;
    }

    if (tool === 'none-select' || tool === 'cancel') {
      this.selectionManager?.clearSelection?.();
      this._status('Selection cleared');
      return;
    }

    if (tool === 'eraser') {
      if (this._deleteSelectedFaces()) return;
      this._deleteSelectedModelerObjects();
      return;
    }

    if (tool === 'push-pull' || tool === 'multi-push-pull' || tool === 'extrude-edge') {
      this._status(`${this._label(tool)}: click-drag a selected face to extrude`);
      return;
    }

    if (tool === 'inset') {
      this._resizeSelected({ dx: -this._gridCellSize() * 0.25, dz: -this._gridCellSize() * 0.25 }, 'Inset');
      return;
    }

    if (tool === 'subdivide' || tool === 'loop-slice') {
      this._subdivideSelected(tool);
      return;
    }

    if (tool === 'bridge' || tool === 'combine' || tool === 'boolean') {
      this._combineSelectedModelerObjects(this._label(tool));
      return;
    }

    if (tool === 'bevel') {
      this._bevelSelected();
      return;
    }

    if (tool === 'mirror') {
      this._mirrorSelectedModelerObjects();
      return;
    }

    if (tool === 'collapse') {
      this._resizeSelected({ dy: -this._gridCellSize() }, 'Collapse');
      return;
    }

    if (tool === 'cut' || tool === 'clip') {
      this._resizeSelected({ dx: -this._gridCellSize() * 0.5 }, this._label(tool));
      return;
    }

    if (tool === 'detach') {
      this._duplicateSelectedModelerObjects('Detach Modeler Selection');
      return;
    }

    if (tool === 'remove-doubles') {
      this._refreshSelectedModelerMeshes('Remove Doubles');
      return;
    }

    if (tool === 'combine-vertices' || tool === 'combine-polygons') {
      this._refreshSelectedModelerMeshes(this._label(tool));
      return;
    }

    if (tool === 'duplicate' || tool === 'clone') {
      this._duplicateSelectedModelerObjects();
      return;
    }

    if (tool === 'mirror-object') {
      this._mirrorSelectedModelerObjects();
      return;
    }

    if (tool === 'flatten') {
      this._flattenSelected();
      return;
    }

    if (tool === 'align' || tool === 'snap-move') {
      this._snapSelectedToGrid(this._label(tool));
      return;
    }

    if (tool === 'axis-flip' || tool === 'flip') {
      this._mirrorSelectedModelerObjects();
      return;
    }

    if (tool === 'pivot' || tool === 'pivot-center') {
      this._centerSelectedPivots();
      return;
    }

    if (tool === 'bake-transform') {
      this._bakeSelectedTransforms();
      return;
    }

    if (tool === 'material') {
      window.dispatchEvent(new CustomEvent('cyco-show-properties', { detail: { type: 'material' } }));
      this._status('Material properties opened');
      return;
    }

    if (tool === 'export') {
      window.dispatchEvent(new CustomEvent('cyco-export-scene'));
      this._status('Export requested');
      return;
    }

    if (tool === 'settings' || tool === 'local-settings') {
      window.dispatchEvent(new CustomEvent('cyco-open-preferences'));
      this._status('Preferences opened');
      return;
    }

    if (tool === 'collider') {
      window.dispatchEvent(new CustomEvent('cyco-show-properties', { detail: { type: 'physics' } }));
      this._status('Collider properties requested');
      return;
    }

    if (tool === 'cursor') {
      this._status('3D cursor set to grid origin');
      return;
    }

    if (tool === 'refresh' || tool === 'refresh-all') {
      this._refreshSelectedModelerMeshes();
      return;
    }

    if (tool === 'new-object') {
      this.primitiveTool = 'box';
      this.tool = 'box';
      this._status('New object: drag on the grid to draw a box');
      return;
    }

    if (UNSUPPORTED_TOOLS.has(tool)) {
      this._status(`${this._label(tool)} needs topology phase wiring`);
      return;
    }

    this._status(`${this._label(tool)} is unavailable`);
  }

  _onVpReady(event) {
    this._attachCanvas(event.detail?.renderer?.domElement || this.viewportEngine?.rendererManager?.renderer?.domElement);
  }

  _onRendererChanged(event) {
    this._attachCanvas(event.detail?.renderer?.domElement || this.viewportEngine?.rendererManager?.renderer?.domElement);
  }

  _attachCanvas(canvas) {
    if (this._canvas === canvas) return;
    if (this._canvas) {
      this._canvas.removeEventListener('pointerdown', this._onPointerDown, true);
      this._canvas.removeEventListener('pointermove', this._onPointerMove, true);
      this._canvas.removeEventListener('pointerup', this._onPointerUp, true);
      this._canvas.removeEventListener('click', this._onClick, true);
    }
    this._canvas = canvas || null;
    if (this._canvas) {
      this._canvas.addEventListener('pointerdown', this._onPointerDown, true);
      this._canvas.addEventListener('pointermove', this._onPointerMove, true);
      this._canvas.addEventListener('pointerup', this._onPointerUp, true);
      this._canvas.addEventListener('click', this._onClick, true);
      // Seed the Line2 resolution cache from the canvas so the very
      // first LineMaterial we create (before any cyco-vp-resize fires)
      // still has correct screen-pixel width.
      const w = this._canvas.clientWidth || this._canvas.width || 1;
      const h = this._canvas.clientHeight || this._canvas.height || 1;
      if (w > 1 && h > 1) this._lineResolution.set(w, h);
    }
  }

  /**
   * Return the world-space centre of an object's bounding box, or null
   * if the object has no geometry / bbox yet. Used by the WebGPU
   * wireframe-ribbon width calculation so the ribbon thickness is
   * stable relative to the object (not the world origin) as the camera
   * orbits.
   */
  _getObjectWorldCenter(obj) {
    if (!obj?.geometry) return null;
    if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox();
    const bb = obj.geometry.boundingBox;
    if (!bb) return null;
    const localCenter = bb.getCenter(new THREE.Vector3());
    return obj.localToWorld(localCenter);
  }

  _onPointerDown(event) {
    if (this._canDrawPrimitive(event)) {
      const point = this._gridPointFromEvent(event);
      if (!point) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      try { this._canvas?.setPointerCapture?.(event.pointerId); } catch (_) { /* synthetic events */ }
      this.viewportEngine.controls.enabled = false;
      this.selectionManager?.suspend?.();
      window.__cyco = window.__cyco || {};
      window.__cyco._suppressSelectionManagerClick = true;
      this._boxDrag = {
        pointerId: event.pointerId,
        start: point.clone(),
        end: point.clone(),
        startClientX: event.clientX,
        startClientY: event.clientY,
        lastClientY: event.clientY,
      };
      this._updatePreview();
      return;
    }

    if (this.tool === 'push-pull' || this.tool === 'multi-push-pull' || this.tool === 'extrude-edge') {
      const hit = this._modelerHitFromEvent(event);
      const modeler = hit?.object?.userData?.cycoModeler;
      // For single push/pull we still need an actual hit on a face.
      // For multi-push-pull the click can land on any modeler object —
      // the drag extrudes every face currently in the multi-selection,
      // which may have been built up by previous click-selections or
      // marquee-drag selections. If the user clicks empty space in
      // multi mode we just no-op (no face to drag).
      if (this.tool === 'push-pull') {
        if (!hit?.object || !modeler?.mesh) return;
        modeler.selectedFaces = this._faceIndicesFromHit(hit);
        if (!modeler.selectedFaces.length) return;
      } else {
        if (!hit?.object) {
          // No hit in multi mode — fall through to element marquee.
          this._startElementMarquee(event);
          return;
        }
        // If we hit a modeler object but it currently has no selected
        // faces (e.g. user clicked a face on an object that has none
        // selected), seed the click face into the selection so the
        // drag has something to extrude.
        if (!modeler?.mesh) return;
        const seedFaces = this._faceIndicesFromHit(hit);
        if (!modeler.selectedFaces?.length && seedFaces.length) {
          modeler.selectedFaces = seedFaces.slice();
        }
        if (!this._hasAnyElementSelection()) return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      try { this._canvas?.setPointerCapture?.(event.pointerId); } catch (_) { /* synthetic events */ }
      this.viewportEngine.controls.enabled = false;
      window.__cyco = window.__cyco || {};
      window.__cyco._suppressSelectionManagerClick = true;
      // For multi push/pull we snapshot EVERY selected modeler object
      // so we can roll back the whole multi-extrusion on undo.
      const draggedObjects = this.tool === 'multi-push-pull'
        ? this._selectedModelerObjects().filter(o => {
            const m = o.userData.cycoModeler;
            return m?.mesh && (m.selectedFaces?.length || m.selectedEdges?.length || m.selectedVertices?.length);
          })
        : [hit.object];
      if (!draggedObjects.length) return;
      const before = draggedObjects.map(obj => this._snapshotObjectGeometry(obj));
      const baseMeshes = draggedObjects.map(obj => JSON.parse(JSON.stringify(obj.userData.cycoModeler.mesh || {})));
      // For single push/pull the face the user grabbed defines the
      // drag direction (its outward normal). For multi-push-pull we
      // use the FIRST selected face's normal as the drag direction —
      // every other selected face extrudes along its OWN face normal
      // at the same world-space distance, so opposite-facing walls
      // move in opposite world directions (which is exactly what
      // UModeler-style multi-push does).
      const seedFaceIndex = draggedObjects[0].userData.cycoModeler.selectedFaces?.[0] ?? 0;
      this._faceDrag = {
        pointerId: event.pointerId,
        object: hit?.object ?? draggedObjects[0],
        startClientX: event.clientX,
        startClientY: event.clientY,
        lastClientX: event.clientX,
        lastClientY: event.clientY,
        before,
        baseMesh: baseMeshes[0],
        baseFaces: (draggedObjects[0].userData.cycoModeler.selectedFaces || []).slice(),
        // Multi-push/pull state:
        multi: this.tool === 'multi-push-pull',
        draggedObjects,
        baseMeshes,
        seedFaceIndex,
      };
      this._status(this.tool === 'multi-push-pull'
        ? `Multi push/pull: drag to extrude ${this._countSelectedElements()} elements`
        : 'Drag to extrude the selected face');
      return;
    }

    // Marquee multi-select for element modes (polygon / edge / vertex).
    // Fires when the user click-drags on a modeler object — or in
    // empty space near one — while in an element mode and the active
    // tool is not push/pull / extrude-edge / a primitive drawer.
    if (this.active && ELEMENT_MODES.has(this.elementMode) && this.elementMode !== 'object'
        && event.button === 0) {
      this._startElementMarquee(event);
      return;
    }
  }

  _onPointerMove(event) {
    if (this._boxDrag && event.pointerId === this._boxDrag.pointerId) {
      const point = this._gridPointFromEvent(event);
      if (!point) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this._boxDrag.end.copy(point);
      // Track vertical drag in screen pixels for height adjustment.
      this._boxDrag.lastClientY = event.clientY;
      this._updatePreview();
      return;
    }

    if (this._faceDrag && event.pointerId === this._faceDrag.pointerId) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this._faceDrag.lastClientX = event.clientX;
      this._faceDrag.lastClientY = event.clientY;
      const delta = this._pushDistanceFromDrag(this._faceDrag);
      if (this._faceDrag.multi) {
        this._applyMultiPushPreview(this._faceDrag, delta);
        this._status(`Multi push/pull: ${delta.toFixed(1)}`);
      } else {
        this._applyPushPreview(this._faceDrag.object, this._faceDrag.baseMesh, delta);
        this._status('Drag to extrude the selected face');
      }
      return;
    }

    if (this._elemMarquee && event.pointerId === this._elemMarquee.pointerId) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this._elemMarquee.lastClient = { x: event.clientX, y: event.clientY };
      // Rebuild the candidate set on every move so the user sees
      // their selection grow/shrink as the rect drags over faces.
      this._updateElementMarqueePreview();
      return;
    }

    const hit = this._modelerHitFromEvent(event);
    this._updateHover(hit);
    if (hit?.object?.userData?.cycoModeler?.mesh && this.active) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }

  _onClick(event) {
    if (!this.active || !ELEMENT_MODES.has(this.elementMode) || this._boxDrag) return;
    // A drag-marquee was just released — `_elemMarquee` is already
    // cleared by `_onPointerUp`, so suppress the click that fires
    // after pointerup so we don't replace the marquee selection
    // with a single-element click selection.
    if (this._suppressNextClick) {
      this._suppressNextClick = false;
      return;
    }
    const hit = this._modelerHitFromEvent(event);
    if (!hit?.object?.userData?.cycoModeler?.mesh) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const modeler = hit.object.userData.cycoModeler;
    this._lastModelerObject = hit.object;
    const selection = this._selectionFromHit(hit);
    // Shift / ctrl held → additive selection (toggle the clicked
    // element in/out of the existing multi-selection). Holding neither
    // modifier replaces the multi-selection with just the clicked
    // element so the user can re-anchor quickly.
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    if (this.elementMode === 'vertex') {
      if (additive) {
        modeler.selectedVertices = this._toggleArray(modeler.selectedVertices, selection.vertices);
      } else {
        modeler.selectedVertices = selection.vertices;
      }
      modeler.selectedEdges = [];
      modeler.selectedFaces = selection.faces;
      this._status(`Vertex ${modeler.selectedVertices[0] ?? 0} selected (${modeler.selectedVertices.length} total)`);
    } else if (this.elementMode === 'edge') {
      if (additive) {
        modeler.selectedEdges = this._toggleArray(modeler.selectedEdges, selection.edges);
      } else {
        modeler.selectedEdges = selection.edges;
      }
      modeler.selectedVertices = [];
      modeler.selectedFaces = selection.faces;
      this._status(`Edge ${modeler.selectedEdges[0] ?? 0} selected (${modeler.selectedEdges.length} total)`);
    } else if (this.elementMode === 'polygon') {
      if (additive) {
        modeler.selectedFaces = this._toggleArray(modeler.selectedFaces, selection.faces);
      } else {
        modeler.selectedFaces = selection.faces;
      }
      modeler.selectedVertices = [];
      modeler.selectedEdges = [];
      this._status(`Polygon ${Math.floor((modeler.selectedFaces[0] ?? 0) / 2) + 1} selected (${modeler.selectedFaces.length} polys)`);
    } else {
      modeler.selectedFaces = [];
      modeler.selectedEdges = [];
      modeler.selectedVertices = [];
      this._status('Object selected');
    }
    this.selectionManager?.setSelectedObjects?.([hit.object]);
    this._refreshSelectionOverlay();
  }

  _onPointerUp(event) {
    if (this._faceDrag && event.pointerId === this._faceDrag.pointerId) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const drag = this._faceDrag;
      this._faceDrag = null;
      this.viewportEngine.controls.enabled = true;
      try { this._canvas?.releasePointerCapture?.(event.pointerId); } catch (_) { /* synthetic events */ }
      const delta = this._pushDistanceFromDrag(drag);
      if (Math.abs(delta) > 0.001) {
        if (drag.multi) {
          // Commit each selected object's mesh as a single command so
          // the entire multi-push is one undo entry.
          const finals = drag.draggedObjects.map((obj, i) => {
            const mesh = EditableMesh.fromJSON(drag.baseMeshes[i]);
            const m = obj.userData.cycoModeler;
            const faces = m.selectedFaces?.length ? m.selectedFaces : this._faceIndicesForSelection(m);
            mesh.pushFaces(faces, delta);
            return mesh;
          });
          window.dispatchEvent(new CustomEvent('cyco-command-execute', {
            detail: {
              name: 'Multi Push Pull',
              do: () => drag.draggedObjects.forEach((obj, i) => this._applyEditableMesh(obj, finals[i])),
              undo: () => drag.draggedObjects.forEach((obj, i) => this._restoreObjectGeometry(obj, drag.before[i])),
            }
          }));
        } else {
          const finalMesh = EditableMesh.fromJSON(drag.baseMesh);
          const faces = drag.object.userData.cycoModeler?.selectedFaces?.length
            ? drag.object.userData.cycoModeler.selectedFaces
            : this._faceIndicesForSelection(drag.object.userData.cycoModeler);
          finalMesh.pushFaces(faces, delta);
          window.dispatchEvent(new CustomEvent('cyco-command-execute', {
            detail: {
              name: this._label(this.tool),
              do: () => this._applyEditableMesh(drag.object, finalMesh),
              undo: () => this._restoreObjectGeometry(drag.object, drag.before),
            }
          }));
        }
      }
      this._status(drag.multi ? `Multi push/pull applied (${this._countSelectedElements()} elements)` : 'Extrude applied');
      this._hoverClear();
      this._refreshSelectionOverlay();
      try { delete window.__cyco._suppressSelectionManagerClick; } catch (_) {}
      return;
    }
    if (this._elemMarquee && event.pointerId === this._elemMarquee.pointerId) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const marquee = this._elemMarquee;
      this._elemMarquee = null;
      this.viewportEngine.controls.enabled = true;
      try { this._canvas?.releasePointerCapture?.(event.pointerId); } catch (_) { /* synthetic events */ }
      // The actual selection was already written to the modeler
      // userData during `_updateElementMarqueePreview`. Just update
      // the visual overlay + status here.
      this._refreshSelectionOverlay();
      this._status(this._elemMarqueeSummary());
      // Defer clearing `_suppressNextClick` to the next animation
      // frame so the synthetic `click` event that the browser fires
      // after pointerup gets consumed by the suppress guard in
      // `_onClick`. Without this defer, the click replaces the
      // marquee selection with a single-element click selection.
      requestAnimationFrame(() => { this._suppressNextClick = false; });
      try { delete window.__cyco._suppressSelectionManagerClick; } catch (_) {}
      return;
    }
    if (!this._boxDrag || event.pointerId !== this._boxDrag.pointerId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const drag = this._boxDrag;
    this._boxDrag = null;
    this.viewportEngine.controls.enabled = true;
    this.selectionManager?.resume?.();
    try { this._canvas?.releasePointerCapture?.(event.pointerId); } catch (_) { /* synthetic events */ }
    this._hoverClear();
    const object = this._buildPrimitiveObject(drag.start, drag.end, false, drag);
    this._cancelPreview();
    this._commitObject(object);
    try { delete window.__cyco._suppressSelectionManagerClick; } catch (_) {}
  }

  _canDrawPrimitive(event) {
    return this.active && PRIMITIVE_TOOLS.has(this.tool) && event.button === 0 && !event.target.closest?.('button,input');
  }

  _gridPointFromEvent(event) {
    const renderer = this.viewportEngine?.rendererManager?.renderer;
    const camera = this.viewportEngine?.camera;
    if (!renderer?.domElement || !camera) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, camera);
    const point = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), point)) return null;
    return this._snapPoint(point);
  }

  _selectedFaceEdgeIndices(faceIndex = 0) {
    const quad = Math.floor((faceIndex ?? 0) / 2) * 4;
    return [quad, quad + 1];
  }

  _selectionFromHit(hit) {
    const modeler = hit?.object?.userData?.cycoModeler;
    if (!modeler?.dimensions || !hit?.face) {
      const faceIndices = this._selectedFaceEdgeIndices(hit?.faceIndex ?? 0);
      return { faces: faceIndices, edges: [], vertices: [] };
    }
    const faceId = this._faceIdFromHit(hit);

    const faceVertices = {
      0: [0, 3, 2, 1],
      1: [4, 5, 6, 7],
      2: [0, 1, 5, 4],
      3: [3, 7, 6, 2],
      4: [0, 4, 7, 3],
      5: [1, 2, 6, 5],
    }[faceId] ?? [0, 1, 2, 3];

    return {
      faces: this._faceIndicesFromHit(hit),
      edges: [faceId],
      vertices: [faceVertices[0]],
    };
  }

  _faceIndicesFromHit(hit) {
    const mesh = EditableMesh.fromJSON(hit?.object?.userData?.cycoModeler?.mesh);
    const geom = hit?.object?.geometry;
    const triIndex = Math.max(0, hit?.faceIndex ?? 0);
    // Prefer the explicit faceId attribute when present (after Push/Pull
    // quads are fan-triangulated, triangle index no longer matches face
    // index 1:1).
    let index = triIndex;
    const faceIdAttr = geom?.attributes?.faceId;
    if (faceIdAttr) {
      const vertexIndex = triIndex * 3;
      if (vertexIndex < faceIdAttr.count) index = Math.max(0, faceIdAttr.getX(vertexIndex) | 0);
    }
    // Use the mesh's `faceGroup` (selection-group) rather than a raw
    // geometric coplanar test. After Push/Pull, side walls can lie on
    // the same geometric plane as adjacent mesh faces (e.g. the top
    // side wall of an extruded back face sits on the same Y plane as
    // the box's top face) — the geometric coplanar check would
    // over-select those walls, so the user clicking the top face
    // would "select all the squares". `selectionGroup` returns just
    // the polygons that share an explicit selection group ID with the
    // seed face, which is what the modeler wants.
    return mesh.selectionGroup(index);
  }

  _pushDistanceFromDrag(drag) {
    // Project the screen-space mouse motion onto the selected face's
    // outward normal. We must NOT dot the world-space displacement of
    // two points on the face plane with the normal — those points all
    // lie ON the plane, so the displacement is perpendicular to the
    // normal and the dot product is always zero (the previous bug).
    // The correct UModeler-style algorithm is:
    //   1. Project the world-space face normal to screen-space.
    //   2. Project the mouse-delta pixels onto that 2D screen direction.
    //   3. Convert that pixel distance back to world units using the
    //      camera's pixel-to-world scale at the face's depth.
    const renderer = this.viewportEngine?.rendererManager?.renderer;
    const camera = this.viewportEngine?.camera;
    if (!renderer?.domElement || !camera || !drag?.object) {
      return ((drag.startClientY ?? 0) - (drag.lastClientY ?? drag.startClientY ?? 0)) * this._gridCellSize() * 0.01;
    }
    const mesh = drag.object.userData?.cycoModeler?.mesh;
    const faces = drag.object.userData?.cycoModeler?.selectedFaces?.length
      ? drag.object.userData.cycoModeler.selectedFaces
      : (drag.baseFaces ?? []);
    if (!mesh || !faces?.length) return 0;

    const editable = EditableMesh.fromJSON(mesh);
    const worldNormal = editable._averageNormal(faces).clone();
    if (worldNormal.lengthSq() === 0) return 0;
    worldNormal.transformDirection(drag.object.matrixWorld).normalize();

    // 1. Project the world-space normal to screen-space pixels. We add a
    // small step along the normal at the face's center and project the
    // start vs stepped points; the pixel difference is the on-screen
    // direction (and length-per-world-unit at that depth).
    const faceIndex = faces[0];
    const face = editable.faces[faceIndex];
    if (!face || face.length < 3) return 0;
    const center = new THREE.Vector3();
    for (const vi of face) center.add(editable.vertices[vi]);
    center.multiplyScalar(1 / face.length).applyMatrix4(drag.object.matrixWorld);

    const STEP = 100; // world units used only to measure on-screen length
    const steppedWorld = center.clone().addScaledVector(worldNormal, STEP);
    const project = (world) => {
      const v = world.clone().project(camera);
      const r = renderer.domElement.getBoundingClientRect();
      return new THREE.Vector2(
        (v.x * 0.5 + 0.5) * r.width,
        (-v.y * 0.5 + 0.5) * r.height,
      );
    };
    const p0 = project(center);
    const p1 = project(steppedWorld);
    const screenNormal = p1.clone().sub(p0);
    const screenLen = screenNormal.length();
    if (screenLen < 1e-6) return 0;
    screenNormal.divideScalar(screenLen);
    // pixels per world unit along the face normal at this depth
    const pixelsPerUnit = screenLen / STEP;

    // 2. Project the mouse-delta pixels onto the screen-space normal.
    // Pointer events deliver clientX/Y in VIEWPORT coords, while `project`
    // above outputs CANVAS-relative pixels. Translate both into canvas
    // pixels by subtracting the canvas's bounding rect.
    const r = renderer.domElement.getBoundingClientRect();
    const startCanvasX = (drag.startClientX ?? 0) - r.left;
    const startCanvasY = (drag.startClientY ?? 0) - r.top;
    const lastCanvasX  = (drag.lastClientX  ?? drag.startClientX ?? 0) - r.left;
    const lastCanvasY  = (drag.lastClientY  ?? drag.startClientY ?? 0) - r.top;
    const dpx = lastCanvasX - startCanvasX;
    const dpy = lastCanvasY - startCanvasY;
    const alongPixels = dpx * screenNormal.x + dpy * screenNormal.y;

    // 3. Convert pixels back to world units.
    const raw = alongPixels / pixelsPerUnit;
    if (!this.snapEnabled) return raw;
    const step = this._gridCellSize();
    return Math.round(raw / step) * step;
  }

  _unprojectToFacePlane(object, ndc, camera, domElement, faces, editable) {
    const pos = object.geometry?.attributes?.position;
    if (!pos || !faces?.length) return null;
    const faceIndex = faces[0];
    // Use the face's vertex set from the EditableMesh directly so we don't
    // depend on the BufferGeometry's triangle layout (which is fan-triangulated).
    const face = editable.faces[faceIndex];
    if (!face || face.length < 3) return null;
    const sample = (i) => new THREE.Vector3(
      editable.vertices[face[i]].x,
      editable.vertices[face[i]].y,
      editable.vertices[face[i]].z,
    ).applyMatrix4(object.matrixWorld);
    const v0 = sample(0);
    const v1 = sample(1);
    const v2 = sample(2);
    const center = v0.clone().add(v1).add(v2).multiplyScalar(1 / 3);
    const normal = editable._faceNormal(faceIndex).clone().transformDirection(object.matrixWorld).normalize();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, center);
    const ray = new THREE.Ray();
    ray.origin.copy(camera.position);
    const ndcVec = new THREE.Vector3(ndc.x, ndc.y, 0.5).unproject(camera).sub(camera.position).normalize();
    ray.direction.copy(ndcVec);
    const hit = new THREE.Vector3();
    if (!ray.intersectPlane(plane, hit)) return null;
    return hit;
  }

  _snapPoint(point) {
    const step = this._gridCellSize();
    point.x = Math.round(point.x / step) * step;
    point.y = 0;
    point.z = Math.round(point.z / step) * step;
    return point;
  }

  _updatePreview() {
    if (!this._boxDrag) return;
    const preview = this._buildPrimitiveObject(this._boxDrag.start, this._boxDrag.end, true, this._boxDrag);
    this._cancelPreview();
    this._preview = preview;
    this.viewportEngine.scene?.add(preview);
  }

  /**
   * Build a LineSegments2 from an EdgesGeometry (or any BufferGeometry).
   * Returns the LineSegments2 with a LineMaterial already configured and
   * `resolution` set to the current viewport.
   *
   * `linewidth` is in screen pixels. Under WebGL this is honored by the
   * LineMaterial itself. Under WebGPU the LineMaterial's ShaderMaterial
   * wrapper is rejected by Three.js's TSL NodeBuilder, so we fall back to
   * an inflated MeshBasicMaterial ribbon — each edge segment is extruded
   * into a thin screen-facing quad so the slider produces a visible
   * thickness on both renderers.
   */
  _buildFatEdges(edgesGeom, color, linewidth, opacity, depthTest = true, targetPos = null) {
    const renderer = this.viewportEngine?.rendererManager?.renderer;
    const isWebGPU = !!(renderer && renderer.isWebGPURenderer);

    // Clamp to a reasonable visible range so a stray 0/NaN doesn't hide
    // the wireframe entirely.
    const widthPx = Math.max(0.5, Number.isFinite(linewidth) ? linewidth : 1);
    // Make sure depthTest is a real boolean (callers may pass `true` /
    // `false` already, but a stray `undefined` would skip the
    // `depthTest` arg and silently default to `false`).
    depthTest = depthTest !== false;

    if (!isWebGPU) {
      // WebGL: Line2 honours screen-pixel width natively.
      const lineGeom = new LineSegmentsGeometry().fromEdgesGeometry(edgesGeom);
      const mat = new LineMaterial({
        color,
        linewidth: widthPx,
        // Only enable transparency when opacity is actually < 1; a
        // fully-opaque wireframe should render solid (no blending,
        // no MSAA alpha-to-coverage dither that reads as a "blend
        // transition" against the surface beneath).
        transparent: opacity < 1,
        opacity,
        depthTest,
        depthWrite: false,
        dashed: false,
        alphaToCoverage: opacity < 1,
      });
      this._ensureLineResolution(mat);
      const seg = new LineSegments2(lineGeom, mat);
      seg.scale.set(1, 1, 1);
      return seg;
    }

    // WebGPU fallback: convert pixel width into world-space ribbon width
    // using the camera distance to the BBOX CENTER of the parent mesh
    // (not the world origin) so the ribbon thickness is stable when the
    // user orbits / dollies the camera around the modeler object. This
    // is the primary fix for the "jittery" wireframe reported in the
    // editor: previously we used `camera.position.length()` which moves
    // every frame as the camera orbits, causing the visible ribbon to
    // pulse.
    const camera = this.viewportEngine?.camera;
    const fov = ((camera?.fov ?? 50)) * Math.PI / 180;
    const canvasH = Math.max(1, renderer.domElement?.clientHeight || 1080);
    // Compute the parent object's world-space bbox centre, then measure
    // camera distance to that point. Falls back to the camera's distance
    // to the world origin if the parent has no geometry / bbox yet.
    let cameraDist;
    if (targetPos && camera?.position) {
      cameraDist = Math.max(0.5, camera.position.distanceTo(targetPos));
    } else {
      cameraDist = Math.max(0.5, camera?.position?.length?.() ?? 10);
    }
    const worldPerPx = (2 * Math.tan(fov / 2) * cameraDist) / canvasH;
    const widthWorld = Math.max(worldPerPx * 0.25, widthPx * worldPerPx);

    // Build a view-aligned ribbon up front (NOT a degenerate world-axis
    // fallback) so the wireframe is visible on the very first paint.
    // We force-update the parent's world matrix first, then build with
    // `initial=false` so the proper view-aligned perpendicular is used
    // for every segment — including the back-side ones that the
    // previous version culled (which produced the "wireframe disappears
    // as you rotate" symptom).
    const parent = edgesGeom.userData?._wireParent;
    if (parent) parent.updateWorldMatrix(true, false);
    const parentWorld = parent ? parent.matrixWorld : new THREE.Matrix4();
    let ribbonGeom = this._expandEdgesToRibbon(
      edgesGeom, widthWorld, camera, parentWorld, /* initial */ false,
    );
    const wireMesh = new THREE.Mesh(
      ribbonGeom,
      new THREE.MeshBasicMaterial({
        color,
        // Same logic as the WebGL path above — only enable blending
        // when opacity < 1 so a fully-opaque wireframe renders solid
        // without alpha blending against the surface beneath.
        transparent: opacity < 1,
        opacity,
        depthTest,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
        // Bias the ribbon toward the camera so it draws on top of the
        // mesh surface (no z-fighting, and the front-facing side of the
        // wireframe is no longer occluded by the mesh when depthTest is
        // enabled). The negative units move the ribbon "closer" to the
        // camera in depth-buffer terms. With depthTest=false this is a
        // no-op (the ribbon always draws).
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -4,
      }),
    );
    wireMesh.renderOrder = 9999;
    // Track inputs so onBeforeRender can rebuild only when needed.
    // `_needsFirstRebuild` forces one rebuild on the next render in
    // case the initial build was skipped or the camera/parent matrices
    // were not yet valid when the ribbon was constructed. This
    // guarantees the wireframe is visible from the very first painted
    // frame, not just after the user starts orbiting.
    wireMesh.userData._wireInputs = {
      edgesGeom,
      widthWorld,
      camera,
      // Cached camera view matrix; when it changes, rebuild ribbon.
      cachedCamMatrix: new THREE.Matrix4(),
      // Cached parent world matrix; when it changes, rebuild ribbon.
      cachedParentMatrix: new THREE.Matrix4().copy(parentWorld),
      width: widthWorld,
      _needsFirstRebuild: true,
    };
    const self = this;
    wireMesh.onBeforeRender = function (_renderer, _scene, activeCamera) {
      const data = this.userData._wireInputs;
      if (!data) return;
      const camMat = activeCamera.matrixWorldInverse;
      const parentNode = this.parent;
      if (!parentNode) return;
      parentNode.updateWorldMatrix(true, false);
      const parentMat = parentNode.matrixWorld;
      // Skip if neither the camera nor the parent has moved AND we've
      // already produced at least one view-aligned rebuild. This keeps
      // per-frame cost flat during idle frames while still guaranteeing
      // the first view-aligned ribbon is in place before the user sees
      // the wireframe.
      if (
        !data._needsFirstRebuild &&
        camMat.equals(data.cachedCamMatrix) &&
        parentMat.equals(data.cachedParentMatrix)
      ) return;
      data.cachedCamMatrix.copy(camMat);
      data.cachedParentMatrix.copy(parentMat);
      const newGeom = self._expandEdgesToRibbon(
        data.edgesGeom, data.widthWorld, activeCamera, parentMat, /* initial */ false,
      );
      const oldGeom = this.geometry;
      this.geometry = newGeom;
      data._needsFirstRebuild = false;
      // Dispose the previous ribbon on a microtask so we don't stomp on
      // shadow / multisample passes that are still referencing it.
      queueMicrotask(() => { try { oldGeom?.dispose?.(); } catch (_) { /* already gone */ } });
    };
    return wireMesh;
  }

  /**
   * Expand a THREE.EdgesGeometry (pairs of vertices describing line
   * segments) into a triangle ribbon of the requested world-space width.
   *
   * Each edge segment AB becomes a quad: A-l, A-r, B-r, A-l, B-r, B-l
   * where A-l/B-l and A-r/B-r are A and B pushed in opposite directions
   * along the segment's **view-aligned perpendicular** — the
   * perpendicular to AB in the screen plane (perpendicular to the
   * camera view direction at the segment's midpoint).
   *
   * Why view-aligned: a world-axis perpendicular (X / Y / Z) collapses
   * to a sliver when the segment runs parallel to the camera view, and
   * produces inconsistent offsets for adjacent ring segments (a sphere
   * cap ring has segments that change direction every step → each step
   * would pick a different world axis → the ribbon breaks into pieces
   * with gaps). A view-aligned perpendicular stays perpendicular to
   * the screen for any segment orientation, and is **stable across
   * adjacent segments in a ring** because the camera view direction
   * changes smoothly between midpoints.
   *
   * The geometry is stored in **local coordinates** (same as the input
   * EdgesGeometry) so the ribbon scales/rotates with the parent mesh.
   * World-space offsets are computed via the supplied `parentWorld`
   * matrix, then inverted back to local via the matrix's inverse.
   *
   * @param {THREE.BufferGeometry} edgesGeom   line-segment pairs in local space
   * @param {number} width                     ribbon half-width in world units
   * @param {THREE.Camera} camera              active camera (for view dir)
   * @param {THREE.Matrix4} parentWorld        parent's world matrix
   * @param {boolean} _initial                 deprecated — kept for callers; no longer used
   */
  _expandEdgesToRibbon(edgesGeom, width, camera, parentWorld, _initial) {
    const src = edgesGeom.attributes.position;
    if (!src) return edgesGeom;
    const segCount = (src.count / 2) | 0;
    const positions = new Float32Array(segCount * 6 * 3);
    const A = new THREE.Vector3();
    const B = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const dirW = new THREE.Vector3();
    const viewDir = new THREE.Vector3();
    const perpW = new THREE.Vector3();
    const offsetLocal = new THREE.Vector3();
    // Per-segment face normals (LOCAL space) attached by
    // EditableMesh.toEdgesGeometry. Used to push the ribbon outward
    // away from the surface so depth-tested wireframes don't get
    // occluded by the mesh they're drawn on top of.
    const segNormalsLocal = edgesGeom.userData?._segFaceNormals;
    const faceNormalLocal = new THREE.Vector3();
    const faceNormalWorld = new THREE.Vector3();
    const invParent = new THREE.Matrix4();
    if (parentWorld) {
      invParent.copy(parentWorld).invert();
    }
    // Stable fall-back axes for the no-camera case (rare — the editor
    // always supplies a camera). The view-aligned path is preferred
    // because it stays continuous across adjacent ring segments.
    const AXES = [
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, 1),
    ];
    const camPos = camera?.position;
    let o = 0;
    let skippedView = 0;
    let usedAxisFallback = 0;
    let outwardPushed = 0;
    for (let i = 0; i < segCount; i++) {
      A.fromBufferAttribute(src, i * 2);
      B.fromBufferAttribute(src, i * 2 + 1);
      dir.subVectors(B, A);
      if (dir.lengthSq() < 1e-10) continue;
      dir.normalize();
      // No back-face culling: the wireframe must remain continuously
      // visible from every angle, including the far side of the mesh
      // (x-ray mode). The view-aligned perpendicular naturally
      // compresses the ribbon on segments perpendicular to the camera
      // (so they read as thin lines, not flaps), but we never drop
      // segments — that was the source of the "wireframe disappears as
      // you rotate" report.
      let useFallback = false;
      let chosen = AXES[2];
      let perpIsScreenAligned = false;
      if (!camera) {
        // No camera bound to the scene — fall back to a world-axis
        // perpendicular for every segment. This branch is unreachable
        // under normal editor use; the modeler always has a camera.
        useFallback = true;
      } else {
        // Transform the segment direction into world space, then
        // compute the view direction at the segment's midpoint in
        // world space. The perpendicular = world dir × view dir, then
        // unproject back to local.
        dirW.copy(dir).transformDirection(parentWorld);
        const midLocal = A.clone().add(B).multiplyScalar(0.5);
        const midWorld = midLocal.applyMatrix4(parentWorld);
        viewDir.subVectors(camPos, midWorld);
        if (viewDir.lengthSq() < 1e-10) {
          useFallback = true;
        } else {
          viewDir.normalize();
          perpW.crossVectors(dirW, viewDir);
          if (perpW.lengthSq() < 1e-6) {
            // Segment is parallel to the view direction at this
            // midpoint — perpendicular collapses. Use axis fallback
            // for this one segment; the rest of the ring uses the
            // proper view-aligned perp.
            useFallback = true;
            skippedView += 1;
          } else {
            perpW.normalize();
            perpIsScreenAligned = true;
            // Convert the world-space perpendicular back to local.
            offsetLocal.copy(perpW).transformDirection(invParent).multiplyScalar(width);
          }
        }
      }
      if (useFallback) {
        usedAxisFallback += 1;
        // Pick first world axis not parallel to dir, then cross.
        for (let a = 0; a < 3; a++) {
          const tmp = new THREE.Vector3().crossVectors(dir, AXES[a]);
          if (tmp.lengthSq() > 1e-6) { chosen = AXES[a]; break; }
        }
        const tmpN = new THREE.Vector3().crossVectors(dir, chosen);
        if (tmpN.lengthSq() < 1e-6) continue;
        tmpN.normalize();
        offsetLocal.copy(tmpN).multiplyScalar(width);
      }
      // Push the ribbon OUTWARD away from the surface so depth-tested
      // wireframes aren't occluded by the mesh they're drawn on. The
      // view-aligned perpendicular lives in the screen plane and can
      // point in either of two directions along the segment; without
      // disambiguation, half of the front-facing segments will end up
      // with their ribbon offset INTO the mesh (and occluded by it).
      // We use the adjacent face normal(s) to pick the outward side.
      //
      // Procedure (when face normals are available):
      //   1. Average the 1-2 adjacent face normals to get the segment's
      //      outward direction in local space.
      //   2. Transform to world, then take the projection onto the
      //      screen-aligned perpendicular (already in world space).
      //   3. If the dot product is negative, flip the perpendicular so
      //      the ribbon offset points away from the surface.
      //
      // This guarantees the ribbon sits on the outside of the mesh
      // regardless of camera angle, so depth-tested wireframes are
      // visible on the front-facing side (the side that was being
      // occluded before this fix).
      // Track the LOCAL-space face normal for the outward bias added
      // below. Set in the single-face and two-face branches so the
      // coplanarity-fix can use whichever adjacent face is available.
      let faceNormalWorldForBias = null;
      if (perpIsScreenAligned && segNormalsLocal && segNormalsLocal[i] && segNormalsLocal[i].length >= 3) {
        const nf = segNormalsLocal[i];
        faceNormalLocal.set(nf[0], nf[1], nf[2]).normalize();
        faceNormalWorld.copy(faceNormalLocal).transformDirection(parentWorld);
        const dot = perpW.dot(faceNormalWorld);
        if (dot < 0) {
          offsetLocal.multiplyScalar(-1);
          outwardPushed += 1;
        }
        faceNormalWorldForBias = faceNormalWorld;
      } else if (perpIsScreenAligned && segNormalsLocal && segNormalsLocal[i] && segNormalsLocal[i].length >= 6) {
        // Two adjacent faces — average them.
        const nf = segNormalsLocal[i];
        faceNormalLocal.set(
          (nf[0] + nf[3]) * 0.5,
          (nf[1] + nf[4]) * 0.5,
          (nf[2] + nf[5]) * 0.5,
        ).normalize();
        faceNormalWorld.copy(faceNormalLocal).transformDirection(parentWorld);
        const dot = perpW.dot(faceNormalWorld);
        if (dot < 0) {
          offsetLocal.multiplyScalar(-1);
          outwardPushed += 1;
        }
        faceNormalWorldForBias = faceNormalWorld;
      }
      // Coplanarity lift: the screen-aligned perpendicular can be
      // exactly tangent to the surface when the camera looks straight
      // down a flat face (e.g. box top face viewed from above). In
      // that case the flip above has no effect (dot ≈ 0) and the
      // ribbon quad lies IN the surface plane — without a guaranteed
      // depth bias, the ribbon would z-fight the surface (and read as
      // faint / dotted) under `depthTest: true`.
      //
      // Lift direction: the **camera view direction** (NOT the face
      // normal). Previously this lift was applied along the face
      // normal, which projected onto the screen plane as a variable
      // offset depending on the face's angle relative to the camera —
      // some segments ended up with 2–3× the requested screen-pixel
      // width while others stayed at the requested width, producing
      // the visible "added geometry outline is thinner than the
      // original box outline" inconsistency reported in the editor.
      // Lifting along viewDir pulls the quad toward the camera in
      // depth-buffer terms (winning the depth test) without changing
      // the perp's screen projection, so every segment renders at the
      // requested screen-pixel thickness regardless of which face it
      // borders. `polygonOffset` (set on the wireframe material) is
      // applied on top of this lift as a second line of defence.
      if (faceNormalWorldForBias && viewDir.lengthSq() > 1e-10) {
        const liftAmount = width * 2.0;
        const liftLocal = new THREE.Vector3()
          .copy(viewDir)
          .transformDirection(invParent)
          .multiplyScalar(liftAmount);
        offsetLocal.add(liftLocal);
      }
      const aL = A;
      const aR = A.clone().add(offsetLocal);
      const bL = B;
      const bR = B.clone().add(offsetLocal);
      // Tri 1: aL, aR, bR
      positions[o++] = aL.x; positions[o++] = aL.y; positions[o++] = aL.z;
      positions[o++] = aR.x; positions[o++] = aR.y; positions[o++] = aR.z;
      positions[o++] = bR.x; positions[o++] = bR.y; positions[o++] = bR.z;
      // Tri 2: aL, bR, bL
      positions[o++] = aL.x; positions[o++] = aL.y; positions[o++] = aL.z;
      positions[o++] = bR.x; positions[o++] = bR.y; positions[o++] = bR.z;
      positions[o++] = bL.x; positions[o++] = bL.y; positions[o++] = bL.z;
    }
    if (typeof window !== 'undefined') {
      // Debug: surface the fallback count so we can see if any segments
      // are still using the world-axis perpendicular (which would
      // indicate view-aligned is failing for that segment).
      window.__cyco = window.__cyco || {};
      const stats = window.__cyco._wireRibbonStats = window.__cyco._wireRibbonStats || {};
      stats.lastBuild = {
        segCount,
        skippedView,
        usedAxisFallback,
        outwardPushed,
        hasCamera: !!camera,
      };
    }
    const ribbon = new THREE.BufferGeometry();
    ribbon.setAttribute('position', new THREE.BufferAttribute(positions.subarray(0, o), 3));
    ribbon.computeBoundingSphere();
    return ribbon;
  }

  /**
   * Build the per-vertex handle group (one small sphere per unique vertex).
   *
   * WebGPU note: THREE.Points + PointsMaterial does NOT render under
   * Three.js's WebGPU TSL pipeline — `THREE.NodeBuilder: Material
   * "ShaderMaterial" is not compatible.` is logged on every render and the
   * points are silently dropped.  Switching to InstancedMesh of small
   * spheres + MeshBasicMaterial works in BOTH WebGL and WebGPU because
   * MeshBasicMaterial has a TSL equivalent.
   *
   * `vertexSize` is the modeler "Vertex Size" slider (1..15 screen pixels).
   * We translate that to a sphere radius in world units by anchoring it to
   * the current grid cell size so the handles feel proportional to the
   * scene.  Radius is clamped so the handles never collapse to zero on
   * tiny grids.
   *
   * @param {THREE.BufferGeometry} geometry  vertex positions (x,y,z triples)
   * @param {number} color        hex color (vertexHighlight.color)
   * @param {number} vertexSize   slider value (1..15, target screen px)
   * @param {number} opacity      vertexHighlight.opacity (0..1)
   */
  _buildVertexHandles(geometry, color, vertexSize, opacity) {
    const pos = geometry?.attributes?.position;
    const count = pos?.count ?? 0;
    const sphereGeo = new THREE.SphereGeometry(1, 12, 8);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: opacity < 1,
      opacity,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const inst = new THREE.InstancedMesh(sphereGeo, mat, count);
    inst.frustumCulled = false; // handles move around the parent mesh
    inst.renderOrder = 9999;
    // Translate the screen-pixel slider value into a world-unit radius.
    // 50 px → cellSize / 2 (so a vertex handle covers ~half a grid cell
    // on screen).  Clamped so tiny grids still get visible dots.
    const cellSize = this._gridCellSize();
    const radius = Math.max(2, cellSize * Math.max(0.05, vertexSize / 50) * 0.5);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(radius, radius, radius);
    const p = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      p.set(pos.getX(i), pos.getY(i), pos.getZ(i));
      m.compose(p, q, s);
      inst.setMatrixAt(i, m);
    }
    inst.instanceMatrix.needsUpdate = true;
    return inst;
  }

  /**
   * (Removed) — the cycle modeler no longer attaches its own purple/white
   * bounding-box ribbon to selected primitives or previews. Per user
   * instruction, the engine's OutlinePass + primary shell + glow are
   * hidden entirely in modeler mode (see `applyModelerSettingsToScene`
   * and `PostProcessingPipeline._onModelerMode`), so there is no
   * duplicate engine outline to coordinate with. The modeler's
   * per-element selection visuals are drawn by `_updateHover` and
   * `_showElementOverlayForSelection` below.
   */

  _updateHover(hit) {
    if (!this.active || !hit?.object?.userData?.cycoModeler?.mesh) return this._hoverClear();
    if (this.elementMode === 'object') return this._hoverClear();
    if (this._hover?.object === hit.object && this._hover?.faceIndex === hit.faceIndex && this._hover?.mode === this.elementMode) return;
    this._hoverClear();
    const mode = this.elementMode; // 'polygon' | 'edge' | 'vertex'
    const style = this._hoverStyle[mode];
    if (!style || style.enabled === false) return;
    const geometry = this._hoverGeometryFromHit(hit, mode);
    if (!geometry) return;
    let mesh;
    if (mode === 'edge') {
      // Use Line2 so the hover edge thickness is visible (matches the
      // wireframe + selection gizmo look). The edge overlay has its own
      // `thickness` field in modeler settings — falling back to the
      // wireframe thickness keeps the look coherent if the field is
      // missing from older saved settings.
      const targetPos = this._getObjectWorldCenter(hit.object);
      mesh = this._buildFatEdges(
        geometry,
        style.color,
        Math.max(1, style.thickness ?? this._wireStyle.thickness ?? 1),
        style.opacity,
        /* depthTest */ false,
        targetPos,
      );
    } else if (mode === 'vertex') {
      // InstancedMesh of small spheres — Points + PointsMaterial does
      // not render under WebGPU/TSL (NodeBuilder rejects ShaderMaterial).
      mesh = this._buildVertexHandles(geometry, style.color, style.vertexSize, style.opacity);
    } else {
      // polygon (face) — filled translucent overlay.
      mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
          color: style.color,
          transparent: true,
          opacity: style.opacity * 0.5,
          depthTest: false,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      );
    }
    mesh.renderOrder = 9999;
    hit.object.add(mesh);
    this._hover = { object: hit.object, faceIndex: hit.faceIndex, mode, mesh };
  }

  _hoverClear() {
    if (!this._hover) return;
    this._hover.mesh?.parent?.remove(this._hover.mesh);
    this._hover.mesh?.geometry?.dispose?.();
    this._hover.mesh?.material?.dispose?.();
    this._hover = null;
  }

  _hoverGeometryFromHit(hit, mode) {
    const geom = hit.object.geometry;
    const pos = geom?.attributes?.position;
    if (!pos) return null;
    const modeler = hit.object.userData.cycoModeler;
    const dims = modeler?.dimensions || { width: 1, height: 1, depth: 1 };
    const face = this._faceInfoFromHit(hit);
    if (mode === 'polygon') {
      return this._faceGeometryFromHit(hit);
    }
    if (mode === 'edge') {
      return this._objectEdgeOverlay(hit.object);
    }
    if (mode === 'vertex') {
      return this._objectVertexOverlay(hit.object);
    }
    if (mode === 'object') {
      const box = new THREE.BoxGeometry(dims.width, dims.height, dims.depth, 1, 1, 1);
      box.translate(0, dims.height / 2, 0);
      return box;
    }
    const idx = geom.index;
    const tri = idx ? [idx.getX(hit.faceIndex * 3), idx.getX(hit.faceIndex * 3 + 1), idx.getX(hit.faceIndex * 3 + 2)] : [hit.face.a, hit.face.b, hit.face.c];
    const g = new THREE.BufferGeometry();
    const verts = new Float32Array(tri.flatMap(i => [pos.getX(i), pos.getY(i), pos.getZ(i)]));
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.computeVertexNormals();
    return g;
  }

  _faceIdFromHit(hit) {
    if (!hit?.face) return 0;
    const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    const ax = Math.abs(normal.x);
    const ay = Math.abs(normal.y);
    const az = Math.abs(normal.z);
    if (ax >= ay && ax >= az) return normal.x >= 0 ? 1 : 0;
    if (ay >= ax && ay >= az) return normal.y >= 0 ? 3 : 2;
    return normal.z >= 0 ? 5 : 4;
  }

  _faceInfoFromHit(hit) {
    return {
      0: 'left',
      1: 'right',
      2: 'bottom',
      3: 'top',
      4: 'back',
      5: 'front',
    }[this._faceIdFromHit(hit)] || 'front';
  }

  _faceQuadOverlay(object, side) {
    const dims = object.userData?.cycoModeler?.dimensions;
    if (!dims) return null;
    const g = new THREE.BufferGeometry();
    const w = dims.width / 2;
    const h = dims.height;
    const d = dims.depth / 2;
    const verts = {
      left:   [-w, 0, -d,  -w, 0, d,  -w, h, d,  -w, h, -d],
      right:  [ w, 0, -d,   w, h, -d,  w, h, d,   w, 0, d],
      bottom: [-w, 0, -d,   w, 0, -d,  w, 0, d,  -w, 0, d],
      top:    [-w, h, -d,   w, h, -d,  w, h, d,  -w, h, d],
      back:   [-w, 0, -d,  -w, h, -d,  w, h, -d,   w, 0, -d],
      front:  [-w, 0, d,    w, 0, d,   w, h, d,   -w, h, d],
    }[side] || [-w, 0, d, w, 0, d, w, h, d, -w, h, d];
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.computeVertexNormals();
    return g;
  }

  _faceGeometryFromHit(hit) {
    const mesh = EditableMesh.fromJSON(hit?.object?.userData?.cycoModeler?.mesh);
    const faces = this._faceIndicesFromHit(hit);
    const positions = [];
    for (const faceIndex of faces) {
      const face = mesh.faces[faceIndex];
      if (!face) continue;
      // Fan-triangulate so the highlight overlay renders as a filled polygon,
      // not as a single triangle strip.
      const verts = face.map(i => mesh.vertices[i]).filter(Boolean);
      if (verts.length < 3) continue;
      for (let i = 1; i < verts.length - 1; i += 1) {
        positions.push(verts[0].x, verts[0].y, verts[0].z);
        positions.push(verts[i].x, verts[i].y, verts[i].z);
        positions.push(verts[i + 1].x, verts[i + 1].y, verts[i + 1].z);
      }
    }
    if (!positions.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.computeVertexNormals();
    return g;
  }

  _objectEdgeOverlay(object) {
    // Build the edge geometry from the EditableMesh's polygon edges so the
    // hover outline matches the user-visible wireframe (no triangulation
    // diagonals on round shapes, and subdivisions of a Subdivided box
    // show as hover-able edges instead of being collapsed away).
    const meshJson = object?.userData?.cycoModeler?.mesh;
    if (meshJson && meshJson.faces && meshJson.vertices) {
      try {
        const editable = EditableMesh.fromJSON(meshJson);
        const eg = editable.toEdgesGeometry(0);
        eg.userData._wireParent = object;
        return eg;
      } catch (err) {
        // Fall through to the raw geometry below.
      }
    }
    const eg2 = new THREE.EdgesGeometry(object.geometry, 1);
    eg2.userData._wireParent = object;
    return eg2;
  }

  _objectVertexOverlay(object) {
    const pos = object.geometry?.attributes?.position;
    if (!pos) return null;
    const seen = new Set();
    const points = [];
    for (let i = 0; i < pos.count; i += 1) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const key = `${x.toFixed(4)}:${y.toFixed(4)}:${z.toFixed(4)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      points.push(x, y, z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    return g;
  }

  _showElementOverlayForSelection() {
    if (this.elementMode !== 'edge' && this.elementMode !== 'vertex') return;
    const mode = this.elementMode;
    const style = this._hoverStyle[mode];
    if (!style || style.enabled === false) return;
    // Show handles for the selection if there is one, otherwise the most
    // recently created modeler object so vertex/edge handles are visible
    // the moment the user switches into vertex/edge mode.
    let object = this._selectedModelerObjects()[0];
    if (!object) object = this._lastModelerObject;
    if (!object) {
      const scene = this.sceneManager?.getActiveScene?.();
      scene?.traverse?.(obj => {
        if (!object && obj.userData?.cycoModeler?.mesh) object = obj;
      });
    }
    if (!object) return;
    const geometry = mode === 'edge' ? this._objectEdgeOverlay(object) : this._objectVertexOverlay(object);
    if (!geometry) return;
    const targetPos = this._getObjectWorldCenter(object);
    const mesh = mode === 'edge'
      ? this._buildFatEdges(geometry, style.color, Math.max(1, style.thickness ?? this._wireStyle.thickness ?? 1), style.opacity, /* depthTest */ false, targetPos)
      : this._buildVertexHandles(geometry, style.color, style.vertexSize, style.opacity);
    mesh.renderOrder = 9999;
    object.add(mesh);
    this._hover = { object, faceIndex: -1, mode, mesh };
  }

  _faceEdgeOverlay(object, side) {
    const dims = object.userData?.cycoModeler?.dimensions;
    if (!dims) return null;
    const w = dims.width / 2;
    const h = dims.height;
    const d = dims.depth / 2;
    const edges = {
      left:   [[-w, 0, -d], [-w, 0, d], [-w, h, d], [-w, h, -d]],
      right:  [[ w, 0, -d], [ w, h, -d], [ w, h, d], [ w, 0, d]],
      bottom: [[-w, 0, -d], [ w, 0, -d], [ w, 0, d], [-w, 0, d]],
      top:    [[-w, h, -d], [ w, h, -d], [ w, h, d], [-w, h, d]],
      back:   [[-w, 0, -d], [-w, h, -d], [ w, h, -d], [ w, 0, -d]],
      front:  [[-w, 0, d], [ w, 0, d], [ w, h, d], [-w, h, d]],
    }[side] || [];
    const points = edges.flatMap((p, i) => {
      const n = edges[(i + 1) % edges.length];
      return [...p, ...n];
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    return g;
  }

  _faceVertexOverlay(object, side) {
    const dims = object.userData?.cycoModeler?.dimensions;
    if (!dims) return null;
    const w = dims.width / 2;
    const h = dims.height;
    const d = dims.depth / 2;
    const vertices = {
      left:   [[-w, 0, -d], [-w, 0, d], [-w, h, d], [-w, h, -d]],
      right:  [[ w, 0, -d], [ w, 0, d], [ w, h, d], [ w, h, -d]],
      bottom: [[-w, 0, -d], [ w, 0, -d], [ w, 0, d], [-w, 0, d]],
      top:    [[-w, h, -d], [ w, h, -d], [ w, h, d], [-w, h, d]],
      back:   [[-w, 0, -d], [ w, 0, -d], [ w, h, -d], [-w, h, -d]],
      front:  [[-w, 0, d], [ w, 0, d], [ w, h, d], [-w, h, d]],
    }[side] || [];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(vertices.flat(), 3));
    return g;
  }

  _cancelPreview() {
    if (!this._preview) return;
    this._preview.parent?.remove(this._preview);
    this._preview.traverse?.(child => {
      if (child.userData?._isModelerSelGizmo) {
        child.geometry?.dispose?.();
        child.material?.dispose?.();
      }
    });
    this._preview.geometry?.dispose?.();
    this._preview.material?.dispose?.();
    this._preview = null;
  }

  _buildPrimitiveObject(start, end, preview, drag) {
    const cell = this._gridCellSize();
    const minX = Math.min(start.x, end.x);
    const maxX = Math.max(start.x, end.x);
    const minZ = Math.min(start.z, end.z);
    const maxZ = Math.max(start.z, end.z);
    const width = Math.max(cell, maxX - minX);
    const depth = Math.max(cell, maxZ - minZ);
    // Anchor the primitive at the CENTRE of the grid cell the user
    // clicked on, then grow the footprint symmetrically outward as
    // they drag. This makes the grid the placement authority: every
    // primitive snaps to whole grid cells and centres on one, so the
    // modeler feels like a tile-based editor rather than a free draw.
    // `_snapPoint` snaps `start` to grid LINES (multiples of `cell`),
    // so the cell that contains the click runs from
    // [start.x .. start.x + cell] on X and [start.z .. start.z + cell]
    // on Z. The cell centre is therefore `start + cell/2` on each axis.
    const anchorX = start.x + cell / 2;
    const anchorZ = start.z + cell / 2;
    // Height: defaults to one grid cell. Drag the mouse UP from the
    // initial click to grow the height (drag-down collapses back to
    // the floor). We translate the screen-pixel delta into world units
    // using the current camera so a 100px upward drag yields the same
    // world height regardless of zoom.
    const startClientY = drag?.startClientY;
    const lastClientY = drag?.lastClientY;
    const heightPx = (typeof startClientY === 'number' && typeof lastClientY === 'number')
      ? (startClientY - lastClientY)
      : 0;
    const heightWorldPerPx = this._heightWorldPerPixel();
    const height = Math.max(cell, cell + heightPx * heightWorldPerPx);
    // Every primitive is built as an EditableMesh so it has the
    // `faceId` attribute and the per-face JSON the rest of the modeler
    // (hover, polygon / edge / vertex selection, Push/Pull, eraser,
    // subdivide, etc.) relies on. Without this the non-box primitives
    // were rendered as raw Three.js geometry with no editable mesh and
    // therefore could not be interacted with.
    const editableMesh = this._makeEditablePrimitive(this.primitiveTool, width, height, depth);
    const geometry = editableMesh
      ? editableMesh.toBufferGeometry()
      : this._makePrimitiveGeometry(this.primitiveTool, width, height, depth);
    const material = new THREE.MeshStandardMaterial({
      color: 0x8888aa,
      opacity: preview ? 0.45 : 1,
      transparent: preview,
      roughness: 0.7,
      metalness: 0.1,
      // Front-only for committed primitives — solid / solid+wire
      // mode should show only the outer surface (back faces are
      // culled, so the inside of the box isn't visible through the
      // front face). Preview primitives keep `DoubleSide` so the
      // user sees the whole volume while dragging.
      side: preview ? THREE.DoubleSide : THREE.FrontSide,
    });
    const object = new THREE.Mesh(geometry, material);
    object.name = preview
      ? `Cycle Modeler ${this._label(this.primitiveTool)} Preview`
      : `Cycle Modeler ${this._label(this.primitiveTool)}`;
    // Box-shaped primitives (box, room, stair, side-stair, spiral-stair,
    // and the thin line / arc / disk / rounded-rectangle / parallel
    // placeholders) sit with their floor at local Y=0, so the object
    // can be placed directly on the grid (Y=0). Round primitives
    // (cylinder, cone, sphere, capsule, torus, icosahedron) are centered
    // around their origin, so they need Y = height/2 to rest on the
    // grid like a box.
    //
    // Floor-anchored primitives are POSITIONED at the centre of the
    // grid cell under the cursor (the bottom-back corner of the
    // footprint shifts to `anchor - width/2`, `anchor - depth/2`),
    // so every primitive is centred on a grid cell and the grid is
    // the placement authority. Dragging grows the footprint
    // symmetrically outward from that cell centre. Round primitives
    // anchor their origin at the same cell centre and use
    // max(width, depth) as their horizontal extent.
    const floorAnchored = new Set([
      'box', 'room', 'stair', 'side-stair', 'spiral-stair',
      'line', 'parallel', 'arc', 'disk', 'rounded-rectangle',
    ]);
    const isFloor = floorAnchored.has(this.primitiveTool);
    // Floor-anchored primitives (box, room, stair, side-stair,
    // spiral-stair, line/parallel/arc/disk/rounded-rectangle) all
    // position their local origin at the click point — the clicked
    // cell becomes the bottom-back corner for box-shaped footprints,
    // or the centre for radially symmetric ones (spiral-stair).
    // Round primitives (cylinder, cone, sphere, capsule, torus,
    // icosahedron) have their origin at the geometric centre, so
    // they also anchor at the click point without any offset.
    object.position.set(
      anchorX,
      isFloor ? 0 : height / 2,
      anchorZ,
    );
    object.castShadow = !preview;
    object.receiveShadow = !preview;
    object.userData._editorOnly = preview;
    object.userData.cycoModeler = {
      type: editableMesh ? 'editableMesh' : 'primitiveMesh',
      primitive: this.primitiveTool,
      dimensions: { width, height, depth },
      elementMode: this.elementMode,
      mesh: editableMesh?.toJSON?.() ?? null,
      selectedFaces: [],
    };
    return object;
  }

  /**
   * Build an EditableMesh for every supported primitive so the result is
   * fully editable (face selection, Push/Pull, vertex / edge hover, etc.).
   * Returns null for primitives that intentionally do not produce 3D
   * faces (the thin line / parallel "rectangle" pieces) so the caller
   * falls back to `_makePrimitiveGeometry` for those.
   */
  _makeEditablePrimitive(tool, width, height, depth) {
    switch (tool) {
      case 'box':
        return EditableMesh.boxFromBounds(
          new THREE.Vector3(-width / 2, 0, -depth / 2),
          new THREE.Vector3(width / 2, height, depth / 2)
        );
      case 'room':
        return EditableMesh.room(width, height, depth);
      case 'stair': {
        // Rotate the stair 180° about Y so its FRONT (the low end,
        // first riser) faces +Z toward the default camera, matching
        // how every other modeler (Blender, SketchUp, UModeler)
        // orients a freshly-drawn stair.
        const stair = EditableMesh.stair(width, height, depth);
        for (const v of stair.vertices) {
          const x = v.x;
          const z = v.z;
          v.x = -x;
          v.z = -z;
        }
        // Reverse the back-face winding so its outward normal still
        // points away from the stair body after the 180° flip (the
        // vertex mirror flips the normals of every face; the back
        // face needs explicit correction).
        const last = stair.faces[stair.faces.length - 1];
        stair.faces[stair.faces.length - 1] = [last[0], last[3], last[2], last[1]];
        return stair;
      }
      case 'side-stair': {
        // Same 180° Y rotation as `stair` — applied AFTER the 90°
        // rotation that `sideStair` performs internally.
        const stair = EditableMesh.sideStair(width, height, depth);
        for (const v of stair.vertices) {
          const x = v.x;
          const z = v.z;
          v.x = -x;
          v.z = -z;
        }
        const last = stair.faces[stair.faces.length - 1];
        stair.faces[stair.faces.length - 1] = [last[0], last[3], last[2], last[1]];
        return stair;
      }
      case 'spiral-stair':
        return EditableMesh.spiralStair(width, height, depth);
      case 'cylinder':
        return EditableMesh.cylinder(width, height, depth);
      case 'cone':
        return EditableMesh.cone(width, height, depth);
      case 'sphere':
        return EditableMesh.sphere(width, height, depth);
      case 'capsule':
        return EditableMesh.capsule(width, height, depth);
      case 'torus':
        return EditableMesh.torus(width, height, depth);
      case 'icosahedron':
        return EditableMesh.icosahedron(width, height, depth);
      case 'arc':
      case 'disk':
      case 'rounded-rectangle':
      case 'line':
      case 'parallel':
        // Thin shapes are kept as raw geometries so they render flat, but
        // we still wrap them in an EditableMesh so the modeler treats
        // them like every other primitive for selection / hover purposes.
        return EditableMesh.boxFromBounds(
          new THREE.Vector3(-width / 2, 0, -depth / 2),
          new THREE.Vector3(width / 2, Math.max(1, height * 0.08), depth / 2)
        );
      default:
        return EditableMesh.boxFromBounds(
          new THREE.Vector3(-width / 2, 0, -depth / 2),
          new THREE.Vector3(width / 2, height, depth / 2)
        );
    }
  }

  /**
   * Fallback thin-geometry factory for shapes that look wrong as solid
   * blocks (e.g. an `arc` should be a half-torus, a `disk` should be a
   * thin cylinder, a `rounded-rectangle` should be a RoundedBox). The
   * editable mesh above provides the polygon topology for selection /
   * Push/Pull; this factory only fills in the visible geometry when
   * the editable mesh is a placeholder box.
   */
  _makePrimitiveGeometry(tool, width, height, depth) {
    switch (tool) {
      case 'line':
      case 'parallel':
        return new THREE.BoxGeometry(Math.max(width, this._gridCellSize()), Math.max(1, height * 0.05), Math.max(1, depth * 0.08));
      case 'arc': return new THREE.TorusGeometry(Math.max(width, depth) / 2, Math.max(1, height * 0.08), 8, 32, Math.PI);
      case 'disk': return new THREE.CylinderGeometry(Math.max(width, depth) / 2, Math.max(width, depth) / 2, Math.max(1, height * 0.08), 48);
      case 'rounded-rectangle': return new RoundedBoxGeometry(width, Math.max(1, height * 0.08), depth, 3, Math.max(1, this._gridCellSize() * 0.05));
      case 'room': return new THREE.BoxGeometry(width, height, depth, 1, 1, 1).translate(0, height / 2, 0);
      case 'stair':
      case 'side-stair':
      case 'spiral-stair':
        return new THREE.BoxGeometry(width, height, depth, 1, 4, 1).translate(0, height / 2, 0);
      case 'cylinder': return new THREE.CylinderGeometry(width / 2, width / 2, height, 32);
      case 'cone': return new THREE.ConeGeometry(width / 2, height, 32);
      case 'sphere': return new THREE.SphereGeometry(Math.max(width, depth) / 2, 32, 16);
      case 'capsule': return new THREE.CapsuleGeometry(Math.max(width, depth) / 2, height, 4, 8);
      case 'torus': return new THREE.TorusGeometry(Math.max(width, depth) / 2, Math.max(1, height / 5), 16, 64);
      case 'icosahedron': return new THREE.IcosahedronGeometry(Math.max(width, depth) / 2);
      case 'box':
      default:
        return new THREE.BoxGeometry(width, height, depth, 1, 1, 1).translate(0, height / 2, 0);
    }
  }

  _commitObject(object) {
    this._lastModelerObject = object;
    const sceneManager = this.sceneManager;
    const selectionManager = this.selectionManager;
    window.dispatchEvent(new CustomEvent('cyco-command-execute', {
      detail: {
        name: 'Create Modeler Box',
        do: () => {
          sceneManager.addObject(object);
          this._syncWireOverlay(object);
          selectionManager?.setSelectedObjects?.([object]);
        },
        undo: () => {
          sceneManager.removeObjectKeepAlive(object.userData.cycoId);
          selectionManager?.clearSelection?.();
        },
      }
    }));
    this._status(`${object.name} created`);
  }

  _selectAllModelerObjects() {
    const scene = this.sceneManager?.getActiveScene?.();
    if (!scene) return;
    const objects = [];
    scene.traverse(obj => {
      if (obj.userData?.cycoModeler?.type === 'editableMesh') objects.push(obj);
    });
    this.selectionManager?.setSelectedObjects?.(objects);
    this._status(`Selected ${objects.length} modeler object${objects.length === 1 ? '' : 's'}`);
  }

  _invertModelerSelection() {
    const scene = this.sceneManager?.getActiveScene?.();
    if (!scene) return;
    const current = new Set(this.selectionManager?.getSelectedObjects?.() ?? []);
    const objects = [];
    scene.traverse(obj => {
      if (obj.userData?.cycoModeler && !current.has(obj)) objects.push(obj);
    });
    this.selectionManager?.setSelectedObjects?.(objects);
    this._status(`Inverted selection (${objects.length})`);
  }

  _deleteSelectedModelerObjects() {
    const objects = this._selectedModelerObjects();
    if (!objects.length) {
      this._status('No modeler objects selected');
      return;
    }
    const sceneManager = this.sceneManager;
    const selectionManager = this.selectionManager;
    window.dispatchEvent(new CustomEvent('cyco-command-execute', {
      detail: {
        name: 'Delete Modeler Selection',
        do: () => {
          for (const obj of objects) sceneManager.removeObjectKeepAlive(obj.userData.cycoId);
          selectionManager?.clearSelection?.();
        },
        undo: () => {
          for (const obj of objects) sceneManager.addObject(obj);
          selectionManager?.setSelectedObjects?.(objects);
        },
      }
    }));
    this._status(`Deleted ${objects.length} modeler object${objects.length === 1 ? '' : 's'}`);
  }

  _duplicateSelectedModelerObjects(name = 'Duplicate Modeler Selection') {
    const objects = this._selectedModelerObjects();
    if (!objects.length) {
      this._status('No modeler objects selected');
      return;
    }
    const clones = objects.map(obj => {
      const clone = obj.clone(true);
      clone.userData = JSON.parse(JSON.stringify(obj.userData || {}));
      delete clone.userData.cycoId;
      clone.position.x += this._gridCellSize();
      clone.position.z += this._gridCellSize();
      clone.name = `${obj.name} Copy`;
      return clone;
    });
    const sceneManager = this.sceneManager;
    const selectionManager = this.selectionManager;
    window.dispatchEvent(new CustomEvent('cyco-command-execute', {
      detail: {
        name,
        do: () => {
          for (const clone of clones) sceneManager.addObject(clone);
          selectionManager?.setSelectedObjects?.(clones);
        },
        undo: () => {
          for (const clone of clones) sceneManager.removeObjectKeepAlive(clone.userData.cycoId);
          selectionManager?.setSelectedObjects?.(objects);
        },
      }
    }));
    this._status(`Duplicated ${clones.length} modeler object${clones.length === 1 ? '' : 's'}`);
  }

  _mirrorSelectedModelerObjects() {
    const objects = this._selectedModelerObjects();
    if (!objects.length) {
      this._status('No modeler objects selected');
      return;
    }
    const before = objects.map(obj => obj.scale.clone());
    window.dispatchEvent(new CustomEvent('cyco-command-execute', {
      detail: {
        name: 'Mirror Modeler Selection',
        do: () => objects.forEach(obj => { obj.scale.x *= -1; }),
        undo: () => objects.forEach((obj, i) => obj.scale.copy(before[i])),
      }
    }));
    this._status('Mirrored selection on X');
  }

  _refreshSelectedModelerMeshes() {
    const objects = this._selectedModelerObjects();
    for (const obj of objects) {
      obj.geometry?.computeVertexNormals?.();
      obj.geometry?.computeBoundingBox?.();
      obj.geometry?.computeBoundingSphere?.();
      obj.geometry.attributes.position.needsUpdate = true;
    }
    this._status(`Refreshed ${objects.length} modeler object${objects.length === 1 ? '' : 's'}`);
  }

  _combineSelectedModelerObjects(label) {
    const objects = this._selectedModelerObjects();
    if (objects.length < 2) {
      this._status(`${label} requires two or more modeler objects`);
      return;
    }
    const group = new THREE.Group();
    group.name = `Cycle Modeler ${label}`;
    group.userData.cycoModeler = { type: 'combinedObject', operation: label.toLowerCase() };
    const parents = objects.map(obj => obj.parent);
    const matrices = objects.map(obj => obj.matrix.clone());
    window.dispatchEvent(new CustomEvent('cyco-command-execute', {
      detail: {
        name: label,
        do: () => {
          for (const obj of objects) group.add(obj);
          this.sceneManager.addObject(group);
          this.selectionManager?.setSelectedObjects?.([group]);
        },
        undo: () => {
          this.sceneManager.removeObjectKeepAlive(group.userData.cycoId);
          objects.forEach((obj, i) => {
            obj.matrix.copy(matrices[i]);
            obj.matrix.decompose(obj.position, obj.quaternion, obj.scale);
            parents[i]?.add(obj);
          });
          this.selectionManager?.setSelectedObjects?.(objects);
        },
      }
    }));
    this._status(`${label} applied`);
  }

  _flattenSelected() {
    const objects = this._selectedModelerObjects();
    const before = objects.map(obj => this._snapshotObjectGeometry(obj));
    window.dispatchEvent(new CustomEvent('cyco-command-execute', {
      detail: {
        name: 'Flatten',
        do: () => objects.forEach(obj => {
          const d = this._dimensionsOf(obj);
          this._applyDimensions(obj, { ...d, primitive: obj.userData.cycoModeler?.primitive ?? 'box', height: Math.max(1, this._gridCellSize() * 0.05) });
        }),
        undo: () => objects.forEach((obj, i) => this._restoreObjectGeometry(obj, before[i])),
      }
    }));
    this._status('Flatten applied');
  }

  _snapSelectedToGrid(label) {
    const objects = this._selectedModelerObjects();
    const before = objects.map(obj => obj.position.clone());
    const step = this._gridCellSize();
    window.dispatchEvent(new CustomEvent('cyco-command-execute', {
      detail: {
        name: label,
        do: () => objects.forEach(obj => {
          obj.position.x = Math.round(obj.position.x / step) * step;
          obj.position.y = Math.round(obj.position.y / step) * step;
          obj.position.z = Math.round(obj.position.z / step) * step;
        }),
        undo: () => objects.forEach((obj, i) => obj.position.copy(before[i])),
      }
    }));
    this._status(`${label} applied`);
  }

  _centerSelectedPivots() {
    const objects = this._selectedModelerObjects();
    for (const obj of objects) {
      obj.geometry?.center?.();
    }
    this._status('Pivot centered');
  }

  _bakeSelectedTransforms() {
    const objects = this._selectedModelerObjects();
    const before = objects.map(obj => this._snapshotObjectGeometry(obj));
    window.dispatchEvent(new CustomEvent('cyco-command-execute', {
      detail: {
        name: 'Bake Transform',
        do: () => objects.forEach(obj => {
          obj.updateMatrix();
          obj.geometry.applyMatrix4(obj.matrix);
          obj.position.set(0, 0, 0);
          obj.rotation.set(0, 0, 0);
          obj.scale.set(1, 1, 1);
          obj.updateMatrix();
        }),
        undo: () => objects.forEach((obj, i) => this._restoreObjectGeometry(obj, before[i])),
      }
    }));
    this._status('Transform baked');
  }

  _resizeSelected(delta, label) {
    const objects = this._selectedModelerObjects();
    if (!objects.length) {
      this._status('No modeler objects selected');
      return;
    }
    const before = objects.map(obj => this._snapshotObjectGeometry(obj));
    const after = objects.map(obj => {
      const d = this._dimensionsOf(obj);
      return {
        width: Math.max(this._gridCellSize() * 0.25, d.width + (delta.dx ?? 0)),
        height: Math.max(this._gridCellSize() * 0.25, d.height + (delta.dy ?? 0)),
        depth: Math.max(this._gridCellSize() * 0.25, d.depth + (delta.dz ?? 0)),
        primitive: obj.userData.cycoModeler?.primitive ?? 'box',
        bevel: obj.userData.cycoModeler?.bevel ?? 0,
      };
    });
    window.dispatchEvent(new CustomEvent('cyco-command-execute', {
      detail: {
        name: label,
        do: () => objects.forEach((obj, i) => this._applyDimensions(obj, after[i])),
        undo: () => objects.forEach((obj, i) => this._restoreObjectGeometry(obj, before[i])),
      }
    }));
    this._status(`${label} applied`);
  }

  _subdivideSelected(tool) {
    const objects = this._selectedModelerObjects();
    if (!objects.length) {
      this._status('No modeler objects selected');
      return;
    }
    const before = objects.map(obj => this._snapshotObjectGeometry(obj));
    const after = objects.map(obj => {
      const d = this._dimensionsOf(obj);
      return { ...d, primitive: 'box-subdivided', segments: (obj.userData.cycoModeler?.segments ?? 1) + 1 };
    });
    window.dispatchEvent(new CustomEvent('cyco-command-execute', {
      detail: {
        name: this._label(tool),
        do: () => objects.forEach((obj, i) => this._applyDimensions(obj, after[i])),
        undo: () => objects.forEach((obj, i) => this._restoreObjectGeometry(obj, before[i])),
      }
    }));
    this._status(`${this._label(tool)} applied`);
  }

  _bevelSelected() {
    const objects = this._selectedModelerObjects();
    if (!objects.length) {
      this._status('No modeler objects selected');
      return;
    }
    const before = objects.map(obj => this._snapshotObjectGeometry(obj));
    const after = objects.map(obj => {
      const d = this._dimensionsOf(obj);
      return { ...d, primitive: 'rounded-box', bevel: Math.max(1, this._gridCellSize() * 0.08) };
    });
    window.dispatchEvent(new CustomEvent('cyco-command-execute', {
      detail: {
        name: 'Bevel',
        do: () => objects.forEach((obj, i) => this._applyDimensions(obj, after[i])),
        undo: () => objects.forEach((obj, i) => this._restoreObjectGeometry(obj, before[i])),
      }
    }));
    this._status('Bevel applied');
  }

  _dimensionsOf(obj) {
    const d = obj.userData.cycoModeler?.dimensions;
    if (d) return { width: d.width, height: d.height, depth: d.depth };
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    return { width: size.x, height: size.y, depth: size.z };
  }

  _snapshotObjectGeometry(obj) {
    return {
      geometry: obj.geometry,
      position: obj.position.clone(),
      userData: JSON.parse(JSON.stringify(obj.userData || {})),
    };
  }

  _restoreObjectGeometry(obj, snapshot) {
    if (!snapshot) return;
    if (obj.geometry !== snapshot.geometry) obj.geometry?.dispose?.();
    obj.geometry = snapshot.geometry;
    obj.position.copy(snapshot.position);
    obj.userData = JSON.parse(JSON.stringify(snapshot.userData || {}));
    this._syncWireOverlay(obj);
  }

  _applyDimensions(obj, dims) {
    const oldGeometry = obj.geometry;
    const built = this._geometryFromDimensions(dims);
    obj.geometry = built.geometry;
    oldGeometry?.dispose?.();
    obj.position.y = dims.primitive === 'rounded-box' ? dims.height / 2 : 0;
    // Rebuild `cycoModeler.mesh` from the same EditableMesh the
    // geometry came from (or null for primitives without one). Without
    // this, `_syncWireOverlay` reads the OLD mesh JSON and renders the
    // pre-subdivide outline, hiding the new polygon subdivisions
    // (`_faceIndicesFromHit` / push-pull also use this same JSON, so
    // keeping it in sync fixes selection regressions too).
    obj.userData.cycoModeler = {
      ...(obj.userData.cycoModeler || {}),
      primitive: dims.primitive,
      dimensions: { width: dims.width, height: dims.height, depth: dims.depth },
      bevel: dims.bevel ?? 0,
      segments: dims.segments ?? obj.userData.cycoModeler?.segments ?? 1,
      mesh: built.mesh ? built.mesh.toJSON() : null,
      // A subdivision invalidates the previous polygon selection —
      // face indices no longer map 1:1 to the new mesh.
      selectedFaces: [],
      selectedEdges: [],
      selectedVertices: [],
    };
    this._syncWireOverlay(obj);
  }

  _geometryFromDimensions(dims) {
    if (dims.primitive === 'rounded-box') {
      // RoundedBoxGeometry's triangulation doesn't map to a clean
      // polygon mesh, so we can't build an EditableMesh for it. The
      // wireframe overlay falls back to `THREE.EdgesGeometry(obj.geometry)`
      // when `cycoModeler.mesh` is null, which still gives an accurate
      // outline of the rounded shape (no flat subdivisions to show
      // anyway).
      return { geometry: new RoundedBoxGeometry(dims.width, dims.height, dims.depth, 3, dims.bevel ?? 1), mesh: null };
    }
    if (dims.primitive === 'box-subdivided') {
      const segments = Math.max(1, Math.round(dims.segments ?? 2));
      const mesh = EditableMesh.boxSubdivided(dims.width, dims.height, dims.depth, segments);
      return { geometry: mesh.toBufferGeometry(), mesh };
    }
    const mesh = EditableMesh.boxFromBounds(
      new THREE.Vector3(-dims.width / 2, 0, -dims.depth / 2),
      new THREE.Vector3(dims.width / 2, dims.height, dims.depth / 2)
    );
    return { geometry: mesh.toBufferGeometry(), mesh };
  }

  _modelerHitFromEvent(event) {
    const renderer = this.viewportEngine?.rendererManager?.renderer;
    const camera = this.viewportEngine?.camera;
    const scene = this.sceneManager?.getActiveScene?.();
    if (!renderer?.domElement || !camera || !scene) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, camera);
    const targets = [];
    scene.traverse(obj => {
      // Any object tagged as a modeler object is pickable, even if its
      // `cycoModeler.mesh` is null (e.g. a `rounded-box` whose triangulation
      // doesn't map cleanly to a polygon mesh — selection still works on
      // the underlying BufferGeometry).
      if (obj.userData?.cycoModeler) targets.push(obj);
    });
    const hits = raycaster.intersectObjects(targets, false);
    if (!hits.length) return null;
    // Prefer the closest hit whose world-space face normal faces the
    // camera (UModeler-style: highlight the side you're looking at).
    // Among camera-facing hits, distance breaks ties so the visible face
    // closest to the cursor wins.
    const camDir = new THREE.Vector3();
    let best = hits[0];
    let bestScore = -Infinity;
    for (const hit of hits) {
      if (!hit.face) continue;
      camDir.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
      const facing = -camDir.dot(raycaster.ray.direction);
      if (facing <= 0) continue;
      const score = facing * 1e3 - hit.distance;
      if (score > bestScore) {
        bestScore = score;
        best = hit;
      }
    }
    // Fallback: no camera-facing hit found (camera inside the box);
    // return the closest hit so the user still gets feedback.
    if (bestScore === -Infinity) return hits[0];
    return best;
  }

  _pushSelectedFaces(distance, label) {
    const objects = this._selectedModelerObjects().filter(obj => {
      const m = obj.userData.cycoModeler;
      return m?.mesh && (m.selectedFaces?.length || m.selectedEdges?.length || m.selectedVertices?.length);
    });
    if (!objects.length) return false;
    const before = objects.map(obj => this._snapshotObjectGeometry(obj));
    window.dispatchEvent(new CustomEvent('cyco-command-execute', {
      detail: {
        name: label,
        do: () => objects.forEach(obj => {
          const mesh = EditableMesh.fromJSON(obj.userData.cycoModeler.mesh);
          const modeler = obj.userData.cycoModeler;
          const faces = modeler.selectedFaces?.length
            ? modeler.selectedFaces
            : this._faceIndicesForSelection(modeler);
          mesh.pushFaces(faces, distance);
          this._applyEditableMesh(obj, mesh);
        }),
        undo: () => objects.forEach((obj, i) => this._restoreObjectGeometry(obj, before[i])),
      }
    }));
    this._status(`${label} applied to selected polygon`);
    return true;
  }

  _applyPushPreview(obj, meshJSON, distance) {
    if (!obj?.userData?.cycoModeler?.mesh) return;
    const mesh = EditableMesh.fromJSON(meshJSON);
    const modeler = obj.userData.cycoModeler;
    const faces = modeler.selectedFaces?.length ? modeler.selectedFaces : this._faceIndicesForSelection(modeler);
    mesh.pushFaces(faces, distance);
    this._applyEditableMesh(obj, mesh);
  }

  _deleteSelectedFaces() {
    const objects = this._selectedModelerObjects().filter(obj => {
      const m = obj.userData.cycoModeler;
      return m?.mesh && (m.selectedFaces?.length || m.selectedEdges?.length || m.selectedVertices?.length);
    });
    if (!objects.length) return false;
    const before = objects.map(obj => this._snapshotObjectGeometry(obj));
    window.dispatchEvent(new CustomEvent('cyco-command-execute', {
      detail: {
        name: 'Delete Polygons',
        do: () => objects.forEach(obj => {
          const mesh = EditableMesh.fromJSON(obj.userData.cycoModeler.mesh);
          const modeler = obj.userData.cycoModeler;
          mesh.removeFaces(modeler.selectedFaces?.length ? modeler.selectedFaces : this._faceIndicesForSelection(modeler));
          this._applyEditableMesh(obj, mesh);
          obj.userData.cycoModeler.selectedFaces = [];
          obj.userData.cycoModeler.selectedEdges = [];
          obj.userData.cycoModeler.selectedVertices = [];
        }),
        undo: () => objects.forEach((obj, i) => this._restoreObjectGeometry(obj, before[i])),
      }
    }));
    this._status('Selected polygon deleted');
    return true;
  }

  _applyEditableMesh(obj, editableMesh) {
    const old = obj.geometry;
    obj.geometry = editableMesh.toBufferGeometry();
    old?.dispose?.();
    obj.geometry.computeBoundingBox();
    const size = obj.geometry.boundingBox.getSize(new THREE.Vector3());
    obj.userData.cycoModeler = {
      ...(obj.userData.cycoModeler || {}),
      type: 'editableMesh',
      primitive: 'custom',
      dimensions: { width: size.x, height: size.y, depth: size.z },
      mesh: editableMesh.toJSON(),
    };
    this._syncWireOverlay(obj);
  }

  _syncWireOverlay(obj) {
    if (!obj?.geometry || !obj.userData?.cycoModeler) return;
    this._removeWireOverlay(obj);
    const visible = this.wireMode !== 'wire';
    if (Array.isArray(obj.material)) obj.material.forEach(mat => { mat.visible = visible; });
    else if (obj.material) obj.material.visible = visible;
    if (this.wireMode === 'solid') return;
    if (!this._wireStyle.enabled) return;
    // Build the wireframe from the EditableMesh's polygon edges (not the
    // triangulated BufferGeometry). The polygon-based path keeps the
    // wireframe outline aligned with the source faces — a sphere shows
    // latitude + longitude quads, a stair shows step treads + risers
    // (no diagonal slashes), etc. Falls back to the triangulated mesh
    // for objects whose EditableMesh data is missing (legacy / imported).
    let edgesGeom = null;
    const meshJson = obj.userData.cycoModeler?.mesh;
    if (meshJson && meshJson.faces && meshJson.vertices) {
      try {
        const editable = EditableMesh.fromJSON(meshJson);
        // Threshold 0 → keep every polygon boundary edge including
        // subdivision lines (e.g. the Subdivide tool splits each
        // box face into s×s cells; threshold 1 would cull those
        // internal coplanar edges and the wireframe would show only
        // the box outline, hiding the subdivisions the user just
        // applied). Spheres and other primitives still draw their
        // silhouette correctly because non-coplanar face boundaries
        // are always emitted.
        edgesGeom = editable.toEdgesGeometry(0);
      } catch (err) {
        edgesGeom = null;
      }
    }
    if (!edgesGeom) edgesGeom = new THREE.EdgesGeometry(obj.geometry, 1);
    edgesGeom.userData._wireParent = obj;
    // Per-mode wireframe rendering:
    //
    //   solid-wire : mesh visible behind the lines. `depthTest: true`
    //                so back-side edges are OCCLUDED by the front
    //                mesh faces (no X-ray bleed-through to the
    //                inside of the box). The ribbon code adds an
    //                outward lift along the face normal so
    //                front-side edges win the depth test and render
    //                at full strength.
    //   wire       : mesh hidden. `depthTest: false` so the lines
    //                always draw regardless of camera / segment
    //                orientation. Color forced to white so the lines
    //                are legible against the dark scene background.
    let depthTest;
    let wireColor;
    if (this.wireMode === 'wire') {
      depthTest = false;
      wireColor = 0xffffff;
    } else {
      // 'solid-wire'
      depthTest = true;
      wireColor = this._wireStyle.color;
    }
    const targetPos = this._getObjectWorldCenter(obj);
    const wire = this._buildFatEdges(
      edgesGeom,
      wireColor,
      this._wireStyle.thickness,
      this._wireStyle.opacity,
      /* depthTest */ depthTest,
      targetPos,
    );
    wire.name = 'CycleModelerWireOverlay';
    wire.userData._editorOnly = true;
    wire.userData._isModelerWire = true;
    obj.add(wire);
    this.selectionManager?.addNonSelectable?.(wire);
  }

  _removeWireOverlay(obj) {
    const overlays = obj.children.filter(child => child.userData?._isModelerWire);
    for (const overlay of overlays) {
      obj.remove(overlay);
      overlay.geometry?.dispose?.();
      overlay.material?.dispose?.();
    }
  }

  _faceIndicesForSelection(modeler) {
    if (modeler?.selectedFaces?.length) return modeler.selectedFaces;
    if (modeler?.selectedEdges?.length) return [Math.floor((modeler.selectedEdges[0] ?? 0) / 2)];
    if (modeler?.selectedVertices?.length) return [0, 1];
    return [];
  }

  _selectedModelerObjects() {
    return (this.selectionManager?.getSelectedObjects?.() ?? [])
      .filter(obj => obj?.userData?.cycoModeler);
  }

  // ── Multi-select helpers ──────────────────────────────────────────────────
  // Helpers for the multi-push-pull tool + element-mode marquee
  // multi-select. The marquee is screen-rect based (not raycast based)
  // because we need to capture MANY elements with a single drag, not
  // just the one under the cursor.

  /** Toggle-add the items in `incoming` onto `existing`. Items already
   *  present in `existing` are removed. The returned array is a fresh
   *  array so callers can write it back to the modeler userData without
   *  worrying about aliasing. */
  _toggleArray(existing, incoming) {
    const out = new Set(Array.isArray(existing) ? existing : []);
    for (const item of (incoming || [])) {
      if (out.has(item)) out.delete(item);
      else out.add(item);
    }
    return Array.from(out);
  }

  /** True if any modeler object in the current scene selection has at
   *  least one selected face/edge/vertex. Used by the multi-push/pull
   *  pointerdown to bail when the user clicks empty space in an
   *  empty scene. */
  _hasAnyElementSelection() {
    return this._selectedModelerObjects().some(obj => {
      const m = obj.userData.cycoModeler;
      return m && (m.selectedFaces?.length || m.selectedEdges?.length || m.selectedVertices?.length);
    });
  }

  /** Total selected elements across all selected modeler objects.
   *  Faces, edges and vertices count independently so the status text
   *  shows e.g. "3 polygons + 2 edges selected". */
  _countSelectedElements() {
    let n = 0;
    for (const obj of this._selectedModelerObjects()) {
      const m = obj.userData.cycoModeler;
      if (!m) continue;
      n += m.selectedFaces?.length || 0;
      n += m.selectedEdges?.length || 0;
      n += m.selectedVertices?.length || 0;
    }
    return n;
  }

  /** Returns "N polygons + M edges + K vertices selected" — used by
   *  status updates after a marquee or push/pull operation. */
  _elemMarqueeSummary() {
    let f = 0, e = 0, v = 0;
    for (const obj of this._selectedModelerObjects()) {
      const m = obj.userData.cycoModeler;
      if (!m) continue;
      f += m.selectedFaces?.length || 0;
      e += m.selectedEdges?.length || 0;
      v += m.selectedVertices?.length || 0;
    }
    const parts = [];
    if (f) parts.push(`${f} polygon${f === 1 ? '' : 's'}`);
    if (e) parts.push(`${e} edge${e === 1 ? '' : 's'}`);
    if (v) parts.push(`${v} vertex${v === 1 ? '' : 'es'}`);
    return parts.length ? `Selected: ${parts.join(' + ')}` : 'Selection cleared';
  }

  /**
   * Begin an element-level marquee drag. Captures pointer input,
   * disables OrbitControls, and seeds the selection set to either
   * the click hit's element group (replace) or the existing multi-
   * selection (additive shift/ctrl).
   */
  _startElementMarquee(event) {
    if (this._boxDrag || this._faceDrag) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    try { this._canvas?.setPointerCapture?.(event.pointerId); } catch (_) { /* synthetic events */ }
    this.viewportEngine.controls.enabled = false;
    window.__cyco = window.__cyco || {};
    window.__cyco._suppressSelectionManagerClick = true;
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    const hit = this._modelerHitFromEvent(event);
    const seedObject = hit?.object?.userData?.cycoModeler ? hit.object : null;
    // Make sure the seed object is part of the scene-level selection
    // (SelectionManager.set) so multi-push/pull can find it later
    // via `_selectedModelerObjects`. When not additive we reset the
    // selection to just the seed object; when additive we add it
    // to the existing set.
    if (seedObject) {
      const selMgr = this.selectionManager;
      if (!additive) {
        selMgr?.setSelectedObjects?.([seedObject]);
      } else if (!selMgr?.selected?.has?.(seedObject)) {
        selMgr?.addToSelection?.(seedObject);
      }
    }
    // When NOT additive: clear every selected object first so the
    // marquee starts from a known-empty state, then the user drags
    // out a fresh multi-selection. When additive: keep the current
    // multi-selection and union new elements into it on pointerup.
    if (!additive) {
      for (const obj of this._selectedModelerObjects()) {
        const m = obj.userData.cycoModeler;
        if (!m) continue;
        m.selectedFaces = [];
        m.selectedEdges = [];
        m.selectedVertices = [];
      }
    }
    this._elemMarquee = {
      pointerId: event.pointerId,
      startClient: { x: event.clientX, y: event.clientY },
      lastClient: { x: event.clientX, y: event.clientY },
      additive,
      // Seed the marquee with the click hit's element (so a tiny drag
      // with no real rect still produces a selection — matches how
      // UModeler's click-then-marquee behaves).
      seedObject,
      seedHit: hit,
    };
    this._suppressNextClick = true;
    this._refreshSelectionOverlay();
  }

  /**
   * Recompute the element selection based on the current marquee
   * rectangle. Walks every face/edge/vertex of every selected modeler
   * object (plus the marquee's seed object so the user can drag a
   * rectangle that crosses into a non-selected object), projects
   * its centroid to NDC, and keeps the ones inside the rect.
   */
  _updateElementMarqueePreview() {
    if (window.__cycoDebug?.logMarquee) console.log('[MARQUEE] _updateElementMarqueePreview START, has elemMarquee=', !!this._elemMarquee, 'mode=', this.elementMode);
    if (!this._elemMarquee) return;
    const scene = this.sceneManager?.getActiveScene?.();
    if (!scene) return;
    const _marqueeLog = (msg) => { try { (window.__cycoDebug?.logMarquee) && console.log('[MARQUEE]', msg); } catch(_) {} };
    const minX = Math.min(this._elemMarquee.startClient.x, this._elemMarquee.lastClient.x);
    const maxX = Math.max(this._elemMarquee.startClient.x, this._elemMarquee.lastClient.x);
    const minY = Math.min(this._elemMarquee.startClient.y, this._elemMarquee.lastClient.y);
    const maxY = Math.max(this._elemMarquee.startClient.y, this._elemMarquee.lastClient.y);
    // Pixel threshold: if the drag hasn't moved more than a few
    // pixels, skip the projection walk and keep the seed selection.
    if (Math.hypot(maxX - minX, maxY - minY) < 4) {
      _marqueeLog('drag too small, seeding');
      this._seedMarqueeSelection();
      this._refreshSelectionOverlay();
      return;
    }
    const renderer = this.viewportEngine?.rendererManager?.renderer;
    const camera = this.viewportEngine?.camera;
    if (!renderer?.domElement || !camera) return;
    const rect = renderer.domElement.getBoundingClientRect();
    // Collect every modeler object in the scene, plus the marquee
    // seed object (so the marquee can sweep onto a previously
    // un-selected object). For non-additive marquees we also pick
    // up new objects as the rect drags over them — a marquee that
    // starts on object A and crosses into object B should be able to
    // select polygons on both. Newly-discovered objects are added
    // to the SelectionManager so multi-push/pull can find them.
    const objects = [];
    const seen = new Set();
    for (const obj of this._selectedModelerObjects()) {
      if (!seen.has(obj.uuid)) { objects.push(obj); seen.add(obj.uuid); }
    }
    if (this._elemMarquee.seedObject && !seen.has(this._elemMarquee.seedObject.uuid)) {
      objects.push(this._elemMarquee.seedObject);
      seen.add(this._elemMarquee.seedObject.uuid);
    }
    // Walk the rest of the scene's modeler objects. Test the object's
    // world-space AABB centre against the marquee rect — if the centre
    // is inside, the object is "in the marquee" and we test its
    // individual elements below.
    const objCenters = [];
    const collectObjCenters = (rootObj) => {
      rootObj.traverse?.(c => {
        if (!c.userData?.cycoModeler || seen.has(c.uuid)) return;
        const m = c.userData.cycoModeler;
        let cx = 0, cy = 0, cz = 0, n = 0;
        if (m.mesh?.vertices?.length) {
          for (const v of m.mesh.vertices) { cx += v.x; cy += v.y; cz += v.z; n += 1; }
        } else {
          // Fallback: read from BufferGeometry bounding box.
          c.geometry?.computeBoundingBox?.();
          const bb = c.geometry?.boundingBox;
          if (bb) { cx = (bb.min.x + bb.max.x) / 2; cy = (bb.min.y + bb.max.y) / 2; cz = (bb.min.z + bb.max.z) / 2; n = 1; }
        }
        if (!n) return;
        const center = new THREE.Vector3(cx / n, cy / n, cz / n).applyMatrix4(c.matrixWorld);
        projTmp.copy(center).project(camera);
        if (projTmp.z < -1 || projTmp.z > 1) return;
        const sx = (projTmp.x * 0.5 + 0.5) * rect.width + rect.left;
        const sy = (-projTmp.y * 0.5 + 0.5) * rect.height + rect.top;
        if (sx < minX || sx > maxX || sy < minY || sy > maxY) return;
        objects.push(c);
        seen.add(c.uuid);
        objCenters.push(c);
      });
    };
    collectObjCenters(scene);
    // Project each element's centroid to NDC, test against the rect.
    const projTmp = new THREE.Vector3();
    if (window.__cycoDebug?.logMarquee) console.log('[MARQUEE] rect:', minX, minY, maxX, maxY, 'objects:', objects.length);
    const collectForObject = (obj) => {
      const m = obj?.userData?.cycoModeler;
      if (!m) return null;
      // Make sure the world matrix is current — without this the
      // projected screen coordinates of each face centroid can lag
      // behind by one frame (especially right after the marquee
      // was started, when the parent matrix may have just been
      // written but not propagated to `matrixWorld` yet).
      obj.updateMatrixWorld(true, false);
      // Reset to empty so we rebuild the selection from scratch each
      // move. Additive is handled by saving off the previous selection
      // before clearing.
      const prev = this._elemMarquee.additive
        ? { faces: m.selectedFaces?.slice() || [], edges: m.selectedEdges?.slice() || [], vertices: m.selectedVertices?.slice() || [] }
        : { faces: [], edges: [], vertices: [] };
      // Build the in-rect set by element mode.
      const newFaces = this._elemMarquee.additive ? new Set(prev.faces) : new Set();
      const newEdges = this._elemMarquee.additive ? new Set(prev.edges) : new Set();
      const newVerts = this._elemMarquee.additive ? new Set(prev.vertices) : new Set();
      // Helper: project a world point and check if it's in the marquee rect.
      const inRect = (world) => {
        projTmp.copy(world).project(camera);
        if (projTmp.z < -1 || projTmp.z > 1) return false;
        const sx = (projTmp.x * 0.5 + 0.5) * rect.width + rect.left;
        const sy = (-projTmp.y * 0.5 + 0.5) * rect.height + rect.top;
        return sx >= minX && sx <= maxX && sy >= minY && sy <= maxY;
      };
      // Faces: centroid of each face's vertices.
      if (this.elementMode === 'polygon' || this.elementMode === 'object') {
        const editable = m.mesh ? EditableMesh.fromJSON(m.mesh) : null;
        if (editable) {
          for (let i = 0; i < editable.faces.length; i += 1) {
            const face = editable.faces[i];
            if (!face || face.length < 3) continue;
            // Use the face's bounding-box centre as the test point
            // (centroid of arbitrary n-gons is fine for picking).
            let minXx = Infinity, minYy = Infinity, minZz = Infinity;
            let maxXx = -Infinity, maxYy = -Infinity, maxZz = -Infinity;
            for (const vi of face) {
              const v = editable.vertices[vi];
              if (!v) continue;
              if (v.x < minXx) minXx = v.x; if (v.x > maxXx) maxXx = v.x;
              if (v.y < minYy) minYy = v.y; if (v.y > maxYy) maxYy = v.y;
              if (v.z < minZz) minZz = v.z; if (v.z > maxZz) maxZz = v.z;
            }
            const center = new THREE.Vector3((minXx + maxXx) / 2, (minYy + maxYy) / 2, (minZz + maxZz) / 2);
            center.applyMatrix4(obj.matrixWorld);
            if (inRect(center)) {
              // Add the entire selection-group (a box's top is two
              // triangles in one group → user wants both, not just
              // the tri under the cursor).
              const group = editable.selectionGroup(i);
              for (const fi of group) newFaces.add(fi);
              if (window.__cycoDebug?.logMarquee) console.log('[MARQUEE] face', i, 'in rect, group adds', group, 'newFaces.size=', newFaces.size);
            }
          }
        }
      }
      // Edges: per-edge midpoint from the EdgesGeometry.
      if (this.elementMode === 'edge') {
        try {
          const eg = (m.mesh && typeof EditableMesh.fromJSON(m.mesh).toEdgesGeometry === 'function')
            ? EditableMesh.fromJSON(m.mesh).toEdgesGeometry(0)
            : new THREE.EdgesGeometry(obj.geometry, 1);
          const pos = eg.attributes.position;
          for (let s = 0; s < pos.count; s += 2) {
            const ax = pos.getX(s), ay = pos.getY(s), az = pos.getZ(s);
            const bx = pos.getX(s + 1), by = pos.getY(s + 1), bz = pos.getZ(s + 1);
            const mid = new THREE.Vector3((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
            mid.applyMatrix4(obj.matrixWorld);
            if (inRect(mid)) newEdges.add(s);
          }
          eg.dispose?.();
        } catch (_) { /* edges not selectable for this object */ }
      }
      // Vertices: per-vertex position from the EditableMesh.
      if (this.elementMode === 'vertex') {
        const editable = m.mesh ? EditableMesh.fromJSON(m.mesh) : null;
        if (editable) {
          for (let i = 0; i < editable.vertices.length; i += 1) {
            const v = editable.vertices[i];
            if (!v) continue;
            const wp = new THREE.Vector3(v.x, v.y, v.z).applyMatrix4(obj.matrixWorld);
            if (inRect(wp)) newVerts.add(i);
          }
        }
      }
      m.selectedFaces = Array.from(newFaces);
      if (window.__cycoDebug?.logMarquee) console.log('[MARQUEE] final for obj uuid=', obj.uuid.slice(0,4), 'sel=', m.selectedFaces.length, 'editableFaces=', m.mesh?.faces?.length);
      m.selectedEdges = Array.from(newEdges);
      m.selectedVertices = Array.from(newVerts);
      return { faces: m.selectedFaces.length, edges: m.selectedEdges.length, verts: m.selectedVertices.length };
    };
    let totalFaces = 0, totalEdges = 0, totalVerts = 0;
    _marqueeLog('objects count=' + objects.length);
    for (const obj of objects) {
      const r = collectForObject(obj);
      _marqueeLog('collectForObject obj=' + (obj?.uuid?.slice(0,4) || '?') + ' r=' + JSON.stringify(r) + ' sel=' + JSON.stringify(obj?.userData?.cycoModeler?.selectedFaces?.slice(0,5)) + ' totalLen=' + (obj?.userData?.cycoModeler?.selectedFaces?.length));
      if (r) { totalFaces += r.faces; totalEdges += r.edges; totalVerts += r.verts; }
    }
    // If the marquee discovered new modeler objects that aren't yet
    // in the scene-level selection, add them so multi-push/pull can
    // see them via `_selectedModelerObjects()`. We only do this in
    // non-additive mode so the user doesn't accidentally end up
    // with a scene selection full of objects they only hovered.
    if (objCenters.length) {
      const selMgr = this.selectionManager;
      if (selMgr?.addToSelection && !this._elemMarquee.additive) {
        for (const o of objCenters) selMgr.addToSelection(o);
      }
    }
    this._refreshSelectionOverlay();
    const parts = [];
    if (totalFaces) parts.push(`${totalFaces} polygons`);
    if (totalEdges) parts.push(`${totalEdges} edges`);
    if (totalVerts) parts.push(`${totalVerts} vertices`);
    this._status(parts.length ? `Marquee selecting: ${parts.join(' + ')}` : 'Drag to select elements');
  }

  /** If the marquee hasn't moved enough to be a real rectangle, fall
   *  back to the click hit's element (single-element selection). */
  _seedMarqueeSelection() {
    if (!this._elemMarquee?.seedHit) return;
    const hit = this._elemMarquee.seedHit;
    const modeler = hit.object?.userData?.cycoModeler;
    if (!modeler) return;
    const selection = this._selectionFromHit(hit);
    if (this.elementMode === 'vertex') {
      modeler.selectedVertices = selection.vertices;
      modeler.selectedFaces = selection.faces;
    } else if (this.elementMode === 'edge') {
      modeler.selectedEdges = selection.edges;
      modeler.selectedFaces = selection.faces;
    } else {
      modeler.selectedFaces = selection.faces;
    }
  }

  /**
   * Apply a multi-push/pull preview by mutating the live mesh of
   * every selected object. Each object extrudes its own selected
   * faces along its OWN face normal — opposite-facing walls move in
   * opposite world directions at the same screen-pixel drag delta.
   */
  _applyMultiPushPreview(drag, distance) {
    for (let i = 0; i < drag.draggedObjects.length; i += 1) {
      const obj = drag.draggedObjects[i];
      const baseMesh = drag.baseMeshes[i];
      if (!obj?.userData?.cycoModeler?.mesh || !baseMesh) continue;
      const mesh = EditableMesh.fromJSON(baseMesh);
      const m = obj.userData.cycoModeler;
      const faces = m.selectedFaces?.length ? m.selectedFaces : this._faceIndicesForSelection(m);
      if (!faces.length) continue;
      // `pushFaces` always extrudes along the AVERAGE normal of the
      // supplied face set — perfect for groups of coplanar triangles
      // (e.g. a subdivided box top), but wrong for a multi-selection
      // that mixes opposing walls. For a multi-push we want each face
      // extruded along its own normal at the same world distance, so
      // we group by selection-group (coplanar siblings share a normal)
      // and call pushFaces once per group.
      const groups = this._groupCoplanarFaces(mesh, faces);
      for (const grp of groups) mesh.pushFaces(grp, distance);
      this._applyEditableMesh(obj, mesh);
    }
  }

  /**
   * Partition `faceIndices` into groups of coplanar siblings (faces
   * that share a faceGroup ID). Each group can be extruded as a unit
   * without the "average normal collapses to zero" bug that affects
   * mixed-orientation multi-push calls.
   */
  _groupCoplanarFaces(mesh, faceIndices) {
    const out = [];
    const seen = new Set();
    for (const fi of faceIndices) {
      if (seen.has(fi)) continue;
      const gid = mesh.faceGroups?.[fi];
      const grp = [];
      if (gid == null) {
        grp.push(fi);
      } else {
        for (let j = 0; j < faceIndices.length; j += 1) {
          if (mesh.faceGroups?.[faceIndices[j]] === gid) grp.push(faceIndices[j]);
        }
      }
      for (const k of grp) seen.add(k);
      out.push(grp);
    }
    return out;
  }

  // ── Multi-selection overlay ───────────────────────────────────────────────
  // A persistent overlay showing all currently-selected elements
  // (faces/edges/vertices). Rendered as child meshes/line-segments on
  // the modeler objects so they inherit transforms automatically.
  // The hover overlay (single-element transient) and this overlay can
  // coexist: the hover layer draws on top of the selection.

  /** Tear down the multi-selection overlay. Safe to call when no
   *  overlay exists. */
  _clearSelectionOverlay() {
    if (!this._selOverlay) return;
    for (const entry of this._selOverlay.entries) {
      entry.mesh?.parent?.remove(entry.mesh);
      entry.mesh?.geometry?.dispose?.();
      entry.mesh?.material?.dispose?.();
    }
    this._selOverlay = null;
  }

  /**
   * Rebuild the multi-selection overlay for the current selection
   * state. Called after every click-select / marquee-select /
   * push-pull operation so the visual matches the modeler userData.
   */
  _refreshSelectionOverlay() {
    if (!this.active) { this._clearSelectionOverlay(); return; }
    if (this.elementMode === 'object') { this._clearSelectionOverlay(); return; }
    this._clearSelectionOverlay();
    const entries = [];
    for (const obj of this._selectedModelerObjects()) {
      const m = obj.userData?.cycoModeler;
      if (!m) continue;
      // Face overlay: filled translucent mesh per selected face.
      if (m.selectedFaces?.length && (this.elementMode === 'polygon' || this.elementMode === 'object')) {
        const g = this._selectedFacesOverlayGeometry(obj, m.selectedFaces);
        if (g) {
          const style = this._hoverStyle.polygon;
          const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
            color: style.color,
            transparent: true,
            opacity: 0.45,
            depthTest: false,
            depthWrite: false,
            side: THREE.DoubleSide,
            toneMapped: false,
          }));
          mesh.renderOrder = 9998;
          obj.add(mesh);
          entries.push({ object: obj, mesh });
        }
      }
      // Edge overlay: fat line segments for selected edges.
      if (m.selectedEdges?.length && this.elementMode === 'edge') {
        const g = this._selectedEdgesOverlayGeometry(obj, m.selectedEdges);
        if (g) {
          const style = this._hoverStyle.edge;
          const targetPos = this._getObjectWorldCenter(obj);
          const mesh = this._buildFatEdges(
            g,
            style.color,
            Math.max(2, (style.thickness ?? this._wireStyle.thickness ?? 1) + 1),
            style.opacity,
            /* depthTest */ false,
            targetPos,
          );
          mesh.renderOrder = 9998;
          obj.add(mesh);
          entries.push({ object: obj, mesh });
        }
      }
      // Vertex overlay: instanced spheres at selected vertex positions.
      if (m.selectedVertices?.length && this.elementMode === 'vertex') {
        const g = this._selectedVerticesOverlayGeometry(obj, m.selectedVertices);
        if (g) {
          const style = this._hoverStyle.vertex;
          const mesh = this._buildVertexHandles(g, style.color, (style.vertexSize ?? 6) + 1, style.opacity);
          mesh.renderOrder = 9998;
          obj.add(mesh);
          entries.push({ object: obj, mesh });
        }
      }
    }
    if (entries.length) this._selOverlay = { entries };
  }

  /** Build a filled BufferGeometry of all `faceIndices` for the given
   *  object, fan-triangulated. Coordinates are local so the parent
   *  transform carries them automatically. */
  _selectedFacesOverlayGeometry(object, faceIndices) {
    const mesh = object.userData?.cycoModeler?.mesh;
    if (!mesh) return null;
    const editable = EditableMesh.fromJSON(mesh);
    const set = new Set(faceIndices);
    const positions = [];
    for (const fi of set) {
      const face = editable.faces[fi];
      if (!face || face.length < 3) continue;
      for (let i = 1; i < face.length - 1; i += 1) {
        const a = editable.vertices[face[0]];
        const b = editable.vertices[face[i]];
        const c = editable.vertices[face[i + 1]];
        if (!a || !b || !c) continue;
        positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
      }
    }
    if (!positions.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.computeVertexNormals();
    return g;
  }

  /** Build an EdgesGeometry-style BufferGeometry containing ONLY the
   *  selected edge indices for `object`. */
  _selectedEdgesOverlayGeometry(object, edgeIndices) {
    const mesh = object.userData?.cycoModeler?.mesh;
    if (!mesh) return null;
    const editable = EditableMesh.fromJSON(mesh);
    const eg = editable.toEdgesGeometry(0);
    const pos = eg.attributes.position;
    const segCount = (pos.count / 2) | 0;
    const set = new Set(edgeIndices);
    const keepPositions = [];
    for (let s = 0; s < segCount; s += 1) {
      if (!set.has(s)) continue;
      const ax = pos.getX(s * 2),     ay = pos.getY(s * 2),     az = pos.getZ(s * 2);
      const bx = pos.getX(s * 2 + 1), by = pos.getY(s * 2 + 1), bz = pos.getZ(s * 2 + 1);
      keepPositions.push(ax, ay, az, bx, by, bz);
    }
    eg.dispose?.();
    if (!keepPositions.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(keepPositions, 3));
    g.userData._wireParent = object;
    return g;
  }

  /** Build a point-cloud BufferGeometry of selected vertex positions. */
  _selectedVerticesOverlayGeometry(object, vertexIndices) {
    const mesh = object.userData?.cycoModeler?.mesh;
    if (!mesh) return null;
    const editable = EditableMesh.fromJSON(mesh);
    const points = [];
    for (const vi of vertexIndices) {
      const v = editable.vertices[vi];
      if (!v) continue;
      points.push(v.x, v.y, v.z);
    }
    if (!points.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    return g;
  }

  _gridCellSize() {
    let settings = {};
    try { settings = JSON.parse(localStorage.getItem('cyco-grid-settings') ?? '{}'); } catch {}
    const s = { ...GRID_DEFAULTS, ...settings };
    if (s.style === 'standard') {
      const div = Math.max(1, Number(s.divisions) || GRID_DEFAULTS.divisions);
      return Math.max(1, (Number(s.size) || GRID_DEFAULTS.size) / div);
    }
    if (s.style === 'checkered' || s.style === 'checkered-infinite') {
      return Math.max(1, Number(s.checkerSize) || GRID_DEFAULTS.checkerSize);
    }
    return Math.max(1, Number(s.cellSize) || GRID_DEFAULTS.cellSize);
  }

  /**
   * Convert vertical screen-pixel drag into world-units so that
   * dragging the mouse UP grows the primitive's height by a sensible
   * amount independent of camera zoom. Uses the camera's vertical
   * FOV and the distance from the camera to the Y=0 plane to derive a
   * pixels-to-world ratio: a 1px upward drag = (2 * dist * tan(fov/2)
   * / viewportHeight) world units.
   */
  _heightWorldPerPixel() {
    const camera = this.viewportEngine?.camera;
    const renderer = this.viewportEngine?.rendererManager?.renderer;
    if (!camera || !renderer?.domElement) return this._gridCellSize() * 0.05;
    const rect = renderer.domElement.getBoundingClientRect();
    const viewportHeight = rect.height || 1;
    const fovRad = (camera.fov ?? 50) * Math.PI / 180;
    const camPos = camera.position;
    const dist = Math.max(1, Math.hypot(camPos.x, camPos.y, camPos.z));
    return Math.max(0.001, (2 * dist * Math.tan(fovRad / 2)) / viewportHeight);
  }

  _status(message) {
    window.dispatchEvent(new CustomEvent('cyco-modeler-status', { detail: { message } }));
  }

  _label(id) {
    return String(id).replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
}
