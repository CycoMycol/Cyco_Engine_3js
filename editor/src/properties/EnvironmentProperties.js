/**
 * EnvironmentProperties.js
 * Background, sky, clouds, fog, and environment map settings panel.
 *
 * Events dispatched:
 *   cyco-background-change  { type, color?, topColor?, horizonColor?, bottomColor? }
 *   cyco-fog-change         { type, color, near, far, density }
 *   cyco-sky-change         { enabled, elevation, azimuth, colorStops, opacityStops,
 *                             showSun, sunColor, sunGlowStrength, showMoon, moonColor }
 *   cyco-env-map-change     { url, isHDR }
 *   cyco-env-preset         { preset }
 */

import * as THREE from 'three';
import { section, row, select, slider, checkbox, colorSwatch } from './propUtils.js';
import { GradientEditor } from '../ui/GradientEditor.js';

export class EnvironmentProperties {
  constructor() {
    this._solidColor  = '#1a1a1a';
    this._gradTop     = '#87ceeb';
    this._gradHorizon = '#d4a56a';
    this._gradBottom  = '#4a3b2a';
    this._skyEnabledCb = null; // cross-reference set by _buildSkySection
    this._element = this._build();
  }

  get element() { return this._element; }

  _build() {
    const root = document.createElement('div');
    root.className = 'ce-props-root';

    const hdr = document.createElement('div');
    hdr.className = 'ce-prop-name-header';
    hdr.innerHTML = '<div class="ce-prop-name-title">Environment</div>';
    root.appendChild(hdr);

    this._buildBackgroundSection(root);
    this._buildSkySection(root);
    this._buildCloudSection(root);
    this._buildLowCloudsSection(root);
    this._buildFogSection(root);
    this._buildEnvMapSection(root);

    return root;
  }

  // ── Background ────────────────────────────────────────────────────────────

  _buildBackgroundSection(root) {
    const { el, body } = section('Background');
    root.appendChild(el);

    const ve = window.__cyco?.viewportEngine;

    // Detect current bg type
    let initType = 'solid';
    if (ve?.skyEnabled) initType = 'sky';
    else if (ve?.scene?.background instanceof THREE.Texture) initType = 'hdri';

    const typeSelect = select({
      options: [
        ['solid',    'Solid Color'],
        ['gradient', 'Gradient'],
        ['sky',      'Sky (Procedural)'],
        ['hdri',     'HDRI / Env Map'],
      ],
      value: initType,
      onChange: (v) => {
        _showRows(v);
        this._dispatchBackground(v);
        // When the user picks "Sky", auto-enable the sky mesh too
        if (v === 'sky') {
          if (this._skyEnabledCb) this._skyEnabledCb.checked = true;
          this._fireSkyChange(true);
        } else {
          // Switching away from sky — disable it
          if (this._skyEnabledCb) this._skyEnabledCb.checked = false;
          window.dispatchEvent(new CustomEvent('cyco-sky-change', { detail: { enabled: false } }));
        }
      },
    });
    body.appendChild(row('Type', typeSelect));

    // Solid color
    const curBgColor = ve?.scene?.background instanceof THREE.Color
      ? '#' + ve.scene.background.getHexString()
      : '#1a1a1a';
    this._solidColor = curBgColor;
    const solidColorSw = colorSwatch({
      color: curBgColor,
      onChange: (c) => { this._solidColor = c; this._dispatchBackground('solid'); },
    });
    const solidRow = row('Color', solidColorSw.el);
    body.appendChild(solidRow);

    // Gradient colors
    const topColorSw = colorSwatch({ color: this._gradTop, onChange: (c) => {
      this._gradTop = c; this._dispatchBackground('gradient');
    }});
    const horizColorSw = colorSwatch({ color: this._gradHorizon, onChange: (c) => {
      this._gradHorizon = c; this._dispatchBackground('gradient');
    }});
    const botColorSw = colorSwatch({ color: this._gradBottom, onChange: (c) => {
      this._gradBottom = c; this._dispatchBackground('gradient');
    }});
    const gradTopRow  = row('Top Color',     topColorSw.el);
    const gradHorRow  = row('Horizon Color', horizColorSw.el);
    const gradBotRow  = row('Bottom Color',  botColorSw.el);
    body.appendChild(gradTopRow);
    body.appendChild(gradHorRow);
    body.appendChild(gradBotRow);

    // HDRI show-as-background toggle
    const hdriBgCb = checkbox({
      checked: !!(ve?.scene?.background instanceof THREE.Texture),
      onChange: (v) => {
        window.dispatchEvent(new CustomEvent('cyco-env-background-toggle', { detail: { enabled: v } }));
      },
    });
    const hdriRow = row('Show HDRI as BG', hdriBgCb);
    body.appendChild(hdriRow);

    const _showRows = (type) => {
      solidRow.style.display   = type === 'solid'    ? '' : 'none';
      gradTopRow.style.display = type === 'gradient' ? '' : 'none';
      gradHorRow.style.display = type === 'gradient' ? '' : 'none';
      gradBotRow.style.display = type === 'gradient' ? '' : 'none';
      hdriRow.style.display    = type === 'hdri'     ? '' : 'none';
    };
    _showRows(initType);
  }

  _dispatchBackground(type) {
    window.dispatchEvent(new CustomEvent('cyco-background-change', {
      detail: {
        type,
        color:        this._solidColor,
        topColor:     this._gradTop,
        horizonColor: this._gradHorizon,
        bottomColor:  this._gradBottom,
      }
    }));
  }

  // ── Sky ───────────────────────────────────────────────────────────────────

  _buildSkySection(root) {
    const { el, body } = section('Sky');
    root.appendChild(el);

    const ve = window.__cyco?.viewportEngine;

    const _fire = (autoEnable = false) => {
      if (autoEnable && enabledCb && !enabledCb.checked) {
        enabledCb.checked = true;
      }
      this._fireSkyChange(autoEnable ? true : (enabledCb?.checked ?? false));
    };

    const enabledCb = checkbox({ checked: !!ve?.skyEnabled, onChange: () => _fire() });
    this._skyEnabledCb = enabledCb;
    body.appendChild(row('Show Sky', enabledCb));

    // Day/Night slider: 0 = night (elevation -5), 1 = midday (elevation 70)
    const dayNightSlider = slider({
      value: 0.47, min: 0, max: 1, step: 0.01,
      onChange: (v) => {
        const elev = +(v * 75 - 5).toFixed(1);
        elevationSlider.input.value = elev;
        elevationSlider.input.dispatchEvent(new Event('input'));
        _fire(true);
      },
    });
    body.appendChild(row('Day / Night', dayNightSlider.el));

    const elevationSlider = slider({
      value: ve?.skyElevation ?? 30, min: -10, max: 90, step: 0.5,
      onChange: () => _fire(true),
    });
    body.appendChild(row('Elevation', elevationSlider.el));

    const azimuthSlider = slider({
      value: ve?.skyAzimuth ?? 180, min: 0, max: 360, step: 1,
      onChange: () => _fire(true),
    });
    body.appendChild(row('Azimuth', azimuthSlider.el));

    // ── Exposure / Saturation / Contrast ────────────────────────────────────────
    const exposureSlider = slider({
      value: ve?.rendererManager?.renderer?.toneMappingExposure ?? 1.0,
      min: 0.1, max: 4.0, step: 0.05,
      onChange: () => _fire(),
    });
    body.appendChild(row('Exposure', exposureSlider.el));

    const saturationSlider = slider({
      value: 1.0, min: 0.0, max: 3.0, step: 0.05,
      onChange: () => _fire(),
    });
    body.appendChild(row('Saturation', saturationSlider.el));

    const contrastSlider = slider({
      value: 1.0, min: 0.5, max: 3.0, step: 0.05,
      onChange: () => _fire(),
    });
    body.appendChild(row('Contrast', contrastSlider.el));

    // ── Sky gradient (collapsible) ───────────────────────────────────────────
    const gradHdr = document.createElement('div');
    gradHdr.style.cssText =
      'background:var(--ce-bg-surface);padding:4px 8px;font-size:10px;font-weight:700;' +
      'color:var(--ce-text-muted,#999);letter-spacing:0.05em;text-transform:uppercase;' +
      'cursor:pointer;user-select:none;display:flex;align-items:center;gap:4px;' +
      'border-top:1px solid rgba(255,255,255,0.04);';
    const gradArrow = document.createElement('span');
    gradArrow.style.cssText = 'font-size:8px;width:10px;flex-shrink:0;';
    gradArrow.textContent = '▾';
    gradHdr.appendChild(gradArrow);
    gradHdr.appendChild(document.createTextNode('Sky Colours'));
    body.appendChild(gradHdr);

    // Read back current gradient if sky is already active
    const initGrad = ve?.gradientSky?.getGradient();
    const gradEditor = new GradientEditor({
      ...(initGrad ?? {}),
      onChange: () => _fire(true),
    });
    gradEditor.element.style.padding = '0 4px 4px';
    body.appendChild(gradEditor.element);

    gradHdr.addEventListener('click', () => {
      const open = gradEditor.element.style.display !== 'none';
      gradEditor.element.style.display = open ? 'none' : '';
      gradArrow.textContent = open ? '▸' : '▾';
    });

    // ── Helper: sub-section collapsible header ───────────────────────────────
    const _subSection = (label) => {
      const hdr = document.createElement('div');
      hdr.style.cssText =
        'background:var(--ce-bg-surface);padding:4px 8px;font-size:10px;font-weight:700;' +
        'color:var(--ce-text-muted,#999);letter-spacing:0.05em;text-transform:uppercase;' +
        'cursor:pointer;user-select:none;display:flex;align-items:center;gap:4px;' +
        'border-top:1px solid rgba(255,255,255,0.04);';
      const arrow = document.createElement('span');
      arrow.style.cssText = 'font-size:8px;width:10px;flex-shrink:0;';
      arrow.textContent = '▾';
      hdr.appendChild(arrow);
      hdr.appendChild(document.createTextNode(label));
      const rows = [];
      hdr.addEventListener('click', () => {
        const open = arrow.textContent === '▾';
        arrow.textContent = open ? '▸' : '▾';
        rows.forEach(r => { r.style.display = open ? 'none' : ''; });
      });
      body.appendChild(hdr);
      return { addRow: (r) => { rows.push(r); body.appendChild(r); } };
    };

    // ── Sun controls ────────────────────────────────────────────────────────
    const showSunCb = checkbox({ checked: true, onChange: () => _fire() });
    const sunColorSw = colorSwatch({ color: '#fff8e7', onChange: () => _fire() });

    const sunSec = _subSection('Sun');

    // Combined "Show + Color" row
    const sunComboCtrl = document.createElement('div');
    sunComboCtrl.style.cssText = 'display:flex;align-items:center;gap:6px;';
    sunComboCtrl.appendChild(showSunCb);
    sunComboCtrl.appendChild(sunColorSw.el);
    const sunComboRow = row('Sun', sunComboCtrl);
    sunSec.addRow(sunComboRow);

    const sunGlowSlider = slider({
      value: 0.5, min: 0, max: 10, step: 0.1,
      onChange: () => _fire(),
    });
    sunSec.addRow(row('Glow', sunGlowSlider.el));

    // ── Moon controls ───────────────────────────────────────────────────────
    const showMoonCb = checkbox({ checked: true, onChange: () => _fire() });
    const moonColorSw = colorSwatch({ color: '#c0d4ff', onChange: () => _fire() });

    const moonSec = _subSection('Moon');

    const moonComboCtrl = document.createElement('div');
    moonComboCtrl.style.cssText = 'display:flex;align-items:center;gap:6px;';
    moonComboCtrl.appendChild(showMoonCb);
    moonComboCtrl.appendChild(moonColorSw.el);
    const moonComboRow = row('Moon', moonComboCtrl);
    moonSec.addRow(moonComboRow);

    const moonGlowSlider = slider({
      value: 0.3, min: 0, max: 10, step: 0.1,
      onChange: () => _fire(),
    });
    moonSec.addRow(row('Glow', moonGlowSlider.el));

    // ── Lens Flare ──────────────────────────────────────────────────────────
    const lensflareEnabledCb = checkbox({ checked: true, onChange: () => _fire() });

    const flareSec = _subSection('Lens Flare');

    flareSec.addRow(row('Enable', lensflareEnabledCb));

    const lensflareSizeSlider = slider({
      value: 300, min: 50, max: 1200, step: 10,
      onChange: () => _fire(),
    });
    flareSec.addRow(row('Size', lensflareSizeSlider.el));

    const lensflareOpacitySlider = slider({
      value: 0.7, min: 0, max: 1, step: 0.05,
      onChange: () => _fire(),
    });
    flareSec.addRow(row('Opacity', lensflareOpacitySlider.el));

    // Store all references
    this._skyControls = {
      enabledCb, elevationSlider, azimuthSlider,
      exposureSlider, saturationSlider, contrastSlider,
      gradEditor,
      showSunCb, sunColorSw, sunGlowSlider,
      showMoonCb, moonColorSw, moonGlowSlider,
      lensflareEnabledCb, lensflareSizeSlider, lensflareOpacitySlider,
    };
  }

  /** Fire cyco-sky-change using current control state. */
  _fireSkyChange(enabledOverride) {
    const s = this._skyControls;
    if (!s) return;
    const enabled = (enabledOverride !== undefined) ? !!enabledOverride : s.enabledCb.checked;
    const { colorStops, opacityStops } = s.gradEditor.data;
    const sunColor  = s.sunColorSw.el.style.getPropertyValue('--sw-color')  || '#fff8e7';
    const moonColor = s.moonColorSw.el.style.getPropertyValue('--sw-color') || '#c0d4ff';
    window.dispatchEvent(new CustomEvent('cyco-sky-change', {
      detail: {
        enabled,
        elevation:         parseFloat(s.elevationSlider.input.value),
        azimuth:           parseFloat(s.azimuthSlider.input.value),
        exposure:          parseFloat(s.exposureSlider.input.value),
        saturation:        parseFloat(s.saturationSlider.input.value),
        contrast:          parseFloat(s.contrastSlider.input.value),
        colorStops,
        opacityStops,
        showSun:           s.showSunCb.checked,
        sunColor,
        sunGlowStrength:   parseFloat(s.sunGlowSlider.input.value),
        showMoon:          s.showMoonCb.checked,
        moonColor,
        moonGlowStrength:  parseFloat(s.moonGlowSlider.input.value),
        lensflareEnabled:  s.lensflareEnabledCb.checked,
        lensflareSize:     parseFloat(s.lensflareSizeSlider.input.value),
        lensflareOpacity:  parseFloat(s.lensflareOpacitySlider.input.value),
      }
    }));
  }

  // ── Clouds (Volumetric — WebGL ray marching) ─────────────────────────────

  _buildCloudSection(root) {
    const { el, body } = section('Clouds (Volumetric)');
    root.appendChild(el);

    const cs = () => window.__cyco?.cloudSystem;

    // Read current cloud enabled state so checkbox persists across panel rebuilds
    const enableCb = checkbox({
      checked: !!window.__cyco?.cloudSystem?.enabled,
      onChange: (v) => cs()?.setEnabled(v),
    });

    // Sky Layer (ON): clouds sit at fixed high altitude, depth-tested so scene objects stay in front.
    // Legacy Surround (OFF): clouds wrap around camera at low altitude, no depth test.
    const skyModeCb = checkbox({
      checked: cs()?._p?.skyMode ?? true,
      onChange: (v) => cs()?.setSkyMode(v),
    });

    // Animate checkbox — when unchecked, uTime freezes and clouds stay in place
    const animateCb = checkbox({
      checked: cs()?._p?.animated ?? true,
      onChange: (v) => cs()?.setAnimated(v),
    });

    // Helper: wrap a checkbox with a text label in a flex container
    const _mkCbLabel = (cb, text) => {
      const w = document.createElement('label');
      w.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:11px;cursor:pointer;white-space:nowrap;';
      w.appendChild(cb);
      w.appendChild(document.createTextNode(text));
      return w;
    };

    // "Enable" + "Sky Layer" on the same row
    const cloudsTopCtrl = document.createElement('div');
    cloudsTopCtrl.style.cssText = 'display:flex;align-items:center;gap:10px;';
    cloudsTopCtrl.appendChild(_mkCbLabel(enableCb, 'Enable'));
    cloudsTopCtrl.appendChild(_mkCbLabel(skyModeCb, 'Sky Layer'));
    body.appendChild(row('Clouds', cloudsTopCtrl));

    body.appendChild(row('Animate', animateCb));

    const coverageSlider = slider({
      value: cs()?._p?.coverage ?? 0.45, min: 0, max: 1, step: 0.01,
      onChange: (v) => cs()?.setParam('coverage', v),
    });
    body.appendChild(row('Coverage', coverageSlider.el));

    const densitySlider = slider({
      value: cs()?._p?.density ?? 0.7, min: 0, max: 1, step: 0.01,
      onChange: (v) => cs()?.setParam('density', v),
    });
    body.appendChild(row('Density', densitySlider.el));

    const scaleSlider = slider({
      value: cs()?._p?.scale ?? 55, min: 5, max: 250, step: 1,
      onChange: (v) => cs()?.setParam('scale', v),
    });
    body.appendChild(row('Scale', scaleSlider.el));

    const speedSlider = slider({
      value: cs()?._p?.windSpeed ?? 0.4, min: 0, max: 3, step: 0.05,
      onChange: (v) => cs()?.setParam('windSpeed', v),
    });
    body.appendChild(row('Wind Speed', speedSlider.el));

    const windDirSlider = slider({
      value: Math.round((cs()?._p?.windAngle ?? 0) * (180 / Math.PI)), min: 0, max: 360, step: 1,
      onChange: (v) => cs()?.setParam('windAngleDeg', v),
    });
    body.appendChild(row('Wind Direction', windDirSlider.el));

    const heightSlider = slider({
      value: cs()?._p?.cloudBase ?? 300, min: 1, max: 5000, step: 1,
      onChange: (v) => cs()?.setParam('cloudHeight', v),
    });
    body.appendChild(row('Cloud Height', heightSlider.el));

    const thicknessSlider = slider({
      value: ((cs()?._p?.cloudTop ?? 600) - (cs()?._p?.cloudBase ?? 300)), min: 10, max: 2000, step: 1,
      onChange: (v) => cs()?.setParam('cloudThickness', v),
    });
    body.appendChild(row('Thickness', thicknessSlider.el));

    const shadowCb = checkbox({
      checked: cs()?._p?.shadowEnabled ?? false,
      onChange: (v) => cs()?.setShadows(v),
    });
    body.appendChild(row('Cast Shadows', shadowCb));

    const shadowStrSlider = slider({
      value: cs()?._p?.shadowStrength ?? 0.5, min: 0, max: 1, step: 0.01,
      onChange: (v) => cs()?.setParam('shadowStrength', v),
    });
    body.appendChild(row('Shadow Strength', shadowStrSlider.el));

    // ── Bloom filters ────────────────────────────────────────────────────────
    // These sliders filter how much the cloud layer contributes to the global
    // UnrealBloomPass without touching any other scene object.
    //
    //  Bloom Strength  — multiplies cloud output brightness (0 = no bloom, 2 = double)
    //  Bloom Threshold — per-cloud luminance floor; cloud pixels below this value are
    //                    zeroed before the bloom pass sees them (0 = off / all bloom)

    const bloomStrengthSlider = slider({
      value: cs()?._p?.bloomBrightness ?? 1.0, min: 0, max: 2, step: 0.01,
      onChange: (v) => cs()?.setParam('bloomBrightness', v),
    });
    body.appendChild(row('Bloom Strength', bloomStrengthSlider.el));

    const bloomThresholdSlider = slider({
      value: cs()?._p?.cloudBloomThreshold ?? 0.0, min: 0, max: 1, step: 0.01,
      onChange: (v) => cs()?.setParam('cloudBloomThreshold', v),
    });
    body.appendChild(row('Bloom Threshold', bloomThresholdSlider.el));
  }

  // ── Low Clouds (second cloud layer — ground-level, shadow casting) ────────

  _buildLowCloudsSection(root) {
    const { el, body } = section('Low Clouds');
    root.appendChild(el);

    const cs2 = () => window.__cyco?.cloudSystem2;

    const enableCb2 = checkbox({
      checked: !!window.__cyco?.cloudSystem2?.enabled,
      onChange: (v) => cs2()?.setEnabled(v),
    });

    const animateCb2 = checkbox({
      checked: cs2()?._p?.animated ?? true,
      onChange: (v) => cs2()?.setAnimated(v),
    });

    const _mkCbLabel2 = (cb, text) => {
      const w = document.createElement('label');
      w.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:11px;cursor:pointer;white-space:nowrap;';
      w.appendChild(cb);
      w.appendChild(document.createTextNode(text));
      return w;
    };

    const topCtrl2 = document.createElement('div');
    topCtrl2.style.cssText = 'display:flex;align-items:center;gap:10px;';
    topCtrl2.appendChild(_mkCbLabel2(enableCb2, 'Enable'));
    topCtrl2.appendChild(_mkCbLabel2(animateCb2, 'Animate'));
    body.appendChild(row('Low Clouds', topCtrl2));

    const coverageSlider2 = slider({
      value: cs2()?._p?.coverage ?? 0.3, min: 0, max: 1, step: 0.01,
      onChange: (v) => cs2()?.setParam('coverage', v),
    });
    body.appendChild(row('Coverage', coverageSlider2.el));

    const densitySlider2 = slider({
      value: cs2()?._p?.density ?? 0.8, min: 0, max: 1, step: 0.01,
      onChange: (v) => cs2()?.setParam('density', v),
    });
    body.appendChild(row('Density', densitySlider2.el));

    const scaleSlider2 = slider({
      value: cs2()?._p?.scale ?? 30, min: 5, max: 150, step: 1,
      onChange: (v) => cs2()?.setParam('scale', v),
    });
    body.appendChild(row('Scale', scaleSlider2.el));

    const speedSlider2 = slider({
      value: cs2()?._p?.windSpeed ?? 0.8, min: 0, max: 3, step: 0.05,
      onChange: (v) => cs2()?.setParam('windSpeed', v),
    });
    body.appendChild(row('Wind Speed', speedSlider2.el));

    const windDirSlider2 = slider({
      value: Math.round((cs2()?._p?.windAngle ?? 0) * (180 / Math.PI)), min: 0, max: 360, step: 1,
      onChange: (v) => cs2()?.setParam('windAngleDeg', v),
    });
    body.appendChild(row('Wind Direction', windDirSlider2.el));

    const heightSlider2 = slider({
      value: cs2()?._p?.cloudBase ?? 40, min: 1, max: 1000, step: 1,
      onChange: (v) => cs2()?.setParam('cloudHeight', v),
    });
    body.appendChild(row('Cloud Height', heightSlider2.el));

    const thicknessSlider2 = slider({
      value: ((cs2()?._p?.cloudTop ?? 120) - (cs2()?._p?.cloudBase ?? 40)), min: 10, max: 500, step: 1,
      onChange: (v) => cs2()?.setParam('cloudThickness', v),
    });
    body.appendChild(row('Thickness', thicknessSlider2.el));

    const shadowCb2 = checkbox({
      checked: cs2()?._p?.shadowEnabled ?? true,
      onChange: (v) => cs2()?.setShadows(v),
    });
    body.appendChild(row('Cast Shadows', shadowCb2));

    const shadowStrSlider2 = slider({
      value: cs2()?._p?.shadowStrength ?? 0.4, min: 0, max: 1, step: 0.01,
      onChange: (v) => cs2()?.setParam('shadowStrength', v),
    });
    body.appendChild(row('Shadow Strength', shadowStrSlider2.el));

    const bloomStrSlider2 = slider({
      value: cs2()?._p?.bloomBrightness ?? 1.0, min: 0, max: 2, step: 0.01,
      onChange: (v) => cs2()?.setParam('bloomBrightness', v),
    });
    body.appendChild(row('Bloom Strength', bloomStrSlider2.el));
  }

  // ── Fog ───────────────────────────────────────────────────────────────────

  _buildFogSection(root) {
    const { el, body } = section('Fog');
    root.appendChild(el);

    const scene = window.__cyco?.viewportEngine?.scene;
    const fogType = scene?.fog instanceof THREE.FogExp2 ? 'exp2'
                  : scene?.fog instanceof THREE.Fog      ? 'linear'
                  : 'none';
    const fogColor = '#' + (scene?.fog?.color?.getHexString() ?? 'aaaaaa');

    const linearRows = [];
    const exp2Rows   = [];

    const typeSelect = select({
      options: [
        ['none',   'None'],
        ['linear', 'Linear'],
        ['exp2',   'Exponential²'],
      ],
      value: fogType,
      onChange: (v) => {
        const color = colorSw.el.style.getPropertyValue('--sw-color') || fogColor;
        this._applyFogType(v, color,
          parseFloat(nearSlider.input.value), parseFloat(farSlider.input.value),
          parseFloat(densitySlider.input.value));
        for (const r of linearRows) r.style.display = v === 'linear' ? '' : 'none';
        for (const r of exp2Rows)   r.style.display = v === 'exp2'   ? '' : 'none';
      },
    });
    body.appendChild(row('Type', typeSelect));

    const colorSw = colorSwatch({
      color: fogColor,
      onChange: (c) => {
        const fog = window.__cyco?.viewportEngine?.scene?.fog;
        if (fog) fog.color.set(c);
        window.dispatchEvent(new CustomEvent('cyco-fog-change', { detail: this._fogState() }));
      },
    });
    body.appendChild(row('Color', colorSw.el));

    const curFog = scene?.fog;
    const nearSlider = slider({
      value: curFog instanceof THREE.Fog ? curFog.near : 1, min: 0, max: 500, step: 0.5,
      onChange: () => { if (scene?.fog instanceof THREE.Fog) scene.fog.near = parseFloat(nearSlider.input.value); },
    });
    const nearRow = row('Near', nearSlider.el);
    nearRow.style.display = fogType === 'linear' ? '' : 'none';
    linearRows.push(nearRow);
    body.appendChild(nearRow);

    const farSlider = slider({
      value: curFog instanceof THREE.Fog ? curFog.far : 200, min: 0, max: 5000, step: 1,
      onChange: () => { if (scene?.fog instanceof THREE.Fog) scene.fog.far = parseFloat(farSlider.input.value); },
    });
    const farRow = row('Far', farSlider.el);
    farRow.style.display = fogType === 'linear' ? '' : 'none';
    linearRows.push(farRow);
    body.appendChild(farRow);

    // Density max increased: 0 → 1.0 for much denser exponential fog
    const densitySlider = slider({
      value: curFog instanceof THREE.FogExp2 ? curFog.density : 0.002,
      min: 0, max: 1.0, step: 0.0001,
      onChange: () => {
        if (scene?.fog instanceof THREE.FogExp2)
          scene.fog.density = parseFloat(densitySlider.input.value);
      },
    });
    const densityRow = row('Density', densitySlider.el);
    densityRow.style.display = fogType === 'exp2' ? '' : 'none';
    exp2Rows.push(densityRow);
    body.appendChild(densityRow);
  }

  _applyFogType(type, colorHex, near, far, density) {
    const scene = window.__cyco?.viewportEngine?.scene;
    if (!scene) return;
    if (type === 'none')       { scene.fog = null; }
    else if (type === 'linear'){ scene.fog = new THREE.Fog(colorHex, near, far); }
    else if (type === 'exp2')  { scene.fog = new THREE.FogExp2(colorHex, density); }
    window.dispatchEvent(new CustomEvent('cyco-fog-change', {
      detail: { type, color: colorHex, near, far, density }
    }));
  }

  _fogState() {
    const fog = window.__cyco?.viewportEngine?.scene?.fog;
    if (!fog) return { type: 'none' };
    if (fog instanceof THREE.FogExp2)
      return { type: 'exp2', color: '#' + fog.color.getHexString(), density: fog.density };
    return { type: 'linear', color: '#' + fog.color.getHexString(), near: fog.near, far: fog.far };
  }

  // ── Environment Map ───────────────────────────────────────────────────────

  _buildEnvMapSection(root) {
    const { el, body } = section('Environment Map');
    root.appendChild(el);

    const info = document.createElement('div');
    info.style.cssText = 'font-size:11px;color:var(--text-secondary,#888);padding:4px 0;';
    info.textContent = 'Drag an .hdr or .exr file onto the viewport, or load below.';
    body.appendChild(info);

    // Buttons row
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:6px;margin-top:4px;flex-wrap:wrap;';

    const fileBtn = document.createElement('button');
    fileBtn.textContent = 'Load HDR / EXR…';
    fileBtn.className = 'ce-btn ce-btn-sm';
    fileBtn.style.cssText = 'font-size:11px;padding:3px 10px;border-radius:4px;cursor:pointer;' +
      'background:var(--bg-secondary,#252525);border:1px solid var(--border-color,#333);' +
      'color:var(--text-primary,#e0e0e0);';
    fileBtn.addEventListener('click', async () => {
      try {
        const [fileHandle] = await window.showOpenFilePicker({
          types: [{ description: 'HDR/EXR', accept: { 'image/*': ['.hdr', '.exr'] } }],
          multiple: false,
        });
        const file = await fileHandle.getFile();
        const url  = URL.createObjectURL(file);
        const isHDR = file.name.toLowerCase().endsWith('.hdr');
        window.dispatchEvent(new CustomEvent('cyco-env-map-change', { detail: { url, isHDR } }));
        statusLabel.textContent = file.name;
      } catch {
        // User cancelled
      }
    });

    // Presets button + dropdown
    const presetWrap = document.createElement('div');
    presetWrap.style.cssText = 'position:relative;display:inline-block;';
    const presetBtn = document.createElement('button');
    presetBtn.textContent = 'Presets ▾';
    presetBtn.className = 'ce-btn ce-btn-sm';
    presetBtn.style.cssText = fileBtn.style.cssText;

    const presetDd = document.createElement('div');
    presetDd.style.cssText =
      'display:none;position:absolute;left:0;top:calc(100% + 3px);z-index:9999;' +
      'min-width:190px;background:var(--bg-secondary,#1e1e1e);' +
      'border:1px solid var(--border-color,#3a3a3a);border-radius:5px;' +
      'box-shadow:0 6px 20px rgba(0,0,0,.6);overflow:hidden;';

    const PRESETS = [
      { label: 'Room (Built-in)',   type: 'room'                                           },
      { label: 'Overcast Sky',      type: 'sky', elevation: 5,  turbidity: 16, rayleigh: 4 },
      { label: 'Sunny Midday',      type: 'sky', elevation: 60, turbidity: 8,  rayleigh: 2 },
      { label: 'Golden Hour',       type: 'sky', elevation: 8,  turbidity: 12, rayleigh: 3.5 },
      { label: 'Night Sky',         type: 'sky', elevation: -5, turbidity: 2,  rayleigh: 0.5 },
      { label: 'Clear Blue Sky',    type: 'sky', elevation: 45, turbidity: 5,  rayleigh: 1.5 },
    ];
    PRESETS.forEach(p => {
      const item = document.createElement('div');
      item.style.cssText = 'padding:5px 10px;font-size:11px;color:var(--text-primary,#e0e0e0);cursor:pointer;';
      item.textContent = p.label;
      item.addEventListener('mouseenter', () => { item.style.background = 'rgba(224,114,40,.18)'; });
      item.addEventListener('mouseleave', () => { item.style.background = ''; });
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        presetDd.style.display = 'none';
        this._applyPreset(p, statusLabel);
      });
      presetDd.appendChild(item);
    });

    presetBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = presetDd.style.display !== 'none';
      presetDd.style.display = isOpen ? 'none' : 'block';
      if (!isOpen) {
        const close = () => { presetDd.style.display = 'none'; document.removeEventListener('click', close); };
        setTimeout(() => document.addEventListener('click', close), 0);
      }
    });
    presetWrap.appendChild(presetBtn);
    presetWrap.appendChild(presetDd);

    btnRow.appendChild(fileBtn);
    btnRow.appendChild(presetWrap);
    body.appendChild(btnRow);

    const statusLabel = document.createElement('div');
    statusLabel.style.cssText = 'font-size:10px;color:var(--text-secondary,#777);margin-top:3px;';
    statusLabel.textContent = 'No custom env map';
    body.appendChild(statusLabel);
    this._statusLabel = statusLabel;

    // Background toggle
    const bgCb = checkbox({
      checked: !!(window.__cyco?.viewportEngine?.scene?.background instanceof THREE.Texture),
      onChange: (v) => {
        window.dispatchEvent(new CustomEvent('cyco-env-background-toggle', { detail: { enabled: v } }));
      },
    });
    body.appendChild(row('Show as Background', bgCb));
  }

  _applyPreset(preset, statusLabel) {
    if (preset.type === 'room') {
      window.dispatchEvent(new CustomEvent('cyco-env-preset', { detail: { preset: 'room' } }));
      if (statusLabel) statusLabel.textContent = 'Room Environment (built-in)';
      return;
    }
    if (preset.type === 'sky') {
      window.dispatchEvent(new CustomEvent('cyco-sky-change', {
        detail: {
          enabled:         true,
          elevation:       preset.elevation  ?? 30,
          azimuth:         preset.azimuth    ?? 180,
          turbidity:       preset.turbidity  ?? 10,
          rayleigh:        preset.rayleigh   ?? 3,
          mieCoefficient:  preset.mie        ?? 0.005,
          mieDirectionalG: preset.mieG       ?? 0.7,
          showSunDisc:     true,
        }
      }));
      if (statusLabel) statusLabel.textContent = preset.label;
    }
  }

  dispose() {}
}

