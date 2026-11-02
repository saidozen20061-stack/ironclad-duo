import { Vector3, Euler, Quaternion } from 'three';
import { PLANES, FLIGHT, NPC_PLANES, SIDE_GUN_MAX_UP } from '../../../shared/planes.js';
import { TICK_RATE } from '../../../shared/constants.js';
import { groundAt, WATER_LEVEL, AIRFIELDS, onRunway, BASES } from '../../../shared/map.js';
import { PROPS, propsNear, segmentHitsProp, FORT } from '../../../shared/props.js';
import { wrapAngle } from '../../../shared/tank.js';

// Everything that flies: arcade flight model, weapons, damage zones, NPC pilots and flak.
// State is plain yaw (h), pitch (gp) and roll (ty), which the snapshots already carry.

const DT = 1 / TICK_RATE;
const G = 9.81;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a = -1, b = 1) => (v < a ? a : v > b ? b : v);
const r2 = (v) => Math.round(v * 100) / 100;

const fwd = (h, p, out = new Vector3()) => out.set(Math.sin(h) * Math.cos(p), Math.sin(p), Math.cos(h) * Math.cos(p));

let nextId = 500000;

export class Plane {
  constructor(team, type, x, y, z, h, v, { player = false, grounded = false } = {}) {
    this.id = nextId++;
    this.kind = 'plane';
    this.team = team;
    this.type = type;
    this.spec = PLANES[type];
    this.player = player;
    this.crewId = null;
    this.spawn = { x, y, z, h, v, grounded };
    this.radius = Math.max(this.spec.size.width, this.spec.size.length) / 2;
    this.drive = {};
    this.trigger = {};
    this.boost = 1;
    this.shell = '';
    this.reset();
  }

  reset() {
    const s = this.spawn, sp = this.spec;
    Object.assign(this, { x: s.x, y: s.y, z: s.z, h: s.h, gp: 0, ty: 0, v: s.v, vy: 0, grounded: s.grounded, dead: false, wrecked: false, hp: sp.hp, burning: 0, repair: null, reload: 0, reloadTotal: 1, respawnAt: 0, spin: 0 });
    this.throttle = s.grounded ? 0 : 0.8;
    this.fuel = 1;
    this.ammo = sp.guns.ammo;
    this.mag = this.ammo;
    this.rearAmmo = sp.rear?.ammo ?? 0;
    this.coaxBelt = this.rearAmmo;
    this.coaxReload = 0;
    this.bombs = sp.bombs?.count ?? 0;
    this.rockets = sp.rockets?.count ?? 0;
    this.gunCd = 0;
    this.rearCd = 0;
    this.bombCd = 0;
    this.rocketCd = 0;
    this.mods = { engine: 1, wingL: 1, wingR: 1, tail: 1, fuel: 1, gear: 1, guns: 1, crew: 1 };
    if (sp.engines === 2) this.mods.engine2 = 1;
    this.ctl = { th: 0, pitch: 0, roll: 0, yaw: 0, fire: false, bomb: false, rocket: false, aim: null };
    this.rear = { dir: null, fire: false };
    this.gunYaw = -Math.PI / 2; // pointing out of the door
    this.gunPitch = 0;
    this.stall = false;
    this.warnEdge = false;
    this.warnLow = false;
    this.pose = { y: this.y - sp.size.height / 2 };
    this.aim = { yaw: this.h, pitch: 0 };
    this.six = false;
  }

  respawn() {
    this.reset();
  }
}

// Where a body-space hit lands (x left, z forward).
function zoneAt(p, lx, lz) {
  const s = p.spec.size;
  if (Math.abs(lx) > s.width * 0.14) {
    if (p.spec.engines === 2 && Math.abs(lx) < s.width * 0.3 && lz > -s.length * 0.1) return lx > 0 ? 'engine' : 'engine2';
    return lx > 0 ? 'wingL' : 'wingR';
  }
  if (lz > s.length * 0.26) return p.spec.engines === 1 ? 'engine' : 'guns';
  if (lz < -s.length * 0.3) return 'tail';
  const r = Math.random();
  return r < 0.4 ? 'fuel' : r < 0.6 ? 'crew' : r < 0.8 ? 'guns' : 'gear';
}

export class PlaneSystem {
  constructor(match) {
    this.m = match;
    this.nextNpc = { blue: rand(8, 16), red: rand(12, 22) };
    // Flak: fixed AA positions scattered around bases, airfields and capture points.
    this.flak = PROPS.filter((p) => p.type === 'aagun').map((p) => ({ p, cd: rand(1, 4) }));
    this.flakQueue = [];
    this.planes = [];
    this.nextRole = { blue: 'fighter', red: 'attack' };
    this.airStart = !!match.room.airStart;
    // Fortress Defence: bomber and fighter waves are added by modes.js through spawnNpc.
  }

  crewSpawn(team, slot) {
    const f = AIRFIELDS[team];
    const y = groundAt(f.startX, f.z);
    const z = f.z + (slot - 2) * 4;
    if (this.airStart) return { x: f.startX + f.dir * 120, y: FLIGHT.airStartAlt, z, v: 45, grounded: false, h: f.heading };
    return { x: f.startX - f.dir * slot * 26, y, z, v: 0, grounded: true, h: f.heading };
  }

  createPlayerPlane(team, type, slot) {
    const s = this.crewSpawn(team, slot);
    const p = new Plane(team, type, s.x, s.y + (s.grounded ? PLANES[type].gearH : 0), s.z, s.h, s.v, { player: true, grounded: s.grounded });
    return p;
  }

  // ---------- Player input ----------
  onMessage(c, role, msg, p) {
    if (p.dead) return;
    if (role === 'driver' && msg.t === 'fly') {
      const k = p.ctl;
      k.th = clamp(Number(msg.th) || 0);
      k.pitch = clamp(Number(msg.pitch) || 0);
      k.roll = clamp(Number(msg.roll) || 0);
      k.yaw = clamp(Number(msg.yaw) || 0);
      k.fire = !!msg.fire;
      k.bomb = !!msg.bomb;
      k.rocket = !!msg.rocket;
      k.aim = Number.isFinite(msg.aimYaw) && Number.isFinite(msg.aimPitch) ? { yaw: msg.aimYaw, pitch: clamp(msg.aimPitch, -1.4, 1.4) } : null;
    } else if (role === 'gunner' && msg.t === 'rear') {
      if (Array.isArray(msg.dir) && msg.dir.every(Number.isFinite)) p.rear.dir = new Vector3(msg.dir[0], msg.dir[1], msg.dir[2]).normalize();
      p.rear.fire = !!msg.fire;
      if (msg.bomb) this.dropBomb(p);
    } else if (role === 'gunner' && msg.t === 'ping' && Number.isFinite(msg.x) && Number.isFinite(msg.z)) {
      this.m.setPing(c, msg.x, msg.z);
    }
    if (msg.t === 'jump') this.m.bailFromPlane(c);
  }

  // ---------- Per tick ----------
  tick() {
    const m = this.m;
    this.planes = m.units.filter((u) => u.kind === 'plane');
    for (const p of this.planes) {
      if (p.dead) this.fall(p);
      else {
        if (!p.player) this.npc(p);
        else if (m.crewOf(p) && !m.crewOf(p).seats.driver) p.ctl.aim = { yaw: p.h, pitch: 0 }; // pilot gone: hold level
        this.fly(p);
        if (p.dead) continue;
        this.weapons(p);
        this.damageEffects(p);
      }
    }
    this.flakTick();
  }

  // ---------- Flight model ----------
  fly(p) {
    const s = p.spec, k = p.ctl, mods = p.mods;
    const engines = s.engines === 2 ? (mods.engine > 0 ? 0.5 : 0) + (mods.engine2 > 0 ? 0.5 : 0) : mods.engine > 0 ? 1 : 0;
    const health = s.engines === 2 ? (0.5 + 0.5 * (mods.engine + mods.engine2) / 2) : 0.5 + 0.5 * mods.engine;
    p.throttle = clamp(p.throttle + k.th * DT * 0.55, 0, 1);
    if (p.fuel <= 0) p.throttle = 0;
    p.fuel = Math.max(0, p.fuel - (p.throttle * DT) / FLIGHT.fuelSeconds * (mods.fuel < 0.5 ? 4 : 1));

    // Mouse aim (solo, NPCs): turn the aim direction into stick movements.
    let stickP = k.pitch, stickR = k.roll, stickY = k.yaw;
    if (k.aim) {
      const errY = wrapAngle(k.aim.yaw - p.h);
      const errP = k.aim.pitch - p.gp;
      const wantBank = clamp(-errY * 2.6, -1.25, 1.25);
      const c = Math.cos(p.ty), sn = Math.sin(p.ty);
      // Bank into the turn, then pull: the nose follows the aim like a real coordinated turn.
      if (!(Math.abs(k.roll) > 0.05)) stickR = clamp((wantBank - p.ty) * 2.2);
      stickP = clamp(errP * 4 * c + Math.abs(sn) * Math.min(1, Math.abs(errY) * 2));
      if (!(Math.abs(k.yaw) > 0.05)) stickY = clamp(-errY * 1.5);
    }

    const authority = clamp(p.v / (s.minSpeed * 1.5), 0.15, 1) * (p.v > s.maxSpeed * 1.2 ? 0.75 : 1);
    const tailK = 0.35 + 0.65 * mods.tail;
    const speed = p.v;

    if (p.grounded) return this.rollOnGround(p, stickP, stickR, stickY, engines, health);

    // Wings: a damaged wing pulls the plane over; a lost one is the end of controlled flight.
    const wingL = mods.wingL, wingR = mods.wingR;
    const wingBias = (wingL - wingR) * 0.5; // left wing gone (0) => rolls left
    const turnK = 0.45 + 0.55 * Math.min(wingL, wingR);
    const rollRate = s.roll * authority * stickR * turnK + wingBias * 0.8;
    const pitchRate = s.pitch * authority * stickP * tailK * turnK;
    const yawRate = s.yaw * authority * stickY * tailK;
    p.ty = wrapAngle(p.ty + rollRate * DT);
    // Body rates to heading and pitch, plus the sideways pull of banked wings.
    const c = Math.cos(p.ty), sn = Math.sin(p.ty);
    const cp = Math.max(0.15, Math.cos(p.gp));
    p.gp = clamp(p.gp + (pitchRate * c - yawRate * sn) * DT, -1.52, 1.52);
    p.h = wrapAngle(p.h + (-(pitchRate * sn) + yawRate * c) / cp * DT);
    const bankTurn = -sn * (G / Math.max(12, speed)) * 1.3 * authority * turnK;
    p.h = wrapAngle(p.h + (bankTurn / cp) * DT);
    // Wings level themselves slightly in hands-off flight.
    if (Math.abs(stickR) < 0.05 && !k.aim) p.ty -= p.ty * Math.min(1, DT * 0.5);

    // Speed: thrust against drag, gravity along the flight path.
    const thin = 1 - clamp((p.y - FLIGHT.maxAlt + 60) / 60, 0, 1);
    const thrust = s.accel * p.throttle * engines * health * thin;
    const dragA = s.accel * s.drag * (speed / s.maxSpeed) ** 2;
    const turnDrag = Math.abs(pitchRate) * speed * 0.03;
    p.v = Math.max(4, speed + (thrust - dragA - turnDrag - G * Math.sin(p.gp)) * DT);

    // Stall: below flying speed the nose drops and the plane mushes down.
    p.stall = speed < s.minSpeed;
    let sink = 0;
    if (p.stall) {
      const depth = clamp((s.minSpeed - speed) / s.minSpeed, 0, 1);
      p.gp = clamp(p.gp - (0.6 + depth * 1.4) * DT, -1.52, 1.52);
      p.ty = wrapAngle(p.ty + Math.sin(p.id + this.m.time * 2) * depth * 0.8 * DT);
      sink = depth * 16;
    }
    // Altitude ceiling: push the nose down rather than a hard wall.
    if (p.y > FLIGHT.maxAlt) p.gp = Math.min(p.gp, 0.15 - (p.y - FLIGHT.maxAlt) * 0.02);
    // Map edge: past the warning, the plane is turned back in.
    const edge = Math.max(Math.abs(p.x), Math.abs(p.z));
    p.warnEdge = edge > FLIGHT.edgeWarn;
    if (edge > FLIGHT.edgeTurn) {
      const back = wrapAngle(Math.atan2(-p.x, -p.z) - p.h);
      p.h = wrapAngle(p.h + clamp(back, -1, 1) * DT);
      p.ty += (clamp(-back, -1, 1) - p.ty) * DT;
    }

    const f = fwd(p.h, p.gp, _f);
    p.x += f.x * speed * DT;
    p.y += (f.y * speed - sink) * DT;
    p.z += f.z * speed * DT;
    p.vy = f.y * speed - sink;
    p.pose.y = p.y - s.size.height / 2;

    const ground = groundAt(p.x, p.z);
    const surface = Math.max(ground, WATER_LEVEL);
    p.warnLow = p.y - surface < FLIGHT.warnAlt && p.vy < -2;
    this.hitProps(p);
    if (!p.dead && p.y - s.gearH <= surface) this.touchdown(p, ground, surface);
  }

  // Touching the ground: a clean landing on wheels, a belly landing, or a crash.
  touchdown(p, ground, surface) {
    const s = p.spec;
    const sink = -p.vy;
    const water = ground < WATER_LEVEL;
    const gear = p.mods.gear > 0;
    const level = Math.abs(p.ty) < 0.4 && p.gp > -0.28 && p.gp < 0.4;
    const fast = p.v > s.maxSpeed * (onRunway(p.x, p.z) ? 0.95 : 0.7);
    if (water || !level || sink > 9 || fast) return this.crash(p);
    if (!gear) this.m.damage(p, s.hp * 0.25, { owner: p.lastHitBy ?? -1 });
    if (p.dead) return;
    p.grounded = true;
    p.y = surface + s.gearH;
    p.vy = 0;
    p.gp = 0;
  }

  rollOnGround(p, stickP, stickR, stickY, engines, health) {
    const s = p.spec, gear = p.mods.gear > 0;
    p.stall = false;
    p.warnLow = false;
    // Keep what the host left in the air, settling to level.
    p.ty *= 1 - Math.min(1, DT * 4);
    const friction = gear ? 2 + (p.throttle < 0.1 ? 8 : 0) : 16;
    const thrust = s.accel * p.throttle * engines * health;
    p.v = Math.max(0, p.v + (thrust - friction - 0.002 * p.v * p.v) * DT);
    // Steer with rudder or stick while rolling.
    const steer = clamp(stickY - stickR);
    p.h = wrapAngle(p.h + steer * clamp(p.v / 12, 0, 1) * 0.65 * DT);
    const f = fwd(p.h, 0, _f);
    p.x += f.x * p.v * DT;
    p.z += f.z * p.v * DT;
    const ground = groundAt(p.x, p.z);
    p.y = Math.max(ground, WATER_LEVEL) + s.gearH;
    p.vy = 0;
    p.gp = gear ? 0 : -0.03;
    p.pose.y = p.y - s.size.height / 2;
    if (ground < WATER_LEVEL) return this.crash(p);
    this.hitProps(p);
    if (p.dead) return;
    // Rotate and lift off once fast enough.
    if (p.v > s.minSpeed * 1.08 && stickP > 0.08 && gear) {
      p.grounded = false;
      p.gp = 0.1;
      p.y += 0.2;
    } else if (!gear && p.v > 8) this.m.damage(p, s.hp * 0.03 * DT, { owner: -1 });
    // Own airfield: slow down on it and the ground crew repairs, refuels and rearms.
    const f2 = AIRFIELDS[p.team];
    if (p.v < 6 && Math.abs(p.x - f2.x) < f2.len / 2 + 10 && Math.abs(p.z - f2.z) < f2.width + 25) this.service(p);
  }

  service(p) {
    const s = p.spec;
    p.hp = Math.min(s.hp, p.hp + s.hp * FLIGHT.repairRate * DT);
    for (const k in p.mods) p.mods[k] = Math.min(1, p.mods[k] + FLIGHT.repairRate * 1.5 * DT);
    p.burning = 0;
    p.fuel = Math.min(1, p.fuel + 0.15 * DT);
    p.ammo = Math.min(s.guns.ammo, p.ammo + s.guns.ammo * 0.2 * DT);
    if (s.rear) p.rearAmmo = Math.min(s.rear.ammo, p.rearAmmo + s.rear.ammo * 0.2 * DT);
    p.mag = Math.round(p.ammo);
    p.coaxBelt = Math.round(p.rearAmmo);
    p.serviceT = (p.serviceT ?? 0) + DT;
    if (p.serviceT > 3) {
      p.serviceT = 0;
      if (s.bombs && p.bombs < s.bombs.count) p.bombs++;
      if (s.rockets && p.rockets < s.rockets.count) p.rockets++;
    }
  }

  hitProps(p) {
    const f = _f;
    fwd(p.h, p.grounded ? 0 : p.gp, f);
    const reach = Math.max(4, p.v * DT + p.spec.size.length / 2);
    for (const pr of propsNear(p.x, p.z, reach + 6)) {
      if (!pr.solid || this.m.propDead.has(pr.id) || pr.type === 'runway') continue;
      const t = segmentHitsProp(pr, p.x, p.y - p.spec.gearH * 0.4, p.z, f.x * reach, f.y * reach, f.z * reach);
      if (t !== null && !(p.grounded && p.v < 8)) return this.crash(p);
    }
  }

  crash(p) {
    const m = this.m;
    p.wrecked = true;
    p.y = Math.max(groundAt(p.x, p.z), WATER_LEVEL) + 0.8;
    p.pose.y = p.y - p.spec.size.height / 2;
    m.events.push({ k: 'boom', x: r2(p.x), y: r2(p.y), z: r2(p.z), size: 12 });
    if (!p.dead) m.damage(p, 1e7, { owner: p.lastHitBy ?? -1 });
    m.splash(p.x, p.y, p.z, 12, 200, p.lastHitBy ?? -1, p);
  }

  // Destroyed in the air: falls out of the sky, spinning, until it hits something.
  fall(p) {
    if (p.wrecked) return;
    const s = p.spec;
    p.gp = Math.max(-1.2, p.gp - DT * 0.5);
    p.ty = wrapAngle(p.ty + (p.spin || (p.spin = p.id % 2 ? 1.6 : -1.6)) * DT);
    p.v = Math.min(s.maxSpeed * 1.3, p.v + 6 * DT);
    const f = fwd(p.h, p.gp, _f);
    p.x += f.x * p.v * DT;
    p.y += f.y * p.v * DT - 3 * DT;
    p.z += f.z * p.v * DT;
    p.pose.y = p.y - s.size.height / 2;
    if (p.y <= Math.max(groundAt(p.x, p.z), WATER_LEVEL) + 1) this.crash(p);
  }

  // ---------- Weapons ----------
  weapons(p) {
    const m = this.m, s = p.spec, k = p.ctl;
    p.gunCd -= DT;
    p.rearCd -= DT;
    p.bombCd -= DT;
    p.rocketCd -= DT;
    const f = fwd(p.h, p.gp);
    if (k.fire && p.gunCd <= 0 && p.ammo > 0 && p.mods.guns > 0 && !p.grounded) {
      const g = s.guns;
      p.gunCd = g.interval;
      p.ammo--;
      p.mag = p.ammo;
      const side = Math.random() < 0.5 ? 1 : -1;
      const c = Math.cos(p.h), sn = Math.sin(p.h);
      const off = s.size.width * 0.12 * side;
      const pos = new Vector3(p.x + c * off + f.x * 2, p.y + f.y * 2 - 0.2, p.z - sn * off + f.z * 2);
      const spread = g.spread * (p.ai ? Math.sqrt(m.skill.aim) * 0.6 : 1) * (1 + (1 - p.mods.guns) * 2);
      m.fire(p, { kind: g.kind, damage: g.damage, speed: g.speed + p.v, splash: g.kind === 'ac' ? 1 : 0, splashDamage: g.kind === 'ac' ? g.damage * 0.3 : 0, spread, life: 2.2, air: true }, pos, f.clone());
    }
    if (k.bomb) this.dropBomb(p);
    if (k.rocket && p.rocketCd <= 0 && p.rockets > 0 && !p.grounded) {
      const r = s.rockets;
      p.rocketCd = 0.28;
      p.rockets--;
      const side = p.rockets % 2 ? 1 : -1;
      const pos = new Vector3(p.x + Math.cos(p.h) * s.size.width * 0.3 * side, p.y - 0.5, p.z - Math.sin(p.h) * s.size.width * 0.3 * side);
      m.fire(p, { kind: 'rocket', damage: r.damage, speed: r.speed + p.v, splash: r.splash, splashDamage: r.splashDamage, spread: r.spread * (p.ai ? m.skill.rocket : 1), life: 3 }, pos, f.clone());
    }
    this.rearGun(p);
    this.sixCheck(p);
  }

  dropBomb(p) {
    const s = p.spec;
    if (!s.bombs || p.bombs <= 0 || p.bombCd > 0 || p.grounded) return;
    p.bombCd = p.spec.id === 'mitchell' ? 0.3 : 0.6;
    p.bombs--;
    const f = fwd(p.h, p.gp);
    const pos = new Vector3(p.x - f.x * 0.5, p.y - 1.4, p.z - f.z * 0.5);
    const b = s.bombs;
    this.m.fire(p, { kind: 'bomb', damage: b.damage, speed: Math.max(15, p.v), splash: b.splash, splashDamage: b.splashDamage, spread: b.spread * (p.ai ? this.m.skill.aim * 0.5 : 1), life: 14 }, pos, f);
  }

  // The side gun: the gunner's aim, or automatic at nearby enemy planes (solo, NPC, empty seat).
  // It turns freely on its mount and fires everywhere except up past its stop.
  rearGun(p) {
    const s = p.spec, m = this.m;
    if (!s.rear) return;
    const crew = m.crewOf(p);
    const manned = crew && crew.seats.gunner;
    let dir = p.rear.dir;
    let fire = manned && p.rear.fire;
    let spread = s.rear.spread;
    if (!manned) {
      let best = null, bd = 260;
      for (const o of this.planes) {
        if (o.dead || o.team === p.team) continue;
        const d = Math.hypot(o.x - p.x, o.y - p.y, o.z - p.z);
        if (d < bd) {
          bd = d;
          best = o;
        }
      }
      dir = best ? new Vector3(best.x - p.x, best.y - p.y, best.z - p.z).normalize() : null;
      // Low accuracy, short bursts.
      fire = !!best && Math.random() < 0.35;
      spread *= 3.5;
    }
    // Where the gun points in the plane's own frame, for everyone to see on the model.
    _e.set(-p.gp, p.h, p.ty, 'YXZ');
    if (dir) {
      _q.setFromEuler(_e).invert();
      _l.copy(dir).applyQuaternion(_q);
      p.gunYaw = Math.atan2(_l.x, _l.z);
      p.gunPitch = Math.asin(clamp(_l.y));
    }
    if (!fire || !dir || p.rearCd > 0 || p.rearAmmo <= 0 || p.mods.crew <= 0 || p.grounded) return;
    if (_l.y > SIDE_GUN_MAX_UP) return;
    p.rearCd = s.rear.interval;
    p.rearAmmo--;
    p.coaxBelt = p.rearAmmo;
    const pos = new Vector3(...s.door).applyEuler(_e);
    pos.x += p.x;
    pos.y += p.y;
    pos.z += p.z;
    m.fire(p, { kind: 'mg', damage: s.rear.damage, speed: s.rear.speed, splash: 0, splashDamage: 0, spread, life: 2.2, air: true }, pos.addScaledVector(dir, 1.2), dir.clone());
  }

  // "Enemy on our six!": a warning when a hostile plane sits behind us.
  sixCheck(p) {
    if (!p.player) return;
    if (this.m.tickNo % 10) return;
    const f = fwd(p.h, p.gp, _f);
    let on = false;
    for (const o of this.planes) {
      if (o.dead || o.team === p.team) continue;
      const dx = o.x - p.x, dy = o.y - p.y, dz = o.z - p.z;
      const d = Math.hypot(dx, dy, dz);
      if (d < 320 && d > 1 && (dx * f.x + dy * f.y + dz * f.z) / d < -0.72) on = true;
    }
    if (on && !p.six) this.m.events.push({ k: 'six', u: p.id });
    p.six = on;
  }

  // ---------- Damage ----------
  // Ray against a plane: fuselage and wing boxes in body space.
  hitTest(p, x0, y0, z0, dx, dy, dz) {
    const s = p.spec.size;
    const ch = Math.cos(p.h), sh = Math.sin(p.h);
    const cp = Math.cos(p.gp), sp = Math.sin(p.gp);
    const toBody = (x, y, z) => {
      // Undo yaw, then pitch (roll is ignored: the wing box is thick enough).
      const lx = x * ch - z * sh;
      const fz = x * sh + z * ch;
      return [lx, y * cp - fz * sp, y * sp + fz * cp];
    };
    const o = toBody(x0 - p.x, y0 - p.y, z0 - p.z);
    const d = toBody(dx, dy, dz);
    const box = (min, max) => {
      let t0 = 0, t1 = 1;
      for (let a = 0; a < 3; a++) {
        if (Math.abs(d[a]) < 1e-9) {
          if (o[a] < min[a] || o[a] > max[a]) return null;
          continue;
        }
        let a0 = (min[a] - o[a]) / d[a], a1 = (max[a] - o[a]) / d[a];
        if (a0 > a1) [a0, a1] = [a1, a0];
        t0 = Math.max(t0, a0);
        t1 = Math.min(t1, a1);
        if (t0 > t1) return null;
      }
      return t0;
    };
    const fus = box([-1, -1.1, -s.length / 2], [1, 1.1, s.length / 2]);
    const wing = box([-s.width / 2, -0.7, -1.2], [s.width / 2, 0.7, 1.8]);
    const t = fus === null ? wing : wing === null ? fus : Math.min(fus, wing);
    if (t === null) return null;
    const lx = o[0] + d[0] * t, lz = o[2] + d[2] * t;
    return { t, x: x0 + dx * t, y: y0 + dy * t, z: z0 + dz * t, unit: p, face: 'side', cosInc: 1, zone: zoneAt(p, lx, lz), lx, ly: o[1] + d[1] * t, lz };
  }

  damageZone(p, zone, dmg) {
    const m = this.m;
    if (!(zone in p.mods)) zone = 'fuel';
    const before = p.mods[zone];
    if (before <= 0) return;
    const after = Math.max(0, before - dmg / (p.spec.hp * 0.4));
    p.mods[zone] = after;
    const crossed = (l) => before >= l && after < l;
    if (crossed(0.5) || after === 0) m.events.push({ k: 'mod', u: p.id, m: zone, state: after === 0 ? 'destroyed' : 'damaged' });
    if (zone === 'fuel' && after < 0.5 && Math.random() < 0.35) p.burning = 12;
    if ((zone === 'engine' || zone === 'engine2') && after < 0.3 && Math.random() < 0.5) p.burning = 10;
    if ((zone === 'wingL' || zone === 'wingR') && after === 0) {
      // Wing gone: nothing keeps this one in the air.
      m.events.push({ k: 'wing', u: p.id, side: zone });
      p.spin = zone === 'wingL' ? 2.6 : -2.6;
      m.damage(p, p.hp + 1, { owner: p.lastHitBy ?? -1 });
    }
  }

  damageEffects(p) {
    if (p.burning > 0) {
      p.burning -= DT;
      this.m.damage(p, p.spec.hp * 0.012 * DT * 20 * DT, { owner: p.lastHitBy ?? p.id });
    }
    if (p.mods.fuel < 0.5) p.fuel = Math.max(0, p.fuel - DT / 240);
  }

  // ---------- Flak ----------
  flakTick() {
    const m = this.m;
    const air = this.planes.filter((p) => !p.dead && !p.grounded && p.y - groundAt(p.x, p.z) > 25);
    for (const q of this.flakQueue) q.t -= DT;
    const due = this.flakQueue.filter((q) => q.t <= 0);
    if (due.length) this.flakQueue = this.flakQueue.filter((q) => q.t > 0);
    for (const b of due) {
      m.events.push({ k: 'flak', x: r2(b.x), y: r2(b.y), z: r2(b.z) });
      for (const p of air) {
        if (p.team !== b.team) {
          const d = Math.hypot(p.x - b.x, p.y - b.y, p.z - b.z);
          if (d < 20) {
            const dmg = 40 * m.skill.damage * (1 - d / 20);
            p.lastHitBy = -1;
            this.damageZone(p, zoneAt(p, rand(-1, 1) * p.spec.size.width * 0.4, rand(-1, 1) * p.spec.size.length * 0.4), dmg * 0.6);
            m.damage(p, dmg, { owner: -1 });
          }
        }
      }
    }
    if (!air.length) return;
    const fortress = m.mode === 'fortress';
    for (const g of this.flak) {
      g.cd -= DT;
      if (g.cd > 0) continue;
      g.cd = rand(2.4, 4.5);
      const { p: gun } = g;
      // Capture-point guns belong to whoever holds the point; the fortress guns to Blue.
      const point = gun.point && m.points.find((q) => q.id === gun.point);
      const team = fortress && !gun.team ? 'blue' : gun.team ?? point?.owner;
      if (!team || m.propDead.has(gun.id)) continue;
      let best = null, bd = 480;
      for (const p of air) {
        if (p.team === team) continue;
        const d = Math.hypot(p.x - gun.x, p.y - gun.y, p.z - gun.z);
        if (d < bd) {
          bd = d;
          best = p;
        }
      }
      if (!best) continue;
      // Shell flies 320 m/s; aim error grows with range and with an easy setting.
      const fuse = bd / 320;
      const lead = fwd(best.h, best.gp, _f);
      const err = (6 + bd * 0.05) * m.skill.aim * 0.42;
      this.flakQueue.push({
        t: fuse,
        team,
        x: best.x + lead.x * best.v * fuse * m.skill.lead + rand(-err, err),
        y: best.y + lead.y * best.v * fuse * m.skill.lead + rand(-err, err) * 0.7,
        z: best.z + lead.z * best.v * fuse * m.skill.lead + rand(-err, err),
      });
    }
  }

  // ---------- NPC air force ----------
  updateSpawns() {
    const m = this.m;
    for (const team of ['blue', 'red']) {
      if (m.mode === 'fortress') continue;
      this.nextNpc[team] -= DT;
      if (this.nextNpc[team] > 0) continue;
      this.nextNpc[team] = NPC_PLANES.every;
      if (!this.sideHasPlane(team)) {
        this.spawnNpc(team, this.nextRole[team]);
        this.nextRole[team] = this.nextRole[team] === 'fighter' ? 'attack' : 'fighter';
      }
    }
  }

  // One plane per side: a player crew's plane holds the slot even while it waits to respawn.
  sideHasPlane(team) {
    return this.m.units.some((u) => u.kind === 'plane' && u.team === team && (u.player || !u.dead));
  }

  spawnNpc(team, role) {
    const list = NPC_PLANES[team][role];
    const type = list[Math.floor(Math.random() * list.length)];
    const b = BASES[team];
    const s = team === 'blue' ? -1 : 1;
    const p = new Plane(team, type, b.x + rand(-300, 300), rand(150, 230), b.z + s * 80, b.heading, PLANES[type].maxSpeed * 0.75);
    p.ai = { role, think: rand(0, 0.5), target: null, climbT: 0, reactTo: null, reactT: 0, ground: null, pass: rand(0.8, 1.2) };
    this.m.units.push(p);
    return p;
  }

  npc(p) {
    const m = this.m, ai = p.ai, s = p.spec;
    ai.think -= DT;
    if (ai.think <= 0) {
      ai.think = rand(0.5, 0.9);
      if (ai.target?.dead || (ai.target && !m.units.includes(ai.target))) ai.target = null;
      if (!ai.target || Math.random() < 0.08) ai.target = this.pickTarget(p);
    }
    const k = p.ctl;
    k.th = p.throttle < 0.95 ? 1 : 0;
    k.fire = false;
    k.bomb = false;
    k.rocket = false;
    const t = ai.target;
    let aimYaw = p.h, aimPitch = 0;
    const alt = p.y - Math.max(groundAt(p.x, p.z), WATER_LEVEL);
    if (t && !t.dead) {
      const ty = t.kind === 'plane' ? t.y : t.pose.y + 1.2;
      const dx = t.x - p.x, dy = ty - p.y, dz = t.z - p.z;
      const hd = Math.hypot(dx, dz);
      const d = Math.hypot(hd, dy);
      // Lead moving targets as far as this difficulty manages.
      const fl = (d / (s.guns.speed + p.v)) * m.skill.lead;
      const vt = t.kind === 'plane' ? fwd(t.h, t.gp) : t.kind === 'tank' ? new Vector3(Math.sin(t.h) * t.v, 0, Math.cos(t.h) * t.v) : new Vector3();
      const sp = t.kind === 'plane' ? t.v : 1;
      const lx = dx + vt.x * sp * fl, ly = dy + vt.y * sp * fl, lz = dz + vt.z * sp * fl;
      aimYaw = Math.atan2(lx, lz);
      aimPitch = Math.atan2(ly, Math.hypot(lx, lz));
      const reacting = m.army.reacting(ai, t, DT);
      const f = fwd(p.h, p.gp, _f);
      const align = (lx * f.x + ly * f.y + lz * f.z) / Math.max(1, Math.hypot(lx, ly, lz));
      if (t.kind !== 'plane') {
        // Ground attack: come in above the target, then push over into a shallow dive.
        if (hd > 320) aimPitch = clamp((130 - alt) * 0.006, -0.3, 0.4);
        else if (s.bombs && p.bombs > 0) {
          aimPitch = Math.max(aimPitch, -0.5);
          // Release where the bomb's fall carries it onto the target.
          const fall = Math.sqrt((2 * Math.max(5, alt)) / G);
          if (Math.abs(hd - p.v * Math.cos(p.gp) * fall) < 14 && align > 0.5 && !reacting) k.bomb = true;
        }
        if (hd < 90) ai.climbT = 3.5; // break off
      }
      if (!reacting && align > 0.992 - 0.003 * m.skill.aim && d < 340) {
        k.fire = true;
        if (t.kind === 'tank' && p.rockets > 0 && d < 260) k.rocket = true;
      }
    } else {
      // Patrol towards the middle of the map.
      const g = this.patrolPoint(p);
      aimYaw = Math.atan2(g.x - p.x, g.z - p.z);
      aimPitch = clamp((170 - alt) * 0.008, -0.2, 0.35);
    }
    if (ai.climbT > 0) {
      ai.climbT -= DT;
      aimPitch = 0.45;
    }
    // Never mind the target when the ground is coming up.
    const f = fwd(p.h, p.gp, _f);
    const ahead = Math.max(groundAt(p.x + f.x * 80, p.z + f.z * 80), WATER_LEVEL);
    if (alt < 48 || p.y + f.y * 90 < ahead + 34) {
      // Wings level and pull: a banked plane can't climb out.
      aimPitch = Math.max(aimPitch, 0.5);
      aimYaw = p.h;
    }
    if (p.y > FLIGHT.maxAlt - 60) aimPitch = Math.min(aimPitch, -0.1);
    const edge = Math.max(Math.abs(p.x), Math.abs(p.z));
    if (edge > 950) aimYaw = Math.atan2(-p.x, -p.z);
    k.aim = { yaw: aimYaw, pitch: aimPitch };
    p.throttle = Math.max(p.throttle, 0.8);
  }

  patrolPoint(p) {
    const fortress = this.m.mode === 'fortress';
    return fortress ? { x: FORT.center.x, z: FORT.center.z } : { x: Math.sin(p.id) * 300, z: Math.cos(p.id) * 200 };
  }

  pickTarget(p) {
    const m = this.m, ai = p.ai;
    let best = null, bs = Infinity;
    for (const e of m.units) {
      if (e.dead || e.team === p.team) continue;
      const d = Math.hypot(e.x - p.x, e.z - p.z);
      if (d > 950) continue;
      if (!m.army.inView(p, e, d, 1.75)) continue; // a pilot sees a lot, but not behind the tail
      let score = d;
      if (e.kind === 'plane') {
        if (e.grounded) score += 900;
        else if (ai.role === 'fighter') score *= 0.35;
        else score += 300;
      } else if (e.kind === 'tank') score *= ai.role === 'attack' ? 0.5 : 1.2;
      else if (e.kind === 'inf') score += ai.role === 'attack' ? 250 : 600;
      else score += 200;
      if (e.player) score *= 0.85;
      if (score < bs) {
        bs = score;
        best = e;
      }
    }
    return best;
  }
}

const _f = new Vector3();
const _l = new Vector3();
const _e = new Euler();
const _q = new Quaternion();
