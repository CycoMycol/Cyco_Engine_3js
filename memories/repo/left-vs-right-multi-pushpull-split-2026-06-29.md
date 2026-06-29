# Left-click vs right-click multi push/pull — split commit + preview (2026-06-29)

## Context

After landing `right-click-multi-pushpull-2026-06-29.md` (right-drag =
per-face-per-normal extrusion) and `right-click-multi-pushpull-fixes-2026-06-29.md`
(four follow-up bug fixes), my second-pass fix inadvertently gave
LEFT-drag the same per-face partitioning as right-drag. The user
explicitly wants the two gestures to behave differently:

- **LEFT-drag** on a multi-selection = drag the SELECTED GROUP AS ONE
  CONNECTED MASS. Every selected face moves by the same offset along
  the AVERAGE normal of the selection. This is the legacy "drag a
  multi-selection together" feel — opposing walls on a sphere
  collapse toward the average, which is exactly what the user
  expects.
- **RIGHT-drag** on a multi-selection = extrude EACH selected polygon
  ALONG ITS OWN outward normal. Opposing walls move in opposite world
  directions. UModeler / SketchUp parity.

## Files

- `editor/src/CycoModeler/CycleModelerController.js`
  - `_applyMultiPushPreview`: branch on `drag.rightButton`. Right →
    per-normal partition (`_groupCoplanarFaces`). Left → single slab
    (`mesh.pushFaces(faces, distance)`).
  - `_onPointerUp` multi-commit: same branch. Right → per-normal
    groups; left → single slab.
  - `_onPointerMove` overlay refresh: gated on `drag.rightButton`.
    Left-drag no longer rebuilds the overlay every frame (intentional:
    the highlight stays anchored at the original selection site so
    the "dragging as one" feel reads correctly).

## Verification

Same shared browser tab.

| Stage | uniqueDeltas | faces count | status |
|---|---|---|---|
| After sphere + middle-sweep 5 polys | — | 288 | "Selected: 5 polygons" |
| **LEFT-drag** | **1** (all identical) | 288 → 300 | "Push/pull applied (6 elements)" |
| **RIGHT-drag** | **6** (each on own axis) | 300 → 324 | "Push/pull applied" |

Right-drag also flipped `_suppressNextContextMenu = true` so the
context menu doesn't pop on a real drag release (carry-over from the
previous fix pass — still working).

## Out of scope

- Single-face push/pull behavior.
- Hover / marquee / middle-sweep.
- Bare right-click context menu.
