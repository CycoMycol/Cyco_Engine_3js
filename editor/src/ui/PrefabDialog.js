/**
 * PrefabDialog.js
 *
 * Inline dialog that asks the user to name a new prefab. Modeled on the same
 * <dialog> + .ce-mini-dialog class used by ce-prompt.js, but with a richer
 * header (so the user can see what's being saved) and a hint about the
 * prefabs/ folder.
 */

/**
 * @param {string}   suggested  Default name to pre-fill.
 * @param {function} onConfirm  Called with the trimmed name (string) on OK.
 *                               Called with null on Cancel / Escape.
 */
export function openPrefabDialog(suggested, onConfirm) {
  if (typeof onConfirm !== 'function') return;
  const safeSuggested = (suggested || 'New Prefab').toString();

  const dlg = document.createElement('dialog');
  dlg.className = 'ce-mini-dialog ce-prefab-dialog';
  dlg.innerHTML = `
    <div class="ce-mini-msg">
      <div class="ce-prefab-dialog-title">Create Prefab</div>
      <div class="ce-prefab-dialog-sub">
        The selected objects will be saved as a reusable template
        in this project's <code>prefabs/</code> folder.
      </div>
    </div>
    <input class="ce-mini-input ce-prefab-dialog-input" type="text"
           placeholder="Prefab name"
           autocomplete="off" spellcheck="false" />
    <div class="ce-prefab-dialog-hint">
      The file will be saved as <span class="ce-prefab-dialog-filename"></span>
    </div>
    <div class="ce-mini-actions">
      <button class="ce-btn ghost ce-mini-cancel">Cancel</button>
      <button class="ce-btn primary ce-mini-ok">Create</button>
    </div>
  `;
  document.body.appendChild(dlg);

  const input    = dlg.querySelector('.ce-prefab-dialog-input');
  const filename = dlg.querySelector('.ce-prefab-dialog-filename');
  const okBtn    = dlg.querySelector('.ce-mini-ok');
  const cancel   = dlg.querySelector('.ce-mini-cancel');

  function _sanitize(name) {
    return String(name || '').trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  }
  function _updatePreview() {
    filename.textContent = `${_sanitize(input.value) || 'NewPrefab'}.cyprefab`;
  }

  function confirm() {
    const raw = _sanitize(input.value);
    if (!raw) { dismiss(); return; }
    dlg.close();
    dlg.remove();
    onConfirm(raw);
  }
  function dismiss() {
    dlg.close();
    dlg.remove();
    onConfirm(null);
  }

  okBtn.addEventListener('click', confirm);
  cancel.addEventListener('click', dismiss);
  input.addEventListener('input', _updatePreview);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter')  { e.preventDefault(); confirm(); }
    if (e.key === 'Escape') { e.preventDefault(); dismiss(); }
  });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dismiss(); });

  dlg.showModal();
  input.value = safeSuggested;
  _updatePreview();
  // Select the base name (everything before the last space + "Prefab") so the
  // user can quickly retype. Falls back to select-all.
  try {
    const idx = safeSuggested.lastIndexOf(' ');
    if (idx > 0) input.setSelectionRange(0, idx);
    else input.select();
  } catch (_) { input.select(); }
  input.focus();
}
