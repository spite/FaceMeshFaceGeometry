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
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  width: 100%;
  height: 100%;
}
div {
  position: absolute;
  left: 10px;
  bottom: 10px;
  z-index: 100;
}
p {
  position: absolute;
  left: 120px;
  bottom: 10px;
  right: 0;
  width: 100%;
  display: block;
  height: 1em;
  white-space: nowrap;
}
#nextDevice {
  display: none;
  width: 96px;
}
#nextDevice svg {
  fill: white;
}
#nextDevice:hover {
  opacity: .5;
}
</style>
<div>
  <p id="deviceName"></p>
  <div id="nextDevice">
    <svg enable-background="new 0 0 40 40" id="Слой_1" version="1.1" viewBox="0 0 40 40" xml:space="preserve" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><g><path d="M16.8,29c-0.3,0-0.5-0.1-0.7-0.3c-0.4-0.4-0.4-1,0-1.4l7.3-7.3l-7.3-7.3c-0.4-0.4-0.4-1,0-1.4s1-0.4,1.4,0l8,8   c0.4,0.4,0.4,1,0,1.4l-8,8C17.3,28.9,17,29,16.8,29z"/></g><g><path d="M20,40C9,40,0,31,0,20S9,0,20,0c4.5,0,8.7,1.5,12.3,4.2c0.4,0.3,0.5,1,0.2,1.4c-0.3,0.4-1,0.5-1.4,0.2C27.9,3.3,24,2,20,2   C10.1,2,2,10.1,2,20s8.1,18,18,18s18-8.1,18-18c0-3.2-0.9-6.4-2.5-9.2c-0.3-0.5-0.1-1.1,0.3-1.4c0.5-0.3,1.1-0.1,1.4,0.3   C39,12.9,40,16.4,40,20C40,31,31,40,20,40z"/></g></svg>
  </div>
</div>
`;

class GumAudioVideo extends HTMLElement {
  constructor() {
    super();

    this.invalidateVideoSource();

    this.attachShadow({ mode: "open" });
    this.shadowRoot.appendChild(template.content.cloneNode(true));
    this.deviceNameLabel = this.shadowRoot.querySelector("#deviceName");
    this.nextDeviceButton = this.shadowRoot.querySelector("#nextDevice");
    this.currentVideoInput = 0;
    this.devices = {
      audioinput: [],
      audiooutput: [],
      videoinput: [],
    };
    this.nextDeviceButton.addEventListener("click", (e) => {
      this.currentVideoInput =
        (this.currentVideoInput + 1) % this.devices.videoinput.length;
      this.invalidateVideoSource();
      this.getMedia(this.devices.videoinput[this.currentVideoInput].deviceId);
    });

    this.init();
  }

  async init() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.fail(
        new Error(
          "Can't access the camera. Make sure the page is served over HTTPS (or localhost), and the browser supports getUserMedia."
        )
      );
      return;
    }
    // Labels and device ids are only exposed once permission has been granted.
    await this.getMedia();
    await this.enumerateDevices();
    const track = this.video && this.video.srcObject.getVideoTracks()[0];
    const deviceId = track && track.getSettings().deviceId;
    this.currentVideoInput = Math.max(
      0,
      this.devices.videoinput.findIndex((d) => d.deviceId === deviceId)
    );
    this.nextDeviceButton.style.display =
      this.devices.videoinput.length > 1 ? "block" : "none";
  }

  // Resolves once the current video source has data, following device switches.
  async ready() {
    let pending;
    do {
      pending = this.videoLoadedData;
      await pending;
    } while (pending !== this.videoLoadedData);
  }

  async enumerateDevices() {
    this.devices = { audioinput: [], audiooutput: [], videoinput: [] };
    const devices = await navigator.mediaDevices.enumerateDevices();
    for (const device of devices) {
      if (this.devices[device.kind]) {
        this.devices[device.kind].push(device);
      }
    }
  }

  invalidateVideoSource() {
    if (this.videoLoadedData && !this.loaded) return;
    this.loaded = false;
    this.videoLoadedData = new Promise((resolve, reject) => {
      this.resolveLoadedData = () => {
        this.loaded = true;
        resolve();
      };
      this.rejectLoadedData = reject;
    });
  }

  fail(err) {
    this.deviceNameLabel.textContent = err.message;
    this.rejectLoadedData(err);
  }

  async getMedia(deviceId) {
    const constraints = {
      video: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        width: 500,
        height: 500,
      },
    };
    this.deviceNameLabel.textContent = "Connecting...";

    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.createVideoElement();
      this.video.srcObject = stream;
      this.deviceNameLabel.textContent = stream.getVideoTracks()[0].label;
    } catch (err) {
      this.fail(new Error(`Can't access the camera: ${err.name} ${err.message}`));
    }
  }

  createVideoElement() {
    if (this.video && this.video.srcObject) {
      this.video.srcObject.getTracks().forEach((track) => {
        track.stop();
      });
    }
    if (!this.video) {
      this.video = document.createElement("video");
      this.video.autoplay = true;
      this.video.muted = true;
      this.video.playsInline = true;
      this.video.addEventListener("loadeddata", () => {
        this.resolveLoadedData();
      });
      this.shadowRoot.append(this.video);
    }
  }
}

customElements.define("gum-av", GumAudioVideo);
