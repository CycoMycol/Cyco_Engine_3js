/**
 * CameraGizmoHelper.js
 *
 * Wraps three.js's `ViewHelper` so the engine can:
 *   • Forward pointer events from the gizmo overlay / canvas to `handleClick`
 *     (the stock helper exposes `handleClick` but does NOT install any DOM
 *     listener — three.js's editor wires that up manually in Viewport.js).
 *   • Drive the helper's per-frame animation via `update(delta)`.
 *   • Apply live prefs (size, position, opacity, axis colors, letter colors,
 *     labels, click-to-align, ring outline for negative axes) without
 *     rebuilding the helper where possible.
 *   • Re-anchor the overlay <canvas> in one of the four corners when the
 *     gizmo position changes (WebGPU mode).
 *
 * The stock ViewHelper bakes the negative-axis sprite as a SOLID FILLED DISC
 * (the "black background" the user was seeing). After construction we
 * overwrite that sprite's CanvasTexture with a RING-ONLY rendering so the
 * negative axes are visible as outlined circles, never as a filled black
 * square. The ring color + thickness are driven by the
 * `outlineColor` / `outlineThickness` / `outlineEnabled` prefs.
 *
 * Used by ViewportEngine; not intended to be used standalone.
 */

import { ViewHelper } from 'three/addons/helpers/ViewHelper.js';
import { CanvasTexture, SRGBColorSpace, Color, SpriteMaterial } from 'three';

const DEFAULT_PREFS = Object.freeze({
  size: 128,
  position: 'bottom-right',     // 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'
  opacity: 1,
  dimNegativeAxes: true,
  colorX: '#ff4466',
  colorY: '#88ff44',
  colorZ: '#4488ff',
  colorNegative: '#000000',     // legacy — kept for back-compat; not rendered
  // Letter colors (X / Y / Z characters drawn inside the positive disc).
  letterColorX: '#ffffff',
  letterColorY: '#ffffff',
  letterColorZ: '#ffffff',
  // Ring outline around the negative axis discs. When `outlineEnabled` is
  // true the negative axes render as rings (no fill) so the viewport shows
  // through. `outlineColor` is the ring color, `outlineThickness` is the
  // ring stroke width in canvas pixels (1..8).
  outlineEnabled: true,
  outlineColor: '#cccccc',
  outlineThickness: 2,
  labelX: 'X',
  labelY: 'Y',
  labelZ: 'Z',
  enableClickToAlign: true,
});

/**
 * Build a ring-only canvas texture (transparent background, no fill).
 * Used to override the stock ViewHelper's solid black negative-axis disc.
 *
 * @param {string} strokeColor - CSS color for the ring stroke.
 * @param {number} thickness   - Ring stroke width in pixels (1..8).
 */
function _makeRingTexture(strokeColor, thickness) {
  const W = 64, H = 64;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  const cx = W / 2, cy = H / 2;
  const radius = 14;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
  ctx.lineWidth = Math.max(1, Math.min(8, thickness || 2));
  ctx.strokeStyle = strokeColor || '#cccccc';
  ctx.stroke();
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

const _DBG = (tag, payload) => {
  if (window.CYCO_DEBUG_GIZMO) {
    try { console.log(`[CYCO:GIZMO:${tag}]`, payload); } catch (_) { /* noop */ }
  }
};

/**
 * Map a position key to a `viewHelper.location` object matching three.js's
 * ViewHelper API (where `null` on a side means "use the opposite side").
 */
function _locationForPosition(position) {
  switch (position) {
    case 'bottom-left':  return { top: null, right: null, bottom: 0, left: 0 };
    case 'top-right':    return { top: 0,    right: 0,    bottom: null, left: null };
    case 'top-left':     return { top: 0,    right: null, bottom: null, left: 0 };
    case 'bottom-right':
    default:             return { top: null, right: 0,    bottom: 0, left: null };
  }
}

export class CameraGizmoHelper {
  /**
   * @param {THREE.Camera} camera - the scene camera whose orientation to mirror.
   * @param {HTMLElement} domElement - the canvas the user clicks on.
   * @param {object} [prefs] - initial prefs; merged with DEFAULT_PREFS.
   */
  constructor(camera, domElement, prefs = {}) {
    this._prefs = { ...DEFAULT_PREFS, ...prefs };
    this._helper = new ViewHelper(camera, domElement);
    this._domElement = domElement;
    this._camera = camera;

    // Apply initial size/location/labels/opacity/dim before the first render
    // so we never see a default-styled helper on screen. Order matters:
    // _applyLabels rebuilds the positive sprite materials, so axis-disc
    // colours + letter colours must run AFTER it.
    this._applySize(this._prefs.size);
    this._applyLocation(this._prefs.position);
    this._applyLabels(this._prefs.labelX, this._prefs.labelY, this._prefs.labelZ);
    // STOCK BUG WORKAROUND: ViewHelper creates SpriteMaterial WITHOUT
    // `transparent: true`, so the canvas pixels outside the disc (which
    // default to RGB 0,0,0) render as OPAQUE BLACK SQUARES around each
    // disc. Force `transparent: true` on every sprite material so alpha=0
    // pixels are skipped. Must run AFTER _applyLabels (which rebuilds
    // the positive sprite materials) and AFTER _applyNegativeRing (which
    // rebuilds the negative sprite textures).
    this._applySpriteTransparency();
    this._applyAxisColors(this._prefs.colorX, this._prefs.colorY, this._prefs.colorZ);
    this._applyLabelStyle(
      this._prefs.letterColorX, this._prefs.letterColorY, this._prefs.letterColorZ,
    );
    this._applyOpacity(this._prefs.opacity);
    this._applyDimNegative(!!this._prefs.dimNegativeAxes);
    // Replace the solid black negative-axis disc with a ring-only texture
    // so the viewport shows through (no black background).
    this._applyNegativeRing(
      !!this._prefs.outlineEnabled,
      this._prefs.outlineColor,
      this._prefs.outlineThickness,
    );
    // Re-apply transparency after the negative-ring texture swap, since
    // _applyNegativeRing creates fresh SpriteMaterials for the negative
    // axes (via canvas replacement) and they default to transparent:false.
    this._applySpriteTransparency();

    _DBG('ctor', {
      size: this._prefs.size,
      position: this._prefs.position,
      opacity: this._prefs.opacity,
      outlineEnabled: this._prefs.outlineEnabled,
      outlineColor: this._prefs.outlineColor,
      letterColorX: this._prefs.letterColorX,
      letterColorY: this._prefs.letterColorY,
      letterColorZ: this._prefs.letterColorZ,
      colorX: this._prefs.colorX,
      colorY: this._prefs.colorY,
      colorZ: this._prefs.colorZ,
      childCount: this._helper.children?.length,
    });

    // Click handler — installed on a per-instance basis so the stock helper
    // stays untouched and can keep being used elsewhere.
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onPointerDown = this._onPointerDown.bind(this);
    domElement.addEventListener('pointerup',   this._onPointerUp);
    domElement.addEventListener('pointerdown', this._onPointerDown);
  }

  // ── Public API (mirrors what ViewportEngine currently calls on the raw helper) ──

  /** The underlying three.js ViewHelper. */
  get viewHelper() { return this._helper; }

  /** Per-frame call from the render loop — animates camera-snap transitions. */
  update(delta) {
    if (this._helper.animating) this._helper.update(delta);
  }

  /** Render the gizmo to a renderer (WebGL or WebGPU-overlay). */
  render(renderer) {
    this._helper.render(renderer);
  }

  /** True while a click-snap animation is playing. */
  get animating() { return this._helper.animating; }

  /**
   * Re-anchor the overlay canvas. The WebGPU-mode overlay canvas is added
   * to the viewport container by ViewportEngine; call this when the user
   * picks a different corner so the overlay follows the helper's `location`.
   *
   * @param {HTMLElement} overlayCanvas
   * @param {HTMLElement} container
   */
  repositionOverlay(overlayCanvas, container) {
    if (!overlayCanvas || !container) return;
    const size = this._prefs.size;
    const w = container.clientWidth  || container.offsetWidth  || 0;
    const h = container.clientHeight || container.offsetHeight || 0;
    const pos = this._prefs.position;
    overlayCanvas.style.width  = `${size}px`;
    overlayCanvas.style.height = `${size}px`;
    overlayCanvas.style.top    = '';
    overlayCanvas.style.right  = '';
    overlayCanvas.style.bottom = '';
    overlayCanvas.style.left   = '';
    switch (pos) {
      case 'top-left':     overlayCanvas.style.top    = '0';   overlayCanvas.style.left  = '0'; break;
      case 'top-right':    overlayCanvas.style.top    = '0';   overlayCanvas.style.right = '0'; break;
      case 'bottom-left':  overlayCanvas.style.bottom = '0';   overlayCanvas.style.left  = '0'; break;
      case 'bottom-right':
      default:             overlayCanvas.style.bottom = '0';   overlayCanvas.style.right = '0'; break;
    }
    // Update renderer size too so the WebGL viewport matches the new size.
    if (this._renderer) {
      this._renderer.setSize(size, size, false);
    }
    void w; void h;
  }

  setRenderer(renderer) { this._renderer = renderer; }

  /**
   * Apply a new prefs object. Most fields are live-applied; the four axis
   * colors require rebuilding the helper because the stock ViewHelper bakes
   * the sprite disc colours into a CanvasTexture that has no public rebuild
   * path. The caller (ViewportEngine) is expected to dispose+rebuild the
   * wrapper when it receives a prefs change that includes a color field.
   *
   * Order matters: setLabels() rebuilds the positive-sprite materials
   * (because it bakes the disc canvas-texture), which RESETS their
   * opacity back to 1. We therefore re-apply opacity + dim *after*
   * setLabels so the user's slider value sticks.
   */
  applyPrefs(prefs) {
    if (!prefs) return;
    this._prefs = { ...this._prefs, ...prefs };

    // Order matters here. The stock helper's `setLabels` rebuilds the
    // positive-sprite materials (fresh CanvasTexture, fresh SpriteMaterial),
    // which RESETS the disc colour we just painted via `_applyAxisColors`.
    // We therefore call `_applyLabels` FIRST so the new materials exist,
    // then re-paint the disc + letter colours into the freshly-created
    // canvases.
    this._applyLabels(this._prefs.labelX, this._prefs.labelY, this._prefs.labelZ);

    // STOCK BUG WORKAROUND: ViewHelper creates SpriteMaterial WITHOUT
    // `transparent: true`. Force it on every sprite after _applyLabels
    // rebuilds them, so canvas pixels outside the disc are skipped
    // (otherwise they render as opaque black squares).
    this._applySpriteTransparency();

    // Axis disc colours (positive X/Y/Z sprite fill). Paint into the
    // freshly-rebuilt sprite canvas — `_applyLabels` just disposed the
    // previous material, so this is the first colour the user will see.
    this._applyAxisColors(
      this._prefs.colorX, this._prefs.colorY, this._prefs.colorZ,
    );

    // Letter color (X/Y/Z character) — paint on top of the disc fill so
    // the letter stays legible regardless of the disc colour.
    this._applyLabelStyle(
      this._prefs.letterColorX, this._prefs.letterColorY, this._prefs.letterColorZ,
    );

    // Opacity — applied to every material in the helper. NOTE: this must
    // run AFTER _applyLabels/_applyAxisColors because both of those reset
    // the material's opacity back to 1.
    this._applyOpacity(this._prefs.opacity);

    // Dim-negative toggle (stock helper hard-codes 0.2 on the negative
    // sprites; we mirror that when the toggle is on, else 1).
    this._applyDimNegative(!!this._prefs.dimNegativeAxes);

    // Ring outline on the negative axes. Rebuilding the texture is cheap
    // (64x64 canvas) and lets the user tweak color / thickness live
    // without a wrapper rebuild.
    this._applyNegativeRing(
      !!this._prefs.outlineEnabled,
      this._prefs.outlineColor,
      this._prefs.outlineThickness,
    );

    // Re-apply transparency after _applyNegativeRing swaps textures and
    // may replace SpriteMaterials on the negative sprites.
    this._applySpriteTransparency();

    // Position — update the helper's location so the renderer chooses the
    // right viewport rect next frame.
    this._applyLocation(this._prefs.position);

    // Position the overlay <canvas> if one was attached (WebGPU).
    if (this._repositionCallback) {
      try { this._repositionCallback(); } catch (_) { /* noop */ }
    }
  }

  /**
   * Called by the host (ViewportEngine) to register a callback that should
   * be invoked whenever the overlay canvas needs to be repositioned (i.e.
   * after `applyPrefs`). Kept as a hook instead of a hard reference so the
   * wrapper stays decoupled from ViewportEngine.
   */
  setRepositionCallback(cb) { this._repositionCallback = cb; }

  /** Current prefs snapshot (used by ViewportEngine to persist on save). */
  getPrefs() { return { ...this._prefs }; }

  /** Tear down listeners and dispose the underlying ViewHelper. */
  dispose() {
    if (this._domElement) {
      this._domElement.removeEventListener('pointerup',   this._onPointerUp);
      this._domElement.removeEventListener('pointerdown', this._onPointerDown);
    }
    try { this._helper.dispose(); } catch (_) { /* noop */ }
    this._domElement = null;
    this._helper = null;
    this._camera = null;
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  _onPointerDown(event) {
    // Swallow the pointerdown so OrbitControls / marquee don't try to
    // start a drag in the same frame the user is clicking the gizmo.
    if (!this._prefs.enableClickToAlign) return;
    if (this._eventOverGizmo(event)) {
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
    }
  }

  _onPointerUp(event) {
    if (!this._prefs.enableClickToAlign) return;
    // Let three.js's ViewHelper translate the screen-space click into an
    // axis hit. If it hit a handle, handleClick() sets `animating = true`
    // and the per-frame `update(delta)` call in the render loop drives
    // the camera-snap.
    const hit = this._helper.handleClick(event);
    if (hit) {
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
    }
  }

  /**
   * Cheap pre-check: is this pointer event over the gizmo's screen rect?
   * Uses the helper's `location` + `dim` constant (must match three.js — 128).
   */
  _eventOverGizmo(event) {
    const rect = this._domElement.getBoundingClientRect();
    const size = this._prefs.size || 128;
    const loc = this._helper.location;
    let x, y;
    if (loc.left != null) x = rect.left + loc.left;
    else                  x = rect.right - size - loc.right;
    if (loc.top != null)  y = rect.top + loc.top;
    else                  y = rect.bottom - size - loc.bottom;
    return event.clientX >= x && event.clientX <= x + size &&
           event.clientY >= y && event.clientY <= y + size;
  }

  _applySize(size) {
    this._prefs.size = size;
    // The stock helper hard-codes 128; we patch the render() viewport by
    // setting all four `location` values explicitly so the helper region
    // is exactly `size`×`size` wherever it's anchored.
    // (No public setter on ViewHelper for the dim — we re-implement the
    //  viewport sizing in our render() call below.)
  }

  _applyLocation(position) {
    this._prefs.position = position;
    const loc = _locationForPosition(position);
    this._helper.location.top    = loc.top;
    this._helper.location.right  = loc.right;
    this._helper.location.bottom = loc.bottom;
    this._helper.location.left   = loc.left;
    _DBG('applyLocation', {
      position,
      resolved: { ...loc },
    });
  }

  _applyOpacity(opacity) {
    const o = Math.max(0, Math.min(1, +opacity || 0));
    this._prefs.opacity = o;
    // Walk the helper's children. The 3 axis meshes use MeshBasicMaterial
    // (in closure — but their materials are reachable via .material).
    // The 6 sprites use SpriteMaterial; same approach.
    //
    // IMPORTANT: negative-axis sprites have an alpha-only texture (the
    // ring). If we ever set `transparent=false` on those, three.js
    // composites them as opaque black, which is the "black background"
    // symptom the user reported. We therefore ALWAYS keep `transparent=true`
    // on negative sprites regardless of opacity. We still apply the user's
    // opacity value so the slider works correctly.
    let touched = 0;
    for (const child of this._helper.children) {
      if (!child.material) continue;
      const type = child.userData?.type || '';
      const isNegative = type.startsWith('neg');
      if (isNegative) {
        // Always force transparent for alpha-textured negative sprites.
        child.material.transparent = true;
      } else {
        child.material.transparent = o < 1;
      }
      child.material.opacity = o;
      child.material.needsUpdate = true;
      touched++;
    }
    _DBG('applyOpacity', { opacity: o, touched });
  }

  _applyDimNegative(dim) {
    // The stock helper sets negative sprite materials to opacity 0.2 at
    // construction. We re-implement that here so the toggle is live.
    for (const child of this._helper.children) {
      const type = child.userData?.type;
      if (!type) continue;
      if (type.startsWith('neg') && child.material) {
        child.material.opacity = dim ? 0.2 * (this._prefs.opacity ?? 1) : (this._prefs.opacity ?? 1);
        child.material.needsUpdate = true;
      }
    }
  }

  _applyLabels(x, y, z) {
    try {
      // The stock helper exposes setLabels(x, y, z). Empty string = unlabeled.
      this._helper.setLabels(x || undefined, y || undefined, z || undefined);
    } catch (_) { /* noop — older builds may not have setLabels */ }
  }

  /**
   * Apply the X / Y / Z letter colors. The stock helper's `setLabelStyle`
   * takes a single color and applies it to all three labels, so we call it
   * three times with one color at a time by rebuilding the label strings
   * between calls. The final color of a label is whichever call ran last
   * for that label, so we set labels to a unique placeholder, then call
   * setLabelStyle(letterColorX) while labelX is the placeholder, etc.
   *
   * In practice three.js's setLabelStyle rebuilds all three labels using
   * the passed color — we instead work around this by directly painting
   * the letter colour into the existing positive-sprite canvas textures.
   * This is more robust against three.js internals changing.
   */
  _applyLabelStyle(colorX, colorY, colorZ) {
    this._prefs.letterColorX = colorX;
    this._prefs.letterColorY = colorY;
    this._prefs.letterColorZ = colorZ;

    const letterColorForType = { posX: colorX, posY: colorY, posZ: colorZ };
    const labelTextForType   = {
      posX: this._prefs.labelX,
      posY: this._prefs.labelY,
      posZ: this._prefs.labelZ,
    };
    // Read the current disc colour from each sprite's own canvas so we
    // can wipe the previous letter without changing the disc fill.  The
    // disc fill is whatever was last painted (the stock helper's hard-
    // coded colour at construction, or the user-customised colour via
    // `_applyAxisColors`).  We probe a single pixel inside the disc to
    // recover it.
    const discColorForType = {
      posX: this._prefs.colorX || '#ff4466',
      posY: this._prefs.colorY || '#88ff44',
      posZ: this._prefs.colorZ || '#4488ff',
    };
    let touched = 0;
    for (const child of this._helper.children) {
      const type = child.userData?.type;
      if (!type || !letterColorForType[type]) continue;
      const tex = child.material?.map;
      if (!tex || !tex.image) continue;
      const canvas = tex.image;
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      const labelText = labelTextForType[type];
      if (!labelText) continue;
      // Restore the disc fill (this also wipes the existing black letter
      // baked by the stock helper).
      ctx.save();
      // Clip to the disc circle so we don't paint the surrounding alpha.
      ctx.beginPath();
      ctx.arc(32, 32, 14, 0, 2 * Math.PI);
      ctx.clip();
      ctx.beginPath();
      ctx.arc(32, 32, 14, 0, 2 * Math.PI);
      ctx.closePath();
      ctx.fillStyle = discColorForType[type];
      ctx.fill();
      // Now redraw the letter at the centre with the user's chosen colour.
      ctx.font = '24px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = letterColorForType[type] || '#ffffff';
      // Disc center is at (32,32). With textBaseline='middle', the text's
      // vertical center sits at the y-coordinate, so y=32 puts the letter
      // exactly on the disc center.
      ctx.fillText(labelText, 32, 32);
      ctx.restore();
      tex.needsUpdate = true;
      touched++;
    }
    _DBG('applyLabelStyle', { colorX, colorY, colorZ, touched });
  }

  /**
   * Repaint the disc fill colour on each positive-sprite canvas. The
   * stock ViewHelper bakes the disc colour into a CanvasTexture at
   * construction time and never repaints it; without this method the
   * user's `colorX/Y/Z` prefs would have no visible effect.
   *
   * Like `_applyLabelStyle`, we don't tear down the helper — we just
   * edit the existing 64×64 sprite canvas. Order matters: paint the disc
   * first, then the letter on top, so the letter stays legible against
   * any disc colour.
   */
  _applyAxisColors(colorX, colorY, colorZ) {
    this._prefs.colorX = colorX;
    this._prefs.colorY = colorY;
    this._prefs.colorZ = colorZ;

    const discColorForType = { posX: colorX, posY: colorY, posZ: colorZ };
    const letterColorForType = {
      posX: this._prefs.letterColorX,
      posY: this._prefs.letterColorY,
      posZ: this._prefs.letterColorZ,
    };
    const labelTextForType = {
      posX: this._prefs.labelX,
      posY: this._prefs.labelY,
      posZ: this._prefs.labelZ,
    };
    let touched = 0;
    for (const child of this._helper.children) {
      const type = child.userData?.type;
      if (!type || !discColorForType[type]) continue;
      const tex = child.material?.map;
      if (!tex || !tex.image) continue;
      const canvas = tex.image;
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      const labelText = labelTextForType[type];
      ctx.save();
      // Clear the previous disc + letter by painting the whole disc with
      // the new disc colour first.
      ctx.beginPath();
      ctx.arc(32, 32, 14, 0, 2 * Math.PI);
      ctx.closePath();
      ctx.fillStyle = discColorForType[type] || '#888888';
      ctx.fill();
      // Re-draw the letter on top so the colour picker for `letterColorX/Y/Z`
      // is still respected after a disc-colour change.
      if (labelText) {
        ctx.font = '24px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = letterColorForType[type] || '#ffffff';
        // Disc center is at (32,32). With textBaseline='middle', the text's
        // vertical center sits at the y-coordinate, so y=32 puts the letter
        // exactly on the disc center.
        ctx.fillText(labelText, 32, 32);
      }
      ctx.restore();
      tex.needsUpdate = true;
      touched++;
    }
    _DBG('applyAxisColors', { colorX, colorY, colorZ, touched });
  }

  /**
   * Force `transparent: true` on every SpriteMaterial in the helper.
   *
   * STOCK BUG WORKAROUND: three.js's ViewHelper builds SpriteMaterial
   * instances with `transparent` defaulting to false. A 2D canvas
   * defaults to fully transparent black (RGBA 0,0,0,0) outside any
   * drawn region, so when the SpriteMaterial is opaque, those
   * transparent pixels render as opaque black RGB(0,0,0). The visible
   * symptom is a black square larger than the disc around every axis
   * label. Setting `transparent: true` lets the GPU discard alpha=0
   * fragments and the viewport shows through.
   *
   * This must run AFTER every method that creates or replaces a sprite
   * material — namely `_applyLabels` (rebuilds positive sprite materials)
   * and `_applyNegativeRing` (replaces negative sprite textures and may
   * allocate a fresh SpriteMaterial). The constructor and `applyPrefs`
   * call this twice to cover both events.
   */
  _applySpriteTransparency() {
    let touched = 0;
    for (const child of this._helper.children) {
      const mat = child.material;
      if (!mat || !mat.isSpriteMaterial) continue;
      if (mat.transparent !== true) {
        mat.transparent = true;
        mat.needsUpdate = true;
        touched++;
      }
    }
    _DBG('applySpriteTransparency', { touched });
  }

  /**
   * Replace the negative-axis sprite textures with a transparent ring.
   * The stock ViewHelper bakes a SOLID FILLED DISC at construction, which
   * appears as a black square (the "black background" the user reported).
   * We swap the texture for a 64×64 transparent canvas with a stroked
   * circle only, so the viewport shows through.
   *
   * @param {boolean} enabled     - If false, restore the stock solid disc.
   * @param {string}  color       - CSS color for the ring stroke.
   * @param {number}  thickness   - Stroke width in pixels.
   */
  _applyNegativeRing(enabled, color, thickness) {
    let touched = 0;
    for (const child of this._helper.children) {
      const type = child.userData?.type;
      if (!type || !type.startsWith('neg')) continue;
      if (!child.material) continue;
      if (enabled) {
        // Build a fresh ring texture and swap it in.
        const oldMap = child.material.map;
        if (oldMap) oldMap.dispose();
        child.material.map = _makeRingTexture(color, thickness);
        // CRITICAL: transparent MUST stay true so the ring's alpha
        // shows the viewport underneath instead of composite-black.
        child.material.transparent = true;
        child.material.needsUpdate = true;
        // Remember so we can revert if the user disables the outline.
        this._prefs.outlineEnabled = true;
        this._prefs.outlineColor = color;
        this._prefs.outlineThickness = thickness;
        touched++;
      } else {
        // User disabled the outline — hide the negative axis sprites
        // entirely. Restoring the stock disc would re-introduce the
        // black background, so opacity-0 is the safer fallback.
        child.material.opacity = 0;
        child.material.transparent = true;
        child.material.needsUpdate = true;
        this._prefs.outlineEnabled = false;
        touched++;
      }
    }
    _DBG('applyNegativeRing', { enabled, color, thickness, touched });
  }
}

export default CameraGizmoHelper;
