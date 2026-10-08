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
// Drawn first, so the face's depth mask below doesn't cut a hole in it.
background.renderOrder = -2;
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
// An invisible copy of the face that only writes depth, to hide the part of the rim behind it.
const faceMask = new Mesh(faceGeometry, new MeshBasicMaterial({ colorWrite: false }));
faceMask.renderOrder = -1;
scene.add(faceMask);

const visor = new Mesh(faceGeometry, visorMaterial);
visor.visible = false;
scene.add(visor);

// The spectrum goes to the shader as a 128x1 texture.
const spectrum = new DataTexture(audio.spectrum, BINS, 1, RedFormat);
spectrum.minFilter = spectrum.magFilter = LinearFilter;

// Text for the marquee, in a 5x7 LED font: one canvas pixel per LED.
const TEXT_ROWS = 7;
const textCanvas = document.createElement("canvas");
const textTexture = new CanvasTexture(textCanvas);
textTexture.minFilter = textTexture.magFilter = NearestFilter;
// The shader reads the rows top-down, as they're drawn.
textTexture.flipY = false;

// Each glyph is seven rows of five bits, the leftmost dot in the highest bit.
const FONT = {
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  D: [0x1e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1e],
  E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
  F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f],
  H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  I: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  J: [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0c],
  K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
  N: [0x11, 0x11, 0x19, 0x15, 0x13, 0x11, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  Q: [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d],
  R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  S: [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e],
  T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x15, 0x0a],
  X: [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
  Y: [0x11, 0x11, 0x11, 0x0a, 0x04, 0x04, 0x04],
  Z: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
  0: [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  1: [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  2: [0x0e, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1f],
  3: [0x1f, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0e],
  4: [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  5: [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  6: [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  7: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  8: [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  9: [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
  " ": [0, 0, 0, 0, 0, 0, 0],
  ".": [0, 0, 0, 0, 0, 0x0c, 0x0c],
  ",": [0, 0, 0, 0, 0x0c, 0x04, 0x08],
  "!": [0x04, 0x04, 0x04, 0x04, 0x04, 0, 0x04],
  "?": [0x0e, 0x11, 0x01, 0x02, 0x04, 0, 0x04],
  "-": [0, 0, 0, 0x1f, 0, 0, 0],
  "+": [0, 0x04, 0x04, 0x1f, 0x04, 0x04, 0],
  "'": [0x04, 0x04, 0x08, 0, 0, 0, 0],
  ":": [0, 0x0c, 0x0c, 0, 0x0c, 0x0c, 0],
  "/": [0x01, 0x01, 0x02, 0x04, 0x08, 0x10, 0x10],
  "&": [0x0c, 0x12, 0x14, 0x08, 0x15, 0x12, 0x0d],
};

const MODES = ["bands", "equalizer", "marquee", "helmet"];

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
      } else if (mode == 2) {
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
      } else {
        // Helmet: like a robot helmet, rainbow bars in two side panels, red low notes at the
        // bottom to violet high ones at the top, each growing inwards as its band gets louder,
        // and a strip of small LEDs on the chin. The middle stays dark.
        float rows = 12.0;
        float rowPosition = (uv.y - 0.14) / 0.74 * rows;
        float row = floor(rowPosition);
        // The sides of the layout wrap around the face, so the panels start well inside it.
        float panel = 0.3;
        led = 0.0;
        halo = 0.0;
        if (row >= 0.0 && row < rows && side > panel) {
          float band = row / (rows - 1.0);
          float amount = sqrt(level(pow(band, 1.4) * 0.5));
          // The bar runs from the edge inwards, over at least a third of the panel.
          float reach = 1.0 - (1.0 - panel) * (0.35 + 0.65 * amount);
          float across = abs(fract(rowPosition) - 0.5) / 0.3;
          float along = smoothstep(reach - 0.015, reach + 0.015, side);
          led = smoothstep(1.1, 0.8, across) * along;
          halo = smoothstep(2.0, 0.0, across) * 0.35 * along;
          on = 0.35 + 0.65 * amount;
          color = hue(band * 0.8);
        } else if (uv.y > 0.06 && uv.y < 0.13 && side < 0.4) {
          // Chin strip: three rows of small LEDs, mirrored, bouncing with the spectrum.
          float stripRow = floor((uv.y - 0.06) / 0.07 * 3.0);
          float amount = sqrt(level(side * 0.6));
          led = smoothstep(0.2, 0.12, d);
          halo = smoothstep(0.5, 0.0, d) * 0.25;
          on = step(stripRow / 3.0, amount);
          color = mix(vec3(1.0, 0.6, 0.1), vec3(1.0, 0.15, 0.1), stripRow / 2.0);
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

// Draws the text dot by dot, six columns per character: five for the glyph and a gap.
function drawText(text) {
  const characters = [...text.toUpperCase()];
  const w = characters.length * 6;
  textCanvas.width = w;
  textCanvas.height = TEXT_ROWS;
  const ctx = textCanvas.getContext("2d");
  ctx.fillStyle = "white";
  characters.forEach((character, i) => {
    const glyph = FONT[character] || FONT["?"];
    for (let row = 0; row < TEXT_ROWS; row++) {
      for (let column = 0; column < 5; column++) {
        if (glyph[row] & (0x10 >> column)) ctx.fillRect(i * 6 + column, row, 1, 1);
      }
    }
  });
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
  ["helmet", "Helmet"],
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
  leds.visible = faceMask.visible = found;
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
