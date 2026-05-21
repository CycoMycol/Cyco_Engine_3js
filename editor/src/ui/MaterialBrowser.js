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

    this._buildElement();
    this._refreshGrid();
  }

  get element() { return this._element; }

  // ── Build DOM ─────────────────────────────────────────────────────────────

  _buildElement() {
    const root = document.createElement('div');
    root.className = 'mat-browser';
    root.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;background:var(--bg-primary,#1a1a1a);';

    // Search bar
    const searchRow = document.createElement('div');
    searchRow.style.cssText = 'display:flex;gap:6px;padding:6px 8px;border-bottom:1px solid var(--border-color,#333);flex-shrink:0;';

    this._searchInput = document.createElement('input');
    this._searchInput.type = 'text';
    this._searchInput.placeholder = 'Search materials…';
    this._searchInput.style.cssText = 'flex:1;background:var(--bg-secondary,#252525);border:1px solid var(--border-color,#333);color:var(--text-primary,#e0e0e0);border-radius:4px;padding:3px 8px;font-size:12px;';
    this._searchInput.addEventListener('input', () => {
      this._searchQuery = this._searchInput.value.toLowerCase();
      this._refreshGrid();
    });

    searchRow.appendChild(this._searchInput);
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
    card.addEventListener('mouseenter', () => this._previewOnSelection(preset));
    card.addEventListener('mouseleave', () => this._restoreSelection());
    card.addEventListener('click',      () => this._applyToSelection(preset));

    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/x-cyco-material', preset.id);
      e.dataTransfer.effectAllowed = 'copy';
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
// Listen for drops on the canvas; resolve material id → apply to hit object
(function setupCanvasDrop() {
  window.addEventListener('cyco-vp-ready', () => {
    const canvas = window.__cyco?.rendererManager?.renderer?.domElement;
    if (!canvas) return;
    _bindCanvasDrop(canvas);
  });

  window.addEventListener('cyco-renderer-changed', (e) => {
    const canvas = e.detail?.renderer?.domElement;
    if (canvas) _bindCanvasDrop(canvas);
  });

  function _bindCanvasDrop(canvas) {
    canvas.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('application/x-cyco-material')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    });
    canvas.addEventListener('drop', (e) => {
      const matId = e.dataTransfer.getData('application/x-cyco-material');
      if (!matId) return;
      e.preventDefault();

      // Resolve preset from already-imported MATERIALS array
      const preset = MATERIALS.find(m => m.id === matId);
      if (!preset) return;

      // Raycast to find the object under the drop point
      const ve = window.__cyco?.viewportEngine;
      if (!ve) return;
      const rect = canvas.getBoundingClientRect();
      const ndcX = ((e.clientX - rect.left) / rect.width)  * 2 - 1;
      const ndcY = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), ve.camera);
      const hits = raycaster.intersectObjects(ve.scene.children, true)
        .filter(h => !h.object.userData._isGizmo && (h.object.isMesh || h.object.isSkinnedMesh));

      const targetObjects = hits.length > 0 ? [hits[0].object] : [];
      if (targetObjects.length > 0) {
        window.dispatchEvent(new CustomEvent('cyco-apply-material', {
          detail: { preset, targetObjects }
        }));
      }
    });
  }
})();

export { createMaterialFromPreset };
