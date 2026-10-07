import {
  WebGLRenderer,
  Scene,
  PerspectiveCamera,
  DirectionalLight,
  HemisphereLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  BoxGeometry,
  SphereGeometry,
  CylinderGeometry,
  TorusKnotGeometry,
  LineSegments,
  EdgesGeometry,
  LineBasicMaterial,
  BufferGeometry,
  Float32BufferAttribute,
  Vector3,
  Color,
  PCFShadowMap,
} from "three";
import { FaceMeshFaceGeometry } from "../../js/face.js";
import { createFaceLandmarker } from "../landmarker.js";
import { createGUI, addSmoothingToggle, signal } from "../gui.js";

const av = document.querySelector("gum-av");
const canvas = document.querySelector("canvas");
const status = document.querySelector("#status");

const renderer = new WebGLRenderer({ antialias: true, canvas });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFShadowMap;

// The scene is in centimeters, with the screen on the z = 0 plane, centered on the origin,
// and the room behind it. The camera sits where the viewer's eyes are.
const scene = new Scene();
scene.background = new Color(0x0d0d10);
const camera = new PerspectiveCamera();
camera.matrixAutoUpdate = false;

// The physical size of a CSS pixel, in centimeters: from a card calibration saved in this
// browser, or the nominal 96 pixels per inch until there's one.
const STORAGE_KEY = "face-mesh-face-geometry:cm-per-pixel";
let cmPerPixel = 2.54 / 96;
try {
  const saved = parseFloat(localStorage.getItem(STORAGE_KEY));
  if (saved > 0) cmPerPixel = saved;
} catch (e) {
  // Storage can be unavailable, in private windows for instance.
}

function saveScale(value) {
  cmPerPixel = value;
  try {
    localStorage.setItem(STORAGE_KEY, String(value));
  } catch (e) {
    // Then the calibration only lasts until the page reloads.
  }
}

const screenWidth = signal(window.innerWidth * cmPerPixel);
const roomDepth = 40;
let screenHeight = 0;

// The page fills the window, so its width in centimeters follows the window's size.
function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  screenWidth.set(window.innerWidth * cmPerPixel);
  screenHeight = (screenWidth() * window.innerHeight) / window.innerWidth;
  buildRoom();
}

window.addEventListener("resize", () => {
  resize();
});

// Metric mode gives the head in centimeters from the webcam.
const faceGeometry = new FaceMeshFaceGeometry({ metric: true });

const room = new Group();
scene.add(room);

const lineMaterial = new LineBasicMaterial({ color: 0x3a6ea5 });

// Grid lines on the four walls and the back of a box behind the screen.
function roomGrid(w, h, d, step) {
  const points = [];
  const line = (a, b) => points.push(...a, ...b);
  for (let z = 0; z >= -d; z -= step) {
    line([-w / 2, -h / 2, z], [w / 2, -h / 2, z]);
    line([-w / 2, h / 2, z], [w / 2, h / 2, z]);
    line([-w / 2, -h / 2, z], [-w / 2, h / 2, z]);
    line([w / 2, -h / 2, z], [w / 2, h / 2, z]);
  }
  for (let x = -w / 2; x <= w / 2 + 0.01; x += w / 8) {
    line([x, -h / 2, 0], [x, -h / 2, -d]);
    line([x, h / 2, 0], [x, h / 2, -d]);
    line([x, -h / 2, -d], [x, h / 2, -d]);
  }
  for (let y = -h / 2; y <= h / 2 + 0.01; y += h / 6) {
    line([-w / 2, y, 0], [-w / 2, y, -d]);
    line([w / 2, y, 0], [w / 2, y, -d]);
    line([-w / 2, y, -d], [w / 2, y, -d]);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(points, 3));
  return new LineSegments(geometry, lineMaterial);
}

// Targets on stands at different depths, and one floating in front of the screen.
const targets = [];
function target(color, x, y, z, radius) {
  const material = new MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.1 });
  const group = new Group();
  const ball = new Mesh(new SphereGeometry(radius, 32, 16), material);
  ball.castShadow = true;
  group.add(ball);
  group.position.set(x, y, z);
  targets.push(group);
  return group;
}

const floorMaterial = new MeshStandardMaterial({ color: 0x15151b, roughness: 0.9 });

function buildRoom() {
  room.clear();
  targets.length = 0;
  const w = screenWidth();
  const h = screenHeight;
  room.add(roomGrid(w, h, roomDepth, roomDepth / 8));

  const floor = new Mesh(new BoxGeometry(w, 0.1, roomDepth), floorMaterial);
  floor.position.set(0, -h / 2 - 0.05, -roomDepth / 2);
  floor.receiveShadow = true;
  room.add(floor);

  const r = Math.min(w, h) * 0.06;
  room.add(
    target(0xff6347, -w * 0.28, -h * 0.15, -roomDepth * 0.8, r),
    target(0x40c0ff, w * 0.25, h * 0.1, -roomDepth * 0.45, r),
    target(0xffc040, -w * 0.05, -h * 0.25, -roomDepth * 0.15, r * 0.8),
    target(0x80e080, w * 0.12, h * 0.22, 6, r * 0.6)
  );

  const knot = new Mesh(
    new TorusKnotGeometry(r * 1.2, r * 0.35, 128, 16),
    new MeshStandardMaterial({ color: 0xdddddd, roughness: 0.3, metalness: 0.6 })
  );
  knot.position.set(w * 0.05, h * 0.05, -roomDepth * 0.6);
  knot.castShadow = true;
  knot.name = "knot";
  room.add(knot);

  // Stands from the floor up to the targets behind the screen.
  for (const t of targets) {
    if (t.position.z > 0) continue;
    const height = t.position.y + h / 2;
    const stand = new Mesh(new CylinderGeometry(0.15, 0.15, height, 8), floorMaterial);
    stand.position.set(t.position.x, -h / 2 + height / 2, t.position.z);
    stand.castShadow = true;
    room.add(stand);
  }
}

const light = new DirectionalLight(0xffffff, 2.5);
light.position.set(10, 30, 20);
light.castShadow = true;
light.shadow.mapSize.set(1024, 1024);
light.shadow.camera.left = light.shadow.camera.bottom = -40;
light.shadow.camera.right = light.shadow.camera.top = 40;
light.shadow.camera.far = 120;
scene.add(light);
scene.add(new HemisphereLight(0xffffff, 0x202030, 1));

// How far the webcam sits above the top edge of the screen, in centimeters.
const cameraOffset = signal(1);
const showCamera = signal(true);

// A cube half in and half out of the screen, with a pole through it: when the screen
// width is right they stay put in space as you move your head.
const calibrationAid = new Group();
calibrationAid.visible = false;
scene.add(calibrationAid);
{
  const material = new LineBasicMaterial({ color: 0xffffff });
  const cube = new LineSegments(new EdgesGeometry(new BoxGeometry(8, 8, 8)), material);
  const pole = new Mesh(
    new CylinderGeometry(0.25, 0.25, 30, 12).rotateX(Math.PI / 2),
    new MeshStandardMaterial({ color: 0xff6347, roughness: 0.4 })
  );
  pole.position.z = -5;
  calibrationAid.add(cube, pole);
}

const showCheck = signal(false);

const gui = createGUI();
gui.addButton("Calibrate with a card…", () => openCalibration());
gui.addSlider("Screen width (cm)", screenWidth, 10, 150, 0.1, {
  onChange: (value) => {
    saveScale(value / window.innerWidth);
    resize();
  },
  title: "The physical width of the page, so the room has the right size and depth",
});
gui.addCheckbox("Calibration check", showCheck, {
  title:
    "Move your head side to side: the cube and the pole should stay put. If they slide the way you move, increase the screen width; if they slide the other way, decrease it.",
});
gui.addSlider("Webcam above screen (cm)", cameraOffset, 0, 10, 0.5);
gui.addCheckbox("Camera preview", showCamera);
addSmoothingToggle(gui, faceGeometry);

// Where the viewer's eyes are, relative to the center of the screen, in centimeters.
const eye = new Vector3(0, 0, 60);
const eyeTarget = new Vector3();

// Builds an off-axis projection for an eye looking through the screen rectangle on z = 0.
function updateCamera() {
  const w = screenWidth();
  const h = screenHeight;
  const near = 1;
  const far = 1000;
  const s = near / eye.z;
  camera.projectionMatrix.makePerspective(
    (-w / 2 - eye.x) * s,
    (w / 2 - eye.x) * s,
    (h / 2 - eye.y) * s,
    (-h / 2 - eye.y) * s,
    near,
    far
  );
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  camera.matrix.makeTranslation(eye.x, eye.y, eye.z);
  camera.matrixWorld.copy(camera.matrix);
  camera.matrixWorldInverse.copy(camera.matrix).invert();
}

let width = 0;
let height = 0;

async function render(landmarker) {
  // Wait for video to be ready (loadeddata).
  await av.ready();

  av.style.opacity = showCamera() ? 1 : 0;

  if (width !== av.video.videoWidth || height !== av.video.videoHeight) {
    width = av.video.videoWidth;
    height = av.video.videoHeight;
    faceGeometry.setSize(width, height);
  }

  const result = landmarker.detectForVideo(av.video, performance.now());
  status.textContent = "";

  // Mirrored, so that moving to your right moves the eye to the right of the screen.
  if (
    faceGeometry.updateFromResult(result, { flipped: true }) &&
    faceGeometry.hasIrises
  ) {
    eyeTarget
      .copy(faceGeometry.rightIris.position)
      .add(faceGeometry.leftIris.position)
      .multiplyScalar(0.5);
    // The webcam is the origin; the screen's center is below it.
    eye.set(eyeTarget.x, eyeTarget.y + screenHeight / 2 + cameraOffset(), -eyeTarget.z);
  }

  calibrationAid.visible = showCheck();

  const knot = room.getObjectByName("knot");
  if (knot) knot.rotation.y = performance.now() / 2000;

  updateCamera();
  renderer.render(scene, camera);

  requestAnimationFrame(() => render(landmarker));
}

// Card calibration: every bank card is 8.56 x 5.398 cm, so matching an outline to one tells
// how big a CSS pixel is on this screen.
const CARD_WIDTH = 8.56;
const CARD_HEIGHT = 5.398;
const calibration = document.querySelector("#calibration");
const card = calibration.querySelector(".card");
const cardSize = calibration.querySelector("input");

function setCardWidth(px) {
  const w = Math.min(Math.max(px, 120), window.innerWidth * 0.9);
  card.style.width = `${w}px`;
  card.style.height = `${(w * CARD_HEIGHT) / CARD_WIDTH}px`;
  card.style.borderRadius = `${(w * 0.318) / CARD_WIDTH}px`;
  cardSize.value = w;
}

function openCalibration() {
  cardSize.max = Math.round(window.innerWidth * 0.9);
  setCardWidth(CARD_WIDTH / cmPerPixel);
  calibration.hidden = false;
}

cardSize.addEventListener("input", () => setCardWidth(parseFloat(cardSize.value)));

// Dragging the corner resizes the card around its center.
const handle = calibration.querySelector(".handle");
handle.addEventListener("pointerdown", (e) => {
  handle.setPointerCapture(e.pointerId);
  const startX = e.clientX;
  const startWidth = card.getBoundingClientRect().width;
  const move = (m) => setCardWidth(startWidth + 2 * (m.clientX - startX));
  const up = () => {
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", up);
  };
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", up);
});

calibration.querySelector("#calibration-done").addEventListener("click", () => {
  saveScale(CARD_WIDTH / card.getBoundingClientRect().width);
  resize();
  calibration.hidden = true;
});
calibration.querySelector("#calibration-cancel").addEventListener("click", () => {
  calibration.hidden = true;
});

// Init the demo, loading dependencies.
async function init() {
  resize();
  updateCamera();
  renderer.render(scene, camera);
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
