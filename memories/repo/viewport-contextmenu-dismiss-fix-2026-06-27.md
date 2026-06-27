# Viewport context menu dismiss — Cycle Modeler

**Date:** 2026-06-27
**Files:** [editor/src/viewport/ViewportContextMenu.js](../../editor/src/viewport/ViewportContextMenu.js)

## Problem
Right-click in the viewport opens a context menu. Clicking outside
the menu in Cycle Modeler did NOT close it.

## Root Cause
`ViewportContextMenu` registered the outside-click dismiss handler on
`document` in the default (bubble) phase. `CycleModelerController`
registers its `_onPointerDown` on the canvas with `{ capture: true }`
and calls `event.stopImmediatePropagation()` whenever the user starts
a primitive draw (or push-pull / extrude-edge / etc.) in the modeler.
`stopImmediatePropagation` on a capture-phase canvas listener halts
the event before it ever reaches `document` in the bubble phase, so
`_onDismiss` never ran and the menu stayed open.

## Fix
Listen for `pointerdown` on `window` in CAPTURE phase. Window-capture
runs before any other capture-phase handler, so the dismiss fires
first and the menu hides before any subsequent `stopImmediatePropagation`
can block it.

```js
// before
document.addEventListener('pointerdown', this._onDismiss);
document.removeEventListener('pointerdown', this._onDismiss);

// after
window.addEventListener('pointerdown', this._onDismiss, { capture: true });
window.removeEventListener('pointerdown', this._onDismiss, { capture: true });
```

## Lesson
When other systems call `stopImmediatePropagation` in capture phase
on a deep element, dismiss/popup handlers should attach on `window`
in capture phase (or use a custom event dispatched at the source)
to guarantee they always fire.
