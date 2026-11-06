# Story mode progress

Tanks only, single-player. Each phase is committed, pushed and live before the next starts.
Code: `client/src/story/` (data, save, hub, map, shop, workshop, tanks, looks, rewards, stages) and
`client/src/host/storyMode.js` (the stage runner). Save key in localStorage: `ironclad-story` (version 2).

- [x] Phase 1: Story Mode button, garage hub (tank on the turntable, four signs, rank/XP/silver/tank bar), save with export/import/reset, Tier I starter "Sparrow" (T-26 style)
- [x] Phase 2: war map, briefing card, stage runner with objectives, in-match objective bar, results screen with counted-up silver and XP, stars
- [x] Phase 3: shop (tanks, parts, specials, a 20% offer after each stage, sell for half), motor pool, tier II to V tanks
- [x] Phase 4: workshop: hotspots with camera zoom, equip/upgrade/buy, parts shown on the model, weight bar, combat rating
- [x] Phase 5: chapters 2 to 5 (56 stages), five bosses, plane stages, snow for Winter Front, story text between chapters
- [x] Phase 6: balance simulation (`scripts/storyBalance.mjs`), BALANCE.md
- [x] Phase 7: removed: story mode is single-player
- [x] 3D garage: the hub and workshop are a 3D workshop hall (`client/src/scenes/storyGarage.js`) with the tank on a floor turntable and a low three-quarter camera

Tests: `stagetest` (headless, every stage starts and can be won; losing when out of tanks) and a muted
two-window run (shop, workshop, war map, snowy stage, results).

Simplifications
- Story tanks reuse the battle models with their own stats, names and paint; the Bobcat keeps the Hornet's
  rapid-fire gun.
- Optics and radio parts only raise the combat rating. Fire resistance, track HP, stability and ammo-rack
  explosion resistance are shown but don't change the battle yet.
- Parts show on the garage turntable, not on the tank in battle.
- Chapter 5 is fought around Hill 112 and the enemy base, without new fortress buildings.

---

# Big update progress

Spec phases: 1 bug fixes, 2 difficulty, 3 thermal, 3.5 tank preview, 4 war atmosphere, 5 planes, then a performance pass.
Each finished phase is committed, pushed and live.

- [x] Phase 1: flicker, structure gaps, far tanks (dev check: `structureCheck.js`)
- [x] Phase 2: Easy/Normal/Hard NPC difficulty
- [x] Phase 3: thermal view (T)
- [x] Phase 3.5: turntable tank preview
- [x] Phase 4: war atmosphere
- [x] Phase 5: planes (host/planes.js, models/planes.js, game/planeViews.js)
- [x] Final: performance check, auto quality, summary

Not testable here (needs real PCs): real FPS with 10 players, real audio, players on different networks.
