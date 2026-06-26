# Subdivide Wireframe Fix (2026-06-26)

## Regression

User reported the wireframe overlay on primitive shapes (specifically
the Subdivide tool on a box) showed only the smooth box silhouette —
no subdivision lines visible. The 3 polygon faces per top/side were
present in the geometry but the wireframe rendered as if the box were
un-subdivided. Same issue when a face was selected: the highlight
showed, but no subdivision wireframe was drawn around neighbouring
faces.

## Root cause

Two compounding bugs in `CycleModelerController._applyDimensions`
(called by Subdivide / Bevel / Resize):

1. **`cycoModeler.mesh` was never rebuilt.** `_applyDimensions`
   replaced `obj.geometry` with a fresh `THREE.BoxGeometry(w,h,d,s,s,s)`
   for `box-subdivided` (or `RoundedBoxGeometry` for `rounded-box`,
   or `EditableMesh.boxFromBounds().toBufferGeometry()` for `box`),
   but the stored `cycoModeler.mesh` JSON still described the
   PREVIOUS geometry. `_syncWireOverlay` reads `cycoModeler.mesh`
   and feeds it into `EditableMesh.toEdgesGeometry(angleThreshold)`,
   so it always drew the OLD outline regardless of what the visible
   geometry actually was.

2. **`toEdgesGeometry(angleThreshold)` culled coplanar subdivision
   edges at threshold 1.** Even after fixing (1), the default
   threshold of 1 degree dropped every internal edge between two
   coplanar subdivided cells (dot product ≈ 1.0). The wireframe
   would still show only the box silhouette.

A related issue surfaced during the fix: the "pole vertex" heuristic
in `toEdgesGeometry` (designed to keep sphere pole spokes visible)
classified EVERY interior vertex of a subdivided face as a "pole"
(vertex touches only coplanar pairs, has ≥ 3 incident edges), which
forced subdivision edges to be emitted even at threshold 0 when they
shouldn't be — a fan-tip check was missing.

## Fix

1. **`EditableMesh.boxSubdivided(width, height, depth, segments)`.**
   New static factory that builds a polygon mesh with the same
   topology as `THREE.BoxGeometry(w,h,d,s,s,s)`. Six faces, each
   split into `s × s` quad cells (each cell = own `faceGroup` for
   per-cell push/pull). Vertices allocated per-face (no cross-face
   sharing) so adjacent subdivided cells on the same face have the
   same vertex indices and the angle-threshold edge-dedup works
   naturally.

2. **`_geometryFromDimensions` now returns `{ geometry, mesh }`.**
   For `box-subdivided` and `box`, the `mesh` is the EditableMesh
   that produced the BufferGeometry. For `rounded-box`, `mesh` is
   null (RoundedBoxGeometry's triangulation doesn't map cleanly to
   a polygon mesh — wireframe falls back to `THREE.EdgesGeometry`).

3. **`_applyDimensions` writes the new mesh JSON to
   `cycoModeler.mesh`.** This fixes the user's bug AND keeps
   face-selection / push-pull state correct (those read the same
   JSON via `_faceIndicesFromHit`).

4. **`_syncWireOverlay` and `_objectEdgeOverlay` call
   `toEdgesGeometry(0)`.** Threshold 0 = "emit every polygon edge"
   (including coplanar subdivision lines). Sphere poles still draw
   correctly because non-coplanar face boundaries are always emitted
   regardless of threshold.

5. **Tightened pole heuristic.** A vertex is now a "pole" only if
   it sits at the SAME array index inside every incident face (true
   fan tip — e.g. a sphere's north pole appears as `face[0]` of
   every cap triangle). A subdivided box's face-interior vertex
   appears at index 0, 1, 2, 3 across its four neighbouring cells —
   not a fan tip, so NOT classified as a pole, so its subdivision
   edges are emitted only when explicitly requested.

6. **`toEdgesGeometry(angleThreshold=0)` correctly emits everything.**
   Previously the check `dot < cosThreshold` evaluated to
   `1 < 1` → false even at threshold 0, so threshold 0 silently
   dropped coplanar edges. Fixed: treat `angleThreshold <= 0` as
   "always emit".

## Code locations

- `editor/src/CycoModeler/EditableMesh.js`: new
  `boxSubdivided(w, h, d, s)` static; tightened pole heuristic in
  `toEdgesGeometry`; threshold-0 fix.
- `editor/src/CycoModeler/CycleModelerController.js`:
  `_applyDimensions` now rebuilds `cycoModeler.mesh`;
  `_geometryFromDimensions` returns `{ geometry, mesh }`;
  `_syncWireOverlay` and `_objectEdgeOverlay` use threshold 0;
  `_modelerHitFromEvent` and the gizmo cleanup iterates any
  modeler object (not just those with `mesh` set).

## Verification

- `tools/test-boxsubdivided.mjs` — 11 assertions on topology,
  winding, edges at threshold 0/1, faceGroup uniqueness.
- `tools/test-subdivide-wireframe.mjs` — 5 assertions: subdivisions
  appear in wireframe; triangle count matches THREE.BoxGeometry;
  faceGroup isolation; JSON round-trip preserves topology.
- `tools/test-subdivide-integration.mjs` — 6 assertions reproducing
  the user-reported flow end-to-end (initial box → subdivide →
  verify wireframe shows subdivisions).
- `tools/test-primitive-bugs.mjs`, `tools/test-wireframe-bugs.mjs`,
  `tools/test-pushpull-bugs.mjs` — all still pass (no regression).

## Side note

`_applyDimensions` now clears `selectedFaces`, `selectedEdges`,
`selectedVertices` on every call. The previous code did NOT clear
them, leading to silently-stale selections when the face index
mapping changed. Clearing is strictly safer than leaving them.