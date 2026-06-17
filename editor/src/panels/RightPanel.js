/**
 * RightPanel.js — Properties inspector panel.
 * Dynamically mounts the appropriate property component based on selection.
 *
 * Events consumed:
 *   cyco-select-node      { object, type }   — object selected in viewport
 *   cyco-deselect-all                        — nothing selected
 *   cyco-show-properties  { type }           — show non-object panel (grid, etc.)
 */

import * as THREE from 'three';
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
    // Tear down any previous multi-select tick listener before rebuilding.
    if (this._onMultiTick) {
      window.removeEventListener('cyco-vp-tick', this._onMultiTick);
      this._onMultiTick = null;
    }
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
      <div class="ce-props-multi-actions">
        <button class="ce-btn ghost ce-props-multi-group">Group Selected</button>
        <button class="ce-btn primary ce-props-multi-prefab">Create Prefab</button>
        <button class="ce-btn ghost danger ce-props-multi-delete">Delete All</button>
      </div>
      <div class="ce-props-multi-pivot-row">
        <label class="ce-props-multi-pivot-label" title="When combined, all selected objects share one centered pivot point. When individual, each object rotates and scales around its own center.">Pivot</label>
        <div class="ce-props-multi-pivot-toggle" role="tablist">
          <button class="ce-btn ghost ce-props-multi-pivot-combined active" data-mode="group">Combined</button>
          <button class="ce-btn ghost ce-props-multi-pivot-individual" data-mode="individual">Individual</button>
        </div>
      </div>
      <div class="ce-props-multi-transform">
        <div class="ce-props-multi-tlabel">Position</div>
        <div class="ce-props-multi-row-xyz ce-props-multi-pos"></div>
        <div class="ce-props-multi-tlabel">Rotation</div>
        <div class="ce-props-multi-row-xyz ce-props-multi-rot"></div>
        <div class="ce-props-multi-tlabel">Scale</div>
        <div class="ce-props-multi-row-xyz ce-props-multi-scl"></div>
      </div>
      <div class="ce-props-multi-list"></div>
    `;
    this._contentEl.appendChild(wrap);

    // ── Pivot toggle (Combined ↔ Individual) ──────────────────────────────
    const pivotBtns = wrap.querySelectorAll('.ce-props-multi-pivot-toggle button');
    const tg = window.__cyco?.transformGizmo;
    const syncPivotBtnState = (mode) => {
      pivotBtns.forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    };
    if (tg?.getMultiMode) syncPivotBtnState(tg.getMultiMode());
    pivotBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        if (tg?.setMultiMode) tg.setMultiMode(mode);
        syncPivotBtnState(mode);
        this._refreshMultiTransformDisplay(wrap, objects);
        // Notify the viewport toolbar (if present) so it stays in sync.
        window.dispatchEvent(new CustomEvent('cyco-multi-pivot-change', {
          detail: { mode }
        }));
      });
    });

    // ── XYZ inputs (driven by the live selection + gizmo state) ───────────
    this._buildMultiTransformRows(wrap, objects);
    window.addEventListener('cyco-vp-tick', this._onMultiTick = () => {
      this._refreshMultiTransformDisplay(wrap, objects);
    });

    // Action buttons
    wrap.querySelector('.ce-props-multi-group').addEventListener('click', () => {
      // Group via hierarchy panel (real Three.js Group is created there)
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

  _buildMultiTransformRows(wrap, objects) {
    const posEl = wrap.querySelector('.ce-props-multi-pos');
    const rotEl = wrap.querySelector('.ce-props-multi-rot');
    const sclEl = wrap.querySelector('.ce-props-multi-scl');
    posEl.appendChild(this._makeXYZRow((axis, val) => this._applyMultiTransform(objects, 'position', axis, val)));
    rotEl.appendChild(this._makeXYZRow((axis, val) => this._applyMultiTransform(objects, 'rotation', axis, val * Math.PI / 180)));
    sclEl.appendChild(this._makeXYZRow((axis, val) => this._applyMultiTransform(objects, 'scale',    axis, val)));
    this._refreshMultiTransformDisplay(wrap, objects);
  }

  _makeXYZRow(onCommit) {
    const row = document.createElement('div');
    row.className = 'ce-props-multi-xyz';
    row.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:4px;width:100%;';
    const labels = ['X', 'Y', 'Z'];
    for (let i = 0; i < 3; i++) {
      const wrap = document.createElement('label');
      wrap.style.cssText = 'display:flex;align-items:center;gap:2px;font-size:10px;color:var(--text-muted,#888);';
      const lbl = document.createElement('span');
      lbl.textContent = labels[i];
      lbl.style.cssText = 'font-weight:600;color:var(--text-bright,#ccc);min-width:10px;';
      const inp = document.createElement('input');
      inp.type = 'number';
      inp.step = (onCommit === this._scaleSentinel) ? '0.01' : '0.01';
      inp.style.cssText = 'width:100%;min-width:0;background:var(--bg-input,#1a1a1a);border:1px solid var(--border-color,#333);color:var(--text-bright,#eee);font-size:11px;padding:2px 4px;border-radius:2px;';
      inp.dataset.axis = String(i);
      inp.addEventListener('change', () => {
        const v = parseFloat(inp.value);
        if (!Number.isNaN(v)) onCommit(i, v);
      });
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
      wrap.appendChild(lbl);
      wrap.appendChild(inp);
      row.appendChild(wrap);
    }
    return row;
  }
  // sentinel used only for step heuristics above
  get _scaleSentinel() { return this._applyMultiTransform; }

  _refreshMultiTransformDisplay(wrap, objects) {
    if (!wrap.isConnected || !objects || objects.length === 0) return;
    const pos = this._computeMultiCentroid(objects, 'position');
    const rot = this._computeMultiCentroid(objects, 'rotation');
    const scl = this._computeMultiCentroid(objects, 'scale');
    const setInputs = (host, vals, transformDeg) => {
      const inputs = host.querySelectorAll('input');
      inputs.forEach((inp, i) => {
        let v = vals[i];
        if (transformDeg) v = v * 180 / Math.PI;
        if (document.activeElement !== inp) inp.value = Number.isFinite(v) ? v.toFixed(2) : '0.00';
      });
    };
    setInputs(wrap.querySelector('.ce-props-multi-pos'), pos, false);
    setInputs(wrap.querySelector('.ce-props-multi-rot'), rot, true);
    setInputs(wrap.querySelector('.ce-props-multi-scl'), scl, false);
  }

  _computeMultiCentroid(objects, kind) {
    const v = [0, 0, 0];
    if (!objects || objects.length === 0) return v;
    for (const o of objects) {
      if (!o) continue;
      if (kind === 'position') {
        const p = o.getWorldPosition(new THREE.Vector3());
        v[0] += p.x; v[1] += p.y; v[2] += p.z;
      } else if (kind === 'rotation') {
        const q = o.getWorldQuaternion(new THREE.Quaternion());
        const e = new THREE.Euler().setFromQuaternion(q, 'XYZ');
        v[0] += e.x; v[1] += e.y; v[2] += e.z;
      } else if (kind === 'scale') {
        const s = o.getWorldScale(new THREE.Vector3());
        v[0] += s.x; v[1] += s.y; v[2] += s.z;
      }
    }
    const n = objects.length;
    return [v[0] / n, v[1] / n, v[2] / n];
  }

  _applyMultiTransform(objects, kind, axis, value) {
    const cm = window.__cyco?.commandManager;
    const cmds = [];
    for (const obj of objects) {
      if (!obj) continue;
      // Snapshot before
      const before = {
        position: obj.position.clone(),
        rotation: obj.rotation.clone(),
        scale:    obj.scale.clone(),
      };
      // Mutate
      if (kind === 'position')      obj.position.setComponent(axis, value);
      else if (kind === 'rotation') obj.rotation[axis === 0 ? 'x' : axis === 1 ? 'y' : 'z'] = value;
      else if (kind === 'scale')    obj.scale.setComponent(axis, value);
      const after = {
        position: obj.position.clone(),
        rotation: obj.rotation.clone(),
        scale:    obj.scale.clone(),
      };
      const target = obj;
      cmds.push({
        name: `${kind} ${obj.name || obj.userData?.cycoId || ''}`,
        _target: target,
        _before: before, _after: after,
        do() {
          this._target.position.copy(this._after.position);
          this._target.rotation.copy(this._after.rotation);
          this._target.scale.copy(this._after.scale);
          window.dispatchEvent(new CustomEvent('cyco-scene-mark-dirty', { detail: { object: this._target } }));
        },
        undo() {
          this._target.position.copy(this._before.position);
          this._target.rotation.copy(this._before.rotation);
          this._target.scale.copy(this._before.scale);
          window.dispatchEvent(new CustomEvent('cyco-scene-mark-dirty', { detail: { object: this._target } }));
        },
      });
    }
    if (cm && cmds.length) {
      // Wrap as a single composite so undo restores all in one shot.
      cm.execute({
        name: `Transform ${cmds.length} objects`,
        do() { for (const c of cmds) c.do.call(c); },
        undo() { for (let i = cmds.length - 1; i >= 0; i--) cmds[i].undo.call(cmds[i]); },
      });
    } else {
      for (const c of cmds) c.do.call(c);
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
    if (this._onMultiTick) {
      window.removeEventListener('cyco-vp-tick', this._onMultiTick);
      this._onMultiTick = null;
    }
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
