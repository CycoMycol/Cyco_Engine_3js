# Push Pull / Multi Push Pull — Inward push renders as hollow cut

## Regression (reported 2026-06-27)

User feedback: pushing a polygon **inward** with Push Pull (or Multi
Push Pull) produces a "hollow cut" — no side walls visible, looks like
the selected face was just punched in without extruding geometry around
it. Pulling outward works correctly and shows the side walls.

## Root cause

`EditableMesh.pushFaces` (lines 943–1020 of
`editor/src/CycoModeler/EditableMesh.js`) DOES generate the side walls
for inward pushes — the winding is correctly reversed
`[a, a', b', b]` for `distance < 0`, so each side wall's outward normal
points into the parent volume (the box interior for a box primitive).
This is geometrically correct: when you push a face into a closed box,
the resulting pocket's walls really do face inward (you'd see them from
inside the pocket).

The problem is rendering. After the 2026-06-29
`solid-wire-backface-cull-2026-06-29.md` fix, committed primitives use
`side: THREE.FrontSide` (see `_buildPrimitiveObject` at
`CycleModelerController.js:1836`). For an inward push:

- The new side wall's outward normal → **into** the box interior → when
  the user views from outside the box, the side wall is a back face →
  back-face culled → invisible.
- The pushed-in cap's outward normal → also into the box interior →
  same problem.

The wireframe ribbon (`_expandEdgesToRibbon`) lifts edges along the
polygon normal (`width * 2.0`). For inward-pushed walls that lift is
*into* the box, where the ribbon is occluded by the outer front face
in `solid-wire` mode (depthTest: true).

Geometry exists. It's just hidden by the FrontSide material.

## Fix (applied)

When `pushFaces` runs with `distance < 0`, mark the newly created
inward-facing faces with a per-face flag. The material-side renderer
then switches the object's material to `DoubleSide` whenever ANY
inward-facing face is present, so the pocket remains visible from the
outside (UModeler / SketchUp behavior).

This preserves the back-face-cull fix for normal primitives (no
inward faces → FrontSide) and only enables DoubleSide for objects that
have a real inward pocket.

## Affected files

- `editor/src/CycoModeler/EditableMesh.js` — `pushFaces` tags inward
  side walls.
- `editor/src/CycoModeler/CycleModelerController.js` —
  `_applyEditableMesh` switches material side based on tag presence.

## Verification

- `tools/test-pushpull-bugs.mjs` — PASS
- `tools/test-multi-pushpull-marquee.mjs` — PASS
- `tools/test-primitive-bugs.mjs` — PASS (no regression: normal box
  primitives still render FrontSide).

## Out of scope

- Wire-only mode is unaffected (mesh hidden, wireframe drawn from
  polygon edges directly).
- Subdivide after inward push: each subdivided cell of the pocket
  inherits the same inward-normal flag — still DoubleSide.