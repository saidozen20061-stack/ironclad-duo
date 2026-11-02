import { heightAt } from '../../../shared/map.js';
import { propsNear, segmentHitsProp } from '../../../shared/props.js';

// Who can actually be seen from here. Enemy markers (minimap dots, name tags) go through
// this, so hills and buildings hide them just like they hide the unit itself. A unit stays
// "spotted" for a few seconds after it drops out of sight.
const RECHECK = 0.4; // seconds between line-of-sight tests per unit
const MEMORY = 5;

export function lineClear(ax, ay, az, bx, by, bz, deadProps) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len = Math.hypot(dx, dz);
  const steps = Math.min(80, Math.ceil(len / 7));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (ay + dy * t < heightAt(ax + dx * t, az + dz * t)) return false;
  }
  const seg = Math.max(1, Math.ceil(len / 50));
  for (let i = 0; i < seg; i++) {
    const t = (i + 0.5) / seg;
    for (const p of propsNear(ax + dx * t, az + dz * t, 30)) {
      if (!p.solid || !p.cover || deadProps?.has(p.id)) continue;
      const h = segmentHitsProp(p, ax, ay, az, dx, dy, dz);
      if (h !== null && h > 0.02 && h < 0.98) return false;
    }
  }
  return true;
}

export class Spotter {
  constructor() {
    this.seen = new Map(); // unit id -> { check, until }
  }

  // eye: {x, y, z}. Target height: roughly the unit's top.
  sees(u, eye, range, deadProps) {
    if (Math.hypot(u.x - eye.x, u.z - eye.z) > range) return false;
    const now = performance.now() / 1000;
    let s = this.seen.get(u.id);
    if (!s) this.seen.set(u.id, (s = { check: 0, until: 0 }));
    if (now >= s.check) {
      s.check = now + RECHECK * (0.8 + Math.random() * 0.4);
      if (lineClear(eye.x, eye.y, eye.z, u.x, heightAt(u.x, u.z) + 2, u.z, deadProps)) s.until = now + MEMORY;
    }
    return now < s.until;
  }
}
