import * as THREE from 'three';
import { Scatter, mergeParts, bakeOnGround } from './scatter.js';
import { CRATERS, FIELDS, ROADS, roadSamples, treeAllowed, TREE_NOISE, distToRoad, distToRail, fieldAt, propsNear, PROPS } from '../../../shared/props.js';
import { heightAt, waterDepthAt, riverZ, RIVER_HALF_WIDTH, WATER_LEVEL, POINTS, BASES, PLAY_LIMIT } from '../../../shared/map.js';
import { mulberry32, createNoise2D } from '../../../shared/noise.js';
import { quality } from '../settings.js';

// Everything small and repeated on the battlefield: trees, grass, bushes, rocks, crops,
// hedgerows, reeds, ruts, puddles, scorch marks, debris and roadside furniture.
// All placement is seeded, so both players see the same countryside.

export const windTime = { value: 0 };

// Vertex-coloured material whose upper vertices sway in the wind.
function windMaterial(amp, opts = {}) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, ...opts });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec4 wp = instanceMatrix[3];
        #else
          vec4 wp = vec4(0.0);
        #endif
        float hh = max(position.y, 0.0);
        float sway = sin(uTime * 1.7 + wp.x * 0.21 + wp.z * 0.17) + 0.45 * sin(uTime * 3.1 + wp.x * 0.6 + wp.z * 0.3);
        transformed.x += sway * ${amp.toFixed(4)} * hh;
        transformed.z += sway * ${(amp * 0.6).toFixed(4)} * hh;`,
      );
  };
  mat.customProgramCacheKey = () => `wind${amp}`;
  return mat;
}

const MAT = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 });
const DECAL = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false });

const BOX = new THREE.BoxGeometry(1, 1, 1);
const ICO = new THREE.IcosahedronGeometry(1, 0);
const DODE = new THREE.DodecahedronGeometry(1, 0);
const TET = new THREE.TetrahedronGeometry(1, 0);
const cyl = (seg) => new THREE.CylinderGeometry(0.5, 0.5, 1, seg);
const cone = (seg) => new THREE.ConeGeometry(0.5, 1, seg);
const disc = (seg) => new THREE.RingGeometry(0.001, 1, seg, 2).rotateX(-Math.PI / 2);

// ---------- Models ----------
const MODELS = {
  pine: () => mergeParts([
    { geo: cyl(5), color: 0x4a3626, y: 1.1, sx: 0.5, sy: 2.2, sz: 0.5 },
    { geo: cone(6), color: 0x2f4a2a, y: 3.6, sx: 4, sy: 4.2, sz: 4 },
    { geo: cone(6), color: 0x2c4628, y: 5.6, sx: 3, sy: 3.4, sz: 3 },
    { geo: cone(6), color: 0x2a4426, y: 7.3, sx: 1.8, sy: 2.4, sz: 1.8 },
  ]),
  pineFar: () => mergeParts([{ geo: cyl(4), color: 0x4a3626, y: 1, sx: 0.5, sy: 2, sz: 0.5 }, { geo: cone(4), color: 0x2d4729, y: 5, sx: 3.6, sy: 7.5, sz: 3.6 }]),
  oak: () => mergeParts([
    { geo: cyl(6), color: 0x4f3b2a, y: 1.6, sx: 0.75, sy: 3.2, sz: 0.75 },
    { geo: cyl(5), color: 0x4f3b2a, x: 0.6, y: 3.4, rz: -0.7, sx: 0.35, sy: 1.8, sz: 0.35 },
    { geo: ICO, color: 0x4b6230, y: 5.0, sx: 3.2, sy: 2.6, sz: 3.0 },
    { geo: ICO, color: 0x46602c, x: 1.8, y: 4.4, sx: 2.2, sy: 1.9, sz: 2.2 },
    { geo: ICO, color: 0x52693a, x: -1.5, y: 4.6, z: 0.8, sx: 2.3, sy: 2.0, sz: 2.1 },
  ]),
  oakFar: () => mergeParts([{ geo: cyl(4), color: 0x4f3b2a, y: 1.6, sx: 0.7, sy: 3.2, sz: 0.7 }, { geo: ICO, color: 0x4b6230, y: 4.8, sx: 3.6, sy: 2.8, sz: 3.4 }]),
  birch: () => mergeParts([
    { geo: cyl(5), color: 0xd8d4c8, y: 2.6, sx: 0.34, sy: 5.2, sz: 0.34 },
    { geo: cyl(5), color: 0x2a2826, y: 1.4, sx: 0.36, sy: 0.18, sz: 0.36 },
    { geo: cyl(5), color: 0x2a2826, y: 3.1, sx: 0.36, sy: 0.14, sz: 0.36 },
    { geo: ICO, color: 0x7a9440, y: 6.0, sx: 1.6, sy: 2.6, sz: 1.6 },
    { geo: ICO, color: 0x6f8a3a, x: 0.5, y: 4.9, sx: 1.2, sy: 1.6, sz: 1.2 },
  ]),
  birchFar: () => mergeParts([{ geo: cyl(4), color: 0xd8d4c8, y: 2.6, sx: 0.32, sy: 5.2, sz: 0.32 }, { geo: cone(4), color: 0x76903e, y: 5.6, sx: 2.6, sy: 4, sz: 2.6 }]),
  dead: () => mergeParts([
    { geo: cyl(5), color: 0x2a2420, y: 2.4, sx: 0.5, sy: 4.8, sz: 0.5 },
    { geo: cyl(4), color: 0x2a2420, x: 0.7, y: 3.6, rz: -0.8, sx: 0.22, sy: 2.0, sz: 0.22 },
    { geo: cyl(4), color: 0x2a2420, x: -0.6, y: 2.9, rz: 0.9, sx: 0.2, sy: 1.7, sz: 0.2 },
    { geo: cyl(4), color: 0x26201c, z: 0.5, y: 4.4, rx: 0.7, sx: 0.16, sy: 1.4, sz: 0.16 },
  ]),
  deadFar: () => mergeParts([{ geo: cyl(4), color: 0x2a2420, y: 2.4, sx: 0.5, sy: 4.8, sz: 0.5 }]),
  grass: (rand) => {
    // A patch of a dozen low-poly tufts (each tuft = 3 crossed blades).
    const parts = [];
    for (let i = 0; i < 12; i++) {
      const x = (rand() - 0.5) * 2.4, z = (rand() - 0.5) * 2.4, h = 0.25 + rand() * 0.3;
      const col = [0x5a7a32, 0x6b8a3a, 0x7d8c40, 0x8d8a48][Math.floor(rand() * 4)];
      for (let k = 0; k < 3; k++) parts.push({ geo: TET, color: col, x, y: h * 0.5, z, ry: k * 2.1 + rand(), rz: (rand() - 0.5) * 0.4, sx: 0.07, sy: h, sz: 0.2 });
    }
    return mergeParts(parts);
  },
  tallgrass: (rand) => {
    const parts = [];
    for (let i = 0; i < 9; i++) {
      const x = (rand() - 0.5) * 2.6, z = (rand() - 0.5) * 2.6, h = 0.7 + rand() * 0.6;
      const col = [0x9a9450, 0x8f8a4a, 0xa6a05a][Math.floor(rand() * 3)];
      for (let k = 0; k < 3; k++) parts.push({ geo: TET, color: col, x, y: h * 0.5, z, ry: k * 2.1 + rand(), rz: (rand() - 0.5) * 0.3, sx: 0.08, sy: h, sz: 0.25 });
    }
    return mergeParts(parts);
  },
  bush: () => mergeParts([
    { geo: ICO, color: 0x3f5a2a, y: 0.6, sx: 1.2, sy: 0.85, sz: 1.1 },
    { geo: ICO, color: 0x46622e, x: 0.7, y: 0.5, z: 0.3, sx: 0.8, sy: 0.65, sz: 0.8 },
    { geo: ICO, color: 0x3a5226, x: -0.6, y: 0.45, z: -0.3, sx: 0.75, sy: 0.6, sz: 0.7 },
  ]),
  hedge: () => mergeParts([
    { geo: BOX, color: 0x3a5428, y: 0.75, sx: 1.4, sy: 1.5, sz: 2.8, ry: 0.05 },
    { geo: ICO, color: 0x41602c, y: 1.5, x: 0.2, sx: 0.9, sy: 0.6, sz: 1.4 },
  ]),
  rock: () => mergeParts([{ geo: DODE, color: 0x7e786c, y: 0.25, sx: 1, sy: 0.7, sz: 0.85 }]),
  pebbles: (rand) => {
    const parts = [];
    for (let i = 0; i < 10; i++) parts.push({ geo: TET, color: [0x8a8478, 0x6f6a60, 0x9a9282][i % 3], x: (rand() - 0.5) * 3, y: 0.04, z: (rand() - 0.5) * 3, ry: rand() * 6, sx: 0.12 + rand() * 0.15, sy: 0.08, sz: 0.12 + rand() * 0.15 });
    return mergeParts(parts);
  },
  reeds: (rand) => {
    const parts = [];
    for (let i = 0; i < 14; i++) {
      const x = (rand() - 0.5) * 2.2, z = (rand() - 0.5) * 2.2, h = 1.2 + rand() * 0.9;
      parts.push({ geo: cone(3), color: i % 3 ? 0x6e7a3a : 0x8a8448, x, y: h / 2, z, rz: (rand() - 0.5) * 0.25, sx: 0.06, sy: h, sz: 0.06 });
      if (i % 4 === 0) parts.push({ geo: cyl(4), color: 0x5a3e24, x, y: h + 0.1, z, sx: 0.09, sy: 0.35, sz: 0.09 });
    }
    return mergeParts(parts);
  },
  croprow: () => mergeParts([{ geo: BOX, color: 0xffffff, y: 0.25, sx: 0.8, sy: 0.5, sz: 4.1 }]),
  haybale: () => mergeParts([{ geo: cyl(10), color: 0xc9a54d, y: 0.75, rz: Math.PI / 2, sx: 1.5, sy: 1.6, sz: 1.5 }]),
  haystack: () => mergeParts([{ geo: cone(7), color: 0xb89a48, y: 1.4, sx: 3.2, sy: 2.8, sz: 3.2 }, { geo: cyl(7), color: 0xc2a04c, y: 0.4, sx: 3.0, sy: 0.8, sz: 3.0 }]),
  rut: () => {
    const strip = new THREE.PlaneGeometry(0.4, 4.3, 1, 2).rotateX(-Math.PI / 2);
    return mergeParts([{ geo: strip, color: 0x3b2e22, x: -1.1 }, { geo: strip, color: 0x3b2e22, x: 1.1 }]);
  },
  scorch: () => mergeParts([{ geo: disc(7), color: 0x1e1a16, sx: 1, sz: 1 }, { geo: disc(5), color: 0x2a231d, x: 0.7, z: 0.4, sx: 0.6, sz: 0.7 }]),
  mud: () => mergeParts([{ geo: disc(8), color: 0x3a2c1e }]),
  helmet: () => mergeParts([{ geo: new THREE.SphereGeometry(0.5, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2), color: 0x4a5236, sx: 0.55, sy: 0.4, sz: 0.6 }]),
  drum: () => mergeParts([{ geo: cyl(8), color: 0x55603f, y: 0.45, sx: 0.6, sy: 0.9, sz: 0.6 }, { geo: cyl(8), color: 0x3d4530, y: 0.92, sx: 0.62, sy: 0.04, sz: 0.62 }]),
  drumTipped: () => mergeParts([{ geo: cyl(8), color: 0x7b4a2e, y: 0.3, rz: Math.PI / 2, sx: 0.6, sy: 0.9, sz: 0.6 }]),
  crate: () => mergeParts([{ geo: BOX, color: 0x6b5238, y: 0.35, sx: 0.9, sy: 0.7, sz: 0.6 }, { geo: BOX, color: 0x4a3828, y: 0.35, sx: 0.92, sy: 0.12, sz: 0.62 }]),
  stretcher: () => mergeParts([
    { geo: BOX, color: 0x6f7354, y: 0.12, sx: 0.6, sy: 0.04, sz: 1.9 },
    { geo: BOX, color: 0x4a3828, x: 0.32, y: 0.12, sx: 0.05, sy: 0.05, sz: 2.3 },
    { geo: BOX, color: 0x4a3828, x: -0.32, y: 0.12, sx: 0.05, sy: 0.05, sz: 2.3 },
  ]),
  pole: () => mergeParts([{ geo: BOX, color: 0x6b5238, y: 4, sx: 0.25, sy: 8, sz: 0.25 }, { geo: BOX, color: 0x4a3828, y: 7.4, sx: 1.8, sy: 0.15, sz: 0.15 }]),
  fence: () => mergeParts([
    { geo: BOX, color: 0x6b5238, y: 0.6, sx: 0.12, sy: 1.2, sz: 0.12 },
    { geo: BOX, color: 0x4a3828, y: 0.45, sx: 0.06, sy: 0.12, sz: 5 },
    { geo: BOX, color: 0x4a3828, y: 0.95, sx: 0.06, sy: 0.12, sz: 5 },
  ]),
  lamp: () => mergeParts([
    { geo: cyl(6), color: 0x2e302c, y: 2, sx: 0.14, sy: 4, sz: 0.14 },
    { geo: BOX, color: 0x2e302c, y: 4, z: 0.3, sx: 0.08, sy: 0.08, sz: 0.7 },
    { geo: cone(4), color: 0x3a3c36, y: 3.85, z: 0.62, sx: 0.4, sy: 0.3, sz: 0.4 },
  ]),
  cross: () => mergeParts([{ geo: BOX, color: 0x5c4630, y: 0.9, sx: 0.12, sy: 1.8, sz: 0.1 }, { geo: BOX, color: 0x5c4630, y: 1.35, sx: 0.8, sy: 0.1, sz: 0.1 }, { geo: BOX, color: 0x3d4a2a, y: 0.15, sx: 0.5, sy: 0.3, sz: 0.5 }]),
  signpost: () => mergeParts([
    { geo: BOX, color: 0x5c4630, y: 1.3, sx: 0.12, sy: 2.6, sz: 0.12 },
    { geo: BOX, color: 0xd8d2c0, y: 2.3, x: 0.6, sx: 1.2, sy: 0.25, sz: 0.06, ry: 0.3 },
    { geo: BOX, color: 0xd8d2c0, y: 1.95, x: -0.55, sx: 1.1, sy: 0.25, sz: 0.06, ry: -0.4 },
  ]),
  cart: () => mergeParts([
    { geo: BOX, color: 0x6b5238, y: 0.8, sx: 1.5, sy: 0.15, sz: 2.4, rx: 0.15 },
    { geo: BOX, color: 0x5a4430, y: 1.05, x: 0.72, sx: 0.08, sy: 0.4, sz: 2.4, rx: 0.15 },
    { geo: BOX, color: 0x5a4430, y: 1.05, x: -0.72, sx: 0.08, sy: 0.4, sz: 2.4, rx: 0.15 },
    { geo: cyl(8), color: 0x4a3828, x: 0.85, y: 0.55, rz: Math.PI / 2, sx: 1.1, sy: 0.1, sz: 1.1 },
    { geo: cyl(8), color: 0x4a3828, x: -0.75, y: 0.3, z: 0.3, rx: 0.4, rz: Math.PI / 2 + 0.9, sx: 1.1, sy: 0.1, sz: 1.1 },
    { geo: BOX, color: 0x5a4430, y: 0.4, z: 1.8, sx: 0.08, sy: 0.08, sz: 1.6, rx: 0.4 },
  ]),
};

export class Vegetation {
  constructor(scene) {
    this.scene = scene;
    const q = quality();
    this.layers = [];
    this.knockable = [];
    const lod = q.lod;
    const S = (n) => Math.round(n * q.scatter);
    const windGrass = windMaterial(0.12);
    const windTree = windMaterial(0.012);
    const windReed = windMaterial(0.06);
    const shadows = q.shadows;

    // ---- Trees: forests, tree lines along roads, odd lone trees ----
    const rand = mulberry32(777);
    const kindNoise = createNoise2D(5151);
    const trees = { pine: [], oak: [], birch: [], dead: [] };
    const treeKind = (x, z) => {
      const k = kindNoise(x / 120, z / 120);
      // The contested middle of the map is full of shelled, burnt trees.
      if (Math.abs(z) < 260 && TREE_NOISE(x / 30 + 9, z / 30) > 0.45) return 'dead';
      if (k > 0.35) return 'birch';
      if (k < -0.25 || heightAt(x, z) < 12) return 'oak';
      return 'pine';
    };
    const pushTree = (kind, x, z, s) => trees[kind].push({ x, z, y: heightAt(x, z) - 0.2, s, sy: 0.9 + rand() * 0.25, rot: rand() * Math.PI * 2, color: tint(rand, kind) });
    const want = Math.round(3600 * q.trees);
    let placed = 0;
    for (let tries = 0; placed < want && tries < want * 30; tries++) {
      const x = (rand() - 0.5) * 1400, z = (rand() - 0.5) * 1400;
      const n = TREE_NOISE(x / 160, z / 160) + TREE_NOISE(x / 40, z / 40) * 0.25;
      if (n < 0.22 && rand() > 0.03) continue;
      if (!treeAllowed(x, z)) continue;
      pushTree(treeKind(x, z), x, z, 0.75 + rand() * 0.7);
      placed++;
    }
    // Tree lines along stretches of road.
    let side = 1;
    for (const s of roadSamples(13)) {
      if (TREE_NOISE(s.x / 70 + 3, s.z / 70) < 0.05) continue;
      side = -side;
      const x = s.x + s.dirZ * 11 * side, z = s.z - s.dirX * 11 * side;
      if (!treeAllowed(x, z) && distToRoad(x, z) > 12) continue;
      if (waterDepthAt(x, z) > 0 || Math.abs(x) > 680 || Math.abs(z) > 680 || blockedByProps(x, z, 3)) continue;
      pushTree(rand() < 0.5 ? 'birch' : 'oak', x, z, 0.85 + rand() * 0.4);
    }

    // ---- Hedgerows along field edges, with the odd tree in them ----
    const hedges = [];
    const crops = [];
    const bales = [];
    for (const f of FIELDS) {
      const c = Math.cos(f.rot), sn = Math.sin(f.rot);
      const toWorld = (lx, lz) => [f.x + lx * c + lz * sn, f.z - lx * sn + lz * c];
      // Hedge on 2–3 sides.
      const sides = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(() => rand() < 0.65);
      for (const [ax, az] of sides) {
        const len = ax ? f.d : f.w;
        for (let t = -len / 2; t < len / 2; t += 2.6) {
          const lx = ax ? (ax * f.w) / 2 + ax * 2 : t;
          const lz = az ? (az * f.d) / 2 + az * 2 : t;
          const [x, z] = toWorld(lx, lz);
          if (distToRoad(x, z) < 5 || waterDepthAt(x, z) > 0 || blockedByProps(x, z, 2)) continue;
          if (rand() < 0.05) pushTree(rand() < 0.6 ? 'oak' : 'birch', x, z, 0.8 + rand() * 0.3);
          else hedges.push({ x, z, y: heightAt(x, z) - 0.1, rot: f.rot + (ax ? 0 : Math.PI / 2), s: 0.9 + rand() * 0.3, color: tint(rand, 'hedge') });
        }
      }
      // Crop rows (rows run along local Z) and hay.
      const cropCol = { wheat: 0xc9a54d, green: 0x6b8a36, stubble: 0xa89a6a, plowed: 0x4a3a2a }[f.crop];
      const rowH = { wheat: 1.5, green: 1.1, stubble: 0.35, plowed: 0.6 }[f.crop];
      for (let lx = -f.w / 2 + 1.5; lx < f.w / 2 - 1; lx += 2.2) {
        for (let lz = -f.d / 2 + 2.2; lz < f.d / 2 - 2; lz += 4.2) {
          const [x, z] = toWorld(lx, lz);
          const [xf, zf] = toWorld(lx, lz + 2);
          const [xb, zb] = toWorld(lx, lz - 2);
          const y = heightAt(x, z);
          crops.push({ x, z, y: y - 0.05, rot: f.rot, tilt: -Math.atan2(heightAt(xf, zf) - heightAt(xb, zb), 4), s: 1, sy: rowH * (0.9 + rand() * 0.2), color: shade(cropCol, rand) });
        }
      }
      if (f.crop === 'wheat' || f.crop === 'stubble') {
        for (let k = 0; k < 7; k++) {
          const [x, z] = toWorld((rand() - 0.5) * f.w * 0.8, (rand() - 0.5) * f.d * 0.8);
          bales.push({ x, z, y: heightAt(x, z), rot: rand() * 6, s: 1, kind: rand() < 0.3 ? 'stack' : 'bale' });
        }
      }
    }
    // Hay bales around the farm too.
    const C3 = POINTS[2];
    for (let i = 0; i < 24; i++) {
      const x = C3.x + (rand() - 0.5) * 120, z = C3.z + 50 + rand() * 50;
      if (blockedByProps(x, z, 2) || distToRoad(x, z) < 4 || distToRail(x, z) < 4) continue;
      bales.push({ x, z, y: heightAt(x, z), rot: rand() * 6, s: 1, kind: 'bale' });
    }

    for (const kind of ['pine', 'oak', 'birch', 'dead']) {
      this.addLayer({ geo: MODELS[kind](), mat: windTree, items: trees[kind], radius: 260 * lod, farGeo: MODELS[`${kind}Far`](), farRadius: q.drawDistance, shadows, knockable: true, knockRadius: 1.6 });
    }
    this.treeCount = Object.values(trees).reduce((a, l) => a + l.length, 0);
    this.addLayer({ geo: MODELS.hedge(), mat: windTree, items: hedges, radius: 420 * lod, shadows, knockable: true, knockRadius: 1.8, maxFall: 1.3 });
    this.addLayer({ geo: MODELS.croprow(), mat: windGrass, items: crops, radius: 330 * lod });
    this.addLayer({ geo: MODELS.haybale(), mat: MAT, items: bales.filter((b) => b.kind === 'bale'), radius: 500 * lod, shadows, knockable: true, knockRadius: 1.2, maxFall: 0.5 });
    this.addLayer({ geo: MODELS.haystack(), mat: MAT, items: bales.filter((b) => b.kind === 'stack'), radius: 600 * lod, shadows });

    // ---- Ground cover ----
    const r2 = mulberry32(4321);
    const tallNoise = createNoise2D(8080);
    const grass = [], tall = [], bushes = [], rocks = [], pebbles = [], reeds = [];
    const groundOk = (x, z, roadPad = 3) => Math.abs(x) < 700 && Math.abs(z) < 700 && waterDepthAt(x, z) <= 0 && distToRoad(x, z) > roadPad && !fieldAt(x, z) && !blockedByProps(x, z, 1);
    const scatter = (count, list, make, cond = () => true) => {
      for (let i = 0, tries = 0; i < count && tries < count * 4; tries++) {
        const x = (r2() - 0.5) * 1400, z = (r2() - 0.5) * 1400;
        if (!cond(x, z) || !groundOk(x, z)) continue;
        list.push(make(x, z));
        i++;
      }
    };
    scatter(S(26000), grass, (x, z) => ({ x, z, y: heightAt(x, z) - 0.04, rot: r2() * 6, s: 0.8 + r2() * 0.5 }), (x, z) => heightAt(x, z) < 60 && slope(x, z) < 0.5);
    scatter(S(5000), tall, (x, z) => ({ x, z, y: heightAt(x, z) - 0.05, rot: r2() * 6, s: 0.9 + r2() * 0.4 }), (x, z) => tallNoise(x / 60, z / 60) > 0.35);
    scatter(S(5500), bushes, (x, z) => ({ x, z, y: heightAt(x, z) - 0.15, rot: r2() * 6, s: 0.6 + r2() * 0.9, color: tint(r2, 'bush') }), (x, z) => TREE_NOISE(x / 160, z / 160) > -0.1 || r2() < 0.25);
    scatter(S(2600), rocks, (x, z) => ({ x, z, y: heightAt(x, z) - 0.1, rot: r2() * 6, s: 0.3 + r2() ** 2 * 1.6, tilt: (r2() - 0.5) * 0.6 }), (x, z) => slope(x, z) > 0.15 || r2() < 0.4);
    scatter(S(7000), pebbles, (x, z) => ({ x, z, y: heightAt(x, z), rot: r2() * 6, s: 1 }));
    // Reeds hug the river banks.
    for (let i = 0; i < S(2600); i++) {
      const x = (r2() - 0.5) * 1400;
      const z = riverZ(x) + (r2() < 0.5 ? -1 : 1) * (RIVER_HALF_WIDTH - 3 + r2() * 12);
      const h = heightAt(x, z);
      if (Math.abs(x) > 700 || h > WATER_LEVEL + 2.5 || h < WATER_LEVEL - 0.6 || distToRoad(x, z) < 6) continue;
      reeds.push({ x, z, y: Math.max(h, WATER_LEVEL - 0.6), rot: r2() * 6, s: 0.8 + r2() * 0.5 });
    }
    this.addLayer({ geo: MODELS.grass(mulberry32(1)), mat: windGrass, items: grass, radius: 105 * lod });
    this.addLayer({ geo: MODELS.tallgrass(mulberry32(2)), mat: windGrass, items: tall, radius: 170 * lod });
    this.addLayer({ geo: MODELS.bush(), mat: windTree, items: bushes, radius: 380 * lod, shadows: shadows && q.scatter > 0.5 });
    this.addLayer({ geo: MODELS.rock(), mat: MAT, items: rocks, radius: 320 * lod, shadows: shadows && q.scatter > 0.5 });
    this.addLayer({ geo: MODELS.pebbles(mulberry32(3)), mat: MAT, items: pebbles, radius: 70 * lod });
    this.addLayer({ geo: MODELS.reeds(mulberry32(4)), mat: windReed, items: reeds, radius: 220 * lod });

    // ---- Ground marks: tire ruts, mud, puddles, scorch marks ----
    const r3 = mulberry32(2468);
    const ruts = [], mud = [], puddles = [], scorch = [];
    for (const s of roadSamples(4.2)) {
      if (waterDepthAt(s.x, s.z) > 0 || Math.abs(s.x) > 690 || Math.abs(s.z) > 690) continue;
      const [fx, fz] = [s.x + s.dirX * 2, s.z + s.dirZ * 2];
      const [bx, bz] = [s.x - s.dirX * 2, s.z - s.dirZ * 2];
      ruts.push({ x: s.x, z: s.z, y: heightAt(s.x, s.z) + 0.03, rot: Math.atan2(s.dirX, s.dirZ), tilt: -Math.atan2(heightAt(fx, fz) - heightAt(bx, bz), 4), s: 1 });
      if (r3() < 0.06 && slope(s.x, s.z) < 0.06) puddles.push({ x: s.x + (r3() - 0.5) * 2, z: s.z + (r3() - 0.5) * 2, y: heightAt(s.x, s.z) + 0.05, rot: r3() * 6, s: 0.8 + r3() * 1.4, sz: 0.6 + r3() * 0.6 });
    }
    const mudNoise = createNoise2D(1357);
    for (let i = 0; i < S(2200); i++) {
      const x = (r3() - 0.5) * 1380, z = (r3() - 0.5) * 1380;
      if (mudNoise(x / 50, z / 50) < 0.3 || waterDepthAt(x, z) > 0 || fieldAt(x, z) || blockedByProps(x, z, 2) || slope(x, z) > 0.15) continue;
      mud.push({ x, z, y: heightAt(x, z) + 0.04, rot: r3() * 6, s: 1.5 + r3() * 3.5, sz: 0.7 + r3() * 0.6 });
      if (r3() < 0.35 && slope(x, z) < 0.07) puddles.push({ x, z, y: heightAt(x, z) + 0.07, rot: r3() * 6, s: 0.7 + r3() * 1.6, sz: 0.5 + r3() * 0.7 });
    }
    for (const c of CRATERS) {
      if (r3() < 0.6) scorch.push({ x: c.x, z: c.z, y: heightAt(c.x, c.z) + 0.05, rot: r3() * 6, s: c.r * (1.3 + r3() * 0.6), sz: 0.8 + r3() * 0.4 });
    }
    for (let i = 0; i < S(260); i++) {
      const x = (r3() - 0.5) * 1300, z = (r3() - 0.5) * 900;
      if (waterDepthAt(x, z) > 0 || slope(x, z) > 0.3) continue;
      scorch.push({ x, z, y: heightAt(x, z) + 0.05, rot: r3() * 6, s: 1.5 + r3() * 3, sz: 0.6 + r3() * 0.6 });
    }
    bakeOnGround(this.scene, MODELS.rut(), DECAL, ruts, { lift: 0.05 });
    bakeOnGround(this.scene, MODELS.mud(), DECAL, mud, { lift: 0.05 });
    bakeOnGround(this.scene, MODELS.scorch(), DECAL, scorch, { lift: 0.05 });
    this.puddleMat = new THREE.MeshStandardMaterial({ color: 0x8a9aa0, metalness: 0.9, roughness: 0.08, flatShading: true, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, depthWrite: false });
    bakeOnGround(this.scene, disc(9), this.puddleMat, puddles, { lift: 0.07, order: 2 });

    // ---- Abandoned equipment near trenches, wrecks and points ----
    const r4 = mulberry32(97531);
    const debris = { helmet: [], drum: [], drumTipped: [], crate: [], stretcher: [] };
    const anchors = PROPS.filter((p) => ['trench', 'wreck', 'sandbags', 'mgnest', 'checkpoint', 'ruin', 'dugout'].includes(p.type));
    for (let i = 0; i < S(1300); i++) {
      const a = anchors[Math.floor(r4() * anchors.length)];
      const ang = r4() * Math.PI * 2, d = 3 + r4() * 14;
      const x = a.x + Math.cos(ang) * d, z = a.z + Math.sin(ang) * d;
      if (waterDepthAt(x, z) > 0 || blockedByProps(x, z, 0.6)) continue;
      const kinds = ['helmet', 'helmet', 'drum', 'drumTipped', 'crate', 'crate', 'stretcher'];
      const kind = kinds[Math.floor(r4() * kinds.length)];
      debris[kind].push({ x, z, y: heightAt(x, z) - 0.02, rot: r4() * 6, s: 1, tilt: kind === 'helmet' ? (r4() - 0.5) * 0.8 : 0 });
    }
    for (const [kind, items] of Object.entries(debris)) this.addLayer({ geo: MODELS[kind](), mat: MAT, items, radius: 200 * lod, shadows: shadows && kind !== 'helmet' });

    // ---- Roadside furniture (knockable) ----
    this.buildRoadside(rand, lod, shadows);
  }

  addLayer(opts) {
    if (!opts.items.length) return null;
    const layer = new Scatter(this.scene, opts);
    this.layers.push(layer);
    if (opts.knockable) this.knockable.push(layer);
    return layer;
  }

  buildRoadside(rand, lod, shadows) {
    const poles = [], fences = [], lamps = [], crosses = [], signs = [], carts = [];
    let road = 0;
    const roadPoles = [];
    for (const r of ROADS) {
      const chain = [];
      for (let i = 0; i < r.length - 1; i++) {
        const [ax, az] = r[i];
        const [bx, bz] = r[i + 1];
        const len = Math.hypot(bx - ax, bz - az);
        const dx = (bx - ax) / len, dz = (bz - az) / len;
        for (let d = 0; d < len; d += 36) {
          const x = ax + dx * d + dz * 6, z = az + dz * d - dx * 6;
          if (waterDepthAt(x, z) > 0 || Math.abs(x) > 690 || Math.abs(z) > 690 || blockedByProps(x, z, 1.5)) {
            chain.push(null);
            continue;
          }
          const p = { x, z, y: heightAt(x, z), rot: Math.atan2(dx, dz), s: 1, road };
          poles.push(p);
          chain.push(p);
        }
      }
      roadPoles.push(chain);
      road++;
    }
    this.poleChains = roadPoles;
    for (const s of roadSamples(5)) {
      if (TREE_NOISE(s.x / 90 + 7, s.z / 90) < 0.3) continue;
      const x = s.x - s.dirZ * 7, z = s.z + s.dirX * 7;
      if (Math.abs(x) > 680 || Math.abs(z) > 680 || waterDepthAt(x, z) > 0 || blockedByProps(x, z, 1)) continue;
      fences.push({ x, z, y: heightAt(x, z), rot: Math.atan2(s.dirX, s.dirZ), s: 1 });
    }
    // Street lamps and carts in the village, crosses and signposts by the roads.
    const A = POINTS[0];
    for (let i = -4; i <= 4; i += 2) {
      for (const side of [-1, 1]) {
        const x = A.x + i * 13 + 6, z = A.z + side * 5.5;
        if (!blockedByProps(x, z, 0.5)) lamps.push({ x, z, y: heightAt(x, z), rot: side > 0 ? Math.PI : 0, s: 1 });
      }
    }
    for (let k = 0; k < 6; k++) {
      const x = A.x + (rand() - 0.5) * 80, z = A.z + (rand() - 0.5) * 50;
      if (!blockedByProps(x, z, 2) && distToRoad(x, z) > 2.5) carts.push({ x, z, y: heightAt(x, z), rot: rand() * 6, s: 1 });
    }
    for (const r of ROADS) {
      const [x0, z0] = r[0];
      const [x1, z1] = r[1];
      const len = Math.hypot(x1 - x0, z1 - z0);
      const x = x0 + ((x1 - x0) / len) * 14 + ((z1 - z0) / len) * 5, z = z0 + ((z1 - z0) / len) * 14 - ((x1 - x0) / len) * 5;
      if (!blockedByProps(x, z, 1)) signs.push({ x, z, y: heightAt(x, z), rot: Math.atan2(x1 - x0, z1 - z0), s: 1 });
    }
    for (const s of roadSamples(60)) {
      if (rand() > 0.35) continue;
      const x = s.x + s.dirZ * 5.5, z = s.z - s.dirX * 5.5;
      if (waterDepthAt(x, z) > 0 || blockedByProps(x, z, 1) || Math.abs(x) > 680 || Math.abs(z) > 680) continue;
      crosses.push({ x, z, y: heightAt(x, z), rot: Math.atan2(s.dirX, s.dirZ) + Math.PI / 2, s: 1, tilt: (rand() - 0.5) * 0.15 });
    }
    this.poles = this.addLayer({ geo: MODELS.pole(), mat: MAT, items: poles, radius: 700 * lod, shadows, knockable: true, knockRadius: 1.6 });
    this.addLayer({ geo: MODELS.fence(), mat: MAT, items: fences, radius: 350 * lod, shadows, knockable: true, knockRadius: 2.6, maxFall: 1.5 });
    this.addLayer({ geo: MODELS.lamp(), mat: MAT, items: lamps, radius: 400, shadows, knockable: true, knockRadius: 1.5 });
    this.addLayer({ geo: MODELS.cross(), mat: MAT, items: crosses, radius: 300 * lod, knockable: true, knockRadius: 1.4 });
    this.addLayer({ geo: MODELS.signpost(), mat: MAT, items: signs, radius: 400 * lod, knockable: true, knockRadius: 1.4 });
    this.addLayer({ geo: MODELS.cart(), mat: MAT, items: carts, radius: 300, shadows });

    // Telephone wires between neighbouring poles (sagging), rebuilt when a pole falls.
    this.wireMat = new THREE.LineBasicMaterial({ color: 0x1e1d1a, transparent: true, opacity: 0.8 });
    this.wires = new THREE.LineSegments(new THREE.BufferGeometry(), this.wireMat);
    this.wires.frustumCulled = false;
    this.scene.add(this.wires);
    this.rebuildWires();
  }

  rebuildWires() {
    const pts = [];
    const SEG = 6;
    for (const chain of this.poleChains) {
      for (let i = 0; i < chain.length - 1; i++) {
        const a = chain[i], b = chain[i + 1];
        if (!a || !b || a.falling || b.falling) continue;
        for (const off of [-0.8, 0.8]) {
          const lx = Math.cos(a.rot) * off, lz = -Math.sin(a.rot) * off;
          for (let k = 0; k < SEG; k++) {
            for (const t of [k / SEG, (k + 1) / SEG]) {
              const sag = Math.sin(t * Math.PI) * 0.9;
              pts.push(a.x + (b.x - a.x) * t + lx, a.y + 7.45 + (b.y - a.y) * t - sag, a.z + (b.z - a.z) * t + lz);
            }
          }
        }
      }
    }
    this.wires.geometry.dispose();
    this.wires.geometry = new THREE.BufferGeometry();
    this.wires.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  }

  update(dt, cam, units) {
    windTime.value += dt;
    for (const l of this.layers) l.update(cam);
    const fallingBefore = this.poles?.fallingList?.length ?? 0;
    const fallen = this.poles ? this.poles.items.filter((p) => p.falling).length : 0;
    for (const l of this.knockable) l.knock(dt, units);
    const fallenAfter = this.poles ? this.poles.items.filter((p) => p.falling).length : 0;
    if (fallenAfter !== fallen || (fallingBefore && !this.poles.fallingList.length)) this.rebuildWires();
  }

  // Count of instances drawn this frame (for the F3 overlay).
  get drawnInstances() {
    let n = 0;
    for (const l of this.layers) n += l.near.count + (l.far?.count ?? 0);
    return n;
  }

  setEnvMap(env) {
    this.puddleMat.envMap = env;
    this.puddleMat.needsUpdate = true;
  }
}

function slope(x, z) {
  const h = heightAt(x, z);
  return Math.max(Math.abs(heightAt(x + 2, z) - h), Math.abs(heightAt(x, z + 2) - h)) / 2;
}

function blockedByProps(x, z, pad) {
  for (const p of propsNear(x, z, pad + 2)) {
    const r = Math.max(p.w, p.d) / 2 + pad;
    if (Math.abs(p.x - x) < r && Math.abs(p.z - z) < r) return true;
  }
  return Math.abs(x) > PLAY_LIMIT + 40 || Math.abs(z) > PLAY_LIMIT + 40 || Object.values(BASES).some((b) => Math.hypot(b.x - x, b.z - z) < 60);
}

const _tc = new THREE.Color();
function tint(rand, kind) {
  // Instance colours multiply the vertex colours: keep them near white.
  const v = 0.82 + rand() * 0.3;
  if (kind === 'dead') return _tc.setRGB(v, v, v).getHex();
  if (kind === 'birch') return _tc.setRGB(v * 1.05, v * 1.05, v * 0.9).getHex();
  return _tc.setRGB(v * (0.95 + rand() * 0.15), v, v * (0.9 + rand() * 0.1)).getHex();
}

function shade(hex, rand) {
  const v = 0.88 + rand() * 0.2;
  return _tc.set(hex).multiplyScalar(v).getHex();
}
