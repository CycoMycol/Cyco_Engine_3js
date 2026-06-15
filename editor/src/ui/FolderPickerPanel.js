/**
 * FolderPickerPanel.js — in-page modern folder picker.
 *
 * Replaces the bridge-launched PowerShell FolderBrowserDialog with a custom
 * HTML panel that talks to the local save bridge via three REST endpoints:
 *   GET  /list-drives   — quick-access locations + drive letters
 *   POST /list-folder   — list a directory's entries
 *   POST /mkdir         — create a new folder
 *
 * Features:
 *   • Left sidebar with quick-access locations (Home, Desktop, Documents, …)
 *     and drive letters.
 *   • Breadcrumb bar with clickable path segments + type-to-jump input.
 *   • Main grid: folder/file icons, double-click to enter, single-click to
 *     select, Enter to open, Backspace to go up.
 *   • View toggle: Grid ↔ List.
 *   • Search filter.
 *   • Sort by Name / Size / Modified.
 *   • Show/Hide hidden files toggle.
 *   • New Folder inline rename.
 *   • Recent locations (localStorage).
 *   • Drag-and-drop a folder to navigate to it.
 *   • Resolves the picked path via the promise returned from open().
 *
 * The component is a singleton-like object with .open() returning a Promise.
 */

import ProjectSaveLog from '../project/ProjectSaveLog.js';

const BRIDGE_URL = 'http://127.0.0.1:47623';
const RECENT_KEY    = 'cyco.folderPicker.recent';
const FAVORITES_KEY = 'cyco.folderPicker.favorites';
const CLIPBOARD_KEY = 'cyco.folderPicker.clipboard';
const VIEW_KEY      = 'cyco.folderPicker.view';
const MAX_RECENT    = 8;
const MAX_FAVORITES = 16;

const FolderPickerPanel = {
  _dialog: null,
  _resolve: null,
  _reject: null,
  _currentPath: null,
  _currentItems: [],
  _drives: [],
  _selected: null,
  _view: 'grid',
  _showHidden: false,
  _filter: '',
  _sortBy: 'name',
  _loading: false,
  _history: [],
  _historyIndex: -1,

  _log(step, payload = {}) {
    ProjectSaveLog.add('FolderPicker', step, payload);
  },

  _loadJSON(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  _saveJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota */ }
  },

  /**
   * Open the picker. Resolves with `{ path }` on selection, rejects on cancel.
   * @param {object} options
   * @param {string} [options.startPath] — initial path to show
   * @param {string} [options.title]      — title text
   * @param {string} [options.purpose]    — e.g. "Select project location"
   */
  open({ startPath = null, title = 'Project Location' } = {}) {
    return new Promise((resolve, reject) => {
      this._resolve = resolve;
      this._reject  = reject;
      this._view = this._loadJSON(VIEW_KEY, 'grid');

      this._buildDOM(title);
      this._bindDOM();

      // Initial load
      this._initialLoad(startPath).catch((err) => {
        this._log('initial-load:error', { message: err?.message || String(err) });
      });
    });
  },

  // ──────────────────────────────────────────────────────────────────────────
  // DOM construction
  // ──────────────────────────────────────────────────────────────────────────

  _buildDOM(title) {
    if (this._dialog) { this._dialog.remove(); this._dialog = null; }

    const dlg = document.createElement('dialog');
    dlg.className = 'ce-fp-dialog';
    dlg.innerHTML = `
      <div class="ce-fp-header">
        <div class="ce-fp-title">${escapeHtml(title)}</div>
        <input class="ce-fp-input ce-fp-path-input" data-role="path-input" type="text"
               autocomplete="off" spellcheck="false" placeholder="Path">
        <div class="ce-fp-header-spacer"></div>
        <button class="ce-fp-iconbtn" data-act="refresh" title="Refresh (F5)">⟳</button>
        <button class="ce-fp-iconbtn" data-act="newfolder" title="New folder (Ctrl+N)">＋</button>
        <button class="ce-fp-iconbtn" data-act="trash" title="Delete selected (Del)">🗑</button>
        <button class="ce-fp-iconbtn ce-fp-iconbtn-close" data-act="cancel" title="Close (Esc)">✕</button>
      </div>

      <div class="ce-fp-body">
        <aside class="ce-fp-sidebar">
          <div class="ce-fp-sidebar-section" data-section="favorites">
            <div class="ce-fp-sidebar-label-row">
              <div class="ce-fp-sidebar-label">Favorites</div>
              <button class="ce-fp-sidebar-addbtn" data-act="add-favorite" title="Add current folder to favorites">＋</button>
            </div>
            <div class="ce-fp-sidebar-list" data-list="favorites"></div>
          </div>
          <div class="ce-fp-sidebar-section" data-section="drives">
            <div class="ce-fp-sidebar-label">Drives</div>
            <div class="ce-fp-sidebar-list" data-list="drives"></div>
          </div>
        </aside>

        <main class="ce-fp-main">
          <div class="ce-fp-subbar">
            <button class="ce-fp-iconbtn" data-act="up" title="Up (Backspace)">↑</button>
            <button class="ce-fp-iconbtn" data-act="back" title="Back">←</button>
            <button class="ce-fp-iconbtn" data-act="forward" title="Forward">→</button>
            <input class="ce-fp-input ce-fp-search" data-role="search" type="text"
                   placeholder="Search…" autocomplete="off" spellcheck="false">
            <div class="ce-fp-viewtoggle" role="tablist" aria-label="View">
              <button class="ce-fp-viewbtn" data-view="grid" title="Grid view">▦</button>
              <button class="ce-fp-viewbtn" data-view="list" title="List view">≣</button>
            </div>
          </div>

          <div class="ce-fp-grid" data-role="grid" data-view="grid"></div>
          <div class="ce-fp-empty" data-role="empty" hidden></div>

          <div class="ce-fp-statusbar">
            <span data-role="status-path">—</span>
            <span data-role="status-count">0 items</span>
            <span data-role="status-bridge" class="ce-fp-bridge-status">bridge: ?</span>
          </div>
        </main>
      </div>

      <div class="ce-fp-footer">
        <div class="ce-fp-selection">
          <span class="ce-fp-selection-label">Selected:</span>
          <span class="ce-fp-selection-path" data-role="selected">—</span>
        </div>
        <div class="ce-fp-actions">
          <button class="ce-btn ghost" data-act="cancel">Cancel</button>
          <button class="ce-btn primary" data-act="select" disabled>Select Folder</button>
        </div>
      </div>

      <div class="ce-fp-resize-handle" data-role="resize" title="Drag to resize"></div>
    `;
    document.body.appendChild(dlg);
    // Append the context menu at body level so it can paint above the
    // modal <dialog> top-layer.
    const menu = document.createElement('div');
    menu.className = 'ce-fp-contextmenu';
    menu.dataset.role = 'contextmenu';
    menu.hidden = true;
    document.body.appendChild(menu);
    dlg.showModal();
    this._dialog = dlg;
  },

  _bindDOM() {
    const dlg = this._dialog;
    const $ = (sel) => dlg.querySelector(sel);
    const $$ = (sel) => dlg.querySelectorAll(sel);

    // Toolbar buttons
    dlg.addEventListener('click', (e) => {
      const t = e.target.closest('[data-act]');
      if (!t) return;
      const act = t.dataset.act;
      if (act === 'up')            return this._navUp();
      if (act === 'back')          return this._navBack();
      if (act === 'forward')       return this._navForward();
      if (act === 'refresh')       return this._refresh();
      if (act === 'newfolder')     return this._startNewFolder();
      if (act === 'trash')         return this._trashSelected();
      if (act === 'cancel')        return this._cancel();
      if (act === 'select')        return this._select();
      if (act === 'add-favorite')  return this._addCurrentToFavorites();
    });

    // View toggle
    $$('.ce-fp-viewbtn').forEach((btn) => {
      btn.addEventListener('click', () => this._setView(btn.dataset.view));
    });

    // Search
    $('[data-role="search"]').addEventListener('input', (e) => {
      this._filter = e.target.value.toLowerCase();
      this._renderGrid();
    });

    // Path input — Enter to jump
    $('[data-role="path-input"]').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this._loadFolder(e.target.value.trim(), { pushHistory: true });
      }
    });

    // Keyboard
    dlg.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (!this._contextMenu?.hidden) { this._hideContextMenu(); return; }
        e.preventDefault(); this._cancel(); return;
      }
      if (e.key === 'Enter' && this._selected) {
        if (e.target.matches('input,textarea,select')) return;
        e.preventDefault();
        this._select();
        return;
      }
      if (e.key === 'Backspace' && !e.target.matches('input,textarea,select')) {
        e.preventDefault();
        this._navUp();
        return;
      }
      if (e.key === 'F5') { e.preventDefault(); this._refresh(); return; }
      if (e.key === 'Delete' && !e.target.matches('input,textarea,select') && this._selected) {
        e.preventDefault();
        this._trashSelected();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        this._startNewFolder();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && this._selected && !e.target.matches('input,textarea')) {
        e.preventDefault();
        this._copySelected();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v' && !e.target.matches('input,textarea')) {
        e.preventDefault();
        this._pasteFromClipboard();
        return;
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        if (e.target.matches('input,textarea')) return;
        e.preventDefault();
        this._moveSelection(e.key === 'ArrowDown' ? 1 : -1);
      }
    });

    // Drag-and-drop a folder path
    dlg.addEventListener('dragover', (e) => { e.preventDefault(); });
    dlg.addEventListener('drop', (e) => {
      e.preventDefault();
      const path = e.dataTransfer?.getData('text/plain') || '';
      if (path) this._loadFolder(path, { pushHistory: true });
    });

    // Right-click on grid items
    const grid = $('[data-role="grid"]');
    grid.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const tile = e.target.closest('.ce-fp-tile');
      if (tile && tile.dataset.kind === 'new') return;
      if (tile && tile.dataset.name) {
        this._selectItem(tile.dataset.name);
        this._showContextMenu(e.clientX, e.clientY, {
          type: tile.dataset.kind, // 'dir' | 'file'
          name: tile.dataset.name,
        });
      } else {
        // Background right-click
        this._showContextMenu(e.clientX, e.clientY, { type: 'background' });
      }
    });

    // Click anywhere to dismiss context menu (but not clicks on tiles or
    // sidebar items — those just select; the menu persists until user picks
    // an item, presses Esc, or right-clicks elsewhere).
    document.addEventListener('click', (e) => {
      const menu = document.querySelector('[data-role="contextmenu"]');
      if (!menu || menu.hidden) return;
      if (menu.contains(e.target)) return;
      this._hideContextMenu();
    });
    dlg.addEventListener('scroll', () => this._hideContextMenu(), true);

    // Resize handle
    this._bindResize();
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Data loading
  // ──────────────────────────────────────────────────────────────────────────

  async _initialLoad(startPath) {
    this._setStatus('Loading drives…');
    try {
      const res = await this._fetch('/list-drives', { method: 'GET' });
      this._drives = res.drives || [];
      this._setBridgeStatus(true);
    } catch (err) {
      this._setBridgeStatus(false, err?.message || String(err));
      this._setStatus(`Bridge unavailable: ${err?.message || err}`);
      this._renderSidebar();
      return;
    }
    this._renderSidebar();

    const init = startPath
      || this._loadJSON(RECENT_KEY, [])[0]
      || this._loadJSON(FAVORITES_KEY, [])[0]
      || (this._drives[0]?.path) || null;
    if (init) {
      await this._loadFolder(init, { pushHistory: false });
    }
  },

  async _loadFolder(folderPath, { pushHistory = true, scrollIntoView = false } = {}) {
    if (!folderPath) return;
    if (this._loading) return;
    this._loading = true;
    this._setStatus('Loading…');
    this._setBridgeStatus(true);

    try {
      const res = await this._fetch('/list-folder', {
        method: 'POST',
        body: JSON.stringify({ path: folderPath, showHidden: false }),
      });
      this._currentPath = res.path;
      this._currentItems = res.items || [];
      this._selected = null;
      this._updateFooter();

      if (pushHistory) {
        this._history = this._history.slice(0, this._historyIndex + 1);
        this._history.push(res.path);
        this._historyIndex = this._history.length - 1;
      }
      this._renderSidebar();
      this._renderGrid();
      this._setPathInput(res.path);
      this._setStatus(`${res.items.length} item${res.items.length === 1 ? '' : 's'}`);
      this._log('load-folder:ok', { path: res.path, count: res.items.length });
    } catch (err) {
      this._log('load-folder:error', { path: folderPath, message: err?.message || String(err) });
      this._setStatus(`Cannot open: ${err?.message || err}`);
    } finally {
      this._loading = false;
    }
  },

  async _refresh() {
    if (this._currentPath) await this._loadFolder(this._currentPath, { pushHistory: false });
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Navigation
  // ──────────────────────────────────────────────────────────────────────────

  _navUp() {
    if (!this._currentPath) return;
    const parent = this._parentOf(this._currentPath);
    if (parent) this._loadFolder(parent, { pushHistory: true });
  },
  _navBack()    { if (this._historyIndex > 0) { this._historyIndex -= 1; this._loadFolder(this._history[this._historyIndex], { pushHistory: false }); } },
  _navForward() { if (this._historyIndex < this._history.length - 1) { this._historyIndex += 1; this._loadFolder(this._history[this._historyIndex], { pushHistory: false }); } },

  _parentOf(p) {
    if (!p) return null;
    // Cross-platform: split on / or \, strip trailing
    const sep = p.includes('\\') ? '\\' : '/';
    const trimmed = p.endsWith(sep) && p.length > 3 ? p.slice(0, -1) : p;
    const idx = trimmed.lastIndexOf(sep);
    if (idx < 0) return null;
    // Windows root like "C:\" → keep as root
    if (idx <= 2 && /^[A-Z]:/i.test(trimmed)) return trimmed.slice(0, idx + 1);
    return trimmed.slice(0, idx) || trimmed.slice(0, idx + 1);
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Selection
  // ──────────────────────────────────────────────────────────────────────────

  _selectItem(name) {
    this._selected = name;
    this._updateFooter();
    this._renderGrid();
  },

  _moveSelection(delta) {
    const visible = this._visibleItems();
    if (!visible.length) return;
    const idx = this._selected ? visible.findIndex((i) => i.name === this._selected) : -1;
    const next = Math.min(Math.max(idx + delta, 0), visible.length - 1);
    this._selectItem(visible[next].name);
  },

  _openSelected() {
    if (!this._selected) return;
    const item = this._currentItems.find((i) => i.name === this._selected);
    if (!item) return;
    if (item.type === 'dir') {
      this._loadFolder(this._joinPath(this._currentPath, item.name), { pushHistory: true });
    }
  },

  // ──────────────────────────────────────────────────────────────────────────
  // New folder inline rename
  // ──────────────────────────────────────────────────────────────────────────

  _startNewFolder() {
    if (!this._currentPath) return;
    const grid = this._dialog.querySelector('[data-role="grid"]');
    // Don't double-create
    if (grid.querySelector('.ce-fp-newfolder-input')) return;

    const tile = document.createElement('div');
    tile.className = 'ce-fp-tile ce-fp-newfolder-tile';
    tile.dataset.kind = 'new';
    tile.innerHTML = `
      <div class="ce-fp-tile-icon">📁</div>
      <input class="ce-fp-newfolder-input" type="text" maxlength="64"
             autocomplete="off" spellcheck="false" placeholder="Folder name">
    `;
    grid.prepend(tile);
    const input = tile.querySelector('input');
    input.focus();

    let done = false;
    const finish = async (commit) => {
      if (done) return;
      done = true;
      const name = (input.value || '').trim();
      tile.remove();
      if (!commit || !name) return;
      try {
        const res = await this._fetch('/mkdir', {
          method: 'POST',
          body: JSON.stringify({ parent: this._currentPath, name }),
        });
        this._log('mkdir:ok', { parent: this._currentPath, name: res.name });
        await this._loadFolder(this._currentPath, { pushHistory: false });
        this._selectItem(res.name);
      } catch (err) {
        this._log('mkdir:error', { message: err?.message || String(err) });
        this._setStatus(`Cannot create folder: ${err?.message || err}`);
      }
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter')  { e.preventDefault(); finish(true); }
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Rendering
  // ──────────────────────────────────────────────────────────────────────────

  _renderSidebar() {
    if (!this._dialog) return;
    const favList = this._dialog.querySelector('[data-list="favorites"]');
    const drives = this._dialog.querySelector('[data-list="drives"]');
    favList.innerHTML = '';
    drives.innerHTML = '';

    const favs = this._loadJSON(FAVORITES_KEY, []);
    if (favs.length) {
      for (const f of favs) {
        const item = this._sidebarItem({
          label: f.label || this._basename(f.path),
          path: f.path,
          icon: '⭐',
        });
        // Allow right-click to remove from favorites
        item.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this._showContextMenu(e.clientX, e.clientY, {
            type: 'favorite',
            path: f.path,
            label: f.label || this._basename(f.path),
          });
        });
        if (f.path === this._currentPath) item.classList.add('is-active');
        favList.appendChild(item);
      }
    } else {
      const empty = document.createElement('div');
      empty.className = 'ce-fp-sidebar-empty';
      empty.textContent = 'Right-click a folder to add';
      favList.appendChild(empty);
    }

    for (const d of this._drives) {
      const item = this._sidebarItem({
        label: d.label,
        path: d.path,
        icon: d.kind === 'drive' ? '💽' : this._iconForKind(d.kind),
      });
      if (d.path === this._currentPath) item.classList.add('is-active');
      const target = d.kind === 'drive' ? drives : favList;
      target.appendChild(item);
    }
  },

  _sidebarItem({ label, path, icon }) {
    const el = document.createElement('button');
    el.className = 'ce-fp-sidebar-item';
    el.dataset.path = path;
    el.innerHTML = `<span class="ce-fp-sidebar-icon">${icon}</span><span class="ce-fp-sidebar-label">${escapeHtml(label)}</span>`;
    el.addEventListener('click', () => this._loadFolder(path, { pushHistory: true }));
    return el;
  },

  _setPathInput(p) {
    if (!this._dialog) return;
    const input = this._dialog.querySelector('[data-role="path-input"]');
    if (input) input.value = p || '';
  },

  _renderGrid() {
    if (!this._dialog) return;
    const grid = this._dialog.querySelector('[data-role="grid"]');
    const empty = this._dialog.querySelector('[data-role="empty"]');
    grid.dataset.view = this._view;
    grid.innerHTML = '';

    // Apply view buttons
    this._dialog.querySelectorAll('.ce-fp-viewbtn').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.view === this._view);
    });

    const items = this._visibleItems();
    if (!items.length) {
      empty.hidden = false;
      empty.textContent = this._currentPath
        ? (this._filter ? `No items match "${this._filter}".` : 'This folder is empty.')
        : 'Select a location from the sidebar to begin.';
      return;
    }
    empty.hidden = true;

    for (const it of items) {
      const tile = document.createElement('div');
      tile.className = `ce-fp-tile ${this._view === 'list' ? 'ce-fp-tile-list' : ''} ${this._selected === it.name ? 'is-selected' : ''}`;
      tile.dataset.name = it.name;
      tile.dataset.kind = it.type;
      const icon = it.type === 'dir' ? '📁' : iconForFile(it.name);
      const size = it.type === 'dir' ? '—' : formatSize(it.size);
      const mtime = formatDate(it.mtime);
      tile.innerHTML = `
        <div class="ce-fp-tile-icon">${icon}</div>
        <div class="ce-fp-tile-name" title="${escapeAttr(it.name)}">${escapeHtml(it.name)}</div>
        <div class="ce-fp-tile-meta">
          <span class="ce-fp-tile-size">${size}</span>
          <span class="ce-fp-tile-mtime">${mtime}</span>
        </div>
      `;
      tile.addEventListener('click', (e) => {
        e.stopPropagation();
        this._selectItem(it.name);
      });
      tile.addEventListener('dblclick', () => {
        if (it.type === 'dir') {
          this._loadFolder(this._joinPath(this._currentPath, it.name), { pushHistory: true });
        } else {
          this._selectItem(it.name);
        }
      });
      tile.tabIndex = 0;
      grid.appendChild(tile);
    }
  },

  _visibleItems() {
    let items = this._currentItems;
    if (this._filter) {
      const q = this._filter;
      items = items.filter((i) => i.name.toLowerCase().includes(q));
    }
    return items.slice().sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
  },

  _setView(v) {
    this._view = v;
    this._saveJSON(VIEW_KEY, v);
    this._renderGrid();
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Footer / status
  // ──────────────────────────────────────────────────────────────────────────

  _updateFooter() {
    const sel = this._dialog.querySelector('[data-role="selected"]');
    const btn = this._dialog.querySelector('[data-act="select"]');
    if (this._selected) {
      sel.textContent = this._joinPath(this._currentPath || '', this._selected);
      btn.disabled = false;
    } else {
      sel.textContent = this._currentPath || '—';
      btn.disabled = true;
    }
  },

  _setStatus(text) {
    if (!this._dialog) return;
    this._dialog.querySelector('[data-role="status-path"]').textContent = text;
  },
  _setBridgeStatus(ok, message) {
    if (!this._dialog) return;
    const el = this._dialog.querySelector('[data-role="status-bridge"]');
    el.classList.toggle('is-ok', !!ok);
    el.classList.toggle('is-bad', !ok);
    el.textContent = ok ? 'bridge: ok' : `bridge: ${message || 'offline'}`;
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Public actions
  // ──────────────────────────────────────────────────────────────────────────

  _select() {
    if (!this._selected) return;
    const full = this._joinPath(this._currentPath || '', this._selected);
    this._addRecent(full);
    this._log('select', { path: full });
    this._closeWith(() => this._resolve?.({ path: full }));
  },

  _cancel() {
    this._log('cancel');
    this._closeWith(() => this._reject?.(new Error('Folder selection was cancelled.')));
  },

  _closeWith(fn) {
    fn();
    if (this._dialog) {
      this._dialog.close();
      this._dialog.remove();
      this._dialog = null;
    }
    // Also remove the body-level context menu so it doesn't dangle.
    const menu = document.querySelector('[data-role="contextmenu"]');
    if (menu) { menu.remove(); }
    this._contextMenu = null;
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────────────────────

  _addRecent(path) {
    const list = this._loadJSON(RECENT_KEY, []).filter((p) => p !== path);
    list.unshift(path);
    this._saveJSON(RECENT_KEY, list.slice(0, MAX_RECENT));
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Favorites
  // ──────────────────────────────────────────────────────────────────────────

  _addCurrentToFavorites() {
    if (!this._currentPath) return;
    const path = this._currentPath;
    const label = this._basename(path);
    const list = this._loadJSON(FAVORITES_KEY, []).filter((f) => f.path !== path);
    list.unshift({ path, label });
    this._saveJSON(FAVORITES_KEY, list.slice(0, MAX_FAVORITES));
    this._renderSidebar();
    this._setStatus(`Added "${label}" to favorites`);
    this._log('favorites:add', { path });
  },

  _removeFavorite(path) {
    const list = this._loadJSON(FAVORITES_KEY, []).filter((f) => f.path !== path);
    this._saveJSON(FAVORITES_KEY, list);
    this._renderSidebar();
    this._setStatus(`Removed from favorites`);
    this._log('favorites:remove', { path });
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Context menu
  // ──────────────────────────────────────────────────────────────────────────

  _showContextMenu(x, y, target) {
    const menu = document.querySelector('[data-role="contextmenu"]');
    if (!menu) return;
    const items = this._contextMenuItems(target);
    menu.innerHTML = items.map((it) => {
      if (it.separator) return `<div class="ce-fp-cm-sep"></div>`;
      const cls = `ce-fp-cm-item ${it.danger ? 'is-danger' : ''} ${it.disabled ? 'is-disabled' : ''}`;
      return `<div class="${cls}" data-act="${it.act}">${it.icon ? `<span class="ce-fp-cm-icon">${it.icon}</span>` : ''}<span>${escapeHtml(it.label)}</span></div>`;
    }).join('');

    // Position; flip to left/up if it'd overflow. Unhide first so we can
    // measure the menu, then re-position with correct dimensions.
    menu.hidden = false;
    menu.style.visibility = 'hidden';
    menu.dataset.target = JSON.stringify(target);

    const menuRect = menu.getBoundingClientRect();
    const left = Math.max(4, Math.min(x, window.innerWidth - menuRect.width - 4));
    const top  = Math.max(4, Math.min(y, window.innerHeight - menuRect.height - 4));
    menu.style.left = `${left}px`;
    menu.style.top  = `${top}px`;
    menu.style.visibility = 'visible';

    // Wire item clicks
    menu.querySelectorAll('.ce-fp-cm-item').forEach((el) => {
      el.addEventListener('click', () => {
        if (el.classList.contains('is-disabled')) return;
        this._hideContextMenu();
        this._runContextAction(el.dataset.act, target);
      });
    });
    this._contextMenu = menu;
  },

  _hideContextMenu() {
    const menu = document.querySelector('[data-role="contextmenu"]');
    if (menu) { menu.hidden = true; menu.innerHTML = ''; }
    this._contextMenu = null;
  },

  _contextMenuItems(target) {
    const hasSel = !!this._selected;
    const isDir  = target.type === 'dir';
    const isFile = target.type === 'file';
    const isBg   = target.type === 'background';
    const isFav  = target.type === 'favorite';
    const canPaste = !!this._loadJSON(CLIPBOARD_KEY, null);

    if (isFav) {
      return [
        { icon: '📂', label: 'Open',     act: 'fav-open' },
        { separator: true },
        { icon: '✏️',  label: 'Rename…',  act: 'fav-rename' },
        { icon: '⭐', label: 'Remove from favorites', act: 'fav-remove', danger: true },
      ];
    }
    if (isBg) {
      return [
        { icon: '📁', label: 'New folder', act: 'newfolder' },
        { icon: '📋', label: 'Paste',     act: 'paste', disabled: !canPaste },
        { icon: '⭐', label: 'Add current folder to favorites', act: 'fav-add-current' },
      ];
    }
    // Folder or file
    return [
      { icon: isDir ? '📂' : '📄', label: isDir ? 'Open' : 'Open file', act: isDir ? 'open' : 'open-file' },
      { icon: '⭐', label: 'Add to favorites', act: 'fav-add' },
      { separator: true },
      { icon: '✂️', label: 'Cut',         act: 'cut' },
      { icon: '📋', label: 'Copy',        act: 'copy' },
      { icon: '📥', label: 'Paste',       act: 'paste', disabled: !canPaste },
      { icon: '🧬', label: 'Duplicate',   act: 'duplicate', disabled: !hasSel },
      { separator: true },
      { icon: '🗑', label: 'Delete',     act: 'delete', danger: true, disabled: !hasSel },
      { icon: '✏️', label: 'Rename…',    act: 'rename', disabled: !hasSel || !isDir },
    ];
  },

  async _runContextAction(act, target) {
    switch (act) {
      case 'open':         return this._openSelected();
      case 'open-file':    return this._select();
      case 'newfolder':    return this._startNewFolder();
      case 'fav-add':      return this._favAddPath(this._joinPath(this._currentPath, this._selected));
      case 'fav-add-current': return this._addCurrentToFavorites();
      case 'fav-open':     return this._loadFolder(target.path, { pushHistory: true });
      case 'fav-rename':   return this._favRename(target);
      case 'fav-remove':   return this._removeFavorite(target.path);
      case 'cut':          return this._cutSelected();
      case 'copy':         return this._copySelected();
      case 'paste':        return this._pasteFromClipboard();
      case 'duplicate':    return this._duplicateSelected();
      case 'delete':       return this._trashSelected();
      case 'rename':       return this._renameSelected();
    }
  },

  _favAddPath(path) {
    const list = this._loadJSON(FAVORITES_KEY, []).filter((f) => f.path !== path);
    list.unshift({ path, label: this._basename(path) });
    this._saveJSON(FAVORITES_KEY, list.slice(0, MAX_FAVORITES));
    this._renderSidebar();
    this._setStatus(`Added "${this._basename(path)}" to favorites`);
    this._log('favorites:add', { path });
  },

  _favRename(target) {
    const label = prompt('Rename favorite:', target.label);
    if (!label) return;
    const list = this._loadJSON(FAVORITES_KEY, []).map((f) =>
      f.path === target.path ? { ...f, label } : f
    );
    this._saveJSON(FAVORITES_KEY, list);
    this._renderSidebar();
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Clipboard / cut / copy / paste / duplicate
  // ──────────────────────────────────────────────────────────────────────────

  _copySelected() {
    if (!this._selected) return;
    const full = this._joinPath(this._currentPath, this._selected);
    const isDir = this._currentItems.find((i) => i.name === this._selected)?.type === 'dir';
    this._saveJSON(CLIPBOARD_KEY, { op: 'copy', path: full, isDir });
    this._setStatus(`Copied: ${this._selected}`);
    this._log('clipboard:copy', { path: full });
  },

  _cutSelected() {
    if (!this._selected) return;
    const full = this._joinPath(this._currentPath, this._selected);
    const isDir = this._currentItems.find((i) => i.name === this._selected)?.type === 'dir';
    this._saveJSON(CLIPBOARD_KEY, { op: 'cut', path: full, isDir });
    this._setStatus(`Cut: ${this._selected}`);
    this._log('clipboard:cut', { path: full });
  },

  async _pasteFromClipboard() {
    if (!this._currentPath) return;
    const clip = this._loadJSON(CLIPBOARD_KEY, null);
    if (!clip?.path) { this._setStatus('Clipboard is empty.'); return; }
    // Use the bridge to perform the actual filesystem copy/move.
    try {
      this._setStatus(`${clip.op === 'cut' ? 'Moving' : 'Copying'}…`);
      const res = await this._fetch('/clipboard-op', {
        method: 'POST',
        body: JSON.stringify({
          op: clip.op,
          src: clip.path,
          dest: this._currentPath,
        }),
      });
      this._log('clipboard:paste:ok', { op: clip.op, dest: this._currentPath, newPath: res.path });
      this._setStatus(`${clip.op === 'cut' ? 'Moved' : 'Copied'}: ${res.name || this._basename(clip.path)}`);
      // Clear if cut
      if (clip.op === 'cut') this._saveJSON(CLIPBOARD_KEY, null);
      await this._loadFolder(this._currentPath, { pushHistory: false });
      this._selectItem(res.name || this._basename(clip.path));
    } catch (err) {
      this._log('clipboard:paste:error', { message: err?.message || String(err) });
      this._setStatus(`Cannot paste: ${err?.message || err}`);
    }
  },

  async _duplicateSelected() {
    if (!this._selected) return;
    const src = this._joinPath(this._currentPath, this._selected);
    try {
      const res = await this._fetch('/clipboard-op', {
        method: 'POST',
        body: JSON.stringify({ op: 'copy', src, dest: this._currentPath }),
      });
      this._setStatus(`Duplicated: ${res.name || this._selected}`);
      await this._loadFolder(this._currentPath, { pushHistory: false });
      this._selectItem(res.name || this._selected);
    } catch (err) {
      this._setStatus(`Cannot duplicate: ${err?.message || err}`);
    }
  },

  async _trashSelected() {
    if (!this._selected) return;
    const full = this._joinPath(this._currentPath, this._selected);
    if (!confirm(`Delete "${this._selected}"?\n\n${full}\n\nThis cannot be undone.`)) return;
    try {
      await this._fetch('/delete', {
        method: 'POST',
        body: JSON.stringify({ path: full }),
      });
      this._log('delete:ok', { path: full });
      this._setStatus(`Deleted: ${this._selected}`);
      this._selected = null;
      this._updateFooter();
      await this._loadFolder(this._currentPath, { pushHistory: false });
    } catch (err) {
      this._log('delete:error', { path: full, message: err?.message || String(err) });
      this._setStatus(`Cannot delete: ${err?.message || err}`);
    }
  },

  _renameSelected() {
    if (!this._selected) return;
    const item = this._currentItems.find((i) => i.name === this._selected);
    if (!item || item.type !== 'dir') return;
    const newName = prompt('Rename folder to:', this._selected);
    if (!newName || newName === this._selected) return;
    this._renameFolder(this._selected, newName).then(async (res) => {
      if (res?.ok) {
        await this._loadFolder(this._currentPath, { pushHistory: false });
        this._selectItem(newName);
      }
    });
  },

  async _renameFolder(oldName, newName) {
    const src = this._joinPath(this._currentPath, oldName);
    try {
      const res = await this._fetch('/rename', {
        method: 'POST',
        body: JSON.stringify({ path: src, newName }),
      });
      this._setStatus(`Renamed to: ${res.name || newName}`);
      this._log('rename:ok', { src, newName });
      return { ok: true, name: res.name || newName };
    } catch (err) {
      this._setStatus(`Cannot rename: ${err?.message || err}`);
      this._log('rename:error', { src, newName, message: err?.message || String(err) });
      return { ok: false };
    }
  },

  // ──────────────────────────────────────────────────────────────────────────
  // Resize
  // ──────────────────────────────────────────────────────────────────────────

  _bindResize() {
    const dlg = this._dialog;
    const handle = dlg.querySelector('[data-role="resize"]');
    if (!handle) return;
    let startX = 0, startY = 0, startW = 0, startH = 0;
    const onMove = (e) => {
      const w = Math.max(540, startW + (e.clientX - startX));
      const h = Math.max(360, startH + (e.clientY - startY));
      dlg.style.width = `${Math.min(w, window.innerWidth - 40)}px`;
      dlg.style.height = `${Math.min(h, window.innerHeight - 40)}px`;
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      try { localStorage.setItem('cyco.folderPicker.size', JSON.stringify({ w: dlg.offsetWidth, h: dlg.offsetHeight })); } catch {}
    };
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      startX = e.clientX; startY = e.clientY;
      startW = dlg.offsetWidth; startH = dlg.offsetHeight;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    // Restore saved size
    try {
      const saved = JSON.parse(localStorage.getItem('cyco.folderPicker.size') || 'null');
      if (saved?.w && saved?.h) {
        dlg.style.width = `${saved.w}px`;
        dlg.style.height = `${saved.h}px`;
      }
    } catch {}
  },

  _basename(p) {
    if (!p) return '';
    const trimmed = p.replace(/[\\/]+$/, '');
    const i = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'));
    return i < 0 ? trimmed : trimmed.slice(i + 1);
  },

  _joinPath(parent, name) {
    if (!parent) return name;
    const sep = parent.includes('\\') ? '\\' : '/';
    const trailing = parent.endsWith(sep);
    return parent + (trailing ? '' : sep) + name;
  },

  _splitCrumbs(p) {
    if (!p) return [];
    const sep = p.includes('\\') ? '\\' : '/';
    const parts = p.split(/[\\/]+/).filter(Boolean);
    if (parts.length === 0) return [{ label: sep, path: sep }];
    // On Windows, "C:" is the first part and must be reconstructed with "\\"
    const crumbs = [];
    let acc = '';
    if (/^[A-Z]:$/i.test(parts[0])) {
      acc = parts[0] + sep;
      crumbs.push({ label: parts[0], path: acc });
      parts.shift();
    } else if (p.startsWith('/')) {
      acc = '/';
      crumbs.push({ label: '/', path: '/' });
      parts.shift();
    }
    for (const part of parts) {
      acc = acc.endsWith(sep) ? acc + part : acc + sep + part;
      crumbs.push({ label: part, path: acc });
    }
    return crumbs;
  },

  _iconForKind(kind) {
    if (kind === 'home')      return '🏠';
    if (kind === 'desktop')   return '🖥️';
    if (kind === 'documents') return '📄';
    if (kind === 'downloads') return '📥';
    if (kind === 'pictures')  return '🖼️';
    if (kind === 'music')     return '🎵';
    if (kind === 'videos')    return '🎬';
    if (kind === 'drive')     return '💽';
    return '📁';
  },

  async _fetch(path, options = {}) {
    const res = await fetch(`${BRIDGE_URL}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
    const text = await res.text();
    const payload = text ? JSON.parse(text) : {};
    if (!res.ok || payload?.ok === false) {
      const err = new Error(payload?.error || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return payload;
  },
};

// ─── Utilities ─────────────────────────────────────────────────────────────

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
function escapeAttr(s) { return escapeHtml(s).replace(/"/g, '&quot;'); }

function iconForFile(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (['png','jpg','jpeg','gif','webp','bmp','svg','ico'].includes(ext)) return '🖼️';
  if (['mp3','wav','ogg','flac','aac','m4a'].includes(ext)) return '🎵';
  if (['mp4','mkv','avi','mov','webm'].includes(ext)) return '🎬';
  if (['zip','7z','rar','tar','gz','bz2'].includes(ext)) return '🗜️';
  if (['js','mjs','cjs','ts','jsx','tsx','json','html','css'].includes(ext)) return '📜';
  if (['md','txt','log'].includes(ext)) return '📃';
  if (['exe','msi','bat','cmd','sh','ps1'].includes(ext)) return '⚙️';
  if (['pdf'].includes(ext)) return '📕';
  if (['doc','docx','rtf','odt'].includes(ext)) return '📘';
  if (['xls','xlsx','csv','ods'].includes(ext)) return '📗';
  if (['ppt','pptx','odp'].includes(ext)) return '📙';
  return '📄';
}

function formatSize(bytes) {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const opts = sameYear
    ? { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }
    : { year: 'numeric', month: 'short', day: '2-digit' };
  return d.toLocaleString(undefined, opts);
}

export default FolderPickerPanel;
