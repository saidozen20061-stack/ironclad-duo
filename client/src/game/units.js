import * as THREE from 'three';
import { TANKS } from '../../../shared/constants.js';
import { tankPose, wrapAngle } from '../../../shared/tank.js';
import { groundAt, WATER_LEVEL } from '../../../shared/map.js';
import { PLANES } from '../../../shared/planes.js';
import { buildPlane } from '../models/planes.js';
import { buildTank, trackMaterial } from '../models/tanks.js';
import { buildATGun } from '../models/infantry.js';
import { SoldierRig } from '../models/rig.js';
import { quality } from '../settings.js';
import { markHeat } from './thermal.js';

const burnt = new THREE.MeshStandardMaterial({ color: 0x1d1b19, flatShading: true, roughness: 1 });
const kindOf = (type) => (TANKS[type] ? 'tank' : PLANES[type] ? 'plane' : type === 'atgun' ? 'atgun' : 'inf');

// Track links: a stripe texture scrolled per tank as it drives.
const trackTex = (() => {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 8;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#2b2b27';
  ctx.fillRect(0, 0, 32, 8);
  ctx.fillStyle = '#15150f';
  for (let x = 0; x < 32; x += 8) ctx.fillRect(x, 0, 3, 8);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(14, 1);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();

// Owns the 3D models for every unit and applies interpolated state each frame.
// Soldiers are animated rigs (full detail close by, cheaper further out); tanks get
// gun recoil, sprung suspension, braking dip and rolling tracks.
export class UnitsView {
  constructor(scene) {
    this.scene = scene;
    this.models = new Map(); // id -> model record
    this.camPos = new THREE.Vector3();
    this.frame = 0;
  }

  ensure(u) {
    let m = this.models.get(u.id);
    if (m && (m.type !== u.type || m.team !== u.team)) {
      this.scene.remove(m.root);
      m = null;
    }
    if (!m) {
      const kind = kindOf(u.type);
      m = { kind, type: u.type, team: u.team, dead: false, pose: { y: 0, quat: new THREE.Quaternion(), up: new THREE.Vector3() }, last: { x: u.x, z: u.z }, h: u.h };
      if (kind === 'tank') {
        m.handles = buildTank(u.type, u.team, this.paintFor?.(u) ?? u.type);
        // Own copy of the track material so this tank's tracks scroll on their own.
        const tm = trackMaterial();
        m.trackTex = trackTex.clone();
        const own = new THREE.MeshStandardMaterial({ color: 0xffffff, map: m.trackTex, flatShading: true, roughness: 0.85, metalness: 0.1 });
        m.handles.group.traverse((o) => o.isMesh && o.material === tm && (o.material = own));
        m.trackK = 14 / TANKS[u.type].size.length;
        m.originals = [];
        m.handles.group.traverse((o) => o.isMesh && m.originals.push([o, o.material]));
        m.root = m.handles.group;
        m.gunZ = m.handles.gun.position.z;
        Object.assign(m, { recoil: 0, v: 0, pitch: 0, pitchV: 0, roll: 0, terrainPitch: null });
      } else if (kind === 'plane') {
        m.handles = buildPlane(u.type, u.team, this.paintFor?.(u) ?? u.type);
        m.root = m.handles.group;
        m.originals = [];
        m.handles.group.traverse((o) => o.isMesh && m.originals.push([o, o.material]));
      } else if (kind === 'atgun') {
        m.handles = buildATGun(u.team);
        m.root = m.handles.group;
      } else {
        m.rig = new SoldierRig(u.team, u.type);
        m.handles = m.rig; // .group, like the other models
        m.root = m.rig.group;
        m.acc = 0;
        if (u.dead) m.rig.die({ fromAngle: Math.PI });
      }
      // Heat for the thermal sight, kept up to date in updateHeat while it is in use.
      m.heatSrc = kind === 'tank' || kind === 'plane' ? { heat: 0.5, engine: new THREE.Vector4(), hotE: 1, barrel: new THREE.Vector4(), hotB: 0 } : { heat: kind === 'inf' ? 0.82 : 0.3 };
      m.barrelHeat = 0;
      m.coolT = 0;
      markHeat(m.root, m.heatSrc);
      this.scene.add(m.root);
      this.models.set(u.id, m);
    }
    return m;
  }

  update(states, dt = 0.016) {
    this.frame++;
    for (const [id, m] of this.models) {
      if (!states.has(id)) {
        this.scene.remove(m.root);
        if (m.groundShadow) this.scene.remove(m.groundShadow);
        // A tank or plane has its own model; soldiers share theirs, all but the skeleton.
        if (m.kind === 'tank' || m.kind === 'plane') m.root.traverse((o) => o.geometry?.dispose());
        m.rig?.mesh.skeleton.dispose();
        m.trackTex?.dispose();
        this.models.delete(id);
      }
    }
    for (const u of states.values()) {
      const m = this.ensure(u);
      const dist = Math.hypot(u.x - this.camPos.x, u.z - this.camPos.z);
      // Past the end of the fog nothing is drawn at all; small things go earlier (LOD).
      const fogEnd = (this.scene.fog?.far ?? quality().drawDistance) * 1.15;
      const seeThroughFog = this.thermal ? 2 : 1;
      // A Leviathan is the exception: it looms over the battlefield from anywhere on the map.
      m.root.visible = PLANES[u.type]?.seeFar || dist < Math.min(fogEnd * seeThroughFog, m.kind === 'tank' || m.kind === 'plane' ? Infinity : m.kind === 'inf' ? 650 : 900);
      if (u.dead) m.coolT += dt;
      else m.coolT = 0;
      m.barrelHeat *= Math.exp(-dt / 25); // barrels hold their heat for a long time
      if (!m.root.visible) continue;
      if (m.kind === 'plane') this.updatePlane(m, u, dt);
      else if (m.kind === 'tank') this.updateTank(m, u, dt);
      else if (m.kind === 'atgun') this.updateGun(m, u);
      else this.updateSoldier(m, u, dt, dist);
      m.last.x = u.x;
      m.last.z = u.z;
      if (this.thermal) this.updateHeat(m, u);
    }
  }

  updateHeat(m, u) {
    const src = m.heatSrc;
    if (m.kind === 'inf') {
      // Body heat; a body cools down over a minute or so.
      src.heat = u.dead ? 0.12 + 0.7 * Math.exp(-m.coolT / 25) : 0.82;
      return;
    }
    if (m.kind === 'plane') {
      // Engines blaze, the skin stays cool in the slipstream; a wreck cools off.
      const spec = PLANES[u.type];
      src.heat = u.dead ? 0.14 + 0.6 * Math.exp(-m.coolT / 40) : 0.36;
      src.barrel.w = 0;
      if (u.dead) src.engine.w = 0;
      else {
        _v.set(m.handles.engineX, 0, m.handles.engineZ).applyMatrix4(m.root.matrixWorld);
        src.engine.set(_v.x, _v.y, _v.z, spec.size.width * 0.2 + 1.6);
        src.hotE = 1;
      }
      return;
    }
    if (m.kind !== 'tank') {
      src.heat = u.dead ? 0.1 + 0.25 * Math.exp(-m.coolT / 40) : 0.3;
      return;
    }
    const spec = TANKS[u.type];
    if (u.dead) {
      // A wreck starts out burning hot and cools down over a couple of minutes.
      src.heat = 0.14 + 0.82 * Math.exp(-m.coolT / 45);
      src.engine.w = 0;
    } else {
      // A running engine and rear hull are the hottest thing on the field; driving warms
      // the rest of the hull.
      src.heat = 0.48 + 0.14 * Math.min(1, Math.abs(m.v) / 8);
      _v.set(0, spec.size.height * 0.55, -spec.size.length * 0.34).applyMatrix4(m.root.matrixWorld);
      src.engine.set(_v.x, _v.y, _v.z, spec.size.width * 0.85);
      src.hotE = 1;
    }
    if (m.barrelHeat > 0.03) {
      m.handles.muzzle.getWorldPosition(_v);
      src.barrel.set(_v.x, _v.y, _v.z, spec.mount.barrel + 0.6);
      src.hotB = 0.42 + 0.56 * m.barrelHeat;
    } else src.barrel.w = 0;
  }

  // Match events that drive animation: shots (recoil), hits (flinch), kills (death style).
  onEvent(ev, states) {
    if (ev.k === 'f') {
      const m = this.models.get(ev.o);
      if (m?.rig) m.rig.shoot();
      else if (m?.kind === 'tank') {
        if (ev.kind !== 'mg') m.recoil = 1;
        m.barrelHeat = Math.min(1, m.barrelHeat + (ev.kind === 'mg' ? 0.015 : ev.kind === 'ac' ? 0.07 : 0.4));
      }
      if (m?.kind === 'plane' && ev.kind === 'mg') m.gunSpin = 1;
    } else if (ev.k === 'i') {
      const m = this.models.get(ev.u);
      const u = states.get(ev.u);
      if (m?.rig && u) m.rig.hit(this.sideOf(u, ev.x, ev.z), false);
      // Big explosions make everyone nearby flinch.
      if (['he', 'heavy', 'rocket', 'grenade'].includes(ev.kind)) {
        for (const [id, mm] of this.models) {
          if (!mm.rig || mm.rig.death) continue;
          const s = states.get(id);
          if (s && Math.hypot(s.x - ev.x, s.z - ev.z) < 14) mm.rig.hit(this.sideOf(s, ev.x, ev.z), true);
        }
      }
    } else if (ev.k === 'k') {
      const m = this.models.get(ev.u);
      const u = states.get(ev.u);
      if (!m?.rig || !u) return;
      if (ev.bx !== undefined && Math.hypot(u.x - ev.bx, u.z - ev.bz) < 9) {
        // Thrown away from the blast: direction in the soldier's own frame.
        const wx = u.x - ev.bx, wz = u.z - ev.bz;
        const l = Math.hypot(wx, wz) || 1;
        const c = Math.cos(u.h), s = Math.sin(u.h);
        m.rig.die({ blast: [(wx * c - wz * s) / l, (wx * s + wz * c) / l] });
      } else if (ev.dx !== undefined) {
        m.rig.die({ fromAngle: wrapAngle(Math.atan2(-ev.dx, -ev.dz) - u.h) });
      } else m.rig.die({ fromAngle: (Math.random() - 0.5) * 6 });
    }
  }

  // Which side something at (x, z) is on, from the unit's point of view (+1 left, -1 right).
  sideOf(u, x, z) {
    return wrapAngle(Math.atan2(x - u.x, z - u.z) - u.h) > 0 ? 1 : -1;
  }

  updateTank(m, u, dt) {
    const spec = TANKS[u.type];
    tankPose(spec, u.x, u.z, u.h, m.pose);
    const g = m.handles.group;
    g.position.set(u.x, m.pose.y, u.z);
    // Speed along the hull from interpolated motion.
    const fx = Math.sin(u.h), fz = Math.cos(u.h);
    const moved = (u.x - m.last.x) * fx + (u.z - m.last.z) * fz;
    const v = moved / Math.max(dt, 1e-3);
    const accel = Math.max(-25, Math.min(25, (v - m.v) / Math.max(dt, 1e-3)));
    m.v += (v - m.v) * Math.min(1, dt * 6);
    // Suspension: a damped spring on hull pitch, kicked by braking / accelerating and by
    // sudden changes of the ground slope (bumps).
    const terrainPitch = Math.asin(Math.max(-1, Math.min(1, new THREE.Vector3(0, 0, 1).applyQuaternion(m.pose.quat).y)));
    if (m.terrainPitch !== null && !u.dead) m.pitchV += (terrainPitch - m.terrainPitch) * -2.2;
    m.terrainPitch = terrainPitch;
    const target = u.dead ? 0 : Math.max(-0.07, Math.min(0.07, -accel * 0.01));
    m.pitchV += ((target - m.pitch) * 60 - m.pitchV * 7) * dt;
    m.pitch += m.pitchV * dt;
    const turn = wrapAngle(u.h - (m.h ?? u.h)) / Math.max(dt, 1e-3);
    m.h = u.h;
    m.roll += (Math.max(-0.05, Math.min(0.05, -turn * m.v * 0.006)) - m.roll) * Math.min(1, dt * 4);
    _q.setFromEuler(_e.set(m.pitch, 0, m.roll));
    g.quaternion.copy(m.pose.quat).multiply(_q);
    m.handles.turret.rotation.y = u.ty;
    m.handles.gun.rotation.x = -u.gp;
    // Gun recoil: the barrel slams back and eases forward again.
    m.recoil *= Math.exp(-dt * 5);
    m.handles.gun.position.z = m.gunZ - m.recoil * 0.12 * spec.mount.barrel;
    if (m.trackTex && !u.dead) m.trackTex.offset.x -= moved * m.trackK / 1;
    if (u.dead !== m.dead) {
      m.dead = u.dead;
      for (const [o, mat] of m.originals) o.material = u.dead ? burnt : mat;
      m.handles.turret.rotation.z = u.dead ? 0.12 : 0;
      m.handles.turret.position.y += u.dead ? -0.15 : 0.15;
    }
  }

  updatePlane(m, u, dt) {
    const g = m.root;
    m.pose.y = u.y;
    g.position.set(u.x, u.y, u.z);
    g.rotation.order = 'YXZ';
    g.rotation.set(-u.gp, u.h, u.ty);
    if (m.handles.rear) {
      m.handles.rear.rotation.set(-u.gx, u.gy, 0);
      // The barrels whirl for a moment after every burst.
      m.gunSpin = Math.max(0, (m.gunSpin ?? 0) - dt * 1.5);
      m.handles.rearSpin.rotation.z += m.gunSpin * 40 * dt;
      if (m.handles.otherSpin) m.handles.otherSpin.rotation.z += m.gunSpin * 40 * dt;
    }
    if (m.handles.foldingGear) m.handles.foldingGear.visible = u.y - Math.max(groundAt(u.x, u.z), WATER_LEVEL) < PLANES[u.type].gearH + 12;
    if (m.handles.flame) {
      m.handles.flame.visible = u.ab && !u.dead;
      if (u.ab) m.handles.flame.scale.z = 0.8 + Math.random() * 0.5;
    }
    // So big that its shadow is worth drawing wherever it flies, far past the sun's shadow map.
    if (m.handles.shadowShape) {
      if (!m.groundShadow) {
        m.groundShadow = m.handles.shadowShape;
        this.scene.add(m.groundShadow);
      }
      m.groundShadow.visible = !u.dead;
      m.groundShadow.position.set(u.x, Math.max(groundAt(u.x, u.z), WATER_LEVEL) + 1.5, u.z);
      m.groundShadow.rotation.y = u.h;
    }
    const spin = u.dead ? 0 : 45;
    for (const p of m.handles.props) {
      p.rotation.z += spin * dt * (p.userData.dir ?? 1);
      if (p.userData.disc) p.userData.disc.visible = spin > 0;
    }
    if (u.dead !== m.dead) {
      m.dead = u.dead;
      for (const [o, mat] of m.originals) o.material = u.dead ? burnt : mat;
    }
  }

  updateGun(m, u) {
    m.pose.y = groundAt(u.x, u.z);
    m.root.position.set(u.x, m.pose.y, u.z);
    m.root.rotation.y = u.h;
    m.handles.turret.rotation.y = u.ty;
    m.handles.gun.rotation.x = -u.gp;
    if (u.dead !== m.dead) {
      m.dead = u.dead;
      m.root.rotation.z = u.dead ? 0.35 : 0;
      m.handles.crew.forEach((c) => (c.group.visible = !u.dead));
    }
  }

  updateSoldier(m, u, dt, dist) {
    const y = groundAt(u.x, u.z);
    m.pose.y = y + u.y; // u.y: jump height (player crew), or parachute height
    if (u.y > 2.5 || m.chute) {
      if (!m.chute) {
        m.chute = new THREE.Group();
        const canopy = new THREE.Mesh(new THREE.SphereGeometry(3.2, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xd8d2bd, flatShading: true, side: THREE.DoubleSide }));
        canopy.position.y = 6.2;
        canopy.scale.y = 0.65;
        m.chute.add(canopy);
        for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          const line = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 5.2, 3), new THREE.MeshBasicMaterial({ color: 0x3a3a34 }));
          line.position.set(sx * 1.2, 4.0, sz * 1.2);
          line.rotation.set(sz * 0.42, 0, -sx * 0.42);
          m.chute.add(line);
        }
        m.root.add(m.chute);
      }
      m.chute.visible = u.y > 2.5;
    }
    m.root.position.set(u.x, m.pose.y, u.z);
    m.root.rotation.y = u.h;
    if (u.dead && !m.rig.death) m.rig.die({ fromAngle: (Math.random() - 0.5) * 6 });
    // Animation LOD: full rig + foot IK close up, plain rig further out, and far away
    // only every third frame.
    const lod = dist < 55 ? 0 : dist < 180 ? 1 : 2;
    m.acc += dt;
    if (lod === 2 && (this.frame + u.id) % 3) return;
    const step = m.acc;
    m.acc = 0;
    const vx = (u.x - (m.ax ?? u.x)) / Math.max(step, 1e-3);
    const vz = (u.z - (m.az ?? u.z)) / Math.max(step, 1e-3);
    m.ax = u.x;
    m.az = u.z;
    const c = Math.cos(u.h), s = Math.sin(u.h);
    const turn = wrapAngle(u.h - (m.ah ?? u.h)) / Math.max(step, 1e-3);
    m.ah = u.h;
    const crew = u.type === 'crew';
    const speed = Math.hypot(vx, vz);
    m.rig.update({
      dt: step,
      speed: Math.min(speed, 8),
      fwd: vx * s + vz * c,
      side: vx * c - vz * s,
      turn,
      code: Math.round(u.ty),
      aimPitch: u.gp,
      aiming: crew && speed < 4.5,
      lod,
      ground: lod === 0 ? groundAt : null,
      x: u.x,
      z: u.z,
      h: u.h,
      y,
    });
  }

  get(id) {
    const m = this.models.get(id);
    return m && { ...m, handles: m.handles };
  }
}
