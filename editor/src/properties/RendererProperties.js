/**
 * RendererProperties.js
 * Properties panel for renderer type selection and shadow/tone-mapping settings.
 *
 * Events dispatched:
 *   cyco-renderer-change  { type }
 *   cyco-shadow-map-change { type }
 *   cyco-tone-mapping-change { mode, exposure }
 *
 * Events consumed:
 *   cyco-pathtrace-samples { samples }
 */

import * as THREE from 'three';
import { section, row, select, slider, checkbox, readOnly } from './propUtils.js';

export class RendererProperties {
  constructor() {
    this._onSamples = this._onSamples.bind(this);
    window.addEventListener('cyco-pathtrace-samples', this._onSamples);
    this._element = this._build();
  }

  get element() { return this._element; }

  _build() {
    const root = document.createElement('div');
    root.className = 'ce-props-root';

    // ── Header ──
    const hdr = document.createElement('div');
    hdr.className = 'ce-prop-name-header';
    hdr.innerHTML = '<div class="ce-prop-name-title">Renderer</div>';
    root.appendChild(hdr);

    // ── Renderer Type ──
    const { el: rendSec, body: rendBody } = section('Renderer Type');
    root.appendChild(rendSec);

    const renderer = window.__cyco?.rendererManager;
    const currentType = renderer?.currentType ?? 'webgl';

    const typeSelect = select({
      options: [
        ['webgl',       'WebGL (Standard)'],
        ['webgpu',      'WebGPU (Experimental)'],
        ['svg',         'SVG Renderer'],
        ['css3d',       'CSS3D Renderer'],
        ['pathtracer',  'Path Tracer (WebGPU)'],
      ],
      value: currentType,
      onChange: (v) => {
        window.dispatchEvent(new CustomEvent('cyco-renderer-change', { detail: { type: v } }));
        this._updatePathTracerVisibility(v, samplesRow);
      },
    });

    rendBody.appendChild(row('Type', typeSelect));

    // Sample counter (Path Tracer only)
    this._samplesLabel = readOnly('0');
    const samplesRow = row('Samples', this._samplesLabel);
    samplesRow.style.display = currentType === 'pathtracer' ? '' : 'none';
    rendBody.appendChild(samplesRow);

    // ── Shadows ──
    const { el: shadowSec, body: shadowBody } = section('Shadows');
    root.appendChild(shadowSec);

    const shadowTypeSelect = select({
      options: [
        ['PCFSoftShadowMap', 'PCF Soft (recommended)'],
        ['PCFShadowMap',     'PCF'],
        ['BasicShadowMap',   'Basic'],
        ['VSMShadowMap',     'VSM'],
      ],
      value: this._getShadowMapTypeName(),
      onChange: (v) => {
        window.dispatchEvent(new CustomEvent('cyco-shadow-map-change', { detail: { type: v } }));
        this._applyShadowMapType(v);
      },
    });
    shadowBody.appendChild(row('Shadow Map', shadowTypeSelect));

    const rendRef = window.__cyco?.rendererManager?.renderer;
    const shadowsEnabled = rendRef?.shadowMap?.enabled ?? true;
    const shadowCb = checkbox({
      checked: shadowsEnabled,
      onChange: (v) => {
        const r = window.__cyco?.rendererManager?.renderer;
        if (r) r.shadowMap.enabled = v;
      },
    });
    shadowBody.appendChild(row('Enable Shadows', shadowCb));

    // ── Tone Mapping ──
    const { el: tmSec, body: tmBody } = section('Tone Mapping');
    root.appendChild(tmSec);

    const curTM = rendRef?.toneMapping ?? THREE.ACESFilmicToneMapping;
    const tmSelect = select({
      options: [
        [THREE.NoToneMapping,          'None'],
        [THREE.LinearToneMapping,      'Linear'],
        [THREE.ReinhardToneMapping,    'Reinhard'],
        [THREE.CineonToneMapping,      'Cineon'],
        [THREE.ACESFilmicToneMapping,  'ACES Filmic'],
        [THREE.AgXToneMapping,         'AgX'],
        [THREE.NeutralToneMapping,     'Neutral'],
      ],
      value: String(curTM),
      onChange: (v) => {
        const r = window.__cyco?.rendererManager?.renderer;
        if (r) r.toneMapping = parseInt(v);
        window.dispatchEvent(new CustomEvent('cyco-tone-mapping-change', {
          detail: { mode: parseInt(v), exposure: parseFloat(expSlider.input.value) }
        }));
      },
    });
    tmBody.appendChild(row('Mode', tmSelect));

    const curExp = rendRef?.toneMappingExposure ?? 1.0;
    const expSlider = slider({
      value: curExp, min: 0, max: 5, step: 0.01,
      onChange: (v) => {
        const r = window.__cyco?.rendererManager?.renderer;
        if (r) r.toneMappingExposure = v;
      },
    });
    tmBody.appendChild(row('Exposure', expSlider.el));

    // ── Output ──
    const { el: outSec, body: outBody } = section('Output');
    root.appendChild(outSec);

    const pixelRatio = rendRef?.getPixelRatio?.() ?? window.devicePixelRatio;
    const prSelect = select({
      options: [
        ['1',   '1× (fastest)'],
        ['1.5', '1.5×'],
        ['2',   '2× (native)'],
      ],
      value: String(Math.round(pixelRatio * 2) / 2),
      onChange: (v) => {
        const r = window.__cyco?.rendererManager?.renderer;
        if (r) r.setPixelRatio(parseFloat(v));
      },
    });
    outBody.appendChild(row('Pixel Ratio', prSelect));

    return root;
  }

  _getShadowMapTypeName() {
    const t = window.__cyco?.rendererManager?.renderer?.shadowMap?.type;
    const map = {
      [THREE.BasicShadowMap]:   'BasicShadowMap',
      [THREE.PCFShadowMap]:     'PCFShadowMap',
      [THREE.PCFSoftShadowMap]: 'PCFSoftShadowMap',
      [THREE.VSMShadowMap]:     'VSMShadowMap',
    };
    return map[t] ?? 'PCFSoftShadowMap';
  }

  _applyShadowMapType(name) {
    const r = window.__cyco?.rendererManager?.renderer;
    if (!r) return;
    const map = {
      BasicShadowMap:   THREE.BasicShadowMap,
      PCFShadowMap:     THREE.PCFShadowMap,
      PCFSoftShadowMap: THREE.PCFSoftShadowMap,
      VSMShadowMap:     THREE.VSMShadowMap,
    };
    if (map[name] !== undefined) r.shadowMap.type = map[name];
  }

  _updatePathTracerVisibility(type, samplesRow) {
    samplesRow.style.display = type === 'pathtracer' ? '' : 'none';
  }

  _onSamples(event) {
    if (this._samplesLabel) {
      this._samplesLabel.textContent = String(event.detail?.samples ?? 0);
    }
  }

  dispose() {
    window.removeEventListener('cyco-pathtrace-samples', this._onSamples);
  }
}
