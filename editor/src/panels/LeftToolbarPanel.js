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
    this._activeTool        = 'select';
    this._lastTransformTool = 'translate'; // what the cycle button currently shows for object mode
    this._physicsEditTool   = 'translate'; // current collider gizmo submode when physics edit is active
    this._viewMode          = '3d';
    this._toolBtns          = {};
    this._viewBtns          = {};
    this._floatBtn          = null;
    this._physicsEdit       = false;
    this._physicsEditBtn    = null;
    this._onPhysicsEditMode = this._onPhysicsEditMode.bind(this);
    window.addEventListener('cyco-physics-edit-mode', this._onPhysicsEditMode);
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

    // Select tool
    const selectBtn = _toolBtn(_toolIcon('select'), _toolTip('select'), () => {
      if (this._physicsEdit) {
        window.dispatchEvent(new CustomEvent('cyco-physics-edit-mode', { detail: { enabled: false } }));
      }
      this._activeTool = 'select';
      this._refreshToolBtns();
      window.dispatchEvent(new CustomEvent('cyco-vp-tool', { detail: { mode: 'select' } }));
    });
    selectBtn.dataset.tool = 'select';
    this._toolBtns['select'] = selectBtn;
    bar.appendChild(selectBtn);

    // Transform cycle toggle (translate → rotate → scale)
    // First click while NOT active: activate the shown tool (no cycle).
    // First click while ALREADY active: cycle to the next tool.
    const CYCLE = ['translate', 'rotate', 'scale', 'universal'];
    const transformBtn = _toolBtn(_toolIcon(this._lastTransformTool), _toolTip(this._lastTransformTool), () => {
      if (this._physicsEdit) {
        // Cycle the collider edit gizmo mode without switching to object transform.
        const idx = CYCLE.indexOf(this._physicsEditTool);
        this._physicsEditTool = CYCLE[(idx + 1) % CYCLE.length];
        transformBtn.innerHTML = _toolIcon(this._physicsEditTool);
        transformBtn.title = _toolTip(this._physicsEditTool);
        window.dispatchEvent(new CustomEvent('cyco-physics-vp-tool', { detail: { mode: this._physicsEditTool } }));
        return;
      }
      if (this._activeTool === this._lastTransformTool) {
        // Already on this transform — cycle to next
        const idx = CYCLE.indexOf(this._lastTransformTool);
        this._lastTransformTool = CYCLE[(idx + 1) % CYCLE.length];
      }
      // Activate the (possibly advanced) shown tool
      this._activeTool = this._lastTransformTool;
      this._refreshToolBtns();
      window.dispatchEvent(new CustomEvent('cyco-vp-tool', { detail: { mode: this._lastTransformTool } }));
    });
    transformBtn.dataset.tool = 'transform';
    this._toolBtns['transform'] = transformBtn;
    bar.appendChild(transformBtn);

    this._physicsEditBtn = _toolBtn(_toolIcon('editCollider'), 'Edit Collider', () => {
      const enabling = !this._physicsEdit;
      if (enabling) {
        this._activeTool = 'editCollider';
        this._physicsEditTool = 'translate';
      }
      window.dispatchEvent(new CustomEvent('cyco-physics-edit-mode', { detail: { enabled: enabling } }));
    });
    this._physicsEditBtn.dataset.tool = 'editCollider';
    bar.appendChild(this._physicsEditBtn);

    bar.appendChild(_toolSep());

    // 2D / 3D / UI view-mode buttons
    const VIEW_MODES = [
      { id: '2d', label: '2D', color: '#4ec9b0', title: '2D Mode' },
      { id: '3d', label: '3D', color: '#e07840', title: '3D Mode' },
      { id: 'ui', label: 'UI', color: '#9060d0', title: 'UI Mode' },
    ];
    VIEW_MODES.forEach(m => {
      const btn = _modeBtn(m.label, m.color, m.title, () => {
        this._viewMode = m.id;
        this._refreshViewBtns();
        window.dispatchEvent(new CustomEvent('cyco-vp-viewmode', { detail: m.id }));
      });
      this._viewBtns[m.id] = btn;
      bar.appendChild(btn);
    });

    // Spacer — fills remaining space so handle stays at top
    const spacer = document.createElement('div');
    spacer.style.flex = '1';
    bar.appendChild(spacer);

    bar.appendChild(_toolSep());

    // Camera View — opens CameraViewPanel as floating window
    bar.appendChild(_toolBtn(
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#e05050" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
      'Camera View',
      () => {
        const dvApi = window.__cyco?.dockviewApi;
        if (!dvApi) return;
        const existing = dvApi.getPanel('camera-view');
        if (existing) {
          existing.api.close();
        } else {
          const floating = BasePanel.getSavedFloatingState('camera-view', {
            x: 260,
            y: 90,
            width: 340,
            height: 260,
          });
          dvApi.addPanel({
            id: 'camera-view',
            component: 'CameraViewPanel',
            title: 'Camera View',
            floating,
          });
        }
      }
    ));

    bar.appendChild(_toolSep());

    // Sync button state when tool changes arrive from other systems (keyboard, etc.)
    window.addEventListener('cyco-vp-tool', (e) => {
      const { mode } = e.detail ?? {};
      if (!['select', 'translate', 'rotate', 'scale', 'universal'].includes(mode)) return;
      if (this._physicsEdit) {
        if (mode === 'select') {
          window.dispatchEvent(new CustomEvent('cyco-physics-edit-mode', { detail: { enabled: false } }));
        }
        this._refreshToolBtns();
        return;
      }
      this._activeTool = mode;
      if (['translate', 'rotate', 'scale', 'universal'].includes(mode)) {
        this._lastTransformTool = mode; // keep button showing the active transform
      }
      this._refreshToolBtns();
    });

    this._refreshToolBtns();
    this._refreshViewBtns();
    return bar;
  }

  _refreshToolBtns() {
    const CYCLE = ['translate', 'rotate', 'scale', 'universal'];
    const onCycle = CYCLE.includes(this._activeTool);
    const sb = this._toolBtns['select'];
    if (sb) sb.classList.toggle('active', !this._physicsEdit && this._activeTool === 'select');
    const tb = this._toolBtns['transform'];
    if (tb) {
      tb.classList.toggle('active', !this._physicsEdit && onCycle);
      const currentTransform = this._physicsEdit ? this._physicsEditTool : this._lastTransformTool;
      tb.innerHTML = _toolIcon(currentTransform);
      tb.title     = _toolTip(currentTransform);
    }
    if (this._physicsEditBtn) {
      this._physicsEditBtn.classList.toggle('active', this._physicsEdit);
    }
  }

  _refreshViewBtns() {
    Object.entries(this._viewBtns).forEach(([id, btn]) => {
      btn.classList.toggle('active', id === this._viewMode);
    });
  }

  _onPhysicsEditMode(event) {
    this._physicsEdit = !!event.detail?.enabled;
    if (this._physicsEdit) {
      this._activeTool = 'editCollider';
    } else if (this._activeTool === 'editCollider') {
      this._activeTool = 'select';
    }
    if (this._physicsEditBtn) {
      this._physicsEditBtn.classList.toggle('active', this._physicsEdit);
    }
    this._refreshToolBtns();
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
    case 'select': return `<svg viewBox="0 0 20 20" width="17" height="17" fill="currentColor">
      <path d="M4 2 L4 14.5 L7 11.5 L9.5 17.2 L11.5 16.2 L9 10.5 L13.5 10.5 Z"/>
    </svg>`;
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
    case 'universal': return `<svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="10" cy="10" r="5"/>
      <line x1="10" y1="2" x2="10" y2="18"/>
      <line x1="2" y1="10" x2="18" y2="10"/>
    </svg>`;
    case 'editCollider': return `<svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <path d="M5 14v1.5A1.5 1.5 0 0 0 6.5 17H14"/>
      <path d="M14 3.5a1.5 1.5 0 0 1 2.12 0l.38.38a1.5 1.5 0 0 1 0 2.12L8.5 14.5 5 15l.5-3.5L14 3.5Z"/>
      <path d="M7 13l3-3"/>
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
    case 'select':    return 'Select  Q';
    case 'translate': return 'Move  W';
    case 'rotate':    return 'Rotate  E';
    case 'scale':     return 'Scale  R';
    case 'universal': return 'Box Tool  B';
    case 'editCollider': return 'Edit Collider';
    default:          return '';
  }
}

function _modeBtn(label, color, tip, onClick) {
  const btn = document.createElement('button');
  btn.className = 'ce-vp-tool-btn ce-vp-mode-btn';
  btn.title = tip;
  btn.style.setProperty('--mode-color', color);
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}
