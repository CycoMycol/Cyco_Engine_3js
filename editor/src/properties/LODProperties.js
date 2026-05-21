/**
 * LODProperties.js — Properties panel for THREE.LOD objects.
 * Shows: LOD level list (mesh slot + distance), active level at current camera distance,
 * add/remove level buttons.
 */

import * as THREE from 'three';
import { section, row, readOnly, numInput, nameHeader } from './propUtils.js';

export class LODProperties {
  /** @param {THREE.LOD} lod */
  constructor(lod) {
    this.lod   = lod;
    this._el   = document.createElement('div');
    this._el.className = 'ce-props-panel';
    this._onTick = this._onTick.bind(this);
    this._build();
    window.addEventListener('cyco-vp-tick', this._onTick);
  }

  get element() { return this._el; }

  // ── Build ─────────────────────────────────────────────────────────────────

  _build() {
    const lod = this.lod;
    if (!lod) return;

    this._el.appendChild(nameHeader(lod.name || '(LOD)', 'LOD'));

    // Active level indicator
    const { el: infoSec, body: infoBody } = section('LOD Info');
    this._activeRow = readOnly('—');
    infoBody.appendChild(row('Active Level', this._activeRow));
    infoBody.appendChild(row('Level Count',  readOnly(String(lod.levels.length))));
    this._el.appendChild(infoSec);

    // Level list
    const { el: lvlSec, body: lvlBody } = section('Levels');
    this._levelsContainer = lvlBody;
    this._renderLevels();
    this._el.appendChild(lvlSec);

    // Add level button
    const addBtn = document.createElement('button');
    addBtn.className = 'ce-prop-btn';
    addBtn.textContent = '+ Add Level';
    addBtn.style.cssText = 'margin:6px 8px;padding:4px 10px;width:calc(100% - 16px);';
    addBtn.addEventListener('click', () => this._addLevel());
    this._el.appendChild(addBtn);
  }

  _renderLevels() {
    const lod = this.lod;
    this._levelsContainer.innerHTML = '';

    if (lod.levels.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'ce-props-empty';
      empty.style.padding = '6px 8px';
      empty.textContent = 'No levels';
      this._levelsContainer.appendChild(empty);
      return;
    }

    lod.levels.forEach((lvl, idx) => {
      const objName = lvl.object?.name || lvl.object?.type || '(mesh)';
      const rowEl = document.createElement('div');
      rowEl.className = 'ce-prop-lod-row';
      rowEl.style.cssText = 'display:flex;align-items:center;gap:6px;padding:3px 8px;font-size:11px;';

      const idxLabel = document.createElement('span');
      idxLabel.style.cssText = 'min-width:22px;color:var(--text-secondary,#888);';
      idxLabel.textContent = `[${idx}]`;

      const nameLabel = document.createElement('span');
      nameLabel.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      nameLabel.title = objName;
      nameLabel.textContent = objName;

      const distLabel = document.createElement('span');
      distLabel.style.cssText = 'color:var(--text-secondary,#888);min-width:26px;text-align:right;';
      distLabel.textContent = 'd:';

      const distWrap = numInput({
        value:    lvl.distance,
        step:     1,
        min:      0,
        decimals: 1,
        onChange: (v) => { lvl.distance = v; },
      });

      const removeBtn = document.createElement('button');
      removeBtn.textContent = '×';
      removeBtn.className = 'ce-prop-btn';
      removeBtn.style.cssText = 'padding:1px 5px;min-width:20px;font-size:12px;';
      removeBtn.addEventListener('click', () => {
        lod.removeLOD(idx);
        this._refreshLevels();
      });

      rowEl.appendChild(idxLabel);
      rowEl.appendChild(nameLabel);
      rowEl.appendChild(distLabel);
      rowEl.appendChild(distWrap);
      rowEl.appendChild(removeBtn);
      this._levelsContainer.appendChild(rowEl);
    });
  }

  _refreshLevels() {
    this._renderLevels();
    // Update level count label
    const countEl = this._el.querySelector('.ce-prop-ro');
    // Re-build info section
  }

  _addLevel() {
    const lod = this.lod;
    // Add a visible indicator mesh as placeholder
    const geo = new THREE.SphereGeometry(0.5, 8, 8);
    const mat = new THREE.MeshBasicMaterial({ color: 0x888888, wireframe: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `LOD_Level_${lod.levels.length}`;
    const dist = lod.levels.length > 0
      ? (lod.levels[lod.levels.length - 1].distance + 20)
      : 0;
    lod.addLevel(mesh, dist);
    this._renderLevels();
  }

  // ── Tick: update active level indicator ───────────────────────────────────

  _onTick() {
    if (!this.lod || !this._activeRow) return;
    const camera = window.__cyco?.viewportEngine?.camera;
    if (!camera) return;
    // getCurrentLevel() is available on THREE.LOD
    const lvlIdx = this.lod.getCurrentLevel?.() ?? -1;
    this._activeRow.textContent = lvlIdx >= 0
      ? `Level ${lvlIdx} (d=${this.lod.levels[lvlIdx]?.distance.toFixed(1)})`
      : '—';
  }

  dispose() {
    window.removeEventListener('cyco-vp-tick', this._onTick);
  }
}
