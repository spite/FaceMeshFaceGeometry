import {
  WebGLRenderer,
  PCFShadowMap,
  SRGBColorSpace,
  Scene,
  SpotLight,
  Object3D,
  PerspectiveCamera,
  HemisphereLight,
  AmbientLight,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  VideoTexture,
  MeshStandardMaterial,
  Vector3,
  BoxGeometry,
  MeshNormalMaterial,
} from "three";
import { FaceMeshFaceGeometry } from "../../js/face.js";
import { OrbitControls } from "../../third_party/OrbitControls.js";
import { createFaceLandmarker } from "../landmarker.js";
import { createGUI, addMirrorToggle, addSmoothingToggle, signal } from "../gui.js";

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

// Change to renderer.render(scene, debugCamera); for interactive view.
const camera = new PerspectiveCamera(75, 1, 0.1, 1000);
camera.position.set(100, 0, 150);
camera.lookAt(scene.position);
const controls = new OrbitControls(camera, renderer.domElement);

let width = 0;
let height = 0;

function resize() {
  const windowWidth = window.innerWidth;
  const windowHeight = window.innerHeight;
  renderer.setSize(windowWidth, windowHeight);
  camera.aspect = windowWidth / windowHeight;
  camera.updateProjectionMatrix();
}

window.addEventListener("resize", () => {
  resize();
});

// Create wireframe material for debugging.
const wireframeMaterial = new MeshBasicMaterial({
  color: 0xff00ff,
  wireframe: true,
});

// Create material for faces.
const material = new MeshStandardMaterial({
  color: 0xffffff,
  roughness: 0.7,
  metalness: 0.0,
  map: null, // Will be created when the video is ready.
  side: DoubleSide,
});

// Create a new geometry helper, specifying that the texture coordinates are to be based on the same video as the model input.
const faceGeometry = new FaceMeshFaceGeometry({
  useVideoTexture: true,
  normalizeCoords: true,
});

const amount = 500;
// Create instanced mesh of faces.
const instancedFaces = new InstancedMesh(faceGeometry, material, amount);
scene.add(instancedFaces);
instancedFaces.receiveShadow = instancedFaces.castShadow = true;
// The instances move every frame, so skip the cached bounding sphere.
instancedFaces.frustumCulled = false;
instancedFaces.scale.setScalar(20);

// Dummy instances for debugging.
const mat = new MeshNormalMaterial({ wireframe: true });
const instancedDummy = new InstancedMesh(
  new BoxGeometry(1, 1, 1),
  mat,
  amount
);
//scene.add(instancedDummy);
instancedDummy.receiveShadow = instancedDummy.castShadow = true;
instancedDummy.scale.setScalar(10);

// Add lights.
// A decay of 0 keeps the intensity independent of distance.
const spotLight = new SpotLight(0xffffde, Math.PI, 0, Math.PI / 6, 0, 0);
spotLight.position.set(0.5, 0.5, 1);
spotLight.position.multiplyScalar(200);

spotLight.castShadow = true;

spotLight.shadow.mapSize.width = 1024;
spotLight.shadow.mapSize.height = 1024;

spotLight.shadow.camera.near = 50;
spotLight.shadow.camera.far = 350;

spotLight.shadow.bias = -0.005;

scene.add(spotLight);

const hemiLight = new HemisphereLight(0xffffde, 0x323263, 0.5 * Math.PI);
scene.add(hemiLight);

const ambientLight = new AmbientLight(0x898989, 0.1 * Math.PI);
scene.add(ambientLight);

const dummy = new Object3D();

const wireframe = signal(false);

const gui = createGUI();
gui.addCheckbox("Wireframe", wireframe);
const flipCamera = addMirrorToggle(gui, av);
addSmoothingToggle(gui, faceGeometry);

const r = 7.5 / 2;
const rr = 2.5 / 2;
const p = new Vector3();
const pp = new Vector3();
const rot = new Matrix4();
const rot2 = new Matrix4();
const lookAt = new Matrix4();

async function render(landmarker) {
  // Wait for video to be ready (loadeddata).
  await av.ready();

  av.style.opacity = 1;
  av.video.style.display = "none";

  // Update the geometry size if the video dimensions change.
  if (width !== av.video.videoWidth || height !== av.video.videoHeight) {
    const w = av.video.videoWidth;
    const h = av.video.videoHeight;
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

  status.textContent = "";

  // There's at least one face.
  if (faces.length > 0) {
    // Update face mesh geometry with new data.
    faceGeometry.update(faces[0], flipCamera());
  }

  // Update positions of instances.
  for (let i = 0; i < amount; i++) {
    const f = i + 0.001 * performance.now();
    const a = (f * 2 * Math.PI) / amount;
    const x = r * Math.cos(a);
    const y = 0;
    const z = r * Math.sin(a);
    const aa = (49 * f * 2 * Math.PI) / amount;
    const xx = rr * Math.cos(aa);
    const yy = rr * Math.sin(aa);
    p.set(x, y, z);
    pp.set(xx, yy, 0);
    rot.makeRotationY(-a);
    pp.applyMatrix4(rot);
    p.add(pp);
    lookAt.makeRotationY(-a + Math.PI / 2);
    rot2.makeRotationX(-aa);
    lookAt.multiply(rot2);
    dummy.position.copy(p);
    dummy.rotation.setFromRotationMatrix(lookAt);
    dummy.updateMatrix();
    instancedFaces.setMatrixAt(i, dummy.matrix);
    instancedDummy.setMatrixAt(i, dummy.matrix);
  }
  instancedFaces.instanceMatrix.needsUpdate = true;
  instancedDummy.instanceMatrix.needsUpdate = true;

  if (wireframe()) {
    // Render the faces.
    renderer.autoClear = true;
    renderer.render(scene, camera);
    // Prevent renderer from clearing the color buffer.
    renderer.autoClear = false;
    renderer.clear(false, true, false);
    instancedFaces.material = wireframeMaterial;
    // Render again with the wireframe material.
    renderer.render(scene, camera);
    instancedFaces.material = material;
    renderer.autoClear = true;
  } else {
    // Render the scene normally.
    renderer.render(scene, camera);
  }

  requestAnimationFrame(() => render(landmarker));
}

// Init the demo, loading dependencies.
async function init() {
  try {
    await av.ready();
    const videoTexture = new VideoTexture(av.video);
    videoTexture.colorSpace = SRGBColorSpace;
    material.map = videoTexture;
    status.textContent = "Loading model...";
    const landmarker = await createFaceLandmarker({ numFaces: 1 });
    status.textContent = "Detecting face...";
    render(landmarker);
  } catch (e) {
    status.textContent = e.message;
    throw e;
  }
}

init();
