import {
  GUI,
  signal,
  effect,
} from "https://cdn.jsdelivr.net/npm/guspira@0.1.1/dist/guspira.min.js";

const stylesheet = document.createElement("link");
stylesheet.rel = "stylesheet";
stylesheet.href =
  "https://cdn.jsdelivr.net/npm/guspira@0.1.1/dist/guspira.min.css";
document.head.append(stylesheet);

// Creates a settings panel in the top right corner of the page.
function createGUI(title = "Settings") {
  const el = document.createElement("div");
  el.style.cssText =
    "position: absolute; top: 10px; right: 10px; width: 280px; z-index: 2";
  document.body.append(el);
  return new GUI(title, el);
}

// Adds a "Mirror video" toggle bound to a <gum-av>. It follows the camera, on for
// front and desktop cameras and off for back ones, and can be changed by hand.
function addMirrorToggle(gui, av) {
  const mirror = signal(true);
  gui.addCheckbox("Mirror video", mirror);
  av.addEventListener("ready", () => mirror.set(av.facingMode !== "environment"));
  effect(() => {
    av.mirrored = mirror();
  });
  return mirror;
}

// Adds a "Smoothing" toggle, on by default, for the given face geometries.
function addSmoothingToggle(gui, ...geometries) {
  const smoothing = signal(true);
  gui.addCheckbox("Smoothing", smoothing, {
    title: "Filter the jitter out of the landmarks and head pose",
  });
  effect(() => {
    for (const geometry of geometries) geometry.setSmoothing(smoothing());
  });
  return smoothing;
}

export { createGUI, addMirrorToggle, addSmoothingToggle, signal, effect };
