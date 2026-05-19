import { BasePanel } from './BasePanel.js';
import { showHierarchyMenu, OBJECT_DEFAULTS } from '../ui/HierarchyContextMenu.js';

const TYPE_ICON = {
  scene:  '⊞',
  camera: '⊡',
  light:  '✦',
  object: '⊕',
  mesh:   '▣',
  sprite: '▧',
  ui:     '☐',
};

export class LeftPanel extends BasePanel {
  _buildContent() {
    // ── instance state
    this._nodes = [
      { id: 'root', pid: null, name: 'Scene', type: 'scene', open: true, locked: false, visible: true },
    ];
    this._selectedId   = null;
    this._confirmDelId = null; // node id whose X is pending confirmation
    this._dragId       = null;
    this._dropInfo     = null; // { targetId, mode: 'before'|'after'|'inside' }

    // ── root wrapper
    const wrap = document.createElement('div');
    wrap.className = 'ce-hierarchy';

    // ── toolbar: search input + add (+) button
    const toolbar = document.createElement('div');
    toolbar.className = 'ce-hier-toolbar';

    const searchInput = document.createElement('input');
    searchInput.className = 'ce-hier-search';
    searchInput.placeholder = 'Search…';
    searchInput.type = 'text';

    const addBtn = document.createElement('button');
    addBtn.className = 'ce-hier-add-btn';
    addBtn.textContent = '+';
    addBtn.title = 'Add object';

    toolbar.appendChild(searchInput);
    toolbar.appendChild(addBtn);
    wrap.appendChild(toolbar);

    // ── tree container
    const tree = document.createElement('div');
    tree.className = 'ce-hier-tree';
    wrap.appendChild(tree);
    this._tree = tree;

    // + button opens context menu at button position (no target → creates at root)
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._selectedId = null;
      showHierarchyMenu(e, (action) => this._handleAction(action), false);
    });

    // live search
    searchInput.addEventListener('input', () => {
      const q = searchInput.value.toLowerCase();
      tree.querySelectorAll('.ce-hier-row').forEach(row => {
        row.style.display = (!q || row.dataset.name.toLowerCase().includes(q)) ? '' : 'none';
      });
    });

    // right-click opens context menu
    tree.addEventListener('contextmenu', (e) => {
      const row = e.target.closest('.ce-hier-row');
      if (row) {
        this._selectedId = row.dataset.id;
        this._renderTree();
      }
      showHierarchyMenu(e, (action) => this._handleAction(action), !!row);
    });

    // click on empty tree area cancels pending delete confirmation
    tree.addEventListener('click', (e) => {
      if (!e.target.closest('.ce-hier-row') && this._confirmDelId) {
        this._confirmDelId = null;
        this._renderTree();
      }
    });

    // drag events (delegated to container)
    tree.addEventListener('dragover',  (e) => this._onDragOver(e));
    tree.addEventListener('dragleave', (e) => this._onDragLeave(e));
    tree.addEventListener('drop',      (e) => this._onDrop(e));
    tree.addEventListener('dragend',   ()  => this._onDragEnd());

    this._renderTree();
    return wrap;
  }

  // ── Action handler ────────────────────────────────────────────────────────
  _handleAction(action) {
    if (action === 'rename')    { this._startRename(); return; }
    if (action === 'duplicate') { this._duplicate();   return; }
    if (action === 'delete')    { this._delete();      return; }

    const def = OBJECT_DEFAULTS[action];
    if (!def) return;

    const pid    = this._selectedId ?? 'root';
    const parent = this._nodes.find(n => n.id === pid);
    if (parent) parent.open = true;

    this._nodes.push({
      id:      Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      pid,
      name:    def.name,
      type:    def.type,
      open:    false,
      locked:  false,
      visible: true,
    });
    this._renderTree();
  }

  _duplicate() {
    if (!this._selectedId || this._selectedId === 'root') return;
    const src = this._nodes.find(n => n.id === this._selectedId);
    if (!src) return;
    this._nodes.push({
      ...src,
      id:   Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      name: src.name + ' (Copy)',
    });
    this._renderTree();
  }

  _delete(id = this._selectedId) {
    if (!id || id === 'root') return;
    const toDelete = new Set();
    const collect  = (nodeId) => {
      toDelete.add(nodeId);
      this._nodes.filter(n => n.pid === nodeId).forEach(n => collect(n.id));
    };
    collect(id);
    this._nodes        = this._nodes.filter(n => !toDelete.has(n.id));
    this._selectedId   = null;
    this._confirmDelId = null;
    this._renderTree();
  }

  _startRename() {
    if (!this._selectedId) return;
    const row   = this._tree.querySelector(`.ce-hier-row[data-id="${this._selectedId}"]`);
    const node  = this._nodes.find(n => n.id === this._selectedId);
    const label = row?.querySelector('.ce-hier-name');
    if (!row || !node || !label) return;

    const input = document.createElement('input');
    input.className = 'ce-hier-rename-input';
    input.value = node.name;
    label.replaceWith(input);
    input.focus();
    input.select();

    const commit = () => {
      node.name = input.value.trim() || node.name;
      this._renderTree();
    };
    input.addEventListener('blur',    commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter')  { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { this._renderTree(); }
    });
  }

  // ── Drag-and-drop ─────────────────────────────────────────────────────────
  _onDragStart(e, node) {
    if (node.id === 'root') { e.preventDefault(); return; }
    this._dragId = node.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', node.id);
    // defer so the row's ghost image is captured before we dim it
    setTimeout(() => {
      const r = this._tree.querySelector(`.ce-hier-row[data-id="${node.id}"]`);
      if (r) r.classList.add('is-dragging');
    }, 0);
  }

  _onDragOver(e) {
    if (!this._dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const row = e.target.closest('.ce-hier-row');
    if (!row) return;
    const targetId = row.dataset.id;
    if (targetId === this._dragId) return;
    if (this._isDescendant(targetId, this._dragId)) return;

    const rect = row.getBoundingClientRect();
    const relY  = e.clientY - rect.top;
    const h     = rect.height;
    const mode  = relY < h * 0.28 ? 'before' : relY > h * 0.72 ? 'after' : 'inside';

    // avoid redundant DOM updates
    const prev = this._dropInfo;
    if (prev && prev.targetId === targetId && prev.mode === mode) return;

    this._dropInfo = { targetId, mode };
    this._applyDropIndicators();
  }

  _onDragLeave(e) {
    // Only clear when leaving the tree container entirely
    if (!this._tree.contains(e.relatedTarget)) {
      this._dropInfo = null;
      this._applyDropIndicators();
    }
  }

  _applyDropIndicators() {
    this._tree.querySelectorAll('.ce-hier-row').forEach(r =>
      r.classList.remove('drop-before', 'drop-after', 'drop-inside'));
    if (!this._dropInfo) return;
    const { targetId, mode } = this._dropInfo;
    const row = this._tree.querySelector(`.ce-hier-row[data-id="${targetId}"]`);
    if (row) row.classList.add(`drop-${mode}`);
  }

  _onDrop(e) {
    e.preventDefault();
    if (!this._dragId || !this._dropInfo) { this._clearDragState(); return; }

    const { targetId, mode } = this._dropInfo;
    const dragNode   = this._nodes.find(n => n.id === this._dragId);
    const targetNode = this._nodes.find(n => n.id === targetId);
    if (!dragNode || !targetNode) { this._clearDragState(); return; }

    // Collect dragged node + all descendants in depth-first order
    const collectSubtree = (id) => {
      const n = this._nodes.find(x => x.id === id);
      if (!n) return [];
      return [n, ...this._nodes.filter(x => x.pid === id).flatMap(c => collectSubtree(c.id))];
    };
    const subtree    = collectSubtree(this._dragId);
    const subtreeIds = new Set(subtree.map(n => n.id));

    // Remove subtree from array, then re-insert at target position
    this._nodes = this._nodes.filter(n => !subtreeIds.has(n.id));
    const tIdx  = this._nodes.findIndex(n => n.id === targetId);

    if (mode === 'inside') {
      dragNode.pid   = targetId;
      targetNode.open = true;
      this._nodes.splice(tIdx + 1, 0, ...subtree);
    } else if (mode === 'before') {
      dragNode.pid = targetNode.pid;
      this._nodes.splice(tIdx, 0, ...subtree);
    } else { // after
      dragNode.pid = targetNode.pid;
      this._nodes.splice(tIdx + 1, 0, ...subtree);
    }

    this._clearDragState();
    this._renderTree();
  }

  _onDragEnd() {
    if (this._dragId) { this._clearDragState(); this._renderTree(); }
  }

  _clearDragState() {
    this._dragId   = null;
    this._dropInfo = null;
  }

  _isDescendant(nodeId, ancestorId) {
    let cur = this._nodes.find(n => n.id === nodeId);
    while (cur?.pid) {
      if (cur.pid === ancestorId) return true;
      cur = this._nodes.find(n => n.id === cur.pid);
    }
    return false;
  }

  // ── Render ────────────────────────────────────────────────────────────────
  _renderTree() {
    const container = this._tree;
    container.innerHTML = '';

    const nodes   = this._nodes;
    const openSet = new Set(nodes.filter(n => n.open).map(n => n.id));
    const hasCh   = new Set(nodes.filter(n => n.pid !== null).map(n => n.pid));

    const depthOf = (node) => {
      let d = 0, cur = node;
      while (cur.pid !== null) {
        cur = nodes.find(n => n.id === cur.pid);
        if (!cur) break;
        d++;
      }
      return d;
    };

    const isVisible = (node) => {
      let cur = node;
      while (cur.pid !== null) {
        const p = nodes.find(n => n.id === cur.pid);
        if (!p || !openSet.has(p.id)) return false;
        cur = p;
      }
      return true;
    };

    for (const node of nodes) {
      if (!isVisible(node)) continue;

      const row = document.createElement('div');
      row.className = 'ce-hier-row' +
        (this._selectedId === node.id ? ' is-selected'   : '') +
        (!node.visible               ? ' is-hidden-obj'  : '');
      row.dataset.id   = node.id;
      row.dataset.name = node.name;

      // drag handle (not on root)
      if (node.id !== 'root') {
        row.draggable = true;
        row.addEventListener('dragstart', (e) => this._onDragStart(e, node));
      }

      // indent
      const indent = document.createElement('span');
      indent.className = 'ce-hier-indent';
      indent.style.width = `${depthOf(node) * 16}px`;
      row.appendChild(indent);

      // expand/collapse arrow
      const arrow = document.createElement('span');
      const hasC  = hasCh.has(node.id);
      arrow.className = 'ce-hier-arrow' + (hasC ? '' : ' ce-hier-arrow-leaf');
      arrow.textContent = hasC ? (openSet.has(node.id) ? '▾' : '▸') : ' ';
      if (hasC) {
        arrow.addEventListener('click', (e) => {
          e.stopPropagation();
          node.open = !node.open;
          this._renderTree();
        });
      }
      row.appendChild(arrow);

      // type icon
      const icon = document.createElement('span');
      icon.className = 'ce-hier-icon';
      icon.textContent = TYPE_ICON[node.type] ?? '▣';
      row.appendChild(icon);

      // name
      const label = document.createElement('span');
      label.className = 'ce-hier-name' + (node.locked ? ' is-locked' : '');
      label.textContent = node.name;
      row.appendChild(label);

      // ── right-side action buttons ─────────────────────────────────────
      // Eye (visibility toggle)
      const eye = document.createElement('span');
      eye.className = 'ce-hier-btn ce-hier-eye' + (node.visible ? '' : ' is-hidden');
      eye.textContent = node.visible ? '👁' : '🚫';
      eye.title = node.visible ? 'Hide' : 'Show';
      eye.addEventListener('click', (e) => {
        e.stopPropagation();
        node.visible = !node.visible;
        this._renderTree();
      });
      row.appendChild(eye);

      if (node.id !== 'root') {
        // Lock toggle
        const lock = document.createElement('span');
        lock.className = 'ce-hier-btn ce-hier-lock' + (node.locked ? ' is-locked' : '');
        lock.textContent = node.locked ? '🔒' : '🔓';
        lock.title = node.locked ? 'Unlock' : 'Lock';
        lock.addEventListener('click', (e) => {
          e.stopPropagation();
          node.locked = !node.locked;
          this._renderTree();
        });
        row.appendChild(lock);

        // Delete button: X → turns to ✓ on first click, ✓ → deletes on second click
        const isConfirm = this._confirmDelId === node.id;
        const del = document.createElement('span');
        del.className = 'ce-hier-btn ce-hier-del' + (isConfirm ? ' is-confirm' : '');
        del.textContent = isConfirm ? '✓' : '✕';
        del.title = isConfirm ? 'Confirm delete' : 'Delete';
        del.addEventListener('click', (e) => {
          e.stopPropagation();
          if (this._confirmDelId === node.id) {
            this._delete(node.id);
          } else {
            this._confirmDelId = node.id;
            this._renderTree();
          }
        });
        row.appendChild(del);
      }

      // row selection click
      row.addEventListener('click', () => {
        if (this._confirmDelId && this._confirmDelId !== node.id) {
          this._confirmDelId = null; // cancel pending confirm on another row
        }
        this._selectedId = node.id;
        container.querySelectorAll('.ce-hier-row').forEach(r => r.classList.remove('is-selected'));
        row.classList.add('is-selected');
      });

      container.appendChild(row);
    }
  }
}

