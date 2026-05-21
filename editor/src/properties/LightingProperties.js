/**
 * LightingProperties.js — Properties panel for any THREE.Light.
 * Shows: Transform (position), Light (type, color, intensity, etc.), Shadow.
 */

import * as THREE from 'three';
import { section, row, vec3, readOnly, colorSwatch, slider, numInput, checkbox, nameHeader } from './propUtils.js';

const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;

function colorToHex(c) {
  return '#' + c.getHexString();
}

export class LightingProperties {
  /** @param {THREE.Light} object */
  constructor(object) {
    this.object  = object;
    this._el     = document.createElement('div');
    this._el.className = 'ce-props-panel';
    this._posVec  = null;
    this._elapsed = 0;
    this._onTick  = this._onTick.bind(this);
    this._build();
    window.addEventListener('cyco-vp-tick', this._onTick);
  }

  get element() { return this._el; }

  _build() {
    const light = this.object;
    if (!light?.isLight) return;

    this._el.appendChild(nameHeader(light.name || light.type, light.type));

    // ── Transform (position, rotation for directional/spot) ────────────────
    const { el: tSec, body: tBody } = section('Transform');

    const posV = vec3((axis, val) => light.position.setComponent(axis, val));
    tBody.appendChild(row('Position', posV.el));

    // Show rotation only for directional/spot lights
    if (light.isDirectionalLight || light.isSpotLight) {
      const rotV = vec3((axis, val) => {
        const arr = [light.rotation.x, light.rotation.y, light.rotation.z];
        arr[axis] = val * DEG2RAD;
        light.rotation.set(arr[0], arr[1], arr[2]);
      });
      tBody.appendChild(row('Rotation', rotV.el));
    }

    this._el.appendChild(tSec);
    this._posVec = posV;
    this._syncPosition();

    // ── Light properties ───────────────────────────────────────────────────
    const { el: lSec, body: lBody } = section('Light');

    lBody.appendChild(row('Type', readOnly(light.type)));

    // Sky / ground color (HemisphereLight)
    if (light.isHemisphereLight) {
      const skySw = colorSwatch({ color: colorToHex(light.color),
        onChange: (hex) => light.color.set(hex) });
      const gndSw = colorSwatch({ color: colorToHex(light.groundColor),
        onChange: (hex) => light.groundColor.set(hex) });
      lBody.appendChild(row('Sky',    skySw.el));
      lBody.appendChild(row('Ground', gndSw.el));
    } else if (light.color) {
      const sw = colorSwatch({ color: colorToHex(light.color),
        onChange: (hex) => light.color.set(hex) });
      lBody.appendChild(row('Color', sw.el));
    }

    // Intensity
    const intInp = numInput({ value: light.intensity, step: 0.1, min: 0, decimals: 2,
      onChange: (v) => { light.intensity = v; } });
    lBody.appendChild(row('Intensity', intInp));

    // Distance (PointLight / SpotLight)
    if (light.distance !== undefined && !light.isDirectionalLight) {
      const distInp = numInput({ value: light.distance, step: 1, min: 0, decimals: 1,
        onChange: (v) => { light.distance = v; } });
      lBody.appendChild(row('Distance', distInp));
    }

    // Decay (PointLight / SpotLight)
    if (light.decay !== undefined && !light.isDirectionalLight) {
      const decInp = numInput({ value: light.decay, step: 0.1, min: 0, decimals: 2,
        onChange: (v) => { light.decay = v; } });
      lBody.appendChild(row('Decay', decInp));
    }

    // Angle / Penumbra (SpotLight)
    if (light.isSpotLight) {
      const angleS = slider({ value: light.angle, min: 0, max: Math.PI / 2, step: 0.01,
        onChange: (v) => { light.angle = v; } });
      const penS = slider({ value: light.penumbra, min: 0, max: 1, step: 0.01,
        onChange: (v) => { light.penumbra = v; } });
      lBody.appendChild(row('Angle',    angleS.el));
      lBody.appendChild(row('Penumbra', penS.el));
    }

    this._el.appendChild(lSec);

    // ── Shadow ─────────────────────────────────────────────────────────────
    if (light.shadow) {
      const { el: sSec, body: sBody } = section('Shadow');

      const castCb = checkbox({ checked: light.castShadow,
        onChange: (v) => { light.castShadow = v; } });
      sBody.appendChild(row('Cast Shadow', castCb));

      if (light.shadow.bias !== undefined) {
        const biasInp = numInput({ value: light.shadow.bias, step: 0.0001, decimals: 4,
          onChange: (v) => { light.shadow.bias = v; } });
        sBody.appendChild(row('Bias', biasInp));
      }

      if (light.shadow.radius !== undefined) {
        const radS = slider({ value: light.shadow.radius, min: 0, max: 8, step: 0.1,
          onChange: (v) => { light.shadow.radius = v; } });
        sBody.appendChild(row('Radius', radS.el));
      }

      this._el.appendChild(sSec);
    }
  }

  _syncPosition() {
    const p = this.object?.position;
    if (!p || !this._posVec) return;
    this._posVec.setValues(p.x, p.y, p.z);
  }

  _onTick(e) {
    const delta = e.detail?.delta ?? 0;
    this._elapsed += delta;
    if (this._elapsed < 0.1) return;
    this._elapsed = 0;
    this._syncPosition();
  }

  dispose() {
    window.removeEventListener('cyco-vp-tick', this._onTick);
  }
}
