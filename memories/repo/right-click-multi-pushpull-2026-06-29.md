# Right-click-drag = multi push/pull on polygon selection (2026-06-29)

## Change

Right-button drag over a modeler object in the cycle modeler, while
the push/pull (or multi-push/pull) tool is active AND a multi-selection
exists, now performs a multi-push/pull extrusion: each selected polygon
extrudes along its OWN face normal at the same world distance.

A bare right-click (no drag) still shows the native viewport context
menu. Left-click behavior is unchanged.

## Why

Multiple selected polygons on a single object previously snapped /
collapsed because `_groupCoplanarFaces` partitioned by `faceGroup` ID.
Opposite-facing walls shared a face group (because they were
constructed together when the primitive was created), so they were
extruded as one slab with an averaged normal that collapsed to zero.

The user wanted the UModeler / SketchUp behavior: each selected
polygon slides along its own axis at the same world distance — not
combined, not snapped.

## Files

- `editor/src/CycoModeler/CycleModelerController.js`
  - `_groupCoplanarFaces`: now groups by unique rounded face-normal
    direction (~1°), not by `faceGroup` ID.
  - New `_beginFaceDrag(event, hit, forceMulti)` helper extracted
    from `_onPointerDown`.
  - `_onPointerDown`: when `button === 2`, the push/pull-style
    tool is active, and there's an element selection, calls
    `_beginFaceDrag(..., forceMulti = true)` to begin a multi drag
    without seeding/replacing the selection from the hit face.
  - `_onPointerMove`: the early-out for right-button-held now
    bypasses when an active `_faceDrag` (right-drag) is in progress,
    so the multi-push/pull preview updates as the user drags.

## Out of scope (unchanged)

- Left-click push/pull behavior.
- Viewport context menu on no-drag right-click.
- Middle-button pan / orbit / context-menu window drag suppression.

## Verify

- `node --check editor/src/CycoModeler/CycleModelerController.js` → 0.
- Existing `tools/test-multi-pushpull-marquee.mjs` and
  `tools/test-pushpull-bugs.mjs` exercise the left-click multi path
  (untouched by this change) — should still pass.
