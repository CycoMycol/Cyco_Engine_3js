/**
 * BasePanel.js — base class for all dockview panels.
 * Subclasses implement _buildContent() to return their content element.
 * Provides Float (⧉) and Size Toggle buttons in the tab actions area.
 */

import LayoutManager from '../layout-manager.js';

// ── Icon SVGs ─────────────────────────────────────────────────────────────────

// "Pop out" — panel is docked, click to float
const FLOAT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="7" height="7" rx="1"/><polyline points="4,1 10,1 10,7"/></svg>`;

// "Push in" — panel is floating, click to snap back (mirror of FLOAT_SVG)
const SNAPBACK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="1" width="7" height="7" rx="1"/><polyline points="7,10 1,10 1,4"/></svg>`;

export class BasePanel {
  constructor() {
    this._el = document.createElement('div');
    this._el.className = 'ce-panel-content';
    this._panelApi      = null;
    this._sizeState    = 'normal'; // 'normal' | 'maximized'
    this._floating     = false;
    this._floatSnapshot = null;
    this._originalPosition = null;
    this._expectedOrientation = null; // 'vertical' | 'horizontal' | null — hint for onDidLocationChange
    this._dropOverlay = null;         // overlay element shown during floating drag
    this._dropZoneData = null;        // array of zone descriptors
  }

  get element() {
    return this._el;
  }

  init(params) {
    this._panelApi = params.api;

    // Restore orientation hint set by _dockAtVpEdge (fromJSON destroys the old instance,
    // so we stash the hint in LayoutManager._pendingOrient for the new instance to pick up).
    const pendingOrient = LayoutManager._pendingOrient?.[params.api.id];
    if (pendingOrient) {
      this._expectedOrientation = pendingOrient;
      delete LayoutManager._pendingOrient[params.api.id];
    }

    this._el.innerHTML = '';
    this._el.appendChild(this._buildContent());
    this._addHeaderActions(params.api);
  }

  /** Override in subclass to return the panel's content element */
  _buildContent() {
    const label = document.createElement('div');
    label.className = 'ce-panel-label';
    label.textContent = 'Panel';
    return label;
  }

  _addHeaderActions(api) {
    // Defer until dockview has rendered the tab DOM
    requestAnimationFrame(() => {
      const tab = this._findTabElement(api);
      if (!tab) return;

      // Don't add twice
      if (tab.querySelector('.ce-panel-action')) return;

      const actionsWrap = document.createElement('div');
      actionsWrap.style.cssText = 'display:flex;align-items:center;gap:2px;margin-left:4px;';

      // Float button — mousedown enables drag-to-dock; no-drag click toggles float
      const floatBtn = document.createElement('button');
      floatBtn.className = 'ce-panel-action';
      this._updateFloatBtn(floatBtn);
      floatBtn.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        e.preventDefault();
        this._startPanelDrag(e, floatBtn);
      });
      floatBtn.addEventListener('click', (e) => e.stopPropagation());

      // Size toggle button
      const sizeBtn = document.createElement('button');
      sizeBtn.className = 'ce-panel-action';
      sizeBtn.dataset.sizeBtn = '1';
      this._updateSizeBtn(sizeBtn);
      sizeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._cycleSizeState(sizeBtn);
      });

      actionsWrap.appendChild(floatBtn);
      actionsWrap.appendChild(sizeBtn);
      tab.appendChild(actionsWrap);
    });
  }

  _findTabElement(api) {
    // dockview gives each panel group a tab; find ours by panel id
    const allTabs = document.querySelectorAll('.dv-default-tab');
    for (const tab of allTabs) {
      if (tab.textContent.trim().startsWith(api.title)) return tab;
    }
    return null;
  }

  // Walk up from the panel content element to find the enclosing dv-groupview
  _findGroupView() {
    let el = this._el;
    while (el && el !== document.body) {
      if (el.classList && el.classList.contains('dv-groupview')) return el;
      el = el.parentElement;
    }
    return null;
  }

  // Override in subclasses to control floating panel dimensions
  get _floatDimensions() {
    return { width: 500, height: 360 };
  }

  _updateFloatBtn(btn) {
    if (!btn) return;
    if (this._floating) {
      btn.innerHTML = SNAPBACK_SVG;
      btn.title     = this._getFloatingTitle();
      btn.classList.add('is-floating');
    } else {
      btn.innerHTML = this._getDockedIcon();
      btn.title     = this._getDockedTitle();
      btn.classList.remove('is-floating');
    }
  }

  /** Override in subclasses to change the docked-state icon/title. */
  _getDockedIcon()   { return FLOAT_SVG; }
  _getDockedTitle()  { return 'Float panel'; }
  /** Override to customise the floating-state button tooltip. */
  _getFloatingTitle() { return 'Snap back'; }

  /**
   * Walk up the DOM from the group view to find the dockview floating wrapper.
   * Dockview wraps floating groups in a 'dv-resize-container' with inline position styles.
   * May use 'inset' shorthand (right-based) instead of 'left', so check all variants.
   */
  _findFloatingContainer() {
    const groupView = this._findGroupView();
    if (!groupView) return null;
    let el = groupView.parentElement;
    while (el && el !== document.documentElement) {
      if (el.classList?.contains('dv-resize-container')) return el;
      const s = el.style;
      if (s && (s.left !== '' || s.right !== '' || s.inset !== '')) return el;
      el = el.parentElement;
    }
    return null;
  }

  /**
   * Creates a drag-handle button:
   *  - When DOCKED:   drag → float at cursor position; click → toggle float
   *  - When FLOATING: drag → move the floating group; click → snap back to grid
   */
  _createDragHandle() {
    const handle = document.createElement('button');
    handle.className = 'ce-panel-action ce-bar-drag-handle';
    this._updateFloatBtn(handle);
    handle.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      this._startBarDrag(e, handle);
    });
    return handle;
  }

  /**
   * Set up the bar element itself as a drag surface.
   * Mousedown on non-interactive areas starts the same drag as the handle button.
   * Call from subclass _addHeaderActions after the bar element is in the DOM.
   */
  _setupBarDrag(barEl) {
    barEl.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('button, input, select, a, .menu-item, [role="button"], [role="menuitem"]')) return;
      e.preventDefault();
      this._startBarDrag(e, null);
    });
  }

  /** Dump the current positions of all bar + content panels to the console. */
  _logLayout(label) {
    const dockApi = LayoutManager.api;
    if (!dockApi) return;
    const groups = dockApi.groups ?? [];
    const snap = groups.map(g => {
      const el = g.element;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const floating = el.classList.contains('dv-groupview-floating');
      const views = (g.panels ?? []).map(p => p.id);
      return `  ${views.join('/')} | y=${Math.round(r.y)} x=${Math.round(r.x)} w=${Math.round(r.width)} h=${Math.round(r.height)}${floating ? ' [FLOATING]' : ''}`;
    }).filter(Boolean);
    console.log(`[DBG] ─── ${label} ───`);
    snap.forEach(s => console.log(s));
    // Also log current JSON floating list
    try {
      const fg = (dockApi.toJSON()?.floatingGroups ?? []).map(fg => fg.data?.views);
      if (fg.length) console.log(`  floatingGroups in JSON: ${JSON.stringify(fg)}`);
    } catch(_) {}
  }

  /**
   * Core drag logic shared by handle button and bar background mousedown.
   * handleEl is used for float/snap-back on no-drag clicks.
   */
  _startBarDrag(e, handleEl) {
    const startX = e.clientX;
    const startY = e.clientY;
    let didDrag = false;
    const _selfId = this._panelApi?.id;
    console.log(`[DBG] mousedown on "${_selfId}" at (${e.clientX},${e.clientY}) — floating=${this._floating}`);
    this._logLayout('layout at drag start');

    if (this._floating) {
      // ── Floating: drag to reposition OR drop onto a dock zone ────────────
      const container = this._findFloatingContainer();
      const baseLeft = container ? container.offsetLeft : 0;
      const baseTop  = container ? container.offsetTop  : 0;
      let activeZone = null;
      let posInit    = false;

      const onMove = (ev) => {
        if (!didDrag && (Math.abs(ev.clientX - startX) > 3 || Math.abs(ev.clientY - startY) > 3)) {
          didDrag = true;
          this._startDropTracking();
        }
        if (didDrag && container) {
          if (!posInit) {
            posInit = true;
            container.style.right  = 'auto';
            container.style.bottom = 'auto';
          }
          container.style.left = (baseLeft + ev.clientX - startX) + 'px';
          container.style.top  = Math.max(0, baseTop + ev.clientY - startY) + 'px';
        }
        if (didDrag) {
          activeZone = this._getDropZoneAt(ev.clientX, ev.clientY);
          this._updateDropZoneHighlight(activeZone);
        }
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        this._stopDropTracking();
        if (!didDrag && handleEl) {
          console.log(`[DBG] "${_selfId}" no-drag → toggleFloat (snap back)`);
          this._toggleFloat(handleEl);
        } else if (activeZone) {
          console.log(`[DBG] "${_selfId}" dropped on zone "${activeZone.id}"`);
          this._dockAtZone(activeZone);
        } else {
          console.log(`[DBG] "${_selfId}" mouseup — no zone hit, stays floating`);
        }
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);

    } else {
      // ── Docked: drag to float, then allow drop-zone docking; click to toggle ──
      const onMove = (ev) => {
        if (!didDrag && (Math.abs(ev.clientX - startX) > 5 || Math.abs(ev.clientY - startY) > 5)) {
          didDrag = true;
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          console.log(`[DBG] "${_selfId}" drag threshold hit → floating now`);
          this._floatAtPosition(ev.clientX, ev.clientY);
          if (this._floating) {
            const floatContainer = this._findFloatingContainer();
            this._startDropTracking();
            console.log(`[DBG] "${_selfId}" drop zones: ${(this._dropZoneData ?? []).map(z => z.id).join(', ')}`);
            let lastX = ev.clientX, lastY = ev.clientY;
            let activeZone = null;
            let _lastZoneId = null;
            let floatPosInit = false;

            const onMoveFloat = (ev2) => {
              if (floatContainer) {
                if (!floatPosInit) {
                  floatPosInit = true;
                  floatContainer.style.right  = 'auto';
                  floatContainer.style.bottom = 'auto';
                  floatContainer.style.left = floatContainer.offsetLeft + 'px';
                  floatContainer.style.top  = floatContainer.offsetTop  + 'px';
                }
                floatContainer.style.left = (parseFloat(floatContainer.style.left || '0') + ev2.clientX - lastX) + 'px';
                floatContainer.style.top  = Math.max(0, parseFloat(floatContainer.style.top || '0') + ev2.clientY - lastY) + 'px';
              }
              lastX = ev2.clientX; lastY = ev2.clientY;
              activeZone = this._getDropZoneAt(ev2.clientX, ev2.clientY);
              this._updateDropZoneHighlight(activeZone);
            };
            const onUpFloat = () => {
              document.removeEventListener('mousemove', onMoveFloat);
              document.removeEventListener('mouseup', onUpFloat);
              this._stopDropTracking();
              if (activeZone) {
                console.log(`[DBG] "${_selfId}" dropped on zone "${activeZone.id}"`);
                this._dockAtZone(activeZone);
              } else {
                console.log(`[DBG] "${_selfId}" mouseup — no zone hit, stays floating`);
              }
            };
            document.addEventListener('mousemove', onMoveFloat);
            document.addEventListener('mouseup', onUpFloat);
          }
        }
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (!didDrag && handleEl) this._toggleFloat(handleEl);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    }
  }

  /**
   * Float the panel at a specific viewport position (used when drag-to-float).
   * Like _toggleFloat but positions the floating group near the cursor.
   */
  _floatAtPosition(clientX, clientY) {
    const dockApi = LayoutManager.api;
    if (!dockApi || this._floating) return;
    this._floatSnapshot = dockApi.toJSON();
    this._floating = true;
    const { width, height } = this._floatDimensions;
    const _myId = this._panelApi?.id;
    console.log(`[DBG] _floatAtPosition "${_myId}" at cursor (${clientX},${clientY})`);
    try {
      const panel = dockApi.getPanel(this._panelApi.id);
      if (!panel) throw new Error('panel not found');
      dockApi.addFloatingGroup(panel, {
        x: Math.max(0, clientX - Math.round(width / 2)),
        y: Math.max(0, clientY - 15),
        width,
        height,
      });
      console.log(`[DBG] "${_myId}" addFloatingGroup OK — floatingGroups now: ${JSON.stringify((dockApi.toJSON()?.floatingGroups ?? []).map(fg => fg.data?.views))}`);
      setTimeout(() => {
        this._fixFloatingSize();
        this._cleanupEmptyGroups();
      }, 50);
    } catch (e) {
      this._floating = false;
      this._floatSnapshot = null;
    }
  }

  _updateSizeBtn(btn) {
    if (this._sizeState === 'normal') {
      // Modern maximize: two corner arrows pointing outward
      btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="1,4 1,1 4,1"/>
        <polyline points="7,1 10,1 10,4"/>
        <polyline points="10,7 10,10 7,10"/>
        <polyline points="4,10 1,10 1,7"/>
      </svg>`;
      btn.title = 'Maximize panel';
    } else {
      // Restore: two corner arrows pointing inward
      btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="4,1 4,4 1,4"/>
        <polyline points="10,4 7,4 7,1"/>
        <polyline points="7,10 7,7 10,7"/>
        <polyline points="1,7 4,7 4,10"/>
      </svg>`;
      btn.title = 'Restore panel';
    }
  }

  _cycleSizeState(btn) {
    if (this._sizeState === 'normal') {
      this._sizeState = 'maximized';
      try { this._panelApi.maximize(); } catch(_) {}
    } else {
      this._sizeState = 'normal';
      try { this._panelApi.exitMaximized(); } catch(_) {}
    }
    this._updateSizeBtn(btn);
  }

  /**
   * Force the dockview floating container to the bar's intended dimensions.
   * Uses both setConstraints (prevents dockview's ResizeObserver from overriding)
   * and direct DOM style (handles the fromJSON restore case).
   * Also repositions the bar if it would overflow the viewport right edge.
   */
  _fixFloatingSize() {
    if (!this._floating) return;
    const container = this._findFloatingContainer();
    if (!container) return;
    const { width, height } = this._floatDimensions;
    // Lock size via dockview's constraint system first (prevents ResizeObserver override)
    const groupApi = this._panelApi?.group?.api;
    if (groupApi) {
      try {
        groupApi.setConstraints({
          minimumWidth: width, maximumWidth: width,
          minimumHeight: height, maximumHeight: height,
        });
        groupApi.setSize({ width, height });
      } catch (_) {}
    }
    // Also set directly on the DOM element as a belt-and-suspenders fix
    container.style.width  = width  + 'px';
    container.style.height = height + 'px';
    // If the new width would push the bar off the right edge, repin to left=0
    const rect = container.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      container.style.right  = 'auto';
      container.style.bottom = 'auto';
      container.style.left   = Math.max(0, window.innerWidth - width - 4) + 'px';
    }
  }

  /**
   * Remove empty non-floating groups left behind when a panel floats.
   * Called after addFloatingGroup so the vacated grid slot disappears.
   */
  _cleanupEmptyGroups() {
    const dockApi = LayoutManager.api;
    if (!dockApi) return;
    try {
      const groups = [...(dockApi.groups ?? [])];
      for (const g of groups) {
        const isEmpty = (g.panels?.length ?? 0) === 0;
        const isNotFloating = !g.element?.classList?.contains('dv-groupview-floating');
        if (isEmpty && isNotFloating) {
          try { dockApi.removeGroup(g); } catch (_) {}
        }
      }
    } catch (e) {
      console.warn('[Cyco] cleanupEmptyGroups:', e);
    }
  }

  /**
   * Build the list of drop-zone descriptors based on current layout.
   * Each descriptor: { id, direction, panelId?, isVertical, rect }
   */
  _computeDropZones(includeSwap = false) {
    const zones = [];
    const W = window.innerWidth;
    const H = window.innerHeight;
    const EDGE = 50;

    // Priority order:
    //   1. center-viewport edges (most specific: narrow 100px column)
    //   2. viewport edges (full-screen strips)
    //   3. other panel edges (scene-hierarchy, properties, assets-browser)
    //
    // This ensures e.g. dragging to the narrow center-viewport column at y=3-43 hits
    // p-center-viewport-above rather than vp-top, while dragging to the left half at
    // y=25 hits vp-top rather than p-scene-hierarchy-above.
    const dockApi = LayoutManager.api;
    const PANEL_EDGE = 40;
    const selfId = this._panelApi?.id;

    const addPanelZones = (panelId) => {
      if (panelId === selfId) return; // don't create zones for the panel being dragged
      // Horizontal-only bars (menu bar, GM toolbar) must not dock adjacent to specific content
      // panels — that inserts them inside the content branch instead of the top-level vertical
      // stack, which breaks the layout. They only use vp-edge zones.
      if (selfId === 'menu-bar-panel' || selfId === 'toolbar-panel') return;
      const p = dockApi?.getPanel(panelId);
      if (!p) return;
      const gEl = p.api?.group?.element;
      if (!gEl || gEl.classList.contains('dv-groupview-floating')) return; // skip floating
      const r = gEl.getBoundingClientRect();
      if (r.width < 20 || r.height < 20) return;
      const m = PANEL_EDGE;
      zones.push({ id: `p-${panelId}-above`, direction: 'top',    panelId, isVertical: false, rect: { left: r.left,         top: r.top,          width: r.width,          height: m             } });
      zones.push({ id: `p-${panelId}-below`, direction: 'bottom', panelId, isVertical: false, rect: { left: r.left,         top: r.bottom - m,   width: r.width,          height: m             } });
      zones.push({ id: `p-${panelId}-left`,  direction: 'left',   panelId, isVertical: true,  rect: { left: r.left,         top: r.top + m,      width: m,                height: r.height-2*m  } });
      zones.push({ id: `p-${panelId}-right`, direction: 'right',  panelId, isVertical: true,  rect: { left: r.right - m,    top: r.top + m,      width: m,                height: r.height-2*m  } });
      // Center zone: merge into the same tab group (only for non-bar panel drags)
      if (includeSwap && r.width > 2 * m && r.height > 2 * m) {
        zones.push({ id: `p-${panelId}-swap`, direction: 'swap', panelId, isVertical: null,
          rect: { left: r.left + m, top: r.top + m, width: r.width - 2 * m, height: r.height - 2 * m } });
      }
    };

    // 1a. Inner horizontal zones — just below menu bar / just above game manager toolbar.
    // These must come FIRST (highest priority) so they beat the p-center-viewport-above/below
    // panel edge zones which also cover that area. Excluded from the left/right EDGE columns
    // so they don't interfere with vp-left/vp-right.
    const menuBarEl = dockApi?.getPanel('menu-bar-panel')?.api?.group?.element;
    if (menuBarEl && selfId !== 'menu-bar-panel' && !menuBarEl.classList.contains('dv-groupview-floating')) {
      const mr = menuBarEl.getBoundingClientRect();
      if (mr.width > 200 && !menuBarEl.classList.contains('ce-bar-vertical')) {
        zones.push({ id: 'vp-top-inner', direction: 'below-menu', isVertical: false,
          rect: { left: EDGE, top: mr.bottom, width: W - 2 * EDGE, height: EDGE } });
      }
    }
    const gmToolbarEl = dockApi?.getPanel('toolbar-panel')?.api?.group?.element;
    if (gmToolbarEl) {
      const toolbarIsFloating = gmToolbarEl.classList.contains('dv-groupview-floating');
      if (!toolbarIsFloating) {
        const tr = gmToolbarEl.getBoundingClientRect();
        if (tr.width > 200 && !gmToolbarEl.classList.contains('ce-bar-vertical')) {
          zones.push({ id: 'vp-bottom-inner', direction: 'above-toolbar', isVertical: false,
            rect: { left: EDGE, top: tr.top - EDGE, width: W - 2 * EDGE, height: EDGE } });
        }
      } else if (selfId === 'toolbar-panel') {
        // Toolbar is the panel being dragged — add a zone just above the bottom edge
        // so the user can dock it back near its original position.
        zones.push({ id: 'vp-bottom-inner', direction: 'above-toolbar', isVertical: false,
          rect: { left: EDGE, top: H - 2 * EDGE, width: W - 2 * EDGE, height: EDGE } });
      }
    }

    // 1b. center-viewport edges (among panel-edge zones)
    addPanelZones('center-viewport');

    // 2. Viewport edges (full-screen strips)
    zones.push({ id: 'vp-top',    direction: 'above', isVertical: false, rect: { left: 0,         top: 0,         width: W,    height: EDGE          } });
    zones.push({ id: 'vp-bottom', direction: 'below', isVertical: false, rect: { left: 0,         top: H - EDGE,  width: W,    height: EDGE          } });
    zones.push({ id: 'vp-left',   direction: 'left',  isVertical: true,  rect: { left: 0,         top: EDGE,      width: EDGE, height: H - 2 * EDGE  } });
    zones.push({ id: 'vp-right',  direction: 'right', isVertical: true,  rect: { left: W - EDGE,  top: EDGE,      width: EDGE, height: H - 2 * EDGE  } });

    // 3. Remaining panel edges
    for (const panelId of ['scene-hierarchy', 'properties', 'assets-browser']) {
      addPanelZones(panelId);
    }

    return zones;
  }

  /** Create and show a fixed overlay with all drop-zone indicator divs. */
  _startDropTracking(includeSwap = false) {
    this._stopDropTracking();
    const overlay = document.createElement('div');
    overlay.className = 'ce-drop-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9500;';

    this._dropZoneData = this._computeDropZones(includeSwap);
    for (const zone of this._dropZoneData) {
      const el = document.createElement('div');
      el.className = 'ce-drop-indicator';
      el.dataset.zoneId = zone.id;
      el.style.cssText = `position:absolute;left:${zone.rect.left}px;top:${zone.rect.top}px;width:${zone.rect.width}px;height:${zone.rect.height}px;`;
      overlay.appendChild(el);
    }
    document.body.appendChild(overlay);
    this._dropOverlay = overlay;
  }

  /** Remove the drop-zone overlay. */
  _stopDropTracking() {
    this._dropOverlay?.remove();
    this._dropOverlay = null;
    this._dropZoneData = null;
  }

  /** Return the zone descriptor under the given cursor, or null. */
  _getDropZoneAt(clientX, clientY) {
    if (!this._dropZoneData) return null;
    for (const zone of this._dropZoneData) {
      const r = zone.rect;
      if (clientX >= r.left && clientX <= r.left + r.width &&
          clientY >= r.top  && clientY <= r.top  + r.height) {
        return zone;
      }
    }
    return null;
  }

  /** Highlight the active drop-zone indicator in the overlay. */
  _updateDropZoneHighlight(activeZone) {
    if (!this._dropOverlay) return;
    for (const el of this._dropOverlay.querySelectorAll('.ce-drop-indicator')) {
      const active = el.dataset.zoneId === activeZone?.id;
      el.style.background   = active ? 'rgba(224,114,40,0.25)' : 'rgba(255,255,255,0.04)';
      el.style.borderColor  = active ? 'rgba(224,114,40,0.8)'  : 'rgba(255,255,255,0.08)';
      el.style.border       = `2px solid ${active ? 'rgba(224,114,40,0.8)' : 'rgba(255,255,255,0.08)'}`;
      el.style.borderRadius = '4px';
    }
  }

  /**
   * Dock the floating bar at a layout zone.
   * All zones (VP-edge and panel-edge) use JSON manipulation for reliable placement.
   */
  _dockAtZone(zone) {
    if (!zone) return;
    const dockApi = LayoutManager.api;
    if (!dockApi) return;

    console.log(`[DBG] _dockAtZone "${this._panelApi?.id}" → zone "${zone.id}"${zone.panelId ? ` (panel-edge of ${zone.panelId})` : ''}`);
    this._logLayout('layout before dock');

    this._floating = false;
    const prevSnapshot = this._floatSnapshot;
    this._floatSnapshot = null;
    this._expectedOrientation = zone.isVertical ? 'vertical' : 'horizontal';

    if (!zone.panelId) {
      // Viewport edge — full-width rows / full-height columns
      this._dockAtVpEdge(zone, prevSnapshot);
    } else {
      // Panel edge — insert adjacent to a specific content panel.
      // Safety: horizontal-only bars must never go through _dockAtPanelEdge because
      // that places them inside a content branch column instead of the top-level
      // vertical stack, breaking the layout.
      const panelId = this._panelApi?.id;
      if (panelId === 'menu-bar-panel' || panelId === 'toolbar-panel') {
        console.warn(`[Cyco] safety: blocked _dockAtPanelEdge for horizontal bar "${panelId}" at zone "${zone.id}"`);
        this._floating = true;
        this._floatSnapshot = prevSnapshot;
        return;
      }
      this._dockAtPanelEdge(zone, prevSnapshot);
    }
  }

  /**
   * Dock the bar adjacent to a specific content panel using direct JSON manipulation.
   * This mirrors _dockAtVpEdge's approach to guarantee correct sizes and orientation.
   *
   * Dockview assigns branch orientation by depth parity:
   *   even depth → HORIZONTAL branch (children are columns)
   *   odd  depth → VERTICAL branch (children are rows)
   *
   * For left/right (want horizontal siblings):
   *   - if parent is H (even) → insert barLeaf as sibling in parent.data
   *   - if parent is V (odd)  → wrap [bar, target] in a new branch at targetDepth (even=H)
   * For top/bottom (want vertical siblings):
   *   - if parent is V (odd)  → insert barLeaf as sibling in parent.data
   *   - if parent is H (even) → wrap [bar, target] in a new branch at targetDepth (odd=V)
   */
  _dockAtPanelEdge(zone, prevSnapshot) {
    const dockApi = LayoutManager.api;
    const panelId = this._panelApi.id;
    const barH    = this._barHeight;
    const BAR_IDS = ['menu-bar-panel', 'toolbar-panel', 'left-toolbar'];

    try {
      const json = dockApi.toJSON();

      // Remove this bar from the grid (it's floating, but clean up just in case)
      // Also strips stale empty-views leaves that remain after addFloatingGroup.
      const removeBar = (node) => {
        if (!node) return null;
        if (node.type === 'leaf') {
          const views = node.data?.views ?? [];
          return (views.includes(panelId) || views.length === 0) ? null : node;
        }
        const filtered = (node.data ?? []).map(removeBar).filter(Boolean);
        if (filtered.length === 0) return null;
        if (filtered.length === 1 && (node.data ?? []).length > 1) return { ...filtered[0], size: node.size };
        return { ...node, data: filtered };
      };

      const floating = (json.floatingGroups ?? []).filter(
        fg => !(fg.data?.views ?? []).includes(panelId)
      );
      const cleanRoot = removeBar(json.grid?.root);

      // Leaf for the bar being inserted
      const barLeaf = {
        type: 'leaf',
        data: { id: `grp-${panelId}`, views: [panelId], activeView: panelId },
        size: barH,
      };

      // ── Helpers ────────────────────────────────────────────────────────────
      // Find the leaf whose views[] contains targetPanelId, returning its
      // depth, immediate parent branch, and index within that parent.
      const findLeaf = (node, targetId, depth = 0, parent = null, idxInParent = 0) => {
        if (!node) return null;
        if (node.type === 'leaf') {
          return (node.data?.views ?? []).includes(targetId)
            ? { leaf: node, depth, parent, idxInParent }
            : null;
        }
        for (let i = 0; i < (node.data ?? []).length; i++) {
          const hit = findLeaf(node.data[i], targetId, depth + 1, node, i);
          if (hit) return hit;
        }
        return null;
      };

      // Deep-replace one node in the tree.
      const replaceDeep = (node, target, replacement) => {
        if (node === target) return replacement;
        if (node?.type !== 'branch') return node;
        return { ...node, data: node.data.map(c => replaceDeep(c, target, replacement)) };
      };

      // Insert newItem as a sibling of the child at childIndex in parentNode.
      const insertInParent = (root, parentNode, childIndex, insertBefore, newItem) => {
        const walk = (node) => {
          if (node === parentNode) {
            const d = [...node.data];
            d.splice(insertBefore ? childIndex : childIndex + 1, 0, newItem);
            return { ...node, data: d };
          }
          if (node?.type !== 'branch') return node;
          return { ...node, data: node.data.map(walk) };
        };
        return walk(root);
      };
      // ── End helpers ────────────────────────────────────────────────────────

      const found = findLeaf(cleanRoot, zone.panelId);
      if (!found) throw new Error(`[Cyco] panel "${zone.panelId}" not found in grid`);

      const { leaf: targetLeaf, depth: targetDepth, parent, idxInParent } = found;
      const parentDepth = targetDepth - 1;
      // Even depth = HORIZONTAL branch (columns), odd depth = VERTICAL branch (rows)
      const parentIsH = (parentDepth % 2 === 0);

      const insertBefore = (zone.direction === 'left' || zone.direction === 'top');
      const wantColumns  = (zone.direction === 'left' || zone.direction === 'right');

      let newRoot;
      if (wantColumns) {
        if (parentIsH) {
          // Parent already arranges children as columns → just insert as sibling
          newRoot = insertInParent(cleanRoot, parent, idxInParent, insertBefore, barLeaf);
        } else {
          // Parent is vertical → wrap [bar, target] in a new H branch.
          // New H-branch keeps the target's slot height (targetLeaf.size).
          // Inside the H-branch, bar takes barH width; target gets remaining
          // (parent.size is the available WIDTH since parent is a V-branch).
          const innerLeaf = { ...targetLeaf, size: Math.max(10, (parent?.size ?? 100) - barH) };
          const data = insertBefore ? [barLeaf, innerLeaf] : [innerLeaf, barLeaf];
          newRoot = replaceDeep(cleanRoot, targetLeaf, { type: 'branch', data, size: targetLeaf.size });
        }
      } else { // wantRows (top / bottom)
        if (!parentIsH) {
          // Parent already arranges children as rows → just insert as sibling
          newRoot = insertInParent(cleanRoot, parent, idxInParent, insertBefore, barLeaf);
        } else {
          // Parent is horizontal → wrap [bar, target] in a new V branch.
          // New V-branch keeps the target's slot width (targetLeaf.size).
          // Inside the V-branch, bar takes barH height; target gets remaining
          // (parent.size is the available HEIGHT since parent is an H-branch).
          const innerLeaf = { ...targetLeaf, size: Math.max(10, (parent?.size ?? 400) - barH) };
          const data = insertBefore ? [barLeaf, innerLeaf] : [innerLeaf, barLeaf];
          newRoot = replaceDeep(cleanRoot, targetLeaf, { type: 'branch', data, size: targetLeaf.size });
        }
      }

      if (!newRoot) throw new Error('[Cyco] _dockAtPanelEdge: failed to build new grid');

      const newLayout = { ...json, grid: { ...json.grid, root: newRoot }, floatingGroups: floating };

      // Fix panel JSON constraints to match the target orientation.
      if (newLayout.panels?.[panelId]) {
        const p = { ...newLayout.panels[panelId] };
        if (zone.isVertical) {
          delete p.minimumHeight; delete p.maximumHeight;
          p.minimumWidth = barH; p.maximumWidth = barH;
        } else {
          delete p.minimumWidth; delete p.maximumWidth;
          p.minimumHeight = barH; p.maximumHeight = barH;
        }
        newLayout.panels[panelId] = p;
      }

      // Stash orientation hints and preserve other bars already docked vertically.
      LayoutManager._pendingOrient = LayoutManager._pendingOrient ?? {};
      const _barGroupClassMap = { 'toolbar-panel': 'ce-toolbar-group', 'menu-bar-panel': 'ce-menu-bar-group', 'left-toolbar': 'ce-left-toolbar-group' };
      for (const bId of BAR_IDS) {
        if (bId === panelId) continue;
        if (!newLayout.panels?.[bId]) continue;
        const groupEl = document.querySelector(`.${_barGroupClassMap[bId]}.ce-bar-vertical`);
        if (groupEl) {
          LayoutManager._pendingOrient[bId] = 'vertical';
          const rect = groupEl.getBoundingClientRect();
          const otherBarH = (rect.width > 0 && rect.width < 100) ? Math.round(rect.width) : 32;
          const bp = { ...newLayout.panels[bId] };
          delete bp.minimumHeight; delete bp.maximumHeight;
          bp.minimumWidth = otherBarH; bp.maximumWidth = otherBarH;
          newLayout.panels[bId] = bp;
        }
      }
      LayoutManager._pendingOrient[panelId] = zone.isVertical ? 'vertical' : 'horizontal';

      LayoutManager._restoringLayout = true;
      dockApi.fromJSON(newLayout);
      LayoutManager._restoringLayout = false;

      if (this._floatBtn) this._updateFloatBtn(this._floatBtn);
      setTimeout(() => this._cleanupEmptyGroups(), 100);

    } catch (err) {
      LayoutManager._restoringLayout = false;
      console.warn('[Cyco] _dockAtPanelEdge error:', err);
      this._expectedOrientation = null;
      this._floating = true;
      this._floatSnapshot = prevSnapshot;
    }
  }

  /**
   * Dock the bar at a viewport edge by directly rewriting the dockview grid JSON.
   * This guarantees full-width rows (vp-top/vp-bottom) and full-height columns
   * (vp-left/vp-right) regardless of the current layout state.
   */
  _dockAtVpEdge(zone, prevSnapshot) {
    const dockApi = LayoutManager.api;
    const panelId = this._panelApi.id;
    const barH    = this._barHeight;
    const BAR_IDS = ['menu-bar-panel', 'toolbar-panel', 'left-toolbar'];

    try {
      const json = dockApi.toJSON();

      // ── RAW SIZE DIAGNOSTIC ──────────────────────────────────────────────
      { const _r = json.grid?.root; const _vs = (_r?.data?.length===1&&_r.data[0]?.type==='branch')?_r.data[0]:_r; console.log(`[DBG-SIZE] toJSON grid w=${json.grid?.width} h=${json.grid?.height} | root.size=${_r?.size} vStack.size=${_vs?.size}`); console.log(`[DBG-SIZE] vStack rows:`, (_vs?.data??[]).map(n=>`${n.type}[${n.type==='leaf'?(n.data?.views??[]).join('/'):''+n.data?.length+'ch'}]:sz=${n.size}`).join(' | ')); (_vs?.data??[]).forEach((row,ri)=>{ if(row.type==='branch'){ console.log(`[DBG-SIZE] row[${ri}] children:`, (row.data??[]).map(n=>`${n.type}[${n.type==='leaf'?(n.data?.views??[]).join('/'):''+n.data?.length+'ch'}]:sz=${n.size}`).join(' | ')); } }); }
      // ────────────────────────────────────────────────────────────────────

      // Remove barPanel leaf from a grid node recursively.
      // Also strips stale empty-views leaves that remain after addFloatingGroup.
      const removeBar = (node) => {
        if (!node) return null;
        if (node.type === 'leaf') {
          const views = node.data?.views ?? [];
          return (views.includes(panelId) || views.length === 0) ? null : node;
        }
        const filtered = (node.data ?? []).map(removeBar).filter(Boolean);
        if (filtered.length === 0) return null;
        if (filtered.length === 1 && (node.data ?? []).length > 1) return { ...filtered[0], size: node.size };
        return { ...node, data: filtered };
      };

      const floating = (json.floatingGroups ?? []).filter(
        fg => !(fg.data?.views ?? []).includes(panelId)
      );
      const cleanRoot = removeBar(json.grid?.root);

      // Leaf node to insert for the bar
      // group id must be a unique string (dockview requirement)
      const barLeaf = { type: 'leaf', data: { id: `grp-${panelId}`, views: [panelId], activeView: panelId }, size: barH };

      // Dockview alternates split orientation by depth:
      //   root (depth 0) = HORIZONTAL wrapper (single child in the default layout)
      //   vertical stack (depth 1) = VERTICAL branch — rows stacked top-to-bottom
      //   content branch (depth 2) = HORIZONTAL branch — columns side-by-side
      //
      // To get a full-width row (vp-top/vp-bottom) we insert in the VERTICAL STACK.
      // To get a full-height column (vp-left/vp-right) we insert in the CONTENT BRANCH.

      // Vertical stack: root.data[0] when root has exactly 1 branch child,
      // otherwise root itself acts as the vertical stack.
      const getVerticalStack = (root) => {
        if (root?.type === 'branch' && root.data?.length === 1 && root.data[0]?.type === 'branch') {
          return root.data[0];
        }
        return root;
      };

      // Content branch: the shallowest branch whose direct leaf children include non-bar panels.
      const findContentBranch = (node) => {
        if (!node || node.type === 'leaf') return null;
        const hasDirectContent = (node.data ?? []).some(child =>
          child.type === 'leaf' && (child.data?.views ?? []).some(v => !BAR_IDS.includes(v))
        );
        if (hasDirectContent) return node;
        for (const child of node.data ?? []) {
          const found = findContentBranch(child);
          if (found) return found;
        }
        return null;
      };

      let newRoot;
      if (zone.id === 'vp-top' || zone.id === 'vp-bottom' ||
          zone.id === 'vp-top-inner' || zone.id === 'vp-bottom-inner') {
        const vStack = getVerticalStack(cleanRoot);
        if (!vStack || vStack.type !== 'branch') throw new Error('vertical stack not found');
        if (vStack === cleanRoot) {
          // Root IS the horizontal content branch (dockview collapsed the vertical wrapper).
          // Treat inner zones same as top/bottom — wrap in a new VERTICAL branch.
          const atTop = zone.id === 'vp-top' || zone.id === 'vp-top-inner';
          const newVertStack = { type: 'branch', data:
            atTop ? [barLeaf, cleanRoot] : [cleanRoot, barLeaf] };
          newRoot = { type: 'branch', data: [newVertStack] };
        } else if (zone.id === 'vp-top-inner') {
          // Insert immediately AFTER the menu-bar-panel leaf in the vertical stack
          const menuIdx = (vStack.data ?? []).findIndex(n =>
            n.type === 'leaf' && (n.data?.views ?? []).includes('menu-bar-panel'));
          const insertAt = menuIdx >= 0 ? menuIdx + 1 : 1;
          const rows = [...vStack.data.slice(0, insertAt), barLeaf, ...vStack.data.slice(insertAt)];
          const newVStack = { ...vStack, data: rows };
          newRoot = { ...cleanRoot, data: [newVStack] };
        } else if (zone.id === 'vp-bottom-inner') {
          // Insert immediately BEFORE the toolbar-panel leaf in the vertical stack
          const toolbarIdx = (vStack.data ?? []).findIndex(n =>
            n.type === 'leaf' && (n.data?.views ?? []).includes('toolbar-panel'));
          // When toolbar is floating (being dragged), toolbarIdx=-1; append at end = original position
          const insertAt = toolbarIdx >= 0 ? toolbarIdx : vStack.data.length;
          const rows = [...vStack.data.slice(0, insertAt), barLeaf, ...vStack.data.slice(insertAt)];
          const newVStack = { ...vStack, data: rows };
          newRoot = { ...cleanRoot, data: [newVStack] };
        } else {
          // vp-top / vp-bottom: insert at very start / very end of the vertical stack
          const rows = zone.id === 'vp-top'
            ? [barLeaf, ...(vStack.data ?? [])]
            : [...(vStack.data ?? []), barLeaf];
          const newVStack = { ...vStack, data: rows };
          newRoot = { ...cleanRoot, data: [newVStack] };
        }

      } else {
        // vp-left / vp-right: insert as a column in the content (horizontal) branch
        const contentBranch = findContentBranch(cleanRoot);
        if (!contentBranch) throw new Error('content branch not found');
        const cols = zone.id === 'vp-left'
          ? [barLeaf, ...(contentBranch.data ?? [])]
          : [...(contentBranch.data ?? []), barLeaf];
        const replaceNode = (node) => {
          if (node === contentBranch) return { ...contentBranch, data: cols };
          if (node?.type !== 'branch') return node;
          return { ...node, data: node.data.map(replaceNode) };
        };
        newRoot = replaceNode(cleanRoot);
      }

      const newLayout = { ...json, grid: { ...json.grid, root: newRoot }, floatingGroups: floating };

      // Fix panel JSON constraints to match the target orientation.
      // For vertical placement: no height constraints (they collapse the column), set width.
      // For horizontal placement: no width constraints (they would constrain row width), set height.
      if (newLayout.panels?.[panelId]) {
        const p = { ...newLayout.panels[panelId] };
        if (zone.isVertical) {
          delete p.minimumHeight;
          delete p.maximumHeight;
          p.minimumWidth = barH;
          p.maximumWidth = barH;
        } else {
          delete p.minimumWidth;
          delete p.maximumWidth;
          p.minimumHeight = barH;
          p.maximumHeight = barH;
        }
        newLayout.panels[panelId] = p;
      }
      // Stash orientation hints for ALL bars before fromJSON recreates every panel instance.
      // fromJSON does NOT fire onDidLocationChange, so each panel's init() relies on
      // _pendingOrient to restore the correct orientation.
      LayoutManager._pendingOrient = LayoutManager._pendingOrient ?? {};

      // Preserve orientation of OTHER bars that are already docked vertically.
      // DOM class detection is the most reliable way to know current orientation.
      const _barGroupClassMap = { 'toolbar-panel': 'ce-toolbar-group', 'menu-bar-panel': 'ce-menu-bar-group', 'left-toolbar': 'ce-left-toolbar-group' };
      for (const bId of BAR_IDS) {
        if (bId === panelId) continue;
        if (!newLayout.panels?.[bId]) continue;
        const groupEl = document.querySelector(`.${_barGroupClassMap[bId]}.ce-bar-vertical`);
        if (groupEl) {
          LayoutManager._pendingOrient[bId] = 'vertical';
          // Also strip height constraints from the panel JSON (they would collapse the column
          // height during fromJSON) and ensure width constraints are set.
          const rect = groupEl.getBoundingClientRect();
          const otherBarH = (rect.width > 0 && rect.width < 100) ? Math.round(rect.width) : 32;
          const bp = { ...newLayout.panels[bId] };
          delete bp.minimumHeight;
          delete bp.maximumHeight;
          bp.minimumWidth = otherBarH;
          bp.maximumWidth = otherBarH;
          newLayout.panels[bId] = bp;
        }
      }

      // Hint for the panel being moved
      LayoutManager._pendingOrient[panelId] = zone.isVertical ? 'vertical' : 'horizontal';

      // ── RAW SIZE DIAGNOSTIC (newLayout) ─────────────────────────────────
      { const _nr = newLayout.grid?.root; const _nvs = (_nr?.data?.length===1&&_nr.data[0]?.type==='branch')?_nr.data[0]:_nr; console.log(`[DBG-SIZE] newLayout grid w=${newLayout.grid?.width} h=${newLayout.grid?.height} | root.size=${_nr?.size} vStack.size=${_nvs?.size}`); console.log(`[DBG-SIZE] newVStack rows:`, (_nvs?.data??[]).map(n=>`${n.type}[${n.type==='leaf'?(n.data?.views??[]).join('/'):''+n.data?.length+'ch'}]:sz=${n.size}`).join(' | ')); }
      // ────────────────────────────────────────────────────────────────────

      LayoutManager._restoringLayout = true;
      dockApi.fromJSON(newLayout);
      LayoutManager._restoringLayout = false;

      console.log(`[DBG] fromJSON done for "${panelId}" \u2192 zone "${zone.id}"`);
      if (this._floatBtn) this._updateFloatBtn(this._floatBtn);
      setTimeout(() => {
        this._cleanupEmptyGroups();
        this._logLayout('layout after dock (100ms)');
      }, 100);

    } catch (err) {
      LayoutManager._restoringLayout = false;
      console.warn('[Cyco] _dockAtVpEdge error:', err);
      this._expectedOrientation = null;
      this._floating = true;
      this._floatSnapshot = prevSnapshot;
    }
  }

  // ── Non-bar panel drag-to-dock system ─────────────────────────────────────

  /**
   * Drag handler for regular content panels (non-bar).
   * Like _startBarDrag but uses _dockPanelAtZone and enables swap (center) zones.
   */
  _startPanelDrag(e, btn) {
    const startX = e.clientX;
    const startY = e.clientY;
    let didDrag = false;

    if (this._floating) {
      // ── Floating: drag to reposition OR drop onto a dock zone ────────────
      const container = this._findFloatingContainer();
      const baseLeft = container ? container.offsetLeft : 0;
      const baseTop  = container ? container.offsetTop  : 0;
      let activeZone = null;
      let posInit    = false;

      const onMove = (ev) => {
        if (!didDrag && (Math.abs(ev.clientX - startX) > 3 || Math.abs(ev.clientY - startY) > 3)) {
          didDrag = true;
          this._startDropTracking(true);
        }
        if (didDrag && container) {
          if (!posInit) { posInit = true; container.style.right = 'auto'; container.style.bottom = 'auto'; }
          container.style.left = (baseLeft + ev.clientX - startX) + 'px';
          container.style.top  = Math.max(0, baseTop + ev.clientY - startY) + 'px';
        }
        if (didDrag) {
          activeZone = this._getDropZoneAt(ev.clientX, ev.clientY);
          this._updateDropZoneHighlight(activeZone);
        }
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        this._stopDropTracking();
        if (!didDrag && btn) { this._toggleFloat(btn); }
        else if (activeZone) { this._dockPanelAtZone(activeZone); }
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);

    } else {
      // ── Docked: drag to float, then allow drop-zone docking; click to toggle ──
      const onMove = (ev) => {
        if (!didDrag && (Math.abs(ev.clientX - startX) > 5 || Math.abs(ev.clientY - startY) > 5)) {
          didDrag = true;
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          this._floatAtPosition(ev.clientX, ev.clientY);
          if (this._floating) {
            const floatContainer = this._findFloatingContainer();
            this._startDropTracking(true);
            let lastX = ev.clientX, lastY = ev.clientY;
            let activeZone = null;
            let floatPosInit = false;

            const onMoveFloat = (ev2) => {
              if (floatContainer) {
                if (!floatPosInit) {
                  floatPosInit = true;
                  floatContainer.style.right  = 'auto'; floatContainer.style.bottom = 'auto';
                  floatContainer.style.left = floatContainer.offsetLeft + 'px';
                  floatContainer.style.top  = floatContainer.offsetTop  + 'px';
                }
                floatContainer.style.left = (parseFloat(floatContainer.style.left || '0') + ev2.clientX - lastX) + 'px';
                floatContainer.style.top  = Math.max(0, parseFloat(floatContainer.style.top || '0') + ev2.clientY - lastY) + 'px';
              }
              lastX = ev2.clientX; lastY = ev2.clientY;
              activeZone = this._getDropZoneAt(ev2.clientX, ev2.clientY);
              this._updateDropZoneHighlight(activeZone);
            };
            const onUpFloat = () => {
              document.removeEventListener('mousemove', onMoveFloat);
              document.removeEventListener('mouseup', onUpFloat);
              this._stopDropTracking();
              if (activeZone) this._dockPanelAtZone(activeZone);
            };
            document.addEventListener('mousemove', onMoveFloat);
            document.addEventListener('mouseup', onUpFloat);
          }
        }
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (!didDrag && btn) this._toggleFloat(btn);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    }
  }

  /** Route a content-panel drop to the right docking method. */
  _dockPanelAtZone(zone) {
    if (!zone) return;
    const dockApi = LayoutManager.api;
    if (!dockApi) return;
    this._floating = false;
    const prevSnapshot = this._floatSnapshot;
    this._floatSnapshot = null;
    if (zone.direction === 'swap') {
      this._mergePanelIntoGroup(zone.panelId, prevSnapshot);
    } else {
      this._expectedOrientation = zone.isVertical ? 'vertical' : 'horizontal';
      if (!zone.panelId) {
        this._dockPanelAtVpEdge(zone, prevSnapshot);
      } else {
        this._dockPanelAtPanelEdge(zone, prevSnapshot);
      }
    }
  }

  /** Merge the floating panel into the target panel's tab group via JSON. */
  _mergePanelIntoGroup(targetPanelId, prevSnapshot) {
    const dockApi = LayoutManager.api;
    const panelId = this._panelApi.id;
    try {
      const json = dockApi.toJSON();
      const removePanel = (node) => {
        if (!node) return null;
        if (node.type === 'leaf') {
          const views = node.data?.views ?? [];
          return (views.includes(panelId) || views.length === 0) ? null : node;
        }
        const filtered = (node.data ?? []).map(removePanel).filter(Boolean);
        if (filtered.length === 0) return null;
        if (filtered.length === 1 && (node.data ?? []).length > 1) return { ...filtered[0], size: node.size };
        return { ...node, data: filtered };
      };
      const floating = (json.floatingGroups ?? []).filter(fg => !(fg.data?.views ?? []).includes(panelId));
      const cleanRoot = removePanel(json.grid?.root);
      const addToTargetLeaf = (node) => {
        if (!node) return node;
        if (node.type === 'leaf' && (node.data?.views ?? []).includes(targetPanelId)) {
          return { ...node, data: { ...node.data, views: [panelId, ...(node.data.views ?? [])], activeView: panelId } };
        }
        if (node.type === 'branch') return { ...node, data: node.data.map(addToTargetLeaf) };
        return node;
      };
      const newRoot = addToTargetLeaf(cleanRoot);
      const newLayout = { ...json, grid: { ...json.grid, root: newRoot }, floatingGroups: floating };
      if (newLayout.panels?.[panelId]) {
        const p = { ...newLayout.panels[panelId] };
        delete p.minimumWidth; delete p.maximumWidth; delete p.minimumHeight; delete p.maximumHeight;
        newLayout.panels[panelId] = p;
      }
      LayoutManager._restoringLayout = true;
      dockApi.fromJSON(newLayout);
      LayoutManager._restoringLayout = false;
      setTimeout(() => this._cleanupEmptyGroups(), 100);
    } catch (err) {
      LayoutManager._restoringLayout = false;
      console.warn('[Cyco] _mergePanelIntoGroup error:', err);
      this._floating = true; this._floatSnapshot = prevSnapshot;
    }
  }

  /** Get the floating panel's current rendered size for use when re-docking. */
  _getPanelFloatSize(defaultW = 300, defaultH = 240) {
    const container = this._findFloatingContainer();
    if (container) {
      const r = container.getBoundingClientRect();
      if (r.width > 20) return { width: Math.round(r.width), height: Math.round(r.height) };
    }
    return { width: defaultW, height: defaultH };
  }

  /**
   * Dock a content panel at a viewport edge — like _dockAtVpEdge but uses
   * the panel's current floating size instead of a fixed bar height.
   */
  _dockPanelAtVpEdge(zone, prevSnapshot) {
    const dockApi = LayoutManager.api;
    const panelId = this._panelApi.id;
    const { width: panelW, height: panelH } = this._getPanelFloatSize();
    const BAR_IDS = ['menu-bar-panel', 'toolbar-panel', 'left-toolbar'];
    try {
      const json = dockApi.toJSON();
      const removePanel = (node) => {
        if (!node) return null;
        if (node.type === 'leaf') {
          const views = node.data?.views ?? [];
          return (views.includes(panelId) || views.length === 0) ? null : node;
        }
        const filtered = (node.data ?? []).map(removePanel).filter(Boolean);
        if (filtered.length === 0) return null;
        if (filtered.length === 1 && (node.data ?? []).length > 1) return { ...filtered[0], size: node.size };
        return { ...node, data: filtered };
      };
      const floating = (json.floatingGroups ?? []).filter(fg => !(fg.data?.views ?? []).includes(panelId));
      const cleanRoot = removePanel(json.grid?.root);
      const panelSize = (zone.id === 'vp-left' || zone.id === 'vp-right') ? panelW : panelH;
      const panelLeaf = { type: 'leaf', data: { id: `grp-${panelId}`, views: [panelId], activeView: panelId }, size: panelSize };

      const getVerticalStack = (root) => {
        if (root?.type === 'branch' && root.data?.length === 1 && root.data[0]?.type === 'branch') return root.data[0];
        return root;
      };
      const findContentBranch = (node) => {
        if (!node || node.type === 'leaf') return null;
        const hasDirectContent = (node.data ?? []).some(child =>
          child.type === 'leaf' && (child.data?.views ?? []).some(v => !BAR_IDS.includes(v))
        );
        if (hasDirectContent) return node;
        for (const child of node.data ?? []) { const f = findContentBranch(child); if (f) return f; }
        return null;
      };

      let newRoot;
      if (zone.id === 'vp-top' || zone.id === 'vp-bottom') {
        const vStack = getVerticalStack(cleanRoot);
        if (!vStack || vStack.type !== 'branch') throw new Error('vertical stack not found');
        if (vStack === cleanRoot) {
          const newVertStack = { type: 'branch', data: zone.id === 'vp-top' ? [panelLeaf, cleanRoot] : [cleanRoot, panelLeaf] };
          newRoot = { type: 'branch', data: [newVertStack] };
        } else {
          const rows = zone.id === 'vp-top' ? [panelLeaf, ...(vStack.data ?? [])] : [...(vStack.data ?? []), panelLeaf];
          newRoot = { ...cleanRoot, data: [{ ...vStack, data: rows }] };
        }
      } else {
        const contentBranch = findContentBranch(cleanRoot);
        if (!contentBranch) throw new Error('content branch not found');
        const cols = zone.id === 'vp-left'
          ? [panelLeaf, ...(contentBranch.data ?? [])]
          : [...(contentBranch.data ?? []), panelLeaf];
        const replaceNode = (node) => {
          if (node === contentBranch) return { ...contentBranch, data: cols };
          if (node?.type !== 'branch') return node;
          return { ...node, data: node.data.map(replaceNode) };
        };
        newRoot = replaceNode(cleanRoot);
      }

      const newLayout = { ...json, grid: { ...json.grid, root: newRoot }, floatingGroups: floating };
      if (newLayout.panels?.[panelId]) {
        const p = { ...newLayout.panels[panelId] };
        delete p.minimumWidth; delete p.maximumWidth; delete p.minimumHeight; delete p.maximumHeight;
        newLayout.panels[panelId] = p;
      }
      LayoutManager._pendingOrient = LayoutManager._pendingOrient ?? {};
      const _barGroupClassMap = { 'toolbar-panel': 'ce-toolbar-group', 'menu-bar-panel': 'ce-menu-bar-group', 'left-toolbar': 'ce-left-toolbar-group' };
      for (const bId of BAR_IDS) {
        if (!newLayout.panels?.[bId]) continue;
        const groupEl = document.querySelector(`.${_barGroupClassMap[bId]}.ce-bar-vertical`);
        if (groupEl) {
          LayoutManager._pendingOrient[bId] = 'vertical';
          const rect = groupEl.getBoundingClientRect();
          const otherBarH = (rect.width > 0 && rect.width < 100) ? Math.round(rect.width) : 32;
          const bp = { ...newLayout.panels[bId] };
          delete bp.minimumHeight; delete bp.maximumHeight;
          bp.minimumWidth = otherBarH; bp.maximumWidth = otherBarH;
          newLayout.panels[bId] = bp;
        }
      }
      LayoutManager._restoringLayout = true;
      dockApi.fromJSON(newLayout);
      LayoutManager._restoringLayout = false;
      setTimeout(() => this._cleanupEmptyGroups(), 100);
    } catch (err) {
      LayoutManager._restoringLayout = false;
      console.warn('[Cyco] _dockPanelAtVpEdge error:', err);
      this._expectedOrientation = null;
      this._floating = true; this._floatSnapshot = prevSnapshot;
    }
  }

  /**
   * Dock a content panel adjacent to another panel — like _dockAtPanelEdge but
   * splits the target area 50/50 instead of using a fixed bar height.
   */
  _dockPanelAtPanelEdge(zone, prevSnapshot) {
    const dockApi = LayoutManager.api;
    const panelId = this._panelApi.id;
    const BAR_IDS = ['menu-bar-panel', 'toolbar-panel', 'left-toolbar'];
    try {
      const json = dockApi.toJSON();
      const removePanel = (node) => {
        if (!node) return null;
        if (node.type === 'leaf') {
          const views = node.data?.views ?? [];
          return (views.includes(panelId) || views.length === 0) ? null : node;
        }
        const filtered = (node.data ?? []).map(removePanel).filter(Boolean);
        if (filtered.length === 0) return null;
        if (filtered.length === 1 && (node.data ?? []).length > 1) return { ...filtered[0], size: node.size };
        return { ...node, data: filtered };
      };
      const floating = (json.floatingGroups ?? []).filter(fg => !(fg.data?.views ?? []).includes(panelId));
      const cleanRoot = removePanel(json.grid?.root);

      const findLeaf = (node, targetId, depth = 0, parent = null, idx = 0) => {
        if (!node) return null;
        if (node.type === 'leaf') return (node.data?.views ?? []).includes(targetId) ? { leaf: node, depth, parent, idx } : null;
        for (let i = 0; i < (node.data ?? []).length; i++) {
          const hit = findLeaf(node.data[i], targetId, depth + 1, node, i);
          if (hit) return hit;
        }
        return null;
      };
      const replaceDeep = (node, target, replacement) => {
        if (node === target) return replacement;
        if (node?.type !== 'branch') return node;
        return { ...node, data: node.data.map(c => replaceDeep(c, target, replacement)) };
      };
      const insertInParent = (root, parentNode, childIndex, insertBefore, newItem) => {
        const walk = (node) => {
          if (node === parentNode) {
            const d = [...node.data];
            d.splice(insertBefore ? childIndex : childIndex + 1, 0, newItem);
            return { ...node, data: d };
          }
          if (node?.type !== 'branch') return node;
          return { ...node, data: node.data.map(walk) };
        };
        return walk(root);
      };

      const found = findLeaf(cleanRoot, zone.panelId);
      if (!found) throw new Error(`[Cyco] panel "${zone.panelId}" not found in grid`);
      const { leaf: targetLeaf, depth: targetDepth, parent, idx: idxInParent } = found;
      const parentIsH = ((targetDepth - 1) % 2 === 0);
      const insertBefore = (zone.direction === 'left' || zone.direction === 'top');
      const wantColumns  = (zone.direction === 'left' || zone.direction === 'right');
      // Split the target's current size 50/50
      const half = Math.max(50, Math.round((targetLeaf.size ?? 200) / 2));
      const panelLeaf = { type: 'leaf', data: { id: `grp-${panelId}`, views: [panelId], activeView: panelId }, size: half };

      let newRoot;
      if (wantColumns) {
        if (parentIsH) {
          newRoot = insertInParent(cleanRoot, parent, idxInParent, insertBefore, panelLeaf);
        } else {
          const innerLeaf = { ...targetLeaf, size: Math.max(50, (targetLeaf.size ?? 200) - half) };
          const data = insertBefore ? [panelLeaf, innerLeaf] : [innerLeaf, panelLeaf];
          newRoot = replaceDeep(cleanRoot, targetLeaf, { type: 'branch', data, size: targetLeaf.size });
        }
      } else {
        if (!parentIsH) {
          newRoot = insertInParent(cleanRoot, parent, idxInParent, insertBefore, panelLeaf);
        } else {
          const innerLeaf = { ...targetLeaf, size: Math.max(50, (targetLeaf.size ?? 200) - half) };
          const data = insertBefore ? [panelLeaf, innerLeaf] : [innerLeaf, panelLeaf];
          newRoot = replaceDeep(cleanRoot, targetLeaf, { type: 'branch', data, size: targetLeaf.size });
        }
      }

      if (!newRoot) throw new Error('[Cyco] _dockPanelAtPanelEdge: failed to build new grid');
      const newLayout = { ...json, grid: { ...json.grid, root: newRoot }, floatingGroups: floating };
      if (newLayout.panels?.[panelId]) {
        const p = { ...newLayout.panels[panelId] };
        delete p.minimumWidth; delete p.maximumWidth; delete p.minimumHeight; delete p.maximumHeight;
        newLayout.panels[panelId] = p;
      }
      LayoutManager._pendingOrient = LayoutManager._pendingOrient ?? {};
      const _barGroupClassMap = { 'toolbar-panel': 'ce-toolbar-group', 'menu-bar-panel': 'ce-menu-bar-group', 'left-toolbar': 'ce-left-toolbar-group' };
      for (const bId of BAR_IDS) {
        if (!newLayout.panels?.[bId]) continue;
        const groupEl = document.querySelector(`.${_barGroupClassMap[bId]}.ce-bar-vertical`);
        if (groupEl) {
          LayoutManager._pendingOrient[bId] = 'vertical';
          const rect = groupEl.getBoundingClientRect();
          const otherBarH = (rect.width > 0 && rect.width < 100) ? Math.round(rect.width) : 32;
          const bp = { ...newLayout.panels[bId] };
          delete bp.minimumHeight; delete bp.maximumHeight;
          bp.minimumWidth = otherBarH; bp.maximumWidth = otherBarH;
          newLayout.panels[bId] = bp;
        }
      }
      LayoutManager._restoringLayout = true;
      dockApi.fromJSON(newLayout);
      LayoutManager._restoringLayout = false;
      setTimeout(() => this._cleanupEmptyGroups(), 100);
    } catch (err) {
      LayoutManager._restoringLayout = false;
      console.warn('[Cyco] _dockPanelAtPanelEdge error:', err);
      this._expectedOrientation = null;
      this._floating = true; this._floatSnapshot = prevSnapshot;
    }
  }

  // ── End non-bar panel drag-to-dock ─────────────────────────────────────────

  _toggleFloat(btn) {
    const dockApi = LayoutManager.api;
    if (!dockApi) return;

    if (!this._floating) {
      // Snapshot the docked layout so we can restore it on snap-back.
      this._floatSnapshot = dockApi.toJSON();
      this._floating = true;
      this._updateFloatBtn(btn);
      try {
        const panel = dockApi.getPanel(this._panelApi.id);
        if (!panel) {
          this._floating = false;
          this._floatSnapshot = null;
          this._updateFloatBtn(btn);
          return;
        }
        const { width, height } = this._floatDimensions;
        dockApi.addFloatingGroup(panel, {
          x: Math.max(0, Math.round((window.innerWidth - width) / 2)),
          y: Math.round(window.innerHeight * 0.4),
          width,
          height,
        });
        setTimeout(() => {
          this._fixFloatingSize();
          this._cleanupEmptyGroups();
        }, 50);
      } catch(e) {
        this._floating = false;
        this._floatSnapshot = null;
        this._updateFloatBtn(btn);
      }
    } else {
      // Snap back to the original docked position.
      const snapshot = this._floatSnapshot;
      this._floating = false;
      this._floatSnapshot = null;
      if (snapshot) {
        LayoutManager.snapBackFloating(snapshot, this._panelApi?.id);
      }
    }
  }
}
