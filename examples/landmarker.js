import {
  FaceLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/vision_bundle.mjs";

const WASM_PATH =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm";
const MODEL_PATH =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

// Creates a MediaPipe FaceLandmarker, falling back to the CPU without WebGL2.
// Other FaceLandmarkerOptions, like outputFaceBlendshapes, are passed through.
async function createFaceLandmarker({
  numFaces = 1,
  runningMode = "VIDEO",
  ...rest
} = {}) {
  const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
  const options = (delegate) => ({
    baseOptions: { modelAssetPath: MODEL_PATH, delegate },
    runningMode,
    numFaces,
    ...rest,
  });
  try {
    return await FaceLandmarker.createFromOptions(fileset, options("GPU"));
  } catch (e) {
    console.warn("GPU delegate unavailable, using CPU.", e);
    return FaceLandmarker.createFromOptions(fileset, options("CPU"));
  }
}

// Counts the frames a video presents, where the browser can tell.
const frameCounts = new WeakMap();
function frameCount(video) {
  if (!video.requestVideoFrameCallback) return null;
  if (!frameCounts.has(video)) {
    frameCounts.set(video, 0);
    const tick = () => {
      frameCounts.set(video, frameCounts.get(video) + 1);
      video.requestVideoFrameCallback(tick);
    };
    video.requestVideoFrameCallback(tick);
  }
  return frameCounts.get(video);
}

// Runs the landmarker once per video frame. The render loop follows the display, often
// two or four times faster than the camera, and a frame's landmarks don't change.
const lastResults = new WeakMap();
function detectVideoFrame(landmarker, video) {
  const frame = frameCount(video);
  const last = lastResults.get(landmarker);
  if (frame !== null && last?.frame === frame && last.video === video) return last.result;
  const result = landmarker.detectForVideo(video, performance.now());
  lastResults.set(landmarker, { frame, video, result });
  return result;
}

export { createFaceLandmarker, detectVideoFrame };
