/**
 * SceneManager.js
 * Manages the scene registry, object lifecycle (add/remove/dispose/duplicate),
 * AnimationMixer registry, and scene serialisation.
 *
 * Events dispatched:
 *   cyco-hierarchy-add     { object, parentId }
 *   cyco-hierarchy-remove  { objectId }
 *   cyco-hierarchy-rename  { objectId, name }
 *   cyco-scene-switch      { sceneId }
 *   cyco-scene-dirty       { sceneId }
 *
 * Events consumed:
 *   cyco-vp-ready          { scene } — registers the default scene
 *   cyco-vp-tick           { delta } — advances all AnimationMixers
 */

import * as THREE from 'three';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';

let _nextId = 1;
const uid = () => `obj_${_nextId++}`;

export class SceneManager {
  constructor() {
    /**
     * Map<sceneId, { name:string, scene:THREE.Scene, dirty:boolean, isDefault:boolean }>
     * @type {Map<string, object>}
     */
    this.sceneRegistry = new Map();

    /** The scene currently shown in the viewport. */
    this.activeSceneId = null;

    /**
     * AnimationMixers keyed by Object3D.uuid.
     * @type {Map<string, THREE.AnimationMixer>}
     */
    this.animationMixers = new Map();

    /** Preview material cache: Map<THREE.Object3D, THREE.Material|THREE.Material[]> */
    this._previewCache = new Map();

    this._onVpReady          = this._onVpReady.bind(this);
    this._onTick             = this._onTick.bind(this);
    this._onApplyMaterial    = this._onApplyMaterial.bind(this);
    this._onPreviewMaterial  = this._onPreviewMaterial.bind(this);
    this._onRestoreMaterial  = this._onRestoreMaterial.bind(this);

    window.addEventListener('cyco-vp-ready',          this._onVpReady);
    window.addEventListener('cyco-vp-tick',           this._onTick);
    window.addEventListener('cyco-apply-material',    this._onApplyMaterial);
    window.addEventListener('cyco-preview-material',  this._onPreviewMaterial);
    window.addEventListener('cyco-restore-material',  this._onRestoreMaterial);
  }

  // ─── Scene registry ───────────────────────────────────────────────────────

  /**
   * Register a scene. ViewportEngine calls this for the default scene.
   * @param {string} id
   * @param {THREE.Scene} scene
   * @param {{ name?:string, isDefault?:boolean }} [meta]
   */
  registerScene(id, scene, meta = {}) {
    this.sceneRegistry.set(id, {
      name:      meta.name ?? 'Scene',
      scene,
      dirty:     false,
      isDefault: !!meta.isDefault,
    });
    if (!this.activeSceneId) this.activeSceneId = id;
  }

  getActiveScene() {
    return this.sceneRegistry.get(this.activeSceneId)?.scene ?? null;
  }

  switchScene(id) {
    if (!this.sceneRegistry.has(id)) return;
    this.activeSceneId = id;
    window.dispatchEvent(new CustomEvent('cyco-scene-switch', { detail: { sceneId: id } }));
  }

  addScene(name = 'New Scene') {
    const id    = `scene_${Date.now()}`;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a1a);
    this.registerScene(id, scene, { name });
    // Caller (ViewportEngine) must set up IBL for new scene
    window.dispatchEvent(new CustomEvent('cyco-scene-added', { detail: { sceneId: id, name } }));
    return id;
  }

  renameScene(id, name) {
    const entry = this.sceneRegistry.get(id);
    if (!entry) return;
    entry.name = name;
    window.dispatchEvent(new CustomEvent('cyco-scene-renamed', { detail: { sceneId: id, name } }));
  }

  duplicateScene(id) {
    const entry = this.sceneRegistry.get(id);
    if (!entry) return null;
    const json  = entry.scene.toJSON();
    const clone = new THREE.ObjectLoader().parse(json);
    const newId = `scene_${Date.now()}`;
    this.registerScene(newId, clone, { name: entry.name + ' Copy' });
    return newId;
  }

  disposeScene(id) {
    const entry = this.sceneRegistry.get(id);
    if (!entry) return;
    entry.scene.traverse(child => this._disposeNode(child));
    this.sceneRegistry.delete(id);
    // Switch to another scene if this was active
    if (this.activeSceneId === id) {
      const next = [...this.sceneRegistry.keys()][0] ?? null;
      if (next) this.switchScene(next);
    }
  }

  // ─── Object lifecycle ─────────────────────────────────────────────────────

  /**
   * Add an Object3D to the active scene (or to a specific parent).
   * Assigns a cycoId to userData and fires cyco-hierarchy-add.
   * @param {THREE.Object3D} object
   * @param {THREE.Object3D|null} [parent]  defaults to scene root
   */
  addObject(object, parent = null) {
    if (!object.userData.cycoId) object.userData.cycoId = uid();
    const scene  = this.getActiveScene();
    const target = parent ?? scene;
    if (!target) return;
    target.add(object);
    this._markDirty();
    window.dispatchEvent(new CustomEvent('cyco-hierarchy-add', {
      detail: { object, parentId: parent?.userData.cycoId ?? 'scene_root' }
    }));
  }

  /**
   * Remove object by cycoId from the active scene.
   * @param {string} cycoId
   */
  removeObject(cycoId) {
    const obj = this._findById(cycoId);
    if (!obj) return;
    this._disposeNode(obj);
    obj.parent?.remove(obj);
    this._markDirty();
    window.dispatchEvent(new CustomEvent('cyco-hierarchy-remove', { detail: { objectId: cycoId } }));
  }

  /**
   * Remove an object from the scene WITHOUT disposing its GPU resources.
   * Used by undo/redo so the object can be re-added later.
   */
  removeObjectKeepAlive(cycoId) {
    const obj = this._findById(cycoId);
    if (!obj) return;
    obj.parent?.remove(obj);
    this._markDirty();
    window.dispatchEvent(new CustomEvent('cyco-hierarchy-remove', { detail: { objectId: cycoId } }));
  }

  /**
   * Rename an object and fire the hierarchy event.
   * @param {string} cycoId
   * @param {string} name
   */
  renameObject(cycoId, name) {
    const obj = this._findById(cycoId);
    if (!obj) return;
    obj.name = name;
    this._markDirty();
    window.dispatchEvent(new CustomEvent('cyco-hierarchy-rename', {
      detail: { objectId: cycoId, name }
    }));
  }

  /**
   * Duplicate an object. Uses SkeletonUtils.clone for SkinnedMesh.
   * @param {THREE.Object3D} obj
   * @returns {THREE.Object3D}
   */
  duplicateObject(obj) {
    const clone = obj.isSkinnedMesh ? skeletonClone(obj) : obj.clone();
    // Assign fresh cycoIds to all nodes in the clone tree
    clone.traverse(child => {
      child.userData.cycoId = uid();
    });
    return clone;
  }

  // ─── AnimationMixer registry ──────────────────────────────────────────────

  /**
   * Register an AnimationMixer (called by ObjectFactory after loading animated models).
   * @param {THREE.Object3D} root
   * @param {THREE.AnimationClip[]} clips
   */
  registerAnimations(root, clips) {
    if (!clips || clips.length === 0) return;
    const mixer = new THREE.AnimationMixer(root);
    this.animationMixers.set(root.uuid, mixer);
    return mixer;
  }

  getMixer(objectUuid) {
    return this.animationMixers.get(objectUuid) ?? null;
  }

  // ─── Serialisation ────────────────────────────────────────────────────────

  /**
   * Serialise the active scene to a plain JSON object.
   * For WebGPU NodeMaterials: swap in NodeObjectLoader on the caller side.
   * @returns {object}
   */
  serializeActiveScene() {
    return this.getActiveScene()?.toJSON() ?? null;
  }

  /**
   * Load a serialised scene JSON (from project file or undo snapshot).
   * @param {object} json
   * @returns {THREE.Scene}
   */
  deserializeScene(json) {
    return new THREE.ObjectLoader().parse(json);
  }

  /**
   * Replace the active scene with one loaded from JSON.
   * Fires cyco-hierarchy-add for each root child so the hierarchy panel rebuilds.
   * @param {object} json
   */
  loadSceneFromJSON(json) {
    const entry = this.sceneRegistry.get(this.activeSceneId);
    if (!entry) return;
    // Dispose old objects
    entry.scene.traverse(child => this._disposeNode(child));
    entry.scene.clear();
    // Parse and copy from new scene
    const loaded = new THREE.ObjectLoader().parse(json);
    loaded.children.slice().forEach(child => {
      loaded.remove(child);
      entry.scene.add(child);
    });
    entry.scene.background = loaded.background;
    entry.scene.fog        = loaded.fog;
    entry.dirty = false;
    // Notify hierarchy
    entry.scene.children.forEach(child => {
      window.dispatchEvent(new CustomEvent('cyco-hierarchy-add', {
        detail: { object: child, parentId: 'scene_root' }
      }));
    });
    window.dispatchEvent(new CustomEvent('cyco-scene-loaded', { detail: { sceneId: this.activeSceneId } }));
  }

  // ─── Material events ─────────────────────────────────────────────────────

  _onApplyMaterial(event) {
    const { preset, targetObjects } = event.detail ?? {};
    if (!preset || !targetObjects?.length) return;
    const mat = this._createMaterial(preset);
    for (const obj of targetObjects) {
      if (obj.material) {
        Array.isArray(obj.material)
          ? obj.material.forEach(m => m.dispose?.())
          : obj.material.dispose?.();
      }
      obj.material = mat;
      // Remove from preview cache so a pending mouseleave → restore
      // doesn't overwrite the material we just applied permanently.
      this._previewCache.delete(obj);
      this._markDirty();
    }
  }

  _onPreviewMaterial(event) {
    const { preset, targetObjects } = event.detail ?? {};
    if (!preset || !targetObjects?.length) return;
    const mat = this._createMaterial(preset);
    for (const obj of targetObjects) {
      if (!this._previewCache.has(obj)) {
        this._previewCache.set(obj, obj.material);
      }
      obj.material = mat;
    }
  }

  _onRestoreMaterial() {
    for (const [obj, originalMat] of this._previewCache) {
      obj.material = originalMat;
    }
    this._previewCache.clear();
  }

  _createMaterial(preset) {
    const THREE_TYPES = {
      MeshStandardMaterial: THREE.MeshStandardMaterial,
      MeshPhysicalMaterial: THREE.MeshPhysicalMaterial,
      MeshPhongMaterial:    THREE.MeshPhongMaterial,
      MeshLambertMaterial:  THREE.MeshLambertMaterial,
      MeshToonMaterial:     THREE.MeshToonMaterial,
      MeshBasicMaterial:    THREE.MeshBasicMaterial,
      MeshNormalMaterial:   THREE.MeshNormalMaterial,
      MeshDepthMaterial:    THREE.MeshDepthMaterial,
      MeshMatcapMaterial:   THREE.MeshMatcapMaterial,
      PointsMaterial:       THREE.PointsMaterial,
      ShaderMaterial:       THREE.ShaderMaterial,
    };
    const Ctor = THREE_TYPES[preset.type] ?? THREE.MeshStandardMaterial;
    const params = { ...preset.params };
    for (const key of ['color', 'emissive', 'specular', 'sheenColor']) {
      if (typeof params[key] === 'string' && params[key].startsWith('#')) {
        params[key] = new THREE.Color(params[key]);
      }
    }
    return new Ctor(params);
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  _onVpReady(event) {
    const { scene } = event.detail;
    if (!scene) return;
    this.registerScene('default', scene, { name: 'DefaultScene', isDefault: true });
  }

  _onTick(event) {
    const { delta } = event.detail;
    for (const mixer of this.animationMixers.values()) {
      mixer.update(delta);
    }
  }

  _markDirty() {
    const entry = this.sceneRegistry.get(this.activeSceneId);
    if (!entry || entry.dirty) return;
    entry.dirty = true;
    window.dispatchEvent(new CustomEvent('cyco-scene-dirty', {
      detail: { sceneId: this.activeSceneId }
    }));
  }

  _findById(cycoId) {
    const scene = this.getActiveScene();
    if (!scene) return null;
    let found = null;
    scene.traverse(child => {
      if (!found && child.userData.cycoId === cycoId) found = child;
    });
    return found;
  }

  /** Public alias so UI panels can call sceneManager.findById(id) */
  findById(cycoId) { return this._findById(cycoId); }

  /**
   * Dispose geometry, materials, and textures of a single node (non-recursive).
   * For recursive disposal, call on each node via traverse().
   * @param {THREE.Object3D} child
   */
  _disposeNode(child) {
    child.geometry?.dispose();
    const mats = [child.material].flat();
    mats.forEach(m => {
      if (!m) return;
      Object.values(m).forEach(v => v?.isTexture && v.dispose());
      m.dispose?.();
    });
    // Remove associated AnimationMixer
    if (this.animationMixers.has(child.uuid)) {
      this.animationMixers.get(child.uuid).stopAllAction();
      this.animationMixers.delete(child.uuid);
    }
  }

  dispose() {
    window.removeEventListener('cyco-vp-ready',          this._onVpReady);
    window.removeEventListener('cyco-vp-tick',           this._onTick);
    window.removeEventListener('cyco-apply-material',    this._onApplyMaterial);
    window.removeEventListener('cyco-preview-material',  this._onPreviewMaterial);
    window.removeEventListener('cyco-restore-material',  this._onRestoreMaterial);
  }
}
