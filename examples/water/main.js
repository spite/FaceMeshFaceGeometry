import {
  WebGLRenderer,
  WebGLRenderTarget,
  NoColorSpace,
  HalfFloatType,
  LinearFilter,
  Scene,
  OrthographicCamera,
  Mesh,
  PlaneGeometry,
  VideoTexture,
  ShaderMaterial,
  MeshBasicMaterial,
  TextureLoader,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Vector2,
  Vector4,
} from "three";
import { FaceMeshFaceGeometry } from "../../js/face.js";
import { createFaceLandmarker, detectVideoFrame } from "../landmarker.js";
import { createGUI, addMirrorToggle, addSmoothingToggle, signal } from "../gui.js";

const av = document.querySelector("gum-av");
const canvas = document.querySelector("canvas");
const status = document.querySelector("#status");

const renderer = new WebGLRenderer({ canvas });
renderer.setPixelRatio(window.devicePixelRatio);

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

// The face is drawn into a mask, to set how deep it sits in the water.
const faceGeometry = new FaceMeshFaceGeometry({ useVideoTexture: true });
// The alpha mask is laid out on the canonical texture coordinates, so keep them as a second set.
faceGeometry.setAttribute("uv1", new BufferAttribute(faceGeometry.uvs.slice(), 2));
const alphaTexture = new TextureLoader().load("../../assets/mask.png");
alphaTexture.channel = 1;

const faceMaterial = new MeshBasicMaterial({
  alphaMap: alphaTexture,
  transparent: true,
});
const faceMesh = new Mesh(faceGeometry, faceMaterial);

// The mesh and its alpha mask have holes at the mouth and eyes, so fill them, or the water shows through.
const HOLES = [
  [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95],
  [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7],
  [263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249],
];
const holesGeometry = new BufferGeometry();
holesGeometry.setAttribute("position", faceGeometry.getAttribute("position"));
holesGeometry.setIndex(
  HOLES.flatMap((loop) => loop.slice(1, -1).flatMap((v, i) => [loop[0], v, loop[i + 2]]))
);
const holesMesh = new Mesh(holesGeometry, new MeshBasicMaterial({ side: DoubleSide }));
holesMesh.frustumCulled = false;

const faceScene = new Scene();
faceScene.add(faceMesh, holesMesh);
// Video pixels, centered, as the geometry lays them out.
const faceCamera = new OrthographicCamera(1, 1, 1, 1, -1000, 1000);

// Landmarks that stir the water when they move: the outline of the face.
const STIRRERS = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378,
  400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21,
  54, 103, 67, 109,
];
const MAX_DROPS = STIRRERS.length;

// The water is a height field simulated on a grid: height in red, velocity in green.
const SIM_WIDTH = 512;
let simHeight = 384;
// The water moves at a steady rate, however fast the face is tracked.
const STEPS_PER_SECOND = 120;
const MAX_STEPS_PER_FRAME = 8;

function createTarget() {
  return new WebGLRenderTarget(SIM_WIDTH, simHeight, {
    type: HalfFloatType,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    depthBuffer: false,
  });
}
let targets = [createTarget(), createTarget()];
const faceMask = createTarget();

const quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
const quad = new Mesh(new PlaneGeometry(2, 2));
const quadScene = new Scene();
quadScene.add(quad);

const vertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }`;

// One step of the wave equation, plus the drops the face made during it.
const simMaterial = new ShaderMaterial({
  uniforms: {
    water: { value: null },
    delta: { value: new Vector2(1 / SIM_WIDTH, 1 / simHeight) },
    damping: { value: 0.995 },
    drops: { value: Array.from({ length: MAX_DROPS }, () => new Vector4()) },
    dropCount: { value: 0 },
    aspect: { value: 4 / 3 },
  },
  defines: { MAX_DROPS },
  vertexShader,
  fragmentShader: `
    uniform sampler2D water;
    uniform vec2 delta;
    uniform float damping;
    uniform vec4 drops[MAX_DROPS];
    uniform int dropCount;
    uniform float aspect;
    varying vec2 vUv;

    void main() {
      vec4 info = texture2D(water, vUv);
      float average = (
        texture2D(water, vUv - vec2(delta.x, 0.0)).r +
        texture2D(water, vUv + vec2(delta.x, 0.0)).r +
        texture2D(water, vUv - vec2(0.0, delta.y)).r +
        texture2D(water, vUv + vec2(0.0, delta.y)).r
      ) * 0.25;
      info.g += (average - info.r) * 2.0;
      info.g *= damping;
      info.r += info.g;
      // A slow drain, so the water level doesn't creep up as drops are added.
      info.r *= 0.999;

      // Each drop is a soft round bump: x, y, radius, strength.
      for (int i = 0; i < MAX_DROPS; i++) {
        if (i >= dropCount) break;
        vec4 drop = drops[i];
        vec2 d = (vUv - drop.xy) * vec2(aspect, 1.0);
        info.r += exp(-dot(d, d) / (drop.z * drop.z)) * drop.w;
      }
      gl_FragColor = info;
    }`,
});

// A dark matcap with a bright highlight, for the glints on the water. Only the light above its
// middle is added, so flat water adds nothing and only the slopes of the waves catch the light.
const matcapTexture = new TextureLoader().load("../../assets/matcap-water.jpg");
matcapTexture.colorSpace = NoColorSpace;

// Draws the video through the water surface. The video is read and written as is, with no
// color conversion, so the image keeps exactly the camera's colors.
const displayMaterial = new ShaderMaterial({
  uniforms: {
    water: { value: null },
    videoMap: { value: null },
    delta: { value: new Vector2(1 / SIM_WIDTH, 1 / simHeight) },
    refraction: { value: 0.01 },
    matcap: { value: matcapTexture },
    highlights: { value: 1 },
    faceMask: { value: faceMask.texture },
    faceDepth: { value: 3 },
    mirrored: { value: 1 },
  },
  vertexShader,
  fragmentShader: `
    uniform sampler2D water;
    uniform sampler2D videoMap;
    uniform vec2 delta;
    uniform float refraction;
    uniform sampler2D matcap;
    uniform float highlights;
    uniform sampler2D faceMask;
    uniform float faceDepth;
    uniform float mirrored;
    varying vec2 vUv;

    void main() {
      vec2 slope = vec2(
        texture2D(water, vUv + vec2(delta.x, 0.0)).r - texture2D(water, vUv - vec2(delta.x, 0.0)).r,
        texture2D(water, vUv + vec2(0.0, delta.y)).r - texture2D(water, vUv - vec2(0.0, delta.y)).r
      ) / (2.0 * delta);
      // The deeper something sits under the surface, the more the surface bends it. The face
      // is at faceDepth: 0 above the water, 1 at the level of everything else, more below it.
      float depth = mix(1.0, faceDepth, texture2D(faceMask, vUv).r);
      vec2 uv = clamp(vUv - slope * refraction * depth, 0.0, 1.0);
      uv.x = mix(uv.x, 1.0 - uv.x, mirrored);
      vec3 color = texture2D(videoMap, uv).rgb;

      // Glints from the matcap, by the tilt of the surface. The face above the water has none.
      vec3 normal = normalize(vec3(-slope * 0.3, 1.0));
      vec3 base = texture2D(matcap, vec2(0.5)).rgb;
      vec3 glint = max(texture2D(matcap, normal.xy * 0.5 + 0.5).rgb - base, 0.0) / (1.0 - base);
      color += glint * highlights * min(depth, 1.0);

      gl_FragColor = vec4(color, 1.0);
    }`,
});

const strength = signal(1);
const refraction = signal(0.01);
const damping = signal(0.995);
const faceDepth = signal(3);
const highlights = signal(1);

const gui = createGUI();
gui.addSlider("Wake", strength, 0, 3, 0.05, { title: "How much moving your face stirs the water" });
gui.addSlider("Refraction", refraction, 0, 0.04, 0.001);
gui.addSlider("Ripples last", damping, 0.97, 0.999, 0.001, { title: "How long the ripples keep going" });
gui.addSlider("Highlights", highlights, 0, 2, 0.05, { title: "Glints on the waves, from a matcap" });
gui.addSlider("Face depth", faceDepth, 0, 3, 0.05, {
  title: "0 is above the water, 1 is at the level of the rest, more is deeper under it",
});
const flipCamera = addMirrorToggle(gui, av);
addSmoothingToggle(gui, faceGeometry);
gui.addButton("Splash", () => {
  splash = true;
});

let splash = false;
// Where each stirring landmark was at the last step, and where the face has it now.
const from = new Float32Array(STIRRERS.length * 2);
const to = new Float32Array(STIRRERS.length * 2);
let tracking = false;
let lastTime = performance.now();
let pendingTime = 0;

// Takes in where the face is now. The steps until the next frame move the drops there.
function track(found) {
  if (!found) {
    tracking = false;
    return;
  }
  const uvs = faceGeometry.uvs;
  for (let i = 0; i < STIRRERS.length; i++) {
    // Landmarks are in video space, and the water is in screen space.
    const x = uvs[STIRRERS[i] * 2];
    to[i * 2] = flipCamera() ? 1 - x : x;
    to[i * 2 + 1] = uvs[STIRRERS[i] * 2 + 1];
  }
  if (!tracking) from.set(to);
  tracking = true;
}

// Drops along the path of each landmark, a fraction `t` of the way from the last step.
function stir(t) {
  const drops = simMaterial.uniforms.drops.value;
  let count = 0;
  if (tracking) {
    for (let i = 0; i < STIRRERS.length; i++) {
      const x = from[i * 2] + (to[i * 2] - from[i * 2]) * t;
      const y = from[i * 2 + 1] + (to[i * 2 + 1] - from[i * 2 + 1]) * t;
      const moved = Math.hypot(x - from[i * 2], y - from[i * 2 + 1]);
      const amount = Math.min(moved * 1.5 * strength(), 0.01);
      if (amount > 0.0002 || splash) {
        drops[count++].set(x, y, 0.035, splash ? 0.03 : amount * 0.5);
      }
      from[i * 2] = x;
      from[i * 2 + 1] = y;
    }
  } else if (splash) {
    drops[count++].set(0.5, 0.5, 0.06, 0.1);
  }
  splash = false;
  simMaterial.uniforms.dropCount.value = count;
}

function step() {
  simMaterial.uniforms.water.value = targets[0].texture;
  quad.material = simMaterial;
  renderer.setRenderTarget(targets[1]);
  renderer.render(quadScene, quadCamera);
  renderer.setRenderTarget(null);
  targets = [targets[1], targets[0]];
}

// Runs as many steps as the time since the last frame needs, spreading the face's motion over them.
function simulate() {
  const now = performance.now();
  pendingTime = Math.min(pendingTime + (now - lastTime) / 1000, MAX_STEPS_PER_FRAME / STEPS_PER_SECOND);
  lastTime = now;
  const steps = Math.floor(pendingTime * STEPS_PER_SECOND);
  pendingTime -= steps / STEPS_PER_SECOND;
  simMaterial.uniforms.damping.value = damping();
  for (let i = 0; i < steps; i++) {
    stir(1 / (steps - i));
    step();
  }
}

async function render(landmarker) {
  // Wait for video to be ready (loadeddata).
  await av.ready();

  if (width !== av.video.videoWidth || height !== av.video.videoHeight) {
    width = av.video.videoWidth;
    height = av.video.videoHeight;
    resize();
    faceGeometry.setSize(width, height);
    faceCamera.left = -0.5 * width;
    faceCamera.right = 0.5 * width;
    faceCamera.top = 0.5 * height;
    faceCamera.bottom = -0.5 * height;
    faceCamera.updateProjectionMatrix();
    // Keep the grid cells square.
    simHeight = Math.round((SIM_WIDTH * height) / width);
    [...targets, faceMask].forEach((t) => t.setSize(SIM_WIDTH, simHeight));
    simMaterial.uniforms.delta.value.set(1 / SIM_WIDTH, 1 / simHeight);
    displayMaterial.uniforms.delta.value.set(1 / SIM_WIDTH, 1 / simHeight);
    simMaterial.uniforms.aspect.value = width / height;
  }

  // Detect the face landmarks in the current video frame.
  const result = detectVideoFrame(landmarker, av.video);
  if (status.textContent === "Detecting face...") status.textContent = "";

  const found = faceGeometry.updateFromResult(result, { flipped: flipCamera() });
  track(found);
  simulate();

  displayMaterial.uniforms.water.value = targets[0].texture;
  displayMaterial.uniforms.refraction.value = refraction();
  displayMaterial.uniforms.faceDepth.value = faceDepth();
  displayMaterial.uniforms.highlights.value = highlights();
  displayMaterial.uniforms.mirrored.value = flipCamera() ? 1 : 0;

  faceMesh.visible = holesMesh.visible = found;
  renderer.setRenderTarget(faceMask);
  renderer.render(faceScene, faceCamera);
  renderer.setRenderTarget(null);

  quad.material = displayMaterial;
  renderer.render(quadScene, quadCamera);

  requestAnimationFrame(() => render(landmarker));
}

// Init the demo, loading dependencies.
async function init() {
  try {
    await av.ready();
    const videoTexture = new VideoTexture(av.video);
    videoTexture.colorSpace = NoColorSpace;
    displayMaterial.uniforms.videoMap.value = videoTexture;
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
