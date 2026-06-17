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
  animations:{},
  fonts:     {},
  engine:    {},
  fx:        {},
  materials: {},
  models:    {},
  prefabs:   {},
  scenes:    {},
  scripts:   {},
  textures:  {},
};

const ProjectManager = {
  _project: null,
  _sceneSaveTimer: null,
  _listenersAttached: false,
  _diskWriteSuspended: false,
  _loadInProgress: false,

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
    window.addEventListener('cyco-scene-dirty', () => {
      if (this._loadInProgress) return;
      this._queueSceneSnapshot();
    });
    window.addEventListener('cyco-scene-loaded', () => {
      if (this._loadInProgress) return;
      this._queueSceneSnapshot();
    });
    window.addEventListener('cyco-preferences-change', () => {
      // Defer prefs-driven saves while a project load is in progress to
      // prevent the saved scene from being clobbered by a still-empty
      // live scene captured from within the same loadSnapshot call.
      if (this._loadInProgress) return;
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
    this.startWatching();
    return this._project;
  },

  /**
   * Re-open a previously created project by its stored id.
   * Tries the local save bridge first to get the latest on-disk version of
   * the .cyco file. Falls back to the localStorage snapshot if the bridge
   * is unavailable or the file cannot be read.
   * Returns true on success, false if the project data is not found.
   */
  async openById(id) {
    const recent = this.getRecentProjects().find(r => r.id === id);
    const filePath = recent?.filePath
      || (recent?.path && recent?.name ? `${recent.path}/${recent.name}.cyco` : null);
    if (filePath && ProjectLocalBridgeStorage.isBridgeAvailable) {
      const bridgeUp = await ProjectLocalBridgeStorage.isBridgeAvailable().catch(() => false);
      if (bridgeUp) {
        const ok = await this.openProjectByPath(filePath);
        if (ok) return true;
        // Fall through to localStorage fallback below.
      }
    }
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
      this._save();
      this.startWatching();
      return true;
    } catch { return false; }
  },

  /**
   * Save the current project to a .cyco file.
   * - If a Save-As target is attached, writes there.
   * - Else, if a browser file picker is available, prompts the user.
   * - Else, falls back to the local save bridge (writes to the project folder).
   * - Else, throws an explicit error.
   */
  async saveProjectFile() {
    if (!this._project) return false;
    const snapshot = this._buildSnapshot();

    // 1. A file handle was attached (e.g. via Save As → browser picker)
    if (ProjectDiskStorage.hasTarget()) {
      try {
        await ProjectDiskStorage.writeSnapshot(snapshot);
        window.dispatchEvent(new CustomEvent('cyco-toast', {
          detail: { message: `Saved ${ProjectDiskStorage.getFileName() || 'project.cyco'}` },
        }));
        return true;
      } catch (err) {
        console.warn('[ProjectManager] Saving to existing project file failed:', err);
      }
    }

    // 2. A bridge file target was attached (Save As → local save bridge)
    if (ProjectLocalBridgeStorage.hasTarget()) {
      try {
        const result = await ProjectLocalBridgeStorage.writeSnapshot(snapshot);
        const fileName = this._projectFileName(snapshot);
        const projectPath = ProjectLocalBridgeStorage.getProjectPath();
        const written = result?.assetsWritten ?? 0;
        const skipped = result?.assetsSkipped ?? 0;
        const assetPart = written > 0
          ? ` · ${written} asset${written === 1 ? '' : 's'} written`
            + (skipped > 0 ? `, ${skipped} skipped (newer on disk)` : '')
          : '';
        window.dispatchEvent(new CustomEvent('cyco-toast', {
          detail: { message: `Saved ${fileName} → ${projectPath || 'project folder'}${assetPart}` },
        }));
        return true;
      } catch (err) {
        console.warn('[ProjectManager] Saving to local bridge failed:', err);
        throw new Error(`Could not save the project file: ${err.message || err}`);
      }
    }

    // 3. Browser File System Access API → ask the user where to put the .cyco
    if (typeof window.showSaveFilePicker === 'function') {
      try {
        const filename = this._projectFileName(snapshot);
        const fileHandle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [{ description: 'Cyco Project', accept: { 'application/json': ['.cyco'] } }],
        });
        ProjectDiskStorage.attachFile(fileHandle, fileHandle?.name || filename);
        await ProjectDiskStorage.writeSnapshot(snapshot);
        window.dispatchEvent(new CustomEvent('cyco-toast', {
          detail: { message: `Saved ${fileHandle?.name || filename}` },
        }));
        return true;
      } catch (err) {
        if (err?.name === 'AbortError') return false;
        throw new Error(`Could not save the project file: ${err.message || err}`);
      }
    }

    // 4. Fallback: download as a file (no in-place Save possible)
    this._downloadText(JSON.stringify(snapshot, null, 2), this._projectFileName(snapshot));
    window.dispatchEvent(new CustomEvent('cyco-toast', {
      detail: { message: `Downloaded ${this._projectFileName(snapshot)} (no writable project folder attached)` },
    }));
    return true;
  },

  /**
   * Save As: write the .cyco into the project's picked location.
   * @param {{ exportMode?: 'file' | 'folder' | 'zip' }} [options]
   *   - 'file' (default): write a single .cyco into the project folder.
   *   - 'folder': write the project as a folder of the same name containing the .cyco.
   *   - 'zip': reserved for future (not yet implemented).
   */
  async saveProjectAs(options = {}) {
    if (!this._project) {
      throw new Error('No project is open. Create or open a project before using Save As.');
    }
    const exportMode = options.exportMode || 'file';
    const snapshot = this._buildSnapshot();
    const fileName = this._projectFileName(snapshot);

    // 1. Bridge attached (project was created with the local save bridge)
    if (ProjectLocalBridgeStorage.hasTarget()) {
      const projectPath = ProjectLocalBridgeStorage.getProjectPath();
      try {
        if (exportMode === 'file') {
          await ProjectLocalBridgeStorage.writeSnapshot(snapshot);
        } else if (exportMode === 'folder') {
          await ProjectLocalBridgeStorage.exportAsFolder(snapshot);
        } else {
          throw new Error(`Save As mode "${exportMode}" is not supported yet.`);
        }
        window.dispatchEvent(new CustomEvent('cyco-toast', {
          detail: { message: `Saved ${fileName} → ${projectPath || 'project folder'}` },
        }));
        return { ok: true, fileName, projectPath, mode: exportMode };
      } catch (err) {
        throw new Error(`Could not Save As into the project folder: ${err.message || err}`);
      }
    }

    // 2. Browser File System Access API
    if (typeof window.showSaveFilePicker === 'function') {
      try {
        const fileHandle = await window.showSaveFilePicker({
          suggestedName: fileName,
          types: [{ description: 'Cyco Project', accept: { 'application/json': ['.cyco'] } }],
        });
        ProjectDiskStorage.reset();
        ProjectLocalBridgeStorage.reset();
        ProjectDiskStorage.attachFile(fileHandle, fileHandle?.name || fileName);
        await ProjectDiskStorage.writeSnapshot(snapshot);
        window.dispatchEvent(new CustomEvent('cyco-toast', {
          detail: { message: `Saved ${fileHandle?.name || fileName}` },
        }));
        return { ok: true, fileName: fileHandle?.name || fileName, projectPath: null, mode: exportMode };
      } catch (err) {
        if (err?.name === 'AbortError') return { ok: false, cancelled: true };
        throw new Error(`Could not Save As: ${err.message || err}`);
      }
    }

    // 3. No writable target — fall back to download
    this._downloadText(JSON.stringify(snapshot, null, 2), fileName);
    window.dispatchEvent(new CustomEvent('cyco-toast', {
      detail: { message: `Downloaded ${fileName} (browse to a folder & use New Project to enable Save As)` },
    }));
    return { ok: true, fileName, projectPath: null, mode: 'download' };
  },

  /**
   * Rescan the on-disk project folder and rebuild the in-memory tree from it.
   * Requires the local save bridge to be running and have an active target.
   * Returns true on success, false if no scan was possible.
   *
   * NOTE: This intentionally does NOT call _save(). The watcher is what calls
   * refreshFromDisk, and _save() would write the snapshot back to disk, which
   * the watcher would then see as another change — an infinite feedback loop.
   */
  async refreshFromDisk() {
    if (!this._project) return false;
    const projectPath = ProjectLocalBridgeStorage.getProjectPath();
    if (!projectPath) return false;
    if (!ProjectLocalBridgeStorage.hasTarget?.()) {
      // No bridge target — nothing to rescan from disk
      return false;
    }
    try {
      const result = await ProjectLocalBridgeStorage.scanProject({ projectPath });
      const tree = result?.tree;
      if (!tree || typeof tree !== 'object') return false;
      this._project.tree = tree;
      this._project.updatedAt = Date.now();
      document.dispatchEvent(new CustomEvent('cyco-project-change', {
        detail: { name: this._project.name, path: this._project.path },
      }));
      return true;
    } catch (err) {
      console.warn('[ProjectManager] refreshFromDisk failed:', err);
      return false;
    }
  },

  /**
   * Begin watching the project folder for on-disk changes and auto-refresh
   * the asset browser tree. No-op if the bridge is not running.
   */
  startWatching() {
    if (this._watcherActive) return;
    if (!ProjectLocalBridgeStorage.hasTarget?.()) return;
    if (typeof ProjectLocalBridgeStorage.startWatching !== 'function') return;
    this._watcherActive = true;
    try {
      ProjectLocalBridgeStorage.startWatching({
        onChange: (event) => {
          // Debounce: if multiple events fire in quick succession, only refresh once.
          if (this._watchDebounceTimer) clearTimeout(this._watchDebounceTimer);
          this._watchDebounceTimer = setTimeout(() => {
            this._watchDebounceTimer = null;
            this.refreshFromDisk();
          }, 250);
          this._debug('disk:change', event || {});
        },
      });
    } catch (err) {
      console.warn('[ProjectManager] startWatching failed:', err);
      this._watcherActive = false;
    }
  },

  stopWatching() {
    if (!this._watcherActive) return;
    this._watcherActive = false;
    if (this._watchDebounceTimer) { clearTimeout(this._watchDebounceTimer); this._watchDebounceTimer = null; }
    if (typeof ProjectLocalBridgeStorage.stopWatching === 'function') {
      try { ProjectLocalBridgeStorage.stopWatching(); } catch (_) { /* noop */ }
    }
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
      ProjectLocalBridgeStorage.reset();
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
   * Open a .cyco project file by absolute path via the local save bridge.
   * Used by the Open Project dialog (Recent list) and by the auto-restore
   * flow when the editor starts up with a known recents entry.
   */
  async openProjectByPath(filePath) {
    if (!filePath) return false;
    try {
      const response = await ProjectLocalBridgeStorage.readProject({ filePath });
      if (!response?.ok || !response.text) {
        throw new Error(response?.error || 'Project file could not be read.');
      }
      const parsed = JSON.parse(response.text);
      ProjectDiskStorage.reset();
      ProjectLocalBridgeStorage.reset();
      ProjectLocalBridgeStorage.attachTarget({
        filePath: response.filePath,
        projectPath: response.projectPath,
      });
      return this.loadSnapshot(parsed, { recordRecent: true, applyPrefs: true });
    } catch (err) {
      console.error('[ProjectManager] openProjectByPath failed:', err);
      window.dispatchEvent(new CustomEvent('cyco-toast', {
        detail: { message: `Could not open ${filePath}: ${err.message || err}` },
      }));
      return false;
    }
  },

  /**
   * Replace the in-memory project from a snapshot object.
   * Accepts the current .cyco format and legacy localStorage payloads.
   */
  loadSnapshot(rawSnapshot, { recordRecent = true, applyPrefs = true } = {}) {
    let bootstrap = null;
    let result = false;
    this._loadInProgress = true;
    try {
      const snapshot = this._normalizeSnapshot(rawSnapshot);
      this._project = snapshot;
      // IMPORTANT: restore the scene FIRST, before any code path that may
      // call _save() (which would overwrite snapshot.scene with the current,
      // not-yet-restored scene state). applyPrefs is intentionally deferred
      // until after the restore so that the cyco-preferences-change listener
      // sees the restored scene when it re-serializes.
      this._restoreSceneFromSnapshot(snapshot.scene);
      if (applyPrefs && snapshot.prefs) savePrefs(snapshot.prefs);
      if (recordRecent) {
        const filePath = ProjectLocalBridgeStorage.getFilePath?.() || null;
        this._addToRecents({
          id: snapshot.id,
          name: snapshot.name,
          path: snapshot.path,
          filePath,
          timestamp: Date.now(),
        });
      }
      document.dispatchEvent(new CustomEvent('cyco-project-change', {
        detail: { name: snapshot.name, path: snapshot.path },
      }));
      this._save();
      this.startWatching();
      // Refresh the on-disk tree + capture the bootstrap for after-load.
      this.refreshFromDisk();
      bootstrap = snapshot.engineBootstrap;
      result = true;
    } finally {
      // Always clear the load guard so subsequent cyco-scene-dirty /
      // cyco-preferences-change events commit saves as usual. The bootstrap
      // is intentionally NOT awaited — it runs after this function returns.
      this._loadInProgress = false;
    }
    if (bootstrap) {
      this._runEngineBootstrap(bootstrap).catch(err => {
        console.warn('[ProjectManager] _runEngineBootstrap rejected:', err);
      });
    }
    return result;
  },

  /**
   * Execute a user-supplied engine bootstrap script.
   * @param {string|object|null} bootstrap
   *   Either a JS source string, or an object like `{ scriptPath: 'engine/bootstrap.js', source }`
   *   for a script that lives next to the .cyco project file. The script is evaluated
   *   in a sandbox that exposes the same helpers used by the editor.
   */
  async _runEngineBootstrap(bootstrap) {
    if (!bootstrap) return;
    let source = typeof bootstrap === 'string' ? bootstrap : (bootstrap?.source || '');
    const scriptPath = typeof bootstrap === 'object' ? (bootstrap.scriptPath || null) : null;
    // If the project has a scriptPath and a bridge is attached, prefer the
    // freshest copy on disk so edits the user made externally still apply.
    if (scriptPath && ProjectLocalBridgeStorage.hasTarget?.()) {
      const fromDisk = await ProjectLocalBridgeStorage.readBootstrap({ scriptPath });
      if (fromDisk && fromDisk.source) {
        source = fromDisk.source;
      }
    }
    if (!source || typeof source !== 'string') return;
    try {
      const fn = new Function('cyco', 'project', 'projectManager', 'sceneManager', 'objectFactory', `"use strict";\n${source}`);
      fn(window.__cyco, this._project, this, window.__cyco?.sceneManager, window.__cyco?.objectFactory);
      this._debug('engineBootstrap:run', { length: source.length, scriptPath });
    } catch (err) {
      console.warn('[ProjectManager] engineBootstrap failed:', err);
      window.dispatchEvent(new CustomEvent('cyco-toast', {
        detail: { message: `Engine bootstrap failed: ${err?.message || err}` },
      }));
    }
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
      // The bridge may have added an engineBootstrap to the on-disk
      // .cyco file. Mirror that bootstrap into the in-memory project
      // so a subsequent loadSnapshot will run the script.
      if (!ProjectDiskStorage.isDirectoryHandle(directoryHandle) && this._project) {
        const bootstrap = await ProjectLocalBridgeStorage.readBootstrapForCreate?.();
        if (bootstrap && bootstrap.source) {
          this._project.engineBootstrap = {
            source: bootstrap.source,
            scriptPath: bootstrap.scriptPath || 'engine/bootstrap.js',
          };
          this._save();
        }
        // Store the full file path in recents so openById can reload from disk.
        const filePath = ProjectLocalBridgeStorage.getFilePath();
        if (filePath) {
          this._addToRecents({
            id: this._project.id,
            name: this._project.name,
            path: this._project.path,
            filePath,
            timestamp: Date.now(),
          });
        }
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

  /**
   * Convert a tree path (e.g. ['prefabs', 'Box Prefab.cyprefab']) to an
   * absolute disk path inside the project folder, using the path separator
   * appropriate for the current platform.
   */
  treePathToDiskPath(pathArray) {
    if (!this._project) return null;
    const sep = this._project.path?.includes('\\') ? '\\' : '/';
    const parts = [this._project.path, ...pathArray].map(p => String(p).trim()).filter(Boolean);
    return parts.join(sep);
  },

  /**
   * Permanently delete a node (file or folder) from BOTH the in-memory tree
   * AND the on-disk project folder. The bridge's /delete endpoint already
   * handles directories recursively, so a single call removes the whole
   * subtree on disk.
   *
   * Returns { ok: boolean, deleted: string[], errors: string[] }.
   *
   * Without this, `deleteNode` only mutates the in-memory tree. The watcher
   * then re-injects the file from disk on the next poll, undoing the delete.
   */
  async deleteFromDisk(pathArray) {
    if (!this._project) return { ok: false, deleted: [], errors: ['No project open'] };
    if (!pathArray?.length) return { ok: false, deleted: [], errors: ['Empty path'] };
    const node = this._getNodeAt(pathArray);
    if (!node) return { ok: false, deleted: [], errors: ['Node not found'] };

    const deleted = [];
    const errors  = [];

    const haveBridge = !!ProjectLocalBridgeStorage.hasTarget?.() &&
                       typeof ProjectLocalBridgeStorage.deleteFile === 'function';

    if (haveBridge) {
      const abs = this.treePathToDiskPath(pathArray);
      if (abs) {
        try {
          const r = await ProjectLocalBridgeStorage.deleteFile({ absolutePath: abs });
          if (r && r.ok) deleted.push(pathArray.join('/'));
          else errors.push(`${pathArray.join('/')}: ${r?.error || 'unknown error'}`);
        } catch (err) {
          errors.push(`${pathArray.join('/')}: ${err?.message || String(err)}`);
        }
      }
    }

    // Always remove from the in-memory tree, even if the bridge call failed,
    // so the user-visible state matches the delete action. _save() will write
    // a new .cyco without the node and re-materialise the remaining files.
    this.deleteNode(pathArray);

    return { ok: errors.length === 0, deleted, errors };
  },

  /** True if a tree node is a file asset (not a folder). */
  isFileNode(node) {
    return !!node && typeof node === 'object' && node._cycoType === 'file';
  },

  /**
   * Add an imported asset file (e.g. dropped from the OS) to the project tree
   * under pathArray. The file payload is stored in-memory only — it will be
   * included in the project snapshot for Save As.
   */
  importAssetFile(pathArray, { name, mimeType = '', size = 0, data, metadata = {} } = {}) {
    if (!this._project) return false;
    const parent = this._getNodeAt(pathArray) ?? this._project.tree;
    if (typeof parent !== 'object' || parent === null) return false;
    const safe = String(name || 'file').trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
    if (!safe) return false;
    parent[safe] = {
      _cycoType: 'file',
      type: this._guessAssetType(safe, mimeType),
      mimeType: mimeType || '',
      size: size || 0,
      data: data || '',
      metadata: { ...metadata, importedAt: Date.now() },
    };
    this._save();
    document.dispatchEvent(new CustomEvent('cyco-project-change'));
    return true;
  },

  /**
   * Save a prefab definition (a serialised Object3D group + metadata) into the
   * project's `prefabs/` folder. The payload is stored as a JSON string so it
   * round-trips through the existing snapshot mechanism.
   *
   * @param {string} name  The prefab file name (no extension).
   * @param {object} json  The serialised object graph (THREE.Object3D.toJSON()).
   * @returns {string|null}  The final asset name (with .cyprefab), or null on failure.
   */
  savePrefab(name, json) {
    if (!this._project) return null;
    const safe = String(name || 'Prefab').trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
    if (!safe) return null;
    if (!this._getNodeAt(['prefabs'])) this.addFolder([], 'prefabs');
    const parent = this._getNodeAt(['prefabs']);
    if (!parent) return null;
    const fileName = `${safe}.cyprefab`;
    parent[fileName] = {
      _cycoType: 'file',
      type: 'prefab',
      mimeType: 'application/json',
      size: 0,
      data: JSON.stringify(json),
      metadata: {
        createdAt: Date.now(),
        source: 'create-prefab',
        prefabName: safe,
      },
    };
    this._save();
    document.dispatchEvent(new CustomEvent('cyco-project-change'));
    // Also fire a dedicated event so the AssetBrowser can auto-expand the
    // new prefabs/ folder and select the file the user just created.
    document.dispatchEvent(new CustomEvent('cyco-prefab-saved', {
      detail: { fileName, name: safe, path: ['prefabs', fileName] }
    }));
    return fileName;
  },

  /**
   * Read a stored prefab's JSON graph. Returns null if not found.
   * @param {string} fileName  The asset name as it appears in the prefabs folder.
   */
  loadPrefab(fileName) {
    if (!this._project || !fileName) return null;
    const node = this._getNodeAt(['prefabs', fileName]);
    if (!node || !this.isFileNode(node)) return null;
    try { return JSON.parse(node.data || 'null'); }
    catch (_) { return null; }
  },

  _guessAssetType(name, mimeType = '') {
    const ext = String(name).split('.').pop()?.toLowerCase() || '';
    if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'hdr', 'exr', 'ktx2', 'basis'].includes(ext)) return 'texture';
    if (['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'].includes(ext)) return 'audio';
    if (['glb', 'gltf', 'fbx', 'obj'].includes(ext)) return 'model';
    if (['js', 'ts', 'mjs', 'cjs'].includes(ext)) return 'script';
    if (['ttf', 'otf', 'woff', 'woff2'].includes(ext)) return 'font';
    if (['mtl', 'mat'].includes(ext)) return 'material';
    if (ext === 'cyprefab') return 'prefab';
    if (['cyco', 'json'].includes(ext) || mimeType.includes('json')) return 'engine-state';
    return 'file';
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
    const hasDiskTarget = ProjectDiskStorage.hasTarget();
    const hasBridgeTarget = ProjectLocalBridgeStorage.hasTarget();
    if (!hasDiskTarget && !hasBridgeTarget) return;
    if (this._diskWriteSuspended) return;
    if (this._diskWriteTimer) clearTimeout(this._diskWriteTimer);
    this._diskWriteTimer = setTimeout(() => {
      const snapshot = this._buildSnapshot();
      const write = hasDiskTarget
        ? ProjectDiskStorage.writeSnapshot(snapshot)
        : ProjectLocalBridgeStorage.writeSnapshot(snapshot);
      write.catch(err => {
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
    // engineBootstrap is optional user-supplied JS that runs on project
    // open. Stored as either a string of source or { source, scriptPath }.
    const engineBootstrap = (base.engineBootstrap && typeof base.engineBootstrap === 'object')
      ? this._clone(base.engineBootstrap)
      : (typeof base.engineBootstrap === 'string' ? base.engineBootstrap : null);

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
      engineBootstrap,
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
    // Use the <input type="file"> fallback exclusively. The
    // showOpenFilePicker (File System Access) API is unreliable in the
    // embedded browser used to host the editor — selecting a file either
    // throws or its read-back fails, which caused the picker to open twice
    // (once as the native picker, once as the <input> fallback). The
    // fallback works in every environment and is sufficient because the
    // project file is read once and not edited in place.
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

  _addToRecents({ id, name, path, filePath, timestamp }) {
    const recents = this.getRecentProjects().filter(r => r.id !== id);
    const entry = { id, name, path, timestamp };
    if (filePath) entry.filePath = filePath;
    recents.unshift(entry);
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
