/**
 * RecordForm.js — bottom form pane (Row Editor).
 * Renders an auto-saving form from a schema definition.
 * Auto-saves on every change via a 300ms debounce.
 */

import CeColorPicker from '../CeColorPicker.js';

function _hexIsValid(h) { return /^#[0-9a-f]{6}$/i.test(h); }

export class RecordForm {
  /**
   * @param {Object} options
   * @param {Array}    options.schema   — field descriptors from GameDataSchemas
   * @param {Function} options.onChange — (updatedRecord) → void, debounced 300ms
   */
  constructor({ schema, onChange } = {}) {
    this._schema    = schema;
    this._onChange  = onChange || (() => {});
    this._record    = null;
    this._debouncer = null;
    this._inputs    = {};   // key → getter fn

    this._el = this._build();
  }

  get element() { return this._el; }

  // ── Build shell ─────────────────────────────────────────────────────────────

  _build() {
    const wrap = document.createElement('div');
    wrap.className = 'ce-gm-form-pane';

    this._headerEl = document.createElement('div');
    this._headerEl.className = 'ce-gm-form-header';

    this._headerTitle = document.createElement('span');
    this._headerTitle.className = 'ce-gm-form-header-title';
    this._headerTitle.textContent = 'Row Editor';

    this._headerId = document.createElement('span');
    this._headerId.className = 'ce-gm-form-header-id';

    this._headerEl.appendChild(this._headerTitle);
    this._headerEl.appendChild(this._headerId);

    this._bodyEl = document.createElement('div');
    this._bodyEl.className = 'ce-gm-form-body';

    this._emptyEl = document.createElement('div');
    this._emptyEl.className = 'ce-gm-form-empty';
    this._emptyEl.textContent = 'Select a record to edit.';

    wrap.appendChild(this._headerEl);
    wrap.appendChild(this._bodyEl);
    this._bodyEl.appendChild(this._emptyEl);
    return wrap;
  }

  // ── Load / clear ────────────────────────────────────────────────────────────

  load(record) {
    this._record = { ...record };
    this._inputs  = {};
    this._bodyEl.innerHTML = '';

    this._headerTitle.textContent = record.name || record.id || 'Row Editor';
    this._headerId.textContent = `id: ${record.id}`;

    const body = document.createElement('div');
    body.className = 'ce-gm-form-body';

    for (const field of this._schema) {
      if (field.key === 'id') continue;  // ID is read-only, shown in header
      body.appendChild(this._buildField(field, record[field.key]));
    }

    this._bodyEl.appendChild(body);
  }

  clear() {
    this._record  = null;
    this._inputs  = {};
    this._bodyEl.innerHTML = '';
    this._headerTitle.textContent = 'Row Editor';
    this._headerId.textContent = '';

    const empty = document.createElement('div');
    empty.className = 'ce-gm-form-empty';
    empty.textContent = 'Select a record to edit.';
    this._bodyEl.appendChild(empty);
  }

  // ── Field builders ──────────────────────────────────────────────────────────

  _buildField(field, value) {
    const row = document.createElement('div');
    row.className = 'ce-gm-field';

    const label = document.createElement('label');
    label.className = 'ce-gm-field-label';
    label.textContent = field.label;

    const control = document.createElement('div');
    control.className = 'ce-gm-field-control';

    let input;
    switch (field.type) {
      case 'textarea': input = this._buildTextarea(field, value);   break;
      case 'number':   input = this._buildNumber(field, value);     break;
      case 'boolean':  input = this._buildBoolean(field, value);    break;
      case 'select':   input = this._buildSelect(field, value);     break;
      case 'color':    input = this._buildColor(field, value);      break;
      case 'sublist':  input = this._buildSublist(field, value);    break;
      default:         input = this._buildText(field, value);       break;
    }

    // Special: hasDuration toggle shows/hides duration field
    if (field.key === 'hasDuration') {
      const el = input.querySelector('input') || input;
      el.addEventListener('change', () => {
        const dur = this._el.querySelector('[data-key="duration"]');
        if (dur) dur.style.display = el.checked ? '' : 'none';
      });
    }

    control.appendChild(input);
    row.appendChild(label);
    row.appendChild(control);

    // Mark field row with key for hasDuration toggle
    row.dataset.key = field.key;

    // Initial hide of duration if hasDuration is false
    if (field.key === 'duration' && this._record && !this._record.hasDuration) {
      row.style.display = 'none';
    }

    return row;
  }

  _buildText(field, value) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'ce-gm-input';
    input.value = value ?? '';
    this._inputs[field.key] = () => input.value;
    input.addEventListener('input', () => this._scheduleChange(field.key, input.value));
    return input;
  }

  _buildTextarea(field, value) {
    const ta = document.createElement('textarea');
    ta.className = 'ce-gm-input';
    ta.value = value ?? '';
    this._inputs[field.key] = () => ta.value;
    ta.addEventListener('input', () => this._scheduleChange(field.key, ta.value));
    return ta;
  }

  _buildNumber(field, value) {
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'ce-gm-input';
    input.value = value ?? field.default ?? 0;
    input.step = 'any';
    this._inputs[field.key] = () => parseFloat(input.value) || 0;
    input.addEventListener('input', () => this._scheduleChange(field.key, parseFloat(input.value) || 0));
    return input;
  }

  _buildBoolean(field, value) {
    const wrap = document.createElement('div');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'ce-gm-input';
    input.checked = !!value;
    this._inputs[field.key] = () => input.checked;
    input.addEventListener('change', () => this._scheduleChange(field.key, input.checked));
    wrap.appendChild(input);
    return wrap;
  }

  _buildSelect(field, value) {
    const sel = document.createElement('select');
    sel.className = 'ce-gm-input';
    for (const opt of (field.options || [])) {
      const o = document.createElement('option');
      o.value = opt.value;
      o.textContent = opt.label;
      if (opt.value === (value ?? field.default)) o.selected = true;
      sel.appendChild(o);
    }
    this._inputs[field.key] = () => sel.value;
    sel.addEventListener('change', () => this._scheduleChange(field.key, sel.value));
    return sel;
  }

  _buildColor(field, value) {
    const current = (_hexIsValid(value) ? value : null) || field.default || '#ffffff';
    let live = current;

    const wrap = document.createElement('div');
    wrap.className = 'ce-gm-color-row';

    // Swatch button — click to open picker
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.style.cssText =
      `width:22px;height:22px;border-radius:3px;border:1px solid var(--ce-border);` +
      `background:${current};cursor:pointer;flex-shrink:0;padding:0;`;

    const hexLabel = document.createElement('span');
    hexLabel.className = 'ce-gm-color-hex';
    hexLabel.textContent = current;

    swatch.addEventListener('click', () => {
      CeColorPicker.open(
        swatch,
        live,
        (hex) => {
          live = hex;
          swatch.style.background = hex;
          hexLabel.textContent = hex;
          this._scheduleChange(field.key, hex);
        }
      );
    });

    this._inputs[field.key] = () => live;

    wrap.appendChild(swatch);
    wrap.appendChild(hexLabel);
    return wrap;
  }

  _buildSublist(field, value) {
    const rows = (value || []).map(r => ({ ...r }));

    const wrap = document.createElement('div');
    wrap.className = 'ce-gm-sublist';

    // Column headers
    const head = document.createElement('div');
    head.className = 'ce-gm-sublist-header';
    for (const sf of field.subFields) {
      const lbl = document.createElement('span');
      lbl.className = 'ce-gm-sublist-col-label';
      lbl.textContent = sf.label;
      head.appendChild(lbl);
    }
    const spacer = document.createElement('span');
    spacer.style.width = '24px';
    spacer.style.flexShrink = '0';
    head.appendChild(spacer);
    wrap.appendChild(head);

    const rowsContainer = document.createElement('div');
    wrap.appendChild(rowsContainer);

    const render = () => {
      rowsContainer.innerHTML = '';
      if (rows.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'ce-gm-sublist-empty';
        empty.textContent = 'No entries.';
        rowsContainer.appendChild(empty);
      } else {
        rows.forEach((rowData, idx) => {
          const rowEl = document.createElement('div');
          rowEl.className = 'ce-gm-sublist-row';

          for (const sf of field.subFields) {
            const cell = document.createElement('div');
            cell.className = 'ce-gm-sublist-cell';

            if (sf.type === 'select') {
              const sel = document.createElement('select');
              sel.className = 'ce-gm-sublist-input';
              for (const opt of (sf.options || [])) {
                const o = document.createElement('option');
                o.value = opt.value;
                o.textContent = opt.label;
                if (opt.value === (rowData[sf.key] ?? sf.default)) o.selected = true;
                sel.appendChild(o);
              }
              sel.addEventListener('change', () => {
                rows[idx][sf.key] = sel.value;
                notify();
              });
              cell.appendChild(sel);
            } else {
              const input = document.createElement('input');
              input.type = sf.type === 'number' ? 'number' : 'text';
              input.className = 'ce-gm-sublist-input';
              input.value = rowData[sf.key] ?? sf.default ?? '';
              input.addEventListener('input', () => {
                rows[idx][sf.key] = sf.type === 'number'
                  ? (parseFloat(input.value) || 0)
                  : input.value;
                notify();
              });
              cell.appendChild(input);
            }
            rowEl.appendChild(cell);
          }

          const removeBtn = document.createElement('button');
          removeBtn.className = 'ce-gm-sublist-remove';
          removeBtn.textContent = '✕';
          removeBtn.title = 'Remove row';
          removeBtn.addEventListener('click', () => {
            rows.splice(idx, 1);
            render();
            notify();
          });
          rowEl.appendChild(removeBtn);
          rowsContainer.appendChild(rowEl);
        });
      }
    };

    const addBtn = document.createElement('button');
    addBtn.className = 'ce-gm-sublist-add';
    addBtn.textContent = '+ Add Row';
    addBtn.addEventListener('click', () => {
      const blank = {};
      for (const sf of field.subFields) blank[sf.key] = sf.default ?? '';
      rows.push(blank);
      render();
      notify();
    });
    wrap.appendChild(addBtn);

    const notify = () => this._scheduleChange(field.key, rows.map(r => ({ ...r })));
    this._inputs[field.key] = () => rows.map(r => ({ ...r }));

    render();
    return wrap;
  }

  // ── Auto-save ────────────────────────────────────────────────────────────────

  _scheduleChange(key, value) {
    if (!this._record) return;
    this._record[key] = value;

    // Update header title if name changed
    if (key === 'name') this._headerTitle.textContent = value || this._record.id;

    clearTimeout(this._debouncer);
    this._debouncer = setTimeout(() => {
      this._onChange({ ...this._record });
    }, 300);
  }
}
