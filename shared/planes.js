// Planes: arcade numbers, scaled down so a 1.5 km map doesn't fly past in ten seconds.
// Speeds in m/s, rates in rad/s. Same field names as tanks where the host reads them
// (hp, size, armor, weapon.label), so a plane can stand in for a tank in shared code.

const gun = (label, damage, interval, spread, kind = 'mg', speed = 620, ammo = 600) => ({ label, damage, interval, spread, kind, speed, ammo });
// The side gunner's door-mounted minigun on every two-seater.
const REAR = { damage: 8, interval: 0.05, spread: 0.014, speed: 420, ammo: 1500 };

export const PLANES = {
  stuka: {
    id: 'stuka', name: 'Vulture', class: 'Dive Bomber', inspired: 'German Ju 87 Stuka', seats: 2, engines: 1,
    blurb: 'Dives like a stone with a screaming siren. Very accurate bombs, slow and vulnerable.',
    hp: 520, maxSpeed: 62, minSpeed: 24, accel: 15, roll: 1.5, pitch: 0.75, yaw: 0.34, drag: 0.8,
    armor: { front: 0.95, side: 1.05, rear: 1.15 }, size: { length: 11.5, width: 13.8, height: 3.8 }, gearH: 2.2,
    guns: gun('2× 7.9mm MG', 11, 0.1, 0.02), rear: REAR,
    bombs: { count: 3, damage: 460, splash: 15, splashDamage: 340, spread: 0.002 }, siren: true, gearFixed: true, engineSound: 'inline',
    stats: { speed: 2, armor: 2, firepower: 4, agility: 3 },
  },
  sturmovik: {
    id: 'sturmovik', name: 'Hammer', class: 'Armored Attacker', inspired: 'Soviet Il-2 Sturmovik', seats: 2, engines: 1,
    blurb: 'Flying tank: rockets, cannons and small bombs. Very tough but slow.',
    hp: 1150, maxSpeed: 58, minSpeed: 24, accel: 13, roll: 1.1, pitch: 0.6, yaw: 0.3, drag: 0.8,
    armor: { front: 0.45, side: 0.6, rear: 0.8 }, size: { length: 11.6, width: 14.6, height: 3.8 }, gearH: 2.2,
    guns: gun('2× 23mm Cannon', 34, 0.2, 0.015, 'ac', 650, 300), rear: REAR,
    bombs: { count: 4, damage: 240, splash: 10, splashDamage: 200, spread: 0.008 }, rockets: { count: 8, damage: 300, speed: 170, splash: 6, splashDamage: 130, spread: 0.012 }, engineSound: 'inline',
    stats: { speed: 1, armor: 5, firepower: 5, agility: 2 },
  },
  dauntless: {
    id: 'dauntless', name: 'Albatross', class: 'Navy Dive Bomber', inspired: 'US SBD Dauntless', seats: 2, engines: 1,
    blurb: 'Balanced all-rounder. Good bombs, decent guns, forgiving to fly.',
    hp: 680, maxSpeed: 66, minSpeed: 24, accel: 16, roll: 1.5, pitch: 0.8, yaw: 0.36, drag: 0.8,
    armor: { front: 0.85, side: 1, rear: 1.05 }, size: { length: 10, width: 12.7, height: 3.9 }, gearH: 2.2,
    guns: gun('2× .50 cal MG', 16, 0.12, 0.018), rear: REAR,
    bombs: { count: 3, damage: 380, splash: 13, splashDamage: 290, spread: 0.005 }, engineSound: 'radial',
    stats: { speed: 3, armor: 3, firepower: 3, agility: 3 },
  },
  heavyfighter: {
    id: 'heavyfighter', name: 'Falcon', class: 'Heavy Fighter', inspired: 'German Bf 110', seats: 2, engines: 2,
    blurb: 'Twin engines and strong forward guns. Fast in a straight line, poor in a turn.',
    hp: 760, maxSpeed: 84, minSpeed: 30, accel: 22, roll: 1.1, pitch: 0.62, yaw: 0.3, drag: 0.8,
    armor: { front: 0.8, side: 1, rear: 1.1 }, size: { length: 12.3, width: 16.3, height: 3.5 }, gearH: 2.2,
    guns: gun('2× 20mm + 4× MG', 26, 0.08, 0.018, 'ac', 680, 500), rear: REAR,
    bombs: { count: 2, damage: 260, splash: 10, splashDamage: 200, spread: 0.01 }, twinTail: true, engineSound: 'inline',
    stats: { speed: 4, armor: 3, firepower: 5, agility: 2 },
  },
  mosquito: {
    id: 'mosquito', name: 'Hornet Mk II', class: 'Fast Bomber', inspired: 'British Mosquito', seats: 2, engines: 2,
    blurb: 'The fastest two-seater. Plywood armor: it survives by not getting hit.',
    hp: 500, maxSpeed: 92, minSpeed: 30, accel: 26, roll: 1.4, pitch: 0.72, yaw: 0.32, drag: 0.8,
    armor: { front: 1, side: 1.15, rear: 1.2 }, size: { length: 12.4, width: 16.5, height: 4.6 }, gearH: 2.3,
    guns: gun('4× 20mm Cannon', 24, 0.09, 0.016, 'ac', 680, 450), rear: REAR,
    bombs: { count: 4, damage: 260, splash: 11, splashDamage: 210, spread: 0.009 }, engineSound: 'inline',
    stats: { speed: 5, armor: 1, firepower: 4, agility: 3 },
  },
  mitchell: {
    id: 'mitchell', name: 'Thunderhead', class: 'Medium Bomber', inspired: 'US B-25 Mitchell', seats: 2, engines: 2,
    blurb: 'Biggest bomb load and guns all over. Slow, and a very large target.',
    hp: 1050, maxSpeed: 66, minSpeed: 28, accel: 16, roll: 0.75, pitch: 0.45, yaw: 0.24, drag: 0.8,
    armor: { front: 0.8, side: 0.9, rear: 0.95 }, size: { length: 16.1, width: 20.6, height: 4.8 }, gearH: 2.6,
    guns: gun('4× .50 cal MG', 15, 0.09, 0.022), rear: REAR,
    bombs: { count: 8, damage: 300, splash: 12, splashDamage: 240, spread: 0.012 }, twinTail: true, engineSound: 'radial',
    stats: { speed: 2, armor: 4, firepower: 5, agility: 1 },
  },
  mustang: {
    id: 'mustang', name: 'Bronco', class: 'Fighter', inspired: 'US P-51 Mustang', seats: 1, engines: 1,
    blurb: 'Long-legged, fast and well armed. Solo and NPC only.',
    hp: 460, maxSpeed: 98, minSpeed: 28, accel: 27, roll: 2.2, pitch: 1.05, yaw: 0.42, drag: 0.8,
    armor: { front: 0.95, side: 1.05, rear: 1.1 }, size: { length: 9.8, width: 11.3, height: 3.7 }, gearH: 2.1,
    guns: gun('6× .50 cal MG', 15, 0.07, 0.014), rear: null, rockets: { count: 4, damage: 240, speed: 170, splash: 5, splashDamage: 110, spread: 0.012 }, engineSound: 'inline',
    stats: { speed: 5, armor: 2, firepower: 4, agility: 4 },
  },
  spitfire: {
    id: 'spitfire', name: 'Gale', class: 'Fighter', inspired: 'British Spitfire', seats: 1, engines: 1,
    blurb: 'Turns inside anything. Elliptical wings, light guns. Solo and NPC only.',
    hp: 420, maxSpeed: 94, minSpeed: 26, accel: 26, roll: 2.5, pitch: 1.25, yaw: 0.46, drag: 0.8,
    armor: { front: 1, side: 1.05, rear: 1.15 }, size: { length: 9.1, width: 11.2, height: 3.5 }, gearH: 2,
    guns: gun('2× 20mm + 4× MG', 17, 0.075, 0.015, 'ac', 680, 500), rear: null, engineSound: 'inline',
    stats: { speed: 4, armor: 2, firepower: 3, agility: 5 },
  },
  messer: {
    id: 'messer', name: 'Viper', class: 'Fighter', inspired: 'German Bf 109', seats: 1, engines: 1,
    blurb: 'Climbs and dives hard, centre-mounted cannon. Solo and NPC only.',
    hp: 440, maxSpeed: 96, minSpeed: 28, accel: 28, roll: 2.1, pitch: 1.05, yaw: 0.42, drag: 0.8,
    armor: { front: 0.95, side: 1.05, rear: 1.15 }, size: { length: 9, width: 9.9, height: 3.4 }, gearH: 2,
    guns: gun('20mm + 2× MG', 21, 0.085, 0.015, 'ac', 680, 450), rear: null, engineSound: 'inline',
    stats: { speed: 5, armor: 2, firepower: 4, agility: 4 },
  },
};
// Where the side gun is mounted: right side of the fuselage, behind the wing (x, y, z).
const DOORS = { stuka: [-0.8, 0.45, -1.6], sturmovik: [-0.8, 0.4, -1.7], dauntless: [-0.8, 0.45, -1.8], heavyfighter: [-0.75, 0.45, -1.6], mosquito: [-0.75, 0.4, -1.6], mitchell: [-1.05, 0.6, -2.2] };
// Highest the side gun can point above the plane's own wings: it fires everywhere but up.
export const SIDE_GUN_MAX_UP = 0.64; // sine of the angle

// Planes fly at about half their listed speed, so tanks and flak get a real chance at them.
const SPEED_SCALE = 0.55;
for (const p of Object.values(PLANES)) {
  p.maxSpeed *= SPEED_SCALE;
  p.minSpeed *= SPEED_SCALE;
  p.accel *= SPEED_SCALE * 1.1;
  p.door = DOORS[p.id] ?? null;
  // Slower bullets, so a burst reads as a visible stream of tracers.
  p.guns = { ...p.guns, speed: 420 };
  p.weapon = { label: p.guns.label }; // what the HUD and shared code read
  p.bombs ??= null;
  // Every plane carries a few rockets, slow enough that you can watch them fly.
  p.rockets = { damage: 240, splash: 5, splashDamage: 110, spread: 0.012, count: 4, ...p.rockets, speed: 125 };
}

export const PLANE_IDS = Object.keys(PLANES);
export const COOP_PLANE_IDS = PLANE_IDS.filter((id) => PLANES[id].seats === 2);
export const isPlane = (type) => !!PLANES[type];

export const FLIGHT = {
  maxAlt: 480, // m above the map's zero: the air gets too thin above this
  warnAlt: 28, // m above ground: pull up warning
  edgeWarn: 1150,
  edgeTurn: 1300,
  fuelSeconds: 300, // at full throttle
  airStartAlt: 170,
  repairRate: 0.14, // hp share per second parked on the own airfield
  stallWarn: 1.18, // × min speed
};

// NPC planes per team. Each side has one plane at most, player or NPC.
export const NPC_PLANES = {
  blue: { fighter: ['mustang', 'spitfire'], attack: ['dauntless', 'mitchell', 'mosquito'] },
  red: { fighter: ['messer', 'messer'], attack: ['stuka', 'sturmovik', 'heavyfighter'] },
  every: 40,
};
