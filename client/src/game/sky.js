import * as THREE from 'three';
import { mergeParts } from './scatter.js';
import { heightAt, HALF } from '../../../shared/map.js';
import { createNoise2D, mulberry32 } from '../../../shared/noise.js';
import { quality } from '../settings.js';

// Everything beyond and above the battlefield: a terrain skirt past the map edge,
// distant mountain ranges, drifting low-poly clouds, bird flocks and wind-blown debris.

const HAZE = new THREE.Color(0xc9ab8e);
const WIND = new THREE.Vector2(1, 0.35).normalize();

function buildSkirt() {
  // Rolling hills from the map edge outwards; hidden under the terrain inside the map.
  const n = createNoise2D(6060);
  const geo = new THREE.RingGeometry(640, 3400, 160, 30).toNonIndexed();
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const out = Math.max(0, Math.max(Math.abs(x), Math.abs(z)) - HALF);
    let y = heightAt(x, z);
    if (out <= 0) y -= 6;
    else y += out * 0.12 + (n(x / 260, z / 260) * 0.5 + 0.5) * Math.min(1, out / 200) * 110;
    pos.setY(i, y);
  }
  for (let i = 0; i < pos.count; i += 3) {
    const x = pos.getX(i), z = pos.getZ(i);
    const d = Math.hypot(x, z);
    const k = Math.min(1, Math.max(0, (d - 800) / 2000));
    c.setHSL(0.16 + n(x / 90, z / 90) * 0.03, 0.3, 0.3).lerp(HAZE, k * 0.6);
    for (let j = 0; j < 3; j++) c.toArray(col, (i + j) * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }));
  m.receiveShadow = false;
  return m;
}

function buildMountains() {
  // Three ridge rings, each fading further into the haze. In the fog like everything else:
  // an unfogged backdrop would show far tanks as fog-coloured silhouettes in front of it.
  const n = createNoise2D(9191);
  const group = new THREE.Group();
  const rings = [
    { r: 1500, h: 170, base: 0x5f6448, haze: 0.45 },
    { r: 2200, h: 300, base: 0x6b6f5c, haze: 0.62 },
    { r: 3000, h: 460, base: 0x7d8078, haze: 0.78 },
  ];
  for (const [ri, ring] of rings.entries()) {
    const SEG = 120;
    const pos = [];
    const col = [];
    const c = new THREE.Color();
    const peak = (a) => {
      const x = Math.cos(a) * 3, z = Math.sin(a) * 3;
      const v = n(x + ri * 10, z) * 0.6 + n(x * 3 + ri, z * 3) * 0.3 + n(x * 9, z * 9 + ri) * 0.1;
      return ring.h * (0.45 + Math.max(0, v) * 1.2);
    };
    for (let i = 0; i < SEG; i++) {
      const a0 = (i / SEG) * Math.PI * 2, a1 = ((i + 1) / SEG) * Math.PI * 2;
      const am = (a0 + a1) / 2;
      const r = ring.r * (1 + n(am * 2, ri) * 0.08);
      const p0 = [Math.cos(a0) * r, -40, Math.sin(a0) * r];
      const p1 = [Math.cos(a1) * r, -40, Math.sin(a1) * r];
      const top0 = [Math.cos(a0) * r, peak(a0), Math.sin(a0) * r];
      const top1 = [Math.cos(a1) * r, peak(a1), Math.sin(a1) * r];
      const mid = [Math.cos(am) * (r - 60), peak(am) * 1.15, Math.sin(am) * (r - 60)];
      // Facets towards the battlefield.
      for (const tri of [[p0, top0, mid], [p0, mid, p1], [p1, mid, top1]]) {
        for (const p of tri) pos.push(...p);
        const shadeK = 0.85 + ((i * 7) % 5) * 0.05;
        c.set(ring.base).multiplyScalar(shadeK).lerp(HAZE, ring.haze);
        // Snow caps on the highest far peaks.
        if (ri === 2 && Math.max(tri[0][1], tri[1][1], tri[2][1]) > ring.h * 1.25) c.lerp(new THREE.Color(0xe8e4dc), 0.35);
        for (let k = 0; k < 3; k++) col.push(c.r, c.g, c.b);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    mesh.renderOrder = -1;
    group.add(mesh);
  }
  return group;
}

function cloudGeo(rand) {
  const parts = [];
  const puffs = 4 + Math.floor(rand() * 4);
  for (let i = 0; i < puffs; i++) {
    const s = 18 + rand() * 26;
    parts.push({ geo: new THREE.IcosahedronGeometry(1, 0), color: i % 2 ? 0xf4eee4 : 0xe6dccd, x: (i - puffs / 2) * 22 + rand() * 10, y: rand() * 10, z: (rand() - 0.5) * 30, sx: s * 1.3, sy: s * 0.55, sz: s });
  }
  return mergeParts(parts);
}

export class SkyLife {
  constructor(scene) {
    this.scene = scene;
    const q = quality();
    this.skirt = buildSkirt();
    scene.add(this.skirt);
    this.mountains = buildMountains();
    scene.add(this.mountains);

    // Clouds: a few shapes, many instances, drifting with the wind.
    const rand = mulberry32(2024);
    // Mostly self-lit so the undersides stay creamy instead of turning rock-brown.
    const cloudMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, fog: false, emissive: 0xd9c4a8, emissiveIntensity: 0.62, transparent: true, opacity: 0.93 });
    this.clouds = [];
    this.cloudMeshes = [0, 1, 2].map(() => {
      const im = new THREE.InstancedMesh(cloudGeo(rand), cloudMat, 18);
      im.frustumCulled = false;
      scene.add(im);
      return im;
    });
    for (let i = 0; i < 54; i++) {
      this.clouds.push({ mesh: i % 3, slot: Math.floor(i / 3), x: (rand() - 0.5) * 6000, z: (rand() - 0.5) * 6000, y: 420 + rand() * 260, s: 1 + rand() * 1.1, rot: rand() * 6 });
    }

    // Birds: flocks circling over woods, scattering when something explodes nearby.
    const birdGeo = new THREE.BufferGeometry();
    birdGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.3, -0.9, 0.25, -0.2, 0, 0.05, -0.1, 0, 0, 0.3, 0, 0.05, -0.1, 0.9, 0.25, -0.2], 3));
    birdGeo.computeVertexNormals();
    this.flocks = [];
    const anchors = [[-300, -300], [250, -420], [-520, 120], [420, 380], [-150, 520], [80, -120], [560, -60]];
    const per = 9;
    this.birds = new THREE.InstancedMesh(birdGeo, new THREE.MeshBasicMaterial({ color: 0x1c1a18, side: THREE.DoubleSide }), anchors.length * per);
    this.birds.frustumCulled = false;
    scene.add(this.birds);
    anchors.forEach(([x, z], fi) => {
      const birds = [];
      for (let b = 0; b < per; b++) birds.push({ r: 12 + rand() * 22, a: rand() * Math.PI * 2, h: 22 + rand() * 18, speed: 0.35 + rand() * 0.3, phase: rand() * 6, pos: new THREE.Vector3(), vel: new THREE.Vector3() });
      this.flocks.push({ ax: x, az: z, cx: x, cz: z, state: 'circle', t: 0, birds, base: fi * per });
    });

    // Wind-blown leaves and dust around the viewer.
    const dustCount = Math.round(90 * q.particles);
    const leafGeo = new THREE.PlaneGeometry(0.1, 0.07);
    this.dust = new THREE.InstancedMesh(leafGeo, new THREE.MeshLambertMaterial({ color: 0x8a7246, side: THREE.DoubleSide }), Math.max(1, dustCount));
    this.dust.frustumCulled = false;
    const leafColors = [0x8a7246, 0x6b5a32, 0x9c8a5a, 0x5a6a30];
    this.motes = [];
    for (let i = 0; i < dustCount; i++) {
      this.motes.push({ p: new THREE.Vector3((rand() - 0.5) * 60, -100, (rand() - 0.5) * 60), spin: rand() * 6, rate: 1 + rand() * 3, rel: true });
      this.dust.setColorAt(i, new THREE.Color(leafColors[i % 4]));
    }
    scene.add(this.dust);
    this.t = 0;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
  }

  // Something big went off: nearby flocks take flight.
  scare(pos, radius = 220) {
    for (const f of this.flocks) {
      if (f.state === 'circle' && Math.hypot(f.cx - pos.x, f.cz - pos.z) < radius) {
        f.state = 'flee';
        f.t = 0;
        const away = new THREE.Vector3(f.cx - pos.x, 0, f.cz - pos.z).normalize();
        for (const b of f.birds) b.vel.set(away.x * (14 + Math.random() * 6) + (Math.random() - 0.5) * 6, 6 + Math.random() * 5, away.z * (14 + Math.random() * 6) + (Math.random() - 0.5) * 6);
      }
    }
  }

  update(dt, cam) {
    this.t += dt;
    const m = this._m;
    // Clouds and mountains/skirt are centred on the world, clouds wrap around the camera.
    for (const c of this.clouds) {
      c.x += WIND.x * dt * 4;
      c.z += WIND.y * dt * 4;
      if (c.x - cam.x > 3000) c.x -= 6000;
      if (c.x - cam.x < -3000) c.x += 6000;
      if (c.z - cam.z > 3000) c.z -= 6000;
      if (c.z - cam.z < -3000) c.z += 6000;
      this._q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, c.rot);
      m.compose(new THREE.Vector3(c.x, c.y, c.z), this._q, new THREE.Vector3(c.s, c.s, c.s));
      this.cloudMeshes[c.mesh].setMatrixAt(c.slot, m);
    }
    for (const im of this.cloudMeshes) im.instanceMatrix.needsUpdate = true;

    // Birds
    for (const f of this.flocks) {
      f.t += dt;
      if (f.state === 'flee' && f.t > 14) {
        // Settle again later somewhere close to home.
        f.state = 'circle';
        f.cx = f.ax + (Math.random() - 0.5) * 200;
        f.cz = f.az + (Math.random() - 0.5) * 200;
      }
      const ground = heightAt(f.cx, f.cz);
      f.birds.forEach((b, i) => {
        const flap = Math.sin(this.t * (f.state === 'flee' ? 18 : 9) + b.phase);
        if (f.state === 'circle') {
          b.a += dt * b.speed;
          b.pos.set(f.cx + Math.cos(b.a) * b.r, ground + b.h + Math.sin(this.t * 0.7 + b.phase) * 3, f.cz + Math.sin(b.a) * b.r);
          this._e.set(0, -b.a, 0.25);
        } else {
          b.pos.addScaledVector(b.vel, dt);
          b.vel.y = Math.max(1, b.vel.y - dt * 0.6);
          this._e.set(-0.2, Math.atan2(b.vel.x, b.vel.z), 0);
        }
        this._q.setFromEuler(this._e);
        m.compose(b.pos, this._q, new THREE.Vector3(1.4, 1 + flap * 0.8, 1.4));
        this.birds.setMatrixAt(f.base + i, m);
      });
    }
    this.birds.instanceMatrix.needsUpdate = true;

    // Leaves & dust drift past the camera; recycle the ones that leave the box.
    const gust = 0.6 + 0.4 * Math.sin(this.t * 0.37) * Math.sin(this.t * 0.13);
    this.motes.forEach((d, i) => {
      if (d.rel) {
        d.p.x += cam.x;
        d.p.z += cam.z;
        d.p.y = heightAt(d.p.x, d.p.z) + Math.random() * 2.5;
        d.rel = false;
      }
      d.p.x += (WIND.x * 3.5 * gust + Math.sin(this.t * d.rate + i) * 0.6) * dt;
      d.p.z += (WIND.y * 3.5 * gust + Math.cos(this.t * d.rate * 0.7 + i) * 0.6) * dt;
      d.p.y += Math.sin(this.t * d.rate + i * 3) * 0.4 * dt - 0.12 * dt;
      // Leaves skitter close to the ground; they never float up into the sky view.
      const g = heightAt(d.p.x, d.p.z);
      d.p.y = Math.min(g + 3, Math.max(g + 0.05, d.p.y));
      if (Math.abs(d.p.x - cam.x) > 32 || Math.abs(d.p.z - cam.z) > 32) {
        d.p.set(cam.x - WIND.x * 30 + (Math.random() - 0.5) * 50, 0, cam.z - WIND.y * 30 + (Math.random() - 0.5) * 50);
        d.p.y = heightAt(d.p.x, d.p.z) + Math.random() * 2.5;
      }
      d.spin += dt * d.rate * 2;
      this._e.set(d.spin, d.spin * 0.7, d.spin * 0.3);
      this._q.setFromEuler(this._e);
      m.compose(d.p, this._q, new THREE.Vector3(1, 1, 1));
      this.dust.setMatrixAt(i, m);
    });
    this.dust.instanceMatrix.needsUpdate = true;
  }
}
