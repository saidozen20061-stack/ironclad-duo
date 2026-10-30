import * as THREE from 'three';
import { TANKS } from '../../../shared/constants.js';
import { groundAt, waterDepthAt } from '../../../shared/map.js';
import { quality } from '../settings.js';

// Track marks left in the mud and dust kicked up behind moving tanks.
const MAX_MARKS = 1400;

export class TrackMarks {
  constructor(scene, fx) {
    this.fx = fx;
    const geo = new THREE.PlaneGeometry(0.55, 1.3);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0x2a2219, roughness: 1, transparent: true, opacity: 0.55, polygonOffset: true, polygonOffsetFactor: -3, depthWrite: false }), MAX_MARKS);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.next = 0;
    this.last = new Map(); // unit id -> {x, z}
    this.dustT = new Map();
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.up = new THREE.Vector3(0, 1, 0);
  }

  update(dt, states, camPos) {
    for (const u of states.values()) {
      if (u.dead || !TANKS[u.type]) continue; // only tanks leave tracks
      const prev = this.last.get(u.id);
      if (!prev) {
        this.last.set(u.id, { x: u.x, z: u.z });
        continue;
      }
      const moved = Math.hypot(u.x - prev.x, u.z - prev.z);
      if (moved > 20) {
        this.last.set(u.id, { x: u.x, z: u.z });
        continue;
      }
      const far = Math.hypot(u.x - camPos.x, u.z - camPos.z) > 400;
      if (moved >= 1.2) {
        if (!far) this.stamp(u);
        prev.x = u.x;
        prev.z = u.z;
      }
      // Dust behind moving tanks, scaled by speed.
      const speed = moved / Math.max(dt, 1e-3);
      if (!far && moved > 0.01) {
        const t = (this.dustT.get(u.id) ?? 0) - dt;
        if (t <= 0 && waterDepthAt(u.x, u.z) === 0) {
          const spec = TANKS[u.type];
          const bx = u.x - Math.sin(u.h) * spec.size.length * 0.55;
          const bz = u.z - Math.cos(u.h) * spec.size.length * 0.55;
          this.fx.dustPuff(bx, groundAt(bx, bz) + 0.6, bz, 0.8 + spec.size.width * 0.25);
          this.dustT.set(u.id, 0.35 / quality().particles / Math.max(0.3, Math.min(1, speed / 8)));
        } else this.dustT.set(u.id, t);
      }
    }
  }

  stamp(u) {
    const spec = TANKS[u.type];
    const half = spec.size.width / 2 - 0.35;
    this.q.setFromAxisAngle(this.up, u.h);
    for (const side of [-1, 1]) {
      const x = u.x + Math.cos(u.h) * half * side;
      const z = u.z - Math.sin(u.h) * half * side;
      if (waterDepthAt(x, z) > 0) continue;
      this.m.compose(new THREE.Vector3(x, groundAt(x, z) + 0.05, z), this.q, new THREE.Vector3(1, 1, 1));
      this.mesh.setMatrixAt(this.next, this.m);
      this.next = (this.next + 1) % MAX_MARKS;
      this.mesh.count = Math.max(this.mesh.count, this.next === 0 ? MAX_MARKS : this.next);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
