// Silver and XP for a finished stage. Pure, so the balance simulation (scripts/storyBalance.mjs) can use
// it too. XP is given the same way as silver.

export const BASE = { easy: 300, normal: 500, hard: 900, special: 700, boss: 1500 };
// Later chapters pay more for the same kind of stage, so the next tier's price stays a few stages away.
export const CHAPTER_SCALE = [1, 2.2, 3.6, 5.2, 6.8];
export const stageBase = (stage) => Math.round(BASE[stage.type] * CHAPTER_SCALE[(stage.chapter ?? 1) - 1]);
export const KILL_VALUE = { inf: 5, atgun: 15, light: 25, medium: 40, heavy: 70, plane: 50, boss: 400 };
const VICTORY_BONUS = 0.5;
const DEFEAT_SHARE = 0.3;
const REPLAY_SHARE = 0.6;
const FIRST_CLEAR = 0.5;
const PER_STAR = 100;
const NO_LOSS = 150;
const SHARP = { accuracy: 0.6, shots: 3, bonus: 100 };
const HALF_ARMOUR = 0.5;

// 1 star for winning, 2 for winning without losing half your armour, 3 for doing that inside the par time.
export function starsFor(stage, r, win) {
  if (!win) return 0;
  const bonus = r.deaths === 0 && r.minHp >= HALF_ARMOUR;
  return bonus ? (r.time <= stage.par ? 3 : 2) : 1;
}

export const bonusText = (stage) => [`Keep over ${HALF_ARMOUR * 100}% of your armour and don't lose a tank`, `...and win within ${Math.floor(stage.par / 60)}:${String(stage.par % 60).padStart(2, '0')}`];

// The breakdown, as [label, silver] lines, with the stars earned.
export function rewardsFor(stage, r, win, bestBefore = 0) {
  const base = stageBase(stage);
  const lines = [];
  const stars = starsFor(stage, r, win);
  if (win) {
    const paid = bestBefore ? Math.round(base * REPLAY_SHARE) : base;
    lines.push([bestBefore ? 'Stage reward (replay)' : 'Stage reward', paid]);
    lines.push(['Victory bonus', Math.round(paid * VICTORY_BONUS)]);
    if (!bestBefore) lines.push(['First clear', Math.round(base * FIRST_CLEAR)]);
    const newStars = Math.max(0, stars - bestBefore);
    if (newStars) lines.push([`New star${newStars > 1 ? 's' : ''} ×${newStars}`, newStars * PER_STAR]);
  } else lines.push(['Stage reward (defeat)', Math.round(base * DEFEAT_SHARE)]);
  for (const [k, n] of Object.entries(r.kills ?? {})) if (n && KILL_VALUE[k]) lines.push([`${KILL_NAMES[k]} ×${n}`, n * KILL_VALUE[k]]);
  if (win && r.deaths === 0) lines.push(['No tank lost', NO_LOSS]);
  if (r.shots >= SHARP.shots && r.hits / r.shots > SHARP.accuracy) lines.push([`Accuracy ${Math.round((r.hits / r.shots) * 100)}%`, SHARP.bonus]);
  const total = lines.reduce((s, [, v]) => s + v, 0);
  return { lines, total, xp: total, stars };
}

const KILL_NAMES = { inf: 'Infantry', atgun: 'Anti-tank guns', light: 'Light tanks', medium: 'Medium tanks', heavy: 'Heavy tanks', plane: 'Planes', boss: 'Boss' };
