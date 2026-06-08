/**
 * main.js — app entry point.
 * Bootstraps the editor: dockview layout (includes menu bar + toolbar panels), theme.
 * Then initialises the Three.js viewport system in the correct dependency order.
 */

// ── Three.js global flags — MUST be set before any other THREE usage ──────────
import * as THREE from 'three';
THREE.ColorManagement.enabled = true; // ensure correct sRGB handling
THREE.Cache.enabled           = true; // asset deduplication across loaders

// initialize in-page internal log collector used by debug helpers
if (typeof window !== 'undefined') {
  try {
    window.__cyco_internal_log = window.__cyco_internal_log || [];
    window.__cyco_log = (tag, payload) => {
      try { window.__cyco_internal_log.push({ tag, payload, ts: Date.now() }); } catch (e) {}
      try { console.log(tag, payload); } catch (e) {}
    };
  } catch (err) {}
}

import ThemeManager      from './theme/theme-manager.js';
import LayoutManager     from './layout-manager.js';
import { initLayout, DEFAULT_LAYOUT }    from './layout.js';
import ProjectManager    from './project/ProjectManager.js';
import GameManager       from './ui/GameManager.js';
import { PhysicsWorldWindow }  from './ui/PhysicsWorldWindow.js';
import { InputManagerWindow }  from './ui/InputManagerWindow.js';

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
import { PhysicsEditHelper }      from './viewport/PhysicsEditHelper.js';
import { InputManager }           from './viewport/InputManager.js';
import { ViewportStats }          from './viewport/ViewportStats.js';
import { ViewportContextMenu }    from './viewport/ViewportContextMenu.js';
import './ui/PreferencesWindow.js'; // registers cyco-open-preferences listener
import { loadPrefs }                from './ui/PreferencesWindow.js';

const prefs = loadPrefs();
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
  if (e.detail === 'game-manager')  GameManager.open();
  if (e.detail === 'input-manager') InputManagerWindow.open();
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
const viewportStats         = new ViewportStats(viewportEngine);
const viewportContextMenu   = new ViewportContextMenu();
const commandManager        = new CommandManager();
const renderModeManager     = new RenderModeManager(viewportEngine);
const inputManager          = new InputManager(commandManager, selectionManager, viewportEngine);

// Post-processing + runtime
const postPipeline          = new PostProcessingPipeline(viewportEngine); // eslint-disable-line no-unused-vars
const gameRuntime           = new GameRuntime(viewportEngine, sceneManager, selectionManager, transformGizmo); // eslint-disable-line no-unused-vars
const physicsEditHelper     = new PhysicsEditHelper(viewportEngine); // eslint-disable-line no-unused-vars

// ViewportEngine.init() is called automatically via 'cyco-viewport-container-ready'
// event dispatched by CenterPanel when its canvas div is inserted into the DOM.
// No manual init() call needed here.
// Fallback: if the event was missed (e.g. fired before handler was registered),
// or init ran on a tiny pre-layout container, retry after dockview settles.
setTimeout(() => {
  const vp = window.__cyco?.viewportEngine;
  if (!vp) return;
  const container = document.getElementById('cyco-viewport-canvas');
  if (!container || !container.isConnected) return;

  // Case A: init never ran
  if (!vp.rendererManager?.renderer && !vp._initPending) {
    console.info('[main] Viewport fallback init — event was missed on cold load');
    vp._onContainerReady({ detail: { container } });
    return;
  }

  // Case B: init ran but canvas is orphaned or container size is larger than
  // what the renderer was created with (dockview layout restored after init).
  const canvas = vp.rendererManager?.renderer?.domElement;
  const canvasInDom = canvas && container.contains(canvas);
  const rect = container.getBoundingClientRect();
  const containerW = Math.floor(rect.width);
  const containerH = Math.floor(rect.height);

  if (!canvasInDom && containerW > 4 && containerH > 4) {
    console.info('[main] Viewport fallback — canvas orphaned, re-attaching to settled container');
    vp._onContainerReady({ detail: { container } });
  }

  // Case C: renderer exists but canvas is not properly attached or has zero dimensions
  // This handles refresh scenarios where the canvas is created but not properly reattached
  if (vp.rendererManager?.renderer && (!canvas || !canvas.isConnected || containerW <= 1 || containerH <= 1)) {
    console.info('[main] Viewport fallback — renderer exists but canvas is invalid, reinitializing');
    vp._onContainerReady({ detail: { container } });
  }
  
  // Case D: renderer exists but there's no canvas attached (common on refresh)
  // This specifically handles the case where WebGPU fails to initialize properly
  if (vp.rendererManager?.renderer && !vp.rendererManager.renderer.domElement) {
    console.info('[main] Viewport fallback — renderer exists but no domElement, reinitializing');
    vp._onContainerReady({ detail: { container } });
    return;
  }
  
  // Case E: renderer exists but canvas is not properly attached to container
  // This handles refresh scenarios where canvas is created but not attached
  if (vp.rendererManager?.renderer?.domElement && 
      vp.rendererManager.renderer.domElement && 
      !container.contains(vp.rendererManager.renderer.domElement)) {
    console.info('[main] Viewport fallback — renderer exists but canvas not attached, reattaching');
    vp._onContainerReady({ detail: { container } });
    return;
  }
}, 800);

// Export modules to window for debugging
if (typeof window !== 'undefined') {
  window.__cyco = {
    rendererManager,
    viewportEngine,
    sceneManager,
    objectFactory,
    selectionManager,
    transformGizmo,
    prefs,
    commandManager,
    viewportContextMenu,
    dockviewApi: dockApi,
    get cloudSystem()     { return viewportEngine.cloudSystem; },
    get cloudSystem2()    { return viewportEngine.cloudSystem2; },
    get gradientSky()     { return viewportEngine.gradientSky; },
    get contactShadows()  { return viewportEngine.contactShadows; },
    get postPipeline()    { return postPipeline; },
    get physicsManager()  { return gameRuntime.physicsManager; },
    get physicsEditHelper() { return physicsEditHelper; },
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
_startAutoSave(prefs.general.autoSaveInterval);

// Restart if preferences change
window.addEventListener('cyco-preferences-change', ({ detail: { prefs } }) => {
  _startAutoSave(prefs.general.autoSaveInterval);
});
