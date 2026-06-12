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
    await this.writeEngineStateFile(projectDirHandle, snapshot);
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
      rendererType: snapshot?.runtime?.renderer?.activeType || snapshot?.prefs?.renderer?.defaultType || null,
      rendererClass: snapshot?.runtime?.renderer?.rendererClass || null,
      sceneChildren: snapshot?.scene?.object?.children?.length ?? 0,
      geometries: snapshot?.scene?.geometries?.length ?? 0,
      materials: snapshot?.scene?.materials?.length ?? 0,
      textures: snapshot?.scene?.textures?.length ?? 0,
      images: snapshot?.scene?.images?.length ?? 0,
    });
    if (!snapshot) return false;

    if (this._projectFileHandle) {
      await this.writeJson(this._projectFileHandle, snapshot);
      if (this._projectDirHandle) await this.writeEngineStateFile(this._projectDirHandle, snapshot);
      this.debug('writeSnapshot:file-written', { fileName: this._fileName || this._projectFileHandle?.name || null });
      return true;
    }

    if (!this._projectDirHandle) return false;
    const fileName = this._fileName || this.projectFileName(snapshot);
    const fileHandle = await this._projectDirHandle.getFileHandle(fileName, { create: true });
    this._projectFileHandle = fileHandle;
    this._fileName = fileName;
    await this.writeJson(fileHandle, snapshot);
    await this.writeEngineStateFile(this._projectDirHandle, snapshot);
    this.debug('writeSnapshot:file-created-written', { fileName });
    return true;
  },

  async ensureFolderTree(dirHandle, tree) {
    if (!tree || typeof tree !== 'object') return;
    for (const [name, child] of Object.entries(tree)) {
      if (this.isFileRecord(child)) continue;
      this.debug('ensureFolderTree:create-folder', { folderName: name, parentName: dirHandle?.name || null });
      const childDir = await dirHandle.getDirectoryHandle(name, { create: true });
      if (child && typeof child === 'object') {
        await this.ensureFolderTree(childDir, child);
      }
    }
  },

  async writeEngineStateFile(projectDirHandle, snapshot) {
    const engineState = snapshot?.engineState;
    if (!projectDirHandle || !engineState) return false;
    try {
      const engineDir = await projectDirHandle.getDirectoryHandle('engine', { create: true });
      const stateFile = await engineDir.getFileHandle('cyco-engine.json', { create: true });
      await this.writeJson(stateFile, engineState);
      this.debug('writeEngineStateFile:complete', { fileName: 'engine/cyco-engine.json' });
      return true;
    } catch (err) {
      this.debug('writeEngineStateFile:error', { message: err?.message || String(err) });
      return false;
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
      rendererType: value?.runtime?.renderer?.activeType || value?.prefs?.renderer?.defaultType || null,
      sceneChildren: value?.scene?.object?.children?.length ?? 0,
      geometries: value?.scene?.geometries?.length ?? 0,
      materials: value?.scene?.materials?.length ?? 0,
      textures: value?.scene?.textures?.length ?? 0,
      images: value?.scene?.images?.length ?? 0,
    });
    const writable = await fileHandle.createWritable();
    await writable.write(text);
    await writable.close();
    this.debug('writeJson:complete', { fileName: fileHandle?.name || null });
  },

  isDirectoryHandle(value) {
    return !!value && typeof value.getDirectoryHandle === 'function';
  },

  isFileRecord(value) {
    return !!value && typeof value === 'object' && value._cycoType === 'file';
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
