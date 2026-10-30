import { wrapAngle } from '../../../shared/tank.js';
import { TYPE_IDS } from '../../../shared/constants.js';

// Buffers server snapshots and returns smoothly interpolated unit states slightly in the past.
const INTERP_DELAY = 0.1; // seconds behind the newest server state
const TEAMS = ['blue', 'red'];

export function decodeUnit(a) {
  return { id: a[0], team: TEAMS[a[1]], type: TYPE_IDS[a[2]], x: a[3], z: a[4], h: a[5], ty: a[6], gp: a[7], hp: a[8], dead: !!a[9], player: !!a[10] };
}

export class SnapshotBuffer {
  constructor() {
    this.snaps = []; // { time, units: Map }
    this.offset = null; // serverTime - localTime
  }

  push(msg) {
    const now = performance.now() / 1000;
    const sample = msg.time - now;
    // Track the clock offset, quick to catch up, slow to drift.
    if (this.offset === null || sample > this.offset) this.offset = sample;
    else this.offset += (sample - this.offset) * 0.02;
    const units = new Map();
    for (const a of msg.u) units.set(a[0], decodeUnit(a));
    this.snaps.push({ time: msg.time, units });
    if (this.snaps.length > 30) this.snaps.shift();
  }

  get latest() {
    return this.snaps[this.snaps.length - 1] ?? null;
  }

  renderTime() {
    return performance.now() / 1000 + (this.offset ?? 0) - INTERP_DELAY;
  }

  // Returns Map(id -> interpolated state).
  sample() {
    const n = this.snaps.length;
    if (n === 0) return new Map();
    const t = this.renderTime();
    let a = this.snaps[0];
    let b = this.snaps[n - 1];
    if (t <= a.time) return a.units;
    if (t >= b.time) return b.units;
    for (let i = n - 1; i > 0; i--) {
      if (this.snaps[i - 1].time <= t) {
        a = this.snaps[i - 1];
        b = this.snaps[i];
        break;
      }
    }
    const f = (t - a.time) / Math.max(1e-6, b.time - a.time);
    const out = new Map();
    for (const [id, ub] of b.units) {
      const ua = a.units.get(id);
      // Snap instead of sliding across the map on respawn.
      if (!ua || ua.dead !== ub.dead || Math.hypot(ub.x - ua.x, ub.z - ua.z) > 30) {
        out.set(id, ub);
        continue;
      }
      out.set(id, {
        ...ub,
        x: ua.x + (ub.x - ua.x) * f,
        z: ua.z + (ub.z - ua.z) * f,
        h: ua.h + wrapAngle(ub.h - ua.h) * f,
        ty: ua.ty + wrapAngle(ub.ty - ua.ty) * f,
        gp: ua.gp + (ub.gp - ua.gp) * f,
      });
    }
    return out;
  }
}
