import { BasePanel }    from './BasePanel.js';
import { AssetBrowser } from '../ui/AssetBrowser.js';

export class BottomPanel extends BasePanel {
  constructor() {
    super();
    this._assetBrowser = new AssetBrowser();
  }

  init(params) {
    super.init(params);
    // Remove the default minimum-height floor so the panel can be dragged down
    // to just the dockview tab bar (~26 px) and also so _applyGridSizes can
    // restore any previously-saved small size after a page refresh.
    params.api.group.api.setConstraints({ minimumHeight: 0 });
  }

  _buildContent() {
    const el = this._assetBrowser.element;
    el.style.height = '100%';
    return el;
  }
}
