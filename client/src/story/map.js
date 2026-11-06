import { $, showScreen, escapeHtml } from '../ui/screens.js';
import { net } from '../net.js';
import { story, saveStory, rankInfo } from './save.js';
import { CHAPTERS, STAGES, STAGE_TYPES, recommendedTier, enemyList, allyList, unlocked } from './stages.js';
import { rewardsFor, bonusText, stageBase } from './rewards.js';
import { TIERS } from './data.js';
import { battleTank, stageRating, combatRating, buildSpec } from './tanks.js';
import { SPECIALS } from './data.js';
import { rollFeatured } from './shop.js';

// The war map (chapters, stages, briefings), starting a stage, and the results screen after it.

let chapter = 1;
let picked = null;
let lastStage = null;
let hooks = null;

const OBJ = { destroy: 'Destroy all enemy forces', capture: 'Capture and hold the objective', defend: 'Hold the position until time runs out', escort: 'Get the convoy through', reach: 'Break through to the marked area', targets: 'Destroy the marked targets', waves: 'Beat back every wave' };
const chapterOpen = (c) => c.id === 1 || !!story.stars[CHAPTERS[c.id - 2].stages.at(-1).id];
const stars = (n, of = 3) => '★'.repeat(n) + '☆'.repeat(of - n);
const FINALE = "The Iron Chancellor is burning and their line is broken. Somewhere behind you, a radio operator is crying and laughing at the same time. Your crew climbs out of the tank and sits in the mud. For the first time in a long time, nobody is shooting. You can replay any stage to chase stars.";
const bring = new Set(Object.keys(SPECIALS)); // supplies ticked on the briefing card

// The first stage still to win, for the workshop's "what's next".
export const nextStage = () => Object.values(STAGES).find((s) => !story.stars[s.id] && unlocked(s, story.stars) && chapterOpen(CHAPTERS[s.chapter - 1])) ?? null;

export function initStoryMap(h) {
  hooks = h;
  $('#btn-storymap-back').addEventListener('click', () => {
    showScreen('story', { remember: false });
    hooks.renderHub();
  });
  $('#screen-storymap').addEventListener('click', (e) => {
    const tab = e.target.closest('[data-chapter]');
    if (tab && !tab.disabled) {
      chapter = Number(tab.dataset.chapter);
      picked = null;
      return renderMap();
    }
    const node = e.target.closest('[data-stage]');
    if (node) {
      picked = node.dataset.stage;
      return renderMap();
    }
    const sup = e.target.closest('[data-bring]');
    if (sup) {
      bring.has(sup.dataset.bring) ? bring.delete(sup.dataset.bring) : bring.add(sup.dataset.bring);
      return renderBriefing();
    }
    if (e.target.closest('#btn-deploy')) deploy(STAGES[picked]);
  });
  $('#btn-storyend-garage').addEventListener('click', () => {
    hooks.leaveMatch();
    showScreen('story', { remember: false });
    hooks.renderHub();
  });
  $('#btn-storyend-retry').addEventListener('click', () => {
    hooks.leaveMatch();
    deploy(lastStage);
  });
  $('#btn-storyend-map').addEventListener('click', () => {
    hooks.leaveMatch();
    openMap();
  });
}

export function openMap() {
  const open = CHAPTERS.filter(chapterOpen);
  if (!open.some((c) => c.id === chapter)) chapter = open.at(-1).id;
  showScreen('storymap', { remember: false });
  renderMap();
}

function renderMap() {
  const ch = CHAPTERS.find((c) => c.id === chapter);
  $('#storymap-tabs').innerHTML = CHAPTERS.map((c) => `<button data-chapter="${c.id}" class="${c.id === chapter ? 'sel' : ''}" ${chapterOpen(c) ? '' : 'disabled'}>${c.id}. ${c.name}${chapterOpen(c) ? '' : ' 🔒'}</button>`).join('');
  const board = $('#storymap-board');
  board.style.setProperty('--ground', ch.look.ground);
  board.style.setProperty('--ink', ch.look.ink);
  // Stage positions are kept inside a margin so labels and big boss nodes never hang off the edge.
  const X = (v) => 6 + v * 0.88, Y = (v) => 7 + v * 0.8;
  // Dotted paths from each stage to the one it follows.
  const lines = ch.stages.filter((s) => s.after && STAGES[s.after]?.chapter === ch.id).map((s) => {
    const a = STAGES[s.after];
    return `<line x1="${X(a.mx)}" y1="${Y(a.my)}" x2="${X(s.mx)}" y2="${Y(s.my)}" class="${unlocked(s, story.stars) ? 'open' : ''}"/>`;
  }).join('');
  const nodes = ch.stages.map((s) => {
    const t = STAGE_TYPES[s.type];
    const open = unlocked(s, story.stars);
    const best = story.stars[s.id] ?? 0;
    return `<button class="stage-node ${s.type}${open ? '' : ' locked'}${picked === s.id ? ' sel' : ''}" data-stage="${s.id}" style="left:${X(s.mx)}%;top:${Y(s.my)}%;--c:${t.color}" ${open ? '' : 'disabled'} title="${escapeHtml(s.name)}"><i>${open ? t.icon : '🔒'}</i><span>${escapeHtml(s.name)}</span><small>${best ? stars(best) : open ? 'New' : ''}</small></button>`;
  }).join('');
  board.innerHTML = `<svg viewBox="0 0 100 100" preserveAspectRatio="none">${doodles(ch.id)}${lines}</svg>${nodes}`;
  $('#storymap-intro').textContent = ch.intro;
  renderBriefing();
}

// A few hand-drawn marks for each region, under the paths.
function doodles(id) {
  const river = '<path class="river" d="M0,46 C20,40 32,54 50,47 S78,40 100,48"/>';
  const trees = (pts) => pts.map(([x, y]) => `<path class="tree" d="M${x},${y} l1.6,-4 l1.6,4 z"/>`).join('');
  const houses = (pts) => pts.map(([x, y]) => `<rect class="house" x="${x}" y="${y}" width="3" height="2.4"/>`).join('');
  return {
    1: trees([[12, 30], [16, 26], [44, 70], [70, 22], [88, 66], [36, 88]]) + houses([[28, 44], [31, 46], [26, 47]]) + river.replace('46', '12').replace('47', '10'),
    2: river + trees([[10, 20], [60, 80], [85, 25]]),
    3: trees([[10, 30], [20, 70], [50, 20], [80, 75], [90, 40]]).replace(/class="tree"/g, 'class="tree snow"'),
    4: houses([[20, 30], [24, 33], [40, 50], [44, 46], [60, 30], [64, 36], [76, 60], [80, 56]]),
    5: '<path class="wall" d="M10,20 H90 V80 H10 Z"/>' + trees([[5, 90], [95, 10]]),
  }[id] ?? '';
}

function renderBriefing() {
  const card = $('#storymap-brief');
  const s = STAGES[picked];
  if (!s) {
    card.innerHTML = `<h3>${CHAPTERS[chapter - 1].name}</h3><p>Pick a stage on the map to read its briefing.</p>`;
    return;
  }
  const t = STAGE_TYPES[s.type];
  const best = story.stars[s.id] ?? 0;
  const [b2, b3] = bonusText(s);
  card.innerHTML = `
    <div class="brief-type" style="--c:${t.color}">${t.icon} ${t.name}${s.plane ? ' · you fly this one' : ''}</div>
    <h3>${escapeHtml(s.name)}</h3>
    <p class="radio">📻 ${escapeHtml(s.story)}</p>
    <dl>
      <dt>Objective</dt><dd>${OBJ[s.obj]}${s.time && s.obj !== 'defend' ? ` · ${Math.round(s.time / 60)} min limit` : s.obj === 'defend' ? ` · ${Math.round(s.time / 60 * 10) / 10} min` : ''}</dd>
      <dt>Stars</dt><dd>★ Win · ★★ ${b2} · ★★★ ${b3}</dd>
      <dt>Recommended</dt><dd>Tier ${TIERS[recommendedTier(s)]} · combat rating ${stageRating(s)} <small>(yours: ${combatRating(buildSpec(story.current))})</small></dd>
      <dt>Enemy</dt><dd>${enemyList(s).join(', ')}</dd>
      ${allyList(s).length ? `<dt>With you</dt><dd>${allyList(s).join(', ')} <small>(green crews: they need you to lead)</small></dd>` : ''}
      <dt>Reward</dt><dd>${stageBase(s)} silver, +50% for winning${best ? ' (60% on replays)' : `, +${Math.round(stageBase(s) / 2)} first clear`}, plus kills</dd>
      <dt>Best</dt><dd class="stars">${best ? stars(best) : 'Not cleared yet'}</dd>
    </dl>
    ${s.plane ? '' : supplies()}
    <button class="btn primary" id="btn-deploy">Deploy</button>`;
}

function supplies() {
  const have = Object.entries(SPECIALS).filter(([id]) => story.specials[id]);
  if (!have.length) return '<p class="sub">No supplies. Buy repair kits, smoke and ammo in the shop.</p>';
  return `<div class="supplies"><small>TAKE ALONG</small>${have.map(([id, sp]) => `<button data-bring="${id}" class="${bring.has(id) ? 'sel' : ''}" title="${escapeHtml(sp.blurb)}">${bring.has(id) ? '☑' : '☐'} ${sp.name} ×${story.specials[id]}</button>`).join('')}</div>`;
}

export function deploy(s) {
  lastStage = s;
  // Supplies are used up by this stage, won or lost.
  const used = {};
  if (!s.plane) for (const id of Object.keys(SPECIALS)) if (bring.has(id) && story.specials[id]) {
    used[id] = true;
    if (!--story.specials[id]) delete story.specials[id];
  }
  saveStory();
  const tank = battleTank(story.current, used);
  net.startSolo({
    tank: s.plane ?? tank.model,
    paint: s.plane ?? tank.paint,
    mode: 'story',
    difficulty: STAGE_TYPES[s.type].difficulty,
    airStart: !!s.plane,
    night: !!s.night,
    rain: !!s.rain,
    snow: !!s.snow,
    story: { stage: s, spec: s.plane ? null : tank.spec, specials: used },
  });
}

// After a stage: silver and XP counted up line by line, stars, and where to go next.
export function showResults(msg) {
  const s = STAGES[msg.story.stage];
  const win = msg.winner === 'blue';
  const before = story.stars[s.id] ?? 0;
  const rankBefore = rankInfo().rank;
  const r = rewardsFor(s, msg.story, win, before);
  story.coins += r.total;
  story.xp += r.xp;
  if (r.stars > before) story.stars[s.id] = r.stars;
  rollFeatured();
  saveStory();
  const rankAfter = rankInfo();
  $('#storyend-result').textContent = win ? 'VICTORY' : 'DEFEAT';
  $('#storyend-result').className = `result ${win ? 'win' : 'lose'}`;
  $('#storyend-stage').textContent = `${s.name} · ${msg.reason ?? ''}`;
  $('#storyend-stars').innerHTML = [1, 2, 3].map((i) => `<i class="${i <= r.stars ? 'got' : ''}">★</i>`).join('');
  const list = $('#storyend-lines');
  list.innerHTML = r.lines.map(([label, v]) => `<li><span>${escapeHtml(label)}</span><b data-v="${v}">0</b></li>`).join('');
  $('#storyend-rank').textContent = rankAfter.rank > rankBefore ? `Promoted to ${rankAfter.name}!` : `${rankAfter.name} · ${rankAfter.need ? `${rankAfter.into} / ${rankAfter.need} XP` : 'top rank'}`;
  $('#storyend-next').style.display = win ? '' : 'none';
  // Between chapters: a few lines of story when a boss falls for the first time.
  const ch = CHAPTERS[s.chapter - 1];
  const fresh = win && !before && ch.stages.at(-1).id === s.id;
  const nextCh = CHAPTERS[s.chapter];
  $('#storyend-chapter').hidden = !fresh;
  $('#storyend-chapter').innerHTML = !fresh ? '' : nextCh ? `<b>Chapter ${nextCh.id} unlocked: ${nextCh.name}</b><span>${escapeHtml(nextCh.intro)}</span>` : `<b>The war is over.</b><span>${escapeHtml(FINALE)}</span>`;
  showScreen('storyend', { remember: false });
  // Count each line up, then the total.
  const counters = [...list.querySelectorAll('b')];
  const total = $('#storyend-total');
  const t0 = performance.now();
  const step = () => {
    const k = Math.min(1, (performance.now() - t0) / 1400);
    for (const [i, b] of counters.entries()) {
      const local = Math.min(1, Math.max(0, k * counters.length - i * 0.6));
      b.textContent = `+${Math.round(Number(b.dataset.v) * local).toLocaleString('en')}`;
    }
    total.textContent = `+${Math.round(r.total * k).toLocaleString('en')} silver · +${Math.round(r.xp * k).toLocaleString('en')} XP`;
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
