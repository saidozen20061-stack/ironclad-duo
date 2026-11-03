import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PROPS, CRATERS, RAIL } from '../../../shared/props.js';
import { groundAt, heightAt, POINTS, BASES } from '../../../shared/map.js';
import { mulberry32 } from '../../../shared/noise.js';
import { quality } from '../settings.js';
import { Vegetation } from './vegetation.js';
import { bakeOnGround, markCullable } from './scatter.js';
import { markHeat, noHeat } from './thermal.js';

// Buildings and other solid props. Static props are merged per 120 m map chunk (one
// draw call per chunk); a chunk is re-merged when one of its props is destroyed.
// Moving parts (windmill sails, radar dishes, base artillery) stay separate meshes.

const MAT = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.92 });
const CHUNK = 120;

const C = {
  stone: 0x8e877a, stoneDark: 0x6c665c, plaster: 0xb9ad94, roof: 0x7a3f2c, roofDark: 0x5a3426, wood: 0x6b5238,
  woodDark: 0x4a3828, concrete: 0x8a8a82, sand: 0xa08d64, metal: 0x6d7468, rust: 0x7b4a2e, red: 0x8f2f25,
  burnt: 0x24211e, canvas: 0x6f7354, wire: 0x3a3a36, hay: 0xc9a54d, white: 0xd8d2c0, fuel: 0xb7b9b0,
  brick: 0x8a4a36, olive: 0x4f5a3a, glass: 0x2c3238, blueTeam: 0x3f6fa8, redTeam: 0xa8443a, black: 0x1e1e1c,
};

const tmpColor = new THREE.Color();
function part(geo, color, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1 } = {}) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  if (g.attributes.uv) g.deleteAttribute('uv');
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
  g.applyMatrix4(m);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  tmpColor.setHex(color);
  // Slight per-face variation keeps flat surfaces from looking plastic.
  const step = n === 36 ? 6 : 3; // a box: one shade per face, so quads show no diagonal
  for (let i = 0; i < n; i += step) {
    const k = 0.92 + Math.random() * 0.12;
    for (let j = 0; j < step && i + j < n; j++) {
      col[(i + j) * 3] = tmpColor.r * k;
      col[(i + j) * 3 + 1] = tmpColor.g * k;
      col[(i + j) * 3 + 2] = tmpColor.b * k;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}

const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL6 = new THREE.CylinderGeometry(0.5, 0.5, 1, 6);
const CYL8 = new THREE.CylinderGeometry(0.5, 0.5, 1, 8);
const CYL10 = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);
const TAPER = new THREE.CylinderGeometry(0.36, 0.5, 1, 8);
const CONE4 = new THREE.ConeGeometry(0.71, 1, 4);
const CONE8 = new THREE.ConeGeometry(0.5, 1, 8);
const ROOF = (() => {
  // Triangular prism, base 1x1, ridge along Z, height 1.
  const s = new THREE.Shape();
  s.moveTo(-0.5, 0);
  s.lineTo(0.5, 0);
  s.lineTo(0, 1);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false });
  g.translate(0, 0, -0.5);
  return g;
})();
// Half cylinder lying along Z, flat side down on y = 0: width 1, rise 0.5, length 1.
const VAULT = new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 1, false, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2);
const TET = new THREE.TetrahedronGeometry(1, 0);
const ICO = new THREE.IcosahedronGeometry(1, 0);
const DOME = new THREE.SphereGeometry(0.5, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
const box = (c, x, y, z, w, h, d, extra = {}) => part(BOX, c, { x, y: y + h / 2, z, sx: w, sy: h, sz: d, ...extra });
// Gable roof over a w × d footprint, always overhanging it. Ridge along Z, or along X with alongX.
const OVER = 0.35;
const gable = (c, x, y, z, w, d, rise, alongX = false) => part(ROOF, c, alongX
  ? { x, y, z, ry: Math.PI / 2, sx: d + OVER * 2, sy: rise, sz: w + OVER * 2 }
  : { x, y, z, sx: w + OVER * 2, sy: rise, sz: d + OVER * 2 });
const vault = (c, x, y, z, w, d, rise) => part(VAULT, c, { x, y, z, sx: w, sy: rise * 2, sz: d });
const wheel = (x, y, z, r, w = 0.3) => part(CYL8, C.black, { x, y, z, rz: Math.PI / 2, sx: r * 2, sy: w, sz: r * 2 });

// ---------- Builders: return arrays of geometries in prop-local space ----------
const builders = {
  house(p, r) {
    const parts = [];
    const { w, d, h } = p;
    const wallC = r() < 0.5 ? C.plaster : C.stone;
    parts.push(box(wallC, 0, 0, 0, w, h, d));
    parts.push(gable(r() < 0.5 ? C.roof : C.roofDark, 0, h, 0, w, d, 2.6, true));
    // Chimney: starts inside the roof slope, rises above the ridge line.
    parts.push(box(C.stoneDark, w * 0.25, h, d * 0.2, 0.9, 2.9, 0.9));
    const winY = Math.max(h * 0.45, 2.45); // above the door
    for (const sx of [-1, 1]) for (let i = -1; i <= 1; i++) if (winY + 1.2 < h) parts.push(box(0x2a2620, i * w * 0.28, winY, sx * (d / 2 + 0.02), 1.0, 1.2, 0.08));
    parts.push(box(C.woodDark, 0, 0, d / 2 + 0.04, 1.2, 2.2, 0.12));
    if (p.shop) {
      // Shop front: big window, sign board and a striped awning over the street.
      const awning = r() < 0.5 ? 0x7a2a22 : 0x2f5a3a;
      parts.push(box(C.glass, -w * 0.28, 0.4, d / 2 + 0.03, w * 0.34, 1.8, 0.08));
      parts.push(box(C.woodDark, 0, 2.3, d / 2 + 0.1, w * 0.8, 0.4, 0.2));
      for (let i = 0; i < 6; i++) parts.push(box(i % 2 ? awning : C.white, -w * 0.4 + (i + 0.5) * (w * 0.8) / 6, 2.4, d / 2 + 0.75, (w * 0.8) / 6, 0.08, 1.5, { rx: 0.35 }));
    }
    if (p.farm) parts.push(box(C.wood, -w / 2 - 1.2, 0, 0, 0.12, 1.1, d * 1.6), box(C.wood, w / 2 + 1.2, 0, 0, 0.12, 1.1, d * 1.6));
    return parts;
  },
  ruin(p, r) {
    const parts = [];
    const { w, d, h } = p;
    const c = r() < 0.5 ? C.stone : C.plaster;
    // Broken walls of uneven height, one side missing.
    parts.push(box(c, 0, 0, -d / 2 + 0.3, w, h, 0.6));
    parts.push(box(c, -w / 2 + 0.3, 0, 0.3, 0.6, h * 0.8, d - 0.6));
    parts.push(box(c, w * 0.25, 0, d / 2 - 0.3, w * 0.5, h * 0.55, 0.6));
    parts.push(box(c, w / 2 - 0.3, 0, -d * 0.2 + 0.3, 0.6, h * 0.4, d * 0.6 - 0.6));
    for (let i = 0; i < 4; i++) parts.push(box(c, -w / 2 + r() * w, h, -d / 2 + 0.3, 1 + r(), 0.6 + r() * 1.5, 0.56 + i * 0.03));
    // Exposed upper floor: half a slab hanging on, broken joists poking out.
    const fy = Math.min(h * 0.55, 2.8);
    parts.push(box(C.woodDark, -w * 0.18, fy, -d * 0.12, w * 0.6, 0.25, d * 0.7));
    for (let i = 0; i < 4; i++) parts.push(box(C.wood, -w * 0.4 + i * w * 0.16, fy - 0.2, d * 0.05, 0.22, 0.22, d * (0.5 + r() * 0.3)));
    parts.push(box(c, 0, 0, 0, w * 0.18, fy, 0.5, { ry: 0.2 })); // interior wall stub
    // Charred beams + rubble inside
    parts.push(box(C.burnt, 0, h * 0.4, 0, 0.3, 0.3, d * 1.05, { rx: 0.4 }));
    for (let i = 0; i < 6; i++) parts.push(part(TET, c, { x: (r() - 0.5) * w * 0.7, y: 0.4, z: (r() - 0.5) * d * 0.7, sx: 0.8 + r(), sy: 0.6 + r() * 0.6, sz: 0.8 + r(), ry: r() * 6 }));
    return parts;
  },
  wall(p, r) {
    const parts = [box(C.stone, 0, 0, 0, p.w, p.h, p.d)];
    for (let i = 0; i < 3; i++) parts.push(box(C.stoneDark, (r() - 0.5) * p.w * 0.8, p.h, 0, 0.8 + r() * 1.2, 0.3 + r() * 0.4, p.d * 1.02));
    return parts;
  },
  church(p) {
    const { w, d, h } = p;
    return [
      box(C.white, 0, 0, 0, w, h, d),
      gable(C.roofDark, 0, h, 0, w, d, 4.5),
      box(0x3a3832, 0, 2, -d / 2 - 0.02, 2.4, 4, 0.1),
      ...[-1, 1].flatMap((s) => [-5, 0, 5].map((z) => box(0x37414a, s * (w / 2 + 0.02), h * 0.45, z, 0.08, 3.2, 1.2))),
    ];
  },
  steeple(p) {
    const { w, h } = p;
    return [
      box(C.white, 0, 0, 0, w, h * 0.72, w),
      box(C.stone, 0, h * 0.72, 0, w * 0.85, h * 0.1, w * 0.85),
      part(CONE4, C.roofDark, { y: h * 0.82 + (h * 0.18) / 2, sx: w * 1.1, sy: h * 0.18, sz: w * 1.1, ry: Math.PI / 4 }),
      box(0x2a2620, 0, h * 0.55, w / 2 + 0.02, 1.8, 2.2, 0.08),
      box(0x2a2620, 0, h * 0.75, w * 0.43, 1.2, 1.6, 0.1), // belfry opening
      box(C.wood, 0, h, 0, 0.15, 1.8, 0.15),
      box(C.wood, 0, h + 1.0, 0, 0.9, 0.15, 0.2),
    ];
  },
  bunker(p) {
    const { w, d, h } = p;
    return [
      box(C.concrete, 0, 0, 0, w, h, d),
      box(C.concrete, 0, h, 0, w + 0.8, 0.5, d + 0.8),
      box(0x1e1e1c, 0, h * 0.55, d / 2 + 0.01, w * 0.6, 0.45, 0.1),
      part(ICO, C.sand, { y: h + 0.5, sx: w * 0.45, sy: 0.6, sz: d * 0.45 }),
    ];
  },
  obstower(p) {
    const { w, h } = p;
    const parts = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(box(C.wood, (sx * w) / 2.4, 0, (sz * w) / 2.4, 0.3, h, 0.3, { rz: -sx * 0.04, rx: sz * 0.04 }));
    for (let y = 2; y < h; y += 3.2) {
      parts.push(box(C.woodDark, 0, y, w / 2.4, w, 0.18, 0.15));
      parts.push(box(C.woodDark, 0, y, -w / 2.4, w, 0.18, 0.15));
    }
    parts.push(box(C.wood, 0, h, 0, w + 0.8, 0.3, w + 0.8));
    parts.push(box(C.woodDark, 0, h + 0.3, w / 2 + 0.3, w + 0.8, 1.0, 0.12));
    parts.push(part(CONE4, C.roofDark, { y: h + 2.7, sx: w + 1.2, sy: 1.4, sz: w + 1.2, ry: Math.PI / 4 }));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(box(C.wood, (sx * (w + 0.6)) / 2, h, (sz * (w + 0.6)) / 2, 0.15, 2.0, 0.15));
    return parts;
  },
  barn(p, r) {
    const { w, d, h } = p;
    const c = r() < 0.5 ? C.red : C.wood;
    return [
      box(c, 0, 0, 0, w, h * 0.62, d),
      gable(C.metal, 0, h * 0.62, 0, w, d, h * 0.38),
      box(C.woodDark, 0, 0, d / 2 + 0.02, w * 0.45, h * 0.5, 0.1),
      box(C.white, 0, h * 0.25, d / 2 + 0.03, w * 0.45, 0.25, 0.1, { rz: 0.6 }),
    ];
  },
  silo(p) {
    const { w, h } = p;
    return [part(CYL10, C.concrete, { y: h / 2, sx: w, sy: h, sz: w }), part(DOME, C.metal, { y: h, sx: w, sy: w * 0.6, sz: w }), box(C.rust, w / 2, 0, 0, 0.2, h, 0.6)];
  },
  fueltank(p) {
    const { w, d } = p;
    return [
      part(CYL10, C.fuel, { y: w / 2 + 0.6, rx: Math.PI / 2, sx: w, sy: d, sz: w }),
      box(C.rust, 0, 0, d * 0.3, w * 0.7, 0.8, 0.5),
      box(C.rust, 0, 0, -d * 0.3, w * 0.7, 0.8, 0.5),
      box(C.red, 0, w * 0.6, 0, w * 1.02, 0.4, 0.5),
    ];
  },
  wreck(p, r) {
    if (p.variant === 1) {
      // Burnt-out truck: cab, bare bed frame, wheels sunk in the mud.
      return [
        box(C.burnt, 0, 0.7, p.d * 0.32, p.w, 1.6, p.d * 0.28),
        box(0x2f2a25, 0, 0.7, -p.d * 0.15, p.w * 0.95, 0.25, p.d * 0.62),
        ...[-1, 1].flatMap((s) => [box(C.rust, s * p.w * 0.45, 0.95, -p.d * 0.15, 0.08, 0.6, p.d * 0.6)]),
        wheel(p.w / 2, 0.4, p.d * 0.3, 0.45), wheel(-p.w / 2, 0.35, p.d * 0.3, 0.45, 0.25), wheel(p.w / 2, 0.4, -p.d * 0.3, 0.45),
      ];
    }
    if (p.variant === 2) {
      // Overturned jeep.
      return [
        box(C.burnt, 0, 0.3, 0, p.w, 0.8, p.d, { rz: 2.6 }),
        box(0x2f2a25, 0.3, 0.1, p.d * 0.3, p.w * 0.9, 0.12, 0.6, { rz: 2.6 }),
        wheel(0.6, 1.0, p.d * 0.35, 0.35), wheel(0.6, 1.0, -p.d * 0.35, 0.35),
      ];
    }
    return [
      box(C.burnt, 0, 0.3, 0, p.w * 0.75, 0.9, p.d * 0.85),
      box(0x2f2a25, 0, 0, 0, p.w, 0.6, p.d * 0.9),
      part(CYL6, C.burnt, { x: (r() - 0.5) * 1.5, y: 1.45, z: -0.5, sx: 1.9, sy: 0.7, sz: 1.9, rz: 0.2 }),
      part(CYL6, 0x1a1816, { x: 1.4, y: 1.0, z: 1.6, sx: 0.18, sy: 3.2, sz: 0.18, rx: Math.PI / 2 - 0.5, rz: 0.4 }),
    ];
  },
  rock(p, r) {
    return [part(ICO, r() < 0.5 ? C.stoneDark : C.stone, { y: p.h * 0.35, sx: p.w / 2, sy: p.h / 2, sz: p.d / 2, ry: r() * 6 })];
  },
  tent(p) {
    return [part(ROOF, C.canvas, { sx: p.w, sy: p.h, sz: p.d }), box(C.woodDark, 0, 0, p.d / 2 - 0.1, 0.1, p.h * 1.05, 0.1)];
  },
  garage(p) {
    const { w, d, h } = p;
    return [
      box(C.concrete, 0, 0, 0, w, h, d),
      box(C.metal, 0, h, 0, w + 0.6, 0.4, d + 0.6),
      box(0x3a3d36, 0, 0, d / 2 + 0.02, w * 0.7, h * 0.75, 0.1),
      box(p.team === 'red' ? C.redTeam : C.blueTeam, 0, h * 0.8, d / 2 + 0.05, w * 0.3, 0.7, 0.06),
    ];
  },
  sandbags(p, r) {
    const parts = [];
    const n = Math.max(2, Math.round(p.w / 1.1));
    for (let row = 0; row < 2; row++) for (let i = 0; i < n - row; i++) {
      parts.push(part(BOX, C.sand, { x: -p.w / 2 + 0.55 + i * 1.1 + row * 0.55, y: 0.22 + row * 0.42, sx: 1.05, sy: 0.42, sz: 0.62, ry: (r() - 0.5) * 0.15 }));
    }
    return parts;
  },
  trench(p) {
    return [box(0x3b2f22, 0, -0.05, 0, p.w, 0.12, p.d), box(C.woodDark, 0, 0, p.d / 2, p.w, 0.35, 0.12), box(C.woodDark, 0, 0, -p.d / 2, p.w, 0.35, 0.12), box(C.sand, 0, 0, p.d / 2 + 0.6, p.w, 0.45, 0.9)];
  },
  wire(p) {
    const parts = [];
    const n = Math.round(p.w / 3);
    for (let i = 0; i <= n; i++) {
      const x = -p.w / 2 + (i * p.w) / n;
      parts.push(box(C.wire, x, 0, 0, 0.08, 1.1, 0.08, { rz: 0.5 }), box(C.wire, x, 0, 0, 0.08, 1.1, 0.08, { rz: -0.5 }));
    }
    for (const y of [0.35, 0.7]) parts.push(box(C.wire, 0, y, 0, p.w, 0.03, 0.03));
    for (let i = 0; i < n * 2; i++) parts.push(part(TET, C.wire, { x: -p.w / 2 + (i + 0.5) * (p.w / (n * 2)), y: 0.55, sx: 0.25, sy: 0.25, sz: 0.25, ry: i }));
    return parts;
  },
  crates(p, r) {
    const parts = [];
    const sizes = [];
    for (let i = 0; i < 4; i++) {
      const s = 0.9 + r() * 0.4;
      sizes.push(s);
      parts.push(box(r() < 0.5 ? C.wood : 0x5a6040, (i % 2) * 1.1 - 0.5, i > 1 ? sizes[i - 2] : 0, (r() - 0.5) * 0.3, s, s, s, { ry: i > 1 ? 0 : r() * 0.4 }));
    }
    return parts;
  },
  well(p) {
    return [
      part(CYL10, C.stone, { y: 0.45, sx: p.w, sy: 0.9, sz: p.w }),
      part(CYL10, 0x1d2a2c, { y: 0.92, sx: p.w * 0.8, sy: 0.04, sz: p.w * 0.8 }),
      box(C.wood, -p.w * 0.45, 0, 0, 0.15, 2.4, 0.15), box(C.wood, p.w * 0.45, 0, 0, 0.15, 2.4, 0.15),
      gable(C.roofDark, 0, 2.4, 0, p.w, p.w * 0.6, 0.7, true),
      part(CYL6, C.woodDark, { y: 1.9, rz: Math.PI / 2, sx: 0.2, sy: p.w * 0.9, sz: 0.2 }),
    ];
  },
  rubble(p, r) {
    const parts = [];
    for (let i = 0; i < 9; i++) {
      const s = 0.4 + r() * 1.1;
      parts.push(part(TET, [C.stone, C.stoneDark, C.plaster, C.burnt][i % 4], { x: (r() - 0.5) * p.w, y: s * 0.35, z: (r() - 0.5) * p.d, sx: s * 1.3, sy: s * 0.8, sz: s, ry: r() * 6 }));
    }
    parts.push(box(C.woodDark, 0, 0.3, 0, 0.2, 0.2, p.d * 1.1, { rx: 0.3, ry: r() }));
    return parts;
  },
  dugout(p) {
    const { w, d, h } = p;
    const parts = [part(ICO, 0x5b4a36, { y: h * 0.4, sx: w * 0.62, sy: h * 0.75, sz: d * 0.65 })];
    // Log walls and roof.
    for (let i = 0; i < 4; i++) parts.push(part(CYL6, C.wood, { y: 0.25 + i * 0.4, z: d / 2, rz: Math.PI / 2, sx: 0.4, sy: w, sz: 0.4 }));
    for (let i = 0; i < 7; i++) parts.push(part(CYL6, C.woodDark, { x: -w / 2 + (i + 0.5) * (w / 7), y: h, rx: Math.PI / 2, sx: 0.38, sy: d * 1.05, sz: 0.38 }));
    parts.push(box(0x161412, 0, 0.9, d / 2 + 0.05, w * 0.5, 0.35, 0.1));
    parts.push(box(C.sand, 0, h + 0.15, 0, w * 0.9, 0.35, d * 0.8));
    return parts;
  },
  mgnest(p) {
    const parts = [];
    const R = p.w / 2;
    for (let row = 0; row < 3; row++) for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + row * 0.25;
      if (a > 1.3 && a < 1.9) continue; // gap at the back
      parts.push(part(BOX, C.sand, { x: Math.cos(a) * R, y: 0.2 + row * 0.4, z: Math.sin(a) * R, sx: 1, sy: 0.38, sz: 0.6, ry: -a + Math.PI / 2 }));
    }
    parts.push(part(CYL6, C.black, { y: 1.35, z: -R * 0.5, rx: Math.PI / 2, sx: 0.09, sy: 1.6, sz: 0.09 })); // barrel
    parts.push(part(CYL8, C.metal, { y: 1.35, z: -R * 0.32, rx: Math.PI / 2, sx: 0.17, sy: 0.75, sz: 0.17 })); // water jacket
    parts.push(part(CYL6, C.black, { y: 1.35, z: -R * 0.5 - 0.78, rx: Math.PI / 2, sx: 0.14, sy: 0.14, sz: 0.14 })); // flash hider
    parts.push(box(C.black, 0, 1.1, -R * 0.1, 0.3, 0.3, 0.6));
    parts.push(box(C.olive, 0.26, 1.02, -R * 0.1, 0.2, 0.26, 0.32), box(0xb8923e, 0.13, 1.26, -R * 0.1, 0.1, 0.03, 0.22)); // ammo box and belt
    parts.push(box(C.black, 0, 1.4, -R * 0.02, 0.03, 0.14, 0.03), box(C.black, 0, 1.05, -R * 0.1 + 0.3, 0.16, 0.14, 0.03)); // sight and grips
    for (const s of [-1, 1]) parts.push(box(C.black, s * 0.25, 0, -R * 0.2, 0.05, 1.25, 0.05, { rz: s * 0.25 }));
    return parts;
  },
  hedgehog() {
    const beam = (rx, ry, rz) => part(BOX, 0x3a3632, { y: 0.8, rx, ry, rz, sx: 0.22, sy: 2.2, sz: 0.22 });
    return [beam(0.95, 0, 0), beam(0, 0, 0.95), beam(0.95, Math.PI / 2, 0.7)];
  },
  radio(p) {
    const { w, d, h } = p;
    return [
      box(C.olive, 0, 0, 0, w, h, d),
      gable(C.canvas, 0, h, 0, w, d, 0.8),
      part(CYL6, C.metal, { x: w * 0.42, y: 6, sx: 0.12, sy: 12, sz: 0.12 }),
      ...[4, 7, 10].map((y) => box(C.metal, w * 0.42, y, 0, 1.4 - y * 0.08, 0.06, 0.06)),
      box(C.wire, w * 0.42, 0, 0.6, 0.03, 12, 0.03, { rx: -0.05 }),
      part(DOME, 0xbab8b0, { x: -w * 0.2, y: h + 0.6, z: 0, rx: -1.2, sx: 1.4, sy: 0.4, sz: 1.4 }),
      box(C.black, w * 0.25, h * 0.4, d / 2 + 0.03, 0.8, 0.6, 0.06),
    ];
  },
  factory(p) {
    const { w, d, h } = p;
    const parts = [box(C.brick, 0, 0, 0, w, h * 0.7, d)];
    // Saw-tooth roof
    for (let i = 0; i < 4; i++) parts.push(part(ROOF, C.metal, { x: -w / 2 + (i + 0.5) * (w / 4), y: h * 0.7, sx: w / 4, sy: h * 0.3, sz: d, rz: 0.0 }));
    for (let i = 0; i < 6; i++) parts.push(box(C.glass, -w / 2 + (i + 0.5) * (w / 6), h * 0.35, d / 2 + 0.03, w / 9, h * 0.22, 0.06));
    for (let i = 0; i < 6; i++) parts.push(box(C.glass, -w / 2 + (i + 0.5) * (w / 6), h * 0.35, -d / 2 - 0.03, w / 9, h * 0.22, 0.06));
    parts.push(box(C.metal, w * 0.3, 0, d / 2 + 0.05, 5, 4.5, 0.12));
    parts.push(box(C.burnt, -w * 0.2, h * 0.6, d / 2 + 0.05, 4, 2.4, 0.1)); // shell hole
    return parts;
  },
  chimney(p) {
    return [part(TAPER, C.brick, { y: p.h / 2, sx: p.w * 1.2, sy: p.h, sz: p.w * 1.2 }), part(CYL8, C.burnt, { y: p.h - 0.4, sx: p.w * 0.95, sy: 0.8, sz: p.w * 0.95 }), box(C.stoneDark, 0, 0, 0, p.w * 1.6, 1.5, p.w * 1.6)];
  },
  warehouse(p) {
    const { w, d, h } = p;
    return [
      box(C.concrete, 0, 0, 0, w, h * 0.65, d),
      vault(C.metal, 0, h * 0.65, 0, w + OVER, d + OVER * 2, h * 0.35),
      box(0x3a3d36, 0, 0, d / 2 + 0.03, w * 0.4, h * 0.55, 0.08),
      box(0x3a3d36, 0, 0, -d / 2 - 0.03, w * 0.4, h * 0.55, 0.08),
      box(C.rust, w / 2 + 0.02, h * 0.3, 0, 0.05, 0.6, d * 0.6),
    ];
  },
  watertower(p) {
    const { w, h } = p;
    const parts = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(box(C.metal, sx * w * 0.35, 0, sz * w * 0.35, 0.25, h * 0.7, 0.25, { rz: -sx * 0.05, rx: sz * 0.05 }));
    for (const y of [h * 0.25, h * 0.5]) parts.push(box(C.metal, 0, y, 0, w * 0.75, 0.1, 0.1, { ry: 0.78 }), box(C.metal, 0, y, 0, w * 0.75, 0.1, 0.1, { ry: -0.78 }));
    parts.push(part(CYL10, C.rust, { y: h * 0.82, sx: w * 1.2, sy: h * 0.3, sz: w * 1.2 }));
    parts.push(part(CONE8, C.metal, { y: h * 1.02, sx: w * 1.3, sy: h * 0.12, sz: w * 1.3 }));
    return parts;
  },
  loco(p) {
    const { w, d } = p;
    return [
      box(C.black, 0, 0.6, 0, w * 0.9, 0.6, d),
      part(CYL10, 0x26282a, { y: 2.2, z: d * 0.12, rx: Math.PI / 2, sx: w * 0.8, sy: d * 0.65, sz: w * 0.8 }),
      box(0x26282a, 0, 1.2, -d * 0.35, w, 2.9, d * 0.28),
      box(C.red, 0, 4.1, -d * 0.35, w * 1.05, 0.15, d * 0.3),
      part(CYL8, C.black, { y: 3.6, z: d * 0.38, sx: 0.6, sy: 1.6, sz: 0.6 }),
      part(CYL8, C.black, { y: 3.4, z: 0, sx: 0.7, sy: 0.6, sz: 0.7 }),
      ...[-0.35, -0.1, 0.15, 0.35].flatMap((t) => [wheel(w * 0.45, 0.55, d * t, 0.55, 0.2), wheel(-w * 0.45, 0.55, d * t, 0.55, 0.2)]),
    ];
  },
  wagon(p) {
    const { w, d, h } = p;
    const parts = [box(C.black, 0, 0.6, 0, w * 0.9, 0.3, d)];
    if (p.variant === 1) {
      parts.push(part(CYL10, 0x55524a, { y: 2.2, rx: Math.PI / 2, sx: w * 0.95, sy: d * 0.85, sz: w * 0.95 }));
    } else {
      parts.push(box(C.wood, 0, 0.9, 0, w, h - 0.9, d * 0.95));
      parts.push(vault(C.metal, 0, h, 0, w + 0.1, d * 0.95 + 0.2, 0.3));
      parts.push(box(C.woodDark, w / 2 + 0.02, 1.0, 0, 0.05, h - 1.3, 2.2));
    }
    for (const t of [-0.32, 0.32]) parts.push(wheel(w * 0.42, 0.45, d * t, 0.45, 0.18), wheel(-w * 0.42, 0.45, d * t, 0.45, 0.18));
    return parts;
  },
  barrels(p, r) {
    const parts = [];
    const cols = [0x55603f, 0x7b4a2e, 0x3d4a5a, 0x8a3a2a];
    for (let i = 0; i < 7; i++) {
      const row = i < 4 ? 0 : 1;
      const x = row ? (i - 5) * 0.65 : (i - 1.5) * 0.65;
      parts.push(part(CYL8, cols[Math.floor(r() * 4)], { x, y: 0.45 + row * 0.9, z: (r() - 0.5) * 0.3, sx: 0.6, sy: 0.9, sz: 0.6 }));
    }
    return parts;
  },
  windmill(p) {
    const { w, h } = p;
    return [
      part(TAPER, C.white, { y: h * 0.4, sx: w, sy: h * 0.8, sz: w }),
      part(CONE8, C.roofDark, { y: h * 0.8 + 1.2, sx: w * 0.9, sy: 2.6, sz: w * 0.9 }),
      box(C.woodDark, 0, 0, w * 0.48, 1.2, 2.2, 0.15),
      box(0x2a2620, 0, h * 0.45, w * 0.415, 0.7, 0.9, 0.12),
      box(C.wood, 0, 0, w * 0.55, 2.4, 0.15, 1.2),
      part(CYL6, C.woodDark, { y: h * 0.78, z: w * 0.42, rx: Math.PI / 2, sx: 0.45, sy: w * 0.3, sz: 0.45 }),
    ];
  },
  chapel(p) {
    const { w, d, h } = p;
    return [
      box(C.plaster, 0, 0, 0, w, h * 0.65, d),
      gable(C.roof, 0, h * 0.65, 0, w, d, h * 0.35),
      box(C.plaster, 0, 0, d / 2 - 1.05, 2.4, h * 1.25, 2.4),
      part(CONE4, C.roofDark, { x: 0, y: h * 1.25 + 1.1, z: d / 2 - 1.05, sx: 2.6, sy: 2.2, sz: 2.6, ry: Math.PI / 4 }),
      box(C.wood, 0, h * 1.25 + 2.1, d / 2 - 1.05, 0.12, 1.3, 0.12),
      box(C.wood, 0, h * 1.25 + 2.6, d / 2 - 1.05, 0.6, 0.12, 0.12),
      box(C.woodDark, 0, 0, d / 2 + 0.18, 1.2, 2.2, 0.08),
      ...[-1, 1].map((s) => box(0x37414a, s * (w / 2 + 0.02), h * 0.3, 0, 0.06, 1.6, 0.8)),
    ];
  },
  gasstation(p) {
    const { w, d, h } = p;
    return [
      box(C.white, -w * 0.2, 0, -d * 0.2, w * 0.55, h * 0.75, d * 0.55),
      box(C.glass, -w * 0.2, 0.6, d * 0.08 + 0.02, w * 0.4, 1.5, 0.06),
      box(C.red, 0, h, 0, w, 0.35, d),
      ...[[1, 1], [1, -1]].map(([sx, sz]) => box(C.metal, sx * w * 0.42, 0, sz * d * 0.35, 0.25, h, 0.25)),
      box(C.white, -w * 0.2, h * 0.75, -d * 0.2, 0.3, h * 0.25, 0.3), // the shop holds the canopy up too
      ...[-0.5, 0.5].flatMap((t) => [box(C.red, w * 0.2, 0, t * d * 0.5, 0.6, 1.5, 0.45), box(C.white, w * 0.2, 1.1, t * d * 0.5 + 0.23, 0.4, 0.3, 0.03)]),
      box(C.metal, w * 0.55, 0, d * 0.55, 0.15, 5, 0.15),
      box(C.red, w * 0.55, 4.2, d * 0.55, 1.6, 1.0, 0.12),
    ];
  },
  checkpoint(p) {
    const { w, d } = p;
    return [
      box(C.wood, -w * 0.35, 0, 0, 2, 2.3, 2),
      gable(C.roofDark, -w * 0.35, 2.3, 0, 2, 2, 0.6),
      box(C.white, w * 0.1, 0.95, 0, w * 0.5, 0.15, 0.15, { rz: 0.5 }),
      box(C.red, w * 0.3, 1.1, 0.01, w * 0.12, 0.17, 0.17, { rz: 0.5 }),
      box(C.wood, -w * 0.12, 0, 0, 0.25, 1.1, 0.25),
      ...[0, 1, 2].map((i) => part(BOX, C.sand, { x: w * 0.25 + i * 1.1, y: 0.22, z: d * 0.4, sx: 1.05, sy: 0.42, sz: 0.6 })),
      part(CYL8, 0x55603f, { x: w * 0.42, y: 0.45, z: -d * 0.35, sx: 0.6, sy: 0.9, sz: 0.6 }),
    ];
  },
  truck(p) {
    const { w, d } = p;
    const team = p.team === 'red' ? C.redTeam : C.blueTeam;
    return [
      box(C.olive, 0, 0.8, d * 0.33, w, 1.6, d * 0.26),
      box(C.glass, 0, 1.6, d * 0.46 + 0.02, w * 0.8, 0.55, 0.05),
      box(C.olive, 0, 0.7, -d * 0.14, w * 0.95, 0.25, d * 0.68),
      vault(C.canvas, 0, 0.95, -d * 0.15, w, d * 0.62, 1.1),
      box(team, 0, 1.3, d * 0.46 + 0.03, 0.4, 0.3, 0.02),
      wheel(w / 2, 0.45, d * 0.32, 0.45), wheel(-w / 2, 0.45, d * 0.32, 0.45), wheel(w / 2, 0.45, -d * 0.3, 0.45), wheel(-w / 2, 0.45, -d * 0.3, 0.45),
    ];
  },
  radardish(p) {
    return [box(C.concrete, 0, 0, 0, p.w, 0.6, p.d), part(CYL8, C.metal, { y: 3.1, sx: 0.5, sy: 5, sz: 0.5 }), box(C.olive, 0, 0.6, 0, 1.6, 1.5, 1.6)];
  },
  // ---------- Airfields ----------
  runway(p) {
    const { w, d } = p;
    const parts = [box(0x4b4a44, 0, -0.02, 0, w, 0.1, d), box(0x57564d, 0, -0.02, d / 2 + 4, w, 0.08, 8), box(0x57564d, 0, -0.02, -d / 2 - 4, w, 0.08, 8)];
    // Centre line and threshold stripes.
    for (let x = -w / 2 + 20; x < w / 2 - 12; x += 22) parts.push(box(C.white, x, 0.08, 0, 11, 0.02, 0.8));
    for (const s of [-1, 1]) for (let i = -3; i <= 3; i++) if (i) parts.push(box(C.white, s * (w / 2 - 12), 0.08, i * 3.6, 16, 0.02, 1.6));
    return parts;
  },
  hangar(p) {
    const { w, d, h } = p;
    const parts = [
      // Corrugated arch on low walls, big open door facing the runway.
      box(C.metal, 0, 0, -d / 2 + 0.3, w, h * 0.5, 0.6),
      box(C.metal, -w / 2 + 0.3, 0, 0, 0.6, h * 0.5, d - 1.2),
      box(C.metal, w / 2 - 0.3, 0, 0, 0.6, h * 0.5, d - 1.2),
      vault(C.olive, 0, h * 0.5, 0, w + OVER, d + OVER, h * 0.5),
      box(0x262720, 0, 0.02, d * 0.08, w * 0.92, 0.04, d * 0.8),
      box(C.olive, -w * (p.big ? 0.47 : 0.36), 0, d / 2 - 0.2, 2.4, h * 0.5, 0.4),
      box(C.olive, w * (p.big ? 0.47 : 0.36), 0, d / 2 - 0.2, 2.4, h * 0.5, 0.4),
      box(p.team === 'red' ? C.redTeam : C.blueTeam, p.big ? w * 0.3 : 0, h * 0.52, d / 2 + 0.05, w * 0.3, p.big ? 3 : 1.2, 0.1),
      // The inside: a plane starts in here, and the arch above is only visible from outside.
      box(0x3a3d34, 0, h * 0.72, 0, w * 0.88, 0.25, d - 0.5),
      ...[-0.3, -0.1, 0.1, 0.3].map((k) => box(0x8d9084, 0, h * 0.72 - (p.big ? 1.6 : 0.7), d * k, w * 0.88, p.big ? 1.6 : 0.7, p.big ? 1 : 0.45)),
      box(C.metal, -w * 0.44, h * 0.5, 0, 0.4, h * 0.22, d - 0.5),
      box(C.metal, w * 0.44, h * 0.5, 0, 0.4, h * 0.22, d - 0.5),
      box(C.metal, 0, h * 0.5, -d / 2 + 0.4, w * 0.88, h * 0.22, 0.4),
      // Over the door; the big one's stays open in the middle for a tall tail.
      ...(p.big ? [-1, 1].map((s) => box(C.olive, s * w * 0.3, h * 0.5, d / 2 - 0.3, w * 0.28, h * 0.22, 0.3)) : [box(C.olive, 0, h * 0.5, d / 2 - 0.3, w * 0.88, h * 0.22, 0.3)]),
    ];
    return parts;
  },
  ctower(p) {
    const { w, h } = p;
    const deck = h * 0.75;
    const parts = [
      box(C.plaster, 0, 0, 0, w, deck, w),
      box(C.stoneDark, 0, deck, 0, w + 1.6, 0.25, w + 1.6),
      box(C.glass, 0, deck + 0.25, 0, w * 0.82, h * 0.2, w * 0.82),
      box(C.roofDark, 0, deck + 0.25 + h * 0.2, 0, w + 0.8, 0.3, w + 0.8),
      box(C.metal, w * 0.3, deck + 0.25 + h * 0.2 + 0.3, 0, 0.12, 3.5, 0.12),
    ];
    for (let y = 2; y < deck - 1; y += 3) parts.push(box(0x2a2620, 0, y, w / 2 + 0.02, 1.4, 1.5, 0.08));
    parts.push(box(C.woodDark, -w * 0.25, 0, w / 2 + 0.03, 1.2, 2.2, 0.1));
    return parts;
  },
  windsock(p) {
    return [
      part(CYL6, C.white, { y: p.h / 2, sx: 0.12, sy: p.h, sz: 0.12 }),
      part(TAPER, 0xd8622a, { y: p.h - 0.1, z: 1.05, rx: Math.PI / 2 - 0.1, sx: 0.65, sy: 2.1, sz: 0.65 }),
    ];
  },
  aagun(p) {
    // Sandbag ring with the AA gun pointing up, one barrel per side.
    const parts = [];
    const R = p.w / 2;
    for (let row = 0; row < 2; row++) for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + row * 0.3;
      parts.push(part(BOX, C.sand, { x: Math.cos(a) * R, y: 0.2 + row * 0.38, z: Math.sin(a) * R, sx: 1.05, sy: 0.38, sz: 0.55, ry: -a + Math.PI / 2 }));
    }
    // Pedestal, turning platform, seat and handwheels.
    parts.push(box(C.olive, 0, 0, 0, 1.3, 0.3, 1.3), part(CYL8, C.metal, { y: 0.55, sx: 0.6, sy: 0.5, sz: 0.6 }), part(CYL8, C.olive, { y: 0.84, sx: 1.2, sy: 0.08, sz: 1.2 }));
    parts.push(box(C.olive, 0, 0.88, 0, 0.75, 0.72, 0.55), box(C.metal, 0, 0.88, -0.5, 0.42, 0.06, 0.34), box(C.metal, 0, 0.88, -0.4, 0.06, 0.2, 0.06));
    for (const s of [-1, 1]) parts.push(part(CYL8, C.black, { x: s * 0.4, y: 1.2, z: -0.1, rz: Math.PI / 2, sx: 0.34, sy: 0.05, sz: 0.34 }));
    // Twin barrels, angled up: each with cooling jacket, breech, flash hider and ammo clips.
    for (const s of [-1, 1]) {
      const along = (d, h) => ({ x: s * 0.2, y: 1.45 + Math.sin(0.72) * d + h, z: 0.15 + Math.cos(0.72) * d });
      parts.push(part(CYL6, C.black, { ...along(1.35, 0), rx: 0.85, sx: 0.09, sy: 2.5, sz: 0.09 }));
      parts.push(part(CYL8, C.metal, { ...along(0.7, 0), rx: 0.85, sx: 0.18, sy: 1, sz: 0.18 }));
      parts.push(part(CYL6, C.black, { ...along(2.62, 0), rx: 0.85, sx: 0.17, sy: 0.22, sz: 0.17 }));
      parts.push(part(BOX, C.olive, { ...along(0, 0), rx: 0.85, sx: 0.2, sy: 0.6, sz: 0.3 }));
      parts.push(part(BOX, C.rust, { ...along(-0.05, 0.28), rx: 0.85, sx: 0.12, sy: 0.32, sz: 0.2 }));
    }
    // Ring sight between the barrels, ammo crates at the crew's feet.
    parts.push(box(C.black, 0, 1.5, 0.6, 0.04, 0.5, 0.04), part(CYL8, C.black, { y: 2.1, z: 0.6, rx: Math.PI / 2, sx: 0.36, sy: 0.02, sz: 0.36 }));
    for (const [x, z] of [[-1, -0.9], [-0.55, -1.15], [1, -0.85]]) parts.push(box(C.olive, x, 0, z, 0.42, 0.3, 0.26));
    return parts;
  },
  // ---------- Fortress Defence ----------
  fwall(p) {
    const { w, d, h } = p;
    const parts = [box(C.stone, 0, 0, 0, w, h, d), box(C.stoneDark, 0, 0, 0, w + 0.05, 0.5, d + 0.3)];
    // Crenellations on both faces.
    for (const sz of [-1, 1]) for (let i = 0; i < 4; i++) parts.push(box(i % 2 ? C.stone : C.stoneDark, -w / 2 + 1.25 + i * 2.5, h, sz * (d / 2 - 0.35), 1.3, 0.7, 0.7));
    return parts;
  },
  fgate(p) {
    const { w, d, h } = p;
    const parts = [];
    for (const sx of [-1, 1]) {
      parts.push(box(C.woodDark, sx * w * 0.25, 0, 0, w / 2, h, d * 0.6));
      for (const y of [0.5, h - 0.8]) parts.push(box(C.black, sx * w * 0.25, y, 0, w / 2 - 0.2, 0.25, d * 0.66));
    }
    parts.push(box(C.stoneDark, 0, h, 0, w + 1, 0.8, d + 0.4));
    return parts;
  },
  ftower(p) {
    const { w, h } = p;
    const parts = [box(C.stone, 0, 0, 0, w, h, w), box(C.stoneDark, 0, h, 0, w + 1, 0.4, w + 1)];
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]]) parts.push(box(C.stone, sx * (w / 2), h + 0.4, sz * (w / 2), 1, 0.9, 1));
    for (const sz of [-1, 1]) parts.push(box(0x1e1e1c, 0, h * 0.6, sz * (w / 2 + 0.01), 0.3, 1.2, 0.08));
    parts.push(part(CONE4, C.roofDark, { y: h + 1.6, sx: w * 0.9, sy: 2.2, sz: w * 0.9, ry: Math.PI / 4 }));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(box(C.wood, sx * w * 0.35, h + 0.4, sz * w * 0.35, 0.2, 1.3, 0.2));
    return parts;
  },
  fbunker(p) {
    return builders.bunker(p);
  },
  hulldown(p) {
    const { w, d, h } = p;
    // Earth berm with sloped faces and short side arms; a tank parks behind it.
    return [
      box(0x5a4a32, 0, 0, 0, w, h, d),
      box(0x6b5a3c, 0, 0, d / 2 + 0.6, w, h * 0.6, 1.2, { rx: -0.5 }),
      box(0x5a4a32, -w / 2, 0, -d * 0.9, 1.4, h * 0.8, d * 1.8),
      box(0x5a4a32, w / 2, 0, -d * 0.9, 1.4, h * 0.8, d * 1.8),
      box(C.sand, 0, h, 0, w * 0.9, 0.35, d * 0.6),
    ];
  },
  depot(p) {
    const { w, d, h } = p;
    const parts = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(box(C.metal, sx * (w / 2 - 0.3), 0, sz * (d / 2 - 0.3), 0.35, h, 0.35));
    parts.push(box(C.canvas, 0, h, 0, w + 0.6, 0.3, d + 0.6));
    parts.push(box(0xc9b23a, 0, 0.02, d / 2 - 0.5, w * 0.9, 0.05, 0.3)); // yellow bay line
    for (let i = 0; i < 5; i++) parts.push(box(C.olive, -w / 2 + 1.2 + i * 1.3, 0, -d / 2 + 1, 1.1, 0.8, 1.1)); // ammo crates
    for (let i = 0; i < 4; i++) parts.push(part(CYL8, C.rust, { x: w / 2 - 1.2, y: 0.55, z: -d / 2 + 1.2 + i * 1.1, sx: 0.9, sy: 1.1, sz: 0.9 }));
    parts.push(box(C.metal, 0, h - 1.15, -d / 2 + 0.3, w - 0.6, 0.2, 0.2)); // beam between the posts
    parts.push(box(C.blueTeam, 0, h - 1, -d / 2 + 0.3, w * 0.4, 0.8, 0.1)); // depot sign
    return parts;
  },
  command(p) {
    const { w, d, h } = p;
    const parts = [
      box(C.concrete, 0, 0, 0, w, h, d),
      box(C.concrete, 0, h, 0, w + 1, 0.6, d + 1),
      part(ICO, C.sand, { y: h + 0.6, sx: w * 0.45, sy: 0.9, sz: d * 0.45 }),
      box(0x1e1e1c, 0, h * 0.5, d / 2 + 0.01, w * 0.5, 0.5, 0.1),
      box(C.woodDark, 0, 0, -d / 2 - 0.05, 1.4, 2.2, 0.1),
      box(C.metal, w * 0.3, h + 0.6, 0, 0.15, 7, 0.15), // radio mast
      box(C.metal, w * 0.3, h + 6.2, 0, 2.2, 0.08, 0.08),
    ];
    for (let i = 0; i < 6; i++) parts.push(box(C.sand, -w / 2 + 1 + i * (w - 2) / 5, 0, d / 2 + 1.4, 2, 0.9, 0.8));
    return parts;
  },
  artillery(p) {
    // Carriage + trails only; the barrel is a separate animated mesh.
    const { w, d } = p;
    return [
      box(C.olive, 0, 0.7, 0, w * 0.6, 0.5, 1.4),
      box(C.olive, 0, 1.1, 0.5, w * 0.8, 1.0, 0.12, { rx: -0.2 }),
      ...[-1, 1].map((s) => box(C.olive, s * 0.5, 0, -d * 0.3, 0.2, 0.8, d * 0.65, { ry: s * 0.25 })),
      wheel(w / 2, 0.6, 0, 0.6, 0.25), wheel(-w / 2, 0.6, 0, 0.6, 0.25),
      ...[0, 1].map((i) => part(BOX, C.sand, { x: -w * 0.6 + i * 1.2, y: 0.22, z: d * 0.35, sx: 1.05, sy: 0.42, sz: 0.6 })),
    ];
  },
};

function rubbleGeo(p, r) {
  const parts = [];
  const n = Math.min(14, 4 + Math.round((p.w * p.d) / 10));
  const c = ['barn', 'dugout', 'wagon', 'radio'].includes(p.type) ? C.wood : ['fueltank', 'gasstation', 'truck', 'barrels'].includes(p.type) ? C.burnt : p.type === 'factory' || p.type === 'chimney' ? C.brick : C.stone;
  for (let i = 0; i < n; i++) {
    const s = 0.5 + r() * 1.4;
    parts.push(part(TET, i % 3 === 0 ? C.burnt : c, { x: (r() - 0.5) * p.w * 0.8, y: s * 0.3, z: (r() - 0.5) * p.d * 0.8, sx: s * 1.4, sy: s * 0.8, sz: s, ry: r() * 6 }));
  }
  if (p.type === 'house' || p.type === 'ruin' || p.type === 'chapel' || p.type === 'factory') parts.push(box(c, -p.w * 0.3, 0, 0, 0.6, p.h * 0.35, p.d * 0.7));
  return mergeGeometries(parts);
}

// Lowest and highest ground under a prop's footprint.
function groundSpan(p) {
  let lo = Infinity, hi = -Infinity;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) {
    const cx = p.x + (sx * p.w * 0.52 * Math.cos(p.rot) + sz * p.d * 0.52 * Math.sin(p.rot));
    const cz = p.z + (-sx * p.w * 0.52 * Math.sin(p.rot) + sz * p.d * 0.52 * Math.cos(p.rot));
    const g = groundAt(cx, cz);
    lo = Math.min(lo, g);
    hi = Math.max(hi, g);
  }
  return [lo, hi];
}

// Buildings stand on the middle of the slope, on a plinth that goes well into the ground,
// so no corner floats and no wall is buried up to its windows.
const FOUNDATION = {
  house: C.stoneDark, ruin: C.stoneDark, wall: C.stoneDark, church: C.stoneDark, steeple: C.stoneDark, bunker: C.concrete, barn: C.stoneDark, silo: C.concrete,
  garage: C.concrete, factory: C.stoneDark, warehouse: C.concrete, chapel: C.stoneDark, gasstation: C.concrete, radio: C.olive, fwall: C.stoneDark,
  ftower: C.stoneDark, fgate: C.stoneDark, fbunker: C.concrete, command: C.concrete, windmill: C.stoneDark, watertower: C.concrete, chimney: C.stoneDark,
};
function baseY(p) {
  const [lo, hi] = groundSpan(p);
  return FOUNDATION[p.type] ? lo + (hi - lo) * 0.5 : lo - 0.05;
}
function foundation(p, y) {
  const c = FOUNDATION[p.type];
  if (!c) return null;
  const [lo] = groundSpan(p);
  const depth = y - lo + 0.8;
  return box(c, 0, -depth, 0, p.w + 0.3, depth + 0.18, p.d + 0.3);
}

// One geometry per prop, in prop-local space, parts included (also used by the dev check).
export const propParts = (p, r) => builders[p.type](p, r);

const chunkKey = (x, z) => `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;

export class PropsView {
  constructor(scene) {
    this.scene = scene;
    this.dead = new Set();
    this.burning = [];
    this.animated = [];
    this.flames = [];
    this.chunks = new Map(); // key -> { ids: [], mesh }
    this.worldGeo = new Map(); // prop id -> world-space geometry
    this.baseYs = new Map();

    const xf = new THREE.Matrix4();
    for (const p of PROPS) {
      const r = mulberry32(p.id * 7919 + 13);
      const y = baseY(p);
      const parts = builders[p.type](p, r);
      const base = foundation(p, y);
      if (base) parts.push(base);
      const geo = mergeGeometries(parts);
      this.baseYs.set(p.id, y);
      xf.compose(new THREE.Vector3(p.x, y, p.z), new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, p.rot), new THREE.Vector3(1, 1, 1));
      geo.applyMatrix4(xf);
      this.worldGeo.set(p.id, geo);
      const k = chunkKey(p.x, p.z);
      if (!this.chunks.has(k)) this.chunks.set(k, { ids: [], mesh: null });
      this.chunks.get(k).ids.push(p.id);
      if (p.type === 'wreck' && p.burning) this.addFire(p.x, y + p.h * 0.7, p.z, r() < 0.5);
      this.addAnimated(p, y);
    }
    for (const k of this.chunks.keys()) this.rebuildChunk(k);

    this.buildCraters();
    this.buildRails();
    this.buildZones();
    this.buildFlames();
    this.vegetation = new Vegetation(scene);
    this.artilleryT = 4;
  }

  rebuildChunk(k) {
    const ch = this.chunks.get(k);
    if (ch.mesh) {
      this.scene.remove(ch.mesh);
      ch.mesh.geometry.dispose();
    }
    const geos = ch.ids.filter((id) => !this.dead.has(id)).map((id) => this.worldGeo.get(id));
    if (!geos.length) {
      ch.mesh = null;
      return;
    }
    ch.mesh = new THREE.Mesh(mergeGeometries(geos), MAT);
    ch.mesh.castShadow = true;
    ch.mesh.receiveShadow = true;
    ch.mesh.geometry.computeBoundingSphere();
    const bs = ch.mesh.geometry.boundingSphere;
    // A rebuilt chunk keeps its culling entry.
    if (ch.cull) ch.cull.mesh = ch.mesh;
    else ch.cull = markCullable(this.scene, ch.mesh, bs.center.x, bs.center.z, bs.radius);
    this.scene.add(ch.mesh);
  }

  addAnimated(p, y) {
    const place = (obj, h = 0) => {
      obj.position.set(p.x, y + h, p.z);
      obj.rotation.y = p.rot;
      obj.traverse((o) => {
        if (o.isMesh) o.castShadow = o.receiveShadow = true;
      });
      this.scene.add(obj);
    };
    if (p.type === 'windmill') {
      const hub = new THREE.Group();
      const sails = new THREE.Mesh(mergeGeometries([0, 1, 2, 3].flatMap((i) => {
        const a = (i * Math.PI) / 2;
        return [part(BOX, C.wood, { x: Math.sin(a) * 3.6, y: Math.cos(a) * 3.6, rz: -a, sx: 0.25, sy: 7.2, sz: 0.15 }), part(BOX, C.white, { x: Math.sin(a) * 4.2 + Math.cos(a) * 0.6, y: Math.cos(a) * 4.2 - Math.sin(a) * 0.6, rz: -a, sx: 1.1, sy: 5.2, sz: 0.06 })];
      })), MAT);
      sails.position.set(0, p.h * 0.78, p.w * 0.55);
      hub.add(sails);
      place(hub);
      this.animated.push({ obj: hub, update: (t) => (sails.rotation.z = t * 0.6), p });
    } else if (p.type === 'radardish') {
      const head = new THREE.Group();
      const dish = new THREE.Mesh(mergeGeometries([part(DOME, 0xbab8b0, { rx: -Math.PI / 2 + 0.3, sx: 4.2, sy: 1.2, sz: 4.2, z: 0.4 }), part(CYL6, C.metal, { z: 1.1, rx: Math.PI / 2 + 0.3, sx: 0.1, sy: 1.6, sz: 0.1 })]), MAT);
      head.add(dish);
      head.position.y = 5.6;
      const g = new THREE.Group();
      g.add(head);
      place(g);
      this.animated.push({ obj: g, update: (t) => (head.rotation.y = t * 0.8), p });
    } else if (p.type === 'artillery') {
      const pivot = new THREE.Group();
      const barrel = new THREE.Mesh(mergeGeometries([
      part(CYL8, C.olive, { z: 2, rx: Math.PI / 2, sx: 0.3, sy: 4.4, sz: 0.3 }),
      part(CYL8, C.metal, { z: 0.85, rx: Math.PI / 2, sx: 0.42, sy: 1.9, sz: 0.42 }), // thick chase
      part(CYL8, C.olive, { z: 0, rx: Math.PI / 2, sx: 0.6, sy: 1.2, sz: 0.6 }), // breech ring
      part(BOX, C.metal, { z: -0.7, sx: 0.5, sy: 0.5, sz: 0.3 }), // breech block
      part(BOX, C.black, { x: 0.32, z: -0.7, rz: 0.5, sx: 0.08, sy: 0.4, sz: 0.08 }), // breech lever
      part(CYL6, C.metal, { y: 0.34, z: 0.5, rx: Math.PI / 2, sx: 0.16, sy: 1.8, sz: 0.16 }), // recoil cylinders
      part(CYL6, C.metal, { y: -0.34, z: 0.5, rx: Math.PI / 2, sx: 0.16, sy: 1.8, sz: 0.16 }),
      part(BOX, C.olive, { z: 4.05, sx: 0.62, sy: 0.46, sz: 0.1 }), // baffled muzzle brake
      part(BOX, C.olive, { z: 4.32, sx: 0.62, sy: 0.46, sz: 0.1 }),
      part(BOX, C.olive, { z: 4.19, sx: 0.2, sy: 0.46, sz: 0.34 }),
    ]), MAT);
      pivot.add(barrel);
      pivot.position.y = 1.3;
      pivot.rotation.x = -0.55;
      const g = new THREE.Group();
      g.add(pivot);
      place(g);
      this.animated.push({ obj: g, kind: 'artillery', barrel, pivot, recoil: 0, p, team: p.team });
    }
  }

  addFire(x, y, z, big) {
    this.burning.push({ x, y, z, t: Math.random() * 2, big });
    this.flames.push({ x, y, z, big, phase: Math.random() * 10 });
  }

  buildFlames() {
    // Flames on burning wrecks: emissive cones that flicker, plus two shared point
    // lights that follow the nearest fires (a fixed light count avoids shader rebuilds).
    const geo = mergeGeometries([part(CONE8, 0xffb040, { y: 0.9, sx: 1.4, sy: 1.8, sz: 1.4 }), part(CONE8, 0xff7020, { x: 0.5, y: 0.6, sx: 0.9, sy: 1.2, sz: 0.9 }), part(CONE8, 0xffe080, { y: 0.6, sx: 0.6, sy: 1.0, sz: 0.6 })]);
    this.flameMesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.88, depthWrite: false }), Math.max(1, this.flames.length + 48));
    this.flameMesh.count = 0;
    this.flameMesh.frustumCulled = false;
    markHeat(this.flameMesh, { heat: 1 });
    this.scene.add(this.flameMesh);
    this.fireLights = [0].map(() => {
      const l = new THREE.PointLight(0xff9a40, 0, 45, 1.6);
      this.scene.add(l);
      return l;
    });
  }

  buildCraters() {
    const geo = new THREE.RingGeometry(0.001, 1, 9, 2).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: 0x2e261d, flatShading: true, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false });
    const rimGeo = new THREE.TorusGeometry(1, 0.18, 3, 9);
    rimGeo.rotateX(-Math.PI / 2);
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x5b4a36, flatShading: true });
    const items = CRATERS.map((c) => ({ x: c.x, z: c.z, s: c.r, sy: c.r * 0.8 }));
    bakeOnGround(this.scene, geo, mat, items, { lift: 0.06 });
    bakeOnGround(this.scene, rimGeo, rimMat, items, { lift: 0.02, solid: true });
    this.craterWaterMat = new THREE.MeshStandardMaterial({ color: 0x5a6a62, metalness: 0.85, roughness: 0.1, flatShading: true, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, depthWrite: false });
    bakeOnGround(this.scene, geo, this.craterWaterMat, CRATERS.filter((c) => c.water).map((c) => ({ x: c.x, z: c.z, s: c.r * 0.72 })), { lift: 0.1, order: 2 });
  }

  buildRails() {
    // Sleepers + two rails along the railway line, merged into one mesh.
    const parts = [];
    for (let i = 0; i < RAIL.length - 1; i++) {
      const [ax, az] = RAIL[i];
      const [bx, bz] = RAIL[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const rot = Math.atan2(bx - ax, bz - az);
      for (let d = 0; d < len; d += 1.4) {
        const x = ax + ((bx - ax) * d) / len, z = az + ((bz - az) * d) / len;
        const y = heightAt(x, z);
        parts.push(part(BOX, C.woodDark, { x, y: y + 0.08, z, ry: rot + Math.PI / 2, sx: 0.25, sy: 0.16, sz: 2.6 }));
        if (Math.round(d / 1.4) % 3 === 0) {
          for (const s of [-0.72, 0.72]) parts.push(part(BOX, 0x4a4a46, { x: x + Math.cos(rot) * s, y: y + 0.21, z: z - Math.sin(rot) * s, ry: rot, sx: 0.1, sy: 0.12, sz: 4.3 }));
        }
      }
    }
    const mesh = new THREE.Mesh(mergeGeometries(parts), MAT);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
  }

  showZones(on) {
    for (const ring of Object.values(this.zoneRings)) ring.visible = on;
  }

  buildZones() {
    this.zoneRings = {};
    for (const pt of POINTS) {
      const segs = 48;
      const geos = [];
      for (let i = 0; i < segs; i += 2) {
        const a = (i / segs) * Math.PI * 2;
        const x = pt.x + Math.cos(a) * pt.r;
        const z = pt.z + Math.sin(a) * pt.r;
        geos.push(part(BOX, 0xffffff, { x, y: groundAt(x, z) + 0.15, z, sx: 0.5, sy: 0.25, sz: (Math.PI * 2 * pt.r) / segs, ry: -a }));
      }
      const mesh = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshBasicMaterial({ color: 0xdddddd, vertexColors: true, transparent: true, opacity: 0.7 }));
      mesh.renderOrder = 2;
      noHeat(mesh);
      this.scene.add(mesh);
      this.zoneRings[pt.id] = mesh;
    }
  }

  setDestroyed(ids, fx) {
    const touched = new Set();
    for (const id of ids) {
      if (this.dead.has(id)) continue;
      this.dead.add(id);
      const p = PROPS[id];
      const y = this.baseYs.get(id);
      touched.add(chunkKey(p.x, p.z));
      const rubble = new THREE.Mesh(rubbleGeo(p, mulberry32(id + 1)), MAT);
      rubble.position.set(p.x, y, p.z);
      rubble.rotation.y = p.rot;
      rubble.castShadow = rubble.receiveShadow = true;
      this.scene.add(rubble);
      // Moving parts go with the building.
      for (const a of this.animated.filter((a) => a.p === p)) this.scene.remove(a.obj);
      this.animated = this.animated.filter((a) => a.p !== p);
      if (fx) {
        fx.impact({ x: p.x, y: y + 1, z: p.z, kind: 'heavy', r: 'ground' });
        if (['fueltank', 'barn', 'gasstation', 'truck', 'barrels', 'factory'].includes(p.type)) this.addFire(p.x, y + 1, p.z, true);
      }
    }
    for (const k of touched) this.rebuildChunk(k);
  }

  update(dt, fx, units, camPos, sound) {
    this.t = (this.t ?? 0) + dt;
    // Burning wrecks: periodic smoke puffs (only near the camera).
    for (const b of this.burning) {
      b.t -= dt;
      if (b.t > 0) continue;
      const d = Math.hypot(b.x - camPos.x, b.z - camPos.z);
      if (d > quality().drawDistance) {
        b.t = 1;
        continue;
      }
      b.t = (b.big ? 0.35 : 0.6) / quality().particles;
      fx.smokePuff(b.x, b.y, b.z, b.big);
    }
    this.updateFlames(camPos);
    for (const a of this.animated) {
      if (a.update) a.update(this.t);
      else if (a.kind === 'artillery') {
        a.recoil = Math.max(0, a.recoil - dt * 1.2);
        a.barrel.position.z = -a.recoil * 1.2;
      }
    }
    // Base artillery fires a round every so often (pure atmosphere, shells fly off-map).
    this.artilleryT -= dt;
    const guns = this.animated.filter((a) => a.kind === 'artillery');
    if (this.artilleryT <= 0 && guns.length) {
      this.artilleryT = 5 + Math.random() * 9;
      const g = guns[Math.floor(Math.random() * guns.length)];
      g.recoil = 1;
      const dir = new THREE.Vector3(0, Math.sin(0.55), Math.cos(0.55)).applyAxisAngle(THREE.Object3D.DEFAULT_UP, g.p.rot);
      const muzzle = g.obj.position.clone().add(new THREE.Vector3(0, 1.3, 0)).addScaledVector(dir, 4.6);
      fx.muzzleFlash(muzzle, dir, 'heavy');
      sound?.shot('heavy', muzzle, false);
    }
    this.vegetation.update(dt, camPos, units);
  }

  updateFlames(cam) {
    let n = 0;
    const m = new THREE.Matrix4();
    const near = [];
    for (const f of this.flames) {
      const d = Math.hypot(f.x - cam.x, f.z - cam.z);
      if (d > 600) continue;
      const flick = 0.75 + 0.25 * Math.sin(this.t * 13 + f.phase) * Math.sin(this.t * 7.3 + f.phase * 2);
      const s = (f.big ? 1.5 : 1) * flick;
      m.compose(new THREE.Vector3(f.x, f.y - 0.3, f.z), new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, this.t * 0.7 + f.phase), new THREE.Vector3(s, s * (1 + 0.3 * Math.sin(this.t * 17 + f.phase)), s));
      if (n < this.flameMesh.instanceMatrix.count) this.flameMesh.setMatrixAt(n++, m);
      near.push([d, f, flick]);
    }
    this.flameMesh.count = n;
    this.flameMesh.instanceMatrix.needsUpdate = true;
    near.sort((a, b) => a[0] - b[0]);
    this.fireLights.forEach((l, i) => {
      const e = near[i];
      if (!e || e[0] > 250) {
        l.intensity = 0;
        return;
      }
      l.position.set(e[1].x, e[1].y + 1.5, e[1].z);
      l.intensity = (e[1].big ? 70 : 40) * e[2];
    });
  }

  // Nearest fire distance (for crackle audio).
  nearestFire(pos) {
    let best = Infinity;
    for (const f of this.flames) best = Math.min(best, Math.hypot(f.x - pos.x, f.z - pos.z));
    return best;
  }

  setEnvMap(env) {
    this.craterWaterMat.envMap = env;
    this.craterWaterMat.needsUpdate = true;
    this.vegetation.setEnvMap(env);
  }

  get stats() {
    return { chunks: [...this.chunks.values()].filter((c) => c.mesh).length, instances: this.vegetation.drawnInstances, trees: this.vegetation.treeCount };
  }
}

export const BASE_FLAG_SPOTS = Object.entries(BASES).flatMap(([team, b]) => [[team, b.x + 12, b.z], [team, b.x - 20, b.z + (team === 'blue' ? 60 : -60)], [team, b.x + 25, b.z + (team === 'blue' ? 60 : -60)]]);
