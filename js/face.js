import { FACES as indices, UVS as texCoords } from "./geometry.js";
import {
  BufferGeometry,
  BufferAttribute,
  DynamicDrawUsage,
  Vector3,
  Triangle,
  Matrix4,
} from "three";

const NUM_VERTICES = 468;

// Mirroring the mesh horizontally reverses its winding, so keep a reversed index too.
const flippedIndices = indices.slice();
for (let i = 0; i < flippedIndices.length; i += 3) {
  flippedIndices[i + 1] = indices[i + 2];
  flippedIndices[i + 2] = indices[i + 1];
}

class FaceMeshFaceGeometry extends BufferGeometry {
  constructor(options = {}) {
    super();

    this.useVideoTexture = options.useVideoTexture || false;
    this.normalizeCoords = options.normalizeCoords || false;
    this.flipped = false;
    this.w = 1;
    this.h = 1;
    this.positions = new Float32Array(NUM_VERTICES * 3);
    this.uvs = new Float32Array(NUM_VERTICES * 2);
    this.setAttribute(
      "position",
      new BufferAttribute(this.positions, 3).setUsage(DynamicDrawUsage)
    );
    this.setAttribute(
      "uv",
      new BufferAttribute(this.uvs, 2).setUsage(DynamicDrawUsage)
    );
    this.setUvs();
    this.setIndex(indices);
    this.computeVertexNormals();
    this.getAttribute("normal").setUsage(DynamicDrawUsage);
    this.p0 = new Vector3();
    this.p1 = new Vector3();
    this.p2 = new Vector3();
    this.triangle = new Triangle();
  }

  setUvs() {
    for (let j = 0; j < NUM_VERTICES; j++) {
      this.uvs[j * 2] = texCoords[j][0];
      this.uvs[j * 2 + 1] = 1 - texCoords[j][1];
    }
    this.getAttribute("uv").needsUpdate = true;
  }

  setSize(w, h) {
    this.w = w;
    this.h = h;
  }

  // Accepts the landmarks of one face from MediaPipe's FaceLandmarker
  // (normalized), or a face from @tensorflow-models/face-landmarks-detection
  // (pixels). Pass the landmarks unflipped and set `flipped` instead.
  update(face, flipped = false) {
    const normalized = Array.isArray(face);
    const landmarks = normalized ? face : face.keypoints;
    if (!landmarks || landmarks.length < NUM_VERTICES) {
      throw new Error(
        "FaceMeshFaceGeometry.update expects 468 or more face landmarks."
      );
    }

    if (flipped !== this.flipped) {
      this.flipped = flipped;
      this.setIndex(flipped ? flippedIndices : indices);
    }

    const { w, h } = this;
    const sx = normalized ? w : 1;
    const sy = normalized ? h : 1;
    const scale = this.normalizeCoords ? 1 / h : 1;
    for (let j = 0; j < NUM_VERTICES; j++) {
      const l = landmarks[j];
      const x = l.x * sx;
      const y = l.y * sy;
      const z = l.z * sx;
      this.positions[j * 3] = scale * ((flipped ? w - x : x) - 0.5 * w);
      this.positions[j * 3 + 1] = scale * (0.5 * h - y);
      this.positions[j * 3 + 2] = -scale * z;
      if (this.useVideoTexture) {
        this.uvs[j * 2] = x / w;
        this.uvs[j * 2 + 1] = 1 - y / h;
      }
    }

    this.getAttribute("position").needsUpdate = true;
    if (this.useVideoTexture) {
      this.getAttribute("uv").needsUpdate = true;
    }
    this.computeVertexNormals();
    this.computeBoundingSphere();
  }

  track(id0, id1, id2) {
    const points = this.positions;
    this.p0.fromArray(points, id0 * 3);
    this.p1.fromArray(points, id1 * 3);
    this.p2.fromArray(points, id2 * 3);
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

export { FaceMeshFaceGeometry };
