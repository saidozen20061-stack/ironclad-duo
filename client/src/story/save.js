import { RANKS, STORY_TANKS, STARTER, PARTS, QUALITY, MAX_LEVEL, SPECIALS, MAX_SPECIALS } from './data.js';

// Story progress lives in this browser's localStorage, saved after every change. A save code
// (the same data, base64) moves it to another computer, since the game has no server.

const KEY = 'ironclad-story';
const VERSION = 2; // 1 had no parts, supplies or featured offer
const MAX_COINS = 10_000_000;
const MAX_XP = 10_000_000;

const fresh = () => ({ v: VERSION, xp: 0, coins: 0, tanks: { [STARTER]: { fit: {} } }, current: STARTER, stars: {}, parts: {}, specials: {}, featured: null });

// Anything read back from storage or pasted in by a player is checked before it's used.
function clean(raw) {
  if (!raw || typeof raw !== 'object' || (raw.v !== VERSION && raw.v !== 1)) throw new Error('Not an Ironclad Duo story save.');
  const num = (v, max, min = 0) => (Number.isFinite(v) ? Math.max(min, Math.min(max, Math.floor(v))) : min);
  const own = (o) => (o && typeof o === 'object' ? Object.entries(o) : []);
  const tanks = {};
  for (const [id, t] of own(raw.tanks)) {
    if (!STORY_TANKS[id]) continue;
    const fit = {};
    for (const [k, p] of own(t?.fit)) if (PARTS[k] && p && typeof p === 'object') fit[k] = { q: num(p.q, QUALITY.length - 1), lvl: num(p.lvl, MAX_LEVEL, 1) };
    tanks[id] = { fit };
  }
  if (!Object.keys(tanks).length) tanks[STARTER] = { fit: {} };
  const parts = {};
  for (const [k, n] of own(raw.parts)) {
    const [sec, q] = k.split(':');
    if (PARTS[sec] && /^[1-3]$/.test(q) && num(n, 99)) parts[k] = num(n, 99);
  }
  const specials = {};
  for (const [k, n] of own(raw.specials)) if (SPECIALS[k] && num(n, MAX_SPECIALS)) specials[k] = num(n, MAX_SPECIALS);
  const f = raw.featured;
  const featured = f && ((f.kind === 'tank' && STORY_TANKS[f.id]) || (f.kind === 'part' && PARTS[String(f.id).split(':')[0]]) || (f.kind === 'special' && SPECIALS[f.id])) ? { kind: f.kind, id: String(f.id) } : null;
  const stars = {};
  for (const [id, n] of Object.entries(raw.stars ?? {})) if (/^[\w-]{1,24}$/.test(id) && n >= 1 && n <= 3) stars[id] = Math.floor(n);
  return { v: VERSION, xp: num(raw.xp, MAX_XP), coins: num(raw.coins, MAX_COINS), tanks, current: tanks[raw.current] ? raw.current : Object.keys(tanks)[0], stars, parts, specials, featured };
}

function load() {
  try {
    const text = localStorage.getItem(KEY);
    return text ? clean(JSON.parse(text)) : fresh();
  } catch {
    return fresh();
  }
}

export const story = load();

export function saveStory() {
  try {
    localStorage.setItem(KEY, JSON.stringify(story));
  } catch {
    // Storage full or blocked: progress lasts until the page closes.
  }
}

const replace = (next) => {
  for (const k of Object.keys(story)) delete story[k];
  Object.assign(story, next);
  saveStory();
};

export const exportCode = () => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(story))));

// Throws with a message for the player when the code is no good; the current save stays as it was.
export function importCode(code) {
  let raw;
  try {
    raw = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(code.replace(/\s+/g, '')), (c) => c.charCodeAt(0))));
  } catch {
    throw new Error("That isn't a save code.");
  }
  replace(clean(raw));
}

export const resetStory = () => replace(fresh());

// Rank (1-based), its name, and how far through it the XP is.
export function rankInfo(xp = story.xp) {
  let i = 0;
  while (i + 1 < RANKS.length && xp >= RANKS[i + 1].xp) i++;
  const next = RANKS[i + 1];
  return { rank: i + 1, name: RANKS[i].name, into: xp - RANKS[i].xp, need: next ? next.xp - RANKS[i].xp : 0 };
}
