/**
 * EnvironmentProperties.js
 * Fog, sky, and environment map settings panel.
 *
 * Events dispatched:
 *   cyco-fog-change        { type, color, near, far, density }
 *   cyco-sky-change        { enabled, elevation, azimuth }
 *   cyco-env-map-change    { url, isHDR }
 */

import * as THREE from 'three';
import { section, row, select, slider, checkbox, colorSwatch } from './propUtils.js';

export class EnvironmentProperties {
  constructor() {
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

    this._buildSkySection(root);
    this._buildFogSection(root);
    this._buildEnvMapSection(root);

    return root;
  }

  // ── Sky ──────────────────────────────────────────────────────────────────

  _buildSkySection(root) {
    const { el, body } = section('Sky');
    root.appendChild(el);

    const ve = window.__cyco?.viewportEngine;

    const enabledCb = checkbox({
      checked: !!ve?.skyEnabled,
      onChange: (v) => {
        window.dispatchEvent(new CustomEvent('cyco-sky-change', {
          detail: {
            enabled:   v,
            elevation: parseFloat(elevationSlider.input.value),
            azimuth:   parseFloat(azimuthSlider.input.value),
          }
        }));
      },
    });
    body.appendChild(row('Show Sky', enabledCb));

    const elevationSlider = slider({
      value: ve?.skyElevation ?? 30, min: 0, max: 90, step: 0.5,
      onChange: (v) => {
        window.dispatchEvent(new CustomEvent('cyco-sky-change', {
          detail: { enabled: enabledCb.checked, elevation: v, azimuth: parseFloat(azimuthSlider.input.value) }
        }));
      },
    });
    body.appendChild(row('Elevation', elevationSlider.el));

    const azimuthSlider = slider({
      value: ve?.skyAzimuth ?? 180, min: 0, max: 360, step: 1,
      onChange: (v) => {
        window.dispatchEvent(new CustomEvent('cyco-sky-change', {
          detail: { enabled: enabledCb.checked, elevation: parseFloat(elevationSlider.input.value), azimuth: v }
        }));
      },
    });
    body.appendChild(row('Azimuth', azimuthSlider.el));
  }

  // ── Fog ──────────────────────────────────────────────────────────────────

  _buildFogSection(root) {
    const { el, body } = section('Fog');
    root.appendChild(el);

    const scene = window.__cyco?.viewportEngine?.scene;
    const fogType = scene?.fog instanceof THREE.FogExp2 ? 'exp2'
                  : scene?.fog instanceof THREE.Fog      ? 'linear'
                  : 'none';
    const fogColor = '#' + (scene?.fog?.color?.getHexString() ?? 'aaaaaa');

    // Row visibility helpers
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
        this._applyFogType(v, colorSw.el.style.getPropertyValue('--sw-color'),
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

    // Linear fog rows
    const curFog = scene?.fog;
    const nearSlider = slider({
      value: curFog instanceof THREE.Fog ? curFog.near : 10, min: 0, max: 500, step: 0.5,
      onChange: () => { if (curFog instanceof THREE.Fog) curFog.near = parseFloat(nearSlider.input.value); },
    });
    const nearRow = row('Near', nearSlider.el);
    nearRow.style.display = fogType === 'linear' ? '' : 'none';
    linearRows.push(nearRow);
    body.appendChild(nearRow);

    const farSlider = slider({
      value: curFog instanceof THREE.Fog ? curFog.far : 100, min: 0, max: 2000, step: 1,
      onChange: () => { if (curFog instanceof THREE.Fog) curFog.far = parseFloat(farSlider.input.value); },
    });
    const farRow = row('Far', farSlider.el);
    farRow.style.display = fogType === 'linear' ? '' : 'none';
    linearRows.push(farRow);
    body.appendChild(farRow);

    // Exponential fog rows
    const densitySlider = slider({
      value: curFog instanceof THREE.FogExp2 ? curFog.density : 0.002, min: 0, max: 0.1, step: 0.0001,
      onChange: () => { if (window.__cyco?.viewportEngine?.scene?.fog instanceof THREE.FogExp2) window.__cyco.viewportEngine.scene.fog.density = parseFloat(densitySlider.input.value); },
    });
    const densityRow = row('Density', densitySlider.el);
    densityRow.style.display = fogType === 'exp2' ? '' : 'none';
    exp2Rows.push(densityRow);
    body.appendChild(densityRow);
  }

  _applyFogType(type, colorHex, near, far, density) {
    const scene = window.__cyco?.viewportEngine?.scene;
    if (!scene) return;
    if (type === 'none') { scene.fog = null; }
    else if (type === 'linear') { scene.fog = new THREE.Fog(colorHex, near, far); }
    else if (type === 'exp2')   { scene.fog = new THREE.FogExp2(colorHex, density); }
    window.dispatchEvent(new CustomEvent('cyco-fog-change', { detail: { type, color: colorHex, near, far, density } }));
  }

  _fogState() {
    const fog = window.__cyco?.viewportEngine?.scene?.fog;
    if (!fog) return { type: 'none' };
    if (fog instanceof THREE.FogExp2) return { type: 'exp2', color: '#' + fog.color.getHexString(), density: fog.density };
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

    const fileBtn = document.createElement('button');
    fileBtn.textContent = 'Load HDR / EXR…';
    fileBtn.className = 'ce-btn ce-btn-sm';
    fileBtn.style.cssText = 'margin-top:4px;font-size:11px;padding:3px 10px;border-radius:4px;cursor:pointer;background:var(--bg-secondary,#252525);border:1px solid var(--border-color,#333);color:var(--text-primary,#e0e0e0);';
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
        this._statusLabel.textContent = file.name;
      } catch {
        // User cancelled
      }
    });
    body.appendChild(fileBtn);

    this._statusLabel = document.createElement('div');
    this._statusLabel.style.cssText = 'font-size:10px;color:var(--text-secondary,#777);margin-top:3px;';
    this._statusLabel.textContent = 'No custom env map';
    body.appendChild(this._statusLabel);

    // Background toggle
    const bgCb = checkbox({
      checked: !!(window.__cyco?.viewportEngine?.scene?.background),
      onChange: (v) => {
        window.dispatchEvent(new CustomEvent('cyco-env-background-toggle', { detail: { enabled: v } }));
      },
    });
    body.appendChild(row('Show as Background', bgCb));
  }

  dispose() {}
}
