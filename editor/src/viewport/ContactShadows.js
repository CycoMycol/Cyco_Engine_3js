/**
 * ContactShadows.js
 * Ground-plane contact shadow system.
 *
 * Based on the Three.js webgl_shadow_contact example:
 *   - Renders scene objects to a depth RenderTarget from above using a
 *     custom MeshDepthMaterial (with a "darkness" uniform).
 *   - Blurs the depth map with two-pass (H + V) Gaussian blur.
 *   - Displays the result on a transparent horizontal plane at y=0.
 *
 * Public API:
 *   init(renderer, scene)   — call once after scene is ready
 *   update(renderer, scene) — call every frame to re-render shadow
 *   setEnabled(bool)
 *   setBlur(value)          — 0..10, default 3.5
 *   setDarkness(value)      — 0..2,  default 1.0
 *   setOpacity(value)       — 0..1,  default 0.8
 *   setSize(worldUnits)     — shadow plane half-extent, default 200
 *   setHeight(y)            — world-space Y of the shadow plane, default 0
 *   setObjectEnabled(mesh, bool) — include/exclude mesh from shadow casting
 *   dispose()
 */

import * as THREE from 'three';
import { HorizontalBlurShader } from 'three/addons/shaders/HorizontalBlurShader.js';
import { VerticalBlurShader }   from 'three/addons/shaders/VerticalBlurShader.js';

const SHADOW_RT_SIZE = 512; // depth RT resolution

export class ContactShadows {
  constructor() {
    this._enabled  = false;
    this._blur     = 3.5;
    this._darkness = 1.0;
    this._opacity  = 0.8;
    this._size     = 20;    // half-extent in world units
    this._y        = 0;     // Y position of shadow plane

    // Three.js objects (null until init())
    this._shadowGroup      = null;  // parent Group added to scene
    this._plane            = null;  // the visible shadow quad
    this._renderTarget     = null;
    this._renderTargetBlur = null;
    this._shadowCamera     = null;
    this._depthMaterial    = null;
    this._horizontalBlur   = null;
    this._verticalBlur     = null;
    this._blurPlane        = null;  // helper plane for blur passes

    // Set of meshes explicitly excluded from contact-shadow casting
    this._excludedObjects = new Set();

    // Map: mesh → whether it has been toggled ON for contact shadow
    this._objectEnabled = new Set();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Call once after scene/renderer are ready. */
  init(renderer, scene) {
    this._dispose();

    const s = this._size;
    // Shadow camera height: use a fixed practical height independent of coverage area.
    // 5 units gives good alpha for objects 0.5–3 units tall.
    const camH = 5;

    // Render targets
    this._renderTarget = new THREE.WebGLRenderTarget(SHADOW_RT_SIZE, SHADOW_RT_SIZE);
    this._renderTarget.texture.generateMipmaps = false;

    this._renderTargetBlur = new THREE.WebGLRenderTarget(SHADOW_RT_SIZE, SHADOW_RT_SIZE);
    this._renderTargetBlur.texture.generateMipmaps = false;

    // Orthographic shadow camera looking straight down
    this._shadowCamera = new THREE.OrthographicCamera(-s, s, s, -s, 0.1, camH + 0.5);
    this._shadowCamera.rotation.x = -Math.PI / 2; // look down –Y
    this._shadowCamera.position.set(0, camH, 0);
    this._shadowCamera.updateProjectionMatrix();

    // Custom shadow depth material — outputs (black, alpha) where alpha is
    // proportional to how far above the shadow plane an object is.
    // This avoids fragile onBeforeCompile string replacement.
    this._depthMaterial = new THREE.ShaderMaterial({
      uniforms: {
        darkness:       { value: this._darkness },
        shadowCamHeight: { value: camH },
      },
      vertexShader: /* glsl */`
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPos = modelMatrix * vec4( position, 1.0 );
          vWorldPosition = worldPos.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: /* glsl */`
        uniform float darkness;
        uniform float shadowCamHeight;
        varying vec3 vWorldPosition;
        void main() {
          // alpha = how high the fragment is above the shadow plane,
          // normalised by camera height — objects at y=0 cast no shadow,
          // objects near the top of the frustum cast full shadow.
          float alpha = clamp( vWorldPosition.y / shadowCamHeight, 0.0, 1.0 ) * darkness;
          gl_FragColor = vec4( 0.0, 0.0, 0.0, alpha );
        }
      `,
      depthTest:   false,
      depthWrite:  false,
      transparent: true,
    });
    // Keep userData reference for setDarkness() updates
    this._depthMaterial.userData.darkness = this._depthMaterial.uniforms.darkness;

    // Horizontal blur material
    this._horizontalBlur = new THREE.ShaderMaterial(HorizontalBlurShader);
    this._horizontalBlur.depthTest = false;
    this._horizontalBlur.uniforms.tDiffuse.value = this._renderTarget.texture;
    this._horizontalBlur.uniforms.h.value = this._blur * (1 / SHADOW_RT_SIZE);

    // Vertical blur material
    this._verticalBlur = new THREE.ShaderMaterial(VerticalBlurShader);
    this._verticalBlur.depthTest = false;
    this._verticalBlur.uniforms.tDiffuse.value = this._renderTargetBlur.texture;
    this._verticalBlur.uniforms.v.value = this._blur * (1 / SHADOW_RT_SIZE);

    // Blur helper plane (full-screen quad for blur passes)
    // Faces up (+Y) so the downward-looking shadow camera sees it.
    this._blurPlane = new THREE.Mesh(new THREE.PlaneGeometry(2 * s, 2 * s));
    this._blurPlane.rotation.x = -Math.PI / 2;
    this._blurPlane.visible = false;

    // Visible shadow plane at y = _y
    const planeMat = new THREE.MeshBasicMaterial({
      map:         this._renderTargetBlur.texture,
      opacity:     this._opacity,
      transparent: true,
      depthWrite:  false,
      blending:    THREE.MultiplyBlending,
    });
    this._plane = new THREE.Mesh(new THREE.PlaneGeometry(2 * s, 2 * s), planeMat);
    this._plane.rotation.x = -Math.PI / 2;
    this._plane.renderOrder = -1;
    this._plane.receiveShadow = false;
    this._plane.castShadow    = false;
    this._plane.name = '__cyco_contact_shadow_plane';

    // Group holds camera, blur plane and visible plane
    this._shadowGroup = new THREE.Group();
    this._shadowGroup.name = '__cyco_contact_shadows';
    this._shadowGroup.userData._isHelper = true;
    this._shadowGroup.position.y = this._y;
    this._shadowGroup.add(this._shadowCamera, this._blurPlane, this._plane);

    scene.add(this._shadowGroup);
    this._plane.visible = this._enabled;
  }

  update(renderer, scene) {
    if (!this._enabled || !this._shadowGroup || !this._plane) return;

    // Collect all transform-controls objects (root + entire subtree)
    // so they are excluded from both visibility and material-swap passes.
    const tcObjects = new Set();
    scene.traverse(obj => {
      if (obj.isTransformControlsRoot) {
        obj.traverse(child => tcObjects.add(child));
        tcObjects.add(obj);
      }
    });

    // Exclude helpers, transform controls, and the shadow plane itself
    const wasVisible = [];
    scene.traverse(obj => {
      if (tcObjects.has(obj) ||
          obj.userData?._isHelper ||
          obj === this._plane || obj === this._blurPlane) {
        wasVisible.push({ obj, v: obj.visible });
        obj.visible = false;
      }
    });

    // Swap to depth material for all scene meshes
    const savedMats = [];
    scene.traverse(obj => {
      if (obj.isMesh && obj.visible && !this._excludedObjects.has(obj) && !tcObjects.has(obj)) {
        savedMats.push({ obj, mat: obj.material });
        obj.material = this._depthMaterial;
      }
    });

    // Render depth into shadow RT — clear to WHITE first so non-object pixels
    // stay white (MultiplyBlending requires white = no-shadow, dark = shadow).
    // Disable autoClear so our manual white clear is not overwritten.
    const prevAutoClear = renderer.autoClear;
    const prevClearColor = renderer.getClearColor(new THREE.Color());
    const prevClearAlpha = renderer.getClearAlpha();

    // Temporarily remove scene.background so renderer.render() does not
    // overwrite our white clear with the viewport background colour.
    const prevBackground = scene.background;
    scene.background = null;

    renderer.autoClear = false;
    renderer.setRenderTarget(this._renderTarget);
    renderer.setClearColor(0xffffff, 1);
    renderer.clear();
    renderer.setClearColor(prevClearColor, prevClearAlpha);
    renderer.render(scene, this._shadowCamera);
    renderer.autoClear = prevAutoClear;

    scene.background = prevBackground;

    // Restore materials
    savedMats.forEach(({ obj, mat }) => { obj.material = mat; });

    // Restore visibility
    wasVisible.forEach(({ obj, v }) => { obj.visible = v; });

    // ── Blur pass 1: horizontal ──────────────────────────────────────────────
    this._blurPlane.visible  = true;
    this._blurPlane.material = this._horizontalBlur;
    this._horizontalBlur.uniforms.h.value = this._blur * (1 / SHADOW_RT_SIZE);
    renderer.setRenderTarget(this._renderTargetBlur);
    renderer.render(this._blurPlane, this._shadowCamera);

    // ── Blur pass 2: vertical ────────────────────────────────────────────────
    this._blurPlane.material = this._verticalBlur;
    this._verticalBlur.uniforms.v.value = this._blur * (1 / SHADOW_RT_SIZE);
    renderer.setRenderTarget(this._renderTarget);
    renderer.render(this._blurPlane, this._shadowCamera);

    this._blurPlane.visible = false;

    renderer.setRenderTarget(null);
  }

  setEnabled(v) {
    this._enabled = !!v;
    if (this._plane) this._plane.visible = this._enabled;
  }

  setBlur(v) {
    this._blur = v;
    if (this._horizontalBlur) this._horizontalBlur.uniforms.h.value = v * (1 / SHADOW_RT_SIZE);
    if (this._verticalBlur)   this._verticalBlur.uniforms.v.value   = v * (1 / SHADOW_RT_SIZE);
  }

  setDarkness(v) {
    this._darkness = v;
    if (this._depthMaterial?.userData?.darkness) {
      this._depthMaterial.userData.darkness.value = v;
    }
  }

  setOpacity(v) {
    this._opacity = v;
    if (this._plane?.material) this._plane.material.opacity = v;
  }

  /** World-space Y position of the shadow receiver plane. */
  setHeight(y) {
    this._y = y;
    if (this._shadowGroup) this._shadowGroup.position.y = y;
  }

  /** Half-extent (world units) of the shadow coverage area. */
  setSize(s) {
    this._size = s;
    // Requires re-init to resize render targets and camera
    const vpe = window.__cyco?.viewportEngine;
    if (vpe) this.init(vpe.rendererManager?.renderer, vpe.scene);
  }

  /**
   * Toggle a specific object's participation in the contact shadow render.
   * Objects with enabled=false are excluded from the depth pass.
   */
  setObjectEnabled(obj, enabled) {
    if (enabled) {
      this._excludedObjects.delete(obj);
      this._objectEnabled.add(obj);
    } else {
      this._excludedObjects.add(obj);
      this._objectEnabled.delete(obj);
    }
  }

  get enabled()  { return this._enabled;  }
  get blur()     { return this._blur;     }
  get darkness() { return this._darkness; }
  get opacity()  { return this._opacity;  }

  dispose() {
    this._dispose();
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  _dispose() {
    const scene = window.__cyco?.viewportEngine?.scene;
    if (this._shadowGroup) {
      scene?.remove(this._shadowGroup);
      this._shadowGroup.traverse(child => {
        child.geometry?.dispose();
        if (child.material && child.material !== this._depthMaterial &&
            child.material !== this._horizontalBlur &&
            child.material !== this._verticalBlur) {
          child.material.dispose();
        }
      });
      this._shadowGroup = null;
    }
    this._renderTarget?.dispose();
    this._renderTargetBlur?.dispose();
    this._depthMaterial?.dispose();
    this._horizontalBlur?.dispose();
    this._verticalBlur?.dispose();
    this._renderTarget     = null;
    this._renderTargetBlur = null;
    this._depthMaterial    = null;
    this._horizontalBlur   = null;
    this._verticalBlur     = null;
    this._plane            = null;
    this._blurPlane        = null;
    this._shadowCamera     = null;
    this._objectEnabled.clear();
    this._excludedObjects.clear();
  }
}
