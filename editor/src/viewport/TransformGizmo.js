/**
 * TransformGizmo.js
 * Wraps Three.js TransformControls. Attaches to selected objects,
 * handles mode switching (translate/rotate/scale), snap, and world/local space.
 * Disables OrbitControls while dragging to prevent camera rotation conflicts.
 * Records TransformCommands for undo/redo.
 *
 * Depends on: ViewportEngine (injected), SelectionManager (injected)
 *
 * Events consumed:
 *   cyco-vp-ready           { scene, camera }      ΓÇö set up controls after viewport ready
 *   cyco-renderer-changed   { renderer }           ΓÇö rebuild on renderer swap
 *   cyco-select-node        { object }             ΓÇö attach gizmo to selection
 *   cyco-deselect-all       {}                     ΓÇö detach gizmo
 *   cyco-vp-tool            { mode }               ΓÇö 'translate' | 'rotate' | 'scale'
 *   cyco-physics-vp-tool    { mode }               ΓÇö physics edit translate/rotate/scale (collider gizmo only)
 *   cyco-rvp-snap           { enabled, value }     ΓÇö snap toggle + value
 *   cyco-rvp-world          { isWorld }            ΓÇö world / local space toggle
 *   cyco-gizmo-size         { size }               ΓÇö from Preferences
 */

import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

try { if (typeof window !== 'undefined' && window.__cyco_log) window.__cyco_log('[TransformGizmo] module loaded'); else console.log('[TransformGizmo] module loaded'); } catch (err) {}

export class TransformGizmo {
  /**
   * @param {import('./ViewportEngine.js').ViewportEngine} viewportEngine
   * @param {import('./SelectionManager.js').SelectionManager} selectionManager
   */
  constructor(viewportEngine, selectionManager) {
    this.engine           = viewportEngine;
    this.selectionManager = selectionManager;

    /** @type {TransformControls|null} */
    this.controls = null;
    this._tcRotate = null;
    this._tcScale = null;
    this._tcs = [];
    /** Separate camera copy used for TransformControls raycasting/rendering. */
    this._controlsCamera = null;

    this._snapEnabled = false;
    this._snapValue   = 0.25;
    this._mode        = 'select'; // default: pointer/select, no gizmo shown
    this._space       = 'world';
    this._physicsEdit = false;
    this._physicsEditMode = 'translate';
    this._pendingPhysicsAttach = false;
    this._isDragging = false;
    this._scaleInterceptPending = false;

    /** State snapshot before a drag begins (for TransformCommand undo). */
    this._matrixBefore = null;
    this._targetObject = null;
    this._targetProxy  = null;

    this._onVpReady          = this._onVpReady.bind(this);
    this._onRendererChanged  = this._onRendererChanged.bind(this);
    this._onEditorCamChanged = this._onEditorCamChanged.bind(this);
    this._onSelectNode       = this._onSelectNode.bind(this);
    this._onDeselectAll      = this._onDeselectAll.bind(this);
    this._onTool             = this._onTool.bind(this);
    this._onPhysicsTool      = this._onPhysicsTool.bind(this);
    this._onPhysicsProxyReady = this._onPhysicsProxyReady.bind(this);
    this._onSnap             = this._onSnap.bind(this);
    this._onWorld            = this._onWorld.bind(this);
    this._onGizmoSize        = this._onGizmoSize.bind(this);
    this._onPhysicsEditMode   = this._onPhysicsEditMode.bind(this);
    this._onControlChange    = this._onControlChange.bind(this);
    this._onVpTick           = this._onVpTick.bind(this);

    window.addEventListener('cyco-vp-ready',              this._onVpReady);
    window.addEventListener('cyco-renderer-changed',      this._onRendererChanged);
    window.addEventListener('cyco-editor-camera-changed', this._onEditorCamChanged);
    window.addEventListener('cyco-vp-tick',               this._onVpTick);
    window.addEventListener('cyco-select-node',           this._onSelectNode);
    window.addEventListener('cyco-deselect-all',          this._onDeselectAll);
    window.addEventListener('cyco-hierarchy-remove',  (e) => {
      const { objectId } = e.detail ?? {};
      if (objectId && this._targetObject?.userData?.cycoId === objectId) this.detach();
    });
    window.addEventListener('cyco-vp-tool',           this._onTool);
    window.addEventListener('cyco-physics-vp-tool',   this._onPhysicsTool);
    window.addEventListener('cyco-physics-edit-proxy-ready', this._onPhysicsProxyReady);
    window.addEventListener('cyco-physics-edit-focus', this._onPhysicsFocus?.bind(this));
    window.addEventListener('cyco-rvp-snap',          this._onSnap);
    window.addEventListener('cyco-rvp-world',         this._onWorld);
    window.addEventListener('cyco-vp-world',          this._onWorld);
    window.addEventListener('cyco-gizmo-size',        this._onGizmoSize);
    window.addEventListener('cyco-physics-edit-mode', this._onPhysicsEditMode);
  }

  // ΓöÇΓöÇΓöÇ Build ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

  _getControlsCamera(camera) {
    if (!camera) return null;

    if (!this._controlsCamera || this._controlsCamera.type !== camera.type) {
      this._controlsCamera = camera.clone();
    }

    const proxy = this._controlsCamera;
    proxy.position.copy(camera.position);
    proxy.quaternion.copy(camera.quaternion);
    proxy.rotation.copy(camera.rotation);
    proxy.near = camera.near;
    proxy.far = camera.far;
    if (camera.isPerspectiveCamera) {
      proxy.aspect = camera.aspect;
    } else if (camera.isOrthographicCamera) {
      proxy.left   = camera.left;
      proxy.right  = camera.right;
      proxy.top    = camera.top;
      proxy.bottom = camera.bottom;
    }
    proxy.zoom = camera.zoom;
    proxy.projectionMatrix.copy(camera.projectionMatrix);
    proxy.matrixWorld.copy(camera.matrixWorld);
    proxy.matrixWorldInverse.copy(camera.matrixWorldInverse);
    proxy.updateMatrixWorld();
    return proxy;
  }

  _build(renderer) {
    const camera = this.engine.camera;
    const scene  = this.engine.scene;
    if (!camera || !scene || !renderer?.domElement) return;

    if (this._tcs.length) {
      for (const tc of this._tcs) {
        try {
          const helper = tc.getHelper();
          if (helper && helper.parent) helper.parent.remove(helper);
          tc.dispose();
        } catch (err) {}
      }
      this._tcs = [];
      this.controls = null;
      this._tcRotate = null;
      this._tcScale = null;
    }

    const controlCamera = this._getControlsCamera(camera);
    if (!controlCamera) return;

    this._tcTranslate = this._createControl('translate', controlCamera.clone(), renderer.domElement);
    this._tcRotate    = this._createControl('rotate',    controlCamera.clone(), renderer.domElement);
    this._tcScale     = this._createControl('scale',     controlCamera.clone(), renderer.domElement);
    this.controls     = this._tcTranslate;
    this._tcs         = [this._tcTranslate, this._tcRotate, this._tcScale];

    this._tcTranslate.setSize(1.0);
    this._tcRotate.setSize(0.55);
    this._tcScale.setSize(0.75);

    this._applySnap();

    for (const tc of this._tcs) {
      tc.setColors(0xff2222, 0x00dd44, 0x2255ff, 0xffee00);
      const helper = tc.getHelper();
      helper.traverse(child => { child.userData._isGizmo = true; });
      this.selectionManager.addNonSelectable(helper);
      scene.add(helper);
    }

    this._patchGizmosForUniversal();
    this._setupUniversalIntercept(renderer.domElement);
    this._setupGlobalFailsafe();

    if (this._targetObject) {
      for (const tc of this._tcs) {
        try {
          tc.attach(this._targetObject);
        } catch (err) {}
      }
      if (this._mode !== 'select') this._show();
      else this._hide();
    } else {
      this._hide();
    }
  }

  _createControl(mode, camera, domElement) {
    const tc = new TransformControls(camera, domElement);
    tc.setMode(mode);
    tc.setSpace(this._space);
    tc.addEventListener('dragging-changed', event => {
      const orbitControls = this.engine.controls;
      if (orbitControls) orbitControls.enabled = !event.value;
      this.selectionManager._gizmoDragging = !!event.value;
      this._isDragging = !!event.value;
      if (event.value) this._scaleInterceptPending = false;
      try {
        this._setGizmoActive(!!event.value);
      } catch (err) {}
    });

    tc.addEventListener('change', () => {
      if (this._physicsEdit) {
        try {
          this._updatePhysicsComponentFromProxy();
        } catch (err) {
          console.warn('Error updating physics component during drag', err);
        }
      }
    });

    tc.addEventListener('mouseDown', () => {
      const obj = tc.object;
      if (!obj) return;
      this._snapPos = obj.position.clone();
      this._snapRot = obj.rotation.clone();
      this._snapScl = obj.scale.clone();
      this._isDragging = true;
      this._scaleInterceptPending = false;
      for (const other of this._tcs) {
        if (other !== tc) other.enabled = false;
      }
      const orbitControls = this.engine.controls;
      if (orbitControls) orbitControls.enabled = false;
      const target = tc.object ?? this._targetObject;
      if (target) {
        this._matrixBefore = target.matrix.clone();
      }
    });

    tc.addEventListener('mouseUp', () => {
      this._isDragging = false;
      if (this._mode === 'universal') {
        for (const other of this._tcs) other.enabled = true;
      } else {
        tc.enabled = true;
      }
      const orbitControls = this.engine.controls;
      if (orbitControls) orbitControls.enabled = true;

      if (this._physicsEdit) {
        this._updatePhysicsComponentFromProxy();
      }

      if (this._targetObject && this._matrixBefore && !this._physicsEdit) {
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

    tc.addEventListener('objectChange', () => {
      if (tc.object) {
        window.dispatchEvent(new CustomEvent('cyco-object-transform-changed', { detail: { object: tc.object } }));
      }
    });

    return tc;
  }

  _attachAllControls(target) {
    if (!target) return;
    for (const tc of this._tcs) {
      try {
        tc.attach(target);
      } catch (err) {
        // ignore attach failures until the target is in the scene graph
      }
    }
  }

  _detachAllControls() {
    for (const tc of this._tcs) {
      try {
        tc.detach();
      } catch (err) {}
    }
  }

  _setupGlobalFailsafe() {
    const cleanup = () => {
      this._isDragging = false;
      this._scaleInterceptPending = false;
      if (this._mode === 'universal') {
        for (const tc of this._tcs) tc.enabled = true;
      } else {
        for (const tc of this._tcs) {
          tc.enabled = (this._mode === 'translate' && tc.mode === 'translate')
                    || (this._mode === 'rotate'    && tc.mode === 'rotate')
                    || (this._mode === 'scale'     && tc.mode === 'scale');
        }
      }
      const orbitControls = this.engine.controls;
      if (orbitControls) orbitControls.enabled = true;
    };

    window.addEventListener('pointerup', () => requestAnimationFrame(cleanup));
    window.addEventListener('pointercancel', () => requestAnimationFrame(cleanup));
    window.addEventListener('blur', cleanup);
  }

  _patchGizmosForUniversal() {
    const removeFrom = (group, predicate) => {
      group.children.filter(predicate).forEach(c => group.remove(c));
    };

    const isPlaneOrXYZ = c => ['XYZ','XY','YZ','XZ'].includes(c.name);
    const isShaft = c => c.geometry?.type === 'CylinderGeometry'
                      && c.geometry?.parameters?.radiusTop > 0;

    const tGizmo  = this._tcTranslate._gizmo.gizmo['translate'];
    const tPicker = this._tcTranslate._gizmo.picker['translate'];
    removeFrom(tGizmo,  isPlaneOrXYZ);
    removeFrom(tPicker, isPlaneOrXYZ);
    removeFrom(tGizmo,  isShaft);

    const sGizmo  = this._tcScale._gizmo.gizmo['scale'];
    const sPicker = this._tcScale._gizmo.picker['scale'];
    removeFrom(sGizmo,  c => c.geometry?.type === 'CylinderGeometry');
    removeFrom(sGizmo,  c => ['XY','YZ','XZ'].includes(c.name));
    removeFrom(sPicker, c => ['XY','YZ','XZ'].includes(c.name));

    const rGizmo  = this._tcRotate._gizmo.gizmo['rotate'];
    const rPicker = this._tcRotate._gizmo.picker['rotate'];
    removeFrom(rGizmo,  c => c.name === 'E' || c.name === 'XYZE');
    removeFrom(rPicker, c => c.name === 'E' || c.name === 'XYZE');
  }

  _setupUniversalIntercept(canvas) {
    if (!canvas || !this._tcRotate || !this._tcScale) return;
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const getNDC = (e) => {
      const rect = canvas.getBoundingClientRect();
      mouse.set(
        (e.clientX - rect.left) / rect.width  *  2 - 1,
       -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      return mouse;
    };

    const pickWinner = (ndcMouse) => {
      raycaster.setFromCamera(ndcMouse, this.engine.camera);
      if (raycaster.intersectObject(this._tcRotate._gizmo.picker['rotate'], true).length > 0)
        return 'rotate';
      if (raycaster.intersectObject(this._tcScale._gizmo.picker['scale'], true).length > 0)
        return 'scale';
      return 'translate';
    };

    const losersFor = (winner) => {
      if (winner === 'rotate')    return [this._tcTranslate, this._tcScale];
      if (winner === 'scale')     return [this._tcTranslate, this._tcRotate];
      return [this._tcRotate, this._tcScale];
    };

    canvas.addEventListener('pointermove', (e) => {
      if (this._mode !== 'universal') return;
      if (!this._tcRotate.object) return;
      if (this._isDragging) return;
      const ndc = getNDC(e).clone();
      queueMicrotask(() => {
        if (this._isDragging) return;
        const winner = pickWinner(ndc);
        const [a, b] = losersFor(winner);
        a.axis = null;
        b.axis = null;
      });
    });

    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (this._mode !== 'universal') return;
      if (!this._tcRotate.object) return;
      const winner = pickWinner(getNDC(e));
      if (winner === 'translate') return;
      const [a, b] = losersFor(winner);
      a.enabled = false;
      b.enabled = false;
      this._scaleInterceptPending = true;
      requestAnimationFrame(() => {
        if (this._scaleInterceptPending) {
          this._scaleInterceptPending = false;
          a.enabled = true;
          b.enabled = true;
        }
      });
    }, { capture: true });
  }

  _show() {
    for (const tc of this._tcs) {
      const helper = tc.getHelper();
      const visible = this._mode === 'universal'
        || (this._mode === 'translate' && tc.mode === 'translate')
        || (this._mode === 'rotate' && tc.mode === 'rotate')
        || (this._mode === 'scale' && tc.mode === 'scale');
      if (helper) helper.visible = visible;
      if (this._mode !== 'universal') {
        tc.enabled = visible;
      } else {
        tc.enabled = true;
      }
    }
  }

  _hide() {
    for (const tc of this._tcs) {
      const helper = tc.getHelper();
      if (helper) helper.visible = false;
      tc.enabled = false;
    }
  }

  _ensureProxyCenterHandle(proxy) {
    if (!proxy) return;
    let ch = proxy.getObjectByName('__physics_edit_center_handle__');
    if (!ch) {
      ch = new THREE.Mesh(
        new THREE.SphereGeometry(0.075, 12, 8),
        new THREE.MeshBasicMaterial({ color: 0xffffff, opacity: 0.9, transparent: true })
      );
      ch.name = '__physics_edit_center_handle__';
      ch.userData._isGizmo = true;
      ch.renderOrder = 999;
      ch.frustumCulled = false;
      ch.raycast = () => {};
      proxy.add(ch);
    }
    ch.visible = true;
  }

  _removeProxyCenterHandle(proxy) {
    if (!proxy) return;
    const ch = proxy.getObjectByName('__physics_edit_center_handle__');
    if (ch && ch.parent) ch.parent.remove(ch);
  }

  // ΓöÇΓöÇΓöÇ Event handlers ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

  _onVpReady() {
    const renderer = this.engine.rendererManager?.renderer;
    this._build(renderer);
  }

  _onRendererChanged(event) {
    this._build(event.detail?.renderer ?? this.engine.rendererManager?.renderer);
  }

  /** Rebuild TransformControls with the new editor camera so raycasting stays correct. */
  _onEditorCamChanged() {
    const renderer = this.engine.rendererManager?.renderer;
    if (renderer) this._build(renderer);
  }

  _onControlChange() {
    if (!this._physicsEdit) return;
    this._updatePhysicsComponentFromProxy();
  }

  _updatePhysicsComponentFromProxy() {
    const proxy = this._targetProxy ?? this.controls?.object;
    const comp = proxy?.userData?.physicsComponent;
    if (!comp) return;

    const pos = proxy.position;
    comp.position = comp.position || { x: 0, y: 0, z: 0 };
    comp.position.x = pos.x;
    comp.position.y = pos.y;
    comp.position.z = pos.z;
    comp.offset = comp.offset || { x: 0, y: 0, z: 0 };
    comp.offset.x = pos.x;
    comp.offset.y = pos.y;
    comp.offset.z = pos.z;

    const quat = proxy.quaternion;
    if (quat) {
      comp.rotation = comp.rotation || { x: 0, y: 0, z: 0, w: 1 };
      comp.rotation.x = quat.x;
      comp.rotation.y = quat.y;
      comp.rotation.z = quat.z;
      comp.rotation.w = quat.w;
    }

    const localScale = proxy.scale;
    const worldScale = new THREE.Vector3(localScale.x, localScale.y, localScale.z);
    if (proxy.parent) {
      const parentScale = new THREE.Vector3();
      proxy.parent.getWorldScale(parentScale);
      worldScale.multiply(parentScale);
    }

    switch (comp.type) {
      case 'Box Collider':
      case 'Box Trigger':
        comp.scale = comp.scale || { x: 0.5, y: 0.5, z: 0.5 };
        comp.scale.x = worldScale.x;
        comp.scale.y = worldScale.y;
        comp.scale.z = worldScale.z;
        comp.halfExtents = comp.halfExtents || { x: worldScale.x, y: worldScale.y, z: worldScale.z };
        comp.halfExtents.x = worldScale.x;
        comp.halfExtents.y = worldScale.y;
        comp.halfExtents.z = worldScale.z;
        break;
      case 'Sphere Collider':
      case 'Sphere Trigger': {
        const radius = (worldScale.x + worldScale.y + worldScale.z) / 3;
        comp.scale = { x: radius, y: radius, z: radius };
        comp.radius = radius;
        break;
      }
      case 'Capsule Collider':
      case 'Capsule Trigger': {
        const radius = (worldScale.x + worldScale.z) * 0.5;
        comp.scale = { x: radius, y: worldScale.y, z: radius };
        comp.radius = radius;
        comp.halfHeight = worldScale.y;
        break;
      }
      default:
        break;
    }

    window.dispatchEvent(new CustomEvent('cyco-physics-edit-update', {
      detail: { object: this._targetObject, component: comp }
    }));
    try {
      const worldPos = new THREE.Vector3();
      const worldQuat = new THREE.Quaternion();
      const worldScale = new THREE.Vector3();
      if (this._targetProxy) {
        this._targetProxy.getWorldPosition(worldPos);
        this._targetProxy.getWorldQuaternion(worldQuat);
        this._targetProxy.getWorldScale(worldScale);
      }
      try { if (typeof window !== 'undefined' && window.__cyco_log) window.__cyco_log('[TransformGizmo] physics-update', {
        mode: this._physicsEditMode,
        proxyWorldPos: worldPos,
        proxyWorldQuat: worldQuat,
        proxyWorldScale: worldScale,
        comp
      }); else console.log('[TransformGizmo] physics-update', { mode: this._physicsEditMode, proxyWorldPos: worldPos, proxyWorldQuat: worldQuat, proxyWorldScale: worldScale, comp }); } catch (err) {}
    } catch (err) {}
  }

  _onSelectNode(event) {
    const { object } = event.detail;
    if (!this.controls) return;

    if (object && !object.userData.cycoLocked) {
      this._targetObject = object;
      if (this._physicsEdit) {
        let proxy = object.userData?._physicsEditProxy;
        if (!proxy && this.engine?.scene) {
          proxy = this.engine.scene.getObjectByProperty('userData._ownerUuid', object.uuid) || null;
        }
        if (proxy) {
          this._targetProxy = proxy;
          this._safeAttach(proxy);
          this.controls.setMode(this._physicsEditMode);
          this._pendingPhysicsAttach = false;
          return;
        }
        this._pendingPhysicsAttach = true;
        this.controls.detach();
        return;
      }

      this._targetProxy = null;
      for (const tc of this._tcs) {
        try {
          tc.attach(object);
        } catch (err) {
          // ignore attach failures until the object is in the scene graph
        }
      }
      if (this._mode !== 'select') {
        this._show();
      } else {
        this._hide();
      }
    } else {
      this.detach();
    }
  }

  _onDeselectAll() {
    this.detach();
    this._hide();
  }

  _onTool(event) {
    const { mode } = event.detail;
    if (!['translate', 'rotate', 'scale', 'select', 'universal'].includes(mode)) return;
    try { if (typeof window !== 'undefined' && window.__cyco_log) window.__cyco_log('[TransformGizmo] tool change', { mode }); else console.log('[TransformGizmo] tool change', { mode }); } catch (err) {}
    if (this._physicsEdit) {
      if (mode === 'select') {
        return;
      }
      this._physicsEditMode = mode;
      const safeMode = mode === 'universal' ? 'translate' : mode;
      this.controls?.setMode(safeMode);
      return;
    }

    this._mode = mode;
    if (mode === 'select') {
      this._detachAllControls();
    } else {
      if (this._targetObject) {
        this._attachAllControls(this._targetObject);
      }
    }
    this._show();
  }

  _onPhysicsTool(event) {
    const { mode } = event.detail;
    if (!['translate', 'rotate', 'scale', 'universal'].includes(mode)) return;
    try { if (typeof window !== 'undefined' && window.__cyco_log) window.__cyco_log('[TransformGizmo] physics tool change', { mode }); else console.log('[TransformGizmo] physics tool change', { mode }); } catch (err) {}
    if (!this._physicsEdit) return;
    this._physicsEditMode = mode;
    const safeMode = mode === 'universal' ? 'translate' : mode;
    this.controls?.setMode(safeMode);
  }

  _onSnap(event) {
    this._snapEnabled = !!event.detail.enabled;
    this._snapValue   = event.detail.value ?? this._snapValue;
    this._applySnap();
  }

  _onWorld(event) {
    const isWorld = event.detail?.isWorld ?? event.detail ?? false;
    this._space = isWorld ? 'world' : 'local';
    for (const tc of this._tcs) {
      tc.setSpace(this._space);
    }
  }

  _onPhysicsEditMode(event) {
    const enabled = !!event.detail?.enabled;
    this._physicsEdit = enabled;
    if (!this.controls) return;
    if (enabled) {
      this.controls.enabled = true;
      if (this._targetObject) {
        let proxy = this._targetObject.userData?._physicsEditProxy;
        if (!proxy && this.engine?.scene) {
          proxy = this.engine.scene.getObjectByProperty('userData._ownerUuid', this._targetObject.uuid) || null;
        }
        if (proxy) {
          this._targetProxy = proxy;
          this._safeAttach(proxy);
          const safeMode = this._physicsEditMode === 'universal' ? 'translate' : this._physicsEditMode;
          this.controls.setMode(safeMode);
          this._pendingPhysicsAttach = false;
          this.controls.enabled = true;
          this.controls.setSpace(this._space);
          this.controls.showX = true; this.controls.showY = true; this.controls.showZ = true;
          this._ensureProxyCenterHandle(proxy);
          return;
        }
        this._pendingPhysicsAttach = true;
        this.controls.detach();
      }
    } else {
      this._pendingPhysicsAttach = false;
      // remove center handle from previous proxy
      if (this._targetProxy) this._removeProxyCenterHandle(this._targetProxy);
      this._targetProxy = null;
      if (this._mode === 'select') {
        this._detachAllControls();
      } else if (this._targetObject) {
        if (this._mode === 'universal') {
          this._attachAllControls(this._targetObject);
        } else {
          this.controls.attach(this._targetObject);
        }
      }
    }
  }

  _onGizmoSize(event) {
    const detail = event.detail ?? {};
    const size = detail.size ?? 1;
    const useSeparateSizes = !!detail.useSeparateSizes;
    const translateSize = detail.translateSize ?? size;
    const rotateSize = detail.rotateSize ?? size;
    const scaleSize = detail.scaleSize ?? size;

    for (const tc of this._tcs) {
      if (!tc) continue;
      if (useSeparateSizes) {
        if (tc === this._tcTranslate) tc.size = translateSize;
        else if (tc === this._tcRotate) tc.size = rotateSize;
        else if (tc === this._tcScale) tc.size = scaleSize;
      } else {
        tc.size = size;
      }
    }
  }

  _onPhysicsProxyReady(event) {
    const { object, proxy } = event.detail ?? {};
    if (!object || !proxy) return;
    // If the proxy belongs to the current target object, attach it regardless of pending state.
    if (object === this._targetObject) {
      this._targetProxy = proxy;
      this._safeAttach(proxy);
      this.controls.setMode(this._physicsEditMode);
      this._pendingPhysicsAttach = false;
      this.controls.enabled = true;
      this.controls.setSpace(this._space);
      this.controls.showX = true; this.controls.showY = true; this.controls.showZ = true;
      this._ensureProxyCenterHandle(proxy);
      return;
    }
    // Otherwise, ignore if not relevant to current selection
  }

  _onPhysicsFocus(event) {
    const { object } = event.detail ?? {};
    if (!object) return;
    this._targetObject = object;
    if (!this.controls) return;
    if (!this._physicsEdit) return;
    // attempt to attach to proxy immediately
    let proxy = object.userData?._physicsEditProxy;
    if (!proxy && this.engine?.scene) {
      proxy = this.engine.scene.getObjectByProperty('userData._ownerUuid', object.uuid) || null;
    }
    if (proxy) {
      this._targetProxy = proxy;
      this._safeAttach(proxy);
      this.controls.setMode(this._physicsEditMode);
      this.controls.enabled = true;
      this.controls.setSpace(this._space);
      this.controls.showX = true; this.controls.showY = true; this.controls.showZ = true;
      this._ensureProxyCenterHandle(proxy);
      this._pendingPhysicsAttach = false;
    } else {
      this._pendingPhysicsAttach = true;
      this.controls.detach();
    }
  }

  _onVpTick(event) {
    if ((!this.controls && !this._tcs.length) || !this.engine.camera) return;
    const cam = this._getControlsCamera(this.engine.camera);
    if (cam) {
      for (const tc of this._tcs) {
        try { tc.camera = cam; } catch (err) {}
      }
    }
    if (this._physicsEdit && this._targetProxy) {
      try {
        if (this.controls.object !== this._targetProxy) {
          this._safeAttach(this._targetProxy);
        }
      } catch (err) {}
    }
  }

  // ΓöÇΓöÇΓöÇ Helpers ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

  _applySnap() {
    for (const tc of this._tcs) {
      tc.translationSnap = this._snapEnabled ? this._snapValue          : null;
      tc.rotationSnap    = this._snapEnabled ? (Math.PI / 12)           : null; // 15°
      tc.scaleSnap       = this._snapEnabled ? (this._snapValue * 0.1)  : null;
    }
  }

  _ensureUniversalGizmoVisuals() {
    if (!this._helper) return;
    // Avoid recreating visuals if already present
    if (this._helper.getObjectByName('__universal_gizmo__')) return;

    const group = new THREE.Group();
    group.name = '__universal_gizmo__';
    group.userData._isGizmo = true;

    const size = 0.9;
    const arrowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, opacity: 0.9, transparent: true, depthTest: false });
    const ringMat  = new THREE.MeshBasicMaterial({ color: 0xffffff, opacity: 0.85, transparent: true, depthTest: false, side: THREE.DoubleSide });
    const boxMat   = new THREE.MeshBasicMaterial({ color: 0xffffff, opacity: 0.95, transparent: true, depthTest: false });

    // X axis arrow (red)
    const coneX = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.18, 8), arrowMat.clone());
    coneX.rotation.z = -Math.PI / 2;
    coneX.position.x = size;
    coneX.material.color.set(0xff4444);
    coneX.name = '__gizmo_arrow_x__'; coneX.userData._isGizmo = true; group.add(coneX);

    // Y axis arrow (green)
    const coneY = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.18, 8), arrowMat.clone());
    coneY.position.y = size;
    coneY.material.color.set(0x44ff44);
    coneY.name = '__gizmo_arrow_y__'; coneY.userData._isGizmo = true; group.add(coneY);

    // Z axis arrow (blue)
    const coneZ = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.18, 8), arrowMat.clone());
    coneZ.rotation.x = Math.PI / 2;
    coneZ.position.z = size;
    coneZ.material.color.set(0x4444ff);
    coneZ.name = '__gizmo_arrow_z__'; coneZ.userData._isGizmo = true; group.add(coneZ);

    // Axis end scale boxes
    const boxGeo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
    const boxX = new THREE.Mesh(boxGeo, boxMat.clone()); boxX.position.x = size * 0.6; boxX.material.color.set(0xff4444); boxX.name='__gizmo_box_x__'; boxX.userData._isGizmo = true; group.add(boxX);
    const boxY = new THREE.Mesh(boxGeo, boxMat.clone()); boxY.position.y = size * 0.6; boxY.material.color.set(0x44ff44); boxY.name='__gizmo_box_y__'; boxY.userData._isGizmo = true; group.add(boxY);
    const boxZ = new THREE.Mesh(boxGeo, boxMat.clone()); boxZ.position.z = size * 0.6; boxZ.material.color.set(0x4444ff); boxZ.name='__gizmo_box_z__'; boxZ.userData._isGizmo = true; group.add(boxZ);

    // Rotation rings
    const torusX = new THREE.Mesh(new THREE.TorusGeometry(size, 0.02, 8, 64), ringMat.clone()); torusX.rotation.y = Math.PI / 2; torusX.material.color.set(0xff4444); torusX.name='__gizmo_ring_x__'; torusX.userData._isGizmo = true; group.add(torusX);
    const torusY = new THREE.Mesh(new THREE.TorusGeometry(size, 0.02, 8, 64), ringMat.clone()); torusY.rotation.x = Math.PI / 2; torusY.material.color.set(0x44ff44); torusY.name='__gizmo_ring_y__'; torusY.userData._isGizmo = true; group.add(torusY);
    const torusZ = new THREE.Mesh(new THREE.TorusGeometry(size, 0.02, 8, 64), ringMat.clone()); torusZ.material.color.set(0x4444ff); torusZ.name='__gizmo_ring_z__'; torusZ.userData._isGizmo = true; group.add(torusZ);

    // Make visuals non-pickable / non-serialized
    group.traverse((c) => { c.renderOrder = 1000; c.frustumCulled = false; if (c.material && c.material.dispose) c.userData._isGizmo = true; });

    // Make these visuals non-interactive so TransformControls handles remain authoritative
    group.traverse((c) => {
      c.renderOrder = 1000;
      c.frustumCulled = false;
      c.userData._isGizmo = true;
      c.raycast = () => {};
    });

    this._helper.add(group);
  }

  _updateGizmoVisualScale() {
    if (!this._helper) return;
    const group = this._helper.getObjectByName('__universal_gizmo__');
    if (!group) return;

    // Determine a scale factor so the gizmo appears roughly constant size on screen
    const camera = this.engine.camera;
    const target = this.controls?.object || this._targetObject;
    if (!camera || !target) return;

    // Compute world position of gizmo
    const worldPos = new THREE.Vector3();
    target.getWorldPosition(worldPos);
    const distance = camera.position.distanceTo(worldPos);

    // base size scaled by distance and camera fov (perspective) or zoom (ortho)
    let sizeFactor = 1.0;
    if (camera.isPerspectiveCamera) {
      sizeFactor = distance * 0.08;
    } else {
      sizeFactor = 0.08 / Math.max(camera.zoom, 1e-6);
    }

    // Use a uniform scale so visuals remain readable and don't shrink with parent scale
    const uniform = Math.max(sizeFactor, 1e-6);
    group.scale.set(uniform, uniform, uniform);
  }

  _safeAttach(target) {
    if (!this.controls || !target) return;
    try {
      // Ensure target is part of the scene graph before attaching
      if (!target.parent) {
        const scene = this.engine?.scene;
        if (scene) {
          // try to find owner by ownerUuid
          const ownerUuid = target.userData?._ownerUuid;
          const owner = ownerUuid ? scene.getObjectByProperty('uuid', ownerUuid) : null;
          if (owner) owner.add(target);
          else scene.add(target);
        }
      }
      this.controls.attach(target);
      const helper = this.controls.getHelper();
      if (helper && helper.parent === null) this.engine.scene?.add(helper);
      try {
        // Log attach debug info: world pos and screen pos
        const wp = new THREE.Vector3(); target.getWorldPosition(wp);
        let screen = null;
        try {
          const cam = this.engine?.camera;
          const dom = this.engine?.rendererManager?.renderer?.domElement;
          if (cam && dom) {
            const p = wp.clone().project(cam);
            const r = dom.getBoundingClientRect();
            screen = { x: r.left + (p.x * 0.5 + 0.5) * r.width, y: r.top + (-p.y * 0.5 + 0.5) * r.height };
          }
        } catch (e) {}
        try { if (typeof window !== 'undefined' && window.__cyco_log) window.__cyco_log('[TransformGizmo] _safeAttach', { target: target.name || target.uuid, inScene: !!target.parent, worldPos: wp, screenPos: screen }); else console.log('[TransformGizmo] _safeAttach', { target: target.name || target.uuid, inScene: !!target.parent, worldPos: wp, screenPos: screen }); } catch (err) {}
      } catch (err) {}
    } catch (err) {
      console.warn('TransformGizmo._safeAttach failed', err);
    }
  }

  _setGizmoActive(active) {
    if (!this._helper) return;
    const group = this._helper.getObjectByName('__universal_gizmo__');
    if (!group) return;
    group.scale.multiplyScalar(active ? 1.15 : 1.0);
    group.traverse((c) => {
      if (c.material) {
        c.material.opacity = active ? Math.min((c.material.opacity ?? 1) * 1.15, 1) : (c.material.opacity ?? 1) / 1.15;
        c.material.needsUpdate = true;
      }
    });
  }

  detach() {
    this._targetObject = null;
    this._targetProxy = null;
    if (this._tcs.length) {
      for (const tc of this._tcs) {
        try {
          tc.detach();
        } catch (err) {}
      }
    } else {
      this.controls?.detach();
    }
  }

  /** Called by GameRuntime.play() ΓÇö hides gizmo during play mode. */
  suspend() {
    this._detachAllControls();
    this._hide();
  }
  /** Called by GameRuntime.stop() ΓÇö restores gizmo after play mode. */
  restore()  {
    if (this._targetObject) {
      if (this._mode === 'universal') {
        this._attachAllControls(this._targetObject);
      } else {
        this.controls?.attach(this._targetObject);
      }
      if (this._mode !== 'select') {
        this._show();
      }
    }
  }

  // ΓöÇΓöÇΓöÇ Disposal ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

  dispose() {
    window.removeEventListener('cyco-vp-ready',              this._onVpReady);
    window.removeEventListener('cyco-renderer-changed',      this._onRendererChanged);
    window.removeEventListener('cyco-editor-camera-changed', this._onEditorCamChanged);
    window.removeEventListener('cyco-vp-tick',               this._onVpTick);
    window.removeEventListener('cyco-select-node',           this._onSelectNode);
    window.removeEventListener('cyco-deselect-all',          this._onDeselectAll);
    window.removeEventListener('cyco-vp-tool',               this._onTool);
    window.removeEventListener('cyco-physics-vp-tool',       this._onPhysicsTool);
    window.removeEventListener('cyco-physics-edit-proxy-ready', this._onPhysicsProxyReady);
    window.removeEventListener('cyco-rvp-snap',              this._onSnap);
    window.removeEventListener('cyco-rvp-world',             this._onWorld);
    window.removeEventListener('cyco-vp-world',              this._onWorld);
    window.removeEventListener('cyco-gizmo-size',            this._onGizmoSize);
    window.removeEventListener('cyco-physics-edit-mode',     this._onPhysicsEditMode);
    if (this._tcs.length) {
      for (const tc of this._tcs) {
        try {
          const helper = tc.getHelper();
          if (helper && helper.parent) helper.parent.remove(helper);
          tc.dispose();
        } catch (err) {}
      }
      this._tcs = [];
    } else if (this.controls) {
      this.engine.scene?.remove(this.controls.getHelper());
      this.controls.dispose();
    }
  }
}
