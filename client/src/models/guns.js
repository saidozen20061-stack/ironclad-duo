import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { part, BOX, GUN_MAT } from './infantry.js';

// Detailed weapons built from small coloured parts. Everything is modelled barrel-along-+Z.
const STEEL = 0x666a6e;
const DARK = 0x34363a;
const MID = 0x8c9094;
const OLIVE = 0x5d6845;
const OLIVE_D = 0x465038;
const BRASS = 0xc09a42;
const RUBBER = 0x2e2a26;
const GLOVE = 0x2d2a24;
const ALONG_Z = Math.PI / 2;

const cylinders = new Map();
const round = (sides) => {
  if (!cylinders.has(sides)) cylinders.set(sides, new THREE.CylinderGeometry(0.5, 0.5, 1, sides));
  return cylinders.get(sides);
};
const tube = (sides, col, x, y, z, d, len) => part(round(sides), col, x, y, z, ALONG_Z, 0, 0, d, len, d);
const block = (col, x, y, z, w, h, d, rx = 0, ry = 0, rz = 0) => part(BOX, col, x, y, z, rx, ry, rz, w, h, d);

// ---------- M134-style door minigun ----------
// The barrel cluster is its own geometry: it spins around Z while firing.
function minigunBarrels(detail) {
  const sides = detail ? 8 : 5;
  const out = [];
  const ring = 0.045;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const x = Math.cos(a) * ring, y = Math.sin(a) * ring;
    out.push(tube(sides, DARK, x, y, 0.42, 0.021, 0.62)); // barrel
    out.push(tube(sides, STEEL, x, y, 0.74, 0.027, 0.04)); // muzzle collar
    if (detail) out.push(tube(sides, STEEL, x, y, 0.15, 0.03, 0.08)); // chamber end
  }
  // Clamp plates hold the bundle together, like the real thing. Without them it's a squid.
  for (const [z, d, t] of [[0.2, 0.135, 0.022], [0.43, 0.125, 0.02], [0.68, 0.125, 0.026]]) {
    out.push(tube(12, MID, 0, 0, z, d, t));
    if (detail) out.push(tube(12, DARK, 0, 0, z, d * 0.5, t * 1.5));
  }
  out.push(tube(8, STEEL, 0, 0, 0.42, 0.03, 0.56)); // centre spindle
  return mergeGeometries(out);
}

function minigunBody(detail) {
  const out = [
    tube(14, STEEL, 0, 0, 0, 0.14, 0.24), // main housing
    tube(14, DARK, 0, 0, 0.125, 0.15, 0.015), // front bearing ring
    tube(14, MID, 0, 0, 0.1, 0.145, 0.03),
    tube(14, DARK, 0, 0, -0.125, 0.135, 0.03), // rear cap
    tube(10, MID, 0, 0, -0.145, 0.08, 0.025),
    tube(10, STEEL, -0.08, 0.055, -0.03, 0.07, 0.16), // drive motor
    tube(10, DARK, -0.08, 0.055, -0.115, 0.05, 0.02),
    block(STEEL, -0.065, 0.015, 0.03, 0.05, 0.06, 0.05), // motor gearbox
    block(STEEL, 0.085, 0.005, 0.02, 0.05, 0.1, 0.16), // delinker feeder
    block(DARK, 0.113, 0.005, 0.02, 0.008, 0.075, 0.13),
    block(STEEL, 0, -0.09, 0, 0.045, 0.05, 0.1), // mount lug
    tube(8, DARK, 0, -0.09, 0, 0.018, 0.13), // trunnion pin
    // Yoke and pintle post
    block(MID, -0.045, -0.15, 0, 0.018, 0.1, 0.07),
    block(MID, 0.045, -0.15, 0, 0.018, 0.1, 0.07),
    block(MID, 0, -0.2, 0, 0.11, 0.02, 0.08),
    part(round(10), STEEL, 0, -0.32, 0, 0, 0, 0, 0.042, 0.22, 0.042),
    part(round(10), DARK, 0, -0.27, 0, 0, 0, 0, 0.06, 0.018, 0.06),
    // Spade grips with their cross bar and thumb triggers
    block(DARK, 0, 0, -0.17, 0.2, 0.022, 0.022),
    block(DARK, 0, -0.04, -0.15, 0.03, 0.09, 0.03),
    // Ring sight on a post
    block(DARK, 0, 0.09, -0.08, 0.012, 0.03, 0.012),
    block(DARK, 0, 0.1, 0.1, 0.008, 0.05, 0.008),
  ];
  for (const s of [-1, 1]) {
    out.push(part(round(8), RUBBER, s * 0.1, 0.0, -0.205, 0.25, 0, 0, 0.03, 0.15, 0.03)); // grip
    out.push(block(DARK, s * 0.1, 0.07, -0.19, 0.022, 0.015, 0.05)); // top of the spade
    out.push(block(DARK, s * 0.1, -0.075, -0.225, 0.022, 0.015, 0.05)); // bottom
    out.push(block(0x8a2a20, s * 0.08, 0.05, -0.2, 0.014, 0.018, 0.012)); // thumb trigger
  }
  // Belt chute from the feeder down to the ammo can.
  const a = [0.12, 0, 0.02], b = [0.25, -0.36, -0.08];
  const links = detail ? 9 : 4;
  for (let i = 0; i < links; i++) {
    const t = (i + 0.5) / links;
    const sag = Math.sin(t * Math.PI) * 0.05;
    const x = a[0] + (b[0] - a[0]) * t + sag, y = a[1] + (b[1] - a[1]) * t, z = a[2] + (b[2] - a[2]) * t;
    out.push(block(OLIVE_D, x, y, z, 0.05, 0.42 / links + 0.006, 0.09, 0, 0, 0.32 - t * 0.5));
    if (detail) {
      // Rounds glinting in the open side of the chute.
      out.push(tube(6, BRASS, x - 0.026, y - 0.012, z, 0.012, 0.075));
      out.push(tube(6, BRASS, x - 0.026, y + 0.012, z, 0.012, 0.075));
    }
  }
  // Ammo can on its tray.
  out.push(
    block(OLIVE, 0.25, -0.46, -0.08, 0.15, 0.2, 0.26),
    block(OLIVE_D, 0.25, -0.355, -0.08, 0.158, 0.018, 0.268), // lid
    block(MID, 0.25, -0.34, -0.08, 0.06, 0.012, 0.012), // handle
    block(DARK, 0.25, -0.57, -0.08, 0.2, 0.02, 0.3), // tray
    block(DARK, 0.11, -0.57, -0.08, 0.1, 0.018, 0.04), // tray arm back to the post
  );
  if (detail) {
    for (const z of [-0.17, 0.01]) out.push(block(MID, 0.33, -0.39, z, 0.008, 0.05, 0.03)); // latches
    out.push(block(0xb0a058, 0.326, -0.47, -0.08, 0.002, 0.05, 0.14)); // stencil
    for (let i = 0; i < 5; i++) out.push(tube(14, DARK, 0, 0, -0.08 + i * 0.035, 0.143, 0.006)); // cooling ribs
    for (const [x, y] of [[0.05, 0.06], [-0.05, -0.05], [0.06, -0.05]]) out.push(tube(6, MID, x, y, -0.14, 0.012, 0.012)); // bolts
    // Ring sight
    for (let i = 0; i < 10; i++) {
      const t = (i / 10) * Math.PI * 2;
      out.push(block(DARK, Math.cos(t) * 0.028, 0.135 + Math.sin(t) * 0.028, 0.1, 0.018, 0.005, 0.005, 0, 0, t + Math.PI / 2));
    }
  }
  return mergeGeometries(out);
}

// Third-person model: pivot at the receiver, `k` to make it read at a distance.
export function buildMinigun(k = 1.5) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(cached('mgBody', () => minigunBody(false)), GUN_MAT);
  const spin = new THREE.Mesh(cached('mgBarrels', () => minigunBarrels(false)), GUN_MAT);
  group.add(body, spin);
  group.scale.setScalar(k);
  body.castShadow = spin.castShadow = true;
  return { group, spin };
}

// First person: full detail, gloved hands on the grips, barrels pointing away from the camera.
export function buildMinigunViewmodel() {
  const group = new THREE.Group();
  const hands = [];
  for (const s of [-1, 1]) {
    hands.push(
      block(GLOVE, s * 0.1, 0, -0.21, 0.055, 0.1, 0.06, 0.25),
      block(0x56704c, s * 0.15, -0.09, -0.34, 0.08, 0.08, 0.26, 0.45, s * -0.3),
    );
  }
  const body = new THREE.Mesh(mergeGeometries([minigunBody(true), ...hands.map((h) => h)]), GUN_MAT);
  const barrels = new THREE.Mesh(minigunBarrels(true), GUN_MAT);
  const holder = new THREE.Group();
  holder.add(body, barrels);
  holder.rotation.y = Math.PI;
  const flash = new THREE.Mesh(new THREE.OctahedronGeometry(0.075, 0), new THREE.MeshBasicMaterial({ color: 0xffd27a, fog: false, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false }));
  flash.position.set(0, 0, 0.82);
  flash.scale.set(1, 1, 2.6);
  flash.visible = false;
  holder.add(flash);
  group.add(holder);
  return { group, barrels, flash };
}

const geoCache = new Map();
function cached(key, make) {
  if (!geoCache.has(key)) geoCache.set(key, make());
  return geoCache.get(key);
}

// ---------- Anti-tank rocket launcher (tube along +Z, shouldered at the rear third) ----------
export function launcherParts(x, y, z) {
  const P = (col, px, py, pz, d, len) => tube(8, col, x + px, y + py, z + pz, d, len);
  const B = (col, px, py, pz, w, h, d, rx = 0) => block(col, x + px, y + py, z + pz, w, h, d, rx);
  return [
    P(OLIVE, 0, 0, 0.15, 0.11, 1.3), // launch tube
    P(OLIVE_D, 0, 0, 0.82, 0.135, 0.06), // front ring
    P(DARK, 0, 0, 0.78, 0.125, 0.02),
    P(OLIVE_D, 0, 0, 0.15, 0.125, 0.05), // centre band
    P(DARK, 0, 0, -0.5, 0.15, 0.04), // rear ring
    part(new THREE.CylinderGeometry(0.1, 0.055, 0.2, 8), DARK, x, y, z - 0.6, -ALONG_Z), // venturi flare
    part(new THREE.ConeGeometry(0.05, 0.14, 8), 0x6b6f58, x, y, z + 0.92, ALONG_Z), // warhead nose
    B(RUBBER, 0, -0.07, -0.08, 0.1, 0.035, 0.32), // shoulder pad
    B(DARK, 0, -0.11, 0.18, 0.035, 0.11, 0.045, 0.2), // pistol grip
    B(DARK, 0, -0.1, 0.42, 0.03, 0.09, 0.04, -0.15), // front grip
    B(DARK, 0, 0.075, 0.5, 0.012, 0.05, 0.012), // front sight
    B(DARK, 0, 0.07, -0.02, 0.05, 0.04, 0.02), // rear sight
    B(DARK, 0.065, 0.02, 0.15, 0.02, 0.05, 0.13), // battery box
  ];
}

// ---------- Tank barrel details: thickenings, evacuator, baffled brake, coax stub ----------
// Parts are added to a tank's gun pivot by tanks.js, in the same material as the barrel.
export function tankBarrelGeometries(length, radius, brake) {
  const seg = (r, l, z) => new THREE.CylinderGeometry(r, r, l, 8).rotateX(Math.PI / 2).translate(0, 0, z);
  const out = [
    seg(radius * 1.55, radius * 3.5, radius * 4.8), // recoil sleeve out of the mantlet
    seg(radius * 1.25, length * 0.3, length * 0.22), // thicker chase at the breech end
    seg(radius * 1.65, length * 0.13, length * 0.6), // bore evacuator
    seg(radius * 1.25, radius * 0.5, length * 0.53), // its collar
    seg(radius * 1.3, radius * 1.1, length - (brake ? radius * 2.6 : 0)), // muzzle ring
  ];
  if (brake) {
    // Double baffle muzzle brake: two plates and side bars, open between them.
    out.push(new THREE.BoxGeometry(radius * 3.6, radius * 2.8, radius * 0.9).translate(0, 0, length + radius * 1.5));
    out.push(new THREE.BoxGeometry(radius * 3.6, radius * 2.8, radius * 0.9).translate(0, 0, length - radius * 0.2));
    out.push(new THREE.BoxGeometry(radius * 1.4, radius * 2.8, radius * 3.2).translate(0, 0, length + radius * 0.65));
  }
  return out;
}

// Coax machine gun poking out next to the main gun, in dark metal.
export function coaxGeometries(radius) {
  const r = Math.max(0.018, radius * 0.22);
  return [
    new THREE.CylinderGeometry(r, r, radius * 6 + 0.25, 6).rotateX(Math.PI / 2).translate(radius * 2.1, -radius * 0.9, radius * 4),
    new THREE.CylinderGeometry(r * 1.7, r * 1.7, radius * 0.9, 6).rotateX(Math.PI / 2).translate(radius * 2.1, -radius * 0.9, radius * 7 + 0.12),
  ];
}

// Commander's machine gun on a pintle, on the turret roof (post long enough to reach it).
export function pintleGunGeometries() {
  const c = (r, l, x, y, z) => new THREE.CylinderGeometry(r, r, l, 6).rotateX(Math.PI / 2).translate(x, y, z);
  return [
    new THREE.CylinderGeometry(0.03, 0.03, 0.75, 6).translate(0, -0.3, 0), // post
    new THREE.BoxGeometry(0.08, 0.1, 0.42).translate(0, 0.1, -0.02), // receiver
    c(0.04, 0.3, 0, 0.1, 0.3), // barrel jacket
    c(0.016, 0.28, 0, 0.1, 0.56), // barrel
    c(0.028, 0.05, 0, 0.1, 0.71), // flash hider
    new THREE.BoxGeometry(0.11, 0.14, 0.17).translate(-0.1, 0.05, 0), // ammo box
    new THREE.BoxGeometry(0.025, 0.09, 0.025).translate(0, 0.02, -0.25), // spade grip
    new THREE.BoxGeometry(0.14, 0.02, 0.02).translate(0, 0.06, -0.26),
  ];
}
