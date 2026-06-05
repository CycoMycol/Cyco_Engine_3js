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
 *   cyco-vp-ready           { scene, camera }      — set up controls after viewport ready
 *   cyco-renderer-changed   { renderer }           — rebuild on renderer swap
 *   cyco-select-node        { object }             — attach gizmo to selection
 *   cyco-deselect-all       {}                     — detach gizmo
 *   cyco-vp-tool            { mode }               — 'translate' | 'rotate' | 'scale'
 *   cyco-physics-vp-tool    { mode }               — physics edit translate/rotate/scale (collider gizmo only)
 *   cyco-rvp-snap           { enabled, value }     — snap toggle + value
 *   cyco-rvp-world          { isWorld }            — world / local space toggle
 *   cyco-gizmo-size         { size }               — from Preferences
 */

import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

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
    /** Separate camera copy used for TransformControls raycasting/rendering. */
    this._controlsCamera = null;

    this._snapEnabled = false;
    this._snapValue   = 0.25;
    this._mode        = 'select'; // default: pointer/select, no gizmo shown
    this._physicsEdit = false;
    this._physicsEditMode = 'translate';
    this._pendingPhysicsAttach = false;

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
    window.addEventListener('cyco-rvp-snap',          this._onSnap);
    window.addEventListener('cyco-rvp-world',         this._onWorld);
    window.addEventListener('cyco-vp-world',          this._onWorld);
    window.addEventListener('cyco-gizmo-size',        this._onGizmoSize);
    window.addEventListener('cyco-physics-edit-mode', this._onPhysicsEditMode);
  }

  // ─── Build ────────────────────────────────────────────────────────────────

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

    if (this.controls) {
      scene.remove(this.controls.getHelper());
      this.controls.dispose();
    }

    const controlCamera = this._getControlsCamera(camera);
    if (!controlCamera) return;

    this.controls = new TransformControls(controlCamera, renderer.domElement);
    // TransformControls only accepts translate/rotate/scale; use translate as the
    // internal default when in select mode (gizmo won't be shown anyway).
    this.controls.setMode(this._mode !== 'select' ? this._mode : 'translate');
    this.controls.setSpace(this._space);
    this._applySnap();

    // CRITICAL — prevents camera orbiting while dragging the gizmo.
    // Also flags SelectionManager so it ignores the pointer-up that ends the drag.
    this.controls.addEventListener('dragging-changed', event => {
      const orbitControls = this.engine.controls;
      if (orbitControls) orbitControls.enabled = !event.value;
      this.selectionManager._gizmoDragging = !!event.value;
    });

    this.controls.addEventListener('change', () => {
      if (!this._physicsEdit) return;
      // During collider edit, defer component sync until the drag completes.
      // Rebuilding proxies while dragging breaks the active TransformControls target.
    });

    // Record matrix before drag for undo
    this.controls.addEventListener('mouseDown', () => {
      const target = this.controls?.object ?? this._targetObject;
      if (target) {
        this._matrixBefore = target.matrix.clone();
      }
    });

    // Commit TransformCommand after drag completes
    this.controls.addEventListener('mouseUp', () => {
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

    // Make gizmo non-selectable (tag all descendants + add to nonSelectableSet)
    this._helper = this.controls.getHelper();
    this._helper.traverse(child => { child.userData._isGizmo = true; });

    // Add a visible central gizmo marker so physics edit looks like a universal manipulator.
    if (!this._helper.getObjectByName('__physics_edit_center_handle__')) {
      const centerHandle = new THREE.Mesh(
        new THREE.SphereGeometry(0.075, 12, 8),
        new THREE.MeshBasicMaterial({ color: 0xffffff, opacity: 0.8, transparent: true })
      );
      centerHandle.name = '__physics_edit_center_handle__';
      centerHandle.userData._isGizmo = true;
      centerHandle.renderOrder = 999;
      this._helper.add(centerHandle);
    }

    this.selectionManager.addNonSelectable(this._helper);
    scene.add(this._helper);
    if (!this._helper.parent) {
      scene.add(this._helper);
    }
  }

  // ─── Event handlers ───────────────────────────────────────────────────────

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
  }

  _onSelectNode(event) {
    const { object } = event.detail;
    if (!this.controls) return;

    if (object && !object.userData.cycoLocked) {
      this._targetObject = object;
      if (this._physicsEdit) {
        const proxy = object.userData?._physicsEditProxy;
        if (proxy) {
          this._targetProxy = proxy;
          this.controls.attach(proxy);
          this.controls.setMode(this._physicsEditMode);
          this._pendingPhysicsAttach = false;
          return;
        }
        this._pendingPhysicsAttach = true;
        this.detach();
        return;
      }

      this._targetProxy = null;
      if (this._mode !== 'select') {
        this.controls.attach(object);
      }
    } else {
      this.detach();
    }
  }

  _onDeselectAll() { this.detach(); }

  _onTool(event) {
    const { mode } = event.detail;
    if (!['translate', 'rotate', 'scale', 'select'].includes(mode)) return;
    if (this._physicsEdit) {
      if (mode === 'select') {
        return;
      }
      this._physicsEditMode = mode;
      this.controls?.setMode(mode);
      return;
    }

    this._mode = mode;
    if (mode === 'select') {
      // Hide the visual gizmo but keep _targetObject so re-enabling a transform
      // mode can re-attach without needing a new selection event.
      this.controls?.detach();
    } else {
      this.controls?.setMode(mode);
      // If an object is already selected, re-show the gizmo for it.
      if (this._targetObject) {
        this._targetProxy = null;
        this.controls.attach(this._targetObject);
      }
    }
  }

  _onPhysicsTool(event) {
    const { mode } = event.detail;
    if (!['translate', 'rotate', 'scale'].includes(mode)) return;
    if (!this._physicsEdit) return;
    this._physicsEditMode = mode;
    this.controls?.setMode(mode);
  }

  _onSnap(event) {
    this._snapEnabled = !!event.detail.enabled;
    this._snapValue   = event.detail.value ?? this._snapValue;
    this._applySnap();
  }

  _onWorld(event) {
    const isWorld = event.detail?.isWorld ?? event.detail ?? false;
    this._space = isWorld ? 'world' : 'local';
    this.controls?.setSpace(this._space);
  }

  _onPhysicsEditMode(event) {
    const enabled = !!event.detail?.enabled;
    this._physicsEdit = enabled;
    if (!this.controls) return;
    if (enabled) {
      this.controls.enabled = true;
      if (this._targetObject) {
        const proxy = this._targetObject.userData?._physicsEditProxy;
        if (proxy) {
          this._targetProxy = proxy;
          this.controls.attach(proxy);
          this.controls.setMode(this._physicsEditMode);
          this._pendingPhysicsAttach = false;
          return;
        }
        this._pendingPhysicsAttach = true;
        this.controls.detach();
      }
    } else {
      this._pendingPhysicsAttach = false;
      this._targetProxy = null;
      if (this._mode === 'select') {
        this.controls.detach();
      } else if (this._targetObject) {
        this.controls.attach(this._targetObject);
      }
    }
  }

  _onGizmoSize(event) {
    if (this.controls) this.controls.size = event.detail.size ?? 1;
  }

  _onPhysicsProxyReady(event) {
    if (!this._physicsEdit || !this._pendingPhysicsAttach) return;
    const { object, proxy } = event.detail ?? {};
    if (!object || !proxy || object !== this._targetObject) return;
    this._targetProxy = proxy;
    this.controls.attach(proxy);
    this.controls.setMode(this._physicsEditMode);
    this._pendingPhysicsAttach = false;
  }

  _onVpTick(event) {
    if (!this.controls || !this.engine.camera) return;
    this._getControlsCamera(this.engine.camera);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  _applySnap() {
    if (!this.controls) return;
    this.controls.translationSnap = this._snapEnabled ? this._snapValue          : null;
    this.controls.rotationSnap    = this._snapEnabled ? (Math.PI / 12)           : null; // 15°
    this.controls.scaleSnap       = this._snapEnabled ? (this._snapValue * 0.1)  : null;
  }

  detach() {
    this._targetObject = null;
    this.controls?.detach();
  }

  /** Called by GameRuntime.play() — hides gizmo during play mode. */
  suspend() { this.detach(); if (this._helper) this._helper.visible = false; }
  /** Called by GameRuntime.stop() — restores gizmo after play mode. */
  restore()  {
    if (this._helper) this._helper.visible = true;
    if (this.controls && this._mode !== 'select' && this._targetObject) {
      this.controls.attach(this._targetObject);
    }
  }

  // ─── Disposal ─────────────────────────────────────────────────────────────

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
    if (this.controls) {
      this.engine.scene?.remove(this.controls);
      this.controls.dispose();
    }
  }
}
