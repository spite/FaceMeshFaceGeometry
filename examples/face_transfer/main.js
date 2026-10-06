import {
  WebGLRenderer,
  PCFShadowMap,
  SRGBColorSpace,
  Scene,
  SpotLight,
  PerspectiveCamera,
  HemisphereLight,
  AmbientLight,
  OrthographicCamera,
  DoubleSide,
  Mesh,
  TextureLoader,
  MeshBasicMaterial,
  MeshStandardMaterial,
} from "three";
import { FaceMeshFaceGeometry } from "../../js/face.js";
import { OrbitControls } from "../../third_party/OrbitControls.js";
import { createFaceLandmarker } from "../landmarker.js";

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
const camera = new OrthographicCamera(1, 1, 1, 1, -1000, 1000);

// Change to renderer.render(scene, debugCamera); for interactive view.
const debugCamera = new PerspectiveCamera(75, 1, 0.1, 1000);
debugCamera.position.set(300, 300, 300);
debugCamera.lookAt(scene.position);
const controls = new OrbitControls(debugCamera, renderer.domElement);

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
  debugCamera.aspect = videoAspectRatio;
  debugCamera.updateProjectionMatrix();
}

window.addEventListener("resize", () => {
  resize();
});

// Create a loader.
const loader = new TextureLoader();

// Create wireframe material for debugging.
const wireframeMaterial = new MeshBasicMaterial({
  color: 0xff00ff,
  wireframe: true,
  transparent: true,
  opacity: 0.5,
});

// Create material for mask.
const material = new MeshStandardMaterial({
  color: 0xffffff,
  roughness: 0.8,
  metalness: 0,
  map: null, // Set later by the face detector.
  transparent: true,
  side: DoubleSide,
  opacity: 1,
});

// Create a new geometry helper.
const faceGeometry = new FaceMeshFaceGeometry();

// Create mask mesh.
const mask = new Mesh(faceGeometry, material);
scene.add(mask);
mask.receiveShadow = mask.castShadow = true;

// Add lights.
// A decay of 0 keeps the intensity independent of distance.
const spotLight = new SpotLight(0xffffff, 0.5 * Math.PI, 0, Math.PI / 3, 0, 0);
spotLight.position.set(0.5, 0.5, 1);
spotLight.position.multiplyScalar(400);
scene.add(spotLight);

spotLight.castShadow = true;

spotLight.shadow.mapSize.width = 1024;
spotLight.shadow.mapSize.height = 1024;

spotLight.shadow.camera.near = 200;
spotLight.shadow.camera.far = 800;

spotLight.shadow.bias = -0.005;

scene.add(spotLight);

const hemiLight = new HemisphereLight(0xffffde, 0x323263, 0.25 * Math.PI);
//scene.add(hemiLight);

const ambientLight = new AmbientLight(0x898989, 0.5 * Math.PI);
scene.add(ambientLight);

// Enable wireframe to debug the mesh on top of the material.
let wireframe = false;

// Defines if the source should be flipped horizontally.
let flipCamera = true;


async function render(landmarker) {
  // Wait for video to be ready (loadeddata).
  await av.ready();

  // Flip video element horizontally if necessary.
  av.video.style.transform = flipCamera ? "scaleX(-1)" : "scaleX(1)";

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

  // Detect the face landmarks in the current video frame.
  const faces = landmarker.detectForVideo(
    av.video,
    performance.now()
  ).faceLandmarks;

  av.style.opacity = 1;

  // There's at least one face.
  if (faces.length > 0) {
    // Update face mesh geometry with new data.
    faceGeometry.update(faces[0], flipCamera);
  }

  if (wireframe) {
    // Render the mask.
    renderer.render(scene, camera);
    // Prevent renderer from clearing the color buffer.
    renderer.autoClear = false;
    renderer.clear(false, true, false);
    mask.material = wireframeMaterial;
    // Render again with the wireframe material.
    renderer.render(scene, camera);
    mask.material = material;
    renderer.autoClear = true;
  } else {
    // Render the scene normally.
    renderer.render(scene, camera);
  }

  requestAnimationFrame(() => render(landmarker));
}

// For debugging purposes, it shows the detected geometry.
function draw(image, landmarks) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const w = image.naturalWidth;
  const h = image.naturalHeight;
  canvas.width = w;
  canvas.height = h;
  ctx.fillStyle = "#ff00ff";
  ctx.drawImage(image, 0, 0);
  for (const p of landmarks) {
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, 4, 0, 2 * Math.PI);
    ctx.fill();
  }
  canvas.style.zIndex = 100;
  canvas.style.height = "auto";
  canvas.style.width = "50vw";
  document.body.append(canvas);
}

// Finds a face in an image and uses it to texture map the live feed face.
function setReferenceFace(imageLandmarker, texture) {
  const faces = imageLandmarker.detect(texture.image).faceLandmarks;
  if (!faces.length) {
    throw new Error("No face detected! Try another image.");
  }
  // The normalized landmarks of the reference face are its texture coordinates.
  const landmarks = faces[0];
  for (let j = 0; j < 468; j++) {
    faceGeometry.uvs[j * 2] = landmarks[j].x;
    faceGeometry.uvs[j * 2 + 1] = 1 - landmarks[j].y;
  }
  faceGeometry.getAttribute("uv").needsUpdate = true;
  // draw(texture.image, landmarks);
  texture.colorSpace = SRGBColorSpace;
  if (material.map) {
    material.map.dispose();
  }
  material.map = texture;
  material.needsUpdate = true;
}

let imageLandmarker;

// Init the demo, loading dependencies.
async function init() {
  try {
    await av.ready();
    status.textContent = "Loading model...";
    let texture, landmarker;
    [texture, landmarker, imageLandmarker] = await Promise.all([
      loader.loadAsync("../../assets/ao.jpg"),
      createFaceLandmarker({ numFaces: 1 }),
      createFaceLandmarker({ numFaces: 1, runningMode: "IMAGE" }),
    ]);
    setReferenceFace(imageLandmarker, texture);
    status.textContent = "Detecting face...";
    await render(landmarker);
    status.textContent = "Drop an image into the page.";
  } catch (e) {
    status.textContent = e.message;
    throw e;
  }
}

// Handles dropping an image.
async function dropHandler(ev) {
  ev.preventDefault();
  const file = [...ev.dataTransfer.files].find((f) =>
    f.type.startsWith("image/")
  );
  if (!file || !imageLandmarker) return;
  status.textContent = "Analysing...";
  const url = URL.createObjectURL(file);
  try {
    const texture = await loader.loadAsync(url);
    setReferenceFace(imageLandmarker, texture);
    status.textContent = "";
  } catch (e) {
    status.textContent = e.message;
    console.error(e);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function dragOverHandler(ev) {
  ev.preventDefault();
}

renderer.domElement.addEventListener("drop", dropHandler);
renderer.domElement.addEventListener("dragover", dragOverHandler);

init();
