/**
 * SaveProjectAsDialog.js - modal dialog for "Save Project As..."
 *
 * Mirrors the mechanics of NewProjectDialog (folder picker, browse, validation,
 * live preview, default-folder chips, save log) but writes a brand-new copy of
 * the CURRENT project to a user-chosen location and switches the active
 * project to that copy. Does NOT touch NewProjectDialog or its state - the two
 * dialogs are independent and share only the .ce-np-* CSS hooks.
 *
 * Flow:
 *   1. User clicks File -> Save Project As...
 *   2. Pre-prompt: "Do you want to save the current project first?"
 *      [Save] [Don't Save] [Cancel]
 *   3. If Save -> ProjectManager.saveProjectFile() runs first
 *      If Cancel -> abort
 *   4. Open this dialog (clone of NewProjectDialog UX, retitled).
 *   5. On Save -> ProjectManager.saveAsNewProject(name, location, ...)
 *      -> writes a new .cyco with a fresh id + the current snapshot's data
 *      -> switches the active project to the new copy
 */

import ProjectManager             from '../project/ProjectManager.js';
import ProjectLocalBridgeStorage  from '../project/ProjectLocalBridgeStorage.js';
import ProjectSaveLog             from '../project/ProjectSaveLog.js';
import FolderPickerPanel          from './FolderPickerPanel.js';

const SaveProjectAsDialog = {
  _dialog: null,

  _debug(step, payload = {}) {
    ProjectSaveLog.add('SaveProjectAs', step, payload);
  },

  _esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  /**
   * Public entry point. Always safe to call - if no project is open it
   * shows a toast and returns.
   */
  async open() {
    if (!ProjectManager.getCurrent()) {
      window.dispatchEvent(new CustomEvent('cyco-toast', {
        detail: { message: 'No project is open. Create or open a project before using Save As.' },
      }));
      return;
    }

    // Pre-prompt: ask the user about saving the current project first.
    const proceed = await this._confirmSaveCurrentFirst();
    if (!proceed) return;

    // Either "Save" ran successfully or "Don't Save" was chosen - open dialog.
    this._openDialog();
  },

  /**
   * Three-button pre-prompt: Save / Don't Save / Cancel.
   * Returns true if the user wants to proceed with Save As, false on cancel.
   * If "Save" was chosen, attempts ProjectManager.saveProjectFile() first.
   */
  _confirmSaveCurrentFirst() {
    const current = ProjectManager.getCurrent();
    const projectName = current?.name || 'Untitled Project';

    return new Promise((resolve) => {
      const dlg = document.createElement('dialog');
      dlg.className = 'ce-mini-dialog ce-saveas-preprompt';
      dlg.innerHTML = `
        <div class="ce-mini-msg">
          Do you want to save the current project "<b>${this._esc(projectName)}</b>" before saving as a new project?
        </div>
        <div class="ce-mini-actions ce-saveas-preprompt-actions">
          <button class="ce-btn ghost ce-saveas-cancel">Cancel</button>
          <button class="ce-btn ghost ce-saveas-dont-save">Don't Save</button>
          <button class="ce-btn primary ce-saveas-save">Save</button>
        </div>
      `;
      document.body.appendChild(dlg);

      const saveBtn     = dlg.querySelector('.ce-saveas-save');
      const dontSaveBtn = dlg.querySelector('.ce-saveas-dont-save');
      const cancelBtn   = dlg.querySelector('.ce-saveas-cancel');

      const cleanup = () => { dlg.close(); dlg.remove(); };

      cancelBtn.addEventListener('click', () => { cleanup(); resolve(false); });
      dontSaveBtn.addEventListener('click', () => { cleanup(); resolve(true); });

      saveBtn.addEventListener('click', async () => {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
        try {
          await ProjectManager.saveProjectFile();
          cleanup();
          resolve(true);
        } catch (err) {
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save';
          const msg = err?.message || String(err);
          dlg.querySelector('.ce-mini-msg').innerHTML =
            `<span style="color:var(--ce-accent-orange)">Could not save current project: ${this._esc(msg)}</span><br>` +
            `<span style="opacity:.7">You can still Save As, or Cancel and try again.</span>`;
        }
      });

      dlg.addEventListener('click', (e) => { if (e.target === dlg) { cleanup(); resolve(false); } });
      dlg.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { cleanup(); resolve(false); }
      });

      dlg.showModal();
      saveBtn.focus();
    });
  },

  // --- The Save As dialog itself ---------------------------------------------

  _openDialog() {
    if (this._dialog) { this._dialog.remove(); this._dialog = null; }

    const current = ProjectManager.getCurrent();
    const defaultName = this._suggestedName(current?.name);

    const dlg = document.createElement('dialog');
    dlg.className = 'ce-new-project-dialog ce-saveas-dialog';
    dlg.innerHTML = `
      <div class="ce-np-title">Save Project As...</div>
      <div class="ce-np-body">
        <div class="ce-np-row">
          <label class="ce-np-label" for="sa-name">Project Name</label>
          <input class="ce-np-input" id="sa-name" type="text" placeholder="My Game" autocomplete="off" spellcheck="false">
        </div>
        <div class="ce-np-row">
          <label class="ce-np-label" for="sa-location">Location</label>
          <div class="ce-np-path-row">
            <input class="ce-np-input ce-np-path-input" id="sa-location" type="text" placeholder="C:/Projects" autocomplete="off" spellcheck="false">
            <button class="ce-btn ce-np-browse-btn" id="sa-browse" title="Browse for folder">...</button>
          </div>
          <span class="ce-np-path-hint" id="sa-path-hint"></span>
          <details class="ce-np-save-log">
            <summary>Save Log</summary>
            <pre class="ce-np-save-log-report" id="sa-save-log-report">No save log entries yet.</pre>
          </details>
        </div>
        <div class="ce-np-row ce-np-checkbox-row">
          <label class="ce-np-checkbox-label">
            <input type="checkbox" id="sa-create-folder" checked>
            <span>Create a folder with the project name</span>
          </label>
        </div>
        <div class="ce-np-preview-row">
          <span class="ce-np-preview-label">Project Path:</span>
          <span class="ce-np-preview-path" id="sa-preview-path">-</span>
        </div>
        <div class="ce-np-folder-list">
          <div class="ce-np-folder-list-header">
            <label class="ce-np-checkbox-label">
              <input type="checkbox" id="sa-use-folders" checked>
              <span class="ce-np-folder-list-label">Folders that will be created:</span>
            </label>
            <button class="ce-btn primary ce-np-add-folder-btn" id="sa-add-folder" title="Add a custom folder">+ Add Folder</button>
          </div>
          <div class="ce-np-folder-chips" id="sa-folder-chips"></div>
        </div>
      </div>
      <div class="ce-np-actions">
        <button class="ce-btn ghost" id="sa-cancel">Cancel</button>
        <button class="ce-btn primary" id="sa-save">Save Project</button>
      </div>
    `;

    dlg.querySelector('#sa-name').value = defaultName;

    document.body.appendChild(dlg);
    this._dialog = dlg;
    this._bindEvents(dlg, defaultName);
    dlg.showModal();
    dlg.querySelector('#sa-name').focus();
    dlg.querySelector('#sa-name').select();
  },

  /**
   * Suggest a new project name by appending " 2" to the current name.
   * Falls back to "Project 2" if the current name is empty.
   */
  _suggestedName(currentName) {
    const base = (currentName || 'Project').trim();
    return `${base} 2`;
  },

  // --- Folder chips ---------------------------------------------------------

  _buildChips(container, folders) {
    container.innerHTML = '';
    for (const name of folders) {
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
    rm.textContent = 'x';
    rm.title = 'Remove folder';
    rm.addEventListener('click', () => chip.remove());
    chip.appendChild(rm);
    return chip;
  },

  _startAddFolder(container) {
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

  // --- Events ---------------------------------------------------------------

  _bindEvents(dlg, defaultName) {
    const nameInput      = dlg.querySelector('#sa-name');
    const locationInput  = dlg.querySelector('#sa-location');
    const createFolderCb = dlg.querySelector('#sa-create-folder');
    const previewPath    = dlg.querySelector('#sa-preview-path');
    const pathHint       = dlg.querySelector('#sa-path-hint');
    const saveLogReport  = dlg.querySelector('#sa-save-log-report');
    const saveBtn        = dlg.querySelector('#sa-save');
    const cancelBtn      = dlg.querySelector('#sa-cancel');
    const browseBtn      = dlg.querySelector('#sa-browse');
    const useFoldersCb   = dlg.querySelector('#sa-use-folders');
    const addFolderBtn   = dlg.querySelector('#sa-add-folder');
    const chipsContainer = dlg.querySelector('#sa-folder-chips');

    // Default folder chips come from the current project's tree so the Save
    // As copy has the same folder structure as the source project.
    const currentProject = ProjectManager.getCurrent();
    let sourceFolders = Object.keys(currentProject?.tree || {});
    if (sourceFolders.length === 0) {
      sourceFolders = ['audio','animations','fonts','engine','fx','materials','models','prefabs','scenes','scripts','textures'];
    }

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
      isSecureContext: !!window.isSecureContext,
      initialLocation: locationInput.value,
      initialName: defaultName,
      sourceFolders,
    });

    this._buildChips(chipsContainer, sourceFolders);

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
      this._debug('pick:start', {
        hasInPagePanel: typeof FolderPickerPanel?.open === 'function',
        hasBrowserPicker: typeof window.showDirectoryPicker === 'function',
        hasLocalBridgePicker: true,
        userActivationActive: !!navigator.userActivation?.isActive,
      });

      // PRIMARY: in-page modern folder panel (same as New Project dialog).
      try {
        this._debug('pick:attempt', {
          label: 'in-page-panel',
          userActivationActive: !!navigator.userActivation?.isActive,
        });
        const startPath = locationInput.value.trim() || null;
        const { path } = await FolderPickerPanel.open({
          startPath,
          title: 'Project Location',
        });
        this._debug('pick:attempt-success', { label: 'in-page-panel', path });
        return { handle: null, pickedPath: path };
      } catch (err) {
        const name = err?.name || '';
        const isCancel = name === 'AbortError' || /cancelled/i.test(err?.message || '');
        this._debug('pick:attempt-error', {
          label: 'in-page-panel',
          name,
          message: err?.message || String(err),
        });
        if (isCancel) throw err;
      }

      // FALLBACK: bridge-launched PowerShell FolderBrowserDialog.
      const pickDirectory = window.__cyco?.pickDirectory;
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
      if (typeof window.showDirectoryPicker === 'function') {
        attempts.push(['browser-direct', () => window.showDirectoryPicker({ mode: 'readwrite' })]);
      } else if (typeof pickDirectory === 'function') {
        attempts.push(['cyco-wrapper', () => pickDirectory({ mode: 'readwrite' })]);
      }

      let dirResult = null;
      for (const [label, runPicker] of attempts) {
        try {
          this._debug('pick:attempt', { label });
          dirResult = await runPicker();
          this._debug('pick:attempt-success', { label, resultType: typeof dirResult });
          break;
        } catch (err) {
          this._debug('pick:attempt-error', { label, name: err?.name, message: err?.message });
          throw err;
        }
      }
      if (!dirResult) throw new Error('No folder was selected.');
      const handle = dirResult?.handle || (dirResult && typeof dirResult.getDirectoryHandle === 'function' ? dirResult : null);
    const pickedPath = typeof dirResult === 'string'
      ? dirResult
      : dirResult?.path || dirResult?.fullPath || dirResult?.name || '';
    this._debug('pick:result', { pickedPath });
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
      pathHint.textContent = selectedDirectoryHandle
        ? 'Selected directory updated in the Location field.'
        : 'Selected folder path updated in the Location field.';
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

  const doSave = () => {
    this._debug('save:button-click', {
      rawName: nameInput.value,
      rawLocation: locationInput.value,
      hasHandle: !!selectedDirectoryHandle,
      handleName: selectedDirectoryHandle?.name || null,
    });
    (async () => {
      const name = nameInput.value.trim();
      if (!name) {
        this._debug('save:blocked-no-name');
        nameInput.style.borderColor = 'var(--ce-accent-orange)';
        nameInput.focus();
        return;
      }
      const location = locationInput.value.trim();
      if (!selectedDirectoryHandle && !location) {
        this._debug('save:blocked-no-target', { location });
        pathHint.textContent = 'Choose a writable folder with Browse, or type a full folder path for the local save bridge.';
        pathHint.style.color = 'var(--ce-accent-orange)';
        locationInput.focus();
        return;
      }

      const resolvedLocation = location || selectedDirectoryHandle.name || 'Selected Folder';
      const createFolder = createFolderCb.checked;
      const useFolders = useFoldersCb.checked;
      const folders = useFolders
        ? Array.from(chipsContainer.querySelectorAll('.ce-np-chip[data-folder]'))
            .map(c => c.dataset.folder).filter(Boolean)
        : [];

      this._debug('save:start', {
        name,
        location: resolvedLocation,
        createFolder,
        useFolders,
        folders,
        handleName: selectedDirectoryHandle?.name || null,
        hasHandle: !!selectedDirectoryHandle,
        saveMode: selectedDirectoryHandle ? 'browser-handle' : 'local-bridge',
      });
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
      await ProjectManager.saveAsNewProject(
        name, resolvedLocation, createFolder, folders, selectedDirectoryHandle
      );
      this._debug('save:success', { name, location: resolvedLocation });
      this._close();
    })().catch(err => {
      this._debug('save:error', { message: err?.message || String(err), error: err });
      console.error('[SaveProjectAsDialog] Failed to save as new project:', err);
      pathHint.textContent = err?.message ? `Could not save as new project: ${err.message}` : 'Could not save as new project.';
      pathHint.style.color = 'var(--ce-accent-orange)';
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Project';
    });
  };

  saveBtn.addEventListener('click', doSave);
  cancelBtn.addEventListener('click', () => this._close());

  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') this._close();
    if (e.key === 'Enter' && document.activeElement !== cancelBtn) doSave();
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

export default SaveProjectAsDialog;
