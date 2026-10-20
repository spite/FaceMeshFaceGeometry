import {
  WebGLRenderer,
  PCFShadowMap,
  SRGBColorSpace,
  Scene,
  SpotLight,
  AmbientLight,
  OrthographicCamera,
  DoubleSide,
  Mesh,
  TextureLoader,
  MeshBasicMaterial,
  MeshStandardMaterial,
  BufferAttribute,
} from "three";
import { FaceMeshFaceGeometry } from "../../js/face.js";
import { createFaceLandmarker, detectVideoFrame } from "../landmarker.js";
import { createGUI, addMirrorToggle, addSmoothingToggle, signal, effect } from "../gui.js";

const av = document.querySelector("gum-av");
const canvas = document.querySelector("canvas");
const status = document.querySelector("#status");

const renderer = new WebGLRenderer({ antialias: true, alpha: true, canvas });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFShadowMap;

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

// The alpha mask is laid out on the canonical texture coordinates, but the first UV set
// follows the reference face, so keep the canonical ones as a second set for it.
faceGeometry.setAttribute("uv1", new BufferAttribute(faceGeometry.uvs.slice(), 2));
const alphaTexture = loader.load("../../assets/mask.png");
alphaTexture.channel = 1;

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

const ambientLight = new AmbientLight(0x898989, 0.5 * Math.PI);
scene.add(ambientLight);

const wireframe = signal(false);

const gui = createGUI();
gui.addCheckbox("Wireframe", wireframe);
const flipCamera = addMirrorToggle(gui, av);
addSmoothingToggle(gui, faceGeometry);

// Fade the edges of the face into the video with the alpha mask.
const maskAlpha = signal(false);
gui.addCheckbox("Mask alpha", maskAlpha);
effect(() => {
  material.alphaMap = maskAlpha() ? alphaTexture : null;
  material.needsUpdate = true;
});


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

  // Detect the face landmarks in the current video frame.
  const faces = detectVideoFrame(landmarker, av.video).faceLandmarks;

  av.style.opacity = 1;

  // There's at least one face.
  if (faces.length > 0) {
    // Update face mesh geometry with new data.
    faceGeometry.update(faces[0], flipCamera());
  }
  mask.visible = faces.length > 0;

  if (wireframe()) {
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
  texture.colorSpace = SRGBColorSpace;
  if (material.map) {
    material.map.dispose();
  }
  material.map = texture;
  material.needsUpdate = true;
}

let imageLandmarker;

// Reference images to pick from in the panel.
const REFERENCES = [
  { label: "Face 1", url: "../../assets/faces/face-1.jpg" },
  { label: "Face 2", url: "../../assets/faces/face-2.jpg" },
  { label: "Face 3", url: "../../assets/faces/face-3.jpg" },
  { label: "Face 4", url: "../../assets/faces/face-4.jpg" },
  { label: "Mask", url: "../../assets/ao.jpg" },
];

const picker = document.createElement("div");
picker.style.cssText =
  "display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; width: 100%";
const thumbnails = REFERENCES.map((reference) => {
  const button = document.createElement("button");
  button.type = "button";
  button.title = reference.label;
  button.style.cssText =
    "height: auto; padding: 0; border: 2px solid transparent; border-radius: 6px; background: none; color: inherit; font: inherit; font-size: 11px; cursor: pointer; overflow: hidden";
  const img = document.createElement("img");
  img.src = reference.url;
  img.alt = reference.label;
  img.style.cssText = "width: 100%; aspect-ratio: 1; object-fit: cover; display: block";
  const caption = document.createElement("span");
  caption.textContent = reference.label;
  caption.style.cssText = "display: block; padding: 2px 0";
  button.append(img, caption);
  button.addEventListener("click", () => useReference(reference.url, button));
  picker.append(button);
  return button;
});

// The last tile opens a file picker and then shows the uploaded image.
const fileInput = document.createElement("input");
fileInput.type = "file";
fileInput.accept = "image/*";
fileInput.hidden = true;
const uploadButton = thumbnails[0].cloneNode(false);
uploadButton.title = "Upload an image with a face";
const uploadPreview = document.createElement("div");
uploadPreview.textContent = "+";
uploadPreview.style.cssText =
  "width: 100%; aspect-ratio: 1; display: grid; place-items: center; font-size: 28px; border: 1px dashed currentColor; border-radius: 4px; background: center / cover no-repeat";
const uploadCaption = document.createElement("span");
uploadCaption.textContent = "Upload";
uploadCaption.style.cssText = "display: block; padding: 2px 0";
uploadButton.append(uploadPreview, uploadCaption, fileInput);
uploadButton.addEventListener("click", (e) => {
  if (e.target !== fileInput) fileInput.click();
});
fileInput.addEventListener("change", () => {
  if (fileInput.files.length) useFile(fileInput.files[0]);
  fileInput.value = "";
});
picker.append(uploadButton);
thumbnails.push(uploadButton);
gui.addElement(picker);

let uploadUrl;

// Uses an uploaded or dropped image file as the reference face.
async function useFile(file) {
  if (!file.type.startsWith("image/")) return;
  const url = URL.createObjectURL(file);
  if (!(await useReference(url, uploadButton))) {
    URL.revokeObjectURL(url);
    return;
  }
  if (uploadUrl) URL.revokeObjectURL(uploadUrl);
  uploadUrl = url;
  uploadPreview.textContent = "";
  uploadPreview.style.border = "none";
  uploadPreview.style.backgroundImage = `url(${url})`;
}

function select(button) {
  for (const thumbnail of thumbnails) {
    thumbnail.style.borderColor = thumbnail === button ? "white" : "transparent";
  }
}

// Loads an image and maps its face onto the live one. `button` is the thumbnail it came from, if any.
async function useReference(url, button) {
  if (!imageLandmarker) return;
  status.textContent = "Analysing...";
  let texture;
  try {
    texture = await loader.loadAsync(url);
    setReferenceFace(imageLandmarker, texture);
    select(button);
    status.textContent = "";
    return true;
  } catch (e) {
    // A picture without a face is never used, so free it.
    texture?.dispose();
    status.textContent = e.message;
    console.error(e);
    return false;
  }
}

// Init the demo, loading dependencies.
async function init() {
  try {
    await av.ready();
    status.textContent = "Loading model...";
    let landmarker;
    [landmarker, imageLandmarker] = await Promise.all([
      createFaceLandmarker({ numFaces: 1 }),
      createFaceLandmarker({ numFaces: 1, runningMode: "IMAGE" }),
    ]);
    await useReference(REFERENCES[0].url, thumbnails[0]);
    status.textContent = "Detecting face...";
    await render(landmarker);
    status.textContent = "";
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
  if (file) await useFile(file);
}

function dragOverHandler(ev) {
  ev.preventDefault();
}

renderer.domElement.addEventListener("drop", dropHandler);
renderer.domElement.addEventListener("dragover", dragOverHandler);

init();
