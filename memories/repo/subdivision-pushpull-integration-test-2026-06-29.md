# Subdivision + Push/Pull Integration Test

- `tools/test-subdivision-pushpull-integration.mjs` validates the
  end-to-end flow: box → CC subdivide → push front face → re-CC.
- Key contract: CC must emit true 4-vertex quads, not tri-pairs.
- `selectionGroup(faceIdx)` takes a FACE INDEX, not a group ID. It
  returns every face sharing that face's group. This is a common
  test-confusion pitfall.
- Box after push: 12 original tris + 4 new side-wall quads = 16 face
  entries (mix of tris and quads). Side walls each get a fresh
  faceGroup ID so they can't over-select with adjacent coplanar
  faces.
- After re-subdivide, every child quad has a valid `_sourceFace`
  mapping pointing back to a parent cage face index.