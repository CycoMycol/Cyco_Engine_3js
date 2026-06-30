/** CenterPanel.js — Viewport panel with left tool sidebar and top bar */

import { BasePanel }    from './BasePanel.js';
import LayoutManager    from '../layout-manager.js';
import { ObjectPropertiesPanel } from '../CycoModeler/ObjectPropertiesPanel.js';

// ── Data ──────────────────────────────────────────────────────────────────────

const RENDER_MODES = [
  { value: 'wireframe',   label: 'Wireframe'    },
  { value: 'standard',    label: 'Standard'     },
  { value: 'albedo',      label: 'Albedo'       },
  { value: 'opacity',     label: 'Opacity'      },
  { value: 'worldnormal', label: 'World Normal' },
  { value: 'specularity', label: 'Specularity'  },
  { value: 'gloss',       label: 'Gloss'        },
  { value: 'metalness',   label: 'Metalness'    },
  { value: 'ao',          label: 'AO'           },
  { value: 'emission',    label: 'Emission'     },
  { value: 'lighting',    label: 'Lighting'     },
];

const CAMERA_VIEWS = [
  { value: 'perspective',  label: 'Perspective'  },
  { value: 'orthographic', label: 'Orthographic' },
  { value: 'top',          label: 'Top'          },
  { value: 'bottom',       label: 'Bottom'       },
  { value: 'front',        label: 'Front'        },
  { value: 'back',         label: 'Back'         },
  { value: 'left',         label: 'Left'         },
  { value: 'right',        label: 'Right'        },
  { value: 'camera',       label: 'Camera'       },
];

const MODELER_ICON_ROOT = './src/CycoModeler/Icons/';

const MODELER_ELEMENTS = [
  { id: 'object',  label: 'Object',  icon: 'Icon_Elements_Object.png'  },
  { id: 'vertex',  label: 'Vertex',  icon: 'Icon_Elements_Vertex.png'  },
  { id: 'edge',    label: 'Edge',    icon: 'Icon_Elements_Edge.png'    },
  { id: 'polygon', label: 'Polygon', icon: 'Icon_Elements_Polygon.png' },
];

const MODELER_GROUPS = [
  { id: 'elements',   label: 'Elements',   icon: 'Icon_Group_Elements.png' },
  { id: 'primitive',  label: 'Primitive Shapes', icon: 'Icon_Group_PrimitiveShapes.png' },
  { id: 'drawing',    label: 'Drawing',    icon: 'Icon_Group_Drawing.png' },
  { id: 'selection',  label: 'Selection',  icon: 'Icon_Group_Selection.png' },
  { id: 'add',        label: 'Add',        icon: 'Icon_Group_Add.png' },
  { id: 'remove',     label: 'Remove',     icon: 'Icon_Group_Remove.png' },
  { id: 'deform',     label: 'Deform',     icon: 'Icon_Group_Tweak.png' },
  { id: 'surface',    label: 'Surface',    icon: 'Icon_Group_Surface.png' },
  { id: 'tweak',      label: 'Tweak',      icon: 'Icon_Group_Tweak.png' },
  { id: 'misc',       label: 'Misc',       icon: 'Icon_Group_Misc.png' },
  { id: 'multiple',   label: 'Multiple Objects', icon: 'Icon_Group_Creation.png' },
];

const MODELER_TOOLS = {
  elements: MODELER_ELEMENTS,
  primitive: [
    { id: 'box', label: 'Box', icon: 'Icon_PrimitiveShapes_Box.png' },
    { id: 'room', label: 'Room', icon: 'Icon_PrimitiveShapes_Room.png' },
    { id: 'stair', label: 'Stair', icon: 'Icon_PrimitiveShapes_Stair.png' },
    { id: 'cylinder', label: 'Cylinder', icon: 'Icon_PrimitiveShapes_Cylinder.png' },
    { id: 'cone', label: 'Cone', icon: 'Icon_PrimitiveShapes_Cone.png' },
    { id: 'sphere', label: 'Sphere', icon: 'Icon_PrimitiveShapes_Sphere.png' },
    { id: 'capsule', label: 'Capsule', icon: 'Icon_PrimitiveShapes_Capsule.png' },
    { id: 'torus', label: 'Torus', icon: 'Icon_PrimitiveShapes_Torus.png' },
    { id: 'spiral-stair', label: 'Spiral Stair', icon: 'Icon_PrimitiveShapes_SpiralStair.png' },
    { id: 'icosahedron', label: 'Icosahedron', icon: 'Icon_PrimitiveShapes_Icosahedron.png' },
  ],
  drawing: [
    { id: 'line', label: 'Line', icon: 'Icon_Drawing_Line.png' },
    { id: 'arc', label: 'Arc', icon: 'Icon_Drawing_Arc.png' },
    { id: 'disk', label: 'Disk', icon: 'Icon_Drawing_Disk.png' },
    { id: 'parallel', label: 'Parallel', icon: 'Icon_Drawing_Parallel.png' },
    { id: 'rounded-rectangle', label: 'Rounded Rectangle', icon: 'Icon_Drawing_RoundedRectangle.png' },
    { id: 'side-stair', label: 'Side Stair', icon: 'Icon_Drawing_SideStair.png' },
  ],
  selection: [
    { id: 'all-select', label: 'All Select', icon: 'Icon_Selection_AllSelect.png' },
    { id: 'none-select', label: 'None Select', icon: 'Icon_Selection_NoneSelect.png' },
    { id: 'invert-select', label: 'Invert Select', icon: 'Icon_Selection_InvertSelect.png' },
    { id: 'grow-select', label: 'Grow Select', icon: 'Icon_Selection_GrowSelect.png' },
    { id: 'shrink-select', label: 'Shrink Select', icon: 'Icon_Selection_ShrinkSelect.png' },
    { id: 'loop-select', label: 'Loop Select', icon: 'Icon_Selection_LoopSelect.png' },
    { id: 'ring-select', label: 'Ring Select', icon: 'Icon_Selection_RingSelect.png' },
    { id: 'isolated-select', label: 'Isolated Select', icon: 'Icon_Selection_IsolatedSelect.png' },
  ],
  add: [
    { id: 'push-pull', label: 'Push Pull', icon: 'Icon_Add_PushPull.png' },
    { id: 'multi-push-pull', label: 'Multi Push Pull', icon: 'Icon_Add_MultiPushPull.png' },
    { id: 'extrude-edge', label: 'Extrude Edge', icon: 'Icon_Add_ExtrudeEdge.png' },
    { id: 'inset', label: 'Inset', icon: 'Icon_Add_Inset.png' },
    { id: 'bevel', label: 'Bevel', icon: 'Icon_Add_Bevel.png' },
    { id: 'loop-slice', label: 'Loop Slice', icon: 'Icon_Add_LoopSlice.png' },
    { id: 'subdivide', label: 'Subdivide', icon: 'Icon_Add_Subdivide.png' },
    { id: 'bridge', label: 'Bridge', icon: 'Icon_Add_Bridge.png' },
    { id: 'clone', label: 'Clone', icon: 'Icon_Add_Clone.png' },
    { id: 'duplicate', label: 'Duplicate', icon: 'Icon_Add_Duplicate.png' },
    { id: 'mirror', label: 'Mirror', icon: 'Icon_Add_Mirror.png' },
    { id: 'boolean', label: 'Boolean', icon: 'Icon_Add_Boolean.png' },
  ],
  remove: [
    { id: 'eraser', label: 'Eraser', icon: 'Icon_Remove_Eraser.png' },
    { id: 'cut', label: 'Cut', icon: 'Icon_Remove_Cut.png' },
    { id: 'clip', label: 'Clip', icon: 'Icon_Remove_Clip.png' },
    { id: 'collapse', label: 'Collapse', icon: 'Icon_Remove_Collapse.png' },
    { id: 'detach', label: 'Detach', icon: 'Icon_Remove_Detach.png' },
    { id: 'combine', label: 'Combine', icon: 'Icon_Remove_Combine.png' },
    { id: 'combine-vertices', label: 'Combine Vertices', icon: 'Icon_Remove_CombineVertices.png' },
    { id: 'combine-polygons', label: 'Combine Polygons', icon: 'Icon_Remove_CombinePolygons.png' },
    { id: 'remove-doubles', label: 'Remove Doubles', icon: 'Icon_Remove_RemoveDoubles.png' },
  ],
  deform: [
    { id: 'flatten', label: 'Flatten', icon: 'Icon_Tweak_Flatten.png' },
    { id: 'align', label: 'Align', icon: 'Icon_Tweak_Align.png' },
    { id: 'snap-move', label: 'Snap Move', icon: 'Icon_Tweak_SnapMove.png' },
    { id: 'axis-flip', label: 'Axis Flip', icon: 'Icon_Tweak_AxisFlip.png' },
  ],
  surface: [
    { id: 'material', label: 'Material', icon: 'Icon_Surface_Material.png' },
    { id: 'uv', label: 'UV', icon: 'Icon_Surface_UV.png' },
    { id: 'vertex-color', label: 'Vertex Color', icon: 'Icon_Surface_VertexColor.png' },
    { id: 'polygon-color', label: 'Polygon Color', icon: 'Icon_Surface_PolygonColor.png' },
    { id: 'smoothing-group', label: 'Smoothing Group', icon: 'Icon_Surface_SmoothingGroup.png' },
    { id: 'hotspot-layout', label: 'Hotspot Layout', icon: 'Icon_Surface_HotspotLayout.png' },
  ],
  tweak: [
    { id: 'flip', label: 'Flip', icon: 'Icon_Tweak_Flip.png' },
    { id: 'pivot', label: 'Pivot', icon: 'Icon_Tweak_Pivot.png' },
    { id: 'pivot-center', label: 'Pivot To Center', icon: 'Icon_Tweak_PivotToCenter.png' },
    { id: 'bake-transform', label: 'Bake Transform', icon: 'Icon_Misc_BakeTransform.png' },
  ],
  misc: [
    { id: 'new-object', label: 'New Cyco Modeler Object', icon: 'Icon_Misc_NewCycoModelerObject.png' },
    { id: 'backface-cull', label: 'Backface Cull', icon: 'Icon_Misc_BackfaceCull.png' },
    { id: 'symmetry', label: 'Symmetry', icon: 'Icon_Misc_Symmetry.png' },
    { id: 'settings', label: 'Settings', icon: 'Icon_Misc_Settings.png' },
    { id: 'local-settings', label: 'Local Settings', icon: 'Icon_Misc_LocalSettings.png' },
    { id: 'polygon-group', label: 'Polygon Group', icon: 'Icon_Misc_PolygonGroup.png' },
    { id: 'collider', label: 'Collider', icon: 'Icon_Misc_Collider.png' },
    { id: 'export', label: 'Export', icon: 'Icon_Misc_Export.png' },
    { id: 'refresh', label: 'Refresh', icon: 'Icon_Misc_RefreshObject.png' },
  ],
  multiple: [
    { id: 'combine-objects', label: 'Combine Objects', icon: 'Icon_Remove_CombineObjects.png' },
    { id: 'mirror-object', label: 'Mirror Object', icon: 'Icon_Add_MirrorObject.png' },
    { id: 'refresh-all', label: 'Refresh All', icon: 'Icon_Misc_RefreshAll.png' },
  ],
};

// ── Tool → required Element-mode mapping ─────────────────────────────────────
// 'object'  = tool only meaningful in Object mode (primitives, transform, etc.)
// 'polygon' = tool only meaningful when polygons are selected
// 'edge'    = tool only meaningful when edges are selected
// 'vertex'  = tool only meaningful when vertices are selected
// 'all'     = works regardless of active mode (selection ops, surface ops)
// null      = not a model-tool (e.g. settings, snap, wire cycle — always available)
// Mapping follows Blender/3ds Max/Cinema 4D conventions.
const TOOL_MODES = {
  // ── Add (geometry creation / duplication) ─────────────────────────────────
  'push-pull':          'polygon',
  'multi-push-pull':    'polygon',
  'extrude-edge':       'edge',
  'inset':              'polygon',
  'bevel':              'edge',     // bevels selected edges (works on faces too, but edge-mode is the canonical use)
  'loop-slice':         'edge',
  'subdivide':          'polygon',
  'bridge':             'edge',     // bridges between two edge selections
  'clone':              'all',
  'duplicate':          'all',
  'mirror':             'all',
  'boolean':            'object',   // booleans operate on whole objects

  // ── Remove ───────────────────────────────────────────────────────────────
  'eraser':             'polygon',
  'cut':                'edge',     // cuts along edges
  'clip':               'polygon',  // clips faces against a plane
  'collapse':           'edge',     // collapses selected edges
  'detach':             'polygon',  // detaches polygons to a new object
  'combine':            'edge',     // combines edges into one
  'combine-vertices':   'vertex',
  'combine-polygons':   'polygon',
  'remove-doubles':     'vertex',

  // ── Deform ───────────────────────────────────────────────────────────────
  'flatten':            'polygon',
  'align':              'polygon',
  'snap-move':          'all',
  'axis-flip':          'polygon',

  // ── Surface ──────────────────────────────────────────────────────────────
  'material':           'all',
  'uv':                 'all',
  'vertex-color':       'vertex',
  'polygon-color':      'polygon',
  'smoothing-group':    'polygon',
  'hotspot-layout':     'polygon',

  // ── Tweak ────────────────────────────────────────────────────────────────
  'flip':               'polygon',
  'pivot':              'all',
  'pivot-center':       'all',
  'bake-transform':     'all',

  // ── Selection (always available — works on current selection) ────────────
  'all-select':         'all',
  'none-select':        'all',
  'invert-select':      'all',
  'grow-select':        'all',
  'shrink-select':      'all',
  'loop-select':        'edge',
  'ring-select':        'edge',
  'isolated-select':    'all',

  // ── Misc / Multiple ──────────────────────────────────────────────────────
  'new-object':         'all',
  // Backface-cull + symmetry are picker-policy toggles, not element-
  // bound tools — they work regardless of which element mode the user
  // is in. Null → never mode-restricted.
  'backface-cull':      null,
  'symmetry':           null,
  'settings':           null,       // always available (not element-specific)
  'local-settings':     null,
  'polygon-group':      'polygon',
  'collider':           'all',
  'export':             'all',
  'refresh':            'all',
  'combine-objects':    'object',
  'mirror-object':      'object',
  'refresh-all':        'all',

  // ── Primitives / Drawing are object-mode only (creation tools) ───────────
  'box':                'object',
  'room':               'object',
  'stair':              'object',
  'cylinder':           'object',
  'cone':               'object',
  'sphere':             'object',
  'capsule':            'object',
  'torus':              'object',
  'spiral-stair':       'object',
  'icosahedron':        'object',
  'line':               'object',
  'arc':                'object',
  'disk':               'object',
  'parallel':           'object',
  'rounded-rectangle':  'object',
  'side-stair':         'object',

  // ── System actions (always available) ────────────────────────────────────
  'translate':          'all',
  'rotate':             'all',
  'scale':              'all',
  'snap':               null,
  'confirm':            null,
  'cancel':             null,
  'uv-editor':          null,
};

// Element mode that "object" tools should silently fall back to when the
// user has a vertex/edge/polygon mode active but clicks an object-only tool.
// We don't *change* the user's mode — we just disable those tools so the
// user must explicitly switch back to Object mode.
const OBJECT_MODE = 'object';
const ELEMENT_MODE_IDS = new Set(['object', 'vertex', 'edge', 'polygon']);

// ── Panel class ───────────────────────────────────────────────────────────────

export class CenterPanel extends BasePanel {
  constructor() {
    super();
    this._renderMode  = 'standard';
    this._previousRenderMode = 'standard';
    this._skyWireframeVisible = false;
    this._cameraView  = 'perspective';
    this._physicsEdit = false;
    this._renderHandle = null;
    this._cameraHandle = null;
    this._vpSizeBtn    = null;
    this._vpFloatBtn   = null;  // float button in the topbar
    this._tabSnapBtn   = null;  // snap-back button injected into the dockview tab

    // ── Phase 7: undo/redo/history/play/stats refs ─────────────────────────
    this._undoBtn      = null;
    this._redoBtn      = null;
    this._histWrap     = null;
    this._playBtn      = null;
    this._playing      = false;
    this._history      = [];
    this._histIndex    = -1;
    this._modelerActive = false;
    this._modelerTool = 'box';
    this._modelerGroup = 'primitive';
    this._modelerGizmo = 'translate';
    this._modelerFrame = 'world';
    this._modelerWireMode = 'solid-wire';
    this._modelerSearchOpen = false;
    this._modelerRoot = null;
    this._currentElementMode = OBJECT_MODE;
    // Picker-policy state. Mirrored on the controller for the actual
    // picking math; mirrored here so the toolbar can show active-
    // class styling and so the dropdown can render its current axis
    // set when reopened. Backface cull defaults OFF so the picker
    // "sees through" both sides until the user explicitly turns it
    // on (matches the controller default). Symmetry defaults off.
    this._backfaceCull = false;
    this._symmetryAxes = new Set();

    this._onHistoryChange     = this._onHistoryChange.bind(this);
    this._onRuntimeState      = this._onRuntimeState.bind(this);
    this._onEditorCamChanged  = this._onEditorCamChanged.bind(this);
    this._onPhysicsEditMode   = this._onPhysicsEditMode.bind(this);
    this._onCycoAction        = this._onCycoAction.bind(this);
    this._onModelerMode       = this._onModelerMode.bind(this);
    this._onModelerStatus     = this._onModelerStatus.bind(this);
    this._onModelerElementEvt = this._onModelerElementEvt.bind(this);
    this._onSelectModelerNode = this._onSelectModelerNode.bind(this);
    this._onDeselectModelerNode = this._onDeselectModelerNode.bind(this);
    window.addEventListener('cyco-history-change',        this._onHistoryChange);
    window.addEventListener('cyco-runtime-state',         this._onRuntimeState);
    window.addEventListener('cyco-editor-camera-changed', this._onEditorCamChanged);
    window.addEventListener('cyco-physics-edit-mode',     this._onPhysicsEditMode);
    window.addEventListener('cyco-action',                this._onCycoAction);
    document.addEventListener('cyco-action',              this._onCycoAction);
    window.addEventListener('cyco-modeler-mode',          this._onModelerMode);
    window.addEventListener('cyco-modeler-status',        this._onModelerStatus);
    window.addEventListener('cyco-modeler-element',       this._onModelerElementEvt);
    window.addEventListener('cyco-select-node',           this._onSelectModelerNode);
    window.addEventListener('cyco-deselect-all',          this._onDeselectModelerNode);
  }

  _buildContent() {
    const root = document.createElement('div');
    root.className = 'ce-viewport-root';

    // Top bar with three dropdown menus
    this._topBar = this._buildTopBar();
    root.appendChild(this._topBar);

    // Body: left toolbar + viewport canvas
    const body = document.createElement('div');
    body.className = 'ce-viewport-body';
    const vp = document.createElement('div');
    vp.className = 'ce-viewport-canvas';
    vp.id = 'cyco-viewport-canvas';
    this._viewportCanvas = vp;
    const lbl = document.createElement('div');
    lbl.className = 'ce-panel-label';
    lbl.id = 'cyco-viewport-placeholder-label';
    lbl.textContent = 'Viewport';
    vp.appendChild(lbl);
    this._modelerRoot = this._buildModelerOverlay();
    vp.appendChild(this._modelerRoot);
    this._refreshModelerButtons();
    body.appendChild(vp);

    // Notify ViewportEngine that its container is ready after it has been attached
    // to the DOM. Some renderers or panel layouts replace the element across frames.
    requestAnimationFrame(() => {
      const dispatchReady = () => {
        if (!document.body.contains(vp)) {
          requestAnimationFrame(dispatchReady);
          return;
        }
        window.dispatchEvent(new CustomEvent('cyco-viewport-container-ready', { detail: { container: vp } }));
      };
      dispatchReady();
    });

    root.appendChild(body);

    // Close all dropdowns on outside click
    this._outsideHandler = (e) => {
      if (this._topBar && !this._topBar.contains(e.target)) {
        this._closeAllDropdowns();
      }
    };
    document.addEventListener('click', this._outsideHandler);

    return root;
  }

  _onCycoAction(event) {
    const action = event?.detail?.action ?? event?.detail;
    if (action !== 'cyco-modeler') return;
    if (LayoutManager.isModelerMode?.()) return;
    const entered = LayoutManager.enterModelerMode?.();
    if (entered) this._setModelerActive(true);
  }

  _onModelerMode(event) {
    this._setModelerActive(Boolean(event?.detail?.active));
  }

  _setModelerActive(active) {
    this._modelerActive = active;
    this._modelerRoot?.classList.toggle('active', active);
    this._topBar?.classList.toggle('modeler-hidden', active);
    this._viewportCanvas?.classList.toggle('cyco-modeler-canvas', active);
  }

  _onModelerStatus(event) {
    const msg = event.detail?.message;
    const hint = this._modelerRoot?.querySelector('.cyco-modeler-stage-hint');
    if (hint && msg) hint.textContent = msg;
  }

  _buildModelerOverlay() {
    const root = document.createElement('div');
    root.className = 'cyco-modeler-root';

    root.appendChild(this._buildModelerTopbar());

    const work = document.createElement('div');
    work.className = 'cyco-modeler-workspace';
    const groupStrip = this._buildModelerGroupStrip();
    work.appendChild(groupStrip);

    const stage = document.createElement('div');
    stage.className = 'cyco-modeler-stage';
    const hint = document.createElement('div');
    hint.className = 'cyco-modeler-stage-hint';
    hint.textContent = 'Cyco Modeler';
    stage.appendChild(hint);
    work.appendChild(stage);

    const inspector = this._buildModelerInspector();
    work.appendChild(inspector);
    root.appendChild(work);

    requestAnimationFrame(() => {
      this._makeModelerFloatable(root.querySelector('.cyco-modeler-topbar'), root, { centerX: true, y: 8 });
      this._makeModelerFloatable(groupStrip, root, { x: 7, y: 8 });
      this._makeModelerFloatable(inspector, root, { right: 10, y: 54 });
      this._makeModelerResizable(inspector);
    });

    return root;
  }

  _buildModelerTopbar() {
    const bar = document.createElement('div');
    bar.className = 'cyco-modeler-topbar';

    MODELER_ELEMENTS.forEach(item => {
      bar.appendChild(this._modelerIconButton(item, 'element', () => {
        this._selectModelerElement(item.id);
      }, true));
    });

    bar.appendChild(this._buildModelerWireMenu());

    bar.appendChild(_modelerSep());

    const gizmoBtn = document.createElement('button');
    gizmoBtn.className = 'cyco-modeler-mini-btn cyco-modeler-icon-only';
    gizmoBtn.type = 'button';
    gizmoBtn.dataset.modelerGizmoCycle = 'true';
    gizmoBtn.addEventListener('click', () => {
      const order = ['translate', 'rotate', 'scale'];
      this._modelerGizmo = order[(order.indexOf(this._modelerGizmo) + 1) % order.length];
      this._selectModelerTool(this._modelerGizmo);
    });
    bar.appendChild(gizmoBtn);

    bar.appendChild(_modelerSep());

    const frameBtn = document.createElement('button');
    frameBtn.className = 'cyco-modeler-mini-btn cyco-modeler-icon-only';
    frameBtn.type = 'button';
    frameBtn.dataset.modelerFrameCycle = 'true';
    frameBtn.addEventListener('click', () => {
      this._modelerFrame = this._modelerFrame === 'world' ? 'local' : 'world';
      window.dispatchEvent(new CustomEvent('cyco-modeler-frame', {
        detail: { frame: this._modelerFrame }
      }));
      this._refreshModelerButtons();
    });
    bar.appendChild(frameBtn);

    [
      { id: 'snap', label: 'Snap' },
      // Backface Cull toggle: replaces the legacy "3D Cursor" button
      // on the top toolbar. Click to flip cull on/off; the button
      // glows while cull is enabled (matches how Snap glows when on).
      { id: 'backface-cull-top', label: 'Backface Cull', icon: 'Icon_Misc_BackfaceCull.png' },
      // Symmetry dropdown: replaces the cursor button on the top
      // toolbar (sibling to Backface Cull). Click opens the
      // checkbox dropdown — any axis selected unions the mirror
      // face into every middle-click selection.
      { id: 'symmetry-top', label: 'Symmetry', icon: 'Icon_Misc_Symmetry.png' },
    ].forEach(item => {
      const btn = document.createElement('button');
      btn.className = 'cyco-modeler-mini-btn cyco-modeler-icon-only';
      btn.type = 'button';
      btn.title = item.label;
      btn.dataset.miniId = item.id;
      if (item.icon) {
        const img = document.createElement('img');
        img.alt = '';
        img.src = MODELER_ICON_ROOT + item.icon;
        btn.appendChild(img);
      } else {
        btn.innerHTML = _toolIcon(item.id);
      }
      if (item.id === 'snap') {
        btn.addEventListener('click', () => {
          const active = !btn.classList.contains('active');
          btn.classList.toggle('active', active);
          window.dispatchEvent(new CustomEvent('cyco-modeler-snap', {
            detail: { enabled: active }
          }));
        });
      } else if (item.id === 'backface-cull-top') {
        // Mirror the panel-side `_backfaceCull` state and dispatch
        // the same toggle event the side-rail button uses, so the
        // controller doesn't need a separate listener.
        btn.classList.toggle('active', this._backfaceCull);
        btn.addEventListener('click', () => {
          this._backfaceCull = !this._backfaceCull;
          btn.classList.toggle('active', this._backfaceCull);
          window.dispatchEvent(new CustomEvent('cyco-modeler-toggle-backface-cull', {
            detail: { enabled: this._backfaceCull }
          }));
          this._refreshModelerButtons();
        });
      } else if (item.id === 'symmetry-top') {
        btn.classList.toggle('active', this._symmetryAxes.size > 0);
        btn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          this._openSymmetryDropdown('symmetry', 'Symmetry');
          btn.classList.toggle('active', this._symmetryAxes.size > 0);
        });
      } else {
        btn.addEventListener('click', () => this._selectModelerTool(item.id));
      }
      bar.appendChild(btn);
    });

    const settingsBtn = document.createElement('button');
    settingsBtn.className = 'cyco-modeler-mini-btn cyco-modeler-icon-only';
    settingsBtn.type = 'button';
    settingsBtn.title = 'Cyco Modeler Settings';
    settingsBtn.innerHTML = _toolIcon('settings');
    settingsBtn.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('cyco-open-modeler-settings'));
    });
    bar.appendChild(settingsBtn);

    const exit = document.createElement('button');
    exit.className = 'cyco-modeler-exit';
    exit.type = 'button';
    exit.textContent = 'Exit';
    exit.addEventListener('click', () => LayoutManager.exitModelerMode?.());
    bar.appendChild(exit);

    return bar;
  }

  _buildModelerGroupStrip() {
    const strip = document.createElement('div');
    strip.className = 'cyco-modeler-groups';
    MODELER_GROUPS.forEach(item => {
      strip.appendChild(this._modelerIconButton(item, 'group', () => {
        this._modelerGroup = item.id;
        this._refreshModelerButtons();
      }));
    });
    return strip;
  }

  _buildModelerInspector() {
    const panel = document.createElement('div');
    panel.className = 'cyco-modeler-panel cyco-modeler-inspector';

    const resize = document.createElement('div');
    resize.className = 'cyco-modeler-resize-handle';
    resize.title = 'Drag to resize width';
    panel.appendChild(resize);

    const resizeH = document.createElement('div');
    resizeH.className = 'cyco-modeler-resize-handle-h';
    resizeH.title = 'Drag to resize height';
    panel.appendChild(resizeH);

    const resizeC = document.createElement('div');
    resizeC.className = 'cyco-modeler-resize-handle-c';
    resizeC.title = 'Drag to resize width and height';
    panel.appendChild(resizeC);

    const header = document.createElement('div');
    header.className = 'cyco-modeler-panel-header';

    // ── Left-side tabs: Tools / Properties ────────────────────────────────
    // Replaces the previous "Cyco Modeler" title. The two tab buttons
    // live directly on the header (far-left), styled to match the rest
    // of the Cyco Engine dark-theme chrome (no white square). Clicking
    // switches the inspector's body between the existing tools list
    // and the ObjectPropertiesPanel (the modifier stack for the
    // selected primitive). When a modeler primitive is selected in the
    // viewport the Properties tab is auto-activated; deselecting
    // returns to Tools.
    const tabsWrap = document.createElement('div');
    tabsWrap.className = 'cyco-modeler-title-tabs';
    const toolsTab = document.createElement('button');
    toolsTab.type = 'button';
    toolsTab.className = 'cyco-modeler-title-tab active';
    toolsTab.textContent = 'Tools';
    toolsTab.dataset.modelerTab = 'tools';
    const propsTab = document.createElement('button');
    propsTab.type = 'button';
    propsTab.className = 'cyco-modeler-title-tab';
    propsTab.textContent = 'Properties';
    propsTab.dataset.modelerTab = 'properties';
    tabsWrap.append(toolsTab, propsTab);
    header.appendChild(tabsWrap);

    const searchWrap = document.createElement('div');
    searchWrap.className = 'cyco-modeler-search-wrap';
    const searchToggle = document.createElement('button');
    searchToggle.className = 'cyco-modeler-mini-btn cyco-modeler-icon-only';
    searchToggle.type = 'button';
    searchToggle.title = 'Search tools';
    searchToggle.innerHTML = _toolIcon('search');
    const search = document.createElement('input');
    search.className = 'cyco-modeler-search';
    search.type = 'search';
    search.placeholder = 'Search tools';
    searchToggle.addEventListener('click', () => {
      searchWrap.classList.toggle('open');
      if (searchWrap.classList.contains('open')) search.focus();
    });
    searchWrap.appendChild(searchToggle);
    searchWrap.appendChild(search);
    header.appendChild(searchWrap);

    // Scrollable body -- wraps header + scrollable content so the resize
    // handles (siblings of body) are not clipped by overflow.
    const body = document.createElement('div');
    body.className = 'cyco-modeler-panel-body';
    panel.appendChild(body);
    body.appendChild(header);

    // ── Section order is user-customizable via drag-and-drop on the
    //    collapsible headers. Load persisted order (if any) so users keep
    //    their layout across reloads.
    const savedOrder = this._loadModelerSectionOrder();
    const orderedEntries = savedOrder
      ? Object.entries(MODELER_TOOLS).sort(([a], [b]) => {
          const ia = savedOrder.indexOf(a);
          const ib = savedOrder.indexOf(b);
          return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
        })
      : Object.entries(MODELER_TOOLS);

    const sectionContainer = document.createElement('div');
    sectionContainer.className = 'cyco-modeler-sections';

    orderedEntries.forEach(([groupId, tools]) => {
      const group = MODELER_GROUPS.find(item => item.id === groupId);
      const section = document.createElement('section');
      section.className = 'cyco-modeler-tool-section';
      section.dataset.modelerSection = groupId;
      section.draggable = true;
      if (groupId !== this._modelerGroup) section.classList.add('collapsed');

      const header = document.createElement('button');
      header.className = 'cyco-modeler-section-title';
      header.type = 'button';
      header.draggable = true;
      const arrow = document.createElement('span');
      arrow.className = 'cyco-modeler-section-arrow';
      arrow.textContent = '▾';
      const label = document.createElement('span');
      label.textContent = group?.label ?? groupId;
      header.appendChild(arrow);
      header.appendChild(label);
      header.addEventListener('click', (e) => {
        // Don't toggle when the user is finishing a drag on the header.
        if (header._cycoJustDragged) {
          header._cycoJustDragged = false;
          return;
        }
        section.classList.toggle('collapsed');
        this._modelerGroup = groupId;
        this._refreshModelerButtons();
      });
      section.appendChild(header);

      const grid = document.createElement('div');
      grid.className = 'cyco-modeler-tool-grid';
      tools.forEach(item => {
        // Picker-policy toggles (`backface-cull`, `symmetry`) get their
        // own click handlers so they don't dispatch the modeler-tool
        // event (they're not tools — they're settings that change how
        // the middle-click picker behaves).
        if (item.id === 'backface-cull') {
          grid.appendChild(this._modelerIconButton(item, 'tool', () => {
            this._modelerGroup = groupId;
            this._toggleBackfaceCull(item.id);
          }));
        } else if (item.id === 'symmetry') {
          grid.appendChild(this._modelerIconButton(item, 'tool', () => {
            this._modelerGroup = groupId;
            this._openSymmetryDropdown(item.id, item.label);
          }));
        } else {
          grid.appendChild(this._modelerIconButton(item, 'tool', () => {
            this._modelerGroup = groupId;
            this._selectModelerTool(item.id);
          }));
        }
      });
      section.appendChild(grid);

      this._attachModelerSectionDnD(section, sectionContainer);
      sectionContainer.appendChild(section);
    });

    // ── Tools tab pane (wraps the existing tool-list + tool-properties
    //    sections so we can swap to the Properties pane via the header
    //    tabs without rebuilding the panel's DOM.)
    const toolsPane = document.createElement('div');
    toolsPane.className = 'modeler-tab-pane';
    toolsPane.dataset.modelerPane = 'tools';
    toolsPane.appendChild(sectionContainer);

    toolsPane.appendChild(_modelerPanelTitle('Tool Properties'));
    toolsPane.appendChild(_modelerField('Width', '1.00'));
    toolsPane.appendChild(_modelerField('Depth', '1.00'));
    toolsPane.appendChild(_modelerField('Height', '1.00'));

    const actions = document.createElement('div');
    actions.className = 'cyco-modeler-actions';
    ['Confirm', 'Cancel', 'UV Editor'].forEach(label => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = label;
      btn.addEventListener('click', () => this._selectModelerTool(label.toLowerCase().replace(/\s+/g, '-')));
      actions.appendChild(btn);
    });
    toolsPane.appendChild(actions);

    body.appendChild(toolsPane);

    // ── Properties tab pane ─────────────────────────────────────────────
    // Hidden by default. Lazily mounts the ObjectPropertiesPanel on first
    // use (so we don't pay the cost when the user never opens it). The
    // pane is shown whenever the user clicks the Properties tab OR
    // selects a modeler primitive in the viewport (auto-switch).
    const propsPane = document.createElement('div');
    propsPane.className = 'modeler-tab-pane';
    propsPane.dataset.modelerPane = 'properties';
    propsPane.style.display = 'none';
    body.appendChild(propsPane);
    this._modelerInspectorPropsPane = propsPane;

    // Wire the tab buttons to switch panes.
    const switchTab = (which) => this._activateModelerTab(which);
    toolsTab.addEventListener('click', () => switchTab('tools'));
    propsTab.addEventListener('click', () => switchTab('properties'));
    this._modelerInspectorTabs = { toolsTab, propsTab, toolsPane, propsPane };

    return panel;
  }

  // Switch the inspector header tabs (Tools / Properties). Updates the
  // active-tab styling, shows the matching sub-pane, and syncs the
  // lazy-mounted ObjectPropertiesPanel so the modifier list rebuilds
  // against the current selection.
  _activateModelerTab(which) {
    if (!this._modelerInspectorTabs) return;
    const { toolsTab, propsTab, toolsPane, propsPane } = this._modelerInspectorTabs;
    const showTools = which === 'tools';
    toolsTab.classList.toggle('active', showTools);
    propsTab.classList.toggle('active', !showTools);
    toolsPane.style.display = showTools ? '' : 'none';
    propsPane.style.display = showTools ? 'none' : '';
    if (showTools) {
      // Switching back to Tools -- hide the (still-mounted) panel DOM
      // so it doesn't fight with the Tools pane for input focus.
      this._modelerPropsPanel?.hide?.();
    } else {
      // Switching to Properties -- make the panel visible + refresh
      // its target. If the panel hasn't been mounted yet, build it.
      const panel = this._ensureModelerPropsPanel();
      panel?.show?.();
    }
  }

  // Lazy-mount the ObjectPropertiesPanel on first request. Returns the
  // existing instance on subsequent calls.
  _ensureModelerPropsPanel() {
    if (this._modelerPropsPanel) return this._modelerPropsPanel;
    if (!this._modelerInspectorPropsPane) return null;
    const cyco = window.__cyco || {};
    const panel = new ObjectPropertiesPanel({
      sceneManager:     cyco.sceneManager,
      selectionManager: cyco.selectionManager,
      cycleModeler:     cyco.cycleModeler,
      embedded:         true, // inline (no floating popup chrome)
    });
    panel.build();
    this._modelerInspectorPropsPane.appendChild(panel.root);
    this._modelerPropsPanel = panel;
    // Expose on window.__cyco so the cycle modeler can invoke
    // `_onEditApplied` synchronously during a push/pull preview
    // (the per-frame modifier refresh path — see
    // CycleModelerController._applyPushPreview).
    if (cyco) cyco.objectPropertiesPanel = panel;
    return panel;
  }

  // Auto-switch to the Properties tab when a single modeler primitive
  // is selected in the viewport. Multi-select / non-modeler selection
  // falls back to Tools so the user isn't surprised by an empty panel.
  _onSelectModelerNode(event) {
    if (!this._modelerActive) return;
    const detail = event?.detail || {};
    const arr = Array.isArray(detail.objects) ? detail.objects
               : (detail.object ? [detail.object] : []);
    if (arr.length !== 1) { this._activateModelerTab('tools'); return; }
    const obj = arr[0];
    if (!obj || !obj.userData?.cycoModeler) {
      this._activateModelerTab('tools');
      return;
    }
    // Make sure the panel is mounted + its target refreshed BEFORE we
    // swap tabs so the modifier list renders immediately on view.
    const panel = this._ensureModelerPropsPanel();
    panel?.show?.();
    this._activateModelerTab('properties');
  }

  // Auto-switch back to Tools when the user deselects while the
  // Properties tab is active -- keeps the inspector context in sync
  // with the viewport.
  _onDeselectModelerNode() {
    if (!this._modelerActive || !this._modelerInspectorTabs) return;
    const { propsTab } = this._modelerInspectorTabs;
    if (propsTab.classList.contains('active')) {
      this._activateModelerTab('tools');
    }
  }

  _modelerIconButton(item, kind, onClick, iconOnly = false) {
    const btn = document.createElement('button');
    btn.className = `cyco-modeler-icon-btn ${kind}` + (iconOnly ? ' icon-only' : '');
    btn.type = 'button';
    btn.title = item.label;
    btn.dataset.modelerKind = kind;
    btn.dataset.modelerId = item.id;
    const img = document.createElement('img');
    img.alt = '';
    img.src = MODELER_ICON_ROOT + item.icon;
    btn.appendChild(img);
    if (!iconOnly) {
      const label = document.createElement('span');
      label.textContent = item.label;
      btn.appendChild(label);
    }
    btn.addEventListener('click', onClick);
    return btn;
  }

  _selectModelerElement(id) {
    this._modelerTool = id;
    this._currentElementMode = id;
    window.dispatchEvent(new CustomEvent('cyco-modeler-element', {
      detail: { mode: id }
    }));
    this._refreshModelerButtons();
  }

  // External `cyco-modeler-element` listener — keeps the panel's tracked
  // mode in sync when another component (e.g. CycleModelerController or a
  // future hotkey) changes the active element mode outside of our own UI.
  _onModelerElementEvt(event) {
    const mode = event?.detail?.mode;
    if (!ELEMENT_MODE_IDS.has(mode)) return;
    this._currentElementMode = mode;
    this._refreshModelerButtons();
  }

  _selectModelerTool(id) {
    // Auto-activate the element mode this tool requires. If the tool is
    // mode-bound (TOOL_MODES[id] is one of object/vertex/edge/polygon) and
    // the current element mode differs, switch to the tool's mode first so
    // the user doesn't have to manually click the top-bar element button.
    const required = TOOL_MODES[id];
    if (required && ELEMENT_MODE_IDS.has(required)) {
      if (this._modelerTool !== required && this._currentElementMode !== required) {
        this._selectModelerElement(required);
      }
    }
    this._modelerTool = id;
    window.dispatchEvent(new CustomEvent('cyco-modeler-tool', {
      detail: { tool: id, group: this._modelerGroup }
    }));
    this._refreshModelerButtons();
  }

  // ── Picker-policy toggles ──────────────────────────────────────────────
  // Backface Cull: when ON (default) the middle-click picker and the
  // sweep-select skip faces whose world normal points away from the
  // camera, so the user never accidentally selects the polygon on
  // the far side of an object. Toggle persists for the current
  // session via the controller's mirror state.
  _toggleBackfaceCull(itemId) {
    this._backfaceCull = !this._backfaceCull;
    window.dispatchEvent(new CustomEvent('cyco-modeler-toggle-backface-cull', {
      detail: { enabled: this._backfaceCull }
    }));
    // Active-class styling: the button glows when cull is on, dim
    // when off — same pattern as the wire / snap toggles.
    this._modelerTool = itemId;
    this._refreshModelerButtons();
  }

  // Symmetry: opens a dropdown with checkboxes for X / Y / Z axes
  // (any combination → XY, XZ, YZ, XYZ). Selected axes are mirrored
  // through the picked object's bounding-box centre so a click on
  // the front face also selects the parallel face on the back (and
  // any other enabled axis pair). Matches Blender's symmetry
  // selection behaviour.
  _openSymmetryDropdown(itemId, label) {
    // Close any already-open symmetry menu before opening a new one.
    document.querySelectorAll('.cyco-modeler-symmetry-menu').forEach(el => el.remove());
    const wrap = document.createElement('div');
    wrap.className = 'cyco-modeler-symmetry-menu';
    wrap.style.cssText = 'position:absolute;z-index:9999;background:#2a2a2a;border:1px solid #444;'
      + 'border-radius:4px;padding:6px 8px;color:#ddd;font-size:12px;'
      + 'box-shadow:0 4px 12px rgba(0,0,0,0.4);display:flex;flex-direction:column;gap:4px;min-width:140px;';
    const title = document.createElement('div');
    title.textContent = 'Symmetry axes';
    title.style.cssText = 'font-weight:600;margin-bottom:2px;color:#fff;';
    wrap.appendChild(title);
    const axes = ['x', 'y', 'z'];
    for (const axis of axes) {
      const row = document.createElement('label');
      row.style.cssText = 'display:flex;align-items:center;gap:6px;cursor:pointer;padding:2px 4px;border-radius:3px;';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = this._symmetryAxes.has(axis);
      cb.addEventListener('change', () => {
        if (cb.checked) this._symmetryAxes.add(axis);
        else this._symmetryAxes.delete(axis);
        window.dispatchEvent(new CustomEvent('cyco-modeler-set-symmetry', {
          detail: { axes: [...this._symmetryAxes] }
        }));
        // Active-class on the toolbar button: any axis → glow.
        this._refreshModelerButtons();
      });
      const lab = document.createElement('span');
      lab.textContent = axis.toUpperCase() + ' axis';
      row.append(cb, lab);
      wrap.appendChild(row);
    }
    // Off button — clears every axis so the next click is single-face.
    const off = document.createElement('button');
    off.type = 'button';
    off.textContent = 'Turn Symmetry OFF';
    off.style.cssText = 'margin-top:6px;background:#3a3a3a;color:#eee;border:1px solid #555;border-radius:3px;'
      + 'padding:4px 8px;cursor:pointer;';
    off.addEventListener('click', () => {
      this._symmetryAxes.clear();
      window.dispatchEvent(new CustomEvent('cyco-modeler-set-symmetry', {
        detail: { axes: [] }
      }));
      this._refreshModelerButtons();
      wrap.remove();
    });
    wrap.appendChild(off);
    // Position next to the clicked toolbar button.
    const btn = this._modelerRoot?.querySelector(`[data-modeler-id="${itemId}"]`);
    if (btn) {
      const r = btn.getBoundingClientRect();
      wrap.style.left = `${r.right + 4}px`;
      wrap.style.top = `${r.top}px`;
    }
    document.body.appendChild(wrap);
    // Dismiss on outside click.
    const onDocClick = (ev) => {
      if (!wrap.contains(ev.target)) {
        wrap.remove();
        document.removeEventListener('mousedown', onDocClick, true);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', onDocClick, true), 0);
    this._modelerTool = itemId;
    this._refreshModelerButtons();
  }

  _buildModelerWireMenu() {
    const wrap = document.createElement('div');
    wrap.className = 'cyco-modeler-wire-wrap';
    const btn = document.createElement('button');
    btn.className = 'cyco-modeler-mini-btn cyco-modeler-icon-only';
    btn.type = 'button';
    btn.title = 'Modeler wire display';
    btn.dataset.modelerWireCycle = 'true';
    btn.innerHTML = _toolIcon('wireframe');
    const menu = document.createElement('div');
    menu.className = 'cyco-modeler-wire-menu';
    [
      { id: 'solid-wire', label: 'Solid + Wire', icon: 'wireframe' },
      { id: 'wire', label: 'Wire Only', icon: 'wireframe' },
      { id: 'solid', label: 'Solid Only', icon: 'standard' },
    ].forEach(item => {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'cyco-modeler-wire-option';
      option.title = item.label;
      option.dataset.modelerWireOption = item.id;
      option.innerHTML = _toolIcon(item.icon);
      option.addEventListener('click', () => {
        this._modelerWireMode = item.id;
        wrap.classList.remove('open');
        window.dispatchEvent(new CustomEvent('cyco-modeler-wire', { detail: { mode: item.id } }));
        this._refreshModelerButtons();
      });
      menu.appendChild(option);
    });
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      wrap.classList.toggle('open');
    });
    wrap.append(btn, menu);
    return wrap;
  }

  _refreshModelerButtons() {
    if (!this._modelerRoot) return;
    this._modelerRoot.querySelectorAll('[data-modeler-kind="tool"], [data-modeler-kind="element"]').forEach(btn => {
      // Picker-policy toggles glow based on their POLICY STATE, not
      // on which button was last clicked: backface-cull is active
      // when `_backfaceCull === true`; symmetry is active when at
      // least one axis is selected. All other tool buttons fall
      // through to the modelerTool-id match (existing behaviour).
      const id = btn.dataset.modelerId;
      let active = (id === this._modelerTool);
      if (id === 'backface-cull') active = this._backfaceCull;
      else if (id === 'symmetry') active = this._symmetryAxes.size > 0;
      btn.classList.toggle('active', active);
    });
    this._modelerRoot.querySelectorAll('[data-modeler-kind="group"]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.modelerId === this._modelerGroup);
    });
    // ── Per-mode tool availability ────────────────────────────────────────
    // Grey out tools that don't apply to the currently selected element
    // mode. The buttons remain clickable so clicking a tool that's bound
    // to a different mode auto-activates that mode (see _selectModelerTool).
    const mode = this._currentElementMode;
    this._modelerRoot.querySelectorAll('[data-modeler-kind="tool"]').forEach(btn => {
      const id = btn.dataset.modelerId;
      const required = TOOL_MODES[id];
      // Tools that have no entry, or `null` (system actions like snap /
      // settings), are always available. Tools marked 'all' are always
      // available regardless of mode.
      let disabled = false;
      if (required === 'polygon' || required === 'edge' || required === 'vertex') {
        disabled = mode !== required;
      } else if (required === 'object') {
        // Object-mode tools (primitives, drawing, boolean, mirror-object,
        // combine-objects) are only available when Object mode is active.
        disabled = mode !== OBJECT_MODE;
      }
      btn.classList.toggle('disabled', disabled);
      // Use aria-disabled instead of the native `disabled` attribute so
      // the button stays clickable — the click handler will auto-switch
      // the element mode when needed.
      btn.setAttribute('aria-disabled', disabled ? 'true' : 'false');
    });
    // Also grey out the element-mode buttons themselves when one is
    // active (it's the current selection, not a tool to invoke).
    this._modelerRoot.querySelectorAll('[data-modeler-kind="element"]').forEach(btn => {
      const id = btn.dataset.modelerId;
      btn.classList.toggle('disabled', id === this._currentElementMode);
    });
    this._modelerRoot.querySelectorAll('[data-modeler-gizmo]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.modelerGizmo === this._modelerGizmo);
    });
    const gizmoBtn = this._modelerRoot.querySelector('[data-modeler-gizmo-cycle]');
    if (gizmoBtn) {
      gizmoBtn.title = this._modelerGizmo[0].toUpperCase() + this._modelerGizmo.slice(1);
      gizmoBtn.innerHTML = _toolIcon(this._modelerGizmo);
    }
    const frameBtn = this._modelerRoot.querySelector('[data-modeler-frame-cycle]');
    if (frameBtn) {
      frameBtn.title = this._modelerFrame === 'world' ? 'Global' : 'Local';
      frameBtn.innerHTML = _toolIcon(this._modelerFrame);
    }
    const wireBtn = this._modelerRoot.querySelector('[data-modeler-wire-cycle]');
    if (wireBtn) {
      wireBtn.classList.toggle('active', this._modelerWireMode !== 'solid');
      wireBtn.title = this._modelerWireMode === 'wire' ? 'Wire Only' : this._modelerWireMode === 'solid' ? 'Solid Only' : 'Solid + Wire';
    }
    this._modelerRoot.querySelectorAll('[data-modeler-wire-option]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.modelerWireOption === this._modelerWireMode);
    });
    this._modelerRoot.querySelectorAll('[data-modeler-section]').forEach(section => {
      section.classList.toggle('active', section.dataset.modelerSection === this._modelerGroup);
    });
  }

  _makeModelerFloatable(el, boundsRoot, initial = {}) {
    if (!el || el._cycoModelerFloatable) return;
    el._cycoModelerFloatable = true;
    const rootWidth = boundsRoot.getBoundingClientRect().width;
    const x = initial.centerX ? Math.max(0, (rootWidth - el.offsetWidth) / 2) : (initial.x ?? el.offsetLeft);
    el.style.left = initial.right == null ? `${x}px` : 'auto';
    el.style.right = initial.right == null ? 'auto' : `${initial.right}px`;
    el.style.top = `${initial.y ?? el.offsetTop}px`;

    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('button,input,.cyco-modeler-resize-handle,.cyco-modeler-resize-handle-h,.cyco-modeler-resize-handle-c')) return;
      const rootRect = boundsRoot.getBoundingClientRect();
      const rect = el.getBoundingClientRect();
      const offsetX = e.clientX - rect.left;
      const offsetY = e.clientY - rect.top;
      el.setPointerCapture?.(e.pointerId);
      el.classList.add('dragging');

      const move = (ev) => {
        const x = Math.max(0, Math.min(ev.clientX - rootRect.left - offsetX, rootRect.width - rect.width));
        const y = Math.max(0, Math.min(ev.clientY - rootRect.top - offsetY, rootRect.height - rect.height));
        el.style.left = `${x}px`;
        el.style.right = 'auto';
        el.style.top = `${y}px`;
      };
      const up = () => {
        el.classList.remove('dragging');
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  }

  _makeModelerResizable(panel) {
    const handle = panel?.querySelector('.cyco-modeler-resize-handle');
    const hHandle = panel?.querySelector('.cyco-modeler-resize-handle-h');
    const cHandle = panel?.querySelector('.cyco-modeler-resize-handle-c');
    if (!panel) return;
    if (handle && !handle._cycoModelerResizable) {
      handle._cycoModelerResizable = true;
      handle.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const startWidth = panel.getBoundingClientRect().width;
        const move = (ev) => {
          const width = Math.max(64, Math.min(560, startWidth + (startX - ev.clientX)));
          panel.style.width = `${width}px`;
        };
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      });
    }
    if (hHandle && !hHandle._cycoModelerHResizable) {
      hHandle._cycoModelerHResizable = true;
      hHandle.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const startY = e.clientY;
        const startHeight = panel.getBoundingClientRect().height;
        const move = (ev) => {
          const height = Math.max(64, Math.min(window.innerHeight - 120, startHeight + (ev.clientY - startY)));
          panel.style.height = `${height}px`;
        };
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      });
    }
    if (cHandle && !cHandle._cycoModelerCResizable) {
      cHandle._cycoModelerCResizable = true;
      cHandle.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX;
        const startY = e.clientY;
        const startWidth = panel.getBoundingClientRect().width;
        const startHeight = panel.getBoundingClientRect().height;
        const move = (ev) => {
          const width = Math.max(64, Math.min(560, startWidth + (startX - ev.clientX)));
          const height = Math.max(64, Math.min(window.innerHeight - 120, startHeight + (ev.clientY - startY)));
          panel.style.width = `${width}px`;
          panel.style.height = `${height}px`;
        };
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      });
    }
  }

  // ── Drag-to-reorder for collapsible modeler tool sections ────────────────
  // Each `.cyco-modeler-tool-section` is draggable; the user grabs the
  // header and drops on another section to reorder. The new order is
  // persisted to localStorage so it survives reloads.

  _attachModelerSectionDnD(section, container) {
    if (!section || !container || section._cycoDndAttached) return;
    section._cycoDndAttached = true;

    section.addEventListener('dragstart', (e) => {
      // Only initiate a drag from the header — clicking the body shouldn't drag.
      const fromHeader = e.target.closest('.cyco-modeler-section-title');
      if (!fromHeader) {
        e.preventDefault();
        return;
      }
      section.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      // Some browsers (FF) require setData to actually start the drag.
      e.dataTransfer.setData('text/plain', section.dataset.modelerSection || '');
      fromHeader._cycoJustDragged = true;
    });

    section.addEventListener('dragend', () => {
      section.classList.remove('dragging');
      container.querySelectorAll('.cyco-modeler-tool-section').forEach(s => {
        s.classList.remove('drop-before', 'drop-after');
      });
    });

    section.addEventListener('dragover', (e) => {
      if (!container.querySelector('.cyco-modeler-tool-section.dragging')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const rect = section.getBoundingClientRect();
      const before = (e.clientY - rect.top) < rect.height / 2;
      section.classList.toggle('drop-before', before);
      section.classList.toggle('drop-after', !before);
    });

    section.addEventListener('dragleave', () => {
      section.classList.remove('drop-before', 'drop-after');
    });

    section.addEventListener('drop', (e) => {
      const dragging = container.querySelector('.cyco-modeler-tool-section.dragging');
      if (!dragging || dragging === section) return;
      e.preventDefault();
      const rect = section.getBoundingClientRect();
      const before = (e.clientY - rect.top) < rect.height / 2;
      if (before) container.insertBefore(dragging, section);
      else container.insertBefore(dragging, section.nextSibling);
      section.classList.remove('drop-before', 'drop-after');
      this._saveModelerSectionOrder(container);
    });
  }

  _loadModelerSectionOrder() {
    try {
      const raw = localStorage.getItem('cyco-modeler-section-order');
      if (!raw) return null;
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.filter(id => MODELER_TOOLS[id]) : null;
    } catch { return null; }
  }

  _saveModelerSectionOrder(container) {
    try {
      const order = Array.from(
        (container ?? this._modelerRoot?.querySelector('.cyco-modeler-sections'))
          ?.querySelectorAll('.cyco-modeler-tool-section') ?? []
      ).map(s => s.dataset.modelerSection).filter(Boolean);
      if (order.length) localStorage.setItem('cyco-modeler-section-order', JSON.stringify(order));
    } catch { /* localStorage unavailable — silently ignore */ }
  }

  // ── Top bar ─────────────────────────────────────────────────────────────────

  _buildTopBar() {
    const bar = document.createElement('div');
    bar.className = 'ce-vp-topbar';

    // Render mode button
    this._renderHandle = this._makeDropdownBtn(
      bar, _renderIcon(),
      () => RENDER_MODES.find(m => m.value === this._renderMode)?.label || 'Standard',
      () => this._buildRenderDropdown(),
    );

    bar.appendChild(_vpSep());

    // Camera view button
    this._cameraHandle = this._makeDropdownBtn(
      bar, _cameraIcon(),
      () => CAMERA_VIEWS.find(v => v.value === this._cameraView)?.label || 'Perspective',
      () => this._buildCameraDropdown(),
    );

    // ── Play / Stop ───────────────────────────────────────────────────────
    bar.appendChild(_vpSep());

    this._playBtn = document.createElement('button');
    this._playBtn.className = 'ce-vp-action-btn ce-vp-hist-btn';
    this._updatePlayBtn();
    this._playBtn.addEventListener('click', () => {
      if (this._playing) {
        window.dispatchEvent(new CustomEvent('cyco-runtime-stop'));
      } else {
        window.dispatchEvent(new CustomEvent('cyco-runtime-play'));
      }
    });
    bar.appendChild(this._playBtn);

    // ── Undo / History / Redo ─────────────────────────────────────────────
    bar.appendChild(_vpSep());

    this._undoBtn = document.createElement('button');
    this._undoBtn.className = 'ce-vp-action-btn ce-vp-hist-btn';
    this._undoBtn.title = 'Undo';
    this._undoBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 .49-4.91"></path></svg>';
    this._undoBtn.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('cyco-undo'));
    });
    bar.appendChild(this._undoBtn);

    // H — history dropdown
    this._histWrap = document.createElement('div');
    this._histWrap.className = 'ce-vp-dd-wrap';
    const histBtn = document.createElement('button');
    histBtn.className = 'ce-vp-action-btn ce-vp-hist-btn';
    histBtn.title = 'History';
    histBtn.textContent = 'H';
    histBtn.style.cssText = 'color:var(--ce-accent-orange,#e07228);font-weight:bold;font-size:15px;min-width:22px;padding:0 5px;border-radius:3px;';
    const histDd = document.createElement('div');
    histDd.className = 'ce-vp-dropdown';
    histDd.style.minWidth = '180px';
    this._histWrap.appendChild(histBtn);
    this._histWrap.appendChild(histDd);
    bar.appendChild(this._histWrap);
    histBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const wasOpen = this._histWrap.classList.contains('open');
      this._closeAllDropdowns();
      if (!wasOpen) {
        histDd.innerHTML = '';
        this._buildHistoryDropdown().forEach(el => histDd.appendChild(el));
        this._histWrap.classList.add('open');
      }
    });

    this._redoBtn = document.createElement('button');
    this._redoBtn.className = 'ce-vp-action-btn ce-vp-hist-btn';
    this._redoBtn.title = 'Redo';
    this._redoBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-.49-4.91"></path></svg>';
    this._redoBtn.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('cyco-redo'));
    });
    bar.appendChild(this._redoBtn);

    // ── Right-side panel actions ──────────────────────────────────────────
    const spacer = document.createElement('div');
    spacer.style.flex = '1';
    bar.appendChild(spacer);

    // Float
    const floatBtn = document.createElement('button');
    floatBtn.className = 'ce-vp-action-btn';
    this._vpFloatBtn = floatBtn;
    this._updateFloatBtn(floatBtn);
    floatBtn.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      this._startPanelDrag(e, floatBtn);
    });
    floatBtn.addEventListener('click', (e) => e.stopPropagation());
    bar.appendChild(floatBtn);

    // Size toggle
    this._vpSizeBtn = document.createElement('button');
    this._vpSizeBtn.className = 'ce-vp-action-btn';
    this._updateSizeBtn(this._vpSizeBtn);
    this._vpSizeBtn.addEventListener('click', () => this._cycleSizeState(this._vpSizeBtn));
    bar.appendChild(this._vpSizeBtn);

    // Close
    const closeBtn = document.createElement('button');
    closeBtn.className = 'ce-vp-action-btn ce-vp-close-btn';
    closeBtn.title = 'Close panel';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => { try { this._panelApi.close(); } catch(_) {} });
    bar.appendChild(closeBtn);

    return bar;
  }

  // Override base: hide the dockview tab row instead of populating it
  _addHeaderActions(api) {
    requestAnimationFrame(() => {
      const groupview = this._findGroupView();
      if (!groupview) return;
      const tabBar = groupview.querySelector('.dv-tabs-and-actions-container');
      if (tabBar) tabBar.style.display = 'none';
    });
  }

  // Walk up the DOM to find the dockview group container
  _findGroupView() {
    let el = this._el;
    while (el && el !== document.body) {
      if (el.classList && el.classList.contains('dv-groupview')) return el;
      el = el.parentElement;
    }
    return null;
  }

  // Override: also call _attachTabSnapBackBtn when floating via drag (_floatAtPosition)
  _floatAtPosition(clientX, clientY) {
    super._floatAtPosition(clientX, clientY);
    if (this._floating) {
      requestAnimationFrame(() => this._attachTabSnapBackBtn(this._vpFloatBtn));
    }
  }

  // Override: when floating via toggle button, move the snap-back button to the dockview tab strip
  _toggleFloat(btn) {
    if (!this._floating) {
      // Going to float — call super first
      super._toggleFloat(btn);
      if (this._floating) {
        // Success: defer so dockview finishes moving the panel to the floating group
        requestAnimationFrame(() => this._attachTabSnapBackBtn(btn));
      }
    } else {
      // Snapping back — clean up tab button reference, then call super
      this._tabSnapBtn = null;
      super._toggleFloat(btn);
    }
  }

  // Show the dockview tab strip on the floating group and inject a snap-back button
  _attachTabSnapBackBtn(vpFloatBtn) {
    // Hide the float button from the topbar while floating
    if (vpFloatBtn) vpFloatBtn.style.display = 'none';

    const groupview = this._findGroupView();
    if (!groupview) return;
    const tabBar = groupview.querySelector('.dv-tabs-and-actions-container');
    if (!tabBar) return;

    // Reveal the dockview tab strip so the Viewport tab + × are visible
    tabBar.style.display = '';

    // Add a snap-back button to the tab, next to the close ×
    const tab = tabBar.querySelector('.dv-default-tab');
    if (!tab) return;

    const snapBtn = document.createElement('button');
    snapBtn.className = 'ce-panel-action ce-vp-tab-snapback';
    this._updateFloatBtn(snapBtn); // sets SNAPBACK_SVG icon since this._floating is true
    snapBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._toggleFloat(vpFloatBtn);
    });
    tab.appendChild(snapBtn);
    this._tabSnapBtn = snapBtn;
  }

  _makeDropdownBtn(bar, iconSvg, getLabel, buildItems) {
    const wrap = document.createElement('div');
    wrap.className = 'ce-vp-dd-wrap';

    const btn = document.createElement('button');
    btn.className = 'ce-vp-dd-btn';

    const iconEl = document.createElement('span');
    iconEl.className = 'ce-vp-dd-icon';
    iconEl.innerHTML = iconSvg;

    const labelEl = document.createElement('span');
    labelEl.className = 'ce-vp-dd-label';
    labelEl.textContent = getLabel();

    const arrow = document.createElement('span');
    arrow.className = 'ce-vp-dd-arrow';
    arrow.textContent = '▾';

    btn.appendChild(iconEl);
    btn.appendChild(labelEl);
    btn.appendChild(arrow);
    wrap.appendChild(btn);

    const dd = document.createElement('div');
    dd.className = 'ce-vp-dropdown';
    wrap.appendChild(dd);
    bar.appendChild(wrap);

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const wasOpen = wrap.classList.contains('open');
      this._closeAllDropdowns();
      if (!wasOpen) {
        dd.innerHTML = '';
        buildItems().forEach(el => dd.appendChild(el));
        wrap.classList.add('open');
      }
    });

    return { wrap, labelEl, refresh: () => { labelEl.textContent = getLabel(); } };
  }

  _closeAllDropdowns() {
    if (this._topBar) {
      this._topBar.querySelectorAll('.ce-vp-dd-wrap.open').forEach(w => w.classList.remove('open'));
    }
  }

  _buildRenderDropdown() {
    const items = [];
    RENDER_MODES.forEach((m, i) => {
      if (m.value === 'wireframe') {
        items.push(this._buildWireframeDropdownItem(m));
        items.push(_ddSep());
      } else {
        items.push(_ddRadioRow(m.label, m.value === this._renderMode, () => {
          this._setRenderMode(m.value);
        }));
      }
    });
    return items;
  }

  _buildWireframeDropdownItem(mode) {
    const checked = this._renderMode === 'wireframe';
    const row = document.createElement('div');
    row.className = 'ce-vp-dd-row' + (checked ? ' selected' : '');
    const radio = document.createElement('span');
    radio.className = 'ce-vp-dd-radio' + (checked ? ' checked' : '');
    const label = document.createElement('span');
    label.textContent = mode.label;

    const toggle = document.createElement('button');
    toggle.className = 'ce-vp-dd-toggle-btn' + (this._skyWireframeVisible ? ' active' : '');
    toggle.title = 'Toggle sky dome/cube wireframe';
    toggle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3h18v18H3V3z"/><path d="M3 9h18"/><path d="M9 3v18"/><path d="M3 15h18"/><path d="M15 3v18"/></svg>';
    toggle.addEventListener('click', (event) => {
      event.stopPropagation();
      this._toggleSkyWireframe(!this._skyWireframeVisible);
      toggle.classList.toggle('active', this._skyWireframeVisible);
    });

    row.appendChild(radio);
    row.appendChild(label);
    row.appendChild(toggle);
    row.addEventListener('click', () => {
      this._setRenderMode(mode.value);
      row.closest('.ce-vp-dd-wrap')?.classList.remove('open');
    });
    return row;
  }

  _setRenderMode(mode) {
    if (this._renderMode === mode) return;
    if (this._renderMode !== 'wireframe') {
      this._previousRenderMode = this._renderMode;
    }
    this._renderMode = mode;
    this._renderHandle.refresh();
    window.dispatchEvent(new CustomEvent('cyco-vp-rendermode', { detail: { mode } }));
  }

  _onPhysicsEditMode(event) {
    this._physicsEdit = !!event.detail?.enabled;
  }

  _toggleSkyWireframe(enabled) {
    if (this._skyWireframeVisible === enabled) return;
    this._skyWireframeVisible = enabled;
    window.dispatchEvent(new CustomEvent('cyco-vp-skywireframe', { detail: { enabled } }));
  }

  _buildCameraDropdown() {
    const items = [];
    items.push(_ddCheckRow('Physics Edit Mode', this._physicsEdit, (v) => {
      this._physicsEdit = v;
      window.dispatchEvent(new CustomEvent('cyco-physics-edit-mode', { detail: { enabled: v } }));
    }));
    items.push(_ddSep());
    CAMERA_VIEWS.forEach(v => {
      items.push(_ddRadioRow(v.label, v.value === this._cameraView, () => {
        this._cameraView = v.value;
        this._cameraHandle.refresh();
        window.dispatchEvent(new CustomEvent('cyco-vp-camera', { detail: { view: v.value } }));
        if (v.value === 'camera') this._openCameraViewPanel();
      }));
    });
    return items;
  }

  /** Open CameraViewPanel as a floating dockview panel (or focus if already open). */
  _openCameraViewPanel() {
    const api = LayoutManager.api;
    if (!api) return;
    const existing = api.getPanel('camera-view-panel');
    if (existing) {
      try { existing.api.setActive(); } catch (_) {}
      return;
    }
    try {
      const floating = BasePanel.getSavedFloatingState('camera-view-panel', {
        x:      Math.round((window.innerWidth - 320) / 2),
        y:      Math.round(window.innerHeight * 0.18),
        width:  320,
        height: 240,
      });
      api.addPanel({
        id:        'camera-view-panel',
        component: 'CameraViewPanel',
        title:     'Camera View',
        floating,
      });
    } catch (e) {
      console.warn('[CenterPanel] Could not open CameraViewPanel:', e);
    }
  }

  // ── Phase 7: event handlers ───────────────────────────────────────────────

  _onHistoryChange(e) {
    const { history, currentIndex } = e.detail;
    this._history   = history   ?? [];
    this._histIndex = currentIndex ?? -1;
    const canUndo = this._histIndex >= 0;
    const canRedo = this._histIndex < this._history.length - 1;
    if (this._undoBtn) this._undoBtn.style.opacity = canUndo ? '1' : '0.4';
    if (this._redoBtn) this._redoBtn.style.opacity = canRedo ? '1' : '0.4';
  }

  _onRuntimeState(e) {
    this._playing = !!e.detail?.playing;
    this._updatePlayBtn();
  }

  /** Sync the viewport camera dropdown label when the editor camera is swapped. */
  _onEditorCamChanged(e) {
    const cam = e.detail?.camera;
    if (!cam || !this._cameraHandle) return;
    const newView = cam.isOrthographicCamera ? 'orthographic' : 'perspective';
    if (this._cameraView !== newView) {
      this._cameraView = newView;
      this._cameraHandle.refresh();
    }
  }

  _updatePlayBtn() {
    if (!this._playBtn) return;
    if (this._playing) {
      this._playBtn.innerHTML = '&#x2B21;'; // ⬡ stop
      this._playBtn.title     = 'Stop';
      this._playBtn.style.color = '#e84040';
    } else {
      this._playBtn.innerHTML = '&#x25B6;'; // ▶ play
      this._playBtn.title     = 'Play';
      this._playBtn.style.color = '#40c040';
    }
  }

  _buildHistoryDropdown() {
    if (this._history.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'ce-vp-dd-row';
      empty.style.opacity = '0.4';
      const lbl = document.createElement('span');
      lbl.textContent = 'No history';
      empty.appendChild(lbl);
      return [empty];
    }
    return this._history.map((entry, i) => {
      const row = document.createElement('div');
      row.className = 'ce-vp-dd-row' + (i === this._histIndex ? ' selected' : '');
      const radio = document.createElement('span');
      radio.className = 'ce-vp-dd-radio' + (i === this._histIndex ? ' checked' : '');
      const lbl = document.createElement('span');
      lbl.textContent = entry.name;
      row.appendChild(radio);
      row.appendChild(lbl);
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        window.__cyco?.commandManager?.jumpTo(i);
        this._histWrap?.classList.remove('open');
      });
      return row;
    });
  }
}

// ── Dropdown row builders ─────────────────────────────────────────────────────

function _ddRadioRow(label, checked, onSelect) {
  const row = document.createElement('div');
  row.className = 'ce-vp-dd-row' + (checked ? ' selected' : '');
  const radio = document.createElement('span');
  radio.className = 'ce-vp-dd-radio' + (checked ? ' checked' : '');
  const lbl = document.createElement('span');
  lbl.textContent = label;
  row.appendChild(radio);
  row.appendChild(lbl);
  row.addEventListener('click', (e) => {
    e.stopPropagation();
    const dd = row.closest('.ce-vp-dropdown');
    if (dd) {
      dd.querySelectorAll('.ce-vp-dd-radio').forEach(r => r.classList.remove('checked'));
      dd.querySelectorAll('.ce-vp-dd-row').forEach(r => r.classList.remove('selected'));
    }
    radio.classList.add('checked');
    row.classList.add('selected');
    onSelect();
    row.closest('.ce-vp-dd-wrap')?.classList.remove('open');
  });
  return row;
}

function _ddCheckRow(label, checked, onChange) {
  const row = document.createElement('div');
  row.className = 'ce-vp-dd-row';
  const box = document.createElement('span');
  box.className = 'ce-vp-dd-check' + (checked ? ' checked' : '');
  const lbl = document.createElement('span');
  lbl.textContent = label;
  row.appendChild(box);
  row.appendChild(lbl);
  row.addEventListener('click', (e) => {
    e.stopPropagation();
    checked = !checked;
    box.classList.toggle('checked', checked);
    onChange(checked);
  });
  return row;
}

function _ddActionRow(label, action) {
  const row = document.createElement('div');
  row.className = 'ce-vp-dd-row ce-vp-dd-action';
  const lbl = document.createElement('span');
  lbl.textContent = label;
  row.appendChild(lbl);
  row.addEventListener('click', (e) => {
    e.stopPropagation();
    row.closest('.ce-vp-dd-wrap')?.classList.remove('open');
    action();
  });
  return row;
}

function _ddSep() {
  const s = document.createElement('div');
  s.className = 'ce-vp-dd-sep';
  return s;
}

// ── Misc helpers ──────────────────────────────────────────────────────────────

function _vpSep() {
  const s = document.createElement('div');
  s.className = 'ce-vp-topbar-sep';
  return s;
}

function _toolSep() {
  const s = document.createElement('div');
  s.className = 'ce-vp-tool-sep';
  return s;
}

function _toolBtn(svgHtml, tip, onClick) {
  const btn = document.createElement('button');
  btn.className = 'ce-vp-tool-btn';
  btn.title = tip;
  btn.innerHTML = svgHtml;
  btn.addEventListener('click', onClick);
  return btn;
}

function _modelerLabel(text) {
  const label = document.createElement('div');
  label.className = 'cyco-modeler-label';
  label.textContent = text;
  return label;
}

function _modelerSep() {
  const sep = document.createElement('div');
  sep.className = 'cyco-modeler-sep';
  return sep;
}

function _modelerPanelTitle(text) {
  const title = document.createElement('div');
  title.className = 'cyco-modeler-panel-title';
  title.textContent = text;
  return title;
}

function _modelerField(labelText, value) {
  const row = document.createElement('label');
  row.className = 'cyco-modeler-field';
  const label = document.createElement('span');
  label.textContent = labelText;
  const input = document.createElement('input');
  input.type = 'number';
  input.step = '0.01';
  input.value = value;
  row.appendChild(label);
  row.appendChild(input);
  return row;
}

// ── SVG Icons ─────────────────────────────────────────────────────────────────

function _toolIcon(id) {
  switch (id) {
    case 'translate': return `<svg viewBox="0 0 20 20" width="17" height="17" fill="currentColor">
      <path d="M10 1.5 L8 5H9.5V9.5H5V8L1.5 10 5 12V10.5H9.5V15H8L10 18.5 12 15H10.5V10.5H15V12L18.5 10 15 8V9.5H10.5V5H12Z"/>
    </svg>`;
    case 'rotate': return `<svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
      <path d="M15.5 6.5A7 7 0 1 0 17 10.5"/>
      <polyline points="13.5,3 17,6.5 13.5,8.5" fill="currentColor" stroke="none"/>
    </svg>`;
    case 'scale': return `<svg viewBox="0 0 20 20" width="17" height="17" fill="currentColor">
      <path d="M12.5 2.5H17.5V7.5L15.5 5.5 10.5 10.5 9.5 9.5 14.5 4.5Z"/>
      <path d="M7.5 17.5H2.5V12.5L4.5 14.5 9.5 9.5 10.5 10.5 5.5 15.5Z"/>
    </svg>`;
    case 'rect': return `<svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="3 2">
      <rect x="3.5" y="3.5" width="13" height="13" rx="1"/>
      <circle cx="3.5" cy="3.5" r="1.8" fill="currentColor" stroke="none"/>
      <circle cx="16.5" cy="3.5" r="1.8" fill="currentColor" stroke="none"/>
      <circle cx="3.5" cy="16.5" r="1.8" fill="currentColor" stroke="none"/>
      <circle cx="16.5" cy="16.5" r="1.8" fill="currentColor" stroke="none"/>
    </svg>`;
    case 'world': return `<svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.4">
      <circle cx="10" cy="10" r="7.5"/>
      <ellipse cx="10" cy="10" rx="3.8" ry="7.5"/>
      <line x1="2.5" y1="10" x2="17.5" y2="10"/>
      <line x1="3.2" y1="6.5" x2="16.8" y2="6.5"/>
      <line x1="3.2" y1="13.5" x2="16.8" y2="13.5"/>
    </svg>`;
    case 'local': return `<svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke-width="2" stroke-linecap="round">
      <line x1="10" y1="10" x2="17" y2="10" stroke="#e07228"/>
      <line x1="10" y1="10" x2="10" y2="3" stroke="#6ab26a"/>
      <line x1="10" y1="10" x2="4" y2="15" stroke="#4d93e8"/>
      <circle cx="10" cy="10" r="1.8" fill="currentColor" stroke="currentColor"/>
    </svg>`;
    case 'snap': return `<svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round">
      <path d="M5.5 3 L5.5 11 A4.5 4.5 0 0 0 14.5 11 L14.5 3"/>
    </svg>`;
    case 'search': return `<svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
      <circle cx="8.5" cy="8.5" r="5.5"/>
      <line x1="12.8" y1="12.8" x2="17" y2="17"/>
    </svg>`;
    case 'settings': return `<svg viewBox="0 0 20 20" width="20" height="20" class="cyco-modeler-gear-icon">
      <defs>
        <linearGradient id="cyco-gear-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#ffc488"/>
          <stop offset="50%" stop-color="#e07228"/>
          <stop offset="100%" stop-color="#a84816"/>
        </linearGradient>
        <radialGradient id="cyco-gear-shine" cx="0.35" cy="0.3" r="0.7">
          <stop offset="0%" stop-color="#ffffff" stop-opacity="0.55"/>
          <stop offset="55%" stop-color="#ffffff" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <g fill="url(#cyco-gear-grad)" stroke="#5a2a0c" stroke-width="0.55" stroke-linejoin="round">
        <rect x="8.4" y="1.4" width="3.2" height="3.4" rx="0.6"/>
        <rect x="8.4" y="15.2" width="3.2" height="3.4" rx="0.6"/>
        <rect x="1.4" y="8.4" width="3.4" height="3.2" rx="0.6"/>
        <rect x="15.2" y="8.4" width="3.4" height="3.2" rx="0.6"/>
        <rect x="3.6" y="3.6" width="2.6" height="2.6" rx="0.5" transform="rotate(45 4.9 4.9)"/>
        <rect x="13.8" y="3.6" width="2.6" height="2.6" rx="0.5" transform="rotate(45 15.1 4.9)"/>
        <rect x="3.6" y="13.8" width="2.6" height="2.6" rx="0.5" transform="rotate(45 4.9 15.1)"/>
        <rect x="13.8" y="13.8" width="2.6" height="2.6" rx="0.5" transform="rotate(45 15.1 15.1)"/>
        <circle cx="10" cy="10" r="6"/>
      </g>
      <circle cx="10" cy="10" r="6" fill="url(#cyco-gear-shine)"/>
      <circle cx="10" cy="10" r="2.4" fill="#1a1a1a" stroke="#ffd9b0" stroke-width="0.55"/>
    </svg>`;
    case 'wireframe': return `<svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round">
      <path d="M4 6.5 10 3 16 6.5V13.5L10 17 4 13.5Z"/>
      <path d="M4 6.5 10 10 16 6.5M10 10V17M4 13.5 10 10 16 13.5"/>
    </svg>`;
    case 'standard': return `<svg viewBox="0 0 20 20" width="17" height="17" fill="currentColor">
      <path d="M10 2.5 16 6V14L10 17.5 4 14V6Z" opacity="0.9"/>
      <path d="M10 2.5V10L16 6" opacity="0.35"/>
    </svg>`;
    case 'focus': return `<svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
      <circle cx="10" cy="10" r="3"/>
      <line x1="10" y1="2" x2="10" y2="5"/>
      <line x1="10" y1="15" x2="10" y2="18"/>
      <line x1="2" y1="10" x2="5" y2="10"/>
      <line x1="15" y1="10" x2="18" y2="10"/>
    </svg>`;
    default: return '';
  }
}

function _renderIcon() {
  return `<svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
    <rect x="2" y="2" width="5" height="5" rx="0.5" opacity="0.4"/>
    <rect x="9" y="2" width="5" height="5" rx="0.5" opacity="0.4"/>
    <rect x="2" y="9" width="5" height="5" rx="0.5" opacity="0.4"/>
    <rect x="9" y="9" width="5" height="5" rx="0.5"/>
  </svg>`;
}

function _cameraIcon() {
  return `<svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
    <path d="M1 5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V5z"/>
    <path d="M11 7.2l3-1.7v5l-3-1.7V7.2z"/>
  </svg>`;
}
