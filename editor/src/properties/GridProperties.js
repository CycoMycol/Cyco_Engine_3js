/**
 * GridProperties.js — Properties panel for the viewport grid and axes helpers.
 * Reads/writes settings from localStorage['cyco-grid-settings'].
 * Dispatches 'cyco-grid-settings-change' when any setting changes.
 *
 * ViewportEngine responds to cyco-grid-settings-change by rebuilding the grid.
 */

import { section, row, numInput, slider, checkbox, colorSwatch, nameHeader } from './propUtils.js';

const STORAGE_KEY  = 'cyco-grid-settings';
const CHANGE_EVENT = 'cyco-grid-settings-change';

const DEFAULTS = {
  divisions:   20,
  size:        20,
  gridColor:   '#444444',
  centerColor: '#888888',
  opacity:     1.0,
  gridVisible: true,
  axesVisible: true,
};

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

export class GridProperties {
  constructor() {
    this._el       = document.createElement('div');
    this._el.className = 'ce-props-panel';
    this._settings = loadSettings();
    this._build();
  }

  get element() { return this._el; }

  _build() {
    const s = this._settings;

    this._el.appendChild(nameHeader('Grid Settings', 'Viewport Grid & Axes'));

    // ── Grid ───────────────────────────────────────────────────────────────
    const { el: gSec, body: gBody } = section('Grid');

    const divInp = numInput({ value: s.divisions, step: 1, min: 1, max: 200, decimals: 0,
      onChange: (v) => { s.divisions = Math.round(Math.max(1, v)); this._save(); } });
    const sizeInp = numInput({ value: s.size, step: 1, min: 1, max: 1000, decimals: 1,
      onChange: (v) => { s.size = Math.max(1, v); this._save(); } });

    const gridSw = colorSwatch({ color: s.gridColor,
      onChange: (c) => { s.gridColor = c; this._save(); } });
    const centSw = colorSwatch({ color: s.centerColor,
      onChange: (c) => { s.centerColor = c; this._save(); } });

    const opacS = slider({ value: s.opacity, min: 0, max: 1, step: 0.05,
      onChange: (v) => { s.opacity = v; this._save(); } });

    const showCb = checkbox({ checked: s.gridVisible,
      onChange: (v) => { s.gridVisible = v; this._save(); } });

    gBody.appendChild(row('Divisions',    divInp));
    gBody.appendChild(row('Size',         sizeInp));
    gBody.appendChild(row('Grid Color',   gridSw.el));
    gBody.appendChild(row('Center Color', centSw.el));
    gBody.appendChild(row('Opacity',      opacS.el));
    gBody.appendChild(row('Show Grid',    showCb));

    this._el.appendChild(gSec);

    // ── Axes ───────────────────────────────────────────────────────────────
    const { el: aSec, body: aBody } = section('Axes');

    const axesCb = checkbox({ checked: s.axesVisible,
      onChange: (v) => { s.axesVisible = v; this._save(); } });

    aBody.appendChild(row('Show Axes', axesCb));

    this._el.appendChild(aSec);
  }

  _save() {
    saveSettings(this._settings);
  }

  dispose() {}
}
