/**
 * main.js — app entry point.
 * Bootstraps the editor: dockview layout (includes menu bar + toolbar panels), theme.
 */

import ThemeManager      from './theme/theme-manager.js';
import LayoutManager     from './layout-manager.js';
import { initLayout }    from './layout.js';
import ProjectManager    from './project/ProjectManager.js';
import GameManager       from './ui/GameManager.js';

const app = document.getElementById('app');

// ── 1. Dock container ──────────────────────────────────────────────────────────
const dockContainer = document.createElement('div');
dockContainer.id = 'dock-container';
app.appendChild(dockContainer);

// ── 2. Initialize dockview layout ──────────────────────────────────────────────
const dockApi = initLayout(dockContainer);

// ── 3. Initialize layout manager (captures default layout + wires events) ──────
LayoutManager.init(dockApi);

// ── 3a. Restore the user's last layout from localStorage (if any) ─────────────
LayoutManager.restoreAutoSaved();

// ── 3b. Force bar panel heights after layout settles ─────────────────────────
// Panel init() sets constraints synchronously so ResizeObserver respects them.
// Double-RAF runs after ResizeObserver, applying setSize as a final correction.
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
requestAnimationFrame(() => requestAnimationFrame(applyBarHeights));

// ── 4. Restore saved theme (or apply default Dark Coffee preset) ───────────────
ThemeManager.init();
// ── 5. Migrate any legacy project data (no project is auto-opened) ───────────—
ProjectManager.init();

// ── 6. Wire toolbar action events ─────────────────────────────────────────────
document.addEventListener('cyco-action', (e) => {
  if (e.detail === 'game-manager') GameManager.open();
});