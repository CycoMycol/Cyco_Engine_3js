/**
 * InputManager.js
 * Handles keyboard shortcuts for the editor viewport.
 * Reads keybindings from localStorage (set via PreferencesWindow).
 * Arrow key behaviour is context-sensitive: pan camera when nothing selected,
 * or nudge selected objects (wrapped in TransformCommand for undo).
 *
 * Depends on: CommandManager (injected), SelectionManager (injected), ViewportEngine (injected)
 *
 * Events consumed:
 *   cyco-preferences-change  {}  — re-read keybindings from localStorage
 *   cyco-vp-ready            {}  — viewport is live, safe to attach listeners
 *
 * Default keybindings (overridable via Preferences → Keyboard Shortcuts tab):
 *   Delete         → delete selected
 *   Ctrl+Z         → undo
 *   Ctrl+Y / Ctrl+Shift+Z → redo
 *   F              → focus selected (cyco-rvp-focus)
 *   Escape         → deselect
 *   Ctrl+D         → duplicate
 *   W              → translate mode
 *   E              → rotate mode
 *   R              → scale mode
 *   G              → toggle grid
 *   ` (backtick)   → toggle stats
 *   Arrow keys     → pan camera / nudge object
 */

const DEFAULT_BINDINGS = {
  deleteSelected:    'Delete',
  undo:              'ctrl+z',
  redo:              'ctrl+y',
  redoAlt:           'ctrl+shift+z',
  focus:             'f',
  deselect:          'Escape',
  duplicate:         'ctrl+d',
  translateMode:     'w',
  rotateMode:        'e',
  scaleMode:         'r',
  toggleGrid:        'g',
  toggleStats:       '`',
};

const STORAGE_KEY = 'cyco-keybindings';

export class InputManager {
  /**
   * @param {import('./CommandManager.js').CommandManager} commandManager
   * @param {import('./SelectionManager.js').SelectionManager} selectionManager
   * @param {import('./ViewportEngine.js').ViewportEngine} viewportEngine
   */
  constructor(commandManager, selectionManager, viewportEngine) {
    this.commandManager   = commandManager;
    this.selectionManager = selectionManager;
    this.engine           = viewportEngine;

    this._bindings = this._loadBindings();

    this._onKeyDown  = this._onKeyDown.bind(this);
    this._onPrefsChg = this._onPrefsChg.bind(this);

    document.addEventListener('keydown',              this._onKeyDown);
    window.addEventListener('cyco-preferences-change', this._onPrefsChg);
  }

  // ─── Keybindings ─────────────────────────────────────────────────────────

  _loadBindings() {
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
      return { ...DEFAULT_BINDINGS, ...stored };
    } catch {
      return { ...DEFAULT_BINDINGS };
    }
  }

  _onPrefsChg() {
    this._bindings = this._loadBindings();
  }

  // ─── Key event handler ───────────────────────────────────────────────────

  _onKeyDown(event) {
    // Don't intercept shortcuts when typing in inputs, textareas, etc.
    const tag = document.activeElement?.tagName ?? '';
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;

    const key    = this._keyString(event);
    const b      = this._bindings;
    const sel    = this.selectionManager;

    // ── Multi-key actions ──────────────────────────────────────────────
    if (key === b.undo)      { event.preventDefault(); this.commandManager.undo(); return; }
    if (key === b.redo || key === b.redoAlt) { event.preventDefault(); this.commandManager.redo(); return; }
    if (key === b.duplicate) { event.preventDefault(); this._duplicateSelected(); return; }

    // ── Single-key actions ─────────────────────────────────────────────
    switch (key) {
      case b.deleteSelected:
        event.preventDefault();
        this._deleteSelected();
        break;
      case b.focus:
        this._focusSelected();
        break;
      case b.deselect:
        sel.clearSelection();
        break;
      case b.translateMode:
        window.dispatchEvent(new CustomEvent('cyco-vp-tool', { detail: { mode: 'translate' } }));
        break;
      case b.rotateMode:
        window.dispatchEvent(new CustomEvent('cyco-vp-tool', { detail: { mode: 'rotate' } }));
        break;
      case b.scaleMode:
        window.dispatchEvent(new CustomEvent('cyco-vp-tool', { detail: { mode: 'scale' } }));
        break;
      case b.toggleGrid:
        window.dispatchEvent(new CustomEvent('cyco-vp-toggle-grid'));
        break;
      case b.toggleStats:
        window.dispatchEvent(new CustomEvent('cyco-rvp-stats-toggle'));
        break;
      // Arrow keys — handled separately
      case 'ArrowUp':
      case 'ArrowDown':
      case 'ArrowLeft':
      case 'ArrowRight':
        this._handleArrow(key, event);
        break;
    }
  }

  // ─── Actions ─────────────────────────────────────────────────────────────

  _deleteSelected() {
    const { selected } = this.selectionManager;
    if (!selected.size) return;
    for (const obj of [...selected]) {
      const id = obj.userData.cycoId;
      if (!id) continue;
      // Wrap in a command for undo support (CommandManager will be available)
      this.commandManager.execute({
        name: `Delete ${obj.name || id}`,
        _obj: obj, _parent: obj.parent, _idx: obj.parent?.children.indexOf(obj) ?? 0,
        do()   { window.dispatchEvent(new CustomEvent('cyco-hierarchy-remove-obj', { detail: { cycoId: this._obj.userData.cycoId } })); },
        undo() { window.dispatchEvent(new CustomEvent('cyco-hierarchy-restore-obj', { detail: { object: this._obj, parent: this._parent, index: this._idx } })); },
      });
    }
    this.selectionManager.clearSelection();
  }

  _focusSelected() {
    const { selected } = this.selectionManager;
    if (!selected.size) return;
    const obj = [...selected][selected.size - 1];
    window.dispatchEvent(new CustomEvent('cyco-rvp-focus', { detail: { object: obj } }));
  }

  _duplicateSelected() {
    const { selected } = this.selectionManager;
    if (!selected.size) return;
    for (const obj of [...selected]) {
      this.commandManager.execute({
        name: `Duplicate ${obj.name || obj.userData.cycoId}`,
        _source: obj, _clone: null,
        do() {
          window.dispatchEvent(new CustomEvent('cyco-duplicate-object', { detail: { source: this._source } }));
        },
        undo() {
          if (this._clone?.userData?.cycoId) {
            window.dispatchEvent(new CustomEvent('cyco-hierarchy-remove-obj', {
              detail: { cycoId: this._clone.userData.cycoId }
            }));
          }
        },
      });
    }
  }

  // ─── Arrow keys ───────────────────────────────────────────────────────────

  _handleArrow(key, event) {
    event.preventDefault();
    const controls = this.engine.controls;
    const selected = this.selectionManager.selected;
    const snap     = this._getSnapValue();
    const step     = snap > 0 ? snap : 0.1;
    const mult     = event.shiftKey ? 10 : 1;
    const move     = step * mult;

    if (selected.size === 0) {
      // Pan camera target
      if (!controls) return;
      switch (key) {
        case 'ArrowRight': controls.target.x += move; break;
        case 'ArrowLeft':  controls.target.x -= move; break;
        case 'ArrowUp':    controls.target.z -= move; break;
        case 'ArrowDown':  controls.target.z += move; break;
      }
      controls.update();
    } else {
      // Nudge selected objects
      for (const obj of selected) {
        const before = obj.position.clone();
        switch (key) {
          case 'ArrowRight': obj.position.x += move; break;
          case 'ArrowLeft':  obj.position.x -= move; break;
          case 'ArrowUp':    obj.position.z -= move; break;
          case 'ArrowDown':  obj.position.z += move; break;
        }
        const after = obj.position.clone();
        // Wrap in TransformCommand — after the nudge so we don't need TWO objects
        this.commandManager.execute({
          name: `Nudge ${obj.name}`,
          _obj: obj, _before: before, _after: after,
          do()   { this._obj.position.copy(this._after); },
          undo() { this._obj.position.copy(this._before); },
        });
      }
    }
  }

  _getSnapValue() {
    try {
      const prefs = JSON.parse(localStorage.getItem('cyco-prefs') ?? '{}');
      return prefs.snapValue ?? 0;
    } catch { return 0; }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /** Convert a KeyboardEvent to a normalised string like 'ctrl+z' or 'Delete'. */
  _keyString(event) {
    const parts = [];
    if (event.ctrlKey || event.metaKey) parts.push('ctrl');
    if (event.shiftKey) parts.push('shift');
    if (event.altKey)   parts.push('alt');
    parts.push(event.key.length === 1 ? event.key.toLowerCase() : event.key);
    return parts.join('+');
  }

  // ─── Disposal ─────────────────────────────────────────────────────────────

  dispose() {
    document.removeEventListener('keydown',               this._onKeyDown);
    window.removeEventListener('cyco-preferences-change', this._onPrefsChg);
  }
}
