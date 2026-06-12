/** NewProjectDialog.js — modal dialog for creating a new project */

import ProjectManager from '../project/ProjectManager.js';
import ProjectLocalBridgeStorage from '../project/ProjectLocalBridgeStorage.js';
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
          <details class="ce-np-save-log">
            <summary>Save Log</summary>
            <pre class="ce-np-save-log-report" id="np-save-log-report">No save log entries yet.</pre>
          </details>
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
    const saveLogReport  = dlg.querySelector('#np-save-log-report');
    const createBtn      = dlg.querySelector('#np-create');
    const cancelBtn      = dlg.querySelector('#np-cancel');
    const browseBtn      = dlg.querySelector('#np-browse');
    const useFoldersCb   = dlg.querySelector('#np-use-folders');
    const addFolderBtn   = dlg.querySelector('#np-add-folder');
    const chipsContainer = dlg.querySelector('#np-folder-chips');
    let selectedDirectoryHandle = null;
    let isPickingDirectory = false;
    ProjectSaveLog.clear();
    const unsubscribeSaveLog = ProjectSaveLog.subscribe((entries) => {
      saveLogReport.textContent = ProjectSaveLog.format(entries);
    });
    dlg.__unsubscribeSaveLog = unsubscribeSaveLog;
    this._debug('dialog:open', {
      hasShowDirectoryPicker: typeof window.showDirectoryPicker === 'function',
      hasCycoPicker: typeof window.__cyco?.pickDirectory === 'function',
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
      const pickDirectory = window.__cyco?.pickDirectory;
      this._debug('pick:start', {
        hasCycoPicker: typeof pickDirectory === 'function',
        hasBrowserPicker: typeof window.showDirectoryPicker === 'function',
        hasLocalBridgePicker: true,
        userActivationActive: !!navigator.userActivation?.isActive,
      });

      let dirResult = null;
      const attempts = [];
      attempts.push(['local-bridge', async () => {
        const result = await ProjectLocalBridgeStorage.pickFolder();
        if (!result?.ok || !result.path) {
          const err = new Error('Folder selection was cancelled.');
          err.name = 'AbortError';
          throw err;
        }
        return result.path;
      }]);
      // File pickers must be opened directly inside the click gesture.
      if (typeof window.showDirectoryPicker === 'function') {
        attempts.push(['browser-direct', () => window.showDirectoryPicker({ mode: 'readwrite' })]);
      } else if (typeof pickDirectory === 'function') {
        attempts.push(['cyco-wrapper', () => pickDirectory({ mode: 'readwrite' })]);
      }

      for (const [label, runPicker] of attempts) {
        try {
          this._debug('pick:attempt', {
            label,
            userActivationActive: !!navigator.userActivation?.isActive,
          });
          dirResult = await runPicker();
          this._debug('pick:attempt-success', {
            label,
            resultType: dirResult?.constructor?.name || typeof dirResult,
            resultName: dirResult?.name || dirResult?.handle?.name || null,
          });
          break;
        } catch (err) {
          this._debug('pick:attempt-error', {
            label,
            name: err?.name || '',
            message: err?.message || String(err),
            userActivationActive: !!navigator.userActivation?.isActive,
          });
          throw err;
        }
      }

      if (!dirResult) throw new Error('No folder was selected.');
      const handle = dirResult?.handle || (dirResult && typeof dirResult.getDirectoryHandle === 'function' ? dirResult : null);
      const pickedPath = typeof dirResult === 'string'
        ? dirResult
        : dirResult?.path || dirResult?.fullPath || dirResult?.name || '';
      this._debug('pick:result', {
        resultType: dirResult?.constructor?.name || typeof dirResult,
        pickedPath,
        handleName: handle?.name || null,
        hasDirectoryHandle: !!handle,
      });
      return { handle, pickedPath };
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
      try {
        const { handle, pickedPath } = await pickWritableDirectory();
        selectedDirectoryHandle = handle;
        if (pickedPath) setLocationValue(pickedPath);
        this._debug('browse:selected', {
          pickedPath,
          handleName: selectedDirectoryHandle?.name || null,
          hasHandle: !!selectedDirectoryHandle,
        });
        if (!selectedDirectoryHandle) {
          pathHint.textContent = 'That picker only returned a path label. Pick a writable folder from the browser folder picker.';
          pathHint.style.color = 'var(--ce-accent-orange)';
          return;
        }
        pathHint.textContent = 'Selected directory updated in the Location field.';
        pathHint.style.color = '';
      } catch (err) {
        this._debug('browse:error', { message: err?.message || String(err), name: err?.name || '' });
        pathHint.textContent = err?.name === 'AbortError'
          ? 'The folder picker did not return a folder. Type a full folder path to use the local save bridge.'
          : (err?.message || 'Could not access that directory.');
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
        hasHandle: !!selectedDirectoryHandle,
        handleName: selectedDirectoryHandle?.name || null,
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
        if (!selectedDirectoryHandle && !location) {
          this._debug('create:auto-pick-target');
          try {
            const picked = await pickWritableDirectory();
            selectedDirectoryHandle = picked.handle;
            if (picked.pickedPath) setLocationValue(picked.pickedPath);
          } catch (err) {
            this._debug('create:auto-pick-failed', { message: err?.message || String(err), name: err?.name || '' });
            pathHint.textContent = err?.name === 'AbortError'
              ? 'Pick a writable folder or type a full folder path to continue.'
              : (err?.message || 'Choose a writable folder with Browse, or type a full folder path for the local save bridge.');
            pathHint.style.color = 'var(--ce-accent-orange)';
            locationInput.focus();
            return;
          }
        }

        const resolvedLocation = location || selectedDirectoryHandle.name || 'Selected Folder';
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
          handleName: selectedDirectoryHandle?.name || null,
          hasHandle: !!selectedDirectoryHandle,
          saveMode: selectedDirectoryHandle ? 'browser-handle' : 'local-bridge',
        });
        createBtn.disabled = true;
        createBtn.textContent = 'Creating...';
        await ProjectManager.createOnDisk(name, resolvedLocation, createFolder, folders, selectedDirectoryHandle);
        this._debug('create:success', { name, location: resolvedLocation });
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
      this._dialog.__unsubscribeSaveLog?.();
      this._dialog.close();
      this._dialog.remove();
      this._dialog = null;
    }
  },
};

export default NewProjectDialog;
