import * as THREE from 'three';
import { TANKS } from '../../../shared/constants.js';
import { tankPose } from '../../../shared/tank.js';
import { groundAt } from '../../../shared/map.js';
import { buildTank } from '../models/tanks.js';
import { buildSoldier, buildATGun } from '../models/infantry.js';

const burnt = new THREE.MeshStandardMaterial({ color: 0x1d1b19, flatShading: true, roughness: 1 });
const kindOf = (type) => (TANKS[type] ? 'tank' : type === 'atgun' ? 'atgun' : 'inf');

// Owns the 3D models for every unit and applies interpolated state each frame.
export class UnitsView {
  constructor(scene) {
    this.scene = scene;
    this.models = new Map(); // id -> model record
    this.camPos = new THREE.Vector3();
  }

  ensure(u) {
    let m = this.models.get(u.id);
    if (m && (m.type !== u.type || m.team !== u.team)) {
      this.scene.remove(m.root);
      m = null;
    }
    if (!m) {
      const kind = kindOf(u.type);
      m = { kind, type: u.type, team: u.team, dead: false, pose: { y: 0, quat: new THREE.Quaternion(), up: new THREE.Vector3() }, last: { x: u.x, z: u.z } };
      if (kind === 'tank') {
        m.handles = buildTank(u.type, u.team);
        m.originals = [];
        m.handles.group.traverse((o) => o.isMesh && m.originals.push([o, o.material]));
        m.root = m.handles.group;
      } else if (kind === 'atgun') {
        m.handles = buildATGun(u.team);
        m.root = m.handles.group;
      } else {
        m.handles = buildSoldier(u.team, u.type);
        m.root = m.handles.group;
      }
      this.scene.add(m.root);
      this.models.set(u.id, m);
    }
    return m;
  }

  update(states, dt = 0.016) {
    for (const [id, m] of this.models) {
      if (!states.has(id)) {
        this.scene.remove(m.root);
        this.models.delete(id);
      }
    }
    for (const u of states.values()) {
      const m = this.ensure(u);
      const dist = Math.hypot(u.x - this.camPos.x, u.z - this.camPos.z);
      // Hide small things far away (LOD); tanks stay visible to the fog.
      m.root.visible = m.kind === 'tank' || dist < (m.kind === 'inf' ? 650 : 900);
      if (!m.root.visible) continue;
      if (m.kind === 'tank') this.updateTank(m, u);
      else if (m.kind === 'atgun') this.updateGun(m, u);
      else this.updateSoldier(m, u, dt, dist);
      m.last.x = u.x;
      m.last.z = u.z;
    }
  }

  updateTank(m, u) {
    tankPose(TANKS[u.type], u.x, u.z, u.h, m.pose);
    const g = m.handles.group;
    g.position.set(u.x, m.pose.y, u.z);
    g.quaternion.copy(m.pose.quat);
    m.handles.turret.rotation.y = u.ty;
    m.handles.gun.rotation.x = -u.gp;
    if (u.dead !== m.dead) {
      m.dead = u.dead;
      for (const [o, mat] of m.originals) o.material = u.dead ? burnt : mat;
      m.handles.turret.rotation.z = u.dead ? 0.12 : 0;
      m.handles.turret.position.y += u.dead ? -0.15 : 0.15;
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
    m.pose.y = groundAt(u.x, u.z) + u.y; // u.y: jump height (player crew)
    const s = m.handles;
    s.group.position.set(u.x, m.pose.y, u.z);
    s.group.rotation.y = u.h;
    if (u.dead) {
      // Fall over once.
      s.inner.rotation.x = Math.min(Math.PI / 2, s.inner.rotation.x + dt * 5);
      s.inner.position.y = Math.max(-0.1, s.inner.position.y - dt);
      s.legs.forEach((l) => (l.rotation.x = 0));
      return;
    }
    const crouch = u.ty > 0.5;
    s.inner.rotation.x = crouch ? 0.35 : 0;
    s.inner.position.y = crouch ? -0.35 : 0;
    // Walk cycle from actual movement speed (skipped far away).
    const moved = Math.hypot(u.x - m.last.x, u.z - m.last.z) / Math.max(dt, 1e-3);
    if (dist < 250 && moved > 0.4) {
      s.phase += dt * moved * 2.6;
      const a = Math.sin(s.phase) * 0.7;
      s.legs[0].rotation.x = a;
      s.legs[1].rotation.x = -a;
    } else {
      s.legs[0].rotation.x = crouch ? -1.1 : 0;
      s.legs[1].rotation.x = crouch ? 0.3 : 0;
    }
  }

  get(id) {
    const m = this.models.get(id);
    return m && { ...m, handles: m.handles };
  }
}
