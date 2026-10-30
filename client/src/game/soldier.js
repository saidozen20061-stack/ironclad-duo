import * as THREE from 'three';
import { FOOT } from '../../../shared/constants.js';
import { groundAt, heightAt, WATER_LEVEL } from '../../../shared/map.js';
import { footBlocked, nearGarage, GARAGES } from '../../../shared/foot.js';
import { wrapAngle } from '../../../shared/tank.js';
import { net } from '../net.js';
import { settings } from '../settings.js';
import { terrainImage } from './mapImage.js';
import { GunnerView } from './gunner.js';
import { buildM4Viewmodel, M4_SIGHT_Y } from '../models/infantry.js';

// First-person crew member on foot after bailing out. Movement is predicted here and
// reported to the host; shots, grenades, damage and ammo are decided by the host.
const FOV = 72;
const ADS_FOV = 48;
const HIP = new THREE.Vector3(0.15, -0.2, -0.45);
const AIM = new THREE.Vector3(0, -M4_SIGHT_Y, -0.32);

const HUD_HTML = `
  <div class="f-cross"><i></i><i></i><i></i><i></i></div>
  <div class="g-hitmark">✕</div>
  <div class="g-banner"></div>
  <div class="f-hurt"></div>
  <div class="f-status panel">
    <div class="f-hp"><span>HP</span><i><u></u></i><b>100</b></div>
    <div class="f-mate"></div>
    <div class="f-garage"></div>
  </div>
  <div class="f-ammo panel"><div class="f-wname">M4A4 CARBINE</div><b class="f-mag">30</b><span class="f-res">/ 180</span><div class="f-gren"></div><div class="f-state"></div></div>
  <canvas class="g-minimap panel" width="200" height="200"></canvas>
  <div class="g-pingcd panel"><b>Q</b> PING <i><u></u></i><span></span></div>
  <div class="f-prompt"></div>
  <div class="g-lock">Click to fight on foot</div>
  <div class="g-dead"></div>
  <div class="f-hint">WASD move · Shift sprint · Space jump · C crouch · RMB aim · R reload · G grenade · Q ping · V talk</div>
`;

export class SoldierView {
  constructor({ world, units, props, sound, hud, keys, role }) {
    this.isFoot = true;
    this.world = world;
    this.units = units;
    this.sound = sound;
    this.keys = keys;
    this.role = role;
    this.mateRole = role === 'driver' ? 'gunner' : 'driver';
    this.deadProps = props.dead;
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 5000);
    this.camera.rotation.order = 'YXZ';
    this.aim = { yaw: 0, pitch: 0 };
    this.pos = null;
    this.jy = 0;
    this.vy = 0;
    this.crouch = false;
    this.eye = FOOT.eye;
    this.ads = false;
    this.adsT = 0;
    this.fire = false;
    this.kick = 0;
    this.bob = 0;
    this.shotT = 0;
    this.sentAt = 0;
    this.lastSent = '';

    // The rifle renders in its own pass so it never clips into walls.
    this.gunScene = new THREE.Scene();
    this.gunCam = new THREE.PerspectiveCamera(60, 1, 0.01, 10);
    this.gunScene.add(new THREE.HemisphereLight(0xdfe8f0, 0x4a4030, 1.3));
    const sun = new THREE.DirectionalLight(0xfff0d8, 1.8);
    sun.position.set(0.4, 1, 0.3);
    this.gunScene.add(sun);
    this.vm = buildM4Viewmodel();
    this.gunScene.add(this.vm.group);

    this.el = document.createElement('div');
    this.el.className = 'hud foot';
    this.el.innerHTML = HUD_HTML;
    hud.appendChild(this.el);
    this.$ = (s) => this.el.querySelector(s);
    this.minimap = this.$('.g-minimap').getContext('2d');
    this.mapBase = terrainImage(360);
    GunnerView.prototype.buildPingMarker.call(this);
    this.drawExtraMinimap = (ctx, toMap) => this.drawMate(ctx, toMap);
    this.bind();
  }

  aiming() {
    return GunnerView.prototype.aiming.call(this);
  }

  requestLock() {
    GunnerView.prototype.requestLock.call(this);
  }

  bind() {
    const canvas = document.getElementById('scene');
    this.freeMouse = false;
    this.onLockError = () => {
      this.freeMouse = true;
      canvas.style.cursor = 'none';
    };
    document.addEventListener('pointerlockerror', this.onLockError);
    this.onMouseMove = (e) => {
      if (!this.aiming()) return;
      const k = 0.0022 * settings.sensitivity * (this.ads ? 0.6 : 1);
      this.aim.yaw = wrapAngle(this.aim.yaw - e.movementX * k);
      this.aim.pitch = Math.max(-1.45, Math.min(1.45, this.aim.pitch - e.movementY * k));
    };
    this.onMouseDown = (e) => {
      if (!this.aiming()) {
        if (e.target === canvas && !this.paused) this.requestLock();
        return;
      }
      if (e.button === 0) this.fire = true;
      if (e.button === 2) this.ads = true;
      if (e.button === 1) {
        e.preventDefault();
        this.placePing();
      }
    };
    this.onMouseUp = (e) => {
      if (e.button === 0) this.fire = false;
      if (e.button === 2) this.ads = false;
    };
    this.onContext = (e) => e.preventDefault();
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('contextmenu', this.onContext);
  }

  setPaused(p) {
    this.paused = p;
    if (p) {
      this.fire = false;
      this.ads = false;
    }
  }

  resize(w, h) {
    for (const c of [this.camera, this.gunCam]) {
      c.aspect = w / h;
      c.updateProjectionMatrix();
    }
  }

  placePing() {
    if (this.paused || !this.me || this.me.pingCd > 0) {
      if (this.me?.pingCd > 0) this.showBanner(`PING READY IN ${Math.ceil(this.me.pingCd)}s`);
      return;
    }
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const range = this.raycast(this.camera.position, dir, this.states ?? new Map(), this.myId);
    if (!range) return;
    const p = this.camera.position.clone().addScaledVector(dir, range);
    net.send({ t: 'ping', x: +p.x.toFixed(2), z: +p.z.toFixed(2) });
  }

  raycast(origin, dir, states, selfId) {
    return GunnerView.prototype.raycast.call(this, origin, dir, states, selfId);
  }

  showHit(kill) {
    GunnerView.prototype.showHit.call(this, kill);
  }

  showBanner(text) {
    GunnerView.prototype.showBanner.call(this, text);
  }

  // Feedback for our own soldier (the match client handles the shared effects).
  onEvent(ev) {
    if (!this.myId) return;
    if (ev.k === 'i') {
      if (ev.o === this.myId && ev.u && ev.u !== this.myId) this.showHit(false);
      if (ev.u === this.myId) {
        const hurt = this.$('.f-hurt');
        hurt.classList.remove('show');
        void hurt.offsetWidth;
        hurt.classList.add('show');
      }
    } else if (ev.k === 'k') {
      if (ev.by === this.myId && ev.u !== this.myId) {
        this.showHit(true);
        this.showBanner(ev.type === 'crew' || ev.type === 'rifle' || ev.type === 'rocket' ? 'ENEMY KILLED' : 'ENEMY DESTROYED');
      }
      if (ev.u === this.mateId) this.showBanner('PARTNER DOWN');
    }
  }

  update(dt, states, me) {
    this.me = me;
    this.states = states;
    const foot = me.crew?.foot;
    const mine = foot?.[this.role];
    if (!mine) return;
    const mate = foot[this.mateRole];
    this.myId = mine.id;
    this.mateId = mate?.id;
    if (!this.pos) {
      this.pos = { x: mine.x, z: mine.z };
      this.aim.yaw = states.get(mine.id)?.h ?? 0;
    }
    // The host rejected our position (lag spike, wall): take its word for it.
    if (Math.hypot(mine.x - this.pos.x, mine.z - this.pos.z) > 6) Object.assign(this.pos, { x: mine.x, z: mine.z });

    const alive = !mine.dead;
    const control = alive && this.aiming();
    const k = this.keys;
    let fwd = 0, side = 0;
    if (control) {
      fwd = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
      side = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
      if (k.took('KeyC')) this.crouch = !this.crouch;
      if (k.took('Space') && this.jy === 0) {
        this.vy = FOOT.jump;
        this.crouch = false;
      }
      if (k.took('KeyR')) net.send({ t: 'reload' });
      if (k.took('KeyG')) net.send({ t: 'grenade' });
      if (k.took('KeyQ')) this.placePing();
      if (k.took('KeyE') && nearGarage(this.pos.x, this.pos.z)) net.send({ t: 'garage' });
    }
    const sprint = control && k.has('ShiftLeft') && fwd > 0 && !this.crouch && !this.ads;
    if (sprint) this.fire = false;

    // Movement with wall sliding, like the NPC infantry.
    const len = Math.hypot(fwd, side);
    const moving = len > 0;
    if (moving) {
      let speed = this.crouch ? FOOT.crouch : sprint ? FOOT.sprint : FOOT.walk;
      if (this.ads) speed *= 0.6;
      if (heightAt(this.pos.x, this.pos.z) < WATER_LEVEL) speed *= 0.5;
      const y = this.aim.yaw;
      const dx = ((Math.sin(y) * fwd - Math.cos(y) * side) / len) * speed * dt;
      const dz = ((Math.cos(y) * fwd + Math.sin(y) * side) / len) * speed * dt;
      let nx = this.pos.x + dx, nz = this.pos.z + dz;
      if (footBlocked(nx, nz, this.deadProps)) {
        if (!footBlocked(nx, this.pos.z, this.deadProps)) nz = this.pos.z;
        else if (!footBlocked(this.pos.x, nz, this.deadProps)) nx = this.pos.x;
        else [nx, nz] = [this.pos.x, this.pos.z];
      }
      this.pos.x = nx;
      this.pos.z = nz;
      this.bob += dt * speed * 2.2;
    }
    if (this.jy > 0 || this.vy > 0) {
      this.vy -= 9.81 * 1.4 * dt;
      this.jy = Math.max(0, this.jy + this.vy * dt);
      if (this.jy === 0) this.vy = 0;
    }

    // Local muzzle flash, recoil and sound for responsiveness; the host fires the real bullets.
    const canShoot = control && this.fire && mine.mag > 0 && mine.rl <= 0;
    this.vm.flash.visible = false;
    if (canShoot) {
      this.shotT -= dt;
      if (this.shotT <= 0) {
        this.shotT += FOOT.rifle.interval;
        this.kick += this.ads ? 0.012 : 0.02;
        this.aim.pitch = Math.min(1.45, this.aim.pitch + (this.ads ? 0.0035 : 0.006));
        this.aim.yaw = wrapAngle(this.aim.yaw + (Math.random() - 0.5) * 0.004);
        this.vm.flash.visible = true;
        this.vm.flash.rotation.z = Math.random() * Math.PI;
        this.sound.shot('rifle', this.camera.position, true);
      }
    } else this.shotT = 0;
    this.kick *= Math.max(0, 1 - dt * 12);

    // Report state at ~30 Hz, or at once when the trigger / sights change.
    const now = performance.now();
    const flags = `${this.fire && alive}${this.ads}${this.crouch}`;
    if (alive && (now - this.sentAt > 33 || flags !== this.lastSent)) {
      net.send({ t: 'foot', x: +this.pos.x.toFixed(2), z: +this.pos.z.toFixed(2), h: +this.aim.yaw.toFixed(4), p: +this.aim.pitch.toFixed(4), jy: +this.jy.toFixed(2), crouch: this.crouch, fire: this.fire, ads: this.ads, moving });
      this.sentAt = now;
      this.lastSent = flags;
    }

    // Camera: our own head, or the partner's while we're down.
    const cam = this.camera;
    const own = this.units.get(mine.id);
    if (own) own.handles.group.visible = !alive;
    const mateState = mate && states.get(mate.id);
    if (alive) {
      this.eye += ((this.crouch ? FOOT.crouchEye : FOOT.eye) - this.eye) * Math.min(1, dt * 10);
      const bobY = moving && this.jy === 0 ? Math.sin(this.bob * 2) * 0.03 : 0;
      cam.position.set(this.pos.x, groundAt(this.pos.x, this.pos.z) + this.jy + this.eye + bobY, this.pos.z);
      cam.rotation.set(this.aim.pitch + this.kick, this.aim.yaw + Math.PI, 0);
    } else if (mateState && !mateState.dead) {
      cam.position.set(mateState.x, groundAt(mateState.x, mateState.z) + (mateState.y ?? 0) + (mateState.ty > 0.5 ? FOOT.crouchEye : FOOT.eye) + 0.3, mateState.z);
      cam.rotation.set(mateState.gp, mateState.h + Math.PI, 0);
      const mm = this.units.get(mate.id);
      if (mm) mm.handles.group.visible = false;
    }
    this.adsT += ((this.ads && alive ? 1 : 0) - this.adsT) * Math.min(1, dt * 12);
    const fov = FOV + (ADS_FOV - FOV) * this.adsT;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }

    // Viewmodel: hip / sights blend, bob, sprint and reload poses, recoil.
    const g = this.vm.group;
    g.visible = alive;
    g.position.lerpVectors(HIP, AIM, this.adsT);
    const sway = (1 - this.adsT * 0.85) * (moving ? 1 : 0.2);
    g.position.x += Math.sin(this.bob) * 0.008 * sway;
    g.position.y += Math.abs(Math.cos(this.bob)) * 0.008 * sway;
    g.position.z += this.kick * 1.4;
    g.rotation.set(this.kick * 1.5, sprint ? 0.6 : 0, 0);
    if (sprint) g.position.add({ x: -0.04, y: -0.04, z: 0 });
    if (mine.rl > 0) {
      g.rotation.z = 0.55;
      g.rotation.x -= 0.35;
      g.position.y -= 0.06;
    } else g.rotation.z = 0;

    // Ping marker in the world.
    const mk = this.pingMarker;
    mk.visible = !!me.ping;
    if (me.ping) {
      mk.position.set(me.ping.x, groundAt(me.ping.x, me.ping.z), me.ping.z);
      this.pingRing.scale.setScalar(1 + ((now / 600) % 1) * 1.5);
      mk.scale.setScalar(Math.max(0.15, Math.min(1, Math.hypot(me.ping.x - cam.position.x, me.ping.z - cam.position.z) / 80)));
    }
    this.world.update(cam.position);
    this.updateHud(mine, mate);
  }

  updateHud(mine, mate) {
    const $ = this.$;
    $('.g-lock').style.display = this.aiming() || this.paused || mine.dead ? 'none' : '';
    $('.f-cross').style.opacity = mine.dead ? 0 : 1 - this.adsT;
    $('.f-hp u').style.width = `${mine.hp}%`;
    $('.f-hp u').classList.toggle('low', mine.hp < 35);
    $('.f-hp b').textContent = mine.hp;
    const mateName = this.mateRole === 'driver' ? 'Driver' : 'Gunner';
    $('.f-mate').innerHTML = mate ? `${mateName} <b class="${mate.dead ? 'down' : ''}">${mate.dead ? 'DOWN' : `${mate.hp} HP`}</b>` : '';
    let gd = Infinity;
    for (const g of GARAGES) gd = Math.min(gd, Math.hypot(g.x - this.pos.x, g.z - this.pos.z));
    $('.f-garage').textContent = `Base garage ${Math.round(gd)} m`;

    $('.f-mag').textContent = mine.mag;
    $('.f-res').textContent = `/ ${mine.res}`;
    $('.f-gren').textContent = `G  ${'●'.repeat(mine.gren)}${'○'.repeat(Math.max(0, FOOT.grenades - mine.gren))}`;
    $('.f-state').textContent = mine.rl > 0 ? 'RELOADING…' : mine.mag === 0 && mine.res === 0 ? 'NO AMMO — resupply at the base garage' : mine.mag === 0 ? 'Press R to reload' : '';

    const cd = this.me.pingCd ?? 0;
    $('.g-pingcd u').style.width = `${(1 - cd / 5) * 100}%`;
    $('.g-pingcd').classList.toggle('ready', cd <= 0);
    $('.g-pingcd span').textContent = cd > 0 ? `${cd.toFixed(1)}s` : this.me.ping ? `active ${Math.round(Math.hypot(this.me.ping.x - this.pos.x, this.me.ping.z - this.pos.z))}m` : 'ready';

    // Garage prompt: everyone still alive has to be there.
    let prompt = '';
    if (!mine.dead && gd < FOOT.garageRadius) {
      const mateThere = !mate || mate.dead || nearGarage(mate.x, mate.z);
      prompt = mateThere ? '<b>E</b> Get a new tank' : `Wait for the ${mateName.toLowerCase()} at the garage`;
    }
    $('.f-prompt').innerHTML = prompt;
    $('.f-prompt').style.display = prompt ? '' : 'none';

    const dead = $('.g-dead');
    dead.style.display = mine.dead ? '' : 'none';
    if (mine.dead) dead.innerHTML = `YOU ARE DOWN<small>Waiting for the ${mateName.toLowerCase()} — they can get a new tank at the base garage</small>`;

    GunnerView.prototype.drawMinimap.call(this, { id: this.myId, x: this.pos.x, z: this.pos.z, h: this.aim.yaw }, this.states);
  }

  drawMate(ctx, toMap) {
    const m = this.me?.crew?.foot?.[this.mateRole];
    if (!m || m.dead) return;
    const [px, py] = toMap(m.x, m.z);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(Math.max(6, Math.min(194, px)), Math.max(6, Math.min(194, py)), 5, 0, Math.PI * 2);
    ctx.stroke();
  }

  render(renderer) {
    renderer.render(this.world.scene, this.camera);
    if (!this.vm.group.visible) return;
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.gunScene, this.gunCam);
    renderer.autoClear = auto;
  }

  dispose() {
    document.removeEventListener('pointerlockerror', this.onLockError);
    document.getElementById('scene').style.cursor = '';
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('contextmenu', this.onContext);
    this.world.scene.remove(this.pingMarker);
    this.el.remove();
  }
}
