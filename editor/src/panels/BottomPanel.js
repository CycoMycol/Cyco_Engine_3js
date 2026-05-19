import { BasePanel }   from './BasePanel.js';
import { AssetBrowser } from '../ui/AssetBrowser.js';

export class BottomPanel extends BasePanel {
  constructor() {
    super();
    this._assetBrowser = new AssetBrowser();
  }

  _buildContent() {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;';
    wrap.appendChild(this._assetBrowser.element);
    return wrap;
  }
}
