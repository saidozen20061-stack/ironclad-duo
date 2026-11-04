import { Vector3 } from 'three';
import { TICK_RATE, MATCH } from '../../../shared/constants.js';
import { FORT, inDepot } from '../../../shared/props.js';
import { groundAt } from '../../../shared/map.js';
import { passable } from './nav.js';

// Game-mode rules layered on top of the shared battle simulation (Match):
//   flags    — the default ticket / capture rules in match.js,
//   tdm      — team points for kills, first to the host's kill limit,
//   fortress — 10 waves of Red attackers against the fortified Blue base.

const DT = 1 / TICK_RATE;
const rand = (a, b) => a + Math.random() * (b - a);
const Team = (t) => (t === 'blue' ? 'Blue' : 'Red');

export function installMode(m) {
  if (m.mode === 'tdm') installTdm(m);
  else if (m.mode === 'fortress') installFortress(m);
}

// ---------- Team Deathmatch ----------
// Player tank = 3 points, NPC tank = 1, infantry = 0. The NPC armies keep fighting, and
// the AI tank cap per team counts player crews, so a team with fewer crews gets more bots.
function installTdm(m) {
  m.onKill = (u, shooter) => {
    const pts = u.player ? 3 : u.kind === 'tank' || u.kind === 'plane' ? 1 : 0;
    if (!pts) return;
    m.score[shooter.team] += pts;
    if (m.score[shooter.team] >= m.killLimit) m.endMatch(shooter.team, `${Team(shooter.team)} reached ${m.killLimit} points`);
  };
  m.modeTick = () => {
    if (m.time < MATCH.duration) return;
    const { blue, red } = m.score;
    m.endMatch(blue === red ? m.leader() : blue > red ? 'blue' : 'red', 'Time is up');
  };
}

// ---------- Fortress Defence ----------
// Each wave: infantry squads plus a tank list. Boss waves add tougher heavies (a striped
// "Tiger-style" Bastion pair, boxy "KV-2-style" Maulers and a Colossus).
const WAVES = [
  { inf: 2, tanks: [] },
  { inf: 3, tanks: ['light'] },
  { inf: 2, tanks: ['light', 'light', 'scout'] },
  { inf: 3, tanks: ['medium', 'medium', 'wheeled'] },
  { inf: 2, tanks: ['medium', 'medium', 'aa'], arty: true },
  { inf: 3, tanks: ['heavy', 'heavy', 'destroyer'] },
  { inf: 3, tanks: ['medium', 'medium', 'medium', 'assault'] },
  { inf: 3, tanks: ['heavy', 'heavy', 'destroyer', 'destroyer'], arty: true },
  { inf: 4, tanks: ['assault', 'assault', 'heavy', 'heavy', 'medium'] },
  { inf: 3, tanks: ['medium', 'medium'], boss: ['heavy', 'heavy', 'assault', 'assault', 'superheavy'], arty: true },
];
export const WAVE_COUNT = WAVES.length;
const FIRST_BREAK = 30;
const BREAK = 20;
const WAVE_LIMIT = 180; // s: the next wave comes anyway, whoever is still out there
const ARTY = { id: -1, team: 'red' }; // off-map Red battery

function installFortress(m) {
  const f = { wave: 0, phase: 'break', until: m.time + FIRST_BREAK, alive: [], arty: false, artyT: 0 };
  m.fort = f;
  // More crews, bigger waves.
  const scale = 1 + 0.35 * (m.crews.size - 1);

  // Attack lanes: straight down from the north, or round the east / west flanks.
  const spot = (lane) => {
    for (let k = 0; k < 20; k++) {
      const [x, z] = lane === 0 ? [rand(-220, 220), rand(-330, -270)] : [(lane === 1 ? 1 : -1) * rand(300, 360), rand(-660, -520)];
      if (passable('tank', x, z)) return [x, z];
    }
    return [0, -300];
  };

  const startWave = () => {
    f.wave++;
    const w = WAVES[f.wave - 1];
    f.phase = 'fight';
    f.until = m.time + WAVE_LIMIT;
    const squads = Math.round(w.inf * scale);
    for (let i = 0; i < squads; i++) {
      const [x, z] = spot(i % 3);
      f.alive.push(...m.army.spawnSquadAt('red', x, z, 6, 'blue'));
    }
    const count = Math.round(w.tanks.length * scale);
    const list = Array.from({ length: count }, (_, i) => w.tanks[i % w.tanks.length]);
    list.forEach((type, i) => {
      const [x, z] = spot(i % 3);
      f.alive.push(m.army.spawnTankAt('red', type, x, z, Math.atan2(FORT.center.x - x, FORT.center.z - z), 'blue'));
    });
    for (const [i, type] of (w.boss ?? []).entries()) {
      const [x, z] = spot(0);
      const t = m.army.spawnTankAt('red', type, x + i * 14, z, Math.PI, 'blue');
      t.spec = { ...t.spec, hp: Math.round(t.spec.hp * 1.6) };
      t.hp = t.spec.hp;
      t.boss = true;
      f.alive.push(t);
    }
    // From wave 3 on the enemy also comes by air: up to two planes at a time, bomber or fighter in turn.
    if (f.wave >= 3 && !m.planes.sideFull('red')) {
      const plane = m.planes.spawnNpc('red', f.wave % 2 ? 'attack' : 'fighter');
      if (plane) f.alive.push(plane);
    }
    f.arty = !!w.arty;
    f.artyT = 10;
    m.events.push({ k: 'wave', n: f.wave, boss: !!w.boss, arty: f.arty });
  };

  // Shells drop on random spots inside the walls.
  const artillery = () => {
    f.artyT -= DT;
    if (f.artyT > 0) return;
    f.artyT = rand(5, 9);
    m.events.push({ k: 'arty' });
    for (let i = 0; i < 3; i++) {
      const tx = rand(-FORT.half + 5, FORT.half - 5), tz = rand(-685, FORT.north - 5);
      const origin = new Vector3(tx + rand(-20, 20), groundAt(tx, tz) + 240, tz + 60);
      const dir = new Vector3(tx, groundAt(tx, tz), tz).sub(origin).normalize();
      m.fire(ARTY, { kind: 'heavy', damage: 240, speed: 210, splash: 9, splashDamage: 170, spread: 0.02 }, origin, dir);
    }
  };

  m.modeTick = () => {
    if (FORT.command && m.propDead.has(FORT.command.id)) return m.endMatch('red', 'The command bunker was destroyed');
    if (f.phase === 'break') {
      if (m.time >= f.until) startWave();
      return;
    }
    f.alive = f.alive.filter((u) => !u.dead && m.units.includes(u));
    if (f.arty) artillery();
    if (f.alive.length) {
      if (f.wave < WAVES.length && m.time >= f.until) startWave();
      return;
    }
    if (f.wave >= WAVES.length) return m.endMatch('blue', `All ${WAVES.length} waves repelled`);
    f.phase = 'break';
    f.until = m.time + BREAK;
    m.events.push({ k: 'waveClear', n: f.wave });
  };

  // Tanks parked in the depot repair and rearm much faster.
  m.modeCrewTick = (c) => {
    const t = c.tank;
    if (t.dead || !inDepot(t.x, t.z)) return;
    t.hp = Math.min(t.spec.hp, t.hp + t.spec.hp * 0.05 * DT);
    for (const k in t.mods) t.mods[k] = Math.min(1, t.mods[k] + 0.2 * DT);
    t.burning = 0;
    t.reload = Math.max(0, t.reload - DT * 0.8);
    t.coaxReload = Math.max(0, t.coaxReload - DT);
  };

  m.modeSnapshot = (snap) => {
    const cmd = FORT.command;
    const hp = cmd ? (m.propDead.has(cmd.id) ? 0 : (m.propHp.get(cmd.id) ?? cmd.maxHp) / cmd.maxHp) : 1;
    snap.fort = [f.wave, f.phase === 'fight' ? 1 : 0, Math.ceil(Math.max(0, f.until - m.time)), f.alive.length, Math.round(hp * 100)];
  };
}
