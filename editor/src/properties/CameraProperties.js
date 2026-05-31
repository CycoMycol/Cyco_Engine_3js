/**
 * CameraProperties.js — Properties panel for THREE.Camera objects.
 * Shows: Transform, Camera settings, Lens (focal length ↔ FOV), Zoom presets.
 *
 * Lens math (full-frame 35mm vertical FOV, matching Three.js PerspectiveCamera):
 *   focalLength = sensorH / (2 * tan(fov/2 * DEG2RAD))
 *   fov         = 2 * atan(sensorH / 2 / focalLength) * RAD2DEG
 *
 * Sensor heights (vertical mm):
 *   Full Frame 35mm : 24.0 mm  (36×24 mm)
 *   APS-C           : 15.6 mm  (23.6×15.6 mm)
 *   Super 35 (UE)   : 18.67 mm (24.89×18.67 mm — UE CineCamera default)
 *   Micro 4/3       : 13.0 mm  (17.3×13 mm)
 */

import * as THREE from 'three';
import { section, row, vec3, readOnly, numInput, select, nameHeader } from './propUtils.js';

const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;

// ── Sensor presets (vertical height in mm) ────────────────────────────────────
const SENSORS = {
  'full-frame':  { label: 'Full Frame 35mm', h: 24.0  },
  'aps-c':       { label: 'APS-C',           h: 15.6  },
  'super35':     { label: 'Super 35 (UE)',   h: 18.67 },
  'mft':         { label: 'Micro 4/3',       h: 13.0  },
};

const LENS_PRESETS = [14, 24, 28, 35, 50, 85, 135, 200];

function focalToFov(focalMm, sensorH) {
  return 2 * Math.atan(sensorH * 0.5 / focalMm) * RAD2DEG;
}
function fovToFocal(fovDeg, sensorH) {
  return (sensorH * 0.5) / Math.tan(fovDeg * 0.5 * DEG2RAD);
}

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
      // FOV — linked to Focal Length below
      const fovInp = numInput({ value: cam.fov, step: 1, min: 1, max: 179, decimals: 2,
        onChange: (v) => {
          cam.fov = Math.min(179, Math.max(1, v));
          cam.updateProjectionMatrix();
          // sync focal length display
          const sH = SENSORS[sensorSel.value]?.h ?? 24.0;
          flInp.querySelector('input').value = fovToFocal(cam.fov, sH).toFixed(2);
        }
      });
      cBody.appendChild(row('FOV (°)', fovInp));

      // Near / far — UE defaults: near 10 cm, far 10 000 cm
      const nearInp = numInput({ value: cam.near, step: 0.1, min: 0.0001, max: 10000, decimals: 4,
        onChange: (v) => { cam.near = Math.max(0.0001, v); cam.updateProjectionMatrix(); } });
      const farInp = numInput({ value: cam.far, step: 100, min: 1, max: 10000000, decimals: 1,
        onChange: (v) => { cam.far = v; cam.updateProjectionMatrix(); } });
      cBody.appendChild(row('Near (cm)', nearInp));
      cBody.appendChild(row('Far (cm)',  farInp));

      // Zoom
      const zoomInp = numInput({ value: cam.zoom, step: 0.1, min: 0.01, decimals: 2,
        onChange: (v) => { cam.zoom = v; cam.updateProjectionMatrix(); } });
      cBody.appendChild(row('Zoom', zoomInp));

      // Aspect (read-only — driven by viewport)
      cBody.appendChild(row('Aspect', readOnly(cam.aspect.toFixed(3))));

      this._el.appendChild(cSec);

      // ── Lens section ───────────────────────────────────────────────────
      const { el: lSec, body: lBody } = section('Lens');

      // Sensor size selector
      const savedSensor = cam.userData.sensorKey ?? 'full-frame';
      const sensorSel = select({
        options: Object.entries(SENSORS).map(([k, v]) => [k, v.label]),
        value: savedSensor,
        onChange: (k) => {
          cam.userData.sensorKey = k;
          const sH = SENSORS[k]?.h ?? 24.0;
          // Update focal length display from current FOV
          flInp.querySelector('input').value = fovToFocal(cam.fov, sH).toFixed(2);
        },
      });
      lBody.appendChild(row('Sensor', sensorSel));

      // Focal Length — primary control, updates FOV
      const initSH   = SENSORS[savedSensor]?.h ?? 24.0;
      const initFL   = cam.userData.focalLengthMm ?? fovToFocal(cam.fov, initSH);
      const flInp    = numInput({ value: initFL, step: 1, min: 1, max: 2000, decimals: 2,
        onChange: (mm) => {
          cam.userData.focalLengthMm = mm;
          const sH = SENSORS[sensorSel.value]?.h ?? 24.0;
          const newFov = Math.min(179, Math.max(1, focalToFov(mm, sH)));
          cam.fov = newFov;
          cam.updateProjectionMatrix();
          // sync FOV input
          fovInp.querySelector('input').value = newFov.toFixed(2);
        },
      });
      lBody.appendChild(row('Focal (mm)', flInp));

      // Lens preset buttons
      const presetsWrap = document.createElement('div');
      presetsWrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:3px;padding:2px 0;';
      LENS_PRESETS.forEach(mm => {
        const btn = document.createElement('button');
        btn.textContent = `${mm}`;
        btn.title       = `${mm} mm`;
        btn.style.cssText = 'flex:1;min-width:28px;padding:2px 3px;font-size:10px;' +
          'background:#2a2a2a;color:#ccc;border:1px solid #555;border-radius:3px;cursor:pointer;';
        btn.addEventListener('mouseover', () => btn.style.background = '#3a3a3a');
        btn.addEventListener('mouseout',  () => btn.style.background = '#2a2a2a');
        btn.addEventListener('click', () => {
          cam.userData.focalLengthMm = mm;
          flInp.querySelector('input').value = mm.toFixed(2);
          const sH = SENSORS[sensorSel.value]?.h ?? 24.0;
          const newFov = Math.min(179, Math.max(1, focalToFov(mm, sH)));
          cam.fov = newFov;
          cam.updateProjectionMatrix();
          fovInp.querySelector('input').value = newFov.toFixed(2);
        });
        presetsWrap.appendChild(btn);
      });
      const presetsLabel = document.createElement('div');
      presetsLabel.style.cssText = 'font-size:10px;color:#888;padding:2px 0 1px 0;';
      presetsLabel.textContent = 'mm Presets';
      lBody.appendChild(presetsLabel);
      lBody.appendChild(presetsWrap);

      this._el.appendChild(lSec);

      // ── Zoom / Sprint / ADS section ───────────────────────────────────
      const { el: zSec, body: zBody } = section('Zoom Presets');

      // Note label
      const zNote = document.createElement('div');
      zNote.style.cssText = 'font-size:10px;color:#777;padding:2px 4px 4px;line-height:1.4;';
      zNote.textContent = 'Store FOV targets for runtime Blueprint/code use. Click Apply to preview.';
      zBody.appendChild(zNote);

      const baseFovInp = numInput({
        value: cam.userData.baseFov ?? cam.fov, step: 1, min: 1, max: 179, decimals: 1,
        onChange: (v) => { cam.userData.baseFov = v; }
      });
      zBody.appendChild(row('Base FOV (°)', baseFovInp));

      const sprintFovInp = numInput({
        value: cam.userData.sprintFov ?? 110, step: 1, min: 60, max: 170, decimals: 1,
        onChange: (v) => { cam.userData.sprintFov = v; }
      });
      zBody.appendChild(row('Sprint FOV (°)', sprintFovInp));

      const adsFovInp = numInput({
        value: cam.userData.adsFov ?? 40, step: 1, min: 5, max: 90, decimals: 1,
        onChange: (v) => { cam.userData.adsFov = v; }
      });
      zBody.appendChild(row('ADS FOV (°)', adsFovInp));

      // Apply buttons row
      const applyRow = document.createElement('div');
      applyRow.style.cssText = 'display:flex;gap:4px;padding:4px 0 2px;';
      const mkApply = (label, getFov) => {
        const b = document.createElement('button');
        b.textContent = label;
        b.style.cssText = 'flex:1;padding:3px 4px;font-size:10px;background:#2a2a2a;' +
          'color:#ccc;border:1px solid #555;border-radius:3px;cursor:pointer;';
        b.addEventListener('mouseover', () => b.style.background = '#3a3a3a');
        b.addEventListener('mouseout',  () => b.style.background = '#2a2a2a');
        b.addEventListener('click', () => {
          const v = getFov();
          if (!v) return;
          cam.fov = Math.min(179, Math.max(1, v));
          cam.updateProjectionMatrix();
          fovInp.querySelector('input').value = cam.fov.toFixed(2);
          const sH = SENSORS[sensorSel.value]?.h ?? 24.0;
          flInp.querySelector('input').value = fovToFocal(cam.fov, sH).toFixed(2);
        });
        return b;
      };
      applyRow.appendChild(mkApply('▶ Base',   () => parseFloat(baseFovInp.querySelector('input').value)));
      applyRow.appendChild(mkApply('▶ Sprint', () => parseFloat(sprintFovInp.querySelector('input').value)));
      applyRow.appendChild(mkApply('▶ ADS',    () => parseFloat(adsFovInp.querySelector('input').value)));
      zBody.appendChild(applyRow);

      this._el.appendChild(zSec);

    } else if (cam.isOrthographicCamera) {
      const nearInp = numInput({ value: cam.near, step: 0.001, min: 0.0001, max: 1000, decimals: 4,
        onChange: (v) => { cam.near = Math.max(0.0001, v); cam.updateProjectionMatrix(); } });
      const farInp  = numInput({ value: cam.far,  step: 100,  min: 1, max: 10000000, decimals: 1,
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
      this._el.appendChild(cSec);
    } else {
      this._el.appendChild(cSec);
    }
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
