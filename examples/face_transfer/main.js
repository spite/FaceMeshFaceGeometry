import {
  WebGLRenderer,
  PCFSoftShadowMap,
  sRGBEncoding,
  Scene,
  SpotLight,
  PerspectiveCamera,
  HemisphereLight,
  AmbientLight,
  IcosahedronGeometry,
  OrthographicCamera,
  DoubleSide,
  Mesh,
  TextureLoader,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Texture,
} from "../../third_party/three.module.js";
import { FaceMeshFaceGeometry } from "../../js/face.js";
import { OrbitControls } from "../../third_party/OrbitControls.js";

const av = document.querySelector("gum-av");
const canvas = document.querySelector("canvas");
const status = document.querySelector("#status");

// Set a background color, or change alpha to false for a solid canvas.
const renderer = new WebGLRenderer({ antialias: true, alpha: true, canvas });
// renderer.setClearColor(0x202020);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFSoftShadowMap;
renderer.outputEncoding = sRGBEncoding;

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
resize();
renderer.render(scene, camera);

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
const spotLight = new SpotLight(0xffffff, 0.5);
spotLight.position.set(0.5, 0.5, 1);
spotLight.position.multiplyScalar(400);
scene.add(spotLight);

spotLight.castShadow = true;

spotLight.shadow.mapSize.width = 1024;
spotLight.shadow.mapSize.height = 1024;

spotLight.shadow.camera.near = 200;
spotLight.shadow.camera.far = 800;

spotLight.shadow.camera.fov = 40;

spotLight.shadow.bias = -0.005;

scene.add(spotLight);

const hemiLight = new HemisphereLight(0xffffbb, 0x080820, 0.25);
//scene.add(hemiLight);

const ambientLight = new AmbientLight(0x404040, 0.5);
scene.add(ambientLight);

// Enable wireframe to debug the mesh on top of the material.
let wireframe = false;

// Defines if the source should be flipped horizontally.
let flipCamera = true;

let referenceFace;

async function render(model) {
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

  // Wait for the model to return a face.
  const faces = await model.estimateFaces(av.video, false, flipCamera);

  av.style.opacity = 1;

  // There's at least one face.
  if (faces.length > 0) {
    // Update face mesh geometry with new data.
    faceGeometry.update(faces[0], flipCamera);

    // Use the reference face texture coordinates for this face geometry.
    for (let j = 0; j < 468; j++) {
      let x = referenceFace.face.scaledMesh[j][0];
      let y = referenceFace.face.scaledMesh[j][1];
      faceGeometry.uvs[j * 2] = x;
      faceGeometry.uvs[j * 2 + 1] = 1 - y;
    }
    faceGeometry.getAttribute("uv").needsUpdate = true;
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

  requestAnimationFrame(() => render(model));
}

// For debugging purposes, it shows the detected geometry.
function draw(image, face) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const w = image.naturalWidth;
  const h = image.naturalHeight;
  canvas.width = w;
  canvas.height = h;
  ctx.fillStyle = "#ff00ff";
  ctx.drawImage(image, 0, 0);
  for (const p of face.scaledMesh) {
    const x = p[0] * w;
    const y = p[1] * h;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, 2 * Math.PI);
    ctx.fill();
  }
  canvas.style.zIndex = 100;
  canvas.style.height = "auto";
  canvas.style.width = "50vw";
  document.body.append(canvas);
}

// Tries to find a face in an image so we can texure map it into the life feed face.
async function getFace(model, texture) {
  const faces = await model.estimateFaces(texture.image);
  if (!faces.length) {
    status.textContent = "No face detected! Try another image.";
    throw new Error("No face detected!");
  }
  // Get the found face and turn into texture coordinates.
  const face = faces[0];
  for (let j = 0; j < face.scaledMesh.length; j++) {
    face.scaledMesh[j][0] /= texture.image.naturalWidth;
    face.scaledMesh[j][1] /= texture.image.naturalHeight;
  }
  return { texture, face: faces[0] };
}

// We need a separate model because they can't be reused (?).
let modelRef;

// Init the demo, loading dependencies.
async function init() {
  await Promise.all([tf.setBackend("webgl"), av.ready()]);
  status.textContent = "Loading model...";
  let texture, model;
  [texture, model, modelRef] = await Promise.all([
    loader.loadAsync("../../assets/ao.jpg"),
    facemesh.load({ maxFaces: 1 }),
    facemesh.load({ maxFaces: 1 }),
  ]);
  try {
    referenceFace = await getFace(modelRef, texture);
  } catch (e) {
    console.error(e);
    return;
  }
  material.map = referenceFace.texture;
  status.textContent = "Detecting face...";
  await render(model);
  status.textContent = "Drop an image into the page.";
}

// Handles dropping an image.
async function dropHandler(ev) {
  ev.preventDefault();
  status.textContent = "Analysing...";

  if (ev.dataTransfer.items) {
    for (let item of ev.dataTransfer.items) {
      if (item.kind === "file") {
        var file = item.getAsFile();
        modelRef = await facemesh.load({ maxFaces: 1 });
        const url = URL.createObjectURL(file);
        let texture = await loader.loadAsync(url);
        try {
          referenceFace = await getFace(modelRef, texture);
        } catch (e) {
          console.error(e);
          return;
        }
        // draw(texture.image, referenceFace.face);
        material.map = referenceFace.texture;
        material.needsUpdate = true;
        status.textContent = "";
      }
    }
  } else {
    for (let file of ev.dataTransfer.files) {
    }
  }
}

function dragOverHandler(ev) {
  ev.preventDefault();
}

renderer.domElement.addEventListener("drop", dropHandler);
renderer.domElement.addEventListener("dragover", dragOverHandler);

init();
