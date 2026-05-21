/**
 * InstancedMeshProperties.js — Properties panel for THREE.InstancedMesh objects.
 * Shows: instance count, geometry/material info, per-instance matrix table (first 20).
 */

import * as THREE from 'three';
import { section, row, readOnly, numInput, nameHeader } from './propUtils.js';

export class InstancedMeshProperties {
  /** @param {THREE.InstancedMesh} mesh */
  constructor(mesh) {
    this.mesh   = mesh;
    this._el    = document.createElement('div');
    this._el.className = 'ce-props-panel';
    this._build();
  }

  get element() { return this._el; }

  // ── Build ─────────────────────────────────────────────────────────────────

  _build() {
    const mesh = this.mesh;
    if (!mesh) return;

    this._el.appendChild(nameHeader(mesh.name || '(InstancedMesh)', 'InstancedMesh'));

    // Info section
    const { el: infoSec, body: infoBody } = section('Instanced Info');
    infoBody.appendChild(row('Count',     readOnly(String(mesh.count))));
    infoBody.appendChild(row('Max Count', readOnly(String(mesh.instanceMatrix?.count ?? 0))));
    const geo = mesh.geometry;
    if (geo) {
      const verts = geo.attributes?.position?.count ?? 0;
      infoBody.appendChild(row('Vertices', readOnly(String(verts))));
    }

    // Instance count editor
    const countWrap = numInput({
      value:    mesh.count,
      step:     1,
      min:      0,
      max:      mesh.instanceMatrix?.count ?? mesh.count,
      decimals: 0,
      onChange: (v) => {
        mesh.count = Math.max(0, Math.min(Math.floor(v), mesh.instanceMatrix?.count ?? v));
        mesh.instanceMatrix.needsUpdate = true;
        // Rebuild matrix table
        this._buildMatrixTable(matrixBody);
      },
    });
    infoBody.appendChild(row('Visible Count', countWrap));
    this._el.appendChild(infoSec);

    // Per-instance matrix table (first 20 instances)
    const { el: matSec, body: matrixBody } = section('Instance Matrices (first 20)');
    this._buildMatrixTable(matrixBody);
    this._el.appendChild(matSec);
  }

  _buildMatrixTable(container) {
    container.innerHTML = '';
    const mesh   = this.mesh;
    const count  = Math.min(mesh.count, 20);
    const matrix = new THREE.Matrix4();

    if (count === 0) {
      const empty = document.createElement('div');
      empty.className = 'ce-props-empty';
      empty.style.padding = '6px 8px';
      empty.textContent = 'No instances';
      container.appendChild(empty);
      return;
    }

    for (let i = 0; i < count; i++) {
      mesh.getMatrixAt(i, matrix);
      const pos   = new THREE.Vector3();
      const quat  = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      matrix.decompose(pos, quat, scale);
      const euler = new THREE.Euler().setFromQuaternion(quat, 'XYZ');

      const rowEl = document.createElement('div');
      rowEl.className = 'ce-prop-lod-row';
      rowEl.style.cssText = 'display:flex;align-items:center;gap:4px;padding:2px 8px;font-size:10px;border-bottom:1px solid var(--border,#333);';

      const idxEl = document.createElement('span');
      idxEl.style.cssText = 'min-width:20px;color:var(--text-secondary,#888);';
      idxEl.textContent = `[${i}]`;

      const posEl = document.createElement('span');
      posEl.style.cssText = 'flex:1;';
      posEl.textContent = `P(${pos.x.toFixed(1)},${pos.y.toFixed(1)},${pos.z.toFixed(1)}) S(${scale.x.toFixed(2)})`;

      rowEl.appendChild(idxEl);
      rowEl.appendChild(posEl);
      container.appendChild(rowEl);
    }

    if (mesh.count > 20) {
      const more = document.createElement('div');
      more.style.cssText = 'padding:4px 8px;color:var(--text-secondary,#888);font-size:10px;';
      more.textContent = `… and ${mesh.count - 20} more`;
      container.appendChild(more);
    }
  }

  dispose() {}
}
