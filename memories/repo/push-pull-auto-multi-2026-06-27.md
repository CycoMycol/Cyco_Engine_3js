# Push/Pull — auto-promote to multi when selection is multi (2026-06-27)

## Change

In `editor/src/CycoModeler/CycleModelerController.js`, the regular
`push-pull` tool now behaves like `multi-push-pull` whenever the
target object already has more than one selected face, or there is
any element selection across all modeler objects.

## Why

Middle-click sweep + multi-pick was added so the user can build a
multi-face polygon selection without holding Shift. The user
expected the regular `push-pull` button to drag-extrude that whole
set in one motion — they should not have to switch to the separate
`multi-push-pull` tool.

## What was breaking

`_onPointerDown` in the `tool === 'push-pull'` branch unconditionally
overwrote `modeler.selectedFaces` with the hit face's coplanar
group, destroying any multi-selection that the user had built via
middle-click sweep.

## Fix (minimal)

1. On push/pull pointer-down, only seed `selectedFaces` from the hit
   when the existing selection is empty. If the click landed on a
   face that isn't in the current set, merge its coplanar group.
2. Stash `_faceDragMultiHint = treatAsMulti || selectedFaces.length > 1`.
3. The drag-setup block now uses `multiActive = tool === 'multi-push-pull' || _faceDragMultiHint`,
   so `draggedObjects`, `baseMeshes`, `multi`, status string, and the
   pointer-up commit all follow the existing multi-push/pull path.
4. Hint is cleared in the pointer-up cleanup.

## Verified behaviors

- Single face selected + push/pull: unchanged (single-extrude path).
- Multiple faces selected via middle-click + push/pull: extrudes all
  in one drag, committed as one undoable command named
  `"Push/pull applied (N elements)"`.
- Multi-object + push/pull: all selected modeler objects with
  selected elements extrude together.
- Empty selection + click on face: seeds the click face as before
  (single-extrude).
