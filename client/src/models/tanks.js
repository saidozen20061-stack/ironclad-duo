import * as THREE from 'three';
import { TANKS } from '../../../shared/constants.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { paintMaterial, bakePaintCoords } from './paint.js';
import { tankBarrelGeometries, coaxGeometries, pintleGunGeometries } from './guns.js';

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
  for (const geo of tankBarrelGeometries(length, radius, brake)) g.add(new THREE.Mesh(geo, material));
  for (const geo of coaxGeometries(radius)) g.add(new THREE.Mesh(geo, mat(0x23241f)));
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

// Recon tank: tiny hull, small hexagonal turret, whip antenna.
function buildScout(c) {
  const group = new THREE.Group();
  const L = 4.0, W = 2.3;
  tracks(group, L, W, 0.45, 0.65, 4, c);
  const hull = hullShape(L * 0.96, 0.6, 1.0, 0.3, W - 0.9, mat(c.hull));
  hull.position.y = 0.48;
  group.add(hull);
  const turret = new THREE.Group();
  turret.position.set(0, 1.12, -0.1);
  const t = cyl(0.55, 0.7, 0.45, 6, mat(c.hull));
  t.position.y = 0.22;
  turret.add(t);
  const ant = cyl(0.015, 0.015, 2.2, 4, mat(0x222222));
  ant.position.set(-0.35, 1.5, -0.4);
  ant.rotation.x = -0.15;
  turret.add(ant);
  const gun = new THREE.Group();
  gun.position.set(0, 0.24, 0.5);
  const { g, muzzle } = barrel(1.6, 0.05, mat(c.dark));
  gun.add(g);
  turret.add(gun);
  group.add(turret);
  return { group, turret, gun, muzzle, stripe: [0.5, -0.35] };
}

// Six-wheeled armored car with a boat-shaped hull.
function buildWheeled(c) {
  const group = new THREE.Group();
  const L = 5.6, W = 2.8;
  const tyre = mat(0x23231f);
  const hub = mat(0x55584c);
  for (const side of [-1, 1]) {
    for (const z of [-1.8, 0, 1.8]) {
      const w = cyl(0.55, 0.55, 0.42, 9, tyre);
      w.rotation.z = Math.PI / 2;
      w.position.set(side * (W / 2 - 0.25), 0.55, z);
      group.add(w);
      const h = cyl(0.22, 0.22, 0.45, 6, hub);
      h.rotation.z = Math.PI / 2;
      h.position.copy(w.position);
      group.add(h);
    }
    group.add(box(0.5, 0.08, L * 0.95, mat(c.dark), side * (W / 2 - 0.25), 1.15, 0)); // mudguards
  }
  const hull = hullShape(L, 1.0, 1.5, 0.9, W - 0.75, mat(c.hull));
  hull.position.y = 0.45;
  group.add(hull);
  group.add(box(0.9, 0.12, 0.25, mat(0xd8d0a0, { emissive: 0x332c10 }), 0, 1.1, L / 2 - 0.25)); // headlights bar
  const turret = new THREE.Group();
  turret.position.set(0, 1.55, -0.2);
  const t = cyl(0.8, 0.95, 0.5, 6, mat(c.hull));
  t.position.y = 0.25;
  turret.add(t);
  turret.add(box(0.9, 0.35, 0.5, mat(c.dark), 0, 0.3, -0.95)); // stowage box
  const gun = new THREE.Group();
  gun.position.set(0, 0.25, 0.75);
  const { g, muzzle } = barrel(2.4, 0.085, mat(c.dark), true);
  gun.add(g);
  turret.add(gun);
  group.add(turret);
  return { group, turret, gun, muzzle, stripe: [0.55, -0.4] };
}

// Turretless tank destroyer: low hull, sloped fixed casemate, long gun in a ball mantlet.
function buildDestroyer(c) {
  const group = new THREE.Group();
  const L = 6.6, W = 3.3;
  tracks(group, L, W, 0.65, 0.85, 6, c);
  const hull = hullShape(L * 0.97, 0.8, 1.6, 0.5, W - 1.2, mat(c.hull));
  hull.position.y = 0.55;
  group.add(hull);
  // Casemate: a wedge built from the same profile helper, sitting on the hull.
  const cas = hullShape(3.6, 0.75, 1.3, 0.4, W - 1.0, mat(c.hull));
  cas.position.set(0, 1.35, 0.1);
  group.add(cas);
  group.add(box(0.7, 0.18, 0.7, mat(c.dark), -0.55, 2.17, -0.9)); // commander hatch
  for (const s of [-1, 1]) group.add(box(0.08, 0.5, L * 0.8, mat(c.dark), s * (W / 2 + 0.04), 0.95, 0)); // skirts
  const turret = new THREE.Group(); // only the gun mount moves (±12°)
  turret.position.set(0, 1.75, 1.6);
  turret.add(cyl(0.38, 0.38, 0.5, 8, mat(c.hull)));
  const gun = new THREE.Group();
  gun.position.set(0, 0, 0.3);
  const { g, muzzle } = barrel(4.8, 0.11, mat(c.dark), true);
  gun.add(g);
  turret.add(gun);
  group.add(turret);
  return { group, turret, gun, muzzle, stripe: [0.42, -0.9], stripeOnHull: [0, 2.12, 0.6] };
}

// Light hull with an open-topped turret and two side-by-side autocannons.
function buildTwin(c) {
  const group = new THREE.Group();
  const L = 5.2, W = 2.9;
  tracks(group, L, W, 0.55, 0.8, 5, c);
  const hull = hullShape(L * 0.96, 0.85, 1.3, 0.5, W - 1.1, mat(c.hull));
  hull.position.y = 0.55;
  group.add(hull);
  const turret = new THREE.Group();
  turret.position.set(0, 1.45, -0.3);
  turret.add(box(1.9, 0.15, 1.9, mat(c.hull), 0, 0.08, 0)); // floor
  for (const [x, z, w, d] of [[0.9, 0, 0.1, 1.9], [-0.9, 0, 0.1, 1.9], [0, -0.9, 1.9, 0.1]]) turret.add(box(w, 0.6, d, mat(c.hull), x, 0.4, z));
  const front = box(1.9, 0.6, 0.1, mat(c.hull), 0, 0.45, 0.9);
  front.rotation.x = -0.3;
  turret.add(front);
  const dish = cyl(0.35, 0.35, 0.06, 8, mat(c.dark)); // ranging radar
  dish.rotation.x = 1.2;
  dish.position.set(0, 1.05, -0.85);
  turret.add(dish);
  turret.add(box(0.06, 0.4, 0.06, mat(c.dark), 0, 0.8, -0.85));
  const gun = new THREE.Group();
  gun.position.set(0, 0.45, 0.7);
  let muzzle = null;
  for (const x of [-0.32, 0.32]) {
    const b = barrel(2.2, 0.055, mat(c.dark));
    b.g.position.x = x;
    gun.add(b.g);
    muzzle ??= b.muzzle;
  }
  gun.add(box(0.5, 0.35, 0.6, mat(c.dark), 0, 0, 0.1)); // breech housing
  turret.add(gun);
  group.add(turret);
  return { group, turret, gun, muzzle, stripe: [0.72, -0.96] };
}

// Assault howitzer: slab-sided box turret, very short fat barrel with a big brake.
function buildAssault(c) {
  const group = new THREE.Group();
  const L = 6.4, W = 3.4;
  tracks(group, L, W, 0.7, 0.95, 6, c);
  const hull = hullShape(L * 0.97, 1.0, 1.6, 0.5, W - 1.4, mat(c.hull));
  hull.position.y = 0.65;
  group.add(hull);
  for (const s of [-1, 1]) group.add(box(0.1, 0.7, L * 0.9, mat(c.dark), s * (W / 2 + 0.05), 1.05, 0)); // skirts
  const turret = new THREE.Group();
  turret.position.set(0, 1.65, -0.6);
  turret.add(box(2.5, 1.05, 2.7, mat(c.hull), 0, 0.52, 0));
  const plate = box(2.5, 1.0, 0.25, mat(c.hull), 0, 0.5, 1.4);
  plate.rotation.x = -0.25;
  turret.add(plate);
  turret.add(box(1.4, 0.3, 0.9, mat(c.dark), 0, 1.2, -0.5)); // roof vent
  for (const s of [-1, 1]) turret.add(box(0.12, 0.4, 1.8, mat(c.dark), s * 1.32, 0.6, 0)); // add-on armor
  const gun = new THREE.Group();
  gun.position.set(0, 0.5, 1.35);
  const { g, muzzle } = barrel(2.2, 0.22, mat(c.dark), true);
  gun.add(g);
  turret.add(gun);
  group.add(turret);
  return { group, turret, gun, muzzle, stripe: [1.08, -1.2] };
}

// Super-heavy: huge hull with skirts, a big round turret with bustle and a hull MG pod.
function buildSuperheavy(c) {
  const group = new THREE.Group();
  const L = 8.6, W = 4.2;
  tracks(group, L, W, 0.85, 1.15, 8, c);
  const hull = hullShape(L * 0.97, 1.3, 2.3, 0.6, W - 1.7, mat(c.hull));
  hull.position.y = 0.8;
  group.add(hull);
  for (const s of [-1, 1]) group.add(box(0.12, 0.85, L * 0.9, mat(c.dark), s * (W / 2 + 0.06), 1.2, 0));
  const pod = cyl(0.35, 0.4, 0.4, 6, mat(c.hull)); // hull machine-gun pod
  pod.position.set(0.9, 2.05, 2.4);
  group.add(pod);
  const podGun = cyl(0.04, 0.04, 0.7, 5, mat(0x222222));
  podGun.rotation.x = Math.PI / 2;
  podGun.position.set(0.9, 2.1, 2.8);
  group.add(podGun);
  const turret = new THREE.Group();
  turret.position.set(0, 2.1, -0.5);
  const t = cyl(1.6, 1.95, 1.1, 8, mat(c.hull));
  t.position.y = 0.55;
  turret.add(t);
  turret.add(box(2.4, 0.9, 1.4, mat(c.hull), 0, 0.5, -1.9)); // bustle
  const cupola = cyl(0.38, 0.42, 0.4, 6, mat(c.dark));
  cupola.position.set(-0.7, 1.25, -0.5);
  turret.add(cupola);
  const gun = new THREE.Group();
  gun.position.set(0, 0.55, 1.7);
  const { g, muzzle } = barrel(5.6, 0.2, mat(c.dark), true);
  gun.add(g);
  const mg = cyl(0.035, 0.035, 0.7, 5, mat(0x222222));
  mg.rotation.x = Math.PI / 2;
  mg.position.set(0.55, 0.05, 0.5);
  gun.add(mg);
  turret.add(gun);
  group.add(turret);
  return { group, turret, gun, muzzle, stripe: [1.12, -0.9] };
}

const BUILDERS = {
  light: buildLight,
  medium: buildMedium,
  heavy: buildHeavy,
  scout: buildScout,
  wheeled: buildWheeled,
  destroyer: buildDestroyer,
  aa: buildTwin,
  assault: buildAssault,
  superheavy: buildSuperheavy,
};

// Collapse each pivot's (hull / turret / gun) static parts into one mesh per material.
// Looks identical but turns ~40 draw calls per tank into a handful.
function mergeParts(root, pivots) {
  root.updateMatrixWorld(true);
  for (const node of pivots) {
    const inv = new THREE.Matrix4().copy(node.matrixWorld).invert();
    const byMat = new Map();
    const collect = (o) => {
      for (const c of [...o.children]) {
        if (pivots.includes(c)) continue;
        if (c.isMesh) {
          const g = c.geometry.index ? c.geometry.toNonIndexed() : c.geometry.clone();
          g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, c.matrixWorld));
          g.clearGroups();
          if (!byMat.has(c.material)) byMat.set(c.material, []);
          byMat.get(c.material).push(g);
          c.removeFromParent();
        } else collect(c);
      }
    };
    collect(node);
    for (const [material, geos] of byMat) {
      const m = new THREE.Mesh(mergeGeometries(geos), material);
      m.castShadow = true;
      m.receiveShadow = true;
      node.add(m);
    }
  }
}

// One built + merged template per type and team; units get cheap clones sharing its geometry.
const templates = new Map();

export function buildTank(type = 'medium', team = 'blue', paint = type) {
  const key = `${type}|${team}|${paint}`;
  if (!templates.has(key)) templates.set(key, makeTank(type, team, paint));
  const group = templates.get(key).group.clone();
  const find = (name) => group.getObjectByName(name);
  return { group, turret: find('turret'), gun: find('gun'), muzzle: find('muzzle'), type, team };
}

function makeTank(type, team, paint) {
  const colors = TEAM_COLORS[team] ?? TEAM_COLORS.blue;
  const handles = BUILDERS[type](colors);
  // Swap the plain hull colours for this class's paint scheme (tracks, tyres, guns' black parts stay).
  handles.group.updateMatrixWorld(true);
  const hullMat = mat(colors.hull);
  const darkMat = mat(colors.dark);
  handles.group.traverse((o) => {
    if (!o.isMesh || (o.material !== hullMat && o.material !== darkMat)) return;
    bakePaintCoords(o, handles.group);
    o.material = paintMaterial(paint, team, o.material === hullMat ? 1 : 0.62);
  });
  // Commander's machine gun on the turret roof.
  const [sx, sy, sz] = TANKS[type].mount.sight;
  for (const geo of pintleGunGeometries()) {
    const m = new THREE.Mesh(geo, mat(0x23241f));
    m.position.set(sx + (sx <= 0 ? 0.48 : -0.48), sy - 0.1, sz - 0.12);
    handles.turret.add(m);
  }
  // Team marking: a coloured stripe on the turret
  const spec = TANKS[type];
  const stripe = box(spec.size.width * 0.32, 0.12, 0.12, mat(colors.mark, { emissive: colors.mark, emissiveIntensity: 0.15 }));
  if (handles.stripeOnHull) {
    stripe.position.set(...handles.stripeOnHull);
    handles.group.add(stripe);
  } else {
    const [y, z] = handles.stripe ?? (type === 'heavy' ? [0.97, -0.6] : [0.62, -0.3]);
    stripe.position.set(0, y, z);
    handles.turret.add(stripe);
  }
  handles.group.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  handles.turret.name = 'turret';
  handles.gun.name = 'gun';
  handles.muzzle.name = 'muzzle';
  mergeParts(handles.group, [handles.group, handles.turret, handles.gun]);
  return handles;
}

// The (shared) track material, so the unit view can swap in a scrolling copy per tank.
export const trackMaterial = () => mat(0x2b2b27);
