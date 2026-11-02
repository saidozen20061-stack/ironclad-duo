import * as THREE from 'three';
import { groundAt, heightAt, WATER_LEVEL, BASES } from '../../../shared/map.js';
import { PROPS } from '../../../shared/props.js';
import { mulberry32 } from '../../../shared/noise.js';
import { quality } from '../settings.js';
import { noHeat } from './thermal.js';

// The war you see from the battlefield: drifting fog and smoke banks, smoke columns from
// burning buildings, ash and embers, searchlights, flak, bomber formations, dogfights, and
// the big artillery explosions with their dirt fountains and lasting craters. Everything is
// client-side decoration except where shells land. quality().atmos scales how much is drawn.

const rand = (a, b) => a + Math.random() * (b - a);
export const WIND = new THREE.Vector2(1, 0.35).normalize();

// ---------- Camera-facing soft puffs: one draw call for hundreds of them ----------
function softTexture() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const r = mulberry32(77);
  ctx.clearRect(0, 0, S, S);
  for (let i = 0; i < 26; i++) {
    const a = r() * Math.PI * 2, d = r() * S * 0.26;
    const x = S / 2 + Math.cos(a) * d, y = S / 2 + Math.sin(a) * d;
    const rad = S * (0.12 + r() * 0.16);
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, 'rgba(255,255,255,0.28)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

class Puffs {
  constructor(scene, tex, max, { additive = false, fogged = true, order = 5 } = {}) {
    const q = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = q.index;
    g.setAttribute('position', q.attributes.position);
    g.setAttribute('uv', q.attributes.uv);
    this.max = max;
    this.pos = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage); // xyz + size
    this.col = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage); // rgb + alpha
    g.setAttribute('iPos', this.pos);
    g.setAttribute('iCol', this.col);
    g.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: null } }]),
      fog: fogged,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: `
        attribute vec4 iPos;
        attribute vec4 iCol;
        varying vec2 vUv;
        varying vec4 vCol;
        #include <fog_pars_vertex>
        void main() {
          vUv = uv;
          vCol = iCol;
          vec4 mvPosition = viewMatrix * vec4(iPos.xyz, 1.0);
          mvPosition.xy += position.xy * iPos.w;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        uniform sampler2D map;
        varying vec2 vUv;
        varying vec4 vCol;
        #include <fog_pars_fragment>
        void main() {
          float a = texture2D(map, vUv).a * vCol.a;
          if (a < 0.004) discard;
          gl_FragColor = vec4(vCol.rgb, a);
          #include <fog_fragment>
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    mat.uniforms.map.value = tex;
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = order;
    noHeat(this.mesh);
    scene.add(this.mesh);
    this.n = 0;
  }

  begin() {
    this.n = 0;
  }

  add(x, y, z, size, r, g, b, a) {
    if (this.n >= this.max) return;
    const i = this.n++;
    this.pos.setXYZW(i, x, y, z, size);
    this.col.setXYZW(i, r, g, b, a);
  }

  end() {
    this.mesh.geometry.instanceCount = this.n;
    this.pos.needsUpdate = true;
    this.col.needsUpdate = true;
  }
}

// ---------- Marks left on the ground: a ring buffer in one mesh, baked onto the terrain ----------
class StampLayer {
  constructor(scene, geo, mat, count, { lift = 0.05, renderOrder = 1 } = {}) {
    this.src = (geo.index ? geo.toNonIndexed() : geo).attributes.position;
    this.vn = this.src.count;
    this.count = count;
    this.lift = lift;
    this.next = 0;
    this.used = 0;
    const g = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(count * this.vn * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.nor = new THREE.BufferAttribute(new Float32Array(count * this.vn * 3), 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.pos);
    g.setAttribute('normal', this.nor);
    g.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = renderOrder;
    scene.add(this.mesh);
  }

  stamp(x, z, s, sy = 1, rot = Math.random() * 6) {
    const c = Math.cos(rot), sn = Math.sin(rot);
    const o0 = this.next * this.vn * 3;
    const a = this.pos.array, n = this.nor.array;
    for (let i = 0, o = o0; i < this.vn; i++, o += 3) {
      const lx = this.src.getX(i) * s, lz = this.src.getZ(i) * s;
      const wx = x + lx * c + lz * sn, wz = z - lx * sn + lz * c;
      a[o] = wx;
      a[o + 1] = heightAt(wx, wz) + this.lift + this.src.getY(i) * sy;
      a[o + 2] = wz;
    }
    for (let i = 0, o = o0; i < this.vn; i += 3, o += 9) {
      _a.fromArray(a, o);
      _b.fromArray(a, o + 3).sub(_a);
      _c.fromArray(a, o + 6).sub(_a);
      _b.cross(_c).normalize();
      for (let k = 0; k < 3; k++) _b.toArray(n, o + k * 3);
    }
    this.next = (this.next + 1) % this.count;
    this.used = Math.min(this.count, this.used + 1);
    this.mesh.geometry.setDrawRange(0, this.used * this.vn);
    this.pos.needsUpdate = true;
    this.nor.needsUpdate = true;
  }
}
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

function planeGeometry() {
  const parts = [
    new THREE.CylinderGeometry(0.9, 0.55, 10, 6).rotateX(Math.PI / 2),
    new THREE.BoxGeometry(13, 0.25, 2.2).translate(0, 0, 0.8),
    new THREE.BoxGeometry(4.5, 0.2, 1.3).translate(0, 0.3, -4.4),
    new THREE.BoxGeometry(0.2, 2, 1.4).translate(0, 1.1, -4.4),
  ].map((g) => g.toNonIndexed());
  let n = 0;
  for (const p of parts) n += p.attributes.position.count;
  const pos = new Float32Array(n * 3);
  let o = 0;
  for (const p of parts) {
    pos.set(p.attributes.position.array, o);
    o += p.attributes.position.array.length;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

export class WarFX {
  constructor(world, fx, props, sound) {
    this.world = world;
    this.scene = world.scene;
    this.fx = fx;
    this.props = props;
    this.sound = sound;
    this.t = 0;
    const q = quality();
    this.k = q.atmos;
    const tex = softTexture();
    this.soft = new Puffs(this.scene, tex, Math.round(420 * this.k));
    this.glow = new Puffs(this.scene, tex, 48, { additive: true, fogged: false, order: 6 });

    // Fog and smoke banks that wander across the map with the wind.
    this.banks = [];
    const nBanks = Math.round(30 * this.k);
    for (let i = 0; i < nBanks; i++) this.banks.push(this.newBank(null, true));

    // Burning buildings: a fixed set picked from the map, same for everyone.
    const r = mulberry32(4711);
    const candidates = PROPS.filter((p) => ['house', 'ruin', 'barn', 'warehouse', 'factory', 'wreck'].includes(p.type));
    this.columns = [];
    for (const p of PROPS) if (p.type === 'wreck' && p.burning) this.columns.push({ x: p.x, z: p.z, y: p.y + 2, h: 70, big: false });
    const nBurn = Math.min(14, candidates.length);
    for (let i = 0; i < nBurn; i++) {
      const p = candidates[Math.floor(r() * candidates.length)];
      this.columns.push({ x: p.x, z: p.z, y: p.y + (p.h ?? 4) * 0.6, h: 110, big: true });
      props.addFire(p.x, p.y + (p.h ?? 4) * 0.5, p.z, true);
    }
    // Far-off columns beyond the map that frame the horizon.
    for (let i = 0; i < 8; i++) {
      const a = r() * Math.PI * 2, d = 500 + r() * 200;
      this.columns.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, y: 25, h: 150, big: true });
    }

    // Ash and embers around the camera.
    this.ash = this.makeDust(Math.round(160 * this.k), 0x8a857c, 0.11);
    this.embers = this.makeDust(Math.round(50 * this.k), 0xff9a50, 0.09);

    // Searchlights swinging through the haze.
    this.lights = [];
    const beamGeo = new THREE.ConeGeometry(1, 1, 12, 1, true).translate(0, -0.5, 0).rotateX(Math.PI / 2);
    // Bright at the lamp, gone long before the wide end of the beam.
    const beamMat = new THREE.ShaderMaterial({
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexShader: 'varying float vL; void main() { vL = -position.z; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'varying float vL; void main() { float a = (1.0 - smoothstep(0.0, 0.85, vL)) * 0.1; gl_FragColor = vec4(vec3(1.0, 0.92, 0.75) * a, a); }',
    });
    const beamSpots = [[BASES.blue.x - 70, BASES.blue.z - 25], [BASES.blue.x + 80, BASES.blue.z - 25], [BASES.red.x - 80, BASES.red.z + 25], [BASES.red.x + 70, BASES.red.z + 25], [-640, -300], [640, 300]];
    for (const [i, [x, z]] of beamSpots.entries()) {
      if (i >= Math.round(6 * this.k)) break;
      const m = new THREE.Mesh(beamGeo, beamMat);
      m.position.set(x, groundAt(x, z) + 1, z);
      m.scale.set(14, 14, 520);
      m.renderOrder = 7;
      m.frustumCulled = false;
      noHeat(m);
      this.scene.add(m);
      this.lights.push({ m, phase: i * 1.7, speed: 0.1 + (i % 3) * 0.04 });
    }

    // Planes overhead: bomber formations from host events, fighters circling on their own.
    this.planeMesh = new THREE.InstancedMesh(planeGeometry(), new THREE.MeshStandardMaterial({ color: 0x3f4438, flatShading: true }), 24);
    this.planeMesh.frustumCulled = false;
    this.planeMesh.castShadow = false;
    noHeat(this.planeMesh);
    this.scene.add(this.planeMesh);
    this.bombers = [];
    this.fighters = [];
    this.nextDogfight = rand(10, 25);
    this.nextFlak = rand(2, 6);
    this.nextFlare = rand(10, 18);
    this.nextSiren = rand(40, 90);
    this.tracers = [];
    this.tracerGeo = new THREE.BoxGeometry(1, 1, 1);
    this.tracerMat = new THREE.MeshBasicMaterial({ color: 0xffa860 });
    this.tracerMesh = new THREE.InstancedMesh(this.tracerGeo, this.tracerMat, 60);
    this.tracerMesh.frustumCulled = false;
    this.tracerMesh.count = 0;
    noHeat(this.tracerMesh);
    this.scene.add(this.tracerMesh);
    this.flaks = [];
    this.flashes = [];
    this.flares = [];
    this.falling = [];
    this.fallGeo = new THREE.CylinderGeometry(0.16, 0.26, 1.5, 6).rotateX(Math.PI / 2);
    this.fallMat = new THREE.MeshStandardMaterial({ color: 0x2c2c26, flatShading: true });

    // Shockwave rings.
    this.rings = [];
    this.ringGeo = new THREE.RingGeometry(0.86, 1, 32).rotateX(-Math.PI / 2);
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xe8d8b8, transparent: true, depthWrite: false });

    // Craters and scorch marks that stay.
    const scars = Math.round(70 * Math.max(0.5, this.k));
    const holeGeo = new THREE.RingGeometry(0.001, 1, 10, 3).rotateX(-Math.PI / 2);
    const scorchMat = new THREE.MeshStandardMaterial({ color: 0x1c1813, flatShading: true, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false });
    const holeMat = new THREE.MeshStandardMaterial({ color: 0x2a221a, flatShading: true, roughness: 1, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, depthWrite: false });
    this.scorch = new StampLayer(this.scene, holeGeo, scorchMat, scars, { lift: 0.05, renderOrder: 1 });
    this.holes = new StampLayer(this.scene, holeGeo, holeMat, scars, { lift: 0.06, renderOrder: 2 });
    const rimGeo = new THREE.TorusGeometry(1, 0.2, 3, 12).rotateX(-Math.PI / 2);
    this.rims = new StampLayer(this.scene, rimGeo, new THREE.MeshStandardMaterial({ color: 0x4d3f2e, flatShading: true }), scars, { lift: 0.02, renderOrder: 0 });

    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
    this.onNearBlast = null; // (strength 0..1) => void
  }

  newBank(cam, anywhere = false) {
    const R = 430;
    const cx = cam?.x ?? 0, cz = cam?.z ?? 0;
    let x, z;
    if (anywhere) {
      x = cx + rand(-R, R);
      z = cz + rand(-R, R);
    } else {
      // Comes in from upwind, just outside the visible range.
      const a = Math.atan2(-WIND.y, -WIND.x) + rand(-1.1, 1.1);
      x = cx + Math.cos(a) * R;
      z = cz + Math.sin(a) * R;
    }
    const smoke = Math.random() < 0.3;
    return { x, z, size: rand(60, 130), lift: rand(0.1, 0.32), alpha: smoke ? rand(0.12, 0.2) : rand(0.16, 0.3), shade: smoke ? rand(0.32, 0.45) : rand(0.62, 0.74), speed: rand(1.5, 4), spin: rand(0, 6) };
  }

  makeDust(n, color, size) {
    const pos = new Float32Array(Math.max(1, n) * 3);
    for (let i = 0; i < pos.length; i += 3) {
      pos[i] = rand(-40, 40);
      pos[i + 1] = rand(0, 30);
      pos[i + 2] = rand(-40, 40);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ color, size, transparent: true, opacity: 0.8, depthWrite: false }));
    pts.frustumCulled = false;
    noHeat(pts);
    this.scene.add(pts);
    return { pts, pos, n, last: new THREE.Vector3() };
  }

  // ---------- Host events ----------
  // A shell or bomb on its way down: visible for its last moments, whistling if it's close.
  incoming(ev, cam) {
    const d = Math.hypot(ev.x - cam.x, ev.z - cam.z);
    if (d < 170) this.sound.whistle({ x: ev.x, y: groundAt(ev.x, ev.z), z: ev.z }, ev.fall, ev.size > 1);
    if (d > 500) return;
    const m = new THREE.Mesh(this.fallGeo, this.fallMat);
    m.scale.setScalar(ev.size);
    noHeat(m);
    this.scene.add(m);
    const g = groundAt(ev.x, ev.z);
    const dir = new THREE.Vector3(rand(-0.25, 0.25), -1, rand(-0.25, 0.25)).normalize();
    const speed = 90;
    this.falling.push({ m, x: ev.x, y: g, z: ev.z, dir, speed, left: ev.fall });
  }

  impact(ev, cam) {
    const pos = new THREE.Vector3(ev.x, ev.y, ev.z);
    const size = ev.size ?? 1;
    const d = pos.distanceTo(cam);
    const water = ev.y <= WATER_LEVEL + 0.1 && heightAt(ev.x, ev.z) < WATER_LEVEL;
    if (d < quality().drawDistance) this.bigExplosion(pos, size, water);
    if (!water) this.leaveCrater(ev.x, ev.z, 3.5 * size);
    // Flash inside the haze, seen from far away too.
    this.flashes.push({ x: ev.x, y: ev.y + 10, z: ev.z, t: 0, life: 0.55, size: 130 * size });
    this.world.fogFlash(Math.min(1, (size * 90) / Math.max(90, d)));
    this.sound.farExplosion(pos, size);
    const near = Math.max(0, 1 - d / (90 * size));
    if (near > 0) this.onNearBlast?.(near);
  }

  leaveCrater(x, z, r) {
    this.scorch.stamp(x, z, r * 2);
    this.holes.stamp(x, z, r * 0.8);
    this.rims.stamp(x, z, r * 0.9, r * 0.5);
  }

  bigExplosion(pos, size, water) {
    const fx = this.fx;
    const pq = quality().particles;
    fx.particle({ geo: fx.puffGeo, mat: fx.mats.fire, pos: pos.clone().setY(pos.y + 2), vel: new THREE.Vector3(0, 5, 0), size: 3.2 * size, grow: 2.6, life: 0.3 });
    fx.particle({ geo: fx.puffGeo, mat: fx.mats.fire, pos: pos.clone().setY(pos.y + 5), vel: new THREE.Vector3(0, 9, 0), size: 2 * size, grow: 3, life: 0.42 });
    fx.flashLight(pos.clone().setY(pos.y + 4), 28 * size);
    // Dirt fountain: a tall column of soil, then the slow cloud.
    const mat = water ? fx.mats.water : fx.mats.dust;
    for (let i = 0; i < Math.round(16 * pq); i++) {
      const up = 14 + Math.random() * 24;
      fx.particle({ geo: fx.puffGeo, mat, pos: pos.clone().add(new THREE.Vector3(rand(-2, 2), 1, rand(-2, 2))), vel: new THREE.Vector3(rand(-3, 3), up * size, rand(-3, 3)), size: 1.5 * size, grow: 2.4, life: 2 + Math.random() * 1.6, fade: 0.7, gravity: 0.6, drag: 0.6 });
    }
    for (let i = 0; i < Math.round(20 * pq); i++) {
      fx.particle({ geo: fx.chunkGeo, mat: water ? fx.mats.water : fx.mats.dirt, pos: pos.clone().setY(pos.y + 0.5), vel: new THREE.Vector3(rand(-14, 14), 8 + Math.random() * 22, rand(-14, 14)).multiplyScalar(size), size: 0.4 + Math.random() * 1.1, life: 3, gravity: 1, spin: true, ground: true });
    }
    for (let i = 0; i < Math.round(8 * pq); i++) {
      fx.particle({ geo: fx.puffGeo, mat: fx.mats.smoke, pos: pos.clone().add(new THREE.Vector3(rand(-3, 3), 2, rand(-3, 3))), vel: new THREE.Vector3(WIND.x * 1.2, 2.5 + Math.random() * 2, WIND.y * 1.2), size: 3 * size, grow: 3, life: 7 + Math.random() * 4, fade: 0.5, drag: 0.1 });
    }
    // Shockwave ring racing out over the ground.
    const ring = new THREE.Mesh(this.ringGeo, this.ringMat.clone());
    ring.position.set(pos.x, Math.max(groundAt(pos.x, pos.z), WATER_LEVEL) + 0.6, pos.z);
    ring.renderOrder = 4;
    noHeat(ring);
    this.scene.add(ring);
    this.rings.push({ m: ring, t: 0, life: 0.6, size: 34 * size });
  }

  // Host flak shell: a black puff with a sharp flash at altitude.
  flakAt(ev) {
    this.flaks.push({ x: ev.x, y: ev.y, z: ev.z, t: 0, life: rand(5, 8), size: rand(16, 26) });
    this.flashes.push({ x: ev.x, y: ev.y, z: ev.z, t: 0, life: 0.12, size: 24 });
    this.sound.flakPop(ev);
  }

  // Formation crossing the map; `started` keeps it in step with where the bombs fall.
  addBomber(ev) {
    this.bombers.push({ x: ev.x, z: ev.z, dx: ev.dx, dz: ev.dz, v: ev.v, y: ev.y, t: 0 });
    this.sound.plane?.();
  }

  // ---------- Per frame ----------
  update(dt, cam) {
    this.t += dt;
    this.soft.begin();
    this.glow.begin();
    this.updateBanks(dt, cam);
    this.updateColumns(cam);
    this.updateDust(this.ash, dt, cam, 0.8, 1.2);
    this.updateDust(this.embers, dt, cam, -1.1, 2);
    this.updateSky(dt, cam);
    this.updateFalling(dt);
    for (const l of this.lights) {
      this._e.set(-0.5 - Math.sin(this.t * l.speed * 0.7 + l.phase) * 0.28, Math.sin(this.t * l.speed + l.phase) * 1.6 + l.phase, 0);
      l.m.quaternion.setFromEuler(this._e);
    }
    this.rings = this.rings.filter((r) => {
      r.t += dt;
      const k = r.t / r.life;
      if (k >= 1) {
        this.scene.remove(r.m);
        r.m.material.dispose();
        return false;
      }
      r.m.scale.setScalar(1 + r.size * Math.sqrt(k));
      r.m.material.opacity = 0.55 * (1 - k);
      return true;
    });
    this.flashes = this.flashes.filter((f) => {
      f.t += dt;
      const k = f.t / f.life;
      if (k >= 1) return false;
      this.glow.add(f.x, f.y, f.z, f.size * (0.7 + k * 0.5), 1, 0.58, 0.24, 0.85 * (1 - k) * (1 - k));
      return true;
    });
    this.soft.end();
    this.glow.end();
    if ((this.nextSiren -= dt) <= 0) {
      this.nextSiren = rand(70, 160);
      this.sound.siren();
    }
  }

  updateBanks(dt, cam) {
    const R = 450;
    for (let i = 0; i < this.banks.length; i++) {
      const b = this.banks[i];
      b.x += WIND.x * b.speed * dt;
      b.z += WIND.y * b.speed * dt;
      const dx = b.x - cam.x, dz = b.z - cam.z;
      const d = Math.hypot(dx, dz);
      if (d > R + 40) {
        this.banks[i] = this.newBank(cam);
        continue;
      }
      // Fades in at the edge of view and thins out as the camera walks into it.
      const fade = Math.min(1, (R + 40 - d) / 120) * Math.min(1, Math.max(0, (d - 15) / 70));
      if (fade <= 0.01) continue;
      const y = Math.max(groundAt(b.x, b.z), WATER_LEVEL) + b.size * b.lift;
      this.soft.add(b.x, y, b.z, b.size, b.shade * 1.05, b.shade * 0.95, b.shade * 0.82, b.alpha * fade);
    }
  }

  updateColumns(cam) {
    const puffs = Math.round(6 + 6 * this.k);
    // The nearest columns get drawn, near ones first.
    let drawn = 0;
    const limit = Math.round(10 + 14 * this.k);
    for (const c of this.columns) {
      const d = Math.hypot(c.x - cam.x, c.z - cam.z);
      if (d > 900 || drawn >= limit) continue;
      drawn++;
      for (let i = 0; i < puffs; i++) {
        const u = (i / puffs + this.t * (c.big ? 0.028 : 0.04) + c.x * 0.01) % 1;
        const size = (c.big ? 7 : 4) + u * (c.big ? 44 : 22);
        const a = Math.min(1, u * 10) * (1 - u) * (c.big ? 0.42 : 0.3);
        const shade = 0.14 + u * 0.16;
        this.soft.add(c.x + WIND.x * u * c.h * 0.5, c.y + u * c.h, c.z + WIND.y * u * c.h * 0.5, size, shade * 1.1, shade, shade * 0.92, a);
      }
    }
  }

  updateDust(d, dt, cam, fall, sway) {
    if (!d.n) return;
    const p = d.pos;
    const W = 40, H = 30;
    for (let i = 0; i < d.n; i++) {
      const o = i * 3;
      p[o] += (WIND.x * 1.6 + Math.sin(this.t + i) * sway * 0.3) * dt;
      p[o + 1] -= fall * dt;
      p[o + 2] += (WIND.y * 1.6 + Math.cos(this.t * 0.8 + i) * sway * 0.3) * dt;
      // Keep a box of it around the camera: leaving one side re-enters on the other.
      if (p[o] > W) p[o] -= W * 2;
      else if (p[o] < -W) p[o] += W * 2;
      if (p[o + 2] > W) p[o + 2] -= W * 2;
      else if (p[o + 2] < -W) p[o + 2] += W * 2;
      if (p[o + 1] < -4) p[o + 1] += H;
      else if (p[o + 1] > H) p[o + 1] -= H;
    }
    d.pts.position.set(cam.x, cam.y, cam.z);
    d.pts.geometry.attributes.position.needsUpdate = true;
  }

  updateFalling(dt) {
    this.falling = this.falling.filter((f) => {
      f.left -= dt;
      if (f.left <= 0) {
        this.scene.remove(f.m);
        return false;
      }
      const dist = f.left * f.speed;
      f.m.position.set(f.x - f.dir.x * dist, f.y - f.dir.y * dist, f.z - f.dir.z * dist);
      f.m.lookAt(f.x, f.y, f.z);
      return true;
    });
  }

  updateSky(dt, cam) {
    let n = 0;
    const m = this._m, q = this._q, e = this._e, pos = this._p, s = this._s;
    // Bombers.
    this.bombers = this.bombers.filter((b) => {
      b.t += dt;
      const along = b.t * b.v;
      if (along > 3400) return false;
      const h = Math.atan2(b.dx, b.dz);
      for (let i = 0; i < 3 && n < 24; i++) {
        const side = i === 0 ? 0 : i === 1 ? 26 : -26, back = i === 0 ? 0 : 22;
        pos.set(b.x + b.dx * (along - back) + b.dz * side, b.y + (i ? 5 : 0), b.z + b.dz * (along - back) - b.dx * side);
        q.setFromEuler(e.set(0, h, 0));
        s.setScalar(1.8);
        m.compose(pos, q, s);
        this.planeMesh.setMatrixAt(n++, m);
      }
      return true;
    });
    // Dogfights: fighters chasing each other in wide circles, trading tracer bursts.
    if ((this.nextDogfight -= dt) <= 0 && !this.fighters.length) {
      this.nextDogfight = rand(30, 70);
      const a = rand(0, Math.PI * 2);
      const r = rand(250, 520);
      const c = { x: cam.x + Math.cos(a) * r, z: cam.z + Math.sin(a) * r };
      const y = rand(170, 280);
      const count = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < count; i++) this.fighters.push({ c, y, r: rand(90, 170), a: i * 0.35, w: 0.55, life: rand(18, 30), bank: 0.6, shot: rand(0, 2) });
    }
    let trace = 0;
    const tm = this.tracerMesh;
    this.fighters = this.fighters.filter((f) => {
      f.life -= dt;
      if (f.life <= 0) return false;
      f.a += f.w * dt;
      const x = f.c.x + Math.cos(f.a) * f.r, z = f.c.z + Math.sin(f.a) * f.r, y = f.y + Math.sin(f.a * 2) * 18;
      const h = Math.atan2(-Math.sin(f.a), Math.cos(f.a));
      pos.set(x, y, z);
      q.setFromEuler(e.set(0, h, -f.bank));
      s.setScalar(1);
      if (n < 24) {
        m.compose(pos, q, s);
        this.planeMesh.setMatrixAt(n++, m);
      }
      f.shot -= dt;
      if (f.shot < 0.4) {
        // A short stream of tracers ahead of the plane.
        for (let i = 0; i < 4 && trace < 60; i++) {
          const dist = 25 + i * 28 + ((this.t * 220) % 28);
          pos.set(x + Math.sin(h) * dist, y, z + Math.cos(h) * dist);
          q.setFromEuler(e.set(0, h, 0));
          s.set(0.5, 0.5, 8);
          m.compose(pos, q, s);
          tm.setMatrixAt(trace++, m);
        }
      }
      if (f.shot < 0) f.shot = rand(1.2, 3.5);
      return true;
    });
    tm.count = trace;
    tm.instanceMatrix.needsUpdate = true;
    this.planeMesh.count = n;
    this.planeMesh.instanceMatrix.needsUpdate = true;
    // Flak: black puffs with a sharp flash, thickest around the planes.
    if ((this.nextFlak -= dt) <= 0) {
      this.nextFlak = rand(0.5, 2.6) / Math.max(0.4, this.k);
      const target = this.fighters[0] ?? null;
      const b = this.bombers[0];
      let x, y, z;
      if (b && Math.random() < 0.7) {
        x = b.x + b.dx * b.t * b.v + rand(-70, 70);
        z = b.z + b.dz * b.t * b.v + rand(-70, 70);
        y = b.y + rand(-22, 22);
      } else if (target) {
        x = target.c.x + rand(-180, 180);
        z = target.c.z + rand(-180, 180);
        y = target.y + rand(-30, 30);
      } else {
        const a = rand(0, Math.PI * 2), r = rand(200, 650);
        x = cam.x + Math.cos(a) * r;
        z = cam.z + Math.sin(a) * r;
        y = rand(130, 270);
      }
      this.flaks.push({ x, y, z, t: 0, life: rand(5, 8), size: rand(14, 24) });
      this.flashes.push({ x, y, z, t: 0, life: 0.12, size: 22 });
      this.sound.flakPop({ x, y, z });
    }
    this.flaks = this.flaks.filter((f) => {
      f.t += dt;
      const k = f.t / f.life;
      if (k >= 1) return false;
      this.soft.add(f.x + WIND.x * f.t * 2, f.y + f.t, f.z + WIND.y * f.t * 2, f.size * (0.5 + k), 0.06, 0.055, 0.05, Math.min(1, f.t * 12) * (1 - k) * 0.85);
      return true;
    });
    // Flares drift down, glowing in the haze.
    if ((this.nextFlare -= dt) <= 0 && !this.flares.length) {
      this.nextFlare = rand(14, 30);
      const a = rand(0, Math.PI * 2), r = rand(120, 380);
      this.flares.push({ x: cam.x + Math.cos(a) * r, y: rand(150, 220), z: cam.z + Math.sin(a) * r, t: 0, life: 16 });
    }
    this.flares = this.flares.filter((f) => {
      f.t += dt;
      const k = f.t / f.life;
      if (k >= 1) return false;
      f.y -= dt * 7;
      f.x += WIND.x * dt * 2.5;
      f.z += WIND.y * dt * 2.5;
      const a = Math.min(1, k * 10, (1 - k) * 4);
      this.glow.add(f.x, f.y, f.z, 7 + Math.sin(this.t * 19) * 0.8, 1, 0.94, 0.72, a);
      this.glow.add(f.x, f.y, f.z, 80, 1, 0.8, 0.5, a * 0.3);
      return true;
    });
  }

  dispose() {
    for (const f of this.falling) this.scene.remove(f.m);
    for (const r of this.rings) this.scene.remove(r.m);
    this.scene.remove(this.soft.mesh, this.glow.mesh, this.ash.pts, this.embers.pts, this.planeMesh, this.tracerMesh);
  }
}
