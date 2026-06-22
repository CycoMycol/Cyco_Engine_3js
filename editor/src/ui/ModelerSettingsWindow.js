/**
 * ModelerSettingsWindow.js — floating, draggable, resizable settings panel
 * for the Cyco Modeler.
 *
 * Opened by: gear icon in the modeler topbar (cyco-open-modeler-settings)
 *            or the viewport context menu.
 *
 * Features (per user spec):
 *   • Floatable — drag the header to move
 *   • Resizable — drag the bottom-right corner handle
 *   • Sticky footer with [Reset] [Make Default] [Do It] that stays visible
 *     while the body scrolls
 *   • Theme matches the right panel (uses --ce-* tokens)
 *   • No "Independent from engine preferences" subtitle
 *   • Reset acts on the CURRENT tab only (not the whole panel)
 *
 * Persistence is handled by ModelerSettings itself (localStorage +
 * project file via main.js onChange listener). This file is just UI.
 */

import { ModelerSettings, MODELER_SETTINGS_DEFAULTS, applyModelerSettingsToScene } from '../CycoModeler/ModelerSettings.js';
import * as THREE from 'three';
import CeColorPicker from './CeColorPicker.js';

const POS_KEY = 'cyco-modeler-settings-window-pos';

const CATEGORIES = [
  { key: 'selectionGizmo',   label: 'Selection Gizmo' },
  { key: 'wireframe',        label: 'Wireframe' },
  { key: 'polygonHighlight', label: 'Polygon Highlight' },
  { key: 'edgeHighlight',    label: 'Edge Highlight' },
  { key: 'vertexHighlight',  label: 'Vertex Highlight' },
];

// ── Factory (called once from main.js to wire the listener) ───────────────

let _instance = null;

export default function getModelerSettingsWindow() {
  if (_instance) return _instance;
  _instance = new ModelerSettingsWindow();
  return _instance;
}

// ── Class ─────────────────────────────────────────────────────────────────

class ModelerSettingsWindow {
  constructor() {
    this._el = null;
    this._activeCategory = 'selectionGizmo';
    this._open = false;
    this._listeners = [];
    // Suppress re-render during user interaction. Without this, every
    // input/drag on a slider or color picker fires `onChange`, which
    // used to call `_buildBody()` and destroy the very control the user
    // is dragging — making sliders feel "stiff" and color pickers snap
    // back. We instead sync the live values of existing controls on
    // external changes only.
    this._suppressExternalRefresh = false;

    window.addEventListener('cyco-open-modeler-settings', () => this.show());
    window.addEventListener('cyco-preferences-change',   () => this._refresh());
    // Re-sync control values on external changes (project load, reset,
    // make default). We deliberately DO NOT rebuild the body — that
    // would destroy the slider / color picker / input under the
    // user's pointer while they interact. The default scene apply
    // runs inside ModelerSettings._emit, so the viewport updates live.
    ModelerSettings.onChange((category) => {
      if (!this._open) return;
      if (this._suppressExternalRefresh) return;
      // External change — re-sync the values of the existing controls
      // in place rather than rebuilding the whole body, so a focused
      // slider / color picker / input isn't yanked out from under
      // the user.
      this._syncControlsFromState();
    });
  }

  // ── Public ─────────────────────────────────────────────────────────────

  show() {
    if (this._open) { this._focus(); return; }
    this._build();
    this._open = true;
    document.body.appendChild(this._el);
    this._refresh();
  }

  hide() {
    if (!this._open || !this._el) return;
    this._el.remove();
    this._el = null;
    this._open = false;
  }

  // ── Build DOM ─────────────────────────────────────────────────────────

  _build() {
    const el = document.createElement('div');
    el.className = 'ce-msw';
    this._restorePos(el);
    el.innerHTML = `
      <div class="ce-msw-header" data-role="drag">
        <span class="ce-msw-title">Cyco Modeler Settings</span>
        <button class="ce-msw-close" data-role="close" title="Close">×</button>
      </div>
      <div class="ce-msw-tabs" data-role="tabs"></div>
      <div class="ce-msw-body" data-role="body"></div>
      <div class="ce-msw-footer" data-role="footer">
        <button class="ce-msw-btn" data-role="reset">Reset</button>
        <button class="ce-msw-btn" data-role="default">Make Default</button>
        <button class="ce-msw-btn ce-msw-btn-primary" data-role="apply">Do It</button>
      </div>
      <div class="ce-msw-resizer" data-role="resize" title="Resize"></div>
    `;
    this._el = el;

    this._buildTabs();
    this._buildBody();
    this._bindDrag();
    this._bindResize();
    el.querySelector('[data-role="close"]').addEventListener('click', () => this.hide());
    el.querySelector('[data-role="reset"]').addEventListener('click', () => this._onReset());
    el.querySelector('[data-role="default"]').addEventListener('click', () => this._onMakeDefault());
    el.querySelector('[data-role="apply"]').addEventListener('click', () => this._onDoIt());

    // Escape closes
    this._onKey = (e) => { if (e.key === 'Escape' && this._open) this.hide(); };
    window.addEventListener('keydown', this._onKey);
  }

  _focus() {
    if (!this._el) return;
    this._el.style.zIndex = String(Math.max(1000, parseInt(this._el.style.zIndex || '0', 10) + 1));
  }

  _buildTabs() {
    const tabs = this._el.querySelector('[data-role="tabs"]');
    tabs.innerHTML = '';
    for (const cat of CATEGORIES) {
      const t = document.createElement('button');
      t.type = 'button';
      t.className = 'ce-msw-tab' + (cat.key === this._activeCategory ? ' is-active' : '');
      t.textContent = cat.label;
      t.dataset.cat = cat.key;
      t.addEventListener('click', () => this._selectCategory(cat.key));
      tabs.appendChild(t);
    }
  }

  _buildBody() {
    const body = this._el.querySelector('[data-role="body"]');
    body.innerHTML = '';
    const frag = document.createDocumentFragment();
    this._buildCategoryUI(this._activeCategory, frag);
    body.appendChild(frag);
  }

  _selectCategory(key) {
    this._activeCategory = key;
    this._el.querySelectorAll('.ce-msw-tab').forEach(t => {
      t.classList.toggle('is-active', t.dataset.cat === key);
    });
    this._buildBody();
  }

  // ── Per-category UI ───────────────────────────────────────────────────

  _buildCategoryUI(key, parent) {
    const v = ModelerSettings.getCategory(key);
    if (!v) return;
    switch (key) {
      case 'selectionGizmo':   return this._buildSelectionGizmoUI(v, parent);
      case 'wireframe':        return this._buildWireframeUI(v, parent);
      case 'polygonHighlight': return this._buildPolygonHighlightUI(v, parent);
      case 'edgeHighlight':    return this._buildEdgeHighlightUI(v, parent);
      case 'vertexHighlight':  return this._buildVertexHighlightUI(v, parent);
    }
  }

  // ─── Reusable row builders ───────────────────────────────────────────

  _row(label, control, parent) {
    const row = document.createElement('label');
    row.className = 'ce-msw-row';
    const l = document.createElement('span');
    l.className = 'ce-msw-label';
    l.textContent = label;
    row.appendChild(l);
    row.appendChild(control);
    parent.appendChild(row);
    return row;
  }

  _toggle(value, onChange) {
    const wrap = document.createElement('button');
    wrap.type = 'button';
    wrap.className = 'ce-msw-toggle' + (value ? ' is-on' : '');
    const knob = document.createElement('span');
    knob.className = 'ce-msw-toggle-knob';
    wrap.appendChild(knob);
    wrap.addEventListener('click', () => {
      wrap.classList.toggle('is-on');
      onChange(wrap.classList.contains('is-on'));
    });
    return wrap;
  }

  _colorSwatch(value, onChange) {
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.className = 'ce-msw-swatch';
    sw.style.background = value;
    sw.title = value + ' — click to change';
    sw.addEventListener('click', (e) => {
      e.stopPropagation();
      CeColorPicker.open(sw, value,
        (c) => { sw.style.background = c; onChange(c); },
        (c) => { sw.style.background = c; sw.title = c + ' — click to change'; onChange(c); }
      );
    });
    return sw;
  }

  _slider(value, min, max, step, onChange) {
    const wrap = document.createElement('span');
    wrap.className = 'ce-msw-slider-wrap';
    const r = document.createElement('input');
    r.type = 'range'; r.min = min; r.max = max; r.step = step; r.value = value;
    r.className = 'ce-msw-slider';
    const n = document.createElement('input');
    n.type = 'number'; n.min = min; n.max = max; n.step = step; n.value = value;
    n.className = 'ce-msw-num';
    r.addEventListener('input', () => { n.value = r.value; onChange(parseFloat(r.value)); });
    n.addEventListener('input', () => { r.value = n.value; onChange(parseFloat(n.value)); });
    wrap.appendChild(r); wrap.appendChild(n);
    return wrap;
  }

  // ─── Category bodies ─────────────────────────────────────────────────

  _buildSelectionGizmoUI(v, parent) {
    this._row('Enabled',         this._toggle(v.enabled, (b) => ModelerSettings.updateCategory('selectionGizmo', { enabled: b })), parent);
    this._row('Outline Color',   this._colorSwatch(v.outlineColor, (c) => ModelerSettings.updateCategory('selectionGizmo', { outlineColor: c })), parent);
    this._row('Thickness',       this._slider(v.outlineWidth, 0, 15, 0.5, (n) => ModelerSettings.updateCategory('selectionGizmo', { outlineWidth: n })), parent);
    this._row('Glow Color',      this._colorSwatch(v.glowColor,    (c) => ModelerSettings.updateCategory('selectionGizmo', { glowColor: c })), parent);
    this._row('Glow Thickness',  this._slider(v.glowWidth, 0, 15, 0.5, (n) => ModelerSettings.updateCategory('selectionGizmo', { glowWidth: n })), parent);
    this._row('Glow Opacity',    this._slider(v.glowOpacity ?? 0.75, 0, 1, 0.05, (n) => ModelerSettings.updateCategory('selectionGizmo', { glowOpacity: n })), parent);
  }

  _buildWireframeUI(v, parent) {
    this._row('Enabled',   this._toggle(v.enabled, (b) => ModelerSettings.updateCategory('wireframe', { enabled: b })), parent);
    this._row('Color',     this._colorSwatch(v.color, (c) => ModelerSettings.updateCategory('wireframe', { color: c })), parent);
    this._row('Thickness', this._slider(v.thickness, 0, 15, 0.5, (n) => ModelerSettings.updateCategory('wireframe', { thickness: n })), parent);
    this._row('Opacity',   this._slider(v.opacity, 0, 1, 0.05, (n) => ModelerSettings.updateCategory('wireframe', { opacity: n })), parent);
  }

  _buildPolygonHighlightUI(v, parent) {
    this._row('Enabled', this._toggle(v.enabled, (b) => ModelerSettings.updateCategory('polygonHighlight', { enabled: b })), parent);
    this._row('Color',   this._colorSwatch(v.color, (c) => ModelerSettings.updateCategory('polygonHighlight', { color: c })), parent);
    this._row('Opacity', this._slider(v.opacity, 0, 1, 0.05, (n) => ModelerSettings.updateCategory('polygonHighlight', { opacity: n })), parent);
  }

  _buildEdgeHighlightUI(v, parent) {
    this._row('Enabled', this._toggle(v.enabled, (b) => ModelerSettings.updateCategory('edgeHighlight', { enabled: b })), parent);
    this._row('Color',   this._colorSwatch(v.color, (c) => ModelerSettings.updateCategory('edgeHighlight', { color: c })), parent);
    this._row('Opacity', this._slider(v.opacity, 0, 1, 0.05, (n) => ModelerSettings.updateCategory('edgeHighlight', { opacity: n })), parent);
  }

  _buildVertexHighlightUI(v, parent) {
    this._row('Enabled',     this._toggle(v.enabled, (b) => ModelerSettings.updateCategory('vertexHighlight', { enabled: b })), parent);
    this._row('Color',       this._colorSwatch(v.color, (c) => ModelerSettings.updateCategory('vertexHighlight', { color: c })), parent);
    this._row('Opacity',     this._slider(v.opacity, 0, 1, 0.05, (n) => ModelerSettings.updateCategory('vertexHighlight', { opacity: n })), parent);
    this._row('Vertex Size', this._slider(v.vertexSize, 1, 24, 1, (n) => ModelerSettings.updateCategory('vertexHighlight', { vertexSize: n })), parent);
  }

  // ── Footer actions ────────────────────────────────────────────────────

  _onReset() {
    this._suppressExternalRefresh = true;
    ModelerSettings.resetCategory(this._activeCategory);
    this._suppressExternalRefresh = false;
    // Force a fresh rebuild since the user explicitly asked for a
    // reset (focus state doesn't matter here).
    this._buildBody();
  }

  _onMakeDefault() {
    ModelerSettings.makeDefault(this._activeCategory);
    this._toast(`Saved "${this._activeCategory}" as new default`);
  }

  _onDoIt() {
    applyModelerSettingsToScene();
    try { window.__cyco?.ProjectManager?._save?.(); } catch {}
    this._toast('Settings applied & saved to project');
  }

  _toast(msg) {
    const t = document.createElement('div');
    t.className = 'ce-msw-toast';
    t.textContent = msg;
    this._el.appendChild(t);
    requestAnimationFrame(() => t.classList.add('is-visible'));
    setTimeout(() => { t.classList.remove('is-visible'); setTimeout(() => t.remove(), 200); }, 1400);
  }

  // ── Drag / resize / persist ───────────────────────────────────────────

  _bindDrag() {
    const header = this._el.querySelector('[data-role="drag"]');
    header.addEventListener('pointerdown', (e) => {
      if (e.target.closest('[data-role="close"]')) return;
      this._focus();
      const startX = e.clientX, startY = e.clientY;
      const rect = this._el.getBoundingClientRect();
      const offX = startX - rect.left, offY = startY - rect.top;
      this._el.style.left = rect.left + 'px';
      this._el.style.top  = rect.top  + 'px';
      this._el.style.right = 'auto';
      this._el.style.bottom = 'auto';
      const move = (ev) => {
        const nx = Math.max(0, Math.min(window.innerWidth  - 40, ev.clientX - offX));
        const ny = Math.max(0, Math.min(window.innerHeight - 40, ev.clientY - offY));
        this._el.style.left = nx + 'px';
        this._el.style.top  = ny + 'px';
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        this._persistPos();
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  }

  _bindResize() {
    const handle = this._el.querySelector('[data-role="resize"]');
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const startX = e.clientX, startY = e.clientY;
      const rect = this._el.getBoundingClientRect();
      const startW = rect.width, startH = rect.height;
      const move = (ev) => {
        const w = Math.max(280, Math.min(window.innerWidth  - rect.left - 4, startW + ev.clientX - startX));
        const h = Math.max(200, Math.min(window.innerHeight - rect.top  - 4, startH + ev.clientY - startY));
        this._el.style.width  = w + 'px';
        this._el.style.height = h + 'px';
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        this._persistPos();
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  }

  _persistPos() {
    const r = this._el.getBoundingClientRect();
    try { localStorage.setItem(POS_KEY, JSON.stringify({ left: r.left, top: r.top, width: r.width, height: r.height })); } catch {}
  }

  _restorePos(el) {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(POS_KEY) || 'null'); } catch {}
    if (saved && typeof saved.width === 'number') {
      el.style.left   = saved.left   + 'px';
      el.style.top    = saved.top    + 'px';
      el.style.width  = saved.width  + 'px';
      el.style.height = saved.height + 'px';
      el.style.right = el.style.bottom = 'auto';
    } else {
      const w = 360, h = 420;
      el.style.left   = Math.round((window.innerWidth  - w) / 2) + 'px';
      el.style.top    = Math.round((window.innerHeight - h) / 3) + 'px';
      el.style.width  = w + 'px';
      el.style.height = h + 'px';
    }
  }

  // Re-render body if external code changes a setting (e.g. project load).
  _refresh() {
    if (this._open) this._buildBody();
  }

  /**
   * Update the live values of the rendered controls from the current
   * settings store WITHOUT destroying and re-creating the DOM. This
   * preserves focus, drag state, and color-picker open state on the
   * user-facing controls. Values that match the control's current
   * value are skipped to avoid resetting the caret position while
   * the user is mid-edit.
   */
  _syncControlsFromState() {
    if (!this._el) return;
    const cat = this._activeCategory;
    const v = ModelerSettings.getCategory(cat);
    if (!v) return;

    // Helper: only assign if value differs (avoids caret jumps).
    const setIfDiff = (el, key, value) => {
      if (!el) return;
      if (el[key] === value) return;
      el[key] = value;
    };

    // 1. Toggle buttons (first .ce-msw-toggle in any row, matched by label).
    const rows = this._el.querySelectorAll('.ce-msw-row');
    for (const row of rows) {
      const label = row.querySelector('.ce-msw-label')?.textContent;
      const toggle = row.querySelector('.ce-msw-toggle');
      const swatch = row.querySelector('.ce-msw-swatch');
      const sliderWrap = row.querySelector('.ce-msw-slider-wrap');
      if (toggle && label === 'Enabled' && typeof v.enabled === 'boolean') {
        toggle.classList.toggle('is-on', v.enabled);
      }
      if (swatch) {
        const color = this._colorValueForLabel(cat, v, label);
        if (color && swatch.style.background !== this._cssColor(color)) {
          swatch.style.background = this._cssColor(color);
          swatch.title = color + ' — click to change';
        }
      }
      if (sliderWrap) {
        const num = sliderWrap.querySelector('.ce-msw-num');
        const range = sliderWrap.querySelector('.ce-msw-slider');
        const numValue = this._numericValueForLabel(cat, v, label);
        if (numValue != null) {
          // Only update the side that isn't focused, so we don't fight
          // the user mid-drag.
          if (document.activeElement !== range) setIfDiff(range, 'value', numValue);
          if (document.activeElement !== num)    setIfDiff(num,    'value', numValue);
        }
      }
    }
  }

  _colorValueForLabel(cat, v, label) {
    // `cat` is the active category so the same label ("Color") can map
    // to the correct field on each tab.
    if (cat === 'selectionGizmo') {
      if (label === 'Outline Color') return v.outlineColor;
      if (label === 'Glow Color')    return v.glowColor;
    }
    if (label === 'Color') return v.color;
    return null;
  }

  _numericValueForLabel(cat, v, label) {
    if (cat === 'selectionGizmo') {
      if (label === 'Thickness')      return v.outlineWidth;
      if (label === 'Glow Thickness') return v.glowWidth;
      if (label === 'Glow Opacity')   return v.glowOpacity;
    }
    if (cat === 'wireframe') {
      if (label === 'Thickness') return v.thickness;
    }
    if (label === 'Opacity')     return v.opacity;
    if (label === 'Vertex Size') return v.vertexSize;
    return null;
  }

  _cssColor(c) {
    if (!c) return '';
    if (typeof c !== 'string') {
      // THREE.Color or number — render as hex.
      try { return '#' + new THREE.Color(c).getHexString(); } catch { return ''; }
    }
    return c;
  }
}
