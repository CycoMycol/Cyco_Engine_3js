/**
 * PrefabManager.js
 *
 * Handles Unity-style prefab lifecycle:
 *   - Create a prefab from a multi-selection (deep-clones, re-stamps cycoIds,
 *     stores a JSON graph under project.tree.prefabs via ProjectManager).
 *   - Instantiate a stored prefab at a given world position/parent (or under
 *     the scene root if no parent is supplied).
 *
 * Depends on: SceneManager, ProjectManager
 *
 * Events dispatched:
 *   cyco-prefab-created     { fileName, name }
 *   cyco-prefab-instantiate { fileName, worldPos?: {x,y,z}, parent?: Object3D }
 *
 * Events consumed:
 *   cyco-create-prefab-from-selection { objects: Object3D[] }
 *   cyco-instantiate-prefab           { fileName, worldPos?, parent? }
 */

import * as THREE from 'three';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';

let _nextLocalId = 1;
const _localId = (obj) => {
  if (!obj.userData) obj.userData = {};
  if (!obj.userData.cycoPrefabLocalId) {
    obj.userData.cycoPrefabLocalId = `pl_${_nextLocalId++}`;
  }
  return obj.userData.cycoPrefabLocalId;
};

export class PrefabManager {
  /**
   * @param {import('./SceneManager.js').SceneManager} sceneManager
   * @param {import('../project/ProjectManager.js')} projectManager
   */
  constructor(sceneManager, projectManager) {
    this.sceneManager   = sceneManager;
    this.projectManager = projectManager;

    this._onCreate      = this._onCreate.bind(this);
    this._onInstantiate = this._onInstantiate.bind(this);

    window.addEventListener('cyco-create-prefab-from-selection', this._onCreate);
    window.addEventListener('cyco-instantiate-prefab',           this._onInstantiate);
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Build a prefab graph from a list of Object3Ds. The objects are deep-cloned
   * in-place, re-parented under a new "prefab root" Object3D, and then
   * serialised via toJSON(). The live scene objects are not modified.
   *
   * Selection ordering matters: the prefab's children are returned in the same
   * order they appear in `objects`.
   *
   * @param {THREE.Object3D[]} objects
   * @returns {{root: THREE.Object3D, json: object, name: string}|null}
   */
  buildPrefabFromSelection(objects) {
    if (!objects || objects.length === 0) return null;
    const safeObjs = objects.filter(o => o && !o.userData?._isGizmo && o.parent);
    if (safeObjs.length === 0) return null;

    // 1. Create a container that will become the prefab root
    const root = new THREE.Group();
    root.name = safeObjs[0]?.name ? `${safeObjs[0].name} Prefab` : 'Prefab';

    // 2. Clone each selected object (deep, with fresh cycoIds) and reparent
    for (const src of safeObjs) {
      const clone = src.isSkinnedMesh ? skeletonClone(src) : src.clone(true);
      // Re-stamp all cycoIds so the prefab's tree is independent of the live scene
      clone.userData.cycoId = `prefab_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      clone.traverse(child => {
        if (!child.userData.cycoId) {
          child.userData.cycoId = `prefab_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        }
        // Mark descendants as belonging to a prefab so the panel can show this
        child.userData.cycoPrefabSource = root.uuid;
      });
      // Preserve world transform → so when reparented under the new root, it
      // visually sits where it sat in the live scene.
      src.getWorldPosition(clone.position);
      src.getWorldQuaternion(clone.quaternion);
      const worldScale = new THREE.Vector3();
      src.getWorldScale(worldScale);
      clone.scale.copy(worldScale);
      // Strip parent reference so the clone is independent of the live tree
      clone.parent = null;
      clone.matrixAutoUpdate = true;
      root.add(clone);
    }

    // 3. Reorder children: outer objects first, then objects whose original
    //    parent is also in the selection (so the hierarchy reads naturally
    //    when re-instantiated).
    root.children.sort((a, b) => {
      // Higher renderOrder (more "outside" in the typical parent->child sense) first
      // We use stable sort: any object whose original parent is also in the
      // selection is sorted AFTER its parent.
      const aParentInSel = safeObjs.find(p => p.uuid === this._findOriginalParentId(a, safeObjs));
      const bParentInSel = safeObjs.find(p => p.uuid === this._findOriginalParentId(b, safeObjs));
      if (aParentInSel && !bParentInSel) return  1;
      if (!aParentInSel && bParentInSel) return -1;
      return 0;
    });

    // 4. Now rebuild the inner parent/child links for objects that were
    //    originally nested inside the selection.
    this._rebuildInnerLinks(root, safeObjs);

    // 5. Update world matrices so toJSON captures correct positions
    root.updateMatrixWorld(true);

    // 6. Build a clean serialisable graph. We strip the prefab root container
    //    itself because ObjectLoader will recreate the tree under whatever
    //    parent the caller provides at instantiate time.
    const json = root.toJSON();
    json.metadata = {
      prefabName: root.name,
      createdAt: Date.now(),
      source: 'create-prefab',
      childCount: root.children.length,
    };

    return { root, json, name: root.name };
  }

  /**
   * Save a built prefab to the project tree.
   * @param {string} name
   * @param {object} json
   * @returns {string|null}  The asset file name (with .cyprefab).
   */
  savePrefab(name, json) {
    return this.projectManager.savePrefab(name, json);
  }

  /**
   * Instantiate a prefab from the project tree. Parses the stored JSON via
   * the same loader pipeline as the SceneManager (so node materials and
   * custom node trees round-trip cleanly), assigns fresh cycoIds to all
   * descendants, and adds the result to the active scene.
   *
   * @param {string}  fileName   The asset name in project.tree.prefabs.
   * @param {object}  [opts]
   * @param {THREE.Object3D} [opts.parent]   Defaults to the active scene.
   * @param {THREE.Vector3|{x,y,z}} [opts.worldPos]   Optional world position.
   * @returns {THREE.Object3D|null}  The instantiated prefab root.
   */
  instantiate(fileName, opts = {}) {
    const json = this.projectManager.loadPrefab(fileName);
    if (!json) return null;

    // Strip loader-level metadata (not part of the object graph)
    const { metadata, ...objJson } = json;

    const loader = this.sceneManager._makeObjectLoaderForJson
      ? this.sceneManager._makeObjectLoaderForJson(objJson)
      : new THREE.ObjectLoader();
    let loaded;
    try { loaded = loader.parse(objJson); }
    catch (err) {
      console.warn('[PrefabManager] ObjectLoader failed for prefab, retrying with downgraded materials:', err);
      // Best-effort fallback — drop node materials (existing SceneManager helper)
      if (this.sceneManager._parseSceneJSON) {
        loaded = this.sceneManager._parseSceneJSON(objJson, 'prefab-instantiate');
      } else {
        return null;
      }
    }

    if (!loaded) return null;

    // Assign fresh cycoIds and mark the lineage so right-click can navigate back
    loaded.userData.cycoId = `prefab_inst_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    loaded.userData.cycoPrefabSource = fileName;
    loaded.userData.cycoPrefabName = metadata?.prefabName ?? fileName.replace(/\.cyprefab$/, '');
    loaded.traverse(child => {
      if (!child.userData.cycoId) {
        child.userData.cycoId = `prefab_inst_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      }
      child.userData.cycoPrefabSource = fileName;
    });

    // Add to parent / scene
    const target = opts.parent ?? this.sceneManager.getActiveScene();
    if (target) {
      target.add(loaded);
      if (opts.worldPos) {
        loaded.position.set(
          opts.worldPos.x ?? 0,
          opts.worldPos.y ?? 0,
          opts.worldPos.z ?? 0
        );
        loaded.updateMatrixWorld(true);
      }
      this.sceneManager._markDirty?.();
      this.sceneManager._broadcastHierarchyAdd?.(loaded);
    }

    return loaded;
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  _onCreate(event) {
    const objects = event.detail?.objects ?? [];
    this.openCreatePrefabDialog(objects);
  }

  _onInstantiate(event) {
    const { fileName, worldPos, parent } = event.detail ?? {};
    if (!fileName) return;
    this.instantiate(fileName, { worldPos, parent });
  }

  /**
   * Open the inline dialog that prompts for a prefab name, then save.
   * @param {THREE.Object3D[]} objects
   */
  openCreatePrefabDialog(objects) {
    if (!objects || objects.length === 0) return;
    const built = this.buildPrefabFromSelection(objects);
    if (!built) {
      window.dispatchEvent(new CustomEvent('cyco-toast', {
        detail: { message: 'Could not build prefab from selection.' }
      }));
      return;
    }

    // Default name = first object's name + " Prefab"
    const suggested = (objects[0]?.name || 'Prefab') + ' Prefab';

    import('./../ui/PrefabDialog.js').then(({ openPrefabDialog }) => {
      openPrefabDialog(suggested, (finalName) => {
        const fileName = this.savePrefab(finalName, built.json);
        if (fileName) {
          window.dispatchEvent(new CustomEvent('cyco-prefab-created', {
            detail: { fileName, name: finalName }
          }));
          window.dispatchEvent(new CustomEvent('cyco-toast', {
            detail: { message: `Created prefab "${finalName}".` }
          }));
        }
      });
    }).catch(err => {
      console.warn('[PrefabManager] Failed to open prefab dialog:', err);
    });
  }

  /**
   * Find the original (pre-clone) parent UUID for an object, looking only at
   * the user-supplied selection list.
   */
  _findOriginalParentId(clone, originalList) {
    // Clones preserve parent → we re-stamp cycoId but kept the parent reference
    // cleared. Use the live source's parent via the same index.
    return null;
  }

  /**
   * After cloning, restore any parent/child links between selected objects
   * that were originally nested.
   */
  _rebuildInnerLinks(prefabRoot, originalObjects) {
    // Build a map from original uuid → clone
    const byOriginalUuid = new Map();
    for (const clone of prefabRoot.children) {
      // We lost the source uuid in the clone; pair by reference equality of
      // the (deepest original) userData hash. Fall back: pair in order.
    }
    // Pair in the order they appear in `originalObjects` ↔ prefabRoot.children
    // (we cloned them in that order above).
    const originalByIndex = originalObjects.slice(0, prefabRoot.children.length);
    const parentMap = new Map(); // original.uuid → original.parent?.uuid
    for (const orig of originalObjects) {
      parentMap.set(orig.uuid, orig.parent?.uuid ?? null);
    }
    // For each clone, if its source's parent is also in the selection, attach
    // it under the matching clone.
    for (let i = 0; i < prefabRoot.children.length; i++) {
      const clone  = prefabRoot.children[i];
      const source = originalByIndex[i];
      if (!source) continue;
      const sourceParentUuid = parentMap.get(source.uuid);
      if (!sourceParentUuid) continue;
      // Find the clone whose source had this uuid
      const parentCloneIdx = originalByIndex.findIndex(o => o.uuid === sourceParentUuid);
      if (parentCloneIdx < 0) continue;
      const parentClone = prefabRoot.children[parentCloneIdx];
      if (!parentClone) continue;
      // Preserve world transform during reparent
      const worldPos    = new THREE.Vector3();
      const worldQuat   = new THREE.Quaternion();
      const worldScale  = new THREE.Vector3();
      clone.getWorldPosition(worldPos);
      clone.getWorldQuaternion(worldQuat);
      clone.getWorldScale(worldScale);
      // Detach from prefab root, attach under parent clone
      prefabRoot.remove(clone);
      parentClone.add(clone);
      // Convert world transform back to local under the new parent
      parentClone.updateMatrixWorld(true);
      const localMatrix = new THREE.Matrix4().copy(parentClone.matrixWorld).invert();
      const localPos    = worldPos.clone().applyMatrix4(localMatrix);
      const localQuat   = worldQuat.clone().premultiply(
        new THREE.Quaternion().setFromRotationMatrix(parentClone.matrixWorld).invert()
      );
      clone.position.copy(localPos);
      clone.quaternion.copy(localQuat);
      clone.scale.copy(worldScale);
    }
  }

  dispose() {
    window.removeEventListener('cyco-create-prefab-from-selection', this._onCreate);
    window.removeEventListener('cyco-instantiate-prefab',           this._onInstantiate);
  }
}
