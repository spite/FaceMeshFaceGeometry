import {
  FACES as indices,
  UVS as texCoords,
  CANONICAL as canonical,
} from "./geometry.js";
import {
  BufferGeometry,
  BufferAttribute,
  DynamicDrawUsage,
  Vector3,
  Triangle,
  Matrix4,
} from "three";

const NUM_VERTICES = 468;

// Vertical field of view of the camera MediaPipe's transformation matrices assume.
const METRIC_CAMERA_FOV = 63;

const RIGHT_IRIS = 468;
const LEFT_IRIS = 473;

// Mirroring the mesh horizontally reverses its winding, so keep a reversed index too.
const flippedIndices = indices.slice();
for (let i = 0; i < flippedIndices.length; i += 3) {
  flippedIndices[i + 1] = indices[i + 2];
  flippedIndices[i + 2] = indices[i + 1];
}

const canonicalCenter = new Vector3();
for (const v of canonical) {
  canonicalCenter.x += v[0] / NUM_VERTICES;
  canonicalCenter.y += v[1] / NUM_VERTICES;
  canonicalCenter.z += v[2] / NUM_VERTICES;
}

const mirror = new Matrix4().makeScale(-1, 1, 1);
const center = new Vector3();
const point = new Vector3();

class FaceMeshFaceGeometry extends BufferGeometry {
  constructor(options = {}) {
    super();

    this.useVideoTexture = options.useVideoTexture || false;
    this.normalizeCoords = options.normalizeCoords || false;
    this.metric = options.metric || false;
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
    this.pose = new Matrix4();
    this.rightIris = { position: new Vector3(), radius: 0 };
    this.leftIris = { position: new Vector3(), radius: 0 };
    this.hasIrises = false;
    this.blendshapes = {};
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

  // Updates from a FaceLandmarkerResult, reading the landmarks, blendshapes and
  // transformation matrix of the face at `index`. Returns false if there's no such face.
  updateFromResult(result, { index = 0, flipped = false } = {}) {
    const landmarks = result.faceLandmarks[index];
    if (!landmarks) return false;
    const matrices = result.facialTransformationMatrixes;
    this.update(landmarks, flipped, matrices && matrices[index]);
    const blendshapes = result.faceBlendshapes && result.faceBlendshapes[index];
    if (blendshapes) {
      for (const c of blendshapes.categories) {
        this.blendshapes[c.categoryName] = c.score;
      }
    }
    return true;
  }

  // Accepts the landmarks of one face from MediaPipe's FaceLandmarker
  // (normalized), or a face from @tensorflow-models/face-landmarks-detection
  // (pixels). Pass the landmarks unflipped and set `flipped` instead.
  // Metric mode also needs the face's facial transformation matrix.
  update(face, flipped = false, transformationMatrix) {
    const normalized = Array.isArray(face);
    const landmarks = normalized ? face : face.keypoints;
    if (!landmarks || landmarks.length < NUM_VERTICES) {
      throw new Error(
        "FaceMeshFaceGeometry.update expects 468 or more face landmarks."
      );
    }
    if (this.metric && !(normalized && transformationMatrix)) {
      throw new Error(
        "Metric mode needs MediaPipe landmarks and their facial transformation matrix. Create the FaceLandmarker with outputFacialTransformationMatrixes: true."
      );
    }

    if (flipped !== this.flipped) {
      this.flipped = flipped;
      this.setIndex(flipped ? flippedIndices : indices);
    }

    this.sx = normalized ? this.w : 1;
    this.sy = normalized ? this.h : 1;
    if (this.metric) {
      this.setPose(landmarks, transformationMatrix);
    }

    for (let j = 0; j < NUM_VERTICES; j++) {
      this.landmarkToPosition(landmarks[j], point).toArray(this.positions, j * 3);
      if (this.useVideoTexture) {
        this.uvs[j * 2] = (landmarks[j].x * this.sx) / this.w;
        this.uvs[j * 2 + 1] = 1 - (landmarks[j].y * this.sy) / this.h;
      }
    }

    this.hasIrises = landmarks.length >= LEFT_IRIS + 5;
    if (this.hasIrises) {
      this.updateIris(this.rightIris, landmarks, RIGHT_IRIS);
      this.updateIris(this.leftIris, landmarks, LEFT_IRIS);
    }

    this.getAttribute("position").needsUpdate = true;
    if (this.useVideoTexture) {
      this.getAttribute("uv").needsUpdate = true;
    }
    this.computeVertexNormals();
    this.computeBoundingSphere();
  }

  setPose(landmarks, transformationMatrix) {
    const data = transformationMatrix.data || transformationMatrix.elements;
    this.pose.fromArray(data);
    // Landmark depths are relative, so anchor their mean to the posed canonical face.
    this.depth = -center.copy(canonicalCenter).applyMatrix4(this.pose).z;
    let meanZ = 0;
    for (let j = 0; j < NUM_VERTICES; j++) {
      meanZ += landmarks[j].z / NUM_VERTICES;
    }
    this.meanZ = meanZ;
    this.tanY = Math.tan(((METRIC_CAMERA_FOV / 2) * Math.PI) / 180);
    this.tanX = this.tanY * (this.w / this.h);
    if (this.flipped) {
      this.pose.premultiply(mirror);
    }
  }

  landmarkToPosition(l, target) {
    const { w, h } = this;
    const x = l.x * this.sx;
    const y = l.y * this.sy;
    const z = l.z * this.sx;
    if (this.metric) {
      // Unproject the landmark through the camera the transformation matrix assumes.
      const depth =
        this.depth + (l.z - this.meanZ) * 2 * this.depth * this.tanX;
      const px = (x / w - 0.5) * 2 * this.tanX * depth;
      return target.set(
        this.flipped ? -px : px,
        (0.5 - y / h) * 2 * this.tanY * depth,
        -depth
      );
    }
    const scale = this.normalizeCoords ? 1 / h : 1;
    return target.set(
      scale * ((this.flipped ? w - x : x) - 0.5 * w),
      scale * (0.5 * h - y),
      -scale * z
    );
  }

  updateIris(iris, landmarks, start) {
    this.landmarkToPosition(landmarks[start], iris.position);
    let radius = 0;
    for (let j = 1; j < 5; j++) {
      radius += this.landmarkToPosition(landmarks[start + j], point).distanceTo(
        iris.position
      );
    }
    iris.radius = radius / 4;
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

export { FaceMeshFaceGeometry, METRIC_CAMERA_FOV };
export { FACES, UVS, CANONICAL } from "./geometry.js";
