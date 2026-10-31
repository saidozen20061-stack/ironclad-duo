// NPC armies: infantry squads, AI tanks and anti-tank guns, plus wave spawning.
// Each unit runs a small state machine: move to objective -> find cover -> engage
// nearest enemy -> retreat when badly hurt.

import { Vector3 } from 'three';
import { UNITS, MATCH, TANKS } from '../../../shared/constants.js';
import { POINTS, BASES, groundAt, heightAt, WATER_LEVEL } from '../../../shared/map.js';
import { PROPS, propsNear, circleHitsProp } from '../../../shared/props.js';
import { wrapAngle, planePitchAlong, muzzlePose } from '../../../shared/tank.js';
import { nextWaypoint, passable, distanceTo } from './nav.js';

const GRAVITY = 9.81;
const rand = (a, b) => a + Math.random() * (b - a);
const ENEMY = { blue: 'red', red: 'blue' };
const COVER = PROPS.filter((p) => p.cover);

// ---------- Helpers ----------

export function lineOfSight(ax, ay, az, bx, by, bz) {
  const d = Math.hypot(bx - ax, bz - az);
  const steps = Math.max(4, Math.min(24, Math.ceil(d / 15)));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = ax + (bx - ax) * t, z = az + (bz - az) * t, y = ay + (by - ay) * t;
    if (heightAt(x, z) > y) return false;
  }
  return true;
}

// Pitch needed to hit a target at horizontal distance d and height difference dy.
function ballisticPitch(d, dy, speed) {
  const v2 = speed * speed;
  const disc = v2 * v2 - GRAVITY * (GRAVITY * d * d + 2 * dy * v2);
  if (disc < 0) return Math.atan2(dy, d) + 0.05;
  return Math.atan((v2 - Math.sqrt(disc)) / (GRAVITY * d));
}

export function unitHeight(u) {
  return u.kind === 'tank' ? u.pose.y + 1.4 : u.pose.y + (u.kind === 'inf' ? 1.3 : 1.0);
}

function chooseObjective(match, u) {
  const team = u.team;
  const cls = u.kind === 'tank' ? 'tank' : 'inf';
  const notOurs = match.points.filter((p) => p.owner !== team);
  const pool = notOurs.length ? notOurs : match.points;
  let best = null;
  let bestD = Infinity;
  for (const p of pool) {
    // Spread the army a bit: random bias so not everyone takes the same point.
    const d = distanceTo(cls, p.id, u.x, u.z) * rand(0.8, 1.25);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best?.id ?? 'B';
}

// ---------- Unit classes for non-tank NPCs ----------

let nextId = 100000;

export class Infantry {
  constructor(team, type, x, z) {
    this.id = nextId++;
    this.kind = 'inf';
    this.team = team;
    this.type = type; // 'rifle' | 'rocket'
    this.spec = UNITS[type];
    this.x = x;
    this.z = z;
    this.h = team === 'blue' ? 0 : Math.PI;
    this.ty = 0; // 0 standing, 1 crouched (sent to clients for the pose)
    this.gp = 0;
    this.hp = this.spec.hp;
    this.dead = false;
    this.radius = 0.5;
    this.pose = { y: groundAt(x, z) };
    this.ai = { state: 'move', objective: null, think: rand(0, 0.5), target: null, cover: null, cd: rand(0.5, 2), stuck: 0 };
  }
}

export class ATGun {
  constructor(team, x, z, h, slot) {
    this.id = nextId++;
    this.kind = 'atgun';
    this.team = team;
    this.type = 'atgun';
    this.spec = UNITS.atgun;
    this.x = x;
    this.z = z;
    this.h = h;
    this.ty = 0;
    this.gp = 0;
    this.hp = this.spec.hp;
    this.dead = false;
    this.radius = 1.8;
    this.pose = { y: groundAt(x, z) };
    this.slot = slot;
    this.ai = { think: rand(0, 0.5), target: null, cd: rand(1, 4) };
  }
}

// ---------- AI controller ----------

export class ArmyAI {
  constructor(match) {
    this.match = match;
    this.waveT = { blue: 3, red: 3 };
    this.tankT = { blue: 1, red: 1 };
    // Two AT-gun slots around each capture point.
    this.slots = [];
    for (const p of POINTS) {
      for (const a of [rand(0, 3), rand(3, 6)]) {
        let x = p.x + Math.cos(a) * (p.r + 6);
        let z = p.z + Math.sin(a) * (p.r + 6);
        // Nudge off blocked ground.
        for (let k = 0; k < 8 && !passable('inf', x, z); k++) {
          x = p.x + Math.cos(a + k * 0.4) * (p.r + 6);
          z = p.z + Math.sin(a + k * 0.4) * (p.r + 6);
        }
        this.slots.push({ point: p.id, x, z, gun: null, respawnAt: 0 });
      }
    }
  }

  // ---------- Spawning ----------
  update(dt) {
    const m = this.match;
    for (const team of ['blue', 'red']) {
      this.waveT[team] -= dt;
      this.tankT[team] -= dt;
      const alive = m.units.filter((u) => u.team === team && !u.dead && !u.player && !u.crew);
      const inf = alive.filter((u) => u.kind === 'inf').length;
      const tanks = alive.filter((u) => u.kind === 'tank').length;
      if (this.waveT[team] <= 0) {
        this.waveT[team] = MATCH.waveInterval;
        const room = MATCH.caps.inf - inf;
        if (room >= 3) this.spawnSquad(team, Math.min(room, 6));
      }
      if (this.tankT[team] <= 0) {
        this.tankT[team] = MATCH.waveInterval * 1.6;
        // Blue's player tank counts towards the blue armour cap.
        const cap = MATCH.caps.tank - m.playerTanks(team);
        if (tanks < cap) this.spawnTank(team);
        if (tanks < cap - 2) this.spawnTank(team);
      }
    }
    // AT guns belong to whoever holds the point.
    for (const s of this.slots) {
      const owner = m.points.find((p) => p.id === s.point).owner;
      if (s.gun && (s.gun.dead || !m.units.includes(s.gun))) s.gun = null;
      if (!s.gun && owner) {
        if (!s.respawnAt) s.respawnAt = m.time + 35;
        if (m.time >= s.respawnAt) {
          const pt = POINTS.find((p) => p.id === s.point);
          const enemyBase = BASES[ENEMY[owner]];
          s.gun = new ATGun(owner, s.x, s.z, Math.atan2(enemyBase.x - pt.x, enemyBase.z - pt.z), s);
          m.units.push(s.gun);
          s.respawnAt = 0;
        }
      } else if (!owner) s.respawnAt = 0;
    }
    for (const u of m.units) {
      if (u.dead || u.player || u.crew) continue;
      if (u.kind === 'inf') this.infantry(u, dt);
      else if (u.kind === 'tank') this.tank(u, dt);
      else if (u.kind === 'atgun') this.atgun(u, dt);
    }
  }

  spawnPoint(team, spread = 40) {
    const b = BASES[team];
    const s = team === 'blue' ? 1 : -1;
    for (let k = 0; k < 10; k++) {
      const x = b.x + rand(-spread, spread);
      const z = b.z + s * rand(10, 40);
      if (passable('tank', x, z)) return [x, z];
    }
    return [b.x, b.z + s * 20];
  }

  spawnSquad(team, n) {
    const [cx, cz] = this.spawnPoint(team);
    const objective = chooseObjective(this.match, { team, kind: 'inf', x: cx, z: cz });
    for (let i = 0; i < n; i++) {
      const type = i === 0 || (i === 3 && Math.random() < 0.5) ? 'rocket' : 'rifle';
      const u = new Infantry(team, type, cx + rand(-6, 6), cz + rand(-6, 6));
      u.ai.objective = objective;
      this.match.units.push(u);
    }
  }

  spawnTank(team) {
    // Weighted mix of every tank class; the big ones are rarer.
    const mix = [['light', 18], ['medium', 26], ['heavy', 12], ['scout', 10], ['wheeled', 10], ['destroyer', 9], ['aa', 8], ['assault', 5], ['superheavy', 2]];
    let r = Math.random() * mix.reduce((a, [, w]) => a + w, 0);
    let type = 'medium';
    for (const [id, w] of mix) if ((r -= w) <= 0) {
      type = id;
      break;
    }
    const [x, z] = this.spawnPoint(team, 60);
    const t = this.match.createTank(team, type, x, z, BASES[team].heading);
    t.ai = { state: 'move', objective: chooseObjective(this.match, t), think: rand(0, 0.5), target: null, stuckT: 0, reverseT: 0, lastPos: [x, z] };
    this.match.units.push(t);
  }

  // ---------- Shared targeting ----------
  findTarget(u, range, prefer) {
    const m = this.match;
    const ux = u.x, uy = unitHeight(u), uz = u.z;
    let best = null;
    let bestScore = Infinity;
    for (const e of m.units) {
      if (e.dead || e.team === u.team) continue;
      const d = Math.hypot(e.x - ux, e.z - uz);
      if (d > range) continue;
      let score = d;
      if (prefer === 'armor' && e.kind === 'inf') score += 400;
      if (prefer === 'soft' && e.kind !== 'inf') score += d < 60 ? 80 : 1000;
      if (e.player) score *= 0.85; // the human crew draws fire
      if (score >= bestScore) continue;
      if (!lineOfSight(ux, uy, uz, e.x, unitHeight(e), e.z)) continue;
      best = e;
      bestScore = score;
    }
    return best;
  }

  // ---------- Infantry ----------
  infantry(u, dt) {
    const m = this.match;
    const ai = u.ai;
    const w = u.spec.weapon;
    ai.think -= dt;
    ai.cd -= dt;
    if (ai.think <= 0) {
      ai.think = rand(0.4, 0.7);
      if (ai.target && (ai.target.dead || !m.units.includes(ai.target))) ai.target = null;
      ai.target = this.findTarget(u, w.range, w.kind === 'rocket' ? 'armor' : 'soft');
      if (u.hp < 35 && ai.state !== 'retreat') {
        ai.state = 'retreat';
        ai.cover = null;
      } else if (ai.state === 'retreat' && u.hp >= 35) ai.state = 'move';
      if (ai.state !== 'retreat') {
        const objPt = m.points.find((p) => p.id === ai.objective);
        if (!objPt || (objPt.owner === u.team && Math.random() < 0.08)) ai.objective = chooseObjective(m, u);
        if (ai.target) {
          if (!ai.cover) ai.cover = this.findCover(u, ai.target);
          ai.state = ai.cover ? 'cover' : 'engage';
        } else {
          ai.cover = null;
          const pt = POINTS.find((p) => p.id === ai.objective);
          ai.state = pt && Math.hypot(pt.x - u.x, pt.z - u.z) < pt.r * 0.8 ? 'hold' : 'move';
        }
      }
    }

    // Movement
    let goal = null;
    if (ai.state === 'move') goal = nextWaypoint('inf', ai.objective, u.x, u.z, 2);
    else if (ai.state === 'retreat') goal = nextWaypoint('inf', u.team, u.x, u.z, 2);
    else if (ai.state === 'cover' && ai.cover) goal = ai.cover;
    else if (ai.state === 'hold' && !ai.holdSpot) {
      const pt = POINTS.find((p) => p.id === ai.objective);
      const a = rand(0, Math.PI * 2);
      ai.holdSpot = { x: pt.x + Math.cos(a) * rand(5, pt.r * 0.7), z: pt.z + Math.sin(a) * rand(5, pt.r * 0.7) };
    }
    if (ai.state === 'hold') goal = ai.holdSpot;
    else ai.holdSpot = null;

    let moving = false;
    if (goal) {
      const dx = goal.x - u.x, dz = goal.z - u.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.8) {
        const sp = u.spec.speed * (ai.state === 'retreat' || ai.state === 'cover' ? 1.25 : 1) * (heightAt(u.x, u.z) < WATER_LEVEL ? 0.45 : 1);
        const step = Math.min(d, sp * dt);
        let nx = u.x + (dx / d) * step, nz = u.z + (dz / d) * step;
        // Separation from squadmates so they don't stack.
        for (const o of propsNearUnits(m, u)) {
          const ox = nx - o.x, oz = nz - o.z;
          const od = Math.hypot(ox, oz);
          if (od > 0 && od < 1.4) {
            nx += (ox / od) * 0.3 * dt * 4;
            nz += (oz / od) * 0.3 * dt * 4;
          }
        }
        if (this.infBlocked(nx, nz)) {
          // Slide along whichever axis is free.
          if (!this.infBlocked(nx, u.z)) nz = u.z;
          else if (!this.infBlocked(u.x, nz)) nx = u.x;
          else {
            nx = u.x;
            nz = u.z;
          }
        }
        if (nx !== u.x || nz !== u.z) {
          u.h = Math.atan2(nx - u.x, nz - u.z);
          u.x = nx;
          u.z = nz;
          u.pose.y = groundAt(u.x, u.z);
          moving = true;
        }
      } else if (ai.state === 'cover') ai.inCover = true;
    }
    if (ai.state !== 'cover') ai.inCover = false;
    u.ty = !moving && (ai.state === 'engage' || ai.inCover || ai.state === 'hold') ? 1 : 0;

    // Shooting: only when not sprinting to cover / retreating.
    const t = ai.target;
    if (t && !t.dead && ai.state !== 'retreat' && ai.cd <= 0 && (!moving || ai.state === 'engage')) {
      u.h = Math.atan2(t.x - u.x, t.z - u.z);
      const d = Math.hypot(t.x - u.x, t.z - u.z);
      if (d <= w.range) {
        ai.cd = w.interval * rand(0.8, 1.4);
        const ox = u.x, oy = u.pose.y + (u.ty ? 1.0 : 1.5), oz = u.z;
        const ty = unitHeight(t) - 0.2;
        const pitch = ballisticPitch(d, ty - oy, w.speed);
        const yaw = Math.atan2(t.x - ox, t.z - oz);
        // Accuracy degrades with range; rockets are slow so they lead a little.
        const dir = new Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
        m.fire(u, { kind: w.kind, damage: w.damage, speed: w.speed, splash: w.splash ?? 0, splashDamage: w.splashDamage ?? 0, spread: w.spread * (1 + d / 120) }, new Vector3(ox, oy, oz), dir);
      }
    }
  }

  infBlocked(x, z) {
    for (const p of propsNear(x, z, 2)) {
      if (p.solid && !this.match.propDead.has(p.id) && circleHitsProp(p, x, z, 0.4)) return true;
    }
    return heightAt(x, z) < WATER_LEVEL - 1.2;
  }

  findCover(u, threat) {
    let best = null;
    let bestD = 22;
    for (const p of COVER) {
      if (this.match.propDead.has(p.id)) continue;
      const d = Math.hypot(p.x - u.x, p.z - u.z);
      if (d > bestD) continue;
      // Spot on the far side of the cover from the threat.
      const ax = p.x - threat.x, az = p.z - threat.z;
      const al = Math.hypot(ax, az) || 1;
      const off = Math.max(p.w, p.d) / 2 + 1.2;
      const spot = { x: p.x + (ax / al) * off + rand(-1, 1), z: p.z + (az / al) * off + rand(-1, 1) };
      if (this.infBlocked(spot.x, spot.z)) continue;
      best = spot;
      bestD = d;
    }
    return best;
  }

  // ---------- Tanks ----------
  tank(t, dt) {
    const m = this.match;
    const ai = t.ai;
    const w = t.spec.weapon;
    ai.think -= dt;
    if (ai.think <= 0) {
      ai.think = rand(0.4, 0.6);
      ai.target = this.findTarget(t, 420, 'armor');
      if (t.hp < t.spec.hp * 0.25) ai.state = 'retreat';
      else if (ai.state === 'retreat' && t.hp > t.spec.hp * 0.7) ai.state = 'move';
      if (ai.state !== 'retreat') {
        const objPt = m.points.find((p) => p.id === ai.objective);
        if (!objPt || (objPt.owner === t.team && Math.random() < 0.05)) ai.objective = chooseObjective(m, t);
        const pt = POINTS.find((p) => p.id === ai.objective);
        const inZone = Math.hypot(pt.x - t.x, pt.z - t.z) < pt.r * 0.7;
        ai.state = ai.target && Math.hypot(ai.target.x - t.x, ai.target.z - t.z) < 260 ? 'engage' : inZone ? 'hold' : 'move';
      }
      // Stuck detection: trying to move but not getting anywhere.
      const moved = Math.hypot(t.x - ai.lastPos[0], t.z - ai.lastPos[1]);
      ai.lastPos = [t.x, t.z];
      if ((ai.state === 'move' || ai.state === 'retreat') && moved < 0.3 && ai.reverseT <= 0) {
        ai.stuckT += 0.5;
        if (ai.stuckT > 2) {
          ai.reverseT = rand(1.2, 2.2);
          ai.reverseSteer = Math.random() < 0.5 ? -1 : 1;
          ai.stuckT = 0;
        }
      } else ai.stuckT = 0;
    }

    // Driving
    const drive = { th: 0, st: 0, boost: false, brake: false };
    if (ai.reverseT > 0) {
      ai.reverseT -= dt;
      drive.th = -1;
      drive.st = ai.reverseSteer;
    } else {
      const key = ai.state === 'retreat' ? t.team : ai.objective;
      const goal = ai.state === 'engage' || ai.state === 'hold' ? null : nextWaypoint('tank', key, t.x, t.z, 3);
      if (goal) {
        const want = Math.atan2(goal.x - t.x, goal.z - t.z);
        const diff = wrapAngle(want - t.h);
        drive.st = Math.max(-1, Math.min(1, diff * 2));
        drive.th = Math.abs(diff) > 1.0 ? 0.15 : Math.abs(diff) > 0.5 ? 0.5 : 1;
      } else drive.brake = Math.abs(t.v) > 0.5;
    }
    // Casemate guns can't swing far: point the hull at the target instead.
    if (t.spec.traverse && ai.target && !ai.target.dead && ai.state !== 'retreat' && ai.reverseT <= 0) {
      const diff = wrapAngle(Math.atan2(ai.target.x - t.x, ai.target.z - t.z) - t.h);
      if (Math.abs(diff) > t.spec.traverse * 0.7) {
        drive.st = Math.max(-1, Math.min(1, diff * 2));
        drive.th = 0;
        drive.brake = false;
      }
    }
    t.drive = drive;
    if (ai.state === 'retreat' && Math.hypot(BASES[t.team].x - t.x, BASES[t.team].z - t.z) < 80) t.hp = Math.min(t.spec.hp, t.hp + t.spec.hp * 0.03 * dt);
    m.driveTank(t);

    // Gunnery
    const tg = ai.target;
    if (tg && !tg.dead) {
      const { pos } = muzzlePose(t.spec, t.pose, t.x, t.z, t.ty, t.gp);
      const d = Math.hypot(tg.x - pos.x, tg.z - pos.z);
      const speed = w.speed ?? w.shells?.AP.speed ?? 800;
      t.aim.yaw = Math.atan2(tg.x - pos.x, tg.z - pos.z) + (Math.random() - 0.5) * 0.004 * (d / 100);
      t.aim.pitch = ballisticPitch(d, unitHeight(tg) - 0.4 - pos.y, speed);
      if (t.spec.weapon.shells) t.shell = tg.kind === 'inf' ? 'HE' : 'AP';
    } else {
      t.aim.yaw = t.h;
      t.aim.pitch = 0;
    }
    m.aimTurret(t);
    const worldYaw = t.h + t.ty;
    const aligned = tg && !tg.dead && Math.abs(wrapAngle(t.aim.yaw - worldYaw)) < 0.02;
    t.trigger.main = !!aligned;
    if (aligned && t.reload === 0) t.fireQueued = true;
    t.trigger.coax = !!(aligned && tg.kind === 'inf');
    m.updateWeapons(t);
  }

  // ---------- AT guns ----------
  atgun(g, dt) {
    const m = this.match;
    const ai = g.ai;
    const w = g.spec.weapon;
    ai.think -= dt;
    ai.cd -= dt;
    if (ai.think <= 0) {
      ai.think = rand(0.4, 0.7);
      const t = this.findTarget(g, w.range, 'armor');
      ai.target = t && t.kind !== 'inf' ? t : null;
    }
    const tg = ai.target;
    if (!tg || tg.dead) return;
    const want = wrapAngle(Math.atan2(tg.x - g.x, tg.z - g.z) - g.h);
    // Limited traverse: ±60°, otherwise the crew re-lays the whole gun slowly.
    const diff = wrapAngle(want - g.ty);
    const step = g.spec.turretSpeed * dt;
    g.ty = wrapAngle(g.ty + Math.max(-step, Math.min(step, diff)));
    if (Math.abs(g.ty) > 1.05) {
      g.h = wrapAngle(g.h + Math.sign(g.ty) * step * 0.5);
      g.ty -= Math.sign(g.ty) * step * 0.5;
    }
    if (Math.abs(diff) < 0.03 && ai.cd <= 0) {
      ai.cd = w.interval;
      const yaw = g.h + g.ty;
      const ox = g.x + Math.sin(yaw) * 2, oz = g.z + Math.cos(yaw) * 2, oy = g.pose.y + 1.1;
      const d = Math.hypot(tg.x - ox, tg.z - oz);
      const pitch = ballisticPitch(d, unitHeight(tg) - 0.4 - oy, w.speed);
      g.gp = pitch;
      const dir = new Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
      m.fire(g, { kind: 'ap', damage: w.damage, speed: w.speed, splash: w.splash, splashDamage: w.splashDamage, spread: w.spread * (1 + d / 200) }, new Vector3(ox, oy, oz), dir);
    }
  }
}

// Nearby friendly infantry (for separation).
function propsNearUnits(m, u) {
  const out = [];
  for (const o of m.units) {
    if (o === u || o.dead || o.kind !== 'inf' || o.team !== u.team) continue;
    if (Math.abs(o.x - u.x) < 2 && Math.abs(o.z - u.z) < 2) out.push(o);
  }
  return out;
}

export { TANKS };
