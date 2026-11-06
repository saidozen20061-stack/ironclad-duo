import * as THREE from 'three';
import { TANKS } from '../../../shared/constants.js';

// Fitted workshop parts, shown on the turntable tank: a muzzle brake or longer barrel, armour plates,
// skirts, sandbags, spare track links, aerials, smoke dischargers and exhausts. Simple low-poly
// shapes added to the model built in models/tanks.js (v.group, v.turret, v.gun, v.muzzle).

const mat = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true });
const STEEL = mat(0x4b5040);
const DARK = mat(0x26281f);
const SAND = mat(0xa8946a);
const TRACK = mat(0x2f302b);

const box = (w, h, d, m, x, y, z, parent) => {
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  b.position.set(x, y, z);
  parent.add(b);
  return b;
};
const tube = (r, len, m, x, y, z, parent, axis = 'z') => {
  const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 8), m);
  if (axis === 'z') c.rotation.x = Math.PI / 2;
  c.position.set(x, y, z);
  parent.add(c);
  return c;
};

export function dress(v, model, fit) {
  const s = TANKS[model].size;
  const L = s.length, W = s.width, H = s.height;
  const hullTop = H * 0.45;
  const q = (k) => fit[k]?.q ?? 0;
  // Gun: muzzle brake, then a longer barrel, then a fume extractor too.
  if (v.muzzle && q('gun') >= 1) {
    tube(0.17, 0.35, DARK, 0, 0, 0.12, v.muzzle);
    box(0.5, 0.12, 0.22, DARK, 0, 0, 0.14, v.muzzle);
  }
  if (v.gun && q('gun') >= 2) v.gun.scale.z = 1.12;
  if (v.muzzle && q('gun') >= 3) tube(0.16, 0.5, STEEL, 0, 0, -1.2, v.muzzle);
  // Turret: bolt-on plates on the cheeks, then a thicker mantlet.
  if (v.turret && q('turret') >= 1) for (const sx of [-1, 1]) box(0.08, 0.5, 1.1, STEEL, sx * W * 0.33, 0.25, 0.1, v.turret);
  if (v.turret && q('turret') >= 2) box(W * 0.4, 0.45, 0.14, STEEL, 0, 0.3, W * 0.28, v.turret);
  // Hull: extra plates on the glacis.
  if (q('hull') >= 1) box(W * 0.8, 0.08, L * 0.18, STEEL, 0, hullTop + 0.02, L * 0.38, v.group).rotation.x = -0.35;
  if (q('hull') >= 3) for (const sx of [-1, 1]) box(0.06, H * 0.22, L * 0.5, STEEL, sx * (W / 2 + 0.03), H * 0.32, 0, v.group);
  // Engine: exhaust pipes at the back, a second set for the big ones.
  if (q('engine') >= 1) for (const sx of q('engine') >= 2 ? [-0.25, 0.25] : [0.25]) tube(0.09, 0.7, DARK, sx * W, hullTop - 0.1, -L / 2 - 0.05, v.group);
  // Tracks: grouser cleats along the top run.
  if (q('tracks') >= 1) for (const sx of [-1, 1]) for (let i = 0; i < 6; i++) box(0.1, 0.05, 0.14, DARK, sx * (W / 2 - 0.25), H * 0.27, -L * 0.35 + i * L * 0.14, v.group);
  // Optics: a sight hood on the turret roof.
  if (v.turret && q('optics') >= 1) box(0.3, 0.2, 0.3, DARK, W * 0.15, 0.62, 0.2, v.turret);
  // Radio: aerials, then a radar mast.
  if (v.turret && q('radio') >= 1) for (const sx of q('radio') >= 2 ? [-0.3, 0.3] : [-0.3]) tube(0.02, 2.2, DARK, sx * W, 1.5, -0.6, v.turret, 'y');
  if (v.turret && q('radio') >= 3) box(0.6, 0.08, 0.08, DARK, -0.3 * W, 2.6, -0.6, v.turret);
  // Ammo: armoured bins on the hull rear deck.
  if (q('ammo') >= 1) box(W * 0.5, 0.25, 0.4, STEEL, 0, hullTop + 0.12, -L * 0.42, v.group);
  // Extras: spare track links, side skirts, sandbags, smoke dischargers.
  const ex = q('extras');
  if (ex >= 1) for (let i = 0; i < 4; i++) box(0.5, 0.06, 0.3, TRACK, 0, hullTop + 0.04, L * 0.3 - i * 0.32, v.group).rotation.z = 0.05 * i;
  if (ex >= 2) for (const sx of [-1, 1]) box(0.05, H * 0.2, L * 0.85, STEEL, sx * (W / 2 + 0.12), H * 0.25, 0, v.group);
  if (ex >= 3) {
    for (let i = 0; i < 5; i++) box(0.45, 0.2, 0.28, SAND, -W * 0.36 + i * W * 0.18, hullTop + 0.1, L * 0.43, v.group);
    if (v.turret) for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) tube(0.06, 0.3, DARK, sx * W * 0.34, 0.45 + i * 0.12, 0.5, v.turret).rotation.set(-0.6, 0, sx * 0.4);
  }
}

// What dress() changes, as a key for caching the built model.
export const lookKey = (fit) => Object.values(fit).map((p) => p.q).join('');
