// Shared on-foot rules: where the crew can get a new tank and what blocks a soldier.
import { FOOT } from './constants.js';
import { PROPS, propsNear, circleHitsProp } from './props.js';
import { heightAt, WATER_LEVEL, PLAY_LIMIT } from './map.js';

export const GARAGES = PROPS.filter((p) => p.type === 'garage' && p.team === 'blue');

export function nearGarage(x, z) {
  return GARAGES.some((g) => Math.hypot(g.x - x, g.z - z) < FOOT.garageRadius);
}

export function footBlocked(x, z, dead) {
  if (Math.abs(x) > PLAY_LIMIT || Math.abs(z) > PLAY_LIMIT) return true;
  for (const p of propsNear(x, z, 2)) {
    if (p.solid && !dead?.has(p.id) && circleHitsProp(p, x, z, 0.4)) return true;
  }
  return heightAt(x, z) < WATER_LEVEL - 1.2;
}
