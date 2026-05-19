/**
 * BaseModule.js — shared base for all Game Manager modules.
 * Handles the sub-type sidebar wiring, DataTable ↔ RecordForm ↔ CardView lifecycle,
 * and all ProjectManager CRUD calls.
 *
 * Subclasses define `moduleKey` and `subTypes` and call `super()`.
 */

import { DataTable }   from './DataTable.js';
import { RecordForm }  from './RecordForm.js';
import { CardView }    from './CardView.js';
import { SCHEMAS, blankRecord, generateId } from './GameDataSchemas.js';
import ProjectManager  from '../../project/ProjectManager.js';

export class BaseModule {
  /**
   * @param {string} moduleKey  — e.g. 'inventory'
   * @param {Array}  subTypes   — [{ key, label }, …]
   */
  constructor(moduleKey, subTypes) {
    this._moduleKey  = moduleKey;
    this._subTypes   = subTypes;
    this._activeKey  = subTypes[0]?.key || null;

    // Per-subType component instances
    this._tables  = {};  // subTypeKey → DataTable
    this._forms   = {};  // subTypeKey → RecordForm
    this._cards   = {};  // subTypeKey → CardView
    this._viewMode = {}; // subTypeKey → 'list'|'cards'

    this._el       = this._buildShell();
    this._initSubTypes();
    if (this._activeKey) this._activate(this._activeKey);
  }

  get element() { return this._el; }

  // ── Build sidebar ───────────────────────────────────────────────────────────

  _buildShell() {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex:1;overflow:hidden;';

    this._sidebar = document.createElement('div');
    this._sidebar.className = 'ce-gm-sidebar';

    for (const st of this._subTypes) {
      const item = document.createElement('div');
      item.className = 'ce-gm-sidebar-item';
      item.textContent = st.label;
      item.dataset.key = st.key;
      item.addEventListener('click', () => this._activate(st.key));
      this._sidebar.appendChild(item);
    }

    this._contentArea = document.createElement('div');
    this._contentArea.className = 'ce-gm-content';

    wrap.appendChild(this._sidebar);
    wrap.appendChild(this._contentArea);
    return wrap;
  }

  // ── Init components for each sub-type ──────────────────────────────────────

  _initSubTypes() {
    for (const st of this._subTypes) {
      const schema = SCHEMAS[this._moduleKey]?.[st.key] || [];
      const key    = st.key;

      const table = new DataTable({
        schema,
        records: ProjectManager.getGameRecords(this._moduleKey, key),
        onSelect:    (rec) => this._onSelect(key, rec),
        onAdd:       ()    => this._onAdd(key),
        onDelete:    (rec) => this._onDelete(key, rec),
        onDuplicate: (rec) => this._onDuplicate(key, rec),
        onViewChange:(mode)=> this._onViewChange(key, mode),
      });

      const form = new RecordForm({
        schema,
        onChange: (rec) => this._onFormChange(key, rec),
      });

      const cards = new CardView({
        schema,
        records: ProjectManager.getGameRecords(this._moduleKey, key),
        onSelect: (rec) => this._onSelect(key, rec),
      });

      this._tables[key]   = table;
      this._forms[key]    = form;
      this._cards[key]    = cards;
      this._viewMode[key] = 'list';
    }
  }

  // ── Activate a sub-type ─────────────────────────────────────────────────────

  _activate(key) {
    this._activeKey = key;

    // Update sidebar highlights
    for (const item of this._sidebar.querySelectorAll('.ce-gm-sidebar-item')) {
      item.classList.toggle('is-active', item.dataset.key === key);
    }

    // Rebuild content area for this sub-type
    this._contentArea.innerHTML = '';
    this._contentArea.style.setProperty('--gm-list-height', '45%');

    const table = this._tables[key];
    const form  = this._forms[key];
    const cards = this._cards[key];
    const mode  = this._viewMode[key];

    // List pane: either table or card grid
    const listPane = table.element;   // already has toolbar + table
    const cardWrap = document.createElement('div');
    cardWrap.className = 'ce-gm-list-pane';
    cardWrap.style.cssText = 'overflow:auto;';
    cardWrap.appendChild(cards.element);

    listPane.style.display  = mode === 'list'  ? '' : 'none';
    cardWrap.style.display  = mode === 'cards' ? '' : 'none';

    this._contentArea.appendChild(listPane);
    this._contentArea.appendChild(cardWrap);

    // Divider
    const divider = document.createElement('div');
    divider.className = 'ce-gm-divider';
    this._contentArea.appendChild(divider);
    this._setupDividerDrag(divider);

    // Form pane
    this._contentArea.appendChild(form.element);

    this._activeDivider = divider;
    this._activeCardWrap = cardWrap;

    // Refresh records from ProjectManager
    this._refreshRecords(key);
  }

  // ── Divider drag logic ──────────────────────────────────────────────────────

  _setupDividerDrag(divider) {
    let startY, startH, contentH;

    const onMove = (e) => {
      const dy      = (e.clientY || e.touches?.[0]?.clientY) - startY;
      const newH    = Math.min(Math.max(startH + dy, 120), contentH - 120 - 4);
      const pct     = (newH / contentH * 100).toFixed(1) + '%';
      this._contentArea.style.setProperty('--gm-list-height', pct);
      try { localStorage.setItem('cyco-gm-split', pct); } catch {}
    };

    const onUp = () => {
      divider.classList.remove('is-dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    divider.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const rect = this._contentArea.getBoundingClientRect();
      contentH   = rect.height;
      const listEl = this._tables[this._activeKey]?.element;
      startH     = listEl ? listEl.getBoundingClientRect().height : contentH * 0.45;
      startY     = e.clientY;
      divider.classList.add('is-dragging');
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    // Restore saved split
    try {
      const saved = localStorage.getItem('cyco-gm-split');
      if (saved) this._contentArea.style.setProperty('--gm-list-height', saved);
    } catch {}
  }

  // ── CRUD event handlers ─────────────────────────────────────────────────────

  _onSelect(key, record) {
    this._forms[key].load(record);
    this._cards[key].selectById(record.id);
  }

  _onAdd(key) {
    const schema = SCHEMAS[this._moduleKey]?.[key] || [];
    const record = blankRecord(schema);
    ProjectManager.saveGameRecord(this._moduleKey, key, record);
    this._refreshRecords(key);
    this._tables[key].selectById(record.id);
  }

  _onDelete(key, record) {
    ProjectManager.deleteGameRecord(this._moduleKey, key, record.id);
    this._forms[key].clear();
    this._tables[key].clearSelection();
    this._cards[key].clearSelection();
    this._refreshRecords(key);
  }

  _onDuplicate(key, record) {
    const clone = JSON.parse(JSON.stringify(record));
    clone.id    = generateId();
    if (clone.name) clone.name = clone.name + ' (Copy)';
    ProjectManager.saveGameRecord(this._moduleKey, key, clone);
    this._refreshRecords(key);
    this._tables[key].selectById(clone.id);
  }

  _onFormChange(key, updatedRecord) {
    ProjectManager.saveGameRecord(this._moduleKey, key, updatedRecord);
    // Refresh list display (name/color may have changed)
    this._refreshRecords(key, updatedRecord.id);
  }

  _onViewChange(key, mode) {
    this._viewMode[key] = mode;
    const table    = this._tables[key]?.element;
    const cardWrap = this._activeCardWrap;
    if (table)    table.style.display    = mode === 'list'  ? '' : 'none';
    if (cardWrap) cardWrap.style.display = mode === 'cards' ? '' : 'none';
  }

  // ── Refresh records from storage ────────────────────────────────────────────

  _refreshRecords(key, preserveSelectedId = null) {
    const records = ProjectManager.getGameRecords(this._moduleKey, key);
    this._tables[key].update(records);
    this._cards[key].update(records);

    // Re-highlight the same row after list refresh (no form reload)
    if (preserveSelectedId) {
      this._tables[key].highlightById(preserveSelectedId);
    }
  }

  /** Called by GameManagerWindow when a project change event fires. */
  reload() {
    for (const st of this._subTypes) {
      const records = ProjectManager.getGameRecords(this._moduleKey, st.key);
      this._tables[st.key].update(records);
      this._cards[st.key].update(records);
    }
    this._forms[this._activeKey]?.clear();
  }
}
