import {
  WebGLRenderer,
  PCFSoftShadowMap,
  sRGBEncoding,
  Scene,
  SpotLight,
  PerspectiveCamera,
  HemisphereLight,
  AmbientLight,
  OrthographicCamera,
  DoubleSide,
  Mesh,
  TorusBufferGeometry,
  Matrix4,
  MeshBasicMaterial,
  VideoTexture,
  BoxBufferGeometry,
  MeshStandardMaterial,
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

// Create wireframe material for debugging.
const wireframeMaterial = new MeshBasicMaterial({
  color: 0xff00ff,
  wireframe: true,
});

// Create material for mask.
const material = new MeshStandardMaterial({
  color: 0xffffff,
  roughness: 0.7,
  metalness: 0.0,
  map: null, // Will be created when the video is ready.
  side: DoubleSide,
});

// Create a new geometry helper, specifying that the texture coordinates are to be based on the same video as the model input.
const faceGeometry = new FaceMeshFaceGeometry({ useVideoTexture: true });

// Create mask mesh.
const mask = new Mesh(faceGeometry, material);
scene.add(mask);
mask.receiveShadow = mask.castShadow = true;

// Add lights.
const spotLight = new SpotLight(0xffffbb, 1);
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

const hemiLight = new HemisphereLight(0xffffbb, 0x080820, 0.5);
scene.add(hemiLight);

const ambientLight = new AmbientLight(0x404040, 0.1);
scene.add(ambientLight);

// Create a red material for the blocks.
const blockMaterial = new MeshStandardMaterial({
  color: 0xff2010,
  roughness: 0.4,
  metalness: 0.1,
  transparent: true,
});

const chin = new Mesh(new BoxBufferGeometry(1, 1, 1), blockMaterial);
chin.castShadow = chin.receiveShadow = true;
scene.add(chin);
chin.scale.setScalar(40);

const leftEye = new Mesh(new BoxBufferGeometry(1, 1, 1), blockMaterial);
leftEye.castShadow = leftEye.receiveShadow = true;
scene.add(leftEye);
leftEye.scale.setScalar(20);

const rightEye = new Mesh(new BoxBufferGeometry(1, 1, 1), blockMaterial);
rightEye.castShadow = rightEye.receiveShadow = true;
scene.add(rightEye);
rightEye.scale.setScalar(20);

const halo = new Mesh(
  new TorusBufferGeometry(1, 0.1, 16, 100, Math.PI),
  blockMaterial
);
halo.castShadow = halo.receiveShadow = true;
scene.add(halo);
const rot = new Matrix4().makeRotationX(-Math.PI / 4);
halo.geometry.applyMatrix4(rot);
halo.scale.setScalar(80);

// Enable wireframe to debug the mesh on top of the material.
let wireframe = false;

// Defines if the source should be flipped horizontally.
let flipCamera = true;

async function render(model) {
  // Wait for video to be ready (loadeddata).
  await av.ready();

  // Flip video element horizontally if necessary.
  av.video.style.transform = flipCamera ? "scaleX(-1)" : "scaleX(1)";
  av.video.style.display = "none";
  av.style.opacity = 1;

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

  status.textContent = "";

  // There's at least one face.
  if (faces.length > 0) {
    // Update face mesh geometry with new data.
    faceGeometry.update(faces[0], flipCamera);

    // Modify tracked objects position and orientation.
    const trackChin = faceGeometry.track(208, 428, 175);
    chin.position.copy(trackChin.position);
    chin.rotation.setFromRotationMatrix(trackChin.rotation);

    const trackLeftEye = faceGeometry.track(225, 193, 230);
    leftEye.position.copy(trackLeftEye.position);
    leftEye.rotation.setFromRotationMatrix(trackLeftEye.rotation);

    const trackRightEye = faceGeometry.track(417, 445, 450);
    rightEye.position.copy(trackRightEye.position);
    rightEye.rotation.setFromRotationMatrix(trackRightEye.rotation);

    const trackHalo = faceGeometry.track(10, 251, 21);
    halo.position.copy(trackHalo.position);
    halo.rotation.setFromRotationMatrix(trackHalo.rotation);
  }

  if (wireframe) {
    // Render the mask.
    renderer.autoClear = true;
    mask.material = material;
    renderer.render(scene, camera);
    // Prevent renderer from clearing the color buffer.
    renderer.autoClear = false;
    renderer.clear(false, true, false);
    mask.material = wireframeMaterial;
    // Render again with the wireframe material.
    renderer.render(scene, camera);
    renderer.autoClear = true;
  } else {
    // Render the scene normally.
    renderer.render(scene, camera);
  }

  requestAnimationFrame(() => render(model));
}

// Init the demo, loading dependencies.
async function init() {
  await Promise.all([tf.setBackend("webgl"), av.ready()]);
  const videoTexture = new VideoTexture(av.video);
  videoTexture.encoding = sRGBEncoding;
  material.map = videoTexture;
  status.textContent = "Loading model...";
  const model = await facemesh.load({ maxFaces: 1 });
  status.textContent = "Detecting face...";
  render(model);
}

init();
