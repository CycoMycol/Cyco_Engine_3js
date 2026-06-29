# Right-click multi push/pull — four follow-up fixes (2026-06-29)

After landing right-click-drag = multi push/pull
([right-click-multi-pushpull-2026-06-29.md](right-click-multi-pushpull-2026-06-29.md)),
the user reported four regressions on the same gesture. All four are now
fixed in
`editor/src/CycoModeler/CycleModelerController.js` plus a small contextmenu
suppression in `_attachCanvas`.

## Bug #1 — Highlights didn't follow the pushed faces during drag

While multi-push was active the geometry preview updated per-frame
(via `_applyMultiPushPreview` rewriting `userData.cycoModeler.mesh`),
but the selection overlay (`_selOverlay`) was only rebuilt at drag
start and pointer-up. The ribbons sat on the original (pre-push)
positions.

**Fix**: call `this._refreshSelectionOverlay()` after every
`_applyMultiPushPreview` in `_onPointerMove`. The overlay reads
`obj.userData.cycoModeler.mesh`, which is the live previewed mesh,
so a per-frame refresh makes the ribbons follow each pushed face
along its own normal.

## Bug #2 — Faces snapped together on release

The preview path partitioned by face-normal (using
`_groupCoplanarFaces`) so each pushed face moved along its own axis,
but the commit path in `_onPointerUp` called `mesh.pushFaces(faces,
delta)` once with the FULL `selectedFaces` list — which collapsed
opposing walls into an averaged normal.

**Fix**: the multi-commit map now runs the SAME per-normal grouping
(`for (const grp of groups) mesh.pushFaces(grp, delta)`) so the
committed mesh stays per-axis just like the preview. Verified: 4
distinct delta vectors per face (was 1 prior to fix).

## Bug #3 — Context menu popped up after right-drag release

Browser auto-dispatches `contextmenu` immediately after pointerup on
the right button. The viewport's own contextmenu listener then
showed the menu.

**Fix**:
1. New `_onContextMenuCapture` capture-phase listener on the canvas
   that suppresses the menu if `this._suppressNextContextMenu` is
   set.
2. Right-drag pointerup with a non-trivial delta flips the flag.
3. `_attachCanvas` mounts the listener; the bare right-click
   path (no drag, no commit) leaves the flag false, so the menu
   still shows.

Verified: right-drag release → no menu; bare right-click → menu
shows (Cyco Modeler Settings, Focus, Duplicate, Delete).

## Bug #4 — Second right-drag no-op, had to deselect/reselect

Was a downstream symptom of #2. While the commit collapsed faces
into a single slab, the second right-drag's raycast hit a face
that no longer matched the saved `selectedFaces` indices, so no
extrusion showed. Fixing #2 alone resolves it.

## Verification (browser-driven, via shared editor tab)

| Stage | uniqueDeltas | faces count | status |
|---|---|---|---|
| Before fix | 1 (snap) | 288 → 300 | — |
| After fix #2 | 4 | 288 → 320 | "Push/pull applied (4 elements)" |
| 2nd right-drag | 4 | 320 → 336 | — |
| Left-drag (unchanged) | — | 352 → 372 | "Push/pull applied (5 elements)" |

Also verified the highlight follows the move during drag by sampling
unique Y values in the overlay while the gesture was live —
multiple Y buckets present (was a single bucket before fix #1).

## Out of scope

- Left-click push/pull behavior (untouched).
- Bare right-click context menu (still works).
- Tooltip / status text adjustments.
