import { audio } from '../audio.js';

// Synthesized battlefield audio. Everything is generated with Web Audio nodes:
// noise buffers + oscillators + filters. Sounds are positioned by simple distance
// falloff (volume, high-frequency loss, speed-of-sound delay). Inside the closed
// driver's compartment the outside world is muffled through a low-pass filter.

const SPEED_OF_SOUND = 343;

let noiseBuf = null;
function noise(ctx) {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  return src;
}

export class SoundScape {
  constructor(role) {
    const { ctx, master } = audio();
    this.ctx = ctx;
    this.role = role;
    this.listener = { x: 0, y: 0, z: 0 };
    this.out = ctx.createGain();
    this.out.connect(master);
    // Outside world bus: muffled for the driver.
    this.outsideFilter = ctx.createBiquadFilter();
    this.outsideFilter.type = 'lowpass';
    this.outsideFilter.frequency.value = role === 'driver' ? 650 : 18000;
    this.outside = ctx.createGain();
    this.outside.gain.value = role === 'driver' ? 0.75 : 1;
    this.outside.connect(this.outsideFilter).connect(this.out);
    this.buildEngine();
    this.buildAmbient();
    this.buildRumble();
    this.squeakT = 0;
    this.radioT = 8 + Math.random() * 10;
    this.voices = 0;
  }

  // ---------- Continuous engine ----------
  buildEngine() {
    const ctx = this.ctx;
    const inside = this.role === 'driver';
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    this.engGain.connect(this.out);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = inside ? 380 : 700;
    lp.connect(this.engGain);
    this.engOsc = ctx.createOscillator();
    this.engOsc.type = 'sawtooth';
    this.engOsc.frequency.value = 32;
    this.engOsc2 = ctx.createOscillator();
    this.engOsc2.type = 'square';
    this.engOsc2.frequency.value = 16;
    const g2 = ctx.createGain();
    g2.gain.value = 0.35;
    this.engOsc.connect(lp);
    this.engOsc2.connect(g2).connect(lp);
    const rumble = noise(ctx);
    const rf = ctx.createBiquadFilter();
    rf.type = 'lowpass';
    rf.frequency.value = 160;
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0.4;
    rumble.connect(rf).connect(this.rumbleGain).connect(lp);
    this.engOsc.start();
    this.engOsc2.start();
    rumble.start();
    this.engNodes = [this.engOsc, this.engOsc2, rumble];
  }

  updateEngine(dt, speedFrac, throttle, alive, maxSpeed) {
    const t = this.ctx.currentTime;
    const load = Math.min(1, Math.abs(throttle) * 0.6 + speedFrac * 0.7);
    const f = 28 + load * 42;
    this.engOsc.frequency.setTargetAtTime(f, t, 0.15);
    this.engOsc2.frequency.setTargetAtTime(f / 2, t, 0.15);
    const vol = alive ? (this.role === 'driver' ? 0.16 + load * 0.16 : 0.05 + load * 0.08) : 0;
    this.engGain.gain.setTargetAtTime(vol, t, 0.2);
    // Track squeak: little metallic bursts with speed.
    if (alive && speedFrac > 0.05) {
      this.squeakT -= dt * speedFrac * maxSpeed * 0.35;
      if (this.squeakT <= 0) {
        this.squeakT = 1 + Math.random() * 1.5;
        this.burst({ freq: 1400 + Math.random() * 1400, q: 18, dur: 0.07 + Math.random() * 0.06, gain: this.role === 'driver' ? 0.05 : 0.03, bus: this.out });
      }
    }
  }

  // ---------- World ambience: wind in the trees, river water, crackling fires ----------
  buildAmbient() {
    const ctx = this.ctx;
    const loop = (type, freq, q) => {
      const src = noise(ctx);
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(this.outside);
      src.start(0, Math.random() * 2);
      return { src, f, g };
    };
    this.wind = loop('bandpass', 520, 0.6);
    this.river = loop('lowpass', 900, 0.4);
    this.ambientNodes = [this.wind.src, this.river.src];
    this.crackleT = 0;
    this.ambT = 0;
  }

  // dists: { river, fire, trees (0..1 local tree density) }
  updateAmbient(dt, dists) {
    const t = this.ctx.currentTime;
    this.ambT += dt;
    const gust = 0.55 + 0.45 * Math.sin(this.ambT * 0.31) * Math.sin(this.ambT * 0.11 + 1);
    this.wind.g.gain.setTargetAtTime((0.025 + dists.trees * 0.09) * gust, t, 0.5);
    this.wind.f.frequency.setTargetAtTime(380 + gust * 420 + dists.trees * 300, t, 0.5);
    this.river.g.gain.setTargetAtTime(0.16 * Math.max(0, 1 - dists.river / 110) ** 2, t, 0.4);
    if (dists.fire < 70) {
      this.crackleT -= dt;
      if (this.crackleT <= 0) {
        const near = 1 - dists.fire / 70;
        this.crackleT = 0.03 + Math.random() * 0.25 * (1.2 - near);
        this.burst({ freq: 1800 + Math.random() * 3500, q: 3, dur: 0.02 + Math.random() * 0.05, gain: 0.12 * near * (0.4 + Math.random()) });
        if (Math.random() < 0.08) this.burst({ freq: 300, type: 'lowpass', dur: 0.4, gain: 0.08 * near });
      }
    }
  }

  // Plane engine: a saw and a square at firing frequency (lumpy radial, smoother inline),
  // wind that grows with speed, plus the cockpit alarm and the dive siren.
  buildPlane(spec) {
    const ctx = this.ctx;
    this.planeSpec = spec;
    const g = ctx.createGain();
    g.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = { radial: 520, drone: 260, jet: 2200, rotor: 340 }[spec.engineSound] ?? 800;
    lp.connect(g).connect(this.out);
    const o1 = ctx.createOscillator();
    o1.type = 'sawtooth';
    const o2 = ctx.createOscillator();
    o2.type = spec.engineSound === 'radial' ? 'square' : 'sawtooth';
    const g2 = ctx.createGain();
    g2.gain.value = spec.engines === 2 ? 0.8 : 0.4;
    o1.connect(lp);
    o2.connect(g2).connect(lp);
    o1.start();
    o2.start();
    const windSrc = noise(ctx);
    const wf = ctx.createBiquadFilter();
    wf.type = 'bandpass';
    wf.frequency.value = 900;
    wf.Q.value = 0.5;
    const wg = ctx.createGain();
    wg.gain.value = 0;
    windSrc.connect(wf).connect(wg).connect(this.out);
    windSrc.start();
    const siren = ctx.createOscillator();
    siren.type = 'sawtooth';
    const sf = ctx.createBiquadFilter();
    sf.type = 'bandpass';
    sf.frequency.value = 1100;
    sf.Q.value = 2;
    const sg = ctx.createGain();
    sg.gain.value = 0;
    siren.connect(sf).connect(sg).connect(this.out);
    siren.start();
    this.planeAudio = { g, o1, o2, wg, wf, siren, sg };
    if (spec.engineSound === 'rotor') {
      // The chop of the blades: the whole engine note pumped up and down several times a second.
      const chop = ctx.createOscillator();
      chop.type = 'square';
      chop.frequency.value = 11;
      const depth = ctx.createGain();
      depth.gain.value = 0.11;
      chop.connect(depth).connect(g.gain);
      chop.start();
      this.planeAudio.chop = chop;
      (this.ambientExtra ??= []).push(chop);
    }
    this.ambientExtra = [...(this.ambientExtra ?? []), o1, o2, windSrc, siren];
    this.engGain.gain.value = 0;
  }

  updatePlane(dt, { th, speedFrac, dive, alive, stall, ab = false }) {
    const a = this.planeAudio;
    if (!a) return;
    const t = this.ctx.currentTime;
    const voice = this.planeSpec.engineSound;
    if (a.chop) a.chop.frequency.setTargetAtTime(9.5 + th * 5, t, 0.3);
    const f = voice === 'rotor' ? 34 + th * 22 : voice === 'drone' ? 24 + th * 12 + speedFrac * 4 : voice === 'jet' ? 130 + th * 150 + speedFrac * 90 + (ab ? 120 : 0) : (voice === 'radial' ? 38 : 58) + th * 60 + speedFrac * 22;
    a.o1.frequency.setTargetAtTime(f, t, 0.2);
    a.o2.frequency.setTargetAtTime(f * (this.planeSpec.engines === 2 ? 1.012 : 0.5), t, 0.2);
    a.g.gain.setTargetAtTime(alive ? 0.1 + th * 0.17 + (ab ? 0.1 : 0) : 0, t, 0.25);
    a.wg.gain.setTargetAtTime(alive ? speedFrac * speedFrac * 0.14 + dive * 0.13 + (ab ? 0.3 : 0) : 0, t, 0.3);
    a.wf.frequency.setTargetAtTime(600 + speedFrac * 800 + dive * 900, t, 0.3);
    // The Stuka's siren climbs as it dives.
    const howl = alive && this.planeSpec.siren && dive > 0.15;
    a.siren.frequency.setTargetAtTime(360 + speedFrac * 900, t, 0.3);
    a.sg.gain.setTargetAtTime(howl ? 0.09 * Math.min(1, dive * 1.6) : 0, t, 0.25);
    if (alive && stall) {
      this.alarmT = (this.alarmT ?? 0) - dt;
      if (this.alarmT <= 0) {
        this.alarmT = 0.42;
        this.tone({ freq: 880, dur: 0.18, gain: 0.08, type: 'square', bus: this.out });
      }
    }
  }

  // The vehicle's no longer a plane: its engine goes quiet for good.
  stopPlane() {
    const a = this.planeAudio;
    if (!a) return;
    const t = this.ctx.currentTime;
    a.g.gain.setTargetAtTime(0, t, 0.1);
    a.wg.gain.setTargetAtTime(0, t, 0.1);
    a.sg.gain.setTargetAtTime(0, t, 0.1);
    this.planeAudio = null;
    this.planeSpec = null;
  }

  // Other aircraft you hear from anywhere: a Leviathan's deep drone (distances in m, Infinity = none)
  // and a jet's afterburner.
  updateFlyers(drone, roar) {
    const ctx = this.ctx;
    if (!this.flyers) {
      if (drone === Infinity && roar === Infinity) return;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 170;
      const droneGain = ctx.createGain();
      droneGain.gain.value = 0;
      lp.connect(droneGain).connect(this.out);
      const oscs = [29, 29.7, 44].map((freq) => {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = freq;
        o.connect(lp);
        o.start();
        return o;
      });
      const src = noise(ctx);
      const bp = ctx.createBiquadFilter();
      bp.type = 'lowpass';
      bp.frequency.value = 1500;
      const roarGain = ctx.createGain();
      roarGain.gain.value = 0;
      src.connect(bp).connect(roarGain).connect(this.out);
      src.start();
      this.flyers = { droneGain, roarGain };
      this.ambientExtra = [...(this.ambientExtra ?? []), ...oscs, src];
    }
    const t = ctx.currentTime;
    const fade = (d, far) => (d === Infinity ? 0 : Math.max(0, 1 - d / far) ** 2);
    this.flyers.droneGain.gain.setTargetAtTime(drone === Infinity ? 0 : 0.04 + 0.3 * fade(drone, 2800), t, 0.4);
    this.flyers.roarGain.gain.setTargetAtTime(0.3 * fade(roar, 900), t, 0.2);
  }

  // The war never stops: a low, slowly swelling rumble behind everything.
  buildRumble() {
    const ctx = this.ctx;
    const src = noise(ctx);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 95;
    const g = ctx.createGain();
    g.gain.value = 0.16;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const depth = ctx.createGain();
    depth.gain.value = 0.07;
    lfo.connect(depth).connect(g.gain);
    src.connect(f).connect(g).connect(this.outside);
    src.start();
    lfo.start();
    this.ambientExtra = [src, lfo];
  }

  // A falling shell or bomb: a descending whistle, louder the closer it will land.
  whistle(pos, fall, big) {
    const a = this.at(pos);
    const near = Math.max(0.12, 1 - a.d / 180);
    const t0 = this.ctx.currentTime + Math.max(0, fall - 2.2);
    const dur = Math.min(fall, 2.2);
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(big ? 1100 : 1500, t0);
    o.frequency.exponentialRampToValueAtTime(big ? 260 : 340, t0 + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.17 * near, t0 + dur * 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.outside);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
    if (near > 0.6) this.burst({ freq: 2600, q: 5, dur, gain: 0.04 * near, attack: dur * 0.7, delay: Math.max(0, fall - dur), sweepTo: 700 });
  }

  // Big shell far or near: arrives after its flash, with echoes rolling off the hills.
  farExplosion(pos, size = 1) {
    const a = this.at(pos);
    const k = Math.max(0.05, a.gain) * size;
    this.tone({ freq: 55, to: 18, dur: 2.0 * size, gain: 1.1 * k, delay: a.delay });
    this.burst({ freq: 1100 * a.bright, type: 'lowpass', dur: 2.6 * size, gain: 1.3 * k, delay: a.delay, sweepTo: 55 });
    for (const [t, g] of [[0.32, 0.3], [0.78, 0.16]]) {
      this.burst({ freq: 420 * a.bright, type: 'lowpass', dur: 1.7, gain: 1.0 * k * g, delay: a.delay + t, sweepTo: 60 });
    }
  }

  flakPop(pos) {
    const a = this.at(pos);
    this.burst({ freq: 700 * a.bright, type: 'lowpass', dur: 0.5, gain: 0.45 * Math.max(0.12, a.gain), delay: a.delay, sweepTo: 120 });
  }

  // Close blast: everything goes dull for a few seconds and the ears ring.
  shellShock(k) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const f = this.outsideFilter.frequency;
    const open = this.role === 'driver' ? 650 : 18000;
    f.cancelScheduledValues(t);
    f.setValueAtTime(320 + (1 - k) * 800, t);
    f.exponentialRampToValueAtTime(open, t + 2.2 + k * 2);
    this.tone({ freq: 3900, dur: 2.2 + k * 1.8, gain: 0.07 * k, bus: this.out });
  }

  // Air raid siren somewhere behind the lines.
  siren() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(240, t);
    for (let i = 0; i < 3; i++) {
      o.frequency.linearRampToValueAtTime(560, t + 3 + i * 6);
      o.frequency.linearRampToValueAtTime(260, t + 6 + i * 6);
    }
    const lp = ctx.createBiquadFilter();
    lp.type = 'bandpass';
    lp.frequency.value = 500;
    lp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.022, t + 2);
    g.gain.setValueAtTime(0.022, t + 16);
    g.gain.linearRampToValueAtTime(0, t + 19);
    o.connect(lp).connect(g).connect(this.outside);
    o.start(t);
    o.stop(t + 19.2);
  }

  // ---------- Building blocks ----------
  // Band/low-pass filtered noise burst.
  burst({ freq = 1000, q = 1, type = 'bandpass', dur = 0.2, gain = 0.3, attack = 0.002, delay = 0, bus = this.outside, sweepTo = null }) {
    if (this.voices > 40) return; // keep CPU in check in big firefights
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const src = noise(ctx);
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(bus);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
    this.voices++;
    src.onended = () => this.voices--;
  }

  tone({ freq = 100, to = null, type = 'sine', dur = 0.3, gain = 0.3, delay = 0, bus = this.outside }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(bus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // Distance attenuation: returns { gain, delay, bright } for a world position.
  at(pos) {
    const l = this.listener;
    const d = Math.hypot(pos.x - l.x, (pos.y ?? l.y) - l.y, pos.z - l.z);
    return { d, gain: 1 / (1 + d / 35), delay: Math.min(4, d / SPEED_OF_SOUND), bright: Math.max(0.15, 1 - d / 900) };
  }

  // ---------- Events ----------
  shot(kind, pos, own) {
    const a = this.at(pos);
    const near = own ? 1 : a.gain;
    if (near < 0.01) return;
    const delay = own ? 0 : a.delay;
    switch (kind) {
      case 'heavy':
        this.tone({ freq: 70, to: 28, dur: 0.9, gain: 0.9 * near, delay });
        this.burst({ freq: 900 * a.bright, type: 'lowpass', dur: 1.4, gain: 1.0 * near, delay, sweepTo: 120 });
        break;
      case 'ap':
      case 'he':
        this.tone({ freq: 90, to: 35, dur: 0.6, gain: 0.7 * near, delay });
        this.burst({ freq: 1400 * a.bright, type: 'lowpass', dur: 0.9, gain: 0.8 * near, delay, sweepTo: 150 });
        break;
      case 'ac':
        this.tone({ freq: 140, to: 60, dur: 0.18, gain: 0.4 * near, delay });
        this.burst({ freq: 1800 * a.bright, type: 'lowpass', dur: 0.25, gain: 0.45 * near, delay });
        break;
      case 'mg':
        this.burst({ freq: 1600 * a.bright, q: 0.8, dur: 0.07, gain: 0.25 * near, delay });
        break;
      case 'rifle':
        this.burst({ freq: 2500 * a.bright, q: 0.7, dur: 0.09, gain: 0.22 * a.gain, delay });
        break;
      case 'bomb':
        this.whistle(pos, 3, true);
        break;
      case 'rocket':
        this.burst({ freq: 600, type: 'lowpass', dur: 1.2, gain: 0.35 * a.gain, delay, sweepTo: 2000 });
        break;
    }
    if (own && (kind === 'ap' || kind === 'he' || kind === 'heavy')) this.pendingClank = true;
  }

  impact(ev, onUs) {
    const a = this.at(ev);
    if (onUs) {
      // Inside the hull: a ringing metallic clang, not muffled.
      const g = ev.kind === 'mg' || ev.kind === 'rifle' ? 0.15 : 0.9;
      for (const f of [180, 271, 397, 523]) this.tone({ freq: f * (0.9 + Math.random() * 0.2), dur: 0.9, gain: g * 0.3, type: 'triangle', bus: this.out });
      this.burst({ freq: 800, type: 'lowpass', dur: 0.4, gain: g, bus: this.out });
      return;
    }
    if (a.gain < 0.01) return;
    const big = { heavy: 1.4, he: 1.1, rocket: 0.9, ap: 0.6, ac: 0.35, mg: 0.1, rifle: 0.06 }[ev.kind] ?? 0.4;
    if (ev.r === 'ric') {
      this.tone({ freq: 2600, to: 900, dur: 0.35, gain: 0.25 * a.gain, delay: a.delay, type: 'triangle' });
      return;
    }
    if (big >= 0.3) {
      this.tone({ freq: 60, to: 25, dur: 0.8 * big, gain: 0.7 * big * a.gain, delay: a.delay });
      this.burst({ freq: 1200 * a.bright, type: 'lowpass', dur: 1.2 * big, gain: 0.8 * big * a.gain, delay: a.delay, sweepTo: 90 });
    } else this.burst({ freq: 1500 * a.bright, q: 1, dur: 0.08, gain: big * a.gain, delay: a.delay });
  }

  explosion(pos, size = 1) {
    const a = this.at(pos);
    this.tone({ freq: 50, to: 20, dur: 1.6 * size, gain: 1.0 * a.gain * size, delay: a.delay });
    this.burst({ freq: 1000 * a.bright, type: 'lowpass', dur: 2.2 * size, gain: 1.1 * a.gain * size, delay: a.delay, sweepTo: 60 });
  }

  distantArtillery(pos) {
    const a = this.at(pos);
    this.tone({ freq: 45, to: 22, dur: 2.2, gain: 0.35, delay: Math.min(2.5, a.delay) });
    this.burst({ freq: 260, type: 'lowpass', dur: 2.5, gain: 0.3, delay: Math.min(2.5, a.delay) });
  }

  plane() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(85, t);
    o.frequency.linearRampToValueAtTime(70, t + 14);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.12, t + 7);
    g.gain.linearRampToValueAtTime(0, t + 15);
    o.connect(f).connect(g).connect(this.outside);
    o.start(t);
    o.stop(t + 15.1);
  }

  reloadClank() {
    for (const [f, d] of [[1200, 0], [800, 0.09]]) {
      this.tone({ freq: f, dur: 0.18, gain: 0.18, type: 'square', delay: d, bus: this.out });
      this.burst({ freq: 3000, q: 4, dur: 0.06, gain: 0.25, delay: d, bus: this.out });
    }
  }

  // Background radio chatter: squelch + garbled "voice" bursts.
  updateRadio(dt) {
    this.radioT -= dt;
    if (this.radioT > 0) return;
    this.radioT = 14 + Math.random() * 26;
    const g = this.role === 'driver' ? 0.07 : 0.045;
    this.burst({ freq: 2200, q: 2, dur: 0.12, gain: g, bus: this.out });
    let t = 0.15;
    const words = 3 + Math.floor(Math.random() * 6);
    for (let i = 0; i < words; i++) {
      const dur = 0.08 + Math.random() * 0.22;
      this.burst({ freq: 700 + Math.random() * 900, q: 6, dur, gain: g * 1.2, delay: t, bus: this.out });
      t += dur + Math.random() * 0.08;
    }
    this.burst({ freq: 2200, q: 2, dur: 0.15, gain: g, delay: t + 0.05, bus: this.out });
  }

  dispose() {
    for (const n of [...this.engNodes, ...(this.ambientNodes ?? []), ...(this.ambientExtra ?? [])]) n.stop();
    this.engGain.disconnect();
    this.out.disconnect();
  }
}
