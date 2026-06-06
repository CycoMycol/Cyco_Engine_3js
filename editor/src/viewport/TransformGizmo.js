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
    window.addEventListener('cyco-physics-edit-focus', this._onPhysicsFocus?.bind(this));
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
      // Visual feedback: scale up universal gizmo while dragging
      try {
        this._setGizmoActive(!!event.value);
      } catch (err) {}
    });

    this.controls.addEventListener('change', () => {
      if (!this._physicsEdit) return;
      // During collider edit, update the component live so the collider moves
      // with the gizmo. We avoid rebuilding proxies here to prevent detaching
      // the active target; overlays are children of the proxy so they follow.
      try {
        this._updatePhysicsComponentFromProxy();
      } catch (err) {
        // swallow errors to avoid breaking the control loop
        console.warn('Error updating physics component during drag', err);
      }
      try { if (typeof window !== 'undefined' && window.__cyco_log) window.__cyco_log('[TransformGizmo] change', { axis: this.controls.axis }); else console.log('[TransformGizmo] change', { axis: this.controls.axis }); } catch (err) {}
    });

    // Record matrix before drag for undo
    this.controls.addEventListener('mouseDown', () => {
      const target = this.controls?.object ?? this._targetObject;
      if (target) {
        this._matrixBefore = target.matrix.clone();
      }
      // Debug: log which axis/handle is engaged (helps diagnose locked axes)
      try {
        try { if (typeof window !== 'undefined' && window.__cyco_log) window.__cyco_log('[TransformGizmo] mouseDown', { axis: this.controls.axis, mode: this._physicsEdit ? this._physicsEditMode : this._mode, object: this.controls.object?.name ?? this._targetObject?.name }); else console.log('[TransformGizmo] mouseDown', { axis: this.controls.axis, mode: this._physicsEdit ? this._physicsEditMode : this._mode, object: this.controls.object?.name ?? this._targetObject?.name }); } catch (err) {}
      } catch (err) {}
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

    // Ensure that after a physics edit drag ends, the controls remain attached to the proxy
    this.controls.addEventListener('mouseUp', () => {
      if (!this._physicsEdit) return;
      try {
        if (this._targetProxy && this.controls.object !== this._targetProxy) {
          this.controls.attach(this._targetProxy);
          this._ensureProxyCenterHandle(this._targetProxy);
        }
      } catch (err) {}
    });

    // Make gizmo non-selectable (tag all descendants + add to nonSelectableSet)
    this._helper = this.controls.getHelper();
    this._helper.traverse(child => { child.userData._isGizmo = true; });

    // Add a visible central gizmo marker so physics edit looks like a universal manipulator.
    // NOTE: center handle is created per-proxy when entering physics edit mode
    // so it follows the collider proxy exactly. See _ensureProxyCenterHandle().

    // Ensure universal gizmo visuals (arrows, rings, scale handles) are present.
    this._ensureUniversalGizmoVisuals();

    this.selectionManager.addNonSelectable(this._helper);
    scene.add(this._helper);
    if (!this._helper.parent) {
      scene.add(this._helper);
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
        // Try direct proxy reference first
        let proxy = object.userData?._physicsEditProxy;
        // If missing, try to find a proxy in the scene tagged with ownerUuid
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
        // No proxy available yet; mark pending and detach controls so gizmo won't attach to object
        this._pendingPhysicsAttach = true;
        this.controls.detach();
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
    try { if (typeof window !== 'undefined' && window.__cyco_log) window.__cyco_log('[TransformGizmo] tool change', { mode }); else console.log('[TransformGizmo] tool change', { mode }); } catch (err) {}
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
    try { if (typeof window !== 'undefined' && window.__cyco_log) window.__cyco_log('[TransformGizmo] physics tool change', { mode }); else console.log('[TransformGizmo] physics tool change', { mode }); } catch (err) {}
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
        let proxy = this._targetObject.userData?._physicsEditProxy;
        if (!proxy && this.engine?.scene) {
          proxy = this.engine.scene.getObjectByProperty('userData._ownerUuid', this._targetObject.uuid) || null;
        }
        if (proxy) {
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
        this._pendingPhysicsAttach = true;
        this.controls.detach();
      }
    } else {
      this._pendingPhysicsAttach = false;
      // remove center handle from previous proxy
      if (this._targetProxy) this._removeProxyCenterHandle(this._targetProxy);
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
    if (!this.controls || !this.engine.camera) return;
    const cam = this._getControlsCamera(this.engine.camera);
    if (cam) {
      // Keep TransformControls using a camera that matches the editor camera
      try { this.controls.camera = cam; } catch (err) {}
    }
    // While in physics edit mode, ensure controls remain attached to proxy so
    // rotate/scale gizmo visuals follow the collider proxy instead of the object.
    if (this._physicsEdit && this._targetProxy) {
      try {
        if (this.controls.object !== this._targetProxy) {
          this._safeAttach(this._targetProxy);
        }
      } catch (err) {}
    }
    // Keep universal visuals at a constant screen size and avoid pointer hit tests
    this._updateGizmoVisualScale();
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  _applySnap() {
    if (!this.controls) return;
    this.controls.translationSnap = this._snapEnabled ? this._snapValue          : null;
    this.controls.rotationSnap    = this._snapEnabled ? (Math.PI / 12)           : null; // 15°
    this.controls.scaleSnap       = this._snapEnabled ? (this._snapValue * 0.1)  : null;
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
