/**
 * DataTable.js — reusable top-list-pane component.
 * Renders a sortable, filterable table of records with a CRUD toolbar and view toggle.
 */

export class DataTable {
  /**
   * @param {Object} options
   * @param {Array}    options.schema       — field descriptors from GameDataSchemas
   * @param {Array}    options.records      — initial record array
   * @param {Function} options.onSelect     — (record) → void
   * @param {Function} options.onAdd        — () → void
   * @param {Function} options.onDelete     — (record) → void
   * @param {Function} options.onDuplicate  — (record) → void
   * @param {Function} options.onViewChange — (mode: 'list'|'cards') → void
   */
  constructor({ schema, records = [], onSelect, onAdd, onDelete, onDuplicate, onViewChange } = {}) {
    this._schema      = schema;
    this._records     = records;
    this._onSelect    = onSelect    || (() => {});
    this._onAdd       = onAdd       || (() => {});
    this._onDelete    = onDelete    || (() => {});
    this._onDuplicate = onDuplicate || (() => {});
    this._onViewChange = onViewChange || (() => {});

    this._selected    = null;
    this._sortKey     = null;
    this._sortAsc     = true;
    this._filter      = '';
    this._viewMode    = 'list';

    this._summaryFields = schema.filter(f => f.summary && f.key !== 'id');

    this._el = this._build();
  }

  get element() { return this._el; }
  get selected() { return this._selected; }

  // ── Build DOM ───────────────────────────────────────────────────────────────

  _build() {
    const wrap = document.createElement('div');
    wrap.className = 'ce-gm-list-pane';

    wrap.appendChild(this._buildToolbar());

    this._tableWrap = document.createElement('div');
    this._tableWrap.className = 'ce-gm-table-wrap';
    this._table = this._buildTable();
    this._tableWrap.appendChild(this._table);

    wrap.appendChild(this._tableWrap);
    return wrap;
  }

  _buildToolbar() {
    const bar = document.createElement('div');
    bar.className = 'ce-gm-list-toolbar';

    this._addBtn = this._btn('+ Add', 'is-primary');
    this._addBtn.addEventListener('click', () => this._onAdd());

    this._dupBtn = this._btn('Duplicate');
    this._dupBtn.disabled = true;
    this._dupBtn.addEventListener('click', () => { if (this._selected) this._onDuplicate(this._selected); });

    this._delBtn = this._btn('Delete');
    this._delBtn.disabled = true;
    this._delBtn.addEventListener('click', () => { if (this._selected) this._onDelete(this._selected); });

    const sep = document.createElement('div');
    sep.className = 'ce-gm-list-toolbar-sep';

    const spacer = document.createElement('div');
    spacer.className = 'ce-gm-list-toolbar-spacer';

    this._searchInput = document.createElement('input');
    this._searchInput.type = 'text';
    this._searchInput.placeholder = 'Search…';
    this._searchInput.className = 'ce-gm-search';
    this._searchInput.addEventListener('input', () => {
      this._filter = this._searchInput.value.trim().toLowerCase();
      this._renderBody();
    });

    const viewToggle = this._buildViewToggle();

    bar.appendChild(this._addBtn);
    bar.appendChild(sep);
    bar.appendChild(this._dupBtn);
    bar.appendChild(this._delBtn);
    bar.appendChild(spacer);
    bar.appendChild(this._searchInput);
    bar.appendChild(viewToggle);
    return bar;
  }

  _buildViewToggle() {
    const wrap = document.createElement('div');
    wrap.className = 'ce-gm-view-toggle';

    this._listViewBtn = document.createElement('button');
    this._listViewBtn.className = 'ce-gm-view-btn is-active';
    this._listViewBtn.textContent = '≡ List';
    this._listViewBtn.addEventListener('click', () => this._setViewMode('list'));

    this._cardViewBtn = document.createElement('button');
    this._cardViewBtn.className = 'ce-gm-view-btn';
    this._cardViewBtn.textContent = '⊞ Cards';
    this._cardViewBtn.addEventListener('click', () => this._setViewMode('cards'));

    wrap.appendChild(this._listViewBtn);
    wrap.appendChild(this._cardViewBtn);
    return wrap;
  }

  _setViewMode(mode) {
    this._viewMode = mode;
    this._listViewBtn.classList.toggle('is-active', mode === 'list');
    this._cardViewBtn.classList.toggle('is-active', mode === 'cards');
    this._onViewChange(mode);
  }

  _btn(label, extraClass = '') {
    const b = document.createElement('button');
    b.className = 'ce-gm-action-btn' + (extraClass ? ' ' + extraClass : '');
    b.textContent = label;
    return b;
  }

  // ── Table ───────────────────────────────────────────────────────────────────

  _buildTable() {
    const table = document.createElement('table');
    table.className = 'ce-gm-table';

    // thead
    const thead = document.createElement('thead');
    const tr = document.createElement('tr');

    for (const field of this._summaryFields) {
      const th = document.createElement('th');
      th.textContent = field.label;
      th.dataset.key = field.key;
      th.addEventListener('click', () => this._toggleSort(field.key, th));
      this._thMap = this._thMap || {};
      this._thMap[field.key] = th;
      tr.appendChild(th);
    }
    thead.appendChild(tr);
    table.appendChild(thead);

    // tbody
    this._tbody = document.createElement('tbody');
    table.appendChild(this._tbody);
    this._renderBody();
    return table;
  }

  _toggleSort(key, th) {
    if (this._sortKey === key) {
      this._sortAsc = !this._sortAsc;
    } else {
      this._sortKey = key;
      this._sortAsc = true;
    }
    // Update header classes
    if (this._thMap) {
      for (const [k, el] of Object.entries(this._thMap)) {
        el.classList.toggle('is-sorted', k === this._sortKey);
        const arrow = el.querySelector('.sort-arrow');
        if (arrow) el.removeChild(arrow);
        if (k === this._sortKey) {
          const span = document.createElement('span');
          span.className = 'sort-arrow';
          span.textContent = this._sortAsc ? ' ▲' : ' ▼';
          el.appendChild(span);
        }
      }
    }
    this._renderBody();
  }

  _filteredSorted() {
    let rows = this._records.slice();

    if (this._filter) {
      rows = rows.filter(r =>
        this._summaryFields.some(f => {
          const v = r[f.key];
          return v != null && String(v).toLowerCase().includes(this._filter);
        })
      );
    }

    if (this._sortKey) {
      const key = this._sortKey;
      const asc  = this._sortAsc;
      rows.sort((a, b) => {
        const av = a[key] ?? '';
        const bv = b[key] ?? '';
        if (typeof av === 'number' && typeof bv === 'number') return asc ? av - bv : bv - av;
        return asc
          ? String(av).localeCompare(String(bv))
          : String(bv).localeCompare(String(av));
      });
    }
    return rows;
  }

  _renderBody() {
    this._tbody.innerHTML = '';
    const rows = this._filteredSorted();

    if (rows.length === 0) {
      const td = document.createElement('td');
      td.colSpan = this._summaryFields.length;
      td.className = 'ce-gm-empty-state';
      td.textContent = this._filter ? 'No records match the search.' : 'No records. Click + Add to create one.';
      const tr = document.createElement('tr');
      tr.appendChild(td);
      this._tbody.appendChild(tr);
      return;
    }

    for (const record of rows) {
      const tr = document.createElement('tr');
      tr.dataset.id = record.id;
      if (this._selected && record.id === this._selected.id) tr.classList.add('is-selected');

      for (const field of this._summaryFields) {
        const td = document.createElement('td');
        if (field.type === 'color') {
          const swatch = document.createElement('span');
          swatch.className = 'ce-gm-color-swatch';
          swatch.style.background = record[field.key] || '#888';
          td.appendChild(swatch);
          td.appendChild(document.createTextNode(record[field.key] || ''));
        } else if (field.type === 'sublist') {
          td.textContent = `(${(record[field.key] || []).length})`;
        } else if (field.type === 'boolean') {
          td.textContent = record[field.key] ? '✓' : '—';
        } else {
          td.textContent = record[field.key] ?? '';
        }
        tr.appendChild(td);
      }

      tr.addEventListener('click', () => this._selectRow(record, tr));
      this._tbody.appendChild(tr);
    }
  }

  _selectRow(record, tr) {
    this._selected = record;
    // Update row highlight
    for (const row of this._tbody.querySelectorAll('tr')) {
      row.classList.toggle('is-selected', row === tr);
    }
    this._dupBtn.disabled = false;
    this._delBtn.disabled = false;
    this._onSelect(record);
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /** Replace the records array and re-render. */
  update(records) {
    this._records = records;
    // Re-sync _selected to new array object (same id) so highlight stays correct
    if (this._selected) {
      this._selected = records.find(r => r.id === this._selected.id) ?? null;
      if (!this._selected) {
        this._dupBtn.disabled = true;
        this._delBtn.disabled = true;
      }
    }
    this._renderBody();
  }

  /** Select a record by id (e.g. after add/duplicate) and fire the onSelect callback. */
  selectById(id) {
    const record = this._records.find(r => r.id === id);
    if (!record) return;
    this._selected = record;
    this._dupBtn.disabled = false;
    this._delBtn.disabled = false;
    this._renderBody();
    // fire select callback without a row element reference
    this._onSelect(record);
  }

  /** Update selection highlight only — does NOT fire onSelect callback. */
  highlightById(id) {
    const record = this._records.find(r => r.id === id);
    if (!record) return;
    this._selected = record;
    this._dupBtn.disabled = false;
    this._delBtn.disabled = false;
    this._renderBody();
  }

  /** Deselect and disable action buttons. */
  clearSelection() {
    this._selected = null;
    this._dupBtn.disabled = true;
    this._delBtn.disabled = true;
    this._renderBody();
  }
}
