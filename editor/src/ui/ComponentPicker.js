/**
 * ComponentPicker.js — Floating searchable component picker.
 * Opened by the "Add Component" button in ObjectProperties.
 *
 * Usage:
 *   ComponentPicker.show(anchorElement, (type) => { ... });
 *   ComponentPicker.defaultParams(type) → {type, ...defaults}
 */

const COMPONENT_GROUPS = [
  {
    label: 'Physics',
    components: [
      { type: 'Rigid Body',           desc: 'Simulated physics body' },
      { type: 'Box Collider',         desc: 'Axis-aligned box shape' },
      { type: 'Sphere Collider',      desc: 'Sphere collision shape' },
      { type: 'Capsule Collider',     desc: 'Capsule collision shape' },
      { type: 'Mesh Collider',        desc: 'ConvexHull or TriMesh shape' },
      { type: 'Character Controller', desc: 'Physics character movement' },
      { type: 'Joint',                desc: 'Connect two bodies' },
      { type: 'Ragdoll',              desc: 'Articulated ragdoll (Phase 11)' },
    ],
  },
  {
    label: 'Scripting',
    components: [
      { type: 'Script', desc: 'Custom game script (stub)' },
    ],
  },
  {
    label: 'Audio',
    components: [
      { type: 'Audio Source', desc: 'Spatial audio emitter (stub)' },
    ],
  },
];

/** Default parameters for each component type */
const DEFAULTS = {
  'Rigid Body':            { type: 'Rigid Body',           bodyType: 'dynamic', mass: 1, linearDamping: 0, angularDamping: 0, lockRotation: false },
  'Box Collider':          { type: 'Box Collider',         halfExtents: { x: 0.5, y: 0.5, z: 0.5 }, isTrigger: false, friction: 0.5, restitution: 0 },
  'Sphere Collider':       { type: 'Sphere Collider',      radius: 0.5, isTrigger: false, friction: 0.5, restitution: 0 },
  'Capsule Collider':      { type: 'Capsule Collider',     radius: 0.25, halfHeight: 0.5, isTrigger: false },
  'Mesh Collider':         { type: 'Mesh Collider',        mode: 'convexHull', isTrigger: false },
  'Character Controller':  { type: 'Character Controller', offset: 0.01, maxSlopeAngle: 45, autoStepHeight: 0.25, snapToGround: true },
  'Joint':                 { type: 'Joint',                jointType: 'fixed', targetUuid: '' },
  'Ragdoll':               { type: 'Ragdoll' },
  'Script':                { type: 'Script', path: '' },
  'Audio Source':          { type: 'Audio Source', src: '', loop: false, autoPlay: false, volume: 1 },
};

let _picker = null;

function _removePicker() {
  if (_picker) {
    _picker.remove();
    _picker = null;
  }
}

export const ComponentPicker = {
  /**
   * Show the component picker near `anchor`, calling `onSelect(type)` when chosen.
   * @param {HTMLElement} anchor
   * @param {(type: string) => void} onSelect
   */
  show(anchor, onSelect) {
    _removePicker();

    const picker = document.createElement('div');
    _picker = picker;
    picker.style.cssText = `
      position:fixed;z-index:9999;
      background:var(--bg,#141414);border:1px solid var(--border-color,#444);
      border-radius:4px;box-shadow:0 4px 20px rgba(0,0,0,.6);
      width:240px;max-height:340px;display:flex;flex-direction:column;
      font-size:12px;
    `;

    // ── Search ────────────────────────────────────────────────────────────
    const searchWrap = document.createElement('div');
    searchWrap.style.cssText = 'padding:8px;border-bottom:1px solid var(--border-color,#333);flex-shrink:0;';
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Search components…';
    searchInput.style.cssText = `
      width:100%;box-sizing:border-box;background:var(--bg2,#1e1e1e);
      border:1px solid var(--border-color,#444);color:var(--text-bright,#fff);
      padding:5px 8px;border-radius:3px;font-size:12px;outline:none;
    `;
    searchWrap.appendChild(searchInput);
    picker.appendChild(searchWrap);

    // ── List ─────────────────────────────────────────────────────────────
    const list = document.createElement('div');
    list.style.cssText = 'overflow-y:auto;flex:1;';

    function buildList(query) {
      list.innerHTML = '';
      const q = query.toLowerCase().trim();
      COMPONENT_GROUPS.forEach(group => {
        const matches = group.components.filter(c =>
          !q || c.type.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q)
        );
        if (!matches.length) return;

        const groupHdr = document.createElement('div');
        groupHdr.textContent = group.label;
        groupHdr.style.cssText = `
          padding:4px 10px;font-size:10px;font-weight:700;letter-spacing:.05em;
          color:var(--text-muted,#666);text-transform:uppercase;
          background:var(--bg2,#1a1a1a);
        `;
        list.appendChild(groupHdr);

        matches.forEach(c => {
          const item = document.createElement('div');
          item.style.cssText = `
            padding:6px 12px;cursor:pointer;display:flex;flex-direction:column;
            border-bottom:1px solid var(--border-color,#222);
            transition:background .1s;
          `;
          item.addEventListener('mouseenter', () => { item.style.background = 'var(--accent-dim,#0050a0)'; });
          item.addEventListener('mouseleave', () => { item.style.background = ''; });

          const name = document.createElement('span');
          name.textContent = c.type;
          name.style.cssText = 'color:var(--text-bright,#fff);';

          const desc = document.createElement('span');
          desc.textContent = c.desc;
          desc.style.cssText = 'font-size:10px;color:var(--text-muted,#777);';

          item.appendChild(name);
          item.appendChild(desc);
          item.addEventListener('click', () => {
            _removePicker();
            onSelect(c.type);
          });
          list.appendChild(item);
        });
      });
    }

    buildList('');
    picker.appendChild(list);

    searchInput.addEventListener('input', () => buildList(searchInput.value));

    // ── Position near anchor ─────────────────────────────────────────────
    document.body.appendChild(picker);
    const rect  = anchor.getBoundingClientRect();
    const ph    = 340;
    const pw    = 240;
    let top  = rect.bottom + 4;
    let left = rect.left;
    if (top + ph > window.innerHeight - 10) top = rect.top - ph - 4;
    if (left + pw > window.innerWidth  - 10) left = window.innerWidth - pw - 10;
    picker.style.top  = Math.max(4, top)  + 'px';
    picker.style.left = Math.max(4, left) + 'px';

    // Focus search
    requestAnimationFrame(() => searchInput.focus());

    // ── Close on outside click ────────────────────────────────────────────
    const onDocClick = (e) => {
      if (!picker.contains(e.target)) {
        _removePicker();
        document.removeEventListener('mousedown', onDocClick, true);
      }
    };
    document.addEventListener('mousedown', onDocClick, true);
  },

  /**
   * Return a fresh default-params object for the given component type.
   * @param {string} type
   * @returns {object}
   */
  defaultParams(type) {
    const tmpl = DEFAULTS[type];
    if (!tmpl) return { type };
    return JSON.parse(JSON.stringify(tmpl)); // deep clone
  },
};
