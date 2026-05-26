/**
 * MaterialBrowser.js
 * Material library panel — category tabs, search, 55 preset cards.
 * Drag a card onto the viewport canvas or click "Apply" to apply it.
 *
 * Events dispatched:
 *   cyco-apply-material  { preset, targetObjects }
 *   cyco-preview-material { preset, targetObjects }   (on hover preview)
 *   cyco-restore-material {}                          (on hover end)
 */

import * as THREE from 'three';
import { MATERIALS, MATERIAL_CATEGORIES, getMaterialsByCategory } from './MaterialLibrary.js';

/** Create a Three.js material from a preset config */
function createMaterialFromPreset(preset) {
  const THREE_TYPES = {
    MeshStandardMaterial: THREE.MeshStandardMaterial,
    MeshPhysicalMaterial: THREE.MeshPhysicalMaterial,
    MeshPhongMaterial:    THREE.MeshPhongMaterial,
    MeshLambertMaterial:  THREE.MeshLambertMaterial,
    MeshToonMaterial:     THREE.MeshToonMaterial,
    MeshBasicMaterial:    THREE.MeshBasicMaterial,
    MeshNormalMaterial:   THREE.MeshNormalMaterial,
    MeshDepthMaterial:    THREE.MeshDepthMaterial,
    MeshMatcapMaterial:   THREE.MeshMatcapMaterial,
    PointsMaterial:       THREE.PointsMaterial,
    ShaderMaterial:       THREE.ShaderMaterial,
  };
  const Ctor = THREE_TYPES[preset.type];
  if (!Ctor) { console.warn(`[MaterialBrowser] Unknown material type: ${preset.type}`); return new THREE.MeshStandardMaterial(); }

  const params = { ...preset.params };

  // Convert hex color strings to THREE.Color
  for (const key of ['color', 'emissive', 'specular', 'sheen', 'sheenColor', 'attenuationColor']) {
    if (typeof params[key] === 'string' && params[key].startsWith('#')) {
      params[key] = new THREE.Color(params[key]);
    }
  }

  return new Ctor(params);
}

export class MaterialBrowser {
  constructor() {
    this._activeCategory = null; // null = "All"
    this._searchQuery    = '';
    this._element        = null;
    this._lastPreset     = null; // currently hovered card
    this._selectedPreset = null; // clicked / drag-started card (persists)
    this._selectedCardEl = null; // DOM element of the selected card

    this._buildElement();
    this._refreshGrid();

    // Update Apply-button state whenever selection changes
    window.addEventListener('cyco-select-node',  () => this._updateApplyBtn());
    window.addEventListener('cyco-deselect-all', () => this._updateApplyBtn());

    // Keep selected card in sync when a drag-drop applies a material
    window.addEventListener('cyco-material-dragged', (e) => {
      const preset = MATERIALS.find(m => m.id === e.detail?.matId);
      if (!preset) return;
      const card = this._grid.querySelector(`[data-mat-id="${preset.id}"]`);
      this._selectCard(preset, card ?? null);
    });
  }

  get element() { return this._element; }

  // ── Build DOM ─────────────────────────────────────────────────────────────

  _buildElement() {
    const root = document.createElement('div');
    root.className = 'mat-browser';
    root.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;background:var(--bg-primary,#1a1a1a);';

    // Search bar
    const searchRow = document.createElement('div');
    searchRow.style.cssText = 'display:flex;align-items:center;gap:5px;padding:5px 8px;border-bottom:1px solid var(--border-color,#333);flex-shrink:0;';

    // Magnifying-glass toggle
    const searchToggle = document.createElement('button');
    searchToggle.innerHTML = '&#128269;';
    searchToggle.title = 'Toggle search';
    searchToggle.style.cssText = 'background:none;border:none;color:var(--text-secondary,#aaa);cursor:pointer;font-size:14px;padding:0 2px;flex-shrink:0;line-height:1;';

    this._searchInput = document.createElement('input');
    this._searchInput.type = 'text';
    this._searchInput.placeholder = 'Search materials…';
    this._searchInput.style.cssText = 'flex:1;background:var(--bg-secondary,#252525);border:1px solid var(--border-color,#333);color:var(--text-primary,#e0e0e0);border-radius:4px;padding:3px 8px;font-size:12px;min-width:0;';
    this._searchInput.addEventListener('input', () => {
      this._searchQuery = this._searchInput.value.toLowerCase();
      this._refreshGrid();
    });

    searchToggle.addEventListener('click', () => {
      const collapsed = this._searchInput.style.display === 'none';
      this._searchInput.style.display = collapsed ? '' : 'none';
      if (collapsed) this._searchInput.focus();
    });

    // "Apply to Object" button — enabled only when a card is selected + object is selected
    this._applyBtn = document.createElement('button');
    this._applyBtn.textContent = 'Apply to Object';
    this._applyBtn.className   = 'ce-btn-small';
    this._applyBtn.title       = 'Click a material card to select it, then click here to apply';
    this._applyBtn.style.cssText = 'flex-shrink:0;opacity:0.4;cursor:not-allowed;white-space:nowrap;';
    this._applyBtn.disabled = true;
    this._applyBtn.addEventListener('click', () => {
      if (this._selectedPreset) this._applyToSelection(this._selectedPreset);
    });

    searchRow.appendChild(searchToggle);
    searchRow.appendChild(this._searchInput);
    searchRow.appendChild(this._applyBtn);

    // Renderer mode badge
    const updateBadge = () => {
      const isWebGPU = window.__cyco?.rendererManager?.activeType === 'webgpu';
      if (!this._rendererBadge) {
        this._rendererBadge = document.createElement('span');
        this._rendererBadge.style.cssText = 'background:#c0392b;color:#fff;font-size:9px;padding:2px 5px;border-radius:3px;flex-shrink:0;font-weight:bold;letter-spacing:0.05em;white-space:nowrap;';
        searchRow.appendChild(this._rendererBadge);
      }
      this._rendererBadge.textContent = isWebGPU ? 'WebGPU' : 'WebGL';
      this._rendererBadge.style.background = isWebGPU ? '#1a6e3c' : '#555';
    };
    updateBadge();
    window.addEventListener('cyco-renderer-changed', updateBadge);

    root.appendChild(searchRow);

    // Category tabs
    const tabs = document.createElement('div');
    tabs.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;padding:4px 8px;border-bottom:1px solid var(--border-color,#333);flex-shrink:0;';

    const allBtn = this._makeTabBtn('All', null, tabs);
    allBtn.classList.add('active');
    this._activeTabEl = allBtn;

    for (const cat of MATERIAL_CATEGORIES) {
      this._makeTabBtn(cat, cat, tabs);
    }
    root.appendChild(tabs);
    this._tabs = tabs;

    // Grid
    this._grid = document.createElement('div');
    this._grid.style.cssText = 'flex:1;overflow-y:auto;padding:8px;display:grid;grid-template-columns:repeat(auto-fill,minmax(88px,1fr));gap:6px;align-content:start;';
    root.appendChild(this._grid);

    this._element = root;

    this._injectStyles();
  }

  _makeTabBtn(label, category, container) {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.dataset.category = category ?? '';
    btn.style.cssText = 'background:var(--bg-secondary,#252525);border:1px solid var(--border-color,#333);color:var(--text-secondary,#aaa);border-radius:4px;padding:2px 8px;font-size:11px;cursor:pointer;white-space:nowrap;';
    btn.addEventListener('click', () => {
      this._activeCategory = category;
      this._activeTabEl?.classList.remove('active');
      btn.classList.add('active');
      this._activeTabEl = btn;
      this._refreshGrid();
    });
    container.appendChild(btn);
    return btn;
  }

  // ── Grid rendering ────────────────────────────────────────────────────────

  _refreshGrid() {
    const filtered = MATERIALS.filter(m => {
      if (this._activeCategory && m.category !== this._activeCategory) return false;
      if (this._searchQuery && !m.name.toLowerCase().includes(this._searchQuery) && !m.category.toLowerCase().includes(this._searchQuery)) return false;
      return true;
    });

    this._grid.innerHTML = '';
    for (const preset of filtered) {
      this._grid.appendChild(this._makeCard(preset));
    }

    // Restore selected card highlight after grid rebuild
    if (this._selectedPreset) {
      const card = this._grid.querySelector(`[data-mat-id="${this._selectedPreset.id}"]`);
      if (card) { card.classList.add('mat-card-selected'); this._selectedCardEl = card; }
      else       { this._selectedCardEl = null; }
    }
  }

  _makeCard(preset) {
    const card = document.createElement('div');
    card.className = 'mat-card';
    card.dataset.matId = preset.id;
    card.title = `${preset.name}\n${preset.category}\n${preset.type}\nDrag onto an object or click to apply`;
    card.draggable = true;
    card.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:3px;padding:5px 3px;border-radius:5px;cursor:grab;border:1px solid transparent;background:var(--bg-secondary,#252525);user-select:none;';

    // Thumbnail sphere
    const thumb = document.createElement('div');
    thumb.style.cssText = `width:56px;height:56px;border-radius:50%;border:1px solid var(--border-color,#333);flex-shrink:0;`;
    this._applyPreviewStyle(thumb, preset);
    card.appendChild(thumb);

    // Name
    const label = document.createElement('div');
    label.textContent = preset.name;
    label.style.cssText = 'font-size:10px;color:var(--text-secondary,#aaa);text-align:center;word-break:break-word;line-height:1.2;max-width:84px;';
    card.appendChild(label);

    // ── Events ──
    card.addEventListener('mouseenter', () => {
      this._lastPreset = preset;
      this._previewOnSelection(preset);
    });
    card.addEventListener('mouseleave', () => this._restoreSelection());
    // Click → select the card (persistent highlight); does NOT immediately apply
    card.addEventListener('click', () => this._selectCard(preset, card));
    card.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this._showContextMenu(preset, e.clientX, e.clientY);
    });

    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/x-cyco-material', preset.id);
      e.dataTransfer.effectAllowed = 'copy';
      // Stop propagation so DockView doesn't treat this as a panel-drag
      e.stopPropagation();
      // Drag also counts as selecting the card
      this._selectCard(preset, card);
    });

    return card;
  }

  _applyPreviewStyle(el, preset) {
    const preview = preset.preview ?? '#888888';
    if (preview.startsWith('linear-gradient') || preview.startsWith('radial-gradient')) {
      el.style.background = preview;
    } else {
      // Draw a fake radial "sphere" shading on solid colors
      const hex = preview;
      el.style.background = `radial-gradient(circle at 35% 35%, ${this._lighten(hex, 0.4)}, ${hex} 55%, ${this._darken(hex, 0.4)})`;
    }
  }

  _lighten(hex, amt) {
    const c = new THREE.Color(hex);
    c.r = Math.min(1, c.r + amt);
    c.g = Math.min(1, c.g + amt);
    c.b = Math.min(1, c.b + amt);
    return `#${c.getHexString()}`;
  }

  _darken(hex, amt) {
    const c = new THREE.Color(hex);
    c.r = Math.max(0, c.r - amt);
    c.g = Math.max(0, c.g - amt);
    c.b = Math.max(0, c.b - amt);
    return `#${c.getHexString()}`;
  }

  // ── Apply / Preview ───────────────────────────────────────────────────────

  _getSelectedMeshes() {
    const sm = window.__cyco?.selectionManager;
    if (!sm) return [];
    return [...sm.selected].filter(o => o.isMesh || o.isSkinnedMesh);
  }

  _applyToSelection(preset) {
    const meshes = this._getSelectedMeshes();
    if (meshes.length === 0) {
      // No selection — briefly highlight the Apply button to indicate nothing is selected
      this._flashNoSelection();
      return;
    }
    window.dispatchEvent(new CustomEvent('cyco-apply-material', {
      detail: { preset, targetObjects: meshes }
    }));
  }

  _previewOnSelection(preset) {
    const meshes = this._getSelectedMeshes();
    if (meshes.length === 0) return;
    window.dispatchEvent(new CustomEvent('cyco-preview-material', {
      detail: { preset, targetObjects: meshes }
    }));
  }

  _restoreSelection() {
    window.dispatchEvent(new CustomEvent('cyco-restore-material'));
  }

  _flashNoSelection() {
    const old = this._grid.style.outline;
    this._grid.style.outline = '2px solid #e06030';
    setTimeout(() => { this._grid.style.outline = old; }, 600);
  }

  // ── Card selection (persistent) ───────────────────────────────────────────

  _selectCard(preset, cardEl) {
    // Remove highlight from previous selection
    this._selectedCardEl?.classList.remove('mat-card-selected');
    this._selectedPreset = preset;
    this._selectedCardEl = cardEl;
    cardEl?.classList.add('mat-card-selected');
    this._updateApplyBtn();
  }

  // ── Apply-button state ────────────────────────────────────────────────────

  _updateApplyBtn() {
    if (!this._applyBtn) return;
    const enabled = !!this._selectedPreset && this._getSelectedMeshes().length > 0;
    this._applyBtn.disabled        = !enabled;
    this._applyBtn.style.opacity   = enabled ? '1' : '0.4';
    this._applyBtn.style.cursor    = enabled ? 'pointer' : 'not-allowed';
  }

  // ── Context menu ──────────────────────────────────────────────────────────

  _showContextMenu(preset, x, y) {
    document.getElementById('mat-ctx-menu')?.remove();

    const menu = document.createElement('div');
    menu.id = 'mat-ctx-menu';
    menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;background:var(--bg-secondary,#252525);border:1px solid var(--border-color,#444);border-radius:5px;padding:4px 0;z-index:99999;min-width:150px;box-shadow:0 4px 16px rgba(0,0,0,0.5);`;

    const hasSel = this._getSelectedMeshes().length > 0;
    const item   = document.createElement('div');
    item.textContent    = 'Apply to Object';
    item.style.cssText  = `padding:7px 14px;font-size:12px;white-space:nowrap;cursor:${hasSel ? 'pointer' : 'default'};color:${hasSel ? 'var(--text-primary,#e0e0e0)' : 'var(--text-disabled,#666)'};`;
    if (hasSel) {
      item.addEventListener('mouseenter', () => { item.style.background = 'var(--accent-color,#4488ff)'; item.style.color = '#fff'; });
      item.addEventListener('mouseleave', () => { item.style.background = ''; item.style.color = ''; });
      item.addEventListener('click', (e) => { e.stopPropagation(); menu.remove(); this._applyToSelection(preset); });
    }
    menu.appendChild(item);
    document.body.appendChild(menu);

    // Dismiss when clicking outside
    const dismiss = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('mousedown', dismiss, true); } };
    setTimeout(() => document.addEventListener('mousedown', dismiss, true), 0);

    // Keep menu inside viewport
    requestAnimationFrame(() => {
      const r = menu.getBoundingClientRect();
      if (r.right  > window.innerWidth)  menu.style.left = `${x - r.width}px`;
      if (r.bottom > window.innerHeight) menu.style.top  = `${y - r.height}px`;
    });
  }

  // ── Styles ────────────────────────────────────────────────────────────────

  _injectStyles() {
    if (document.getElementById('mat-browser-styles')) return;
    const style = document.createElement('style');
    style.id = 'mat-browser-styles';
    style.textContent = `
      .mat-card:hover {
        border-color: var(--accent-color, #4488ff) !important;
        background: var(--bg-hover, #2a2a2a) !important;
      }
      .mat-card:active { cursor: grabbing; }
      .mat-card-selected {
        border-color: var(--accent-color, #4488ff) !important;
        background: var(--bg-hover, #2e2e3a) !important;
        outline: 2px solid var(--accent-color, #4488ff);
        outline-offset: -1px;
      }
      button[data-category].active {
        background: var(--accent-color, #4488ff) !important;
        color: #fff !important;
        border-color: var(--accent-color, #4488ff) !important;
      }
    `;
    document.head.appendChild(style);
  }
}

// ── Drag-and-drop onto viewport canvas ────────────────────────────────────────
// Listens for drops on both the WebGL canvas AND the viewport container div
// so that drops work even when DockView overlays are stacked on top.
(function setupCanvasDrop() {
  function _raycastHit(e, canvasEl) {
    const ve = window.__cyco?.viewportEngine;
    if (!ve) return null;
    const rect = canvasEl.getBoundingClientRect();
    const ndcX = ((e.clientX - rect.left) / rect.width)  * 2 - 1;
    const ndcY = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), ve.camera);
    const hits = raycaster.intersectObjects(ve.scene.children, true)
      .filter(h => !h.object.userData._isGizmo && (h.object.isMesh || h.object.isSkinnedMesh));
    return hits.length > 0 ? hits[0].object : null;
  }

  function _applyDrop(e, canvasEl) {
    const matId = e.dataTransfer.getData('application/x-cyco-material');
    if (!matId) return;
    e.preventDefault();

    // Clear drag hover highlight
    window.dispatchEvent(new CustomEvent('cyco-hover-object', { detail: { object: null } }));

    const preset = MATERIALS.find(m => m.id === matId);
    if (!preset) return;

    const hit = _raycastHit(e, canvasEl);

    // If objects are selected, ALWAYS apply to selection.
    // Only fall back to raycast hit when nothing is selected.
    const sm = window.__cyco?.selectionManager;
    const selectedMeshes = sm ? [...sm.selected].filter(o => o.isMesh || o.isSkinnedMesh) : [];
    const targetObjects = selectedMeshes.length > 0
      ? selectedMeshes
      : hit ? [hit] : [];
    if (targetObjects.length > 0) {
      window.dispatchEvent(new CustomEvent('cyco-apply-material', {
        detail: { preset, targetObjects }
      }));
      // Notify MaterialBrowser that this preset was applied via drag
      window.dispatchEvent(new CustomEvent('cyco-material-dragged', { detail: { matId: preset.id } }));
    }
  }

  function _bindDropTarget(el, canvasEl) {
    if (!el || el.dataset.cycoDropBound) return;
    el.dataset.cycoDropBound = '1';
    el.addEventListener('dragover', (e) => {
      if (!e.dataTransfer.types.includes('application/x-cyco-material')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      // Show hover highlight on the object under the cursor during drag
      const sm = window.__cyco?.selectionManager;
      const selected = sm ? [...sm.selected] : [];
      if (selected.length === 0) {
        // Only show drag-hover when nothing is selected (selection takes priority)
        const hit = _raycastHit(e, canvasEl);
        window.dispatchEvent(new CustomEvent('cyco-hover-object', { detail: { object: hit } }));
      }
    });
    el.addEventListener('dragleave', () => {
      window.dispatchEvent(new CustomEvent('cyco-hover-object', { detail: { object: null } }));
    });
    el.addEventListener('drop', (e) => _applyDrop(e, canvasEl));
  }

  function _bindCanvasDrop(canvas) {
    _bindDropTarget(canvas, canvas);
    const container = document.getElementById('cyco-viewport-canvas');
    if (container) _bindDropTarget(container, canvas);
  }

  window.addEventListener('cyco-vp-ready', () => {
    const canvas = window.__cyco?.rendererManager?.renderer?.domElement;
    if (!canvas) return;
    _bindCanvasDrop(canvas);
  });

  window.addEventListener('cyco-renderer-changed', (e) => {
    const canvas = e.detail?.renderer?.domElement;
    if (canvas) _bindCanvasDrop(canvas);
  });

  // cyco-viewport-container-ready fires while ViewportEngine._onContainerReady is on
  // the call stack — by the time OUR listener runs, ViewportEngine has already called
  // init() and the canvas exists.  We can therefore bind both targets immediately.
  window.addEventListener('cyco-viewport-container-ready', (e) => {
    const container = e.detail?.container;
    if (!container) return;
    const canvas = window.__cyco?.rendererManager?.renderer?.domElement;
    if (canvas) {
      _bindDropTarget(canvas, canvas);
      _bindDropTarget(container, canvas);
    }
  });

  // If the viewport is already ready when this module loads, bind immediately.
  if (window.__cyco?.rendererManager?.renderer?.domElement) {
    _bindCanvasDrop(window.__cyco.rendererManager.renderer.domElement);
  }
})();

export { createMaterialFromPreset };
