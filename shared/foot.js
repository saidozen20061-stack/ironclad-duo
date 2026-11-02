// Shared on-foot rules: where the crew can get a new tank and what blocks a soldier.
import { FOOT } from './constants.js';
import { PROPS, propsNear, circleHitsProp } from './props.js';
import { waterDepthAt, PLAY_LIMIT } from './map.js';

export const GARAGES = PROPS.filter((p) => p.type === 'garage' && p.team === 'blue');
export const TEAM_GARAGES = { blue: GARAGES, red: PROPS.filter((p) => p.type === 'garage' && p.team === 'red') };

export function nearGarage(x, z, team = 'blue') {
  return TEAM_GARAGES[team].some((g) => Math.hypot(g.x - x, g.z - z) < FOOT.garageRadius);
}

export function footBlocked(x, z, dead) {
  if (Math.abs(x) > PLAY_LIMIT || Math.abs(z) > PLAY_LIMIT) return true;
  for (const p of propsNear(x, z, 2)) {
    if (p.solid && !dead?.has(p.id) && circleHitsProp(p, x, z, 0.4)) return true;
  }
  return waterDepthAt(x, z) > 1.2; // a bridge deck counts as dry, whatever is underneath
}
