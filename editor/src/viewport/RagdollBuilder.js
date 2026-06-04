import * as THREE from 'three';

const DEFAULT_PRESET = 'humanoid';

function _getWorldSize(object) {
  const bbox = new THREE.Box3().setFromObject(object);
  if (bbox.isEmpty()) {
    bbox.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(1, 1, 1));
  }
  return bbox.getSize(new THREE.Vector3());
}

function _humanoidPreset(size) {
  const width = Math.max(size.x, 0.5);
  const height = Math.max(size.y, 1.0);
  const depth = Math.max(size.z, 0.5);
  const pelvisHeight = Math.max(height * 0.12, 0.12);
  const chestHeight = Math.max(height * 0.16, 0.14);
  const armHeight = Math.max(height * 0.18, 0.18);
  const legHeight = Math.max(height * 0.28, 0.2);
  const headRadius = Math.max(width * 0.13, 0.12);
  const limbRadius = Math.max(width * 0.08, 0.08);
  const shoulderX = Math.max(width * 0.35, 0.18);
  const hipX = Math.max(width * 0.14, 0.1);

  const parts = [
    { id: 'pelvis', type: 'capsule', radius: limbRadius, halfHeight: pelvisHeight, offset: { x: 0, y: -height * 0.18, z: 0 } },
    { id: 'chest', type: 'capsule', radius: limbRadius * 1.1, halfHeight: chestHeight, offset: { x: 0, y: 0.05 * height, z: 0 } },
    { id: 'head', type: 'ball', radius: headRadius, offset: { x: 0, y: chestHeight + headRadius * 0.8, z: 0 } },
    { id: 'leftArm', type: 'capsule', radius: limbRadius, halfHeight: armHeight, offset: { x: -shoulderX, y: 0, z: 0 } },
    { id: 'rightArm', type: 'capsule', radius: limbRadius, halfHeight: armHeight, offset: { x: shoulderX, y: 0, z: 0 } },
    { id: 'leftLeg', type: 'capsule', radius: limbRadius, halfHeight: legHeight, offset: { x: -hipX, y: -0.42 * height, z: 0 } },
    { id: 'rightLeg', type: 'capsule', radius: limbRadius, halfHeight: legHeight, offset: { x: hipX, y: -0.42 * height, z: 0 } },
  ];

  const joints = [
    { a: 'pelvis', b: 'chest', type: 'spherical', anchorA: { x: 0, y: pelvisHeight, z: 0 }, anchorB: { x: 0, y: -chestHeight, z: 0 } },
    { a: 'chest', b: 'head', type: 'spherical', anchorA: { x: 0, y: chestHeight, z: 0 }, anchorB: { x: 0, y: -headRadius, z: 0 } },
    { a: 'pelvis', b: 'leftLeg', type: 'spherical', anchorA: { x: -hipX * 0.6, y: -pelvisHeight * 0.25, z: 0 }, anchorB: { x: 0, y: legHeight, z: 0 } },
    { a: 'pelvis', b: 'rightLeg', type: 'spherical', anchorA: { x: hipX * 0.6, y: -pelvisHeight * 0.25, z: 0 }, anchorB: { x: 0, y: legHeight, z: 0 } },
    { a: 'chest', b: 'leftArm', type: 'spherical', anchorA: { x: -shoulderX * 0.8, y: 0, z: 0 }, anchorB: { x: 0, y: armHeight, z: 0 } },
    { a: 'chest', b: 'rightArm', type: 'spherical', anchorA: { x: shoulderX * 0.8, y: 0, z: 0 }, anchorB: { x: 0, y: armHeight, z: 0 } },
  ];

  return { rootPart: 'pelvis', parts, joints };
}

function _quadrupedPreset(size) {
  const width = Math.max(size.x, 0.5);
  const height = Math.max(size.y, 0.7);
  const depth = Math.max(size.z, 0.8);
  const torsoHeight = Math.max(height * 0.12, 0.12);
  const headRadius = Math.max(width * 0.12, 0.1);
  const legHeight = Math.max(height * 0.22, 0.18);
  const limbRadius = Math.max(width * 0.08, 0.08);
  const hipX = Math.max(width * 0.25, 0.12);
  const hipZ = Math.max(depth * 0.22, 0.12);

  const parts = [
    { id: 'torso', type: 'capsule', radius: limbRadius * 1.1, halfHeight: torsoHeight, offset: { x: 0, y: 0, z: 0 } },
    { id: 'head', type: 'ball', radius: headRadius, offset: { x: 0, y: 0.08 * height, z: depth * 0.35 } },
    { id: 'tail', type: 'ball', radius: limbRadius * 0.9, offset: { x: 0, y: -0.05 * height, z: -depth * 0.35 } },
    { id: 'frontLeftLeg', type: 'capsule', radius: limbRadius, halfHeight: legHeight, offset: { x: -hipX, y: -0.35 * height, z: hipZ } },
    { id: 'frontRightLeg', type: 'capsule', radius: limbRadius, halfHeight: legHeight, offset: { x: hipX, y: -0.35 * height, z: hipZ } },
    { id: 'backLeftLeg', type: 'capsule', radius: limbRadius, halfHeight: legHeight, offset: { x: -hipX, y: -0.35 * height, z: -hipZ } },
    { id: 'backRightLeg', type: 'capsule', radius: limbRadius, halfHeight: legHeight, offset: { x: hipX, y: -0.35 * height, z: -hipZ } },
  ];

  const joints = [
    { a: 'torso', b: 'head', type: 'spherical', anchorA: { x: 0, y: 0.05 * height, z: depth * 0.18 }, anchorB: { x: 0, y: -headRadius * 0.4, z: 0 } },
    { a: 'torso', b: 'tail', type: 'spherical', anchorA: { x: 0, y: -0.05 * height, z: -depth * 0.18 }, anchorB: { x: 0, y: headRadius * 0.05, z: 0 } },
    { a: 'torso', b: 'frontLeftLeg', type: 'spherical', anchorA: { x: -hipX * 0.6, y: -torsoHeight * 0.2, z: hipZ * 0.4 }, anchorB: { x: 0, y: legHeight, z: 0 } },
    { a: 'torso', b: 'frontRightLeg', type: 'spherical', anchorA: { x: hipX * 0.6, y: -torsoHeight * 0.2, z: hipZ * 0.4 }, anchorB: { x: 0, y: legHeight, z: 0 } },
    { a: 'torso', b: 'backLeftLeg', type: 'spherical', anchorA: { x: -hipX * 0.6, y: -torsoHeight * 0.2, z: -hipZ * 0.4 }, anchorB: { x: 0, y: legHeight, z: 0 } },
    { a: 'torso', b: 'backRightLeg', type: 'spherical', anchorA: { x: hipX * 0.6, y: -torsoHeight * 0.2, z: -hipZ * 0.4 }, anchorB: { x: 0, y: legHeight, z: 0 } },
  ];

  return { rootPart: 'torso', parts, joints };
}

export function buildRagdollPreset(object, preset = DEFAULT_PRESET) {
  const size = _getWorldSize(object);
  switch ((preset || DEFAULT_PRESET).toLowerCase()) {
    case 'quadruped':
      return _quadrupedPreset(size);
    case 'humanoid':
    default:
      return _humanoidPreset(size);
  }
}
