/**
 * GradientEditor.js — Photoshop-style gradient editor.
 *
 * Creates a gradient bar with draggable colour and opacity stops.
 * Click in the colour-handle track (below bar) to add a colour stop.
 * Click in the opacity-handle track (above bar) to add an opacity stop.
 * Click a stop handle to select it; drag to reposition.
 * Selected stop shows its properties in the Stops panel.
 *
 * Usage:
 *   const ge = new GradientEditor({ colorStops, opacityStops, onChange });
 *   container.appendChild(ge.element);
 *
 * colorStops:   [{pos:0…1, color:'#rrggbb'}, …]
 * opacityStops: [{pos:0…1, opacity:0…1},    …]
 * onChange: ({colorStops, opacityStops}) => void
 */

import CeColorPicker from './CeColorPicker.js';

export class GradientEditor {
  constructor(opts = {}) {
    this._colorStops = (opts.colorStops ?? [
      { pos: 0.0, color: '#0a0814' },
      { pos: 0.45, color: '#d4732a' },
      { pos: 0.52, color: '#87CEEB' },
      { pos: 1.0,  color: '#1565C0' },
    ]).map(s => ({ ...s }));

    this._opacityStops = (opts.opacityStops ?? [
      { pos: 0.0, opacity: 1.0 },
      { pos: 1.0, opacity: 1.0 },
    ]).map(s => ({ ...s }));

    this._onChange = opts.onChange ?? (() => {});
    this._sel = null; // { type:'color'|'opacity', index:number }

    this._el = this._build();
    this._updateCanvas();
    this._updateStopsPanel();
  }

  get element() { return this._el; }

  get data() {
    return {
      colorStops:   this._colorStops.map(s => ({ ...s })),
      opacityStops: this._opacityStops.map(s => ({ ...s })),
    };
  }

  setData({ colorStops, opacityStops } = {}) {
    if (colorStops)   this._colorStops   = colorStops.map(s => ({ ...s }));
    if (opacityStops) this._opacityStops = opacityStops.map(s => ({ ...s }));
    this._sel = null;
    this._rebuildHandles();
    this._updateCanvas();
    this._updateStopsPanel();
  }

  // ── Build ──────────────────────────────────────────────────────────────────

  _build() {
    const root = document.createElement('div');
    root.style.cssText = 'width:100%;user-select:none;';

    // Opacity handle track (above bar) ─────────────────────────────────
    this._opacTrack = document.createElement('div');
    this._opacTrack.style.cssText =
      'position:relative;width:100%;height:20px;box-sizing:border-box;cursor:cell;';
    this._opacTrack.title = 'Click to add opacity stop';
    root.appendChild(this._opacTrack);

    // Gradient canvas ───────────────────────────────────────────────────
    this._canvas = document.createElement('canvas');
    this._canvas.height = 34;
    this._canvas.style.cssText =
      'display:block;width:100%;height:34px;' +
      'border:1px solid var(--border-color,#444);box-sizing:border-box;';
    root.appendChild(this._canvas);

    // Colour handle track (below bar) ───────────────────────────────────
    this._colTrack = document.createElement('div');
    this._colTrack.style.cssText =
      'position:relative;width:100%;height:20px;box-sizing:border-box;cursor:cell;';
    this._colTrack.title = 'Click to add colour stop';
    root.appendChild(this._colTrack);

    // Stops info panel ──────────────────────────────────────────────────
    const panel = document.createElement('div');
    panel.style.cssText =
      'background:var(--bg-secondary,#252525);border:1px solid var(--border-color,#3a3a3a);' +
      'border-radius:4px;padding:8px 10px;margin-top:6px;';

    const title = document.createElement('div');
    title.textContent = 'Stops';
    title.style.cssText =
      'font-size:12px;font-weight:600;color:var(--text-primary,#e0e0e0);margin-bottom:6px;';
    panel.appendChild(title);

    this._opacRow = this._makeOpacRow();
    panel.appendChild(this._opacRow.el);

    this._colRow = this._makeColRow();
    panel.appendChild(this._colRow.el);

    root.appendChild(panel);

    // Track click → add stop ────────────────────────────────────────────
    this._opacTrack.addEventListener('click', (e) => {
      if (e.target !== this._opacTrack) return;
      this._addOpacStop(this._trackPos(e, this._opacTrack));
    });
    this._colTrack.addEventListener('click', (e) => {
      if (e.target !== this._colTrack) return;
      this._addColStop(this._trackPos(e, this._colTrack));
    });

    this._rebuildHandles();
    return root;
  }

  // ── Stop editor rows ───────────────────────────────────────────────────────

  _makeOpacRow() {
    const el = document.createElement('div');
    el.style.cssText =
      'display:flex;align-items:center;gap:4px;font-size:11px;' +
      'color:var(--text-secondary,#999);margin-bottom:4px;flex-wrap:wrap;';

    const numSt =
      'width:44px;background:var(--bg-primary,#1e1e1e);border:1px solid var(--border-color,#444);' +
      'color:var(--text-primary,#e0e0e0);padding:2px 4px;border-radius:3px;font-size:11px;';

    el.appendChild(this._span('Opacity:'));
    const valIn = this._numInput(numSt, 0, 100, 1);
    valIn.addEventListener('change', () => {
      const s = this._selOf('opacity');
      if (!s) return;
      s.opacity = Math.max(0, Math.min(1, (parseFloat(valIn.value) || 0) / 100));
      this._rebuildHandles();
      this._updateCanvas();
      this._emit();
    });
    el.appendChild(valIn);
    el.appendChild(this._span('%'));

    el.appendChild(this._span('Location:', 'margin-left:8px;'));
    const locIn = this._numInput(numSt, 0, 100, 0.1);
    locIn.addEventListener('change', () => {
      const s = this._selOf('opacity');
      if (!s) return;
      s.pos = Math.max(0, Math.min(1, (parseFloat(locIn.value) || 0) / 100));
      this._rebuildHandles();
      this._updateCanvas();
      this._emit();
    });
    el.appendChild(locIn);
    el.appendChild(this._span('%'));

    const del = this._delBtn(() => {
      if (this._opacityStops.length <= 2) return;
      const idx = this._sel?.type === 'opacity' ? this._sel.index : -1;
      if (idx < 0) return;
      this._opacityStops.splice(idx, 1);
      this._sel = null;
      this._rebuildHandles();
      this._updateCanvas();
      this._updateStopsPanel();
      this._emit();
    });
    el.appendChild(del);

    return { el, valIn, locIn };
  }

  _makeColRow() {
    const el = document.createElement('div');
    el.style.cssText =
      'display:flex;align-items:center;gap:4px;font-size:11px;' +
      'color:var(--text-secondary,#999);flex-wrap:wrap;';

    const numSt =
      'width:44px;background:var(--bg-primary,#1e1e1e);border:1px solid var(--border-color,#444);' +
      'color:var(--text-primary,#e0e0e0);padding:2px 4px;border-radius:3px;font-size:11px;';

    el.appendChild(this._span('Color:'));

    const swatch = document.createElement('button');
    swatch.style.cssText =
      'width:28px;height:14px;border:1px solid var(--border-color,#555);' +
      'cursor:pointer;border-radius:2px;padding:0;flex-shrink:0;background:#87CEEB;';
    swatch.addEventListener('click', () => {
      const s = this._selOf('color');
      if (!s) return;
      CeColorPicker.open(swatch, s.color, (c) => {
        s.color = c;
        swatch.style.background = c;
        this._rebuildHandles();
        this._updateCanvas();
        this._emit();
      });
    });
    el.appendChild(swatch);

    el.appendChild(this._span('Location:', 'margin-left:8px;'));
    const locIn = this._numInput(numSt, 0, 100, 0.1);
    locIn.addEventListener('change', () => {
      const s = this._selOf('color');
      if (!s) return;
      s.pos = Math.max(0, Math.min(1, (parseFloat(locIn.value) || 0) / 100));
      this._rebuildHandles();
      this._updateCanvas();
      this._emit();
    });
    el.appendChild(locIn);
    el.appendChild(this._span('%'));

    const del = this._delBtn(() => {
      if (this._colorStops.length <= 2) return;
      const idx = this._sel?.type === 'color' ? this._sel.index : -1;
      if (idx < 0) return;
      this._colorStops.splice(idx, 1);
      this._sel = null;
      this._rebuildHandles();
      this._updateCanvas();
      this._updateStopsPanel();
      this._emit();
    });
    el.appendChild(del);

    return { el, swatch, locIn };
  }

  // ── Handle management ──────────────────────────────────────────────────────

  _rebuildHandles() {
    this._opacTrack.innerHTML = '';
    this._colTrack.innerHTML  = '';
    this._opacityStops.forEach((s, i) =>
      this._opacTrack.appendChild(this._mkHandle('opacity', i, s.pos)));
    this._colorStops.forEach((s, i) =>
      this._colTrack.appendChild(this._mkHandle('color', i, s.pos)));
  }

  _mkHandle(type, index, pos) {
    const isSel  = this._sel?.type === type && this._sel?.index === index;
    const isCol  = type === 'color';

    const bgColor = isCol
      ? (this._colorStops[index]?.color ?? '#888')
      : (() => {
          const o = this._opacityStops[index]?.opacity ?? 1;
          const v = Math.round(o * 255).toString(16).padStart(2, '0');
          return `#${v}${v}${v}`;
        })();

    const ring  = isSel ? '#22ee88' : '#666';
    const arrowColor = isSel ? '#22ee88' : '#aaa';

    const wrap = document.createElement('div');
    wrap.style.cssText =
      `position:absolute;left:calc(${pos * 100}% - 7px);top:1px;` +
      `width:14px;height:18px;cursor:pointer;` +
      `display:flex;flex-direction:column;align-items:center;`;

    const box = document.createElement('div');
    box.style.cssText =
      `width:12px;height:12px;flex-shrink:0;box-sizing:border-box;` +
      `background:${bgColor};` +
      `border:${isSel ? '2px solid ' + ring : '1px solid #666'};` +
      `border-radius:1px;`;

    const tri = document.createElement('div');
    tri.style.cssText = isCol
      // colour: triangle above box, points UP toward bar
      ? `width:0;height:0;flex-shrink:0;` +
        `border-left:5px solid transparent;border-right:5px solid transparent;` +
        `border-bottom:5px solid ${arrowColor};`
      // opacity: triangle below box, points DOWN toward bar
      : `width:0;height:0;flex-shrink:0;` +
        `border-left:5px solid transparent;border-right:5px solid transparent;` +
        `border-top:5px solid ${arrowColor};`;

    if (isCol) {
      wrap.appendChild(tri);
      wrap.appendChild(box);
    } else {
      wrap.appendChild(box);
      wrap.appendChild(tri);
    }

    wrap.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this._sel = { type, index };
      this._rebuildHandles();
      this._updateStopsPanel();
      this._startDrag(e, type, index);
    });

    return wrap;
  }

  _startDrag(e, type, index) {
    const track = type === 'color' ? this._colTrack : this._opacTrack;
    const stops = type === 'color' ? this._colorStops : this._opacityStops;

    const onMove = (mv) => {
      stops[index].pos = this._trackPos(mv, track);
      this._rebuildHandles();
      this._updateCanvas();
      this._updateStopsPanel();
      this._emit();
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup',   onUp);
  }

  // ── Canvas draw ────────────────────────────────────────────────────────────

  _updateCanvas() {
    const canvas = this._canvas;
    const w = canvas.offsetWidth || 256;
    canvas.width = w;
    const h = canvas.height;
    const ctx = canvas.getContext('2d');

    // Checker background (shows transparency)
    const sq = 8;
    for (let row = 0; row < Math.ceil(h / sq); row++) {
      for (let col = 0; col < Math.ceil(w / sq); col++) {
        ctx.fillStyle = (row + col) % 2 === 0 ? '#ccc' : '#888';
        ctx.fillRect(col * sq, row * sq, sq, sq);
      }
    }

    const sorted = [...this._colorStops].sort((a, b) => a.pos - b.pos);
    if (sorted.length >= 2) {
      const g = ctx.createLinearGradient(0, 0, w, 0);
      sorted.forEach(s => { try { g.addColorStop(s.pos, s.color); } catch {} });
      ctx.fillStyle = g;
    } else if (sorted.length === 1) {
      ctx.fillStyle = sorted[0].color;
    } else {
      ctx.fillStyle = '#888';
    }
    ctx.fillRect(0, 0, w, h);
  }

  // ── Stops panel ────────────────────────────────────────────────────────────

  _updateStopsPanel() {
    const s = this._sel;

    const opSel = s?.type === 'opacity';
    this._opacRow.el.style.opacity      = opSel ? '1' : '0.4';
    this._opacRow.el.style.pointerEvents = opSel ? '' : 'none';
    if (opSel) {
      const stop = this._opacityStops[s.index];
      if (stop) {
        this._opacRow.valIn.value = Math.round(stop.opacity * 100);
        this._opacRow.locIn.value = +(stop.pos * 100).toFixed(1);
      }
    }

    const colSel = s?.type === 'color';
    this._colRow.el.style.opacity       = colSel ? '1' : '0.4';
    this._colRow.el.style.pointerEvents  = colSel ? '' : 'none';
    if (colSel) {
      const stop = this._colorStops[s.index];
      if (stop) {
        this._colRow.swatch.style.background = stop.color;
        this._colRow.locIn.value = +(stop.pos * 100).toFixed(1);
      }
    }
  }

  // ── Add stops ──────────────────────────────────────────────────────────────

  _addColStop(pos) {
    const color = this._sampleColor(pos);
    this._colorStops.push({ pos, color });
    this._colorStops.sort((a, b) => a.pos - b.pos);
    const idx = this._colorStops.findIndex(s => s.pos === pos && s.color === color);
    this._sel = { type: 'color', index: Math.max(0, idx) };
    this._rebuildHandles();
    this._updateCanvas();
    this._updateStopsPanel();
    this._emit();
  }

  _addOpacStop(pos) {
    const opacity = this._sampleOpacity(pos);
    this._opacityStops.push({ pos, opacity });
    this._opacityStops.sort((a, b) => a.pos - b.pos);
    const idx = this._opacityStops.findIndex(s => s.pos === pos);
    this._sel = { type: 'opacity', index: Math.max(0, idx) };
    this._rebuildHandles();
    this._updateCanvas();
    this._updateStopsPanel();
    this._emit();
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  _trackPos(e, el) {
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  }

  _selOf(type) {
    if (this._sel?.type !== type) return null;
    const arr = type === 'color' ? this._colorStops : this._opacityStops;
    return arr[this._sel.index] ?? null;
  }

  _sampleColor(pos) {
    const s = [...this._colorStops].sort((a, b) => a.pos - b.pos);
    if (!s.length) return '#888';
    if (pos <= s[0].pos) return s[0].color;
    if (pos >= s[s.length - 1].pos) return s[s.length - 1].color;
    for (let i = 0; i < s.length - 1; i++) {
      if (pos >= s[i].pos && pos <= s[i + 1].pos) {
        const t = (pos - s[i].pos) / (s[i + 1].pos - s[i].pos + 1e-9);
        return this._lerpHex(s[i].color, s[i + 1].color, t);
      }
    }
    return '#888';
  }

  _sampleOpacity(pos) {
    const s = [...this._opacityStops].sort((a, b) => a.pos - b.pos);
    if (!s.length) return 1;
    if (pos <= s[0].pos) return s[0].opacity;
    if (pos >= s[s.length - 1].pos) return s[s.length - 1].opacity;
    for (let i = 0; i < s.length - 1; i++) {
      if (pos >= s[i].pos && pos <= s[i + 1].pos) {
        const t = (pos - s[i].pos) / (s[i + 1].pos - s[i].pos + 1e-9);
        return s[i].opacity + (s[i + 1].opacity - s[i].opacity) * t;
      }
    }
    return 1;
  }

  _lerpHex(hex1, hex2, t) {
    const p = h => { const n = parseInt(h.replace('#', ''), 16); return [(n>>16)&255,(n>>8)&255,n&255]; };
    const [r1,g1,b1] = p(hex1); const [r2,g2,b2] = p(hex2);
    const rr = Math.round(r1+(r2-r1)*t).toString(16).padStart(2,'0');
    const gg = Math.round(g1+(g2-g1)*t).toString(16).padStart(2,'0');
    const bb = Math.round(b1+(b2-b1)*t).toString(16).padStart(2,'0');
    return `#${rr}${gg}${bb}`;
  }

  _span(text, style = '') {
    const s = document.createElement('span');
    s.textContent = text;
    if (style) s.style.cssText = style;
    return s;
  }

  _numInput(style, min, max, step) {
    const i = document.createElement('input');
    i.type = 'number'; i.min = min; i.max = max; i.step = step;
    i.style.cssText = style;
    return i;
  }

  _delBtn(onClick) {
    const b = document.createElement('button');
    b.title   = 'Delete stop';
    b.innerHTML = '&#x1F5D1;';
    b.style.cssText =
      'margin-left:auto;font-size:11px;padding:2px 7px;cursor:pointer;' +
      'background:var(--bg-secondary,#252525);border:1px solid var(--border-color,#444);' +
      'color:var(--text-primary,#e0e0e0);border-radius:3px;';
    b.addEventListener('click', onClick);
    return b;
  }

  _emit() {
    this._onChange({
      colorStops:   this._colorStops.map(s => ({ ...s })),
      opacityStops: this._opacityStops.map(s => ({ ...s })),
    });
  }
}
