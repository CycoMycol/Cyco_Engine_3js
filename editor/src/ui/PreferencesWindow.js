/**
 * PreferencesWindow.js â€” Preferences data + opener.
 * Opened by: Edit â†’ Preferences, or cyco-open-preferences event.
 * The UI is in PreferencesPanel.js (a dockable BasePanel subclass).
 *
 * Persists to: localStorage['cyco-prefs']
 * Dispatches:  cyco-preferences-change { prefs }
 */

import { BasePanel } from '../panels/BasePanel.js';

const PREFS_KEY = 'cyco-prefs';
const PREFS_DEFAULT_KEY = 'cyco-prefs-defaults';

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
    distance: 1,
    useSeparateGizmoSizes: false,
    translateSize: 1,
    rotateSize: 0.55,
    scaleSize: 0.75,
    translateDistance: 1,
    rotateDistance: 1,
    scaleDistance: 1,
    axisColorX: '#ff4444',
    axisColorY: '#44ff44',
    axisColorZ: '#4444ff',
  },
  renderer: {
    defaultType: 'webgpu',
    shadowMapType: 'PCFSoftShadowMap',
    pixelRatio: '1',
  },
  viewport: {
    backgroundColor: '#1a1a1a',
  },
  general: {
    autoSaveInterval: 'off',
    showWelcomeScreen: true,
  },
};

// â”€â”€ Prefs data access â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function loadDefaultPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_DEFAULT_KEY);
    const base = JSON.parse(JSON.stringify(DEFAULT_PREFS));
    if (!raw) return base;
    return deepMerge(base, JSON.parse(raw));
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT_PREFS));
  }
}

export function loadPrefs() {
  try {
    const defaultPrefs = loadDefaultPrefs();
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return defaultPrefs;
    return deepMerge(defaultPrefs, JSON.parse(raw));
  } catch {
    return loadDefaultPrefs();
  }
}

export function savePrefs(prefs) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  window.dispatchEvent(new CustomEvent('cyco-preferences-change', { detail: { prefs } }));
}

export function saveDefaultPrefs(prefs) {
  localStorage.setItem(PREFS_DEFAULT_KEY, JSON.stringify(prefs));
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
    const floating = BasePanel.getSavedFloatingState('preferences-panel', {
      x:      Math.round((window.innerWidth  - 450) / 2),
      y:      Math.round(window.innerHeight * 0.15),
      width:  450,
      height: 450,
    });
    dvApi.addPanel({
      id:        'preferences-panel',
      component: 'PreferencesPanel',
      title:     'Preferences',
      floating,
    });
  },
};

export default PreferencesWindow;

// ── Auto-open on event ────────────────────────────────────────────────────────
window.addEventListener('cyco-open-preferences', () => PreferencesWindow.open());

