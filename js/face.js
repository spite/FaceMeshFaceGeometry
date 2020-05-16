import { FACES as indices, UVS as texCoords } from './geometry.js';
import { BufferGeometry, BufferAttribute, Vector3, Triangle, Matrix4 } from '../third_party/three.module.js';

class FaceMeshFaceGeometry {
  constructor() {
    this.flipped = false;
    this.geometry = new BufferGeometry();
    this.positions = new Float32Array(468 * 3);
    this.uvs = new Float32Array(468 * 2);
    this.geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('uv', new BufferAttribute(this.uvs, 2));
    this.setUvs();
    this.geometry.setIndex(indices);
    this.geometry.computeVertexNormals();
    this.geometry.applyMatrix4(new Matrix4().makeScale(10, 10, 10));
    this.p0 = new Vector3();
    this.p1 = new Vector3();
    this.p2 = new Vector3();
    this.triangle = new Triangle();
  }

  setUvs() {
    for (let j = 0; j < 468 * 2; j += 2) {
      this.uvs[j] = this.flipped ? 1 - (texCoords[j] / 4096) : (texCoords[j] / 4096);
      this.uvs[j + 1] = 1 - (texCoords[j + 1]) / 4096;
    }
    this.geometry.getAttribute('uv').needsUpdate = true;
  }

  setSize(w, h) {
    this.w = w;
    this.h = h;
  }

  update(face, cameraFlipped) {
    if (cameraFlipped !== this.flipped) {
      this.flipped = cameraFlipped;
      this.setUvs();
    }
    let ptr = 0;
    for (const p of face.scaledMesh) {
      if (cameraFlipped) {
        this.positions[ptr] = p[0] + .5 * this.w;
      } else {
        this.positions[ptr] = p[0] - .5 * this.w;
      }
      this.positions[ptr + 1] = (this.h - p[1]) - .5 * this.h;
      this.positions[ptr + 2] = -p[2];
      ptr += 3;
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.computeVertexNormals();
  }

  track(id0, id1, id2) {
    const points = this.positions;
    this.p0.set(points[id0 * 3], points[id0 * 3 + 1], points[id0 * 3 + 2]);
    this.p1.set(points[id1 * 3], points[id1 * 3 + 1], points[id1 * 3 + 2]);
    this.p2.set(points[id2 * 3], points[id2 * 3 + 1], points[id2 * 3 + 2]);
    this.triangle.set(this.p0, this.p1, this.p2);
    const center = new Vector3();
    this.triangle.getMidpoint(center);
    const normal = new Vector3();
    this.triangle.getNormal(normal);
    const matrix = new Matrix4();
    const x = this.p1.clone().sub(this.p2).normalize();
    const y = this.p1.clone().sub(this.p0).normalize();
    const z = new Vector3().crossVectors(x, y);
    const y2 = new Vector3().crossVectors(x, z).normalize();
    const z2 = new Vector3().crossVectors(x, y2).normalize();
    matrix.makeBasis(x, y2, z2);
    return { position: center, normal, rotation: matrix };
  }
}

export { FaceMeshFaceGeometry }