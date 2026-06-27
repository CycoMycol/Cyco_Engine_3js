# middle-click multi-select fix (2026-06-27)

## Bug
In cycle-modeler polygon / edge / vertex mode:

- **Middle-click drag** swept the picker along the cursor path but
  each sweep sample **replaced** `modeler.selectedFaces` (and edges /
  vertices) with only the latest sample. As the cursor dragged across
  multiple polygons, the visible selection collapsed to only the
  *last* polygon under the cursor — so on release the first
  polygon(s) appeared "unselected".
- **Separate middle-clicks** in polygon mode (no drag) also
  *replaced* the selection, so the user could not accumulate
  multiple polygons across clicks without holding shift/ctrl.

## Root cause
`_applyMiddlePick` in
`editor/src/CycoModeler/CycleModelerController.js` had two branches
per element mode:

```js
if (additive) {
  modeler.selectedFaces = this._toggleArray(modeler.selectedFaces, selection.faces);
} else {
  modeler.selectedFaces = selection.faces;   // ← WIPES earlier picks
}
```

The non-additive branch is fine for left-click single-pick (which
intentionally re-anchors the selection) but wrong for the middle-click
multi-select gesture: each sweep sample re-anchors and wipes the
accumulated selection.

`_toggleArray` itself only supported XOR toggle semantics — there was
no way to express "add without removing".

## Fix
- `_toggleArray(existing, incoming, replace = true)` now takes a
  third `replace` flag. When `replace === false`, items are unioned
  in (no removal). Default `true` preserves the existing click-toggle
  semantics for callers like `_onClick`.
- `_applyMiddlePick` now passes `!additive` as the `replace` flag:
  - Bare middle-click / sweep (no modifier) → union mode → every
    pick accumulates.
  - Shift / ctrl held → toggle mode → the hit toggles in / out
    (the `_middlePick.visited` set keeps sweep samples from
    re-flipping the same element).
- Added `this._status(this._elemMarqueeSummary())` at the end of
  `_applyMiddlePick` so the user sees the multi-select count grow
  live during a sweep, not just on pointerup.

## Visual confirmation (CycoModeler)
After reload of the editor with a sphere modeler object, a single
middle-click in polygon mode added a second adjacent polygon to the
already-selected one — visually two red polygons highlighted side by
side on the sphere, instead of the pre-fix behaviour where the first
polygon "unselected" on release.

## Files
- `editor/src/CycoModeler/CycleModelerController.js`
  - `_toggleArray` — added `replace` parameter.
  - `_applyMiddlePick` — uses `!additive` as `replace`; calls
    `_status` for live count.
  - Comment in `_startMiddlePick` updated to describe the
    multi-select (union) semantics vs the toggle modifier.
- `tools/test-middle-click-pick.mjs`
  - Fixed a stale Node WebSocket parsing bug (the message event
    handler was trying to `JSON.parse` a MessageEvent object — now
    reads `event.data`).
  - Added PART 4b: two separate middle-clicks must KEEP the first
    polygon selected (accumulates).
  - Added PART 4c: a middle-drag sweep must accumulate >= 2 polygons
    under the cursor path, not replace on each sample.

## Unchanged behaviour
- Left-click single-pick (re-anchor): unchanged. Still wipes the
  selection; shift/ctrl toggles.
- Middle-click sweep with backface-cull off: unchanged. Still picks
  closest hit; sweep still samples the path; mirror symmetry still
  applies.
- `_middlePick.visited` set: unchanged. Keeps sweep samples from
  re-applying the toggle.
- `_onClick`: unchanged. Still ignores `event.button !== 0`, so the
  browser's synthetic `click` after a middle-button release does not
  fire and overwrite the multi-pick.