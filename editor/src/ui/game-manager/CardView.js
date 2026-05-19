/**
 * CardView.js — card gallery view for Game Manager records.
 */

export class CardView {
  /**
   * @param {Object} options
   * @param {Array}    options.schema    — field descriptors
   * @param {Array}    options.records   — record array
   * @param {Function} options.onSelect  — (record) → void
   */
  constructor({ schema, records = [], onSelect } = {}) {
    this._schema    = schema;
    this._records   = records;
    this._onSelect  = onSelect || (() => {});
    this._selected  = null;

    // Pick the first two summary fields (excluding id) for the card meta line
    this._metaFields = schema.filter(f => f.summary && f.key !== 'id' && f.key !== 'name').slice(0, 2);

    this._el = this._build();
  }

  get element() { return this._el; }

  _build() {
    this._grid = document.createElement('div');
    this._grid.className = 'ce-gm-card-grid';
    this._render();
    return this._grid;
  }

  _render() {
    this._grid.innerHTML = '';

    if (this._records.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'ce-gm-empty-state';
      empty.style.gridColumn = '1 / -1';
      empty.textContent = 'No records. Click + Add to create one.';
      this._grid.appendChild(empty);
      return;
    }

    for (const record of this._records) {
      const card = document.createElement('div');
      card.className = 'ce-gm-card';
      if (this._selected && record.id === this._selected.id) card.classList.add('is-selected');

      // Icon placeholder (colored by 'color' field if available)
      const icon = document.createElement('div');
      icon.className = 'ce-gm-card-icon';
      const colorField = this._schema.find(f => f.type === 'color');
      if (colorField && record[colorField.key]) {
        icon.style.background = record[colorField.key];
        icon.style.borderColor = record[colorField.key];
      }
      icon.textContent = (record.name || '?')[0].toUpperCase();

      const name = document.createElement('div');
      name.className = 'ce-gm-card-name';
      name.textContent = record.name || record.id || '—';

      card.appendChild(icon);
      card.appendChild(name);

      for (const field of this._metaFields) {
        const meta = document.createElement('div');
        meta.className = 'ce-gm-card-meta';
        const v = record[field.key];
        meta.textContent = `${field.label}: ${v ?? '—'}`;
        card.appendChild(meta);
      }

      card.addEventListener('click', () => {
        this._selected = record;
        this._grid.querySelectorAll('.ce-gm-card').forEach(c => c.classList.remove('is-selected'));
        card.classList.add('is-selected');
        this._onSelect(record);
      });

      this._grid.appendChild(card);
    }
  }

  /** Replace records and re-render. */
  update(records) {
    this._records = records;
    this._render();
  }

  /** Highlight a specific record by id. */
  selectById(id) {
    this._selected = this._records.find(r => r.id === id) || null;
    this._render();
  }

  /** Clear selection. */
  clearSelection() {
    this._selected = null;
    this._grid.querySelectorAll('.ce-gm-card').forEach(c => c.classList.remove('is-selected'));
  }
}
