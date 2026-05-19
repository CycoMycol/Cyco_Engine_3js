/**
 * MenuBarPanel.js — dockview panel wrapping the menu bar (File/Edit/View/Layout/…).
 * Hides the dockview tab chrome; shows compact bar only.
 * When floating: tab bar is revealed (draggable for re-docking).
 */

import { BasePanel }    from './BasePanel.js';
import { createMenuBar, createLayoutButton } from '../ui/MenuBar.js';

export class MenuBarPanel extends BasePanel {
  constructor() {
    super();
    this._floatBtn = null;
  }

  _buildContent() {
    return createMenuBar({ noFloatBtn: true });
  }

  get _floatDimensions() {
    // Height = barHeight so the floating group stays as compact as when docked
    return { width: Math.max(window.innerWidth - 4, 600), height: this._barHeight };
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

      // Mark group for CSS targeting; hide tab bar (bar itself is the full UI)
      groupView.classList.add('ce-bar-panel-group', 'ce-menu-bar-group', 'ce-bar-tab-hidden');

      // Inject drag handle into the bar's right section (only once)
      const rightEl = this._el.querySelector('#menu-bar .menu-right');
      if (!rightEl || rightEl.querySelector('.ce-bar-panel-actions')) return;

      const wrap = document.createElement('div');
      wrap.className = 'ce-bar-panel-actions';

      const layoutBtn = createLayoutButton();
      wrap.appendChild(layoutBtn);

      const handle = this._createDragHandle();
      wrap.appendChild(handle);
      rightEl.appendChild(wrap);
      this._floatBtn = handle; // keep same ref name — onDidLocationChange uses it
      this._setupBarDrag(this._el.querySelector('#menu-bar'));
    });
  }

  get _barHeight() { return 30; }

  init(params) {
    super.init(params);

    // Set constraints synchronously so dockview's ResizeObserver respects bar height.
    // minimumHeight = barHeight forces the split view to allocate at least that much
    // space, even when the stored size from fromJSON is 0.
    // Only apply height constraints immediately for horizontal placement.
    if (this._expectedOrientation !== 'vertical') {
      params.api.group.api.setConstraints({ minimumHeight: this._barHeight, maximumHeight: this._barHeight });
    }

    // fromJSON does NOT fire onDidLocationChange for freshly-created panels.
    // If _pendingOrient set a hint (read by super.init()), apply orientation now.
    if (this._expectedOrientation === 'vertical') {
      setTimeout(() => {
        const groupApi = params.api.group?.api;
        const groupView = this._findGroupView();
        groupView?.classList.add('ce-bar-panel-group', 'ce-menu-bar-group', 'ce-bar-tab-hidden');
        groupView?.classList.add('ce-bar-vertical');
        groupApi?.setConstraints({ minimumWidth: this._barHeight, maximumWidth: this._barHeight });
        groupApi?.setSize({ width: this._barHeight });
        this._expectedOrientation = null;
      }, 0);
    }

    params.api.onDidLocationChange((event) => {
      const isNowFloating = event.location?.type === 'floating';
      // Always sync this._floating from the event so drag-handle logic is accurate.
      // (Dockview may fire a spurious 'grid' event when addFloatingGroup vacates the
      //  old grid slot — we must not let that reset _floating back to false.)
      this._floating = isNowFloating;

      if (!isNowFloating) {
        if (this._floatBtn) this._updateFloatBtn(this._floatBtn);
        setTimeout(() => {
          const groupApi = params.api.group?.api;
          const groupView = this._findGroupView();
          groupView?.classList.add('ce-bar-panel-group', 'ce-menu-bar-group', 'ce-bar-tab-hidden');

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
          groupView?.classList.add('ce-bar-panel-group', 'ce-menu-bar-group', 'ce-bar-tab-hidden');
          // Direct DOM fix — dockview's setSize() does not reliably resize the
          // floating container when restoring from a saved layout via fromJSON.
          this._fixFloatingSize();
        }, 0);
      }
    });
  }

  _toggleFloat(btn) {
    // onDidLocationChange handles constraint and tab-visibility changes;
    // just delegate to BasePanel for snapshot/addFloatingGroup/fromJSON.
    super._toggleFloat(btn);
  }
}
