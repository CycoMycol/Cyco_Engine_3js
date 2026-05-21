/**
 * PostProcessingProperties.js
 * Controls for the post-processing pipeline (bloom, outline, GTAO, output).
 *
 * Events dispatched:
 *   cyco-pp-bloom-change   { enabled, threshold, strength, radius }
 *   cyco-pp-outline-change { enabled, color, thickness }
 *   cyco-pp-gtao-change    { enabled, radius, intensity, distanceExponent }
 *   cyco-pp-output-change  { toneMapping, exposure }
 */

import * as THREE from 'three';
import { section, row, slider, checkbox, colorSwatch, readOnly } from './propUtils.js';

export class PostProcessingProperties {
  constructor() {
    this._element = this._build();
  }

  get element() { return this._element; }

  _build() {
    const root = document.createElement('div');
    root.className = 'ce-props-root';

    const hdr = document.createElement('div');
    hdr.className = 'ce-prop-name-header';
    hdr.innerHTML = '<div class="ce-prop-name-title">Post Processing</div>';
    root.appendChild(hdr);

    // Disabled notice for certain renderers
    const rendType = window.__cyco?.rendererManager?.currentType ?? 'webgl';
    if (['svg', 'css3d', 'pathtracer'].includes(rendType)) {
      const notice = document.createElement('div');
      notice.style.cssText = 'padding:12px;font-size:12px;color:var(--text-secondary,#888);';
      notice.textContent = 'Post-processing is not available for the current renderer.';
      root.appendChild(notice);
      return root;
    }

    this._buildBloomSection(root);
    this._buildOutlineSection(root);
    this._buildGTAOSection(root);
    this._buildOutputSection(root);

    return root;
  }

  // ── Bloom ─────────────────────────────────────────────────────────────────

  _buildBloomSection(root) {
    const { el, body } = section('Bloom (Unreal)');
    root.appendChild(el);

    const pp = window.__cyco?.viewportEngine?.postProcessing;
    const bloomPass = pp?.bloomPass;

    const enabledCb = checkbox({
      checked: bloomPass ? !bloomPass.enabled === false : false,
      onChange: (v) => {
        if (bloomPass) bloomPass.enabled = v;
        this._dispatch('cyco-pp-bloom-change', { enabled: v, ...this._bloomState() });
      },
    });
    body.appendChild(row('Enabled', enabledCb));

    const threshSlider = slider({
      value: bloomPass?.threshold ?? 0.85, min: 0, max: 2, step: 0.01,
      onChange: (v) => {
        if (bloomPass) bloomPass.threshold = v;
        this._dispatch('cyco-pp-bloom-change', { enabled: enabledCb.checked, ...this._bloomState() });
      },
    });
    body.appendChild(row('Threshold', threshSlider.el));

    const strengthSlider = slider({
      value: bloomPass?.strength ?? 0.3, min: 0, max: 3, step: 0.01,
      onChange: (v) => {
        if (bloomPass) bloomPass.strength = v;
        this._dispatch('cyco-pp-bloom-change', { enabled: enabledCb.checked, ...this._bloomState() });
      },
    });
    body.appendChild(row('Strength', strengthSlider.el));

    const radiusSlider = slider({
      value: bloomPass?.radius ?? 0.4, min: 0, max: 1, step: 0.01,
      onChange: (v) => {
        if (bloomPass) bloomPass.radius = v;
        this._dispatch('cyco-pp-bloom-change', { enabled: enabledCb.checked, ...this._bloomState() });
      },
    });
    body.appendChild(row('Radius', radiusSlider.el));

    this._bloomSliders = { threshold: threshSlider, strength: strengthSlider, radius: radiusSlider };
  }

  _bloomState() {
    const pass = window.__cyco?.viewportEngine?.postProcessing?.bloomPass;
    return { threshold: pass?.threshold ?? 0.85, strength: pass?.strength ?? 0.3, radius: pass?.radius ?? 0.4 };
  }

  // ── Outline ───────────────────────────────────────────────────────────────

  _buildOutlineSection(root) {
    const { el, body } = section('Outline');
    root.appendChild(el);

    const pp = window.__cyco?.viewportEngine?.postProcessing;
    const outlinePass = pp?.outlinePass;

    const enabledCb = checkbox({
      checked: outlinePass?.enabled ?? true,
      onChange: (v) => {
        if (outlinePass) outlinePass.enabled = v;
      },
    });
    body.appendChild(row('Enabled', enabledCb));

    const curColor = '#' + (outlinePass?.visibleEdgeColor?.getHexString() ?? 'ff6600');
    const colorSw = colorSwatch({
      color: curColor,
      onChange: (c) => {
        if (outlinePass) outlinePass.visibleEdgeColor.set(c);
      },
    });
    body.appendChild(row('Color', colorSw.el));

    const thickSlider = slider({
      value: outlinePass?.edgeThickness ?? 1, min: 0.1, max: 5, step: 0.1,
      onChange: (v) => {
        if (outlinePass) outlinePass.edgeThickness = v;
      },
    });
    body.appendChild(row('Thickness', thickSlider.el));

    const strengthSlider = slider({
      value: outlinePass?.edgeStrength ?? 3, min: 0, max: 10, step: 0.1,
      onChange: (v) => {
        if (outlinePass) outlinePass.edgeStrength = v;
      },
    });
    body.appendChild(row('Strength', strengthSlider.el));
  }

  // ── GTAO ─────────────────────────────────────────────────────────────────

  _buildGTAOSection(root) {
    const { el, body } = section('Ambient Occlusion (GTAO)');
    root.appendChild(el);

    const pp = window.__cyco?.viewportEngine?.postProcessing;
    const gtaoPass = pp?.gtaoPass;

    const enabledCb = checkbox({
      checked: gtaoPass?.enabled ?? false,
      onChange: (v) => {
        if (gtaoPass) gtaoPass.enabled = v;
      },
    });
    body.appendChild(row('Enabled', enabledCb));

    if (!gtaoPass) {
      body.appendChild(readOnly('GTAO not available (WebGL only or not initialised)'));
      return;
    }

    const radiusSlider = slider({
      value: gtaoPass?.radius ?? 0.25, min: 0.01, max: 1, step: 0.01,
      onChange: (v) => { if (gtaoPass) gtaoPass.radius = v; },
    });
    body.appendChild(row('Radius', radiusSlider.el));

    const intensitySlider = slider({
      value: gtaoPass?.intensity ?? 1, min: 0, max: 5, step: 0.05,
      onChange: (v) => { if (gtaoPass) gtaoPass.intensity = v; },
    });
    body.appendChild(row('Intensity', intensitySlider.el));

    const distExpSlider = slider({
      value: gtaoPass?.distanceExponent ?? 1, min: 0.1, max: 3, step: 0.1,
      onChange: (v) => { if (gtaoPass) gtaoPass.distanceExponent = v; },
    });
    body.appendChild(row('Dist. Exponent', distExpSlider.el));
  }

  // ── Output ────────────────────────────────────────────────────────────────

  _buildOutputSection(root) {
    const { el, body } = section('Output');
    root.appendChild(el);

    const r = window.__cyco?.rendererManager?.renderer;
    const expSlider = slider({
      value: r?.toneMappingExposure ?? 1, min: 0, max: 5, step: 0.01,
      onChange: (v) => {
        if (r) r.toneMappingExposure = v;
      },
    });
    body.appendChild(row('Exposure', expSlider.el));
  }

  _dispatch(type, detail) {
    window.dispatchEvent(new CustomEvent(type, { detail }));
  }

  dispose() {}
}
