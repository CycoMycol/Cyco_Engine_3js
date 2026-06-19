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

// Module-level registry of currently-active window listeners for the
// LeftPanel. Each LeftPanel instance has its own bound functions
// (bind() returns a new fn reference), so the per-instance `_built` guard
// alone cannot prevent multiple instances — created by dockview layout
// restore (api.fromJSON is called twice during startup: once in initLayout,
// once in LayoutManager.restoreAutoSaved) — from each registering their
// own copy of every listener. Without a global guard, a single
// `cyco-action` dispatch runs _group() once per instance, producing one
// extra Empty per panel instance (the "second group folder" bug).
//
// We track the *current* listener (the most recently added one) per
// (target, type) tuple. When a new instance is about to register a
// listener for an event that already has an active one, we remove the
// old listener from the target so only the new instance handles the
// event. The new instance becomes the active one. This keeps the visible
// (last-rendered) LeftPanel in charge of the editor and prevents both
// the "duplicate listener" symptom and the "new instance silently has
// no listeners" symptom.
const _activeListeners = new Map(); // key = `${target.constructor.name}::${type}` → { handler, target, type }

// Group-flow debug logging. Default ON while the duplicate-folder bug is
// being investigated. To silence: `window.__CYCO_GROUP_DEBUG = false`
// in devtools, then reload.
const _groupDebug = () => (typeof window === 'undefined' || window.__CYCO_GROUP_DEBUG !== false);
function _glog(tag, data) {
  if (!_groupDebug()) return;
  // Serialize inline so the captured log shows the actual fields instead of
  // `[object Object]` (the browser log transport strips the second arg).
  let payload = '';
  if (data !== undefined && data !== null) {
    try { payload = ' ' + JSON.stringify(data, (_k, v) => {
      // Drop Three.js object refs / cycles that would explode the JSON.stringify
      if (v && typeof v === 'object' && v.isObject3D) return `[Obj3D:${v.name || v.type}]`;
      if (typeof v === 'function') return '[fn]';
      if (v instanceof Error)     return v.stack?.split('\n').slice(0, 4).join(' | ');
      return v;
    }); } catch { payload = ' [unserializable]'; }
  }
  // eslint-disable-next-line no-console
  console.log(`[group-debug] ${tag}${payload}`);
}
let _groupCallSeq = 0;
let _leftPanelInstanceSeq = 0;

function _addWindowListener(target, type, handler) {
  // Replace any previously-registered listener for this (target, type)
  // with the new one. This is what makes the most-recently-constructed
  // LeftPanel the sole owner of hierarchy events. Without it, dockview's
  // double-fromJSON startup (initLayout + restoreAutoSaved) would leave
  // two instances both listening, and a single `cyco-action` dispatch
  // would call _group() twice → "second group folder" bug.
  const key = `${target.constructor?.name || 't'}::${type}`;
  const prev = _activeListeners.get(key);
  if (prev && prev.handler === handler) {
    _glog('listener-already-active', { key, handler: handler.name || '(anon)' });
    return;
  }
  if (prev) {
    try { prev.target.removeEventListener(prev.type, prev.handler); } catch {}
    _glog('listener-replaced', { key, prevHandler: prev.handler.name, newHandler: handler.name || '(anon)' });
  }
  target.addEventListener(type, handler);
  _activeListeners.set(key, { handler, target, type });
  _glog('listener-registered', {
    key,
    handler: handler.name || '(anon)',
    totalActive: _activeListeners.size,
    stack: (new Error()).stack?.split('\n').slice(1, 6).join(' | '),
  });
}

export class LeftPanel extends BasePanel {
  constructor() {
    super();
    // Per-instance debug id — lets us tell whether two calls are coming from
    // the same LeftPanel instance or from two different ones (the suspected
    // cause of the duplicate-folder bug when dockview layout restore creates
    // more than one instance).
    this._instanceId = ++_leftPanelInstanceSeq;
    _glog('LeftPanel:new', { instanceId: this._instanceId });
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
    // Parent id for the next cyco-hierarchy-add, set ONLY when the user
    // explicitly right-clicks a row in the hierarchy (or invokes the context
    // menu on a row). Regular left-click selection does NOT set this — adding
    // a new object via the "+" button or the viewport context menu should
    // always place the new object at the scene root unless the user said so.
    this._contextMenuTargetId = null;
    // When true, the next cyco-hierarchy-add skips its auto-select-dispatch.
    // Set by _group() so the new container doesn't briefly attach the green
    // Box Gizmo before _group's own multi-select dispatch takes over.
    this._suppressHierarchyAutoSelect = false;
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
      this._contextMenuTargetId = null;   // explicit: "+" always adds at root
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
        // The hierarchy row the user right-clicked is the target for any
        // "create child" action the menu dispatches. This is the ONLY place
        // that should set _contextMenuTargetId — left-click selection must
        // not influence the parent of a newly created object.
        this._contextMenuTargetId = id;
        // If right-clicking something outside the current selection, select it alone
        if (!this._selectedIds.has(id)) {
          this._selectedIds.clear();
          this._selectedIds.add(id);
          this._lastClickId = id;
          this._renderTree();
        }
      } else {
        // Right-click on empty tree area → add at root.
        this._contextMenuTargetId = null;
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
    _addWindowListener(window, 'cyco-hierarchy-add', this._onHierarchyAdd);

    // ── Sync Three.js scene removes → hierarchy ──────────────────────────
    _addWindowListener(window, 'cyco-hierarchy-remove', this._onHierarchyRemove);

    // Allow the viewport context menu's "Group Selected" entry to delegate
    // to the hierarchy's group implementation.
    _addWindowListener(window, 'cyco-action', this._onAction);

    // ── Sync viewport selection → hierarchy highlight ─────────────────────
    _addWindowListener(window, 'cyco-select-node', this._onViewportSelect);
    _addWindowListener(window, 'cyco-selection-changed', this._onSelectionChanged);
    _addWindowListener(window, 'cyco-deselect-all', this._onDeselectAll);

    // ── Sync external scene changes → hierarchy scene label ───────────────
    _addWindowListener(window, 'cyco-scene-switch', this._onSceneSwitch);

    // ── Seed initial scene ID from SceneManager on viewport ready ────────
    _addWindowListener(window, 'cyco-vp-ready', this._onVpReadySyncScene);
    // Also try on next frame in case cyco-vp-ready already fired
    requestAnimationFrame(this._onVpReadySyncScene);

    this._renderTree();
    return this._root = wrap;
  }

  _onHierarchyAdd(e) {
    const { object, parentId } = e.detail ?? {};
    if (!object?.userData?.cycoId) return;
    _glog('_onHierarchyAdd:enter', {
      cycoId: object.userData.cycoId,
      name: object.name,
      parentId,
      suppressAutoSelect: !!this._suppressHierarchyAutoSelect,
    });

    // When this flag is set the caller (typically _group()) is about to do
    // its own selection step and the auto-select-dispatch below would
    // briefly attach the green Box Gizmo to the new container — that flash
    // is exactly the "second folder" the user reported. We still register
    // the row in _nodes, we just skip the auto-select + gizmo-attach.
    const suppressAutoSelect = !!this._suppressHierarchyAutoSelect;
    if (suppressAutoSelect) this._suppressHierarchyAutoSelect = false;

    // Idempotent by id (same row added twice).
    const existing = this._nodes.find(n => n.id === object.userData.cycoId);
    if (existing) {
      existing.pid   = parentId ?? existing.pid ?? 'root';
      existing.name  = object.name || existing.name;
      existing.type  = (object.isGroup ? 'group' : existing.type);
      if (!suppressAutoSelect) {
        this._selectedIds.clear();
        this._selectedIds.add(existing.id);
        this._lastClickId = existing.id;
        this._renderTree();
        // Make sure the viewport gizmo attaches to the freshly-created group
        window.dispatchEvent(new CustomEvent('cyco-select-node', {
          detail: { object, objects: [object], type: existing.type }
        }));
      }
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

    // No dedup on (name, pid, type): two boxes that share a name should both
    // appear as distinct rows in the hierarchy, identical to how Unity/UE
    // behave. The earlier dedup was a layout-restore safety net for synthetic
    // `grp-…` ids that the old _group() method inserted; that code path is
    // gone, so the dedup is no longer needed and was actively removing
    // legitimate rows.

    const name = object.name || object.type;
    this._nodes.push({
      id:      object.userData.cycoId,
      pid,
      name,
      type:    nodeType,
      open:    false,
      locked:  false,
      visible: true,
    });
    _glog('_onHierarchyAdd:pushed', {
      cycoId: object.userData.cycoId,
      pid,
      nodeType,
      name,
      suppressAutoSelect,
    });

    if (!suppressAutoSelect) {
      // Auto-select the new object
      this._selectedIds.clear();
      this._selectedIds.add(object.userData.cycoId);
      this._lastClickId = object.userData.cycoId;
      this._renderTree();

      window.dispatchEvent(new CustomEvent('cyco-select-node', {
        detail: { object, type: nodeType }
      }));
    }
  }

  _onHierarchyRemove(e) {
    const { objectId } = e.detail ?? {};
    if (!objectId) return;
    this._deleteNodeUI(objectId);
    this._selectedIds.delete(objectId);
    this._renderTree();
  }

  _onAction(e) {
    _glog('_onAction', { detail: e.detail, type: e.type });
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

    const factoryType = LeftPanel._ACTION_FACTORY_MAP[action];
    if (factoryType) {
      // Dispatch to ObjectFactory — cyco-hierarchy-add will sync back the node.
      // The parent is the row the user right-clicked (if any). Selecting a row
      // by left-clicking does NOT make it the parent — only an explicit
      // right-click on a hierarchy row does (handled in the contextmenu
      // listener, which sets _contextMenuTargetId). The parentId is forwarded
      // to ObjectFactory so the LIVE scene graph also reparented (otherwise
      // the UI and the viewport would desync).
      const pid = this._contextMenuTargetId ?? 'root';
      const parent = this._nodes.find(n => n.id === pid);
      if (parent) parent.open = true;
      this._pendingAddPid = pid;
      this._contextMenuTargetId = null;   // one-shot — next add goes to root
      window.dispatchEvent(new CustomEvent('cyco-add-object', {
        detail: { objectType: factoryType, options: {}, parentId: pid === 'root' ? null : pid }
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
    const _callId = ++_groupCallSeq;
    _glog('_group:enter', {
      callId: _callId,
      instanceId: this._instanceId ?? '(no-id)',
      stack: (new Error()).stack?.split('\n').slice(1, 8).join(' | '),
    });
    const ids = [...this._selectedIds].filter(id => !PROTECTED.has(id));
    _glog('_group:enter-selection', { callId: _callId, idsCount: ids.length, ids: [...ids] });
    if (ids.length < 2) { _glog('_group:exit-too-few', { callId: _callId }); return; }

    const sm = window.__cyco?.sceneManager;
    if (!sm) { _glog('_group:exit-no-sm', { callId: _callId }); return; }

    // Only move top-level selected nodes (whose parent is not also selected)
    const selSet   = new Set(ids);
    const topLevel = ids.filter(id => {
      const node = this._nodes.find(n => n.id === id);
      return !selSet.has(node?.pid);
    });
    if (topLevel.length < 2) { _glog('_group:exit-not-toplevel', { callId: _callId, topLevel }); return; }

    // The new Empty's parent is the common parent of the first top-level
    // selected node. If the selected nodes already share a parent we use it
    // directly; otherwise we use the scene root.
    const firstNode  = this._nodes.find(n => n.id === topLevel[0]);
    const groupPid   = firstNode?.pid ?? 'root';
    const groupParentNode = this._nodes.find(n => n.id === groupPid);
    if (groupParentNode) groupParentNode.open = true;

    const firstObj = sm._findById(topLevel[0]);
    if (!firstObj || !firstObj.parent) { _glog('_group:exit-no-firstobj', { callId: _callId }); return; }
    const targetParent = firstObj.parent;
    _glog('_group:targetParent', {
      callId: _callId,
      targetParentId: targetParent.userData?.cycoId,
      targetParentName: targetParent.name,
      topLevel,
    });

    // Resolve the actual Three.js objects we will reparent.
    const objects = topLevel
      .map(id => sm._findById(id))
      .filter(o => o && !o.userData?._isGizmo);
    if (objects.length < 2) { _glog('_group:exit-too-few-objects', { callId: _callId, objectsCount: objects.length }); return; }

    // ── Macro step 1: Create a container (Empty) via the same factory path
    // the right-click "Create Folder" menu uses, so the new node goes through
    // the standard addObject → cyco-hierarchy-add flow and ends up with a
    // normal cycoId and UI row like any other folder. Grouping is just a
    // reparenting operation — the resulting folder can be dragged into / out
    // of any other folder infinitely.
    const factory = window.__cyco?.objectFactory;
    if (!factory) { _glog('_group:exit-no-factory', { callId: _callId }); return; }
    const groupObj = factory.create('Empty');
    if (!groupObj) { _glog('_group:exit-create-null', { callId: _callId }); return; }
    this._groupCounter++;
    groupObj.name = `Group ${this._groupCounter}`;
    _glog('_group:create-empty', {
      callId: _callId,
      groupCounter: this._groupCounter,
      groupName: groupObj.name,
    });

    // Suppress _onHierarchyAdd's auto-select-dispatch — that would briefly
    // attach the green Box Gizmo to the new container (the "second folder"
    // flash) before _group's own multi-select dispatch takes over. We only
    // need the row appended; selection happens in step 4.
    this._suppressHierarchyAutoSelect = true;
    sm.addObject(groupObj, targetParent);
    const groupId = groupObj.userData.cycoId;
    _glog('_group:after-addObject', {
      callId: _callId,
      groupId,
      groupParent: groupObj.parent?.userData?.cycoId,
    });

    // ── Macro step 2: reparent the live Three.js objects under the new
    // Empty, preserving world transforms so the visible cluster stays put.
    for (const obj of objects) {
      if (!obj || obj === groupObj) continue;
      this._reparentPreserveWorld(obj, groupObj);
    }

    // ── Macro step 3: update the UI hierarchy to match the scene graph.
    // The new row was appended at the end by _onHierarchyAdd; move it to the
    // position of the first grouped item, then update the grouped items'
    // pid to point at it. Finally, sync the live scene children order with
    // the UI so the group displays consistently in both views.
    const newRowIdx = this._nodes.findIndex(n => n.id === groupId);
    if (newRowIdx >= 0) {
      const newRow = this._nodes.splice(newRowIdx, 1)[0];
      const firstTopIdx = this._nodes.findIndex(n => n.id === topLevel[0]);
      const insertAt = Math.max(0, firstTopIdx);
      this._nodes.splice(insertAt, 0, newRow);
    }
    for (const id of topLevel) {
      const node = this._nodes.find(n => n.id === id);
      if (node) node.pid = groupId;
    }
    this._syncChildrenOrder(groupObj, groupId);
    sm._markDirty?.();

    // ── Macro step 4: select the grouped children so the viewport shows
    // the same multi-selection outline that a marquee select would (first
    // mesh = primary outline, the rest = secondary outline). We also keep
    // the new Empty selected in the hierarchy so the Properties panel
    // shows its Add-Component UI — but the live selection dispatched to
    // the engine targets the descendant meshes, which is what the user
    // expects to see highlighted. Selecting the Empty itself would draw a
    // green Box Gizmo AABB around the whole cluster (via setFromObject)
    // and a fallback Box3 outline shell — neither matches the marquee
    // multi-select look.
    const descendantIds = this._collectDescendantIds(groupObj, groupId);
    this._selectedIds.clear();
    this._selectedIds.add(groupId);
    for (const id of descendantIds) this._selectedIds.add(id);
    this._lastClickId = groupId;
    this._renderTree();
    _glog('_group:step4-selection', {
      callId: _callId,
      groupId,
      descendantIds,
      selectedCount: this._selectedIds.size,
    });

    const descendantObjects = descendantIds
      .map(id => sm._findById(id))
      .filter(o => o && !o.userData?._isGizmo);
    if (descendantObjects.length >= 2) {
      const first = descendantObjects[0];
      const lastType = first.isLight ? 'light'
        : first.isCamera ? 'camera'
        : (first.isMesh || first.isLine || first.isPoints) ? 'mesh'
        : 'object';
      _glog('_group:dispatch-select', {
        callId: _callId,
        descendantCount: descendantObjects.length,
        type: lastType,
      });
      window.dispatchEvent(new CustomEvent('cyco-select-node', {
        detail: { object: first, objects: descendantObjects, type: lastType }
      }));
    } else {
      // Fallback (group with only one / no mesh descendants) — keep
      // the original Empty-selection behaviour so the Properties panel
      // still targets the new Empty.
      _glog('_group:dispatch-select-fallback', { callId: _callId, descendantCount: descendantObjects.length });
      window.dispatchEvent(new CustomEvent('cyco-select-node', {
        detail: { object: groupObj, type: 'object' }
      }));
    }
    _glog('_group:done', { callId: _callId });
  }

  /**
   * Walk the live Three.js subtree under `root` and return the cycoIds of
   * every selectable descendant — meshes, lines, points, instanced meshes,
   * lights, cameras — in scene-graph (depth-first) order. Skips editor-only
   * helpers and gizmo internals. Used by `_group()` to build the multi-
   * selection set that mirrors the marquee outline behaviour.
   * @param {THREE.Object3D} root
   * @returns {string[]}
   */
  _collectDescendantIds(root, excludeRootId) {
    const ids = [];
    if (!root) return ids;
    root.traverse(obj => {
      if (!obj || obj === root) return;
      if (obj.userData?._isGizmo)      return;
      if (obj.userData?._isHelper)     return;
      if (obj.userData?._editorOnly)   return;
      if (obj.userData?.cycoId === excludeRootId) return;
      const sel = obj.isMesh || obj.isLine || obj.isPoints
        || obj.isInstancedMesh || obj.isBatchedMesh
        || obj.isLight || obj.isCamera;
      if (!sel) return;
      const id = obj.userData?.cycoId;
      if (id && !ids.includes(id)) ids.push(id);
    });
    return ids;
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

    // ── Reparent the live Three.js objects so the scene graph matches the
    //    UI hierarchy. Without this step the viewport would still draw the
    //    objects at their original parent and any subsequent scene sync
    //    would desync from the hierarchy panel. (e.g. dragging a group
    //    into an Empty would visually appear to do nothing.)
    const sm = window.__cyco?.sceneManager;
    if (sm) {
      // Resolve the new Three.js parent: the scene root, or the matching
      // live node for the target.
      const newParent = (newPid === 'root')
        ? sm.getActiveScene()
        : sm._findById(newPid);
      if (newParent) {
        for (const id of topLevel) {
          const obj = sm._findById(id);
          if (!obj || obj === newParent) continue;
          // Skip any descendant of a reparented ancestor (subtree rows are
          // moved along with their top-level ancestor below).
          let cur = obj.parent;
          let alreadyMoving = false;
          while (cur && cur !== newParent) {
            if (allSubtreeIds.has(cur.userData?.cycoId)) { alreadyMoving = true; break; }
            cur = cur.parent;
          }
          if (alreadyMoving) continue;
          this._reparentPreserveWorld(obj, newParent);
        }
        // Re-order children of newParent to match the UI order (so before/after
        // and inside drops both produce a sensible scene-graph child order).
        this._syncChildrenOrder(newParent, newPid);
      }
      sm._markDirty?.();
    }

    this._clearDragState();
    this._renderTree();
  }

  /**
   * Move `obj` to live under `newParent` while keeping its world transform
   * unchanged (so the visual layout does not shift when reparenting).
   */
  _reparentPreserveWorld(obj, newParent) {
    if (!obj || !newParent) return;
    const wp = new THREE.Vector3();
    const wq = new THREE.Quaternion();
    const ws = new THREE.Vector3();
    obj.getWorldPosition(wp);
    obj.getWorldQuaternion(wq);
    obj.getWorldScale(ws);
    if (obj.parent) obj.parent.remove(obj);
    newParent.add(obj);
    if (newParent.isScene) {
      obj.position.copy(wp);
      obj.quaternion.copy(wq);
      obj.scale.copy(ws);
    } else {
      newParent.updateMatrixWorld(true);
      const inv = new THREE.Matrix4().copy(newParent.matrixWorld).invert();
      const m = new THREE.Matrix4().compose(wp, wq, ws);
      m.premultiply(inv);
      m.decompose(obj.position, obj.quaternion, obj.scale);
    }
  }

  /**
   * Reorder the live Three.js children of `parent` so the scene-graph order
   * matches the UI `_nodes` order under the same parent. Called after a
   * drag-drop reparent so before/after/inside drops all produce a consistent
   * scene-graph layout that mirrors the hierarchy panel.
   */
  _syncChildrenOrder(parent, parentUiId) {
    if (!parent) return;
    // Gather UI nodes that are direct children of parentUiId, in UI order.
    const uiChildIds = this._nodes
      .filter(n => n.pid === parentUiId)
      .map(n => n.id);
    // Map each id to its live Three.js object.
    const sm = window.__cyco?.sceneManager;
    if (!sm) return;
    // Re-insert into parent.children in the UI order. Children that are not
    // represented in the UI (e.g. editor-only helpers) are appended at the end.
    const uiSet   = new Set(uiChildIds);
    const ordered = [];
    for (const id of uiChildIds) {
      const o = sm._findById(id);
      if (o) ordered.push(o);
    }
    // Keep the rest of the live children that are not in the UI (helpers etc.).
    for (const c of parent.children) {
      if (!uiSet.has(c.userData?.cycoId)) ordered.push(c);
    }
    // Splice back into parent.children in order. Assigning a new array on
    // Object3D would break internal invariants, so we clear + push.
    parent.children.length = 0;
    for (const c of ordered) parent.children.push(c);
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

    // Drop orphan rows whose id is no longer present in the live scene.
    // This is the only safe dedup step: a row that points at a non-existent
    // Three.js object is a stale row, and keeping it would let the user
    // drag it around (creating a real object on drop that the user did not
    // intend) or, conversely, attempt operations on a non-existent node.
    if (this._nodes.length) {
      const sm = window.__cyco?.sceneManager;
      if (sm) {
        const liveIds = new Set();
        sm.getActiveScene()?.traverse(o => {
          if (o.userData?.cycoId) liveIds.add(o.userData.cycoId);
        });
        this._nodes = this._nodes.filter(n => {
          if (n.id === 'root') return true;
          return liveIds.has(n.id);
        });
      }
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
      indent.style.width = `${depthOf(node) * 10}px`;
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
            // If the user clicked a container row (Group / Empty / LOD /
            // Prefab root) and it has selectable mesh / light / camera
            // descendants, expand the selection to those descendants so
            // the viewport shows the same multi-select outline look as
            // a marquee selection — the FIRST descendant gets the
            // primary outline colour, the rest get the secondary colour.
            // Without this expansion, clicking a Group would dispatch a
            // single-object selection of the (mesh-less) container and
            // the Box Gizmo would draw a green wireframe AABB around the
            // whole cluster via setFromObject(target), which is the wrong
            // visual feedback.
            let dispatchedObjects = objects;
            const lastClicked = objects[objects.length - 1];
            // Expand the selection to a container's selectable descendants for
            // ANY non-mesh folder-like row (Empty / Group / LOD / Prefab
            // root). Without this expansion, clicking a folder would
            // dispatch a single-object selection of the (mesh-less)
            // container and the Box Gizmo would draw a wireframe AABB
            // around the whole cluster — the user wants the same
            // marquee-multi-select outline look instead.
            const isContainer = lastClicked && (
              lastClicked.isGroup || lastClicked.isLOD
              || lastClicked.type === 'Object3D' || lastClicked.type === 'Group'
              || lastClicked.userData?.cycoPrefabSource
              || lastClicked.userData?.cycoEmptyRoot
            );
            if (isContainer
                && !(lastClicked.isMesh || lastClicked.isLight || lastClicked.isCamera)) {
              const expandedIds = this._collectDescendantIds(lastClicked, lastClicked.userData?.cycoId);
              const expanded = expandedIds
                .map(id => sm._findById(id))
                .filter(o => o && !o.userData?._isGizmo);
              if (expanded.length >= 2) {
                dispatchedObjects = expanded;
                const first = expanded[0];
                if (first.isLight)         lastType = 'light';
                else if (first.isCamera)   lastType = 'camera';
                else if (first.isMesh || first.isLine || first.isPoints) lastType = 'mesh';
              }
            }
            const dispatchLast = dispatchedObjects[dispatchedObjects.length - 1];
            window.dispatchEvent(new CustomEvent('cyco-select-node', {
              detail: { object: dispatchLast, objects: dispatchedObjects, type: lastType }
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

