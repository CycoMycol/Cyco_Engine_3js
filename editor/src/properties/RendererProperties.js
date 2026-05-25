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

    // Shadow blur — PCF/VSM softness radius
    const curBlur = sunLight()?.shadow?.radius ?? 4;
    const blurSlider = slider({
      value: curBlur, min: 0, max: 25, step: 0.5,
      onChange: (v) => {
        const l = sunLight();
        if (l) l.shadow.radius = v;
      },
    });
    shadowBody.appendChild(row('Blur', blurSlider.el));

    // VSM blur samples (VSM shadow map only — higher = smoother but slower)
    const curSamples = sunLight()?.shadow?.blurSamples ?? 8;
    const blurSamplesSlider = slider({
      value: curSamples, min: 1, max: 25, step: 1,
      onChange: (v) => {
        const l = sunLight();
        if (l) l.shadow.blurSamples = Math.round(v);
      },
    });
    shadowBody.appendChild(row('Blur Samples', blurSamplesSlider.el));

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

    // Shadow direction — moves the sun light without changing sky colours
    const _getSunElev = () => {
      const l = sunLight();
      if (!l) return 30;
      return THREE.MathUtils.radToDeg(Math.asin(
        Math.max(-1, Math.min(1, l.position.y / (l.position.length() || 1)))
      ));
    };
    const _getSunAz = () => {
      const l = sunLight();
      if (!l) return 180;
      return (THREE.MathUtils.radToDeg(Math.atan2(l.position.x, l.position.z)) + 360) % 360;
    };
    const _applyDir = (elev, az) => {
      const l = sunLight();
      if (!l) return;
      const phi   = THREE.MathUtils.degToRad(90 - elev);
      const theta = THREE.MathUtils.degToRad(az);
      l.position.setFromSphericalCoords(200, phi, theta);
    };

    const sunElevSlider = slider({
      value: _getSunElev(), min: -10, max: 90, step: 0.5,
      onChange: (v) => _applyDir(v, parseFloat(sunAzSlider.input.value)),
    });
    shadowBody.appendChild(row('Elevation', sunElevSlider.el));

    const sunAzSlider = slider({
      value: _getSunAz(), min: 0, max: 360, step: 1,
      onChange: (v) => _applyDir(parseFloat(sunElevSlider.input.value), v),
    });
    shadowBody.appendChild(row('Rotation', sunAzSlider.el));

    // Shadow Area — controls the orthographic frustum size of the sun shadow camera.
    // Smaller = higher resolution shadows in a tighter area.
    // Larger  = shadows cover more of the scene but with lower texel density.
    const _getShadowArea = () => sunLight()?.shadow?.camera?.right ?? 50;
    const shadowAreaSlider = slider({
      value: _getShadowArea(), min: 5, max: 500, step: 5,
      onChange: (v) => {
        const l = sunLight();
        if (!l) return;
        l.shadow.camera.left   = -v;
        l.shadow.camera.right  =  v;
        l.shadow.camera.top    =  v;
        l.shadow.camera.bottom = -v;
        l.shadow.camera.updateProjectionMatrix();
        l.shadow.map?.dispose();
        l.shadow.map = null;
      },
    });
    shadowBody.appendChild(row('Shadow Area', shadowAreaSlider.el));

    // Shadow darkness — two-phase system to avoid PBR artifacts:
    //   Phase 1 (0–5):  shadow.intensity scales 0 → 1.0  (blocks direct light, no artifacts)
    //   Phase 2 (5–30): shadow.intensity stays at 1.0,
    //                   fill lights (ambient + hemi + IBL) scale from full → 0
    //                   so shadows go from "lit by ambient" toward solid black.
    //
    // shadow.intensity > 1.0 causes negative direct-light values in the PBR shader which
    // interact with roughness/metalness BRDF terms and tone-mapping to produce a warm/metallic
    // artifact in shadow areas — avoided entirely by capping at 1.0.
    const ve = window.__cyco?.viewportEngine;
    const _aLight = ve?._ambientLight;
    const _hLight = ve?._hemisphereLight;
    // Store base intensities on the objects the first time — survives panel re-opens.
    if (_aLight && _aLight._cyShadowBase === undefined) _aLight._cyShadowBase = _aLight.intensity;
    if (_hLight && _hLight._cyShadowBase === undefined) _hLight._cyShadowBase = _hLight.intensity;
    if (ve?.scene && ve.scene._cyShadowBaseEnvInt === undefined)
      ve.scene._cyShadowBaseEnvInt = ve.scene.environmentIntensity ?? 0;
    const _origAmbient = _aLight?._cyShadowBase ?? 0.3;
    const _origHemi    = _hLight?._cyShadowBase ?? 0.4;
    const _origEnvInt  = ve?.scene?._cyShadowBaseEnvInt ?? 0.4;

    let _sDarkness = 5.0;
    let _sOpacity  = 1.0;
    const _applyShadowStrength = () => {
      const l = sunLight();
      const d = Math.max(0, Math.min(30, _sDarkness));
      // Phase 1: shadow.intensity capped at 1.0 (no negative direct light)
      if (l?.shadow) l.shadow.intensity = Math.min(1.0, (d / 5) * _sOpacity);
      // Phase 2: reduce fill lights to push shadow area toward solid black
      const fill = d <= 5 ? 1.0 : Math.max(0, 1.0 - (d - 5) / 25);
      if (_aLight) _aLight.intensity         = _origAmbient * fill;
      if (_hLight) _hLight.intensity         = _origHemi    * fill;
      if (ve?.scene) ve.scene.environmentIntensity = _origEnvInt * fill;
    };
    // Back-calculate darkness from current shadow.intensity on open
    const _initInt = sunLight()?.shadow?.intensity;
    if (_initInt !== undefined) {
      _sDarkness = Math.min(5, Math.max(0, _initInt * 5));
    }

    const darkSlider = slider({
      value: _sDarkness, min: 0, max: 30, step: 0.1,
      onChange: (v) => { _sDarkness = v; _applyShadowStrength(); },
    });
    shadowBody.appendChild(row('Darkness', darkSlider.el));

    const opacSlider = slider({
      value: _sOpacity, min: 0, max: 1, step: 0.01,
      onChange: (v) => { _sOpacity = v; _applyShadowStrength(); },
    });
    shadowBody.appendChild(row('Opacity', opacSlider.el));

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
