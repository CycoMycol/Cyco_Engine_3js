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
      { id: 'root', pid: null, name: 'Scene', type: 'scene', open: true },
    ];
    this._selectedId = null;

    // ── root wrapper
    const wrap = document.createElement('div');
    wrap.className = 'ce-hierarchy';

    // ── search toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'ce-hier-toolbar';
    const searchInput = document.createElement('input');
    searchInput.className = 'ce-hier-search';
    searchInput.placeholder = 'Search hierarchy…';
    searchInput.type = 'text';
    toolbar.appendChild(searchInput);
    wrap.appendChild(toolbar);

    // ── tree
    const tree = document.createElement('div');
    tree.className = 'ce-hier-tree';
    wrap.appendChild(tree);
    this._tree = tree;

    // live search
    searchInput.addEventListener('input', () => {
      const q = searchInput.value.toLowerCase();
      tree.querySelectorAll('.ce-hier-row').forEach(row => {
        row.style.display = (!q || row.dataset.name.toLowerCase().includes(q)) ? '' : 'none';
      });
    });

    // right-click on tree
    tree.addEventListener('contextmenu', (e) => {
      const row = e.target.closest('.ce-hier-row');
      if (row) {
        this._selectedId = row.dataset.id;
        this._renderTree();
      }
      showHierarchyMenu(e, (action) => this._handleAction(action), !!row);
    });

    this._renderTree();
    return wrap;
  }

  // ── Action handler ────────────────────────────────────────────────────────
  _handleAction(action) {
    if (action === 'rename')    { this._startRename();  return; }
    if (action === 'duplicate') { this._duplicate();    return; }
    if (action === 'delete')    { this._delete();       return; }

    const def = OBJECT_DEFAULTS[action];
    if (!def) return;

    const pid = this._selectedId ?? 'root';
    const parent = this._nodes.find(n => n.id === pid);
    if (parent) parent.open = true;

    this._nodes.push({
      id:   Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      pid,
      name: def.name,
      type: def.type,
      open: false,
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

  _delete() {
    if (!this._selectedId || this._selectedId === 'root') return;
    const toDelete = new Set();
    const collect  = (id) => {
      toDelete.add(id);
      this._nodes.filter(n => n.pid === id).forEach(n => collect(n.id));
    };
    collect(this._selectedId);
    this._nodes      = this._nodes.filter(n => !toDelete.has(n.id));
    this._selectedId = null;
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
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter')  { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { this._renderTree(); }
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────
  _renderTree() {
    const container = this._tree;
    container.innerHTML = '';

    const nodes     = this._nodes;
    const openSet   = new Set(nodes.filter(n => n.open).map(n => n.id));
    const hasCh     = new Set(nodes.filter(n => n.pid !== null).map(n => n.pid));

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
      row.className = 'ce-hier-row' + (this._selectedId === node.id ? ' is-selected' : '');
      row.dataset.id   = node.id;
      row.dataset.name = node.name;

      const indent = document.createElement('span');
      indent.className = 'ce-hier-indent';
      indent.style.width = `${depthOf(node) * 16}px`;
      row.appendChild(indent);

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

      const icon = document.createElement('span');
      icon.className = 'ce-hier-icon';
      icon.textContent = TYPE_ICON[node.type] ?? '▣';
      row.appendChild(icon);

      const label = document.createElement('span');
      label.className = 'ce-hier-name';
      label.textContent = node.name;
      row.appendChild(label);

      const eye = document.createElement('span');
      eye.className = 'ce-hier-eye';
      eye.textContent = '👁';
      row.appendChild(eye);

      row.addEventListener('click', () => {
        this._selectedId = node.id;
        container.querySelectorAll('.ce-hier-row').forEach(r => r.classList.remove('is-selected'));
        row.classList.add('is-selected');
      });

      container.appendChild(row);
    }
  }
}


