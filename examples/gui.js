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
    "position: absolute; top: 10px; right: 10px; width: min(320px, calc(100vw - 20px)); z-index: 2";
  document.body.append(el);
  const gui = new GUI(title, el);
  // A narrower label column than guspira's 140px, so sliders and choices have room.
  gui.container.style.setProperty("--gui-label-width", "110px");
  gui.container.style.setProperty("--gui-padding", "16px");
  return gui;
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
