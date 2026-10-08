import {
  WebGLRenderer,
  SRGBColorSpace,
  Scene,
  OrthographicCamera,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  BufferGeometry,
  BufferAttribute,
  DynamicDrawUsage,
  VideoTexture,
} from "three";
import { FaceMeshFaceGeometry, FACES, UVS } from "../../js/face.js";
import { createFaceLandmarker } from "../landmarker.js";
import { createGUI, addMirrorToggle, addSmoothingToggle, signal } from "../gui.js";

const av = document.querySelector("gum-av");
const canvas = document.querySelector("canvas");
const status = document.querySelector("#status");

const renderer = new WebGLRenderer({ antialias: true, canvas });
renderer.setPixelRatio(window.devicePixelRatio);

const scene = new Scene();
const camera = new OrthographicCamera(1, 1, 1, 1, -1000, 1000);

let width = 0;
let height = 0;

function resize() {
  const videoAspectRatio = width / height;
  const windowAspectRatio = window.innerWidth / window.innerHeight;
  if (videoAspectRatio > windowAspectRatio) {
    renderer.setSize(window.innerWidth, window.innerWidth / videoAspectRatio);
  } else {
    renderer.setSize(window.innerHeight * videoAspectRatio, window.innerHeight);
  }
}

window.addEventListener("resize", resize);

// Outer corner, inner corner, top and bottom of each eye, and the corners of the mouth.
const RIGHT_EYE = [33, 133, 159, 145];
const LEFT_EYE = [263, 362, 386, 374];
const MOUTH_CORNERS = [61, 291];
const NOSE_TIP = 1;
// The tip, bridge and wings of the nose, and the two eyebrows from the inside out.
const NOSE = [1, 4, 5, 195, 98, 327];
const NOSE_WINGS = [98, 327];
const RIGHT_BROW = [107, 66, 105, 63, 70];
const LEFT_BROW = [336, 296, 334, 293, 300];

const NUM_LANDMARKS = 468;

// Groups the mesh's open edges into loops, biggest first: the face outline, then the mouth hole.
function boundaryLoops(indices) {
  const count = new Map();
  for (let i = 0; i < indices.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const a = indices[i + k];
      const b = indices[i + ((k + 1) % 3)];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      const entry = count.get(key);
      if (entry) entry.n++;
      else count.set(key, { n: 1, a, b });
    }
  }
  const edges = [...count.values()].filter((e) => e.n === 1);
  const loops = [];
  const loopOf = new Map();
  for (const edge of edges) {
    let loop = loopOf.get(edge.a) || loopOf.get(edge.b);
    if (!loop) loops.push((loop = { vertices: new Set(), edges: [] }));
    loop.edges.push(edge);
    for (const v of [edge.a, edge.b]) {
      const other = loopOf.get(v);
      if (other && other !== loop) {
        for (const e of other.edges) loop.edges.push(e);
        for (const u of other.vertices) {
          loop.vertices.add(u);
          loopOf.set(u, loop);
        }
        loops.splice(loops.indexOf(other), 1);
      }
      loop.vertices.add(v);
      loopOf.set(v, loop);
    }
  }
  return loops.sort((a, b) => b.vertices.size - a.vertices.size);
}

const [outline, mouthHole] = boundaryLoops(FACES);

// A fan from an extra vertex fills the mouth hole, so an open mouth warps with the lips.
const MOUTH_CENTER = NUM_LANDMARKS;
const BASE_COUNT = NUM_LANDMARKS + 1;
const baseFaces = [...FACES];
for (const { a, b } of mouthHole.edges) baseFaces.push(b, a, MOUTH_CENTER);
const mouthLoop = [...mouthHole.vertices];

// The warp fades out over the outer rings of the mesh, so its edge stays put on the video.
const EDGE_RINGS = 3;
const rings = new Array(BASE_COUNT).fill(Infinity);
const neighbours = Array.from({ length: BASE_COUNT }, () => new Set());
for (let i = 0; i < baseFaces.length; i += 3) {
  for (let k = 0; k < 3; k++) {
    neighbours[baseFaces[i + k]].add(baseFaces[i + ((k + 1) % 3)]);
    neighbours[baseFaces[i + ((k + 1) % 3)]].add(baseFaces[i + k]);
  }
}
const queue = [...outline.vertices];
for (const v of queue) rings[v] = 0;
for (let q = 0; q < queue.length; q++) {
  for (const n of neighbours[queue[q]]) {
    if (rings[n] === Infinity) {
      rings[n] = rings[queue[q]] + 1;
      queue.push(n);
    }
  }
}
const smoothstep = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const baseEdge = rings.map((r) => smoothstep(r / EDGE_RINGS));

// Splits each triangle into DIVISIONS² so the warp bends smoothly; each vertex is a fixed blend of its corners.
const DIVISIONS = 4;
const perTriangle = ((DIVISIONS + 1) * (DIVISIONS + 2)) / 2;
const triangleCount = baseFaces.length / 3;
const vertexCount = triangleCount * perTriangle;
const corners = new Uint16Array(vertexCount * 3);
const weights = new Float32Array(vertexCount * 3);
const edge = new Float32Array(vertexCount);
const index = [];
const rowStart = [];
for (let i = 0, offset = 0; i <= DIVISIONS; i++) {
  rowStart.push(offset);
  offset += DIVISIONS + 1 - i;
}
for (let t = 0; t < triangleCount; t++) {
  const first = t * perTriangle;
  const id = (i, j) => first + rowStart[i] + j;
  for (let i = 0; i <= DIVISIONS; i++) {
    for (let j = 0; j <= DIVISIONS - i; j++) {
      const v = id(i, j);
      const w = [i / DIVISIONS, j / DIVISIONS, (DIVISIONS - i - j) / DIVISIONS];
      edge[v] = 0;
      for (let k = 0; k < 3; k++) {
        corners[v * 3 + k] = baseFaces[t * 3 + k];
        weights[v * 3 + k] = w[k];
        edge[v] += w[k] * baseEdge[baseFaces[t * 3 + k]];
      }
      if (j < DIVISIONS - i) index.push(v, id(i + 1, j), id(i, j + 1));
      if (j < DIVISIONS - i - 1) index.push(id(i + 1, j), id(i + 1, j + 1), id(i, j + 1));
    }
  }
}

const warped = new BufferGeometry();
const positions = new Float32Array(vertexCount * 3);
const uvs = new Float32Array(vertexCount * 2);
const colors = new Float32Array(vertexCount * 3).fill(1);
warped.setAttribute("position", new BufferAttribute(positions, 3).setUsage(DynamicDrawUsage));
warped.setAttribute("uv", new BufferAttribute(uvs, 2).setUsage(DynamicDrawUsage));
warped.setAttribute("color", new BufferAttribute(colors, 3).setUsage(DynamicDrawUsage));
warped.setIndex(index);

// Bumps sit on landmarks away from the eyes, mouth, nose tip and outline, picked with a fixed seed.
function pickBumps(count) {
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const uvCenter = (ids) => ids.reduce((c, i) => [c[0] + UVS[i][0] / ids.length, c[1] + UVS[i][1] / ids.length], [0, 0]);
  const avoid = [
    [uvCenter(RIGHT_EYE), 0.11],
    [uvCenter(LEFT_EYE), 0.11],
    [uvCenter(MOUTH_CORNERS), 0.17],
    [UVS[NOSE_TIP], 0.08],
    // The bridge of the nose and the eyebrows, where bumps look out of place.
    [UVS[6], 0.07],
    [uvCenter(RIGHT_BROW), 0.06],
    [uvCenter(LEFT_BROW), 0.06],
  ];
  const bumps = [];
  for (let attempt = 0; attempt < 5000 && bumps.length < count; attempt++) {
    const landmark = Math.floor(random() * NUM_LANDMARKS);
    if (rings[landmark] < 2) continue;
    const [u, v] = UVS[landmark];
    const near = ([[x, y], r]) => Math.hypot(u - x, v - y) < r;
    if (avoid.some(near)) continue;
    if (bumps.some((b) => Math.hypot(u - UVS[b.landmark][0], v - UVS[b.landmark][1]) < 0.065)) continue;
    bumps.push({ landmark, size: 0.22 + 0.18 * random(), phase: random() * Math.PI * 2, speed: 0.8 + random() });
  }
  return bumps;
}
const bumps = pickBumps(22);

// The video is drawn in the same canvas as the face, so both show the same frame.
const background = new Mesh(
  new PlaneGeometry(1, 1),
  // Double-sided because mirroring scales the plane by -1 in x.
  new MeshBasicMaterial({ depthWrite: false, side: DoubleSide })
);
background.position.z = -999;
background.renderOrder = -1;
scene.add(background);

const face = new Mesh(
  warped,
  new MeshBasicMaterial({ vertexColors: true, side: DoubleSide })
);
scene.add(face);

const wireframe = new Mesh(
  warped,
  new MeshBasicMaterial({ color: 0xff00ff, wireframe: true, depthTest: false })
);
scene.add(wireframe);

// Video-pixel positions to warp, and texture coordinates that stay on the real landmarks.
const faceGeometry = new FaceMeshFaceGeometry({ useVideoTexture: true });

const eyeSize = signal(0.5);
const eyeSpacing = signal(-0.2);
const mouthSize = signal(0.35);
const noseSize = signal(0);
const noseHeight = signal(0);
const browHeight = signal(0);
const bumpiness = signal(0);
const pulse = signal(true);
const showWireframe = signal(false);

// Eye size, eye spacing, mouth size, nose size, nose height, eyebrow height, bumps.
const presets = {
  Reset: [0, 0, 0, 0, 0, 0, 0],
  Cartoon: [0.7, -0.25, 0.3, -0.2, 0, 0.4, 0],
  Alien: [1, 0.2, -0.45, -0.4, 0.3, 0.6, 0],
  Toad: [0.3, 0.35, 0.7, 0.4, -0.3, -0.4, 0.8],
};
const shapes = [eyeSize, eyeSpacing, mouthSize, noseSize, noseHeight, browHeight, bumpiness];

const gui = createGUI();
gui.addButtons(
  null,
  Object.entries(presets).map(([label, values]) => ({
    label,
    onClick: () => shapes.forEach((s, i) => s.set(values[i])),
  }))
);
gui.addSlider("Eye size", eyeSize, -0.5, 1, 0.01);
gui.addSlider("Eye spacing", eyeSpacing, -0.5, 0.5, 0.01, {
  title: "Below zero moves the eyes closer together, above zero further apart",
});
gui.addSlider("Mouth size", mouthSize, -0.5, 1, 0.01);
gui.addSlider("Nose size", noseSize, -0.5, 1, 0.01);
gui.addSlider("Nose height", noseHeight, -1, 1, 0.01, {
  title: "Moves the nose up or down the face",
});
gui.addSlider("Eyebrow height", browHeight, -1, 1, 0.01, {
  title: "Raises or lowers both eyebrows",
});
gui.addSlider("Bumps", bumpiness, 0, 1, 0.01);
gui.addCheckbox("Pulse bumps", pulse);
gui.addCheckbox("Wireframe", showWireframe);
const flipCamera = addMirrorToggle(gui, av);
addSmoothingToggle(gui, faceGeometry);

// Base vertices: the landmarks plus the middle of the mouth, in pixels and video texture coordinates.
const bx = new Float32Array(BASE_COUNT);
const by = new Float32Array(BASE_COUNT);
const bz = new Float32Array(BASE_COUNT);
const bu = new Float32Array(BASE_COUNT);
const bv = new Float32Array(BASE_COUNT);

function readBase() {
  const p = faceGeometry.positions;
  const t = faceGeometry.uvs;
  bx[MOUTH_CENTER] = by[MOUTH_CENTER] = bz[MOUTH_CENTER] = bu[MOUTH_CENTER] = bv[MOUTH_CENTER] = 0;
  for (let j = 0; j < NUM_LANDMARKS; j++) {
    bx[j] = p[j * 3];
    by[j] = p[j * 3 + 1];
    bz[j] = p[j * 3 + 2];
    bu[j] = t[j * 2];
    bv[j] = t[j * 2 + 1];
  }
  for (const j of mouthLoop) {
    bx[MOUTH_CENTER] += bx[j] / mouthLoop.length;
    by[MOUTH_CENTER] += by[j] / mouthLoop.length;
    bz[MOUTH_CENTER] += bz[j] / mouthLoop.length;
    bu[MOUTH_CENTER] += bu[j] / mouthLoop.length;
    bv[MOUTH_CENTER] += bv[j] / mouthLoop.length;
  }
}

const centerOf = (ids) => ids.reduce((c, i) => ({ x: c.x + bx[i] / ids.length, y: c.y + by[i] / ids.length }), { x: 0, y: 0 });
const distance = (a, b) => Math.hypot(bx[a] - bx[b], by[a] - by[b]);

// Falloff of every effect; a magnification with it stays fold-free up to a scale of about 1.25.
const falloff = (x) => (x >= 1 ? 0 : (1 - x * x) * (1 - x * x));
const falloffSlope = (x) => (x >= 1 ? 0 : -4 * x * (1 - x * x));

// Light from the top left of the screen, for the shading of the bumps.
const LIGHT = { x: -0.6, y: 0.8 };
const SHADING = 0.35;

function buildEffects(time) {
  const eyes = [RIGHT_EYE, LEFT_EYE].map((ids, i) => {
    const iris = i === 0 ? faceGeometry.rightIris : faceGeometry.leftIris;
    return faceGeometry.hasIrises ? { x: iris.position.x, y: iris.position.y } : centerOf(ids);
  });
  const eyeWidth = (distance(33, 133) + distance(263, 362)) / 2;
  const mid = { x: (eyes[0].x + eyes[1].x) / 2, y: (eyes[0].y + eyes[1].y) / 2 };
  const mouth = centerOf([...MOUTH_CORNERS, 13, 14]);
  const mouthWidth = distance(...MOUTH_CORNERS);

  const magnify = [];
  const move = [];
  for (const eye of eyes) {
    magnify.push({ ...eye, radius: eyeWidth * 1.1, scale: eyeSize(), bump: false });
    move.push({
      ...eye,
      radius: eyeWidth * 1.7,
      dx: (eye.x - mid.x) * eyeSpacing(),
      dy: (eye.y - mid.y) * eyeSpacing(),
    });
  }
  magnify.push({ ...mouth, radius: mouthWidth * 1.0, scale: mouthSize(), bump: false });

  // Up and down follow the face, from the chin to the forehead, so a tilted head still works.
  const faceHeight = distance(152, 10);
  const up = { x: (bx[10] - bx[152]) / faceHeight, y: (by[10] - by[152]) / faceHeight };

  const nose = centerOf(NOSE);
  const noseWidth = distance(...NOSE_WINGS);
  magnify.push({ ...nose, radius: noseWidth * 1.3, scale: noseSize(), bump: false });
  const noseShift = noseHeight() * noseWidth * 0.6;
  move.push({ ...nose, radius: noseWidth * 1.6, dx: up.x * noseShift, dy: up.y * noseShift });

  const browShift = browHeight() * eyeWidth * 0.45;
  for (const ids of [RIGHT_BROW, LEFT_BROW]) {
    const brow = centerOf(ids);
    const browWidth = distance(ids[0], ids[ids.length - 1]);
    move.push({ ...brow, radius: browWidth * 0.9, dx: up.x * browShift, dy: up.y * browShift });
  }
  if (bumpiness() > 0) {
    for (const b of bumps) {
      const wobble = pulse() ? 0.65 + 0.35 * Math.sin(time * b.speed + b.phase) : 1;
      magnify.push({
        x: bx[b.landmark],
        y: by[b.landmark],
        radius: eyeWidth * b.size,
        scale: 0.5 * bumpiness() * wobble,
        bump: true,
      });
    }
  }
  return { magnify, move };
}

function warp(time) {
  readBase();
  const { magnify, move } = buildEffects(time);
  for (let v = 0; v < vertexCount; v++) {
    let x = 0, y = 0, z = 0, u = 0, t = 0;
    for (let k = 0; k < 3; k++) {
      const c = corners[v * 3 + k];
      const w = weights[v * 3 + k];
      x += w * bx[c];
      y += w * by[c];
      z += w * bz[c];
      u += w * bu[c];
      t += w * bv[c];
    }

    let dx = 0, dy = 0, light = 0;
    for (const m of magnify) {
      const ox = x - m.x;
      const oy = y - m.y;
      const r = Math.hypot(ox, oy) / m.radius;
      if (r >= 1) continue;
      const f = falloff(r) * m.scale;
      dx += ox * f;
      dy += oy * f;
        if (m.bump && r > 0) light -= SHADING * m.scale * falloffSlope(r) * ((ox * LIGHT.x + oy * LIGHT.y) / (r * m.radius));
    }
    for (const m of move) {
      const r = Math.hypot(x - m.x, y - m.y) / m.radius;
      if (r >= 1) continue;
      const f = falloff(r);
      dx += m.dx * f;
      dy += m.dy * f;
    }

    const e = edge[v];
    positions[v * 3] = x + dx * e;
    positions[v * 3 + 1] = y + dy * e;
    positions[v * 3 + 2] = z;
    uvs[v * 2] = u;
    uvs[v * 2 + 1] = t;
    // Vertex colors multiply in linear space; the power makes the shading even in sRGB.
    // A soft shadow and a brighter highlight, so the bumps read as raised rather than bruised.
    const shade = Math.pow(1 + Math.min(Math.max(light, -0.12), 0.3) * e, 2.2);
    colors[v * 3] = colors[v * 3 + 1] = colors[v * 3 + 2] = shade;
  }
  warped.getAttribute("position").needsUpdate = true;
  warped.getAttribute("uv").needsUpdate = true;
  warped.getAttribute("color").needsUpdate = true;
  warped.computeBoundingSphere();
}

async function render(landmarker) {
  await av.ready();

  if (width !== av.video.videoWidth || height !== av.video.videoHeight) {
    width = av.video.videoWidth;
    height = av.video.videoHeight;
    camera.left = -0.5 * width;
    camera.right = 0.5 * width;
    camera.top = 0.5 * height;
    camera.bottom = -0.5 * height;
    camera.updateProjectionMatrix();
    faceGeometry.setSize(width, height);
    resize();
  }
  background.scale.set(flipCamera() ? -width : width, height, 1);

  const now = performance.now();
  const faces = landmarker.detectForVideo(av.video, now).faceLandmarks;
  const found = faces.length > 0;
  if (found) {
    faceGeometry.update(faces[0], flipCamera());
    warp(now / 1000);
  }
  status.textContent = found ? "" : "No face detected";
  face.visible = found;
  wireframe.visible = found && showWireframe();

  renderer.render(scene, camera);
  requestAnimationFrame(() => render(landmarker));
}

async function init() {
  try {
    await av.ready();
    const videoTexture = new VideoTexture(av.video);
    videoTexture.colorSpace = SRGBColorSpace;
    background.material.map = videoTexture;
    face.material.map = videoTexture;
    status.textContent = "Loading model...";
    const landmarker = await createFaceLandmarker();
    status.textContent = "Detecting face...";
    render(landmarker);
  } catch (e) {
    status.textContent = e.message;
    throw e;
  }
}

init();
