import {
  WebGLRenderer,
  Scene,
  PerspectiveCamera,
  InstancedMesh,
  BoxGeometry,
  MeshStandardMaterial,
  DirectionalLight,
  HemisphereLight,
  Object3D,
  Color,
  Vector3,
  Quaternion,
} from "three";
import {
  FaceMeshFaceGeometry,
  FACES,
  METRIC_CAMERA_FOV,
} from "../../js/face.js";
import { createFaceLandmarker } from "../landmarker.js";
import {
  createGUI,
  addMirrorToggle,
  addSmoothingToggle,
  signal,
} from "../gui.js";

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

// Metric mode puts the face in 3D, in centimeters, with the head pose. Texture coordinates
// that follow the video tell which pixel each point of the face covers.
const faceGeometry = new FaceMeshFaceGeometry({ metric: true, useVideoTexture: true });

// The mesh has a hole for the mouth; these lip contours close it, so the voxels cover it too.
const UPPER_LIP = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308];
const LOWER_LIP = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308];
const triangles = FACES.slice();
for (let i = 0; i < UPPER_LIP.length - 1; i++) {
  triangles.push(UPPER_LIP[i], LOWER_LIP[i], UPPER_LIP[i + 1]);
  triangles.push(UPPER_LIP[i + 1], LOWER_LIP[i], LOWER_LIP[i + 1]);
}

// The video, small, read back to colour the voxels.
const sampleCanvas = document.createElement("canvas");
const sampleContext = sampleCanvas.getContext("2d", { willReadFrequently: true });
let pixels = null;

function readVideo() {
  const w = 160;
  const h = Math.round((w * height) / width);
  if (sampleCanvas.width !== w || sampleCanvas.height !== h) {
    sampleCanvas.width = w;
    sampleCanvas.height = h;
  }
  sampleContext.drawImage(av.video, 0, 0, w, h);
  pixels = sampleContext.getImageData(0, 0, w, h).data;
}

const MAX_VOXELS = 20000;
const voxels = new InstancedMesh(
  new BoxGeometry(1, 1, 1),
  new MeshStandardMaterial({ roughness: 0.6, metalness: 0 }),
  MAX_VOXELS
);
voxels.frustumCulled = false;
voxels.count = 0;
// Allocate the per-instance colors.
voxels.setColorAt(0, new Color());
scene.add(voxels);

const light = new DirectionalLight(0xffffff, 2.2);
light.position.set(-0.4, 0.6, 1);
scene.add(light);
scene.add(new HemisphereLight(0xffffff, 0x9090a0, 1.2));

const voxelSize = signal(1.5);
const followHead = signal(true);

const gui = createGUI();
gui.addSlider("Voxel size (cm)", voxelSize, 0.3, 3, 0.05);
gui.addCheckbox("Follow head", followHead, {
  title: "Turn the voxel grid with the head, instead of keeping it square to the camera",
});
const flipCamera = addMirrorToggle(gui, av);
addSmoothingToggle(gui, faceGeometry);

const cells = new Map();
const dummy = new Object3D();
const color = new Color();
const a = new Vector3();
const b = new Vector3();
const c = new Vector3();
const p = new Vector3();
const origin = new Vector3();
const rotation = new Quaternion();
const inverse = new Quaternion();
const scale = new Vector3();

// Fills a 3D grid with the face: samples the surface densely enough for the voxel size,
// and turns every grid cell it passes through into a voxel, coloured by the average of the
// video under it. The grid is square to the camera, or turns with the head.
function voxelize() {
  const positions = faceGeometry.positions;
  const uvs = faceGeometry.uvs;
  const size = voxelSize();
  const pw = sampleCanvas.width;
  const ph = sampleCanvas.height;

  // The grid's frame: its origin at the head, and its rotation from the camera or the head.
  faceGeometry.pose.decompose(origin, rotation, scale);
  if (!followHead()) rotation.identity();
  inverse.copy(rotation).invert();

  cells.clear();
  for (let t = 0; t < triangles.length; t += 3) {
    const i0 = triangles[t];
    const i1 = triangles[t + 1];
    const i2 = triangles[t + 2];
    a.fromArray(positions, i0 * 3);
    b.fromArray(positions, i1 * 3);
    c.fromArray(positions, i2 * 3);
    const edge = Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a));
    const n = Math.max(1, Math.ceil((edge / size) * 2));
    for (let i = 0; i <= n; i++) {
      for (let j = 0; j <= n - i; j++) {
        const u = i / n;
        const v = j / n;
        const w = 1 - u - v;
        p.set(0, 0, 0).addScaledVector(a, w).addScaledVector(b, u).addScaledVector(c, v);
        // Into the grid's frame, and the cell it falls in.
        p.sub(origin).applyQuaternion(inverse);
        const ix = Math.floor(p.x / size);
        const iy = Math.floor(p.y / size);
        const iz = Math.floor(p.z / size);
        // One number per cell; the indices stay well within ±512.
        const key = ((ix + 512) * 1024 + (iy + 512)) * 1024 + (iz + 512);
        let cell = cells.get(key);
        if (!cell) {
          cell = { ix, iy, iz, r: 0, g: 0, b: 0, count: 0 };
          cells.set(key, cell);
        }
        // The video pixel under this point of the face.
        const su = uvs[i0 * 2] * w + uvs[i1 * 2] * u + uvs[i2 * 2] * v;
        const sv = uvs[i0 * 2 + 1] * w + uvs[i1 * 2 + 1] * u + uvs[i2 * 2 + 1] * v;
        const px = Math.min(pw - 1, Math.max(0, Math.floor(su * pw)));
        const py = Math.min(ph - 1, Math.max(0, Math.floor((1 - sv) * ph)));
        const k = (py * pw + px) * 4;
        cell.r += pixels[k];
        cell.g += pixels[k + 1];
        cell.b += pixels[k + 2];
        cell.count++;
      }
    }
  }

  let count = 0;
  for (const cell of cells.values()) {
    if (count >= MAX_VOXELS) break;
    // The voxel's center in the grid's frame, back in the camera's.
    dummy.position
      .set((cell.ix + 0.5) * size, (cell.iy + 0.5) * size, (cell.iz + 0.5) * size)
      .applyQuaternion(rotation)
      .add(origin);
    dummy.quaternion.copy(rotation);
    dummy.scale.setScalar(size);
    dummy.updateMatrix();
    voxels.setMatrixAt(count, dummy.matrix);

    color
      .setRGB(cell.r / cell.count / 255, cell.g / cell.count / 255, cell.b / cell.count / 255)
      .convertSRGBToLinear();
    voxels.setColorAt(count, color);
    count++;
  }
  voxels.count = count;
  voxels.instanceMatrix.needsUpdate = true;
  voxels.instanceColor.needsUpdate = true;
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
  const result = landmarker.detectForVideo(av.video, performance.now());
  av.style.opacity = 1;
  status.textContent = "";

  const found = faceGeometry.updateFromResult(result, { flipped: flipCamera() });
  voxels.visible = found;
  if (found) {
    readVideo();
    voxelize();
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
