import { Vector3 } from 'three';
import { TANKS, TICK_RATE, PING, MATCH, TYPE_IDS } from '../../../shared/constants.js';
import { ArmyAI } from './ai.js';
import { BASES, POINTS, PLAY_LIMIT, groundAt, heightAt, waterDepthAt, crossesBridgeRail, WATER_LEVEL } from '../../../shared/map.js';
import { tankPose, muzzlePose, planePitchAlong, wrapAngle } from '../../../shared/tank.js';
import { PROPS, PROP_TYPES, propsNear, circleHitsProp, segmentHitsProp } from '../../../shared/props.js';

const DT = 1 / TICK_RATE;
const GRAVITY = 9.81;
export const TEAM_CODE = { blue: 0, red: 1 };
export const TYPE_CODE = Object.fromEntries(TYPE_IDS.map((t, i) => [t, i]));

const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;

let nextId = 1;

class Tank {
  constructor(team, type, x, z, h, { player = false } = {}) {
    this.id = nextId++;
    this.kind = 'tank';
    this.team = team;
    this.type = type;
    this.spec = TANKS[type];
    this.player = player;
    this.x = x;
    this.z = z;
    this.h = h;
    this.v = 0;
    this.ty = 0; // turret yaw relative to hull
    this.gp = 0; // gun elevation relative to hull
    this.hp = this.spec.hp;
    this.dead = false;
    this.respawnAt = 0;
    this.spawn = { x, z, h };
    this.pose = tankPose(this.spec, x, z, h);
    this.radius = Math.hypot(this.spec.size.length, this.spec.size.width) / 2;
    // Inputs
    this.drive = { th: 0, st: 0, boost: false, brake: false };
    this.aim = { yaw: h, pitch: 0 };
    this.trigger = { main: false, coax: false };
    // Driving resources
    this.boost = 1;
    // Weapons
    const w = this.spec.weapon;
    this.reload = 0; // seconds left until main gun ready
    this.reloadTotal = w.reload;
    this.fireCd = 0;
    this.mag = w.magazine ?? 1;
    this.shell = 'AP';
    this.coaxBelt = w.coax?.belt ?? 0;
    this.coaxReload = 0;
    this.coaxCd = 0;
    this.fireQueued = false;
    // Damage zones: 1 = intact, 0 = destroyed.
    this.mods = { tracks: 1, engine: 1, turret: 1, gun: 1, radar: 1 };
    this.burning = 0; // seconds of engine fire left
    this.repair = null; // { mod, t, total }
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
  }
}

export class Match {
  constructor(room) {
    this.room = room;
    this.time = 0;
    this.units = [];
    this.projectiles = [];
    this.events = [];
    this.over = false;
    this.ping = null;
    this.pingReadyAt = 0;
    // Per-match prop damage (the shared PROPS layout itself is never mutated).
    this.propHp = new Map();
    this.propDead = new Set();
    this.propsDirty = true;
    this.stats = { kills: 0, captures: 0 };

    this.stats.startedAt = 0;
    this.tickets = { blue: MATCH.tickets, red: MATCH.tickets };
    this.bleedT = MATCH.bleedInterval;
    this.points = POINTS.map((p) => ({ id: p.id, owner: null, progress: 0, contested: false }));
    this.capturedByUs = new Set();

    const b = BASES.blue;
    this.tank = this.addTank(new Tank('blue', room.tank, b.x, b.z + 45, b.heading, { player: true }));
    this.army = new ArmyAI(this);

    this.interval = setInterval(() => this.tick(), 1000 / TICK_RATE);
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

  // ---------- Input ----------
  onMessage(player, msg) {
    const t = this.tank;
    if (player.role === 'driver' && msg.t === 'drive') {
      t.drive.th = Math.max(-1, Math.min(1, Number(msg.th) || 0));
      t.drive.st = Math.max(-1, Math.min(1, Number(msg.st) || 0));
      t.drive.boost = !!msg.boost;
      t.drive.brake = !!msg.brake;
      t.drive.repair = !!msg.repair;
    } else if (player.role === 'gunner') {
      if (msg.t === 'aim') {
        if (Number.isFinite(msg.yaw)) t.aim.yaw = msg.yaw;
        if (Number.isFinite(msg.pitch)) t.aim.pitch = Math.max(-0.5, Math.min(0.6, msg.pitch));
      } else if (msg.t === 'trigger') {
        t.trigger.main = !!msg.main;
        t.trigger.coax = !!msg.coax;
        if (msg.main) t.fireQueued = true;
      } else if (msg.t === 'ping' && Number.isFinite(msg.x) && Number.isFinite(msg.z)) {
        if (this.time >= this.pingReadyAt) {
          this.ping = { x: msg.x, z: msg.z, t0: this.time, id: (this.ping?.id ?? 0) + 1 };
          this.pingReadyAt = this.time + PING.cooldown;
        }
      } else if (msg.t === 'shell' && (msg.shell === 'AP' || msg.shell === 'HE') && t.spec.weapon.shells) {
        if (t.shell !== msg.shell) {
          t.shell = msg.shell;
          // Unloading a ready round costs half a reload.
          t.reload = Math.max(t.reload, t.reloadTotal * 0.5);
        }
      }
    }
  }

  // ---------- Simulation ----------
  tick() {
    if (this.over) return this.broadcast();
    this.time += DT;
    const t = this.tank;
    if (t.dead) {
      if (this.time >= t.respawnAt) {
        t.respawn();
        this.events.push({ k: 'spawn', u: t.id });
      }
    } else {
      this.driveTank(t);
      this.aimTurret(t);
      this.updateWeapons(t);
    }
    this.army.update(DT);
    // Remove NPC corpses / wrecks after a while.
    this.units = this.units.filter((u) => u.player || !u.dead || this.time - u.diedAt < (u.kind === 'tank' ? 30 : 6));
    this.updateProjectiles();
    this.updateCapture();
    this.updateTickets();
    // Ping expires after its lifetime or once the tank reaches it.
    if (this.ping) {
      const reached = Math.hypot(this.tank.x - this.ping.x, this.tank.z - this.ping.z) < PING.reachRadius;
      if (reached || this.time - this.ping.t0 > PING.lifetime) this.ping = null;
    }
    this.broadcast();
  }

  // Module effects that tick over time: engine fire, repairs, NPC field fixes.
  updateModules(t) {
    const m = t.mods;
    if (t.burning > 0) {
      t.burning -= DT;
      this.damage(t, 14 * DT, { owner: t.lastHitBy ?? t.id });
      m.engine = Math.max(0, m.engine - 0.03 * DT);
    }
    if (!t.player) {
      // AI crews patch things up on their own, slowly.
      for (const k in m) m[k] = Math.min(1, m[k] + 0.04 * DT);
      return;
    }
    // Driver repair: hold R while (nearly) stopped. Fixes the most damaged module.
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

  // Which module a hit lands on, from the local hit point on the hull box.
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
    if (Math.random() < 0.12) mod = 'radar'; // spalling wrecks the electronics
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
    // Repairing locks the controls; dead tracks or engine stop the tank.
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
    // Boost meter: 4 s of boost, recharges in ~12 s.
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

    // Tracks: steering slows at speed; reversing keeps "A = hull rotates left".
    const speedFrac = Math.min(1, Math.abs(t.v) / s.maxSpeed);
    t.h = wrapAngle(t.h + d.st * s.turnRate * (1 - 0.35 * speedFrac) * DT * (d.brake ? 0.6 : 1));

    const nx = t.x + Math.sin(t.h) * t.v * DT;
    const nz = t.z + Math.cos(t.h) * t.v * DT;
    // Tanks run over enemy infantry in their path.
    if (Math.abs(t.v) > 2) {
      for (const u of this.units) {
        if (u.kind !== 'inf' || u.dead || u.team === t.team) continue;
        if (Math.abs(u.x - nx) < 4 && Math.abs(u.z - nz) < 4 && Math.hypot(u.x - nx, u.z - nz) < t.radius * 0.6) this.damage(u, 999, { owner: t.id });
      }
    }
    if (this.blocked(t, nx, nz)) {
      t.v *= -0.15; // thud
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
    // Cliffs: too steep a step between current and next ground height.
    const step = groundAt(nx, nz) - groundAt(t.x, t.z);
    const dist = Math.hypot(nx - t.x, nz - t.z) || 1e-6;
    if (step / dist > 0.9) return true;
    const r = t.radius * 0.72;
    for (const p of propsNear(nx, nz, r + 2)) {
      if (!p.solid || this.propDead.has(p.id)) continue;
      // Only block moving deeper in, so a tank that spawns touching a wall can back out.
      if (circleHitsProp(p, nx, nz, r) && !circleHitsProp(p, t.x, t.z, r)) return true;
    }
    for (const u of this.units) {
      if (u === t || u.kind === 'inf') continue;
      const rr = (u.radius + t.radius) * 0.72;
      const dNew = Math.hypot(u.x - nx, u.z - nz);
      if (dNew < rr && dNew < Math.hypot(u.x - t.x, u.z - t.z)) return true;
    }
    return false;
  }

  aimTurret(t) {
    const s = t.spec;
    // A damaged turret ring traverses slowly; a destroyed one barely moves.
    const ring = t.mods ? (t.mods.turret <= 0 ? 0.08 : 0.35 + 0.65 * t.mods.turret) : 1;
    const maxStep = s.turretSpeed * ring * DT;
    const want = wrapAngle(t.aim.yaw - t.h);
    const diff = wrapAngle(want - t.ty);
    t.ty = wrapAngle(t.ty + Math.max(-maxStep, Math.min(maxStep, diff)));
    // Elevation target is world pitch minus the hull's slope along the turret direction.
    const worldYaw = t.h + t.ty;
    const wantElev = t.aim.pitch - planePitchAlong(t.pose.up, worldYaw);
    const elev = Math.max(s.elevation.min, Math.min(s.elevation.max, wantElev));
    const eStep = s.turretSpeed * 0.6 * DT;
    t.gp += Math.max(-eStep, Math.min(eStep, elev - t.gp));
  }

  updateWeapons(t) {
    const w = t.spec.weapon;
    t.reload = Math.max(0, t.reload - DT);
    t.fireCd = Math.max(0, t.fireCd - DT);
    t.coaxCd = Math.max(0, t.coaxCd - DT);
    // Destroyed gun: main gun can't fire (coax still works).
    if (t.mods?.gun <= 0) {
      t.fireQueued = false;
      t.trigger = { ...t.trigger, main: false };
    }

    if (w.kind === 'autocannon') {
      if (t.mag === 0 && t.reload === 0) t.mag = w.magazine;
      if (t.trigger.main && t.reload === 0 && t.fireCd === 0 && t.mag > 0) {
        this.fire(t, { kind: 'ac', damage: w.damage, speed: w.speed, splash: w.splash, splashDamage: w.damage * 0.3, spread: w.spread });
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

  // Tanks fire from their muzzle; other units pass an explicit origin + direction.
  fire(t, p, origin = null, direction = null) {
    const { pos, dir } = origin ? { pos: origin, dir: direction } : muzzlePose(t.spec, t.pose, t.x, t.z, t.ty, t.gp);
    // Random cone spread, much worse with a damaged gun.
    const gunMul = t.mods && p.kind !== 'mg' ? 1 + 4 * (1 - t.mods.gun) : 1;
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
      life: p.kind === 'rocket' ? 2 : 4,
    };
    this.projectiles.push(proj);
    this.events.push({ k: 'f', id: proj.id, o: t.id, kind: p.kind, x: r2(pos.x), y: r2(pos.y), z: r2(pos.z), vx: r2(proj.vx), vy: r2(proj.vy), vz: r2(proj.vz) });
  }

  updateProjectiles() {
    const keep = [];
    for (const p of this.projectiles) {
      p.life -= DT;
      const x0 = p.x, y0 = p.y, z0 = p.z;
      if (p.kind !== 'rocket') p.vy -= GRAVITY * DT; // rockets fly flat under thrust
      const x1 = x0 + p.vx * DT, y1 = y0 + p.vy * DT, z1 = z0 + p.vz * DT;
      const hit = this.traceSegment(p, x0, y0, z0, x1, y1, z1);
      if (hit) {
        this.impact(p, hit);
        continue;
      }
      p.x = x1;
      p.y = y1;
      p.z = z1;
      if (p.life > 0 && Math.abs(p.x) < 800 && Math.abs(p.z) < 800) keep.push(p);
    }
    this.projectiles = keep;
  }

  // Returns the first thing the segment hits: a unit's hull box, the ground, or water.
  traceSegment(p, x0, y0, z0, x1, y1, z1) {
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    const len = Math.hypot(dx, dy, dz);
    let best = null;

    for (const u of this.units) {
      if (u.dead || u.id === p.owner) continue;
      // Broad phase: distance from unit centre to segment.
      const cx = u.x - x0, cy = u.pose.y + 1 - y0, cz = u.z - z0;
      const t = Math.max(0, Math.min(1, (cx * dx + cy * dy + cz * dz) / (len * len)));
      const ex = cx - dx * t, ey = cy - dy * t, ez = cz - dz * t;
      if (ex * ex + ey * ey + ez * ez > (u.radius + 1) ** 2) continue;
      const h = this.boxHit(u, x0, y0, z0, dx, dy, dz);
      if (h && (!best || h.t < best.t)) best = h;
    }

    // Buildings and other solid props.
    for (const pr of propsNear(x0 + dx / 2, z0 + dz / 2, len / 2 + 12)) {
      if (!pr.solid || this.propDead.has(pr.id)) continue;
      const t = segmentHitsProp(pr, x0, y0, z0, dx, dy, dz);
      if (t !== null && (!best || t < best.t)) best = { t, x: x0 + dx * t, y: y0 + dy * t, z: z0 + dz * t, prop: pr, surface: 'prop' };
    }

    // Terrain: march the segment in ~3 m steps.
    const steps = Math.max(1, Math.ceil(len / 3));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (best && t > best.t) break;
      const x = x0 + dx * t, y = y0 + dy * t, z = z0 + dz * t;
      const g = groundAt(x, z);
      const surface = Math.max(g, WATER_LEVEL);
      if (y <= surface) {
        // Refine between previous step and this one.
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

  // Ray (segment) vs oriented hull box. Hull frame: X=left, Y=up, Z=forward (heading only).
  boxHit(u, x0, y0, z0, dx, dy, dz) {
    const s = u.spec.size;
    const c = Math.cos(u.h), sn = Math.sin(u.h);
    // world -> local: left = (cos h, 0, -sin h), fwd = (sin h, 0, cos h)
    const ox = x0 - u.x, oy = y0 - u.pose.y, oz = z0 - u.z;
    const o = [ox * c - oz * sn, oy, ox * sn + oz * c];
    const d = [dx * c - dz * sn, dy, dx * sn + dz * c];
    const min = [-s.width / 2, 0.2, -s.length / 2];
    const max = [s.width / 2, s.height, s.length / 2];
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
    if (axis < 0) return null; // started inside
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
      const kinetic = p.kind !== 'he' && p.kind !== 'rocket';
      // Glancing hits on angled armor can ricochet (infantry have no armor to bounce off).
      if (u.kind !== 'inf' && kinetic && p.kind !== 'mg' && p.kind !== 'rifle' && hit.face !== 'top' && hit.cosInc < 0.3 && Math.random() < 0.75) {
        ev.r = 'ric';
        this.damage(u, p.damage * 0.08, p);
      } else {
        const armor = u.spec.armor[hit.face === 'top' ? 'rear' : hit.face];
        const angleMul = kinetic && u.kind !== 'inf' ? 0.6 + 0.4 * hit.cosInc : 1;
        // Small arms barely scratch armor; big guns obliterate infantry.
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
  }

  splash(x, y, z, radius, amount, owner, skipUnit = null, skipProp = null) {
    for (const u of this.units) {
      if (u.dead || u === skipUnit) continue;
      const d = Math.hypot(u.x - x, u.pose.y + 1 - y, u.z - z) - u.radius * 0.5;
      // Infantry are far more vulnerable to blast than armor; cover helps them.
      const mul = u.kind === 'inf' ? (u.ai?.inCover ? 0.8 : 1.6) : 0.6;
      if (d < radius) this.damage(u, amount * (1 - Math.max(0, d) / radius) * mul, { owner });
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
    // Infantry dug in behind cover shrug off half of direct fire.
    if (u.kind === 'inf' && u.ai?.inCover && Math.random() < 0.5) return;
    u.hp -= amount;
    if (u.hp <= 0) {
      u.hp = 0;
      u.dead = true;
      u.v = 0;
      u.diedAt = this.time;
      if (u.player) u.respawnAt = this.time + 15;
      this.events.push({ k: 'k', u: u.id, by: p.owner, team: u.team, type: u.type });
      const shooter = this.units.find((x) => x.id === p.owner);
      if (shooter?.player && u.team !== shooter.team) this.stats.kills++;
      const cost = u.player ? MATCH.deathCost.player : MATCH.deathCost[u.kind] ?? 1;
      this.tickets[u.team] = Math.max(0, this.tickets[u.team] - cost);
    }
  }

  // ---------- Capture points ----------
  updateCapture() {
    for (const pt of this.points) {
      const def = POINTS.find((p) => p.id === pt.id);
      const weight = { blue: 0, red: 0 };
      let usInside = false;
      for (const u of this.units) {
        if (u.dead || u.kind === 'atgun') continue;
        if (Math.abs(u.x - def.x) > def.r || Math.abs(u.z - def.z) > def.r) continue;
        if (Math.hypot(u.x - def.x, u.z - def.z) > def.r) continue;
        weight[u.team] += u.player ? MATCH.capWeight.player : MATCH.capWeight[u.kind] ?? 1;
        if (u.player) usInside = true;
      }
      pt.contested = weight.blue > 0 && weight.red > 0;
      if (pt.contested || (weight.blue === 0 && weight.red === 0)) continue;
      const team = weight.blue > 0 ? 'blue' : 'red';
      const dir = team === 'blue' ? 1 : -1;
      const rate = Math.min(6, weight[team]) * MATCH.capRate * DT;
      const before = pt.progress;
      pt.progress = Math.max(-1, Math.min(1, pt.progress + dir * rate));
      // Crossing zero neutralises; reaching ±1 captures.
      if (pt.owner && Math.sign(pt.progress) !== Math.sign(before) && Math.sign(before) !== 0) {
        this.events.push({ k: 'cap', id: pt.id, team: null, prev: pt.owner });
        pt.owner = null;
      }
      if (!pt.owner && Math.abs(pt.progress) >= 1) {
        pt.owner = team;
        this.events.push({ k: 'cap', id: pt.id, team });
        if (team === 'blue' && usInside) this.stats.captures++;
      }
    }
  }

  updateTickets() {
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
      const blueWins = this.tickets.red <= 0 || (timeUp && this.tickets.blue > this.tickets.red);
      this.over = true;
      this.room.broadcast({ t: 'matchEnd', victory: blueWins, time: this.time, kills: this.stats.kills, captures: this.stats.captures, tickets: this.tickets });
    }
  }

  // ---------- Networking ----------
  broadcast() {
    const t = this.tank;
    const snap = {
      t: 's',
      time: r3(this.time),
      me: {
        id: t.id,
        v: r2(t.v),
        boost: r2(t.boost),
        reload: r2(t.reload),
        reloadTotal: t.reloadTotal,
        mag: t.mag,
        shell: t.shell,
        coax: t.coaxBelt,
        coaxReload: r2(t.coaxReload),
        dead: t.dead,
        respawnIn: t.dead ? r2(t.respawnAt - this.time) : 0,
        hp: Math.round(t.hp),
        drive: t.drive,
        mods: Object.fromEntries(Object.entries(t.mods).map(([k, v]) => [k, r2(v)])),
        burning: t.burning > 0,
        repair: t.repair && { mod: t.repair.mod, p: r2(t.repair.t / t.repair.total) },
        ping: this.ping && { id: this.ping.id, x: r2(this.ping.x), z: r2(this.ping.z), age: r2(this.time - this.ping.t0) },
        pingCd: r2(Math.max(0, this.pingReadyAt - this.time)),
      },
      u: this.units.map((u) => [u.id, TEAM_CODE[u.team], TYPE_CODE[u.type], r2(u.x), r2(u.z), r3(u.h), r3(u.ty), r3(u.gp), r2(u.hp / u.spec.hp), u.dead ? 1 : 0, u.player ? 1 : 0]),
      pts: this.points.map((p) => [p.id, p.owner ? TEAM_CODE[p.owner] : -1, r2(p.progress), p.contested ? 1 : 0]),
      tk: [this.tickets.blue, this.tickets.red],
      left: Math.max(0, Math.round(MATCH.duration - this.time)),
    };
    // Full destroyed-prop list on change and periodically (covers late joins / lost events).
    if (this.propsDirty || Math.round(this.time * TICK_RATE) % 40 === 0) {
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
