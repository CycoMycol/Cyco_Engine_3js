# Multi-Select Gizmo (Simplified)

**Status:** Implemented 2026-06-19.

## Final Behavior

When 2+ objects are selected, the TransformControls gizmo attaches to a virtual
`_multiGroup` Object3D positioned at the centroid of the selection. The gizmo's
full delta is applied to every selected object as one rigid cluster — same
translate / rotate / scale the user produces, applied to all targets in unison.

| Tool      | Multi-select behavior                                       |
|-----------|-------------------------------------------------------------|
| Move      | All objects translate by the same delta.                    |
| Rotate    | All objects rotate around their own pivots. Positions stay. |
| Scale     | All objects scale around their own pivots. Positions stay. |
| Box Tool  | Same delta matrix replayed on every target.                 |

## UI Removed

- Multi-box outline (the green bonding-box around the cluster).
- Combined/Individual tabs in the Properties panel.
- Multi-Mode Pivot toggle button in the right-viewport toolbar.
- Per-object pivot indicator crosses.
- `setMultiMode` / `getMultiMode` runtime API on `TransformGizmo`.
- The `_multiMode`, `_multiBoxGroup`, `_pivotIndicators` fields and all related
  CSS classes (`ce-props-multi-pivot-row`, `ce-props-multi-pivot-toggle`, etc.).

## Files Touched

- `editor/src/viewport/TransformGizmo.js` — core multi-transform logic.
- `editor/src/panels/RightViewportPanel.js` — toolbar pivot button removed.
- `editor/src/panels/RightPanel.js` — pivot tabs removed.
- `editor/src/theme/cyco-theme.css` — dead pivot CSS removed.

## Implementation Notes

- The Box tool's drag handlers (`_updateTranslate`/`_updateRotate`/`_updateScaleAxis`)
  modify `this._targetObject` (which is the virtual `_multiGroup` in multi-select).
  `_updateInteraction` now calls `_applyMultiFromCurrentGroup()` so the same delta
  is replayed on every target — same path TransformControls drag uses.
- `_applyMultiFromCurrentGroup()` calls `targetObject.updateMatrixWorld(true)` first,
  because Box-tool handlers mutate `position`/`quaternion`/`scale` directly without
  refreshing the world matrix; without this flush the delta would always be zero.
- `_applyMultiMatricesFromGroupDelta` applies the gizmo's full rigid delta to
  every target — no per-component decomposition (no "individual" branch any more).
- Undo / redo on Box-tool multi-drag snapshots every target's pre/post matrix.
