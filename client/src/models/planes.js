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
  // Two waterdrop hulls side by side, two smooth wings running through them and four long engines
  // joining the wings. Most of it is in leviathanParts below.
  leviathan: {
    mark: [47, 3.8], discX: 21, markR: 1.4, markT: 1.25, markZ: -3, railY: 2.9, railZ: -12, noWingGuns: true, internalBombs: true, fuseSides: 12, smooth: true,
    fuse: [[22, 8, 11, 3.5], [14, 10, 13, 3.5], [2, 10, 13.5, 3.5], [-14, 8, 10, 4], [-30, 2, 2, 5]],
    wing: () => {},
    canopy: [2, 1, 1, 0.3], canopyY: 3, gear: 'massive', cockpitY: 6, guns: [],
    engineX: 17, engineZ: -6,
  },
  f16: {
    mark: [3.1, -0.05], discX: 4.3, markR: 0.46, markZ: -2.05, markT: 0.24, railY: -0.3, railZ: -1.25, jet: true,
    noWingGuns: true, guns: [[0.72, 0.42, 3.3]], nose: [[7.45, 5.5]], noseColor: 0x4a4f55, finFlash: [2.75, -5.25],
    fuse: TALON_FUSE,
    wing: talonDetails,
    tail: { z: -5.8, span: 3.7, chord: 1.9, y: -0.05 }, fin: { z: -4.6, h: 2.7, chord: 2.8, y: 0.45 },
    canopy: [3.3, 2.7, 0.82, 0.92], gear: 'tricycle', cockpitY: 0.95, engineX: 0, engineZ: -6.4,
  },
  // The Leviathan's little escort, in its colours: a fat crimson body, an amber dome, striped wings.
  escort: {
    mark: [3.6, 0], markR: 0.45, markT: 0.24, markZ: -1, noWingGuns: true, internalBombs: true,
    fuse: [[3.6, 1.6, 1.6, 0], [2, 2.5, 2.4, 0.1], [-0.8, 2.3, 2.2, 0.2], [-2.8, 1.2, 1.1, 0.3], [-4.4, 0.3, 0.3, 0.4]],
    wing: (add) => {
      for (const g of both(panel(0.8, 5.5, 0, 0.3, 1.4, -1.6, -0.9, -2.2, 0.3, 0.08))) add.body.push(g);
      add.amber.push(new THREE.IcosahedronGeometry(1.15, 1).scale(1, 1, 1.2).translate(0, 0.05, 3.4));
      add.dark.push(new THREE.ConeGeometry(0.35, 1.8, 6).rotateX(Math.PI / 2).toNonIndexed().translate(0, 0.05, 5));
      add.dark.push(finGeoUp({ z: -3, h: 1.6, chord: 1.8, y: 0.6, hw: 0.08 }));
      add.exhaust.push(new THREE.ConeGeometry(0.3, 1.6, 8).rotateX(-Math.PI / 2).toNonIndexed().translate(0, 0.4, -5.1));
      for (const s of [-1, 1]) {
        add.plate.push(box(0.5, 0.04, 1.3, s * 3, 0.26, -0.9));
        add.dark.push(finGeoUp({ z: -1.9, h: 0.8, chord: 1.1, y: 0.25, hw: 0.05 }, s * 5.4));
      }
    },
    canopy: [0.5, 0.6, 0.4, 0.2], canopyY: 1.15, gear: 'tricycle', gearX: 1, cockpitY: 0.8, engineX: 0, engineZ: -3,
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

// A round body along Z through a smooth line of [z, radius] points.
function revolve(profile, x, y, sides = 16) {
  const line = new THREE.SplineCurve(profile.map(([z, r]) => new THREE.Vector2(z, r)));
  return gridSurface((u, v) => {
    const q = line.getPoint(u), a = v * Math.PI * 2 - Math.PI / 2;
    return [x + Math.cos(a) * q.y, y + Math.sin(a) * q.y, q.x];
  }, 24, sides, (p) => new THREE.Vector3(p.x - x, p.y - y, 0));
}

// A flat plate with softly rounded edges, from its outline seen from above ([x, z] points).
function softPlate(points, thick, y, edge = 0.14) {
  const g = new THREE.ExtrudeGeometry(new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, z))), { depth: thick, steps: 1, bevelEnabled: true, bevelThickness: edge, bevelSize: edge, bevelOffset: -edge, bevelSegments: 2 });
  g.rotateX(Math.PI / 2).translate(0, y + thick / 2, 0);
  return toCreasedNormals(g, 0.9);
}

// An upright fin with a raked, curved edge, seen side on.
function softFin(x, z, y, h, chord) {
  const shape = new THREE.Shape();
  shape.moveTo(chord * 0.55, 0);
  shape.quadraticCurveTo(chord * 0.1, h * 0.55, -chord * 0.42, h);
  shape.quadraticCurveTo(-chord * 0.62, h * 0.95, -chord * 0.5, h * 0.7);
  shape.lineTo(-chord * 0.45, 0);
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.5, steps: 1, bevelEnabled: true, bevelThickness: 0.2, bevelSize: 0.16, bevelOffset: -0.16, bevelSegments: 2, curveSegments: 10 });
  g.translate(0, 0, -0.25).rotateY(-Math.PI / 2).translate(x, y, z);
  return toCreasedNormals(g, 0.9);
}

const sampleCurve = (curve, n = 22) => curve.getPoints(n).map((q) => [q.x, q.y]);
// The curve's z at this x, from sampled points in order of x.
function zOn(points, x) {
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, z0] = points[i], [x1, z1] = points[i + 1];
    if ((x >= x0 && x <= x1) || (x <= x0 && x >= x1)) return z0 + ((z1 - z0) * (x - x0)) / (x1 - x0 || 1);
  }
  return points[points.length - 1][1];
}

// The waterdrop: round at the nose, drawing out to a point at the tail, the tails leaning together.
const DROP = { r: 7.3, x: 7, y: 3.6, nose: 36, length: 70, cap: 0.14, tall: 1.12 };
function dropPoint(s, t, a, grow = 1) {
  const u = Math.max(0, (t - DROP.cap) / (1 - DROP.cap));
  const r = t < DROP.cap ? DROP.r * Math.sqrt(Math.max(0, 1 - ((DROP.cap - t) / DROP.cap) ** 2)) : DROP.r * (1 - u ** 1.8);
  return [s * DROP.x * (1 - 0.6 * u * u) + Math.cos(a) * r * grow, DROP.y + 2.2 * u * u + Math.sin(a) * r * DROP.tall * grow, DROP.nose - DROP.length * t];
}

// The two window pictures, drawn once: yellow panes with red lines.
let dropGlass = null;
function dropWindows() {
  if (dropGlass) return dropGlass;
  const sheet = (draw) => {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const ctx = c.getContext('2d');
    const at = ([x, y]) => [256 + x * 256, 256 - y * 256];
    const poly = (pts, fill, line, width) => {
      ctx.beginPath();
      pts.forEach((q, i) => (i ? ctx.lineTo(...at(q)) : ctx.moveTo(...at(q))));
      ctx.closePath();
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fill();
      }
      if (line) {
        ctx.strokeStyle = line;
        ctx.lineWidth = width;
        ctx.lineJoin = 'round';
        ctx.stroke();
      }
    };
    const seg = (a, b, line, width) => {
      ctx.beginPath();
      ctx.moveTo(...at(a));
      ctx.lineTo(...at(b));
      ctx.strokeStyle = line;
      ctx.lineWidth = width;
      ctx.stroke();
    };
    draw(ctx, poly, seg, at);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, roughness: 0.3, metalness: 0.1, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.32 });
  };
  const RED = '#a01a1a', GOLD = '#f6c61e', ORANGE = '#e9801a', BLACK = '#141414';
  // From the front: a black visor, an orange band, and under it a big pentagon cut into panes by red
  // lines, with a smaller pentagon in the middle.
  const front = sheet((ctx, poly, seg, at) => {
    ctx.fillStyle = BLACK;
    ctx.beginPath();
    ctx.ellipse(...at([0, 0.33]), 0.5 * 256, 0.32 * 256, 0, Math.PI, 0);
    ctx.fill();
    poly([[-0.74, 0.33], [0.74, 0.33], [0.78, 0.13], [-0.78, 0.13]], ORANGE, RED, 9);
    const outer = [[-0.78, 0.13], [0.78, 0.13], [0.66, -0.34], [0, -0.78], [-0.66, -0.34]];
    const inner = [[-0.38, 0.13], [0.38, 0.13], [0.46, -0.16], [0, -0.48], [-0.46, -0.16]];
    poly(outer, GOLD, RED, 15);
    poly(inner, '#ffd84a', RED, 11);
    seg(inner[2], outer[2], RED, 11);
    seg(inner[3], outer[3], RED, 11);
    seg(inner[4], outer[4], RED, 11);
    poly(outer, null, RED, 15);
    for (const x of [-0.4, 0, 0.4]) seg([x, 0.33], [x, 0.13], RED, 7);
  });
  // From above: a cluster of panes along the top of the hull.
  const top = sheet((ctx, poly, seg) => {
    const outer = [[0, 0.96], [0.72, 0.5], [0.78, -0.4], [0.36, -0.92], [-0.36, -0.92], [-0.78, -0.4], [-0.72, 0.5]];
    const inner = [[0, 0.42], [0.34, 0.2], [0.34, -0.22], [0, -0.44], [-0.34, -0.22], [-0.34, 0.2]];
    poly(outer, GOLD, BLACK, 18);
    poly(inner, '#ffd84a', RED, 10);
    seg(inner[0], outer[0], RED, 10);
    seg(inner[1], outer[1], RED, 10);
    seg(inner[2], outer[2], RED, 10);
    seg(inner[3], [0, -0.92], RED, 10);
    seg(inner[4], outer[5], RED, 10);
    seg(inner[5], outer[6], RED, 10);
    poly(outer, null, BLACK, 18);
  });
  dropGlass = { front, top };
  return dropGlass;
}

// Everything on the doomship: two waterdrop hulls with their windows, smooth wings through their
// middles, four long engines, three fins, lower pods, undercarriage, bomb bays and turret.
function leviathanParts(add, group, props, spec, sh) {
  // The big wing's outline, one side, out along the front and back along the rear.
  const bigFront = sampleCurve(new THREE.CubicBezierCurve(new THREE.Vector2(0, 16), new THREE.Vector2(14, 13), new THREE.Vector2(28, 2), new THREE.Vector2(40, -17)));
  const bigTip = sampleCurve(new THREE.QuadraticBezierCurve(new THREE.Vector2(40, -17), new THREE.Vector2(42.4, -21), new THREE.Vector2(40.6, -26)), 8);
  const bigBack = sampleCurve(new THREE.CubicBezierCurve(new THREE.Vector2(40.6, -26), new THREE.Vector2(33, -17), new THREE.Vector2(22, -9), new THREE.Vector2(10, -8)));
  const smallFront = sampleCurve(new THREE.CubicBezierCurve(new THREE.Vector2(0, -13), new THREE.Vector2(10, -14), new THREE.Vector2(20, -16), new THREE.Vector2(30, -20)));
  const smallTip = sampleCurve(new THREE.QuadraticBezierCurve(new THREE.Vector2(30, -20), new THREE.Vector2(32, -23.5), new THREE.Vector2(30.6, -28)), 8);
  const twoSides = (half) => [...half, ...half.map(([x, z]) => [-x, z]).reverse()];
  const WY = 3.8, RY = 4.6;
  add.smooth.push(softPlate(twoSides([...bigFront, ...bigTip.slice(1), ...bigBack.slice(1), [0, -8]]), 0.8, WY, 0.25));
  add.smooth.push(softPlate(twoSides([...smallFront, ...smallTip.slice(1), [0, -26]]), 0.7, RY, 0.2));
  const wingTop = WY + 0.42;
  for (const s of [-1, 1]) {
    const flip = (pts) => pts.map(([x, z]) => [s * x, z]);
    // Each hull is a waterdrop, and the wings run in through its sides.
    const hull = (t, a, grow) => dropPoint(s, t, a, grow);
    const away = (p) => new THREE.Vector3(p.x - s * DROP.x, p.y - DROP.y, 0);
    add.smooth.push(gridSurface((u, v) => hull(u * u, v * Math.PI * 2 - Math.PI / 2), 40, 28, away));
    if (typeof document !== 'undefined') {
      const glass = dropWindows();
      // The front window, tiled on to the nose as seen straight on.
      // Lifted clear of the hull along the view as well, or the two fight over which is in front.
      const front = gridSurface((u, v) => {
        const q = hull(DROP.cap * u * u, v * Math.PI * 2 - Math.PI / 2, 1.008);
        return [q[0], q[1], q[2] + 0.12 * (1 - u)];
      }, 18, 32, away, (p) => [0.5 + ((p[0] - s * DROP.x) / DROP.r) * 0.5, 0.5 + ((p[1] - DROP.y) / (DROP.r * DROP.tall)) * 0.5]);
      group.add(new THREE.Mesh(front, glass.front));
      // The window on top: a raised bubble, tall enough to see from the front too.
      const bubble = (grow) => (u, v) => {
        const lat = (u * Math.PI) / 2, lon = v * Math.PI * 2;
        return [s * DROP.x + Math.sin(lat) * Math.cos(lon) * 5.4 * grow, DROP.y + DROP.r * DROP.tall - 1.2 + Math.cos(lat) * 2.6 * grow, 18 + Math.sin(lat) * Math.sin(lon) * 9.6 * grow];
      };
      const up = (p) => new THREE.Vector3(p.x - s * DROP.x, 1, p.z - 18);
      add.smooth.push(gridSurface(bubble(1), 12, 28, up));
      group.add(new THREE.Mesh(gridSurface(bubble(1.012), 12, 28, up, (p) => [0.5 + (p[0] - s * DROP.x) / 11.4, 0.5 + (p[2] - 18) / 20]), glass.top));
    }
    // A black chin under the window, and two black spikes raked forward from under the hull.
    add.smoothDark.push(new THREE.SphereGeometry(3, 18, 12).toNonIndexed().scale(1.15, 0.9, 1).translate(s * DROP.x, DROP.y - 3.4, 33.6));
    for (const k of [-1, 1]) {
      add.smoothDark.push(new THREE.ConeGeometry(0.8, 5, 12).toNonIndexed().rotateX(2).rotateZ(k * -0.4).translate(s * DROP.x + k * 4, DROP.y - 6.4, 28));
    }

    // The big wing's thick black front edge and tip; its back edge stays crimson.
    const edge = bigFront.filter(([x]) => x >= 12.5);
    add.smoothDark.push(softPlate(flip([...edge, ...bigTip.slice(1), ...[...edge].reverse().map(([x, z]) => [x, z - 2.3])]), 0.92, WY));
    // Dark raked stripes and gold studs on it.
    for (const px of [20.6, 28, 31.5, 35]) {
      const l = zOn(bigFront, px), t = zOn(bigBack, px);
      add.wingStripe.push(softPlate(flip([[px - 0.7, l - 2.6], [px + 0.7, l - 3.3], [px + 0.7, t + 0.6], [px - 0.7, t + 0.9]]), 0.1, wingTop + 0.04, 0.03));
    }
    for (const [px, pz] of [[20.6, 6.4], [13, -4], [26, -7], [33, -11], [37, -19]]) add.smoothGold.push(new THREE.CylinderGeometry(0.55, 0.55, 0.12, 14).toNonIndexed().translate(s * px, wingTop + 0.08, pz));

    // Two long engines each side, joining the wings: crimson cowl, black ring and yellow centre in front.
    for (const [px, plume] of [[17, true], [24, false]]) {
      const l = zOn(bigFront, px) + 2, end = -31;
      // Crimson lip, a black band behind it, crimson along the wings, black again at the back.
      add.smooth.push(revolve([[l + 4.7, 2.3], [l + 4.3, 3.1], [l + 2.5, 3.5], [l + 1.2, 3.55]], s * px, WY));
      add.smoothDark.push(revolve([[l + 1.2, 3.58], [l - 1, 3.62], [l - 3.4, 3.6]], s * px, WY));
      add.smooth.push(revolve([[l - 3.4, 3.55], [l - 8, 3.45], [-12, 3.3], [-17, 3.05]], s * px, WY));
      add.smoothDark.push(revolve([[-17, 3.1], [-22, 2.85], [end + 3, 2.2], [end, 1.9], [end - 0.4, 1.4]], s * px, WY));
      add.smoothDark.push(new THREE.CircleGeometry(2.45, 20).toNonIndexed().translate(s * px, WY, l + 4.55));
      add.smoothGold.push(new THREE.SphereGeometry(1.3, 16, 10).toNonIndexed().scale(1, 1, 0.55).translate(s * px, WY, l + 4.5));
      add.smoothGold.push(new THREE.TorusGeometry(3.66, 0.16, 8, 22).toNonIndexed().translate(s * px, WY, l - 3.4));
      add.smoothGold.push(new THREE.TorusGeometry(3.12, 0.16, 8, 22).toNonIndexed().translate(s * px, WY, -17));
      if (plume) {
        // The inner pair fire tall violet plumes.
        add.smoothGold.push(new THREE.TorusGeometry(1.75, 0.2, 8, 18).toNonIndexed().translate(s * px, WY, end - 0.3));
        add.exhaust.push(new THREE.CircleGeometry(1.5, 16).toNonIndexed().rotateY(Math.PI).translate(s * px, WY, end - 0.42));
        add.plume.push(new THREE.ConeGeometry(1.5, 9, 14).rotateX(-Math.PI / 2).toNonIndexed().translate(s * px, WY, end - 4.9));
        add.exhaust.push(new THREE.ConeGeometry(0.85, 5.5, 12).rotateX(-Math.PI / 2).toNonIndexed().translate(s * px, WY, end - 3.1));
      } else add.smoothDark.push(new THREE.ConeGeometry(1.45, 5, 14).rotateX(-Math.PI / 2).toNonIndexed().translate(s * px, WY, end - 2.8));
    }
    // A big pod slung under the engines: crimson over black.
    const pod = (geo) => geo.scale(5.2, 3.2, 11).translate(s * 20.5, -1.3, -2);
    add.smoothDark.push(pod(new THREE.SphereGeometry(1, 20, 14).toNonIndexed()));
    add.smooth.push(pod(new THREE.SphereGeometry(1.03, 20, 8, 0, Math.PI * 2, 0, Math.PI * 0.42).toNonIndexed()));

    // The small wing: black front edge, silver tips with black ends.
    const smallEdge = smallFront.filter(([x]) => x >= 11);
    add.smoothDark.push(softPlate(flip([...smallEdge, ...[...smallEdge].reverse().map(([x, z]) => [x, z - 1.6])]), 0.82, RY));
    const silverStart = smallFront.filter(([x]) => x >= 22);
    add.silver.push(softPlate(flip([...silverStart.map(([x, z]) => [x, z - 1.5]), [29.5, -27.6], [22, -26.8]]), 0.78, RY));
    add.smoothDark.push(softPlate(flip([[29.6, zOn(smallFront, 29.6)], ...smallTip.slice(1), [29.4, -27.8]]), 0.84, RY));
    add.smoothGold.push(new THREE.CylinderGeometry(0.5, 0.5, 0.12, 14).toNonIndexed().translate(s * 20.5, RY + 0.46, -21));
    // Undercarriage: three pairs of wheels under each hull.
    const r = 1.1, wy = -spec.gearH + r;
    for (const z of [16, 6, -8]) {
      const low = dropPoint(s, (DROP.nose - z) / DROP.length, -Math.PI / 2);
      const strutTop = low[1] + 1.2;
      for (const k of [-1, 1]) add.smoothDark.push(cyl(r, r, 0.8, 16).rotateY(Math.PI / 2).translate(low[0] + k * 0.75, wy, z));
      add.metal.push(box(0.55, strutTop - wy, 0.7, low[0], (strutTop + wy) / 2, z));
    }
  }
  // Three fins, as on the real thing: one on the centre line, one each side of it.
  add.smoothDark.push(softFin(0, -22.5, 6, 10, 10));
  for (const s of [-1, 1]) add.smoothDark.push(softFin(s * 13.5, -21, RY, 11, 9));
  // A white crest on the body between the wings.
  add.white.push(new THREE.CylinderGeometry(3, 3, 0.1, 24).toNonIndexed().translate(0, 9.85, -11.5));
  add.wingStripe.push(new THREE.CylinderGeometry(2.25, 2.25, 0.12, 24).toNonIndexed().translate(0, 9.88, -11.5));
  add.white.push(new THREE.CylinderGeometry(1.25, 1.25, 0.14, 3).toNonIndexed().rotateY(Math.PI).translate(0, 9.92, -11.5));
  // Rows of bomb bay doors along the belly.
  for (let row = 0; row < 4; row++) {
    const z = -9 + row * 3.4;
    const y = fuselageBottom(sh.fuse, z) - 0.02;
    for (const s of [-1, 1]) add.door.push(box(2.3, 0.2, 3, s * 1.35, y, z));
  }
  // The heavy top turret's base.
  const [, dy, dz] = spec.door;
  add.plate.push(box(3.6, 1.5, 3.6, 0, dy - 1.3, dz), box(2.8, 0.5, 2.8, 0, dy - 0.3, dz));
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

// A transport's propeller: many curved blades, dark with yellow tips.
function scimitarProp(r, blades, z, x, y) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  const dark = [new THREE.ConeGeometry(r * 0.2, r * 0.42, 10).rotateX(Math.PI / 2).toNonIndexed()], tips = [];
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2;
    dark.push(box(r * 0.1, r * 0.5, 0.08, 0, r * 0.3, -0.04).rotateZ(a));
    dark.push(box(r * 0.11, r * 0.34, 0.08, r * 0.03, r * 0.66, -0.04).rotateZ(a - 0.1));
    tips.push(box(r * 0.1, r * 0.14, 0.09, r * 0.03, r * 0.89, -0.04).rotateZ(a - 0.1));
  }
  g.add(new THREE.Mesh(merged(dark), mat(0x16181b)), new THREE.Mesh(merged(tips), mat(0xe2b420)));
  const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 18), new THREE.MeshBasicMaterial({ color: 0x1a1a18, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false }));
  disc.visible = false;
  g.add(disc);
  g.userData.disc = disc;
  return g;
}

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
  const add = { body: [], shade: [], dark: [], metal: [], nose: [], glass: [], belly: [], plate: [], rivet: [], door: [], stripe: [], amber: [], exhaust: [], white: [], wingStripe: [], silver: [], plume: [], smooth: [], smoothDark: [], smoothGold: [] };

  if (sh.smooth) add.smooth.push(toCreasedNormals(loft(sh.fuse, sh.fuseSides ?? 8), 1));
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
  if (spec.rockets?.count) {
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
  addMesh(add.body, painted, true);
  addMesh(add.shade, shaded, true);
  addMesh(add.plate, mat(0x4b5057, { roughness: 0.6, metalness: 0.25 }));
  addMesh(add.rivet, mat(0xa2a6a8, { roughness: 0.5, metalness: 0.3 }));
  addMesh(add.door, mat(0x34373a, { roughness: 0.7, metalness: 0.2 }));
  addMesh(add.stripe, mat(0xd9a820));
  addMesh(add.white, mat(0xe8e4d4));
  addMesh(add.smooth, paintMaterial(paint, team, 1, true), true);
  addMesh(add.smoothDark, mat(0x19191b, { flatShading: false, roughness: 0.5 }));
  addMesh(add.smoothGold, mat(0xf2bb22, { flatShading: false, roughness: 0.4, emissive: 0x6a4608 }));
  addMesh(add.wingStripe, mat(0x2a0e10));
  addMesh(add.silver, mat(0xc4cad0, { roughness: 0.4, flatShading: false }));
  if (add.plume.length) addMesh(add.plume, new THREE.MeshBasicMaterial({ color: 0x9a3dff, toneMapped: false })).castShadow = false;
  addMesh(add.amber, new THREE.MeshStandardMaterial({ color: 0xe8b23a, emissive: 0x7a4c0c, flatShading: true, roughness: 0.4 }));
  if (add.exhaust.length) addMesh(add.exhaust, new THREE.MeshBasicMaterial({ color: 0xc98bff, toneMapped: false })).castShadow = false;
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
      disc.position.set(side * (sh.discX ?? mx), my, sh.markZ ?? 0.2);
      group.add(disc);
    });
  }
  if (sh.finFlash) group.add(new THREE.Mesh(box(sh.finFlash[2] ?? 0.17, sh.finFlash[3] ?? 0.5, sh.finFlash[4] ?? 1.3, 0, sh.finFlash[0], sh.finFlash[1]), mat(mark)));
  const bar = new THREE.Mesh(box(0.05, 0.5, 1.1, 0, (sh.fuse[3][3] ?? 0) + 0.1, sh.fuse[4][0] * 0.8), mat(mark));
  bar.scale.x = (sh.fuse[4][1] ?? 1) / 0.05 * 1.02;
  group.add(bar);

  // Fog would fade it into the haze however large it is, so it stays out of the fog.
  if (spec.seeFar) group.traverse((o) => o.isMesh && (o.material = clearOfFog(o.material)));

  return { group, props, rear, rearSpin, engineZ, engineX, cockpitY: sh.cockpitY, spec, type, turret: null, flame, shadowShape: type === 'leviathan' ? wingShadow(spec) : null };
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
  const half = [[8, 36], [14.5, 28], [14.5, 14], [28, 2], [w, -17], [w, -26], [24, -10], [31, -21], [31, -28], [8, -26], [1, -34]];
  const outline = new THREE.Shape([[3, 26], ...half, [0, -35], ...half.map(([x, z]) => [-x, z]).reverse(), [-3, 26]].map(([x, z]) => new THREE.Vector2(x, z)));
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
