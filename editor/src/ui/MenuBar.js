/**
 * MenuBar.js — top menu bar with logo, menu items (left) and panel toggle
 * buttons + layout button (right), matching VS Code title bar style.
 */

import { createLogo }   from './Logo.js';
import ThemeManager     from '../theme/theme-manager.js';
import ThemeDialog      from './ThemeDialog.js';
import LayoutManager    from '../layout-manager.js';
import { cePrompt }     from './ce-prompt.js';
import NewProjectDialog from './NewProjectDialog.js';
import ProjectManager   from '../project/ProjectManager.js';
import { makeFloatable } from './FloatBar.js';

const PANEL_IDS = [
  { id: 'scene-hierarchy', label: 'Left',   icon: '▐▌' },
  { id: 'center-viewport', label: 'Center', icon: '▌▐' },
  { id: 'properties',      label: 'Right',  icon: '▌▐' },
  { id: 'assets-browser',  label: 'Bottom', icon: '▄'  },
];

export function createMenuBar(options = {}) {
  const nav = document.createElement('nav');
  nav.id = 'menu-bar';

  // ── Left region ────────────────────────────────────────────────────────────
  const left = document.createElement('div');
  left.className = 'menu-left';

  // Logo
  const logoWrap = document.createElement('div');
  logoWrap.className = 'ce-logo';
  logoWrap.appendChild(createLogo());
  left.appendChild(logoWrap);

  // Menu items
  const menuItems = [
    { label: 'File',   items: fileMenu() },
    { label: 'Edit',   items: editMenu() },
    { label: 'View',   items: viewMenu() },
    { label: 'Window', items: windowMenu() },
    { label: 'Help',   items: helpMenu() },
  ];

  menuItems.forEach(m => {
    const item = buildMenuItem(m.label, m.items);
    left.appendChild(item);
  });

  // ── Right region ───────────────────────────────────────────────────────────
  const right = document.createElement('div');
  right.className = 'menu-right';

  // Panel toggle buttons
  const toggleBtns = {};
  PANEL_IDS.forEach(p => {
    const btn = document.createElement('button');
    btn.className = 'panel-toggle-btn';
    btn.title = `Toggle ${p.label} Panel`;
    btn.innerHTML = _panelIcon(p.id);
    btn.dataset.panelId = p.id;
    btn.addEventListener('click', () => {
      LayoutManager.togglePanel(p.id);
    });
    toggleBtns[p.id] = btn;
    right.appendChild(btn);
  });

  const sep = document.createElement('div');
  sep.className = 'toggle-separator';
  right.appendChild(sep);

  // Customize layout button
  const layoutBtn = document.createElement('button');
  layoutBtn.className = 'panel-toggle-btn';
  layoutBtn.title = 'Save / Load Layout';
  layoutBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
    <rect x="1" y="1" width="5" height="5" rx="1"/>
    <rect x="8" y="1" width="5" height="5" rx="1"/>
    <rect x="1" y="8" width="5" height="5" rx="1"/>
    <rect x="8" y="8" width="5" height="5" rx="1"/>
  </svg>`;
  layoutBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    _showLayoutDropdown(layoutBtn);
  });
  right.appendChild(layoutBtn);

  // Float toggle
  if (!options.noFloatBtn) {
    const floatSep = document.createElement('div');
    floatSep.className = 'toggle-separator';
    right.appendChild(floatSep);
    right.appendChild(makeFloatable(nav));
  }

  nav.appendChild(left);
  nav.appendChild(right);

  // Sync toggle btn states when layout changes
  document.addEventListener('cyco-layout-change', () => {
    PANEL_IDS.forEach(p => {
      const visible = LayoutManager.isPanelVisible(p.id);
      const btn = toggleBtns[p.id];
      btn.classList.toggle('active', visible);
      btn.classList.toggle('panel-hidden', !visible);
    });
  });

  // Close all dropdowns on outside click
  document.addEventListener('click', _closeAll);

  return nav;
}

// ─── Menu builder helpers ─────────────────────────────────────────────────────

function buildMenuItem(label, items) {
  const wrap = document.createElement('div');
  wrap.className = 'menu-item';
  wrap.textContent = label;

  // Build dropdown but keep it DETACHED — it will be portaled into document.body
  // when opened, escaping any overflow:hidden containers from dockview.
  const dropdown = buildDropdown(items);

  // Stop all clicks inside the dropdown from bubbling to document
  // (so the document-level _closeAll listener doesn't fire prematurely).
  dropdown.addEventListener('click', (e) => e.stopPropagation());

  let closeTimer = null;

  function _openDropdown() {
    const rect = wrap.getBoundingClientRect();
    dropdown.style.position = 'fixed';
    dropdown.style.left   = rect.left + 'px';
    dropdown.style.top    = rect.bottom + 'px';
    dropdown.style.bottom = 'auto';
    document.body.appendChild(dropdown);
    dropdown.classList.add('open');
    wrap.classList.add('open');

    // Flip upward when bar is near the bottom of the viewport
    requestAnimationFrame(() => {
      const ddRect = dropdown.getBoundingClientRect();
      if (ddRect.bottom > window.innerHeight - 4) {
        dropdown.style.top    = 'auto';
        dropdown.style.bottom = (window.innerHeight - rect.top) + 'px';
      }
    });
  }

  function _closeDropdown() {
    dropdown.classList.remove('open');
    wrap.classList.remove('open');
    if (dropdown.parentElement === document.body) document.body.removeChild(dropdown);
  }

  wrap.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = dropdown.parentElement !== null;
    _closeAll();
    if (!isOpen) _openDropdown();
  });

  wrap.addEventListener('mouseenter', () => {
    clearTimeout(closeTimer);
    // If another dropdown is already open, switch to this one
    if (document.querySelector('.menu-item.open')) {
      _closeAll();
      _openDropdown();
    }
  });

  wrap.addEventListener('mouseleave', () => {
    closeTimer = setTimeout(() => {
      if (!wrap.matches(':hover') && !dropdown.matches(':hover')) _closeDropdown();
    }, 180);
  });

  dropdown.addEventListener('mouseenter', () => clearTimeout(closeTimer));
  dropdown.addEventListener('mouseleave', () => {
    closeTimer = setTimeout(() => {
      if (!wrap.matches(':hover') && !dropdown.matches(':hover')) _closeDropdown();
    }, 180);
  });

  return wrap;
}

function buildDropdown(items) {
  const dd = document.createElement('div');
  dd.className = 'menu-dropdown';
  items.forEach(item => dd.appendChild(buildDropdownItem(item)));
  return dd;
}

function buildDropdownItem(item) {
  if (item.separator) {
    const sep = document.createElement('div');
    sep.className = 'menu-dropdown-separator';
    return sep;
  }
  const el = document.createElement('div');
  el.className = 'menu-dropdown-item';
  if (item.checked) el.classList.add('checked');

  const labelEl = document.createElement('span');
  labelEl.className = 'menu-item-label';
  labelEl.textContent = item.label;
  el.appendChild(labelEl);

  if (item.dynamicSubmenu) {
    // Rebuilt on every hover so the list always reflects current state
    const arrow = document.createElement('span');
    arrow.className = 'submenu-arrow';
    arrow.textContent = '▶';
    el.appendChild(arrow);

    const sub = document.createElement('div');
    sub.className = 'menu-submenu';
    el.appendChild(sub);

    let subTimer = null;
    el.addEventListener('mouseenter', () => {
      clearTimeout(subTimer);
      sub.innerHTML = '';
      item.dynamicSubmenu().forEach(si => sub.appendChild(buildDropdownItem(si)));
      el.classList.add('submenu-open');
    });
    el.addEventListener('mouseleave', () => {
      subTimer = setTimeout(() => el.classList.remove('submenu-open'), 180);
    });
  } else if (item.submenu) {
    const arrow = document.createElement('span');
    arrow.className = 'submenu-arrow';
    arrow.textContent = '▶';
    el.appendChild(arrow);

    const sub = buildDropdown(item.submenu);
    sub.className = 'menu-submenu';
    el.appendChild(sub);

    let subTimer = null;
    el.addEventListener('mouseenter', () => {
      clearTimeout(subTimer);
      el.classList.add('submenu-open');
    });
    el.addEventListener('mouseleave', () => {
      subTimer = setTimeout(() => el.classList.remove('submenu-open'), 180);
    });
  } else if (item.action) {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      _closeAll();
      item.action();
    });
  }

  // Delete button: × → ✓ confirm → call deleteAction
  if (item.deleteAction) {
    const delBtn = document.createElement('button');
    delBtn.className = 'menu-item-delete-btn';
    delBtn.textContent = '×';
    delBtn.title = 'Delete';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (delBtn.dataset.confirm === '1') {
        _closeAll();
        item.deleteAction();
      } else {
        delBtn.dataset.confirm = '1';
        delBtn.textContent = '✓';
        delBtn.classList.add('confirming');
        setTimeout(() => {
          if (delBtn.dataset.confirm === '1') {
            delBtn.dataset.confirm = '';
            delBtn.textContent = '×';
            delBtn.classList.remove('confirming');
          }
        }, 3000);
      }
    });
    el.appendChild(delBtn);
  }

  return el;
}

function _closeAll() {
  // Close portal dropdowns (appended to body) and remove them from the DOM
  document.querySelectorAll('.menu-dropdown.open').forEach(d => {
    d.classList.remove('open');
    if (d.parentElement === document.body) document.body.removeChild(d);
  });
  document.querySelectorAll('.menu-item.open').forEach(i => i.classList.remove('open'));
}

// ─── Layout quick-dropdown from the ⊞ button ──────────────────────────────
function _showLayoutDropdown(anchor) {
  // Remove existing
  const existing = document.getElementById('ce-layout-quick-dd');
  if (existing) { existing.remove(); return; }

  const dd = document.createElement('div');
  dd.id = 'ce-layout-quick-dd';
  dd.className = 'menu-dropdown open';
  dd.style.cssText = 'position:fixed;right:8px;top:42px;';

  const saved = LayoutManager.listSavedLayouts();
  if (saved.length > 0) {
    saved.forEach(name => {
      const item = document.createElement('div');
      item.className = 'menu-dropdown-item';
      item.textContent = name;
      item.addEventListener('click', () => { LayoutManager.loadLayout(name); dd.remove(); });
      dd.appendChild(item);
    });
    const sep = document.createElement('div');
    sep.className = 'menu-dropdown-separator';
    dd.appendChild(sep);
  }

  [
    ['Save Current Layout...', async () => {
      const name = await cePrompt('Layout name:', 'My Layout');
      if (name) LayoutManager.saveLayout(name);
    }],
    ['Reset to Default', () => LayoutManager.resetToDefault()],
  ].forEach(([label, action]) => {
    const item = document.createElement('div');
    item.className = 'menu-dropdown-item';
    item.textContent = label;
    item.addEventListener('click', () => { action(); dd.remove(); });
    dd.appendChild(item);
  });

  document.body.appendChild(dd);
  setTimeout(() => document.addEventListener('click', () => dd.remove(), { once: true }), 0);
}

// ─── Panel icon SVGs ─────────────────────────────────────────────────────────
function _panelIcon(panelId) {
  switch(panelId) {
    case 'scene-hierarchy':
      return `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
        <rect x="1" y="1" width="5" height="14" rx="1"/>
        <rect x="8" y="1" width="7" height="14" rx="1" opacity=".4"/>
      </svg>`;
    case 'center-viewport':
      return `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
        <rect x="1" y="1" width="14" height="14" rx="1" opacity=".4"/>
        <rect x="4" y="4" width="8" height="8" rx="1"/>
      </svg>`;
    case 'properties':
      return `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
        <rect x="1" y="1" width="7" height="14" rx="1" opacity=".4"/>
        <rect x="10" y="1" width="5" height="14" rx="1"/>
      </svg>`;
    case 'assets-browser':
      return `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
        <rect x="1" y="1" width="14" height="7" rx="1" opacity=".4"/>
        <rect x="1" y="10" width="14" height="5" rx="1"/>
      </svg>`;
    default: return '□';
  }
}

// ─── Individual menu definitions ──────────────────────────────────────────────

function fileMenu() {
  return [
    { label: 'New Project',     action: () => NewProjectDialog.open() },
    { label: 'Open Project',    action: () => _openProjectDialog() },
    { label: 'Recent Projects', dynamicSubmenu: _recentProjectsSubmenu },
    { separator: true },
    { label: 'Save',            action: () => {} },
    { label: 'Save As...',      action: () => {} },
    { separator: true },
    { label: 'Exit',            action: () => {} },
  ];
}

function editMenu() {
  return [
    { label: 'Undo',  action: () => {} },
    { label: 'Redo',  action: () => {} },
    { separator: true },
    { label: 'Cut',   action: () => {} },
    { label: 'Copy',  action: () => {} },
    { label: 'Paste', action: () => {} },
  ];
}

function viewMenu() {
  return [
    { label: 'Zoom', submenu: [
      { label: 'Zoom In',           action: () => {} },
      { label: 'Zoom Out',          action: () => {} },
      { label: 'Reset Zoom',        action: () => {} },
      { separator: true },
      { label: 'Toggle Fullscreen', action: () => {} },
    ]},
    { separator: true },
    { label: 'UI Theme', dynamicSubmenu: _themeSubmenu },
    { separator: true },
    { label: 'Layout', submenu: layoutMenu() },
  ];
}

function layoutMenu() {
  return [
    { label: 'Toggle', dynamicSubmenu: _toggleSubmenu },
    { separator: true },
    // Load Layout submenu rebuilt on each hover so new saves appear immediately
    { label: 'Load Layout', dynamicSubmenu: _savedLayoutsSubmenu },
    {
      label: 'Save Layout...', action: async () => {
        const name = await cePrompt('Layout name:', 'My Layout');
        if (name) LayoutManager.saveLayout(name);
      }
    },
    { label: 'Reset to Default', action: () => LayoutManager.resetToDefault() },
  ];
}

function _toggleSubmenu() {
  return [
    { label: 'Left Panel',   action: () => LayoutManager.togglePanel('scene-hierarchy'), checked: LayoutManager.isPanelVisible('scene-hierarchy') },
    { label: 'Center Panel', action: () => LayoutManager.togglePanel('center-viewport'),  checked: LayoutManager.isPanelVisible('center-viewport')  },
    { label: 'Right Panel',  action: () => LayoutManager.togglePanel('properties'),      checked: LayoutManager.isPanelVisible('properties')        },
    { label: 'Bottom Panel', action: () => LayoutManager.togglePanel('assets-browser'),  checked: LayoutManager.isPanelVisible('assets-browser')    },
  ];
}

function _savedLayoutsSubmenu() {
  const saved = LayoutManager.listSavedLayouts();
  if (saved.length === 0) return [{ label: '(no saved layouts)', action: () => {} }];
  return saved.map(name => ({
    label: name,
    action: () => LayoutManager.loadLayout(name),
  }));
}

function _themeSubmenu() {
  const builtins = ['Dark Coffee', 'Light Cream', 'Midnight Blue', 'Forest Green'];
  const userPresets = ThemeManager.listUserPresets();
  const items = builtins.map(name => ({
    label: name,
    action: () => ThemeManager.applyPreset(name),
  }));
  if (userPresets.length > 0) {
    items.push({ separator: true });
    // User presets get a ×→✓ delete button
    userPresets.forEach(name => items.push({
      label: name,
      action: () => ThemeManager.applyPreset(name),
      deleteAction: () => ThemeManager.deletePreset(name),
    }));
  }
  items.push({ separator: true });
  items.push({ label: 'Customize...', action: () => ThemeDialog.open() });
  items.push({
    label: 'Save Theme', action: () => {
      const activeName = localStorage.getItem('cyco-theme-active') || 'Dark Coffee';
      ThemeManager.savePreset(activeName, ThemeManager.getCurrent());
    }
  });
  items.push({
    label: 'Save Theme As...', action: async () => {
      const name = await cePrompt('Theme name:', 'My Theme');
      if (name) ThemeManager.savePreset(name, ThemeManager.getCurrent());
    }
  });
  return items;
}

function windowMenu() {
  return [
    { label: 'Minimize', action: () => {} },
  ];
}

function helpMenu() {
  return [
    { label: 'Documentation', action: () => {} },
    { label: 'About Cyco Engine', action: () => {} },
  ];
}

// ─── Open Project dialog ──────────────────────────────────────────────────────

function _openProjectDialog() {
  const recents = ProjectManager.getRecentProjects();
  if (recents.length === 0) {
    // No saved projects — go straight to New Project
    NewProjectDialog.open();
    return;
  }

  const existing = document.getElementById('ce-open-project-dlg');
  if (existing) { existing.close(); existing.remove(); }

  const dlg = document.createElement('dialog');
  dlg.id = 'ce-open-project-dlg';
  dlg.className = 'ce-new-project-dialog';

  const listHtml = recents.map((r, i) =>
    `<div class="ce-op-item" data-idx="${i}">
       <span class="ce-op-name">${_esc(r.name)}</span>
       <span class="ce-op-path">${_esc(r.path || '')}</span>
     </div>`
  ).join('');

  dlg.innerHTML = `
    <div class="ce-np-title">Open Project</div>
    <div class="ce-op-list">${listHtml || '<div class="ce-op-empty">No saved projects found.</div>'}</div>
    <div class="ce-np-actions">
      <button class="ce-btn ghost" id="ce-op-cancel">Cancel</button>
      <button class="ce-btn" id="ce-op-new">New Project…</button>
    </div>
  `;

  document.body.appendChild(dlg);

  dlg.querySelectorAll('.ce-op-item').forEach((item) => {
    const idx = parseInt(item.dataset.idx);
    item.addEventListener('click', () => {
      dlg.close(); dlg.remove();
      ProjectManager.openById(recents[idx].id);
    });
  });

  dlg.querySelector('#ce-op-cancel').addEventListener('click', () => {
    dlg.close(); dlg.remove();
  });
  dlg.querySelector('#ce-op-new').addEventListener('click', () => {
    dlg.close(); dlg.remove();
    NewProjectDialog.open();
  });
  dlg.addEventListener('keydown', e => {
    if (e.key === 'Escape') { dlg.close(); dlg.remove(); }
  });

  dlg.showModal();
}

function _recentProjectsSubmenu() {
  const recents = ProjectManager.getRecentProjects();
  if (recents.length === 0) {
    return [{ label: '(no recent projects)', action: () => {} }];
  }
  const items = recents.map(r => ({
    label: r.name,
    action: () => ProjectManager.openById(r.id),
  }));
  items.push({ separator: true });
  items.push({ label: 'Clear Recent…', action: () => ProjectManager.clearRecents() });
  return items;
}

function _esc(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}
