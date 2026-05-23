/**
 * propUtils.js — lightweight DOM helpers for property panels.
 * No external dependencies except CeColorPicker.
 */

import CeColorPicker from '../ui/CeColorPicker.js';

// ── Scrub drag helper ─────────────────────────────────────────────────────────

/**
 * Attach pointer-lock scrub drag to a trigger element for a number input.
 * Drag right or up → increase; drag left or down → decrease.
 * Modifiers: Shift = 10×, Alt = 0.1×.
 * Uses Pointer Lock API so dragging continues past monitor edges.
 */
function _attachScrub(trigger, inp, speed, decimals) {
  trigger.title = 'Drag to change value\nShift = ×10 speed · Alt = ×0.1 speed';

  let startVal = 0;
  let accDelta = 0;

  const clamp = (v) => {
    const lo = inp.min ? parseFloat(inp.min) : -Infinity;
    const hi = inp.max ? parseFloat(inp.max) : Infinity;
    return Math.min(hi, Math.max(lo, v));
  };

  const onMove = (e) => {
    let mult = 1;
    if (e.shiftKey)    mult = 10;
    else if (e.altKey) mult = 0.1;
    accDelta += (e.movementX - e.movementY) * mult;
    const raw = clamp(startVal + accDelta * speed);
    inp.value = raw.toFixed(Math.max(0, decimals));
    inp.dispatchEvent(new Event('change'));
  };

  const onUp = () => {
    inp._scrubbing = false;
    document.exitPointerLock?.();
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  };

  trigger.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    inp._scrubbing = true;
    startVal  = parseFloat(inp.value) || 0;
    accDelta  = 0;
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    trigger.requestPointerLock?.();
  });
}

// ── Section collapse state persistence ───────────────────────────────────────

const _SECTION_STATE_KEY = 'cyco-prop-sections';

/** Load state map from localStorage. { [title]: boolean (true = open) } */
function _loadSectionState() {
  try { return JSON.parse(localStorage.getItem(_SECTION_STATE_KEY) || '{}'); }
  catch { return {}; }
}

/** Save the full state map to localStorage. */
function _saveSectionState(map) {
  try { localStorage.setItem(_SECTION_STATE_KEY, JSON.stringify(map)); }
  catch {}
}

// ── Section ───────────────────────────────────────────────────────────────────

/** Build a collapsible section container. Returns { el, body }
 *  The open/closed state is persisted per-title in localStorage so it survives
 *  object deselect / reselect.
 */
export function section(title) {
  const el  = document.createElement('div');
  el.className = 'ce-prop-section';

  const hdr = document.createElement('div');
  hdr.className = 'ce-prop-section-hdr';

  const arrow = document.createElement('span');
  arrow.className   = 'ce-prop-arrow';
  arrow.textContent = '▾';

  hdr.appendChild(arrow);
  hdr.appendChild(document.createTextNode(' ' + title));

  const body = document.createElement('div');
  body.className = 'ce-prop-section-body';

  // Restore saved state (default: open)
  const saved = _loadSectionState();
  if (saved[title] === false) {
    body.style.display = 'none';
    arrow.textContent  = '▸';
  }

  hdr.addEventListener('click', () => {
    const open = body.style.display !== 'none';
    body.style.display = open ? 'none' : '';
    arrow.textContent  = open ? '▸' : '▾';
    // Persist the new state
    const map = _loadSectionState();
    map[title] = !open;
    _saveSectionState(map);
  });

  el.appendChild(hdr);
  el.appendChild(body);
  return { el, body };
}

// ── Row ───────────────────────────────────────────────────────────────────────

/** Build a [label | control] row. Returns an HTMLElement. */
export function row(label, control) {
  const el  = document.createElement('div');
  el.className = 'ce-prop-row';

  const lbl = document.createElement('div');
  lbl.className   = 'ce-prop-row-label';
  lbl.textContent = label;

  el.appendChild(lbl);
  el.appendChild(control);
  return el;
}

// ── Vec3 ──────────────────────────────────────────────────────────────────────

/**
 * XYZ number input triplet.
 * @param {(axis: number, value: number) => void} onChange
 * @returns {{ el: HTMLElement, inputs: HTMLInputElement[], setValues: (x,y,z) => void }}
 */
export function vec3(onChange, scrubSpeed = 0.1) {
  const el = document.createElement('div');
  el.className = 'ce-prop-vec3';

  const AXES   = ['X', 'Y', 'Z'];
  const inputs = [];

  for (let i = 0; i < 3; i++) {
    const item = document.createElement('div');
    item.className = 'ce-prop-vec3-item';

    const tag = document.createElement('span');
    tag.className   = `ce-prop-axis-tag axis-${AXES[i].toLowerCase()}`;
    tag.textContent = AXES[i];

    const inp = document.createElement('input');
    inp.type       = 'number';
    inp.step       = '0.001';
    inp.className  = 'ce-prop-num';
    inp.value      = '0.000';
    inp._scrubbing = false;
    inp.addEventListener('change', () => onChange(i, parseFloat(inp.value) || 0));

    // Axis tag IS the scrub handle (drag X/Y/Z label to change value)
    _attachScrub(tag, inp, scrubSpeed, 3);

    item.appendChild(tag);
    item.appendChild(inp);
    el.appendChild(item);
    inputs.push(inp);
  }

  const setValues = (x, y, z) => {
    const vals = [x, y, z];
    for (let i = 0; i < 3; i++) {
      if (document.activeElement !== inputs[i] && !inputs[i]._scrubbing) {
        inputs[i].value = vals[i].toFixed(3);
      }
    }
  };

  return { el, inputs, setValues };
}

// ── Number input ──────────────────────────────────────────────────────────────

/** Full-width number input with scrub handle. Returns a wrapper HTMLElement. */
export function numInput({ value = 0, step = 1, min, max, decimals = 3, onChange } = {}) {
  const inp     = document.createElement('input');
  inp.type      = 'number';
  inp.step      = String(step);
  inp.value     = parseFloat(value).toFixed(decimals);
  inp.className = 'ce-prop-num ce-prop-num-full';
  if (min !== undefined) inp.min = String(min);
  if (max !== undefined) inp.max = String(max);
  if (onChange) inp.addEventListener('change', () => onChange(parseFloat(inp.value) || 0));

  // Scrub handle square before the input
  const handle     = document.createElement('span');
  handle.className = 'ce-prop-scrub-handle';
  const speed = Math.max(parseFloat(String(step)) * 0.5, 0.01);
  _attachScrub(handle, inp, speed, decimals);

  const wrap     = document.createElement('div');
  wrap.className = 'ce-prop-num-wrap';
  wrap.appendChild(handle);
  wrap.appendChild(inp);
  return wrap;
}

// ── Slider ────────────────────────────────────────────────────────────────────

/** Range slider with value label. Returns { el, input, setValue }. */
export function slider({ value = 0, min = 0, max = 1, step = 0.01, onChange } = {}) {
  const wrap     = document.createElement('div');
  wrap.className = 'ce-prop-slider-wrap';

  const inp     = document.createElement('input');
  inp.type      = 'range';
  inp.min       = String(min);
  inp.max       = String(max);
  inp.step      = String(step);
  inp.value     = String(value);
  inp.className = 'ce-prop-slider';

  const lbl     = document.createElement('span');
  lbl.className   = 'ce-prop-slider-val';
  lbl.textContent = parseFloat(value).toFixed(2);

  inp.addEventListener('input', () => {
    lbl.textContent = parseFloat(inp.value).toFixed(2);
    if (onChange) onChange(parseFloat(inp.value));
  });

  wrap.appendChild(inp);
  wrap.appendChild(lbl);

  const setValue = (v) => {
    inp.value       = String(v);
    lbl.textContent = parseFloat(v).toFixed(2);
  };

  return { el: wrap, input: inp, setValue };
}

// ── Checkbox ──────────────────────────────────────────────────────────────────

/** Checkbox. Returns HTMLInputElement. */
export function checkbox({ checked = false, onChange } = {}) {
  const inp     = document.createElement('input');
  inp.type      = 'checkbox';
  inp.checked   = !!checked;
  inp.className = 'ce-prop-checkbox';
  if (onChange) inp.addEventListener('change', () => onChange(inp.checked));
  return inp;
}

// ── Color swatch ──────────────────────────────────────────────────────────────

/** Color swatch that opens CeColorPicker. Returns { el, setValue }. */
export function colorSwatch({ color = '#ffffff', onChange } = {}) {
  const btn     = document.createElement('button');
  btn.className = 'ce-prop-color-swatch';
  btn.style.setProperty('--sw-color', color);
  btn.title = color;

  btn.addEventListener('click', () => {
    const cur = btn.style.getPropertyValue('--sw-color');
    CeColorPicker.open(btn, cur, (c) => {
      btn.style.setProperty('--sw-color', c);
      btn.title = c;
      if (onChange) onChange(c);
    });
  });

  const setValue = (c) => {
    btn.style.setProperty('--sw-color', c);
    btn.title = c;
  };

  return { el: btn, setValue };
}

// ── Read-only text ────────────────────────────────────────────────────────────

/** Plain read-only text span. Returns HTMLElement. */
export function readOnly(text) {
  const el     = document.createElement('span');
  el.className   = 'ce-prop-readonly';
  el.textContent = String(text ?? '');
  return el;
}

// ── Select ────────────────────────────────────────────────────────────────────

/**
 * Dropdown. Returns HTMLSelectElement.
 * @param {{ options: [value, label][], value?: string, onChange?: Function }} opts
 */
export function select({ options = [], value, onChange } = {}) {
  const sel     = document.createElement('select');
  sel.className = 'ce-prop-select';

  for (const [v, label] of options) {
    const opt     = document.createElement('option');
    opt.value     = String(v);
    opt.textContent = label;
    if (String(v) === String(value)) opt.selected = true;
    sel.appendChild(opt);
  }

  if (onChange) sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

// ── Object name header ────────────────────────────────────────────────────────

/** Big name header for the top of a property panel. */
export function nameHeader(text, subtitle = '') {
  const el     = document.createElement('div');
  el.className = 'ce-prop-name-header';

  const name     = document.createElement('div');
  name.className   = 'ce-prop-name-title';
  name.textContent = text;

  el.appendChild(name);

  if (subtitle) {
    const sub     = document.createElement('div');
    sub.className   = 'ce-prop-name-sub';
    sub.textContent = subtitle;
    el.appendChild(sub);
  }

  return el;
}
