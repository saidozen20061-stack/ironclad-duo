import { settings } from '../settings.js';

// A soft steady hiss of rain for the whole match.
export class RainSound {
  constructor() {
    this.ctx = new AudioContext();
    this.ctx.resume();
    const n = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 3200;
    filter.Q.value = 0.4;
    const gain = this.ctx.createGain();
    gain.gain.value = 0.05 * settings.masterVolume;
    src.connect(filter).connect(gain).connect(this.ctx.destination);
    src.start();
  }

  dispose() {
    this.ctx.close();
  }
}
