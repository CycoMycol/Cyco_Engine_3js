/**
 * ViewportStats.js
 * Displays a lightweight performance overlay inside the viewport:
 *   FPS • Frame time (ms) • Triangle count • Draw calls
 *
 * Depends on: ViewportEngine (injected)
 *
 * Events consumed:
 *   cyco-vp-tick          { delta }   — update stats each frame
 *   cyco-rvp-stats-toggle             — show/hide the overlay
 */

export class ViewportStats {
  /**
   * @param {import('./ViewportEngine.js').ViewportEngine} viewportEngine
   */
  constructor(viewportEngine) {
    this.engine  = viewportEngine;
    this.visible = false;
    this._el     = null;

    this._fpsBuffer   = new Float32Array(60);
    this._bufferIndex = 0;
    this._frameCount  = 0;
    this._elapsed     = 0;

    this._build();

    this._onTick   = this._onTick.bind(this);
    this._onToggle = this._onToggle.bind(this);
    window.addEventListener('cyco-vp-tick',          this._onTick);
    window.addEventListener('cyco-rvp-stats-toggle', this._onToggle);
  }

  // ─── Build DOM ────────────────────────────────────────────────────────────

  _build() {
    const el = document.createElement('div');
    el.id = 'cyco-vp-stats';
    Object.assign(el.style, {
      position:       'absolute',
      top:            '8px',
      left:           '8px',
      zIndex:         '100',
      background:     'rgba(0,0,0,0.55)',
      color:          '#e8e8e8',
      fontFamily:     'monospace',
      fontSize:       '11px',
      lineHeight:     '1.6',
      padding:        '4px 8px',
      borderRadius:   '4px',
      pointerEvents:  'none',
      display:        'none',
      whiteSpace:     'pre',
      backdropFilter: 'blur(4px)',
    });
    this._el = el;

    // Attach to the viewport container when it exists
    const attach = () => {
      const container = this.engine._container;
      if (container) {
        container.style.position = 'relative'; // ensure positioning context
        container.appendChild(el);
      } else {
        setTimeout(attach, 100);
      }
    };
    attach();
  }

  // ─── Event handlers ───────────────────────────────────────────────────────

  _onToggle() {
    this.visible = !this.visible;
    this._el.style.display = this.visible ? 'block' : 'none';
  }

  _onTick(event) {
    if (!this.visible) return;
    const { delta } = event.detail;
    if (!delta || delta <= 0) return;

    const fps = 1 / delta;
    this._fpsBuffer[this._bufferIndex++ % 60] = fps;

    this._elapsed += delta;
    this._frameCount++;

    // Update display at ~10 Hz
    if (this._elapsed < 0.1) return;
    this._elapsed = 0;

    const avgFps = this._fpsBuffer.reduce((a, b) => a + b, 0) /
                   Math.min(this._frameCount, 60);
    const frameMs = (delta * 1000).toFixed(2);

    const renderer = this.engine.rendererManager?.renderer;
    let tris = 0;
    let calls = 0;
    if (renderer?.info) {
      tris  = renderer.info.render.triangles;
      calls = renderer.info.render.calls;
    }

    this._el.textContent = [
      `FPS  ${avgFps.toFixed(1).padStart(7)}`,
      `ms   ${frameMs.padStart(7)}`,
      `△    ${String(tris).padStart(7)}`,
      `DC   ${String(calls).padStart(7)}`,
    ].join('\n');
  }

  // ─── Disposal ─────────────────────────────────────────────────────────────

  dispose() {
    window.removeEventListener('cyco-vp-tick',          this._onTick);
    window.removeEventListener('cyco-rvp-stats-toggle', this._onToggle);
    this._el?.parentNode?.removeChild(this._el);
  }
}
