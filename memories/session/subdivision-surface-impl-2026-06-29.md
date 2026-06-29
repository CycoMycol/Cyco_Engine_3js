# Subdivision Surface Modifier — Full Implementation Plan (2026-06-29)

## User-confirmed scope
Full non-destructive Catmull-Clark modifier that keeps the original mesh as
the *cage*, with a derived display mesh for visualisation. Push/pull must
operate on the cage only. No patches, no shortcuts.

## Diagnosis (current bugs)
1. `previewSubdivisionSurface` replaces `obj.geometry` with
   `boxSubdivided` — destroys the original 6-face mesh.
2. No real Catmull-Clark — only a tessellation that doesn't round.
3. Triangulated BoxGeometry → no quad topology → CC can't apply.
4. Push/Pull highlights each sub-quad because the mesh genuinely has more
   faces (not a display illusion).
5. "Display Cage" overlay is built from `_modifierBaseSnapshot`, but
   `obj.geometry` is *also* the subdivided version — the cage overlay
   sits on top of a mesh that doesn't match it.
6. Apply bakes a tessellated box instead of a smoothed CC surface.

## Architecture (target)

- `EditableMesh.subdivideCatmullClark(levels)` — real algorithm on the
  half-edge structure. Returns a *new* `EditableMesh` with the refined
  topology. Original mesh is untouched (cage).
- For each existing `EditableMesh` instance, store
  `_controlCage: EditableMesh` snapshot for non-destructive preview.
- The Modif preview path:
  - sets `obj.geometry` from `_controlCage.subdivideCatmullClark(viewLevel)`;
  - draws cage wireframe ON TOP from `_controlCage` EdgesGeometry;
  - boxes the modified mesh in `__preview` so removal restores cleanly.
- Push/Pull/select polygon picker reads from
  `_controlCage.faceGroups` (6 face groups for a box), not from the
  `obj.geometry` `faceGroups`. The polygon-overlay wireframe overlays
  the cage wireframe, not the smoothed mesh.
- Apply: bake the subdivided mesh into `EditableMesh`, replace
  `_controlCage`, strip modifier. Memory of constraint modifier
  cleared. From now on push/pull uses the refined topology.

## Files to touch (entry list)

1. `editor/src/CycoModeler/EditableMesh.js`
   - Add `subdivideCatmullClark(levels)`.
   - Add face-point / edge-point / vertex-point helpers (private).
   - Keep faceGroups aligned: at level 0 each refined face belongs to
     the same faceGroup as its cage face. Required for the push/pull
     picker.

2. `editor/src/CycoModeler/ObjectPropertiesPanel.js`
   - Rewrite `previewSubdivisionSurface` to call the new subdivider
     instead of `_applyDimensions`.
   - Keep `_applyDimensions` path only for the *primitive* "Subdivide"
     (different concept).
   - Cage overlay rebuild: cage now matches `obj.geometry` because both
     `obj.geometry` and the cage derive from the *same* control mesh,
     just at different levels.
   - Apply: bake the subdivided mesh into the modeler's persistent
     EditableMesh so the model survives the next base-snapshot cleanup.

3. `editor/src/CycoModeler/CycleModelerController.js`
   - Push/Pull polygon-pick path: when the object has a
     `cycoModeler._controlCage`, use its faceGroups (mapped back to
     cage faces) for highlight + selection rather than
     `obj.geometry.faceGroups`. This keeps "1 face per box side" even
     when the display mesh is subdivided.
   - When a modifier is *applied*, refresh
     `cycoModeler._controlCage` to the subdivided EditableMesh so the
     picker naturally moves to the refined topology.

4. (Verified) No other files. The `Mesh` / `BufferGeometry` path just
   reflects whatever `EditableMesh` we hand it.

## Algorithm reference (Catmull-Clark)

For each original face F with n corners:
- Add a **face point** at the average of F's corners.

For each original edge E = (P₁, P₂) with two adjacent face points F₁, F₂:
- Add an **edge point** at (F₁ + F₂ + P₁ + P₂) / 4.

For each original vertex V with valence n:
- F = average of all face points touching V
- R = average of edge midpoints of original edges touching V
  (midpoint = (P₁+P₂)/2 — *not* the new edge point above)
- New V position = (F + 2R + (n−3)V) / n

Connect:
- Each new face point ↔ new edge points of the original edges of F
  (4 edges/face at all levels after the first)
- Each new vertex point ↔ new edge points of original edges at V

After level 1 the mesh is quad-only. Repeat recursively for higher
levels.

## Sub-tasks (in order)

1. Read `EditableMesh.js` faceGroup / half-edge structure end-to-end.
2. Implement `subdivideCatmullClark(1)` with a unit test on the box.
3. Add subdivision-level loop (recursive CC).
4. Make faceGroup inheritance work (refined child face → parent
   faceGroup).
5. Plug into `_helpers.previewSubdivisionSurface` (drop the
   `_applyDimensions` shortcut).
6. Plug into `applySubdivisionSurface` (bake the refined EditableMesh
   and refresh `_controlCage`).
7. Patch the push/pull polygon picker in
   `CycleModelerController.js` to prefer `_controlCage` faceGroups.
8. Re-run `test-subdivide-integration.mjs` and
   `test-boxsubdivided.mjs` — they may need updating now that CC
   subdivides topologies differently.
9. Visual verify on `editor/index.html`.

## Tests required

- Catmull-Clark level 1 on a `box(1,1,1)`: produces 6 faces × 4 quads × 2
  triangles = 48 triangles. Vertex positions should NOT be on the
  corners any more — face-point averaging pulls them inward, vertex
  points move toward `(F + 2R + 3V)/6` (n=4 for cube corners).
- Level 2: 6 × 16 × 2 = 192 triangles.
- Cap at level 5 (Blender default) — escalate to 6 only if requested.

## Memory alignment

This implementation matches the user's 2026-06-29 message: subdivision
surface must be a true Catmull-Clark modifier with the original mesh
untouched; push/pull picks the cage face, not the subdivided quads.
