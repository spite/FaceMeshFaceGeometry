import {
  WebGLRenderer,
  PCFShadowMap,
  SRGBColorSpace,
  Scene,
  DirectionalLight,
  PerspectiveCamera,
  HemisphereLight,
  Object3D,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  VideoTexture,
  MeshStandardMaterial,
  Vector3,
} from "three";
import { FaceMeshFaceGeometry, METRIC_CAMERA_FOV } from "../../js/face.js";
import { OrbitControls } from "../../third_party/OrbitControls.js";
import { createFaceLandmarker } from "../landmarker.js";
import { createGUI, addMirrorToggle, addSmoothingToggle, signal } from "../gui.js";
import { createGlasses, createClownNose } from "../accessories.js";

const av = document.querySelector("gum-av");
const canvas = document.querySelector("canvas");
const status = document.querySelector("#status");

// Set a background color, or change alpha to false for a solid canvas.
const renderer = new WebGLRenderer({ antialias: true, alpha: true, canvas });
// renderer.setClearColor(0x202020);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFShadowMap;

const scene = new Scene();

// Metric mode works in centimeters, seen by a camera at the origin with MediaPipe's field of view.
const camera = new PerspectiveCamera(METRIC_CAMERA_FOV, 1, 1, 1000);

// Camera to orbit around the face, enabled from the panel. It's placed when the face is first found.
const debugCamera = new PerspectiveCamera(50, 1, 1, 1000);
const controls = new OrbitControls(debugCamera, renderer.domElement);
controls.enabled = false;
const orbitOffset = new Vector3(18, 6, 26);
let orbitPlaced = false;

let width = 0;
let height = 0;

function resize() {
  const videoAspectRatio = width / height;
  const windowWidth = window.innerWidth;
  const windowHeight = window.innerHeight;
  const windowAspectRatio = windowWidth / windowHeight;
  let adjustedWidth;
  let adjustedHeight;
  if (videoAspectRatio > windowAspectRatio) {
    adjustedWidth = windowWidth;
    adjustedHeight = windowWidth / videoAspectRatio;
  } else {
    adjustedWidth = windowHeight * videoAspectRatio;
    adjustedHeight = windowHeight;
  }
  renderer.setSize(adjustedWidth, adjustedHeight);
  camera.aspect = debugCamera.aspect = videoAspectRatio;
  camera.updateProjectionMatrix();
  debugCamera.updateProjectionMatrix();
}

window.addEventListener("resize", () => {
  resize();
});

// Create wireframe material for debugging.
const wireframeMaterial = new MeshBasicMaterial({
  color: 0xff00ff,
  wireframe: true,
});

// Create material for mask.
const material = new MeshStandardMaterial({
  color: 0xffffff,
  roughness: 0.7,
  metalness: 0.0,
  map: null, // Will be created when the video is ready.
  side: DoubleSide,
});

// Create a new geometry helper in metric mode, with texture coordinates from the same video as the model input.
const faceGeometry = new FaceMeshFaceGeometry({
  metric: true,
  useVideoTexture: true,
});

// Create mask mesh.
const mask = new Mesh(faceGeometry, material);
scene.add(mask);
mask.receiveShadow = mask.castShadow = true;

// Glasses and a clown nose, placed on the canonical face and moved by the head pose.
const head = new Group();
head.matrixAutoUpdate = false;
head.add(createGlasses(), createClownNose());
scene.add(head);

// Add lights. The key light follows the head, so its shadow camera stays around the face.
const light = new DirectionalLight(0xffffff, 2);
const lightDirection = new Vector3(0.5, 1, 1).normalize();
light.target = new Object3D();
light.castShadow = true;
light.shadow.mapSize.set(1024, 1024);
light.shadow.camera.left = light.shadow.camera.bottom = -15;
light.shadow.camera.right = light.shadow.camera.top = 15;
light.shadow.camera.near = 1;
light.shadow.camera.far = 100;
light.shadow.bias = -0.002;
scene.add(light, light.target);

const hemiLight = new HemisphereLight(0xffffff, 0x404040, 1.5);
scene.add(hemiLight);

const headPosition = new Vector3();

const wireframe = signal(false);
const orbit = signal(true);

const gui = createGUI();
gui.addCheckbox("Wireframe", wireframe);
const flipCamera = addMirrorToggle(gui, av);
addSmoothingToggle(gui, faceGeometry);
gui.addCheckbox("Orbit camera", orbit, { title: "Drag to look at the face mesh from any side" });

async function render(landmarker) {
  // Wait for video to be ready (loadeddata).
  await av.ready();

  av.video.style.display = "none";
  av.style.opacity = 1;

  // Resize the cameras and geometry to the video dimensions if necessary.
  if (width !== av.video.videoWidth || height !== av.video.videoHeight) {
    width = av.video.videoWidth;
    height = av.video.videoHeight;
    resize();
    faceGeometry.setSize(width, height);
  }

  // Detect the face landmarks and pose in the current video frame.
  const result = landmarker.detectForVideo(av.video, performance.now());

  status.textContent = "";

  const found = faceGeometry.updateFromResult(result, {
    flipped: flipCamera(),
  });
  mask.visible = head.visible = found;
  if (found) {
    head.matrix.copy(faceGeometry.pose);
    head.matrixWorldNeedsUpdate = true;
    headPosition.setFromMatrixPosition(head.matrix);
    light.target.position.copy(headPosition);
    light.position.copy(headPosition).addScaledVector(lightDirection, 50);

    // The orbit camera circles the head, and moves along with it.
    if (!orbitPlaced) {
      orbitPlaced = true;
      controls.target.copy(headPosition);
      debugCamera.position.copy(headPosition).add(orbitOffset);
    } else {
      debugCamera.position.add(headPosition).sub(controls.target);
      controls.target.copy(headPosition);
    }
    controls.update();
  }

  if (wireframe()) {
    // Render the mask.
    renderer.autoClear = true;
    renderer.render(scene, orbit() ? debugCamera : camera);
    // Prevent renderer from clearing the color buffer.
    renderer.autoClear = false;
    renderer.clear(false, true, false);
    mask.material = wireframeMaterial;
    // Render again with the wireframe material.
    renderer.render(scene, orbit() ? debugCamera : camera);
    mask.material = material;
    renderer.autoClear = true;
  } else {
    // Render the scene normally.
    renderer.render(scene, orbit() ? debugCamera : camera);
  }

  controls.enabled = orbit();

  requestAnimationFrame(() => render(landmarker));
}

// Init the demo, loading dependencies.
async function init() {
  try {
    await av.ready();
    const videoTexture = new VideoTexture(av.video);
    videoTexture.colorSpace = SRGBColorSpace;
    material.map = videoTexture;
    status.textContent = "Loading model...";
    const landmarker = await createFaceLandmarker({
      numFaces: 1,
      outputFacialTransformationMatrixes: true,
    });
    status.textContent = "Detecting face...";
    render(landmarker);
  } catch (e) {
    status.textContent = e.message;
    throw e;
  }
}

init();
