# Cycle Modeler — Right-Click Isolation (2026-06-27)

## Issue
When Cycle Modeler is active and a tool like push/pull / extrude / inset
/ bevel / etc. was selected, right-clicking on the object would still
run the modeler's `_onClick` handler (selecting a new face / edge /
vertex) and `_onPointerDown` (starting a push/pull drag). Right-click
should only open the viewport context menu — it must NOT mutate
selection or start any tool drag.

## Root Cause
The viewport fires `pointerdown`, `pointermove`, `pointerup`, AND
`click` for the right mouse button. `CycleModelerController._onPointerDown`,
`_onPointerMove`, and `_onClick` did not filter `event.button` /
`event.buttons`, so the right button was processed identically to the
left button.

`_canDrawPrimitive` already gated on `button === 0`, so primitive
drawers were unaffected.

## Fix
File: `editor/src/CycoModeler/CycleModelerController.js`

1. `_onPointerDown` — early return when `event.button !== 0`.
2. `_onPointerMove` — early return when right button held
   (`(event.buttons & 2) !== 0`).
3. `_onClick` — early return when `event.button !== 0`.

The viewport context menu is dispatched independently via the
`cyco-vp-contextmenu` CustomEvent in `ViewportEngine.js` and does not
depend on these handlers, so right-click still opens the context menu.