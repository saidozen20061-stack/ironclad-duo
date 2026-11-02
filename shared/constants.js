// Shared between server and client. Units: metres, seconds, radians unless noted.
import { PLANE_IDS } from './planes.js';

export const ROOM_CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O to avoid confusion
export const ROOM_CODE_LENGTH = 5;
export const MAX_NAME_LENGTH = 16;

export const ROLES = ['driver', 'gunner'];

// Up to 5 tank crews (10 players) per room.
export const MAX_CREWS = 10; // five slots per team
export const MAX_PLAYERS = 10;
export const PLAY_STYLES = { duo: 'Duo crews', solo: 'Solo vehicles' };
export const MODES = {
  flags: { name: 'Flag Capture', blurb: 'Hold A, B and C. The team with fewer flags bleeds tickets.' },
  tdm: { name: 'Team Deathmatch', blurb: 'Crews fight crews. Player tank = 3 pts, NPC tank = 1.' },
  fortress: { name: 'Fortress Defence', blurb: 'All crews defend the Blue fortress against 10 waves.' },
};
export const KILL_LIMITS = [10, 20, 30];

// The war around the match (host/war.js). Seconds unless noted.
export const WAR = {
  firstBarrage: [15, 30],
  barrageEvery: [24, 50],
  barrageShells: [4, 8],
  shellFall: 2.8,
  firstBomber: [45, 80],
  bomberEvery: [70, 130],
  bomberBombs: [6, 11],
  bomberSpeed: 45,
  bomberAlt: 170,
  bombFall: 3.4,
  nearPointChance: 0.12,
  blastRadius: 24, // m
  tankDamage: 0.05, // share of a tank's hp at the centre of the blast
  infDamage: 45,
};

// NPC skill. aim: gun laying error; react: seconds [min, max] between spotting a target and
// the first shot; turret: traverse speed; lead: how much of a moving target's travel they
// aim ahead for; damage: on everything they fire; rocket: extra spread on AT rockets;
// sight: range beyond which targets start slipping out of view (fog, dust); lose: chance per
// look of losing a target in smoke or behind cover; behind: chance per look of noticing
// something outside the field of view.
export const DIFFICULTY = {
  easy: { name: 'Easy', aim: 6, react: [1.5, 2.5], turret: 0.55, lead: 0.1, damage: 0.55, rocket: 4, sight: 200, lose: 0.5, behind: 0.008 },
  normal: { name: 'Normal', aim: 3, react: [0.8, 1.4], turret: 0.75, lead: 0.5, damage: 0.8, rocket: 2.2, sight: 280, lose: 0.3, behind: 0.015 },
  hard: { name: 'Hard', aim: 2.2, react: [0.35, 0.75], turret: 0.95, lead: 0.85, damage: 1, rocket: 1.3, sight: 360, lose: 0.15, behind: 0.03 },
};

export const TICK_RATE = 20; // server simulation ticks per second

const deg = (d) => (d * Math.PI) / 180;

// Armor values are damage multipliers per hit facing (lower = tougher).
export const TANKS = {
  light: {
    id: 'light',
    name: 'Hornet',
    class: 'Light Tank',
    blurb: 'Fast and nimble. Thin armor. Rapid-fire autocannon.',
    hp: 650,
    maxSpeed: 16,
    reverseSpeed: 7,
    accel: 9,
    turnRate: deg(62),
    turretSpeed: deg(65),
    elevation: { min: deg(-8), max: deg(22) },
    armor: { front: 0.75, side: 1.0, rear: 1.25 },
    size: { length: 4.6, width: 2.6, height: 2.0 },
    // Model mount points (must match client/src/models/tanks.js). Turret frame is
    // relative to hull, gun pivot relative to turret, sight relative to turret.
    mount: { turret: [0, 1.3, 0.1], gun: [0, 0.3, 0.7], barrel: 2.0, sight: [0, 0.95, -0.35] },
    weapon: {
      kind: 'autocannon',
      label: '30mm Autocannon',
      magazine: 10,
      fireInterval: 0.22,
      reload: 3.0,
      damage: 55,
      speed: 950,
      splash: 1.5,
      spread: deg(0.35),
    },
    stats: { speed: 5, armor: 1, firepower: 2, reload: 5 },
  },
  medium: {
    id: 'medium',
    name: 'Warden',
    class: 'Medium Tank',
    blurb: 'Balanced all-rounder. AP/HE main gun plus coaxial machine gun.',
    hp: 1000,
    maxSpeed: 12,
    reverseSpeed: 5,
    accel: 6,
    turnRate: deg(45),
    turretSpeed: deg(42),
    elevation: { min: deg(-7), max: deg(18) },
    armor: { front: 0.5, side: 0.85, rear: 1.15 },
    size: { length: 6.2, width: 3.2, height: 2.4 },
    mount: { turret: [0, 1.55, 0.1], gun: [0, 0.38, 1.05], barrel: 3.4, sight: [0, 1.15, -0.5] },
    weapon: {
      kind: 'cannon',
      label: '85mm Cannon',
      reload: 4.5,
      shells: {
        AP: { damage: 260, speed: 850, splash: 1.5, splashDamage: 40 },
        HE: { damage: 150, speed: 650, splash: 7, splashDamage: 120 },
      },
      spread: deg(0.15),
      coax: { fireInterval: 0.09, damage: 9, belt: 150, reload: 5, speed: 800, spread: deg(1.2) },
    },
    stats: { speed: 3, armor: 3, firepower: 3, reload: 3 },
  },
  heavy: {
    id: 'heavy',
    name: 'Bastion',
    class: 'Heavy Tank',
    blurb: 'Slow fortress. Huge cannon, long reload, devastating splash.',
    hp: 1600,
    maxSpeed: 8.5,
    reverseSpeed: 3.5,
    accel: 3.5,
    turnRate: deg(30),
    turretSpeed: deg(22),
    elevation: { min: deg(-6), max: deg(15) },
    armor: { front: 0.3, side: 0.65, rear: 1.0 },
    size: { length: 7.4, width: 3.7, height: 2.8 },
    mount: { turret: [0, 1.85, -0.2], gun: [0, 0.5, 1.75], barrel: 4.96, sight: [0, 1.4, -0.7] },
    weapon: {
      kind: 'heavy',
      label: '152mm Howitzer-Gun',
      reload: 9.0,
      damage: 520,
      speed: 700,
      splash: 10,
      splashDamage: 260,
      spread: deg(0.2),
    },
    stats: { speed: 1, armor: 5, firepower: 5, reload: 1 },
  },
  // ---- Extra classes. `frame` picks the interior size; `traverse` limits the gun's arc
  // for casemate vehicles (radians either side of straight ahead).
  scout: {
    id: 'scout',
    name: 'Jackal',
    class: 'Recon Tank',
    frame: 'light',
    blurb: 'Tiny and very fast. Paper armor. Rapid 20mm with a deep magazine.',
    hp: 450,
    maxSpeed: 19,
    reverseSpeed: 9,
    accel: 11,
    turnRate: deg(78),
    turretSpeed: deg(85),
    elevation: { min: deg(-10), max: deg(25) },
    armor: { front: 0.95, side: 1.15, rear: 1.35 },
    size: { length: 4.0, width: 2.3, height: 1.7 },
    mount: { turret: [0, 1.12, -0.1], gun: [0, 0.24, 0.5], barrel: 1.6, sight: [0, 0.8, -0.3] },
    weapon: { kind: 'autocannon', label: '20mm Rapid Cannon', magazine: 20, fireInterval: 0.12, reload: 3.5, damage: 32, speed: 1000, splash: 1, spread: deg(0.45) },
    stats: { speed: 5, armor: 1, firepower: 1, reload: 5 },
  },
  wheeled: {
    id: 'wheeled',
    name: 'Strider',
    class: 'Armored Car',
    frame: 'medium',
    blurb: 'Six wheels, top speed of the field. Light armor, AP/HE 75mm.',
    hp: 600,
    maxSpeed: 21,
    reverseSpeed: 10,
    accel: 8,
    turnRate: deg(48),
    turretSpeed: deg(55),
    elevation: { min: deg(-8), max: deg(20) },
    armor: { front: 0.9, side: 1.1, rear: 1.3 },
    size: { length: 5.6, width: 2.8, height: 2.2 },
    mount: { turret: [0, 1.55, -0.2], gun: [0, 0.25, 0.75], barrel: 2.57, sight: [0, 0.85, -0.4] },
    weapon: {
      kind: 'cannon',
      label: '75mm Short Cannon',
      reload: 4.0,
      shells: {
        AP: { damage: 180, speed: 750, splash: 1.5, splashDamage: 30 },
        HE: { damage: 130, speed: 600, splash: 6, splashDamage: 100 },
      },
      spread: deg(0.25),
    },
    stats: { speed: 5, armor: 2, firepower: 2, reload: 3 },
  },
  destroyer: {
    id: 'destroyer',
    name: 'Viper',
    class: 'Tank Destroyer',
    frame: 'medium',
    blurb: 'Low casemate, no turret: the gun only swings 12° — turn the hull. Deadly long gun.',
    hp: 900,
    maxSpeed: 11,
    reverseSpeed: 5,
    accel: 5.5,
    turnRate: deg(40),
    turretSpeed: deg(25),
    traverse: deg(12),
    elevation: { min: deg(-6), max: deg(16) },
    armor: { front: 0.35, side: 0.9, rear: 1.2 },
    size: { length: 6.6, width: 3.3, height: 2.0 },
    mount: { turret: [0, 1.75, 1.6], gun: [0, 0, 0.3], barrel: 5.02, sight: [-0.55, 0.55, -1.6] },
    weapon: {
      kind: 'cannon',
      label: '105mm Long Gun',
      reload: 6.5,
      shells: {
        AP: { damage: 340, speed: 1100, splash: 1.5, splashDamage: 40 },
        HE: { damage: 160, speed: 800, splash: 5, splashDamage: 110 },
      },
      spread: deg(0.08),
    },
    stats: { speed: 2, armor: 3, firepower: 5, reload: 2 },
  },
  aa: {
    id: 'aa',
    name: 'Wasp',
    class: 'Twin-Gun Tank',
    frame: 'light',
    blurb: 'Open turret with twin 25mm guns. Shreds infantry and light armor, aims high.',
    hp: 550,
    maxSpeed: 14,
    reverseSpeed: 6,
    accel: 8,
    turnRate: deg(55),
    turretSpeed: deg(95),
    elevation: { min: deg(-8), max: deg(45) },
    armor: { front: 0.85, side: 1.05, rear: 1.3 },
    size: { length: 5.2, width: 2.9, height: 2.1 },
    mount: { turret: [0, 1.45, -0.3], gun: [0, 0.45, 0.7], barrel: 2.2, sight: [0, 0.95, -0.5] },
    weapon: { kind: 'autocannon', label: 'Twin 25mm Autocannons', magazine: 40, fireInterval: 0.08, reload: 5, damage: 26, speed: 1050, splash: 1.2, spread: deg(0.6) },
    stats: { speed: 4, armor: 1, firepower: 2, reload: 4 },
  },
  assault: {
    id: 'assault',
    name: 'Mauler',
    class: 'Assault Howitzer',
    frame: 'heavy',
    blurb: 'Boxy brawler with a stubby 165mm. Slow lobbed shells, enormous blast.',
    hp: 1200,
    maxSpeed: 9.5,
    reverseSpeed: 4,
    accel: 4.5,
    turnRate: deg(34),
    turretSpeed: deg(24),
    elevation: { min: deg(-5), max: deg(35) },
    armor: { front: 0.45, side: 0.75, rear: 1.1 },
    size: { length: 6.4, width: 3.4, height: 2.6 },
    mount: { turret: [0, 1.65, -0.6], gun: [0, 0.5, 1.35], barrel: 2.64, sight: [0.6, 1.2, -0.6] },
    weapon: { kind: 'heavy', label: '165mm Demolition Gun', reload: 7, damage: 300, speed: 380, splash: 12, splashDamage: 220, spread: deg(0.35) },
    stats: { speed: 2, armor: 4, firepower: 5, reload: 2 },
  },
  superheavy: {
    id: 'superheavy',
    name: 'Colossus',
    class: 'Super-Heavy Tank',
    frame: 'heavy',
    blurb: 'A rolling fortress. Crawls, but shrugs off almost anything. 128mm + MG.',
    hp: 2400,
    maxSpeed: 6,
    reverseSpeed: 2.5,
    accel: 2.5,
    turnRate: deg(22),
    turretSpeed: deg(16),
    elevation: { min: deg(-6), max: deg(15) },
    armor: { front: 0.22, side: 0.5, rear: 0.9 },
    size: { length: 8.6, width: 4.2, height: 3.2 },
    mount: { turret: [0, 2.1, -0.5], gun: [0, 0.55, 1.7], barrel: 6.0, sight: [-0.7, 1.35, -0.6] },
    weapon: {
      kind: 'cannon',
      label: '128mm Cannon',
      reload: 8,
      shells: {
        AP: { damage: 420, speed: 900, splash: 2, splashDamage: 60 },
        HE: { damage: 240, speed: 700, splash: 9, splashDamage: 200 },
      },
      spread: deg(0.12),
      coax: { fireInterval: 0.09, damage: 9, belt: 200, reload: 5, speed: 800, spread: deg(1.2) },
    },
    stats: { speed: 1, armor: 5, firepower: 5, reload: 1 },
  },
};

// Tank guns can swing right up at the sky, so crews can shoot at planes.
export const GUN_MAX_ELEVATION = deg(68);
// Hulls whose track ends reach past size.length: shots stop at the drawn length.
for (const [id, len] of Object.entries({ medium: 7.1, heavy: 8.4, destroyer: 7.4, assault: 7.3, superheavy: 9.7 })) TANKS[id].hitLength = len;
for (const t of Object.values(TANKS)) t.elevation.max = GUN_MAX_ELEVATION;

export const TANK_IDS = Object.keys(TANKS);

// Non-tank NPC units. Same shape as tank specs where the server reads them (size, armor, hp).
export const UNITS = {
  rifle: {
    id: 'rifle', class: 'Infantry', hp: 100, speed: 3.4, size: { length: 0.7, width: 0.7, height: 1.8 }, armor: { front: 1, side: 1, rear: 1 },
    weapon: { kind: 'rifle', range: 170, interval: 1.4, damage: 14, speed: 600, spread: 0.03 },
  },
  rocket: {
    id: 'rocket', class: 'AT Infantry', hp: 100, speed: 3.1, size: { length: 0.7, width: 0.7, height: 1.8 }, armor: { front: 1, side: 1, rear: 1 },
    weapon: { kind: 'rocket', range: 140, interval: 7, damage: 280, speed: 110, spread: 0.02, splash: 3, splashDamage: 60 },
  },
  atgun: {
    id: 'atgun', class: 'AT Gun', hp: 380, size: { length: 3.2, width: 2.6, height: 1.6 }, armor: { front: 0.6, side: 1, rear: 1.2 },
    turretSpeed: (30 * Math.PI) / 180,
    weapon: { kind: 'ap', range: 480, interval: 6.5, damage: 230, speed: 750, spread: 0.004, splash: 1.5, splashDamage: 30 },
  },
  // The player crew after bailing out of a destroyed tank.
  crew: {
    id: 'crew', class: 'Tank Crew', hp: 100, size: { length: 0.7, width: 0.7, height: 1.8 }, armor: { front: 1, side: 1, rear: 1 },
  },
};

// Unit type codes on the wire.
export const TYPE_IDS = ['light', 'medium', 'heavy', 'rifle', 'rocket', 'atgun', 'crew', 'scout', 'wheeled', 'destroyer', 'aa', 'assault', 'superheavy', ...PLANE_IDS];

export const MATCH = {
  tickets: 500,
  duration: 20 * 60,
  // Ticket cost when a unit dies.
  deathCost: { tank: 5, player: 15, inf: 1, atgun: 3, plane: 5 },
  // Every BLEED_INTERVAL seconds the team holding fewer points loses (difference) tickets.
  bleedInterval: 3,
  capRate: 0.02, // progress per second per capture weight
  capWeight: { player: 5, tank: 2, inf: 1 },
  caps: { inf: 22, tank: 8 }, // per team, alive at once
  waveInterval: 25,
};

export const PING = { cooldown: 5, lifetime: 15, reachRadius: 12 };
export const RADAR_RANGE = 120;

// On-foot crew: choice after the tank dies, movement and the M4-style rifle.
export const FOOT = {
  choiceTime: 10,
  walk: 4.2, sprint: 6.8, crouch: 2.2, jump: 4.6, eye: 1.6, crouchEye: 1.05,
  rifle: { mag: 30, reserve: 180, interval: 0.1, reload: 2.3, damage: 25, speed: 820, hip: 0.022, ads: 0.004 },
  grenades: 3,
  grenade: { speed: 17, damage: 20, splash: 7, splashDamage: 120, cooldown: 1 },
  garageRadius: 15,
};
