import * as THREE from 'three';

/**
 * ComponentPicker.js — Dockable component picker panel helper.
 * Opened by the "Add Component" button in ObjectProperties.
 *
 * Usage:
 *   ComponentPicker.show(anchorElement, (type) => { ... });
 *   ComponentPicker.defaultParams(type, object) → {type, ...defaults}
 */

export const COMPONENT_TABS = [
  {
    id: '2d',
    label: '2D',
    groups: [
      {
        id: 'physics',
        label: 'Physics',
        components: [
          { type: 'Rigid Body',           desc: 'Simulated physics body' },
          { type: 'Character Controller', desc: 'Physics character movement' },
          { type: 'Joint',                desc: 'Connect two bodies' },
        ],
      },
      {
        id: 'colliders',
        label: 'Colliders',
        components: [
          { type: 'Box Collider',     desc: 'Axis-aligned box shape' },
          { type: 'Sphere Collider',  desc: 'Sphere collision shape' },
          { type: 'Capsule Collider', desc: 'Capsule collision shape' },
          { type: 'Mesh Collider',    desc: 'ConvexHull or TriMesh shape' },
        ],
      },
      {
        id: 'triggers',
        label: 'Triggers',
        components: [
          { type: 'Box Trigger',     desc: 'Box-shaped sensor volume' },
          { type: 'Sphere Trigger',  desc: 'Sphere-shaped sensor volume' },
          { type: 'Capsule Trigger', desc: 'Capsule-shaped sensor volume' },
          { type: 'Mesh Trigger',    desc: 'Mesh-based sensor volume' },
        ],
      },
      {
        id: 'advanced',
        label: 'Advanced',
        components: [
          { type: 'Ragdoll', desc: 'Articulated ragdoll preset' },
        ],
      },
    ],
  },
  {
    id: '3d',
    label: '3D',
    groups: [
      {
        id: 'physics',
        label: 'Physics',
        components: [
          { type: 'Rigid Body',           desc: 'Simulated physics body' },
          { type: 'Character Controller', desc: 'Physics character movement' },
          { type: 'Joint',                desc: 'Connect two bodies' },
        ],
      },
      {
        id: 'colliders',
        label: 'Colliders',
        components: [
          { type: 'Box Collider',     desc: 'Axis-aligned box shape' },
          { type: 'Sphere Collider',  desc: 'Sphere collision shape' },
          { type: 'Capsule Collider', desc: 'Capsule collision shape' },
          { type: 'Mesh Collider',    desc: 'ConvexHull or TriMesh shape' },
        ],
      },
      {
        id: 'triggers',
        label: 'Triggers',
        components: [
          { type: 'Box Trigger',     desc: 'Box-shaped sensor volume' },
          { type: 'Sphere Trigger',  desc: 'Sphere-shaped sensor volume' },
          { type: 'Capsule Trigger', desc: 'Capsule-shaped sensor volume' },
          { type: 'Mesh Trigger',    desc: 'Mesh-based sensor volume' },
        ],
      },
      {
        id: 'advanced',
        label: 'Advanced',
        components: [
          { type: 'Ragdoll', desc: 'Articulated ragdoll preset' },
        ],
      },
    ],
  },
  {
    id: 'script',
    label: 'Script',
    groups: [
      {
        id: 'scripting',
        label: 'Scripting',
        components: [
          { type: 'Script', desc: 'Custom game script (stub)' },
        ],
      },
    ],
  },
  {
    id: 'ui',
    label: 'UI',
    groups: [
      {
        id: 'ui',
        label: 'UI',
        components: [
          { type: 'UI Panel', desc: 'User interface container stub' },
          { type: 'UI Button', desc: 'Interactive button stub' },
          { type: 'UI Text', desc: 'Display text label stub' },
        ],
      },
    ],
  },
  {
    id: 'audio',
    label: 'Audio',
    groups: [
      {
        id: 'audio',
        label: 'Audio',
        components: [
          { type: 'Audio Source', desc: 'Spatial audio emitter (stub)' },
        ],
      },
    ],
  },
];

const DEFAULTS = {
  'Rigid Body':            { type: 'Rigid Body',           bodyType: 'dynamic', mass: 1, linearDamping: 0, angularDamping: 0, lockRotation: false },
  'Box Collider':          { type: 'Box Collider',         isTrigger: false, friction: 0.5, restitution: 0, scale: { x: 0.5, y: 0.5, z: 0.5 } },
  'Sphere Collider':       { type: 'Sphere Collider',      isTrigger: false, friction: 0.5, restitution: 0, scale: { x: 0.5, y: 0.5, z: 0.5 } },
  'Capsule Collider':      { type: 'Capsule Collider',     isTrigger: false, scale: { x: 0.25, y: 0.5, z: 0.25 } },
  'Mesh Collider':         { type: 'Mesh Collider',        mode: 'convexHull', isTrigger: false },
  'Box Trigger':           { type: 'Box Trigger',          isTrigger: true, scale: { x: 0.5, y: 0.5, z: 0.5 } },
  'Sphere Trigger':        { type: 'Sphere Trigger',       isTrigger: true, scale: { x: 0.5, y: 0.5, z: 0.5 } },
  'Capsule Trigger':       { type: 'Capsule Trigger',      isTrigger: true, scale: { x: 0.25, y: 0.5, z: 0.25 } },
  'Mesh Trigger':          { type: 'Mesh Trigger',         mode: 'convexHull', isTrigger: true },
  'Character Controller':  { type: 'Character Controller', offset: 0.01, maxSlopeAngle: 45, autoStepHeight: 0.25, snapToGround: true, moveSpeed: 5, jumpVelocity: 8, controlled: true },
  'Joint':                 { type: 'Joint',                jointType: 'fixed', targetUuid: '', axis: { x: 0, y: 1, z: 0 }, anchorA: { x: 0, y: 0, z: 0 }, anchorB: { x: 0, y: 0, z: 0 } },
  'Ragdoll':               { type: 'Ragdoll', preset: 'humanoid' },
  'Script':                { type: 'Script', path: '', onStart: '', onDestroy: '' },
  'UI Panel':              { type: 'UI Panel', title: 'Panel', layout: 'vertical' },
  'UI Button':             { type: 'UI Button', label: 'Button', onClick: '' },
  'UI Text':               { type: 'UI Text', text: 'Label', fontSize: 14 },
  'Audio Source':          { type: 'Audio Source', src: '', loop: false, autoPlay: false, volume: 1 },
};

let _pendingSelect = null;
let _outsideClickHandler = null;
let _anchorElement = null;

function _removeOutsideClickListener() {
  if (!_outsideClickHandler) return;
  document.removeEventListener('pointerdown', _outsideClickHandler, true);
  document.removeEventListener('mousedown', _outsideClickHandler, true);
  document.removeEventListener('touchstart', _outsideClickHandler, true);
  _outsideClickHandler = null;
  _anchorElement = null;
}

function _setupOutsideClickListener(panelId, anchor) {
  _removeOutsideClickListener();
  _anchorElement = anchor || null;
  _outsideClickHandler = (event) => {
    const panel = window.__cyco?.dockviewApi?.getPanel(panelId);
    if (!panel) {
      _removeOutsideClickListener();
      return;
    }

    const groupEl = panel.api.group?.element;
    if (groupEl && groupEl.contains(event.target)) return;
    if (_anchorElement && _anchorElement.contains(event.target)) return;

    panel.api.close?.();
    _removeOutsideClickListener();
  };

  document.addEventListener('pointerdown', _outsideClickHandler, true);
  document.addEventListener('mousedown', _outsideClickHandler, true);
  document.addEventListener('touchstart', _outsideClickHandler, true);
}

export const ComponentPicker = {
  /**
   * Show the component picker as a dockable panel, calling `onSelect(type)` when chosen.
   * @param {HTMLElement} _anchor
   * @param {(type: string) => void} onSelect
   */
  show(_anchor, onSelect) {
    _pendingSelect = onSelect;
    const dvApi = window.__cyco?.dockviewApi;
    if (!dvApi) {
      console.warn('[ComponentPicker] dockview API unavailable; cannot open dockable picker.');
      return;
    }

    const existing = dvApi.getPanel('component-picker');
    if (existing) {
      try {
        existing.api.group.api.setActive?.();
      } catch (_) {}
      return;
    }

    const anchorRect = _anchor?.getBoundingClientRect();
    const edgeMargin = 28;
    const width = Math.min(280, window.innerWidth - edgeMargin * 2);
    const height = Math.min(360, window.innerHeight - edgeMargin * 2);
    let x = Math.round((window.innerWidth - width) / 2);
    let y = Math.round(window.innerHeight * 0.14);

    if (anchorRect) {
      const rightSide = Math.round(anchorRect.right + 18);
      const leftSide = Math.round(anchorRect.left - width - 18);
      const centerAlign = Math.round(anchorRect.left + anchorRect.width / 2 - width / 2 + 12);
      const rightEdgeOffset = Math.round(window.innerWidth - width - 100);
      if (rightEdgeOffset >= edgeMargin) {
        x = rightEdgeOffset;
      } else if (centerAlign >= edgeMargin && centerAlign + width <= window.innerWidth - edgeMargin) {
        x = centerAlign;
      } else if (rightSide + width <= window.innerWidth - edgeMargin) {
        x = rightSide;
      } else if (leftSide >= edgeMargin) {
        x = leftSide;
      } else {
        x = Math.min(Math.max(edgeMargin, Math.round(anchorRect.left + 8)), window.innerWidth - width - edgeMargin);
      }
      const above = Math.round(anchorRect.top - height - 12);
      const below = Math.round(anchorRect.bottom + 12);
      if (above >= edgeMargin) {
        y = above;
      } else if (below + height <= window.innerHeight - edgeMargin) {
        y = below;
      } else {
        y = Math.min(Math.max(edgeMargin, above), window.innerHeight - height - edgeMargin);
      }
    } else {
      x = Math.max(edgeMargin, window.innerWidth - width - 100);
      y = Math.min(Math.max(edgeMargin, Math.round(window.innerHeight * 0.14)), window.innerHeight - height - edgeMargin);
    }

    dvApi.addPanel({
      id: 'component-picker',
      component: 'ComponentPickerPanel',
      title: 'Add Component',
      floating: {
        x,
        y,
        width,
        height,
      },
    });

    _setupOutsideClickListener('component-picker', _anchor);
  },

  _fireSelect(type) {
    const cb = _pendingSelect;
    _pendingSelect = null;
    _removeOutsideClickListener();
    if (typeof cb === 'function') cb(type);
  },

  /**
   * Return a fresh default-params object for the given component type.
   * Optionally derive collider size from the target object.
   * @param {string} type
   * @param {import('three').Object3D} [object]
   * @returns {object}
   */
  defaultParams(type, object) {
    const tmpl = DEFAULTS[type];
    if (!tmpl) return { type };
    const result = JSON.parse(JSON.stringify(tmpl)); // deep clone

    if (!object || !['Box Collider', 'Sphere Collider', 'Capsule Collider', 'Mesh Collider',
      'Box Trigger', 'Sphere Trigger', 'Capsule Trigger', 'Mesh Trigger'].includes(type)) {
      return result;
    }

    // Ensure world matrix is up to date
    object.updateMatrixWorld(true);

    // Compute the world-space bounds for the object. This handles scale, rotation,
    // hierarchy, and any children that contribute to the shape.
    const bbox = new THREE.Box3().setFromObject(object);

    if (!bbox.isEmpty()) {
      const size = new THREE.Vector3();
      bbox.getSize(size);
      const maxSize = Math.max(size.x, size.y, size.z, 0.01);
      switch (type) {
        case 'Box Collider':
        case 'Box Trigger':
          result.halfExtents = {
            x: Math.max(size.x * 0.5, 0.05),
            y: Math.max(size.y * 0.5, 0.05),
            z: Math.max(size.z * 0.5, 0.05),
          };
          break;
        case 'Sphere Collider':
        case 'Sphere Trigger': {
          const sphere = new THREE.Sphere();
          bbox.getBoundingSphere(sphere);
          result.radius = Math.max(sphere.radius, 0.05);
          break;
        }
        case 'Capsule Collider':
        case 'Capsule Trigger': {
          const radius = Math.max(Math.min(size.x, size.z) * 0.5, 0.05);
          result.radius = radius;
          result.halfHeight = Math.max(size.y * 0.5 - radius, 0.05);
          break;
        }
        default:
          break;
      }
    }

    return result;
  },
};
