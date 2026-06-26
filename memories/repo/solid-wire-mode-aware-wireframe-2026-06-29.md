# Solid+Wire / Wire-Only Mode-Aware Wireframe (2026-06-29)

## Regression

User feedback after the previous "always depthTest false" fix:

- "Wire outline should be BLACK in both Solid+Wire and Wire-Only
  modes" — not white.
- "Solid+Wire should NOT show through the box" — back-side wire
  edges were bleeding through (X-ray effect).
- "Wire-Only mode the wire should be visible" — needs white on
  dark background.

## What the previous fix got wrong

The earlier "always depthTest: false" change (`wireframe-faint-front-face-fix-2026-06-29.md`)
and the "white wireframe" change (`wireframe-default-visibility-2026-06-29.md`)
were correct in isolation but wrong in combination:

1. `depthTest: false` made back-side wires always draw on top of the
   front face → user sees X-ray through the box.
2. White wireframe colour made the lines invisible against the
   light-gray mesh in Solid+Wire mode.

## Fix

Per-mode rendering in `_syncWireOverlay`
([CycleModelerController.js:2331](editor/src/CycoModeler/CycleModelerController.js#L2331)):

| mode        | mesh.visible | wire color  | wire depthTest | why |
|-------------|--------------|-------------|----------------|-----|
| `solid`     | true         | n/a (none)  | n/a            | mesh only — no wireframe overlay built |
| `solid-wire`| true         | black       | **true**       | back-side wires occluded by front mesh faces; front-side wires use a 2× outward lift to win the depth test |
| `wire`      | false        | **white**   | false          | mesh hidden; lines draw directly against dark scene bg; white is legible |

The wireframe overlay colour and depth-test are decided at build time
inside `_syncWireOverlay` based on `this.wireMode`. Factory defaults
for the wireframe setting itself are black at full opacity (matches
Solid+Wire mode's needs; Wire-Only mode overrides to white at render
time).

## Increased outward lift

In `_expandEdgesToRibbon`
([CycleModelerController.js:1199](editor/src/CycoModeler/CycleModelerController.js#L1199)),
the `coplanarity lift` was bumped from `width * 0.5` to `width * 2.0`:

```diff
-        const liftAmount = width * 0.5;
+        const liftAmount = width * 2.0;
```

With `depthTest: true` in Solid+Wire mode, every ribbon quad needs
to sit reliably OUTSIDE the surface in depth-buffer terms. The
previous `0.5× width` lift was enough for the `depthTest: false`
case but is too small to win the depth test against a polygon-offset
0 surface — front-face subdivision lines on a flat box face would
z-fight and render faint. The `2.0×` lift moves the quad ~2 line
widths toward the camera, guaranteeing it wins the depth test on
every segment regardless of perpendicular vs face-normal
orientation.

The on-screen ribbon width is unchanged — the perpendicular still
controls the visible thickness; the lift only affects depth ordering.

## Verification (manual)

Three modes toggled in the live editor:

- **Solid Only**: opaque box, no wireframe ✓
- **Solid + Wire**: opaque box + black wireframe on outside edges;
  back-face wires occluded (no X-ray); no faint lines ✓
- **Wire Only**: mesh hidden, bright white wireframe box visible
  against the dark viewport ✓

## Regression tests

`tools/test-wireframe-bugs.mjs`, `tools/test-primitive-bugs.mjs`,
`tools/test-ribbon-coplanar-fix.mjs`, `tools/test-ribbon-perpendicular.mjs`,
`tools/test-subdivide-integration.mjs` — all PASS.

## Supersedes

- `wireframe-default-visibility-2026-06-29.md` (white-default change
  is replaced — defaults are black; Wire-Only mode flips to white at
  render time).
- The white-wireframe screenshot was a state where the Solid+Wire
  mode's wireframe colour had been clobbered to white by the
  overridden default. That override is no longer the right choice.
