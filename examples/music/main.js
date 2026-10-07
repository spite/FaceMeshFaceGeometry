import {
  WebGLRenderer,
  Scene,
  OrthographicCamera,
  Mesh,
  PlaneGeometry,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  ShaderMaterial,
  DataTexture,
  CanvasTexture,
  VideoTexture,
  RedFormat,
  LinearFilter,
  NearestFilter,
  TextureLoader,
  AdditiveBlending,
  SRGBColorSpace,
  PMREMGenerator,
  CatmullRomCurve3,
  TubeGeometry,
  DirectionalLight,
  Vector2,
  Vector3,
} from "three";
import { EffectComposer } from "https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/postprocessing/ShaderPass.js";
import { RoomEnvironment } from "https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/environments/RoomEnvironment.js";
import { FaceMeshFaceGeometry } from "../../js/face.js";
import { createFaceLandmarker } from "../landmarker.js";
import {
  createGUI,
  addMirrorToggle,
  addSmoothingToggle,
  signal,
} from "../gui.js";
import { AudioInput, BINS } from "./audio.js";

const av = document.querySelector("gum-av");
const canvas = document.querySelector("canvas");
const status = document.querySelector("#status");

const renderer = new WebGLRenderer({ antialias: true, canvas });
renderer.setPixelRatio(window.devicePixelRatio);

const scene = new Scene();
const camera = new OrthographicCamera(1, 1, 1, 1, -1000, 1000);

// Reflections for the visor and the gold rim.
const pmrem = new PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

// Only the LEDs glow: they're rendered alone into a bloom pass, and the result is added
// on top of the normal render, so the video stays sharp.
const BLOOM_LAYER = 1;
const bloomComposer = new EffectComposer(renderer);
bloomComposer.renderToScreen = false;
bloomComposer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new Vector2(1, 1), 1, 0.4, 0);
bloomComposer.addPass(bloom);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(
  new ShaderPass(
    new ShaderMaterial({
      uniforms: {
        baseTexture: { value: null },
        bloomTexture: { value: bloomComposer.renderTarget2.texture },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D baseTexture;
        uniform sampler2D bloomTexture;
        varying vec2 vUv;
        void main() {
          gl_FragColor = texture2D(baseTexture, vUv) + texture2D(bloomTexture, vUv);
        }
      `,
    }),
    "baseTexture"
  )
);
composer.addPass(new OutputPass());

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
  bloomComposer.setSize(adjustedWidth, adjustedHeight);
  composer.setSize(adjustedWidth, adjustedHeight);
}

window.addEventListener("resize", () => {
  resize();
});

const audio = new AudioInput();

// The video is drawn on a plane behind the face, to dim it and render it with everything else.
const videoMaterial = new MeshBasicMaterial({ color: 0x505060 });
const background = new Mesh(new PlaneGeometry(1, 1), videoMaterial);
background.position.z = -500;
scene.add(background);

const faceGeometry = new FaceMeshFaceGeometry();
const mask = new TextureLoader().load("../../assets/mask.png");

// An optional visor: black glass over the face, fading at the edges, for a helmet look.
const visorMaterial = new MeshPhysicalMaterial({
  color: 0x020204,
  roughness: 0.5,
  metalness: 0,
  clearcoat: 0.4,
  clearcoatRoughness: 0.35,
  envMapIntensity: 0.15,
  alphaMap: mask,
  transparent: true,
});
const visor = new Mesh(faceGeometry, visorMaterial);
visor.visible = false;
scene.add(visor);

// The spectrum goes to the shader as a 128x1 texture.
const spectrum = new DataTexture(audio.spectrum, BINS, 1, RedFormat);
spectrum.minFilter = spectrum.magFilter = LinearFilter;

// Text for the marquee, drawn one LED row per pixel.
const TEXT_ROWS = 9;
const textCanvas = document.createElement("canvas");
const textTexture = new CanvasTexture(textCanvas);
textTexture.minFilter = textTexture.magFilter = NearestFilter;

const MODES = ["bands", "equalizer", "marquee"];

// The LEDs behind the visor: a dot matrix laid out on the canonical texture coordinates.
const ledMaterial = new ShaderMaterial({
  uniforms: {
    spectrum: { value: spectrum },
    text: { value: textTexture },
    textLength: { value: 1 },
    mask: { value: mask },
    time: { value: 0 },
    bass: { value: 0 },
    brightness: { value: 1 },
    mode: { value: 0 },
    mirrored: { value: 0 },
    visor: { value: 0 },
    vertical: { value: 0 },
    gridSize: { value: new Vector2(44, 34) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D spectrum;
    uniform sampler2D text;
    uniform float textLength;
    uniform sampler2D mask;
    uniform float time;
    uniform float bass;
    uniform float brightness;
    uniform int mode;
    uniform float mirrored;
    uniform float visor;
    uniform float vertical;
    uniform vec2 gridSize;
    varying vec2 vUv;

    vec3 hue(float h) {
      return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
    }

    float level(float f) {
      return texture2D(spectrum, vec2(f, 0.5)).r;
    }

    void main() {
      // Mirroring the mesh mirrors its texture, so flip back to keep the text readable.
      vec2 uv = vec2(mix(vUv.x, 1.0 - vUv.x, mirrored), vUv.y);
      vec2 grid = gridSize;
      vec2 cell = floor(uv * grid);
      vec2 local = fract(uv * grid) - 0.5;
      // A rounded LED in each cell, with a soft halo.
      float d = length(max(abs(local) - 0.18, 0.0));
      float led = smoothstep(0.2, 0.12, d);
      float halo = smoothstep(0.5, 0.0, d) * 0.25;

      // Distance from the vertical middle line, from 0 to 1.
      float side = abs(cell.x + 0.5 - grid.x * 0.5) / (grid.x * 0.5);
      float y = (cell.y + 0.5) / grid.y;
      vec3 color = vec3(0.0);
      float on = 0.0;
      // Vertical stands the bars up, keeping them mirrored left to right.
      bool upright = vertical > 0.5;

      if (mode == 0) {
        if (upright) {
          // Bands, upright: a rainbow column per frequency band, mirrored left to right, low
          // notes at the sides, rising from the chin up to the forehead as it gets louder.
          float band = 1.0 - side;
          float amount = sqrt(level(pow(band, 1.4) * 0.45));
          on = step(y, amount);
          color = hue(band * 0.8);
        } else {
          // Bands: a rainbow row per frequency band, low notes on the forehead, lit from the
          // sides inwards as it gets louder. Higher notes reach less far, so cymbals don't fill it.
          float f = pow(1.0 - y, 1.6) * 0.55;
          float amount = sqrt(level(f)) * (0.9 - 0.6 * f);
          on = step(1.0 - amount, side);
          color = hue(y * 0.8);
        }
      } else if (mode == 1) {
        // Equalizer: columns from the middle outwards rising from the chin, or rows from the
        // chin up growing from the middle outwards.
        float f = upright ? y : side;
        float amount = sqrt(level(pow(f, 1.4) * 0.6)) * 0.95;
        float position = upright ? side : y;
        on = step(position, amount);
        color = mix(vec3(0.1, 1.0, 0.3), vec3(1.0, 0.85, 0.1), smoothstep(0.35, 0.6, position));
        color = mix(color, vec3(1.0, 0.1, 0.1), smoothstep(0.65, 0.8, position));
      } else {
        color = mix(vec3(1.0, 0.15, 0.1), vec3(1.0, 0.6, 0.1), bass);
        if (upright) {
          // Marquee: text scrolling down the middle of the face, turned a quarter turn.
          float right = floor(grid.x * 0.5 + ${TEXT_ROWS}.0 * 0.5);
          float textRow = right - cell.x;
          if (textRow >= 0.0 && textRow < ${TEXT_ROWS}.0) {
            float x = mod(grid.y - cell.y + floor(time * 12.0), textLength);
            vec2 t = vec2((x + 0.5) / textLength, (textRow + 0.5) / ${TEXT_ROWS}.0);
            on = step(0.5, texture2D(text, t).r) * (0.6 + bass);
          }
        } else {
          // Marquee: scrolling text across the eyes, pulsing with the bass, over a level meter.
          float top = floor(grid.y * 0.62);
          float textRow = top - cell.y;
          if (textRow >= 0.0 && textRow < ${TEXT_ROWS}.0) {
            float x = mod(cell.x + floor(time * 12.0), textLength);
            vec2 t = vec2((x + 0.5) / textLength, (textRow + 0.5) / ${TEXT_ROWS}.0);
            on = step(0.5, texture2D(text, t).r) * (0.6 + bass);
          } else if (textRow == ${TEXT_ROWS}.0 + 2.0) {
            on = step(side, sqrt(level(side * 0.5)));
            color = vec3(0.2, 0.6, 1.0);
          }
        }
      }

      // Behind the visor, unlit LEDs stay faintly visible through the glass.
      vec3 lit = color * on * (led + halo * 0.6);
      vec3 off = vec3(0.015, 0.015, 0.025) * led * (1.0 - step(0.01, on)) * visor;
      gl_FragColor = vec4((lit * brightness + off) * texture2D(mask, vUv).g, 1.0);
    }
  `,
  blending: AdditiveBlending,
  transparent: true,
  depthWrite: false,
});
const leds = new Mesh(faceGeometry, ledMaterial);
leds.renderOrder = 1;
leds.layers.enable(BLOOM_LAYER);
scene.add(leds);

function drawText(text) {
  const ctx = textCanvas.getContext("2d");
  const font = `bold ${TEXT_ROWS + 2}px monospace`;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width);
  textCanvas.width = w;
  textCanvas.height = TEXT_ROWS;
  ctx.font = font;
  ctx.textBaseline = "middle";
  ctx.fillStyle = "white";
  ctx.fillText(text, 0, TEXT_ROWS / 2 + 1);
  textTexture.dispose();
  textTexture.needsUpdate = true;
  ledMaterial.uniforms.textLength.value = w;
}

// A gold rim around the visor, following the outline of the face.
const FACE_OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378,
  400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21,
  54, 103, 67, 109,
];
const rimPoints = FACE_OVAL.map(() => new Vector3());
const rimCurve = new CatmullRomCurve3(rimPoints, true);
const rim = new Mesh(
  new TubeGeometry(rimCurve, 4, 1, 4, true),
  new MeshStandardMaterial({ color: 0xd8a640, metalness: 1, roughness: 0.22 })
);
scene.add(rim);

function updateRim() {
  const radius = faceGeometry.boundingSphere.radius;
  for (let i = 0; i < FACE_OVAL.length; i++) {
    rimPoints[i].fromArray(faceGeometry.positions, FACE_OVAL[i] * 3);
    rimPoints[i].z += radius * 0.05;
  }
  // The curve caches its length, so it needs refreshing after the points move.
  rimCurve.updateArcLengths();
  rim.geometry.dispose();
  rim.geometry = new TubeGeometry(rimCurve, 144, radius * 0.035, 12, true);
}

const light = new DirectionalLight(0xffffff, 1);
light.position.set(0.5, 1, 1);
scene.add(light);

const mode = signal("bands");
const brightness = signal(1);
const glow = signal(1);
const dim = signal(0.8);
const showVisor = signal(false);
const vertical = signal(false);
const showRim = signal(true);
const message = signal("FACE MESH FACE GEOMETRY");

const gui = createGUI();
gui.addButtons(null, [
  { label: "Play beat", onClick: () => start(() => audio.playBeat(), "Synthesized beat") },
  { label: "Microphone", onClick: () => start(() => audio.useMicrophone(), "Microphone") },
]);
gui.addFileButton(
  "Load music…",
  (file) => start(() => audio.playFile(file), file.name),
  { accept: "audio/*" }
);
gui.addButton("Stop", () => {
  audio.stop();
  audio.stop = () => {};
  status.textContent = "Pick a sound in the panel.";
});
gui.addSegmented("LEDs", mode, [
  ["bands", "Bands"],
  ["equalizer", "Equalizer"],
  ["marquee", "Marquee"],
]);
gui.addTextInput("Text", message, {
  visibleWhen: () => mode() === "marquee",
  onChange: (text) => drawText(`   ${text.toUpperCase()}   `),
});
gui.addCheckbox("Vertical", vertical, { title: "Stand the bars up, still mirrored left to right" });
gui.addCheckbox("Visor", showVisor, { title: "Cover the face with black glass, like a helmet" });
gui.addCheckbox("Gold rim", showRim);
gui.addSlider("Brightness", brightness, 0, 3, 0.05);
gui.addSlider("Glow", glow, 0, 3, 0.05);
gui.addSlider("Background", dim, 0, 1, 0.05, {
  title: "Brightness of the video",
});
const flipCamera = addMirrorToggle(gui, av);
addSmoothingToggle(gui, faceGeometry);

drawText(`   ${message.peek()}   `);

async function start(play, name) {
  try {
    await play();
    status.textContent = `Listening to: ${name}`;
  } catch (e) {
    status.textContent = e.message;
    console.error(e);
  }
}

async function render(landmarker) {
  // Wait for video to be ready (loadeddata).
  await av.ready();
  av.video.style.display = "none";
  av.style.opacity = 1;

  // Resize orthographic camera and background to video dimensions if necessary.
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
  background.scale.set(flipCamera() ? -width : width, height, 1);

  // Detect the face landmarks in the current video frame.
  const result = landmarker.detectForVideo(av.video, performance.now());
  const found = faceGeometry.updateFromResult(result, { flipped: flipCamera() });
  leds.visible = found;
  visor.visible = found && showVisor();
  rim.visible = found && showRim();
  if (rim.visible) updateRim();

  audio.update();
  spectrum.needsUpdate = true;
  const u = ledMaterial.uniforms;
  u.time.value = performance.now() / 1000;
  u.bass.value = audio.bass;
  u.brightness.value = brightness();
  u.mode.value = MODES.indexOf(mode());
  u.mirrored.value = flipCamera() ? 1 : 0;
  u.visor.value = showVisor() ? 1 : 0;
  u.vertical.value = vertical() ? 1 : 0;
  bloom.strength = glow() * (1 + audio.bass * 0.3);
  videoMaterial.color.setScalar(dim());

  camera.layers.set(BLOOM_LAYER);
  bloomComposer.render();
  camera.layers.set(0);
  composer.render();

  requestAnimationFrame(() => render(landmarker));
}

// Init the demo, loading dependencies.
async function init() {
  try {
    await av.ready();
    const videoTexture = new VideoTexture(av.video);
    videoTexture.colorSpace = SRGBColorSpace;
    videoMaterial.map = videoTexture;
    videoMaterial.needsUpdate = true;
    status.textContent = "Loading model...";
    const landmarker = await createFaceLandmarker({ numFaces: 1 });
    status.textContent = "Pick a sound in the panel.";
    render(landmarker);
  } catch (e) {
    status.textContent = e.message;
    throw e;
  }
}

init();
