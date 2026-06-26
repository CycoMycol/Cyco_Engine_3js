# Solid+Wire Backface Cull (2026-06-29) — FrontSide on committed primitives

## Regression

In **Solid + Wireframe** mode (the default), the user could see the
INSIDE of committed primitives through the front face — the wireframe
was visible on the back, and the inside of the box appeared to render
through the outer surface.

## Root cause

`_buildPrimitiveObject` in CycleModelerController unconditionally
created the primitive's `MeshStandardMaterial` with
`side: THREE.DoubleSide`. The original intent was to support the
**drag-preview** case (so the user can see the whole volume while
drawing it), but the same `DoubleSide` was applied to the committed
primitive that lives in the scene permanently — making back faces
visible through the front faces in solid / solid+wire mode.

## Fix

One-line change at [CycleModelerController.js:1632](editor/src/CycoModeler/CycleModelerController.js#L1632):
make `side` conditional on the `preview` argument.

```diff
-      side: THREE.DoubleSide,
+      side: preview ? THREE.DoubleSide : THREE.FrontSide,
```

- **Preview (during drag)** → `DoubleSide` (unchanged — user sees
  the whole box while drawing).
- **Committed primitive** → `FrontSide` (back faces culled — only
  outer surface visible, matching the user's expectation for solid
  and solid+wire mode).

The wireframe overlay in solid+wire mode is unaffected — it uses
`depthTest: false` (see `wireframe-faint-front-face-fix-2026-06-29.md`)
and draws all edges including back-side ones via the screen-aligned
ribbon path.

## Verification

- `tools/test-primitive-bugs.mjs` — PASS
- `tools/test-wireframe-bugs.mjs` — PASS

## Out of scope

- Preview primitives still show both sides (intentional — drag UX).
- Wire-only mode hides the mesh material entirely (`mat.visible = false`),
  so the `side` setting has no effect on rendering cost in that mode.
