# Ironclad Duo

A low-poly, first-person **co-op tank game for two players**, playable in the browser. You both crew one blue tank on a battlefield where two AI armies fight over three capture points:

- **Driver**: drives from a sealed cockpit. No window, only gauges, a short-range sweep radar and the gunner's boots dangling from the turret behind you.
- **Gunner**: sees the whole battlefield through the gun sight, aims, fires, and tells the driver where to go with voice chat and radar pings.

Everything (terrain, buildings, trees, tanks, soldiers, sounds) is generated in code. There are no downloaded assets and no game server: the two players connect directly to each other.

**▶ Play now: https://YOUR-GITHUB-USERNAME.github.io/ironclad-duo/** *(replace with your link after the first deploy)*

## Screenshots

> _Add screenshots or a GIF here, for example `docs/gunner.png`, `docs/driver.png`, `docs/gameplay.gif`._
>
> `![Gunner view](docs/gunner.png)` · `![Driver cockpit](docs/driver.png)`

---

## How to play with a friend (anywhere in the world)

1. Both open the game link in **Chrome, Edge or Firefox** on a computer.
2. Type a callsign. One of you clicks **Host Game** and gets a **5-letter room code**.
3. The other clicks **Join Game** and types the code.
4. In the lobby each player picks **Driver** or **Gunner**; the host picks the tank: **Hornet** (light, fast, autocannon), **Warden** (medium, AP/HE + machine gun) or **Bastion** (heavy, huge slow gun).
5. Both click **Ready**. Allow the microphone when the browser asks, then talk with **V** (push-to-talk) or switch to open mic in Settings.

The host's browser runs the battle (all the AI units), so the player with the faster computer and the better internet connection should host. Keep the game tab open; minimising it is fine.

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

[MIT](LICENSE)
