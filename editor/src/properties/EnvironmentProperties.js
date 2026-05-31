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
    this._skyEnabledCb = null; // cross-reference set by _buildSkySection
    this._bgGradEditor = null; // set by _buildBackgroundSection
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
    this._buildGodRaysSection(root);
    this._buildEnvMapSection(root);
    this._buildPostProcessingSection(root);

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
    this._typeSelect = typeSelect;
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

    // Gradient editor (replaces 3 fixed colour pickers)
    const gradWrap = document.createElement('div');
    gradWrap.style.cssText = 'padding:4px 4px 6px;';
    this._bgGradEditor = new GradientEditor({
      colorStops: [
        { pos: 0.0, color: '#87ceeb', blend: 0 },
        { pos: 0.5, color: '#d4a56a', blend: 0 },
        { pos: 1.0, color: '#4a3b2a', blend: 0 },
      ],
      opacityStops: [
        { pos: 0.0, opacity: 1 },
        { pos: 1.0, opacity: 1 },
      ],
      onChange: () => this._dispatchBackground('gradient'),
    });
    gradWrap.appendChild(this._bgGradEditor.element);
    body.appendChild(gradWrap);

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
      solidRow.style.display = type === 'solid'    ? '' : 'none';
      gradWrap.style.display = type === 'gradient' ? '' : 'none';
      hdriRow.style.display  = type === 'hdri'     ? '' : 'none';
    };
    _showRows(initType);
  }

  _dispatchBackground(type) {
    const { colorStops, opacityStops } = this._bgGradEditor?.data ?? { colorStops: [], opacityStops: [] };
    window.dispatchEvent(new CustomEvent('cyco-background-change', {
      detail: { type, color: this._solidColor, colorStops, opacityStops },
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

    const enabledCb = checkbox({
      checked: !!ve?.skyEnabled,
      onChange: () => {
        if (enabledCb.checked) {
          // Switch background type to Sky
          if (this._typeSelect) {
            this._typeSelect.value = 'sky';
            this._typeSelect.dispatchEvent(new Event('change', { bubbles: true }));
          }
        } else {
          // Uncheck — if currently on sky, revert to solid
          if (this._typeSelect?.value === 'sky') {
            this._typeSelect.value = 'solid';
            this._typeSelect.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
        _fire();
      },
    });
    this._skyEnabledCb = enabledCb;
    body.appendChild(row('Show Sky', enabledCb));

    // ── Sky Type dropdown ─────────────────────────────────────────────────────
    const skyTypeSelect = select({
      options: [
        ['gradient', 'Gradient Sky'],
        ['physical', 'Physical Sky (WebGL only)'],
      ],
      value: ve?._activeSkyType ?? 'gradient',
      onChange: () => {
        const t = skyTypeSelect.value;
        atmHdr.style.display  = t === 'physical' ? '' : 'none';
        atmBody.style.display = t === 'physical' ? '' : 'none';
        gradHdr.style.display  = t === 'gradient' ? '' : 'none';
        gradBody.style.display = t === 'gradient' ? '' : 'none';
        _fire(true);
      },
    });
    this._skyTypeSelect = skyTypeSelect;
    body.appendChild(row('Sky Type', skyTypeSelect));

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
    body.appendChild(row('Rotation', azimuthSlider.el));

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

    // ── Atmosphere sub-section (Physical Sky only — Hosek-Wilkie params) ────
    const atmHdr = document.createElement('div');
    atmHdr.style.cssText =
      'background:var(--ce-bg-surface);padding:4px 8px;font-size:10px;font-weight:700;' +
      'color:var(--ce-text-muted,#999);letter-spacing:0.05em;text-transform:uppercase;' +
      'border-top:1px solid rgba(255,255,255,0.04);display:none;';
    atmHdr.textContent = 'Atmosphere';
    body.appendChild(atmHdr);

    const atmBody = document.createElement('div');
    atmBody.style.display = 'none';

    const turbiditySlider = slider({ value: ve?.physicalSky?._p?.turbidity       ?? 2.0,  min: 1,   max: 20,   step: 0.1,   onChange: () => _fire() });
    const rayleighSlider  = slider({ value: ve?.physicalSky?._p?.rayleigh        ?? 1.0,  min: 0,   max: 4,    step: 0.05,  onChange: () => _fire() });
    const mieGSlider      = slider({ value: ve?.physicalSky?._p?.mieDirectionalG ?? 0.8,  min: 0,   max: 0.99, step: 0.01,  onChange: () => _fire() });
    const mieCSlider      = slider({ value: ve?.physicalSky?._p?.mieCoefficient  ?? 0.005,min: 0,   max: 0.1,  step: 0.001, onChange: () => _fire() });

    atmBody.appendChild(row('Turbidity (Haze)',    turbiditySlider.el));
    atmBody.appendChild(row('Rayleigh (Blue Sky)', rayleighSlider.el));
    atmBody.appendChild(row('Mie Anisotropy',      mieGSlider.el));
    atmBody.appendChild(row('Mie Coefficient',     mieCSlider.el));
    body.appendChild(atmBody);

    this._atmControls = { turbiditySlider, rayleighSlider, mieGSlider, mieCSlider };

    // ── Sky gradient (collapsible) ────────────────────────────────────────
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

    // gradBody wraps gradient editor so skyTypeSelect can show/hide it
    const gradBody = document.createElement('div');
    body.appendChild(gradBody);

    // Read back current gradient if sky is already active
    const initGrad = ve?.gradientSky?.getGradient();
    const gradEditor = new GradientEditor({
      ...(initGrad ?? {}),
      onChange: () => _fire(true),
    });
    gradEditor.element.style.padding = '0 4px 4px';
    gradBody.appendChild(gradEditor.element);

    gradHdr.addEventListener('click', () => {
      const open = gradEditor.element.style.display !== 'none';
      gradEditor.element.style.display = open ? 'none' : '';
      gradArrow.textContent = open ? '▸' : '▾';
    });

    // ── Helper: sub-section collapsible header ───────────────────────────────
    // Sub-sections (Sun, Moon, Lens Flare) are gradient-sky-only, so they are
    // appended inside gradBody so they hide when switching to Physical Sky.
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
      gradBody.appendChild(hdr);
      return { addRow: (r) => { rows.push(r); gradBody.appendChild(r); } };
    };

    // ── Sun controls ────────────────────────────────────────────────────────
    const _skyP = ve?.gradientSky?._p;  // current GradientSky params (null if sky not yet enabled)
    const showSunCb = checkbox({ checked: _skyP?.showSun ?? true, onChange: () => _fire() });
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
      value: _skyP?.sunGlowStrength ?? 0.5, min: 0, max: 10, step: 0.1,
      onChange: () => _fire(),
    });
    sunSec.addRow(row('Glow', sunGlowSlider.el));

    // ── Moon controls ───────────────────────────────────────────────────────
    const showMoonCb = checkbox({ checked: _skyP?.showMoon ?? true, onChange: () => _fire() });
    const moonColorSw = colorSwatch({ color: '#c0d4ff', onChange: () => _fire() });

    const moonSec = _subSection('Moon');

    const moonComboCtrl = document.createElement('div');
    moonComboCtrl.style.cssText = 'display:flex;align-items:center;gap:6px;';
    moonComboCtrl.appendChild(showMoonCb);
    moonComboCtrl.appendChild(moonColorSw.el);
    const moonComboRow = row('Moon', moonComboCtrl);
    moonSec.addRow(moonComboRow);

    const moonGlowSlider = slider({
      value: _skyP?.moonGlowStrength ?? 0.3, min: 0, max: 10, step: 0.1,
      onChange: () => _fire(),
    });
    moonSec.addRow(row('Glow', moonGlowSlider.el));

    // ── Lens Flare (Phase 5 granular controls) ───────────────────────────────
    const flareSec = _subSection('Lens Flare');

    const lensflareEnabledCb = checkbox({ checked: _skyP?.lensflareEnabled ?? true, onChange: () => _fire() });
    const opacitySlider      = slider({ value: _skyP?.lensflareOpacity      ?? 0.7,  min: 0,  max: 1,   step: 0.01, onChange: () => _fire() });
    const glareSizeSlider    = slider({ value: _skyP?.lensflareGlareSize    ?? 0.4,  min: 0,  max: 2,   step: 0.01, onChange: () => _fire() });
    const starPointsSlider   = slider({ value: _skyP?.lensflareStarPoints   ?? 6,    min: 0,  max: 12,  step: 1,    onChange: () => _fire() });
    const flareSizeSlider    = slider({ value: _skyP?.lensflareFlareSize    ?? 0.25, min: 0,  max: 2,   step: 0.01, onChange: () => _fire() });
    const flareSpeedSlider   = slider({ value: _skyP?.lensflareFlareSpeed   ?? 0.0,  min: 0,  max: 2,   step: 0.01, onChange: () => _fire() });
    const haloScaleSlider    = slider({ value: _skyP?.lensflareHaloScale    ?? 0.5,  min: 0,  max: 2,   step: 0.01, onChange: () => _fire() });
    const ghostScaleSlider   = slider({ value: _skyP?.lensflareGhostScale   ?? 0.3,  min: 0,  max: 2,   step: 0.01, onChange: () => _fire() });
    const colorGainSw        = colorSwatch({
      color: _skyP ? ('#' + (_skyP.lensflareColorGain?.getHexString?.() ?? 'fff8e0')) : '#fff8e0',
      onChange: () => _fire(),
    });
    const flareShapeSelect   = select({
      options: [['0', 'Circular'], ['1', 'Oval'], ['2', 'Streak']],
      value: String(_skyP?.lensflareFlareShape ?? 0),
      onChange: () => _fire(),
    });
    const secondaryGhostsCb  = checkbox({ checked: _skyP?.lensflareSecondaryGhosts   ?? true,  onChange: () => _fire() });
    const addStreaksCb        = checkbox({ checked: _skyP?.lensflareAdditionalStreaks ?? false, onChange: () => _fire() });
    const starBurstCb         = checkbox({ checked: _skyP?.lensflareStarBurst        ?? false, onChange: () => _fire() });
    const anamorphicCb        = checkbox({ checked: _skyP?.lensflareAnamorphic       ?? false, onChange: () => _fire() });

    flareSec.addRow(row('Enable',           lensflareEnabledCb));
    flareSec.addRow(row('Opacity',          opacitySlider.el));
    flareSec.addRow(row('Glare Size',       glareSizeSlider.el));
    flareSec.addRow(row('Star Points',      starPointsSlider.el));
    flareSec.addRow(row('Flare Size',       flareSizeSlider.el));
    flareSec.addRow(row('Flare Speed',      flareSpeedSlider.el));
    flareSec.addRow(row('Flare Shape',      flareShapeSelect));
    flareSec.addRow(row('Halo Scale',       haloScaleSlider.el));
    flareSec.addRow(row('Color Gain',       colorGainSw.el));
    flareSec.addRow(row('Ghost Scale',      ghostScaleSlider.el));
    flareSec.addRow(row('Secondary Ghosts', secondaryGhostsCb));
    flareSec.addRow(row('Extra Streaks',    addStreaksCb));
    flareSec.addRow(row('Star Burst',       starBurstCb));
    flareSec.addRow(row('Anamorphic',       anamorphicCb));


    // Store all references
    this._skyControls = {
      enabledCb, elevationSlider, azimuthSlider,
      exposureSlider, saturationSlider, contrastSlider,
      gradEditor,
      showSunCb, sunColorSw, sunGlowSlider,
      showMoonCb, moonColorSw, moonGlowSlider,
      lensflareEnabledCb, opacitySlider, glareSizeSlider, starPointsSlider,
      flareSizeSlider, flareSpeedSlider, flareShapeSelect, haloScaleSlider,
      colorGainSw, ghostScaleSlider, secondaryGhostsCb, addStreaksCb,
      starBurstCb, anamorphicCb,
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
        skyType:           this._skyTypeSelect?.value ?? 'gradient',
        turbidity:         parseFloat(this._atmControls?.turbiditySlider.input.value ?? 2),
        rayleigh:          parseFloat(this._atmControls?.rayleighSlider.input.value  ?? 1),
        mieDirectionalG:   parseFloat(this._atmControls?.mieGSlider.input.value      ?? 0.8),
        mieCoefficient:    parseFloat(this._atmControls?.mieCSlider.input.value      ?? 0.005),
        lensflareEnabled:      s.lensflareEnabledCb.checked,
        lensflareOpacity:      parseFloat(s.opacitySlider.input.value),
        lensflareGlareSize:    parseFloat(s.glareSizeSlider.input.value),
        lensflareStarPoints:   parseInt(s.starPointsSlider.input.value, 10),
        lensflareFlareSize:    parseFloat(s.flareSizeSlider.input.value),
        lensflareFlareSpeed:   parseFloat(s.flareSpeedSlider.input.value),
        lensflareFlareShape:   parseInt(s.flareShapeSelect.value, 10),
        lensflareHaloScale:    parseFloat(s.haloScaleSlider.input.value),
        lensflareColorGain:    s.colorGainSw.el.style.getPropertyValue('--sw-color') || '#fff8e0',
        lensflareGhostScale:   parseFloat(s.ghostScaleSlider.input.value),
        lensflareSecondaryGhosts:   s.secondaryGhostsCb.checked,
        lensflareAdditionalStreaks: s.addStreaksCb.checked,
        lensflareStarBurst:    s.starBurstCb.checked,
        lensflareAnamorphic:   s.anamorphicCb.checked,
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
    // Toggling also syncs the other sky-layer elements: sun disc, moon disc, and lens flare.
    const skyModeCb = checkbox({
      checked: cs()?._p?.skyMode ?? true,
      onChange: (v) => {
        cs()?.setSkyMode(v);
        // Sync sky-layer siblings: sun, moon, lens flare are only meaningful in sky-layer mode
        const sky = window.__cyco?.gradientSky;
        if (sky) sky.setParams({ showSun: v, showMoon: v, lensflareEnabled: v });
        const sc = this._skyControls;
        if (sc) {
          sc.showSunCb.checked         = v;
          sc.showMoonCb.checked        = v;
          sc.lensflareEnabledCb.checked = v;
        }
      },
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

    // ── Render Quality dropdown ──────────────────────────────────────────────
    const CLOUD_RENDER_OPTS = [
      ['ultra',    'Ultra — 48 steps (default)'],
      ['high',     'High — 32 steps'],
      ['medium',   'Medium — 24 steps'],
      ['fast',     'Fast — 16 steps'],
      ['halfres',  'Half Res (B) — medium @ ½ res'],
      ['impostor', 'Impostor (C) — billboard planes'],
      ['compute',  'Compute (D) — fast @ ¼ res'],
    ];
    const qualitySelect = select({
      options:  CLOUD_RENDER_OPTS,
      value:    cs()?._p?.renderMode ?? 'ultra',
      onChange: (v) => cs()?.setRenderMode(v),
    });
    body.appendChild(row('Render Quality', qualitySelect));

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

    const skyModeCb2 = checkbox({
      checked: cs2()?._p?.skyMode ?? false,
      onChange: (v) => {
        cs2()?.setSkyMode(v);
        // Low clouds sky layer only changes depth-test behaviour.
        // Do NOT sync sun/moon/lens-flare — those belong to the sky system, not the cloud layer.
      },
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
    topCtrl2.appendChild(_mkCbLabel2(skyModeCb2, 'Sky Layer'));
    body.appendChild(row('Low Clouds', topCtrl2));

    body.appendChild(row('Animate', animateCb2));

    // ── Render Quality dropdown ──────────────────────────────────────────────
    const CLOUD_RENDER_OPTS2 = [
      ['ultra',    'Ultra — 48 steps (default)'],
      ['high',     'High — 32 steps'],
      ['medium',   'Medium — 24 steps'],
      ['fast',     'Fast — 16 steps'],
      ['halfres',  'Half Res (B) — medium @ ½ res'],
      ['impostor', 'Impostor (C) — billboard planes'],
      ['compute',  'Compute (D) — fast @ ¼ res'],
    ];
    const qualitySelect2 = select({
      options:  CLOUD_RENDER_OPTS2,
      value:    cs2()?._p?.renderMode ?? 'ultra',
      onChange: (v) => cs2()?.setRenderMode(v),
    });
    body.appendChild(row('Render Quality', qualitySelect2));

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
      value: cs2()?._p?.cloudBase ?? 5, min: 0, max: 1000, step: 1,
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
    const { el, body } = section('Fog / Aerial Perspective');
    root.appendChild(el);

    let _typeVal    = 'none';
    let _colorVal   = '#c0d0e0';
    let _autoColor  = true;
    let _density    = 0.0002;
    let _near       = 1;
    let _far        = 1000;

    const _fire = () => {
      window.dispatchEvent(new CustomEvent('cyco-fog-change', {
        detail: {
          type:      _typeVal,
          color:     _colorVal,
          autoColor: _autoColor,
          density:   _density,
          near:      _near,
          far:       _far,
        },
      }));
    };

    const typeSelect = select({
      options: [
        ['none',   'Off'],
        ['exp2',   'Exponential (recommended)'],
        ['linear', 'Linear'],
      ],
      value: 'none',
      onChange: (v) => {
        _typeVal = v;
        linearRows.forEach(r => { r.style.display = v === 'linear' ? '' : 'none'; });
        expRows.forEach(r    => { r.style.display = v === 'exp2'   ? '' : 'none'; });
        _fire();
      },
    });
    body.appendChild(row('Type', typeSelect));

    const colorSw = colorSwatch({
      color: _colorVal,
      onChange: (c) => { _colorVal = c; _fire(); },
    });
    const autoColorCb = checkbox({
      checked: _autoColor,
      onChange: (v) => { _autoColor = v; _fire(); },
    });
    const colorCtrl = document.createElement('div');
    colorCtrl.style.cssText = 'display:flex;align-items:center;gap:6px;';
    colorCtrl.appendChild(colorSw.el);
    const autoLabel = document.createElement('label');
    autoLabel.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:11px;cursor:pointer;';
    autoLabel.appendChild(autoColorCb);
    autoLabel.appendChild(document.createTextNode('Auto from sky'));
    colorCtrl.appendChild(autoLabel);
    body.appendChild(row('Color', colorCtrl));

    const densitySlider = slider({ value: _density, min: 0, max: 0.005, step: 0.00005,
      onChange: (v) => { _density = v; _fire(); } });
    const nearSlider    = slider({ value: _near,    min: 0,   max: 500,   step: 1,
      onChange: (v) => { _near = v; _fire(); } });
    const farSlider     = slider({ value: _far,     min: 100, max: 50000, step: 50,
      onChange: (v) => { _far = v; _fire(); } });

    const densityRow = row('Density', densitySlider.el);
    const nearRow    = row('Near',    nearSlider.el);
    const farRow     = row('Far',     farSlider.el);

    body.appendChild(densityRow);
    body.appendChild(nearRow);
    body.appendChild(farRow);

    const linearRows = [nearRow, farRow];
    const expRows    = [densityRow];
    linearRows.forEach(r => { r.style.display = 'none'; });
    expRows.forEach(r    => { r.style.display = 'none'; });
  }

  // ── God Rays ──────────────────────────────────────────────────────────────

  _buildGodRaysSection(root) {
    const { el, body } = section('God Rays');
    root.appendChild(el);

    const _fire = () => {
      window.dispatchEvent(new CustomEvent('cyco-godrays-change', {
        detail: {
          enabled:  enabledCb.checked,
          density:  parseFloat(densitySlider.input.value),
          weight:   parseFloat(weightSlider.input.value),
          decay:    parseFloat(decaySlider.input.value),
          exposure: parseFloat(exposureSlider.input.value),
          samples:  parseInt(samplesSlider.input.value, 10),
        }
      }));
    };

    const enabledCb = checkbox({ checked: false, onChange: _fire });
    body.appendChild(row('Enable', enabledCb));

    const qualitySelect = select({
      options: [
        ['low',    'Low — 20 samples'],
        ['medium', 'Medium — 40 samples'],
        ['high',   'High — 80 samples'],
        ['ultra',  'Ultra — 100 samples'],
      ],
      value: 'medium',
      onChange: (v) => {
        const presets = { low: 20, medium: 40, high: 80, ultra: 100 };
        samplesSlider.input.value = presets[v];
        _fire();
      },
    });
    body.appendChild(row('Quality', qualitySelect));

    const densitySlider  = slider({ value: 0.96, min: 0.50, max: 1.00, step: 0.01, onChange: _fire });
    body.appendChild(row('Density',  densitySlider.el));

    const weightSlider   = slider({ value: 0.40, min: 0.05, max: 1.00, step: 0.01, onChange: _fire });
    body.appendChild(row('Weight',   weightSlider.el));

    const decaySlider    = slider({ value: 0.90, min: 0.70, max: 0.99, step: 0.01, onChange: _fire });
    body.appendChild(row('Decay',    decaySlider.el));

    const exposureSlider = slider({ value: 0.65, min: 0.05, max: 2.00, step: 0.05, onChange: _fire });
    body.appendChild(row('Exposure', exposureSlider.el));

    const samplesSlider  = slider({ value: 40,   min: 10,   max: 100,  step: 5,    onChange: _fire });
    body.appendChild(row('Samples',  samplesSlider.el));

    this._godRaysControls = { enabledCb, qualitySelect, densitySlider, weightSlider, decaySlider, exposureSlider, samplesSlider };
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

  // ── Post Processing ───────────────────────────────────────────────────────

  _buildPostProcessingSection(root) {
    const { el, body } = section('Post Processing');
    root.appendChild(el);

    const _firePP = (opts) => {
      window.dispatchEvent(new CustomEvent('cyco-postfx-change', { detail: opts }));
    };

    // Helper: sub-section divider heading
    const _sub = (label) => {
      const h = document.createElement('div');
      h.style.cssText =
        'font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;' +
        'color:var(--text-secondary,#888);padding:7px 0 2px;margin-top:2px;' +
        'border-top:1px solid var(--border-color,#2a2a2a);';
      h.textContent = label;
      return h;
    };

    // ── Bloom ──────────────────────────────────────────────────────────────
    body.appendChild(_sub('Bloom'));
    const bloomEnabledCb = checkbox({
      checked: true,
      onChange: (v) => _firePP({ bloom: { enabled: v } }),
    });
    const bloomThreshSlider = slider({ value: 0.85, min: 0, max: 2, step: 0.01,
      onChange: (v) => _firePP({ bloom: { threshold: v } }) });
    const bloomStrengthSlider = slider({ value: 0.8, min: 0, max: 3, step: 0.05,
      onChange: (v) => _firePP({ bloom: { strength: v } }) });
    const bloomRadiusSlider = slider({ value: 0.4, min: 0, max: 1, step: 0.01,
      onChange: (v) => _firePP({ bloom: { radius: v } }) });
    body.appendChild(row('Enable',    bloomEnabledCb));
    body.appendChild(row('Threshold', bloomThreshSlider.el));
    body.appendChild(row('Intensity', bloomStrengthSlider.el));
    body.appendChild(row('Radius',    bloomRadiusSlider.el));

    // ── Chromatic Aberration ───────────────────────────────────────────────
    body.appendChild(_sub('Chromatic Aberration'));
    const chromaEnabledCb = checkbox({
      checked: false,
      onChange: (v) => _firePP({ chroma: { enabled: v } }),
    });
    const chromaStrengthSlider = slider({ value: 0.002, min: 0, max: 0.02, step: 0.0005,
      onChange: (v) => _firePP({ chroma: { strength: v } }) });
    body.appendChild(row('Enable',   chromaEnabledCb));
    body.appendChild(row('Strength', chromaStrengthSlider.el));

    // ── Vignette ──────────────────────────────────────────────────────────
    body.appendChild(_sub('Vignette'));
    const vigEnabledCb = checkbox({
      checked: false,
      onChange: (v) => _firePP({ vignette: { enabled: v } }),
    });
    const vigOffsetSlider = slider({ value: 1.0, min: 0.1, max: 2, step: 0.05,
      onChange: (v) => _firePP({ vignette: { offset: v } }) });
    const vigDarkSlider = slider({ value: 1.0, min: 0, max: 3, step: 0.05,
      onChange: (v) => _firePP({ vignette: { darkness: v } }) });
    body.appendChild(row('Enable',   vigEnabledCb));
    body.appendChild(row('Offset',   vigOffsetSlider.el));
    body.appendChild(row('Darkness', vigDarkSlider.el));

    // ── Film Grain ────────────────────────────────────────────────────────
    body.appendChild(_sub('Film Grain'));
    const grainEnabledCb = checkbox({
      checked: false,
      onChange: (v) => _firePP({ grain: { enabled: v } }),
    });
    const grainIntensitySlider = slider({ value: 0.08, min: 0, max: 0.5, step: 0.005,
      onChange: (v) => _firePP({ grain: { intensity: v } }) });
    body.appendChild(row('Enable',    grainEnabledCb));
    body.appendChild(row('Intensity', grainIntensitySlider.el));

    // ── Tone Mapping ──────────────────────────────────────────────────────
    body.appendChild(_sub('Tone Mapping'));
    const tmSelect = select({
      options: [
        ['aces',     'ACES Filmic (default)'],
        ['agx',      'AgX'],
        ['reinhard', 'Reinhard'],
        ['cineon',   'Cineon'],
        ['linear',   'Linear'],
        ['none',     'None (raw)'],
      ],
      value: 'aces',
      onChange: (v) => _firePP({ toneMapping: v }),
    });
    body.appendChild(row('Mode', tmSelect));

    // ── LUT Color Grading ─────────────────────────────────────────────────
    body.appendChild(_sub('LUT Color Grading'));
    const lutEnabledCb = checkbox({
      checked: false,
      onChange: (v) => _firePP({ lut: { enabled: v } }),
    });
    const lutIntensitySlider = slider({ value: 1.0, min: 0, max: 1, step: 0.01,
      onChange: (v) => _firePP({ lut: { intensity: v } }) });

    const lutLoadBtn = document.createElement('button');
    lutLoadBtn.textContent = 'Load LUT .cube…';
    lutLoadBtn.className   = 'ce-btn ce-btn-sm';
    lutLoadBtn.style.cssText =
      'font-size:11px;padding:3px 10px;border-radius:4px;cursor:pointer;' +
      'background:var(--bg-secondary,#252525);border:1px solid var(--border-color,#333);' +
      'color:var(--text-primary,#e0e0e0);';
    lutLoadBtn.addEventListener('click', () => {
      const inp = document.createElement('input');
      inp.type   = 'file';
      inp.accept = '.cube';
      inp.onchange = (e) => {
        const file = e.target.files[0];
        if (file) _firePP({ lut: { file } });
      };
      inp.click();
    });

    body.appendChild(row('Enable',    lutEnabledCb));
    body.appendChild(row('Intensity', lutIntensitySlider.el));
    body.appendChild(row('File',      lutLoadBtn));
  }

  dispose() {}
}

