import {
  WebGLRenderer,
  Scene,
  DirectionalLight,
  HemisphereLight,
  OrthographicCamera,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
} from "three";
import { FaceMeshFaceGeometry } from "../../js/face.js";
import { createFaceLandmarker } from "../landmarker.js";
import { createGUI, addMirrorToggle, addSmoothingToggle, signal } from "../gui.js";

const av = document.querySelector("gum-av");
const canvas = document.querySelector("canvas");
const status = document.querySelector("#status");

const renderer = new WebGLRenderer({ antialias: true, alpha: true, canvas });
renderer.setPixelRatio(window.devicePixelRatio);

const scene = new Scene();
const camera = new OrthographicCamera(1, 1, 1, 1, -1000, 1000);

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
}

window.addEventListener("resize", () => {
  resize();
});

// Create a new geometry helper.
const faceGeometry = new FaceMeshFaceGeometry();

// The face only writes depth, so bubbles go behind it as they leave the mouth.
const face = new Mesh(faceGeometry, new MeshBasicMaterial({ colorWrite: false }));
face.renderOrder = -1;
scene.add(face);

// Add lights.
const light = new DirectionalLight(0xffffff, 2);
light.position.set(0.5, 1, 1);
scene.add(light);

const hemiLight = new HemisphereLight(0xffffff, 0x404040, 1.5);
scene.add(hemiLight);

// Pool of bubbles blown from the mouth.
const bubbleGeometry = new SphereGeometry(1, 24, 12);
const bubbles = [];
for (let i = 0; i < 80; i++) {
  const bubble = new Mesh(
    bubbleGeometry,
    new MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.1,
      metalness: 0.3,
      transparent: true,
    })
  );
  bubble.visible = false;
  bubble.userData.velocity = new Vector3();
  scene.add(bubble);
  bubbles.push(bubble);
}

const mouth = new Vector3();
const upperLip = new Vector3();
const lowerLip = new Vector3();
let nextBubble = 0;
let spawnBudget = 0;

function updateBubbles(dt, shapes) {
  const jawOpen = shapes.jawOpen || 0;
  // Blow more bubbles the wider the mouth opens.
  if (jawOpen > 0.3) {
    spawnBudget += dt * 30 * jawOpen;
  }
  while (spawnBudget >= 1) {
    spawnBudget--;
    const bubble = bubbles[nextBubble];
    nextBubble = (nextBubble + 1) % bubbles.length;
    bubble.position.copy(mouth);
    bubble.userData.velocity.set(
      (Math.random() - 0.5) * 200,
      50 + Math.random() * 150,
      200
    );
    // Puckered lips blow bigger bubbles.
    bubble.userData.size = (4 + Math.random() * 8) * (1 + 2 * (shapes.mouthPucker || 0));
    bubble.userData.age = 0;
    bubble.material.color.setHSL(Math.random(), 0.8, 0.7);
    bubble.visible = true;
  }
  for (const bubble of bubbles) {
    if (!bubble.visible) continue;
    const { velocity, size } = bubble.userData;
    bubble.userData.age += dt;
    const life = bubble.userData.age / 2;
    if (life >= 1) {
      bubble.visible = false;
      continue;
    }
    bubble.position.addScaledVector(velocity, dt);
    bubble.scale.setScalar(size * Math.min(1, life * 8));
    bubble.material.opacity = 0.8 * (1 - life);
  }
}

// MediaPipe's blendshapes, grouped for the panel. "Left" and "Right" are the person's sides.
const BLENDSHAPES = {
  Jaw: ["jawOpen", "jawForward", "jawLeft", "jawRight"],
  Mouth: [
    "mouthClose",
    "mouthFunnel",
    "mouthPucker",
    "mouthLeft",
    "mouthRight",
    "mouthSmileLeft",
    "mouthSmileRight",
    "mouthFrownLeft",
    "mouthFrownRight",
    "mouthDimpleLeft",
    "mouthDimpleRight",
    "mouthStretchLeft",
    "mouthStretchRight",
    "mouthRollLower",
    "mouthRollUpper",
    "mouthShrugLower",
    "mouthShrugUpper",
    "mouthPressLeft",
    "mouthPressRight",
    "mouthLowerDownLeft",
    "mouthLowerDownRight",
    "mouthUpperUpLeft",
    "mouthUpperUpRight",
  ],
  Eyes: [
    "eyeBlinkLeft",
    "eyeBlinkRight",
    "eyeWideLeft",
    "eyeWideRight",
    "eyeSquintLeft",
    "eyeSquintRight",
    "eyeLookUpLeft",
    "eyeLookUpRight",
    "eyeLookDownLeft",
    "eyeLookDownRight",
    "eyeLookInLeft",
    "eyeLookInRight",
    "eyeLookOutLeft",
    "eyeLookOutRight",
  ],
  Brows: [
    "browInnerUp",
    "browDownLeft",
    "browDownRight",
    "browOuterUpLeft",
    "browOuterUpRight",
  ],
  "Cheeks & nose": [
    "cheekPuff",
    "cheekSquintLeft",
    "cheekSquintRight",
    "noseSneerLeft",
    "noseSneerRight",
  ],
};

const gui = createGUI();
const flipCamera = addMirrorToggle(gui, av);
addSmoothingToggle(gui, faceGeometry);

// One graph per blendshape, each plotting its score over time.
const scores = {};
for (const [section, names] of Object.entries(BLENDSHAPES)) {
  gui.addSection(section, { open: section === "Jaw" });
  for (const name of names) {
    scores[name] = signal(0);
    gui.addGraph(name, scores[name], {
      min: 0,
      max: 1,
      format: (v) => v.toFixed(2),
    });
  }
}

function updateScores(shapes) {
  for (const name in scores) {
    scores[name].set(shapes[name] || 0);
  }
}

let lastTime = performance.now();

async function render(landmarker) {
  // Wait for video to be ready (loadeddata).
  await av.ready();


  // Resize orthographic camera to video dimensions if necessary.
  if (width !== av.video.videoWidth || height !== av.video.videoHeight) {
    const w = av.video.videoWidth;
    const h = av.video.videoHeight;
    camera.left = -0.5 * w;
    camera.right = 0.5 * w;
    camera.top = 0.5 * h;
    camera.bottom = -0.5 * h;
    camera.updateProjectionMatrix();
    width = w;
    height = h;
    resize();
    faceGeometry.setSize(w, h);
  }

  // Detect the face landmarks and blendshapes in the current video frame.
  const now = performance.now();
  const result = landmarker.detectForVideo(av.video, now);
  const dt = Math.min(0.1, (now - lastTime) / 1000);
  lastTime = now;

  av.style.opacity = 1;

  const found = faceGeometry.updateFromResult(result, { flipped: flipCamera() });
  face.visible = found;
  if (found) {
    // Blow bubbles from between the lips.
    upperLip.fromArray(faceGeometry.positions, 13 * 3);
    lowerLip.fromArray(faceGeometry.positions, 14 * 3);
    mouth.addVectors(upperLip, lowerLip).multiplyScalar(0.5);
    updateScores(faceGeometry.blendshapes);
  }
  updateBubbles(dt, found ? faceGeometry.blendshapes : {});

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
      outputFaceBlendshapes: true,
    });
    status.textContent = "";
    render(landmarker);
  } catch (e) {
    status.textContent = e.message;
    throw e;
  }
}

init();
