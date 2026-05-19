/**
 * ToolbarPanel.js — dockview panel wrapping the toolbar (Select/Move/Rotate/Scale/Play/Pause).
 * Hides the dockview tab chrome; shows compact bar only.
 * When floating: tab bar is revealed (draggable for re-docking).
 */

import { BasePanel }    from './BasePanel.js';
import { createToolbar } from '../ui/Toolbar.js';

export class ToolbarPanel extends BasePanel {
  constructor() {
    super();
    this._floatBtn = null;
  }

  _buildContent() {
    return createToolbar({ noFloatBtn: true });
  }

  get _floatDimensions() {
    return { width: Math.max(window.innerWidth - 4, 800), height: this._barHeight };
  }

  /** Grip icon: 6 dots in a 2×3 pattern — standard drag-handle visual. */
  _getDockedIcon() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="14" viewBox="0 0 12 14" fill="currentColor"><circle cx="4" cy="2.5" r="1.3"/><circle cx="8" cy="2.5" r="1.3"/><circle cx="4" cy="7" r="1.3"/><circle cx="8" cy="7" r="1.3"/><circle cx="4" cy="11.5" r="1.3"/><circle cx="8" cy="11.5" r="1.3"/></svg>`;
  }
  _getDockedTitle()   { return 'Drag to float  /  click to toggle'; }
  _getFloatingTitle() { return 'Drag to move  /  click to snap back'; }

  _addHeaderActions(api) {
    requestAnimationFrame(() => {
      const groupView = this._findGroupView();
      if (!groupView) return;

      groupView.classList.add('ce-bar-panel-group', 'ce-toolbar-group', 'ce-bar-tab-hidden');

      // Inject drag handle at the far right of the toolbar (only once)
      const barEl = this._el.querySelector('#toolbar');
      if (!barEl || barEl.querySelector('.ce-bar-panel-actions')) return;

      const wrap = document.createElement('div');
      wrap.className = 'ce-bar-panel-actions';

      const handle = this._createDragHandle();
      wrap.appendChild(handle);
      barEl.appendChild(wrap);
      this._floatBtn = handle; // keep same ref name — onDidLocationChange uses it
      this._setupBarDrag(barEl);
    });
  }

  get _barHeight() { return 32; }

  init(params) {
    super.init(params);

    // Only apply height constraints immediately for horizontal placement.
    // For vertical (vp-left/vp-right snap), we let height fill the column so
    // the orientation detection in onDidLocationChange can work correctly.
    if (this._expectedOrientation !== 'vertical') {
      params.api.group.api.setConstraints({ minimumHeight: this._barHeight, maximumHeight: this._barHeight });
    }

    // fromJSON does NOT fire onDidLocationChange for freshly-created panels.
    // If _pendingOrient set a hint (read by super.init()), apply orientation now.
    if (this._expectedOrientation === 'vertical') {
      setTimeout(() => {
        const groupApi = params.api.group?.api;
        const groupView = this._findGroupView();
        groupView?.classList.add('ce-bar-panel-group', 'ce-toolbar-group', 'ce-bar-tab-hidden');
        groupView?.classList.add('ce-bar-vertical');
        groupApi?.setConstraints({ minimumWidth: this._barHeight, maximumWidth: this._barHeight });
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
          const groupApi = params.api.group?.api;
          const groupView = this._findGroupView();
          groupView?.classList.add('ce-bar-panel-group', 'ce-toolbar-group', 'ce-bar-tab-hidden');

          // Use orientation hint if set by _dockAtZone, else detect from rect
          let isVertical = false;
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
        // Floating — apply bar classes to the NEW floating group view so the bar
        // looks identical to when docked (no dockview tab chrome visible).
        if (this._floatBtn) this._updateFloatBtn(this._floatBtn);
        setTimeout(() => {
          const groupApi = params.api.group?.api;
          const groupView = this._findGroupView();
          groupApi?.setConstraints({ minimumHeight: this._barHeight, maximumHeight: this._barHeight });
          groupApi?.setSize({ height: this._barHeight });
          groupView?.classList.add('ce-bar-panel-group', 'ce-toolbar-group', 'ce-bar-tab-hidden');
          // Direct DOM fix — dockview's setSize() does not reliably resize the
          // floating container when restoring from a saved layout via fromJSON.
          this._fixFloatingSize();
        }, 0);
      }
    });
  }

  _toggleFloat(btn) {
    super._toggleFloat(btn);
  }
}
