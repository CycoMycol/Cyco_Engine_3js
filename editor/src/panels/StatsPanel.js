/**
 * StatsPanel.js — dockable performance stats panel.
 * Opened / closed by the Toggle Stats button in RightViewportPanel.
 * Docks below the Properties panel by default.
 *
 * Events consumed:
 *   cyco-vp-tick  { delta }  — update stats each frame
 */

import { BasePanel } from './BasePanel.js';

const GRAPH_W = 200;
const GRAPH_H = 48;
const HISTORY = 120;   // rolling sample count
const MAX_FPS = 200;

export class StatsPanel extends BasePanel {
  constructor() {
    super();
    this._fpsHistory = new Float32Array(HISTORY);
    this._histIdx    = 0;
    this._elapsed    = 0;
    this._canvas     = null;
    this._rows       = {};
    this._onTick     = this._onTick.bind(this);
  }

  // ── No float / dock button for this panel ─────────────────────────────────

  _addHeaderActions() {}

  // ── Content ───────────────────────────────────────────────────────────────

  _buildContent() {
    const root = document.createElement('div');
    root.style.cssText = [
      'display:flex',
      'flex-direction:column',
      'height:100%',
      'padding:8px',
      'box-sizing:border-box',
      'gap:6px',
      'overflow:hidden',
    ].join(';');

    // ── Sparkline canvas ────────────────────────────────────────────────────
    const canvas = document.createElement('canvas');
    canvas.width  = GRAPH_W;
    canvas.height = GRAPH_H;
    canvas.style.cssText = `width:100%;height:${GRAPH_H}px;display:block;border-radius:3px;background:rgba(0,0,0,0.3);`;
    this._canvas = canvas;
    root.appendChild(canvas);

    // ── Stats rows ──────────────────────────────────────────────────────────
    const grid = document.createElement('div');
    grid.style.cssText = [
      'display:grid',
      'grid-template-columns:28px 1fr',
      'gap:2px 6px',
      'font-family:monospace',
      'font-size:11px',
      'color:#e8e8e8',
      'line-height:1.55',
    ].join(';');

    const ROWS = [
      ['fps',  'FPS', '#e07228'],
      ['ms',   'ms',  '#aaa'],
      ['tris', '△',   '#aaa'],
      ['dc',   'DC',  '#aaa'],
    ];

    for (const [key, label, color] of ROWS) {
      const lbl = document.createElement('span');
      lbl.textContent = label;
      lbl.style.cssText = `color:${color};text-align:right;`;

      const val = document.createElement('span');
      val.textContent = '—';
      val.style.cssText = 'text-align:right;font-weight:600;padding-left:4px;';
      this._rows[key] = val;

      grid.appendChild(lbl);
      grid.appendChild(val);
    }

    root.appendChild(grid);

    window.addEventListener('cyco-vp-tick', this._onTick);
    return root;
  }

  // ── Tick ──────────────────────────────────────────────────────────────────

  _onTick(e) {
    const delta = e.detail?.delta;
    if (!delta || delta <= 0) return;

    const fps = 1 / delta;
    this._fpsHistory[this._histIdx % HISTORY] = fps;
    this._histIdx++;
    this._elapsed += delta;

    if (this._elapsed < 0.1) return;   // update display at ~10 Hz
    this._elapsed = 0;

    const samples = Math.min(this._histIdx, HISTORY);
    let sum = 0;
    for (let i = 0; i < samples; i++) sum += this._fpsHistory[i];
    const avgFps  = (sum / samples).toFixed(1);
    const frameMs = (delta * 1000).toFixed(2);

    const renderer = window.__cyco?.viewportEngine?.rendererManager?.renderer;
    const tris  = renderer?.info?.render?.triangles ?? 0;
    const calls = renderer?.info?.render?.calls     ?? 0;

    this._rows.fps.textContent  = avgFps;
    this._rows.ms.textContent   = frameMs;
    this._rows.tris.textContent = tris.toLocaleString();
    this._rows.dc.textContent   = calls.toString();

    this._drawSparkline();
  }

  // ── Sparkline ─────────────────────────────────────────────────────────────

  _drawSparkline() {
    const canvas = this._canvas;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const w   = GRAPH_W;
    const h   = GRAPH_H;

    ctx.clearRect(0, 0, w, h);

    const samples = Math.min(this._histIdx, HISTORY);
    if (samples < 2) return;

    const step = w / (samples - 1);

    // 60 FPS reference line
    const y60 = h - (60 / MAX_FPS) * h;
    ctx.beginPath();
    ctx.moveTo(0, y60);
    ctx.lineTo(w, y60);
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);

    // FPS sparkline
    ctx.beginPath();
    for (let i = 0; i < samples; i++) {
      const idx = (this._histIdx - samples + i) % HISTORY;
      const y = h - Math.min(this._fpsHistory[idx] / MAX_FPS, 1) * h;
      if (i === 0) ctx.moveTo(0, y);
      else ctx.lineTo(i * step, y);
    }
    ctx.strokeStyle = '#e07228';
    ctx.lineWidth   = 1.5;
    ctx.stroke();

    // Fill under the line
    ctx.lineTo((samples - 1) * step, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fillStyle = 'rgba(224,114,40,0.15)';
    ctx.fill();
  }

  // ── Disposal ──────────────────────────────────────────────────────────────

  dispose() {
    window.removeEventListener('cyco-vp-tick', this._onTick);
    this._canvas = null;
  }
}
