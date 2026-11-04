# Ironclad Duo

A low-poly, first-person **co-op tank game for two players**, playable in the browser. You both crew one blue tank on a battlefield where two AI armies fight over three capture points:

- **Driver**: drives from a sealed cockpit. No window, only gauges, a short-range sweep radar and the gunner's boots dangling from the turret behind you.
- **Gunner**: sees the whole battlefield through the gun sight, aims, fires, and tells the driver where to go with voice chat and radar pings.

Everything (terrain, buildings, trees, tanks, soldiers, sounds) is generated in code. There are no downloaded assets and no game server: the two players connect directly to each other.

**▶ Play now: https://saidozen20061-stack.github.io/ironclad-duo/**

## Screenshots

> _Add screenshots or a GIF here, for example `docs/gunner.png`, `docs/driver.png`, `docs/gameplay.gif`._
>
> `![Gunner view](docs/gunner.png)` · `![Driver cockpit](docs/driver.png)`

---

## How to play with friends (2–10 players, anywhere in the world)

1. Everyone opens the game link in **Chrome, Edge or Firefox** on a computer.
2. Type a callsign. One player clicks **Host Game** and gets a **5-letter room code**.
3. The others click **Join Game** and type the code (up to 10 players = 5 tank crews).
4. In the garage lobby, click a free **Driver** or **Gunner** seat to join a crew. Each crew picks its own tank (9 classes, each with its own camo) and the host sets each crew's team (click the BLUE/RED badge, or **Auto-balance teams**).
5. The host picks the **game mode**; everyone else clicks **Ready**, then the host clicks **Start Match**.
6. Voice: hold **V** to talk to your crewmate, hold **B** to talk to your whole team. Allow the microphone when the browser asks.

The host's browser runs the battle (all the AI units), so the player with the fastest computer and best connection should host. If the host leaves, the match ends for everyone. Other players can leave and the match carries on.

### Solo
Click **Solo** in the main menu, pick a tank, a camo and a mode, and play alone (no room code, no internet needed once the page is loaded). You drive with **WASD** from a third-person camera; the turret follows the mouse, **left click** fires, **hold right click** for the gun sight (scroll = 2×/6×), **middle mouse** = machine gun, **1/2** = AP/HE, hold **R** while stopped to repair. Turretless tank destroyers only aim inside their gun arc, so turn the hull. No voice chat or pings.

### Game modes
- **Flag Capture**: hold A, B and C. Flags lower and rise as they're captured; the team with fewer flags bleeds tickets. Works with crews on both teams or all crews on Blue against the NPC army.
- **Team Deathmatch**: crews fight crews (NPC armies still fight around them). Player tank kill = 3 points, NPC tank = 1. First to the host's kill limit (10/20/30) or most points when time runs out. A team with fewer crews gets more AI tanks.
- **Fortress Defence**: all crews are Blue and hold the fortified Blue base (walls, gates, towers, bunkers, trenches, hull-down berms, a repair/ammo depot and the command bunker) against 10 waves: infantry, light tanks, heavies, artillery barrages and a boss wave. Park in the depot to repair and rearm fast. Lose the command bunker and the game is over.

When your tank is destroyed you can wait for a new tank or bail out and fight **on foot** (in every mode). Hold **Tab** for the scoreboard.

### Driver controls
| Key | Action |
| --- | --- |
| W / S | Throttle forward / reverse |
| A / D | Steer (you can spin in place) |
| Shift | Boost (limited, refills) |
| Space | Brake |
| R (hold, while stopped) | Repair the most damaged module |
| Right mouse (hold) | Look around inside the tank |
| L | Toggle free look |
| V (hold) | Push-to-talk |
| Esc | Pause menu |

The radar in the middle of the dashboard shows about 120 m around you, heading-up. Contacts light up only when the sweep passes them: **green = friendly, grey = unknown** (you can't tell infantry from tanks). Buildings, water and cliffs show as dim outlines, and A/B/C sit on the rim when they're out of range. The gunner's **ping** is a pulsing yellow marker with its distance. Look up and back to see the gunner's legs, the gun breech and the shell rack, which empties as the gunner fires.

### Gunner controls
| Input | Action |
| --- | --- |
| Click | Take the gun (captures the mouse) |
| Mouse | Aim the turret and gun (the turret turns at limited speed) |
| Left click | Fire (hold for the light tank's autocannon) |
| Scroll / right click | Zoom 1× / 2× / 6× (on the medium tank, right click is the machine gun) |
| 1 / 2 | AP / HE shells (medium tank) |
| Q or middle mouse | Ping the spot under the crosshair on the driver's radar (5 s cooldown) |
| V (hold) | Push-to-talk |
| F3 | Performance stats (FPS, draw calls, objects) |
| Esc | Pause menu |

The **orange circle** is where the gun really points; it turns green when it lines up with your crosshair. The **hull indicator** at the bottom shows which way the driver is facing compared to your view.

### Winning
Hold capture points **A** (ruined village), **B** (Hill 112) and **C** (the farm and factory). The team holding more points drains the other team's tickets, and losing units costs tickets too. A team at 0 tickets loses; after 20 minutes the team with more tickets wins.

### Damage
Hits damage the hull **and** a module depending on where they land. Front armor is strongest and the rear weakest, and angled hits can bounce off. Destroyed **tracks** stop you, a damaged **engine** slows you down (and can catch fire), a damaged **turret ring** turns slowly, a damaged **gun** is inaccurate, and damaged **radar** gets noisy and then goes blank. The driver stops and holds **R** to repair. A destroyed tank respawns at base after 15 seconds.

---

## If you can't connect

The two browsers connect directly to each other (WebRTC). The free public **PeerJS** service only introduces you to each other, and free **STUN** servers help find a route between your networks. That works for most home connections.

If joining fails with *"Could not open a direct connection"*, one of you is behind a strict network (some mobile, work, school or university networks). Then:

- try a different network (for example home Wi-Fi instead of a phone hotspot), or
- use a **TURN relay server**. Get free TURN credentials from a provider (for example Metered, Cloudflare Calls or Twilio), then **both players** enter them in **Settings → Network (TURN)**. You can also bake them into your deployed build: in your GitHub repository go to **Settings → Secrets and variables → Actions → Variables** and add `TURN_URL`, `TURN_USER` and `TURN_PASS`.

Voice chat uses the same connection settings. Browsers only allow the microphone on `https://` pages or `localhost`, and GitHub Pages is always `https://`.

---

## Windows app

[Download the installer](https://github.com/saidozen20061-stack/ironclad-duo/releases/latest/download/Ironclad-Duo-Setup.exe) and run it, and the game gets its own full-screen window and a desktop shortcut. F11 or Alt+Enter switches between full screen and a window.

Windows may warn that the app is from an unknown publisher, because it isn't code-signed: choose **More info**, then **Run anyway**.

Online, the app runs the published site, so it updates itself and always matches other players. Offline, it falls back to a built-in copy, so Solo still works.

To build the installer yourself: `npm run app`. It ends up in `desktop/release/`.

## Run it locally

Requires [Node.js](https://nodejs.org) 18 or newer.

```bash
npm install
npm run dev
```

Open http://localhost:3000. To test alone, open two browser windows side by side: host in one, join in the other. Keep the window you're controlling focused, because browsers pause background tabs. On Windows you can also double-click **Start Game.bat**.

```bash
npm run build     # static site in client/dist
npm run preview   # serve that build locally
```

## Publishing on GitHub Pages

The repository includes `.github/workflows/deploy.yml`. Every push to `main` builds the game and publishes it to `https://<user>.github.io/<repo-name>/`; the Vite base path is set from the repository name automatically. One-time setup: **Settings → Pages → Build and deployment → Source: GitHub Actions**.

---

## Project layout

```
client/              The whole game (Three.js, built with Vite)
  src/main.js        Menus, lobby, match lifecycle
  src/net.js         Peer-to-peer networking (PeerJS / WebRTC data channels)
  src/host/          Runs in the HOST's browser: lobby rules, and the authoritative
                     simulation in a Web Worker (tank physics, NPC AI, capture, tickets)
  src/game/          Match client: driver cockpit + interior, gunner sight, radar, world,
                     vegetation & props (instanced, distance LOD), sky, FX, sound
  src/models/        Procedural low-poly tank, soldier and AT-gun models
  src/voice.js       WebRTC voice chat
shared/              Map/heightmap, prop layout, tank kinematics, constants
.github/workflows/   GitHub Pages deployment
```

The simulation runs at 20 ticks per second in the host's Web Worker and sends snapshots to both players; clients render about 100 ms behind with interpolation. The map, every building and every tree come from fixed seeds, so they never travel over the network.

## License

[MIT](LICENSE), except the radio voice recordings in `client/public/audio`: "Radio Soldier" by [VoiceBosch](https://voicebosch.itch.io/radio-soldier-announcer-audio-pack), [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
