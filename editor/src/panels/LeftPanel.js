import { BasePanel } from './BasePanel.js';

// ─── Default placeholder scene tree ─────────────────────────────────────────
const DEMO_NODES = [
  { id: 1,  pid: null, name: 'Scene',              type: 'scene',  open: true  },
  { id: 2,  pid: 1,    name: 'Main Camera',         type: 'camera', open: false },
  { id: 3,  pid: 1,    name: 'Directional Light',   type: 'light',  open: false },
  { id: 4,  pid: 1,    name: 'Player',              type: 'object', open: true  },
  { id: 5,  pid: 4,    name: 'Body',                type: 'mesh',   open: false },
  { id: 6,  pid: 4,    name: 'Weapon',              type: 'mesh',   open: false },
  { id: 7,  pid: 1,    name: 'Environment',         type: 'object', open: true  },
  { id: 8,  pid: 7,    name: 'Terrain',             type: 'mesh',   open: false },
  { id: 9,  pid: 7,    name: 'Skybox',              type: 'mesh',   open: false },
  { id: 10, pid: 7,    name: 'Water',               type: 'mesh',   open: false },
];

const TYPE_ICON = {
  scene:  '⊞',
  camera: '⊡',
  light:  '✦',
  object: '⊕',
  mesh:   '▣',
};

export class LeftPanel extends BasePanel {
  _buildContent() {
    const wrap = document.createElement('div');
    wrap.className = 'ce-hierarchy';

    // ── toolbar row
    const toolbar = document.createElement('div');
    toolbar.className = 'ce-hier-toolbar';
    const searchInput = document.createElement('input');
    searchInput.className = 'ce-hier-search';
    searchInput.placeholder = 'Search hierarchy…';
    searchInput.type = 'text';
    toolbar.appendChild(searchInput);
    wrap.appendChild(toolbar);

    // ── tree container
    const tree = document.createElement('div');
    tree.className = 'ce-hier-tree';
    wrap.appendChild(tree);

    this._renderTree(tree, DEMO_NODES);

    // live search filter
    searchInput.addEventListener('input', () => {
      const q = searchInput.value.toLowerCase();
      tree.querySelectorAll('.ce-hier-row').forEach(row => {
        const match = !q || row.dataset.name.toLowerCase().includes(q);
        row.style.display = match ? '' : 'none';
      });
    });

    return wrap;
  }

  _renderTree(container, nodes) {
    container.innerHTML = '';
    // Build depth map
    const depthOf = (node) => {
      let d = 0, cur = node;
      while (cur.pid !== null) {
        cur = nodes.find(n => n.id === cur.pid);
        d++;
      }
      return d;
    };

    // Determine visible nodes (collapsed children hidden)
    const openSet = new Set(nodes.filter(n => n.open).map(n => n.id));
    const hasChildren = new Set(nodes.filter(n => n.pid !== null).map(n => n.pid));

    const isVisible = (node) => {
      let cur = node;
      while (cur.pid !== null) {
        const parent = nodes.find(n => n.id === cur.pid);
        if (!openSet.has(parent.id)) return false;
        cur = parent;
      }
      return true;
    };

    let rowIndex = 0;
    nodes.forEach(node => {
      if (!isVisible(node)) return;
      const depth = depthOf(node);
      const row = document.createElement('div');
      row.className = 'ce-hier-row';
      row.dataset.id   = node.id;
      row.dataset.name = node.name;
      row.dataset.rowIndex = rowIndex++;

      // indent
      const indent = document.createElement('span');
      indent.className = 'ce-hier-indent';
      indent.style.width = `${depth * 16}px`;
      row.appendChild(indent);

      // expand arrow
      const arrow = document.createElement('span');
      arrow.className = 'ce-hier-arrow' + (hasChildren.has(node.id) ? '' : ' ce-hier-arrow-leaf');
      arrow.textContent = hasChildren.has(node.id) ? (openSet.has(node.id) ? '▾' : '▸') : ' ';
      if (hasChildren.has(node.id)) {
        arrow.addEventListener('click', (e) => {
          e.stopPropagation();
          if (openSet.has(node.id)) openSet.delete(node.id);
          else openSet.add(node.id);
          this._renderTree(container, nodes);
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
      label.className = 'ce-hier-name';
      label.textContent = node.name;
      row.appendChild(label);

      // visibility toggle (eye)
      const eye = document.createElement('span');
      eye.className = 'ce-hier-eye';
      eye.textContent = '👁';
      eye.title = 'Toggle visibility';
      row.appendChild(eye);

      row.addEventListener('click', () => {
        container.querySelectorAll('.ce-hier-row').forEach(r => r.classList.remove('is-selected'));
        row.classList.add('is-selected');
      });

      container.appendChild(row);
    });
  }
}

