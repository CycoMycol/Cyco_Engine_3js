/**
 * layout-manager.js — owns all layout state, wraps DockviewApi.
 * Singleton. Call LayoutManager.init(api) once after createDockview().
 *
 * Panel visibility is implemented by closing (removing) a panel and
 * re-adding it, because dockview has no native show/hide API.
 *
 * Panel sizes are preserved by snapshotting the full layout via api.toJSON()
 * before hiding, and restoring via api.fromJSON() when showing back.
 *
 * The current layout and snapshots are auto-saved to localStorage so the
 * user's arrangement persists across page refreshes.
 */

// Fallback configs used only when no snapshot exists for a panel.
const PANEL_CONFIGS = {
  'center-viewport': {
    id: 'center-viewport', component: 'CenterPanel', title: 'Viewport',
  },
  'scene-hierarchy': {
    id: 'scene-hierarchy', component: 'LeftPanel', title: 'Hierarchy',
    position: { direction: 'left', referencePanel: 'center-viewport' },
    initialWidth: 260,
  },
  'properties': {
    id: 'properties', component: 'RightPanel', title: 'Properties',
    position: { direction: 'right', referencePanel: 'center-viewport' },
    initialWidth: 280,
  },
  'assets-browser': {
    id: 'assets-browser', component: 'BottomPanel', title: 'Assets Browser',
    position: { direction: 'below', referencePanel: 'center-viewport' },
    initialHeight: 220,
  },
  'material-browser': {
    id: 'material-browser', component: 'MaterialBrowserPanel', title: 'Materials',
    position: { direction: 'within', referencePanel: 'assets-browser' },
  },
};

const ALL_IDS = ['scene-hierarchy', 'center-viewport', 'properties', 'assets-browser', 'material-browser'];
const AUTO_SAVE_KEY = 'cyco-layout-current';

const LayoutManager = {
  api: null,
  _defaultLayout: null,
  _visibility: {},
  /** Full layout JSON snapshots taken just before each panel was hidden. */
  _snapshots: {},
  /** True while we are in the middle of a restore — suppresses side effects. */
  _restoringLayout: false,
  _autoSaveTimer: null,

  /**
   * Call once after createDockview() returns the api.
   * @param {object} api          - DockviewApi instance.
   * @param {object} defaultLayout - DEFAULT_LAYOUT JSON (imported from layout.js).
   *   Stored so resetToDefault() can restore it.  The api.fromJSON(DEFAULT_LAYOUT)
   *   call in initLayout() has already applied it, so we capture the scaled result
   *   via api.toJSON() as the true default (sized to the current container).
   */
  init(api, defaultLayout) {
    this.api = api;

    // All panels start visible
    ALL_IDS.forEach(id => { this._visibility[id] = true; });

    // Capture the container-scaled default layout so resetToDefault() works
    // correctly regardless of window size.
    try { this._defaultLayout = api.toJSON(); } catch(_) {}
    if (!this._defaultLayout && defaultLayout) this._defaultLayout = defaultLayout;

    // Re-sync on any layout change (panel add/remove/move)
    api.onDidLayoutChange(() => {
      if (this._restoringLayout) return;
      this._resyncVisibility();
      this._scheduleAutoSave();
      document.dispatchEvent(new CustomEvent('cyco-layout-change'));
    });

    // Save immediately when the page is refreshed or closed so panel sizes
    // (set by sash/divider drags) are always captured at the last moment.
    window.addEventListener('beforeunload', () => {
      if (!this._restoringLayout) this._doAutoSave();
    });

    // Dockview does NOT fire onDidLayoutChange for sash/divider drags.
    // Listen for pointerup on the dockview container so any completed sash
    // drag schedules an auto-save (debounced 300 ms).
    api.element?.addEventListener('pointerup', () => {
      if (!this._restoringLayout) this._scheduleAutoSave();
    });
  },

  /**
   * Set _pendingOrient hints for bar panels from a layout's panel definitions.
   * Must be called before api.fromJSON(layout) so that LeftToolbarPanel.init()
   * reads the correct expected orientation.
   * @param {object} layout - dockview layout JSON (has a .panels map).
   */
  _setPendingOrientFromLayout(layout) {
    this._pendingOrient = this._pendingOrient ?? {};
    for (const barId of ['toolbar-panel', 'menu-bar-panel', 'left-toolbar', 'right-viewport']) {
      const p = layout.panels?.[barId];
      if (!p) continue;
      if (p.minimumWidth != null || p.maximumWidth != null) {
        this._pendingOrient[barId] = 'vertical';
      } else if (p.minimumHeight != null || p.maximumHeight != null) {
        this._pendingOrient[barId] = 'horizontal';
      }
    }
  },

  /**
   * Walk a saved Dockview grid tree and push exact sizes to every panel group
   * using groupApi.setSize().  Called ~150 ms after api.fromJSON() to correct
   * the layout, because fromJSON temporarily collapses the container to the CSS
   * min-width (~100 px) while rebuilding panels, which causes Dockview to
   * normalise all sizes against that collapsed width instead of the true width.
   *
   * Orientation rule (Dockview convention):
   *   A branch's children are laid out along the PERPENDICULAR axis:
   *     HORIZONTAL branch → children are side-by-side → child .size = WIDTH
   *     VERTICAL   branch → children are stacked      → child .size = HEIGHT
   *
   * @param {object} node        - a node from layout.grid.root
   * @param {string} parentOrient - 'HORIZONTAL' | 'VERTICAL' — the orientation
   *   of this node's parent branch, which determines what .size means for this node.
   *   Pass 'VERTICAL' for the root node (root is always HORIZONTAL, meaning its
   *   own .size is the container height — we don't need to set that).
   */
  _applyGridSizes(node, parentOrient) {
    if (!node) return;
    if (node.type === 'leaf') {
      const panelId = node.data?.views?.[0];
      if (!panelId) return;
      const panel = this.api.getPanel(panelId);
      const groupApi = panel?.api?.group?.api;
      if (!groupApi) return;
      if (parentOrient === 'HORIZONTAL') {
        groupApi.setSize({ width: node.size });
      } else {
        groupApi.setSize({ height: node.size });
      }
    } else if (node.type === 'branch') {
      // A branch's own orientation is perpendicular to the parent orientation.
      // Its children's sizes are interpreted relative to the branch's own axis.
      const ownOrient = parentOrient === 'HORIZONTAL' ? 'VERTICAL' : 'HORIZONTAL';
      for (const child of (node.data ?? [])) {
        this._applyGridSizes(child, ownOrient);
      }
    }
  },

  /**
   * Restore the last auto-saved layout from localStorage, or apply the default
   * layout if no save exists.  This is the ONE AND ONLY place that calls
   * api.fromJSON() during startup, preventing the double-fromJSON size bug.
   * Call this after init().
   */
  restoreAutoSaved() {
    if (!this.api) return;
    const raw = localStorage.getItem(AUTO_SAVE_KEY);

    // No saved layout — apply the default.
    if (!raw) {
      if (this._defaultLayout) {
        this._setPendingOrientFromLayout(this._defaultLayout);
        this._restoringLayout = true;
        this.api.fromJSON(this._defaultLayout);
        this._restoringLayout = false;
      }
      return;
    }

    // If the saved layout pre-dates dockable menu/toolbar panels OR is missing the
    // right-viewport panel, discard it so the fresh default layout is used instead.
    if (!raw.includes('"menu-bar-panel"') || !raw.includes('"toolbar-panel"') || !raw.includes('"left-toolbar"') || !raw.includes('"right-viewport"')) {
      console.info('[Cyco] Saved layout is from an older version; resetting to default layout.');
      localStorage.removeItem(AUTO_SAVE_KEY);
      if (this._defaultLayout) {
        this._setPendingOrientFromLayout(this._defaultLayout);
        this._restoringLayout = true;
        this.api.fromJSON(this._defaultLayout);
        this._restoringLayout = false;
      }
      return;
    }
    // Validate that bar panels are present AND their sizes are sane.
    // A corrupted layout (e.g. from a mis-collapsed grid tree) shows menu-bar-panel
    // with a huge size (e.g. 779) instead of ~30px.  Reject it.
    try {
      const data = JSON.parse(raw);
      const layout = data.layout ?? data;
      const layoutStr = JSON.stringify(layout?.grid ?? {});
      const barsPresent =
        layoutStr.includes('"menu-bar-panel"') &&
        layoutStr.includes('"toolbar-panel"') &&
        layoutStr.includes('"left-toolbar"') &&
        layoutStr.includes('"right-viewport"');
      if (!barsPresent || !this._isLayoutSane(layout)) {
        console.info('[Cyco] Saved layout is invalid or corrupted; resetting to default.');
        localStorage.removeItem(AUTO_SAVE_KEY);
        if (this._defaultLayout) {
          this._setPendingOrientFromLayout(this._defaultLayout);
          this._restoringLayout = true;
          this.api.fromJSON(this._defaultLayout);
          this._restoringLayout = false;
        }
        return;
      }
    } catch (_) { /* if parse fails we'll try again below and catch there */ }
    try {
      const data = JSON.parse(raw);
      // Support both legacy plain-layout JSON and new { layout, snapshots } format
      const layout    = data.layout    ?? data;
      const snapshots = data.snapshots ?? {};
      // Strip on-demand panels (camera-view etc.) so they are never auto-restored
      // into the grid from an old or floating save.
      this._stripTransientPanels(layout);
      // Set orientation hints so bar panel init() applies correct constraints during fromJSON.
      this._setPendingOrientFromLayout(layout);
      this._restoringLayout = true;
      this.api.fromJSON(layout);
      this._snapshots = snapshots;
      this._resyncVisibility();
      document.dispatchEvent(new CustomEvent('cyco-layout-change'));

      // Dockview's fromJSON can produce wrong panel sizes because the dv-shell
      // temporarily collapses (to CSS min-width ~100 px) while panels are being
      // reconstructed.  Dockview uses that collapsed width as its normalisation
      // reference, so sizes end up proportionally wrong after the DOM reflows.
      //
      // Fix: after Dockview's ResizeObserver has fired (~16 ms) and the first
      // reflow is complete (~150 ms), walk the saved grid tree and push exact
      // sizes to each panel group via setSize().  Keep _restoringLayout=true
      // throughout so none of these intermediate changes trigger an auto-save.
      const _savedRoot = layout.grid?.root;
      setTimeout(() => {
        try { this._applyGridSizes(_savedRoot, 'HORIZONTAL'); } catch(e) {
          console.warn('[Cyco] restoreAutoSaved: size re-apply failed', e);
        }
        setTimeout(() => {
          this._restoringLayout = false;
        }, 200);
      }, 150);


    } catch(e) {
      this._restoringLayout = false;
      console.warn('restoreAutoSaved error:', e);
      // Fall back to default layout
      if (this._defaultLayout) {
        try {
          this._setPendingOrientFromLayout(this._defaultLayout);
          this._restoringLayout = true;
          this.api.fromJSON(this._defaultLayout);
          this._restoringLayout = false;
        } catch(_) { this._restoringLayout = false; }
      }
    }
  },

  /** Toggle a panel between shown and hidden. */
  togglePanel(id) {
    if (!this.api) return;
    const visible = this._visibility[id] ?? true;
    if (visible) {
      this._hidePanel(id);
    } else {
      this._showPanel(id);
    }
    document.dispatchEvent(new CustomEvent('cyco-layout-change'));
  },

  /** Returns true if the panel is currently in the layout. */
  isPanelVisible(id) {
    return this._visibility[id] ?? true;
  },

  /**
   * Restore a layout snapshot taken just before a panel was floated,
   * snapping it back to its original docked position.
   * Re-closes any panels that were hidden at the time of snap-back.
   * @param {object} snapshot  - JSON snapshot from api.toJSON()
   * @param {string} [panelId] - ID of the panel being snapped back; excluded
   *                             from re-hiding because getPanel() returns
   *                             undefined for floating panels which would
   *                             incorrectly mark it hidden in _visibility.
   */
  snapBackFloating(snapshot, panelId) {
    if (!this.api || !snapshot) return;
    try {
      // Compute which panels to re-hide BEFORE fromJSON (uses current
      // _visibility). Exclude panelId — it appears invisible only because
      // dockview's getPanel() doesn't find floating panels.
      const toReHide = ALL_IDS.filter(id => id !== panelId && !this._visibility[id]);

      // Detect bar orientations from snapshot panel JSON so BasePanel.init()
      // can apply the correct constraints (vertical vs horizontal).
      this._setPendingOrientFromLayout(snapshot);

      this._restoringLayout = true;
      this.api.fromJSON(snapshot);

      toReHide.forEach(id => {
        try {
          const p = this.api.getPanel(id);
          if (p) p.api.close();
        } catch(_) {}
      });

      this._resyncVisibility();
      this._restoringLayout = false;
      this._scheduleAutoSave();
      document.dispatchEvent(new CustomEvent('cyco-layout-change'));
    } catch(e) {
      this._restoringLayout = false;
      console.warn('snapBackFloating error:', e);
    }
  },

  // ── private ──────────────────────────────────────────────────────────────

  // Maps each side panel to the ID of the opposing side panel.
  _OPPOSITE: {
    'scene-hierarchy': 'properties',
    'properties':      'scene-hierarchy',
  },

  _hidePanel(id) {
    try {
      if (!this.api.getPanel(id)) return;

      // Save the full current layout so _showPanel can restore it exactly.
      this._snapshots[id] = this.api.toJSON();

      // Build a modified snapshot that has this panel removed with its freed
      // width given only to the center column — not the opposite side panel.
      const hideSnapshot = this._buildHideSnapshot(id);

      this._restoringLayout = true;

      if (hideSnapshot) {
        this.api.fromJSON(hideSnapshot);
      } else {
        // Fallback when snapshot manipulation is not possible
        this.api.getPanel(id).api.close();
      }

      this._resyncVisibility();
      this._restoringLayout = false;
      this._scheduleAutoSave();
    } catch(e) {
      this._restoringLayout = false;
      console.warn('_hidePanel error:', e);
    }
  },

  /**
   * Returns a deep-cloned dockview JSON layout with panel `id` removed and
   * its freed column width redistributed to the center column only, so the
   * opposite side panel stays at its current width.
   *
   * Dockview grid JSON structure (HORIZONTAL root):
   *   root.data = [ ...columnNodes ]  each node has  { type, data, size }
   *   size = pixel width for top-level column nodes.
   */
  _buildHideSnapshot(id) {
    try {
      const snapshot = this.api.toJSON();
      const root = snapshot?.grid?.root;
      if (!root || root.type !== 'branch' || !Array.isArray(root.data)) return null;

      // Find the leaf that corresponds to the panel being hidden.
      const leafIdx = root.data.findIndex(node =>
        node.type === 'leaf' &&
        node.data?.views &&
        node.data.views.includes(id)
      );
      if (leafIdx === -1) return null;

      const freedWidth = root.data[leafIdx].size;
      const oppositeId = this._OPPOSITE[id];

      // Find the center column: the node that is neither the panel being hidden
      // nor the opposite side panel. It may be a branch (center+bottom) or a leaf.
      const centerIdx = root.data.findIndex((node, i) => {
        if (i === leafIdx) return false;
        if (node.type === 'leaf' && node.data?.views) {
          if (oppositeId && node.data.views.includes(oppositeId)) return false;
          if (node.data.views.includes(id)) return false;
        }
        return true;
      });
      if (centerIdx === -1) return null;

      // Deep-clone then apply edits.
      const modified = JSON.parse(JSON.stringify(snapshot));

      // Give the freed column width entirely to the center column.
      modified.grid.root.data[centerIdx].size += freedWidth;

      // Remove the hidden panel's column from the grid.
      modified.grid.root.data.splice(leafIdx, 1);

      // Remove from the panels map so fromJSON doesn't recreate it.
      if (modified.panels?.[id]) delete modified.panels[id];

      // Clear activePanel if it was the panel being hidden.
      if (modified.activePanel === id) delete modified.activePanel;

      return modified;
    } catch(e) {
      console.warn('_buildHideSnapshot error:', e);
      return null;
    }
  },

  _showPanel(id) {
    try {
      if (this.api.getPanel(id)) return; // already present

      const snapshot = this._snapshots[id];
      this._restoringLayout = true;

      if (snapshot) {
        // Restore the full layout from the snapshot taken before this panel was
        // hidden. This brings it back at the exact size and position the user set.
        this.api.fromJSON(snapshot);

        // Re-hide any panels that were hidden after this snapshot was taken
        // (i.e. panels whose _visibility is still false, other than `id` itself).
        const toReHide = ALL_IDS.filter(x => x !== id && !this._visibility[x]);
        toReHide.forEach(x => {
          try {
            const p = this.api.getPanel(x);
            if (p) p.api.close();
          } catch(_) {}
        });
      } else {
        // Fallback: no snapshot — add with default dimensions
        const cfg = { ...PANEL_CONFIGS[id] };
        if (cfg.position?.referencePanel && !this.api.getPanel(cfg.position.referencePanel)) {
          delete cfg.position;
        }
        this.api.addPanel(cfg);
      }

      this._visibility[id] = true;
      this._restoringLayout = false;
      this._scheduleAutoSave();
    } catch(e) {
      this._restoringLayout = false;
      console.warn('_showPanel error:', e);
    }
  },

  /** Sync internal state by checking which panels are actually in the layout. */
  _resyncVisibility() {
    if (!this.api) return;
    ALL_IDS.forEach(id => {
      this._visibility[id] = !!this.api.getPanel(id);
    });
  },

  /**
   * Remove on-demand (transient) panels from a layout snapshot before restoring.
   * Panels like camera-view are opened on-demand; they should not be re-added
   * automatically on reload — especially since an old save may have stored them
   * in the grid (top-left) rather than floating.
   */
  _stripTransientPanels(layout) {
    const TRANSIENT = new Set(['camera-view', 'stats-panel']);
    if (!layout) return layout;

    // Early exit: if no transient panels exist in this layout, don't touch the grid tree.
    const hasTransient = [...TRANSIENT].some(id => layout.panels?.[id]);
    if (!hasTransient) return layout;

    // Remove from panels map
    for (const id of TRANSIENT) delete layout.panels?.[id];

    // Remove from floatingGroups
    if (Array.isArray(layout.floatingGroups)) {
      layout.floatingGroups = layout.floatingGroups.filter(fg => {
        const views = fg?.data?.views ?? [];
        return !views.some(v => TRANSIENT.has(v));
      });
      if (!layout.floatingGroups.length) delete layout.floatingGroups;
    }

    // Remove from grid tree (handles the case where the user docked it)
    if (layout.grid?.root) {
      layout.grid.root = this._stripGridNode(layout.grid.root, TRANSIENT);
    }

    return layout;
  },

  _stripGridNode(node, transient) {
    if (!node) return null;
    if (node.type === 'leaf') {
      const views = (node.data?.views ?? []).filter(v => !transient.has(v));
      if (!views.length) return null;
      const activeView = transient.has(node.data?.activeView) ? views[0] : node.data?.activeView;
      return { ...node, data: { ...node.data, views, activeView } };
    }
    if (node.type === 'branch') {
      const origLen = (node.data ?? []).length;
      const data = (node.data ?? []).map(c => this._stripGridNode(c, transient)).filter(Boolean);
      if (!data.length) return null;
      // Only collapse to the child if something was actually removed from a multi-child branch.
      // NEVER collapse if the branch already had 1 child — dockview uses a single-child root
      // wrapper by design, and collapsing it destroys the entire grid structure.
      if (data.length === 1 && origLen > 1) return data[0];
      return { ...node, data };
    }
    return node;
  },

  /**
   * Returns true if the layout looks structurally sane.
   * Rejects layouts where the menu-bar or toolbar have nonsensical sizes
   * (a sign that the grid tree was collapsed or corrupted).
   */
  _isLayoutSane(layout) {
    try {
      // Find the leaf size for a given panel ID by walking the grid tree.
      const findLeafSize = (node, id) => {
        if (!node) return null;
        if (node.type === 'leaf') {
          return (node.data?.views ?? []).includes(id) ? node.size : null;
        }
        for (const child of (node.data ?? [])) {
          const found = findLeafSize(child, id);
          if (found !== null) return found;
        }
        return null;
      };
      const root = layout?.grid?.root;
      const menuSize = findLeafSize(root, 'menu-bar-panel');
      const toolbarSize = findLeafSize(root, 'toolbar-panel');
      // menu-bar should be ~30px, toolbar ~32px — reject if wildly wrong
      if (menuSize !== null && (menuSize > 80 || menuSize < 10)) return false;
      if (toolbarSize !== null && (toolbarSize > 80 || toolbarSize < 10)) return false;
      // Reject if center-viewport is merged into a group with other content panels
      // (all panels sharing size=100 is dockview's "container was 0" artifact)
      const centerSize = findLeafSize(root, 'center-viewport');
      if (centerSize !== null && centerSize <= 100) {
        const menuSize2 = findLeafSize(root, 'menu-bar-panel');
        // If menu-bar is also 100, everything is 100 → corrupted
        if (menuSize2 !== null && menuSize2 <= 100) return false;
      }
      return true;
    } catch(_) { return true; } // be permissive if we can't tell
  },

  _scheduleAutoSave() {
    if (this._autoSaveTimer) clearTimeout(this._autoSaveTimer);
    this._autoSaveTimer = setTimeout(() => {
      this._autoSaveTimer = null;
      this._doAutoSave();
    }, 300);
  },

  _doAutoSave() {
    if (!this.api) return;
    try {
      const layout = this.api.toJSON();
      localStorage.setItem(AUTO_SAVE_KEY, JSON.stringify({
        layout,
        snapshots: this._snapshots,
      }));
    } catch(e) { console.warn('_doAutoSave error:', e); }
  },

  // ── named layout persistence ──────────────────────────────────────────────

  saveLayout(name) {
    if (!this.api) return;
    try {
      const layouts = this._loadLayouts();
      layouts[name] = this.api.toJSON();
      localStorage.setItem('cyco-layouts', JSON.stringify(layouts));
    } catch(e) { console.warn('saveLayout error:', e); }
  },

  loadLayout(name) {
    if (!this.api) return;
    try {
      const layouts = this._loadLayouts();
      if (!layouts[name]) return;
      this._setPendingOrientFromLayout(layouts[name]);
      this._restoringLayout = true;
      this.api.fromJSON(layouts[name]);
      this._snapshots = {};
      this._resyncVisibility();
      this._restoringLayout = false;
      document.dispatchEvent(new CustomEvent('cyco-layout-change'));
    } catch(e) {
      this._restoringLayout = false;
      console.warn('loadLayout error:', e);
    }
  },

  listSavedLayouts() {
    return Object.keys(this._loadLayouts());
  },

  resetToDefault() {
    if (!this.api || !this._defaultLayout) return;
    try {
      this._setPendingOrientFromLayout(this._defaultLayout);
      this._restoringLayout = true;
      this.api.fromJSON(this._defaultLayout);
      ALL_IDS.forEach(id => { this._visibility[id] = true; });
      this._snapshots = {};
      this._restoringLayout = false;
      localStorage.removeItem(AUTO_SAVE_KEY);
      document.dispatchEvent(new CustomEvent('cyco-layout-change'));
    } catch(e) {
      this._restoringLayout = false;
      console.warn('resetToDefault error:', e);
    }
  },

  _loadLayouts() {
    try { return JSON.parse(localStorage.getItem('cyco-layouts') || '{}'); }
    catch { return {}; }
  },
};

export default LayoutManager;

