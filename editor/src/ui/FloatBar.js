/**
 * FloatBar.js â€” float/dock toggle for toolbars and menu bars.
 *
 * Basic usage (menu bar, top toolbar):
 *   const floatBtn = makeFloatable(barElement);
 *
 * With edge-docking (viewport left toolbar):
 *   const floatBtn = makeFloatable(barElement, {
 *     dragFromBar:      true,
 *     edgeDock:         true,
 *     edgeDockSelector: '.ce-viewport-body',
 *     edgeDockViewport: '.ce-viewport-root',
 *     edgeDockPx:       64,
 *   });
 */

// "Pop out" â€” bar is docked, click to float
export const FLOAT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 11 11" fill="currentColor"><circle cx="3.5" cy="2.5" r="1.2"/><circle cx="7.5" cy="2.5" r="1.2"/><circle cx="3.5" cy="5.5" r="1.2"/><circle cx="7.5" cy="5.5" r="1.2"/><circle cx="3.5" cy="8.5" r="1.2"/><circle cx="7.5" cy="8.5" r="1.2"/></svg>`;

// "Push in" â€” bar is floating, click to snap back
export const SNAPBACK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="1" width="7" height="7" rx="1"/><polyline points="7,10 1,10 1,4"/></svg>`;

/**
 * @param {HTMLElement} barEl
 * @param {Object}  [options]
 * @param {boolean} [options.dragFromBar=false]      drag to float from any non-button area
 * @param {boolean} [options.edgeDock=false]         dock to viewport edges on release
 * @param {string}  [options.edgeDockSelector]       CSS selector for viewport reference element
 * @param {string}  [options.edgeDockViewport]       CSS selector for viewport root element
 * @param {number}  [options.edgeDockPx=64]          px from viewport edge â†’ viewport dock zone
 * @param {number}  [options.screenEdgePx=32]        px from screen edge â†’ screen dock zone
 * @returns {HTMLButtonElement}
 */
export function makeFloatable(barEl, options = {}) {
  const {
    dragFromBar      = false,
    edgeDock         = false,
    edgeDockSelector = '.ce-viewport-body',
    edgeDockViewport = '.ce-viewport-root',
    edgeDockPx       = 64,
    screenEdgePx     = 32,
  } = options;

  let floating    = false;
  let floatWin    = null;
  let placeholder = null;
  let prevOrient  = [];

  const btn = document.createElement('button');
  btn.className = 'ce-bar-float-btn';
  _updateBtn();

  let _suppressNextClick = false;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (_suppressNextClick) { _suppressNextClick = false; return; }
    floating ? _dock() : _float();
  });

  // Allow drag-to-float directly from the float button (6 px threshold).
  // _suppressNextClick prevents the click event from re-docking after a drag.
  btn.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || floating) return;
    const sx = e.clientX, sy = e.clientY;
    const onBtnDragMove = (mv) => {
      if (Math.hypot(mv.clientX - sx, mv.clientY - sy) < 6) return;
      document.removeEventListener('mousemove', onBtnDragMove);
      document.removeEventListener('mouseup',   onBtnDragCancel);
      _suppressNextClick = true;
      _float(sx, sy);
    };
    const onBtnDragCancel = () => {
      document.removeEventListener('mousemove', onBtnDragMove);
      document.removeEventListener('mouseup',   onBtnDragCancel);
    };
    document.addEventListener('mousemove', onBtnDragMove);
    document.addEventListener('mouseup',   onBtnDragCancel);
  });

  // â”€â”€ float â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  function _float(startX, startY) {
    if (floating) return;

    // Capture rect FIRST -- before any class or DOM change that triggers reflow.
    // Removing orientation classes (is-top / is-bottom) first causes the browser
    // to reflow horizontal -> vertical before we measure, so startX - rect.left
    // becomes wildly wrong for horizontal bars.
    const rect = barEl.getBoundingClientRect();

    if (edgeDock) {
      prevOrient = ['is-right', 'is-top', 'is-bottom'].filter(c => barEl.classList.contains(c));
      barEl.classList.remove('is-right', 'is-top', 'is-bottom');
    }

    placeholder = document.createComment('ce-bar-float-placeholder');
    barEl.parentNode.insertBefore(placeholder, barEl);

    floatWin = document.createElement('div');
    floatWin.className = 'ce-bar-float-window';
    floatWin.style.left = rect.left + 'px';
    floatWin.style.top  = rect.top  + 'px';

    const grip = document.createElement('div');
    grip.className = 'ce-bar-float-grip';
    grip.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const wr = floatWin.getBoundingClientRect();
      _beginDrag(e.clientX - wr.left, e.clientY - wr.top);
    });

    floatWin.appendChild(grip);
    floatWin.appendChild(barEl);
    document.body.appendChild(floatWin);

    floating = true;
    _updateBtn();

    // If initiated by a bar mousedown, begin drag immediately.
    // Clamp ox/oy to the actual floatWin size -- prevents cursor mis-sync
    // when the bar changes orientation (e.g. horizontal is-top -> vertical).
    if (startX !== undefined && startY !== undefined) {
      const fw = floatWin.offsetWidth;
      const fh = floatWin.offsetHeight;
      const ox = Math.max(2, Math.min(startX - rect.left, fw - 2));
      const oy = Math.max(2, Math.min(startY - rect.top,  fh - 2));
      floatWin.style.left = (startX - ox) + 'px';
      floatWin.style.top  = (startY - oy) + 'px';
      _beginDrag(ox, oy);
    }
  }

  // â”€â”€ dock back to placeholder â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  function _dock() {
    if (!floatWin || !placeholder || !placeholder.parentNode) return;

    if (edgeDock) {
      prevOrient.forEach(c => barEl.classList.add(c));
      prevOrient = [];
    }

    placeholder.parentNode.replaceChild(barEl, placeholder);
    placeholder = null;
    floatWin.remove();
    floatWin = null;
    floating = false;
    _updateBtn();
  }

  // â”€â”€ dock into a viewport edge â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  function _dockTo(side) {
    if (!edgeDock) return;
    const body = document.querySelector(edgeDockSelector);
    const root = document.querySelector(edgeDockViewport);
    if (!body || !root) return;

    if (placeholder && placeholder.parentNode) placeholder.parentNode.removeChild(placeholder);
    placeholder = null;
    prevOrient  = [];
    if (floatWin) floatWin.remove();
    floatWin = null;
    floating = false;

    barEl.classList.remove('is-right', 'is-top', 'is-bottom');
    _updateBtn();

    switch (side) {
      case 'left':
        body.insertBefore(barEl, body.firstChild);
        break;
      case 'right':
        barEl.classList.add('is-right');
        body.appendChild(barEl);
        break;
      case 'top': {
        barEl.classList.add('is-top');
        const topBar = root.querySelector('.ce-vp-topbar');
        root.insertBefore(barEl, topBar ? topBar.nextSibling : root.firstChild);
        break;
      }
      case 'bottom':
        barEl.classList.add('is-bottom');
        root.appendChild(barEl);
        break;
    }
  }

  // â”€â”€ drag â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  function _beginDrag(ox, oy) {
    // Inline styles guarantee orange color regardless of CSS cascade / load order.
    let indicator = null;
    if (edgeDock) {
      indicator = document.createElement('div');
      indicator.style.cssText = [
        'position:fixed',
        'z-index:8999',
        'pointer-events:none',
        'display:none',
        'background:rgba(224,114,40,0.15)',
        'border:2px solid rgba(224,114,40,0.75)',
        'border-radius:4px',
        'box-sizing:border-box',
        'transition:opacity 60ms',
      ].join(';');
      document.body.appendChild(indicator);
    }

    const onMove = (mv) => {
      if (!floatWin) return;
      // Unclamped: allow bar to reach any corner of the screen.
      floatWin.style.left = (mv.clientX - ox) + 'px';
      floatWin.style.top  = (mv.clientY - oy) + 'px';
      if (indicator) _updateIndicator(indicator, mv.clientX, mv.clientY);
    };

    const onUp = (upEv) => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
      if (indicator) { indicator.remove(); indicator = null; }
      if (edgeDock)  _checkDockDrop(upEv.clientX, upEv.clientY);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  }

  // Dock zones: anywhere outside the viewport OR within edgeDockPx of an edge.
  function _checkDockDrop(mx, my) {
    const body = document.querySelector(edgeDockSelector);
    if (!body) return;
    const r = body.getBoundingClientRect();

    let side = null;
    if (mx < r.left || mx > r.right || my < r.top || my > r.bottom) {
      // Outside viewport -- dock to whichever side the cursor has crossed the most.
      const dl = r.left   - mx;
      const dr = mx - r.right;
      const dt = r.top    - my;
      const db = my - r.bottom;
      const best = Math.max(dl, dr, dt, db);
      if      (best === dl) side = 'left';
      else if (best === dr) side = 'right';
      else if (best === dt) side = 'top';
      else                  side = 'bottom';
    } else {
      // Inside viewport -- check edge zones.
      if      (mx < r.left   + edgeDockPx) side = 'left';
      else if (mx > r.right  - edgeDockPx) side = 'right';
      else if (my < r.top    + edgeDockPx) side = 'top';
      else if (my > r.bottom - edgeDockPx) side = 'bottom';
    }

    if (side) _dockTo(side);
  }

  // Show which dock zone the cursor is in.
  function _updateIndicator(el, mx, my) {
    const PAD = 4;
    const TW  = 36;  // toolbar width  (left/right)
    const TH  = 36;  // toolbar height (top/bottom)

    const body = document.querySelector(edgeDockSelector);
    if (!body) { el.style.display = 'none'; return; }
    const r = body.getBoundingClientRect();

    let side = null;
    if (mx < r.left || mx > r.right || my < r.top || my > r.bottom) {
      const dl = r.left   - mx;
      const dr = mx - r.right;
      const dt = r.top    - my;
      const db = my - r.bottom;
      const best = Math.max(dl, dr, dt, db);
      if      (best === dl) side = 'left';
      else if (best === dr) side = 'right';
      else if (best === dt) side = 'top';
      else                  side = 'bottom';
    } else {
      const Z = edgeDockPx;
      if      (mx < r.left   + Z) side = 'left';
      else if (mx > r.right  - Z) side = 'right';
      else if (my < r.top    + Z) side = 'top';
      else if (my > r.bottom - Z) side = 'bottom';
    }

    if (!side) { el.style.display = 'none'; return; }

    switch (side) {
      case 'left':   _setRect(el, r.left + PAD, r.top + PAD, TW, r.height - PAD * 2); break;
      case 'right':  _setRect(el, r.right - TW - PAD, r.top + PAD, TW, r.height - PAD * 2); break;
      case 'top':    _setRect(el, r.left + PAD, r.top + PAD, r.width - PAD * 2, TH); break;
      case 'bottom': _setRect(el, r.left + PAD, r.bottom - TH - PAD, r.width - PAD * 2, TH); break;
    }
  }

  function _setRect(el, x, y, w, h) {
    el.style.display = 'block';
    el.style.left    = x + 'px';
    el.style.top     = y + 'px';
    el.style.width   = w + 'px';
    el.style.height  = h + 'px';
  }

  // â”€â”€ helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  function _updateBtn() {
    if (floating) {
      btn.innerHTML = SNAPBACK_SVG;
      btn.title = 'Snap back';
      btn.classList.add('is-floating');
    } else {
      btn.innerHTML = FLOAT_SVG;
      btn.title = 'Float bar';
      btn.classList.remove('is-floating');
    }
  }

  // â”€â”€ drag from bar open areas (optional) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  if (dragFromBar) {
    barEl.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || floating) return;
      if (e.target.closest('button')) return;
      e.preventDefault();
      // Delay float until the mouse actually moves > 6 px.
      // Prevents the toolbar from floating on an accidental click,
      // and avoids an instant re-dock-to-same-side on quick release.
      const sx = e.clientX, sy = e.clientY;
      const onDragMove = (mv) => {
        if (Math.hypot(mv.clientX - sx, mv.clientY - sy) < 6) return;
        document.removeEventListener('mousemove', onDragMove);
        document.removeEventListener('mouseup',   onDragCancel);
        _float(sx, sy);
      };
      const onDragCancel = () => {
        document.removeEventListener('mousemove', onDragMove);
        document.removeEventListener('mouseup',   onDragCancel);
      };
      document.addEventListener('mousemove', onDragMove);
      document.addEventListener('mouseup',   onDragCancel);
    });
  }

  return btn;
}

