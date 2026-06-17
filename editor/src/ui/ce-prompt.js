/**
 * cePrompt(message, placeholder?) → Promise<string|null>
 * Replacement for window.prompt() — works inside sandboxed iframes
 * (VS Code Live Preview blocks the native dialog).
 */
export function cePrompt(message, placeholder = '') {
  return new Promise((resolve) => {
    // ── Build dialog ──────────────────────────────────────────────────────
    const dlg = document.createElement('dialog');
    dlg.className = 'ce-mini-dialog';
    dlg.innerHTML = `
      <div class="ce-mini-msg">${_esc(message)}</div>
      <input class="ce-mini-input" type="text" placeholder="${_esc(placeholder)}" autocomplete="off" spellcheck="false" />
      <div class="ce-mini-actions">
        <button class="ce-btn ghost ce-mini-cancel">Cancel</button>
        <button class="ce-btn primary ce-mini-ok">OK</button>
      </div>
    `;
    document.body.appendChild(dlg);

    const input  = dlg.querySelector('.ce-mini-input');
    const okBtn  = dlg.querySelector('.ce-mini-ok');
    const cancel = dlg.querySelector('.ce-mini-cancel');

    function confirm() {
      const val = input.value.trim();
      dlg.close();
      dlg.remove();
      resolve(val || null);
    }
    function dismiss() {
      dlg.close();
      dlg.remove();
      resolve(null);
    }

    okBtn.addEventListener('click', confirm);
    cancel.addEventListener('click', dismiss);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter')  confirm();
      if (e.key === 'Escape') dismiss();
    });
    // Backdrop click
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dismiss(); });

    dlg.showModal();
    input.focus();
  });
}

function _esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
}

/**
 * ceConfirm(message, { okLabel = 'OK', cancelLabel = 'Cancel', danger = false } = {})
 *   → Promise<boolean>
 * Replacement for window.confirm() — works inside sandboxed iframes
 * (VS Code Live Preview blocks the native dialog). `danger: true` renders
 * the OK button in destructive style.
 */
export function ceConfirm(message, { okLabel = 'OK', cancelLabel = 'Cancel', danger = false } = {}) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'ce-mini-dialog';
    dlg.innerHTML = `
      <div class="ce-mini-msg">${_esc(message)}</div>
      <div class="ce-mini-actions">
        <button class="ce-btn ghost ce-mini-cancel">${_esc(cancelLabel)}</button>
        <button class="ce-btn ${danger ? 'danger' : 'primary'} ce-mini-ok">${_esc(okLabel)}</button>
      </div>
    `;
    document.body.appendChild(dlg);

    const okBtn  = dlg.querySelector('.ce-mini-ok');
    const cancel = dlg.querySelector('.ce-mini-cancel');

    function accept()  { dlg.close(); dlg.remove(); resolve(true);  }
    function dismiss() { dlg.close(); dlg.remove(); resolve(false); }

    okBtn.addEventListener('click', accept);
    cancel.addEventListener('click', dismiss);
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dismiss(); });
    dlg.addEventListener('keydown', (e) => {
      if (e.key === 'Enter')  accept();
      if (e.key === 'Escape') dismiss();
    });

    dlg.showModal();
    okBtn.focus();
  });
}
