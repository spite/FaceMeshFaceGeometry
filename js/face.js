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
  Quaternion,
} from "three";
import { OneEuroFilter, smoothingFactor } from "./filter.js";

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

// Defaults for smoothing, tuned on landmarks in normalized image coordinates.
const SMOOTHING = { minCutoff: 0.5, beta: 40 };

const mirror = new Matrix4().makeScale(-1, 1, 1);
const center = new Vector3();
const point = new Vector3();
const posePosition = new Vector3();
const poseRotation = new Quaternion();
const poseScale = new Vector3();

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
    this.input = [];
    this.setSmoothing(options.smoothing);
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

  // Turns smoothing off (false), on with the defaults (true), or on with
  // { minCutoff, beta } for the One Euro filter, in normalized image coordinates.
  setSmoothing(smoothing) {
    this.landmarkFilter = null;
    if (!smoothing) return;
    const { minCutoff, beta } = { ...SMOOTHING, ...(smoothing === true ? {} : smoothing) };
    this.landmarkFilter = new OneEuroFilter({ minCutoff, beta });
    // The pose filters work in centimeters and radians, which move about 80 and 8 times
    // more than normalized coordinates for the same motion of the face.
    this.positionFilter = new OneEuroFilter({ minCutoff, beta: beta / 80 });
    this.rotationFilter = { minCutoff, beta: beta / 8 };
    this.smoothedRotation = null;
  }

  // Forgets the smoothing history, for instance when the geometry starts following another face.
  resetSmoothing() {
    if (!this.landmarkFilter) return;
    this.landmarkFilter.reset();
    this.positionFilter.reset();
    this.smoothedRotation = null;
  }

  // Updates from a FaceLandmarkerResult, reading the landmarks, blendshapes and
  // transformation matrix of the face at `index`. Returns false if there's no such face.
  updateFromResult(result, { index = 0, flipped = false, timestamp } = {}) {
    const landmarks = result.faceLandmarks[index];
    if (!landmarks) return false;
    const matrices = result.facialTransformationMatrixes;
    this.update(landmarks, flipped, matrices && matrices[index], timestamp);
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
  // Metric mode also needs the face's facial transformation matrix. `timestamp`, in
  // milliseconds, drives the smoothing; it defaults to now.
  update(face, flipped = false, transformationMatrix, timestamp = performance.now()) {
    const normalized = Array.isArray(face);
    const source = normalized ? face : face.keypoints;
    if (!source || source.length < NUM_VERTICES) {
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

    const time = timestamp / 1000;
    const landmarks = this.normalizeInput(source, normalized, time);
    if (this.metric) {
      this.setPose(landmarks, transformationMatrix, time);
    }

    for (let j = 0; j < NUM_VERTICES; j++) {
      this.landmarkToPosition(landmarks[j], point).toArray(this.positions, j * 3);
      if (this.useVideoTexture) {
        this.uvs[j * 2] = landmarks[j].x;
        this.uvs[j * 2 + 1] = 1 - landmarks[j].y;
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

  // Copies the landmarks into normalized image coordinates, and smooths them.
  normalizeInput(source, normalized, time) {
    const sx = normalized ? 1 : 1 / this.w;
    const sy = normalized ? 1 : 1 / this.h;
    const count = source.length;
    while (this.input.length < count) this.input.push({ x: 0, y: 0, z: 0 });
    this.input.length = count;
    if (!this.landmarkFilter) {
      for (let j = 0; j < count; j++) {
        const l = source[j];
        const p = this.input[j];
        p.x = l.x * sx;
        p.y = l.y * sy;
        p.z = l.z * sx;
      }
      return this.input;
    }
    if (!this.filterBuffer || this.filterBuffer.length !== count * 3) {
      this.filterBuffer = new Float64Array(count * 3);
    }
    const values = this.filterBuffer;
    for (let j = 0; j < count; j++) {
      const l = source[j];
      values[j * 3] = l.x * sx;
      values[j * 3 + 1] = l.y * sy;
      values[j * 3 + 2] = l.z * sx;
    }
    this.landmarkFilter.filter(values, time);
    for (let j = 0; j < count; j++) {
      const p = this.input[j];
      p.x = values[j * 3];
      p.y = values[j * 3 + 1];
      p.z = values[j * 3 + 2];
    }
    return this.input;
  }

  setPose(landmarks, transformationMatrix, time) {
    const data = transformationMatrix.data || transformationMatrix.elements;
    this.pose.fromArray(data);
    if (this.landmarkFilter) {
      this.smoothPose(time);
    }
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

  // Filters the position and rotation of the pose separately: a One Euro filter on the
  // position, and the same idea on the rotation, slerping by a factor set by its angular speed.
  smoothPose(time) {
    this.pose.decompose(posePosition, poseRotation, poseScale);
    const p = this.positionFilter.filter(posePosition.toArray(), time);
    posePosition.fromArray(p);
    if (!this.smoothedRotation) {
      this.smoothedRotation = poseRotation.clone();
      this.rotationSpeed = 0;
      this.rotationTime = time;
    } else if (time > this.rotationTime) {
      const dt = time - this.rotationTime;
      this.rotationTime = time;
      const speed = this.smoothedRotation.angleTo(poseRotation) / dt;
      this.rotationSpeed += smoothingFactor(dt, 1) * (speed - this.rotationSpeed);
      const { minCutoff, beta } = this.rotationFilter;
      const cutoff = minCutoff + beta * this.rotationSpeed;
      this.smoothedRotation.slerp(poseRotation, smoothingFactor(dt, cutoff));
    }
    this.pose.compose(posePosition, this.smoothedRotation, poseScale);
  }

  landmarkToPosition(l, target) {
    const { w, h } = this;
    const x = l.x * w;
    const y = l.y * h;
    const z = l.z * w;
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

export { FaceMeshFaceGeometry, METRIC_CAMERA_FOV, OneEuroFilter };
export { FACES, UVS, CANONICAL } from "./geometry.js";
