import { BasePanel } from './BasePanel.js';
import { ComponentPicker, COMPONENT_TABS } from '../ui/ComponentPicker.js';

export class ComponentPickerPanel extends BasePanel {
  constructor() {
    super();
    this._activeTab = '3d';
    this._activeGroup = 'physics';
    this._searchTerm = '';
    this._tabStrip = null;
    this._categoryStrip = null;
    this._listArea = null;
    this._searchInput = null;
  }

  get _floatDimensions() {
    return { width: 280, height: 360 };
  }

  init(params) {
    super.init(params);
    requestAnimationFrame(() => {
      const tab = this._findTabElement(params.api);
      if (tab) tab.classList.add('ce-component-picker-tab');
    });
  }

  _buildContent() {
    const root = document.createElement('div');
    root.style.cssText =
      'height:100%;display:flex;flex-direction:column;overflow:hidden;' +
      'font-size:var(--ce-font-size-base);color:var(--ce-text-primary);' +
      'background:var(--ce-bg-panel);';

    const searchRow = document.createElement('div');
    searchRow.style.cssText = 'padding:10px 12px 8px;flex-shrink:0;';
    this._searchInput = document.createElement('input');
    this._searchInput.type = 'text';
    this._searchInput.placeholder = 'Search components…';
    this._searchInput.style.cssText =
      'width:100%;height:28px;padding:0 10px;border-radius:10px;' +
      'border:1px solid var(--ce-border);background:var(--ce-bg-panel);' +
      'color:var(--ce-text-primary);font-size:var(--ce-font-size-menu);' +
      'outline:none;';
    this._searchInput.addEventListener('input', () => {
      this._searchTerm = this._searchInput.value;
      this._renderList();
    });
    searchRow.appendChild(this._searchInput);
    root.appendChild(searchRow);

    this._tabStrip = document.createElement('div');
    this._tabStrip.style.cssText =
      'display:flex;flex-wrap:wrap;gap:6px;padding:0 12px 6px;flex-shrink:0;';
    root.appendChild(this._tabStrip);

    this._categoryStrip = document.createElement('div');
    this._categoryStrip.style.cssText =
      'display:flex;flex-wrap:wrap;gap:6px;padding:0 12px 10px;flex-shrink:0;';
    root.appendChild(this._categoryStrip);

    this._listArea = document.createElement('div');
    this._listArea.style.cssText =
      'flex:1;overflow-y:auto;padding:4px 12px 12px;background:var(--ce-bg-panel);';
    root.appendChild(this._listArea);

    this._renderTabs();
    this._renderCategories();
    this._renderList();

    requestAnimationFrame(() => this._searchInput.focus());
    return root;
  }

  _renderTabs() {
    this._tabStrip.innerHTML = '';
    COMPONENT_TABS.forEach((tab) => {
      const selected = tab.id === this._activeTab;
      const btn = this._createButton(tab.label, selected);
      btn.addEventListener('click', () => {
        if (this._activeTab === tab.id) return;
        this._activeTab = tab.id;
        this._activeGroup = tab.groups[0]?.id;
        this._renderTabs();
        this._renderCategories();
        this._renderList();
      });
      this._tabStrip.appendChild(btn);
    });
  }

  _renderCategories() {
    this._categoryStrip.innerHTML = '';
    const tab = COMPONENT_TABS.find((t) => t.id === this._activeTab) ?? COMPONENT_TABS[0];
    if (!tab || !tab.groups || tab.groups.length <= 1) {
      this._categoryStrip.style.display = 'none';
      return;
    }
    this._categoryStrip.style.display = 'flex';
    tab.groups.forEach((group) => {
      const selected = group.id === this._activeGroup;
      const btn = this._createButton(group.label, selected);
      btn.addEventListener('click', () => {
        if (this._activeGroup === group.id) return;
        this._activeGroup = group.id;
        this._renderCategories();
        this._renderList();
      });
      this._categoryStrip.appendChild(btn);
    });
  }

  _createButton(label, selected) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.style.cssText = `
      display:inline-flex;align-items:center;justify-content:center;
      min-width:0;height:24px;padding:0 10px;font-size:var(--ce-font-size-menu);
      border-radius:12px;border:1px solid ${selected ? 'rgba(224,114,40,0.65)' : 'transparent'};
      background:${selected ? 'rgba(224,114,40,0.14)' : 'var(--ce-bg-surface)'};
      color:${selected ? 'var(--ce-accent-orange)' : 'var(--ce-text-primary)'};
      font-weight:500;cursor:pointer;transition:background .15s,border-color .15s,color .15s;
    `;
    btn.addEventListener('mouseenter', () => {
      if (!selected) btn.style.background = 'rgba(224,114,40,0.08)';
    });
    btn.addEventListener('mouseleave', () => {
      if (!selected) btn.style.background = 'var(--ce-bg-surface)';
    });
    return btn;
  }

  _renderList() {
    this._listArea.innerHTML = '';
    const tab = COMPONENT_TABS.find((t) => t.id === this._activeTab) ?? COMPONENT_TABS[0];
    const group = tab.groups.find((g) => g.id === this._activeGroup) ?? tab.groups[0];
    const query = this._searchTerm.trim().toLowerCase();

    if (!group) {
      const notice = document.createElement('div');
      notice.textContent = 'No components available.';
      notice.style.cssText = 'padding:12px;color:var(--ce-text-muted);font-size:var(--ce-font-size-menu);';
      this._listArea.appendChild(notice);
      return;
    }

    const matches = group.components.filter((c) => {
      const text = `${c.type} ${c.desc || ''}`.toLowerCase();
      return !query || text.includes(query);
    });

    if (!matches.length) {
      const empty = document.createElement('div');
      empty.textContent = 'No components found.';
      empty.style.cssText = 'padding:12px;color:var(--ce-text-muted);font-size:var(--ce-font-size-menu);';
      this._listArea.appendChild(empty);
      return;
    }

    matches.forEach((c) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.style.cssText = `
        width:100%;text-align:left;padding:10px 12px;
        background:transparent;border:none;border-bottom:1px solid var(--ce-border);
        cursor:pointer;display:flex;flex-direction:column;gap:3px;
        color:var(--ce-text-primary);font-size:var(--ce-font-size-base);
      `;
      item.addEventListener('mouseenter', () => item.style.background = 'var(--ce-bg-surface)');
      item.addEventListener('mouseleave', () => item.style.background = 'transparent');
      item.addEventListener('click', () => this._selectComponent(c.type));

      const name = document.createElement('span');
      name.textContent = c.type;
      name.style.cssText = 'font-size:var(--ce-font-size-base);font-weight:500;color:var(--ce-text-primary);';

      const desc = document.createElement('span');
      desc.textContent = c.desc;
      desc.style.cssText = 'font-size:var(--ce-font-size-sm);color:var(--ce-text-muted);';

      item.appendChild(name);
      item.appendChild(desc);
      this._listArea.appendChild(item);
    });
  }

  _selectComponent(type) {
    ComponentPicker._fireSelect(type);
    const panel = window.__cyco?.dockviewApi?.getPanel('component-picker');
    if (panel) panel.api.close();
  }
}
