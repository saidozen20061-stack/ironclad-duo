import * as THREE from 'three';
import { quality } from '../settings.js';
import { noHeat } from './thermal.js';

// Background war beyond the playable area: artillery flashes on the horizon, tracer
// streams arcing across the sky and planes flying over.
// Purely client-side decoration; audio hooks (onSound) are used by Phase 7.

const rand = (a, b) => a + Math.random() * (b - a);

export class AmbientWar {
  constructor(scene) {
    this.scene = scene;
    this.t = 0;
    this.nextArty = 2;
    this.nextTracer = 1;
    this.nextPlane = 12;
    this.items = [];
    this.flashMat = new THREE.MeshBasicMaterial({ color: 0xffc070, fog: false, transparent: true });
    this.smokeMat = new THREE.MeshLambertMaterial({ color: 0x5a524a, transparent: true, opacity: 0.6, flatShading: true });
    this.tracerMat = new THREE.MeshBasicMaterial({ color: 0xff9a50, fog: false });
    this.puff = new THREE.IcosahedronGeometry(1, 0);
    this.box = new THREE.BoxGeometry(1, 1, 1);
    this.planeGeo = buildPlane();
    this.onSound = null; // (kind, position) => void
  }

  // Random point on a ring well outside the map edge.
  horizon(r0 = 950, r1 = 1500) {
    const a = Math.random() * Math.PI * 2;
    const r = rand(r0, r1);
    return new THREE.Vector3(Math.cos(a) * r, rand(5, 40), Math.sin(a) * r);
  }

  update(dt, camPos) {
    this.t += dt;
    const q = quality().particles;

    if ((this.nextArty -= dt) <= 0) {
      this.nextArty = rand(0.6, 3) / q;
      const p = this.horizon();
      const flash = new THREE.Mesh(this.puff, this.flashMat.clone());
      flash.position.copy(p);
      flash.scale.setScalar(rand(8, 18));
      this.add(flash, 0.25, (m, k) => {
        m.material.opacity = 1 - k;
        m.scale.multiplyScalar(1 + 0.03);
      });
      for (let i = 0; i < 3; i++) {
        const s = new THREE.Mesh(this.puff, this.smokeMat.clone());
        s.position.copy(p).add(new THREE.Vector3(rand(-8, 8), rand(0, 10), rand(-8, 8)));
        s.scale.setScalar(rand(8, 14));
        this.add(s, rand(6, 10), (m, k, d) => {
          m.position.y += d * 4;
          m.scale.multiplyScalar(1 + d * 0.08);
          m.material.opacity = 0.55 * (1 - k);
        });
      }
      this.onSound?.('artillery', p);
    }

    if ((this.nextTracer -= dt) <= 0) {
      this.nextTracer = rand(1.5, 5) / q;
      const from = this.horizon(800, 1100);
      const a = Math.atan2(from.z, from.x) + rand(1.2, 2.2) * (Math.random() < 0.5 ? 1 : -1);
      const to = new THREE.Vector3(Math.cos(a) * 1100, rand(60, 200), Math.sin(a) * 1100);
      const n = Math.round(rand(6, 14));
      for (let i = 0; i < n; i++) {
        const tr = new THREE.Mesh(this.box, this.tracerMat);
        tr.scale.set(1.2, 1.2, 14);
        const start = from.clone();
        const dir = to.clone().sub(from);
        const dur = rand(3, 5);
        const delay = i * 0.12;
        tr.visible = false;
        this.add(tr, dur + delay, (m, k, d, age) => {
          const u = Math.max(0, age - delay) / dur;
          m.visible = age > delay;
          const pos = start.clone().addScaledVector(dir, u);
          pos.y += Math.sin(u * Math.PI) * 180;
          m.lookAt(pos);
          m.position.copy(pos);
        });
      }
    }

    if ((this.nextPlane -= dt) <= 0) {
      this.nextPlane = rand(50, 110);
      const a = Math.random() * Math.PI * 2;
      const start = new THREE.Vector3(Math.cos(a) * 1600, rand(120, 220), Math.sin(a) * 1600);
      const end = new THREE.Vector3(-Math.cos(a + rand(-0.4, 0.4)) * 1600, start.y, -Math.sin(a + rand(-0.4, 0.4)) * 1600);
      const count = Math.random() < 0.5 ? 3 : 1;
      for (let i = 0; i < count; i++) {
        const plane = new THREE.Mesh(this.planeGeo, new THREE.MeshStandardMaterial({ color: 0x4a5444, flatShading: true }));
        const off = new THREE.Vector3(i * 25, i * 4, -i * 30);
        plane.scale.setScalar(1.4);
        const dur = 26;
        this.add(plane, dur, (m, k) => {
          m.position.lerpVectors(start, end, k).add(off);
          m.lookAt(end.clone().add(off));
        });
      }
      this.onSound?.('plane', start);
    }

    const keep = [];
    for (const it of this.items) {
      it.age += dt;
      const k = it.age / it.life;
      if (k >= 1) {
        this.scene.remove(it.mesh);
        continue;
      }
      it.step(it.mesh, k, dt, it.age);
      keep.push(it);
    }
    this.items = keep;
  }

  add(mesh, life, step) {
    noHeat(mesh);
    this.scene.add(mesh);
    this.items.push({ mesh, life, step, age: 0 });
  }

  dispose() {
    for (const it of this.items) this.scene.remove(it.mesh);
  }
}

function buildPlane() {
  const parts = [
    new THREE.CylinderGeometry(0.9, 0.6, 10, 6).rotateX(Math.PI / 2),
    new THREE.BoxGeometry(13, 0.25, 2.2).translate(0, 0, 0.8),
    new THREE.BoxGeometry(4.5, 0.2, 1.3).translate(0, 0.3, -4.4),
    new THREE.BoxGeometry(0.2, 2, 1.4).translate(0, 1.1, -4.4),
  ];
  const g = new THREE.BufferGeometry();
  const merged = parts.map((p) => p.toNonIndexed());
  let n = 0;
  for (const p of merged) n += p.attributes.position.count;
  const pos = new Float32Array(n * 3);
  let o = 0;
  for (const p of merged) {
    pos.set(p.attributes.position.array, o);
    o += p.attributes.position.array.length;
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
