/**
 * ViewportContextMenu.js
 * Right-click context menu for the 3D viewport.
 *
 * Listens for:
 *   cyco-vp-contextmenu  { x, y, hit? }  — show menu at (x, y); hit = hovered Object3D or null
 *
 * Dispatches (via user action):
 *   cyco-add-object        { objectType }
 *   cyco-select-node       { object, type }  — select the hit object before focus/delete
 *   cyco-rvp-focus         { object }
 *   cyco-hierarchy-remove-obj { cycoId }     (via CommandManager for undo support)
 *   cyco-duplicate-object  { source, command }
 */

/** Primitive types shown in the "Add Object" submenu */
const ADD_ITEMS = [
  { label: 'Box',          type: 'Box' },
  { label: 'Sphere',       type: 'Sphere' },
  { label: 'Cylinder',     type: 'Cylinder' },
  { label: 'Capsule',      type: 'Capsule' },
  { label: 'Plane',        type: 'Plane' },
  { label: 'Torus',        type: 'Torus' },
  { label: 'Cone',         type: 'Cone' },
  null, // separator
  { label: 'Point Light',  type: 'PointLight' },
  { label: 'Spot Light',   type: 'SpotLight' },
  { label: 'Directional Light', type: 'DirectionalLight' },
  null,
  { label: 'Empty',        type: 'Empty' },
  { label: 'Camera',       type: 'PerspectiveCamera' },
];

export class ViewportContextMenu {
  constructor() {
    this._menu    = null;
    this._submenu = null;
    this._hitObj  = null;
    this._selected = null;

    this._onContextMenu = this._onContextMenu.bind(this);
    this._onDismiss     = this._onDismiss.bind(this);

    window.addEventListener('cyco-vp-contextmenu', this._onContextMenu);
  }

  // ─── Event handlers ───────────────────────────────────────────────────────

  _onContextMenu(event) {
    const { x, y, hit, selected } = event.detail ?? {};
    this._hitObj = hit ?? null;
    this._selected = Array.isArray(selected) ? selected : null;
    this._show(x, y, hit, this._selected);
  }

  _onDismiss(event) {
    if (this._menu && !this._menu.contains(event.target)) {
      this._hide();
    }
  }

  // ─── Build + show ─────────────────────────────────────────────────────────

  _show(x, y, hit, selected) {
    this._hide(); // remove any previous

    const menu = document.createElement('div');
    menu.className = 'ce-ctx-menu';
    menu.style.cssText = `
      position: fixed;
      left: ${x}px;
      top: ${y}px;
      z-index: 9999;
      min-width: 160px;
      background: var(--ce-bg-2, #2a2420);
      border: 1px solid var(--ce-border, #4a3a2a);
      border-radius: 4px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.6);
      padding: 4px 0;
      font-size: 13px;
      color: var(--ce-text, #d0c8b8);
      user-select: none;
    `;

    const isMulti = Array.isArray(selected) && selected.length > 1;
    const selArr  = isMulti ? selected.filter(o => o && !o.userData?._isGizmo) : [];

    // Cyco Modeler uses its own independent context menu — hide the
    // editor-specific Add Object / Create Prefab / Group entries so the
    // modeler isn't polluted by engine-only actions.
    const isModelerMode = document.body.classList.contains('cyco-modeler-mode')
      || window.__cyco?.layoutManager?.isModelerMode?.() === true
      || (window.__cyco?.cycleModeler?.active === true);

    if (!isModelerMode) {
      // Add Object (with submenu) — editor-only
      menu.appendChild(this._makeSubmenuItem('Add Object ▶', ADD_ITEMS, (type) => {
        this._hide();
        window.dispatchEvent(new CustomEvent('cyco-add-object', { detail: { objectType: type } }));
      }));

      menu.appendChild(this._makeSeparator());
      menu.appendChild(this._makeItem('Toggle Physics Debug Wireframe', () => {
        this._hide();
        window.dispatchEvent(new CustomEvent('cyco-physics-debug-toggle', { detail: {} }));
      }));
      menu.appendChild(this._makeSeparator());
    } else {
      // Modeler mode — open the Cyco Modeler settings popup from the
      // viewport context so users can reach it without going up to the topbar.
      menu.appendChild(this._makeItem('Cyco Modeler Settings…', () => {
        this._hide();
        window.dispatchEvent(new CustomEvent('cyco-open-modeler-settings'));
      }));
      menu.appendChild(this._makeSeparator());
    }

    if (isMulti) {
      // ── Multi-select context items ────────────────────────────────────────
      menu.appendChild(this._makeItem(`Focus Selection  (${selArr.length})`, () => {
        this._hide();
        const primary = selArr[selArr.length - 1];
        window.dispatchEvent(new CustomEvent('cyco-rvp-focus', { detail: { object: primary } }));
      }));
      menu.appendChild(this._makeSeparator());
      menu.appendChild(this._makeItem('Group Selected', () => {
        this._hide();
        // Re-use the hierarchy panel's _group() by dispatching the action
        if (typeof window === 'undefined' || window.__CYCO_GROUP_DEBUG !== false) {
          // eslint-disable-next-line no-console
          console.log('[group-debug] dispatch:source=ViewportContextMenu:Group-Selected');
        }
        window.dispatchEvent(new CustomEvent('cyco-action', { detail: 'hierarchy-group' }));
      }));
      if (!isModelerMode) {
        menu.appendChild(this._makeItem('Create Prefab', () => {
          this._hide();
          window.dispatchEvent(new CustomEvent('cyco-create-prefab-from-selection', {
            detail: { objects: selArr }
          }));
        }));
      }
      menu.appendChild(this._makeSeparator());
      menu.appendChild(this._makeItem(`Delete ${selArr.length} objects`, () => {
        this._hide();
        const cm = window.__cyco?.commandManager;
        if (cm) {
          for (const obj of selArr) {
            const cycoId = obj.userData?.cycoId;
            if (!cycoId) continue;
            const parent = obj.parent;
            const idx    = parent?.children.indexOf(obj) ?? 0;
            cm.execute({
              name: `Delete ${obj.name || cycoId}`,
              _obj: obj, _parent: parent, _idx: idx,
              do()   { window.dispatchEvent(new CustomEvent('cyco-hierarchy-remove-obj', { detail: { cycoId: this._obj.userData.cycoId } })); },
              undo() { window.dispatchEvent(new CustomEvent('cyco-hierarchy-restore-obj', { detail: { object: this._obj, parent: this._parent, index: this._idx } })); },
            });
          }
          window.dispatchEvent(new CustomEvent('cyco-deselect-all'));
        }
      }, true));
    } else if (hit) {
      // Focus
      menu.appendChild(this._makeItem('Focus', () => {
        this._hide();
        window.dispatchEvent(new CustomEvent('cyco-select-node', { detail: { object: hit, type: hit.isLight ? 'light' : 'mesh' } }));
        window.dispatchEvent(new CustomEvent('cyco-rvp-focus', { detail: { object: hit } }));
      }));

      // Duplicate
      menu.appendChild(this._makeItem('Duplicate', () => {
        this._hide();
        window.dispatchEvent(new CustomEvent('cyco-select-node', { detail: { object: hit, type: hit.isLight ? 'light' : 'mesh' } }));
        const cm = window.__cyco?.commandManager;
        if (cm) {
          const cmd = {
            name: `Duplicate ${hit.name || hit.userData?.cycoId}`,
            _source: hit, _clone: null,
            do() { window.dispatchEvent(new CustomEvent('cyco-duplicate-object', { detail: { source: this._source, command: this } })); },
            undo() {
              if (this._clone?.userData?.cycoId) {
                window.dispatchEvent(new CustomEvent('cyco-hierarchy-remove-obj', { detail: { cycoId: this._clone.userData.cycoId } }));
              }
            },
          };
          cm.execute(cmd);
        }
      }));

      // Create Prefab (single object) — editor only, suppressed in modeler mode
      if (!isModelerMode) {
        menu.appendChild(this._makeItem('Create Prefab', () => {
          this._hide();
          window.dispatchEvent(new CustomEvent('cyco-select-node', { detail: { object: hit, type: hit.isLight ? 'light' : 'mesh' } }));
          window.dispatchEvent(new CustomEvent('cyco-create-prefab-from-selection', {
            detail: { objects: [hit] }
          }));
        }));
      }

      menu.appendChild(this._makeSeparator());

      // Delete
      menu.appendChild(this._makeItem('Delete', () => {
        this._hide();
        const cycoId = hit.userData?.cycoId;
        if (!cycoId) return;
        const cm = window.__cyco?.commandManager;
        if (cm) {
          const parent = hit.parent;
          const idx    = parent?.children.indexOf(hit) ?? 0;
          cm.execute({
            name: `Delete ${hit.name || cycoId}`,
            _obj: hit, _parent: parent, _idx: idx,
            do()   { window.dispatchEvent(new CustomEvent('cyco-hierarchy-remove-obj', { detail: { cycoId: this._obj.userData.cycoId } })); },
            undo() { window.dispatchEvent(new CustomEvent('cyco-hierarchy-restore-obj', { detail: { object: this._obj, parent: this._parent, index: this._idx } })); },
          });
          window.dispatchEvent(new CustomEvent('cyco-deselect-all'));
        }
      }, true)); // true = danger style
    }

    document.body.appendChild(menu);
    this._menu = menu;

    // Clamp to viewport
    requestAnimationFrame(() => {
      const rect = menu.getBoundingClientRect();
      if (rect.right  > window.innerWidth)  menu.style.left = `${window.innerWidth  - rect.width  - 8}px`;
      if (rect.bottom > window.innerHeight) menu.style.top  = `${window.innerHeight - rect.height - 8}px`;
    });

    // Dismiss on outside click / Escape / scroll
    setTimeout(() => {
      document.addEventListener('pointerdown', this._onDismiss);
      document.addEventListener('keydown', this._onEsc = (e) => { if (e.key === 'Escape') this._hide(); });
      document.addEventListener('wheel', this._hide.bind(this), { once: true });
    }, 0);
  }

  _hide() {
    if (this._menu) {
      this._menu.remove();
      this._menu    = null;
      this._submenu = null;
    }
    document.removeEventListener('pointerdown', this._onDismiss);
    if (this._onEsc) document.removeEventListener('keydown', this._onEsc);
  }

  // ─── Item builders ────────────────────────────────────────────────────────

  _makeItem(label, onClick, danger = false) {
    const item = document.createElement('div');
    item.className = 'ce-ctx-item';
    item.textContent = label;
    item.style.cssText = `
      padding: 6px 16px;
      cursor: pointer;
      color: ${danger ? '#e05050' : 'inherit'};
      transition: background 0.1s;
    `;
    item.addEventListener('mouseenter', () => { item.style.background = 'var(--ce-accent-dim, rgba(224,114,40,0.18))'; });
    item.addEventListener('mouseleave', () => { item.style.background = ''; });
    item.addEventListener('click', onClick);
    return item;
  }

  _makeSeparator() {
    const sep = document.createElement('div');
    sep.style.cssText = 'height:1px; background:var(--ce-border,#4a3a2a); margin:4px 0;';
    return sep;
  }

  _makeSubmenuItem(label, items, onSelect) {
    const wrapper = document.createElement('div');
    wrapper.style.position = 'relative';

    const item = this._makeItem(label, () => {});
    item.style.paddingRight = '8px';
    wrapper.appendChild(item);

    const sub = document.createElement('div');
    sub.className = 'ce-ctx-submenu';
    sub.style.cssText = `
      display: none;
      position: absolute;
      left: 100%;
      top: 0;
      min-width: 140px;
      background: var(--ce-bg-2, #2a2420);
      border: 1px solid var(--ce-border, #4a3a2a);
      border-radius: 4px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.6);
      padding: 4px 0;
      z-index: 10000;
    `;

    for (const entry of items) {
      if (entry === null) {
        sub.appendChild(this._makeSeparator());
      } else {
        sub.appendChild(this._makeItem(entry.label, () => onSelect(entry.type)));
      }
    }

    wrapper.appendChild(sub);

    wrapper.addEventListener('mouseenter', () => {
      sub.style.display = 'block';
    });
    wrapper.addEventListener('mouseleave', () => {
      sub.style.display = 'none';
    });

    return wrapper;
  }

  // ─── Disposal ─────────────────────────────────────────────────────────────

  dispose() {
    this._hide();
    window.removeEventListener('cyco-vp-contextmenu', this._onContextMenu);
  }
}
