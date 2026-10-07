// One Euro filter (Casiez, Roussel and Vogel, 2012): a low-pass filter whose cutoff rises
// with speed, so it removes jitter when the signal is still and follows it when it moves.

function smoothingFactor(dt, cutoff) {
  return 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
}

class OneEuroFilter {
  // minCutoff (Hz) sets the smoothing at rest, beta how fast the cutoff rises with speed.
  constructor({ minCutoff = 1, beta = 0, dCutoff = 1 } = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.reset();
  }

  reset() {
    this.values = null;
    this.speeds = null;
    this.time = 0;
  }

  // Filters an array of values in place, at a time in seconds, and returns it.
  filter(values, time) {
    if (!this.values || this.values.length !== values.length) {
      this.values = Float64Array.from(values);
      this.speeds = new Float64Array(values.length);
      this.time = time;
      return values;
    }
    const dt = time - this.time;
    if (dt <= 0) {
      for (let i = 0; i < values.length; i++) values[i] = this.values[i];
      return values;
    }
    this.time = time;
    const ad = smoothingFactor(dt, this.dCutoff);
    for (let i = 0; i < values.length; i++) {
      const speed = (values[i] - this.values[i]) / dt;
      this.speeds[i] += ad * (speed - this.speeds[i]);
      const cutoff = this.minCutoff + this.beta * Math.abs(this.speeds[i]);
      this.values[i] += smoothingFactor(dt, cutoff) * (values[i] - this.values[i]);
      values[i] = this.values[i];
    }
    return values;
  }
}

export { OneEuroFilter, smoothingFactor };
