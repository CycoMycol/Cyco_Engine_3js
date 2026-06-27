# Frustum cull boundingSphere crash (2026-06-27)

**Bug:** Cycle Modeler multi-select crashed and froze the editor with
hundreds of `Cannot read properties of undefined (reading 'boundingSphere')`
errors per second.

**Stack trace (WebGPU):**
```
TypeError: Cannot read properties of undefined (reading 'boundingSphere')
    at Frustum.intersectsObject (three.core.min.js)
    at WebGPURenderer._projectObject (three.webgpu.min.js)
    at WebGPURenderer.render
    at ViewportEngine._tick        (ViewportEngine.js:2418)
    at loop                         (ViewportEngine.js:2261)
```

**Root cause:** A `THREE.Mesh` existed in the scene with
`obj.geometry === undefined`. Three.js's `Frustum.intersectsObject` and
`WebGPURenderer._projectObject` dereference `mesh.geometry.boundingSphere`
without a null/undefined check, so every render frame (60Hz) threw. The
error storm saturated the event loop and effectively disabled the editor.

In the Cycle Modeler, `obj.geometry` could end up undefined if
`_restoreObjectGeometry` was called with a snapshot whose `geometry` was
already missing, or if any future code path assigns `obj.geometry = undefined`
during a multi-step update.

**Fix (defense in depth):**

1. **`editor/src/main.js`** — Patch `THREE.Frustum.prototype.intersectsObject`
   at module load to return `true` (always-in-frustum) for any object whose
   geometry is missing. The patch is guarded by `__cycoFrustumPatched` so it
   runs once. This prevents the renderer cull crash regardless of how
   geometry ended up missing.

2. **`editor/src/CycoModeler/CycleModelerController.js`** — Hardened
   geometry-mutating paths so they never leave `obj.geometry` undefined:
   - `_applyEditableMesh`: bail if `editableMesh.toBufferGeometry()` returns
     nothing.
   - `_applyDimensions`: bail if `_geometryFromDimensions` returns no
     geometry.
   - `_restoreObjectGeometry`: if the snapshot has no usable geometry, try
     to rebuild from `userData.cycoModeler.mesh` JSON instead of silently
     assigning `undefined`.
   - `_expandEdgesToRibbon`: return an empty `BufferGeometry` with
     `computeBoundingSphere` called instead of returning `edgesGeom`
     unmodified (which could lack a bounding sphere).
   - All three `_selected*OverlayGeometry` builders now call
     `computeBoundingSphere()` on the returned geometry so they can never
     trip the cull.

3. **`editor/src/viewport/SelectionManager.js`** — Fixed `_selectByScreenRect`
   line 318 optional-chain bug: `!obj.geometry?.boundingSphere` returned
   `true` when `obj.geometry` was undefined, then
   `obj.geometry.computeBoundingSphere()` crashed. Now also checks
   `obj.geometry` truthiness first.

**Verification:** Reproduced in browser, applied fix, re-tested with:
- 2 box primitives + `setSelectedObjects([box1, box2])` → 0 errors over 5s
- Element-mode marquee drag across the scene → 0 errors
- Multi-push/pull with selected faces → 0 errors
- All modeler objects report `hasGeo: true` post-fix.

**Lesson:** Any code that does `obj.geometry = X` MUST guarantee `X` is a
real `BufferGeometry` (with at least an empty `position` attribute). Three.js
renderer culling does not null-check `mesh.geometry`.