/**
 * ModelerSettings.js
 *
 * Independent settings store for the Cyco Modeler. Deliberately does NOT
 * read or write the global editor preferences (PreferencesPanel /
 * localStorage `cyco-prefs`). The modeler has its own visual language and
 * its own defaults so it never inherits engine-wide changes and the engine
 * never inherits modeler changes.
 *
 * Two layers of defaults:
 *   - MODELER_SETTINGS_DEFAULTS : factory defaults, frozen, never change.
 *   - _userDefaults (localStorage) : what the user set with "Make Default".
 *     These override the factory defaults but never the project file.
 *
 * Precedence (highest to lowest):
 *   1. project file snapshot    (openById calls loadInto(snapshot))
 *   2. user permanent defaults  (Make Default writes these)
 *   3. MODELER_SETTINGS_DEFAULTS
 *
 * Persistence:
 *   - project file  : via ProjectManager (per-project)
 *   - user defaults : localStorage 'cyco-modeler-defaults' (across reloads,
 *                     across projects). NOT the engine 'cyco-prefs' key.
 *
 * Four categories:
 *   - selectionGizmo : unselected primitive outline (purple/white box look)
 *                      with real screen-space thickness via Line2.
 *   - wireframe      : wireframe thickness + color on selected objects.
 *                      Thickness is a real screen-pixel value via Line2.
 *   - polygonHighlight : hover/selected FACE highlight color + opacity.
 *   - edgeHighlight  : hover/selected EDGE highlight color + opacity.
 *   - vertexHighlight: hover/selected VERTEX highlight color + size + opacity.
 *
 * Thickness / width sliders render via Line2 (LineSegments2 + LineMaterial)
 * so changes are visibly real — WebGL ignores LineBasicMaterial.linewidth.
 */

import * as THREE from 'three';

export const MODELER_SETTINGS_DEFAULTS = Object.freeze({
  selectionGizmo: {
    // Unselected primitive in the modeler — defaults match the
    // "purple + white" look the user asked us to replicate.
    enabled:      true,
    outlineColor: '#9a64ff', // purple outer
    outlineWidth: 2,         // screen-pixel thickness (Line2.linewidth)
    glowColor:    '#ffffff', // white inner
    glowWidth:    1,         // screen-pixel thickness (Line2.linewidth)
    glowOpacity:  0.75,
  },
  wireframe: {
    // Selected object — wireframe LineSegments2 around the mesh.
    // Color stays black so it reads cleanly against the light mesh in
    // Solid+Wire / Solid mode and against the rendered mesh preview
    // in Wire-Only mode (the mesh stays visible as a backdrop).
    // Wire-Only mode flips the wire color to white automatically
    // (see CycleModelerController._syncWireOverlay) so it remains
    // legible against the dark scene background when the mesh is
    // hidden.
    enabled:   true,
    color:     '#000000',
    thickness: 2,            // screen-pixel thickness (Line2.linewidth), 1..15
    opacity:   1.0,
  },
  polygonHighlight: {
    // Hover/selected FACE highlight (red by default).
    enabled: true,
    color:   '#ff3333',
    opacity: 0.9,
  },
  edgeHighlight: {
    // Hover/selected EDGE highlight — separate from face so the user
    // can colour edges differently from the filled polygon highlight.
    enabled:   true,
    color:     '#ffaa00',
    opacity:   0.95,
    // Screen-pixel thickness for the edge LineSegments2.  A 1-px line is
    // essentially invisible on a dark scene + WebGPU/TSL pipeline (LineMaterial
    // is wrapped as a ShaderMaterial that may antialias to sub-pixel),
    // so the factory default is 3 to keep edges clearly visible.  The
    // user can override this per-project or per-session from the settings
    // window's Edge Highlight tab.
    thickness: 3,
  },
  vertexHighlight: {
    // Hover/selected VERTEX highlight (size in screen pixels).
    enabled:   true,
    color:     '#33ddff',
    opacity:   0.95,
    vertexSize: 6,
  },
});

const USER_DEFAULTS_KEY = 'cyco-modeler-defaults';

function _deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function _deepMerge(base, override) {
  if (override == null || typeof override !== 'object') return _deepClone(base);
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const key of Object.keys(override)) {
    const v = override[key];
    if (v != null && typeof v === 'object' && !Array.isArray(v) && base[key] != null && typeof base[key] === 'object') {
      out[key] = _deepMerge(base[key], v);
    } else {
      out[key] = v;
    }
  }
  return out;
}

// ── User permanent defaults (Make Default) ─────────────────────────────────

/**
 * Read the user's "Make Default" overrides from localStorage. Returns
 * `null` if no overrides are stored. Safe to call before document.ready
 * (no DOM access).
 */
function _loadUserDefaults() {
  try {
    const raw = localStorage.getItem(USER_DEFAULTS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function _saveUserDefaults(snapshot) {
  try {
    localStorage.setItem(USER_DEFAULTS_KEY, JSON.stringify(snapshot));
  } catch (err) {
    console.warn('[ModelerSettings] could not persist user defaults:', err);
  }
}

function _clearUserDefaults() {
  try { localStorage.removeItem(USER_DEFAULTS_KEY); } catch {}
}

// ── Public singleton ────────────────────────────────────────────────────────

/**
 * Categories that existed in older builds and were renamed or removed.
 * Mapped to the closest current category so legacy saved settings keep
 * applying rather than silently disappearing after an upgrade.
 */
const LEGACY_CATEGORY_REMAP = {
  outlineGlow:    null, // dropped — engine OutlinePass no longer controlled here
  // polygonHighlight used to mix face/edge/vertex. Old per-category
  // fields are merged into the closest new category.
};

export const ModelerSettings = {
  /** @type {object} live settings — never mutated destructively from outside */
  _values: _deepClone(MODELER_SETTINGS_DEFAULTS),
  /** @type {object|null} user "Make Default" overrides (localStorage-backed) */
  _userDefaults: typeof localStorage !== 'undefined' ? _loadUserDefaults() : null,
  /** listeners fired whenever settings change */
  _listeners: new Set(),

  /**
   * Effective defaults = factory defaults merged with user "Make Default"
   * overrides. Used by resetCategory / resetAll.
   */
  _effectiveDefaults() {
    return _deepMerge(MODELER_SETTINGS_DEFAULTS, this._userDefaults);
  },

  /** Read the merged current settings (defensive copy). */
  get() {
    return _deepClone(this._values);
  },

  /** Get one category. */
  getCategory(name) {
    return _deepClone(this._values[name]);
  },

  /**
   * Replace settings wholesale (used on project load). Values are merged
   * over (factory + user-defaults) so missing keys still resolve.
   * @param {object|null|undefined} raw
   */
  loadInto(raw) {
    // Migrate legacy keys (outlineGlow → dropped, etc.) before merging.
    const migrated = this._migrateLegacy(raw || {});
    this._values = _deepMerge(this._effectiveDefaults(), migrated);
    this._applyAll();
  },

  /**
   * Translate a legacy settings blob (from an older project file) into
   * the current schema. Unknown keys are dropped silently. Known legacy
   * categories are remapped or merged into their current equivalents.
   */
  _migrateLegacy(raw) {
    const out = { ...raw };
    for (const [legacyKey, targetKey] of Object.entries(LEGACY_CATEGORY_REMAP)) {
      if (out[legacyKey] == null) continue;
      if (targetKey && out[targetKey] == null) {
        // Map an entire legacy category onto its replacement.
        out[targetKey] = { ...out[legacyKey] };
      }
      delete out[legacyKey];
    }
    // Old polygonHighlight had a vertexSize field; route it to vertexHighlight.
    if (out.polygonHighlight && out.vertexHighlight && typeof out.polygonHighlight.vertexSize === 'number' && out.vertexHighlight.vertexSize == null) {
      out.vertexHighlight.vertexSize = out.polygonHighlight.vertexSize;
    }
    return out;
  },

  /**
   * Return a plain-object snapshot suitable for embedding in a project
   * snapshot under the `modelerSettings` key.
   */
  serialize() {
    return _deepClone(this._values);
  },

  /**
   * Patch a single category (shallow merge of keys). Triggers live apply.
   * @param {'selectionGizmo'|'wireframe'|'polygonHighlight'|'edgeHighlight'|'vertexHighlight'} category
   * @param {object} patch
   */
  updateCategory(category, patch) {
    if (!this._values[category]) return;
    this._values[category] = { ...this._values[category], ...patch };
    this._applyCategory(category);
  },

  /**
   * Reset a single category to the effective defaults (factory + user
   * permanent defaults). Triggers live apply.
   */
  resetCategory(category) {
    const d = this._effectiveDefaults();
    if (!d[category]) return;
    this._values[category] = _deepClone(d[category]);
    this._applyCategory(category);
  },

  /** Reset everything to the effective defaults. */
  resetAll() {
    this._values = _deepClone(this._effectiveDefaults());
    this._applyAll();
  },

  /**
   * "Make Default" — copy the current live values for `category` (or all
   * categories if none passed) into the user permanent defaults and
   * persist to localStorage. These become the new effective defaults.
   * @param {string|null} category  null = all four
   */
  makeDefault(category = null) {
    if (category) {
      if (!this._values[category]) return;
      this._userDefaults = this._userDefaults || {};
      this._userDefaults[category] = _deepClone(this._values[category]);
    } else {
      this._userDefaults = _deepClone(this._values);
    }
    _saveUserDefaults(this._userDefaults);
  },

  /**
   * Clear all user permanent defaults and revert to factory defaults.
   * Live values are not affected — only future resets.
   */
  clearUserDefaults() {
    this._userDefaults = null;
    _clearUserDefaults();
  },

  /** True if the user has any "Make Default" overrides stored. */
  hasUserDefaults() {
    return !!(this._userDefaults && Object.keys(this._userDefaults).length);
  },

  /**
   * Subscribe to any change. cb receives the category name (or '*').
   * After all listeners run, the live scene is auto-applied so callers
   * never need to wire up applyModelerSettingsToScene themselves.
   */
  onChange(cb) {
    this._listeners.add(cb);
    return () => this._listeners.delete(cb);
  },

  // ── Live application ────────────────────────────────────────────────────

  _emit(category) {
    for (const cb of this._listeners) {
      try { cb(category, this._values); } catch (err) { console.warn('[ModelerSettings] listener error:', err); }
    }
    // Always apply to the live scene so external code (project load,
    // modeler enter, reset) and live UI edits (slider drag, color
    // picker, toggle) propagate without each caller having to remember.
    // When the modeler or post pipeline aren't constructed yet the
    // helpers are no-ops, so this is safe to call any time.
    applyModelerSettingsToScene();
  },

  _applyCategory(category) {
    this._emit(category);
  },

  _applyAll() {
    for (const cat of Object.keys(MODELER_SETTINGS_DEFAULTS)) this._emit(cat);
  },
};

// ── Visual application helpers ──────────────────────────────────────────────
// These are intentionally a thin layer so the settings popup can preview
// changes immediately without dragging in heavy module dependencies.

/**
 * Apply all five categories to the live scene. Called by ModelerSettings
 * on every change AND on every modeler enter/exit transition so the
 * modeler always renders with its own settings.
 *
 * Safe to call even when the modeler is inactive — it just updates cached
 * state on the next-frame apply.
 */
export function applyModelerSettingsToScene() {
  const cycleModeler = window.__cyco?.cycleModeler;
  if (!cycleModeler) return;

  const s = ModelerSettings.get();

  // 1. Wireframe overlay on every modeler object (LineSegments2 child).
  cycleModeler._setWireOverlayStyle?.({
    color:     new THREE.Color(s.wireframe.color),
    thickness: s.wireframe.thickness,
    opacity:   s.wireframe.opacity,
    enabled:   s.wireframe.enabled,
  });

  // 2. Hover polygon highlight (FACE) — color + opacity.
  cycleModeler._setHoverStyle?.({
    mode:    'polygon',
    color:   new THREE.Color(s.polygonHighlight.color),
    opacity: s.polygonHighlight.opacity,
    enabled: s.polygonHighlight.enabled,
  });

  // 3. Hover EDGE highlight.
  cycleModeler._setHoverStyle?.({
    mode:      'edge',
    color:     new THREE.Color(s.edgeHighlight.color),
    opacity:   s.edgeHighlight.opacity,
    thickness: s.edgeHighlight.thickness,
    enabled:   s.edgeHighlight.enabled,
  });

  // 4. Hover VERTEX highlight.
  cycleModeler._setHoverStyle?.({
    mode:      'vertex',
    color:     new THREE.Color(s.vertexHighlight.color),
    opacity:   s.vertexHighlight.opacity,
    vertexSize:s.vertexHighlight.vertexSize,
    enabled:   s.vertexHighlight.enabled,
  });

  // 5. Selection Gizmo = the engine's outline pass for cycle-modeler
  //    objects. Push the user's cycle-modeler settings (color, thickness,
  //    glow color, glow opacity, enabled) into the engine's primary
  //    outline cache so the same purple + glow outline the rest of the
  //    editor uses is what appears on selected modeler primitives.
  //    The post-processing pipeline reads these cached fields during
  //    `_applySelectionOutlinePrefs` and rebuilds the visible outline.
  //
  //    NOTE — per user instruction, the editor's OutlinePass + primary
  //    shell + glow are NEVER drawn while the cycle modeler is active.
  //    The modeler has its own hover / selection visuals (polygon /
  //    edge / vertex highlights) and the engine outline/glow would
  //    duplicate those visuals. So when the modeler is active we
  //    unconditionally hide the engine outline group + OutlinePass
  //    regardless of the Selection Gizmo toggle, and we skip the
  //    push-into-engine-outline path entirely (the cached colors are
  //    not consumed in modeler mode).
  const cm = window.__cyco?.cycleModeler;
  if (cm?.active) {
    // Cycle Modeler mode — the engine editor outline / glow must be
    // disabled. The modeler has its own per-element selection visuals
    // (purple hover ring on selected modeler primitives is drawn by the
    // modeler's hover layer, not the engine outline pass). Re-enabling
    // the engine outline on top would render the duplicate purple ring
    // + white glow that the user reported as a bug.
    const pp = window.__cyco?.postPipeline;
    if (pp?.primaryOutlineGroup) pp.primaryOutlineGroup.visible = false;
    if (pp?.secondaryOutlineGroup) pp.secondaryOutlineGroup.visible = false;
    if (pp?.outlinePass) {
      pp.outlinePass.enabled = false;
      pp.outlinePass.selectedObjects = [];
    }
    // Drop any cached modeler override so it can't bleed back in if
    // `_applySelectionOutlinePrefs` runs while we're still inside
    // modeler mode.
    if (pp) pp._modelerOutlineOverride = null;
  } else {
    // Outside cycle modeler mode — clear any leftover modeler override
    // so the engine's own prefs path is used again and PreferencesPanel
    // changes show up. The engine outline / glow is restored by
    // `_applySelectionOutlinePrefs` + `_scheduleOutlineRebuild`.
    const pp = window.__cyco?.postPipeline;
    if (pp?._modelerOutlineOverride) {
      pp._modelerOutlineOverride = null;
      if (typeof pp._applySelectionOutlinePrefs === 'function') {
        pp._applySelectionOutlinePrefs();
      }
      if (typeof pp._scheduleOutlineRebuild === 'function') {
        pp._scheduleOutlineRebuild();
      }
    }
  }

  // 6. CycleModelerController also exposes a legacy local setter used by
  //    the drag-preview. We still keep the modeler's preview outline in
  //    sync so the drag-preview reads from the same colour source.
  cycleModeler._setSelectionGizmoStyle?.({
    outlineColor: s.selectionGizmo.outlineColor,
    outlineWidth: s.selectionGizmo.outlineWidth,
    glowColor:    s.selectionGizmo.glowColor,
    glowWidth:    s.selectionGizmo.glowWidth,
    glowOpacity:  s.selectionGizmo.glowOpacity,
    enabled:      s.selectionGizmo.enabled,
  });
}

