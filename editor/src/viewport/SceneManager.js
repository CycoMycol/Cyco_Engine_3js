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
import * as THREE_WEBGPU from 'three/webgpu';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import ProjectSaveLog from '../project/ProjectSaveLog.js';

let _nextId = 1;
const uid = () => `obj_${_nextId++}`;

const NODE_MATERIALS = Object.fromEntries(
  Object.entries(THREE_WEBGPU).filter(([name, value]) => name.endsWith('Material') && typeof value === 'function')
);

const NODE_MATERIAL_FALLBACKS = {
  NodeMaterial: 'MeshStandardMaterial',
  MeshBasicNodeMaterial: 'MeshBasicMaterial',
  MeshLambertNodeMaterial: 'MeshLambertMaterial',
  MeshPhongNodeMaterial: 'MeshPhongMaterial',
  MeshStandardNodeMaterial: 'MeshStandardMaterial',
  MeshPhysicalNodeMaterial: 'MeshPhysicalMaterial',
  MeshToonNodeMaterial: 'MeshToonMaterial',
  MeshNormalNodeMaterial: 'MeshNormalMaterial',
  MeshMatcapNodeMaterial: 'MeshMatcapMaterial',
  PointsNodeMaterial: 'PointsMaterial',
  SpriteNodeMaterial: 'SpriteMaterial',
  LineBasicNodeMaterial: 'LineBasicMaterial',
  LineDashedNodeMaterial: 'LineDashedMaterial',
  ShadowNodeMaterial: 'ShadowMaterial',
};

function hasNodeMaterials(json) {
  return !!json?.materials?.some(material => material?.type && (
    material.type in NODE_MATERIALS ||
    material.type in NODE_MATERIAL_FALLBACKS ||
    material.type.endsWith('NodeMaterial')
  ));
}

function makeObjectLoader(json) {
  if (!hasNodeMaterials(json)) return new THREE.ObjectLoader();
  return new THREE_WEBGPU.NodeObjectLoader().setNodeMaterials(NODE_MATERIALS);
}

function cloneJSON(json) {
  return JSON.parse(JSON.stringify(json));
}

function isEditorOnlyObject(obj) {
  if (!obj) return false;
  if (obj.userData?._isGizmo) return true;
  if (obj.userData?._isHelper) return true;
  if (obj.userData?._editorOnly) return true;
  if (obj.name === 'Main Grid') return true;
  if (typeof obj.name === 'string' && obj.name.startsWith('__cyco_')) return true;
  if (obj.type === 'GridHelper' || obj.type === 'AxesHelper') return true;
  return false;
}

function stripEditorOnlyObjects(root) {
  if (!root?.traverse) return root;
  const doomed = [];
  root.traverse((obj) => {
    if (obj !== root && isEditorOnlyObject(obj)) doomed.push(obj);
  });
  for (const obj of doomed) {
    obj.parent?.remove(obj);
  }
  return root;
}

function downgradeNodeMaterials(json) {
  const safe = cloneJSON(json);
  for (const material of safe.materials ?? []) {
    const fallbackType = NODE_MATERIAL_FALLBACKS[material.type] ?? (
      material.type?.endsWith('NodeMaterial') ? 'MeshStandardMaterial' : null
    );
    if (!fallbackType) continue;
    material.type = fallbackType;
    delete material.inputNodes;
    delete material.nodes;
  }
  delete safe.nodes;
  return safe;
}

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
      name:        meta.name ?? 'Scene',
      scene,
      dirty:       false,
      isDefault:   !!meta.isDefault,
      // Physics world settings (edited via Physics World Window)
      physicsMode: meta.physicsMode ?? 'none',
      gravity:     meta.gravity     ?? { x: 0, y: -9.81, z: 0 },
      plane2d:     meta.plane2d     ?? 'xy',
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
    const clone = this._parseSceneJSON(json, 'duplicateScene');
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
    const scene = this.getActiveScene();
    if (!scene) {
      ProjectSaveLog.add('SceneManager', 'serializeActiveScene:skip-no-scene', {
        activeSceneId: this.activeSceneId,
      });
      return null;
    }

    // Make sure every world matrix in the live scene is up to date so the
    // serialised JSON preserves translations, rotations, and scales set via
    // `position.set()` / `quaternion.set()` / `scale.set()` since the last
    // render. Without this, `Object3D.clone()` produces a clone with an
    // identity matrix and the saved file drops the live transforms.
    if (typeof scene.updateWorldMatrix === 'function') {
      scene.updateWorldMatrix(true, true);
    } else if (typeof scene.updateMatrixWorld === 'function') {
      scene.updateMatrixWorld(true);
    }

    // Editor-only helpers (gizmos, grids, contact shadows) are filtered out
    // by `stripEditorOnlyObjects` after the clone. We clone first so the
    // serialized graph cannot mutate the live scene, then re-derive each
    // cloned object's local matrix from its position / quaternion / scale
    // so a translation that the user set via `box.position.set(…)` survives
    // the round trip even if the live object never went through the renderer.
    const cloned = scene.clone(true);
    cloned.traverse((obj) => {
      if (obj.matrixAutoUpdate !== false) obj.updateMatrix();
    });
    const json = stripEditorOnlyObjects(cloned).toJSON();
    const entry = this.sceneRegistry.get(this.activeSceneId);
    if (entry) {
      const meta = {
        physicsMode: entry.physicsMode,
        gravity:     entry.gravity,
        plane2d:     entry.plane2d,
      };
      json.object = json.object || {};
      json.object.userData = json.object.userData || {};
      json.object.userData.physicsSettings = meta;
    }
    ProjectSaveLog.add('SceneManager', 'serializeActiveScene:complete', {
      activeSceneId: this.activeSceneId,
      sceneChildren: scene.children.length,
      jsonChildren: json?.object?.children?.length ?? 0,
      geometries: json?.geometries?.length ?? 0,
      materials: json?.materials?.length ?? 0,
      textures: json?.textures?.length ?? 0,
      images: json?.images?.length ?? 0,
      jsonBytes: (() => {
        try { return JSON.stringify(json).length; }
        catch (_) { return -1; }
      })(),
    });
    return json;
  }

  /**
   * Load a serialised scene JSON (from project file or undo snapshot).
   * @param {object} json
   * @returns {THREE.Scene}
   */
  deserializeScene(json) {
    return this._parseSceneJSON(json, 'deserializeScene');
  }

  _parseSceneJSON(json, context = 'parseSceneJSON') {
    const useNodeLoader = hasNodeMaterials(json);
    try {
      const loader = makeObjectLoader(json);
      const parsed = loader.parse(json);
      ProjectSaveLog.add('SceneManager', `${context}:parsed`, {
        loader: useNodeLoader ? 'NodeObjectLoader' : 'ObjectLoader',
        nodeMaterials: useNodeLoader,
        children: parsed?.children?.length ?? 0,
      });
      return parsed;
    } catch (err) {
      if (!useNodeLoader) throw err;

      ProjectSaveLog.add('SceneManager', `${context}:node-parse-error`, {
        message: err?.message || String(err),
        stack: err?.stack || null,
      });

      const safeJson = downgradeNodeMaterials(json);
      const parsed = new THREE.ObjectLoader().parse(safeJson);
      ProjectSaveLog.add('SceneManager', `${context}:fallback-parsed`, {
        loader: 'ObjectLoader',
        downgradedNodeMaterials: true,
        children: parsed?.children?.length ?? 0,
      });
      return parsed;
    }
  }

  /**
   * Replace the active scene with one loaded from JSON.
   * Fires cyco-hierarchy-add for each root child so the hierarchy panel rebuilds.
   * @param {object} json
   */
  loadSceneFromJSON(json) {
    const entry = this.sceneRegistry.get(this.activeSceneId);
    if (!entry) {
      ProjectSaveLog.add('SceneManager', 'loadSceneFromJSON:skip-no-entry', {
        activeSceneId: this.activeSceneId,
      });
      return;
    }
    ProjectSaveLog.add('SceneManager', 'loadSceneFromJSON:start', {
      activeSceneId: this.activeSceneId,
      currentChildren: entry.scene?.children?.length ?? 0,
      jsonType: json?.object?.type || null,
      jsonChildren: json?.object?.children?.length ?? 0,
      geometries: json?.geometries?.length ?? 0,
      materials: json?.materials?.length ?? 0,
      textures: json?.textures?.length ?? 0,
      images: json?.images?.length ?? 0,
    });
    // Apply persisted scene metadata if present
    const persistedMeta = json?.object?.userData?.physicsSettings;
    if (persistedMeta && typeof persistedMeta === 'object') {
      entry.physicsMode = persistedMeta.physicsMode ?? entry.physicsMode;
      entry.gravity     = persistedMeta.gravity     ?? entry.gravity;
      entry.plane2d     = persistedMeta.plane2d     ?? entry.plane2d;
    }

    window.dispatchEvent(new CustomEvent('cyco-deselect-all'));

    // Dispose old objects
    entry.scene.traverse(child => this._disposeNode(child));
    entry.scene.clear();
    // Parse and copy from new scene
    let loaded;
    try {
      loaded = this._parseSceneJSON(json, 'loadSceneFromJSON');
      ProjectSaveLog.add('SceneManager', 'loadSceneFromJSON:parsed', {
        loadedType: loaded?.type || null,
        loadedChildren: loaded?.children?.length ?? 0,
        background: loaded?.background?.constructor?.name || loaded?.background || null,
        fog: loaded?.fog?.constructor?.name || null,
      });
    } catch (err) {
      ProjectSaveLog.add('SceneManager', 'loadSceneFromJSON:parse-error', {
        message: err?.message || String(err),
        stack: err?.stack || null,
      });
      throw err;
    }
    stripEditorOnlyObjects(loaded);
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
    ProjectSaveLog.add('SceneManager', 'loadSceneFromJSON:complete', {
      activeSceneId: this.activeSceneId,
      finalChildren: entry.scene.children.length,
      background: entry.scene.background?.constructor?.name || entry.scene.background || null,
      fog: entry.scene.fog?.constructor?.name || null,
    });
    window.dispatchEvent(new CustomEvent('cyco-scene-loaded', { detail: { sceneId: this.activeSceneId } }));
  }

  // ─── Material events ─────────────────────────────────────────────────────

  async _onApplyMaterial(event) {
    const { preset, targetObjects } = event.detail ?? {};
    if (!preset || !targetObjects?.length) return;
    const mat = await this._createMaterial(preset);
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

  async _onPreviewMaterial(event) {
    const { preset, targetObjects } = event.detail ?? {};
    if (!preset || !targetObjects?.length) return;
    const mat = await this._createMaterial(preset);
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

  async _createMaterial(preset) {
    // NodeMaterial presets provide an async factory function
    if (typeof preset.factory === 'function') {
      try {
        return await preset.factory();
      } catch (e) {
        console.warn('[SceneManager] NodeMaterial factory failed, using fallback:', e);
        return new THREE.MeshStandardMaterial({ color: '#888888' });
      }
    }
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
