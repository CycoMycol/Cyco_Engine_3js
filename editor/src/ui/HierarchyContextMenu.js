/**
 * HierarchyContextMenu.js
 * Right-click context menu for the Scene Hierarchy panel.
 */

// ─── Menu schema ─────────────────────────────────────────────────────────────
const CREATE_SCHEMA = [
  { label: 'Create Empty', action: 'empty' },
  { separator: true },
  { label: '3D Object', sub: [
    { label: 'Cube',            action: '3d-cube'      },
    { label: 'Sphere',          action: '3d-sphere'    },
    { label: 'Plane',           action: '3d-plane'     },
    { label: 'Cylinder',        action: '3d-cylinder'  },
    { label: 'Capsule',         action: '3d-capsule'   },
    { label: 'Torus',           action: '3d-torus'     },
  ]},
  { label: '2D Object', sub: [
    { label: 'Sprite',          action: '2d-sprite'    },
    { label: 'Tilemap',         action: '2d-tilemap'   },
    { label: 'Particle System', action: '2d-particles' },
  ]},
  { label: 'Light', sub: [
    { label: 'Directional Light', action: 'light-dir'   },
    { label: 'Point Light',       action: 'light-point' },
    { label: 'Spot Light',        action: 'light-spot'  },
    { label: 'Area Light',        action: 'light-area'  },
  ]},
  { label: 'Camera', action: 'camera' },
  { label: 'UI', sub: [
    { label: 'Canvas',      action: 'ui-canvas' },
    { label: 'Text',        action: 'ui-text'   },
    { label: 'Button',      action: 'ui-button' },
    { label: 'Image',       action: 'ui-image'  },
    { label: 'Panel',       action: 'ui-panel'  },
    { label: 'Input Field', action: 'ui-input'  },
  ]},
];

// ─── Object defaults ──────────────────────────────────────────────────────────
export const OBJECT_DEFAULTS = {
  'empty':        { name: 'GameObject',        type: 'object' },
  '3d-cube':      { name: 'Cube',              type: 'mesh'   },
  '3d-sphere':    { name: 'Sphere',            type: 'mesh'   },
  '3d-plane':     { name: 'Plane',             type: 'mesh'   },
  '3d-cylinder':  { name: 'Cylinder',          type: 'mesh'   },
  '3d-capsule':   { name: 'Capsule',           type: 'mesh'   },
  '3d-torus':     { name: 'Torus',             type: 'mesh'   },
  '2d-sprite':    { name: 'Sprite',            type: 'sprite' },
  '2d-tilemap':   { name: 'Tilemap',           type: 'sprite' },
  '2d-particles': { name: 'Particle System',   type: 'object' },
  'light-dir':    { name: 'Directional Light', type: 'light'  },
  'light-point':  { name: 'Point Light',       type: 'light'  },
  'light-spot':   { name: 'Spot Light',        type: 'light'  },
  'light-area':   { name: 'Area Light',        type: 'light'  },
  'camera':       { name: 'Camera',            type: 'camera' },
  'ui-canvas':    { name: 'Canvas',            type: 'ui'     },
  'ui-text':      { name: 'Text',              type: 'ui'     },
  'ui-button':    { name: 'Button',            type: 'ui'     },
  'ui-image':     { name: 'Image',             type: 'ui'     },
  'ui-panel':     { name: 'Panel',             type: 'ui'     },
  'ui-input':     { name: 'Input Field',       type: 'ui'     },
};

// ─── State ────────────────────────────────────────────────────────────────────
let _menu        = null;
let _submenu     = null;
let _hideTimer   = null;
let _moveWatcher = null;

function _cancelHide() {
  if (_hideTimer) { clearTimeout(_hideTimer); _hideTimer = null; }
}

// Start the close countdown once. Does NOT reset on repeated calls — the timer
// fires 500 ms after the mouse first leaves both menus.
function _scheduleHide() {
  if (_hideTimer) return;
  _hideTimer = setTimeout(closeAll, 500);
}

// Returns true when (x, y) is inside the rect (with a small grace margin).
function _inRect(rect, x, y) {
  const M = 4; // px margin so sub-pixel gaps don't matter
  return x >= rect.left - M && x <= rect.right  + M &&
         y >= rect.top  - M && y <= rect.bottom + M;
}

// Track the mouse on the document so we catch every pixel, including any gap
// between the main menu and the submenu where mouseleave would be unreliable.
function _startWatcher() {
  _stopWatcher();
  _moveWatcher = (e) => {
    if (!_menu) { _stopWatcher(); return; }
    const mx = e.clientX, my = e.clientY;
    const inside = _inRect(_menu.getBoundingClientRect(), mx, my) ||
                   (_submenu != null && _inRect(_submenu.getBoundingClientRect(), mx, my));
    if (inside) {
      _cancelHide();
    } else {
      _scheduleHide(); // starts the 500 ms countdown (only once)
    }
  };
  document.addEventListener('mousemove', _moveWatcher, { passive: true });
}

function _stopWatcher() {
  if (_moveWatcher) {
    document.removeEventListener('mousemove', _moveWatcher);
    _moveWatcher = null;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────
export function closeAll() {
  _cancelHide();
  _stopWatcher();
  if (_submenu) { _submenu.remove(); _submenu = null; }
  if (_menu)    { _menu.remove();    _menu    = null; }
  document.removeEventListener('mousedown', _onOutside);
}

export function showHierarchyMenu(e, onAction, hasTarget = false) {
  e.preventDefault();
  e.stopPropagation();
  closeAll();

  const schema = hasTarget
    ? [...CREATE_SCHEMA,
        { separator: true },
        { label: 'Rename',    action: 'rename'    },
        { label: 'Duplicate', action: 'duplicate' },
        { label: 'Delete',    action: 'delete', danger: true },
      ]
    : CREATE_SCHEMA;

  _menu = _buildMenu(schema, onAction);
  document.body.appendChild(_menu);
  _placeAt(_menu, e.clientX, e.clientY);
  _startWatcher();
  setTimeout(() => document.addEventListener('mousedown', _onOutside), 0);
}

// ─── Internal ─────────────────────────────────────────────────────────────────
function _onOutside(e) {
  if (_menu?.contains(e.target) || _submenu?.contains(e.target)) return;
  closeAll();
}

function _placeAt(el, x, y) {
  const vw = window.innerWidth, vh = window.innerHeight;
  const w = el.offsetWidth  || 180;
  const h = el.offsetHeight || 220;
  el.style.left = (x + w > vw ? x - w : x) + 'px';
  el.style.top  = (y + h > vh ? y - h : y) + 'px';
}

// level=0 → main menu, level=1 → submenu.
// This matters because the leaf-item mouseenter must NOT close _submenu when
// the leaf IS inside _submenu (that would remove the menu from under the mouse).
function _buildMenu(items, onAction, level = 0) {
  const menu = document.createElement('div');
  menu.className = 'ce-ctx-menu';

  for (const item of items) {
    if (item.separator) {
      const sep = document.createElement('div');
      sep.className = 'ce-ctx-sep';
      menu.appendChild(sep);
      continue;
    }

    const row = document.createElement('div');
    row.className = 'ce-ctx-item' +
      (item.danger ? ' is-danger' : '') +
      (item.sub    ? ' has-sub'   : '');

    const lbl = document.createElement('span');
    lbl.className = 'ce-ctx-label';
    lbl.textContent = item.label;
    row.appendChild(lbl);

    if (item.sub) {
      const arrow = document.createElement('span');
      arrow.className = 'ce-ctx-arrow';
      arrow.textContent = '▸';
      row.appendChild(arrow);

      row.addEventListener('mouseenter', () => {
        _cancelHide();
        if (_submenu) { _submenu.remove(); _submenu = null; }

        _submenu = _buildMenu(item.sub, onAction, level + 1);
        _submenu.classList.add('ce-ctx-submenu');
        document.body.appendChild(_submenu);

        const rr = row.getBoundingClientRect();
        const vw = window.innerWidth, vh = window.innerHeight;
        const sw = _submenu.offsetWidth  || 180;
        const sh = _submenu.offsetHeight || 200;
        // Overlap by 2px so there is never a physical gap for the mouse to fall through
        const sx = (rr.right + sw > vw) ? rr.left - sw + 2 : rr.right - 2;
        const sy = (rr.top  + sh > vh) ? vh - sh - 4 : rr.top;
        _submenu.style.left = sx + 'px';
        _submenu.style.top  = sy + 'px';
      });

    } else {
      row.addEventListener('mouseenter', () => {
        // Only close the submenu when hovering a leaf item in the MAIN menu.
        // At level > 0 we ARE inside _submenu — removing it would destroy the
        // very panel the user is hovering, which closes the menu instantly.
        if (level === 0 && _submenu) { _submenu.remove(); _submenu = null; }
        _cancelHide();
      });
      row.addEventListener('click', () => {
        closeAll();
        onAction(item.action);
      });
    }

    menu.appendChild(row);
  }

  return menu;
}
