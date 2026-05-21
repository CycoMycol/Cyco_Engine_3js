/** CenterPanel.js — Viewport panel with left tool sidebar and top bar */

import { BasePanel } from './BasePanel.js';

// ── Data ──────────────────────────────────────────────────────────────────────

const RENDER_MODES = [
  { value: 'wireframe',   label: 'Wireframe'    },
  { value: 'standard',    label: 'Standard'     },
  { value: 'albedo',      label: 'Albedo'       },
  { value: 'opacity',     label: 'Opacity'      },
  { value: 'worldnormal', label: 'World Normal' },
  { value: 'specularity', label: 'Specularity'  },
  { value: 'gloss',       label: 'Gloss'        },
  { value: 'metalness',   label: 'Metalness'    },
  { value: 'ao',          label: 'AO'           },
  { value: 'emission',    label: 'Emission'     },
  { value: 'lighting',    label: 'Lighting'     },
];

const CAMERA_VIEWS = [
  { value: 'perspective', label: 'Perspective' },
  { value: 'top',         label: 'Top'         },
  { value: 'bottom',      label: 'Bottom'      },
  { value: 'front',       label: 'Front'       },
  { value: 'back',        label: 'Back'        },
  { value: 'left',        label: 'Left'        },
  { value: 'right',       label: 'Right'       },
  { value: 'camera',      label: 'Camera'      },
];

// ── Panel class ───────────────────────────────────────────────────────────────

export class CenterPanel extends BasePanel {
  constructor() {
    super();
    this._renderMode  = 'standard';
    this._cameraView  = 'perspective';
    this._physicsEdit = false;
    this._renderHandle = null;
    this._cameraHandle = null;
    this._vpSizeBtn    = null;
    this._vpFloatBtn   = null;  // float button in the topbar
    this._tabSnapBtn   = null;  // snap-back button injected into the dockview tab
  }

  _buildContent() {
    const root = document.createElement('div');
    root.className = 'ce-viewport-root';

    // Top bar with three dropdown menus
    this._topBar = this._buildTopBar();
    root.appendChild(this._topBar);

    // Body: left toolbar + viewport canvas
    const body = document.createElement('div');
    body.className = 'ce-viewport-body';
    const vp = document.createElement('div');
    vp.className = 'ce-viewport-canvas';
    const lbl = document.createElement('div');
    lbl.className = 'ce-panel-label';
    lbl.textContent = 'Viewport';
    vp.appendChild(lbl);
    body.appendChild(vp);

    root.appendChild(body);

    // Close all dropdowns on outside click
    this._outsideHandler = (e) => {
      if (this._topBar && !this._topBar.contains(e.target)) {
        this._closeAllDropdowns();
      }
    };
    document.addEventListener('click', this._outsideHandler);

    return root;
  }

  // ── Top bar ─────────────────────────────────────────────────────────────────

  _buildTopBar() {
    const bar = document.createElement('div');
    bar.className = 'ce-vp-topbar';

    // Render mode button
    this._renderHandle = this._makeDropdownBtn(
      bar, _renderIcon(),
      () => RENDER_MODES.find(m => m.value === this._renderMode)?.label || 'Standard',
      () => this._buildRenderDropdown(),
    );

    bar.appendChild(_vpSep());

    // Camera view button
    this._cameraHandle = this._makeDropdownBtn(
      bar, _cameraIcon(),
      () => CAMERA_VIEWS.find(v => v.value === this._cameraView)?.label || 'Perspective',
      () => this._buildCameraDropdown(),
    );

    // ── Right-side panel actions ──────────────────────────────────────────
    const spacer = document.createElement('div');
    spacer.style.flex = '1';
    bar.appendChild(spacer);

    // Float
    const floatBtn = document.createElement('button');
    floatBtn.className = 'ce-vp-action-btn';
    this._vpFloatBtn = floatBtn;
    this._updateFloatBtn(floatBtn);
    floatBtn.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      this._startPanelDrag(e, floatBtn);
    });
    floatBtn.addEventListener('click', (e) => e.stopPropagation());
    bar.appendChild(floatBtn);

    // Size toggle
    this._vpSizeBtn = document.createElement('button');
    this._vpSizeBtn.className = 'ce-vp-action-btn';
    this._updateSizeBtn(this._vpSizeBtn);
    this._vpSizeBtn.addEventListener('click', () => this._cycleSizeState(this._vpSizeBtn));
    bar.appendChild(this._vpSizeBtn);

    // Close
    const closeBtn = document.createElement('button');
    closeBtn.className = 'ce-vp-action-btn ce-vp-close-btn';
    closeBtn.title = 'Close panel';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => { try { this._panelApi.close(); } catch(_) {} });
    bar.appendChild(closeBtn);

    return bar;
  }

  // Override base: hide the dockview tab row instead of populating it
  _addHeaderActions(api) {
    requestAnimationFrame(() => {
      const groupview = this._findGroupView();
      if (!groupview) return;
      const tabBar = groupview.querySelector('.dv-tabs-and-actions-container');
      if (tabBar) tabBar.style.display = 'none';
    });
  }

  // Walk up the DOM to find the dockview group container
  _findGroupView() {
    let el = this._el;
    while (el && el !== document.body) {
      if (el.classList && el.classList.contains('dv-groupview')) return el;
      el = el.parentElement;
    }
    return null;
  }

  // Override: also call _attachTabSnapBackBtn when floating via drag (_floatAtPosition)
  _floatAtPosition(clientX, clientY) {
    super._floatAtPosition(clientX, clientY);
    if (this._floating) {
      requestAnimationFrame(() => this._attachTabSnapBackBtn(this._vpFloatBtn));
    }
  }

  // Override: when floating via toggle button, move the snap-back button to the dockview tab strip
  _toggleFloat(btn) {
    if (!this._floating) {
      // Going to float — call super first
      super._toggleFloat(btn);
      if (this._floating) {
        // Success: defer so dockview finishes moving the panel to the floating group
        requestAnimationFrame(() => this._attachTabSnapBackBtn(btn));
      }
    } else {
      // Snapping back — clean up tab button reference, then call super
      this._tabSnapBtn = null;
      super._toggleFloat(btn);
    }
  }

  // Show the dockview tab strip on the floating group and inject a snap-back button
  _attachTabSnapBackBtn(vpFloatBtn) {
    // Hide the float button from the topbar while floating
    if (vpFloatBtn) vpFloatBtn.style.display = 'none';

    const groupview = this._findGroupView();
    if (!groupview) return;
    const tabBar = groupview.querySelector('.dv-tabs-and-actions-container');
    if (!tabBar) return;

    // Reveal the dockview tab strip so the Viewport tab + × are visible
    tabBar.style.display = '';

    // Add a snap-back button to the tab, next to the close ×
    const tab = tabBar.querySelector('.dv-default-tab');
    if (!tab) return;

    const snapBtn = document.createElement('button');
    snapBtn.className = 'ce-panel-action ce-vp-tab-snapback';
    this._updateFloatBtn(snapBtn); // sets SNAPBACK_SVG icon since this._floating is true
    snapBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._toggleFloat(vpFloatBtn);
    });
    tab.appendChild(snapBtn);
    this._tabSnapBtn = snapBtn;
  }

  _makeDropdownBtn(bar, iconSvg, getLabel, buildItems) {
    const wrap = document.createElement('div');
    wrap.className = 'ce-vp-dd-wrap';

    const btn = document.createElement('button');
    btn.className = 'ce-vp-dd-btn';

    const iconEl = document.createElement('span');
    iconEl.className = 'ce-vp-dd-icon';
    iconEl.innerHTML = iconSvg;

    const labelEl = document.createElement('span');
    labelEl.className = 'ce-vp-dd-label';
    labelEl.textContent = getLabel();

    const arrow = document.createElement('span');
    arrow.className = 'ce-vp-dd-arrow';
    arrow.textContent = '▾';

    btn.appendChild(iconEl);
    btn.appendChild(labelEl);
    btn.appendChild(arrow);
    wrap.appendChild(btn);

    const dd = document.createElement('div');
    dd.className = 'ce-vp-dropdown';
    wrap.appendChild(dd);
    bar.appendChild(wrap);

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const wasOpen = wrap.classList.contains('open');
      this._closeAllDropdowns();
      if (!wasOpen) {
        dd.innerHTML = '';
        buildItems().forEach(el => dd.appendChild(el));
        wrap.classList.add('open');
      }
    });

    return { wrap, labelEl, refresh: () => { labelEl.textContent = getLabel(); } };
  }

  _closeAllDropdowns() {
    if (this._topBar) {
      this._topBar.querySelectorAll('.ce-vp-dd-wrap.open').forEach(w => w.classList.remove('open'));
    }
  }

  _buildRenderDropdown() {
    const items = [];
    RENDER_MODES.forEach((m, i) => {
      items.push(_ddRadioRow(m.label, m.value === this._renderMode, () => {
        this._renderMode = m.value;
        this._renderHandle.refresh();
      }));
      if (i === 0) items.push(_ddSep()); // separator after Wireframe
    });
    return items;
  }

  _buildCameraDropdown() {
    const items = [];
    items.push(_ddCheckRow('Physics Edit Mode', this._physicsEdit, (v) => {
      this._physicsEdit = v;
    }));
    items.push(_ddSep());
    CAMERA_VIEWS.forEach(v => {
      items.push(_ddRadioRow(v.label, v.value === this._cameraView, () => {
        this._cameraView = v.value;
        this._cameraHandle.refresh();
      }));
    });
    return items;
  }
}

// ── Dropdown row builders ─────────────────────────────────────────────────────

function _ddRadioRow(label, checked, onSelect) {
  const row = document.createElement('div');
  row.className = 'ce-vp-dd-row' + (checked ? ' selected' : '');
  const radio = document.createElement('span');
  radio.className = 'ce-vp-dd-radio' + (checked ? ' checked' : '');
  const lbl = document.createElement('span');
  lbl.textContent = label;
  row.appendChild(radio);
  row.appendChild(lbl);
  row.addEventListener('click', (e) => {
    e.stopPropagation();
    const dd = row.closest('.ce-vp-dropdown');
    if (dd) {
      dd.querySelectorAll('.ce-vp-dd-radio').forEach(r => r.classList.remove('checked'));
      dd.querySelectorAll('.ce-vp-dd-row').forEach(r => r.classList.remove('selected'));
    }
    radio.classList.add('checked');
    row.classList.add('selected');
    onSelect();
    row.closest('.ce-vp-dd-wrap')?.classList.remove('open');
  });
  return row;
}

function _ddCheckRow(label, checked, onChange) {
  const row = document.createElement('div');
  row.className = 'ce-vp-dd-row';
  const box = document.createElement('span');
  box.className = 'ce-vp-dd-check' + (checked ? ' checked' : '');
  const lbl = document.createElement('span');
  lbl.textContent = label;
  row.appendChild(box);
  row.appendChild(lbl);
  row.addEventListener('click', (e) => {
    e.stopPropagation();
    checked = !checked;
    box.classList.toggle('checked', checked);
    onChange(checked);
  });
  return row;
}

function _ddActionRow(label, action) {
  const row = document.createElement('div');
  row.className = 'ce-vp-dd-row ce-vp-dd-action';
  const lbl = document.createElement('span');
  lbl.textContent = label;
  row.appendChild(lbl);
  row.addEventListener('click', (e) => {
    e.stopPropagation();
    row.closest('.ce-vp-dd-wrap')?.classList.remove('open');
    action();
  });
  return row;
}

function _ddSep() {
  const s = document.createElement('div');
  s.className = 'ce-vp-dd-sep';
  return s;
}

// ── Misc helpers ──────────────────────────────────────────────────────────────

function _vpSep() {
  const s = document.createElement('div');
  s.className = 'ce-vp-topbar-sep';
  return s;
}

function _toolSep() {
  const s = document.createElement('div');
  s.className = 'ce-vp-tool-sep';
  return s;
}

function _toolBtn(svgHtml, tip, onClick) {
  const btn = document.createElement('button');
  btn.className = 'ce-vp-tool-btn';
  btn.title = tip;
  btn.innerHTML = svgHtml;
  btn.addEventListener('click', onClick);
  return btn;
}

// ── SVG Icons ─────────────────────────────────────────────────────────────────

function _toolIcon(id) {
  switch (id) {
    case 'translate': return `<svg viewBox="0 0 20 20" width="17" height="17" fill="currentColor">
      <path d="M10 1.5 L8 5H9.5V9.5H5V8L1.5 10 5 12V10.5H9.5V15H8L10 18.5 12 15H10.5V10.5H15V12L18.5 10 15 8V9.5H10.5V5H12Z"/>
    </svg>`;
    case 'rotate': return `<svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <path d="M15.5 6.5A7 7 0 1 0 17 10.5"/>
      <polyline points="13.5,3 17,6.5 13.5,8.5" fill="currentColor" stroke="none"/>
    </svg>`;
    case 'scale': return `<svg viewBox="0 0 20 20" width="17" height="17" fill="currentColor">
      <path d="M12.5 2.5H17.5V7.5L15.5 5.5 10.5 10.5 9.5 9.5 14.5 4.5Z"/>
      <path d="M7.5 17.5H2.5V12.5L4.5 14.5 9.5 9.5 10.5 10.5 5.5 15.5Z"/>
    </svg>`;
    case 'rect': return `<svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="3 2">
      <rect x="3.5" y="3.5" width="13" height="13" rx="1"/>
      <circle cx="3.5" cy="3.5" r="1.8" fill="currentColor" stroke="none"/>
      <circle cx="16.5" cy="3.5" r="1.8" fill="currentColor" stroke="none"/>
      <circle cx="3.5" cy="16.5" r="1.8" fill="currentColor" stroke="none"/>
      <circle cx="16.5" cy="16.5" r="1.8" fill="currentColor" stroke="none"/>
    </svg>`;
    case 'world': return `<svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.4">
      <circle cx="10" cy="10" r="7.5"/>
      <ellipse cx="10" cy="10" rx="3.8" ry="7.5"/>
      <line x1="2.5" y1="10" x2="17.5" y2="10"/>
      <line x1="3.2" y1="6.5" x2="16.8" y2="6.5"/>
      <line x1="3.2" y1="13.5" x2="16.8" y2="13.5"/>
    </svg>`;
    case 'local': return `<svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke-width="2" stroke-linecap="round">
      <line x1="10" y1="10" x2="17" y2="10" stroke="#e07228"/>
      <line x1="10" y1="10" x2="10" y2="3" stroke="#6ab26a"/>
      <line x1="10" y1="10" x2="4" y2="15" stroke="#4d93e8"/>
      <circle cx="10" cy="10" r="1.8" fill="currentColor" stroke="currentColor"/>
    </svg>`;
    case 'snap': return `<svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round">
      <path d="M5.5 3 L5.5 11 A4.5 4.5 0 0 0 14.5 11 L14.5 3"/>
    </svg>`;
    case 'focus': return `<svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
      <circle cx="10" cy="10" r="3"/>
      <line x1="10" y1="2" x2="10" y2="5"/>
      <line x1="10" y1="15" x2="10" y2="18"/>
      <line x1="2" y1="10" x2="5" y2="10"/>
      <line x1="15" y1="10" x2="18" y2="10"/>
    </svg>`;
    default: return '';
  }
}

function _renderIcon() {
  return `<svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
    <rect x="2" y="2" width="5" height="5" rx="0.5" opacity="0.4"/>
    <rect x="9" y="2" width="5" height="5" rx="0.5" opacity="0.4"/>
    <rect x="2" y="9" width="5" height="5" rx="0.5" opacity="0.4"/>
    <rect x="9" y="9" width="5" height="5" rx="0.5"/>
  </svg>`;
}

function _cameraIcon() {
  return `<svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
    <path d="M1 5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V5z"/>
    <path d="M11 7.2l3-1.7v5l-3-1.7V7.2z"/>
  </svg>`;
}
