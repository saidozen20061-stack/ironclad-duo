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
  if (type === 'rocket') {
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
