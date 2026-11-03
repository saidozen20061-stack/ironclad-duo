import { net } from '../net.js';
import { settings } from '../settings.js';
import { TANKS } from '../../../shared/constants.js';
import { PLANES } from '../../../shared/planes.js';

// Command on the radio: the start and end of the battle, flags won and lost, and when this crew
// destroys a tank or plane or hits or kills a teammate.
// Real recordings: "Radio Soldier" by VoiceBosch, CC BY-SA 4.0. They all live in one file; each line is
// [start, length] in seconds.
const CLIP_URL = `${import.meta.env.BASE_URL}audio/radio-soldier.mp3`;
const CLIPS = {
  'Good work, soldier!': [41.31, 1.05],
  'Target neutralized!': [24.4, 1.38],
  'Tango down!': [10.71, 1.07],
  'Area clear!': [13.94, 0.89],
  'Hold your position!': [73.53, 1.14],
  'Watch your ammo!': [35.09, 0.96],
  "You're on your own. Good luck.": [86.65, 2.87],
  "We're losing ground!": [47.38, 1.12],
  'Objective secured!': [53.6, 1.32],
  'Objective lost!': [57.02, 1.27],
};
const LINES = {
  friendly: ['Hold your position!', 'Watch your ammo!'],
  teamkill: ["You're on your own. Good luck.", "We're losing ground!"],
  kill: ['Good work, soldier!', 'Target neutralized!', 'Tango down!', 'Area clear!'],
  start: ["You're on your own. Good luck."],
  takeoff: ["You're on your own. Good luck."],
  end: ['Good work, soldier!'],
  flagWon: ['Objective secured!'],
  flagLost: ['Objective lost!'],
};
const FAVOURITE = 0.5; // chance of a list's first line, except the kill lines: those are all equally likely
const PAD = 0.06; // s kept either side of a line, so its edges aren't clipped
const KEY_UP = 0.2; // s of walkie-talkie sound before the voice
const KEY_DOWN = 0.2; // and after it
const GAP = 0.3; // s of silence between one line and the next in the queue
const FRIENDLY_REPEAT = 3.5; // s: a long burst into a teammate doesn't fill the queue
const TAKEOFF_REPEAT = 20; // s: bouncing on the runway doesn't count as taking off twice

const TEAMS = ['blue', 'red'];
const JOINED_LATE = 15; // s into the match: someone rejoining doesn't get the opening line again

export class RadioLines {
  constructor(hud, crewId) {
    this.crewId = crewId;
    this.units = new Map(); // id -> { team, crew }: rows don't always carry every unit
    this.nextAt = {};
    this.last = {};
    this.queue = [];
    this.current = null; // the timer of the line being played
    this.el = document.createElement('div');
    this.el.style.cssText = 'position:absolute;left:50%;bottom:21%;transform:translateX(-50%);padding:5px 12px;background:rgba(14,18,12,.78);border-left:3px solid #d9a441;color:#e8e4d4;font-size:15px;white-space:nowrap;pointer-events:none;opacity:0;transition:opacity .25s;z-index:5';
    hud.appendChild(this.el);
    this.ctx = new AudioContext();
    this.ctx.resume();
    this.load();
    this.offs = [net.on('s', (msg) => this.onSnapshot(msg)), net.on('matchEnd', () => this.say('end'))];
  }

  // If it can't load, the subtitles still show.
  async load() {
    try {
      const res = await fetch(CLIP_URL);
      this.clips = await this.ctx.decodeAudioData(await res.arrayBuffer());
    } catch (e) {
      console.warn('Radio voices did not load', e);
    }
  }

  onSnapshot(msg) {
    for (const a of msg.u) this.units.set(a[0], { team: TEAMS[a[1]], crew: a[10] > 0 ? a[10] - 1 : null });
    // Once the voices have loaded, so it can't be missed on a slow connection.
    // A plane on the ground gets its line at take-off instead.
    const ground = msg.me?.pl?.ground;
    if (this.clips && !this.opened) {
      this.opened = true;
      if (msg.time < JOINED_LATE && !ground) this.say('start');
    }
    if (this.wasGround && ground === false && !msg.me.dead) this.say('takeoff');
    this.wasGround = ground;
    for (const ev of msg.ev ?? []) this.onEvent(ev, msg.me?.team);
  }

  mine(id) {
    return this.units.get(id)?.crew === this.crewId;
  }

  onEvent(ev, team) {
    if (ev.k === 'cap') {
      // A flag is lost the moment the enemy takes it off us; one they take while neutral was never ours.
      if (ev.team === team) this.say('flagWon');
      else if (ev.team === null && ev.prev === team) this.say('flagLost');
    } else if (ev.k === 'i' && ev.u !== undefined && this.mine(ev.o) && !this.mine(ev.u)) {
      if (this.units.get(ev.u)?.team === team) this.say('friendly');
    } else if (ev.k === 'k' && this.mine(ev.by) && !this.mine(ev.u)) {
      if (ev.team === team) this.say('teamkill');
      else if (TANKS[ev.type] || PLANES[ev.type]) this.say('kill');
    }
  }

  pick(kind) {
    const list = LINES[kind];
    if (kind === 'kill') return list[Math.floor(Math.random() * list.length)];
    let line = list[0];
    if (Math.random() >= FAVOURITE) {
      const rest = list.filter((l) => l !== this.last[kind] && l !== list[0]);
      if (rest.length) line = rest[Math.floor(Math.random() * rest.length)];
    }
    this.last[kind] = line;
    return line;
  }

  say(kind) {
    const now = performance.now() / 1000;
    if (now < (this.nextAt[kind] ?? 0)) return;
    if (kind === 'friendly') this.nextAt.friendly = now + FRIENDLY_REPEAT;
    if (kind === 'takeoff') this.nextAt.takeoff = now + TAKEOFF_REPEAT;
    this.queue.push(kind);
    this.playNext();
  }

  // One at a time, in the order they came: walkie-talkie click, voice, walkie-talkie click.
  playNext() {
    if (this.current || !this.queue.length) return;
    const line = this.pick(this.queue.shift());
    const [start, length] = CLIPS[line];
    const voiced = length + PAD * 2;
    this.el.textContent = `📻 ${line}`;
    this.el.style.opacity = 1;
    if (this.clips && settings.masterVolume) {
      this.ctx.resume();
      const t = this.ctx.currentTime;
      this.keyUp(t);
      this.voice(start, voiced, t + KEY_UP);
      this.keyDown(t + KEY_UP + voiced);
    }
    this.current = setTimeout(() => {
      this.current = null;
      if (!this.queue.length) this.el.style.opacity = 0;
      this.playNext();
    }, (KEY_UP + voiced + KEY_DOWN + GAP) * 1000);
  }

  voice(start, length, when) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.clips;
    src.connect(this.output(1));
    src.start(when, Math.max(0, start - PAD), length);
  }

  output(level) {
    const gain = this.ctx.createGain();
    gain.gain.value = level * settings.masterVolume;
    gain.connect(this.ctx.destination);
    return gain;
  }

  // The rising double beep of a police radio opening.
  keyUp(t) {
    this.static(t, 0.06, 0.1);
    this.beep(t + 0.05, 1300, 0.05);
    this.beep(t + 0.11, 1750, 0.06);
  }

  // A lower beep, then the hiss of the squelch closing.
  keyDown(t) {
    this.beep(t, 1050, 0.07);
    this.static(t + 0.06, 0.13, 0.16);
  }

  beep(t, freq, length) {
    const o = this.ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = freq;
    const env = this.output(0.07);
    env.gain.setValueAtTime(env.gain.value, t + length * 0.8);
    env.gain.linearRampToValueAtTime(0, t + length);
    o.connect(env);
    o.start(t);
    o.stop(t + length);
  }

  // A burst of radio hiss that dies away.
  static(t, length, level) {
    const n = Math.floor(this.ctx.sampleRate * length);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2300;
    filter.Q.value = 0.9;
    src.connect(filter).connect(this.output(level));
    src.start(t);
  }

  dispose() {
    for (const off of this.offs) off();
    clearTimeout(this.current);
    this.ctx.close();
    this.el.remove();
  }
}
