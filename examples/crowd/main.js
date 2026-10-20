import {
  WebGLRenderer,
  SRGBColorSpace,
  Scene,
  OrthographicCamera,
  Mesh,
  PlaneGeometry,
  TextureLoader,
  VideoTexture,
  MeshBasicMaterial,
  BufferAttribute,
  DynamicDrawUsage,
} from "three";
import { FaceMeshFaceGeometry } from "../../js/face.js";
import { createFaceLandmarker, detectVideoFrame } from "../landmarker.js";
import { createGUI, addSmoothingToggle, signal, effect } from "../gui.js";

const av = document.querySelector("gum-av");
const canvas = document.querySelector("canvas");
const status = document.querySelector("#status");

const renderer = new WebGLRenderer({ antialias: true, canvas });
renderer.setPixelRatio(window.devicePixelRatio);

const scene = new Scene();

// The scene is the picture, in its own pixels.
const camera = new OrthographicCamera(-1, 1, 1, -1, -1000, 1000);

let pictureWidth = 1;
let pictureHeight = 1;

function resize() {
  const aspectRatio = pictureWidth / pictureHeight;
  const windowAspectRatio = window.innerWidth / window.innerHeight;
  if (aspectRatio > windowAspectRatio) {
    renderer.setSize(window.innerWidth, window.innerWidth / aspectRatio);
  } else {
    renderer.setSize(window.innerHeight * aspectRatio, window.innerHeight);
  }
  camera.left = -0.5 * pictureWidth;
  camera.right = 0.5 * pictureWidth;
  camera.top = 0.5 * pictureHeight;
  camera.bottom = -0.5 * pictureHeight;
  camera.updateProjectionMatrix();
}

window.addEventListener("resize", () => {
  resize();
});

const loader = new TextureLoader();

// The picture, drawn behind everything.
const picture = new Mesh(
  new PlaneGeometry(1, 1),
  new MeshBasicMaterial({ depthTest: false, depthWrite: false })
);
picture.renderOrder = -1;
scene.add(picture);

const alphaTexture = loader.load("../../assets/mask.png");
alphaTexture.channel = 1;
let videoTexture = null;

const wireframeMaterial = new MeshBasicMaterial({
  color: 0xff00ff,
  wireframe: true,
});

// The live face's landmarks, as texture coordinates into the video, shared by every face in the picture.
const liveGeometry = new FaceMeshFaceGeometry({ useVideoTexture: true });
const liveUvs = new BufferAttribute(new Float32Array(liveGeometry.uvs.length), 2).setUsage(
  DynamicDrawUsage
);
// The alpha mask is laid out on the canonical texture coordinates.
const canonicalUvs = new BufferAttribute(new FaceMeshFaceGeometry().uvs.slice(), 2);

// Points on the forehead, cheeks and chin, to compare skin colors.
const SKIN = [10, 151, 108, 337, 50, 280, 205, 425, 101, 330, 199, 175];

const pictureCanvas = document.createElement("canvas");
const pictureContext = pictureCanvas.getContext("2d", { willReadFrequently: true });

// Averages the color around the given points of an image drawn on a canvas, in 0-1 sRGB.
function averageColor(context, points) {
  const color = [0, 0, 0];
  const { width, height } = context.canvas;
  const r = Math.max(1, Math.round(width / 400));
  for (const [x, y] of points) {
    const px = Math.min(width - 2 * r - 1, Math.max(0, Math.round(x * width) - r));
    const py = Math.min(height - 2 * r - 1, Math.max(0, Math.round(y * height) - r));
    const data = context.getImageData(px, py, 2 * r + 1, 2 * r + 1).data;
    for (let i = 0; i < data.length; i += 4) {
      color[0] += data[i];
      color[1] += data[i + 1];
      color[2] += data[i + 2];
    }
  }
  const n = (points.length * (2 * r + 1) * (2 * r + 1)) * 255;
  return color.map((c) => c / n);
}

let faces = [];

function clearFaces() {
  for (const face of faces) {
    scene.remove(face.mesh);
    face.mesh.geometry.dispose();
    face.material.dispose();
  }
  faces = [];
}

function addFace(landmarks) {
  const geometry = new FaceMeshFaceGeometry();
  geometry.setSize(pictureWidth, pictureHeight);
  geometry.update(landmarks);
  geometry.setAttribute("uv", liveUvs);
  geometry.setAttribute("uv1", canonicalUvs);
  const material = new MeshBasicMaterial({
    map: videoTexture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new Mesh(geometry, material);
  scene.add(mesh);
  const xs = landmarks.map((l) => l.x * pictureWidth);
  const size = Math.max(...xs) - Math.min(...xs);
  const skin = averageColor(
    pictureContext,
    SKIN.map((i) => [landmarks[i].x, landmarks[i].y])
  );
  faces.push({ mesh, material, size, skin });
}

const detectCanvas = document.createElement("canvas");
const detectContext = detectCanvas.getContext("2d");

// The detector only finds faces that fill a good part of the image, so it also
// looks at overlapping tiles of the picture, and keeps the closest look at each face.
function detectFaces(image, landmarker) {
  const W = pictureWidth;
  const H = pictureHeight;
  const found = [];
  const consider = (landmarks, tx, ty, tw, th, edges) => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const l of landmarks) {
      minX = Math.min(minX, l.x);
      maxX = Math.max(maxX, l.x);
      minY = Math.min(minY, l.y);
      maxY = Math.max(maxY, l.y);
    }
    // A face cut by the tile's edge is seen whole in a neighbouring tile.
    const m = 0.01;
    if (
      (edges.left && minX < m) ||
      (edges.right && maxX > 1 - m) ||
      (edges.top && minY < m) ||
      (edges.bottom && maxY > 1 - m)
    ) {
      return;
    }
    const mapped = landmarks.map((l) => ({
      x: (tx + l.x * tw) / W,
      y: (ty + l.y * th) / H,
      z: (l.z * tw) / W,
    }));
    const face = {
      landmarks: mapped,
      x: (tx + 0.5 * (minX + maxX) * tw) / W,
      y: (ty + 0.5 * (minY + maxY) * th) / H,
      size: ((maxX - minX) * tw) / W,
      fill: maxX - minX,
    };
    const same = found.findIndex(
      (f) => Math.hypot((f.x - face.x) * W, (f.y - face.y) * H) < 0.5 * Math.max(f.size, face.size) * W
    );
    if (same === -1) found.push(face);
    else if (face.fill > found[same].fill) found[same] = face;
  };

  for (const l of landmarker.detect(image).faceLandmarks) {
    consider(l, 0, 0, W, H, {});
  }
  for (const fraction of [0.5, 0.33]) {
    const T = Math.round(Math.min(W, H) * fraction);
    const stride = Math.round(T / 2);
    const scale = Math.min(1, 640 / T);
    detectCanvas.width = detectCanvas.height = Math.round(T * scale);
    for (let ty = 0; ty < H; ty += stride) {
      const y = Math.min(ty, H - T);
      for (let tx = 0; tx < W; tx += stride) {
        const x = Math.min(tx, W - T);
        detectContext.drawImage(image, x, y, T, T, 0, 0, detectCanvas.width, detectCanvas.height);
        const edges = { left: x > 0, right: x + T < W, top: y > 0, bottom: y + T < H };
        for (const l of landmarker.detect(detectCanvas).faceLandmarks) {
          consider(l, x, y, T, T, edges);
        }
        if (x + T >= W) break;
      }
      if (y + T >= H) break;
    }
  }
  return found.map((f) => f.landmarks);
}

const softEdges = signal(true);
const matchSkin = signal(true);
const opacity = signal(1);
const showPicture = signal(true);
const wireframe = signal(false);

const gui = createGUI();
gui.addCheckbox("Match skin", matchSkin, {
  title: "Tint your face to match the skin color of each face it replaces",
});
gui.addCheckbox("Soft edges", softEdges, { title: "Fade the edges of your face into the picture" });
gui.addSlider("Opacity", opacity, 0, 1, 0.05);
gui.addCheckbox("Show picture", showPicture);
gui.addCheckbox("Wireframe", wireframe);
addSmoothingToggle(gui, liveGeometry);

effect(() => {
  picture.visible = showPicture();
});

let imageLandmarker;

// Finds the faces in a picture and shapes a mesh after each one.
function setPicture(texture) {
  const image = texture.image;
  pictureWidth = image.naturalWidth || image.width;
  pictureHeight = image.naturalHeight || image.height;
  pictureCanvas.width = pictureWidth;
  pictureCanvas.height = pictureHeight;
  pictureContext.drawImage(image, 0, 0);
  const found = detectFaces(image, imageLandmarker);
  if (!found.length) {
    throw new Error("No faces detected! Try another image.");
  }
  texture.colorSpace = SRGBColorSpace;
  if (picture.material.map) picture.material.map.dispose();
  picture.material.map = texture;
  picture.material.needsUpdate = true;
  picture.scale.set(pictureWidth, pictureHeight, 1);
  clearFaces();
  for (const landmarks of found) addFace(landmarks);
  // Smaller faces are usually further back, so draw them first.
  faces.sort((a, b) => a.size - b.size).forEach((face, i) => (face.mesh.renderOrder = i));
  resize();
  return found.length;
}

async function usePicture(url) {
  if (!imageLandmarker) return false;
  status.textContent = "Looking for faces...";
  // Let the status show before the detection blocks the page.
  await new Promise((r) => setTimeout(r, 50));
  try {
    const count = setPicture(await loader.loadAsync(url));
    status.textContent = `${count} face${count === 1 ? "" : "s"} found.`;
    return true;
  } catch (e) {
    status.textContent = e.message;
    console.error(e);
    return false;
  }
}

const PICTURES = [
  ["../../assets/crowds/expedition-37.jpg", "Expedition 37"],
  ["../../assets/crowds/sts-125.jpg", "STS-125"],
  ["../../assets/crowds/expedition-51.jpg", "Expedition 51"],
  ["../../assets/crowds/artemis-2.jpg", "Artemis II"],
];
const pictureUrl = signal(PICTURES[0][0]);
gui.addSegmented("Picture", pictureUrl, PICTURES.map(([url], i) => [url, String(i + 1)]));
effect(() => {
  usePicture(pictureUrl());
});

let uploadUrl;

async function useFile(file) {
  if (!file.type.startsWith("image/")) return;
  const url = URL.createObjectURL(file);
  if (await usePicture(url)) {
    if (uploadUrl) URL.revokeObjectURL(uploadUrl);
    uploadUrl = url;
  } else {
    URL.revokeObjectURL(url);
  }
}

gui.addFileButton("Load a picture…", useFile, { accept: "image/*" });

renderer.domElement.addEventListener("dragover", (e) => e.preventDefault());
renderer.domElement.addEventListener("drop", (e) => {
  e.preventDefault();
  const file = [...e.dataTransfer.files].find((f) => f.type.startsWith("image/"));
  if (file) useFile(file);
});

const videoCanvas = document.createElement("canvas");
const videoContext = videoCanvas.getContext("2d", { willReadFrequently: true });
let liveSkin = null;
let frame = 0;

// Measures the skin color of the live face every few frames.
function measureLiveSkin() {
  if (frame++ % 10) return;
  const video = av.video;
  videoCanvas.width = 320;
  videoCanvas.height = Math.round((320 * video.videoHeight) / video.videoWidth);
  videoContext.drawImage(video, 0, 0, videoCanvas.width, videoCanvas.height);
  const uvs = liveGeometry.uvs;
  const skin = averageColor(
    videoContext,
    SKIN.map((i) => [uvs[i * 2], 1 - uvs[i * 2 + 1]])
  );
  liveSkin = liveSkin ? liveSkin.map((c, i) => c + 0.3 * (skin[i] - c)) : skin;
}

// The tint that turns the live skin into the pictured one, in linear color.
function setTint(face) {
  if (!matchSkin() || !liveSkin) {
    face.material.color.setRGB(1, 1, 1);
    return;
  }
  const ratio = face.skin.map((c, i) =>
    Math.min(2.5, Math.max(0.4, (c / Math.max(liveSkin[i], 0.02)) ** 2.2))
  );
  face.material.color.setRGB(ratio[0], ratio[1], ratio[2]);
}

async function render(landmarker) {
  // Wait for video to be ready (loadeddata).
  await av.ready();

  if (liveGeometry.w !== av.video.videoWidth || liveGeometry.h !== av.video.videoHeight) {
    liveGeometry.setSize(av.video.videoWidth, av.video.videoHeight);
  }

  // Detect the face landmarks in the current video frame.
  const result = detectVideoFrame(landmarker, av.video);

  const found = liveGeometry.updateFromResult(result);
  if (found) {
    liveUvs.array.set(liveGeometry.uvs);
    liveUvs.needsUpdate = true;
    measureLiveSkin();
  }
  for (const face of faces) {
    face.mesh.visible = found;
    face.mesh.material = wireframe() ? wireframeMaterial : face.material;
    const alphaMap = softEdges() ? alphaTexture : null;
    if (face.material.alphaMap !== alphaMap) {
      face.material.alphaMap = alphaMap;
      face.material.needsUpdate = true;
    }
    face.material.opacity = opacity();
    setTint(face);
  }

  renderer.render(scene, camera);

  requestAnimationFrame(() => render(landmarker));
}

// Init the demo, loading dependencies.
async function init() {
  try {
    await av.ready();
    videoTexture = new VideoTexture(av.video);
    videoTexture.colorSpace = SRGBColorSpace;
    status.textContent = "Loading model...";
    let landmarker;
    [landmarker, imageLandmarker] = await Promise.all([
      createFaceLandmarker({ numFaces: 1 }),
      createFaceLandmarker({ numFaces: 20, runningMode: "IMAGE" }),
    ]);
    if (!(await usePicture(pictureUrl()))) return;
    render(landmarker);
  } catch (e) {
    status.textContent = e.message;
    throw e;
  }
}

init();
