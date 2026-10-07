import {
  WebGLRenderer,
  Scene,
  PerspectiveCamera,
  DirectionalLight,
  HemisphereLight,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  CylinderGeometry,
  ConeGeometry,
  SphereGeometry,
  Vector3,
} from "three";
import { FaceMeshFaceGeometry, METRIC_CAMERA_FOV } from "../../js/face.js";
import { CANONICAL } from "../../js/geometry.js";
import { createFaceLandmarker } from "../landmarker.js";
import { createGUI, addMirrorToggle, signal } from "../gui.js";

const av = document.querySelector("gum-av");
const canvas = document.querySelector("canvas");
const status = document.querySelector("#status");

const renderer = new WebGLRenderer({ antialias: true, alpha: true, canvas });
renderer.setPixelRatio(window.devicePixelRatio);

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

// Create a new geometry helper in metric mode, for the irises and the head pose in centimeters.
const faceGeometry = new FaceMeshFaceGeometry({ metric: true });

// Wireframe of the face, to see what the eyes sit in.
const face = new Mesh(
  faceGeometry,
  new MeshBasicMaterial({ color: 0xff00ff, wireframe: true })
);
scene.add(face);

const light = new DirectionalLight(0xffffff, 2);
light.position.set(0.5, 1, 1);
scene.add(light);
scene.add(new HemisphereLight(0xffffff, 0x404040, 1.5));

// Center of an eyeball in the canonical face: behind the middle of the eye opening.
const EYEBALL_DEPTH = 1.2;
function eyeballCenter(ids) {
  const v = new Vector3();
  for (const id of ids) {
    v.x += CANONICAL[id][0] / ids.length;
    v.y += CANONICAL[id][1] / ids.length;
    v.z += CANONICAL[id][2] / ids.length;
  }
  v.z -= EYEBALL_DEPTH;
  return v;
}

const up = new Vector3(0, 1, 0);

// An arrow along +Y, from a dot at its base: a shaft and a cone at the end.
class Arrow {
  constructor(color, thickness = 1) {
    const material = new MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.3,
      roughness: 0.4,
    });
    this.thickness = thickness;
    this.shaft = new Mesh(
      new CylinderGeometry(0.12 * thickness, 0.12 * thickness, 1, 12).translate(0, 0.5, 0),
      material
    );
    this.head = new Mesh(
      new ConeGeometry(0.45 * thickness, 1.2 * thickness, 16).translate(0, 0.6 * thickness, 0),
      material
    );
    this.dot = new Mesh(new SphereGeometry(0.3 * thickness, 16, 8), material);
    this.group = new Group();
    this.group.add(this.shaft, this.head, this.dot);
    scene.add(this.group);
  }

  set(origin, direction, length) {
    this.group.position.copy(origin);
    this.group.quaternion.setFromUnitVectors(up, direction);
    this.shaft.scale.y = length;
    this.head.position.y = length;
  }
}

// An arrow from the iris along the direction the eye is looking.
class GazeArrow extends Arrow {
  constructor(color, contour, iris) {
    super(color);
    this.center = eyeballCenter(contour);
    this.iris = iris;
    this.eyeball = new Vector3();
    this.direction = new Vector3();
    this.target = new Vector3();
    this.smoothed = false;
  }

  update(length) {
    // The eyeball center follows the head; the eye looks from it through the iris.
    this.eyeball.copy(this.center).applyMatrix4(faceGeometry.pose);
    const iris = faceGeometry[this.iris].position;
    this.target.subVectors(iris, this.eyeball).normalize();
    if (this.smoothed) {
      this.direction.lerp(this.target, 0.4).normalize();
    } else {
      this.direction.copy(this.target);
      this.smoothed = true;
    }
    this.set(iris, this.direction, length);
  }
}

// A shorter arrow along the surface normal of the face at a landmark.
class NormalArrow extends Arrow {
  constructor(id) {
    super(0xffffff, 0.6);
    this.id = id;
    this.origin = new Vector3();
    this.normal = new Vector3();
  }

  update(length) {
    this.origin.fromArray(faceGeometry.positions, this.id * 3);
    this.normal.fromBufferAttribute(faceGeometry.getAttribute("normal"), this.id);
    this.set(this.origin, this.normal, length);
  }
}

const arrows = [
  new GazeArrow(0x40c0ff, [33, 133, 159, 145], "rightIris"),
  new GazeArrow(0xffc040, [263, 362, 386, 374], "leftIris"),
];

// Forehead, chin, nose tip, and both cheeks.
const normals = [10, 152, 1, 205, 425].map((id) => new NormalArrow(id));
const NORMAL_LENGTH = 3;

const showFace = signal(false);
const length = signal(8);

const gui = createGUI();
gui.addSlider("Arrow length (cm)", length, 2, 40, 1);
gui.addCheckbox("Wireframe", showFace);
const flipCamera = addMirrorToggle(gui, av);

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

  // Detect the face landmarks, irises and pose in the current video frame.
  const result = landmarker.detectForVideo(av.video, performance.now());

  av.style.opacity = 1;
  status.textContent = "";

  const found =
    faceGeometry.updateFromResult(result, { flipped: flipCamera() }) &&
    faceGeometry.hasIrises;
  face.visible = found && showFace();
  for (const arrow of arrows) {
    arrow.group.visible = found;
    if (found) arrow.update(length());
  }
  for (const arrow of normals) {
    arrow.group.visible = found;
    if (found) arrow.update(NORMAL_LENGTH);
  }

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
