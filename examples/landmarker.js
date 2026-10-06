import {
  FaceLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/vision_bundle.mjs";

const WASM_PATH =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm";
const MODEL_PATH =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

// Creates a MediaPipe FaceLandmarker, falling back to the CPU without WebGL2.
async function createFaceLandmarker({ numFaces = 1, runningMode = "VIDEO" } = {}) {
  const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
  const options = (delegate) => ({
    baseOptions: { modelAssetPath: MODEL_PATH, delegate },
    runningMode,
    numFaces,
  });
  try {
    return await FaceLandmarker.createFromOptions(fileset, options("GPU"));
  } catch (e) {
    console.warn("GPU delegate unavailable, using CPU.", e);
    return FaceLandmarker.createFromOptions(fileset, options("CPU"));
  }
}

export { createFaceLandmarker };
