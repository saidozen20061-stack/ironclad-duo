import { Vector3 } from 'three';
import { TICK_RATE } from '../../../shared/constants.js';
import { groundAt } from '../../../shared/map.js';
import { ATGun } from './ai.js';
import { passable } from './nav.js';

// Story mode stages, run on top of the normal battle simulation. The stage (client/src/story/stages.js)
// says where the player starts, who's on the field and what has to happen; nothing else spawns.
// The player is always Blue.

const DT = 1 / TICK_RATE;
const LIVES = 3; // tanks a crew can lose before the stage is lost
const REACH = 30; // m: close enough to a place to count as there
const rand = (a, b) => a + Math.random() * (b - a);
// Friendly NPCs are there to help, not to win it for the crew.
const ALLY = { hp: 0.6, damage: 0.5 };

// The nearest spot a unit can stand on: a stage's positions are rounded, and buildings move about.
function snap(x, z, cls = 'tank') {
  for (let r = 0; r <= 60; r += 4) for (let k = 0; k < (r ? 12 : 1); k++) {
    const a = (k / 12) * Math.PI * 2, nx = x + Math.cos(a) * r, nz = z + Math.sin(a) * r;
    if (passable(cls, nx, nz)) return [nx, nz];
  }
  return [x, z];
}

// What a kill counts as on the results screen.
export const KILL_CLASS = { t26: 'light', light: 'light', scout: 'light', wheeled: 'light', medium: 'medium', destroyer: 'medium', aa: 'medium', flak: 'medium', heavy: 'heavy', assault: 'heavy', superheavy: 'heavy', rifle: 'inf', rocket: 'inf', crew: 'inf', atgun: 'atgun' };

const OBJECTIVE_TEXT = {
  destroy: 'Destroy all enemy forces',
  capture: 'Capture and hold the objective',
  defend: 'Hold the position until relieved',
  escort: 'Get the convoy through',
  reach: 'Break through to the marked area',
  targets: 'Destroy the marked targets',
  waves: 'Survive every wave',
};

// `story`: { stage, spec (the story tank's stats with its parts), specials (supplies brought along) }.
export function installStory(m, { stage, spec, specials = {} }) {
  const crew = [...m.crews.values()][0];
  const s = { stage, lives: LIVES, deaths: 0, kills: {}, shots: 0, hits: 0, pending: false, shotAt: 0, minHp: 1, wave: -1, hostile: [], targets: [], escorts: [], allies: new Set(), boss: null, holdT: 0, over: false };
  m.story = s;

  // The player's tank, or plane, where the stage puts it.
  const place = (u) => {
    const [x, z] = snap(stage.start[0], stage.start[1]);
    const h = stage.start[2];
    if (u.kind === 'tank') {
      Object.assign(u, { x, z, h });
      u.spawn = { x, z, h };
      u.aim.yaw = h;
    }
  };
  place(crew.tank);
  // The story tank: its own stats on the model it's built on. Respawns keep them.
  if (spec && crew.tank.kind === 'tank') {
    const t = crew.tank;
    t.spec = spec;
    t.hp = spec.hp;
    t.reloadTotal = spec.weapon.reload;
    t.mag = spec.weapon.magazine ?? 1;
    t.coaxBelt = spec.weapon.coax?.belt ?? 0;
  }
  const kit = { repair: !!specials.repair, smoke: !!specials.smoke };

  const spawnGroup = (g) => {
    const team = g.team ?? 'red';
    const [cx, cz] = g.kind === 'plane' ? g.at : snap(g.at[0], g.at[1], g.kind === 'inf' ? 'inf' : 'tank');
    const out = [];
    const face = Math.atan2(stage.start[0] - cx, stage.start[1] - cz) * (team === 'red' ? 1 : 0) + (team === 'red' ? 0 : stage.start[2]);
    for (let i = 0; i < (g.n ?? 1); i++) {
      let x = cx + rand(-1, 1) * (g.spread ?? 14), z = cz + rand(-1, 1) * (g.spread ?? 14);
      if (g.kind !== 'plane') [x, z] = snap(x, z, g.kind === 'inf' ? 'inf' : 'tank');
      if (g.kind === 'inf') out.push(...m.army.spawnSquadAt(team, x, z, g.size ?? 4, g.go ?? null));
      else if (g.kind === 'atgun') {
        const gun = new ATGun(team, x, z, face, { gun: null });
        m.units.push(gun);
        out.push(gun);
      } else if (g.kind === 'plane') {
        const air = m.planes.airStart;
        m.planes.airStart = true;
        const p = m.planes.spawnNpc(team, g.role ?? 'attack', g.type);
        m.planes.airStart = air;
        if (p) {
          // In from the far edge of the stage, towards the player.
          Object.assign(p, { x, z, h: face, y: groundAt(x, z) + rand(120, 180) });
          out.push(p);
        }
      } else {
        const t = m.army.spawnTankAt(team, g.type, x, z, face, g.go ?? null);
        if (g.boss) {
          t.spec = { ...t.spec, hp: Math.round(t.spec.hp * g.boss.hp) };
          t.hp = t.spec.hp;
          t.boss = g.boss.name;
          s.boss = t;
        }
        out.push(t);
      }
    }
    for (const u of out) {
      if (g.ally) {
        s.allies.add(u.id);
        u.spec = { ...u.spec, hp: Math.round(u.spec.hp * ALLY.hp) };
        u.hp = u.spec.hp;
      }
      if (team === 'red') s.hostile.push(u);
      if (g.target) s.targets.push(u);
      if (g.escort) s.escorts.push(u);
    }
  };
  const nextWave = () => {
    s.wave++;
    for (const g of stage.groups) if ((g.wave ?? 0) === s.wave) spawnGroup(g);
  };
  const lastWave = Math.max(0, ...stage.groups.map((g) => g.wave ?? 0));
  nextWave();
  // Units with nobody left to fight still count once they're on the field.
  const alive = (list) => list.filter((u) => !u.dead && m.units.includes(u));

  // Kills, and main-gun shots and hits, for the results screen. A shot counts as a hit when it damages
  // an enemy within a few seconds, splash included: shells don't carry their own id into a blast.
  m.onKill = (u, shooter) => {
    if (!shooter.player) return;
    const k = u.boss ? 'boss' : u.kind === 'plane' ? 'plane' : KILL_CLASS[u.type] ?? 'inf';
    s.kills[k] = (s.kills[k] ?? 0) + 1;
  };
  const fire = m.fire.bind(m);
  m.fire = (owner, shell, ...rest) => {
    if (owner?.player && shell.kind !== 'mg') {
      s.shots++;
      s.pending = true;
      s.shotAt = m.time;
    }
    return fire(owner, shell, ...rest);
  };
  const damage = m.damage.bind(m);
  m.damage = (u, amount, p) => {
    const me = crew.tank;
    if (s.allies.has(p?.owner)) amount *= ALLY.damage;
    if (s.pending && p?.owner === me.id && u.team !== me.team && !u.dead && m.time - s.shotAt < 3) {
      s.hits++;
      s.pending = false;
    }
    const was = u.dead;
    damage(u, amount, p);
    if (u === me && !was) {
      const frac = Math.max(0, u.hp) / u.spec.hp;
      // Supplies: smoke when the armour's half gone, a patch-up when it's nearly gone.
      if (!u.dead && kit.smoke && frac < 0.5) {
        kit.smoke = false;
        m.smokeZones.push({ x: u.x, z: u.z, r: 22, until: m.time + 15 });
        m.events.push({ k: 'kit', what: 'smoke', u: u.id, x: Math.round(u.x), z: Math.round(u.z) });
      }
      if (!u.dead && kit.repair && frac < 0.3) {
        kit.repair = false;
        u.hp = Math.round(u.spec.hp * 0.6);
        m.events.push({ k: 'kit', what: 'repair', u: u.id });
      }
      s.minHp = Math.min(s.minHp, frac);
      if (u.dead) {
        s.deaths++;
        s.lives--;
      }
    }
  };

  const end = (win, reason) => {
    if (s.over) return;
    s.over = true;
    m.endMatch(win ? 'blue' : 'red', reason);
  };

  m.modeTick = () => {
    const me = crew.tank;
    if (s.lives <= 0 && me.dead) return end(false, 'Your crew has no tanks left');
    const timeLeft = stage.time ? stage.time - m.time : Infinity;
    const hostile = alive(s.hostile);
    switch (stage.obj) {
      case 'destroy':
      case 'waves':
        if (!hostile.length) {
          if (s.wave >= lastWave) return end(true, stage.obj === 'waves' ? 'Every wave beaten back' : 'All enemy forces destroyed');
          nextWave();
        }
        break;
      case 'targets':
        if (!alive(s.targets).length) return end(true, 'All targets destroyed');
        break;
      case 'capture': {
        const ours = stage.points.every((id) => m.points.find((p) => p.id === id)?.owner === 'blue');
        s.holdT = ours ? s.holdT + DT : 0;
        if (s.holdT >= (stage.hold ?? 20)) return end(true, 'Objective captured and held');
        break;
      }
      case 'defend':
        if (stage.points.some((id) => m.points.find((p) => p.id === id)?.owner === 'red')) return end(false, 'The position fell');
        if (timeLeft <= 0) return end(true, 'The position held');
        // Fresh attackers whenever one wave is beaten, until time's up.
        if (!hostile.length && s.wave < lastWave) nextWave();
        break;
      case 'escort': {
        const left = alive(s.escorts);
        if (!left.length) return end(false, 'The convoy was destroyed');
        const [x, z, r] = stage.dest;
        if (left.some((u) => Math.hypot(u.x - x, u.z - z) < (r ?? REACH))) return end(true, 'The convoy got through');
        break;
      }
      case 'reach': {
        const [x, z, r] = stage.dest;
        if (!me.dead && Math.hypot(me.x - x, me.z - z) < (r ?? REACH)) return end(true, 'You broke through');
        break;
      }
    }
    if (stage.obj !== 'defend' && timeLeft <= 0) return end(false, 'Out of time');
    if (stage.arty) artillery();
  };

  // Enemy guns ranging in on the player's area.
  let artyT = 8;
  const artillery = () => {
    artyT -= DT;
    if (artyT > 0) return;
    artyT = rand(6, 11);
    const me = crew.tank;
    for (let i = 0; i < 3; i++) {
      const tx = me.x + rand(-35, 35), tz = me.z + rand(-35, 35);
      const origin = new Vector3(tx + rand(-20, 20), groundAt(tx, tz) + 240, tz + 60);
      const dir = new Vector3(tx, groundAt(tx, tz), tz).sub(origin).normalize();
      m.fire({ id: -1, team: 'red' }, { kind: 'heavy', damage: 160, speed: 210, splash: 8, splashDamage: 120, spread: 0.02 }, origin, dir);
    }
  };

  m.modeSnapshot = (snap) => {
    const hostile = alive(s.hostile).length;
    let progress = '';
    if (stage.obj === 'destroy' || stage.obj === 'waves') progress = `${hostile} enemies left${lastWave ? ` · wave ${s.wave + 1} of ${lastWave + 1}` : ''}`;
    else if (stage.obj === 'targets') progress = `${alive(s.targets).length} targets left`;
    else if (stage.obj === 'capture') progress = s.holdT > 0 ? `Holding: ${Math.ceil((stage.hold ?? 20) - s.holdT)} s` : 'Take the objective';
    else if (stage.obj === 'escort') progress = `${alive(s.escorts).length} vehicles in the convoy`;
    const left = stage.time ? Math.max(0, Math.ceil(stage.time - m.time)) : null;
    snap.story = { o: stage.objText ?? OBJECTIVE_TEXT[stage.obj], p: progress, t: left, l: s.lives, b: s.boss && !s.boss.dead ? [s.boss.boss, Math.round((s.boss.hp / s.boss.spec.hp) * 100)] : null };
  };

  m.storyResult = () => ({ stage: stage.id, kills: s.kills, shots: s.shots, hits: s.hits, deaths: s.deaths, minHp: +s.minHp.toFixed(2), time: Math.round(m.time) });
}
