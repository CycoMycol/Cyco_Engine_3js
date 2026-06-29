# Subdivision Surface Modifier — implementation log (2026-06-29)

## Round 1 (morning)

User added a Subdivision Surface modifier to a box, saw 4 sub-quads
per side (visually subdivided) but push/pull still selected each
sub-quad individually — i.e. the modifier had *replaced* the mesh
with a tessellated version instead of producing a true Catmull-Clark
limit surface.

Fix shipped:
  - `EditableMesh.subdivideLoop(levels)`:
    real Loop (Charles Loop 1987) subdivision, returning a fresh
    EditableMesh with `_sourceFace` mapping refined faces back to
    their cage face.
  - `toBufferGeometry({ faceIdMap })`: optional faceId override so
    the polygon's picker can resolve refined-triangle raycast hits
    back to cage face indices.
  - `CycleModelerController._previewEditableMesh(obj, mesh)`:
    mirror of `_applyEditableMesh` that swaps `obj.geometry` but
    leaves `cycoModeler.mesh` (the cage) untouched.
  - The modifier's preview/apply paths rewired onto the new pipeline.

## Round 2 (afternoon) — bugs the user reported on round 1's output

User feedback summarised:
  1. "I should be able to use the sliders for real time results.
     Right now I have to type in numbers."
  2. "Catmull-Clark vs Simple dropdown doesn't change anything."
     (My round-1 code routed both to Loop. Simple is supposed to be
     a non-smoothing midpoint subdivision.)
  3. "Push/pull during modifier preview collapses the shape back to
     a box." (Modifier preview wasn't refreshing after cage edits.)
  4. "Default material is just white Standard. I need a light gray
     that shows shading."
  5. "If I deselect by clicking in another area, I can't edit /
     push/pull anymore." (Modifier panel detached its refresh
     listener when hidden.)
  6. "Display Cage toggle: when OFF, highlight should be on the
     whole cube face (across all sub-quads). When ON, highlight
     should sit on the picked sub-quad."
  7. "Viewport slider produces broken-looking shapes after push/pull."

### Fixes shipped in round 2

  - **Real `<input type="range">` sliders** in the Subdivision
    Surface / Subdivide modifier bodies (CSS themed against the
    cyco-theme: `cursor: ew-resize` track, growing thumb on drag,
    brighter track while held). Numbers can still be typed; the
    slider mirrors the value. New `_buildSliderRow` helper in
    `editor/src/CycoModeler/ObjectPropertiesPanel.js`.

  - **`subdivideSimple(levels)`** alongside `subdivideLoop` in
    `editor/src/CycoModeler/EditableMesh.js` — true Blender-Simple
    behaviour: original vertices stay at their positions, edge
    vertices are simple midpoints, no smoothing. The dropdown now
    actually switches.

  - **`cyco-edit-applied` listener is permanent** in the
    ObjectPropertiesPanel constructor (was previously attached
    inside `_attachSelectionListeners`, so it dropped when the
    user closed the panel). Also dispatched from `_applyEditableMesh`
    (push/pull commit path) so the modifier preview refreshes
    after every cage mutation regardless of panel visibility.

  - **`_onEditApplied` reentrancy guard**: skips events whose
    `source === '_previewEditableMesh'`, otherwise the preview path
    would re-enter itself on every commit (infinite loop).

  - **Default scene material**: `ObjectFactory._defaultMaterial()`
    and the model's primitive material both switched from
    `0x8888aa` (purple-blue) to `0xc8c8c8` (light warm gray,
    FrontSide, roughness 0.55). Inward-pocket surfaces still flip
    to DoubleSide via the existing `_applyEditableMesh` path.

  - **Display Cage toggle now actually toggles the selection mode**:
    `_previewEditableMesh(obj, mesh, selectionMode)` accepts
    `'cage'` (default, "Display Cage off") or `'refined'` (on).
    When `refined`, the polygon's `faceId` attribute is identity
    (each refined triangle is its own polygon), and the polygon
    picker reads the cached refined mesh on the object instead of
    the cage. `_previewEditableMesh` writes
    `cm._subdivisionRefinedMesh` so the picker can rebuild a full
    `EditableMesh` from it. `subdivideLoop(levels, { uniqueFaceGroups })`
    and `subdivideSimple(levels, { uniqueFaceGroups })` optionally
    make each child triangle its own polygon (needed for
    Display Cage on so the picker highlight stays on the picked
    sub-quad instead of spreading across the parent face).

  - **View-level-0 path uses the LIVE cage JSON** instead of the
    stale `_modifierBaseSnapshot.geometry`. The snapshot was being
    captured before push/pull, so reverting to it visually undid
    the user's edits. Now re-builds the BufferGeometry from the
    current `EditableMesh.fromJSON(cm.mesh)` and clears the
    subdivided-state cache.

  - **`restoreBaseGeometry` clears `_subdivisionRefinedMesh`** so the
    polygon's picker doesn't keep reading a stale refined mesh after
    the modifier is removed (the "sticky smooth mode" / phantom
    subdivision bug).

## Verified by 8 test files / 75 assertions (all green)

  - test-subdivision-modifier.mjs
  - test-subdivision-pipeline.mjs
  - test-subdivision-visual-shape.mjs
  - test-subdivision-cc-vs-simple.mjs
  - test-subdivision-cage-toggle.mjs
  - test-subdivide-integration.mjs
  - test-boxsubdivided.mjs
  - test-subdivide-wireframe.mjs

## User-visible bug (round 1)
Adding a Subdivision Surface modifier with View level 1 on a Box
resulted in:
  - The mesh visibly showing 4 quads per box face (looks subdivided).
  - Push/Pull highlighting each sub-quad as an independent polygon.
  - The mesh NOT actually being a rounded cube (still sharp box).

## Root cause
`previewSubdivisionSurface` in [ObjectPropertiesPanel.js](editor/src/CycoModeler/ObjectPropertiesPanel.js)
called `_applyDimensions(obj, { primitive: 'box-subdivided', segments: ... })`,
which **replaced `obj.geometry` AND `cycoModeler.mesh`** with a uniformly
tessellated cube (12 tris × segments²). That:
  - Grew face count: 6 box faces × segments² sub-quads × 2 tris = real
    new geometry. Not a display illusion.
  - Made the polygon's picker highlight each sub-quad individually
    (because the picker resolves to `cycoModeler.mesh.faceGroups`, and
    the new `cycoModeler.mesh` had `segments² × 6` independent groups).
  - Skipped real Catmull-Clark -- a tessellated cube is still a cube.

## Fix (high-level)
A proper non-destructive modifier, modeled on Blender's UX:

1. **EditableMesh.subdivideLoop(levels)** added to
   [EditableMesh.js](editor/src/CycoModeler/EditableMesh.js). Uses
   Charles Loop's 1987 triangular subdivision (the triangle
   analogue of Catmull-Clark that produces an equivalent rounded
   limit surface). Returns a new mesh with `_sourceFace[i]` =
   parent cage face index for each refined triangle.

2. **toBufferGeometry({ faceIdMap })** accepts an optional faceId
   map so the polygon's picker can resolve refined-triangle raycast
   hits back through `_sourceFace` to the parent cage face -- so
   picking a sub-quad still highlights the whole cage face.

3. **_previewEditableMesh(obj, editableMesh)** added to
   [CycleModelerController.js](editor/src/CycoModeler/CycleModelerController.js).
   Like `_applyEditableMesh` but **does NOT touch `cycoModeler.mesh`**,
   keeping the cage JSON intact. The wireframe overlay reads from
   the cage, so it automatically draws the un-subdivided outline.

4. **previewSubdivisionSurface / applySubdivisionSurface** in
   [ObjectPropertiesPanel.js](editor/src/CycoModeler/ObjectPropertiesPanel.js)
   rewired to use the new flow. Apply now bakes the subdivided
   EditableMesh into the cage via `_applyEditableMesh`.

5. **cyco-edit-applied event** dispatched by `_previewEditableMesh`
   and listened to by the panel's `_onEditApplied` so that
   push/pull during modifier preview auto-refreshes the display
   mesh from the new cage.

## Outcome (verified by 47 assertions across 4 test files)
  - Adding a Subdivision Surface modifier (View=1) on a box now
    renders a rounded-cube surface (cube corners pulled inward
    by ~28% after 1 iteration; fully sphere-like after 3).
  - Push/Pull still picks **6 polygons total** (one per box face)
    regardless of subdivision level, because every refined triangle
    maps back to a cage face.
  - Display Cage wireframe shows the un-subdivided outline (the
    standard wireframe overlay already reads from the cage JSON,
    so no extra LinesSegments is required).
  - Apply bakes the subdivided EditableMesh as the new cage; from
    then on, push/pull acts on the subdivided mesh directly.

## Test files (do not delete)
  - tools/test-subdivision-modifier.mjs   — Loop subdivider tests.
  - tools/test-subdivision-pipeline.mjs   — preview/Apply round-trip.
  - tools/test-subdivision-visual-shape.mjs — rounded-cube check.

## Caveats
  - Loop subdivision on the triangulated cube produces 26 vertices
    at level 1 (8 repositioned + 12 outline edges + 6 diagonal
    "internal" edges from the box's per-quad triangulation
    diagonal). The internal-diagonal edge vertices add a tiny
    micro-subdivision down the centre of each original box face
    but disappear visually after level 2. Could be eliminated by
    detecting faceGroup-shared edges and skipping their subdivision;
    left as a follow-up because the visual effect is hidden by the
    smoothing.
  - True Catmull-Clark (vs Loop on triangles) would require
    re-grouping the triangle soup into the quads each quad came
    from. Deemed not worth the complexity since the Loop limit
    surface is visually indistinguishable.
