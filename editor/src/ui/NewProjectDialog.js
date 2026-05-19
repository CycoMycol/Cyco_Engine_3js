/** NewProjectDialog.js — modal dialog for creating a new project */

import ProjectManager from '../project/ProjectManager.js';

const NewProjectDialog = {
  _dialog: null,

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
          <span class="ce-np-path-hint" id="np-path-hint">Project data is stored in the browser — path is for reference only.</span>
        </div>
        <div class="ce-np-row ce-np-checkbox-row">
          <label class="ce-np-checkbox-label">
            <input type="checkbox" id="np-create-folder" checked>
            <span>Create a folder with the project name</span>
          </label>
        </div>
        <div class="ce-np-preview-row">
          <span class="ce-np-preview-label">Full path:</span>
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
    const createBtn      = dlg.querySelector('#np-create');
    const cancelBtn      = dlg.querySelector('#np-cancel');
    const browseBtn      = dlg.querySelector('#np-browse');
    const useFoldersCb   = dlg.querySelector('#np-use-folders');
    const addFolderBtn   = dlg.querySelector('#np-add-folder');
    const chipsContainer = dlg.querySelector('#np-folder-chips');

    // Populate initial chips
    this._buildChips(chipsContainer);

    // Toggle: enable/disable folders
    const syncFolderState = () => {
      const on = useFoldersCb.checked;
      chipsContainer.classList.toggle('is-disabled', !on);
      addFolderBtn.disabled = !on;
    };
    useFoldersCb.addEventListener('change', syncFolderState);
    syncFolderState();

    addFolderBtn.addEventListener('click', () => this._startAddFolder(chipsContainer));

    const updatePreview = () => {
      const name   = nameInput.value.trim()     || '(name)';
      const loc    = locationInput.value.trim() || 'C:/Projects';
      const create = createFolderCb.checked;
      const clean  = loc.replace(/\\+/g, '/').replace(/\/+$/, '');
      previewPath.textContent = create ? `${clean}/${name}/` : `${clean}/`;
    };

    nameInput.addEventListener('input', updatePreview);
    locationInput.addEventListener('input', updatePreview);
    createFolderCb.addEventListener('change', updatePreview);
    updatePreview();

    browseBtn.addEventListener('click', async () => {
      if (typeof window.showDirectoryPicker !== 'function') {
        pathHint.textContent = 'Directory picker not supported in this browser. Type the path manually.';
        pathHint.style.color = 'var(--ce-accent-orange)';
        return;
      }
      try {
        const dirHandle = await window.showDirectoryPicker({ mode: 'read' });
        locationInput.value = dirHandle.name;
        pathHint.textContent = 'Note: only the folder name is available in browser mode — path is used as a reference label.';
        pathHint.style.color = '';
        updatePreview();
      } catch (err) {
        if (err.name !== 'AbortError') {
          pathHint.textContent = 'Could not access that directory. Type the path manually.';
          pathHint.style.color = 'var(--ce-accent-orange)';
        }
      }
    });

    const doCreate = () => {
      const name = nameInput.value.trim();
      if (!name) {
        nameInput.style.borderColor = 'var(--ce-accent-orange)';
        nameInput.focus();
        return;
      }
      const location     = locationInput.value.trim() || 'C:/Projects';
      const createFolder = createFolderCb.checked;
      // Collect folder names from chips (null = use defaults when toggle is off → no folders)
      const useFolders = useFoldersCb.checked;
      const folders = useFolders
        ? Array.from(chipsContainer.querySelectorAll('.ce-np-chip[data-folder]'))
            .map(c => c.dataset.folder).filter(Boolean)
        : [];
      ProjectManager.create(name, location, createFolder, folders);
      this._close();
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
      this._dialog.close();
      this._dialog.remove();
      this._dialog = null;
    }
  },
};

export default NewProjectDialog;
