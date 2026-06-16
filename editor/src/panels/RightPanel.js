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
import { ObjectProperties }         from '../properties/ObjectProperties.js';
import { LODProperties }            from '../properties/LODProperties.js';
import { InstancedMeshProperties }  from '../properties/InstancedMeshProperties.js';
import { LightingProperties }       from '../properties/LightingProperties.js';
import { CameraProperties }         from '../properties/CameraProperties.js';
import { GridProperties }           from '../properties/GridProperties.js';
import { RendererProperties }       from '../properties/RendererProperties.js';
import { EnvironmentProperties }    from '../properties/EnvironmentProperties.js';
import { PostProcessingProperties } from '../properties/PostProcessingProperties.js';
import { PhysicsWorldWindow }        from '../ui/PhysicsWorldWindow.js';

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
    const { type, object, objects } = e.detail ?? {};
    const arr = Array.isArray(objects) ? objects : (object ? [object] : []);
    if (arr.length > 1) {
      this._showMultiSelect(arr);
      return;
    }
    this._mount(type, object ?? null);
  }

  _onDeselect() {
    this._showEmpty();
  }

  _onShow(e) {
    const { type } = e.detail ?? {};
    this._mount(type, null);
  }

  // ── Multi-select summary ──────────────────────────────────────────────────

  _showMultiSelect(objects) {
    this._disposeCurrentComponent();
    if (!this._contentEl) return;
    this._contentEl.innerHTML = '';

    const wrap = document.createElement('div');
    wrap.className = 'ce-props-multi';
    wrap.innerHTML = `
      <div class="ce-props-multi-header">
        <div class="ce-props-multi-count">${objects.length}</div>
        <div class="ce-props-multi-label">objects selected</div>
      </div>
      <div class="ce-props-multi-hint">
        Use the viewport gizmo to move, rotate, or scale all selected objects at once.
      </div>
      <div class="ce-props-multi-actions">
        <button class="ce-btn ghost ce-props-multi-group">Group Selected</button>
        <button class="ce-btn primary ce-props-multi-prefab">Create Prefab</button>
        <button class="ce-btn ghost danger ce-props-multi-delete">Delete All</button>
      </div>
      <div class="ce-props-multi-list"></div>
    `;
    this._contentEl.appendChild(wrap);

    // Action buttons
    wrap.querySelector('.ce-props-multi-group').addEventListener('click', () => {
      // Group via hierarchy panel
      window.dispatchEvent(new CustomEvent('cyco-action', { detail: 'hierarchy-group' }));
    });
    wrap.querySelector('.ce-props-multi-prefab').addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('cyco-create-prefab-from-selection', {
        detail: { objects }
      }));
    });
    wrap.querySelector('.ce-props-multi-delete').addEventListener('click', () => {
      const cm = window.__cyco?.commandManager;
      if (!cm) return;
      for (const obj of objects) {
        const cycoId = obj.userData?.cycoId;
        if (!cycoId) continue;
        const parent = obj.parent;
        const idx    = parent?.children.indexOf(obj) ?? 0;
        cm.execute({
          name: `Delete ${obj.name || cycoId}`,
          _obj: obj, _parent: parent, _idx: idx,
          do()   { window.dispatchEvent(new CustomEvent('cyco-hierarchy-remove-obj', { detail: { cycoId: this._obj.userData.cycoId } })); },
          undo() { window.dispatchEvent(new CustomEvent('cyco-hierarchy-restore-obj', { detail: { object: this._obj, parent: this._parent, index: this._idx } })); },
        });
      }
      window.dispatchEvent(new CustomEvent('cyco-deselect-all'));
    });

    // Per-object list (compact, click to single-select)
    const list = wrap.querySelector('.ce-props-multi-list');
    for (const obj of objects) {
      const row = document.createElement('div');
      row.className = 'ce-props-multi-row';
      const type = this._inferType(obj);
      const icon = type === 'light' ? '◉'
                 : type === 'camera' ? '◧'
                 : type === 'mesh' ? '◆'
                 : '◇';
      row.innerHTML = `<span class="ce-props-multi-icon">${icon}</span><span class="ce-props-multi-name"></span>`;
      row.querySelector('.ce-props-multi-name').textContent = obj.name || obj.userData?.cycoId || '(unnamed)';
      row.title = 'Click to focus this object';
      row.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('cyco-select-node', {
          detail: { object: obj, objects: [obj], type }
        }));
      });
      list.appendChild(row);
    }
  }

  _inferType(obj) {
    if (!obj) return 'object';
    if (obj.isLight)         return 'light';
    if (obj.isCamera)        return 'camera';
    if (obj.isInstancedMesh) return 'instanced';
    if (obj.isMesh)          return 'mesh';
    if (obj.isGroup)         return 'group';
    if (obj.isLOD)           return 'lod';
    return 'object';
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
        comp = new ObjectProperties(object);
        break;
      case 'lod':
        comp = new LODProperties(object);
        break;
      case 'instanced':
        comp = new InstancedMeshProperties(object);
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
      case 'renderer':
        comp = new RendererProperties();
        break;
      case 'environment':
        comp = new EnvironmentProperties();
        break;
      case 'post-processing':
        comp = new PostProcessingProperties();
        break;
      case 'physics':
        // Physics settings live in a floating panel, not the right panel
        PhysicsWorldWindow.open();
        return;
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
