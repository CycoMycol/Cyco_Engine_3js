import { BasePanel }      from './BasePanel.js';
import { AssetBrowser }   from '../ui/AssetBrowser.js';
import { MaterialBrowser } from '../ui/MaterialBrowser.js';

export class BottomPanel extends BasePanel {
  constructor() {
    super();
    this._assetBrowser    = new AssetBrowser();
    this._materialBrowser = new MaterialBrowser();
    this._activeTab       = 'assets';
  }

  _buildContent() {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;';

    // ── Tab bar ──
    const tabBar = document.createElement('div');
    tabBar.style.cssText = 'display:flex;align-items:center;gap:2px;padding:0 8px;height:28px;border-bottom:1px solid var(--border-color,#333);background:var(--bg-secondary,#252525);flex-shrink:0;';

    const tabs = [
      { id: 'assets',    label: 'Assets' },
      { id: 'materials', label: 'Materials' },
    ];

    for (const tab of tabs) {
      const btn = document.createElement('button');
      btn.textContent = tab.label;
      btn.dataset.tabId = tab.id;
      btn.style.cssText = 'background:none;border:none;color:var(--text-secondary,#aaa);padding:0 10px;height:100%;cursor:pointer;font-size:12px;border-bottom:2px solid transparent;margin-bottom:-1px;';
      if (tab.id === this._activeTab) {
        btn.style.color = 'var(--text-primary,#e0e0e0)';
        btn.style.borderBottomColor = 'var(--accent-color,#4488ff)';
      }
      btn.addEventListener('click', () => this._switchTab(tab.id, tabBar, contentArea));
      tabBar.appendChild(btn);
    }

    // ── Content area ──
    const contentArea = document.createElement('div');
    contentArea.style.cssText = 'flex:1;overflow:hidden;position:relative;';

    this._assetBrowser.element.style.cssText    += ';height:100%;';
    this._materialBrowser.element.style.cssText += ';height:100%;display:none;';

    contentArea.appendChild(this._assetBrowser.element);
    contentArea.appendChild(this._materialBrowser.element);

    wrap.appendChild(tabBar);
    wrap.appendChild(contentArea);
    return wrap;
  }

  _switchTab(tabId, tabBar, contentArea) {
    this._activeTab = tabId;
    // Update tab button styles
    for (const btn of tabBar.querySelectorAll('button[data-tab-id]')) {
      const active = btn.dataset.tabId === tabId;
      btn.style.color = active ? 'var(--text-primary,#e0e0e0)' : 'var(--text-secondary,#aaa)';
      btn.style.borderBottomColor = active ? 'var(--accent-color,#4488ff)' : 'transparent';
    }
    // Show/hide panels
    this._assetBrowser.element.style.display    = tabId === 'assets'    ? '' : 'none';
    this._materialBrowser.element.style.display = tabId === 'materials' ? '' : 'none';
  }
}
