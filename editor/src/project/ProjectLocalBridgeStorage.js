/** ProjectLocalBridgeStorage.js - optional localhost bridge for real disk writes */

import ProjectSaveLog from './ProjectSaveLog.js';

const BRIDGE_URL = 'http://127.0.0.1:47623';

const ProjectLocalBridgeStorage = {
  _projectFilePath: null,
  _projectPath: null,

  debug(step, payload = {}) {
    ProjectSaveLog.add('ProjectLocalBridgeStorage', step, payload);
  },

  reset() {
    this._projectFilePath = null;
    this._projectPath = null;
  },

  hasTarget() {
    return !!this._projectFilePath;
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
