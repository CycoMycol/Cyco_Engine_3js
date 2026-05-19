# Cyco Engine — Complete Development History & Reproduction Guide

> **Author:** CycoMycol  
> **Repository:** https://github.com/CycoMycol/Cyco_Engine_3js  
> **Stack:** Vanilla JS (ES Modules) · Dockview-Core · No build system  
> **Theme:** Dark Coffee (warm dark brown with orange accents)

---

## Table of Contents

1. [What Is Cyco Engine?](#1-what-is-cyco-engine)
2. [Tech Stack & Library Choices](#2-tech-stack--library-choices)
3. [Project File Structure](#3-project-file-structure)
4. [Architecture Overview](#4-architecture-overview)
5. [Module-by-Module Breakdown](#5-module-by-module-breakdown)
6. [The Layout System — Deep Dive](#6-the-layout-system--deep-dive)
7. [The Theme System — Deep Dive](#7-the-theme-system--deep-dive)
8. [Bugs Encountered & How We Fixed Them](#8-bugs-encountered--how-we-fixed-them)
9. [UI Polish Decisions](#9-ui-polish-decisions)
10. [Default Layout — What It Looks Like](#10-default-layout--what-it-looks-like)
11. [How to Reproduce This From Scratch](#11-how-to-reproduce-this-from-scratch)
12. [Current State & What Comes Next](#12-current-state--what-comes-next)

---

## 1. What Is Cyco Engine?

Cyco Engine is a browser-based game engine editor. The idea is to build a fully functional game-development environment that runs entirely in the browser — no Electron, no desktop app. The editor shell (menus, panels, toolbars, theme) is the foundation layer. The engine runtime (`engine/src/`) will be built on top of Three.js later.

**The editor shell does:**
- Provides a resizable, dockable, floatable multi-panel layout (like VS Code or Blender)
- Has a top Menu Bar (File / Edit / View / Layout / Window / Help)
- Has a bottom Toolbar (Game Manager / UI Builder / Components / Scene Builder / Camera Builder / Input Manager)
- Left panel: Scene Hierarchy
- Center panel: Viewport (will host the Three.js canvas)
- Right panel: Properties
- Bottom center panel: Assets Browser
- Fully theming system with presets (Dark Coffee, Light Cream, Midnight Blue, Forest Green) and a live color-picker dialog
- All layout state auto-saved to `localStorage` so it survives page refresh

---

## 2. Tech Stack & Library Choices

| Layer | Choice | Why |
|-------|--------|-----|
| Language | Vanilla JavaScript (ES Modules) | No framework overhead; direct DOM control; fastest for tight UI |
| Layout engine | `dockview-core` v1.x (UMD bundle) | Battle-tested panel docking library; used by VS Code extensions; handles split/resize/tab/float |
| Fonts | Inter (UI), JetBrains Mono (code), Space Grotesk (headings) | All self-hosted WOFF2 variable fonts — no Google Fonts CDN dependency |
| CSS | Custom properties (design tokens) only — no preprocessor | Single source of truth; ThemeManager swaps all colors at runtime by patching `:root` |
| Build | None | The editor is a flat `index.html` + ES module imports; open in a local HTTP server and it runs |
| Source control | Git + GitHub CLI | Repo: `Cyco_Engine_3js` on `CycoMycol` account |

### Why no build system?

The editor shell is not shipped as a package — it is a developer workspace. Adding Webpack/Vite would add complexity with zero runtime benefit at this stage. When the engine runtime grows large, Vite can be added for bundling only.

### How dockview-core is loaded

```html
<!-- UMD bundle — must load BEFORE any module script -->
<script src="./libs/dockview-core.min.js"></script>
<script type="module" src="./src/main.js"></script>
```

The UMD build exposes `window['dockview-core']`. It must be a `<script>` tag, not an ES import, because UMD uses `module.exports` — incompatible with native ES module resolution.

---

## 3. Project File Structure

```
Cyco_Engine/
├── .gitignore
├── DevDocs/
│   └── DEVELOPMENT_HISTORY.md          ← this file
├── editor/
│   ├── index.html                       ← single HTML entry point
│   ├── libs/
│   │   ├── dockview-core.min.js         ← UMD panel layout library
│   │   └── fonts/
│   │       ├── inter-variable.woff2
│   │       ├── jetbrains-mono-variable.woff2
│   │       └── space-grotesk-variable.woff2
│   └── src/
│       ├── main.js                      ← app bootstrap / entry
│       ├── layout.js                    ← creates dockview + DEFAULT_LAYOUT JSON
│       ├── layout-manager.js            ← singleton wrapping DockviewApi
│       ├── panels/
│       │   ├── BasePanel.js             ← base class for ALL panels (float/drag/dock logic)
│       │   ├── MenuBarPanel.js          ← top bar (wraps MenuBar.js as dockview panel)
│       │   ├── ToolbarPanel.js          ← bottom bar (wraps Toolbar.js as dockview panel)
│       │   ├── LeftPanel.js             ← Scene Hierarchy
│       │   ├── CenterPanel.js           ← Viewport
│       │   ├── RightPanel.js            ← Properties
│       │   └── BottomPanel.js           ← Assets Browser
│       ├── project/
│       │   └── ProjectManager.js        ← project open/save/migrate
│       ├── theme/
│       │   ├── cyco-theme.css           ← all styles + CSS custom properties
│       │   ├── cyco-theme.js            ← dockview theme descriptor
│       │   └── theme-manager.js         ← runtime theme switching + presets
│       └── ui/
│           ├── MenuBar.js               ← nav bar DOM builder (File/Edit/View menus)
│           ├── Toolbar.js               ← toolbar DOM builder (action buttons)
│           ├── FloatBar.js              ← legacy float/dock for standalone bars
│           ├── AssetBrowser.js          ← assets panel content
│           ├── CeColorPicker.js         ← custom color-picker component
│           ├── Logo.js                  ← SVG logo element builder
│           ├── NewProjectDialog.js      ← new project modal
│           ├── ThemeDialog.js           ← theme customisation modal
│           └── ce-prompt.js             ← custom text-input prompt dialog
└── engine/
    └── src/                             ← future Three.js engine runtime (empty)
```

---

## 4. Architecture Overview

```
index.html
    │
    ├── loads dockview-core.min.js  (UMD global)
    └── loads main.js  (ES module entry)
            │
            ├── layout.js          → createDockview() → DockviewApi
            │       └── DEFAULT_LAYOUT  (fromJSON — locked-in panel arrangement)
            │
            ├── LayoutManager.init(api)
            │       ├── captures default layout snapshot
            │       ├── wires onDidLayoutChange → auto-save to localStorage
            │       └── restoreAutoSaved()  ← reads localStorage on startup
            │
            ├── ThemeManager.init()
            │       └── reads localStorage → applies CSS custom properties to :root
            │
            └── ProjectManager.init()
                    └── migrates any legacy project data

Panel lifecycle (dockview calls these):
    BasePanel.init(params)
        ├── _buildContent()   ← subclass returns content element
        └── _addHeaderActions()  ← adds float ⧉ and maximize buttons to panel tab
```

### Key design rule: all layout mutations go through `LayoutManager`

`LayoutManager` owns the `DockviewApi`. Nothing else calls `api` methods directly (except `layout.js` during init). This keeps all side effects (auto-save, visibility tracking, pending-orient hints) in one place.

---

## 5. Module-by-Module Breakdown

### `editor/index.html`

Dead simple. Sets charset, viewport, links `cyco-theme.css`, then loads the UMD bundle and the module entry point. No other HTML — everything is built programmatically in JS.

```html
<body>
  <div id="app"></div>
  <script src="./libs/dockview-core.min.js"></script>
  <script type="module" src="./src/main.js"></script>
</body>
```

---

### `editor/src/main.js`

Bootstrap sequence — runs once on page load:

1. Creates `#dock-container` div inside `#app`
2. Calls `initLayout(container)` → returns `DockviewApi`
3. Calls `LayoutManager.init(api)` — captures default layout, wires change events
4. Calls `LayoutManager.restoreAutoSaved()` — resumes user's previous session from `localStorage`
5. Double-`requestAnimationFrame` to apply bar height constraints _after_ ResizeObserver settles
6. `ThemeManager.init()` — applies saved or default theme
7. `ProjectManager.init()` — migrates any old project data

---

### `editor/src/layout.js`

Two exports:

**`DEFAULT_LAYOUT`** — a hardcoded `JSON` object captured from the exact arrangement the user finalized. This is what loads on first run (or after a reset). The structure is:

```
Root (HORIZONTAL branch, 851px wide)
└── Vertical column
    ├── Menu Bar leaf         (30px tall)
    ├── Three-column branch   (459px tall)
    │   ├── Scene Hierarchy leaf  (142px wide)
    │   ├── Center column         (557px wide)
    │   │   ├── Viewport leaf         (270px tall)
    │   │   └── Assets Browser leaf   (189px tall)
    │   └── Properties leaf       (152px wide)
    └── Toolbar leaf          (32px tall)
```

**`initLayout(container)`** — calls `createDockview()` with the `cycoTheme` descriptor and a `createComponent` factory, then restores from `DEFAULT_LAYOUT` via `api.fromJSON()`.

> **Important:** `fromJSON()` is used instead of sequential `addPanel()` calls because `fromJSON` restores exact sizes, orientations, and group IDs in one atomic operation.

---

### `editor/src/layout-manager.js`

Singleton. Owns the `DockviewApi` and all layout-related state:

| Property / Method | Purpose |
|-------------------|---------|
| `api` | The raw `DockviewApi` instance |
| `_visibility` | Map of `panelId → boolean` |
| `_snapshots` | Full layout JSON taken just before hiding a panel (so it can be restored to the same position) |
| `_defaultLayout` | Snapshot taken right after `init()` for `resetToDefault()` |
| `_autoSaveTimer` | Debounce timer — saves 400ms after last layout change |
| `init(api)` | Must be called once after `createDockview()` |
| `restoreAutoSaved()` | Reads `localStorage['cyco-layout-current']` and restores |
| `togglePanel(id)` | Show/hide a panel, preserving its last position |
| `resetToDefault()` | Restores `DEFAULT_LAYOUT` |
| `_pendingOrient` | Stash for bar orientation hints across `fromJSON` panel recreation |

**Auto-save format (localStorage key: `cyco-layout-current`):**
```json
{
  "layout": { /* full dockview JSON */ },
  "snapshots": { "scene-hierarchy": { /* layout JSON when hidden */ } }
}
```

**Validation on restore:**  
The saved layout is validated by checking that `"menu-bar-panel"` and `"toolbar-panel"` both appear in the JSON string. If either is missing (legacy format from before bars were dockable), the save is discarded and the default layout is used.

---

### `editor/src/panels/BasePanel.js`

This is the most complex file in the project. It is the **base class for every dockview panel** and contains all the drag-to-float, snap-back, and drop-zone logic.

#### What `BasePanel` provides

- `init(params)` — called by dockview; renders content and adds header action buttons
- `_buildContent()` — override in subclass to return the panel's content element
- `_addHeaderActions(api)` — injects Float (⧉) and Maximize buttons into the dockview tab
- `_createDragHandle()` — creates a drag grip button; drag floats/moves, click toggles
- `_setupBarDrag(barEl)` — registers mousedown on a bar background so dragging the empty area also works
- `_startBarDrag(e, handleEl)` — core drag state machine (docked→float, or floating→reposition/dock)
- `_floatAtPosition(clientX, clientY)` — floats the panel near a cursor position
- `_toggleFloat(btn)` — toggle between docked and floating without specifying position
- `_findFloatingContainer()` — walks up the DOM to find the `dv-resize-container` wrapper
- `_computeDropZones()` — builds an array of drop-zone descriptors based on current layout geometry
- `_startDropTracking()` / `_stopDropTracking()` — shows/hides the visual drop-zone overlay
- `_dockAtZone(zone)` — docks the floating bar into a layout zone via JSON manipulation
- `_dockAtVpEdge(zone, snapshot)` — handles viewport-edge zones (full-width rows / full-height columns)
- `_dockAtPanelEdge(zone, snapshot)` — handles zones adjacent to a specific panel

#### Subclass pattern

```js
import { BasePanel } from './BasePanel.js';

export class LeftPanel extends BasePanel {
  _buildContent() {
    const el = document.createElement('div');
    el.textContent = 'Scene Hierarchy';
    return el;
  }

  get _floatDimensions() {
    return { width: 320, height: 500 };
  }
}
```

---

### `editor/src/panels/MenuBarPanel.js` & `ToolbarPanel.js`

These wrap the standalone `MenuBar.js` and `Toolbar.js` DOM builders as dockview panels. They extend `BasePanel` with `noFloatBtn: true` so the standard tab float button is hidden (the bar has its own drag handle instead). They call `_setupBarDrag(barEl)` so dragging the empty area moves the panel.

---

### `editor/src/ui/Toolbar.js`

Builds the toolbar strip DOM. Current buttons (in order):

| Button Label | Event Dispatched |
|---|---|
| Game Manager | `cyco-action` detail: `'game-manager'` |
| UI Builder | `cyco-action` detail: `'ui-builder'` |
| Components | `cyco-action` detail: `'components'` |
| Scene Builder | `cyco-action` detail: `'scene-builder'` |
| Camera Builder | `cyco-action` detail: `'camera-builder'` |
| Input Manager | `cyco-action` detail: `'input-manager'` |

Buttons fire `document.dispatchEvent(new CustomEvent('cyco-action', { detail: id }))` so any module can listen for toolbar actions without a direct reference to the toolbar.

---

### `editor/src/ui/MenuBar.js`

Builds the top navigation bar. Structure:

- **Left:** Logo + menu items (File, Edit, View, Layout, Window, Help) with dropdown submenus
- **Right:** Panel toggle buttons (Left / Center / Right / Bottom panels) + Layout customize button + float toggle button

Menus are plain `<div>` elements absolutely positioned below the menu item on click. Clicking outside closes them.

---

### `editor/src/ui/FloatBar.js`

> **Note:** This was the original float system before bars became dockview panels. It is now used only when `noFloatBtn` is false and a bar is _not_ a dockview panel. The toolbar and menu bar panels use `BasePanel`'s drag system instead.

`makeFloatable(barEl)` returns a float toggle button. When floated, the bar is moved into a `ce-bar-float-window` absolutely-positioned div. A `Comment` node placeholder keeps the original DOM slot. On snap-back, the placeholder is replaced with the bar.

Drag uses `getBoundingClientRect()` (not `offsetLeft/offsetTop`) because `position:fixed` elements have no reliable `offsetParent`.

---

### `editor/src/theme/cyco-theme.css`

Single CSS file for the entire editor. Structure:

1. `@font-face` declarations (Inter, JetBrains Mono, Space Grotesk)
2. `:root` CSS custom properties — all design tokens (colors, font sizes, spacing)
3. Global reset
4. `#app` layout
5. Menu bar styles
6. Toolbar styles
7. Panel styles
8. Dockview overrides (tab bar, sash, scrollbar, etc.)
9. Dialog / modal styles
10. Float window styles
11. Drop-zone overlay styles

**Design token naming:**

```css
--ce-bg-base       /* darkest background */
--ce-bg-panel      /* panel background */
--ce-bg-surface    /* slightly raised surface */
--ce-bg-raised     /* further raised (inputs, dropdowns) */
--ce-text-primary  /* main text */
--ce-text-muted    /* secondary / placeholder text */
--ce-accent-orange /* primary brand color */
--ce-accent-green  /* secondary accent */
--ce-border        /* border/divider color */
```

All colors live in CSS variables. `ThemeManager` patches `:root` inline styles to override them at runtime — no class swapping needed.

---

### `editor/src/theme/theme-manager.js`

Singleton. Manages presets and live theme application:

- **Built-in presets:** Dark Coffee, Light Cream, Midnight Blue, Forest Green
- **Custom presets:** Saved to `localStorage['cyco-theme-presets']`
- **Active theme:** Saved to `localStorage['cyco-theme-active']`
- `init()` — applies saved theme on startup (falls back to Dark Coffee)
- `apply(preset)` — patches CSS vars on `document.documentElement.style`
- Auto-computes `--ce-hover-bg` and `--ce-active-bg` by darkening the accent color via HSL math
- Auto-computes `--ce-accent-text` (white or black) based on accent luminance for contrast

---

### `editor/src/theme/cyco-theme.js`

Exports a `cycoTheme` object consumed by `createDockview()`. Maps dockview's internal CSS variable names to Cyco's design tokens so dockview tabs, sashes, and backgrounds inherit the active theme.

---

### `editor/src/project/ProjectManager.js`

Singleton. Manages project creation, open, save, and migration. No project is auto-opened on startup — the user picks one via File → New Project or File → Open Project. Handles migration of any legacy project data format.

---

## 6. The Layout System — Deep Dive

### How dockview works

`createDockview(container, options)` returns a `DockviewApi`. Panels are registered by their `contentComponent` name (a string) mapped to a class in the `createComponent` factory. The layout is a tree of `branch` (splits) and `leaf` (panel groups) nodes.

### `fromJSON` vs `addPanel`

Early versions used sequential `addPanel()` calls:
```js
api.addPanel({ id: 'scene-hierarchy', component: 'LeftPanel', position: { direction: 'left' } });
```

This was replaced with `api.fromJSON(DEFAULT_LAYOUT)` because:
- `addPanel` sequences are order-dependent and fragile
- `fromJSON` restores exact pixel sizes, group IDs, and orientations atomically
- Capturing the exact layout JSON after manually arranging it is the only way to guarantee pixel-perfect reproduction

### Drop zone priority

When a floating panel is dragged, drop zones are computed in priority order:

1. **Center viewport edges** — narrow 40px strips around the viewport panel (highest priority)
2. **Viewport edges** — full-screen 50px strips at top/bottom/left/right
3. **Other panel edges** — 40px strips around Scene Hierarchy, Properties, Assets Browser

Priority is first-match, so e.g. dragging near the top of the viewport hits a viewport-panel zone rather than a full-screen edge zone.

### Bar height enforcement

The Menu Bar and Toolbar are locked to exact pixel heights (`30px` and `32px` respectively). This is done in three places:

1. `DEFAULT_LAYOUT` JSON has `minimumHeight`/`maximumHeight` constraints in the panel descriptor
2. `BasePanel.init()` calls `groupApi.setConstraints()` synchronously
3. `main.js` double-`requestAnimationFrame` calls `setSize()` after ResizeObserver settles

Triple enforcement is necessary because dockview's ResizeObserver can override constraints on first layout.

---

## 7. The Theme System — Deep Dive

### How runtime theming works

```
ThemeManager.apply(preset)
    │
    ├── Writes each color to document.documentElement.style.setProperty(--ce-*, value)
    │   (inline style overrides the :root defaults in the CSS file)
    │
    ├── Computes --ce-hover-bg   = accent darkened by 15% lightness
    ├── Computes --ce-active-bg  = accent darkened by 30% lightness
    └── Computes --ce-accent-text = white if accent luminance < 0.5, else black
```

Because ALL colors in the CSS file reference `var(--ce-*)`, swapping the root custom properties instantly repaints the entire editor — no class names, no `<style>` injection, no page reload.

### Adding a new color theme

```js
// In theme-manager.js BUILTIN_PRESETS:
'My Theme': {
  bgBase:         '#xxxxxx',
  bgPanel:        '#xxxxxx',
  bgSurface:      '#xxxxxx',
  bgRaised:       '#xxxxxx',
  bgTabInactive:  '#xxxxxx',
  bgMenuBar:      '#xxxxxx',
  bgToolbar:      '#xxxxxx',
  textPrimary:    '#xxxxxx',
  textMuted:      '#xxxxxx',
  accentOrange:   '#xxxxxx',   // primary brand color
  accentGreen:    '#xxxxxx',
  border:         '#xxxxxx',
  scrollTrack:    '#xxxxxx',
  scrollThumb:    '#xxxxxx',
  fontFamily:     'Inter',     // 'Inter' | 'JetBrains Mono' | 'Space Grotesk'
  fontSize:       'M',         // 'S' | 'M' | 'L'
}
```

---

## 8. Bugs Encountered & How We Fixed Them

This section is the complete record of every bug found and the exact fix applied. Useful as a reference if you are rebuilding or encounter similar issues with dockview.

---

### Bug 1 — Floating panel jumps to top-left corner on float

**Symptom:** Dragging a docked panel to float it would snap to position `(100, 100)` instead of appearing near the cursor.

**Root cause:** `dockview.addFloatingGroup(panel, options)` accepts either:
```js
// ✅ Correct — x/y at top level
addFloatingGroup(panel, { x: 200, y: 300, width: 500, height: 360 })

// ❌ Wrong — x/y inside a `position` object (ignored by dockview; falls back to At=100, It=100)
addFloatingGroup(panel, { position: { x: 200, y: 300, width: 500, height: 360 } })
```

The code had the `position` wrapper. Dockview's internal constants `At = 100`, `It = 100` are the fallback coordinates.

**Fix:** Removed the `position` wrapper in both `_floatAtPosition()` and `_toggleFloat()`:
```js
dockApi.addFloatingGroup(panel, { x, y, width, height });
```

---

### Bug 2 — Floating panel drifts 3px each time you drag it

**Symptom:** Every time you dragged a floating panel, it shifted ~3px right and 3px down from where you dropped it. The drift accumulated with each drag.

**Root cause:** The `dv-floating-overlay-host` element (the container that holds all floating panels) is positioned at `(3, 3)` relative to the viewport. When we read `container.getBoundingClientRect().left/top` to get the panel's current position, we got viewport coordinates. But `container.style.left/top` are relative to the overlay host. Writing viewport coords into host-relative style caused a 3px offset per drag.

**Fix:** Replace `getBoundingClientRect()` with `offsetLeft`/`offsetTop` (which are already host-relative):
```js
// ❌ Before (viewport coords written into host-relative style):
const baseLeft = container.getBoundingClientRect().left;
const baseTop  = container.getBoundingClientRect().top;

// ✅ After (host-relative coords — no offset error):
const baseLeft = container.offsetLeft;
const baseTop  = container.offsetTop;
```

Same fix applied to the `floatPosInit` block in the docked→float drag path:
```js
// ❌ Before:
const r = floatContainer.getBoundingClientRect();
floatContainer.style.left = r.left + 'px';

// ✅ After:
floatContainer.style.left = floatContainer.offsetLeft + 'px';
```

---

### Bug 3 — Clicking an empty area of the menu bar / toolbar causes it to float

**Symptom:** A simple click anywhere on the empty background of the menu bar or toolbar would trigger the float toggle, popping the bar out. Only dragging should do that.

**Root cause:** `_setupBarDrag()` called `_startBarDrag(e, handle)` passing the drag handle element as `handleEl`. Inside `_startBarDrag`, the `onUp` handler checked `if (!didDrag) this._toggleFloat(handleEl)` — meaning ANY click (even zero drag distance) triggered a float toggle.

**Fix — two-part:**

1. In `_setupBarDrag`, pass `null` instead of the handle element:
```js
// ❌ Before:
this._startBarDrag(e, handle);

// ✅ After:
this._startBarDrag(e, null);  // null = no toggle on plain click
```

2. In `_startBarDrag`, guard both `_toggleFloat` calls:
```js
// ❌ Before:
if (!didDrag) this._toggleFloat(handleEl);

// ✅ After:
if (!didDrag && handleEl) this._toggleFloat(handleEl);
```

Result: You can now click on an empty area of the bar freely. Only an actual drag gesture (> 3–5px movement) floats the bar. Only clicking the dedicated drag-handle button toggles float on a plain click.

---

### Bug 4 — Saved layout always discarded on page reload

**Symptom:** Any layout customization (panel resizes, rearrangements) was lost on every page refresh, reverting to the default. `localStorage` had the data, but it was being thrown away.

**Root cause:** `restoreAutoSaved()` had a validation step that walked the layout tree looking for `menu-bar-panel` in the root's direct children:
```js
// ❌ The tree walk checked root.data children for views containing 'menu-bar-panel',
// but the bars are nested one level deeper:
// root → outer branch → bar leaves
// So `barAtRoot` was always false, and the saved layout was always discarded.
```

**Fix:** Replace the unreliable tree-walk with a simple JSON string search:
```js
const layoutStr = JSON.stringify((data.layout ?? data)?.grid ?? {});
const barsPresent =
  layoutStr.includes('"menu-bar-panel"') &&
  layoutStr.includes('"toolbar-panel"');
if (!barsPresent) {
  localStorage.removeItem(AUTO_SAVE_KEY);
  return;
}
```

This is robust regardless of nesting depth and does not depend on structural assumptions.

---

### Bug 5 — FloatBar.js standalone drag jump on first move

**Symptom:** When using `FloatBar.js` (the non-dockview standalone float system for legacy bars), the floating window would jump to an incorrect position on the first mouse move.

**Root cause:** The drag handler was using `offsetLeft/offsetTop` to get the window's initial position. But `position:fixed` elements report `offsetLeft/offsetTop` relative to the initial containing block (or a stacking context), not the viewport. The result was a position jump on the first move event.

**Fix:** Use `getBoundingClientRect()` in `FloatBar.js` (the opposite of what BasePanel.js needed, because FloatBar uses `position:fixed` while dockview uses `position:absolute` inside the overlay host):
```js
const rect = win.getBoundingClientRect();
const ox = e.clientX - rect.left;
const oy = e.clientY - rect.top;
```

Plus viewport clamping so the window never goes off-screen:
```js
win.style.left = Math.max(0, Math.min(mv.clientX - ox, maxX)) + 'px';
win.style.top  = Math.max(0, Math.min(mv.clientY - oy, maxY)) + 'px';
```

---

## 9. UI Polish Decisions

### Toolbar button order

The original toolbar had game-engine-style tool buttons (Select, Move, Rotate, Scale, Play, Pause). These were replaced with mode-switch buttons representing the major editor workspaces:

```
Game Manager | UI Builder | Components | Scene Builder | Camera Builder | Input Manager
```

The order was deliberately chosen: the most-used workflows (Game Manager, UI Builder, Components) are on the left where the eye naturally starts. Less common tools (Camera Builder, Input Manager) sit on the right.

### Bar heights (30px / 32px)

- **Menu Bar: 30px** — matches VS Code's title bar height, feels familiar
- **Toolbar: 32px** — 2px taller to accommodate slightly larger touch targets on the action buttons

Both are locked with `minimumHeight = maximumHeight` to prevent accidental resize.

### Orange accent color (#e07228)

The Dark Coffee theme uses a warm burnt-orange accent. This color was chosen to:
- Contrast clearly against the dark brown backgrounds
- Feel distinct from blue/gray (GitHub, VS Code) and green/teal (Unity, Godot)
- Read as "active / selected" at low opacity (e.g. `rgba(224, 114, 40, 0.25)` for drop zones)

### No floating group "ghost" tabs

Dockview by default shows a tab strip even on single-panel groups. For the Menu Bar and Toolbar, this was suppressed via dockview theme CSS overrides in `cyco-theme.css` that hide the tab bar when `maximumHeight` is set (the bars are not meant to be tabbed).

---

## 10. Default Layout — What It Looks Like

```
┌─────────────────────────────────────────────────────────────────┐  30px
│  🔧 File  Edit  View  Layout  Window  Help          ▐▌ ▌▐ ▌▐ ▄  │  Menu Bar
├──────────────┬──────────────────────────────┬───────────────────┤
│              │                              │                   │
│    Scene     │         Viewport             │    Properties     │  270px
│  Hierarchy   │       (Three.js goes         │                   │
│              │            here)             │                   │
│    142px     ├──────────────────────────────┤    152px          │
│              │       Assets Browser         │                   │
│              │                              │                   │  189px
│              │            557px wide        │                   │
├──────────────┴──────────────────────────────┴───────────────────┤  32px
│  Game Manager | UI Builder | Components | Scene Builder | ...   │  Toolbar
└─────────────────────────────────────────────────────────────────┘
         851px total width  ×  521px total height
```

---

## 11. How to Reproduce This From Scratch

This is the complete step-by-step guide to rebuild Cyco Engine from zero.

### Prerequisites

- A modern browser (Chrome / Edge / Firefox)
- A local HTTP server (VS Code Live Server extension, or `npx serve`, or Python's `http.server`)
- Git + GitHub CLI (`gh`) for source control
- No Node.js, no npm, no build tools required to run

---

### Step 1 — Create the folder structure

```
mkdir Cyco_Engine
cd Cyco_Engine
mkdir -p editor/libs/fonts editor/src/panels editor/src/project editor/src/theme editor/src/ui engine/src
```

---

### Step 2 — Download dockview-core

Go to: https://www.npmjs.com/package/dockview-core  
Download the UMD build or grab it via npm and copy the file:

```bash
npm pack dockview-core
# or
npx -y dockview-core  # just to get the package locally
```

Copy `node_modules/dockview-core/dist/dockview-core.min.js` → `editor/libs/dockview-core.min.js`

Alternatively, use the CDN version in `index.html` only if you don't mind an internet dependency:
```html
<script src="https://cdn.jsdelivr.net/npm/dockview-core/dist/dockview-core.min.js"></script>
```

---

### Step 3 — Download fonts

Download these variable font WOFF2 files and place them in `editor/libs/fonts/`:

| Font | Source |
|------|--------|
| Inter Variable | https://fonts.google.com/specimen/Inter |
| JetBrains Mono Variable | https://fonts.google.com/specimen/JetBrains+Mono |
| Space Grotesk Variable | https://fonts.google.com/specimen/Space+Grotesk |

Download the "Variable font" (`.woff2`) for each. Rename to:
- `inter-variable.woff2`
- `jetbrains-mono-variable.woff2`
- `space-grotesk-variable.woff2`

---

### Step 4 — Create `editor/index.html`

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Cyco Engine</title>
  <link rel="stylesheet" href="./src/theme/cyco-theme.css" />
</head>
<body>
  <div id="app"></div>
  <script src="./libs/dockview-core.min.js"></script>
  <script type="module" src="./src/main.js"></script>
</body>
</html>
```

---

### Step 5 — Build the CSS design-token system

Create `editor/src/theme/cyco-theme.css`. The key principle is that **every color is a CSS custom property** on `:root`. No hardcoded colors anywhere in the CSS (except the property defaults themselves).

Core `:root` variables to define:
```css
:root {
  --ce-bg-base:       #1c1917;
  --ce-bg-panel:      #252118;
  --ce-bg-surface:    #332a22;
  --ce-bg-raised:     #3e3228;
  --ce-text-primary:  #ede8e0;
  --ce-text-muted:    #9e8f82;
  --ce-accent-orange: #e07228;
  --ce-accent-green:  #6ab26a;
  --ce-border:        #3d3028;
  /* ... see full file for all properties */
}
```

---

### Step 6 — Create the dockview theme descriptor

Create `editor/src/theme/cyco-theme.js`. This maps dockview's internal CSS variable names to your design tokens. Minimum required:

```js
export const cycoTheme = {
  name: 'cyco',
  className: 'dockview-theme-cyco',
};
```

Then in CSS, add rules under `.dockview-theme-cyco` that override dockview's internal vars:
```css
.dockview-theme-cyco {
  --dv-background-color: var(--ce-bg-base);
  --dv-tabs-and-actions-container-background-color: var(--ce-bg-surface);
  --dv-activegroup-visiblepanel-tab-background-color: var(--ce-bg-panel);
  /* ... etc */
}
```

---

### Step 7 — Build the panel base class

Create `editor/src/panels/BasePanel.js`. This is the hardest part. Key points:

1. Every panel is a class with an `init(params)` method (dockview lifecycle)
2. `_buildContent()` returns an HTML element — subclasses override this
3. Add float and maximize buttons to the dockview tab using `requestAnimationFrame` (dockview renders tabs asynchronously)
4. Implement drag-to-float using `mousedown` → `mousemove` → `mouseup` with a threshold (5px) before triggering float
5. Use `dockApi.addFloatingGroup(panel, { x, y, width, height })` — **NOT** `{ position: { x, y } }`
6. For floating panel reposition: read `container.offsetLeft/offsetTop` — NOT `getBoundingClientRect()`
7. For drop zones: build an array of `{ rect, direction, panelId }` objects and check cursor against them on each `mousemove`

---

### Step 8 — Create panel subclasses

Each panel extends BasePanel and overrides `_buildContent()`:

```js
// editor/src/panels/LeftPanel.js
import { BasePanel } from './BasePanel.js';

export class LeftPanel extends BasePanel {
  _buildContent() {
    const el = document.createElement('div');
    el.className = 'ce-panel-content';
    el.textContent = 'Scene Hierarchy';
    return el;
  }
}
```

Do the same for: `CenterPanel`, `RightPanel`, `BottomPanel`, `MenuBarPanel`, `ToolbarPanel`.

For `MenuBarPanel` and `ToolbarPanel`: import their respective UI builders (`MenuBar.js`, `Toolbar.js`) and call them in `_buildContent()`. Also call `_setupBarDrag(barEl)` so dragging the bar background moves the panel.

---

### Step 9 — Build `layout.js`

```js
import { cycoTheme } from './theme/cyco-theme.js';
// ... import all panel classes

export const DEFAULT_LAYOUT = { /* captured JSON — see below */ };

export function initLayout(container) {
  const { createDockview } = window['dockview-core'];
  const api = createDockview(container, {
    theme: cycoTheme,
    createComponent(options) {
      switch (options.name) {
        case 'LeftPanel':    return new LeftPanel();
        case 'CenterPanel':  return new CenterPanel();
        case 'RightPanel':   return new RightPanel();
        case 'BottomPanel':  return new BottomPanel();
        case 'MenuBarPanel': return new MenuBarPanel();
        case 'ToolbarPanel': return new ToolbarPanel();
        default: throw new Error(`Unknown component: ${options.name}`);
      }
    },
  });
  api.fromJSON(DEFAULT_LAYOUT);
  return api;
}
```

**How to capture `DEFAULT_LAYOUT`:**
1. Run the app with `addPanel()` calls to build an initial layout
2. Open the browser console
3. Run: `copy(JSON.stringify(window.__dockApi.toJSON()))`  
   (or paste into `console.log` and copy the output)
4. Arrange panels exactly how you want
5. Repeat step 3 — this is your `DEFAULT_LAYOUT`
6. Paste it into `layout.js` as the exported constant

---

### Step 10 — Build `layout-manager.js`

Key rules:
- It is a plain object singleton (not a class)
- `init(api)` must be called once
- `restoreAutoSaved()` must validate that the saved layout includes both bar panels before applying
- Auto-save by listening to `api.onDidLayoutChange()` with a 400ms debounce
- Save format: `{ layout: api.toJSON(), snapshots: { ... } }`

---

### Step 11 — Build `main.js`

```js
import ThemeManager   from './theme/theme-manager.js';
import LayoutManager  from './layout-manager.js';
import { initLayout } from './layout.js';
import ProjectManager from './project/ProjectManager.js';

const app = document.getElementById('app');
const dockContainer = document.createElement('div');
dockContainer.id = 'dock-container';
app.appendChild(dockContainer);

const dockApi = initLayout(dockContainer);
LayoutManager.init(dockApi);
LayoutManager.restoreAutoSaved();

// Lock bar heights after layout settles
requestAnimationFrame(() => requestAnimationFrame(() => {
  for (const [id, h] of [['menu-bar-panel', 30], ['toolbar-panel', 32]]) {
    const panel = dockApi.getPanel(id);
    const groupApi = panel?.api?.group?.api;
    if (groupApi && panel?.api?.group?.api?.location?.type !== 'floating') {
      groupApi.setConstraints({ minimumHeight: h, maximumHeight: h });
      groupApi.setSize({ height: h });
    }
  }
}));

ThemeManager.init();
ProjectManager.init();
```

---

### Step 12 — Run the editor

Open `editor/index.html` in a local HTTP server. **Do NOT open as a `file://` URL** — ES module imports are blocked by the browser's CORS policy on `file://` origins.

**Using VS Code Live Server:**  
Right-click `editor/index.html` → "Open with Live Server"

**Using Python:**  
```bash
cd editor
python -m http.server 8080
# Open http://localhost:8080
```

**Using Node.js serve:**  
```bash
npx serve editor -p 8080
```

---

### Step 13 — Initialize Git and push to GitHub

```bash
cd Cyco_Engine
git init
git add .
git commit -m "Initial commit"
gh repo create Cyco_Engine_3js --public --source=. --remote=origin --push
```

---

## 12. Current State & What Comes Next

### What is done ✅

| Feature | Status |
|---------|--------|
| Dockview panel layout (resize, drag, split) | Done |
| Menu Bar as dockable/floatable panel | Done |
| Toolbar as dockable/floatable panel | Done |
| Drag-to-float for any panel | Done |
| Drop-zone dock-back system | Done |
| Empty-area drag without spurious float toggle | Done |
| Panel maximize / restore | Done |
| Theme system (CSS vars + runtime switching) | Done |
| 4 built-in color presets + custom preset builder | Done |
| Layout auto-save to localStorage | Done |
| Layout restore validation (rejects legacy formats) | Done |
| Locked default layout (Menu Bar / Toolbar / 3-column view) | Done |
| Toolbar buttons (Game Manager / UI Builder / etc.) | Done |
| Panel toggle buttons in menu bar | Done |
| File / Edit / View / Layout / Window / Help menus | Done |
| Project Manager (new / open / save) | Done |
| Git repository on GitHub | Done |

### What comes next 🔧

| Feature | Notes |
|---------|-------|
| Three.js canvas in Viewport panel | `engine/src/` is the home for the runtime |
| Scene graph / hierarchy | Connect Scene Hierarchy panel to Three.js scene |
| Asset browser (real files) | AssetBrowser.js needs a file-reading backend (Electron or File System Access API) |
| Properties inspector | RightPanel needs a dynamic property editor |
| Game Manager dialog | Wires to the `game-manager` toolbar action |
| Scene Builder dialog | Wires to the `scene-builder` toolbar action |
| UI Builder | Wires to the `ui-builder` toolbar action |
| Components system | Wires to the `components` toolbar action |
| Camera Builder | Wires to the `camera-builder` toolbar action |
| Input Manager | Wires to the `input-manager` toolbar action |

### Architecture recommendation for the engine layer

Keep `engine/src/` completely separate from `editor/src/`. The editor communicates with the engine through events:

```js
// Editor fires:
document.dispatchEvent(new CustomEvent('cyco-action', { detail: 'scene-builder' }));

// Engine listens:
document.addEventListener('cyco-action', (e) => {
  if (e.detail === 'scene-builder') SceneBuilder.open();
});
```

This keeps the editor shell decoupled from the engine runtime, so either can be swapped without touching the other.

---

*End of document — Cyco Engine development history.*
