import * as THREE from 'three';
import { buildTank } from '../models/tanks.js';
import { buildPlane } from '../models/planes.js';
import { SoldierRig } from '../models/rig.js';
import { quality } from '../settings.js';
import { TANKS } from '../../../shared/constants.js';

// The battle behind the main menu: Blue and Red armies meeting in the middle of a field at dusk, shot
// like a film. It's all for show, nothing here is the real game simulation. Blue comes from -X, Red from +X.

const FRONT = 175; // m from the middle that reinforcements arrive from
const LANES = [-26, -15, -5, 6, 16, 27];
const STOP_AT = 62; // m from the nearest enemy that a tank halts to fight
const TANK_TYPES = ['medium', 'heavy', 'light', 'destroyer', 'medium', 'superheavy'];
const SQUAD = 7;
// Where each army has dug in: between its own tanks' lanes (x is towards the enemy from the middle).
// Red's lanes sit 3 m over from Blue's, so its positions do too.
const GAPS = [-20.5, -10, 0.5, 11, 21.5];
const LINES = [52, 84, 118];
const FLANK = [37, 46];
const SHELL_SPEED = 300;
const WRECK_TIME = 16; // s a destroyed tank burns before the next one comes up the lane
const BODY_TIME = 7; // s a fallen soldier stays
const FADE = 0.45; // s of black between shots
const BARS = 0.085; // share of the screen height the film bars take, top and bottom
const SUN_FROM = new THREE.Vector3(-150, 42, -70);

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const TEAM_TRACER = { blue: new THREE.Color(0.45, 0.85, 1.7), red: new THREE.Color(1.9, 0.42, 0.18) };
const POLE = new THREE.MeshLambertMaterial({ color: 0x1c1c1a, flatShading: true });
const FLAGS = {
  blue: new THREE.MeshLambertMaterial({ color: 0x2c6fe0, side: THREE.DoubleSide, emissive: 0x0a2558 }),
  red: new THREE.MeshLambertMaterial({ color: 0xd8281e, side: THREE.DoubleSide, emissive: 0x4a0a06 }),
};

// A soft blob, or a cloudy one built out of many, for smoke and fire to be drawn with.
function softTexture(blobs) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  for (let i = 0; i < blobs; i++) {
    const r = blobs === 1 ? 64 : rand(18, 34);
    const a = Math.random() * 6.28, d = blobs === 1 ? 0 : rand(0, 34);
    const x = 64 + Math.cos(a) * d, y = 64 + Math.sin(a) * d;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(255,255,255,${blobs === 1 ? 1 : 0.5})`);
    grad.addColorStop(blobs === 1 ? 0.35 : 0.6, `rgba(255,255,255,${blobs === 1 ? 0.55 : 0.3})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Lets each instance of a material have its own opacity.
function fadesByInstance(mat) {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aAlpha; varying float vAlpha;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAlpha = aAlpha;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vAlpha;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vAlpha;');
  };
  return mat;
}

// Puffs of something: many instances of one shape, each growing, drifting and dying. Sprites
// turn to face the camera and fade away; solid bits just shrink.
class Puffs {
  constructor(parent, geo, mat, max, sprite = false) {
    this.sprite = sprite;
    if (sprite) {
      this.alpha = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
      geo.setAttribute('aAlpha', this.alpha);
    }
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.frustumCulled = false;
    this.mesh.count = max;
    this.items = Array.from({ length: max }, () => ({ life: 0, max: 1 }));
    this.next = 0;
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.e = new THREE.Euler();
    this.p = new THREE.Vector3();
    this.s = new THREE.Vector3();
    this.c = new THREE.Color();
    this.turn = new THREE.Quaternion();
    this.axis = new THREE.Vector3(0, 0, 1);
    this.mesh.setColorAt(0, this.c.set(0xffffff));
    parent.add(this.mesh);
  }

  spawn(o) {
    const it = this.items[this.next];
    this.next = (this.next + 1) % this.items.length;
    Object.assign(it, { vx: 0, vy: 0, vz: 0, drag: 0, grav: 0, s0: 1, s1: 1, spin: 0, ...o }, { max: o.life });
    it.rx = Math.random() * 6;
    it.ry = Math.random() * 6;
  }

  update(dt, camera) {
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      if (it.life <= 0) {
        if (it.max > 0) {
          it.max = 0;
          this.mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
        }
        continue;
      }
      it.life -= dt;
      const k = Math.max(0, 1 - it.drag * dt);
      it.vx *= k;
      it.vy = it.vy * k - it.grav * dt;
      it.vz *= k;
      it.x += it.vx * dt;
      it.y += it.vy * dt;
      it.z += it.vz * dt;
      if (it.grav && it.y < it.floor) {
        it.y = it.floor;
        it.vx = it.vy = it.vz = 0;
      }
      it.rx += it.spin * dt;
      const u = 1 - Math.max(0, it.life) / it.max;
      // Grows, and shrinks away rather than fading: this is one flat material.
      const size = (it.s0 + (it.s1 - it.s0) * Math.sqrt(u)) * (this.sprite ? 1 : Math.min(1, (1 - u) * 5));
      if (this.sprite) {
        this.q.copy(camera.quaternion).multiply(this.turn.setFromAxisAngle(this.axis, it.ry + it.rx * 0.05));
        this.alpha.setX(i, Math.min(1, u * 7) * (1 - u) ** 1.4);
      } else this.q.setFromEuler(this.e.set(it.rx, it.ry, 0));
      this.m.compose(this.p.set(it.x, it.y, it.z), this.q, this.s.setScalar(size));
      this.mesh.setMatrixAt(i, this.m);
      if (it.c0) this.mesh.setColorAt(i, this.c.copy(it.c0).lerp(it.c1 ?? it.c0, u));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    if (this.alpha) this.alpha.needsUpdate = true;
  }
}

const C = {
  white: new THREE.Color(1.5, 1, 0.45),
  yellow: new THREE.Color(1.5, 0.78, 0.2),
  orange: new THREE.Color(1.3, 0.42, 0.07),
  ember: new THREE.Color(0.5, 0.08, 0.02),
  soot: new THREE.Color(0.1, 0.08, 0.06),
  smoke: new THREE.Color(0.3, 0.25, 0.2),
  dust: new THREE.Color(0.5, 0.42, 0.34),
  dirt: new THREE.Color(0.26, 0.2, 0.15),
  debris: new THREE.Color(0.1, 0.09, 0.08),
};

export class WarScene {
  constructor(scene, camera, heightAt, sun) {
    this.heightAt = heightAt;
    this.sun = sun;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.time = 0;
    this.shake = 0;
    this.arty = 1;
    this.camera = camera;
    const q = quality();
    this.detail = q.particles;
    this.tmp = new THREE.Vector3();
    this.tmp2 = new THREE.Vector3();

    this.buildSky();
    this.buildParticles(q.particles);
    this.buildGrade();
    this.buildDressing();
    this.posts = [];
    this.buildFortifications();
    this.buildLights();

    this.tanks = [];
    for (const team of ['blue', 'red']) LANES.forEach((z, i) => this.tanks.push(this.addTank(team, z + (team === 'red' ? 3 : 0), i)));
    this.soldiers = [];
    for (const team of ['blue', 'red']) for (let i = 0; i < SQUAD; i++) this.soldiers.push(this.addSoldier(team));
    // And those holding the sandbags.
    for (const post of this.posts) this.soldiers.push(this.addSoldier(post.team, post));
    this.buildPlanes();
    this.shells = [];
    this.fires = [];
    // Already under way when the menu first appears.
    for (const u of [...this.tanks, ...this.soldiers]) if (!u.post) u.x = (u.team === 'blue' ? -1 : 1) * rand(70, 130);
    for (let i = 0; i < 10; i++) this.addFire(rand(-130, 130), pick([-42, -36, 36, 44]) + rand(-5, 5), rand(0.9, 1.8));

    this.shots = this.makeShots();
    this.shotIndex = 0;
    this.pos = new THREE.Vector3(-60, 16, 60);
    this.look = new THREE.Vector3();
    this.fov = 42;
    this.startShot();
  }

  // ---------- Sky, light and picture ----------
  buildSky() {
    const geo = new THREE.SphereGeometry(600, 24, 12);
    const pos = geo.attributes.position;
    const cols = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    const sunDir = SUN_FROM.clone().normalize();
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).normalize();
      const up = Math.max(0, v.y);
      const toSun = Math.max(0, v.dot(sunDir));
      c.setRGB(0.5, 0.36, 0.28).lerp(new THREE.Color(0.17, 0.23, 0.36), Math.min(1, up * 2.4));
      c.lerp(new THREE.Color(1.5, 0.78, 0.36), toSun ** 6);
      c.toArray(cols, i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    this.sky = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    this.sky.renderOrder = -1;
    this.group.add(this.sky);
    // The sun itself, low and huge through the smoke.
    const disc = new THREE.Mesh(new THREE.CircleGeometry(30, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.3, 0.55), fog: false, depthWrite: false }));
    disc.position.copy(sunDir).multiplyScalar(560);
    disc.lookAt(0, 0, 0);
    disc.renderOrder = -1;
    this.sky.add(disc);
    // Long bands of cloud lit from underneath.
    const cloudMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.46, 0.31, 0.27), fog: false });
    const cloudGeo = new THREE.IcosahedronGeometry(1, 0);
    const clouds = new THREE.InstancedMesh(cloudGeo, cloudMat, 46);
    const m = new THREE.Matrix4(), s = new THREE.Vector3(), p = new THREE.Vector3(), q = new THREE.Quaternion();
    for (let i = 0; i < 46; i++) {
      const a = Math.random() * Math.PI * 2, r = rand(240, 500);
      m.compose(p.set(Math.cos(a) * r, rand(95, 190), Math.sin(a) * r), q.identity(), s.set(rand(24, 62), rand(3, 7), rand(14, 34)));
      clouds.setMatrixAt(i, m);
    }
    this.sky.add(clouds);
  }

  buildParticles(k) {
    const n = (v) => Math.max(40, Math.round(v * k));
    const fireMat = fadesByInstance(new THREE.MeshBasicMaterial({ map: softTexture(1), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    const smokeMat = fadesByInstance(new THREE.MeshBasicMaterial({ map: softTexture(16), transparent: true, opacity: 0.9, depthWrite: false }));
    const chunkMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    this.fire = new Puffs(this.group, new THREE.PlaneGeometry(2, 2), fireMat, n(260), true);
    this.smoke = new Puffs(this.group, new THREE.PlaneGeometry(2, 2), smokeMat, n(620), true);
    this.chunks = new Puffs(this.group, new THREE.BoxGeometry(1, 0.5, 0.7), chunkMat, n(180));
    // Shells and bullets in flight: a bright streak, however far off.
    const beam = new THREE.BoxGeometry(1, 1, 1);
    this.tracerMesh = new THREE.InstancedMesh(beam, new THREE.MeshBasicMaterial({ color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false }), 70);
    this.tracerMesh.frustumCulled = false;
    this.tracerMesh.setColorAt(0, new THREE.Color());
    this.group.add(this.tracerMesh);
    this.tracerAt = 0;
  }

  // Film bars, a dark vignette and the fades between shots: drawn straight on top of the picture.
  buildGrade() {
    this.gradeU = { fade: { value: 1 }, bars: { value: BARS } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.gradeU,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      fog: false,
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `varying vec2 vUv; uniform float fade; uniform float bars;
        void main() {
          vec2 p = vUv - 0.5;
          float v = smoothstep(0.32, 0.86, length(p * vec2(1.05, 1.25))) * 0.72;
          float bar = step(0.5 - bars, abs(p.y));
          gl_FragColor = vec4(0.015, 0.012, 0.01, max(max(v, bar), fade));
        }`,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    quad.frustumCulled = false;
    quad.renderOrder = 999;
    this.group.add(quad);
  }

  buildLights() {
    this.flashes = [0, 1, 2].map(() => {
      const l = new THREE.PointLight(0xffa65c, 0, 90, 1.5);
      this.group.add(l);
      return l;
    });
    this.flashAt = 0;
  }

  flash(x, y, z, power) {
    const l = this.flashes[this.flashAt];
    this.flashAt = (this.flashAt + 1) % this.flashes.length;
    l.position.set(x, y + 3, z);
    l.intensity = power;
  }

  // ---------- What's left on the field already ----------
  buildDressing() {
    const h = this.heightAt;
    const burnt = new THREE.MeshLambertMaterial({ color: 0x16130f, flatShading: true });
    const mud = new THREE.MeshLambertMaterial({ color: 0x3a2f25, flatShading: true });
    // Shell holes.
    const rim = new THREE.CylinderGeometry(1, 1.25, 0.28, 9);
    const holes = new THREE.InstancedMesh(rim, mud, 36);
    const m = new THREE.Matrix4(), s = new THREE.Vector3(), p = new THREE.Vector3(), q = new THREE.Quaternion();
    for (let i = 0; i < 36; i++) {
      const x = rand(-190, 190), z = rand(-46, 46), r = rand(1.2, 2.8);
      m.compose(p.set(x, h(x, z) + 0.05, z), q.identity(), s.set(r, 1, r));
      holes.setMatrixAt(i, m);
    }
    holes.receiveShadow = true;
    this.group.add(holes);
    // Tank traps and barbed-wire posts along the lines.
    const trap = new THREE.BoxGeometry(0.3, 2.4, 0.3);
    const traps = new THREE.InstancedMesh(trap, burnt, 90);
    const e = new THREE.Euler();
    for (let i = 0; i < 30; i++) {
      const x = rand(-60, 60) + (i % 2 ? 100 : -100), z = rand(-44, 44);
      for (let k = 0; k < 3; k++) {
        e.set(0.9, (k * Math.PI * 2) / 3, 0);
        m.compose(p.set(x, h(x, z) + 0.75, z), q.setFromEuler(e), s.set(1, 1, 1));
        traps.setMatrixAt(i * 3 + k, m);
      }
    }
    traps.castShadow = true;
    this.group.add(traps);
    // Burnt-out hulks from earlier fighting.
    for (const [type, x, z, rot] of [['heavy', -82, 38, 0.6], ['medium', 92, -38, 2.4], ['light', 30, 40, 1.4], ['destroyer', -30, -42, -0.8]]) {
      const t = buildTank(type, x < 0 ? 'blue' : 'red');
      this.scorch(t.group, burnt);
      t.group.position.set(x, h(x, z) - 0.25, z);
      t.group.rotation.y = rot;
      if (t.turret) {
        t.turret.rotation.y = rand(-2, 2);
        t.turret.rotation.z = 0.12;
      }
      this.group.add(t.group);
    }
  }

  // Sandbag emplacements, trenches, wire, bunkers and what an army leaves lying around behind them.
  buildFortifications() {
    const h = this.heightAt;
    const m = (color) => new THREE.MeshLambertMaterial({ color, flatShading: true });
    const wood = m(0x4c3a26), darkWood = m(0x33271a), concrete = m(0x6d6a60), steel = m(0x23252a), canvas = m(0x5a5a3a), crateWood = m(0x6a5230), rust = m(0x4e3324), dirt = m(0x2c2219), rope = m(0x17161a);
    const group = this.group;
    const block = (w, ht, d, mat, x, y, z, ry = 0, rz = 0) => {
      const o = new THREE.Mesh(new THREE.BoxGeometry(w, ht, d), mat);
      o.position.set(x, y + ht / 2, z);
      o.rotation.set(0, ry, rz);
      o.castShadow = o.receiveShadow = true;
      group.add(o);
      return o;
    };
    // Every sandbag on the field is one mesh.
    const bags = [];
    const bag = (x, y, z, ry) => bags.push([x, y, z, ry + rand(-0.14, 0.14), rand(0.92, 1.08)]);
    // A wall of bags, running along direction ry, staggered like brickwork.
    const wall = (x, z, ry, count, rows = 3) => {
      const dx = Math.cos(ry), dz = -Math.sin(ry);
      for (let row = 0; row < rows; row++) for (let i = 0; i < count - (row === rows - 1 ? 1 : 0); i++) {
        const k = (i - (count - 1) / 2 + (row % 2) * 0.5) * 0.98;
        const bx = x + dx * k, bz = z + dz * k;
        bag(bx, h(bx, bz) + 0.2 + row * 0.38, bz, ry);
      }
    };
    // An arc of bags with its open side at the back.
    const arc = (x, z, dir, radius, span, rows = 3) => {
      const n = Math.round((span * radius) / 0.95);
      for (let row = 0; row < rows; row++) for (let i = 0; i <= n; i++) {
        const a = -span / 2 + (i + (row % 2) * 0.5) * (span / n);
        const bx = x + dir * Math.cos(a) * radius, bz = z + Math.sin(a) * radius;
        bag(bx, h(bx, bz) + 0.2 + row * 0.38, bz, a + Math.PI / 2);
      }
    };
    const crate = (x, z, s = 1, ry = rand(0, 1)) => {
      const y = h(x, z);
      block(s, s * 0.7, s * 0.7, crateWood, x, y, z, ry);
      block(s * 1.02, 0.05, s * 0.72, darkWood, x, y + s * 0.34, z, ry);
    };
    const drum = (x, z, mat = rust) => {
      const o = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 1.1, 10), mat);
      o.position.set(x, h(x, z) + 0.55, z);
      o.castShadow = true;
      group.add(o);
    };
    const machineGun = (x, z, dir) => {
      const y = h(x, z) + 0.72;
      block(0.09, 0.09, 1.3, steel, x, y + 0.42, z, dir > 0 ? Math.PI / 2 : -Math.PI / 2);
      block(0.2, 0.2, 0.46, steel, x - dir * 0.3, y + 0.36, z, Math.PI / 2);
      for (const a of [0, 2.1, 4.2]) block(0.05, 0.62, 0.05, steel, x - dir * 0.3 + Math.cos(a) * 0.14, y - 0.18, z + Math.sin(a) * 0.14, 0, Math.cos(a) * 0.3);
    };
    const post = (team, x, z) => this.posts.push({ team, x, z });

    for (const [team, dir] of [['blue', -1], ['red', 1]]) {
      const lane = (z) => (team === 'red' ? z + 3 : z);
      for (const [k, lineX] of LINES.entries()) {
        const x = dir * lineX;
        // Staggered, so the line isn't a neat row.
        for (const [i, gap] of GAPS.entries()) {
          if ((i + k) % 2) continue;
          const z = lane(gap) + rand(-0.4, 0.4), wx = x + dir * rand(-4, 4);
          if ((i + k) % 4 === 0) {
            // A machine-gun nest.
            arc(wx, z, -dir, 2.1, 2.5, 3);
            machineGun(wx - dir * 0.5, z, -dir);
            post(team, wx + dir * 0.9, z + rand(-0.6, 0.6));
          } else {
            // A straight breastwork, with riflemen crouched behind it.
            wall(wx, z, Math.PI / 2, 5, 3);
            post(team, wx + dir * 1, z - 1.1);
            post(team, wx + dir * 1, z + 1.1);
            if (Math.random() < 0.5) crate(wx + dir * 2.2, z + rand(-1, 1), 0.9);
          }
        }
      }
      // Trenches along both edges of the field, sandbags on the parapet.
      for (const side of [-1, 1]) for (const [k, start] of [58, 112].entries()) {
        const len = 34, cx = dir * (start + len / 2), zz = side * (FLANK[0] + k * 3 + 1);
        const y = h(cx, zz);
        block(len, 0.1, 2.5, dirt, cx, y + 0.02, zz);
        for (const e of [-1, 1]) block(len, 0.5, 0.14, darkWood, cx, y, zz + e * 1.25);
        for (let i = 0; i < len; i += 2.4) for (const e of [-1, 1]) block(0.14, 0.7, 0.14, wood, cx - len / 2 + i, y, zz + e * 1.3);
        wall(cx, zz - side * 1.9, 0, 34, 2);
        for (let i = 0; i < 3; i++) post(team, cx + rand(-14, 14), zz);
      }
      // Wire in front of each line.
      for (const side of [-1, 1]) {
        const wx = dir * 40, zs = side * 34;
        for (let i = 0; i < 9; i++) {
          const x = wx + dir * i * 4.5, y = h(x, zs);
          block(0.1, 1.4, 0.1, darkWood, x, y, zs, 0, 0.22 * (i % 2 ? 1 : -1));
          if (i < 8) for (const t of [0.5, 0.95, 1.3]) {
            const s = block(4.6, 0.025, 0.025, rope, x + dir * 2.25, y + t, zs);
            s.castShadow = false;
          }
        }
      }
      // A concrete bunker on each flank, firing slit towards the enemy.
      for (const side of [-1, 1]) {
        const x = dir * 96, z = side * 52, y = h(x, z) - 0.2;
        block(9, 3, 7, concrete, x, y, z);
        block(9.8, 0.5, 7.8, concrete, x, y + 3, z);
        block(0.1, 0.5, 4.8, steel, x - dir * 4.52, y + 1.7, z);
        block(0.5, 2, 1.6, darkWood, x + dir * 4.52, y, z);
        wall(x - dir * 6, z, Math.PI / 2, 9, 3);
        for (let i = 0; i < 6; i++) bag(x + rand(-5, 5), y + 3.6, z + rand(-3.4, 3.4), rand(0, 3));
        post(team, x - dir * 5, z + side * 0.4);
        // A radio mast on the roof.
        block(0.08, 6, 0.08, steel, x + dir * 2.5, y + 3.3, z + 1.4);
      }
      // Behind the lines: tents, stores, a field gun, poles.
      for (const [x0, z0] of [[148, -38], [160, 34], [172, -6]]) {
        const x = dir * x0, z = z0 + (team === 'red' ? 3 : 0), y = h(x, z);
        const roof = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 6, 3), canvas);
        roof.rotation.set(Math.PI / 2, 0, 0);
        roof.scale.set(1, 1, 1);
        roof.position.set(x, y + 1.25, z);
        roof.castShadow = roof.receiveShadow = true;
        group.add(roof);
        crate(x + 4, z + 2, 1.1);
        crate(x + 4.2, z - 1.2, 1.1);
        crate(x + 5.4, z + 0.5, 0.9);
        drum(x - 4, z + 1.5);
        drum(x - 4.6, z + 2.6);
        drum(x - 3.8, z + 3, steel);
      }
      for (const side of [-1, 1]) {
        // A field gun behind its own little wall.
        const x = dir * 135, z = side * 33, y = h(x, z);
        arc(x - dir * 2, z, -dir, 3.6, 2.2, 3);
        block(0.2, 0.2, 4.6, steel, x - dir * 1.2, y + 1.3, z, Math.PI / 2 + dir * -0.0, dir * -0.28);
        block(0.9, 0.8, 1.1, steel, x + dir * 0.8, y + 0.6, z);
        for (const e of [-1, 1]) {
          const w = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.18, 12), steel);
          w.rotation.x = Math.PI / 2;
          w.position.set(x + dir * 0.8, y + 0.62, z + e * 0.8);
          w.castShadow = true;
          group.add(w);
        }
        post(team, x + dir * 2.6, z + 1);
        // Telegraph poles going off behind the lines.
        for (let i = 0; i < 4; i++) {
          const px = dir * (70 + i * 34), pz = side * 62, py = h(px, pz);
          block(0.2, 8, 0.2, darkWood, px, py, pz, 0, rand(-0.05, 0.05));
          block(2, 0.14, 0.14, darkWood, px, py + 7.2, pz, Math.PI / 2);
        }
      }
    }
    // Broken walls left standing out in the middle.
    for (const [x, z, w, ry] of [[-31, 40, 7, 0.3], [20, -43, 8, -0.4], [52, 39, 5, 1.2], [-58, -43, 6, 2.2]]) {
      const y = h(x, z);
      block(w, 2.6, 0.5, concrete, x, y, z, ry);
      block(w * 0.5, 1.2, 0.5, concrete, x + Math.cos(ry) * w * 0.25, y + 2.6, z - Math.sin(ry) * w * 0.25, ry);
    }
    // Now all the bags.
    // A box pulled into a stuffed pillow, tied off at the ends.
    const bagGeo = new THREE.BoxGeometry(1.08, 0.42, 0.58, 6, 2, 3);
    const v = bagGeo.attributes.position;
    for (let i = 0; i < v.count; i++) {
      const nx = v.getX(i) / 0.54, ny = v.getY(i) / 0.21, nz = v.getZ(i) / 0.29;
      const ends = 1 - nx * nx * nx * nx * 0.5;
      v.setXYZ(i, v.getX(i) * (1 - (ny * ny + nz * nz) * 0.05), v.getY(i) * ends * (1 - nz * nz * 0.3), v.getZ(i) * ends * (1 - ny * ny * 0.14));
    }
    bagGeo.computeVertexNormals();
    const bagMesh = new THREE.InstancedMesh(bagGeo, m(0xffffff), bags.length);
    const mx = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(), e = new THREE.Euler(), c = new THREE.Color();
    bags.forEach(([x, y, z, ry, size], i) => {
      e.set(rand(-0.05, 0.05), ry, rand(-0.05, 0.05));
      mx.compose(p.set(x, y, z), q.setFromEuler(e), s.set(size, 1, size));
      bagMesh.setMatrixAt(i, mx);
      bagMesh.setColorAt(i, c.setHSL(rand(0.09, 0.12), rand(0.22, 0.34), rand(0.33, 0.46)));
    });
    bagMesh.castShadow = bagMesh.receiveShadow = true;
    group.add(bagMesh);
  }

  scorch(group, mat) {
    group.traverse((o) => {
      if (o.isMesh) o.material = mat;
    });
  }

  addFire(x, z, power) {
    this.fires = this.fires ?? [];
    const f = { x, z, y: this.heightAt(x, z), power, t: Math.random() };
    this.fires.push(f);
    return f;
  }

  // ---------- Armies ----------
  addTank(team, lane, i) {
    const dir = team === 'blue' ? 1 : -1;
    const t = { kind: 'tank', team, lane, dir, x: dir * -rand(80, 130), z: lane, i, h: dir > 0 ? Math.PI / 2 : -Math.PI / 2, cd: rand(1, 6), target: null, aim: dir > 0 ? Math.PI / 2 : -Math.PI / 2, pitch: 0, speed: rand(2.6, 4.2), hits: 0, wreck: 0, recoil: 0 };
    this.fitTank(t);
    return t;
  }

  fitTank(t) {
    if (t.handles) {
      this.group.remove(t.handles.group);
    }
    const type = pick(TANK_TYPES);
    t.handles = buildTank(type, t.team);
    t.body = t.handles.group;
    this.addFlag(t, TANKS[type].size);
    t.mats = [];
    t.body.traverse((o) => {
      if (o.isMesh) {
        t.mats.push([o, o.material]);
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    t.body.rotation.order = 'YXZ';
    this.group.add(t.body);
  }

  // Whose side it's on, seen from anywhere: both armies wear the same camouflage.
  addFlag(t, size) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 3, 5), POLE);
    pole.position.set(size.width * 0.3, size.height * 0.65 + 1.5, -size.length * 0.32);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 0.72, 4, 1), FLAGS[t.team]);
    flag.position.set(size.width * 0.3, size.height * 0.65 + 2.62, -size.length * 0.32 - 0.6);
    flag.rotation.y = Math.PI / 2;
    t.flag = flag;
    t.body.add(pole, flag);
  }

  bringUpTank(t) {
    this.fitTank(t);
    Object.assign(t, { x: -t.dir * rand(FRONT, FRONT + 45), hits: 0, wreck: 0, target: null, cd: rand(2, 5), speed: rand(2.6, 4.2) });
    t.body.visible = true;
    t.aim = t.h;
  }

  addSoldier(team, post = null) {
    const dir = team === 'blue' ? 1 : -1;
    const s = { kind: 'inf', team, dir, post, x: post?.x ?? 0, z: post?.z ?? rand(-32, 32), speed: rand(3.4, 4.8), shot: rand(0.5, 3), down: 0, h: dir > 0 ? Math.PI / 2 : -Math.PI / 2 };
    this.fitSoldier(s);
    return s;
  }

  fitSoldier(s) {
    if (s.rig) {
      this.group.remove(s.rig.group);
      s.rig.mesh.skeleton?.dispose();
    }
    s.rig = new SoldierRig(s.team, Math.random() < 0.2 ? 'rocket' : 'rifle');
    this.group.add(s.rig.group);
  }

  buildPlanes() {
    this.planes = [];
    for (const [type, team, bomber] of [['mustang', 'blue', false], ['spitfire', 'blue', false], ['mitchell', 'blue', true], ['messer', 'red', false], ['dauntless', 'red', true], ['heavyfighter', 'red', false]]) {
      const handles = buildPlane(type, team);
      handles.group.rotation.order = 'YXZ';
      handles.group.visible = false;
      handles.group.traverse((o) => {
        if (o.isMesh) o.castShadow = true;
      });
      this.group.add(handles.group);
      this.planes.push({ handles, team, bomber, active: false, wait: rand(0, 12), speed: bomber ? 52 : 64, bombs: 0, gun: 0 });
    }
  }

  launch(p, x0 = null) {
    const dir = p.team === 'blue' ? 1 : -1;
    p.active = true;
    p.handles.group.visible = true;
    p.dir = dir;
    p.x = x0 ?? -dir * rand(300, 360);
    p.z = rand(-60, 60);
    p.y = rand(45, 85);
    p.dz = rand(-0.14, 0.14);
    p.bank = rand(-0.5, 0.5);
    p.dive = !p.bomber && Math.random() < 0.6;
    p.bombs = p.bomber ? 6 : 0;
    p.bombAt = rand(-50, 50);
  }

  // ---------- Things going off ----------
  blast(x, y, z, size = 1, earth = true) {
    const f = this.detail;
    const flames = Math.round(9 * size * f) + 2;
    for (let i = 0; i < flames; i++) {
      const a = Math.random() * 6.28, e = rand(-0.1, 1), v = rand(4, 16) * size;
      this.fire.spawn({ x, y: y + 0.6, z, vx: Math.cos(a) * v * (1 - e * 0.5), vy: v * e + 3, vz: Math.sin(a) * v * (1 - e * 0.5), life: rand(0.25, 0.65), drag: 3.5, s0: rand(0.8, 1.5) * size, s1: rand(2, 4.2) * size, c0: i % 3 ? C.yellow : C.white, c1: C.ember });
    }
    const puffs = Math.round((earth ? 12 : 7) * size * f) + 2;
    for (let i = 0; i < puffs; i++) {
      const a = Math.random() * 6.28, v = rand(1, 7) * size;
      const dirt = earth && i % 2;
      this.smoke.spawn({ x: x + rand(-1, 1), y: y + rand(0.2, 1.5), z: z + rand(-1, 1), vx: Math.cos(a) * v, vy: rand(4, 14) * size * (dirt ? 1.4 : 0.7), vz: Math.sin(a) * v, life: rand(1.6, 4.5), drag: 1.3, s0: rand(1.4, 2.6) * size, s1: rand(5, 10) * size, c0: dirt ? C.dirt : C.soot, c1: dirt ? C.dust : C.smoke, spin: rand(-0.5, 0.5) });
    }
    const bits = Math.round(9 * size * f);
    for (let i = 0; i < bits; i++) {
      const a = Math.random() * 6.28, v = rand(5, 22) * Math.sqrt(size);
      this.chunks.spawn({ x, y: y + 0.5, z, vx: Math.cos(a) * v, vy: rand(6, 24) * Math.sqrt(size), vz: Math.sin(a) * v, grav: 22, life: rand(1, 2.6), s0: rand(0.12, 0.42), s1: rand(0.12, 0.42), c0: earth && i % 2 ? C.dirt : C.debris, floor: this.heightAt(x, z), spin: rand(-9, 9) });
    }
    this.flash(x, y, z, 900 * size);
    // Close to the camera, the picture feels it.
    const d = this.tmp.set(x, y, z).distanceTo(this.pos);
    this.shake = Math.min(1.2, this.shake + (size * 26) / Math.max(10, d));
    // Anyone close by goes down.
    for (const s of this.soldiers) {
      if (s.down > 0 || Math.hypot(s.x - x, s.z - z) > 6.5 * size) continue;
      const l = Math.hypot(s.x - x, s.z - z) || 1;
      this.fell(s, { blast: [(s.x - x) / l, (s.z - z) / l] });
    }
  }

  fell(s, how) {
    s.down = BODY_TIME;
    s.rig.die(how);
  }

  fireGun(from, to, team, cb, speed = SHELL_SPEED, width = 0.22) {
    this.shells.push({ fx: from.x, fy: from.y, fz: from.z, tx: to.x, ty: to.y, tz: to.z, t: 0, dur: Math.max(0.05, from.distanceTo(to) / speed), team, cb, width });
  }

  muzzle(x, y, z, dx, dz, size = 1) {
    for (let i = 0; i < 6; i++) {
      const v = rand(4, 26);
      this.fire.spawn({ x, y, z, vx: dx * v + rand(-3, 3), vy: rand(-1, 3), vz: dz * v + rand(-3, 3), life: rand(0.07, 0.18), drag: 6, s0: rand(0.5, 1) * size, s1: rand(1, 2) * size, c0: C.white, c1: C.orange });
    }
    for (let i = 0; i < 6 * this.detail; i++) {
      const v = rand(1, 9), s = rand(-1, 1);
      this.smoke.spawn({ x, y, z, vx: dx * v - dz * s * 3, vy: rand(0.2, 2), vz: dz * v + dx * s * 3, life: rand(1.2, 2.6), drag: 1.6, s0: rand(0.6, 1), s1: rand(2, 3.6), c0: C.smoke, c1: C.dust });
    }
    this.flash(x, y, z, 260);
  }

  // ---------- The fight ----------
  update(dt) {
    this.time += dt;
    this.updateTanks(dt);
    this.updateSoldiers(dt);
    this.updatePlanes(dt);
    this.updateShells(dt);
    this.updateFires(dt);
    // Shells landing all over, more of them around whatever's in the picture.
    this.arty -= dt;
    if (this.arty <= 0) {
      this.arty = rand(0.9, 2.2);
      const near = Math.random() < 0.6;
      const x = near ? this.look.x + rand(-38, 38) : rand(-110, 110), z = near ? this.look.z + rand(-26, 26) : rand(-40, 40);
      this.blast(x, this.heightAt(x, z), z, rand(1, 1.9));
    }
    this.fire.update(dt, this.camera);
    this.smoke.update(dt, this.camera);
    this.chunks.update(dt, this.camera);
    for (const l of this.flashes) l.intensity *= Math.max(0, 1 - dt * 9);
    this.updateCamera(dt);
    this.sky.position.copy(this.pos).setY(0);
  }

  nearestEnemy(t) {
    let best = null, bd = Infinity;
    for (const o of this.tanks) {
      if (o.team === t.team || o.wreck > 0) continue;
      const d = Math.hypot(o.x - t.x, o.z - t.z);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    return [best, bd];
  }

  updateTanks(dt) {
    const h = this.heightAt;
    for (const t of this.tanks) {
      if (t.wreck > 0) {
        t.wreck -= dt;
        // Burns, then gets towed out of the story behind the smoke.
        if (Math.random() < dt * 9 * this.detail) this.smoke.spawn({ x: t.x + rand(-1, 1), y: t.y + 2, z: t.z + rand(-1, 1), vx: rand(0.4, 1.8), vy: rand(4, 7), vz: rand(-0.6, 0.6), life: rand(4, 7), drag: 0.15, s0: 1, s1: rand(5, 9), c0: C.soot, c1: C.smoke });
        if (Math.random() < dt * 16 * this.detail) this.fire.spawn({ x: t.x + rand(-1.5, 1.5), y: t.y + rand(1, 2.4), z: t.z + rand(-1.5, 1.5), vy: rand(2, 5), life: rand(0.4, 0.9), s0: rand(0.5, 1), s1: rand(0.9, 1.7), c0: C.yellow, c1: C.ember });
        if (t.wreck <= 0) this.bringUpTank(t);
        continue;
      }
      const [enemy, dist] = this.nearestEnemy(t);
      t.target = enemy;
      const moving = !enemy || dist > STOP_AT;
      if (moving) {
        t.x += t.dir * t.speed * dt;
        // Churned up behind it.
        if (Math.random() < dt * 5 * this.detail) this.smoke.spawn({ x: t.x - t.dir * 3, y: t.y + 0.3, z: t.z + rand(-1.5, 1.5), vy: rand(0.4, 1.2), life: rand(1, 2.2), s0: 0.5, s1: rand(1.4, 2.6), c0: C.dust, c1: C.dust });
      }
      t.z += (t.lane - t.z) * dt * 0.3;
      // Sits on the ground, nose following the slope.
      t.y = h(t.x, t.z);
      const pitch = Math.atan2(h(t.x + t.dir * 2.5, t.z) - h(t.x - t.dir * 2.5, t.z), 5);
      const roll = Math.atan2(h(t.x, t.z + 1.6) - h(t.x, t.z - 1.6), 3.2);
      t.pitch += (-pitch - t.pitch) * Math.min(1, dt * 3);
      t.recoil = Math.max(0, t.recoil - dt * 3);
      t.body.position.set(t.x, t.y + Math.sin(this.time * 7 + t.i) * (moving ? 0.018 : 0), t.z);
      t.body.rotation.set(t.pitch - t.recoil * 0.05, t.h, t.dir * roll * 0.8);
      t.flag.rotation.y = Math.PI / 2 + Math.sin(this.time * 3 + t.i) * 0.22;
      // The turret comes round on to whoever's nearest.
      const hd = t.handles;
      if (enemy && hd.turret) {
        const want = Math.atan2(enemy.x - t.x, enemy.z - t.z);
        const step = 0.5 * dt;
        t.aim += Math.max(-step, Math.min(step, wrap(want - t.aim)));
        hd.turret.rotation.y = wrap(t.aim - t.h);
        if (hd.gun) hd.gun.rotation.x = -0.03 - Math.min(0.1, 6 / Math.max(30, dist));
      }
      t.cd -= dt;
      if (enemy && t.cd <= 0 && dist < 170) {
        t.cd = rand(2.5, 5);
        const from = (hd.muzzle ?? hd.gun ?? t.body).getWorldPosition(new THREE.Vector3());
        const dx = enemy.x - from.x, dz = enemy.z - from.z, len = Math.hypot(dx, dz) || 1;
        const hit = Math.random() < 0.3;
        const to = hit ? new THREE.Vector3(enemy.x, enemy.y + 1.4, enemy.z) : new THREE.Vector3(enemy.x + rand(-13, 13), 0, enemy.z + rand(-13, 13));
        if (!hit) to.y = h(to.x, to.z);
        this.muzzle(from.x, from.y, from.z, dx / len, dz / len);
        t.recoil = 1;
        this.fireGun(from, to, t.team, () => {
          if (hit && enemy.wreck <= 0) this.hitTank(enemy);
          else this.blast(to.x, to.y, to.z, hit ? 0.7 : rand(0.75, 1.1));
        });
      }
    }
  }

  hitTank(t) {
    t.hits++;
    if (t.hits < 2) return this.blast(t.x, t.y + 1.6, t.z, 0.6, false);
    t.wreck = WRECK_TIME;
    this.blast(t.x, t.y + 1.5, t.z, 2.1, false);
    const burnt = this.burnt ??= new THREE.MeshLambertMaterial({ color: 0x17130f, flatShading: true });
    for (const [o] of t.mats) o.material = burnt;
    if (t.handles.turret && Math.random() < 0.6) {
      t.handles.turret.rotation.y += rand(-1.4, 1.4);
      t.handles.turret.rotation.z = rand(-0.16, 0.16);
      t.handles.turret.position.y += 0.2;
    }
  }

  updateSoldiers(dt) {
    const h = this.heightAt;
    for (const s of this.soldiers) {
      if (s.down > 0) {
        s.down -= dt;
        s.rig.update({ dt, speed: 0, fwd: 0, side: 0, turn: 0, code: 0, aimPitch: 0, aiming: false, lod: 1, ground: null });
        if (s.down <= 0) {
          this.fitSoldier(s);
          s.x = s.post?.x ?? -s.dir * rand(FRONT - 40, FRONT);
          s.z = s.post?.z ?? rand(-32, 32);
        } else continue;
      }
      const near = this.nearestEnemy(s)[1];
      const runs = !s.post && near > 28 && (s.dir > 0 ? s.x < -10 : s.x > 10);
      if (runs) s.x += s.dir * s.speed * dt;
      const speed = runs ? s.speed : 0;
      s.rig.group.position.set(s.x, h(s.x, s.z), s.z);
      s.rig.group.rotation.y = s.h;
      s.rig.update({ dt, speed, fwd: speed, side: 0, turn: 0, code: runs ? 0 : 1, aimPitch: 0, aiming: !runs, lod: 1, ground: null });
      s.shot -= dt;
      if (s.shot <= 0) {
        s.shot = rand(1.2, 3.5);
        const from = this.tmp.set(s.x + s.dir * 0.5, s.rig.group.position.y + 1.25, s.z).clone();
        const to = this.tmp2.set(s.x + s.dir * rand(40, 80), 0, s.z + rand(-16, 16)).clone();
        to.y = h(to.x, to.z) + rand(0, 2);
        s.rig.shoot();
        for (let b = 0; b < 3; b++) this.fireGun(from, to, s.team, null, 380, 0.05);
        if (Math.random() < 0.05 && !runs) this.fell(s, { fromAngle: Math.PI });
      }
    }
  }

  updatePlanes(dt) {
    const h = this.heightAt;
    for (const p of this.planes) {
      for (const r of p.handles.props) r.rotation.z += dt * 40;
      if (!p.active) {
        p.wait -= dt;
        if (p.wait <= 0) this.launch(p);
        continue;
      }
      p.x += p.dir * p.speed * dt;
      p.z += p.dir * p.dz * p.speed * dt;
      const ground = h(p.x, p.z);
      // Fighters come down to shoot, then pull up; bombers hold steady.
      const wantY = p.dive && Math.abs(p.x) < 90 ? ground + 28 : ground + (p.bomber ? 72 : 60);
      const vy = (wantY - p.y) * 0.8;
      p.y += vy * dt;
      p.handles.group.position.set(p.x, p.y, p.z);
      p.handles.group.rotation.set(-Math.atan2(vy, p.speed), p.dir > 0 ? Math.PI / 2 + Math.atan(p.dz) * p.dir : -Math.PI / 2 - Math.atan(p.dz) * p.dir, Math.sin(this.time * 0.6 + p.z) * 0.08 + p.bank * 0.3);
      // Bomb run.
      if (p.bombs > 0 && p.dir * (p.x - p.bombAt) > 0) {
        p.bombs--;
        p.bombAt += p.dir * 11;
        const fall = Math.sqrt((2 * (p.y - ground)) / 22);
        const to = new THREE.Vector3(p.x + p.dir * p.speed * fall, 0, p.z + rand(-3, 3));
        to.y = h(to.x, to.z);
        this.shells.push({ fx: p.x, fy: p.y - 1, fz: p.z, tx: to.x, ty: to.y, tz: to.z, t: 0, dur: fall, team: p.team, bomb: true, width: 0.3, cb: () => this.blast(to.x, to.y, to.z, 1.7) });
      }
      // Strafing.
      if (p.dive && Math.abs(p.x) < 90) {
        p.gun -= dt;
        if (p.gun <= 0) {
          p.gun = 0.09;
          const from = new THREE.Vector3(p.x, p.y - 0.4, p.z);
          const to = new THREE.Vector3(p.x + p.dir * rand(45, 70), 0, p.z + rand(-3, 3));
          to.y = h(to.x, to.z);
          this.fireGun(from, to, p.team, () => {
            if (Math.random() < 0.3) this.smoke.spawn({ x: to.x, y: to.y + 0.3, z: to.z, vy: rand(1, 4), life: rand(0.5, 1), s0: 0.4, s1: 1.1, c0: C.dust, c1: C.dust });
          }, 520, 0.09);
        }
      }
      // Flak follows them over the enemy's half.
      if (Math.random() < dt * 1.6 && Math.abs(p.x) < 200) this.flak(p);
      if (Math.abs(p.x) > 380) {
        p.active = false;
        p.handles.group.visible = false;
        p.wait = rand(3, 13);
      }
    }
  }

  flak(p) {
    const x = p.x + p.dir * rand(0, 40) + rand(-16, 16), y = p.y + rand(-6, 22), z = p.z + rand(-16, 16);
    this.fire.spawn({ x, y, z, life: 0.16, s0: 2, s1: 3.2, c0: C.white, c1: C.orange });
    for (let i = 0; i < 4 * this.detail; i++) this.smoke.spawn({ x: x + rand(-1, 1), y: y + rand(-1, 1), z: z + rand(-1, 1), vx: rand(-1, 1), vz: rand(-1, 1), life: rand(3, 5), s0: 1, s1: rand(2.5, 3.8), drag: 0.8, c0: C.soot, c1: C.soot });
    // A line of tracer climbing towards it from the side being flown over.
    const side = p.x > 0 ? 1 : -1;
    this.fireGun(new THREE.Vector3(side * rand(100, 170), 6, rand(-50, 50)), new THREE.Vector3(x, y, z), p.team === 'blue' ? 'red' : 'blue', null, 420, 0.12);
  }

  updateShells(dt) {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), dir = new THREE.Vector3(), z = new THREE.Vector3(0, 0, 1);
    let n = 0;
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const b = this.shells[i];
      b.t += dt / b.dur;
      if (b.t >= 1) {
        b.cb?.();
        this.shells.splice(i, 1);
        continue;
      }
      if (n >= this.tracerMesh.instanceMatrix.count) continue;
      // Bombs fall in a curve; everything else flies flat.
      const u = b.bomb ? b.t * b.t : b.t;
      p.set(b.fx + (b.tx - b.fx) * b.t, b.fy + (b.ty - b.fy) * u, b.fz + (b.tz - b.fz) * b.t);
      dir.set(b.tx - b.fx, b.ty - b.fy, b.tz - b.fz).normalize();
      q.setFromUnitVectors(z, dir);
      m.compose(p, q, s.set(b.width, b.width, b.bomb ? 1.2 : Math.min(11, 3 + b.dur * 18)));
      this.tracerMesh.setMatrixAt(n, m);
      this.tracerMesh.setColorAt(n, b.bomb ? C.debris : TEAM_TRACER[b.team]);
      n++;
    }
    this.tracerMesh.count = n;
    this.tracerMesh.instanceMatrix.needsUpdate = true;
    if (this.tracerMesh.instanceColor) this.tracerMesh.instanceColor.needsUpdate = true;
  }

  updateFires(dt) {
    for (const f of this.fires) {
      if (Math.random() < dt * 7 * this.detail) this.fire.spawn({ x: f.x + rand(-1.2, 1.2) * f.power, y: f.y + rand(0, 1.4), z: f.z + rand(-1.2, 1.2) * f.power, vy: rand(2, 5), life: rand(0.5, 1), s0: rand(0.4, 0.9) * f.power, s1: rand(0.9, 1.6) * f.power, c0: C.yellow, c1: C.ember });
      if (Math.random() < dt * 6 * this.detail) this.smoke.spawn({ x: f.x, y: f.y + 2, z: f.z, vx: rand(0.8, 2.4), vy: rand(5, 9), vz: rand(-0.7, 0.7), life: rand(9, 15), drag: 0.03, s0: 1.4 * f.power, s1: rand(9, 17) * f.power, c0: C.soot, c1: C.soot });
    }
  }

  // ---------- The camera ----------
  liveTank(team, nearCentre = true) {
    const list = this.tanks.filter((t) => t.team === team && t.wreck <= 0);
    if (nearCentre) list.sort((a, b) => Math.abs(a.x) - Math.abs(b.x));
    return list[Math.floor(Math.random() * Math.min(3, list.length))] ?? this.tanks[0];
  }

  // One of the tanks on the sun's side of the field: the camera can stand out past it.
  flankTank(team) {
    return pick(this.tanks.filter((t) => t.team === team && t.wreck <= 0 && t.lane < -10)) ?? this.liveTank(team);
  }

  liveSoldier(team) {
    return pick(this.soldiers.filter((s) => s.team === team && s.down <= 0)) ?? this.soldiers[0];
  }

  // Each shot sets itself up, then says where the camera is and what it looks at as it goes along.
  makeShots() {
    const h = this.heightAt;
    return [
      // Wide and high, rising over the whole battle, sun behind it.
      { time: 11, fov: 38, start() {}, at: (u, P, L) => {
        P.set(-165 + u * 60, h(-160, 92) + 20 + u * 34, 92 - u * 18);
        L.set(-10 + u * 30, 5, -6);
      } },
      // Rolling alongside a blue tank, right down by the tracks.
      { time: 9, fov: 40, start: (s) => (s.t = this.flankTank('blue')), at: (u, P, L, s) => {
        const t = s.t;
        P.set(t.x - 13 + u * 15, t.y + 1.3, t.z - 23 + u * 3);
        L.set(t.x, t.y + 1.7, t.z);
      } },
      // Red tanks coming straight at a camera sitting in the mud.
      { time: 8, fov: 34, start: (s) => {
        s.t = this.flankTank('red');
        s.z = s.t.z - 8;
        s.x = s.t.x - 34;
      }, at: (u, P, L, s) => {
        P.set(s.x, h(s.x, s.z) + 0.7, s.z);
        L.set(s.t.x, s.t.y + 2, s.t.z);
      } },
      // Over the turret of a Blue tank at what it's aiming at.
      { time: 9, fov: 34, start: (s) => (s.t = this.liveTank('blue')), at: (u, P, L, s) => {
        const t = s.t, e = t.target ?? this.liveTank('red');
        const dx = e.x - t.x, dz = e.z - t.z, d = Math.hypot(dx, dz) || 1;
        P.set(t.x - (dx / d) * (9 - u * 2) - (dz / d) * 3, t.y + 4.2, t.z - (dz / d) * (9 - u * 2) + (dx / d) * 3);
        L.set(e.x, e.y + 1.5, e.z);
      } },
      // In with the infantry, running, tanks and fire ahead.
      { time: 7, fov: 52, start: (s) => (s.t = this.liveSoldier('blue')), at: (u, P, L, s) => {
        const o = s.t;
        const bob = Math.sin(this.time * 8) * 0.07;
        P.set(o.x - 3.6, h(o.x - 3.6, o.z - 1.6) + 1.45 + bob, o.z - 1.6);
        L.set(o.x + 26, h(o.x, o.z) + 2.6, o.z + 1);
      } },
      // Down behind the sandbags, with the men holding them.
      { time: 8, fov: 40, start: (s) => (s.t = pick(this.soldiers.filter((o) => o.post && o.team === 'blue' && o.down <= 0 && Math.abs(o.x) < 125 && Math.abs(o.z) < 32)) ?? this.soldiers[0]), at: (u, P, L, s) => {
        const o = s.t;
        P.set(o.x - 8.5 + u * 1.5, h(o.x, o.z) + 1.7, o.z - 7 + u * 1);
        L.set(o.x + 7, h(o.x, o.z) + 1.25, o.z + 0.4);
      } },
      // Chasing a fighter down on to the field.
      { time: 8, fov: 46, start: (s) => {
        s.p = this.planes.find((p) => !p.bomber && p.team === 'blue');
        this.launch(s.p, -255);
        s.p.dive = true;
        s.p.z = rand(-12, 12);
        s.p.dz = 0;
      }, at: (u, P, L, s) => {
        const p = s.p;
        P.set(p.x - 26, p.y + 7, p.z - 11);
        L.set(p.x + 16, p.y - 9, p.z);
      } },
      // Close on a Red turret swinging round, then past it to the fight behind.
      { time: 8, fov: 30, start: (s) => (s.t = this.flankTank('red')), at: (u, P, L, s) => {
        const t = s.t;
        P.set(t.x - 15 + u * 4, t.y + 2.4, t.z - 19 + u * 5);
        L.set(t.x, t.y + 2.2, t.z);
      } },
    ];
  }

  startShot() {
    const shot = this.shots[this.shotIndex];
    shot.t = null;
    shot.start(shot);
    this.shotTime = 0;
    this.fov = shot.fov;
  }

  updateCamera(dt) {
    let shot = this.shots[this.shotIndex];
    this.shotTime += dt;
    if (this.shotTime >= shot.time) {
      this.shotIndex = (this.shotIndex + 1) % this.shots.length;
      this.startShot();
      shot = this.shots[this.shotIndex];
    }
    // A slow push through every shot; a shaky moment when something goes off close by.
    const u = this.shotTime / shot.time;
    shot.at(u, this.pos, this.look, shot);
    this.shake = Math.max(0, this.shake - dt * 2.4);
    const sh = this.shake * this.shake * 0.5;
    this.pos.x += rand(-sh, sh);
    this.pos.y += rand(-sh, sh);
    this.pos.z += rand(-sh, sh);
    // Never down inside the ground.
    this.pos.y = Math.max(this.pos.y, this.heightAt(this.pos.x, this.pos.z) + 0.5);
    this.gradeU.fade.value = Math.max(0, 1 - this.shotTime / FADE, 1 - (shot.time - this.shotTime) / FADE);
    // The shadows follow what's in the picture.
    if (this.sun) {
      this.sun.target.position.copy(this.look).setY(0);
      this.sun.position.copy(this.sun.target.position).add(SUN_FROM);
    }
  }

  setBars(k) {
    this.gradeU.bars.value = BARS * k;
  }
}
