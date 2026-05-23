/**
 * layout.js — initializes the dockview layout.
 * Returns the DockviewApi so main.js can pass it to LayoutManager.
 */

import { cycoTheme }      from './theme/cyco-theme.js';
import { LeftPanel }      from './panels/LeftPanel.js';
import { CenterPanel }    from './panels/CenterPanel.js';
import { RightPanel }     from './panels/RightPanel.js';
import { BottomPanel }           from './panels/BottomPanel.js';
import { MaterialBrowserPanel } from './panels/MaterialBrowserPanel.js';
import { MenuBarPanel }         from './panels/MenuBarPanel.js';
import { ToolbarPanel }   from './panels/ToolbarPanel.js';
import { LeftToolbarPanel }    from './panels/LeftToolbarPanel.js';
import { RightViewportPanel } from './panels/RightViewportPanel.js';
import { CameraViewPanel }    from './panels/CameraViewPanel.js';
import { StatsPanel }         from './panels/StatsPanel.js';
import { PreferencesPanel }   from './panels/PreferencesPanel.js';

// ── Default layout snapshot ────────────────────────────────────────────────────
// Captured from the user's preferred arrangement:
//   Menu Bar (top, 30px) → Scene Hierarchy (left, 142px) | Viewport (270px) /
//   Assets Browser (189px) | Properties (right, 152px) → Toolbar (bottom, 32px)
export const DEFAULT_LAYOUT = {"grid":{"root":{"type":"branch","data":[{"type":"branch","data":[{"type":"leaf","data":{"views":["menu-bar-panel"],"activeView":"menu-bar-panel","id":"grp-menu-bar-panel"},"size":30},{"type":"branch","data":[{"type":"leaf","data":{"views":["scene-hierarchy"],"activeView":"scene-hierarchy","id":"4"},"size":142},{"type":"leaf","data":{"views":["left-toolbar"],"activeView":"left-toolbar","id":"grp-left-toolbar"},"size":36},{"type":"branch","data":[{"type":"leaf","data":{"views":["center-viewport"],"activeView":"center-viewport","id":"1"},"size":270},{"type":"leaf","data":{"views":["assets-browser","material-browser"],"activeView":"assets-browser","id":"6"},"size":188.59375}],"size":485},{"type":"leaf","data":{"views":["right-viewport"],"activeView":"right-viewport","id":"grp-right-viewport"},"size":36},{"type":"leaf","data":{"views":["properties"],"activeView":"properties","id":"5"},"size":151.78125}],"size":458.59375},{"type":"leaf","data":{"views":["toolbar-panel"],"activeView":"toolbar-panel","id":"3"},"size":32}],"size":850.78125}],"size":520.59375},"width":850.78125,"height":520.59375,"orientation":"HORIZONTAL"},"panels":{"menu-bar-panel":{"id":"menu-bar-panel","contentComponent":"MenuBarPanel","title":"Menu Bar","minimumHeight":30,"maximumHeight":30},"scene-hierarchy":{"id":"scene-hierarchy","contentComponent":"LeftPanel","title":"Hierarchy"},"center-viewport":{"id":"center-viewport","contentComponent":"CenterPanel","title":"Viewport"},"right-viewport":{"id":"right-viewport","contentComponent":"RightViewportPanel","title":"Right VP Menu Bar","minimumWidth":36,"maximumWidth":36},"assets-browser":{"id":"assets-browser","contentComponent":"BottomPanel","title":"Assets Browser"},"material-browser":{"id":"material-browser","contentComponent":"MaterialBrowserPanel","title":"Materials"},"properties":{"id":"properties","contentComponent":"RightPanel","title":"Properties"},"toolbar-panel":{"id":"toolbar-panel","contentComponent":"ToolbarPanel","title":"Toolbar","minimumHeight":32,"maximumHeight":32},"left-toolbar":{"id":"left-toolbar","contentComponent":"LeftToolbarPanel","title":"Left Toolbar","minimumWidth":36,"maximumWidth":36}}};

export function initLayout(container) {
  const { createDockview } = window['dockview-core'];

  const api = createDockview(container, {
    theme: cycoTheme,
    createComponent(options) {
      switch (options.name) {
        case 'LeftPanel':     return new LeftPanel();
        case 'CenterPanel':   return new CenterPanel();
        case 'RightPanel':    return new RightPanel();
        case 'BottomPanel':           return new BottomPanel();
        case 'MaterialBrowserPanel':   return new MaterialBrowserPanel();
        case 'MenuBarPanel':           return new MenuBarPanel();
        case 'ToolbarPanel':  return new ToolbarPanel();
        case 'LeftToolbarPanel':    return new LeftToolbarPanel();
        case 'RightViewportPanel': return new RightViewportPanel();
        case 'CameraViewPanel':    return new CameraViewPanel();
        case 'StatsPanel':         return new StatsPanel();
        case 'PreferencesPanel':   return new PreferencesPanel();
        default: throw new Error(`Unknown component: ${options.name}`);
      }
    },
  });

  // Apply the default layout to initialize the container dimensions.
  // LayoutManager.restoreAutoSaved() will call fromJSON again if there is a
  // saved layout.  NOTE: both calls share the same createComponent factory, so
  // panel init() fires once per fromJSON; _pendingOrient is re-applied before
  // the restore call.
  api.fromJSON(DEFAULT_LAYOUT);

  return api;
}
