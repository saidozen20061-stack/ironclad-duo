import { net } from '../net.js';
import { TANKS } from '../../../shared/constants.js';
import { PLANES } from '../../../shared/planes.js';
import { toast } from '../ui/screens.js';

// Permanent achievements, kept in this browser. `run` holds this match's counts, `all` the lifetime totals.
const KEY = 'ironclad-achievements';
const TEAMS = ['blue', 'red'];

export const ACHIEVEMENTS = [
  { id: 'firstBlood', name: 'First Blood', desc: 'Destroy your first enemy vehicle', done: (run, all) => all.tanks + all.planes >= 1 },
  { id: 'tankAce', name: 'Tank Ace', desc: 'Destroy 5 tanks in one match', done: (run) => run.tanks >= 5 },
  { id: 'tankHunter', name: 'Tank Hunter', desc: 'Destroy 50 tanks', done: (run, all) => all.tanks >= 50 },
  { id: 'acePilot', name: 'Air Ace', desc: 'Shoot down 3 planes in one match', done: (run) => run.planes >= 3 },
  { id: 'skyHunter', name: 'Sky Hunter', desc: 'Shoot down 25 planes', done: (run, all) => all.planes >= 25 },
  { id: 'giantSlayer', name: 'Giant Slayer', desc: 'Destroy a Leviathan', done: (run, all) => all.leviathans >= 1 },
  { id: 'jetKiller', name: 'Jet Killer', desc: 'Shoot down a Talon', done: (run, all) => all.talons >= 1 },
  { id: 'exterminator', name: 'Grunt Work', desc: 'Kill 25 enemy soldiers', done: (run, all) => all.infantry >= 25 },
  { id: 'flagBearer', name: 'Flag Bearer', desc: 'Have your team capture 10 flags', done: (run, all) => all.flags >= 10 },
  { id: 'wings', name: 'Earned Your Wings', desc: 'Take off for the first time', done: (run, all) => all.takeoffs >= 1 },
  { id: 'softLanding', name: 'Any Landing You Walk Away From', desc: 'Land a plane back on the ground', done: (run, all) => all.landings >= 1 },
  { id: 'frequentFlyer', name: 'Frequent Flyer', desc: 'Take off 25 times', done: (run, all) => all.takeoffs >= 25 },
  { id: 'captain', name: 'Captain of the Leviathan', desc: 'Fly a Leviathan', done: (run, all) => all.leviathanFlights >= 1 },
  { id: 'phantom', name: 'Ghost of the Skies', desc: 'Destroy 10 vehicles with a Wraith', done: (run, all) => all.wraithKills >= 10 },
  { id: 'friendlyFire', name: 'Friendly Fire Champion', desc: 'Hit your own teammates 25 times', done: (run, all) => all.friendlyHits >= 25 },
  { id: 'traitor', name: 'Whose Side Are You On?', desc: 'Kill a teammate', done: (run, all) => all.teamkills >= 1 },
  { id: 'firstWin', name: 'First Victory', desc: 'Win a match', done: (run, all) => all.wins >= 1 },
  { id: 'veteran', name: 'Veteran', desc: 'Win 10 matches', done: (run, all) => all.wins >= 10 },
  { id: 'flawless', name: 'Untouchable', desc: 'Win a match without losing a vehicle', done: (run) => run.won && run.deaths === 0 },
  { id: 'nightOwl', name: 'Night Owl', desc: 'Win a night battle', done: (run) => run.won && run.night },
  { id: 'stormChaser', name: 'Storm Chaser', desc: 'Win a battle in the rain', done: (run) => run.won && run.rain },
];

const blank = () => ({ tanks: 0, planes: 0, leviathans: 0, talons: 0, infantry: 0, flags: 0, takeoffs: 0, landings: 0, leviathanFlights: 0, wraithKills: 0, friendlyHits: 0, teamkills: 0, wins: 0 });

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    return { unlocked: saved?.unlocked ?? {}, all: { ...blank(), ...saved?.all } };
  } catch {
    return { unlocked: {}, all: blank() };
  }
}

// What the Achievements screen shows: every achievement, newest unlocks first.
export function achievementList() {
  const { unlocked } = load();
  return ACHIEVEMENTS.map((a) => ({ ...a, unlockedAt: unlocked[a.id] ?? null })).sort((a, b) => (b.unlockedAt ?? 0) - (a.unlockedAt ?? 0));
}

export class AchievementTracker {
  constructor(crewId, { night = false, rain = false, vehicle = null } = {}) {
    this.crewId = crewId;
    this.save = load();
    this.units = new Map(); // id -> crew: rows don't always carry every unit
    this.run = { ...blank(), deaths: 0, won: false, night, rain };
    this.fresh = [];
    this.flown = false;
    this.vehicle = vehicle;
    this.off = net.on('s', (msg) => this.onSnapshot(msg));
  }

  count(key) {
    this.run[key]++;
    this.save.all[key]++;
  }

  onSnapshot(msg) {
    for (const a of msg.u) this.units.set(a[0], { team: TEAMS[a[1]], crew: a[10] > 0 ? a[10] - 1 : null, type: a[2] });
    const me = msg.me;
    if (!me) return;
    this.vehicle = me.vehicle ?? this.vehicle;
    const ground = me.pl?.ground;
    if (this.wasGround === true && ground === false && !me.dead) {
      this.count('takeoffs');
      if (this.vehicle === 'leviathan' && !this.flown) {
        this.flown = true;
        this.count('leviathanFlights');
      }
    }
    if (this.wasGround === false && ground === true && !me.dead) this.count('landings');
    this.wasGround = ground;
    let changed = false;
    for (const ev of msg.ev ?? []) changed = this.onEvent(ev, me.team) || changed;
    if (changed || ground !== undefined) this.check();
  }

  mine(id) {
    return this.units.get(id)?.crew === this.crewId;
  }

  onEvent(ev, team) {
    if (ev.k === 'cap' && ev.team === team) {
      this.count('flags');
      return true;
    }
    if (ev.k === 'i' && ev.u !== undefined && this.mine(ev.o) && !this.mine(ev.u) && this.units.get(ev.u)?.team === team) {
      this.count('friendlyHits');
      return true;
    }
    if (ev.k !== 'k' || !this.mine(ev.by) || this.mine(ev.u)) return false;
    if (ev.team === team) this.count('teamkills');
    else if (TANKS[ev.type]) {
      this.count('tanks');
      if (this.vehicle === 'wraith') this.count('wraithKills');
    } else if (PLANES[ev.type]) {
      this.count('planes');
      if (ev.type === 'leviathan') this.count('leviathans');
      if (ev.type === 'f16') this.count('talons');
      if (this.vehicle === 'wraith') this.count('wraithKills');
    } else this.count('infantry');
    return true;
  }

  check() {
    for (const a of ACHIEVEMENTS) {
      if (this.save.unlocked[a.id] || !a.done(this.run, this.save.all)) continue;
      this.save.unlocked[a.id] = Date.now();
      this.fresh.push(a);
      toast(`🏆 Achievement: ${a.name}`, { ms: 5000 });
    }
    this.store();
  }

  store() {
    const text = JSON.stringify({ unlocked: this.save.unlocked, all: this.save.all });
    if (text === this.saved) return;
    this.saved = text;
    try {
      localStorage.setItem(KEY, text);
    } catch {
      // Private window or full storage: they just won't be remembered.
    }
  }

  // The match is over: counts the result, and returns what was unlocked during it.
  finish(won, deaths) {
    this.run.won = won;
    this.run.deaths = deaths;
    if (won) this.count('wins');
    this.check();
    return this.fresh;
  }

  dispose() {
    this.off();
    this.store();
  }
}
