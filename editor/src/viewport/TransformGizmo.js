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

    this._tc      = null;
    this._gizmo   = null;
    this._controls = null;

    this._boxGroup      = null;
    this._boxHandles    = [];
    this._boxVolume     = null;
    this._boxActive     = false;
    this._hoveredHandle = null;
    this._interaction   = null;

    this._raycaster = new THREE.Raycaster();
    this._pointer   = new THREE.Vector2();

    this._onVpReady          = this._onVpReady.bind(this);
    this._onRendererChanged  = this._onRendererChanged.bind(this);
    this._onEditorCamChanged = this._onEditorCamChanged.bind(this);
    this._onSelectNode       = this._onSelectNode.bind(this);
    this._onDeselectAll      = this._onDeselectAll.bind(this);
    this._onTool             = this._onTool.bind(this);
    this._onWorld            = this._onWorld.bind(this);
    this._onSnap             = this._onSnap.bind(this);
    this._onHierarchyRemove  = this._onHierarchyRemove.bind(this);
    this._onGizmoPointerDown = this._onGizmoPointerDown.bind(this);
    this._onGizmoPointerMove = this._onGizmoPointerMove.bind(this);
    this._onGizmoPointerUp   = this._onGizmoPointerUp.bind(this);
    this._rcHandler          = null;

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

  _build() {
    const renderer = this.engine.rendererManager?.renderer;
    const camera   = this.engine.camera;
    const scene    = this.engine.scene;
    if (!renderer || !camera || !scene) return;

    this._teardown();

    const tc = new TransformControls(camera, renderer.domElement);
    tc.setSpace(this._space);

    this._rcHandler = (e) => {
      if (e.button !== 0) {
        try { renderer.domElement.releasePointerCapture(e.pointerId); } catch (_) {}
      }
    };
    renderer.domElement.addEventListener('pointerdown', this._rcHandler, { capture: true });
    renderer.domElement.addEventListener('pointerdown', this._onGizmoPointerDown, { capture: true });
    document.addEventListener('pointermove', this._onGizmoPointerMove, { capture: true });
    document.addEventListener('pointerup',   this._onGizmoPointerUp,   { capture: true });

    tc.addEventListener('dragging-changed', (event) => {
      const orbit = this.engine.controls;
      if (orbit) orbit.enabled = !event.value;
      this.selectionManager._gizmoDragging = !!event.value;
      this._isDragging = !!event.value;
    });

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

    this._buildBoxGizmo();
    this._applyMode();
    if (this._targetObject) this._attachTo(this._targetObject);
  }

  _teardown() {
    if (this._rcHandler) {
      const renderer = this.engine.rendererManager?.renderer;
      if (renderer?.domElement) {
        renderer.domElement.removeEventListener('pointerdown', this._rcHandler, { capture: true });
      }
      this._rcHandler = null;
    }

    const renderer = this.engine.rendererManager?.renderer;
    if (renderer?.domElement) {
      renderer.domElement.removeEventListener('pointerdown', this._onGizmoPointerDown, { capture: true });
    }
    document.removeEventListener('pointermove', this._onGizmoPointerMove, { capture: true });
    document.removeEventListener('pointerup',   this._onGizmoPointerUp,   { capture: true });

    if (this._tc) {
      const h = this._tc.getHelper();
      if (h?.parent) h.parent.remove(h);
      this._tc.dispose();
      this._tc = null;
    }
    this._gizmo = null;
    this.controls = null;

    if (this._boxGroup) {
      this._boxGroup.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
      if (this._boxGroup.parent) this._boxGroup.parent.remove(this._boxGroup);
      this._boxGroup = null;
      this._boxHandles = [];
      this._boxVolume = null;
      this._hoveredHandle = null;
      this._interaction = null;
    }
  }

  _applyMode() {
    if (!this._tc) return;
    if (this._mode === 'universal') {
      this._gizmo.visible = false;
      this._tc.enabled = false;
      this._showBox();
    } else if (this._mode === 'select') {
      this._gizmo.visible = false;
      this._tc.enabled = false;
      this._hideBox();
    } else {
      this._tc.setMode(this._mode);
      this._gizmo.visible = true;
      this._tc.enabled = true;
      this._hideBox();
    }
  }

  _attachTo(obj) {
    this._targetObject = obj;
    if (this._mode === 'universal') {
      this._showBox();
      this._updateBoxGizmo();
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

  _buildBoxGizmo() {
    if (this._boxGroup) return;
    const scene = this.engine.scene;
    if (!scene) return;

    this._boxGroup = new THREE.Group();
    this._boxGroup.name = '__cyco_box_gizmo__';
    this._boxGroup.userData._isGizmo = true;
    this._boxGroup.visible = false;
    scene.add(this._boxGroup);

    const outlineMaterial = new THREE.LineBasicMaterial({
      color: 0xe8eeff,
      transparent: true,
      opacity: 0.85,
      depthTest: false,
      depthWrite: false,
    });
    const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      outlineMaterial
    );
    outline.name = 'BoxGizmoOutline';
    outline.renderOrder = 1000;
    outline.userData._isGizmo = true;
    this._boxGroup.add(outline);

    const volumeMaterial = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.0,
      visible: false,
      depthTest: false,
    });
    const volume = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), volumeMaterial);
    volume.name = 'BoxGizmoVolume';
    volume.userData = { _isGizmo: true, handleRole: 'translate' };
    volume.renderOrder = 1001;
    volume.visible = false;
    this._boxGroup.add(volume);
    this._boxVolume = volume;

    const faceGeometry = new THREE.CylinderGeometry(0.5, 0.5, 0.2, 24);
    const edgeGeometry = new THREE.CylinderGeometry(0.25, 0.25, 1, 16);
    const cornerGeometry = new THREE.BoxGeometry(1, 1, 1);

    const faceAxes = [
      { dir: [1, 0, 0], axis: 'X', color: 0xff3b30 },
      { dir: [-1, 0, 0], axis: 'X', color: 0xff3b30 },
      { dir: [0, 1, 0], axis: 'Y', color: 0x34c759 },
      { dir: [0, -1, 0], axis: 'Y', color: 0x34c759 },
      { dir: [0, 0, 1], axis: 'Z', color: 0x0a84ff },
      { dir: [0, 0, -1], axis: 'Z', color: 0x0a84ff },
    ];

    const corners = [
      [-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5],
      [-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [0.5, 0.5, 0.5],
    ];

    const edgePairs = [
      [0, 1], [0, 2], [0, 4], [1, 3], [1, 5], [2, 3], [2, 6], [3, 7], [4, 5], [4, 6], [5, 7], [6, 7],
    ];

    faceAxes.forEach((config, index) => {
      const material = new THREE.MeshBasicMaterial({
        color: config.color,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
        depthWrite: false,
      });
      const face = new THREE.Mesh(faceGeometry, material);
      face.name = `BoxGizmoFace${index}`;
      face.userData = {
        _isGizmo: true,
        handleRole: 'scaleAxis',
        handleAxis: config.axis,
        handleDir: new THREE.Vector3(...config.dir),
        baseColor: config.color,
        hoverColor: 0xffff00,
      };
      face.renderOrder = 1001;
      face.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...config.dir));
      this._boxGroup.add(face);
      this._boxHandles.push(face);
    });

    edgePairs.forEach((pair, index) => {
      const a = new THREE.Vector3().fromArray(corners[pair[0]]);
      const b = new THREE.Vector3().fromArray(corners[pair[1]]);
      const midpoint = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
      const direction = new THREE.Vector3().subVectors(b, a).normalize();
      const axis = Math.abs(direction.x) > 0.9 ? 'X' : Math.abs(direction.y) > 0.9 ? 'Y' : 'Z';
      const color = axis === 'X' ? 0xff3b30 : axis === 'Y' ? 0x34c759 : 0x0a84ff;
      const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
        depthWrite: false,
      });
      const edge = new THREE.Mesh(edgeGeometry, material);
      edge.name = `BoxGizmoEdge${index}`;
      edge.userData = {
        _isGizmo: true,
        handleRole: 'rotate',
        handleAxis: axis,
        handleDir: direction.clone(),
        localPosition: midpoint.clone(),
        baseColor: color,
        hoverColor: 0xffff00,
      };
      edge.renderOrder = 1001;
      edge.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
      edge.position.copy(midpoint);
      this._boxGroup.add(edge);
      this._boxHandles.push(edge);
    });

    corners.forEach((position, index) => {
      const material = new THREE.MeshBasicMaterial({
        color: 0xe8eeff,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
        depthWrite: false,
      });
      const corner = new THREE.Mesh(cornerGeometry, material);
      corner.name = `BoxGizmoCorner${index}`;
      corner.userData = {
        _isGizmo: true,
        handleRole: 'scaleUniform',
        handleAxis: 'XYZ',
        handleDir: new THREE.Vector3().fromArray(position).normalize(),
        baseColor: 0xe8eeff,
        hoverColor: 0xffff00,
      };
      corner.renderOrder = 1001;
      corner.position.fromArray(position);
      this._boxGroup.add(corner);
      this._boxHandles.push(corner);
    });
  }

  _showBox() {
    if (!this._boxGroup) this._buildBoxGizmo();
    if (this._boxGroup) {
      this._boxGroup.visible = true;
      this._boxActive = true;
      this._updateBoxGizmo();
    }
  }

  _hideBox() {
    if (this._boxGroup) {
      this._boxGroup.visible = false;
      this._clearHoveredHandle();
    }
    this._boxActive = false;
  }

  _updateBoxGizmo() {
    if (!this._boxActive || !this._targetObject || !this._boxGroup) return;

    const target = this._targetObject;
    const outline = this._boxGroup.getObjectByName('BoxGizmoOutline');
    if (!outline) return;

    const center = new THREE.Vector3();
    const size = new THREE.Vector3(1, 1, 1);
    const worldPosition = new THREE.Vector3();
    const worldQuaternion = new THREE.Quaternion();
    const worldScale = new THREE.Vector3(1, 1, 1);

    const isMesh = target.isMesh && target.geometry;
    if (isMesh) {
      const geometry = target.geometry;
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      if (geometry.boundingBox) {
        geometry.boundingBox.getCenter(center);
        geometry.boundingBox.getSize(size);
        target.getWorldScale(worldScale);
        size.multiply(worldScale);
        center.multiply(worldScale);
        target.getWorldPosition(worldPosition);
        target.getWorldQuaternion(worldQuaternion);
        this._boxGroup.position.copy(worldPosition);
        this._boxGroup.quaternion.copy(worldQuaternion);
        this._boxGroup.scale.set(1, 1, 1);
        outline.position.copy(center);
      }
    }

    if (!isMesh || size.x === 0 || size.y === 0 || size.z === 0) {
      const worldBox = new THREE.Box3().setFromObject(target);
      if (!worldBox.isEmpty()) {
        worldBox.getCenter(center);
        worldBox.getSize(size);
      }
      this._boxGroup.position.copy(center);
      this._boxGroup.quaternion.copy(target.getWorldQuaternion(new THREE.Quaternion()));
      this._boxGroup.scale.set(1, 1, 1);
      size.set(Math.max(0.1, size.x), Math.max(0.1, size.y), Math.max(0.1, size.z));
      center.set(0, 0, 0);
    }

    size.set(Math.max(0.1, size.x), Math.max(0.1, size.y), Math.max(0.1, size.z));
    outline.geometry.dispose();
    outline.geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(size.x, size.y, size.z));

    if (this._boxVolume) {
      this._boxVolume.scale.copy(size);
      this._boxVolume.position.set(0, 0, 0);
    }

    const faceRadius = Math.min(size.x, size.y, size.z) * 0.12;
    const edgeRadius = Math.min(size.x, size.y, size.z) * 0.06;
    const edgeLength = Math.max(size.x, size.y, size.z) * 0.65;
    const cornerScale = Math.min(size.x, size.y, size.z) * 0.08;
    const faceDepth = Math.min(size.x, size.y, size.z) * 0.12;

    this._boxHandles.forEach((handle) => {
      const role = handle.userData.handleRole;
      const dir = handle.userData.handleDir?.clone();
      if (role === 'scaleAxis' && dir) {
        handle.position.copy(dir).multiply(size).multiplyScalar(0.5);
        handle.position.addScaledVector(dir, faceDepth * 0.5);
        handle.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        handle.scale.set(faceRadius * 1.6, faceDepth, faceRadius * 1.6);
      } else if (role === 'rotate' && dir) {
        const localPosition = handle.userData.localPosition?.clone() ?? new THREE.Vector3();
        handle.position.copy(localPosition).multiply(size);
        handle.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        handle.scale.set(edgeRadius, edgeLength, edgeRadius);
      } else if (role === 'scaleUniform' && dir) {
        handle.position.copy(dir).multiply(size).multiplyScalar(0.5);
        handle.position.addScaledVector(dir, cornerScale * 0.5);
        handle.quaternion.identity();
        handle.scale.setScalar(cornerScale);
      }
    });
  }

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

  _onGizmoPointerDown(event) {
    if (event.button !== 0 || this._mode !== 'universal' || !this._boxActive || !this._boxGroup) return;
    const hit = this._pickGizmoHit(event);
    if (!hit) return;

    event.stopPropagation();
    event.preventDefault();
    window.__cyco = window.__cyco || {};
    window.__cyco._suppressSelectionManagerClick = true;

    if (this._targetObject && !this.selectionManager.selected.has(this._targetObject)) {
      this.selectionManager.selectObject(this._targetObject);
    }

    this._clearHoveredHandle();
    this._matrixBefore = this._targetObject?.matrix.clone();
    this._interaction = {
      pointerId: event.pointerId,
      type: hit.object.userData.handleRole || 'translate',
      axis: hit.object.userData.handleAxis || null,
      axisDir: hit.object.userData.handleDir ? hit.object.userData.handleDir.clone() : null,
      faceNormal: hit.face ? hit.face.normal.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize() : null,
      startX: event.clientX,
      startY: event.clientY,
      startPosition: this._targetObject ? this._targetObject.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(),
      startQuaternion: this._targetObject ? this._targetObject.quaternion.clone() : new THREE.Quaternion(),
      startScale: this._targetObject ? this._targetObject.scale.clone() : new THREE.Vector3(1, 1, 1),
    };

    if (event.target?.setPointerCapture) {
      try { event.target.setPointerCapture(event.pointerId); } catch (_) {}
    }

    this._isDragging = true;
  }

  _onGizmoPointerMove(event) {
    if (!this._boxActive || !this._boxGroup) return;
    if (this._interaction && this._interaction.pointerId === event.pointerId) {
      event.stopPropagation();
      event.preventDefault();
      this._updateInteraction(event);
      return;
    }

    const hit = this._pickGizmoHit(event);
    if (hit && hit.object.userData._isGizmo) {
      if (hit.object.userData.handleRole !== 'translate') {
        this._setHoveredHandle(hit.object);
      }
      if (this.engine.rendererManager?.renderer?.domElement) {
        this.engine.rendererManager.renderer.domElement.style.cursor = hit.object.userData.handleRole === 'translate' ? 'move' : 'default';
      }
      return;
    }

    this._clearHoveredHandle();
    if (this.engine.rendererManager?.renderer?.domElement) {
      this.engine.rendererManager.renderer.domElement.style.cursor = 'default';
    }
  }

  _onGizmoPointerUp(event) {
    if (!this._interaction || this._interaction.pointerId !== event.pointerId) return;
    event.stopPropagation();
    event.preventDefault();
    if (event.target?.releasePointerCapture) {
      try { event.target.releasePointerCapture(event.pointerId); } catch (_) {}
    }

    const obj = this._targetObject;
    const before = this._matrixBefore;
    const after = obj ? obj.matrix.clone() : null;
    if (obj && before && after && !before.equals(after)) {
      window.dispatchEvent(new CustomEvent('cyco-command-execute', {
        detail: {
          name: `${this._interaction.type.charAt(0).toUpperCase() + this._interaction.type.slice(1)} ${obj.name}`,
          do()   { obj.matrix.copy(after); obj.matrix.decompose(obj.position, obj.quaternion, obj.scale); },
          undo() { obj.matrix.copy(before); obj.matrix.decompose(obj.position, obj.quaternion, obj.scale); },
        }
      }));
    }

    this._matrixBefore = null;
    this._interaction = null;
    this._isDragging = false;
    if (window.__cyco) { try { delete window.__cyco._suppressSelectionManagerClick; } catch (_) {} }
    this._updateBoxGizmo();
    this._clearHoveredHandle();
  }

  _pickGizmoHit(event) {
    const renderer = this.engine.rendererManager?.renderer;
    const camera = this.engine.camera;
    if (!renderer || !camera || !this._boxGroup) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this._pointer.set(x, y);
    this._raycaster.setFromCamera(this._pointer, camera);
    const hits = this._raycaster.intersectObjects(this._boxGroup.children, true);
    return hits.length > 0 ? hits[0] : null;
  }

  _setHoveredHandle(handle) {
    if (this._hoveredHandle === handle) return;
    this._clearHoveredHandle();
    if (!handle || !handle.material) return;
    this._hoveredHandle = handle;
    handle.material.color.set(handle.userData.hoverColor || 0xffff00);
  }

  _clearHoveredHandle() {
    if (!this._hoveredHandle) return;
    const handle = this._hoveredHandle;
    if (handle.material && handle.userData?.baseColor) {
      handle.material.color.set(handle.userData.baseColor);
    }
    this._hoveredHandle = null;
  }

  _updateInteraction(event) {
    if (!this._interaction || !this._targetObject) return;
    const dx = event.clientX - this._interaction.startX;
    const dy = event.clientY - this._interaction.startY;
    if (this._interaction.type === 'translate') {
      this._updateTranslate(dx, dy);
    } else if (this._interaction.type === 'rotate') {
      this._updateRotate(dx, dy);
    } else if (this._interaction.type === 'scaleAxis') {
      this._updateScaleAxis(dx, dy);
    } else if (this._interaction.type === 'scaleUniform') {
      this._updateScaleUniform(dx, dy);
    }
    this._updateBoxGizmo();
  }

  _updateTranslate(dx, dy) {
    const camera = this.engine.camera;
    if (!camera) return;
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward).normalize();
    const up = new THREE.Vector3().copy(camera.up).normalize();
    const right = new THREE.Vector3().crossVectors(forward, up).normalize();
    const move = new THREE.Vector3();
    const faceNormal = this._interaction.faceNormal;
    if (faceNormal && Math.abs(faceNormal.y) > 0.75) {
      move.addScaledVector(right, dx * 0.0025);
      move.addScaledVector(up, -dy * 0.0025);
    } else {
      move.addScaledVector(right, dx * 0.0025);
      move.addScaledVector(forward, dy * 0.0025);
    }
    const worldPosition = this._interaction.startPosition.clone().add(move);
    if (this._targetObject.parent) {
      this._targetObject.parent.worldToLocal(worldPosition);
    }
    this._targetObject.position.copy(worldPosition);
  }

  _updateRotate(dx, dy) {
    const axis = this._interaction.axisDir || new THREE.Vector3(0, 1, 0);
    const direction = (Math.abs(dx) > Math.abs(dy) ? dx : -dy) * 0.005;
    const rotation = new THREE.Quaternion().setFromAxisAngle(axis, direction);
    this._targetObject.quaternion.copy(this._interaction.startQuaternion).premultiply(rotation);
  }

  _updateScaleAxis(dx, dy) {
    const axis = this._interaction.axis;
    const factor = Math.max(0.05, 1 + (Math.abs(dx) > Math.abs(dy) ? -dx : dy) * 0.0025);
    const scale = this._interaction.startScale.clone();
    if (axis === 'X') scale.x *= factor;
    if (axis === 'Y') scale.y *= factor;
    if (axis === 'Z') scale.z *= factor;
    this._targetObject.scale.copy(scale);
  }

  _updateScaleUniform(dx, dy) {
    const factor = Math.max(0.05, 1 + (Math.abs(dx) > Math.abs(dy) ? -dx : dy) * 0.0025);
    this._targetObject.scale.copy(this._interaction.startScale).multiplyScalar(factor);
  }

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
