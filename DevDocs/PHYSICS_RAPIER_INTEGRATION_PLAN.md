# Physics Integration Plan — Rapier 2D/3D (Cyco Engine 4)

## TL;DR

Integrate Rapier3D and Rapier2D as local ESM + WASM libraries served over localhost. A central `PhysicsManager.js` handles the full runtime lifecycle — init on play, fixed-timestep step on tick, sync transforms back to Three.js, dispose on stop. A `PhysicsEditHelper.js` provides collider overlays in editor mode without requiring Rapier to run. Three UI entry points: Input Manager window, Environment → Physics window, and Add Component picker on object properties. Ragdoll is implemented in Phase 11 after joints are complete.

---

## Pre-implementation Considerations

All of these are requirements — each is addressed in a specific phase.

| Consideration | Where handled |
|---|---|
| **Editor vs play state** — physics never mutates editor transforms | Phase 2 — world created on play, fully destroyed on stop |
| **Scene snapshot integrity** — bodies built AFTER snapshot so stop restores cleanly | Phase 2 — `init()` called after `_snapshot` is taken in `_onPlay()` |
| **Local server required** — WASM loads via fetch(), fails on `file://` | Phase 1 — WASM guard with actionable error message |
| **Fixed timestep stability** — variable delta causes tunneling and joint instability | Phase 2 — accumulator at 1/60s, max 3 substeps per frame |
| **World-space transforms** — nested/parented objects need world not local coords | Phase 2 — `getWorldPosition()` / `getWorldQuaternion()` |
| **Non-uniform scale** — Rapier can't handle it reliably | Phase 5 — warning + world-geometry bounding box sizing |
| **Physics Edit Mode usability** — overlay visible before play, updates on changes | Phase 2b — Three.js only, listens to `cyco-scene-dirty` |
| **Debug rendering performance** — many helpers tank FPS | Phase 6 — wireframe only renders when toggled on |
| **Ragdoll complexity** — depends on skeleton and joint systems | Phase 11 — strictly after Phase 9 joints |
| **Input binding separation** — no conflicts with editor shortcuts | Phase 4 — own localStorage key, play-state gated |
| **2D axis convention** — XY vs XZ needs clear labeling in UI | Phase 3 — labels say "XY — side-scroller (Z=0)" / "XZ — top-down (Y=0)" |
| **Serialization coverage** — components and scene metadata must persist | Phase 3 + auto Three.js `toJSON()` |
| **Error handling / graceful fallback** — friendly messages, never crashes | All phases — try/catch on every Rapier call |

---

## Phase 0: Write This Document ✅

Create `DevDocs/PHYSICS_RAPIER_INTEGRATION_PLAN.md` as the first action before any code.

---

## Phase 1: Library Acquisition & Setup

1. Download `@dimforge/rapier3d-compat` ESM build + `rapier_wasm3d_bg.wasm` → `editor/libs/rapier3d/`
2. Download `@dimforge/rapier2d-compat` ESM build + `rapier_wasm2d_bg.wasm` → `editor/libs/rapier2d/`
3. Add import map entries in `editor/index.html`:
   - `"@dimforge/rapier3d-compat": "./libs/rapier3d/rapier.es.js"`
   - `"@dimforge/rapier2d-compat": "./libs/rapier2d/rapier.es.js"`
4. WASM guard in `PhysicsManager.init()`:
   - `await RAPIER.init()` wrapped in try/catch
   - On failure: detect `window.location.protocol === 'file:'` and show: *"Physics requires a local server. Open the editor via http://localhost."*

---

## Phase 2: Play Button & PhysicsManager Foundation

The play button (`CenterPanel._playBtn`) is already wired — it dispatches `cyco-runtime-play` / `cyco-runtime-stop` and `GameRuntime` handles them. This phase adds the PhysicsManager calls.

5. Create `editor/src/viewport/PhysicsManager.js`:
   - `async init(scene, mode, gravity, plane2d)` — dynamic-imports correct Rapier module, initializes world
   - `dispose()` — frees world, body map, collider map, event listeners
   - `_buildBodies(scene)` — traverses scene, uses `getWorldPosition()` + `getWorldQuaternion()` (never local)
   - `_step(delta)` — fixed-timestep accumulator: FIXED_DT = 1/60s, max 3 substeps, remainder carried forward
   - `_syncTransforms()` — Rapier body translation/rotation → Object3D position/quaternion
6. Instantiate in `ViewportEngine.js`, expose as `window.__cyco.physicsManager`
7. Wire `GameRuntime._onPlay()` / `_onStop()`:
   - `_onPlay()`: after snapshot → `await physicsManager.init(scene, meta.physicsMode, meta.gravity, meta.plane2d)`
   - `_onStop()`: `physicsManager.dispose()`
   - Guard: skip init if `physicsMode === 'none'`

---

## Phase 2b: Physics Edit Mode

The `CenterPanel._physicsEdit` checkbox currently sets a local bool and does nothing else.

8. Update `CenterPanel.js` checkbox handler to dispatch `cyco-physics-edit-mode { enabled: v }`
9. Create `editor/src/viewport/PhysicsEditHelper.js`:
   - Listens to `cyco-physics-edit-mode`, `cyco-hierarchy-add`, `cyco-hierarchy-remove`, `cyco-scene-dirty`
   - Enabled: adds Three.js helper overlays per physics component — color-coded: blue = static, green = dynamic, orange = trigger
   - Disabled: removes all helpers
   - Works purely from Three.js geometry — no Rapier required
   - `update(object3d)` — refreshes helper for a single object
10. Instantiate `PhysicsEditHelper` in `ViewportEngine.js`

---

## Phase 3: Physics World Window — Environment Menu

11. Add scene metadata to `SceneManager.js`:
    - `physicsMode: '3d' | '2d' | 'none'` (default `'3d'`)
    - `gravity: { x: 0, y: -9.81, z: 0 }` (3D) / `{ x: 0, y: -9.81 }` (2D)
    - `plane2d: 'xy' | 'xz'` (default `'xy'`)
12. Add "Physics" to Environment dropdown in `MenuBar.js` → dispatches `cyco-show-properties { type: 'physics' }`
13. Create `editor/src/ui/PhysicsWorldWindow.js` — dockview floating panel, two tabs:
    - **3D**: Mode (None / 3D), Gravity XYZ, Fixed Timestep, Max Substeps, Solver Iterations
    - **2D**: Mode 2D, Gravity XY, 2D Plane ("XY — side-scroller (Z=0)" / "XZ — top-down (Y=0)"), Solver Iterations
14. Wire `'physics'` case in `main.js` `cyco-show-properties` listener

---

## Phase 4: Input Manager Window

15. Create `editor/src/ui/InputManagerWindow.js` — dockview floating panel, three tabs:
    - **Keyboard**: existing editor shortcuts from `InputManager.js` localStorage prefs
    - **Physics Input**: rebindable keys for Move Forward / Back / Left / Right / Jump / Sprint → `localStorage('cyco-physics-input')`
    - **Gamepad**: stub — "Coming soon"
16. Wire existing no-op `'input-manager'` toolbar action in `main.js`
17. Update `InputManager.js` to read physics bindings and dispatch `cyco-input-move { x, z }` + `cyco-input-jump` during play only

---

## Phase 5: Add Component System

18. Component data stored in `object.userData.physics.components` = `[{ type, ...params }]`

| Component | Key params |
|-----------|-----------|
| Rigid Body | bodyType (dynamic / static / kinematic), mass, linearDamping, angularDamping |
| Box Collider | halfExtents, isTrigger, restitution, friction |
| Sphere Collider | radius, isTrigger, restitution, friction |
| Capsule Collider | halfHeight, radius, isTrigger, restitution, friction |
| Mesh Collider | mode (convexHull / trimesh), isTrigger |
| Bounding Box | auto-computed from geometry, display only |
| Character Controller | offset, maxSlopeAngle, autoStepHeight, snapToGround |
| Joint | type (fixed / spherical / revolute / prismatic), targetUuid, axis, limits |
| Ragdoll | preset (humanoid / quadruped) — UI stub until Phase 11 |

19. Non-uniform scale warning: emit console warning + use world-geometry bounding box, not raw scale
20. Add "Add Component" full-width button at bottom of `ObjectProperties.js`
21. Create `editor/src/ui/ComponentPicker.js` — floating panel, real-time search, grouped list, draggable + resizable
22. Each component renders as collapsible section in ObjectProperties with `×` remove button
23. `PhysicsManager._buildBodies()` reads the components array to construct correct Rapier bodies and colliders

---

## Phase 6: Debug Wireframe

24. `PhysicsManager._createDebugRenderer(scene)` — `THREE.LineSegments` from `world.debugRender()` output, updated per frame when enabled
25. `setDebugEnabled(bool)` public toggle
26. "Physics Debug" toggle in `ViewportContextMenu.js`

---

## Phase 7: Raycasting & Trigger Volumes

27. `PhysicsManager.raycast(origin, dir, maxToi)` → `{ hit, toi, normal, objectUuid }` via `world.castRay()`
28. `PhysicsManager.shapeCast(shape, pos, rot, dir, maxToi)`
29. Trigger enter/exit in `_step()` via `world.intersectionPairsWith()` with prev-frame state tracking → `cyco-physics-trigger { objectUuid, otherUuid, state }`
30. Collision events via `world.contactPairsWith()` → `cyco-physics-collision { objectUuid, otherUuid }`

---

## Phase 8: Character Controller

31. `_createCharacterController(object3d, config)` — wraps Rapier `KinematicCharacterController`
32. `moveCharacter(uuid, desiredMovement, delta)` — `computeColliderMovement()` → `setNextKinematicTranslation()`
33. `PhysicsManager` listens to `cyco-input-move` / `cyco-input-jump` during play and routes to controller

---

## Phase 9: Joints

34. `PhysicsManager._buildJoints(scene)` — runs after `_buildBodies()`, creates Rapier `ImpulseJoint` between body pairs from Joint component configs
35. Supports: fixed, spherical, revolute, prismatic

---

## Phase 10: 2D Physics Mode

36. `init()` branches on `mode === '2d'` → dynamic-imports `@dimforge/rapier2d-compat`
37. 2D transform sync in `_syncTransforms()`:
    - `plane2d === 'xy'`: Rapier `(x, y)` → Three.js `(x, y, 0)`, angle → Z-axis Euler
    - `plane2d === 'xz'`: Rapier `(x, y)` → Three.js `(x, 0, z)`, angle → Y-axis Euler
38. 2D collider shapes: `cuboid(hw, hh)`, `ball(r)`, `capsule(hl, r)`

---

## Phase 11: Ragdoll

*Depends on Phase 9 — Joints must be complete and stable.*

39. Create `editor/src/viewport/RagdollBuilder.js`:
    - Humanoid preset: spine, neck, head, upper/lower arms, upper/lower legs, hands, feet (capsule colliders + revolute/spherical joints with angle limits)
    - Quadruped preset: spine, neck, head, 4× upper/lower legs, tail
40. `PhysicsManager._buildRagdoll(object3d, preset)` — calls RagdollBuilder, registers all sub-bodies + joints under parent UUID
41. `_syncRagdoll(uuid)` in `_syncTransforms()` — writes Rapier transforms back to SkinnedMesh bone matrices
42. `dispose()` extended to clean up all ragdoll sub-bodies
43. `ComponentPicker` Ragdoll entry fully enabled — remove "(Advanced)" stub label

---

## Files to Create or Modify

| File | Change |
|------|--------|
| `editor/src/viewport/PhysicsManager.js` | NEW |
| `editor/src/viewport/PhysicsEditHelper.js` | NEW |
| `editor/src/viewport/RagdollBuilder.js` | NEW (Phase 11) |
| `editor/src/ui/PhysicsWorldWindow.js` | NEW |
| `editor/src/ui/InputManagerWindow.js` | NEW |
| `editor/src/ui/ComponentPicker.js` | NEW |
| `editor/src/viewport/GameRuntime.js` | Wire init/dispose |
| `editor/src/viewport/ViewportEngine.js` | Instantiate PhysicsManager + PhysicsEditHelper |
| `editor/src/viewport/InputManager.js` | Play-mode physics input |
| `editor/src/properties/ObjectProperties.js` | Add Component button + component sections |
| `editor/src/viewport/ViewportContextMenu.js` | Physics Debug toggle |
| `editor/src/viewport/SceneManager.js` | physicsMode / gravity / plane2d metadata |
| `editor/src/ui/MenuBar.js` | Physics entry in Environment dropdown |
| `editor/src/main.js` | Wire input-manager + physics window actions |
| `editor/index.html` | Import map entries for Rapier |
| `editor/libs/rapier3d/` | NEW — Rapier3D ESM + WASM |
| `editor/libs/rapier2d/` | NEW — Rapier2D ESM + WASM |

---

## Verification Checklist

- [ ] Environment → Physics window opens and 3D/2D settings save to scene
- [ ] Input Manager button opens window; Physics Input key rebinds persist
- [ ] Play button initializes physics; Stop fully restores editor scene
- [ ] Physics Edit Mode shows collider overlays in editor without pressing play
- [ ] Add Component picker opens, search filters in real time, Rigid Body section appears
- [ ] Non-uniform scale object shows console warning when body is built
- [ ] Static floor + Dynamic sphere → sphere falls and stops during play
- [ ] 2D mode XY → object falls on Y axis only, no Z drift
- [ ] Character Controller → WASD + Space work during play
- [ ] Trigger volume → `cyco-physics-trigger` fires on enter/exit
- [ ] Revolute joint → hinge rotates correctly during play
- [ ] Physics Debug toggle → Rapier collider wireframes visible during play
- [ ] Ragdoll on SkinnedMesh → bones collapse under gravity during play
- [ ] Play → Stop → Play again → no body duplication, no memory leaks
