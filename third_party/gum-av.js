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
      this.getMedia(this.devices.videoinput[this.currentVideoInput]);
    });

    this.init();
  }

  async init() {
    await this.enumerateDevices();
    if (this.devices.videoinput.length === 1) {
      this.nextDeviceButton.style.display = "none";
      this.currentVideoInput = 0;
      this.invalidateVideoSource();
      this.getMedia(this.devices.videoinput[this.currentVideoInput]);
    } else {
      this.nextDeviceButton.style.display = "block";
      this.currentVideoInput = 0;
      this.invalidateVideoSource();
      this.getMedia(this.devices.videoinput[this.currentVideoInput]);
    }
  }

  async ready() {
    await this.videoLoadedData;
  }

  async enumerateDevices() {
    if (!navigator.mediaDevices) {
      this.deviceNameLabel.textContent = `Can't enumerate devices. Make sure the page is HTTPS, and the browser support getUserMedia.`;
      return;
    }
    const devices = await navigator.mediaDevices.enumerateDevices();

    for (const device of devices) {
      let name;
      switch (device.kind) {
        case "audioinput":
          name = device.label || "Microphone";
          break;
        case "audiooutput":
          name = device.label || "Speakers";
          break;
        case "videoinput":
          name = device.label || "Camera";
          break;
      }
      this.devices[device.kind].push(device);
    }
  }

  invalidateVideoSource() {
    this.videoLoadedData = new Promise((resolve, reject) => {
      this.resolveLoadedData = resolve;
      this.rejectLoadedData = reject;
    });
  }

  async getMedia(device) {
    const constraints = {
      video: { deviceId: device.deviceId, width: 500, height: 500 },
    };
    this.deviceNameLabel.textContent = "Connecting...";
    let stream = null;

    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.deviceNameLabel.textContent = device.label;
      this.createVideoElement();
      this.video.srcObject = stream;
    } catch (err) {
      this.deviceNameLabel.textContent = `${err.name} ${err.message}`;
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
      this.video.playsinline = true;
      this.video.addEventListener("loadeddata", () => {
        this.resolveLoadedData();
      });
      this.shadowRoot.append(this.video);
    }
  }
}

customElements.define("gum-av", GumAudioVideo);
