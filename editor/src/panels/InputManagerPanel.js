/**
 * InputManagerPanel.js — Input Manager floating/dockable panel.
 * Opened by: Toolbar → Input Manager button  (cyco-action 'input-manager').
 *
 * Tabs:
 *   Keyboard     — editor shortcut rebinding (read-only mirror, edit in Preferences)
 *   Physics      — WASD / jump / axis bindings for physics character controllers
 *   Gamepad      — stub for future controller support
 *
 * Persists physics input bindings to localStorage['cyco-physics-input'].
 * Dispatches: cyco-physics-input-change { bindings } when saved.
 */

import { BasePanel } from './BasePanel.js';

const PHYSICS_INPUT_KEY = 'cyco-physics-input';

const DEFAULT_PHYSICS = {
  moveForward:  'w',
  moveBack:     's',
  moveLeft:     'a',
  moveRight:    'd',
  jump:         ' ',
};

const PHYSICS_LABELS = {
  moveForward:  'Move Forward',
  moveBack:     'Move Back',
  moveLeft:     'Move Left',
  moveRight:    'Move Right',
  jump:         'Jump',
};

function _loadPhysicsBindings() {
  try {
    const raw = localStorage.getItem(PHYSICS_INPUT_KEY);
    if (raw) return { ...DEFAULT_PHYSICS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULT_PHYSICS };
}

function _savePhysicsBindings(b) {
  localStorage.setItem(PHYSICS_INPUT_KEY, JSON.stringify(b));
  window.dispatchEvent(new CustomEvent('cyco-physics-input-change', { detail: { bindings: b } }));
}

function _displayKey(key) {
  if (key === ' ') return 'Space';
  return key;
}

export class InputManagerPanel extends BasePanel {
  constructor() {
    super();
    this._activeTab      = 'physics';
    this._tabBtns        = {};
    this._contentArea    = null;
    this._physicsBindings = null;
    this._listeningFor   = null; // key name currently capturing
  }

  get _floatDimensions() { return { width: 420, height: 340 }; }

  _fixFloatingSize() {
    if (!this._floating) return;
    const container = this._findFloatingContainer();
    if (!container) return;
    const groupApi = this._panelApi?.group?.api;
    if (groupApi) {
      try {
        groupApi.setConstraints({ minimumWidth: 320, minimumHeight: 240 });
      } catch (_) {}
    }
    super._fixFloatingSize();
  }

  _buildContent() {
    this._physicsBindings = _loadPhysicsBindings();

    const root = document.createElement('div');
    root.style.cssText = 'height:100%;display:flex;flex-direction:column;overflow:hidden;font-size:12px;';

    // ── Tab strip ─────────────────────────────────────────────────────────
    const tabStrip = document.createElement('div');
    tabStrip.style.cssText = 'display:flex;border-bottom:1px solid var(--border-color,#333);flex-shrink:0;';

    const TABS = [
      { id: 'physics',  label: 'Physics Input' },
      { id: 'keyboard', label: 'Keyboard' },
      { id: 'gamepad',  label: 'Gamepad' },
    ];

    TABS.forEach(({ id, label }) => {
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.style.cssText = `
        background:none;border:none;cursor:pointer;padding:8px 12px;
        font-size:12px;color:var(--text-color,#ccc);
        border-bottom:2px solid transparent;transition:color .15s,border-color .15s;
      `;
      btn.addEventListener('click', () => this._activateTab(id));
      this._tabBtns[id] = btn;
      tabStrip.appendChild(btn);
    });

    this._contentArea = document.createElement('div');
    this._contentArea.style.cssText = 'flex:1;overflow-y:auto;padding:14px;';

    root.appendChild(tabStrip);
    root.appendChild(this._contentArea);

    this._activateTab('physics');
    return root;
  }

  _activateTab(id) {
    this._activeTab = id;
    const accent = 'var(--accent,#0078d4)';
    Object.entries(this._tabBtns).forEach(([tabId, btn]) => {
      btn.style.borderBottomColor = tabId === id ? accent : 'transparent';
      btn.style.color = tabId === id ? 'var(--text-bright,#fff)' : 'var(--text-color,#ccc)';
    });
    this._contentArea.innerHTML = '';
    this._listeningFor = null;
    if (id === 'physics')  this._buildPhysicsTab();
    if (id === 'keyboard') this._buildKeyboardTab();
    if (id === 'gamepad')  this._buildGamepadTab();
  }

  // ─── Physics Input Tab ────────────────────────────────────────────────────

  _buildPhysicsTab() {
    const b    = this._physicsBindings;
    const frag = document.createDocumentFragment();

    // Instruction
    const info = document.createElement('p');
    info.textContent = 'Click a binding to remap it, then press any key.';
    info.style.cssText = 'color:var(--text-muted,#888);font-size:11px;margin:0 0 12px;';
    frag.appendChild(info);

    // Binding rows
    Object.entries(PHYSICS_LABELS).forEach(([bindKey, label]) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border-color,#2a2a2a);';

      const lbl = document.createElement('span');
      lbl.textContent = label;
      lbl.style.color = 'var(--text-color,#ccc)';

      const keyBtn = document.createElement('button');
      keyBtn.dataset.bindKey = bindKey;
      keyBtn.textContent = _displayKey(b[bindKey] ?? DEFAULT_PHYSICS[bindKey]);
      keyBtn.style.cssText = `
        background:var(--bg2,#1e1e1e);border:1px solid var(--border-color,#444);
        color:var(--text-bright,#fff);padding:3px 12px;border-radius:3px;
        cursor:pointer;min-width:60px;font-size:11px;font-family:monospace;
        transition:border-color .15s,background .15s;
      `;
      keyBtn.addEventListener('click', () => this._startCapture(bindKey, keyBtn));

      row.appendChild(lbl);
      row.appendChild(keyBtn);
      frag.appendChild(row);
    });

    // Reset + Save buttons
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:14px;';

    const resetBtn = this._makeBtn('Reset', 'var(--bg2,#2a2a2a)', () => {
      this._physicsBindings = { ...DEFAULT_PHYSICS };
      _savePhysicsBindings(this._physicsBindings);
      this._activateTab('physics');
    });
    const saveBtn = this._makeBtn('Save', 'var(--accent,#0078d4)', () => {
      _savePhysicsBindings(this._physicsBindings);
    });
    saveBtn.style.color = '#fff';

    actions.appendChild(resetBtn);
    actions.appendChild(saveBtn);
    frag.appendChild(actions);

    this._contentArea.appendChild(frag);
  }

  _startCapture(bindKey, btn) {
    if (this._listeningFor) return; // already capturing
    this._listeningFor = bindKey;
    btn.textContent = '…press key…';
    btn.style.borderColor = 'var(--accent,#0078d4)';
    btn.style.background  = 'var(--accent-dim,#0050a0)';

    const handler = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const key = e.key === ' ' ? ' ' : e.key.toLowerCase();
      this._physicsBindings[bindKey] = key;
      btn.textContent = _displayKey(key);
      btn.style.borderColor = 'var(--border-color,#444)';
      btn.style.background  = 'var(--bg2,#1e1e1e)';
      this._listeningFor = null;
      document.removeEventListener('keydown', handler, true);
    };
    document.addEventListener('keydown', handler, true);
  }

  // ─── Keyboard Tab (read-only info) ────────────────────────────────────────

  _buildKeyboardTab() {
    const info = document.createElement('p');
    info.innerHTML = 'Editor keyboard shortcuts are configured in <b>Edit → Preferences → Keyboard</b>.';
    info.style.cssText = 'color:var(--text-muted,#888);font-size:12px;line-height:1.6;';
    this._contentArea.appendChild(info);

    // Show current bindings read-only
    try {
      const raw = localStorage.getItem('cyco-prefs');
      if (raw) {
        const kb = JSON.parse(raw)?.keybindings ?? {};
        const table = document.createElement('table');
        table.style.cssText = 'width:100%;border-collapse:collapse;margin-top:10px;font-size:11px;';
        Object.entries(kb).forEach(([action, key]) => {
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td style="padding:3px 8px 3px 0;color:var(--text-color,#ccc);">${action}</td>
            <td style="padding:3px;font-family:monospace;color:var(--text-bright,#fff);
                       background:var(--bg2,#1e1e1e);border-radius:3px;text-align:center;">${key}</td>
          `;
          table.appendChild(tr);
        });
        this._contentArea.appendChild(table);
      }
    } catch { /* ignore */ }
  }

  // ─── Gamepad Tab ─────────────────────────────────────────────────────────

  _buildGamepadTab() {
    const stub = document.createElement('p');
    stub.textContent = 'Gamepad support — coming in a future phase.';
    stub.style.cssText = 'color:var(--text-muted,#888);font-size:12px;';
    this._contentArea.appendChild(stub);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  _makeBtn(label, bg, onClick) {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText = `
      padding:4px 14px;cursor:pointer;background:${bg};
      color:var(--text-color,#ccc);border:1px solid var(--border-color,#444);
      border-radius:3px;font-size:12px;
    `;
    btn.addEventListener('click', onClick);
    return btn;
  }
}
