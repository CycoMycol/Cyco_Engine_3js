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

    this._buildTabBar(root);
    this._buildBackgroundSection(root);
    this._buildEnvMapSection(root);
    this._buildSkySection(root);
    this._buildLowCloudsSection(root);
    this._buildFogSection(root);
    this._buildGodRaysSection(root);
    this._buildPostProcessingSection(root);
    if (this._showBackgroundTypeRows) {
      this._showBackgroundTypeRows(this._typeSelect?.value ?? 'solid');
    }
    this._showTab(null);

    return root;
  }

  // ── Background ────────────────────────────────────────────────────────────

  _buildBackgroundSection(root) {
    const { el, hdr, body } = section('Background');
    this._backgroundSectionEl = el;
    this._backgroundSectionBodyEl = body;
    root.appendChild(el);

    const ve = window.__cyco?.viewportEngine;

    // Detect current bg type. If the sky is currently enabled, preserve the
    // sky mode even if _bgType is not explicitly set to 'sky'.
    let initType = 'solid';
    if (ve?.skyEnabled) {
      initType = 'sky';
    } else if (ve?._bgType) {
      initType = ve._bgType;
    } else if (ve?.scene?.background instanceof THREE.Texture) {
      initType = 'hdri';
    }

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
          // Switching away from sky — keep the checkbox state so the user can return
          window.dispatchEvent(new CustomEvent('cyco-sky-change', { detail: { enabled: false } }));
        }
      },
    });
    this._typeSelect = typeSelect;
    body.appendChild(row('Type', typeSelect));

    const initShape = ve?._skyShape
      ?? (ve?._activeSkyType === 'physical'
        ? ve?.physicalSky?._p?.shape
        : ve?.gradientSky?._p?.shape)
      ?? (ve?.rendererManager?.renderer?.isWebGPURenderer ? 'cube' : 'dome');
    const shapeSelect = select({
      options: [
        ['cube', 'Cube'],
        ['dome', 'Dome'],
      ],
      value: initShape,
      onChange: () => this._fireSkyChange(),
    });
    this._skyShapeSelect = shapeSelect;
    body.appendChild(row('Sky Shape', shapeSelect));

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

    const _showRows = (type) => {
      solidRow.style.display = type === 'solid'    ? '' : 'none';
      gradWrap.style.display = type === 'gradient' ? '' : 'none';
      if (!this._activeTab) {
        if (this._skySectionEl) this._skySectionEl.style.display = type === 'sky' ? '' : 'none';
        if (this._envMapSectionEl) this._envMapSectionEl.style.display = type === 'hdri' ? '' : 'none';
      }
      if (this._skySectionBodyEl && type !== 'sky') this._skySectionBodyEl.style.display = 'none';
      if (this._envMapSectionBodyEl && type !== 'hdri') this._envMapSectionBodyEl.style.display = 'none';
    };
    this._showBackgroundTypeRows = _showRows;
    _showRows(initType);
    this._backgroundSectionEl = el;
  }

  _dispatchBackground(type) {
    const { colorStops, opacityStops } = this._bgGradEditor?.data ?? { colorStops: [], opacityStops: [] };
    window.dispatchEvent(new CustomEvent('cyco-background-change', {
      detail: {
        type,
        color: this._solidColor,
        colorStops,
        opacityStops,
        hdriRotation:        parseFloat(this._hdriRotSlider?.input.value    ?? 0),
        backgroundBlur:      parseFloat(this._hdriBlurSlider?.input.value   ?? 0),
        backgroundIntensity: parseFloat(this._hdriBgIntSlider?.input.value  ?? 1),
        envIntensity:        parseFloat(this._hdriEnvIntSlider?.input.value ?? 1),
      },
    }));
  }

  // ── Sky ───────────────────────────────────────────────────────────────────

  _buildSkySection(root) {
    const { el, hdr, body } = section('Sky');
    this._skySectionEl = el;
    this._skySectionBodyEl = body;
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
          // Switch background type to Sky when the user explicitly enables the sky.
          if (this._typeSelect) {
            this._typeSelect.value = 'sky';
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
        ['physical', 'Physical Sky'],
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

    const hueSlider = slider({
      value: 0.0, min: -180, max: 180, step: 1,
      onChange: () => _fire(),
    });
    body.appendChild(row('Hue', hueSlider.el));

    const skyTabBar = document.createElement('div');
    skyTabBar.className = 'ce-prop-sky-tab-bar';
    const makeSkyTab = (label, tab) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = label;
      btn.className = 'ce-btn ce-btn-sm ce-panel-tab-btn';
      btn.addEventListener('click', () => _showSkyTab(tab));
      return btn;
    };
    const sunTabBtn = makeSkyTab('Sun', 'sun');
    const moonTabBtn = makeSkyTab('Moon', 'moon');
    const flareTabBtn = makeSkyTab('Lens Flare', 'flare');
    skyTabBar.appendChild(sunTabBtn);
    skyTabBar.appendChild(moonTabBtn);
    skyTabBar.appendChild(flareTabBtn);
    body.appendChild(skyTabBar);

    const sunSection = document.createElement('div');
    const moonSection = document.createElement('div');
    const flareSection = document.createElement('div');
    body.appendChild(sunSection);
    body.appendChild(moonSection);
    body.appendChild(flareSection);

    const _showSkyTab = (tab) => {
      sunSection.style.display = tab === 'sun' ? '' : 'none';
      moonSection.style.display = tab === 'moon' ? '' : 'none';
      flareSection.style.display = tab === 'flare' ? '' : 'none';
      sunTabBtn.classList.toggle('active', tab === 'sun');
      moonTabBtn.classList.toggle('active', tab === 'moon');
      flareTabBtn.classList.toggle('active', tab === 'flare');
    };
    _showSkyTab('sun');

    // ── Atmosphere sub-section (Physical Sky only — Hosek-Wilkie params) ────
    const atmHdr = document.createElement('div');
    atmHdr.className = 'ce-prop-section-hdr';
    const atmArrow = document.createElement('span');
    atmArrow.className = 'ce-prop-arrow';
    atmArrow.textContent = '▾';
    atmHdr.appendChild(atmArrow);
    atmHdr.appendChild(document.createTextNode('Atmosphere'));
    atmHdr.style.display = 'none';
    body.appendChild(atmHdr);

    const atmBody = document.createElement('div');
    atmBody.style.display = 'none';
    atmHdr.addEventListener('click', () => {
      const open = atmBody.style.display !== 'none';
      atmBody.style.display = open ? 'none' : '';
      atmArrow.textContent = open ? '▸' : '▾';
    });

    const turbiditySlider = slider({ value: ve?.physicalSky?._p?.turbidity       ?? 2.0,  min: 0,   max: 20,   step: 0.1,   onChange: () => _fire() });
    const rayleighSlider  = slider({ value: ve?.physicalSky?._p?.rayleigh        ?? 1.0,  min: 0,   max: 4,    step: 0.05,  onChange: () => _fire() });
    const mieGSlider      = slider({ value: ve?.physicalSky?._p?.mieDirectionalG ?? 0.8,  min: 0,   max: 0.85, step: 0.01,  onChange: () => _fire() });
    const mieCSlider      = slider({ value: ve?.physicalSky?._p?.mieCoefficient  ?? 0.005,min: 0,   max: 0.1,  step: 0.001, onChange: () => _fire() });
    const ozoneRSlider    = slider({ value: ve?.physicalSky?._p?.ozoneR ?? 3.426e-7, min: 0, max: 1e-6,  step: 1e-8, onChange: () => _fire() });
    const ozoneGSlider    = slider({ value: ve?.physicalSky?._p?.ozoneG ?? 8.298e-7, min: 0, max: 1.5e-6,step: 1e-8, onChange: () => _fire() });
    const ozoneBSlider    = slider({ value: ve?.physicalSky?._p?.ozoneB ?? 3.56e-8,  min: 0, max: 2e-7,  step: 1e-9, onChange: () => _fire() });
    const skyBrightSlider = slider({ value: ve?.physicalSky?._p?.skyBrightness ?? 1.0, min: 0.1, max: 3.0, step: 0.05, onChange: () => _fire() });
    const zenithTintR     = slider({ value: ve?.physicalSky?._p?.zenithTintR ?? 1.0, min: 0, max: 2, step: 0.01, onChange: () => _fire() });
    const zenithTintG     = slider({ value: ve?.physicalSky?._p?.zenithTintG ?? 1.0, min: 0, max: 2, step: 0.01, onChange: () => _fire() });
    const zenithTintB     = slider({ value: ve?.physicalSky?._p?.zenithTintB ?? 1.0, min: 0, max: 2, step: 0.01, onChange: () => _fire() });
    const hazeTintR       = slider({ value: ve?.physicalSky?._p?.hazeTintR ?? 1.0, min: 0, max: 2, step: 0.01, onChange: () => _fire() });
    const hazeTintG       = slider({ value: ve?.physicalSky?._p?.hazeTintG ?? 1.0, min: 0, max: 2, step: 0.01, onChange: () => _fire() });
    const hazeTintB       = slider({ value: ve?.physicalSky?._p?.hazeTintB ?? 1.0, min: 0, max: 2, step: 0.01, onChange: () => _fire() });
    const nightColorR     = slider({ value: ve?.physicalSky?._p?.nightR ?? 0.02, min: 0, max: 0.5, step: 0.005, onChange: () => _fire() });
    const nightColorG     = slider({ value: ve?.physicalSky?._p?.nightG ?? 0.05, min: 0, max: 0.5, step: 0.005, onChange: () => _fire() });
    const nightColorB     = slider({ value: ve?.physicalSky?._p?.nightB ?? 0.18, min: 0, max: 0.5, step: 0.005, onChange: () => _fire() });

    atmBody.appendChild(row('Turbidity (Haze)',    turbiditySlider.el));
    atmBody.appendChild(row('Rayleigh (Blue Sky)', rayleighSlider.el));
    atmBody.appendChild(row('Mie Anisotropy',      mieGSlider.el));
    atmBody.appendChild(row('Mie Coefficient',     mieCSlider.el));
    atmBody.appendChild(row('Ozone R (680nm)',      ozoneRSlider.el));
    atmBody.appendChild(row('Ozone G (550nm)',      ozoneGSlider.el));
    atmBody.appendChild(row('Ozone B (440nm)',      ozoneBSlider.el));
    atmBody.appendChild(row('Sky Brightness',       skyBrightSlider.el));
    atmBody.appendChild(row('Zenith Tint R',        zenithTintR.el));
    atmBody.appendChild(row('Zenith Tint G',        zenithTintG.el));
    atmBody.appendChild(row('Zenith Tint B',        zenithTintB.el));
    atmBody.appendChild(row('Haze Tint R',          hazeTintR.el));
    atmBody.appendChild(row('Haze Tint G',          hazeTintG.el));
    atmBody.appendChild(row('Haze Tint B',          hazeTintB.el));
    atmBody.appendChild(row('Night Color R',        nightColorR.el));
    atmBody.appendChild(row('Night Color G',        nightColorG.el));
    atmBody.appendChild(row('Night Color B',        nightColorB.el));
    body.appendChild(atmBody);

    this._atmControls = {
      turbiditySlider, rayleighSlider, mieGSlider, mieCSlider,
      ozoneRSlider, ozoneGSlider, ozoneBSlider,
      skyBrightSlider,
      zenithTintR, zenithTintG, zenithTintB,
      hazeTintR, hazeTintG, hazeTintB,
      nightColorR, nightColorG, nightColorB,
    };

    // ── Sky gradient (collapsible) ────────────────────────────────────────
    const gradHdr = document.createElement('div');
    gradHdr.className = 'ce-prop-section-hdr';
    const gradArrow = document.createElement('span');
    gradArrow.className = 'ce-prop-arrow';
    gradArrow.textContent = '▾';
    gradHdr.appendChild(gradArrow);
    gradHdr.appendChild(document.createTextNode('Sky Colours'));
    body.appendChild(gradHdr);

    // gradBody wraps gradient editor so skyTypeSelect can show/hide it
    const gradBody = document.createElement('div');
    body.appendChild(gradBody);

    // ── Initial visibility sync ───────────────────────────────────────────────
    // The atmHdr/atmBody start hidden; sync display state for whatever sky type
    // is already active when the panel first opens (no onChange fires on init).
    {
      const t = skyTypeSelect.value;
      const visible = t === 'physical';
      atmHdr.style.display   = visible ? '' : 'none';
      atmBody.style.display  = visible ? '' : 'none';
      atmArrow.textContent  = visible ? '▾' : '▸';
      gradHdr.style.display  = t === 'gradient' ? '' : 'none';
      gradBody.style.display = t === 'gradient' ? '' : 'none';
    }

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

    // ── Sun controls ────────────────────────────────────────────────────────
    const _skyP = (ve?._activeSkyType === 'physical' ? ve?.physicalSky?._p : ve?.gradientSky?._p) || ve?.gradientSky?._p;  // current sky params for the selected sky type
    const showSunCb = checkbox({ checked: _skyP?.showSun ?? true, onChange: () => _fire() });
    const sunColorSw = colorSwatch({ color: '#fff8e7', onChange: () => _fire() });

    const sunComboCtrl = document.createElement('div');
    sunComboCtrl.style.cssText = 'display:flex;align-items:center;gap:6px;';
    sunComboCtrl.appendChild(showSunCb);
    sunComboCtrl.appendChild(sunColorSw.el);
    sunSection.appendChild(row('Sun', sunComboCtrl));

    const sunGlowSlider = slider({
      value: _skyP?.sunGlowStrength ?? 0.5, min: 0, max: 10, step: 0.1,
      onChange: () => _fire(),
    });
    sunSection.appendChild(row('Glow', sunGlowSlider.el));

    const sunScaleSlider = slider({
      value: _skyP?.sunScale ?? 1.0, min: 0.1, max: 3.0, step: 0.05,
      onChange: () => _fire(),
    });
    sunSection.appendChild(row('Size', sunScaleSlider.el));

    // ── Moon controls ───────────────────────────────────────────────────────
    const showMoonCb = checkbox({ checked: _skyP?.showMoon ?? true, onChange: () => _fire() });
    const moonColorSw = colorSwatch({ color: '#c0d4ff', onChange: () => _fire() });

    const moonComboCtrl = document.createElement('div');
    moonComboCtrl.style.cssText = 'display:flex;align-items:center;gap:6px;';
    moonComboCtrl.appendChild(showMoonCb);
    moonComboCtrl.appendChild(moonColorSw.el);
    moonSection.appendChild(row('Moon', moonComboCtrl));

    const moonGlowSlider = slider({
      value: _skyP?.moonGlowStrength ?? 0.3, min: 0, max: 10, step: 0.1,
      onChange: () => _fire(),
    });
    moonSection.appendChild(row('Glow', moonGlowSlider.el));

    const moonScaleSlider = slider({
      value: _skyP?.moonScale ?? 1.0, min: 0.1, max: 3.0, step: 0.05,
      onChange: () => _fire(),
    });
    moonSection.appendChild(row('Size', moonScaleSlider.el));

    // ── Lens Flare (Phase 5 granular controls) ───────────────────────────────
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

    // Feature toggles with individual intensity sliders
    const secondaryGhostsCb          = checkbox({ checked: _skyP?.lensflareSecondaryGhosts          ?? true,  onChange: () => _fire() });
    const secondaryGhostsIntSlider    = slider({ value: _skyP?.lensflareSecondaryGhostsIntensity    ?? 0.5,   min: 0, max: 1, step: 0.01, onChange: () => _fire() });
    const addStreaksCb                = checkbox({ checked: _skyP?.lensflareAdditionalStreaks        ?? false, onChange: () => _fire() });
    const streaksIntSlider            = slider({ value: _skyP?.lensflareStreaksIntensity             ?? 0.5,   min: 0, max: 1, step: 0.01, onChange: () => _fire() });
    const starBurstCb                 = checkbox({ checked: _skyP?.lensflareStarBurst               ?? false, onChange: () => _fire() });
    const starBurstIntSlider          = slider({ value: _skyP?.lensflareStarBurstIntensity           ?? 0.5,   min: 0, max: 1, step: 0.01, onChange: () => _fire() });
    const anamorphicCb                = checkbox({ checked: _skyP?.lensflareAnamorphic               ?? false, onChange: () => _fire() });
    const anamorphicIntSlider         = slider({ value: _skyP?.lensflareAnamorphicIntensity          ?? 0.3,   min: 0, max: 1, step: 0.01, onChange: () => _fire() });

    // Helper: build a row with a checkbox on the left and an intensity slider on the right
    const _cbIntRow = (label, cb, intSlider) => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'display:flex;align-items:center;gap:6px;width:100%;';
      wrap.appendChild(cb);
      const intWrap = document.createElement('div');
      intWrap.style.cssText = 'flex:1;min-width:0;';
      intWrap.appendChild(intSlider.el);
      wrap.appendChild(intWrap);
      return row(label, wrap);
    };

    flareSection.appendChild(row('Enable',           lensflareEnabledCb));
    flareSection.appendChild(row('Opacity',          opacitySlider.el));
    flareSection.appendChild(row('Glare Size',       glareSizeSlider.el));
    flareSection.appendChild(row('Star Points',      starPointsSlider.el));
    flareSection.appendChild(row('Flare Size',       flareSizeSlider.el));
    flareSection.appendChild(row('Flare Spread',     flareSpeedSlider.el));
    flareSection.appendChild(row('Flare Shape',      flareShapeSelect));
    flareSection.appendChild(row('Halo Scale',       haloScaleSlider.el));
    flareSection.appendChild(row('Color Gain',       colorGainSw.el));
    flareSection.appendChild(row('Ghost Scale',      ghostScaleSlider.el));
    flareSection.appendChild(_cbIntRow('Sec. Ghosts',    secondaryGhostsCb,  secondaryGhostsIntSlider));
    flareSection.appendChild(_cbIntRow('Extra Streaks',  addStreaksCb,        streaksIntSlider));
    flareSection.appendChild(_cbIntRow('Star Burst',     starBurstCb,         starBurstIntSlider));
    flareSection.appendChild(_cbIntRow('Anamorphic',     anamorphicCb,        anamorphicIntSlider));


    // Store all references
    this._skyControls = {
      enabledCb, elevationSlider, azimuthSlider,
      exposureSlider, saturationSlider, contrastSlider, hueSlider,
      gradEditor,
      showSunCb, sunColorSw, sunGlowSlider, sunScaleSlider,
      showMoonCb, moonColorSw, moonGlowSlider, moonScaleSlider,
      lensflareEnabledCb, opacitySlider, glareSizeSlider, starPointsSlider,
      flareSizeSlider, flareSpeedSlider, flareShapeSelect, haloScaleSlider,
      colorGainSw, ghostScaleSlider,
      secondaryGhostsCb, secondaryGhostsIntSlider,
      addStreaksCb, streaksIntSlider,
      starBurstCb, starBurstIntSlider,
      anamorphicCb, anamorphicIntSlider,
    };

    // Sync the initial sky shape selection into the engine state so the
    // sky wireframe helper uses the correct geometry even before sky is enabled.
    // Preserve the current sky enabled/disabled state instead of always
    // dispatching enabled=false, which would otherwise disable an active sky.
    this._fireSkyChange(!!ve?.skyEnabled);
  }

  /** Fire cyco-sky-change using current control state. */
  _fireSkyChange(enabledOverride) {
    const s = this._skyControls;
    if (!s) return;
    const isSkyMode = this._typeSelect?.value === 'sky';
    const enabled = (enabledOverride !== undefined)
      ? !!enabledOverride
      : (isSkyMode ? s.enabledCb.checked : false);
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
        hue:               parseFloat(s.hueSlider.input.value),
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
        ozoneR:            parseFloat(this._atmControls?.ozoneRSlider.input.value    ?? 3.426e-7),
        ozoneG:            parseFloat(this._atmControls?.ozoneGSlider.input.value    ?? 8.298e-7),
        ozoneB:            parseFloat(this._atmControls?.ozoneBSlider.input.value    ?? 3.56e-8),
        skyBrightness:     parseFloat(this._atmControls?.skyBrightSlider.input.value ?? 1.0),
        zenithTintR:       parseFloat(this._atmControls?.zenithTintR.input.value     ?? 1.0),
        zenithTintG:       parseFloat(this._atmControls?.zenithTintG.input.value     ?? 1.0),
        zenithTintB:       parseFloat(this._atmControls?.zenithTintB.input.value     ?? 1.0),
        hazeTintR:         parseFloat(this._atmControls?.hazeTintR.input.value       ?? 1.0),
        hazeTintG:         parseFloat(this._atmControls?.hazeTintG.input.value       ?? 1.0),
        hazeTintB:         parseFloat(this._atmControls?.hazeTintB.input.value       ?? 1.0),
        nightR:            parseFloat(this._atmControls?.nightColorR.input.value     ?? 0.02),
        nightG:            parseFloat(this._atmControls?.nightColorG.input.value     ?? 0.05),
        nightB:            parseFloat(this._atmControls?.nightColorB.input.value     ?? 0.18),
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
        lensflareSecondaryGhosts:         s.secondaryGhostsCb.checked,
        lensflareSecondaryGhostsIntensity: parseFloat(s.secondaryGhostsIntSlider.input.value),
        sunScale:              parseFloat(s.sunScaleSlider.input.value),
        moonScale:             parseFloat(s.moonScaleSlider.input.value),
        lensflareAdditionalStreaks:        s.addStreaksCb.checked,
        lensflareStreaksIntensity:         parseFloat(s.streaksIntSlider.input.value),
        lensflareStarBurst:               s.starBurstCb.checked,
        lensflareStarBurstIntensity:       parseFloat(s.starBurstIntSlider.input.value),
        lensflareAnamorphic:              s.anamorphicCb.checked,
        lensflareAnamorphicIntensity:      parseFloat(s.anamorphicIntSlider.input.value),
        skyShape:            this._skyShapeSelect?.value ?? 'cube',
      }
    }));
  }


  // ── Clouds (ground-level layer — shadow casting) ─────────────────────────

  _buildLowCloudsSection(root) {
    const { el, hdr, body } = section('Clouds');
    this._cloudsSectionEl = el;
    this._cloudsSectionBodyEl = body;
    root.appendChild(el);
    el.style.display = 'none';
    this._insertTabBackButton(hdr, 'clouds');

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

    const heightModeSelect2 = select({
      options: [
        ['camera-relative', 'Camera Relative'],
        ['world-relative', 'World Relative'],
      ],
      value: cs2()?._p?.cameraRelativeHeight ? 'camera-relative' : 'world-relative',
      onChange: (v) => {
        const cameraRelative = v === 'camera-relative';
        cs2()?.setParam('cameraRelativeHeight', cameraRelative);
        _updateCloudHeightLabels();
      },
      title: 'Choose whether cloud height is relative to the camera or fixed in world space.',
    });
    this._cloudHeightModeSelect = heightModeSelect2;

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
    body.appendChild(row('Clouds', topCtrl2));

    body.appendChild(row('Animate', animateCb2));

    const heightModeRow = row('Height Mode', heightModeSelect2);
    body.appendChild(heightModeRow);

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
      value: cs2()?._p?.scale ?? 30, min: 5, max: 3000, step: 1,
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

    const baseSlider2 = slider({
      value: cs2()?._p?.cloudBase ?? 80, min: 0, max: 5000, step: 1,
      onChange: (v) => cs2()?.setParam('cloudBase', v),
    });
    const baseRow2 = row('Cloud Base', baseSlider2.el);
    body.appendChild(baseRow2);

    const topSlider2 = slider({
      value: cs2()?._p?.cloudTop ?? 350, min: 0, max: 5000, step: 1,
      onChange: (v) => cs2()?.setParam('cloudTop', v),
    });
    const topRow2 = row('Cloud Top', topSlider2.el);
    body.appendChild(topRow2);

    const cloudShapeSelect2 = select({
      options: [
        ['cube',  'Cube'],
        ['dome',  'Dome'],
        ['plane', 'Plane'],
      ],
      value: cs2()?._p?.cloudShape ?? 'cube',
      onChange: (v) => cs2()?.setParam('cloudShape', v),
      title: 'Choose between cube, dome, or plane cloud volume shapes.',
    });
    body.appendChild(row('Cloud Shape', cloudShapeSelect2));

    const cloudSizeSlider2 = slider({
      value: cs2()?._p?.cloudVolumeSize ?? 120000, min: 1000, max: 900000, step: 1000,
      onChange: (v) => cs2()?.setParam('cloudVolumeSize', v),
    });
    body.appendChild(row('Cloud Volume Size', cloudSizeSlider2.el));

    const _updateCloudHeightLabels = () => {
      const cameraRelative = heightModeSelect2.value === 'camera-relative';
      const baseLabel = baseRow2.querySelector('.ce-prop-row-label');
      const topLabel = topRow2.querySelector('.ce-prop-row-label');
      if (baseLabel) {
        baseLabel.textContent = cameraRelative
          ? 'Cloud Base (camera offset)'
          : 'Cloud Base (world Y)';
      }
      if (topLabel) {
        topLabel.textContent = cameraRelative
          ? 'Cloud Top (camera offset)'
          : 'Cloud Top (world Y)';
      }
    };
    _updateCloudHeightLabels();

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
    const { el, hdr, body } = section('Fog');
    this._fogSectionEl = el;
    this._fogSectionBodyEl = body;
    root.appendChild(el);
    el.style.display = 'none';
    this._insertTabBackButton(hdr, 'fog');

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
    const { el, hdr, body } = section('God Rays');
    this._godRaysSectionEl = el;
    this._godRaysSectionBodyEl = body;
    root.appendChild(el);
    el.style.display = 'none';
    this._insertTabBackButton(hdr, 'godRays');

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
    this._envMapSectionEl = el;
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

    // HDRI Preset browser — thumbnail popup to the left of the panel
    const presetWrap = document.createElement('div');
    presetWrap.style.cssText = 'display:inline-block;';
    const presetBtn = document.createElement('button');
    presetBtn.textContent = 'HDRI Presets…';
    presetBtn.className = 'ce-btn ce-btn-sm';
    presetBtn.style.cssText = fileBtn.style.cssText;

    // Build popup once and attach to body (positioned via fixed layout)
    const hdriPopup = this._createHdriPopup();
    document.body.appendChild(hdriPopup);

    presetBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (hdriPopup.style.display !== 'none') {
        hdriPopup.style.display = 'none';
        return;
      }
      // Auto-position only on first open; afterwards the user can drag it anywhere
      if (!hdriPopup._positioned) {
        hdriPopup._positioned = true;
        const rect = presetBtn.getBoundingClientRect();
        const pw = parseInt(hdriPopup.style.width)  || 284;
        const ph = parseInt(hdriPopup.style.height) || 510;
        // Walk up DOM to find the panel container's left edge
        let panelLeft = rect.left;
        let el = presetBtn.parentElement;
        while (el && el !== document.body) {
          const r = el.getBoundingClientRect();
          if (r.left < panelLeft - 4) { panelLeft = r.left; break; }
          el = el.parentElement;
        }
        const left = Math.max(4, panelLeft - pw - 4);
        const top  = Math.max(40, Math.min(rect.top - Math.round(ph / 2), window.innerHeight - ph - 20));
        hdriPopup.style.left = `${left}px`;
        hdriPopup.style.top  = `${top}px`;
      }
      hdriPopup.style.display = 'flex';
    });

    presetWrap.appendChild(presetBtn);
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
      checked: !!window.__cyco?.viewportEngine?._envBackgroundEnabled,
      onChange: (v) => {
        window.dispatchEvent(new CustomEvent('cyco-env-background-toggle', { detail: { enabled: v } }));
      },
    });
    body.appendChild(row('Show as Background', bgCb));

    const hdriRotSlider  = slider({ value: 0,   min: 0,   max: 360, step: 1,    onChange: () => this._dispatchBackground('hdri') });
    const hdriBlurSlider = slider({ value: 0,   min: 0,   max: 1,   step: 0.01, onChange: () => this._dispatchBackground('hdri') });
    const hdriBgIntSlider  = slider({ value: 1, min: 0,   max: 4,   step: 0.05, onChange: () => this._dispatchBackground('hdri') });
    const hdriEnvIntSlider = slider({ value: 1, min: 0,   max: 4,   step: 0.05, onChange: () => this._dispatchBackground('hdri') });

    body.appendChild(row('Rotation',     hdriRotSlider.el));
    body.appendChild(row('BG Blur',      hdriBlurSlider.el));
    body.appendChild(row('BG Intensity', hdriBgIntSlider.el));
    body.appendChild(row('Env Intensity', hdriEnvIntSlider.el));

    this._hdriRotSlider    = hdriRotSlider;
    this._hdriBlurSlider   = hdriBlurSlider;
    this._hdriBgIntSlider  = hdriBgIntSlider;
    this._hdriEnvIntSlider = hdriEnvIntSlider;
  }

  _buildTabBar(root) {
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;align-items:center;gap:6px;padding:6px 0;flex-wrap:wrap;';

    const makeTab = (label, tab) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = label;
      btn.className = 'ce-btn ce-btn-sm ce-panel-tab-btn';
      btn.style.cssText = 'font-size:10px;padding:3px 8px;';
      btn.addEventListener('click', () => {
        if (this._activeTab === tab) {
          this._showTab(null);
        } else {
          this._showTab(tab);
        }
      });
      return btn;
    };

    this._cloudsTabBtn = makeTab('Clouds', 'clouds');
    this._fogTabBtn = makeTab('Fog', 'fog');
    this._godRaysTabBtn = makeTab('God Rays', 'godRays');
    this._postTabBtn = makeTab('POST', 'post');

    bar.appendChild(this._cloudsTabBtn);
    bar.appendChild(this._fogTabBtn);
    bar.appendChild(this._godRaysTabBtn);
    bar.appendChild(this._postTabBtn);

    root.appendChild(bar);
    this._tabBarEl = bar;
  }

  _showTab(tabName) {
    this._activeTab = tabName || null;
    const tabs = ['clouds', 'fog', 'godRays', 'post'];

    tabs.forEach((tab) => {
      const btn = this[`_${tab}TabBtn`];
      if (btn) btn.classList.toggle('active', tab === this._activeTab);
      const sectionEl = this[`_${tab}SectionEl`];
      const bodyEl = this[`_${tab}SectionBodyEl`];
      if (sectionEl) sectionEl.style.display = tab === this._activeTab ? '' : 'none';
      if (bodyEl) bodyEl.style.display = tab === this._activeTab ? '' : 'none';
      const backBtn = this[`_${tab}BackBtn`];
      if (backBtn) backBtn.style.display = tab === this._activeTab ? '' : 'none';
    });

    const isTabActive = !!this._activeTab;
    if (this._backgroundSectionEl) this._backgroundSectionEl.style.display = '';
    if (this._backgroundSectionBodyEl) this._backgroundSectionBodyEl.style.display = isTabActive ? 'none' : '';
    if (this._skySectionEl) this._skySectionEl.style.display = isTabActive ? 'none' : (this._typeSelect?.value === 'sky' ? '' : 'none');
    if (this._envMapSectionEl) this._envMapSectionEl.style.display = isTabActive ? 'none' : (this._typeSelect?.value === 'hdri' ? '' : 'none');
  }

  _insertTabBackButton(hdr, tabName) {
    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.textContent = '← Back';
    backBtn.className = 'ce-btn ce-btn-sm tab-back-btn';
    backBtn.style.cssText = 'font-size:10px;padding:3px 8px;margin-left:auto;';
    backBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._showTab(null);
    });
    backBtn.style.display = 'none';
    hdr.appendChild(backBtn);
    this[`_${tabName}BackBtn`] = backBtn;
  }

  // ── HDRI Preset popup builder ──────────────────────────────────────────────

  _createHdriPopup() {
    const PRESETS = [
      // Built-in
      { category: 'Built-in', label: 'Room Environment', type: 'room',
        thumbCss: 'radial-gradient(ellipse at 65% 35%, #d8d8d8 0%, #a0a0a0 55%, #606060 100%)' },
      // Outdoor — Poly Haven CC0 HDRIs
      { category: 'Outdoor', label: 'Autumn Field',       slug: 'autumn_field_puresky' },
      { category: 'Outdoor', label: 'Golden Hour',        slug: 'kloppenheim_06_puresky' },
      { category: 'Outdoor', label: 'Industrial Sunset',  slug: 'industrial_sunset_puresky' },
      { category: 'Outdoor', label: 'Evening Road',       slug: 'evening_road_01_puresky' },
      { category: 'Outdoor', label: 'Sky Is On Fire',     slug: 'the_sky_is_on_fire' },
      { category: 'Outdoor', label: 'Overcast',           slug: 'kloofendal_overcast_puresky' },
      { category: 'Outdoor', label: 'Moonlit Night',      slug: 'kloppenheim_02' },
      { category: 'Outdoor', label: 'Milky Way',          slug: 'moonless_golf' },
      // Studio — Poly Haven CC0 HDRIs
      { category: 'Studio',  label: 'Brown Studio',       slug: 'brown_photostudio_02' },
      { category: 'Studio',  label: 'Soft Octabox',       slug: 'studio_small_09' },
      { category: 'Studio',  label: 'Large Softboxes',    slug: 'studio_small_08' },
      { category: 'Studio',  label: 'Cool Fluorescent',   slug: 'photo_studio_01' },
    ];

    const popup = document.createElement('div');
    popup.style.cssText =
      'display:none;position:fixed;z-index:10000;width:284px;height:510px;' +
      'min-width:220px;min-height:300px;flex-direction:column;overflow:hidden;' +
      'background:var(--bg-secondary,#1e1e1e);' +
      'border:1px solid var(--border-color,#3a3a3a);border-radius:8px;' +
      'box-shadow:0 10px 40px rgba(0,0,0,.75);';

    // ── Drag & resize state ──────────────────────────────────────────────────
    let isDragging = false, dragOffX = 0, dragOffY = 0;
    let isResizing = false, resStartX = 0, resStartY = 0, resStartW = 0, resStartH = 0;
    const onDocMove = (e) => {
      if (isDragging) {
        let x = e.clientX - dragOffX;
        let y = e.clientY - dragOffY;
        x = Math.max(0, Math.min(window.innerWidth  - 60, x));
        y = Math.max(0, Math.min(window.innerHeight - 40, y));
        popup.style.left = `${x}px`;
        popup.style.top  = `${y}px`;
      } else if (isResizing) {
        popup.style.width  = `${Math.max(220, resStartW + (e.clientX - resStartX))}px`;
        popup.style.height = `${Math.max(300, resStartH + (e.clientY - resStartY))}px`;
      }
    };
    const onDocUp = () => {
      if (isDragging) hdr.style.cursor = 'grab';
      isDragging = false;
      isResizing = false;
    };
    document.addEventListener('mousemove', onDocMove);
    document.addEventListener('mouseup',   onDocUp);

    // ── Header (drag handle) ─────────────────────────────────────────────────
    const xBtn = document.createElement('button');
    xBtn.textContent = '×';
    xBtn.style.cssText =
      'background:none;border:none;color:var(--text-secondary,#888);' +
      'font-size:18px;line-height:1;cursor:pointer;padding:0 3px;flex-shrink:0;';
    xBtn.addEventListener('click', () => { popup.style.display = 'none'; });

    const hdr = document.createElement('div');
    hdr.style.cssText =
      'display:flex;align-items:center;justify-content:space-between;' +
      'padding:8px 10px 7px;border-bottom:1px solid var(--border-color,#2c2c2c);' +
      'flex-shrink:0;user-select:none;cursor:grab;';
    hdr.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || e.target === xBtn) return;
      isDragging = true;
      const r = popup.getBoundingClientRect();
      dragOffX = e.clientX - r.left;
      dragOffY = e.clientY - r.top;
      hdr.style.cursor = 'grabbing';
      e.preventDefault();
    });

    const ttl = document.createElement('span');
    ttl.textContent = 'HDRI Presets';
    ttl.style.cssText = 'font-size:12px;font-weight:600;color:var(--text-primary,#e0e0e0);';
    hdr.appendChild(ttl);
    hdr.appendChild(xBtn);
    popup.appendChild(hdr);

    // ── Scrollable body ──────────────────────────────────────────────────────
    const scrollBody = document.createElement('div');
    scrollBody.style.cssText = 'flex:1;overflow-y:auto;padding:8px 8px 12px;min-height:0;';

    let activeCard = null;
    const categories = [...new Set(PRESETS.map(p => p.category))];

    categories.forEach(cat => {
      const catEl = document.createElement('div');
      catEl.textContent = cat;
      catEl.style.cssText =
        'font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;' +
        'color:var(--text-secondary,#666);padding:4px 2px 5px;';
      scrollBody.appendChild(catEl);

      const grid = document.createElement('div');
      grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-bottom:10px;';

      PRESETS.filter(p => p.category === cat).forEach(preset => {
        const card = document.createElement('div');
        card.style.cssText =
          'border:2px solid var(--border-color,#2a2a2a);border-radius:6px;' +
          'overflow:hidden;cursor:pointer;transition:border-color 0.12s,opacity 0.12s;';

        if (preset.thumbCss) {
          const thumb = document.createElement('div');
          thumb.style.cssText = `width:100%;aspect-ratio:1/1;background:${preset.thumbCss};`;
          card.appendChild(thumb);
        } else {
          const img = document.createElement('img');
          img.src = `https://cdn.polyhaven.com/asset_img/thumbs/${preset.slug}.png?width=256&height=256`;
          img.alt = preset.label;
          img.loading = 'lazy';
          img.style.cssText = 'width:100%;aspect-ratio:1/1;object-fit:cover;display:block;background:var(--bg-primary,#141414);';
          card.appendChild(img);
        }

        const lbl = document.createElement('div');
        lbl.textContent = preset.label;
        lbl.style.cssText =
          'font-size:9px;text-align:center;padding:3px 4px 4px;' +
          'color:var(--text-secondary,#aaa);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;' +
          'background:var(--bg-primary,#161616);';
        card.appendChild(lbl);

        card.addEventListener('mouseenter', () => {
          if (card !== activeCard) card.style.borderColor = 'rgba(224,114,40,.55)';
        });
        card.addEventListener('mouseleave', () => {
          if (card !== activeCard) card.style.borderColor = 'var(--border-color,#2a2a2a)';
        });

        card.addEventListener('click', () => {
          if (activeCard) activeCard.style.borderColor = 'var(--border-color,#2a2a2a)';
          activeCard = card;
          card.style.borderColor = 'rgba(224,114,40,.95)';
          popup.style.display = 'none';

          if (preset.type === 'room') {
            window.dispatchEvent(new CustomEvent('cyco-env-preset', { detail: { preset: 'room' } }));
            if (this._statusLabel) this._statusLabel.textContent = 'Room Environment (built-in)';
            return;
          }

          const url = `https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/${preset.slug}_2k.hdr`;
          if (this._statusLabel) this._statusLabel.textContent = `⏳ Loading: ${preset.label}…`;
          window.dispatchEvent(new CustomEvent('cyco-env-map-change', { detail: { url, isHDR: true } }));
          // Update label once loaded (listen for success) or after timeout
          const onLoaded = () => {
            if (this._statusLabel) this._statusLabel.textContent = `${preset.label} (Poly Haven CC0)`;
            window.removeEventListener('cyco-env-map-loaded', onLoaded);
          };
          window.addEventListener('cyco-env-map-loaded', onLoaded);
          setTimeout(() => {
            window.removeEventListener('cyco-env-map-loaded', onLoaded);
            if (this._statusLabel && this._statusLabel.textContent.startsWith('⏳')) {
              this._statusLabel.textContent = `${preset.label} (Poly Haven CC0)`;
            }
          }, 15000);
        });

        grid.appendChild(card);
      });

      scrollBody.appendChild(grid);
    });

    // ── Footer ───────────────────────────────────────────────────────────────
    const footer = document.createElement('div');
    footer.style.cssText =
      'font-size:9px;color:var(--text-secondary,#555);padding:6px 8px 4px;' +
      'border-top:1px solid var(--border-color,#2a2a2a);flex-shrink:0;text-align:center;';
    footer.textContent = 'Poly Haven CC0 · loaded from CDN on demand';

    popup.appendChild(scrollBody);
    popup.appendChild(footer);

    // ── Resize grip (bottom-right corner) ────────────────────────────────────
    const resizeGrip = document.createElement('div');
    resizeGrip.style.cssText =
      'position:absolute;bottom:4px;right:4px;width:14px;height:14px;cursor:se-resize;z-index:1;';
    resizeGrip.innerHTML =
      '<svg width="10" height="10" viewBox="0 0 10 10" style="opacity:.35;display:block;margin:2px;">' +
      '<line x1="1" y1="9" x2="9" y2="1" stroke="#ccc" stroke-width="1.5" stroke-linecap="round"/>' +
      '<line x1="5" y1="9" x2="9" y2="5" stroke="#ccc" stroke-width="1.5" stroke-linecap="round"/>' +
      '</svg>';
    resizeGrip.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      isResizing = true;
      resStartX = e.clientX;
      resStartY = e.clientY;
      resStartW = popup.offsetWidth;
      resStartH = popup.offsetHeight;
      e.preventDefault();
      e.stopPropagation();
    });
    popup.appendChild(resizeGrip);

    return popup;
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
    const { el, hdr, body } = section('Post Processing');
    this._postSectionEl = el;
    this._postSectionBodyEl = body;
    root.appendChild(el);
    el.style.display = 'none';
    this._insertTabBackButton(hdr, 'post');

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

