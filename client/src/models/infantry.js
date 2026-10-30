import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Low-poly soldiers and anti-tank guns, baked into vertex-coloured geometries.
// Soldiers keep their two legs as separate meshes so they can walk.

const MAT = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });

const TEAM = {
  blue: { cloth: 0x56704c, helmet: 0x3e5537, band: 0x5fa0e0 },
  red: { cloth: 0x76695a, helmet: 0x4a4038, band: 0xe0645a },
};

const c = new THREE.Color();
function part(geo, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  const g = (geo.index ? geo.toNonIndexed() : geo.clone());
  g.deleteAttribute('uv');
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz)));
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  c.setHex(color);
  for (let i = 0; i < n; i++) c.toArray(col, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

const BOX = new THREE.BoxGeometry(1, 1, 1);
const HEAD = new THREE.IcosahedronGeometry(0.5, 0);
const HELMET = new THREE.SphereGeometry(0.5, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2);
const TUBE = new THREE.CylinderGeometry(0.5, 0.5, 1, 6);

const cache = new Map();
function soldierGeos(team, type) {
  const key = team + type;
  if (cache.has(key)) return cache.get(key);
  const t = TEAM[team];
  const skin = 0xc49a74;
  const body = [
    part(BOX, t.cloth, 0, 1.15, 0, 0, 0, 0, 0.5, 0.62, 0.3), // torso
    part(BOX, 0x4a3a28, 0, 0.86, 0, 0, 0, 0, 0.52, 0.1, 0.32), // belt
    part(HEAD, skin, 0, 1.6, 0.02, 0, 0, 0, 0.26, 0.28, 0.26),
    part(HELMET, t.helmet, 0, 1.66, 0, 0, 0, 0, 0.36, 0.3, 0.38),
    part(BOX, t.band, -0.29, 1.3, 0, 0, 0, 0, 0.08, 0.1, 0.18), // armband for IFF
    part(BOX, t.cloth, 0.3, 1.18, 0.12, -0.9, 0, 0, 0.14, 0.5, 0.14), // right arm (forward)
    part(BOX, t.cloth, -0.28, 1.15, 0.14, -1.1, 0, 0.2, 0.14, 0.5, 0.14), // left arm
    part(BOX, 0x5a4a32, -0.1, 1.05, -0.2, 0, 0, 0, 0.36, 0.4, 0.18), // pack
  ];
  if (type === 'crew') {
    // Tank crew carry the M4-style rifle: small black carbine held across the chest.
    body.push(...m4Parts(0.12, 1.24, 0.3));
  } else if (type === 'rocket') {
    body.push(part(TUBE, 0x3d4a32, 0.22, 1.5, 0.15, Math.PI / 2, 0, 0, 0.13, 1.3, 0.13));
    body.push(part(TUBE, 0x2a2a26, 0.22, 1.5, 0.82, Math.PI / 2, 0, 0, 0.2, 0.25, 0.2));
  } else {
    body.push(part(BOX, 0x3b2d20, 0.12, 1.22, 0.45, -0.05, 0, 0, 0.06, 0.08, 0.95)); // rifle
  }
  const leg = part(BOX, t.cloth, 0, -0.42, 0, 0, 0, 0, 0.18, 0.84, 0.2);
  const boot = part(BOX, 0x2a2420, 0, -0.82, 0.05, 0, 0, 0, 0.19, 0.12, 0.3);
  const res = { body: mergeGeometries(body), leg: mergeGeometries([leg, boot]) };
  cache.set(key, res);
  return res;
}

export function buildSoldier(team, type) {
  const g = soldierGeos(team, type);
  const group = new THREE.Group();
  const inner = new THREE.Group(); // tilted for crouch / death
  group.add(inner);
  const body = new THREE.Mesh(g.body, MAT);
  inner.add(body);
  const legs = [-0.12, 0.12].map((x) => {
    const l = new THREE.Mesh(g.leg, MAT);
    l.position.set(x, 0.86, 0);
    inner.add(l);
    return l;
  });
  for (const m of [body, ...legs]) m.castShadow = true;
  return { group, inner, body, legs, phase: Math.random() * 6 };
}

// ---------- M4A4-style rifle ----------
// Parts in rifle space: barrel along +Z, sight line at y = M4_SIGHT_Y. Scaled for
// third-person soldiers; the first-person viewmodel uses scale 1.
const BLACK = 0x1b1c1d;
const DARK = 0x101112;
const GREY = 0x2c2e30;
export const M4_SIGHT_Y = 0.085;
function m4Parts(x = 0, y = 0, z = 0, k = 1) {
  const P = (geo, col, px, py, pz, rx, ry, rz, sx, sy, sz) => part(geo, col, x + px * k, y + py * k, z + pz * k, rx, ry, rz, sx * k, sy * k, sz * k);
  const out = [
    P(BOX, BLACK, 0, 0, 0.02, 0, 0, 0, 0.05, 0.06, 0.26), // upper receiver
    P(BOX, GREY, 0, -0.05, 0.0, 0, 0, 0, 0.044, 0.05, 0.19), // lower receiver
    P(BOX, DARK, -0.026, 0.005, 0.03, 0, 0, 0, 0.004, 0.022, 0.07), // ejection port
    P(TUBE, BLACK, 0, -0.002, 0.27, Math.PI / 2, 0, 0, 0.064, 0.24, 0.064), // handguard
    P(TUBE, DARK, 0, 0, 0.47, Math.PI / 2, 0, 0, 0.018, 0.2, 0.018), // barrel
    P(TUBE, DARK, 0, 0, 0.585, Math.PI / 2, 0, 0, 0.026, 0.045, 0.026), // flash hider
    P(BOX, BLACK, 0, 0.042, 0.39, 0, 0, 0, 0.02, 0.03, 0.018), // front sight base
    P(BOX, BLACK, 0, 0.072, 0.39, 0, 0, 0, 0.006, 0.03, 0.006), // front sight post
    P(BOX, BLACK, -0.012, 0.07, 0.39, 0, 0, 0, 0.004, 0.032, 0.012), // post wings
    P(BOX, BLACK, 0.012, 0.07, 0.39, 0, 0, 0, 0.004, 0.032, 0.012),
    P(BOX, DARK, 0, 0.036, 0.02, 0, 0, 0, 0.03, 0.012, 0.25), // top rail
    P(BOX, BLACK, 0, 0.074, -0.01, 0, 0, 0, 0.022, 0.016, 0.15), // carry handle
    P(BOX, BLACK, 0, 0.054, 0.055, 0, 0, 0, 0.018, 0.024, 0.02), // handle legs
    P(BOX, BLACK, 0, 0.054, -0.07, 0, 0, 0, 0.018, 0.024, 0.02),
    P(BOX, BLACK, -0.009, M4_SIGHT_Y, -0.075, 0, 0, 0, 0.005, 0.022, 0.012), // rear aperture
    P(BOX, BLACK, 0.009, M4_SIGHT_Y, -0.075, 0, 0, 0, 0.005, 0.022, 0.012),
    P(BOX, DARK, 0, -0.13, 0.06, 0.25, 0, 0, 0.032, 0.13, 0.065), // 30-round magazine
    P(BOX, DARK, 0, -0.105, -0.075, -0.35, 0, 0, 0.03, 0.09, 0.035), // pistol grip
    P(BOX, BLACK, 0, -0.085, -0.02, 0, 0, 0, 0.012, 0.008, 0.06), // trigger guard
    P(TUBE, GREY, 0, -0.005, -0.18, Math.PI / 2, 0, 0, 0.03, 0.14, 0.03), // buffer tube
    P(BOX, BLACK, 0, -0.03, -0.27, 0, 0, 0, 0.04, 0.075, 0.12), // stock
    P(BOX, DARK, 0, -0.035, -0.335, 0, 0, 0, 0.042, 0.09, 0.012), // butt pad
    P(BOX, GREY, 0, 0.02, -0.11, 0, 0, 0, 0.03, 0.012, 0.03), // charging handle
  ];
  return out;
}

// First-person rifle with gloved hands. Barrel points -Z (camera forward).
export function buildM4Viewmodel() {
  const parts = m4Parts();
  const sleeve = TEAM.blue.cloth;
  const glove = 0x2d2a24;
  parts.push(
    part(BOX, glove, 0.0, -0.09, -0.05, -0.35, 0, 0, 0.05, 0.07, 0.06), // right hand on the grip
    part(BOX, sleeve, -0.03, -0.14, -0.15, -0.5, 0.25, 0, 0.07, 0.07, 0.24), // right forearm
    part(BOX, glove, -0.005, -0.04, 0.27, 0, 0, 0, 0.075, 0.05, 0.08), // left hand under the handguard
    part(BOX, sleeve, 0.07, -0.1, 0.16, -0.25, -0.5, 0, 0.07, 0.07, 0.26), // left forearm
  );
  const geo = mergeGeometries(parts);
  geo.rotateY(Math.PI);
  const group = new THREE.Group();
  group.add(new THREE.Mesh(geo, MAT));
  // Red dot on the front post, for the red-dot style sight picture.
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.006, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2a1a, fog: false }));
  dot.position.set(0, M4_SIGHT_Y, -0.39);
  group.add(dot);
  // Muzzle flash, shown for a frame or two per shot.
  const flash = new THREE.Mesh(new THREE.OctahedronGeometry(0.05, 0), new THREE.MeshBasicMaterial({ color: 0xffd27a, fog: false, transparent: true, opacity: 0.9 }));
  flash.position.set(0, 0, -0.64);
  flash.scale.set(1, 1, 2.2);
  flash.visible = false;
  group.add(flash);
  return { group, flash, dot };
}

const gunCache = new Map();
export function buildATGun(team) {
  if (!gunCache.has(team)) {
    const metal = team === 'blue' ? 0x4f6a5a : 0x4a3a36;
    const dark = 0x2b2b27;
    const base = mergeGeometries([
      part(BOX, dark, -0.8, 0.25, -1.2, 0, 0.35, 0, 0.12, 0.12, 2.4), // trail legs
      part(BOX, dark, 0.8, 0.25, -1.2, 0, -0.35, 0, 0.12, 0.12, 2.4),
      part(TUBE, dark, -1.05, 0.5, 0, 0, 0, Math.PI / 2, 1.0, 0.18, 1.0), // wheels
      part(TUBE, dark, 1.05, 0.5, 0, 0, 0, Math.PI / 2, 1.0, 0.18, 1.0),
      part(BOX, metal, 0, 0.55, 0, 0, 0, 0, 1.9, 0.18, 0.5), // axle
    ]);
    const top = mergeGeometries([
      part(BOX, metal, 0, 1.0, 0.25, -0.15, 0, 0, 2.2, 1.2, 0.08), // shield
      part(BOX, metal, 0, 0.75, -0.1, 0, 0, 0, 0.5, 0.35, 1.1), // breech
    ]);
    const barrel = mergeGeometries([part(TUBE, dark, 0, 0, 1.3, Math.PI / 2, 0, 0, 0.16, 2.8, 0.16), part(TUBE, dark, 0, 0, 2.7, Math.PI / 2, 0, 0, 0.24, 0.3, 0.24)]);
    gunCache.set(team, { base, top, barrel });
  }
  const g = gunCache.get(team);
  const group = new THREE.Group();
  group.add(new THREE.Mesh(g.base, MAT));
  const turret = new THREE.Group();
  turret.add(new THREE.Mesh(g.top, MAT));
  const gun = new THREE.Group();
  gun.position.set(0, 0.85, 0.1);
  gun.add(new THREE.Mesh(g.barrel, MAT));
  turret.add(gun);
  group.add(turret);
  // Two crew kneeling behind the shield.
  const crew = [];
  for (const x of [-0.7, 0.7]) {
    const s = buildSoldier(team, 'rifle');
    s.group.position.set(x, 0, -1.0);
    s.inner.position.y = -0.45;
    s.inner.rotation.x = 0.25;
    turret.add(s.group);
    crew.push(s);
  }
  group.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  return { group, turret, gun, crew };
}
