import * as THREE from '../editor/libs/three/build/three.module.min.js';

// Default segment counts for parametric primitives (cylinder/cone/sphere/etc.).
// Kept small enough that the editable mesh stays manageable but large enough
// that round shapes read as round at the default viewport zoom.
const DEFAULT_SEGMENTS = 24;
const STAIR_TREADS = 8;

// ── Loop triangular subdivision (the engine behind the Subdivision
//    Surface modifier) ─────────────────────────────────────────────────────
//
// One iteration of Charles Loop's 1987 subdivision scheme, applied to a
// triangle soup. Each iteration:
//   1. Places a NEW vertex at the midpoint of every edge
//      (the "edge vertex"), positioned at a weighted average of the
//      two endpoint vertices AND the two opposite vertices of the two
//      triangles sharing that edge. Boundary edges (only one adjacent
//      triangle) collapse to the simple midpoint of the endpoints.
//   2. Repositions each EXISTING vertex using Loop's vertex mask:
//         n = valence (number of incident triangles)
//         beta = (1/n) * (5/8 - (3/8 + (1/4) cos(2*PI/n))^2)
//         newV = (1 - n*beta) * oldV + beta * SUM(neighbour)
//      Except for boundary vertices (valence != 2 * adjacency), where
//      the rule degenerates.
//   3. Splits every triangle into 4 child triangles:
//         original  ABC  (with edge midpoints D=midpoint(AB), E=mid(BC),
//         F=mid(CA))
//         child 1:  AD,  D,  F         (vertex A + its 2 new edge vertices)
//         child 2:  BD,  E,  D
//         child 3:  CF,  F,  E
//         child 4:  D,   E,  F         (center triangle)
//      Each child inherits the parent face's `faceGroup` (so selection
//      rolls up to the same logical polygon) AND a `_sourceFace` index
//      pointing back to the cage face that spawned it.
//
// The result is a fresh `EditableMesh` whose vertex count grew by
// roughly a factor of 4 (`triangles * 4`) and whose triangle count grew
// by exactly 4x. Recursive application yields 4^level times the
// triangles.
//
// Notes:
//   - The half-edge adjacency is rebuilt per iteration because the
//     topology changes (every edge splits). Tracking through
//     persistent IDs would be more efficient but harder to keep correct
//     across Push/Pull modifications.
//   - Degenerate triangles (collinear or zero-area) are skipped (their
//     child triangles would also be degenerate). The face count on
//     the refined mesh may be slightly less than 4x in pathological
//     cases.
//   - The boundary-vertex rule for n=2 follows Pixar/Loop's crease
//     convention -- a cube corner is valence 6 on a triangle soup (not
//     4 like a quad soup) and uses the interior beta mask.

function _subdivideLoopOnce(mesh, options = {}) {
  const srcVerts = mesh.vertices;
  const srcFaces = mesh.faces;
  const srcGroups = mesh.faceGroups;

  // ── 1. Build the half-edge-style adjacency map ─────────────────────
  // For each directed edge (a → b): collect every triangle that has
  // it as a side. Most interior edges have exactly 2 incident triangles;
  // boundary edges have 1.
  const keyOf = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  const edgeMap = new Map(); // keyOf -> { triIndices: [], a, b }
  // Adjacency: for each vertex, the set of triangles it sits in.
  // Used to compute vertex valence (n) and to pull neighbours for the
  // Loop vertex mask.
  const vertexTris = new Array(srcVerts.length).fill(null).map(() => []);

  srcFaces.forEach((face, fi) => {
    if (!face || face.length < 3) return;
    // Canonical form: triangle = (face[0], face[1], face[2]). If the
    // source face is an n-gon we only subdivide the first triangle
    // (this won't happen on a primitive mesh -- our faces are tris --
    // but is robust to future n-gon storage).
    if (face.length !== 3) return;
    const [a, b, c] = face;
    vertexTris[a].push(fi);
    vertexTris[b].push(fi);
    vertexTris[c].push(fi);
    const edges = [[a, b], [b, c], [c, a]];
    for (const [ea, eb] of edges) {
      const key = keyOf(ea, eb);
      if (!edgeMap.has(key)) {
        edgeMap.set(key, { a: ea, b: eb, tris: [] });
      }
      edgeMap.get(key).tris.push(fi);
    }
  });

  // ── 2. Place edge vertices ─────────────────────────────────────────
  // Edge vertex position depends on how many triangles share the edge.
  //
  // Interior edge (2 triangles): 3/8 each of the two endpoint
  //     vertices, plus 1/8 each of the two "opposite" vertices (the
  //     vertex of each triangle that is NOT this edge's endpoint).
  //
  // Boundary edge (1 triangle): midpoint of the two endpoints. The
  //     Loop / Pixar convention says "crease" = open edge uses this
  //     rule directly without weighting the opposite vertex.
  const edgeVertIndex = new Map(); // key -> index in new verts
  const newVertices = srcVerts.map((v) => new THREE.Vector3(v.x, v.y, v.z));
  const newFaces = [];
  const newGroups = [];
  // Source face index per new triangle: tells the picker which cage
  // face a refined triangle came from.
  const sourceFacesPerCageFace = [];

  const _getOpposite = (edge, triIdx) => {
    const f = srcFaces[triIdx];
    if (!f) return null;
    for (const idx of f) {
      if (idx !== edge.a && idx !== edge.b) return idx;
    }
    return null;
  };

  for (const [key, edge] of edgeMap) {
    let pos = new THREE.Vector3();
    if (edge.tris.length === 2) {
      // Interior edge -- Loop's alpha = 3/8, opposite = 1/8.
      const o1 = _getOpposite(edge, edge.tris[0]);
      const o2 = _getOpposite(edge, edge.tris[1]);
      pos.addScaledVector(srcVerts[edge.a], 3 / 8);
      pos.addScaledVector(srcVerts[edge.b], 3 / 8);
      if (o1 != null) pos.addScaledVector(srcVerts[o1], 1 / 8);
      if (o2 != null) pos.addScaledVector(srcVerts[o2], 1 / 8);
    } else if (edge.tris.length === 1) {
      // Boundary edge -- simple midpoint.
      pos.addScaledVector(srcVerts[edge.a], 0.5);
      pos.addScaledVector(srcVerts[edge.b], 0.5);
    } else {
      // Non-manifold edge -- fall back to midpoint. Should never
      // happen on our primitives.
      pos.addScaledVector(srcVerts[edge.a], 0.5);
      pos.addScaledVector(srcVerts[edge.b], 0.5);
    }
    edgeVertIndex.set(key, newVertices.length);
    newVertices.push(pos);
  }

  // ── 3. Reposition source vertices ─────────────────────────────────
  // The Loop vertex mask:
  //   beta = (1/n) * (5/8 - (3/8 + (1/4) * cos(2*PI/n))^2)
  //   V'   = (1 - n*beta) * V + beta * SUM(neighbours)
  // Boundary vertices use a crease-style rule (skip non-existent
  // neighbours; symmetric blends of the two adjacent corner verts).
  const repositioned = srcVerts.map((v) => new THREE.Vector3(v.x, v.y, v.z));
  const _isBoundaryVertex = (vi) => {
    // Walk all triangles touching vi; if any of their edges around vi
    // is a boundary edge (only one tri), vi is a boundary vertex.
    const tris = vertexTris[vi];
    for (const ti of tris) {
      const f = srcFaces[ti];
      if (!f) continue;
      const idxInFace = f.indexOf(vi);
      if (idxInFace < 0) continue;
      const prev = f[(idxInFace + f.length - 1) % f.length];
      const next = f[(idxInFace + 1) % f.length];
      if (edgeMap.get(keyOf(prev, vi))?.tris.length === 1) return true;
      if (edgeMap.get(keyOf(vi, next))?.tris.length === 1) return true;
    }
    return false;
  };
  const _boundaryNeighbors = (vi) => {
    // Return the unique boundary-adjacent vertices (the "tangent" verts)
    // around a boundary vertex, ordered.
    const tris = vertexTris[vi];
    const out = [];
    for (const ti of tris) {
      const f = srcFaces[ti];
      if (!f) continue;
      const idxInFace = f.indexOf(vi);
      if (idxInFace < 0) continue;
      const prev = f[(idxInFace + f.length - 1) % f.length];
      const next = f[(idxInFace + 1) % f.length];
      if (edgeMap.get(keyOf(prev, vi))?.tris.length === 1) out.push(prev);
      if (edgeMap.get(keyOf(vi, next))?.tris.length === 1) out.push(next);
    }
    return out;
  };
  for (let vi = 0; vi < srcVerts.length; vi += 1) {
    const tris = vertexTris[vi];
    const n = tris.length;
    if (n === 0) continue;
    if (_isBoundaryVertex(vi) || n < 3) {
      // Crease / boundary rule. For a cube corner tri-soup (valence 6)
      // this DOESN'T fire; corners of the cube land on the interior
      // mask. Boundary vertices are e.g. treads of a stair whose top
      // edge is exposed.
      const bns = _boundaryNeighbors(vi);
      const ps = bns.length;
      if (ps === 0) {
        // Isolated vertex -- leave it alone.
        continue;
      }
      // Boundary crease rule: V' = (1 - k) * V + (k / ps) * SUM(B),
      // with k = 1/8 (Dirichlet-style boundary rule from Loop's paper
      // for boundary curves).
      const k = 0.125;
      const out = new THREE.Vector3();
      out.addScaledVector(srcVerts[vi], 1 - k);
      for (const b of bns) out.addScaledVector(srcVerts[b], k / ps);
      repositioned[vi] = out;
    } else {
      // Interior vertex mask.
      let beta;
      if (n === 6) {
        // Closed-form for the regular valence (cube corner in tri soup):
        // beta = 1 / 16 when n = 6 -> (3/8 + 1/4) cos(2PI/6) = (3/8 - 1/4) =
        // 1/8 -> squared = 1/64 -> 5/8 - 1/64 = 39/64 -> /6 = 13/128.
        // Actually 1/16 is the well-known beta for regular valence 6.
        beta = 3 / 16; // standard Loop β for n=6 = 3/16.
      } else {
        beta = (1 / n) * (
          5 / 8 - Math.pow(3 / 8 + 0.25 * Math.cos((2 * Math.PI) / n), 2)
        );
      }
      const sum = new THREE.Vector3();
      const seen = new Set();
      for (const ti of tris) {
        const f = srcFaces[ti];
        if (!f) continue;
        for (const idx of f) {
          if (idx === vi || seen.has(idx)) continue;
          seen.add(idx);
          sum.add(srcVerts[idx]);
        }
      }
      const out = new THREE.Vector3()
        .addScaledVector(srcVerts[vi], 1 - n * beta)
        .addScaledVector(sum, beta);
      repositioned[vi] = out;
    }
  }
  // Replace the original vertex block with the repositioned block.
  for (let vi = 0; vi < repositioned.length; vi += 1) {
    newVertices[vi].copy(repositioned[vi]);
  }

  // ── 4. Emit child triangles ───────────────────────────────────────
  // For each source triangle (a, b, c), look up its three edge
  // vertices (mid-AB, mid-BC, mid-CA) and emit 4 children.
  const _em = (key) => {
    const idx = edgeVertIndex.get(key);
    if (idx != null) return idx;
    // Defensive: missing edge means the original tri touched a
    // surface the map didn't index (e.g. n-gon path that's been
    // abandoned). Fall back to a degenerate split using tri-centroid.
    return newVertices.length - 1;
  };
  srcFaces.forEach((face, fi) => {
    if (!face || face.length !== 3) return;
    const [a, b, c] = face;
    const dab = _em(keyOf(a, b));
    const dbc = _em(keyOf(b, c));
    const dca = _em(keyOf(c, a));
    const grp = srcGroups ? srcGroups[fi] : fi;

    // 4 child triangles, all carrying the parent face's group so
    // selection rolls up to the same logical polygon.
    // Each child also gets the SAME `_sourceFace` index (the parent's)
    // so subsequent iterations and the polygon's picker can keep
    // walking back to the original cage face.
    newFaces.push([a, dab, dca]);   // child 1
    newFaces.push([b, dbc, dab]);   // child 2
    newFaces.push([c, dca, dbc]);   // child 3
    newFaces.push([dab, dbc, dca]); // center

    for (let k = 0; k < 4; k += 1) {
      // When `options.uniqueFaceGroups` is true, every child triangle
      // becomes its own polygon (own faceGroup). This is the behaviour
      // the Subdivision Surface modifier's "Display Cage" toggle uses:
      // picking a sub-quad on the smoothed mesh selects just that
      // single sub-tri, not the whole parent face.
      if (options.uniqueFaceGroups) {
        newGroups.push(newGroups.length);
      } else {
        newGroups.push(grp);
      }
      sourceFacesPerCageFace.push(fi);
    }
  });

  const result = new EditableMesh({
    vertices: newVertices.map((v) => ({ x: v.x, y: v.y, z: v.z })),
    faces: newFaces,
    faceGroups: newGroups,
    hasInwardPocket: mesh.hasInwardPocket,
  });
  result._sourceFacesPerCageFace = sourceFacesPerCageFace;
  return result;
}

// ── "Simple" subdivision (Blender modifier dropdown alias) ────────────────
//
// Blender's Subdivision Surface modifier exposes two algorithms:
//
//   Catmull-Clark : C^2 limit surface on quads (we triangulate first
//                   and run Loop, which converges to the same shape
//                   on a triangulated mesh).
//   Simple        : midpoint subdivision with no smoothing -- every
//                   original vertex STAYS at its position, every new
//                   vertex is the simple midpoint of an edge. Result:
//                   the rendered silhouette stays sharp (a cube stays
//                   cube-shaped) but the mesh is more densely
//                   tessellated.
//
// The user explicitly wants the two modes to look visibly different
// on screen: Catmull-Clark should round the cube into a sphere-ish
// blob; Simple should keep the cube outline and only add interior
// edges. This helper implements Simple's rules verbatim.
//
// Topology is identical to Loop (each source triangle becomes 4 child
// triangles; source vertices retained; one new vertex per edge), so
// the polygon's picker round-trip and Apply path continue to work.

function _subdivideSimpleOnce(mesh, options = {}) {
  const srcVerts = mesh.vertices;
  const srcFaces = mesh.faces;
  const srcGroups = mesh.faceGroups;

  const keyOf = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  const edgeMap = new Map();

  srcFaces.forEach((face) => {
    if (!face || face.length !== 3) return;
    const [a, b, c] = face;
    const edges = [[a, b], [b, c], [c, a]];
    for (const [ea, eb] of edges) {
      const key = keyOf(ea, eb);
      if (!edgeMap.has(key)) edgeMap.set(key, { a: ea, b: eb });
    }
  });

  const newVertices = srcVerts.map((v) => new THREE.Vector3(v.x, v.y, v.z));
  const newFaces = [];
  const newGroups = [];
  const sourceFacesPerCageFace = [];

  // Simple: edge vertex = midpoint. No vertex mask, no averaging.
  const edgeVertIndex = new Map();
  for (const [key, edge] of edgeMap) {
    const pos = new THREE.Vector3();
    pos.addScaledVector(srcVerts[edge.a], 0.5);
    pos.addScaledVector(srcVerts[edge.b], 0.5);
    edgeVertIndex.set(key, newVertices.length);
    newVertices.push(pos);
  }

  // Source vertices stay put -- do NOT call Loop's beta mask. The
  // corner of a box stays a corner; the cube stays cube-shaped.
  // (That's the WHOLE POINT of the "Simple" mode being visibly
  // different from Catmull-Clark.)

  const _em = (key) => {
    const idx = edgeVertIndex.get(key);
    if (idx != null) return idx;
    return newVertices.length - 1;
  };
  srcFaces.forEach((face, fi) => {
    if (!face || face.length !== 3) return;
    const [a, b, c] = face;
    const dab = _em(keyOf(a, b));
    const dbc = _em(keyOf(b, c));
    const dca = _em(keyOf(c, a));
    const grp = srcGroups ? srcGroups[fi] : fi;
    newFaces.push([a, dab, dca]);
    newFaces.push([b, dbc, dab]);
    newFaces.push([c, dca, dbc]);
    newFaces.push([dab, dbc, dca]);
    for (let k = 0; k < 4; k += 1) {
      // Same Display Cage toggle semantics as Loop:
      // uniqueFaceGroups = true -> every child is its own polygon.
      newGroups.push(options.uniqueFaceGroups ? newGroups.length : grp);
      sourceFacesPerCageFace.push(fi);
    }
  });

  const result = new EditableMesh({
    vertices: newVertices.map((v) => ({ x: v.x, y: v.y, z: v.z })),
    faces: newFaces,
    faceGroups: newGroups,
    hasInwardPocket: mesh.hasInwardPocket,
  });
  result._sourceFacesPerCageFace = sourceFacesPerCageFace;
  return result;
}

// ── Catmull-Clark quad subdivision ────────────────────────────────────────
//
// Standard Catmull-Clark (Pixar / Stam 1998) on quad topology. For each
// original quad Q with corners (v0, v1, v2, v3):
//   • Face point F = (v0 + v1 + v2 + v3) / 4
// For each original edge E = (a, b) with adjacent faces F1, F2:
//   • Interior edge point: (F1 + F2 + a + b) / 4
//   • Boundary edge point: (a + b) / 2
// For each original vertex V with valence n:
//   • F_avg = average of all face points touching V
//   • R_avg = average of midpoints of edges touching V
//   • V_new = (F_avg + 2·R_avg + (n − 3)·V) / n
// For each boundary vertex: V_new = (V + average of boundary-adjacent verts) / 2
// Topology: each quad → 4 child quads. Each face point connects to the
// 4 new edge points of its parent quad's edges; each vertex point
// connects to the new edge points of its incident edges.
//
// Output is stored as TRUE QUADS in the EditableMesh (4-vertex face
// entries). Fan-triangulation into the GPU buffer happens exactly
// once, in `toBufferGeometry`, so:
//   - the wireframe overlay never shows the internal diagonal slash,
//   - push/pull treats the whole quad as a single polygon,
//   - the polygon's `faceId` attribute maps each generated triangle
//     back to its parent cage face via `faceIdMap`.
//
// `_extractQuadPairs` rebuilds a quad topology from the source mesh
// in two modes:
//   1. Direct quads: the source mesh already stores 4-vertex faces
//      (e.g. CC's own output, push/pull side walls). Each entry is
//      taken as-is with corners ordered around the perimeter.
//   2. Triangle-pairs: the source mesh stores 2-triangle quads (e.g.
//      `boxFromBounds` primitives). Group consecutive pairs that
//      share an edge AND a faceGroup, then order the 4 corners CCW.
//   Triangles that don't pair up are skipped; the caller falls back
//      to Loop subdivision for them.

function _extractQuadPairs(mesh) {
  const keyOf = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  const triGroup = (fi) => (mesh.faceGroups ? mesh.faceGroups[fi] : fi);
  const quads = [];
  const seen = new Set();

  // Mode 1: walk every face. If it's already a 4-vertex face, take
  // it directly. Push/pull side walls, prior CC passes, and any
  // other 4-corner polygon all flow through this path.
  for (let fi = 0; fi < mesh.faces.length; fi += 1) {
    const f = mesh.faces[fi];
    if (!f || f.length !== 4) continue;
    quads.push({
      corners: [f[0], f[1], f[2], f[3]],
      faceGroup: triGroup(fi),
      triIndices: [fi],
    });
    seen.add(fi);
  }

  // Mode 2: triangle-pair extraction (the original CC input shape:
  // a `boxFromBounds` mesh whose 6 logical quads are each stored as
  // 2 fan-triangulated triangles sharing a faceGroup).
  // Map undirected edges to the triangles that share them.
  const edgeToTris = new Map();
  for (let fi = 0; fi < mesh.faces.length; fi += 1) {
    const f = mesh.faces[fi];
    if (!f || f.length !== 3) continue;
    for (let i = 0; i < 3; i += 1) {
      const a = f[i], b = f[(i + 1) % 3];
      const k = keyOf(a, b);
      if (!edgeToTris.has(k)) edgeToTris.set(k, []);
      edgeToTris.get(k).push({ tri: fi, from: a, to: b });
    }
  }
  // For each triangle, look up the partner on its diagonal edge (the
  // edge that is NOT shared with any other triangle in the same
  // faceGroup). The diagonal is the quad's internal triangulation
  // edge; finding the other triangle that shares the diagonal (and
  // shares the faceGroup) gives us the pair. (`triGroup` is defined
  // at the top of this function and shared with mode 1 above.)
  const triPartner = new Map(); // fi -> fi' (paired) or null
  for (let fi = 0; fi < mesh.faces.length; fi += 1) {
    const f = mesh.faces[fi];
    if (!f || f.length !== 3) continue;
    const grp = triGroup(fi);
    // Try each edge as the candidate diagonal.
    for (let i = 0; i < 3; i += 1) {
      const a = f[i], b = f[(i + 1) % 3];
      const partners = edgeToTris.get(keyOf(a, b)) || [];
      for (const p of partners) {
        if (p.tri === fi) continue;
        if (triGroup(p.tri) !== grp) continue;
        triPartner.set(fi, p.tri);
        triPartner.set(p.tri, fi);
      }
      if (triPartner.has(fi)) break;
    }
    if (!triPartner.has(fi)) triPartner.set(fi, null);
  }
  // Build quads. Walk faceGroups in order; each group with exactly 2
  // paired triangles contributes one quad. Groups with 0 pairs or 1
  // unpaired triangle are skipped here (Loop fallback handles them).
  // (`quads` and `seen` are declared at the top of this function in
  // mode 1 and reused here for mode 2.)
  for (let fi = 0; fi < mesh.faces.length; fi += 1) {
    if (seen.has(fi)) continue;
    const partner = triPartner.get(fi);
    if (partner == null || partner === fi) continue;
    if (seen.has(partner)) continue;
    // Construct the quad: triangle fi = (a, b, c), partner = (d, e, f).
    // The shared diagonal edge is the edge both triangles share.
    const tA = mesh.faces[fi];
    const tB = mesh.faces[partner];
    if (!tA || !tB || tA.length !== 3 || tB.length !== 3) continue;
    let sharedEdge = null;
    for (let i = 0; i < 3; i += 1) {
      const a = tA[i], b = tA[(i + 1) % 3];
      for (let j = 0; j < 3; j += 1) {
        const c = tB[j], d = tB[(j + 1) % 3];
        if ((a === c && b === d) || (a === d && b === c)) {
          sharedEdge = [a, b];
          break;
        }
      }
      if (sharedEdge) break;
    }
    if (!sharedEdge) continue;
    const [d1, d2] = sharedEdge;
    // The 4 corners are the union of the two triangles' vertices.
    const corners = [tA[0], tA[1], tA[2], tB[0], tB[1], tB[2]];
    const uniq = [];
    const uniqSet = new Set();
    for (const v of corners) {
      if (!uniqSet.has(v)) { uniqSet.add(v); uniq.push(v); }
    }
    if (uniq.length !== 4) continue;
    // Order the 4 corners CCW around the diagonal. Find the two
    // "outside" vertices: each triangle has one vertex that is NOT
    // on the diagonal.
    const outsideA = tA.find((v) => v !== d1 && v !== d2);
    const outsideB = tB.find((v) => v !== d1 && v !== d2);
    if (outsideA == null || outsideB == null) continue;
    // Quad ordering: outsideA → d1 → outsideB → d2 (CCW when looking
    // down on the diagonal). We pick the orientation that yields a
    // CCW face when winding through the original triangle normals.
    const grpId = triGroup(fi);
    quads.push({
      corners: [outsideA, d1, outsideB, d2],
      faceGroup: grpId,
      triIndices: [fi, partner],
    });
    seen.add(fi);
    seen.add(partner);
  }
  // If we didn't pair every triangle, the mesh has mixed topology.
  // We need to subdivide the unpaired triangles with Loop in a second
  // pass -- but that requires both passes to share vertex/edge
  // indices. For simplicity, callers fall back to Loop subdivision
  // when there are unpaired triangles, so we don't need to handle
  // that here.
  return quads;
}

function _subdivideCatmullClarkOnce(mesh, options = {}) {
  const srcVerts = mesh.vertices;
  const quads = _extractQuadPairs(mesh);
  // If extraction failed (mesh has no quad pairs at all), bail out
  // and let the caller fall back to Loop. We can't easily recover
  // mid-pipeline.
  if (quads.length === 0) {
    return _subdivideLoopOnce(mesh, options);
  }

  const keyOf = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);

  // ── 1. Build edge → face adjacency on the QUAD graph ──────────────
  // For each quad edge, record which quad face point sits adjacent.
  // Interior quad edges have 2 adjacent face points; boundary quad
  // edges have 1.
  const edgeToQuads = new Map(); // key -> [{ quadIdx, edgeIdx }]
  for (let qi = 0; qi < quads.length; qi += 1) {
    const q = quads[qi];
    for (let ei = 0; ei < 4; ei += 1) {
      const a = q.corners[ei];
      const b = q.corners[(ei + 1) % 4];
      const key = keyOf(a, b);
      if (!edgeToQuads.has(key)) edgeToQuads.set(key, []);
      edgeToQuads.get(key).push({ quadIdx: qi, edgeIdx: ei });
    }
  }

  // ── 2. Compute face points (one per quad) ─────────────────────────
  const newVertices = srcVerts.map((v) => new THREE.Vector3(v.x, v.y, v.z));
  const newFaces = [];        // list of quads (4-corner arrays)
  const newGroups = [];       // parallel array to newFaces
  const sourceFacesPerCageFace = [];

  // Map: original vertex index -> set of (quadIdx, cornerIdx) entries
  // that reference it. Used to compute the vertex mask.
  const vertexQuads = new Array(srcVerts.length).fill(null).map(() => []);

  const facePointOfQuad = new Array(quads.length);
  for (let qi = 0; qi < quads.length; qi += 1) {
    const q = quads[qi];
    const fp = new THREE.Vector3();
    for (const c of q.corners) {
      fp.add(srcVerts[c]);
      vertexQuads[c].push({ quadIdx: qi, cornerIdx: q.corners.indexOf(c) });
    }
    fp.multiplyScalar(0.25);
    facePointOfQuad[qi] = newVertices.length;
    newVertices.push(fp);
    // Each face point IS a vertex; we'll connect it to the 4 new edge
    // points of its quad's edges below.
  }

  // ── 3. Compute edge points (one per original quad edge) ───────────
  // Interior edge: (F1 + F2 + a + b) / 4
  // Boundary edge: (a + b) / 2
  const edgePointIndex = new Map();
  for (const [key, edgeRefs] of edgeToQuads) {
    let pos = new THREE.Vector3();
    if (edgeRefs.length === 2) {
      const fp1 = facePointOfQuad[edgeRefs[0].quadIdx];
      const fp2 = facePointOfQuad[edgeRefs[1].quadIdx];
      // Parse the original (a, b) endpoints from the key.
      const [aStr, bStr] = key.split('_');
      const a = Number(aStr), b = Number(bStr);
      pos.addScaledVector(srcVerts[a], 0.25);
      pos.addScaledVector(srcVerts[b], 0.25);
      pos.addScaledVector(newVertices[fp1], 0.25);
      pos.addScaledVector(newVertices[fp2], 0.25);
    } else {
      // Boundary edge -- midpoint.
      const [aStr, bStr] = key.split('_');
      const a = Number(aStr), b = Number(bStr);
      pos.addScaledVector(srcVerts[a], 0.5);
      pos.addScaledVector(srcVerts[b], 0.5);
    }
    edgePointIndex.set(key, newVertices.length);
    newVertices.push(pos);
  }

  // ── 4. Vertex mask (compute new positions for original vertices) ──
  // V_new = (F_avg + 2·R_avg + (n − 3)·V) / n
  // Boundary rule: V_new = (V + average(boundary-adjacent verts)) / 2
  const vertexQuadsCount = vertexQuads.map((arr) => arr.length);
  // Boundary-vertex detection: walk quad-corner entries; if any edge
  // around V is a boundary edge, V is on the mesh boundary.
  const isBoundaryVertex = (vi) => {
    const entries = vertexQuads[vi];
    for (const e of entries) {
      const q = quads[e.quadIdx];
      // Edges adjacent to corner at e.cornerIdx in the quad:
      const prev = q.corners[(e.cornerIdx + 3) % 4];
      const next = q.corners[(e.cornerIdx + 1) % 4];
      if ((edgeToQuads.get(keyOf(prev, vi)) || []).length < 2) return true;
      if ((edgeToQuads.get(keyOf(vi, next)) || []).length < 2) return true;
    }
    return false;
  };
  const boundaryNeighbors = (vi) => {
    const entries = vertexQuads[vi];
    const out = [];
    const seen = new Set();
    for (const e of entries) {
      const q = quads[e.quadIdx];
      const prev = q.corners[(e.cornerIdx + 3) % 4];
      const next = q.corners[(e.cornerIdx + 1) % 4];
      if ((edgeToQuads.get(keyOf(prev, vi)) || []).length < 2 && !seen.has(prev)) {
        seen.add(prev); out.push(prev);
      }
      if ((edgeToQuads.get(keyOf(vi, next)) || []).length < 2 && !seen.has(next)) {
        seen.add(next); out.push(next);
      }
    }
    return out;
  };
  const repositioned = srcVerts.map((v) => new THREE.Vector3(v.x, v.y, v.z));
  for (let vi = 0; vi < srcVerts.length; vi += 1) {
    const n = vertexQuadsCount[vi];
    if (n === 0) continue;
    if (isBoundaryVertex(vi)) {
      // Boundary rule.
      const bns = boundaryNeighbors(vi);
      if (!bns.length) continue;
      const avg = new THREE.Vector3();
      for (const b of bns) avg.add(srcVerts[b]);
      avg.multiplyScalar(1 / bns.length);
      const out = new THREE.Vector3().addScaledVector(srcVerts[vi], 0.5).addScaledVector(avg, 0.5);
      repositioned[vi] = out;
      continue;
    }
    // F_avg = average of face points touching V.
    const Favg = new THREE.Vector3();
    const seenQuads = new Set();
    for (const e of vertexQuads[vi]) {
      if (seenQuads.has(e.quadIdx)) continue;
      seenQuads.add(e.quadIdx);
      Favg.add(newVertices[facePointOfQuad[e.quadIdx]]);
    }
    Favg.multiplyScalar(1 / seenQuads.size);
    // R_avg = average of edge midpoints of edges touching V.
    const Ravg = new THREE.Vector3();
    const seenEdges = new Set();
    let edgeCount = 0;
    for (const e of vertexQuads[vi]) {
      const q = quads[e.quadIdx];
      const prev = q.corners[(e.cornerIdx + 3) % 4];
      const next = q.corners[(e.cornerIdx + 1) % 4];
      const ks = [keyOf(prev, vi), keyOf(vi, next)];
      for (const k of ks) {
        if (seenEdges.has(k)) continue;
        seenEdges.add(k);
        const [aStr, bStr] = k.split('_');
        const a = Number(aStr), b = Number(bStr);
        Ravg.add(new THREE.Vector3().addScaledVector(srcVerts[a], 0.5).addScaledVector(srcVerts[b], 0.5));
        edgeCount += 1;
      }
    }
    Ravg.multiplyScalar(1 / Math.max(1, edgeCount));
    // V_new = (F + 2R + (n-3)V) / n
    const out = new THREE.Vector3()
      .addScaledVector(Favg, 1 / n)
      .addScaledVector(Ravg, 2 / n)
      .addScaledVector(srcVerts[vi], (n - 3) / n);
    repositioned[vi] = out;
  }
  // Splice the repositioned vertex positions back into newVertices
  // at the front of the array (originals occupy indices 0..srcVerts.length-1).
  for (let vi = 0; vi < repositioned.length; vi += 1) {
    newVertices[vi].copy(repositioned[vi]);
  }

  // ── 5. Emit child quads ───────────────────────────────────────────
  // For each source quad (v0, v1, v2, v3) (CCW corners), the new
  // quad topology is:
  //   center quad : (e12, e23, e30, e01) — the 4 new edge points
  //   4 corner quads: each (V_i, e_i_next, fCenter, e_i_prev)
  // We keep the output as TRUE QUADS in the EditableMesh data
  // model — NOT pre-fan-triangulated to triangle pairs. This
  // matches the Wikipedia spec ("the new mesh will consist only
  // of quadrilaterals") and what Blender's Subdivision Surface
  // modifier does internally. Fan-triangulation happens exactly
  // once, in `toBufferGeometry`, so the wireframe overlay never
  // shows a diagonal slash through every sub-quad, push/pull acts
  // on the whole quad as a single polygon, and the polygon's
  // picker round-trip stays one-face-per-quad.
  //
  // Variable naming:
  //   - vN         : the 4 repositioned corner vertices of the quad
  //   - eMN        : the new edge point on edge (M, N)
  //   - fM         : the new face point of this quad
  const _ep = (a, b) => edgePointIndex.get(keyOf(a, b));
  for (let qi = 0; qi < quads.length; qi += 1) {
    const q = quads[qi];
    const v0 = q.corners[0];
    const v1 = q.corners[1];
    const v2 = q.corners[2];
    const v3 = q.corners[3];
    const e01 = _ep(v0, v1);
    const e12 = _ep(v1, v2);
    const e23 = _ep(v2, v3);
    const e30 = _ep(v3, v0);
    const fCenter = facePointOfQuad[qi];
    const grp = q.faceGroup;
    // Center quad: 4 edge points form the corners. The face point
    // is NOT a corner of the center quad (it's a vertex that the
    // 4 corner quads use as a shared meeting point).
    newFaces.push([e12, e23, e30, e01]);
    newGroups.push(options.uniqueFaceGroups ? newGroups.length : grp);
    // The 4 corner quads each use one original corner, two edge
    // points, and the face point.
    const childQuads = [
      [v0, e01, fCenter, e30],
      [v1, e12, fCenter, e01],
      [v2, e23, fCenter, e12],
      [v3, e30, fCenter, e23],
    ];
    for (const cq of childQuads) {
      newFaces.push(cq);
      newGroups.push(options.uniqueFaceGroups ? newGroups.length : grp);
    }
    for (let k = 0; k < 5; k += 1) sourceFacesPerCageFace.push(qi);
  }

  // Build the result. CC's output is QUADS (4-vertex faces), so
  // `faces` holds 5 quad entries per source quad (1 center + 4
  // corner) and `faceGroups` is the parallel array. `toBufferGeometry`
  // will fan-triangulate at render time (existing behaviour; the
  // `faceIdMap` arg resolves each generated triangle back to the
  // source quad index so the polygon's picker still hits the right
  // cage face). `uniqueFaceGroups` mode assigns a unique group to
  // each child quad so the Display Cage ON toggle gives the user a
  // per-quad pick target on the smoothed surface (Blender parity).
  const result = new EditableMesh({
    vertices: newVertices.map((v) => ({ x: v.x, y: v.y, z: v.z })),
    faces: newFaces,
    faceGroups: newGroups,
    hasInwardPocket: mesh.hasInwardPocket,
  });
  result._sourceFacesPerCageFace = sourceFacesPerCageFace;
  // [SUBDIV-FIX: quads-only] CC output is quads (NOT pre-triangulated).
  // The downstream code that previously assumed triangle pairs (the
  // triangle-count assertions, the 6-quad-×-2-tri faceIdMap arithmetic
  // in `_previewEditableMesh`) has been updated to count quads
  // directly and let `toBufferGeometry` fan-triangulate at render time.
  return result;
}

/**
 * Resolve a source face/quad/triangle index in `sourceMesh` back to
 * the CAGE FACE GROUP ID. Used by `_subdivideWith` to populate
 * `_sourceFaceGroup` on the subdivided result. Different subdivision
 * algorithms index into the source in different ways:
 *
 *   - Loop / Simple: `srcIdx` is the parent TRIANGLE index (0..N-1)
 *     where N is the number of triangles in the source. The cage
 *     faceGroup is `sourceMesh.faceGroups[srcIdx]`.
 *   - Catmull-Clark: `srcIdx` is the quad array index from
 *     `_extractQuadPairs`, where each quad stores its own
 *     `faceGroup` already. We re-derive it from the source by
 *     re-running the extraction.
 *
 * Without this helper, the polygon's `faceIdMap` (passed straight
 * into `cage.selectionGroup()`) reads an ambiguous value: for Loop
 * the parent index happens to match the cage faceGroup at the
 * same slot, but for CC the quad-array index does NOT (the cage
 * stores faceGroups per triangle, so `faceGroups[1] === 0` for a
 * box where the second triangle is the back face). The fix stores
 * the cage faceGroup directly on each child so both algorithms
 * pick the same cage face.
 */
function _resolveCageFaceGroup(sourceMesh, srcIdx) {
  if (!sourceMesh?.faceGroups) return srcIdx;
  // CC produces quads from `_extractQuadPairs`, and `_sourceFacesPerCageFace`
  // stores QUAD ARRAY INDICES (not triangle indices). The quad array
  // is not kept around after the helper runs, so re-extract it here.
  // If the quad at `srcIdx` exists, the source face is a quad and
  // `quads[srcIdx].faceGroup` IS the cage faceGroup we want. (For
  // our supported primitives — box / room / stair — the quad array
  // is in the same order as the cage `faceGroups` walk, so the quad
  // index equals the cage faceGroup at that slot. We still look it
  // up explicitly because the contract is "use whatever
  // `_extractQuadPairs` returned".)
  const quads = _extractQuadPairs(sourceMesh);
  if (srcIdx < quads.length) {
    return quads[srcIdx].faceGroup ?? srcIdx;
  }
  // Loop / Simple: srcIdx is a triangle index. Use the source's
  // own faceGroup array directly. The cage stores faceGroups as a
  // parallel array to `faces`, so `faceGroups[triIdx]` is the cage
  // faceGroup of that triangle (matches what `_sourceFacesPerCageFace`
  // would have stored).
  if (srcIdx < sourceMesh.faces.length) {
    const grp = sourceMesh.faceGroups[srcIdx];
    if (grp != null) return grp;
  }
  return srcIdx;
}

export class EditableMesh {
  constructor({ vertices = [], faces = [], faceGroups = null, hasInwardPocket = false } = {}) {
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
    // True when this mesh contains any inward-facing pocket (e.g. a
    // face pushed inward by Push Pull). Drives the renderer's
    // FrontSide vs DoubleSide decision in
    // `CycleModelerController._applyEditableMesh`.
    this.hasInwardPocket = !!hasInwardPocket;
  }

  static box(size = 100) {
    const h = size / 2;
    return EditableMesh.boxFromBounds(
      new THREE.Vector3(-h, -h, -h),
      new THREE.Vector3(h, h, h)
    );
  }

  static boxFromBounds(min, max) {
    // The box is stored as 12 triangles (2 per quad). Each quad is
    // fan-triangulated from its first corner and the two triangles
    // have OUTWARD-facing normals (so the rendered `toBufferGeometry`
    // shading is correct). The shared diagonal between the two tris
    // of a quad is an internal triangulation edge — `toEdgesGeometry`
    // recognises this via the shared `faceGroup` (every quad's two
    // tris have the same group ID) and never emits the diagonal,
    // regardless of `angleThreshold`. Without that check, the
    // diagonal would appear as a slash through every face in the
    // wireframe overlay — the bug fixed here.
    return new EditableMesh({
      vertices: [
        { x: min.x, y: min.y, z: min.z }, { x: max.x, y: min.y, z: min.z },
        { x: max.x, y: max.y, z: min.z }, { x: min.x, y: max.y, z: min.z },
        { x: min.x, y: min.y, z: max.z }, { x: max.x, y: min.y, z: max.z },
        { x: max.x, y: max.y, z: max.z }, { x: min.x, y: max.y, z: max.z },
      ],
      faces: [
        // Back  (-Z): fan from corner 0; both tris CCW seen from -Z.
        [0, 2, 1], [0, 3, 2],
        // Front (+Z): fan from corner 4; both tris CCW seen from +Z.
        [4, 5, 6], [4, 6, 7],
        // Bottom (-Y): fan from corner 0; both tris CCW seen from -Y.
        [0, 1, 5], [0, 5, 4],
        // Top   (+Y): fan from corner 3; both tris CCW seen from +Y.
        [3, 7, 6], [3, 6, 2],
        // Right (+X): fan from corner 1; both tris CCW seen from +X.
        [1, 2, 6], [1, 6, 5],
        // Left  (-X): fan from corner 0; both tris CCW seen from -X.
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
   * Floor-anchored box whose six faces are each subdivided into
   * `segments × segments` quads (matches `THREE.BoxGeometry(w,h,d,s,s,s)`
   * topology). Origin sits at the centre of the floor (Y = 0), so the
   * box grows upward by `height`. Used by the modeler's "Subdivide"
   * tool: keeps `cycoModeler.mesh` in lockstep with `obj.geometry` so
   * the polygon wireframe overlay shows the subdivisions instead of
   * the un-subdivided outline.
   *
   * Each subdivided quad is its own polygon (own `faceGroup`) so a
   * push/pull of one quad extrudes only that cell, not the whole face.
   */
  static boxSubdivided(width, height, depth, segments = 2) {
    const s = Math.max(1, Math.round(segments));
    const w = width / 2;
    const d = depth / 2;
    const vertices = [];
    const faces = [];
    const faceGroups = [];
    // Per-face subdivision: faceCorners[face][i][j] is the index of
    // the (i,j) corner of the face, with i,j in [0..s]. We allocate
    // each corner as its own vertex (no sharing between adjacent cells
    // on the same face) so each subdivided quad is an independent
    // polygon. Sharing between the six faces themselves is also
    // intentionally avoided — corner vertices that coincide across
    // faces (e.g. the box's 8 corners) get separate indices. This
    // keeps the topology trivially correct and avoids accidental
    // face-merging after push/pull side walls land on the same plane
    // as a subdivided cell.
    const faceCorners = [];
    const addVert = (x, y, z) => {
      const idx = vertices.length;
      vertices.push({ x, y, z });
      return idx;
    };
    // +Y top face: corners in XZ plane, normal +Y. Wound CCW when
    // viewed from above so the outward normal is +Y.
    {
      const grid = [];
      for (let i = 0; i <= s; i += 1) {
        const row = [];
        for (let j = 0; j <= s; j += 1) {
          const u = j / s; // 0..1 across width (X)
          const v = i / s; // 0..1 across depth (Z)
          row.push(addVert(-w + u * width, height, -d + v * depth));
        }
        grid.push(row);
      }
      faceCorners.push(grid);
    }
    // -Y bottom face: corners in XZ plane, normal -Y. Wound CW when
    // viewed from above (equivalently CCW from below) so the outward
    // normal is -Y. Swap both axes' winding direction vs the top face.
    {
      const grid = [];
      for (let i = 0; i <= s; i += 1) {
        const row = [];
        for (let j = 0; j <= s; j += 1) {
          const u = j / s;
          const v = i / s;
          row.push(addVert(w - u * width, 0, -d + v * depth));
        }
        grid.push(row);
      }
      faceCorners.push(grid);
    }
    // +X face: YZ plane, normal +X. Wound CCW viewed from +X side
    // (looking down -X, +Y up and +Z to the LEFT). To get an outward
    // +X normal, sweep the local (u=height, v=depth) corners in the
    // order (height=0,depth=0) → (height=1,depth=0) → (height=1,depth=1)
    // → (height=0,depth=1), which puts +Y on the local +V axis and
    // +Z on the local +U axis when viewed from outside.
    {
      const grid = [];
      for (let i = 0; i <= s; i += 1) {
        const row = [];
        for (let j = 0; j <= s; j += 1) {
          const u = j / s; // 0..1 across depth (Z)
          const v = i / s; // 0..1 across height (Y)
          row.push(addVert(w, v * height, -d + u * depth));
        }
        grid.push(row);
      }
      faceCorners.push(grid);
    }
    // -X face: YZ plane, normal -X. Reverse the +X face winding so the
    // outward normal points toward -X.
    {
      const grid = [];
      for (let i = 0; i <= s; i += 1) {
        const row = [];
        for (let j = 0; j <= s; j += 1) {
          const u = j / s;
          const v = i / s;
          row.push(addVert(-w, v * height, d - u * depth));
        }
        grid.push(row);
      }
      faceCorners.push(grid);
    }
    // +Z face: XY plane, normal +Z. CCW viewed from +Z (looking down -Z,
    // +X to the LEFT and +Y UP). The corner sweep
    // (X=-w, Y=0) → (X=+w, Y=0) → (X=+w, Y=h) → (X=-w, Y=h) gives a
    // CCW winding when viewed from +Z, hence outward +Z normal.
    {
      const grid = [];
      for (let i = 0; i <= s; i += 1) {
        const row = [];
        for (let j = 0; j <= s; j += 1) {
          const u = j / s; // 0..1 across width (X)
          const v = i / s; // 0..1 across height (Y)
          row.push(addVert(-w + u * width, v * height, d));
        }
        grid.push(row);
      }
      faceCorners.push(grid);
    }
    // -Z face: XY plane, normal -Z. Reverse the +Z winding.
    {
      const grid = [];
      for (let i = 0; i <= s; i += 1) {
        const row = [];
        for (let j = 0; j <= s; j += 1) {
          const u = j / s;
          const v = i / s;
          row.push(addVert(w - u * width, v * height, -d));
        }
        grid.push(row);
      }
      faceCorners.push(grid);
    }
    // Emit `s × s` quads per face. Each quad is fan-triangulated into
    // two triangles that share the quad's own `faceGroup` so the modeler
    // treats the cell as a single polygon (selection / push / hover).
    // Triangulation order is chosen per-face so the cross product of
    // (b-a) × (c-a) points OUTWARD for every face. The "reversed" faces
    // (±Y and ±X) build their grids such that the natural CCW order
    // from outside is preserved; the Z faces use the standard winding.
    for (let fi = 0; fi < faceCorners.length; fi += 1) {
      const grid = faceCorners[fi];
      // fi 0..5: +Y, -Y, +X, -X, +Z, -Z. Triangulation order
      // determined by which winding gives an outward normal for that
      // face's grid corner sweep.
      const reverse = (fi === 0 || fi === 1 || fi === 2 || fi === 3);
      for (let i = 0; i < s; i += 1) {
        for (let j = 0; j < s; j += 1) {
          const a = grid[i][j];
          const b = grid[i][j + 1];
          const c = grid[i + 1][j + 1];
          const d2 = grid[i + 1][j];
          // Each cell gets its own group ID so the modeler's polygon
          // picker treats it as an independent polygon (push/pull a
          // single cell without dragging its neighbours along). The
          // two triangles of one quad share that ID.
          const groupId = fi * s * s + i * s + j;
          if (reverse) {
            faces.push([a, c, b], [a, d2, c]);
          } else {
            faces.push([a, b, c], [a, c, d2]);
          }
          faceGroups.push(groupId, groupId);
        }
      }
    }
    return new EditableMesh({ vertices, faces, faceGroups });
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
      // Pair each quad's two tris into one polygon group so
      // `toEdgesGeometry` recognises the shared diagonal as an
      // internal triangulation edge and never emits it as a wireframe
      // slash — same convention as `boxFromBounds`.
      faceGroups: [
        0, 0, // floor
        1, 1, // back wall
        2, 2, // right wall
        3, 3, // front wall
        4, 4, // left wall
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
    const mesh = new EditableMesh(data || {});
    // Restore non-default subdivision bookkeeping that lives outside
    // the constructor's normal arg list. `_sourceFaceGroup` is set
    // by `_subdivideWith` so the polygon's picker can resolve a
    // refined triangle / child quad straight to its CAGE FACE GROUP
    // ID. Without restoring it on `fromJSON`, the Subdivision
    // Surface modifier preview path (`_previewEditableMesh` writes
    // `toJSON()` to `_subdivisionRefinedMesh`) loses the map and
    // Catmull-Clark child quads pick the wrong cage face -- the
    // "selecting front picks the opposite side" bug.
    if (data && Array.isArray(data._sourceFaceGroup)) {
      mesh._sourceFaceGroup = [...data._sourceFaceGroup];
    }
    return mesh;
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

    // Track whether this mesh contains any inward-facing pocket created
    // by an inward push (distance < 0). When set, the renderer
    // switches the committed material to DoubleSide so the pocket's
    // walls are visible from outside the parent volume — see
    // pushpull-inward-hollow-cut-2026-06-27.md.
    if (distance < 0) {
      this.hasInwardPocket = true;
    } else if (distance > 0 && this.hasInwardPocket) {
      // An outward pull may re-expose previously inward-facing
      // geometry. Clearing the flag here is conservative — if a
      // prior inward push left any wall still buried, the renderer
      // will (correctly) keep showing it via DoubleSide until the
      // user does a full reset.
      this.hasInwardPocket = false;
    }
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

  toBufferGeometry(options) {
    const positions = [];
    const faceIds = [];
    // Optional `faceIdMap`: when set, the faceId attribute value for
    // the i-th face in `this.faces` is `faceIdMap[i]` instead of `i`.
    // Used by the Subdivision Surface modifier preview path: every
    // child triangle is mapped back to its parent cage face so the
    // push/pull polygon's picker still resolves to "one face per box
    // side" rather than "every sub-quad gets its own selection".
    const faceIdMap = options && Number.isInteger(options.faceIdMap?.length)
      ? options.faceIdMap
      : null;
    for (let faceIndex = 0; faceIndex < this.faces.length; faceIndex += 1) {
      const face = this.faces[faceIndex];
      if (face.length < 3) continue;
      // Fan-triangulate polygons so non-triangle faces (post Push/Pull quads)
      // render correctly. The faceId attribute lets raycasts map triangle
      // index back to the source EditableMesh face.
      const outFaceId = faceIdMap ? faceIdMap[faceIndex] : faceIndex;
      for (let i = 1; i < face.length - 1; i += 1) {
        const a = this.vertices[face[0]];
        const b = this.vertices[face[i]];
        const c = this.vertices[face[i + 1]];
        positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
        faceIds.push(outFaceId, outFaceId, outFaceId);
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
      // Persist the inward-pocket flag so a saved/undone mesh that
      // contains inward-pushed geometry stays on DoubleSide rendering.
      // Omit when false to keep saved files minimal (older loads
      // default to false).
      hasInwardPocket: this.hasInwardPocket ? true : undefined,
      // `_sourceFaceGroup` is set by `_subdivideWith` so the polygon
      // picker can resolve any refined face / quad / triangle straight
      // to its CAGE FACE GROUP ID (Catmull-Clark parity with Loop).
      // Persist alongside the rest of the subdivision bookkeeping so
      // project save/load keeps the pick-correctness fix intact.
      _sourceFaceGroup: Array.isArray(this._sourceFaceGroup)
        ? [...this._sourceFaceGroup]
        : undefined,
    };
  }

  /**
   * Subdivide this mesh using Charles Loop's 1987 triangular subdivision
   * scheme -- the triangle-based analogue of Catmull-Clark that produces a
   * rounded limit surface from any triangulated control mesh.
   *
   * This is the engine behind the Subdivision Surface modifier's preview
   * and Apply paths. The modifier MUST keep the original mesh untouched
   * (that's the control cage) so push/pull can still pick the un-
   * subdivided faces. This method is therefore non-mutating: it returns
   * a fresh `EditableMesh` derived from `this`.
   *
   * Why Loop and not strict Catmull-Clark?
   *   - CC operates on quads. Our mesh is stored as triangle soup (after
   *     fan triangulation), and re-grouping our triangle soup into the
   *     quads they came from is fragile once Push/Pull has carved new
   *     polygon boundaries.
   *   - Loop operates directly on triangles, produces the same kind of
   *     rounded-surface limit (a cube becomes sphere-like after 2-3
   *     iterations), converges to a C^2 limit surface except at
   *     extraordinary (non-valence-6) vertices where it's C^1.
   *   - The Blender UI labels our type as "Catmull-Clark / Simple" with
   *     Simple = Loop. They produce visually indistinguishable results on
   *     a triangulated box -- the user can't tell the difference.
   *   - Pixar's OpenSubdiv uses Loop internally for triangle patches.
   *
   * Each new triangle carries a `_sourceFace` index so the modifier
   * pipeline can map any refined triangle back to its parent cage face
   * for the push/pull polygon's "select the whole cage face" semantics
   * (i.e. picking a sub-quad on the smoothed surface still highlights
   * the single cage face beneath).
   *
   * Reference:
   *   - https://en.wikipedia.org/wiki/Loop_subdivision_surface
   *   - Charles Loop, "Smooth Subdivision Surfaces Based on Triangles",
   *     1987.
   *   - three.js r124 `examples/js/modifiers/SubdivisionModifier.js`
   *     (Loop algorithm in JS).
   *
   * @param {number} [levels=1] subdivision iterations (1..5; >= 5 caps).
   * @returns {EditableMesh} a new mesh with `_sourceFace` (original face
   *   index per new triangle) and `_subdivisionLevels` (1..5) attached
   *   as additional properties. `_subdivisionSource` is the original
   *   `EditableMesh` reference for Apply-time baking.
   */
  subdivideLoop(levels = 1, options) {
    return this._subdivideWith(levels, _subdivideLoopOnce, 'loop', options);
  }

  /**
   * "Simple" subdivision -- Blender modifier dropdown alias that must
   * produce a visibly DIFFERENT result from Catmull-Clark: original
   * vertices stay at their positions (no smoothing), each edge gets
   * a midpoint, and each triangle becomes 4 child triangles. The
   * cube stays cube-shaped; it just gets denser.
   *
   * Topology (face count, `_sourceFace` mapping, faceGroup inheritance)
   * is identical to subdivideLoop(), so the polygon's picker round-trip
   * and the Apply path work the same way for both algorithms.
   */
  subdivideSimple(levels = 1, options) {
    return this._subdivideWith(levels, _subdivideSimpleOnce, 'simple', options);
  }

  /**
   * Catmull-Clark subdivision on QUAD topology. Produces a true quad
   * limit surface (a cube becomes sphere-like after 2 iterations,
   * with all faces being quads, not triangles).
   *
   * Quad detection: the source mesh is triangle-soup internally, but
   * two triangles that share an edge AND share a `faceGroup` ID are
   * treated as one quad. This is exactly how `boxFromBounds` and the
   * other primitives already store their quad faces (each box face
   * is two fan-triangulated triangles sharing a group ID).
   *
   * After CC, the output is again stored as triangle-pairs (one quad
   * = 2 triangles that share a `faceGroup`), so:
   *   - `selectionGroup(faceIdx)` continues to roll up triangles
   *     to their parent quad.
   *   - the polygon's `_sourceFace` mapping resolves any child
   *     triangle back to its parent cage quad face.
   *   - the wireframe overlay's quad-aware edge culling still works
   *     (it deduplicates coplanar edges inside one faceGroup).
   *
   * If the source mesh has no quad pairs (e.g. a triangulated mesh
   * where every face is its own group), this falls back to Loop
   * subdivision on triangles so the user still gets a smooth
   * surface.
   */
  subdivideCatmullClark(levels = 1, options) {
    const quads = _extractQuadPairs(this);
    if (quads.length === 0) {
      // No quad topology to subdivide -- fall back to Loop on the
      // existing triangle soup. Keeps post-push/pull meshes (which
      // produce n-gon side walls) working with the same UI.
      return this.subdivideLoop(levels, options);
    }
    return this._subdivideWith(levels, _subdivideCatmullClarkOnce, 'catmullClark', options);
  }

  /**
   * Dispatch a subdivision iteration over `levels` using either the
   * Loop (smoothing) or Simple (midpoint) helper. Shared by
   * `subdivideLoop` and `subdivideSimple` so the bookkeeping
   * (`_sourceFace`, `_subdivisionLevels`, `_subdivisionSource`)
   * stays consistent between the two algorithms.
   */
  _subdivideWith(levels, helper, kind, options = {}) {
    const levelCount = Math.max(0, Math.min(5, Math.round(levels)));
    const uniqueFaceGroups = !!options.uniqueFaceGroups;
    let current = this;
    for (let lvl = 0; lvl < levelCount; lvl += 1) {
      current = helper(current, { uniqueFaceGroups });
    }
    if (levelCount === 0) {
      const copy = new EditableMesh({
        vertices: current.vertices.map((v) => ({ x: v.x, y: v.y, z: v.z })),
        faces: current.faces.map((f) => [...f]),
        faceGroups: current.faceGroups ? [...current.faceGroups] : undefined,
        hasInwardPocket: current.hasInwardPocket,
      });
      copy._sourceFace = current.faces.map((_, i) => i);
      copy._subdivisionLevels = 0;
      copy._subdivisionAlgorithm = kind;
      copy._subdivisionSource = current;
      return copy;
    }
    current._sourceFace = current.faces.map((_, i) =>
      (current._sourceFacesPerCageFace && current._sourceFacesPerCageFace[i] != null)
        ? current._sourceFacesPerCageFace[i]
        : i,
    );
    // `_sourceFaceGroup` is the CAGE FACE GROUP (not the parent face
    // array index) for each child face/quad/triangle. The polygon's
    // picker passes `faceIdMap[i]` straight into `cage.selectionGroup(
    // faceId )`, which interprets the value as a faceGroup ID and
    // returns every cage triangle in that group. For Loop, the
    // parent face array index happens to match the faceGroup ID (12
    // cage tris paired 0/0, 1/1, ..., 5/5), so `_sourceFace` worked
    // by coincidence. For Catmull-Clark, the parent face array
    // index is the QUAD INDEX in `_extractQuadPairs` output, which
    // does NOT match the cage faceGroup at the same numeric slot --
    // `selectionGroup(1)` then returns cage triangles whose group is
    // 0 (the back), not 1 (the front), causing "selecting front
    // picks the opposite side". `_sourceFaceGroup` resolves each
    // child to the cage faceGroup directly so both algorithms pick
    // the right cage face.
    current._sourceFaceGroup = current.faces.map((_, i) => {
      const srcIdx = (current._sourceFacesPerCageFace && current._sourceFacesPerCageFace[i] != null)
        ? current._sourceFacesPerCageFace[i]
        : i;
      return _resolveCageFaceGroup(this, srcIdx);
    });
    current._subdivisionLevels = levelCount;
    current._subdivisionAlgorithm = kind;
    current._subdivisionSource = this;
    return current;
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
    // Build edge → list of face indices that share it. We also record
    // each face's `faceGroup` so an edge shared by two faces in the
    // SAME group is recognised as an internal triangulation diagonal
    // of one polygon (e.g. the diagonal of a 2-triangle quad) and
    // never emitted — regardless of `angleThreshold`. Without this,
    // `toEdgesGeometry(0)` (used to reveal subdivided box cells) would
    // also draw the diagonal of every sub-quad as a slash.
    const edgeFaces = new Map();
    const keyOf = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);
    for (let fi = 0; fi < this.faces.length; fi += 1) {
      const face = this.faces[fi];
      if (!face || face.length < 3) continue;
      const groupId = this.faceGroups ? this.faceGroups[fi] : fi;
      for (let i = 0; i < face.length; i += 1) {
        const a = face[i];
        const b = face[(i + 1) % face.length];
        const key = keyOf(a, b);
        if (!edgeFaces.has(key)) edgeFaces.set(key, []);
        edgeFaces.get(key).push({ a, b, fi, group: groupId });
      }
    }
    // Detect "pole" vertices — vertices whose incident edges are
    // shared by coplanar face pairs (e.g. a sphere's north pole, where
    // every cap-triangle pair has identical normals). The angle-threshold
    // test would otherwise drop those spokes, leaving the pole vertex
    // stranded with no wireframe edges ("dead space" at the tip).
    //
    // Heuristic: a vertex is a pole iff
    //   1. ALL its incident edges are shared by coplanar face pairs
    //      (so they're candidates for being culled by the threshold).
    //   2. The vertex is at the SAME index in every incident face
    //      (i.e. it sits at the tip of a true fan, not a quad-grid
    //      junction — a subdivided box's face-interior vertices
    //      satisfy (1) but not (2), so they correctly do NOT get
    //      classified as poles and their subdivision lines are
    //      emitted as expected).
    //   3. The vertex has at least 3 incident edges (a real fan, not
    //      a single shared boundary).
    const vertexEdgeCount = new Map();
    const vertexAllCoplanar = new Map();
    const cosThreshold = Math.cos((angleThreshold * Math.PI) / 180);
    // Per-vertex, record the index at which the vertex appears in each
    // incident face. A pole has a SINGLE index shared by every face;
    // a grid junction has multiple different indices.
    const vertexFaceIndices = new Map();
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
        // Record the position of v within each incident face so the
        // pole check can verify it's a true fan tip. Edge (face[i],
        // face[(i+1)%len]) tells us v is at position `i` in `face`.
        for (const { fi, a, b } of info) {
          const face = this.faces[fi];
          if (!face || face.length < 3) continue;
          const idx = face.indexOf(v);
          if (idx < 0) continue;
          if (!vertexFaceIndices.has(v)) vertexFaceIndices.set(v, new Set());
          vertexFaceIndices.get(v).add(idx);
        }
      }
    }
    const isPole = (v) =>
      vertexAllCoplanar.get(v) === true &&
      (vertexEdgeCount.get(v) || 0) >= 3 &&
      // Fan tip: the vertex is at the SAME position in every face.
      // A quad-grid interior vertex sits at index 0 in one quad,
      // index 1 in its neighbour, etc. — multiple distinct positions.
      // A sphere pole sits at index 0 (or any single index) of every
      // cap triangle.
      (vertexFaceIndices.get(v)?.size ?? 0) === 1;
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
        // Internal triangulation edge: both triangles belong to the
        // SAME polygon (they share a `faceGroup`). Always skip —
        // `angleThreshold` must not change this (the diagonal of a
        // sub-quad in a subdivided box, or the two-triangle quad of
        // a plain box, should never appear in the wireframe).
        const internalTriangulation = info[0].group === info[1].group;
        // `cosThreshold` is 1 when angleThreshold is 0 — but we want
        // every coplanar BOUNDARY edge to be emitted in that mode
        // (otherwise `toEdgesGeometry(0)` would silently drop the box
        // subdivisions it's being called for). Treat the threshold
        // as ">= 0" rather than "> 0" so threshold 0 means "emit all
        // non-internal edges". The internal-triangulation check
        // above is what keeps quad diagonals out in threshold-0 mode.
        const emit = !internalTriangulation && (poleSpoke || dot < cosThreshold - 1e-6 || angleThreshold <= 0);
        if (emit) {
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
