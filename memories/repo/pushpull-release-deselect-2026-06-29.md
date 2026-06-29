# Push/Pull release-deselects polygons (camera-angle dependent) — 2026-06-29

## Bug

User report: "When I middle-click to select 6 polygons on a sphere, then
left-click and drag to push/pull, when I release the mouse button SOMETIMES
the polygons become deselected, depending on the camera angle."

## Root Cause

`CycleModelerController._onClick` runs on the synthetic `click` event the
browser fires after a left-button `pointerup`. The handler unconditionally
rebuilds the modeler element selection from whatever the raycast hits at
the click position — it does NOT check whether a push/pull face-drag just
completed.

The previous `_onPointerUp` (file:
`editor/src/CycoModeler/CycleModelerController.js`, `_faceDrag` branch)
cleared the `__cyco._suppressSelectionManagerClick` flag (which guards
the object-level `SelectionManager`) but never set `this._suppressNextClick`
(which guards `_onClick` on the modeler side). The element-marquee branch
already does set `this._suppressNextClick`; the face-drag branch did not.

So after a successful push/pull drag:
- The selection was intact on pointerup.
- The browser fired `click` on the same canvas position.
- `_onClick` raycast that position against the modeler object.
- **If the click raycast HIT a polygon on the sphere**, the non-additive
  `else: modeler.selectedFaces = selection.faces;` branch in `_onClick`
  REPLACED the multi-selection with the single polygon at the release
  point.
- **If the click raycast MISSED the sphere** (the release cursor was over
  empty space — common at oblique camera angles), `_onClick` early-returned
  and the multi-selection accidentally survived.

That camera-angle dependency is exactly the symptom the user observed.

## Fix

`editor/src/CycoModeler/CycleModelerController.js`, in the `_faceDrag`
branch of `_onPointerUp` (right after `_refreshSelectionOverlay()` and
before `return`): set `this._suppressNextClick = true` and defer the
clear to the next animation frame, mirroring the existing
element-marquee pattern.

```js
// Suppress the synthetic `click` event the browser fires after this
// pointerup. Without this guard, `_onClick` runs against the polygon
// under the release cursor and REPLACES the multi-selection (or
// single-face selection) with just that one polygon — the user reports
// "the polygons become deselected when I release, depending on camera
// angle." (The deselect is camera-angle-dependent because the click
// only wipes the selection when the release cursor raycasts a polygon
// on the modeler object; at angles where the cursor ends up off-mesh
// the click raycast misses and the selection accidentally survives.)
// Defer the clear to the next frame so the browser-dispatched click
// consumes the flag, then it's reset for the next genuine user click.
// (Same pattern as the element-marquee branch below.)
this._suppressNextClick = true;
requestAnimationFrame(() => { this._suppressNextClick = false; });
```

The right-button drag does NOT trigger this bug: `event.button !== 0`
in `_onClick` filters it out, and the browser fires `contextmenu` (not
`click`) for the right button. Only left-drag needs the fix.

## Verification

`node --check editor/src/CycoModeler/CycleModelerController.js` → 0.
