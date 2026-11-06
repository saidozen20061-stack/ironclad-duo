import { TANKS } from '../../../shared/constants.js';
import { story } from './save.js';
import { STORY_TANKS, PARTS, SECTIONS, QUALITY, LEVEL_GAIN, WEIGHT_LIMIT } from './data.js';
import { recommendedTier } from './stages.js';

// Story tanks: their stats with the fitted parts, the combat rating, and the tank a crew takes into a
// stage. Pure apart from reading the save, so the balance script can use it too.

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
export function merge(a, b) {
  if (!isObj(b)) return b ?? a;
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = isObj(v) && isObj(a?.[k]) ? merge(a[k], v) : v;
  return out;
}

const STANDARD = Object.fromEntries(SECTIONS.map((s) => [s, { q: 0, lvl: 1 }]));
export const fitOf = (id) => ({ ...STANDARD, ...(story.tanks[id]?.fit ?? {}) });
// How much a fitted part improves its section: 0 for standard at level 1.
export const gainOf = (p) => QUALITY[p.q].gain + LEVEL_GAIN * (p.lvl - 1);

// The tank as the story knows it (name, class, picture) on top of its battle model.
export function tankInfo(id) {
  const t = STORY_TANKS[id];
  const m = TANKS[t.model];
  return { id, ...t, name: t.name ?? m.name, class: t.class ?? m.class, inspired: t.inspired ?? m.inspired, blurb: t.blurb ?? m.blurb, label: t.base?.weapon?.label ?? m.weapon.label };
}

// Tonnes of add-ons, and the most this tier can carry before slowing down.
export function weightOf(id, fit = fitOf(id)) {
  const used = SECTIONS.reduce((s, k) => s + PARTS[k].weight * fit[k].q, 0);
  return { used: Math.round(used * 10) / 10, limit: WEIGHT_LIMIT[STORY_TANKS[id].tier] };
}

// Full battle spec for a story tank with its parts (and any supplies) applied.
export function buildSpec(id, fit = fitOf(id), specials = {}) {
  const t = STORY_TANKS[id];
  const s = merge(structuredClone(TANKS[t.model]), structuredClone(t.base ?? {}));
  const w = s.weapon;
  const g = Object.fromEntries(SECTIONS.map((k) => [k, gainOf(fit[k])]));
  const dmg = (1 + g.gun) * (specials.ap ? 1.15 : 1);
  if (w.shells) for (const sh of Object.values(w.shells)) sh.damage = Math.round(sh.damage * dmg);
  else w.damage = Math.round(w.damage * dmg);
  w.reload = +(w.reload * (1 - g.gun * 0.5) * (specials.ammo ? 0.9 : 1)).toFixed(2);
  w.spread *= 1 - g.gun;
  if (w.coax) w.coax.belt = Math.round(w.coax.belt * (1 + g.ammo * 2) * (specials.ammo ? 2 : 1));
  s.turretSpeed *= 1 + g.turret;
  s.armor.front *= (1 - g.hull * 0.6) * (1 - g.turret * 0.25);
  s.armor.side *= (1 - g.hull * 0.6) * (1 - g.extras * 0.4);
  s.armor.rear *= 1 - g.hull * 0.6;
  s.maxSpeed *= 1 + g.engine * 0.5;
  s.accel *= 1 + g.engine;
  s.turnRate *= 1 + g.tracks * 0.6;
  s.hp = Math.round(s.hp * (1 + g.extras * 0.25 + g.hull * 0.1));
  s.sense = g.optics + g.radio; // seeing first: only in the combat rating for now
  const { used, limit } = weightOf(id, fit);
  if (used > limit) {
    const slow = Math.max(0.6, 1 - (used - limit) * 0.06);
    s.maxSpeed *= slow;
    s.accel *= slow;
  }
  for (const k of ['front', 'side', 'rear']) s.armor[k] = +s.armor[k].toFixed(3);
  s.name = t.name ?? s.name;
  s.class = t.class ?? s.class;
  s.inspired = t.inspired ?? s.inspired;
  return s;
}

// One number for how strong a tank is: toughness times firepower, plus a little for speed.
export function combatRating(spec) {
  const w = spec.weapon;
  const alpha = w.shells ? w.shells.AP.damage : w.damage;
  // Bursts miss more than single aimed shots.
  const dps = w.kind === 'autocannon' ? (0.7 * w.damage * w.magazine) / (w.reload + w.magazine * w.fireInterval) : alpha / w.reload;
  const toughness = spec.hp / ((spec.armor.front + spec.armor.side) / 2);
  return Math.round((Math.sqrt(toughness * dps * 10) + spec.maxSpeed * 5) * (1 + (spec.sense ?? 0) * 0.15));
}

// The rating a stage is pitched at: a stock tank of its recommended tier.
const REFERENCE = ['', 't26', 'stuart', 'sherman', 't3485', 'is2'];
export const stageRating = (stage) => combatRating(buildSpec(REFERENCE[recommendedTier(stage)], STANDARD));

// What the crew takes into a stage: model, paint, name and the stats it fights with.
export function battleTank(id = story.current, specials = {}) {
  const t = STORY_TANKS[id];
  return { id, model: t.model, paint: t.paint ?? (t.model === id ? id : `story-${id}`), name: tankInfo(id).name, spec: buildSpec(id, fitOf(id), specials) };
}

// The client's views read TANKS[model] for names and the health bar, so during a story stage that entry
// is the story tank's. The simulation runs in its own worker with its own copy. Returns the undo.
export function useSpec(model, spec) {
  const was = TANKS[model];
  TANKS[model] = spec;
  return () => {
    TANKS[model] = was;
  };
}
