/** ProjectManager.js — virtual project filesystem stored in localStorage */

const STORAGE_KEY_RECENTS = 'cyco-recents';
const STORAGE_KEY_PREFIX  = 'cyco-proj-';
const STORAGE_KEY_LEGACY  = 'cyco-project'; // migrated automatically on first load

// Default folder structure for every new project
const DEFAULT_TREE = {
  audio:     {},
  fonts:     {},
  materials: {},
  models:    {},
  scenes:    {},
  scripts:   {},
  textures:  {},
};

const ProjectManager = {
  _project: null,

  /**
   * Call once at startup. Migrates any legacy project data but does NOT
   * auto-open anything — the editor always starts with no project loaded.
   */
  init() {
    this._migrateLegacy();
  },

  /** Return the current project, or null if none is open. */
  getCurrent() {
    return this._project;
  },

  /**
   * Create a new project.
   * @param {string} name         Project name
   * @param {string} location     Display path (stored as metadata — browser can't write to disk)
   * @param {boolean} createFolder Whether to append /name to the path
   */
  create(name, location, createFolder) {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const displayPath = createFolder
      ? `${(location || '/projects').replace(/\\+/g, '/')}/${name}`
      : (location || '/projects').replace(/\\+/g, '/');
    this._project = {
      id,
      name,
      path: displayPath,
      tree: JSON.parse(JSON.stringify(DEFAULT_TREE)),
    };
    this._save();
    this._addToRecents({ id, name, path: displayPath, timestamp: Date.now() });
    document.dispatchEvent(new CustomEvent('cyco-project-change', { detail: { name, path: displayPath } }));
    return this._project;
  },

  /**
   * Re-open a previously created project by its stored id.
   * Returns true on success, false if the project data is not found.
   */
  openById(id) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_PREFIX + id);
      if (!raw) return false;
      this._project = JSON.parse(raw);
      this._touchRecent(id);
      document.dispatchEvent(new CustomEvent('cyco-project-change', {
        detail: { name: this._project.name, path: this._project.path },
      }));
      return true;
    } catch { return false; }
  },

  /** Returns the recent projects list, newest first. */
  getRecentProjects() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY_RECENTS) || '[]'); }
    catch { return []; }
  },

  /** Wipe the recents list. */
  clearRecents() {
    localStorage.removeItem(STORAGE_KEY_RECENTS);
  },

  // ── Tree traversal ────────────────────────────────────────────────────────

  _getNodeAt(pathArray) {
    if (!this._project) return null;
    let node = this._project.tree;
    for (const part of pathArray) {
      if (node == null || typeof node[part] !== 'object') return null;
      node = node[part];
    }
    return node;
  },

  /** Returns a shallow copy of the children of the folder at pathArray */
  getFolderContents(pathArray) {
    return this._getNodeAt(pathArray) || {};
  },

  /** Add a new (empty) subfolder. Returns false if it already exists. */
  addFolder(parentPath, name) {
    const parent = this._getNodeAt(parentPath);
    if (!parent || name in parent) return false;
    parent[name] = {};
    this._save();
    document.dispatchEvent(new CustomEvent('cyco-project-change'));
    return true;
  },

  /** Delete a node (folder or future file). Returns false if not found. */
  deleteNode(pathArray) {
    if (!pathArray.length) return false;
    const parent = this._getNodeAt(pathArray.slice(0, -1));
    const name   = pathArray[pathArray.length - 1];
    if (!parent || !(name in parent)) return false;
    delete parent[name];
    this._save();
    document.dispatchEvent(new CustomEvent('cyco-project-change'));
    return true;
  },

  /** Rename a node. Returns false if source not found or target name taken. */
  renameNode(pathArray, newName) {
    if (!pathArray.length) return false;
    const parent = this._getNodeAt(pathArray.slice(0, -1));
    const name   = pathArray[pathArray.length - 1];
    if (!parent || !(name in parent) || newName in parent) return false;
    parent[newName] = parent[name];
    delete parent[name];
    this._save();
    document.dispatchEvent(new CustomEvent('cyco-project-change'));
    return true;
  },

  _save() {
    if (!this._project) return;
    const key = STORAGE_KEY_PREFIX + (this._project.id || 'default');
    try { localStorage.setItem(key, JSON.stringify(this._project)); } catch { /* quota */ }
  },

  _addToRecents({ id, name, path, timestamp }) {
    const recents = this.getRecentProjects().filter(r => r.id !== id);
    recents.unshift({ id, name, path, timestamp });
    if (recents.length > 10) recents.length = 10;
    localStorage.setItem(STORAGE_KEY_RECENTS, JSON.stringify(recents));
  },

  _touchRecent(id) {
    const recents = this.getRecentProjects();
    const idx = recents.findIndex(r => r.id === id);
    if (idx >= 0) {
      const [item] = recents.splice(idx, 1);
      item.timestamp = Date.now();
      recents.unshift(item);
      localStorage.setItem(STORAGE_KEY_RECENTS, JSON.stringify(recents));
    }
  },

  /** Migrate the old single-project key so it appears in recents. */
  _migrateLegacy() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_LEGACY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data && data.name && !data.id) {
        const id = 'legacy-' + Date.now().toString(36);
        data.id = id;
        localStorage.setItem(STORAGE_KEY_PREFIX + id, JSON.stringify(data));
        this._addToRecents({ id, name: data.name, path: data.path || '', timestamp: Date.now() });
      }
      localStorage.removeItem(STORAGE_KEY_LEGACY);
    } catch {
      localStorage.removeItem(STORAGE_KEY_LEGACY);
    }
  },
};

export default ProjectManager;
