/** NewProjectDialog.js — modal dialog for creating a new project */

import ProjectManager from '../project/ProjectManager.js';
import ProjectSaveLog from '../project/ProjectSaveLog.js';

const NewProjectDialog = {
  _dialog: null,

  _debug(step, payload = {}) {
    ProjectSaveLog.add('NewProject', step, payload);
  },

  open() {
    if (this._dialog) { this._dialog.remove(); this._dialog = null; }

    const dlg = document.createElement('dialog');
    dlg.className = 'ce-new-project-dialog';
    dlg.innerHTML = `
      <div class="ce-np-title">New Project</div>
      <div class="ce-np-body">
        <div class="ce-np-row">
          <label class="ce-np-label" for="np-name">Project Name</label>
          <input class="ce-np-input" id="np-name" type="text" placeholder="My Game" autocomplete="off" spellcheck="false">
        </div>
        <div class="ce-np-row">
          <label class="ce-np-label" for="np-location">Location</label>
          <div class="ce-np-path-row">
            <input class="ce-np-input ce-np-path-input" id="np-location" type="text" placeholder="C:/Projects" autocomplete="off" spellcheck="false">
            <button class="ce-btn ce-np-browse-btn" id="np-browse" title="Browse for folder">…</button>
          </div>
          <span class="ce-np-path-hint" id="np-path-hint"></span>
          <div class="ce-np-save-log">
            <div class="ce-np-save-log-head">
              <button class="ce-btn ce-np-save-log-btn" id="np-save-log-toggle" type="button">Save Log</button>
              <button class="ce-btn ce-np-copy-log-btn" id="np-copy-log" type="button" title="Copy log">
                <svg class="ce-np-copy-log-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                  <path d="M5 5.5A1.5 1.5 0 0 1 6.5 4h5A1.5 1.5 0 0 1 13 5.5v5A1.5 1.5 0 0 1 11.5 12h-5A1.5 1.5 0 0 1 5 10.5v-5Zm1 0v5c0 .28.22.5.5.5h5c.28 0 .5-.22.5-.5v-5a.5.5 0 0 0-.5-.5h-5a.5.5 0 0 0-.5.5Zm-3 3A1.5 1.5 0 0 1 4.5 7h.5v1h-.5a.5.5 0 0 0-.5.5v5c0 .28.22.5.5.5h5a.5.5 0 0 0 .5-.5V13h1v.5A1.5 1.5 0 0 1 9.5 15h-5A1.5 1.5 0 0 1 3 13.5v-5Z"></path>
                </svg>
                <span class="ce-np-copy-log-label">Copy Log</span>
              </button>
            </div>
              <pre class="ce-np-save-log-report" id="np-save-log-report">No save log entries yet.</pre>
          </div>
        </div>
        <div class="ce-np-row ce-np-checkbox-row">
          <label class="ce-np-checkbox-label">
            <input type="checkbox" id="np-create-folder" checked>
            <span>Create a folder with the project name</span>
          </label>
        </div>
        <div class="ce-np-preview-row">
          <span class="ce-np-preview-label">Project Path:</span>
          <span class="ce-np-preview-path" id="np-preview-path">—</span>
        </div>
        <div class="ce-np-folder-list">
          <div class="ce-np-folder-list-header">
            <label class="ce-np-checkbox-label">
              <input type="checkbox" id="np-use-folders" checked>
              <span class="ce-np-folder-list-label">Default folders that will be created:</span>
            </label>
            <button class="ce-btn primary ce-np-add-folder-btn" id="np-add-folder" title="Add a custom folder">＋ Add Folder</button>
          </div>
          <div class="ce-np-folder-chips" id="np-folder-chips"></div>
        </div>
      </div>
      <div class="ce-np-actions">
        <button class="ce-btn ghost" id="np-cancel">Cancel</button>
        <button class="ce-btn primary" id="np-create">Create Project</button>
      </div>
    `;

    document.body.appendChild(dlg);
    this._dialog = dlg;
    this._bindEvents(dlg);
    dlg.showModal();
    dlg.querySelector('#np-name').focus();
  },

  // ── Folder chips ────────────────────────────────────────────────────────────

  _defaultFolders: ['audio','fonts','materials','models','prefabs','scenes','scripts','textures'],

  _buildChips(container) {
    container.innerHTML = '';
    for (const name of this._defaultFolders) {
      container.appendChild(this._makeChip(name));
    }
  },

  _makeChip(name) {
    const chip = document.createElement('span');
    chip.className = 'ce-np-chip';
    chip.dataset.folder = name;
    chip.textContent = name;
    const rm = document.createElement('button');
    rm.className = 'ce-np-chip-remove';
    rm.textContent = '×';
    rm.title = 'Remove folder';
    rm.addEventListener('click', () => chip.remove());
    chip.appendChild(rm);
    return chip;
  },

  _startAddFolder(container) {
    // Prevent double-adding
    if (container.querySelector('.ce-np-chip-input')) return;
    const chip = document.createElement('span');
    chip.className = 'ce-np-chip ce-np-chip-editing';
    const input = document.createElement('input');
    input.className = 'ce-np-chip-input';
    input.placeholder = 'folder name';
    input.maxLength = 40;
    input.autocomplete = 'off';
    input.spellcheck = false;
    const confirm = () => {
      const val = input.value.trim().replace(/[^a-zA-Z0-9_\-]/g, '');
      chip.remove();
      if (val) container.appendChild(this._makeChip(val));
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter')  { e.preventDefault(); confirm(); }
      if (e.key === 'Escape') { chip.remove(); }
    });
    input.addEventListener('blur', confirm);
    chip.appendChild(input);
    container.appendChild(chip);
    input.focus();
  },

  // ── Events ──────────────────────────────────────────────────────────────────

  _bindEvents(dlg) {
    const nameInput      = dlg.querySelector('#np-name');
    const locationInput  = dlg.querySelector('#np-location');
    const createFolderCb = dlg.querySelector('#np-create-folder');
    const previewPath    = dlg.querySelector('#np-preview-path');
    const pathHint       = dlg.querySelector('#np-path-hint');
    const saveLogBtn     = dlg.querySelector('#np-save-log-toggle');
    const saveLogReport  = dlg.querySelector('#np-save-log-report');
    const copyLogBtn     = dlg.querySelector('#np-copy-log');
    const createBtn      = dlg.querySelector('#np-create');
    const cancelBtn      = dlg.querySelector('#np-cancel');
    const browseBtn      = dlg.querySelector('#np-browse');
    const useFoldersCb   = dlg.querySelector('#np-use-folders');
    const addFolderBtn   = dlg.querySelector('#np-add-folder');
    const chipsContainer = dlg.querySelector('#np-folder-chips');
    let selectedDirectoryHandle = null;
    let selectedFileHandle = null;
    let isPickingDirectory = false;
    let currentSaveLogText = ProjectSaveLog.format();
    let copyLogResetTimer = null;
    let saveLogOpen = false;
    ProjectSaveLog.clear();
    const unsubscribeSaveLog = ProjectSaveLog.subscribe((entries) => {
      currentSaveLogText = ProjectSaveLog.format(entries);
      saveLogReport.textContent = currentSaveLogText;
    });
    dlg.__unsubscribeSaveLog = unsubscribeSaveLog;

    const syncSaveLogVisibility = () => {
      saveLogReport.hidden = !saveLogOpen;
      saveLogBtn?.setAttribute('aria-expanded', saveLogOpen ? 'true' : 'false');
      saveLogBtn?.classList.toggle('is-open', saveLogOpen);
    };
    syncSaveLogVisibility();

    const setCopyLogState = (copied) => {
      if (!copyLogBtn) return;
      const label = copyLogBtn.querySelector('.ce-np-copy-log-label');
      copyLogBtn.classList.toggle('is-copied', copied);
      copyLogBtn.setAttribute('aria-pressed', copied ? 'true' : 'false');
      if (label) label.textContent = copied ? 'Copied' : 'Copy Log';
      copyLogBtn.title = copied ? 'Copied to clipboard' : 'Copy save log';
      if (copyLogResetTimer) {
        clearTimeout(copyLogResetTimer);
        copyLogResetTimer = null;
        dlg.__copyLogResetTimer = null;
      }
      if (copied) {
        copyLogResetTimer = setTimeout(() => setCopyLogState(false), 1400);
        dlg.__copyLogResetTimer = copyLogResetTimer;
      }
    };

    const copySaveLog = async () => {
      const text = currentSaveLogText || ProjectSaveLog.format();
      if (!text) return;

      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          const temp = document.createElement('textarea');
          temp.value = text;
          temp.setAttribute('readonly', '');
          temp.style.position = 'fixed';
          temp.style.left = '-9999px';
          temp.style.top = '-9999px';
          document.body.appendChild(temp);
          temp.select();
          document.execCommand('copy');
          temp.remove();
        }
        setCopyLogState(true);
      } catch (err) {
        this._debug('save-log:copy-error', { message: err?.message || String(err) });
      }
    };

    copyLogBtn?.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
    });
    copyLogBtn?.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await copySaveLog();
    });

    saveLogBtn?.addEventListener('click', () => {
      saveLogOpen = !saveLogOpen;
      syncSaveLogVisibility();
    });

    this._debug('dialog:open', {
      hasShowDirectoryPicker: typeof window.showDirectoryPicker === 'function',
      hasCycoPicker: typeof window.__cyco_native?.pickDirectory === 'function' || typeof window.__cyco?.pickDirectory === 'function',
      href: window.location?.href || '',
      isSecureContext: !!window.isSecureContext,
      initialLocation: locationInput.value,
    });

    // Populate initial chips
    this._buildChips(chipsContainer);

    const setLocationValue = (nextLocation) => {
      const value = String(nextLocation || '').trim();
      locationInput.value = value;
      this._debug('location:set-programmatic', { value });
      locationInput.dispatchEvent(new Event('input', { bubbles: true }));
    };

    const normalizePath = (value) => String(value || '')
      .trim()
      .replace(/\\+/g, '/')
      .replace(/\/+/g, '/')
      .replace(/\/$/, '');

    const safeProjectName = (value) => String(value || 'project')
      .trim()
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, ' ') || 'project';

    // Toggle: enable/disable folders
    const syncFolderState = () => {
      const on = useFoldersCb.checked;
      chipsContainer.classList.toggle('is-disabled', !on);
      addFolderBtn.disabled = !on;
      this._debug('folders:toggle', { enabled: on });
    };
    useFoldersCb.addEventListener('change', syncFolderState);
    syncFolderState();

    addFolderBtn.addEventListener('click', () => {
      this._debug('folders:add-click');
      this._startAddFolder(chipsContainer);
    });

    const updatePreview = () => {
      const name   = nameInput.value.trim()     || '(name)';
      const loc    = normalizePath(locationInput.value);
      const base   = loc || '(choose location)';
      const projectFolder = createFolderCb.checked ? `${base}/${safeProjectName(nameInput.value || 'project')}` : base;
      const create = createFolderCb.checked;
      previewPath.textContent = create ? `${projectFolder}/` : `${base}/`;
      this._debug('preview:update', {
        name,
        location: base,
        createFolder: create,
        projectPath: previewPath.textContent,
      });
    };

    nameInput.addEventListener('input', () => {
      this._debug('name:input', { value: nameInput.value });
      updatePreview();
    });
    locationInput.addEventListener('input', () => {
      this._debug('location:input', {
        value: locationInput.value,
        hasSelectedHandle: !!selectedDirectoryHandle,
        selectedHandleName: selectedDirectoryHandle?.name || null,
      });
      updatePreview();
    });
    createFolderCb.addEventListener('change', () => {
      this._debug('create-folder:toggle', { checked: createFolderCb.checked });
      updatePreview();
    });
    updatePreview();

    const pickWritableDirectory = async () => {
      const savePicker = typeof window.showSaveFilePicker === 'function'
        ? window.showSaveFilePicker
        : null;
      const primaryRunner = savePicker;
      const primarySource = 'browser-save-file';
      if (!primaryRunner) {
        throw new Error('This browser cannot choose a project file. Use a Chromium browser with File System Access enabled.');
      }

      this._debug('pick:start', {
        hasBrowserPicker: !!savePicker,
        hasLocalBridgePicker: false,
        useLocalBridgeFirst: false,
        primarySource,
        userActivationActive: !!navigator.userActivation?.isActive,
        visibilityState: document.visibilityState,
        hasFocus: document.hasFocus(),
      });

      const pickStartedAt = performance.now();
      const pendingLogTimer = setTimeout(() => {
        this._debug('pick:pending', {
          label: primarySource,
          elapsedMs: Math.round(performance.now() - pickStartedAt),
          userActivationActive: !!navigator.userActivation?.isActive,
          visibilityState: document.visibilityState,
          hasFocus: document.hasFocus(),
        });
      }, 1500);

      const runAttempt = async (runner, source) => {
        if (!runner) return null;
        this._debug('pick:attempt', {
          label: source,
          userActivationActive: !!navigator.userActivation?.isActive,
          pickerType: typeof runner,
          pickerName: runner?.name || null,
          pickerSource: source,
        });
        const result = await runner();
        const candidateHandle = result && typeof result.createWritable === 'function' ? result : result?.handle || null;
        const pickedPath = String(candidateHandle?.name || result?.name || '');
        this._debug('pick:attempt-success', {
          label: source,
          elapsedMs: Math.round(performance.now() - pickStartedAt),
          resultType: result?.constructor?.name || typeof result,
          resultName: pickedPath || null,
          hasHandle: !!candidateHandle,
          hasWritableFileHandle: typeof result?.createWritable === 'function',
          handlePermission: candidateHandle?.queryPermission ? 'queryPermission-available' : 'queryPermission-missing',
          pickerSource: source,
        });
        return { handle: candidateHandle, pickedPath, source };
      };

      try {
        const pickerOptions = {
          suggestedName: `${safeProjectName(nameInput.value || 'project')}.cyco`,
          startIn: 'documents',
          types: [{
            description: 'Cyco Project',
            accept: { 'application/json': ['.cyco', '.json'] },
          }],
        };
        return await runAttempt(() => primaryRunner(pickerOptions), primarySource);
      } finally {
        clearTimeout(pendingLogTimer);
      }
    };

    browseBtn.addEventListener('click', async () => {
      if (isPickingDirectory) {
        this._debug('browse:ignored-pending');
        return;
      }
      this._debug('browse:click', { currentLocation: locationInput.value });
      isPickingDirectory = true;
      browseBtn.disabled = true;
      const oldBrowseText = browseBtn.textContent;
      browseBtn.textContent = '...';
      const browseStartedAt = performance.now();
      try {
        const picked = await pickWritableDirectory();
        if (!picked) {
          pathHint.textContent = 'No project file selected. You can still create the project in browser storage, or type a file path.';
          pathHint.style.color = '';
          return;
        }
        const { handle, pickedPath } = picked;
        selectedDirectoryHandle = null;
        selectedFileHandle = handle;
        const selectedLocation = pickedPath || selectedFileHandle?.name || '';
        if (selectedLocation) setLocationValue(selectedLocation);
        this._debug('browse:selection-handoff', {
          selectedLocation,
          pickedPath,
          handleName: selectedFileHandle?.name || null,
          locationInputValue: locationInput.value,
          previewPath: previewPath.textContent,
          hasHandle: !!selectedFileHandle,
          pickerSource: picked?.source || null,
        });
        this._debug('browse:selected', {
          elapsedMs: Math.round(performance.now() - browseStartedAt),
          pickedPath: selectedLocation,
          handleName: selectedFileHandle?.name || null,
          hasHandle: !!selectedFileHandle,
          handleType: selectedFileHandle?.constructor?.name || typeof selectedFileHandle,
          canQueryPermission: typeof selectedFileHandle?.queryPermission === 'function',
          canRequestPermission: typeof selectedFileHandle?.requestPermission === 'function',
          pickerSource: picked?.source || null,
        });
        pathHint.textContent = selectedFileHandle
          ? 'Selected project file is ready for saving.'
          : 'Selected project file path is ready for project creation.';
        pathHint.style.color = '';
      } catch (err) {
        this._debug('browse:error', { message: err?.message || String(err), name: err?.name || '' });
        const message = err?.message || String(err);
        pathHint.textContent = message || 'Could not access that directory.';
        pathHint.style.color = 'var(--ce-accent-orange)';
      } finally {
        isPickingDirectory = false;
        browseBtn.disabled = false;
        browseBtn.textContent = oldBrowseText;
      }
    });

    const doCreate = () => {
        this._debug('create:button-click', {
          rawName: nameInput.value,
          rawLocation: locationInput.value,
          hasHandle: !!selectedFileHandle,
          handleName: selectedFileHandle?.name || null,
        });
      (async () => {
        const name = nameInput.value.trim();
        if (!name) {
          this._debug('create:blocked-no-name');
          nameInput.style.borderColor = 'var(--ce-accent-orange)';
          nameInput.focus();
          return;
        }
        const location = locationInput.value.trim();
        const resolvedLocation = location || selectedFileHandle?.name || '';
        const createFolder = createFolderCb.checked;
        const useFolders = useFoldersCb.checked;
        const folders = useFolders
          ? Array.from(chipsContainer.querySelectorAll('.ce-np-chip[data-folder]'))
              .map(c => c.dataset.folder).filter(Boolean)
          : [];

        this._debug('create:start', {
          name,
          location: resolvedLocation,
          createFolder,
          useFolders,
          folders,
          handleName: selectedFileHandle?.name || null,
          hasHandle: !!selectedFileHandle,
          handleType: selectedFileHandle?.constructor?.name || typeof selectedFileHandle,
          canQueryPermission: typeof selectedFileHandle?.queryPermission === 'function',
          canRequestPermission: typeof selectedFileHandle?.requestPermission === 'function',
          saveMode: selectedFileHandle
            ? 'browser-file-handle'
            : (resolvedLocation ? 'browser-storage' : 'browser-storage'),
        });
        createBtn.disabled = true;
        createBtn.textContent = 'Creating...';
        const project = await ProjectManager.createOnDisk(name, resolvedLocation, createFolder, folders, null, selectedFileHandle);
        this._debug('create:success', {
          name,
          location: project?.path || resolvedLocation,
          storageMode: project?.storageMode || (selectedFileHandle ? 'browser-file-handle' : 'browser-storage'),
        });
        this._close();
      })().catch(err => {
        this._debug('create:error', { message: err?.message || String(err), error: err });
        console.error('[NewProjectDialog] Failed to create project:', err);
        pathHint.textContent = err?.message ? `Could not create project: ${err.message}` : 'Could not create project.';
        pathHint.style.color = 'var(--ce-accent-orange)';
        createBtn.disabled = false;
        createBtn.textContent = 'Create Project';
      });
    };

    createBtn.addEventListener('click', doCreate);
    cancelBtn.addEventListener('click', () => this._close());

    dlg.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this._close();
      if (e.key === 'Enter' && document.activeElement !== cancelBtn) doCreate();
    });
  },

  _close() {
    if (this._dialog) {
      if (this._dialog.__copyLogResetTimer) {
        clearTimeout(this._dialog.__copyLogResetTimer);
        this._dialog.__copyLogResetTimer = null;
      }
      this._dialog.__unsubscribeSaveLog?.();
      this._dialog.close();
      this._dialog.remove();
      this._dialog = null;
    }
  },
};

export default NewProjectDialog;
