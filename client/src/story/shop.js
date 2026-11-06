import { $, showScreen, toast, escapeHtml } from '../ui/screens.js';
import { story, saveStory, rankInfo } from './save.js';
import { STORY_TANKS, TIERS, RANKS, PARTS, SECTIONS, QUALITY, SPECIALS, MAX_SPECIALS, partPrice } from './data.js';
import { tankInfo, buildSpec, combatRating, fitOf, gainOf } from './tanks.js';

// The shop: tanks, workshop parts and one-stage supplies. One item is on offer at 20% off, changed
// after every stage. Anything owned sells back for half its price.

const DISCOUNT = 0.2;
const SELL_BACK = 0.5;
let tab = 'tanks';
let picked = null;
let hooks = null;

const isFeatured = (kind, id) => story.featured?.kind === kind && story.featured.id === id;
const basePrice = (kind, id) => (kind === 'tank' ? STORY_TANKS[id].price : kind === 'part' ? partPrice(...splitPart(id)) : SPECIALS[id].price);
export const priceOf = (kind, id) => Math.round(basePrice(kind, id) * (isFeatured(kind, id) ? 1 - DISCOUNT : 1));
const splitPart = (id) => {
  const [sec, q] = id.split(':');
  return [sec, Number(q)];
};
const silver = (n) => `${n.toLocaleString('en')} silver`;

// After each stage: something new goes on offer, from what the crew could actually buy.
export function rollFeatured() {
  const rank = rankInfo().rank;
  const pool = [
    ...Object.keys(STORY_TANKS).filter((id) => !story.tanks[id] && STORY_TANKS[id].price && STORY_TANKS[id].rank <= rank + 1).map((id) => ({ kind: 'tank', id })),
    ...SECTIONS.flatMap((s) => [1, 2, 3].map((q) => ({ kind: 'part', id: `${s}:${q}` }))),
    ...Object.keys(SPECIALS).map((id) => ({ kind: 'special', id })),
  ];
  story.featured = pool[Math.floor(Math.random() * pool.length)];
}

export function initShop(h) {
  hooks = h;
  $('#btn-shop-back').addEventListener('click', () => {
    showScreen('story', { remember: false });
    hooks.renderHub();
  });
  $('#screen-shop').addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) {
      tab = t.dataset.tab;
      picked = null;
      return render();
    }
    const item = e.target.closest('[data-item]');
    if (item) {
      picked = item.dataset.item;
      return render();
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act) {
      act === 'buy' ? buy() : sell();
      saveStory();
      render();
    }
  });
}

export function openShop(what) {
  if (what) [tab, picked] = what;
  showScreen('shop', { remember: false });
  render();
}

function buy() {
  const [kind, id] = picked.split('|');
  const price = priceOf(kind, id);
  if (story.coins < price) return toast('Not enough silver.');
  if (kind === 'tank') {
    if (story.tanks[id] || STORY_TANKS[id].rank > rankInfo().rank) return;
    story.tanks[id] = { fit: {} };
    story.current = id;
    toast(`${tankInfo(id).name} bought. It's your battle tank now.`);
  } else if (kind === 'part') story.parts[id] = (story.parts[id] ?? 0) + 1;
  else {
    if ((story.specials[id] ?? 0) >= MAX_SPECIALS) return toast(`You can carry ${MAX_SPECIALS} at most.`);
    story.specials[id] = (story.specials[id] ?? 0) + 1;
  }
  story.coins -= price;
  if (isFeatured(kind, id)) story.featured = null;
}

function sell() {
  const [kind, id] = picked.split('|');
  const back = Math.round(basePrice(kind, id) * SELL_BACK);
  if (kind === 'tank') {
    if (!story.tanks[id] || Object.keys(story.tanks).length < 2 || !STORY_TANKS[id].price) return;
    // Its fitted parts go back on the shelf.
    for (const [sec, p] of Object.entries(story.tanks[id].fit)) if (p.q) story.parts[`${sec}:${p.q}`] = (story.parts[`${sec}:${p.q}`] ?? 0) + 1;
    delete story.tanks[id];
    if (story.current === id) story.current = Object.keys(story.tanks)[0];
  } else {
    const bag = kind === 'part' ? story.parts : story.specials;
    if (!bag[id]) return;
    if (!--bag[id]) delete bag[id];
  }
  story.coins += back;
  toast(`Sold for ${silver(back)}.`);
}

// Rows of [label, current, candidate, higher is better]: the shop's and workshop's comparisons.
export function compareRows(rows) {
  return `<table class="compare"><tr><th></th><th>Now</th><th>This</th></tr>${rows.map(([label, a, b, up = true, fmt = (v) => v]) => {
    const better = up ? b > a : b < a;
    const arrow = a === b ? '' : better ? '<i class="up">▲</i>' : '<i class="down">▼</i>';
    return `<tr><td>${label}</td><td>${fmt(a)}</td><td>${fmt(b)} ${arrow}</td></tr>`;
  }).join('')}</table>`;
}

const pct = (v) => `${Math.round(v * 100)}%`;
export function tankRows(a, b) {
  const alpha = (s) => s.weapon.shells?.AP.damage ?? s.weapon.damage;
  return [
    ['Combat rating', combatRating(a), combatRating(b)],
    ['Armour (hit points)', a.hp, b.hp],
    ['Damage taken, front', a.armor.front, b.armor.front, false, pct],
    ['Damage taken, side', a.armor.side, b.armor.side, false, pct],
    ['Gun damage', alpha(a), alpha(b)],
    ['Reload', a.weapon.reload, b.weapon.reload, false, (v) => `${v.toFixed(1)} s`],
    ['Top speed', a.maxSpeed, b.maxSpeed, true, (v) => `${Math.round(v * 3.6)} km/h`],
  ];
}

function render() {
  $('#shop-coins').textContent = story.coins.toLocaleString('en');
  for (const b of document.querySelectorAll('#screen-shop [data-tab]')) b.classList.toggle('sel', b.dataset.tab === tab);
  const rank = rankInfo().rank;
  const tag = (kind, id) => (isFeatured(kind, id) ? '<em class="deal">−20% today</em>' : '');
  let items = [];
  if (tab === 'tanks') items = Object.keys(STORY_TANKS).filter((id) => STORY_TANKS[id].price).map((id) => {
    const t = tankInfo(id);
    const status = story.tanks[id] ? 'Owned' : t.rank > rank ? `🔒 ${RANKS[t.rank - 1].name}` : silver(priceOf('tank', id));
    return [`tank|${id}`, `<b>Tier ${TIERS[t.tier]} · ${escapeHtml(t.name)}</b><small>${t.class} · inspired by the ${t.inspired}</small><span>${status}</span>${tag('tank', id)}`];
  });
  else if (tab === 'parts') items = SECTIONS.flatMap((s) => [1, 2, 3].map((q) => {
    const id = `${s}:${q}`;
    const have = story.parts[id] ?? 0;
    return [`part|${id}`, `<b><i class="qdot" style="background:${QUALITY[q].color}"></i>${QUALITY[q].name} ${PARTS[s].name.toLowerCase()}</b><small>${PARTS[s].looks[q]}${have ? ` · ${have} in store` : ''}</small><span>${silver(priceOf('part', id))}</span>${tag('part', id)}`];
  }));
  else items = Object.entries(SPECIALS).map(([id, sp]) => [`special|${id}`, `<b>${sp.name}</b><small>${story.specials[id] ?? 0} carried</small><span>${silver(priceOf('special', id))}</span>${tag('special', id)}`]);
  if (!picked) picked = items[0][0];
  $('#shop-list').innerHTML = items.map(([id, html]) => `<button data-item="${id}" class="${id === picked ? 'sel' : ''}">${html}</button>`).join('');
  $('#shop-detail').innerHTML = detail();
}

function detail() {
  const [kind, id] = picked.split('|');
  const price = priceOf(kind, id);
  const was = basePrice(kind, id);
  const cost = `<p class="price">${price < was ? `<s>${silver(was)}</s> ` : ''}<b>${silver(price)}</b> · you have ${silver(story.coins)}</p>`;
  const buyBtn = (ok, why) => `<button class="btn primary" data-act="buy" ${ok && story.coins >= price ? '' : 'disabled'}>${ok ? (story.coins >= price ? 'Buy' : 'Not enough silver') : why}</button>`;
  const sellBtn = (ok) => (ok ? `<button class="btn ghost" data-act="sell">Sell for ${silver(Math.round(was * SELL_BACK))}</button>` : '');
  if (kind === 'tank') {
    const t = tankInfo(id);
    const owned = !!story.tanks[id];
    const locked = t.rank > rankInfo().rank;
    return `<h3>${escapeHtml(t.name)}</h3><p class="sub">Tier ${TIERS[t.tier]} ${t.class} · inspired by the ${t.inspired}</p><p>${escapeHtml(t.blurb)}</p><p class="sub">${t.label}</p>
      ${compareRows(tankRows(buildSpec(story.current), buildSpec(id, fitOf(id))))}
      <p class="sub">"Now" is your ${escapeHtml(tankInfo(story.current).name)} with its parts.</p>
      ${owned ? '<p>You own this tank. Pick it in the Motor Pool.</p>' : cost}
      <div class="row">${owned ? sellBtn(Object.keys(story.tanks).length > 1) : buyBtn(!locked, `Unlocks at ${RANKS[t.rank - 1].name}`)}</div>`;
  }
  if (kind === 'part') {
    const [sec, q] = splitPart(id);
    const part = PARTS[sec];
    const now = fitOf(story.current)[sec];
    const g0 = gainOf(now), g1 = gainOf({ q, lvl: now.lvl });
    return `<h3>${QUALITY[q].name} ${part.name.toLowerCase()}</h3><p class="sub">${part.looks[q]} · +${part.weight * q} t</p>
      ${compareRows(part.stats.map(([label]) => [label, g0, g1, true, (v) => `+${Math.round(v * 100)}%`]))}
      <p class="sub">Against the ${QUALITY[now.q].name.toLowerCase()} part on your ${escapeHtml(tankInfo(story.current).name)} (level ${now.lvl}). Fit it in the Workshop.</p>
      ${cost}<div class="row">${buyBtn(true)}${sellBtn(story.parts[id])}</div>`;
  }
  const sp = SPECIALS[id];
  return `<h3>${sp.name}</h3><p>${sp.blurb}</p><p class="sub">Used up by the next stage you play. You carry ${story.specials[id] ?? 0}.</p>${cost}<div class="row">${buyBtn(true)}${sellBtn(story.specials[id])}</div>`;
}
