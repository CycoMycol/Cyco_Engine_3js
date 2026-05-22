/**
 * ObjectFactory.js
 * Creates Three.js objects on demand and adds them to the active scene via SceneManager.
 * Handles all model loaders (GLTF, FBX, OBJ, PLY, STL, PCD, Collada),
 * light types, special addon objects, and text geometry.
 *
 * Depends on: SceneManager (injected), THREE.LoadingManager (injected)
 *
 * Events consumed:
 *   cyco-add-object   { objectType: string, options?: object }
 *   cyco-load-file    { fileHandle|file, type?: string }
 */

import * as THREE from 'three';

// ── Loader imports (lazy — only one is used per operation) ──────────────────
import { GLTFLoader }    from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader }   from 'three/addons/loaders/DRACOLoader.js';
import { FBXLoader }     from 'three/addons/loaders/FBXLoader.js';
import { OBJLoader }     from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader }     from 'three/addons/loaders/MTLLoader.js';
import { PLYLoader }     from 'three/addons/loaders/PLYLoader.js';
import { STLLoader }     from 'three/addons/loaders/STLLoader.js';
import { PCDLoader }     from 'three/addons/loaders/PCDLoader.js';
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';
import { FontLoader }    from 'three/addons/loaders/FontLoader.js';
import { TextGeometry }  from 'three/addons/geometries/TextGeometry.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// Lights
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { RectAreaLightTexturesLib } from 'three/addons/lights/RectAreaLightTexturesLib.js';

// Addon objects
import { Sky }          from 'three/addons/objects/Sky.js';
import { Water }        from 'three/addons/objects/Water.js';
import { Water as Water2 } from 'three/addons/objects/Water2.js'; // r184: Water2.js exports as 'Water'
import { Reflector }    from 'three/addons/objects/Reflector.js';
import { Refractor }    from 'three/addons/objects/Refractor.js';
import { GroundedSkybox } from 'three/addons/objects/GroundedSkybox.js';
import { Lensflare, LensflareElement } from 'three/addons/objects/Lensflare.js';
import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js';

/** Path to DRACO decoder (relative to editor/index.html) */
const DRACO_DECODER_PATH = './libs/three/addons/libs/draco/';

/** Path to KTX2 basis_transcoder (relative to editor/index.html) */
const BASIS_TRANSCODER_PATH = './libs/three/addons/libs/basis/';

/** Path to built-in font (relative to editor/index.html) */
const FONT_PATH = './libs/three/addons/fonts/helvetiker_regular.typeface.json';

export class ObjectFactory {
  /**
   * @param {import('./SceneManager.js').SceneManager} sceneManager
   * @param {THREE.LoadingManager} loadingManager
   */
  constructor(sceneManager, loadingManager) {
    this.sceneManager   = sceneManager;
    this.loadingManager = loadingManager;

    /** Cached default font for TextGeometry. */
    this._font = null;

    /** Shared DRACOLoader instance. */
    this._dracoLoader = null;

    /** Shared KTX2Loader instance (set after renderer is available). */
    this._ktx2Loader = null;

    // Initialise RectAreaLight support once
    RectAreaLightUniformsLib.init();
    RectAreaLightTexturesLib.init();

    this._onAddObject      = this._onAddObject.bind(this);
    this._onLoadFile       = this._onLoadFile.bind(this);
    this._onVpReady        = this._onVpReady.bind(this);
    this._onDuplicate      = this._onDuplicate.bind(this);
    this._onRemoveObj      = this._onRemoveObj.bind(this);
    this._onRestoreObj     = this._onRestoreObj.bind(this);

    window.addEventListener('cyco-add-object',            this._onAddObject);
    window.addEventListener('cyco-load-file',             this._onLoadFile);
    window.addEventListener('cyco-renderer-changed',      this._onVpReady);
    window.addEventListener('cyco-vp-ready',              this._onVpReady);
    window.addEventListener('cyco-duplicate-object',      this._onDuplicate);
    window.addEventListener('cyco-hierarchy-remove-obj',  this._onRemoveObj);
    window.addEventListener('cyco-hierarchy-restore-obj', this._onRestoreObj);
  }

  // ─── Renderer-dependent init ──────────────────────────────────────────────

  _onVpReady(event) {
    const renderer = event.detail?.renderer;
    if (!renderer) return;
    // KTX2Loader requires detectSupport(renderer) with an active WebGLRenderer
    if (renderer.isWebGLRenderer) {
      this._initKTX2Loader(renderer);
    }
  }

  _initKTX2Loader(renderer) {
    import('three/addons/loaders/KTX2Loader.js').then(({ KTX2Loader }) => {
      this._ktx2Loader = new KTX2Loader(this.loadingManager);
      this._ktx2Loader.setTranscoderPath(BASIS_TRANSCODER_PATH);
      this._ktx2Loader.detectSupport(renderer);
    });
  }

  _getDracoLoader() {
    if (!this._dracoLoader) {
      this._dracoLoader = new DRACOLoader(this.loadingManager);
      this._dracoLoader.setDecoderPath(DRACO_DECODER_PATH);
    }
    return this._dracoLoader;
  }

  // ─── Event handlers ───────────────────────────────────────────────────────

  _onAddObject(event) {
    const { objectType, options } = event.detail ?? {};
    const obj = this.create(objectType, options);
    if (!obj) return;

    const sm = this.sceneManager;
    // Ensure cycoId is assigned before we capture it for undo
    if (!obj.userData.cycoId) {
      const uid = () => Math.random().toString(36).slice(2, 9);
      obj.userData.cycoId = uid();
    }
    const cycoId = obj.userData.cycoId;

    window.dispatchEvent(new CustomEvent('cyco-command-execute', {
      detail: {
        name: `Add ${obj.name || objectType}`,
        do:   () => sm.addObject(obj),
        undo: () => sm.removeObjectKeepAlive(cycoId),
      }
    }));
  }

  _onDuplicate(event) {
    const { source, command } = event.detail ?? {};
    if (!source) return;
    const sm = this.sceneManager;

    const clone = source.clone(true);
    const uid = () => Math.random().toString(36).slice(2, 9);
    clone.userData = { ...source.userData };
    clone.userData.cycoId = uid();
    clone.name = (source.name || 'Object') + ' (copy)';
    // Offset clone slightly so it's visible
    clone.position.x += 0.5;
    clone.position.z += 0.5;

    const cycoId = clone.userData.cycoId;

    // If called from CommandManager (via _duplicateSelected), store back on the command object
    if (command) command._clone = clone;

    sm.addObject(clone);
  }

  _onRemoveObj(event) {
    const { cycoId } = event.detail ?? {};
    if (!cycoId) return;
    this.sceneManager.removeObjectKeepAlive(cycoId);
  }

  _onRestoreObj(event) {
    const { object, parent } = event.detail ?? {};
    if (!object) return;
    const sm = this.sceneManager;
    const targetParent = parent ?? sm.scene;
    targetParent.add(object);
    sm._markDirty?.();
    window.dispatchEvent(new CustomEvent('cyco-hierarchy-add', {
      detail: { object, parentId: targetParent?.userData?.cycoId ?? null }
    }));
  }

  async _onLoadFile(event) {
    const { file, fileHandle } = event.detail ?? {};
    const f = file ?? (fileHandle ? await fileHandle.getFile() : null);
    if (!f) return;
    await this.loadFile(f);
  }

  // ─── Public: create by type string ────────────────────────────────────────

  /**
   * Create a Three.js object by type name.
   * Does NOT add it to the scene — caller is responsible (or use cyco-add-object event).
   * @param {string} type
   * @param {object} [opts]
   * @returns {THREE.Object3D|null}
   */
  create(type, opts = {}) {
    switch (type) {
      // ── Primitives ─────────────────────────────────────────────────────
      case 'Box':           return this._mesh(new THREE.BoxGeometry(1, 1, 1), type);
      case 'Sphere':        return this._mesh(new THREE.SphereGeometry(0.5, 32, 16), type);
      case 'Cylinder':      return this._mesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 32), type);
      case 'Cone':          return this._mesh(new THREE.ConeGeometry(0.5, 1, 32), type);
      case 'Capsule':       return this._mesh(new THREE.CapsuleGeometry(0.5, 1, 4, 8), type);
      case 'Plane': {
        const planeMesh = this._mesh(new THREE.PlaneGeometry(1, 1), type);
        planeMesh.rotation.x = -Math.PI / 2; // lay flat (XZ plane, facing up)
        return planeMesh;
      }
      case 'Circle':        return this._mesh(new THREE.CircleGeometry(0.5, 32), type);
      case 'Ring':          return this._mesh(new THREE.RingGeometry(0.1, 0.5, 32), type);
      case 'Torus':         return this._mesh(new THREE.TorusGeometry(0.5, 0.2, 16, 100), type);
      case 'TorusKnot':     return this._mesh(new THREE.TorusKnotGeometry(0.5, 0.15, 100, 16), type);
      case 'Dodecahedron':  return this._mesh(new THREE.DodecahedronGeometry(0.5), type);
      case 'Icosahedron':   return this._mesh(new THREE.IcosahedronGeometry(0.5), type);
      case 'Octahedron':    return this._mesh(new THREE.OctahedronGeometry(0.5), type);
      case 'Tetrahedron':   return this._mesh(new THREE.TetrahedronGeometry(0.5), type);
      case 'RoundedBox':    return this._mesh(new RoundedBoxGeometry(1, 1, 1, 2, 0.1), type);

      // ── Lines / Points ─────────────────────────────────────────────────
      case 'Line': {
        const geo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(-1, 0, 0), new THREE.Vector3(1, 0, 0),
        ]);
        return this._named(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffffff })), 'Line');
      }
      case 'LineLoop': {
        const geo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0),
        ]);
        return this._named(new THREE.LineLoop(geo, new THREE.LineBasicMaterial({ color: 0xffffff })), 'LineLoop');
      }
      case 'LineSegments': {
        const geo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0),
          new THREE.Vector3(0, 1, 0),  new THREE.Vector3(1, 0, 0),
        ]);
        return this._named(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xffffff })), 'LineSegments');
      }
      case 'Points': {
        const geo = new THREE.SphereGeometry(0.5, 8, 6);
        const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.05, color: 0xffffff }));
        return this._named(pts, 'Points');
      }
      case 'Sprite': {
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffffff }));
        return this._named(sprite, 'Sprite');
      }

      // ── Groups / Instancing ────────────────────────────────────────────
      case 'Empty':         return this._named(new THREE.Object3D(), 'GameObject');
      case 'Group':         return this._named(new THREE.Group(), 'Group');
      case 'LOD':           return this._named(new THREE.LOD(), 'LOD');
      case 'Bone':          return this._named(new THREE.Bone(), 'Bone');
      case 'InstancedMesh': {
        const count = opts.count ?? 100;
        const geo   = new THREE.BoxGeometry(1, 1, 1);
        const mat   = this._defaultMaterial();
        const im    = new THREE.InstancedMesh(geo, mat, count);
        im.castShadow = im.receiveShadow = true;
        return this._named(im, 'InstancedMesh');
      }
      case 'BatchedMesh': {
        const bm = new THREE.BatchedMesh(
          opts.maxGeomCount  ?? 16,
          opts.maxVertexCount ?? 1024,
          opts.maxIndexCount  ?? 2048,
          this._defaultMaterial(),
        );
        bm.castShadow = bm.receiveShadow = true;
        return this._named(bm, 'BatchedMesh');
      }

      // ── Cameras ────────────────────────────────────────────────────────
      case 'PerspectiveCamera': {
        const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
        cam.position.set(0, 1, 5);
        return this._named(cam, 'Camera');
      }
      case 'OrthographicCamera': {
        const cam = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 1000);
        cam.position.set(0, 1, 5);
        return this._named(cam, 'OrthoCamera');
      }

      // ── Lights ─────────────────────────────────────────────────────────
      case 'AmbientLight':     return this._named(new THREE.AmbientLight(0xffffff, 1), 'AmbientLight');
      case 'DirectionalLight': { const l = new THREE.DirectionalLight(0xffffff, 1); l.castShadow = true; return this._named(l, 'DirectionalLight'); }
      case 'PointLight':       { const l = new THREE.PointLight(0xffffff, 1, 100); l.castShadow = true; return this._named(l, 'PointLight'); }
      case 'SpotLight':        { const l = new THREE.SpotLight(0xffffff, 1); l.castShadow = true; return this._named(l, 'SpotLight'); }
      case 'HemisphereLight':  return this._named(new THREE.HemisphereLight(0x87ceeb, 0x8b7355, 1), 'HemisphereLight');
      case 'RectAreaLight': {
        const l = new THREE.RectAreaLight(0xffffff, 1, 4, 4);
        return this._named(l, 'RectAreaLight');
      }
      case 'LightProbe': return this._named(new THREE.LightProbe(), 'LightProbe');

      // ── Addon objects ──────────────────────────────────────────────────
      case 'Sky': {
        const sky = new Sky();
        sky.scale.setScalar(450000);
        return this._named(sky, 'Sky');
      }
      case 'MarchingCubes': {
        const mc = new MarchingCubes(28, this._defaultMaterial(), true, true, 100000);
        mc.position.set(0, 0, 0);
        mc.scale.setScalar(3);
        return this._named(mc, 'MarchingCubes');
      }
      // Water, Water2, Reflector, Refractor, GroundedSkybox require geometry / renderer context
      // — instantiated via dedicated factory methods below
      case 'Water':          return this.createWater(opts);
      case 'Water2':         return this.createWater2(opts);
      case 'Reflector':      return this.createReflector(opts);
      case 'Refractor':      return this.createRefractor(opts);

      default:
        console.warn(`[ObjectFactory] Unknown type: "${type}"`);
        return null;
    }
  }

  // ─── Addon object factories ───────────────────────────────────────────────

  createWater(opts = {}) {
    const geo  = new THREE.PlaneGeometry(100, 100);
    const water = new Water(geo, {
      textureWidth:  512,
      textureHeight: 512,
      waterNormals:  null, // caller can set a texture
      sunDirection:  new THREE.Vector3(0, 1, 0),
      sunColor:      0xffffff,
      waterColor:    0x001e0f,
      distortionScale: 3.7,
    });
    water.rotation.x = -Math.PI / 2;
    return this._named(water, 'Water');
  }

  createWater2(opts = {}) {
    const geo   = new THREE.PlaneGeometry(20, 20);
    const water = new Water2(geo, {
      color:      '#ffffff',
      scale:      4,
      flowDirection: new THREE.Vector2(1, 1),
      textureWidth:  1024,
      textureHeight: 1024,
    });
    water.rotation.x = -Math.PI / 2;
    return this._named(water, 'Water2');
  }

  createReflector(opts = {}) {
    const geo  = new THREE.PlaneGeometry(4, 4);
    const ref  = new Reflector(geo, {
      clipBias:         0.003,
      textureWidth:     window.innerWidth  * window.devicePixelRatio,
      textureHeight:    window.innerHeight * window.devicePixelRatio,
      color:            0x889999,
    });
    ref.rotation.x = -Math.PI / 2;
    return this._named(ref, 'Reflector');
  }

  createRefractor(opts = {}) {
    const geo  = new THREE.PlaneGeometry(4, 4);
    const ref  = new Refractor(geo, {
      color:         0x999999,
      textureWidth:  1024,
      textureHeight: 1024,
    });
    ref.rotation.x = -Math.PI / 2;
    return this._named(ref, 'Refractor');
  }

  // ─── Lensflare helper (attach to a light) ─────────────────────────────────

  /**
   * Add a default lensflare effect to a point or spot light.
   * @param {THREE.PointLight|THREE.SpotLight} light
   */
  attachLensflare(light) {
    const flare = new Lensflare();
    // Programmatic white circle texture
    const tex = this._makeCircleTexture(64, '#ffffff');
    flare.addElement(new LensflareElement(tex, 700, 0));
    flare.addElement(new LensflareElement(tex, 60, 0.6));
    flare.addElement(new LensflareElement(tex, 70, 0.7));
    light.add(flare);
  }

  _makeCircleTexture(size, color) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const r   = size / 2;
    const grd = ctx.createRadialGradient(r, r, 0, r, r, r);
    grd.addColorStop(0, color);
    grd.addColorStop(1, 'transparent');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(canvas);
  }

  // ─── Text Geometry ────────────────────────────────────────────────────────

  async createText(text = 'Hello', opts = {}) {
    const font = await this._loadFont();
    const geo  = new TextGeometry(text, {
      font,
      size:  opts.size  ?? 0.5,
      depth: opts.depth ?? 0.1,
    });
    geo.center();
    return this._mesh(geo, 'Text');
  }

  async _loadFont() {
    if (this._font) return this._font;
    return new Promise((resolve, reject) => {
      new FontLoader(this.loadingManager).load(FONT_PATH, font => {
        this._font = font;
        resolve(font);
      }, undefined, reject);
    });
  }

  // ─── File loaders ─────────────────────────────────────────────────────────

  /**
   * Load a File object (from File System Access API or <input type="file">).
   * Detects format from extension and dispatches cyco-hierarchy-add when done.
   * @param {File} file
   * @returns {Promise<THREE.Object3D|null>}
   */
  async loadFile(file) {
    const ext  = file.name.split('.').pop().toLowerCase();
    const url  = URL.createObjectURL(file);
    let   root = null;

    try {
      switch (ext) {
        case 'gltf':
        case 'glb':   root = await this._loadGLTF(url, file.name); break;
        case 'fbx':   root = await this._loadFBX(url, file.name);  break;
        case 'obj':   root = await this._loadOBJ(url, file.name);  break;
        case 'ply':   root = await this._loadPLY(url, file.name);  break;
        case 'stl':   root = await this._loadSTL(url, file.name);  break;
        case 'pcd':   root = await this._loadPCD(url, file.name);  break;
        case 'dae':   root = await this._loadCollada(url, file.name); break;
        default:
          console.warn(`[ObjectFactory] Unsupported file type: .${ext}`);
      }
    } finally {
      URL.revokeObjectURL(url);
    }

    if (root) this.sceneManager.addObject(root);
    return root;
  }

  async _loadGLTF(url, name) {
    const loader = new GLTFLoader(this.loadingManager);
    loader.setDRACOLoader(this._getDracoLoader());
    if (this._ktx2Loader) loader.setKTX2Loader(this._ktx2Loader);
    const gltf = await loader.loadAsync(url);
    const root = gltf.scene;
    root.name  = name;
    if (gltf.animations?.length > 0) {
      this.sceneManager.registerAnimations(root, gltf.animations);
    }
    this._applyShadows(root);
    return root;
  }

  async _loadFBX(url, name) {
    const loader = new FBXLoader(this.loadingManager);
    const root   = await loader.loadAsync(url);
    root.name    = name;
    if (root.animations?.length > 0) {
      this.sceneManager.registerAnimations(root, root.animations);
    }
    this._applyShadows(root);
    return root;
  }

  async _loadOBJ(url, name) {
    const loader = new OBJLoader(this.loadingManager);
    const root   = await loader.loadAsync(url);
    root.name    = name;
    this._applyShadows(root);
    return root;
  }

  async _loadPLY(url, name) {
    const loader = new PLYLoader(this.loadingManager);
    const geo    = await loader.loadAsync(url);
    geo.computeVertexNormals();
    const mesh   = this._mesh(geo, name);
    return mesh;
  }

  async _loadSTL(url, name) {
    const loader = new STLLoader(this.loadingManager);
    const geo    = await loader.loadAsync(url);
    geo.computeVertexNormals();
    return this._mesh(geo, name);
  }

  async _loadPCD(url, name) {
    const loader  = new PCDLoader(this.loadingManager);
    const points  = await loader.loadAsync(url);
    points.name   = name;
    return this._named(points, name);
  }

  async _loadCollada(url, name) {
    const loader  = new ColladaLoader(this.loadingManager);
    const result  = await loader.loadAsync(url);
    const root    = result.scene;
    root.name     = name;
    this._applyShadows(root);
    return root;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  _defaultMaterial() {
    return new THREE.MeshStandardMaterial({ color: 0x8888aa, roughness: 0.7, metalness: 0.1 });
  }

  _mesh(geometry, name) {
    const mesh = new THREE.Mesh(geometry, this._defaultMaterial());
    mesh.castShadow    = true;
    mesh.receiveShadow = true;
    return this._named(mesh, name);
  }

  _named(obj, name) {
    obj.name = name;
    return obj;
  }

  _applyShadows(root) {
    root.traverse(child => {
      if (child.isMesh) {
        child.castShadow    = true;
        child.receiveShadow = true;
      }
    });
  }

  // ─── Disposal ─────────────────────────────────────────────────────────────

  dispose() {
    window.removeEventListener('cyco-add-object',            this._onAddObject);
    window.removeEventListener('cyco-load-file',             this._onLoadFile);
    window.removeEventListener('cyco-renderer-changed',      this._onVpReady);
    window.removeEventListener('cyco-vp-ready',              this._onVpReady);
    window.removeEventListener('cyco-duplicate-object',      this._onDuplicate);
    window.removeEventListener('cyco-hierarchy-remove-obj',  this._onRemoveObj);
    window.removeEventListener('cyco-hierarchy-restore-obj', this._onRestoreObj);
    this._dracoLoader?.dispose();
    this._ktx2Loader?.dispose();
  }
}
