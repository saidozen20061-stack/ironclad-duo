import * as THREE from 'three';
import { TANKS } from '../../../shared/constants.js';

// Procedural low-poly tank models. Forward is +Z, up is +Y, origin at ground centre.
// Returned handles: group (hull root), turret (yaw pivot), gun (pitch pivot), muzzle (barrel tip).

const TEAM_COLORS = {
  blue: { hull: 0x4f6a5a, dark: 0x34473c, mark: 0x5fa0e0 },
  red: { hull: 0x4a3a36, dark: 0x2c2321, mark: 0xe0645a },
};

const matCache = new Map();
function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) {
    matCache.set(key, new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, metalness: 0.1, ...opts }));
  }
  return matCache.get(key);
}

function box(w, h, d, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  return m;
}

function cyl(rTop, rBot, h, seg, material) {
  return new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg), material);
}

// Hull with a sloped glacis: an extruded side profile (in Z/Y) gives a proper wedge shape.
function hullShape(len, height, frontSlope, rearSlope, width, material) {
  const s = new THREE.Shape();
  const hz = len / 2;
  s.moveTo(-hz, 0);
  s.lineTo(hz - frontSlope * 0.35, 0);
  s.lineTo(hz, height * 0.45);
  s.lineTo(hz - frontSlope, height);
  s.lineTo(-hz + rearSlope, height);
  s.lineTo(-hz, height * 0.7);
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: false });
  geo.translate(0, 0, -width / 2);
  geo.rotateY(-Math.PI / 2); // shape X -> world Z
  return new THREE.Mesh(geo, material);
}

function tracks(group, len, width, trackW, trackH, wheels, colors) {
  const trackMat = mat(0x2b2b27);
  const wheelMat = mat(0x3d3f36);
  for (const side of [-1, 1]) {
    const x = side * (width / 2 - trackW / 2);
    const t = box(trackW, trackH, len, trackMat, x, trackH / 2, 0);
    group.add(t);
    // Rounded ends via angled boxes for a chunky low-poly look.
    for (const end of [-1, 1]) {
      const e = box(trackW * 0.98, trackH * 0.7, trackH * 0.7, trackMat, x, trackH * 0.5, end * (len / 2));
      e.rotation.x = Math.PI / 4;
      group.add(e);
    }
    for (let i = 0; i < wheels; i++) {
      const w = cyl(trackH * 0.36, trackH * 0.36, trackW * 1.04, 7, wheelMat);
      w.rotation.z = Math.PI / 2;
      w.position.set(x, trackH * 0.42, -len / 2 + (len / (wheels - 1)) * i * 0.86 + len * 0.07);
      group.add(w);
    }
    // Fender
    group.add(box(trackW * 1.1, 0.08, len * 1.02, mat(colors.dark), x, trackH + 0.04, 0));
  }
}

function barrel(length, radius, material, brake = false) {
  const g = new THREE.Group();
  const b = cyl(radius, radius * 1.1, length, 7, material);
  b.rotation.x = Math.PI / 2;
  b.position.z = length / 2;
  g.add(b);
  const mantlet = box(radius * 5, radius * 5, radius * 4, material, 0, 0, radius * 1.5);
  g.add(mantlet);
  if (brake) {
    const mb = box(radius * 3.2, radius * 2.4, radius * 4, material, 0, 0, length);
    g.add(mb);
  }
  const muzzle = new THREE.Object3D();
  muzzle.position.z = length + (brake ? radius * 2 : 0);
  g.add(muzzle);
  return { g, muzzle };
}

function buildLight(c) {
  const group = new THREE.Group();
  const L = 4.6, W = 2.6;
  tracks(group, L, W, 0.5, 0.75, 5, c);
  const hull = hullShape(L * 0.96, 0.75, 1.2, 0.4, W - 1.0, mat(c.hull));
  hull.position.y = 0.55;
  group.add(hull);
  const turret = new THREE.Group();
  turret.position.set(0, 1.3, 0.1);
  const t = cyl(0.75, 0.95, 0.55, 6, mat(c.hull));
  t.position.y = 0.27;
  turret.add(t);
  turret.add(box(0.5, 0.2, 0.5, mat(c.dark), -0.35, 0.62, -0.25)); // hatch
  const gun = new THREE.Group();
  gun.position.set(0, 0.3, 0.7);
  const { g, muzzle } = barrel(2.0, 0.07, mat(c.dark));
  gun.add(g);
  turret.add(gun);
  group.add(turret);
  return { group, turret, gun, muzzle };
}

function buildMedium(c) {
  const group = new THREE.Group();
  const L = 6.2, W = 3.2;
  tracks(group, L, W, 0.6, 0.9, 6, c);
  const hull = hullShape(L * 0.97, 0.95, 1.7, 0.6, W - 1.2, mat(c.hull));
  hull.position.y = 0.6;
  group.add(hull);
  group.add(box(1.4, 0.25, 1.1, mat(c.dark), 0, 1.62, -2.0)); // engine deck
  const turret = new THREE.Group();
  turret.position.set(0, 1.55, 0.1);
  const t = cyl(1.0, 1.3, 0.75, 7, mat(c.hull));
  t.position.y = 0.37;
  turret.add(t);
  turret.add(box(1.3, 0.55, 0.9, mat(c.hull), 0, 0.33, -1.25)); // bustle
  const cupola = cyl(0.3, 0.34, 0.3, 6, mat(c.dark));
  cupola.position.set(0.45, 0.88, -0.3);
  turret.add(cupola);
  const gun = new THREE.Group();
  gun.position.set(0, 0.38, 1.05);
  const { g, muzzle } = barrel(3.4, 0.12, mat(c.dark));
  gun.add(g);
  // Coax MG
  const mg = cyl(0.03, 0.03, 0.6, 5, mat(0x222222));
  mg.rotation.x = Math.PI / 2;
  mg.position.set(0.35, 0.05, 0.4);
  gun.add(mg);
  turret.add(gun);
  group.add(turret);
  return { group, turret, gun, muzzle };
}

function buildHeavy(c) {
  const group = new THREE.Group();
  const L = 7.4, W = 3.7;
  tracks(group, L, W, 0.75, 1.05, 7, c);
  const hull = hullShape(L * 0.97, 1.1, 2.0, 0.5, W - 1.45, mat(c.hull));
  hull.position.y = 0.7;
  group.add(hull);
  // Side skirts
  for (const s of [-1, 1]) group.add(box(0.08, 0.6, L * 0.85, mat(c.dark), s * (W / 2 + 0.05), 1.0, 0));
  const turret = new THREE.Group();
  turret.position.set(0, 1.85, -0.2);
  turret.add(box(2.5, 0.95, 2.9, mat(c.hull), 0, 0.47, 0));
  const front = box(2.3, 0.9, 0.6, mat(c.hull), 0, 0.45, 1.6);
  front.rotation.x = -0.35;
  turret.add(front);
  turret.add(box(2.2, 0.75, 1.0, mat(c.hull), 0, 0.42, -1.9));
  const cupola = cyl(0.36, 0.4, 0.35, 6, mat(c.dark));
  cupola.position.set(-0.6, 1.1, -0.4);
  turret.add(cupola);
  const gun = new THREE.Group();
  gun.position.set(0, 0.5, 1.75);
  const { g, muzzle } = barrel(4.6, 0.18, mat(c.dark), true);
  gun.add(g);
  turret.add(gun);
  group.add(turret);
  return { group, turret, gun, muzzle };
}

const BUILDERS = { light: buildLight, medium: buildMedium, heavy: buildHeavy };

export function buildTank(type = 'medium', team = 'blue') {
  const colors = TEAM_COLORS[team] ?? TEAM_COLORS.blue;
  const handles = BUILDERS[type](colors);
  // Team marking: a coloured stripe on the turret
  const spec = TANKS[type];
  const stripe = box(spec.size.width * 0.32, 0.12, 0.12, mat(colors.mark, { emissive: colors.mark, emissiveIntensity: 0.15 }));
  stripe.position.set(0, type === 'heavy' ? 0.97 : 0.62, type === 'heavy' ? -0.6 : -0.3);
  handles.turret.add(stripe);
  handles.group.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  handles.type = type;
  handles.team = team;
  return handles;
}
