/**
 * PreferencesWindow.js â€” Preferences data + opener.
 * Opened by: Edit â†’ Preferences, or cyco-open-preferences event.
 * The UI is in PreferencesPanel.js (a dockable BasePanel subclass).
 *
 * Persists to: localStorage['cyco-prefs']
 * Dispatches:  cyco-preferences-change { prefs }
 */

const PREFS_KEY = 'cyco-prefs';

// Default keybindings
export const DEFAULT_KEYS = {
  'Delete Selected':  'Delete',
  'Undo':             'Ctrl+Z',
  'Redo':             'Ctrl+Y',
  'Focus Selected':   'F',
  'Deselect':         'Escape',
  'Duplicate':        'Ctrl+D',
  'Translate Mode':   'W',
  'Rotate Mode':      'E',
  'Scale Mode':       'R',
  'Toggle Grid':      'G',
  'Toggle Stats':     '`',
};

// Default general prefs
export const DEFAULT_PREFS = {
  keybindings: { ...DEFAULT_KEYS },
  gizmo: {
    size: 1,
    axisColorX: '#ff4444',
    axisColorY: '#44ff44',
    axisColorZ: '#4444ff',
  },
  renderer: {
    defaultType: 'webgl',
    shadowMapType: 'PCFSoftShadowMap',
    pixelRatio: '1',
  },
  general: {
    autoSaveInterval: 'off',
    showWelcomeScreen: true,
  },
};

// â”€â”€ Prefs data access â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return JSON.parse(JSON.stringify(DEFAULT_PREFS));
    return deepMerge(JSON.parse(JSON.stringify(DEFAULT_PREFS)), JSON.parse(raw));
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT_PREFS));
  }
}

export function savePrefs(prefs) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  window.dispatchEvent(new CustomEvent('cyco-preferences-change', { detail: { prefs } }));
}

function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (typeof source[key] === 'object' && source[key] !== null && !Array.isArray(source[key])) {
      target[key] = deepMerge(target[key] ?? {}, source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

// â”€â”€ PreferencesWindow opener â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// The actual UI is now in PreferencesPanel.js (a dockable BasePanel subclass).

const PreferencesWindow = {
  open() {
    const dvApi = window.__cyco?.dockviewApi;
    if (!dvApi) return;
    const existing = dvApi.getPanel('preferences-panel');
    if (existing) {
      // Already open â€” bring to front
      try { existing.api.group.api.setActive?.(); } catch (_) {}
      return;
    }
    dvApi.addPanel({
      id:        'preferences-panel',
      component: 'PreferencesPanel',
      title:     'Preferences',
      floating: {
        x:      Math.round((window.innerWidth  - 680) / 2),
        y:      Math.round(window.innerHeight * 0.15),
        width:  680,
        height: 490,
      },
    });
  },
};

export default PreferencesWindow;

// ── Auto-open on event ────────────────────────────────────────────────────────
window.addEventListener('cyco-open-preferences', () => PreferencesWindow.open());

