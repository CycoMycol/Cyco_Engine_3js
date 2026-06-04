/**
 * PhysicsManager.js
 * Central physics runtime for Cyco Engine.
 *
 * Lifecycle:
 *   init(scene, mode, gravity, plane2d)  — called by GameRuntime on Play
 *   dispose()                            — called by GameRuntime on Stop
 *
 * The physics world is ONLY alive during Play mode.
 * Editor transforms are never touched by Rapier — the scene snapshot/restore
 * in GameRuntime.js ensures the editor state is fully recovered on Stop.
 *
 * Fixed-timestep accumulator:
 *   Prevents tunnelling and joint instability caused by variable RAF deltas.
 *   Steps at FIXED_DT (1/60 s), caps at MAX_SUBSTEPS per frame.
 *
 * World-space body initialisation:
 *   Uses object.getWorldPosition() / getWorldQuaternion() so that nested or
 *   parented objects are placed at the correct world location.
 *
 * Non-uniform scale:
 *   Rapier does not support non-uniform scale natively. A visible warning is
 *   emitted if a collider is created on such an object. Collider dimensions are
 *   derived from the geometry bounding box multiplied by world scale.
 *
 * Components schema:
 *   object.userData.physics.components = [{ type, ...params }]
 *
 * Events consumed (during play only):
 *   cyco-vp-tick   { delta }      — from ViewportEngine render loop
 *   cyco-input-move { x, z }      — from InputManager
 *   cyco-input-jump {}            — from InputManager
 *
 * Events dispatched:
 *   cyco-physics-trigger    { objectUuid, otherUuid, state }   — 'enter' | 'exit'
 *   cyco-physics-collision  { objectUuid, otherUuid }
 */

import * as THREE from 'three';

const FIXED_DT     = 1 / 60;
const MAX_SUBSTEPS = 3;

export class PhysicsManager {
  constructor() {
    this._world              = null;
    this._RAPIER             = null;
    this._mode               = 'none';
    this._plane2d            = 'xy';
    this._accumulator        = 0;
    this._bodyMap            = new Map(); // uuid → RigidBody
    this._colliderMap        = new Map(); // uuid → Collider[]
    this._objectMap          = new Map(); // uuid → Object3D
    this._handleToUuid       = new Map(); // collider handle → uuid
    this._prevTriggerPairs   = new Set();
    this._characterControllers = new Map();
    this._debugEnabled       = false;
    this._debugMesh          = null;
    this._debugScene         = null;

    this._onTick      = this._onTick.bind(this);
    this._onInputMove = this._onInputMove.bind(this);
    this._onInputJump = this._onInputJump.bind(this);
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  /**
   * Initialise the physics world. Called by GameRuntime AFTER scene snapshot.
   * @param {import('three').Scene} scene
   * @param {'3d'|'2d'|'none'} mode
   * @param {{ x:number, y:number, z?:number }} gravity
   * @param {'xy'|'xz'} plane2d
   */
  async init(scene, mode, gravity, plane2d) {
    if (!mode || mode === 'none') return;
    this._mode    = mode;
    this._plane2d = plane2d || 'xy';

    // Load Rapier — WASM is base64-inlined, no separate fetch needed
    let RAPIER;
    try {
      const mod = await import(mode === '2d' ? '@dimforge/rapier2d-compat' : '@dimforge/rapier3d-compat');
      RAPIER = mod.default ?? mod;
    } catch (loadErr) {
      this._reportError('Failed to load Rapier physics library.', loadErr);
      return;
    }

    try {
      await RAPIER.init();
    } catch (wasmErr) {
      if (window.location.protocol === 'file:') {
        this._reportError('Physics requires a local server (not file://). Open via http://localhost.', wasmErr);
      } else {
        this._reportError('Rapier WASM initialisation failed.', wasmErr);
      }
      return;
    }

    this._RAPIER = RAPIER;

    try {
      const g = mode === '2d'
        ? new RAPIER.Vector2(gravity?.x ?? 0, gravity?.y ?? -9.81)
        : new RAPIER.Vector3(gravity?.x ?? 0, gravity?.y ?? -9.81, gravity?.z ?? 0);
      this._world = new RAPIER.World(g);
    } catch (e) {
      this._reportError('Failed to create Rapier world.', e);
      return;
    }

    this._buildBodies(scene);
    this._buildJoints(scene);

    if (this._debugEnabled) this._createDebugRenderer(scene);

    window.addEventListener('cyco-vp-tick',    this._onTick);
    window.addEventListener('cyco-input-move', this._onInputMove);
    window.addEventListener('cyco-input-jump', this._onInputJump);

    console.log('[PhysicsManager] Initialised in', mode, 'mode.');
  }

  /** Tear down the physics world. Called by GameRuntime on Stop. */
  dispose() {
    window.removeEventListener('cyco-vp-tick',    this._onTick);
    window.removeEventListener('cyco-input-move', this._onInputMove);
    window.removeEventListener('cyco-input-jump', this._onInputJump);

    if (this._world) {
      for (const cc of this._characterControllers.values()) {
        try { this._world.removeCharacterController(cc); } catch { /* ignore */ }
      }
    }
    this._characterControllers.clear();

    if (this._debugMesh && this._debugScene) {
      this._debugScene.remove(this._debugMesh);
      this._debugMesh.geometry.dispose();
      this._debugMesh.material.dispose();
      this._debugMesh  = null;
      this._debugScene = null;
    }

    if (this._world) {
      try { this._world.free(); } catch { /* ignore */ }
      this._world = null;
    }

    this._RAPIER             = null;
    this._bodyMap.clear();
    this._colliderMap.clear();
    this._objectMap.clear();
    this._handleToUuid.clear();
    this._prevTriggerPairs.clear();
    this._accumulator = 0;
    this._mode        = 'none';

    console.log('[PhysicsManager] Disposed.');
  }

  /** @param {boolean} enabled */
  setDebugEnabled(enabled) { this._debugEnabled = enabled; }

  /**
   * Cast a ray into the live physics world.
   * @param {import('three').Vector3} origin
   * @param {import('three').Vector3} direction  normalised
   * @param {number} [maxToi=100]
   * @returns {{ hit:boolean, toi:number, objectUuid:string|null }|null}
   */
  raycast(origin, direction, maxToi = 100) {
    if (!this._world || !this._RAPIER) return null;
    try {
      const R   = this._RAPIER;
      const ray = this._mode === '2d'
        ? new R.Ray({ x: origin.x, y: origin.y }, { x: direction.x, y: direction.y })
        : new R.Ray(
            { x: origin.x, y: origin.y, z: origin.z },
            { x: direction.x, y: direction.y, z: direction.z }
          );
      const hit = this._world.castRay(ray, maxToi, true);
      if (!hit) return { hit: false, toi: 0, objectUuid: null };
      return { hit: true, toi: hit.timeOfImpact, objectUuid: this._handleToUuid.get(hit.collider.handle) ?? null };
    } catch (e) {
      console.warn('[PhysicsManager] raycast error:', e);
      return null;
    }
  }

  // ─── Frame Tick ───────────────────────────────────────────────────────────

  _onTick(e) {
    if (!this._world) return;
    this._accumulator += e.detail?.delta ?? 0;
    let steps = 0;
    while (this._accumulator >= FIXED_DT && steps < MAX_SUBSTEPS) {
      this._world.timestep = FIXED_DT;
      this._world.step();
      this._accumulator -= FIXED_DT;
      steps++;
    }
    this._syncTransforms();
    this._checkTriggers();
    if (this._debugEnabled && this._debugMesh) this._updateDebugRenderer();
  }

  // ─── Body / Collider Construction ─────────────────────────────────────────

  _buildBodies(scene) {
    if (!this._world || !this._RAPIER) return;
    const R = this._RAPIER;
    const _tmpPos  = new THREE.Vector3();
    const _tmpQuat = new THREE.Quaternion();
    const _tmpScale = new THREE.Vector3();

    scene.traverse((obj) => {
      const comps = obj.userData?.physics?.components;
      if (!Array.isArray(comps) || comps.length === 0) return;

      const rbComp = comps.find(c => c.type === 'Rigid Body');
      if (!rbComp) return;

      // Non-uniform scale warning
      obj.getWorldScale(_tmpScale);
      const sx = Math.abs(_tmpScale.x), sy = Math.abs(_tmpScale.y), sz = Math.abs(_tmpScale.z);
      if (Math.abs(sx - sy) > 1e-4 || (this._mode === '3d' && Math.abs(sy - sz) > 1e-4)) {
        console.warn(
          `[PhysicsManager] Non-uniform scale on "${obj.name || obj.uuid}" ` +
          `(${sx.toFixed(3)}, ${sy.toFixed(3)}, ${sz.toFixed(3)}). ` +
          'Collider size is approximated.'
        );
      }

      obj.getWorldPosition(_tmpPos);
      obj.getWorldQuaternion(_tmpQuat);

      const bodyType = rbComp.bodyType ?? 'dynamic';
      let bodyDesc;
      if (bodyType === 'static') {
        bodyDesc = R.RigidBodyDesc.fixed();
      } else if (bodyType === 'kinematic') {
        bodyDesc = R.RigidBodyDesc.kinematicPositionBased();
      } else {
        bodyDesc = R.RigidBodyDesc.dynamic();
      }

      if (this._mode === '2d') {
        const x2d = _tmpPos.x;
        const y2d = this._plane2d === 'xz' ? _tmpPos.z : _tmpPos.y;
        bodyDesc.setTranslation(x2d, y2d);
        const sinA = 2 * (_tmpQuat.w * _tmpQuat.z + _tmpQuat.x * _tmpQuat.y);
        const cosA = 1 - 2 * (_tmpQuat.y * _tmpQuat.y + _tmpQuat.z * _tmpQuat.z);
        bodyDesc.setRotation(Math.atan2(sinA, cosA));
      } else {
        bodyDesc.setTranslation(_tmpPos.x, _tmpPos.y, _tmpPos.z);
        bodyDesc.setRotation({ x: _tmpQuat.x, y: _tmpQuat.y, z: _tmpQuat.z, w: _tmpQuat.w });
      }

      if (typeof rbComp.mass           === 'number' && rbComp.mass > 0) bodyDesc.setAdditionalMass(rbComp.mass);
      if (typeof rbComp.linearDamping  === 'number') bodyDesc.setLinearDamping(rbComp.linearDamping);
      if (typeof rbComp.angularDamping === 'number') bodyDesc.setAngularDamping(rbComp.angularDamping);
      if (rbComp.lockRotation) bodyDesc.lockRotations();

      const body = this._world.createRigidBody(bodyDesc);
      this._bodyMap.set(obj.uuid, body);
      this._objectMap.set(obj.uuid, obj);
      this._colliderMap.set(obj.uuid, []);

      for (const comp of comps) {
        const collider = this._buildCollider(comp, obj, body);
        if (collider) {
          this._colliderMap.get(obj.uuid).push(collider);
          this._handleToUuid.set(collider.handle, obj.uuid);
        }
      }

      if (comps.find(c => c.type === 'Character Controller')) {
        this._createCharacterController(obj, comps.find(c => c.type === 'Character Controller'));
      }
    });
  }

  _buildCollider(comp, obj, body) {
    if (!this._world || !this._RAPIER) return null;
    const R = this._RAPIER;
    let desc = null;

    try {
      switch (comp.type) {
        case 'Box Collider': {
          let hx = comp.halfExtents?.x ?? 0.5;
          let hy = comp.halfExtents?.y ?? 0.5;
          let hz = comp.halfExtents?.z ?? 0.5;
          if (obj.geometry && !comp.halfExtents) {
            obj.geometry.computeBoundingBox();
            const bb = obj.geometry.boundingBox;
            if (bb) {
              const ws = new THREE.Vector3();
              obj.getWorldScale(ws);
              hx = (bb.max.x - bb.min.x) * 0.5 * Math.abs(ws.x);
              hy = (bb.max.y - bb.min.y) * 0.5 * Math.abs(ws.y);
              hz = (bb.max.z - bb.min.z) * 0.5 * Math.abs(ws.z);
            }
          }
          desc = this._mode === '2d'
            ? R.ColliderDesc.cuboid(hx, hy)
            : R.ColliderDesc.cuboid(hx, hy, hz);
          break;
        }
        case 'Sphere Collider': {
          let r = comp.radius ?? 0.5;
          if (obj.geometry && comp.radius == null) {
            obj.geometry.computeBoundingSphere();
            const bs = obj.geometry.boundingSphere;
            if (bs) {
              const ws = new THREE.Vector3();
              obj.getWorldScale(ws);
              r = bs.radius * Math.max(Math.abs(ws.x), Math.abs(ws.y), Math.abs(ws.z));
            }
          }
          desc = R.ColliderDesc.ball(r);
          break;
        }
        case 'Capsule Collider': {
          desc = R.ColliderDesc.capsule(comp.halfHeight ?? 0.5, comp.radius ?? 0.25);
          break;
        }
        case 'Mesh Collider': {
          if (this._mode === '2d') { console.warn('[PhysicsManager] Mesh Collider unsupported in 2D.'); return null; }
          if (!obj.geometry) { console.warn('[PhysicsManager] Mesh Collider: no geometry on', obj.name || obj.uuid); return null; }
          const verts = new Float32Array(obj.geometry.attributes.position.array);
          if (comp.mode === 'trimesh') {
            if (!obj.geometry.index) { console.warn('[PhysicsManager] Trimesh requires indexed geometry.'); return null; }
            desc = R.ColliderDesc.trimesh(verts, new Uint32Array(obj.geometry.index.array));
          } else {
            desc = R.ColliderDesc.convexHull(verts);
            if (!desc) { console.warn('[PhysicsManager] convexHull failed for', obj.name || obj.uuid); return null; }
          }
          break;
        }
        case 'Rigid Body':
        case 'Character Controller':
        case 'Joint':
        case 'Ragdoll':
          return null;
        default:
          return null;
      }
    } catch (e) {
      console.warn('[PhysicsManager] Collider error (', comp.type, '):', e);
      return null;
    }

    if (!desc) return null;

    if (comp.isTrigger)                        desc.setSensor(true);
    if (typeof comp.restitution === 'number')  desc.setRestitution(comp.restitution);
    if (typeof comp.friction    === 'number')  desc.setFriction(comp.friction);
    if (typeof comp.density     === 'number')  desc.setDensity(comp.density);
    if (comp.offset) {
      this._mode === '2d'
        ? desc.setTranslation(comp.offset.x ?? 0, comp.offset.y ?? 0)
        : desc.setTranslation(comp.offset.x ?? 0, comp.offset.y ?? 0, comp.offset.z ?? 0);
    }

    return this._world.createCollider(desc, body);
  }

  _buildJoints(scene) {
    if (!this._world || !this._RAPIER) return;
    const R = this._RAPIER;
    const zero2 = { x: 0, y: 0 };
    const zero3 = { x: 0, y: 0, z: 0 };
    const identQ = { x: 0, y: 0, z: 0, w: 1 };

    scene.traverse((obj) => {
      const comps = obj.userData?.physics?.components;
      if (!Array.isArray(comps)) return;
      for (const comp of comps) {
        if (comp.type !== 'Joint' || !comp.targetUuid) continue;
        const bodyA = this._bodyMap.get(obj.uuid);
        const bodyB = this._bodyMap.get(comp.targetUuid);
        if (!bodyA || !bodyB) { console.warn('[PhysicsManager] Joint: body not found for', comp.targetUuid); continue; }
        const a1 = this._mode === '2d' ? zero2 : zero3;
        const a2 = this._mode === '2d' ? zero2 : zero3;
        try {
          let jd;
          switch (comp.jointType ?? 'fixed') {
            case 'fixed':    jd = R.JointData.fixed(a1, identQ, a2, identQ); break;
            case 'revolute':
              jd = this._mode === '2d'
                ? R.JointData.revolute(a1, a2)
                : R.JointData.revolute(a1, a2, comp.axis ?? { x: 0, y: 1, z: 0 });
              break;
            case 'prismatic':
              jd = R.JointData.prismatic(a1, a2, comp.axis ?? (this._mode === '2d' ? { x: 1, y: 0 } : { x: 1, y: 0, z: 0 }));
              break;
            case 'spherical':
              if (this._mode === '3d') jd = R.JointData.spherical(a1, a2);
              break;
            default:
              console.warn('[PhysicsManager] Unknown jointType:', comp.jointType);
              continue;
          }
          if (jd) this._world.createImpulseJoint(jd, bodyA, bodyB, true);
        } catch (e) {
          console.warn('[PhysicsManager] Joint creation failed:', e);
        }
      }
    });
  }

  // ─── Character Controller ─────────────────────────────────────────────────

  _createCharacterController(obj, config = {}) {
    if (!this._world) return;
    const cc = this._world.createCharacterController(config.offset ?? 0.01);
    if (typeof config.maxSlopeAngle   === 'number') cc.setMaxSlopeClimbAngle(config.maxSlopeAngle * Math.PI / 180);
    if (typeof config.autoStepHeight  === 'number') cc.enableAutostep(config.autoStepHeight, 0.1, true);
    if (config.snapToGround !== false) cc.enableSnapToGround(0.1);
    this._characterControllers.set(obj.uuid, cc);
  }

  moveCharacter(uuid, desiredMovement) {
    if (!this._world) return;
    const cc   = this._characterControllers.get(uuid);
    const body = this._bodyMap.get(uuid);
    const cols = this._colliderMap.get(uuid);
    if (!cc || !body || !cols?.length) return;
    try {
      cc.computeColliderMovement(cols[0], desiredMovement);
      const mv = cc.computedMovement();
      const t  = body.translation();
      body.setNextKinematicTranslation({ x: t.x + mv.x, y: t.y + mv.y, z: (t.z ?? 0) + (mv.z ?? 0) });
    } catch (e) {
      console.warn('[PhysicsManager] moveCharacter error:', e);
    }
  }

  _onInputMove(e) {
    if (!this._characterControllers.size) return;
    const { x = 0, z = 0 } = e.detail ?? {};
    const speed = 5;
    for (const [uuid] of this._characterControllers) {
      this.moveCharacter(uuid, this._mode === '2d'
        ? { x: x * speed * FIXED_DT, y: 0 }
        : { x: x * speed * FIXED_DT, y: 0, z: z * speed * FIXED_DT });
    }
  }

  _onInputJump() {
    const impulse = this._mode === '2d' ? { x: 0, y: 8 } : { x: 0, y: 8, z: 0 };
    for (const [uuid] of this._characterControllers) {
      const body = this._bodyMap.get(uuid);
      if (body) try { body.applyImpulse(impulse, true); } catch { /* ignore */ }
    }
  }

  // ─── Transform Sync ───────────────────────────────────────────────────────

  _syncTransforms() {
    if (!this._world) return;
    for (const [uuid, body] of this._bodyMap) {
      if (body.isFixed()) continue;
      const obj = this._objectMap.get(uuid);
      if (!obj) continue;
      const t = body.translation();
      const r = body.rotation();
      if (this._mode === '2d') {
        if (this._plane2d === 'xz') {
          obj.position.set(t.x, obj.position.y, t.y);
          obj.rotation.y = r;
        } else {
          obj.position.set(t.x, t.y, obj.position.z);
          obj.rotation.z = r;
        }
      } else {
        obj.position.set(t.x, t.y, t.z);
        obj.quaternion.set(r.x, r.y, r.z, r.w);
      }
    }
  }

  // ─── Trigger / Collision Events ───────────────────────────────────────────

  _checkTriggers() {
    if (!this._world) return;
    const current = new Set();
    try {
      this._world.intersectionPairsWith(null, (c1, c2, intersecting) => {
        if (!intersecting) return;
        const u1 = this._handleToUuid.get(c1.handle);
        const u2 = this._handleToUuid.get(c2.handle);
        if (!u1 || !u2) return;
        const key = u1 < u2 ? `${u1}:${u2}` : `${u2}:${u1}`;
        current.add(key);
        if (!this._prevTriggerPairs.has(key)) {
          window.dispatchEvent(new CustomEvent('cyco-physics-trigger', {
            detail: { objectUuid: u1, otherUuid: u2, state: 'enter' },
          }));
        }
      });
    } catch { /* no sensors */ }
    for (const key of this._prevTriggerPairs) {
      if (!current.has(key)) {
        const [u1, u2] = key.split(':');
        window.dispatchEvent(new CustomEvent('cyco-physics-trigger', {
          detail: { objectUuid: u1, otherUuid: u2, state: 'exit' },
        }));
      }
    }
    this._prevTriggerPairs = current;
    try {
      this._world.contactPairsWith(null, (c1, c2, started) => {
        if (!started) return;
        const u1 = this._handleToUuid.get(c1.handle);
        const u2 = this._handleToUuid.get(c2.handle);
        if (u1 && u2) {
          window.dispatchEvent(new CustomEvent('cyco-physics-collision', {
            detail: { objectUuid: u1, otherUuid: u2 },
          }));
        }
      });
    } catch { /* ignore */ }
  }

  // ─── Debug Wireframe ─────────────────────────────────────────────────────

  _createDebugRenderer(scene) {
    if (!this._world) return;
    const geo  = new THREE.BufferGeometry();
    const mat  = new THREE.LineBasicMaterial({ vertexColors: true });
    const mesh = new THREE.LineSegments(geo, mat);
    mesh.name          = '__physics_debug__';
    mesh.renderOrder   = 999;
    mesh.frustumCulled = false;
    scene.add(mesh);
    this._debugMesh  = mesh;
    this._debugScene = scene;
    this._updateDebugRenderer();
  }

  _updateDebugRenderer() {
    if (!this._world || !this._debugMesh) return;
    try {
      const buf = this._world.debugRender();
      const geo = this._debugMesh.geometry;
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(buf.vertices), 3));
      geo.setAttribute('color',    new THREE.BufferAttribute(new Float32Array(buf.colors),   4));
      geo.computeBoundingSphere();
    } catch { /* ignore if mid-step */ }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  _reportError(message, err) {
    console.error('[PhysicsManager]', message, err);
    window.dispatchEvent(new CustomEvent('cyco-console-error', {
      detail: { message: `[Physics] ${message}` },
    }));
  }
}
