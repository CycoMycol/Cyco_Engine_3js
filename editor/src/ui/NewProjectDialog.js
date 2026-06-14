/** NewProjectDialog.js - modal dialog for creating a new project */

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

  _bindEvents(dlg) {
    const nameInput      = dlg.querySelector('#np-name');
    const saveLogBtn     = dlg.querySelector('#np-save-log-toggle');
    const saveLogReport  = dlg.querySelector('#np-save-log-report');
    const copyLogBtn     = dlg.querySelector('#np-copy-log');
    const createBtn      = dlg.querySelector('#np-create');
    const cancelBtn      = dlg.querySelector('#np-cancel');
    const useFoldersCb   = dlg.querySelector('#np-use-folders');
    const addFolderBtn   = dlg.querySelector('#np-add-folder');
    const chipsContainer = dlg.querySelector('#np-folder-chips');

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

    this._buildChips(chipsContainer);

    addFolderBtn.addEventListener('click', () => {
      this._debug('folders:add-click');
      this._startAddFolder(chipsContainer);
    });

    nameInput.addEventListener('input', () => {
      this._debug('name:input', { value: nameInput.value });
    });

    useFoldersCb.addEventListener('change', () => {
      this._debug('folders:toggle', { enabled: useFoldersCb.checked });
      chipsContainer.classList.toggle('is-disabled', !useFoldersCb.checked);
      addFolderBtn.disabled = !useFoldersCb.checked;
    });
    chipsContainer.classList.toggle('is-disabled', !useFoldersCb.checked);
    addFolderBtn.disabled = !useFoldersCb.checked;

    const doCreate = () => {
      this._debug('create:button-click', { rawName: nameInput.value });
      (async () => {
        const name = String(nameInput.value || 'project').trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ') || 'project';
        nameInput.value = name;
        const useFolders = useFoldersCb.checked;
        const folders = useFolders
          ? Array.from(chipsContainer.querySelectorAll('.ce-np-chip[data-folder]'))
              .map(c => c.dataset.folder).filter(Boolean)
          : [];

        this._debug('create:start', {
          name,
          useFolders,
          folders,
          saveMode: 'browser-storage',
        });

        createBtn.disabled = true;
        createBtn.textContent = 'Creating...';
        const project = await ProjectManager.createOnDisk(name, '', false, folders, null);
        this._debug('create:success', {
          name,
          location: project?.path || name,
          storageMode: project?.storageMode || 'browser-storage',
        });
        this._close();
      })().catch(err => {
        this._debug('create:error', { message: err?.message || String(err), error: err });
        console.error('[NewProjectDialog] Failed to create project:', err);
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
