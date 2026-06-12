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
const ENGINE_FOLDER_NAME = 'engine';
const ENGINE_STATE_FILE = 'cyco-engine.json';

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
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

// Default folder structure for every new project
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

  _summarizeSnapshot(snapshot) {
    const scene = snapshot?.scene;
    const obj = scene?.object;
    const runtimeRenderer = snapshot?.runtime?.renderer;
    const prefsRenderer = snapshot?.prefs?.renderer;
    return {
      format: snapshot?.format || null,
      version: snapshot?.version ?? null,
      id: snapshot?.id || null,
      name: snapshot?.name || null,
      path: snapshot?.path || null,
      treeFolders: Object.keys(snapshot?.tree || {}).length,
      gameModules: Object.keys(snapshot?.gameData || {}).length,
      assetRecords: Object.keys(snapshot?.assets || {}).length,
      hasEngineState: !!snapshot?.engineState,
      hasScene: !!scene,
      sceneType: obj?.type || null,
      sceneChildren: Array.isArray(obj?.children) ? obj.children.length : 0,
      sceneGeometries: scene?.geometries?.length ?? 0,
      sceneMaterials: scene?.materials?.length ?? 0,
      sceneTextures: scene?.textures?.length ?? 0,
      sceneImages: scene?.images?.length ?? 0,
      prefsRendererType: prefsRenderer?.defaultType || null,
      runtimeRendererType: runtimeRenderer?.activeType || null,
      runtimeRendererClass: runtimeRenderer?.rendererClass || null,
      savedAt: snapshot?.savedAt || null,
      jsonBytes: this._safeJsonSize(snapshot),
    };
  },

  _safeJsonSize(value) {
    try { return JSON.stringify(value).length; }
    catch (_) { return -1; }
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

  _ensureEngineFolder(tree) {
    const safeTree = tree && typeof tree === 'object' ? tree : {};
    if (!safeTree[ENGINE_FOLDER_NAME] || isFileNode(safeTree[ENGINE_FOLDER_NAME])) {
      safeTree[ENGINE_FOLDER_NAME] = {};
    }
    if (!safeTree[ENGINE_FOLDER_NAME][ENGINE_STATE_FILE]) {
      safeTree[ENGINE_FOLDER_NAME][ENGINE_STATE_FILE] = makeFileRecord(
        ENGINE_STATE_FILE,
        `/${ENGINE_FOLDER_NAME}/${ENGINE_STATE_FILE}`,
        { type: 'engine-state', mimeType: 'application/json' },
      );
    }
    return safeTree;
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

  _captureRuntimeSnapshot() {
    const rendererManager = window.__cyco?.rendererManager;
    const renderer = rendererManager?.renderer;
    const canvas = renderer?.domElement;
    const viewportEngine = window.__cyco?.viewportEngine;
    const camera = viewportEngine?.camera;
    const container = viewportEngine?._container;
    const containerRect = container?.getBoundingClientRect?.();
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
        cssWidth: canvas?.offsetWidth ?? null,
        cssHeight: canvas?.offsetHeight ?? null,
        pixelRatio: typeof renderer?.getPixelRatio === 'function' ? renderer.getPixelRatio() : null,
        toneMapping: renderer?.toneMapping ?? null,
        toneMappingExposure: renderer?.toneMappingExposure ?? null,
        outputColorSpace: renderer?.outputColorSpace ?? null,
      },
      viewport: {
        hasContainer: !!container,
        containerConnected: !!container?.isConnected,
        containerWidth: containerRect ? Math.floor(containerRect.width) : null,
        containerHeight: containerRect ? Math.floor(containerRect.height) : null,
        pipelineActive: !!viewportEngine?._pipelineActive,
      },
      camera: this._summarizeCamera(camera, viewportEngine?.controls),
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
    const tree = this._projectTreeFromFolders(folders);
    this._project = {
      format: PROJECT_FILE_FORMAT,
      version: PROJECT_FILE_VERSION,
      id,
      name,
      path: displayPath,
      tree,
      assets: {},
      engineState: this._captureEngineState(),
      gameData: JSON.parse(JSON.stringify(EMPTY_GAME_DATA)),
      scene: this._captureSceneSnapshot(),
      prefs: loadPrefs(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      savedAt: Date.now(),
    };
    this._syncEngineStateFile(this._project);
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
    this._debug('openById:start', { id });
    try {
      const raw = localStorage.getItem(STORAGE_KEY_PREFIX + id);
      if (!raw) {
        this._debug('openById:missing', { id });
        return false;
      }
      this._debug('openById:raw-loaded', { id, bytes: raw.length });
      this._project = this._normalizeSnapshot(JSON.parse(raw));
      this._debug('openById:normalized', this._summarizeSnapshot(this._project));
      this._touchRecent(id);
      this._applyEngineState(this._project.engineState, { applyPrefs: true });
      if (this._project.prefs) {
        const rendererType = this._project.runtime?.renderer?.activeType || this._project.prefs?.renderer?.defaultType || null;
        if (rendererType) {
          this._project.prefs.renderer = this._project.prefs.renderer || {};
          this._project.prefs.renderer.defaultType = rendererType;
        }
        savePrefs(this._project.prefs);
        this._debug('openById:prefs-applied', { rendererType, hasPrefs: true });
        if (rendererType) {
          try {
            localStorage.setItem('cyco:rendererType', rendererType);
            window.dispatchEvent(new CustomEvent('cyco-renderer-change', { detail: { type: rendererType, reason: 'recent-project-open' } }));
            this._debug('openById:renderer-requested', { rendererType });
          } catch (err) {
            this._debug('openById:renderer-request-failed', { rendererType, message: err?.message || String(err) });
          }
        }
      }
      document.dispatchEvent(new CustomEvent('cyco-project-change', {
        detail: { name: this._project.name, path: this._project.path },
      }));
      this._restoreSceneFromSnapshot(this._project.scene);
      return true;
    } catch (err) {
      this._debug('openById:error', { id, message: err?.message || String(err) });
      return false;
    }
  },

  /**
   * Save the current project to a .cyco file.
   * Uses the native file picker when available; otherwise downloads a file.
   */
  async saveProjectFile(options = {}) {
    if (!this._project) return false;
    const saveAs = !!(options === true || options?.saveAs);
    const snapshot = this._buildSnapshot();
    const filename = this._projectFileName(snapshot);
    const hasDiskTarget = ProjectDiskStorage.hasTarget();
    const hasBridgeTarget = ProjectLocalBridgeStorage.hasTarget();
    this._debug('saveProjectFile:start', {
      filename,
      saveAs,
      hasDiskTarget,
      hasBridgeTarget,
      ...this._summarizeSnapshot(snapshot),
    });

    if (!saveAs && hasDiskTarget) {
      try {
        await ProjectDiskStorage.writeSnapshot(snapshot);
        this._debug('saveProjectFile:existing-target-written', { filename });
        this._notifySaved(snapshot.name);
        return true;
      } catch (err) {
        this._debug('saveProjectFile:existing-target-failed', { filename, message: err?.message || String(err) });
        console.warn('[ProjectManager] Saving to existing project file failed:', err);
      }
    }

    if (!saveAs && hasBridgeTarget) {
      try {
        await ProjectLocalBridgeStorage.writeSnapshot(snapshot);
        this._debug('saveProjectFile:bridge-target-written', { filename });
        this._notifySaved(snapshot.name);
        return true;
      } catch (err) {
        this._debug('saveProjectFile:bridge-target-failed', { filename, message: err?.message || String(err) });
        console.warn('[ProjectManager] Saving through local bridge failed:', err);
      }
    }

    if (typeof window.showSaveFilePicker === 'function') {
      try {
        const fileHandle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [{ description: 'Cyco Project', accept: { 'application/json': ['.cyco'] } }],
        });
        ProjectDiskStorage.attachFile(fileHandle, fileHandle?.name || filename);
        if (saveAs && fileHandle?.name) {
          this._project.name = fileHandle.name.replace(/\.cyco$/i, '') || this._project.name;
        }
        const writableSnapshot = saveAs ? this._buildSnapshot() : snapshot;
        await ProjectDiskStorage.writeSnapshot(writableSnapshot);
        this._debug('saveProjectFile:picked-target-written', {
          filename: fileHandle?.name || filename,
          ...this._summarizeSnapshot(writableSnapshot),
        });
        this._notifySaved(writableSnapshot.name);
        return true;
      } catch (err) {
        if (err?.name === 'AbortError') {
          this._debug('saveProjectFile:aborted', { filename });
          return false;
        }
        this._debug('saveProjectFile:error', { filename, message: err?.message || String(err) });
        throw new Error(`Could not save the project file: ${err.message || err}`);
      }
    }

    throw new Error('This runtime cannot save project files directly. Use a writable folder or desktop shell.');
  },

  async saveProjectAs() {
    return this.saveProjectFile({ saveAs: true });
  },

  /**
   * Load a project from a .cyco file selected by the user.
   */
  async openProjectFile() {
    this._debug('openProjectFile:start');
    const selection = await this._pickProjectFile();
    if (!selection?.file) {
      this._debug('openProjectFile:no-selection');
      return false;
    }
    try {
      const { file, handle } = selection;
      this._debug('openProjectFile:selected', {
        fileName: file?.name || null,
        fileSize: file?.size ?? null,
        fileType: file?.type || null,
        hasHandle: !!handle,
      });
      ProjectDiskStorage.reset();
      ProjectLocalBridgeStorage.reset();
      if (handle) ProjectDiskStorage.attachFile(handle, file?.name || null);
      const text = await file.text();
      this._debug('openProjectFile:text-loaded', { fileName: file?.name || null, bytes: text.length });
      const parsed = JSON.parse(text);
      this._debug('openProjectFile:parsed', this._summarizeSnapshot(parsed));
      return this.loadSnapshot(parsed, { recordRecent: true, applyPrefs: true });
    } catch (err) {
      this._debug('openProjectFile:error', { message: err?.message || String(err), stack: err?.stack || null });
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
    this._debug('loadSnapshot:start', {
      recordRecent,
      applyPrefs,
      raw: this._summarizeSnapshot(rawSnapshot),
    });
    const snapshot = this._normalizeSnapshot(rawSnapshot);
    this._project = snapshot;
    this._debug('loadSnapshot:normalized', this._summarizeSnapshot(snapshot));
    this._applyEngineState(snapshot.engineState, { applyPrefs });
    if (applyPrefs && snapshot.prefs) {
      const rendererType = snapshot.runtime?.renderer?.activeType || snapshot.prefs?.renderer?.defaultType || null;
      if (rendererType) {
        snapshot.prefs.renderer = snapshot.prefs.renderer || {};
        snapshot.prefs.renderer.defaultType = rendererType;
      }
      savePrefs(snapshot.prefs);
      this._debug('loadSnapshot:prefs-applied', {
        rendererType,
        hasPrefs: true,
      });
      if (rendererType) {
        try {
          localStorage.setItem('cyco:rendererType', rendererType);
          window.dispatchEvent(new CustomEvent('cyco-renderer-change', { detail: { type: rendererType, reason: 'project-load' } }));
          this._debug('loadSnapshot:renderer-requested', { rendererType });
        } catch (err) {
          this._debug('loadSnapshot:renderer-request-failed', { rendererType, message: err?.message || String(err) });
        }
      }
    }
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
    this._save();
    this._debug('loadSnapshot:complete', this._summarizeSnapshot(this._project));
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
      ProjectLocalBridgeStorage.reset();
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
      if (isFileNode(node)) return null;
      if (node == null || typeof node[part] !== 'object') return null;
      node = node[part];
    }
    return isFileNode(node) ? null : node;
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
    if (isFileNode(parent[name]) && this._project?.assets) {
      delete this._project.assets[parent[name].id];
    }
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
    this._save();
    document.dispatchEvent(new CustomEvent('cyco-project-change'));
    return record;
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
    this._project.runtime = this._captureRuntimeSnapshot();
    this._project.engineState = this._captureEngineState();
    const runtimeRendererType = this._project.runtime?.renderer?.activeType;
    if (runtimeRendererType) {
      this._project.prefs = this._project.prefs || {};
      this._project.prefs.renderer = this._project.prefs.renderer || {};
      this._project.prefs.renderer.defaultType = runtimeRendererType;
    }
    this._project.updatedAt = Date.now();
    this._project.savedAt = Date.now();
    if (!this._project.format) this._project.format = PROJECT_FILE_FORMAT;
    if (!this._project.version) this._project.version = PROJECT_FILE_VERSION;
    this._syncEngineStateFile(this._project);
    const key = STORAGE_KEY_PREFIX + (this._project.id || 'default');
    this._debug('save:localStorage:start', {
      key,
      ...this._summarizeSnapshot(this._project),
    });
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
    if (!ProjectDiskStorage.hasTarget()) {
      this._debug('queueDiskWrite:skip-no-target');
      return;
    }
    if (this._diskWriteSuspended) {
      this._debug('queueDiskWrite:skip-suspended');
      return;
    }
    if (this._diskWriteTimer) clearTimeout(this._diskWriteTimer);
    this._debug('queueDiskWrite:scheduled');
    this._diskWriteTimer = setTimeout(() => {
      const snapshot = this._buildSnapshot();
      this._debug('queueDiskWrite:writing', this._summarizeSnapshot(snapshot));
      ProjectDiskStorage.writeSnapshot(snapshot).catch(err => {
        this._debug('queueDiskWrite:error', { message: err?.message || String(err) });
        console.warn('[ProjectManager] Failed to write project to disk:', err);
      });
    }, 250);
  },

  _buildSnapshot() {
    const snapshot = this._normalizeSnapshot(this._project || {});
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
    this._debug('buildSnapshot', this._summarizeSnapshot(snapshot));
    return snapshot;
  },

  _normalizeSnapshot(raw) {
    const legacy = raw && raw.project && !raw.tree && !raw.gameData ? raw.project : raw;
    const base = legacy && typeof legacy === 'object' ? legacy : {};
    const sceneOnly = base && !base.scene && base.object && Array.isArray(base.object.children) && (
      Array.isArray(base.geometries) || Array.isArray(base.materials) || Array.isArray(base.textures)
    );
    const id = base.id || `proj-${Date.now().toString(36)}`;
    const name = base.name || 'Untitled Project';
    const path = (base.path || '/projects').replace(/\\+/g, '/');
    const tree = this._ensureEngineFolder(this._clone(base.tree || {}));
    const assets = this._clone(base.assets || {});
    const gameData = this._clone(base.gameData || EMPTY_GAME_DATA);
    const scene = base.scene ? this._clone(base.scene) : (sceneOnly ? this._clone(base) : null);
    const prefs = base.prefs ? this._clone(base.prefs) : null;
    const runtime = base.runtime ? this._clone(base.runtime) : null;
    const engineState = base.engineState
      ? this._clone(base.engineState)
      : (tree[ENGINE_FOLDER_NAME]?.[ENGINE_STATE_FILE]?.data ? this._clone(tree[ENGINE_FOLDER_NAME][ENGINE_STATE_FILE].data) : null);

    const normalized = {
      format: base.format || PROJECT_FILE_FORMAT,
      version: base.version || PROJECT_FILE_VERSION,
      id,
      name,
      path,
      tree,
      assets,
      engineState,
      gameData,
      scene,
      prefs,
      runtime,
      createdAt: base.createdAt || Date.now(),
      updatedAt: base.updatedAt || Date.now(),
      savedAt: base.savedAt || Date.now(),
    };
    this._syncEngineStateFile(normalized);
    return normalized;
  },

  _captureSceneSnapshot() {
    try {
      const scene = this._clone(window.__cyco?.sceneManager?.serializeActiveScene?.() || null);
      this._debug('captureSceneSnapshot', {
        hasScene: !!scene,
        sceneChildren: scene?.object?.children?.length ?? 0,
        sceneGeometries: scene?.geometries?.length ?? 0,
        sceneMaterials: scene?.materials?.length ?? 0,
        sceneTextures: scene?.textures?.length ?? 0,
        sceneImages: scene?.images?.length ?? 0,
      });
      return scene;
    } catch (err) {
      this._debug('captureSceneSnapshot:error', { message: err?.message || String(err) });
      return null;
    }
  },

  _restoreSceneFromSnapshot(sceneJson) {
    if (!sceneJson) {
      this._debug('restoreScene:skip-empty');
      return;
    }
    try {
      this._debug('restoreScene:start', {
        sceneType: sceneJson?.object?.type || null,
        sceneChildren: sceneJson?.object?.children?.length ?? 0,
        sceneGeometries: sceneJson?.geometries?.length ?? 0,
        sceneMaterials: sceneJson?.materials?.length ?? 0,
        sceneTextures: sceneJson?.textures?.length ?? 0,
        sceneImages: sceneJson?.images?.length ?? 0,
      });
      window.__cyco?.sceneManager?.loadSceneFromJSON?.(this._clone(sceneJson));
      this._debug('restoreScene:complete');
    } catch (err) {
      this._debug('restoreScene:error', { message: err?.message || String(err), stack: err?.stack || null });
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
    return clone(value);
  },

  _notifySaved(name = this._project?.name) {
    const label = name ? `Saved ${name}` : 'Project saved';
    window.dispatchEvent(new CustomEvent('cyco-toast', { detail: { message: label, type: 'success' } }));
  },

  _addToRecents({ id, name, path, timestamp }) {
    const recents = this.getRecentProjects().filter(r => r.id !== id);
    recents.unshift({ id, name, path, timestamp });
    if (recents.length > 10) recents.length = 10;
    localStorage.setItem(STORAGE_KEY_RECENTS, JSON.stringify(recents));
    this._debug('recents:add', { id, name, path, count: recents.length });
  },

  _touchRecent(id) {
    const recents = this.getRecentProjects();
    const idx = recents.findIndex(r => r.id === id);
    if (idx >= 0) {
      const [item] = recents.splice(idx, 1);
      item.timestamp = Date.now();
      recents.unshift(item);
      localStorage.setItem(STORAGE_KEY_RECENTS, JSON.stringify(recents));
      this._debug('recents:touch', { id, count: recents.length });
    } else {
      this._debug('recents:touch-miss', { id });
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
