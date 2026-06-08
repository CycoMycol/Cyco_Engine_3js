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
    /** Cached controls camera — only rebuilt when the editor camera changes. */
    this._controlsCameraDirty = true;
    /** Whether the current TC set was built with universal-mode patches applied. */
    this._builtForUniversal = false;
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
    this._pendingGizmoSize   = null;
    this._lastGizmoSize      = null;
    this._lastMouseNDC       = { x: 0, y: 0, valid: false };
    this._universalPickWinner = null;
    this._universalLoses     = null;

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
    window.addEventListener('cyco-vp-world',          this._onWorld);
    window.addEventListener('cyco-gizmo-size',        this._onGizmoSize);
    window.addEventListener('cyco-physics-edit-mode', this._onPhysicsEditMode);
  }

  // ΓöÇΓöÇΓöÇ Build ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

  _getControlsCamera(camera) {
    if (!camera) return null;

    if (!this._controlsCamera || this._controlsCamera.type !== camera.type) {
      this._controlsCamera = camera.clone();
      this._controlsCameraDirty = true;
    }

    // Only sync when the camera has actually moved (dirty flag from editor-cam-changed)
    const proxy = this._controlsCamera;
    if (!this._controlsCameraDirty) {
      // Still update position/quaternion each frame for orbit controls — these change continuously
      proxy.position.copy(camera.position);
      proxy.quaternion.copy(camera.quaternion);
      proxy.rotation.copy(camera.rotation);
      proxy.updateMatrixWorld();
      return proxy;
    }
    this._controlsCameraDirty = false;

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

    if (this._lastGizmoSize) {
      this._onGizmoSize({ detail: this._lastGizmoSize });
    } else if (this._pendingGizmoSize) {
      this._onGizmoSize({ detail: this._pendingGizmoSize });
    }
    this._pendingGizmoSize = null;

    this._applySnap();

    for (const tc of this._tcs) {
      tc.setColors(0xff2222, 0x00dd44, 0x2255ff, 0xffee00);
      const helper = tc.getHelper();
      helper.traverse(child => { child.userData._isGizmo = true; });
      this.selectionManager.addNonSelectable(helper);
      scene.add(helper);
    }

    // Only strip handles when actually building for universal mode —
    // for individual translate/rotate/scale modes the handles must stay intact.
    this._builtForUniversal = (this._mode === 'universal');
    if (this._builtForUniversal) {
      this._patchGizmosForUniversal();
    }
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
      this._isDragging = true;
      this._scaleInterceptPending = false;
      // In universal mode the intercept already picked a winner and
      // disabled the losers — don't re-disable here or it fights.
      if (this._mode !== 'universal') {
        for (const other of this._tcs) {
          if (other !== tc) other.enabled = false;
        }
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

    const tGizmo  = this._tcTranslate._gizmo.gizmo['translate'];
    const tPicker = this._tcTranslate._gizmo.picker['translate'];
    removeFrom(tGizmo,  isPlaneOrXYZ);
    // Remove planes AND XYZ from picker — scale's XYZ is the center handle
    removeFrom(tPicker, c => ['XY','YZ','XZ','XYZ'].includes(c.name));

    const sGizmo  = this._tcScale._gizmo.gizmo['scale'];
    const sPicker = this._tcScale._gizmo.picker['scale'];
    removeFrom(sGizmo,  c => c.geometry?.type === 'CylinderGeometry');
    removeFrom(sGizmo,  c => ['XY','YZ','XZ'].includes(c.name));
    removeFrom(sPicker, c => ['XY','YZ','XZ'].includes(c.name));

    const rGizmo  = this._tcRotate._gizmo.gizmo['rotate'];
    const rPicker = this._tcRotate._gizmo.picker['rotate'];
    removeFrom(rGizmo,  c => c.name === 'E' || c.name === 'XYZE');
    removeFrom(rPicker, c => c.name === 'E' || c.name === 'XYZE');

    // ── Reposition scale picker cones further out to avoid overlap ──────
    // Translate picker cones are at ±0.3 on each axis. Move scale cones
    // to ±0.45 so the two sets don't conflict during raycasting.
    this._repositionPickerCones(sPicker, 0.5);

    // ── Enlarge picker hit areas for universal mode ──────────────────────
    // Tag all picker children so TransformControls.updateMatrixWorld
    // knows not to hide them when an axis faces the camera.
    this._tagPickers();

    this._enlargePickers();
  }

  /** Move the X/Y/Z axis-cone pickers to a further-out offset so they don't
   *  overlap with the translate picker cones at the default 0.3 offset. */
  _repositionPickerCones(pickerGroup, offset) {
    if (!pickerGroup) return;
    for (const child of pickerGroup.children) {
      if (child.name === 'X' || child.name === 'Y' || child.name === 'Z') {
        // The original cones were baked at 0.3 offset along their axis.
        // Compute the geometry centroid and translate further to 'offset'.
        child.geometry.computeBoundingBox();
        const bb = child.geometry.boundingBox;
        const cx = (bb.max.x + bb.min.x) / 2;
        const cy = (bb.max.y + bb.min.y) / 2;
        const cz = (bb.max.z + bb.min.z) / 2;
        const ax = Math.abs(cx), ay = Math.abs(cy), az = Math.abs(cz);
        const push = offset - 0.3;
        let dx = 0, dy = 0, dz = 0;
        if (ax > ay && ax > az) dx = cx > 0 ? push : -push;
        else if (ay > ax && ay > az) dy = cy > 0 ? push : -push;
        else dz = cz > 0 ? push : -push;
        child.geometry.translate(dx, dy, dz);
        child.geometry.computeBoundingSphere();
        child.geometry.computeBoundingBox();
      }
    }
  }

  /** Tag all picker children so TransformControls never hides them. */
  _tagPickers() {
    const tag = (tc, mode) => {
      const group = tc._gizmo?.picker?.[mode];
      if (!group) return;
      for (const child of group.children) child._isPicker = true;
    };
    tag(this._tcTranslate, 'translate');
    tag(this._tcRotate,    'rotate');
    tag(this._tcScale,     'scale');
  }

  /** Replace axis-cone pickers with elongated boxes that are equally
   *  clickable from ANY camera angle, even when the axis points at the camera. */
  _enlargePickers() {
    // Use the module-level THREE import (window.THREE is not set in ES-module context)
    const scaleAroundCenter = (geom, s) => {
      geom.computeBoundingBox();
      const c = new THREE.Vector3();
      geom.boundingBox.getCenter(c);
      const m = new THREE.Matrix4()
        .makeTranslation(-c.x, -c.y, -c.z)
        .multiply(new THREE.Matrix4().makeScale(s, s, s))
        .multiply(new THREE.Matrix4().makeTranslation(c.x, c.y, c.z));
      geom.applyMatrix4(m);
      geom.computeBoundingSphere();
      geom.computeBoundingBox();
    };

    // Replace the tiny cone pickers with elongated boxes.  The original
    // CylinderGeometry cones are only 0.2 units wide and hard to hit
    // when viewed end-on.  New boxes are 1.2 units long and 0.25 wide.
    const _replacePickerGeos = (tc, mode) => {
      const pickerGroup = tc._gizmo?.picker?.[mode];
      if (!pickerGroup) return;
      for (const child of pickerGroup.children) {
        if (child.name === 'X' || child.name === 'Y' || child.name === 'Z') {
          // Elongate the existing baked geometry along its longest axis
          // so the hit area is thick enough from any angle.
          scaleAroundCenter(child.geometry, 1.8);
        }
        if (child.name === 'XYZ') {
          scaleAroundCenter(child.geometry, 3.0);
        }
      }
    };

    _replacePickerGeos(this._tcTranslate, 'translate');
    _replacePickerGeos(this._tcScale,     'scale');
    _enlargeRotatePickers(this._tcRotate);
  }

  /** Enlarge rotate picker torus tubes so they're easier to hover. */
  _enlargeRotatePickers = (tc) => {
    const pickerGroup = tc._gizmo?.picker?.['rotate'];
    if (!pickerGroup) return;
    for (const child of pickerGroup.children) {
      if (child.name === 'X' || child.name === 'Y' || child.name === 'Z') {
        // Bake a thicker torus into the child's baked geometry.
        // The original torus has tube=0.1 which is very thin; scale up.
        const scaleAroundCenter = (geom, s) => {
          geom.computeBoundingBox();
          const c = new THREE.Vector3();
          geom.boundingBox.getCenter(c);
          const m = new THREE.Matrix4()
            .makeTranslation(-c.x, -c.y, -c.z)
            .multiply(new THREE.Matrix4().makeScale(s, s, s))
            .multiply(new THREE.Matrix4().makeTranslation(c.x, c.y, c.z));
          geom.applyMatrix4(m);
          geom.computeBoundingSphere();
        };
        scaleAroundCenter(child.geometry, 2.0);
      }
      if (child.name === 'XYZE') {
        scaleAroundCenter(child.geometry, 1.5);
      }
    }
  };

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

    // Pick the SPECIFIC handle (not just type) that is closest to the
    // cursor across ALL three TC pickers.  Return { type, axisName } so
    // we can clear only non-matching axes.
    this._universalPickWinner = (ndcMouse) => {
      const cam = this._tcTranslate?.camera || this.engine.camera;
      raycaster.setFromCamera(ndcMouse, cam);

      const hits = [];
      const add = (type, group) => {
        const arr = raycaster.intersectObject(group, true);
        if (arr.length > 0) hits.push({ type, axis: arr[0].object.name, dist: arr[0].distance });
      };
      add('translate', this._tcTranslate._gizmo.picker['translate']);
      add('rotate',    this._tcRotate._gizmo.picker['rotate']);
      add('scale',     this._tcScale._gizmo.picker['scale']);

      if (hits.length === 0) return null;

      // Special case: when scale hits XYZ (center cube), it should always
      // win over translate/rotate that pass through the same point, because
      // the center cube is the user's intended target for uniform scaling.
      const scaleXYZ = hits.find(h => h.type === 'scale' && h.axis === 'XYZ');
      if (scaleXYZ) return scaleXYZ;

      hits.sort((a, b) => a.dist - b.dist);
      return hits[0]; // { type, axis, dist }
    };

    this._universalLoses = (winner) => {
      // winner is { type, axis, dist } — extract the type string
      const type = typeof winner === 'string' ? winner : winner.type;
      if (type === 'rotate')    return [this._tcTranslate, this._tcScale];
      if (type === 'scale')     return [this._tcTranslate, this._tcRotate];
      return [this._tcRotate, this._tcScale];
    };

    /** Decide which TC owns the hover highlight in universal mode.
     *  Picks the closest handle across all three TCs, clears the losers'
     *  axes, and explictly sets the winner's axis so the highlight renders. */
    this._arbitrateUniversalHover = () => {
      if (!this._lastMouseNDC?.valid) return;
      const winner = this._universalPickWinner(this._lastMouseNDC);
      if (!winner) {
        // No hit — clear ALL axes so nothing highlights
        for (const tc of this._tcs) tc.axis = null;
        return;
      }
      const losers = this._universalLoses(winner);
      losers[0].axis = null;
      losers[1].axis = null;

      // CRITICAL: Set the winner's axis explicitly, because the winner TC's
      // pointerHover may have missed the picker hit (e.g. thin rotate torus
      // at a grazing angle, or its pointermove event fired before ours).
      let tc;
      if (winner.type === 'translate') tc = this._tcTranslate;
      else if (winner.type === 'rotate') tc = this._tcRotate;
      else if (winner.type === 'scale') tc = this._tcScale;
      if (tc) tc.axis = winner.axis;
    };

    // Store last mouse NDC so _onVpTick can arbitrate.
    this._lastMouseNDC = { x: 0, y: 0, valid: false };

    canvas.addEventListener('pointermove', (e) => {
      if (this._mode !== 'universal') return;
      if (this._isDragging) return;
      const rect = canvas.getBoundingClientRect();
      this._lastMouseNDC.x =  (e.clientX - rect.left) / rect.width  *  2 - 1;
      this._lastMouseNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      this._lastMouseNDC.valid = true;

      // Run arbitration immediately on pointermove so highlights update
      // at the source rather than relying on the next frame's tick.
      this._arbitrateUniversalHover();
    });

    // pointerdown in capture phase: pick the winner and disable losers
    // BEFORE the native TC pointerdown handlers fire.
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (this._mode !== 'universal') return;
      if (!this._tcRotate.object) return;
      const winner = this._universalPickWinner(this._lastMouseNDC);
      if (!winner) return;
      const losers = this._universalLoses(winner);
      losers[0].enabled = false;
      losers[1].enabled = false;
      this._scaleInterceptPending = true;
      this._universalWinnerType = winner.type;
    }, { capture: true });

    const _reEnable = () => {
      if (this._scaleInterceptPending) {
        this._scaleInterceptPending = false;
        for (const tc of this._tcs) tc.enabled = true;
      }
    };
    canvas.addEventListener('pointerup', _reEnable);
    canvas.addEventListener('pointercancel', _reEnable);
  }

  _show() {
    const isUniversal = this._mode === 'universal';
    for (const tc of this._tcs) {
      const helper = tc.getHelper();
      const visible = isUniversal
        || (this._mode === 'translate' && tc.mode === 'translate')
        || (this._mode === 'rotate' && tc.mode === 'rotate')
        || (this._mode === 'scale' && tc.mode === 'scale');
      if (helper) helper.visible = visible;
      // In universal mode keep ALL axes visible from every angle and
      // let the tick handler decide which one is highlighted.
      tc._gizmo.hideAlignedToCamera = isUniversal ? false : true;
      tc.enabled = isUniversal || visible;
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
    this._controlsCameraDirty = true;
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

    const wasUniversal = this._builtForUniversal;
    const isUniversal  = (mode === 'universal');
    this._mode = mode;

    // _patchGizmosForUniversal() permanently removes handles from the TC groups.
    // We must rebuild the whole TC set whenever the universal ↔ individual state
    // changes so the handle sets are always correct for the active mode.
    if (wasUniversal !== isUniversal) {
      const renderer = this.engine.rendererManager?.renderer;
      if (renderer) {
        this._build(renderer); // _build() honours _mode and calls _show()/_hide()
        return;
      }
    }

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
    // RightViewportPanel sends: { detail: boolean } (just the enabled flag)
    // Or the full format: { detail: { enabled, value } }
    const d = event.detail;
    if (typeof d === 'boolean') {
      this._snapEnabled = d;
    } else if (d && typeof d === 'object') {
      this._snapEnabled = !!d.enabled;
      this._snapValue   = d.value ?? this._snapValue;
    }
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
    this._lastGizmoSize = detail;
    if (!this._tcs.length) {
      this._pendingGizmoSize = detail;
      return;
    }

    const size = Number(detail.size ?? 1) || 1;
    const useSeparateSizes = !!detail.useSeparateSizes;
    const translateSize = Number(detail.translateSize ?? size) || size;
    const rotateSize = Number(detail.rotateSize ?? size) || size;
    const scaleSize = Number(detail.scaleSize ?? size) || size;
    const distance = Number(detail.distance ?? 1) || 1;
    const translateDistance = Number(detail.translateDistance ?? distance) || distance;
    const rotateDistance = Number(detail.rotateDistance ?? distance) || distance;
    const scaleDistance = Number(detail.scaleDistance ?? distance) || distance;

    // In "One Size For All" mode, the global slider scales each individual
    // proportionally, preserving the ratios set in Separate mode.
    // Each TC gets its own individual values — no mode check needed here.

    for (const tc of this._tcs) {
      if (!tc) continue;

      if (tc === this._tcTranslate) {
        tc.setSize(translateSize);
        tc.distance = translateDistance;
      } else if (tc === this._tcRotate) {
        tc.setSize(rotateSize);
        tc.distance = rotateDistance;
      } else if (tc === this._tcScale) {
        tc.setSize(scaleSize);
        tc.distance = scaleDistance;
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

    // Sync each TC's camera every frame.
    // Each TC owns a private camera clone (_camProxy) that is mutated in place.
    // The first assignment triggers the defineProperty setter which propagates
    // the reference to the internal plane/gizmo.  Subsequent frames update the
    // clone's position/matrixWorld in place — the plane and gizmo already hold
    // the same reference so they always read the current state without needing
    // the setter to fire again.
    // Keeping separate clones (one per TC) avoids any ordering / shared-state
    // edge cases that arose when all three TCs shared a single proxy object.
    const srcCam = this.engine.camera;
    for (const tc of this._tcs) {
      try {
        if (!tc._camProxy || tc._camProxy.type !== srcCam.type) {
          // New proxy needed (first run, or camera type changed) — assignment
          // will trigger the defineProperty setter and wire up gizmo + plane.
          tc._camProxy = srcCam.clone();
          tc.camera = tc._camProxy;
        }
        // Mutate in place so the plane/gizmo (which already hold the reference)
        // always see the latest camera state.
        const p = tc._camProxy;
        p.position.copy(srcCam.position);
        p.quaternion.copy(srcCam.quaternion);
        p.near = srcCam.near;
        p.far  = srcCam.far;
        if (srcCam.isPerspectiveCamera) {
          p.fov    = srcCam.fov;
          p.aspect = srcCam.aspect;
        } else if (srcCam.isOrthographicCamera) {
          p.left = srcCam.left; p.right = srcCam.right;
          p.top  = srcCam.top;  p.bottom = srcCam.bottom;
        }
        p.zoom = srcCam.zoom;
        p.projectionMatrix.copy(srcCam.projectionMatrix);
        p.matrixWorld.copy(srcCam.matrixWorld);
        p.matrixWorldInverse.copy(srcCam.matrixWorldInverse);
        p.updateMatrixWorld();
      } catch (err) {}
    }

    // Universal-mode hover arbitration — runs every frame AFTER all TC
    // handlers have updated their axes.  Uses the same logic as the
    // pointermove handler to keep highlights consistent frame-to-frame.
    if (this._mode === 'universal' && !this._isDragging && this._arbitrateUniversalHover) {
      this._arbitrateUniversalHover();
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

  /** Pulse the active gizmo axis handles on drag start/end. */
  _setGizmoActive(active) {
    // The gizmo helper is managed by TransformControls internally.
    // We scale the attached TC's helper group to give visual feedback.
    const helper = this.controls?.getHelper?.();
    if (!helper) return;
    const s = active ? 1.08 : 1.0;
    helper.scale.set(s, s, s);
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
