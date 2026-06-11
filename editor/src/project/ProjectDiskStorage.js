/** ProjectDiskStorage.js - browser File System Access persistence for .cyco projects */

import ProjectSaveLog from './ProjectSaveLog.js';

const ProjectDiskStorage = {
  _projectDirHandle: null,
  _projectFileHandle: null,
  _fileName: null,

  debug(step, payload = {}) {
    ProjectSaveLog.add('ProjectDiskStorage', step, payload);
  },

  reset() {
    this.debug('reset');
    this._projectDirHandle = null;
    this._projectFileHandle = null;
    this._fileName = null;
  },

  hasTarget() {
    return !!(this._projectDirHandle || this._projectFileHandle);
  },

  attachFile(fileHandle, fileName = null) {
    this.debug('attachFile', {
      fileName: fileName || fileHandle?.name || null,
      hasFileHandle: !!fileHandle,
    });
    this._projectDirHandle = null;
    this._projectFileHandle = fileHandle || null;
    this._fileName = fileName || fileHandle?.name || null;
  },

  async createProject({ name, rootDirectoryHandle, createFolder, tree, snapshot }) {
    this.debug('createProject:start', {
      name,
      rootHandleName: rootDirectoryHandle?.name || null,
      createFolder,
      folderNames: Object.keys(tree || {}),
      snapshotName: snapshot?.name || null,
    });
    if (!this.isDirectoryHandle(rootDirectoryHandle)) {
      throw new Error('No writable folder was selected. Use Browse to choose a folder first.');
    }

    const safeName = this.sanitizeName(name);
    const rootHandle = await this.ensureWritableDirectory(rootDirectoryHandle);
    this.debug('createProject:permission-ok', {
      rootHandleName: rootHandle?.name || null,
      safeName,
    });
    const projectDirHandle = createFolder
      ? await rootHandle.getDirectoryHandle(safeName, { create: true })
      : rootHandle;
    this.debug('createProject:project-dir', {
      projectDirName: projectDirHandle?.name || safeName,
      createFolder,
    });

    const fileName = `${safeName}.cyco`;
    await this.ensureFolderTree(projectDirHandle, tree);
    this.debug('createProject:folders-created', {
      projectDirName: projectDirHandle?.name || safeName,
      folderNames: Object.keys(tree || {}),
    });
    const fileHandle = await projectDirHandle.getFileHandle(fileName, { create: true });
    this.debug('createProject:file-handle', { fileName, fileHandleName: fileHandle?.name || null });
    await this.writeJson(fileHandle, snapshot);
    this.debug('createProject:file-written', { fileName });

    this._projectDirHandle = projectDirHandle;
    this._projectFileHandle = fileHandle;
    this._fileName = fileName;

    return { projectDirHandle, fileHandle, fileName };
  },

  async writeSnapshot(snapshot) {
    this.debug('writeSnapshot:start', {
      snapshotName: snapshot?.name || null,
      hasFileHandle: !!this._projectFileHandle,
      hasDirHandle: !!this._projectDirHandle,
      fileName: this._fileName,
    });
    if (!snapshot) return false;

    if (this._projectFileHandle) {
      await this.writeJson(this._projectFileHandle, snapshot);
      this.debug('writeSnapshot:file-written', { fileName: this._fileName || this._projectFileHandle?.name || null });
      return true;
    }

    if (!this._projectDirHandle) return false;
    const fileName = this._fileName || this.projectFileName(snapshot);
    const fileHandle = await this._projectDirHandle.getFileHandle(fileName, { create: true });
    this._projectFileHandle = fileHandle;
    this._fileName = fileName;
    await this.writeJson(fileHandle, snapshot);
    this.debug('writeSnapshot:file-created-written', { fileName });
    return true;
  },

  async ensureFolderTree(dirHandle, tree) {
    if (!tree || typeof tree !== 'object') return;
    for (const [name, child] of Object.entries(tree)) {
      this.debug('ensureFolderTree:create-folder', { folderName: name, parentName: dirHandle?.name || null });
      const childDir = await dirHandle.getDirectoryHandle(name, { create: true });
      if (child && typeof child === 'object') {
        await this.ensureFolderTree(childDir, child);
      }
    }
  },

  async ensureWritableDirectory(dirHandle) {
    if (!this.isDirectoryHandle(dirHandle)) {
      throw new Error('The selected item is not a writable folder.');
    }

    if (typeof dirHandle.queryPermission === 'function') {
      const state = await dirHandle.queryPermission({ mode: 'readwrite' });
      this.debug('permission:query', { handleName: dirHandle?.name || null, state });
      if (state === 'granted') return dirHandle;
    }

    if (typeof dirHandle.requestPermission === 'function') {
      const state = await dirHandle.requestPermission({ mode: 'readwrite' });
      this.debug('permission:request', { handleName: dirHandle?.name || null, state });
      if (state && state !== 'granted') {
        throw new Error('Write permission to the selected folder was not granted.');
      }
    }

    return dirHandle;
  },

  async writeJson(fileHandle, value) {
    if (!fileHandle || typeof fileHandle.createWritable !== 'function') {
      throw new Error('The project file handle cannot be written.');
    }

    const text = JSON.stringify(value, null, 2);
    this.debug('writeJson:start', {
      fileName: fileHandle?.name || null,
      projectName: value?.name || null,
      bytes: text.length,
    });
    const writable = await fileHandle.createWritable();
    await writable.write(text);
    await writable.close();
    this.debug('writeJson:complete', { fileName: fileHandle?.name || null });
  },

  isDirectoryHandle(value) {
    return !!value && typeof value.getDirectoryHandle === 'function';
  },

  sanitizeName(name) {
    const safe = String(name || 'project').trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ');
    return safe || 'project';
  },

  projectFileName(snapshot) {
    return `${this.sanitizeName(snapshot?.name || 'project')}.cyco`;
  },
};

export default ProjectDiskStorage;
