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
    this._wireStyle = { color: 0x151515, opacity: 0.85, thickness: 1, enabled: true };
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
      if (!obj.userData?.cycoModeler?.mesh) return;
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
      this._boxDrag = { pointerId: event.pointerId, start: point.clone(), end: point.clone() };
      this._updatePreview();
      return;
    }

    if (this.tool === 'push-pull' || this.tool === 'multi-push-pull' || this.tool === 'extrude-edge') {
      const hit = this._modelerHitFromEvent(event);
      const modeler = hit?.object?.userData?.cycoModeler;
      if (!hit?.object || !modeler?.mesh) return;
      modeler.selectedFaces = this._faceIndicesFromHit(hit);
      if (!modeler.selectedFaces.length) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      try { this._canvas?.setPointerCapture?.(event.pointerId); } catch (_) { /* synthetic events */ }
      this.viewportEngine.controls.enabled = false;
      window.__cyco = window.__cyco || {};
      window.__cyco._suppressSelectionManagerClick = true;
      this._faceDrag = {
        pointerId: event.pointerId,
        object: hit.object,
        startClientX: event.clientX,
        startClientY: event.clientY,
        lastClientX: event.clientX,
        lastClientY: event.clientY,
        before: this._snapshotObjectGeometry(hit.object),
        baseMesh: JSON.parse(JSON.stringify(hit.object.userData.cycoModeler.mesh || {})),
        baseFaces: modeler.selectedFaces.slice(),
      };
      this._status('Drag to extrude the selected face');
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
      this._updatePreview();
      return;
    }

    if (this._faceDrag && event.pointerId === this._faceDrag.pointerId) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this._faceDrag.lastClientX = event.clientX;
      this._faceDrag.lastClientY = event.clientY;
      const delta = this._pushDistanceFromDrag(this._faceDrag);
      this._applyPushPreview(this._faceDrag.object, this._faceDrag.baseMesh, delta);
      this._status('Drag to extrude the selected face');
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
    const hit = this._modelerHitFromEvent(event);
    if (!hit?.object?.userData?.cycoModeler?.mesh) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const modeler = hit.object.userData.cycoModeler;
    this._lastModelerObject = hit.object;
    const selection = this._selectionFromHit(hit);
    if (this.elementMode === 'vertex') {
      modeler.selectedVertices = selection.vertices;
      modeler.selectedEdges = [];
      modeler.selectedFaces = selection.faces;
      this._status(`Vertex ${modeler.selectedVertices[0] ?? 0} selected`);
    } else if (this.elementMode === 'edge') {
      modeler.selectedEdges = selection.edges;
      modeler.selectedVertices = [];
      modeler.selectedFaces = selection.faces;
      this._status(`Edge ${modeler.selectedEdges[0] ?? 0} selected`);
    } else if (this.elementMode === 'polygon') {
      modeler.selectedFaces = selection.faces;
      modeler.selectedVertices = [];
      modeler.selectedEdges = [];
      this._status(`Polygon ${Math.floor((modeler.selectedFaces[0] ?? 0) / 2) + 1} selected`);
    } else {
      modeler.selectedFaces = [];
      modeler.selectedEdges = [];
      modeler.selectedVertices = [];
      this._status('Object selected');
    }
    this.selectionManager?.setSelectedObjects?.([hit.object]);
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
      this._status('Extrude applied');
      this._hoverClear();
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
    const object = this._buildPrimitiveObject(drag.start, drag.end, false);
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
    return mesh.coplanarFaces(index);
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
    const preview = this._buildPrimitiveObject(this._boxDrag.start, this._boxDrag.end, true);
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
  _buildFatEdges(edgesGeom, color, linewidth, opacity, depthTest = true) {
    const renderer = this.viewportEngine?.rendererManager?.renderer;
    const isWebGPU = !!(renderer && renderer.isWebGPURenderer);

    // Clamp to a reasonable visible range so a stray 0/NaN doesn't hide
    // the wireframe entirely.
    const widthPx = Math.max(0.5, Number.isFinite(linewidth) ? linewidth : 1);

    if (!isWebGPU) {
      // WebGL: Line2 honours screen-pixel width natively.
      const lineGeom = new LineSegmentsGeometry().fromEdgesGeometry(edgesGeom);
      const mat = new LineMaterial({
        color,
        linewidth: widthPx,
        transparent: true,
        opacity,
        depthTest,
        depthWrite: false,
        dashed: false,
        alphaToCoverage: true,
      });
      this._ensureLineResolution(mat);
      const seg = new LineSegments2(lineGeom, mat);
      seg.scale.set(1, 1, 1);
      return seg;
    }

    // WebGPU fallback: convert pixel width into world-space ribbon width
    // using camera distance + FOV so it looks consistent at any zoom.
    const camera = this.viewportEngine?.camera;
    const fov = ((camera?.fov ?? 50)) * Math.PI / 180;
    const canvasH = Math.max(1, renderer.domElement?.clientHeight || 1080);
    // Distance from the world origin to the camera; for modeler
    // primitives at the origin this is close to the actual view distance.
    const cameraDist = Math.max(0.5, camera?.position?.length?.() ?? 10);
    const worldPerPx = (2 * Math.tan(fov / 2) * cameraDist) / canvasH;
    const widthWorld = Math.max(worldPerPx * 0.25, widthPx * worldPerPx);

    const ribbonGeom = this._expandEdgesToRibbon(edgesGeom, widthWorld);
    const wireMesh = new THREE.Mesh(
      ribbonGeom,
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthTest,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    );
    wireMesh.renderOrder = 9999;
    return wireMesh;
  }

  /**
   * Expand a THREE.EdgesGeometry (pairs of vertices describing line
   * segments) into a triangle ribbon of the requested world-space width.
   *
   * Each edge segment AB becomes a quad: A-l, A-r, B-r, A-l, B-r, B-l
   * where A-l/B-l and A-r/B-r are A and B pushed in opposite directions
   * along the segment's local perpendicular.
   *
   * The geometry stays in source-mesh LOCAL coordinates (same as the
   * input EdgesGeometry), so the ribbon scales/rotates with the parent
   * mesh. The perpendicular for each segment is computed by crossing the
   * segment direction with an arbitrary stable axis (chosen per segment
   * to avoid degenerates when a segment runs parallel to that axis).
   */
  _expandEdgesToRibbon(edgesGeom, width) {
    const src = edgesGeom.attributes.position;
    if (!src) return edgesGeom;
    const segCount = (src.count / 2) | 0;
    const positions = new Float32Array(segCount * 6 * 3);
    const A = new THREE.Vector3();
    const B = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const tmp = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const offset = new THREE.Vector3();
    // Stable local-space axes. Either of these works as a cross-product
    // partner for `dir`; switching per-segment avoids degenerate
    // (zero-length) normals for segments aligned with that axis.
    const AXES = [
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, 1),
    ];
    let o = 0;
    for (let i = 0; i < segCount; i++) {
      A.fromBufferAttribute(src, i * 2);
      B.fromBufferAttribute(src, i * 2 + 1);
      dir.subVectors(B, A);
      if (dir.lengthSq() < 1e-10) continue;
      dir.normalize();
      // Pick the first axis not parallel to dir, then cross.
      let chosen = AXES[2];
      for (let a = 0; a < 3; a++) {
        tmp.crossVectors(dir, AXES[a]);
        if (tmp.lengthSq() > 1e-6) { chosen = AXES[a]; break; }
      }
      normal.crossVectors(dir, chosen);
      if (normal.lengthSq() < 1e-6) continue;
      normal.normalize();
      offset.copy(normal).multiplyScalar(width);
      const aL = A;
      const aR = A.clone().add(offset);
      const bL = B;
      const bR = B.clone().add(offset);
      // Tri 1: aL, aR, bR
      positions[o++] = aL.x; positions[o++] = aL.y; positions[o++] = aL.z;
      positions[o++] = aR.x; positions[o++] = aR.y; positions[o++] = aR.z;
      positions[o++] = bR.x; positions[o++] = bR.y; positions[o++] = bR.z;
      // Tri 2: aL, bR, bL
      positions[o++] = aL.x; positions[o++] = aL.y; positions[o++] = aL.z;
      positions[o++] = bR.x; positions[o++] = bR.y; positions[o++] = bR.z;
      positions[o++] = bL.x; positions[o++] = bL.y; positions[o++] = bL.z;
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
      mesh = this._buildFatEdges(
        geometry,
        style.color,
        Math.max(1, style.thickness ?? this._wireStyle.thickness ?? 1),
        style.opacity,
        /* depthTest */ false,
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
    return new THREE.EdgesGeometry(object.geometry, 1);
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
    const mesh = mode === 'edge'
      ? this._buildFatEdges(geometry, style.color, Math.max(1, style.thickness ?? this._wireStyle.thickness ?? 1), style.opacity, /* depthTest */ false)
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

  _buildPrimitiveObject(start, end, preview) {
    const cell = this._gridCellSize();
    const minX = Math.min(start.x, end.x);
    const maxX = Math.max(start.x, end.x);
    const minZ = Math.min(start.z, end.z);
    const maxZ = Math.max(start.z, end.z);
    const width = Math.max(cell, maxX - minX);
    const depth = Math.max(cell, maxZ - minZ);
    const centerX = minX + width / 2;
    const centerZ = minZ + depth / 2;
    const height = cell;
    const editableMesh = this.primitiveTool === 'box'
      ? EditableMesh.boxFromBounds(
          new THREE.Vector3(-width / 2, 0, -depth / 2),
          new THREE.Vector3(width / 2, height, depth / 2)
        )
      : null;
    // Boxes use the EditableMesh as their rendered geometry so the
    // faceId attribute is present from the start, keeping raycasts /
    // polygon selection / Push-Pull consistent before any deformation.
    const geometry = editableMesh
      ? editableMesh.toBufferGeometry()
      : this._makePrimitiveGeometry(this.primitiveTool, width, height, depth);
    const material = new THREE.MeshStandardMaterial({
      color: 0x8888aa,
      opacity: preview ? 0.45 : 1,
      transparent: preview,
      roughness: 0.7,
      metalness: 0.1,
      side: THREE.DoubleSide,
    });
    const object = new THREE.Mesh(geometry, material);
    object.name = preview
      ? `Cycle Modeler ${this._label(this.primitiveTool)} Preview`
      : `Cycle Modeler ${this._label(this.primitiveTool)}`;
    object.position.set(centerX, this.primitiveTool === 'box' ? 0 : height / 2, centerZ);
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
    obj.geometry = this._geometryFromDimensions(dims);
    oldGeometry?.dispose?.();
    obj.position.y = dims.primitive === 'rounded-box' ? dims.height / 2 : 0;
    obj.userData.cycoModeler = {
      ...(obj.userData.cycoModeler || {}),
      primitive: dims.primitive,
      dimensions: { width: dims.width, height: dims.height, depth: dims.depth },
      bevel: dims.bevel ?? 0,
      segments: dims.segments ?? obj.userData.cycoModeler?.segments ?? 1,
    };
    this._syncWireOverlay(obj);
  }

  _geometryFromDimensions(dims) {
    if (dims.primitive === 'rounded-box') {
      return new RoundedBoxGeometry(dims.width, dims.height, dims.depth, 3, dims.bevel ?? 1);
    }
    if (dims.primitive === 'box-subdivided') {
      const geometry = new THREE.BoxGeometry(
        dims.width,
        dims.height,
        dims.depth,
        dims.segments ?? 2,
        dims.segments ?? 2,
        dims.segments ?? 2
      );
      geometry.translate(0, dims.height / 2, 0);
      return geometry;
    }
    return EditableMesh.boxFromBounds(
      new THREE.Vector3(-dims.width / 2, 0, -dims.depth / 2),
      new THREE.Vector3(dims.width / 2, dims.height, dims.depth / 2)
    ).toBufferGeometry();
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
    scene.traverse(obj => { if (obj.userData?.cycoModeler?.mesh) targets.push(obj); });
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
    // Line2 (LineSegments2 + LineMaterial) so the thickness slider
    // produces a visible result on screen.
    const wire = this._buildFatEdges(
      new THREE.EdgesGeometry(obj.geometry, 1),
      this._wireStyle.color,
      this._wireStyle.thickness,
      this._wireStyle.opacity,
      /* depthTest */ true,
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

  _status(message) {
    window.dispatchEvent(new CustomEvent('cyco-modeler-status', { detail: { message } }));
  }

  _label(id) {
    return String(id).replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
}
