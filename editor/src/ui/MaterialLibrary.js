/**
 * MaterialLibrary.js
 * Defines 55 material preset configs as plain data objects.
 * No Three.js constructors are called here — MaterialBrowser calls THREE.* on apply.
 *
 * Each entry:
 * {
 *   id:       string (unique slug),
 *   name:     string,
 *   category: string,
 *   type:     string  (Three.js class name),
 *   params:   object  (constructor/property params),
 *   preview:  string  (CSS color for thumbnail)
 *   requiresWebGPU?: boolean
 * }
 */

export const MATERIAL_CATEGORIES = [
  'PBR Standard',
  'PBR Physical',
  'Phong / Lambert',
  'Toon',
  'Emissive',
  'Special',
  'Shader',
];

export const MATERIALS = [

  // ── PBR Standard (MeshStandardMaterial) ─────────────────────────────────
  { id: 'matte-white',   name: 'Matte White',   category: 'PBR Standard', type: 'MeshStandardMaterial', params: { color: '#ffffff', roughness: 1, metalness: 0 }, preview: '#f0f0f0' },
  { id: 'matte-black',   name: 'Matte Black',   category: 'PBR Standard', type: 'MeshStandardMaterial', params: { color: '#111111', roughness: 1, metalness: 0 }, preview: '#111111' },
  { id: 'brushed-metal', name: 'Brushed Metal', category: 'PBR Standard', type: 'MeshStandardMaterial', params: { color: '#aaaaaa', roughness: 0.4, metalness: 1 }, preview: '#aaaaaa' },
  { id: 'polished-chrome', name: 'Polished Chrome', category: 'PBR Standard', type: 'MeshStandardMaterial', params: { color: '#d0d0d0', roughness: 0, metalness: 1 }, preview: '#d0d8e8' },
  { id: 'rusted-iron',   name: 'Rusted Iron',   category: 'PBR Standard', type: 'MeshStandardMaterial', params: { color: '#8B5A2B', roughness: 0.9, metalness: 0.8 }, preview: '#8B5A2B' },
  { id: 'gold',          name: 'Gold',          category: 'PBR Standard', type: 'MeshStandardMaterial', params: { color: '#FFD700', roughness: 0.1, metalness: 1 }, preview: '#FFD700' },
  { id: 'terracotta',    name: 'Terracotta',    category: 'PBR Standard', type: 'MeshStandardMaterial', params: { color: '#C65D3C', roughness: 0.8, metalness: 0 }, preview: '#C65D3C' },
  { id: 'forest-green',  name: 'Forest Green',  category: 'PBR Standard', type: 'MeshStandardMaterial', params: { color: '#2D5A27', roughness: 0.7, metalness: 0 }, preview: '#2D5A27' },
  { id: 'ocean-blue',    name: 'Ocean Blue',    category: 'PBR Standard', type: 'MeshStandardMaterial', params: { color: '#1A4B8C', roughness: 0.6, metalness: 0 }, preview: '#1A4B8C' },
  { id: 'concrete',      name: 'Concrete',      category: 'PBR Standard', type: 'MeshStandardMaterial', params: { color: '#9A9A9A', roughness: 1.0, metalness: 0 }, preview: '#9A9A9A' },
  { id: 'asphalt',       name: 'Asphalt',       category: 'PBR Standard', type: 'MeshStandardMaterial', params: { color: '#404040', roughness: 1.0, metalness: 0 }, preview: '#404040' },
  { id: 'snow',          name: 'Snow',          category: 'PBR Standard', type: 'MeshStandardMaterial', params: { color: '#F8F8FF', roughness: 0.9, metalness: 0 }, preview: '#F0F4FF' },
  { id: 'sand',          name: 'Sand',          category: 'PBR Standard', type: 'MeshStandardMaterial', params: { color: '#C4A46C', roughness: 0.9, metalness: 0 }, preview: '#C4A46C' },
  { id: 'warm-wood',     name: 'Warm Wood',     category: 'PBR Standard', type: 'MeshStandardMaterial', params: { color: '#7B4F2E', roughness: 0.8, metalness: 0 }, preview: '#7B4F2E' },
  { id: 'white-ceramic', name: 'White Ceramic', category: 'PBR Standard', type: 'MeshStandardMaterial', params: { color: '#ffffff', roughness: 0.2, metalness: 0 }, preview: '#ffffff' },

  // ── PBR Physical (MeshPhysicalMaterial) ──────────────────────────────────
  { id: 'clear-glass',   name: 'Clear Glass',   category: 'PBR Physical', type: 'MeshPhysicalMaterial', params: { color: '#cce8ff', transmission: 1, thickness: 0.5, roughness: 0, transparent: true, opacity: 1 }, preview: '#cce8ff' },
  { id: 'frosted-glass', name: 'Frosted Glass', category: 'PBR Physical', type: 'MeshPhysicalMaterial', params: { color: '#d0e8ff', transmission: 0.9, roughness: 0.3, transparent: true, opacity: 1 }, preview: '#d0e8ff' },
  { id: 'car-paint-red', name: 'Car Paint Red', category: 'PBR Physical', type: 'MeshPhysicalMaterial', params: { color: '#CC0000', clearcoat: 1, clearcoatRoughness: 0.05, metalness: 0.2, roughness: 0.3 }, preview: '#CC0000' },
  { id: 'water-surface', name: 'Water Surface', category: 'PBR Physical', type: 'MeshPhysicalMaterial', params: { color: '#4488cc', transmission: 0.95, roughness: 0, transparent: true, opacity: 1 }, preview: '#4488cc' },
  { id: 'velvet-red',    name: 'Velvet Red',    category: 'PBR Physical', type: 'MeshPhysicalMaterial', params: { color: '#8B0000', sheen: 1, sheenRoughness: 0.3, roughness: 0.8, metalness: 0 }, preview: '#8B0000' },
  { id: 'ice',           name: 'Ice',           category: 'PBR Physical', type: 'MeshPhysicalMaterial', params: { color: '#D0F0FF', transmission: 0.5, roughness: 0.05, transparent: true, opacity: 1 }, preview: '#D0F0FF' },
  { id: 'wax',           name: 'Wax',           category: 'PBR Physical', type: 'MeshPhysicalMaterial', params: { color: '#F5F5DC', transmission: 0.3, roughness: 0.6, transparent: true, opacity: 1 }, preview: '#F5F5DC' },
  { id: 'diamond',       name: 'Diamond',       category: 'PBR Physical', type: 'MeshPhysicalMaterial', params: { color: '#ffffff', transmission: 1, thickness: 2, ior: 2.4, transparent: true, opacity: 1 }, preview: '#e0f4ff' },
  { id: 'soap-bubble',   name: 'Soap Bubble',   category: 'PBR Physical', type: 'MeshPhysicalMaterial', params: { color: '#ffffff', iridescence: 1, transmission: 0.8, roughness: 0, transparent: true, opacity: 0.9 }, preview: 'linear-gradient(135deg,#ff80ff,#80ffff)' },
  { id: 'holographic',   name: 'Holographic',   category: 'PBR Physical', type: 'MeshPhysicalMaterial', params: { color: '#aaaaff', iridescence: 1, metalness: 0.9, roughness: 0 }, preview: 'linear-gradient(135deg,#ff00ff,#00ffff)' },

  // ── Phong / Lambert ───────────────────────────────────────────────────────
  { id: 'shiny-plastic-white', name: 'Shiny Plastic White', category: 'Phong / Lambert', type: 'MeshPhongMaterial', params: { color: '#ffffff', shininess: 100, specular: '#ffffff' }, preview: '#f8f8f8' },
  { id: 'shiny-plastic-red',   name: 'Shiny Plastic Red',   category: 'Phong / Lambert', type: 'MeshPhongMaterial', params: { color: '#cc2020', shininess: 100, specular: '#ff8888' }, preview: '#cc2020' },
  { id: 'dull-rubber',         name: 'Dull Rubber',         category: 'Phong / Lambert', type: 'MeshPhongMaterial', params: { color: '#222222', shininess: 5 }, preview: '#222222' },
  { id: 'flat-matte-red',      name: 'Flat Matte Red',      category: 'Phong / Lambert', type: 'MeshLambertMaterial', params: { color: '#cc2020' }, preview: '#cc2020' },
  { id: 'flat-matte-blue',     name: 'Flat Matte Blue',     category: 'Phong / Lambert', type: 'MeshLambertMaterial', params: { color: '#2040cc' }, preview: '#2040cc' },

  // ── Toon / Cell Shading ───────────────────────────────────────────────────
  { id: 'toon-red',       name: 'Toon Red',       category: 'Toon', type: 'MeshToonMaterial', params: { color: '#cc2020' }, preview: '#cc2020' },
  { id: 'toon-blue',      name: 'Toon Blue',      category: 'Toon', type: 'MeshToonMaterial', params: { color: '#2040cc' }, preview: '#2040cc' },
  { id: 'toon-yellow',    name: 'Toon Yellow',    category: 'Toon', type: 'MeshToonMaterial', params: { color: '#ddcc00' }, preview: '#ddcc00' },
  { id: 'toon-skin',      name: 'Toon Skin',      category: 'Toon', type: 'MeshToonMaterial', params: { color: '#e0b080' }, preview: '#e0b080' },
  { id: 'toon-dark-gray', name: 'Toon Dark Gray', category: 'Toon', type: 'MeshToonMaterial', params: { color: '#444444' }, preview: '#444444' },

  // ── Emissive / Glow ───────────────────────────────────────────────────────
  { id: 'emissive-white',    name: 'Emissive White',    category: 'Emissive', type: 'MeshStandardMaterial', params: { color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 2, roughness: 0.5, metalness: 0 }, preview: '#ffffff' },
  { id: 'emissive-red-glow', name: 'Emissive Red',      category: 'Emissive', type: 'MeshStandardMaterial', params: { color: '#cc2020', emissive: '#ff0000', emissiveIntensity: 2, roughness: 0.5, metalness: 0 }, preview: '#ff2020' },
  { id: 'neon-blue',         name: 'Neon Blue',         category: 'Emissive', type: 'MeshStandardMaterial', params: { color: '#004488', emissive: '#00FFFF', emissiveIntensity: 3, roughness: 0.5, metalness: 0 }, preview: '#00FFFF' },
  { id: 'neon-green',        name: 'Neon Green',        category: 'Emissive', type: 'MeshStandardMaterial', params: { color: '#004400', emissive: '#00FF00', emissiveIntensity: 3, roughness: 0.5, metalness: 0 }, preview: '#00FF00' },
  { id: 'lava',              name: 'Lava',              category: 'Emissive', type: 'MeshStandardMaterial', params: { color: '#CC2200', emissive: '#FF4500', emissiveIntensity: 1.5, roughness: 1, metalness: 0 }, preview: '#FF4500' },

  // ── Special / Utility ─────────────────────────────────────────────────────
  { id: 'wireframe',       name: 'Wireframe',       category: 'Special', type: 'MeshBasicMaterial', params: { color: '#00ff88', wireframe: true }, preview: '#003322' },
  { id: 'normals-debug',   name: 'Normals Debug',   category: 'Special', type: 'MeshNormalMaterial', params: {}, preview: 'linear-gradient(135deg,#ff8080,#80ff80,#8080ff)' },
  { id: 'depth-debug',     name: 'Depth Debug',     category: 'Special', type: 'MeshDepthMaterial', params: {}, preview: 'linear-gradient(135deg,#000,#fff)' },
  { id: 'x-ray',           name: 'X-Ray',           category: 'Special', type: 'MeshBasicMaterial', params: { color: '#44bbff', transparent: true, opacity: 0.2, side: 2 /* DoubleSide */ }, preview: '#44bbff' },
  { id: 'unlit-white',     name: 'Unlit White',     category: 'Special', type: 'MeshBasicMaterial', params: { color: '#ffffff' }, preview: '#ffffff' },
  { id: 'unlit-black',     name: 'Unlit Black',     category: 'Special', type: 'MeshBasicMaterial', params: { color: '#000000' }, preview: '#000000' },
  { id: 'matcap-pearl',    name: 'Matcap Pearl',    category: 'Special', type: 'MeshMatcapMaterial', params: { color: '#e8e8f0' }, preview: '#e8e8f0' },
  { id: 'matcap-metal',    name: 'Matcap Metal',    category: 'Special', type: 'MeshMatcapMaterial', params: { color: '#aaaaaa' }, preview: '#aaaaaa' },
  { id: 'points-cloud',    name: 'Points Cloud',    category: 'Special', type: 'PointsMaterial', params: { color: '#ffffff', size: 0.05 }, preview: '#ffffff' },

  // ── GLSL Shader ───────────────────────────────────────────────────────────
  {
    id: 'gradient-uv', name: 'UV Gradient', category: 'Shader', type: 'ShaderMaterial',
    params: {
      vertexShader:   `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying vec2 vUv; void main() { gl_FragColor = vec4(vUv.x, vUv.y, 1.0 - vUv.x, 1.0); }`,
    },
    preview: 'linear-gradient(135deg,#ff8800,#0088ff)',
  },
  {
    id: 'fresnel-glow', name: 'Fresnel Glow', category: 'Shader', type: 'ShaderMaterial',
    params: {
      vertexShader: `
        varying vec3 vNormal; varying vec3 vViewPos;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          vViewPos = -mvPosition.xyz;
          gl_Position = projectionMatrix * mvPosition;
        }`,
      fragmentShader: `
        varying vec3 vNormal; varying vec3 vViewPos;
        uniform vec3 glowColor;
        void main() {
          float f = dot(normalize(vViewPos), normalize(vNormal));
          float rim = 1.0 - clamp(f, 0.0, 1.0);
          gl_FragColor = vec4(glowColor * rim * rim, rim);
        }`,
      uniforms: { glowColor: { value: [0.2, 0.8, 1.0] } },
      transparent: true,
    },
    preview: 'linear-gradient(135deg,#0088ff,#00ffff)',
  },
  {
    id: 'rainbow', name: 'Rainbow Spectrum', category: 'Shader', type: 'ShaderMaterial',
    params: {
      vertexShader:   `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        varying vec2 vUv;
        vec3 hsv2rgb(vec3 c) {
          vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
          vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
          return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
        }
        void main() {
          gl_FragColor = vec4(hsv2rgb(vec3(vUv.x, 1.0, 1.0)), 1.0);
        }`,
    },
    preview: 'linear-gradient(90deg,red,orange,yellow,green,blue,violet)',
  },
];

/**
 * Get all materials for a given category.
 * Pass null/undefined to get all materials.
 * @param {string} [category]
 * @returns {Array}
 */
export function getMaterialsByCategory(category) {
  if (!category) return MATERIALS;
  return MATERIALS.filter(m => m.category === category);
}

/**
 * Get a single material preset by id.
 * @param {string} id
 * @returns {object|null}
 */
export function getMaterialById(id) {
  return MATERIALS.find(m => m.id === id) ?? null;
}
