# Wireframe Ribbon Fix (2026-06-28) — Initial Frame + No Back-Face Culling

## Regression

User reported that wireframes were not visible on first paint — they only
"appeared" as the camera orbited. Also: parts of the wireframe would
disappear and reappear as the user rotated around the object, leaving
visible gaps.

## Root cause (2 bugs)

**Bug 1 — initial build used a degenerate world-axis fallback.**
`_buildFatEdges` called `_expandEdgesToRibbon(..., /* initial */ true)`
on the first build. With `initial=true`, every segment fell back to a
world-axis perpendicular (`cross(dir, AXES[a])`). On ring segments this
cross product collapses to a sliver or jumps discontinuously between
adjacent segments, producing a ribbon that is invisible at first paint.
The `onBeforeRender` callback was supposed to swap it for a view-aligned
ribbon on the next frame, but the cached parent matrix was already the
correct world matrix (force-set during `_buildFatEdges`), so the early
return `camMat.equals(cachedCamMatrix)` could short-circuit and skip
the rebuild if the camera hadn't moved between frames.

**Bug 2 — back-face culling removed far-side segments.**
`_expandEdgesToRibbon` had a block that checked each segment's adjacent
face normals and skipped the segment if **all** of them pointed away
from the camera. This was added earlier to prevent back-side ribbon
perpendiculars from poking out at the silhouette. The cost: every frame,
as the camera orbited, ~half the sphere's wireframe segments would be
culled at any given angle, then un-culled as the camera rotated — exactly
the "wireframe disappears as you rotate" symptom.

## Fix

1. `_buildFatEdges` now force-updates the parent's world matrix
   (`parent.updateWorldMatrix(true, false)`) before building the initial
   ribbon, then calls `_expandEdgesToRibbon` with `initial=false`. The
   first ribbon is now properly view-aligned and visible on the very
   first paint.
2. `_wireInputs._needsFirstRebuild = true` is set in userData. The
   `onBeforeRender` callback short-circuits only when both matrices
   match **and** `_needsFirstRebuild` is false. This guarantees one
   rebuild happens regardless of matrix-cache hits.
3. Back-face culling removed entirely from `_expandEdgesToRibbon`. All
   segments get a ribbon quad. The view-aligned perpendicular naturally
   flattens ribbons on segments perpendicular to the camera (so they
   read as thin lines on the silhouette, not flaps), but no segments
   are dropped.
4. The `_initial` parameter is kept in the signature (renamed to
   `_initial`) for backwards compatibility but no longer affects the
   math.

## Code locations

`editor/src/CycoModeler/CycleModelerController.js`:

- `_buildFatEdges` (line ~847): force-update parent world matrix, pass
  `initial=false`, add `_needsFirstRebuild` flag.
- `_expandEdgesToRibbon` (line ~1009): removed `segFaceNormals` cull
  block, removed `_initial` branches in favor of always view-aligned.
- `onBeforeRender` callback in `_buildFatEdges`: gates the early-return
  on `_needsFirstRebuild === false` AND matrix match.

## Verification

Live test in the editor (`page 7fe9f3b6…`):
- Entered modeler mode, programmatically added a sphere.
- Sphere shows full lat/long wireframe on first paint.
- Orbited camera to azimuth 90°, 180°, 270° + elevated 30° — wireframe
  stays continuous, no gaps, no disappearing segments.
- `__cyco._wireRibbonStats.lastBuild` after the orbit: `{segCount: 552,
  skippedView: 0, usedAxisFallback: 0, hasCamera: true}` — every
  segment uses the view-aligned perpendicular, no fallbacks.

## Regression

`tools/test-wireframe-bugs.mjs` still passes (33/33).
`tools/test-ribbon-orbit.mjs` regenerates the orbit test page; counts
match across all 6 angles × 6 primitives.

## Note on the pole "starburst"

The sphere's pole spokes (12 segments converging at the north/south
pole) still produce a small starburst/fuzzy-edge artifact at the pole
silhouette. This is inherent to view-aligned perpendiculars on a pole
geometry and is identical to what `LineSegments2` produces on WebGL.
Acceptable — the wireframe is continuous (no gaps) and matches the
previous 2026-06-27 fix.
