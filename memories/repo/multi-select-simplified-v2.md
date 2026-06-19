# Multi-Select Gizmo

**Status:** Per-component decomposition restored 2026-06-19.

## Behavior

When 2+ objects are selected, the TransformControls gizmo attaches to a
virtual `_multiGroup` Object3D positioned at the cluster centroid. The
gizmo's delta is decomposed into translate / rotate / scale and only the
component matching the active tool is applied to each target — every
object scales / rotates around its own local pivot (positions
preserved). Translate moves every target by the same delta.

| Tool               | Multi-select behavior                                         |
|--------------------|---------------------------------------------------------------|
| Move (translate)   | All targets translate by the same delta.                      |
| Rotate             | Each target rotates around its own pivot. Positions stay put. |
| Scale              | Each target scales around its own pivot. Positions stay put.  |
| Box Tool           | Each handle (move/rotate/scale) uses the matching local-pivot mechanics. |

## UI Removed

- Multi-box outline (green bonding-box around the cluster).
- Per-object pivot indicator crosses.
- Combined/Individual tabs in the Properties panel.
- Multi-Mode Pivot toggle button in the right-viewport toolbar.
- `setMultiMode` / `getMultiMode` runtime API on `TransformGizmo`.
- `_multiMode`, `_multiBoxGroup`, `_pivotIndicators` fields and the
  pivot-related CSS classes (`ce-props-multi-pivot-row`, etc.).

## Implementation Notes

- `_applyMultiMatricesFromGroupDelta` decomposes the delta once and
  applies ONLY the component matching the active tool to each target:
  - `translate`/`universal` → `applyTranslate = true` (deltaPos added to every pivot)
  - `rotate`/`universal`    → `applyRotate = true` (deltaQuat premultiplied on every rot)
  - `scale`/`universal`     → `applyScale = true` (deltaScale multiplied onto every scale)
- `universal` mode activates all three so the Box-tool handles can use
  the same per-component mechanics as the dedicated tools.
- Without per-component decomposition, a pure 2x scale on the virtual
  centroid group decomposes into deltaPos = (-origin.x, 0, 0) which when
  composed onto every target would teleport them across the scene.
- Box-tool handlers (`_updateTranslate` / `_updateRotate` /
  `_updateScaleAxis`) modify `this._targetObject` (the virtual
  `_multiGroup`) directly.  `_updateInteraction` calls
  `_applyMultiFromCurrentGroup()` to replay the delta onto every target.
- `_applyMultiFromCurrentGroup` calls `targetObject.updateMatrixWorld(true)`
  before reading `targetObject.matrix`; Box-tool handlers don't refresh
  the world matrix on their own.

## Move aggressiveness fix (2026-06-19)

**Bug:** Multi-select Move translated the cluster by a factor of N× the
pointer drag, where N = the number of cumulative `change` events during
the drag. The cluster "flew off the scene" and resisted being dragged
back.

**Root cause:** `_matrixBefore` was captured once at `mouseDown` and never
updated. Each `tc.change` event recomputed
`delta = after * matrixBefore^-1`, which is the cumulative drag offset
from drag-start. My code then added that to each target's pivot — but
the pivot had ALREADY been advanced in previous frames, so each frame
the cumulative offset was applied on top of the already-advanced pivot.
Result: a 10-unit drag produced 10 + 10 + 10 + ... = 10N units of motion.

**Fix:** Two distinct snapshot arrays:

- `_multiPivots` / `_multiRots` / `_multiScales` — the *live* per-frame
  state, mutated by `_applyMultiMatricesFromGroupDelta` so the next
  frame's decomposition starts from the just-applied position.
- `_multiDragStartPivots` / `_multiDragStartRots` / `_multiDragStartScales`
  — *frozen* at `mouseDown`, used exclusively for the undo command.
- `_multiLastAppliedMatrix` — the multiGroup matrix after the previous
  frame's delta was applied. `_applyMultiFromCurrentGroup` computes
  `delta = currentMatrix * lastApplied^-1` so each frame's delta is
  incremental (matches pointer motion exactly).

Also removed the redundant `_applyMultiMatricesFromGroupDelta(before, after)`
re-application on `mouseUp` — the targets are already sitting at the
correct final transforms (each frame moved them incrementally), so
re-applying the drag-start delta would have teleported them again.
The undo snapshot now uses `_multiDragStartPivots` directly.

**Verification:**
- Per-frame Move drag tracks 1:1 (100-px cumulative pointer drag →
  100-px cumulative multiGroup translation → 100-px cumulative cube
  translation).
- Scale 2.5x: positions preserved, scales = 2.5.
- Rotate 0.785 rad: positions preserved, rotations = 0.785.
- Undo restores to pre-drag positions; redo restores to post-drag
  positions.

## Scale jerk fix (2026-06-19)

**Bug:** Multi-select Scale gizmo made each target's scale shrink while
the user dragged it bigger (visible jitter).

**Root cause:** `_applyMultiMatricesFromGroupDelta` updated
`_multiPivots[i]` per-frame so the next frame's translate delta
accumulated — but it did NOT update `_multiScales[i]`. The per-frame
`deltaScale = afterScale / beforeScale` (a ratio in (1, s/b]) was
multiplied onto the stale `multiScales[i] = (1,1,1)` every frame, so
the cube scale moved toward 1 instead of tracking the multiGroup.

**Fix:** One-line — assign `this._multiScales[i] = newScale` at the
bottom of the apply loop so the next frame multiplies onto the live
scale. Rotate accumulation is intentionally left as-is (per user
direction — only fix the scale gizmo).

## Centroid anchor for non-translate tools (2026-06-19)

**Bug:** Scale / Rotate gizmos would also drift the cluster centroid
across frames even with correct scale accumulation.

**Root cause:** `T(c)*S(b)` (multiGroup transform when scaling around
centroid `c`) decomposes to `T(c + (b-1)*c) * S(b)`. The bogus
`deltaPos` term, if applied to each pivot, translated every target
toward / away from origin and the centroid drifted each frame.

**Fix:** Zero `deltaPos` in the per-frame decompose whenever the active
tool is not pure translate, so the centroid stays anchored for scale
and rotate. Translate is unchanged.
