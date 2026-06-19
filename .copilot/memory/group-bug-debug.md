# Group / Folder duplicate bug — debug logging

## Symptom
Clicking "Group Selected" in the hierarchy (or the Group button in the multi-select
properties panel) creates TWO group folders nested inside each other:
`Scene → Group N → Group N → [objects]`

## Debug flag
A new runtime flag gates all the debug logs. From the devtools console:

```js
window.__CYCO_GROUP_DEBUG = true   // enable
window.__CYCO_GROUP_DEBUG = false  // disable (default)
```

## Instrumented files
- `editor/src/panels/LeftPanel.js`
  - `LeftPanel` constructor → `LeftPanel:new` (per-instance id)
  - `_addWindowListener` → `listener-registered` / `listener-dedup`
  - `_onAction` → `_onAction` (which action fired)
  - `_onHierarchyAdd` → `_onHierarchyAdd:enter` / `:pushed`
  - `_group()` → `_group:enter` (with stack + instanceId) → `:targetParent`
    → `:create-empty` → `:after-addObject` → `:step4-selection`
    → `:dispatch-select` → `:done`
- `editor/src/panels/BasePanel.js`
  - `init()` → `BasePanel.init` (catches duplicate init on same instance)
- `editor/src/viewport/SceneManager.js`
  - `addObject()` → logs every `cyco-hierarchy-add` dispatch with stack
- `editor/src/panels/RightPanel.js`
  - Group button click → `dispatch:source=RightPanel:group-button`
- `editor/src/viewport/ViewportContextMenu.js`
  - Group Selected menu item → `dispatch:source=ViewportContextMenu:Group-Selected`

## What to look for in logs
1. `LeftPanel:new` count vs `listener-registered` count for `cyco-action`
   — if there are 2 LeftPanel instances but only 1 listener-registered,
   the second instance's listener is being added and both fire.
2. `_onAction` count per click — should be 1.
3. `_group:enter` count per `_onAction` — should be 1.
4. `BasePanel.init` per panel id — should be 1.
5. `SceneManager.addObject` per click — should be 1.

## Remove when done
All added log lines check `window.__CYCO_GROUP_DEBUG` first, so they cost
nothing in production. The flag itself, the `_glog` helper, the
`_groupCallSeq` / `_leftPanelInstanceSeq` counters, and the per-instance
`_instanceId` field can all stay in place; they have no runtime cost when
the flag is off.
