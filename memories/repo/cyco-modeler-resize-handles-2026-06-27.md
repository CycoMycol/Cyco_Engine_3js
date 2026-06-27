# Cyco Modeler resize handles — clipping bug

**Date:** 2026-06-27

## Problem
Added three resize handles to `.cyco-modeler-panel` (cyco modeler inspector):
- `.cyco-modeler-resize-handle` — left edge, width
- `.cyco-modeler-resize-handle-h` — bottom edge, height (positioned `bottom: -4px`)
- `.cyco-modeler-resize-handle-c` — bottom-right corner (positioned `right/bottom: -4px`)

The panel had `overflow: auto`, which clipped the bottom and corner handles
that extended past the panel's content box. From the user's perspective the
handles appeared "inside" the dropdown menu (Confirm/Cancel/UV Editor).

## Fix
- `.cyco-modeler-panel`: changed `overflow: auto` → `overflow: visible`.
- Wrapped the panel's scrollable content (header, sections, fields, actions)
  in a new `.cyco-modeler-panel-body` div with `overflow: auto`.
- Made the handles visually discoverable: faint orange background by default,
  stronger on hover.

## Files
- editor/src/panels/CenterPanel.js (`_buildModelerInspector`)
- editor/src/theme/cyco-theme.css (`.cyco-modeler-panel`, `.cyco-modeler-panel-body`, resize-handle rules)
