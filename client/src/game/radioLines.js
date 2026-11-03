import { net } from '../net.js';
import { settings } from '../settings.js';
import { TANKS } from '../../../shared/constants.js';
import { PLANES } from '../../../shared/planes.js';

// Command on the radio, reacting when this crew destroys a tank or plane, or hits or kills a teammate.
// Real recordings: "Radio Soldier" by VoiceBosch, CC BY-SA 4.0. They all live in one file; each line is
// [start, length] in seconds. The first line of each list comes up most often.
const CLIP_URL = `${import.meta.env.BASE_URL}audio/radio-soldier.mp3`;
const CLIPS = {
  'Good work, soldier!': [41.31, 1.05],
  'Target neutralized!': [24.4, 1.38],
  'Tango down!': [10.71, 1.07],
  'Enemy chopper down!': [38.05, 1.27],
  'Hold your position!': [73.53, 1.14],
  'Watch your ammo!': [35.09, 0.96],
  "You're on your own. Good luck.": [86.65, 2.87],
  "We're losing ground!": [47.38, 1.12],
};
const LINES = {
  friendly: ['Hold your position!', 'Watch your ammo!'],
  teamkill: ["You're on your own. Good luck.", "We're losing ground!"],
  killTank: ['Good work, soldier!', 'Target neutralized!', 'Tango down!'],
  killPlane: ['Good work, soldier!', 'Enemy chopper down!', 'Target neutralized!'],
};
const FAVOURITE = 0.5; // chance of a list's first line
const PAD = 0.06; // s kept either side of a line, so its edges aren't clipped

// Most urgent first: a higher one cuts off whatever is being said. `wait`: seconds before it can repeat.
const KINDS = {
  teamkill: { rank: 3, wait: 2 },
  friendly: { rank: 2, wait: 3.5 },
  killTank: { rank: 1, wait: 3 },
  killPlane: { rank: 1, wait: 3 },
};

const TEAMS = ['blue', 'red'];

export class RadioLines {
  constructor(hud, crewId) {
    this.crewId = crewId;
    this.units = new Map(); // id -> { team, crew }: rows don't always carry every unit
    this.nextAt = {};
    this.last = {};
    this.speaking = -1;
    this.busyUntil = 0;
    this.el = document.createElement('div');
    this.el.style.cssText = 'position:absolute;left:50%;bottom:21%;transform:translateX(-50%);padding:5px 12px;background:rgba(14,18,12,.78);border-left:3px solid #d9a441;color:#e8e4d4;font-size:15px;white-space:nowrap;pointer-events:none;opacity:0;transition:opacity .25s;z-index:5';
    hud.appendChild(this.el);
    this.ctx = new AudioContext();
    this.ctx.resume();
    this.load();
    this.off = net.on('s', (msg) => this.onSnapshot(msg));
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
    for (const ev of msg.ev ?? []) this.onEvent(ev, msg.me?.team);
  }

  mine(id) {
    return this.units.get(id)?.crew === this.crewId;
  }

  onEvent(ev, team) {
    if (ev.k === 'i' && ev.u !== undefined && this.mine(ev.o) && !this.mine(ev.u)) {
      if (this.units.get(ev.u)?.team === team) this.say('friendly');
    } else if (ev.k === 'k' && this.mine(ev.by) && !this.mine(ev.u)) {
      if (ev.team === team) this.say('teamkill');
      else if (TANKS[ev.type]) this.say('killTank');
      else if (PLANES[ev.type]) this.say('killPlane');
    }
  }

  pick(kind) {
    const list = LINES[kind];
    let line = list[0];
    if (Math.random() >= FAVOURITE) {
      const rest = list.filter((l) => l !== this.last[kind] && l !== list[0]);
      if (rest.length) line = rest[Math.floor(Math.random() * rest.length)];
    }
    this.last[kind] = line;
    return line;
  }

  say(kind) {
    const k = KINDS[kind];
    const now = performance.now() / 1000;
    if (now < (this.nextAt[kind] ?? 0)) return;
    if (this.speaking >= k.rank && now < this.busyUntil) return;
    this.nextAt[kind] = now + k.wait;
    const line = this.pick(kind);
    const [start, length] = CLIPS[line];
    this.speaking = k.rank;
    this.busyUntil = now + length;
    this.el.textContent = `📻 ${line}`;
    this.el.style.opacity = 1;
    clearTimeout(this.hideT);
    this.hideT = setTimeout(() => (this.el.style.opacity = 0), length * 1000 + 700);
    this.play(start, length);
  }

  play(start, length) {
    if (!this.clips || !settings.masterVolume) return;
    this.playing?.stop();
    const src = this.ctx.createBufferSource();
    src.buffer = this.clips;
    const gain = this.ctx.createGain();
    gain.gain.value = settings.masterVolume;
    src.connect(gain).connect(this.ctx.destination);
    src.start(0, Math.max(0, start - PAD), length + PAD * 2);
    this.playing = src;
  }

  dispose() {
    this.off();
    clearTimeout(this.hideT);
    this.ctx.close();
    this.el.remove();
  }
}
