// Battlefield layout and heightmap. Deterministic: server physics and client rendering
// build the exact same grid, and heightAt() matches the rendered triangles exactly.
//
// Axes: +Z = north (towards the red base), +X = west, +Y = up. (+X appears on the left
// when facing north, which is the natural consequence of a right-handed Y-up world.)

import { createNoise2D, fbm } from './noise.js';

export const MAP_SIZE = 1500;
export const HALF = MAP_SIZE / 2;
export const GRID = 300; // cells per side
export const CELL = MAP_SIZE / GRID; // 5 m
export const PLAY_LIMIT = 690; // tanks can't leave this square
export const WATER_LEVEL = 4;
export const SEED = 20261030;

export const BASES = {
  blue: { x: 0, z: -640, heading: 0 },
  red: { x: 0, z: 640, heading: Math.PI },
};

// One airfield per team, beside its base. Runway along X, planes start at startX.
export const AIRFIELDS = {
  blue: { team: 'blue', x: -345, z: -660, len: 400, width: 34, startX: -525, dir: 1, heading: Math.PI / 2 },
  red: { team: 'red', x: 345, z: 660, len: 400, width: 34, startX: 525, dir: -1, heading: -Math.PI / 2 },
};
export const onRunway = (x, z) => Object.values(AIRFIELDS).some((f) => Math.abs(x - f.x) < f.len / 2 + 4 && Math.abs(z - f.z) < f.width / 2 + 4);
// The whole field, with room for the apron and buildings beside the runway.
export const inAirfield = (x, z, pad = 0) => Object.values(AIRFIELDS).some((f) => Math.abs(x - f.x) < f.len / 2 + 25 + pad && Math.abs(z - f.z) < f.width / 2 + 55 + pad);

export const POINTS = [
  { id: 'A', name: 'Ruined Village', x: -400, z: -175, r: 42 },
  { id: 'B', name: 'Hill 112', x: 20, z: 165, r: 38 },
  { id: 'C', name: 'Kolkhoz Farm', x: 420, z: 35, r: 45 },
];

export function riverZ(x) {
  return -40 + 30 * Math.sin(x / 160 + 0.5) + 8 * Math.sin(x / 55);
}
export const RIVER_HALF_WIDTH = 13;

export const FORD = { x: 45, half: 22 };
export const BRIDGE_DECK = WATER_LEVEL + 4.5;
export const BRIDGES = [-265, 285].map((x) => ({
  x,
  z: riverZ(x),
  halfWidth: 4.2, // deck half-width (across the direction of travel)
  halfLength: 30, // along the road, spans the river
}));

// Areas flattened for buildings / bases.
const FLATS = [
  { x: BASES.blue.x, z: BASES.blue.z, r: 70, blend: 60 },
  { x: BASES.red.x, z: BASES.red.z, r: 70, blend: 60 },
  { x: POINTS[0].x, z: POINTS[0].z, r: 70, blend: 50 },
  { x: POINTS[2].x, z: POINTS[2].z, r: 80, blend: 50 },
  { x: POINTS[1].x, z: POINTS[1].z, r: 28, blend: 30 }, // hilltop plateau
];

const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
export const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

function distToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const t = clamp01(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

const n1 = createNoise2D(SEED);
const n2 = createNoise2D(SEED + 1);
const n3 = createNoise2D(SEED + 2);

function baseHeight(x, z) {
  let h = 14 + fbm(n1, x / 420, z / 420, 4) * 16 + fbm(n2, x / 110, z / 110, 3) * 3;
  // North-west ridge
  const dr = distToSegment(x, z, -680, 300, -170, 470);
  h += 26 * Math.exp(-(dr * dr) / (2 * 65 * 65)) * (0.85 + 0.15 * n3(x / 60, z / 60));
  // Southern valley between the blue base and the river
  const dv = distToSegment(x, z, 120, -520, 560, -300);
  h -= 7 * Math.exp(-(dv * dv) / (2 * 60 * 60));
  // Hill 112
  const B = POINTS[1];
  const db = Math.hypot(x - B.x, z - B.z);
  h += 17 * Math.exp(-(db * db) / (2 * 80 * 80));
  return h;
}

function computeHeight(x, z) {
  let h = baseHeight(x, z);
  for (const f of FLATS) {
    const d = Math.hypot(x - f.x, z - f.z);
    if (d < f.r + f.blend) h = lerp(f.h, h, smoothstep(f.r, f.r + f.blend, d));
  }
  // Mountains ring the map edge.
  const e = Math.max(0, Math.max(Math.abs(x), Math.abs(z)) - 650);
  h += e * e * 0.006 + e * 0.2;
  h = Math.max(h, WATER_LEVEL + 1.6);

  // Airfields are levelled, including where the edge mountains would start to rise.
  for (const f of Object.values(AIRFIELDS)) {
    const dx = Math.max(0, Math.abs(x - f.x) - (f.len / 2 + 30));
    const dz = Math.max(0, Math.abs(z - f.z) - (f.width / 2 + 60));
    const d = Math.hypot(dx, dz);
    if (d < 45) h = lerp(f.h, h, smoothstep(0, 45, d));
  }

  // Bridge approaches: ramp the banks to deck height so the road meets the bridge.
  for (const b of BRIDGES) {
    const dx = Math.abs(x - b.x);
    const dz = Math.abs(z - b.z);
    if (dx < 16 && dz < 90) {
      const tw = 1 - smoothstep(6, 16, dx);
      const tl = 1 - smoothstep(30, 90, dz);
      h = lerp(h, BRIDGE_DECK - 0.05, tw * tl);
    }
  }

  // River channel (with a shallow ford).
  const d = Math.abs(z - riverZ(x));
  const ford = 1 - smoothstep(FORD.half, FORD.half + 12, Math.abs(x - FORD.x));
  const bed = WATER_LEVEL - lerp(2.8, 0.75, ford);
  const outer = lerp(30, 55, ford);
  if (d < outer) h = lerp(bed, h, smoothstep(RIVER_HALF_WIDTH - 2, outer, d));
  return h;
}

for (const f of FLATS) f.h = baseHeight(f.x, f.z);
for (const f of Object.values(AIRFIELDS)) f.h = Math.max(baseHeight(f.x, f.z), WATER_LEVEL + 4);

// ---- Height grid ----
export const heights = new Float32Array((GRID + 1) * (GRID + 1));
for (let j = 0; j <= GRID; j++) {
  for (let i = 0; i <= GRID; i++) {
    heights[j * (GRID + 1) + i] = computeHeight(-HALF + i * CELL, -HALF + j * CELL);
  }
}

export function gridHeight(i, j) {
  i = Math.max(0, Math.min(GRID, i));
  j = Math.max(0, Math.min(GRID, j));
  return heights[j * (GRID + 1) + i];
}

// Exact height of the rendered terrain surface. Each cell is split along the
// (i+1,j)-(i,j+1) diagonal, matching buildTerrainGeometry on the client.
export function heightAt(x, z) {
  const gx = Math.max(0, Math.min(GRID - 1e-6, (x + HALF) / CELL));
  const gz = Math.max(0, Math.min(GRID - 1e-6, (z + HALF) / CELL));
  const i = Math.floor(gx);
  const j = Math.floor(gz);
  const fx = gx - i;
  const fz = gz - j;
  const h00 = gridHeight(i, j);
  const h10 = gridHeight(i + 1, j);
  const h01 = gridHeight(i, j + 1);
  const h11 = gridHeight(i + 1, j + 1);
  if (fx + fz <= 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
  return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
}

export function onBridge(x, z) {
  for (const b of BRIDGES) {
    if (Math.abs(x - b.x) <= b.halfWidth && Math.abs(z - b.z) <= b.halfLength) return b;
  }
  return null;
}

// Drivable surface: terrain, or a bridge deck where one exists.
export function groundAt(x, z) {
  const h = heightAt(x, z);
  return onBridge(x, z) ? Math.max(h, BRIDGE_DECK) : h;
}

export function waterDepthAt(x, z) {
  if (onBridge(x, z)) return 0;
  return Math.max(0, WATER_LEVEL - heightAt(x, z));
}

// Bridge railings block sideways movement onto/off the deck over water.
export function crossesBridgeRail(x0, z0, x1, z1) {
  for (const b of BRIDGES) {
    const inZ = Math.abs(z1 - b.z) < b.halfLength - 4;
    if (!inZ) continue;
    const was = Math.abs(x0 - b.x) <= b.halfWidth;
    const now = Math.abs(x1 - b.x) <= b.halfWidth;
    if (was !== now) return true;
  }
  return false;
}
