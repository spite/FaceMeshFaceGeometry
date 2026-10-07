import {
  WebGLRenderer,
  Scene,
  OrthographicCamera,
  Mesh,
  MeshBasicMaterial,
  Vector3,
} from "three";
import { FaceMeshFaceGeometry } from "../../js/face.js";
import { createFaceLandmarker } from "../landmarker.js";
import { createGUI, addMirrorToggle, signal } from "../gui.js";

const av = document.querySelector("gum-av");
const canvas = document.querySelector("canvas");
const status = document.querySelector("#status");

const renderer = new WebGLRenderer({ antialias: true, alpha: true, canvas });
renderer.setPixelRatio(window.devicePixelRatio);

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

// Create a new geometry helper.
const faceGeometry = new FaceMeshFaceGeometry();

// Wireframe of the face mesh, to see what the labels are attached to.
const mesh = new Mesh(
  faceGeometry,
  new MeshBasicMaterial({ color: 0xff00ff, wireframe: true })
);
scene.add(mesh);

const labels = signal(true);
const wireframe = signal(false);

const gui = createGUI();
gui.addCheckbox("Labels", labels);
gui.addCheckbox("Wireframe", wireframe);
const flipCamera = addMirrorToggle(gui, av);

// Labelled arrows pointing at facial features, drawn on an SVG overlay.
const svg = document.querySelector("#annotations");
const SVG_NS = "http://www.w3.org/2000/svg";
// Arrows go in a layer under the labels, so text always reads on top.
const arrowLayer = document.createElementNS(SVG_NS, "g");
const labelLayer = document.createElementNS(SVG_NS, "g");
svg.append(arrowLayer, labelLayer);
// Labels go outwards from the face center. Parts on the midline give the screen direction
// instead (degrees, clockwise from the right), and `bend` turns a label towards (+) or away
// from (-) the horizontal, to separate parts that sit close together.
const features = [
  { label: "forehead", ids: [10], direction: -90 },
  { label: "right temple", ids: [54] },
  { label: "left temple", ids: [284] },
  { label: "right eyebrow", ids: [70, 63, 105, 66, 107] },
  { label: "left eyebrow", ids: [300, 293, 334, 296, 336] },
  { label: "nose bridge", ids: [168], direction: -60 },
  { label: "right eye", ids: [33, 133], bend: 45 },
  { label: "left eye", ids: [263, 362], bend: 45 },
  { label: "right pupil", ids: [468], irises: true, bend: -25 },
  { label: "left pupil", ids: [473], irises: true, bend: -25 },
  { label: "right cheekbone", ids: [116] },
  { label: "left cheekbone", ids: [345] },
  { label: "right cheek", ids: [205] },
  { label: "left cheek", ids: [425] },
  { label: "nose tip", ids: [1], direction: 160 },
  { label: "right nostril", ids: [98] },
  { label: "left nostril", ids: [327] },
  { label: "upper lip", ids: [0], direction: 20 },
  { label: "right mouth corner", ids: [61], bend: 40 },
  { label: "left mouth corner", ids: [291], bend: 40 },
  { label: "lower lip", ids: [17], direction: 115 },
  { label: "right jaw", ids: [172] },
  { label: "left jaw", ids: [397] },
  { label: "chin", ids: [152], direction: 80 },
];
for (const feature of features) {
  // A wider black line underneath outlines the white one.
  feature.outline = document.createElementNS(SVG_NS, "line");
  feature.outline.classList.add("outline");
  feature.line = document.createElementNS(SVG_NS, "line");
  feature.line.setAttribute("marker-end", "url(#arrow)");
  feature.text = document.createElementNS(SVG_NS, "text");
  feature.text.textContent = feature.label;
  arrowLayer.append(feature.outline, feature.line);
  labelLayer.append(feature.text);
}

const featurePoint = new Vector3();
const vertex = new Vector3();
const faceCenter = new Vector3();
const LABEL_HEIGHT = 16;
const LABEL_PADDING = 4;
const LABEL_GAP = 3;
const MIN_ARROW = 12;
// Pull of a label towards its place, and the fraction of its speed left after a second.
const SPRING = 30;
const DAMPING = 0.004;
// How far, in pixels, labels wander around their place while the face is still.
const WANDER = 4;

// Projects a point in the scene to pixels in the page.
function toScreen(point, rect) {
  const ndc = point.clone().project(camera);
  return {
    x: rect.left + (ndc.x * 0.5 + 0.5) * rect.width,
    y: rect.top + (0.5 - ndc.y * 0.5) * rect.height,
  };
}

// Distance from the center of a label to the edge of its box, along a unit direction.
function boxExtent(f, ux, uy) {
  const hw = f.width / 2 + LABEL_PADDING;
  const hh = LABEL_HEIGHT / 2;
  return Math.min(
    Math.abs(ux) > 1e-6 ? hw / Math.abs(ux) : Infinity,
    Math.abs(uy) > 1e-6 ? hh / Math.abs(uy) : Infinity
  );
}

function labelBox(f) {
  const x = f.target.x + f.ox;
  const y = f.target.y + f.oy;
  const hw = f.width / 2 + LABEL_PADDING;
  return { left: x - hw, right: x + hw, top: y - LABEL_HEIGHT / 2, bottom: y + LABEL_HEIGHT / 2 };
}

// Keeps the arrow of a label between MIN_ARROW and maxArrow long.
function constrainArrow(f, maxArrow) {
  const d = Math.hypot(f.ox, f.oy) || 1;
  const ux = f.ox / d;
  const uy = f.oy / d;
  const extent = boxExtent(f, ux, uy);
  const arrow = Math.min(maxArrow, Math.max(MIN_ARROW, d - extent));
  f.ox = ux * (arrow + extent);
  f.oy = uy * (arrow + extent);
}

// Pushes overlapping labels apart, moves labels off the parts they cover, and keeps
// every arrow within its length.
function separate(shown, maxArrow) {
  for (let i = 0; i < shown.length; i++) {
    const a = shown[i];
    const boxA = labelBox(a);
    for (let j = i + 1; j < shown.length; j++) {
      const b = shown[j];
      const boxB = labelBox(b);
      const overlapX =
        Math.min(boxA.right, boxB.right) - Math.max(boxA.left, boxB.left) + LABEL_GAP;
      const overlapY =
        Math.min(boxA.bottom, boxB.bottom) - Math.max(boxA.top, boxB.top) + LABEL_GAP;
      if (overlapX <= 0 || overlapY <= 0) continue;
      // Separate along the axis of least overlap, half each.
      if (overlapX < overlapY) {
        const push = (overlapX / 2) * (boxA.left < boxB.left ? 1 : -1);
        a.ox -= push;
        b.ox += push;
      } else {
        const push = (overlapY / 2) * (boxA.top < boxB.top ? 1 : -1);
        a.oy -= push;
        b.oy += push;
      }
    }
    for (const { target } of shown) {
      const box = labelBox(a);
      const left = target.x - box.left + 3;
      const right = box.right + 3 - target.x;
      const up = target.y - box.top + 3;
      const down = box.bottom + 3 - target.y;
      if (left <= 0 || right <= 0 || up <= 0 || down <= 0) continue;
      // Move off the point the short way.
      const m = Math.min(left, right, up, down);
      if (m === left) a.ox += left;
      else if (m === right) a.ox -= right;
      else if (m === up) a.oy += up;
      else a.oy -= down;
    }
  }
  for (const f of shown) constrainArrow(f, maxArrow);
}

function updateAnnotations(visible, dt) {
  const time = performance.now() / 1000;
  svg.style.display = visible ? "block" : "none";
  if (!visible) {
    // Start afresh where the face reappears.
    for (const f of features) f.lastTarget = null;
    return;
  }
  const rect = canvas.getBoundingClientRect();
  faceCenter.copy(faceGeometry.boundingSphere.center);
  const center = toScreen(faceCenter, rect);
  const radius = faceGeometry.boundingSphere.radius * (rect.height / height);
  const maxArrow = Math.min(110, Math.max(40, radius * 0.45));

  const shown = [];
  for (const f of features) {
    const visible = !f.irises || faceGeometry.hasIrises;
    f.outline.style.display = f.line.style.display = f.text.style.display = visible
      ? ""
      : "none";
    if (!visible) continue;
    featurePoint.set(0, 0, 0);
    for (const id of f.ids) {
      if (f.irises) {
        featurePoint.add(
          id === 468 ? faceGeometry.rightIris.position : faceGeometry.leftIris.position
        );
      } else {
        featurePoint.add(vertex.fromArray(faceGeometry.positions, id * 3));
      }
    }
    featurePoint.divideScalar(f.ids.length);
    f.target = toScreen(featurePoint, rect);
    if (!f.width) f.width = f.text.getComputedTextLength();
    // Each label wants to sit outwards from its part, halfway to the longest arrow.
    let angle =
      f.direction !== undefined
        ? (f.direction * Math.PI) / 180
        : Math.atan2(f.target.y - center.y, f.target.x - center.x);
    if (f.bend) {
      const outward = Math.cos(angle) >= 0 ? 1 : -1;
      const up = Math.sin(angle) < 0 ? 1 : -1;
      angle += ((f.bend * Math.PI) / 180) * outward * up;
    }
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    const reach = 0.6 * maxArrow + boxExtent(f, ux, uy);
    if (f.ox === undefined) {
      f.ox = ux * reach;
      f.oy = uy * reach;
      f.vx = f.vy = 0;
      f.phase = Math.random() * 2 * Math.PI;
      f.speed = 0.4 + Math.random() * 0.6;
    }
    // Labels stay put on screen as the face moves, and their spring catches them up.
    // A jump, like toggling the mirror, puts them straight back in place instead.
    if (f.lastTarget) {
      const dx = f.target.x - f.lastTarget.x;
      const dy = f.target.y - f.lastTarget.y;
      if (Math.hypot(dx, dy) > 0.5 * radius) {
        f.ox = ux * reach;
        f.oy = uy * reach;
        f.vx = f.vy = 0;
      } else {
        f.ox -= dx;
        f.oy -= dy;
      }
    }
    f.lastTarget = f.target;
    // Their place wanders slowly, so they keep drifting while the face is still.
    const t = time * f.speed + f.phase;
    f.px = ux * reach + WANDER * Math.sin(t);
    f.py = uy * reach + WANDER * Math.cos(1.3 * t);
    shown.push(f);
  }

  // Step the label physics: a spring pulls each label towards its place, and
  // collisions keep it off other labels, off the parts, and within its arrow length.
  const substeps = 4;
  const h = dt / substeps;
  for (let step = 0; step < substeps; step++) {
    for (const f of shown) {
      f.vx += SPRING * (f.px - f.ox) * h;
      f.vy += SPRING * (f.py - f.oy) * h;
      const damping = Math.pow(DAMPING, h);
      f.vx *= damping;
      f.vy *= damping;
      f.lastX = f.ox;
      f.lastY = f.oy;
      f.ox += f.vx * h;
      f.oy += f.vy * h;
    }
    for (let iteration = 0; iteration < 8; iteration++) {
      separate(shown, maxArrow);
    }
    // Velocities follow what the collisions did to the positions.
    for (const f of shown) {
      f.vx = (f.ox - f.lastX) / h;
      f.vy = (f.oy - f.lastY) / h;
    }
  }

  for (const f of shown) {
    const x = Math.min(rect.right - f.width / 2, Math.max(rect.left + f.width / 2, f.target.x + f.ox));
    const y = Math.min(rect.bottom - LABEL_HEIGHT, Math.max(rect.top + LABEL_HEIGHT, f.target.y + f.oy));
    const dx = x - f.target.x;
    const dy = y - f.target.y;
    const d = Math.hypot(dx, dy) || 1;
    const ux = dx / d;
    const uy = dy / d;
    // From the edge of the label to just short of the part, for the arrowhead.
    const start = Math.max(4, d - boxExtent(f, ux, uy));
    for (const line of [f.outline, f.line]) {
      line.setAttribute("x1", f.target.x + ux * start);
      line.setAttribute("y1", f.target.y + uy * start);
      line.setAttribute("x2", f.target.x + ux * 4);
      line.setAttribute("y2", f.target.y + uy * 4);
    }
    f.text.setAttribute("x", x);
    f.text.setAttribute("y", y);
    f.text.setAttribute("text-anchor", "middle");
  }
}

let lastTime = performance.now();
let lastFlip;

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
  const faces = landmarker.detectForVideo(
    av.video,
    performance.now()
  ).faceLandmarks;

  av.style.opacity = 1;
  status.textContent = "";

  // There's at least one face.
  if (faces.length > 0) {
    // Update face mesh geometry with new data.
    faceGeometry.update(faces[0], flipCamera());
    // Mirroring swaps the sides of the face, so the labels start over.
    if (flipCamera() !== lastFlip) {
      lastFlip = flipCamera();
      for (const f of features) f.ox = f.lastTarget = undefined;
    }
  }
  mesh.visible = wireframe() && faces.length > 0;
  const now = performance.now();
  updateAnnotations(labels() && faces.length > 0, Math.min(0.05, (now - lastTime) / 1000));
  lastTime = now;

  renderer.render(scene, camera);

  requestAnimationFrame(() => render(landmarker));
}

// Init the demo, loading dependencies.
async function init() {
  try {
    await av.ready();
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
