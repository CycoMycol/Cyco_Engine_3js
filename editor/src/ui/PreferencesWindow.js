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
    activeColor: '#ffd54a',
    translate: {
      size: 1,
      distance: 1,
      axisColorX: '#ff4444',
      axisColorY: '#44ff44',
      axisColorZ: '#4444ff',
      activeColor: '#ffd54a',
    },
    rotate: {
      size: 0.55,
      distance: 1,
      axisColorX: '#ff9f43',
      axisColorY: '#4cd964',
      axisColorZ: '#5ac8fa',
      activeColor: '#ffd54a',
    },
    scale: {
      size: 0.75,
      distance: 1,
      axisColorX: '#ff4444',
      axisColorY: '#44ff44',
      axisColorZ: '#4444ff',
      activeColor: '#ffd54a',
    },
    box: {
      useSeparate: false,
      thickness: 1,
      distance: 1,
      outlineThickness: 1,
      outlineColor: '#e8eeff',
      axisColorX: '#ff3b30',
      axisColorY: '#34c759',
      axisColorZ: '#0a84ff',
      cornerColor: '#e8eeff',
      glowColor: '#9b6cff',
      glowIntensity: 0.35,
    },
    colliderBox: {
      useSeparate: false,
      fitScope: 'smart',
      thickness: 1,
      distance: 1,
      outlineThickness: 1,
      outlineColor: '#40f0b0',
      axisColorX: '#ff6b55',
      axisColorY: '#53d96f',
      axisColorZ: '#39a8ff',
      cornerColor: '#40f0b0',
      glowColor: '#45ffd0',
      glowIntensity: 0.45,
    },
    bounds: {
      thickness: 1,
      distance: 1,
      outlineColor: '#e8eeff',
      secondaryOutlineColor: '#45ffd0',
      glowIntensity: 0.35,
      glowColor: '#9b6cff',
    },
    colliderBounds: {
      thickness: 1,
      distance: 1,
      outlineColor: '#40f0b0',
      glowIntensity: 0.45,
      glowColor: '#45ffd0',
    },
    temporaryBounds: {
      thickness: 4,
      distance: 1,
      outlineColor: '#40f0b0',
      glowIntensity: 0.45,
      glowColor: '#45ffd0',
    },
  },
  renderer: {
    defaultType: 'webgpu',
    shadowMapType: 'PCFSoftShadowMap',
    pixelRatio: '1',
  },
  viewport: {
    backgroundColor: '#1a1a1a',
  },
  mouse: {
    // What each mouse button does in the viewport when clicking on empty space.
    //  - 'select'  : click an object to select it; click empty space for marquee
    //  - 'orbit'   : drag the camera around the current focus
    //  - 'pan'     : drag to slide the camera target
    //  - 'dolly'   : drag to zoom the camera in/out
    //  - 'none'    : button is ignored
    leftButton:   'select',
    middleButton: 'pan',
    rightButton:  'orbit',
    wheel:        'dolly',   // 'dolly' | 'zoom' | 'none'
    invertZoom:   false,
    wheelSpeed:   1,
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

