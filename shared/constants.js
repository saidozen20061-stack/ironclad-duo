// Shared between server and client. Units: metres, seconds, radians unless noted.

export const ROOM_CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O to avoid confusion
export const ROOM_CODE_LENGTH = 5;
export const MAX_NAME_LENGTH = 16;

export const ROLES = ['driver', 'gunner'];

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
};

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
export const TYPE_IDS = ['light', 'medium', 'heavy', 'rifle', 'rocket', 'atgun', 'crew'];

export const MATCH = {
  tickets: 500,
  duration: 20 * 60,
  // Ticket cost when a unit dies.
  deathCost: { tank: 5, player: 15, inf: 1, atgun: 3 },
  // Every BLEED_INTERVAL seconds the team holding fewer points loses (difference) tickets.
  bleedInterval: 3,
  capRate: 0.02, // progress per second per capture weight
  capWeight: { player: 5, tank: 2, inf: 1 },
  caps: { inf: 22, tank: 5 }, // per team, alive at once
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
