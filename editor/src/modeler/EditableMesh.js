import * as THREE from 'three';

export class EditableMesh {
  constructor({ vertices = [], faces = [] } = {}) {
    this.vertices = vertices.map(v => new THREE.Vector3(v.x, v.y, v.z));
    this.faces = faces.map(face => [...face]);
  }

  static box(size = 100) {
    const h = size / 2;
    return EditableMesh.boxFromBounds(
      new THREE.Vector3(-h, -h, -h),
      new THREE.Vector3(h, h, h)
    );
  }

  static boxFromBounds(min, max) {
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
    });
  }

  static fromJSON(data) {
    return new EditableMesh(data || {});
  }

  removeFaces(faceIndices) {
    const doomed = new Set(faceIndices);
    this.faces = this.faces.filter((_, index) => !doomed.has(index));
  }

  coplanarFaces(faceIndex, tolerance = 0.001) {
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
    }

    this.faces = replacement;
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
    };
  }
}
