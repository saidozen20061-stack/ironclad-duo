// Story mode balance: plays the whole campaign many times with a simple player model and prints the
// tables in BALANCE.md. Run: node scripts/storyBalance.mjs [runs]
//
// The player model: plays every stage in map order (side stages too), retrying a lost stage until it's
// won. Win chance and stars depend on the tank's combat rating against the stage's. After each stage it
// buys the cheapest tank it doesn't own as soon as rank and silver allow, drives its strongest tank, and
// spends about a quarter of what it earns on parts and upgrades for the gun, armour and engine.

import { STAGES, CHAPTERS } from '../client/src/story/stages.js';
import { rewardsFor } from '../client/src/story/rewards.js';
import { STORY_TANKS, RANKS, PARTS, QUALITY, MAX_LEVEL, SECTIONS, partPrice, upgradePrice } from '../client/src/story/data.js';
import { buildSpec, combatRating, stageRating } from '../client/src/story/tanks.js';

const RUNS = Number(process.argv[2] ?? 300);
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rankOf = (xp) => RANKS.reduce((r, k, i) => (xp >= k.xp ? i + 1 : r), 1);
const order = Object.values(STAGES); // chapter by chapter, in the order they're listed
const KILL_CLASS = { t26: 'light', light: 'light', scout: 'light', wheeled: 'light', medium: 'medium', destroyer: 'medium', aa: 'medium', flak: 'medium', heavy: 'heavy', assault: 'heavy', superheavy: 'heavy' };
const cheapestOfTier = (tier) => Object.entries(STORY_TANKS).filter(([, t]) => t.tier === tier).sort((a, b) => a[1].price - b[1].price)[0];

// Everything a stage puts on the field, as kill classes.
function enemies(stage) {
  const k = {};
  const add = (c, n) => (k[c] = (k[c] ?? 0) + n);
  for (const g of stage.groups) {
    if ((g.team ?? 'red') !== 'red') continue;
    const n = g.n ?? 1;
    if (g.boss) add('boss', 1), n > 1 && add(KILL_CLASS[g.type], n - 1);
    else if (g.kind === 'inf') add('inf', n * (g.size ?? 4));
    else if (g.kind === 'atgun') add('atgun', n);
    else if (g.kind === 'plane') add('plane', n);
    else add(KILL_CLASS[g.type], n);
  }
  return k;
}

function play() {
  const s = { coins: 0, xp: 0, tank: 't26', tanks: { t26: fresh() }, stars: {}, played: 0, partBudget: 0 };
  const log = { tankAt: {}, buys: [], partBuys: [], chapterEnd: {}, earnings: [] };
  for (const stage of order) {
    for (;;) {
      s.played++;
      const fit = s.tanks[s.tank];
      const ratio = combatRating(buildSpec(s.tank, fit)) / stageRating(stage);
      const win = rnd() < clamp(0.7 + 0.7 * (ratio - 1), 0.25, 0.95);
      const all = enemies(stage);
      const kills = Object.fromEntries(Object.entries(all).map(([c, n]) => [c, win ? n : Math.floor(n * 0.4)]));
      const good = win && rnd() < clamp(0.45 * ratio, 0.1, 0.85);
      const fast = good && rnd() < clamp(0.4 * ratio, 0.05, 0.7);
      const shots = 20, hits = Math.round(shots * (0.5 + rnd() * 0.25));
      const r = { kills, shots, hits, deaths: good ? 0 : win ? (rnd() < 0.5 ? 1 : 0) : 3, minHp: good ? 0.6 : 0.3, time: fast ? stage.par - 10 : stage.par + 30 };
      const before = s.stars[stage.id] ?? 0;
      const got = rewardsFor(stage, r, win, before);
      s.coins += got.total;
      s.partBudget += got.total * PART_SHARE;
      s.xp += got.xp;
      log.earnings.push({ chapter: stage.chapter, total: got.total, win });
      if (got.stars > before) s.stars[stage.id] = got.stars;
      shop(s, log);
      if (win) break;
    }
    if (stage.id === CHAPTERS[stage.chapter - 1].stages.at(-1).id) log.chapterEnd[stage.chapter] = { played: s.played, rank: rankOf(s.xp), tier: STORY_TANKS[s.tank].tier, coins: s.coins, cr: combatRating(buildSpec(s.tank, s.tanks[s.tank])) };
  }
  return log;
}

const PART_SHARE = 0.25; // of each stage's silver the model spends on parts; the rest is saved for tanks
const fresh = () => Object.fromEntries(SECTIONS.map((k) => [k, { q: 0, lvl: 1 }]));
const WANT = ['gun', 'hull', 'engine', 'turret', 'extras', 'tracks'];

// The next tank to save for: the cheapest one not owned yet whose rank is reached (or nearly).
const nextTank = (s) => Object.entries(STORY_TANKS).filter(([id, t]) => !s.tanks[id] && t.rank <= rankOf(s.xp) + 1).sort((a, b) => a[1].price - b[1].price)[0];

function shop(s, log) {
  const next = nextTank(s);
  let saving = 0;
  if (next) {
    const [id, t] = next;
    if (rankOf(s.xp) >= t.rank && s.coins >= t.price) {
      s.coins -= t.price;
      s.tanks[id] = fresh();
      // Drive whichever owned tank is strongest.
      s.tank = Object.keys(s.tanks).sort((a, b) => combatRating(buildSpec(b, s.tanks[b])) - combatRating(buildSpec(a, s.tanks[a])))[0];
      log.buys.push([s.played, id]);
      if (!log.tankAt[t.tier]) log.tankAt[t.tier] = s.played;
      return;
    }
    saving = t.price;
  }
  // Spare silver into parts: the cheapest step up on the sections that matter most.
  for (;;) {
    const fit = s.tanks[s.tank];
    const options = WANT.flatMap((k) => [
      fit[k].q < QUALITY.length - 1 ? { k, kind: 'q', price: partPrice(k, fit[k].q + 1) } : null,
      fit[k].lvl < MAX_LEVEL ? { k, kind: 'lvl', price: upgradePrice(k, fit[k].lvl) } : null,
    ]).filter(Boolean).sort((a, b) => a.price - b.price);
    const o = options[0];
    if (!o || o.price > Math.min(s.partBudget, s.coins)) return;
    s.coins -= o.price;
    s.partBudget -= o.price;
    if (o.kind === 'q') fit[o.k].q++;
    else fit[o.k].lvl++;
    log.partBuys.push(s.played);
  }
}

// ---- Many runs, medians.
const runs = Array.from({ length: RUNS }, play);
const median = (xs) => {
  const v = xs.filter((x) => x != null).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : null;
};
const out = [];
out.push(`Simulated ${RUNS} campaigns (${order.length} stages, retrying lost ones).`, '');
out.push('### Silver per stage played', '', '| Chapter | Stages | Median silver per stage | Median per first-clear win | Stages played by the boss | Rank at the end | Tier at the end | Combat rating at the end | Boss rating |', '|---|---|---|---|---|---|---|---|---|');
for (const c of CHAPTERS) {
  const per = median(runs.map((r) => {
    const e = r.earnings.filter((x) => x.chapter === c.id);
    return Math.round(e.reduce((s, x) => s + x.total, 0) / e.length);
  }));
  const wins = median(runs.flatMap((r) => r.earnings.filter((x) => x.chapter === c.id && x.win).map((x) => x.total)));
  const end = (k) => median(runs.map((r) => r.chapterEnd[c.id][k]));
  out.push(`| ${c.id}. ${c.name} | ${c.stages.length} | ${per} | ${wins} | ${end('played')} | ${RANKS[end('rank') - 1].name} | ${end('tier')} | ${end('cr')} | ${stageRating(STAGES[c.stages.at(-1).id])} |`);
}
out.push('', '### Tanks, in the order the model buys them', '', '| Tank | Tier | Price | Rank needed | Bought at stage (median) | Stages since the tank before |', '|---|---|---|---|---|---|');
const ids = Object.keys(STORY_TANKS).filter((id) => STORY_TANKS[id].price).sort((a, b) => STORY_TANKS[a].price - STORY_TANKS[b].price);
for (const id of ids) {
  const t = STORY_TANKS[id];
  const at = median(runs.map((r) => r.buys.find((b) => b[1] === id)?.[0]));
  const gap = median(runs.map((r) => {
    const i = r.buys.findIndex((b) => b[1] === id);
    return i < 0 ? null : r.buys[i][0] - (i ? r.buys[i - 1][0] : 0);
  }));
  out.push(`| ${id} | ${t.tier} | ${t.price.toLocaleString('en')} | ${RANKS[t.rank - 1].name} | ${at ?? 'never'} | ${gap ?? '—'} |`);
}
const allGaps = runs.flatMap((r) => r.buys.map((b, i) => b[0] - (i ? r.buys[i - 1][0] : 0)));
out.push('', `Median stages between tank purchases: ${median(allGaps)}. First tier II at stage ${median(runs.map((r) => r.tankAt[2]))}, tier III ${median(runs.map((r) => r.tankAt[3]))}, tier IV ${median(runs.map((r) => r.tankAt[4]))}, tier V ${median(runs.map((r) => r.tankAt[5]))}.`);
const gaps = runs.flatMap((r) => r.partBuys.slice(1).map((p, i) => p - r.partBuys[i]).filter((g) => g > 0));
out.push('', `Part buys or upgrades: median gap ${median(gaps)} stage(s) between stages where one is bought; ${median(runs.map((r) => r.partBuys.length))} in a campaign.`);
out.push('', '### Prices', '', '| Part | Improved | Elite | Experimental | Upgrade 1→2 | Upgrade 4→5 |', '|---|---|---|---|---|---|');
for (const k of SECTIONS) out.push(`| ${PARTS[k].name} | ${partPrice(k, 1)} | ${partPrice(k, 2)} | ${partPrice(k, 3)} | ${upgradePrice(k, 1)} | ${upgradePrice(k, 4)} |`);
console.log(out.join('\n'));
