# middle-click pick + sweep + backface-cull + symmetry (2026-06-27)

## Behaviour now (after this change)
- **Middle-click (no drag) in polygon / edge / vertex mode** =
  raycast pick. Replaces the selection with the element under the
  cursor (shift/ctrl → additive toggle).
- **Middle-drag (>= 4 px)** = free-form sweep-select. Samples 8
  evenly-spaced raycasts between the drag start and the current
  cursor; unions every distinct (object, element) pair into the
  selection along the path. NOT a rectangular marquee.
- **Backface Cull toggle** in the toolbar (Misc group; top-bar
  replaces the old "3D Cursor" button). When ON (default) the
  picker skips hits whose world face normal points away from the
  camera. When OFF the picker returns the closest hit as-is.
- **Symmetry dropdown** in the toolbar. Multi-select X / Y / Z
  checkboxes; any combination mirrors the picked element through
  the object's bbox centre (in object-local space). Independent
  of backface cull.

## Files
- `editor/src/CycoModeler/CycleModelerController.js`
  - `_onPointerDown` — middle-button branch now calls
    `_startMiddlePick` instead of `_startElementMarquee`.
  - `_onPointerMove` — new branch for `_middlePick`.
  - `_onPointerUp` — new branch terminates `_middlePick`.
  - `_startMiddlePick`, `_updateMiddleSweep`, `_pickBestHit`,
    `_pickKey`, `_applyMiddlePick` — new methods.
  - `_expandSelectionWithSymmetry`, `_faceLocalCentroid`,
    `_findClosestFaceByCentroid` — symmetry helpers.
  - `_onBackfaceCullToggle`, `_onSymmetrySet` — toolbar events.
  - `_modelerHitFromEvent` — short-circuits to closest hit when
    `_backfaceCull === false`.
- `editor/src/panels/CenterPanel.js`
  - `MODELER_GROUPS.misc` — "3D Cursor" replaced with
    `backface-cull` and `symmetry` entries.
  - `TOOL_MODES['backface-cull']`, `['symmetry']` — both `null`
    (mode-unrestricted).
  - Per-item click handler in `_buildContent`'s misc loop routes
    `backface-cull` → `_toggleBackfaceCull` and `symmetry` →
    `_openSymmetryDropdown` (instead of `_selectModelerTool`).
  - Top-bar mini-buttons in `_buildModelerToolbar` — "3D Cursor"
    entry replaced with Backface Cull toggle + Symmetry
    dropdown trigger.
  - `_refreshModelerButtons` — picker-policy active-class is
    driven by POLICY STATE (`_backfaceCull`, `_symmetryAxes`)
    rather than which button was last clicked.
- `editor/src/CycoModeler/Icons/Icon_Misc_BackfaceCull.png` —
  new icon (solid front face + dashed back face).
- `editor/src/CycoModeler/Icons/Icon_Misc_Symmetry.png` — new
  icon (solid left polygon + dashed right polygon + dashed
  vertical symmetry line).
- `tools/test-middle-click-pick.mjs` — regression test
  (replaces `tools/test-middle-click-marquee.mjs`).

## Notes for future work
- The rectangle marquee path (`_startElementMarquee`,
  `_updateElementMarqueePreview`) is still bound to LEFT button
  drag in element mode — unchanged. Mid button no longer drives
  it.
- Symmetry's mirror lookup finds the closest face/edge/vertex
  by centroid distance — fine for boxes and most convex meshes,
  but for highly non-symmetric topology (e.g. subdivided with
  cuts) the "mirror" may not be the geometrically parallel face.
  A future improvement would match by topology: find the face
  whose vertex index set is the mirror of the picked face's
  vertex index set across the object's symmetry plane.
- Both policy toggles are session-only. To persist them, save
  to localStorage / project file in a follow-up.
