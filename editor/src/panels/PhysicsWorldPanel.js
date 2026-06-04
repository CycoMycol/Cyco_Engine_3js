/**
 * PhysicsWorldPanel.js — Physics World Settings floating/dockable panel.
 * Opened by: Environment → Physics  (cyco-show-properties { type:'physics' }).
 *
 * Tabs:
 *   3D Physics — mode, gravity XYZ, fixed timestep, max substeps, solver iterations
 *   2D Physics — mode, gravity XY, active plane (XY / XZ)
 *
 * Persists settings to the active scene's registry entry in SceneManager.
 * Dispatches: cyco-physics-world-change { physicsMode, gravity, plane2d } when saved.
 */

import { BasePanel } from './BasePanel.js';
import { select, numInput }    from '../properties/propUtils.js';

const STORAGE_KEY = 'cyco-physics-world';

/** Read physics settings from the active scene registry (with defaults). */
function _loadSettings() {
  const sm  = window.__cyco?.sceneManager;
  const reg = sm?.sceneRegistry?.get(sm?.activeSceneId);
  return {
    physicsMode: reg?.physicsMode ?? 'none',
    gravity:     reg?.gravity     ?? { x: 0, y: -9.81, z: 0 },
    plane2d:     reg?.plane2d     ?? 'xy',
    // Runtime tuning (stored in localStorage, not per-scene)
    fixedDt:        parseFloat(localStorage.getItem(STORAGE_KEY + '.fixedDt')  || '0.01666') || 1/60,
    maxSubsteps:    parseInt  (localStorage.getItem(STORAGE_KEY + '.substeps') || '3',    10) || 3,
    solverIterations: parseInt(localStorage.getItem(STORAGE_KEY + '.solver')   || '4',    10) || 4,
  };
}

function _saveSettings(s) {
  const sm  = window.__cyco?.sceneManager;
  const id  = sm?.activeSceneId;
  if (sm && id && sm.sceneRegistry.has(id)) {
    const entry = sm.sceneRegistry.get(id);
    sm.sceneRegistry.set(id, {
      ...entry,
      physicsMode: s.physicsMode,
      gravity:     s.gravity,
      plane2d:     s.plane2d,
    });
  }
  localStorage.setItem(STORAGE_KEY + '.fixedDt',  String(s.fixedDt));
  localStorage.setItem(STORAGE_KEY + '.substeps', String(s.maxSubsteps));
  localStorage.setItem(STORAGE_KEY + '.solver',   String(s.solverIterations));
  window.dispatchEvent(new CustomEvent('cyco-physics-world-change', { detail: { ...s } }));
}

export class PhysicsWorldPanel extends BasePanel {
  constructor() {
    super();
    this._settings   = null;
    this._activeTab  = '3d';
    this._tabBtns    = {};
    this._contentArea = null;
  }

  get _floatDimensions() { return { width: 420, height: 380 }; }

  _fixFloatingSize() {
    if (!this._floating) return;
    const container = this._findFloatingContainer();
    if (!container) return;
    const { width, height } = this._floatDimensions;
    const groupApi = this._panelApi?.group?.api;
    if (groupApi) {
      try {
        groupApi.setConstraints({ minimumWidth: 320, minimumHeight: 260 });
        groupApi.setSize({ width, height });
      } catch (_) {}
    }
    container.style.width  = width  + 'px';
    container.style.height = height + 'px';
  }

  _buildContent() {
    this._settings = _loadSettings();

    const root = document.createElement('div');
    root.style.cssText = 'height:100%;display:flex;flex-direction:column;overflow:hidden;font-size:12px;';

    // ── Tab strip ──────────────────────────────────────────────────────────
    const tabStrip = document.createElement('div');
    tabStrip.style.cssText = 'display:flex;border-bottom:1px solid var(--border-color,#333);flex-shrink:0;';

    const TABS = [
      { id: '3d', label: '3D Physics' },
      { id: '2d', label: '2D Physics' },
    ];

    TABS.forEach(({ id, label }) => {
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.style.cssText = `
        background:none;border:none;cursor:pointer;padding:8px 14px;
        font-size:12px;color:var(--text-color,#ccc);
        border-bottom:2px solid transparent;transition:color .15s,border-color .15s;
      `;
      btn.addEventListener('click', () => this._activateTab(id));
      this._tabBtns[id] = btn;
      tabStrip.appendChild(btn);
    });

    // ── Content area ───────────────────────────────────────────────────────
    this._contentArea = document.createElement('div');
    this._contentArea.style.cssText = 'flex:1;overflow-y:auto;padding:16px;';

    // ── Action bar ─────────────────────────────────────────────────────────
    const actionBar = document.createElement('div');
    actionBar.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;padding:8px 12px;border-top:1px solid var(--border-color,#333);flex-shrink:0;';

    const applyBtn = document.createElement('button');
    applyBtn.textContent = 'Apply';
    applyBtn.style.cssText = 'padding:4px 14px;cursor:pointer;background:var(--accent,#0078d4);color:#fff;border:none;border-radius:3px;font-size:12px;';
    applyBtn.addEventListener('click', () => {
      _saveSettings(this._settings);
    });

    const resetBtn = document.createElement('button');
    resetBtn.textContent = 'Reset';
    resetBtn.style.cssText = 'padding:4px 14px;cursor:pointer;background:var(--bg2,#2a2a2a);color:var(--text-color,#ccc);border:1px solid var(--border-color,#444);border-radius:3px;font-size:12px;';
    resetBtn.addEventListener('click', () => {
      this._settings = { physicsMode: 'none', gravity: { x:0, y:-9.81, z:0 }, plane2d:'xy', fixedDt:1/60, maxSubsteps:3, solverIterations:4 };
      this._activateTab(this._activeTab);
    });

    actionBar.appendChild(resetBtn);
    actionBar.appendChild(applyBtn);

    root.appendChild(tabStrip);
    root.appendChild(this._contentArea);
    root.appendChild(actionBar);

    this._activateTab('3d');
    return root;
  }

  // ─── Tab switching ────────────────────────────────────────────────────────

  _activateTab(id) {
    this._activeTab = id;
    const accent = 'var(--accent,#0078d4)';
    const def    = 'transparent';
    Object.entries(this._tabBtns).forEach(([tabId, btn]) => {
      btn.style.borderBottomColor = tabId === id ? accent : def;
      btn.style.color = tabId === id
        ? 'var(--text-bright,#fff)'
        : 'var(--text-color,#ccc)';
    });
    this._contentArea.innerHTML = '';
    if (id === '3d')  this._build3dTab();
    if (id === '2d')  this._build2dTab();
  }

  // ─── 3D Tab ───────────────────────────────────────────────────────────────

  _build3dTab() {
    const s   = this._settings;
    const frag = document.createDocumentFragment();

    // Mode
    frag.appendChild(this._labelRow('Physics Mode'));
    const modeRow = document.createElement('div');
    modeRow.style.cssText = 'display:flex;gap:8px;margin-bottom:12px;';
    ['none', '3d'].forEach(val => {
      const lbl = document.createElement('label');
      lbl.style.cssText = 'display:flex;align-items:center;gap:4px;cursor:pointer;color:var(--text-color,#ccc);';
      const radio = document.createElement('input');
      radio.type  = 'radio';
      radio.name  = 'physics-mode-3d';
      radio.value = val;
      radio.checked = s.physicsMode === val;
      radio.addEventListener('change', () => { if (radio.checked) s.physicsMode = val; });
      lbl.appendChild(radio);
      lbl.appendChild(document.createTextNode(val === 'none' ? 'Disabled' : 'Enabled (3D)'));
      modeRow.appendChild(lbl);
    });
    frag.appendChild(modeRow);

    // Gravity XYZ
    frag.appendChild(this._labelRow('Gravity'));
    frag.appendChild(this._vec3Row(
      s.gravity,
      ['X', 'Y', 'Z'],
      ['x', 'y', 'z'],
      (axis, val) => { s.gravity[axis] = val; }
    ));

    // Fixed DT
    frag.appendChild(this._labelRow('Fixed Timestep (s)'));
    frag.appendChild(this._numRow(s.fixedDt, (v) => { s.fixedDt = v; }, 0.001, 0.1, 0.001));

    // Max substeps
    frag.appendChild(this._labelRow('Max Substeps'));
    frag.appendChild(this._numRow(s.maxSubsteps, (v) => { s.maxSubsteps = Math.max(1, Math.round(v)); }, 1, 10, 1));

    // Solver iterations
    frag.appendChild(this._labelRow('Solver Iterations'));
    frag.appendChild(this._numRow(s.solverIterations, (v) => { s.solverIterations = Math.max(1, Math.round(v)); }, 1, 20, 1));

    this._contentArea.appendChild(frag);
  }

  // ─── 2D Tab ───────────────────────────────────────────────────────────────

  _build2dTab() {
    const s   = this._settings;
    const frag = document.createDocumentFragment();

    // Mode
    frag.appendChild(this._labelRow('Physics Mode'));
    const modeRow = document.createElement('div');
    modeRow.style.cssText = 'display:flex;gap:8px;margin-bottom:12px;';
    ['none', '2d'].forEach(val => {
      const lbl = document.createElement('label');
      lbl.style.cssText = 'display:flex;align-items:center;gap:4px;cursor:pointer;color:var(--text-color,#ccc);';
      const radio = document.createElement('input');
      radio.type  = 'radio';
      radio.name  = 'physics-mode-2d';
      radio.value = val;
      radio.checked = s.physicsMode === val;
      radio.addEventListener('change', () => { if (radio.checked) s.physicsMode = val; });
      lbl.appendChild(radio);
      lbl.appendChild(document.createTextNode(val === 'none' ? 'Disabled' : 'Enabled (2D)'));
      modeRow.appendChild(lbl);
    });
    frag.appendChild(modeRow);

    // Gravity XY
    frag.appendChild(this._labelRow('Gravity'));
    frag.appendChild(this._vec3Row(
      s.gravity,
      ['X', 'Y'],
      ['x', 'y'],
      (axis, val) => { s.gravity[axis] = val; }
    ));

    // Active plane
    frag.appendChild(this._labelRow('Active Plane'));
    const planeRow = document.createElement('div');
    planeRow.style.cssText = 'display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;';
    const planeLabels = {
      xy: 'XY — side-scroller (Z=0)',
      xz: 'XZ — top-down (Y=0)',
    };
    ['xy', 'xz'].forEach(val => {
      const lbl = document.createElement('label');
      lbl.style.cssText = 'display:flex;align-items:center;gap:4px;cursor:pointer;color:var(--text-color,#ccc);flex:1;min-width:140px;';
      const radio = document.createElement('input');
      radio.type  = 'radio';
      radio.name  = 'physics-plane';
      radio.value = val;
      radio.checked = s.plane2d === val;
      radio.addEventListener('change', () => { if (radio.checked) s.plane2d = val; });
      lbl.appendChild(radio);
      lbl.appendChild(document.createTextNode(planeLabels[val]));
      planeRow.appendChild(lbl);
    });
    frag.appendChild(planeRow);

    this._contentArea.appendChild(frag);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  _labelRow(text) {
    const el = document.createElement('div');
    el.textContent = text;
    el.style.cssText = 'font-size:11px;color:var(--text-muted,#888);margin-bottom:4px;text-transform:uppercase;letter-spacing:.04em;';
    return el;
  }

  _numRow(value, onChange, min, max, step) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-bottom:12px;';
    const input = document.createElement('input');
    input.type  = 'number';
    input.value = value;
    input.min   = min;
    input.max   = max;
    input.step  = step;
    input.style.cssText = 'width:100%;box-sizing:border-box;background:var(--bg2,#1e1e1e);border:1px solid var(--border-color,#444);color:var(--text-color,#ccc);padding:3px 6px;border-radius:3px;font-size:12px;';
    input.addEventListener('change', () => onChange(parseFloat(input.value)));
    wrap.appendChild(input);
    return wrap;
  }

  _vec3Row(obj, labels, keys, onChange) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;gap:6px;margin-bottom:12px;';
    keys.forEach((k, i) => {
      const lbl = document.createElement('label');
      lbl.style.cssText = 'display:flex;align-items:center;gap:3px;flex:1;color:var(--text-color,#ccc);font-size:11px;';
      lbl.textContent = labels[i] + ':';
      const input = document.createElement('input');
      input.type  = 'number';
      input.value = obj[k] ?? 0;
      input.step  = '0.01';
      input.style.cssText = 'flex:1;min-width:0;background:var(--bg2,#1e1e1e);border:1px solid var(--border-color,#444);color:var(--text-color,#ccc);padding:3px 4px;border-radius:3px;font-size:11px;';
      input.addEventListener('change', () => onChange(k, parseFloat(input.value)));
      lbl.appendChild(input);
      wrap.appendChild(lbl);
    });
    return wrap;
  }
}
