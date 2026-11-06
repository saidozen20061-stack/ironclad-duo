import { $, showScreen, toast, escapeHtml } from '../ui/screens.js';
import { story, saveStory } from './save.js';
import { PARTS, SECTIONS, QUALITY, MAX_LEVEL, TIERS, upgradePrice, STORY_TANKS } from './data.js';
import { tankInfo, buildSpec, combatRating, fitOf, gainOf, weightOf, stageRating } from './tanks.js';
import { compareRows, priceOf, openShop } from './shop.js';
import { nextStage } from './map.js';

// The workshop: the crew's tank on the turntable with a hotspot on each part. Clicking one swings the
// camera in on it; the side panel shows what's fitted, what's in store and what the shop has, with
// EQUIP, UPGRADE and BUY.

let scene = null;
let hooks = null;
let section = null;
let raf = 0;

export function initWorkshop(menuScene, h) {
  scene = menuScene;
  hooks = h;
  $('#btn-workshop-back').addEventListener('click', () => {
    close();
    showScreen('story', { remember: false });
    hooks.renderHub();
  });
  $('#screen-workshop').addEventListener('click', (e) => {
    const spot = e.target.closest('[data-spot]');
    if (spot) return pick(spot.dataset.spot === section ? null : spot.dataset.spot);
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const fit = story.tanks[story.current].fit;
    const now = fitOf(story.current)[section];
    if (b.dataset.act === 'equip') {
      const q = Number(b.dataset.q);
      if (q && !story.parts[`${section}:${q}`]) return;
      if (q && !--story.parts[`${section}:${q}`]) delete story.parts[`${section}:${q}`];
      if (now.q) story.parts[`${section}:${now.q}`] = (story.parts[`${section}:${now.q}`] ?? 0) + 1;
      fit[section] = { q, lvl: now.lvl };
    } else if (b.dataset.act === 'upgrade') {
      const price = upgradePrice(section, now.lvl);
      if (now.lvl >= MAX_LEVEL || story.coins < price) return toast('Not enough silver.');
      story.coins -= price;
      fit[section] = { q: now.q, lvl: now.lvl + 1 };
    } else if (b.dataset.act === 'shop') return close(), openShop(['parts', `part|${section}:${b.dataset.q}`]);
    saveStory();
    render();
  });
}

export function openWorkshop() {
  showScreen('workshop', { remember: false });
  section = null;
  render();
  cancelAnimationFrame(raf);
  const loop = () => {
    placeSpots();
    raf = requestAnimationFrame(loop);
  };
  loop();
}

function close() {
  cancelAnimationFrame(raf);
  scene.preview.focus = null;
}

function pick(s) {
  section = s;
  const at = s && PARTS[s].at;
  scene.preview.focus = at ? { x: at[0], y: at[1], z: at[2] } : null;
  render();
}

// Hotspots follow their part as the tank turns; ones round the back fade out.
function placeSpots() {
  for (const el of document.querySelectorAll('#workshop-spots [data-spot]')) {
    const [x, y, z] = PARTS[el.dataset.spot].at;
    const p = scene.preview.screenPoint({ x, y, z });
    if (!p) continue;
    el.style.transform = `translate(${p.x}px, ${p.y}px)`;
    el.classList.toggle('behind', !p.facing && el.dataset.spot !== section);
  }
}

export function render() {
  const id = story.current;
  const fit = fitOf(id);
  hooks.showTank();
  $('#workshop-spots').innerHTML = SECTIONS.map((s) => `<button data-spot="${s}" class="${s === section ? 'sel' : ''}" style="--c:${QUALITY[fit[s].q].color}"><i></i><span>${PARTS[s].name}</span></button>`).join('');
  const spec = buildSpec(id, fit);
  const cr = combatRating(spec);
  const next = nextStage();
  const need = next ? stageRating(next) : null;
  const { used, limit } = weightOf(id, fit);
  $('#workshop-head').innerHTML = `
    <div><b>${escapeHtml(tankInfo(id).name)}</b><small>Tier ${TIERS[STORY_TANKS[id].tier]} ${tankInfo(id).class}</small></div>
    <div><small>COMBAT RATING</small><b class="${need && cr < need ? 'low' : ''}">${cr}</b><small>${need ? `${escapeHtml(next.name)} wants ${need}` : ''}</small></div>
    <div class="weight"><small>WEIGHT ${used} / ${limit} t${used > limit ? ' · overloaded, slower' : ''}</small><div class="bar"><i class="${used > limit ? 'over' : ''}" style="width:${Math.min(100, (used / limit) * 100)}%"></i></div></div>
    <div class="story-coins"><i class="coin"></i><b>${story.coins.toLocaleString('en')}</b></div>`;
  $('#workshop-side').innerHTML = section ? sidePanel(id, fit, spec) : `<h3>Workshop</h3><p>Click a part on the tank to look at it, fit a better one or upgrade it.</p>${SECTIONS.map((s) => `<p class="part-line"><i class="qdot" style="background:${QUALITY[fit[s].q].color}"></i>${PARTS[s].name}: ${QUALITY[fit[s].q].name}, level ${fit[s].lvl}</p>`).join('')}`;
}

function sidePanel(id, fit, spec) {
  const part = PARTS[section];
  const now = fit[section];
  const g = gainOf(now);
  const row = (label, cmp, btn) => `<div class="part-card"><div><b>${label}</b>${cmp}</div>${btn}</div>`;
  const cmpTo = (q) => compareRows(part.stats.map(([label]) => [label, g, gainOf({ q, lvl: now.lvl }), true, (v) => `+${Math.round(v * 100)}%`]));
  const store = [0, 1, 2, 3].filter((q) => q !== now.q && (q === 0 || story.parts[`${section}:${q}`]));
  const shop = [1, 2, 3].filter((q) => q !== now.q && !story.parts[`${section}:${q}`]);
  const upPrice = upgradePrice(section, now.lvl);
  return `<h3>${part.name}</h3>
    <div class="part-card fitted"><div><b><i class="qdot" style="background:${QUALITY[now.q].color}"></i>${QUALITY[now.q].name} · level ${now.lvl} of ${MAX_LEVEL}</b><small>${part.looks[now.q]}</small>
      <ul>${part.stats.map(([label]) => `<li>${label} <b>+${Math.round(g * 100)}%</b></li>`).join('')}</ul></div>
      ${now.lvl < MAX_LEVEL ? `<button class="btn small" data-act="upgrade" ${story.coins >= upPrice ? '' : 'disabled'}>Upgrade to ${now.lvl + 1} · ${upPrice.toLocaleString('en')}</button>` : '<small>Fully upgraded</small>'}</div>
    ${store.length ? `<h4>In store</h4>${store.map((q) => row(`${QUALITY[q].name}${q ? ` ×${story.parts[`${section}:${q}`]}` : ''}`, cmpTo(q), `<button class="btn small primary" data-act="equip" data-q="${q}">Equip</button>`)).join('')}` : ''}
    ${shop.length ? `<h4>In the shop</h4>${shop.map((q) => row(`${QUALITY[q].name} · ${priceOf('part', `${section}:${q}`).toLocaleString('en')}`, cmpTo(q), `<button class="btn small" data-act="shop" data-q="${q}">Buy</button>`)).join('')}` : ''}
    <p class="sub">Upgrade levels stay with the tank's ${part.name.toLowerCase()} when you swap parts. ${['optics', 'radio'].includes(section) ? 'This section counts towards the combat rating only.' : ''}</p>
    <p class="sub">Now: ${summary(spec)}</p>`;
}

const summary = (s) => `${s.hp} HP · ${s.weapon.shells?.AP.damage ?? s.weapon.damage} damage · ${s.weapon.reload.toFixed(1)} s reload · ${Math.round(s.maxSpeed * 3.6)} km/h`;
