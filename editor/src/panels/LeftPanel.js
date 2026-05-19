import { BasePanel } from './BasePanel.js';

export class LeftPanel extends BasePanel {
  _buildContent() {
    const wrap = document.createElement('div');
    wrap.className = 'ce-panel-content';
    wrap.style.cssText = 'padding:8px;';
    const label = document.createElement('div');
    label.className = 'ce-panel-label';
    label.textContent = 'Scene Hierarchy';
    wrap.appendChild(label);
    return wrap;
  }
}
