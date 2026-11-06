import { RANKS, STORY_TANKS, STARTER } from './data.js';

// Story progress lives in this browser's localStorage, saved after every change. A save code
// (the same data, base64) moves it to another computer, since the game has no server.

const KEY = 'ironclad-story';
const VERSION = 1;
const MAX_COINS = 10_000_000;
const MAX_XP = 10_000_000;

const fresh = () => ({ v: VERSION, xp: 0, coins: 0, tanks: { [STARTER]: {} }, current: STARTER, stars: {} });

// Anything read back from storage or pasted in by a player is checked before it's used.
function clean(raw) {
  if (!raw || typeof raw !== 'object' || raw.v !== VERSION) throw new Error('Not an Ironclad Duo story save.');
  const num = (v, max) => (Number.isFinite(v) ? Math.max(0, Math.min(max, Math.floor(v))) : 0);
  const tanks = {};
  for (const id of Object.keys(raw.tanks ?? {})) if (STORY_TANKS[id]) tanks[id] = {};
  if (!Object.keys(tanks).length) tanks[STARTER] = {};
  const stars = {};
  for (const [id, n] of Object.entries(raw.stars ?? {})) if (/^[\w-]{1,24}$/.test(id) && n >= 1 && n <= 3) stars[id] = Math.floor(n);
  return { v: VERSION, xp: num(raw.xp, MAX_XP), coins: num(raw.coins, MAX_COINS), tanks, current: tanks[raw.current] ? raw.current : Object.keys(tanks)[0], stars };
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
