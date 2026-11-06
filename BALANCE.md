# Story mode balance

Made by `node scripts/storyBalance.mjs [runs]`, which plays the whole campaign with a simple player model
using the game's own reward, tank and stage code. The model plays every stage in map order (side stages
too), retries a lost stage until it wins, buys the cheapest tank it doesn't own as soon as rank and
silver allow, drives its strongest tank and spends about a quarter of its silver on parts. Its win
chance and stars depend on its combat rating against the stage's.

Rewards follow the spec (Easy 300, Normal 500, Hard 900, Special 700, Boss 1500; kills, victory +50%,
defeat 30%, first clear +50%, new star +100, no tank lost +150, accuracy over 60% +100, replays 60%; XP the
same). One change: the stage reward is multiplied by the chapter (×1, ×2.2, ×3.6, ×5.2, ×6.8). With flat
rewards, tier IV and V tanks were 11 to 23 stages apart.

Where it misses the target: tanks come about every 7 stages (target 3 to 6). Tier II comes after 4, and
the same tier's other tanks after 4, but the first tank of a new tier takes 7 to 8. Lowering the tier IV
and V prices below the spec's ranges would close it.

Simulated 300 campaigns (56 stages, retrying lost ones).

### Silver per stage played

| Chapter | Stages | Median silver per stage | Median per first-clear win | Stages played by the boss | Rank at the end | Tier at the end | Combat rating at the end | Boss rating |
|---|---|---|---|---|---|---|---|---|
| 1. Farmlands | 12 | 1474 | 1560 | 14 | Staff Sergeant | 3 | 925 | 582 |
| 2. River Crossing | 11 | 3160 | 2805 | 26 | Captain | 3 | 1010 | 885 |
| 3. Winter Front | 11 | 5175 | 4290 | 39 | Colonel | 4 | 1354 | 1158 |
| 4. City Ruins | 11 | 6833 | 5935 | 54 | General | 5 | 1831 | 1697 |
| 5. The Fortress Line | 11 | 10991 | 12800 | 66 | General | 5 | 2421 | 1697 |

### Tanks, in the order the model buys them

| Tank | Tier | Price | Rank needed | Bought at stage (median) | Stages since the tank before |
|---|---|---|---|---|---|
| stuart | 2 | 3,000 | Corporal | 4 | 4 |
| stug | 3 | 8,000 | Sergeant | 12 | 8 |
| sherman | 3 | 9,000 | Sergeant | 16 | 4 |
| hellcat | 3 | 10,000 | Sergeant | 21 | 4 |
| t3485 | 4 | 18,000 | Lieutenant | 28 | 7 |
| panther | 4 | 22,000 | Lieutenant | 35 | 7 |
| kv2 | 5 | 35,000 | Captain | 43 | 8 |
| is2 | 5 | 38,000 | Captain | 51 | 8 |
| tiger | 5 | 45,000 | Captain | 58 | 7 |

Median stages between tank purchases: 7. First tier II at stage 4, tier III 12, tier IV 28, tier V 43.

Part buys or upgrades: median gap 1 stage(s) between stages where one is bought; 132 in a campaign.

### Prices

| Part | Improved | Elite | Experimental | Upgrade 1→2 | Upgrade 4→5 |
|---|---|---|---|---|---|
| Gun | 1170 | 3380 | 8450 | 286 | 1144 |
| Turret | 900 | 2600 | 6500 | 220 | 880 |
| Hull armour | 1080 | 3120 | 7800 | 264 | 1056 |
| Engine | 990 | 2860 | 7150 | 242 | 968 |
| Tracks | 720 | 2080 | 5200 | 176 | 704 |
| Optics | 630 | 1820 | 4550 | 154 | 616 |
| Radio and radar | 540 | 1560 | 3900 | 132 | 528 |
| Ammo rack | 630 | 1820 | 4550 | 154 | 616 |
| Extras | 810 | 2340 | 5850 | 198 | 792 |
