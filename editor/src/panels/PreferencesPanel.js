/**
 * PreferencesPanel.js — Preferences floating/dockable panel.
 * Opened by: Edit → Preferences, or cyco-open-preferences event.
 * Extends BasePanel so it floats freely, is draggable, and can dock into the layout.
 *
 * Tabs:
 *  1. Keyboard  — rebind editor shortcuts
 *  2. Mouse     — left/right/middle/wheel actions
 *  3. Gizmo     — size, axis colors
 *  4. Grid      — reuses GridProperties component
 *  5. Renderer  — startup renderer, shadow map, pixel ratio
 *  6. General   — auto-save, welcome screen
 */

import { BasePanel } from './BasePanel.js';
import { loadPrefs, savePrefs, saveDefaultPrefs, DEFAULT_PREFS, DEFAULT_KEYS } from '../ui/PreferencesWindow.js';
import { GridProperties } from '../properties/GridProperties.js';
import { select, slider, colorSwatch, row } from '../properties/propUtils.js';

export class PreferencesPanel extends BasePanel {
  constructor() {
    super();
    this._prefs       = null;
    this._activeTab   = 'keybindings';
    this._tabBtns     = {};
    this._gizmoActiveTab = 'move';
    this._gizmoTabBtns   = {};
    this._colliderActiveTab = 'colliderBox';
    this._colliderTabBtns   = {};
    this._outlineActiveTab = 'firstSelected';
    this._outlineTabBtns   = {};
    this._gridProps   = null;
    this._contentArea = null;
    this._committed   = false;
  }

  _clonePrefs(value) {
    if (typeof structuredClone === 'function') {
      try { return structuredClone(value); } catch (_) {}
    }
    return JSON.parse(JSON.stringify(value));
  }

  _applyPrefsChange({ makeDefault = false } = {}) {
    // ── DEBUG: outline-control change tracking ──────────────────────────────
    // Logs every outline-related preference change so we can see exactly
    // what the user picked vs what the pipeline receives.
    if (window.CYCO_DEBUG_OUTLINE) {
      const g = this._prefs?.gizmo ?? {};
      console.log('[CYCO:OUTLINE-PREFS] cyco-preferences-preview dispatched', {
        singleSelect: { ...(g.singleSelect ?? {}) },
        firstSelected: { ...(g.firstSelected ?? {}) },
        multiSelect:   { ...(g.multiSelect   ?? {}) },
        bounds:        { ...(g.bounds ?? {}) },
      });
    }
    window.dispatchEvent(new CustomEvent('cyco-preferences-preview', { detail: { prefs: this._prefs } }));
    if (makeDefault) {
      savePrefs(this._prefs);
      saveDefaultPrefs(this._prefs);
      this._committed = true;
    }
  }

  _getDefaultPrefsForTab(tabId) {
    switch (tabId) {
      case 'keybindings':
        return { keybindings: this._clonePrefs(DEFAULT_KEYS) };
      case 'mouse':
        return { mouse: this._clonePrefs(DEFAULT_PREFS.mouse) };
      case 'gizmo':
        return { gizmo: this._clonePrefs(DEFAULT_PREFS.gizmo) };
      case 'renderer':
        return { renderer: this._clonePrefs(DEFAULT_PREFS.renderer) };
      case 'general':
        return { general: this._clonePrefs(DEFAULT_PREFS.general) };
      default:
        return {};
    }
  }

  _resetActiveTabDraft() {
    if (this._activeTab === 'grid') {
      this._gridProps?.resetToDefaults?.();
      return;
    }

    const defaults = this._getDefaultPrefsForTab(this._activeTab);
    if (defaults.keybindings) this._prefs.keybindings = defaults.keybindings;
    if (defaults.mouse) this._prefs.mouse = defaults.mouse;
    if (defaults.gizmo) this._prefs.gizmo = defaults.gizmo;
    if (defaults.renderer) this._prefs.renderer = defaults.renderer;
    if (defaults.general) this._prefs.general = defaults.general;
    this._applyPrefsChange();
    this._switchTab(this._activeTab);
  }

  _commitDraftPrefs({ makeDefault = false } = {}) {
    if (this._gridProps?.commit) this._gridProps.commit();
    this._committed = true;
    savePrefs(this._prefs);
    if (makeDefault) saveDefaultPrefs(this._prefs);
  }

  // ── Float dimensions ─────────────────────────────────────────────────────────

  get _floatDimensions() {
    return { width: 680, height: 490 };
  }

  /** Override: allow free resize — only apply minimum constraints, not a fixed size lock. */
  _fixFloatingSize() {
    if (!this._floating) return;
    const container = this._findFloatingContainer();
    if (!container) return;
    const groupApi = this._panelApi?.group?.api;
    if (groupApi) {
      try {
        groupApi.setConstraints({ minimumWidth: 400, minimumHeight: 320 });
      } catch (_) {}
    }
    super._fixFloatingSize();
  }

  // ── Content ──────────────────────────────────────────────────────────────────

  _buildContent() {
    this._prefs = loadPrefs();
    this._committed = false;

    const root = document.createElement('div');
    root.style.cssText = 'height:100%;display:flex;flex-direction:column;overflow:hidden;';

    // ── Body: sidebar + content area ─────────────────────────────────────────
    const body = document.createElement('div');
    body.style.cssText = 'display:flex;flex:1;overflow:hidden;';

    const sidebar = document.createElement('div');
    sidebar.style.cssText = 'width:146px;flex-shrink:0;border-right:1px solid var(--ce-border,#3d3028);overflow-y:auto;padding:8px 0;background:var(--ce-bg-panel);';

    this._contentArea = document.createElement('div');
    this._contentArea.style.cssText = 'flex:1;overflow-y:auto;padding:16px;';

    const TABS = [
      { id: 'keybindings', label: 'Keyboard' },
      { id: 'mouse',       label: 'Mouse' },
      { id: 'gizmo',       label: 'Gizmo' },
      { id: 'grid',        label: 'Grid' },
      { id: 'renderer',    label: 'Renderer' },
      { id: 'general',     label: 'General' },
    ];

    this._tabBtns = {};
    for (const tab of TABS) {
      const btn = document.createElement('button');
      btn.textContent = tab.label;
      btn.dataset.tabId = tab.id;
      btn.style.cssText = 'width:100%;background:var(--ce-bg-surface,#332a22);border:1px solid var(--ce-border,#3d3028);text-align:left;padding:8px 12px;margin:4px 8px;border-radius:6px;cursor:pointer;font-size:13px;color:var(--ce-accent-orange,#e07228);font-weight:600;letter-spacing:0;';
      btn.addEventListener('click', () => this._switchTab(tab.id));
      sidebar.appendChild(btn);
      this._tabBtns[tab.id] = btn;
    }

    body.appendChild(sidebar);
    body.appendChild(this._contentArea);
    root.appendChild(body);

    // ── Footer ────────────────────────────────────────────────────────────────
    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:8px;padding:10px 16px;border-top:1px solid var(--ce-border,#3d3028);flex-shrink:0;background:var(--ce-bg-panel);';

    const leftGroup = document.createElement('div');
    leftGroup.style.cssText = 'display:flex;gap:8px;';

    const resetBtn = document.createElement('button');
    resetBtn.textContent = 'Reset';
    resetBtn.style.cssText = 'background:var(--ce-bg-surface,#332a22);border:1px solid var(--ce-border,#3d3028);color:var(--ce-accent-orange,#e07228);padding:4px 14px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;';
    resetBtn.addEventListener('click', () => this._resetActiveTabDraft());

    const makeDefaultBtn = document.createElement('button');
    makeDefaultBtn.textContent = 'Make Default';
    makeDefaultBtn.style.cssText = 'background:var(--ce-bg-surface,#332a22);border:1px solid var(--ce-border,#3d3028);color:var(--ce-accent-orange,#e07228);padding:4px 14px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:600;';
    makeDefaultBtn.addEventListener('click', () => {
      this._commitDraftPrefs({ makeDefault: true });
      alert('Current preferences have been saved as your default settings.');
    });

    leftGroup.appendChild(resetBtn);
    leftGroup.appendChild(makeDefaultBtn);

    const rightGroup = document.createElement('div');
    rightGroup.style.cssText = 'display:flex;gap:8px;';

    const doneBtn = document.createElement('button');
    doneBtn.textContent = 'Do It';
    doneBtn.style.cssText = 'background:var(--ce-accent-orange,#e07228);border:1px solid rgba(224,114,40,0.55);color:#fff;padding:4px 14px;border-radius:4px;cursor:pointer;font-size:12px;font-weight:700;';
    doneBtn.addEventListener('click', () => {
      this._commitDraftPrefs();
      try { this._panelApi.close(); } catch (_) {} 
    });

    rightGroup.appendChild(doneBtn);
    footer.appendChild(leftGroup);
    footer.appendChild(rightGroup);
    root.appendChild(footer);

    // Show first tab
    this._switchTab(this._activeTab);

    return root;
  }

  // ── Tab switching ────────────────────────────────────────────────────────────

  _switchTab(tabId) {
    this._activeTab = tabId;
    for (const [id, btn] of Object.entries(this._tabBtns)) {
      const active = id === tabId;
      btn.style.color           = 'var(--ce-accent-orange,#e07228)';
      btn.style.opacity         = active ? '1' : '0.8';
      btn.style.borderLeftColor = active ? 'rgba(224,114,40,0.55)' : 'transparent';
      btn.style.background      = active ? 'rgba(224,114,40,0.14)' : 'var(--ce-bg-surface,#332a22)';
    }
    if (this._contentArea) this._contentArea.innerHTML = '';
    
    switch (tabId) {
      case 'keybindings': this._contentArea.appendChild(this._buildKeybindingsTab()); break;
      case 'mouse':       this._contentArea.appendChild(this._buildMouseTab());       break;
      case 'gizmo':       this._contentArea.appendChild(this._buildGizmoTab());       break;
      case 'grid':        this._buildGridTab(this._contentArea);                      break;
      case 'renderer':    this._contentArea.appendChild(this._buildRendererTab());    break;
      case 'general':     this._contentArea.appendChild(this._buildGeneralTab());     break;
    }
  }

  // ── Keybindings tab ──────────────────────────────────────────────────────────

  _buildKeybindingsTab() {
    const root = document.createElement('div');

    const hdr = document.createElement('h3');
    hdr.textContent = 'Keyboard Shortcuts';
    hdr.style.cssText = 'margin:0 0 12px;font-size:13px;color:var(--text-secondary,#aaa);font-weight:600;';
    root.appendChild(hdr);

    const table = document.createElement('table');
    table.style.cssText = 'width:100%;border-collapse:collapse;font-size:12px;';

    const thead = table.createTHead();
    const headRow = thead.insertRow();
    for (const t of ['Action', 'Key Binding']) {
      const th = document.createElement('th');
      th.textContent = t;
      th.style.cssText = 'text-align:left;padding:4px 8px;color:var(--ce-accent-orange,#e07228);border-bottom:1px solid var(--ce-border,#3d3028);';
      headRow.appendChild(th);
    }

    const tbody = table.createTBody();
    const kb = this._prefs.keybindings;

    for (const [action, defaultKey] of Object.entries(DEFAULT_KEYS)) {
      const tr = tbody.insertRow();
      tr.style.cssText = 'border-bottom:1px solid var(--ce-border,#3d3028);';

      const tdAction = tr.insertCell();
      tdAction.textContent = action;
      tdAction.style.cssText = 'padding:6px 8px;color:var(--ce-text-primary,#ede8e0);';

      const tdKey = tr.insertCell();
      tdKey.style.cssText = 'padding:4px 8px;';

      const keyBtn = document.createElement('button');
      keyBtn.textContent = kb[action] ?? defaultKey;
      keyBtn.style.cssText = 'background:var(--ce-bg-surface,#332a22);border:1px solid var(--ce-border,#3d3028);color:var(--ce-accent-orange,#e07228);border-radius:3px;padding:2px 10px;cursor:pointer;font-size:12px;min-width:80px;font-weight:600;';
      keyBtn.addEventListener('click', () => this._captureKey(keyBtn, action));
      tdKey.appendChild(keyBtn);

      const resetKeyBtn = document.createElement('button');
      resetKeyBtn.textContent = '↺';
      resetKeyBtn.title = 'Reset to default';
      resetKeyBtn.style.cssText = 'background:none;border:none;color:var(--ce-accent-orange,#e07228);cursor:pointer;margin-left:4px;font-size:13px;';
      resetKeyBtn.addEventListener('click', () => {
        this._prefs.keybindings[action] = defaultKey;
        keyBtn.textContent = defaultKey;
        this._applyPrefsChange();
      });
      tdKey.appendChild(resetKeyBtn);
    }

    root.appendChild(table);
    return root;
  }

  _captureKey(btn, action) {
    const original = btn.textContent;
    btn.textContent = 'Press a key…';
    btn.style.borderColor = 'var(--ce-accent-orange,#e07228)';
    const onKey = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const parts = [];
      if (e.ctrlKey)  parts.push('Ctrl');
      if (e.altKey)   parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');
      const key = e.key === ' ' ? 'Space' : e.key;
      if (!['Control','Alt','Shift','Meta'].includes(key)) parts.push(key);
      const binding = parts.join('+');
      btn.textContent = binding || original;
      btn.style.borderColor = '';
      this._prefs.keybindings[action] = binding;
      this._applyPrefsChange();
      document.removeEventListener('keydown', onKey, true);
    };
    document.addEventListener('keydown', onKey, true);
  }

  // ── Mouse tab ─────────────────────────────────────────────────────────────

  /** Action options for mouse buttons — values are matched against OrbitControls action ids or special editor verbs. */
  _mouseActionOptions(forWheel = false) {
    if (forWheel) {
      return [
        ['dolly', 'Dolly (Zoom)'],
        ['zoom',  'Zoom (Alternative)'],
        ['none',  'Disabled'],
      ];
    }
    return [
      ['select', 'Select / Marquee (default)'],
      ['orbit',  'Orbit Camera'],
      ['pan',    'Pan Camera'],
      ['dolly',  'Dolly / Zoom'],
      ['none',   'Disabled'],
    ];
  }

  _buildMouseTab() {
    const root = document.createElement('div');
    root.style.cssText = 'display:flex;flex-direction:column;gap:12px;';

    const hdr = document.createElement('div');
    hdr.innerHTML =
      '<h3 style="margin:0 0 4px;font-size:13px;color:var(--text-secondary,#aaa);font-weight:600;">Mouse</h3>' +
      '<div style="font-size:11px;color:var(--text-secondary,#888);line-height:1.4;">Choose what each mouse button and the scroll wheel do inside the viewport. Changes apply live — no restart needed.</div>';
    root.appendChild(hdr);

    // Make sure mouse prefs exist (older prefs may not have this block)
    if (!this._prefs.mouse) {
      this._prefs.mouse = this._clonePrefs(DEFAULT_PREFS.mouse);
    }

    const makeRow = (labelText, value, options, onChange, note = '') => {
      const sel = select({ options, value, onChange: (v) => { onChange(v); this._applyPrefsChange(); } });
      sel.style.minWidth = '220px';
      const wrap = this._makeSettingRow(labelText, sel, note);
      return wrap;
    };

    const mouse = this._prefs.mouse;

    root.appendChild(makeRow(
      'Left Button',
      mouse.leftButton,
      this._mouseActionOptions(false),
      (v) => { mouse.leftButton = v; },
      'Click an object to select it. Click empty space and drag for a marquee selection.'
    ));

    root.appendChild(makeRow(
      'Middle Button',
      mouse.middleButton,
      this._mouseActionOptions(false),
      (v) => { mouse.middleButton = v; }
    ));

    root.appendChild(makeRow(
      'Right Button',
      mouse.rightButton,
      this._mouseActionOptions(false),
      (v) => { mouse.rightButton = v; }
    ));

    root.appendChild(makeRow(
      'Scroll Wheel',
      mouse.wheel,
      this._mouseActionOptions(true),
      (v) => { mouse.wheel = v; },
      'Dolly is the standard three.js behaviour; Zoom is a finer alternative.'
    ));

    // Invert zoom direction
    const invertRow = document.createElement('div');
    invertRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;';
    const invertLbl = document.createElement('span');
    invertLbl.textContent = 'Invert Wheel Direction';
    invertLbl.style.cssText = 'font-size:12px;color:var(--ce-text-primary,#e0e0e0);';
    const invertCb = document.createElement('input');
    invertCb.type = 'checkbox';
    invertCb.checked = !!mouse.invertZoom;
    invertCb.style.cursor = 'pointer';
    invertCb.addEventListener('change', () => {
      mouse.invertZoom = invertCb.checked;
      this._applyPrefsChange();
    });
    invertRow.appendChild(invertLbl);
    invertRow.appendChild(invertCb);
    root.appendChild(invertRow);

    // Wheel speed slider
    root.appendChild(this._makeSliderRow(
      'Wheel Speed',
      mouse.wheelSpeed ?? 1,
      0.1, 4, 0.1,
      (v) => { mouse.wheelSpeed = v; },
      'Multiplier applied to the wheel zoom step.',
      1
    ));

    // Hint about how selection marquee works
    const hint = document.createElement('div');
    hint.style.cssText = 'margin-top:6px;padding:10px 12px;background:rgba(224,114,40,0.08);border:1px solid rgba(224,114,40,0.35);border-radius:6px;font-size:11px;color:var(--ce-text-primary,#ede8e0);line-height:1.45;';
    hint.innerHTML =
      '<strong>Tip:</strong> When <em>Left Button</em> is set to <em>Select / Marquee</em> (the default), ' +
      'clicking on an object selects it, and clicking on empty space lets you drag a selection rectangle to select multiple objects at once. ' +
      'Hold <kbd>Ctrl</kbd> / <kbd>Shift</kbd> while clicking to add or remove individual objects.';
    root.appendChild(hint);

    return root;
  }

  // ── Gizmo tab ────────────────────────────────────────────────────────────────

  _buildGizmoTab() {
    const root = document.createElement('div');
    root.style.cssText = 'display:flex;flex-direction:column;gap:12px;height:100%;';

    const hdr = document.createElement('div');
    hdr.innerHTML =
      '<h3 style="margin:0 0 4px;font-size:13px;color:var(--text-secondary,#aaa);font-weight:600;">Gizmo</h3>' +
      '<div style="font-size:11px;color:var(--text-secondary,#888);">Tune transform gizmos, the box tool, and the outline.</div>';
    root.appendChild(hdr);

    const tabBar = document.createElement('div');
    tabBar.style.cssText = 'display:flex;gap:6px;flex-wrap:nowrap;padding:0;background:transparent;border:none;overflow-x:auto;';
    this._gizmoTabBtns = {};
    const tabs = [
      { id: 'move', label: 'Move' },
      { id: 'scale', label: 'Scale' },
      { id: 'rotate', label: 'Rotate' },
      { id: 'box', label: 'Box Tool' },
      { id: 'bounds', label: 'Outline' },
      { id: 'collider', label: 'Collider' },
    ];
    for (const tab of tabs) {
      const btn = document.createElement('button');
      btn.textContent = tab.label;
      btn.style.cssText = 'background:var(--ce-bg-surface,#332a22);border:1px solid var(--ce-border,#3d3028);color:var(--ce-accent-orange,#e07228);padding:5px 10px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;';
      btn.addEventListener('click', () => this._switchGizmoSubTab(tab.id));
      tabBar.appendChild(btn);
      this._gizmoTabBtns[tab.id] = btn;
    }

    this._gizmoContentArea = document.createElement('div');
    this._gizmoContentArea.style.cssText = 'flex:1;overflow-y:auto;padding-right:4px;';

    root.appendChild(tabBar);
    root.appendChild(this._gizmoContentArea);
    this._switchGizmoSubTab(this._gizmoActiveTab);
    return root;
  }

  _switchGizmoSubTab(tabId) {
    this._gizmoActiveTab = tabId;
    for (const [id, btn] of Object.entries(this._gizmoTabBtns || {})) {
      const active = id === tabId;
      btn.style.color = 'var(--ce-accent-orange,#e07228)';
      btn.style.opacity = active ? '1' : '0.82';
      btn.style.background = active ? 'rgba(224,114,40,0.16)' : 'var(--ce-bg-surface,#332a22)';
      btn.style.borderColor = active ? 'rgba(224,114,40,0.55)' : 'var(--ce-border,#3d3028)';
    }
    if (!this._gizmoContentArea) return;
    this._gizmoContentArea.innerHTML = '';
    if (tabId === 'move') this._gizmoContentArea.appendChild(this._buildGizmoSubTab('move'));
    else if (tabId === 'scale') this._gizmoContentArea.appendChild(this._buildGizmoSubTab('scale'));
    else if (tabId === 'rotate') this._gizmoContentArea.appendChild(this._buildGizmoSubTab('rotate'));
    else if (tabId === 'box') this._gizmoContentArea.appendChild(this._buildBoxToolTab());
    else if (tabId === 'bounds') this._gizmoContentArea.appendChild(this._buildBoundingBoxTab());
    else if (tabId === 'collider') this._gizmoContentArea.appendChild(this._buildColliderTab());
  }

  _buildColliderTab() {
    const root = document.createElement('div');
    root.style.cssText = 'display:flex;flex-direction:column;gap:12px;height:100%;';

    const hdr = document.createElement('div');
    hdr.innerHTML =
      '<h3 style="margin:0 0 4px;font-size:13px;color:var(--text-secondary,#aaa);font-weight:600;">Collider</h3>' +
      '<div style="font-size:11px;color:var(--text-secondary,#888);">Tune collider editing, the collider outline, and the temporary outline.</div>';
    root.appendChild(hdr);

    const tabBar = document.createElement('div');
    tabBar.style.cssText = 'display:flex;gap:6px;flex-wrap:nowrap;padding:0;background:transparent;border:none;overflow-x:auto;';
    this._colliderTabBtns = {};
    const tabs = [
      { id: 'colliderBox', label: 'Collider' },
      { id: 'colliderBounds', label: 'Collider Outline' },
      { id: 'temporaryBounds', label: 'Temporary Outline' },
    ];
    for (const tab of tabs) {
      const btn = document.createElement('button');
      btn.textContent = tab.label;
      btn.style.cssText = 'background:var(--ce-bg-surface,#332a22);border:1px solid var(--ce-border,#3d3028);color:var(--ce-accent-orange,#e07228);padding:5px 10px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;';
      btn.addEventListener('click', () => this._switchColliderSubTab(tab.id));
      tabBar.appendChild(btn);
      this._colliderTabBtns[tab.id] = btn;
    }

    this._colliderContentArea = document.createElement('div');
    this._colliderContentArea.style.cssText = 'flex:1;overflow-y:auto;padding-right:4px;';

    root.appendChild(tabBar);
    root.appendChild(this._colliderContentArea);
    this._switchColliderSubTab(this._colliderActiveTab);
    return root;
  }

  _switchColliderSubTab(tabId) {
    this._colliderActiveTab = tabId;
    for (const [id, btn] of Object.entries(this._colliderTabBtns || {})) {
      const active = id === tabId;
      btn.style.color = 'var(--ce-accent-orange,#e07228)';
      btn.style.opacity = active ? '1' : '0.82';
      btn.style.background = active ? 'rgba(224,114,40,0.16)' : 'var(--ce-bg-surface,#332a22)';
      btn.style.borderColor = active ? 'rgba(224,114,40,0.55)' : 'var(--ce-border,#3d3028)';
    }
    if (!this._colliderContentArea) return;
    this._colliderContentArea.innerHTML = '';
    if (tabId === 'colliderBox') this._colliderContentArea.appendChild(this._buildBoxToolTab('colliderBox'));
    else if (tabId === 'colliderBounds') this._colliderContentArea.appendChild(this._buildBoundingBoxTab('colliderBounds'));
    else if (tabId === 'temporaryBounds') this._colliderContentArea.appendChild(this._buildBoundingBoxTab('temporaryBounds'));
  }

  _makeSettingRow(label, control, note = '') {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-bottom:10px;';
    const r = row(label, control);
    r.style.cssText = 'display:flex;align-items:center;gap:10px;margin:0;';
    const labelEl = r.querySelector('.ce-prop-row-label');
    if (labelEl) labelEl.style.cssText = 'flex:0 0 120px;font-size:12px;color:var(--text-primary,#e0e0e0);';
    const controlEl = r.lastElementChild;
    if (controlEl) controlEl.style.flex = '1';
    wrap.appendChild(r);
    if (note) {
      const helper = document.createElement('div');
      helper.textContent = note;
      helper.style.cssText = 'margin-top:4px;font-size:11px;color:var(--text-secondary,#888);line-height:1.3;';
      wrap.appendChild(helper);
    }
    return wrap;
  }

  _makeToggleRow(label, checked, onChange, leftLabel = 'Combined', rightLabel = 'Separate') {
    const btn = document.createElement('button');
    const render = () => {
      btn.textContent = checked ? `${leftLabel} · Locked` : `${rightLabel} · Unlocked`;
      btn.style.cssText = [
        'background:var(--ce-bg-surface,#332a22)',
        'border:1px solid var(--ce-border,#3d3028)',
        'color:var(--ce-accent-orange,#e07228)',
        'padding:6px 12px',
        'border-radius:999px',
        'cursor:pointer',
        'font-size:12px',
        'font-weight:600',
      ].join(';');
      btn.style.borderColor = checked ? 'rgba(224,114,40,0.55)' : 'var(--ce-border,#3d3028)';
      btn.style.background = checked ? 'rgba(224,114,40,0.16)' : 'var(--ce-bg-surface,#332a22)';
    };
    render();
    btn.addEventListener('click', () => {
      checked = !checked;
      render();
      onChange?.(checked);
    });
    return this._makeSettingRow(label, btn);
  }

  _makeColorRow(label, value, onChange) {
    const sw = colorSwatch({ color: value, onChange });
    sw.el.style.width = '38px';
    sw.el.style.height = '24px';
    return this._makeSettingRow(label, sw.el);
  }

  _makeSliderRow(label, value, min, max, step, onChange, note = '', defaultValue) {
    const sl = slider({ value, min, max, step, onChange, defaultValue });
    sl.el.style.width = '100%';
    return this._makeSettingRow(label, sl.el, note);
  }

  _buildGizmoSubTab(tabId) {
    const prefs = this._prefs.gizmo;
    const shared = !prefs.useSeparateGizmoSizes;
    const modeKey = tabId === 'move' ? 'translate' : tabId;
    const sizeValue = shared ? prefs.size : (prefs[`${modeKey}Size`] ?? prefs.size);
    const distanceValue = shared ? prefs.distance : (prefs[`${modeKey}Distance`] ?? prefs.distance);
    const xColor = shared ? prefs.axisColorX : (prefs[`${modeKey}AxisColorX`] ?? prefs.axisColorX);
    const yColor = shared ? prefs.axisColorY : (prefs[`${modeKey}AxisColorY`] ?? prefs.axisColorY);
    const zColor = shared ? prefs.axisColorZ : (prefs[`${modeKey}AxisColorZ`] ?? prefs.axisColorZ);
    const activeColor = shared
      ? (prefs.activeColor || '#ffd54a')
      : (prefs[`${modeKey}ActiveColor`] ?? (prefs.activeColor || '#ffd54a'));

    const root = document.createElement('div');
    root.style.cssText = 'display:flex;flex-direction:column;gap:10px;';

    const title = tabId === 'move' ? 'Move' : tabId.charAt(0).toUpperCase() + tabId.slice(1);
    const titleEl = document.createElement('div');
    titleEl.innerHTML = `<div style="font-size:13px;color:var(--text-primary,#e0e0e0);font-weight:600;margin-bottom:2px;">${title} Gizmo</div>` +
      `<div style="font-size:11px;color:var(--text-secondary,#888);">${shared ? 'Locked together with the other transform gizmos.' : 'Unlocked for per-gizmo tuning.'}</div>`;
    root.appendChild(titleEl);

    root.appendChild(this._makeToggleRow('Combined / Separate', shared, (isCombined) => {
      this._prefs.gizmo.useSeparateGizmoSizes = !isCombined;
      if (isCombined) {
        this._prefs.gizmo.translateSize = this._prefs.gizmo.size;
        this._prefs.gizmo.rotateSize = this._prefs.gizmo.size;
        this._prefs.gizmo.scaleSize = this._prefs.gizmo.size;
        this._prefs.gizmo.translateDistance = this._prefs.gizmo.distance;
        this._prefs.gizmo.rotateDistance = this._prefs.gizmo.distance;
        this._prefs.gizmo.scaleDistance = this._prefs.gizmo.distance;
        this._prefs.gizmo.translateAxisColorX = this._prefs.gizmo.axisColorX;
        this._prefs.gizmo.translateAxisColorY = this._prefs.gizmo.axisColorY;
        this._prefs.gizmo.translateAxisColorZ = this._prefs.gizmo.axisColorZ;
        this._prefs.gizmo.rotateAxisColorX = this._prefs.gizmo.axisColorX;
        this._prefs.gizmo.rotateAxisColorY = this._prefs.gizmo.axisColorY;
        this._prefs.gizmo.rotateAxisColorZ = this._prefs.gizmo.axisColorZ;
        this._prefs.gizmo.scaleAxisColorX = this._prefs.gizmo.axisColorX;
        this._prefs.gizmo.scaleAxisColorY = this._prefs.gizmo.axisColorY;
        this._prefs.gizmo.scaleAxisColorZ = this._prefs.gizmo.axisColorZ;
      }
      this._applyPrefsChange();
      this._switchGizmoSubTab(this._gizmoActiveTab);
    }, 'Combined', 'Separate'));

    root.appendChild(this._makeSliderRow('Thickness', sizeValue, 0.1, 3, 0.01, (v) => {
      if (shared) {
        this._prefs.gizmo.size = v;
        this._prefs.gizmo.translateSize = v;
        this._prefs.gizmo.rotateSize = v;
        this._prefs.gizmo.scaleSize = v;
      } else {
        this._prefs.gizmo[`${modeKey}Size`] = v;
      }
      this._applyPrefsChange();
    }, 'Controls handle thickness and visual weight.', shared ? DEFAULT_PREFS.gizmo.size : DEFAULT_PREFS.gizmo[`${modeKey}Size`]));

    root.appendChild(this._makeSliderRow('Distance', distanceValue, 0.05, 3, 0.01, (v) => {
      if (shared) {
        this._prefs.gizmo.distance = v;
        this._prefs.gizmo.translateDistance = v;
        this._prefs.gizmo.rotateDistance = v;
        this._prefs.gizmo.scaleDistance = v;
      } else {
        this._prefs.gizmo[`${modeKey}Distance`] = v;
      }
      this._applyPrefsChange();
    }, 'Moves the handles farther away from the object.', shared ? DEFAULT_PREFS.gizmo.distance : DEFAULT_PREFS.gizmo[`${modeKey}Distance`]));

    root.appendChild(this._makeColorRow('X Color', xColor, (c) => {
      if (shared) {
        this._prefs.gizmo.axisColorX = c;
        this._prefs.gizmo.translateAxisColorX = c;
        this._prefs.gizmo.rotateAxisColorX = c;
        this._prefs.gizmo.scaleAxisColorX = c;
      } else {
        this._prefs.gizmo[`${modeKey}AxisColorX`] = c;
      }
      this._applyPrefsChange();
    }));
    root.appendChild(this._makeColorRow('Y Color', yColor, (c) => {
      if (shared) {
        this._prefs.gizmo.axisColorY = c;
        this._prefs.gizmo.translateAxisColorY = c;
        this._prefs.gizmo.rotateAxisColorY = c;
        this._prefs.gizmo.scaleAxisColorY = c;
      } else {
        this._prefs.gizmo[`${modeKey}AxisColorY`] = c;
      }
      this._applyPrefsChange();
    }));
    root.appendChild(this._makeColorRow('Z Color', zColor, (c) => {
      if (shared) {
        this._prefs.gizmo.axisColorZ = c;
        this._prefs.gizmo.translateAxisColorZ = c;
        this._prefs.gizmo.rotateAxisColorZ = c;
        this._prefs.gizmo.scaleAxisColorZ = c;
      } else {
        this._prefs.gizmo[`${modeKey}AxisColorZ`] = c;
      }
      this._applyPrefsChange();
    }));
    root.appendChild(this._makeColorRow('Active', activeColor, (c) => {
      if (shared) {
        this._prefs.gizmo.activeColor = c;
        this._prefs.gizmo.translateActiveColor = c;
        this._prefs.gizmo.rotateActiveColor = c;
        this._prefs.gizmo.scaleActiveColor = c;
      } else {
        this._prefs.gizmo[`${modeKey}ActiveColor`] = c;
      }
      this._applyPrefsChange();
    }));

    return root;
  }

  _buildBoxToolTab(key = 'box') {
    const prefs = this._prefs.gizmo[key];
    const defaults = DEFAULT_PREFS.gizmo[key];
    const isCollider = key === 'colliderBox';
    const root = document.createElement('div');
    root.style.cssText = 'display:flex;flex-direction:column;gap:10px;';

    const titleEl = document.createElement('div');
    titleEl.innerHTML = `<div style="font-size:13px;color:var(--text-primary,#e0e0e0);font-weight:600;margin-bottom:2px;">${isCollider ? 'Collider Box Tool Gizmo' : 'Box Tool Gizmo'}</div>` +
      `<div style="font-size:11px;color:var(--text-secondary,#888);">${isCollider ? 'Controls the collider editing box gizmo only.' : 'Controls the custom selection box gizmo.'}</div>`;
    root.appendChild(titleEl);

    root.appendChild(this._makeToggleRow('Combined / Separate', !prefs.useSeparate, (isCombined) => {
      this._prefs.gizmo[key].useSeparate = !isCombined;
      this._applyPrefsChange();
      this._switchGizmoSubTab(this._gizmoActiveTab);
    }, 'Combined', 'Separate'));

    if (isCollider) {
      root.appendChild(this._makeSettingRow('Fit Scope', select({
        options: [
          ['smart', 'Smart'],
          ['selected', 'Selected Object'],
          ['hierarchy', 'Whole Hierarchy'],
        ],
        value: prefs.fitScope ?? defaults.fitScope ?? 'smart',
        onChange: (v) => {
          this._prefs.gizmo[key].fitScope = v;
          this._applyPrefsChange();
        },
      }), 'How collider Auto Fit decides whether to use the object itself or its descendants.'));
    }

    root.appendChild(this._makeSliderRow('Thickness', prefs.thickness, 0.05, 4, 0.01, (v) => {
      this._prefs.gizmo[key].thickness = v;
      this._applyPrefsChange();
    }, 'Changes the box handle thickness without moving the gizmo points.', defaults.thickness));

    root.appendChild(this._makeSliderRow('Distance', prefs.distance, 0.05, 4, 0.01, (v) => {
      this._prefs.gizmo[key].distance = v;
      this._applyPrefsChange();
    }, 'Pushes the box handles farther away from the object.', defaults.distance));

    root.appendChild(this._makeColorRow('X Color', prefs.axisColorX, (c) => {
      this._prefs.gizmo[key].axisColorX = c;
      this._applyPrefsChange();
    }));
    root.appendChild(this._makeColorRow('Y Color', prefs.axisColorY, (c) => {
      this._prefs.gizmo[key].axisColorY = c;
      this._applyPrefsChange();
    }));
    root.appendChild(this._makeColorRow('Z Color', prefs.axisColorZ, (c) => {
      this._prefs.gizmo[key].axisColorZ = c;
      this._applyPrefsChange();
    }));
    root.appendChild(this._makeColorRow('Corner Color', prefs.cornerColor, (c) => {
      this._prefs.gizmo[key].cornerColor = c;
      this._applyPrefsChange();
    }));

    return root;
  }

  _buildBoundingBoxTab(key = 'bounds') {
    // The regular 'bounds' selection outline is split into two sub-tabs:
    //   • Single Select — the primary (most-recently-selected) outline.
    //   • Multi Select  — every other selected object's outline.
    // Collider / temporary outlines stay on a single tab because they are
    // always single-object outlines.
    if (key === 'bounds') {
      return this._buildSelectionOutlineTab();
    }
    const prefs = this._prefs.gizmo[key];
    const defaults = DEFAULT_PREFS.gizmo[key];
    const isCollider = key === 'colliderBounds';
    const isTemporary = key === 'temporaryBounds';
    const root = document.createElement('div');
    root.style.cssText = 'display:flex;flex-direction:column;gap:10px;';

    const titleEl = document.createElement('div');
    titleEl.innerHTML = `<div style="font-size:13px;color:var(--text-primary,#e0e0e0);font-weight:600;margin-bottom:2px;">${isTemporary ? 'Temporary Outline' : (isCollider ? 'Collider Outline' : 'Outline')}</div>` +
      `<div style="font-size:11px;color:var(--text-secondary,#888);">${isTemporary ? 'Used in Edit Collider mode when the selected object does not yet have a collider.' : (isCollider ? 'Collider edit outline and glow. Does not affect object selection outlines.' : 'Selection outline and glow shared by all gizmos.')}</div>`;
    root.appendChild(titleEl);

    root.appendChild(this._makeSliderRow('Thickness', prefs.thickness, 0.05, 4, 0.01, (v) => {
      this._prefs.gizmo[key].thickness = v;
      this._applyPrefsChange();
    }, 'Controls the outline line thickness.', defaults.thickness));

    root.appendChild(this._makeSliderRow('Distance', prefs.distance, 0.05, 4, 0.01, (v) => {
      this._prefs.gizmo[key].distance = v;
      this._applyPrefsChange();
    }, 'Moves the outline frame away from the object.', defaults.distance));

    root.appendChild(this._makeColorRow('Outline Color', prefs.outlineColor, (c) => {
      this._prefs.gizmo[key].outlineColor = c;
      this._applyPrefsChange();
    }));

    root.appendChild(this._makeColorRow('Glow Color', prefs.glowColor, (c) => {
      this._prefs.gizmo[key].glowColor = c;
      this._applyPrefsChange();
    }));

    root.appendChild(this._makeSliderRow('Glow Intensity', prefs.glowIntensity, 0, 2, 0.01, (v) => {
      this._prefs.gizmo[key].glowIntensity = v;
      this._applyPrefsChange();
    }, 'No post-processing required.', defaults.glowIntensity));

    return root;
  }

  /**
   * Build the bounds (selection) outline tab with Single / Multi sub-tabs.
   *
   * Single Select controls the primary (most-recently-selected) outline —
   * its color, thickness, and glow intensity all map directly to the
   * scene-graph inverted-hull outline (and to the WebGL OutlinePass when
   * the WebGL pipeline is active).
   *
   * Multi Select controls every other selected object's outline — distinct
   * color, distinct thickness, distinct glow intensity.
   */
  _buildSelectionOutlineTab() {
    const root = document.createElement('div');
    root.style.cssText = 'display:flex;flex-direction:column;gap:10px;height:100%;';

    // Sub-tab bar.
    const tabBar = document.createElement('div');
    tabBar.style.cssText = 'display:flex;gap:6px;flex-wrap:nowrap;padding:0;background:transparent;border:none;overflow-x:auto;';
    this._outlineTabBtns = {};
    // Three independent control sets so the user can tune each scenario
    // separately without one bleeding into the other.
    const tabs = [
      { id: 'single',         label: 'Single Select' },
      { id: 'firstSelected',  label: 'First Selected' },
      { id: 'multi',          label: 'Multi Select' },
    ];
    for (const tab of tabs) {
      const btn = document.createElement('button');
      btn.textContent = tab.label;
      btn.style.cssText = 'background:var(--ce-bg-surface,#332a22);border:1px solid var(--ce-border,#3d3028);color:var(--ce-accent-orange,#e07228);padding:5px 10px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;';
      btn.addEventListener('click', () => this._switchOutlineSubTab(tab.id));
      tabBar.appendChild(btn);
      this._outlineTabBtns[tab.id] = btn;
    }

    this._outlineContentArea = document.createElement('div');
    this._outlineContentArea.style.cssText = 'flex:1;overflow-y:auto;padding-right:4px;';

    root.appendChild(tabBar);
    root.appendChild(this._outlineContentArea);
    this._switchOutlineSubTab(this._outlineActiveTab || 'single');
    return root;
  }

  _switchOutlineSubTab(tabId) {
    this._outlineActiveTab = tabId;
    for (const [id, btn] of Object.entries(this._outlineTabBtns || {})) {
      const active = id === tabId;
      btn.style.color = 'var(--ce-accent-orange,#e07228)';
      btn.style.opacity = active ? '1' : '0.82';
      btn.style.background = active ? 'rgba(224,114,40,0.16)' : 'var(--ce-bg-surface,#332a22)';
      btn.style.borderColor = active ? 'rgba(224,114,40,0.55)' : 'var(--ce-border,#3d3028)';
    }
    if (!this._outlineContentArea) return;
    this._outlineContentArea.innerHTML = '';
    if (tabId === 'single')         this._outlineContentArea.appendChild(this._buildSingleOutlineTab());
    else if (tabId === 'firstSelected') this._outlineContentArea.appendChild(this._buildFirstSelectedOutlineTab());
    else if (tabId === 'multi')          this._outlineContentArea.appendChild(this._buildMultiOutlineTab());
  }

  /** Ensure the three new prefs sections exist with defaults. Called on
   *  tab build so older prefs files automatically get the new sections. */
  _ensureOutlineSubPrefs() {
    const gizmo = this._prefs.gizmo;
    for (const key of ['singleSelect', 'firstSelected', 'multiSelect']) {
      if (!gizmo[key] || typeof gizmo[key] !== 'object') {
        gizmo[key] = JSON.parse(JSON.stringify(DEFAULT_PREFS.gizmo[key]));
      } else {
        // Merge any missing fields from defaults.
        for (const [k, v] of Object.entries(DEFAULT_PREFS.gizmo[key])) {
          if (gizmo[key][k] === undefined) gizmo[key][k] = v;
        }
      }
    }
  }

  /** Single-select controls — applied ONLY when exactly one object is selected. */
  _buildSingleOutlineTab() {
    this._ensureOutlineSubPrefs();
    const prefs = this._prefs.gizmo.singleSelect;
    const defaults = DEFAULT_PREFS.gizmo.singleSelect;
    const root = document.createElement('div');
    root.style.cssText = 'display:flex;flex-direction:column;gap:10px;';

    root.appendChild(this._makeSliderRow('Thickness', prefs.thickness, 0.05, 4, 0.01, (v) => {
      this._prefs.gizmo.singleSelect.thickness = v;
      this._applyPrefsChange();
    }, '', defaults.thickness));

    root.appendChild(this._makeSliderRow('Distance', prefs.distance, 0.05, 4, 0.01, (v) => {
      this._prefs.gizmo.singleSelect.distance = v;
      this._applyPrefsChange();
    }, '', defaults.distance));

    root.appendChild(this._makeColorRow('Outline Color', prefs.outlineColor, (c) => {
      this._prefs.gizmo.singleSelect.outlineColor = c;
      this._applyPrefsChange();
    }));

    root.appendChild(this._makeColorRow('Glow Color', prefs.glowColor, (c) => {
      this._prefs.gizmo.singleSelect.glowColor = c;
      this._applyPrefsChange();
    }));

    root.appendChild(this._makeSliderRow('Glow Intensity', prefs.glowIntensity, 0, 4, 0.01, (v) => {
      this._prefs.gizmo.singleSelect.glowIntensity = v;
      this._applyPrefsChange();
    }, '', defaults.glowIntensity));

    return root;
  }

  /** First-selected controls — applied to the FIRST object in a multi-select. */
  _buildFirstSelectedOutlineTab() {
    this._ensureOutlineSubPrefs();
    const prefs = this._prefs.gizmo.firstSelected;
    const defaults = DEFAULT_PREFS.gizmo.firstSelected;
    const root = document.createElement('div');
    root.style.cssText = 'display:flex;flex-direction:column;gap:10px;';

    root.appendChild(this._makeSliderRow('Thickness', prefs.thickness, 0.05, 4, 0.01, (v) => {
      this._prefs.gizmo.firstSelected.thickness = v;
      this._applyPrefsChange();
    }, '', defaults.thickness));

    root.appendChild(this._makeSliderRow('Distance', prefs.distance, 0.05, 4, 0.01, (v) => {
      this._prefs.gizmo.firstSelected.distance = v;
      this._applyPrefsChange();
    }, '', defaults.distance));

    root.appendChild(this._makeColorRow('Outline Color', prefs.outlineColor, (c) => {
      this._prefs.gizmo.firstSelected.outlineColor = c;
      this._applyPrefsChange();
    }));

    root.appendChild(this._makeColorRow('Glow Color', prefs.glowColor, (c) => {
      this._prefs.gizmo.firstSelected.glowColor = c;
      this._applyPrefsChange();
    }));

    root.appendChild(this._makeSliderRow('Glow Intensity', prefs.glowIntensity, 0, 4, 0.01, (v) => {
      this._prefs.gizmo.firstSelected.glowIntensity = v;
      this._applyPrefsChange();
    }, '', defaults.glowIntensity));

    return root;
  }

  /** Multi-select controls — applied to every other selected object. */
  _buildMultiOutlineTab() {
    this._ensureOutlineSubPrefs();
    const prefs = this._prefs.gizmo.multiSelect;
    const defaults = DEFAULT_PREFS.gizmo.multiSelect;
    const root = document.createElement('div');
    root.style.cssText = 'display:flex;flex-direction:column;gap:10px;';

    // Slider max 8 so multi-select outlines can be made visibly chunky.
    root.appendChild(this._makeSliderRow('Thickness', prefs.thickness, 0.05, 8, 0.01, (v) => {
      this._prefs.gizmo.multiSelect.thickness = v;
      this._applyPrefsChange();
    }, '', defaults.thickness));

    root.appendChild(this._makeSliderRow('Distance', prefs.distance, 0.05, 8, 0.01, (v) => {
      this._prefs.gizmo.multiSelect.distance = v;
      this._applyPrefsChange();
    }, '', defaults.distance));

    root.appendChild(this._makeColorRow('Outline Color', prefs.outlineColor, (c) => {
      this._prefs.gizmo.multiSelect.outlineColor = c;
      this._applyPrefsChange();
    }));

    root.appendChild(this._makeColorRow('Glow Color', prefs.glowColor, (c) => {
      this._prefs.gizmo.multiSelect.glowColor = c;
      this._applyPrefsChange();
    }));

    root.appendChild(this._makeSliderRow('Glow Intensity', prefs.glowIntensity, 0, 4, 0.01, (v) => {
      this._prefs.gizmo.multiSelect.glowIntensity = v;
      this._applyPrefsChange();
    }, '', defaults.glowIntensity));

    return root;
  }

  _buildGridTab(content) {
    if (!this._gridProps) this._gridProps = new GridProperties({ commit: false });
    content.appendChild(this._gridProps.element);
  }

  // ── Renderer defaults tab ────────────────────────────────────────────────────

  _buildRendererTab() {
    const root = document.createElement('div');

    const hdr = document.createElement('h3');
    hdr.textContent = 'Renderer Defaults';
    hdr.style.cssText = 'margin:0 0 12px;font-size:13px;color:var(--text-secondary,#aaa);font-weight:600;';
    root.appendChild(hdr);

    const rows = [
      {
        label: 'Default Renderer',
        el: select({
          options: [['webgl','WebGL'],['webgpu','WebGPU'],['svg','SVG'],['css3d','CSS3D'],['pathtracer','Path Tracer']],
          value: this._prefs.renderer.defaultType,
          onChange: (v) => { this._prefs.renderer.defaultType = v; this._applyPrefsChange(); },
        }),
      },
      {
        label: 'Shadow Map',
        el: select({
          options: [['PCFSoftShadowMap','PCF Soft'],['PCFShadowMap','PCF'],['BasicShadowMap','Basic'],['VSMShadowMap','VSM']],
          value: this._prefs.renderer.shadowMapType,
          onChange: (v) => { this._prefs.renderer.shadowMapType = v; this._applyPrefsChange(); },
        }),
      },
      {
        label: 'Pixel Ratio',
        el: select({
          options: [['1','1×'],['device','Device ('+window.devicePixelRatio+'×)'],['2','2×']],
          value: this._prefs.renderer.pixelRatio,
          onChange: (v) => { this._prefs.renderer.pixelRatio = v; this._applyPrefsChange(); },
        }),
      },
    ];

    for (const { label, el } of rows) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;';
      const lbl = document.createElement('span');
      lbl.textContent = label;
      lbl.style.cssText = 'font-size:12px;color:var(--text-primary,#e0e0e0);';
      row.appendChild(lbl);
      row.appendChild(el);
      root.appendChild(row);
    }

    return root;
  }

  // ── General tab ──────────────────────────────────────────────────────────────

  _buildGeneralTab() {
    const root = document.createElement('div');

    const hdr = document.createElement('h3');
    hdr.textContent = 'General';
    hdr.style.cssText = 'margin:0 0 12px;font-size:13px;color:var(--text-secondary,#aaa);font-weight:600;';
    root.appendChild(hdr);

    // Auto-save interval
    const asRow = document.createElement('div');
    asRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;';
    const asLabel = document.createElement('span');
    asLabel.textContent = 'Auto-save Interval';
    asLabel.style.cssText = 'font-size:12px;color:var(--text-primary,#e0e0e0);';
    const asSelect = select({
      options: [['off','Off'],['1','1 minute'],['5','5 minutes'],['10','10 minutes']],
      value: this._prefs.general.autoSaveInterval,
      onChange: (v) => { this._prefs.general.autoSaveInterval = v; this._applyPrefsChange(); },
    });
    asRow.appendChild(asLabel);
    asRow.appendChild(asSelect);
    root.appendChild(asRow);

    // Welcome screen
    const wsRow = document.createElement('div');
    wsRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;';
    const wsLabel = document.createElement('span');
    wsLabel.textContent = 'Show Welcome Screen';
    wsLabel.style.cssText = 'font-size:12px;color:var(--text-primary,#e0e0e0);';
    const wsCb = document.createElement('input');
    wsCb.type    = 'checkbox';
    wsCb.checked = this._prefs.general.showWelcomeScreen;
    wsCb.style.cursor = 'pointer';
    wsCb.addEventListener('change', () => {
      this._prefs.general.showWelcomeScreen = wsCb.checked;
      this._applyPrefsChange();
    });
    wsRow.appendChild(wsLabel);
    wsRow.appendChild(wsCb);
    root.appendChild(wsRow);

    return root;
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  dispose() {
    if (this._gridProps) { this._gridProps.dispose?.(); this._gridProps = null; }
    if (!this._committed) {
      window.dispatchEvent(new CustomEvent('cyco-preferences-preview', { detail: { prefs: loadPrefs() } }));
    }
    super.dispose?.();
  }
}





