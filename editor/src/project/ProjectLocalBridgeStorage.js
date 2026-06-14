/** ProjectLocalBridgeStorage.js - optional localhost bridge for real disk writes */

import ProjectSaveLog from './ProjectSaveLog.js';

const BRIDGE_URL = 'http://127.0.0.1:47623';
const POLL_INTERVAL_MS = 1200;

const ProjectLocalBridgeStorage = {
  _projectFilePath: null,
  _projectPath: null,
  _pollTimer: null,
  _pollListeners: new Set(),

  debug(step, payload = {}) {
    ProjectSaveLog.add('ProjectLocalBridgeStorage', step, payload);
  },

  reset() {
    this._projectFilePath = null;
    this._projectPath = null;
    this.stopWatching();
  },

  hasTarget() {
    return !!this._projectFilePath;
  },

  getProjectPath() {
    return this._projectPath || null;
  },

  getFilePath() {
    return this._projectFilePath || null;
  },

  attachTarget({ filePath = null, projectPath = null } = {}) {
    this._projectFilePath = filePath || null;
    this._projectPath = projectPath || null;
    this.debug('attachTarget', {
      filePath: this._projectFilePath,
      projectPath: this._projectPath,
    });
  },

  async createProject({ name, location, createFolder, tree, snapshot }) {
    const targetLocation = String(location || '').trim();
    if (!targetLocation) {
      throw new Error('No folder path was provided for the local save bridge.');
    }

    this.debug('createProject:start', {
      name,
      location: targetLocation,
      createFolder,
      folderNames: Object.keys(tree || {}),
      snapshotName: snapshot?.name || null,
    });

    const response = await this.fetchJson('/create-project', {
      method: 'POST',
      body: JSON.stringify({
        name,
        location: targetLocation,
        createFolder,
        tree,
        snapshot,
      }),
    });

    this.debug('createProject:complete', response);
    if (response?.filePath) {
      this.attachTarget({ filePath: response.filePath, projectPath: response.projectPath || null });
    }
    return response;
  },

  /**
   * Read back the bootstrap script source that the bridge wrote to disk.
   * Returns `{ source, scriptPath }` or null if no bootstrap exists.
   */
  async readBootstrapForCreate({ filePath = null, scriptPath = 'engine/bootstrap.js' } = {}) {
    const target = filePath || this._projectFilePath;
    if (!target) return null;
    const projectPath = this._projectPath;
    if (!projectPath) return null;
    return this.readBootstrap({ projectPath, scriptPath });
  },

  async writeSnapshot(snapshot) {
    if (!this._projectFilePath) return false;
    const response = await this.fetchJson('/write-project', {
      method: 'POST',
      body: JSON.stringify({
        filePath: this._projectFilePath,
        projectPath: this._projectPath,
        snapshot,
      }),
    });
    this.debug('writeSnapshot:complete', response);
    return !!response?.ok;
  },

  /**
   * Save As: write the .cyco file (and engine state sidecar) inside the
   * project folder. For the local save bridge this is effectively the same
   * as writeSnapshot, but we route through a dedicated endpoint so future
   * "Save As" variants (e.g. JSON, Markdown) can be added without disturbing
   * the live save path.
   */
  async exportAsFolder(snapshot) {
    if (!this._projectFilePath) {
      throw new Error('No project folder is attached for Save As.');
    }
    return this.writeSnapshot(snapshot);
  },

  /**
   * Rescan the project folder and return the on-disk tree.
   * If no projectPath is provided, falls back to the attached target.
   */
  async scanProject({ projectPath = null } = {}) {
    const target = projectPath || this._projectPath;
    if (!target) {
      throw new Error('No project path is attached to scan.');
    }
    return this.fetchJson('/scan-project', {
      method: 'POST',
      body: JSON.stringify({ projectPath: target }),
    }, { timeoutMs: 10_000 });
  },

  /**
   * Read the raw text of a .cyco project file from disk via the bridge.
   * The browser's fetch() cannot read arbitrary file:// paths, so this
   * round-trip is the supported way for the editor to open a project by
   * absolute path.
   */
  async readProject({ filePath } = {}) {
    if (!filePath) {
      throw new Error('No filePath was provided to readProject.');
    }
    return this.fetchJson('/read-project', {
      method: 'POST',
      body: JSON.stringify({ filePath }),
    }, { timeoutMs: 10_000 });
  },

  /**
   * Read the source of a project bootstrap script (e.g. engine/bootstrap.js)
   * from the local save bridge. Returns null if no target is attached or the
   * script does not exist.
   */
  async readBootstrap({ projectPath = null, scriptPath = 'engine/bootstrap.js' } = {}) {
    const target = projectPath || this._projectPath;
    if (!target) return null;
    try {
      const response = await this.fetchJson('/read-bootstrap', {
        method: 'POST',
        body: JSON.stringify({ projectPath: target, scriptPath }),
      }, { timeoutMs: 5_000 });
      if (!response || response.ok === false) return null;
      return response;
    } catch (_) {
      return null;
    }
  },

  /**
   * Start watching the project folder for on-disk changes. Calls
   * `onChange(event)` for each filesystem event. Falls back to polling
   * /watch-poll on systems where the in-process watcher isn't available.
   */
  async startWatching({ onChange } = {}) {
    const projectPath = this._projectPath;
    if (!projectPath) return false;
    if (typeof onChange === 'function') this._onWatchChange = onChange;
    this.stopWatching();

    try {
      await this.fetchJson('/watch-project', {
        method: 'POST',
        body: JSON.stringify({ projectPath }),
      }, { timeoutMs: 5_000 });
      this._pollTimer = setInterval(() => this._pollOnce(), POLL_INTERVAL_MS);
      this.debug('startWatching', { projectPath });
      return true;
    } catch (err) {
      this.debug('startWatching:error', { message: err?.message || String(err) });
      return false;
    }
  },

  async _pollOnce() {
    if (!this._projectPath) return;
    try {
      const response = await this.fetchJson('/watch-poll', {}, { timeoutMs: 3_000 });
      const events = response?.events || [];
      if (events.length && typeof this._onWatchChange === 'function') {
        this._onWatchChange({ events, projectPath: response.projectPath });
      }
    } catch (_) {
      // ignore polling errors; the next tick will retry
    }
  },

  stopWatching() {
    if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
    if (this._projectPath) {
      // Fire-and-forget; we don't block on the bridge response.
      fetch(`${BRIDGE_URL}/unwatch-project`, { method: 'POST' }).catch(() => {});
    }
  },

  async pickFolder() {
    this.debug('pickFolder:start');
    const response = await this.fetchJson('/pick-folder', { method: 'POST' }, { timeoutMs: 5 * 60 * 1000 });
    this.debug('pickFolder:complete', response);
    return response;
  },

  async fetchJson(path, options = {}, { timeoutMs = 3500 } = {}) {
    const controller = new AbortController();
    const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await fetch(`${BRIDGE_URL}${path}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers || {}),
        },
        signal: controller.signal,
      });

      const text = await response.text();
      const payload = text ? JSON.parse(text) : {};
      if (!response.ok || payload?.ok === false) {
        throw new Error(payload?.error || `Local save bridge failed with HTTP ${response.status}.`);
      }
      return payload;
    } catch (err) {
      if (err?.name === 'AbortError') {
        throw new Error(`Local save bridge did not respond within ${Math.round(timeoutMs / 1000)} seconds. Start tools/cyco-local-save-bridge.mjs or use a browser folder picker.`);
      }
      if (err instanceof TypeError) {
        throw new Error('Local save bridge is not running. Start tools/cyco-local-save-bridge.mjs or use a browser folder picker.');
      }
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  },
};

export default ProjectLocalBridgeStorage;
