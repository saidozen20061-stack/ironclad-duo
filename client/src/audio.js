import { settings, onSettingsChange } from './settings.js';

// Shared Web Audio context. Sounds are synthesized; Phase 7 adds the full soundscape.
let ctx = null;
let master = null;

export function audio() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = settings.masterVolume;
    master.connect(ctx.destination);
    onSettingsChange(() => master.gain.setTargetAtTime(settings.masterVolume, ctx.currentTime, 0.05));
  }
  if (ctx.state === 'suspended') ctx.resume();
  return { ctx, master };
}

// Browsers only allow audio after a user gesture; unlock on the first one.
for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, () => audio(), { once: true });

export function beep({ freq = 880, dur = 0.12, type = 'square', gain = 0.15, at = 0 } = {}) {
  const { ctx, master } = audio();
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export function pingSound() {
  beep({ freq: 1320, dur: 0.1, type: 'sine', gain: 0.25 });
  beep({ freq: 1760, dur: 0.18, type: 'sine', gain: 0.25, at: 0.12 });
}
