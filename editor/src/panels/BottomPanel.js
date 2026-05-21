import { BasePanel }    from './BasePanel.js';
import { AssetBrowser } from '../ui/AssetBrowser.js';

export class BottomPanel extends BasePanel {
  constructor() {
    super();
    this._assetBrowser = new AssetBrowser();
  }

  _buildContent() {
    const el = this._assetBrowser.element;
    el.style.height = '100%';
    return el;
  }
}
