/** ProjectManager.js - browser-native project files for Cyco Engine */

import { EMPTY_GAME_DATA } from '../ui/game-manager/GameDataSchemas.js';
import { loadPrefs, savePrefs } from '../ui/PreferencesWindow.js';
import ProjectSaveLog from './ProjectSaveLog.js';

const STORAGE_KEY_RECENTS = 'cyco-recents';
const STORAGE_KEY_PREFIX  = 'cyco-proj-';
const STORAGE_KEY_LEGACY  = 'cyco-project';
const HANDLE_DB_NAME = 'cyco-project-handles';
const HANDLE_STORE_NAME = 'handles';
const PROJECT_FILE_FORMAT = 'cyco-project';
const PROJECT_FILE_VERSION = 2;
const ENGINE_FOLDER_NAME = 'engine';
const ENGINE_STATE_FILE = 'cyco-engine.json';

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function sanitizeName(name) {
  const safe = String(name || 'project').trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ');
  return safe || 'project';
}

function makeFileRecord(name, path, { type = 'file', mimeType = '', size = 0, data = null, metadata = {} } = {}) {
  const now = Date.now();
  return {
    _cycoType: 'file',
    id: `asset-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    path,
    type,
    mimeType,
    size,
    data,
    metadata,
    createdAt: now,
    updatedAt: now,
  };
}

function isFileNode(node) {
  return !!node && typeof node === 'object' && node._cycoType === 'file';
}

const DEFAULT_TREE = {
  audio:     {},
  engine:    {
    [ENGINE_STATE_FILE]: makeFileRecord(ENGINE_STATE_FILE, `/${ENGINE_FOLDER_NAME}/${ENGINE_STATE_FILE}`, {
      type: 'engine-state',
      mimeType: 'application/json',
    }),
  },
  fonts:     {},
  materials: {},
  models:    {},
  prefabs:   {},
  scenes:    {},
  scripts:   {},
  textures:  {},
};

const ProjectManager = {
  _project: null,
  _fileHandle: null,
  _projectDirHandle: null,
  _rootDirectoryHandle: null,
  _fileName: null,
  _listenersAttached: false,
  _sceneSaveTimer: null,
  _diskWriteTimer: null,
  _diskWriteSuspended: false,

  _debug(step, payload = {}) {
    ProjectSaveLog.add('ProjectManager', step, payload);
  },

  init() {
    if (this._listenersAttached) return;
    this._listenersAttached = true;
    this._migrateLegacy();
    window.addEventListener('cyco-scene-dirty', () => this._queueProjectSnapshot());
    window.addEventListener('cyco-scene-loaded', () => this._queueProjectSnapshot());
    window.addEventListener('cyco-preferences-change', () => {
      if (this._project) this._saveLocalAndQueueDisk();
    });
  },

  getCurrent() {
    return this._project;
  },

  async createOnDisk(name, location, createFolder, folders = null, directoryHandle = null, fileHandle = null) {
    if (this._isFileHandle(fileHandle)) {
      return this._createWithFileHandle(name, location, folders, fileHandle);
    }
    if (!this._isDirectoryHandle(directoryHandle)) {
      return this._createBrowserStorageProject(name, location, createFolder, folders, 'no-writable-directory');
    }
    return this._createWithDirectoryHandle(name, location, createFolder, folders, directoryHandle);
  },

  async _createWithFileHandle(name, location, folders = null, fileHandle = null) {
    if (!this._isFileHandle(fileHandle)) {
      throw new Error('Choose a project file with Browse before creating the project.');
    }

    const safeName = sanitizeName(name);
    this._debug('create:file-handle:start', {
      name: safeName,
      location: String(location || '').trim(),
      handleName: fileHandle?.name || null,
      handleType: fileHandle?.constructor?.name || typeof fileHandle,
    });

    this._fileHandle = fileHandle;
    this._fileName = fileHandle.name || `${safeName}.cyco`;
    this._projectDirHandle = null;
    this._rootDirectoryHandle = null;

    const tree = this._projectTreeFromFolders(folders);
    const projectPath = String(location || '').trim() || this._fileName;
    this._project = this._normalizeProject({
      id: this._newId(),
      name: safeName,
      path: projectPath,
      tree,
      assets: {},
      gameData: clone(EMPTY_GAME_DATA),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      savedAt: null,
    });

    await this._writeCurrentProject({ notify: false });
    await this._storeFileHandle(this._project.id, fileHandle);
    this._recordRecent(this._project);
    this._emitProjectChange({ saveMode: 'file-handle' });
    this._notifySaved(this._project.name);
    return this._project;
  },

  async _createWithDirectoryHandle(name, location, createFolder, folders = null, directoryHandle = null) {
    if (!this._isDirectoryHandle(directoryHandle)) {
      throw new Error('Choose a writable project location with Browse before creating the project.');
    }

    const safeName = sanitizeName(name);
    this._debug('create:directory-handle:start', {
      name: safeName,
      location: String(location || '').trim(),
      createFolder,
      handleName: directoryHandle?.name || null,
      handleType: directoryHandle?.constructor?.name || typeof directoryHandle,
      canQueryPermission: typeof directoryHandle?.queryPermission === 'function',
      canRequestPermission: typeof directoryHandle?.requestPermission === 'function',
    });
    const rootHandle = await this._ensureWritableDirectory(directoryHandle);
    const projectDirHandle = createFolder
      ? await rootHandle.getDirectoryHandle(safeName, { create: true })
      : rootHandle;
    const fileName = `${safeName}.cyco`;
    const fileHandle = await projectDirHandle.getFileHandle(fileName, { create: true });
    const tree = this._projectTreeFromFolders(folders);
    await this._ensureFolderTree(projectDirHandle, tree);

    this._rootDirectoryHandle = rootHandle;
    this._projectDirHandle = projectDirHandle;
    this._fileHandle = fileHandle;
    this._fileName = fileName;

    const projectPath = createFolder
      ? `${rootHandle.name || location || 'Project Location'}/${safeName}`
      : (rootHandle.name || location || safeName);

    this._project = this._normalizeProject({
      id: this._newId(),
      name: safeName,
      path: projectPath,
      tree,
      assets: {},
      gameData: clone(EMPTY_GAME_DATA),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      savedAt: null,
    });

    await this._writeCurrentProject({ notify: false });
    await this._storeFileHandle(this._project.id, fileHandle);
    this._recordRecent(this._project);
    this._emitProjectChange();
    this._notifySaved(this._project.name);
    return this._project;
  },

  _createBrowserStorageProject(name, location, createFolder, folders = null, reason = 'fallback') {
    const safeName = sanitizeName(name);
    const targetLocation = String(location || '').trim();
    const basePath = targetLocation || 'Browser Storage';
    const projectPath = createFolder
      ? `${basePath.replace(/[\\/]+$/, '')}/${safeName}`
      : basePath;

    this._rootDirectoryHandle = null;
    this._projectDirHandle = null;
    this._fileHandle = null;
    this._fileName = `${safeName}.cyco`;

    this._project = this._normalizeProject({
      id: this._newId(),
      name: safeName,
      path: projectPath,
      tree: this._projectTreeFromFolders(folders),
      assets: {},
      gameData: clone(EMPTY_GAME_DATA),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      savedAt: null,
      storageMode: 'browser-storage',
    });

    const snapshot = this._buildSnapshot();
    snapshot.storageMode = 'browser-storage';
    this._project = snapshot;
    this._saveToLocalStorage(snapshot);
    this._recordRecent(snapshot);
    this._emitProjectChange({ saveMode: 'browser-storage', reason });
    this._debug('create:browser-storage-complete', {
      reason,
      name: snapshot.name,
      path: snapshot.path,
    });
    window.dispatchEvent(new CustomEvent('cyco-toast', {
      detail: { message: `Project created in browser storage: ${snapshot.name}`, type: 'success' },
    }));
    return this._project;
  },

  async saveProjectFile(options = {}) {
    if (!this._project) return false;
    const saveAs = !!(options === true || options?.saveAs);
    if (saveAs || !this._fileHandle) {
      return this.saveProjectAs();
    }
    await this._writeCurrentProject({ notify: true });
    return true;
  },

  async saveProjectAs() {
    if (!this._project) return false;
    if (typeof window.showSaveFilePicker !== 'function') {
      this._downloadText(JSON.stringify(this._buildSnapshot(), null, 2), this._projectFileName());
      return true;
    }

    try {
      const fileHandle = await window.showSaveFilePicker({
        suggestedName: this._projectFileName(),
        types: [{ description: 'Cyco Project', accept: { 'application/json': ['.cyco'] } }],
      });
      this._fileHandle = fileHandle;
      this._fileName = fileHandle?.name || this._projectFileName();
      this._projectDirHandle = null;
      if (fileHandle?.name) {
        this._project.name = fileHandle.name.replace(/\.cyco$/i, '') || this._project.name;
      }
      await this._writeCurrentProject({ notify: true });
      await this._storeFileHandle(this._project.id, fileHandle);
      this._emitProjectChange();
      return true;
    } catch (err) {
      if (err?.name === 'AbortError') return false;
      throw new Error(`Could not save project: ${err.message || err}`);
    }
  },

  async openProjectFile() {
    const selection = await this._pickProjectFile();
    if (!selection?.file) return false;

    try {
      const text = await selection.file.text();
      const parsed = JSON.parse(text);
      ProjectSaveLog.clear();
      this._fileHandle = selection.handle || null;
      this._fileName = selection.file.name || selection.handle?.name || this._projectFileName(parsed);
      this._projectDirHandle = null;
      this._rootDirectoryHandle = null;
      this.loadSnapshot(parsed, { recordRecent: true, applyPrefs: true, writeLocal: true });
      if (this._project?.id && this._fileHandle) await this._storeFileHandle(this._project.id, this._fileHandle);
      return true;
    } catch (err) {
      console.error('[ProjectManager] Failed to open project file:', err);
      alert(`Failed to open project file: ${err.message}`);
      return false;
    }
  },

  loadSnapshot(rawSnapshot, { recordRecent = true, applyPrefs = true, writeLocal = false } = {}) {
    const project = this._normalizeProject(rawSnapshot);
    this._project = project;
    if (applyPrefs) this._applyEngineState(project.engineState, { applyPrefs: true });
    if (applyPrefs && project.prefs) savePrefs(project.prefs);
    this._restoreSceneFromSnapshot(project.scene);
    if (recordRecent) this._recordRecent(project);
    if (writeLocal) this._saveToLocalStorage(project);
    this._emitProjectChange();
    return true;
  },

  getRecentProjects() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY_RECENTS) || '[]'); }
    catch { return []; }
  },

  clearRecents() {
    localStorage.removeItem(STORAGE_KEY_RECENTS);
  },

  async openById(id) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_PREFIX + id);
      if (!raw) return false;
      this._fileHandle = null;
      this._projectDirHandle = null;
      this._rootDirectoryHandle = null;
      this.loadSnapshot(JSON.parse(raw), { recordRecent: true, applyPrefs: true, writeLocal: false });
      const handle = await this._getStoredFileHandle(id);
      if (handle) {
        this._fileHandle = handle;
        this._fileName = handle.name || this._projectFileName();
        this._emitProjectChange();
      }
      return true;
    } catch (err) {
      console.warn('[ProjectManager] Could not open recent project:', err);
      return false;
    }
  },

  getFolderContents(pathArray) {
    return this._getNodeAt(pathArray) || {};
  },

  addFolder(parentPath, name) {
    const parent = this._getNodeAt(parentPath);
    if (!parent || !name || name in parent) return false;
    parent[name] = {};
    this._saveLocalAndQueueDisk();
    this._emitProjectChange();
    return true;
  },

  deleteNode(pathArray) {
    if (!pathArray.length) return false;
    const parent = this._getNodeAt(pathArray.slice(0, -1));
    const name = pathArray[pathArray.length - 1];
    if (!parent || !(name in parent)) return false;
    if (isFileNode(parent[name]) && this._project?.assets) delete this._project.assets[parent[name].id];
    delete parent[name];
    this._saveLocalAndQueueDisk();
    this._emitProjectChange();
    return true;
  },

  renameNode(pathArray, newName) {
    if (!pathArray.length) return false;
    const parent = this._getNodeAt(pathArray.slice(0, -1));
    const name = pathArray[pathArray.length - 1];
    if (!parent || !(name in parent) || newName in parent) return false;
    parent[newName] = parent[name];
    delete parent[name];
    this._saveLocalAndQueueDisk();
    this._emitProjectChange();
    return true;
  },

  isFileNode,

  importAssetFile(parentPath, fileRecord) {
    const parent = this._getNodeAt(parentPath);
    if (!parent || !fileRecord?.name) return false;
    const baseName = String(fileRecord.name).trim();
    if (!baseName) return false;

    let name = baseName;
    let n = 2;
    while (name in parent) {
      const dot = baseName.lastIndexOf('.');
      name = dot > 0
        ? `${baseName.slice(0, dot)} ${n}${baseName.slice(dot)}`
        : `${baseName} ${n}`;
      n += 1;
    }

    const fullPath = `/${[...parentPath, name].join('/')}`;
    const record = makeFileRecord(name, fullPath, {
      type: fileRecord.type || this._inferAssetType(name, fileRecord.mimeType),
      mimeType: fileRecord.mimeType || '',
      size: fileRecord.size || 0,
      data: fileRecord.data || null,
      metadata: fileRecord.metadata || {},
    });
    parent[name] = record;
    this._project.assets = this._project.assets || {};
    this._project.assets[record.id] = record;
    this._saveLocalAndQueueDisk();
    this._emitProjectChange();
    return record;
  },

  getGameRecords(module, subType) {
    return this._project?.gameData?.[module]?.[subType] ?? [];
  },

  saveGameRecord(module, subType, record) {
    if (!this._project?.gameData?.[module]?.[subType]) return;
    const arr = this._project.gameData[module][subType];
    const idx = arr.findIndex(r => r.id === record.id);
    if (idx >= 0) arr[idx] = record;
    else arr.push(record);
    this._saveLocalAndQueueDisk();
  },

  deleteGameRecord(module, subType, id) {
    if (!this._project?.gameData?.[module]?.[subType]) return;
    const arr = this._project.gameData[module][subType];
    const idx = arr.findIndex(r => r.id === id);
    if (idx >= 0) {
      arr.splice(idx, 1);
      this._saveLocalAndQueueDisk();
    }
  },

  _projectTreeFromFolders(folders = null) {
    const folderList = Array.isArray(folders)
      ? folders
      : Object.keys(DEFAULT_TREE).filter(folder => folder !== ENGINE_FOLDER_NAME);
    const tree = {};
    for (const folder of folderList) {
      const safe = String(folder || '').trim();
      if (safe) tree[safe] = {};
    }
    tree[ENGINE_FOLDER_NAME] = {
      [ENGINE_STATE_FILE]: makeFileRecord(ENGINE_STATE_FILE, `/${ENGINE_FOLDER_NAME}/${ENGINE_STATE_FILE}`, {
        type: 'engine-state',
        mimeType: 'application/json',
      }),
    };
    return tree;
  },

  _normalizeProject(raw) {
    const base = raw && raw.project && !raw.tree && !raw.gameData ? raw.project : (raw || {});
    const sceneOnly = base && !base.scene && base.object && Array.isArray(base.object.children);
    const name = sanitizeName(base.name || this._fileName?.replace(/\.cyco$/i, '') || 'Untitled Project');
    const project = {
      format: base.format || PROJECT_FILE_FORMAT,
      version: base.version || PROJECT_FILE_VERSION,
      id: base.id || this._newId(),
      name,
      path: base.path || name,
      tree: this._ensureEngineFolder(clone(base.tree || {})),
      assets: clone(base.assets || {}),
      engineState: clone(base.engineState || null),
      gameData: clone(base.gameData || EMPTY_GAME_DATA),
      scene: base.scene ? clone(base.scene) : (sceneOnly ? clone(base) : null),
      prefs: clone(base.prefs || null),
      runtime: clone(base.runtime || null),
      storageMode: base.storageMode || null,
      createdAt: base.createdAt || Date.now(),
      updatedAt: base.updatedAt || Date.now(),
      savedAt: base.savedAt || null,
    };
    this._syncEngineStateFile(project);
    return project;
  },

  _buildSnapshot() {
    const snapshot = this._normalizeProject(this._project || {});
    snapshot.scene = this._captureSceneSnapshot();
    snapshot.prefs = loadPrefs();
    snapshot.runtime = this._captureRuntimeSnapshot();
    snapshot.engineState = this._captureEngineState();
    snapshot.updatedAt = Date.now();
    snapshot.savedAt = Date.now();
    const runtimeRendererType = snapshot.runtime?.renderer?.activeType;
    if (runtimeRendererType) {
      snapshot.prefs = snapshot.prefs || {};
      snapshot.prefs.renderer = snapshot.prefs.renderer || {};
      snapshot.prefs.renderer.defaultType = runtimeRendererType;
    }
    this._syncEngineStateFile(snapshot);
    return snapshot;
  },

  async _writeCurrentProject({ notify = false } = {}) {
    if (!this._project || !this._fileHandle) return false;
    const snapshot = this._buildSnapshot();
    const text = JSON.stringify(snapshot, null, 2);
    await this._ensureWritableFile(this._fileHandle);
    const writable = await this._fileHandle.createWritable();
    await writable.write(text);
    await writable.close();
    this._project = snapshot;
    this._saveToLocalStorage(snapshot);
    await this._storeFileHandle(snapshot.id, this._fileHandle);
    if (this._projectDirHandle) await this._writeEngineStateFile(this._projectDirHandle, snapshot);
    this._recordRecent(snapshot);
    if (notify) this._notifySaved(snapshot.name);
    return true;
  },

  _saveLocalAndQueueDisk() {
    if (!this._project) return;
    this._project = this._buildSnapshot();
    this._saveToLocalStorage(this._project);
    this._queueDiskWrite();
  },

  _queueProjectSnapshot() {
    if (!this._project) return;
    if (this._sceneSaveTimer) clearTimeout(this._sceneSaveTimer);
    this._sceneSaveTimer = setTimeout(() => {
      this._sceneSaveTimer = null;
      this._saveLocalAndQueueDisk();
    }, 300);
  },

  _queueDiskWrite() {
    if (!this._fileHandle || this._diskWriteSuspended) return;
    if (this._diskWriteTimer) clearTimeout(this._diskWriteTimer);
    this._diskWriteTimer = setTimeout(() => {
      this._diskWriteTimer = null;
      this._writeCurrentProject().catch(err => {
        console.warn('[ProjectManager] Auto-save to project file failed:', err);
      });
    }, 350);
  },

  _saveToLocalStorage(project) {
    try { localStorage.setItem(STORAGE_KEY_PREFIX + project.id, JSON.stringify(project)); }
    catch (_) {}
  },

  _recordRecent(project) {
    if (!project?.id) return;
    const recents = this.getRecentProjects().filter(r => r.id !== project.id);
    recents.unshift({
      id: project.id,
      name: project.name,
      path: project.path || this._fileName || '',
      timestamp: Date.now(),
    });
    if (recents.length > 10) recents.length = 10;
    localStorage.setItem(STORAGE_KEY_RECENTS, JSON.stringify(recents));
  },

  _emitProjectChange(extra = {}) {
    document.dispatchEvent(new CustomEvent('cyco-project-change', {
      detail: {
        id: this._project?.id || null,
        name: this._project?.name || null,
        path: this._project?.path || null,
        fileName: this._fileName || null,
        hasFileHandle: !!this._fileHandle,
        ...extra,
      },
    }));
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

  async _ensureWritableDirectory(dirHandle) {
    if (!this._isDirectoryHandle(dirHandle)) {
      throw new Error('The selected item is not a writable folder.');
    }
    this._debug('permission:directory:start', {
      handleName: dirHandle?.name || null,
      handleType: dirHandle?.constructor?.name || typeof dirHandle,
      canQueryPermission: typeof dirHandle?.queryPermission === 'function',
      canRequestPermission: typeof dirHandle?.requestPermission === 'function',
    });
    if (typeof dirHandle.queryPermission === 'function') {
      const state = await dirHandle.queryPermission({ mode: 'readwrite' });
      this._debug('permission:directory:query', {
        handleName: dirHandle?.name || null,
        state,
      });
      if (state === 'granted') return dirHandle;
    }
    if (typeof dirHandle.requestPermission === 'function') {
      const state = await dirHandle.requestPermission({ mode: 'readwrite' });
      this._debug('permission:directory:request', {
        handleName: dirHandle?.name || null,
        state,
      });
      if (state && state !== 'granted') throw new Error('Write permission to the selected folder was not granted.');
    }
    this._debug('permission:directory:granted', {
      handleName: dirHandle?.name || null,
    });
    return dirHandle;
  },

  async _ensureWritableFile(fileHandle) {
    if (!fileHandle) throw new Error('No project file handle is attached.');
    if (typeof fileHandle.queryPermission === 'function') {
      const state = await fileHandle.queryPermission({ mode: 'readwrite' });
      if (state === 'granted') return fileHandle;
    }
    if (typeof fileHandle.requestPermission === 'function') {
      const state = await fileHandle.requestPermission({ mode: 'readwrite' });
      if (state && state !== 'granted') throw new Error('Write permission to the project file was not granted.');
    }
    return fileHandle;
  },

  async _ensureFolderTree(dirHandle, tree) {
    if (!tree || typeof tree !== 'object') return;
    for (const [name, child] of Object.entries(tree)) {
      if (isFileNode(child)) continue;
      const childDir = await dirHandle.getDirectoryHandle(sanitizeName(name), { create: true });
      await this._ensureFolderTree(childDir, child);
    }
  },

  async _writeEngineStateFile(projectDirHandle, snapshot) {
    if (!projectDirHandle || !snapshot?.engineState) return false;
    try {
      const engineDir = await projectDirHandle.getDirectoryHandle(ENGINE_FOLDER_NAME, { create: true });
      const stateFile = await engineDir.getFileHandle(ENGINE_STATE_FILE, { create: true });
      const writable = await stateFile.createWritable();
      await writable.write(JSON.stringify(snapshot.engineState, null, 2));
      await writable.close();
      return true;
    } catch (err) {
      console.warn('[ProjectManager] Could not write engine state file:', err);
      return false;
    }
  },

  _captureSceneSnapshot() {
    try { return clone(window.__cyco?.sceneManager?.serializeActiveScene?.() || null); }
    catch (err) {
      console.warn('[ProjectManager] Scene snapshot failed:', err);
      return null;
    }
  },

  _restoreSceneFromSnapshot(sceneJson) {
    if (!sceneJson) return;
    try { window.__cyco?.sceneManager?.loadSceneFromJSON?.(clone(sceneJson)); }
    catch (err) { console.warn('[ProjectManager] Failed to restore scene snapshot:', err); }
  },

  _captureEngineState() {
    const readJson = (key, fallback = null) => {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch (_) {
        return fallback;
      }
    };
    const readString = (key, fallback = null) => {
      try { return localStorage.getItem(key) ?? fallback; }
      catch (_) { return fallback; }
    };
    return {
      schema: 'cyco-engine-state',
      version: 1,
      savedAt: Date.now(),
      preferences: loadPrefs(),
      rendererType: readString('cyco:rendererType'),
      gridSettings: readJson('cyco-grid-settings', null),
      layout: readJson('cyco-layout-current', null),
      savedLayouts: readJson('cyco-layouts', {}),
      theme: {
        active: readString('cyco-theme-active', 'Dark Coffee'),
        presets: readJson('cyco-theme-presets', {}),
        borderWidth: readString('cyco-border-width', '1'),
      },
      panels: {
        propertiesSections: readJson('cyco-prop-sections', {}),
        gameManagerSplit: readString('cyco-gm-split', null),
      },
      viewport: {
        camera: this._summarizeCamera(window.__cyco?.viewportEngine?.camera, window.__cyco?.viewportEngine?.controls),
      },
    };
  },

  _applyEngineState(engineState, { applyPrefs = true } = {}) {
    if (!engineState || typeof engineState !== 'object') return;
    const writeJson = (key, value) => {
      if (value == null) return;
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
    };
    const writeString = (key, value) => {
      if (value == null) return;
      try { localStorage.setItem(key, String(value)); } catch (_) {}
    };
    if (applyPrefs && engineState.preferences) savePrefs(engineState.preferences);
    writeString('cyco:rendererType', engineState.rendererType);
    writeJson('cyco-grid-settings', engineState.gridSettings);
    writeJson('cyco-layout-current', engineState.layout);
    writeJson('cyco-layouts', engineState.savedLayouts);
    writeString('cyco-theme-active', engineState.theme?.active);
    writeJson('cyco-theme-presets', engineState.theme?.presets);
    writeString('cyco-border-width', engineState.theme?.borderWidth);
    writeJson('cyco-prop-sections', engineState.panels?.propertiesSections);
    writeString('cyco-gm-split', engineState.panels?.gameManagerSplit);
    if (engineState.gridSettings) {
      window.dispatchEvent(new CustomEvent('cyco-grid-settings-change', { detail: engineState.gridSettings }));
    }
    if (engineState.rendererType) {
      window.dispatchEvent(new CustomEvent('cyco-renderer-change', {
        detail: { type: engineState.rendererType, reason: 'project-engine-state-load' },
      }));
    }
  },

  _captureRuntimeSnapshot() {
    const rendererManager = window.__cyco?.rendererManager;
    const renderer = rendererManager?.renderer;
    const viewportEngine = window.__cyco?.viewportEngine;
    const canvas = renderer?.domElement;
    return {
      renderer: {
        activeType: rendererManager?.activeType || rendererManager?.currentType || null,
        rendererClass: renderer?.constructor?.name || null,
        isWebGLRenderer: !!renderer?.isWebGLRenderer,
        isWebGPURenderer: !!renderer?.isWebGPURenderer,
        forceWebGL: !!renderer?.backend?.isWebGLBackend,
        hasDomElement: !!canvas,
        canvasConnected: !!canvas?.isConnected,
        canvasWidth: canvas?.width ?? null,
        canvasHeight: canvas?.height ?? null,
      },
      camera: this._summarizeCamera(viewportEngine?.camera, viewportEngine?.controls),
    };
  },

  _summarizeCamera(camera, controls = null) {
    if (!camera) return null;
    const target = controls?.target;
    return {
      type: camera.type || null,
      fov: camera.fov ?? null,
      near: camera.near ?? null,
      far: camera.far ?? null,
      aspect: camera.aspect ?? null,
      zoom: camera.zoom ?? null,
      position: {
        x: Number(camera.position?.x?.toFixed?.(3) ?? camera.position?.x ?? 0),
        y: Number(camera.position?.y?.toFixed?.(3) ?? camera.position?.y ?? 0),
        z: Number(camera.position?.z?.toFixed?.(3) ?? camera.position?.z ?? 0),
      },
      target: target ? {
        x: Number(target.x.toFixed(3)),
        y: Number(target.y.toFixed(3)),
        z: Number(target.z.toFixed(3)),
      } : null,
    };
  },

  _syncEngineStateFile(project = this._project) {
    if (!project) return;
    project.tree = this._ensureEngineFolder(project.tree || {});
    project.engineState = project.engineState || this._captureEngineState();
    const file = project.tree[ENGINE_FOLDER_NAME][ENGINE_STATE_FILE];
    file.type = 'engine-state';
    file.mimeType = 'application/json';
    file.size = this._safeJsonSize(project.engineState);
    file.data = clone(project.engineState);
    file.updatedAt = Date.now();
  },

  _ensureEngineFolder(tree) {
    const safeTree = tree && typeof tree === 'object' ? tree : {};
    if (!safeTree[ENGINE_FOLDER_NAME] || isFileNode(safeTree[ENGINE_FOLDER_NAME])) safeTree[ENGINE_FOLDER_NAME] = {};
    if (!safeTree[ENGINE_FOLDER_NAME][ENGINE_STATE_FILE]) {
      safeTree[ENGINE_FOLDER_NAME][ENGINE_STATE_FILE] = makeFileRecord(
        ENGINE_STATE_FILE,
        `/${ENGINE_FOLDER_NAME}/${ENGINE_STATE_FILE}`,
        { type: 'engine-state', mimeType: 'application/json' },
      );
    }
    return safeTree;
  },

  _getNodeAt(pathArray) {
    if (!this._project) return null;
    let node = this._project.tree;
    for (const part of pathArray) {
      if (isFileNode(node)) return null;
      if (node == null || typeof node[part] !== 'object') return null;
      node = node[part];
    }
    return isFileNode(node) ? null : node;
  },

  _inferAssetType(name, mimeType = '') {
    const lower = String(name || '').toLowerCase();
    if (mimeType.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|svg|ktx2?)$/.test(lower)) return 'texture';
    if (mimeType.startsWith('audio/') || /\.(wav|mp3|ogg|flac|m4a)$/.test(lower)) return 'audio';
    if (/\.(glb|gltf|obj|fbx|dae|blend)$/.test(lower)) return 'model';
    if (/\.(js|ts|json|wasm)$/.test(lower)) return 'script';
    if (/\.(ttf|otf|woff2?)$/.test(lower)) return 'font';
    if (/\.(mat|material)$/.test(lower)) return 'material';
    return 'file';
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
    const name = sanitizeName(snapshot?.name || 'project');
    return `${name}.cyco`;
  },

  _notifySaved(name = this._project?.name) {
    const label = name ? `Saved ${name}` : 'Project saved';
    window.dispatchEvent(new CustomEvent('cyco-toast', { detail: { message: label, type: 'success' } }));
  },

  _isDirectoryHandle(value) {
    return !!value && typeof value.getDirectoryHandle === 'function';
  },

  _isFileHandle(value) {
    return !!value && typeof value.createWritable === 'function' && typeof value.getFile === 'function';
  },

  _newId() {
    return `proj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  },

  _safeJsonSize(value) {
    try { return JSON.stringify(value).length; }
    catch (_) { return -1; }
  },

  _openHandleDb() {
    if (typeof indexedDB === 'undefined') return Promise.resolve(null);
    return new Promise((resolve) => {
      const request = indexedDB.open(HANDLE_DB_NAME, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(HANDLE_STORE_NAME);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
  },

  async _storeFileHandle(id, handle) {
    if (!id || !handle) return false;
    const db = await this._openHandleDb();
    if (!db) return false;
    return await new Promise((resolve) => {
      const tx = db.transaction(HANDLE_STORE_NAME, 'readwrite');
      tx.objectStore(HANDLE_STORE_NAME).put(handle, id);
      tx.oncomplete = () => { db.close(); resolve(true); };
      tx.onerror = () => { db.close(); resolve(false); };
    });
  },

  async _getStoredFileHandle(id) {
    if (!id) return null;
    const db = await this._openHandleDb();
    if (!db) return null;
    return await new Promise((resolve) => {
      const tx = db.transaction(HANDLE_STORE_NAME, 'readonly');
      const request = tx.objectStore(HANDLE_STORE_NAME).get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
      tx.oncomplete = () => db.close();
      tx.onerror = () => db.close();
    });
  },

  _migrateLegacy() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_LEGACY);
      if (!raw) return;
      const data = this._normalizeProject(JSON.parse(raw));
      this._saveToLocalStorage(data);
      this._recordRecent(data);
      localStorage.removeItem(STORAGE_KEY_LEGACY);
    } catch (_) {
      localStorage.removeItem(STORAGE_KEY_LEGACY);
    }
  },
};

export default ProjectManager;
