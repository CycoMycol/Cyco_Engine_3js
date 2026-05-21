/**
 * RightPanel.js — Properties inspector panel.
 * Dynamically mounts the appropriate property component based on selection.
 *
 * Events consumed:
 *   cyco-select-node      { object, type }   — object selected in viewport
 *   cyco-deselect-all                        — nothing selected
 *   cyco-show-properties  { type }           — show non-object panel (grid, etc.)
 */

import { BasePanel } from './BasePanel.js';
import { ObjectProperties }   from '../properties/ObjectProperties.js';
import { LightingProperties } from '../properties/LightingProperties.js';
import { CameraProperties }   from '../properties/CameraProperties.js';
import { GridProperties }     from '../properties/GridProperties.js';

export class RightPanel extends BasePanel {
  constructor() {
    super();
    this._root       = null;
    this._contentEl  = null;  // scrollable area — property components mount here
    this._current    = null;
    this._onSelect   = this._onSelect.bind(this);
    this._onDeselect = this._onDeselect.bind(this);
    this._onShow     = this._onShow.bind(this);
  }

  _buildContent() {
    this._root = document.createElement('div');
    this._root.style.cssText = 'height:100%;display:flex;flex-direction:column;overflow:hidden;';

    this._contentEl = document.createElement('div');
    this._contentEl.style.cssText = 'flex:1;min-height:0;overflow-y:auto;';

    this._root.appendChild(this._contentEl);
    this._root.appendChild(this._buildZoomBar());

    window.addEventListener('cyco-select-node',    this._onSelect);
    window.addEventListener('cyco-deselect-all',   this._onDeselect);
    window.addEventListener('cyco-show-properties', this._onShow);

    this._showEmpty();
    return this._root;
  }

  // ── Zoom bar ───────────────────────────────────────────────────────────────

  _buildZoomBar() {
    const bar = document.createElement('div');
    bar.className = 'ce-props-zoom-bar';

    const minusBtn = document.createElement('button');
    minusBtn.className   = 'ce-props-zoom-btn';
    minusBtn.textContent = '−';
    minusBtn.title       = 'Zoom out';

    const slider = document.createElement('input');
    slider.type      = 'range';
    slider.min       = '0.5';
    slider.max       = '2.0';
    slider.step      = '0.05';
    slider.value     = '1';
    slider.className = 'ce-props-zoom-slider';

    const plusBtn = document.createElement('button');
    plusBtn.className   = 'ce-props-zoom-btn';
    plusBtn.textContent = '+';
    plusBtn.title       = 'Zoom in';

    const label = document.createElement('span');
    label.className   = 'ce-props-zoom-label';
    label.textContent = '100%';

    const apply = () => {
      const z = parseFloat(slider.value);
      label.textContent = Math.round(z * 100) + '%';
      if (this._contentEl) this._contentEl.style.zoom = String(z);
    };

    slider.addEventListener('input', apply);
    minusBtn.addEventListener('click', () => {
      slider.value = String(Math.max(0.5, parseFloat(slider.value) - 0.1).toFixed(2));
      apply();
    });
    plusBtn.addEventListener('click', () => {
      slider.value = String(Math.min(2.0, parseFloat(slider.value) + 0.1).toFixed(2));
      apply();
    });

    bar.appendChild(minusBtn);
    bar.appendChild(slider);
    bar.appendChild(plusBtn);
    bar.appendChild(label);
    return bar;
  }

  // ── Event handlers ─────────────────────────────────────────────────────────

  _onSelect(e) {
    const { type, object } = e.detail ?? {};
    this._mount(type, object);
  }

  _onDeselect() {
    this._showEmpty();
  }

  _onShow(e) {
    const { type } = e.detail ?? {};
    this._mount(type, null);
  }

  // ── Mount / unmount ────────────────────────────────────────────────────────

  _mount(type, object) {
    this._disposeCurrentComponent();
    this._contentEl.innerHTML = '';

    let comp = null;

    switch (type) {
      case 'mesh':
      case 'group':
      case 'object':
      case 'lod':
      case 'instanced':
        comp = new ObjectProperties(object);
        break;
      case 'light':
        comp = new LightingProperties(object);
        break;
      case 'camera':
        comp = new CameraProperties(object);
        break;
      case 'grid':
        comp = new GridProperties();
        break;
      default:
        if (object) {
          comp = new ObjectProperties(object);
        } else {
          this._showEmpty();
          return;
        }
    }

    this._contentEl.appendChild(comp.element);
    this._current = comp;
  }

  _showEmpty() {
    this._disposeCurrentComponent();
    this._current = null;
    if (this._contentEl) {
      this._contentEl.innerHTML = '<div class="ce-props-empty">Nothing selected</div>';
    }
  }

  _disposeCurrentComponent() {
    if (this._current?.dispose) this._current.dispose();
    this._current = null;
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────

  dispose() {
    window.removeEventListener('cyco-select-node',    this._onSelect);
    window.removeEventListener('cyco-deselect-all',   this._onDeselect);
    window.removeEventListener('cyco-show-properties', this._onShow);
    this._disposeCurrentComponent();
  }
}
