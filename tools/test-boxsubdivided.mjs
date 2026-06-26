#!/usr/bin/env node
/**
 * Smoke test for EditableMesh.boxSubdivided — validates vertex/face
 * counts, outward-facing normals, and that toEdgesGeometry emits
 * subdivision edges at threshold 0 (so the wireframe overlay shows
 * the subdivisions after the Subdivide tool rebuilds the geometry).
 */

import * as THREE from '../editor/libs/three/build/three.module.min.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as url from 'node:url';

const emPath = path.resolve(
  path.dirname(url.fileURLToPath(import.meta.url)),
  '..', 'editor', 'src', 'CycoModeler', 'EditableMesh.js',
);
const emSrc = await fs.readFile(emPath, 'utf8');
const emSrcPatched = emSrc.replace(
  /from\s+['"]three['"]/,
  "from '../editor/libs/three/build/three.module.min.js'",
);
const tmpPath = path.resolve(
  path.dirname(url.fileURLToPath(import.meta.url)),
  '.tmp-boxsubdivided-EditableMesh.mjs',
);
await fs.writeFile(tmpPath, emSrcPatched, 'utf8');
const { EditableMesh } = await import(url.pathToFileURL(tmpPath).href);

let failed = 0;
function assert(name, cond, info) {
  if (cond) console.log(`  PASS  ${name}`);
  else { console.log(`  FAIL  ${name}  ${info ?? ''}`); failed += 1; }
}

// 1. Topology counts for a 3-segment subdivided box.
{
  const m = EditableMesh.boxSubdivided(100, 50, 80, 3);
  assert('verts (6*(s+1)^2)', m.vertices.length === 6 * 16, `got ${m.vertices.length}`);
  assert('faces (6*s*s*2)',   m.faces.length    === 6 * 9 * 2, `got ${m.faces.length}`);
  assert('faceGroups match face count', m.faceGroups.length === m.faces.length);
}

// 2. Every triangle faces outward (centroid-vs-normal dot vs centroid-vs-origin).
{
  const m = EditableMesh.boxSubdivided(100, 50, 80, 3);
  const center = new THREE.Vector3(0, 25, 0);
  let out = 0, inw = 0;
  for (let i = 0; i < m.faces.length; i += 1) {
    const f = m.faces[i];
    const a = m.vertices[f[0]]; const b = m.vertices[f[1]]; const c = m.vertices[f[2]];
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    const fc = new THREE.Vector3((a.x+b.x+c.x)/3, (a.y+b.y+c.y)/3, (a.z+b.z+c.z)/3).sub(center);
    if (n.dot(fc) > 0) out += 1; else inw += 1;
  }
  assert('all triangles outward-facing', inw === 0, `inward=${inw}/${m.faces.length}`);
}

// 3. toEdgesGeometry(0) emits every polygon edge — including subdivision lines.
{
  const m = EditableMesh.boxSubdivided(100, 50, 80, 3);
  const eg = m.toEdgesGeometry(0);
  const segs = eg.attributes.position.count / 2;
  // Expected: each face has s*(s+1) horizontal + s*(s+1) vertical internal+boundary
  // edges = 2*s*(s+1). 6 faces => 12*s*(s+1). For s=3: 12*3*4 = 144.
  assert('edges threshold=0 shows subdivisions', segs >= 144, `got ${segs}`);
}

// 4. toEdgesGeometry(1) emits ONLY the silhouette (internal subdivision
// lines between coplanar cells are culled). boxSubdivided allocates
// its vertices PER FACE so each silhouette edge appears twice (once
// per face, with different vertex indices); with s=3 subdivisions,
// each of the 12 box silhouette edges is split into 3 segments, so
// we expect 12 * 3 * 2 = 72 emitted segments. The invariant we really
// care about is that subdivisions don't leak through: at s=1 the
// same geometry should emit 24 segments (12 silhouette * 2), so the
// ratio subdivided/flat should be exactly s.
{
  const m = EditableMesh.boxSubdivided(100, 50, 80, 3);
  const flat = EditableMesh.boxSubdivided(100, 50, 80, 1);
  const segs = m.toEdgesGeometry(1).attributes.position.count / 2;
  const flatSegs = flat.toEdgesGeometry(1).attributes.position.count / 2;
  assert('thr=1 emits exactly s× flat silhouette count (no subdivisions)',
    segs === flatSegs * 3, `got ${segs}, expected ${flatSegs * 3} (flat=${flatSegs})`);
}

// 5. Each subdivided quad is its own faceGroup (push-pull a single cell).
{
  const m = EditableMesh.boxSubdivided(100, 50, 80, 3);
  const groups = new Set(m.faceGroups);
  // 6 faces * s*s groups = 54 unique groups for s=3.
  assert('unique face groups (6*s*s)', groups.size === 6 * 9, `got ${groups.size}`);
}

// 6. s=1 collapses to a plain box (12 tris, 6 groups).
{
  const m = EditableMesh.boxSubdivided(100, 50, 80, 1);
  assert('s=1 faces (12 tris)', m.faces.length === 12, `got ${m.faces.length}`);
  const groups = new Set(m.faceGroups);
  assert('s=1 unique face groups (6)', groups.size === 6, `got ${groups.size}`);
}

// 7. toBufferGeometry preserves triangle count and faceId attribute.
{
  const m = EditableMesh.boxSubdivided(100, 50, 80, 3);
  const bg = m.toBufferGeometry();
  assert('toBufferGeometry tris', bg.attributes.position.count / 3 === 108, `got ${bg.attributes.position.count / 3}`);
  assert('toBufferGeometry faceId', bg.attributes.faceId.count === 108 * 3, `got ${bg.attributes.faceId.count}`);
}

await fs.unlink(tmpPath).catch(() => {});
console.log(failed === 0 ? '\nAll boxSubdivided tests passed.' : `\n${failed} test(s) failed.`);
process.exit(failed === 0 ? 0 : 1);