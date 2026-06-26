# Wireframe Default Visibility Fix (2026-06-29) — White + 2px + Opaque

## Regression

User reported: "When I select Wire Frame by itself, the shape
disappears in its entire entirety." The shape was being drawn but
with a near-black color (`#151515`) and 1-pixel thickness, so the
wireframe was invisible against the dark scene background. Solid and
Solid+Wire modes were unaffected because the contrast against the
light-gray mesh made the dark lines visible.

## Root cause

The wireframe factory defaults in `MODELER_SETTINGS_DEFAULTS`
([ModelerSettings.js](editor/src/CycoModeler/ModelerSettings.js)) were
chosen for Solid+Wire mode (where the mesh provides contrast):

```js
wireframe: {
  enabled:   true,
  color:     '#151515',   // dark gray → invisible on dark background
  thickness: 1,            // 1 screen pixel → MSAA eats most of it
  opacity:   0.85,         // 15% transparent → fades further
}
```

In **Wire-Only mode** the mesh is hidden (`mat.visible = false`), so
the wireframe is drawn directly against the dark scene background
(`#1a1a1a`). The dark gray 1-px line at 85% opacity is essentially
indistinguishable from the background.

The same default was also hard-coded as the initial value in
`CycleModelerController` (`color: 0x151515, thickness: 1`).

## Fix

Two coordinated changes:

1. **Factory defaults** in [ModelerSettings.js](editor/src/CycoModeler/ModelerSettings.js#L68-L75):
   - `color: '#ffffff'` (white — high contrast on any background)
   - `thickness: 2` (2 px — survives MSAA without becoming a slab)
   - `opacity: 1.0` (fully opaque — no fade against dark bg)

2. **Controller initial value** in [CycleModelerController.js:45](editor/src/CycoModeler/CycleModelerController.js#L45):
   - Same `color: 0xffffff, thickness: 2, opacity: 1.0`
   - Used before `ModelerSettings.applyModelerSettingsToScene()` runs
     on the first frame; matches the factory defaults so the first
     paint and subsequent paints are consistent.

The earlier Solid+Wire back-face fix (`FrontSide` on committed
primitives, see `solid-wire-backface-cull-2026-06-29.md`) is
unchanged — Solid+Wire mode now shows the wireframe against a light
mesh AND the user can't see through the mesh to the inside.

## Verification

Manual: created a box on the grid, toggled all three wire modes:

- **Solid**: mesh only, no wireframe → unchanged.
- **Solid + Wire**: opaque mesh + bright white wireframe edges.
  Cannot see through to the inside. ✓
- **Wire Only**: mesh hidden, bright white wireframe box clearly
  visible against the dark background. ✓

Regression: `tools/test-wireframe-bugs.mjs` and
`tools/test-primitive-bugs.mjs` still PASS.

## Out of scope

- Users who have saved custom wireframe settings via the modeler
  Settings panel (with "Make Default" or in a project file) keep
  their values — those override the factory defaults.
- Solid-Only mode was never affected by this regression.
