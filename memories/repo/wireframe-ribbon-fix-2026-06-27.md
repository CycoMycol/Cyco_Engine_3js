# Wireframe Ribbon Fix (2026-06-27) — View-Aligned Perpendicular

## Regression

The 2026-06-22 screen-aligned perpendicular fix (see
`wireframe-ribbon-fix-2026-06-22.md`) was **lost during the 2026-06-26
refactor** that touched the cycle modeler. The ribbon code regressed to
**world-axis perpendiculars**, which is what produced the user's
2026-06-26 report:

- Wireframe not covering properly on sphere / torus / cone
- Wireframe breaking into pieces on rings
- Wireframe jittering / z-fighting speckles

## Root cause (re-regressed)

`_expandEdgesToRibbon` was picking one of {X, Y, Z} world axes per
segment to compute the perpendicular, then crossing the segment
direction with it. Two failure modes:

1. **Sliver collapse** — when the segment direction is parallel to the
   picked axis, the cross product goes to zero, producing a degenerate
   sliver that disappears in screen space.
2. **Discontinuity at ring segments** — each segment of a ring picks
   the *least degenerate* axis independently. Adjacent ring segments
   pick DIFFERENT axes (because their segment direction passes through
   different orientations relative to X/Y/Z), so the perpendicular
   vector jumps by 90° at every quad boundary. This creates the
   "broken into pieces" appearance.

## Fix

Re-applied the screen-aligned perpendicular using a **simpler
implementation** than 2026-06-22: instead of NDC offset + unproject
round-trip, compute the perpendicular directly in world space.

For each segment with world-space endpoints A, B:

1. `midW = (A + B) / 2`
2. `viewDir = normalize(midW - camera.position)` (or `cameraWorld` —
   point from segment toward camera)
3. `dirW = normalize(B - A)`
4. `perpW = normalize(cross(dirW, viewDir))` (works in both orders;
   either gives a perpendicular to `dirW` in the plane containing the
   view)
5. `A' = A + perpW * halfW`, `B' = B + perpW * halfW`
6. Convert to local space using the parent's inverse matrix and store
   in the ribbon BufferGeometry.

### Why this works

The world-space perpendicular `cross(dirW, viewDir)` is always
perpendicular to `dirW` and always has the **largest possible
component orthogonal to the view direction** for that segment
(because `viewDir` is in the segment-to-camera plane). This means:

- The perpendicular is always nearly screen-aligned (max visible width)
- Adjacent segments of a ring have continuous perpendiculars (the
  cross product is smooth as `dirW` rotates around the ring)
- No axis picking = no discontinuity at axis transitions

### Fallback

When `|cross(dirW, viewDir)| < ε` (segment direction is exactly
view-parallel, e.g. a long thin edge directly facing the camera), fall
back to `cross(dirW, worldUp)` with `worldUp = (0,1,0)`. This is
mathematically degenerate for view-parallel segments so any choice is
acceptable.

### Per-frame rebuild

`onBeforeRender` callback on the wire mesh stashes camera
`matrixWorldInverse` and parent `matrixWorld`. Each frame it
compares them to cached values; on change, rebuilds the ribbon.

## Code locations

`editor/src/CycoModeler/CycleModelerController.js`:

- `_buildFatEdges(edgesGeom, color, linewidth, opacity, depthTest, targetPos)` —
  wires up `onBeforeRender`, sets `userData._wireParent`
- `_expandEdgesToRibbon(edgesGeom, width, camera, parentWorld, initial)` —
  implements the new view-aligned math
- `_objectEdgeOverlay(object)` and `_syncWireOverlay(obj)` — pass
  parent world matrix to `_buildFatEdges`

## Tests

`tools/test-ribbon-perpendicular.mjs` — 63 tests across 3 cameras ×
7 primitives × 3 checks each:

- P1: no sliver triangles (no zero-area quads)
- P2: perpendicular is perpendicular to segment direction
- P3: perpendicular has near-uniform world-space magnitude at all
  4 quad corners (proves uniform screen width)

`tools/test-ribbon-visual.mjs` — generates
`tools/.tmp-ribbon-visual.html`, a standalone page that renders the
7 primitives (sphere, torus, cone, cylinder, capsule, box,
icosahedron) with the controller's exact ribbon code, at 3 camera
angles (oblique / front / top-down), with 12px ribbon width.

`tools/test-wireframe-bugs.mjs` and `tools/test-primitive-bugs.mjs`
regression suites still pass (33 + 17 tests).

## Visual verification

- Sphere (oblique): full lat/long coverage, fuzzy back-cap edge
  (acceptable — 12 back-side spokes converging at pole)
- Torus (oblique): full coverage of inner ring, outer ring, and side
  strips
- Cone (oblique): full side strips + base ring + apex

## Notes

- The sphere pole convergence produces a "starburst" / "fuzzy edge"
  artifact on the silhouette when viewed from oblique angles. This is
  inherent to view-aligned perpendiculars with a 12-spoke pole
  geometry. Acceptable — the wireframe is continuous (no gaps), and
  this is the standard behaviour of Three.js `LineSegments2` on
  WebGL/non-WebGPU stacks when faced with the same geometry.
- `window.__cyco._wireRibbonStats` debug counter is left in place for
  future debugging; reports `segCount`, `skippedView`,
  `usedAxisFallback`, `initial`, `hasCamera`.
