import { keyName } from '../keybinds.js';
import * as THREE from 'three';
import { TANKS } from '../../../shared/constants.js';
import { net } from '../net.js';
import { Radar } from './radar.js';
import { pingSound } from '../audio.js';
import { settings } from '../settings.js';
import { buildInterior, InteriorFX } from './interior.js';

// Look-around limits (radians) relative to facing the dashboard.
const LOOK_YAW = (160 * Math.PI) / 180;
const LOOK_PITCH_UP = (75 * Math.PI) / 180;
const LOOK_PITCH_DOWN = (55 * Math.PI) / 180;

// Driver's view: a closed cockpit. No window to the outside, only instruments.

const DEG = 180 / Math.PI;

function screenTexture(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function compassBearing(h) {
  // World +X is west, so heading 0 = north, heading -90° = east.
  return ((-h * DEG) % 360 + 360) % 360;
}

const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

export class DriverView {
  constructor({ tank, hud, keys }) {
    this.spec = TANKS[tank];
    this.keys = keys;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b0d09);
    this.camera = new THREE.PerspectiveCamera(66, 1, 0.02, 20);
    this.camBase = new THREE.Vector3(0, 1.08, -0.05);
    this.shake = 0;
    this.lastSent = { key: '', at: 0 };
    this.t = 0;

    this.radar = new Radar(512);
    this.gauges = document.createElement('canvas');
    this.gauges.width = this.gauges.height = 512;
    this.status = document.createElement('canvas');
    this.status.width = this.status.height = 512;
    this.textures = [this.radar.canvas, this.gauges, this.status].map(screenTexture);

    this.tankType = tank;
    this.buildCockpit();
    // Send immediately on key changes too, so input isn't tied to the frame rate.
    keys.onChange = () => !this.paused && this.sendInput();

    // Looking around inside the hull: hold right mouse, or toggle free look with L.
    this.look = { yaw: 0, pitch: 0, free: false };
    this.onMouseMove = (e) => {
      if (this.paused || !(this.keys.on('driver.look') || this.look.free)) return;
      const k = 0.0035 * settings.sensitivity;
      this.look.yaw = Math.max(-LOOK_YAW, Math.min(LOOK_YAW, this.look.yaw - e.movementX * k));
      this.look.pitch = Math.max(-LOOK_PITCH_DOWN, Math.min(LOOK_PITCH_UP, this.look.pitch - e.movementY * k));
    };
    this.onContext = (e) => e.preventDefault();
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('contextmenu', this.onContext);

    this.el = document.createElement('div');
    this.el.className = 'hud driver';
    this.el.innerHTML = `
      <div class="d-hints panel"></div>
      <div class="d-repair panel" style="display:none"><span></span><i><u></u></i></div>
      <div class="d-ping panel" style="display:none"></div>
      <div class="d-flash"></div>
      <div class="d-dead"></div>`;
    hud.appendChild(this.el);
    this.refreshHints();
  }

  refreshHints() {
    this.el.querySelector('.d-hints').innerHTML = `<b>${keyName('drive.forward')}/${keyName('drive.back')}</b> throttle · <b>${keyName('drive.left')}/${keyName('drive.right')}</b> steer · <b>${keyName('drive.boost')}</b> boost · <b>${keyName('drive.brake')}</b> brake · <b>${keyName('drive.repair')}</b> repair (stopped) · <b>Hold ${keyName('driver.look')}</b> look around · <b>${keyName('driver.free')}</b> free look`;
  }

  buildCockpit() {
    const s = this.scene;
    const dark = new THREE.MeshStandardMaterial({ color: 0x23281d, flatShading: true, roughness: 0.9 });
    // Walls, fittings, gunner, shell rack, lights (see interior.js).
    this.interior = buildInterior(s, this.spec.frame ?? this.tankType, this.spec.weapon);
    this.levers = this.interior.levers;
    this.lamps = this.interior.lamps;
    this.warnLight = this.interior.warnLight;

    const panel = (w, h, tex, x, y, z, circle = false) => {
      const geo = circle ? new THREE.CircleGeometry(w / 2, 40) : new THREE.PlaneGeometry(w, h);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
      m.position.set(x, y, z);
      m.rotation.x = 0.42;
      m.rotation.y = Math.PI; // face the driver (camera looks towards +Z)
      s.add(m);
      // Bezel
      const bz = new THREE.Mesh(circle ? new THREE.CylinderGeometry(w / 2 + 0.025, w / 2 + 0.025, 0.03, 24) : new THREE.BoxGeometry(w + 0.05, h + 0.05, 0.03), dark);
      bz.position.set(x, y, z + 0.022);
      if (circle) bz.rotation.x = 0.42 - Math.PI / 2;
      else bz.rotation.x = 0.42;
      s.add(bz);
      return m;
    };
    // Note: screens sit just in front of the dashboard surface.
    this.radarMesh = panel(0.5, 0.5, this.textures[0], 0, 0.84, 0.545, true);
    this.gaugeMesh = panel(0.42, 0.42, this.textures[1], 0.52, 0.84, 0.545);
    this.statusMesh = panel(0.42, 0.42, this.textures[2], -0.52, 0.84, 0.545);
  }

  // ---- Reactions to the gunner's actions and hits (called by MatchClient) ----
  onOwnFire(kind) {
    if (kind === 'mg') {
      this.interior.rig.kick = Math.max(this.interior.rig.kick, 0.08);
      return;
    }
    this.interior.rig.kick = 1;
    if (kind !== 'ac') this.interior.rack.fired();
  }

  onHit(big) {
    this.interior.rig.jolt = Math.min(1.5, this.interior.rig.jolt + (big ? 1 : 0.3));
    if (big) {
      this.lightDrop = 0.35; // lamps cut out for a moment
      if (Math.random() < 0.5) this.interior.fx.sparks(InteriorFX.randomWallPoint(), 10);
    }
  }

  onModule(state) {
    // A module was damaged or destroyed: shower of sparks and a burst of smoke inside.
    const p = InteriorFX.randomWallPoint();
    this.interior.fx.sparks(p, state === 'destroyed' ? 30 : 16);
    this.interior.fx.smoke(p, state === 'destroyed' ? 6 : 3);
    this.lightDrop = 0.6;
  }

  onRespawn() {
    this.interior.rack.refill();
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    // Keep the whole dashboard in view on narrow screens.
    this.camera.fov = w / h < 1.4 ? 80 : 66;
    this.camera.updateProjectionMatrix();
  }

  flash(text) {
    const el = this.el.querySelector('.d-flash');
    el.textContent = text;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  // A shell landing close: the whole hull jolts and dust rains down.
  onNearBlast(k) {
    this.addShake(k * 0.6);
    this.interior.fx.dust(Math.round(4 + k * 26));
  }

  addShake(amount) {
    this.shake = Math.min(1.5, this.shake + amount);
  }

  sendInput() {
    const k = this.keys;
    const th = (k.on('drive.forward') ? 1 : 0) - (k.on('drive.back') ? 1 : 0);
    const st = (k.on('drive.left') ? 1 : 0) - (k.on('drive.right') ? 1 : 0);
    const msg = { t: 'drive', th, st, boost: k.on('drive.boost'), brake: k.on('drive.brake'), repair: k.on('drive.repair') };
    const key = JSON.stringify(msg);
    const now = performance.now();
    if (key !== this.lastSent.key || now - this.lastSent.at > 250) {
      net.send(msg);
      this.lastSent = { key, at: now };
    }
    return msg;
  }

  setPaused(p) {
    this.paused = p;
    if (p) {
      net.send({ t: 'drive', th: 0, st: 0, boost: false, brake: false });
      this.look.free = false;
    }
  }

  update(dt, states, me) {
    this.t += dt;
    if (!this.paused && this.keys.hit('driver.free')) {
      this.look.free = !this.look.free;
      if (this.look.free) document.getElementById('scene').requestPointerLock?.()?.catch?.(() => {});
      else if (document.pointerLockElement) document.exitPointerLock();
    }
    const self = me && states.get(me.id);
    const input = this.paused ? { th: 0, st: 0 } : this.sendInput();
    if (!self) return;

    // Levers follow the controls (left lever back = turn left).
    const [lL, lR] = this.levers;
    const target = (side) => -0.25 + (input.th - input.st * side) * 0.22;
    lL.rotation.x += (target(1) - lL.rotation.x) * Math.min(1, dt * 10);
    lR.rotation.x += (target(-1) - lR.rotation.x) * Math.min(1, dt * 10);

    // Camera: engine rumble grows with speed, plus impact shake.
    const rumble = 0.0012 + Math.min(1, Math.abs(me.v) / this.spec.maxSpeed) * 0.004;
    this.shake = Math.max(0, this.shake - dt * 2.2);
    const s = rumble + this.shake * 0.05;
    // Head turns with the look offset; it eases back to the dashboard when released.
    const lk = this.look;
    if (!lk.holding && !lk.free) {
      const back = Math.min(1, dt * 4);
      lk.yaw -= lk.yaw * back;
      lk.pitch -= lk.pitch * back;
    }
    // Leaning the head a little in the look direction keeps the view natural.
    const lean = 0.12;
    this.camera.position.set(
      this.camBase.x + Math.sin(lk.yaw) * lean * 0.5 + (Math.random() - 0.5) * s,
      this.camBase.y + Math.max(0, lk.pitch) * 0.08 + Math.sin(this.t * 31) * s + (Math.random() - 0.5) * s,
      this.camBase.z - (1 - Math.cos(lk.yaw)) * lean,
    );
    const basePitch = -0.36; // looking down at the dashboard
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(basePitch + lk.pitch * (1 - Math.abs(lk.pitch) * 0.1), Math.PI + lk.yaw, (Math.random() - 0.5) * this.shake * 0.04);

    // Interior life: gunner's legs follow the real turret, shell rack, sparks/smoke, lights.
    const it = this.interior;
    it.rig.update(dt, self.ty, self.gp);
    it.rack.update(dt, me);
    const hpFrac = Math.max(0, me.hp / this.spec.hp);
    const brokenMods = me.mods ? Object.values(me.mods).filter((v) => v <= 0).length : 0;
    it.fx.update(dt, me.dead ? 0 : (me.burning ? 1.5 : 0) + (hpFrac < 0.3 ? 0.5 : 0) + brokenMods * 0.2);
    if (!me.dead && (hpFrac < 0.3 || brokenMods) && Math.random() < dt * (0.4 + brokenMods * 0.3)) it.fx.sparks(InteriorFX.randomWallPoint(), 6);
    this.lightDrop = Math.max(0, (this.lightDrop ?? 0) - dt);
    // Lamps flicker when the electrics are hurt; they cut out briefly on big hits.
    const elec = Math.min(me.mods?.radar ?? 1, hpFrac * 2);
    const flicker = elec < 0.6 && Math.random() < (0.6 - elec) * 0.5 ? 0.15 + Math.random() * 0.4 : 1;
    const lampK = (this.lightDrop > 0 ? 0.12 : 1) * flicker * (me.dead ? 0.2 : 1);
    it.lights.forEach((l, i) => (l.intensity = (i === 0 ? 2.2 : 1.4) * lampK));
    it.basketLight.intensity = 0.9 * lampK;
    for (const b of it.lampBulbs) b.material.color.setScalar(0.25 + 0.75 * lampK).multiply(new THREE.Color(1, 0.88, 0.63));

    // Gunner's ping: pulse on the radar plus a two-tone beep when a new one arrives.
    if (me.ping) {
      if (me.ping.id !== this.pingId) {
        this.pingId = me.ping.id;
        pingSound();
      }
      this.radar.ping = { x: me.ping.x, z: me.ping.z, t0: this.radar.time - me.ping.age };
    } else {
      this.radar.ping = null;
    }
    this.updatePingHud(self, me.ping);

    // Damaged electronics make the radar noisy, then blank.
    const radarHp = me.mods?.radar ?? 1;
    this.radar.noise = radarHp <= 0 ? 1 : Math.max(0, (0.75 - radarHp) / 0.75);

    const rep = this.el.querySelector('.d-repair');
    const needsRepair = me.mods && Object.values(me.mods).some((v) => v < 1);
    rep.style.display = me.repair || (needsRepair && !me.dead) ? '' : 'none';
    if (me.repair) {
      rep.querySelector('span').textContent = `REPAIRING ${me.repair.mod.toUpperCase()}`;
      rep.querySelector('u').style.width = `${me.repair.p * 100}%`;
    } else if (needsRepair) {
      rep.querySelector('span').textContent = Math.abs(me.v) < 0.5 ? `Hold ${keyName('drive.repair')} to repair` : `Stop the tank, then hold ${keyName('drive.repair')} to repair`;
      rep.querySelector('u').style.width = '0%';
    }

    this.radar.update(dt, self, states, this.team ?? 'blue');
    this.radar.draw(self, self.ty);
    this.drawGauges(me, input);
    this.drawStatus(self, me);
    for (const t of this.textures) t.needsUpdate = true;

    // Warning lamps
    const md = me.mods ?? {};
    const warn = { engine: (md.engine ?? 1) < 0.5, tracks: (md.tracks ?? 1) <= 0, fire: !!me.burning };
    let anyWarn = false;
    for (const [name, lamp] of Object.entries(this.lamps)) {
      const on = warn[name] && Math.sin(this.t * 10) > 0;
      lamp.material.emissive.setHex(on ? 0xff2010 : 0x000000);
      anyWarn ||= warn[name];
    }
    this.warnLight.intensity = anyWarn && Math.sin(this.t * 10) > 0 ? 1.2 : 0;

    const dead = this.el.querySelector('.d-dead');
    dead.style.display = me.dead ? '' : 'none';
    if (me.dead) dead.innerHTML = `TANK DESTROYED<small>Respawning at base in ${Math.ceil(me.respawnIn)}s</small>`;
  }

  updatePingHud(self, ping) {
    const el = this.el.querySelector('.d-ping');
    el.style.display = ping ? '' : 'none';
    if (!ping) return;
    const dist = Math.hypot(ping.x - self.x, ping.z - self.z);
    // Bearing relative to the hull: 0 = dead ahead, positive = to the right.
    const rel = this.radar.bearing(self, ping.x, ping.z);
    const deg = Math.round((rel * DEG + 540) % 360 - 180);
    const side = Math.abs(deg) < 10 ? 'AHEAD' : Math.abs(deg) > 165 ? 'BEHIND' : deg > 0 ? `${deg}° RIGHT` : `${-deg}° LEFT`;
    el.innerHTML = `<b>PING</b> ${Math.round(dist)} m · ${side}`;
  }

  drawGauges(me, input) {
    const ctx = this.gauges.getContext('2d');
    const S = 512;
    ctx.fillStyle = '#0b100b';
    ctx.fillRect(0, 0, S, S);
    const cx = S / 2, cy = 250, R = 190;
    const kmh = Math.abs(me.v) * 3.6;
    const maxK = Math.ceil((this.spec.maxSpeed * 3.6 * 1.4) / 10) * 10;
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    // Dial
    ctx.strokeStyle = '#2d3a2a';
    ctx.lineWidth = 18;
    ctx.beginPath();
    ctx.arc(cx, cy, R, a0, a1);
    ctx.stroke();
    // Boost zone
    ctx.strokeStyle = 'rgba(217,164,65,0.55)';
    ctx.beginPath();
    ctx.arc(cx, cy, R, a0 + (a1 - a0) * (this.spec.maxSpeed * 3.6 / maxK), a1);
    ctx.stroke();
    ctx.fillStyle = '#b8c8a8';
    ctx.font = 'bold 26px Rajdhani, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let v = 0; v <= maxK; v += 10) {
      const a = a0 + (a1 - a0) * (v / maxK);
      ctx.strokeStyle = '#b8c8a8';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (R - 22), cy + Math.sin(a) * (R - 22));
      ctx.lineTo(cx + Math.cos(a) * (R - 40), cy + Math.sin(a) * (R - 40));
      ctx.stroke();
      if (v % 20 === 0) ctx.fillText(v, cx + Math.cos(a) * (R - 64), cy + Math.sin(a) * (R - 64));
    }
    const a = a0 + (a1 - a0) * Math.min(1, kmh / maxK);
    ctx.strokeStyle = '#ff8a3a';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * (R - 30), cy + Math.sin(a) * (R - 30));
    ctx.stroke();
    ctx.fillStyle = '#ff8a3a';
    ctx.beginPath();
    ctx.arc(cx, cy, 12, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#e8f0d8';
    ctx.font = 'bold 64px Rajdhani, sans-serif';
    ctx.fillText(Math.round(kmh), cx, cy + 80);
    ctx.font = 'bold 20px Rajdhani, sans-serif';
    ctx.fillStyle = '#8a9a80';
    ctx.fillText('KM/H', cx, cy + 118);

    // Gear
    const frac = me.v / this.spec.maxSpeed;
    const gear = me.v < -0.3 ? 'R' : Math.abs(me.v) < 0.3 ? 'N' : String(Math.min(5, 1 + Math.floor(frac * 4)));
    ctx.fillStyle = '#1a2418';
    ctx.fillRect(cx - 44, cy - 92, 88, 70);
    ctx.fillStyle = gear === 'R' ? '#ff6a4a' : '#7fffa0';
    ctx.font = 'bold 56px Rajdhani, sans-serif';
    ctx.fillText(gear, cx, cy - 56);
    ctx.font = 'bold 16px Rajdhani, sans-serif';
    ctx.fillStyle = '#8a9a80';
    ctx.fillText('GEAR', cx, cy - 106);

    // Boost bar
    const bw = 360;
    ctx.fillStyle = '#1a2418';
    ctx.fillRect(cx - bw / 2, 456, bw, 22);
    ctx.fillStyle = me.boost < 0.2 ? '#ff6a4a' : '#d9a441';
    ctx.fillRect(cx - bw / 2, 456, bw * me.boost, 22);
    ctx.fillStyle = '#e8f0d8';
    ctx.font = 'bold 18px Rajdhani, sans-serif';
    ctx.fillText(input.boost && me.boost > 0 ? 'BOOST ACTIVE' : 'BOOST', cx, 446);
    if (input.brake) {
      ctx.fillStyle = '#ff6a4a';
      ctx.fillText('BRAKE', cx + 150, 30);
    }
  }

  drawStatus(self, me) {
    const ctx = this.status.getContext('2d');
    const S = 512;
    ctx.fillStyle = '#0b100b';
    ctx.fillRect(0, 0, S, S);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Compass tape
    const bearing = compassBearing(self.h);
    ctx.save();
    ctx.beginPath();
    ctx.rect(20, 20, S - 40, 90);
    ctx.clip();
    ctx.fillStyle = '#121a12';
    ctx.fillRect(20, 20, S - 40, 90);
    const pxPerDeg = 4;
    for (let d = -70; d <= 70; d += 5) {
      const b = Math.round(bearing / 5) * 5 + d;
      const x = S / 2 + (b - bearing) * pxPerDeg;
      const bb = ((b % 360) + 360) % 360;
      ctx.strokeStyle = '#8fb08a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, 108);
      ctx.lineTo(x, bb % 45 === 0 ? 78 : bb % 15 === 0 ? 88 : 96);
      ctx.stroke();
      if (bb % 45 === 0) {
        ctx.fillStyle = bb === 0 ? '#ff8a3a' : '#e8f0d8';
        ctx.font = 'bold 30px Rajdhani, sans-serif';
        ctx.fillText(CARDINALS[bb / 45], x, 50);
      }
    }
    ctx.restore();
    ctx.fillStyle = '#ff8a3a';
    ctx.beginPath();
    ctx.moveTo(S / 2, 112);
    ctx.lineTo(S / 2 - 10, 126);
    ctx.lineTo(S / 2 + 10, 126);
    ctx.fill();
    ctx.fillStyle = '#e8f0d8';
    ctx.font = 'bold 34px Rajdhani, sans-serif';
    ctx.fillText(`${String(Math.round(bearing) % 360).padStart(3, '0')}°`, S / 2, 150);

    // Hull damage diagram (modules filled in by Phase 6).
    this.drawDamage(ctx, me);
  }

  drawDamage(ctx, me) {
    const S = 512;
    const hpFrac = Math.max(0, me.hp / this.spec.hp);
    const mods = me.mods ?? null;
    const color = (f) => (f <= 0 ? '#ff3a2a' : f < 0.5 ? '#ffb02a' : '#5fe07a');
    // Tank outline (top view)
    const x0 = 150, y0 = 190, w = 120, h = 240;
    ctx.strokeStyle = color(hpFrac);
    ctx.lineWidth = 4;
    ctx.strokeRect(x0, y0, w, h);
    ctx.fillStyle = mods ? color(mods.tracks) : '#5fe07a';
    ctx.globalAlpha = 0.6;
    ctx.fillRect(x0 - 26, y0, 20, h);
    ctx.fillRect(x0 + w + 6, y0, 20, h);
    ctx.fillStyle = mods ? color(mods.engine) : '#5fe07a';
    ctx.fillRect(x0 + 18, y0 + h - 70, w - 36, 54);
    ctx.fillStyle = mods ? color(mods.turret) : '#5fe07a';
    ctx.beginPath();
    ctx.arc(x0 + w / 2, y0 + 100, 38, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = mods ? color(mods.gun) : '#5fe07a';
    ctx.fillRect(x0 + w / 2 - 6, y0 - 40, 12, 110);
    ctx.fillStyle = mods ? color(mods.radar) : '#5fe07a';
    ctx.fillRect(x0 + 14, y0 + 14, 26, 26);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#e8f0d8';
    ctx.font = 'bold 22px Rajdhani, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('HULL', 330, 200);
    ctx.font = 'bold 48px Rajdhani, sans-serif';
    ctx.fillStyle = color(hpFrac);
    ctx.fillText(`${Math.round(hpFrac * 100)}%`, 330, 245);
    ctx.font = 'bold 18px Rajdhani, sans-serif';
    ctx.fillStyle = '#8a9a80';
    const labels = mods ? [['TRK', mods.tracks], ['ENG', mods.engine], ['TUR', mods.turret], ['GUN', mods.gun], ['RAD', mods.radar]] : [];
    labels.forEach(([n, f], i) => {
      ctx.fillStyle = color(f);
      ctx.fillText(`${n} ${Math.round(f * 100)}%`, 330, 300 + i * 30);
    });
    // Lamp labels under the console lamps are physical; list active alarms here too.
    const alarms = [];
    if (me.burning) alarms.push('FIRE');
    if (mods && mods.tracks <= 0) alarms.push('TRACKS');
    if (mods && mods.engine <= 0) alarms.push('ENGINE');
    if (alarms.length && Math.sin(this.t * 8) > -0.3) {
      ctx.fillStyle = '#ff3a2a';
      ctx.font = 'bold 26px Rajdhani, sans-serif';
      ctx.fillText(alarms.join(' · '), 20, 480);
    }
    ctx.textAlign = 'center';
  }

  render(renderer) {
    renderer.render(this.scene, this.camera);
  }

  dispose() {
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('contextmenu', this.onContext);
    this.el.remove();
    for (const t of this.textures) t.dispose();
  }
}
