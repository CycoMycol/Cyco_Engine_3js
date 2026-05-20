/**
 * FloatBar.js — adds a float/dock toggle button to any toolbar or menu bar.
 *
 * Usage: append the returned button wherever you want it in the bar.
 *   const floatBtn = makeFloatable(barElement);
 *   rightSection.appendChild(floatBtn);
 *
 * When floated the bar is lifted into a draggable floating window.
 * A comment-node placeholder keeps its original DOM slot so it snaps
 * back exactly where it came from.
 */

// "Pop out" — bar is docked, click to float
export const FLOAT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="7" height="7" rx="1"/><polyline points="4,1 10,1 10,7"/></svg>`;

// "Push in" — bar is floating, click to snap back
export const SNAPBACK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="1" width="7" height="7" rx="1"/><polyline points="7,10 1,10 1,4"/></svg>`;

/**
 * @param {HTMLElement} barEl — the bar element to make floatable.
 * @returns {HTMLButtonElement} — toggle button; append it anywhere inside barEl.
 */
export function makeFloatable(barEl) {
  let floating    = false;
  let floatWin    = null;
  let placeholder = null;

  const btn = document.createElement('button');
  btn.className = 'ce-bar-float-btn';
  _updateBtn();

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    floating ? _dock() : _float();
  });

  // ── float ────────────────────────────────────────────────────────────────

  function _float() {
    // Drop a comment node to remember the original position.
    placeholder = document.createComment('ce-bar-float-placeholder');
    barEl.parentNode.insertBefore(placeholder, barEl);

    // Measure before detaching so we can open near the original location.
    const rect = barEl.getBoundingClientRect();

    // Build the floating window.
    floatWin = document.createElement('div');
    floatWin.className = 'ce-bar-float-window';
    floatWin.style.left = rect.left + 'px';
    floatWin.style.top  = rect.top  + 'px';

    const grip = document.createElement('div');
    grip.className = 'ce-bar-float-grip';
    _makeDraggable(floatWin, grip);

    floatWin.appendChild(grip);
    floatWin.appendChild(barEl);
    document.body.appendChild(floatWin);

    floating = true;
    _updateBtn();
  }

  // ── dock back ─────────────────────────────────────────────────────────────

  function _dock() {
    if (!floatWin || !placeholder) return;

    // Replace the comment placeholder with the bar element.
    placeholder.parentNode.replaceChild(barEl, placeholder);
    placeholder = null;

    floatWin.remove();
    floatWin = null;

    floating = false;
    _updateBtn();
  }

  // ── drag ─────────────────────────────────────────────────────────────────

  function _makeDraggable(win, handle) {
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      // Use getBoundingClientRect() so the offset is always in viewport
      // coordinates — offsetLeft/offsetTop are unreliable for position:fixed
      // elements and cause the window to jump away from the cursor.
      const rect = win.getBoundingClientRect();
      const ox = e.clientX - rect.left;
      const oy = e.clientY - rect.top;

      const onMove = (mv) => {
        // Clamp to viewport so the grip never goes fully off-screen.
        const maxX = window.innerWidth  - win.offsetWidth;
        const maxY = window.innerHeight - win.offsetHeight;
        win.style.left = Math.max(0, Math.min(mv.clientX - ox, maxX)) + 'px';
        win.style.top  = Math.max(0, Math.min(mv.clientY - oy, maxY)) + 'px';
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup',   onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup',   onUp);
    });
  }

  // ── helpers ───────────────────────────────────────────────────────────────

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

  return btn;
}
