/** ProjectManager.js — virtual project filesystem plus .cyco project snapshots */

import { EMPTY_GAME_DATA } from '../ui/game-manager/GameDataSchemas.js';
import { loadPrefs, savePrefs } from '../ui/PreferencesWindow.js';
import ProjectDiskStorage from './ProjectDiskStorage.js';
import ProjectLocalBridgeStorage from './ProjectLocalBridgeStorage.js';
import ProjectSaveLog from './ProjectSaveLog.js';

const STORAGE_KEY_RECENTS = 'cyco-recents';
const STORAGE_KEY_PREFIX  = 'cyco-proj-';
const STORAGE_KEY_LEGACY  = 'cyco-project'; // migrated automatically on first load
const PROJECT_FILE_FORMAT = 'cyco-project';
const PROJECT_FILE_VERSION = 1;

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
  _sceneSaveTimer: null,
  _listenersAttached: false,
  _diskWriteSuspended: false,

  _debug(step, payload = {}) {
    ProjectSaveLog.add('ProjectManager', step, payload);
  },

  /**
   * Call once at startup. Migrates any legacy project data but does NOT
   * auto-open anything — the editor always starts with no project loaded.
   */
  init() {
    if (this._listenersAttached) return;
    this._listenersAttached = true;
    this._migrateLegacy();
    window.addEventListener('cyco-scene-dirty', () => this._queueSceneSnapshot());
    window.addEventListener('cyco-scene-loaded', () => this._queueSceneSnapshot());
    window.addEventListener('cyco-preferences-change', () => {
      if (this._project) this._save();
    });
  },

  /** Return the current project, or null if none is open. */
  getCurrent() {
    return this._project;
  },

  /**
   * Create a new project.
   * @param {string}   name          Project name
   * @param {string}   location      Display path
   * @param {boolean}  createFolder  Whether to append /name to the path
   * @param {string[]|null} folders  Custom folder list, or null to use DEFAULT_TREE
   */
  create(name, location, createFolder, folders = null) {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const displayPath = createFolder
      ? `${(location || '/projects').replace(/\\+/g, '/')}/${name}`
      : (location || '/projects').replace(/\\+/g, '/');
    const tree = {};
    const folderList = folders ?? Object.keys(DEFAULT_TREE);
    for (const f of folderList) tree[f] = {};
    this._project = {
      format: PROJECT_FILE_FORMAT,
      version: PROJECT_FILE_VERSION,
      id,
      name,
      path: displayPath,
      tree,
      gameData: JSON.parse(JSON.stringify(EMPTY_GAME_DATA)),
      scene: this._captureSceneSnapshot(),
      prefs: loadPrefs(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      savedAt: Date.now(),
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
      this._project = this._normalizeSnapshot(JSON.parse(raw));
      this._touchRecent(id);
      if (this._project.prefs) savePrefs(this._project.prefs);
      document.dispatchEvent(new CustomEvent('cyco-project-change', {
        detail: { name: this._project.name, path: this._project.path },
      }));
      this._restoreSceneFromSnapshot(this._project.scene);
      return true;
    } catch { return false; }
  },

  /**
   * Save the current project to a .cyco file.
   * Uses the native file picker when available; otherwise downloads a file.
   */
  async saveProjectFile() {
    if (!this._project) return false;
    const snapshot = this._buildSnapshot();
    const filename = this._projectFileName(snapshot);

    if (ProjectDiskStorage.hasTarget()) {
      try {
        await ProjectDiskStorage.writeSnapshot(snapshot);
        return true;
      } catch (err) {
        console.warn('[ProjectManager] Saving to existing project file failed:', err);
      }
    }

    if (typeof window.showSaveFilePicker === 'function') {
      try {
        const fileHandle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [{ description: 'Cyco Project', accept: { 'application/json': ['.cyco'] } }],
        });
        ProjectDiskStorage.attachFile(fileHandle, fileHandle?.name || filename);
        await ProjectDiskStorage.writeSnapshot(snapshot);
        return true;
      } catch (err) {
        if (err?.name === 'AbortError') return false;
        throw new Error(`Could not save the project file: ${err.message || err}`);
      }
    }

    throw new Error('This runtime cannot save project files directly. Use a writable folder or desktop shell.');
  },

  /**
   * Load a project from a .cyco file selected by the user.
   */
  async openProjectFile() {
    const selection = await this._pickProjectFile();
    if (!selection?.file) return false;
    try {
      const { file, handle } = selection;
      ProjectDiskStorage.reset();
      if (handle) ProjectDiskStorage.attachFile(handle, file?.name || null);
      const text = await file.text();
      const parsed = JSON.parse(text);
      return this.loadSnapshot(parsed, { recordRecent: true, applyPrefs: true });
    } catch (err) {
      console.error('[ProjectManager] Failed to open project file:', err);
      alert(`Failed to open project file: ${err.message}`);
      return false;
    }
  },

  /**
   * Replace the in-memory project from a snapshot object.
   * Accepts the current .cyco format and legacy localStorage payloads.
   */
  loadSnapshot(rawSnapshot, { recordRecent = true, applyPrefs = true } = {}) {
    const snapshot = this._normalizeSnapshot(rawSnapshot);
    this._project = snapshot;
    this._save();
    if (applyPrefs && snapshot.prefs) savePrefs(snapshot.prefs);
    if (recordRecent) {
      this._addToRecents({
        id: snapshot.id,
        name: snapshot.name,
        path: snapshot.path,
        timestamp: Date.now(),
      });
    }
    document.dispatchEvent(new CustomEvent('cyco-project-change', {
      detail: { name: snapshot.name, path: snapshot.path },
    }));
    this._restoreSceneFromSnapshot(snapshot.scene);
    return true;
  },

  /**
   * Create a project on disk inside a picked directory handle.
   * This creates the folder structure and writes a .cyco file.
   */
  async createOnDisk(name, location, createFolder, folders = null, directoryHandle = null) {
    this._diskWriteSuspended = true;
    try {
      this._debug('createOnDisk:start', {
        name,
        location,
        createFolder,
        folders,
        handleName: directoryHandle?.name || null,
        hasHandle: !!directoryHandle,
      });
      ProjectDiskStorage.reset();
      const project = this.create(name, location, createFolder, folders);
      const snapshot = this._buildSnapshot();
      this._debug('createOnDisk:project-created', {
        projectName: project.name,
        projectPath: project.path,
        folderNames: Object.keys(project.tree || {}),
      });
      if (ProjectDiskStorage.isDirectoryHandle(directoryHandle)) {
        await ProjectDiskStorage.createProject({
          name,
          rootDirectoryHandle: directoryHandle,
          createFolder,
          tree: project.tree,
          snapshot,
        });
      } else {
        this._debug('createOnDisk:using-local-bridge', {
          location,
          reason: 'No browser directory handle was available.',
        });
        await ProjectLocalBridgeStorage.createProject({
          name,
          location,
          createFolder,
          tree: project.tree,
          snapshot,
        });
      }
      this._debug('createOnDisk:disk-created', {
        projectName: project.name,
        projectPath: project.path,
      });
      return project;
    } finally {
      this._diskWriteSuspended = false;
    }
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

  // ── Game data CRUD ──────────────────────────────────────────────────────────

  /**
   * Returns the records array for a given module + subType.
   * e.g. getGameRecords('inventory', 'items')
   */
  getGameRecords(module, subType) {
    return this._project?.gameData?.[module]?.[subType] ?? [];
  },

  /**
   * Upsert a record by id. Creates if new, replaces if existing.
   * Triggers a save.
   */
  saveGameRecord(module, subType, record) {
    if (!this._project?.gameData?.[module]?.[subType]) return;
    const arr = this._project.gameData[module][subType];
    const idx = arr.findIndex(r => r.id === record.id);
    if (idx >= 0) arr[idx] = record;
    else arr.push(record);
    this._save();
  },

  /**
   * Delete a record by id. Triggers a save.
   */
  deleteGameRecord(module, subType, id) {
    if (!this._project?.gameData?.[module]?.[subType]) return;
    const arr = this._project.gameData[module][subType];
    const idx = arr.findIndex(r => r.id === id);
    if (idx >= 0) { arr.splice(idx, 1); this._save(); }
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
    this._project.scene = this._captureSceneSnapshot();
    this._project.prefs = loadPrefs();
    this._project.updatedAt = Date.now();
    this._project.savedAt = Date.now();
    if (!this._project.format) this._project.format = PROJECT_FILE_FORMAT;
    if (!this._project.version) this._project.version = PROJECT_FILE_VERSION;
    const key = STORAGE_KEY_PREFIX + (this._project.id || 'default');
    try { localStorage.setItem(key, JSON.stringify(this._project)); } catch { /* quota */ }
    this._queueDiskWrite();
  },

  _queueSceneSnapshot() {
    if (!this._project) return;
    if (this._sceneSaveTimer) clearTimeout(this._sceneSaveTimer);
    this._sceneSaveTimer = setTimeout(() => {
      this._sceneSaveTimer = null;
      this._save();
    }, 300);
  },

  _queueDiskWrite() {
    if (!this._project) return;
    if (!ProjectDiskStorage.hasTarget()) return;
    if (this._diskWriteSuspended) return;
    if (this._diskWriteTimer) clearTimeout(this._diskWriteTimer);
    this._diskWriteTimer = setTimeout(() => {
      ProjectDiskStorage.writeSnapshot(this._buildSnapshot()).catch(err => {
        console.warn('[ProjectManager] Failed to write project to disk:', err);
      });
    }, 250);
  },

  _buildSnapshot() {
    const snapshot = this._normalizeSnapshot(this._project || {});
    snapshot.scene = this._captureSceneSnapshot();
    snapshot.prefs = loadPrefs();
    snapshot.updatedAt = Date.now();
    snapshot.savedAt = Date.now();
    return snapshot;
  },

  _normalizeSnapshot(raw) {
    const legacy = raw && raw.project && !raw.tree && !raw.gameData ? raw.project : raw;
    const base = legacy && typeof legacy === 'object' ? legacy : {};
    const id = base.id || `proj-${Date.now().toString(36)}`;
    const name = base.name || 'Untitled Project';
    const path = (base.path || '/projects').replace(/\\+/g, '/');
    const tree = this._clone(base.tree || {});
    const gameData = this._clone(base.gameData || EMPTY_GAME_DATA);
    const scene = base.scene ? this._clone(base.scene) : null;
    const prefs = base.prefs ? this._clone(base.prefs) : null;

    return {
      format: base.format || PROJECT_FILE_FORMAT,
      version: base.version || PROJECT_FILE_VERSION,
      id,
      name,
      path,
      tree,
      gameData,
      scene,
      prefs,
      createdAt: base.createdAt || Date.now(),
      updatedAt: base.updatedAt || Date.now(),
      savedAt: base.savedAt || Date.now(),
    };
  },

  _captureSceneSnapshot() {
    try {
      return this._clone(window.__cyco?.sceneManager?.serializeActiveScene?.() || null);
    } catch {
      return null;
    }
  },

  _restoreSceneFromSnapshot(sceneJson) {
    if (!sceneJson) return;
    try {
      window.__cyco?.sceneManager?.loadSceneFromJSON?.(this._clone(sceneJson));
    } catch (err) {
      console.warn('[ProjectManager] Failed to restore scene snapshot:', err);
    }
  },

  async _pickProjectFile() {
    if (typeof window.showOpenFilePicker === 'function') {
      try {
        const [fileHandle] = await window.showOpenFilePicker({
          multiple: false,
          types: [{ description: 'Cyco Project', accept: { 'application/json': ['.cyco'] } }],
        });
        if (!fileHandle) return null;
        return { file: await fileHandle.getFile(), handle: fileHandle };
      } catch (err) {
        if (err?.name === 'AbortError') return null;
        console.warn('[ProjectManager] showOpenFilePicker failed, falling back to input:', err);
      }
    }

    return await new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.cyco,application/json';
      input.style.display = 'none';
      document.body.appendChild(input);
      input.addEventListener('change', () => {
        const file = input.files?.[0] || null;
        input.remove();
        resolve(file ? { file, handle: null } : null);
      }, { once: true });
      input.click();
    });
  },

  _downloadText(text, filename) {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  _projectFileName(snapshot = this._project) {
    const name = (snapshot?.name || 'project').trim().replace(/[\\/:*?"<>|]+/g, '-');
    return `${name || 'project'}.cyco`;
  },

  _clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
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
