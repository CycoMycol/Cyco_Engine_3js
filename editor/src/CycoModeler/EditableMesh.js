import * as THREE from 'three';

// Default segment counts for parametric primitives (cylinder/cone/sphere/etc.).
// Kept small enough that the editable mesh stays manageable but large enough
// that round shapes read as round at the default viewport zoom.
const DEFAULT_SEGMENTS = 24;
const STAIR_TREADS = 8;

export class EditableMesh {
  constructor({ vertices = [], faces = [], faceGroups = null } = {}) {
    this.vertices = vertices.map(v => new THREE.Vector3(v.x, v.y, v.z));
    this.faces = faces.map(face => [...face]);
    // `faceGroups` is a parallel array to `faces`. Two faces share a
    // group ID iff they are considered "the same polygon" for selection
    // purposes. The default (one entry per face, equal to its index)
    // means every face is its own polygon — but primitives that store
    // a logical quad as two triangles (e.g. `boxFromBounds`) can pass
    // paired group IDs so the two tris select as one polygon. Operations
    // that create new polygons from boundary edges (e.g. `pushFaces`
    // side walls) assign fresh group IDs so the new walls don't
    // accidentally merge with adjacent mesh faces that happen to lie on
    // the same geometric plane (which would over-select after a
    // push/pull — the bug being fixed here).
    this.faceGroups = faceGroups
      ? [...faceGroups]
      : this.faces.map((_, i) => i);
    // Monotonic counter for the next fresh group ID. Bumped every time
    // `pushFaces` synthesises a new side wall so each wall ends up in
    // its own group.
    this._nextGroupId = this.faceGroups.length;
  }

  static box(size = 100) {
    const h = size / 2;
    return EditableMesh.boxFromBounds(
      new THREE.Vector3(-h, -h, -h),
      new THREE.Vector3(h, h, h)
    );
  }

  static boxFromBounds(min, max) {
    // The box is stored as 12 triangles (2 per quad) so the wireframe
    // overlay can render the diagonals if it ever needs to. For
    // SELECTION purposes each pair is one logical polygon: face 0+1
    // are the back quad, 2+3 the front, etc. We pass explicit
    // `faceGroups` so the modeler's polygon picker treats each pair
    // as one face — without this `coplanarFaces` would still group
    // them (same plane), but if any future operation adds a face on
    // the same plane (e.g. an extrude side wall), the group IDs keep
    // it isolated.
    return new EditableMesh({
      vertices: [
        { x: min.x, y: min.y, z: min.z }, { x: max.x, y: min.y, z: min.z },
        { x: max.x, y: max.y, z: min.z }, { x: min.x, y: max.y, z: min.z },
        { x: min.x, y: min.y, z: max.z }, { x: max.x, y: min.y, z: max.z },
        { x: max.x, y: max.y, z: max.z }, { x: min.x, y: max.y, z: max.z },
      ],
      faces: [
        [0, 2, 1], [0, 3, 2],
        [4, 5, 6], [4, 6, 7],
        [0, 1, 5], [0, 5, 4],
        [3, 6, 2], [3, 7, 6],
        [1, 2, 6], [1, 6, 5],
        [0, 4, 7], [0, 7, 3],
      ],
      // Pair each quad's two tris: (0,1), (2,3), (4,5), (6,7),
      // (8,9), (10,11) — six logical polygons.
      faceGroups: [
        0, 0,
        1, 1,
        2, 2,
        3, 3,
        4, 4,
        5, 5,
      ],
    });
  }

  /**
   * Open-top box (UModeler-style "room"): floor + four walls, no ceiling.
   * `width` is the X extent, `depth` is Z, `height` is Y. Origin sits at
   * the centre of the floor (Y = 0) so the room grows upward.
   */
  static room(width, height, depth) {
    const w = width / 2;
    const d = depth / 2;
    const h = height;
    return new EditableMesh({
      vertices: [
        { x: -w, y: 0, z: -d }, // 0 floor BL-back
        { x:  w, y: 0, z: -d }, // 1 floor BR-back
        { x:  w, y: 0, z:  d }, // 2 floor BR-front
        { x: -w, y: 0, z:  d }, // 3 floor BL-front
        { x: -w, y: h, z: -d }, // 4 ceil BL-back (shared for back wall top)
        { x:  w, y: h, z: -d }, // 5 ceil BR-back
        { x:  w, y: h, z:  d }, // 6 ceil BR-front
        { x: -w, y: h, z:  d }, // 7 ceil BL-front
      ],
      faces: [
        // Floor (outward normal = -Y, so CCW viewed from below).
        [0, 1, 2], [0, 2, 3],
        // Back wall (outward normal = -Z).
        [0, 4, 5], [0, 5, 1],
        // Right wall (outward normal = +X).
        [1, 5, 6], [1, 6, 2],
        // Front wall (outward normal = +Z).
        [2, 6, 7], [2, 7, 3],
        // Left wall (outward normal = -X).
        [3, 7, 4], [3, 4, 0],
      ],
    });
  }

  /**
   * Straight stair running along +Z (footprint width × depth, total height).
   * `treads` = number of steps. Each tread is a horizontal quad at y =
   * (i+1)*treadRise and each riser is a vertical quad at z = i*treadRun.
   *
   * Per step we allocate 8 corner vertices explicitly (sharing is OK but
   * not required — the geometry is small enough that duplication does
   * not matter, and explicit corners keep the face topology trivially
   * correct: every face is axis-aligned, no diagonals).
   *
   *   FL_B = (-w, i*rise,   i*run)       // floor-front-left
   *   FR_B = ( w, i*rise,   i*run)
   *   BL_B = (-w, i*rise,   (i+1)*run)   // floor-back-left
   *   BR_B = ( w, i*rise,   (i+1)*run)
   *   FL_T = (-w, (i+1)*rise, i*run)     // top-front-left (= riser top)
   *   FR_T = ( w, (i+1)*rise, i*run)
   *   BL_T = (-w, (i+1)*rise, (i+1)*run) // top-back-left
   *   BR_T = ( w, (i+1)*rise, (i+1)*run)
   *
   * For step 0 the "floor" row sits at y=0; for steps 1..t-1 the floor
   * row coincides with the previous step's top row.
   */
  static stair(width, height, depth, treads = STAIR_TREADS) {
    const t = Math.max(1, Math.round(treads));
    const treadRise = height / t;
    const treadRun = depth / t;
    const w = width / 2;
    const vertices = [];
    const faces = [];
    // Per-step vertex allocation: 8 corners per step (floor-4 + top-4).
    // The floor-4 of step i is at y = i*rise; the top-4 is at y =
    // (i+1)*rise.  For step i >= 1 the floor-4 coincides with step
    // i-1's top-4, but we still allocate fresh indices to keep the
    // topology trivially correct.
    const steps = [];
    for (let i = 0; i < t; i += 1) {
      const yBot = i * treadRise;
      const yTop = (i + 1) * treadRise;
      const zF = i * treadRun;
      const zB = (i + 1) * treadRun;
      const FL_B = vertices.length; vertices.push({ x: -w, y: yBot, z: zF });
      const FR_B = vertices.length; vertices.push({ x:  w, y: yBot, z: zF });
      const BL_B = vertices.length; vertices.push({ x: -w, y: yBot, z: zB });
      const BR_B = vertices.length; vertices.push({ x:  w, y: yBot, z: zB });
      const FL_T = vertices.length; vertices.push({ x: -w, y: yTop, z: zF });
      const FR_T = vertices.length; vertices.push({ x:  w, y: yTop, z: zF });
      const BL_T = vertices.length; vertices.push({ x: -w, y: yTop, z: zB });
      const BR_T = vertices.length; vertices.push({ x:  w, y: yTop, z: zB });
      steps.push({ FL_B, FR_B, BL_B, BR_B, FL_T, FR_T, BL_T, BR_T });
    }
    for (let i = 0; i < t; i += 1) {
      const s = steps[i];
      // Tread (top of step): horizontal quad, CCW from above (+Y normal).
      //   FL_T → BL_T → BR_T → FR_T
      faces.push([s.FL_T, s.BL_T, s.BR_T, s.FR_T]);
      // Riser (front of step): vertical quad at z = i*run with outward
      // -Z normal. Cross product of the (FL_B → FR_B) and (FL_B → FL_T)
      // edges points +Z, so reverse the listing to get -Z.
      faces.push([s.FL_B, s.FL_T, s.FR_T, s.FR_B]);
      // Left side (-X): outward normal points -X. Reversed winding
      //   FL_B → BL_B → BL_T → FL_T
      // matches the (right-handed) cross-product test.
      faces.push([s.FL_B, s.BL_B, s.BL_T, s.FL_T]);
      // Right side (+X): outward normal points +X. Reversed winding
      //   FR_B → FR_T → BR_T → BR_B
      // matches the (right-handed) cross-product test.
      faces.push([s.FR_B, s.FR_T, s.BR_T, s.BR_B]);
    }
    // Bottom face at y=0: only step 0 contributes (subsequent steps have
    // their "floor" inside the stair body, hidden by the tread above).
    {
      const s0 = steps[0];
      //   FL_B → FR_B → BR_B → BL_B  (CCW from below, -Y normal)
      faces.push([s0.FL_B, s0.FR_B, s0.BR_B, s0.BL_B]);
    }
    // Back face at z = t*run (top of the stair).
    {
      const last = steps[t - 1];
      //   BL_B → BL_T → BR_T → BR_B  (CCW from -Z so normal is -Z)
      faces.push([last.BL_B, last.BL_T, last.BR_T, last.BR_B]);
    }
    return new EditableMesh({ vertices, faces });
  }

  /**
   * Side-stair: same construction as `stair` but rotated 90° about Y so it
   * runs along +X (width axis) instead of +Z. Keeps the same footprint.
   */
  static sideStair(width, height, depth, treads = STAIR_TREADS) {
    const mesh = EditableMesh.stair(width, height, depth, treads);
    const cos = Math.cos(Math.PI / 2);
    const sin = Math.sin(Math.PI / 2);
    for (const v of mesh.vertices) {
      const x = v.x;
      const z = v.z;
      v.x = x * cos + z * sin;
      v.z = -x * sin + z * cos;
    }
    return mesh;
  }

  /**
   * Spiral stair: helical step surface climbing from Y=0 to Y=height
   * over `turns` full revolutions. Each step is a wedge-shaped prism
   * with a HORIZONTAL tread top (so the steps are clearly visible as
   * steps), a vertical riser, an outer side, and a back-of-tread face.
   * Mirrors the construction used by the regular `stair` primitive
   * (per-step corner allocation, axis-aligned local face topology) but
   * mapped onto a cylindrical ring: instead of stepping along +Z, each
   * step is rotated about the Y axis by `sweepPerStep`.
   *
   * Per-step corners (matching `stair` naming convention):
   *   InF_B = inner-front-bottom   (riser base, inner ring, leading angle)
   *   OuF_B = outer-front-bottom
   *   OuB_B = outer-back-bottom    (trailing angle)
   *   InF_T = inner-front-top      (riser top, leading angle)
   *   OuF_T = outer-front-top
   *   OuB_T = outer-back-top
   *
   * `width` sets the outer footprint diameter (the railing), `depth`
   * sets the radial run (depth of each step from outer edge inward).
   * Inner radius = width/2 - depth. The tread top is the annular
   * sector between inner and outer radii at the step's angular
   * extent — a true horizontal surface you can stand on, exactly like
   * the regular `stair` tread.
   */
  static spiralStair(width, height, depth, segments = DEFAULT_SEGMENTS, turns = 1) {
    const seg = Math.max(8, Math.round(segments));
    const totalSteps = Math.max(4, Math.round(seg * Math.max(0.25, turns)));
    const rOuter = Math.max(1, width / 2);
    const rInner = Math.max(0, rOuter - Math.max(0, depth));
    // When rInner === 0 the inner edge collapses to the central axis;
    // the inner corners share the origin vertex and faces become
    // degenerate quads (rendered as triangles), which still reads
    // correctly as a knife-edge spiral.
    const sweepPerStep = (Math.PI * 2 * turns) / totalSteps;
    const stepRise = height / totalSteps;
    const vertices = [];
    const faces = [];
    const steps = [];
    for (let i = 0; i < totalSteps; i += 1) {
      const yBot = i * stepRise;
      const yTop = (i + 1) * stepRise;
      const aF = i * sweepPerStep;
      const aB = (i + 1) * sweepPerStep;
      const cosF = Math.cos(aF);
      const sinF = Math.sin(aF);
      const cosB = Math.cos(aB);
      const sinB = Math.sin(aB);
      // Inner corners (collapse to origin when rInner === 0).
      const InF_B = vertices.length; vertices.push({ x: 0,          y: yBot, z: 0 });
      const InF_T = vertices.length; vertices.push({ x: 0,          y: yTop, z: 0 });
      // Outer corners.
      const OuF_B = vertices.length; vertices.push({ x: cosF * rOuter, y: yBot, z: sinF * rOuter });
      const OuF_T = vertices.length; vertices.push({ x: cosF * rOuter, y: yTop, z: sinF * rOuter });
      const OuB_B = vertices.length; vertices.push({ x: cosB * rOuter, y: yBot, z: sinB * rOuter });
      const OuB_T = vertices.length; vertices.push({ x: cosB * rOuter, y: yTop, z: sinB * rOuter });
      steps.push({ InF_B, InF_T, OuF_B, OuF_T, OuB_B, OuB_T });
    }
    for (let i = 0; i < totalSteps; i += 1) {
      const s = steps[i];
      // Tread (top of step): horizontal annular sector. Winding
      // `InF_T → OuB_T → OuF_T` produces a +Y normal (outward from the
      // tread) because CCW ordering about the axis reverses the sign
      // of the cross product relative to a regular quad.
      faces.push([s.InF_T, s.OuB_T, s.OuF_T]);
      // Outer side (vertical face along the outside edge of the
      // tread). Outward direction is purely radial. Winding
      // `OuF_B → OuF_T → OuB_T → OuB_B` gives an outward radial
      // normal.
      faces.push([s.OuF_B, s.OuF_T, s.OuB_T, s.OuB_B]);
      // Back of tread (vertical face at the trailing edge of the
      // tread). Outward direction is the radial-CW direction (away
      // from the next step). Winding `OuB_B → OuB_T → InF_T → InF_B`
      // gives an outward (negative angular) normal.
      faces.push([s.OuB_B, s.OuB_T, s.InF_T, s.InF_B]);
      // Riser (front of step): vertical face at the leading edge of
      // the tread. Outward direction is the radial-CCW direction
      // (toward the next step). Winding `InF_B → OuF_B → OuF_T → InF_T`
      // gives an outward (positive angular) normal.
      faces.push([s.InF_B, s.OuF_B, s.OuF_T, s.InF_T]);
    }
    // Bottom face at y=0: only step 0 contributes (subsequent steps
    // have their floor inside the stair body, hidden by the tread
    // above). Triangle `InF_B → OuF_B → OuB_B` so the cross product
    // points -Y (outward from the underside of the spiral).
    {
      const s0 = steps[0];
      faces.push([s0.InF_B, s0.OuF_B, s0.OuB_B]);
    }
    return new EditableMesh({ vertices, faces });
  }

  /**
   * Cylinder: bottom cap, top cap, and a side wall of quad strips. Origin
   * sits at the centre of the cylinder (Y = -height/2 .. +height/2).
   */
  static cylinder(width, height, depth, segments = DEFAULT_SEGMENTS) {
    const radius = Math.max(0.5, width / 2);
    const seg = Math.max(6, Math.round(segments));
    const halfH = height / 2;
    const vertices = [];
    const faces = [];
    const bottomCenter = vertices.length; vertices.push({ x: 0, y: -halfH, z: 0 });
    const topCenter = vertices.length;    vertices.push({ x: 0, y:  halfH, z: 0 });
    const bottomRing = [];
    const topRing = [];
    for (let i = 0; i < seg; i += 1) {
      const a = (i / seg) * Math.PI * 2;
      const x = Math.cos(a) * radius;
      const z = Math.sin(a) * radius;
      bottomRing.push(vertices.length); vertices.push({ x, y: -halfH, z });
      topRing.push(vertices.length);    vertices.push({ x, y:  halfH, z });
    }
    for (let i = 0; i < seg; i += 1) {
      const j = (i + 1) % seg;
      // Side wall (CCW from outside): bottom-i, top-i, top-j, bottom-j.
      faces.push([bottomRing[i], topRing[i], topRing[j], bottomRing[j]]);
      // Bottom cap (outward -Y normal, so CCW from below). With the
      // ring winding `i → j` going CW from below, list the larger
      // index first so the triangle winds CCW from below.
      faces.push([bottomCenter, bottomRing[i], bottomRing[j]]);
      // Top cap (outward +Y normal, so CCW from above). `i → j` is
      // CCW from above so list the smaller index first.
      faces.push([topCenter, topRing[j], topRing[i]]);
    }
    return new EditableMesh({ vertices, faces });
  }

  /**
   * Cone: side wall meeting at a single apex, plus a bottom cap. Origin
   * is at the centre of the base; apex sits at +height.
   */
  static cone(width, height, depth, segments = DEFAULT_SEGMENTS) {
    const radius = Math.max(0.5, width / 2);
    const seg = Math.max(6, Math.round(segments));
    const vertices = [];
    const faces = [];
    const bottomCenter = vertices.length; vertices.push({ x: 0, y: 0, z: 0 });
    const apex = vertices.length;         vertices.push({ x: 0, y: height, z: 0 });
    const baseRing = [];
    for (let i = 0; i < seg; i += 1) {
      const a = (i / seg) * Math.PI * 2;
      baseRing.push(vertices.length);
      vertices.push({ x: Math.cos(a) * radius, y: 0, z: Math.sin(a) * radius });
    }
    for (let i = 0; i < seg; i += 1) {
      const j = (i + 1) % seg;
      // Side (outward normal). Winding `[apex, baseRing[j], baseRing[i]]`
      // gives an outward (upward + radial) normal for the upward-tapering
      // triangle.
      faces.push([apex, baseRing[j], baseRing[i]]);
      // Bottom cap (outward -Y normal, CCW from below). `i → j` is CW
      // from below so list the larger index first.
      faces.push([bottomCenter, baseRing[i], baseRing[j]]);
    }
    return new EditableMesh({ vertices, faces });
  }

  /**
   * UV sphere: rings of vertices stacked vertically, with quads between
   * rings and triangle caps at the poles. Origin at the sphere's centre.
   */
  static sphere(width, height, depth, segments = DEFAULT_SEGMENTS) {
    const radius = Math.max(0.5, Math.max(width, depth) / 2);
    const seg = Math.max(8, Math.round(segments));
    const rings = Math.max(4, Math.round(segments / 2));
    const vertices = [];
    const faces = [];
    const top = vertices.length;    vertices.push({ x: 0, y: radius, z: 0 });
    const bottom = vertices.length; vertices.push({ x: 0, y: -radius, z: 0 });
    const ringIdxs = [];
    for (let r = 1; r < rings; r += 1) {
      const phi = (r / rings) * Math.PI;
      const ringY = radius * Math.cos(phi);
      const ringR = radius * Math.sin(phi);
      const ring = [];
      for (let i = 0; i < seg; i += 1) {
        const a = (i / seg) * Math.PI * 2;
        ring.push(vertices.length);
        vertices.push({
          x: Math.cos(a) * ringR,
          y: ringY,
          z: Math.sin(a) * ringR,
        });
      }
      ringIdxs.push(ring);
    }
    // Top cap: triangle fan from the north pole to the first ring.
    // Outward +Y normal requires the fan to wind CW from above, which
    // means listing the ring vertex with the larger index first.
    for (let i = 0; i < seg; i += 1) {
      const j = (i + 1) % seg;
      faces.push([top, ringIdxs[0][j], ringIdxs[0][i]]);
    }
    // Quad strips between consecutive rings.
    for (let r = 0; r < ringIdxs.length - 1; r += 1) {
      const cur = ringIdxs[r];
      const next = ringIdxs[r + 1];
      for (let i = 0; i < seg; i += 1) {
        const j = (i + 1) % seg;
        // Outward normal has a positive Y component on the upper
        // hemisphere and a negative one on the lower hemisphere, with
        // a purely-radial equator. The winding `[cur[i], cur[j],
        // next[j], next[i]]` produces an outward-pointing normal for
        // every ring strip.
        faces.push([cur[i], cur[j], next[j], next[i]]);
      }
    }
    // Bottom cap: triangle fan from the last ring down to the south
    // pole. Outward -Y normal requires CCW from below; with `i → j`
    // being CW from below, list the smaller index first.
    const lastRing = ringIdxs[ringIdxs.length - 1];
    for (let i = 0; i < seg; i += 1) {
      const j = (i + 1) % seg;
      faces.push([bottom, lastRing[i], lastRing[j]]);
    }
    return new EditableMesh({ vertices, faces });
  }

  /**
   * Capsule: cylinder body with two hemispherical caps. Total height is
   * `height` (including the caps); the cylindrical middle section is
   * `height - 2*radius`.
   *
   * Radius is clamped so the body section is always at least 20% of the
   * total height — otherwise height <= 2*radius collapses the body to
   * zero and the shape degenerates into a sphere (two hemispheres
   * back-to-back).
   */
  static capsule(width, height, depth, segments = DEFAULT_SEGMENTS) {
    const requestedRadius = Math.max(0.5, Math.min(width, depth) / 2);
    const maxRadius = Math.max(0.5, height * 0.4); // 2*maxRadius <= 0.8*height
    const radius = Math.min(requestedRadius, maxRadius);
    const mid = Math.max(0, height - 2 * radius);
    const halfMid = mid / 2;
    const seg = Math.max(8, Math.round(segments));
    const vertices = [];
    const faces = [];
    // Cylinder body: top ring at +halfMid, bottom ring at -halfMid.
    const topRing = [];
    const bottomRing = [];
    for (let i = 0; i < seg; i += 1) {
      const a = (i / seg) * Math.PI * 2;
      const x = Math.cos(a) * radius;
      const z = Math.sin(a) * radius;
      topRing.push(vertices.length);    vertices.push({ x, y:  halfMid, z });
      bottomRing.push(vertices.length); vertices.push({ x, y: -halfMid, z });
    }
    for (let i = 0; i < seg; i += 1) {
      const j = (i + 1) % seg;
      faces.push([bottomRing[i], topRing[i], topRing[j], bottomRing[j]]);
    }
    // Top hemisphere rings.
    const topHemi = [];
    const rings = Math.max(3, Math.round(segments / 2));
    for (let r = 1; r < rings; r += 1) {
      const phi = (r / rings) * (Math.PI / 2);
      const ringY = halfMid + radius * Math.sin(phi);
      const ringR = radius * Math.cos(phi);
      const ring = [];
      for (let i = 0; i < seg; i += 1) {
        const a = (i / seg) * Math.PI * 2;
        ring.push(vertices.length);
        vertices.push({
          x: Math.cos(a) * ringR,
          y: ringY,
          z: Math.sin(a) * ringR,
        });
      }
      topHemi.push(ring);
    }
    const topPole = vertices.length; vertices.push({ x: 0, y: halfMid + radius, z: 0 });
    if (topHemi.length) {
      // Connector strip from cylinder top ring to first hemisphere ring
      // (the "equator" of the upper hemisphere). Each cell is a quad
      // with outward-facing (+Y) winding. Viewed from above, the angle
      // `a = (i/seg)*2π` increases CCW so CCW-from-above means winding
      // `i → j = i+1` along the ring; radial outward moves from the
      // topRing (outer) to topHemi[0] (slightly inner & higher).
      for (let i = 0; i < seg; i += 1) {
        const j = (i + 1) % seg;
        faces.push([topRing[i], topHemi[0][i], topHemi[0][j], topRing[j]]);
      }
      // Ring strips between consecutive upper-hemisphere rings. Same
      // +Y-outward winding as the connector strip.
      for (let r = 0; r < topHemi.length - 1; r += 1) {
        const cur = topHemi[r];
        const next = topHemi[r + 1];
        for (let i = 0; i < seg; i += 1) {
          const j = (i + 1) % seg;
          faces.push([cur[i], next[i], next[j], cur[j]]);
        }
      }
      // Pole cap (triangle fan). Outward +Y normal: viewing the fan
      // from above, `lastRing[i]` and `lastRing[j=i+1]` are CCW so the
      // fan must list the larger index first to wind CW-from-above
      // (which gives an upward-pointing normal when the pole is at
      // the apex).
      const lastRing = topHemi[topHemi.length - 1];
      for (let i = 0; i < seg; i += 1) {
        const j = (i + 1) % seg;
        faces.push([topPole, lastRing[j], lastRing[i]]);
      }
    } else {
      // Degenerate: tiny capsule, just connect top ring to pole.
      for (let i = 0; i < seg; i += 1) {
        const j = (i + 1) % seg;
        faces.push([topRing[i], topPole, topRing[j]]);
      }
    }
    // Bottom hemisphere rings.
    const bottomHemi = [];
    for (let r = 1; r < rings; r += 1) {
      const phi = (r / rings) * (Math.PI / 2);
      const ringY = -halfMid - radius * Math.sin(phi);
      const ringR = radius * Math.cos(phi);
      const ring = [];
      for (let i = 0; i < seg; i += 1) {
        const a = (i / seg) * Math.PI * 2;
        ring.push(vertices.length);
        vertices.push({
          x: Math.cos(a) * ringR,
          y: ringY,
          z: Math.sin(a) * ringR,
        });
      }
      bottomHemi.push(ring);
    }
    const bottomPole = vertices.length; vertices.push({ x: 0, y: -halfMid - radius, z: 0 });
    if (bottomHemi.length) {
      // Connector strip from cylinder bottom ring to first hemisphere
      // ring (the "equator" of the lower hemisphere). Each cell is a
      // quad with outward-facing (-Y) winding. Viewed from below (-Y
      // looking up) the angle `a = (i/seg)*2π` increases CW, so CCW
      // from below means winding `j → i` along the ring. Quad:
      // bottomRing[i] → bottomRing[j] → bottomHemi[0][j] → bottomHemi[0][i].
      for (let i = 0; i < seg; i += 1) {
        const j = (i + 1) % seg;
        faces.push([bottomRing[i], bottomRing[j], bottomHemi[0][j], bottomHemi[0][i]]);
      }
      // Ring strips between consecutive lower-hemisphere rings. Same
      // -Y-outward winding as the connector strip.
      for (let r = 0; r < bottomHemi.length - 1; r += 1) {
        const cur = bottomHemi[r];
        const next = bottomHemi[r + 1];
        for (let i = 0; i < seg; i += 1) {
          const j = (i + 1) % seg;
          faces.push([cur[i], cur[j], next[j], next[i]]);
        }
      }
      // Pole cap (triangle fan). Outward -Y normal requires CCW from
      // below; `i → j` is CW from below, so reverse to get CCW.
      const lastRing = bottomHemi[bottomHemi.length - 1];
      for (let i = 0; i < seg; i += 1) {
        const j = (i + 1) % seg;
        faces.push([bottomPole, lastRing[i], lastRing[j]]);
      }
    } else {
      // Degenerate: tiny capsule. Outward -Y winding requires the ring
      // vertices listed in reverse (CW from above) order.
      for (let i = 0; i < seg; i += 1) {
        const j = (i + 1) % seg;
        faces.push([bottomRing[j], bottomRing[i], bottomPole]);
      }
    }
    return new EditableMesh({ vertices, faces });
  }

  /**
   * Torus: tube wrapping around the Y axis. `width` is the major radius,
   * `height` (capped to width/2) is the tube radius. Quad strips along
   * the tube.
   */
  static torus(width, height, depth, segments = DEFAULT_SEGMENTS) {
    const major = Math.max(1, width / 2);
    const minor = Math.max(0.5, Math.min(height / 2, major));
    const segMajor = Math.max(12, Math.round(segments));
    const segMinor = Math.max(6, Math.round(segments / 2));
    const vertices = [];
    const faces = [];
    const rings = [];
    for (let i = 0; i < segMajor; i += 1) {
      const u = (i / segMajor) * Math.PI * 2;
      const cu = Math.cos(u);
      const su = Math.sin(u);
      const ring = [];
      for (let j = 0; j < segMinor; j += 1) {
        const v = (j / segMinor) * Math.PI * 2;
        const cv = Math.cos(v);
        const sv = Math.sin(v);
        ring.push(vertices.length);
        vertices.push({
          x: (major + minor * cv) * cu,
          y: minor * sv,
          z: (major + minor * cv) * su,
        });
      }
      rings.push(ring);
    }
    for (let i = 0; i < segMajor; i += 1) {
      const i2 = (i + 1) % segMajor;
      const cur = rings[i];
      const next = rings[i2];
      for (let j = 0; j < segMinor; j += 1) {
        const j2 = (j + 1) % segMinor;
        // Quad along the tube. The outward normal at this cell points
        // away from the major-axis circle `(major*cos(u), 0,
        // major*sin(u))`. The winding `[cur[j], cur[j2], next[j2],
        // next[j]]` produces an outward-pointing normal for the
        // (major+minor*cv) radial direction.
        faces.push([cur[j], cur[j2], next[j2], next[j]]);
      }
    }
    return new EditableMesh({ vertices, faces });
  }

  /**
   * Icosahedron: regular icosahedron triangulated to 20 faces. Uses the
   * canonical 12-vertex coordinates and lets `width` set the overall size.
   */
  static icosahedron(width, height, depth) {
    // `height` is accepted for API parity with the other primitives but
    // an icosahedron is uniformly sized along all axes; fall back to
    // `width` if `height` or `depth` is undefined (e.g. callers that
    // pass a single size argument).
    const w = Number.isFinite(width) ? width : 1;
    const h = Number.isFinite(height) ? height : w;
    const d = Number.isFinite(depth) ? depth : w;
    const r = Math.max(1, Math.max(w, h, d) / 2);
    const t = (1 + Math.sqrt(5)) / 2;
    const norm = Math.sqrt(1 + t * t);
    const k = r / norm;
    const baseVerts = [
      [-1,  t,  0], [ 1,  t,  0], [-1, -t,  0], [ 1, -t,  0],
      [ 0, -1,  t], [ 0,  1,  t], [ 0, -1, -t], [ 0,  1, -t],
      [ t,  0, -1], [ t,  0,  1], [-t,  0, -1], [-t,  0,  1],
    ];
    const vertices = baseVerts.map(([x, y, z]) => ({ x: x * k, y: y * k, z: z * k }));
    const faces = [
      [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
      [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
      [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
      [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
    ];
    return new EditableMesh({ vertices, faces });
  }

  static fromJSON(data) {
    return new EditableMesh(data || {});
  }

  removeFaces(faceIndices) {
    const doomed = new Set(faceIndices);
    this.faces = this.faces.filter((_, index) => !doomed.has(index));
    if (this.faceGroups?.length === this.faces.length + doomed.size) {
      this.faceGroups = this.faceGroups.filter((_, index) => !doomed.has(index));
    }
  }

  /**
   * Return every face that is part of the same logical polygon as
   * `faceIndex` (i.e. shares its `faceGroup` ID). This is the
   * selection group used by the modeler's polygon picker. Using
   * `faceGroup` instead of a pure geometric coplanar test prevents
   * push/pull side walls — which can lie on the same geometric plane
   * as adjacent mesh faces (e.g. the top side wall of an extruded
   * back face sits on the same Y plane as the box's top face) —
   * from being over-included when the user clicks an adjacent face.
   *
   * The geometric coplanar test is kept as a fallback for meshes
   * whose `faceGroup` data has been lost (e.g. loaded from an older
   * JSON blob that did not include groups): in that case every face
   * has a unique group ID, so the group check returns only the seed
   * face — but coplanarFaces-style grouping is sometimes still
   * wanted for legacy compatibility. Callers can opt into the
   * geometric fallback by passing `{ includeCoplanar: true }`.
   */
  selectionGroup(faceIndex, { includeCoplanar = false } = {}) {
    const face = this.faces[faceIndex];
    if (!face) return [];
    if (!this.faceGroups || this.faceGroups.length !== this.faces.length) {
      // Defensive fallback — the mesh has no group data, return just
      // the seed face so callers can still operate on a single polygon.
      return [faceIndex];
    }
    const targetGroup = this.faceGroups[faceIndex];
    const out = [];
    for (let i = 0; i < this.faces.length; i += 1) {
      if (this.faceGroups[i] === targetGroup) out.push(i);
    }
    if (out.length > 1 || !includeCoplanar) return out;
    // Legacy fallback: include any other face that is geometrically
    // coplanar AND shares at least one edge with the seed face. This
    // mirrors the original coplanarFaces behaviour for meshes built
    // before faceGroup tracking existed.
    const seen = new Set(out);
    const seedNormal = this._faceNormal(faceIndex);
    const seedOrigin = this.vertices[face[0]];
    const planeOffset = seedNormal.dot(seedOrigin);
    const seedEdges = new Set();
    for (let i = 0; i < face.length; i += 1) {
      const a = face[i];
      const b = face[(i + 1) % face.length];
      seedEdges.add(a < b ? `${a}:${b}` : `${b}:${a}`);
    }
    for (let i = 0; i < this.faces.length; i += 1) {
      if (seen.has(i)) continue;
      const other = this.faces[i];
      if (!other || other.length < 3) continue;
      const otherNormal = this._faceNormal(i);
      if (seedNormal.dot(otherNormal) < 0.999) continue;
      if (Math.abs(otherNormal.dot(this.vertices[other[0]]) - planeOffset) > 0.001) continue;
      // Require at least one shared edge to include.
      let shared = false;
      for (let j = 0; j < other.length; j += 1) {
        const a = other[j];
        const b = other[(j + 1) % other.length];
        const key = a < b ? `${a}:${b}` : `${b}:${a}`;
        if (seedEdges.has(key)) { shared = true; break; }
      }
      if (shared) out.push(i);
    }
    return out;
  }

  coplanarFaces(faceIndex, tolerance = 0.001) {
    // Legacy API retained for callers that genuinely want all
    // geometric coplanar faces (not just selection-group siblings).
    const face = this.faces[faceIndex];
    if (!face) return [];
    const normal = this._faceNormal(faceIndex);
    const origin = this.vertices[face[0]];
    const planeOffset = normal.dot(origin);
    return this.faces
      .map((_, index) => index)
      .filter(index => {
        const other = this._faceNormal(index);
        const otherFace = this.faces[index];
        if (normal.dot(other) < 0.999) return false;
        return Math.abs(normal.dot(this.vertices[otherFace[0]]) - planeOffset) <= tolerance;
      });
  }

  pushFaces(faceIndices, distance) {
    const selected = [...new Set(faceIndices)]
      .filter(index => index >= 0 && index < this.faces.length)
      .sort((a, b) => a - b);
    if (!selected.length) return;

    const normal = this._averageNormal(selected);
    const offset = normal.multiplyScalar(distance);
    const selectedSet = new Set(selected);
    const vertexMap = new Map();

    for (const faceIndex of selected) {
      for (const vertexIndex of this.faces[faceIndex]) {
        if (vertexMap.has(vertexIndex)) continue;
        const next = this.vertices[vertexIndex].clone().add(offset);
        vertexMap.set(vertexIndex, this.vertices.length);
        this.vertices.push(next);
      }
    }

    const boundary = new Map();
    for (const faceIndex of selected) {
      const face = this.faces[faceIndex];
      for (let i = 0; i < face.length; i += 1) {
        const a = face[i];
        const b = face[(i + 1) % face.length];
        // Undirected key cancels interior edges shared between adjacent
        // selected faces (each appears with opposite winding direction).
        // The stored direction comes from the original face winding so
        // the resulting side quad stays outward-facing.
        const key = a < b ? `${a}:${b}` : `${b}:${a}`;
        if (boundary.has(key)) boundary.delete(key);
        else boundary.set(key, [a, b]);
      }
    }

    const replacement = this.faces.map((face, index) => (
      selectedSet.has(index) ? face.map(vertexIndex => vertexMap.get(vertexIndex)) : face
    ));
    // `faceGroups` must stay parallel to `faces`. The pushed faces
    // keep their existing groups (which already cover their coplanar
    // siblings like box quad pairs). Each new side wall gets a fresh
    // group ID so it can never over-select with adjacent mesh faces
    // that happen to share its geometric plane (the bug the modeler
    // hit after push/pull).
    const replacementGroups = this.faceGroups
      ? this.faceGroups.map((group, index) => (
          selectedSet.has(index) ? group : group
        ))
      : null;

    for (const [a, b] of boundary.values()) {
      // Wind side quads so their outward normal points away from the
      // pushed face (UModeler-style). Edge `(a, b)` is the original
      // boundary edge in face winding order; `(aPrime, bPrime)` is the
      // extruded copy. Triangle 1 normal direction is `sign(d) * (b-a)×n`,
      // so reverse the winding when pushing inward to keep the wall
      // outward-facing.
      const aPrime = vertexMap.get(a);
      const bPrime = vertexMap.get(b);
      if (distance >= 0) {
        replacement.push([a, b, bPrime, aPrime]);
      } else {
        replacement.push([a, aPrime, bPrime, b]);
      }
      if (replacementGroups) {
        // Fresh group per side wall — see comment above. Each new
        // side wall is a distinct polygon in the user's mental model
        // (it has its own outline + normal direction at the new
        // position), so it should never over-select with another face
        // that happens to be on the same geometric plane.
        replacementGroups.push(this._nextGroupId++);
      }
    }

    this.faces = replacement;
    if (replacementGroups) this.faceGroups = replacementGroups;
  }

  _averageNormal(faceIndices) {
    const normal = new THREE.Vector3();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    for (const faceIndex of faceIndices) {
      const face = this.faces[faceIndex];
      if (!face || face.length < 3) continue;
      a.subVectors(this.vertices[face[1]], this.vertices[face[0]]);
      b.subVectors(this.vertices[face[2]], this.vertices[face[0]]);
      normal.add(a.cross(b).normalize());
    }
    return normal.lengthSq() > 0 ? normal.normalize() : new THREE.Vector3(0, 1, 0);
  }

  _faceNormal(faceIndex) {
    const face = this.faces[faceIndex];
    if (!face || face.length < 3) return new THREE.Vector3(0, 1, 0);
    const a = new THREE.Vector3().subVectors(this.vertices[face[1]], this.vertices[face[0]]);
    const b = new THREE.Vector3().subVectors(this.vertices[face[2]], this.vertices[face[0]]);
    return a.cross(b).normalize();
  }

  toBufferGeometry() {
    const positions = [];
    const faceIds = [];
    for (let faceIndex = 0; faceIndex < this.faces.length; faceIndex += 1) {
      const face = this.faces[faceIndex];
      if (face.length < 3) continue;
      // Fan-triangulate polygons so non-triangle faces (post Push/Pull quads)
      // render correctly. The faceId attribute lets raycasts map triangle
      // index back to the source EditableMesh face.
      for (let i = 1; i < face.length - 1; i += 1) {
        const a = this.vertices[face[0]];
        const b = this.vertices[face[i]];
        const c = this.vertices[face[i + 1]];
        positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
        faceIds.push(faceIndex, faceIndex, faceIndex);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('faceId', new THREE.Float32BufferAttribute(faceIds, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }

  toJSON() {
    return {
      vertices: this.vertices.map(v => ({ x: v.x, y: v.y, z: v.z })),
      faces: this.faces.map(face => [...face]),
      // Persist selection groups so project save/load and undo/redo
      // round-trip correctly. Older blobs without `faceGroups` will
      // get a default (every face is its own polygon) on load.
      faceGroups: this.faceGroups ? [...this.faceGroups] : undefined,
    };
  }

  /**
   * Build a `BufferGeometry` of line segments from this mesh's polygon
   * edges (NOT from triangulation diagonals). Each polygon contributes
   * its outer boundary; edges shared between coplanar adjacent polygons
   * are deduplicated so the wireframe outline matches the user's mental
   * model of the source faces.
   *
   * Used by the modeler wireframe overlay so the wireframe on a sphere
   * shows latitude/longitude quads, on a stair shows step treads+risers
   * (not the diagonal geometry), etc.
   *
   * Each segment is two consecutive vertices in the `position` attribute
   * (the format `THREE.EdgesGeometry` / `LineSegments` expect).
   *
   * @param {number} [angleThreshold=1] degrees — drop edges between two
   *   faces whose normals differ by less than this. Set to 0 to keep
   *   every shared edge (useful when faces are intentionally
   *   non-coplanar and the user wants to see them all).
   */
  toEdgesGeometry(angleThreshold = 1) {
    // First, compute every face's normal (once).
    const faceNormals = this.faces.map((face, fi) => {
      if (!face || face.length < 3) return null;
      const a = this.vertices[face[0]];
      const b = this.vertices[face[1]];
      const c = this.vertices[face[2]];
      const ab = new THREE.Vector3().subVectors(b, a);
      const ac = new THREE.Vector3().subVectors(c, a);
      const n = ab.cross(ac);
      return n.lengthSq() > 1e-12 ? n.normalize() : null;
    });
    // Build edge → list of face indices that share it.
    const edgeFaces = new Map();
    const keyOf = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);
    for (let fi = 0; fi < this.faces.length; fi += 1) {
      const face = this.faces[fi];
      if (!face || face.length < 3) continue;
      for (let i = 0; i < face.length; i += 1) {
        const a = face[i];
        const b = face[(i + 1) % face.length];
        const key = keyOf(a, b);
        if (!edgeFaces.has(key)) edgeFaces.set(key, []);
        edgeFaces.get(key).push({ a, b, fi });
      }
    }
    // Detect "pole" vertices — vertices whose incident edges are
    // shared by coplanar face pairs (e.g. a sphere's north pole, where
    // every cap-triangle pair has identical normals). The angle-threshold
    // test would otherwise drop those spokes, leaving the pole vertex
    // stranded with no wireframe edges ("dead space" at the tip).
    //
    // Heuristic: a vertex is a pole if ALL its incident edges are
    // shared by face pairs whose normals agree within the threshold.
    // For each vertex, collect the per-edge "all-coplanar" flag; if
    // every edge touching it qualifies, treat the vertex as a pole and
    // always emit its spokes.
    const vertexEdgeCount = new Map();
    const vertexAllCoplanar = new Map();
    const cosThreshold = Math.cos((angleThreshold * Math.PI) / 180);
    for (const [, info] of edgeFaces) {
      const isCoplanarPair =
        info.length === 2 &&
        faceNormals[info[0].fi] &&
        faceNormals[info[1].fi] &&
        faceNormals[info[0].fi].dot(faceNormals[info[1].fi]) >= cosThreshold;
      const vertices = [info[0].a, info[0].b];
      for (const v of vertices) {
        vertexEdgeCount.set(v, (vertexEdgeCount.get(v) || 0) + 1);
        if (!isCoplanarPair) vertexAllCoplanar.set(v, false);
        else if (!vertexAllCoplanar.has(v)) vertexAllCoplanar.set(v, true);
      }
    }
    const isPole = (v) => vertexAllCoplanar.get(v) === true && (vertexEdgeCount.get(v) || 0) >= 3;
    // For each edge, decide whether to emit it:
    //   - Always emit if it borders only one face (boundary).
    //   - Always emit if it borders more than two faces (non-manifold).
    //   - For two-face edges, emit if the face normals differ by more
    //     than `angleThreshold` degrees, OR if either endpoint is a
    //     pole vertex (so the spoke is visible at the tip).
    const positions = [];
    // Per-EMITTED-segment face normal data, for back-face culling in the
    // wireframe overlay. Each emitted segment stores 0-2 face normals
    // (flat array, every 3 floats = one [nx, ny, nz] triple); the ribbon
    // builder transforms them to world via the parent matrix and skips
    // a segment if BOTH adjacent face normals point away from the
    // camera. Stored in LOCAL space.
    // Indexing: segFaceNormals[i] corresponds to segment i of the
    // geometry's position attribute (i.e. vertex pair (i*2, i*2+1)).
    const segFaceNormals = []; // each entry: number[] of length 0, 3, or 6
    for (const [, info] of edgeFaces) {
      if (info.length === 1) {
        const { a, b, fi } = info[0];
        const va = this.vertices[a];
        const vb = this.vertices[b];
        positions.push(va.x, va.y, va.z, vb.x, vb.y, vb.z);
        const n = faceNormals[fi];
        segFaceNormals.push(n ? [n.x, n.y, n.z] : []);
      } else if (info.length === 2) {
        const n1 = faceNormals[info[0].fi];
        const n2 = faceNormals[info[1].fi];
        const dot = (n1 && n2) ? n1.dot(n2) : 1;
        const { a, b } = info[0];
        const poleSpoke = isPole(a) || isPole(b);
        if (dot < cosThreshold || poleSpoke) {
          const va = this.vertices[a];
          const vb = this.vertices[b];
          positions.push(va.x, va.y, va.z, vb.x, vb.y, vb.z);
          const normals = [];
          if (n1) normals.push(n1.x, n1.y, n1.z);
          if (n2) normals.push(n2.x, n2.y, n2.z);
          segFaceNormals.push(normals);
        } else {
          // Skipped: angle too small (e.g. quad triangulation diagonal).
          // We still push an empty entry so the indices line up if some
          // downstream caller needs them; but in practice only emitted
          // edges end up in the BufferGeometry.
          segFaceNormals.push([]);
        }
      } else {
        // 3+ faces share this edge → always emit.
        const { a, b } = info[0];
        const va = this.vertices[a];
        const vb = this.vertices[b];
        positions.push(va.x, va.y, va.z, vb.x, vb.y, vb.z);
        const normals = [];
        for (const e of info) {
          const n = faceNormals[e.fi];
          if (n) normals.push(n.x, n.y, n.z);
        }
        segFaceNormals.push(normals);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.computeBoundingSphere();
    // Attach per-segment face normals in local space. Consumed by
    // CycleModelerController._expandEdgesToRibbon for back-face culling.
    g.userData._segFaceNormals = segFaceNormals;
    return g;
  }
}
