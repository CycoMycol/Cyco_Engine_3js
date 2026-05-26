/**
 * PostProcessingProperties.js
 * Controls for the post-processing pipeline (bloom, outline, ambient occlusion, output).
 *
 * Events dispatched:
 *   cyco-pp-bloom-change   { enabled, threshold, strength, radius }
 *   cyco-pp-outline-change { enabled, color, thickness }
 *   cyco-pp-output-change  { toneMapping, exposure }
 */

import { section, row, slider, checkbox, colorSwatch, select } from './propUtils.js';

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

    const isWebGPU = rendType === 'webgpu';

    this._buildEffectComposerSection(root, isWebGPU);
    this._buildBloomSection(root, isWebGPU);
    this._buildOutlineSection(root, isWebGPU);
    this._buildAmbientOcclusionSection(root, isWebGPU);
    this._buildOutputSection(root);

    return root;
  }
  // ── Effect Composer ────────────────────────────────────────────────────────────

  _buildEffectComposerSection(root, isWebGPU) {
    const { el, body } = section('Effect Composer');
    root.appendChild(el);

    if (isWebGPU) {
      const note = document.createElement('div');
      note.style.cssText = 'padding:8px 12px;font-size:11px;color:var(--text-secondary,#888);line-height:1.5;';
      note.textContent = 'Effect Composer uses WebGL. Not available in WebGPU mode.';
      body.appendChild(note);
      return;
    }

    // Always look up the pipeline fresh so changes made after a resize/rebuild
    // still reach the live EffectComposer instance.
    const getPP = () => window.__cyco?.viewportEngine?.postProcessing;

    // Enable / disable the entire EffectComposer pipeline
    const enabledCb = checkbox({
      checked: getPP()?._pipelineEnabled !== false,
      onChange: (v) => {
        const pp = getPP(); if (pp) pp.pipelineEnabled = v;
      },
    });
    body.appendChild(row('Enabled', enabledCb));
  }
  // ── Bloom ─────────────────────────────────────────────────────────────────

  _buildBloomSection(root, isWebGPU) {
    const { el, body } = section(isWebGPU ? 'Bloom (TSL)' : 'Bloom (Unreal)');
    root.appendChild(el);

    // TSL bloom path (WebGPU)
    if (isWebGPU) {
      const getPP = () => window.__cyco?.viewportEngine?.postProcessing;
      const getParams = () => getPP()?._bloomParams ?? {};

      const dispatch = (overrides) => {
        const p = getParams();
        this._dispatch('cyco-pp-bloom-change', { ...p, ...overrides });
      };

      const enabledCb = checkbox({
        checked: getParams().enabled !== false,
        onChange: (v) => {
          const pp = getPP();
          if (pp) window.dispatchEvent(new CustomEvent('cyco-pp-settings', { detail: { pass: 'bloom', prop: 'enabled', value: v } }));
          dispatch({ enabled: v });
        },
      });
      body.appendChild(row('Enabled', enabledCb));

      const threshSlider = slider({
        value: getParams().threshold ?? 0.85, min: 0, max: 3, step: 0.01,
        onChange: (v) => {
          window.dispatchEvent(new CustomEvent('cyco-pp-settings', { detail: { pass: 'bloom', prop: 'threshold', value: v } }));
          dispatch({ threshold: v });
        },
      });
      body.appendChild(row('Threshold', threshSlider.el));

      const strengthSlider = slider({
        value: getParams().strength ?? 0.8, min: 0, max: 5, step: 0.01,
        onChange: (v) => {
          window.dispatchEvent(new CustomEvent('cyco-pp-settings', { detail: { pass: 'bloom', prop: 'strength', value: v } }));
          dispatch({ strength: v });
        },
      });
      body.appendChild(row('Strength', strengthSlider.el));

      const radiusSlider = slider({
        value: getParams().radius ?? 0.4, min: 0, max: 1, step: 0.01,
        onChange: (v) => {
          window.dispatchEvent(new CustomEvent('cyco-pp-settings', { detail: { pass: 'bloom', prop: 'radius', value: v } }));
          dispatch({ radius: v });
        },
      });
      body.appendChild(row('Radius', radiusSlider.el));

      this._bloomSliders = { threshold: threshSlider, strength: strengthSlider, radius: radiusSlider };
      return;
    }

    // WebGL UnrealBloomPass path
    // Fresh lookup every time so closures always hit the live pass after any rebuild.
    const getBloom = () => window.__cyco?.viewportEngine?.postProcessing?.bloomPass;
    const bloom = getBloom();

    const enabledCb = checkbox({
      checked: bloom ? bloom.enabled !== false : true,
      onChange: (v) => {
        const p = getBloom(); if (p) p.enabled = v;
        this._dispatch('cyco-pp-bloom-change', { enabled: v, ...this._bloomState() });
      },
    });
    body.appendChild(row('Enabled', enabledCb));

    const threshSlider = slider({
      value: bloom?.threshold ?? 0.85, min: 0, max: 3, step: 0.01,
      onChange: (v) => {
        const p = getBloom(); if (p) p.threshold = v;
        this._dispatch('cyco-pp-bloom-change', { enabled: enabledCb.checked, ...this._bloomState() });
      },
    });
    body.appendChild(row('Threshold', threshSlider.el));

    const strengthSlider = slider({
      value: bloom?.strength ?? 0.8, min: 0, max: 5, step: 0.01,
      onChange: (v) => {
        const p = getBloom(); if (p) p.strength = v;
        this._dispatch('cyco-pp-bloom-change', { enabled: enabledCb.checked, ...this._bloomState() });
      },
    });
    body.appendChild(row('Strength', strengthSlider.el));

    const radiusSlider = slider({
      value: bloom?.radius ?? 0.4, min: 0, max: 1, step: 0.01,
      onChange: (v) => {
        const p = getBloom(); if (p) p.radius = v;
        this._dispatch('cyco-pp-bloom-change', { enabled: enabledCb.checked, ...this._bloomState() });
      },
    });
    body.appendChild(row('Radius', radiusSlider.el));

    this._bloomSliders = { threshold: threshSlider, strength: strengthSlider, radius: radiusSlider };
  }

  _bloomState() {
    const pass = window.__cyco?.viewportEngine?.postProcessing?.bloomPass;
    return { threshold: pass?.threshold ?? 0.85, strength: pass?.strength ?? 0.8, radius: pass?.radius ?? 0.4 };
  }

  // ── Outline ───────────────────────────────────────────────────────────────

  _buildOutlineSection(root, isWebGPU) {
    const { el, body } = section('Outline');
    root.appendChild(el);

    if (isWebGPU) {
      const note = document.createElement('div');
      note.style.cssText = 'padding:8px 12px;font-size:11px;color:var(--text-secondary,#888);line-height:1.5;';
      note.textContent = 'Outline pass uses WebGL. Not available in WebGPU mode.';
      body.appendChild(note);
      return;
    }

    const getOutline = () => window.__cyco?.viewportEngine?.postProcessing?.outlinePass;
    const outlinePass = getOutline();

    const enabledCb = checkbox({
      checked: outlinePass?.enabled ?? true,
      onChange: (v) => { const p = getOutline(); if (p) p.enabled = v; },
    });
    body.appendChild(row('Enabled', enabledCb));

    const curColor = '#' + (outlinePass?.visibleEdgeColor?.getHexString() ?? 'ff6600');
    const colorSw = colorSwatch({
      color: curColor,
      onChange: (c) => { const p = getOutline(); if (p) p.visibleEdgeColor.set(c); },
    });
    body.appendChild(row('Color', colorSw.el));

    const thickSlider = slider({
      value: outlinePass?.edgeThickness ?? 1, min: 0.1, max: 5, step: 0.1,
      onChange: (v) => { const p = getOutline(); if (p) p.edgeThickness = v; },
    });
    body.appendChild(row('Thickness', thickSlider.el));

    const strengthSlider = slider({
      value: outlinePass?.edgeStrength ?? 3, min: 0, max: 10, step: 0.1,
      onChange: (v) => { const p = getOutline(); if (p) p.edgeStrength = v; },
    });
    body.appendChild(row('Strength', strengthSlider.el));
  }

  // ── Ambient Occlusion ─────────────────────────────────────────────────────

  _buildAmbientOcclusionSection(root, isWebGPU) {
    const { el, body } = section('Ambient Occlusion');
    root.appendChild(el);

    const getPP = () => window.__cyco?.viewportEngine?.postProcessing;

    // ─ Enabled checkbox ────────────────────────────────────────────────────
    const enabledCb = checkbox({
      checked: getPP()?._aoEnabled ?? false,
      onChange: (v) => {
        const pp = getPP();
        if (pp) pp.setAoEnabled(v);
        this._rebuildAoControls(controlsContainer, typeSelect);
      },
    });
    body.appendChild(row('Enabled', enabledCb));

    // ─ Type dropdown ───────────────────────────────────────────────────────
    const defaultAoType = isWebGPU ? 'ao_webgpu' : 'gtao';
    const typeSelect = select({
      options: [
        ['gtao',      'GTAO (WebGL)'],
        ['sao',       'SAO (WebGL)'],
        ['ssao',      'SSAO (WebGL)'],
        ['ao_webgpu', 'AO (WebGPU)'],
      ],
      value: getPP()?._aoType ?? defaultAoType,
      onChange: (v) => {
        const pp = getPP();
        if (!pp) return;
        if (pp._aoEnabled) {
          pp.setAoType(v);            // rebuilds pipeline with new AO type
        } else {
          pp._aoType = v;             // store choice for when AO is enabled
        }
        this._rebuildAoControls(controlsContainer, typeSelect);
      },
    });
    body.appendChild(row('Type', typeSelect));

    // ─ Dynamic controls container ──────────────────────────────────────────
    const controlsContainer = document.createElement('div');
    body.appendChild(controlsContainer);
    this._rebuildAoControls(controlsContainer, typeSelect);
  }

  /** Swap the parameter controls inside the AO section based on the selected type. */
  _rebuildAoControls(container, typeSelect) {
    container.innerHTML = '';
    const getPP    = () => window.__cyco?.viewportEngine?.postProcessing;
    const type     = typeSelect.value;
    const rendType = window.__cyco?.rendererManager?.activeType ?? 'webgl';

    if (type === 'ao_webgpu') {
      if (rendType !== 'webgpu') {
        // Wrong renderer — show hint
        const msg = document.createElement('div');
        msg.style.cssText = 'padding:8px 12px;font-size:11px;color:var(--text-secondary,#888);line-height:1.5;';
        msg.textContent = 'AO (WebGPU) requires the WebGPU renderer. Switch the renderer type in Renderer → Type to use this mode.';
        container.appendChild(msg);
        return;
      }
      // WebGPU is active — show GTAO parameter controls.
      this._buildGtaoControls(container, getPP);
      return;
    }

    if (type === 'gtao')       this._buildGtaoControls(container, getPP);
    else if (type === 'sao')   this._buildSaoControls(container, getPP);
    else if (type === 'ssao')  this._buildSsaoControls(container, getPP);
  }

  /** GTAO parameter sliders (AO + Poisson Denoise). */
  _buildGtaoControls(container, getPP) {
    const getAo = () => getPP()?._aoGtaoParams ?? {};
    const getPd = () => getPP()?._aoPdParams   ?? {};

    const outputSel = select({
      options: [[0,'Composite'],[4,'AO Only'],[5,'Denoise'],[1,'Diffuse'],[2,'Depth'],[3,'Normal']],
      value: getAo().output ?? 0,
      onChange: v => { const pp = getPP(); if (pp) pp.setAoOutputMode(+v); },
    });
    container.appendChild(row('Output', outputSel));

    const aoSliders = [
      ['Radius',            'radius',           0.01, 1,    0.01 ],
      ['Distance Exp.',     'distanceExponent',  1,    4,    0.01 ],
      ['Thickness',         'thickness',         0.01, 10,   0.01 ],
      ['Distance Fall Off', 'distanceFallOff',   0,    1,    0.01 ],
      ['Scale',             'scale',             0.01, 2,    0.01 ],
      ['Samples',           'samples',           2,    32,   1    ],
    ];
    for (const [label, key, mn, mx, step] of aoSliders) {
      const sl = slider({
        value: getAo()[key] ?? mn, min: mn, max: mx, step,
        onChange: (v) => {
          const pp = getPP(); if (!pp) return;
          pp.updateGtaoParams({ [key]: key === 'samples' ? Math.round(v) : v });
        },
      });
      container.appendChild(row(label, sl.el));
    }

    // Denoise sub-header
    const subHdr = document.createElement('div');
    subHdr.style.cssText = 'padding:6px 12px 2px;font-size:10px;color:var(--text-secondary,#888);font-weight:600;letter-spacing:0.06em;text-transform:uppercase;';
    subHdr.textContent = 'Poisson Denoise';
    container.appendChild(subHdr);

    const pdSliders = [
      ['Luma Phi',    'lumaPhi',        0,    20,   0.01  ],
      ['Depth Phi',   'depthPhi',       0.01, 20,   0.01  ],
      ['Normal Phi',  'normalPhi',      0.01, 20,   0.01  ],
      ['Radius',      'radius',         0,    32,   1     ],
      ['Radius Exp.', 'radiusExponent', 0.1,  4,    0.1   ],
      ['Rings',       'rings',          1,    16,   0.125 ],
      ['Samples',     'samples',        2,    32,   1     ],
    ];
    for (const [label, key, mn, mx, step] of pdSliders) {
      const sl = slider({
        value: getPd()[key] ?? mn, min: mn, max: mx, step,
        onChange: (v) => {
          const pp = getPP(); if (!pp) return;
          pp.updatePdParams({ [key]: key === 'samples' ? Math.round(v) : v });
        },
      });
      container.appendChild(row(label, sl.el));
    }
  }

  /** SAO parameter sliders. */
  _buildSaoControls(container, getPP) {
    const getP = () => getPP()?._aoSaoParams ?? {};

    const outputSel = select({
      options: [[0,'Composite'],[1,'AO Only'],[2,'Normal']],
      value: getP().output ?? 0,
      onChange: v => { const pp = getPP(); if (pp) pp.setAoOutputMode(+v); },
    });
    container.appendChild(row('Output', outputSel));

    const sliders = [
      ['Bias',              'saoBias',            -1,   1,    0.01  ],
      ['Intensity',         'saoIntensity',         0,   1,    0.01  ],
      ['Scale',             'saoScale',             0,   10000, 10   ],
      ['Kernel Radius',     'saoKernelRadius',      1,   100,  1     ],
      ['Min Resolution',    'saoMinResolution',     0,   1,    0.001 ],
      ['Blur Radius',       'saoBlurRadius',        0,   200,  1     ],
      ['Blur Std Dev',      'saoBlurStdDev',        0.5, 150,  0.5   ],
      ['Blur Depth Cutoff', 'saoBlurDepthCutoff',   0,   0.1,  0.001 ],
    ];
    for (const [label, key, mn, mx, step] of sliders) {
      const sl = slider({
        value: getP()[key] ?? mn, min: mn, max: mx, step,
        onChange: (v) => { const pp = getPP(); if (pp) pp.updateSaoParams({ [key]: v }); },
      });
      container.appendChild(row(label, sl.el));
    }

    const blurCb = checkbox({
      checked: getP().saoBlur !== false,
      onChange: (v) => { const pp = getPP(); if (pp) pp.updateSaoParams({ saoBlur: v }); },
    });
    container.appendChild(row('Blur', blurCb));
  }

  /** SSAO parameter sliders. */
  _buildSsaoControls(container, getPP) {
    const getP = () => getPP()?._aoSsaoParams ?? {};

    const outputSel = select({
      options: [[0,'Composite'],[1,'AO Only'],[2,'AO + Blur'],[3,'Depth'],[4,'Normal']],
      value: getP().output ?? 0,
      onChange: v => { const pp = getPP(); if (pp) pp.setAoOutputMode(+v); },
    });
    container.appendChild(row('Output', outputSel));

    // minDistance / maxDistance are normalised linear depth (0–1).
    // With camera near=0.1, far=10000 a 1-world-unit step at z=10 ≈ 0.0001.
    const sliders = [
      ['Kernel Radius', 'kernelRadius', 0,       32,    0.5     ],
      ['Min Distance',  'minDistance',  0,        0.005, 0.00001 ],
      ['Max Distance',  'maxDistance',  0,        0.05,  0.0001  ],
    ];
    for (const [label, key, mn, mx, step] of sliders) {
      const sl = slider({
        value: getP()[key] ?? mn, min: mn, max: mx, step,
        onChange: (v) => { const pp = getPP(); if (pp) pp.updateSsaoParams({ [key]: v }); },
      });
      container.appendChild(row(label, sl.el));
    }
  }

  // ── Output ────────────────────────────────────────────────────────────────

  _buildOutputSection(root) {
    const { el, body } = section('Output');
    root.appendChild(el);

    const getR = () => window.__cyco?.rendererManager?.renderer;
    const expSlider = slider({
      value: getR()?.toneMappingExposure ?? 1, min: 0, max: 5, step: 0.01,
      onChange: (v) => { const r = getR(); if (r) r.toneMappingExposure = v; },
    });
    body.appendChild(row('Exposure', expSlider.el));
  }

  _dispatch(type, detail) {
    window.dispatchEvent(new CustomEvent(type, { detail }));
  }

  dispose() {}
}
