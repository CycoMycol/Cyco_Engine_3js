/**
 * GridProperties.js — Properties panel for the viewport grid and axes helpers.
 * Reads/writes settings from localStorage['cyco-grid-settings'].
 * Dispatches 'cyco-grid-settings-change' when any setting changes.
 *
 * ViewportEngine responds to cyco-grid-settings-change by rebuilding the grid.
 *
 * Styles:
 *   standard           — finite THREE.GridHelper
 *   infinite           — infinite Pristine Grid (Unreal-style)
 *   checkered          — finite TSL checkerboard (fades at edges)
 *   checkered-infinite — infinite TSL checkerboard
 */

import { section, row, numInput, slider, checkbox, colorSwatch, nameHeader } from './propUtils.js';

const STORAGE_KEY  = 'cyco-grid-settings';
const CHANGE_EVENT = 'cyco-grid-settings-change';

const DEFAULTS = {
  style:          'standard',  // 'standard' | 'infinite' | 'checkered' | 'checkered-infinite'
  // Standard-only
  divisions:      20,
  size:           20,
  gridColor:      '#444444',
  centerColor:    '#888888',
  // Infinite-only
  cellSize:       4.0,
  xAxisColor:     '#CC2222',
  zAxisColor:     '#2244CC',
  // Checkered (both checkered styles)
  checkerColor1:  '#333333',
  checkerColor2:  '#555555',
  checkerSize:    4.0,
  // Common
  opacity:        1.0,
  gridVisible:    true,
  axesVisible:    true,
};

const ALL_STYLES = new Set(['standard', 'infinite', 'checkered', 'checkered-infinite']);
const STD        = new Set(['standard']);
const INF        = new Set(['infinite']);
const CHK        = new Set(['checkered', 'checkered-infinite']);
const STD_INF    = new Set(['standard', 'infinite']);

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    return { ...DEFAULTS, ...saved };
  } catch (_) {
    return { ...DEFAULTS };
  }
}

function saveSettings(s) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { ...s } }));
}

/** Build a styled select element (reusable) */
function mkSelect(options, currentVal, onChange) {
  const sel = document.createElement('select');
  sel.className = 'ce-prop-select';
  sel.style.cssText = 'width:100%;background:#2a2a2a;color:#ccc;border:1px solid #444;border-radius:3px;padding:2px 4px;font-size:11px;';
  options.forEach(([label, val]) => {
    const opt = document.createElement('option');
    opt.value = val; opt.textContent = label;
    if (val === currentVal) opt.selected = true;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

export class GridProperties {
  constructor() {
    this._el       = document.createElement('div');
    this._el.className = 'ce-props-panel';
    this._settings = loadSettings();
    this._allRows  = [];
    this._build();
  }

  get element() { return this._el; }

  /** Add a row to the section body and tag it with which styles show it. */
  _addRow(body, label, ctrl, visibleFor) {
    const r = row(label, ctrl);
    r._visibleFor = visibleFor;
    body.appendChild(r);
    this._allRows.push(r);
    return r;
  }

  _build() {
    const s = this._settings;
    this._el.innerHTML = '';
    this._allRows = [];

    this._el.appendChild(nameHeader('Grid Settings', 'Viewport Grid & Axes'));

    // ── Grid section ──────────────────────────────────────────────────────────
    const { el: gSec, body: gBody } = section('Grid');

    // Style dropdown — always visible
    const styleSel = mkSelect([
      ['Standard (GridHelper)',   'standard'],
      ['Infinite (Unreal-style)', 'infinite'],
      ['Checkered',               'checkered'],
      ['Checkered Infinite',      'checkered-infinite'],
    ], s.style, v => { s.style = v; this._applyStyleVisibility(v); this._save(); });
    this._addRow(gBody, 'Style', styleSel, ALL_STYLES);

    // ── Standard-only controls ────────────────────────────────────────────────
    const divInp = numInput({ value: s.divisions, step: 1, min: 1, max: 200, decimals: 0,
      onChange: v => { s.divisions = Math.round(Math.max(1, v)); this._save(); } });
    this._addRow(gBody, 'Divisions', divInp, STD);

    const sizeInp = numInput({ value: s.size, step: 1, min: 1, max: 1000, decimals: 1,
      onChange: v => { s.size = Math.max(1, v); this._save(); } });
    this._addRow(gBody, 'Size', sizeInp, STD);

    const gridColorSw = colorSwatch({ color: s.gridColor,
      onChange: c => { s.gridColor = c; this._save(); } });
    this._addRow(gBody, 'Grid Color', gridColorSw.el, STD_INF);

    const centColorSw = colorSwatch({ color: s.centerColor,
      onChange: c => { s.centerColor = c; this._save(); } });
    this._addRow(gBody, 'Center Color', centColorSw.el, STD);

    // ── Infinite-only controls ────────────────────────────────────────────────
    const cellInp = numInput({ value: s.cellSize ?? 4.0, step: 0.5, min: 0.5, max: 500, decimals: 2,
      onChange: v => { s.cellSize = Math.max(0.5, v); this._save(); } });
    this._addRow(gBody, 'Cell Size', cellInp, INF);

    const xAxisSw = colorSwatch({ color: s.xAxisColor ?? '#CC2222',
      onChange: c => { s.xAxisColor = c; this._save(); } });
    this._addRow(gBody, 'X Axis Color', xAxisSw.el, INF);

    const zAxisSw = colorSwatch({ color: s.zAxisColor ?? '#2244CC',
      onChange: c => { s.zAxisColor = c; this._save(); } });
    this._addRow(gBody, 'Z Axis Color', zAxisSw.el, INF);

    // ── Checkered-only controls ───────────────────────────────────────────────
    const chkSzInp = numInput({ value: s.checkerSize ?? 4.0, step: 0.5, min: 0.5, max: 500, decimals: 2,
      onChange: v => { s.checkerSize = Math.max(0.5, v); this._save(); } });
    this._addRow(gBody, 'Checker Size', chkSzInp, CHK);

    const col1Sw = colorSwatch({ color: s.checkerColor1 ?? '#333333',
      onChange: c => { s.checkerColor1 = c; this._save(); } });
    this._addRow(gBody, 'Color 1', col1Sw.el, CHK);

    const col2Sw = colorSwatch({ color: s.checkerColor2 ?? '#555555',
      onChange: c => { s.checkerColor2 = c; this._save(); } });
    this._addRow(gBody, 'Color 2', col2Sw.el, CHK);

    // ── Common controls ───────────────────────────────────────────────────────
    const opacS = slider({ value: s.opacity, min: 0, max: 1, step: 0.01,
      onChange: v => { s.opacity = v; this._save(); } });
    this._addRow(gBody, 'Opacity', opacS.el, ALL_STYLES);

    const showCb = checkbox({ checked: s.gridVisible,
      onChange: v => { s.gridVisible = v; this._save(); } });
    this._addRow(gBody, 'Show Grid', showCb, ALL_STYLES);

    this._el.appendChild(gSec);

    // ── Axes section ──────────────────────────────────────────────────────────
    const { el: aSec, body: aBody } = section('Axes');

    const axesCb = checkbox({ checked: s.axesVisible,
      onChange: v => { s.axesVisible = v; this._save(); } });
    aBody.appendChild(row('Show Axes', axesCb));

    this._el.appendChild(aSec);

    // Apply initial visibility
    this._applyStyleVisibility(s.style);
  }

  _applyStyleVisibility(style) {
    this._allRows.forEach(r => {
      r.style.display = r._visibleFor.has(style) ? '' : 'none';
    });
  }

  _save() {
    saveSettings(this._settings);
  }

  dispose() {}
}
