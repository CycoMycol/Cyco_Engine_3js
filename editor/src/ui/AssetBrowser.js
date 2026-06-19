/** AssetBrowser.js — PlayCanvas-style asset browser panel */

import ProjectManager       from '../project/ProjectManager.js';
import ProjectLocalBridgeStorage from '../project/ProjectLocalBridgeStorage.js';
import { cePrompt, ceConfirm } from './ce-prompt.js';

const FILTER_OPTIONS = [
  { value: 'all',       label: 'All'       },
  { value: 'scenes',    label: 'Scenes'    },
  { value: 'scripts',   label: 'Scripts'   },
  { value: 'textures',  label: 'Textures'  },
  { value: 'audio',     label: 'Audio'     },
  { value: 'materials', label: 'Materials' },
  { value: 'models',    label: 'Models'    },
  { value: 'fonts',     label: 'Fonts'     },
];

export class AssetBrowser {
  constructor() {
    this._currentPath = [];      // e.g. ['scripts'] for the scripts folder
    this._viewMode    = 'small'; // 'small' | 'large' | 'list'
    this._filter      = 'all';
    this._search      = '';
    this._expanded    = new Set(['']); // path strings that are expanded in tree; '' = root
    this._selected    = new Set();     // selected item names in content pane

    this._el        = null;
    this._treeEl    = null;
    this._contentEl = null;
    this._pathEl    = null;
    this._viewBtns  = null;

    this._onProjectChange = () => this._refresh();
    // Use bound copies of the methods so the listener stays valid even if
    // an instance field with the same name is reassigned later. Storing the
    // bound method on a *separate* field prevents the previous pattern
    // `(e) => this._onPrefabSaved(e)` from rebinding the instance slot to a
    // self-referential arrow function (which would infinite-loop on the
    // first cyco-prefab-saved event).
    this._boundOnPrefabSaved = (e) => this._onPrefabSaved(e);
    document.addEventListener('cyco-project-change', this._onProjectChange);
    document.addEventListener('cyco-prefab-saved',   this._boundOnPrefabSaved);
  }

  get element() {
    if (!this._el) this._el = this._build();
    return this._el;
  }

  destroy() {
    document.removeEventListener('cyco-project-change', this._onProjectChange);
    document.removeEventListener('cyco-prefab-saved',   this._boundOnPrefabSaved);
  }

  /**
   * After a prefab is saved, expand the prefabs/ folder in the tree and
   * navigate to it so the new .cyprefab file is immediately visible. Without
   * this the file is in the tree but the prefabs/ chevron stays closed and
   * the user has to click into the folder manually.
   */
  _onPrefabSaved(event) {
    const path = event.detail?.path ?? ['prefabs'];
    // Expand every ancestor so the prefabs folder is visible
    for (let i = 0; i < path.length; i++) {
      this._expanded.add(path.slice(0, i).join('/'));
    }
    // Navigate to the parent folder (e.g. ['prefabs']) and select the file
    this._currentPath = path.slice(0, -1);
    this._selected.clear();
    this._selected.add(path[path.length - 1]);
    this._refresh();
  }

  // ── Build skeleton ────────────────────────────────────────────────────────

  _build() {
    const root = document.createElement('div');
    root.className = 'ce-asset-browser';

    root.appendChild(this._buildToolbar());
    root.appendChild(this._buildStatusBar());

    const body = document.createElement('div');
    body.className = 'ce-ab-body';

    this._treeEl = document.createElement('div');
    this._treeEl.className = 'ce-ab-tree';

    const divider = document.createElement('div');
    divider.className = 'ce-ab-divider';
    this._initDividerResize(divider);

    this._contentEl = document.createElement('div');
    this._contentEl.className = 'ce-ab-content ce-ab-grid-small';

    body.appendChild(this._treeEl);
    body.appendChild(divider);
    body.appendChild(this._contentEl);
    root.appendChild(body);
    root.appendChild(this._buildFooter());

    // Deselect on click on empty space
    this._contentEl.addEventListener('click', (e) => {
      if (e.target === this._contentEl) {
        this._selected.clear();
        this._refreshContentSelection();
      }
    });
    this._initFileDrop(this._contentEl);
    this._initContextMenu(this._contentEl);

    this._refresh();
    return root;
  }

  _buildToolbar() {
    const tb = document.createElement('div');
    tb.className = 'ce-ab-toolbar';

    // ASSETS title
    const title = document.createElement('span');
    title.className = 'ce-ab-title';
    title.textContent = 'ASSETS';
    tb.appendChild(title);

    tb.appendChild(_sep());

    // Action buttons
    const addBtn = _toolBtn(_iconAdd(),    'New Folder',       () => this._addFolder());
    const delBtn = _toolBtn(_iconTrash(),  'Delete Selected',  () => this._deleteSelected());
    const upBtn  = _toolBtn(_iconUp(),     'Go to Parent',     () => this._goUp());
    tb.appendChild(addBtn);
    tb.appendChild(delBtn);
    tb.appendChild(upBtn);

    tb.appendChild(_sep());

    // Breadcrumb path
    this._pathEl = document.createElement('div');
    this._pathEl.className = 'ce-ab-path';
    tb.appendChild(this._pathEl);

    // Spacer
    const spacer = document.createElement('span');
    spacer.style.flex = '1';
    tb.appendChild(spacer);

    tb.appendChild(_sep());

    // View mode buttons
    const smallBtn = _toolBtn(_iconGridSmall(), 'Small Icons', () => this._setView('small'));
    const largeBtn = _toolBtn(_iconGridLarge(), 'Large Icons', () => this._setView('large'));
    const listBtn  = _toolBtn(_iconList(),      'List View',   () => this._setView('list'));
    smallBtn.dataset.view = 'small';
    largeBtn.dataset.view = 'large';
    listBtn.dataset.view  = 'list';
    this._viewBtns = { small: smallBtn, large: largeBtn, list: listBtn };
    tb.appendChild(smallBtn);
    tb.appendChild(largeBtn);
    tb.appendChild(listBtn);

    tb.appendChild(_sep());

    // Filter select
    const filterSel = document.createElement('select');
    filterSel.className = 'ce-ab-filter-select';
    FILTER_OPTIONS.forEach(f => {
      const o = document.createElement('option');
      o.value = f.value; o.textContent = f.label;
      filterSel.appendChild(o);
    });
    filterSel.value = this._filter;
    filterSel.addEventListener('change', () => {
      this._filter = filterSel.value;
      this._selected.clear();
      this._renderContent();
    });
    tb.appendChild(filterSel);

    // Search
    const searchWrap = document.createElement('div');
    searchWrap.className = 'ce-ab-search-wrap';
    searchWrap.insertAdjacentHTML('beforeend', `
      <svg class="ce-ab-search-icon" viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
        <path d="M11.742 10.344a6.5 6.5 0 10-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 001.415-1.414l-3.85-3.85a1.007 1.007 0 00-.115-.099zM12 6.5a5.5 5.5 0 11-11 0 5.5 5.5 0 0111 0z"/>
      </svg>`);
    const searchInput = document.createElement('input');
    searchInput.className = 'ce-ab-search-input';
    searchInput.type = 'text';
    searchInput.placeholder = 'Search...';
    searchInput.addEventListener('input', () => {
      this._search = searchInput.value;
      this._renderContent();
    });
    searchWrap.appendChild(searchInput);
    tb.appendChild(searchWrap);

    this._updateViewBtns();
    return tb;
  }

  // ── Status bar (project folder + .cyco file path) ─────────────────────────

  _buildStatusBar() {
    const bar = document.createElement('div');
    bar.className = 'ce-ab-statusbar';

    const label = document.createElement('span');
    label.className = 'ce-ab-statusbar-label';
    label.textContent = 'PROJECT:';
    bar.appendChild(label);

    this._statusPathEl = document.createElement('span');
    this._statusPathEl.className = 'ce-ab-statusbar-path';
    this._statusPathEl.textContent = 'No project open';
    this._statusPathEl.title = 'No project open';
    bar.appendChild(this._statusPathEl);

    this._statusFileEl = document.createElement('span');
    this._statusFileEl.className = 'ce-ab-statusbar-file';
    this._statusFileEl.textContent = '';
    this._statusFileEl.title = 'Project file';
    bar.appendChild(this._statusFileEl);

    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'ce-ab-statusbar-refresh';
    refreshBtn.title = 'Rescan project folder from disk';
    refreshBtn.innerHTML = `<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
      <path d="M8 3a5 5 0 105 5h-1.5a3.5 3.5 0 11-1.025-2.474L8 7v5h5l-1.55-1.55A4.984 4.984 0 008 3z"/>
    </svg>`;
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.disabled = true;
      try {
        const ok = await ProjectManager.refreshFromDisk();
        if (!ok) {
          window.dispatchEvent(new CustomEvent('cyco-toast', {
            detail: { message: 'No project folder is attached. Use File → New Project to pick one.' },
          }));
        }
      } finally {
        refreshBtn.disabled = false;
      }
    });
    this._statusRefreshBtn = refreshBtn;
    bar.appendChild(refreshBtn);

    return bar;
  }

  // ── Footer (file count + last-saved timestamp) ─────────────────────────────

  _buildFooter() {
    const footer = document.createElement('div');
    footer.className = 'ce-ab-footer';
    this._footerEl = footer;
    return footer;
  }

  _refreshStatus() {
    if (!this._statusPathEl) return;
    const project = ProjectManager.getCurrent();
    if (!project) {
      this._statusPathEl.textContent = 'No project open';
      this._statusPathEl.title = 'No project open';
      this._statusFileEl.textContent = '';
      if (this._footerEl) this._footerEl.textContent = '';
      return;
    }
    // Prefer the on-disk project folder (from the local save bridge)
    // because that's the path that the asset browser reads from.
    const diskPath = ProjectLocalBridgeStorage.getProjectPath() || project.path || '';
    this._statusPathEl.textContent = diskPath || project.path || 'No folder attached';
    this._statusPathEl.title = diskPath || project.path || '';

    const filePath = ProjectLocalBridgeStorage.getFilePath();
    const fileLabel = filePath ? filePath.split(/[\\/]/).pop() : '';
    this._statusFileEl.textContent = fileLabel ? `· ${fileLabel}` : '';
    this._statusFileEl.title = filePath || '';

    if (this._footerEl) {
      const saved = project.savedAt ? new Date(project.savedAt).toLocaleTimeString() : '';
      const updated = project.updatedAt ? new Date(project.updatedAt).toLocaleTimeString() : '';
      const savedTxt = saved ? `Last saved ${saved}` : 'Not saved yet';
      const updatedTxt = updated && updated !== saved ? ` · Updated ${updated}` : '';
      this._footerEl.textContent = `${savedTxt}${updatedTxt}`;
      this._footerEl.title = `Saved: ${saved || '—'}\nUpdated: ${updated || '—'}`;
    }
  }

  // ── Refresh ───────────────────────────────────────────────────────────────

  _refresh() {
    this._refreshStatus();
    this._renderTree();
    this._renderContent();
    this._renderPath();
  }

  _renderPath() {
    if (!this._pathEl) return;
    this._pathEl.innerHTML = '';
    const crumbParts = ['/', ...this._currentPath];
    crumbParts.forEach((part, i) => {
      const crumb = document.createElement('span');
      crumb.className = 'ce-ab-crumb';
      crumb.textContent = part;
      crumb.addEventListener('click', () => {
        this._currentPath = i === 0 ? [] : this._currentPath.slice(0, i);
        this._selected.clear();
        this._refresh();
      });
      this._pathEl.appendChild(crumb);
      if (i < crumbParts.length - 1) {
        const s = document.createElement('span');
        s.className = 'ce-ab-crumb-sep';
        s.textContent = '/';
        this._pathEl.appendChild(s);
      }
    });
  }

  // ── Tree ──────────────────────────────────────────────────────────────────

  _renderTree() {
    if (!this._treeEl) return;
    this._treeEl.innerHTML = '';
    const project = ProjectManager.getCurrent();
    if (!project) {
      const msg = document.createElement('div');
      msg.className = 'ce-ab-tree-empty';
      msg.textContent = 'No project open';
      this._treeEl.appendChild(msg);
      return;
    }
    this._treeEl.appendChild(this._buildTreeNode(project.tree, [], 'assets'));
  }

  _buildTreeNode(children, pathArray, displayLabel) {
    const wrap = document.createElement('div');
    wrap.className = 'ce-ab-tree-node';

    const pathStr   = pathArray.join('/');
    const childKeys = Object.keys(children).filter(key => !ProjectManager.isFileNode(children[key])).sort();
    const hasKids   = childKeys.length > 0;
    const isRoot    = pathArray.length === 0;
    const isExpanded = isRoot ? this._expanded.has('') : this._expanded.has(pathStr);
    const isSelected = this._currentPath.join('/') === pathStr;

    const row = document.createElement('div');
    row.className = 'ce-ab-tree-row' + (isSelected ? ' selected' : '');
    row.style.paddingLeft = `${4 + pathArray.length * 14}px`;

    // Toggle triangle
    const toggle = document.createElement('span');
    toggle.className = 'ce-ab-tree-toggle';
    toggle.textContent = hasKids ? (isExpanded ? '▾' : '▸') : '';
    row.appendChild(toggle);

    // Folder icon
    row.insertAdjacentHTML('beforeend', `<span class="ce-ab-tree-icon">${_svgFolderSm()}</span>`);

    // Name
    const nameEl = document.createElement('span');
    nameEl.className = 'ce-ab-tree-name' + (isRoot ? ' root' : '');
    nameEl.textContent = displayLabel || pathArray[pathArray.length - 1];
    row.appendChild(nameEl);

    row.addEventListener('click', (e) => {
      e.stopPropagation();
      this._currentPath = [...pathArray];
      if (hasKids) {
        const key = isRoot ? '' : pathStr;
        isExpanded ? this._expanded.delete(key) : this._expanded.add(key);
      }
      this._selected.clear();
      this._refresh();
    });

    wrap.appendChild(row);

    // Recurse if expanded
    if (isExpanded && hasKids) {
      const kids = document.createElement('div');
      kids.className = 'ce-ab-tree-children';
      childKeys.forEach(key => {
        kids.appendChild(this._buildTreeNode(children[key], [...pathArray, key]));
      });
      wrap.appendChild(kids);
    }

    return wrap;
  }

  // ── Content ───────────────────────────────────────────────────────────────

  _renderContent() {
    if (!this._contentEl) return;
    this._contentEl.innerHTML = '';

    const project = ProjectManager.getCurrent();
    if (!project) {
      this._contentEl.appendChild(_emptyMsg('No project open. Use File → New Project to get started.'));
      return;
    }

    let items = Object.keys(ProjectManager.getFolderContents(this._currentPath)).sort();

    // Filter
    if (this._filter !== 'all') {
      items = items.filter(n => n.toLowerCase().startsWith(this._filter));
    }
    // Search
    if (this._search.trim()) {
      const q = this._search.trim().toLowerCase();
      items = items.filter(n => n.toLowerCase().includes(q));
    }

    if (items.length === 0) {
      const msg = this._search ? 'No items match your search.' : 'This folder is empty.';
      this._contentEl.appendChild(_emptyMsg(msg));
      return;
    }

    // Apply view mode classes
    this._contentEl.classList.toggle('ce-ab-list-view',   this._viewMode === 'list');
    this._contentEl.classList.toggle('ce-ab-grid-small',  this._viewMode === 'small');
    this._contentEl.classList.toggle('ce-ab-grid-large',  this._viewMode === 'large');

    if (this._viewMode === 'list') {
      items.forEach(name => this._contentEl.appendChild(this._buildListItem(name)));
    } else {
      const grid = document.createElement('div');
      grid.className = 'ce-ab-grid';
      items.forEach(name => grid.appendChild(this._buildGridItem(name)));
      this._contentEl.appendChild(grid);
    }
  }

  _buildGridItem(name) {
    const isSel  = this._selected.has(name);
    const node   = ProjectManager.getFolderContents(this._currentPath)[name];
    const isFile = ProjectManager.isFileNode(node);
    const isPrefab = isFile && node.type === 'prefab';
    const icSize = this._viewMode === 'large' ? 52 : 36;
    const item   = document.createElement('div');
    item.className = 'ce-ab-grid-item' + (isSel ? ' selected' : '') + (isPrefab ? ' is-prefab' : '');
    item.dataset.name = name;
    if (isPrefab) item.draggable = true;
    item.insertAdjacentHTML('beforeend', isFile ? _svgFileLg(icSize, node.type) : _svgFolderLg(icSize));
    const lbl = document.createElement('span');
    lbl.className = 'ce-ab-grid-label';
    lbl.textContent = name;
    item.appendChild(lbl);

    item.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!e.ctrlKey && !e.metaKey) this._selected.clear();
      this._selected.has(name) ? this._selected.delete(name) : this._selected.add(name);
      this._refreshContentSelection();
    });
    item.addEventListener('dblclick', () => {
      if (isFile) return;
      this._currentPath = [...this._currentPath, name];
      this._selected.clear();
      this._refresh();
    });
    if (isPrefab) {
      item.addEventListener('dragstart', (e) => {
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('application/x-cyco-prefab', name);
        e.dataTransfer.setData('text/plain', name);
        item.classList.add('is-dragging');
      });
      item.addEventListener('dragend', () => item.classList.remove('is-dragging'));
    }
    return item;
  }

  _buildListItem(name) {
    const isSel = this._selected.has(name);
    const node  = ProjectManager.getFolderContents(this._currentPath)[name];
    const isFile = ProjectManager.isFileNode(node);
    const isPrefab = isFile && node.type === 'prefab';
    const row   = document.createElement('div');
    row.className = 'ce-ab-list-item' + (isSel ? ' selected' : '') + (isPrefab ? ' is-prefab' : '');
    row.dataset.name = name;
    row.innerHTML = `
      <span class="ce-ab-list-icon">${isFile ? _svgFileSm(node.type) : _svgFolderSm()}</span>
      <span class="ce-ab-list-name">${_esc(name)}</span>
      <span class="ce-ab-list-type">${isFile ? _esc(node.type || 'File') : 'Folder'}</span>`;
    if (isPrefab) row.draggable = true;

    row.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!e.ctrlKey && !e.metaKey) this._selected.clear();
      this._selected.has(name) ? this._selected.delete(name) : this._selected.add(name);
      this._refreshContentSelection();
    });
    row.addEventListener('dblclick', () => {
      if (isFile) return;
      this._currentPath = [...this._currentPath, name];
      this._selected.clear();
      this._refresh();
    });
    if (isPrefab) {
      row.addEventListener('dragstart', (e) => {
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('application/x-cyco-prefab', name);
        e.dataTransfer.setData('text/plain', name);
        row.classList.add('is-dragging');
      });
      row.addEventListener('dragend', () => row.classList.remove('is-dragging'));
    }
    return row;
  }

  _refreshContentSelection() {
    this._contentEl.querySelectorAll('[data-name]').forEach(el => {
      el.classList.toggle('selected', this._selected.has(el.dataset.name));
    });
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  _goUp() {
    if (!this._currentPath.length) return;
    this._currentPath = this._currentPath.slice(0, -1);
    this._selected.clear();
    this._refresh();
  }

  async _addFolder() {
    const project = ProjectManager.getCurrent();
    if (!project) return;
    const name = await cePrompt('New folder name:', 'New Folder');
    if (!name) return;
    const safe = name.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
    if (!safe) return;
    ProjectManager.addFolder(this._currentPath, safe);
  }

  async _deleteSelected() {
    if (!this._selected.size) return;
    const count = this._selected.size;
    const label = count === 1
      ? `"${[...this._selected][0]}"`
      : `${count} items`;
    const ok = await ceConfirm(
      `Delete ${label}? This cannot be undone.`,
      { okLabel: 'Delete', danger: true }
    );
    if (!ok) return;
    const projectPath = ProjectManager.getCurrent()?.path;
    const failures = [];
    for (const name of this._selected) {
      const nodePath = [...this._currentPath, name];
      const result = await ProjectManager.deleteFromDisk(nodePath);
      if (!result?.ok) {
        failures.push({ name, errors: result?.errors || [] });
      }
    }
    this._selected.clear();
    this._refresh();
    window.dispatchEvent(new CustomEvent('cyco-toast', {
      detail: {
        message: failures.length
          ? `Deleted ${count - failures.length}/${count} · ${failures.length} failed`
          : `Deleted ${count} ${count === 1 ? 'item' : 'items'} from ${projectPath ? projectPath : 'project'}`,
      },
    }));
  }

  // ── Context menu (right-click) ───────────────────────────────────────────

  _initContextMenu(target) {
    target.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      // Find the item under the cursor (its data-name ancestor).
      const itemEl = e.target.closest('[data-name]');
      if (itemEl) {
        const name = itemEl.dataset.name;
        // Select on right-click if not already part of the selection.
        if (!this._selected.has(name)) {
          if (!(e.ctrlKey || e.metaKey)) this._selected.clear();
          this._selected.add(name);
          this._refreshContentSelection();
        }
        this._showContextMenu(e.clientX, e.clientY, this._buildItemMenu(name));
      } else {
        // Right-click on empty space — clear selection and show folder menu.
        this._selected.clear();
        this._refreshContentSelection();
        this._showContextMenu(e.clientX, e.clientY, this._buildFolderMenu());
      }
    });
  }

  _buildItemMenu(name) {
    const node = ProjectManager.getFolderContents(this._currentPath)[name];
    const isFile = ProjectManager.isFileNode(node);
    const items = [];

    if (!isFile) {
      items.push({ label: 'Open',  onClick: () => {
        this._currentPath = [...this._currentPath, name];
        this._selected.clear();
        this._refresh();
      }});
    } else if (node.type === 'prefab') {
      items.push({ label: 'Add Prefab to Scene', onClick: () => {
        window.dispatchEvent(new CustomEvent('cyco-instantiate-prefab', {
          detail: { fileName: name }
        }));
      }});
    } else if (node.type === 'script') {
      items.push({ label: 'Open in Editor', onClick: () => {
        // TODO: hook into a script editor; for now we surface a toast.
        window.dispatchEvent(new CustomEvent('cyco-toast', {
          detail: { message: `Script editor not implemented yet: ${name}` },
        }));
      }});
    } else if (node.type === 'texture') {
      items.push({ label: 'Use as…', onClick: () => {
        window.dispatchEvent(new CustomEvent('cyco-toast', {
          detail: { message: `Drag-and-drop '${name}' into a slot to use it.` },
        }));
      }});
    }

    items.push({ separator: true });
    items.push({ label: 'Rename…', onClick: () => this._renameItem(name) });
    items.push({ label: `Delete "${name}"`, danger: true, onClick: () => this._deleteSelected() });
    return items;
  }

  _buildFolderMenu() {
    return [
      { label: 'New Folder…',   onClick: () => this._addFolder() },
      { label: 'New Script…',   onClick: () => this._createAsset('script',   '.js',  '// new script\n\nexport function init() {}\n') },
      { label: 'New Material…', onClick: () => this._createAsset('material', '.mtl',  JSON.stringify({ name: 'New Material', color: '#cccccc' }, null, 2) + '\n') },
      { label: 'New Texture (import from disk)…', onClick: () => this._importAssetOfType('texture') },
      { label: 'New Audio (import from disk)…',    onClick: () => this._importAssetOfType('audio') },
      { label: 'New Model (import from disk)…',    onClick: () => this._importAssetOfType('model') },
      { label: 'New Font (import from disk)…',     onClick: () => this._importAssetOfType('font') },
      { separator: true },
      { label: 'Paste', disabled: true, onClick: () => {
        window.dispatchEvent(new CustomEvent('cyco-toast', { detail: { message: 'Paste is not implemented yet.' } }));
      }},
    ];
  }

  _showContextMenu(x, y, items) {
    _closeContextMenu();
    const menu = document.createElement('div');
    menu.className = 'ce-ctx-menu';
    for (const item of items) {
      if (item.separator) {
        const sep = document.createElement('div');
        sep.className = 'ce-ctx-sep';
        menu.appendChild(sep);
        continue;
      }
      const el = document.createElement('div');
      el.className = 'ce-ctx-item' + (item.danger ? ' is-danger' : '');
      el.innerHTML = `<span class="ce-ctx-label">${_esc(item.label)}</span>`;
      if (item.disabled) el.style.opacity = '0.4';
      el.addEventListener('click', () => {
        if (item.disabled) return;
        _closeContextMenu();
        try { item.onClick && item.onClick(); }
        catch (err) { console.warn('[AssetBrowser] context menu action failed', err); }
      });
      menu.appendChild(el);
    }
    // Position then clamp to viewport.
    menu.style.left = `${x}px`;
    menu.style.top  = `${y}px`;
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    if (rect.right  > window.innerWidth)  menu.style.left = `${window.innerWidth - rect.width  - 4}px`;
    if (rect.bottom > window.innerHeight) menu.style.top  = `${window.innerHeight - rect.height - 4}px`;
    _activeContextMenu = menu;
    // Defer so the current contextmenu event finishes before installing the
    // outside-click handler — otherwise the menu closes immediately.
    setTimeout(() => {
      document.addEventListener('mousedown', _onOutsideContextClick, true);
      document.addEventListener('keydown',   _onContextEsc, true);
      window.addEventListener('resize',      _closeContextMenu);
      window.addEventListener('blur',        _closeContextMenu);
    }, 0);
  }

  async _createAsset(assetType, ext, template) {
    const project = ProjectManager.getCurrent();
    if (!project) return;
    const baseName = await cePrompt(`New ${assetType} name:`, `New ${assetType[0].toUpperCase()}${assetType.slice(1)}`);
    if (!baseName) return;
    const safeStem = String(baseName).trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
    if (!safeStem) return;
    const fileName = safeStem.endsWith(ext) ? safeStem : `${safeStem}${ext}`;
    ProjectManager.importAssetFile(this._currentPath, {
      name: fileName,
      mimeType: 'text/plain',
      size: template.length,
      data: 'data:text/plain;base64,' + btoa(unescape(encodeURIComponent(template))),
      metadata: { createdAt: Date.now(), source: 'asset-browser-new' },
    });
    this._currentPath = [...this._currentPath];
    this._selected.clear();
    this._selected.add(fileName);
    this._refresh();
  }

  async _importAssetOfType(assetType) {
    window.dispatchEvent(new CustomEvent('cyco-toast', {
      detail: { message: `Drop a ${assetType} file into this folder, or use the toolbar Import button.` },
    }));
  }

  async _renameItem(oldName) {
    const project = ProjectManager.getCurrent();
    if (!project) return;
    const newName = await cePrompt(`Rename "${oldName}" to:`, oldName);
    if (!newName || newName === oldName) return;
    const safe = String(newName).trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
    if (!safe || safe === oldName) return;
    const parent = ProjectManager.getFolderContents(this._currentPath);
    if (!parent || !(oldName in parent)) return;
    if (safe in parent) {
      window.dispatchEvent(new CustomEvent('cyco-toast', {
        detail: { message: `Cannot rename: "${safe}" already exists.` },
      }));
      return;
    }
    // Re-key the in-memory node. The on-disk file will be re-materialised
    // on the next Save with the new name. If the bridge is attached, also
    // try to rename the file on disk to keep watcher state in sync.
    const node = parent[oldName];
    delete parent[oldName];
    parent[safe] = node;
    ProjectManager._save();
    document.dispatchEvent(new CustomEvent('cyco-project-change'));
    if (ProjectLocalBridgeStorage.hasTarget?.()) {
      const oldAbs = ProjectManager.treePathToDiskPath([...this._currentPath, oldName]);
      const newAbs = ProjectManager.treePathToDiskPath([...this._currentPath, safe]);
      if (oldAbs && newAbs) {
        // Best-effort: just delete the old file and let the next Save
        // re-materialise the new one. A true cross-platform rename is a
        // future improvement; for now we keep the rename flow simple.
        try { await ProjectLocalBridgeStorage.deleteFile({ absolutePath: oldAbs }); }
        catch (_) { /* ignore */ }
      }
    }
    this._selected.clear();
    this._selected.add(safe);
    this._refresh();
  }

  _setView(mode) {
    this._viewMode = mode;
    this._updateViewBtns();
    this._renderContent();
  }

  _initFileDrop(target) {
    target.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.files?.length) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      target.classList.add('is-drop-target');
    });
    target.addEventListener('dragleave', () => {
      target.classList.remove('is-drop-target');
    });
    target.addEventListener('drop', async (e) => {
      if (!e.dataTransfer?.files?.length) return;
      e.preventDefault();
      target.classList.remove('is-drop-target');
      await this._importFiles([...e.dataTransfer.files]);
    });
  }

  async _importFiles(files) {
    const project = ProjectManager.getCurrent();
    if (!project || !files.length) return;
    for (const file of files) {
      const data = await _readFileAsDataURL(file);
      ProjectManager.importAssetFile(this._currentPath, {
        name: file.name,
        mimeType: file.type || '',
        size: file.size || 0,
        data,
        metadata: {
          importedAt: Date.now(),
          source: 'asset-browser-drop',
        },
      });
    }
    this._selected.clear();
    this._refresh();
  }

  _updateViewBtns() {
    if (!this._viewBtns) return;
    Object.entries(this._viewBtns).forEach(([m, btn]) => {
      btn.classList.toggle('active', m === this._viewMode);
    });
  }

  // ── Divider resize ────────────────────────────────────────────────────────

  _initDividerResize(divider) {
    let dragging = false, startX = 0, startW = 0;
    divider.addEventListener('mousedown', (e) => {
      dragging = true;
      startX = e.clientX;
      startW = this._treeEl.offsetWidth;
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const w = Math.max(120, Math.min(400, startW + (e.clientX - startX)));
      this._treeEl.style.width = `${w}px`;
    });
    document.addEventListener('mouseup', () => { dragging = false; });
  }
}

// ── SVG helpers ───────────────────────────────────────────────────────────────

function _svgFolderSm() {
  return `<svg viewBox="0 0 16 13" width="16" height="13" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M0 2.5A2 2 0 012 .5h3.586a1 1 0 01.707.293L7.5 2H14a2 2 0 012 2v7.5A1 1 0 0115 12.5H1A1 1 0 010 11.5V2.5z" fill="#b0977f"/>
    <path d="M0 2.5A2 2 0 012 .5h3.586a1 1 0 01.707.293L7.5 2H0V2.5z" fill="#c8a888"/>
  </svg>`;
}

function _svgFolderLg(size) {
  const h = Math.round(size * 0.78);
  return `<svg viewBox="0 0 50 39" width="${size}" height="${h}" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M2 9Q2 5 6 5L20 5 24 9 46 9Q50 9 50 13L50 36Q50 40 46 40L4 40Q0 40 0 36L0 9Z" fill="#b0977f"/>
    <path d="M0 9L24 9L20 5L6 5Q2 5 2 9Z" fill="#c8a888"/>
  </svg>`;
}

function _svgFileSm(type = 'file') {
  const color = _fileColor(type);
  return `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M3 1.5h6.5L13 5v9.5H3V1.5z" fill="${color}"/>
    <path d="M9.5 1.5V5H13" fill="#ffffff" opacity=".35"/>
  </svg>`;
}

function _svgFileLg(size, type = 'file') {
  const color = _fileColor(type);
  return `<svg viewBox="0 0 44 52" width="${size}" height="${size}" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M7 2h21l9 9v39H7V2z" fill="${color}"/>
    <path d="M28 2v9h9" fill="#ffffff" opacity=".35"/>
    <rect x="13" y="28" width="18" height="3" rx="1.5" fill="#ffffff" opacity=".55"/>
    <rect x="13" y="35" width="14" height="3" rx="1.5" fill="#ffffff" opacity=".4"/>
  </svg>`;
}

function _fileColor(type = 'file') {
  switch (type) {
    case 'texture': return '#5fa8d3';
    case 'audio': return '#8ac926';
    case 'model': return '#ff9f1c';
    case 'script': return '#9d7fea';
    case 'font': return '#ef476f';
    case 'material': return '#2ec4b6';
    case 'engine-state': return '#a6a6a6';
    default: return '#7d8597';
  }
}

function _readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

// Toolbar icon SVGs
function _iconAdd()       { return `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M8 2a.5.5 0 01.5.5v5h5a.5.5 0 010 1h-5v5a.5.5 0 01-1 0v-5h-5a.5.5 0 010-1h5v-5A.5.5 0 018 2z"/></svg>`; }
function _iconTrash()     { return `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M5.5 5.5A.5.5 0 016 6v6a.5.5 0 01-1 0V6a.5.5 0 01.5-.5zm2.5 0a.5.5 0 01.5.5v6a.5.5 0 01-1 0V6a.5.5 0 01.5-.5zm2.5.5a.5.5 0 00-1 0v6a.5.5 0 001 0V6z"/><path fill-rule="evenodd" d="M14.5 3a1 1 0 01-1 1H13v9a2 2 0 01-2 2H5a2 2 0 01-2-2V4h-.5a1 1 0 010-2h3.5l1-1h3l1 1H14.5a1 1 0 011 1zM4.118 4L4 4.059V13a1 1 0 001 1h6a1 1 0 001-1V4.059L11.882 4H4.118z"/></svg>`; }
function _iconUp()        { return `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path fill-rule="evenodd" d="M7.646 4.646a.5.5 0 01.708 0l6 6a.5.5 0 01-.708.708L8 5.707l-5.646 5.647a.5.5 0 01-.708-.708l6-6z"/></svg>`; }
function _iconGridSmall() { return `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><rect x="1" y="1" width="6" height="6" rx="1"/><rect x="9" y="1" width="6" height="6" rx="1"/><rect x="1" y="9" width="6" height="6" rx="1"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg>`; }
function _iconGridLarge() { return `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><rect x="1" y="1" width="6" height="6" rx="1" opacity=".55"/><rect x="9" y="1" width="6" height="6" rx="1" opacity=".55"/><rect x="1" y="9" width="6" height="6" rx="1" opacity=".55"/><rect x="9" y="9" width="6" height="6" rx="1" opacity=".55"/></svg>`; }
function _iconList()      { return `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><rect x="1" y="2"  width="14" height="2" rx="1"/><rect x="1" y="7"  width="14" height="2" rx="1"/><rect x="1" y="12" width="14" height="2" rx="1"/></svg>`; }

function _sep() {
  const s = document.createElement('div');
  s.className = 'ce-ab-tb-sep';
  return s;
}

function _toolBtn(iconHTML, title, onClick) {
  const btn = document.createElement('button');
  btn.className = 'ce-ab-tool-btn';
  btn.title = title;
  btn.innerHTML = iconHTML;
  btn.addEventListener('click', onClick);
  return btn;
}

function _emptyMsg(text) {
  const el = document.createElement('div');
  el.className = 'ce-ab-empty';
  el.textContent = text;
  return el;
}

function _esc(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Context menu helpers (module-scope so the menu can be dismissed from
//    any callback, including ones fired by external listeners) ─────────────
let _activeContextMenu = null;
function _closeContextMenu() {
  if (_activeContextMenu) {
    _activeContextMenu.remove();
    _activeContextMenu = null;
  }
  document.removeEventListener('mousedown', _onOutsideContextClick, true);
  document.removeEventListener('keydown',   _onContextEsc, true);
  window.removeEventListener('resize',     _closeContextMenu);
  window.removeEventListener('blur',       _closeContextMenu);
}
function _onOutsideContextClick(e) {
  if (_activeContextMenu && !_activeContextMenu.contains(e.target)) _closeContextMenu();
}
function _onContextEsc(e) {
  if (e.key === 'Escape') _closeContextMenu();
}
