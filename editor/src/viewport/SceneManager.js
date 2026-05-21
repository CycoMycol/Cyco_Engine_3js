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

    this._onVpReady = this._onVpReady.bind(this);
    this._onTick    = this._onTick.bind(this);

    window.addEventListener('cyco-vp-ready', this._onVpReady);
    window.addEventListener('cyco-vp-tick',  this._onTick);
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
    window.removeEventListener('cyco-vp-ready', this._onVpReady);
    window.removeEventListener('cyco-vp-tick',  this._onTick);
  }
}
