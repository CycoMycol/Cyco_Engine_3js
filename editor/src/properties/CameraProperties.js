/**
 * CameraProperties.js — Properties panel for THREE.Camera objects.
 * Shows: Transform, Camera type info, FOV / near / far / zoom.
 */

import * as THREE from 'three';
import { section, row, vec3, readOnly, slider, numInput, nameHeader } from './propUtils.js';

const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;

export class CameraProperties {
  /** @param {THREE.Camera} object */
  constructor(object) {
    this.object   = object;
    this._el      = document.createElement('div');
    this._el.className = 'ce-props-panel';
    this._posVec  = null;
    this._elapsed = 0;
    this._onTick  = this._onTick.bind(this);
    this._build();
    window.addEventListener('cyco-vp-tick', this._onTick);
  }

  get element() { return this._el; }

  _build() {
    const cam = this.object;
    if (!cam?.isCamera) return;

    this._el.appendChild(nameHeader(cam.name || cam.type, cam.type));

    // ── Transform ──────────────────────────────────────────────────────────
    const { el: tSec, body: tBody } = section('Transform');

    const posV = vec3((axis, val) => cam.position.setComponent(axis, val));
    const rotV = vec3((axis, val) => {
      const arr = [cam.rotation.x, cam.rotation.y, cam.rotation.z];
      arr[axis] = val * DEG2RAD;
      cam.rotation.set(arr[0], arr[1], arr[2]);
    });

    tBody.appendChild(row('Position', posV.el));
    tBody.appendChild(row('Rotation', rotV.el));

    this._el.appendChild(tSec);
    this._posVec = posV;
    this._rotVec = rotV;
    this._syncTransform();

    // ── Camera properties ──────────────────────────────────────────────────
    const { el: cSec, body: cBody } = section('Camera');
    cBody.appendChild(row('Type', readOnly(cam.type ?? '')));

    if (cam.isPerspectiveCamera) {
      // FOV slider (1–179°)
      const fovS = slider({ value: cam.fov, min: 1, max: 179, step: 1,
        onChange: (v) => { cam.fov = v; cam.updateProjectionMatrix(); } });
      cBody.appendChild(row('FOV', fovS.el));

      // Near / far
      const nearInp = numInput({ value: cam.near, step: 0.01, min: 0.001, decimals: 3,
        onChange: (v) => { cam.near = v; cam.updateProjectionMatrix(); } });
      const farInp = numInput({ value: cam.far, step: 1, min: 1, decimals: 1,
        onChange: (v) => { cam.far = v; cam.updateProjectionMatrix(); } });
      cBody.appendChild(row('Near', nearInp));
      cBody.appendChild(row('Far',  farInp));

      // Zoom
      const zoomInp = numInput({ value: cam.zoom, step: 0.1, min: 0.01, decimals: 2,
        onChange: (v) => { cam.zoom = v; cam.updateProjectionMatrix(); } });
      cBody.appendChild(row('Zoom', zoomInp));

      // Aspect (read-only — driven by viewport)
      cBody.appendChild(row('Aspect', readOnly(cam.aspect.toFixed(3))));

      // filmGauge / filmOffset
      const gaugeInp = numInput({ value: cam.filmGauge, step: 1, decimals: 1,
        onChange: (v) => { cam.filmGauge = v; cam.updateProjectionMatrix(); } });
      const offsetInp = numInput({ value: cam.filmOffset, step: 0.1, decimals: 2,
        onChange: (v) => { cam.filmOffset = v; cam.updateProjectionMatrix(); } });
      cBody.appendChild(row('Film Gauge', gaugeInp));
      cBody.appendChild(row('Film Offset', offsetInp));

    } else if (cam.isOrthographicCamera) {
      const nearInp = numInput({ value: cam.near, step: 0.1, decimals: 2,
        onChange: (v) => { cam.near = v; cam.updateProjectionMatrix(); } });
      const farInp  = numInput({ value: cam.far,  step: 1,   decimals: 1,
        onChange: (v) => { cam.far  = v; cam.updateProjectionMatrix(); } });
      const zoomInp = numInput({ value: cam.zoom, step: 0.1, min: 0.01, decimals: 2,
        onChange: (v) => { cam.zoom = v; cam.updateProjectionMatrix(); } });

      cBody.appendChild(row('Near', nearInp));
      cBody.appendChild(row('Far',  farInp));
      cBody.appendChild(row('Zoom', zoomInp));
      cBody.appendChild(row('Left',   readOnly(cam.left.toFixed(2))));
      cBody.appendChild(row('Right',  readOnly(cam.right.toFixed(2))));
      cBody.appendChild(row('Top',    readOnly(cam.top.toFixed(2))));
      cBody.appendChild(row('Bottom', readOnly(cam.bottom.toFixed(2))));
    }

    this._el.appendChild(cSec);
  }

  _syncTransform() {
    const cam = this.object;
    if (!cam || !this._posVec) return;
    const p = cam.position, r = cam.rotation;
    this._posVec.setValues(p.x, p.y, p.z);
    this._rotVec.setValues(r.x * RAD2DEG, r.y * RAD2DEG, r.z * RAD2DEG);
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
