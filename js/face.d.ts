import { BufferGeometry, Matrix4, Vector3 } from "three";

export { FACES, UVS, CANONICAL } from "./geometry.js";

/** Vertical field of view, in degrees, of the camera MediaPipe's transformation matrices assume. */
export declare const METRIC_CAMERA_FOV: number;

/** A landmark from MediaPipe's FaceLandmarker, in normalized image coordinates. */
export interface NormalizedLandmark {
  x: number;
  y: number;
  z: number;
}

/** A face from @tensorflow-models/face-landmarks-detection, in pixels. */
export interface KeypointsFace {
  keypoints: { x: number; y: number; z: number }[];
}

/** A MediaPipe Matrix ({ rows, columns, data }, column-major) or a three.js Matrix4. */
export type TransformationMatrix = { data: number[] } | Matrix4;

/** The parts of a MediaPipe FaceLandmarkerResult the helper reads. */
export interface FaceLandmarkerResult {
  faceLandmarks: NormalizedLandmark[][];
  faceBlendshapes?: { categories: { categoryName: string; score: number }[] }[];
  facialTransformationMatrixes?: { rows: number; columns: number; data: number[] }[];
}

export interface Iris {
  position: Vector3;
  radius: number;
}

export interface FaceMeshFaceGeometryOptions {
  /** Texture coordinates that sample the input video instead of the canonical layout. */
  useVideoTexture?: boolean;
  /** Center the mesh and scale it so the input's height is 1 unit. */
  normalizeCoords?: boolean;
  /** Vertices in centimeters for a perspective camera, with the head pose. */
  metric?: boolean;
  /** Smooth the landmarks and pose with a One Euro filter: true for the defaults, or its parameters. */
  smoothing?: boolean | SmoothingOptions;
}

export interface SmoothingOptions {
  /** Cutoff frequency at rest, in Hz: lower is smoother. Defaults to 0.5. */
  minCutoff?: number;
  /** How fast the cutoff rises with speed, in normalized image coordinates: higher lags less. Defaults to 40. */
  beta?: number;
}

/** One Euro filter (Casiez et al. 2012) over arrays of values. */
export declare class OneEuroFilter {
  constructor(options?: { minCutoff?: number; beta?: number; dCutoff?: number });
  minCutoff: number;
  beta: number;
  dCutoff: number;
  reset(): void;
  /** Filters `values` in place at `time`, in seconds, and returns them. */
  filter<T extends ArrayLike<number> & { [index: number]: number }>(values: T, time: number): T;
}

export declare class FaceMeshFaceGeometry extends BufferGeometry {
  constructor(options?: FaceMeshFaceGeometryOptions);

  useVideoTexture: boolean;
  normalizeCoords: boolean;
  metric: boolean;
  flipped: boolean;
  positions: Float32Array;
  uvs: Float32Array;
  /** Canonical face to camera space, in centimeters. Metric mode only. */
  pose: Matrix4;
  rightIris: Iris;
  leftIris: Iris;
  hasIrises: boolean;
  /** Blendshape scores, from 0 to 1, by name. */
  blendshapes: Record<string, number>;

  /** Sets the size of the input, to frame the coordinates. */
  setSize(width: number, height: number): void;

  /** Turns smoothing off, on with the defaults, or on with these parameters. */
  setSmoothing(smoothing: boolean | SmoothingOptions | undefined): void;

  /** Forgets the smoothing history, for instance when following another face. */
  resetSmoothing(): void;

  /** Updates from the face at `index` of a result. Returns false if there's no such face. */
  updateFromResult(
    result: FaceLandmarkerResult,
    options?: { index?: number; flipped?: boolean; timestamp?: number }
  ): boolean;

  /** Updates the vertices and normals from one face's landmarks. */
  update(
    face: NormalizedLandmark[] | KeypointsFace,
    flipped?: boolean,
    transformationMatrix?: TransformationMatrix,
    /** In milliseconds, for the smoothing. Defaults to performance.now(). */
    timestamp?: number
  ): void;

  /** Center, normal and orthogonal basis of the triangle between three vertices. */
  track(
    id0: number,
    id1: number,
    id2: number
  ): { position: Vector3; normal: Vector3; rotation: Matrix4 };
}
