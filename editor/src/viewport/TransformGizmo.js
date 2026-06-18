import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { loadPrefs, DEFAULT_PREFS } from '../ui/PreferencesWindow.js';
export class TransformGizmo {
  constructor(viewportEngine, selectionManager) {
    this.engine           = viewportEngine;
    this.selectionManager = selectionManager;

    this._mode         = 'select';
    this._space        = 'world';
    this._targetObject = null;
    this._isDragging   = false;
    this._matrixBefore = null;
    this._prefs        = loadPrefs();

    this._tc      = null;
    this._gizmo   = null;
    this._controls = null;

    // Multi-selection state. When the selection contains 2+ objects, the gizmo
    // attaches to a hidden `_multiGroup` Object3D positioned at the centroid
    // of the selection, and every selected object follows the same delta.
    // `_multiMode` is the pivot strategy:
    //   'group'    → all selected objects move as one; pivot = group centroid
    //   'individual' → gizmo attaches to a virtual "primary"; each object is
    //                  transformed relative to its own pivot while keeping the
    //                  group centroid fixed.
    this._multiGroup    = null;
    this._multiTargets  = [];   // Array<Object3D> the gizmo is currently driving
    this._multiMode     = 'group';
    this._multiCentroid = new THREE.Vector3();
    this._multiPivots   = [];   // original world positions when transform began
    this._multiRots     = [];   // original world quaternions
    this._multiScales   = [];   // original world scales

    this._boxGroup      = null;
    this._boxHandles    = [];
    this._boxVolume     = null;
    this._boxOutline    = null;
    this._boxGlow       = null;
    this._boxActive     = false;
    this._hoveredHandle = null;
    this._interaction   = null;
    this._physicsEdit   = false;
    this._physicsOwner  = null;
    this._physicsProxy  = null;
    this._physicsTemporaryOutline = false;

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
    this._onPrefsChanged     = this._onPrefsChanged.bind(this);
    this._onPhysicsEditMode  = this._onPhysicsEditMode.bind(this);
    this._onPhysicsProxyReady = this._onPhysicsProxyReady.bind(this);
    this._onPhysicsEditFocus = this._onPhysicsEditFocus.bind(this);
    this._onPhysicsTool      = this._onPhysicsTool.bind(this);
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
    window.addEventListener('cyco-preferences-change',    this._onPrefsChanged);
    window.addEventListener('cyco-preferences-preview',   this._onPrefsChanged);
    window.addEventListener('cyco-physics-edit-mode',     this._onPhysicsEditMode);
    window.addEventListener('cyco-physics-edit-proxy-ready', this._onPhysicsProxyReady);
    window.addEventListener('cyco-physics-edit-focus',    this._onPhysicsEditFocus);
    window.addEventListener('cyco-physics-vp-tool',       this._onPhysicsTool);
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
      if (event.value) {
        window.dispatchEvent(new CustomEvent('cyco-hover-object', { detail: { object: null } }));
      }
    });

    tc.addEventListener('change', () => {
      if (this._boxActive && this._targetObject) {
        this._updateBoxGizmo();
      }
      // Live-update multi-targets as the gizmo drags
      if (this._multiTargets.length >= 2 && this._matrixBefore) {
        this._applyMultiFromCurrentGroup();
      }
    });

    tc.addEventListener('mouseDown', () => {
      this._isDragging = true;
      const orbit = this.engine.controls;
      if (orbit) orbit.enabled = false;
      if (this._targetObject) this._matrixBefore = this._targetObject.matrix.clone();
      // Capture the per-target world transforms for multi-select transform undo
      this._captureMultiPivots();
      window.dispatchEvent(new CustomEvent('cyco-hover-object', { detail: { object: null } }));
    });

    tc.addEventListener('mouseUp', () => {
      this._isDragging = false;
      const orbit = this.engine.controls;
      if (orbit) orbit.enabled = true;
      if (this._targetObject && this._matrixBefore) {
        const before = this._matrixBefore;
        const after  = this._targetObject.matrix.clone();
        const obj    = this._targetObject;
        // If we're driving a multi-select, apply the group delta to every target
        if (this._multiTargets.length >= 2) {
          const targets = this._multiTargets.slice();
          const pivots  = this._multiPivots.slice();
          const rots    = this._multiRots.slice();
          const scales  = this._multiScales.slice();
          const beforeMatrices = pivots.map(p => p.clone());
          // Re-apply pivot positions to undo current (post-drag) world changes
          this._applyMultiMatricesFromGroupDelta(before, after);
          const afterMatrices = this._multiTargets.map(o => o.matrix.clone());
          window.dispatchEvent(new CustomEvent('cyco-command-execute', {
            detail: {
              name: `Transform ${targets.length} objects`,
              do() {
                for (let i = 0; i < targets.length; i++) {
                  targets[i].matrix.copy(afterMatrices[i]);
                  targets[i].matrix.decompose(targets[i].position, targets[i].quaternion, targets[i].scale);
                }
              },
              undo() {
                for (let i = 0; i < targets.length; i++) {
                  targets[i].matrix.copy(beforeMatrices[i]);
                  targets[i].matrix.decompose(targets[i].position, targets[i].quaternion, targets[i].scale);
                }
              },
            }
          }));
          // Refresh the centroid so the gizmo follows the new center
          this._recomputeMultiCentroid();
        } else {
          window.dispatchEvent(new CustomEvent('cyco-command-execute', {
            detail: {
              name: `Transform ${obj.name}`,
              do()   { obj.matrix.copy(after); obj.matrix.decompose(obj.position, obj.quaternion, obj.scale); },
              undo() { obj.matrix.copy(before); obj.matrix.decompose(obj.position, obj.quaternion, obj.scale); },
            }
          }));
        }
      }
      if (this._boxActive && this._targetObject) {
        this._updateBoxGizmo();
      }
      this._matrixBefore = null;
    });

    this._tc = tc;
    this._controls = tc;
    const gizmo = tc.getHelper();
    gizmo.traverse((child) => {
      child.userData._isGizmo = true;
      if (child.material) {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of materials) {
          material.transparent = false;
          material.opacity = 1;
          material.depthTest = false;
          material.depthWrite = false;
          material.needsUpdate = true;
        }
      }
    });
    gizmo.userData._isGizmo = true;
    scene.add(gizmo);
    this._gizmo = gizmo;

    this._buildBoxGizmo();
    this._applyMode();
    if (this._targetObject) this._attachTo(this._targetObject);
    this._applyPreferences();
  }

  _onPrefsChanged(event) {
    this._prefs = event.detail?.prefs ?? loadPrefs();
    this._applyPreferences();
  }

  _getTransformPrefs(mode) {
    const gizmo = this._prefs?.gizmo ?? loadPrefs().gizmo;
    const shared = !gizmo.useSeparateGizmoSizes;
    const key = mode === 'translate' ? 'translate' : mode;
    return {
      size: shared ? gizmo.size : (gizmo[`${key}Size`] ?? gizmo.size),
      distance: shared ? gizmo.distance : (gizmo[`${key}Distance`] ?? gizmo.distance),
      x: shared ? gizmo.axisColorX : (gizmo[`${key}AxisColorX`] ?? gizmo.axisColorX),
      y: shared ? gizmo.axisColorY : (gizmo[`${key}AxisColorY`] ?? gizmo.axisColorY),
      z: shared ? gizmo.axisColorZ : (gizmo[`${key}AxisColorZ`] ?? gizmo.axisColorZ),
      active: shared
        ? (gizmo.activeColor || '#ffd54a')
        : (gizmo[`${key}ActiveColor`] ?? (gizmo.activeColor || '#ffd54a')),
    };
  }

  _applyPreferences() {
    const gizmo = this._prefs?.gizmo ?? loadPrefs().gizmo;
    if (this._tc && this._mode !== 'select' && this._mode !== 'universal') {
      const mode = this._mode;
      const p = this._getTransformPrefs(mode);
      this._tc.setSize(p.size ?? 1);
      this._tc.setDistance(p.distance ?? 1);
      this._tc.setColors(p.x ?? '#ff4444', p.y ?? '#44ff44', p.z ?? '#4444ff', p.active ?? '#ffd54a');
      if (this._gizmo) {
        this._gizmo.visible = true;
      }
    }
    if (this._boxGroup) {
      this._updateBoxPalette();
      if (this._boxActive && this._targetObject) this._updateBoxGizmo();
    }
  }

  _getBoxPrefs() {
    const gizmo = this._prefs?.gizmo ?? loadPrefs().gizmo ?? {};
    // Always deep-merge against DEFAULT_PREFS so the box section is
    // guaranteed to exist even when the user's prefs file is missing
    // sections (legacy migration safety net).
    const defaults = (typeof DEFAULT_PREFS !== 'undefined' && DEFAULT_PREFS?.gizmo) ? DEFAULT_PREFS.gizmo : {};
    return this._physicsEdit
      ? (gizmo.colliderBox ?? defaults.colliderBox ?? gizmo.box ?? defaults.box ?? {})
      : (gizmo.box ?? defaults.box ?? {});
  }

  _getBoundsPrefs() {
    const gizmo = this._prefs?.gizmo ?? loadPrefs().gizmo ?? {};
    const defaults = (typeof DEFAULT_PREFS !== 'undefined' && DEFAULT_PREFS?.gizmo) ? DEFAULT_PREFS.gizmo : {};
    if (!this._physicsEdit) return gizmo.bounds ?? defaults.bounds ?? {};
    if (this._physicsProxy) return gizmo.colliderBounds ?? defaults.colliderBounds ?? gizmo.bounds ?? defaults.bounds ?? {};
    if (this._physicsTemporaryOutline) return gizmo.temporaryBounds ?? defaults.temporaryBounds ?? gizmo.colliderBounds ?? defaults.colliderBounds ?? gizmo.bounds ?? defaults.bounds ?? {};
    return gizmo.colliderBounds ?? defaults.colliderBounds ?? gizmo.bounds ?? defaults.bounds ?? {};
  }

  /**
   * Pick the outline-color prefs section that matches the current
   * selection state so the Box Gizmo wireframe/glow matches the
   * selection outline (single → singleSelect; ≥2 → firstSelected).
   *
   * Falls back to the legacy shared `bounds.*` section when the new
   * sections are absent (older prefs files).
   */
  _getSelectionOutlinePrefs() {
    const gizmo = this._prefs?.gizmo ?? loadPrefs().gizmo ?? {};
    const defaults = (typeof DEFAULT_PREFS !== 'undefined' && DEFAULT_PREFS?.gizmo) ? DEFAULT_PREFS.gizmo : {};
    const selMgr = this.engine?.selectionManager;
    const selectedCount = selMgr?.selected?.size ?? 0;
    const isMulti = selectedCount > 1;
    if (isMulti) {
      return {
        outlineColor:  gizmo.firstSelected?.outlineColor  ?? defaults.firstSelected?.outlineColor  ?? gizmo.bounds?.outlineColor ?? defaults.bounds?.outlineColor ?? '#e8eeff',
        glowColor:     gizmo.firstSelected?.glowColor     ?? defaults.firstSelected?.glowColor     ?? gizmo.bounds?.glowColor     ?? defaults.bounds?.glowColor     ?? '#9b6cff',
        glowIntensity: gizmo.firstSelected?.glowIntensity ?? defaults.firstSelected?.glowIntensity ?? gizmo.bounds?.glowIntensity ?? defaults.bounds?.glowIntensity ?? 0.35,
      };
    }
    return {
      outlineColor:  gizmo.singleSelect?.outlineColor  ?? defaults.singleSelect?.outlineColor  ?? gizmo.bounds?.outlineColor ?? defaults.bounds?.outlineColor ?? '#e8eeff',
      glowColor:     gizmo.singleSelect?.glowColor     ?? defaults.singleSelect?.glowColor     ?? gizmo.bounds?.glowColor     ?? defaults.bounds?.glowColor     ?? '#9b6cff',
      glowIntensity: gizmo.singleSelect?.glowIntensity ?? defaults.singleSelect?.glowIntensity ?? gizmo.bounds?.glowIntensity ?? defaults.bounds?.glowIntensity ?? 0.35,
    };
  }

  _setBoxModeVisibility(mode = 'full') {
    if (!this._boxGroup) return;
    const showHandles = mode === 'full';
    if (this._boxOutline) this._boxOutline.visible = true;
    if (this._boxGlow) this._boxGlow.visible = true;
    if (this._boxVolume) this._boxVolume.visible = showHandles;
    for (const handle of this._boxHandles) {
      handle.visible = showHandles;
    }
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
    this._physicsTemporaryOutline = false;

    if (this._boxGroup) {
      this._boxGroup.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
      if (this._boxGroup.parent) this._boxGroup.parent.remove(this._boxGroup);
      this._boxGroup = null;
      this._boxHandles = [];
      this._boxVolume = null;
      this._boxOutline = null;
      this._boxGlow = null;
      this._hoveredHandle = null;
      this._interaction = null;
    }
  }

  _applyMode() {
    if (this._physicsEdit) {
      if (this._tc) {
        this._tc.detach();
        this._tc.enabled = false;
      }
      if (this._gizmo) this._gizmo.visible = false;
      if (this._targetObject) {
        this._showBox();
        this._setBoxModeVisibility(this._physicsProxy ? 'full' : 'outline');
      } else {
        this._hideBox();
      }
      return;
    }

    const hasTarget = !!this._targetObject;
    if (this._mode === 'universal' || this._mode === 'select') {
      if (this._tc) {
        this._tc.detach();
        this._tc.enabled = false;
      }
      if (this._gizmo) this._gizmo.visible = false;
      if (hasTarget) {
        this._showBox();
        this._setBoxModeVisibility(this._mode === 'select' ? 'outline' : 'full');
      } else {
        this._hideBox();
      }
      return;
    }

    if (!this._tc) return;
    if (hasTarget) {
      this._tc.setMode(this._mode);
      this._gizmo.visible = true;
      this._tc.enabled = true;
      // Always re-attach to whichever object is currently driving the gizmo
      // (the virtual group for multi-select, or the single target otherwise)
      try { this._tc.attach(this._targetObject); } catch (_) {}
      this._showBox();
      this._setBoxModeVisibility('outline');
    } else {
      this._tc.detach();
      this._gizmo.visible = false;
      this._tc.enabled = false;
      this._hideBox();
    }
  }

  _attachTo(obj) {
    if (this._physicsEdit) {
      this._physicsOwner = obj ?? null;
      this._physicsProxy = obj?.userData?._physicsEditProxy ?? null;
      this._physicsTemporaryOutline = !this._physicsProxy && !!obj;
      this._targetObject = this._physicsProxy || obj || null;
      this._applyMode();
      return;
    }
    // If we're in multi-select mode, single-attach is a no-op — the multi
    // group is the target. Caller should use _attachToMulti() if it really
    // wants to switch the selection.
    if (this._multiTargets.length >= 2 && obj) return;
    this._targetObject = obj;
    if (this._mode === 'universal' || this._mode === 'select') {
      if (obj) {
        this._showBox();
        this._updateBoxGizmo();
      } else {
        this._hideBox();
      }
      this._applyMode();
      return;
    }
    if (this._tc) {
      if (obj) {
        this._tc.attach(obj);
      } else {
        this._tc.detach();
      }
    }
    this._applyMode();
  }

  _detachAll() {
    if (this._physicsEdit) return;
    this._targetObject = null;
    this._multiTargets = [];
    if (this._tc) this._tc.detach();
    this._hideBox();
  }

  detach() { this._detachAll(); }

  _updateBoxPalette() {
    const boxPrefs = this._getBoxPrefs();
    const boundsPrefs = this._getBoundsPrefs();
    // The Box Gizmo's wireframe + glow should match the SELECTION outline
    // color (singleSelect for 1 object, firstSelected for ≥2).  The
    // glow intensity also follows the selection outline so the visual
    // weight stays consistent.  This avoids the "orange/purple ghost
    // outline" caused by the legacy `bounds.outlineColor`/`bounds.glowColor`
    // fields being picked up when they shouldn't be.
    const selOutlinePrefs = this._getSelectionOutlinePrefs();
    if (window.CYCO_DEBUG_OUTLINE) {
      console.log('[CYCO:OUTLINE-PIPE] _updateBoxPalette', {
        boundsPrefs: { ...boundsPrefs },
        selOutlinePrefs: { ...selOutlinePrefs },
      });
    }
    if (this._boxOutline?.material) {
      this._boxOutline.material.color.set(selOutlinePrefs.outlineColor);
      this._boxOutline.material.opacity = Math.min(1, 0.55 + (boundsPrefs.thickness ?? 1) * 0.08);
    }
    if (this._boxGlow?.material) {
      this._boxGlow.material.color.set(selOutlinePrefs.glowColor);
      this._boxGlow.material.opacity = Math.max(0, Math.min(0.65, selOutlinePrefs.glowIntensity * 0.28));
    }
    for (const handle of this._boxHandles) {
      const role = handle.userData.handleRole;
      const axis = handle.userData.handleAxis;
      if (role === 'scaleAxis' || role === 'rotate') {
        const c = axis === 'X' ? boxPrefs.axisColorX : axis === 'Y' ? boxPrefs.axisColorY : boxPrefs.axisColorZ;
        handle.userData.baseColor = c;
        handle.userData.hoverColor = 0xffff00;
      } else if (role === 'scaleUniform') {
        handle.userData.baseColor = boxPrefs.cornerColor || '#e8eeff';
        handle.userData.hoverColor = 0xffff00;
      }
      if (handle.material && handle.userData.baseColor) handle.material.color.set(handle.userData.baseColor);
      if (handle.children) {
        handle.children.forEach((child) => {
          if (child.material && handle.userData.baseColor) child.material.color.set(handle.userData.baseColor);
        });
      }
    }
  }

  _createBoxEdgeLayer(name, material, renderOrder, { pickable = false } = {}) {
    const group = new THREE.Group();
    group.name = name;
    group.material = material;
    group.renderOrder = renderOrder;
    group.userData = { _isGizmo: true };
    if (pickable) group.userData.handleRole = 'translate';

    const corners = [
      [-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5],
      [-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [0.5, 0.5, 0.5],
    ];
    const edgePairs = [
      [0, 1], [0, 2], [0, 4], [1, 3], [1, 5], [2, 3], [2, 6], [3, 7], [4, 5], [4, 6], [5, 7], [6, 7],
    ];

    for (const [aIndex, bIndex] of edgePairs) {
      const a = new THREE.Vector3().fromArray(corners[aIndex]);
      const b = new THREE.Vector3().fromArray(corners[bIndex]);
      const midpoint = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
      const direction = new THREE.Vector3().subVectors(b, a).normalize();
      const edge = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 10), material);
      edge.userData = {
        _isGizmo: true,
        localPosition: midpoint,
        handleDir: direction,
      };
      if (pickable) edge.userData.handleRole = 'translate';
      edge.renderOrder = renderOrder;
      edge.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
      group.add(edge);
    }

    return group;
  }

  _updateBoxEdgeLayer(layer, center, size, radius, opacity = null) {
    if (!layer) return;
    layer.position.copy(center);
    if (layer.material && opacity !== null) layer.material.opacity = opacity;
    for (const edge of layer.children) {
      const midpoint = edge.userData.localPosition;
      const direction = edge.userData.handleDir;
      if (!midpoint || !direction) continue;
      const axisSize = Math.abs(direction.x) > 0.9 ? size.x : Math.abs(direction.y) > 0.9 ? size.y : size.z;
      edge.position.copy(midpoint).multiply(size);
      edge.scale.set(radius, Math.max(0.001, axisSize), radius);
    }
  }

  _getWorldUnitsPerPixel(point, camera, renderer) {
    const height = Math.max(1, renderer?.domElement?.clientHeight ?? 1);
    if (camera?.isPerspectiveCamera) {
      const distance = camera.position.distanceTo(point);
      return 2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) / height;
    }
    if (camera?.isOrthographicCamera) {
      return Math.abs(camera.top - camera.bottom) / (height * Math.max(0.0001, camera.zoom ?? 1));
    }
    return 0.01;
  }

  _buildBoxGizmo() {
    if (this._boxGroup) return;
    const scene = this.engine.scene;
    if (!scene) return;
    const boxPrefs = this._getBoxPrefs();
    const boundsPrefs = this._getBoundsPrefs();

    this._boxGroup = new THREE.Group();
    this._boxGroup.name = '__cyco_box_gizmo__';
    this._boxGroup.userData._isGizmo = true;
    this._boxGroup.visible = false;
    scene.add(this._boxGroup);

    const outlineMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(boundsPrefs.outlineColor ?? boxPrefs.outlineColor ?? '#e8eeff'),
      transparent: true,
      opacity: 0.85,
      depthTest: true,
      depthWrite: true,
    });
    const outline = this._createBoxEdgeLayer('BoxGizmoOutline', outlineMaterial, 1000, { pickable: true });
    this._boxGroup.add(outline);
    this._boxOutline = outline;

    const glowMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(boundsPrefs.glowColor ?? boxPrefs.glowColor ?? '#9b6cff'),
      transparent: true,
      opacity: 0.18,
      depthTest: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const glow = this._createBoxEdgeLayer('BoxGizmoGlow', glowMaterial, 999);
    glow.visible = true;
    this._boxGroup.add(glow);
    this._boxGlow = glow;

    const volumeMaterial = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.0,
      depthTest: true,
      depthWrite: false,
    });
    const volume = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), volumeMaterial);
    volume.name = 'BoxGizmoVolume';
    volume.userData = { _isGizmo: true, handleRole: 'translate' };
    volume.renderOrder = 1001;
    volume.visible = true;
    this._boxGroup.add(volume);
    this._boxVolume = volume;

    const faceShaftGeometry = new THREE.CylinderGeometry(1, 1, 1, 16);
    const faceTipGeometry = new THREE.SphereGeometry(1, 16, 12);
    const edgeGeometry = new THREE.CylinderGeometry(0.3, 0.3, 1, 16);
    // Corner scale handles read better as spheres than cubes on the box gizmo.
    const cornerGeometry = new THREE.SphereGeometry(1, 16, 12);

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
      const faceGroup = new THREE.Group();
      const faceMaterial = new THREE.MeshBasicMaterial({
        color: config.axis === 'X'
          ? (boxPrefs.axisColorX ?? config.color)
          : config.axis === 'Y'
            ? (boxPrefs.axisColorY ?? config.color)
            : (boxPrefs.axisColorZ ?? config.color),
        depthTest: true,
        depthWrite: true,
      });
      const shaft = new THREE.Mesh(faceShaftGeometry, faceMaterial);
      const tip = new THREE.Mesh(faceTipGeometry, faceMaterial);
      shaft.name = 'AxisShaft';
      tip.name = 'AxisTip';
      shaft.position.y = 0.5;
      tip.position.y = 1.0;
      faceGroup.add(shaft, tip);
      faceGroup.name = `BoxGizmoFace${index}`;
      faceGroup.userData = {
        _isGizmo: true,
        handleRole: 'scaleAxis',
        handleAxis: config.axis,
        handleDir: new THREE.Vector3(...config.dir),
        baseColor: config.axis === 'X'
          ? (boxPrefs.axisColorX ?? config.color)
          : config.axis === 'Y'
            ? (boxPrefs.axisColorY ?? config.color)
            : (boxPrefs.axisColorZ ?? config.color),
        hoverColor: 0xffff00,
      };
      faceGroup.renderOrder = 1001;
      faceGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...config.dir));
      this._boxGroup.add(faceGroup);
      this._boxHandles.push(faceGroup);
    });

    edgePairs.forEach((pair, index) => {
      const a = new THREE.Vector3().fromArray(corners[pair[0]]);
      const b = new THREE.Vector3().fromArray(corners[pair[1]]);
      const midpoint = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
      const direction = new THREE.Vector3().subVectors(b, a).normalize();
      const axis = Math.abs(direction.x) > 0.9 ? 'X' : Math.abs(direction.y) > 0.9 ? 'Y' : 'Z';
      const color = axis === 'X' ? 0xff3b30 : axis === 'Y' ? 0x34c759 : 0x0a84ff;
      const material = new THREE.MeshBasicMaterial({
        color: axis === 'X'
          ? (boxPrefs.axisColorX ?? color)
          : axis === 'Y'
            ? (boxPrefs.axisColorY ?? color)
            : (boxPrefs.axisColorZ ?? color),
        depthTest: true,
        depthWrite: true,
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
        color: new THREE.Color(boxPrefs.cornerColor || '#e8eeff'),
        depthTest: true,
        depthWrite: true,
      });
      const corner = new THREE.Mesh(cornerGeometry, material);
      corner.name = `BoxGizmoCorner${index}`;
      corner.userData = {
        _isGizmo: true,
        handleRole: 'scaleUniform',
        handleAxis: 'XYZ',
        handleDir: new THREE.Vector3().fromArray(position).multiplyScalar(2),
        baseColor: boxPrefs.cornerColor || '#e8eeff',
        hoverColor: 0xffff00,
      };
      corner.renderOrder = 1001;
      corner.position.fromArray(position);
      this._boxGroup.add(corner);
      this._boxHandles.push(corner);
    });
  }

  _showBox() {
    if (!this._targetObject) {
      this._hideBox();
      return;
    }
    if (!this._boxGroup) this._buildBoxGizmo();
    if (this._boxGroup) {
      this._boxGroup.visible = true;
      this._boxActive = true;
      this._setBoxModeVisibility(this._mode === 'select' ? 'outline' : 'full');
      this._updateBoxGizmo();
    }
  }

  _hideBox() {
    if (this._boxGroup) {
      this._boxGroup.traverse((child) => {
        if (child.geometry) {
          child.geometry.dispose();
          child.geometry = null;
        }
        if (child.material) {
          child.material.dispose();
          child.material = null;
        }
      });
      if (this._boxGroup.parent) {
        this._boxGroup.parent.remove(this._boxGroup);
      }
      this._boxGroup = null;
      this._boxHandles = [];
      this._boxVolume = null;
      this._boxOutline = null;
      this._boxGlow = null;
      this._clearHoveredHandle();
    }
    this._boxActive = false;
  }

  _updateBoxGizmo() {
    if (!this._boxActive || !this._targetObject || !this._boxGroup) return;

    const target = this._targetObject;
    if (typeof target.updateWorldMatrix === 'function') {
      target.updateWorldMatrix(true, true);
    } else if (typeof target.updateMatrixWorld === 'function') {
      target.updateMatrixWorld(true);
    }
    const outline = this._boxGroup.getObjectByName('BoxGizmoOutline');
    if (!outline) return;
    const boxPrefs = this._getBoxPrefs();
    const boundsPrefs = this._getBoundsPrefs();

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

    if (!isMesh || size.x < 0.001 || size.y < 0.001 || size.z < 0.001) {
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
    const renderer = this.engine.rendererManager?.renderer;
    const camera = this.engine.camera;
    const baseSize = Math.min(size.x, size.y, size.z);
    const outlineDistance = Math.max(0.05, boundsPrefs.distance ?? 1);
    const outlineSize = size.clone().multiplyScalar(outlineDistance);
    const worldPerPixel = renderer && camera
      ? this._getWorldUnitsPerPixel(this._boxGroup.position, camera, renderer)
      : Math.max(baseSize, 1) * 0.002;
    const outlineThickness = Math.max(0.05, boundsPrefs.thickness ?? 1);
    const outlineRadius = Math.max(worldPerPixel * 0.75, Math.max(baseSize, 1) * 0.002) * outlineThickness;
    const glowIntensity = Math.max(0, boundsPrefs.glowIntensity ?? 0.35);
    const glowRadius = outlineRadius * (2.5 + glowIntensity * 2.5);
    const glowOpacity = Math.min(0.65, glowIntensity * 0.28);

    this._updateBoxEdgeLayer(this._boxOutline, center, outlineSize, outlineRadius);
    this._updateBoxEdgeLayer(this._boxGlow, center, outlineSize.clone().multiplyScalar(1.012), glowRadius, glowOpacity);

    if (this._boxVolume) {
      this._boxVolume.scale.copy(size);
      this._boxVolume.position.copy(center);
    }

    const defaultFaceRadius = baseSize * 0.11;
    const minWorldFaceRadius = Math.max(0.12, defaultFaceRadius * 0.75);
    const maxWorldFaceRadius = Math.max(defaultFaceRadius, 0.35);
    const screenFaceRadius = renderer && camera
      ? 2 * camera.position.distanceTo(this._boxGroup.position) * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) * 40 / renderer.domElement.clientHeight
      : minWorldFaceRadius;
    const faceRadius = Math.min(maxWorldFaceRadius, Math.max(minWorldFaceRadius, screenFaceRadius));
    const handleThickness = Math.max(0.05, boxPrefs.thickness ?? 1);
    const handleDistance = Math.max(0.05, boxPrefs.distance ?? 1);
    const edgeRadius = Math.max(faceRadius * 0.95 * handleThickness, 0.14);
    const cornerScale = Math.max(faceRadius * 1.25 * handleThickness, 0.14);
    const faceDepth = Math.max(baseSize * 0.28 * handleDistance, faceRadius * 3.0 * handleDistance, 0.35);

    this._updateBoxPalette();

    this._boxHandles.forEach((handle) => {
      const role = handle.userData.handleRole;
      const dir = handle.userData.handleDir?.clone();
      if (role === 'scaleAxis' && dir) {
        const offset = dir.clone().multiply(size).multiplyScalar(0.5 * handleDistance);
        handle.position.copy(center).add(offset);
        handle.position.addScaledVector(dir, faceDepth * 0.5);
        handle.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        const shaft = handle.getObjectByName('AxisShaft');
        const tip = handle.getObjectByName('AxisTip');
        if (shaft) {
          shaft.scale.set(faceRadius * 0.35 * handleThickness, faceDepth, faceRadius * 0.35 * handleThickness);
        }
        if (tip) {
          const tipRadius = faceRadius * 1.15 * handleThickness;
          tip.scale.set(tipRadius, tipRadius, tipRadius);
          tip.position.y = 0.5 + faceDepth * 0.5 + tipRadius * 0.9;
        }
      } else if (role === 'rotate' && dir) {
        const localPosition = handle.userData.localPosition?.clone() ?? new THREE.Vector3();
        handle.position.copy(center).add(localPosition.multiply(size).multiplyScalar(handleDistance));
        handle.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        const axisSize = Math.abs(dir.x) > 0.9 ? size.x : Math.abs(dir.y) > 0.9 ? size.y : size.z;
        handle.scale.set(edgeRadius * handleThickness, axisSize * 0.9 * handleDistance, edgeRadius * handleThickness);
      } else if (role === 'scaleUniform' && dir) {
        const offset = dir.clone().multiply(size).multiplyScalar(0.5 * handleDistance);
        handle.position.copy(center).add(offset);
        handle.position.addScaledVector(dir, cornerScale * 0.5);
        handle.quaternion.identity();
        handle.scale.setScalar(cornerScale * handleThickness);
      }
    });
  }

  _onVpReady() { this._build(); }
  _onRendererChanged() { this._build(); }
  _onEditorCamChanged() { this._build(); }

  _onSelectNode(event) {
    const objects = Array.isArray(event.detail?.objects)
      ? event.detail.objects.filter(Boolean)
      : (event.detail?.object ? [event.detail.object] : []);
    const object = objects[objects.length - 1] ?? null;

    // Respect per-object lock
    if (object && object.userData.cycoLocked) { this.detach(); return; }
    if (objects.length > 0 && objects.every(o => o.userData?.cycoLocked)) { this.detach(); return; }

    if (this._physicsEdit) {
      this._physicsOwner = object;
      this._physicsProxy = object?.userData?._physicsEditProxy ?? null;
      this._physicsTemporaryOutline = !this._physicsProxy;
      this._targetObject = this._physicsProxy || object;
      this._mode = 'universal';
      this._applyMode();
      return;
    }

    // ── Multi-select: drive a virtual group object ─────────────────────────
    const locked = objects.filter(o => !o.userData?.cycoLocked);
    if (locked.length >= 2) {
      if (this._multiMode === 'individual') {
        // Individual pivot: gizmo on first selected object, pivot markers on the rest.
        this._destroyMultiGroup();
        this._multiTargets = locked.slice();
        this._attachTo(locked[0]);
        this._updatePivotIndicators(locked);
        if (this._boxGroup) this._updateBoxPalette();
        return;
      }
      this._hidePivotIndicators();
      this._attachToMulti(locked);
      if (this._boxGroup) this._updateBoxPalette();
      return;
    }
    // Single select — drop the multi-group
    this._destroyMultiGroup();
    this._attachTo(object ?? null);
    // Refresh the Box Gizmo palette so its wireframe + glow colors
    // track the active outline section (singleSelect for 1 object,
    // firstSelected for ≥2).  Without this the box gizmo keeps using
    // whatever was painted at the last palette update.
    if (this._boxGroup) this._updateBoxPalette();
  }

  _attachToMulti(objects) {
    if (!Array.isArray(objects) || objects.length < 2) {
      this._attachTo(objects[0] ?? null);
      return;
    }
    // Build (or refresh) the virtual group object that the gizmo attaches to
    if (!this._multiGroup) {
      this._multiGroup = new THREE.Group();
      this._multiGroup.name = '__cyco_multi_gizmo_target__';
      this._multiGroup.userData._isGizmo = true;
      this.engine.scene?.add(this._multiGroup);
    }
    this._multiTargets = objects.slice();

    // Compute the centroid of all selected objects' world positions
    this._recomputeMultiCentroid();

    this._targetObject = this._multiGroup;
    this._applyMode();
    if (this._mode !== 'select' && this._mode !== 'universal' && this._tc) {
      this._tc.attach(this._multiGroup);
    }
  }

  _destroyMultiGroup() {
    if (this._multiGroup?.parent) this._multiGroup.parent.remove(this._multiGroup);
    this._multiGroup = null;
    this._multiTargets = [];
    this._multiCentroid.set(0, 0, 0);
    this._multiPivots = [];
    this._multiRots = [];
    this._multiScales = [];
    this._hidePivotIndicators();
  }

  /**
   * Individual-pivot mode: show a small 3-axis crosshair on every
   * multi-selected object EXCEPT the one the gizmo is attached to
   * (the first selected).  This makes it obvious that the gizmo
   * only controls the primary object, but rotation/scale still applies
   * to every selected object around its own centre.
   */
  _updatePivotIndicators(objects) {
    this._hidePivotIndicators();
    if (!Array.isArray(objects) || objects.length < 2) return;
    if (this._multiMode !== 'individual') return;
    const scene = this.engine?.scene;
    if (!scene) return;

    this._pivotIndicators = [];
    // skip index 0 — the gizmo already sits on it
    for (let i = 1; i < objects.length; i++) {
      const obj = objects[i];
      if (!obj) continue;
      const marker = this._buildPivotMarker();
      // Position the marker at the object's world position so the indicator
      // visually represents the per-object pivot.
      obj.getWorldPosition(marker.position);
      marker.userData._target = obj;
      scene.add(marker);
      this._pivotIndicators.push(marker);
    }
  }

  _buildPivotMarker() {
    const g = new THREE.Group();
    g.name = '__cyco_pivot_indicator__';
    g.userData._isGizmo = true;
    const len = 0.18;
    const mat = (hex) => new THREE.LineBasicMaterial({
      color: hex,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.85,
      toneMapped: false,
    });
    const xAxis = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-len, 0, 0), new THREE.Vector3(len, 0, 0),
    ]);
    const yAxis = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, -len, 0), new THREE.Vector3(0, len, 0),
    ]);
    const zAxis = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, -len), new THREE.Vector3(0, 0, len),
    ]);
    const xLine = new THREE.Line(xAxis, mat(0xff4040));
    const yLine = new THREE.Line(yAxis, mat(0x40ff40));
    const zLine = new THREE.Line(zAxis, mat(0x4080ff));
    // Make the marker always face the camera (billboard behaviour isn't critical,
    // but at least render it on top of everything else).
    xLine.renderOrder = yLine.renderOrder = zLine.renderOrder = 9999;
    g.add(xLine); g.add(yLine); g.add(zLine);
    // Tiny centre sphere
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.025, 8, 8),
      new THREE.MeshBasicMaterial({
        color: 0xffd060, depthTest: false, transparent: true,
        opacity: 0.95, toneMapped: false,
      }),
    );
    dot.renderOrder = 9999;
    g.add(dot);
    return g;
  }

  _hidePivotIndicators() {
    if (!this._pivotIndicators) return;
    for (const m of this._pivotIndicators) {
      m.parent?.remove(m);
      m.traverse?.((c) => {
        if (c.geometry) c.geometry.dispose?.();
        if (c.material) c.material.dispose?.();
      });
    }
    this._pivotIndicators = [];
  }

  _recomputeMultiCentroid() {
    const objs = this._multiTargets;
    if (!objs || objs.length === 0) {
      this._multiCentroid.set(0, 0, 0);
      return;
    }
    const v = new THREE.Vector3();
    for (const obj of objs) {
      v.add(obj.getWorldPosition(new THREE.Vector3()));
    }
    v.multiplyScalar(1 / objs.length);
    this._multiCentroid.copy(v);
    // Snap the virtual group to the centroid so the gizmo appears at center
    this._multiGroup.position.copy(v);
    this._multiGroup.quaternion.identity();
    this._multiGroup.scale.set(1, 1, 1);
    this._multiGroup.updateMatrixWorld(true);
  }

  _onDeselectAll() {
    this.detach();
    this._hideBox();
    this._destroyMultiGroup();
  }

  _onHierarchyRemove(e) {
    const { objectId } = e.detail ?? {};
    if (!objectId) return;
    if (this._targetObject?.userData?.cycoId === objectId) {
      this.detach();
      this._hideBox();
    }
    // Drop the multi-group if any of its targets was deleted
    if (this._multiTargets.length > 0) {
      this._multiTargets = this._multiTargets.filter(o => o.userData?.cycoId !== objectId);
      if (this._multiTargets.length < 2) {
        this._destroyMultiGroup();
        this._attachTo(this._multiTargets[0] ?? null);
      } else if (this._multiMode === 'individual') {
        // Refresh pivot markers for the new (still multi) selection.
        this._attachTo(this._multiTargets[0]);
        this._updatePivotIndicators(this._multiTargets);
      } else {
        this._recomputeMultiCentroid();
      }
    }
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
    if (event.button !== 0 || (!this._physicsEdit && this._mode !== 'universal') || !this._boxActive || !this._boxGroup) return;
    if (this._physicsEdit && !this._physicsProxy) return;
    const hit = this._pickGizmoHit(event);
    if (!hit) return;

    event.stopPropagation();
    event.preventDefault();
    window.__cyco = window.__cyco || {};
    window.__cyco._suppressSelectionManagerClick = true;

    if (!this._physicsEdit && this._targetObject && !this.selectionManager.selected.has(this._targetObject)) {
      this.selectionManager.selectObject(this._targetObject);
    }

    this._clearHoveredHandle();
    if (hit.object.userData.handleRole !== 'translate') {
      this._setHoveredHandle(hit.object);
    }
    const startPosition = this._targetObject ? this._targetObject.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3();
    const renderer = this.engine.rendererManager?.renderer;
    const camera = this.engine.camera;
    let startPointer = null;
    let dragPlane = null;
    let startPlanePoint = null;
    if (renderer && camera) {
      const rect = renderer.domElement.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      startPointer = new THREE.Vector2(x, y);
      const normal = camera.getWorldDirection(new THREE.Vector3()).clone().negate();
      dragPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, startPosition);
      this._raycaster.setFromCamera(startPointer, camera);
      const planePoint = new THREE.Vector3();
      startPlanePoint = this._raycaster.ray.intersectPlane(dragPlane, planePoint) ? planePoint : null;
    }
    this._matrixBefore = this._targetObject?.matrix.clone();
    this._interaction = {
      pointerId: event.pointerId,
      type: hit.object.userData.handleRole || 'translate',
      axis: hit.object.userData.handleAxis || null,
      axisDir: hit.object.userData.handleDir ? hit.object.userData.handleDir.clone() : null,
      faceNormal: hit.face ? hit.face.normal.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize() : null,
      startX: event.clientX,
      startY: event.clientY,
      startPointer,
      dragPlane,
      startPlanePoint,
      startPosition,
      startQuaternion: this._targetObject ? this._targetObject.quaternion.clone() : new THREE.Quaternion(),
      startScale: this._targetObject ? this._targetObject.scale.clone() : new THREE.Vector3(1, 1, 1),
    };

    if (event.target?.setPointerCapture) {
      try { event.target.setPointerCapture(event.pointerId); } catch (_) {}
    }

    this._isDragging = true;
    this.selectionManager._gizmoDragging = true;
  }

  _onGizmoPointerMove(event) {
    if (!this._boxActive || !this._boxGroup) return;
    if (!this._physicsEdit && this._mode !== 'universal') return;
    if (this._physicsEdit && !this._physicsProxy) return;
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
        let cursor = 'default';
        if (hit.object.userData.handleRole === 'translate') cursor = 'move';
        else if (hit.object.userData.handleRole === 'rotate') cursor = this._getRotateCursor(hit.object);
        else if (hit.object.userData.handleRole === 'scaleAxis' || hit.object.userData.handleRole === 'scaleUniform') cursor = 'nwse-resize';
        this.engine.rendererManager.renderer.domElement.style.cursor = cursor;
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
    if (this._physicsEdit) {
      this._syncPhysicsComponentFromProxy();
    } else if (obj && before && after && !before.equals(after)) {
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
    this.selectionManager._gizmoDragging = false;
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
    let translateHit = null;
    for (const hit of hits) {
      const resolved = this._resolveGizmoHandle(hit.object);
      if (!resolved) continue;
      if (resolved.userData.handleRole !== 'translate') {
        hit.object = resolved;
        return hit;
      }
      translateHit = hit;
    }
    if (translateHit) {
      translateHit.object = this._resolveGizmoHandle(translateHit.object);
      return translateHit;
    }

    if (this._boxVolume) {
      const volumeBox = new THREE.Box3().setFromObject(this._boxVolume);
      const intersectPoint = new THREE.Vector3();
      if (this._raycaster.ray.intersectBox(volumeBox, intersectPoint)) {
        return {
          object: this._boxVolume,
          point: intersectPoint.clone(),
          distance: intersectPoint.distanceTo(this._raycaster.ray.origin),
        };
      }
    }
    return null;
  }

  _resolveGizmoHandle(object) {
    let obj = object;
    while (obj && !obj.userData?.handleRole) {
      obj = obj.parent;
    }
    return obj;
  }

  _getRotateCursor(handle) {
    const axis = handle?.userData?.handleAxis;
    if (!axis) return 'default';
    if (axis === 'Y') return 'ew-resize';
    return 'ns-resize';
  }

  _setHoveredHandle(handle) {
    if (this._hoveredHandle === handle) return;
    this._clearHoveredHandle();
    if (!handle) return;
    this._hoveredHandle = handle;
    if (handle.material && handle.userData?.baseColor) {
      handle.material.color.set(handle.userData.hoverColor || 0xffff00);
    }
    if (handle.children) {
      handle.children.forEach((child) => {
        if (child.material && handle.userData?.baseColor) {
          child.material.color.set(handle.userData.hoverColor || 0xffff00);
        }
      });
    }
  }

  _clearHoveredHandle() {
    if (!this._hoveredHandle) return;
    const handle = this._hoveredHandle;
    if (handle.material && handle.userData?.baseColor) {
      handle.material.color.set(handle.userData.baseColor);
    }
    if (handle.children) {
      handle.children.forEach((child) => {
        if (child.material && handle.userData?.baseColor) {
          child.material.color.set(handle.userData.baseColor);
        }
      });
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
    if (this._physicsEdit) this._syncPhysicsComponentFromProxy();
    this._updateBoxGizmo();
  }

  _updateTranslate(dx, dy) {
    const camera = this.engine.camera;
    const renderer = this.engine.rendererManager?.renderer;
    if (!camera || !renderer) return;
    let worldPosition = this._interaction.startPosition.clone();
    if (this._interaction.dragPlane && this._interaction.startPlanePoint) {
      const rect = renderer.domElement.getBoundingClientRect();
      const x = ((this._interaction.startX - rect.left) / rect.width) * 2 - 1;
      const y = -((this._interaction.startY - rect.top) / rect.height) * 2 + 1;
      this._pointer.set(x, y);
      this._raycaster.setFromCamera(this._pointer, camera);
      const currentNdc = new THREE.Vector2(
        ((this._interaction.startX + dx - rect.left) / rect.width) * 2 - 1,
        -((this._interaction.startY + dy - rect.top) / rect.height) * 2 + 1
      );
      this._raycaster.setFromCamera(currentNdc, camera);
      const currentPoint = new THREE.Vector3();
      if (this._raycaster.ray.intersectPlane(this._interaction.dragPlane, currentPoint)) {
        const delta = currentPoint.clone().sub(this._interaction.startPlanePoint);
        worldPosition.add(delta);
      } else {
        const forward = new THREE.Vector3();
        camera.getWorldDirection(forward).normalize();
        const up = new THREE.Vector3().copy(camera.up).normalize();
        const right = new THREE.Vector3().crossVectors(forward, up).normalize();
        const move = new THREE.Vector3();
        move.addScaledVector(right, dx * 0.0025);
        move.addScaledVector(up, -dy * 0.0025);
        worldPosition.add(move);
      }
    } else {
      const forward = new THREE.Vector3();
      camera.getWorldDirection(forward).normalize();
      const up = new THREE.Vector3().copy(camera.up).normalize();
      const right = new THREE.Vector3().crossVectors(forward, up).normalize();
      const move = new THREE.Vector3();
      move.addScaledVector(right, dx * 0.0025);
      move.addScaledVector(up, -dy * 0.0025);
      worldPosition.add(move);
    }
    if (this._targetObject.parent) {
      this._targetObject.parent.worldToLocal(worldPosition);
    }
    this._targetObject.position.copy(worldPosition);
  }

  _updateRotate(dx, dy) {
    const axis = this._interaction.axisDir || new THREE.Vector3(0, 1, 0);
    const direction = (Math.abs(dx) > Math.abs(dy) ? dx : dy) * 0.005;
    const rotation = new THREE.Quaternion().setFromAxisAngle(axis, direction);
    this._targetObject.quaternion.copy(this._interaction.startQuaternion).premultiply(rotation);
  }

  _updateScaleAxis(dx, dy) {
    const axis = this._interaction.axis;
    const delta = Math.abs(dx) > Math.abs(dy) ? dx : -dy;
    const factor = Math.max(0.05, 1 + delta * 0.0025);
    const scale = this._interaction.startScale.clone();
    if (axis === 'X') scale.x *= factor;
    if (axis === 'Y') scale.y *= factor;
    if (axis === 'Z') scale.z *= factor;
    this._targetObject.scale.copy(scale);
  }

  _updateScaleUniform(dx, dy) {
    const delta = Math.abs(dx) > Math.abs(dy) ? dx : -dy;
    const factor = Math.max(0.05, 1 + delta * 0.0025);
    this._targetObject.scale.copy(this._interaction.startScale).multiplyScalar(factor);
  }

  _onPhysicsEditMode(event) {
    this._physicsEdit = !!event.detail?.enabled;
    if (this._physicsEdit) {
      const selected = this.selectionManager?.selected ? [...this.selectionManager.selected] : [];
      const current = selected[selected.length - 1] ?? null;
      if (current) {
        this._physicsOwner = current;
      }
      this._mode = 'universal';
      this._physicsProxy = this._physicsOwner?.userData?._physicsEditProxy ?? null;
      this._physicsTemporaryOutline = !this._physicsProxy && !!this._physicsOwner;
      this._targetObject = this._physicsProxy || this._physicsOwner || null;
    } else {
      const selected = this.selectionManager?.selected ? [...this.selectionManager.selected] : [];
      const current = selected[selected.length - 1] ?? null;
      this._physicsOwner = null;
      this._physicsProxy = null;
      this._physicsTemporaryOutline = false;
      this._targetObject = current ?? null;
      if (this._mode === 'universal' || this._mode === 'select') {
        this._mode = 'select';
      }
    }
    this._applyMode();
  }

  _onPhysicsProxyReady(event) {
    const { object, proxy } = event.detail ?? {};
    if (!this._physicsEdit || !object || !proxy) return;
    if (this._physicsOwner && this._physicsOwner !== object) return;
    this._physicsOwner = object;
    this._physicsProxy = proxy;
    this._physicsTemporaryOutline = false;
    this._targetObject = proxy;
    this._applyMode();
  }

  _onPhysicsEditFocus(event) {
    const object = event.detail?.object;
    if (!this._physicsEdit || !object) return;
    this._physicsOwner = object;
    this._physicsProxy = object.userData?._physicsEditProxy ?? null;
    this._physicsTemporaryOutline = !this._physicsProxy;
    this._targetObject = this._physicsProxy || object;
    this._applyMode();
  }

  _onPhysicsTool(event) {
    if (!this._physicsEdit) return;
    const mode = event.detail?.mode;
    if (['translate', 'rotate', 'scale', 'universal'].includes(mode)) {
      this._mode = 'universal';
      this._applyMode();
    }
  }

  _syncPhysicsComponentFromProxy() {
    const proxy = this._physicsProxy || this._targetObject;
    const comp = proxy?.userData?.physicsComponent;
    const owner = this._physicsOwner || proxy?.parent;
    if (!proxy || !comp || !owner) return;

    comp.position = { x: proxy.position.x, y: proxy.position.y, z: proxy.position.z };
    comp.offset = { ...comp.position };
    comp.rotation = { x: proxy.quaternion.x, y: proxy.quaternion.y, z: proxy.quaternion.z, w: proxy.quaternion.w };

    const worldScale = new THREE.Vector3();
    proxy.getWorldScale(worldScale);
    comp.scale = {
      x: Math.max(0.001, Math.abs(worldScale.x)),
      y: Math.max(0.001, Math.abs(worldScale.y)),
      z: Math.max(0.001, Math.abs(worldScale.z)),
    };

    if (comp.type === 'Box Collider' || comp.type === 'Box Trigger') {
      comp.halfExtents = { ...comp.scale };
    } else if (comp.type === 'Sphere Collider' || comp.type === 'Sphere Trigger') {
      const radius = (comp.scale.x + comp.scale.y + comp.scale.z) / 3;
      comp.radius = Math.max(0.001, radius);
      comp.scale = { x: comp.radius, y: comp.radius, z: comp.radius };
    } else if (comp.type === 'Capsule Collider' || comp.type === 'Capsule Trigger') {
      comp.radius = Math.max(0.001, Math.min(comp.scale.x, comp.scale.z));
      comp.halfHeight = Math.max(0.001, comp.scale.y);
      comp.scale = { x: comp.radius, y: comp.halfHeight, z: comp.radius };
    }

    window.dispatchEvent(new CustomEvent('cyco-physics-edit-update', {
      detail: { object: owner, component: comp }
    }));
  }

  suspend() { this.detach(); }

  // ─── Multi-select transform helpers ──────────────────────────────────────

  /**
   * Capture the current world-space pivot (position, rotation, scale) of each
   * multi-select target at the start of a transform drag. Used for live delta
   * computation and for undo snapshots.
   */
  _captureMultiPivots() {
    if (this._multiTargets.length < 2) {
      this._multiPivots = [];
      this._multiRots = [];
      this._multiScales = [];
      return;
    }
    this._multiPivots = this._multiTargets.map(o => o.getWorldPosition(new THREE.Vector3()));
    this._multiRots   = this._multiTargets.map(o => o.getWorldQuaternion(new THREE.Quaternion()));
    this._multiScales = this._multiTargets.map(o => o.getWorldScale(new THREE.Vector3()));
  }

  /**
   * Apply the gizmo's current delta (relative to `_matrixBefore`) to every
   * multi-select target. Called from the `change` event while dragging.
   */
  _applyMultiFromCurrentGroup() {
    if (!this._matrixBefore || this._multiTargets.length < 2) return;
    const after = this._targetObject.matrix.clone();
    this._applyMultiMatricesFromGroupDelta(this._matrixBefore, after);
    // Recompute the centroid so the gizmo's drag handle stays centered.
    // In individual mode the gizmo is on the first selected object, so the
    // "centroid" used for the toolbar status indicator still tracks the
    // actual selection centre.
    if (this._multiMode !== 'individual') this._recomputeMultiCentroid();
  }

  /**
   * For every multi-select target, compute its post-transform world matrix.
   *
   * Two modes:
   *  • _multiMode === 'group' (default — "Combined"):
   *      Apply the gizmo's delta to every target as one rigid cluster. All
   *      objects rotate / scale / move around the shared centroid pivot.
   *  • _multiMode === 'individual':
   *      Translate still uses the gizmo's translation delta (move-as-one),
   *      but rotation and scale are applied around each object's OWN world
   *      pivot. So each object keeps its own centre and its own local
   *      orientation. The gizmo target (the first selected object) is left
   *      alone — the gizmo's transform controls already drove it directly.
   */
  _applyMultiMatricesFromGroupDelta(beforeGroupMatrix, afterGroupMatrix) {
    if (this._multiTargets.length < 2) return;
    if (this._multiPivots.length !== this._multiTargets.length) return;

    const delta = new THREE.Matrix4().copy(afterGroupMatrix).multiply(
      new THREE.Matrix4().copy(beforeGroupMatrix).invert()
    );

    // Decompose the delta once. For 'individual' mode we apply only the
    // translation to each target's pivot and rebuild rotation/scale per
    // object around its own centre.
    const deltaPos  = new THREE.Vector3();
    const deltaQuat = new THREE.Quaternion();
    const deltaScale = new THREE.Vector3();
    delta.decompose(deltaPos, deltaQuat, deltaScale);
    const deltaMode = (this._multiMode === 'individual');

    const newWorld = new THREE.Matrix4();
    const parentWorldInverse = new THREE.Matrix4();

    for (let i = 0; i < this._multiTargets.length; i++) {
      const obj = this._multiTargets[i];
      const pivot  = this._multiPivots[i];
      const rot    = this._multiRots[i];
      const scale  = this._multiScales[i];

      // In individual mode the gizmo itself has already transformed index 0
      // (the primary selected object). Re-applying the delta would double-move
      // it, so skip the per-target transform for the gizmo's own target.
      if (deltaMode && i === 0) continue;

      let newPivot, newRot, newScale;

      if (!deltaMode) {
        // Combined pivot: post-multiply the captured world matrix by the full delta.
        newWorld.compose(pivot, rot, scale);
        newWorld.multiply(delta);
        // Convert world → local
        const parent = obj.parent;
        if (parent) {
          parent.updateMatrixWorld(true);
          parentWorldInverse.copy(parent.matrixWorld).invert();
          newWorld.premultiply(parentWorldInverse);
        }
        newPivot  = null; // decomposed below
      } else {
        // Individual pivot: apply translation to the pivot point, but rotate
        // and scale around the object's own (newly-translated) centre.
        newPivot = pivot.clone().add(deltaPos);
        newRot   = rot.clone().premultiply(deltaQuat);
        newScale = scale.clone().multiply(deltaScale);
        newWorld.compose(newPivot, newRot, newScale);
        const parent = obj.parent;
        if (parent) {
          parent.updateMatrixWorld(true);
          parentWorldInverse.copy(parent.matrixWorld).invert();
          newWorld.premultiply(parentWorldInverse);
        }
      }

      obj.matrix.copy(newWorld);
      obj.matrix.decompose(obj.position, obj.quaternion, obj.scale);
      obj.matrixAutoUpdate = true;

      if (deltaMode) {
        // Refresh captured pivots so subsequent drags accumulate correctly.
        this._multiPivots[i] = newPivot;
      }
    }
  }

  /**
   * Programmatic toggle between "Group" (centroid pivot, move all together)
   * and "Individual" (gizmo attaches to first selected object; rotations and
   * scales apply per-object around each object's own pivot).
   */
  setMultiMode(mode) {
    if (mode !== 'group' && mode !== 'individual') return;
    if (this._multiMode === mode) return;
    this._multiMode = mode;
    // Rebuild gizmo target for the new pivot strategy.
    if (this._multiTargets && this._multiTargets.length >= 2) {
      // Snapshot before destroying so we still know which objects to attach / mark.
      const targets = this._multiTargets.slice();
      if (mode === 'individual') {
        // Attach gizmo to first selected object; show small pivot markers on the rest.
        this._destroyMultiGroup();
        // Temporarily clear so _attachTo's multi-guard doesn't block the
        // single-object attach. Restore immediately after so the multi
        // set is intact for drag / scale / rotate propagation.
        this._multiTargets = [];
        this._attachTo(targets[0]);
        this._multiTargets = targets;
        this._updatePivotIndicators(targets);
      } else {
        // Combined: rebuild the centroid virtual group.
        this._hidePivotIndicators();
        this._attachToMulti(targets);
      }
    }
  }

  getMultiMode() { return this._multiMode; }
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
    window.removeEventListener('cyco-physics-edit-mode', this._onPhysicsEditMode);
    window.removeEventListener('cyco-physics-edit-proxy-ready', this._onPhysicsProxyReady);
    window.removeEventListener('cyco-physics-edit-focus', this._onPhysicsEditFocus);
    window.removeEventListener('cyco-physics-vp-tool', this._onPhysicsTool);
    this._teardown();
    window.removeEventListener('cyco-preferences-change', this._onPrefsChanged);
    window.removeEventListener('cyco-preferences-preview', this._onPrefsChanged);
  }
}















