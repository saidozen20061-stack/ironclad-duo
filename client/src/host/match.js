import { Vector3 } from 'three';
import { DIFFICULTY, TANKS, TANK_IDS, UNITS, TICK_RATE, PING, MATCH, TYPE_IDS, FOOT } from '../../../shared/constants.js';
import { footBlocked, nearGarage } from '../../../shared/foot.js';
import { WarDirector } from './war.js';
import { PlaneSystem } from './planes.js';
import { PLANES, rocketStep } from '../../../shared/planes.js';
import { ArmyAI } from './ai.js';
import { BASES, POINTS, PLAY_LIMIT, HALF, groundAt, heightAt, waterDepthAt, crossesBridgeRail, WATER_LEVEL } from '../../../shared/map.js';
import { tankPose, muzzlePose, planePitchAlong, wrapAngle } from '../../../shared/tank.js';
import { PROPS, PROP_TYPES, propsNear, circleHitsProp, segmentHitsProp, setFortress } from '../../../shared/props.js';
import { buildNav } from './nav.js';
import { installMode } from './modes.js';

const DT = 1 / TICK_RATE;
const GRAVITY = 9.81;
export const TEAM_CODE = { blue: 0, red: 1 };
export const TYPE_CODE = Object.fromEntries(TYPE_IDS.map((t, i) => [t, i]));

const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const NO_RESPAWN = 1e7;

let nextId = 1;

class Tank {
  constructor(team, type, x, z, h, { player = false } = {}) {
    this.id = nextId++;
    this.kind = 'tank';
    this.team = team;
    this.type = type;
    this.spec = TANKS[type];
    this.player = player;
    this.crewId = null;
    this.x = x;
    this.z = z;
    this.h = h;
    this.v = 0;
    this.ty = 0;
    this.gp = 0;
    this.hp = this.spec.hp;
    this.dead = false;
    this.respawnAt = 0;
    this.spawn = { x, z, h };
    this.pose = tankPose(this.spec, x, z, h);
    this.radius = Math.hypot(this.spec.size.length, this.spec.size.width) / 2;
    this.drive = { th: 0, st: 0, boost: false, brake: false };
    this.aim = { yaw: h, pitch: 0 };
    this.trigger = { main: false, coax: false };
    this.boost = 1;
    const w = this.spec.weapon;
    this.reload = 0;
    this.reloadTotal = w.reload;
    this.fireCd = 0;
    this.mag = w.magazine ?? 1;
    this.shell = 'AP';
    this.coaxBelt = w.coax?.belt ?? 0;
    this.coaxReload = 0;
    this.coaxCd = 0;
    this.fireQueued = false;
    this.mods = { tracks: 1, engine: 1, turret: 1, gun: 1, radar: 1 };
    this.burning = 0;
    this.repair = null;
  }

  respawn() {
    Object.assign(this, { x: this.spawn.x, z: this.spawn.z, h: this.spawn.h, v: 0, ty: 0, gp: 0 });
    this.mods = { tracks: 1, engine: 1, turret: 1, gun: 1, radar: 1 };
    this.burning = 0;
    this.repair = null;
    this.hp = this.spec.hp;
    this.dead = false;
    this.reload = 0;
    this.mag = this.spec.weapon.magazine ?? 1;
    this.aim.yaw = this.h;
    this.aim.pitch = 0;
    this.boost = 1;
    this.fireQueued = false;
    this.fireCd = 0;
    this.trigger = { main: false, coax: false };
    this.drive = { th: 0, st: 0, boost: false, brake: false };
    this.coaxBelt = this.spec.weapon.coax?.belt ?? 0;
    this.coaxReload = 0;
    this.coaxCd = 0;
    tankPose(this.spec, this.x, this.z, this.h, this.pose);
  }
}

class CrewSoldier {
  constructor(role, x, z, h, crew) {
    this.id = nextId++;
    this.kind = 'inf';
    this.crew = role;
    this.crewId = crew.id;
    this.team = crew.team;
    this.type = 'crew';
    this.spec = { ...UNITS.crew, size: { ...UNITS.crew.size } };
    this.x = x;
    this.z = z;
    this.h = h;
    this.ty = 0;
    this.gp = 0;
    this.jy = 0;
    this.hp = this.spec.hp;
    this.dead = false;
    this.radius = 0.5;
    this.pose = { y: groundAt(x, z) };
    this.input = { fire: false, ads: false, moving: false };
    this.mag = FOOT.rifle.mag;
    this.reserve = FOOT.rifle.reserve;
    this.reloading = 0;
    this.cd = 0;
    this.grenades = FOOT.grenades;
    this.grenadeCd = 0;
  }
}

class Crew {
  constructor(info, tank) {
    this.id = info.id;
    this.team = info.team;
    this.tankType = info.tank;
    this.tank = tank;
    this.noPlanes = false;
    this.seats = { driver: true, gunner: true };
    this.bail = { mode: 'tank', until: 0, picks: {}, foot: {} };
    this.ping = null;
    this.pingReadyAt = 0;
    this.stats = { kills: 0, deaths: 0, caps: 0 };
  }
}

export class Match {
  constructor(room) {
    this.room = room;
    this.mode = room.mode ?? 'flags';
    this.killLimit = room.killLimit ?? 20;
    this.skill = DIFFICULTY[room.difficulty] ?? DIFFICULTY.easy;
    this.smokeZones = [];
    this.time = 0;
    this.tickNo = 0;
    this.units = [];
    this.projectiles = [];
    this.events = [];
    this.over = false;
    this.propHp = new Map();
    this.propDead = new Set();
    this.propsDirty = true;
    this.tickets = { blue: MATCH.tickets, red: MATCH.tickets };
    this.score = { blue: 0, red: 0 };
    this.bleedT = MATCH.bleedInterval;
    this.points = POINTS.map((p) => ({ id: p.id, owner: null, progress: 0, contested: false }));

    setFortress(this.mode === 'fortress');
    if (this.mode === 'fortress') buildNav();

    this.planes = new PlaneSystem(this);
    this.crews = new Map();
    const infos = room.crews ?? [{ id: 0, team: 'blue', tank: room.tank ?? 'medium' }];
    for (const team of ['blue', 'red']) {
      const mine = infos.filter((c) => c.team === team);
      let planeSlot = 0;
      const b = BASES[team];
      const fwd = team === 'blue' ? 1 : -1;
      mine.forEach((info, k) => {
        const x = b.x + (k - (mine.length - 1) / 2) * 16;
        const t = this.addTank(PLANES[info.tank] ? this.planes.createPlayerPlane(team, info.tank, planeSlot++) : new Tank(team, info.tank, x, b.z + 45 * fwd, b.heading, { player: true }));
        t.crewId = info.id;
        this.crews.set(info.id, new Crew(info, t));
      });
    }
    this.army = new ArmyAI(this);
    this.war = new WarDirector(this);
    installMode(this);

    this.interval = setInterval(() => this.tick(), 1000 / TICK_RATE);
  }

  playerTanks(team) {
    let n = 0;
    for (const c of this.crews.values()) if (c.team === team) n++;
    return n;
  }

  crewOf(u) {
    return u?.crewId != null ? this.crews.get(u.crewId) : null;
  }

  addTank(t) {
    this.units.push(t);
    return t;
  }

  createTank(team, type, x, z, h) {
    return new Tank(team, type, x, z, h);
  }

  dispose() {
    clearInterval(this.interval);
  }

  playerLeft(crewId, role) {
    const c = this.crews.get(crewId);
    if (!c || !role) return;
    c.seats[role] = false;
    const t = c.tank;
    if (role === 'driver') t.drive = { th: 0, st: 0, boost: false, brake: true };
    else t.trigger = { main: false, coax: false };
    const s = c.bail.foot[role];
    if (s) s.input = { fire: false, ads: false, moving: false };
    c.bail.picks[role] ??= 'tank';
  }

  playerJoined(crewId, role) {
    const c = this.crews.get(crewId);
    if (!c || !role) return;
    c.seats[role] = true;
    const b = c.bail;
    delete b.picks[role];
    if (b.mode !== 'foot' || b.foot[role]) return;
    const mate = Object.values(b.foot).find((s) => !s.dead);
    if (!mate) return this.endFoot(c);
    const s = new CrewSoldier(role, mate.x + 1.5, mate.z, mate.h, c);
    b.foot[role] = s;
    this.units.push(s);
  }

  swapSeat(crewId, from, to) {
    const c = this.crews.get(crewId);
    if (!c || !from || !to) return;
    c.seats[from] = false;
    c.seats[to] = true;
    const b = c.bail;
    if (b.picks[from]) b.picks[to] = b.picks[from];
    delete b.picks[from];
    if (b.foot[from]) {
      b.foot[to] = b.foot[from];
      b.foot[to].crew = to;
      delete b.foot[from];
    }
    if (from === 'driver') c.tank.drive = c.tank.kind === 'plane' ? {} : { th: 0, st: 0, boost: false, brake: true };
    else if (c.tank.kind !== 'plane') c.tank.trigger = { main: false, coax: false };
  }

  setPing(c, x, z) {
    if (this.time < c.pingReadyAt) return;
    x = Math.max(-HALF, Math.min(HALF, x));
    z = Math.max(-HALF, Math.min(HALF, z));
    c.ping = { x, z, t0: this.time, id: (c.ping?.id ?? 0) + 1 };
    c.pingReadyAt = this.time + PING.cooldown;
  }

  onMessage(player, msg) {
    const c = this.crews.get(player.crew);
    if (!c) return;
    const t = c.tank;
    if (msg.t === 'bail') return this.onBailPick(c, player.role, msg.pick);
    if (msg.t === 'bailSkip') return this.onBailSkip(c, player.role);
    if (msg.t === 'respawnSkip') {
      if (this.crews.size === 1 && !c.seats.gunner && t.dead && c.bail.mode === 'tank') t.respawnAt = this.time;
      return;
    }
    if (import.meta.env?.DEV && msg.t === 'debugKill') return this.damage(t, 1e6, { owner: 0 });
    if (import.meta.env?.DEV && msg.t === 'debugElite') return this.planes.spawnElites();
    if (import.meta.env?.DEV && msg.t === 'debugAa') return void (t.aaClock = msg.clock);
    if (import.meta.env?.DEV && msg.t === 'debugEnd') return this.endMatch(msg.winner, 'Test');
    if (import.meta.env?.DEV && msg.t === 'debugWave' && this.fort) {
      if (this.fort.phase === 'break') this.fort.until = this.time;
      else for (const u of this.fort.alive) this.damage(u, 1e6, { owner: 0 });
      return;
    }
    if (c.bail.mode === 'foot') return this.onFootMessage(c, player.role, msg);
    if (t.kind === 'plane') return this.planes.onMessage(c, player.role, msg, t);
    if (player.role === 'driver' && msg.t === 'drive') {
      t.drive.th = Math.max(-1, Math.min(1, Number(msg.th) || 0));
      t.drive.st = Math.max(-1, Math.min(1, Number(msg.st) || 0));
      t.drive.boost = !!msg.boost;
      t.drive.brake = !!msg.brake;
      t.drive.repair = !!msg.repair;
    } else if (player.role === 'gunner') {
      if (msg.t === 'aim') {
        if (Number.isFinite(msg.yaw)) t.aim.yaw = wrapAngle(msg.yaw);
        if (Number.isFinite(msg.pitch)) t.aim.pitch = Math.max(-0.5, Math.min(1.25, msg.pitch));
      } else if (msg.t === 'trigger') {
        t.trigger.main = !!msg.main;
        t.trigger.coax = !!msg.coax;
        if (msg.main && !t.dead) t.fireQueued = true;
      } else if (msg.t === 'ping' && Number.isFinite(msg.x) && Number.isFinite(msg.z)) {
        this.setPing(c, msg.x, msg.z);
      } else if (msg.t === 'shell' && (msg.shell === 'AP' || msg.shell === 'HE') && t.spec.weapon.shells) {
        if (t.shell !== msg.shell) {
          t.shell = msg.shell;
          t.reload = Math.max(t.reload, t.reloadTotal * 0.5);
        }
      }
    }
  }

  tick() {
    if (this.over) return this.broadcast();
    this.time += DT;
    this.tickNo++;
    for (const c of this.crews.values()) this.tickCrew(c);
    this.army.update(DT);
    this.planes.updateSpawns();
    this.planes.tick();
    this.modeTick?.();
    this.war.tick();
    this.units = this.units.filter((u) => u.player || !u.dead || this.time - u.diedAt < 30);
    this.updateProjectiles();
    this.updateCapture();
    this.updateTickets();
    this.broadcast();
  }

  tickCrew(c) {
    const t = c.tank;
    if (t.dead) {
      const b = c.bail;
      if (b.mode === 'choice') {
        if ((b.picks.driver && b.picks.gunner) || this.time >= b.until) this.resolveBail(c);
      } else if (b.mode === 'foot') this.updateFoot(c);
      else if (this.time >= t.respawnAt) {
        const next = c.noPlanes && t.kind === 'plane' ? this.assignRandomTank(c) : t;
        if (next === t) t.respawn();
        if (next.kind === 'tank') this.clearSpawn(next);
        this.events.push({ k: 'spawn', u: next.id });
      }
    } else if (t.kind !== 'plane') {
      this.driveTank(t);
      this.aimTurret(t);
      this.updateWeapons(t);
      this.modeCrewTick?.(c);
    }
    if (c.ping) {
      const near = c.bail.mode === 'foot' ? Object.values(c.bail.foot).filter((s) => !s.dead) : [t];
      const reached = near.some((u) => Math.hypot(u.x - c.ping.x, u.z - c.ping.z) < PING.reachRadius);
      if (reached || this.time - c.ping.t0 > PING.lifetime) c.ping = null;
    }
  }

  assignRandomTank(c) {
    const b = BASES[c.team];
    const type = TANK_IDS[Math.floor(Math.random() * TANK_IDS.length)];
    const t = this.addTank(new Tank(c.team, type, b.x, b.z + 45 * (c.team === 'blue' ? 1 : -1), b.heading, { player: true }));
    t.crewId = c.id;
    this.units = this.units.filter((u) => u !== c.tank);
    c.tank = t;
    c.tankType = type;
    return t;
  }

  clearSpawn(t) {
    const { x, z } = t.spawn;
    for (const r of [0, 12, 24, 36]) {
      for (let k = 0; k < (r ? 8 : 1); k++) {
        const a = (k * Math.PI) / 4;
        const nx = x + Math.cos(a) * r, nz = z + Math.sin(a) * r;
        if (this.spawnBlocked(t, nx, nz)) continue;
        t.x = nx;
        t.z = nz;
        tankPose(t.spec, nx, nz, t.h, t.pose);
        return;
      }
    }
  }

  spawnBlocked(t, x, z) {
    if (Math.abs(x) > PLAY_LIMIT || Math.abs(z) > PLAY_LIMIT || waterDepthAt(x, z) > 0.3) return true;
    for (const u of this.units) {
      if (u === t || u.dead || u.kind === 'inf' || (u.kind === 'plane' && !u.grounded)) continue;
      if (Math.hypot(u.x - x, u.z - z) < (u.radius + t.radius) * 0.85) return true;
    }
    for (const p of propsNear(x, z, t.radius + 2)) {
      if (p.solid && !this.propDead.has(p.id) && circleHitsProp(p, x, z, t.radius * 0.8)) return true;
    }
    return false;
  }

  onBailPick(c, role, pick) {
    if (c.bail.mode !== 'choice' || (pick !== 'tank' && pick !== 'foot')) return;
    c.bail.picks[role] = pick;
  }

  onBailSkip(c, role) {
    const b = c.bail;
    if (b.mode !== 'choice') return;
    (b.skip ??= {})[role] = true;
    if (['driver', 'gunner'].every((r) => b.skip[r] || !c.seats[r])) b.until = this.time;
  }

  resolveBail(c) {
    const b = c.bail;
    if ((b.picks[c.seats.driver ? 'driver' : 'gunner'] ?? 'tank') === 'foot') {
      const t = c.tank;
      const lx = Math.cos(t.h), lz = -Math.sin(t.h);
      const off = t.spec.size.width / 2 + 1.6;
      b.foot = {};
      for (const [role, side] of [['driver', 1], ['gunner', -1]]) {
        if (!c.seats[role]) continue;
        let x = t.x + lx * off * side, z = t.z + lz * off * side;
        for (let k = 0; k < 8 && footBlocked(x, z, this.propDead); k++) {
          x = t.x + Math.cos(k) * (off + 2);
          z = t.z + Math.sin(k) * (off + 2);
        }
        x = Math.max(-PLAY_LIMIT + 5, Math.min(PLAY_LIMIT - 5, x));
        z = Math.max(-PLAY_LIMIT + 5, Math.min(PLAY_LIMIT - 5, z));
        const s = new CrewSoldier(role, x, z, t.h, c);
        b.foot[role] = s;
        this.units.push(s);
      }
      t.respawnAt = Infinity;
      b.mode = 'foot';
    } else b.mode = 'tank';
    b.picks = {};
  }

  bailFromPlane(c) {
    const t = c.tank;
    if (t.dead || t.kind !== 'plane') return;
    if (t.grounded) t.wrecked = true;
    this.damage(t, t.hp + 1, { owner: t.lastHitBy ?? -1 });
    const b = c.bail;
    b.foot = {};
    const drop = Math.max(0, t.y - Math.max(groundAt(t.x, t.z), WATER_LEVEL));
    for (const [role, side] of [['driver', 1], ['gunner', -1]]) {
      if (!c.seats[role]) continue;
      let x = Math.max(-PLAY_LIMIT + 5, Math.min(PLAY_LIMIT - 5, t.x + side * 3)), z = Math.max(-PLAY_LIMIT + 5, Math.min(PLAY_LIMIT - 5, t.z));
      for (let k = 0; k < 8 && footBlocked(x, z, this.propDead); k++) {
        x += Math.cos(k) * 10;
        z += Math.sin(k) * 10;
      }
      for (let r = 12; r <= 120 && waterDepthAt(x, z) > 1; r += 12) {
        const a = [0, 1, 2, 3, 4, 5, 6, 7].find((k) => waterDepthAt(x + Math.cos(k * 0.785) * r, z + Math.sin(k * 0.785) * r) <= 1);
        if (a === undefined) continue;
        x += Math.cos(a * 0.785) * r;
        z += Math.sin(a * 0.785) * r;
      }
      x = Math.max(-PLAY_LIMIT + 5, Math.min(PLAY_LIMIT - 5, x));
      z = Math.max(-PLAY_LIMIT + 5, Math.min(PLAY_LIMIT - 5, z));
      const s = new CrewSoldier(role, x, z, t.h, c);
      s.drop = drop;
      s.jy = drop;
      s.pose.y = groundAt(x, z) + drop;
      b.foot[role] = s;
      this.units.push(s);
    }
    t.respawnAt = Infinity;
    b.mode = 'foot';
    b.picks = {};
  }

  onFootMessage(c, role, msg) {
    const s = c.bail.foot[role];
    if (msg.t === 'ping' && Number.isFinite(msg.x) && Number.isFinite(msg.z)) return this.setPing(c, msg.x, msg.z);
    if (!s || s.dead) return;
    if (msg.t === 'foot') {
      if (Number.isFinite(msg.x) && Number.isFinite(msg.z)) {
        const d = Math.hypot(msg.x - s.x, msg.z - s.z);
        const reach = Math.min(4, (this.time - (s.movedAt ?? -1)) * FOOT.sprint * 1.6 + 0.6);
        if (d < reach && Math.abs(msg.x) <= PLAY_LIMIT + 5 && Math.abs(msg.z) <= PLAY_LIMIT + 5 && !footBlocked(msg.x, msg.z, this.propDead)) {
          s.x = msg.x;
          s.z = msg.z;
          s.movedAt = this.time;
        }
      }
      if (Number.isFinite(msg.h)) s.h = wrapAngle(msg.h);
      if (Number.isFinite(msg.p)) s.gp = Math.max(-1.5, Math.min(1.5, msg.p));
      s.jy = s.drop > 0 ? s.drop : Math.max(0, Math.min(2, Number(msg.jy) || 0));
      s.ty = msg.crouch ? 1 : 0;
      s.spec.size.height = msg.crouch ? 1.2 : 1.8;
      s.pose.y = groundAt(s.x, s.z) + s.jy;
      s.input = { fire: !!msg.fire, ads: !!msg.ads, moving: !!msg.moving };
    } else if (msg.t === 'reload') {
      if (s.reloading <= 0 && s.mag < FOOT.rifle.mag && s.reserve > 0) s.reloading = FOOT.rifle.reload;
    } else if (msg.t === 'grenade') {
      if (s.grenades > 0 && s.grenadeCd <= 0) {
        s.grenades--;
        s.grenadeCd = FOOT.grenade.cooldown;
        const g = FOOT.grenade;
        const p = s.gp + 0.25;
        const dir = new Vector3(Math.sin(s.h) * Math.cos(p), Math.sin(p), Math.cos(s.h) * Math.cos(p));
        const eye = new Vector3(s.x, s.pose.y + (s.ty ? FOOT.crouchEye : FOOT.eye), s.z).addScaledVector(dir, 0.6);
        this.fire(s, { kind: 'grenade', damage: g.damage, speed: g.speed, splash: g.splash, splashDamage: g.splashDamage, spread: 0 }, eye, dir);
      }
    } else if (msg.t === 'garage') {
      const alive = Object.values(c.bail.foot).filter((u) => !u.dead);
      if (alive.every((u) => nearGarage(u.x, u.z, c.team))) this.endFoot(c);
    }
  }

  updateFoot(c) {
    for (const s of Object.values(c.bail.foot)) {
      if (!(s.drop > 0)) continue;
      s.drop = Math.max(0, s.drop - 6.5 * DT);
      s.jy = s.drop;
      s.pose.y = groundAt(s.x, s.z) + s.drop;
    }
    const r = FOOT.rifle;
    const crew = Object.values(c.bail.foot);
    for (const s of crew) {
      if (s.dead) continue;
      s.cd = Math.max(0, s.cd - DT);
      s.grenadeCd = Math.max(0, s.grenadeCd - DT);
      if (s.reloading > 0) {
        s.reloading -= DT;
        if (s.reloading <= 0) {
          const n = Math.min(r.mag - s.mag, s.reserve);
          s.mag += n;
          s.reserve -= n;
          s.reloading = 0;
        }
      }
      if (nearGarage(s.x, s.z, c.team)) {
        s.reserve = r.reserve;
        s.grenades = FOOT.grenades;
      }
      if (s.input.fire && s.cd <= 0 && s.reloading <= 0) {
        if (s.mag > 0) {
          s.mag--;
          s.cd = r.interval;
          const spread = (s.input.ads ? r.ads : r.hip) * (s.input.moving ? 2 : 1) * (s.ty ? 0.7 : 1);
          const dir = new Vector3(Math.sin(s.h) * Math.cos(s.gp), Math.sin(s.gp), Math.cos(s.h) * Math.cos(s.gp));
          const eye = new Vector3(s.x, s.pose.y + (s.ty ? FOOT.crouchEye : FOOT.eye) - 0.05, s.z).addScaledVector(dir, 0.5);
          this.fire(s, { kind: 'rifle', damage: r.damage, speed: r.speed, splash: 0, splashDamage: 0, spread }, eye, dir);
        } else if (s.reserve > 0) s.reloading = r.reload;
      }
    }
    if (crew.every((s) => s.dead || !c.seats[s.crew])) this.endFoot(c);
  }

  endFoot(c) {
    this.units = this.units.filter((u) => u.crewId !== c.id || u.kind === 'tank' || u.dead);
    c.bail.foot = {};
    c.bail.mode = 'tank';
    const t = c.tank;
    t.respawnAt = this.time + 15;
    t.drive = { th: 0, st: 0, boost: false, brake: false };
    t.trigger = { main: false, coax: false };
  }

  updateModules(t) {
    const m = t.mods;
    if (t.burning > 0) {
      t.burning -= DT;
      this.damage(t, 14 * DT, { owner: t.lastHitBy ?? t.id });
      m.engine = Math.max(0, m.engine - 0.03 * DT);
    }
    if (!t.player) {
      for (const k in m) m[k] = Math.min(1, m[k] + 0.04 * DT);
      return;
    }
    const wantRepair = t.drive.repair && Math.abs(t.v) < 0.5;
    if (!wantRepair) {
      t.repair = null;
      return;
    }
    if (!t.repair) {
      let worst = null;
      for (const k in m) if (m[k] < 1 && (!worst || m[k] < m[worst])) worst = k;
      if (!worst && t.burning <= 0) return;
      worst ??= 'engine';
      const total = m[worst] <= 0 ? 7 : 4;
      t.repair = { mod: worst, t: 0, total, from: m[worst] };
    }
    const r = t.repair;
    r.t += DT;
    m[r.mod] = r.from + (1 - r.from) * Math.min(1, r.t / r.total);
    if (r.t >= r.total) {
      if (r.mod === 'engine') t.burning = 0;
      this.events.push({ k: 'fixed', u: t.id, m: r.mod });
      t.repair = null;
    }
  }

  damageModules(u, hit, dmg) {
    if (u.kind !== 'tank' || !u.mods) return;
    const s = u.spec.size;
    const fy = (hit.ly ?? 1) / s.height;
    const fz = (hit.lz ?? 0) / (s.length / 2);
    const side = Math.abs(hit.lx ?? 0) > (s.width / 2) * 0.75;
    let mod;
    if (fy < 0.4 && (side || hit.face === 'side')) mod = 'tracks';
    else if (fz < -0.45) mod = 'engine';
    else if (fy > 0.62) mod = fz > 0.3 ? 'gun' : 'turret';
    else mod = fz > 0 ? 'radar' : 'engine';
    if (Math.random() < 0.12) mod = 'radar';
    const before = u.mods[mod];
    u.mods[mod] = Math.max(0, before - dmg / (u.spec.hp * 0.35));
    if (mod === 'engine' && Math.random() < 0.15 && u.burning <= 0) {
      u.burning = 10;
      if (u.player) this.events.push({ k: 'mod', u: u.id, m: 'fire' });
    }
    if (u.player && before > 0) {
      const state = u.mods[mod] <= 0 ? 'destroyed' : u.mods[mod] < 0.5 ? 'damaged' : null;
      if (state) this.events.push({ k: 'mod', u: u.id, m: mod, state });
    }
  }

  driveTank(t) {
    const s = t.spec;
    const d = { ...t.drive };
    this.updateModules(t);
    if (t.dead) return;
    const m = t.mods;
    if (t.repair) d.th = d.st = 0;
    if (m.tracks <= 0) {
      d.th = 0;
      d.st = 0;
      d.brake = true;
    }
    if (m.engine <= 0) {
      d.th = 0;
      d.boost = false;
    }
    const engineMul = 0.45 + 0.55 * Math.min(1, m.engine * 2);
    const boosting = d.boost && d.th > 0 && t.boost > 0;
    t.boost = Math.max(0, Math.min(1, t.boost + (boosting ? -DT / 4 : DT / 12)));
    const boostMul = boosting ? 1.4 : 1;

    const [fx, fz] = [Math.sin(t.h), Math.cos(t.h)];
    const L = s.size.length * 0.42;
    const slope = (groundAt(t.x + fx * L, t.z + fz * L) - groundAt(t.x - fx * L, t.z - fz * L)) / (2 * L);
    const dirSlope = slope * Math.sign(t.v || d.th || 1);
    let slopeMul = 1 - Math.max(0, dirSlope) * 1.3 + Math.max(0, -dirSlope) * 0.25;
    slopeMul = Math.max(0.15, slopeMul);

    const depth = waterDepthAt(t.x, t.z);
    const waterCap = depth > 0.3 ? 3.5 : Infinity;

    let target = (d.th >= 0 ? d.th * s.maxSpeed * boostMul : d.th * s.reverseSpeed) * engineMul;
    target *= slopeMul;
    target = Math.max(-waterCap, Math.min(waterCap, target));

    if (d.brake) {
      t.v -= Math.sign(t.v) * Math.min(Math.abs(t.v), 14 * DT);
    } else if (d.th !== 0) {
      const a = s.accel * (boosting ? 1.5 : 1) * (Math.sign(target - t.v) !== Math.sign(t.v) ? 1.8 : 1);
      t.v += Math.sign(target - t.v) * Math.min(Math.abs(target - t.v), a * DT);
    } else {
      t.v -= Math.sign(t.v) * Math.min(Math.abs(t.v), 3 * DT);
    }

    const speedFrac = Math.min(1, Math.abs(t.v) / s.maxSpeed);
    const steer = d.th < 0 ? -d.st : d.st;
    t.h = wrapAngle(t.h + steer * s.turnRate * (1 - 0.35 * speedFrac) * DT * (d.brake ? 0.6 : 1));

    const nx = t.x + Math.sin(t.h) * t.v * DT;
    const nz = t.z + Math.cos(t.h) * t.v * DT;
    if (Math.abs(t.v) > 2) {
      for (const u of this.units) {
        if (u.kind !== 'inf' || u.dead || u.team === t.team) continue;
        if (Math.abs(u.x - nx) < 4 && Math.abs(u.z - nz) < 4 && Math.hypot(u.x - nx, u.z - nz) < t.radius * 0.6) this.damage(u, 999, { owner: t.id });
      }
    }
    if (this.blocked(t, nx, nz)) {
      t.v *= -0.15;
    } else {
      t.x = nx;
      t.z = nz;
    }
    tankPose(s, t.x, t.z, t.h, t.pose);
  }

  blocked(t, nx, nz) {
    if (Math.abs(nx) > PLAY_LIMIT || Math.abs(nz) > PLAY_LIMIT) return true;
    if (waterDepthAt(nx, nz) > 1.7) return true;
    if (crossesBridgeRail(t.x, t.z, nx, nz) && waterDepthAt(nx, nz) > 0) return true;
    const step = groundAt(nx, nz) - groundAt(t.x, t.z);
    const dist = Math.hypot(nx - t.x, nz - t.z) || 1e-6;
    if (step / dist > 0.9) return true;
    const r = t.radius * 0.72;
    for (const p of propsNear(nx, nz, r + 2)) {
      if (!p.solid || this.propDead.has(p.id)) continue;
      if (circleHitsProp(p, nx, nz, r) && !circleHitsProp(p, t.x, t.z, r)) return true;
    }
    for (const u of this.units) {
      if (u === t || u.kind === 'inf') continue;
      if (u.kind === 'plane' && !u.grounded && !u.wrecked) continue;
      const rr = (u.radius + t.radius) * 0.72;
      const dNew = Math.hypot(u.x - nx, u.z - nz);
      if (dNew < rr && dNew < Math.hypot(u.x - t.x, u.z - t.z)) return true;
    }
    return false;
  }

  aimTurret(t) {
    const s = t.spec;
    const ring = t.mods ? (t.mods.turret <= 0 ? 0.08 : 0.35 + 0.65 * t.mods.turret) : 1;
    const npc = t.ai && !t.player && !t.crew ? this.skill.turret : 1;
    const maxStep = s.turretSpeed * ring * npc * DT;
    const want = wrapAngle(t.aim.yaw - t.h);
    const diff = wrapAngle(want - t.ty);
    t.ty = wrapAngle(t.ty + Math.max(-maxStep, Math.min(maxStep, diff)));
    if (s.traverse) t.ty = Math.max(-s.traverse, Math.min(s.traverse, t.ty));
    const worldYaw = t.h + t.ty;
    const wantElev = t.aim.pitch - planePitchAlong(t.pose.up, worldYaw);
    const elev = Math.max(s.elevation.min, Math.min(s.elevation.max, wantElev));
    const eStep = s.turretSpeed * 0.6 * npc * DT;
    t.gp += Math.max(-eStep, Math.min(eStep, elev - t.gp));
  }

  updateWeapons(t) {
    const w = t.spec.weapon;
    t.reload = Math.max(0, t.reload - DT);
    t.fireCd = Math.max(0, t.fireCd - DT);
    t.coaxCd = Math.max(0, t.coaxCd - DT);
    if (t.mods?.gun <= 0) {
      t.fireQueued = false;
      t.trigger = { ...t.trigger, main: false };
    }

    if (w.kind === 'autocannon') {
      if (t.mag === 0 && t.reload === 0) t.mag = w.magazine;
      if (t.trigger.main && t.reload === 0 && t.fireCd === 0 && t.mag > 0) {
        this.fire(t, { kind: 'ac', damage: w.damage, speed: w.speed, splash: w.splash, splashDamage: w.damage * 0.3, spread: w.spread, airMul: w.airMul, fuse: w.fuse });
        t.mag--;
        t.fireCd = w.fireInterval;
        if (t.mag === 0) t.reload = w.reload;
      }
    } else {
      if (t.fireQueued && t.reload === 0) {
        if (w.kind === 'cannon') {
          const sh = w.shells[t.shell];
          this.fire(t, { kind: t.shell === 'AP' ? 'ap' : 'he', damage: sh.damage, speed: sh.speed, splash: sh.splash, splashDamage: sh.splashDamage, spread: w.spread });
        } else {
          this.fire(t, { kind: 'heavy', damage: w.damage, speed: w.speed, splash: w.splash, splashDamage: w.splashDamage, spread: w.spread });
        }
        t.reload = w.reload;
      }
      t.fireQueued = false;
    }

    if (w.coax) {
      t.coaxReload = Math.max(0, t.coaxReload - DT);
      if (t.coaxBelt === 0 && t.coaxReload === 0) t.coaxBelt = w.coax.belt;
      if (t.trigger.coax && t.coaxReload === 0 && t.coaxCd === 0 && t.coaxBelt > 0) {
        this.fire(t, { kind: 'mg', damage: w.coax.damage, speed: w.coax.speed, splash: 0, splashDamage: 0, spread: w.coax.spread });
        t.coaxBelt--;
        t.coaxCd = w.coax.fireInterval;
        if (t.coaxBelt === 0) t.coaxReload = w.coax.reload;
      }
    }
  }

  fire(t, p, origin = null, direction = null) {
    const { pos, dir } = origin ? { pos: origin, dir: direction } : muzzlePose(t.spec, t.pose, t.x, t.z, t.ty, t.gp);
    if (t.ai && !t.player && !t.crew) p = { ...p, damage: p.damage * this.skill.damage, splashDamage: (p.splashDamage ?? 0) * this.skill.damage };
    const gunMul = t.mods?.gun !== undefined && p.kind !== 'mg' ? 1 + 4 * (1 - t.mods.gun) : 1;
    const sp = p.spread * gunMul * Math.sqrt(Math.random());
    const a = Math.random() * Math.PI * 2;
    const ref = Math.abs(dir.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
    const u = new Vector3().crossVectors(dir, ref).normalize();
    const v = new Vector3().crossVectors(dir, u);
    dir.addScaledVector(u, Math.cos(a) * sp).addScaledVector(v, Math.sin(a) * sp).normalize();
    const proj = {
      id: nextId++,
      owner: t.id,
      team: t.team,
      ...p,
      x: pos.x,
      y: pos.y,
      z: pos.z,
      vx: dir.x * p.speed,
      vy: dir.y * p.speed,
      vz: dir.z * p.speed,
      life: p.life ?? (p.kind === 'rocket' ? 2 : 4),
    };
    if (p.coastV) {
      proj.b = [r2(proj.vx), r2(proj.vy), r2(proj.vz)];
      [proj.vx, proj.vy, proj.vz] = p.coastV;
    }
    this.projectiles.push(proj);
    this.events.push({
      k: 'f',
      id: proj.id,
      o: t.id,
      kind: p.kind,
      team: t.team,
      x: r2(pos.x),
      y: r2(pos.y),
      z: r2(pos.z),
      vx: r2(proj.vx),
      vy: r2(proj.vy),
      vz: r2(proj.vz),
      ...(p.air ? { air: 1 } : {}),
      ...(p.turret != null ? { tur: p.turret } : {}),
      ...(proj.b ? { coast: p.coast, b: proj.b } : {}),
    });
  }

  unitAimY(u) {
    if (u.kind === 'plane') return u.y;
    return (u.pose?.y ?? groundAt(u.x, u.z)) + 1;
  }

  steerRocket(p, dt) {
    // Coast phase: motor not lit yet — no homing.
    if (p.coast > 0) return;
    let best = null;
    let bestScore = Infinity;
    const maxDist = p.air ? 220 : 180;
    const maxTurn = p.air ? 4.2 : 3.5;
    for (const u of this.units) {
      if (u.dead || u.team === p.team || u.id === p.owner) continue;
      const uy = this.unitAimY(u);
      const dist = Math.hypot(u.x - p.x, uy - p.y, u.z - p.z);
      if (dist >= maxDist) continue;
      // Prefer closer targets; slightly prefer planes and player vehicles.
      let score = dist;
      if (u.kind === 'plane') score *= 0.7;
      if (u.player) score *= 0.85;
      if (score < bestScore) {
        bestScore = score;
        best = u;
      }
    }
    if (!best) return;
    const speed = Math.hypot(p.vx, p.vy, p.vz);
    if (speed < 0.001) return;
    const cur = new Vector3(p.vx / speed, p.vy / speed, p.vz / speed);
    const desired = new Vector3(best.x - p.x, this.unitAimY(best) - p.y, best.z - p.z);
    if (desired.lengthSq() < 1e-6) return;
    desired.normalize();
    const angle = Math.acos(Math.max(-1, Math.min(1, cur.dot(desired))));
    if (angle < 1e-4) return;
    const t = Math.min(1, (maxTurn * dt) / angle);
    cur.lerp(desired, t).normalize();
    p.vx = cur.x * speed;
    p.vy = cur.y * speed;
    p.vz = cur.z * speed;
  }

  updateProjectiles() {
    const keep = [];
    for (const p of this.projectiles) {
      p.life -= DT;
      const x0 = p.x, y0 = p.y, z0 = p.z;

      if (p.kind === 'rocket') {
        // Preserve coast / motor ignition; home only after the motor is burning.
        if (p.b) rocketStep(p, DT);
        this.steerRocket(p, DT);
      } else {
        p.vy -= GRAVITY * DT;
      }

      const x1 = x0 + p.vx * DT, y1 = y0 + p.vy * DT, z1 = z0 + p.vz * DT;
      const hit = this.traceSegment(p, x0, y0, z0, x1, y1, z1);
      if (hit) {
        this.impact(p, hit);
        continue;
      }
      // A flak shell bursts beside any aircraft it passes.
      if (p.fuse && this.planes.flakFuse(p, x0, y0, z0, x1 - x0, y1 - y0, z1 - z0)) continue;
      p.x = x1;
      p.y = y1;
      p.z = z1;
      if (p.life > 0 && Math.abs(p.x) < 1500 && Math.abs(p.z) < 1500) keep.push(p);
    }
    this.projectiles = keep;
  }

  traceSegment(p, x0, y0, z0, x1, y1, z1) {
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    const len = Math.hypot(dx, dy, dz);
    let best = null;

    for (const u of this.units) {
      if (u.dead || u.id === p.owner || (p.turret != null && u.team === p.team)) continue;
      if (u.kind === 'plane' && p.kind !== 'bomb') {
        const ax = u.x - x0, ay = u.y - y0, az = u.z - z0;
        const ta = Math.max(0, Math.min(1, (ax * dx + ay * dy + az * dz) / (len * len)));
        const bx = ax - dx * ta, by = ay - dy * ta, bz = az - dz * ta;
        if (bx * bx + by * by + bz * bz > (u.radius + 1) ** 2) continue;
        const h = this.planes.hitTest(u, x0, y0, z0, dx, dy, dz);
        if (h && (!best || h.t < best.t)) best = h;
        continue;
      }
      if (u.kind === 'plane') continue;
      const cx = u.x - x0, cy = u.pose.y + 1 - y0, cz = u.z - z0;
      const t = Math.max(0, Math.min(1, (cx * dx + cy * dy + cz * dz) / (len * len)));
      const ex = cx - dx * t, ey = cy - dy * t, ez = cz - dz * t;
      const miss = ex * ex + ey * ey + ez * ez;
      if (u.ai && p.owner > 0 && p.team !== u.team && miss < 36) {
        u.ai.alertBy = p.owner;
        u.ai.alertUntil = this.time + 6;
      }
      if (miss > (u.radius + 1) ** 2) continue;
      const h = this.boxHit(u, x0, y0, z0, dx, dy, dz);
      if (h && (!best || h.t < best.t)) best = h;
    }

    if (p.turret == null) for (const pr of propsNear(x0 + dx / 2, z0 + dz / 2, len / 2 + 12)) {
      if (!pr.solid || this.propDead.has(pr.id)) continue;
      const t = segmentHitsProp(pr, x0, y0, z0, dx, dy, dz);
      if (t !== null && (!best || t < best.t)) best = { t, x: x0 + dx * t, y: y0 + dy * t, z: z0 + dz * t, prop: pr, surface: 'prop' };
    }

    const steps = Math.max(1, Math.ceil(len / 3));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (best && t > best.t) break;
      const x = x0 + dx * t, y = y0 + dy * t, z = z0 + dz * t;
      const g = groundAt(x, z);
      const surface = Math.max(g, WATER_LEVEL);
      if (y <= surface) {
        const tp = (i - 1) / steps;
        let lo = tp, hi = t;
        for (let k = 0; k < 6; k++) {
          const m = (lo + hi) / 2;
          const yy = y0 + dy * m;
          const s = Math.max(groundAt(x0 + dx * m, z0 + dz * m), WATER_LEVEL);
          if (yy <= s) hi = m;
          else lo = m;
        }
        const hx = x0 + dx * hi, hz = z0 + dz * hi;
        const water = heightAt(hx, hz) < WATER_LEVEL && groundAt(hx, hz) <= WATER_LEVEL;
        return { t: hi, x: hx, y: y0 + dy * hi, z: hz, surface: water ? 'water' : 'ground' };
      }
    }
    return best;
  }

  boxHit(u, x0, y0, z0, dx, dy, dz) {
    const s = u.spec.size;
    const c = Math.cos(u.h), sn = Math.sin(u.h);
    const ox = x0 - u.x, oy = y0 - u.pose.y, oz = z0 - u.z;
    const o = [ox * c - oz * sn, oy, ox * sn + oz * c];
    const d = [dx * c - dz * sn, dy, dx * sn + dz * c];
    const hitLen = u.spec.hitLength ?? s.length;
    const min = [-s.width / 2, 0.2, -hitLen / 2];
    const max = [s.width / 2, s.height, hitLen / 2];
    let tmin = 0, tmax = 1, axis = -1, sign = 0;
    for (let a = 0; a < 3; a++) {
      if (Math.abs(d[a]) < 1e-9) {
        if (o[a] < min[a] || o[a] > max[a]) return null;
        continue;
      }
      let t1 = (min[a] - o[a]) / d[a];
      let t2 = (max[a] - o[a]) / d[a];
      let sgn = -1;
      if (t1 > t2) {
        [t1, t2] = [t2, t1];
        sgn = 1;
      }
      if (t1 > tmin) {
        tmin = t1;
        axis = a;
        sign = sgn;
      }
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
    if (axis < 0) return null;
    const dl = Math.hypot(d[0], d[1], d[2]);
    const cosInc = Math.abs(d[axis]) / dl;
    let face;
    if (axis === 2) face = sign > 0 ? 'front' : 'rear';
    else if (axis === 0) face = 'side';
    else face = sign > 0 ? 'top' : 'side';
    return { t: tmin, x: x0 + dx * tmin, y: y0 + dy * tmin, z: z0 + dz * tmin, unit: u, face, cosInc, lx: o[0] + d[0] * tmin, ly: o[1] + d[1] * tmin, lz: o[2] + d[2] * tmin };
  }

  impact(p, hit) {
    const ev = { k: 'i', id: p.id, o: p.owner, kind: p.kind, x: r2(hit.x), y: r2(hit.y), z: r2(hit.z), r: hit.surface ?? 'armor' };
    if (hit.unit) {
      const u = hit.unit;
      ev.u = u.id;
      if (u.kind === 'plane') {
        const smallArms = p.kind === 'mg' || p.kind === 'rifle' ? u.spec.smallArms ?? 1 : 1;
        const dmg = p.damage * u.spec.armor.side * smallArms * (p.airMul ?? 1);
        ev.dmg = Math.round(dmg);
        u.lastHitBy = p.owner;
        this.planes.damageZone(u, hit.zone, dmg);
        this.damage(u, dmg, p);
        this.events.push(ev);
        return;
      }
      const kinetic = p.kind !== 'he' && p.kind !== 'rocket';
      if (u.kind !== 'inf' && kinetic && p.kind !== 'mg' && p.kind !== 'rifle' && hit.face !== 'top' && hit.cosInc < 0.3 && Math.random() < 0.75) {
        ev.r = 'ric';
        this.damage(u, p.damage * 0.08, p);
      } else {
        const armor = u.spec.armor[hit.face === 'top' ? 'rear' : hit.face];
        const angleMul = kinetic && u.kind !== 'inf' ? 0.6 + 0.4 * hit.cosInc : 1;
        const vsArmor = u.kind !== 'inf' && (p.kind === 'rifle' || p.kind === 'mg') ? 0.08 : 1;
        const dmg = p.damage * armor * angleMul * vsArmor;
        ev.dmg = Math.round(dmg);
        u.lastHitBy = p.owner;
        if (vsArmor === 1) this.damageModules(u, hit, dmg);
        this.damage(u, dmg, p);
        ev.face = hit.face;
      }
    }
    if (hit.prop) {
      ev.prop = hit.prop.id;
      const mul = p.kind === 'mg' ? 0.05 : p.kind === 'he' || p.kind === 'heavy' ? 1.6 : 1;
      this.damageProp(hit.prop, p.damage * mul, p.owner);
    }
    this.events.push(ev);
    if (p.splash > 1 && p.splashDamage > 0) this.splash(hit.x, hit.y, hit.z, p.splash, p.splashDamage, p.owner, hit.unit, hit.prop);
    if (p.splash >= 3) {
      for (const u of this.units) {
        if (u.kind !== 'inf' || u.dead || !u.ai) continue;
        const d = Math.hypot(u.x - hit.x, u.z - hit.z);
        if (d < p.splash * 2.5 && d > 0.5) u.ai.proneT = Math.max(u.ai.proneT, 2.5 + Math.random() * 2);
      }
    }
  }

  splash(x, y, z, radius, amount, owner, skipUnit = null, skipProp = null) {
    for (const u of this.units) {
      if (u.dead || u === skipUnit) continue;
      const d = Math.hypot(u.x - x, u.pose.y + 1 - y, u.z - z) - u.radius * 0.5;
      const mul = u.kind === 'inf' ? (u.ai?.inCover ? 0.8 : 1.6) : 0.6;
      if (d < radius) this.damage(u, amount * (1 - Math.max(0, d) / radius) * mul, { owner, blast: [x, z] });
    }
    for (const pr of propsNear(x, z, radius + 10)) {
      if (pr === skipProp || this.propDead.has(pr.id) || !Number.isFinite(pr.maxHp)) continue;
      const d = Math.hypot(pr.x - x, pr.z - z) - Math.max(pr.w, pr.d) / 2;
      if (d < radius) this.damageProp(pr, amount * (1 - Math.max(0, d) / radius) * 0.8, owner);
    }
  }

  damageProp(pr, amount, owner) {
    if (this.propDead.has(pr.id) || !Number.isFinite(pr.maxHp) || amount <= 0) return;
    const hp = (this.propHp.get(pr.id) ?? pr.maxHp) - amount;
    this.propHp.set(pr.id, hp);
    if (hp > 0) return;
    this.propDead.add(pr.id);
    this.propsDirty = true;
    this.events.push({ k: 'pd', id: pr.id });
    if (PROP_TYPES[pr.type].explodes) {
      this.events.push({ k: 'boom', x: r2(pr.x), y: r2(pr.y + 2), z: r2(pr.z), size: 14 });
      this.splash(pr.x, pr.y + 2, pr.z, 16, 320, owner, null, pr);
    }
  }

  damage(u, amount, p) {
    if (u.dead || amount <= 0 || this.over) return;
    if (u.ai && p.owner > 0) {
      u.ai.alertBy = p.owner;
      u.ai.alertUntil = this.time + 6;
    }
    if (u.kind === 'inf' && u.ai?.inCover && Math.random() < 0.5) return;
    u.hp -= amount;
    if (u.hp <= 0) {
      u.hp = 0;
      u.dead = true;
      if (u.kind !== 'plane') u.v = 0;
      u.diedAt = this.time;
      const victimCrew = this.crewOf(u);
      if (victimCrew) victimCrew.stats.deaths++;
      if (victimCrew && u.spec.noPlaneRespawn) victimCrew.noPlanes = true;
      if (u.player && victimCrew) {
        u.respawnAt = this.time + 15;
        victimCrew.bail = { mode: 'choice', until: this.time + FOOT.choiceTime, picks: {}, foot: {} };
        for (const r of ['driver', 'gunner']) if (!victimCrew.seats[r]) victimCrew.bail.picks[r] = 'tank';
      }
      const kill = { k: 'k', u: u.id, by: p.owner, team: u.team, type: u.type };
      if (p.blast) [kill.bx, kill.bz] = [r2(p.blast[0]), r2(p.blast[1])];
      else if (p.vx !== undefined) [kill.dx, kill.dz] = [r2(p.vx), r2(p.vz)];
      this.events.push(kill);
      const shooter = this.units.find((x) => x.id === p.owner);
      const killerCrew = this.crewOf(shooter);
      if (killerCrew && u.team !== shooter.team) killerCrew.stats.kills++;
      if (shooter && u.team !== shooter.team) this.onKill?.(u, shooter);
      const cost = u.player ? MATCH.deathCost.player : MATCH.deathCost[u.kind] ?? 1;
      this.tickets[u.team] = Math.max(0, this.tickets[u.team] - cost);
    }
  }

  updateCapture() {
    if (this.mode !== 'flags') return;
    for (const pt of this.points) {
      const def = POINTS.find((p) => p.id === pt.id);
      const weight = { blue: 0, red: 0 };
      const crewsInside = new Set();
      for (const u of this.units) {
        if (u.dead || u.kind === 'atgun' || u.kind === 'plane') continue;
        if (Math.abs(u.x - def.x) > def.r || Math.abs(u.z - def.z) > def.r) continue;
        if (Math.hypot(u.x - def.x, u.z - def.z) > def.r) continue;
        weight[u.team] += u.player ? MATCH.capWeight.player : MATCH.capWeight[u.kind] ?? 1;
        if (u.crewId != null) crewsInside.add(u.crewId);
      }
      pt.contested = weight.blue > 0 && weight.red > 0;
      if (pt.contested || (weight.blue === 0 && weight.red === 0)) continue;
      const team = weight.blue > 0 ? 'blue' : 'red';
      const dir = team === 'blue' ? 1 : -1;
      const rate = Math.min(6, weight[team]) * MATCH.capRate * DT;
      const before = pt.progress;
      pt.progress = Math.max(-1, Math.min(1, pt.progress + dir * rate));
      if (pt.owner && Math.sign(pt.progress) !== Math.sign(before) && Math.sign(before) !== 0) {
        this.events.push({ k: 'cap', id: pt.id, team: null, prev: pt.owner });
        pt.owner = null;
      }
      if (!pt.owner && Math.abs(pt.progress) >= 1) {
        pt.owner = team;
        this.events.push({ k: 'cap', id: pt.id, team });
        for (const id of crewsInside) {
          const c = this.crews.get(id);
          if (c?.team === team) c.stats.caps++;
        }
      }
    }
  }

  updateTickets() {
    if (this.mode !== 'flags') return;
    this.bleedT -= DT;
    if (this.bleedT <= 0) {
      this.bleedT = MATCH.bleedInterval;
      const held = { blue: 0, red: 0 };
      for (const p of this.points) if (p.owner) held[p.owner]++;
      if (held.blue > held.red) this.tickets.red = Math.max(0, this.tickets.red - (held.blue - held.red));
      if (held.red > held.blue) this.tickets.blue = Math.max(0, this.tickets.blue - (held.red - held.blue));
    }
    const timeUp = this.time >= MATCH.duration;
    if (this.tickets.blue <= 0 || this.tickets.red <= 0 || timeUp) {
      const out = this.tickets.red <= 0 ? 'Red' : this.tickets.blue <= 0 ? 'Blue' : null;
      this.endMatch(out === 'Red' ? 'blue' : out === 'Blue' ? 'red' : this.leader(), out ? `${out} ran out of tickets` : 'Time is up');
    }
  }

  leader() {
    const { blue, red } = this.tickets;
    if (blue !== red) return blue > red ? 'blue' : 'red';
    const held = (team) => this.points.filter((p) => p.owner === team).length;
    const diff = held('blue') - held('red');
    return diff === 0 ? null : diff > 0 ? 'blue' : 'red';
  }

  endMatch(winner, reason = '') {
    if (this.over) return;
    this.over = true;
    this.room.broadcast({ t: 'matchEnd', winner, reason, time: this.time, mode: this.mode, crews: this.scoreboard(), tickets: this.tickets, score: this.score });
  }

  scoreboard() {
    return [...this.crews.values()].map((c) => [c.id, c.stats.kills, c.stats.deaths, c.stats.caps]);
  }

  crewSnapshot(c) {
    const b = c.bail;
    const out = { mode: b.mode };
    if (b.mode === 'choice') {
      out.left = r2(Math.max(0, b.until - this.time));
      out.picks = b.picks;
    }
    if (b.mode === 'foot') {
      out.foot = {};
      for (const [role, s] of Object.entries(b.foot)) {
        out.foot[role] = { drop: s.drop > 0 ? r2(s.drop) : 0, id: s.id, hp: Math.round(s.hp), dead: s.dead, x: r2(s.x), z: r2(s.z), mag: s.mag, res: s.reserve, gren: s.grenades, rl: r2(s.reloading) };
      }
    }
    return out;
  }

  meSnapshot(c) {
    const t = c.tank;
    return {
      id: t.id,
      crewId: c.id,
      team: c.team,
      vehicle: t.type,
      noPlanes: c.noPlanes,
      v: r2(t.v),
      boost: r2(t.boost),
      reload: r2(t.reload),
      reloadTotal: t.reloadTotal,
      mag: t.mag,
      shell: t.shell,
      coax: t.coaxBelt,
      coaxReload: r2(t.coaxReload),
      dead: t.dead,
      respawnIn: !t.dead ? 0 : Number.isFinite(t.respawnAt) ? r2(t.respawnAt - this.time) : NO_RESPAWN,
      hp: Math.round(t.hp),
      drive: t.drive,
      mods: Object.fromEntries(Object.entries(t.mods).map(([k, v]) => [k, r2(v)])),
      burning: t.burning > 0,
      repair: t.repair && { mod: t.repair.mod, p: r2(t.repair.t / t.repair.total) },
      ping: c.ping && { id: c.ping.id, x: r2(c.ping.x), z: r2(c.ping.z), age: r2(this.time - c.ping.t0) },
      pingCd: r2(Math.max(0, c.pingReadyAt - this.time)),
      crew: this.crewSnapshot(c),
      ...(t.kind === 'plane' ? { pl: { y: r2(t.y), th: r2(t.throttle), fuel: r2(t.fuel), bombs: t.bombs, rockets: t.rockets, ammo: Math.round(t.ammo), rear: Math.round(t.rearAmmo), stall: t.stall, ground: t.grounded, edge: t.warnEdge, low: t.warnLow, six: t.six, vy: r2(t.vy), ab: t.ab, aa: r2(t.aaWarn ?? 0) } } : {}),
    };
  }

  crewFocus(c) {
    const alive = c.bail.mode === 'foot' ? Object.values(c.bail.foot).find((s) => !s.dead) : null;
    const u = alive ?? c.tank;
    return [Math.round(u.x), Math.round(u.z)];
  }

  broadcast() {
    const u = this.units.map((u) => {
      const a = [u.id, TEAM_CODE[u.team], TYPE_CODE[u.type], Math.round(u.x * 10), Math.round(u.z * 10), Math.round(u.h * 1000), Math.round(u.ty * 1000), Math.round(u.gp * 1000), Math.round((u.hp / u.spec.hp) * 100), u.dead ? 1 : 0, u.crewId != null ? u.crewId + 1 : 0];
      if (u.crew) a.push(Math.round(u.jy * 100));
      else if (u.kind === 'plane') a.push(Math.round(u.y * 100), Math.round(u.gunYaw * 100), Math.round(u.gunPitch * 100), u.ab ? 1 : 0);
      return a;
    });
    const crews = {};
    const focus = {};
    const pings = [];
    for (const c of this.crews.values()) {
      crews[c.id] = this.meSnapshot(c);
      focus[c.id] = this.crewFocus(c);
      if (c.ping) pings.push([c.id, TEAM_CODE[c.team], Math.round(c.ping.x), Math.round(c.ping.z)]);
    }
    const snap = {
      t: 's',
      time: r3(this.time),
      tick: this.tickNo,
      crews,
      focus,
      u,
      pings,
      pts: this.points.map((p) => [p.id, p.owner ? TEAM_CODE[p.owner] : -1, r2(p.progress), p.contested ? 1 : 0]),
      tk: [this.tickets.blue, this.tickets.red],
      sc: [this.score.blue, this.score.red],
      left: Math.max(0, Math.round(MATCH.duration - this.time)),
    };
    if (this.tickNo % TICK_RATE === 0) snap.sb = this.scoreboard();
    this.modeSnapshot?.(snap);
    if (this.propsDirty || this.tickNo % 40 === 0) {
      snap.pd = [...this.propDead];
      this.propsDirty = false;
    }
    if (this.events.length) {
      snap.ev = this.events;
      this.events = [];
    }
    this.room.broadcast(snap);
  }
}