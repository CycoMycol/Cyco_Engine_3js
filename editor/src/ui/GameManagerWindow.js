/**
 * GameManagerWindow.js — full-screen modal shell for the Game Manager.
 * UE-style layout: module tabs → body (sidebar + list/form split).
 */

import { InventoryModule } from './game-manager/InventoryModule.js';
import { StatsModule }     from './game-manager/StatsModule.js';
import { QuestsModule }    from './game-manager/QuestsModule.js';
import { ShopModule }      from './game-manager/ShopModule.js';

const MODULE_DEFS = [
  { key: 'inventory', label: 'Inventory', Ctor: InventoryModule },
  { key: 'stats',     label: 'Stats',     Ctor: StatsModule     },
  { key: 'quests',    label: 'Quests',    Ctor: QuestsModule    },
  { key: 'shop',      label: 'Shop & Trade', Ctor: ShopModule   },
];

export class GameManagerWindow {
  constructor() {
    this._activeModuleKey = 'inventory';
    this._modules = {};     // key → module instance (lazy)
    this._onClose = null;   // set by GameManager

    this._el = this._build();
    this._activateModule('inventory');

    this._keyHandler = (e) => {
      if (e.key === 'Escape') this._onClose?.();
    };
  }

  get element() { return this._el; }

  // ── Build DOM ───────────────────────────────────────────────────────────────

  _build() {
    // Overlay backdrop
    const overlay = document.createElement('div');
    overlay.className = 'ce-gm-overlay is-hidden';

    // Window panel
    const win = document.createElement('div');
    win.className = 'ce-gm-window';

    win.appendChild(this._buildHeader());
    win.appendChild(this._buildModuleTabs());

    this._body = document.createElement('div');
    this._body.className = 'ce-gm-body';
    win.appendChild(this._body);

    overlay.appendChild(win);
    this._overlay = overlay;
    return overlay;
  }

  _buildHeader() {
    const header = document.createElement('div');
    header.className = 'ce-gm-header';

    const title = document.createElement('span');
    title.className = 'ce-gm-title';
    title.textContent = 'Game Manager';

    const spacer = document.createElement('span');
    spacer.className = 'ce-gm-header-spacer';

    const closeBtn = document.createElement('button');
    closeBtn.className = 'ce-gm-close-btn';
    closeBtn.textContent = '×';
    closeBtn.title = 'Close (Escape)';
    closeBtn.addEventListener('click', () => this._onClose?.());

    header.appendChild(title);
    header.appendChild(spacer);
    header.appendChild(closeBtn);
    return header;
  }

  _buildModuleTabs() {
    const tabBar = document.createElement('div');
    tabBar.className = 'ce-gm-module-tabs';

    for (const def of MODULE_DEFS) {
      const tab = document.createElement('div');
      tab.className = 'ce-gm-module-tab';
      tab.textContent = def.label;
      tab.dataset.key = def.key;
      tab.addEventListener('click', () => this._activateModule(def.key));
      tabBar.appendChild(tab);
    }

    this._tabBar = tabBar;
    return tabBar;
  }

  // ── Module activation ───────────────────────────────────────────────────────

  _activateModule(key) {
    this._activeModuleKey = key;

    // Update tab highlights
    for (const tab of this._tabBar.querySelectorAll('.ce-gm-module-tab')) {
      tab.classList.toggle('is-active', tab.dataset.key === key);
    }

    // Lazy-init module
    if (!this._modules[key]) {
      const def = MODULE_DEFS.find(d => d.key === key);
      this._modules[key] = new def.Ctor();
    }

    // Swap module into body
    this._body.innerHTML = '';
    this._body.appendChild(this._modules[key].element);
  }

  // ── Show / hide ─────────────────────────────────────────────────────────────

  show() {
    this._overlay.classList.remove('is-hidden');
    document.addEventListener('keydown', this._keyHandler);
  }

  hide() {
    this._overlay.classList.add('is-hidden');
    document.removeEventListener('keydown', this._keyHandler);
  }

  /** Reload all module data (called on project change). */
  reload() {
    for (const mod of Object.values(this._modules)) {
      mod.reload?.();
    }
  }
}
