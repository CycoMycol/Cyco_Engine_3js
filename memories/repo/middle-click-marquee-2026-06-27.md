# middle-click marquee (2026-06-27)

## Feature
In cycle modeler, **middle-click drag** now starts the element-level
marquee multi-select in polygon / edge / vertex modes. Left-click drag
keeps the same behavior. Middle-click in **object mode** still falls
through to OrbitControls' middle-button pan (no marquee).

## Files
- `editor/src/CycoModeler/CycleModelerController.js`
  - `_onPointerDown` — middle-button branch in element mode (line ~534)
    calls `_startElementMarquee(event)`.
  - Element-marquee trigger block (line ~654) accepts `button === 1`
    in addition to `button === 0`.
- `tools/test-middle-click-marquee.mjs` — regression test.

## Why two edits
The cycle model's pointer pipeline has TWO paths into
`_startElementMarquee`:

1. **Empty-space fallthrough** in the push-pull branch
   (line ~581 — when no modeler hit) — the original
   middle/right early-return runs FIRST, so we have to intercept
   middle BEFORE that return (the first edit at ~line 534).
2. **Direct element-marquee trigger** (line ~654) — explicit
   `event.button === 0` check needs to also accept button 1.

## Unchanged behavior
- Object mode: middle-click still routes to OrbitControls pan.
- Right-click: still routes to context menu (button 2 ignored).
- Push-pull / extrude-edge / primitive drawers: still left-only.
- `_onClick` (button 0 only) — no change; middle-button release
  does not fire synthetic click in Chromium.
- OrbitControls' middle-pan: still works in object mode and on
  empty space; only blocked when a middle-click STARTS on a
  modeler object in an element mode (same gate as before, but
  now the gesture is a marquee instead of a pan).
