import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

export class TransformGizmo {
  constructor(viewportEngine, selectionManager) {
    this.engine           = viewportEngine;
    this.selectionManager = selectionManager;

    this._mode         = 'select';
    this._space        = 'world';
    this._targetObject = null;
    this._isDragging   = false;
    this._matrixBefore = null;

    // Single TransformControls — mode switches via setMode()
    this._tc     = null;  // the one active TC
    this._gizmo  = null;  // the TC's helper group in scene
    this._controls = null; // alias for backward compat

    // Box tool (bounding box with corner-scale handles)
    this._boxGroup  = null;
    this._boxEdges  = null;
    this._boxPickers = [];
    this._boxActive = false;
    this._boxListeners = null;

    this._onVpReady          = this._onVpReady.bind(this);
    this._onRendererChanged  = this._onRendererChanged.bind(this);
    this._onEditorCamChanged = this._onEditorCamChanged.bind(this);
    this._onSelectNode       = this._onSelectNode.bind(this);
    this._onDeselectAll      = this._onDeselectAll.bind(this);
    this._onTool             = this._onTool.bind(this);
    this._onWorld            = this._onWorld.bind(this);
    this._onSnap             = this._onSnap.bind(this);
    this._onHierarchyRemove  = this._onHierarchyRemove.bind(this);
    this._rcHandler = null;

    window.addEventListener('cyco-vp-ready',              this._onVpReady);
    window.addEventListener('cyco-renderer-changed',      this._onRendererChanged);
    window.addEventListener('cyco-editor-camera-changed', this._onEditorCamChanged);
    window.addEventListener('cyco-select-node',           this._onSelectNode);
    window.addEventListener('cyco-deselect-all',          this._onDeselectAll);
    window.addEventListener('cyco-vp-tool',               this._onTool);
    window.addEventListener('cyco-vp-world',              this._onWorld);
    window.addEventListener('cyco-rvp-snap',              this._onSnap);
    window.addEventListener('cyco-hierarchy-remove',      this._onHierarchyRemove);
  }

  get controls() { return this._controls; }
  set controls(v) { this._controls = v; }

  // === Build ===

  _build() {
    const renderer = this.engine.rendererManager?.renderer;
    const camera   = this.engine.camera;
    const scene    = this.engine.scene;
    if (!renderer || !camera || !scene) return;

    this._teardown();

    // Single TransformControls — exactly like the Three.js example
    const tc = new TransformControls(camera, renderer.domElement);
    tc.setSpace(this._space);

    // Prevent TransformControls from blocking right-click context menu.
    // TC's pointerdown handler calls setPointerCapture on ALL clicks,
    // which can swallow the contextmenu event. Release capture on right-click.
    this._rcHandler = (e) => {
      if (e.button !== 0) {
        try { renderer.domElement.releasePointerCapture(e.pointerId); } catch (_) {}
      }
    };
    renderer.domElement.addEventListener('pointerdown', this._rcHandler, { capture: true });

    // Disable orbit while dragging (official example pattern)
    tc.addEventListener('dragging-changed', (event) => {
      const orbit = this.engine.controls;
      if (orbit) orbit.enabled = !event.value;
      this.selectionManager._gizmoDragging = !!event.value;
      this._isDragging = !!event.value;
    });

    // Record matrix before drag for undo/redo
    tc.addEventListener('mouseDown', () => {
      this._isDragging = true;
      const orbit = this.engine.controls;
      if (orbit) orbit.enabled = false;
      if (this._targetObject) this._matrixBefore = this._targetObject.matrix.clone();
    });

    tc.addEventListener('mouseUp', () => {
      this._isDragging = false;
      const orbit = this.engine.controls;
      if (orbit) orbit.enabled = true;
      if (this._targetObject && this._matrixBefore) {
        const before = this._matrixBefore;
        const after  = this._targetObject.matrix.clone();
        const obj    = this._targetObject;
        window.dispatchEvent(new CustomEvent('cyco-command-execute', {
          detail: {
            name: `Transform ${obj.name}`,
            do()   { obj.matrix.copy(after); obj.matrix.decompose(obj.position, obj.quaternion, obj.scale); },
            undo() { obj.matrix.copy(before); obj.matrix.decompose(obj.position, obj.quaternion, obj.scale); },
          }
        }));
      }
      this._matrixBefore = null;
    });

    this._tc = tc;
    this._controls = tc;
    const gizmo = tc.getHelper();
    gizmo.traverse((child) => {
      child.userData._isGizmo = true;
    });
    gizmo.userData._isGizmo = true;
    scene.add(gizmo);
    this._gizmo = gizmo;

    // Build box tool (hidden by default)
    this._boxGroup = new THREE.Group();
    this._boxGroup.name = '__cyco_box_gizmo__';
    this._boxGroup.userData._isGizmo = true;
    this._boxGroup.visible = false;
    scene.add(this._boxGroup);
    this._buildBoxHandles();

    // Apply initial mode
    this._applyMode();

    // Re-attach if we have a target
    if (this._targetObject) this._attachTo(this._targetObject);
  }

  _teardown() {
    this._removeBoxListeners();

    // Remove right-click capture release handler
    if (this._rcHandler) {
      const renderer = this.engine.rendererManager?.renderer;
      if (renderer?.domElement) {
        renderer.domElement.removeEventListener('pointerdown', this._rcHandler, { capture: true });
      }
      this._rcHandler = null;
    }

    if (this._tc) {
      const h = this._tc.getHelper();
      if (h?.parent) h.parent.remove(h);
      this._tc.dispose();
      this._tc = null;
    }
    this._gizmo = null;
    this.controls = null;
    if (this._boxGroup) {
      if (this._boxGroup.parent) this._boxGroup.parent.remove(this._boxGroup);
      this._boxGroup = null;
    }
  }

  // === Mode switching ===

  _applyMode() {
    if (!this._tc) return;
    if (this._mode === 'universal') {
      // Box mode: hide TC gizmo, show box
      this._gizmo.visible = false;
      this._tc.enabled = false;
      this._showBox();
    } else if (this._mode === 'select') {
      // Select mode: hide everything
      this._gizmo.visible = false;
      this._tc.enabled = false;
      this._hideBox();
    } else {
      // translate / rotate / scale: show TC, hide box
      this._tc.setMode(this._mode);
      this._gizmo.visible = true;
      this._tc.enabled = true;
      this._hideBox();
    }
  }

  // === Attach / Detach ===

  _attachTo(obj) {
    this._targetObject = obj;
    if (this._mode === 'universal') {
      this._updateBox();
    } else if (this._tc) {
      this._tc.attach(obj);
      this._applyMode();
    }
  }

  _detachAll() {
    this._targetObject = null;
    if (this._tc) this._tc.detach();
    this._hideBox();
  }

  detach() { this._detachAll(); }

  // === Box tool (bounding box with uniform-scale corners) ===

  _buildBoxHandles() {
    const g = this._boxGroup;
    const edgesGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1,1,1));
    this._boxEdges = new THREE.LineSegments(edgesGeo, new THREE.LineBasicMaterial({ color: 0xff8800 }));
    this._boxEdges.raycast = () => {};
    g.add(this._boxEdges);

    const hGeo = new THREE.SphereGeometry(0.08, 8, 6);
    const hMat = new THREE.MeshBasicMaterial({ color: 0xff8800 });
    this._boxPickers = [];
    const corners = [[-1,-1,-1],[1,-1,-1],[-1,1,-1],[1,1,-1],[-1,-1,1],[1,-1,1],[-1,1,1],[1,1,1]];
    for (const [cx,cy,cz] of corners) {
      const m = new THREE.Mesh(hGeo.clone(), hMat.clone());
      m.position.set(cx,cy,cz);
      m.scale.setScalar(0.08);
      m.userData._boxCorner = {cx,cy,cz};
      m.userData._isGizmo = true;
      m.raycast = () => {};
      g.add(m);
      this._boxPickers.push(m);
    }
  }

  _updateBox() {
    const obj = this._targetObject;
    if (!obj || !this._boxEdges) return;
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) return;
    const size = new THREE.Vector3(); box.getSize(size);
    const center = new THREE.Vector3(); box.getCenter(center);
    this._boxEdges.geometry.dispose();
    this._boxEdges.geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x, size.y, size.z));
    this._boxEdges.position.copy(center);
    const hx = size.x/2, hy = size.y/2, hz = size.z/2;
    for (const p of this._boxPickers) {
      const {cx,cy,cz} = p.userData._boxCorner;
      p.position.set(center.x+cx*hx, center.y+cy*hy, center.z+cz*hz);
      p.scale.setScalar(Math.max(0.08, Math.min(size.x,size.y,size.z)*0.03));
    }
  }

  _showBox() {
    if (this._boxGroup) this._boxGroup.visible = true;
    this._boxActive = true;
    this._updateBox();
    this._addBoxListeners();
  }

  _hideBox() {
    if (this._boxGroup) this._boxGroup.visible = false;
    this._boxActive = false;
    this._removeBoxListeners();
  }

  _addBoxListeners() {
    if (this._boxListeners) return;
    const renderer = this.engine.rendererManager?.renderer;
    if (!renderer?.domElement) return;
    const canvas = renderer.domElement;
    const down = (e) => this._onBoxPointerDown(e);
    canvas.addEventListener('pointerdown', down);
    this._boxListeners = { canvas, down };
  }

  _removeBoxListeners() {
    if (!this._boxListeners) return;
    this._boxListeners.canvas.removeEventListener('pointerdown', this._boxListeners.down);
    this._boxListeners = null;
  }

  _onBoxPointerDown(e) {
    if (this._mode !== 'universal' || !this._targetObject) return;
    if (e.button !== 0) return; // only left-click for box handles
    const renderer = this.engine.rendererManager?.renderer;
    const camera   = this.engine.camera;
    if (!renderer || !camera) return;
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX-rect.left)/rect.width)*2-1, -((e.clientY-rect.top)/rect.height)*2+1);
    const ray = new THREE.Raycaster().setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(this._boxPickers, false);
    if (!hits.length) return;
    const corner = hits[0].object.userData._boxCorner;
    if (!corner) return;
    // Only prevent default/stop propagation for left-click on a handle
    // Right-click must pass through so contextmenu can fire.
    e.preventDefault();
    e.stopPropagation();

    const obj = this._targetObject;
    const box = new THREE.Box3().setFromObject(obj);
    const origSize = new THREE.Vector3(); box.getSize(origSize);
    const origScale = obj.scale.clone();
    const center = new THREE.Vector3(); box.getCenter(center);

    this._isDragging = true;
    const orbit = this.engine.controls;
    if (orbit) orbit.enabled = false;

    const onMove = (ev) => {
      const r2 = renderer.domElement.getBoundingClientRect();
      const n2 = new THREE.Vector2(((ev.clientX-r2.left)/r2.width)*2-1, -((ev.clientY-r2.top)/r2.height)*2+1);
      const ray2 = new THREE.Raycaster().setFromCamera(n2, camera);
      const cw = new THREE.Vector3(center.x+corner.cx*origSize.x/2, center.y+corner.cy*origSize.y/2, center.z+corner.cz*origSize.z/2);
      const camDir = new THREE.Vector3(); camera.getWorldDirection(camDir);
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(camDir, cw);
      const tgt = new THREE.Vector3(); ray2.ray.intersectPlane(plane, tgt);
      if (!tgt) return;
      const origDist = center.distanceTo(cw);
      const newDist  = center.distanceTo(tgt);
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
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  }

  // === Event handlers ===

  _onVpReady() { this._build(); }
  _onRendererChanged() { this._build(); }
  _onEditorCamChanged() { this._build(); }

  _onSelectNode(event) {
    const { object } = event.detail;
    if (!object || object.userData.cycoLocked) { this.detach(); return; }
    this._attachTo(object);
  }

  _onDeselectAll() { this.detach(); }

  _onHierarchyRemove(e) {
    const { objectId } = e.detail ?? {};
    if (objectId && this._targetObject?.userData?.cycoId === objectId) this.detach();
  }

  _onTool(event) {
    const { mode } = event.detail;
    if (!['translate','rotate','scale','select','universal'].includes(mode)) return;
    this._mode = mode;
    this._applyMode();
    if (this._targetObject) this._attachTo(this._targetObject);
  }

  _onWorld(event) {
    const isWorld = event.detail?.isWorld ?? event.detail ?? false;
    this._space = isWorld ? 'world' : 'local';
    if (this._tc) this._tc.setSpace(this._space);
  }

  _onSnap(event) {
    const d = event.detail;
    let enabled = false, value = 0.25;
    if (typeof d === 'boolean') { enabled = d; }
    else if (d && typeof d === 'object') { enabled = !!d.enabled; value = d.value ?? value; }
    if (!this._tc) return;
    this._tc.translationSnap = enabled ? value : null;
    this._tc.rotationSnap    = enabled ? Math.PI / 12 : null;
    this._tc.scaleSnap       = enabled ? value * 0.1 : null;
  }

  // === Lifecycle ===

  suspend() { this.detach(); }
  restore() { if (this._targetObject && this._mode !== 'select') this._attachTo(this._targetObject); }

  dispose() {
    window.removeEventListener('cyco-vp-ready', this._onVpReady);
    window.removeEventListener('cyco-renderer-changed', this._onRendererChanged);
    window.removeEventListener('cyco-editor-camera-changed', this._onEditorCamChanged);
    window.removeEventListener('cyco-select-node', this._onSelectNode);
    window.removeEventListener('cyco-deselect-all', this._onDeselectAll);
    window.removeEventListener('cyco-vp-tool', this._onTool);
    window.removeEventListener('cyco-vp-world', this._onWorld);
    window.removeEventListener('cyco-rvp-snap', this._onSnap);
    window.removeEventListener('cyco-hierarchy-remove', this._onHierarchyRemove);
    this._teardown();
  }
}