/**
 * ObjectProperties.js — Properties panel for mesh / group / generic Object3D.
 * Shows: Transform (position/rotation/scale), Geometry info, Material controls.
 *
 * Syncs transform display back from Three.js at ~10 Hz (e.g. after gizmo move).
 */

import * as THREE from 'three';
import { section, row, vec3, readOnly, colorSwatch, slider, numInput, nameHeader } from './propUtils.js';

const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;

function colorToHex(c) {
  return '#' + c.getHexString();
}

export class ObjectProperties {
  /** @param {THREE.Object3D} object */
  constructor(object) {
    this.object  = object;
    this._el     = document.createElement('div');
    this._el.className = 'ce-props-panel';

    this._posVec = null;
    this._rotVec = null;
    this._sclVec = null;
    this._elapsed = 0;
    this._onTick  = this._onTick.bind(this);

    this._build();
    window.addEventListener('cyco-vp-tick', this._onTick);
  }

  get element() { return this._el; }

  // ── Build ──────────────────────────────────────────────────────────────────

  _build() {
    const obj = this.object;
    if (!obj) return;

    // Name header
    this._el.appendChild(nameHeader(obj.name || '(unnamed)', obj.type));

    // Transform
    this._buildTransform(obj);

    // Geometry (meshes only)
    if (obj.isMesh || obj.isSkinnedMesh || obj.isInstancedMesh) {
      this._buildGeometry(obj);
    }

    // Material(s)
    const mat = obj.material;
    if (mat) {
      const mats = Array.isArray(mat) ? mat : [mat];
      mats.forEach((m, idx) => {
        const title = mats.length > 1 ? `Material [${idx}]` : 'Material';
        this._buildMaterial(m, title);
      });
    }
  }

  _buildTransform(obj) {
    const { el: sec, body } = section('Transform');

    const posV = vec3((axis, val) => obj.position.setComponent(axis, val));
    const rotV = vec3((axis, val) => {
      const arr = [obj.rotation.x, obj.rotation.y, obj.rotation.z];
      arr[axis] = val * DEG2RAD;
      obj.rotation.set(arr[0], arr[1], arr[2]);
    });
    const sclV = vec3((axis, val) => obj.scale.setComponent(axis, val));

    body.appendChild(row('Position', posV.el));
    body.appendChild(row('Rotation', rotV.el));
    body.appendChild(row('Scale',    sclV.el));

    this._el.appendChild(sec);
    this._posVec = posV;
    this._rotVec = rotV;
    this._sclVec = sclV;
    this._syncTransform();
  }

  _buildGeometry(obj) {
    const geo = obj.geometry;
    if (!geo) return;

    const { el: sec, body } = section('Geometry');
    const typeName  = geo.type ?? geo.constructor?.name ?? 'BufferGeometry';
    const vertCount = geo.attributes?.position?.count ?? 0;
    const faceCount = geo.index
      ? Math.round(geo.index.count / 3)
      : Math.round(vertCount / 3);

    body.appendChild(row('Type',     readOnly(typeName)));
    body.appendChild(row('Vertices', readOnly(String(vertCount))));
    body.appendChild(row('Faces',    readOnly(String(faceCount))));

    if (obj.isInstancedMesh) {
      body.appendChild(row('Count', readOnly(String(obj.count))));
    }

    this._el.appendChild(sec);
  }

  _buildMaterial(m, title) {
    const { el: sec, body } = section(title);
    body.appendChild(row('Type', readOnly(m.type ?? m.constructor?.name ?? 'Material')));

    if (m.color !== undefined) {
      const sw = colorSwatch({
        color:    colorToHex(m.color),
        onChange: (hex) => { m.color.set(hex); m.needsUpdate = true; },
      });
      body.appendChild(row('Color', sw.el));
    }

    if (m.emissive !== undefined) {
      const sw = colorSwatch({
        color:    colorToHex(m.emissive),
        onChange: (hex) => { m.emissive.set(hex); m.needsUpdate = true; },
      });
      body.appendChild(row('Emissive', sw.el));
    }

    if (m.roughness !== undefined) {
      const s = slider({ value: m.roughness, min: 0, max: 1, step: 0.01,
        onChange: (v) => { m.roughness = v; m.needsUpdate = true; } });
      body.appendChild(row('Roughness', s.el));
    }

    if (m.metalness !== undefined) {
      const s = slider({ value: m.metalness, min: 0, max: 1, step: 0.01,
        onChange: (v) => { m.metalness = v; m.needsUpdate = true; } });
      body.appendChild(row('Metalness', s.el));
    }

    if (m.opacity !== undefined) {
      const s = slider({ value: m.opacity, min: 0, max: 1, step: 0.01,
        onChange: (v) => { m.opacity = v; m.transparent = v < 1; m.needsUpdate = true; } });
      body.appendChild(row('Opacity', s.el));
    }

    if (m.wireframe !== undefined) {
      const cb = document.createElement('input');
      cb.type    = 'checkbox';
      cb.checked = m.wireframe;
      cb.className = 'ce-prop-checkbox';
      cb.addEventListener('change', () => { m.wireframe = cb.checked; });
      body.appendChild(row('Wireframe', cb));
    }

    this._el.appendChild(sec);
  }

  // ── Tick sync ──────────────────────────────────────────────────────────────

  _syncTransform() {
    const obj = this.object;
    if (!obj || !this._posVec) return;
    const p = obj.position, r = obj.rotation, s = obj.scale;
    this._posVec.setValues(p.x, p.y, p.z);
    this._rotVec.setValues(r.x * RAD2DEG, r.y * RAD2DEG, r.z * RAD2DEG);
    this._sclVec.setValues(s.x, s.y, s.z);
  }

  _onTick(e) {
    const delta = e.detail?.delta ?? 0;
    this._elapsed += delta;
    if (this._elapsed < 0.1) return;
    this._elapsed = 0;
    this._syncTransform();
  }

  dispose() {
    window.removeEventListener('cyco-vp-tick', this._onTick);
  }
}
