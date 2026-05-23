/**
 * PreferencesPanel.js — Preferences floating/dockable panel.
 * Opened by: Edit → Preferences, or cyco-open-preferences event.
 * Extends BasePanel so it floats freely, is draggable, and can dock into the layout.
 *
 * Tabs:
 *  1. Keyboard  — rebind editor shortcuts
 *  2. Gizmo     — size, axis colors
 *  3. Grid      — reuses GridProperties component
 *  4. Renderer  — startup renderer, shadow map, pixel ratio
 *  5. General   — auto-save, welcome screen
 */

import { BasePanel } from './BasePanel.js';
import { loadPrefs, savePrefs, DEFAULT_PREFS, DEFAULT_KEYS } from '../ui/PreferencesWindow.js';
import { GridProperties } from '../properties/GridProperties.js';
import { select } from '../properties/propUtils.js';
import CeColorPicker from '../ui/CeColorPicker.js';

export class PreferencesPanel extends BasePanel {
  constructor() {
    super();
    this._prefs       = null;
    this._activeTab   = 'keybindings';
    this._tabBtns     = {};
    this._gridProps   = null;
    this._contentArea = null;
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
    const { width, height } = this._floatDimensions;
    const groupApi = this._panelApi?.group?.api;
    if (groupApi) {
      try {
        groupApi.setConstraints({ minimumWidth: 400, minimumHeight: 320 });
        groupApi.setSize({ width, height });
      } catch (_) {}
    }
    container.style.width  = width  + 'px';
    container.style.height = height + 'px';
    const rect = container.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      container.style.right  = 'auto';
      container.style.bottom = 'auto';
      container.style.left   = Math.max(0, window.innerWidth - width - 4) + 'px';
    }
  }

  // ── Content ──────────────────────────────────────────────────────────────────

  _buildContent() {
    this._prefs = loadPrefs();

    const root = document.createElement('div');
    root.style.cssText = 'height:100%;display:flex;flex-direction:column;overflow:hidden;';

    // ── Body: sidebar + content area ─────────────────────────────────────────
    const body = document.createElement('div');
    body.style.cssText = 'display:flex;flex:1;overflow:hidden;';

    const sidebar = document.createElement('div');
    sidebar.style.cssText = 'width:140px;flex-shrink:0;border-right:1px solid var(--border-color,#333);overflow-y:auto;padding:8px 0;';

    this._contentArea = document.createElement('div');
    this._contentArea.style.cssText = 'flex:1;overflow-y:auto;padding:16px;';

    const TABS = [
      { id: 'keybindings', label: 'Keyboard' },
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
      btn.style.cssText = 'width:100%;background:none;border:none;text-align:left;padding:8px 16px;cursor:pointer;font-size:13px;color:var(--text-secondary,#aaa);border-left:3px solid transparent;';
      btn.addEventListener('click', () => this._switchTab(tab.id));
      sidebar.appendChild(btn);
      this._tabBtns[tab.id] = btn;
    }

    body.appendChild(sidebar);
    body.appendChild(this._contentArea);
    root.appendChild(body);

    // ── Footer ────────────────────────────────────────────────────────────────
    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;padding:10px 16px;border-top:1px solid var(--border-color,#333);flex-shrink:0;';

    const resetBtn = document.createElement('button');
    resetBtn.textContent = 'Reset All';
    resetBtn.style.cssText = 'background:none;border:1px solid var(--border-color,#333);color:var(--text-secondary,#aaa);padding:4px 14px;border-radius:4px;cursor:pointer;font-size:12px;';
    resetBtn.addEventListener('click', () => {
      if (confirm('Reset all preferences to defaults?')) {
        this._prefs = JSON.parse(JSON.stringify(DEFAULT_PREFS));
        savePrefs(this._prefs);
        this._switchTab(this._activeTab);
      }
    });

    const doneBtn = document.createElement('button');
    doneBtn.textContent = 'Done';
    doneBtn.style.cssText = 'background:var(--accent-color,#4488ff);border:none;color:#fff;padding:4px 14px;border-radius:4px;cursor:pointer;font-size:12px;';
    doneBtn.addEventListener('click', () => {
      try { this._panelApi.close(); } catch (_) {}
    });

    footer.appendChild(resetBtn);
    footer.appendChild(doneBtn);
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
      btn.style.color           = active ? 'var(--text-primary,#e0e0e0)' : 'var(--text-secondary,#aaa)';
      btn.style.borderLeftColor = active ? 'var(--accent-color,#4488ff)' : 'transparent';
      btn.style.background      = active ? 'var(--bg-secondary,#252525)' : 'none';
    }
    if (this._contentArea) this._contentArea.innerHTML = '';
    if (this._gridProps && tabId !== 'grid') {
      this._gridProps.dispose?.();
      this._gridProps = null;
    }
    switch (tabId) {
      case 'keybindings': this._contentArea.appendChild(this._buildKeybindingsTab()); break;
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
      th.style.cssText = 'text-align:left;padding:4px 8px;color:var(--text-secondary,#888);border-bottom:1px solid var(--border-color,#333);';
      headRow.appendChild(th);
    }

    const tbody = table.createTBody();
    const kb = this._prefs.keybindings;

    for (const [action, defaultKey] of Object.entries(DEFAULT_KEYS)) {
      const tr = tbody.insertRow();
      tr.style.cssText = 'border-bottom:1px solid var(--border-color,#222);';

      const tdAction = tr.insertCell();
      tdAction.textContent = action;
      tdAction.style.cssText = 'padding:6px 8px;color:var(--text-primary,#e0e0e0);';

      const tdKey = tr.insertCell();
      tdKey.style.cssText = 'padding:4px 8px;';

      const keyBtn = document.createElement('button');
      keyBtn.textContent = kb[action] ?? defaultKey;
      keyBtn.style.cssText = 'background:var(--bg-secondary,#252525);border:1px solid var(--border-color,#333);color:var(--text-primary,#e0e0e0);border-radius:3px;padding:2px 10px;cursor:pointer;font-size:12px;min-width:80px;';
      keyBtn.addEventListener('click', () => this._captureKey(keyBtn, action));
      tdKey.appendChild(keyBtn);

      const resetKeyBtn = document.createElement('button');
      resetKeyBtn.textContent = '↺';
      resetKeyBtn.title = 'Reset to default';
      resetKeyBtn.style.cssText = 'background:none;border:none;color:var(--text-secondary,#666);cursor:pointer;margin-left:4px;font-size:13px;';
      resetKeyBtn.addEventListener('click', () => {
        this._prefs.keybindings[action] = defaultKey;
        keyBtn.textContent = defaultKey;
        savePrefs(this._prefs);
      });
      tdKey.appendChild(resetKeyBtn);
    }

    root.appendChild(table);
    return root;
  }

  _captureKey(btn, action) {
    const original = btn.textContent;
    btn.textContent = 'Press a key…';
    btn.style.borderColor = 'var(--accent-color,#4488ff)';
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
      savePrefs(this._prefs);
      document.removeEventListener('keydown', onKey, true);
    };
    document.addEventListener('keydown', onKey, true);
  }

  // ── Gizmo tab ────────────────────────────────────────────────────────────────

  _buildGizmoTab() {
    const root = document.createElement('div');

    const hdr = document.createElement('h3');
    hdr.textContent = 'Gizmo';
    hdr.style.cssText = 'margin:0 0 12px;font-size:13px;color:var(--text-secondary,#aaa);font-weight:600;';
    root.appendChild(hdr);

    // Size slider
    const sizeRow = document.createElement('div');
    sizeRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;';
    const sizeLabel = document.createElement('span');
    sizeLabel.textContent = 'Gizmo Size';
    sizeLabel.style.cssText = 'font-size:12px;color:var(--text-primary,#e0e0e0);';

    const sizeSlider = document.createElement('input');
    sizeSlider.type = 'range';
    sizeSlider.min  = '0.5';
    sizeSlider.max  = '3';
    sizeSlider.step = '0.1';
    sizeSlider.value = String(this._prefs.gizmo.size);

    const sizeVal = document.createElement('span');
    sizeVal.textContent = parseFloat(sizeSlider.value).toFixed(1);
    sizeVal.style.cssText = 'min-width:28px;text-align:right;font-size:11px;color:var(--text-secondary,#aaa);';

    sizeSlider.addEventListener('input', () => {
      sizeVal.textContent = parseFloat(sizeSlider.value).toFixed(1);
      this._prefs.gizmo.size = parseFloat(sizeSlider.value);
      const tc = window.__cyco?.transformGizmo?.controls;
      if (tc) tc.size = this._prefs.gizmo.size;
      savePrefs(this._prefs);
    });

    const sliderWrap = document.createElement('div');
    sliderWrap.style.cssText = 'display:flex;align-items:center;gap:6px;';
    sliderWrap.appendChild(sizeSlider);
    sliderWrap.appendChild(sizeVal);
    sizeRow.appendChild(sizeLabel);
    sizeRow.appendChild(sliderWrap);
    root.appendChild(sizeRow);

    // Axis colors
    for (const [axis, key] of [['X', 'axisColorX'], ['Y', 'axisColorY'], ['Z', 'axisColorZ']]) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;';
      const lbl = document.createElement('span');
      lbl.textContent = `${axis} Axis Color`;
      lbl.style.cssText = 'font-size:12px;color:var(--text-primary,#e0e0e0);';
      const colorBtn = document.createElement('button');
      colorBtn.style.cssText = `width:40px;height:22px;background:${this._prefs.gizmo[key]};border:1px solid var(--border-color,#333);border-radius:3px;cursor:pointer;`;
      colorBtn.addEventListener('click', () => {
        CeColorPicker.open(colorBtn, this._prefs.gizmo[key], (c) => {
          colorBtn.style.background = c;
          this._prefs.gizmo[key] = c;
          savePrefs(this._prefs);
        });
      });
      row.appendChild(lbl);
      row.appendChild(colorBtn);
      root.appendChild(row);
    }

    return root;
  }

  // ── Grid tab ─────────────────────────────────────────────────────────────────

  _buildGridTab(content) {
    this._gridProps = new GridProperties();
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
          onChange: (v) => { this._prefs.renderer.defaultType = v; savePrefs(this._prefs); },
        }),
      },
      {
        label: 'Shadow Map',
        el: select({
          options: [['PCFSoftShadowMap','PCF Soft'],['PCFShadowMap','PCF'],['BasicShadowMap','Basic'],['VSMShadowMap','VSM']],
          value: this._prefs.renderer.shadowMapType,
          onChange: (v) => { this._prefs.renderer.shadowMapType = v; savePrefs(this._prefs); },
        }),
      },
      {
        label: 'Pixel Ratio',
        el: select({
          options: [['1','1×'],['device','Device ('+window.devicePixelRatio+'×)'],['2','2×']],
          value: this._prefs.renderer.pixelRatio,
          onChange: (v) => { this._prefs.renderer.pixelRatio = v; savePrefs(this._prefs); },
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
      onChange: (v) => { this._prefs.general.autoSaveInterval = v; savePrefs(this._prefs); },
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
      savePrefs(this._prefs);
    });
    wsRow.appendChild(wsLabel);
    wsRow.appendChild(wsCb);
    root.appendChild(wsRow);

    return root;
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  dispose() {
    if (this._gridProps) { this._gridProps.dispose?.(); this._gridProps = null; }
    super.dispose?.();
  }
}
