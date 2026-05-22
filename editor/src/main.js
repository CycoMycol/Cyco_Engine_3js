/**
 * main.js — app entry point.
 * Bootstraps the editor: dockview layout (includes menu bar + toolbar panels), theme.
 * Then initialises the Three.js viewport system in the correct dependency order.
 */

// ── Three.js global flags — MUST be set before any other THREE usage ──────────
import * as THREE from 'three';
THREE.ColorManagement.enabled = true; // ensure correct sRGB handling
THREE.Cache.enabled           = true; // asset deduplication across loaders

import ThemeManager      from './theme/theme-manager.js';
import LayoutManager     from './layout-manager.js';
import { initLayout, DEFAULT_LAYOUT }    from './layout.js';
import ProjectManager    from './project/ProjectManager.js';
import GameManager       from './ui/GameManager.js';

// ── Viewport modules ───────────────────────────────────────────────────────────
import { RendererManager }        from './viewport/RendererManager.js';
import { ViewportEngine }         from './viewport/ViewportEngine.js';
import { SceneManager }           from './viewport/SceneManager.js';
import { ObjectFactory }          from './viewport/ObjectFactory.js';
import { SelectionManager }       from './viewport/SelectionManager.js';
import { TransformGizmo }         from './viewport/TransformGizmo.js';
import { RenderModeManager }      from './viewport/RenderModeManager.js';
import { PostProcessingPipeline } from './viewport/PostProcessingPipeline.js';
import { CommandManager }         from './viewport/CommandManager.js';
import { GameRuntime }            from './viewport/GameRuntime.js';
import { InputManager }           from './viewport/InputManager.js';
import { ViewportStats }          from './viewport/ViewportStats.js';
import { ViewportContextMenu }    from './viewport/ViewportContextMenu.js';
import './ui/PreferencesWindow.js'; // registers cyco-open-preferences listener
import { loadPrefs }                from './ui/PreferencesWindow.js';

const app = document.getElementById('app');

// ── 1. Dock container ──────────────────────────────────────────────────────────
const dockContainer = document.createElement('div');
dockContainer.id = 'dock-container';
app.appendChild(dockContainer);

// ── 2. Initialize dockview layout ──────────────────────────────────────────────
const dockApi = initLayout(dockContainer);

// ── 3. Initialize layout manager (captures default layout + wires events) ──────
LayoutManager.init(dockApi, DEFAULT_LAYOUT);

// ── 3a. Restore the user's last layout from localStorage (if any) ─────────────
// Deferred to the first animation frame so the CSS layout pass completes and
// the dockview container has its correct offsetWidth (772 px) before fromJSON
// is called.  Without this delay, fromJSON would see the pre-layout width
// (~336 px) and scale all panel sizes down to ~43% of their saved values.
requestAnimationFrame(() => {
  LayoutManager.restoreAutoSaved();

  // ── 3b. Force bar panel heights after layout settles ───────────────────────
  // Run in the NEXT frame so ResizeObserver has reacted to the restored layout.
  const applyBarHeights = () => {
    for (const [id, h] of [['menu-bar-panel', 30], ['toolbar-panel', 32]]) {
      const panel = dockApi.getPanel(id);
      const groupApi = panel?.api?.group?.api;
      if (groupApi && panel?.api?.group?.api?.location?.type !== 'floating') {
        groupApi.setConstraints({ minimumHeight: h, maximumHeight: h });
        groupApi.setSize({ height: h });
      }
    }
  };
  requestAnimationFrame(applyBarHeights);
});

// ── 4. Restore saved theme (or apply default Dark Coffee preset) ───────────────
ThemeManager.init();

// ── 5. Migrate any legacy project data (no project is auto-opened) ───────────—
ProjectManager.init();

// ── 6. Wire toolbar action events ─────────────────────────────────────────────
document.addEventListener('cyco-action', (e) => {
  if (e.detail === 'game-manager') GameManager.open();
});

// ── 7. Viewport system bootstrap (Section 6 — VIEWPORT_PLAN.md) ───────────────
// Instantiation order matters — each module registers its own event listeners
// in its constructor, before the viewport is live, so no events are missed.

// Shared LoadingManager — passed to all loaders
const loadingManager = new THREE.LoadingManager();
loadingManager.onStart = (url, loaded, total) => {
  window.dispatchEvent(new CustomEvent('cyco-loading-start', {
    detail: { url, loaded, total }
  }));
};
loadingManager.onProgress = (url, loaded, total) => {
  window.dispatchEvent(new CustomEvent('cyco-loading-progress', {
    detail: { url, loaded, total, pct: Math.round((loaded / total) * 100) }
  }));
};
loadingManager.onLoad = () => {
  window.dispatchEvent(new CustomEvent('cyco-loading-done'));
};
loadingManager.onError = (url) => {
  window.dispatchEvent(new CustomEvent('cyco-loading-error', { detail: { url } }));
};

// Core renderer + viewport
const rendererManager       = new RendererManager();
const viewportEngine        = new ViewportEngine(rendererManager, loadingManager);

// Scene + objects
const sceneManager          = new SceneManager();
const objectFactory         = new ObjectFactory(sceneManager, loadingManager);

// Selection + interaction
const selectionManager      = new SelectionManager(viewportEngine);
const transformGizmo        = new TransformGizmo(viewportEngine, selectionManager);

// Rendering modes + post-processing
const renderModeManager     = new RenderModeManager(viewportEngine);   // eslint-disable-line no-unused-vars
const postPipeline          = new PostProcessingPipeline(viewportEngine); // eslint-disable-line no-unused-vars

// Undo/redo + play mode
const commandManager        = new CommandManager();
const gameRuntime           = new GameRuntime(viewportEngine, sceneManager, selectionManager, transformGizmo); // eslint-disable-line no-unused-vars

// Input + stats
const inputManager          = new InputManager(commandManager, selectionManager, viewportEngine); // eslint-disable-line no-unused-vars
const viewportStats         = new ViewportStats(viewportEngine); // eslint-disable-line no-unused-vars
const viewportContextMenu   = new ViewportContextMenu(); // eslint-disable-line no-unused-vars

// ViewportEngine.init() is called automatically via 'cyco-viewport-container-ready'
// event dispatched by CenterPanel when its canvas div is inserted into the DOM.
// No manual init() call needed here.

// Export modules to window for debugging
if (typeof window !== 'undefined') {
  window.__cyco = {
    rendererManager,
    viewportEngine,
    sceneManager,
    objectFactory,
    selectionManager,
    transformGizmo,
    commandManager,
    viewportContextMenu,
    dockviewApi: dockApi,
    // cloudSystem is set on viewportEngine.cloudSystem after init()
    get cloudSystem() { return viewportEngine.cloudSystem; },
    get postPipeline() { return postPipeline; },
  };
}

// ── 8. Auto-save ───────────────────────────────────────────────────────────────
let _autoSaveTimer = null;

function _startAutoSave(intervalMinutes) {
  if (_autoSaveTimer) { clearInterval(_autoSaveTimer); _autoSaveTimer = null; }
  if (!intervalMinutes || intervalMinutes === 'off') return;
  const ms = parseInt(intervalMinutes, 10) * 60_000;
  _autoSaveTimer = setInterval(() => {
    const json = sceneManager.serializeActiveScene?.();
    if (json) {
      localStorage.setItem('cyco-autosave', JSON.stringify(json));
      console.info('[AutoSave] Scene saved to localStorage');
    }
  }, ms);
}

// Start with saved prefs
_startAutoSave(loadPrefs().general.autoSaveInterval);

// Restart if preferences change
window.addEventListener('cyco-preferences-change', ({ detail: { prefs } }) => {
  _startAutoSave(prefs.general.autoSaveInterval);
});
