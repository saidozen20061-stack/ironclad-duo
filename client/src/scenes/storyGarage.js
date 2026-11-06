import * as THREE from 'three';
import { mulberry32 } from '../../../shared/noise.js';

// Story mode's garage: a 3D workshop hall with the crew's tank on a turntable set into the floor.
// The camera sits low at the tank's front three-quarter, like a racing game's garage, and the tank turns
// slowly; drag to turn it. The workshop swings the camera in on one part at a time (`focus`).

const FOV = 34;
const HALL = { x: 22, back: -24, front: 26, h: 12 };
const UP = new THREE.Vector3(0, 1, 0);

const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: o.rough ?? 0.85, metalness: o.metal ?? 0, flatShading: true, ...(o.emissive ? { emissive: o.emissive, emissiveIntensity: o.glow ?? 1 } : {}) });

// Painted lettering for walls and crates.
function textPlane(text, w, h, { color = '#e8d9a6', bg = null, font = 'Black Ops One, Impact, sans-serif', size = 0.62 } = {}) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = Math.round((1024 * h) / w);
  const ctx = c.getContext('2d');
  if (bg) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, c.width, c.height);
  }
  ctx.fillStyle = color;
  ctx.font = `${Math.round(c.height * size)}px ${font}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, c.width / 2, c.height / 2 + c.height * 0.04);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, transparent: !bg, roughness: 0.9 }));
  return m;
}

function buildHall() {
  const g = new THREE.Group();
  const rand = mulberry32(7);
  const add = (geo, m, x, y, z, ry = 0, shadow = true) => {
    const o = new THREE.Mesh(geo, m);
    o.position.set(x, y, z);
    o.rotation.y = ry;
    o.castShadow = shadow;
    o.receiveShadow = true;
    g.add(o);
    return o;
  };
  const box = (w, h, d, m, x, y, z, ry = 0, shadow = true) => add(new THREE.BoxGeometry(w, h, d), m, x, y, z, ry, shadow);
  const cyl = (rt, rb, h, m, x, y, z, seg = 10) => add(new THREE.CylinderGeometry(rt, rb, h, seg), m, x, y, z);
  const { x: X, back: B, front: F, h: H } = HALL;

  // Floor: concrete slabs, each a slightly different grey, with oil stains.
  const slab = 4;
  for (let i = -X; i < X; i += slab) for (let j = B; j < F; j += slab) {
    const k = 0.29 + rand() * 0.035;
    box(slab - 0.04, 0.2, slab - 0.04, mat(new THREE.Color(k, k * 0.98, k * 0.93), { rough: 0.95 }), i + slab / 2, -0.1, j + slab / 2, 0, false);
  }
  const stain = mat(0x1b1a17, { rough: 0.4 });
  for (let n = 0; n < 9; n++) {
    const s = add(new THREE.CircleGeometry(0.6 + rand() * 1.4, 9), stain, (rand() - 0.5) * 34, 0.012, B + 4 + rand() * 40, 0, false);
    s.rotation.x = -Math.PI / 2;
  }
  // Yellow safety lines round the turntable bay.
  const yellow = mat(0xd8b23a, { rough: 0.7 });
  for (const sx of [-1, 1]) box(0.25, 0.03, 16, yellow, sx * 7.6, 0.01, 0, 0, false);
  for (const sz of [-1, 1]) box(15.45, 0.03, 0.25, yellow, 0, 0.01, sz * 8, 0, false);
  for (let i = 0; i < 8; i++) box(0.5, 0.032, 0.18, mat(0x1d1d1a), -6.5 + i * 1.85, 0.012, 8, 0.7, false);

  // Walls: corrugated steel above a concrete skirt, ribs for the corrugation.
  const sheet = mat(0x6f7468, { rough: 0.7, metal: 0.15 });
  const rib = mat(0x5c6157, { rough: 0.7, metal: 0.15 });
  const skirt = mat(0x6e6a60);
  box(2 * X, H, 0.4, sheet, 0, H / 2, B);
  for (let x = -X + 0.5; x < X; x += 1) box(0.14, H - 2.4, 0.16, rib, x, H / 2 + 1.2, B + 0.25, 0, false);
  box(2 * X, 2.4, 0.6, skirt, 0, 1.2, B + 0.2);
  for (const sx of [-1, 1]) {
    box(0.4, H, F - B, sheet, sx * X, H / 2, (F + B) / 2);
    for (let z = B + 0.5; z < F; z += 1) box(0.16, H - 2.4, 0.14, rib, sx * (X - 0.25), H / 2 + 1.2, z, 0, false);
    box(0.6, 2.4, F - B, skirt, sx * (X - 0.2), 1.2, (F + B) / 2);
    // High windows letting daylight in.
    for (let z = B + 5; z < F - 3; z += 7) {
      box(0.1, 2.2, 4.4, mat(0x9fb6c4, { emissive: 0xbcd0dc, glow: 0.9 }), sx * (X - 0.3), H - 2.4, z, 0, false);
      box(0.2, 0.15, 4.6, rib, sx * (X - 0.35), H - 2.4, z, 0, false);
    }
  }
  box(2 * X, H, 0.4, sheet, 0, H / 2, F);
  // The big rolling door in the back wall, and the unit's name over it.
  const slatA = mat(0x6b6a55, { rough: 0.7, metal: 0.2 }), slatB = mat(0x5e5d4a, { rough: 0.7, metal: 0.2 });
  for (let i = 0; i < 14; i++) box(14, 0.5, 0.2, i % 2 ? slatA : slatB, 0, 0.25 + i * 0.5, B + 0.45, 0, false);
  for (const sx of [-1, 1]) box(0.5, 7.4, 0.5, mat(0x2e302b, { metal: 0.4 }), sx * 7.25, 3.7, B + 0.5);
  box(15, 0.6, 0.6, mat(0x2e302b, { metal: 0.4 }), 0, 7.4, B + 0.5);
  const sign = textPlane('MOTOR POOL 7', 12, 1.6, { color: '#e2c56c' });
  sign.position.set(0, 9.1, B + 0.45);
  g.add(sign);
  const hazard = textPlane('NO SMOKING · TRACKED VEHICLES ONLY', 9, 0.8, { color: '#1c1c18', bg: '#d6b236', font: 'Rajdhani, sans-serif', size: 0.55 });
  hazard.position.set(-14, 3.6, B + 0.45);
  g.add(hazard);

  // Steel frame: columns, roof trusses and a gantry crane over the bay.
  const steel = mat(0x33362f, { rough: 0.55, metal: 0.5 });
  for (const sx of [-1, 1]) for (let z = B + 2; z <= F - 2; z += 8) box(0.6, H, 0.6, steel, sx * (X - 1), H / 2, z);
  for (let z = B + 2; z <= F - 2; z += 8) {
    box(2 * X, 0.5, 0.35, steel, 0, H - 0.3, z, 0, false);
    for (let i = -3; i <= 3; i++) {
      const brace = box(0.18, 3.2, 0.18, steel, i * 5.5, H - 1.6, z, 0, false);
      brace.rotation.z = i % 2 ? 0.6 : -0.6;
    }
  }
  for (const sx of [-1, 1]) box(0.5, 0.7, F - B - 4, mat(0x7a5a1c, { metal: 0.3 }), sx * 6, H - 1.6, (F + B) / 2, 0, false);
  box(12.5, 0.8, 0.8, mat(0xb08a2a, { metal: 0.3 }), 0, H - 2.2, -1);
  box(1, 0.7, 1.1, steel, 2, H - 2.9, -1);
  for (let i = 0; i < 10; i++) box(0.12, 0.28, 0.12, steel, 2, H - 3.4 - i * 0.3, -1, 0, false);
  const hook = cyl(0.25, 0.1, 0.5, steel, 2, H - 6.6, -1, 6);
  hook.rotation.z = 0.3;

  // Along the left wall: workbenches, a tool board, a vice, drums and jerry cans.
  const wood = mat(0x6b4e30), dark = mat(0x26271f), olive = mat(0x4d5636), red = mat(0x8a2e22, { rough: 0.6 }), rust = mat(0x6d4a2c);
  for (const z of [-15, -9]) {
    box(1.4, 0.15, 5, wood, -X + 1.4, 1.05, z);
    for (const dz of [-2.2, 2.2]) box(1.2, 1, 0.15, dark, -X + 1.4, 0.5, z + dz);
    box(0.4, 0.3, 0.3, mat(0x4a5560, { metal: 0.6 }), -X + 1.6, 1.3, z - 1.5);
    for (let i = 0; i < 4; i++) box(0.3 + rand() * 0.3, 0.12, 0.12, mat(0x8a8d86, { metal: 0.7 }), -X + 1.3, 1.2, z + i * 0.5);
  }
  const board = box(0.12, 2.6, 11, mat(0x7a6748), -X + 0.45, 2.9, -12);
  board.castShadow = false;
  for (let i = 0; i < 16; i++) box(0.08, 0.15 + rand() * 0.7, 0.1 + rand() * 0.25, mat(0x2c2d27, { metal: 0.6 }), -X + 0.55, 2.2 + rand() * 1.5, -17 + i * 0.68, 0, false);
  for (let i = 0; i < 6; i++) {
    const d = cyl(0.42, 0.42, 1.3, [olive, red, rust][i % 3], -X + 1.2 + (i % 2) * 0.95, 0.65, -4 + Math.floor(i / 2) * 0.95);
    d.rotation.y = rand();
  }
  cyl(0.42, 0.42, 1.3, olive, -X + 1.6, 1.95, -3.5).rotation.z = Math.PI / 2;
  for (let i = 0; i < 5; i++) box(0.5, 0.65, 0.2, olive, -X + 1, 0.33, 2 + i * 0.3);

  // Right side: ammo crates, a rack of shells, stacked road wheels, spare track and a tarp-covered tank.
  const crate = mat(0x5a5a3a);
  for (let i = 0; i < 7; i++) {
    const c = box(1.6, 0.8, 1, crate, X - 2.2 - (i % 3) * 0.2, 0.4 + Math.floor(i / 3) * 0.8, -16 + (i % 3) * 1.05, rand() * 0.15);
    if (i < 3) {
      const t = textPlane('7.5 CM', 1.2, 0.35, { color: '#e8e2c8' });
      t.position.set(c.position.x - 0.81, c.position.y, c.position.z);
      t.rotation.y = -Math.PI / 2;
      g.add(t);
    }
  }
  box(0.9, 2, 3, dark, X - 1.3, 1, -9);
  for (let r = 0; r < 3; r++) for (let i = 0; i < 6; i++) {
    const s = cyl(0.1, 0.1, 0.8, mat(0xa98c4a, { metal: 0.6 }), X - 1.3, 0.55 + r * 0.6, -10.2 + i * 0.45, 8);
    s.rotation.z = Math.PI / 2;
  }
  for (let i = 0; i < 5; i++) {
    const w = cyl(0.6, 0.6, 0.35, dark, X - 2.4, 0.18 + i * 0.36, -2.5, 12);
    w.rotation.y = rand();
  }
  for (let i = 0; i < 9; i++) box(1.8, 0.1, 0.42, mat(0x2a2b26, { metal: 0.4 }), X - 4.5, 0.06 + (i % 2) * 0.02, 1 + i * 0.44, 0.1);
  const tarp = mat(0x4f5534, { rough: 1 });
  const covered = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.7, 6.4), tarp);
  hull.position.y = 0.85;
  const top = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.5, 1, 7), tarp);
  top.position.set(0, 2.1, -0.3);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 3, 6), tarp);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 2.2, 2.6);
  for (const m of [hull, top, barrel]) {
    m.castShadow = m.receiveShadow = true;
    covered.add(m);
  }
  covered.position.set(X - 5, 0, 14);
  covered.rotation.y = -0.4;
  g.add(covered);
  // Sandbags by the door and a ladder against the back wall.
  for (let i = 0; i < 10; i++) box(0.8, 0.32, 0.45, mat(0x9c8962), 9.5 + (i % 5) * 0.75, 0.16 + Math.floor(i / 5) * 0.32, B + 1.2, (rand() - 0.5) * 0.2);
  for (const dx of [0, 0.6]) box(0.08, 6, 0.08, rust, -10 + dx, 3, B + 0.9);
  for (let i = 0; i < 14; i++) box(0.6, 0.06, 0.06, rust, -9.7, 0.4 + i * 0.42, B + 0.9, 0, false);
  return g;
}

export class StoryGarage {
  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x15130f);
    this.scene.fog = new THREE.Fog(0x2a251d, 30, 80);
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.3, 200);
    this.scene.add(buildHall());

    // Light: a cool fill, daylight from the windows and three hanging lamps over the turntable.
    this.scene.add(new THREE.HemisphereLight(0xc9d2dc, 0x4a4234, 1.1));
    // Work lights washing the walls, so the hall reads behind the tank.
    for (const [x, z] of [[-14, -18], [0, -19], [14, -18], [-18, 4], [18, 4]]) {
      const wash = new THREE.PointLight(0xffd9a0, 90, 22, 1.3);
      wash.position.set(x, 6.5, z);
      this.scene.add(wash);
    }
    const day = new THREE.DirectionalLight(0xcfdcec, 0.9);
    day.position.set(-18, 20, 6);
    this.scene.add(day, day.target);
    const shade = mat(0x2c3a2c, { metal: 0.4, rough: 0.5 });
    const bulb = mat(0xfff1cf, { emissive: 0xffe2a8, glow: 2.5 });
    this.key = null;
    for (const [x, z, main] of [[0, 1.5, true], [-4.5, -2.5, false], [4.5, -2.5, false]]) {
      const lamp = new THREE.Group();
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.9, 0.7, 10, 1, true), shade);
      cone.material.side = THREE.DoubleSide;
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), bulb);
      b.position.y = -0.25;
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 3, 4), shade);
      cord.position.y = 1.8;
      lamp.add(cone, b, cord);
      lamp.position.set(x, 8.6, z);
      this.scene.add(lamp);
      const spot = new THREE.SpotLight(0xffe4b8, main ? 230 : 110, 30, main ? 0.62 : 0.55, 0.6, 1.5);
      spot.position.set(x, 8.3, z);
      spot.target.position.set(0, 0.5, 0);
      if (main) {
        spot.castShadow = true;
        spot.shadow.mapSize.set(2048, 2048);
        spot.shadow.bias = -0.0004;
        spot.shadow.normalBias = 0.03;
      }
      this.scene.add(spot, spot.target);
    }
    // The turntable: a steel disc flush with the floor, with a ring of lights round its edge.
    this.spin = new THREE.Group();
    this.scene.add(this.spin);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(5.6, 5.6, 0.14, 48), mat(0x3e423c, { metal: 0.6, rough: 0.45 }));
    disc.position.y = 0.05;
    disc.receiveShadow = true;
    this.spin.add(disc);
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 4.6), mat(0x2b2e29, { metal: 0.6 }));
      plate.position.set(Math.cos(a) * 2.9, 0.13, Math.sin(a) * 2.9);
      plate.rotation.y = -a + Math.PI / 2;
      this.spin.add(plate);
    }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(5.75, 0.08, 6, 64), mat(0xffd27a, { emissive: 0xffc25a, glow: 1.6 }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.06;
    this.scene.add(ring);
    this.holder = new THREE.Group();
    this.spin.add(this.holder);

    this.size = new THREE.Vector3(4, 2.5, 7);
    this.radius = 4;
    this.focus = null;
    this.zoom = 0;
    this.shift = 0; // fraction of the screen width the tank moves left (room for a side panel)
    this.shiftNow = 0;
    this.t = 0;
    this.idle = 9;
    this.anim = 1;
    this.drag = null;
    this.el = null;
    this.tmp = new THREE.Vector3();
    this.onDown = (e) => {
      if (e.target !== this.el) return; // only the bare garage, not buttons and panels over it
      this.drag = { x: e.clientX, id: e.pointerId };
      this.el.setPointerCapture?.(e.pointerId);
    };
    this.onMove = (e) => {
      if (!this.drag || e.pointerId !== this.drag.id) return;
      this.spin.rotation.y += (e.clientX - this.drag.x) * 0.01;
      this.drag.x = e.clientX;
      this.idle = 0;
    };
    this.onUp = () => (this.drag = null);
  }

  // Drag-to-turn on this page element (the active story screen).
  attach(el) {
    if (el === this.el) return;
    if (this.el) for (const [k, f] of this.handlers()) this.el.removeEventListener(k, f);
    this.el = el;
    if (el) for (const [k, f] of this.handlers()) el.addEventListener(k, f);
  }

  handlers() {
    return [['pointerdown', this.onDown], ['pointermove', this.onMove], ['pointerup', this.onUp], ['pointercancel', this.onUp]];
  }

  // key: identifies the model, paint and fitted parts; build() returns the tank's Object3D.
  setTank(key, build) {
    if (key === this.key) return;
    this.key = key;
    this.holder.traverse((o) => o.geometry?.dispose());
    this.holder.clear();
    const obj = build();
    obj.position.set(0, 0, 0);
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    box.getSize(this.size);
    const c = box.getCenter(new THREE.Vector3());
    obj.position.set(-c.x, 0.12 - box.min.y, -c.z);
    obj.traverse((o) => {
      if (o.isMesh) o.castShadow = o.receiveShadow = true;
    });
    this.holder.add(obj);
    this.radius = Math.max(2.5, Math.hypot(this.size.x, this.size.z) / 2);
    this.anim = 0;
  }

  update(dt) {
    this.t += dt;
    this.idle += dt;
    this.anim = Math.min(1, this.anim + dt * 2.5);
    this.zoom += ((this.focus ? 1 : 0) - this.zoom) * Math.min(1, dt * 3.5);
    this.shiftNow += (this.shift - this.shiftNow) * Math.min(1, dt * 4);
    if (this.focus && !this.drag) {
      // Turn the part towards the camera, the short way round.
      const f = this.focus;
      const want = f.x === 0 && Math.abs(f.z) < 0.25 ? 0.75 : -Math.atan2(f.x, f.z) + 0.35;
      const d = Math.atan2(Math.sin(want - this.spin.rotation.y), Math.cos(want - this.spin.rotation.y));
      this.spin.rotation.y += d * Math.min(1, dt * 3);
    } else if (!this.drag && this.idle > 1.5) this.spin.rotation.y += dt * 0.16;
    // A freshly bought or refitted tank settles onto the turntable.
    const k = 1 - (1 - this.anim) ** 3;
    this.holder.position.y = (1 - k) * 1.2;
  }

  // A point on the tank (fractions of its half-width, height and half-length) in the world.
  partPoint(f) {
    const p = this.tmp.set((f.x * this.size.x) / 2, 0.12 + f.y * this.size.y, (f.z * this.size.z) / 2);
    return p.applyAxisAngle(UP, this.spin.rotation.y);
  }

  // Where a part shows on screen, in CSS pixels, and whether it faces the camera.
  screenPoint(f) {
    const p = this.partPoint(f).clone();
    const out = new THREE.Vector3(p.x, 0, p.z);
    const toCam = this.camera.position.clone().sub(p);
    const facing = out.lengthSq() < 0.05 || out.dot(toCam) > -0.2 * out.length() * toCam.length();
    p.project(this.camera);
    return { x: ((p.x + 1) / 2) * innerWidth, y: ((1 - p.y) / 2) * innerHeight, facing };
  }

  render(renderer) {
    const size = renderer.getSize(new THREE.Vector2());
    const cam = this.camera;
    cam.aspect = size.x / size.y;
    // Low at the front three-quarter, far enough back for the whole tank, drifting a little.
    // Tank about half the screen across, camera at hull height: the car-showroom view.
    const half = Math.tan((FOV / 2) * (Math.PI / 180));
    const wide = (this.radius * 1.4) / (half * Math.min(1.6, cam.aspect));
    const dist = Math.min(22, Math.max(10.5, wide)) * (1 - 0.5 * this.zoom);
    const look = new THREE.Vector3(0, this.size.y * 0.4, 0);
    if (this.zoom > 0.001 && this.focus) look.lerp(this.partPoint(this.focus), this.zoom);
    const yaw = 0.5 + Math.sin(this.t * 0.11) * 0.04;
    const camY = this.size.y * 0.55 + 0.35 + 1.2 * this.zoom;
    cam.position.set(look.x + Math.sin(yaw) * dist, camY, look.z + Math.cos(yaw) * dist);
    cam.lookAt(look);
    cam.setViewOffset(size.x, size.y, this.shiftNow * size.x, 0, size.x, size.y);
    cam.updateProjectionMatrix();
    renderer.render(this.scene, cam);
  }
}
