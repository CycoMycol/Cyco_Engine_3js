/**
 * LeftToolbarPanel.js — viewport tool sidebar as a proper dockview panel.
 * Naturally vertical (36 px wide); flips to horizontal when docked top/bottom.
 * Fires document events so other panels can react to tool/mode changes:
 *   'cyco-vp-tool'   detail = tool id ('translate'|'rotate'|'scale'|'rect')
 *   'cyco-vp-world'  detail = boolean (true = world, false = local)
 *   'cyco-vp-snap'   detail = boolean (enabled)
 *   'cyco-vp-focus'  (no detail)
 */

import { BasePanel } from './BasePanel.js';

export class LeftToolbarPanel extends BasePanel {
  constructor() {
    super();
    this._activeTool  = 'translate';
    this._worldSpace  = true;
    this._snapEnabled = false;
    this._toolBtns    = {};
    this._worldBtn    = null;
    this._snapBtn     = null;
    this._floatBtn    = null;
  }

  // ── Abstract getters ────────────────────────────────────────────────────────

  get _barHeight() { return 36; }

  get _floatDimensions() {
    return { width: this._barHeight, height: Math.min(window.innerHeight - 80, 380) };
  }

  _getDockedIcon() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="14" viewBox="0 0 12 14" fill="currentColor"><circle cx="4" cy="2.5" r="1.3"/><circle cx="8" cy="2.5" r="1.3"/><circle cx="4" cy="7" r="1.3"/><circle cx="8" cy="7" r="1.3"/><circle cx="4" cy="11.5" r="1.3"/><circle cx="8" cy="11.5" r="1.3"/></svg>`;
  }
  _getDockedTitle()   { return 'Drag to float  /  click to toggle'; }
  _getFloatingTitle() { return 'Drag to move  /  click to snap back'; }

  // ── Content ─────────────────────────────────────────────────────────────────

  _buildContent() {
    const bar = document.createElement('div');
    bar.className = 'ce-vp-lefttool';
    bar.id        = 'left-toolbar';

    bar.appendChild(_toolSep());

    // Transform cycle toggle (translate → rotate → scale)
    const CYCLE = ['translate', 'rotate', 'scale'];
    const cycleId = CYCLE.includes(this._activeTool) ? this._activeTool : 'translate';
    const transformBtn = _toolBtn(_toolIcon(cycleId), _toolTip(cycleId), () => {
      const cur  = CYCLE.includes(this._activeTool) ? this._activeTool : 'translate';
      const next = CYCLE[(CYCLE.indexOf(cur) + 1) % CYCLE.length];
      this._activeTool = next;
      this._refreshToolBtns();
      document.dispatchEvent(new CustomEvent('cyco-vp-tool', { detail: next }));
    });
    transformBtn.dataset.tool = 'transform';
    this._toolBtns['transform'] = transformBtn;
    bar.appendChild(transformBtn);

    // Rect Transform
    const rectBtn = _toolBtn(_toolIcon('rect'), 'Rect Transform  T', () => {
      this._activeTool = 'rect';
      this._refreshToolBtns();
      document.dispatchEvent(new CustomEvent('cyco-vp-tool', { detail: 'rect' }));
    });
    rectBtn.dataset.tool = 'rect';
    this._toolBtns['rect'] = rectBtn;
    bar.appendChild(rectBtn);

    bar.appendChild(_toolSep());

    // World / Local toggle
    this._worldBtn = _toolBtn(_toolIcon('world'), 'World Space', () => {
      this._worldSpace = !this._worldSpace;
      this._worldBtn.title     = this._worldSpace ? 'World Space' : 'Local Space';
      this._worldBtn.innerHTML = _toolIcon(this._worldSpace ? 'world' : 'local');
      this._worldBtn.classList.toggle('active', !this._worldSpace);
      document.dispatchEvent(new CustomEvent('cyco-vp-world', { detail: this._worldSpace }));
    });
    bar.appendChild(this._worldBtn);

    // Snap toggle
    this._snapBtn = _toolBtn(_toolIcon('snap'), 'Toggle Grid Snapping', () => {
      this._snapEnabled = !this._snapEnabled;
      this._snapBtn.classList.toggle('active', this._snapEnabled);
      document.dispatchEvent(new CustomEvent('cyco-vp-snap', { detail: this._snapEnabled }));
    });
    bar.appendChild(this._snapBtn);

    bar.appendChild(_toolSep());

    // Focus
    bar.appendChild(_toolBtn(_toolIcon('focus'), 'Focus Selection  F', () => {
      document.dispatchEvent(new CustomEvent('cyco-vp-focus'));
    }));

    // Spacer — fills remaining space so handle stays at top
    const spacer = document.createElement('div');
    spacer.style.flex = '1';
    bar.appendChild(spacer);

    this._refreshToolBtns();
    return bar;
  }

  _refreshToolBtns() {
    const CYCLE = ['translate', 'rotate', 'scale'];
    const onCycle = CYCLE.includes(this._activeTool);
    const cycleId  = onCycle ? this._activeTool : 'translate';
    const tb = this._toolBtns['transform'];
    if (tb) {
      tb.classList.toggle('active', onCycle);
      tb.innerHTML = _toolIcon(cycleId);
      tb.title     = _toolTip(cycleId);
    }
    const rb = this._toolBtns['rect'];
    if (rb) rb.classList.toggle('active', this._activeTool === 'rect');
  }

  // ── Header actions (drag handle) ────────────────────────────────────────────

  _addHeaderActions(api) {
    requestAnimationFrame(() => {
      const groupView = this._findGroupView();
      if (!groupView) return;

      groupView.classList.add('ce-left-toolbar-group', 'ce-bar-tab-hidden');
      // Default orientation is vertical — add ce-bar-vertical unless we know it's horizontal
      if (this._expectedOrientation !== 'horizontal') {
        groupView.classList.add('ce-bar-vertical');
      }

      const barEl = this._el.querySelector('#left-toolbar');
      if (!barEl || barEl.querySelector('.ce-bar-panel-actions')) return;

      const wrap = document.createElement('div');
      wrap.className = 'ce-bar-panel-actions';

      const handle = this._createDragHandle();
      wrap.appendChild(handle);
      // Prepend — drag handle sits at the TOP of the vertical bar
      barEl.insertBefore(wrap, barEl.firstChild);
      this._floatBtn = handle;
      this._setupBarDrag(barEl);
    });
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  init(params) {
    super.init(params);

    // Default orientation is VERTICAL (36 px wide).
    // Only skip the width constraint when explicitly placed horizontally.
    if (this._expectedOrientation !== 'horizontal') {
      params.api.group.api.setConstraints({
        minimumWidth: this._barHeight,
        maximumWidth: this._barHeight,
      });
    }

    // fromJSON does NOT fire onDidLocationChange — apply orientation hint now.
    if (this._expectedOrientation === 'horizontal') {
      setTimeout(() => {
        const groupApi  = params.api.group?.api;
        const groupView = this._findGroupView();
        groupView?.classList.add('ce-left-toolbar-group', 'ce-bar-tab-hidden');
        groupView?.classList.remove('ce-bar-vertical');
        groupApi?.setConstraints({ minimumHeight: this._barHeight, maximumHeight: this._barHeight });
        groupApi?.setSize({ height: this._barHeight });
        this._expectedOrientation = null;
      }, 0);
    } else if (this._expectedOrientation === 'vertical') {
      setTimeout(() => {
        const groupApi  = params.api.group?.api;
        const groupView = this._findGroupView();
        groupView?.classList.add('ce-left-toolbar-group', 'ce-bar-tab-hidden', 'ce-bar-vertical');
        groupApi?.setSize({ width: this._barHeight });
        this._expectedOrientation = null;
      }, 0);
    }

    params.api.onDidLocationChange((event) => {
      const isNowFloating = event.location?.type === 'floating';
      this._floating = isNowFloating;

      if (!isNowFloating) {
        if (this._floatBtn) this._updateFloatBtn(this._floatBtn);
        setTimeout(() => {
          const groupApi  = params.api.group?.api;
          const groupView = this._findGroupView();
          groupView?.classList.add('ce-left-toolbar-group', 'ce-bar-tab-hidden');

          // Use orientation hint if set by _dockAtZone, else detect from rect
          let isVertical;
          if (this._expectedOrientation === 'vertical') {
            isVertical = true;
          } else if (this._expectedOrientation === 'horizontal') {
            isVertical = false;
          } else {
            const rect = groupView?.getBoundingClientRect();
            isVertical = !!(rect && rect.width > 0 && rect.height > rect.width);
          }
          this._expectedOrientation = null;

          groupView?.classList.toggle('ce-bar-vertical', isVertical);

          if (isVertical) {
            groupApi?.setConstraints({ minimumWidth: this._barHeight, maximumWidth: this._barHeight });
            groupApi?.setSize({ width: this._barHeight });
          } else {
            groupApi?.setConstraints({ minimumHeight: this._barHeight, maximumHeight: this._barHeight });
            groupApi?.setSize({ height: this._barHeight });
          }
        }, 0);
      } else {
        // Floating — show as a vertical bar
        if (this._floatBtn) this._updateFloatBtn(this._floatBtn);
        setTimeout(() => {
          const groupApi  = params.api.group?.api;
          const groupView = this._findGroupView();
          groupView?.classList.add('ce-left-toolbar-group', 'ce-bar-vertical', 'ce-bar-tab-hidden');
          groupApi?.setConstraints({ minimumWidth: this._barHeight, maximumWidth: this._barHeight });
          this._fixFloatingSize();
        }, 0);
      }
    });
  }

  _toggleFloat(btn) {
    super._toggleFloat(btn);
  }
}

// ── Private helpers (mirrors of helpers in CenterPanel.js) ───────────────────

function _toolSep() {
  const s = document.createElement('div');
  s.className = 'ce-vp-tool-sep';
  return s;
}

function _toolBtn(svgHtml, tip, onClick) {
  const btn = document.createElement('button');
  btn.className = 'ce-vp-tool-btn';
  btn.title = tip;
  btn.innerHTML = svgHtml;
  btn.addEventListener('click', onClick);
  return btn;
}

function _toolIcon(id) {
  switch (id) {
    case 'translate': return `<svg viewBox="0 0 20 20" width="17" height="17" fill="currentColor">
      <path d="M10 1.5 L8 5H9.5V9.5H5V8L1.5 10 5 12V10.5H9.5V15H8L10 18.5 12 15H10.5V10.5H15V12L18.5 10 15 8V9.5H10.5V5H12Z"/>
    </svg>`;
    case 'rotate': return `<svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <path d="M15.5 6.5A7 7 0 1 0 17 10.5"/>
      <polyline points="13.5,3 17,6.5 13.5,8.5" fill="currentColor" stroke="none"/>
    </svg>`;
    case 'scale': return `<svg viewBox="0 0 20 20" width="17" height="17" fill="currentColor">
      <path d="M12.5 2.5H17.5V7.5L15.5 5.5 10.5 10.5 9.5 9.5 14.5 4.5Z"/>
      <path d="M7.5 17.5H2.5V12.5L4.5 14.5 9.5 9.5 10.5 10.5 5.5 15.5Z"/>
    </svg>`;
    case 'rect': return `<svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="3 2">
      <rect x="3.5" y="3.5" width="13" height="13" rx="1"/>
      <circle cx="3.5" cy="3.5" r="1.8" fill="currentColor" stroke="none"/>
      <circle cx="16.5" cy="3.5" r="1.8" fill="currentColor" stroke="none"/>
      <circle cx="3.5" cy="16.5" r="1.8" fill="currentColor" stroke="none"/>
      <circle cx="16.5" cy="16.5" r="1.8" fill="currentColor" stroke="none"/>
    </svg>`;
    case 'world': return `<svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.4">
      <circle cx="10" cy="10" r="7.5"/>
      <ellipse cx="10" cy="10" rx="3.8" ry="7.5"/>
      <line x1="2.5" y1="10" x2="17.5" y2="10"/>
      <line x1="3.2" y1="6.5" x2="16.8" y2="6.5"/>
      <line x1="3.2" y1="13.5" x2="16.8" y2="13.5"/>
    </svg>`;
    case 'local': return `<svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke-width="2" stroke-linecap="round">
      <line x1="10" y1="10" x2="17" y2="10" stroke="#e07228"/>
      <line x1="10" y1="10" x2="10" y2="3" stroke="#6ab26a"/>
      <line x1="10" y1="10" x2="4" y2="15" stroke="#4d93e8"/>
      <circle cx="10" cy="10" r="1.8" fill="currentColor" stroke="currentColor"/>
    </svg>`;
    case 'snap': return `<svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round">
      <path d="M5.5 3 L5.5 11 A4.5 4.5 0 0 0 14.5 11 L14.5 3"/>
    </svg>`;
    case 'focus': return `<svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
      <circle cx="10" cy="10" r="3"/>
      <line x1="10" y1="2" x2="10" y2="5"/>
      <line x1="10" y1="15" x2="10" y2="18"/>
      <line x1="2" y1="10" x2="5" y2="10"/>
      <line x1="15" y1="10" x2="18" y2="10"/>
    </svg>`;
    default: return '';
  }
}

function _toolTip(id) {
  switch (id) {
    case 'translate': return 'Translate  W';
    case 'rotate':    return 'Rotate  E';
    case 'scale':     return 'Scale  R';
    case 'rect':      return 'Rect Transform  T';
    default:          return '';
  }
}
