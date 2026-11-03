// Deterministic battlefield props shared by server (collisions, destruction, AI cover)
// and client (meshes). Purely decorative scatter (trees, poles, fences, hay) is
// generated client-side from the same seed and never blocks movement.

import { mulberry32, createNoise2D } from './noise.js';
import { POINTS, BASES, BRIDGES, FORD, AIRFIELDS, inAirfield, riverZ, heightAt, groundAt, waterDepthAt, HALF } from './map.js';

// Rotation convention (matches Three.js rotation.y): local X = width, local Z = depth.
// world = (lx*cos + lz*sin, -lx*sin + lz*cos)

// How far a roof rises above a prop's walls: shells have to stop at the roof, not fly through it.
const ROOF = { house: 1.6, church: 3, chapel: 3, ruin: 0.8, bunker: 0.6, fbunker: 0.6, dugout: 0.6, command: 1.2 };

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
  // Airfields
  runway: { solid: false, hp: Infinity },
  hangar: { solid: true, hp: Infinity, cover: true },
  ctower: { solid: true, hp: Infinity, cover: true },
  windsock: { solid: false, hp: Infinity },
  aagun: { solid: true, hp: Infinity, cover: true },
  aaturret: { solid: true, hp: Infinity, cover: true },
  helipad: { solid: false, hp: Infinity },
  // Fortress Defence (only placed in that mode, see setFortress)
  fwall: { solid: true, hp: 2200, cover: true },
  fgate: { solid: true, hp: 1400, cover: true, navOpen: true },
  ftower: { solid: true, hp: 3000, cover: true },
  fbunker: { solid: true, hp: 2500, cover: true },
  hulldown: { solid: true, hp: Infinity, cover: true },
  depot: { solid: false, hp: Infinity, cover: true },
  command: { solid: true, hp: 6000, cover: true },
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
  const p = { id: PROPS.length, type, x, z, rot, w, d, h, y: groundAt(x, z), top: h + (ROOF[type] ?? 0), hp: t.hp, maxHp: t.hp, solid: t.solid, cover: !!t.cover, ...extra };
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
  for (let i = 0; i < 4; i++) add('fueltank', C.x - 14 + i * 7.5, C.z + 66, 0, 4.6, 9, 4.6);
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

// ---------- Airfields ----------
for (const f of Object.values(AIRFIELDS)) {
  const { team, x, z, len, width } = f;
  // Buildings stand on the side away from the map edge.
  const s = team === 'blue' ? 1 : -1;
  add('runway', x, z, 0, len, width, 0.1, { team });
  // Small planes at the start of the runway, where they get the longest run.
  add('hangar', x - 125, z + s * (width / 2 + 24), s > 0 ? Math.PI : 0, 54, 24, 11, { team });
  add('hangar', x - 69, z + s * (width / 2 + 24), s > 0 ? Math.PI : 0, 54, 24, 11, { team });
  add('ctower', x - 28, z + s * (width / 2 + 20), s > 0 ? Math.PI : 0, 8, 8, 13, { team });
  // The Leviathan's own, big enough for it to roll in and out under its tail; it needs little runway.
  add('hangar', x + 40, z + s * (width / 2 + 52), s > 0 ? Math.PI : 0, 96, 84, 46, { team, big: true });
  add('windsock', x + 100, z + s * (width / 2 + 12), 0, 1, 1, 6, { team });
  add('truck', x + 112, z + s * (width / 2 + 18), 0.4, 2.4, 6.5, 2.6, { team });
  add('truck', x + 128, z + s * (width / 2 + 16), -0.3, 2.4, 6.5, 2.6, { team });
  add('fueltank', x + 150, z + s * (width / 2 + 24), Math.PI / 2, 4.6, 9, 4.6);
  for (const [dx, dz] of [[-len / 2 - 8, width / 2 + 14], [len / 2 + 6, width / 2 + 14], [130, -width / 2 - 14]]) add('aagun', x + dx, z + s * dz, 0, 4, 4, 2.6, { team });
  // Two pads for helicopters, past the small hangars.
  for (const k of [0, 1]) add('helipad', x - 174, z + s * (width / 2 + 26 + k * 28), 0, 20, 20, 0.1, { team });
}

// The heavy anti-air turrets guarding each side's half of the map (see AA_TURRETS).
for (const team of ['blue', 'red']) {
  const s = team === 'blue' ? -1 : 1;
  for (const [x, z] of [[-150, 560], [150, 560], [560, 470], [-150, 310], [150, 300]]) {
    // Red's half is blue's turned round, so each side's runway and base stay clear.
    const q = team === 'blue' ? 1 : -1;
    add('aaturret', q * x, s * z, 0, 7, 7, 3.4, { team });
  }
}

// Flak around the bases and capture points (point guns belong to whoever holds the point).
for (const [team, b] of Object.entries(BASES)) {
  const s = team === 'blue' ? 1 : -1;
  for (const dx of [-85, 85]) add('aagun', b.x + dx, b.z + s * 22, 0, 4, 4, 2.6, { team });
}
for (const pt of POINTS) {
  const a = (pt.x + pt.z) * 0.01;
  for (const k of [0, 1]) {
    let ang = a + k * 2.4;
    // Not in the river or on its bank.
    const wet = (t) => Math.abs(pt.z + Math.sin(t) * (pt.r + 16) - riverZ(pt.x + Math.cos(t) * (pt.r + 16))) < 30;
    for (let n = 0; n < 15 && wet(ang); n++) ang += 0.4;
    add('aagun', pt.x + Math.cos(ang) * (pt.r + 16), pt.z + Math.sin(ang) * (pt.r + 16), 0, 4, 4, 2.6, { point: pt.id });
  }
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
  if (inAirfield(x, z, r)) return false;
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
  // A hole on a steep bank looks wrong, and a pool can only lie on level ground.
  for (let i = CRATERS.length - 1; i >= 0; i--) {
    const c = CRATERS[i];
    let lo = Infinity, hi = -Infinity;
    for (let a = 0; a < 8; a++) {
      const g = groundAt(c.x + Math.cos((a * Math.PI) / 4) * c.r, c.z + Math.sin((a * Math.PI) / 4) * c.r);
      lo = Math.min(lo, g);
      hi = Math.max(hi, g);
    }
    if ((hi - lo) / (2 * c.r) > 0.35) CRATERS.splice(i, 1);
    else if (hi - lo > 0.6) c.water = false;
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
function gridCells(p, fn) {
  const r = Math.hypot(p.w, p.d) / 2;
  const i0 = Math.floor((p.x - r + HALF) / CELL), i1 = Math.floor((p.x + r + HALF) / CELL);
  const j0 = Math.floor((p.z - r + HALF) / CELL), j1 = Math.floor((p.z + r + HALF) / CELL);
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) fn(key(i, j));
}
function gridInsert(p) {
  gridCells(p, (k) => {
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(p);
  });
}
for (const p of PROPS) gridInsert(p);

// ---------- Fortress Defence: the fortified Blue base ----------
// Added to PROPS only for that mode (same order on host and clients, so ids match) and
// removed again afterwards. North faces the enemy; the south side is the map edge.
export const FORT = {
  center: { x: 0, z: -600 },
  north: -550,
  half: 110,
  depot: { x: -62, z: -576, w: 18, d: 14 },
  command: null, // the command bunker prop while the fortress exists
  // Spots for defending NPC infantry inside the walls.
  spots: [],
};
let fortProps = null;

function buildFortress() {
  const start = PROPS.length;
  const { north: N, half: H } = FORT;
  const wall = (x, z, rot) => add('fwall', x, z, rot, 10, 2.6, 2.6, { fort: true });
  // North wall with a central gate flanked by towers.
  for (const sx of [-1, 1]) for (let x = 22; x <= 102; x += 10) wall(sx * x, N, 0);
  add('fgate', 0, N, 0, 14, 1.8, 2.8, { fort: true });
  for (const x of [-14, 14, -H, H]) add('ftower', x, N, 0, 6, 6, 8.5, { fort: true });
  // East and west walls with side gates.
  for (const sx of [-1, 1]) {
    for (let z = N - 8; z >= -588; z -= 10) wall(sx * H, z, Math.PI / 2);
    add('fgate', sx * H, -600, Math.PI / 2, 14, 1.8, 2.8, { fort: true });
    for (let z = -612; z >= -682; z -= 10) wall(sx * H, z, Math.PI / 2);
    for (const z of [-592, -608]) add('ftower', sx * H, z, 0, 5, 5, 7, { fort: true });
  }
  // Bunkers behind the north wall, command bunker at the heart, repair/ammo depot.
  for (const x of [-60, 60]) add('fbunker', x, N - 15, 0, 8, 5, 2.8, { fort: true });
  for (const sx of [-1, 1]) add('fbunker', sx * (H - 14), -640, Math.PI / 2, 8, 5, 2.8, { fort: true });
  FORT.command = add('command', 0, -626, 0, 14, 10, 4.2, { fort: true });
  const d = FORT.depot;
  add('depot', d.x, d.z, 0, d.w, d.d, 5, { fort: true });
  // Outside the north wall: hull-down berms, a trench line and wire.
  for (const x of [-80, -40, 40, 80]) add('hulldown', x, N + 13, 0, 8, 2.2, 1.3, { fort: true });
  for (const sx of [-1, 1]) for (let x = 20; x <= 100; x += 20) add('trench', sx * x, N + 30, 0, 18, 2, 0.5, { fort: true });
  for (const sx of [-1, 1]) for (let x = 25; x <= 105; x += 20) add('wire', sx * x, N + 45, 0, 18, 1, 1.2, { fort: true });
  FORT.spots = [];
  for (let x = -95; x <= 95; x += 12) if (Math.abs(x) > 12) FORT.spots.push({ x, z: N - 5 });
  for (const sx of [-1, 1]) for (let z = -515; z >= -680; z -= 14) if (Math.abs(z + 600) > 10) FORT.spots.push({ x: sx * (H - 5), z });
  for (const x of [-60, 60]) FORT.spots.push({ x, z: N - 21 });
  // The fortress has its own flak (no team set: fortress guns fire for Blue).
  for (const [x, z] of [[-45, N - 26], [45, N - 26], [-85, -650], [85, -650]]) add('aagun', x, z, 0, 4, 4, 2.6, { fort: true });
  return PROPS.slice(start);
}

// Turn the fortress on or off (host: before building the nav grid; clients: before the world).
export function setFortress(on) {
  if (!!on === !!fortProps) return;
  if (on) {
    fortProps = buildFortress();
    for (const p of fortProps) gridInsert(p);
  } else {
    for (const p of fortProps) gridCells(p, (k) => grid.set(k, (grid.get(k) ?? []).filter((q) => q !== p)));
    PROPS.length -= fortProps.length;
    fortProps = null;
    FORT.command = null;
  }
}

export const fortressOn = () => !!fortProps;
export const inDepot = (x, z) => Math.abs(x - FORT.depot.x) < FORT.depot.w / 2 + 2 && Math.abs(z - FORT.depot.z) < FORT.depot.d / 2 + 2;

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
  const max = [p.w / 2, p.top ?? p.h, p.d / 2];
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
  if (inAirfield(x, z)) return false;
  if (waterDepthAt(x, z) > 0 || Math.abs(z - riverZ(x)) < 24) return false;
  if (distToRoad(x, z) < 9 || distToRail(x, z) < 8) return false;
  if (POINTS.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + 25)) return false;
  if (Object.values(BASES).some((b) => Math.hypot(b.x - x, b.z - z) < 110)) return false;
  if (fieldAt(x, z)) return false;
  for (const p of propsNear(x, z, 4)) if (Math.hypot(p.x - x, p.z - z) < Math.max(p.w, p.d) / 2 + 3) return false;
  const h = heightAt(x, z);
  return h < 70;
}
