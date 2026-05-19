/** AssetBrowser.js — PlayCanvas-style asset browser panel */

import ProjectManager from '../project/ProjectManager.js';
import { cePrompt }   from './ce-prompt.js';

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
    document.addEventListener('cyco-project-change', this._onProjectChange);
  }

  get element() {
    if (!this._el) this._el = this._build();
    return this._el;
  }

  destroy() {
    document.removeEventListener('cyco-project-change', this._onProjectChange);
  }

  // ── Build skeleton ────────────────────────────────────────────────────────

  _build() {
    const root = document.createElement('div');
    root.className = 'ce-asset-browser';

    root.appendChild(this._buildToolbar());

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

    // Deselect on click on empty space
    this._contentEl.addEventListener('click', (e) => {
      if (e.target === this._contentEl) {
        this._selected.clear();
        this._refreshContentSelection();
      }
    });

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

  // ── Refresh ───────────────────────────────────────────────────────────────

  _refresh() {
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
    this._treeEl.appendChild(this._buildTreeNode(project.tree, [], project.name));
  }

  _buildTreeNode(children, pathArray, displayLabel) {
    const wrap = document.createElement('div');
    wrap.className = 'ce-ab-tree-node';

    const pathStr   = pathArray.join('/');
    const childKeys = Object.keys(children).sort();
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
    const icSize = this._viewMode === 'large' ? 52 : 36;
    const item   = document.createElement('div');
    item.className = 'ce-ab-grid-item' + (isSel ? ' selected' : '');
    item.dataset.name = name;
    item.insertAdjacentHTML('beforeend', _svgFolderLg(icSize));
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
      this._currentPath = [...this._currentPath, name];
      this._selected.clear();
      this._refresh();
    });
    return item;
  }

  _buildListItem(name) {
    const isSel = this._selected.has(name);
    const row   = document.createElement('div');
    row.className = 'ce-ab-list-item' + (isSel ? ' selected' : '');
    row.dataset.name = name;
    row.innerHTML = `
      <span class="ce-ab-list-icon">${_svgFolderSm()}</span>
      <span class="ce-ab-list-name">${_esc(name)}</span>
      <span class="ce-ab-list-type">Folder</span>`;

    row.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!e.ctrlKey && !e.metaKey) this._selected.clear();
      this._selected.has(name) ? this._selected.delete(name) : this._selected.add(name);
      this._refreshContentSelection();
    });
    row.addEventListener('dblclick', () => {
      this._currentPath = [...this._currentPath, name];
      this._selected.clear();
      this._refresh();
    });
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

  _deleteSelected() {
    if (!this._selected.size) return;
    const count = this._selected.size;
    const label = count === 1
      ? `"${[...this._selected][0]}"`
      : `${count} items`;
    if (!window.confirm(`Delete ${label}? This cannot be undone.`)) return;
    this._selected.forEach(name => {
      ProjectManager.deleteNode([...this._currentPath, name]);
    });
    this._selected.clear();
  }

  _setView(mode) {
    this._viewMode = mode;
    this._updateViewBtns();
    this._renderContent();
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
