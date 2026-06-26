#!/usr/bin/env node
/**
 * Investigate faint wire lines on subdivided boxes.
 *
 * User report: after subdivide / push-pull, some wireframe lines are
 * bold and visible, others appear faint. The hypothesis is that the
 * ribbon's outward lift is inconsistent across segments on a flat
 * subdivided face — segments coplanar with the camera view get tiny
 * ribbon offsets while segments perpendicular to the camera view get
 * proper screen-aligned offsets, producing inconsistent thickness /
 * z-fight loss on the surface-tangent segments.
 */

import * as THREE from '../editor/libs/three/build/three.module.min.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as url from 'node:url';

const emPath = path.resolve('editor/src/CycoModeler/EditableMesh.js');
const emSrc = await fs.readFile(emPath, 'utf8');
const emPatched = emSrc.replace(
  /from\s+['"]three['"]/,
  "from '../editor/libs/three/build/three.module.min.js'",
);
const tmpPath = path.resolve('tools/.tmp-boxfaint-EditableMesh.mjs');
await fs.writeFile(tmpPath, emPatched, 'utf8');
const { EditableMesh } = await import(url.pathToFileURL(tmpPath).href);

// Build a subdivided box (mimics the user's situation)
const m = EditableMesh.boxSubdivided(120, 250, 120, 3);
const eg = m.toEdgesGeometry(0);

const segs = eg.attributes.position.count / 2;
const normals = eg.userData._segFaceNormals;
console.log('boxSubdivided 120x250x120 s=3: ' + segs + ' segments');
console.log('segments with face normals: ' + normals.filter(n => n.length >= 3).length);
console.log('segments with NO face normals: ' + normals.filter(n => n.length === 0).length);
console.log('segments with 2 face normals (shared edge): ' + normals.filter(n => n.length === 6).length);

// Simulate the camera looking at the front face from a slight angle
const cameraPos = new THREE.Vector3(180, 130, 220);
const parentWorld = new THREE.Matrix4(); // identity (object at origin)
const invParent = new THREE.Matrix4().copy(parentWorld).invert();
const width = 1.5; // typical world-space ribbon width
const pos = eg.attributes.position;

// Mirror the ribbon algorithm for each segment, computing the
// "world-space outward offset magnitude" — i.e. how far the ribbon
// quad sits OUTSIDE the surface (after both the perp-flip and the
// normal lift). Small/zero values mean the ribbon is coplanar with the
// surface and will z-fight / be occluded.
const camera = { position: cameraPos };
let segIdx = 0;
const offsetMag = [];
const perpDot = [];
const outwardPushedCount = { yes: 0, no: 0 };
let zeroLiftCount = 0;
let zeroPerpCount = 0;

for (let i = 0; i < segs; i++) {
  const a = new THREE.Vector3().fromBufferAttribute(pos, i * 2);
  const b = new THREE.Vector3().fromBufferAttribute(pos, i * 2 + 1);
  const dir = new THREE.Vector3().subVectors(b, a).normalize();
  const dirW = dir.clone().transformDirection(parentWorld);
  const midLocal = a.clone().add(b).multiplyScalar(0.5);
  const midWorld = midLocal.clone().applyMatrix4(parentWorld);
  const viewDir = new THREE.Vector3().subVectors(cameraPos, midWorld).normalize();
  const perpW = new THREE.Vector3().crossVectors(dirW, viewDir);

  let offsetLocal;
  let perpMag = perpW.length();
  let faceNormalWorld = null;

  if (perpMag < 1e-3) {
    zeroPerpCount++;
    // axis fallback
    const axes = [new THREE.Vector3(1,0,0), new THREE.Vector3(0,1,0), new THREE.Vector3(0,0,1)];
    let chosen = axes[2];
    for (const ax of axes) {
      const t = new THREE.Vector3().crossVectors(dir, ax);
      if (t.lengthSq() > 1e-6) { chosen = ax; break; }
    }
    offsetLocal = new THREE.Vector3().crossVectors(dir, chosen).normalize().multiplyScalar(width);
  } else {
    perpW.normalize();
    offsetLocal = perpW.clone().transformDirection(invParent).multiplyScalar(width);
  }

  // Apply face-normal flip
  const nrm = normals[i];
  if (nrm && nrm.length >= 3) {
    const nf = new THREE.Vector3(nrm[0], nrm[1], nrm[2]).normalize();
    faceNormalWorld = nf.clone().transformDirection(parentWorld);
    const dot = perpW.dot(faceNormalWorld);
    if (dot < 0) {
      offsetLocal.multiplyScalar(-1);
      outwardPushedCount.yes++;
    } else {
      outwardPushedCount.no++;
    }
  }

  // Apply normal lift (same as in code)
  if (faceNormalWorld) {
    const liftAmount = width * 0.5;
    const liftLocal = faceNormalWorld.clone().transformDirection(invParent).multiplyScalar(liftAmount);
    offsetLocal.add(liftLocal);
  } else {
    zeroLiftCount++;
  }

  // The "effective outward push" = projection of offset onto face normal
  if (faceNormalWorld) {
    const outwardPush = offsetLocal.dot(faceNormalWorld.clone().transformDirection(invParent));
    offsetMag.push(outwardPush);
    perpDot.push(perpW.dot(faceNormalWorld));
  } else {
    offsetMag.push(null);
    perpDot.push(null);
  }
}

const valid = offsetMag.filter(v => v !== null);
const min = Math.min(...valid);
const max = Math.max(...valid);
const sum = valid.reduce((s, v) => s + v, 0);
const avg = sum / valid.length;

console.log('\n=== Outward-push distribution (across '+valid.length+' segments with normals) ===');
console.log('min=' + min.toFixed(4) + ' max=' + max.toFixed(4) + ' avg=' + avg.toFixed(4));
console.log('zero-or-negative push (coplanar/inside): ' + valid.filter(v => v <= 0.001).length + ' segments');
console.log('outwardPushed: yes=' + outwardPushedCount.yes + ' no=' + outwardPushedCount.no);
console.log('zeroPerp (axis fallback): ' + zeroPerpCount);
console.log('noLift (no face normal): ' + zeroLiftCount);

// Bucket by magnitude
const buckets = { '<0.01': 0, '0.01-0.1': 0, '0.1-0.5': 0, '0.5-1.0': 0, '>1.0': 0 };
for (const v of valid) {
  if (v < 0.01) buckets['<0.01']++;
  else if (v < 0.1) buckets['0.01-0.1']++;
  else if (v < 0.5) buckets['0.1-0.5']++;
  else if (v < 1.0) buckets['0.5-1.0']++;
  else buckets['>1.0']++;
}
console.log('\n=== Push magnitude histogram ===');
for (const k of Object.keys(buckets)) console.log('  ' + k + ': ' + buckets[k]);

// Print the segments with the SMALLEST outward push (these would be the "faint" ones)
const sorted = valid.map((v, i) => ({ v, idx: offsetMag.indexOf(v, i) })).sort((a, b) => a.v - b.v);
console.log('\n=== 10 segments with smallest outward push (faint candidates) ===');
const seen = new Set();
let count = 0;
for (const s of sorted) {
  if (seen.has(s.idx)) continue;
  seen.add(s.idx);
  if (count >= 10) break;
  const a = new THREE.Vector3().fromBufferAttribute(pos, s.idx * 2);
  const b = new THREE.Vector3().fromBufferAttribute(pos, s.idx * 2 + 1);
  console.log('  seg ' + s.idx + ': (' + a.x.toFixed(0) + ',' + a.y.toFixed(0) + ',' + a.z.toFixed(0) + ') -> (' + b.x.toFixed(0) + ',' + b.y.toFixed(0) + ',' + b.z.toFixed(0) + ') push=' + s.v.toFixed(4) + ' perpDot=' + perpDot[s.idx].toFixed(3));
  count++;
}
