# Wireframe Ribbon Fix (2026-06-29) — Outward Push + Polygon Offset

## Regression

User reported wireframe missing on the FRONT (camera-facing) side of
primitives when running in modeler mode with `depthTest: true`. Back
side rendered fine; front side was occluded by the mesh itself.

## Root cause (2 bugs)

**Bug 1 — view-aligned perpendicular points in the wrong half.**
`perpW = cross(dirW, viewDir)` lives in the screen plane but can point
in either of two directions along the segment. For a sphere segment on
the FRONT (camera-facing) side of the mesh, this often gave a vector
that pointed INWARD (toward the mesh interior), so the ribbon quad sat
INSIDE the mesh and got occluded by the front-facing sphere surface.

**Bug 2 — no depth bias.**
The wireframe MeshBasicMaterial had no `polygonOffset`. Even with the
perpendicular pointing outward, the ribbon and the mesh surface were
coplanar to within floating-point precision, so the front-facing
ribbon frequently lost the depth test to the sphere itself (z-fight
loss manifests as missing pixels).

## Fix

1. **Outward disambiguation via face normals.**
   `EditableMesh.toEdgesGeometry` already attaches per-segment face
   normals to `userData._segFaceNormals` (1-2 normals per emitted
   segment, in local space). The ribbon builder now reads them, averages
   when there are two, transforms to world space via `parentWorld`,
   then takes the dot product with `perpW`. If negative, the
   perpendicular is flipped (`offsetLocal.multiplyScalar(-1)`) so the
   ribbon always sits on the outside of the mesh. This guarantees the
   ribbon offset is AWAY from the surface, regardless of camera angle.

2. **Polygon offset on the wireframe material.**
   `polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4`
   added to the ribbon's MeshBasicMaterial. This biases the ribbon
   toward the camera in depth-buffer terms so even when the ribbon is
   technically coplanar with the surface, it wins the depth test. The
   hover/selection overlay (which uses `depthTest: false`) is unaffected.

3. **`outwardPushed` stat counter** added to `__cyco._wireRibbonStats`
   so the count of flipped segments is observable in dev tools.

## Code locations

`editor/src/CycoModeler/CycleModelerController.js`:

- `_expandEdgesToRibbon`: read `_segFaceNormals`, average 1-2 face
  normals per segment, transform to world via `parentWorld`, dot with
  `perpW`, flip when negative. `outwardPushed` counter incremented.
- `_buildFatEdges` (WebGPU ribbon path): added `polygonOffset: true,
  polygonOffsetFactor: -1, polygonOffsetUnits: -4` to the
  MeshBasicMaterial.

## Verification

`tools/test-wireframe-bugs.mjs` and `tools/test-primitive-bugs.mjs`
still pass (33 + 17 tests). The visual regression (front-side
wireframe missing) should be resolved — the ribbon now sits outside the
mesh on every segment, and polygon offset ensures it always wins the
depth test against the surface.

## Out of scope

- WebGL path (`Line2 + LineMaterial`) already handles screen-pixel
  widths natively and renders the wireframe as actual lines, not a
  triangulated ribbon — it does not have this bug.
- The hover / selection overlay (edge mode) uses `depthTest: false`
  and is unaffected.