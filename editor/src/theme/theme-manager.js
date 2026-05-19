/** ThemeManager — owns all theme state, writes CSS vars live to :root */

const STORAGE_KEY_PRESETS = 'cyco-theme-presets';
const STORAGE_KEY_ACTIVE  = 'cyco-theme-active';

// ─── Built-in presets ────────────────────────────────────────────────────────
const BUILTIN_PRESETS = {
  'Dark Coffee': {
    bgBase:         '#1c1917',
    bgPanel:        '#252118',
    bgSurface:      '#332a22',
    bgRaised:       '#3e3228',
    bgTabInactive:  '#332a22',
    bgMenuBar:      '#332a22',
    bgToolbar:      '#252118',
    textPrimary:    '#ede8e0',
    textMuted:      '#9e8f82',
    accentOrange:   '#e07228',
    accentGreen:    '#6ab26a',
    border:         '#3d3028',
    scrollTrack:    '#252118',
    scrollThumb:    '#4a3c30',
    fontFamily:     'Inter',
    fontSize:       'M',
  },
  'Light Cream': {
    bgBase:         '#f5f0e8',
    bgPanel:        '#ece6d8',
    bgSurface:      '#ddd5c4',
    bgRaised:       '#cfc6b4',
    bgTabInactive:  '#ddd5c4',
    bgMenuBar:      '#ddd5c4',
    bgToolbar:      '#ece6d8',
    textPrimary:    '#2c2418',
    textMuted:      '#7a6e5e',
    accentOrange:   '#c95f10',
    accentGreen:    '#3d8c3d',
    border:         '#c8bfb0',
    scrollTrack:    '#ece6d8',
    scrollThumb:    '#a8a090',
    fontFamily:     'Inter',
    fontSize:       'M',
  },
  'Midnight Blue': {
    bgBase:         '#0d1117',
    bgPanel:        '#131a24',
    bgSurface:      '#1c2838',
    bgRaised:       '#243348',
    bgTabInactive:  '#1c2838',
    bgMenuBar:      '#1c2838',
    bgToolbar:      '#131a24',
    textPrimary:    '#cdd9e5',
    textMuted:      '#768390',
    accentOrange:   '#4d93e8',
    accentGreen:    '#57ab5a',
    border:         '#2d3f54',
    scrollTrack:    '#131a24',
    scrollThumb:    '#3d5870',
    fontFamily:     'Inter',
    fontSize:       'M',
  },
  'Forest Green': {
    bgBase:         '#0e1510',
    bgPanel:        '#131d16',
    bgSurface:      '#1e2e22',
    bgRaised:       '#273c2c',
    bgTabInactive:  '#1e2e22',
    bgMenuBar:      '#1e2e22',
    bgToolbar:      '#131d16',
    textPrimary:    '#d4e0d4',
    textMuted:      '#7a9e7a',
    accentOrange:   '#8fbc4e',
    accentGreen:    '#4a9e6a',
    border:         '#2a3d2e',
    scrollTrack:    '#131d16',
    scrollThumb:    '#3a5540',
    fontFamily:     'Inter',
    fontSize:       'M',
  },
};

// ─── HSL utilities ────────────────────────────────────────────────────────────
function hexToHsl(hex) {
  let r = parseInt(hex.slice(1,3),16)/255;
  let g = parseInt(hex.slice(3,5),16)/255;
  let b = parseInt(hex.slice(5,7),16)/255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b);
  let h, s, l = (max+min)/2;
  if (max === min) { h = s = 0; }
  else {
    const d = max - min;
    s = l > 0.5 ? d/(2-max-min) : d/(max+min);
    switch(max) {
      case r: h = ((g-b)/d + (g<b?6:0))/6; break;
      case g: h = ((b-r)/d + 2)/6; break;
      case b: h = ((r-g)/d + 4)/6; break;
    }
  }
  return [h*360, s*100, l*100];
}

function hslToHex(h, s, l) {
  h = ((h%360)+360)%360; s /= 100; l /= 100;
  const a = s * Math.min(l, 1-l);
  const f = n => {
    const k = (n + h/30) % 12;
    const c = l - a * Math.max(-1, Math.min(k-3, 9-k, 1));
    return Math.round(255*c).toString(16).padStart(2,'0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function lighten(hex, amount) {
  const [h,s,l] = hexToHsl(hex);
  return hslToHex(h, s, Math.min(100, l+amount));
}
function darken(hex, amount) {
  const [h,s,l] = hexToHsl(hex);
  return hslToHex(h, s, Math.max(0, l-amount));
}
function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * Returns '#ffffff' or a near-black contrasting text color for use on top of
 * a given hex background, using WCAG relative luminance.
 */
function contrastText(hex) {
  const r = parseInt(hex.slice(1,3),16)/255;
  const g = parseInt(hex.slice(3,5),16)/255;
  const b = parseInt(hex.slice(5,7),16)/255;
  const lin = c => c <= 0.04045 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4);
  const L = 0.2126*lin(r) + 0.7152*lin(g) + 0.0722*lin(b);
  // L=0 is black, L=1 is white; threshold ~0.35 gives good readability
  return L < 0.35 ? '#ffffff' : '#1a1008';
}

// ─── ThemeManager singleton ───────────────────────────────────────────────────
const ThemeManager = {
  _current: null,

  /** Load saved active preset or fall back to Dark Coffee */
  init() {
    const saved = localStorage.getItem(STORAGE_KEY_ACTIVE);
    const name  = saved || 'Dark Coffee';
    this.applyPreset(name);
  },

  /** Apply a named preset (builtin or user-saved) */
  applyPreset(name) {
    const userPresets = this._loadUserPresets();
    const preset = BUILTIN_PRESETS[name] || userPresets[name];
    if (!preset) { this.applyPreset('Dark Coffee'); return; }
    this.applyTheme(preset);
    localStorage.setItem(STORAGE_KEY_ACTIVE, name);
  },

  /** Apply a palette object directly, writing all CSS vars to :root */
  applyTheme(palette) {
    this._current = { ...palette };
    const root = document.documentElement;
    root.style.setProperty('--ce-bg-base',       palette.bgBase);
    root.style.setProperty('--ce-bg-panel',      palette.bgPanel);
    root.style.setProperty('--ce-bg-surface',    palette.bgSurface);
    root.style.setProperty('--ce-bg-raised',     palette.bgRaised);
    root.style.setProperty('--ce-bg-tab-inactive', palette.bgTabInactive || palette.bgSurface);
    root.style.setProperty('--ce-bg-menubar',    palette.bgMenuBar    || palette.bgSurface);
    root.style.setProperty('--ce-bg-toolbar',    palette.bgToolbar    || palette.bgPanel);
    root.style.setProperty('--ce-scrollbar-track', palette.scrollTrack || palette.bgPanel);
    root.style.setProperty('--ce-scrollbar-thumb', palette.scrollThumb || palette.border);
    root.style.setProperty('--ce-text-primary',  palette.textPrimary);
    root.style.setProperty('--ce-text-muted',    palette.textMuted);
    root.style.setProperty('--ce-accent-orange', palette.accentOrange);
    root.style.setProperty('--ce-accent-green',  palette.accentGreen);
    root.style.setProperty('--ce-accent-text',         contrastText(palette.accentOrange));
    root.style.setProperty('--ce-accent-green-text',   contrastText(palette.accentGreen));
    root.style.setProperty('--ce-border',        palette.border);
    root.style.setProperty('--ce-sash-hover',    palette.accentOrange);

    // Dockview native CSS vars — drive dockview's own internal tab CSS
    const tabInactive = palette.bgTabInactive || palette.bgSurface;
    const tabActive   = palette.bgRaised;
    root.style.setProperty('--dv-tabs-and-actions-container-background-color',    palette.bgSurface);
    root.style.setProperty('--dv-activegroup-visiblepanel-tab-background-color',  tabActive);
    root.style.setProperty('--dv-activegroup-hiddenpanel-tab-background-color',   tabInactive);
    root.style.setProperty('--dv-activegroup-visiblepanel-tab-color',             palette.textPrimary);
    root.style.setProperty('--dv-activegroup-hiddenpanel-tab-color',              palette.textMuted);
    root.style.setProperty('--dv-inactivegroup-visiblepanel-tab-background-color',tabActive);
    root.style.setProperty('--dv-inactivegroup-hiddenpanel-tab-background-color', tabInactive);
    root.style.setProperty('--dv-inactivegroup-visiblepanel-tab-color',           palette.textMuted);
    root.style.setProperty('--dv-inactivegroup-hiddenpanel-tab-color',            palette.textMuted);
    root.style.setProperty('--dv-group-view-background-color',                   palette.bgPanel);
    root.style.setProperty('--dv-tab-divider-color',                             palette.border);

    // Derived interaction states
    // hover: clearly lighter than accent so it reads as a subtle highlight
    // active: clearly darker so accent-colored text on it is readable
    const hover    = palette.hoverBg      || lighten(palette.accentOrange, 22);
    const active   = palette.activeBg     || darken(palette.accentOrange, 30);
    const selection= palette.selectionBg  || hexToRgba(palette.accentOrange, 0.25);
    const focus    = palette.focusRing    || palette.accentOrange;
    root.style.setProperty('--ce-hover-bg',      hover);
    root.style.setProperty('--ce-active-bg',     active);
    root.style.setProperty('--ce-selection-bg',  selection);
    root.style.setProperty('--ce-focus-ring',    focus);

    // Font
    const fontMap = {
      'Inter':          "'Inter', system-ui, sans-serif",
      'JetBrains Mono': "'JetBrains Mono', monospace",
      'Space Grotesk':  "'Space Grotesk', system-ui, sans-serif",
    };
    root.style.setProperty('--ce-font-family', fontMap[palette.fontFamily] || fontMap['Inter']);
    const sizeMap = { S: '12px', M: '13px', L: '15px' };
    root.style.setProperty('--ce-font-size-base', sizeMap[palette.fontSize] || '13px');

    document.dispatchEvent(new CustomEvent('cyco-theme-change', { detail: { ...palette } }));
  },

  /** Get current palette (copy) */
  getCurrent() {
    return this._current ? { ...this._current } : { ...BUILTIN_PRESETS['Dark Coffee'] };
  },

  /** Save a named user preset */
  savePreset(name, palette) {
    const presets = this._loadUserPresets();
    presets[name] = { ...palette };
    localStorage.setItem(STORAGE_KEY_PRESETS, JSON.stringify(presets));
    localStorage.setItem(STORAGE_KEY_ACTIVE, name);
  },

  /** List all preset names: builtins first, then user-saved */
  listPresets() {
    const userNames = Object.keys(this._loadUserPresets());
    return [...Object.keys(BUILTIN_PRESETS), ...userNames];
  },

  listUserPresets() {
    return Object.keys(this._loadUserPresets());
  },

  /** Delete a user preset (no-op for builtins) */
  deletePreset(name) {
    if (name in BUILTIN_PRESETS) return;
    const presets = this._loadUserPresets();
    delete presets[name];
    localStorage.setItem(STORAGE_KEY_PRESETS, JSON.stringify(presets));
    document.dispatchEvent(new CustomEvent('cyco-presets-change'));
  },

  isBuiltin(name) {
    return name in BUILTIN_PRESETS;
  },

  getPresetData(name) {
    const user = this._loadUserPresets();
    return BUILTIN_PRESETS[name] || user[name] || null;
  },

  getDerivedStates(palette) {
    return {
      hoverBg:     lighten(palette.accentOrange, 22),
      activeBg:    darken(palette.accentOrange, 30),
      selectionBg: hexToRgba(palette.accentOrange, 0.25),
      focusRing:   palette.accentOrange,
    };
  },

  /** Randomize — returns a new harmonious palette object */
  randomizePalette() {
    const baseHue = Math.random() * 360;
    return {
      bgBase:       hslToHex(baseHue, 15, 10),
      bgPanel:      hslToHex(baseHue, 14, 13),
      bgSurface:    hslToHex(baseHue, 13, 18),
      bgRaised:     hslToHex(baseHue, 12, 22),
      bgTabInactive:hslToHex(baseHue, 13, 18),
      bgMenuBar:    hslToHex(baseHue, 13, 18),
      bgToolbar:    hslToHex(baseHue, 14, 13),
      textPrimary:  hslToHex(baseHue, 20, 90),
      textMuted:   hslToHex(baseHue, 10, 58),
      accentOrange:hslToHex(baseHue, 75, 52),
      accentGreen: hslToHex((baseHue+120)%360, 55, 52),
      border:       hslToHex(baseHue, 14, 22),
      scrollTrack:  hslToHex(baseHue, 14, 13),
      scrollThumb:  hslToHex(baseHue, 13, 28),
      fontFamily:  this._current?.fontFamily || 'Inter',
      fontSize:    this._current?.fontSize   || 'M',
    };
  },

  _loadUserPresets() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY_PRESETS) || '{}'); }
    catch { return {}; }
  },
};

export default ThemeManager;
export { BUILTIN_PRESETS };
