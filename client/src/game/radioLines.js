import { net } from '../net.js';
import { settings } from '../settings.js';
import { TANKS } from '../../../shared/constants.js';
import { PLANES } from '../../../shared/planes.js';

// Command on the radio, reacting to what this crew shoots: spoken by the browser's own voice, with
// a click of static either side and a subtitle. The first line of each list comes up most often.
const LINES = {
  friendly: ['What are you doing!!', 'Cease fire! Cease fire!', 'Check your fire, that is one of ours!', 'Friendly fire! Friendly fire!', 'Hey! We are on the same side!', 'Watch where you are shooting!', 'Whose side are you on?!', 'Stop shooting at us!', 'Are you blind? That is a friendly!', 'Hold your fire, you idiot!', 'Look at your target, soldier!', 'One more shot like that and you are walking home!'],
  teamkill: ['What have you done?!', 'You just killed one of our own!', 'Friendly down! Friendly down! That was you!', 'That was our guy! What is wrong with you?!', 'You will answer for that, soldier!', 'Unbelievable. You took out your own side.'],
  hit: ['Good job, soldier!', 'Good hit!', 'Direct hit!', 'Nice shot!', 'Target hit, keep it up!', 'That one felt it!', 'Keep firing, they are hurting!', 'Right on target!', 'Great shooting!', 'Hit confirmed!', 'Stay on them!', 'That is how it is done!'],
  killTank: ['Good job, soldier! Tank destroyed!', 'Enemy armour down!', 'Scratch one tank!', 'That tank is finished!', 'Beautiful shot, that tank is burning!', 'Target destroyed, find the next one!'],
  killPlane: ['Good job, soldier! Enemy plane down!', 'Splash one!', 'Bandit down!', 'You got him, he is going down!', 'Great kill, the sky is a little safer!', 'That plane is not coming home!'],
  killFoot: ['Good job, soldier!', 'Enemy down!', 'Got one!', 'Target neutralised!', 'He is not getting up!', 'Good kill!'],
};
const FAVOURITE = 0.35; // chance of a list's first line

// Most urgent first: a higher one cuts off whatever is being said. `wait`: seconds before it can repeat.
const KINDS = {
  teamkill: { rank: 3, wait: 2, rate: 1.15, pitch: 0.75 },
  friendly: { rank: 2, wait: 3.5, rate: 1.25, pitch: 1.15 },
  killTank: { rank: 1, wait: 3, rate: 1.05, pitch: 0.9 },
  killPlane: { rank: 1, wait: 3, rate: 1.05, pitch: 0.9 },
  killFoot: { rank: 1, wait: 5, rate: 1.05, pitch: 0.9 },
  hit: { rank: 0, wait: 9, rate: 1.05, pitch: 0.95 },
};

const TEAMS = ['blue', 'red'];

export class RadioLines {
  constructor(hud, crewId) {
    this.crewId = crewId;
    this.units = new Map(); // id -> { team, crew }: rows don't always carry every unit
    this.nextAt = {};
    this.last = {};
    this.speaking = -1;
    this.synth = window.speechSynthesis ?? null;
    this.el = document.createElement('div');
    this.el.style.cssText = 'position:absolute;left:50%;bottom:21%;transform:translateX(-50%);padding:5px 12px;background:rgba(14,18,12,.78);border-left:3px solid #d9a441;color:#e8e4d4;font-size:15px;white-space:nowrap;pointer-events:none;opacity:0;transition:opacity .25s;z-index:5';
    hud.appendChild(this.el);
    this.off = net.on('s', (msg) => this.onSnapshot(msg));
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
      const victim = this.units.get(ev.u);
      if (victim) this.say(victim.team === team ? 'friendly' : 'hit');
    } else if (ev.k === 'k' && this.mine(ev.by) && !this.mine(ev.u)) {
      if (ev.team === team) this.say('teamkill');
      else this.say(TANKS[ev.type] ? 'killTank' : PLANES[ev.type] ? 'killPlane' : 'killFoot');
    }
  }

  pick(kind) {
    const list = LINES[kind];
    let line = list[0];
    if (Math.random() >= FAVOURITE) {
      const rest = list.filter((l) => l !== this.last[kind] && l !== list[0]);
      line = rest[Math.floor(Math.random() * rest.length)];
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
    this.speaking = k.rank;
    this.busyUntil = now + 1 + line.length * 0.07;
    this.el.textContent = `📻 ${line}`;
    this.el.style.opacity = 1;
    clearTimeout(this.hideT);
    this.hideT = setTimeout(() => (this.el.style.opacity = 0), (this.busyUntil - now) * 1000 + 600);
    this.click();
    if (!this.synth || !settings.masterVolume) return;
    this.synth.cancel();
    const u = new SpeechSynthesisUtterance(line);
    u.voice = this.voice();
    u.lang = u.voice?.lang ?? 'en-US';
    u.rate = k.rate;
    u.pitch = k.pitch;
    u.volume = settings.masterVolume;
    u.onend = () => this.click();
    this.synth.speak(u);
  }

  // An English voice if the computer has one. The list can fill in late, so it's looked up each time.
  voice() {
    const voices = this.synth.getVoices();
    return voices.find((v) => /^en[-_]US/i.test(v.lang)) ?? voices.find((v) => /^en/i.test(v.lang)) ?? null;
  }

  // The squelch of a radio opening or closing.
  click() {
    if (!settings.masterVolume) return;
    const ctx = (this.ctx ??= new AudioContext());
    const n = Math.floor(ctx.sampleRate * 0.07);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1900;
    filter.Q.value = 1.2;
    const gain = ctx.createGain();
    gain.gain.value = 0.16 * settings.masterVolume;
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start();
  }

  dispose() {
    this.off();
    clearTimeout(this.hideT);
    this.synth?.cancel();
    this.ctx?.close();
    this.el.remove();
  }
}
