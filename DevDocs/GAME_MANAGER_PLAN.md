# Game Manager Data Table — Implementation Plan

## Overview

Build a full-screen Game Manager overlay triggered by the existing `cyco-action → 'game-manager'` toolbar event. Uses an Unreal Engine-style split layout: resizable data table on top, Row Editor form panel on bottom. Contains 4 module tabs (Inventory, Stats, Quests, Shop & Trade), each with a sub-type sidebar. Auto-saves to `ProjectManager.gameData` on every change (debounced 300ms). Inventory module is built end-to-end first as the reference implementation, then the pattern is stamped across remaining modules. Grid/spreadsheet view is deferred to Phase 5.

---

## Layout Reference

```
┌─────────────────────────────────────────────────────────────────────┐
│  Game Manager                                          [≡][⊞]  [×]  │  Header (40px)
├──────────────────────────────────────────────────────────────────────┤
│  Inventory  │  Stats  │  Quests  │  Shop & Trade                    │  Module Tabs
├────────────┬─────────────────────────────────────────────────────────┤
│  Items     │  [+ Add] [Duplicate] [Delete]    [search…]  [≡ List ▾] │  List Toolbar
│  Bags      │ ──────────────────────────────────────────────────────  │
│  Currencies│  Row Name    │  Color   │  Max Stack │  Weight         │  ← sortable
│  Equipment │  Iron Sword  │  ██████  │  1         │  3.5            │
│  Loot Table│  ▶ Gold Ring │  ██████  │  10        │  0.1            │  ← selected row
│  Merchants │                                                         │
│            ├─────────────────────── drag ──────────────────────────┤  Divider (4px)
│  (sidebar  │  Row Editor — Iron Sword  [id: a1b2c3]                 │
│   160px)   │                                                         │
│            │  Name          [Iron Sword              ]              │
│            │  Description   [A basic sword           ]              │
│            │  Color         [██] #c0c0c0                            │
│            │  Max Stack     [1]                                      │
│            │  Weight        [3.5]                                    │
│            │  Properties    [+ Add Row]                              │
│            │    damage │ 25 │ Attack damage   │ [✕]                 │
└────────────┴─────────────────────────────────────────────────────────┘
```

---

## Data Shape (`ProjectManager.gameData`)

```js
{
  inventory: {
    items:       [],   // Item records
    bags:        [],   // Bag definitions
    currencies:  [],   // Currency definitions
    equipment:   [],   // Equipment slot sets
    lootTables:  [],   // Loot table definitions
    merchants:   []    // Merchant configurations
  },
  stats: {
    stats:         [],  // Stat definitions
    attributes:    [],  // Attribute definitions
    classes:       [],  // Class definitions
    statusEffects: [],  // Status effect definitions
    formulas:      [],  // Formula definitions
    statModifiers: []   // Stat modifier definitions
  },
  quests: {
    quests: []          // Quest definitions (tasks embedded as sub-list)
  },
  shop: {
    shops:    [],       // Shop configurations
    auctions: [],       // Auction house configurations
    trades:   []        // Trade route definitions
  }
}
```

---

## Phase 1 — Foundation
*Steps are sequential.*

### Step 1 — `GameDataSchemas.js` *(NEW)*
**File:** `editor/src/ui/game-manager/GameDataSchemas.js`

- `generateId()` — uses `crypto.randomUUID()` with a `Math.random`-based fallback
- `EMPTY_GAME_DATA` — the default blank `gameData` shape used when creating or opening a project
- All 16 record type schemas as arrays of field descriptors

**Field descriptor shape:**
```js
{ key, label, type, default, required, summary, options }
// summary: true  →  column appears in the DataTable top list pane
// type options: 'text' | 'number' | 'color' | 'boolean' | 'select' | 'textarea' | 'sublist'
// options: array of { value, label } — used by 'select' type
// sublist: { fields: [...field descriptors] }  — used by 'sublist' type
```

**Complete record schemas:**

| Schema | Key Fields (summary) | Other Fields |
|--------|---------------------|--------------|
| Item | id, name, color | description, parent(select→items), width, height, weight, maxStack, price(currency+amount), properties(sublist), sockets(sublist), equipmentSlots(tags) |
| Bag | id, name, type(list/grid) | maxWeight, maxHeight, equipmentId, stock(sublist: itemId+amount), wealth(sublist: currencyId+amount) |
| Currency | id, name | coins(sublist: name+symbol+value) |
| Equipment | id, name | slots(sublist: slot name) |
| LootTable | id, name | entries(sublist: itemId+minAmt+maxAmt+weight) |
| Merchant | id, name | shopId, infiniteCurrency(bool), infiniteStock(bool), allowBuyBack(bool), buyRate(num), sellRate(num) |
| Stat | id, name, acronym | description, baseValue(num), formulaId(text), color, icon |
| Attribute | id, name, acronym | description, minValue(num), maxValue(num), color, icon |
| Class | id, name | description, traits(sublist: statOrAttributeId+baseValue) |
| StatusEffect | id, name, color | description, icon, hasDuration(bool), duration(num), stacks(bool) |
| Formula | id, name | expression(textarea) |
| StatModifier | id, name | targetStatId, operation(select: add/multiply/override), value(num), condition(text) |
| Quest | id, name | description, icon, status(select: inactive/active/complete/failed), tasks(sublist: taskId) |
| Shop | id, name | currencyId, buyRate(num), sellRate(num), infiniteStock(bool), listings(sublist: itemId+price+stock) |
| Auction | id, name | currencyId, listingFee(num), defaultDuration(num), listings(sublist: itemId+startPrice+buyoutPrice+duration) |
| Trade | id, name | giveItems(sublist: itemId+amount), receiveItems(sublist: itemId+amount) |

---

### Step 2 — Extend `ProjectManager` *(MODIFY)*
**File:** `editor/src/project/ProjectManager.js`

- On `create()` and `openById()`: if `project.gameData` is missing, deep-merge `EMPTY_GAME_DATA` (migration-safe — existing projects without gameData get it added on next open)
- New methods:
  - `getGameRecords(module, subType)` — returns array from `gameData[module][subType]` or `[]`
  - `saveGameRecord(module, subType, record)` — upserts by `record.id` into the array, then calls the internal `_save()` method
  - `deleteGameRecord(module, subType, id)` — splices by `id`, then calls `_save()`

---

### Step 3 — Wire `cyco-action` Event *(MODIFY)*
**File:** `editor/src/main.js`

```js
import GameManager from './ui/GameManager.js';

document.addEventListener('cyco-action', (e) => {
  if (e.detail === 'game-manager') GameManager.open();
});
```

---

### Step 4 — CSS *(MODIFY)*
**File:** `editor/src/theme/cyco-theme.css`

New CSS sections to append:

| Selector | Purpose |
|----------|---------|
| `.ce-gm-overlay` | Fixed full-screen backdrop, `z-index: 1000`, semi-transparent dark bg |
| `.ce-gm-window` | Fixed `inset: 20px`, flex column, themed bg + border |
| `.ce-gm-header` | 40px title bar, close button far right |
| `.ce-gm-module-tabs` | Top tab strip, accent underline on active tab |
| `.ce-gm-body` | Flex row: sidebar + content area |
| `.ce-gm-sidebar` | 160px sub-type nav list |
| `.ce-gm-content` | Flex column: list pane + divider + form pane |
| `.ce-gm-list-pane` | Top half — height driven by `--gm-list-height` CSS var (default: 45%) |
| `.ce-gm-divider` | 4px horizontal resize handle, `cursor: row-resize` |
| `.ce-gm-form-pane` | Bottom half — scrollable Row Editor |
| `.ce-gm-table` | Data table, sticky `<thead>`, sortable column highlight |
| `.ce-gm-card-grid` | Responsive card grid (`repeat(auto-fill, minmax(140px, 1fr))`) |
| `.ce-gm-field` | Form field wrapper (label + input row) |
| `.ce-gm-sublist` | Mini-table for sublist fields, add/remove row controls |

All colors use existing `--ce-*` design tokens. No hardcoded colors.

---

## Phase 2 — Shared Components
*Steps 5–7 can be built in parallel. All depend on `GameDataSchemas.js` (Step 1).*

### Step 5 — `DataTable.js` *(NEW)*
**File:** `editor/src/ui/game-manager/DataTable.js`

Constructor: `new DataTable({ schema, records, onSelect, onAdd, onDelete, onDuplicate })`

- Renders a toolbar: `[+ Add]` `[Duplicate]` `[Delete]` | `[search input]` | `[≡ List ▾ / ⊞ Cards]` view toggle
- Renders `<table>` with sticky `<thead>` (sortable columns) and `<tbody>` (one `<tr>` per record)
- Columns: schema fields with `summary: true` (typically 4–5 columns)
- Row click → calls `onSelect(record)`; active row gets `.is-selected` class
- Column header click → toggles sort asc/desc, re-renders `<tbody>`
- Search input → filters rows by matching any string field value
- `update(records)` method — re-renders body without rebuilding table chrome

---

### Step 6 — `RecordForm.js` *(NEW)*
**File:** `editor/src/ui/game-manager/RecordForm.js`

Constructor: `new RecordForm({ schema, onChange })`

- Renders the `.ce-gm-form-pane` content: "Row Editor" label + record ID display
- `load(record)` — populates all fields from a record object
- `clear()` — empties form, shows placeholder "Select a record to edit"
- For each schema field, renders the appropriate input:
  - `text` → `<input type="text">`
  - `number` → `<input type="number">`
  - `color` → uses existing `CeColorPicker.js`
  - `boolean` → `<input type="checkbox">`
  - `select` → `<select>` populated from `field.options`
  - `textarea` → `<textarea>`
  - `sublist` → mini-table: one row per sub-record, inline inputs per sub-field, `[+ Add Row]` button, `[✕]` remove per row
- Collects the full record on any change → calls `onChange(updatedRecord)` debounced 300ms
- **No Save button** — auto-save via `onChange`

---

### Step 7 — `CardView.js` *(NEW)*
**File:** `editor/src/ui/game-manager/CardView.js`

Constructor: `new CardView({ schema, records, onSelect })`

- Renders `.ce-gm-card-grid` with one card per record
- Each card: icon placeholder square + name (bold) + values of the first 2 summary fields
- Clicking a card → `onSelect(record)`; selected card gets `.is-selected` border
- `update(records)` — re-renders grid

---

## Phase 3 — Inventory Module End-to-End
*This phase proves the full wiring pattern. Steps 8–10 are sequential.*

### Step 8 — `InventoryModule.js` *(NEW)*
**File:** `editor/src/ui/game-manager/InventoryModule.js`

Sub-types (sidebar): Items | Bags | Currencies | Equipment | Loot Tables | Merchants

Each sub-type:
1. Gets its schema from `GameDataSchemas`
2. Creates a `DataTable` instance (placed in `.ce-gm-list-pane`)
3. Creates a `RecordForm` instance (placed in `.ce-gm-form-pane`)
4. Creates a `CardView` instance (hidden by default)
5. Wires:
   - `DataTable.onSelect` → `RecordForm.load(record)`
   - `RecordForm.onChange` → `ProjectManager.saveGameRecord('inventory', subType, record)` + `DataTable.update(...)`
   - `DataTable.onAdd` → create new record (`generateId()` + schema defaults) → `saveGameRecord` → select it
   - `DataTable.onDelete` → `ProjectManager.deleteGameRecord('inventory', subType, id)` → `RecordForm.clear()` → `DataTable.update(...)`
   - `DataTable.onDuplicate` → clone record with new `generateId()` → `saveGameRecord` → select clone
6. On sub-type tab switch → swap active schema/table/form

`load()` method — called by `GameManagerWindow` on project change; refreshes all sub-type record lists from `ProjectManager`.

---

### Step 9 — `GameManagerWindow.js` *(NEW)*
**File:** `editor/src/ui/GameManagerWindow.js`

- Builds the full DOM tree: `.ce-gm-overlay` > `.ce-gm-window`
- **Header:** "Game Manager" title (left) + close `[×]` button (right)
- **Module tabs:** Inventory | Stats | Quests | Shop & Trade — switches active module
- **Body:** `.ce-gm-sidebar` (sub-type nav, populated by active module) + `.ce-gm-content` (module view)
- **Resizable divider:**
  - `mousedown` on `.ce-gm-divider` → begin tracking
  - `mousemove` → compute new height % → set `--gm-list-height` CSS var on `.ce-gm-content`
  - `mouseup` → stop; save split position to `localStorage['cyco-gm-split']`
  - On init: restore saved split position, default 45%
  - Min 120px for both panes (enforced in mousemove handler)
- **`setModule(name)`** — detaches old module, attaches new module's element, updates sidebar
- **`setViewMode(mode)`** — calls active module's `setViewMode('list' | 'cards')`
- **Escape key** → closes overlay (bound on show, unbound on hide)

---

### Step 10 — `GameManager.js` *(NEW)*
**File:** `editor/src/ui/GameManager.js`

```js
// Singleton pattern
const GameManager = {
  _window: null,
  open()  { /* lazy-init window, append to body, show */ },
  close() { /* hide overlay */ },
  isOpen() { /* boolean */ }
};

// On project change → reload data
document.addEventListener('cyco-project-change', () => {
  if (GameManager.isOpen()) GameManager._window.reload();
});

export default GameManager;
```

---

## Phase 4 — Remaining Modules
*Steps 11–13 can be built in parallel. All follow the exact pattern from Step 8.*

### Step 11 — `StatsModule.js` *(NEW)*
**File:** `editor/src/ui/game-manager/StatsModule.js`

Sub-types: Stats | Attributes | Classes | Status Effects | Formulas | Stat Modifiers

Notable field details:
- **Class** `traits` field: sublist with `statOrAttributeId` (text) + `baseValue` (number)
- **Formula** `expression` field: textarea — plain text string (e.g. `"base * level + bonus"`)
- **StatModifier** `operation` field: select options — `add`, `multiply`, `override`
- **StatusEffect** has both `hasDuration` (boolean) and `duration` (number) — form shows/hides duration field based on `hasDuration` value

---

### Step 12 — `QuestsModule.js` *(NEW)*
**File:** `editor/src/ui/game-manager/QuestsModule.js`

Sub-types: Quests | Tasks

Notable structure:
- **Quest** `tasks` sublist contains task IDs (references to Task records)
- **Task** `pois` (points of interest) sublist: `{ name, x, y, z, radius }` — used for world-space quest markers
- Task `type` select: `count` (requires `targetValue`) or `boolean`

---

### Step 13 — `ShopModule.js` *(NEW)*
**File:** `editor/src/ui/game-manager/ShopModule.js`

Sub-types: Shops | Auction Houses | Trades

This is a custom Cyco Engine system (not in Game Creator 2):
- **Shop** `listings` sublist: `{ itemId, price, stock }` — `stock: -1` = infinite
- **Auction** `listings` sublist: `{ itemId, startPrice, buyoutPrice, duration }`
- **Trade** has two sub-lists: `giveItems` and `receiveItems`, each: `{ itemId, amount }`

---

## Phase 5 — Grid View *(Deferred)*
*Non-blocking. Ships after Phases 1–4 are fully working.*

### Step 14 — `GridView.js` *(NEW)*
**File:** `editor/src/ui/game-manager/GridView.js`

- Inline-editable spreadsheet: one `<tr>` per record, one `<td>` per schema field
- Cell click → activates an `<input>` overlay in that cell
- Keyboard navigation: Tab → next cell, Shift+Tab → previous, Enter → same column next row
- `blur` on input → save that field value → call `ProjectManager.saveGameRecord(...)`
- Column headers are resizable via `<th>` border drag
- Read-only for `sublist` fields (shows count badge instead)

---

## Files Summary

### New Files (13)
```
editor/src/ui/
  GameManager.js                          ← Singleton entry point
  GameManagerWindow.js                    ← Modal shell + UE split layout
  game-manager/
    GameDataSchemas.js                    ← All schemas + generateId() + EMPTY_GAME_DATA
    DataTable.js                          ← Top list pane (sort, search, CRUD toolbar)
    RecordForm.js                         ← Bottom form pane (auto-save, all field types)
    CardView.js                           ← Card gallery view
    InventoryModule.js                    ← Inventory: Items/Bags/Currencies/Equipment/LootTables/Merchants
    StatsModule.js                        ← Stats: Stats/Attributes/Classes/StatusEffects/Formulas/StatModifiers
    QuestsModule.js                       ← Quests: Quests/Tasks
    ShopModule.js                         ← Shop: Shops/Auctions/Trades
    GridView.js                           ← (Phase 5 — deferred)
```

### Modified Files (3)
```
editor/src/main.js                        ← Add cyco-action listener
editor/src/project/ProjectManager.js      ← Add gameData + CRUD methods
editor/src/theme/cyco-theme.css           ← Add all Game Manager styles
```

### Reused Existing Files
```
editor/src/ui/CeColorPicker.js            ← Used in RecordForm for color fields
editor/src/ui/ce-prompt.js               ← Used for rename/confirm dialogs
```

---

## Verification Checklist

- [ ] Click "Game Manager" toolbar button → full-screen overlay renders, no console errors
- [ ] Escape key and `[×]` button both dismiss the overlay
- [ ] Re-opening restores the last active module tab
- [ ] Drag the divider handle up/down → both panes resize, hard floor at 120px each
- [ ] Divider position persists across close/reopen (saved to `localStorage['cyco-gm-split']`)
- [ ] Add an Item → appears in list; survives page reload (check `localStorage` via DevTools)
- [ ] Edit any field → auto-saves within 300ms (verify in DevTools Application → Local Storage)
- [ ] Delete a record → removed from list and from storage
- [ ] Duplicate a record → new record appears with a new ID, all fields copied
- [ ] Cards toggle shows card grid; switching back to list retains row selection
- [ ] Sort by column header → rows re-order correctly
- [ ] Search filters rows in real time
- [ ] Sub-list fields: add row, fill fields, remove row — all save correctly
- [ ] New project → `gameData` is empty; all module lists show "No records"
- [ ] Switch between projects → each project has its own isolated `gameData`
- [ ] `cyco-project-change` event causes open Game Manager to reload its data
- [ ] All 4 module tabs open their correct module
- [ ] All sub-type sidebar items load their correct schema + records
- [ ] Status Effects: `duration` field hidden when `hasDuration` is unchecked

---

## Design Decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| Layout | UE-style top/bottom split | More horizontal space for wide forms (vs side-by-side) |
| Build order | Inventory end-to-end first | Proves the full wiring pattern before scaling |
| Save strategy | Auto-save on change, no Save button | Consistent with editor's auto-save layout behavior |
| UUID | `crypto.randomUUID()` + Math.random fallback | No external deps, no build system |
| Grid view | Deferred to Phase 5 | Most complex UX; not blocking core functionality |
| Icons/sprites | Stored as `null` / empty string | Asset browser integration is future work |
| Formulas | Plain text string field | No visual formula builder in v1 |
| Out of scope | Dialogue, Combat, Perception modules | Not selected by user for this build |
| Out of scope | Formula UI builder | Overly complex for v1; text field is sufficient |
