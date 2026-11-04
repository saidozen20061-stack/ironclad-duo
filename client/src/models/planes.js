import * as THREE from 'three';
import { mergeGeometries, mergeVertices, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
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

// Fuselage through stations [z, width, height, centreY]: flat-faced octagon rings. `square` below 1
// flattens the sides and squares off the corners.
function loft(stations, sides = 8, square = 1) {
  const pos = [];
  const ring = ([z, w, h, y = 0]) => {
    const r = [];
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2 + Math.PI / sides;
      const c = Math.cos(a), s = Math.sin(a);
      r.push([Math.sign(c) * Math.abs(c) ** square * w * 0.5 * 1.08, y + Math.sign(s) * Math.abs(s) ** square * h * 0.5 * 1.08, z]);
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

// Width, height and centre of a fuselage at a point along it.
function fuseAt(stations, z) {
  for (let i = 0; i < stations.length - 1; i++) {
    const [z0, w0, h0, y0 = 0] = stations[i];
    const [z1, w1, h1, y1 = 0] = stations[i + 1];
    if (z > z0 || z < z1) continue;
    const t = (z0 - z) / (z0 - z1);
    return [w0 + (w1 - w0) * t, h0 + (h1 - h0) * t, y0 + (y1 - y0) * t];
  }
  return [0, 0, 0];
}

const TALON_FUSE = [[7.4, 0.12, 0.12, -0.05], [5.5, 0.82, 0.8, 0], [2.5, 1.3, 1.15, 0.1], [-2, 1.65, 1.25, 0], [-6, 1.3, 1, 0], [-7.2, 0.85, 0.8, 0]];

// The Talon's wing and everything else that makes it read as a modern jet.
function talonDetails(add) {
  for (const g of both(panel(0.5, 6, -0.05, -0.05, 1.6, -2.7, -2.4, -3.05, 0.2, 0.06))) add.body.push(g);
  // Strakes blending the wing into the nose, flaps along the trailing edge, slats along the front.
  for (const g of both(panel(0.3, 1.55, 0, -0.04, 4.8, 0.2, 1.1, 0.2, 0.12, 0.05))) add.body.push(g);
  for (const g of both(panel(0.95, 4.6, -0.05, -0.05, -2.45, -3.3, -2.65, -3.4, 0.11, 0.07))) add.door.push(g);
  for (const g of both(panel(1.5, 5.8, -0.04, -0.04, 1.02, 0.72, -2.1, -2.3, 0.1, 0.05))) add.plate.push(g);
  // The chin intake with its lip and dark mouth.
  add.body.push(box(1.35, 0.6, 2.6, 0, -0.72, 0.9));
  add.dark.push(box(1.15, 0.45, 0.06, 0, -0.72, 2.22));
  add.rivet.push(box(1.42, 0.05, 0.1, 0, -0.42, 2.2), box(1.42, 0.05, 0.1, 0, -1.02, 2.2));
  for (const s of [-1, 1]) add.rivet.push(box(0.05, 0.62, 0.1, s * 0.69, -0.72, 2.2));
  // Dorsal spine behind the canopy, with vents and a blade aerial.
  add.body.push(loft([[1.8, 0.2, 0.12, 0.74], [0.3, 0.6, 0.36, 0.72], [-3.2, 0.55, 0.3, 0.62], [-4.5, 0.1, 0.1, 0.56]], 6));
  for (const z of [-0.6, -1.2, -1.8]) add.dark.push(box(0.32, 0.03, 0.2, 0, 0.91, z));
  add.dark.push(box(0.04, 0.42, 0.34, 0, 1.1, -2.6));
  // Panel lines around the fuselage.
  for (const z of [4.7, 1.5, -0.6, -3, -5.2]) {
    const [w, h, y] = fuseAt(TALON_FUSE, z);
    add.door.push(box(w * 0.42, 0.02, 0.04, 0, y + h * 0.5, z));
    for (const s of [-1, 1]) add.door.push(box(0.02, h * 0.42, 0.04, s * w * 0.5, y, z));
  }
  // A rudder, and an antenna fairing on top of the fin.
  add.door.push(box(0.16, 1.9, 0.5, 0, 2.15, -6.05));
  add.plate.push(box(0.2, 0.2, 0.9, 0, 3.2, -5.6));
  for (const s of [-1, 1]) {
    // Speed brakes either side of the nozzle, and two small fins underneath.
    add.door.push(box(0.5, 0.05, 1.5, s * 0.95, 0.12, -6.3), box(0.5, 0.05, 1.5, s * 0.95, -0.12, -6.3));
    add.shade.push(box(0.06, 0.65, 1.3).rotateZ(s * 0.4).translate(s * 0.62, -0.75, -5.2));
    // Wingtip rails with a missile on each.
    add.metal.push(box(0.1, 0.1, 1.6, s * 6.05, -0.05, -2.75));
    add.dark.push(cyl(0.07, 0.07, 1.5, 6, s * 6.05, -0.17, -2.7), new THREE.ConeGeometry(0.07, 0.3, 6).rotateX(Math.PI / 2).toNonIndexed().translate(s * 6.05, -0.17, -1.8));
    add.metal.push(box(0.3, 0.02, 0.2, s * 6.05, -0.17, -3.35), box(0.02, 0.3, 0.2, s * 6.05, -0.17, -3.35));
    // An underwing fuel tank on its pylon.
    add.body.push(loft([[0, 0.05, 0.05, -0.66], [-0.6, 0.42, 0.42, -0.66], [-2.6, 0.42, 0.42, -0.66], [-3.3, 0.05, 0.05, -0.66]], 8).translate(s * 4.6, 0, 0));
    add.plate.push(box(0.07, 0.42, 1.1, s * 4.6, -0.28, -1.8));
    add.door.push(box(0.46, 0.02, 0.05, s * 4.6, -0.66 + 0.22, -1.8));
    // Doors beside the main wheels.
    add.door.push(box(0.04, 0.9, 1, s * 1.05, -1.05, -1.2));
    add.door.push(box(0.04, 0.5, 0.7, s * 0.14, -1.2, 4.4));
  }
  // The petals around the nozzle.
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    add.metal.push(box(0.2, 0.04, 1.1).translate(0, 0.63, -7.6).rotateZ(a));
  }
  // A long probe on the nose, and the second seat's canopy hoops.
  add.metal.push(cyl(0.02, 0.02, 0.9, 4, 0, -0.05, 7.85));
  add.dark.push(box(0.05, 0.6, 0.06, 0, 0.98, 2.5), box(0.05, 0.55, 0.06, 0, 0.98, 4.05));
  for (const s of [-1, 1]) add.dark.push(box(0.03, 0.03, 2.5, s * 0.41, 0.67, 3.3));
}

// Per-type shapes. All measures in metres.
// Rounds a fuselage's stations into a smooth line, with `perGap` new ones between each pair.
function smoothStations(stations, perGap = 4) {
  const out = [];
  const at = (i, k) => stations[Math.max(0, Math.min(stations.length - 1, i))][k];
  for (let i = 0; i < stations.length - 1; i++) {
    for (let j = 0; j < perGap; j++) {
      const t = j / perGap;
      out.push([0, 1, 2, 3].map((k) => {
        const a = at(i - 1, k), b = at(i, k), c = at(i + 1, k), d = at(i + 2, k);
        return 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);
      }));
    }
  }
  out.push(stations[stations.length - 1]);
  return out;
}

// A B-52 half as big again: a long narrow slab-sided hull, a blunt rounded nose rising to the cockpit,
// and a tail that rises to meet the fin.
const LEVIATHAN_SQUARE = 0.72;
const LEVIATHAN_FUSE = smoothStations([[36, 0.5, 0.5, -0.9], [35, 2.2, 2, -1], [33, 3.4, 3.4, -1], [30.5, 4.2, 4.6, -0.8], [28, 4.7, 5.6, -0.45], [25, 5, 6.4, -0.1], [21, 5.2, 6.85, 0.15], [10, 5.2, 6.85, 0.2], [-6, 5.2, 6.85, 0.2], [-14, 5, 6.5, 0.4], [-22, 4.2, 5.4, 1], [-29, 2.9, 3.7, 1.9], [-34, 1.6, 2, 2.7], [-36, 0.5, 0.6, 3.1]]);

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
  // The B-52: a long thin hull, a huge drooping wing with eight jets in four pods, a tall fin.
  // Most of it is in leviathanParts below.
  leviathan: {
    mark: [13.4, 1.5], discX: 30, markR: 1.9, markT: 0.85, markRoll: 0.05, markSegs: 28, markZ: -18.3, noWingGuns: true, noRails: true, internalBombs: true, fuseSides: 28, fuseSquare: LEVIATHAN_SQUARE, smooth: true, noBar: true,
    fuse: LEVIATHAN_FUSE,
    wing: () => {},
    teamMark: () => upright([[-26, 9.5], [-28.2, 12], [-35.42, 12], [-35.46, 9.5]], 0.95),
    canopy: [2, 1, 1, 0.3], canopyY: 1, gear: 'massive', cockpitY: 3.5, guns: [],
    engineX: 14.5, engineZ: -8.5,
  },
  f16: {
    mark: [3.1, -0.05], discX: 4.3, markR: 0.46, markZ: -2.05, markT: 0.24, railY: -0.3, railZ: -1.25, jet: true,
    noWingGuns: true, guns: [[0.72, 0.42, 3.3]], nose: [[7.45, 5.5]], noseColor: 0x4a4f55, finFlash: [2.75, -5.25],
    fuse: TALON_FUSE,
    wing: talonDetails,
    tail: { z: -5.8, span: 3.7, chord: 1.9, y: -0.05 }, fin: { z: -4.6, h: 2.7, chord: 2.8, y: 0.45 },
    canopy: [3.3, 2.7, 0.82, 0.92], gear: 'tricycle', cockpitY: 0.95, engineX: 0, engineZ: -6.4,
  },
  // The Leviathan's little escort, in its colours: a small grey jet with swept wings and two fins.
  escort: {
    mark: [3.6, -0.22], markR: 0.5, markT: 0.26, markZ: -1.8, noWingGuns: true, internalBombs: true,
    fuse: [[5.6, 0.2, 0.16, -0.08], [3.4, 1, 0.8, 0], [0.8, 1.7, 1.35, 0.12], [-2.4, 1.5, 1.1, 0.16], [-4.6, 0.9, 0.7, 0.2]],
    wing: (add) => {
      for (const g of both(panel(0.6, 5.5, 0, -0.35, 1.6, -2.2, -2.4, -3.2, 0.3, 0.06))) add.body.push(g);
      add.exhaust.push(new THREE.ConeGeometry(0.34, 1.8, 8).rotateX(-Math.PI / 2).toNonIndexed().translate(0, 0.2, -5.5));
      for (const s of [-1, 1]) {
        // Two fins leaning apart.
        add.shade.push(finGeoUp({ z: -3.4, h: 1.7, chord: 1.9, y: 0, hw: 0.07 }).translate(0, -0.3, 0).rotateZ(s * -0.4).translate(s * 0.6, 0.6, 0));
        add.dark.push(cyl(0.06, 0.06, 1.5, 6, s * 0.55, -0.22, 3));
        add.plate.push(box(0.5, 0.04, 1.3, s * 2.4, 0.14, -0.9));
      }
    },
    tail: { z: -4, span: 2.5, chord: 1.5, y: 0.1 },
    canopy: [1.6, 2.2, 0.62, 0.55], canopyY: 0.55, gear: 'tricycle', gearX: 1, cockpitY: 0.8, engineX: 0, engineZ: -4.4,
  },
  // A narrow two-seat gunship: stepped glass, stub wings with a minigun on each, a long thin tail boom.
  // Most of it is in heliParts below.
  heli: {
    mark: [1.7, -0.02], discX: 1.75, markR: 0.34, markT: 0.2, markZ: 0.3, noWingGuns: true, noRails: true, internalBombs: true, fuseSides: 6, noBar: true,
    fuse: [[6.4, 0.3, 0.3, -0.38], [5.2, 1, 1.1, -0.36], [3.4, 1.3, 1.9, -0.18], [0.8, 1.4, 2.4, 0.02], [-2.6, 1.05, 1.7, 0.32], [-4.2, 0.55, 0.75, 0.62], [-8.4, 0.26, 0.32, 0.85]],
    wing: () => {},
    teamMark: () => flatFin([[-7.3, 1.5], [-7.75, 2.1], [-8.75, 2.1], [-8.6, 1.5]], 0.24),
    canopy: [1, 0.5, 0.2, 0.1], canopyY: 0, gear: 'massive', cockpitY: 0.75, guns: [],
    engineX: 0, engineZ: -2,
  },
  // A black flying wing: a broad arrowhead with a sawtooth back edge and the cockpit on top.
  wraith: {
    mark: [9, 0], markR: 0.75, markT: 0.62, markZ: -1, noWingGuns: true, internalBombs: true, fuseSides: 10,
    fuse: [[8.1, 0.3, 0.16, 0.02], [5.5, 2.6, 0.75, 0.12], [2, 4.2, 1.5, 0.22], [-1.5, 3.8, 1.15, 0.18], [-3.5, 1.8, 0.5, 0.08], [-4.6, 0.6, 0.16, 0.02]],
    wing: wraithWing,
    canopy: [3.9, 2.5, 1.5, 0.62], canopyY: 0.72, gear: 'tricycle', gearX: 3.4, cockpitY: 1.15, engineX: 3.6, engineZ: -1,
  },
};

// The Wraith's span: straight leading edge out to the tip, a W along the back.
function wraithWing(add) {
  const lead = (x) => 8 - x * (13.2 / 17);
  const stations = [[0, -2.4, 0.9], [3.6, -6, 0.72], [7.2, -2.7, 0.5], [10.6, -6.4, 0.34], [13.8, -3.8, 0.2], [17, -5.5, 0.06]];
  for (let i = 0; i < stations.length - 1; i++) {
    const [x0, t0, h0] = stations[i], [x1, t1, h1] = stations[i + 1];
    for (const g of both(panel(x0, x1, 0, 0, lead(x0), t0, lead(x1), t1, h0, h1))) add.body.push(g);
  }
  for (const s of [-1, 1]) {
    // A low hump over each engine, a dark intake on top, a flat slit for the exhaust.
    add.body.push(loft([[3.6, 0.3, 0.1, 0.32], [1.8, 1.8, 0.6, 0.42], [-1.6, 1.9, 0.6, 0.38], [-4.2, 0.7, 0.12, 0.18]], 8).translate(s * 4.1, 0, 0));
    add.dark.push(box(1.35, 0.26, 0.5, s * 4.1, 0.56, 1.85));
    add.dark.push(box(1.5, 0.05, 1.1, s * 4.1, 0.25, -3.45));
    // Bomb bay doors, and the seams across the wing.
    for (const z of [-0.8, 1.4]) add.door.push(box(1.5, 0.04, 2, s * 1.2, -0.56, z));
    add.door.push(box(0.06, 0.03, 6, s * 8, 0.27, -1.6));
  }
  // Fine panel lines along the hull.
  for (const z of [4.8, 0.5, -2.4]) {
    const [w, h, y] = fuseAt(WRAITH_HULL, z);
    add.door.push(box(w * 0.4, 0.02, 0.05, 0, y + h * 0.51, z));
  }
}
const WRAITH_HULL = [[8.1, 0.3, 0.16, 0.02], [5.5, 2.6, 0.75, 0.12], [2, 4.2, 1.5, 0.22], [-1.5, 3.8, 1.15, 0.18], [-3.5, 1.8, 0.5, 0.08], [-4.6, 0.6, 0.16, 0.02]];

// A smooth surface from a function of two parameters. `outward` tells it which way the faces point,
// `uvOf` gives texture coordinates if it wears a picture.
function gridSurface(fn, nu, nv, outward, uvOf = null) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= nu; i++) {
    for (let j = 0; j <= nv; j++) {
      const p = fn(i / nu, j / nv);
      pos.push(...p);
      if (uvOf) uv.push(...uvOf(p));
    }
  }
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const a = i * (nv + 1) + j, c = a + nv + 1;
      idx.push(a, c, a + 1, c, c + 1, a + 1);
    }
  }
  const raw = new THREE.BufferGeometry();
  raw.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (uvOf) raw.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  raw.setIndex(idx);
  // Welding closes the seams, so the shading runs round without a line.
  let g = mergeVertices(raw, 1e-3);
  g.computeVertexNormals();
  const mid = Math.floor(g.attributes.position.count / 2);
  const n = new THREE.Vector3().fromBufferAttribute(g.attributes.normal, mid);
  const at = new THREE.Vector3().fromBufferAttribute(g.attributes.position, mid);
  if (n.dot(outward(at)) < 0) {
    const ix = g.index.array;
    for (let i = 0; i < ix.length; i += 3) [ix[i + 1], ix[i + 2]] = [ix[i + 2], ix[i + 1]];
    g.computeVertexNormals();
  }
  return g;
}

// A round body along Z through a smooth line of [z, radius] points. `squash` flattens it top to bottom.
function revolve(profile, x, y, sides = 16, squash = 1, steps = 16) {
  const line = new THREE.SplineCurve(profile.map(([z, r]) => new THREE.Vector2(z, r)));
  return gridSurface((u, v) => {
    const q = line.getPoint(u), a = v * Math.PI * 2 - Math.PI / 2;
    return [x + Math.cos(a) * q.y, y + Math.sin(a) * q.y * squash, q.x];
  }, steps, sides, (p) => new THREE.Vector3(p.x - x, p.y - y, 0));
}

// Rounds off an outline's corners, so nothing on it comes to a hard point.
function softCorners(points, r) {
  const out = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i], a = points[(i + points.length - 1) % points.length], b = points[(i + 1) % points.length];
    const la = Math.hypot(a[0] - p[0], a[1] - p[1]), lb = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const ra = Math.min(r, la * 0.45), rb = Math.min(r, lb * 0.45);
    const q0 = [p[0] + ((a[0] - p[0]) / la) * ra, p[1] + ((a[1] - p[1]) / la) * ra], q1 = [p[0] + ((b[0] - p[0]) / lb) * rb, p[1] + ((b[1] - p[1]) / lb) * rb];
    for (let k = 0; k <= 4; k++) {
      const t = k / 4, c = 1 - t;
      out.push([c * c * q0[0] + 2 * c * t * p[0] + t * t * q1[0], c * c * q0[1] + 2 * c * t * p[1] + t * t * q1[1]]);
    }
  }
  return out;
}

// An upright blade from its side-on outline ([z, y] points), with softly rounded edges. `lean` tips it
// over about the height `pivot`.
function upright(points, thick, x = 0, lean = 0, pivot = 0) {
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(z, y))), { depth: thick, steps: 1, bevelEnabled: true, bevelThickness: 0.14, bevelSize: 0.14, bevelOffset: -0.14, bevelSegments: 2 });
  g.translate(0, 0, -thick / 2).rotateY(-Math.PI / 2).translate(0, -pivot, 0).rotateZ(lean).translate(x, pivot, 0);
  return toCreasedNormals(g, 0.9);
}

// A straight-sided outline's z at this x.
function zOn(points, x) {
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, z0] = points[i], [x1, z1] = points[i + 1];
    if ((x >= x0 && x <= x1) || (x <= x0 && x >= x1)) return z0 + ((z1 - z0) * (x - x0)) / (x1 - x0 || 1);
  }
  return points[points.length - 1][1];
}

// A wing: an airfoil section along the span, thick at the root, drooping to a thin tip.
// o: span, y (at the root), droop (per metre), lead and trail ([x, z] points), t0 and t1 (thickness).
function airfoil(o) {
  const half = (c) => 5 * (0.2969 * Math.sqrt(c) - 0.126 * c - 0.3516 * c * c + 0.2843 * c ** 3 - 0.1036 * c ** 4);
  const midY = (x) => o.y - o.droop * x;
  const thick = (x) => o.t0 + ((o.t1 - o.t0) * x) / o.span;
  const at = (s, x, c, side = 1, lift = 0) => {
    const l = zOn(o.lead, x), t = zOn(o.trail, x);
    const end = Math.max(0, x - (o.span - 0.8)) / 0.8;
    return [s * x, midY(x) + side * (thick(x) * half(c) * Math.sqrt(Math.max(0, 1 - end * end)) + lift), l + (t - l) * c];
  };
  const surface = (s, nu = 28, nv = 28) => gridSurface((u, v) => at(s, o.span * (1 - (1 - u) ** 1.5), (1 - Math.cos(2 * Math.PI * v)) / 2, v <= 0.5 ? 1 : -1), nu, nv, (p) => {
    const x = Math.abs(p.x);
    return new THREE.Vector3(0, p.y - midY(x), p.z - (zOn(o.lead, x) + zOn(o.trail, x)) / 2);
  });
  // A patch on the skin, from its corners as [x, chord] (0 at the front edge, 1 at the back).
  const patch = (s, c, side = 1, lift = 0.03, nu = 10, nv = 4) => gridSurface((u, v) => {
    const mix = (i) => (1 - u) * ((1 - v) * c[0][i] + v * c[3][i]) + u * ((1 - v) * c[1][i] + v * c[2][i]);
    return at(s, mix(0), mix(1), side, lift);
  }, nu, nv, () => new THREE.Vector3(0, side, 0));
  return { at, surface, patch, midY, thick, lead: (x) => zOn(o.lead, x), trail: (x) => zOn(o.trail, x) };
}

// A point on the Leviathan's skin: `deg` round from the side, up is positive.
function hullPoint(stations, s, z, deg, lift = 1) {
  const [w, h, y] = fuseAt(stations, z), a = (deg * Math.PI) / 180;
  const c = Math.cos(a), sn = Math.sin(a);
  return [s * Math.abs(c) ** LEVIATHAN_SQUARE * w * 0.54 * lift, y + Math.sign(sn) * Math.abs(sn) ** LEVIATHAN_SQUARE * h * 0.54 * lift, z];
}

// A patch on the skin, from its corners as [z, deg]. `lift` raises it a hair off the skin.
function hullPatch(stations, s, c, lift = 1.004, nu = 8, nv = 3) {
  return gridSurface((u, v) => {
    const mix = (i) => (1 - u) * ((1 - v) * c[0][i] + v * c[3][i]) + u * ((1 - v) * c[1][i] + v * c[2][i]);
    return hullPoint(stations, s, mix(0), mix(1), lift);
  }, nu, nv, (p) => new THREE.Vector3(p.x, p.y - fuseAt(stations, p.z)[2], 0));
}

// A band round a round body.
function ringBand(x, y, r, z0, z1) {
  return gridSurface((u, v) => {
    const a = v * Math.PI * 2;
    return [x + Math.cos(a) * r, y + Math.sin(a) * r, z0 + (z1 - z0) * u];
  }, 1, 18, (p) => new THREE.Vector3(p.x - x, p.y - y, 0));
}

// Everything on the Leviathan apart from the plain hull.
function leviathanParts(add, group, props, spec, sh) {
  const hull = sh.fuse;
  const smoothLoft = (stations, sides = 14, perGap = 3) => toCreasedNormals(loft(smoothStations(stations, perGap), sides), 1);
  const wing = airfoil({ span: spec.size.width / 2, y: 3, droop: 0.05, lead: [[0, 7], [41, -24]], trail: [[0, -9], [12, -9.5], [41, -28]], t0: 2, t1: 0.35 });
  const tail = airfoil({ span: 12, y: 2.6, droop: 0, lead: [[0, -21], [12, -30.5]], trail: [[0, -34], [12, -34.5]], t0: 0.9, t1: 0.22 });
  const r = 1.05, wy = -spec.gearH + r;

  // The tall fin with its rudder line, on a low strake.
  add.smooth.push(upright(softCorners([[-14, 3.3], [-22.5, 5.5], [-30.5, 14.6], [-35.2, 14.6], [-35.6, 2.8]], 0.5), 0.8));
  add.smoothGrey.push(upright([[-31.5, 5], [-31.6, 14.2], [-31.72, 14.2], [-31.62, 5]], 0.84));

  // Small blade aerials along the spine, and a heavy top turret's ring.
  for (const z of [17, 9, -3]) add.smoothDark.push(upright(softCorners([[z + 0.8, 3.8], [z - 0.4, 5], [z - 0.8, 5], [z - 0.6, 3.8]], 0.08), 0.1));
  const [, dy, dz] = spec.door;
  add.smoothDark.push(cyl(1.3, 1.5, 1.7, 16).rotateX(Math.PI / 2).translate(0, dy - 1.55, dz));
  add.smoothGrey.push(cyl(1.38, 1.38, 0.22, 16).rotateX(Math.PI / 2).translate(0, dy - 0.82, dz));

  // The dark tip of the radar nose.
  add.smoothDark.push(toCreasedNormals(loft(hull.filter(([z]) => z >= 35.2).map(([z, w, h, y]) => [z, w * 1.012, h * 1.012, y]), sh.fuseSides, sh.fuseSquare), 1));
  // Under the chin: two rounded sensor blisters side by side.
  for (const k of [-1, 1]) add.smoothDark.push(revolve([[31.5, 0.08], [30.4, 0.72], [28.6, 0.85], [26.8, 0.08]], k * 0.92, -3.05, 12, 0.8, 8));
  // Rows of bomb bay doors along the belly, between the two pairs of wheels.
  for (let row = 0; row < 5; row++) {
    const z = -6.5 + row * 3.1, y = fuselageBottom(hull, z) + 0.06;
    for (const k of [-1, 1]) add.door.push(box(1.7, 0.14, 2.9, k * 0.95, y, z));
  }
  // Four bogies in a long row under the hull, with the outriggers near the wing tips to balance it.
  // All of it folds away in the air.
  for (const z of [12, -11.7]) {
    for (const k of [-1, 1]) {
      for (const x of [1.3, 2.55]) add.gearTyre.push(cyl(r, r, 0.75, 12).rotateY(Math.PI / 2).translate(k * x, wy, z));
      add.gearLeg.push(box(0.45, -3.2 - wy, 0.7, k * 1.92, (-3.2 + wy) / 2, z));
      add.gearLeg.push(box(1.55, 0.25, 0.32, k * 1.92, wy, z));
      add.gearLeg.push(box(0.1, 1.7, 3.4, k * 2.75, -4.05, z));
    }
  }

  for (const s of [-1, 1]) {
    add.smooth.push(wing.surface(s, 26, 20));
    add.smooth.push(tail.surface(s, 10, 10));

    // Windscreen panes, stepping back and down from the nose, with a row of eyebrow windows over them.
    for (const [z0, z1, a0, a1] of [[28.5, 27.3, 58, 74], [27.2, 26, 52, 70], [25.9, 24.7, 48, 66], [24.6, 23.5, 45, 60], [26.6, 25.6, 76, 84], [25.4, 24.4, 74, 83]]) {
      add.smoothGlass.push(hullPatch(hull, s, [[z0, a0], [z1, a0], [z1, a1], [z0, a1]], 1.006, 2, 2));
    }
    // The small dark fairing on the nose's flank, and a line of tiny vents.
    add.smoothDark.push(revolve([[33.4, 0.05], [32.2, 0.34], [29.4, 0.34], [27.8, 0.05]], s * 2.4, -1.15, 8, 0.65, 8));
    for (const z of [14.5, 13.6, 12.7, -2, -2.9]) add.smoothDark.push(hullPatch(hull, s, [[z + 0.2, -8], [z - 0.2, -8], [z - 0.2, -5], [z + 0.2, -5]], 1.005, 1, 1));
    // Seams round the hull, and long ones down the side.
    for (let z = 22; z > -30; z -= 4) add.smoothDark.push(hullPatch(hull, s, [[z + 0.04, -90], [z - 0.04, -90], [z - 0.04, 90], [z + 0.04, 90]], 1.002, 1, 12));
    for (const a of [-34, 26, 58]) add.smoothDark.push(hullPatch(hull, s, [[23, a], [-28, a], [-28, a + 0.5], [23, a + 0.5]], 1.002, 12, 1));

    // Panel lines, flap line and spoilers on the wing, a darker front edge, and flap track fairings under it.
    for (const side of [-1, 1]) {
      add.smoothGrey.push(wing.patch(s, [[3, 0], [41, 0], [41, 0.05], [3, 0.05]], side, 0.015, 22, 2));
      add.smoothDark.push(wing.patch(s, [[3, 0.74], [38, 0.74], [38, 0.755], [3, 0.755]], side, 0.015, 18, 1));
    }
    for (const c of [0.26, 0.48]) add.smoothDark.push(wing.patch(s, [[4, c], [39, c], [39, c + 0.01], [4, c + 0.01]], 1, 0.015, 18, 1));
    for (let x = 6; x < 39; x += 4) add.smoothDark.push(wing.patch(s, [[x, 0.05], [x + 0.06, 0.05], [x + 0.06, 0.74], [x, 0.74]], 1, 0.015, 1, 3));
    for (const x of [5, 9, 13, 17, 21, 25]) add.smoothGrey.push(wing.patch(s, [[x, 0.62], [x + 3.2, 0.62], [x + 3.2, 0.67], [x, 0.67]], 1, 0.02, 2, 1));
    for (const x of [6, 11, 19, 23, 31]) {
      const t = wing.trail(x), y = wing.midY(x) - wing.thick(x) * 0.24;
      add.smooth.push(revolve([[t + 3.6, 0.04], [t + 2, 0.32], [t, 0.34], [t - 2.2, 0.04]], s * x, y, 8, 1, 6));
    }
    // The tailplane's edge, and its elevator line.
    for (const side of [-1, 1]) add.smoothGrey.push(tail.patch(s, [[2, 0], [12, 0], [12, 0.08], [2, 0.08]], side, 0.015, 8, 1));
    add.smoothDark.push(tail.patch(s, [[2, 0.68], [11.5, 0.68], [11.5, 0.7], [2, 0.7]], 1, 0.015, 8, 1));

    // The big stores pylon between hull and engines, with two long missiles slung under it.
    {
      const y = 0.85, z = 0;
      add.smoothDark.push(upright(softCorners([[wing.lead(9.6) - 1, 2.5], [wing.lead(9.6) - 9, 2.5], [-9.4, y], [3.4, y]], 0.4), 0.8, s * 9.6));
      add.smoothDark.push(box(3.3, 0.35, 12, s * 9.6, y - 0.1, z - 3));
      // A white glider on a grey booster.
      const ax = s * 8.75, by = y - 0.95;
      add.smoothWhite.push(revolve([[6.4, 0.06], [5.5, 0.26], [3, 0.58], [0.2, 0.62]], ax, by, 12, 0.7, 8));
      add.smoothGrey.push(revolve([[0.3, 0.62], [-0.2, 0.74], [-6.4, 0.74], [-7.4, 0.5]], ax, by, 12, 1, 6));
      for (const k of [0.785, 2.356]) add.smoothDark.push(box(2.3, 0.08, 1.4).rotateZ(k).translate(ax, by, -6.5));
      // A dark one with red bands.
      const cx = s * 10.45;
      add.smoothDark.push(revolve([[5.2, 0.05], [3.8, 0.42], [1.8, 0.56], [-7.4, 0.56], [-8, 0.34]], cx, by, 12, 1, 8));
      for (const zz of [1.6, -0.8, -6]) add.smoothRed.push(ringBand(cx, by, 0.585, zz, zz - 0.5));
      for (const k of [0.785, 2.356]) add.smoothGrey.push(box(1.8, 0.07, 1.1).rotateZ(k).translate(cx, by, -7.3));
    }

    // Fixed fuel tank under each outer wing.
    {
      const x = 35.5, l = wing.lead(x) - 2, y = wing.midY(x) - wing.thick(x) * 0.4 - 1.05;
      add.smooth.push(revolve([[l + 6, 0.05], [l + 3.6, 0.62], [l, 0.82], [l - 3.8, 0.62], [l - 6.2, 0.05]], s * x, y, 12, 1, 12));
      add.smoothDark.push(upright([[l + 1.6, y + 1.2], [l - 2, y + 1.2], [l - 2, y + 0.6], [l + 1, y + 0.6]], 0.2, s * x));
    }
    // The outrigger: a long thin leg down from under the wing, a small pair of wheels at the bottom.
    {
      const x = 30, z = wing.lead(x) - 1.6, top = wing.midY(x) - wing.thick(x) * 0.3, wr = 0.62, wb = -spec.gearH + wr;
      add.smooth.push(revolve([[z + 1.6, 0.05], [z + 0.6, 0.42], [z - 0.8, 0.42], [z - 2.2, 0.05]], s * x, top - 0.25, 10, 1, 6));
      add.gearLeg.push(box(0.2, top - wb, 0.32, s * x, (top + wb) / 2, z));
      for (const k of [-1, 1]) add.gearTyre.push(cyl(wr, wr, 0.3, 10).rotateY(Math.PI / 2).translate(s * x + k * 0.26, wb, z));
    }

    // The engines: four pods, two jets side by side in each, on swept-forward pylons out ahead of the wing.
    for (const [px, er] of [[14.5, 1.35], [25.5, 1.3]]) {
      const l = wing.lead(px), under = wing.midY(px) - wing.thick(px) * 0.42;
      const y = under - er - 1.1, front = l + 7.5, back = l - 4.5;
      // The pod's body between and around the two jets.
      add.smooth.push(smoothLoft([[front - 1.3, er * 1.5, er * 0.9, y], [front - 3, er * 2.1, er * 1.6, y], [back + 3, er * 2.1, er * 1.5, y], [back + 0.8, er * 1.2, er * 0.6, y]], 12));
      for (const k of [-1, 1]) {
        const x = s * px + k * (er + 0.08);
        add.smooth.push(revolve([[front, er * 0.82], [front - 0.5, er], [front - 3.4, er * 1.03], [front - 6.5, er * 0.96], [back + 1.4, er * 0.76]], x, y, 16, 1, 10));
        add.smoothGrey.push(new THREE.TorusGeometry(er * 0.84, er * 0.07, 6, 18).toNonIndexed().translate(x, y, front));
        add.smoothDark.push(new THREE.CircleGeometry(er * 0.84, 18).toNonIndexed().translate(x, y, front - 0.7));
        add.smoothDark.push(ringBand(x, y, er * 1.038, front - 3.7, front - 3.84));
        const fan = propeller(er * 0.78, 12, front - 0.4, x, y, 0x777a7e);
        fan.userData.dir = s;
        group.add(fan);
        props.push(fan);
        add.smoothGrey.push(revolve([[back + 1.5, er * 0.76], [back + 0.2, er * 0.62], [back - 0.8, er * 0.5]], x, y, 14, 1, 4));
        add.smoothDark.push(new THREE.CircleGeometry(er * 0.5, 14).toNonIndexed().rotateY(Math.PI).translate(x, y, back - 0.78));
      }
      // The pylon sweeps forward and down from the wing's front edge.
      add.smooth.push(upright(softCorners([[l - 3.6, under + 0.5], [l + 0.6, under + 0.5], [front - 2.2, y + er * 0.55], [back + 1.4, y + er * 0.55]], 0.25), 0.55, s * px));
    }
  }
}

// A flat-sided fin standing up along the body, sharp corners and all.
function flatFin(points, thick) {
  return new THREE.ExtrudeGeometry(new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(z, y))), { depth: thick, bevelEnabled: false }).toNonIndexed().translate(0, 0, -thick / 2).rotateY(-Math.PI / 2);
}

// Everything on the helicopter apart from the plain hull: flat facets, like the tanks.
function heliParts(add, group, props, spec, sh, otherGun) {
  // Two sets of stepped glass, one behind and above the other, framed in dark.
  add.glass.push(loft([[5, 0.3, 0.2, 0.42], [4, 0.95, 0.75, 0.62], [3, 1.02, 0.86, 0.78], [2.3, 0.3, 0.2, 0.9]], 6));
  add.glass.push(loft([[3, 0.3, 0.2, 1], [2, 1.02, 0.8, 1.05], [0.9, 1.06, 0.92, 1.18], [0.1, 0.3, 0.2, 1.22]], 6));
  add.dark.push(box(0.06, 0.1, 2.6, 0, 1.32, 1.55), box(0.06, 0.08, 2.2, 0, 0.98, 3.7));
  for (const z of [3.05, 2, 0.95]) add.dark.push(box(1.08, 0.05, 0.05, 0, z < 2.5 ? 1.5 : 1.1, z));
  // The engine hump and its two black exhausts, the mast, and the rotor head.
  add.body.push(loft([[0.9, 0.3, 0.2, 1.05], [-0.2, 1.1, 0.95, 1.2], [-2.1, 1.15, 0.9, 1.15], [-3.3, 0.4, 0.25, 0.85]], 6));
  for (const s of [-1, 1]) add.dark.push(cyl(0.2, 0.15, 0.7, 6, s * 0.42, 1.08, -2.7));
  add.dark.push(cyl(0.16, 0.2, 0.95, 6).rotateX(Math.PI / 2).translate(0, 1.95, -0.6));
  // A sensor ball under the nose.
  add.dark.push(new THREE.IcosahedronGeometry(0.42, 0).toNonIndexed().translate(0, -0.92, 5.05));
  // A swept tail fin, a smaller one under the boom, and a tailplane.
  add.body.push(flatFin([[-6.4, 0.8], [-7.7, 2.4], [-8.8, 2.4], [-8.6, 0.8]], 0.14));
  add.body.push(flatFin([[-7.6, 0.75], [-8.5, -0.2], [-8.95, -0.2], [-8.6, 0.75]], 0.1));
  for (const g of both(panel(0.14, 1.5, 0.78, 0.84, -5.2, -5.9, -5.55, -5.95, 0.1, 0.05))) add.body.push(g);
  // Stub wings, with a minigun under the end of each. One is the gunner's when there is a gunner.
  for (const g of both(panel(0.55, 2.55, 0.12, -0.02, 1.1, -0.4, 0.7, -0.1, 0.2, 0.1))) add.body.push(g);
  for (const s of [-1, 1]) add.dark.push(box(0.14, 0.2, 0.5, s * 2.3, -0.12, 0.35));
  otherGun.position.set(2.3, -0.3, 0.35);
  group.add(otherGun);
  // Skids.
  const fy = -spec.gearH + 0.08;
  for (const s of [-1, 1]) {
    add.dark.push(cyl(0.08, 0.08, 5.2, 5, s * 1.1, fy, 0.6));
    add.dark.push(new THREE.ConeGeometry(0.08, 0.5, 5).rotateX(0.7).toNonIndexed().translate(s * 1.1, fy + 0.16, 3.4));
    for (const z of [2.1, -0.9]) add.metal.push(box(0.08, 0.08, 0.1, s * 0.85, fy + 0.32, z), box(0.08, 0.5, 0.1, s * 1.05, fy + 0.2, z));
  }
  for (const z of [2.1, -0.9]) add.metal.push(box(1.8, 0.09, 0.1, 0, fy + 0.5, z));
  // The main rotor, flat above the hump, and the tail rotor on the left of the fin.
  const main = rotorDisc(6.6, 4, 0.34);
  main.position.set(0, 2.5, -0.6);
  main.rotation.x = -Math.PI / 2;
  group.add(main);
  props.push(main);
  const tailR = rotorDisc(1.25, 3, 0.16);
  tailR.position.set(0.24, 1.35, -8.3);
  tailR.rotation.y = Math.PI / 2;
  tailR.userData.dir = 1.4;
  group.add(tailR);
  props.push(tailR);
}

// A helicopter rotor: long thin blades, and the blur they turn into.
function rotorDisc(r, blades, width) {
  const g = new THREE.Group();
  const parts = [new THREE.CylinderGeometry(r * 0.05, r * 0.07, 0.3, 6).rotateX(Math.PI / 2).toNonIndexed()];
  for (let i = 0; i < blades; i++) parts.push(box(width, r, 0.05, 0, r / 2, 0).rotateZ((i / blades) * Math.PI * 2));
  g.add(new THREE.Mesh(merged(parts), mat(0x1a1b1d)));
  const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 32), new THREE.MeshBasicMaterial({ color: 0x15161a, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false }));
  disc.visible = false;
  g.add(disc);
  g.userData.disc = disc;
  return g;
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
  const add = { body: [], shade: [], dark: [], metal: [], nose: [], glass: [], belly: [], plate: [], rivet: [], door: [], stripe: [], amber: [], exhaust: [], white: [], smooth: [], smoothDark: [], smoothRed: [], smoothGrey: [], smoothWhite: [], smoothGlass: [], gearTyre: [], gearLeg: [] };

  if (sh.smooth) add.smooth.push(toCreasedNormals(loft(sh.fuse, sh.fuseSides ?? 8, sh.fuseSquare ?? 1), 1));
  else add.body.push(loft(sh.fuse, sh.fuseSides ?? 8));
  sh.wing(add);
  // Tailplane.
  const t = sh.tail;
  if (t) for (const g of both(panel(0.08, t.span, t.y, t.y + 0.05, t.z + t.chord * 0.55, t.z - t.chord * 0.45, t.z + t.chord * 0.25, t.z - t.chord * 0.3, t.t ?? 0.12, (t.t ?? 0.12) * 0.42))) add.body.push(g);
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
  let otherGun = null;
  if (type === 'heli') {
    otherGun = buildMinigun(1.5);
    heliParts(add, group, props, spec, sh, otherGun.group);
  }
  let flame = null;
  if (sh.jet) {
    // The nozzle, and the flame that comes out of it.
    add.dark.push(cyl(0.62, 0.5, 1.2, 10, 0, 0, -7.6));
    add.metal.push(cyl(0.64, 0.64, 0.3, 10, 0, 0, -7.05));
    flame = afterburner(-8.2);
    group.add(flame);
  }

  // Colour accents.
  for (const [z0, z1] of sh.nose ?? []) add.nose.push(loft([[z0, 0.3, 0.3, sh.fuse[0][3]], [z1, sh.fuse[1][1] * 1.04, sh.fuse[1][2] * 1.04, sh.fuse[1][3]]], sh.fuseSides ?? 8));
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
      add.metal.push(box(0.1, spec.gearH - 0.3, 0.12, s * (sh.gearX ?? 1.25), -spec.gearH / 2 + 0.05, -1.2));
      add.dark.push(wheel(s * (sh.gearX ?? 1.25), -1.2, 0.32));
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
  if (spec.bombs && !sh.internalBombs) {
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
  if (spec.rockets?.count && !sh.noRails) {
    for (const s of [-1, 1]) for (const k of [0, 1]) {
      const x = s * (gx * 0.75 + k * 0.75), y = sh.railY ?? gy2 - 0.34, z = sh.railZ ?? 0.2;
      add.metal.push(box(0.05, 0.14, 1.3, x, y + 0.14, z));
      add.dark.push(cyl(0.065, 0.065, 0.95, 6, x, y, z), new THREE.ConeGeometry(0.065, 0.24, 6).rotateX(Math.PI / 2).toNonIndexed().translate(x, y, z + 0.6));
      add.metal.push(box(0.26, 0.015, 0.2, x, y, z - 0.42), box(0.015, 0.26, 0.2, x, y, z - 0.42));
    }
  }

  const painted = paintMaterial(paint, team, 1);
  const shaded = paintMaterial(paint, team, 0.82);
  const addMesh = (list, material, camo = false, parent = group) => {
    if (!list.length) return null;
    const g = merged(list);
    if (camo) g.setAttribute('camoPos', g.attributes.position.clone());
    const m = new THREE.Mesh(g, material);
    m.castShadow = true;
    parent.add(m);
    return m;
  };
  addMesh(add.body, painted, true);
  addMesh(add.shade, shaded, true);
  addMesh(add.plate, mat(0x4b5057, { roughness: 0.6, metalness: 0.25 }));
  addMesh(add.rivet, mat(0xa2a6a8, { roughness: 0.5, metalness: 0.3 }));
  addMesh(add.door, mat(0x34373a, { roughness: 0.7, metalness: 0.2 }));
  addMesh(add.stripe, mat(0xd9a820));
  addMesh(add.white, mat(0xe8e4d4));
  addMesh(add.smooth, paintMaterial(paint, team, 1, true), true);
  addMesh(add.smoothDark, mat(0x141416, { flatShading: false, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  addMesh(add.smoothRed, mat(0xa81c1c, { flatShading: false, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  addMesh(add.smoothGrey, mat(0x3f4348, { flatShading: false, roughness: 0.45, metalness: 0.4, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  addMesh(add.smoothWhite, mat(0xe6e4dc, { flatShading: false, roughness: 0.5 }));
  addMesh(add.smoothGlass, mat(0x0d1216, { flatShading: false, roughness: 0.12, metalness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  // Landing gear that folds away in the air.
  let foldingGear = null;
  if (add.gearTyre.length) {
    foldingGear = new THREE.Group();
    group.add(foldingGear);
    addMesh(add.gearTyre, mat(0x141416, { flatShading: false, roughness: 0.8 }), false, foldingGear);
    addMesh(add.gearLeg, METAL(), false, foldingGear);
  }
  addMesh(add.amber, new THREE.MeshStandardMaterial({ color: 0xe8b23a, emissive: 0x7a4c0c, flatShading: true, roughness: 0.4 }));
  if (add.exhaust.length) addMesh(add.exhaust, new THREE.MeshBasicMaterial({ color: 0xffb070, toneMapped: false })).castShadow = false;
  addMesh(add.dark, DARK());
  addMesh(add.metal, METAL());
  addMesh(add.glass, GLASS());
  if (add.nose.length) addMesh(add.nose, mat(sh.noseColor));
  if (add.belly.length) addMesh(add.belly, mat(sh.belly));

  // Rear gun on its pivot.
  let rear = null, rearSpin = null, otherSpin = null;
  if (spec.rear) {
    const [dx, dy, dz] = spec.door;
    rear = new THREE.Group();
    rear.position.set(dx, dy, dz);
    rear.rotation.order = 'YXZ';
    rear.rotation.y = -Math.PI / 2;
    const minigun = buildMinigun(dx ? 1.5 : 3.2); // a top turret is a far heavier gun
    rear.add(minigun.group);
    rearSpin = minigun.spin;
    otherSpin = otherGun?.spin ?? null;
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
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(r, r, (sh.markT ?? 0.3) + i * 0.03, sh.markSegs ?? 12), mat(c));
      disc.position.set(side * (sh.discX ?? mx), my, sh.markZ ?? 0.2);
      disc.rotation.z = -side * (sh.markRoll ?? 0);
      group.add(disc);
    });
  }
  if (sh.finFlash) group.add(new THREE.Mesh(box(sh.finFlash[2] ?? 0.17, sh.finFlash[3] ?? 0.5, sh.finFlash[4] ?? 1.3, 0, sh.finFlash[0], sh.finFlash[1]), mat(mark)));
  if (sh.teamMark) group.add(new THREE.Mesh(sh.teamMark(), mat(mark)));
  if (!sh.noBar) {
    const bar = new THREE.Mesh(box(0.05, 0.5, 1.1, 0, (sh.fuse[3][3] ?? 0) + 0.1, sh.fuse[4][0] * 0.8), mat(mark));
    bar.scale.x = (sh.fuse[4][1] ?? 1) / 0.05 * 1.02;
    group.add(bar);
  }

  // Fog would fade it into the haze however large it is, so it stays out of the fog.
  if (spec.seeFar) group.traverse((o) => o.isMesh && (o.material = clearOfFog(o.material)));

  return { group, props, rear, rearSpin, otherSpin, foldingGear, engineZ, engineX, cockpitY: sh.cockpitY, spec, type, turret: null, flame, shadowShape: type === 'leviathan' ? wingShadow(spec) : null };
}

const fogFree = new Map();
function clearOfFog(material) {
  if (!fogFree.has(material)) {
    const m = material.clone();
    m.fog = false;
    // A clone doesn't keep these, and the camouflage shader lives in them.
    m.onBeforeCompile = material.onBeforeCompile;
    m.customProgramCacheKey = material.customProgramCacheKey;
    // So big that its underside is most of what you see: a little light keeps it from going black.
    if (Object.hasOwn(material, 'onBeforeCompile')) m.emissive.setHex(0x1e1a1c);
    fogFree.set(material, m);
  }
  return fogFree.get(material);
}

// The Leviathan's outline as a flat dark shape to lay on the ground under it.
function wingShadow(spec) {
  const w = spec.size.width / 2;
  const half = [[2.2, 34], [2.9, 20], [2.9, 5], [w, -24], [w, -28], [12, -9.5], [2.9, -9.5], [2, -21], [12, -30.5], [12, -34.5], [0.6, -35]];
  const outline = new THREE.Shape([[0.5, 36], ...half, [0, -36], ...half.map(([x, z]) => [-x, z]).reverse(), [-0.5, 36]].map(([x, z]) => new THREE.Vector2(x, z)));
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
  const hw = f.hw ?? 0.07;
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
