/**
 * ObjectProperties.js — Properties panel for mesh / group / generic Object3D.
 * Shows: Transform (position/rotation/scale), Geometry info, Material controls.
 *
 * Syncs transform display back from Three.js at ~10 Hz (e.g. after gizmo move).
 */

import * as THREE from 'three';
import { section, row, vec3, readOnly, colorSwatch, slider, numInput, nameHeader, checkbox, select } from './propUtils.js';
import { ComponentPicker } from '../ui/ComponentPicker.js';

const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;

function colorToHex(c) {
  return '#' + c.getHexString();
}

export class ObjectProperties {
  /** @param {THREE.Object3D} object */
  constructor(object) {
    this.object  = object;
    this._el     = document.createElement('div');
    this._el.className = 'ce-props-panel';

    this._posVec = null;
    this._rotVec = null;
    this._sclVec = null;
    this._elapsed = 0;
    this._onTick  = this._onTick.bind(this);

    this._build();
    window.addEventListener('cyco-vp-tick', this._onTick);
  }

  get element() { return this._el; }

  // ── Build ──────────────────────────────────────────────────────────────────

  _build() {
    const obj = this.object;
    if (!obj) return;

    // Name header
    this._el.appendChild(nameHeader(obj.name || '(unnamed)', obj.type));

    // Transform
    this._buildTransform(obj);

    // Geometry (meshes only)
    if (obj.isMesh || obj.isSkinnedMesh || obj.isInstancedMesh) {
      this._buildGeometry(obj);
    }

    // Material(s)
    const mat = obj.material;
    if (mat) {
      const mats = Array.isArray(mat) ? mat : [mat];
      mats.forEach((m, idx) => {
        const title = mats.length > 1 ? `Material [${idx}]` : 'Material';
        this._buildMaterial(m, title, obj);
      });
    }

    // Shadow (meshes and groups only — not cameras/lights/helpers)
    if (!obj.isLight && !obj.isCamera && !obj.userData?._isHelper) {
      this._buildShadow(obj);
    }

    // Physics components
    this._buildComponents(obj);
  }

  _buildTransform(obj) {
    const { el: sec, body } = section('Transform');

    const posV = vec3((axis, val) => obj.position.setComponent(axis, val));
    const rotV = vec3((axis, val) => {
      const arr = [obj.rotation.x, obj.rotation.y, obj.rotation.z];
      arr[axis] = val * DEG2RAD;
      obj.rotation.set(arr[0], arr[1], arr[2]);
    });
    const sclV = vec3((axis, val) => obj.scale.setComponent(axis, val));

    body.appendChild(row('Position', posV.el));
    body.appendChild(row('Rotation', rotV.el));
    body.appendChild(row('Scale',    sclV.el));

    this._el.appendChild(sec);
    this._posVec = posV;
    this._rotVec = rotV;
    this._sclVec = sclV;
    this._syncTransform();
  }

  _buildGeometry(obj) {
    const geo = obj.geometry;
    if (!geo) return;

    const { el: sec, body } = section('Geometry');
    const typeName  = geo.type ?? geo.constructor?.name ?? 'BufferGeometry';
    const vertCount = geo.attributes?.position?.count ?? 0;
    const faceCount = geo.index
      ? Math.round(geo.index.count / 3)
      : Math.round(vertCount / 3);

    body.appendChild(row('Type',     readOnly(typeName)));
    body.appendChild(row('Vertices', readOnly(String(vertCount))));
    body.appendChild(row('Faces',    readOnly(String(faceCount))));

    if (obj.isInstancedMesh) {
      body.appendChild(row('Count', readOnly(String(obj.count))));
    }

    this._el.appendChild(sec);
  }

  _buildMaterial(m, title, obj) {
    const { el: sec, body } = section(title);
    body.appendChild(row('Type', readOnly(m.type ?? m.constructor?.name ?? 'Material')));

    if (m.color !== undefined) {
      const sw = colorSwatch({
        color:    colorToHex(m.color),
        onChange: (hex) => { m.color.set(hex); m.needsUpdate = true; },
      });
      body.appendChild(row('Color', sw.el));
    }

    if (m.emissive !== undefined) {
      const sw = colorSwatch({
        color:    colorToHex(m.emissive),
        onChange: (hex) => { m.emissive.set(hex); m.needsUpdate = true; },
      });
      body.appendChild(row('Emissive', sw.el));
    }

    if (m.emissiveIntensity !== undefined) {
      const s = slider({ value: m.emissiveIntensity, min: 0, max: 20, step: 0.1,
        onChange: (v) => { m.emissiveIntensity = v; m.needsUpdate = true; } });
      body.appendChild(row('Emissive Intensity', s.el));
    }

    if (m.roughness !== undefined) {
      const s = slider({ value: m.roughness, min: 0, max: 1, step: 0.01,
        onChange: (v) => { m.roughness = v; m.needsUpdate = true; } });
      body.appendChild(row('Roughness', s.el));
    }

    if (m.metalness !== undefined) {
      const s = slider({ value: m.metalness, min: 0, max: 1, step: 0.01,
        onChange: (v) => { m.metalness = v; m.needsUpdate = true; } });
      body.appendChild(row('Metalness', s.el));
    }

    if (m.opacity !== undefined) {
      const s = slider({ value: m.opacity, min: 0, max: 1, step: 0.01,
        onChange: (v) => { m.opacity = v; m.transparent = v < 1; m.needsUpdate = true; } });
      body.appendChild(row('Opacity', s.el));
    }

    if (m.wireframe !== undefined) {
      const cb = document.createElement('input');
      cb.type    = 'checkbox';
      cb.checked = m.wireframe;
      cb.className = 'ce-prop-checkbox';
      cb.addEventListener('change', () => { m.wireframe = cb.checked; });
      body.appendChild(row('Wireframe', cb));
    }

    // Side selector — controls which faces are rendered
    {
      const sideEl = document.createElement('select');
      sideEl.className = 'ce-prop-select';
      sideEl.style.cssText = 'width:100%;background:#2a2a2a;color:#ccc;border:1px solid #444;border-radius:3px;padding:2px 4px;font-size:11px;';
      [
        ['Front Side',  THREE.FrontSide],
        ['Back Side',   THREE.BackSide],
        ['Double Side', THREE.DoubleSide],
      ].forEach(([label, val]) => {
        const opt = document.createElement('option');
        opt.value       = val;
        opt.textContent = label;
        opt.selected    = (m.side ?? THREE.FrontSide) === val;
        sideEl.appendChild(opt);
      });
      sideEl.addEventListener('change', () => {
        m.side = parseInt(sideEl.value, 10);
        m.needsUpdate = true;
      });
      body.appendChild(row('Side', sideEl));
    }

    // Environment reflection — preset (scene-level) + per-material intensity
    {
      const envSel = document.createElement('select');
      envSel.className = 'ce-prop-select';
      envSel.style.cssText = 'width:100%;background:#2a2a2a;color:#ccc;border:1px solid #444;border-radius:3px;padding:2px 4px;font-size:11px;';
      [
        ['Room (Default)', 'room'],
        ['Studio White',   'studio'],
        ['Sunny Midday',   'sunny'],
        ['Golden Hour',    'golden'],
        ['Overcast Sky',   'overcast'],
        ['Night Sky',      'night'],
      ].forEach(([label, val]) => {
        const opt = document.createElement('option');
        opt.value = val; opt.textContent = label;
        envSel.appendChild(opt);
      });
      // Reflect the current scene preset if stored
      const curPreset = window.__cyco?.viewportEngine?._currentEnvPreset ?? 'room';
      envSel.value = curPreset;
      envSel.addEventListener('change', () => {
        window.dispatchEvent(new CustomEvent('cyco-env-preset', { detail: { preset: envSel.value } }));
        if (window.__cyco?.viewportEngine) window.__cyco.viewportEngine._currentEnvPreset = envSel.value;
      });
      body.appendChild(row('Env Reflection', envSel));
    }

    // Scene-level environment intensity — how strongly the env map illuminates all materials
    {
      const curIntensity = window.__cyco?.viewportEngine?.scene?.environmentIntensity ?? 1;
      const s = slider({ value: curIntensity, min: 0, max: 5, step: 0.05,
        onChange: (v) => {
          window.dispatchEvent(new CustomEvent('cyco-env-intensity', { detail: { intensity: v } }));
        },
      });
      body.appendChild(row('Env Intensity', s.el));
    }

    // Flip normals — reverses every vertex normal so inside-out meshes render correctly
    if (obj.isMesh || obj.isSkinnedMesh) {
      const flipBtn = document.createElement('button');
      flipBtn.textContent = 'Flip Normals';
      flipBtn.className   = 'ce-prop-btn';
      flipBtn.style.cssText = 'width:100%;padding:3px 6px;background:#2a2a2a;color:#ccc;border:1px solid #444;border-radius:3px;font-size:11px;cursor:pointer;';
      flipBtn.addEventListener('click', () => {
        const nAttr = obj.geometry?.attributes?.normal;
        if (nAttr) {
          for (let i = 0; i < nAttr.count; i++) {
            nAttr.setXYZ(i, -nAttr.getX(i), -nAttr.getY(i), -nAttr.getZ(i));
          }
          nAttr.needsUpdate = true;
        }
        m.side = m.side === THREE.FrontSide ? THREE.BackSide
               : m.side === THREE.BackSide  ? THREE.FrontSide
               : THREE.DoubleSide;
        m.needsUpdate = true;
      });
      body.appendChild(row('Normals', flipBtn));
    }

    this._el.appendChild(sec);
  }

  // ── Physics Components ────────────────────────────────────────────────────

  _buildComponents(obj) {
    // Ensure userData.physics structure exists
    if (!obj.userData.physics) obj.userData.physics = {};
    if (!Array.isArray(obj.userData.physics.components)) obj.userData.physics.components = [];

    const components = obj.userData.physics.components;

    // ── Existing component sections ──────────────────────────────────────
    components.forEach((comp, idx) => {
      const sec = this._buildComponentSection(comp, obj, idx);
      if (sec) this._el.appendChild(sec);
    });

    // ── Add Component button ─────────────────────────────────────────────
    const addBtn = document.createElement('button');
    addBtn.textContent = '+ Add Component';
    addBtn.style.cssText = `
      display:block;width:100%;margin:8px 0 4px;padding:6px;
      background:var(--bg2,#1e1e1e);border:1px dashed var(--border-color,#444);
      color:var(--text-muted,#888);cursor:pointer;font-size:11px;
      border-radius:3px;transition:color .15s,border-color .15s;
    `;
    addBtn.addEventListener('mouseenter', () => {
      addBtn.style.color = 'var(--ce-accent-orange)';
      addBtn.style.borderColor = 'var(--ce-accent-orange)';
    });
    addBtn.addEventListener('mouseleave', () => {
      addBtn.style.color = 'var(--text-muted,#888)';
      addBtn.style.borderColor = 'var(--border-color,#444)';
    });
    addBtn.addEventListener('click', (e) => {
      ComponentPicker.show(e.currentTarget, (type) => {
        // Prevent duplicate Rigid Body or Character Controller
        const singles = ['Rigid Body', 'Character Controller', 'Ragdoll'];
        if (singles.includes(type) && components.some(c => c.type === type)) {
          console.warn(`[ObjectProperties] Only one "${type}" per object.`);
          return;
        }
        const comp = ComponentPicker.defaultParams(type, obj);
        components.push(comp);
        // Rebuild the panel to show new component
        this._el.innerHTML = '';
        this._posVec = null; this._rotVec = null; this._sclVec = null;
        this._build();
      });
    });
    this._el.appendChild(addBtn);
  }

  /**
   * Build a collapsible section for a single physics component.
   * @param {object} comp
   * @param {THREE.Object3D} obj
   * @param {number} idx
   */
  _buildComponentSection(comp, obj, idx) {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = 'margin-bottom:4px;';

    // ── Header ───────────────────────────────────────────────────────────
    const header = document.createElement('div');
    header.style.cssText = `
      display:flex;align-items:center;justify-content:space-between;
      padding:5px 8px;background:var(--bg2,#1e1e1e);
      border:1px solid var(--border-color,#333);border-radius:3px;
      cursor:pointer;user-select:none;
    `;

    const titleSpan = document.createElement('span');
    titleSpan.textContent = comp.type;
    titleSpan.style.cssText = 'font-size:11px;font-weight:600;color:var(--text-bright,#fff);';

    const removeBtn = document.createElement('button');
    removeBtn.textContent = '×';
    removeBtn.title = 'Remove component';
    removeBtn.style.cssText = `
      background:none;border:none;color:var(--text-muted,#888);
      cursor:pointer;font-size:14px;line-height:1;padding:0 2px;
      transition:color .15s;
    `;
    removeBtn.addEventListener('mouseenter', () => { removeBtn.style.color = '#e07272'; });
    removeBtn.addEventListener('mouseleave', () => { removeBtn.style.color = 'var(--text-muted,#888)'; });
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      obj.userData.physics.components.splice(idx, 1);
      this._el.innerHTML = '';
      this._posVec = null; this._rotVec = null; this._sclVec = null;
      this._build();
    });

    // Toggle collapse
    let collapsed = false;
    const body = document.createElement('div');
    body.style.cssText = 'padding:8px;background:var(--bg,#141414);border:1px solid var(--border-color,#333);border-top:none;border-radius:0 0 3px 3px;';
    header.addEventListener('click', () => {
      collapsed = !collapsed;
      body.style.display = collapsed ? 'none' : 'block';
    });

    header.appendChild(titleSpan);
    header.appendChild(removeBtn);
    wrapper.appendChild(header);

    // ── Component-specific fields ─────────────────────────────────────
    this._buildComponentFields(comp, body, obj);
    wrapper.appendChild(body);

    return wrapper;
  }

  /**
   * Build editable fields for a specific component type.
   * @param {object} comp
   * @param {HTMLElement} body
   * @param {THREE.Object3D} obj  The object this component is attached to.
   */
  _buildComponentFields(comp, body, obj) {
    const _dispatchPhysicsEditUpdate = () => {
      window.dispatchEvent(new CustomEvent('cyco-physics-edit-update', { detail: { object: this.object, component: comp } }));
    };

    const _rebuildPanel = () => {
      this._el.innerHTML = '';
      this._posVec = null;
      this._rotVec = null;
      this._sclVec = null;
      this._build();
    };

    const _field = (label, inputEl, tooltip) => {
      const r = document.createElement('div');
      r.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:4px 0;';
      const lbl = document.createElement('span');
      lbl.textContent = label;
      lbl.style.cssText = 'font-size:11px;color:var(--text-muted,#999);flex-shrink:0;margin-right:6px;';
      lbl.title = tooltip || label;
      r.appendChild(lbl);
      r.appendChild(inputEl);
      body.appendChild(r);
    };

    const _numInput = (value, onChange, step = 0.01, decimals = 3, min, max) => {
      return numInput({
        value,
        step,
        min,
        max,
        decimals,
        onChange: (v) => { onChange(v); _dispatchPhysicsEditUpdate(); },
      });
    };

    const _checkbox = (value, onChange) => {
      return checkbox({
        checked: !!value,
        onChange: (v) => { onChange(v); _dispatchPhysicsEditUpdate(); },
      });
    };

    const _select = (options, value, onChange) => {
      const normalized = options.map((option) => (
        Array.isArray(option) ? option : [option, option]
      ));
      const sel = select({
        options: normalized,
        value,
        onChange: (v) => { onChange(v); _dispatchPhysicsEditUpdate(); },
      });
      sel.style.cssText = 'flex:1;min-width:0;background:var(--bg2,#1e1e1e);border:1px solid var(--border-color,#444);color:var(--text-color,#ccc);padding:2px;border-radius:2px;font-size:11px;';
      return sel;
    };

    const _vec3Input = (x, y, z, onChange, scrubSpeed = 0.1) => {
      // Keep a live triplet so successive edits read the latest value of every axis
      // (avoids the stale-closure bug that otherwise overwrites sibling axis values).
      const values = [x, y, z];
      const control = vec3((axis, val) => {
        values[axis] = val;
        onChange(values[0], values[1], values[2]);
        _dispatchPhysicsEditUpdate();
      }, scrubSpeed);
      control.setValues(x, y, z);
      return control.el;
    };

    const _actionButton = (label, onClick) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = label;
      btn.className = 'ce-prop-btn';
      btn.style.cssText = 'padding:3px 7px;background:var(--bg2,#1e1e1e);border:1px solid var(--border-color,#444);color:var(--text-color,#ccc);border-radius:3px;cursor:pointer;font-size:11px;';
      btn.addEventListener('click', onClick);
      return btn;
    };

    switch (comp.type) {
      case 'Rigid Body':
        _field('Body Type', _select(['dynamic', 'static', 'kinematic'], comp.bodyType ?? 'dynamic', v => { comp.bodyType = v; }));
        _field('Mass',           _numInput(comp.mass ?? 1,           v => { comp.mass           = v; }, 0.1));
        _field('Linear Damping', _numInput(comp.linearDamping ?? 0,  v => { comp.linearDamping  = v; }, 0.01));
        _field('Angular Damping',_numInput(comp.angularDamping ?? 0, v => { comp.angularDamping = v; }, 0.01));
        _field('Lock Rotation', _checkbox(comp.lockRotation, v => { comp.lockRotation = v; }));
        break;

      case 'Box Collider':
      case 'Box Trigger': {
        const hx = comp.halfExtents?.x ?? 0.5;
        const hy = comp.halfExtents?.y ?? 0.5;
        const hz = comp.halfExtents?.z ?? 0.5;
        if (!comp.halfExtents) comp.halfExtents = { x: hx, y: hy, z: hz };
        _field('Scale', _vec3Input(hx, hy, hz, (x, y, z) => {
          comp.halfExtents.x = x;
          comp.halfExtents.y = y;
          comp.halfExtents.z = z;
        }, 0.05), 'Half sizes in world units; same unit conventions as object transforms.');
        _field('Is Trigger', _checkbox(comp.isTrigger ?? comp.type === 'Box Trigger', v => { comp.isTrigger = v; }),
          'Collider acts as a sensor and does not generate physical contacts.');
        _field('Friction', _numInput(comp.friction ?? 0.5, v => { comp.friction = v; }, 0.01, 2, 0, 1),
          'Coefficient of friction: 0 = slippery, 1 = rough.');
        _field('Restitution', _numInput(comp.restitution ?? 0, v => { comp.restitution = v; }, 0.01, 2, 0, 1),
          'Bounciness: 0 = no bounce, 1 = perfect bounce.');
        _field('Auto Fit', _actionButton('Auto Fit', () => {
          // Compute bounding box in world space and fit collider
          obj.geometry.computeBoundingBox();
          const bbox = new THREE.Box3().setFromObject(obj);
          const size = bbox.getSize(new THREE.Vector3());
          comp.halfExtents = { x: size.x * 0.5, y: size.y * 0.5, z: size.z * 0.5 };
          _rebuildPanel();
          _dispatchPhysicsEditUpdate();
        }), 'Fit the collider to object bounds using world-space size.');
        break;
      }
      case 'Sphere Collider':
      case 'Sphere Trigger': {
        _field('Radius', _numInput(comp.radius ?? 0.5, v => { comp.radius = v; }, 0.01, 2, 0, Infinity),
          'Collider radius in world units; matches object transform units.');
        _field('Is Trigger', _checkbox(comp.isTrigger ?? comp.type === 'Sphere Trigger', v => { comp.isTrigger = v; }),
          'Collider acts as a sensor and does not generate physical contacts.');
        _field('Friction', _numInput(comp.friction ?? 0.5, v => { comp.friction = v; }, 0.01, 2, 0, 1),
          'Coefficient of friction: 0 = slippery, 1 = rough.');
        _field('Restitution', _numInput(comp.restitution ?? 0, v => { comp.restitution = v; }, 0.01, 2, 0, 1),
          'Bounciness: 0 = no bounce, 1 = perfect bounce.');
        _field('Auto Fit', _actionButton('Auto Fit', () => {
          // Compute bounding sphere in world space and fit collider
          obj.geometry.computeBoundingSphere();
          const sphere = new THREE.Sphere();
          const bbox = new THREE.Box3().setFromObject(obj);
          bbox.getBoundingSphere(sphere);
          comp.radius = sphere.radius;
          _rebuildPanel();
          _dispatchPhysicsEditUpdate();
        }), 'Fit the radius to object bounds in world space.');
        break;
      }
      case 'Capsule Collider':
      case 'Capsule Trigger': {
        _field('Radius', _numInput(comp.radius ?? 0.25, v => { comp.radius = v; }, 0.01, 2, 0, Infinity),
          'Capsule radius in world units.');
        _field('Half Height', _numInput(comp.halfHeight ?? 0.5, v => { comp.halfHeight = v; }, 0.01, 2, 0, Infinity),
          'Straight segment half-height, excluding the rounded ends.');
        _field('Is Trigger', _checkbox(comp.isTrigger ?? comp.type === 'Capsule Trigger', v => { comp.isTrigger = v; }),
          'Collider acts as a sensor and does not generate physical contacts.');
        _field('Auto Fit', _actionButton('Auto Fit', () => {
          // Compute bounding box in world space and fit collider
          obj.geometry.computeBoundingBox();
          const bbox = new THREE.Box3().setFromObject(obj);
          const size = bbox.getSize(new THREE.Vector3());
          const radius = Math.max(0.01, Math.min(size.x, size.z) * 0.5);
          const halfHeight = Math.max(0.01, (size.y * 0.5) - radius);
          comp.radius = radius;
          comp.halfHeight = halfHeight;
          _rebuildPanel();
          _dispatchPhysicsEditUpdate();
        }), 'Fit the capsule to object bounds in world space.');
        break;
      }

      case 'Mesh Collider':
      case 'Mesh Trigger':
        _field('Mode', _select(['convexHull', 'trimesh'], comp.mode ?? 'convexHull', v => { comp.mode = v; }));
        _field('Is Trigger', _checkbox(comp.isTrigger ?? comp.type === 'Mesh Trigger', v => { comp.isTrigger = v; }));
        _field('Auto Fit', _actionButton('Auto Fit', () => {
          // For mesh collider, we use the bounding box to determine the shape
          // The mode (convexHull/trimesh) is already set, this just updates the mesh data
          _rebuildPanel();
          _dispatchPhysicsEditUpdate();
        }), 'Update mesh collider from object geometry.');
        break;

      case 'Character Controller':
        _field('Offset',         _numInput(comp.offset        ?? 0.01,  v => { comp.offset        = v; }, 0.001));
        _field('Move Speed',     _numInput(comp.moveSpeed     ?? 5,     v => { comp.moveSpeed     = v; }, 0.1));
        _field('Jump Velocity',  _numInput(comp.jumpVelocity  ?? 8,     v => { comp.jumpVelocity  = v; }, 0.1));
        _field('Max Slope (°)',  _numInput(comp.maxSlopeAngle ?? 45,    v => { comp.maxSlopeAngle  = v; }, 1));
        _field('Auto Step H',    _numInput(comp.autoStepHeight ?? 0.25,  v => { comp.autoStepHeight = v; }, 0.01));
        _field('Snap to Ground', _checkbox(comp.snapToGround !== false,  v => { comp.snapToGround  = v; }));
        _field('Controlled',     _checkbox(comp.controlled !== false,    v => { comp.controlled    = v; }));
        break;

      case 'Joint':
        if (!comp.axis) comp.axis = { x: 0, y: 1, z: 0 };
        if (!comp.anchorA) comp.anchorA = { x: 0, y: 0, z: 0 };
        if (!comp.anchorB) comp.anchorB = { x: 0, y: 0, z: 0 };
        _field('Joint Type', _select(['fixed', 'revolute', 'prismatic', 'spherical'], comp.jointType ?? 'fixed', v => { comp.jointType = v; }));
        _field('Target UUID', (() => {
          const container = document.createElement('div');
          container.style.cssText = 'display:flex;align-items:center;gap:6px;width:100%;';

          const inp = document.createElement('input');
          inp.type = 'text';
          inp.value = comp.targetUuid ?? '';
          inp.placeholder = 'Use selected object';
          inp.style.cssText = 'flex:1;min-width:0;background:var(--bg2,#1e1e1e);border:1px solid var(--border-color,#444);color:var(--text-color,#ccc);padding:2px 4px;border-radius:2px;font-size:10px;';
          inp.addEventListener('change', () => { comp.targetUuid = inp.value.trim(); });

          const btn = document.createElement('button');
          btn.type = 'button';
          btn.textContent = 'Use Selected';
          btn.style.cssText = 'padding:3px 6px;background:var(--bg2,#1e1e1e);border:1px solid var(--border-color,#444);color:var(--text-color,#ccc);border-radius:3px;cursor:pointer;font-size:10px;';
          btn.addEventListener('click', () => {
            const selMgr = window.__cyco?.selectionManager;
            const selected = selMgr?.selected?.size ? [...selMgr.selected] : [];
            const target = selected.find(o => o !== this.object && o.uuid);
            if (target) {
              comp.targetUuid = target.uuid;
              inp.value = target.uuid;
            }
          });

          container.appendChild(inp);
          container.appendChild(btn);
          return container;
        })());
        if (comp.jointType === 'revolute' || comp.jointType === 'prismatic') {
          _field('Axis X', _numInput(comp.axis.x, v => { comp.axis.x = v; }, 0.1));
          _field('Axis Y', _numInput(comp.axis.y, v => { comp.axis.y = v; }, 0.1));
          _field('Axis Z', _numInput(comp.axis.z, v => { comp.axis.z = v; }, 0.1));
        }
        _field('Anchor A X', _numInput(comp.anchorA.x, v => { comp.anchorA.x = v; }, 0.1));
        _field('Anchor A Y', _numInput(comp.anchorA.y, v => { comp.anchorA.y = v; }, 0.1));
        if (this.object.isMesh || this.object.isGroup || this.object.isObject3D) {
          _field('Anchor A Z', _numInput(comp.anchorA.z, v => { comp.anchorA.z = v; }, 0.1));
        }
        _field('Anchor B X', _numInput(comp.anchorB.x, v => { comp.anchorB.x = v; }, 0.1));
        _field('Anchor B Y', _numInput(comp.anchorB.y, v => { comp.anchorB.y = v; }, 0.1));
        if (this.object.isMesh || this.object.isGroup || this.object.isObject3D) {
          _field('Anchor B Z', _numInput(comp.anchorB.z, v => { comp.anchorB.z = v; }, 0.1));
        }
        break;

      case 'Ragdoll':
        _field('Preset', _select(['humanoid', 'quadruped'], comp.preset ?? 'humanoid', v => { comp.preset = v; }));
        body.appendChild((() => {
          const p = document.createElement('p');
          p.textContent = 'Generates a runtime ragdoll from the selected preset when play mode starts.';
          p.style.cssText = 'font-size:11px;color:var(--text-muted,#888);margin:0;';
          return p;
        })());
        break;

      case 'Script': {
        if (!comp.path) comp.path = '';
        if (typeof comp.onStart !== 'string') comp.onStart = '';
        if (typeof comp.onDestroy !== 'string') comp.onDestroy = '';

        const pathInput = document.createElement('input');
        pathInput.type = 'text';
        pathInput.value = comp.path;
        pathInput.placeholder = 'scripts/myBehaviour.js';
        pathInput.style.cssText = 'flex:1;min-width:0;background:var(--bg2,#1e1e1e);border:1px solid var(--border-color,#444);color:var(--text-color,#ccc);padding:2px 4px;border-radius:2px;font-size:11px;';
        pathInput.addEventListener('change', () => { comp.path = pathInput.value.trim(); _dispatchPhysicsEditUpdate(); });
        _field('Script Path', pathInput, 'Optional script asset path for this component.');

        const startArea = document.createElement('textarea');
        startArea.value = comp.onStart;
        startArea.placeholder = 'console.log("onStart", object.name);';
        startArea.style.cssText = 'flex:1;min-width:0;min-height:80px;background:var(--bg2,#1e1e1e);border:1px solid var(--border-color,#444);color:var(--text-color,#ccc);padding:4px;border-radius:3px;font-size:11px;font-family:monospace;resize:vertical;';
        startArea.addEventListener('input', () => { comp.onStart = startArea.value; _dispatchPhysicsEditUpdate(); });
        _field('On Start', startArea, 'JavaScript executed when play begins.');

        const destroyArea = document.createElement('textarea');
        destroyArea.value = comp.onDestroy;
        destroyArea.placeholder = 'console.log("onDestroy", object.name);';
        destroyArea.style.cssText = 'flex:1;min-width:0;min-height:80px;background:var(--bg2,#1e1e1e);border:1px solid var(--border-color,#444);color:var(--text-color,#ccc);padding:4px;border-radius:3px;font-size:11px;font-family:monospace;resize:vertical;';
        destroyArea.addEventListener('input', () => { comp.onDestroy = destroyArea.value; _dispatchPhysicsEditUpdate(); });
        _field('On Destroy', destroyArea, 'JavaScript executed when play stops.');

        body.appendChild((() => {
          const p = document.createElement('p');
          p.textContent = 'Enter code bodies for onStart and onDestroy. For example: object.position.x += 1;';
          p.style.cssText = 'font-size:11px;color:var(--text-muted,#888);margin:8px 0 0;';
          return p;
        })());
        break;
      }

      default: {
        const p = document.createElement('p');
        p.textContent = `No editable fields for "${comp.type}".`;
        p.style.cssText = 'font-size:11px;color:var(--text-muted,#888);margin:0;';
        body.appendChild(p);
      }
    }
  }

  // ── Shadow ─────────────────────────────────────────────────────────────────

  _buildShadow(obj) {
    const { el: sec, body } = section('Shadow');

    // Cast / Receive toggles (Three.js shadow maps)
    const castCb = checkbox({
      checked:  obj.castShadow ?? false,
      onChange: (v) => { obj.castShadow = v; },
    });
    body.appendChild(row('Cast Shadow', castCb));

    const recvCb = checkbox({
      checked:  obj.receiveShadow ?? false,
      onChange: (v) => { obj.receiveShadow = v; },
    });
    body.appendChild(row('Receive Shadow', recvCb));

    this._el.appendChild(sec);
  }

  // ── Tick sync ──────────────────────────────────────────────────────────────

  _syncTransform() {
    const obj = this.object;
    if (!obj || !this._posVec) return;
    const p = obj.position, r = obj.rotation, s = obj.scale;
    this._posVec.setValues(p.x, p.y, p.z);
    this._rotVec.setValues(r.x * RAD2DEG, r.y * RAD2DEG, r.z * RAD2DEG);
    this._sclVec.setValues(s.x, s.y, s.z);
  }

  _onTick(e) {
    const delta = e.detail?.delta ?? 0;
    this._elapsed += delta;
    if (this._elapsed < 0.1) return;
    this._elapsed = 0;
    this._syncTransform();
  }

  dispose() {
    window.removeEventListener('cyco-vp-tick', this._onTick);
  }
}
