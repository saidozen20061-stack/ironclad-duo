// Deterministic battlefield props shared by server (collisions, destruction, AI cover)
// and client (meshes). Purely decorative scatter (trees, poles, fences, hay) is
// generated client-side from the same seed and never blocks movement.

import { mulberry32, createNoise2D } from './noise.js';
import { POINTS, BASES, BRIDGES, FORD, riverZ, heightAt, groundAt, waterDepthAt, HALF } from './map.js';

// Rotation convention (matches Three.js rotation.y): local X = width, local Z = depth.
// world = (lx*cos + lz*sin, -lx*sin + lz*cos)

export const PROP_TYPES = {
  house: { solid: true, hp: 900, cover: true },
  ruin: { solid: true, hp: 500, cover: true },
  wall: { solid: true, hp: 280, cover: true },
  church: { solid: true, hp: 4000, cover: true },
  steeple: { solid: true, hp: Infinity, cover: true },
  bunker: { solid: true, hp: Infinity, cover: true },
  obstower: { solid: true, hp: 600 },
  barn: { solid: true, hp: 1600, cover: true },
  silo: { solid: true, hp: Infinity, cover: true },
  fueltank: { solid: true, hp: 160, explodes: true },
  wreck: { solid: true, hp: Infinity, cover: true, burning: true },
  rock: { solid: true, hp: Infinity, cover: true },
  tent: { solid: false, hp: Infinity },
  garage: { solid: true, hp: 2000, cover: true },
  sandbags: { solid: false, hp: Infinity, cover: true },
  trench: { solid: false, hp: Infinity, cover: true },
  wire: { solid: false, hp: Infinity },
  crates: { solid: false, hp: Infinity, cover: true },
  // Village extras
  well: { solid: true, hp: Infinity, cover: true },
  rubble: { solid: false, hp: Infinity, cover: true },
  // Hill fortifications
  dugout: { solid: true, hp: 1200, cover: true },
  mgnest: { solid: false, hp: Infinity, cover: true },
  hedgehog: { solid: true, hp: Infinity },
  radio: { solid: true, hp: 400, cover: true },
  // Farm / industry
  factory: { solid: true, hp: 3500, cover: true },
  chimney: { solid: true, hp: Infinity },
  warehouse: { solid: true, hp: 2500, cover: true },
  watertower: { solid: true, hp: 700 },
  loco: { solid: true, hp: Infinity, cover: true },
  wagon: { solid: true, hp: Infinity, cover: true },
  barrels: { solid: false, hp: 60, cover: true, explodes: true },
  // Countryside
  windmill: { solid: true, hp: 1500, cover: true },
  chapel: { solid: true, hp: 2000, cover: true },
  gasstation: { solid: true, hp: 600, cover: true, explodes: true },
  checkpoint: { solid: false, hp: Infinity, cover: true },
  // Bases
  truck: { solid: true, hp: 300, cover: true },
  radardish: { solid: true, hp: Infinity },
  artillery: { solid: true, hp: Infinity, cover: true },
};

export const ROADS = [
  // Blue base -> west bridge -> village A
  [[0, -620], [-90, -540], [-200, -420], [-262, -200], [BRIDGES[0].x, BRIDGES[0].z - 34], [BRIDGES[0].x, BRIDGES[0].z + 34], [-300, 80], [-200, 260], [-60, 480], [0, 620]],
  // Village A spur
  [[-262, -200], [-330, -185], [-470, -170]],
  // Blue base -> east bridge -> farm C -> red base
  [[0, -620], [120, -520], [250, -350], [BRIDGES[1].x, BRIDGES[1].z - 34], [BRIDGES[1].x, BRIDGES[1].z + 34], [330, 30], [420, 35], [300, 300], [120, 520], [0, 620]],
  // Ford track to Hill 112
  [[-90, -540], [-10, -300], [FORD.x, riverZ(FORD.x) - 30], [FORD.x, riverZ(FORD.x) + 30], [30, 110]],
];

export function distToRoad(x, z) {
  let best = Infinity;
  for (const road of ROADS) {
    for (let i = 0; i < road.length - 1; i++) {
      const [ax, az] = road[i];
      const [bx, bz] = road[i + 1];
      const dx = bx - ax, dz = bz - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
      best = Math.min(best, Math.hypot(x - ax - t * dx, z - az - t * dz));
    }
  }
  return best;
}

const rand = mulberry32(9001);
const rr = (a, b) => a + rand() * (b - a);

export const PROPS = [];
function add(type, x, z, rot, w, d, h, extra = {}) {
  const t = PROP_TYPES[type];
  const p = { id: PROPS.length, type, x, z, rot, w, d, h, y: groundAt(x, z), hp: t.hp, maxHp: t.hp, solid: t.solid, cover: !!t.cover, ...extra };
  PROPS.push(p);
  return p;
}

// ---------- Point A: ruined village ----------
{
  const A = POINTS[0];
  // Main street runs east-west (along X), a side street north-south.
  for (let i = -4; i <= 4; i++) {
    for (const side of [-1, 1]) {
      if (i === 0) continue; // crossroads
      const x = A.x + i * 13 + rr(-1.5, 1.5);
      const z = A.z + side * rr(11, 13);
      const ruined = rand() < 0.45;
      // Houses facing the main street near the square are shops with awnings.
      const shop = !ruined && Math.abs(i) <= 2;
      add(ruined ? 'ruin' : 'house', x, z, side > 0 ? Math.PI + rr(-0.06, 0.06) : rr(-0.06, 0.06), rr(8, 10), rr(7, 9), ruined ? rr(3, 5) : rr(5, 6.5), { variant: Math.floor(rand() * 3), shop });
    }
  }
  for (let j = 2; j <= 4; j++) {
    for (const side of [-1, 1]) {
      add(rand() < 0.5 ? 'ruin' : 'house', A.x + side * 11, A.z + j * 13 * (j % 2 ? 1 : -1), Math.PI / 2 + rr(-0.06, 0.06), rr(8, 10), rr(7, 8), rr(3.5, 6), { variant: Math.floor(rand() * 3) });
    }
  }
  // Church with steeple at the crossroads' north-east corner.
  add('church', A.x - 30, A.z + 36, 0, 10, 18, 9);
  add('steeple', A.x - 30, A.z + 47, 0, 4.5, 4.5, 24);
  // Broken garden walls
  for (let k = 0; k < 10; k++) {
    const ang = rand() * Math.PI * 2;
    const r = rr(30, 60);
    add('wall', A.x + Math.cos(ang) * r, A.z + Math.sin(ang) * r, rr(0, Math.PI), rr(5, 12), 0.6, rr(1.4, 2.4));
  }
}

// ---------- Point B: Hill 112 fortifications ----------
{
  const B = POINTS[1];
  // Trench ring (zig-zag segments) with sandbag parapets.
  const segs = 14;
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2;
    const r = 26 + (i % 2) * 4;
    const x = B.x + Math.cos(a0) * r;
    const z = B.z + Math.sin(a0) * r;
    const rot = -a0 + Math.PI / 2 + ((i % 2) - 0.5) * 0.5;
    add('trench', x, z, rot, 11, 2.2, 0.2);
    add('sandbags', x + Math.cos(a0) * 1.8, z + Math.sin(a0) * 1.8, rot, 10, 0.9, 1.1);
  }
  for (const a of [0.4, 2.2, 4.1]) add('bunker', B.x + Math.cos(a) * 14, B.z + Math.sin(a) * 14, -a, 7, 5, 2.6);
  add('obstower', B.x + 4, B.z - 4, 0.3, 4, 4, 13);
  // Barbed wire belt
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + 0.1;
    add('wire', B.x + Math.cos(a) * 42, B.z + Math.sin(a) * 42, -a + Math.PI / 2, 12, 1, 1);
  }
}

// ---------- Point C: farm / industrial ----------
{
  const C = POINTS[2];
  add('barn', C.x + 22, C.z + 18, 0.1, 14, 22, 9);
  add('barn', C.x - 26, C.z + 22, -0.05, 12, 18, 8);
  add('barn', C.x - 18, C.z - 30, Math.PI / 2, 10, 16, 7);
  add('silo', C.x + 40, C.z - 2, 0, 6, 6, 16);
  add('silo', C.x + 40, C.z + 6, 0, 6, 6, 18);
  add('silo', C.x + 48, C.z + 2, 0, 6, 6, 14);
  // Fuel depot: a row of tanks that explode when shot.
  for (let i = 0; i < 4; i++) add('fueltank', C.x - 12 + i * 7.5, C.z - 46, 0, 4.6, 9, 4.6);
  add('house', C.x + 6, C.z - 10, 0, 9, 8, 6, { variant: 0 });
  for (let k = 0; k < 6; k++) add('wall', C.x + rr(-55, 55), C.z + rr(-55, 55), rr(0, Math.PI), rr(6, 12), 0.6, rr(1.4, 2));
  for (let k = 0; k < 5; k++) add('crates', C.x + rr(-30, 30), C.z + rr(-30, 30), rr(0, 3), 2.4, 2.4, 1.6);
}

// ---------- Bases ----------
for (const [team, b] of Object.entries(BASES)) {
  const s = team === 'blue' ? 1 : -1;
  for (let i = 0; i < 4; i++) add('tent', b.x - 45 + i * 12, b.z - s * 35, 0, 6, 8, 3.5, { team });
  add('garage', b.x + 45, b.z - s * 30, 0, 16, 12, 6, { team });
  add('garage', b.x - 60, b.z + s * 5, Math.PI / 2, 14, 10, 5.5, { team });
  for (let i = 0; i < 6; i++) add('sandbags', b.x - 50 + i * 20, b.z + s * 62, 0, 8, 0.9, 1.1);
  for (let k = 0; k < 4; k++) add('crates', b.x + rr(-30, 30), b.z - s * rr(10, 30), rr(0, 3), 2.4, 2.4, 1.6);
}

// ---------- Placement helpers ----------
const slopeAt = (x, z) => {
  const h = heightAt(x, z);
  return Math.max(Math.abs(heightAt(x + 3, z) - h), Math.abs(heightAt(x, z + 3) - h)) / 3;
};
const nearPoint = (x, z, pad) => POINTS.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + pad);
const nearBase = (x, z, pad) => Object.values(BASES).some((b) => Math.hypot(b.x - x, b.z - z) < pad);

// The railway that runs past the farm (decorative track, the train on it is solid).
export const RAIL = [[700, 128], [520, 112], [380, 118], [250, 160], [150, 238]];
export function distToRail(x, z) {
  let best = Infinity;
  for (let i = 0; i < RAIL.length - 1; i++) {
    const [ax, az] = RAIL[i];
    const [bx, bz] = RAIL[i + 1];
    const dx = bx - ax, dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(x - ax - t * dx, z - az - t * dz));
  }
  return best;
}

function clearSpot(x, z, r, { road = r + 4, slope = 0.25, points = 0, bases = 0 } = {}) {
  if (Math.abs(x) > 655 || Math.abs(z) > 655) return false;
  if (waterDepthAt(x, z) > 0 || Math.abs(z - riverZ(x)) < r + 16) return false;
  if (distToRoad(x, z) < road || distToRail(x, z) < r + 3) return false;
  if (slopeAt(x, z) > slope) return false;
  if (points && nearPoint(x, z, points)) return false;
  if (bases && nearBase(x, z, bases)) return false;
  for (const p of PROPS) if (Math.abs(p.x - x) < 60 && Math.abs(p.z - z) < 60 && Math.hypot(p.x - x, p.z - z) < r + Math.max(p.w, p.d) / 2 + 1.5) return false;
  return true;
}

function findSpot(ax, az, spread, r, opts) {
  for (let i = 0; i < 250; i++) {
    const x = ax + rr(-spread, spread), z = az + rr(-spread, spread);
    if (clearSpot(x, z, r, opts)) return [x, z];
  }
  return null;
}

// Rotation that lines a prop's local Z axis up with the nearest road.
function roadRotAt(x, z) {
  let best = Infinity, rot = 0;
  for (const road of ROADS) {
    for (let i = 0; i < road.length - 1; i++) {
      const [ax, az] = road[i];
      const [bx, bz] = road[i + 1];
      const dx = bx - ax, dz = bz - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
      const d = Math.hypot(x - ax - t * dx, z - az - t * dz);
      if (d < best) {
        best = d;
        rot = Math.atan2(dx, dz);
      }
    }
  }
  return rot;
}

function placeNear(type, ax, az, spread, w, d, h, opts = {}, extra = {}) {
  const spot = findSpot(ax, az, spread, Math.hypot(w, d) / 2, opts);
  if (!spot) return null;
  return add(type, spot[0], spot[1], extra.rot ?? (opts.faceRoad ? roadRotAt(spot[0], spot[1]) : rr(0, Math.PI * 2)), w, d, h, extra);
}

// ---------- Point A extras: town square, rubble, back-row houses ----------
{
  const A = POINTS[0];
  add('well', A.x + 4, A.z + 5, 0, 2.2, 2.2, 1.2);
  for (let k = 0; k < 8; k++) placeNear('rubble', A.x, A.z, 45, rr(3, 5), rr(3, 5), rr(0.8, 1.6), { road: 4, slope: 0.4 });
  for (let k = 0; k < 7; k++) {
    const ruined = rand() < 0.5;
    placeNear(ruined ? 'ruin' : 'house', A.x + rr(-40, 40), A.z + (rand() < 0.5 ? 30 : -30), 12, rr(7, 9), rr(6, 8), ruined ? rr(3, 4.5) : rr(4.5, 6), { road: 7, slope: 0.35 }, { variant: Math.floor(rand() * 3) });
  }
}

// ---------- Point B extras: trench network, nests, tank traps, radio ----------
{
  const B = POINTS[1];
  // Zig-zag communication trenches running down the hill towards each side.
  for (const base of [Math.PI * 1.5, Math.PI * 0.5, Math.PI * 1.1]) {
    let x = B.x + Math.cos(base) * 30, z = B.z + Math.sin(base) * 30;
    for (let s = 0; s < 6; s++) {
      const a = base + (s % 2 ? 0.55 : -0.55);
      const nx = x + Math.cos(a) * 9, nz = z + Math.sin(a) * 9;
      add('trench', (x + nx) / 2, (z + nz) / 2, Math.atan2(nx - x, nz - z) + Math.PI / 2, 9.5, 2, 0.2);
      x = nx;
      z = nz;
    }
  }
  for (const a of [0.9, 2.7, 3.9, 5.6]) add('mgnest', B.x + Math.cos(a) * 33, B.z + Math.sin(a) * 33, -a + Math.PI / 2, 4.2, 4.2, 1.2);
  for (const a of [1.5, 5.0]) add('dugout', B.x + Math.cos(a) * 19, B.z + Math.sin(a) * 19, -a, 6, 4.2, 2.2);
  add('radio', B.x - 12, B.z + 6, 0.4, 3.2, 3.2, 2.6);
  for (let k = 0; k < 4; k++) placeNear('crates', B.x, B.z, 22, 2.4, 2.4, 1.6, { road: 2, slope: 0.6 });
  // Czech hedgehogs: a broken ring of tank traps, with gaps where the tracks come up.
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2;
    const x = B.x + Math.cos(a) * 56, z = B.z + Math.sin(a) * 56;
    if (distToRoad(x, z) < 8 || i % 5 === 0) continue;
    add('hedgehog', x, z, rr(0, 3), 1.8, 1.8, 1.4);
  }
}

// ---------- Point C extras: factory, warehouses, water tower, stopped train ----------
{
  const C = POINTS[2];
  const f = placeNear('factory', C.x - 70, C.z + 30, 18, 26, 16, 10, { road: 8, slope: 0.3 }, { rot: 0.08 });
  if (f) add('chimney', f.x + 16, f.z - 4, 0, 3, 3, 28);
  placeNear('warehouse', C.x + 75, C.z - 20, 20, 12, 22, 7, { road: 7, slope: 0.3 }, { rot: 0.1 });
  placeNear('warehouse', C.x + 10, C.z + 55, 20, 20, 11, 6.5, { road: 7, slope: 0.3 }, { rot: -0.05 });
  placeNear('watertower', C.x - 35, C.z - 10, 15, 5, 5, 17, { road: 5, slope: 0.4 });
  for (let k = 0; k < 5; k++) placeNear('barrels', C.x, C.z, 50, 2.2, 2.2, 1.3, { road: 3, slope: 0.4 });
  // Train stopped on the line: locomotive followed by freight wagons, rotated along the rails.
  const [ax, az] = RAIL[1];
  const [bx, bz] = RAIL[2];
  const len = Math.hypot(bx - ax, bz - az);
  const rot = Math.atan2(bx - ax, bz - az);
  for (let k = 0; k < 5; k++) {
    const t = 0.25 + (k * 10.5) / len;
    add(k === 0 ? 'loco' : 'wagon', ax + (bx - ax) * t, az + (bz - az) * t, rot, 3.1, k === 0 ? 11 : 9.5, k === 0 ? 4.4 : 3.8, { variant: k % 2 });
  }
}

// ---------- Countryside between the points ----------
{
  const farms = [[-540, -390], [330, -470], [-560, 250], [520, 330], [-200, 430], [230, -190], [-470, 40], [560, -230]];
  for (const [fx, fz] of farms) {
    const h = placeNear('house', fx, fz, 60, rr(8, 10), rr(7, 8), rr(5, 6), { slope: 0.25, points: 20, bases: 110 }, { variant: Math.floor(rand() * 3), farm: true });
    if (h) placeNear('barn', h.x, h.z, 22, rr(8, 10), rr(12, 15), rr(6, 7.5), { slope: 0.3 });
  }
  placeNear('windmill', -380, 395, 70, 6, 6, 15, { slope: 0.35, points: 20 });
  placeNear('chapel', 140, -360, 50, 7, 11, 7, { slope: 0.25, points: 20 });
  placeNear('chapel', -120, 300, 60, 7, 11, 7, { slope: 0.25, points: 20 });
  placeNear('gasstation', -150, -470, 25, 12, 8, 5, { road: 10, slope: 0.2, faceRoad: true });
  placeNear('checkpoint', 220, -395, 20, 9, 4, 2.4, { road: 4, slope: 0.3, faceRoad: true });
  placeNear('checkpoint', -230, 330, 25, 9, 4, 2.4, { road: 4, slope: 0.3, faceRoad: true });
}

// ---------- Bases: trucks, radar, artillery, sandbag perimeter ----------
for (const [team, b] of Object.entries(BASES)) {
  const s = team === 'blue' ? 1 : -1;
  for (let i = 0; i < 2; i++) add('tent', b.x + 15 + i * 12, b.z - s * 35, 0, 6, 8, 3.5, { team });
  for (let i = 0; i < 3; i++) add('truck', b.x + 30 + i * 6, b.z - s * 8, s > 0 ? 0 : Math.PI, 2.6, 6.6, 3, { team });
  add('radardish', b.x - 30, b.z - s * 45, 0, 5, 5, 8, { team });
  for (let i = 0; i < 3; i++) add('artillery', b.x - 40 + i * 16, b.z - s * 52, s > 0 ? 0 : Math.PI, 2.8, 6, 2.2, { team });
  for (let i = 0; i < 6; i++) {
    for (const side of [-1, 1]) add('sandbags', b.x + side * 72, b.z - 50 + i * 20, Math.PI / 2, 8, 0.9, 1.1);
  }
}

// ---------- Scattered battlefield: wrecks, rocks, craters, sandbag positions ----------
export const CRATERS = [];
{
  const nearSomething = (x, z, r) => PROPS.some((p) => Math.hypot(p.x - x, p.z - z) < r + Math.max(p.w, p.d) / 2);
  const bad = (x, z) =>
    Math.abs(x) > 640 || Math.abs(z) > 640 || waterDepthAt(x, z) > 0 || Math.abs(z - riverZ(x)) < 30 ||
    POINTS.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + 10) || Object.values(BASES).some((b) => Math.hypot(b.x - x, b.z - z) < 90);
  let n = 0;
  // Wreck variants: 0 = tank, 1 = truck, 2 = jeep. Some still burn.
  const WRECK_SIZE = [[3.2, 6.2, 2.2], [2.6, 6.6, 2.6], [1.9, 3.8, 1.5]];
  for (let tries = 0; n < 30 && tries < 900; tries++) {
    const x = rr(-600, 600), z = rr(-560, 560);
    if (bad(x, z) || distToRoad(x, z) < 6 || nearSomething(x, z, 8)) continue;
    const variant = Math.floor(rand() * 3);
    const [w, d, h] = WRECK_SIZE[variant];
    add('wreck', x, z, rr(0, Math.PI * 2), w, d, h, { variant, burning: rand() < 0.45 });
    n++;
  }
  n = 0;
  for (let tries = 0; n < 40 && tries < 800; tries++) {
    const x = rr(-650, 650), z = rr(-650, 650);
    if (bad(x, z) || distToRoad(x, z) < 6 || nearSomething(x, z, 4)) continue;
    const s = rr(1.5, 4);
    add('rock', x, z, rr(0, 6), s * 1.4, s, s * 0.9);
    n++;
  }
  n = 0;
  for (let tries = 0; n < 24 && tries < 600; tries++) {
    const x = rr(-600, 600), z = rr(-560, 560);
    if (bad(x, z) || distToRoad(x, z) < 5 || nearSomething(x, z, 6)) continue;
    add('sandbags', x, z, rr(0, Math.PI), rr(5, 9), 0.9, 1.1);
    n++;
  }
  for (let k = 0; k < 320; k++) {
    const x = rr(-640, 640), z = rr(-620, 620);
    if (waterDepthAt(x, z) > 0) continue;
    // Craters cluster around the contested middle of the map.
    if (Math.abs(z) > 450 && rand() < 0.7) continue;
    if (nearBase(x, z, 80)) continue;
    const r = rand() < 0.15 ? rr(5, 8) : rr(1.5, 4.5);
    // Bigger shell holes in low ground fill with rain water.
    CRATERS.push({ x, z, r, water: r > 3.5 && rand() < 0.35 });
  }
}

// ---------- Fields (crop rows + hedgerows are drawn by the client) ----------
export const FIELDS = [];
{
  const crops = ['wheat', 'plowed', 'green', 'wheat', 'stubble'];
  for (let tries = 0; FIELDS.length < 18 && tries < 2500; tries++) {
    const cx = rr(-620, 620), cz = rr(-620, 620);
    const w = rr(50, 100), d = rr(40, 80), rot = rr(-0.5, 0.5);
    const c = Math.cos(rot), s = Math.sin(rot);
    let ok = true;
    for (let i = -1; i <= 1 && ok; i++) {
      for (let j = -1; j <= 1 && ok; j++) {
        const lx = (i * w) / 2, lz = (j * d) / 2;
        const x = cx + lx * c + lz * s, z = cz - lx * s + lz * c;
        ok = clearSpot(x, z, 4, { road: 5, slope: 0.18, points: 30, bases: 120 });
      }
    }
    if (!ok || FIELDS.some((f) => Math.hypot(f.x - cx, f.z - cz) < (f.w + w) / 2 + 12)) continue;
    FIELDS.push({ x: cx, z: cz, w, d, rot, crop: crops[Math.floor(rand() * crops.length)] });
  }
}

export function fieldAt(x, z) {
  for (const f of FIELDS) {
    const dx = x - f.x, dz = z - f.z;
    if (Math.abs(dx) > f.w + 5 && Math.abs(dz) > f.w + 5) continue;
    const c = Math.cos(f.rot), s = Math.sin(f.rot);
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    if (Math.abs(lx) < f.w / 2 && Math.abs(lz) < f.d / 2) return { f, lx, lz };
  }
  return null;
}

// ---------- Spatial grid for fast lookups ----------
const CELL = 50;
const grid = new Map();
const key = (i, j) => i * 1000 + j;
for (const p of PROPS) {
  const r = Math.hypot(p.w, p.d) / 2;
  const i0 = Math.floor((p.x - r + HALF) / CELL), i1 = Math.floor((p.x + r + HALF) / CELL);
  const j0 = Math.floor((p.z - r + HALF) / CELL), j1 = Math.floor((p.z + r + HALF) / CELL);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
    const k = key(i, j);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(p);
  }
}

export function propsNear(x, z, r = 0) {
  const out = new Set();
  const i0 = Math.floor((x - r + HALF) / CELL), i1 = Math.floor((x + r + HALF) / CELL);
  const j0 = Math.floor((z - r + HALF) / CELL), j1 = Math.floor((z + r + HALF) / CELL);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) for (const p of grid.get(key(i, j)) ?? []) out.add(p);
  return out;
}

export function toLocal(p, x, z) {
  const dx = x - p.x, dz = z - p.z;
  const c = Math.cos(p.rot), s = Math.sin(p.rot);
  return [dx * c - dz * s, dx * s + dz * c];
}

// Circle (tank footprint) vs prop footprint.
export function circleHitsProp(p, x, z, r) {
  if (p.type === 'silo') return Math.hypot(x - p.x, z - p.z) < p.w / 2 + r;
  const [lx, lz] = toLocal(p, x, z);
  const cx = Math.max(-p.w / 2, Math.min(p.w / 2, lx));
  const cz = Math.max(-p.d / 2, Math.min(p.d / 2, lz));
  return Math.hypot(lx - cx, lz - cz) < r;
}

// Segment vs prop box (3D). Returns parametric t or null.
export function segmentHitsProp(p, x0, y0, z0, dx, dy, dz) {
  const [ox, oz] = toLocal(p, x0, z0);
  const c = Math.cos(p.rot), s = Math.sin(p.rot);
  const ldx = dx * c - dz * s, ldz = dx * s + dz * c;
  const o = [ox, y0 - p.y, oz];
  const d = [ldx, dy, ldz];
  const min = [-p.w / 2, -0.5, -p.d / 2];
  const max = [p.w / 2, p.h, p.d / 2];
  let tmin = 0, tmax = 1;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) {
      if (o[a] < min[a] || o[a] > max[a]) return null;
      continue;
    }
    let t1 = (min[a] - o[a]) / d[a];
    let t2 = (max[a] - o[a]) / d[a];
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin;
}

// Points along roads for poles/fences (client decoration).
export function roadSamples(step) {
  const out = [];
  for (const road of ROADS) {
    for (let i = 0; i < road.length - 1; i++) {
      const [ax, az] = road[i];
      const [bx, bz] = road[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      for (let d = 0; d < len; d += step) out.push({ x: ax + ((bx - ax) * d) / len, z: az + ((bz - az) * d) / len, dirX: (bx - ax) / len, dirZ: (bz - az) / len });
    }
  }
  return out;
}

export const TREE_NOISE = createNoise2D(4242);
export function treeAllowed(x, z) {
  if (Math.abs(x) > 700 || Math.abs(z) > 700) return false;
  if (waterDepthAt(x, z) > 0 || Math.abs(z - riverZ(x)) < 24) return false;
  if (distToRoad(x, z) < 9 || distToRail(x, z) < 8) return false;
  if (POINTS.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + 25)) return false;
  if (Object.values(BASES).some((b) => Math.hypot(b.x - x, b.z - z) < 110)) return false;
  if (fieldAt(x, z)) return false;
  for (const p of propsNear(x, z, 4)) if (Math.hypot(p.x - x, p.z - z) < Math.max(p.w, p.d) / 2 + 3) return false;
  const h = heightAt(x, z);
  return h < 70;
}
