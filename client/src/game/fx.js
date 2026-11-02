import * as THREE from 'three';
import { groundAt, WATER_LEVEL } from '../../../shared/map.js';
import { quality } from '../settings.js';

// Projectiles (client-side ballistic replay of server fire events) and simple particle effects.
const GRAVITY = 9.81;

const TRACER = {
  ac: { color: 0xffb347, len: 4, width: 0.12 },
  ap: { color: 0xfff0c0, len: 7, width: 0.18 },
  he: { color: 0xffa040, len: 6, width: 0.2 },
  heavy: { color: 0xffd080, len: 9, width: 0.3 },
  mg: { color: 0xff7040, len: 3, width: 0.06 },
  rifle: { color: 0xffe070, len: 2.2, width: 0.04 },
  rocket: { color: 0xffc060, len: 1.4, width: 0.22 },
  grenade: { color: 0x2f3a26, len: 0.14, width: 0.1 },
};

const IMPACT_SIZE = { ac: 1.2, ap: 2, he: 4.5, heavy: 7, mg: 0.35, rifle: 0.25, rocket: 3, grenade: 3.5 };

export class FX {
  constructor(scene) {
    this.scene = scene;
    this.projectiles = new Map();
    this.particles = [];
    this.flashes = [];
    this.tracerGeo = new THREE.BoxGeometry(1, 1, 1);
    this.tracerMats = {};
    for (const [k, v] of Object.entries(TRACER)) {
      this.tracerMats[k] = new THREE.MeshBasicMaterial({ color: v.color });
    }
    this.puffGeo = new THREE.IcosahedronGeometry(1, 0);
    this.chunkGeo = new THREE.TetrahedronGeometry(0.4, 0);
    this.mats = {
      // No depth writes: overlapping puffs must not punch holes in each other as they sort.
      fire: new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, depthWrite: false }),
      smoke: new THREE.MeshStandardMaterial({ color: 0x4a443c, flatShading: true, transparent: true, depthWrite: false }),
      dust: new THREE.MeshStandardMaterial({ color: 0x8a7458, flatShading: true, transparent: true, depthWrite: false }),
      water: new THREE.MeshStandardMaterial({ color: 0xcfe0e0, flatShading: true, transparent: true, depthWrite: false }),
      spark: new THREE.MeshBasicMaterial({ color: 0xffe080 }),
      dirt: new THREE.MeshStandardMaterial({ color: 0x4a3a2a, flatShading: true }),
    };
    this.light = new THREE.PointLight(0xffb060, 0, 40, 1.5);
    scene.add(this.light);
    this.lightT = 0;
  }

  spawnProjectile(ev) {
    const style = TRACER[ev.kind] ?? TRACER.ap;
    const mesh = new THREE.Mesh(this.tracerGeo, this.tracerMats[ev.kind] ?? this.tracerMats.ap);
    mesh.scale.set(style.width, style.width, style.len);
    this.scene.add(mesh);
    this.projectiles.set(ev.id, { mesh, kind: ev.kind, x: ev.x, y: ev.y, z: ev.z, vx: ev.vx, vy: ev.vy, vz: ev.vz, life: 4 });
  }

  removeProjectile(id) {
    const p = this.projectiles.get(id);
    if (!p) return;
    this.scene.remove(p.mesh);
    this.projectiles.delete(id);
  }

  muzzleFlash(pos, dir, kind) {
    if (kind === 'rifle') return; // too small to matter; saves particles with 40 riflemen
    const big = kind === 'heavy' ? 2.2 : kind === 'ap' || kind === 'he' ? 1.5 : kind === 'ac' || kind === 'rocket' ? 0.7 : 0.3;
    for (let i = 0; i < 3; i++) {
      this.particle({
        geo: this.puffGeo,
        mat: this.mats.fire,
        pos: pos.clone().addScaledVector(dir, i * big * 0.6),
        vel: dir.clone().multiplyScalar(4 + i * 3),
        size: big * (0.6 - i * 0.12),
        grow: 2,
        life: 0.08 + i * 0.02,
      });
    }
    if (big > 1) {
      const n = Math.round(6 * quality().particles);
      for (let i = 0; i < n; i++) {
        this.particle({
          geo: this.puffGeo,
          mat: this.mats.smoke,
          pos: pos.clone(),
          vel: dir.clone().multiplyScalar(3 + Math.random() * 5).add(rand3(2)),
          size: big * 0.6,
          grow: 1.5,
          life: 1.2 + Math.random(),
          fade: 0.6,
        });
      }
      this.flashLight(pos, big * 3);
    }
  }

  impact(ev) {
    const pos = new THREE.Vector3(ev.x, ev.y, ev.z);
    const size = IMPACT_SIZE[ev.kind] ?? 1;
    const pq = quality().particles;
    if (ev.r === 'ric') {
      for (let i = 0; i < 10; i++) this.particle({ geo: this.chunkGeo, mat: this.mats.spark, pos: pos.clone(), vel: rand3(14), size: 0.25, life: 0.4, gravity: 1 });
      return;
    }
    if (ev.r === 'water') {
      for (let i = 0; i < Math.round(12 * pq); i++) {
        this.particle({ geo: this.puffGeo, mat: this.mats.water, pos: pos.clone(), vel: new THREE.Vector3((Math.random() - 0.5) * 3, 6 + Math.random() * 8 * Math.sqrt(size), (Math.random() - 0.5) * 3), size: 0.4 * Math.sqrt(size), life: 1, gravity: 1, fade: 0.8 });
      }
      return;
    }
    if (ev.r === 'armor') {
      for (let i = 0; i < 8; i++) this.particle({ geo: this.chunkGeo, mat: this.mats.spark, pos: pos.clone(), vel: rand3(8), size: 0.2, life: 0.3, gravity: 1 });
    }
    if (ev.kind === 'mg' || ev.kind === 'rifle') {
      this.particle({ geo: this.puffGeo, mat: this.mats.dust, pos, vel: new THREE.Vector3(0, 1.5, 0), size: 0.25, grow: 2, life: 0.5, fade: 0.6 });
      return;
    }
    // Fireball
    this.particle({ geo: this.puffGeo, mat: this.mats.fire, pos: pos.clone(), vel: new THREE.Vector3(), size: size * 0.4, grow: 3, life: 0.18 });
    this.flashLight(pos, size * 4);
    // Dirt spray / smoke
    const dust = ev.r === 'armor' ? this.mats.smoke : this.mats.dust;
    for (let i = 0; i < Math.round(8 * pq * Math.sqrt(size)); i++) {
      this.particle({
        geo: this.puffGeo,
        mat: dust,
        pos: pos.clone().add(rand3(size * 0.3)),
        vel: new THREE.Vector3((Math.random() - 0.5) * 4, 2 + Math.random() * 6, (Math.random() - 0.5) * 4).multiplyScalar(Math.sqrt(size) * 0.7),
        size: size * 0.35,
        grow: 1.6,
        life: 1.5 + Math.random() * 1.5,
        fade: 0.55,
        drag: 2,
      });
    }
    if (ev.r === 'ground') {
      for (let i = 0; i < Math.round(10 * pq); i++) {
        this.particle({ geo: this.chunkGeo, mat: this.mats.dirt, pos: pos.clone(), vel: new THREE.Vector3((Math.random() - 0.5) * 10, 6 + Math.random() * 10, (Math.random() - 0.5) * 10).multiplyScalar(Math.sqrt(size) * 0.5), size: 0.3 + Math.random() * 0.3 * size, life: 2, gravity: 1, spin: true, ground: true });
      }
    }
  }

  explosion(pos, size = 6) {
    this.impact({ x: pos.x, y: pos.y, z: pos.z, kind: 'heavy', r: 'armor' });
    for (let i = 0; i < Math.round(14 * quality().particles); i++) {
      this.particle({ geo: this.puffGeo, mat: this.mats.smoke, pos: pos.clone().add(rand3(2)), vel: new THREE.Vector3((Math.random() - 0.5) * 3, 3 + Math.random() * 5, (Math.random() - 0.5) * 3), size: size * 0.4, grow: 2, life: 3 + Math.random() * 2, fade: 0.7, drag: 1 });
    }
  }

  // Rising smoke (burning wrecks, damaged tanks) with an occasional flame lick.
  smokePuff(x, y, z, big = false) {
    const s = big ? 2.2 : 1.3;
    this.particle({ geo: this.puffGeo, mat: this.mats.smoke, pos: new THREE.Vector3(x + (Math.random() - 0.5) * s, y, z + (Math.random() - 0.5) * s), vel: new THREE.Vector3(0.8 + Math.random() * 0.6, 2.5 + Math.random() * 2, 0.3), size: s * 0.7, grow: 3.5, life: 5 + Math.random() * 3, fade: 0.55, drag: 0.15 });
    if (Math.random() < 0.5) this.particle({ geo: this.puffGeo, mat: this.mats.fire, pos: new THREE.Vector3(x + (Math.random() - 0.5) * s, y - 0.4, z), vel: new THREE.Vector3(0, 2.5, 0), size: s * 0.35, grow: -0.5, life: 0.5 });
  }

  dustPuff(x, y, z, size) {
    this.particle({ geo: this.puffGeo, mat: this.mats.dust, pos: new THREE.Vector3(x, y, z), vel: new THREE.Vector3((Math.random() - 0.5) * 1.5, 0.8 + Math.random(), (Math.random() - 0.5) * 1.5), size, grow: 2.5, life: 2 + Math.random(), fade: 0.4, drag: 0.8 });
  }

  flashLight(pos, intensity) {
    this.light.position.copy(pos);
    this.light.intensity = intensity * 20;
    this.lightT = 0.08;
  }

  particle({ geo, mat, pos, vel, size, grow = 0, life, gravity = 0, fade = 1, drag = 0, spin = false, ground = false }) {
    // Hard cap so huge firefights can't tank the frame rate.
    if (this.particles.length > 700 * quality().particles) return;
    const m = new THREE.Mesh(geo, fade < 1 ? mat.clone() : mat);
    m.position.copy(pos);
    m.scale.setScalar(size);
    m.rotation.set(Math.random() * 3, Math.random() * 3, 0);
    this.scene.add(m);
    this.particles.push({ m, vel, size, grow, life, t: 0, gravity, fade, drag, spin, ground, cloned: fade < 1 });
  }

  update(dt) {
    for (const [id, p] of this.projectiles) {
      if (p.kind === 'rocket') {
        // Smoke trail
        p.trail = (p.trail ?? 0) - dt;
        if (p.trail <= 0) {
          p.trail = 0.03;
          this.particle({ geo: this.puffGeo, mat: this.mats.smoke, pos: new THREE.Vector3(p.x, p.y, p.z), vel: new THREE.Vector3(0, 0.3, 0), size: 0.25, grow: 3, life: 1.2, fade: 0.5 });
        }
      } else p.vy -= GRAVITY * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.life -= dt;
      p.mesh.position.set(p.x, p.y, p.z);
      p.mesh.lookAt(p.x + p.vx, p.y + p.vy, p.z + p.vz);
      // Hide once it should have landed even if the server's impact event is late.
      if (p.life <= 0 || p.y < Math.max(groundAt(p.x, p.z), WATER_LEVEL) - 1) this.removeProjectile(id);
    }

    const keep = [];
    for (const p of this.particles) {
      p.t += dt;
      const k = p.t / p.life;
      if (k >= 1) {
        this.scene.remove(p.m);
        if (p.cloned) p.m.material.dispose();
        continue;
      }
      if (p.gravity) p.vel.y -= GRAVITY * p.gravity * dt;
      if (p.drag) p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      p.m.position.addScaledVector(p.vel, dt);
      if (p.ground) {
        const g = groundAt(p.m.position.x, p.m.position.z);
        if (p.m.position.y < g) {
          p.m.position.y = g;
          p.vel.set(0, 0, 0);
        }
      }
      if (p.spin) p.m.rotation.x += dt * 8;
      p.m.scale.setScalar(p.size * (1 + p.grow * k));
      if (p.cloned) {
        p.m.material.opacity = p.fade * (1 - k);
      } else if (p.m.material.transparent) {
        p.m.material.opacity = 1;
      }
      keep.push(p);
    }
    this.particles = keep;

    if (this.lightT > 0) {
      this.lightT -= dt;
      if (this.lightT <= 0) this.light.intensity = 0;
    }
  }

  dispose() {
    for (const p of this.particles) this.scene.remove(p.m);
    for (const id of [...this.projectiles.keys()]) this.removeProjectile(id);
  }
}

function rand3(s) {
  return new THREE.Vector3((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
}
