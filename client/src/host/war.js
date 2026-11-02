import { POINTS, BASES, groundAt, PLAY_LIMIT, WATER_LEVEL } from '../../../shared/map.js';
import { FORT, fortressOn } from '../../../shared/props.js';
import { WAR } from '../../../shared/constants.js';

// The war around the match: artillery barrages and bomber runs that land all over the map,
// mostly away from the capture points. Clients are told a shell is on its way ('inc'), so a
// shell landing close by always whistles first; 'shell' is the impact. Damage is small on
// purpose: this is atmosphere that keeps you moving, not a way to lose the match.

const rand = (a, b) => a + Math.random() * (b - a);
const r1 = (v) => Math.round(v * 10) / 10;

export class WarDirector {
  constructor(match) {
    this.m = match;
    this.nextBarrage = rand(...WAR.firstBarrage);
    this.nextBomber = rand(...WAR.firstBomber);
    this.shells = [];
  }

  // A spot away from capture points and bases (now and then, right on top of one).
  target() {
    const risky = Math.random() < WAR.nearPointChance;
    for (let k = 0; k < 20; k++) {
      const x = rand(-PLAY_LIMIT, PLAY_LIMIT) * 0.92, z = rand(-PLAY_LIMIT, PLAY_LIMIT) * 0.92;
      if (Object.values(BASES).some((b) => Math.hypot(b.x - x, b.z - z) < 130)) continue;
      if (fortressOn() && Math.hypot(x - FORT.center.x, z - FORT.center.z) < 190) continue;
      if (!risky && POINTS.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + 70)) continue;
      return [x, z];
    }
    return [rand(-300, 300), rand(-200, 200)];
  }

  queue(x, z, at, fall, size) {
    this.shells.push({ x, z, at, warnAt: at - fall, fall, size, warned: false });
  }

  barrage() {
    const [cx, cz] = this.target();
    const n = Math.round(rand(...WAR.barrageShells));
    const t = this.m.time;
    let at = t + WAR.shellFall;
    for (let i = 0; i < n; i++) {
      at += rand(0.5, 1.5);
      this.queue(cx + rand(-45, 45), cz + rand(-45, 45), at, WAR.shellFall, 1);
    }
  }

  // A formation flies across the map along a straight line and drops a stick of bombs on a
  // stretch of it; clients draw the planes from the same start time and speed.
  bomberRun() {
    const [cx, cz] = this.target();
    const a = rand(0, Math.PI * 2);
    const dx = Math.sin(a), dz = Math.cos(a);
    const t = this.m.time;
    const lead = 1600; // starts this far out
    this.m.events.push({ k: 'bomber', x: r1(cx - dx * lead), z: r1(cz - dz * lead), dx: +dx.toFixed(3), dz: +dz.toFixed(3), v: WAR.bomberSpeed, y: WAR.bomberAlt });
    const n = Math.round(rand(...WAR.bomberBombs));
    for (let i = 0; i < n; i++) {
      const along = (i - n / 2) * 15;
      const x = cx + dx * along + rand(-5, 5), z = cz + dz * along + rand(-5, 5);
      if (Math.abs(x) > PLAY_LIMIT || Math.abs(z) > PLAY_LIMIT) continue;
      this.queue(x, z, t + (lead + along) / WAR.bomberSpeed + WAR.bombFall, WAR.bombFall, 1.35);
    }
  }

  land(s) {
    const m = this.m;
    const y = Math.max(groundAt(s.x, s.z), WATER_LEVEL);
    m.events.push({ k: 'shell', x: r1(s.x), y: r1(y), z: r1(s.z), size: s.size });
    const R = WAR.blastRadius * s.size;
    for (const u of m.units) {
      if (u.dead) continue;
      const d = Math.hypot(u.x - s.x, u.z - s.z);
      if (d > R) continue;
      const k = 1 - d / R;
      if (u.kind === 'tank') m.damage(u, u.spec.hp * WAR.tankDamage * k, { owner: -1, blast: [s.x, s.z] });
      else if (u.kind === 'inf') {
        m.damage(u, WAR.infDamage * k, { owner: -1, blast: [s.x, s.z] });
        if (u.ai) u.ai.proneT = Math.max(u.ai.proneT, 2 + Math.random() * 2);
      }
    }
    // The smoke hangs around and hides things from NPC gunners for a while.
    m.smokeZones.push({ x: s.x, z: s.z, r: 12 * s.size, until: m.time + 16 });
  }

  tick() {
    const m = this.m;
    const t = m.time;
    if (t >= this.nextBarrage) {
      this.nextBarrage = t + rand(...WAR.barrageEvery);
      this.barrage();
    }
    if (t >= this.nextBomber) {
      this.nextBomber = t + rand(...WAR.bomberEvery);
      this.bomberRun();
    }
    const keep = [];
    for (const s of this.shells) {
      if (!s.warned && t >= s.warnAt) {
        s.warned = true;
        m.events.push({ k: 'inc', x: r1(s.x), z: r1(s.z), fall: s.fall, size: s.size });
      }
      if (t >= s.at) this.land(s);
      else keep.push(s);
    }
    this.shells = keep;
    if (m.smokeZones.length) m.smokeZones = m.smokeZones.filter((z) => z.until > t);
  }
}
