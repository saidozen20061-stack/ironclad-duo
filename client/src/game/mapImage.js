import { HALF, MAP_SIZE, WATER_LEVEL, heightAt, waterDepthAt, BRIDGES } from '../../../shared/map.js';
import { PROPS, distToRoad } from '../../../shared/props.js';

// Pre-rendered top-down map images. Image space: north up, east right
// (px = HALF - x, py = HALF - z; +X is west in world space).

export const worldToImage = (x, z, scale) => [(HALF - x) * scale, (HALF - z) * scale];

let terrainCache = null;
export function terrainImage(size = 360) {
  if (terrainCache?.width === size) return terrainCache;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const m = MAP_SIZE / size;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = HALF - (px + 0.5) * m;
      const z = HALF - (py + 0.5) * m;
      const h = heightAt(x, z);
      const hx = heightAt(x - m, z);
      const shade = Math.max(-1, Math.min(1, (hx - h) * 0.25)); // simple hillshade
      let r, g, b;
      if (h < WATER_LEVEL) [r, g, b] = [60, 92, 100];
      else if (distToRoad(x, z) < 4) [r, g, b] = [150, 128, 96];
      else if (h > 55) [r, g, b] = [120, 112, 100];
      else {
        const t = Math.min(1, (h - 6) / 40);
        [r, g, b] = [86 + t * 40, 96 + t * 22, 58 + t * 18];
      }
      const k = 1 + shade * 0.35;
      const o = (py * size + px) * 4;
      img.data[o] = r * k;
      img.data[o + 1] = g * k;
      img.data[o + 2] = b * k;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  ctx.fillStyle = '#7a6448';
  const s = size / MAP_SIZE;
  // Buildings as dark specks on the gunner's minimap.
  ctx.fillStyle = 'rgba(40,36,30,0.85)';
  for (const p of PROPS) {
    if (!p.solid || p.type === 'rock') continue;
    const [px, py] = worldToImage(p.x, p.z, s);
    ctx.fillRect(px - 1, py - 1, Math.max(2, p.w * s), Math.max(2, p.d * s));
  }
  ctx.fillStyle = '#7a6448';
  for (const br of BRIDGES) {
    const [bx, bz] = worldToImage(br.x + br.halfWidth, br.z + br.halfLength, s);
    ctx.fillRect(bx, bz, br.halfWidth * 2 * s + 1, br.halfLength * 2 * s);
  }
  terrainCache = c;
  return c;
}

// Radar obstacle layer: dim outlines of water and cliffs at 2 m/pixel.
// Buildings are added in Phase 4 via addObstacleRects().
const OBST_SCALE = 0.5; // pixels per metre
let obstacleCache = null;
export function obstacleImage() {
  if (obstacleCache) return obstacleCache;
  const size = MAP_SIZE * OBST_SCALE;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const m = 1 / OBST_SCALE;
  const solid = new Uint8Array(size * size);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const x = HALF - (px + 0.5) * m;
      const z = HALF - (py + 0.5) * m;
      let v = 0;
      if (waterDepthAt(x, z) > 1.0) v = 1; // deep water
      else {
        const h = heightAt(x, z);
        const slope = Math.max(Math.abs(heightAt(x + m, z) - h), Math.abs(heightAt(x, z + m) - h)) / m;
        if (slope > 0.7) v = 2; // cliff
      }
      solid[py * size + px] = v;
    }
  }
  // Keep only edges so obstacles read as outlines.
  for (let py = 1; py < size - 1; py++) {
    for (let px = 1; px < size - 1; px++) {
      const i = py * size + px;
      const v = solid[i];
      if (!v) continue;
      const edge = !solid[i - 1] || !solid[i + 1] || !solid[i - size] || !solid[i + size];
      const o = i * 4;
      if (edge) {
        img.data[o] = 120;
        img.data[o + 1] = 230;
        img.data[o + 2] = 160;
        img.data[o + 3] = 200;
      } else if (v === 1) {
        img.data[o] = 60;
        img.data[o + 1] = 140;
        img.data[o + 2] = 120;
        img.data[o + 3] = 50;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  obstacleCache = { canvas: c, scale: OBST_SCALE, ctx };
  // Big solid props (buildings, silos, bunkers...) as dim outlines. World rotation r
  // becomes canvas rotation -r because image space flips both axes.
  addObstacleRects(PROPS.filter((p) => p.solid && p.w * p.d > 12).map((p) => ({ x: p.x, z: p.z, w: p.w, d: p.d, rot: -p.rot })));
  return obstacleCache;
}

export function addObstacleRects(rects) {
  const o = obstacleImage();
  o.ctx.strokeStyle = 'rgba(120,230,160,0.8)';
  o.ctx.lineWidth = 1;
  for (const r of rects) {
    o.ctx.save();
    const [px, py] = worldToImage(r.x, r.z, o.scale);
    o.ctx.translate(px, py);
    o.ctx.rotate(r.rot ?? 0);
    o.ctx.strokeRect((-r.w / 2) * o.scale, (-r.d / 2) * o.scale, r.w * o.scale, r.d * o.scale);
    o.ctx.restore();
  }
}
