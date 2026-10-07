// <gum-av>: a camera element that opens the camera, lets the user switch between
// cameras, and copes with mobile browsers.
//
// Attributes:
//   facing="user|environment"  camera to start with on devices that have both (default user).
//   width, height              ideal resolution to ask for (default 1280x720).
//   mirror="auto|true|false"   flip the video horizontally; auto mirrors front and desktop cameras.
//   controls="false"           hide the camera name and the switch button.
//
// API:
//   await el.ready()   resolves when the current camera has frames, rejects if it can't open.
//   el.video           the <video> element; it stays the same element across camera switches.
//   el.facingMode      "user", "environment", or undefined when the camera doesn't say.
//   el.mirrored        whether the video is flipped; setting it overrides the mirror attribute.
//   el.next()          switches to the next camera.
//   el.start(), el.stop()
//
// Events: "ready" each time a camera starts giving frames, "error" with the error as `detail`.

// icon from https://www.iconfinder.com/icons/1348651/arrow_forward_next_right_icon
const template = document.createElement("template");
template.innerHTML = `
<style>
:host {
  display: block;
  position: relative;
  width: 640px;
  height: 480px;
  color: inherit;
  font: inherit;
}
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}
video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
#controls {
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: 10px;
  z-index: 100;
  display: flex;
  align-items: center;
  gap: 12px;
}
:host([controls="false"]) #controls {
  display: none;
}
button {
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
#next {
  display: none;
  flex: none;
  width: 48px;
  height: 48px;
}
#next svg {
  width: 100%;
  height: 100%;
  fill: currentColor;
}
#next:hover {
  opacity: 0.5;
}
#retry {
  display: none;
  padding: 0.4em 1em;
  border: 1px solid currentColor;
  border-radius: 4px;
}
#label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
<div id="controls">
  <button id="next" type="button" aria-label="Switch camera" title="Switch camera">
    <svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg"><g><path d="M16.8,29c-0.3,0-0.5-0.1-0.7-0.3c-0.4-0.4-0.4-1,0-1.4l7.3-7.3l-7.3-7.3c-0.4-0.4-0.4-1,0-1.4s1-0.4,1.4,0l8,8   c0.4,0.4,0.4,1,0,1.4l-8,8C17.3,28.9,17,29,16.8,29z"/></g><g><path d="M20,40C9,40,0,31,0,20S9,0,20,0c4.5,0,8.7,1.5,12.3,4.2c0.4,0.3,0.5,1,0.2,1.4c-0.3,0.4-1,0.5-1.4,0.2C27.9,3.3,24,2,20,2   C10.1,2,2,10.1,2,20s8.1,18,18,18s18-8.1,18-18c0-3.2-0.9-6.4-2.5-9.2c-0.3-0.5-0.1-1.1,0.3-1.4c0.5-0.3,1.1-0.1,1.4,0.3   C39,12.9,40,16.4,40,20C40,31,31,40,20,40z"/></g></svg>
  </button>
  <p id="label"></p>
  <button id="retry" type="button">Retry</button>
</div>
`;

class GumAudioVideo extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot.appendChild(template.content.cloneNode(true));
    this.label = this.shadowRoot.querySelector("#label");
    this.nextButton = this.shadowRoot.querySelector("#next");
    this.retryButton = this.shadowRoot.querySelector("#retry");
    this.nextButton.addEventListener("click", () => this.next());
    this.retryButton.addEventListener("click", () => this.start());

    this.video = document.createElement("video");
    this.video.autoplay = true;
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.setAttribute("playsinline", "");
    this.video.addEventListener("loadeddata", () => this.resolveReady());
    this.shadowRoot.prepend(this.video);

    this.stream = null;
    this.devices = [];
    this.unusable = new Set();
    this.deviceId = null;
    this.facingMode = undefined;
    this.mirrorOverride = undefined;
    this.pending = null;
    this.resetReady();

    this.onDeviceChange = () => this.updateDevices();
    this.onVisibilityChange = () => {
      // Mobile browsers pause the video in the background; resume when coming back.
      if (document.visibilityState === "visible" && this.stream) {
        this.video.play().catch(() => {});
      }
    };
  }

  connectedCallback() {
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    if (navigator.mediaDevices) {
      navigator.mediaDevices.addEventListener("devicechange", this.onDeviceChange);
    }
    if (!this.stream) this.start();
  }

  disconnectedCallback() {
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    if (navigator.mediaDevices) {
      navigator.mediaDevices.removeEventListener("devicechange", this.onDeviceChange);
    }
    this.stop();
  }

  get mirrored() {
    if (this.mirrorOverride !== undefined) return this.mirrorOverride;
    const mirror = this.getAttribute("mirror") || "auto";
    if (mirror === "auto") return this.facingMode !== "environment";
    return mirror !== "false";
  }

  set mirrored(value) {
    this.mirrorOverride = value === undefined ? undefined : !!value;
    this.applyMirror();
  }

  applyMirror() {
    this.video.style.transform = this.mirrored ? "scaleX(-1)" : "";
  }

  // Resolves when the current camera has frames, following camera switches.
  async ready() {
    let pending;
    do {
      pending = this.pending;
      await pending;
    } while (pending !== this.pending);
  }

  resetReady() {
    if (this.pending && !this.settled) return;
    this.settled = false;
    this.pending = new Promise((resolve, reject) => {
      this.resolvePending = resolve;
      this.rejectPending = reject;
    });
    // Nobody may be waiting when a camera fails; the "error" event reports it too.
    this.pending.catch(() => {});
  }

  resolveReady() {
    this.settled = true;
    this.resolvePending();
    this.dispatchEvent(new CustomEvent("ready"));
  }

  fail(err) {
    this.label.textContent = err.message;
    this.retryButton.style.display = "block";
    this.settled = true;
    this.rejectPending(err);
    this.dispatchEvent(new CustomEvent("error", { detail: err }));
  }

  // Opens a camera: a specific one by id, or by facing mode. With `quiet`, a camera
  // that can't be opened throws instead of showing the error.
  async start({ deviceId, facingMode, quiet = false } = {}) {
    this.resetReady();
    this.retryButton.style.display = "none";
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.fail(
        new Error(
          "Can't access the camera. Make sure the page is served over HTTPS (or localhost), and the browser supports getUserMedia."
        )
      );
      return;
    }

    // Phones can't open a second camera while one is in use, so release it first.
    this.stop();

    const width = Number(this.getAttribute("width")) || 1280;
    const height = Number(this.getAttribute("height")) || 720;
    const video = { width: { ideal: width }, height: { ideal: height } };
    if (deviceId) {
      video.deviceId = { exact: deviceId };
    } else {
      video.facingMode = { ideal: facingMode || this.getAttribute("facing") || "user" };
    }

    this.label.textContent = "Connecting...";
    try {
      this.stream = await this.open(video);
    } catch (err) {
      if (quiet) throw err;
      this.fail(new Error(`Can't access the camera: ${err.name} ${err.message}`));
      return;
    }

    const track = this.stream.getVideoTracks()[0];
    const settings = track.getSettings();
    this.deviceId = settings.deviceId;
    this.facingMode = settings.facingMode || undefined;
    track.addEventListener("ended", () => {
      // Another app took the camera, or it was unplugged.
      if (this.stream && this.stream.getVideoTracks()[0] === track) {
        this.stream = null;
        this.resetReady();
        this.fail(new Error("The camera stopped."));
      }
    });

    this.label.textContent = this.describe(track);
    this.applyMirror();
    this.video.srcObject = this.stream;
    this.video.play().catch(() => {});
    // Labels and device ids are only exposed once permission has been granted.
    await this.updateDevices();
  }

  async open(video) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await navigator.mediaDevices.getUserMedia({ video });
      } catch (err) {
        // Windows releases a camera asynchronously, so reopening one right after stop() can fail.
        if (err.name !== "NotReadableError" || attempt >= 2) throw err;
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    }
  }

  stop() {
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
  }

  describe(track) {
    if (this.facingMode === "user") return "Front camera";
    if (this.facingMode === "environment") return "Back camera";
    return track.label || "Camera";
  }

  async updateDevices() {
    if (!navigator.mediaDevices) return;
    const devices = await navigator.mediaDevices.enumerateDevices();
    this.devices = devices.filter(
      (d) => d.kind === "videoinput" && !this.unusable.has(d.deviceId)
    );
    this.nextButton.style.display = this.devices.length > 1 ? "block" : "none";
  }

  // Switches between front and back on phones, and through every camera elsewhere.
  // Cameras that can't be opened (IR sensors, effect cameras, busy ones) are skipped
  // and left out from then on; if none opens, it goes back to the one that worked.
  async next() {
    this.resetReady();
    const previous = this.deviceId;
    if (this.facingMode) {
      try {
        await this.start({
          facingMode: this.facingMode === "user" ? "environment" : "user",
          quiet: true,
        });
        // A laptop may report a facing mode with no camera facing the other way.
        if (this.deviceId !== previous) return;
      } catch (err) {
        // Fall through to trying each camera.
      }
    }
    const index = this.devices.findIndex((d) => d.deviceId === previous);
    const others = [
      ...this.devices.slice(index + 1),
      ...this.devices.slice(0, Math.max(0, index)),
    ].filter((d) => d.deviceId !== previous);
    for (const device of others) {
      try {
        await this.start({ deviceId: device.deviceId, quiet: true });
        return;
      } catch (err) {
        console.warn(`gum-av: skipping ${device.label || "camera"}: ${err.name} ${err.message}`);
        this.unusable.add(device.deviceId);
      }
    }
    await this.start({ deviceId: previous });
    await this.updateDevices();
    if (this.stream) {
      const label = this.label.textContent;
      this.label.textContent = "No other camera could be opened";
      setTimeout(() => {
        if (this.label.textContent === "No other camera could be opened") {
          this.label.textContent = label;
        }
      }, 3000);
    }
  }
}

customElements.define("gum-av", GumAudioVideo);
