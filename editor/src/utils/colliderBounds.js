import * as THREE from 'three';

export function isColliderAutoFitExcluded(node) {
  if (!node) return true;
  if (node.userData?._editorOnly) return true;
  if (node.userData?._isGizmo) return true;
  if (node.userData?._isColliderProxyMesh) return true;
  const name = String(node.name || '');
  return name.startsWith('__physics_edit_') || name === '__physics_edit_proxy__';
}

export function getColliderBounds(object, { scope = 'smart', excludeNode } = {}) {
  if (!object) return null;

  object.updateMatrixWorld(true);

  const bbox = new THREE.Box3();
  const tmpBox = new THREE.Box3();
  let hasAny = false;

  const addNode = (node) => {
    if (!node || (excludeNode && excludeNode(node)) || isColliderAutoFitExcluded(node)) return;
    if (!node.geometry) return;
    node.geometry.computeBoundingBox();
    if (!node.geometry.boundingBox) return;
    tmpBox.copy(node.geometry.boundingBox).applyMatrix4(node.matrixWorld);
    if (tmpBox.isEmpty()) return;
    if (!hasAny) {
      bbox.copy(tmpBox);
      hasAny = true;
    } else {
      bbox.union(tmpBox);
    }
  };

  const hasOwnGeometry = !!object.geometry;
  if (scope === 'selected') {
    addNode(object);
    return hasAny ? bbox : null;
  }

  if (scope === 'smart' && hasOwnGeometry) {
    addNode(object);
    return hasAny ? bbox : null;
  }

  if (scope === 'smart' && !hasOwnGeometry) {
    object.traverse((node) => {
      if (node === object && hasOwnGeometry) return;
      addNode(node);
    });
    return hasAny ? bbox : null;
  }

  if (scope === 'hierarchy') {
    object.traverse((node) => {
      if (node === object && hasOwnGeometry) {
        addNode(node);
        return;
      }
      addNode(node);
    });
  }

  return hasAny ? bbox : null;
}

export function getSmartColliderBounds(object, options = {}) {
  return getColliderBounds(object, { ...options, scope: options.scope ?? 'smart' });
}
