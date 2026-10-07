import {
  WebGLRenderer,
  Scene,
  DirectionalLight,
  PerspectiveCamera,
  HemisphereLight,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
  DoubleSide,
  Object3D,
  PCFShadowMap,
  SRGBColorSpace,
  TextureLoader,
} from "three";
import { FaceMeshFaceGeometry, METRIC_CAMERA_FOV } from "../../js/face.js";
import { createGlasses, createClownNose } from "../accessories.js";
import { createFaceLandmarker } from "../landmarker.js";
import { createGUI, addMirrorToggle, addSmoothingToggle, signal } from "../gui.js";

const av = document.querySelector("gum-av");
const canvas = document.querySelector("canvas");
const status = document.querySelector("#status");

const renderer = new WebGLRenderer({ antialias: true, alpha: true, canvas });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFShadowMap;

const scene = new Scene();

// Metric mode works in centimeters, seen by a camera at the origin with MediaPipe's field of view.
const camera = new PerspectiveCamera(METRIC_CAMERA_FOV, 1, 1, 1000);

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
  camera.aspect = videoAspectRatio;
  camera.updateProjectionMatrix();
}

window.addEventListener("resize", () => {
  resize();
});

// Create a new geometry helper in metric mode, so it lines up with the face pose.
const faceGeometry = new FaceMeshFaceGeometry({ metric: true });

// Occluders only write depth, hiding whatever is behind the face and head.
const occluderMaterial = new MeshBasicMaterial({ colorWrite: false });
const wireframeMaterial = new MeshBasicMaterial({
  color: 0xff00ff,
  wireframe: true,
});

// Load textures for the solid mask material.
const loader = new TextureLoader();
const colorTexture = loader.load("../../assets/mesh_map.jpg");
colorTexture.colorSpace = SRGBColorSpace;
const aoTexture = loader.load("../../assets/ao.jpg");
const alphaTexture = loader.load("../../assets/mask.png");

const maskMaterial = new MeshStandardMaterial({
  color: 0xbcbcbc,
  roughness: 0.8,
  metalness: 0.1,
  alphaMap: alphaTexture,
  aoMap: aoTexture,
  map: colorTexture,
  roughnessMap: colorTexture,
  transparent: true,
  side: DoubleSide,
});

const face = new Mesh(faceGeometry, occluderMaterial);
face.renderOrder = -1;
face.receiveShadow = true;
scene.add(face);

// Everything in this group is placed in the canonical face space, in centimeters.
const head = new Group();
head.matrixAutoUpdate = false;
scene.add(head);

const skull = new Mesh(new SphereGeometry(1, 32, 16), occluderMaterial);
skull.scale.set(7.3, 10, 9);
skull.position.set(0, 1.5, -3.5);
skull.renderOrder = -1;
head.add(skull);

const glasses = createGlasses();
head.add(glasses);

const nose = createClownNose();
head.add(nose);

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

// How to draw the face: invisible but hiding what's behind it, solid, or wireframe to debug the fit.
const faceMode = signal("hidden");
const showGlasses = signal(true);
const showNose = signal(true);

const gui = createGUI();
gui.addSegmented("Face", faceMode, [
  ["hidden", "Hidden"],
  ["mask", "Mask"],
  ["wireframe", "Wireframe"],
]);
gui.addCheckbox("Glasses", showGlasses);
gui.addCheckbox("Nose", showNose);
const flipCamera = addMirrorToggle(gui, av);
addSmoothingToggle(gui, faceGeometry);

async function render(landmarker) {
  // Wait for video to be ready (loadeddata).
  await av.ready();


  // Resize the camera and geometry to the video dimensions if necessary.
  if (width !== av.video.videoWidth || height !== av.video.videoHeight) {
    width = av.video.videoWidth;
    height = av.video.videoHeight;
    resize();
    faceGeometry.setSize(width, height);
  }

  // Detect the face landmarks and pose in the current video frame.
  const result = landmarker.detectForVideo(av.video, performance.now());

  av.style.opacity = 1;
  status.textContent = "";

  const found = faceGeometry.updateFromResult(result, {
    flipped: flipCamera(),
  });
  face.visible = head.visible = found;
  if (found) {
    head.matrix.copy(faceGeometry.pose);
    head.matrixWorldNeedsUpdate = true;
    light.target.position.setFromMatrixPosition(head.matrix);
    light.position.copy(light.target.position).addScaledVector(lightDirection, 50);
  }

  const mode = faceMode();
  face.material =
    mode === "mask"
      ? maskMaterial
      : mode === "wireframe"
      ? wireframeMaterial
      : occluderMaterial;
  skull.material = mode === "wireframe" ? wireframeMaterial : occluderMaterial;
  glasses.visible = showGlasses();
  nose.visible = showNose();

  renderer.render(scene, camera);

  requestAnimationFrame(() => render(landmarker));
}

// Init the demo, loading dependencies.
async function init() {
  try {
    await av.ready();
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
