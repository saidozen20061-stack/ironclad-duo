import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PLANES } from '../../../shared/planes.js';
import { paintMaterial } from './paint.js';
import { buildMinigun } from './guns.js';

// Procedural low-poly planes, each lofted from its own fuselage stations and wing outline.
// Forward is +Z, up is +Y, X is the left wing, origin at the centre of gravity.
// Returned handles: group, props (spinning), rear (rear gun pivot), engineZ, cockpit.

const matCache = new Map();
function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.75, metalness: 0.15, ...opts }));
  return matCache.get(key);
}
const GLASS = () => mat(0x1c2830, { roughness: 0.15, metalness: 0.7 });
const DARK = () => mat(0x23241f);
const METAL = () => mat(0x5a5d58, { roughness: 0.5, metalness: 0.6 });

// Fuselage through stations [z, width, height, centreY]: flat-faced octagon rings.
function loft(stations, sides = 8) {
  const pos = [];
  const ring = ([z, w, h, y = 0]) => {
    const r = [];
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2 + Math.PI / sides;
      r.push([Math.cos(a) * w * 0.5 * 1.08, y + Math.sin(a) * h * 0.5 * 1.08, z]);
    }
    return r;
  };
  const tri = (a, b, c) => pos.push(...a, ...b, ...c);
  for (let s = 0; s < stations.length - 1; s++) {
    const r0 = ring(stations[s]), r1 = ring(stations[s + 1]);
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      tri(r0[i], r1[j], r0[j]);
      tri(r0[i], r1[i], r1[j]);
    }
  }
  for (const [st, flip] of [[stations[0], true], [stations[stations.length - 1], false]]) {
    const r = ring(st);
    const c = [0, st[3] ?? 0, st[0]];
    for (let i = 0; i < sides; i++) (flip ? tri(c, r[i], r[(i + 1) % sides]) : tri(c, r[(i + 1) % sides], r[i]));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// A tapered flying surface from root to tip, thickness t. x along the span.
function panel(x0, x1, y0, y1, rootLead, rootTrail, tipLead, tipTrail, t = 0.2, tipT = t * 0.5) {
  const c = [
    [x0, y0 + t / 2, rootLead], [x0, y0 + t / 2, rootTrail], [x1, y1 + tipT / 2, tipTrail], [x1, y1 + tipT / 2, tipLead],
    [x0, y0 - t / 2, rootLead], [x0, y0 - t / 2, rootTrail], [x1, y1 - tipT / 2, tipTrail], [x1, y1 - tipT / 2, tipLead],
  ];
  const faces = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [3, 7, 6, 2], [0, 4, 7, 3], [1, 2, 6, 5]];
  const pos = [];
  for (const [a, b, cc, d] of faces) pos.push(...c[a], ...c[b], ...c[cc], ...c[a], ...c[cc], ...c[d]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// Height of the fuselage's underside at a point along it, from the same stations and scale as loft().
function fuselageBottom(stations, z) {
  for (let i = 0; i < stations.length - 1; i++) {
    const [z0, , h0, y0 = 0] = stations[i];
    const [z1, , h1, y1 = 0] = stations[i + 1];
    if (z > z0 || z < z1) continue;
    const t = (z0 - z) / (z0 - z1);
    return y0 + (y1 - y0) * t - ((h0 + (h1 - h0) * t) / 2) * 1.08 * Math.cos(Math.PI / 12);
  }
  return 0;
}

const mirror = (g) => {
  const m = g.clone();
  m.scale(-1, 1, 1);
  const p = m.attributes.position;
  // Flip winding after mirroring.
  for (let i = 0; i < p.count; i += 3) {
    const x = p.getX(i + 1), y = p.getY(i + 1), z = p.getZ(i + 1);
    p.setXYZ(i + 1, p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2));
    p.setXYZ(i + 2, x, y, z);
  }
  m.computeVertexNormals();
  return m;
};
const both = (g) => [g, mirror(g)];

const box = (w, h, d, x = 0, y = 0, z = 0) => new THREE.BoxGeometry(w, h, d).toNonIndexed().translate(x, y, z);
const cyl = (r0, r1, l, seg, x = 0, y = 0, z = 0) => new THREE.CylinderGeometry(r1, r0, l, seg).rotateX(Math.PI / 2).toNonIndexed().translate(x, y, z);

const clean = (g) => {
  const n = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal') n.deleteAttribute(k);
  return n;
};
const merged = (list) => mergeGeometries(list.map(clean));

// Per-type shapes. All measures in metres.
const SHAPES = {
  stuka: {
    mark: [5, -0.21],
    fuse: [[5.6, 0.5, 0.5, 0.15], [5, 1, 1.15, 0.1], [3.4, 1.15, 1.45, 0.1], [0.6, 1.1, 1.5, 0.15], [-2.4, 0.9, 1.25, 0.2], [-4.8, 0.42, 0.7, 0.35], [-5.8, 0.14, 0.3, 0.45]],
    // Gull wings: inverted bend at the root.
    wing: (add) => {
      for (const g of both(panel(0.4, 2.2, -0.45, -0.75, 1.7, -0.9, 1.5, -0.9, 0.36, 0.26))) add.body.push(g);
      for (const g of both(panel(2.2, 6.9, -0.75, 0.15, 1.5, -0.9, 0.9, -0.5, 0.26, 0.1))) add.body.push(g);
    },
    tail: { z: -4.9, span: 2.5, chord: 1.1, y: 0.45 }, fin: { z: -4.4, h: 1.7, chord: 1.2, y: 0.5 },
    canopy: [1.1, 2.6, 0.62, 0.72], prop: { z: 5.75, r: 1.65, blades: 3 }, nose: [[5.65, 3.6]], noseColor: 0xd9b72e,
    gear: 'spats', cockpitY: 0.95,
  },
  sturmovik: {
    mark: [4, -0.07],
    fuse: [[5.4, 0.45, 0.45, 0.05], [4.8, 1, 1.05, 0], [2.8, 1.25, 1.5, 0], [0.4, 1.2, 1.55, 0.1], [-2.6, 0.75, 1.1, 0.2], [-5.6, 0.2, 0.32, 0.4]],
    wing: (add) => {
      for (const g of both(panel(0.5, 7.3, -0.35, 0.2, 1.6, -1.1, 0.75, -0.55, 0.34, 0.1))) add.body.push(g);
      // Rocket rails under the wings.
      for (const x of [2.4, 3.2]) for (const s of [-1, 1]) add.dark.push(box(0.1, 0.1, 1.5, s * x, -0.6, 0.55));
    },
    tail: { z: -4.8, span: 2.5, chord: 1.2, y: 0.4 }, fin: { z: -4.3, h: 1.6, chord: 1.3, y: 0.45 },
    canopy: [0.6, 2.5, 0.65, 0.78], prop: { z: 5.5, r: 1.7, blades: 3 }, nose: [], noseColor: null,
    gear: 'pods', cockpitY: 1.0,
  },
  dauntless: {
    mark: [4, -0.17],
    fuse: [[4.7, 0.5, 0.5, 0], [4.2, 1.45, 1.45, 0], [2.8, 1.35, 1.55, 0.05], [0.2, 1.15, 1.5, 0.1], [-2.2, 0.75, 1.05, 0.25], [-5, 0.2, 0.3, 0.45]],
    wing: (add) => {
      for (const g of both(panel(0.5, 6.35, -0.5, 0.05, 1.8, -1.2, 0.9, -0.6, 0.28, 0.1))) add.body.push(g);
    },
    tail: { z: -4.2, span: 2.3, chord: 1.1, y: 0.4 }, fin: { z: -3.7, h: 1.8, chord: 1.4, y: 0.4 },
    canopy: [0.3, 3.2, 0.6, 0.78], prop: { z: 4.85, r: 1.6, blades: 3 }, nose: [], noseColor: null,
    gear: 'mains', cockpitY: 1.0,
  },
  heavyfighter: {
    mark: [5, 0.03],
    fuse: [[6.1, 0.3, 0.42, 0], [4.6, 0.9, 1.05, 0], [1.6, 1.05, 1.35, 0.1], [-1.6, 0.9, 1.15, 0.15], [-5.4, 0.32, 0.5, 0.3], [-6.2, 0.18, 0.28, 0.3]],
    wing: (add) => {
      for (const g of both(panel(0.4, 8.15, -0.15, 0.15, 1.7, -0.9, 0.8, -0.3, 0.3, 0.08))) add.body.push(g);
    },
    tail: { z: -5.4, span: 3, chord: 1.1, y: 0.35 }, twinFin: { z: -5.5, x: 2.6, h: 1.6, chord: 1.1, y: 0.35 },
    canopy: [0.6, 4.2, 0.55, 0.8], twin: { x: 2.7, z: 3.1, tail: -1, r: 0.62, y: -0.1, propR: 1.5, color: 0x8e918a }, nose: [], noseColor: null,
    gear: 'twin', cockpitY: 1.0, guns: [[0.15, 0.4, 5.6], [-0.15, 0.4, 5.6]],
  },
  mosquito: {
    mark: [5, 0.1],
    fuse: [[6.0, 0.55, 0.8, -0.1], [4.6, 1.1, 1.3, 0], [1.8, 1.25, 1.45, 0.05], [-1.4, 0.9, 1.15, 0.1], [-5.4, 0.3, 0.4, 0.25], [-6.2, 0.15, 0.24, 0.3]],
    wing: (add) => {
      for (const g of both(panel(0.4, 8.25, -0.1, 0.25, 1.9, -1, 0.7, -0.45, 0.32, 0.08))) add.body.push(g);
    },
    tail: { z: -5.3, span: 3, chord: 1.2, y: 0.3 }, fin: { z: -4.8, h: 2.3, chord: 1.8, y: 0.35 },
    canopy: [2.2, 2, 0.6, 0.72], twin: { x: 2.55, z: 3.0, tail: -1.4, r: 0.6, y: -0.15, propR: 1.55, color: null }, nose: [], noseColor: null,
    roundels: true, gear: 'twin', cockpitY: 0.95,
  },
  mitchell: {
    mark: [6.5, 0.33],
    fuse: [[8.0, 0.5, 0.7, -0.1], [6.5, 1.5, 1.9, 0], [3.2, 1.65, 2.15, 0.05], [-2, 1.5, 1.9, 0.15], [-6.4, 0.65, 0.95, 0.35], [-8, 0.45, 0.65, 0.35]],
    wing: (add) => {
      for (const g of both(panel(0.6, 10.3, 0.6, 0.15, 2.5, -1.2, 1, -0.4, 0.36, 0.1))) add.body.push(g);
      // Dorsal turret ring and tail gun.
      add.dark.push(box(0.9, 0.3, 0.9, 0, 1.22, -0.9));
    },
    tail: { z: -7, span: 3.6, chord: 1.3, y: 0.55 }, twinFin: { z: -7.1, x: 3.4, h: 1.9, chord: 1.2, y: 0.55 },
    canopy: [3.7, 2.2, 0.75, 1.05], twin: { x: 3.4, z: 3.0, tail: -1.3, r: 0.8, y: 0.25, propR: 1.9, color: null }, nose: [], noseColor: null, belly: 0x8d8f8a,
    gear: 'twin', cockpitY: 1.2, guns: [[0, -0.1, 8.3]],
  },
  mustang: {
    mark: [3.5, -0.13],
    fuse: [[4.9, 0.3, 0.32, 0.15], [4.2, 0.85, 0.95, 0.1], [1.6, 0.95, 1.15, 0.05], [-1.2, 0.85, 1.25, -0.05], [-3.2, 0.5, 0.75, 0.1], [-4.9, 0.14, 0.26, 0.28]],
    wing: (add) => {
      for (const g of both(panel(0.4, 5.65, -0.4, 0.05, 1.4, -0.9, 0.5, -0.35, 0.22, 0.07))) add.body.push(g);
      add.body.push(box(0.55, 0.42, 2.2, 0, -0.82, -1.1)); // belly radiator scoop
    },
    tail: { z: -4, span: 2.1, chord: 0.95, y: 0.28 }, fin: { z: -3.6, h: 1.45, chord: 1.1, y: 0.3 },
    canopy: [0.05, 1.7, 0.55, 0.62], prop: { z: 5, r: 1.55, blades: 4 }, nose: [[4.95, 4.2]], noseColor: 0xc23a2f,
    gear: 'mains', cockpitY: 0.75,
  },
  spitfire: {
    mark: [3.5, -0.05],
    fuse: [[4.5, 0.28, 0.3, 0.1], [3.9, 0.75, 0.95, 0.05], [1.4, 0.82, 1.15, 0.05], [-1, 0.72, 1.05, 0.1], [-3.2, 0.4, 0.6, 0.15], [-4.5, 0.12, 0.28, 0.2]],
    // Elliptical wing: built from three tapering panels.
    wing: (add) => {
      for (const g of both(panel(0.35, 2.5, -0.3, -0.12, 1.15, -1.05, 1.05, -0.95, 0.22, 0.17))) add.body.push(g);
      for (const g of both(panel(2.5, 4.4, -0.12, 0.02, 1.05, -0.95, 0.65, -0.6, 0.17, 0.09))) add.body.push(g);
      for (const g of both(panel(4.4, 5.6, 0.02, 0.1, 0.65, -0.6, 0.1, -0.15, 0.09, 0.03))) add.body.push(g);
    },
    tail: { z: -3.8, span: 1.7, chord: 0.8, y: 0.2 }, fin: { z: -3.5, h: 1.35, chord: 1, y: 0.2 },
    canopy: [0.1, 1.5, 0.5, 0.58], prop: { z: 4.6, r: 1.5, blades: 4 }, nose: [], noseColor: null, roundels: true,
    gear: 'mains', cockpitY: 0.7,
  },
  messer: {
    mark: [3, -0.18],
    fuse: [[4.5, 0.26, 0.3, 0.05], [3.9, 0.8, 0.9, 0], [1.3, 0.85, 1.05, 0], [-1.1, 0.72, 1, 0.05], [-3.2, 0.34, 0.55, 0.15], [-4.5, 0.12, 0.26, 0.2]],
    wing: (add) => {
      for (const g of both(panel(0.35, 4.95, -0.42, 0, 1.15, -0.8, 0.5, -0.25, 0.2, 0.06))) add.body.push(g);
    },
    tail: { z: -3.7, span: 1.6, chord: 0.8, y: 0.35 }, fin: { z: -3.35, h: 1.25, chord: 1.0, y: 0.25 },
    canopy: [0.3, 1.5, 0.48, 0.55], prop: { z: 4.6, r: 1.45, blades: 3 }, nose: [[4.55, 3.5]], noseColor: 0xd9b72e,
    gear: 'mains', cockpitY: 0.65,
  },
  // A flying wing, so most of what makes it a Leviathan is built in leviathanParts below.
  leviathan: {
    mark: [24, 1.35], markR: 2.4, markT: 2, markZ: -5.5, railY: -0.25, noWingGuns: true, skin: 0x6b7178, skinShade: 0x5a6067,
    fuse: [[19, 2, 1.2, 0], [14, 8, 3.6, 0.2], [4, 13, 6.5, 0.8], [-8, 11, 5.6, 0.8], [-16, 4, 2.4, 0.6]],
    wing: (add) => {
      for (const g of both(panel(5, 41, 0.4, 2.2, 15, -14, -16, -22, 3.2, 0.5))) add.body.push(g);
    },
    twinFin: { z: -18, x: 34, h: 8, chord: 7, y: 2 },
    canopy: [12, 5, 3.2, 1.8], canopyY: 2.3, gear: 'massive', cockpitY: 4.4, guns: [[1.3, 0.3, 19], [-1.3, 0.3, 19], [3.2, 0.2, 15.5], [-3.2, 0.2, 15.5]],
    engineX: 21, engineZ: 1,
  },
  f16: {
    mark: [3.1, -0.05], markR: 0.5, markZ: -1.5, markT: 0.24, railY: -0.3, railZ: -1.25, skin: 0x8b9198, skinShade: 0x757b83, jet: true,
    fuse: [[7.4, 0.12, 0.12, -0.05], [5.5, 0.7, 0.75, 0], [2.5, 1, 1.1, 0.1], [-2, 1.25, 1.2, 0], [-6, 1, 1, 0], [-7.2, 0.8, 0.8, 0]],
    wing: (add) => {
      for (const g of both(panel(0.5, 4.9, -0.05, -0.05, 1.6, -2.7, -1.9, -3, 0.2, 0.06))) add.body.push(g);
      add.body.push(box(1.05, 0.55, 2.4, 0, -0.72, 0.9)); // the chin intake
      add.dark.push(box(0.95, 0.45, 0.06, 0, -0.72, 2.11));
    },
    tail: { z: -5.8, span: 3.1, chord: 1.8, y: -0.05 }, fin: { z: -4.6, h: 2.7, chord: 2.8, y: 0.45 },
    canopy: [3.3, 2.7, 0.78, 0.92], gear: 'tricycle', cockpitY: 0.95, engineX: 0, engineZ: -6.4,
  },
};

// Everything on the Leviathan's wing and hull: engines, plates, rivets, blisters, bomb bays, gear.
function leviathanParts(add, group, props, spec, sh) {
  const lead = (x) => 15 - ((x - 5) / 36) * 31;
  const trail = (x) => -14 - ((x - 5) / 36) * 8;
  const wingY = (x) => 0.4 + ((x - 5) / 36) * 1.8;
  const wingT = (x) => 3.2 - ((x - 5) / 36) * 2.7;
  for (const x of [11, 21, 31]) for (const s of [-1, 1]) {
    const y = wingY(x), l = lead(x), t = trail(x);
    // A long armoured nacelle through the wing, ring-plated, with glowing exhausts at the back.
    add.body.push(loft([[l + 2.2, 1.6, 1.6, y], [l + 0.6, 4.4, 4.4, y], [l - 3, 4.6, 4.6, y], [t + 1, 3, 3, y], [t - 0.8, 2.2, 2.2, y]], 8).translate(s * x, 0, 0));
    add.plate.push(box(4.9, 0.3, 0.5, s * x, y + 2.35, l - 1.2), box(4.9, 0.3, 0.5, s * x, y - 2.35, l - 1.2));
    add.glow.push(box(1.7, 1.7, 0.2, s * x, y, t - 0.92));
    add.dark.push(box(2.3, 0.25, 0.4, s * x, y + 1.05, t - 0.6), box(2.3, 0.25, 0.4, s * x, y - 1.05, t - 0.6));
    const p = propeller(5, 4, l + 2.5, s * x, y, 0x23262a);
    p.userData.dir = s;
    group.add(p);
    props.push(p);
  }
  // Heavy plates bolted over the wing, top and underneath, with a row of rivets down each edge.
  for (const x of [8.5, 16, 26, 36]) for (const s of [-1, 1]) {
    const y = wingY(x), half = wingT(x) / 2, mid = (lead(x) + trail(x)) / 2 - 2;
    const w = x === 36 ? 3.5 : 5;
    const d = Math.min(12, (lead(x) - trail(x)) * 0.55);
    for (const up of [1, -1]) {
      add.plate.push(box(w, 0.18, d, s * x, y + up * (half + 0.06), mid));
      for (let i = 0; i < 5; i++) {
        const z = mid - d / 2 + 0.5 + (i / 4) * (d - 1);
        for (const e of [-1, 1]) add.rivet.push(box(0.2, 0.1, 0.2, s * x + e * (w / 2 - 0.3), y + up * (half + 0.18), z));
      }
    }
  }
  for (const s of [-1, 1]) {
    add.plate.push(box(1.8, 3, 18, s * 6.2, 0.9, -2)); // hull side armour
    for (let i = 0; i < 7; i++) add.rivet.push(box(0.12, 0.2, 0.2, s * 7.15, 2, -10 + i * 2.7), box(0.12, 0.2, 0.2, s * 7.15, -0.2, -10 + i * 2.7));
    // Armoured-glass gun blisters, top and bottom.
    add.glass.push(new THREE.IcosahedronGeometry(1.5, 0).scale(1, 0.75, 1.3).translate(s * 9, 2.85, 4), new THREE.IcosahedronGeometry(1.5, 0).scale(1, 0.75, 1.3).translate(s * 9, -1.5, 4));
    add.dark.push(cyl(0.09, 0.09, 2, 6, s * 9, 3.2, 5.5), cyl(0.09, 0.09, 2, 6, s * 9, -1.85, 5.5));
    add.plate.push(box(3.5, 0.2, 3.8, s * 9, 2.05, 4), box(3.5, 0.2, 3.8, s * 9, -0.75, 4));
    // Two struts per side, each on a pair of big wheels.
    for (const z of [3, -7]) {
      const r = 1.05, wy = -spec.gearH + r, top = fuselageBottom(sh.fuse, z) + 0.6;
      add.metal.push(box(0.5, top - wy, 0.6, s * 5, (top + wy) / 2, z));
      for (const k of [-1, 1]) add.dark.push(cyl(r, r, 0.7, 10).rotateY(Math.PI / 2).translate(s * 5 + k * 0.7, wy, z));
    }
  }
  // Rows of bomb bay doors under the hull, with the hinge lines picked out.
  for (let row = 0; row < 4; row++) {
    const z = -6.5 + row * 3.4;
    const y = fuselageBottom(sh.fuse, z) - 0.02;
    for (const s of [-1, 1]) {
      add.door.push(box(2.3, 0.2, 3, s * 1.35, y, z));
      add.rivet.push(box(0.12, 0.26, 3, s * 2.55, y, z));
    }
    add.rivet.push(box(0.12, 0.26, 3, 0, y, z));
  }
  // The heavy top turret's armoured base.
  const [, dy, dz] = spec.door;
  add.plate.push(box(4, 1.3, 4, 0, dy - 1, dz), box(3, 0.6, 3, 0, dy - 0.1, dz));
  for (const s of [-1, 1]) add.rivet.push(box(0.18, 1.1, 3.4, s * 2.05, dy - 1, dz), box(3.4, 1.1, 0.18, 0, dy - 1, dz + s * 2.05));
  if (typeof document !== 'undefined') stencils(group, wingY, wingT);
}

// Stencilled numbers on top of the wings.
function stencils(group, wingY, wingT) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#d6d2c0';
  ctx.font = 'bold 104px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('L-06', 128, 68);
  const tex = new THREE.CanvasTexture(c);
  const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
  for (const s of [-1, 1]) {
    const x = 16;
    const decal = new THREE.Mesh(new THREE.PlaneGeometry(9, 4.5), m);
    decal.rotation.set(-Math.PI / 2, 0, Math.PI);
    decal.position.set(s * x, wingY(x) + wingT(x) / 2 + 0.17, -10.5);
    group.add(decal);
  }
}

// Afterburner: two nested cones behind the nozzle, shown only while it's lit.
function afterburner(z) {
  const flame = new THREE.Group();
  flame.position.z = z;
  const cone = (r, l, color, opacity) => {
    const g = new THREE.ConeGeometry(r, l, 10).rotateX(-Math.PI / 2).translate(0, 0, -l / 2);
    return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, toneMapped: false, fog: false }));
  };
  flame.add(cone(0.58, 6, 0xff7a1f, 0.65), cone(0.36, 3.6, 0xffe2a0, 0.95));
  flame.visible = false;
  return flame;
}

const INSIGNIA = { blue: 0x2f5fa8, red: 0xa8382e };

function propeller(r, blades, z, x = 0, y = 0, hub = 0x2a2a26) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  const parts = [new THREE.ConeGeometry(r * 0.17, r * 0.34, 8).rotateX(Math.PI / 2).toNonIndexed()];
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2;
    const b = box(r * 0.1, r, 0.04, 0, r / 2, -0.02).rotateZ(a);
    parts.push(b);
  }
  g.add(new THREE.Mesh(merged(parts), mat(hub)));
  // Fast blur disc the blades turn into.
  const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 18), new THREE.MeshBasicMaterial({ color: 0x1a1a18, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }));
  disc.visible = false;
  g.add(disc);
  g.userData.disc = disc;
  return g;
}

export function buildPlane(type, team = 'blue', paint = type) {
  const spec = PLANES[type];
  const sh = SHAPES[type];
  const group = new THREE.Group();
  const add = { body: [], shade: [], dark: [], metal: [], nose: [], glass: [], belly: [], plate: [], rivet: [], door: [], glow: [] };

  add.body.push(loft(sh.fuse));
  sh.wing(add);
  // Tailplane.
  const t = sh.tail;
  if (t) for (const g of both(panel(0.08, t.span, t.y, t.y + 0.05, t.z + t.chord * 0.55, t.z - t.chord * 0.45, t.z + t.chord * 0.25, t.z - t.chord * 0.3, 0.12, 0.05))) add.body.push(g);
  // Fin: a surface standing up from the rear fuselage.
  if (sh.fin) add.shade.push(finGeoUp(sh.fin));
  if (sh.twinFin) for (const s of [-1, 1]) add.shade.push(finGeoUp(sh.twinFin, s * sh.twinFin.x));

  // Canopy with frame.
  const [cz, cl, cw, ch] = sh.canopy;
  const canopyY = sh.canopyY ?? (sh.fuse[2][3] ?? 0) + (sh.fuse[2][2] ?? 1.3) * 0.5 - 0.05;
  add.glass.push(loft([[cz + cl / 2, cw * 0.4, 0.1, canopyY], [cz + cl * 0.2, cw, ch * 0.72, canopyY + ch * 0.28], [cz - cl * 0.25, cw, ch * 0.76, canopyY + ch * 0.3], [cz - cl / 2, cw * 0.4, 0.1, canopyY]], 6));
  add.dark.push(box(0.05, ch * 0.72, 0.06, 0, canopyY + ch * 0.32, cz));

  // Engines and propellers.
  const props = [];
  let engineZ = sh.engineZ ?? sh.fuse[0][0] - 1.4;
  let engineX = sh.engineX ?? 0;
  if (sh.prop) {
    const p = propeller(sh.prop.r, sh.prop.blades, sh.prop.z, 0, sh.fuse[0][3] ?? 0, sh.noseColor ?? 0x2a2a26);
    group.add(p);
    props.push(p);
  }
  if (sh.twin) {
    const tw = sh.twin;
    engineZ = tw.z - 0.5;
    engineX = tw.x;
    for (const s of [-1, 1]) {
      add.body.push(loft([[tw.z + 0.9, tw.r * 0.8, tw.r * 0.8, tw.y], [tw.z + 0.2, tw.r * 2, tw.r * 2, tw.y], [tw.z - 0.9, tw.r * 2, tw.r * 2, tw.y], [tw.tail, tw.r * 0.5, tw.r * 0.5, tw.y + 0.08]], 8).translate(s * tw.x, 0, 0));
      const p = propeller(tw.propR, 3, tw.z + 1.05, s * tw.x, tw.y, 0x2a2a26);
      p.userData.dir = s;
      group.add(p);
      props.push(p);
    }
  }

  if (type === 'leviathan') leviathanParts(add, group, props, spec, sh);
  let flame = null;
  if (sh.jet) {
    // The nozzle, and the flame that comes out of it.
    add.dark.push(cyl(0.62, 0.5, 1.2, 10, 0, 0, -7.6));
    add.metal.push(cyl(0.64, 0.64, 0.3, 10, 0, 0, -7.05));
    flame = afterburner(-8.2);
    group.add(flame);
  }

  // Colour accents.
  for (const [z0, z1] of sh.nose ?? []) add.nose.push(loft([[z0, 0.3, 0.3, sh.fuse[0][3]], [z1, sh.fuse[1][1] * 1.04, sh.fuse[1][2] * 1.04, sh.fuse[1][3]]]));
  if (sh.belly) add.belly.push(box(1.2, 0.3, 11, 0, -0.98, 0));

  // Landing gear (these planes fly with the wheels out: they read better low-poly).
  const gy = -spec.gearH + 0.32;
  const wheel = (x, z, r = 0.34) => cyl(r, r, 0.2, 10).rotateY(Math.PI / 2).translate(x, gy, z);
  if (sh.gear === 'spats') {
    // The Stuka's trousered fixed gear.
    for (const s of [-1, 1]) {
      add.body.push(loft([[1.3, 0.3, 0.42, -0.7], [0.3, 0.42, 1.1, -1.15], [-0.6, 0.3, 0.7, -1.3], [-1, 0.1, 0.2, -1.4]], 6).translate(s * 2, -0.25, 0));
      add.dark.push(wheel(s * 2, 0.25, 0.42));
    }
  } else if (sh.gear === 'pods') {
    for (const s of [-1, 1]) {
      add.body.push(loft([[1.5, 0.2, 0.2, -0.55], [0.6, 0.55, 0.7, -0.7], [-1.1, 0.25, 0.22, -0.55]], 6).translate(s * 2.4, 0, 0));
      add.metal.push(box(0.1, 1.5, 0.12, s * 2.4, -1.2, 0.55));
      add.dark.push(wheel(s * 2.4, 0.5));
    }
  } else if (sh.gear === 'tricycle') {
    add.metal.push(box(0.1, spec.gearH - 0.3, 0.12, 0, -spec.gearH / 2 + 0.05, 4.4));
    add.dark.push(wheel(0, 4.4, 0.3));
    for (const s of [-1, 1]) {
      add.metal.push(box(0.1, spec.gearH - 0.3, 0.12, s * 1.25, -spec.gearH / 2 + 0.05, -1.2));
      add.dark.push(wheel(s * 1.25, -1.2, 0.32));
    }
  } else if (sh.gear === 'massive') {
    // Built with the rest of the Leviathan.
  } else if (sh.gear === 'twin') {
    for (const s of [-1, 1]) {
      const x = sh.twin.x;
      add.metal.push(box(0.12, spec.gearH - 0.6, 0.14, s * x, -spec.gearH / 2 + 0.05, sh.twin.z - 0.8));
      add.dark.push(wheel(s * x, sh.twin.z - 0.8, 0.42));
    }
  } else {
    for (const s of [-1, 1]) {
      add.metal.push(box(0.1, spec.gearH - 0.6, 0.12, s * 1.7, -spec.gearH / 2 + 0.05, 0.75));
      add.dark.push(wheel(s * 1.7, 0.75, 0.36));
    }
  }
  // Tail wheel: on the ground, with a strut going up into the underside of the rear fuselage.
  if (sh.gear !== 'massive' && sh.gear !== 'tricycle') {
    const tailZ = sh.fuse[sh.fuse.length - 1][0] + 1;
    const tailR = 0.2;
    const wheelY = -spec.gearH + tailR;
    const strutTop = fuselageBottom(sh.fuse, tailZ) + 0.12; // a little way inside the body
    add.dark.push(cyl(tailR, tailR, 0.12, 8).rotateY(Math.PI / 2).translate(0, wheelY, tailZ));
    add.metal.push(box(0.09, strutTop - wheelY, 0.11, 0, (strutTop + wheelY) / 2, tailZ));
  }

  // Bombs hang under the fuselage on the planes that carry them: nose, body, tail fins, rack.
  if (spec.bombs && sh.gear !== 'massive') {
    const by = -sh.fuse[2][2] * 0.5 - 0.26;
    add.dark.push(cyl(0.2, 0.2, 1.1, 8, 0, by, 0.45), new THREE.ConeGeometry(0.2, 0.42, 8).rotateX(Math.PI / 2).toNonIndexed().translate(0, by, 1.2), new THREE.ConeGeometry(0.2, 0.5, 8).rotateX(-Math.PI / 2).toNonIndexed().translate(0, by, -0.34));
    add.dark.push(box(0.02, 0.5, 0.3, 0, by, -0.5), box(0.5, 0.02, 0.3, 0, by, -0.5));
    add.metal.push(box(0.1, 0.16, 0.7, 0, by + 0.2, 0.45), cyl(0.21, 0.21, 0.05, 8, 0, by, 0.75));
  }
  // Forward guns: a blast tube and barrel out of each wing's leading edge.
  const [gx, gy2] = sh.mark;
  const wx = gx * 0.55;
  const cannon = spec.guns.kind === 'ac';
  if (!sh.noWingGuns) for (const s of [-1, 1]) {
    add.dark.push(cyl(cannon ? 0.05 : 0.03, cannon ? 0.05 : 0.03, 1.3, 6, s * wx, gy2 - 0.05, 1.45));
    add.metal.push(cyl(cannon ? 0.085 : 0.05, cannon ? 0.085 : 0.05, 0.45, 6, s * wx, gy2 - 0.05, 0.95));
    add.dark.push(cyl(cannon ? 0.07 : 0.042, cannon ? 0.07 : 0.042, 0.1, 6, s * wx, gy2 - 0.05, 2.1));
    if (cannon) add.metal.push(box(0.14, 0.09, 0.4, s * wx, gy2 - 0.2, 0.7)); // ammo blister
  }
  for (const g of sh.guns ?? []) {
    add.dark.push(cyl(0.035, 0.035, 1.2, 6, g[0], g[1], g[2]), cyl(0.055, 0.055, 0.08, 6, g[0], g[1], g[2] + 0.6));
    add.metal.push(cyl(0.06, 0.06, 0.4, 6, g[0], g[1], g[2] - 0.4));
  }
  // Rockets on their rails, with noses and fins.
  if (spec.rockets) {
    for (const s of [-1, 1]) for (const k of [0, 1]) {
      const x = s * (gx * 0.75 + k * 0.75), y = sh.railY ?? gy2 - 0.34, z = sh.railZ ?? 0.2;
      add.metal.push(box(0.05, 0.14, 1.3, x, y + 0.14, z));
      add.dark.push(cyl(0.065, 0.065, 0.95, 6, x, y, z), new THREE.ConeGeometry(0.065, 0.24, 6).rotateX(Math.PI / 2).toNonIndexed().translate(x, y, z + 0.6));
      add.metal.push(box(0.26, 0.015, 0.2, x, y, z - 0.42), box(0.015, 0.26, 0.2, x, y, z - 0.42));
    }
  }

  const painted = paintMaterial(paint, team, 1);
  const shaded = paintMaterial(paint, team, 0.82);
  const addMesh = (list, material, camo = false) => {
    if (!list.length) return null;
    const g = merged(list);
    if (camo) g.setAttribute('camoPos', g.attributes.position.clone());
    const m = new THREE.Mesh(g, material);
    m.castShadow = true;
    group.add(m);
    return m;
  };
  // Some planes wear bare metal instead of a team camouflage.
  addMesh(add.body, sh.skin ? mat(sh.skin, { roughness: 0.7, metalness: 0.2 }) : painted, !sh.skin);
  addMesh(add.shade, sh.skinShade ? mat(sh.skinShade, { roughness: 0.7, metalness: 0.2 }) : shaded, !sh.skinShade);
  addMesh(add.plate, mat(0x4b5057, { roughness: 0.6, metalness: 0.25 }));
  addMesh(add.rivet, mat(0xa2a6a8, { roughness: 0.5, metalness: 0.3 }));
  addMesh(add.door, mat(0x34373a, { roughness: 0.7, metalness: 0.2 }));
  if (add.glow.length) {
    const m = addMesh(add.glow, new THREE.MeshBasicMaterial({ color: 0xff7a1c, toneMapped: false }));
    m.castShadow = false;
  }
  addMesh(add.dark, DARK());
  addMesh(add.metal, METAL());
  addMesh(add.glass, GLASS());
  if (add.nose.length) addMesh(add.nose, mat(sh.noseColor));
  if (add.belly.length) addMesh(add.belly, mat(sh.belly));

  // Rear gun on its pivot.
  let rear = null, rearSpin = null;
  if (spec.rear) {
    const [dx, dy, dz] = spec.door;
    rear = new THREE.Group();
    rear.position.set(dx, dy, dz);
    rear.rotation.order = 'YXZ';
    rear.rotation.y = -Math.PI / 2;
    const minigun = buildMinigun(dx ? 1.5 : 3.2); // a top turret is a far heavier gun
    rear.add(minigun.group);
    rearSpin = minigun.spin;
    group.add(rear);
    // The arm that holds the gun out of the door.
    if (dx) group.add(new THREE.Mesh(merged([box(Math.abs(dx), 0.07, 0.09, dx / 2, dy - 0.26, dz), box(0.07, 0.3, 0.07, dx, dy - 0.14, dz)]), METAL()));
  }

  // Team marks: the two sides have to be told apart at a glance.
  const mark = team === 'blue' ? INSIGNIA.blue : INSIGNIA.red;
  const colors = sh.roundels ? [mark, 0xe8e4d4, team === 'blue' ? 0xa8382e : 0x23241f] : [0xe8e4d4, mark];
  // Discs slightly thicker than the wing, so they show on top and underneath.
  const [mx, my] = sh.mark;
  for (const side of [-1, 1]) {
    colors.forEach((c, i) => {
      const r = (sh.markR ?? 0.75) * (1 - i * 0.34);
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(r, r, (sh.markT ?? 0.3) + i * 0.03, 12), mat(c));
      disc.position.set(side * mx, my, sh.markZ ?? 0.2);
      group.add(disc);
    });
  }
  const bar = new THREE.Mesh(box(0.05, 0.5, 1.1, 0, (sh.fuse[3][3] ?? 0) + 0.1, sh.fuse[4][0] * 0.8), mat(mark));
  bar.scale.x = (sh.fuse[4][1] ?? 1) / 0.05 * 1.02;
  group.add(bar);

  return { group, props, rear, rearSpin, engineZ, engineX, cockpitY: sh.cockpitY, spec, type, turret: null, flame, shadowShape: type === 'leviathan' ? wingShadow(spec) : null };
}

// The Leviathan's wing outline as a flat dark shape to lay on the ground under it.
function wingShadow(spec) {
  const w = spec.size.width / 2;
  const outline = new THREE.Shape([[0, 20], [w, -16], [w, -22], [3, -16], [-3, -16], [-w, -22], [-w, -16]].map(([x, z]) => new THREE.Vector2(x, z)));
  const g = new THREE.ShapeGeometry(outline).rotateX(Math.PI / 2);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide }));
  m.rotation.order = 'YXZ';
  m.renderOrder = 1;
  return m;
}

function finGeoUp(f, x = 0) {
  // Trailing edge straight, leading edge swept back to the tip.
  const y0 = f.y, y1 = f.y + f.h, z0 = f.z;
  const lead0 = z0 + f.chord * 0.55, trail0 = z0 - f.chord * 0.45, lead1 = z0 + f.chord * 0.02, trail1 = z0 - f.chord * 0.42;
  const hw = 0.07;
  const c = [[hw, y0, lead0], [hw, y0, trail0], [hw * 0.5, y1, trail1], [hw * 0.5, y1, lead1], [-hw, y0, lead0], [-hw, y0, trail0], [-hw * 0.5, y1, trail1], [-hw * 0.5, y1, lead1]];
  const faces = [[0, 1, 2, 3], [7, 6, 5, 4], [3, 2, 6, 7], [1, 5, 6, 2], [4, 0, 3, 7]];
  const pos = [];
  for (const [a, b, cc, d] of faces) pos.push(...c[a], ...c[b], ...c[cc], ...c[a], ...c[cc], ...c[d]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.translate(x, 0, 0);
  g.computeVertexNormals();
  return g;
}

// Forward fuselage heights for the views (where the eye sits).
export const planeEye = (type) => SHAPES[type].cockpitY;
export const sideGunPos = (type) => PLANES[type].door ?? [-0.8, 0.45, -1.6];
