import { Vector3, Euler, Quaternion } from 'three';
import { PLANES, FLIGHT, NPC_PLANES, SIDE_GUN_MAX_UP, ROCKET, MAX_SIDE_PLANES, AA_TURRETS, engineZones } from '../../../shared/planes.js';
import { TICK_RATE } from '../../../shared/constants.js';
import { groundAt, WATER_LEVEL, AIRFIELDS, onRunway, BASES, HALF } from '../../../shared/map.js';
import { PROPS, propsNear, segmentHitsProp, FORT } from '../../../shared/props.js';
import { wrapAngle } from '../../../shared/tank.js';

// Everything that flies: arcade flight model, weapons, damage zones, NPC pilots and flak.
// State is plain yaw (h), pitch (gp) and roll (ty), which the snapshots already carry.

const DT = 1 / TICK_RATE;
const G = 9.81;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a = -1, b = 1) => (v < a ? a : v > b ? b : v);
const r2 = (v) => Math.round(v * 100) / 100;

// NPC planes roam the map: an attack run on whatever they meet, then off somewhere else.
const PATROL = 620; // m from the middle of the map
const TARGET_RANGE = 420; // m: only what's near their route
const RUN_TIME = [14, 22]; // s of one attack run
const REST_TIME = [20, 35]; // s before they look for the next target
const HEAVY_RUN = 3; // × run time: a Leviathan takes that long to get anywhere
const HEAVY_ALT = 190; // m above the ground it holds
const ESCORT_SLOTS = [[-54, -4, -14], [54, -4, -14], [0, -14, -46]]; // m from the Leviathan: sideways, up, ahead
const ESCORT_REPLACE = 45; // s after one is shot down, while its Leviathan still flies
const ESCORT_GUARD = 260; // m around the Leviathan they'll go after enemy planes
const ESCORT_LEASH = 420; // m they'll chase one before coming back
const ELITE_REARM = 40; // s per salvo: an AI bomber can't land to rearm
const BOMB_REACH = 34; // m around the impact point that's worth a salvo
// A proper take-off roll: tyres and a heavy plane hold it back until it's well up to speed.
const GROUND_THRUST = 0.5; // of the thrust in the air
const TAKEOFF_SPEED = 0.7; // × top speed
// Climbing out: while the climb key stays held after lift-off, the nose eases up to a gentle climb.
const ROTATE_TIME = 2; // s for the nose to start moving at its full rate
const CLIMB_PITCH = 0.3; // radians
const CLIMB_HOLD = 6; // s before a held key starts steepening the climb
const CLIMB_STEEPEN = 0.15; // radians per second after that
const HANGAR_DOOR = 36; // m: the widest plane that fits through an ordinary hangar's door
// Steering on the ground: tight at taxiing speed, gentler once it's rolling fast.
const TAXI_TURN = 1.1, ROLL_TURN = 0.65; // radians per second
const TAXI_SPEED = 15, ROLL_SPEED = 30; // m/s
// An NPC plane's way from its hangar to the sky.
const NPC_TAXI_SPEED = 10; // m/s
const NPC_CLIMB = { pitch: 0.22, height: 45 }; // radians, m above the ground before it goes about its business
const NPC_STUCK = 75; // s: longer than this on the ground and something's badly wrong with it
const SPAWN_RETRY = 2; // s
const HELI_SETTLE = 3.2; // how quickly (per second) a helicopter leans into a move
const HELI_TOUCHDOWN = 3; // m/s it comes down at in the last moment before landing
const HELI_WARMUP = 3.5; // s of holding the rise key for the rotor to get up to speed
const HELI_SPINDOWN = 6; // s for it to wind down again on the ground
const HELI_LIFT = 5; // s after lifting off before it climbs at full rate
const HELI_LIFT_CLIMB = 1.5; // m/s it leaves the ground at
const GROUND_IDLE = 1.2; // throttle lost per second on the ground with the key let go
const LIFT_GRACE = 5; // s after lift-off that touching the ground again doesn't count as landing too fast
const GROUND_EDGE = 10; // m from the edge of the map that a rolling plane stops going any further
const ROCKET_OFFSET = 1.5; // m to the side of the fuselage
const ROCKET_BELOW = 0.85; // × gear height under the plane: clear of every wing and its underside
const ROCKET_CONVERGE = 150; // m ahead, where both sides' rockets cross the nose line

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
    Object.assign(this, { x: s.x, y: s.y, z: s.z, h: s.h, gp: 0, ty: 0, v: s.v, vy: 0, grounded: s.grounded, climbOut: null, dead: false, wrecked: false, hp: sp.hp, burning: 0, repair: null, reload: 0, reloadTotal: 1, respawnAt: 0, spin: 0 });
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
    this.mods = { wingL: 1, wingR: 1, tail: 1, fuel: 1, gear: 1, guns: 1, crew: 1 };
    for (const z of engineZones(sp.engines)) this.mods[z] = 1;
    if (sp.heli) {
      // Stub wings and skids: nothing to lose that it can't fly without.
      delete this.mods.wingL;
      delete this.mods.wingR;
      delete this.mods.gear;
      this.hv = { x: 0, y: 0, z: 0 };
      this.hRate = 0;
      this.spool = s.grounded ? 0 : 1;
      this.liftT = HELI_LIFT;
    }
    this.aaClock = 0;
    this.aaAway = 0;
    this.aaWarn = 0;
    this.ab = false;
    this.opRocket = false;
    this.ctl = { th: 0, pitch: 0, roll: 0, yaw: 0, fire: false, bomb: false, rocket: false, aim: null };
    this.rear = { dir: null, fire: false };
    this.gunYaw = sp.door?.[0] ? -Math.PI / 2 : 0; // out of the door, or a top turret facing ahead
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
  if (p.spec.heli) return Math.abs(lx) > s.width * 0.22 ? 'guns' : lz > 0 ? (Math.random() < 0.5 ? 'crew' : 'fuel') : lz < -s.length * 0.25 ? 'tail' : 'engine';
  // Several engines along the wing: which one depends on how far out the hit is.
  if (p.spec.engines > 2 && Math.abs(lx) > s.width * 0.1 && Math.abs(lx) < s.width * 0.42) {
    const pairs = p.spec.engines / 2;
    const pair = Math.min(pairs - 1, Math.floor(((Math.abs(lx) - s.width * 0.1) / (s.width * 0.32)) * pairs));
    if (Math.random() < 0.5) return engineZones(p.spec.engines)[pair * 2 + (lx > 0 ? 0 : 1)];
    return lx > 0 ? 'wingL' : 'wingR';
  }
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
    this.aaGuns = PROPS.filter((p) => p.type === 'aaturret').map((p, i) => ({ p, i, cd: rand(0, AA_TURRETS.interval), at: new Vector3(p.x, p.y + 5.2, p.z) }));
    this.flakQueue = [];
    this.planes = [];
    this.nextRole = { blue: 'fighter', red: 'attack' };
    this.nextElite = NPC_PLANES.eliteEvery;
    this.elitesDue = []; // waiting for a free hangar
    this.airStart = !!match.room.airStart;
    // Fortress Defence: bomber and fighter waves are added by modes.js through spawnNpc.
  }

  crewSpawn(team, slot, type) {
    const f = AIRFIELDS[team];
    if (this.airStart) return { x: f.startX + f.dir * 120, y: FLIGHT.airStartAlt, z: f.z + (slot ? 10 : -8), v: 45, grounded: false, h: f.heading };
    // A helicopter waits on its pad, no runway needed.
    if (PLANES[type].heli) {
      const pad = PROPS.filter((p) => p.type === 'helipad' && p.team === team)[slot ? 1 : 0];
      return { x: pad.x, y: groundAt(pad.x, pad.z), z: pad.z, v: 0, grounded: true, h: f.heading };
    }
    // Inside a hangar, nose just short of the door, facing out. The widest plane has its own.
    const size = PLANES[type].size;
    const hangars = PROPS.filter((p) => p.type === 'hangar' && p.team === team);
    const hangar = size.width > HANGAR_DOOR ? hangars.find((p) => p.big) : hangars.filter((p) => !p.big && !p.npc)[slot ? 1 : 0];
    const out = team === 'blue' ? -1 : 1; // the way the hangar door faces
    const z = hangar.z + out * (hangar.d / 2 - size.length / 2 - 1.5);
    return { x: hangar.x, y: groundAt(hangar.x, z), z, v: 0, grounded: true, h: out < 0 ? Math.PI : 0 };
  }

  createPlayerPlane(team, type, slot) {
    const s = this.crewSpawn(team, slot, type);
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
      k.face = Number.isFinite(msg.face) ? msg.face : null;
      k.gunDir = Array.isArray(msg.gun) && msg.gun.length === 3 && msg.gun.every((v) => Math.abs(v) <= 2) && Math.hypot(...msg.gun) > 0.01 ? new Vector3(msg.gun[0], msg.gun[1], msg.gun[2]).normalize() : null;
    } else if (role === 'gunner' && msg.t === 'rear') {
      if (Array.isArray(msg.dir) && msg.dir.length === 3 && msg.dir.every((v) => Math.abs(v) <= 2) && Math.hypot(...msg.dir) > 0.01) p.rear.dir = new Vector3(msg.dir[0], msg.dir[1], msg.dir[2]).normalize();
      p.rear.fire = !!msg.fire;
      p.opRocket = !!msg.rocket;
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
    if (m.mode !== 'fortress') this.aaTick();
  }

  // ---------- Flight model ----------
  fly(p) {
    const s = p.spec, k = p.ctl, mods = p.mods;
    if (s.heli) return this.flyHeli(p);
    const zones = engineZones(s.engines);
    const engines = zones.filter((z) => mods[z] > 0).length / zones.length;
    const health = 0.5 + (0.5 * zones.reduce((sum, z) => sum + mods[z], 0)) / zones.length;
    p.throttle = clamp(p.throttle + k.th * DT * 0.55, 0, 1);
    // Taxiing: the engine only pulls while the key is held, so a pilot can slow down for a turn.
    if (p.player && p.grounded && k.th <= 0) p.throttle = Math.max(0, p.throttle - DT * GROUND_IDLE);
    if (p.fuel <= 0) p.throttle = 0;
    // Afterburner: keep asking for more throttle once it's already full. It drinks fuel.
    p.ab = !!s.afterburner && k.th > 0 && p.throttle >= 0.99 && engines > 0 && !p.grounded;
    p.fuel = Math.max(0, p.fuel - (p.throttle * DT) / FLIGHT.fuelSeconds * (mods.fuel < 0.5 ? 4 : 1) * (p.ab ? 3 : 1));

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
    let pitchRate = s.pitch * authority * stickP * tailK * turnK;
    if (p.climbOut != null) {
      p.climbOut += DT;
      if (stickP > 0) {
        const cap = CLIMB_PITCH + Math.max(0, p.climbOut - CLIMB_HOLD) * CLIMB_STEEPEN;
        pitchRate = Math.min(pitchRate, Math.max(0, cap - p.gp) * Math.min(1, p.climbOut / ROTATE_TIME));
      } else p.climbOut = null; // let go: normal flying from here
    }
    const yawRate = s.yaw * authority * stickY * tailK;
    p.ty = wrapAngle(p.ty + rollRate * DT);
    // Body rates to heading and pitch, plus the sideways pull of banked wings.
    const c = Math.cos(p.ty), sn = Math.sin(p.ty);
    const cp = Math.max(0.15, Math.cos(p.gp));
    if (k.aim) {
      // NPCs fly by the book: the elevator pulls towards the plane's own "up", which is sideways in a bank.
      p.gp = clamp(p.gp + (pitchRate * c - yawRate * sn) * DT, -1.52, 1.52);
      p.h = wrapAngle(p.h + (-(pitchRate * sn) + yawRate * c) / cp * DT);
    } else {
      // Players: the keys mean what they say, however far the plane is banked. Up is up, down is
      // down, and only the turn keys change direction.
      p.gp = clamp(p.gp + pitchRate * DT, -1.52, 1.52);
      p.h = wrapAngle(p.h + (yawRate * c) / cp * DT);
    }
    const bankTurn = -sn * (G / Math.max(12, speed)) * 1.3 * authority * turnK * (s.turnK ?? 1);
    p.h = wrapAngle(p.h + (bankTurn / cp) * DT);

    // Speed: thrust against drag, gravity along the flight path.
    const thin = 1 - clamp((p.y - FLIGHT.maxAlt + 60) / 60, 0, 1);
    const thrust = s.accel * p.throttle * engines * health * thin * (p.ab ? s.afterburner : 1);
    const dragA = s.accel * s.drag * (speed / s.maxSpeed) ** 2;
    // A jet pays for a hard turn with speed: that's when it can be caught.
    const turnDrag = Math.abs(pitchRate) * speed * 0.03 + (s.turnBleed ?? 0) * Math.abs(sn) * speed;
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

  // A helicopter: the keys set the speed it wants in its own frame, and it works its way there. Let go
  // and it slows to a stop and hangs in the air; turn, and it keeps sliding the way it was going until
  // the rotor catches up. The nose swings round to wherever the pilot is looking, with some weight to it.
  flyHeli(p) {
    const s = p.spec, h = s.heli, k = p.ctl, v = p.hv, mods = p.mods;
    const crew = this.m.crewOf(p);
    const held = crew && !crew.seats.driver; // pilot's gone: it just hangs there
    const power = p.fuel > 0 && mods.engine > 0;
    p.fuel = Math.max(0, p.fuel - (DT / FLIGHT.fuelSeconds) * (mods.fuel < 0.5 ? 4 : 1) * (p.grounded ? 0.2 : 1));
    p.stall = false;
    p.warnLow = false;
    p.ab = false;
    const surface = () => Math.max(groundAt(p.x, p.z), WATER_LEVEL);
    if (p.grounded) {
      v.x = v.y = v.z = 0;
      p.hRate = 0;
      p.v = 0;
      p.vy = 0;
      const warming = !held && k.th > 0 && power;
      p.spool = warming ? Math.min(1, p.spool + DT / HELI_WARMUP) : Math.max(0, p.spool - DT / HELI_SPINDOWN);
      p.throttle = power ? 0.05 + 0.6 * p.spool : 0;
      p.gp *= 1 - Math.min(1, DT * 6);
      p.ty *= 1 - Math.min(1, DT * 6);
      p.y = surface() + s.gearH;
      p.pose.y = p.y - s.size.height / 2;
      if (warming && p.spool >= 1) {
        p.grounded = false;
        p.liftT = 0;
      }
      const f = AIRFIELDS[p.team];
      if (Math.abs(p.x - f.x) < f.len / 2 + 60 && Math.abs(p.z - f.z) < f.width + 90) this.service(p);
      return;
    }
    // A lost tail rotor means it spins, and the nose won't answer so well.
    const tail = mods.tail > 0 ? 0.5 + 0.5 * mods.tail : 0.25;
    const turn = h.turn * tail;
    const wantRate = !held && k.face != null ? clamp(wrapAngle(k.face - p.h) * 3.5, -turn, turn) : 0;
    p.hRate += clamp(wantRate - p.hRate, -h.turnAccel * DT, h.turnAccel * DT);
    p.h = wrapAngle(p.h + p.hRate * DT);
    if (mods.tail <= 0) p.h = wrapAngle(p.h + 1.1 * DT);
    const fx = Math.sin(p.h), fz = Math.cos(p.h), lx = fz, lz = -fx;
    const max = s.maxSpeed * (0.45 + 0.55 * mods.engine);
    const ahead = held || !power ? 0 : k.pitch * max * (k.pitch < 0 ? h.back : 1);
    const left = held || !power ? 0 : -k.roll * max * h.side;
    let climb = !power ? -h.downAfterEngine : held ? 0 : k.th * h.climb;
    if (p.y > FLIGHT.maxAlt) climb = Math.min(climb, -2);
    // Just off the ground it rises slowly, then builds up.
    p.liftT += DT;
    if (p.liftT < HELI_LIFT) climb = Math.min(climb, HELI_LIFT_CLIMB + (h.climb - HELI_LIFT_CLIMB) * (p.liftT / HELI_LIFT) ** 2);
    // Close to the ground the pilot eases it down: holding the key sets it on its skids, no harder.
    if (power) climb = Math.max(climb, -(HELI_TOUCHDOWN + (p.y - s.gearH - surface()) * 0.9));
    const wx = fx * ahead + lx * left, wz = fz * ahead + lz * left;
    const step = h.accel * DT, ups = h.climbAccel * DT;
    v.x += clamp(wx - v.x, -step, step);
    v.z += clamp(wz - v.z, -step, step);
    v.y += clamp(climb - v.y, -ups, ups);
    // Past the edge of the battle it won't go any further out.
    const edge = Math.max(Math.abs(p.x), Math.abs(p.z));
    p.warnEdge = edge > FLIGHT.edgeWarn;
    if (Math.abs(p.x) > FLIGHT.edgeTurn && p.x * v.x > 0) v.x = 0;
    if (Math.abs(p.z) > FLIGHT.edgeTurn && p.z * v.z > 0) v.z = 0;
    // Leans into where it's going, and harder while it's getting there.
    const vAhead = v.x * fx + v.z * fz, vLeft = v.x * lx + v.z * lz;
    const wantP = -h.tilt * clamp((vAhead + (ahead - vAhead) * 0.5) / s.maxSpeed);
    const wantR = -h.lean * clamp((vLeft + (left - vLeft) * 0.5) / s.maxSpeed);
    const ease = Math.min(1, DT * HELI_SETTLE);
    p.gp += (wantP - p.gp) * ease;
    p.ty += (wantR - p.ty) * ease;
    const speed = Math.hypot(v.x, v.y, v.z);
    p.v = Math.hypot(v.x, v.z);
    p.vy = v.y;
    p.throttle = power ? clamp(0.5 + (0.3 * p.v) / s.maxSpeed + (0.25 * v.y) / h.climb, 0.2, 1) : 0;
    // Into something: at a walk it just stops; any faster it comes apart.
    if (speed > 0.5) {
      const reach = speed * DT + s.size.length * 0.45;
      const ux = v.x / speed, uy = v.y / speed, uz = v.z / speed;
      for (const pr of propsNear(p.x, p.z, reach + 6)) {
        if (!pr.solid || this.m.propDead.has(pr.id) || pr.type === 'runway') continue;
        if (segmentHitsProp(pr, p.x, p.y - s.gearH * 0.4, p.z, ux * reach, uy * reach, uz * reach) === null) continue;
        if (speed > 16) return this.crash(p);
        v.x *= -0.3;
        v.y *= -0.3;
        v.z *= -0.3;
        break;
      }
    }
    p.x += v.x * DT;
    p.y += v.y * DT;
    p.z += v.z * DT;
    p.pose.y = p.y - s.size.height / 2;
    const ground = groundAt(p.x, p.z), under = Math.max(ground, WATER_LEVEL);
    if (p.y - s.gearH <= under) {
      if (ground < WATER_LEVEL || v.y < -14 || p.v > 26) return this.crash(p);
      p.grounded = true;
      p.y = under + s.gearH;
      p.pose.y = p.y - s.size.height / 2;
    }
  }

  // Touching the ground: a clean landing on wheels, a belly landing, or a crash.
  touchdown(p, ground, surface) {
    const s = p.spec;
    const sink = -p.vy;
    const water = ground < WATER_LEVEL;
    const gear = p.mods.gear > 0;
    const level = Math.abs(p.ty) < 0.4 && p.gp > -0.28 && p.gp < 0.4;
    // Wheels back on the ground right after lifting off, over rising ground, isn't a landing: at the
    // speed it takes to lift off, it just carries on rolling and lifts again.
    const lifting = p.climbOut != null && p.climbOut < LIFT_GRACE;
    const fast = !lifting && p.v > s.maxSpeed * (onRunway(p.x, p.z) ? 0.95 : 0.7);
    if (water || !level || sink > 9 || fast) return this.crash(p);
    if (!gear) this.m.damage(p, s.hp * 0.25, { owner: p.lastHitBy ?? -1 });
    if (p.dead) return;
    p.grounded = true;
    p.climbOut = null;
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
    const thrust = s.accel * p.throttle * engines * health * GROUND_THRUST;
    p.v = Math.max(0, p.v + (thrust - friction - 0.002 * p.v * p.v) * DT);
    // Steer with rudder or stick while rolling.
    const steer = clamp(stickY - stickR);
    const rate = TAXI_TURN + (ROLL_TURN - TAXI_TURN) * clamp((p.v - TAXI_SPEED) / (ROLL_SPEED - TAXI_SPEED), 0, 1);
    p.h = wrapAngle(p.h + steer * clamp(p.v / 12, 0, 1) * rate * DT);
    const f = fwd(p.h, 0, _f);
    p.x += f.x * p.v * DT;
    p.z += f.z * p.v * DT;
    // Can't roll off the edge of the world: it runs along it instead, and can still turn back.
    p.x = clamp(p.x, -HALF + GROUND_EDGE, HALF - GROUND_EDGE);
    p.z = clamp(p.z, -HALF + GROUND_EDGE, HALF - GROUND_EDGE);
    const ground = groundAt(p.x, p.z);
    p.y = Math.max(ground, WATER_LEVEL) + s.gearH;
    p.vy = 0;
    p.gp = gear ? 0 : -0.03;
    p.pose.y = p.y - s.size.height / 2;
    if (ground < WATER_LEVEL) return this.crash(p);
    this.hitProps(p);
    if (p.dead) return;
    // Rotate and lift off once fast enough.
    if (p.v > s.maxSpeed * (s.takeoff ?? TAKEOFF_SPEED) && stickP > 0.08 && gear) {
      p.grounded = false;
      p.climbOut = 0;
      p.gp = 0.01;
      p.y += 0.05;
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
      // Rolling out of the hangar it was parked in.
      if (p.grounded && pr.type === 'hangar' && Math.abs(p.x - pr.x) < pr.w / 2 && Math.abs(p.z - pr.z) < pr.d / 2) continue;
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
      // A helicopter's pilot works both side guns alone; with a gunner aboard each of them has one.
      const shared = s.heli && m.crewOf(p)?.seats.gunner;
      p.gunCd = g.interval * (shared ? 2 : 1);
      p.ammo--;
      p.mag = p.ammo;
      const side = shared ? 1 : s.heli ? (p.gunSide = -(p.gunSide ?? 1)) : Math.random() < 0.5 ? 1 : -1;
      const c = Math.cos(p.h), sn = Math.sin(p.h);
      const off = (s.gunX ?? s.size.width * 0.12) * side;
      // A player's guns follow where they look; an NPC's are fixed to the nose.
      const dir = k.gunDir ?? f;
      const pos = new Vector3(p.x + c * off + dir.x * 2, p.y + dir.y * 2 - 0.2, p.z - sn * off + dir.z * 2);
      const spread = g.spread * (p.ai ? Math.sqrt(m.skill.aim) * 0.6 : 1) * (1 + (1 - p.mods.guns) * 2);
      m.fire(p, { kind: g.kind, damage: g.damage, speed: g.speed + p.v, splash: g.kind === 'ac' ? 1 : 0, splashDamage: g.kind === 'ac' ? g.damage * 0.3 : 0, spread, life: 2.2, air: true }, pos, dir.clone());
    }
    if (k.bomb) this.dropBomb(p);
    if ((k.rocket || p.opRocket) && p.rocketCd <= 0 && p.rockets > 0 && !p.grounded) {
      p.rocketCd = s.rockets.cooldown ?? 0.28;
      // A helicopter hovers level: along the nose, its rockets could never hit the ground.
      const line = s.heli && k.gunDir ? k.gunDir : f;
      for (let i = s.rockets.pair ? 2 : 1; i > 0 && p.rockets > 0; i--) this.fireRocket(p, line);
    }
    this.rearGun(p);
    this.sixCheck(p);
  }

  fireRocket(p, f) {
    const s = p.spec, m = this.m, r = s.rockets;
    p.rockets--;
    // Dropped below the wings, close to the fuselage. Its line is set now, once: from where the motor
    // will light to a point on the nose line ahead, so both sides' rockets meet where the plane aimed.
    const off = (r.x ?? Math.min(ROCKET_OFFSET, s.size.width * 0.12)) * (p.rockets % 2 ? 1 : -1);
    _e.set(-p.gp, p.h, p.ty, 'YXZ');
    const pos = new Vector3(off, -(r.y ?? s.gearH * ROCKET_BELOW), 0).applyEuler(_e);
    pos.x += p.x;
    pos.y += p.y;
    pos.z += p.z;
    const fallV = ROCKET.gravity * ROCKET.drop;
    const lit = pos.clone().addScaledVector(f, p.v * ROCKET.drop);
    lit.y -= (fallV * ROCKET.drop) / 2 + (fallV * ROCKET.ramp) / 2;
    const dir = new Vector3(p.x + f.x * ROCKET_CONVERGE, p.y + f.y * ROCKET_CONVERGE, p.z + f.z * ROCKET_CONVERGE).sub(lit).normalize();
    m.fire(p, { kind: 'rocket', damage: r.damage, speed: r.speed + p.v, splash: r.splash, splashDamage: r.splashDamage, spread: r.spread * (p.ai ? m.skill.rocket : 1), life: 4 + ROCKET.drop, air: true, coast: ROCKET.drop, coastV: [f.x * p.v, f.y * p.v, f.z * p.v] }, pos, dir);
  }

  dropBomb(p) {
    const s = p.spec;
    if (!s.bombs || p.bombs <= 0 || p.bombCd > 0 || p.grounded) return;
    const b = s.bombs;
    p.bombCd = b.reload ?? (p.spec.id === 'mitchell' ? 0.3 : 0.6);
    const f = fwd(p.h, p.gp);
    const c = Math.cos(p.h), sn = Math.sin(p.h);
    // One bomb, or a salvo spread out across the bomb bays.
    for (const [side, along] of b.pattern ?? [[0, -0.5]]) {
      if (p.bombs <= 0) break;
      if (!b.infinite) p.bombs--;
      const pos = new Vector3(p.x + c * side + f.x * along, p.y - (b.drop ?? 1.4), p.z - sn * side + f.z * along);
      this.m.fire(p, { kind: 'bomb', damage: b.damage, speed: Math.max(15, p.v), splash: b.splash, splashDamage: b.splashDamage, spread: b.spread * (p.ai ? this.m.skill.aim * 0.5 : 1), life: 14 }, pos, f);
    }
  }

  // The side gun: the gunner's aim, or automatic at nearby enemy planes (solo, NPC, empty seat).
  // It turns freely on its mount and fires everywhere except up past its stop.
  rearGun(p) {
    const s = p.spec, m = this.m;
    if (!s.rear) return;
    const crew = m.crewOf(p);
    const manned = crew && crew.seats.gunner;
    // A gun that needs its gunner: with nobody there it just points ahead, for the pilot's trigger.
    if (!manned && s.rear.noAuto) {
      p.gunYaw = 0;
      p.gunPitch = 0;
      return;
    }
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
    if (_l.y > (s.rear.up ?? SIDE_GUN_MAX_UP) || _l.y < (s.rear.down ?? -1)) return;
    p.rearCd = s.rear.interval;
    p.rearAmmo--;
    p.coaxBelt = p.rearAmmo;
    const pos = new Vector3(...s.door).applyEuler(_e);
    pos.x += p.x;
    pos.y += p.y;
    pos.z += p.z;
    m.fire(p, { kind: s.rear.kind ?? 'mg', damage: s.rear.damage, speed: s.rear.speed, splash: s.rear.splash ?? 0, splashDamage: s.rear.splashDamage ?? 0, spread, life: 2.2, air: true }, pos.addScaledVector(dir, 1.2), dir.clone());
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
    const hb = p.spec.hitBox;
    const fus = hb ? box([-hb.hull[0], -hb.hull[1], -s.length / 2], [hb.hull[0], hb.hull[1], s.length / 2]) : box([-1, -1.1, -s.length / 2], [1, 1.1, s.length / 2]);
    const wing = hb ? box([-s.width / 2, hb.wingY - hb.wing[2], hb.wing[0]], [s.width / 2, hb.wingY + hb.wing[2], hb.wing[1]]) : box([-s.width / 2, -0.7, -1.2], [s.width / 2, 0.7, 1.8]);
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
    const after = Math.max(0, before - dmg / (p.spec.hp * (p.spec.zoneK ?? 0.4)));
    p.mods[zone] = after;
    const crossed = (l) => before >= l && after < l;
    if (crossed(0.5) || after === 0) m.events.push({ k: 'mod', u: p.id, m: zone, state: after === 0 ? 'destroyed' : 'damaged' });
    if (zone === 'fuel' && after < 0.5 && Math.random() < 0.35) p.burning = 12;
    if (zone.startsWith('engine') && after < 0.3 && Math.random() < 0.5) p.burning = 10;
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
          // A shell bursting anywhere near a very wide plane still hits some of it.
          const d = Math.max(0, Math.hypot(p.x - b.x, p.y - b.y, p.z - b.z) - (p.spec.hitBox ? p.radius * 0.5 : 0));
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

  // Bursts beside every enemy aircraft close to this shell's path. Direct hits are dealt with before this.
  flakFuse(p, x0, y0, z0, dx, dy, dz) {
    const len2 = dx * dx + dy * dy + dz * dz;
    let burst = false;
    for (const u of this.planes) {
      if (u.dead || u.grounded || u.team === p.team) continue;
      const ax = u.x - x0, ay = u.y - y0, az = u.z - z0;
      const t = clamp((ax * dx + ay * dy + az * dz) / len2, 0, 1);
      const d = Math.max(0, Math.hypot(ax - dx * t, ay - dy * t, az - dz * t) - (u.spec.hitBox ? u.radius * 0.35 : 0));
      if (d >= p.fuse) continue;
      burst = true;
      const dmg = p.damage * (p.airMul ?? 1) * u.spec.armor.side * (1 - d / p.fuse);
      u.lastHitBy = p.owner;
      this.damageZone(u, zoneAt(u, rand(-1, 1) * u.spec.size.width * 0.4, rand(-1, 1) * u.spec.size.length * 0.4), dmg * 0.5);
      this.m.damage(u, dmg, { owner: p.owner });
    }
    if (!burst) return false;
    const x = r2(x0 + dx), y = r2(y0 + dy), z = r2(z0 + dz);
    this.m.events.push({ k: 'i', id: p.id, o: p.owner, kind: p.kind, x, y, z, r: 'armor' });
    // A turret fires too fast for every shell to get a puff of smoke.
    if (p.turret == null || Math.random() < 0.4) this.m.events.push({ k: 'flak', x, y, z });
    return true;
  }

  // ---------- Anti-air turrets ----------
  aaTick() {
    const a = AA_TURRETS, m = this.m;
    const wanted = [];
    for (const p of this.planes) {
      if (p.dead) {
        p.aaClock = p.aaAway = p.aaWarn = 0;
        continue;
      }
      const inside = p.team === 'blue' ? p.z > 0 : p.z < 0;
      if (inside) {
        p.aaAway = 0;
        p.aaClock += DT;
      } else if (p.aaClock > 0) {
        // Out for less than `forget` seconds in one go counts as never having left.
        p.aaAway += DT;
        p.aaClock += DT;
        if (p.aaAway >= a.forget) p.aaClock = p.aaAway = 0;
      }
      p.aaWarn = !inside ? 0 : p.aaClock >= a.after ? -1 : p.aaClock >= a.after - a.warn ? a.after - p.aaClock : 0;
      if (inside && p.aaClock >= a.after) wanted.push(p);
    }
    if (!wanted.length) return;
    for (const g of this.aaGuns) {
      g.cd -= DT;
      if (g.cd > 0) continue;
      let best = null, bd = a.range;
      for (const p of wanted) {
        if (p.team === g.p.team) continue;
        const d = g.at.distanceTo(_l.set(p.x, p.y, p.z));
        if (d < bd) {
          bd = d;
          best = p;
        }
      }
      if (!best) continue;
      g.cd = a.interval;
      // Where it'll be when the shell gets there, and high enough to allow for the shell's drop.
      const vel = best.hv ?? fwd(best.h, best.gp, _f).multiplyScalar(best.v);
      const t = bd / a.shell.speed;
      const dir = new Vector3(best.x + vel.x * t - g.at.x, best.y + vel.y * t - g.at.y + 0.5 * G * t * t, best.z + vel.z * t - g.at.z).normalize();
      m.fire({ id: -1, team: g.p.team }, { ...a.shell, life: Math.min(4, t + 0.6), turret: g.i }, g.at.clone().addScaledVector(dir, 3.2), dir);
    }
  }

  // ---------- NPC air force ----------
  updateSpawns() {
    const m = this.m;
    if (m.tickNo % TICK_RATE === 0) this.updateEscorts();
    this.nextElite -= DT;
    if (this.nextElite <= 0) {
      this.nextElite = NPC_PLANES.eliteEvery;
      this.queueElites();
    }
    this.elitesDue = this.elitesDue.filter((e) => !this.spawnElite(e));
    for (const team of ['blue', 'red']) {
      if (m.mode === 'fortress') continue;
      this.nextNpc[team] -= DT;
      if (this.nextNpc[team] > 0) continue;
      this.nextNpc[team] = NPC_PLANES.every;
      if (this.sideFull(team)) continue;
      if (this.spawnNpc(team, this.nextRole[team])) this.nextRole[team] = this.nextRole[team] === 'fighter' ? 'attack' : 'fighter';
      else this.nextNpc[team] = SPAWN_RETRY;
    }
  }

  // A flying Leviathan keeps its escorts up: they join once it's airborne, and get replaced if shot down.
  updateEscorts() {
    for (const l of this.m.units) {
      if (l.kind !== 'plane' || !l.spec.escorts || l.dead || l.grounded) continue;
      l.escortUnits ??= [];
      l.escortWait ??= [];
      for (let i = 0; i < l.spec.escorts; i++) {
        const e = l.escortUnits[i];
        if (e && !e.dead) continue;
        if (e) {
          l.escortUnits[i] = null;
          l.escortWait[i] = this.m.time + ESCORT_REPLACE;
        }
        if (this.m.time >= (l.escortWait[i] ?? 0)) l.escortUnits[i] = this.spawnEscort(l, i);
      }
    }
  }

  escortSlot(l, slot, out = new Vector3()) {
    const [side, up, ahead] = ESCORT_SLOTS[slot];
    const c = Math.cos(l.h), sn = Math.sin(l.h);
    return out.set(l.x + c * side + sn * ahead, l.y + up, l.z - sn * side + c * ahead);
  }

  // Takes off like everyone else, then catches up. Null while there's no free hangar.
  spawnEscort(l, slot) {
    const p = this.spawnNpc(l.team, 'fighter', 'escort');
    if (!p) return null;
    p.elite = true;
    p.escortOf = l;
    p.escortSlot = slot;
    return p;
  }

  // Holds its place by the Leviathan. False hands it over to the normal pilot: to fight, or because
  // its Leviathan is gone or on the ground.
  flyEscort(p) {
    const l = p.escortOf, ai = p.ai, s = p.spec;
    if (l.dead || l.grounded) return false;
    if (ai.target && !ai.target.dead && Math.hypot(ai.target.x - l.x, ai.target.z - l.z) < ESCORT_LEASH) return false;
    ai.target = null;
    if (this.m.tickNo % 10 === p.id % 10) {
      let best = null, bd = ESCORT_GUARD;
      for (const o of this.planes) {
        if (o.dead || o.grounded || o.team === p.team) continue;
        const d = Math.hypot(o.x - l.x, o.y - l.y, o.z - l.z);
        if (d < bd) {
          bd = d;
          best = o;
        }
      }
      if (best) {
        ai.target = best;
        ai.runT = RUN_TIME[0];
        return false;
      }
    }
    const place = this.escortSlot(l, p.escortSlot);
    const dx = place.x - p.x, dz = place.z - p.z;
    const lf = fwd(l.h, 0);
    // Aim at a point ahead of its place, so it settles alongside instead of weaving on to it.
    const lookX = dx + lf.x * 40, lookZ = dz + lf.z * 40;
    const alt = p.y - Math.max(groundAt(p.x, p.z), WATER_LEVEL);
    const k = p.ctl;
    k.gunDir = null;
    k.th = 0;
    k.fire = k.bomb = k.rocket = false;
    k.aim = { yaw: Math.atan2(lookX, lookZ), pitch: alt < 45 ? 0.5 : clamp(Math.atan2(place.y - p.y, Math.hypot(lookX, lookZ)) * 1.5, -0.45, 0.45) };
    // Throttle for the speed that closes the gap: the thrust that balances drag at that speed.
    const behind = dx * lf.x + dz * lf.z;
    const want = clamp(l.v + behind * 0.25, s.minSpeed * 1.15, s.maxSpeed);
    p.throttle = clamp(s.drag * (want / s.maxSpeed) ** 2 + (want - p.v) * 0.2, 0.05, 1);
    return true;
  }

  // Every team facing players sends one, on top of its usual planes. One Leviathan per team at a time.
  queueElites() {
    const m = this.m;
    const humans = new Set([...m.crews.values()].map((c) => c.team));
    for (const team of ['blue', 'red']) {
      if (!humans.has(team === 'blue' ? 'red' : 'blue') || this.elitesDue.some((e) => e.team === team)) continue;
      const hasLeviathan = m.units.some((u) => u.type === 'leviathan' && u.team === team && !u.dead);
      this.elitesDue.push({ team, type: !hasLeviathan && Math.random() < 0.5 ? 'leviathan' : 'f16' });
    }
  }

  // True once it's on its way.
  spawnElite({ team, type }) {
    const p = this.spawnNpc(team, type === 'f16' ? 'fighter' : 'attack', type);
    if (!p) return false;
    p.elite = true;
    this.m.events.push({ k: 'elite', team, type });
    return true;
  }

  // A player crew's plane holds its slot even while it waits to respawn.
  sideFull(team) {
    return this.m.units.filter((u) => u.kind === 'plane' && u.team === team && !u.elite && (u.player || !u.dead)).length >= MAX_SIDE_PLANES;
  }

  spawnNpc(team, role, forced = null) {
    const list = NPC_PLANES[team][role];
    const type = forced ?? list[Math.floor(Math.random() * list.length)];
    const ai = { role, think: rand(0, 0.5), target: null, climbT: 0, reactTo: null, reactT: 0, ground: null, pass: rand(0.8, 1.2) };
    let p;
    if (this.airStart) {
      const b = BASES[team];
      const s = team === 'blue' ? -1 : 1;
      p = new Plane(team, type, b.x + rand(-300, 300), rand(150, 230), b.z + s * 80, b.heading, PLANES[type].maxSpeed * 0.75);
    } else {
      const hangar = this.freeHangar(team, type);
      if (!hangar) return null;
      const size = PLANES[type].size;
      const out = Math.sign(AIRFIELDS[team].z - hangar.z); // the way its door faces
      const z = hangar.z + out * (hangar.d / 2 - size.length / 2 - 1.5);
      p = new Plane(team, type, hangar.x, groundAt(hangar.x, z) + PLANES[type].gearH, z, out < 0 ? Math.PI : 0, 0, { grounded: true });
      ai.taxi = { phase: 'out', t: 0, out, door: hangar.z + out * (hangar.d / 2) };
    }
    p.ai = ai;
    this.m.units.push(p);
    this.m.npcJoin(p);
    return p;
  }

  // A hangar this plane fits and nothing's parked in. The NPCs' own come first.
  freeHangar(team, type) {
    const big = PLANES[type].size.width > HANGAR_DOOR;
    const hangars = PROPS.filter((h) => h.type === 'hangar' && h.team === team && !!h.big === big).sort((a, b) => !!b.npc - !!a.npc);
    return hangars.find((h) => !this.m.units.some((u) => u.kind === 'plane' && !u.dead && u.grounded && Math.abs(u.x - h.x) < h.w / 2 && Math.abs(u.z - h.z) < h.d / 2)) ?? null;
  }

  // Out of the hangar, on to the centre line, along the runway and up, the way a player has to.
  taxi(p) {
    const ai = p.ai, t = ai.taxi, s = p.spec, k = p.ctl, f = AIRFIELDS[p.team];
    t.t += DT;
    if (t.t > NPC_STUCK && p.grounded) return this.m.damage(p, 1e7, { owner: -1 });
    k.th = k.pitch = k.roll = k.yaw = 0;
    k.fire = k.bomb = k.rocket = false;
    k.gunDir = null;
    k.aim = null;
    if (!p.grounded) {
      // Off the ground: straight ahead and up, until there's room to turn. No easing into the climb:
      // the ground can rise right past the end of the runway.
      k.aim = { yaw: f.heading, pitch: NPC_CLIMB.pitch };
      p.climbOut = null;
      p.throttle = 1;
      if (p.y - Math.max(groundAt(p.x, p.z), WATER_LEVEL) > NPC_CLIMB.height) ai.taxi = null;
      return;
    }
    const line = wrapAngle(Math.atan2(f.dir * (s.size.length / 2 + 20), f.z - p.z) - p.h);
    if (t.phase === 'out') {
      if ((p.z - t.door) * t.out > s.size.length * 0.3) t.phase = 'turn';
    } else {
      k.yaw = clamp(line * 2.5, -1, 1);
      if (t.phase === 'turn' && Math.abs(line) < 0.15 && Math.abs(p.z - f.z) < 5) t.phase = 'roll';
    }
    if (t.phase === 'roll') {
      p.throttle = 1;
      if (p.v > s.maxSpeed * (s.takeoff ?? TAKEOFF_SPEED) * 1.03) k.pitch = 1;
    } else p.throttle = p.v < NPC_TAXI_SPEED ? 1 : 0.12;
  }

  npc(p) {
    if (p.ai.taxi) return this.taxi(p);
    if (p.escortOf && this.flyEscort(p)) return;
    const m = this.m, ai = p.ai, s = p.spec;
    const fortress = m.mode === 'fortress';
    ai.think -= DT;
    ai.restT = (ai.restT ?? 0) - DT;
    // Too slow to dive: a Leviathan holds its height and rolls over whatever it's bombing.
    const heavy = !!s.noPlaneRespawn;
    if (p.elite) {
      p.fuel = 1; // it's here until someone shoots it down
      if (s.bombs && p.bombs < s.bombs.count && (ai.rearm = (ai.rearm ?? 0) - DT) <= 0) {
        ai.rearm = ELITE_REARM;
        p.bombs = Math.min(s.bombs.count, p.bombs + (s.bombs.salvo ?? 1));
      }
    }
    // One pass, then away across the map: a plane doesn't circle over the same target.
    if (ai.target) {
      ai.runT -= DT;
      if (ai.runT <= 0 && !fortress) this.endRun(p);
    }
    if (ai.think <= 0) {
      ai.think = rand(0.5, 0.9);
      if (ai.target?.dead || (ai.target && !m.units.includes(ai.target))) ai.target = null;
      if (!ai.target && ai.restT <= 0) {
        ai.target = this.pickTarget(p);
        ai.runT = rand(RUN_TIME[0], RUN_TIME[1]) * (heavy ? HEAVY_RUN : 1);
      }
      if (heavy) ai.bombNow = this.overEnemyArmour(p);
    }
    const k = p.ctl;
    k.gunDir = null;
    k.th = p.throttle < 0.95 ? 1 : 0;
    // A jet burns across the map, and comes off the afterburner to fight.
    if (p.elite && s.afterburner) k.th = !ai.target || Math.hypot(ai.target.x - p.x, ai.target.z - p.z) > 420 ? 1 : p.throttle > 0.55 ? -1 : 0;
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
        if (heavy) {
          aimPitch = clamp((HEAVY_ALT - alt) * 0.004, -0.12, 0.2);
        } else if (hd > 320) aimPitch = clamp((130 - alt) * 0.006, -0.3, 0.4);
        else if (s.bombs && p.bombs > 0) {
          aimPitch = Math.max(aimPitch, -0.5);
          // Release where the bomb's fall carries it onto the target.
          const fall = Math.sqrt((2 * Math.max(5, alt)) / G);
          if (Math.abs(hd - p.v * Math.cos(p.gp) * fall) < 14 && align > 0.5 && !reacting) k.bomb = true;
        }
        if (hd < 90) {
          if (!heavy) ai.climbT = 3.5; // break off
          if (!fortress) this.endRun(p);
        }
      }
      if (!reacting && align > 0.992 - 0.003 * m.skill.aim && d < 340) {
        k.fire = true;
        if (t.kind === 'tank' && p.rockets > 0 && d < 260) k.rocket = true;
      }
      // A jet is past its target in seconds, so its cannon swings on as soon as it's roughly lined up.
      if (p.elite && s.afterburner && !reacting && align > 0.9 && d < 420) {
        k.fire = true;
        k.gunDir = new Vector3(lx, ly, lz).normalize();
      }
    } else {
      // Patrol towards the middle of the map.
      const g = this.patrolPoint(p);
      aimYaw = Math.atan2(g.x - p.x, g.z - p.z);
      aimPitch = heavy ? clamp((HEAVY_ALT - alt) * 0.004, -0.12, 0.2) : clamp((170 - alt) * 0.008, -0.2, 0.35);
    }
    if (ai.climbT > 0) {
      ai.climbT -= DT;
      aimPitch = 0.45;
    }
    if (s.afterburner) aimPitch = Math.max(aimPitch, -0.4); // too fast to pull out of anything steeper
    if (heavy && ai.bombNow) k.bomb = true;
    // Never mind the target when the ground is coming up.
    const f = fwd(p.h, p.gp, _f);
    // How far ahead it has to look depends on how long it takes this plane to get out of the way.
    const look = s.afterburner ? p.v * 2.4 : heavy ? 240 : 80;
    const ahead = Math.max(groundAt(p.x + f.x * look, p.z + f.z * look), WATER_LEVEL);
    if (alt < (s.afterburner ? p.v * 0.9 : heavy ? 90 : 48) || p.y + f.y * (look + 10) < ahead + (heavy ? 60 : 34)) {
      // Wings level and pull: a banked plane can't climb out.
      aimPitch = Math.max(aimPitch, 0.5);
      aimYaw = p.h;
    }
    if (p.y > FLIGHT.maxAlt - 60) aimPitch = Math.min(aimPitch, -0.1);
    const edge = Math.max(Math.abs(p.x), Math.abs(p.z));
    if (edge > 950) aimYaw = Math.atan2(-p.x, -p.z);
    k.aim = { yaw: aimYaw, pitch: aimPitch };
    p.throttle = Math.max(p.throttle, p.elite && s.afterburner ? 0.5 : 0.8);
  }

  // Would a salvo released now come down on enemy armour? A bomber carpets whatever it crosses.
  overEnemyArmour(p) {
    const alt = p.y - Math.max(groundAt(p.x, p.z), WATER_LEVEL);
    const carry = p.v * Math.cos(p.gp) * Math.sqrt((2 * Math.max(5, alt)) / G);
    const ix = p.x + Math.sin(p.h) * carry, iz = p.z + Math.cos(p.h) * carry;
    return this.m.units.some((u) => !u.dead && u.team !== p.team && (u.kind === 'tank' || u.kind === 'atgun') && Math.hypot(u.x - ix, u.z - iz) < BOMB_REACH);
  }

  endRun(p) {
    p.ai.target = null;
    p.ai.restT = rand(REST_TIME[0], REST_TIME[1]);
    p.ai.wp = null;
  }

  // Fortress raiders stay over the fortress; otherwise a string of points all over the map,
  // each a long way from the last.
  patrolPoint(p) {
    if (this.m.mode === 'fortress') return { x: FORT.center.x, z: FORT.center.z };
    const ai = p.ai;
    if (ai.wp && Math.hypot(ai.wp.x - p.x, ai.wp.z - p.z) > 160) return ai.wp;
    for (let k = 0; k < 8; k++) {
      ai.wp = { x: rand(-PATROL, PATROL), z: rand(-PATROL, PATROL) };
      if (Math.hypot(ai.wp.x - p.x, ai.wp.z - p.z) > 500) break;
    }
    return ai.wp;
  }

  pickTarget(p) {
    const m = this.m, ai = p.ai;
    let best = null, bs = Infinity;
    for (const e of m.units) {
      if (e.dead || e.team === p.team) continue;
      const d = Math.hypot(e.x - p.x, e.z - p.z);
      if (d > TARGET_RANGE) continue;
      if (!m.army.inView(p, e, d)) continue;
      let score = d;
      if (e.kind === 'plane') {
        if (e.grounded) score += 900;
        else if (ai.role === 'fighter') score *= 0.35;
        else score += 300;
      } else if (e.kind === 'tank') score *= ai.role === 'attack' ? 0.5 : 1.2;
      else if (e.kind === 'inf') score += ai.role === 'attack' ? 250 : 600;
      else score += 200;
      score += m.army.crowding(p, e);
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
