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
        ['PCFShadowMap',     'PCF Soft (recommended)'],
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

    // Shadow map size — applies to the sun directional light
    const sunLight = () => window.__cyco?.viewportEngine?.gradientSky?.sunLight;
    const curMapSize = sunLight()?.shadow?.mapSize?.width ?? 2048;
    const mapSizeSelect = select({
      options: [
        ['512',  '512  (fast)'],
        ['1024', '1024'],
        ['2048', '2048 (default)'],
        ['4096', '4096 (high quality)'],
      ],
      value: String(curMapSize),
      onChange: (v) => {
        const l = sunLight();
        if (!l) return;
        const s = parseInt(v, 10);
        l.shadow.mapSize.width  = s;
        l.shadow.mapSize.height = s;
        l.shadow.map?.dispose();
        l.shadow.map = null;
      },
    });
    shadowBody.appendChild(row('Map Size', mapSizeSelect));

    // Sun shadow radius (PCF softness)
    const curRadius = sunLight()?.shadow?.radius ?? 3;
    const radiusSlider = slider({
      value: curRadius, min: 0, max: 16, step: 0.5,
      onChange: (v) => {
        const l = sunLight();
        if (l) l.shadow.radius = v;
      },
    });
    shadowBody.appendChild(row('Radius', radiusSlider.el));

    // Sun shadow bias
    const curBias = sunLight()?.shadow?.bias ?? -0.0005;
    const biasSlider = slider({
      value: curBias, min: -0.01, max: 0.01, step: 0.0001,
      onChange: (v) => {
        const l = sunLight();
        if (l) l.shadow.bias = v;
      },
    });
    shadowBody.appendChild(row('Bias', biasSlider.el));

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

    // ── Anti-Aliasing ──
    const { el: aaSec, body: aaBody } = section('Anti-Aliasing');
    root.appendChild(aaSec);

    const pp = window.__cyco?.viewportEngine?.postProcessing;
    const curAA = pp?._aaMode ?? 'none';
    const aaSelect = select({
      options: [
        ['none',  'None'],
        ['fxaa',  'FXAA  (fast, all platforms)'],
        ['smaa',  'SMAA  (better quality)'],
        ['msaa2', 'MSAA ×2  (hardware, WebGL2)'],
        ['msaa4', 'MSAA ×4  (hardware, WebGL2)'],
      ],
      value: curAA,
      onChange: (v) => {
        const pipeline = window.__cyco?.viewportEngine?.postProcessing;
        if (pipeline) pipeline.setAntiAliasMode(v);
      },
    });
    aaBody.appendChild(row('Mode', aaSelect));

    // ── Color Grading (LUT) ──
    const { el: lutSec, body: lutBody } = section('Color Grading');
    root.appendChild(lutSec);

    const lutEnabled = pp?._lutEnabled ?? false;
    const lutCb = checkbox({
      checked: lutEnabled,
      onChange: (v) => {
        const pipeline = window.__cyco?.viewportEngine?.postProcessing;
        if (pipeline) pipeline.setLutEnabled(v);
      },
    });
    const lutClearBtn = document.createElement('button');
    lutClearBtn.textContent = 'Clear';
    lutClearBtn.className   = 'ce-btn-small';
    lutClearBtn.title       = 'Remove the loaded LUT and disable color grading';
    lutClearBtn.addEventListener('click', () => {
      const pipeline = window.__cyco?.viewportEngine?.postProcessing;
      if (pipeline) {
        pipeline.clearLut();
        lutCb.checked = false;
      }
    });
    const lutEnableRow = document.createElement('div');
    lutEnableRow.style.cssText = 'display:flex;align-items:center;gap:6px;';
    lutEnableRow.appendChild(lutCb);
    lutEnableRow.appendChild(lutClearBtn);
    lutBody.appendChild(row('Enable LUT', lutEnableRow));

    const lutIntensity = pp?._lutIntensity ?? 1.0;
    const lutIntSlider = slider({
      value: lutIntensity, min: 0, max: 1, step: 0.01,
      onChange: (v) => {
        const pipeline = window.__cyco?.viewportEngine?.postProcessing;
        if (pipeline) pipeline.setLutIntensity(v);
      },
    });
    lutBody.appendChild(row('Intensity', lutIntSlider.el));

    const lutFileBtn = document.createElement('button');
    lutFileBtn.textContent = 'Load .cube File…';
    lutFileBtn.className = 'ce-btn-small';
    lutFileBtn.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.cube,.CUBE';
      input.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const pipeline = window.__cyco?.viewportEngine?.postProcessing;
        if (pipeline) pipeline.loadLutFromFile(file);
      });
      input.click();
    });
    lutBody.appendChild(row('LUT File', lutFileBtn));

    return root;
  }

  _getShadowMapTypeName() {
    const t = window.__cyco?.rendererManager?.renderer?.shadowMap?.type;
    const map = {
      [THREE.BasicShadowMap]:   'BasicShadowMap',
      [THREE.PCFShadowMap]:     'PCFShadowMap',
      [THREE.VSMShadowMap]:     'VSMShadowMap',
    };
    return map[t] ?? 'PCFShadowMap';
  }

  _applyShadowMapType(name) {
    const r = window.__cyco?.rendererManager?.renderer;
    if (!r) return;
    const map = {
      BasicShadowMap:   THREE.BasicShadowMap,
      PCFShadowMap:     THREE.PCFShadowMap,
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
