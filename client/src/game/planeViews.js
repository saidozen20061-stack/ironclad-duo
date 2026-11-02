import * as THREE from 'three';
import { PLANES, FLIGHT } from '../../../shared/planes.js';
import { groundAt, WATER_LEVEL } from '../../../shared/map.js';
import { wrapAngle } from '../../../shared/tank.js';
import { net } from '../net.js';
import { settings } from '../settings.js';
import { GunnerView } from './gunner.js';
import { planeEye, sideGunPos } from '../models/planes.js';
import { buildMinigunViewmodel } from '../models/guns.js';

// The three ways to sit in a plane: pilot (cockpit), side gunner (door minigun + bomb sight) and
// solo (chase camera with mouse aim, right click for the cockpit). They reuse the gunner's
// pointer lock, minimap, ping, banners and thermal; only the HUD and camera are their own.

const DEG = 180 / Math.PI;
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const BANK_LIMIT = 1.1; // rad: how far A and D lean the plane over
const AIM_FAR = 900; // m: where the guns converge with nothing under the crosshair
const FLIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);

const HUD = `
  <div class="p-warn"></div>
  <div class="p-pipper"><i></i></div>
  <div class="p-nose"></div>
  <div class="p-bombsight"><svg viewBox="-100 -100 200 200"><g stroke="#ffd080" fill="none" stroke-width="1"><circle r="62"/><circle r="22"/><line x1="-90" x2="90" y1="0" y2="0"/><line y1="-90" y2="90" x1="0" x2="0"/><line x1="-8" x2="8" y1="-40" y2="-40"/><line x1="-8" x2="8" y1="40" y2="40"/></g></svg><div class="p-drift"></div></div>
  <div class="p-panel panel">
    <div class="p-name"></div>
    <div class="p-row"><span>SPD</span><b class="p-speed">0</b><small>km/h</small></div>
    <div class="p-row"><span>ALT</span><b class="p-alt">0</b><small>m</small></div>
    <div class="p-bar"><label>THR</label><i><u class="p-th"></u></i></div>
    <div class="p-bar"><label>FUEL</label><i><u class="p-fuel"></u></i></div>
    <div class="p-arms"></div>
    <div class="p-mods"></div>
  </div>
  <div class="p-hint"></div>
`;

const MODS = { engine: 'ENG', engine2: 'EN2', wingL: 'L.W', wingR: 'R.W', tail: 'TAIL', fuel: 'FUEL', gear: 'GEAR', guns: 'GUN', crew: 'CREW' };

function planeQuaternion(u, out = new THREE.Quaternion()) {
  return out.setFromEuler(_e.set(-u.gp, u.h, u.ty));
}

// Low-poly cockpit in its own little scene, drawn over the world so it never clips.
function buildCockpit(spec) {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xdfe4e8, 0x4a4030, 1.25));
  const sun = new THREE.DirectionalLight(0xfff0d8, 1.3);
  sun.position.set(0.5, 1, 0.4);
  scene.add(sun);
  const root = new THREE.Group();
  scene.add(root);
  const paint = new THREE.MeshStandardMaterial({ color: 0x4f5546, flatShading: true, roughness: 0.8 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x24261f, flatShading: true, roughness: 0.8 });
  const add = (g, m, x, y, z, rx = 0, rz = 0) => {
    const o = new THREE.Mesh(g, m);
    o.position.set(x, y, z);
    o.rotation.set(rx, 0, rz);
    root.add(o);
    return o;
  };
  // Instrument panel with a live canvas face.
  const canvas = document.createElement('canvas');
  canvas.width = 720;
  canvas.height = 240;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  add(new THREE.BoxGeometry(1.0, 0.36, 0.08), dark, 0, -0.33, -0.76);
  add(new THREE.PlaneGeometry(0.94, 0.313), new THREE.MeshBasicMaterial({ map: tex }), 0, -0.33, -0.715);
  // Coaming over the panel, canopy frame around the view, side rails.
  add(new THREE.BoxGeometry(1.25, 0.1, 0.32), paint, 0, -0.12, -0.82);
  if (spec.engines === 1) add(new THREE.BoxGeometry(0.8, 0.14, 1.6), paint, 0, -0.18, -1.65, 0.08);
  for (const s of [-1, 1]) {
    add(new THREE.BoxGeometry(0.05, 0.75, 0.05), dark, s * 0.55, 0.13, -0.8, 0.12, s * -0.34);
    add(new THREE.BoxGeometry(0.11, 0.4, 1.8), paint, s * 0.76, -0.4, 0.05);
    add(new THREE.BoxGeometry(0.04, 0.04, 1.6), dark, s * 0.55, 0.4, 0.05);
  }
  add(new THREE.BoxGeometry(1.2, 0.05, 0.05), dark, 0, 0.47, -0.7);
  add(new THREE.BoxGeometry(1.16, 0.05, 0.05), dark, 0, 0.5, 0.05);
  add(new THREE.BoxGeometry(0.03, 0.07, 0.03), dark, 0, -0.03, -0.78); // gun sight post
  // Stick and throttle.
  add(new THREE.CylinderGeometry(0.02, 0.025, 0.42, 6), dark, 0, -0.7, -0.35, -0.2);
  const lever = add(new THREE.BoxGeometry(0.035, 0.035, 0.2), new THREE.MeshStandardMaterial({ color: 0x8a3a2a, flatShading: true }), -0.62, -0.47, -0.25);
  // Seat armour behind the head: the pilot can't see behind the plane.
  add(new THREE.BoxGeometry(0.72, 0.62, 0.08), dark, 0, -0.42, 0.5);
  add(new THREE.BoxGeometry(1.4, 0.75, 0.5), paint, 0, -0.62, 1.9); // turtle deck blocks the view aft
  // The gunner's back and legs, behind the seat, for when the pilot looks round.
  if (spec.seats === 2 && spec.rear) {
    const cloth = new THREE.MeshStandardMaterial({ color: 0x5a4c34, flatShading: true });
    add(new THREE.BoxGeometry(0.44, 0.55, 0.26), cloth, 0.08, -0.2, 1.2);
    add(new THREE.SphereGeometry(0.13, 7, 5), new THREE.MeshStandardMaterial({ color: 0x3a3c32, flatShading: true }), 0.08, 0.17, 1.2);
    for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.14, 0.14, 0.45), cloth, 0.08 + s * 0.13, -0.5, 1.02);
  }
  return { scene, root, canvas, ctx: canvas.getContext('2d'), tex, lever };
}

function drawGauge(ctx, cx, cy, r, label, frac, value) {
  ctx.fillStyle = '#10120e';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#8c8f82';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.strokeStyle = '#d8d6c4';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 8; i++) {
    const a = Math.PI * 0.75 + (i / 8) * Math.PI * 1.5;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r * 0.8, cy + Math.sin(a) * r * 0.8);
    ctx.lineTo(cx + Math.cos(a) * r * 0.94, cy + Math.sin(a) * r * 0.94);
    ctx.stroke();
  }
  const a = Math.PI * 0.75 + Math.max(0, Math.min(1, frac)) * Math.PI * 1.5;
  ctx.strokeStyle = '#ffb040';
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(a) * r * 0.78, cy + Math.sin(a) * r * 0.78);
  ctx.stroke();
  ctx.fillStyle = '#d8d6c4';
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(label, cx, cy - r * 0.32);
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText(value, cx, cy + r * 0.62);
}

// Wheels above the ground (or water), the same figure on every altitude readout.
function heightAboveGround(self, pl, spec) {
  return Math.max(0, (pl.y ?? 0) - Math.max(groundAt(self.x, self.z), WATER_LEVEL) - spec.gearH);
}

function drawInstruments(cp, self, me, spec, pingBearing) {
  const ctx = cp.ctx;
  const pl = me.pl ?? {};
  const W = 720, H = 240;
  ctx.fillStyle = '#20221c';
  ctx.fillRect(0, 0, W, H);
  drawGauge(ctx, 92, 120, 84, 'SPEED', Math.abs(self.v ?? me.v) / (spec.maxSpeed * 1.4), `${Math.round(Math.abs(me.v) * 3.6)}`);
  const alt = heightAboveGround(self, pl, spec);
  drawGauge(ctx, 268, 120, 84, 'ALT', alt / FLIGHT.maxAlt, `${Math.round(alt)}`);
  // Artificial horizon.
  ctx.save();
  ctx.beginPath();
  ctx.arc(444, 120, 84, 0, Math.PI * 2);
  ctx.clip();
  ctx.translate(444, 120);
  ctx.rotate(self.ty);
  const off = self.gp * 120;
  ctx.fillStyle = '#38648a';
  ctx.fillRect(-200, -300 + off, 400, 300);
  ctx.fillStyle = '#5a452c';
  ctx.fillRect(-200, off, 400, 300);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-90, off);
  ctx.lineTo(90, off);
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = '#ffb040';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(392, 120);
  ctx.lineTo(432, 120);
  ctx.moveTo(456, 120);
  ctx.lineTo(496, 120);
  ctx.stroke();
  ctx.strokeStyle = '#8c8f82';
  ctx.beginPath();
  ctx.arc(444, 120, 84, 0, Math.PI * 2);
  ctx.stroke();
  // Compass strip with the gunner's ping.
  ctx.fillStyle = '#10120e';
  ctx.fillRect(546, 18, 164, 46);
  const hdg = (((-self.h * DEG) % 360) + 360) % 360;
  ctx.fillStyle = '#d8d6c4';
  ctx.font = 'bold 15px sans-serif';
  for (const [d, n] of [[0, 'N'], [90, 'E'], [180, 'S'], [270, 'W'], [360, 'N']]) {
    const dx = wrapAngle(((d - hdg) * Math.PI) / 180) * DEG;
    if (Math.abs(dx) < 42) ctx.fillText(n, 628 + dx * 1.9, 46);
  }
  if (pingBearing !== null) {
    const dx = Math.max(-40, Math.min(40, pingBearing * DEG)) * 1.9;
    ctx.fillStyle = '#ffd040';
    ctx.beginPath();
    ctx.moveTo(628 + dx, 62);
    ctx.lineTo(620 + dx, 74);
    ctx.lineTo(636 + dx, 74);
    ctx.fill();
  }
  ctx.fillStyle = '#ffb040';
  ctx.fillRect(627, 16, 2, 10);
  // Throttle and fuel bars.
  const bar = (x, label, f, col) => {
    ctx.fillStyle = '#10120e';
    ctx.fillRect(x, 84, 30, 112);
    ctx.fillStyle = col;
    ctx.fillRect(x + 3, 193 - 106 * Math.max(0, Math.min(1, f)), 24, 106 * Math.max(0, Math.min(1, f)));
    ctx.fillStyle = '#d8d6c4';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText(label, x + 15, 214);
  };
  bar(552, 'THR', pl.th ?? 0, '#c8a040');
  bar(592, 'FUEL', pl.fuel ?? 0, '#70b060');
  // Damage lights.
  const keys = Object.keys(me.mods ?? {});
  keys.forEach((k, i) => {
    const v = me.mods[k];
    ctx.fillStyle = v <= 0 ? '#ff3020' : v < 0.5 ? '#ffa020' : '#2c5a2c';
    const x = 642 + (i % 2) * 36, y = 88 + Math.floor(i / 2) * 26;
    ctx.fillRect(x, y, 30, 18);
    ctx.fillStyle = '#10120e';
    ctx.font = 'bold 10px sans-serif';
    ctx.fillText(MODS[k] ?? k, x + 15, y + 13);
  });
  cp.tex.needsUpdate = true;
}

class PlaneBase extends GunnerView {
  constructor(opts) {
    super(opts);
    this.isPlane = true;
    this.plane = PLANES[opts.tank];
    this.spotRange = 700;
    this.minimapSpan = 1100;
    this.el.classList.add('plane');
    this.el.insertAdjacentHTML('beforeend', HUD);
    this.$('.p-name').textContent = `${this.plane.name} · ${this.plane.class}`;
    this.flySend = { key: '', at: 0 };
    this.lastMods = '';
    this.camera.far = 4600;
    this.instrT = 0;
    this.cockpit = null;
    this.ownHidden = false;
  }

  // Pilot-style controls and the fire buttons.
  bindFlight() {
    const canvas = document.getElementById('scene');
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    this.mouseBtn = { left: false, right: false };
    this.onMouseDown = (e) => {
      if (!this.aiming()) {
        if (e.target === canvas && !this.paused) this.requestLock();
        return;
      }
      if (e.button === 0) this.mouseBtn.left = true;
      if (e.button === 2) this.mouseBtn.right = true;
    };
    this.onMouseUp = (e) => {
      if (e.button === 0) this.mouseBtn.left = false;
      if (e.button === 2) this.mouseBtn.right = false;
    };
    this.onMouseMove = (e) => {
      if (this.aiming()) this.onLook(e.movementX, e.movementY);
    };
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
  }

  setPaused(p) {
    this.paused = p;
    if (p && this.mouseBtn) {
      this.mouseBtn.left = false;
      this.mouseBtn.right = false;
    }
  }

  // Mouse: where you look, and where the guns point.
  onLook(dx, dy) {
    const k = 0.0022 * settings.sensitivity;
    this.aim.yaw = wrapAngle(this.aim.yaw - dx * k);
    this.aim.pitch = Math.max(-1.45, Math.min(1.45, this.aim.pitch - dy * k));
  }

  // The view turns along with the plane, and the mouse looks around from there. C looks ahead again.
  followPlane(self) {
    const a = this.aim;
    if (!a.initialised || this.keys.took('KeyC')) {
      a.yaw = self.h;
      a.pitch = self.gp;
      a.initialised = true;
    } else {
      a.yaw = wrapAngle(a.yaw + wrapAngle(self.h - this.lastH));
      a.pitch = Math.max(-1.45, Math.min(1.45, a.pitch + self.gp - this.lastGp));
    }
    this.lastH = self.h;
    this.lastGp = self.gp;
  }

  // The look direction as seen from the plane's own seat.
  lookFromSeat(self) {
    planeQuaternion(self, _q);
    const l = _v.set(Math.sin(this.aim.yaw) * Math.cos(this.aim.pitch), Math.sin(this.aim.pitch), Math.cos(this.aim.yaw) * Math.cos(this.aim.pitch)).applyQuaternion(_q.invert());
    this.look.yaw = Math.atan2(l.x, l.z);
    this.look.pitch = Math.asin(Math.max(-1, Math.min(1, l.y)));
    return this.look;
  }

  // WASD flies: W/S nose down/up, A/D bank and turn, E or Shift more throttle, Q less. On the
  // runway W is the throttle and S lifts off. The guns go to whatever the crosshair is on.
  sendControls(self, me) {
    const k = this.keys;
    if (k.took('KeyX')) net.send({ t: 'jump' });
    const onGround = !!me.pl?.ground;
    const turn = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    // Banks to a limit and levels itself when A and D are let go.
    const roll = turn ? (Math.abs(self.ty) < BANK_LIMIT || Math.sign(self.ty) !== turn ? turn : 0) : Math.max(-1, Math.min(1, -self.ty * 1.6));
    const up = (k.has('KeyE') || k.has('ShiftLeft') || k.has('ShiftRight') || (onGround && k.has('KeyW')) ? 1 : 0) - (k.has('KeyQ') ? 1 : 0);
    const look = this.camera.getWorldDirection(_v);
    const reach = this.raycast(this.camera.position, look, this.states, me.id) ?? AIM_FAR;
    const gun = _v2.copy(look).multiplyScalar(reach).add(this.camera.position).sub(_v3.set(self.x, self.y, self.z)).normalize();
    this.sendFly({
      t: 'fly',
      th: up,
      pitch: (k.has('KeyS') ? 1 : 0) - (k.has('KeyW') && !onGround ? 1 : 0),
      roll: +roll.toFixed(2),
      yaw: -turn * 0.5,
      gun: [+gun.x.toFixed(3), +gun.y.toFixed(3), +gun.z.toFixed(3)],
      fire: !!this.mouseBtn.left,
      bomb: k.has('Space'),
      rocket: k.has('KeyR'),
    });
  }

  // Send a control message at 20 Hz, or at once when it changes.
  sendFly(msg) {
    const key = JSON.stringify(msg);
    const now = performance.now();
    if (key !== this.flySend.key || now - this.flySend.at > 200) {
      if (now - this.flySend.at < 40) return;
      net.send(msg);
      this.flySend = { key, at: now };
    }
  }

  // A marker for where the nose really points; the crosshair stays in the middle, on the guns.
  placeNose(self) {
    const n = _v2.copy(fwdOf(self)).multiplyScalar(420).add(_v3.set(self.x, self.y, self.z)).project(this.camera);
    const nose = this.$('.p-nose');
    nose.style.display = n.z < 1 && Math.abs(n.x) < 1.1 && Math.abs(n.y) < 1.1 ? 'block' : 'none';
    nose.style.left = `${((n.x + 1) / 2) * 100}%`;
    nose.style.top = `${((1 - n.y) / 2) * 100}%`;
  }

  // Parts of the HUD every seat shares.
  planeHud(self, me) {
    const pl = me.pl ?? {};
    const $ = this.$;
    $('.g-lock').style.display = this.aiming() || this.paused ? 'none' : '';
    $('.g-thermal').classList.toggle('on', this.thermalActive());
    $('.p-speed').textContent = Math.round(Math.abs(me.v) * 3.6);
    $('.p-alt').textContent = Math.round(heightAboveGround(self, pl, this.plane));
    this.el.classList.toggle('cockpit', !!this.cockpitOn);
    $('.p-th').style.width = `${(pl.th ?? 0) * 100}%`;
    $('.p-fuel').style.width = `${(pl.fuel ?? 0) * 100}%`;
    const s = this.plane;
    $('.p-arms').innerHTML = `<span>GUN <b>${pl.ammo ?? 0}</b></span>${s.bombs ? `<span>BOMB <b>${pl.bombs ?? 0}</b></span>` : ''}${s.rockets ? `<span>RKT <b>${pl.rockets ?? 0}</b></span>` : ''}${s.rear ? `<span>MINIGUN <b>${pl.rear ?? 0}</b></span>` : ''}`;
    const modKey = JSON.stringify(me.mods);
    if (modKey !== this.lastMods) {
      this.lastMods = modKey;
      $('.p-mods').innerHTML = Object.entries(me.mods ?? {}).map(([k, v]) => `<i class="${v <= 0 ? 'dead' : v < 0.5 ? 'dmg' : ''}">${MODS[k] ?? k}</i>`).join('');
    }
    // Warnings, worst first.
    const w = me.dead ? '' : pl.stall ? 'STALL!' : pl.low ? 'PULL UP!' : pl.edge ? 'RETURN TO BATTLE' : pl.six ? 'ENEMY ON OUR SIX!' : pl.y > FLIGHT.maxAlt - 30 ? 'TOO HIGH' : '';
    const warnEl = $('.p-warn');
    if (warnEl.textContent !== w) warnEl.textContent = w;
    warnEl.classList.toggle('show', !!w);
    const dead = $('.g-dead');
    dead.style.display = me.dead ? '' : 'none';
    if (me.dead) dead.innerHTML = `PLANE DESTROYED<small>${me.respawnIn < 1e6 ? `New plane in ${Math.ceil(me.respawnIn)}s` : ''}</small>`;
    this.drawMinimap(self, this.states);
    const cd = me.pingCd ?? 0;
    $('.g-pingcd u').style.width = `${(1 - cd / 5) * 100}%`;
    $('.g-pingcd').classList.toggle('ready', cd <= 0);
    $('.g-pingcd span').textContent = cd > 0 ? `${cd.toFixed(1)}s` : me.ping ? `active ${Math.round(Math.hypot(me.ping.x - self.x, me.ping.z - self.z))}m` : 'ready';
  }

  // Bearing from the plane's nose to the gunner's ping (null without one).
  pingBearing(self, me) {
    return me.ping ? wrapAngle(self.h - Math.atan2(me.ping.x - self.x, me.ping.z - self.z)) : null;
  }

  // World-space placement of a point in the plane's own frame.
  planePoint(self, x, y, z, out) {
    planeQuaternion(self, _q);
    return out.set(x, y, z).applyQuaternion(_q).add(_v2.set(self.x, self.y, self.z));
  }

  showOwn(on) {
    const own = this.units.get(this.me?.id);
    if (own) own.handles.group.visible = on;
  }

  // Draw the world (or the heat picture), then the cockpit on top.
  render(renderer) {
    super.render(renderer);
    if (this.cockpitOn && this.cockpit) {
      const auto = renderer.autoClear;
      renderer.autoClear = false;
      renderer.clearDepth();
      const far = this.cockpitCam;
      far.aspect = this.camera.aspect;
      far.fov = this.camera.fov;
      far.updateProjectionMatrix();
      renderer.render(this.cockpit.scene, far);
      renderer.autoClear = auto;
    }
  }

  showBannerOnce(key, text) {
    if (this.lastBanner === key) return;
    this.lastBanner = key;
    this.showBanner(text);
  }

  ensureCockpit() {
    if (this.cockpit) return;
    this.cockpit = buildCockpit(this.plane);
    this.cockpitCam = new THREE.PerspectiveCamera(66, 1, 0.02, 10);
    this.cockpitCam.rotation.order = 'YXZ';
  }

  updateCockpit(dt, self, me, look) {
    this.ensureCockpit();
    this.cockpitOn = true;
    this.cockpitCam.rotation.set(look.pitch, look.yaw, 0);
    this.instrT -= dt;
    if (this.instrT <= 0) {
      this.instrT = 0.09;
      drawInstruments(this.cockpit, self, me, this.plane, this.pingBearing(self, me));
    }
    this.cockpit.lever.position.z = -0.25 - (me.pl?.th ?? 0) * 0.18;
    // Warning shake when stalling.
    this.cockpit.root.position.y = me.pl?.stall ? (Math.random() - 0.5) * 0.012 : 0;
  }

  dispose() {
    if (this.me) this.showOwn(true);
    window.removeEventListener('mousemove', this.onMouseMove);
    super.dispose();
  }

  // Gunner's update bits this class doesn't use.
  updateHud() {}
}

// ---------- Pilot ----------
export class PilotView extends PlaneBase {
  constructor(opts) {
    super(opts);
    this.el.classList.add('pilot');
    this.$('.g-lock').textContent = 'Click to take control';
    this.look = { yaw: 0, pitch: 0 };
    this.$('.p-hint').textContent = 'W/S nose down/up · A/D turn · E/Q throttle · Mouse aims guns · LMB guns · Space bombs · R rockets · C look ahead · X bail out';
    this.$('.g-pingcd').style.display = 'none';
    this.onPing = null;
    this.bindFlight();
  }

  update(dt, states, me) {
    this.me = me;
    this.states = states;
    this.renderDt = dt;
    const self = states.get(me.id);
    if (!self) return;
    this.followPlane(self);
    const look = this.lookFromSeat(self);
    const cam = this.camera;
    this.planePoint(self, 0, planeEye(this.tank) + 0.55, this.plane.size.length * 0.03, cam.position);
    planeQuaternion(self, _q);
    cam.quaternion.copy(_q).multiply(FLIP);
    cam.rotateY(look.yaw);
    cam.rotateX(look.pitch);
    cam.updateMatrixWorld();
    this.showOwn(false);
    this.world.update(cam.position, cam);
    this.updateCockpit(dt, self, me, look);
    if (!this.paused) this.sendControls(self, me);
    this.placeNose(self);
    this.planeHud(self, me);
  }
}

function fwdOf(u, out = new THREE.Vector3()) {
  return out.set(Math.sin(u.h) * Math.cos(u.gp), Math.sin(u.gp), Math.cos(u.h) * Math.cos(u.gp));
}

// ---------- Side gunner ----------
// Sits at the door with a minigun. Like a tank gunner, the aim stays on target while the
// plane manoeuvres; the gun turns anywhere on its mount except up past its stop.
const SIDE_MAX_PITCH = 0.6;
const SIDE_MIN_PITCH = -1.4;
const MOUNT_Y = -0.2;

export class PlaneGunnerView extends PlaneBase {
  constructor(opts) {
    super(opts);
    this.el.classList.add('rearg');
    this.bombSight = false;
    this.drift = 0;
    this.spin = 0;
    this.lastSend = { key: '', at: 0 };
    this.$('.p-hint').textContent = `Mouse turns the gun · LMB fires${this.plane.bombs ? ' · F bomb sight (LMB drops)' : ''} · T thermal · Q ping · X bail out`;
    this.bindFlight();
    // The minigun, drawn over the world so it never clips into the plane.
    this.gunScene = new THREE.Scene();
    this.gunScene.add(new THREE.HemisphereLight(0xe8ecf0, 0x4a4030, 1.15));
    const sun = new THREE.DirectionalLight(0xfff0d8, 1.9);
    sun.position.set(0.5, 1, 0.4);
    this.gunScene.add(sun);
    this.gunCam = new THREE.PerspectiveCamera(60, 1, 0.02, 10);
    const gun = buildMinigunViewmodel();
    this.mount = gun.group;
    this.barrels = gun.barrels;
    this.muzzle = gun.flash;
    // Low and to the right, angled in: the barrels run up towards the crosshair.
    this.mount.position.set(0.17, MOUNT_Y, -0.52);
    this.mount.rotation.set(0.14, 0.26, 0);
    this.gunScene.add(this.mount);
  }

  thermalActive() {
    return this.thermal;
  }

  onLook(dx, dy) {
    if (this.bombSight) return;
    const k = 0.0022 * settings.sensitivity;
    this.aim.yaw = wrapAngle(this.aim.yaw - dx * k);
    this.aim.pitch = Math.max(SIDE_MIN_PITCH, Math.min(SIDE_MAX_PITCH, this.aim.pitch - dy * k));
  }

  update(dt, states, me) {
    this.me = me;
    this.states = states;
    this.renderDt = dt;
    this.thermalKey();
    const self = states.get(me.id);
    if (!self) return;
    if (!this.aim.initialised) {
      this.aim.yaw = self.h - Math.PI / 2; // starts looking out of the door
      this.aim.pitch = -0.1;
      this.aim.initialised = true;
    }
    const k = this.keys;
    if (!this.paused) {
      if (k.took('KeyQ')) this.onPing?.();
      if (k.took('KeyX')) net.send({ t: 'jump' });
      if (this.plane.bombs && k.took('KeyF')) this.bombSight = !this.bombSight;
    }
    const cam = this.camera;
    const [dx, dy, dz] = sideGunPos(this.tank);
    this.$('.p-bombsight').classList.toggle('on', this.bombSight);
    this.$('.p-pipper').style.display = this.bombSight ? 'none' : '';
    const own = this.units.get(me.id);
    if (own?.handles.rear) own.handles.rear.visible = this.bombSight;
    this.showOwn(true);
    if (this.bombSight) {
      // Straight down through the floor, zoomed.
      this.planePoint(self, 0, -1.2, 0.5, cam.position);
      cam.quaternion.setFromEuler(_e.set(-Math.PI / 2, self.h + Math.PI, 0));
      cam.fov += (22 - cam.fov) * Math.min(1, dt * 8);
      // Which way should the pilot steer: a bank shifts the fall line.
      this.drift += (self.ty - this.drift) * Math.min(1, dt * 2);
      this.$('.p-drift').textContent = Math.abs(this.drift) < 0.05 ? 'STEADY' : this.drift > 0 ? 'STEER LEFT ◂' : '▸ STEER RIGHT';
    } else {
      // At the door, just over and outboard of the gun, looking along the aim.
      this.planePoint(self, dx - 0.2, dy + 0.42, dz - 0.1, cam.position);
      cam.quaternion.setFromEuler(_e.set(this.aim.pitch, this.aim.yaw + Math.PI, 0));
      cam.fov += (66 - cam.fov) * Math.min(1, dt * 8);
    }
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    this.world.update(cam.position, cam);

    const dir = cam.getWorldDirection(_v).clone();
    this.range = this.raycast(cam.position, dir, states, me.id);
    if (!this.paused) {
      const fire = !this.bombSight && this.mouseBtn.left;
      const bomb = this.bombSight && this.mouseBtn.left;
      const key = JSON.stringify([fire, bomb]);
      const now = performance.now();
      if (key !== this.lastSend.key || now - this.lastSend.at > 50) {
        net.send({ t: 'rear', dir: [+dir.x.toFixed(3), +dir.y.toFixed(3), +dir.z.toFixed(3)], fire, bomb });
        this.lastSend = { key, at: now };
      }
    }
    // Barrels spin up while the trigger is held.
    this.spin += ((this.mouseBtn.left && !this.bombSight ? 38 : 0) - this.spin) * Math.min(1, dt * 5);
    this.barrels.rotation.z += this.spin * dt;
    const firing = this.mouseBtn.left && !this.bombSight && (me.pl?.rear ?? 0) > 0;
    this.muzzle.visible = firing && Math.random() < 0.6;
    if (this.muzzle.visible) this.muzzle.rotation.z = Math.random() * 6;
    this.mount.position.y = MOUNT_Y + (firing ? (Math.random() - 0.5) * 0.004 : 0);
    this.cockpitOn = false;
    this.mount.visible = !this.bombSight;
    this.$('.p-pipper').style.left = '50%';
    this.$('.p-pipper').style.top = '50%';
    this.planeHud(self, me);
  }

  render(renderer) {
    super.render(renderer);
    if (!this.bombSight) {
      const auto = renderer.autoClear;
      renderer.autoClear = false;
      renderer.clearDepth();
      this.gunCam.aspect = this.camera.aspect;
      this.gunCam.updateProjectionMatrix();
      renderer.render(this.gunScene, this.gunCam);
      renderer.autoClear = auto;
    }
  }
}

// ---------- Solo ----------
export class PlaneSoloView extends PlaneBase {
  constructor(opts) {
    super(opts);
    this.el.classList.add('psolo');
    this.solo = true;
    this.$('.g-pingcd').style.display = 'none';
    this.onPing = null;
    this.camDist = null;
    this.$('.g-lock').textContent = 'Click to take control';
    this.$('.p-hint').textContent = 'W/S nose down/up · A/D turn · E/Q throttle · Mouse aims guns · LMB guns · Space bombs · R rockets · RMB cockpit · C look ahead · X bail out';
    this.bindFlight();
    this.look = { yaw: 0, pitch: 0 };
  }

  thermalActive() {
    return this.thermal && this.mouseBtn?.right;
  }

  update(dt, states, me) {
    this.me = me;
    this.states = states;
    this.renderDt = dt;
    this.thermalKey();
    const self = states.get(me.id);
    if (!self) return;
    this.followPlane(self);
    const inCockpit = !!this.mouseBtn.right;
    const cam = this.camera;
    const dir = _v.set(Math.sin(this.aim.yaw) * Math.cos(this.aim.pitch), Math.sin(this.aim.pitch), Math.cos(this.aim.yaw) * Math.cos(this.aim.pitch));
    if (inCockpit) {
      this.planePoint(self, 0, planeEye(this.tank) + 0.55, this.plane.size.length * 0.03, cam.position);
      const look = this.lookFromSeat(self);
      planeQuaternion(self, _q);
      cam.quaternion.copy(_q).multiply(FLIP);
      cam.rotateY(look.yaw);
      cam.rotateX(look.pitch);
      this.showOwn(false);
      this.updateCockpit(dt, self, me, look);
    } else {
      this.cockpitOn = false;
      this.showOwn(true);
      const want = this.plane.size.length * 1.5 + 9;
      const up = this.plane.size.height * 0.9 + 1.5;
      const px = self.x - dir.x * want, pz = self.z - dir.z * want;
      let py = self.y - dir.y * want + up;
      py = Math.max(py, Math.max(groundAt(px, pz), WATER_LEVEL) + 1.2);
      cam.position.set(px, py, pz);
      cam.rotation.order = 'YXZ';
      // Looks along the aim direction, so the crosshair stays in the centre.
      cam.rotation.set(this.aim.pitch, this.aim.yaw + Math.PI, 0);
    }
    cam.fov += (70 - cam.fov) * Math.min(1, dt * 6);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    this.world.update(cam.position, cam);
    if (!this.paused) this.sendControls(self, me);
    this.placeNose(self);
    this.planeHud(self, me);
  }
}

export function planeViewFor(role, opts) {
  if (role === 'solo') return new PlaneSoloView(opts);
  return role === 'gunner' ? new PlaneGunnerView(opts) : new PilotView(opts);
}
