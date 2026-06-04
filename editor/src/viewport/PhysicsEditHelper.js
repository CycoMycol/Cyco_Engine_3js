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

    /** Map: object.uuid → THREE.LineSegments[] (overlay meshes added to scene) */
    this._overlays = new Map();

    this._onEditMode    = this._onEditMode.bind(this);
    this._onRuntimeState = this._onRuntimeState.bind(this);
    this._onSceneSwitch = this._onSceneSwitch.bind(this);

    window.addEventListener('cyco-physics-edit-mode', this._onEditMode);
    window.addEventListener('cyco-runtime-state',     this._onRuntimeState);
    window.addEventListener('cyco-scene-switch',      this._onSceneSwitch);
  }

  dispose() {
    window.removeEventListener('cyco-physics-edit-mode', this._onEditMode);
    window.removeEventListener('cyco-runtime-state',     this._onRuntimeState);
    window.removeEventListener('cyco-scene-switch',      this._onSceneSwitch);
    this._clearAll();
  }

  // ─── Event Handlers ───────────────────────────────────────────────────────

  _onEditMode(e) {
    this._enabled = !!e.detail?.enabled;
    if (this._enabled && !this._playing) {
      this._rebuild();
    } else {
      this._clearAll();
    }
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

  _onSceneSwitch() {
    if (this._enabled && !this._playing) this._rebuild();
  }

  // ─── Build / Clear ────────────────────────────────────────────────────────

  /**
   * Walk the active scene and create wireframe overlays for all physics components.
   */
  _rebuild() {
    this._clearAll();
    const scene = this._engine.scene;
    if (!scene) return;

    scene.traverse((obj) => {
      const comps = obj.userData?.physics?.components;
      if (!Array.isArray(comps) || comps.length === 0) return;
      for (const comp of comps) {
        const lines = this._makeOverlay(comp, obj);
        if (!lines) continue;
        // Attach as child of the object so it moves with it
        obj.add(lines);
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
  }

  // ─── Geometry Helpers ─────────────────────────────────────────────────────

  /**
   * Create a wireframe LineSegments for a single physics component.
   * @param {object} comp
   * @param {THREE.Object3D} obj
   * @returns {THREE.LineSegments|null}
   */
  _makeOverlay(comp, obj) {
    const isTrigger = !!comp.isTrigger;
    const color = isTrigger ? COLORS.trigger : (COLORS[comp.type] ?? 0xffffff);
    const mat   = new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.75 });

    let geo = null;

    switch (comp.type) {
      case 'Box Collider': {
        // Use component override, or derive from geometry bounding box (object-local)
        let hx = 0.5, hy = 0.5, hz = 0.5;
        if (comp.halfExtents) {
          hx = comp.halfExtents.x ?? 0.5;
          hy = comp.halfExtents.y ?? 0.5;
          hz = comp.halfExtents.z ?? 0.5;
        } else if (obj.geometry) {
          obj.geometry.computeBoundingBox();
          const bb = obj.geometry.boundingBox;
          if (bb) {
            hx = (bb.max.x - bb.min.x) * 0.5;
            hy = (bb.max.y - bb.min.y) * 0.5;
            hz = (bb.max.z - bb.min.z) * 0.5;
            // Apply object scale so the wireframe matches the visual mesh
            // (scale is already included in child transform, so local half-extents are correct)
          }
        }
        geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2));
        break;
      }

      case 'Sphere Collider': {
        let r = comp.radius ?? 0.5;
        if (comp.radius == null && obj.geometry) {
          obj.geometry.computeBoundingSphere();
          r = obj.geometry.boundingSphere?.radius ?? 0.5;
        }
        geo = new THREE.EdgesGeometry(new THREE.SphereGeometry(r, 12, 8));
        break;
      }

      case 'Capsule Collider': {
        const hh = comp.halfHeight ?? 0.5;
        const r  = comp.radius     ?? 0.25;
        geo = new THREE.EdgesGeometry(new THREE.CapsuleGeometry(r, hh * 2, 4, 8));
        break;
      }

      case 'Mesh Collider': {
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

    // Apply collider offset if specified
    const lines = new THREE.LineSegments(geo, mat);
    if (comp.offset) {
      lines.position.set(comp.offset.x ?? 0, comp.offset.y ?? 0, comp.offset.z ?? 0);
    }
    lines.name          = `__physics_edit_${comp.type}__`;
    lines.renderOrder   = 998;
    lines.frustumCulled = false;
    // Prevent this overlay from being serialised with the scene
    lines.userData._editorOnly = true;

    return lines;
  }
}
