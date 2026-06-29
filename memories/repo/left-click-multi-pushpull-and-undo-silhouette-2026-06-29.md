# Left-click push/pull + undo silhouette + backface default — 2026-06-29

Three regressions / config tweaks reported by user. All fixed in
`editor/src/CycoModeler/CycleModelerController.js` and
`editor/src/panels/CenterPanel.js`.

## Bug #1 — Left-click multi push/pull highlight didn't follow the polygons

Right-click multi-push/pull was already fixed to refresh the overlay
per-frame (see `right-click-multi-pushpull-fixes-2026-06-29.md`),
but the left-click branch in `_onPointerMove` only refreshed on
`rightButton`, not on multi. Result: during a left-drag the
geometry preview updated, the polygons moved, but the pink
highlight stayed anchored at the original selection site.

**Fix**: changed the guard in `_onPointerMove` from
`if (this._faceDrag.rightButton)` to `if (this._faceDrag.multi)`
so both right- and left-drag multi-push refresh the overlay every
pointermove. Verified: pink highlight now rides the polygons during
both left- and right-drag.

## Bug #2 — Undo of a pull left a "silhouette" highlight

After Ctrl+Z the mesh reverted to the pre-pull state, but the
selection overlay kept drawing on the extruded positions because
the overlay-rebuild only ran in the click / push / marquee paths,
not in `cyco-history-change`. User saw a "ghost" highlight floating
in space until they clicked elsewhere.

**Fix**: added a `cyco-history-change` listener on the modeler
controller (`_onHistoryChange`) that calls
`this._refreshSelectionOverlay()` after every command execution /
undo / redo. Single hook covers all three cases without
scattering `_refreshSelectionOverlay()` calls into every `undo()`
closure.

## Config — Backface Cull default OFF

Previously `_backfaceCull = true` on both `CycleModelerController`
and `CenterPanel` (mirrored). The toolbar button therefore started
highlighted and the picker skipped back-faces — confusing for first-
time users who couldn't click polygons on the far side of a sphere.

**Fix**: default both to `false`. The toolbar button now starts
unhighlighted; the picker "sees through" both sides; the user can
still toggle it ON if they want the UModeler-style "only pick what
you're looking at" behavior.

## Verification (browser-driven via shared editor tab)

| Stage | backfaceCull button | overlay behavior |
|---|---|---|
| App load | not active (default OFF) | n/a |
| Mid left-drag | n/a | highlight rides polygons |
| Ctrl+Z after push/pull | n/a | polygons revert AND highlight reverts, no ghost |

Right-click drag unchanged (still works as documented in
right-click-multi-pushpull-fixes-2026-06-29.md).