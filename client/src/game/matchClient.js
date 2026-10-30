import * as THREE from 'three';
import { TANKS, UNITS } from '../../../shared/constants.js';
import { POINTS, groundAt, riverZ, RIVER_HALF_WIDTH, PLAY_LIMIT } from '../../../shared/map.js';
import { PROPS, TREE_NOISE } from '../../../shared/props.js';
import { net } from '../net.js';
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

// Glue for a running match: receives server snapshots, routes events to effects,
// and drives the role-specific view (driver cockpit or gunner sight).
export class MatchClient {
  constructor({ role, tank, onPause }) {
    this.role = role;
    this.tank = tank;
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
    this.capEl.innerHTML = `
      <div class="tix blue"><small>BLUE</small><b>500</b></div>
      ${POINTS.map((p) => `<div class="cap" data-pt="${p.id}"><span>${p.id}</span></div>`).join('')}
      <div class="tix red"><small>RED</small><b>500</b></div>
      <div class="clock">20:00</div>`;
    this.hud.appendChild(this.capEl);
    this.points = POINTS.map((p) => ({ id: p.id, owner: null, progress: 0, contested: false }));

    if (role === 'gunner') {
      this.world = new World();
      this.units = new UnitsView(this.world.scene);
      this.fx = new FX(this.world.scene);
      this.props = new PropsView(this.world.scene);
      this.tracks = new TrackMarks(this.world.scene, this.fx);
      this.ambient = new AmbientWar(this.world.scene);
      this.view = new GunnerView({ world: this.world, units: this.units, tank, hud: this.hud, keys: this.keys });
      this.view.deadProps = this.props.dead;
      this.props.setEnvMap(this.world.envMap);
    } else {
      this.view = new DriverView({ tank, hud: this.hud, keys: this.keys });
    }

    // Voice: who's talking + how to talk.
    this.voiceEl = document.createElement('div');
    this.voiceEl.className = 'voice-hud';
    this.hud.appendChild(this.voiceEl);
    const partner = role === 'driver' ? 'Gunner' : 'Driver';
    const renderVoice = (sp) => {
      this.voiceEl.innerHTML = `
        <div class="voice-row"><i class="speak-dot${sp.local ? ' on' : ''}"></i>You <small>${role}</small></div>
        <div class="voice-row"><i class="speak-dot${sp.remote ? ' on' : ''}"></i>${partner}</div>
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

    this.sound = new SoundScape(role);
    if (this.ambient) this.ambient.onSound = (kind, pos) => (kind === 'artillery' ? this.sound.distantArtillery(pos) : this.sound.plane());
    this.distantT = 3;
    this.lastReload = 0;
    showTutorial(role, this.hud);

    // Point colours feed the radar, minimap and in-world flags.
    const pointColor = (id) => {
      const p = this.points.find((q) => q.id === id);
      return p?.owner === 'blue' ? '#5fa0e0' : p?.owner === 'red' ? '#e0645a' : '#e6e1cf';
    };
    if (this.view.radar) this.view.radar.pointColor = pointColor;
    this.view.pointColor = pointColor;

    this.onLockChange = () => {
      const locked = document.pointerLockElement === document.getElementById('scene');
      if (!locked) {
        this.lastUnlock = performance.now();
        // Losing the pointer (Esc) during play opens the pause menu.
        if (!this.paused && (this.role === 'gunner' || this.view.look?.free)) this.pause();
      }
    };
    document.addEventListener('pointerlockchange', this.onLockChange);
  }

  onSnapshot(msg) {
    this.buffer.push(msg);
    // Reload finished: clank for the crew.
    if (this.me && this.me.reload > 0 && msg.me.reload === 0 && !msg.me.dead) this.sound.reloadClank();
    this.me = msg.me;
    // Full destroyed-prop list (no effects: these may be old news, e.g. after joining).
    if (msg.pd && this.props) this.props.setDestroyed(msg.pd.filter((id) => !this.props.dead.has(id)), null);
    if (msg.pts) this.updateCapture(msg);
    for (const ev of msg.ev ?? []) this.onEvent(ev);
  }

  onEvent(ev) {
    const myId = this.me?.id;
    switch (ev.k) {
      case 'f': {
        this.sound.shot(ev.kind, ev, ev.o === myId);
        if (ev.o === myId && this.role === 'gunner') this.view.kick = ev.kind === 'heavy' ? 0.05 : ev.kind === 'mg' ? 0.002 : ev.kind === 'ac' ? 0.008 : 0.03;
        if (this.fx) {
          this.fx.spawnProjectile(ev);
          const pos = new THREE.Vector3(ev.x, ev.y, ev.z);
          const dir = new THREE.Vector3(ev.vx, ev.vy, ev.vz).normalize();
          this.fx.muzzleFlash(pos, dir, ev.kind);
        }
        if (ev.o === myId && this.role === 'driver') {
          if (ev.kind !== 'mg') this.view.addShake(ev.kind === 'heavy' ? 0.5 : ev.kind === 'ac' ? 0.05 : 0.3);
          this.view.onOwnFire(ev.kind);
        }
        break;
      }
      case 'i':
        this.sound.impact(ev, ev.u === myId);
        if (['he', 'heavy', 'ap', 'rocket'].includes(ev.kind)) this.world?.skyLife.scare(ev, ev.kind === 'heavy' ? 260 : 160);
        if (this.fx) {
          this.fx.removeProjectile(ev.id);
          this.fx.impact(ev);
        }
        if (ev.u === myId && this.role === 'driver') {
          const small = ev.kind === 'mg' || ev.kind === 'rifle';
          this.view.addShake(small ? 0.05 : 0.8);
          this.view.onHit(!small);
        }
        if (ev.o === myId && ev.u && this.role === 'gunner' && ev.r !== 'ric') this.view.showHit(false);
        if (ev.o === myId && ev.r === 'ric' && this.role === 'gunner') this.view.showBanner('RICOCHET');
        break;
      case 'cap':
        this.addFeed(ev);
        if (ev.team && this.role === 'gunner') this.view.showBanner(`${ev.team === 'blue' ? 'WE' : 'ENEMY'} CAPTURED ${ev.id}`);
        if (ev.team && this.role === 'driver') this.view.flash?.(`${ev.team === 'blue' ? 'WE' : 'ENEMY'} CAPTURED ${ev.id}`);
        break;
      case 'mod':
      case 'fixed': {
        if (ev.u !== myId) break;
        const name = { tracks: 'TRACKS', engine: 'ENGINE', turret: 'TURRET RING', gun: 'GUN', radar: 'RADAR', fire: 'ENGINE' }[ev.m] ?? ev.m;
        const text = ev.k === 'fixed' ? `${name} REPAIRED` : ev.m === 'fire' ? 'ENGINE FIRE!' : `${name} ${ev.state === 'destroyed' ? 'DESTROYED' : 'DAMAGED'}`;
        if (this.role === 'gunner') this.view.showBanner(text);
        else {
          this.view.flash(text);
          if (ev.k === 'mod') this.view.onModule(ev.state ?? 'damaged');
        }
        break;
      }
      case 'spawn':
        if (ev.u === myId && this.role === 'driver') this.view.onRespawn();
        break;
      case 'pd':
        this.props?.setDestroyed([ev.id], this.fx);
        break;
      case 'boom': {
        const pos = new THREE.Vector3(ev.x, ev.y, ev.z);
        this.fx?.explosion(pos, ev.size);
        this.world?.skyLife.scare(pos, 350);
        this.sound.explosion(pos, 1.6);
        if (this.role === 'driver') {
          const self = this.buffer.latest?.units.get(myId);
          if (self) this.view.addShake(Math.max(0, 1 - Math.hypot(self.x - ev.x, self.z - ev.z) / 120));
        }
        break;
      }
      case 'k': {
        const latest = this.buffer.latest?.units.get(ev.u);
        if (latest && TANKS[ev.type]) this.sound.explosion(latest, 1);
        if (latest && this.fx) {
          const m = this.units.get(ev.u);
          this.fx.explosion(new THREE.Vector3(latest.x, (m?.pose.y ?? 0) + 1.5, latest.z), 6);
        }
        if (ev.by === myId && this.role === 'gunner' && ev.u !== myId) {
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
      el.className = `cap ${newOwner ?? 'neutral'}${contested ? ' contested' : ''}`;
      // Progress ring: blue fills clockwise for +, red for −.
      const col = progress >= 0 ? '#5fa0e0' : '#e0645a';
      el.style.background = `conic-gradient(${col} ${Math.abs(progress) * 360}deg, rgba(20,22,16,0.85) 0)`;
      if (changed && this.world) {
        const hex = newOwner === 'blue' ? 0x3f7fd0 : newOwner === 'red' ? 0xc84a3f : 0xdddddd;
        this.world.pointMarkers[id]?.userData.flag.material.color.setHex(hex);
        this.props?.zoneRings[id]?.material.color.setHex(hex);
      }
    }
    this.capEl.querySelector('.tix.blue b').textContent = msg.tk[0];
    this.capEl.querySelector('.tix.red b').textContent = msg.tk[1];
    const m = Math.floor(msg.left / 60);
    this.capEl.querySelector('.clock').textContent = `${m}:${String(msg.left % 60).padStart(2, '0')}`;
  }

  unitName(team, type) {
    return `${team === 'blue' ? 'Blue' : 'Red'} ${TANKS[type]?.class ?? UNITS[type]?.class ?? type}`;
  }

  addFeed(ev) {
    const myId = this.me?.id;
    // Infantry die constantly; only report what matters to the crew.
    if (ev.k === 'k' && ev.type in UNITS && ev.type !== 'atgun' && ev.by !== myId) return;
    let html;
    let cls = ev.team ?? '';
    if (ev.k === 'cap') {
      const name = POINTS.find((p) => p.id === ev.id)?.name ?? ev.id;
      html = ev.team ? `<b>${ev.team === 'blue' ? 'Blue' : 'Red'}</b> captured <b>${ev.id}</b> · ${name}` : `<b>${ev.id}</b> neutralised`;
      cls = ev.team ?? ev.prev ?? '';
    } else {
      const victim = ev.u === myId ? 'Our tank' : this.unitName(ev.team, ev.type);
      const killer = ev.by === myId ? 'Our tank' : 'Enemy fire';
      html = `<span>${killer}</span> ▸ <b>${victim}</b>`;
    }
    const row = document.createElement('div');
    row.className = `feed-row ${cls}`;
    row.innerHTML = html;
    this.feed.prepend(row);
    setTimeout(() => row.remove(), 7000);
    while (this.feed.children.length > 5) this.feed.lastChild.remove();
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
    if (this.role === 'gunner') this.view.requestLock();
  }

  resize(w, h) {
    this.view.resize(w, h);
  }

  update(dt) {
    const states = this.buffer.sample();
    if (this.units) {
      this.units.camPos.copy(this.view.camera.position);
      this.units.update(states, dt);
    }
    this.fx?.update(dt);
    if (this.me) this.view.update(dt, states, this.me);
    // Audio: listener follows the crew member's head.
    const self = this.me && states.get(this.me.id);
    if (self) {
      const l = this.sound.listener;
      if (this.role === 'gunner') Object.assign(l, { x: this.view.camera.position.x, y: this.view.camera.position.y, z: this.view.camera.position.z });
      else Object.assign(l, { x: self.x, y: groundAt(self.x, self.z) + 2, z: self.z });
      const spec = TANKS[this.tank];
      const th = this.me.drive?.th ?? 0;
      this.sound.updateEngine(dt, Math.min(1, Math.abs(this.me.v) / spec.maxSpeed), this.paused ? 0 : th, !this.me.dead && (this.me.mods?.engine ?? 1) > 0, spec.maxSpeed);
      // World ambience around the tank.
      let fire = Infinity;
      for (const f of this.fires) fire = Math.min(fire, Math.hypot(f.x - self.x, f.z - self.z));
      const trees = Math.max(0, Math.min(1, (TREE_NOISE(self.x / 160, self.z / 160) + 0.05) * 1.6));
      this.sound.updateAmbient(dt, { river: Math.max(0, Math.abs(self.z - riverZ(self.x)) - RIVER_HALF_WIDTH), fire, trees });
      // Edge of the battlefield warning.
      const edge = Math.max(Math.abs(self.x), Math.abs(self.z));
      this.edgeEl.classList.toggle('show', !self.dead && edge > PLAY_LIMIT - 45);
    }
    this.sound.updateRadio(dt);
    // The driver has no view of the sky but still hears the distant war.
    if (this.role === 'driver' && (this.distantT -= dt) <= 0) {
      this.distantT = 1 + Math.random() * 4;
      const a = Math.random() * Math.PI * 2;
      this.sound.distantArtillery({ x: Math.cos(a) * 1200, y: 0, z: Math.sin(a) * 1200 });
    }
    if (this.props) {
      const cam = this.view.camera.position;
      // Only tanks knock down trees, fences and poles.
      const alive = [...states.values()].filter((u) => !u.dead && TANKS[u.type]);
      this.props.update(dt, this.fx, alive, cam, this.sound);
      this.world.animate(dt, cam);
      // Damaged tanks smoke; wrecks burn.
      this.smokeT = (this.smokeT ?? 0) - dt;
      if (this.smokeT <= 0) {
        this.smokeT = 0.25;
        for (const u of states.values()) {
          if (!TANKS[u.type] || (u.hp > 0.5 && !u.dead)) continue;
          if (Math.hypot(u.x - cam.x, u.z - cam.z) > 500) continue;
          if (Math.random() < (u.dead ? 0.9 : 1 - u.hp)) this.fx.smokePuff(u.x, (this.units.get(u.id)?.pose.y ?? 0) + 2, u.z, u.dead);
        }
      }
      this.tracks.update(dt, states, cam);
      this.ambient.update(dt, cam);
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
    this.view.dispose();
    this.fx?.dispose();
    this.ambient?.dispose();
    this.sound.dispose();
    this.feed.remove();
    this.edgeEl.remove();
    this.voiceEl.remove();
    this.capEl.remove();
  }
}
