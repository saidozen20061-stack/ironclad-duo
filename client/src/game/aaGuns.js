import * as THREE from 'three';
import { PROPS } from '../../../shared/props.js';

// The gun on top of each anti-air turret. The turret itself is an ordinary prop, but this part has to
// turn: it follows the shots the host fires, and slowly sweeps the sky while there's nothing to shoot.
const TOP = 3.1; // m above the ground: where the gun's pivot sits
const FOLLOW = 7; // how quickly it swings to a new aim
const SWEEP = 0.25; // rad/s when idle
const IDLE_AFTER = 2; // s since the last shot

const steel = new THREE.MeshStandardMaterial({ color: 0x4c5048, flatShading: true, roughness: 0.6, metalness: 0.35 });
const black = new THREE.MeshStandardMaterial({ color: 0x1d1e1b, flatShading: true, roughness: 0.55, metalness: 0.4 });

function buildGun() {
  const yaw = new THREE.Group();
  const seat = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.9, 2), steel);
  seat.position.y = 0.3;
  yaw.add(seat);
  const pitch = new THREE.Group();
  pitch.position.y = 0.95;
  const breech = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.7, 1.6), steel);
  pitch.add(breech);
  // Four long barrels, two over two.
  for (const x of [-0.42, 0.42]) {
    for (const y of [-0.2, 0.2]) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.1, 3.6, 8).rotateX(Math.PI / 2), black);
      b.position.set(x, y, 2.4);
      pitch.add(b);
      const brake = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.4, 8).rotateX(Math.PI / 2), black);
      brake.position.set(x, y, 4.2);
      pitch.add(brake);
    }
  }
  yaw.add(pitch);
  for (const m of [seat, breech]) m.castShadow = true;
  return { yaw, pitch };
}

export class AaGuns {
  constructor(scene) {
    this.scene = scene;
    this.guns = PROPS.filter((p) => p.type === 'aaturret').map((p, i) => {
      const g = buildGun();
      g.yaw.position.set(p.x, p.y + TOP, p.z);
      scene.add(g.yaw);
      return { ...g, wantY: i * 1.7, wantP: 0.5, y: i * 1.7, p: 0.5, quiet: IDLE_AFTER };
    });
  }

  onShot(ev) {
    const g = this.guns[ev.tur];
    if (!g) return;
    g.wantY = Math.atan2(ev.vx, ev.vz);
    g.wantP = Math.atan2(ev.vy, Math.hypot(ev.vx, ev.vz));
    g.quiet = 0;
  }

  update(dt) {
    const k = Math.min(1, dt * FOLLOW);
    for (const g of this.guns) {
      g.quiet += dt;
      if (g.quiet > IDLE_AFTER) {
        g.wantY += SWEEP * dt;
        g.wantP += (0.5 - g.wantP) * Math.min(1, dt);
      }
      // The short way round.
      const d = Math.atan2(Math.sin(g.wantY - g.y), Math.cos(g.wantY - g.y));
      g.y += d * k;
      g.p += (g.wantP - g.p) * k;
      g.yaw.rotation.y = g.y;
      g.pitch.rotation.x = -g.p;
    }
  }

  dispose() {
    for (const g of this.guns) this.scene.remove(g.yaw);
  }
}
