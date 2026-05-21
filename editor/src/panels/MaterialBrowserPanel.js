import { BasePanel }       from './BasePanel.js';
import { MaterialBrowser } from '../ui/MaterialBrowser.js';

export class MaterialBrowserPanel extends BasePanel {
  constructor() {
    super();
    this._browser = new MaterialBrowser();
  }

  _buildContent() {
    const el = this._browser.element;
    el.style.height = '100%';
    return el;
  }
}
