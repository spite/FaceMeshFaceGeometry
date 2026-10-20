import {
  WebGLRenderer,
  Scene,
  PerspectiveCamera,
  HemisphereLight,
  DirectionalLight,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  BufferGeometry,
  BufferAttribute,
  VideoTexture,
  SRGBColorSpace,
  DoubleSide,
  Color,
  Matrix4,
  Vector2,
  Vector3,
  Raycaster,
  EqualStencilFunc,
  IncrementStencilOp,
} from "three";
import { FaceMeshFaceGeometry, METRIC_CAMERA_FOV, FACES } from "../../js/face.js";
import { createFaceLandmarker, detectVideoFrame } from "../landmarker.js";
import { createGUI, addMirrorToggle, addSmoothingToggle, signal, effect } from "../gui.js";

const av = document.querySelector("gum-av");
const canvas = document.querySelector("canvas");
const status = document.querySelector("#status");

// Each level of the hole is drawn inside the one before with the stencil buffer, so the renderer needs one.
const renderer = new WebGLRenderer({ antialias: true, alpha: true, stencil: true, canvas });
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

// Metric mode lines the mesh up with the face pose, and the video gives its texture coordinates.
const faceGeometry = new FaceMeshFaceGeometry({ metric: true, useVideoTexture: true });

// The outline of the face, in order around it.
const OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378,
  400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21,
  54, 103, 67, 109,
];
const N = OVAL.length;

const MAX_LEVELS = 12;

// The live face in the canonical face space, to find where the hole meets its surface.
const surfacePositions = new Float32Array(468 * 3);
const surfaceGeometry = new BufferGeometry();
surfaceGeometry.setAttribute("position", new BufferAttribute(surfacePositions, 3));
// The video's texture coordinates, so a hit on the surface knows its color in the video.
surfaceGeometry.setAttribute("uv", new BufferAttribute(faceGeometry.uvs, 2));
surfaceGeometry.setIndex(FACES);
const surface = new Mesh(surfaceGeometry, new MeshBasicMaterial({ side: DoubleSide }));
const raycaster = new Raycaster();
const down = new Vector3(0, 0, -1);

// Index for walls swept between two copies of the outline, and for a fan that fills the outline.
const wallIndex = [];
const capIndex = [];
for (let i = 0; i < N; i++) {
  const j = (i + 1) % N;
  wallIndex.push(i * 2, j * 2, i * 2 + 1, j * 2, j * 2 + 1, i * 2 + 1);
  capIndex.push(N, i, j);
}

function dynamicGeometry(count, index) {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute("uv", new BufferAttribute(new Float32Array(count * 2), 2));
  geometry.setIndex(index);
  return geometry;
}

// Materials that draw only inside level k of the hole.
const inside = (k) => ({
  stencilWrite: true,
  stencilWriteMask: 0,
  stencilRef: k,
  stencilFunc: EqualStencilFunc,
});

const levels = [];
for (let k = 0; k <= MAX_LEVELS; k++) {
  const level = { k };
  if (k > 0) {
    // The walls of the hole this face sits in, from the opening in the face before back to this one.
    level.walls = new Mesh(
      dynamicGeometry(N * 2, wallIndex),
      new MeshStandardMaterial({ roughness: 0.6, side: DoubleSide, ...inside(k) })
    );
    level.face = new Mesh(faceGeometry, new MeshBasicMaterial({ side: DoubleSide, ...inside(k) }));
  }
  // The opening in this face: it draws nothing, and moves its pixels on to the next level.
  level.cap = new Mesh(
    dynamicGeometry(N + 1, capIndex),
    new MeshBasicMaterial({
      side: DoubleSide,
      colorWrite: false,
      depthWrite: false,
      ...inside(k),
      stencilWriteMask: 0xff,
      stencilZPass: IncrementStencilOp,
    })
  );
  // Each level draws in order: its walls, its opening, then its face around the opening.
  for (const [i, mesh] of [level.walls, level.cap, level.face].entries()) {
    if (!mesh) continue;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = k * 3 + i;
    scene.add(mesh);
  }
  levels.push(level);
}

// Lights that follow the head, so the walls are lit from the front.
const head = new Group();
head.matrixAutoUpdate = false;
scene.add(head);
const light = new DirectionalLight(0xffffff, 2.5);
light.position.set(0.3, 0.6, 1);
head.add(light, light.target);
scene.add(new HemisphereLight(0xffffff, 0x200000, 0.6));

const count = signal(5);
const recess = signal(2);
const holeSize = signal(0.75);
const color = signal("video");
const wireframe = signal(false);

const gui = createGUI();
gui.addSlider("Levels", count, 0, MAX_LEVELS, 1, { title: "How many faces inside faces" });
gui.addSlider("Recess (cm)", recess, 0.1, 8, 0.1, { title: "How far back each face sits" });
gui.addSlider("Hole size", holeSize, 0.4, 0.95, 0.01, { title: "The hole and the next face, as a fraction of the face" });
gui.addSegmented("Walls", color, [
  ["video", "Skin"],
  ["#ff2010", "Red"],
  ["#20a0ff", "Blue"],
  ["#f0f0e8", "White"],
  ["#303030", "Black"],
]);
gui.addCheckbox("Wireframe", wireframe);
const flipCamera = addMirrorToggle(gui, av);
addSmoothingToggle(gui, faceGeometry);

let videoTexture = null;

// Skin walls are textured with the video, stretched from the opening back to the next face.
effect(() => {
  const skin = color() === "video";
  const c = new Color(skin ? 0xffffff : color());
  for (const level of levels) {
    if (!level.walls) continue;
    level.walls.material.color = c;
    level.walls.material.map = skin ? videoTexture : null;
    level.walls.material.needsUpdate = true;
  }
});

const wireframeMesh = new Mesh(
  faceGeometry,
  new MeshBasicMaterial({ color: 0xff00ff, wireframe: true })
);
wireframeMesh.renderOrder = 1000;
scene.add(wireframeMesh);

const poseInverse = new Matrix4();
const step = new Matrix4();
const outline = Array.from({ length: N }, () => new Vector3());
// The opening on the face's surface, with its middle last, and where each point is in the video.
const opening = Array.from({ length: N + 1 }, () => new Vector3());
const openingUvs = Array.from({ length: N + 1 }, () => new Vector2());
const point = new Vector3();
const hits = [];

// Where the face's surface is, straight in front of x, y, and its video coordinates in `uv`.
// Falls back to `fallback` off the face.
function surfaceZ(x, y, fallback, uv) {
  raycaster.set(point.set(x, y, 100), down);
  hits.length = 0;
  surface.raycast(raycaster, hits);
  if (!hits.length) return fallback;
  let front = hits[0];
  for (const hit of hits) if (hit.point.z > front.point.z) front = hit;
  if (front.uv) uv.copy(front.uv);
  return front.point.z;
}

// Level k is the face shrunk by s^k and pushed k recesses back, in the canonical face space.
function toLevel(p, k, target) {
  const scale = Math.pow(holeSize(), k);
  return target.set(p.x * scale, p.y * scale, p.z * scale - k * recess());
}

function updateLevels(found) {
  const n = count();
  const s = holeSize();
  poseInverse.copy(faceGeometry.pose).invert();

  // The live face in the canonical face space.
  for (let i = 0; i < 468; i++) {
    point.fromArray(faceGeometry.positions, i * 3).applyMatrix4(poseInverse);
    point.toArray(surfacePositions, i * 3);
  }
  surfaceGeometry.getAttribute("position").needsUpdate = true;
  surfaceGeometry.computeBoundingSphere();
  surfaceGeometry.computeBoundingBox();

  // The outline, and the opening: the outline shrunk by s and dropped onto the face.
  const middle = opening[N].set(0, 0, 0);
  outline.forEach((p, i) => {
    p.fromArray(surfacePositions, OVAL[i] * 3);
    middle.x += (p.x * s) / N;
    middle.y += (p.y * s) / N;
    openingUvs[i].fromArray(faceGeometry.uvs, OVAL[i] * 2);
    opening[i].set(p.x * s, p.y * s, surfaceZ(p.x * s, p.y * s, p.z, openingUvs[i]));
  });
  middle.z = surfaceZ(middle.x, middle.y, 0, openingUvs[N]);

  for (const level of levels) {
    const { k } = level;
    const visible = found && k <= n;
    const matrix = faceGeometry.pose;

    if (level.walls) {
      const positions = level.walls.geometry.getAttribute("position");
      const uvs = level.walls.geometry.getAttribute("uv");
      for (let i = 0; i < N; i++) {
        toLevel(opening[i], k - 1, point);
        positions.setXYZ(i * 2, point.x, point.y, point.z);
        uvs.setXY(i * 2, openingUvs[i].x, openingUvs[i].y);
        toLevel(outline[i], k, point);
        positions.setXYZ(i * 2 + 1, point.x, point.y, point.z);
        uvs.setXY(i * 2 + 1, faceGeometry.uvs[OVAL[i] * 2], faceGeometry.uvs[OVAL[i] * 2 + 1]);
      }
      positions.needsUpdate = true;
      uvs.needsUpdate = true;
      level.walls.geometry.computeVertexNormals();
      level.walls.geometry.computeBoundingSphere();
      level.walls.matrix.copy(matrix);
      level.walls.matrixWorldNeedsUpdate = true;
      level.walls.visible = visible;
    }

    const positions = level.cap.geometry.getAttribute("position");
    for (let i = 0; i <= N; i++) {
      toLevel(opening[i], k, point);
      positions.setXYZ(i, point.x, point.y, point.z);
    }
    positions.needsUpdate = true;
    level.cap.geometry.computeBoundingSphere();
    level.cap.matrix.copy(matrix);
    level.cap.matrixWorldNeedsUpdate = true;
    // The deepest face is whole.
    level.cap.visible = found && k < n;

    if (level.face) {
      // From camera space to the canonical face, down to level k, and back.
      const scale = Math.pow(s, k);
      step.makeTranslation(0, 0, -k * recess()).scale(point.set(scale, scale, scale));
      level.face.matrix.copy(matrix).multiply(step).multiply(poseInverse);
      level.face.matrixWorldNeedsUpdate = true;
      level.face.visible = visible;
      // The deeper faces are a little darker.
      level.face.material.color.setScalar(Math.pow(0.88, k));
    }
  }
}

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
  const result = detectVideoFrame(landmarker, av.video);

  av.style.opacity = 1;
  status.textContent = "";

  const found = faceGeometry.updateFromResult(result, {
    flipped: flipCamera(),
  });
  if (found) {
    head.matrix.copy(faceGeometry.pose);
    head.matrixWorldNeedsUpdate = true;
    updateLevels(found);
  } else {
    for (const level of levels) {
      for (const mesh of [level.walls, level.cap, level.face]) if (mesh) mesh.visible = false;
    }
  }
  wireframeMesh.visible = found && wireframe();

  renderer.render(scene, camera);

  requestAnimationFrame(() => render(landmarker));
}

// Init the demo, loading dependencies.
async function init() {
  try {
    await av.ready();
    videoTexture = new VideoTexture(av.video);
    videoTexture.colorSpace = SRGBColorSpace;
    for (const level of levels) {
      if (!level.face) continue;
      level.face.material.map = videoTexture;
      level.face.material.needsUpdate = true;
      if (color() === "video") {
        level.walls.material.map = videoTexture;
        level.walls.material.needsUpdate = true;
      }
    }
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
