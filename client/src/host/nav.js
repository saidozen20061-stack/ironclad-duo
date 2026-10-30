// Grid navigation for NPCs. Instead of per-unit A*, we precompute one Dijkstra flow
// field per destination (each capture point and each base) and per movement class.
// A unit just looks up its cell and steps towards the neighbour with the lowest cost.

import { HALF, PLAY_LIMIT, POINTS, BASES, heightAt, waterDepthAt, onBridge } from '../../../shared/map.js';
import { PROPS, distToRoad } from '../../../shared/props.js';

export const NAV_CELL = 8;
const N = Math.ceil((HALF * 2) / NAV_CELL);
const INF = 1e9;

const idx = (i, j) => j * N + i;
export const cellOf = (x, z) => [Math.floor((x + HALF) / NAV_CELL), Math.floor((z + HALF) / NAV_CELL)];
export const cellCenter = (i, j) => [-HALF + (i + 0.5) * NAV_CELL, -HALF + (j + 0.5) * NAV_CELL];

// Movement cost per cell for a class, or Infinity if impassable.
function buildCosts(cls) {
  const cost = new Float32Array(N * N).fill(Infinity);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const [x, z] = cellCenter(i, j);
      if (Math.abs(x) > PLAY_LIMIT - 8 || Math.abs(z) > PLAY_LIMIT - 8) continue;
      const bridge = onBridge(x, z);
      const depth = waterDepthAt(x, z);
      if (!bridge && depth > (cls === 'tank' ? 1.5 : 1.1)) continue;
      const h = heightAt(x, z);
      const slope = Math.max(
        Math.abs(heightAt(x + NAV_CELL / 2, z) - heightAt(x - NAV_CELL / 2, z)),
        Math.abs(heightAt(x, z + NAV_CELL / 2) - heightAt(x, z - NAV_CELL / 2)),
      ) / NAV_CELL;
      if (!bridge && slope > (cls === 'tank' ? 0.55 : 0.9)) continue;
      let c = 1 + slope * 3 + (depth > 0 ? 3 : 0);
      if (cls === 'tank' && distToRoad(x, z) < 6) c *= 0.6;
      if (h > 60) c += 4;
      cost[idx(i, j)] = c;
    }
  }
  // Solid props block their footprint (slightly inflated for tanks).
  const pad = cls === 'tank' ? 2.5 : 0.4;
  for (const p of PROPS) {
    if (!p.solid) continue;
    const r = Math.hypot(p.w, p.d) / 2 + pad;
    const [i0, j0] = cellOf(p.x - r, p.z - r);
    const [i1, j1] = cellOf(p.x + r, p.z + r);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (i < 0 || j < 0 || i >= N || j >= N) continue;
      const [cx, cz] = cellCenter(i, j);
      const dx = cx - p.x, dz = cz - p.z;
      const c = Math.cos(p.rot), s = Math.sin(p.rot);
      const lx = dx * c - dz * s, lz = dx * s + dz * c;
      if (Math.abs(lx) < p.w / 2 + pad && Math.abs(lz) < p.d / 2 + pad) cost[idx(i, j)] = Infinity;
    }
  }
  return cost;
}

// Minimal binary heap keyed on dist.
class Heap {
  constructor() {
    this.a = [];
  }
  push(k, v) {
    const a = this.a;
    a.push([k, v]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
  get size() {
    return this.a.length;
  }
}

const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];

function flowField(cost, tx, tz, radius) {
  // Float64: the heap compares float64 keys against stored distances, and float32
  // rounding would make `d > dist[k]` skip valid nodes.
  const dist = new Float64Array(N * N).fill(INF);
  const heap = new Heap();
  const [ci, cj] = cellOf(tx, tz);
  const rc = Math.ceil(radius / NAV_CELL);
  for (let j = cj - rc; j <= cj + rc; j++) for (let i = ci - rc; i <= ci + rc; i++) {
    if (i < 0 || j < 0 || i >= N || j >= N) continue;
    const [x, z] = cellCenter(i, j);
    if (Math.hypot(x - tx, z - tz) > radius || cost[idx(i, j)] === Infinity) continue;
    dist[idx(i, j)] = 0;
    heap.push(0, idx(i, j));
  }
  while (heap.size) {
    const [d, k] = heap.pop();
    if (d > dist[k]) continue;
    const i = k % N, j = (k / N) | 0;
    for (const [di, dj, w] of DIRS) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
      const nk = idx(ni, nj);
      const c = cost[nk];
      if (c === Infinity) continue;
      // No corner cutting past blocked cells.
      if (di && dj && (cost[idx(i + di, j)] === Infinity || cost[idx(i, j + dj)] === Infinity)) continue;
      const nd = d + c * w;
      if (nd < dist[nk]) {
        dist[nk] = nd;
        heap.push(nd, nk);
      }
    }
  }
  return dist;
}

const t0 = Date.now();
const COSTS = { tank: buildCosts('tank'), inf: buildCosts('inf') };
const TARGETS = [...POINTS.map((p) => ({ key: p.id, x: p.x, z: p.z, r: p.r * 0.6 })), ...Object.entries(BASES).map(([k, b]) => ({ key: k, x: b.x, z: b.z, r: 40 }))];
const FIELDS = {};
for (const cls of ['tank', 'inf']) {
  FIELDS[cls] = {};
  for (const t of TARGETS) FIELDS[cls][t.key] = flowField(COSTS[cls], t.x, t.z, t.r);
}
export const NAV_BUILD_MS = Date.now() - t0;

export function passable(cls, x, z) {
  const [i, j] = cellOf(x, z);
  if (i < 0 || j < 0 || i >= N || j >= N) return false;
  return COSTS[cls][idx(i, j)] !== Infinity;
}

// Next waypoint (world coords) towards target `key` for movement class `cls`, looking a
// couple of cells ahead for smoother steering. Returns null if unreachable / arrived.
export function nextWaypoint(cls, key, x, z, lookahead = 2) {
  const dist = FIELDS[cls][key];
  let [i, j] = cellOf(x, z);
  if (i < 0 || j < 0 || i >= N || j >= N) return null;
  // If standing in a blocked/unreached cell, step to the best neighbour anyway.
  for (let step = 0; step < lookahead; step++) {
    let best = dist[idx(i, j)];
    let bi = i, bj = j;
    for (const [di, dj] of DIRS) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
      const d = dist[idx(ni, nj)];
      if (d < best) {
        best = d;
        bi = ni;
        bj = nj;
      }
    }
    if (bi === i && bj === j) break;
    i = bi;
    j = bj;
  }
  const [wx, wz] = cellCenter(i, j);
  return { x: wx, z: wz, remaining: dist[idx(i, j)] };
}

export function distanceTo(cls, key, x, z) {
  const [i, j] = cellOf(x, z);
  if (i < 0 || j < 0 || i >= N || j >= N) return INF;
  return FIELDS[cls][key][idx(i, j)];
}
