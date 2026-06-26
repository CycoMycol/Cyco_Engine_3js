# Wireframe Faint Front-Face Fix (2026-06-29) — depthTest: false on Main Overlay

## Regression

User reported that after Subdivide / push-pull / adding geometry,
some wireframe lines appear bold and visible while other lines
(subdivision lines on the front face of a box) appear faint —
"some lines are nice and bold ... and then with the other red arrow
it's faint". User suspected opacity / ray-tracing issue; it was
actually **depth-test loss on surface-tangent segments**.

## Root cause

The main wireframe overlay was rendered with `depthTest: true`. The
ribbon algorithm in `_expandEdgesToRibbon` computes a screen-aligned
perpendicular for each segment and adds a "lift" component along the
face normal so the ribbon sits OUTSIDE the surface:

```js
const liftAmount = width * 0.5;
const liftLocal = faceNormalWorld.clone()
  .transformDirection(invParent).multiplyScalar(liftAmount);
offsetLocal.add(liftLocal);
```

But for subdivision lines on a **flat face viewed obliquely**, the
screen-aligned perpendicular is **tangent to the surface**
(`perpW · faceNormal ≈ 0`). The outward push on those segments comes
**entirely** from the lift = `width * 0.5`.

For segments on the silhouette or side faces, the perpendicular has a
large component along the face normal (`perpW · faceNormal ≈ ±0.5`),
so the flip pushes the ribbon outward by a full `width`, and the
resulting outward push is `width * 1 + width * 0.5 = 1.5 * width`
(3× the lift-only case).

Measured on `boxSubdivided(120, 250, 120, 3)` from camera
`(280, 200, 340)`:

| metric | value |
| --- | --- |
| segments | 144 |
| min outward push | 1.25 (lift only) |
| max outward push | 3.73 (lift + perpendicular flip) |
| ratio | **3×** |

The 3× variance means some ribbon quads win the depth test decisively
(visible), while others barely beat the surface (faint, dotted, or
fully occluded depending on angle + MSAA + polygon-offset jitter).
Front-face subdivision lines are the worst-case — exactly the lines
the user wanted visible after applying Subdivide.

## Fix

`_syncWireOverlay` now passes `depthTest: false` to
`_buildFatEdges`. The wireframe ALWAYS draws on top of the underlying
mesh, regardless of segment orientation. This matches the existing
behaviour of the hover / selection overlay (line 1526 in
CycleModelerController.js), which already uses `depthTest: false`.

```diff
   const wire = this._buildFatEdges(
     edgesGeom,
     this._wireStyle.color,
     this._wireStyle.thickness,
     this._wireStyle.opacity,
-    /* depthTest */ true,
+    /* depthTest */ false,
     targetPos,
   );
```

The `polygonOffset` setting on the ribbon material is now a no-op
(depthTest is false → polygon offset never consulted). Left in place
because removing it is unrelated churn and the WebGL LineMaterial path
still consumes the depthTest arg.

## Verification

- `tools/test-wireframe-bugs.mjs` — 33/33 PASS
- `tools/test-primitive-bugs.mjs` — PASS
- `tools/test-subdivide-integration.mjs` — PASS
- `tools/test-ribbon-coplanar-fix.mjs` — PASS
- `tools/test-ribbon-perpendicular.mjs` — PASS
- `tools/test-boxsubdivided.mjs` — PASS

## Out of scope

- The hover / selection overlay was already on `depthTest: false`.
- The polygon-offset / perpendicular-flip / lift machinery in
  `_expandEdgesToRibbon` is now redundant for the main wireframe but
  is left in place — it's still required for any future caller that
  wants depth-tested wireframes, and provides defence-in-depth if
  depthTest is ever toggled back to true.
