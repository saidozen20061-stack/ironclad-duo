import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { part, TEAM, BOX, HEAD, HELMET, TUBE, m4Parts } from './infantry.js';

// Low-poly soldier on a real skeleton (head, torso, upper/lower arms and legs, feet),
// skinned rigidly into ONE mesh per soldier so 40+ animated soldiers stay cheap.
// Animation is procedural: each frame builds a target pose from blended layers
// (locomotion, stance, upper-body action, look), eases the bones towards it, adds short
// impulses (recoil, flinch), then plants the feet on the terrain with two-bone IK.

const SKIN = 0xc49a74;
const BOOT = 0x2a2420;
const BELT = 0x4a3a28;
const PACK = 0x5a4a32;
const THIGH = 0.44;
const SHIN = 0.43;
const HIP_Y = 0.95;

// name, parent, local bind position
const BONES = [
  ['root', null, [0, 0, 0]],
  ['hips', 'root', [0, HIP_Y, 0]],
  ['spine', 'hips', [0, 0.12, 0]],
  ['chest', 'spine', [0, 0.2, 0]],
  ['neck', 'chest', [0, 0.2, 0]],
  ['head', 'neck', [0, 0.08, 0]],
  ['upperL', 'chest', [0.21, 0.13, 0]],
  ['foreL', 'upperL', [0, -0.28, 0]],
  ['handL', 'foreL', [0, -0.25, 0]],
  ['upperR', 'chest', [-0.21, 0.13, 0]],
  ['foreR', 'upperR', [0, -0.28, 0]],
  ['handR', 'foreR', [0, -0.25, 0]],
  ['thighL', 'hips', [0.1, -0.02, 0]],
  ['shinL', 'thighL', [0, -THIGH, 0]],
  ['footL', 'shinL', [0, -SHIN, 0]],
  ['thighR', 'hips', [-0.1, -0.02, 0]],
  ['shinR', 'thighR', [0, -THIGH, 0]],
  ['footR', 'shinR', [0, -SHIN, 0]],
  ['launcher', 'chest', [-0.16, 0.2, -0.02]],
];
const INDEX = Object.fromEntries(BONES.map(([n], i) => [n, i]));
const ANIMATED = BONES.map(([n]) => n).filter((n) => n !== 'root');

// Bind-pose world position of each bone.
const BIND = {};
for (const [name, parent, p] of BONES) {
  const base = parent ? BIND[parent] : [0, 0, 0];
  BIND[name] = [base[0] + p[0], base[1] + p[1], base[2] + p[2]];
}

function skin(geo, bone) {
  const n = geo.attributes.position.count;
  const idx = new Uint16Array(n * 4);
  const w = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    idx[i * 4] = INDEX[bone];
    w[i * 4] = 1;
  }
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(idx, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(w, 4));
  return geo;
}

// Long guns are modelled barrel-along-+Z, then laid along the hanging arm (-Y) with the
// grip in the right hand; raising the arm chain by -90° points them forward.
function inHand(geos, grip) {
  const g = mergeGeometries(geos);
  g.rotateX(Math.PI / 2);
  const [hx, hy, hz] = BIND.handR;
  g.translate(hx - grip[0], hy - 0.04 - grip[1], hz - grip[2]);
  return g;
}

function npcRifle() {
  const wood = 0x5a4126, dark = 0x2a2824;
  return [
    part(BOX, dark, 0, 0, 0.1, 0, 0, 0, 0.055, 0.075, 0.62),
    part(BOX, dark, 0, 0.01, 0.55, 0, 0, 0, 0.025, 0.025, 0.36),
    part(BOX, wood, 0, -0.03, -0.38, 0, 0, 0, 0.06, 0.12, 0.3),
    part(BOX, wood, 0, -0.015, 0.25, 0, 0, 0, 0.065, 0.06, 0.3),
    part(BOX, dark, 0, -0.08, 0.02, 0.2, 0, 0, 0.035, 0.12, 0.05),
  ];
}

const geoCache = new Map();
function rigGeometry(team, type) {
  const key = team + type;
  if (geoCache.has(key)) return geoCache.get(key);
  const t = TEAM[team];
  const B = (bone, ...parts) => parts.map((g) => skin(g, bone));
  const mirror = (side) => (side === 'L' ? 1 : -1);
  const parts = [
    ...B('hips', part(BOX, t.cloth, 0, 0.93, 0, 0, 0, 0, 0.34, 0.2, 0.22), part(BOX, BELT, 0, 1.0, 0, 0, 0, 0, 0.36, 0.07, 0.24)),
    ...B('spine', part(BOX, t.cloth, 0, 1.12, 0, 0, 0, 0, 0.32, 0.18, 0.21)),
    ...B(
      'chest',
      part(BOX, t.cloth, 0, 1.35, 0.01, 0, 0, 0, 0.42, 0.3, 0.25),
      part(BOX, PACK, 0, 1.3, -0.19, 0, 0, 0, 0.3, 0.34, 0.15),
      part(BOX, BELT, 0, 1.24, 0.14, 0, 0, 0, 0.3, 0.08, 0.05),
    ),
    ...B('neck', part(BOX, SKIN, 0, 1.51, 0, 0, 0, 0, 0.1, 0.09, 0.1)),
    ...B('head', part(HEAD, SKIN, 0, 1.64, 0.01, 0, 0, 0, 0.25, 0.27, 0.25), part(HELMET, t.helmet, 0, 1.69, 0, 0, 0, 0, 0.34, 0.28, 0.36), part(TUBE, t.helmet, 0, 1.695, 0, 0, 0, 0, 0.37, 0.03, 0.39)),
  ];
  for (const side of ['L', 'R']) {
    const x = 0.21 * mirror(side);
    const lx = 0.1 * mirror(side);
    parts.push(
      ...B(`upper${side}`, part(BOX, t.cloth, x, 1.26, 0, 0, 0, 0, 0.1, 0.29, 0.11)),
      ...B(`fore${side}`, part(BOX, t.cloth, x, 0.995, 0, 0, 0, 0, 0.09, 0.26, 0.1)),
      ...B(`hand${side}`, part(BOX, SKIN, x, 0.82, 0.01, 0, 0, 0, 0.08, 0.1, 0.09)),
      ...B(`thigh${side}`, part(BOX, t.cloth, lx, 0.71, 0, 0, 0, 0, 0.16, 0.44, 0.18)),
      ...B(`shin${side}`, part(BOX, t.cloth, lx, 0.275, 0, 0, 0, 0, 0.14, 0.42, 0.15)),
      ...B(`foot${side}`, part(BOX, BOOT, lx, 0.04, 0.05, 0, 0, 0, 0.14, 0.1, 0.28)),
    );
  }
  parts.push(...B('upperL', part(BOX, t.band, 0.215, 1.33, 0, 0, 0, 0, 0.115, 0.08, 0.125))); // armband (IFF)
  if (type === 'rocket') {
    const [lx, ly, lz] = BIND.launcher;
    parts.push(...B('launcher', part(TUBE, 0x3d4a32, lx, ly, lz + 0.15, Math.PI / 2, 0, 0, 0.13, 1.3, 0.13), part(TUBE, 0x2a2a26, lx, ly, lz + 0.82, Math.PI / 2, 0, 0, 0.2, 0.25, 0.2)));
  } else if (type === 'crew') {
    parts.push(skin(inHand(m4Parts(), [0, -0.105, -0.075]), 'handR'));
  } else {
    parts.push(skin(inHand(npcRifle(), [0, -0.08, -0.02]), 'handR'));
  }
  const geo = mergeGeometries(parts);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 2.6);
  geoCache.set(key, geo);
  return geo;
}

const MAT = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });
const smooth = (t) => t * t * (3 - 2 * t);
const clamp01 = (t) => Math.max(0, Math.min(1, t));
const HALF_PI = Math.PI / 2;

export const POSE = { CROUCH: 1, PRONE: 2, RELOAD: 4, WOUNDED: 8, SIGNAL: 16, COVER: 32, DRAG: 64, THROW: 128 };

export class SoldierRig {
  constructor(team, type) {
    this.type = type;
    this.bones = {};
    const list = [];
    for (const [name, parent, p] of BONES) {
      const b = new THREE.Bone();
      b.name = name;
      b.position.set(...p);
      if (parent) this.bones[parent].add(b);
      this.bones[name] = b;
      list.push(b);
    }
    this.mesh = new THREE.SkinnedMesh(rigGeometry(team, type), MAT);
    this.mesh.add(this.bones.root);
    this.mesh.updateMatrixWorld(true);
    this.mesh.bind(new THREE.Skeleton(list));
    this.mesh.castShadow = true;
    this.group = new THREE.Group();
    this.group.add(this.mesh);
    // Blended (eased) pose; impulses are added on top each frame.
    this.base = Object.fromEntries(ANIMATED.map((n) => [n, new THREE.Vector3()]));
    this.hipsY = HIP_Y;
    this.rootY = 0;
    this.rootRx = 0;
    this.rootRz = 0;
    this.launcherX = -2.37;
    this.phase = Math.random() * 6;
    this.t = Math.random() * 10;
    this.seed = Math.random() * 100;
    this.recoil = 0;
    this.flinch = 0;
    this.flinchSide = 1;
    this.lastShot = -10;
    this.throwT = 0;
    this.prevFlags = 0;
    this.death = null;
    this.lean = Math.random() < 0.5 ? 1 : -1;
  }

  shoot() {
    this.recoil = 1;
    this.lastShot = this.t;
  }

  hit(side, big = false) {
    this.flinch = big ? 1.4 : 1;
    this.flinchSide = side;
  }

  // Death: 'back' / 'forward' / 'side' / 'crumple' from the hit direction, or thrown by a blast.
  die({ fromAngle = 0, blast = null } = {}) {
    if (this.death) return;
    let kind;
    if (blast) kind = 'blast';
    else if (Math.abs(fromAngle) < 0.8) kind = Math.random() < 0.5 ? 'back' : 'crumple';
    else if (Math.abs(fromAngle) > 2.3) kind = 'forward';
    else kind = 'side';
    this.death = { kind, t: 0, side: fromAngle > 0 ? 1 : -1, blast, spin: (Math.random() - 0.5) * 2 };
  }

  // s: { dt, speed, fwd, side, turn, code, aimPitch, aiming, lod, ground(x,z) | null, x, z, h, y }
  update(s) {
    const dt = s.dt;
    this.t += dt;
    const T = {}; // target rotations (x, y, z) per bone, zero by default
    for (const n of ANIMATED) T[n] = [0, 0, 0];
    let hipsDrop = 0;
    let rootRx = 0;
    let rootRz = 0;
    let rootY = 0;
    let launcherX = -2.37;
    let ease = 10;

    if (this.death) {
      this.poseDeath(T, dt);
      return;
    }

    const code = s.code | 0;
    const stance = code & 3;
    const has = (f) => (code & f) !== 0;
    const moving = s.speed > 0.25;
    const lateral = moving && Math.abs(s.side) > Math.abs(s.fwd) * 1.2;
    const back = moving && s.fwd < -0.3;
    const dir = back || has(POSE.DRAG) ? -1 : 1;
    // Stride amplitude grows walk -> run -> sprint.
    const amp = moving ? Math.min(1.0, 0.25 + s.speed * 0.13) : 0;
    const turning = !moving && Math.abs(s.turn) > 0.6;
    this.phase += dt * (moving ? s.speed * (stance === 2 ? 1.4 : 2.1) : turning ? 4 : 0);
    const ph = this.phase;
    const sw = Math.sin(ph) * dir;
    const limp = has(POSE.WOUNDED) ? 0.5 : 1;

    // ---------- Legs + stance ----------
    if (stance === 2) {
      // Prone: lie forward from the feet; crawl by alternating knee pulls.
      rootRx = HALF_PI;
      rootY = 0.14;
      ease = 6;
      const c = moving ? 1 : 0;
      T.thighL[0] = -0.4 * Math.max(0, sw) * c - 0.05;
      T.shinL[0] = 1.0 * Math.max(0, sw) * c + 0.1;
      T.thighR[0] = -0.4 * Math.max(0, -sw) * c - 0.05;
      T.shinR[0] = 1.0 * Math.max(0, -sw) * c + 0.1;
      T.thighL[2] = 0.15;
      T.thighR[2] = -0.15;
      T.head[0] = -0.9; // look ahead along the ground
      T.neck[0] = -0.4;
    } else if (stance === 1 && !moving) {
      // Kneel: left foot planted forward, right knee down.
      hipsDrop = 0.44;
      T.thighL[0] = -1.45;
      T.shinL[0] = 1.5;
      T.footL[0] = -0.05;
      T.thighR[0] = -0.2;
      T.shinR[0] = 1.95;
      T.footR[0] = 0.6;
      T.spine[0] = 0.15;
    } else if (stance === 1) {
      // Crouch-run between cover, head down.
      hipsDrop = 0.3;
      T.thighL[0] = -0.75 - amp * 0.6 * sw;
      T.thighR[0] = -0.75 + amp * 0.6 * sw;
      T.shinL[0] = 1.0 + 0.5 * Math.max(0, Math.cos(ph));
      T.shinR[0] = 1.0 + 0.5 * Math.max(0, -Math.cos(ph));
      T.spine[0] = 0.4;
      T.chest[0] = 0.15;
    } else if (moving && lateral) {
      // Strafing: side steps.
      const sd = Math.sign(s.side);
      T.thighL[2] = 0.35 * amp * Math.sin(ph) * sd;
      T.thighR[2] = 0.35 * amp * Math.sin(ph) * sd;
      T.shinL[0] = 0.25 * Math.max(0, Math.cos(ph));
      T.shinR[0] = 0.25 * Math.max(0, -Math.cos(ph));
    } else if (moving || turning) {
      const a = turning ? 0.18 : amp;
      T.thighL[0] = -a * sw * limp;
      T.thighR[0] = a * sw;
      T.shinL[0] = 0.08 + a * 1.25 * Math.max(0, Math.cos(ph)) * limp;
      T.shinR[0] = 0.08 + a * 1.25 * Math.max(0, -Math.cos(ph));
      T.footL[0] = -0.2 * a * Math.cos(ph);
      T.footR[0] = 0.2 * a * Math.cos(ph);
      // Lean into speed; sprint leans hardest.
      T.spine[0] = 0.04 + Math.min(0.32, s.speed * 0.045);
    } else {
      T.shinL[0] = 0.05;
      T.shinR[0] = 0.05;
    }
    const bob = moving && stance === 0 ? Math.abs(Math.sin(ph)) * 0.035 * amp : 0;
    if (has(POSE.WOUNDED)) {
      T.spine[0] += 0.2;
      T.spine[2] += 0.18;
    }

    // ---------- Upper body ----------
    const rocket = this.type === 'rocket';
    const aiming = s.aiming || this.t - this.lastShot < 2.5;
    const pitch = s.aimPitch ?? 0;
    // Breathing + idle look-around.
    T.chest[0] += Math.sin(this.t * 1.7) * 0.02;
    if (!aiming && !moving) T.head[1] = Math.sin(this.t * 0.31 + this.seed) * 0.6 * smooth(clamp01(Math.sin(this.t * 0.13 + this.seed) * 2));

    let arms = 'carry';
    if (has(POSE.THROW)) arms = 'throw';
    else if (has(POSE.RELOAD)) arms = 'reload';
    else if (has(POSE.DRAG)) arms = 'drag';
    else if (has(POSE.SIGNAL)) arms = 'signal';
    else if (aiming) arms = 'aim';
    if (stance === 2) arms = aiming ? 'proneAim' : moving ? 'crawl' : 'proneRest';
    if (has(POSE.THROW) && !(this.prevFlags & POSE.THROW)) this.throwT = 0;
    this.prevFlags = code;
    this.throwT += dt;

    const L = (u, f, uz = 0) => {
      T.upperL[0] = u;
      T.upperL[2] = uz;
      T.foreL[0] = f;
    };
    const R = (u, f, uz = 0) => {
      T.upperR[0] = u;
      T.upperR[2] = uz;
      T.foreR[0] = f;
    };
    let gunPitch = -0.6; // rifle angle when carried
    switch (arms) {
      case 'aim':
        if (rocket) {
          launcherX = -pitch;
          R(-1.5, -1.5, 0.15);
          L(-1.3, -0.6, -0.25);
          T.head[0] = 0.15;
        } else {
          R(-1.25, -0.45, 0.32);
          L(-1.2, -0.75, -0.5);
          gunPitch = pitch;
          T.head[0] = 0.1 - pitch * 0.5;
          T.head[1] = -0.15;
          // Peek / lean out of cover while firing.
          if (has(POSE.COVER)) T.chest[2] = 0.3 * this.lean * smooth(clamp01(Math.sin(this.t * 0.7 + this.seed) + 0.6));
        }
        T.chest[0] += -pitch * 0.4;
        break;
      case 'reload':
        R(-0.9, -0.6, 0.3);
        gunPitch = -0.25;
        T.handR[2] = 0.6;
        L(-0.45 + Math.sin(this.t * 7) * 0.25, -1.45, -0.45);
        T.head[0] = 0.4;
        break;
      case 'throw': {
        const p = clamp01(this.throwT / 0.9);
        R(-0.4, -1.0, 0.25);
        if (p < 0.45) L(-0.5 - 2.2 * smooth(p / 0.45), -1.4, -0.1);
        else L(-2.7 + 1.7 * smooth(clamp01((p - 0.45) / 0.3)), -1.4 + 1.2 * smooth(clamp01((p - 0.45) / 0.3)), -0.1);
        T.chest[1] = 0.4 - 0.8 * smooth(clamp01((p - 0.3) / 0.5));
        break;
      }
      case 'signal':
        R(-0.35, -1.05, 0.2);
        L(-1.75 + Math.sin(this.t * 9) * 0.15, -0.15, -0.1);
        T.head[1] = 0.4;
        break;
      case 'drag':
        R(-0.9, -0.35, 0.25);
        L(-0.9, -0.35, -0.25);
        T.spine[0] += 0.55;
        gunPitch = -1.2;
        break;
      case 'crawl':
        R(-2.6 + 0.5 * Math.max(0, -sw), -0.4, 0.2);
        L(-2.6 + 0.5 * Math.max(0, sw), -0.4, -0.2);
        gunPitch = 0;
        break;
      case 'proneAim':
        R(-2.75, -0.35, 0.3);
        L(-2.9, -0.2, -0.35);
        gunPitch = 0;
        break;
      case 'proneRest':
        R(-2.4, -0.6, 0.3);
        L(-2.5, -0.6, -0.3);
        gunPitch = 0;
        break;
      default: {
        // Port arms with a gentle swing; sprinting swings harder.
        const swing = moving ? Math.cos(ph) * 0.12 * amp : 0;
        if (rocket) {
          R(-0.1 - swing * 2, -0.35, 0.1);
          L(-0.1 + swing * 2, -0.35, -0.1);
        } else {
          R(-0.35 + swing, -1.05, 0.25);
          L(-0.55 - swing, -1.15, -0.4);
        }
      }
    }
    // Keep the rifle pointing where we want: undo the chain's pitch at the hand.
    if (!rocket) {
      const chain = T.spine[0] + T.chest[0] + T.upperR[0] + T.foreR[0] + (stance === 2 ? HALF_PI : 0);
      T.handR[0] = -HALF_PI - gunPitch - chain;
    }

    // ---------- Ease towards the target pose ----------
    const k = 1 - Math.exp(-dt * ease);
    for (const n of ANIMATED) {
      const b = this.base[n];
      const t = T[n];
      b.x += (t[0] - b.x) * k;
      b.y += (t[1] - b.y) * k;
      b.z += (t[2] - b.z) * k;
    }
    this.hipsY += (HIP_Y - hipsDrop - bob - this.hipsY) * k;
    this.rootY += (rootY - this.rootY) * k;
    this.rootRx += (rootRx - this.rootRx) * k;
    this.rootRz += (rootRz - this.rootRz) * k;
    this.launcherX += (launcherX - this.launcherX) * k;

    // ---------- Apply + impulses ----------
    const B = this.bones;
    for (const n of ANIMATED) B[n].rotation.set(this.base[n].x, this.base[n].y, this.base[n].z);
    this.recoil *= Math.exp(-dt * 12);
    this.flinch *= Math.exp(-dt * 5);
    if (s.lod < 2) {
      B.chest.rotation.x -= 0.12 * this.recoil;
      B.upperR.rotation.x -= 0.15 * this.recoil;
      B.spine.rotation.z += 0.45 * this.flinch * this.flinchSide;
      B.spine.rotation.x -= 0.2 * this.flinch;
      B.head.rotation.x -= 0.3 * this.flinch;
    }
    B.launcher.rotation.x = this.launcherX;
    B.hips.position.y = this.hipsY - this.flinch * 0.06;
    B.root.position.set(0, this.rootY, 0);
    B.root.rotation.set(this.rootRx, 0, this.rootRz);

    // ---------- Feet on the ground (near soldiers only) ----------
    if (s.lod === 0 && s.ground && stance !== 2 && this.rootRx < 0.2) this.plantFeet(s);
  }

  // Two-bone IK in each leg's swing plane: shift every foot by the terrain under it.
  plantFeet(s) {
    const B = this.bones;
    const c = Math.cos(s.h), sn = Math.sin(s.h);
    const legs = [];
    let drop = 0;
    for (const side of ['L', 'R']) {
      const th = B[`thigh${side}`], sh = B[`shin${side}`];
      const a1 = th.rotation.x, a2 = a1 + sh.rotation.x;
      const ay = -THIGH * Math.cos(a1) - SHIN * Math.cos(a2); // ankle relative to hip
      const az = -THIGH * Math.sin(a1) - SHIN * Math.sin(a2);
      const lx = side === 'L' ? 0.1 : -0.1;
      const fx = s.x + lx * c + az * sn, fz = s.z - lx * sn + az * c;
      const delta = Math.max(-0.35, Math.min(0.45, s.ground(fx, fz) - s.y));
      legs.push({ side, ay, az, delta });
      drop = Math.max(drop, -delta);
    }
    drop = Math.min(drop, 0.3);
    B.hips.position.y -= drop;
    for (const g of legs) {
      // New ankle target relative to the (lowered) hip.
      const y = g.ay + g.delta + drop;
      const z = g.az;
      const L = Math.min(THIGH + SHIN - 0.002, Math.max(0.15, Math.hypot(y, z)));
      const knee = Math.PI - Math.acos(Math.max(-1, Math.min(1, (THIGH * THIGH + SHIN * SHIN - L * L) / (2 * THIGH * SHIN))));
      const alpha = Math.atan2(-z, -y);
      const beta = Math.acos(Math.max(-1, Math.min(1, (THIGH * THIGH + L * L - SHIN * SHIN) / (2 * THIGH * L))));
      const th = B[`thigh${g.side}`], sh = B[`shin${g.side}`], ft = B[`foot${g.side}`];
      th.rotation.x = alpha - beta;
      sh.rotation.x = knee;
      ft.rotation.x = -(th.rotation.x + sh.rotation.x);
    }
  }

  poseDeath(T, dt) {
    const d = this.death;
    d.t += dt;
    const B = this.bones;
    const f = smooth(clamp01(d.t / 0.9));
    let rx = 0, rz = 0, y = 0.05 * f, px = 0, pz = 0, hipsDrop = 0;
    // Limbs go slack.
    for (const n of ANIMATED) B[n].rotation.set(this.base[n].x * (1 - f), this.base[n].y * (1 - f), this.base[n].z * (1 - f));
    switch (d.kind) {
      case 'back':
        rx = -HALF_PI * 0.97 * f;
        B.upperL.rotation.set(-2.4 * f, 0, -0.6 * f);
        B.upperR.rotation.set(-2.2 * f, 0, 0.7 * f);
        B.head.rotation.x = -0.4 * f;
        break;
      case 'forward':
        rx = HALF_PI * 0.97 * f;
        B.upperL.rotation.set(-0.6 * f, 0, -0.9 * f);
        B.upperR.rotation.set(-0.4 * f, 0, 1.1 * f);
        B.head.rotation.y = 0.8 * f;
        break;
      case 'side':
        rz = HALF_PI * 0.95 * d.side * f;
        B.thighL.rotation.x = -0.6 * f;
        B.shinL.rotation.x = 1.2 * f;
        B.upperL.rotation.set(-1.0 * f, 0, -0.5 * f);
        break;
      case 'crumple': {
        const k1 = smooth(clamp01(d.t / 0.45));
        const k2 = smooth(clamp01((d.t - 0.45) / 0.7));
        hipsDrop = 0.5 * k1;
        B.thighL.rotation.x = B.thighR.rotation.x = -1.3 * k1;
        B.shinL.rotation.x = B.shinR.rotation.x = 1.9 * k1;
        rx = HALF_PI * 0.9 * k2;
        y = 0.05 * k2;
        B.spine.rotation.x = 0.5 * k1;
        break;
      }
      case 'blast': {
        // Thrown away from the explosion in an arc, tumbling, landing on the back.
        const tt = clamp01(d.t / 1.1);
        const [bx, bz] = d.blast;
        px = bx * 4.5 * smooth(tt);
        pz = bz * 4.5 * smooth(tt);
        y = Math.sin(Math.PI * tt) * 1.8 + 0.05 * tt;
        rx = -HALF_PI * smooth(tt) - Math.sin(Math.PI * tt) * 2.2;
        rz = d.spin * Math.sin(Math.PI * tt);
        B.upperL.rotation.set(-2.6 * tt, 0, -1.0 * tt);
        B.upperR.rotation.set(-1.8 * tt, 0, 1.2 * tt);
        B.thighL.rotation.x = -0.7 * tt;
        B.thighR.rotation.x = 0.3 * tt;
        break;
      }
    }
    B.hips.position.y = HIP_Y - hipsDrop;
    B.root.position.set(px, y, pz);
    B.root.rotation.set(rx, 0, rz);
    // Fade out over the last few seconds before the host removes the body (30 s).
    if (d.t > 26) {
      if (!this.mesh.material.transparent) this.mesh.material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9, transparent: true });
      this.mesh.material.opacity = Math.max(0, 1 - (d.t - 26) / 3.5);
    }
  }
}

// Kept for the lobby / anywhere a static soldier is enough.
export function idleUpdate(rig, dt) {
  rig.update({ dt, speed: 0, fwd: 0, side: 0, turn: 0, code: 0, aimPitch: 0, aiming: false, lod: 1, ground: null });
}
