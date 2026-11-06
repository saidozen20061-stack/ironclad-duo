# Story mode progress

Tanks only, solo first, co-op last. Each phase is committed, pushed and live before the next starts.
Code: `client/src/story/` (data, save, hub). Save key in localStorage: `ironclad-story`.

- [x] Phase 1: Story Mode button, garage hub (tank on the turntable, four signs, rank/XP/silver/tank bar), save with export/import/reset, Tier I starter "Sparrow" (T-26 style)
- [ ] Phase 2: war map chapter 1 (Farmlands), stage runner with objectives, results screen with silver and XP, stars
- [ ] Phase 3: shop and motor pool, Tier II to V tanks
- [ ] Phase 4: workshop: parts, hotspots, upgrades, weight, combat rating
- [ ] Phase 5: chapters 2 to 5, bosses, plane (special) stages, chapter story text
- [ ] Phase 6: balance simulation, BALANCE.md
- [ ] Phase 7: co-op story with one friend

Notes
- The hub reuses the update screen's picture (`client/public/garage.jpg`) as its background.
- Not built yet: everything behind War Map, Shop and Workshop shows "Opens in the next update".

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
