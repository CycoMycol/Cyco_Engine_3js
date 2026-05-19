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
};

const ALL_IDS = ['scene-hierarchy', 'center-viewport', 'properties', 'assets-browser'];
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

  /** Call once after createDockview() returns the api. */
  init(api) {
    this.api = api;

    // All panels start visible
    ALL_IDS.forEach(id => { this._visibility[id] = true; });

    // Capture default layout synchronously so resetToDefault() always works
    try { this._defaultLayout = api.toJSON(); } catch(_) {}

    // Re-sync on any layout change (drag, resize, tab close)
    api.onDidLayoutChange(() => {
      if (this._restoringLayout) return;
      this._resyncVisibility();
      this._scheduleAutoSave();
      document.dispatchEvent(new CustomEvent('cyco-layout-change'));
    });
  },

  /**
   * Restore the last auto-saved layout from localStorage.
   * Call this after init() to resume the user's previous session.
   */
  restoreAutoSaved() {
    if (!this.api) return;
    const raw = localStorage.getItem(AUTO_SAVE_KEY);
    if (!raw) return;
    // If the saved layout pre-dates dockable menu/toolbar panels, discard it so
    // the fresh default layout (with those panels) is used instead.
    if (!raw.includes('"menu-bar-panel"') || !raw.includes('"toolbar-panel"')) {
      console.info('[Cyco] Saved layout is from an older version; resetting to default layout.');
      localStorage.removeItem(AUTO_SAVE_KEY);
      return;
    }
    // Validate that bar panels are present in the layout.
    // (Old layouts pre-dating dockable bars are already caught above.)
    try {
      const data = JSON.parse(raw);
      const layoutStr = JSON.stringify((data.layout ?? data)?.grid ?? {});
      const barsPresent =
        layoutStr.includes('"menu-bar-panel"') &&
        layoutStr.includes('"toolbar-panel"');
      if (!barsPresent) {
        console.info('[Cyco] Saved layout is missing bar panels; resetting.');
        localStorage.removeItem(AUTO_SAVE_KEY);
        return;
      }
    } catch (_) { /* if parse fails we'll try again below and catch there */ }
    try {
      const data = JSON.parse(raw);
      // Support both legacy plain-layout JSON and new { layout, snapshots } format
      const layout    = data.layout    ?? data;
      const snapshots = data.snapshots ?? {};
      this._restoringLayout = true;
      this.api.fromJSON(layout);
      this._snapshots = snapshots;
      this._resyncVisibility();
      this._restoringLayout = false;
      document.dispatchEvent(new CustomEvent('cyco-layout-change'));
    } catch(e) {
      this._restoringLayout = false;
      console.warn('restoreAutoSaved error:', e);
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
      // Width-only constraints → vertical column; height-only → horizontal row.
      this._pendingOrient = this._pendingOrient ?? {};
      for (const barId of ['toolbar-panel', 'menu-bar-panel']) {
        const p = snapshot.panels?.[barId];
        if (!p) continue;
        if (p.minimumWidth != null || p.maximumWidth != null) {
          this._pendingOrient[barId] = 'vertical';
        } else if (p.minimumHeight != null || p.maximumHeight != null) {
          this._pendingOrient[barId] = 'horizontal';
        }
      }

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
      localStorage.setItem(AUTO_SAVE_KEY, JSON.stringify({
        layout:    this.api.toJSON(),
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

