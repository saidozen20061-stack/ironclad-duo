import * as THREE from 'three';
import { groundAt, WATER_LEVEL } from '../../../shared/map.js';
import { quality } from '../settings.js';
import { markHeat, LAYER_FX } from './thermal.js';

// Projectiles (client-side ballistic replay of server fire events) and simple particle effects.
const GRAVITY = 9.81;

const TRACER = {
  ac: { color: 0xffb347, len: 4, width: 0.12 },
  ap: { color: 0xfff0c0, len: 7, width: 0.18 },
  he: { color: 0xffa040, len: 6, width: 0.2 },
  heavy: { color: 0xffd080, len: 9, width: 0.3 },
  mg: { color: 0xffa050, len: 3, width: 0.09 },
  rifle: { color: 0xffe070, len: 2.2, width: 0.04 },
  rocket: { color: 0xffc060, len: 1.4, width: 0.22 },
  grenade: { color: 0x2f3a26, len: 0.14, width: 0.1 },
  bomb: { color: 0x25261f, len: 1.5, width: 0.32 },
};

// In the thermal sight, smoke and dust are mostly see-through, but a thick cloud still hides a bit.
const HEAT_TRACER = { heat: 0.95 };
const HEAT_FIRE = { heat: 1 };
const HEAT_SMOKE = { heat: 0.3, alpha: 0.18 };
const HEAT_DUST = { heat: 0.2, alpha: 0.1 };
const HEAT_WATER = { heat: 0.08, alpha: 0.2 };
const HEAT_DIRT = { heat: 0.3 };

const AIR_TRACER = { len: 5, width: 0.16 };

const IMPACT_SIZE = { bomb: 7, ac: 1.2, ap: 2, he: 4.5, heavy: 7, mg: 0.35, rifle: 0.25, rocket: 3, grenade: 3.5 };

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
    this.batches = new Map();
    // Plane guns: bright enough to read through the haze, like tracers do at dusk.
    this.airTracerMat = new THREE.MeshBasicMaterial({ color: 0xffd070, fog: false, toneMapped: false });
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
    const style = ev.air ? AIR_TRACER : TRACER[ev.kind] ?? TRACER.ap;
    const mesh = new THREE.Mesh(this.tracerGeo, ev.air ? this.airTracerMat : this.tracerMats[ev.kind] ?? this.tracerMats.ap);
    markHeat(mesh, ev.kind === 'bomb' ? HEAT_DIRT : HEAT_TRACER);
    mesh.scale.set(style.width, style.width, style.len);
    this.scene.add(mesh);
    this.projectiles.set(ev.id, { mesh, kind: ev.kind, x: ev.x, y: ev.y, z: ev.z, vx: ev.vx, vy: ev.vy, vz: ev.vz, life: ev.kind === 'bomb' ? 14 : ev.air ? 2.2 : 4, style, streak: ev.kind === 'mg' || ev.kind === 'ac' });
  }

  removeProjectile(id) {
    const p = this.projectiles.get(id);
    if (!p) return;
    this.scene.remove(p.mesh);
    this.projectiles.delete(id);
  }

  muzzleFlash(pos, dir, kind) {
    if (kind === 'rifle' || kind === 'bomb') return; // too small to matter; saves particles with 40 riflemen
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

  // Everything of one geometry + material shares a draw call; opacity is per instance.
  batch(geo, mat) {
    const key = geo.uuid + mat.uuid;
    let b = this.batches.get(key);
    if (b) return b;
    const cap = Math.round(700 * quality().particles) + 8;
    const g = geo.clone();
    const op = new THREE.InstancedBufferAttribute(new Float32Array(cap).fill(1), 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iOp', op);
    const m = mat.clone();
    m.transparent = true;
    m.depthWrite = false;
    m.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float iOp;\nvarying float vOp;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvOp = iOp;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vOp;')
        .replace('#include <opaque_fragment>', 'diffuseColor.a *= vOp;\n#include <opaque_fragment>');
    };
    m.customProgramCacheKey = () => 'fx-puff';
    const mesh = new THREE.InstancedMesh(g, m, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    mesh.layers.set(LAYER_FX);
    markHeat(mesh, mat === this.mats.fire || mat === this.mats.spark ? HEAT_FIRE : mat === this.mats.smoke ? HEAT_SMOKE : mat === this.mats.dust ? HEAT_DUST : mat === this.mats.dirt ? HEAT_DIRT : HEAT_WATER);
    this.scene.add(mesh);
    b = { mesh, op, n: 0 };
    this.batches.set(key, b);
    return b;
  }

  particle({ geo, mat, pos, vel, size, grow = 0, life, gravity = 0, fade = 1, drag = 0, spin = false, ground = false }) {
    // Hard cap so huge firefights can't tank the frame rate.
    if (this.particles.length > 700 * quality().particles) return;
    this.particles.push({ b: this.batch(geo, mat), x: pos.x, y: pos.y, z: pos.z, rx: Math.random() * 3, ry: Math.random() * 3, vel, size, grow, life, t: 0, gravity, fade, drag, spin, ground });
  }

  update(dt, cam) {
    for (const [id, p] of this.projectiles) {
      // Fast bullets are drawn as a streak of what they cover in a frame, and don't get
      // thinner than a line with distance, so a burst always reads as a stream of tracers.
      if (p.streak && cam) {
        const w = p.style.width * Math.max(1, Math.hypot(p.x - cam.x, p.y - cam.y, p.z - cam.z) / 40);
        p.mesh.scale.set(w, w, Math.max(p.style.len, Math.hypot(p.vx, p.vy, p.vz) * dt * 1.2));
      }
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

    for (const b of this.batches.values()) b.n = 0;
    const keep = [];
    for (const p of this.particles) {
      p.t += dt;
      const k = p.t / p.life;
      if (k >= 1) continue;
      if (p.gravity) p.vel.y -= GRAVITY * p.gravity * dt;
      if (p.drag) p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
      p.x += p.vel.x * dt;
      p.y += p.vel.y * dt;
      p.z += p.vel.z * dt;
      if (p.ground) {
        const g = groundAt(p.x, p.z);
        if (p.y < g) {
          p.y = g;
          p.vel.set(0, 0, 0);
        }
      }
      if (p.spin) p.rx += dt * 8;
      const b = p.b;
      const s = p.size * (1 + p.grow * k);
      _m.compose(_p.set(p.x, p.y, p.z), _q.setFromEuler(_e.set(p.rx, p.ry, 0)), _s.set(s, s, s));
      b.mesh.setMatrixAt(b.n, _m);
      b.op.setX(b.n, p.fade < 1 ? p.fade * (1 - k) : 1);
      b.n++;
      keep.push(p);
    }
    this.particles = keep;
    for (const b of this.batches.values()) {
      b.mesh.count = b.n;
      b.mesh.instanceMatrix.needsUpdate = true;
      b.op.needsUpdate = true;
    }

    if (this.lightT > 0) {
      this.lightT -= dt;
      if (this.lightT <= 0) this.light.intensity = 0;
    }
  }

  dispose() {
    for (const b of this.batches.values()) this.scene.remove(b.mesh);
    for (const id of [...this.projectiles.keys()]) this.removeProjectile(id);
  }
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

function rand3(s) {
  return new THREE.Vector3((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
}
