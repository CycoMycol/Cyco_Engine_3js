/**
 * TransformGizmo.js
 * Wraps Three.js TransformControls for translate/rotate/scale modes.
 * Implements a custom bounding-box (Box) tool for uniform scale via corner handles.
 *
 * Depends on: ViewportEngine (injected), SelectionManager (injected)
 *
 * Events consumed:
 *   cyco-vp-ready            { scene, camera }
 *   cyco-renderer-changed    { renderer }
 *   cyco-editor-camera-changed  {}
 *   cyco-select-node         { object }
 *   cyco-deselect-all        {}
 *   cyco-vp-tool             { mode }  'translate'|'rotate'|'scale'|'universal'|'select'
 *   cyco-rvp-snap            { enabled, value }
 *   cyco-vp-world            { isWorld }
 *   cyco-vp-tick             {}
 *   cyco-physics-edit-mode   { enabled }
 *   cyco-physics-edit-proxy-ready { object, proxy }
 *   cyco-physics-edit-focus  { object }
 *   cyco-physics-vp-tool     { mode }
 *   cyco-hierarchy-remove    { objectId }
 */

import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

export class TransformGizmo {
  constructor(viewportEngine, selectionManager) {
    this.engine           = viewportEngine;
    this.selectionManager = selectionManager;

    this._mode        = 'select';
    this._space       = 'world';
    this._targetObject = null;
    this._physicsEdit = false;
    this._physicsEditMode = 'translate';
    this._pendingPhysicsAttach = false;
    this._isDragging = false;
    this._matrixBefore = null;
    this._targetProxy  = null;

    // TransformControls — one per mode
    this._tcTranslate = null;
    this._tcRotate    = null;
    this._tcScale     = null;
    this.controls     = null; // points to active TC

    // Box tool
    this._boxGroup = null;
    this._boxEdges = null;
    this._boxPickers = [];
    this._boxActive = false;

    this._onVpReady       = this._onVpReady.bind(this);
    this._onRendererChanged = this._onRendererChanged.bind(this);
    this._onEditorCamChanged = this._onEditorCamChanged.bind(this);
    this._onSelectNode    = this._onSelectNode.bind(this);
    this._onDeselectAll   = this._onDeselectAll.bind(this);
    this._onTool          = this._onTool.bind(this);
    this._onWorld         = this._onWorld.bind(this);
    this._onSnap          = this._onSnap.bind(this);
    this._onVpTick        = this._onVpTick.bind(this);
    this._onHierarchyRemove = this._onHierarchyRemove.bind(this);
    this._onPhysicsEditMode = this._onPhysicsEditMode.bind(this);
    this._onPhysicsProxyReady = this._onPhysicsProxyReady.bind(this);
    this._onPhysicsFocus  = this._onPhysicsFocus.bind(this);
    this._onPhysicsTool   = this._onPhysicsTool.bind(this);
    this._onBoxPointerDown = this._onBoxPointerDown.bind(this);
    this._onBoxPD = null;

    window.addEventListener('cyco-vp-ready',              this._onVpReady);
    window.addEventListener('cyco-renderer-changed',      this._onRendererChanged);
    window.addEventListener('cyco-editor-camera-changed', this._onEditorCamChanged);
    window.addEventListener('cyco-select-node',           this._onSelectNode);
    window.addEventListener('cyco-deselect-all',          this._onDeselectAll);
    window.addEventListener('cyco-vp-tool',               this._onTool);
    window.addEventListener('cyco-vp-world',              this._onWorld);
    window.addEventListener('cyco-rvp-snap',              this._onSnap);
    window.addEventListener('cyco-vp-tick',               this._onVpTick);
    window.addEventListener('cyco-hierarchy-remove',      this._onHierarchyRemove);
    window.addEventListener('cyco-physics-edit-mode',     this._onPhysicsEditMode);
    window.addEventListener('cyco-physics-edit-proxy-ready', this._onPhysicsProxyReady);
    window.addEventListener('cyco-physics-edit-focus',    this._onPhysicsFocus);
    window.addEventListener('cyco-physics-vp-tool',       this._onPhysicsTool);
  }

  // ═══════════════════════════ Build ═══════════════════════════

  _build() {
    const renderer = this.engine.rendererManager?.renderer;
    const camera   = this.engine.camera;
    const scene    = this.engine.scene;
    if (!renderer || !camera || !scene) return;
    const canvas = renderer.domElement;
    if (!canvas) return;

    // Tear down old
    this._teardown();

    // Create TransformControls — one per mode, only the active one is visible
    this._tcTranslate = this._createTC('translate', camera, canvas);
    this._tcRotate    = this._createTC('rotate',    camera, canvas);
    this._tcScale     = this._createTC('scale',     camera, canvas);

    this._tcTranslate.setSize(1.0);
    this._tcRotate.setSize(0.55);
    this._tcScale.setSize(0.75);

    for (const tc of [this._tcTranslate, this._tcRotate, this._tcScale]) {
      scene.add(tc.getHelper());
    }

    // Box tool group (hidden by default)
    this._boxGroup = new THREE.Group();
    this._boxGroup.name = '__cyco_box_gizmo__';
    this._boxGroup.visible = false;
    scene.add(this._boxGroup);
    this._buildBoxHandles();

    // Wire box tool pointerdown to canvas
    if (!this._onBoxPD) {
      this._onBoxPD = (e) => this._onBoxPointerDown(e);
      canvas.addEventListener('pointerdown', this._onBoxPD);
    }

    // Set initial mode
    this._setActiveMode(this._mode);

    // Re-attach if we have a target
    if (this._targetObject) this._attachTo(this._targetObject);
  }

  _teardown() {
    // Remove box pointerdown from canvas
    if (this._onBoxPD) {
      const renderer = this.engine.rendererManager?.renderer;
      if (renderer?.domElement) {
        renderer.domElement.removeEventListener('pointerdown', this._onBoxPD);
      }
      this._onBoxPD = null;
    }

    for (const tc of [this._tcTranslate, this._tcRotate, this._tcScale]) {
      if (tc) {
        const h = tc.getHelper();
        if (h?.parent) h.parent.remove(h);
        tc.dispose();
      }
    }
    this._tcTranslate = null;
    this._tcRotate    = null;
    this._tcScale     = null;
    this.controls     = null;

    if (this._boxGroup) {
      if (this._boxGroup.parent) this._boxGroup.parent.remove(this._boxGroup);
      this._boxGroup = null;
    }
  }

  _createTC(mode, camera, domElement) {
    const tc = new TransformControls(camera, domElement);
    tc.setMode(mode);
    tc.setSpace(this._space);
    tc.visible = false;

    tc.addEventListener('dragging-changed', (event) => {
      const orbit = this.engine.controls;
      if (orbit) orbit.enabled = !event.value;
      this.selectionManager._gizmoDragging = !!event.value;
      this._isDragging = !!event.value;
    });

    tc.addEventListener('mouseDown', () => {
      this._isDragging = true;
      for (const other of [this._tcTranslate, this._tcRotate, this._tcScale]) {
        if (other && other !== tc) other.enabled = false;
      }
      const orbit = this.engine.controls;
      if (orbit) orbit.enabled = false;
      if (this._targetObject) {
        this._matrixBefore = this._targetObject.matrix.clone();
      }
    });

    tc.addEventListener('mouseUp', () => {
      this._isDragging = false;
      for (const tc of [this._tcTranslate, this._tcRotate, this._tcScale]) {
        if (tc) tc.enabled = true;
      }
      const orbit = this.engine.controls;
      if (orbit) orbit.enabled = true;

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
      }
      this._matrixBefore = null;
    });

    return tc;
  }

  // ═══════════════════════════ Mode switching ═══════════════════════════

  _setActiveMode(mode) {
    this._mode = mode;
    const isTC = ['translate', 'rotate', 'scale'].includes(mode);
    const isBox = mode === 'universal';

    if (isTC) {
      const tc = { translate: this._tcTranslate, rotate: this._tcRotate, scale: this._tcScale }[mode];
      for (const t of [this._tcTranslate, this._tcRotate, this._tcScale]) {
        t.visible = (t === tc);
        t.enabled = (t === tc);
      }
      this.controls = tc;
      this._hideBox();
    } else if (isBox) {
      for (const t of [this._tcTranslate, this._tcRotate, this._tcScale]) {
        t.visible = false;
        t.enabled = false;
      }
      this.controls = null;
      this._showBox();
    } else {
      // 'select' — hide everything
      for (const t of [this._tcTranslate, this._tcRotate, this._tcScale]) {
        t.visible = false;
        t.enabled = false;
      }
      this.controls = null;
      this._hideBox();
    }
  }

  // ═══════════════════════════ Attach / Detach ═══════════════════════════

  _attachTo(obj) {
    this._targetObject = obj;
    if (this._mode === 'universal') {
      this._updateBox();
    } else {
      for (const tc of [this._tcTranslate, this._tcRotate, this._tcScale]) {
        tc.attach(obj);
      }
    }
  }

  _detachAll() {
    this._targetObject = null;
    for (const tc of [this._tcTranslate, this._tcRotate, this._tcScale]) {
      tc.detach();
    }
    this._clearBox();
  }

  detach() {
    this._detachAll();
  }

  // ═══════════════════════════ Box tool (bounding box) ═══════════════════════════

  _buildBoxHandles() {
    const group = this._boxGroup;
    // Wireframe box
    const edgesGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    const edgesMat = new THREE.LineBasicMaterial({ color: 0xff8800, linewidth: 1 });
    this._boxEdges = new THREE.LineSegments(edgesGeo, edgesMat);
    this._boxEdges.raycast = () => {}; // non-interactive
    group.add(this._boxEdges);

    // 8 corner sphere handles for uniform scale
    const handleGeo = new THREE.SphereGeometry(0.06, 8, 6);
    const handleMat = new THREE.MeshBasicMaterial({ color: 0xff8800 });
    const corners = [
      [-1,-1,-1],[1,-1,-1],[-1,1,-1],[1,1,-1],
      [-1,-1,1],[1,-1,1],[-1,1,1],[1,1,1],
    ];
    this._boxPickers = [];
    for (const [cx, cy, cz] of corners) {
      const picker = new THREE.Mesh(handleGeo.clone(), handleMat.clone());
      picker.position.set(cx, cy, cz);
      picker.scale.setScalar(0.06);
      picker.userData._boxCorner = { cx, cy, cz };
      picker.userData._isGizmo = true;
      group.add(picker);
      this._boxPickers.push(picker);
    }
  }

  _updateBox() {
    const obj = this._targetObject;
    if (!obj || !this._boxEdges) return;
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) return;
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);

    // Scale the wireframe to match
    this._boxEdges.geometry.dispose();
    this._boxEdges.geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x, size.y, size.z));
    this._boxEdges.position.copy(center);

    // Position corner pickers
    const hx = size.x / 2, hy = size.y / 2, hz = size.z / 2;
    for (const picker of this._boxPickers) {
      const { cx, cy, cz } = picker.userData._boxCorner;
      picker.position.set(center.x + cx * hx, center.y + cy * hy, center.z + cz * hz);
      // Keep picker small regardless of box size
      picker.scale.setScalar(Math.max(0.06, Math.min(size.x, size.y, size.z) * 0.03));
    }
  }

  _showBox() {
    if (this._boxGroup) this._boxGroup.visible = true;
    this._boxActive = true;
    this._updateBox();
  }

  _hideBox() {
    if (this._boxGroup) this._boxGroup.visible = false;
    this._boxActive = false;
  }

  _clearBox() {
    this._hideBox();
  }

  _onBoxPointerDown(e) {
    if (this._mode !== 'universal' || !this._targetObject) return;
    const renderer = this.engine.rendererManager?.renderer;
    const camera   = this.engine.camera;
    if (!renderer || !camera) return;

    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(this._boxPickers, false);
    if (hits.length === 0) return;

    const picker = hits[0].object;
    const corner = picker.userData._boxCorner;
    if (!corner) return;

    e.preventDefault();
    e.stopPropagation();

    const obj = this._targetObject;
    const box = new THREE.Box3().setFromObject(obj);
    const origSize = new THREE.Vector3();
    box.getSize(origSize);
    const origScale = obj.scale.clone();
    const center = new THREE.Vector3();
    box.getCenter(center);

    this._isDragging = true;
    const orbit = this.engine.controls;
    if (orbit) orbit.enabled = false;

    const onMove = (ev) => {
      const rect2 = renderer.domElement.getBoundingClientRect();
      const ndc2 = new THREE.Vector2(
        ((ev.clientX - rect2.left) / rect2.width) * 2 - 1,
        -((ev.clientY - rect2.top) / rect2.height) * 2 + 1
      );
      const ray2 = new THREE.Raycaster();
      ray2.setFromCamera(ndc2, camera);

      // Project corner drag along camera view plane
      const cornerWorld = new THREE.Vector3(
        center.x + corner.cx * origSize.x / 2,
        center.y + corner.cy * origSize.y / 2,
        center.z + corner.cz * origSize.z / 2
      );
      const camDir = new THREE.Vector3();
      camera.getWorldDirection(camDir);
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(camDir, cornerWorld);
      const target = new THREE.Vector3();
      ray2.ray.intersectPlane(plane, target);
      if (!target) return;

      // Uniform scale factor based on distance change
      const origDist = center.distanceTo(cornerWorld);
      const newDist  = center.distanceTo(target);
      if (origDist < 0.001) return;
      const factor = Math.max(0.01, newDist / origDist);

      obj.scale.copy(origScale).multiplyScalar(factor);
      obj.updateMatrixWorld(true);
      this._updateBox();
      window.dispatchEvent(new CustomEvent('cyco-object-transform-changed', { detail: { object: obj } }));
    };

    const onUp = () => {
      this._isDragging = false;
      if (orbit) orbit.enabled = true;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);

      if (this._matrixBefore) {
        const before = this._matrixBefore;
        const after  = obj.matrix.clone();
        window.dispatchEvent(new CustomEvent('cyco-command-execute', {
          detail: {
            name: `Scale ${obj.name}`,
            do()   { obj.matrix.copy(after);  obj.matrix.decompose(obj.position, obj.quaternion, obj.scale); },
            undo() { obj.matrix.copy(before); obj.matrix.decompose(obj.position, obj.quaternion, obj.scale); },
          }
        }));
        this._matrixBefore = null;
      }
    };

    this._matrixBefore = obj.matrix.clone();
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  }

  // ═══════════════════════════ Event handlers ═══════════════════════════

  _onVpReady() { this._build(); }

  _onRendererChanged() { this._build(); }

  _onEditorCamChanged() {
    // Rebuild TCs with new camera
    this._build();
    if (this._targetObject) this._attachTo(this._targetObject);
  }

  _onSelectNode(event) {
    const { object } = event.detail;
    if (!object || object.userData.cycoLocked) {
      this.detach();
      return;
    }
    this._attachTo(object);
    if (this._mode !== 'select') this._setActiveMode(this._mode);
  }

  _onDeselectAll() { this.detach(); }

  _onHierarchyRemove(e) {
    const { objectId } = e.detail ?? {};
    if (objectId && this._targetObject?.userData?.cycoId === objectId) {
      this.detach();
    }
  }

  _onTool(event) {
    const { mode } = event.detail;
    if (!['translate', 'rotate', 'scale', 'select', 'universal'].includes(mode)) return;
    this._setActiveMode(mode);
  }

  _onWorld(event) {
    const isWorld = event.detail?.isWorld ?? event.detail ?? false;
    this._space = isWorld ? 'world' : 'local';
    for (const tc of [this._tcTranslate, this._tcRotate, this._tcScale]) {
      if (tc) tc.setSpace(this._space);
    }
  }

  _onSnap(event) {
    const d = event.detail;
    let enabled = false;
    let value = 0.25;
    if (typeof d === 'boolean') {
      enabled = d;
    } else if (d && typeof d === 'object') {
      enabled = !!d.enabled;
      value = d.value ?? value;
    }
    for (const tc of [this._tcTranslate, this._tcRotate, this._tcScale]) {
      if (!tc) continue;
      tc.translationSnap = enabled ? value : null;
      tc.rotationSnap    = enabled ? Math.PI / 12 : null;
      tc.scaleSnap       = enabled ? value * 0.1 : null;
    }
  }

  _onVpTick() {
    // Update box tool
    if (this._boxActive && this._targetObject) {
      this._updateBox();
    }
  }

  // ═══════════════════════════ Physics edit stubs ═══════════════════════════

  _onPhysicsEditMode(event) {
    this._physicsEdit = !!event.detail?.enabled;
  }

  _onPhysicsProxyReady() {}

  _onPhysicsFocus() {}

  _onPhysicsTool() {}

  // ═══════════════════════════ Lifecycle ═══════════════════════════

  suspend() {
    this._detachAll();
    if (this._boxGroup) this._boxGroup.visible = false;
  }

  restore() {
    if (this._targetObject && this._mode !== 'select') {
      this._attachTo(this._targetObject);
      this._setActiveMode(this._mode);
    }
  }

  dispose() {
    window.removeEventListener('cyco-vp-ready',              this._onVpReady);
    window.removeEventListener('cyco-renderer-changed',      this._onRendererChanged);
    window.removeEventListener('cyco-editor-camera-changed', this._onEditorCamChanged);
    window.removeEventListener('cyco-select-node',           this._onSelectNode);
    window.removeEventListener('cyco-deselect-all',          this._onDeselectAll);
    window.removeEventListener('cyco-vp-tool',               this._onTool);
    window.removeEventListener('cyco-vp-world',              this._onWorld);
    window.removeEventListener('cyco-rvp-snap',              this._onSnap);
    window.removeEventListener('cyco-vp-tick',               this._onVpTick);
    window.removeEventListener('cyco-hierarchy-remove',      this._onHierarchyRemove);
    window.removeEventListener('cyco-physics-edit-mode',     this._onPhysicsEditMode);
    window.removeEventListener('cyco-physics-edit-proxy-ready', this._onPhysicsProxyReady);
    window.removeEventListener('cyco-physics-edit-focus',    this._onPhysicsFocus);
    window.removeEventListener('cyco-physics-vp-tool',       this._onPhysicsTool);
    this._teardown();
  }
}