# Cycle Modeler Tool → Element-Mode Mapping (2026-06-26)

## Architecture
- Topbar element-mode buttons: `Object | Vertex | Edge | Polygon` — built by `_buildModelerTopbar()` in `editor/src/panels/CenterPanel.js`.
- Tool groups + tools: `MODELER_TOOLS` constant in same file.
- Each tool button has `data-modeler-kind="tool"` + `data-modeler-id="<id>"`.
- Each element button has `data-modeler-kind="element"` + `data-modeler-id="<mode>"`.
- Mode changes dispatch `cyco-modeler-element`; tool clicks dispatch `cyco-modeler-tool`.
- `CycleModelerController` listens to both events and owns `elementMode`.

## Mode-mapping rules (TOOL_MODES in CenterPanel.js)
- `'object'` — primitives, drawing, mirror-object, combine-objects, boolean. Only enabled when `elementMode === 'object'`.
- `'polygon'` — push-pull, multi-push-pull, inset, subdivide, flip, flatten, align, axis-flip, eraser, clip, detach, polygon-color, polygon-group, hotspot-layout, smoothing-group, combine-polygons.
- `'edge'` — extrude-edge, bevel, loop-slice, bridge, loop-select, ring-select, cut, collapse, combine.
- `'vertex'` — combine-vertices, remove-doubles, vertex-color.
- `'all'` — clone, duplicate, mirror, snap-move, all selection ops, material, uv, etc.
- `null` — system actions (snap, settings, confirm, cancel, uv-editor). Always enabled.

## UX behaviour
- Tools bound to a specific mode are **visually greyed out** (`.disabled` class + `aria-disabled="true"`) when current mode doesn't match. Cursor stays `pointer` (clickable).
- Clicking a greyed-out tool **auto-activates** its required mode (via `_selectModelerTool` → `_selectModelerElement`). This dispatches `cyco-modeler-element` and updates everything.
- Active element-mode button itself is greyed out (current selection, not a tool to invoke).
- CSS for disabled state: `opacity: 0.32`, `filter: grayscale(1)`, muted text — defined in `editor/src/theme/cyco-theme.css`.

## Key files
- `editor/src/panels/CenterPanel.js` — UI + `TOOL_MODES` map + `_selectModelerTool` auto-activate.
- `editor/src/CycoModeler/CycleModelerController.js` — owns `elementMode`, listens to events.
- `editor/src/theme/cyco-theme.css` — `.cyco-modeler-icon-btn.disabled` style.