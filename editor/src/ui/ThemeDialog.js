/**
 * ThemeDialog.js — "Customize Theme" modal dialog.
 * Opened via ThemeDialog.open().
 * Layout:
 *   Row 1: [Randomize] [Blend ▼] [Advanced ▼]
 *   Row 2: 5 color swatches (Text / BG / Primary / Secondary / Accent)
 *   (collapsible) Blend grid of 10 curated palettes
 *   (collapsible) Advanced row of 4 derived-state swatches
 *   Font family select + S/M/L size buttons
 *   Footer: [Save as Preset] [Apply] [Cancel]
 */

import ThemeManager   from '../theme/theme-manager.js';
import { cePrompt }   from './ce-prompt.js';
import CeColorPicker  from './CeColorPicker.js';

// ─── Curated blend palettes ───────────────────────────────────────────────────
const BLEND_PALETTES = [
  { name: 'Dark Coffee',    colors: ['#ede8e0','#252118','#e07228','#c85a10','#6ab26a'] },
  { name: 'Light Cream',    colors: ['#2c2418','#ece6d8','#c95f10','#b04a08','#3d8c3d'] },
  { name: 'Midnight Blue',  colors: ['#cdd9e5','#131a24','#4d93e8','#2a6db5','#57ab5a'] },
  { name: 'Forest Green',   colors: ['#d4e0d4','#131d16','#8fbc4e','#5a9e30','#4a9e6a'] },
  { name: 'Slate Purple',   colors: ['#e0dcf0','#16131e','#9b72cf','#7040a0','#72b0cf'] },
  { name: 'Warm Amber',     colors: ['#f8f0e0','#1e1810','#d4882a','#a86018','#6aad72'] },
  { name: 'Ocean Teal',     colors: ['#d0eae8','#0e1918','#2ab8a8','#168870','#b8922a'] },
  { name: 'Rose Quartz',    colors: ['#f0d8dc','#1e1012','#d45870','#a03050','#58a87a'] },
  { name: 'Charcoal Mono',  colors: ['#e8e8e8','#121212','#888888','#606060','#aaaaaa'] },
  { name: 'Cyber Orange',   colors: ['#f0ebe0','#151008','#ff6a00','#cc4800','#00b4cc'] },
];

// Map blend palette (5 colors) to a ThemeManager palette object
function blendToTheme(colors, current) {
  return {
    textPrimary:  colors[0],
    bgBase:       colors[1],
    bgPanel:      _adjustColor(colors[1], 5),
    bgSurface:    _adjustColor(colors[1], 10),
    bgRaised:     _adjustColor(colors[1], 15),
    bgTabInactive:_adjustColor(colors[1], 10),
    bgMenuBar:    _adjustColor(colors[1], 10),
    bgToolbar:    _adjustColor(colors[1], 5),
    scrollTrack:  _adjustColor(colors[1], 5),
    scrollThumb:  _adjustColor(colors[1], 18),
    textMuted:    _midColor(colors[0], colors[1]),
    accentOrange: colors[2],
    accentGreen:  colors[4],
    border:       _adjustColor(colors[1], 12),
    fontFamily:   current?.fontFamily  || 'Inter',
    fontSize:     current?.fontSize    || 'M',
  };
}

function _adjustColor(hex, lightnessDelta) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  const clamp = v => Math.max(0, Math.min(255, v));
  const avg = (r+g+b)/3;
  const dir = avg < 128 ? 1 : -1;
  const d = Math.round(lightnessDelta * 2.55 * dir);
  return '#' + [r+d,g+d,b+d].map(v => clamp(v).toString(16).padStart(2,'0')).join('');
}

function _midColor(hex1, hex2) {
  const r = Math.round((parseInt(hex1.slice(1,3),16)+parseInt(hex2.slice(1,3),16))/2);
  const g = Math.round((parseInt(hex1.slice(3,5),16)+parseInt(hex2.slice(3,5),16))/2);
  const b = Math.round((parseInt(hex1.slice(5,7),16)+parseInt(hex2.slice(5,7),16))/2);
  return '#' + [r,g,b].map(v => v.toString(16).padStart(2,'0')).join('');
}

// ─── ThemeDialog singleton ────────────────────────────────────────────────────
const ThemeDialog = {
  _dialog: null,
  _snapshot: null,
  _working: null,
  _blendOpen: false,
  _advOpen: false,
  _bgSurfacePinned: false,
  _bgRaisedPinned: false,
  _borderPinned: false,
  _dialogOpacity: 95,
  _themeChangeHandler: null,
  // Inspect / interactive mode state
  _interactive:         false,
  _inspectFooter:       null,
  _inspectHighlight:    null,
  _inspectPopup:        null,
  _inspectHoverHandler: null,
  _inspectClickHandler: null,

  open() {
    // Remove stale dialog if any
    if (this._dialog) { this._dialog.remove(); this._dialog = null; }

    this._snapshot = ThemeManager.getCurrent();
    this._working  = ThemeManager.getCurrent();
    this._bgSurfacePinned = false;
    this._bgRaisedPinned  = false;
    this._borderPinned    = false;
    this._dialogOpacity   = 95;

    const dlg = document.createElement('dialog');
    dlg.className = 'ce-theme-dialog';
    this._dialog = dlg;

    dlg.innerHTML = this._buildHTML();
    document.body.appendChild(dlg);

    this._bindEvents(dlg);
    this._syncSwatches();
    this._applyDialogBg();

    // Keep dialog BG color in sync whenever the theme changes
    this._themeChangeHandler = () => this._applyDialogBg();
    document.addEventListener('cyco-theme-change', this._themeChangeHandler);

    dlg.showModal();
  },

  _buildHTML() {
    const allPresets = ThemeManager.listPresets();
    const escAttr = s => s.replace(/"/g,'&quot;').replace(/</g,'&lt;');
    const escText = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;');
    return `
      <div class="ce-dialog-title-row">
        <div class="ce-dialog-title">Customize Theme</div>
        <button class="ce-btn ce-inspect-toggle-btn" id="ce-btn-interactive">⊕ Interactive</button>
      </div>

      <!-- Window opacity -->
      <div class="ce-dialog-opacity-row">
        <span class="ce-dialog-label">Window Opacity</span>
        <input type="range" class="ce-opacity-slider" id="ce-dialog-opacity" min="10" max="100" value="95" step="1">
        <span class="ce-opacity-value" id="ce-opacity-value">95%</span>
      </div>

      <!-- Base theme selector -->
      <div class="ce-dialog-base-row">
        <label class="ce-dialog-base-label">Start from</label>
        <select class="ce-select ce-base-select" id="ce-base-select">
          ${allPresets.map(n => `<option value="${escAttr(n)}">${escText(n)}</option>`).join('')}
        </select>
      </div>

      <!-- Button row -->
      <div class="ce-dialog-btn-row">
        <button class="ce-btn" id="ce-btn-randomize">⟳ Randomize</button>
        <button class="ce-btn" id="ce-btn-blend">⬡ Blend ▼</button>
        <button class="ce-btn" id="ce-btn-advanced">⚙ Advanced ▼</button>
      </div>

      <!-- Blend grid (collapsible) -->
      <div class="ce-blend-grid" id="ce-blend-grid">
        ${BLEND_PALETTES.map((p,i) => `
          <div class="ce-blend-row" data-blend-idx="${i}" title="${escAttr(p.name)}">
            ${p.colors.map(c => `<div class="ce-blend-swatch" style="background:${c}"></div>`).join('')}
          </div>
        `).join('')}
      </div>

      <!-- Panel Tabs swatches: Tab Strip, Inactive Tab, Active Tab, Text, Dim Text -->
      <div class="ce-dialog-section-label">Panel Tabs</div>
      <div class="ce-swatch-row">
        ${['bgSurface','bgTabInactive','bgRaised','textPrimary','textMuted'].map(role => `
          <div class="ce-swatch-wrap">
            <button class="ce-swatch-btn" data-role="${role}" style="background:#888"></button>
            <span class="ce-swatch-label">${_roleLabel(role)}</span>
          </div>
        `).join('')}
      </div>

      <!-- Color Palette swatches -->
      <div class="ce-dialog-section-label">Color Palette</div>
      <div class="ce-swatch-row" id="ce-swatch-row">
        ${['bgBase','bgPanel','accentOrange','accentGreen','border'].map(role => `
          <div class="ce-swatch-wrap">
            <button class="ce-swatch-btn" data-role="${role}" style="background:#888"></button>
            <span class="ce-swatch-label">${_roleLabel(role)}</span>
          </div>
        `).join('')}
      </div>

      <!-- UI Bars swatches -->
      <div class="ce-dialog-section-label">UI Bars</div>
      <div class="ce-swatch-row">
        ${['bgMenuBar','bgToolbar'].map(role => `
          <div class="ce-swatch-wrap">
            <button class="ce-swatch-btn" data-role="${role}" style="background:#888"></button>
            <span class="ce-swatch-label">${_roleLabel(role)}</span>
          </div>
        `).join('')}
      </div>

      <!-- Scrollbars swatches -->
      <div class="ce-dialog-section-label">Scrollbars</div>
      <div class="ce-swatch-row">
        ${['scrollTrack','scrollThumb'].map(role => `
          <div class="ce-swatch-wrap">
            <button class="ce-swatch-btn" data-role="${role}" style="background:#888"></button>
            <span class="ce-swatch-label">${_roleLabel(role)}</span>
          </div>
        `).join('')}
      </div>

      <!-- Advanced row (collapsible) -->
      <div class="ce-advanced-row" id="ce-advanced-row">
        ${['hoverBg','activeBg','selectionBgSolid','focusRing'].map(role => `
          <div class="ce-swatch-wrap">
            <button class="ce-swatch-btn" data-adv-role="${role}" style="background:#888"></button>
            <span class="ce-swatch-label">${_advRoleLabel(role)}</span>
          </div>
        `).join('')}
      </div>

      <!-- Font row -->
      <div class="ce-dialog-section-label">Typography</div>
      <div class="ce-font-row">
        <label style="font-size:12px;color:var(--ce-text-muted)">Font</label>
        <select class="ce-select" id="ce-font-select">
          <option value="Inter">Inter</option>
          <option value="JetBrains Mono">JetBrains Mono</option>
          <option value="Space Grotesk">Space Grotesk</option>
        </select>
        <label style="font-size:12px;color:var(--ce-text-muted)">Size</label>
        <div class="ce-size-btns">
          <button class="ce-size-btn" data-size="S">S</button>
          <button class="ce-size-btn active" data-size="M">M</button>
          <button class="ce-size-btn" data-size="L">L</button>
        </div>
      </div>

      <!-- Footer actions -->
      <div class="ce-dialog-actions">
        <button class="ce-btn ghost" id="ce-btn-cancel">Cancel</button>
        <button class="ce-btn" id="ce-btn-apply">Apply</button>
        <button class="ce-btn" id="ce-btn-save-over">Save</button>
        <button class="ce-btn primary" id="ce-btn-save">Save as Preset</button>
      </div>
    `;
  },

  _bindEvents(dlg) {
    // Base theme selector
    const baseSel = dlg.querySelector('#ce-base-select');
    const activeName = localStorage.getItem('cyco-theme-active') || 'Dark Coffee';
    if ([...baseSel.options].some(o => o.value === activeName)) baseSel.value = activeName;
    baseSel.addEventListener('change', (e) => {
      const data = ThemeManager.getPresetData(e.target.value);
      if (data) {
        this._working = { ...data };
        ThemeManager.applyTheme(this._working);
        this._syncSwatches();
        if (this._advOpen) this._syncAdvancedSwatches();
      }
    });

    // Main swatch clicks → open color picker
    dlg.querySelectorAll('.ce-swatch-btn[data-role]').forEach(btn => {
      const role = btn.dataset.role;
      btn.addEventListener('click', () => {
        CeColorPicker.open(btn, this._working[role] || '#888888',
          (color) => {
            this._working[role] = color;
            btn.style.background = color;
            if (role === 'bgPanel') {
              // Auto-derive linked colors unless the user has manually pinned them
              if (!this._bgSurfacePinned) {
                this._working.bgSurface = _adjustColor(color, 5);
                const surfaceBtn = dlg.querySelector('.ce-swatch-btn[data-role="bgSurface"]');
                if (surfaceBtn) surfaceBtn.style.background = this._working.bgSurface;
              }
              if (!this._bgRaisedPinned) {
                this._working.bgRaised = _adjustColor(color, 10);
                const raisedBtn = dlg.querySelector('.ce-swatch-btn[data-role="bgRaised"]');
                if (raisedBtn) raisedBtn.style.background = this._working.bgRaised;
              }
              if (!this._borderPinned) {
                this._working.border = _adjustColor(color, 14);
                const borderBtn = dlg.querySelector('.ce-swatch-btn[data-role="border"]');
                if (borderBtn) borderBtn.style.background = this._working.border;
              }
            }
            if (role === 'bgSurface') this._bgSurfacePinned = true;
            if (role === 'bgRaised')  this._bgRaisedPinned  = true;
            if (role === 'border')    this._borderPinned    = true;
            ThemeManager.applyTheme(this._working);
          },
          null
        );
      });
    });

    // Advanced swatch clicks → open color picker
    dlg.querySelectorAll('.ce-swatch-btn[data-adv-role]').forEach(btn => {
      const role = btn.dataset.advRole;
      btn.addEventListener('click', () => {
        const derived = ThemeManager.getDerivedStates(this._working);
        const current = this._working[role]
          || derived[role.replace('Solid','')] // e.g. selectionBgSolid → selectionBg
          || '#888888';
        const hexCurrent = (typeof current === 'string' && current.startsWith('rgba'))
          ? derived.focusRing
          : current;
        CeColorPicker.open(btn, hexCurrent,
          (color) => {
            this._working[role] = color;
            btn.style.background = color;
            ThemeManager.applyTheme(this._working);
          },
          null
        );
      });
    });

    // Randomize
    dlg.querySelector('#ce-btn-randomize').addEventListener('click', () => {
      this._working = ThemeManager.randomizePalette();
      ThemeManager.applyTheme(this._working);
      this._syncSwatches();
    });

    // Blend toggle
    dlg.querySelector('#ce-btn-blend').addEventListener('click', () => {
      this._blendOpen = !this._blendOpen;
      dlg.querySelector('#ce-blend-grid').classList.toggle('open', this._blendOpen);
    });
    dlg.querySelectorAll('.ce-blend-row').forEach(row => {
      row.addEventListener('click', () => {
        const idx = parseInt(row.dataset.blendIdx);
        const palette = BLEND_PALETTES[idx];
        this._working = blendToTheme(palette.colors, this._working);
        ThemeManager.applyTheme(this._working);
        this._syncSwatches();
        this._blendOpen = false;
        dlg.querySelector('#ce-blend-grid').classList.remove('open');
      });
    });

    // Advanced toggle
    dlg.querySelector('#ce-btn-advanced').addEventListener('click', () => {
      this._advOpen = !this._advOpen;
      dlg.querySelector('#ce-advanced-row').classList.toggle('open', this._advOpen);
      if (this._advOpen) this._syncAdvancedSwatches();
    });

    // Font select
    const fontSel = dlg.querySelector('#ce-font-select');
    fontSel.value = this._working.fontFamily || 'Inter';
    fontSel.addEventListener('change', (e) => {
      this._working.fontFamily = e.target.value;
      ThemeManager.applyTheme(this._working);
    });

    // Size buttons
    dlg.querySelectorAll('.ce-size-btn').forEach(btn => {
      if (btn.dataset.size === (this._working.fontSize || 'M')) btn.classList.add('active');
      btn.addEventListener('click', () => {
        dlg.querySelectorAll('.ce-size-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._working.fontSize = btn.dataset.size;
        ThemeManager.applyTheme(this._working);
      });
    });

    // Apply
    dlg.querySelector('#ce-btn-apply').addEventListener('click', () => {
      ThemeManager.applyTheme(this._working);
      this._close();
    });

    // Save (overwrite current active preset in-place, no prompt)
    dlg.querySelector('#ce-btn-save-over').addEventListener('click', () => {
      const activeName = localStorage.getItem('cyco-theme-active') || 'Dark Coffee';
      ThemeManager.savePreset(activeName, this._working);
      ThemeManager.applyTheme(this._working);
      this._close();
    });

    // Save as Preset (new name)
    dlg.querySelector('#ce-btn-save').addEventListener('click', async () => {
      const name = await cePrompt('Preset name:', 'My Theme');
      if (name) {
        ThemeManager.savePreset(name, this._working);
        ThemeManager.applyTheme(this._working);
        this._close();
      }
    });

    // Cancel
    dlg.querySelector('#ce-btn-cancel').addEventListener('click', () => this._cancel());

    // Interactive (inspect) mode
    dlg.querySelector('#ce-btn-interactive').addEventListener('click', () => this._enterInspectMode());

    // Window opacity slider
    const opacitySlider = dlg.querySelector('#ce-dialog-opacity');
    const opacityLabel  = dlg.querySelector('#ce-opacity-value');
    opacitySlider.addEventListener('input', (e) => {
      this._dialogOpacity = parseInt(e.target.value);
      opacityLabel.textContent = this._dialogOpacity + '%';
      this._applyDialogBg();
    });
  },

  _syncSwatches() {
    const dlg = this._dialog;
    if (!dlg) return;
    const roles = ['textPrimary','textMuted','bgBase','bgPanel','bgSurface','bgTabInactive','bgRaised','accentOrange','accentGreen','border','bgMenuBar','bgToolbar','scrollTrack','scrollThumb'];
    roles.forEach(role => {
      const val = this._working[role] || '#888888';
      const btn = dlg.querySelector(`.ce-swatch-btn[data-role="${role}"]`);
      if (btn) btn.style.background = val;
    });
    const fontSel = dlg.querySelector('#ce-font-select');
    if (fontSel) fontSel.value = this._working.fontFamily || 'Inter';
    const size = this._working.fontSize || 'M';
    dlg.querySelectorAll('.ce-size-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.size === size);
    });
  },

  _syncAdvancedSwatches() {
    const dlg = this._dialog;
    if (!dlg) return;
    const derived = ThemeManager.getDerivedStates(this._working);
    const roleMap = {
      hoverBg:          this._working.hoverBg     || derived.hoverBg,
      activeBg:         this._working.activeBg    || derived.activeBg,
      selectionBgSolid: this._working.selectionBgSolid || derived.focusRing, // solid version
      focusRing:        this._working.focusRing   || derived.focusRing,
    };
    Object.entries(roleMap).forEach(([role, val]) => {
      const btn   = dlg.querySelector(`.ce-swatch-btn[data-adv-role="${role}"]`);
      const input = dlg.querySelector(`input[data-adv-role="${role}"]`);
      // selectionBg is rgba, color inputs need hex
      const hexVal = (typeof val === 'string' && val.startsWith('rgba')) ? derived.focusRing : (val || derived.focusRing);
      if (btn)   btn.style.background = hexVal;
      if (input) input.value = hexVal;
    });
  },

  _applyDialogBg() {
    if (!this._dialog) return;
    const alpha = this._dialogOpacity / 100;
    const bg    = this._working?.bgRaised || '#3e3228';
    this._dialog.style.backgroundColor = _hexToRgba(bg, alpha);
    // Scale border and shadow with opacity so at 0 the window is invisible
    this._dialog.style.borderColor = alpha <= 0.01 ? 'transparent' : '';
    this._dialog.style.boxShadow   = alpha <= 0.01 ? 'none' : '';
  },

  // ─── Inspect / Interactive mode ──────────────────────────────────────────

  _enterInspectMode() {
    this._interactive = true;
    this._dialog.close(); // hide dialog; keep in DOM so we can re-show it

    this._inspectFooter = this._buildInspectFooter();
    document.body.appendChild(this._inspectFooter);

    const hl = document.createElement('div');
    hl.className = 'ce-inspect-highlight';
    document.body.appendChild(hl);
    this._inspectHighlight = hl;

    this._inspectHoverHandler = (e) => {
      const el = this._getInspectTarget(e.clientX, e.clientY);
      if (!el) { hl.style.display = 'none'; return; }
      const r = el.getBoundingClientRect();
      hl.style.display = 'block';
      hl.style.left    = r.left   + 'px';
      hl.style.top     = r.top    + 'px';
      hl.style.width   = r.width  + 'px';
      hl.style.height  = r.height + 'px';
    };

    this._inspectClickHandler = (e) => {
      if (e.target.closest('.ce-inspect-footer, .ce-inspect-popup, .ce-color-picker')) return;
      e.preventDefault();
      e.stopPropagation();
      const el = this._getInspectTarget(e.clientX, e.clientY);
      if (el) this._showInspectPopup(el, e.clientX, e.clientY);
    };

    document.addEventListener('mousemove', this._inspectHoverHandler, true);
    document.addEventListener('click',     this._inspectClickHandler, true);
    document.body.classList.add('ce-inspect-mode');
  },

  _buildInspectFooter() {
    const footer = document.createElement('div');
    footer.className = 'ce-inspect-footer';
    footer.innerHTML = `
      <span class="ce-inspect-mode-label">⊕ Interactive</span>
      <button class="ce-btn" id="ce-inspect-back">← Back</button>
      <button class="ce-btn ghost" id="ce-inspect-cancel">Cancel</button>
      <button class="ce-btn" id="ce-inspect-apply">Apply</button>
      <button class="ce-btn" id="ce-inspect-save-over">Save</button>
      <button class="ce-btn primary" id="ce-inspect-save">Save as Preset</button>
    `;
    footer.querySelector('#ce-inspect-back').addEventListener('click', () => {
      this._cleanupInspect();
      this._dialog.showModal();
    });
    footer.querySelector('#ce-inspect-cancel').addEventListener('click', () => {
      this._cleanupInspect();
      this._cancel();
    });
    footer.querySelector('#ce-inspect-apply').addEventListener('click', () => {
      this._cleanupInspect();
      ThemeManager.applyTheme(this._working);
      this._close();
    });
    footer.querySelector('#ce-inspect-save-over').addEventListener('click', () => {
      this._cleanupInspect();
      const activeName = localStorage.getItem('cyco-theme-active') || 'Dark Coffee';
      ThemeManager.savePreset(activeName, this._working);
      ThemeManager.applyTheme(this._working);
      this._close();
    });
    footer.querySelector('#ce-inspect-save').addEventListener('click', async () => {
      const name = await cePrompt('Preset name:', 'My Theme');
      if (name) {
        this._cleanupInspect();
        ThemeManager.savePreset(name, this._working);
        ThemeManager.applyTheme(this._working);
        this._close();
      }
    });
    return footer;
  },

  _cleanupInspect() {
    this._interactive = false;
    document.body.classList.remove('ce-inspect-mode');
    if (this._inspectHoverHandler) {
      document.removeEventListener('mousemove', this._inspectHoverHandler, true);
      document.removeEventListener('click',     this._inspectClickHandler, true);
      this._inspectHoverHandler = null;
      this._inspectClickHandler = null;
    }
    if (this._inspectFooter)    { this._inspectFooter.remove();    this._inspectFooter    = null; }
    if (this._inspectHighlight) { this._inspectHighlight.remove(); this._inspectHighlight = null; }
    if (this._inspectPopup)     { this._inspectPopup.remove();     this._inspectPopup     = null; }
  },

  _getInspectTarget(x, y) {
    for (const el of document.elementsFromPoint(x, y)) {
      if (el === document.body || el === document.documentElement) continue;
      if (el.matches('.ce-inspect-highlight, .ce-inspect-footer, .ce-inspect-popup, .ce-color-picker, .ce-theme-dialog')) continue;
      if (el.closest('.ce-inspect-footer, .ce-inspect-popup, .ce-color-picker')) continue;
      return el;
    }
    return null;
  },

  _showInspectPopup(el, x, y) {
    if (this._inspectPopup) { this._inspectPopup.remove(); this._inspectPopup = null; }
    CeColorPicker.close();
    const roles = this._getElementRoles(el);
    if (!roles.length) return;

    const popup = document.createElement('div');
    popup.className = 'ce-inspect-popup';
    popup.innerHTML = `
      <div class="ce-inspect-popup-header">
        <span class="ce-inspect-popup-title">${_describeElement(el)}</span>
        <button class="ce-inspect-popup-close" aria-label="Close">×</button>
      </div>
      <div class="ce-inspect-swatches">
        ${roles.map(({ role, label, color }) => `
          <button class="ce-inspect-swatch-row" data-role="${role}">
            <span class="ce-inspect-swatch" style="background:${color}"></span>
            <span class="ce-inspect-swatch-label">${label}</span>
          </button>
        `).join('')}
      </div>
    `;
    document.body.appendChild(popup);
    this._inspectPopup = popup;

    // Clamp position to viewport after render
    requestAnimationFrame(() => {
      const pw = popup.offsetWidth  || 180;
      const ph = popup.offsetHeight || 80;
      popup.style.left = Math.min(x + 12, window.innerWidth  - pw - 8) + 'px';
      popup.style.top  = Math.min(y + 12, window.innerHeight - ph - 8) + 'px';
    });

    // Make popup draggable via header
    const header = popup.querySelector('.ce-inspect-popup-header');
    header.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || e.target.closest('.ce-inspect-popup-close')) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = popup.getBoundingClientRect();
      const ox = e.clientX - rect.left;
      const oy = e.clientY - rect.top;
      const onDragMove = (me) => {
        popup.style.left = (me.clientX - ox) + 'px';
        popup.style.top  = (me.clientY - oy) + 'px';
      };
      const onDragUp = () => {
        document.removeEventListener('mousemove', onDragMove);
        document.removeEventListener('mouseup',   onDragUp);
      };
      document.addEventListener('mousemove', onDragMove);
      document.addEventListener('mouseup',   onDragUp);
    });

    popup.querySelector('.ce-inspect-popup-close').addEventListener('click', (e) => {
      e.stopPropagation();
      CeColorPicker.close();
      popup.remove();
      this._inspectPopup = null;
    });

    popup.querySelectorAll('.ce-inspect-swatch-row').forEach(row => {
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        const role   = row.dataset.role;
        const swatch = row.querySelector('.ce-inspect-swatch');
        CeColorPicker.open(swatch, this._working[role] || '#888888',
          (color) => {
            this._working[role]     = color;
            swatch.style.background = color;
            ThemeManager.applyTheme(this._working);
          },
          null
        );
      });
    });
  },

  _getElementRoles(el) {
    const rgbToHex = (rgb) => {
      if (!rgb || rgb === 'transparent' || rgb === 'rgba(0, 0, 0, 0)') return null;
      const m = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (!m) return null;
      const aM = rgb.match(/rgba\([\d\s,]+,\s*([\d.]+)\)/);
      if (aM && parseFloat(aM[1]) < 0.1) return null;
      return '#' + [m[1], m[2], m[3]].map(v => parseInt(v).toString(16).padStart(2, '0')).join('');
    };

    const colorDist = (h1, h2) => {
      if (!h1 || !h2 || h1.length < 7 || h2.length < 7) return 999;
      const r1=parseInt(h1.slice(1,3),16), g1=parseInt(h1.slice(3,5),16), b1=parseInt(h1.slice(5,7),16);
      const r2=parseInt(h2.slice(1,3),16), g2=parseInt(h2.slice(3,5),16), b2=parseInt(h2.slice(5,7),16);
      return Math.sqrt((r1-r2)**2 + (g1-g2)**2 + (b1-b2)**2);
    };

    const colorPairs = Object.entries(this._working)
      .filter(([, v]) => typeof v === 'string' && v.startsWith('#'));

    const findBestRole = (hex) => {
      if (!hex) return null;
      let best = null, bestDist = Infinity;
      for (const [role, val] of colorPairs) {
        const d = colorDist(hex, val);
        if (d < bestDist) { bestDist = d; best = role; }
      }
      return bestDist <= 40 ? best : null;
    };

    // Walk up DOM for first non-transparent background
    let bgHex = null, walker = el;
    while (walker && walker !== document.body) {
      bgHex = rgbToHex(getComputedStyle(walker).backgroundColor);
      if (bgHex) break;
      walker = walker.parentElement;
    }

    const style     = getComputedStyle(el);
    const textHex   = rgbToHex(style.color);
    const borderHex = style.borderTopWidth !== '0px' ? rgbToHex(style.borderTopColor) : null;

    const results = [], seen = new Set();
    for (const hex of [bgHex, textHex, borderHex]) {
      const role = findBestRole(hex);
      if (role && !seen.has(role)) {
        seen.add(role);
        results.push({ role, label: _roleLabel(role), color: this._working[role] });
      }
    }
    return results;
  },

  // ─── End inspect mode ───────────────────────────────────────────────────────

  _cancel() {
    CeColorPicker.close();
    // Revert to snapshot
    ThemeManager.applyTheme(this._snapshot);
    this._close();
  },

  _close() {
    this._cleanupInspect();
    CeColorPicker.close();
    if (this._themeChangeHandler) {
      document.removeEventListener('cyco-theme-change', this._themeChangeHandler);
      this._themeChangeHandler = null;
    }
    if (this._dialog) {
      this._dialog.close();
      this._dialog.remove();
      this._dialog = null;
    }
  },
};

function _hexToRgba(hex, alpha) {
  if (!hex || hex.length < 7) return hex;
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function _describeElement(el) {
  if (el.closest('#menu-bar'))                               return 'Menu Bar';
  if (el.closest('#toolbar'))                                return 'Toolbar';
  if (el.closest('.dv-tabs-and-actions-container'))          return 'Panel Tab Strip';
  if (el.matches('.dv-tab') || el.closest('.dv-tab'))        return 'Panel Tab';
  if (el.closest('.dv-group-view'))                          return 'Panel Area';
  if (el.matches('button, .ce-btn'))                         return 'Button';
  if (el.matches('select, .ce-select'))                      return 'Dropdown';
  if (el.matches('input[type="range"]'))                     return 'Slider';
  if (el.matches('input'))                                   return 'Input';
  if (el.id)                                                 return `#${el.id}`;
  const cls = [...el.classList].find(c => c.startsWith('ce-') || c.startsWith('dv-'));
  return cls ? cls.replace(/^(ce|dv)-/, '').replace(/-/g, ' ') : el.tagName.toLowerCase();
}

function _roleLabel(role) {
  const map = {
    textPrimary:    'Text',
    textMuted:      'Muted',
    bgBase:         'Base BG',
    bgPanel:        'Panels',
    bgSurface:      'Tab Strip',
    bgTabInactive:  'Inactive',
    bgRaised:       'Active Tab',
    accentOrange:   'Primary',
    accentGreen:    'Secondary',
    border:         'Border',
    bgMenuBar:      'Menu Bar',
    bgToolbar:      'Toolbar',
    scrollTrack:    'Track',
    scrollThumb:    'Thumb',
  };
  return map[role] || role;
}

function _advRoleLabel(role) {
  const map = {
    hoverBg:          'Hover',
    activeBg:         'Active',
    selectionBgSolid: 'Select',
    focusRing:        'Focus',
  };
  return map[role] || role;
}

export default ThemeDialog;
