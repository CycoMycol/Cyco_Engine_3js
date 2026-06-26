// Quick verification of the new spiralStair geometry.
// Re-implements the relevant static method from editor/src/CycoModeler/EditableMesh.js
// so we don't need the full editor module graph to run this from Node.

import * as THREE from '../editor/libs/three/build/three.module.min.js';

const DEFAULT_SEGMENTS = 24;

function spiralStair(width, height, depth, segments = DEFAULT_SEGMENTS, turns = 1) {
  const seg = Math.max(8, Math.round(segments));
  const totalSteps = Math.max(4, Math.round(seg * Math.max(0.25, turns)));
  const rOuter = Math.max(1, width / 2);
  const rInner = Math.max(0, rOuter - Math.max(0, depth));
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
    const InF_B = vertices.length; vertices.push({ x: 0, y: yBot, z: 0 });
    const InF_T = vertices.length; vertices.push({ x: 0, y: yTop, z: 0 });
    const OuF_B = vertices.length; vertices.push({ x: cosF * rOuter, y: yBot, z: sinF * rOuter });
    const OuF_T = vertices.length; vertices.push({ x: cosF * rOuter, y: yTop, z: sinF * rOuter });
    const OuB_B = vertices.length; vertices.push({ x: cosB * rOuter, y: yBot, z: sinB * rOuter });
    const OuB_T = vertices.length; vertices.push({ x: cosB * rOuter, y: yTop, z: sinB * rOuter });
    steps.push({ InF_B, InF_T, OuF_B, OuF_T, OuB_B, OuB_T });
  }
  for (let i = 0; i < totalSteps; i += 1) {
    const s = steps[i];
    faces.push([s.InF_T, s.OuB_T, s.OuF_T]);
    faces.push([s.OuF_B, s.OuF_T, s.OuB_T, s.OuB_B]);
    faces.push([s.OuB_B, s.OuB_T, s.InF_T, s.InF_B]);
    faces.push([s.InF_B, s.OuF_B, s.OuF_T, s.InF_T]);
  }
  const s0 = steps[0];
  faces.push([s0.InF_B, s0.OuF_B, s0.OuB_B]);
  return { vertices, faces };
}

const m = spiralStair(200, 300, 100, 24, 1);
console.log('vertices:', m.vertices.length);
console.log('faces:', m.faces.length);

function faceNormal(vertices, face) {
  const a = vertices[face[0]];
  const b = vertices[face[1]];
  const c = vertices[face[2]];
  const ab = [b.x - a.x, b.y - a.y, b.z - a.z];
  const ac = [c.x - a.x, c.y - a.y, c.z - a.z];
  const n = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ];
  const l = Math.hypot(n[0], n[1], n[2]) || 1;
  return [n[0] / l, n[1] / l, n[2] / l];
}

let upTreads = 0;
let downBot = 0;
let outSides = 0;
let backFaces = 0;
let fwdRisers = 0;
const steps = (m.faces.length - 1) / 4; // last face is the bottom triangle
for (let s = 0; s < steps; s++) {
  for (let i = 0; i < 4; i++) {
    const fi = s * 4 + i;
    const n = faceNormal(m.vertices, m.faces[fi]);
    if (i === 0 && n[1] > 0.5) upTreads++;
    if (i === 1 && Math.abs(n[1]) < 0.2) outSides++;
    if (i === 2 && Math.abs(n[1]) < 0.2) backFaces++;
    if (i === 3 && Math.abs(n[1]) < 0.2) fwdRisers++;
  }
}
const botN = faceNormal(m.vertices, m.faces[m.faces.length - 1]);
if (botN[1] < -0.5) downBot++;
console.log('Steps:', steps);
console.log('Up-pointing treads:', upTreads, '/', steps);
console.log('Vertical outer sides:', outSides, '/', steps);
console.log('Vertical back faces:', backFaces, '/', steps);
console.log('Vertical risers:', fwdRisers, '/', steps);
console.log('Down-pointing bottom:', downBot, '/ 1');

const ys = [...new Set(m.vertices.map(v => v.y))].sort((a, b) => a - b);
console.log('Distinct Y values (first 6):', ys.slice(0, 6).map(y => y.toFixed(2)));

const outerR = m.vertices.filter(v => v.x !== 0 || v.z !== 0).map(v => Math.hypot(v.x, v.z));
const minR = Math.min(...outerR);
const maxR = Math.max(...outerR);
console.log('Outer ring radius min/max:', minR.toFixed(2), maxR.toFixed(2), '(expected ~100)');