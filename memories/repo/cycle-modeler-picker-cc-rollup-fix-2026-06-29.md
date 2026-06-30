# Cycle Modeler — Subdivision Picker Roll-Up Fix (2026-06-29)

## Bug
User reported 4 issues with the polygon's picker on objects with the Subdivision Surface modifier:
1. Highlight colour was dark red and barely visible on the smoothed mesh.
2. Clicking the FRONT face highlighted the BACK face (with Catmull-Clark).
3. The "Display Cage" toggle was "working in reverse" — the user expected it to ALWAYS roll up to the parent face, not toggle sub-quad picking.
4. Push/Pull moved individual triangles instead of all 4 sub-quads of the smoothed face.

## Root cause
The polygon's `faceId` attribute on the refined mesh was populated with the **quad array index** of the parent face in the `_subdivideCatmullClarkOnce` output (0..5), not the **cage faceGroup**. CC subdivision produces a flat array of quads, but `EditableMesh.faceGroups[1]` for a cube is `0` (the back faceGroup), not `1` (the front faceGroup).

When the picker ran `cage.selectionGroup(1)`, it looked up `cage.faceGroups[1] = 0` and ended up selecting the back face. This is the same trap for Loop subdivision (where each parent triangle produced 4 child tris, and child[1] had nothing to do with any cage face).

## Fix
1. **EditableMesh.js**
   - Added module-level `_resolveCageFaceGroup(sourceMesh, srcIdx)` that maps a child face back to its CAGE faceGroup, working for both Loop and CC.
   - `_subdivideWith` populates a parallel `_sourceFaceGroup` array on the refined mesh. Length matches `faces.length`. Each child face's entry is the cage faceGroup for its parent.
   - `toJSON`/`fromJSON` round-trip `_sourceFaceGroup` (this is needed because `_previewEditableMesh` round-trips the refined mesh through JSON before stamping faceIds onto the BufferGeometry).
2. **CycleModelerController.js**
   - `_previewEditableMesh` passes `faceIdMap: refined._sourceFaceGroup ?? refined._sourceFace` so the polygon's `faceId` is the cage faceGroup.
   - `_resolveFaceIndexFromId(mesh, faceId)` translates a faceGroup back to a face index (searches the `faceGroups` array for the entry that equals `faceId`).
   - `_faceIndicesFromHit` calls `mesh.selectionGroup(_resolveFaceIndexFromId(cage, pickedFaceId))` — same as the cage code path, just with translation.
   - `_faceGeometryFromHit` and `_selectedFacesOverlayGeometry` use a new `_buildRefinedFaceOverlayGeometry(refined, faceGroup)` helper that collects every child face of the refined mesh whose `faceGroups[i]` (or `_sourceFaceGroup[i]` fallback) matches the picked cage faceGroup, and triangulates them. The resulting overlay covers all 4 sub-quads of the smoothed surface.
3. **ObjectPropertiesPanel.js**
   - `previewSubdivisionSurface` no longer toggles `uniqueFaceGroups` on the modifier — always passes `uniqueFaceGroups: false`. Display Cage is now a purely visual overlay; the picker always rolls up.
4. **ModelerSettings.js**
   - `polygonHighlight` default changed from `{ color: '#ff3333', opacity: 0.9 }` to `{ color: '#42c8ff', opacity: 0.95 }` (Blender Edit Mode cyan, clearly visible on any material).
   - `CycleModelerController` polygon overlay style also updated to the same cyan/0.95.

## Verification
- `tools/test-subdivision-picker-rollup.mjs` (NEW): 18 assertions for Loop/CC/Simple — `_sourceFaceGroup` is populated with exactly 6 unique values (one per cage face), each matches a cage faceGroup, the picker resolves to the right cage face triangles, the highlight geometry covers all sub-quads (CC: 30 verts / 5 quads × 2 tris; Loop/Simple: 24 verts / 8 tris).
- Browser test (Playwright) on a real Box + Subdivision Surface:
  - Picker returns `[6, 7]` for the top face (cage triangles), not the back face.
  - Hover overlay covers 10 triangles (5 sub-quads) on the smoothed mesh.
  - Overlay colour `0x42c8ff`, opacity 0.95.
  - Display Cage ON and OFF give identical picker + highlight behaviour (roll-up is unconditional).
  - Same behaviour with `Simple` subdivision.

## Files touched
- `editor/src/CycoModeler/EditableMesh.js` (+`_sourceFaceGroup` field, +`_resolveCageFaceGroup` module fn)
- `editor/src/CycoModeler/CycleModelerController.js` (+`_resolveFaceIndexFromId`, +`_buildRefinedFaceOverlayGeometry`, +use them in `_faceIndicesFromHit`, `_faceGeometryFromHit`, `_selectedFacesOverlayGeometry`; updated polygon style)
- `editor/src/CycoModeler/ObjectPropertiesPanel.js` (always `uniqueFaceGroups: false`)
- `editor/src/CycoModeler/ModelerSettings.js` (default colour)
- `tools/test-subdivision-picker-rollup.mjs` (NEW regression test)

## Files removed
- `tools/test-picker-vs-highlight.mjs` (replaced by `test-subdivision-picker-rollup.mjs`)
- `tools/test-picker-cc-bug.mjs` (debug-only)
- `tools/test-debug-sourceface.mjs` (debug-only)