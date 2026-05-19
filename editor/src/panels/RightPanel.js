import { BasePanel } from './BasePanel.js';

export class RightPanel extends BasePanel {
  _buildContent() {
    const wrap = document.createElement('div');
    wrap.className = 'ce-panel-content';
    wrap.style.cssText = 'padding:8px;';
    const label = document.createElement('div');
    label.className = 'ce-panel-label';
    label.textContent = 'Properties';
    wrap.appendChild(label);
    return wrap;
  }
}
