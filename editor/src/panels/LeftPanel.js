import * as THREE from 'three';
import { BasePanel } from './BasePanel.js';
import { showHierarchyMenu, OBJECT_DEFAULTS } from '../ui/HierarchyContextMenu.js';

const TYPE_ICON_SVG = {
  scene: `<svg viewBox="0 0 14 14" width="13" height="13" xmlns="http://www.w3.org/2000/svg">
    <rect x="1" y="4" width="12" height="9" rx="1" fill="#5b9bd5"/>
    <rect x="1" y="4" width="12" height="3" fill="#3a78b5"/>
    <line x1="3.5" y1="4" x2="2.5" y2="1.5" stroke="#5b9bd5" stroke-width="1.5" stroke-linecap="round"/>
    <line x1="6.5" y1="4" x2="5.5" y2="1.5" stroke="#5b9bd5" stroke-width="1.5" stroke-linecap="round"/>
    <line x1="9.5" y1="4" x2="8.5" y2="1.5" stroke="#5b9bd5" stroke-width="1.5" stroke-linecap="round"/>
    <line x1="12.5" y1="4" x2="11.5" y2="1.5" stroke="#5b9bd5" stroke-width="1.5" stroke-linecap="round"/>
  </svg>`,

  camera: `<svg viewBox="0 0 14 14" width="13" height="13" xmlns="http://www.w3.org/2000/svg">
    <rect x="1" y="4" width="9" height="7" rx="1" fill="#4ec9b0"/>
    <polygon points="10,5.5 13,4 13,10 10,8.5" fill="#4ec9b0"/>
    <circle cx="5.5" cy="7.5" r="2" fill="#1c3c38" opacity="0.55"/>
    <circle cx="5.5" cy="7.5" r="0.9" fill="#4ec9b0" opacity="0.5"/>
  </svg>`,

  light: `<svg viewBox="0 0 14 14" width="13" height="13" xmlns="http://www.w3.org/2000/svg">
    <circle cx="7" cy="5.5" r="2.8" fill="#f0c040"/>
    <rect x="5.5" y="8.8" width="3" height="1" rx="0.5" fill="#f0c040"/>
    <rect x="6" y="10.2" width="2" height="1.2" rx="0.5" fill="#d4a820"/>
    <line x1="7" y1="1" x2="7" y2="2" stroke="#f0c040" stroke-width="1.2" stroke-linecap="round"/>
    <line x1="10.5" y1="5.5" x2="11.5" y2="5.5" stroke="#f0c040" stroke-width="1.2" stroke-linecap="round"/>
    <line x1="2.5" y1="5.5" x2="3.5" y2="5.5" stroke="#f0c040" stroke-width="1.2" stroke-linecap="round"/>
    <line x1="9.5" y1="2.5" x2="10.2" y2="1.8" stroke="#f0c040" stroke-width="1.2" stroke-linecap="round"/>
    <line x1="4.5" y1="2.5" x2="3.8" y2="1.8" stroke="#f0c040" stroke-width="1.2" stroke-linecap="round"/>
  </svg>`,

  object: `<svg viewBox="0 0 14 14" width="13" height="13" xmlns="http://www.w3.org/2000/svg">
    <rect x="2.5" y="2.5" width="9" height="9" rx="1" stroke="#9e9e9e" stroke-width="1.5" fill="none"/>
    <line x1="2.5" y1="2.5" x2="5.5" y2="5" stroke="#9e9e9e" stroke-width="1"/>
    <line x1="11.5" y1="2.5" x2="8.5" y2="5" stroke="#9e9e9e" stroke-width="1"/>
    <line x1="5.5" y1="5" x2="8.5" y2="5" stroke="#9e9e9e" stroke-width="1"/>
    <line x1="8.5" y1="5" x2="8.5" y2="11.5" stroke="#9e9e9e" stroke-width="0.8" opacity="0.5"/>
    <line x1="5.5" y1="5" x2="5.5" y2="11.5" stroke="#9e9e9e" stroke-width="0.8" opacity="0.5"/>
  </svg>`,

  mesh: `<svg viewBox="0 0 14 14" width="13" height="13" xmlns="http://www.w3.org/2000/svg">
    <polygon points="7,1 12,3.5 12,10 7,12.5 2,10 2,3.5" fill="#e07840"/>
    <polygon points="7,1 12,3.5 7,6 2,3.5" fill="#f09050"/>
    <polygon points="7,6 12,3.5 12,10 7,12.5" fill="#b05820"/>
    <line x1="7" y1="1" x2="7" y2="6" stroke="#fff" stroke-width="0.6" opacity="0.25"/>
    <line x1="2" y1="3.5" x2="7" y2="6" stroke="#fff" stroke-width="0.6" opacity="0.25"/>
    <line x1="12" y1="3.5" x2="7" y2="6" stroke="#fff" stroke-width="0.6" opacity="0.25"/>
  </svg>`,

  sprite: `<svg viewBox="0 0 14 14" width="13" height="13" xmlns="http://www.w3.org/2000/svg">
    <rect x="1.5" y="1.5" width="11" height="11" rx="1.5" fill="#5ba83c"/>
    <path d="M1.5,9.5 L4.5,6.5 L7,9 L9.5,6 L12.5,9.5 L12.5,12.5 L1.5,12.5 Z" fill="#3d7a28"/>
    <circle cx="9.5" cy="4" r="1.8" fill="#f0e060" opacity="0.85"/>
  </svg>`,

  ui: `<svg viewBox="0 0 14 14" width="13" height="13" xmlns="http://www.w3.org/2000/svg">
    <rect x="1" y="1" width="12" height="12" rx="1.5" fill="#9060d0"/>
    <rect x="1" y="1" width="12" height="3.5" rx="1.5" fill="#6a40b0"/>
    <rect x="3" y="6.5" width="5" height="1" rx="0.5" fill="#fff" opacity="0.75"/>
    <rect x="3" y="8.5" width="7" height="1" rx="0.5" fill="#fff" opacity="0.55"/>
    <rect x="3" y="10.5" width="4" height="1" rx="0.5" fill="#fff" opacity="0.55"/>
  </svg>`,
};

const FALLBACK_ICON_SVG = `<svg viewBox="0 0 14 14" width="13" height="13" xmlns="http://www.w3.org/2000/svg">
  <rect x="2" y="2" width="10" height="10" rx="1" fill="#808080"/>
</svg>`;

// IDs that can never be deleted or dragged away
const PROTECTED = new Set(['root']);

export class LeftPanel extends BasePanel {
  constructor() {
    super();
    // Bind listener handlers ONCE so the same function reference can be added
    // and removed across multiple BasePanel.init() calls (dockview layout
    // restore triggers init() more than once on the same instance).
    this._onHierarchyAdd       = this._onHierarchyAdd.bind(this);
    this._onHierarchyRemove   = this._onHierarchyRemove.bind(this);
    this._onAction            = this._onAction.bind(this);
    this._onViewportSelect    = this._onViewportSelect.bind(this);
    this._onSelectionChanged  = this._onSelectionChanged.bind(this);
    this._onDeselectAll       = this._onDeselectAll.bind(this);
    this._onSceneSwitch       = this._onSceneSwitch.bind(this);
    this._onVpReadySyncScene  = () => this._syncSceneLabel();
  }

  _buildContent() {
    // Guard against BasePanel.init() being called twice on the same instance
    // (which happens during layout restore) — second call would double-register
    // window listeners and produce duplicate hierarchy rows on every add.
    if (this._built) {
      // Reuse the existing root wrapper but allow a fresh render.
      return this._root;
    }
    this._built = true;

    // ── instance state ────────────────────────────────────────────────────────
    this._nodes = [
      { id: 'root', pid: null, name: 'Scene', type: 'scene', open: true, locked: false, visible: true },
    ];
    this._selectedIds  = new Set();   // multi-select set
    this._lastClickId  = null;        // most-recently clicked (for rename/add-child)
    this._confirmDelId = null;        // single node id pending X→✓ confirm
    this._dragIds      = [];          // ids currently being dragged
    this._dropInfo     = null;        // { targetId, mode }
    this._groupCounter = 0;
    this._pendingAddPid   = null;        // parent id for the next cyco-hierarchy-add
    this._activeScene     = 'Scene';   // currently active scene name
    this._scenes          = ['Scene']; // list of scene names
    this._pendingDelScene = null;      // scene name pending delete confirm
    // Map from scene name → SceneManager ID (populated when scenes are added via SceneManager)
    this._sceneIdMap      = new Map([['Scene', null]]); // null = use SceneManager.activeSceneId

    // ── root wrapper ──────────────────────────────────────────────────────────
    const wrap = document.createElement('div');
    wrap.className = 'ce-hierarchy';

    // ── search bar (collapsible, sits above scene row) ───────────────────────
    const searchBar = document.createElement('div');
    searchBar.className = 'ce-hier-search-bar';
    const searchInput = document.createElement('input');
    searchInput.className = 'ce-hier-search';
    searchInput.placeholder = 'Search…';
    searchInput.type = 'text';
    searchBar.appendChild(searchInput);
    wrap.appendChild(searchBar);

    // ── scene row: dropdown + search toggle + add button ─────────────────────
    const sceneBar = document.createElement('div');
    sceneBar.className = 'ce-hier-scene-bar';
    _hierSceneDd(sceneBar, this);

    const searchToggleBtn = document.createElement('button');
    searchToggleBtn.className = 'ce-hier-search-toggle';
    searchToggleBtn.title = 'Search hierarchy';
    searchToggleBtn.innerHTML = `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="6.5" cy="6.5" r="4"/><line x1="9.5" y1="9.5" x2="14" y2="14"/></svg>`;
    searchToggleBtn.addEventListener('click', () => {
      const open = searchBar.classList.toggle('open');
      searchToggleBtn.classList.toggle('active', open);
      if (open) { searchInput.focus(); }
      else {
        searchInput.value = '';
        tree.querySelectorAll('.ce-hier-row').forEach(r => r.style.display = '');
      }
    });
    sceneBar.appendChild(searchToggleBtn);

    const addBtn = document.createElement('button');
    addBtn.className = 'ce-hier-add-btn';
    addBtn.textContent = '+';
    addBtn.title = 'Add object';
    sceneBar.appendChild(addBtn);

    wrap.appendChild(sceneBar);

    // ── tree ──────────────────────────────────────────────────────────────────
    const tree = document.createElement('div');
    tree.className = 'ce-hier-tree';
    wrap.appendChild(tree);
    this._tree = tree;

    // + button: open create menu with no target
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._lastClickId = null;
      showHierarchyMenu(e, (action) => this._handleAction(action), false, false, false);
    });

    // live search
    searchInput.addEventListener('input', () => {
      const q = searchInput.value.toLowerCase();
      tree.querySelectorAll('.ce-hier-row').forEach(row => {
        row.style.display = (!q || row.dataset.name.toLowerCase().includes(q)) ? '' : 'none';
      });
    });

    // right-click context menu
    tree.addEventListener('contextmenu', (e) => {
      const row = e.target.closest('.ce-hier-row');
      if (row) {
        const id = row.dataset.id;
        // If right-clicking something outside the current selection, select it alone
        if (!this._selectedIds.has(id)) {
          this._selectedIds.clear();
          this._selectedIds.add(id);
          this._lastClickId = id;
          this._renderTree();
        }
      }
      const isScene = row?.dataset.id === 'root';
      const isMulti = this._selectedIds.size > 1;
      showHierarchyMenu(e, (action) => this._handleAction(action), !!row, isScene, isMulti);
    });

    // click on empty area: clear confirm state
    tree.addEventListener('click', (e) => {
      if (!e.target.closest('.ce-hier-row')) {
        this._confirmDelId = null;
        this._renderTree();
      }
    });

    // drag events delegated to container
    tree.addEventListener('dragover',  (e) => this._onDragOver(e));
    tree.addEventListener('dragleave', (e) => this._onDragLeave(e));
    tree.addEventListener('drop',      (e) => this._onDrop(e));
    tree.addEventListener('dragend',   ()  => this._onDragEnd());

    // ── Sync Three.js scene adds → hierarchy ──────────────────────────────
    window.addEventListener('cyco-hierarchy-add', this._onHierarchyAdd);

    // ── Sync Three.js scene removes → hierarchy ──────────────────────────
    window.addEventListener('cyco-hierarchy-remove', this._onHierarchyRemove);

    // Allow the viewport context menu's "Group Selected" entry to delegate
    // to the hierarchy's group implementation.
    window.addEventListener('cyco-action', this._onAction);

    // ── Sync viewport selection → hierarchy highlight ─────────────────────
    window.addEventListener('cyco-select-node', this._onViewportSelect);
    window.addEventListener('cyco-selection-changed', this._onSelectionChanged);
    window.addEventListener('cyco-deselect-all', this._onDeselectAll);

    // ── Sync external scene changes → hierarchy scene label ───────────────
    window.addEventListener('cyco-scene-switch', this._onSceneSwitch);

    // ── Seed initial scene ID from SceneManager on viewport ready ────────
    window.addEventListener('cyco-vp-ready', this._onVpReadySyncScene);
    // Also try on next frame in case cyco-vp-ready already fired
    requestAnimationFrame(this._onVpReadySyncScene);

    this._renderTree();
    return this._root = wrap;
  }

  _onHierarchyAdd(e) {
    const { object, parentId } = e.detail ?? {};
    if (!object?.userData?.cycoId) return;

    // Idempotent by id (same row added twice).
    const existing = this._nodes.find(n => n.id === object.userData.cycoId);
    if (existing) {
      existing.pid   = parentId ?? existing.pid ?? 'root';
      existing.name  = object.name || existing.name;
      existing.type  = (object.isGroup ? 'group' : existing.type);
      this._selectedIds.clear();
      this._selectedIds.add(existing.id);
      this._lastClickId = existing.id;
      this._renderTree();
      // Make sure the viewport gizmo attaches to the freshly-created group
      window.dispatchEvent(new CustomEvent('cyco-select-node', {
        detail: { object, objects: [object], type: existing.type }
      }));
      return;
    }

    const pid = this._pendingAddPid ?? 'root';
    this._pendingAddPid = null;

    let nodeType = 'object';
    if (object.isLight)                          nodeType = 'light';
    else if (object.isCamera)                    nodeType = 'camera';
    else if (object.isInstancedMesh)             nodeType = 'instanced';
    else if (object.isLOD)                       nodeType = 'lod';
    else if (object.isMesh || object.isLine || object.isPoints) nodeType = 'mesh';
    else if (object.isGroup)                     nodeType = 'group';

    // Layout-restore safety net: drop any pre-existing synthetic row whose
    // name+pid+type matches this one. The pre-existing row was inserted by
    // LeftPanel._group() with a synthetic `'grp-' + Date.now()` id before
    // the live cycoId was known — replace it with the real row.
    const name = object.name || object.type;
    this._nodes = this._nodes.filter(n =>
      !(n.name === name && n.pid === pid && n.type === nodeType && n.id !== object.userData.cycoId)
    );

    this._nodes.push({
      id:      object.userData.cycoId,
      pid,
      name,
      type:    nodeType,
      open:    false,
      locked:  false,
      visible: true,
    });

    // Auto-select the new object
    this._selectedIds.clear();
    this._selectedIds.add(object.userData.cycoId);
    this._lastClickId = object.userData.cycoId;
    this._renderTree();

    window.dispatchEvent(new CustomEvent('cyco-select-node', {
      detail: { object, type: nodeType }
    }));
  }

  _onHierarchyRemove(e) {
    const { objectId } = e.detail ?? {};
    if (!objectId) return;
    this._deleteNodeUI(objectId);
    this._selectedIds.delete(objectId);
    this._renderTree();
  }

  _onAction(e) {
    if (e.detail === 'hierarchy-group') this._group();
  }

  _onViewportSelect(e) {
    const objects = Array.isArray(e.detail?.objects)
      ? e.detail.objects
      : (e.detail?.object ? [e.detail.object] : []);
    // Only sync if at least one of the selected objects is in our nodes
    const cycoIds = objects
      .map(o => o?.userData?.cycoId)
      .filter(id => id && this._nodes.some(n => n.id === id));
    if (cycoIds.length === 0) return;
    this._selectedIds.clear();
    for (const id of cycoIds) this._selectedIds.add(id);
    this._lastClickId = cycoIds[cycoIds.length - 1];
    this._renderTree();
  }

  _onSelectionChanged(e) {
    const objects = Array.isArray(e.detail?.objects) ? e.detail.objects : [];
    const cycoIds = objects
      .map(o => o?.userData?.cycoId)
      .filter(id => id && this._nodes.some(n => n.id === id));
    if (cycoIds.length === 0) {
      this._selectedIds.clear();
      this._renderTree();
      return;
    }
    this._selectedIds.clear();
    for (const id of cycoIds) this._selectedIds.add(id);
    this._lastClickId = cycoIds[cycoIds.length - 1];
    this._renderTree();
  }

  _onDeselectAll() {
    this._selectedIds.clear();
    this._renderTree();
  }

  _onSceneSwitch(e) {
    const { sceneId } = e.detail ?? {};
    if (!sceneId) return;
    // Find scene name by ID in our map
    for (const [name, id] of this._sceneIdMap) {
      if (id === sceneId) {
        this._activeScene = name;
        // Update the scene label if visible — find it in DOM
        const lbl = this._tree?.closest?.('.ce-hierarchy')?.querySelector?.('.ce-hier-scene-label');
        if (lbl) lbl.textContent = name;
        break;
      }
    }
  }

  _syncSceneLabel() {
    const sm = window.__cyco?.sceneManager;
    if (!sm) return;
    const activeId = sm.activeSceneId;
    const activeName = sm.sceneRegistry.get(activeId)?.name ?? 'Scene';
    this._activeScene = activeName;
    this._scenes = [activeName];
    this._sceneIdMap = new Map([[activeName, activeId]]);
    const lbl = this._tree?.closest?.('.ce-hierarchy')?.querySelector?.('.ce-hier-scene-label');
    if (lbl) lbl.textContent = activeName;
  }

  // ── Action → ObjectFactory type mapping ──────────────────────────────────
  static _ACTION_FACTORY_MAP = {
    'empty':        'Empty',
    '3d-cube':      'Box',
    '3d-sphere':    'Sphere',
    '3d-plane':     'Plane',
    '3d-cylinder':  'Cylinder',
    '3d-capsule':   'Capsule',
    '3d-torus':     'Torus',
    'light-dir':    'DirectionalLight',
    'light-point':  'PointLight',
    'light-spot':   'SpotLight',
    'light-area':   'RectAreaLight',
    'camera':       'PerspectiveCamera',
    '2d-sprite':    'Sprite',
  };

  // ── Action handler ────────────────────────────────────────────────────────
  _handleAction(action) {
    if (action === 'rename')    { this._startRename();    return; }
    if (action === 'duplicate') { this._duplicate();      return; }
    if (action === 'delete')    { this._deleteSelected(); return; }
    if (action === 'group')     { this._group();          return; }
    if (action === 'create-prefab') { this._createPrefabFromSelection(); return; }

    const def = OBJECT_DEFAULTS[action];
    if (!def) return;

    const factoryType = LeftPanel._ACTION_FACTORY_MAP[action];
    if (factoryType) {
      // Dispatch to ObjectFactory — cyco-hierarchy-add will sync back the node
      const pid = this._lastClickId ?? 'root';
      const parent = this._nodes.find(n => n.id === pid);
      if (parent) parent.open = true;
      this._pendingAddPid = pid;
      window.dispatchEvent(new CustomEvent('cyco-add-object', {
        detail: { objectType: factoryType, options: {} }
      }));
    }
  }

  _duplicate() {
    const ids = [...this._selectedIds].filter(id => !PROTECTED.has(id));
    if (ids.length === 0) return;
    ids.forEach(id => {
      const src = this._nodes.find(n => n.id === id);
      if (!src) return;
      this._nodes.push({
        ...src,
        id:   Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        name: src.name + ' (Copy)',
      });
    });
    this._renderTree();
  }

  _deleteSelected() {
    const ids = [...this._selectedIds].filter(id => !PROTECTED.has(id));
    if (ids.length === 0) return;
    ids.forEach(id => this._deleteNode(id));
    this._selectedIds.clear();
    this._confirmDelId = null;
    this._renderTree();
  }

  _deleteNode(id) {
    if (!id || PROTECTED.has(id)) return;
    const toDelete = new Set();
    const collect  = (nodeId) => {
      toDelete.add(nodeId);
      this._nodes.filter(n => n.pid === nodeId).forEach(n => collect(n.id));
    };
    collect(id);
    this._nodes = this._nodes.filter(n => !toDelete.has(n.id));
    toDelete.forEach(d => this._selectedIds.delete(d));

    // Deselect if deleted item was selected
    window.dispatchEvent(new CustomEvent('cyco-deselect-all'));

    // Remove objects from Three.js scene
    const sm = window.__cyco?.sceneManager;
    if (sm) {
      toDelete.forEach(cycoId => sm.removeObject(cycoId));
    }
  }

  // UI-only delete (called from cyco-hierarchy-remove to avoid re-entry)
  _deleteNodeUI(id) {
    if (!id || PROTECTED.has(id)) return;
    const toDelete = new Set();
    const collect  = (nodeId) => {
      toDelete.add(nodeId);
      this._nodes.filter(n => n.pid === nodeId).forEach(n => collect(n.id));
    };
    collect(id);
    this._nodes = this._nodes.filter(n => !toDelete.has(n.id));
    toDelete.forEach(d => this._selectedIds.delete(d));
  }

  _createPrefabFromSelection() {
    const sm = window.__cyco?.sceneManager;
    if (!sm) return;
    const ids = [...this._selectedIds].filter(id => !PROTECTED.has(id));
    if (ids.length === 0) return;
    const objects = ids
      .map(id => sm._findById(id))
      .filter(o => o && !o.userData?._isGizmo);
    if (objects.length === 0) return;
    window.dispatchEvent(new CustomEvent('cyco-create-prefab-from-selection', {
      detail: { objects }
    }));
  }

  _group() {
    const ids = [...this._selectedIds].filter(id => !PROTECTED.has(id));
    if (ids.length === 0) return;

    this._groupCounter++;
    const groupName = `Group ${this._groupCounter}`;

    // ── Resolve the actual Three.js objects and their common parent ────────
    const sm = window.__cyco?.sceneManager;
    const cm = window.__cyco?.commandManager;
    const objects = sm
      ? ids.map(id => sm._findById(id)).filter(o => o && !o.userData?._isGizmo)
      : [];

    // ── UI tree bookkeeping ────────────────────────────────────────────────
    // Use the parent of the first selected node as the group's parent
    const firstNode  = this._nodes.find(n => n.id === ids[0]);
    const groupPid   = firstNode?.pid ?? 'root';
    const groupParent = this._nodes.find(n => n.id === groupPid);
    if (groupParent) groupParent.open = true;

    // Only move top-level selected nodes (whose parent is not also selected)
    const selSet   = new Set(ids);
    const topLevel = ids.filter(id => {
      const node = this._nodes.find(n => n.id === id);
      return !selSet.has(node?.pid);
    });

    // ── Create a real Three.js Group and reparent the live scene objects ──
    let createdGroupId = null;
    if (sm && objects.length >= 2) {
      const groupObj = new THREE.Group();
      groupObj.name = groupName;
      groupObj.userData.cycoEmptyRoot = true;
      // Pre-stamp the cycoId so the UI row we insert below can use the same
      // id and the cyco-hierarchy-add listener recognises the row as
      // already-present (idempotent update, not duplicate insert).
      groupObj.userData.cycoId =
        'grp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

      // Use the first object's parent as the new group's parent so the group's
      // world transform matches the cluster's old centre. We capture world
      // transforms first because reparenting otherwise resets to local zero.
      const firstObj = objects[0];
      const targetParent = firstObj.parent ?? sm.getActiveScene?.();
      const worldPos    = new THREE.Vector3();
      const worldQuat   = new THREE.Quaternion();
      const worldScale  = new THREE.Vector3();
      firstObj.getWorldPosition(worldPos);
      firstObj.getWorldQuaternion(worldQuat);
      firstObj.getWorldScale(worldScale);

      // Add the group under the same parent as the cluster so the visible
      // centroid stays put, then re-parent the live children.
      if (targetParent) targetParent.add(groupObj);
      createdGroupId = groupObj.userData.cycoId;

      // Re-parent each live object under the new group, preserving world
      // transform so the visual cluster doesn't shift.
      for (const obj of objects) {
        if (!obj.parent || obj === groupObj) continue;
        const wp = new THREE.Vector3();
        const wq = new THREE.Quaternion();
        const ws = new THREE.Vector3();
        obj.getWorldPosition(wp);
        obj.getWorldQuaternion(wq);
        obj.getWorldScale(ws);
        obj.parent.remove(obj);
        groupObj.add(obj);
        // Restore world transform (now via the group's new transform)
        groupObj.updateMatrixWorld(true);
        const inv = new THREE.Matrix4().copy(groupObj.matrixWorld).invert();
        const m = new THREE.Matrix4().compose(wp, wq, ws);
        m.premultiply(inv);
        m.decompose(obj.position, obj.quaternion, obj.scale);
      }
      // Place the group where the cluster used to live
      groupObj.position.copy(worldPos);
      groupObj.quaternion.copy(worldQuat);
      groupObj.scale.copy(worldScale);
      groupObj.updateMatrixWorld(true);
      sm._markDirty?.();
      // Broadcast AFTER the UI row is inserted so the listener takes the
      // idempotent path (updates an existing row instead of duplicating it).
    }

    // ── Insert the UI node and re-parent UI rows ──────────────────────────
    // Use the real groupId (cycoId of the new Three.js Group) when available
    // so that the cyco-hierarchy-add listener below doesn't insert a duplicate.
    const groupId = createdGroupId ?? ('grp-' + Date.now().toString(36));

    // Insert the UI row immediately (using the real cycoId if we have one),
    // then update existing top-level rows to point at it. The hierarchy-add
    // listener will fire _broadcastHierarchyAdd below and update this row
    // in place (no duplicate).
    const insertIdx = this._nodes.findIndex(n => n.id === topLevel[0]);
    this._nodes.splice(Math.max(0, insertIdx), 0, {
      id:      groupId,
      pid:     groupPid,
      name:    groupName,
      type:    createdGroupId ? 'group' : 'object',
      open:    true,
      locked:  false,
      visible: true,
    });

    // Reparent top-level selected nodes into the group
    topLevel.forEach(id => {
      const node = this._nodes.find(n => n.id === id);
      if (node) node.pid = groupId;
    });

    if (createdGroupId && sm) {
      // Now broadcast — the listener will see the matching id and update
      // the row we just inserted instead of creating a duplicate.
      const groupObj = sm._findById(createdGroupId);
      if (groupObj) sm._broadcastHierarchyAdd(groupObj);
    }

    this._selectedIds.clear();
    this._selectedIds.add(groupId);
    this._lastClickId = groupId;
    this._renderTree();
  }

  _startRename() {
    const id = this._lastClickId;
    if (!id || id === 'root') return;
    const row   = this._tree.querySelector(`.ce-hier-row[data-id="${id}"]`);
    const node  = this._nodes.find(n => n.id === id);
    const label = row?.querySelector('.ce-hier-name');
    if (!row || !node || !label) return;

    const input = document.createElement('input');
    input.className = 'ce-hier-rename-input';
    input.value = node.name;
    label.replaceWith(input);
    input.focus();
    input.select();

    const commit = () => {
      node.name = input.value.trim() || node.name;
      this._renderTree();
    };
    input.addEventListener('blur',    commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter')  { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { this._renderTree(); }
    });
  }

  // ── Drag-and-drop ─────────────────────────────────────────────────────────
  _onDragStart(e, node) {
    if (PROTECTED.has(node.id)) { e.preventDefault(); return; }

    // If dragging a selected node, drag all selected non-protected nodes;
    // otherwise single-select and drag only this node.
    if (this._selectedIds.has(node.id)) {
      this._dragIds = [...this._selectedIds].filter(id => !PROTECTED.has(id));
    } else {
      this._selectedIds.clear();
      this._selectedIds.add(node.id);
      this._lastClickId = node.id;
      this._dragIds = [node.id];
    }

    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', node.id);

    setTimeout(() => {
      this._dragIds.forEach(id => {
        const r = this._tree.querySelector(`.ce-hier-row[data-id="${id}"]`);
        if (r) r.classList.add('is-dragging');
      });
    }, 0);
  }

  _onDragOver(e) {
    if (!this._dragIds.length) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const row = e.target.closest('.ce-hier-row');
    if (!row) return;
    const targetId = row.dataset.id;
    if (this._dragIds.includes(targetId)) return;
    if (this._dragIds.some(id => this._isDescendant(targetId, id))) return;

    const rect = row.getBoundingClientRect();
    const relY  = e.clientY - rect.top;
    const h     = rect.height;
    const mode  = relY < h * 0.28 ? 'before' : relY > h * 0.72 ? 'after' : 'inside';

    const prev = this._dropInfo;
    if (prev && prev.targetId === targetId && prev.mode === mode) return;
    this._dropInfo = { targetId, mode };
    this._applyDropIndicators();
  }

  _onDragLeave(e) {
    if (!this._tree.contains(e.relatedTarget)) {
      this._dropInfo = null;
      this._applyDropIndicators();
    }
  }

  _applyDropIndicators() {
    this._tree.querySelectorAll('.ce-hier-row').forEach(r =>
      r.classList.remove('drop-before', 'drop-after', 'drop-inside'));
    if (!this._dropInfo) return;
    const { targetId, mode } = this._dropInfo;
    const row = this._tree.querySelector(`.ce-hier-row[data-id="${targetId}"]`);
    if (row) row.classList.add(`drop-${mode}`);
  }

  _onDrop(e) {
    e.preventDefault();
    if (!this._dragIds.length || !this._dropInfo) { this._clearDragState(); return; }

    const { targetId, mode } = this._dropInfo;
    const targetNode = this._nodes.find(n => n.id === targetId);
    if (!targetNode) { this._clearDragState(); return; }

    // Find top-level dragged nodes (parent not also being dragged)
    const dragSet  = new Set(this._dragIds);
    const topLevel = this._dragIds.filter(id => {
      const node = this._nodes.find(n => n.id === id);
      return !dragSet.has(node?.pid);
    });

    const collectSubtree = (id) => {
      const n = this._nodes.find(x => x.id === id);
      if (!n) return [];
      return [n, ...this._nodes.filter(x => x.pid === id).flatMap(c => collectSubtree(c.id))];
    };

    const allSubtrees   = topLevel.flatMap(id => collectSubtree(id));
    const allSubtreeIds = new Set(allSubtrees.map(n => n.id));

    this._nodes = this._nodes.filter(n => !allSubtreeIds.has(n.id));
    const tIdx  = this._nodes.findIndex(n => n.id === targetId);

    const newPid = mode === 'inside' ? targetId : targetNode.pid;
    topLevel.forEach(id => {
      const node = allSubtrees.find(n => n.id === id);
      if (node) node.pid = newPid;
    });
    if (mode === 'inside') targetNode.open = true;

    const insertAt = mode === 'before' ? tIdx : tIdx + 1;
    this._nodes.splice(insertAt, 0, ...allSubtrees);

    this._clearDragState();
    this._renderTree();
  }

  _onDragEnd() {
    if (this._dragIds.length) { this._clearDragState(); this._renderTree(); }
  }

  _clearDragState() {
    this._dragIds  = [];
    this._dropInfo = null;
  }

  _isDescendant(nodeId, ancestorId) {
    let cur = this._nodes.find(n => n.id === nodeId);
    while (cur?.pid) {
      if (cur.pid === ancestorId) return true;
      cur = this._nodes.find(n => n.id === cur.pid);
    }
    return false;
  }

  // ── Render ────────────────────────────────────────────────────────────────
  _renderTree() {
    const container = this._tree;
    container.innerHTML = '';

    // De-duplicate nodes. This is a safety net for a layout-restore edge
    // case where the same window listener can be registered twice and a
    // single cyco-hierarchy-add ends up pushing a fallback row AND a real
    // row for the same scene object (different ids because the fallback
    // uses a synthetic `'grp-' + Date.now()` id). Prefer the row whose id
    // matches a live scene object over a synthetic one.
    if (this._nodes.length) {
      const sm = window.__cyco?.sceneManager;
      const liveIds = new Set();
      if (sm) {
        sm.getActiveScene()?.traverse(o => {
          if (o.userData?.cycoId) liveIds.add(o.userData.cycoId);
        });
      }
      const seenId   = new Set();
      const seenKey  = new Map();   // name+pid+type → live row (preferred) or first row
      this._nodes = this._nodes.filter(n => {
        if (!n || !n.id) return false;
        if (seenId.has(n.id)) return false;
        const key = `${n.name}__${n.pid}__${n.type}`;
        const prior = seenKey.get(key);
        if (prior) {
          // Drop the row whose id is NOT in the live scene (the synthetic one).
          if (liveIds.has(n.id) && !liveIds.has(prior.id)) {
            // Replace: filter out prior by id, then keep this
            this._nodes = this._nodes.filter(x => x.id !== prior.id);
            seenId.delete(prior.id);
            seenKey.set(key, n);
            seenId.add(n.id);
            return true;
          }
          return false;
        }
        seenId.add(n.id);
        seenKey.set(key, n);
        return true;
      });
    }

    const nodes   = this._nodes;
    const openSet = new Set(nodes.filter(n => n.open).map(n => n.id));
    const hasCh   = new Set(nodes.filter(n => n.pid !== null).map(n => n.pid));

    const depthOf = (node) => {
      let d = 0, cur = node;
      while (cur.pid !== null) {
        cur = nodes.find(n => n.id === cur.pid);
        if (!cur) break;
        d++;
      }
      return d;
    };

    const isVisible = (node) => {
      let cur = node;
      while (cur.pid !== null) {
        const p = nodes.find(n => n.id === cur.pid);
        if (!p || !openSet.has(p.id)) return false;
        cur = p;
      }
      return true;
    };

    for (const node of nodes) {
      if (!isVisible(node)) continue;

      const isSelected = this._selectedIds.has(node.id);
      const row = document.createElement('div');
      row.className = 'ce-hier-row' +
        (isSelected      ? ' is-selected'  : '') +
        (!node.visible   ? ' is-hidden-obj' : '');
      row.dataset.id   = node.id;
      row.dataset.name = node.name;

      if (!PROTECTED.has(node.id)) {
        row.draggable = true;
        row.addEventListener('dragstart', (e) => this._onDragStart(e, node));
      }

      // ── Checkbox (left side) ─────────────────────────────────────────────
      const cb = document.createElement('span');
      cb.className = 'ce-hier-checkbox' + (isSelected ? ' is-checked' : '');
      cb.setAttribute('role', 'checkbox');
      cb.setAttribute('aria-checked', String(isSelected));
      cb.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this._selectedIds.has(node.id)) {
          this._selectedIds.delete(node.id);
        } else {
          this._selectedIds.add(node.id);
        }
        this._lastClickId  = node.id;
        this._confirmDelId = null;
        this._renderTree();
      });
      row.appendChild(cb);

      // ── Indent ───────────────────────────────────────────────────────────
      const indent = document.createElement('span');
      indent.className = 'ce-hier-indent';
      indent.style.width = `${depthOf(node) * 16}px`;
      row.appendChild(indent);

      // ── Expand/collapse arrow ────────────────────────────────────────────
      const arrow = document.createElement('span');
      const hasC  = hasCh.has(node.id);
      arrow.className = 'ce-hier-arrow' + (hasC ? '' : ' ce-hier-arrow-leaf');
      arrow.textContent = hasC ? (openSet.has(node.id) ? '▾' : '▸') : ' ';
      if (hasC) {
        arrow.addEventListener('click', (e) => {
          e.stopPropagation();
          node.open = !node.open;
          this._renderTree();
        });
      }
      row.appendChild(arrow);

      // ── Type icon ────────────────────────────────────────────────────────
      const icon = document.createElement('span');
      icon.className = 'ce-hier-icon';
      icon.innerHTML = TYPE_ICON_SVG[node.type] ?? FALLBACK_ICON_SVG;
      row.appendChild(icon);

      // ── Name ─────────────────────────────────────────────────────────────
      const label = document.createElement('span');
      label.className = 'ce-hier-name' + (node.locked ? ' is-locked' : '');
      label.textContent = node.name;
      row.appendChild(label);

      // ── Eye (visibility) ─────────────────────────────────────────────────
      const eye = document.createElement('span');
      eye.className = 'ce-hier-btn ce-hier-eye' + (node.visible ? '' : ' is-hidden');
      eye.textContent = node.visible ? '👁' : '🚫';
      eye.title = node.visible ? 'Hide' : 'Show';
      eye.addEventListener('click', (e) => {
        e.stopPropagation();
        node.visible = !node.visible;
        // Sync with Three.js scene object
        const sceneObj = window.__cyco?.sceneManager?.findById?.(node.id);
        if (sceneObj) sceneObj.visible = node.visible;
        this._renderTree();
      });
      row.appendChild(eye);

      if (node.id !== 'root') {
        // ── Lock ───────────────────────────────────────────────────────────
        const lock = document.createElement('span');
        lock.className = 'ce-hier-btn ce-hier-lock' + (node.locked ? ' is-locked' : '');
        lock.textContent = node.locked ? '🔒' : '🔓';
        lock.title = node.locked ? 'Unlock' : 'Lock';
        lock.addEventListener('click', (e) => {
          e.stopPropagation();
          node.locked = !node.locked;
          // Sync with Three.js scene object
          const sceneObj = window.__cyco?.sceneManager?.findById?.(node.id);
          if (sceneObj) {
            sceneObj.userData.cycoLocked = node.locked;
            // If locking a currently selected/gizmo-attached object, detach gizmo
            if (node.locked) {
              window.dispatchEvent(new CustomEvent('cyco-deselect-all'));
            }
          }
          this._renderTree();
        });
        row.appendChild(lock);

        // ── Delete (hidden for protected nodes) ────────────────────────────
        if (!PROTECTED.has(node.id)) {
          const isConfirm = this._confirmDelId === node.id;
          const del = document.createElement('span');
          del.className = 'ce-hier-btn ce-hier-del' + (isConfirm ? ' is-confirm' : '');
          del.textContent = isConfirm ? '✓' : '✕';
          del.title = isConfirm ? 'Confirm delete' : 'Delete';
          del.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this._confirmDelId === node.id) {
              this._deleteNode(node.id);
              this._confirmDelId = null;
              this._renderTree();
            } else {
              this._confirmDelId = node.id;
              this._renderTree();
            }
          });
          row.appendChild(del);
        }
      }

      // ── Row click: Ctrl/Meta for multi, plain for single ─────────────────
      row.addEventListener('click', (e) => {
        if (e.target.closest('.ce-hier-checkbox, .ce-hier-arrow, .ce-hier-btn')) return;

        if (this._confirmDelId && this._confirmDelId !== node.id) {
          this._confirmDelId = null;
        }

        if (e.ctrlKey || e.metaKey) {
          if (this._selectedIds.has(node.id)) {
            this._selectedIds.delete(node.id);
          } else {
            this._selectedIds.add(node.id);
          }
        } else {
          this._selectedIds.clear();
          this._selectedIds.add(node.id);
        }
        this._lastClickId = node.id;
        this._renderTree();

        // Dispatch selection to engine + right panel
        const sm = window.__cyco?.sceneManager;
        if (sm) {
          // Collect all selected three.js objects (skip the synthetic 'root' id)
          const objects = [];
          let lastType = node.type;
          for (const id of this._selectedIds) {
            if (id === 'root') continue;
            const obj = sm._findById(id);
            if (!obj) continue;
            objects.push(obj);
            if (id === node.id) {
              if (obj.isLight)         lastType = 'light';
              else if (obj.isCamera)   lastType = 'camera';
              else if (obj.isMesh || obj.isLine || obj.isPoints) lastType = 'mesh';
            }
          }
          if (objects.length === 0) {
            window.dispatchEvent(new CustomEvent('cyco-deselect-all'));
          } else {
            const last = objects[objects.length - 1];
            window.dispatchEvent(new CustomEvent('cyco-select-node', {
              detail: { object: last, objects, type: lastType }
            }));
          }
        } else if (node.id === 'root') {
          window.dispatchEvent(new CustomEvent('cyco-deselect-all'));
        }
      });

      container.appendChild(row);
    }
  }
}

// ── Scene dropdown helpers ─────────────────────────────────────────────────────

function _hierSceneDd(container, panel) {
  panel._pendingDelScene = null;

  const wrap = document.createElement('div');
  wrap.className = 'ce-vp-dd-wrap ce-hier-scene-dd';

  const btn = document.createElement('button');
  btn.className = 'ce-vp-dd-btn';

  const iconEl = document.createElement('span');
  iconEl.className = 'ce-vp-dd-icon';
  iconEl.innerHTML = `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.3">
    <rect x="2" y="4" width="12" height="9" rx="1"/>
    <path d="M5 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" stroke-linecap="round"/>
    <line x1="5" y1="8" x2="11" y2="8"/>
    <line x1="5" y1="10.5" x2="9" y2="10.5"/>
  </svg>`;

  const labelEl = document.createElement('span');
  labelEl.className = 'ce-vp-dd-label ce-hier-scene-label';
  labelEl.textContent = panel._activeScene;

  const arrow = document.createElement('span');
  arrow.className = 'ce-vp-dd-arrow';
  arrow.textContent = '▾';

  btn.appendChild(iconEl);
  btn.appendChild(labelEl);
  btn.appendChild(arrow);
  wrap.appendChild(btn);

  const dd = document.createElement('div');
  dd.className = 'ce-vp-dropdown';
  wrap.appendChild(dd);
  container.appendChild(wrap);

  // ── Main view: list all scenes ──────────────────────────────────────────────
  function rebuildMain() {
    dd.innerHTML = '';
    panel._pendingDelScene = null;

    panel._scenes.forEach((name, idx) => {
      const row = document.createElement('div');
      row.className = 'ce-vp-dd-row ce-hier-scene-row' + (name === panel._activeScene ? ' selected' : '');

      const radio = document.createElement('span');
      radio.className = 'ce-vp-dd-radio' + (name === panel._activeScene ? ' checked' : '');

      const lbl = document.createElement('span');
      lbl.className = 'ce-hier-scene-name';
      lbl.textContent = name;

      const delBtn = document.createElement('button');
      delBtn.className = 'ce-hier-scene-del';
      delBtn.innerHTML = '&times;';
      delBtn.title = 'Remove scene';

      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (panel._pendingDelScene === name) {
          // Confirmed — delete
          if (panel._scenes.length <= 1) return;
          const sid = panel._sceneIdMap.get(name);
          panel._scenes.splice(panel._scenes.indexOf(name), 1);
          panel._sceneIdMap.delete(name);
          if (panel._activeScene === name) {
            panel._activeScene = panel._scenes[0];
            labelEl.textContent = panel._activeScene;
          }
          // Dispose in SceneManager
          const sm = window.__cyco?.sceneManager;
          if (sm && sid) sm.disposeScene(sid);
          rebuildMain();
        } else {
          // First click — enter pending state
          const prev = dd.querySelector('.ce-hier-scene-del.pending');
          if (prev) { prev.classList.remove('pending'); prev.innerHTML = '&times;'; prev.title = 'Remove scene'; }
          panel._pendingDelScene = name;
          delBtn.classList.add('pending');
          delBtn.innerHTML = '&#10003;';
          delBtn.title = 'Confirm remove';
        }
      });

      row.addEventListener('click', (e) => {
        if (e.target === delBtn) return;
        e.stopPropagation();
        panel._activeScene = name;
        labelEl.textContent = name;
        panel._pendingDelScene = null;
        wrap.classList.remove('open');
        // Switch in SceneManager
        const sm = window.__cyco?.sceneManager;
        const sid = panel._sceneIdMap.get(name);
        if (sm && sid) sm.switchScene(sid);
      });

      row.appendChild(radio);
      row.appendChild(lbl);
      row.appendChild(delBtn);
      dd.appendChild(row);
    });

    const sep = document.createElement('div');
    sep.className = 'ce-vp-dd-sep';
    dd.appendChild(sep);

    const addRow = document.createElement('div');
    addRow.className = 'ce-vp-dd-row ce-vp-dd-action';
    addRow.innerHTML = '<span>+ Add Scene</span>';
    addRow.addEventListener('click', (e) => { e.stopPropagation(); buildAddView(); });
    dd.appendChild(addRow);
  }

  // ── Add-scene sub-view ──────────────────────────────────────────────────────
  function buildAddView() {
    dd.innerHTML = '';
    let activeForm = null;

    const backRow = document.createElement('div');
    backRow.className = 'ce-vp-dd-row ce-hier-scene-back';
    backRow.innerHTML = '<span>‹ Back</span>';
    backRow.addEventListener('click', (e) => { e.stopPropagation(); rebuildMain(); });
    dd.appendChild(backRow);

    const sep = document.createElement('div');
    sep.className = 'ce-vp-dd-sep';
    dd.appendChild(sep);

    // Helper: build the inline name input form
    function makeInlineForm(suggested, onCreate) {
      const form = document.createElement('div');
      form.className = 'ce-hier-scene-inline';

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'ce-hier-scene-input';
      input.value = suggested;
      input.spellcheck = false;

      const btnRow = document.createElement('div');
      btnRow.className = 'ce-hier-scene-inline-btns';

      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'ce-hier-scene-inline-cancel';
      cancelBtn.textContent = 'Cancel';

      const okBtn = document.createElement('button');
      okBtn.className = 'ce-hier-scene-inline-ok';
      okBtn.textContent = 'OK';

      btnRow.appendChild(cancelBtn);
      btnRow.appendChild(okBtn);
      form.appendChild(input);
      form.appendChild(btnRow);

      okBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const name = input.value.trim();
        if (!name) return;
        const final = _uniqueSceneName(panel._scenes, name);
        panel._scenes.push(final);
        panel._activeScene = final;
        labelEl.textContent = final;
        // Add scene in SceneManager and switch to it (onCreate overrides for duplicate)
        const sm = window.__cyco?.sceneManager;
        if (sm) {
          const newId = onCreate ? onCreate(sm, final) : sm.addScene(final);
          panel._sceneIdMap.set(final, newId);
          sm.switchScene(newId);
        }
        wrap.classList.remove('open');
      });

      cancelBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        form.remove();
        activeForm = null;
      });

      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter')  okBtn.click();
        if (e.key === 'Escape') cancelBtn.click();
      });
      input.addEventListener('click', (e) => e.stopPropagation());

      return form;
    }

    function toggleForm(slot, suggested, onCreate) {
      if (activeForm && activeForm.parentNode === slot) {
        activeForm.remove();
        activeForm = null;
        return;
      }
      if (activeForm) { activeForm.remove(); activeForm = null; }
      activeForm = makeInlineForm(suggested, onCreate);
      slot.appendChild(activeForm);
      activeForm.querySelector('.ce-hier-scene-input').select();
    }

    // New scene
    const newRow = document.createElement('div');
    newRow.className = 'ce-vp-dd-row';
    newRow.innerHTML = `<span class="ce-hier-add-icon">&#9633;</span><span>New scene</span>`;
    const newFormSlot = document.createElement('div');
    newRow.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleForm(newFormSlot, `Scene ${panel._scenes.length + 1}`);
    });
    dd.appendChild(newRow);
    dd.appendChild(newFormSlot);

    // Duplicate current
    const dupRow = document.createElement('div');
    dupRow.className = 'ce-vp-dd-row';
    dupRow.innerHTML = `<span class="ce-hier-add-icon">&#10063;</span><span>Duplicate &ldquo;${_esc(panel._activeScene)}&rdquo;</span>`;
    const dupFormSlot = document.createElement('div');
    dupRow.addEventListener('click', (e) => {
      e.stopPropagation();
      const srcId = panel._sceneIdMap.get(panel._activeScene);
      toggleForm(dupFormSlot, `${panel._activeScene} (copy)`, srcId
        ? (sm, finalName) => { const newId = sm.duplicateScene(srcId); if (newId) sm.renameScene(newId, finalName); return newId; }
        : null
      );
    });
    dd.appendChild(dupRow);
    dd.appendChild(dupFormSlot);
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const wasOpen = wrap.classList.contains('open');
    wrap.classList.remove('open');
    if (!wasOpen) { rebuildMain(); wrap.classList.add('open'); }
  });

  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) {
      wrap.classList.remove('open');
      panel._pendingDelScene = null;
    }
  });
}

function _uniqueSceneName(scenes, name) {
  if (!scenes.includes(name)) return name;
  let n = 2;
  while (scenes.includes(`${name} (${n})`)) n++;
  return `${name} (${n})`;
}

function _esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

