import { AaGuns } from './aaGuns.js';
import * as THREE from 'three';
import { TANKS, UNITS, FOOT } from '../../../shared/constants.js';
import { PLANES } from '../../../shared/planes.js';
import { planeViewFor } from './planeViews.js';
import { POINTS, groundAt, riverZ, RIVER_HALF_WIDTH, PLAY_LIMIT, inAirfield } from '../../../shared/map.js';
import { PROPS, TREE_NOISE, setFortress } from '../../../shared/props.js';
import { keyName } from '../keybinds.js';
import { net } from '../net.js';
import { renderer } from '../render.js';
import { voice } from '../voice.js';
import { SnapshotBuffer } from './snapshots.js';
import { World } from './world.js';
import { UnitsView } from './units.js';
import { FX } from './fx.js';
import { Keys } from './input.js';
import { GunnerView } from './gunner.js';
import { DriverView } from './driver.js';
import { PropsView } from './props.js';
import { TrackMarks } from './tracks.js';
import { AmbientWar } from './ambient.js';
import { SoundScape } from './sound.js';
import { showTutorial } from './tutorial.js';
import { SoldierView } from './soldier.js';
import { SoloView } from './solo.js';
import { Spotter } from './spot.js';
import { WarFX } from './warfx.js';
import { checkStructures } from './structureCheck.js';
import { nearGarage } from '../../../shared/foot.js';
import { escapeHtml } from '../ui/screens.js';

const isWorldView = (v) => v instanceof GunnerView || !!v.isFoot;

// Glue for a running match: receives server snapshots, routes events to effects,
// and drives the role-specific view (driver cockpit or gunner sight).
export class MatchClient {
  constructor({ role, tank, crew, info, onPause }) {
    this.isMatch = true;
    this.role = role;
    this.tank = tank;
    this.crew = crew ?? { id: 0, team: 'blue', tank };
    this.team = this.crew.team;
    this.info = info ?? { mode: 'flags', crews: [this.crew], names: {} };
    this.mode = this.info.mode;
    this.names = this.info.names ?? {};
    this.crewList = this.info.crews ?? [this.crew];
    // Fortress Defence puts walls, towers and bunkers on the map (before any world is built).
    setFortress(this.mode === 'fortress');
    this.onPause = onPause;
    this.paused = false;
    this.lastUnlock = 0;
    this.buffer = new SnapshotBuffer();
    this.me = null;
    this.keys = new Keys();
    this.hud = document.getElementById('hud-root');

    this.feed = document.createElement('div');
    this.feed.className = 'killfeed';
    this.hud.appendChild(this.feed);

    // Capture points + tickets + timer, top centre for both roles.
    this.capEl = document.createElement('div');
    this.capEl.className = 'cap-hud';
    const tdm = this.mode === 'tdm';
    this.capEl.innerHTML = `
      <div class="tix blue"><small>BLUE${tdm ? ' KILLS' : ''}</small><b>${tdm ? 0 : 500}</b></div>
      ${tdm ? '' : POINTS.map((p) => `<div class="cap" data-pt="${p.id}"><span>${p.id}</span></div>`).join('')}
      <div class="tix red"><small>RED${tdm ? ' KILLS' : ''}</small><b>${tdm ? 0 : 500}</b></div>
      <div class="clock">20:00</div>${tdm ? `<div class="goal">First to ${this.info.killLimit}</div>` : ''}`;
    if (this.mode === 'fortress') {
      this.capEl.classList.add('fort');
      this.capEl.innerHTML = `<div class="wave"><small>WAVE</small><b>0/10</b></div><div class="wave-info"></div><div class="bunker"><small>COMMAND BUNKER</small><i><u></u></i></div>`;
    }
    if (this.mode === 'story') {
      this.capEl.classList.add('fort', 'story');
      this.capEl.innerHTML = `<div class="wave"><small>OBJECTIVE</small><b></b><span class="wave-info"></span></div><div class="lives"><small>TANKS</small><b></b></div><div class="clock"></div><div class="bunker boss" hidden><small></small><i><u></u></i></div>`;
    }
    this.hud.appendChild(this.capEl);
    this.flagTarget = {};

    // Scoreboard (hold Tab) and floating names over other player crews.
    this.boardEl = document.createElement('div');
    this.boardEl.className = 'scoreboard';
    this.hud.appendChild(this.boardEl);
    this.stats = this.crewList.map((c) => [c.id, 0, 0, 0]);
    this.npcStats = [];
    this.tagsEl = document.createElement('div');
    this.tagsEl.className = 'name-tags';
    this.hud.appendChild(this.tagsEl);
    this.tagEls = new Map();
    this.teamPings = [];
    this.points = POINTS.map((p) => ({ id: p.id, owner: null, progress: 0, contested: false }));

    // Point colours feed the radar, minimap and in-world flags.
    this.pointColor = (id) => {
      const p = this.points.find((q) => q.id === id);
      return p?.owner === 'blue' ? '#5fa0e0' : p?.owner === 'red' ? '#e0645a' : '#e6e1cf';
    };
    this.solo = role === 'solo';
    if (role === 'gunner' || this.solo) this.ensureWorld();
    this.view = this.makeTankView();

    // Voice: who's talking + how to talk.
    this.voiceEl = document.createElement('div');
    this.voiceEl.className = 'voice-hud';
    if (role === 'solo') this.voiceEl.style.display = 'none'; // no voice chat in solo
    this.hud.appendChild(this.voiceEl);
    const mateId = this.crew.driver === net.id ? this.crew.gunner : this.crew.driver;
    const renderVoice = (sp) => {
      // You, your crewmate, then whoever on the team is talking right now.
      const others = [...sp.remote].filter(([id, on]) => on && id !== mateId).map(([id]) => id);
      const chan = sp.local ? `<span class="chan ${sp.channel}">${sp.channel === 'team' ? 'TEAM' : 'CREW'}</span>` : '';
      this.voiceEl.innerHTML = `
        <div class="voice-row"><i class="speak-dot${sp.local ? ' on' : ''}"></i>You <small>${role}</small>${chan}</div>
        ${mateId != null ? `<div class="voice-row"><i class="speak-dot${sp.remote.get(mateId) ? ' on' : ''}"></i>${escapeHtml(this.names[mateId] ?? 'Crewmate')}<span class="chan crew">CREW</span></div>` : ''}
        ${others.map((id) => `<div class="voice-row"><i class="speak-dot on"></i>${escapeHtml(this.names[id] ?? 'Teammate')}<span class="chan">TEAM</span></div>`).join('')}
        <div class="voice-hint">${voice.hint()}</div>`;
    };
    renderVoice(voice.speaking);

    this.off = [net.on('s', (msg) => this.onSnapshot(msg)), voice.onChange(renderVoice)];

    // Leaving the playable area: a warning for both crew members.
    this.edgeEl = document.createElement('div');
    this.edgeEl.className = 'edge-warn';
    this.edgeEl.innerHTML = 'RETURN TO THE BATTLE<small>You are leaving the battlefield</small>';
    this.hud.appendChild(this.edgeEl);
    // Fixed fire sources (burning wrecks) for crackle audio — the driver has no props view.
    this.fires = PROPS.filter((p) => p.type === 'wreck' && p.burning);

    const planeSpec = PLANES[tank];
    this.sound = new SoundScape(planeSpec ? 'gunner' : role); // no steel hull around a pilot
    if (planeSpec) this.sound.buildPlane(planeSpec);
    if (this.war) this.war.sound = this.sound;
    this.distantT = 3;
    this.lastReload = 0;
    showTutorial(planeSpec ? (role === 'gunner' ? (planeSpec.operator ? 'planeOperator' : 'planeGunner') : planeSpec.heli ? (role === 'solo' ? 'heliSolo' : 'heliPilot') : role === 'solo' ? 'planeSolo' : 'pilot') : role, this.hud);

    // Tank destroyed: both crew members choose between waiting for a tank and bailing out.
    this.choiceEl = document.createElement('div');
    this.choiceEl.className = 'bail-choice';
    this.choiceEl.innerHTML = `
      <h2>${planeSpec ? 'PLANE' : 'TANK'} DESTROYED</h2>
      <p>${role === 'solo' ? `Wait for a new ${planeSpec ? 'plane' : 'tank'}, or bail out and fight on.` : "Pick together. If you disagree, the driver's choice wins."}</p>
      <div class="bail-opts">
        <button data-pick="tank"><b>${keyName('death.respawn')}</b>RESPAWN WITH ${planeSpec ? 'PLANE' : 'TANK'}<small>New ${planeSpec ? 'plane at the airfield' : 'tank at base'} after 15 s</small></button>
        <button data-pick="foot"><b>${keyName('death.foot')}</b>GO ON FOOT<small>Bail out next to the wreck and keep fighting</small></button>
      </div>
      <button class="bail-skip" data-skip="1"><b>${keyName('death.skip')}</b>SKIP TIMER</button>
      <div class="bail-timer"><i></i></div>
      <div class="bail-picks"></div>`;
    this.choiceEl.addEventListener('click', (e) => {
      // Mouse only: a click made by the keyboard (Space on a focused button) has no detail.
      if (e.detail === 0) return;
      if (e.target.closest('button[data-skip]')) return this.skipChoice();
      const b = e.target.closest('button[data-pick]');
      if (b) net.send({ t: 'bail', pick: b.dataset.pick });
    });
    // These buttons never hold keyboard focus, so Space (brake, jump, bombs) can't reach them.
    this.choiceEl.addEventListener('mousedown', (e) => e.preventDefault());
    for (const b of this.choiceEl.querySelectorAll('button')) b.tabIndex = -1;
    document.activeElement?.blur?.();
    this.hud.appendChild(this.choiceEl);

    // Solo: skip the wait for a new vehicle.
    this.respawnSkipEl = document.createElement('button');
    this.respawnSkipEl.className = 'bail-skip respawn-skip';
    this.respawnSkipEl.tabIndex = -1;
    this.respawnSkipEl.innerHTML = `<b>${keyName('death.skip')}</b>SKIP WAIT`;
    this.respawnSkipEl.addEventListener('mousedown', (e) => e.preventDefault());
    this.respawnSkipEl.addEventListener('click', (e) => {
      if (e.detail !== 0) this.skipRespawn();
    });
    this.hud.appendChild(this.respawnSkipEl);

    this.onLockChange = () => {
      const locked = document.pointerLockElement === document.getElementById('scene');
      if (!locked) {
        this.lastUnlock = performance.now();
        // Losing the pointer (Esc) during play opens the pause menu (not while swapping views).
        const aimed = this.view instanceof GunnerView || this.view.isFoot || this.view.look?.free;
        if (!this.paused && aimed && performance.now() - (this.swapAt ?? 0) > 500) this.pause();
      }
    };
    document.addEventListener('pointerlockchange', this.onLockChange);
  }

  // A shell or bomb landed close by: camera shake and ringing ears.
  nearBlast(k) {
    this.camShake = Math.min(1, Math.max(this.camShake ?? 0, k));
    if (k > 0.25) this.sound.shellShock(k);
  }

  // World, units and effects: built up front for the gunner, on first bail-out for the driver.
  ensureWorld() {
    if (this.world) return;
    this.world = new World();
    this.units = new UnitsView(this.world.scene);
    // Solo: the player's tank wears the camo picked in the setup screen.
    this.units.paintFor = (u) => (this.solo && u.crew === this.crew.id && u.player ? this.info.paint : null);
    this.fx = new FX(this.world.scene);
    this.props = new PropsView(this.world.scene);
    this.aaGuns = new AaGuns(this.world.scene);
    if (import.meta.env.DEV) checkStructures();
    this.tracks = new TrackMarks(this.world.scene, this.fx);
    this.ambient = new AmbientWar(this.world.scene);
    this.ambient.onSound = (kind, pos) => (kind === 'artillery' ? this.sound.distantArtillery(pos) : this.sound.plane());
    this.war = new WarFX(this.world, this.fx, this.props, this.sound);
    this.war.onNearBlast = (k) => this.nearBlast(k);
    this.props.setEnvMap(this.world.envMap);
    for (const p of this.points) this.recolorPoint(p.id, p.owner);
    // Capture flags and zones belong to Flag Capture only.
    this.world.showFlags(this.mode === 'flags');
    this.props.showZones(this.mode === 'flags');
  }

  makeTankView() {
    const tank = this.tank;
    let v;
    if (PLANES[tank]) {
      this.ensureWorld();
      v = planeViewFor(this.role, { world: this.world, units: this.units, tank, hud: this.hud, keys: this.keys });
      v.deadProps = this.props.dead;
    } else if (this.solo) {
      v = new SoloView({ world: this.world, units: this.units, tank, hud: this.hud, keys: this.keys });
      v.deadProps = this.props.dead;
    } else if (this.role === 'gunner') {
      v = new GunnerView({ world: this.world, units: this.units, tank, hud: this.hud, keys: this.keys });
      v.deadProps = this.props.dead;
    } else v = new DriverView({ tank, hud: this.hud, keys: this.keys });
    if (v.radar) {
      v.radar.pointColor = this.pointColor;
      v.radar.hidePoints = this.mode !== 'flags';
    }
    v.pointColor = this.pointColor;
    v.hidePoints = this.mode !== 'flags';
    v.drawExtraMinimap = (ctx, toMap) => this.drawTeamPings(ctx, toMap);
    v.team = this.team;
    return v;
  }

  // Other crews' pings on our team: cyan rings on the minimap (our own crew's ping is yellow).
  drawTeamPings(ctx, toMap) {
    for (const [, x, z] of this.teamPings) {
      const [px, py] = toMap(x, z);
      ctx.strokeStyle = '#4fe0e8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(Math.max(6, Math.min(194, px)), Math.max(6, Math.min(194, py)), 5, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // Someone took an empty seat during the match.
  setCrewNames(crews, names) {
    this.crewList = crews;
    this.names = names;
  }

  crewLabel(c) {
    return `${PLANES[c?.tank] ? 'Plane' : 'Tank'} ${(c?.id ?? 0) + 1}`;
  }

  // One name per player, even when one player holds both seats (solo).
  crewPlayers(c) {
    return [...new Set([c.driver, c.gunner])].map((p) => this.names[p]).filter(Boolean);
  }

  crewName(id) {
    const c = this.crewList.find((q) => q.id === id);
    if (!c) return `Tank ${id + 1}`;
    const n = this.crewPlayers(c);
    return `${this.crewLabel(c)}${n.length ? ` (${n.join(' & ')})` : ''}`;
  }

  scoreboardHtml(stats = this.stats, npcs = this.npcStats) {
    const caps = this.mode !== 'fortress'; // no capture points to count there
    const row = (c) => {
      const st = stats.find((q) => q[0] === c.id) ?? [c.id, 0, 0, 0];
      const n = this.crewPlayers(c).map(escapeHtml).join(' & ') || '—';
      return `<tr class="${c.id === this.crew.id ? 'mine' : ''}"><td>${this.crewLabel(c)}<small>${n}</small></td><td>${st[1]}</td><td>${st[2]}</td>${caps ? `<td>${st[3]}</td>` : ''}</tr>`;
    };
    // NPC tanks and planes: busiest first. One line each, greyed out while waiting for their next vehicle.
    const npcRow = ([, kind, no, type, kills, deaths, alive]) => {
      const spec = kind ? PLANES[type] : TANKS[type];
      return `<tr class="npc${alive ? '' : ' down'}"><td>NPC ${kind ? 'Plane' : 'Tank'} ${no}<small>${spec?.name ?? ''}</small></td><td>${kills}</td><td>${deaths}</td>${caps ? '<td></td>' : ''}</tr>`;
    };
    return ['blue', 'red']
      .map((team, t) => {
        const crews = this.crewList.filter((c) => c.team === team);
        const army = npcs.filter((n) => n[0] === t).sort((a, b) => b[4] - a[4] || a[5] - b[5] || a[1] - b[1] || a[2] - b[2]);
        const body = crews.map(row).join('') + army.map(npcRow).join('');
        return `<div class="${team}"><h4>${team === 'blue' ? 'BLUE' : 'RED'}</h4><table><tr><th>Crew</th><th>Kills</th><th>Deaths</th>${caps ? '<th>Caps</th>' : ''}</tr>${body}</table></div>`;
      })
      .join('');
  }

  // Names over other player crews' tanks / soldiers in view.
  updateTags(states) {
    if (!this.world || !(this.view instanceof GunnerView || this.view.isFoot)) {
      this.tagsEl.style.display = 'none';
      return;
    }
    this.tagsEl.style.display = '';
    const cam = this.view.camera;
    const seen = new Set();
    const v = new THREE.Vector3();
    for (const u of states.values()) {
      if (u.crew == null || u.dead || u.crew === this.crew.id) continue;
      const d = Math.hypot(u.x - cam.position.x, u.z - cam.position.z);
      if (d > 450) continue;
      // Enemy names only when spotted, never through a hill.
      if (u.team !== this.team && !(this.spotter ??= new Spotter()).sees(u, cam.position, 450, this.props?.dead)) continue;
      const m = this.units.get(u.id);
      v.set(u.x, (m?.pose.y ?? 0) + (TANKS[u.type] ?? PLANES[u.type] ? (TANKS[u.type] ?? PLANES[u.type]).size.height + 1.6 : 2.3), u.z).project(cam);
      if (v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) continue;
      seen.add(u.id);
      let el = this.tagEls.get(u.id);
      if (!el) {
        el = document.createElement('div');
        el.className = `name-tag ${u.team}`;
        this.tagsEl.appendChild(el);
        this.tagEls.set(u.id, el);
      }
      el.textContent = this.crewName(u.crew);
      el.style.left = `${((v.x + 1) / 2) * 100}%`;
      el.style.top = `${((1 - v.y) / 2) * 100}%`;
      el.style.opacity = d > 300 ? 0.6 : 1;
    }
    for (const [id, el] of this.tagEls) {
      if (!seen.has(id)) {
        el.remove();
        this.tagEls.delete(id);
      }
    }
  }

  // Swap between the tank view (driver / gunner) and the on-foot soldier view.
  setFoot(on) {
    this.swapAt = performance.now();
    this.view.dispose();
    if (on) {
      this.ensureWorld();
      this.view = new SoldierView({ world: this.world, units: this.units, props: this.props, sound: this.sound, hud: this.hud, keys: this.keys, role: this.solo ? 'driver' : this.role, team: this.team });
      this.view.noPing = this.solo;
      this.view.pointColor = this.pointColor;
      this.view.hidePoints = this.mode !== 'flags';
      const mate = this.view.drawExtraMinimap;
      this.view.drawExtraMinimap = (ctx, toMap) => {
        mate(ctx, toMap);
        this.drawTeamPings(ctx, toMap);
      };
    } else this.view = this.makeTankView();
    this.view.resize(window.innerWidth, window.innerHeight);
    if (this.paused) this.view.setPaused?.(true);
  }

  // The host gave the crew another vehicle (their plane can't be replaced).
  setVehicle(type) {
    this.tank = type;
    const own = this.crewList.find((c) => c.id === this.crew.id);
    if (own) own.tank = type; // the scoreboard calls the crew by what it's in
    this.sound.stopPlane();
    if (!this.view.isFoot) this.setFoot(false);
  }

  // The plane's gone for good: the choice now offers a tank, and everyone in the crew is told once.
  showNoPlanes() {
    this.noPlanesShown = true;
    this.choiceEl.querySelector('h2').textContent = 'LEVIATHAN LOST';
    this.choiceEl.querySelector('p').textContent = 'Leviathan lost - assigned to tank crew';
    this.choiceEl.querySelector('button[data-pick="tank"]').innerHTML = `<b>${keyName('death.respawn')}</b>RESPAWN WITH RANDOM TANK<small>No more planes this match. New tank at base after 15 s</small>`;
    const row = document.createElement('div');
    row.className = 'feed-row';
    row.textContent = 'Leviathan lost - assigned to tank crew';
    this.feed.prepend(row);
    setTimeout(() => row.remove(), 7000);
  }

  // Ends the choice countdown once the whole crew has pressed it.
  skipChoice() {
    net.send({ t: 'bailSkip' });
    this.choiceEl.querySelector('.bail-skip').classList.add('sel');
  }

  updateChoice(crew) {
    const on = crew?.mode === 'choice';
    this.choiceEl.classList.toggle('show', on);
    this.hud.classList.toggle('choosing', on); // the choice replaces the plain "destroyed" notice
    if (!on) this.choiceEl.querySelector('.bail-skip').classList.remove('sel');
    if (!on) return;
    this.choiceEl.querySelector('.bail-timer i').style.width = `${(crew.left / FOOT.choiceTime) * 100}%`;
    const mine = crew.picks?.[this.solo ? 'driver' : this.role];
    const other = crew.picks?.[this.role === 'driver' ? 'gunner' : 'driver'];
    for (const b of this.choiceEl.querySelectorAll('button')) b.classList.toggle('sel', b.dataset.pick === mine);
    const name = (p) => (p === 'foot' ? 'GO ON FOOT' : p === 'tank' ? (this.noPlanesShown ? 'RANDOM TANK' : `RESPAWN WITH ${PLANES[this.tank] ? 'PLANE' : 'TANK'}`) : '…');
    this.choiceEl.querySelector('.bail-picks').innerHTML = this.solo
      ? `You: <b>${name(mine)}</b> · ${Math.ceil(crew.left)}s`
      : `You: <b>${name(mine)}</b> · ${this.role === 'driver' ? 'Gunner' : 'Driver'}: <b>${name(other)}</b> · ${Math.ceil(crew.left)}s`;
  }

  // Planes are drawn slightly in the past, so shots start from where the plane appears to be.
  fromDrawnPlane(ev) {
    if (!ev.air) return ev;
    const drawn = this.units?.models.get(ev.o)?.root.position;
    const host = this.buffer.latest?.units.get(ev.o);
    if (!drawn || !host) return ev;
    const dx = drawn.x - host.x, dy = drawn.y - host.y, dz = drawn.z - host.z;
    if (Math.hypot(dx, dy, dz) > 40) return ev;
    return { ...ev, x: ev.x + dx, y: ev.y + dy, z: ev.z + dz };
  }

  skipRespawn() {
    net.send({ t: 'respawnSkip' });
  }

  onSnapshot(msg) {
    this.buffer.push(msg);
    // Reload finished: clank for the crew.
    if (this.me && this.me.reload > 0 && msg.me.reload === 0 && !msg.me.dead) this.sound.reloadClank();
    this.me = msg.me;
    if (msg.me.noPlanes && !this.noPlanesShown) this.showNoPlanes();
    if (msg.me.vehicle && msg.me.vehicle !== this.tank && !this.ended) this.setVehicle(msg.me.vehicle);
    const foot = msg.me.crew?.mode === 'foot';
    if (foot !== !!this.view.isFoot && !this.ended) this.setFoot(foot);
    this.updateChoice(msg.me.crew);
    // Full destroyed-prop list (no effects: these may be old news, e.g. after joining).
    if (msg.pd && this.props) this.props.setDestroyed(msg.pd.filter((id) => !this.props.dead.has(id)), null);
    if (msg.pts) this.updateCapture(msg);
    if (msg.fort) this.updateFort(msg.fort);
    if (msg.story) this.updateStory(msg.story);
    if (msg.sb) {
      this.stats = msg.sb;
      this.npcStats = msg.npcs ?? [];
      if (this.boardEl.classList.contains('show')) this.boardEl.innerHTML = this.scoreboardHtml();
    }
    // Pings from the other crews on our team.
    this.teamPings = (msg.pings ?? []).filter((p) => p[0] !== this.crew.id && (p[1] === 0 ? 'blue' : 'red') === this.team).map((p) => [p[0], p[2], p[3]]);
    for (const ev of msg.ev ?? []) this.onEvent(ev);
  }

  onEvent(ev) {
    const myId = this.me?.id;
    const driver = this.view instanceof DriverView;
    const gunner = this.view instanceof GunnerView;
    if (this.view.isFoot) this.view.onEvent(ev);
    this.units?.onEvent(ev, this.buffer.latest?.units ?? new Map());
    switch (ev.k) {
      case 'f': {
        if (ev.tur != null) this.aaGuns?.onShot(ev);
        // Our own soldier's shots already played locally.
        // A dropped rocket is silent until its motor lights.
        if (!ev.coast && !(this.view.isFoot && ev.o === this.view.myId)) this.sound.shot(ev.kind, ev, ev.o === myId);
        if (ev.o === myId && gunner) this.view.kick = ev.kind === 'heavy' ? 0.05 : ev.kind === 'mg' ? 0.002 : ev.kind === 'ac' ? 0.008 : 0.03;
        if (this.fx) {
          const shot = this.fromDrawnPlane(ev);
          this.fx.onIgnite ??= (p) => this.sound.shot('rocket', p, p.o === this.me?.id);
          this.fx.spawnProjectile(shot);
          const pos = new THREE.Vector3(shot.x, shot.y, shot.z);
          const dir = new THREE.Vector3(ev.vx, ev.vy, ev.vz).normalize();
          if (!ev.coast) this.fx.muzzleFlash(pos, dir, ev.air && ev.kind === 'mg' ? 'ac' : ev.kind);
        }
        if (ev.o === myId && driver) {
          if (ev.kind !== 'mg') this.view.addShake(ev.kind === 'heavy' ? 0.5 : ev.kind === 'ac' ? 0.05 : 0.3);
          this.view.onOwnFire(ev.kind);
        }
        break;
      }
      case 'i':
        this.sound.impact(ev, ev.u === myId);
        if (['he', 'heavy', 'ap', 'rocket'].includes(ev.kind)) this.world?.skyLife.scare(ev, ev.kind === 'heavy' ? 260 : 160);
        if (['he', 'heavy', 'rocket', 'grenade'].includes(ev.kind)) this.view.thermalFlash?.(ev.x, ev.y, ev.z, ev.kind === 'heavy' ? 1 : 0.5);
        if (this.fx) {
          this.fx.removeProjectile(ev.id);
          // A bomb hitting the ground is the same thing as a heavy shell landing.
          if (ev.kind === 'bomb' && ev.r !== 'armor' && this.war && isWorldView(this.view)) this.war.impact({ x: ev.x, y: ev.y, z: ev.z, size: 1.1 }, this.view.camera.position);
          else this.fx.impact(ev);
        }
        if (ev.u === myId && driver) {
          const small = ev.kind === 'mg' || ev.kind === 'rifle';
          this.view.addShake(small ? 0.05 : 0.8);
          this.view.onHit(!small);
        }
        if (ev.o === myId && ev.u && gunner && ev.r !== 'ric') this.view.showHit(false);
        if (ev.o === myId && ev.r === 'ric' && gunner) this.view.showBanner('RICOCHET');
        break;
      case 'cap':
        this.addFeed(ev);
        if (ev.team && (gunner || this.view.isFoot)) this.view.showBanner(`${ev.team === this.team ? 'WE' : 'ENEMY'} CAPTURED ${ev.id}`);
        if (ev.team && driver) this.view.flash?.(`${ev.team === this.team ? 'WE' : 'ENEMY'} CAPTURED ${ev.id}`);
        break;
      case 'mod':
      case 'fixed': {
        if (ev.u !== myId || this.view.isFoot) break;
        const name = { tracks: 'TRACKS', engine: 'ENGINE', turret: 'TURRET RING', gun: 'GUN', radar: 'RADAR', fire: 'ENGINE', engine2: 'ENGINE 2', wingL: 'LEFT WING', wingR: 'RIGHT WING', tail: 'TAIL', fuel: 'FUEL TANK', gear: 'LANDING GEAR', guns: 'GUNS', crew: 'SIDE GUNNER' }[ev.m] ?? ev.m;
        const text = ev.k === 'fixed' ? `${name} REPAIRED` : ev.m === 'fire' ? 'ENGINE FIRE!' : `${name} ${ev.state === 'destroyed' ? 'DESTROYED' : 'DAMAGED'}`;
        if (gunner) this.view.showBanner(text);
        else {
          this.view.flash(text);
          if (ev.k === 'mod') this.view.onModule(ev.state ?? 'damaged');
        }
        break;
      }
      case 'kit':
        // Story supplies: a smoke screen thrown round the tank, or the crew's repair kit.
        if (ev.u === myId) this.banner(ev.what === 'smoke' ? 'SMOKE SCREEN!' : 'REPAIR KIT USED');
        this.smokeMat ??= new THREE.MeshStandardMaterial({ color: 0xc9cbc4, flatShading: true, transparent: true, opacity: 0.8, depthWrite: false });
        if (ev.what === 'smoke' && this.fx) for (let i = 0; i < 28; i++) {
          const a = Math.random() * Math.PI * 2, r = 3 + Math.random() * 17;
          const x = ev.x + Math.cos(a) * r, z = ev.z + Math.sin(a) * r;
          this.fx.particle({ geo: this.fx.puffGeo, mat: this.smokeMat, pos: new THREE.Vector3(x, groundAt(x, z) + 1.5 + Math.random() * 2, z), vel: new THREE.Vector3(0, 0.3, 0), size: 3 + Math.random() * 1.5, grow: 0.4, life: 14, fade: 0.35, drag: 0.3 });
        }
        break;
      case 'spawn':
        if (ev.u === myId && driver) this.view.onRespawn();
        break;
      case 'pd':
        this.props?.setDestroyed([ev.id], this.fx);
        break;
      case 'wave':
        this.banner(ev.boss ? `BOSS WAVE ${ev.n} — HEAVY ARMOUR INBOUND` : `WAVE ${ev.n} INCOMING`);
        this.sound.distantArtillery({ x: 0, y: 0, z: -300 });
        break;
      case 'waveClear':
        this.banner(`WAVE ${ev.n} REPELLED`);
        break;
      case 'arty':
        if (performance.now() - (this.artyWarn ?? 0) > 15000) {
          this.artyWarn = performance.now();
          this.banner('ARTILLERY INCOMING!');
        }
        this.sound.plane?.();
        break;
      case 'elite': {
        const name = PLANES[ev.type].name.toUpperCase();
        const text = ev.team === this.team ? `FRIENDLY ${name} ARRIVING` : `ENEMY ${name} INBOUND`;
        this.banner(text);
        this.sound.tone({ freq: ev.team === this.team ? 520 : 330, dur: 0.5, gain: 0.1, type: 'square', bus: this.sound.out });
        const row = document.createElement('div');
        row.className = 'feed-row';
        row.textContent = text;
        this.feed.prepend(row);
        setTimeout(() => row.remove(), 7000);
        break;
      }
      case 'six':
        if (ev.u === myId) {
          this.banner('ENEMY ON OUR SIX!');
          this.sound.tone({ freq: 660, dur: 0.14, gain: 0.08, type: 'square', bus: this.sound.out });
        }
        break;
      case 'wing':
        if (ev.u === myId) this.banner('WING GONE! BAIL OUT! (X)');
        break;
      case 'flak':
        this.war?.flakAt(ev);
        break;
      case 'inc':
        if (this.war && this.view.camera) this.war.incoming(ev, this.view.camera.position);
        break;
      case 'shell':
        if (this.war && isWorldView(this.view)) this.war.impact(ev, this.view.camera.position);
        else {
          // The driver only hears and feels it.
          const self = this.buffer.latest?.units.get(myId);
          this.sound.farExplosion(ev, ev.size);
          if (self) {
            const near = Math.max(0, 1 - Math.hypot(self.x - ev.x, self.z - ev.z) / (90 * ev.size));
            if (near > 0) {
              this.nearBlast(near);
              this.view.onNearBlast?.(near);
            }
          }
        }
        break;
      case 'bomber':
        this.war?.addBomber(ev);
        if (!this.war) this.sound.plane();
        break;
      case 'boom': {
        const pos = new THREE.Vector3(ev.x, ev.y, ev.z);
        this.view.thermalFlash?.(ev.x, ev.y, ev.z, 2);
        this.fx?.explosion(pos, ev.size);
        this.world?.skyLife.scare(pos, 350);
        this.sound.explosion(pos, 1.6);
        if (driver) {
          const self = this.buffer.latest?.units.get(myId);
          if (self) this.view.addShake(Math.max(0, 1 - Math.hypot(self.x - ev.x, self.z - ev.z) / 120));
        }
        break;
      }
      case 'k': {
        const latest = this.buffer.latest?.units.get(ev.u);
        if (latest && (TANKS[ev.type] || PLANES[ev.type])) {
          this.sound.explosion(latest, 1);
          this.view.thermalFlash?.(latest.x, groundAt(latest.x, latest.z) + 1.5, latest.z, 1.2);
        }
        if (latest && this.fx) {
          const m = this.units.get(ev.u);
          this.fx.explosion(new THREE.Vector3(latest.x, PLANES[ev.type] ? latest.y : (m?.pose.y ?? 0) + 1.5, latest.z), 6);
        }
        if (ev.by === myId && gunner && ev.u !== myId) {
          this.view.showHit(true);
          this.view.showBanner('ENEMY DESTROYED');
        }
        this.addFeed(ev);
        break;
      }
    }
  }

  updateCapture(msg) {
    const TEAMS = ['blue', 'red'];
    for (const [id, owner, progress, contested] of msg.pts) {
      const p = this.points.find((q) => q.id === id);
      const newOwner = owner < 0 ? null : TEAMS[owner];
      const changed = p.owner !== newOwner;
      Object.assign(p, { owner: newOwner, progress, contested: !!contested });
      const el = this.capEl.querySelector(`[data-pt="${id}"]`);
      if (el) {
        el.className = `cap ${newOwner ?? 'neutral'}${contested ? ' contested' : ''}`;
        // Progress ring: blue fills clockwise for +, red for −.
        const col = progress >= 0 ? '#5fa0e0' : '#e0645a';
        el.style.background = `conic-gradient(${col} ${Math.abs(progress) * 360}deg, rgba(20,22,16,0.85) 0)`;
      }
      if (changed) this.recolorPoint(id, newOwner);
      // The flag climbs with the capture progress in the colour of the side that's winning.
      this.flagTarget[id] = { h: Math.abs(progress), team: progress > 0.02 ? 'blue' : progress < -0.02 ? 'red' : null };
    }
    if (this.mode === 'fortress' || this.mode === 'story') return;
    const tally = this.mode === 'tdm' ? msg.sc : msg.tk;
    this.capEl.querySelector('.tix.blue b').textContent = tally[0];
    this.capEl.querySelector('.tix.red b').textContent = tally[1];
    const m = Math.floor(msg.left / 60);
    this.capEl.querySelector('.clock').textContent = `${m}:${String(msg.left % 60).padStart(2, '0')}`;
  }

  // Wave counter, enemies left / countdown, command bunker health.
  updateFort([wave, fighting, countdown, enemies, bunker]) {
    const el = this.capEl;
    el.querySelector('.wave b').textContent = `${wave}/10`;
    el.querySelector('.wave-info').textContent = fighting ? `${enemies} attackers left${wave < 10 ? ` · next wave in ${countdown}s` : ''}` : `${wave ? 'Next wave' : 'First wave'} in ${countdown}s`;
    const bar = el.querySelector('.bunker u');
    bar.style.width = `${bunker}%`;
    bar.classList.toggle('low', bunker < 35);
  }

  // Story stage: what to do, how it's going, time left, tanks left and the boss's armour.
  updateStory({ o, p, t, l, b }) {
    const el = this.capEl;
    el.querySelector('.wave b').textContent = o;
    el.querySelector('.wave-info').textContent = p;
    el.querySelector('.lives b').textContent = '▮'.repeat(Math.max(0, l)) || '—';
    el.querySelector('.clock').textContent = t == null ? '' : `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    const boss = el.querySelector('.boss');
    boss.hidden = !b;
    if (b) {
      boss.querySelector('small').textContent = b[0].toUpperCase();
      boss.querySelector('u').style.width = `${b[1]}%`;
    }
  }

  banner(text) {
    if (this.view instanceof DriverView) this.view.flash?.(text);
    else this.view.showBanner?.(text);
  }

  recolorPoint(id, owner) {
    if (!this.world) return;
    const hex = owner === 'blue' ? 0x3f7fd0 : owner === 'red' ? 0xc84a3f : 0xdddddd;
    this.props?.zoneRings[id]?.material.color.setHex(hex);
  }

  // Animate the A/B/C flags towards their capture height (lowered enemy flag, raised ours).
  animateFlags(dt) {
    for (const [id, tgt] of Object.entries(this.flagTarget)) {
      const flag = this.world.pointMarkers[id]?.userData.flag;
      if (!flag) continue;
      const y = 1.2 + tgt.h * 6.9;
      flag.position.y += (y - flag.position.y) * Math.min(1, dt * 1.5);
      const hex = tgt.team === 'blue' ? 0x3f7fd0 : tgt.team === 'red' ? 0xc84a3f : 0xdddddd;
      if (flag.material.color.getHex() !== hex) flag.material.color.setHex(hex);
    }
  }

  unitName(team, type) {
    return `${team === 'blue' ? 'Blue' : 'Red'} ${TANKS[type]?.class ?? PLANES[type]?.class ?? UNITS[type]?.class ?? type}`;
  }

  addFeed(ev) {
    const myId = this.me?.id;
    const crewIds = Object.values(this.me?.crew?.foot ?? {}).map((f) => f.id);
    const ours = (id) => id === myId || crewIds.includes(id);
    // Infantry die constantly; only report what matters to the crew.
    if (ev.k === 'k' && ev.type in UNITS && ev.type !== 'atgun' && ev.type !== 'crew' && !ours(ev.by)) return;
    // Our team is shown blue in the feed, the enemy red (whichever side we're on).
    const rel = (team) => (team ? (team === this.team ? 'blue' : 'red') : '');
    let html;
    let cls = rel(ev.team);
    if (ev.k === 'cap') {
      const name = POINTS.find((p) => p.id === ev.id)?.name ?? ev.id;
      html = ev.team ? `<b>${ev.team === 'blue' ? 'Blue' : 'Red'}</b> captured <b>${ev.id}</b> · ${name}` : `<b>${ev.id}</b> neutralised`;
      cls = rel(ev.team ?? ev.prev);
    } else {
      const units = this.buffer.latest?.units;
      const victimUnit = units?.get(ev.u);
      const killerUnit = units?.get(ev.by);
      const crewLabel = (u) => (u?.crew != null ? this.crewName(u.crew) : null);
      const vehicle = PLANES[this.tank] ? 'Our plane' : 'Our tank';
      const victim = ev.u === myId ? vehicle : ours(ev.u) ? 'Our crewman' : crewLabel(victimUnit) ?? this.unitName(ev.team, ev.type);
      const side = killerUnit?.team === ev.team ? 'Friendly fire' : killerUnit?.team === this.team ? 'Our side' : 'Enemy fire';
      const killer = ev.by === myId ? vehicle : ours(ev.by) ? 'Our crew' : crewLabel(killerUnit) ?? side;
      html = `<span>${escapeHtml(killer)}</span> ▸ <b>${escapeHtml(victim)}</b>`;
    }
    const row = document.createElement('div');
    row.className = `feed-row ${cls}`;
    row.innerHTML = html;
    this.feed.prepend(row);
    setTimeout(() => row.remove(), 7000);
    while (this.feed.children.length > 5) this.feed.lastChild.remove();
  }

  // A Leviathan is heard across the whole map and shakes the ground when it comes over low;
  // a jet on afterburner is a roar. Your own engines are already in the plane sound.
  updateBigFlyers(states, worldView) {
    const l = this.sound.listener;
    let drone = Infinity, roar = Infinity, shake = 0;
    for (const u of states.values()) {
      if (u.dead || u.id === this.me?.id) continue;
      const spec = PLANES[u.type];
      if (!spec || (spec.engineSound !== 'drone' && !u.ab)) continue;
      const d = Math.hypot(u.x - l.x, u.y - l.y, u.z - l.z);
      if (spec.engineSound === 'drone') {
        drone = Math.min(drone, d);
        const low = 1 - (u.y - groundAt(u.x, u.z)) / 70;
        const near = 1 - Math.hypot(u.x - l.x, u.z - l.z) / 170;
        if (low > 0 && near > 0) shake = Math.max(shake, low * near * 0.5);
      } else roar = Math.min(roar, d);
    }
    this.sound.updateFlyers(drone, roar);
    if (shake > 0 && worldView) this.camShake = Math.max(this.camShake ?? 0, shake);
  }

  onMatchEnd() {
    // Freeze input behind the end screen without opening the pause menu.
    this.paused = true;
    this.ended = true;
    this.keys.setEnabled(false);
    this.view.setPaused?.(true);
    if (document.pointerLockElement) document.exitPointerLock();
  }

  pause() {
    if (this.ended) return;
    if (this.paused) return;
    this.paused = true;
    this.keys.setEnabled(false);
    this.view.setPaused?.(true);
    if (document.pointerLockElement) document.exitPointerLock();
    this.onPause();
  }

  resume() {
    this.paused = false;
    this.keys.setEnabled(true);
    this.view.setPaused?.(false);
    this.view.refreshHints?.(); // the keys may have been rebound while paused
    if (this.view instanceof GunnerView || this.view.isFoot) this.view.requestLock();
  }

  resize(w, h) {
    this.view.resize(w, h);
  }

  update(dt) {
    const states = this.buffer.sample();
    const worldView = this.view instanceof GunnerView || this.view.isFoot;
    if (this.units && worldView) {
      this.units.camPos.copy(this.view.camera.position);
      this.units.thermal = !!this.view.thermalActive?.();
      this.world.seeFar = this.units.thermal ? 2 : 1;
      this.units.update(states, dt);
    }
    if (this.fx) {
      // Feed unit positions so client rockets steer the same way as the server.
      this.fx.setUnits(
        [...states.values()].map((u) => ({
          id: u.id,
          team: u.team,
          dead: u.dead,
          kind: PLANES[u.type] ? 'plane' : TANKS[u.type] ? 'tank' : 'inf',
          x: u.x,
          z: u.z,
          y: u.y,
          pose: u.pose,
          player: !!(u.player || u.crew != null),
        })),
      );
      this.fx.update(dt, isWorldView(this.view) ? this.view.camera.position : null);
    }
    const board = this.keys.on('all.board') && !this.paused;
    if (board !== this.boardEl.classList.contains('show')) {
      this.boardEl.classList.toggle('show', board);
      if (board) this.boardEl.innerHTML = this.scoreboardHtml();
    }
    const waiting = this.solo && this.crewList.length === 1 && this.me?.dead && this.me.crew?.mode === 'tank' && this.me.respawnIn < 1e6 && !this.ended;
    this.respawnSkipEl.classList.toggle('show', !!waiting);
    if (waiting && !this.paused && this.keys.hit('death.skip')) this.skipRespawn();
    if (this.choiceEl.classList.contains('show')) {
      if (this.keys.hit('death.respawn')) net.send({ t: 'bail', pick: 'tank' });
      if (this.keys.hit('death.foot')) net.send({ t: 'bail', pick: 'foot' });
      if (this.keys.hit('death.skip')) this.skipChoice();
    }
    if (this.me) this.view.update(dt, states, this.me);
    // Blast shake on top of whatever the view did with its camera.
    if (this.camShake > 0.001 && worldView) {
      const s = this.camShake * 0.022;
      this.view.camera.rotation.x += (Math.random() - 0.5) * s;
      this.view.camera.rotation.y += (Math.random() - 0.5) * s;
      this.view.camera.rotation.z += (Math.random() - 0.5) * s * 0.6;
      this.camShake *= Math.exp(-dt * 3.2);
    }
    if (this.units) this.updateTags(states);
    // Audio: listener follows the crew member's head.
    const self = this.me && states.get(this.view.isFoot ? this.view.myId ?? this.me.id : this.me.id);
    if (self) {
      const l = this.sound.listener;
      if (worldView) Object.assign(l, { x: this.view.camera.position.x, y: this.view.camera.position.y, z: this.view.camera.position.z });
      else Object.assign(l, { x: self.x, y: groundAt(self.x, self.z) + 2, z: self.z });
      const spec = TANKS[this.tank] ?? PLANES[this.tank];
      const th = this.me.drive?.th ?? 0;
      if (TANKS[this.tank]) this.sound.updateEngine(dt, Math.min(1, Math.abs(this.me.v) / spec.maxSpeed), this.paused ? 0 : th, !this.me.dead && (this.me.mods?.engine ?? 1) > 0, spec.maxSpeed);
      else if (this.view.isFoot) this.sound.updatePlane(dt, { th: 0, speedFrac: 0, dive: 0, alive: false, stall: false });
      else {
        const pl = this.me.pl ?? {};
        this.sound.updatePlane(dt, { th: pl.th ?? 0, speedFrac: Math.min(1.4, Math.abs(this.me.v) / spec.maxSpeed), dive: Math.max(0, -(pl.vy ?? 0) / Math.max(10, Math.abs(this.me.v))), alive: !this.me.dead && (this.me.mods?.engine ?? 1) > 0, stall: !!pl.stall, ab: !!pl.ab });
      }
      // World ambience around the tank.
      let fire = Infinity;
      for (const f of this.fires) fire = Math.min(fire, Math.hypot(f.x - self.x, f.z - self.z));
      const trees = Math.max(0, Math.min(1, (TREE_NOISE(self.x / 160, self.z / 160) + 0.05) * 1.6));
      this.sound.updateAmbient(dt, { river: Math.max(0, Math.abs(self.z - riverZ(self.x)) - RIVER_HALF_WIDTH), fire, trees });
      // Edge of the battlefield warning.
      const edge = Math.max(Math.abs(self.x), Math.abs(self.z));
      this.edgeEl.classList.toggle('show', !self.dead && !this.view.isPlane && edge > PLAY_LIMIT - 45 && !nearGarage(self.x, self.z, this.team) && !inAirfield(self.x, self.z, 30));
    }
    this.updateBigFlyers(states, worldView);
    this.sound.updateRadio(dt);
    // The driver has no view of the sky but still hears the distant war.
    if (!worldView && (this.distantT -= dt) <= 0) {
      this.distantT = 1 + Math.random() * 4;
      const a = Math.random() * Math.PI * 2;
      this.sound.distantArtillery({ x: Math.cos(a) * 1200, y: 0, z: Math.sin(a) * 1200 });
    }
    if (this.props && worldView) {
      const cam = this.view.camera.position;
      // Only tanks knock down trees, fences and poles.
      const alive = [...states.values()].filter((u) => !u.dead && TANKS[u.type]);
      this.props.update(dt, this.fx, alive, cam, this.sound);
      this.world.animate(dt, cam);
      this.animateFlags(dt);
      // Damaged tanks smoke; wrecks burn.
      this.smokeT = (this.smokeT ?? 0) - dt;
      if (this.smokeT <= 0) {
        this.smokeT = 0.25;
        for (const u of states.values()) {
          const flying = PLANES[u.type];
          if ((!TANKS[u.type] && !flying) || (u.hp > 0.6 && !u.dead)) continue;
          if (Math.hypot(u.x - cam.x, u.z - cam.z) > 500) continue;
          if (Math.random() < (u.dead ? 0.9 : 1 - u.hp)) this.fx.smokePuff(u.x, flying ? u.y : (this.units.get(u.id)?.pose.y ?? 0) + 2, u.z, u.dead);
        }
      }
      this.tracks.update(dt, states, cam);
      this.ambient.update(dt, cam);
      this.war.update(dt, cam);
      this.aaGuns.update(dt);
    }
    this.keys.endFrame();
  }

  render(renderer) {
    this.view.render(renderer);
  }

  // Extra lines for the F3 performance overlay.
  debugStats() {
    const lines = [`role ${this.role} · units ${this.buffer.latest?.units.size ?? 0}`];
    if (this.props) {
      const s = this.props.stats;
      lines.push(`prop chunks ${s.chunks} · scatter instances ${s.instances} · trees ${s.trees}`);
      lines.push(`particles ${this.fx.particles.length}`);
    }
    return lines;
  }

  dispose() {
    for (const off of this.off) off();
    document.removeEventListener('pointerlockchange', this.onLockChange);
    if (document.pointerLockElement) document.exitPointerLock();
    this.keys.dispose();
    this.world?.dispose(); // first, while everything is still in the scene to be found
    this.view.dispose();
    renderer.shadowMap.autoUpdate = true;
    this.fx?.dispose();
    this.ambient?.dispose();
    this.war?.dispose();
    this.aaGuns?.dispose();
    this.sound.dispose();
    this.feed.remove();
    this.edgeEl.remove();
    this.voiceEl.remove();
    this.capEl.remove();
    this.choiceEl.remove();
    this.respawnSkipEl.remove();
    this.boardEl.remove();
    this.tagsEl.remove();
  }
}
