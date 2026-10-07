// Sound sources for the visualizer, all feeding one analyser: a synthesized beat, the
// microphone, or a music file.

const BINS = 128;

class AudioInput {
  constructor() {
    this.context = null;
    this.stop = () => {};
    this.spectrum = new Uint8Array(BINS);
    this.bass = 0;
    this.mid = 0;
    this.treble = 0;
  }

  // Browsers only start audio from a user gesture, so this runs from a button.
  ensureContext() {
    if (!this.context) {
      this.context = new AudioContext();
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = BINS * 2;
      this.analyser.smoothingTimeConstant = 0.7;
      this.output = this.context.createGain();
      this.output.connect(this.context.destination);
    }
    this.context.resume();
    this.stop();
    return this.context;
  }

  // A synthesized four-bar loop: kick, clap, hi-hats, bass and an arpeggio.
  playBeat() {
    const ctx = this.ensureContext();
    const master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(this.analyser);
    master.connect(this.output);

    const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    const envelope = (gain, t, attack, level, decay) => {
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(level, t + attack);
      gain.gain.exponentialRampToValueAtTime(0.001, t + attack + decay);
    };

    const kick = (t) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.setValueAtTime(150, t);
      osc.frequency.exponentialRampToValueAtTime(40, t + 0.15);
      envelope(gain, t, 0.002, 1, 0.3);
      osc.connect(gain).connect(master);
      osc.start(t);
      osc.stop(t + 0.35);
    };

    const hiss = (t, type, frequency, level, decay) => {
      const source = ctx.createBufferSource();
      source.buffer = noise;
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = frequency;
      const gain = ctx.createGain();
      envelope(gain, t, 0.001, level, decay);
      source.connect(filter).connect(gain).connect(master);
      source.start(t, Math.random() * 0.5);
      source.stop(t + decay + 0.05);
    };

    const note = (t, type, frequency, level, decay, cutoff) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = frequency;
      const filter = ctx.createBiquadFilter();
      filter.frequency.setValueAtTime(cutoff * 3, t);
      filter.frequency.exponentialRampToValueAtTime(cutoff, t + decay);
      const gain = ctx.createGain();
      envelope(gain, t, 0.005, level, decay);
      osc.connect(filter).connect(gain).connect(master);
      osc.start(t);
      osc.stop(t + decay + 0.05);
    };

    const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
    const roots = [45, 45, 41, 43];
    const arp = [0, 7, 12, 15, 19, 15, 12, 7];
    const step = 60 / 120 / 4;
    let next = ctx.currentTime + 0.05;
    let index = 0;

    // Schedules a little ahead of the clock, so timers don't need to be exact.
    const schedule = () => {
      while (next < ctx.currentTime + 0.12) {
        const s = index % 16;
        const root = roots[Math.floor(index / 16) % roots.length];
        if (s % 4 === 0) kick(next);
        if (s === 4 || s === 12) hiss(next, "bandpass", 1500, 0.6, 0.18);
        if (s % 2 === 1) hiss(next, "highpass", 7000, 0.25, 0.05);
        if (s % 4 !== 1) note(next, "sawtooth", hz(root - 12), 0.35, 0.18, 300);
        if (s % 2 === 0) note(next, "square", hz(root + 12 + arp[(s / 2) % 8]), 0.08, 0.15, 1500);
        next += step;
        index++;
      }
    };
    schedule();
    const timer = setInterval(schedule, 25);
    this.stop = () => {
      clearInterval(timer);
      master.disconnect();
    };
  }

  // Listens to the microphone; it isn't played back, to avoid feedback.
  async useMicrophone() {
    const ctx = this.ensureContext();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const source = ctx.createMediaStreamSource(stream);
    source.connect(this.analyser);
    this.stop = () => {
      source.disconnect();
      for (const track of stream.getTracks()) track.stop();
    };
  }

  // Plays a music file, looping.
  playFile(file) {
    const ctx = this.ensureContext();
    const audio = new Audio(URL.createObjectURL(file));
    audio.loop = true;
    const source = ctx.createMediaElementSource(audio);
    source.connect(this.analyser);
    source.connect(this.output);
    audio.play();
    this.stop = () => {
      audio.pause();
      source.disconnect();
      URL.revokeObjectURL(audio.src);
    };
  }

  // Reads the spectrum, and the bass, mid and treble levels from 0 to 1, rising fast and falling slowly.
  update() {
    if (!this.context) return;
    this.analyser.getByteFrequencyData(this.spectrum);
    const band = (from, to) => {
      let sum = 0;
      for (let i = from; i < to; i++) sum += this.spectrum[i];
      return sum / (to - from) / 255;
    };
    const follow = (current, value) => (value > current ? value : current * 0.9 + value * 0.1);
    this.bass = follow(this.bass, band(1, 5));
    this.mid = follow(this.mid, band(5, 30));
    this.treble = follow(this.treble, band(30, 90));
  }
}

export { AudioInput, BINS };
