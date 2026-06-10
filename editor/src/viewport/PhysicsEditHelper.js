/**
 * PhysicsEditHelper.js
 * Editor-only visualisation of physics collider shapes.
 * Uses Three.js wireframe geometry — Rapier is NOT loaded in edit mode.
 *
 * Activated when the user enables "Physics Edit Mode" from the camera dropdown.
 * Deactivated on disable or on Play (PhysicsManager's own debug renderer takes over).
 *
 * Each collider component type gets a different colour wireframe:
 *   Box Collider      → lime green   (#00e676)
 *   Sphere Collider   → cyan         (#00b0ff)
 *   Capsule Collider  → amber        (#ffab00)
 *   Mesh Collider     → orange       (#ff6d00)
 *   Trigger (sensor)  → magenta      (#e040fb)
 *
 * Events consumed:
 *   cyco-physics-edit-mode  { enabled: boolean }
 *   cyco-runtime-state      { playing: boolean }  — hides overlays during Play
 *   cyco-scene-switch       {}                     — rebuilds overlays on scene change
 *   cyco-object-selected    { object }             — refreshes highlights
 *
 * Usage (in ViewportEngine or main.js):
 *   const helper = new PhysicsEditHelper(viewportEngine);
 */

import * as THREE from 'three';
import { loadPrefs } from '../ui/PreferencesWindow.js';

try { if (typeof window !== 'undefined' && window.__cyco_log) window.__cyco_log('[PhysicsEditHelper] module loaded'); else console.log('[PhysicsEditHelper] module loaded'); } catch (err) {}

const COLORS = {
  'Box Collider':     0x00e676,
  'Sphere Collider':  0x00b0ff,
  'Capsule Collider': 0xffab00,
  'Mesh Collider':    0xff6d00,
  trigger:            0xe040fb,
};

export class PhysicsEditHelper {
  /**
   * @param {import('./ViewportEngine.js').ViewportEngine} viewportEngine
   */
  constructor(viewportEngine) {
    this._engine  = viewportEngine;
    this._enabled = false;
    this._playing = false;
    this._prefs = loadPrefs();

    /** Map: object.uuid → THREE.LineSegments[] (overlay meshes added to scene) */
    this._overlays = new Map();
    /** Map: object.uuid → THREE.Object3D (invisible collider proxy used for transform gizmo) */
    this._proxyObjects = new Map();

    this._onEditMode    = this._onEditMode.bind(this);
    this._onRuntimeState = this._onRuntimeState.bind(this);
    this._onSceneSwitch = this._onSceneSwitch.bind(this);
    this._onSceneDirty  = this._onSceneDirty.bind(this);
    this._onEditUpdate  = this._onEditUpdate.bind(this);
    this._onSelectNode  = this._onSelectNode.bind(this);
    this._onPrefsChanged = this._onPrefsChanged.bind(this);

    window.addEventListener('cyco-physics-edit-mode', this._onEditMode);
    window.addEventListener('cyco-runtime-state',     this._onRuntimeState);
    window.addEventListener('cyco-scene-switch',      this._onSceneSwitch);
    window.addEventListener('cyco-scene-dirty',       this._onSceneDirty);
    window.addEventListener('cyco-physics-edit-update',this._onEditUpdate);
    window.addEventListener('cyco-select-node',        this._onSelectNode);
    window.addEventListener('cyco-preferences-change', this._onPrefsChanged);
    window.addEventListener('cyco-preferences-preview',this._onPrefsChanged);

    this._raycaster = new THREE.Raycaster();
    this._domElement = null;
    this._onPointerDown = this._onPointerDown.bind(this);
  }

  dispose() {
    window.removeEventListener('cyco-physics-edit-mode', this._onEditMode);
    window.removeEventListener('cyco-runtime-state',     this._onRuntimeState);
    window.removeEventListener('cyco-scene-switch',      this._onSceneSwitch);
    window.removeEventListener('cyco-scene-dirty',       this._onSceneDirty);
    window.removeEventListener('cyco-physics-edit-update',this._onEditUpdate);
    window.removeEventListener('cyco-select-node',        this._onSelectNode);
    window.removeEventListener('cyco-preferences-change', this._onPrefsChanged);
    window.removeEventListener('cyco-preferences-preview',this._onPrefsChanged);
    this._clearAll();
  }

  // ─── Event Handlers ───────────────────────────────────────────────────────

  _onEditMode(e) {
    this._enabled = !!e.detail?.enabled;
    if (this._enabled && !this._playing) {
      this._attachPointer();
      this._rebuild();
    } else {
      this._detachPointer();
      this._clearAll();
    }
  }

  _onPrefsChanged(event) {
    this._prefs = event.detail?.prefs ?? loadPrefs();
    if (this._enabled && !this._playing) this._rebuild();
  }

  _attachPointer() {
    try {
      const dom = this._engine.rendererManager?.renderer?.domElement;
      if (dom && dom !== this._domElement) {
        this._detachPointer();
        // Listen in capture so physics overlay clicks run before SelectionManager
        dom.addEventListener('pointerdown', this._onPointerDown, { passive: false, capture: true });
        this._domElement = dom;
      }
    } catch (err) {}
  }

  _detachPointer() {
    try {
      if (this._domElement) {
        this._domElement.removeEventListener('pointerdown', this._onPointerDown);
        this._domElement = null;
      }
    } catch (err) {}
  }

  _onPointerDown(e) {
    if (!this._enabled || this._playing) return;
    // Collider overlays are now editor-only and non-selectable, so regular
    // SelectionManager picking can decide what the user meant.
  }

  _onRuntimeState(e) {
    this._playing = !!e.detail?.playing;
    if (this._playing) {
      // Hide editor overlays during play — PhysicsManager's debug renderer handles it
      this._clearAll();
    } else if (this._enabled) {
      // Restore overlays when returning to edit mode
      this._rebuild();
    }
  }

  _onSelectNode() {
    if (this._enabled && !this._playing) {
      this._rebuild();
    }
  }

  _onSceneSwitch() {
    if (this._enabled && !this._playing) this._rebuild();
  }

  _onSceneDirty() {
    if (this._enabled && !this._playing) this._rebuild();
  }

  _onEditUpdate(event) {
    if (!this._enabled || this._playing) return;
    const object = event?.detail?.object;
    // If the user is actively dragging the gizmo, avoid rebuilding overlays
    // (which can recreate proxy objects and detach TransformControls). Instead
    // update the proxy transform in-place so visuals follow the gizmo smoothly.
    const dragging = window.__cyco?.selectionManager?._gizmoDragging ?? false;
    if (object) {
      if (dragging) {
        try {
          const proxy = object.userData?._physicsEditProxy;
          const comp = event?.detail?.component || (object.userData?.physics?.components?.[0]);
          if (proxy && comp) {
            this._syncColliderProxy(proxy, comp);
          }
        } catch (err) {
          // fall back to full rebuild on error
          console.warn('PhysicsEditHelper: live update failed, falling back to rebuild', err);
          this._rebuildObject(object);
        }
      } else {
        this._rebuildObject(object);
      }
    } else {
      this._rebuild();
    }
  }

  _rebuildObject(object) {
    const comps = object.userData?.physics?.components;
    if (!Array.isArray(comps) || comps.length === 0) {
      this._clearObject(object);
      return;
    }

    this._clearObject(object);
    for (const comp of comps) this._normalizeColliderComponent(comp);
    const proxy = this._ensureColliderProxy(object, comps);

    for (const comp of comps) {
      const lines = this._makeOverlay(comp, object, proxy);
      if (!lines) continue;
      const parent = proxy || object;
      parent.add(lines);
      if (!this._overlays.has(object.uuid)) this._overlays.set(object.uuid, []);
      this._overlays.get(object.uuid).push(lines);
    }
  }

  _clearObject(object) {
    const overlays = this._overlays.get(object.uuid);
    if (overlays) {
      for (const m of overlays) {
        if (m.parent) m.parent.remove(m);
        if (m.geometry) m.geometry.dispose();
        if (m.material) m.material.dispose();
      }
      this._overlays.delete(object.uuid);
    }
  }

  // ─── Build / Clear ────────────────────────────────────────────────────────

  /**
   * Walk the active scene and create wireframe overlays for all physics components.
   */
  _rebuild() {
    this._clearAll();
    const scene = this._engine.scene;
    if (!scene) return;

    // Rescue any orphaned proxies that exist in the scene (e.g. after undo/redo or serialization)
    scene.traverse((obj) => {
      if (obj.name === '__physics_edit_proxy__' && obj.userData?._ownerUuid) {
        const owner = scene.getObjectByProperty('uuid', obj.userData._ownerUuid);
        if (owner && obj.parent !== owner) {
          if (obj.parent) obj.parent.remove(obj);
          owner.add(obj);
          this._proxyObjects.set(owner.uuid, obj);
        }
      }
    });

    scene.traverse((obj) => {
      const comps = obj.userData?.physics?.components;
      if (!Array.isArray(comps) || comps.length === 0) return;
      for (const comp of comps) this._normalizeColliderComponent(comp);
      const proxy = this._ensureColliderProxy(obj, comps);
      for (const comp of comps) {
        const lines = this._makeOverlay(comp, obj, proxy);
        if (!lines) continue;
        const parent = proxy || obj;
        parent.add(lines);
        if (!this._overlays.has(obj.uuid)) this._overlays.set(obj.uuid, []);
        this._overlays.get(obj.uuid).push(lines);
      }
    });
  }

  /** Remove and dispose all overlay meshes. */
  _clearAll() {
    for (const [, meshes] of this._overlays) {
      for (const m of meshes) {
        if (m.parent) m.parent.remove(m);
        m.geometry.dispose();
        m.material.dispose();
      }
    }
    this._overlays.clear();
    this._clearProxies();
  }

  _clearProxies() {
    for (const [objectUuid, proxy] of this._proxyObjects.entries()) {
      if (proxy.parent) proxy.parent.remove(proxy);
      const owner = this._engine.scene?.getObjectByProperty('uuid', objectUuid);
      if (owner?.userData?._physicsEditProxy === proxy) {
        delete owner.userData._physicsEditProxy;
      }
      proxy.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
    }
    this._proxyObjects.clear();
  }

  // ─── Geometry Helpers ─────────────────────────────────────────────────────

  /**
   * Create a wireframe LineSegments for a single physics component.
   * @param {object} comp
   * @param {THREE.Object3D} obj
   * @returns {THREE.LineSegments|null}
   */
  _makeOverlay(comp, obj, attachToProxy = false) {
    const isTrigger = !!comp.isTrigger;
    const boundsPrefs = this._prefs?.gizmo?.colliderBounds ?? loadPrefs().gizmo.colliderBounds;
    const color = boundsPrefs.outlineColor ?? (isTrigger ? COLORS.trigger : (COLORS[comp.type] ?? 0xffffff));
    const mat   = new THREE.LineBasicMaterial({
      color,
      depthTest: false,
      transparent: true,
      opacity: Math.min(1, 0.55 + (boundsPrefs.thickness ?? 1) * 0.08),
      linewidth: Math.max(1, boundsPrefs.thickness ?? 1),
    });

    let geo = null;
    const bbox = new THREE.Box3().setFromObject(obj);
    const extents = new THREE.Vector3();
    if (!bbox.isEmpty()) bbox.getSize(extents);

    switch (comp.type) {
      case 'Box Collider':
      case 'Box Trigger': {
        if (attachToProxy) {
          geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(2, 2, 2));
        } else {
          let hx = 0.5, hy = 0.5, hz = 0.5;
          if (comp.scale) {
            hx = comp.scale.x ?? 0.5;
            hy = comp.scale.y ?? 0.5;
            hz = comp.scale.z ?? 0.5;
          } else if (comp.halfExtents) {
            hx = comp.halfExtents.x ?? 0.5;
            hy = comp.halfExtents.y ?? 0.5;
            hz = comp.halfExtents.z ?? 0.5;
          } else if (!bbox.isEmpty()) {
            hx = Math.max(extents.x * 0.5, 0.05);
            hy = Math.max(extents.y * 0.5, 0.05);
            hz = Math.max(extents.z * 0.5, 0.05);
          } else if (obj.geometry) {
            obj.geometry.computeBoundingBox();
            const bb = obj.geometry.boundingBox;
            if (bb) {
              hx = (bb.max.x - bb.min.x) * 0.5;
              hy = (bb.max.y - bb.min.y) * 0.5;
              hz = (bb.max.z - bb.min.z) * 0.5;
            }
          }

          const ws = new THREE.Vector3();
          obj.getWorldScale(ws);
          hx = Math.max(hx / Math.max(Math.abs(ws.x), 1e-6), 0.05);
          hy = Math.max(hy / Math.max(Math.abs(ws.y), 1e-6), 0.05);
          hz = Math.max(hz / Math.max(Math.abs(ws.z), 1e-6), 0.05);

          geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2));
        }
        break;
      }

      case 'Sphere Collider':
      case 'Sphere Trigger': {
        if (attachToProxy) {
          geo = new THREE.EdgesGeometry(new THREE.SphereGeometry(1, 12, 8));
        } else {
          let r = comp.scale
            ? ((comp.scale.x ?? 0.5) + (comp.scale.y ?? 0.5) + (comp.scale.z ?? 0.5)) / 3
            : comp.radius ?? 0.5;
          if (!comp.scale && comp.radius == null) {
            if (obj.geometry) {
              obj.geometry.computeBoundingSphere();
              r = obj.geometry.boundingSphere?.radius ?? r;
            } else if (!bbox.isEmpty()) {
              r = Math.max(extents.x, extents.y, extents.z) * 0.5;
            }
          }

          const ws = new THREE.Vector3();
          obj.getWorldScale(ws);
          const inv = 1 / Math.max(Math.abs(ws.x), Math.abs(ws.y), Math.abs(ws.z), 1e-6);
          const localRadius = Math.max(r * inv, 0.05);
          geo = new THREE.EdgesGeometry(new THREE.SphereGeometry(localRadius, 12, 8));
        }
        break;
      }

      case 'Capsule Collider':
      case 'Capsule Trigger': {
        if (attachToProxy) {
          geo = new THREE.EdgesGeometry(new THREE.CapsuleGeometry(1, 2, 4, 8));
        } else {
          let hh = comp.scale?.y ?? comp.halfHeight ?? 0.5;
          let r  = comp.scale?.x ?? comp.radius     ?? 0.25;
          if ((!comp.scale && comp.halfHeight == null) || (!comp.scale && comp.radius == null)) {
            if (!bbox.isEmpty()) {
              r = comp.radius ?? Math.max(Math.min(extents.x, extents.z) * 0.25, 0.05);
              hh = comp.halfHeight ?? Math.max(extents.y * 0.5 - r, 0.05);
            }
          }

          const ws = new THREE.Vector3();
          obj.getWorldScale(ws);
          const invXZ = 1 / Math.max(Math.abs(ws.x), Math.abs(ws.z), 1e-6);
          const invY = 1 / Math.max(Math.abs(ws.y), 1e-6);
          const localRadius = Math.max(r * invXZ, 0.05);
          const localHalfHeight = Math.max(hh * invY, 0.05);
          geo = new THREE.EdgesGeometry(new THREE.CapsuleGeometry(Math.max(localRadius, 0.05), Math.max(localHalfHeight * 2, 0.1), 4, 8));
        }
        break;
      }

      case 'Mesh Collider':
      case 'Mesh Trigger': {
        if (!obj.geometry) return null;
        geo = new THREE.EdgesGeometry(obj.geometry);
        break;
      }

      // Not a visual component
      case 'Rigid Body':
      case 'Character Controller':
      case 'Joint':
      case 'Ragdoll':
        return null;

      default:
        return null;
    }

    if (!geo) { mat.dispose(); return null; }

    // Apply collider local transform if specified
    const lines = new THREE.LineSegments(geo, mat);
    // mark ownership for picking
    lines.userData._ownerUuid = obj.uuid;
    if (!attachToProxy) {
      const position = this._getColliderLocalPosition(comp);
      lines.position.set(position.x ?? 0, position.y ?? 0, position.z ?? 0);
      if (comp.rotation) {
        lines.quaternion.set(
          comp.rotation.x ?? 0,
          comp.rotation.y ?? 0,
          comp.rotation.z ?? 0,
          comp.rotation.w ?? 1
        );
      }
    } else {
      lines.position.set(0, 0, 0);
      lines.quaternion.identity();
    }
    lines.name          = `__physics_edit_${comp.type}__`;
    lines.renderOrder   = 998;
    lines.frustumCulled = false;
    // Prevent this overlay from being serialised with the scene
    lines.userData._editorOnly = true;
    try {
      try { if (typeof window !== 'undefined' && window.__cyco_log) window.__cyco_log('[PhysicsEditHelper] makeOverlay', {
        type: comp.type,
        position: lines.position.clone(),
        quaternion: lines.quaternion.clone(),
        color: lines.material?.color?.getHexString?.() || null,
        opacity: lines.material?.opacity,
        linewidth: lines.material?.linewidth,
        attachToProxy: !!attachToProxy
      }); else console.log('[PhysicsEditHelper] makeOverlay', { type: comp.type, position: lines.position.clone(), quaternion: lines.quaternion.clone(), color: lines.material?.color?.getHexString?.() || null, opacity: lines.material?.opacity, linewidth: lines.material?.linewidth, attachToProxy: !!attachToProxy }); } catch (err) {}
    } catch (err) {}

    return lines;
  }

  _ensureColliderProxy(obj, comps) {
    const comp = comps.find(c => ['Box Collider', 'Sphere Collider', 'Capsule Collider', 'Mesh Collider',
      'Box Trigger', 'Sphere Trigger', 'Capsule Trigger', 'Mesh Trigger'].includes(c.type));
    if (!comp) return null;

    let proxy = obj.userData?._physicsEditProxy;
    if (!proxy) {
      proxy = new THREE.Object3D();
      proxy.name = '__physics_edit_proxy__';
      proxy.visible = true;
      proxy.frustumCulled = false;
      proxy.renderOrder = 997;
      proxy.userData._editorOnly = true;
      if (!obj.userData) obj.userData = {};
      obj.userData._physicsEditProxy = proxy;
      // mark proxy with owner uuid so other systems can find it reliably
      proxy.userData._ownerUuid = obj.uuid;
      obj.add(proxy);
      // ensure a center handle exists on the proxy so it always follows the collider
      try {
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
      } catch (err) {}
      this._proxyObjects.set(obj.uuid, proxy);
    } else {
      if (proxy.parent !== obj) {
        if (proxy.parent) {
          proxy.parent.remove(proxy);
        }
        obj.add(proxy);
      }
      proxy.visible = true;
      proxy.frustumCulled = false;
      if (!this._proxyObjects.has(obj.uuid)) {
        this._proxyObjects.set(obj.uuid, proxy);
      }
    }

    proxy.userData.physicsComponent = comp;
    // ensure owner uuid is always present (in case proxy was restored from serialized state)
    proxy.userData._ownerUuid = proxy.userData._ownerUuid || obj.uuid;
    this._syncColliderProxy(proxy, comp);
    window.dispatchEvent(new CustomEvent('cyco-physics-edit-proxy-ready', {
      detail: { object: obj, proxy }
    }));
    return proxy;
  }

  _getColliderLocalPosition(comp) {
    return comp.position || comp.offset || { x: 0, y: 0, z: 0 };
  }

  _normalizeColliderComponent(comp) {
    if (!comp) return;
    const type = String(comp.type || '');
    if (!type.includes('Collider') && !type.includes('Trigger')) return;

    if (!comp.position) comp.position = { ...(comp.offset || { x: 0, y: 0, z: 0 }) };
    if (!comp.offset) comp.offset = { ...comp.position };
    if (!comp.rotation) comp.rotation = { x: 0, y: 0, z: 0, w: 1 };
    if (!comp.scale) {
      if (comp.halfExtents) {
        comp.scale = {
          x: comp.halfExtents.x ?? 0.5,
          y: comp.halfExtents.y ?? 0.5,
          z: comp.halfExtents.z ?? 0.5,
        };
      } else if (comp.radius != null || comp.halfHeight != null) {
        const radius = comp.radius ?? 0.5;
        comp.scale = { x: radius, y: comp.halfHeight ?? radius, z: radius };
      } else {
        comp.scale = { x: 0.5, y: 0.5, z: 0.5 };
      }
    }

    if ((type === 'Box Collider' || type === 'Box Trigger') && !comp.halfExtents) {
      comp.halfExtents = { x: comp.scale.x ?? 0.5, y: comp.scale.y ?? 0.5, z: comp.scale.z ?? 0.5 };
    }
    if ((type === 'Sphere Collider' || type === 'Sphere Trigger') && comp.radius == null) {
      comp.radius = comp.scale.x ?? comp.scale.y ?? comp.scale.z ?? 0.5;
    }
    if (type === 'Capsule Collider' || type === 'Capsule Trigger') {
      comp.radius = comp.radius ?? comp.scale.x ?? 0.25;
      comp.halfHeight = comp.halfHeight ?? comp.scale.y ?? 0.5;
    }
  }

  _getColliderWorldScale(comp) {
    if (comp.scale) {
      return new THREE.Vector3(
        comp.scale.x ?? 0.5,
        comp.scale.y ?? 0.5,
        comp.scale.z ?? 0.5
      );
    }

    switch (comp.type) {
      case 'Box Collider':
      case 'Box Trigger':
        return new THREE.Vector3(
          comp.halfExtents?.x ?? 0.5,
          comp.halfExtents?.y ?? 0.5,
          comp.halfExtents?.z ?? 0.5
        );
      case 'Sphere Collider':
      case 'Sphere Trigger': {
        const r = comp.radius ?? 0.5;
        return new THREE.Vector3(r, r, r);
      }
      case 'Capsule Collider':
      case 'Capsule Trigger': {
        return new THREE.Vector3(
          comp.radius ?? 0.25,
          comp.halfHeight ?? 0.5,
          comp.radius ?? 0.25
        );
      }
      default:
        return new THREE.Vector3(1, 1, 1);
    }
  }

  _syncColliderProxy(proxy, comp) {
    if (!proxy.userData) proxy.userData = {};
    proxy.userData.physicsComponent = comp;

    const position = this._getColliderLocalPosition(comp);
    proxy.position.set(position.x ?? 0, position.y ?? 0, position.z ?? 0);

    if (comp.rotation) {
      proxy.quaternion.set(
        comp.rotation.x ?? 0,
        comp.rotation.y ?? 0,
        comp.rotation.z ?? 0,
        comp.rotation.w ?? 1
      );
    } else {
      proxy.quaternion.identity();
    }

    const worldScale = this._getColliderWorldScale(comp);
    const parentScale = new THREE.Vector3(1, 1, 1);
    if (proxy.parent) proxy.parent.getWorldScale(parentScale);

    proxy.scale.set(
      worldScale.x / Math.max(Math.abs(parentScale.x), 1e-6),
      worldScale.y / Math.max(Math.abs(parentScale.y), 1e-6),
      worldScale.z / Math.max(Math.abs(parentScale.z), 1e-6)
    );

    let mesh = proxy.children.find((child) => child.userData?._isColliderProxyMesh) || null;
    if (!mesh || !mesh.geometry || !mesh.material) {
        if (mesh && mesh.parent) mesh.parent.remove(mesh);
        mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial({ visible: false }));
      mesh.userData._isColliderProxyMesh = true;
      mesh.userData._editorOnly = true;
        // Make the proxy mesh non-interactive so it doesn't block scene picking
      mesh.visible = false;
      mesh.raycast = () => {};
      proxy.add(mesh);
    } else {
      mesh.userData._editorOnly = true;
    }
  }

}

