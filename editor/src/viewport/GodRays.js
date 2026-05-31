/**
 * GodRays.js
 * Screen-space radial blur god ray effect.
 * GPU Gems 3, Ch. 13 - "Volumetric Light Scattering as a Post-Process"
 *
 * Usage:
 *   const gr = new GodRays(viewportEngine);
 *   gr.setEnabled(true);
 *   gr.setParams({ density: 0.96, weight: 0.4, decay: 0.9, exposure: 0.65, samples: 60 });
 *   // Call gr.update(camera, sunWorldDir) each frame BEFORE composer.render()
 *   // insert gr.pass into EffectComposer after OutputPass
 */

import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// -- Radial blur shader --

const GodRaysVertShader = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const GodRaysFragShader = /* glsl */`
uniform sampler2D tDiffuse;
uniform sampler2D tOccluder;
uniform vec2      sunScreenPos;   // [0,1] screen space
uniform float     density;        // 0.96
uniform float     weight;         // 0.40
uniform float     decay;          // 0.90
uniform float     exposure;       // 0.65
uniform int       numSamples;     // 60
uniform float     enabled;        // 0 or 1

varying vec2 vUv;

void main() {
  // Always pass through the diffuse frame — god rays are additive on top.
  vec4 diffuse = texture2D(tDiffuse, vUv);

  if (enabled < 0.5) {
    gl_FragColor = diffuse;
    return;
  }

  vec2 uv        = vUv;
  vec2 deltaUV   = (uv - sunScreenPos) * (density / float(numSamples));
  float decayVal = 1.0;
  vec3 godRay    = vec3(0.0);

  for (int i = 0; i < 100; i++) {
    if (i >= numSamples) break;
    uv -= deltaUV;
    vec3 s = texture2D(tOccluder, clamp(uv, 0.0, 1.0)).rgb;
    s     *= decayVal * weight;
    godRay += s;
    decayVal *= decay;
  }

  gl_FragColor = vec4(diffuse.rgb + clamp(godRay * exposure, 0.0, 1.5), diffuse.a);
}
`;

export class GodRays {
  constructor(viewportEngine) {
    this._vpe        = viewportEngine;
    this._enabled    = false;
    this._occluderRT = null;  // 1/4 res WebGLRenderTarget for silhouette mask
    this._blackMat   = null;  // MeshBasicMaterial: black for occluder pass
    this._pass       = null;  // ShaderPass - radial blur, additive output
    this._renderer   = null;

    this._p = {
      density:  0.96,
      weight:   0.40,
      decay:    0.90,
      exposure: 0.65,
      samples:  60,
    };
  }

  /** The ShaderPass to insert into EffectComposer after OutputPass. */
  get pass() { return this._pass; }

  setEnabled(v) {
    this._enabled = !!v;
    if (this._pass) {
      this._pass.uniforms['enabled'].value = v ? 1.0 : 0.0;
    }
  }

  setParams(opts = {}) {
    if (opts.density  !== undefined) this._p.density  = opts.density;
    if (opts.weight   !== undefined) this._p.weight   = opts.weight;
    if (opts.decay    !== undefined) this._p.decay    = opts.decay;
    if (opts.exposure !== undefined) this._p.exposure = opts.exposure;
    if (opts.samples  !== undefined) this._p.samples  = Math.round(opts.samples);
    if (this._pass) this._applyUniforms();
  }

  /**
   * Call once when the WebGL pipeline is built.
   * @param {THREE.WebGLRenderer} renderer
   * @param {number} w  Full viewport width
   * @param {number} h  Full viewport height
   */
  build(renderer, w, h) {
    this.dispose();
    this._renderer = renderer;

    // 1/4-resolution occluder render target
    this._occluderRT = new THREE.WebGLRenderTarget(
      Math.max(1, Math.floor(w / 4)),
      Math.max(1, Math.floor(h / 4)),
      {
        format:    THREE.RGBFormat,
        type:      THREE.UnsignedByteType,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
      }
    );

    // Black silhouette material for scene geometry in the occluder pass
    this._blackMat = new THREE.MeshBasicMaterial({ color: 0x000000 });

    // Radial blur ShaderPass - reads tDiffuse (the composed frame) and adds god rays on top.
    this._pass = new ShaderPass({
      uniforms: {
        tDiffuse:     { value: null },
        tOccluder:    { value: null },
        sunScreenPos: { value: new THREE.Vector2(0.5, 0.5) },
        density:      { value: this._p.density },
        weight:       { value: this._p.weight },
        decay:        { value: this._p.decay },
        exposure:     { value: this._p.exposure },
        numSamples:   { value: this._p.samples },
        enabled:      { value: this._enabled ? 1.0 : 0.0 },
      },
      vertexShader:   GodRaysVertShader,
      fragmentShader: GodRaysFragShader,
    });
    // needsSwap=true so the final composite (diffuse + god rays) is written to the back buffer
    this._pass.needsSwap = true;
  }

  /**
   * Must be called every frame BEFORE composer.render().
   * Renders the occluder pass and updates the sun screen position uniform.
   * @param {THREE.Camera} camera
   * @param {THREE.Vector3} sunWorldDir  unit vector pointing toward sun
   */
  update(camera, sunWorldDir) {
    if (!this._enabled || !this._pass || !this._occluderRT || !this._renderer) return;
    const scene = this._vpe?.scene;
    if (!scene) return;

    // 1. Project sun direction to screen UV [0,1]
    const sunPoint = sunWorldDir.clone().multiplyScalar(camera.near * 10000);
    sunPoint.add(camera.position);
    sunPoint.project(camera);  // NDC [-1,1]

    const sunScreenX = sunPoint.x * 0.5 + 0.5;
    const sunScreenY = sunPoint.y * 0.5 + 0.5;
    const sunBehind  = sunPoint.z > 1.0;

    // 2. Render occluder pass - scene geometry = black, sky sun disc = white
    // We CANNOT use scene.overrideMaterial here because it overrides ALL objects
    // including the sky mesh, preventing the sky from rendering as the sun disc.
    // Instead, traverse the scene and swap each renderable object's material to
    // blackMat, then explicitly set the sky mesh to occluderMat.
    // Pick active sky object (gradient or physical) for occluder material swap
    const activeSkyType = this._vpe?._activeSkyType ?? 'gradient';
    const activeSky = activeSkyType === 'physical'
      ? (this._vpe?.physicalSky ?? null)
      : (this._vpe?.gradientSky ?? null);

    // Per-object material swap
    const savedMaterials = new Map();
    const skyMesh = activeSky?._mesh ?? null;
    scene.traverse(obj => {
      if (!obj.isMesh && !obj.isLine && !obj.isLineSegments && !obj.isPoints && !obj.isSprite) return;
      if (obj === skyMesh) return; // sky mesh handled separately below
      if (Array.isArray(obj.material)) {
        savedMaterials.set(obj, obj.material);
        obj.material = this._blackMat;
      } else if (obj.material) {
        savedMaterials.set(obj, obj.material);
        obj.material = this._blackMat;
      }
    });
    // Sky mesh → occluder material (white sun disc, black sky)
    const prevSkyMat = skyMesh?.material ?? null;
    if (skyMesh && activeSky?._occluderMat) skyMesh.material = activeSky._occluderMat;

    // Save renderer state we will modify
    const prevClearAlpha = this._renderer.getClearAlpha();
    const prevClearColorR = this._renderer._clearColor?.r ?? 0;
    const prevClearColorG = this._renderer._clearColor?.g ?? 0;
    const prevClearColorB = this._renderer._clearColor?.b ?? 0;
    const prevAutoClear = this._renderer.autoClear;

    const prevBackground = scene.background;
    scene.background = null;

    this._renderer.setRenderTarget(this._occluderRT);
    this._renderer.setClearColor(0x000000, 1);
    this._renderer.autoClear = true;
    this._renderer.clear();
    this._renderer.render(scene, camera);
    this._renderer.setRenderTarget(null);

    // Restore all materials
    savedMaterials.forEach((mat, obj) => { obj.material = mat; });
    if (skyMesh && prevSkyMat) skyMesh.material = prevSkyMat;
    // Ensure sky mesh is on mainMat for the subsequent RenderPass
    if (skyMesh && activeSky?._mainMat) skyMesh.material = activeSky._mainMat;

    // Restore renderer state
    // EffectComposer's RenderPass sets its own clearColor before clearing, so
    // the exact restore value matters less, but keep it correct anyway.
    const prevR = Math.round(prevClearColorR * 255);
    const prevG = Math.round(prevClearColorG * 255);
    const prevB = Math.round(prevClearColorB * 255);
    this._renderer.setClearColor((prevR << 16) | (prevG << 8) | prevB, prevClearAlpha);
    this._renderer.autoClear = prevAutoClear;

    scene.background = prevBackground;

    // 3. Update radial blur uniforms
    const u = this._pass.uniforms;
    u['tOccluder'].value      = this._occluderRT.texture;
    u['sunScreenPos'].value.set(sunScreenX, sunScreenY);
    u['enabled'].value        = (this._enabled && !sunBehind) ? 1.0 : 0.0;
  }

  resize(w, h) {
    if (this._occluderRT) {
      this._occluderRT.setSize(
        Math.max(1, Math.floor(w / 4)),
        Math.max(1, Math.floor(h / 4))
      );
    }
  }

  dispose() {
    this._occluderRT?.dispose();
    this._blackMat?.dispose();
    this._pass?.dispose();
    this._occluderRT = null;
    this._blackMat   = null;
    this._pass       = null;
    this._renderer   = null;
  }

  _applyUniforms() {
    const u = this._pass.uniforms;
    u['density'].value    = this._p.density;
    u['weight'].value     = this._p.weight;
    u['decay'].value      = this._p.decay;
    u['exposure'].value   = this._p.exposure;
    u['numSamples'].value = this._p.samples;
  }
}
