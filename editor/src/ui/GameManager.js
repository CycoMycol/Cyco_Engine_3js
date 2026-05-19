/**
 * GameManager.js — singleton entry point for the Game Manager overlay.
 * Lazily creates the GameManagerWindow on first open.
 */

import { GameManagerWindow } from './GameManagerWindow.js';

const GameManager = {
  _window: null,

  open() {
    if (!this._window) {
      this._window = new GameManagerWindow();
      this._window._onClose = () => this.close();
      document.body.appendChild(this._window.element);
    } else {
      // Reload data each time GM is re-opened (project may have changed while closed)
      this._window.reload();
    }
    this._window.show();
  },

  close() {
    this._window?.hide();
  },

  isOpen() {
    return !!this._window && !this._window.element.classList.contains('is-hidden');
  },
};

// Reload data when the active project changes
document.addEventListener('cyco-project-change', () => {
  if (GameManager.isOpen()) {
    GameManager._window.reload();
  }
});

export default GameManager;
