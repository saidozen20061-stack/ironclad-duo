// Story mode's fixed tables: ranks, the tanks a crew can own, workshop parts and one-stage supplies.
// Story tanks reuse the battle models in shared/constants.js; `model` is the one each is built on and
// `base` its own stats on top of that model's (merged in by story/tanks.js).

const deg = (d) => (d * Math.PI) / 180;

// XP needed to reach each rank (the first is where everyone starts).
export const RANKS = [
  { name: 'Recruit', xp: 0 },
  { name: 'Private', xp: 800 },
  { name: 'Corporal', xp: 2500 },
  { name: 'Sergeant', xp: 6000 },
  { name: 'Staff Sergeant', xp: 12000 },
  { name: 'Lieutenant', xp: 22000 },
  { name: 'Captain', xp: 38000 },
  { name: 'Major', xp: 60000 },
  { name: 'Colonel', xp: 90000 },
  { name: 'General', xp: 140000 },
];

// tier, the rank that unlocks it in the shop, and its price in silver.
export const STORY_TANKS = {
  t26: { tier: 1, rank: 1, price: 0, model: 't26' },
  stuart: {
    tier: 2, rank: 3, price: 3000, model: 'light', name: 'Bobcat', class: 'Light Tank', inspired: 'US M5 Stuart',
    blurb: 'Quick and light, with a rapid 37mm gun. Hit, move, hit again.',
    base: { hp: 640, maxSpeed: 15, turnRate: deg(56), armor: { front: 0.8, side: 1.05, rear: 1.3 }, weapon: { label: '37mm Rapid Gun', magazine: 5, damage: 52, reload: 3.8 } },
  },
  stug: {
    tier: 3, rank: 4, price: 8000, model: 'destroyer', name: 'Ram', class: 'Assault Gun', inspired: 'German StuG III',
    blurb: 'Low and hard to hit. No turret: aim with the hull. A long 75mm gun.',
    base: { hp: 860, maxSpeed: 10.5, armor: { front: 0.42, side: 0.95, rear: 1.2 }, weapon: { label: '75mm Long Gun', reload: 5.2, shells: { AP: { damage: 290 }, HE: { damage: 140 } } } },
  },
  sherman: {
    tier: 3, rank: 4, price: 9000, model: 'medium', name: 'Mustang', class: 'Medium Tank', inspired: 'US M4 Sherman',
    blurb: 'The dependable all-rounder. Fair armour, fair speed, a 75mm gun and a machine gun.',
    base: { hp: 950, maxSpeed: 11.5, armor: { front: 0.55, side: 0.9, rear: 1.15 }, weapon: { label: '75mm Gun', reload: 4.4, shells: { AP: { damage: 230 }, HE: { damage: 150 } } } },
  },
  hellcat: {
    tier: 3, rank: 4, price: 10000, model: 'medium', name: 'Lynx', class: 'Tank Destroyer', inspired: 'US M18 Hellcat',
    blurb: 'Thin as paper and very fast, with a hard-hitting 76mm. Shoot first.',
    base: { hp: 720, maxSpeed: 17, accel: 8, turnRate: deg(52), turretSpeed: deg(50), armor: { front: 0.85, side: 1.1, rear: 1.3 }, weapon: { label: '76mm High-Velocity Gun', reload: 4.0, shells: { AP: { damage: 285, speed: 1000 }, HE: { damage: 130 } } } },
  },
  t3485: {
    tier: 4, rank: 6, price: 18000, model: 'medium', name: 'Bear', class: 'Medium Tank', inspired: 'Soviet T-34-85',
    blurb: 'Sloped armour, a big 85mm gun and wide tracks for mud and snow.',
    base: { hp: 1150, maxSpeed: 12.5, armor: { front: 0.45, side: 0.8, rear: 1.1 }, weapon: { label: '85mm Gun', reload: 4.6, shells: { AP: { damage: 300 }, HE: { damage: 170 } } } },
  },
  panther: {
    tier: 4, rank: 6, price: 22000, model: 'heavy', name: 'Jaguar', class: 'Medium Tank', inspired: 'German Panther',
    blurb: 'Thick sloped front, a long, precise 75mm gun. Keep the nose towards the enemy.',
    base: { hp: 1300, maxSpeed: 11, accel: 4.5, turnRate: deg(36), turretSpeed: deg(30), armor: { front: 0.33, side: 0.85, rear: 1.1 }, weapon: { label: '75mm Long Gun', reload: 5.2, damage: 340, speed: 1050, splash: 2, splashDamage: 50, spread: deg(0.08) } },
  },
  kv2: {
    tier: 5, rank: 7, price: 35000, model: 'assault', name: 'Hammer', class: 'Heavy Tank', inspired: 'Soviet KV-2',
    blurb: 'A giant box turret with a 152mm howitzer. Slow to load, ends arguments.',
    base: { hp: 1700, armor: { front: 0.3, side: 0.6, rear: 0.95 }, weapon: { label: '152mm Howitzer', reload: 8, damage: 420, splash: 12, splashDamage: 260 } },
  },
  is2: {
    tier: 5, rank: 7, price: 38000, model: 'heavy', name: 'Tsar', class: 'Heavy Tank', inspired: 'Soviet IS-2',
    blurb: 'Heavy armour and a 122mm gun that breaks anything it hits.',
    base: { hp: 1850, maxSpeed: 9.5, armor: { front: 0.27, side: 0.6, rear: 0.95 }, weapon: { label: '122mm Gun', reload: 7.5, damage: 480, splash: 5, splashDamage: 160 } },
  },
  tiger: {
    tier: 5, rank: 7, price: 45000, model: 'superheavy', name: 'Titan', class: 'Heavy Tank', inspired: 'German Tiger I',
    blurb: 'Flat, thick armour all round and a deadly accurate 88mm. The one the others fear.',
    base: { hp: 2000, maxSpeed: 8.5, accel: 3.2, turnRate: deg(27), turretSpeed: deg(20), armor: { front: 0.25, side: 0.52, rear: 0.9 }, weapon: { label: '88mm Gun', reload: 6.2, spread: deg(0.06), shells: { AP: { damage: 400, speed: 1000 }, HE: { damage: 210 } } } },
  },
};
export const STARTER = 't26';
export const TIERS = ['', 'I', 'II', 'III', 'IV', 'V'];

// ---- Workshop. Each section has four qualities and five upgrade levels. `stats` are what the section
// changes, as [label, key]; how much is QUALITY[q].gain + LEVEL_GAIN per level above 1. Keys that the
// battle uses are applied in story/tanks.js; the rest show on the card and in the combat rating.
export const QUALITY = [
  { name: 'Standard', color: '#b9b6a8', gain: 0, price: 0 },
  { name: 'Improved', color: '#6fbf5a', gain: 0.08, price: 900 },
  { name: 'Elite', color: '#5a9ee0', gain: 0.16, price: 2600 },
  { name: 'Experimental', color: '#c77de0', gain: 0.26, price: 6500 },
];
export const LEVEL_GAIN = 0.025;
export const MAX_LEVEL = 5;
export const upgradePrice = (section, level) => Math.round(220 * level * PARTS[section].cost);
export const partPrice = (section, q) => Math.round(QUALITY[q].price * PARTS[section].cost);

// `at` is where the hotspot sits on the tank (fraction of length/height/width, front is +z);
// `weight` is tonnes added per quality step.
export const PARTS = {
  gun: { name: 'Gun', cost: 1.3, at: [0, 0.8, 0.75], weight: 0.2, stats: [['Damage', 'damage'], ['Penetration', 'pen'], ['Reload', 'reload'], ['Accuracy', 'accuracy']], looks: ['Stock barrel', 'Muzzle brake', 'Long barrel', 'Long barrel, fume extractor'] },
  turret: { name: 'Turret', cost: 1, at: [0, 0.85, 0.1], weight: 0.4, stats: [['Turret armour', 'turretArmor'], ['Traverse', 'traverse']], looks: ['Stock turret', 'Extra plates', 'Thick mantlet', 'Cast turret'] },
  hull: { name: 'Hull armour', cost: 1.2, at: [0, 0.45, 0.4], weight: 0.9, stats: [['Front armour', 'front'], ['Side armour', 'side'], ['Rear armour', 'rear']], looks: ['Stock plates', 'Welded plates', 'Thick plates', 'Composite plates'] },
  engine: { name: 'Engine', cost: 1.1, at: [0, 0.55, -0.4], weight: 0.15, stats: [['Top speed', 'speed'], ['Acceleration', 'accel'], ['Fire resistance', 'fire']], looks: ['Stock engine', 'Tuned engine', 'Supercharged', 'Turbo diesel'] },
  tracks: { name: 'Tracks', cost: 0.8, at: [0.5, 0.15, 0], weight: 0.2, stats: [['Turning', 'turn'], ['Stability', 'stability'], ['Off-road speed', 'offroad'], ['Track HP', 'trackHp']], looks: ['Stock tracks', 'Grousers', 'Wide tracks', 'Rubber-pad tracks'] },
  optics: { name: 'Optics', cost: 0.7, at: [0, 1, -0.05], weight: 0, stats: [['View range', 'view'], ['Zoom', 'zoom'], ['Thermal quality', 'thermal']], looks: ['Stock sight', 'Coated lenses', 'Stabilised sight', 'Night sight'] },
  radio: { name: 'Radio and radar', cost: 0.6, at: [0, 0.95, -0.35], weight: 0.05, stats: [['Radar range', 'radar'], ['Radar clarity', 'clarity']], looks: ['Stock radio', 'Long aerial', 'Twin aerials', 'Radar mast'] },
  ammo: { name: 'Ammo rack', cost: 0.7, at: [0, 0.6, -0.1], weight: 0.1, stats: [['Capacity', 'capacity'], ['Explosion resistance', 'rack']], looks: ['Stock rack', 'Lined rack', 'Wet storage', 'Armoured bins'] },
  extras: { name: 'Extras', cost: 0.9, at: [-0.5, 0.45, -0.1], weight: 0.6, stats: [['Side skirts', 'skirts'], ['Sandbags', 'sandbags'], ['Smoke launchers', 'smokeLaunch'], ['Spare tracks', 'spares']], looks: ['None', 'Spare tracks', 'Spare tracks, side skirts', 'Skirts, sandbags, smoke'] },
};
export const SECTIONS = Object.keys(PARTS);

// Weight a tank can carry before it slows down, in tonnes of add-ons, by tier.
export const WEIGHT_LIMIT = [0, 3, 4, 5, 6, 7];

// ---- One-stage supplies: bought in the shop, used up by the next stage you play.
export const SPECIALS = {
  repair: { name: 'Repair kit', price: 250, blurb: 'Once a stage, when your armour drops under 30%, the crew patches it back to 60%.' },
  smoke: { name: 'Smoke screen', price: 200, blurb: 'Once a stage, when your armour drops under half, smoke pops around you for 15 s.' },
  ammo: { name: 'Extra ammo', price: 150, blurb: 'Faster loading: reload 10% quicker, and twice the machine-gun belt.' },
  ap: { name: 'AP pack', price: 300, blurb: 'Better shells: +15% damage from the main gun.' },
};
export const MAX_SPECIALS = 9;
