// Story mode's fixed tables: ranks, and the tanks a crew can own. The tanks' specs live in
// shared/constants.js like every other tank's; story mode only decides when they become available.

// XP needed to reach each rank (the first is where everyone starts).
export const RANKS = [
  { name: 'Recruit', xp: 0 },
  { name: 'Private', xp: 400 },
  { name: 'Corporal', xp: 1100 },
  { name: 'Sergeant', xp: 2200 },
  { name: 'Staff Sergeant', xp: 3800 },
  { name: 'Lieutenant', xp: 6000 },
  { name: 'Captain', xp: 9000 },
  { name: 'Major', xp: 13000 },
  { name: 'Colonel', xp: 18000 },
  { name: 'General', xp: 25000 },
];

// Tier, the rank that unlocks it in the shop, and its price in silver. More arrive with the shop.
export const STORY_TANKS = {
  t26: { tier: 1, rank: 1, price: 0 },
};
export const STARTER = 't26';
export const TIERS = ['', 'I', 'II', 'III', 'IV', 'V'];
