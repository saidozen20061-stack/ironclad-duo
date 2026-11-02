import * as THREE from 'three';
import { tankPose, muzzlePose, sightPos } from '../../../shared/tank.js';
import { groundAt } from '../../../shared/map.js';
import { GUN_MAX_ELEVATION } from '../../../shared/constants.js';
import { propsNear, segmentHitsProp } from '../../../shared/props.js';
import { net } from '../net.js';
import { GunnerView } from './gunner.js';
import { keyName } from '../keybinds.js';

// Solo: one player drives AND shoots. A third-person camera orbits behind and above the
// tank and the turret follows where the camera looks; holding right click drops into the
// gunner's sight. Everything else (HUD, minimap, damage diagram, ammo, reload, shell
// switching) is the gunner's. Casemate tanks keep their limited gun arc on the host.

const SIGHT_ZOOMS = [1, 2, 6];
const BASE_FOV = 62;
const THIRD_FOV = 70;
const DEG = 180 / Math.PI;

export class SoloView extends GunnerView {
  constructor(opts) {
    super(opts);
    this.solo = true;
    this.sight = false;
    this.sightZoom = 1;
    this.camDist = null;
    this.aimSend = { yaw: 0, pitch: 0 };
    this.lastDrive = { key: '', at: 0 };
    this.el.classList.add('solo', 'third');
    this.$('.g-pingcd').style.display = 'none';
    this.onPing = null; // no pings in solo
  }

  // Fire, gun sight (hold) and machine gun.
  pollGun() {
    const on = this.aiming(), k = this.keys;
    this.setTrigger('main', on && k.on('gun.fire'));
    this.sight = on && k.on('solo.sight');
    if (this.spec.weapon.coax) this.setTrigger('coax', on && k.on('solo.mg'));
  }

  // Scroll picks the sight magnification (2× / 6×).
  cycleZoom(dir) {
    this.sightZoom = Math.max(1, Math.min(SIGHT_ZOOMS.length - 1, this.sightZoom + dir));
  }

  setPaused(p) {
    super.setPaused(p);
    if (p) {
      this.sight = false;
      net.send({ t: 'drive', th: 0, st: 0, boost: false, brake: false });
    }
  }

  sendDrive() {
    const k = this.keys;
    const th = (k.on('drive.forward') ? 1 : 0) - (k.on('drive.back') ? 1 : 0);
    const st = (k.on('drive.left') ? 1 : 0) - (k.on('drive.right') ? 1 : 0);
    const msg = { t: 'drive', th, st, boost: k.on('drive.boost'), brake: k.on('drive.brake'), repair: k.on('drive.repair') };
    const key = JSON.stringify(msg);
    const now = performance.now();
    if (key !== this.lastDrive.key || now - this.lastDrive.at > 250) {
      net.send(msg);
      this.lastDrive = { key, at: now };
    }
  }

  // Pull the camera in front of terrain and solid props between the tank and the camera.
  collide(pivot, want) {
    const d = want.clone().sub(pivot);
    const len = d.length();
    let t = 1;
    for (let i = 1; i <= 16; i++) {
      const f = i / 16;
      const x = pivot.x + d.x * f, y = pivot.y + d.y * f, z = pivot.z + d.z * f;
      if (y < groundAt(x, z) + 0.6) {
        t = (i - 1) / 16;
        break;
      }
    }
    for (const p of propsNear(pivot.x + d.x / 2, pivot.z + d.z / 2, len / 2 + 12)) {
      if (!p.solid || this.deadProps?.has(p.id)) continue;
      const h = segmentHitsProp(p, pivot.x, pivot.y, pivot.z, d.x, d.y, d.z);
      if (h !== null && h < t) t = h;
    }
    t = Math.max(0.12, t - 0.7 / len);
    return t * len;
  }

  // Thermal works through the gun sight (right click).
  thermalActive() {
    return this.thermal && this.sight;
  }

  update(dt, states, me) {
    this.me = me;
    this.renderDt = dt;
    this.thermalKey();
    const self = me && states.get(me.id);
    if (!self) return;
    if (!this.aim.initialised) {
      this.aim.yaw = self.h;
      this.aim.initialised = true;
    }
    this.pollGun();
    if (this.spec.weapon.shells) {
      if (this.keys.hit('gun.ap')) net.send({ t: 'shell', shell: 'AP' });
      if (this.keys.hit('gun.he')) net.send({ t: 'shell', shell: 'HE' });
    }
    if (!this.paused) this.sendDrive();
    this.zoomIdx = this.sight ? this.sightZoom : 0;
    this.el.classList.toggle('third', !this.sight);

    tankPose(this.spec, self.x, self.z, self.h, this.pose);
    const cam = this.camera;
    const sight = sightPos(this.spec, this.pose, self.x, self.z, self.ty, new THREE.Vector3());
    this.kick = (this.kick ?? 0) * Math.max(0, 1 - dt * 10);
    const dir = new THREE.Vector3(Math.sin(this.aim.yaw) * Math.cos(this.aim.pitch), Math.sin(this.aim.pitch), Math.cos(this.aim.yaw) * Math.cos(this.aim.pitch));
    if (this.sight) {
      // First-person gun sight, exactly like the gunner.
      cam.position.copy(sight);
      this.aimSend.yaw = this.aim.yaw;
      this.aimSend.pitch = this.aim.pitch;
    } else {
      // Behind and above the tank, looking where the player aims.
      const pivot = new THREE.Vector3(self.x, this.pose.y + this.spec.size.height + 0.9, self.z);
      const want = 7 + this.spec.size.length * 0.9;
      // Aiming steeply up, the camera stays behind the tank instead of sinking into the ground.
      const orbit = Math.min(this.aim.pitch, 0.3);
      const back = new THREE.Vector3(-Math.sin(this.aim.yaw) * Math.cos(orbit), -Math.sin(orbit), -Math.cos(this.aim.yaw) * Math.cos(orbit));
      back.y += 0.25;
      back.normalize();
      const free = this.collide(pivot, pivot.clone().addScaledVector(back, want));
      // Snap in fast when something blocks the view, ease back out slowly.
      this.camDist = this.camDist === null || free < this.camDist ? free : this.camDist + (free - this.camDist) * Math.min(1, dt * 3);
      cam.position.copy(pivot).addScaledVector(back, this.camDist);
      cam.position.y = Math.max(cam.position.y, groundAt(cam.position.x, cam.position.z) + 0.5);
    }
    cam.rotation.set(this.aim.pitch + this.kick, this.aim.yaw + Math.PI, (Math.random() - 0.5) * this.kick * 0.5);
    const zoom = SIGHT_ZOOMS[this.zoomIdx];
    const fov = this.sight ? 2 * Math.atan(Math.tan(BASE_FOV / 2 / DEG) / zoom) * DEG : THIRD_FOV;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov += (fov - cam.fov) * Math.min(1, dt * 14);
      cam.updateProjectionMatrix();
    }
    const own = this.units.get(me.id);
    if (own) own.handles.group.visible = !this.sight;
    if (import.meta.env.DEV && this.debugCam) {
      const d = this.debugCam;
      cam.position.set(d.x, d.y, d.z);
      cam.rotation.set(d.pitch ?? 0, (d.yaw ?? 0) + Math.PI, 0);
    }
    this.world.update(cam.position, cam);

    // What the crosshair is on; in third person the gun aims from its sight at that point.
    const look = new THREE.Vector3();
    cam.getWorldDirection(look);
    const hit = this.raycast(cam.position, look, states, me.id) ?? 900;
    const P = cam.position.clone().addScaledVector(look, hit);
    if (!this.sight) {
      this.aimSend.yaw = Math.atan2(P.x - sight.x, P.z - sight.z);
      this.aimSend.pitch = Math.max(-0.45, Math.min(GUN_MAX_ELEVATION, Math.atan2(P.y - sight.y, Math.hypot(P.x - sight.x, P.z - sight.z))));
    }
    this.range = this.raycast(cam.position, look, states, me.id) === null ? null : P.distanceTo(sight);

    const now = performance.now();
    if (now - this.lastAimSent.at > 50 && (this.aimSend.yaw !== this.lastAimSent.yaw || this.aimSend.pitch !== this.lastAimSent.pitch)) {
      net.send({ t: 'aim', yaw: +this.aimSend.yaw.toFixed(4), pitch: +this.aimSend.pitch.toFixed(4) });
      this.lastAimSent = { yaw: this.aimSend.yaw, pitch: this.aimSend.pitch, at: now };
    }

    // Where the gun actually points.
    const mz = muzzlePose(this.spec, this.pose, self.x, self.z, self.ty, self.gp);
    const gunRange = this.raycast(mz.pos, mz.dir, states, me.id) ?? 800;
    const p = mz.pos.clone().addScaledVector(mz.dir, gunRange).project(cam);
    const gm = this.$('.g-gunmark');
    const onScreen = p.z < 1 && Math.abs(p.x) < 1.2 && Math.abs(p.y) < 1.2;
    gm.style.display = onScreen ? '' : 'none';
    if (onScreen) {
      gm.style.left = `${((p.x + 1) / 2) * 100}%`;
      gm.style.top = `${((1 - p.y) / 2) * 100}%`;
      gm.classList.toggle('aligned', Math.hypot(p.x * cam.aspect, p.y) < 0.015);
    }

    this.updateHud(dt, self, me, states, zoom);
    // Repairs are the player's job too.
    if (me.repair && !me.dead) this.$('.w-state').textContent = `REPAIRING ${me.repair.mod.toUpperCase()} ${Math.round(me.repair.p * 100)}%`;
  }
}
