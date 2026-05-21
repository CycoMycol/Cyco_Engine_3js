/**
 * RightViewportPanel.js - Right-side viewport tool sidebar, independent of the left toolbar.
 * Mirrors LeftToolbarPanel: Translate, Rotate, Scale, Rect, World/Local, Snap, Focus.
 */

import { BasePanel } from './BasePanel.js';

export class RightViewportPanel extends BasePanel {
  constructor() {
    super();
    this._worldSpace  = true;
    this._snapEnabled = false;
    this._worldBtn    = null;
    this._snapBtn     = null;
    this._floatBtn    = null;
  }

  get _barHeight() { return 36; }

  get _floatDimensions() {
    return { width: this._barHeight, height: Math.min(window.innerHeight - 80, 380) };
  }

  _getDockedIcon() {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="14" viewBox="0 0 12 14" fill="currentColor"><circle cx="4" cy="2.5" r="1.3"/><circle cx="8" cy="2.5" r="1.3"/><circle cx="4" cy="7" r="1.3"/><circle cx="8" cy="7" r="1.3"/><circle cx="4" cy="11.5" r="1.3"/><circle cx="8" cy="11.5" r="1.3"/></svg>';
  }
  _getDockedTitle()   { return 'Drag to float  /  click to toggle'; }
  _getFloatingTitle() { return 'Drag to move  /  click to snap back'; }

  _buildContent() {
    const bar = document.createElement('div');
    bar.className = 'ce-vp-lefttool';
    bar.id        = 'right-toolbar';

    bar.appendChild(_toolSep());

    // Stats toggle
    const statsBtn = _toolBtn(
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="2" y="13" width="4" height="9" rx="1"/><rect x="10" y="7" width="4" height="15" rx="1"/><rect x="18" y="2" width="4" height="20" rx="1"/></svg>',
      'Toggle Stats',
      () => {
        const dvApi = window.__cyco?.dockviewApi;
        if (!dvApi) return;
        const existing = dvApi.getPanel('stats-panel');
        if (existing) {
          existing.api.close();
        } else {
          dvApi.addPanel({
            id:        'stats-panel',
            component: 'StatsPanel',
            title:     'Stats',
            position:  { referencePanel: 'properties', direction: 'below' },
          });
        }
      }
    );
    bar.appendChild(statsBtn);

    bar.appendChild(_toolSep());

    // Main Camera & Global Light quick-select buttons
    bar.appendChild(_toolBtn(_cameraIcon(), 'Main Camera', () => {
      document.dispatchEvent(new CustomEvent('cyco-select-node', { detail: 'main-camera' }));
    }));

    bar.appendChild(_toolBtn(_lightIcon(), 'Global Light', () => {
      document.dispatchEvent(new CustomEvent('cyco-select-node', { detail: 'env-light' }));
    }));

    bar.appendChild(_toolSep());

    this._worldBtn = _toolBtn(_toolIcon('world'), 'World Space', () => {
      this._worldSpace = !this._worldSpace;
      this._worldBtn.title     = this._worldSpace ? 'World Space' : 'Local Space';
      this._worldBtn.innerHTML = _toolIcon(this._worldSpace ? 'world' : 'local');
      this._worldBtn.classList.toggle('active', !this._worldSpace);
      document.dispatchEvent(new CustomEvent('cyco-rvp-world', { detail: this._worldSpace }));
    });
    bar.appendChild(this._worldBtn);

    this._snapBtn = _toolBtn(_toolIcon('snap'), 'Toggle Grid Snapping', () => {
      this._snapEnabled = !this._snapEnabled;
      this._snapBtn.classList.toggle('active', this._snapEnabled);
      document.dispatchEvent(new CustomEvent('cyco-rvp-snap', { detail: this._snapEnabled }));
    });
    bar.appendChild(this._snapBtn);

    bar.appendChild(_toolSep());

    bar.appendChild(_toolBtn(_toolIcon('focus'), 'Focus Selection  F', () => {
      document.dispatchEvent(new CustomEvent('cyco-rvp-focus'));
    }));

    const spacer = document.createElement('div');
    spacer.style.flex = '1';
    bar.appendChild(spacer);

    return bar;
  }

  _addHeaderActions(api) {
    requestAnimationFrame(() => {
      const groupView = this._findGroupView();
      if (!groupView) return;

      groupView.classList.add('ce-left-toolbar-group', 'ce-bar-tab-hidden');
      if (this._expectedOrientation !== 'horizontal') {
        groupView.classList.add('ce-bar-vertical');
      }

      const barEl = this._el.querySelector('#right-toolbar');
      if (!barEl || barEl.querySelector('.ce-bar-panel-actions')) return;

      const wrap = document.createElement('div');
      wrap.className = 'ce-bar-panel-actions';
      const handle = this._createDragHandle();
      wrap.appendChild(handle);
      barEl.insertBefore(wrap, barEl.firstChild);
      this._floatBtn = handle;
      this._setupBarDrag(barEl);
    });
  }

  init(params) {
    super.init(params);

    if (this._expectedOrientation !== 'horizontal') {
      params.api.group.api.setConstraints({
        minimumWidth: this._barHeight,
        maximumWidth: this._barHeight,
      });
    }

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

// -- Private helpers --

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
    case 'translate': return '<svg viewBox="0 0 20 20" width="17" height="17" fill="currentColor"><path d="M10 1.5 L8 5H9.5V9.5H5V8L1.5 10 5 12V10.5H9.5V15H8L10 18.5 12 15H10.5V10.5H15V12L18.5 10 15 8V9.5H10.5V5H12Z"/></svg>';
    case 'rotate':    return '<svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15.5 6.5A7 7 0 1 0 17 10.5"/><polyline points="13.5,3 17,6.5 13.5,8.5" fill="currentColor" stroke="none"/></svg>';
    case 'scale':     return '<svg viewBox="0 0 20 20" width="17" height="17" fill="currentColor"><path d="M12.5 2.5H17.5V7.5L15.5 5.5 10.5 10.5 9.5 9.5 14.5 4.5Z"/><path d="M7.5 17.5H2.5V12.5L4.5 14.5 9.5 9.5 10.5 10.5 5.5 15.5Z"/></svg>';
    case 'rect':      return '<svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="3 2"><rect x="3.5" y="3.5" width="13" height="13" rx="1"/><circle cx="3.5" cy="3.5" r="1.8" fill="currentColor" stroke="none"/><circle cx="16.5" cy="3.5" r="1.8" fill="currentColor" stroke="none"/><circle cx="3.5" cy="16.5" r="1.8" fill="currentColor" stroke="none"/><circle cx="16.5" cy="16.5" r="1.8" fill="currentColor" stroke="none"/></svg>';
    case 'world':     return '<svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="10" cy="10" r="7.5"/><ellipse cx="10" cy="10" rx="3.8" ry="7.5"/><line x1="2.5" y1="10" x2="17.5" y2="10"/><line x1="3.2" y1="6.5" x2="16.8" y2="6.5"/><line x1="3.2" y1="13.5" x2="16.8" y2="13.5"/></svg>';
    case 'local':     return '<svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke-width="2" stroke-linecap="round"><line x1="10" y1="10" x2="17" y2="10" stroke="#e07228"/><line x1="10" y1="10" x2="10" y2="3" stroke="#6ab26a"/><line x1="10" y1="10" x2="4" y2="15" stroke="#4d93e8"/><circle cx="10" cy="10" r="1.8" fill="currentColor" stroke="currentColor"/></svg>';
    case 'snap':      return '<svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"><path d="M5.5 3 L5.5 11 A4.5 4.5 0 0 0 14.5 11 L14.5 3"/></svg>';
    case 'focus':     return '<svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><circle cx="10" cy="10" r="3"/><line x1="10" y1="2" x2="10" y2="5"/><line x1="10" y1="15" x2="10" y2="18"/><line x1="2" y1="10" x2="5" y2="10"/><line x1="15" y1="10" x2="18" y2="10"/></svg>';
    default: return '';
  }
}

function _cameraIcon() {
  return '<svg viewBox="0 0 14 14" width="15" height="15" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="4" width="9" height="7" rx="1" fill="#4ec9b0"/><polygon points="10,5.5 13,4 13,10 10,8.5" fill="#4ec9b0"/><circle cx="5.5" cy="7.5" r="2" fill="#1c3c38" opacity="0.55"/><circle cx="5.5" cy="7.5" r="0.9" fill="#4ec9b0" opacity="0.5"/></svg>';
}

function _lightIcon() {
  return '<svg viewBox="0 0 14 14" width="15" height="15" xmlns="http://www.w3.org/2000/svg"><circle cx="7" cy="5.5" r="2.8" fill="#f0c040"/><rect x="5.5" y="8.8" width="3" height="1" rx="0.5" fill="#f0c040"/><rect x="6" y="10.2" width="2" height="1.2" rx="0.5" fill="#d4a820"/><line x1="7" y1="1" x2="7" y2="2" stroke="#f0c040" stroke-width="1.2" stroke-linecap="round"/><line x1="10.5" y1="5.5" x2="11.5" y2="5.5" stroke="#f0c040" stroke-width="1.2" stroke-linecap="round"/><line x1="2.5" y1="5.5" x2="3.5" y2="5.5" stroke="#f0c040" stroke-width="1.2" stroke-linecap="round"/><line x1="9.5" y1="2.5" x2="10.2" y2="1.8" stroke="#f0c040" stroke-width="1.2" stroke-linecap="round"/><line x1="4.5" y1="2.5" x2="3.8" y2="1.8" stroke="#f0c040" stroke-width="1.2" stroke-linecap="round"/></svg>';
}
