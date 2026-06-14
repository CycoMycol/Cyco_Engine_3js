/** ProjectDiskStorage.js - File System Access API backed project persistence */

import ProjectSaveLog from './ProjectSaveLog.js';

const ProjectDiskStorage = {
  _fileHandle: null,
  _projectFileName: null,

  debug(step, payload = {}) {
    ProjectSaveLog.add('ProjectDiskStorage', step, payload);
  },

  reset() {
    this._fileHandle = null;
    this._projectFileName = null;
  },

  hasTarget() {
    return !!this._fileHandle;
  },

  attachFile(fileHandle, projectFileName = null) {
    this._fileHandle = fileHandle || null;
    this._projectFileName = projectFileName || fileHandle?.name || null;
    this.debug('attachFile', {
      projectFileName: this._projectFileName,
      hasHandle: !!this._fileHandle,
    });
  },

  isDirectoryHandle(handle) {
    return !!handle && typeof handle.getDirectoryHandle === 'function' && typeof handle.getFileHandle === 'function';
  },

  async createProject({ name, rootDirectoryHandle, createFolder, tree, snapshot }) {
    if (!this.isDirectoryHandle(rootDirectoryHandle)) {
      throw new Error('A writable directory handle is required to create a disk project.');
    }

    const projectDir = createFolder ? await rootDirectoryHandle.getDirectoryHandle(name, { create: true }) : rootDirectoryHandle;
    const fileName = this._projectFileName(snapshot || { name });
    const fileHandle = await projectDir.getFileHandle(fileName, { create: true });
    this.attachFile(fileHandle, fileName);
    await this.writeSnapshot(snapshot);
    return {
      ok: true,
      fileName,
      projectPath: projectDir.name || null,
      folderNames: Object.keys(tree || {}),
    };
  },

  async writeSnapshot(snapshot) {
    if (!this._fileHandle) return false;
    const writable = await this._fileHandle.createWritable();
    try {
      await writable.write(JSON.stringify(snapshot, null, 2));
      await writable.close();
      this.debug('writeSnapshot:complete', {
        projectFileName: this._projectFileName,
        snapshotName: snapshot?.name || null,
      });
      return true;
    } catch (err) {
      try { await writable.abort(); } catch (_) {}
      throw err;
    }
  },

  _projectFileName(snapshot = {}) {
    const name = String(snapshot?.name || 'project').trim().replace(/[\\/:*?"<>|]+/g, '-');
    return `${name || 'project'}.cyco`;
  },
};

export default ProjectDiskStorage;
