import { wrapAngle } from '../../../shared/tank.js';
import { TYPE_IDS, TANKS } from '../../../shared/constants.js';
import { PLANES } from '../../../shared/planes.js';

// Rebuilds the world from the host's delta snapshots and returns smoothly interpolated
// unit states slightly in the past. Each unit keeps its own short history, so units that
// are only refreshed a few times a second (far away) still glide instead of jumping.
const INTERP_DELAY = 0.1; // seconds behind the newest host state
const MAX_DELAY = 0.3;
const HISTORY = 8;
const TEAMS = ['blue', 'red'];

// Rows are quantised on the host: positions in dm, angles in mrad, hp in %, jump in cm.
export function decodeUnit(a) {
  return {
    id: a[0],
    team: TEAMS[a[1]],
    type: TYPE_IDS[a[2]],
    x: a[3] / 10,
    z: a[4] / 10,
    h: a[5] / 1000,
    ty: a[6] / 1000,
    gp: a[7] / 1000,
    hp: a[8] / 100,
    dead: !!a[9],
    player: a[10] > 0 && TYPE_IDS[a[2]] !== 'crew',
    crew: a[10] > 0 ? a[10] - 1 : null,
    y: (a[11] ?? 0) / 100,
    gy: (a[12] ?? 0) / 100, // planes: where the side gun points
    gx: (a[13] ?? 0) / 100,
    ab: !!a[14], // planes: afterburner lit
  };
}

export class SnapshotBuffer {
  constructor() {
    this.offset = null; // hostTime - localTime
    this.units = new Map(); // id -> { samples: [[time, state], ...] }
    this.current = new Map(); // id -> newest decoded state
    this.time = 0;
  }

  push(msg) {
    const now = performance.now() / 1000;
    const sample = msg.time - now;
    // Track the clock offset, quick to catch up, slow to drift.
    if (this.offset === null || sample > this.offset) this.offset = sample;
    else this.offset += (sample - this.offset) * 0.02;
    this.time = msg.time;

    const seen = msg.full ? new Set() : null;
    for (const a of msg.u) {
      const st = decodeUnit(a);
      seen?.add(st.id);
      let rec = this.units.get(st.id);
      if (!rec) this.units.set(st.id, (rec = { samples: [] }));
      const last = rec.samples[rec.samples.length - 1];
      // A unit that sat still (no updates) starts moving: anchor its old state one tick back
      // so it doesn't slide over the whole idle period.
      if (last && msg.time - last[0] > 0.5) rec.samples.push([msg.time - 0.05, last[1]]);
      rec.samples.push([msg.time, st]);
      if (rec.samples.length > HISTORY) rec.samples.splice(0, rec.samples.length - HISTORY);
      this.current.set(st.id, st);
    }
    for (const id of msg.rm ?? []) this.drop(id);
    if (seen) for (const id of [...this.units.keys()]) if (!seen.has(id)) this.drop(id);
  }

  drop(id) {
    this.units.delete(id);
    this.current.delete(id);
  }

  get latest() {
    return this.units.size ? { time: this.time, units: this.current } : null;
  }

  // Returns Map(id -> interpolated state).
  sample() {
    const out = new Map();
    const base = performance.now() / 1000 + (this.offset ?? 0);
    for (const [id, rec] of this.units) {
      const s = rec.samples;
      const n = s.length;
      if (n === 1) {
        out.set(id, s[0][1]);
        continue;
      }
      // Render each unit as far in the past as its update rate needs.
      const gap = s[n - 1][0] - s[n - 2][0];
      const t = base - Math.max(INTERP_DELAY, Math.min(MAX_DELAY, gap * 1.2));
      if (t >= s[n - 1][0]) {
        out.set(id, s[n - 1][1]);
        continue;
      }
      let i = n - 1;
      while (i > 0 && s[i - 1][0] > t) i--;
      if (i === 0) {
        out.set(id, s[0][1]);
        continue;
      }
      const [ta, ua] = s[i - 1];
      const [tb, ub] = s[i];
      // Snap instead of sliding across the map on respawn.
      if ((ua.dead !== ub.dead && !PLANES[ub.type]) || Math.hypot(ub.x - ua.x, ub.z - ua.z) > (PLANES[ub.type] ? 90 : 30)) {
        out.set(id, ub);
        continue;
      }
      const f = Math.max(0, Math.min(1, (t - ta) / Math.max(1e-6, tb - ta)));
      out.set(id, {
        ...ub,
        x: ua.x + (ub.x - ua.x) * f,
        z: ua.z + (ub.z - ua.z) * f,
        y: ua.y + (ub.y - ua.y) * f,
        h: ua.h + wrapAngle(ub.h - ua.h) * f,
        // Infantry `ty` is a pose code, not an angle: never blend it.
        ty: TANKS[ub.type] || PLANES[ub.type] ? ua.ty + wrapAngle(ub.ty - ua.ty) * f : ub.ty,
        gp: ua.gp + (ub.gp - ua.gp) * f,
      });
    }
    return out;
  }
}
