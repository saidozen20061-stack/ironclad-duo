import * as THREE from 'three';
import { buildTank } from '../models/tanks.js';
import { SoldierRig } from '../models/rig.js';

// The tank workshop in the picture behind the Windows app's update screen. See client/garage.html.
// The hall runs x -38..38, z -26..26; the camera looks across it at the long tool wall on the left.

const W = 76, D = 52, H = 18;
const SIZE = [2560, 1440];

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d0c0a);
scene.fog = new THREE.Fog(0x2a2620, 45, 130);
const seeded = (() => {
  let s = 20261104;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
})();
const rr = (a, b) => a + seeded() * (b - a);

const mats = new Map();
const mat = (color, opts = {}) => {
  const key = `${color}|${JSON.stringify(opts)}`;
  if (!mats.has(key)) mats.set(key, new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.82, metalness: 0.08, ...opts }));
  return mats.get(key);
};
const STEEL = { metalness: 0.65, roughness: 0.42 };
const put = (geo, m, x, y, z, parent = scene) => {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z);
  o.castShadow = o.receiveShadow = true;
  parent.add(o);
  return o;
};
// A box standing on y.
const box = (w, h, d, color, x, y, z, { ry = 0, rx = 0, rz = 0, opts = {}, parent = scene } = {}) => {
  const o = put(new THREE.BoxGeometry(w, h, d), mat(color, opts), x, y + h / 2, z, parent);
  o.rotation.set(rx, ry, rz);
  return o;
};
const cyl = (rt, rb, h, color, x, y, z, { sides = 14, rx = 0, rz = 0, ry = 0, opts = {}, parent = scene } = {}) => {
  const o = put(new THREE.CylinderGeometry(rt, rb, h, sides), mat(color, opts), x, y, z, parent);
  o.rotation.set(rx, ry, rz);
  return o;
};

function signTexture(draw, w = 1024, h = 512) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
const panel = (w, h, tex, x, y, z, ry = 0) => {
  const o = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, transparent: true }));
  o.position.set(x, y, z);
  o.rotation.y = ry;
  o.receiveShadow = true;
  scene.add(o);
  return o;
};

// ---------- The hall ----------
function hall() {
  // Concrete, poured in slabs, marked by years of work.
  box(W + 4, 0.4, D + 4, 0x4d4b44, 0, -0.4, 0, { opts: { roughness: 0.92 } });
  for (let x = -36; x <= 36; x += 9) box(0.07, 0.015, D, 0x38362f, x, 0, 0);
  for (let z = -24; z <= 24; z += 9) box(W, 0.015, 0.07, 0x38362f, 0, 0, z);
  const stain = new THREE.CircleGeometry(1, 11);
  for (let i = 0; i < 46; i++) {
    const s = new THREE.Mesh(stain, new THREE.MeshStandardMaterial({ color: 0x2b2924, transparent: true, opacity: rr(0.2, 0.5), roughness: 0.35 }));
    s.rotation.x = -Math.PI / 2;
    s.rotation.z = rr(0, 6);
    s.position.set(rr(-34, 34), 0.02, rr(-24, 24));
    s.scale.set(rr(0.25, 1.5), rr(0.2, 1.1), 1);
    s.receiveShadow = true;
    scene.add(s);
  }
  // Bay markings, hazard stripes.
  for (const [x, z, w, d] of [[2, -5, 16, 0.22], [2, 10, 16, 0.22], [-6, 2.5, 0.22, 15], [10, 2.5, 0.22, 15], [-22, -11, 15, 0.22], [-22, 3, 15, 0.22], [24, -11, 13, 0.22], [24, 3, 13, 0.22]]) box(w, 0.02, d, 0xd8b23c, x, 0.01, z);
  for (let i = 0; i < 16; i++) box(1, 0.02, 0.5, i % 2 ? 0xd8b23c : 0x1b1b18, 2 + (i - 7.5) * 1, 0.012, 15, { ry: 0 });
  // Walls: dark paint up to shoulder height, block work above.
  for (const [w, d, x, z] of [[W, 0.8, 0, -D / 2], [0.8, D, -W / 2, 0], [0.8, D, W / 2, 0], [W, 0.8, 0, D / 2]]) {
    box(w, H, d, 0x7d7a6c, x, 0, z);
    box(w + (d < 1 ? 0 : 0.1), 3.4, d + (w < 1 ? 0 : 0.1), 0x32423a, x, 0, z);
    box(w + (d < 1 ? 0 : 0.14), 0.16, d + (w < 1 ? 0 : 0.14), 0xc8a53a, x, 3.4, z);
  }
  // Courses of block.
  for (let y = 4.4; y < H; y += 1.2) {
    box(0.03, 0.05, D, 0x5f5c50, -W / 2 + 0.42, y, 0);
    box(0.03, 0.05, D, 0x5f5c50, W / 2 - 0.42, y, 0);
    box(W, 0.05, 0.03, 0x5f5c50, 0, y, -D / 2 + 0.42);
  }
  // Steel frame.
  const frame = 0x33383a;
  for (let x = -36; x <= 36; x += 12) {
    for (const z of [-D / 2 + 0.8, D / 2 - 0.8]) box(0.9, H, 0.9, frame, x, 0, z, { opts: STEEL });
    box(0.5, 0.9, D, frame, x, H - 1.6, 0, { opts: STEEL });
    // Roof truss.
    box(0.3, 0.3, D, frame, x, H - 4.4, 0, { opts: STEEL });
    for (let k = -3; k <= 3; k++) {
      const z = (k * D) / 7;
      box(0.2, 3, 0.2, frame, x, H - 4.2, z, { rx: k % 2 ? 0.75 : -0.75, opts: STEEL });
    }
  }
  for (let z = -D / 2; z <= D / 2; z += 6.5) box(W, 0.35, 0.3, frame, 0, H - 1, z, { opts: STEEL });
  for (const z of [-D / 2 + 0.8, D / 2 - 0.8]) for (let k = -18; k < 18; k += 12) box(0.9, 0.9, 0.9, frame, k + 6, 9, z, { opts: STEEL });
  // Roof, with long skylights letting the evening in.
  box(W + 2, 0.5, D + 2, 0x22221f, 0, H, 0);
  for (const x of [-30, -18, -6, 6, 18, 30]) {
    const g = new THREE.Mesh(new THREE.BoxGeometry(6, 0.08, D - 9), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.9, 1.5), fog: false }));
    g.position.set(x, H - 0.05, 0);
    scene.add(g);
    for (let z = -D / 2 + 5; z < D / 2 - 4; z += 3.2) box(6, 0.12, 0.12, 0x22221f, x, H - 0.2, z);
  }
  // Great doors at the far end, rolled open on to the yard and the evening.
  const door = new THREE.Mesh(new THREE.PlaneGeometry(23, 12.4), new THREE.MeshBasicMaterial({ map: signTexture((g, w, h) => {
    const sky = g.createLinearGradient(0, 0, 0, h * 0.72);
    sky.addColorStop(0, '#f7d7a4');
    sky.addColorStop(1, '#ffc78a');
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#b69068';
    g.beginPath();
    g.moveTo(0, h * 0.72);
    for (let x = 0; x <= w; x += 60) g.lineTo(x, h * (0.66 + 0.05 * Math.sin(x * 0.012) + 0.02 * Math.sin(x * 0.05)));
    g.lineTo(w, h);
    g.lineTo(0, h);
    g.fill();
    g.fillStyle = '#7a6448';
    g.fillRect(0, h * 0.79, w, h * 0.21);
  }), fog: false }));
  door.position.set(9, 6.2, -D / 2 + 0.46);
  scene.add(door);
  box(1, 13, 1, 0xc8a53a, -3, 0, -D / 2 + 1);
  box(1, 13, 1, 0xc8a53a, 21, 0, -D / 2 + 1);
  box(25, 1, 1, 0xc8a53a, 9, 12.4, -D / 2 + 1);
  for (let i = -5; i <= 5; i++) box(1.6, 12.2, 0.2, i % 2 ? 0x4a5046 : 0x424840, 25 + i * 0.1, 0.1, -D / 2 + 1.2 - Math.abs(i) * 0.02);
  // Rails for a track through the door.
  for (const x of [5, 13]) box(0.28, 0.08, 34, 0x2b2b27, x, 0, -9, { opts: STEEL });
  for (let z = -26; z < 8; z += 1.1) box(9.4, 0.05, 0.28, 0x45392a, 9, 0, z);
}

// ---------- Lights ----------
function lights() {
  scene.add(new THREE.HemisphereLight(0xd9cbb0, 0x46413a, 0.62));
  // Evening through the great door.
  const sun = new THREE.DirectionalLight(0xffb878, 3.2);
  sun.position.set(13, 16, -62);
  sun.target.position.set(4, 0, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  Object.assign(sun.shadow.camera, { left: -44, right: 44, top: 44, bottom: -44, near: 5, far: 130 });
  sun.shadow.bias = -0.0004;
  scene.add(sun, sun.target);
  // Hanging lamps over each bay.
  for (const [x, z, power, shadows] of [[2, 3, 750, true], [-22, -4, 560, true], [24, -4, 520, true], [-28, 16, 360, false], [26, 16, 340, false], [-30, -18, 280, false], [28, -18, 280, false], [2, -18, 260, false]]) {
    const y = 12.4;
    cyl(0.03, 0.03, H - y - 1, 0x1d1d1a, x, (H + y) / 2, z, { sides: 5 });
    const shade = cyl(0.45, 1.25, 0.9, 0x3a4d40, x, y, z, { sides: 14, opts: { side: THREE.DoubleSide } });
    shade.castShadow = false;
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 4, 2.6) }));
    bulb.position.set(x, y - 0.42, z);
    scene.add(bulb);
    const l = new THREE.SpotLight(0xffd9a3, power, 42, 1.1, 0.7, 1.3);
    l.position.set(x, y - 0.5, z);
    l.target.position.set(x, 0, z);
    l.castShadow = shadows;
    l.shadow.mapSize.set(2048, 2048);
    l.shadow.bias = -0.0006;
    scene.add(l, l.target);
  }
  // Work lights washing over the tool wall.
  for (const z of [-19, -8, 3, 14]) {
    const l = new THREE.PointLight(0xffdcb0, 150, 22, 1.5);
    l.position.set(-31, 10, z);
    scene.add(l);
  }
  const backWash = new THREE.PointLight(0xffdcb0, 110, 20, 1.5);
  backWash.position.set(-16, 9.5, -20);
  scene.add(backWash);
  // Pools of glow from the lamps on the air.
  const shaft = new THREE.MeshBasicMaterial({ color: 0xffdfae, transparent: true, opacity: 0.016, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  for (const [x, z] of [[2, 3], [-22, -4], [24, -4]]) for (const k of [1, 0.7, 0.42]) {
    const c = new THREE.Mesh(new THREE.ConeGeometry(9 * k, 12, 20, 1, true), shaft);
    c.position.set(x, 6.2, z);
    scene.add(c);
  }
  // Light shafts through the skylights, and the door.
  const beam = new THREE.MeshBasicMaterial({ color: 0xffd9ac, transparent: true, opacity: 0.018, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide });
  for (const x of [-30, -18, -6, 6, 18, 30]) for (const z of [-14, -5, 4, 13]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(5, H, 7), beam);
    b.position.set(x + 2.5, H / 2, z);
    b.rotation.z = -0.14;
    scene.add(b);
  }
  // Dust in the air.
  const n = 800;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) pos.set([rr(-34, 34), rr(0.3, 15), rr(-24, 20)], i * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffe8c4, size: 0.05, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending })));
}

// ---------- Hand tools, for hanging on the wall. In the XY plane, flat against a wall facing +Z. ----------
function spanner(size, color = 0xaeb4b5) {
  const g = new THREE.Group();
  const m = mat(color, STEEL);
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.075 * size, 0.62 * size, 0.03), m);
  g.add(shaft);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.075 * size, 0.03 * size, 6, 12), m);
  ring.position.y = -0.36 * size;
  g.add(ring);
  // The open end: two jaws.
  for (const s of [-1, 1]) {
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.052 * size, 0.15 * size, 0.03), m);
    jaw.position.set(s * 0.078 * size, 0.36 * size, 0);
    jaw.rotation.z = s * -0.28;
    g.add(jaw);
  }
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.2 * size, 0.06 * size, 0.03), m);
  head.position.y = 0.29 * size;
  g.add(head);
  return g;
}
function hammer(size, head = 0x4c4f50, wood = 0x8a5a2f) {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.06 * size, 0.72 * size, 0.04), mat(wood));
  g.add(shaft);
  const h = new THREE.Mesh(new THREE.BoxGeometry(0.28 * size, 0.13 * size, 0.1), mat(head, STEEL));
  h.position.y = 0.38 * size;
  g.add(h);
  return g;
}
function screwdriver(size, grip) {
  const g = new THREE.Group();
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.035 * size, 0.04 * size, 0.2 * size, 8), mat(grip));
  handle.position.y = 0.22 * size;
  g.add(handle);
  const blade = new THREE.Mesh(new THREE.CylinderGeometry(0.012 * size, 0.012 * size, 0.42 * size, 6), mat(0xb7bcbd, STEEL));
  blade.position.y = -0.09 * size;
  g.add(blade);
  return g;
}
function saw(size) {
  const g = new THREE.Group();
  const shape = new THREE.Shape();
  shape.moveTo(-0.08, 0.3);
  shape.lineTo(0.08, 0.3);
  shape.lineTo(0.03, -0.5);
  shape.lineTo(-0.08, -0.5);
  const blade = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.012, bevelEnabled: false }), mat(0xc2c6c6, STEEL));
  blade.scale.setScalar(size);
  g.add(blade);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.2 * size, 0.2 * size, 0.04), mat(0x7d4e28));
  handle.position.y = 0.38 * size;
  g.add(handle);
  return g;
}
function pliers(size) {
  const g = new THREE.Group();
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.045 * size, 0.5 * size, 0.03), mat(0xb33a2c));
    arm.position.set(s * 0.05 * size, -0.12 * size, 0);
    arm.rotation.z = s * -0.12;
    g.add(arm);
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.04 * size, 0.22 * size, 0.03), mat(0x9ba0a1, STEEL));
    jaw.position.set(s * 0.018 * size, 0.22 * size, 0);
    g.add(jaw);
  }
  return g;
}

// A pegboard with tools and their painted outlines. `place` turns it to face out from a wall.
function toolBoard(w, h, x, y, z, ry, seed = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = ry;
  g.scale.setScalar(1.45);
  scene.add(g);
  box(w + 0.3, h + 0.3, 0.1, 0x2c2a26, 0, -h / 2 - 0.15, 0, { parent: g });
  box(w, h, 0.12, 0xb8a581, 0, -h / 2, 0.02, { parent: g });
  // Peg holes.
  const dots = new THREE.InstancedMesh(new THREE.CircleGeometry(0.018, 6), new THREE.MeshBasicMaterial({ color: 0x3f382c }), Math.ceil(w / 0.16) * Math.ceil(h / 0.16));
  let n = 0;
  const m = new THREE.Matrix4();
  for (let i = 0; i < w / 0.16 - 1; i++) for (let j = 0; j < h / 0.16 - 1; j++) dots.setMatrixAt(n++, m.makeTranslation(-w / 2 + 0.16 + i * 0.16, -h / 2 + 0.16 + j * 0.16, 0.085));
  dots.count = n;
  g.add(dots);
  const hang = (tool, tx, ty, rot = 0) => {
    tool.position.set(tx, ty, 0.14);
    tool.rotation.z = rot;
    tool.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
    });
    g.add(tool);
    box(0.03, 0.03, 0.1, 0x2c2c2a, tx, ty + 0.34, 0.1, { parent: g });
  };
  // Spanners in a row, smallest to biggest.
  const across = Math.floor((w - 0.4) / 0.42);
  for (let i = 0; i < across; i++) hang(spanner(0.75 + (i / across) * 1.2), -w / 2 + 0.4 + i * 0.42, h * 0.2 + (i / across) * 0.08);
  // Under them, everything else.
  const row = [
    () => hammer(1.2), () => hammer(0.9, 0x6f4a2a), () => saw(1.3), () => screwdriver(1.1, 0xc23b2a), () => screwdriver(1.1, 0xd6a72b), () => screwdriver(1.1, 0x2f6da8), () => pliers(1.1),
    () => pliers(0.9), () => hammer(1.4), () => saw(1), () => screwdriver(0.9, 0x2c8a57), () => spanner(2.4, 0x8b9092),
  ];
  const k = Math.floor((w - 0.5) / 0.52);
  for (let i = 0; i < k; i++) hang(row[(i + seed) % row.length](), -w / 2 + 0.45 + i * 0.52, -h * 0.26, rr(-0.04, 0.04));
  return g;
}

// A tank's road wheel: rubber tyre, steel hub, bolts. Axis along local Z.
function roadWheel(r, parent = scene) {
  const g = new THREE.Group();
  parent.add(g);
  const add = (geo, m, z = 0) => {
    const o = new THREE.Mesh(geo, m);
    o.position.z = z;
    o.castShadow = o.receiveShadow = true;
    g.add(o);
    return o;
  };
  const tyre = add(new THREE.CylinderGeometry(r, r, r * 0.42, 20), mat(0x191917, { roughness: 0.95 }));
  tyre.rotation.x = Math.PI / 2;
  const rim = add(new THREE.CylinderGeometry(r * 0.72, r * 0.72, r * 0.46, 18), mat(0x4a5145, STEEL));
  rim.rotation.x = Math.PI / 2;
  const hub = add(new THREE.CylinderGeometry(r * 0.26, r * 0.3, r * 0.6, 10), mat(0x24261f, STEEL));
  hub.rotation.x = Math.PI / 2;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const bolt = add(new THREE.CylinderGeometry(r * 0.05, r * 0.05, r * 0.52, 6), mat(0xa0a4a2, STEEL));
    bolt.rotation.x = Math.PI / 2;
    bolt.position.set(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5, 0);
  }
  return g;
}

// Flat on the floor, in a stack.
function wheelStack(x, z, count, r) {
  for (let i = 0; i < count; i++) {
    const w = roadWheel(r);
    w.rotation.x = Math.PI / 2;
    w.position.set(x + rr(-0.05, 0.05), r * 0.21 + i * r * 0.44, z + rr(-0.05, 0.05));
  }
}

// Length of track, hung in a loop or laid flat.
function trackRun(x, y, z, count, ry, hanging = true) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = ry;
  scene.add(g);
  for (let i = 0; i < count; i++) {
    const a = box(0.86, 0.09, 0.3, 0x26261f, 0, 0, 0, { parent: g, opts: STEEL });
    const b = box(0.3, 0.14, 0.14, 0x3b3a31, 0, 0, 0, { parent: g, opts: STEEL });
    if (hanging) {
      a.position.set(0, -i * 0.34, 0);
      a.rotation.x = Math.PI / 2;
      b.position.set(0, -i * 0.34, 0.08);
    } else {
      a.position.set(0, 0.05, i * 0.34);
      b.position.set(0, 0.13, i * 0.34);
    }
  }
  return g;
}

// ---------- Furniture ----------
function drawers(x, y, z, w, h, d, rows, color, ry = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = ry;
  scene.add(g);
  box(w, h, d, color, 0, 0, 0, { parent: g });
  for (let i = 0; i < rows; i++) {
    const dh = (h - 0.1) / rows;
    box(w - 0.06, dh - 0.04, 0.03, color, 0, 0.05 + i * dh, d / 2 + 0.01, { parent: g, opts: { roughness: 0.5 } });
    box(w * 0.5, 0.035, 0.04, 0xc6c9c8, 0, 0.05 + i * dh + dh * 0.55, d / 2 + 0.04, { parent: g, opts: STEEL });
  }
  return g;
}

function workbench(x, z, length, ry) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = ry;
  scene.add(g);
  const P = { parent: g };
  box(length, 0.14, 1.3, 0x7c552f, 0, 1.0, 0, P);
  box(length - 0.1, 0.05, 1.2, 0x8a6236, 0, 1.14, 0, P);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.14, 1, 0.14, 0x2e3331, (sx * length) / 2.1, 0, sz * 0.55, { ...P, opts: STEEL });
  box(length - 0.3, 0.06, 1.05, 0x4a3a28, 0, 0.32, 0, P);
  // Vice at one end.
  box(0.5, 0.2, 0.35, 0x315d6e, -length / 2 + 0.6, 1.19, 0.3, { ...P, opts: STEEL });
  box(0.52, 0.22, 0.1, 0x3f7388, -length / 2 + 0.6, 1.36, 0.46, { ...P, opts: STEEL });
  box(0.52, 0.22, 0.1, 0x3f7388, -length / 2 + 0.6, 1.36, 0.2, { ...P, opts: STEEL });
  cyl(0.02, 0.02, 0.7, 0xc2c6c6, -length / 2 + 0.6, 1.36, 0.72, { rx: Math.PI / 2, sides: 6, parent: g, opts: STEEL });
  // What's lying about on it.
  box(0.7, 0.34, 0.34, 0xb5352a, -length / 2 + 1.9, 1.19, -0.2, P);
  box(0.72, 0.06, 0.36, 0xc8453a, -length / 2 + 1.9, 1.53, -0.2, P);
  box(0.28, 0.04, 0.04, 0xc2c6c6, -length / 2 + 1.9, 1.59, -0.2, { ...P, opts: STEEL });
  for (let i = 0; i < 4; i++) {
    const s = spanner(rr(1, 1.6));
    s.position.set(-length / 2 + 2.9 + i * 0.5, 1.21, rr(0, 0.45));
    s.rotation.set(-Math.PI / 2, 0, rr(-0.8, 0.8));
    g.add(s);
  }
  cyl(0.11, 0.11, 0.32, 0x2f5f35, length / 2 - 2.8, 1.35, -0.3, { parent: g });
  cyl(0.03, 0.03, 0.2, 0x2f5f35, length / 2 - 2.8, 1.6, -0.3, { sides: 6, parent: g });
  cyl(0.13, 0.13, 0.24, 0x8c1f1a, length / 2 - 2.4, 1.31, -0.1, { parent: g });
  cyl(0.05, 0.045, 0.1, 0xd5d0c2, length / 2 - 1.2, 1.24, 0.4, { parent: g, sides: 10 });
  // Blueprints, weighted down with a spanner.
  const print = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.9), new THREE.MeshStandardMaterial({ map: signTexture((c, w, h) => {
    c.fillStyle = '#21476b';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = '#cfe1ef';
    c.lineWidth = 3;
    c.strokeRect(14, 14, w - 28, h - 28);
    c.strokeRect(120, 200, 680, 130);
    c.strokeRect(330, 120, 280, 80);
    c.beginPath();
    c.moveTo(610, 160);
    c.lineTo(960, 150);
    c.stroke();
    for (let i = 0; i < 7; i++) {
      c.beginPath();
      c.arc(180 + i * 95, 365, 38, 0, 6.3);
      c.stroke();
    }
    c.font = '32px monospace';
    c.fillStyle = '#cfe1ef';
    c.fillText('HEAVY TANK  -  HULL  /  SHEET 4', 60, 470);
  }) }));
  print.rotation.x = -Math.PI / 2;
  print.rotation.z = 0.08;
  print.position.set(0.2, 1.2, 0.1);
  g.add(print);
  // A lamp clamped to the bench.
  cyl(0.02, 0.02, 0.9, 0x2d2d2a, length / 2 - 0.6, 1.62, -0.45, { sides: 6, parent: g });
  const shade = cyl(0.05, 0.16, 0.2, 0x3a4d40, length / 2 - 0.6, 2.05, -0.28, { rx: 0.7, parent: g });
  shade.castShadow = false;
  const glow = new THREE.PointLight(0xffd6a0, 8, 7, 1.6);
  glow.position.set(length / 2 - 0.6, 1.9, -0.1);
  g.add(glow);
  return g;
}

function stool(x, z) {
  cyl(0.24, 0.24, 0.06, 0x7c552f, x, 0.72, z);
  for (let a = 0; a < 3; a++) cyl(0.025, 0.04, 0.72, 0x2c2c28, x + Math.cos(a * 2.1) * 0.14, 0.35, z + Math.sin(a * 2.1) * 0.14, { rz: Math.cos(a * 2.1) * 0.15, rx: -Math.sin(a * 2.1) * 0.15, sides: 6, opts: STEEL });
}

function drum(x, z, color, y = 0, lying = false) {
  const g = new THREE.Group();
  g.position.set(x, y + (lying ? 0.45 : 0.62), z);
  if (lying) g.rotation.set(0, rr(0, 3), Math.PI / 2);
  else g.rotation.y = rr(0, 6);
  scene.add(g);
  cyl(0.45, 0.45, 1.24, color, 0, 0, 0, { sides: 16, parent: g });
  for (const k of [-0.31, 0.31]) cyl(0.47, 0.47, 0.05, 0x24241f, 0, k, 0, { sides: 16, parent: g });
  cyl(0.46, 0.46, 0.015, 0x4b4a43, 0, 0.62, 0, { sides: 16, parent: g });
}

function jerrycan(x, y, z, ry, color = 0x4d5b3a) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = ry;
  scene.add(g);
  box(0.36, 0.48, 0.17, color, 0, 0, 0, { parent: g });
  box(0.16, 0.06, 0.05, 0x24241f, 0, 0.5, 0, { parent: g });
  cyl(0.03, 0.03, 0.07, 0x24241f, 0.1, 0.51, 0, { sides: 6, parent: g });
}

function crate(x, y, z, s, ry, color = 0x7e6339, stencil = false) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = ry;
  scene.add(g);
  box(s, s * 0.72, s * 0.72, color, 0, 0, 0, { parent: g });
  for (const k of [-1, 1]) {
    box(0.07, s * 0.74, s * 0.74, 0x4a3820, (k * s) / 2.2, -0.01, 0, { parent: g });
  }
  box(s * 1.01, 0.06, s * 0.74, 0x4a3820, 0, s * 0.35, 0, { parent: g });
  if (stencil) {
    const tex = signTexture((c, w, h) => {
      c.clearRect(0, 0, w, h);
      c.fillStyle = 'rgba(20,18,14,0.82)';
      c.font = '900 110px Impact, sans-serif';
      c.textAlign = 'center';
      c.fillText(stencil, w / 2, h * 0.62);
    }, 512, 256);
    const p = new THREE.Mesh(new THREE.PlaneGeometry(s * 0.8, s * 0.4), new THREE.MeshStandardMaterial({ map: tex, transparent: true }));
    p.position.set(0, s * 0.36, s * 0.365);
    g.add(p);
  }
}

// Steel shelving against a wall, packed.
function shelving(x, z, length, ry) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = ry;
  scene.add(g);
  const P = { parent: g };
  const rack = 0x3d5266;
  for (let k = 0; k <= Math.round(length / 2.4); k++) for (const zz of [-0.55, 0.55]) box(0.1, 5.4, 0.1, rack, -length / 2 + k * (length / Math.round(length / 2.4)), 0, zz, { ...P, opts: STEEL });
  for (const y of [0.3, 1.6, 2.9, 4.2]) {
    box(length, 0.08, 1.2, rack, 0, y, 0, { ...P, opts: STEEL });
    box(length, 0.12, 0.05, 0xc77a2a, 0, y - 0.04, 0.6, P);
  }
  const shelf = [0.38, 1.68, 2.98, 4.28];
  for (const [j, y] of shelf.entries()) {
    let t = -length / 2 + 0.4;
    while (t < length / 2 - 0.6) {
      const kind = Math.floor(seeded() * 6);
      const zz = rr(-0.22, 0.22);
      if (kind === 0) {
        box(0.72, 0.5, 0.72, 0x7e6339, t + 0.36, y, zz, { ...P, ry: rr(-0.1, 0.1) });
        box(0.74, 0.05, 0.74, 0x4a3820, t + 0.36, y + 0.45, zz, P);
        t += 0.86;
      } else if (kind === 1) {
        box(0.64, 0.46, 0.5, 0x4c5a38, t + 0.32, y, zz, P);
        box(0.08, 0.06, 0.08, 0xb8bcbc, t + 0.32, y + 0.2, zz + 0.27, { ...P, opts: STEEL });
        t += 0.76;
      } else if (kind === 2) {
        for (let c = 0; c < 3; c++) cyl(0.12, 0.12, 0.34, c % 2 ? 0x8c2a22 : 0x2e5a7c, t + 0.14 + c * 0.28, y + 0.17, zz, { parent: g });
        t += 0.94;
      } else if (kind === 3) {
        const w = roadWheel(0.4, g);
        w.position.set(t + 0.3, y + 0.4, zz * 0.3);
        w.rotation.y = 1.2;
        w.rotation.x = 0.1;
        t += 0.74;
      } else if (kind === 4) {
        for (let c = 0; c < 3; c++) box(0.2, 0.42, 0.13, 0x4d5b3a, t + 0.12 + c * 0.25, y, zz, P);
        t += 0.86;
      } else {
        box(0.52, 0.22, 0.32, 0xb5352a, t + 0.26, y, zz, P);
        box(0.3, 0.32, 0.3, 0x9b917c, t + 0.26, y + 0.22, zz, P);
        t += 0.68;
      }
    }
    if (j === 3) box(0.2, 0.01, 0.2, 0xffffff, 0, 5.3, 0, P);
  }
  return g;
}

function ladder(x, z, ry) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = ry;
  scene.add(g);
  for (const s of [-1, 1]) box(0.09, 6.2, 0.09, 0xc99a33, s * 0.28, 0, 0, { parent: g, rx: -0.2 });
  for (let i = 1; i < 12; i++) {
    const y = i * 0.5;
    box(0.5, 0.05, 0.05, 0x8e9091, 0, y, -y * 0.2 + 0.01, { parent: g, opts: STEEL });
  }
}

function welding(x, z) {
  // Gas bottles chained to a trolley, and their hoses.
  for (const [dx, c] of [[-0.26, 0x8b1f1a], [0.26, 0x27486f]]) {
    cyl(0.2, 0.2, 1.7, c, x + dx, 0.95, z);
    cyl(0.07, 0.17, 0.2, c, x + dx, 1.9, z);
    cyl(0.04, 0.04, 0.16, 0xc9aa55, x + dx, 2.06, z, { sides: 6, opts: STEEL });
  }
  box(1, 0.08, 0.5, 0x25251f, x, 0.08, z);
  box(0.08, 1.5, 0.08, 0x25251f, x - 0.48, 0.1, z - 0.2);
  box(0.08, 1.5, 0.08, 0x25251f, x + 0.48, 0.1, z - 0.2);
  box(1, 0.06, 0.05, 0x25251f, x, 1.5, z - 0.2);
  for (const s of [-1, 1]) {
    const w = roadWheel(0.14);
    w.rotation.y = Math.PI / 2;
    w.position.set(x + s * 0.5, 0.14, z);
  }
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(x, 2.04, z), new THREE.Vector3(x + 0.5, 1.2, z + 0.5), new THREE.Vector3(x + 1, 0.05, z + 1), new THREE.Vector3(x + 2, 0.05, z + 1.2), new THREE.Vector3(x + 2.4, 0.05, z + 0.4)]);
  put(new THREE.TubeGeometry(curve, 28, 0.02, 5), mat(0xa8362b), 0, 0, 0);
}

function engineStand(x, z, ry) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = ry;
  scene.add(g);
  const P = { parent: g };
  for (const s of [-1, 1]) {
    box(0.14, 1.1, 0.14, 0x2d3231, s * 1, 0, -0.5, { ...P, opts: STEEL });
    box(0.14, 1.1, 0.14, 0x2d3231, s * 1, 0, 0.5, { ...P, opts: STEEL });
  }
  box(2.3, 0.1, 1.3, 0x2d3231, 0, 1.05, 0, { ...P, opts: STEEL });
  box(2, 0.85, 0.95, 0x40423d, 0, 1.15, 0, { ...P, opts: STEEL });
  for (const zz of [-0.28, 0.28]) for (let i = 0; i < 6; i++) {
    cyl(0.14, 0.14, 0.55, 0x32342f, -0.8 + i * 0.32, 2.2, zz, { parent: g, opts: STEEL });
    for (let f = 0; f < 3; f++) cyl(0.17, 0.17, 0.02, 0x56594f, -0.8 + i * 0.32, 2.03 + f * 0.13, zz, { parent: g, opts: STEEL });
  }
  box(2.05, 0.12, 0.2, 0x8a2e24, 0, 2.5, 0, P);
  cyl(0.08, 0.08, 2, 0x72746d, 0.4, 2, 0.72, { rz: Math.PI / 2, parent: g, opts: STEEL, sides: 8 });
  cyl(0.3, 0.3, 0.1, 0x6b6e6a, -1.08, 1.62, 0, { rz: Math.PI / 2, parent: g, opts: STEEL });
}

function deskCorner() {
  // The foreman's corner: desk, chair, radio, cabinets and a map of the front.
  const x = -30.5, z = 18;
  box(3.2, 0.1, 1.5, 0x5e4427, x, 1, z);
  drawers(x - 1.1, 0, z, 0.9, 1, 1.3, 3, 0x46524a);
  box(0.09, 1, 1.3, 0x46524a, x + 1.5, 0, z);
  box(0.55, 0.42, 0.34, 0x3a4032, x + 0.8, 1.1, z - 0.3);
  cyl(0.04, 0.04, 0.03, 0xc1913a, x + 0.7, 1.32, z - 0.12, { sides: 8, rx: Math.PI / 2 });
  cyl(0.008, 0.008, 0.9, 0x9a9c9c, x + 1, 1.92, z - 0.42, { sides: 5 });
  // Paper, a mug, a lamp.
  for (let i = 0; i < 5; i++) box(0.3, 0.004, 0.42, 0xd8d2bf, x - 0.3 + rr(-0.06, 0.06), 1.05 + i * 0.006, z + rr(-0.04, 0.04), { ry: rr(-0.2, 0.2) });
  cyl(0.05, 0.045, 0.1, 0xd5d0c2, x + 0.25, 1.1, z + 0.3, { sides: 10 });
  cyl(0.02, 0.02, 0.5, 0x2d2d2a, x - 1.2, 1.3, z - 0.4, { sides: 6 });
  cyl(0.05, 0.16, 0.18, 0x3a4d40, x - 1.2, 1.6, z - 0.3, { rx: 0.5 });
  // Chair.
  cyl(0.28, 0.28, 0.07, 0x4a2f1f, x, 0.58, z + 1.1);
  box(0.5, 0.6, 0.06, 0x4a2f1f, x, 0.68, z + 1.36);
  cyl(0.03, 0.03, 0.55, 0x2d2d2a, x, 0.28, z + 1.1, { sides: 6 });
  for (let a = 0; a < 4; a++) box(0.36, 0.04, 0.05, 0x2d2d2a, x + Math.cos(a * 1.57) * 0.17, 0.02, z + 1.1 + Math.sin(a * 1.57) * 0.17, { ry: -a * 1.57 });
  // Filing cabinets.
  for (let i = 0; i < 3; i++) drawers(-W / 2 + 1.1, 0, 21.8 - i * 1.25, 1.1, 2.2, 1.05, 4, 0x4e5a51, Math.PI / 2);
  // Map of the front, on the wall.
  panel(6, 3.6, signTexture((c, w, h) => {
    c.fillStyle = '#c8bb91';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = '#5f7b54';
    c.lineWidth = 3;
    for (let i = 0; i < 9; i++) {
      c.beginPath();
      c.ellipse(rr(100, 900), rr(60, 450), rr(40, 170), rr(25, 90), rr(0, 3), 0, 6.3);
      c.stroke();
    }
    c.strokeStyle = '#4f89b5';
    c.lineWidth = 14;
    c.beginPath();
    c.moveTo(0, h * 0.5);
    c.bezierCurveTo(w * 0.3, h * 0.3, w * 0.6, h * 0.7, w, h * 0.46);
    c.stroke();
    c.lineWidth = 7;
    for (const [col, y0] of [['#2f5fa8', 0.72], ['#b83a2e', 0.26]]) {
      c.strokeStyle = col;
      c.beginPath();
      c.moveTo(0, h * y0);
      for (let x = 0; x <= w; x += 80) c.lineTo(x, h * y0 + Math.sin(x * 0.02) * 22);
      c.stroke();
      c.fillStyle = col;
      for (let k = 0; k < 7; k++) c.fillRect(rr(40, w - 60), h * y0 + rr(-45, 45), 34, 18);
    }
    for (const [x, y, t] of [[0.26, 0.5, 'A'], [0.5, 0.42, 'B'], [0.74, 0.55, 'C']]) {
      c.fillStyle = '#23201a';
      c.font = '900 56px Impact';
      c.fillText(t, w * x, h * y);
    }
    c.strokeStyle = '#3f2f1d';
    c.lineWidth = 14;
    c.strokeRect(0, 0, w, h);
  }), -W / 2 + 0.44, 6.3, 18, Math.PI / 2);
  // Blackboard: the day's jobs.
  panel(4.4, 2.8, signTexture((c, w, h) => {
    c.fillStyle = '#1f2a24';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = '#6a4a2a';
    c.lineWidth = 18;
    c.strokeRect(0, 0, w, h);
    c.fillStyle = '#e4e0d0';
    c.font = '46px "Segoe Print", cursive';
    ['JOBS TODAY', '', 'No. 3   new tracks', 'No. 7   gun mantlet', 'No. 9   engine out', 'No. 12  turret ring', '', 'NEEDS MORE COFFEE'].forEach((t, i) => c.fillText(t, 42, 76 + i * 56));
  }), -W / 2 + 0.44, 6, 9.4, Math.PI / 2);
  // Wall clock.
  const clock = cyl(0.7, 0.7, 0.1, 0xe8e2cd, -W / 2 + 0.5, 11, 18, { rz: Math.PI / 2, sides: 24 });
  clock.castShadow = false;
  box(0.03, 0.42, 0.05, 0x1a1a18, -W / 2 + 0.57, 11, 18);
  box(0.03, 0.3, 0.05, 0x1a1a18, -W / 2 + 0.57, 10.8, 18.1, { rx: 2 });
}

function lockers() {
  // Down the left wall, doors facing the hall.
  const x = -W / 2 + 1;
  for (let i = 0; i < 9; i++) {
    const z = 13.6 - i * 1.1;
    box(0.85, 2.9, 1.04, 0x41574b, x, 0, z);
    box(0.03, 2.75, 0.96, 0x4f6a5c, x + 0.44, 0.08, z);
    for (let v = 0; v < 3; v++) box(0.02, 0.03, 0.5, 0x262b28, x + 0.46, 2.5 - v * 0.08, z);
    box(0.04, 0.2, 0.06, 0xbabdbc, x + 0.47, 1.45, z + 0.3, { opts: STEEL });
  }
}

// Everything that hangs on the walls.
function walls() {
  // Tool boards all along the left wall, at working height.
  toolBoard(7, 2.4, -W / 2 + 0.48, 7.6, -19, Math.PI / 2, 0);
  toolBoard(7, 2.4, -W / 2 + 0.48, 7.6, -8.2, Math.PI / 2, 4);
  toolBoard(7, 2.4, -W / 2 + 0.48, 7.6, 2.6, Math.PI / 2, 8);
  toolBoard(7, 2.4, -16, 7.6, -D / 2 + 0.48, 0, 7);
  // Wheels hung up on pegs, above the boards and down the right wall.
  for (let i = 0; i < 18; i++) {
    const w = roadWheel(i % 3 === 2 ? 0.7 : 0.92);
    w.rotation.y = Math.PI / 2;
    w.position.set(-W / 2 + 0.8, 9.3, -24 + i * 2.2);
  }
  for (let k = 0; k < 2; k++) for (let i = 0; i < 12; i++) {
    const w = roadWheel(k ? 0.62 : 0.86);
    w.rotation.y = -Math.PI / 2;
    w.position.set(W / 2 - 0.75, 7.2 + k * 2.2, -22 + i * 2 + k);
  }
  for (let i = 0; i < 6; i++) {
    const w = roadWheel(0.8);
    w.position.set(-20 + i * 2.3, 8.5, -D / 2 + 0.75);
  }
  // Lengths of track on hooks.
  for (let i = 0; i < 9; i++) trackRun(-W / 2 + 0.7, 15.2, -22 + i * 1.5, 12, Math.PI / 2);
  for (let i = 0; i < 4; i++) trackRun(W / 2 - 0.7, 12.9, 6 + i * 1.5, 12, Math.PI / 2);
  // The workshop's name, on the wall.
  panel(24, 3.3, signTexture((c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.fillStyle = 'rgba(234,226,202,0.78)';
    c.font = '900 200px Impact, "Arial Black", sans-serif';
    c.textAlign = 'center';
    c.fillText('IRONCLAD WORKS', w / 2, 170);
    c.font = '700 54px Impact, sans-serif';
    c.fillStyle = 'rgba(216,178,60,0.8)';
    c.fillText('2ND ARMOURED REPAIR  -  KEEP THEM ROLLING', w / 2, 248);
  }, 2048, 280), -W / 2 + 0.44, 13.2, 9, Math.PI / 2);
  // Team colours: Blue banners, a Red flag taken as a trophy.
  for (const [x, c1] of [[-30, '#2f5fa8'], [-5.2, '#2f5fa8']]) panel(3, 7, signTexture((c, w, h) => {
    c.fillStyle = c1;
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#e8e2cd';
    c.beginPath();
    c.moveTo(w / 2, h * 0.3);
    for (let k = 0; k < 10; k++) {
      const a = -Math.PI / 2 + (k * Math.PI) / 5, r = k % 2 ? 60 : 150;
      c.lineTo(w / 2 + Math.cos(a) * r, h * 0.45 + Math.sin(a) * r);
    }
    c.fill();
    c.fillRect(0, h * 0.9, w, 12);
  }, 512, 1024), x, 10.8, -D / 2 + 0.44, 0);
  panel(4, 2.6, signTexture((c, w, h) => {
    c.fillStyle = '#a22d24';
    c.fillRect(0, 0, w, h);
    c.fillStyle = 'rgba(0,0,0,0.45)';
    for (let i = 0; i < 26; i++) c.fillRect(rr(0, w), rr(0, h), rr(10, 70), rr(6, 40));
    c.fillStyle = '#e8d8c0';
    c.font = '900 120px Impact';
    c.textAlign = 'center';
    c.fillText('CAPTURED', w / 2, h * 0.62);
  }), -W / 2 + 0.44, 12.7, -8, Math.PI / 2);
  // Safety notices.
  for (const [x, t, col] of [[25, 'CHECK YOUR TORQUE', '#d8b23c'], [31, 'NO SMOKING NEAR FUEL', '#b83a2e']]) panel(4.2, 1.5, signTexture((c, w, h) => {
    c.fillStyle = col;
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#16140f';
    c.font = '900 76px Impact';
    c.textAlign = 'center';
    c.fillText(t, w / 2, h / 2 + 28);
  }, 1024, 340), x, 7, -D / 2 + 0.44, 0);
  // Pipes and conduit running along the walls.
  for (const y of [4.3, 4.7]) cyl(0.07, 0.07, D, y < 4.5 ? 0x8a3e2c : 0x4b6271, -W / 2 + 0.6, y, 0, { rx: Math.PI / 2, sides: 8, opts: STEEL });
  for (const y of [4.3, 4.7]) cyl(0.07, 0.07, D, y < 4.5 ? 0x8a3e2c : 0x4b6271, W / 2 - 0.6, y, 0, { rx: Math.PI / 2, sides: 8, opts: STEEL });
  // Fire points.
  for (const [x, z] of [[-W / 2 + 0.7, 5.5], [W / 2 - 0.7, -3]]) {
    cyl(0.16, 0.16, 0.74, 0xb5271f, x, 2.2, z);
    box(0.2, 0.1, 0.14, 0x25241f, x, 2.58, z);
    box(0.1, 1.4, 0.8, 0xb5271f, x + (x < 0 ? -0.1 : 0.1), 1.4, z);
  }
}

// The overhead crane, with a turret in its hook.
function crane() {
  const yellow = 0xd2a12a;
  const y = 12.6;
  for (const x of [-W / 2 + 1.4, W / 2 - 1.4]) box(1, 0.7, D - 2, 0x2a2e2c, x, y - 0.8, 0, { opts: STEEL });
  const z = 2;
  box(W - 3, 1.2, 1, yellow, 0, y, z, { opts: { roughness: 0.55 } });
  box(W - 3, 0.2, 1.4, yellow, 0, y - 0.15, z);
  // Hazard ends.
  for (const x of [-W / 2 + 3, W / 2 - 3]) for (let i = 0; i < 4; i++) box(0.44, 1.21, 1.01, i % 2 ? 0x18181a : 0xd2a12a, x + i * 0.44, y, z);
  const tx = -9;
  box(2.6, 0.9, 1.8, 0x383c38, tx, y - 0.9, z, { opts: STEEL });
  cyl(0.45, 0.45, 2.2, 0x53564f, tx, y - 0.45, z, { rz: Math.PI / 2, sides: 12, opts: STEEL });
  // Chains down to a spreader, and a turret out of a tank.
  const load = 6.6;
  const part = (i) => {
    const link = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.03, 5, 10), mat(0x34373a, STEEL));
    link.scale.y = 1.6;
    link.rotation.y = i % 2 ? Math.PI / 2 : 0;
    return link;
  };
  for (const [dx, dz] of [[-0.5, 0], [0.5, 0]]) for (let i = 0; i < 12; i++) {
    const l = part(i);
    l.position.set(tx + dx, y - 1.1 - i * 0.24, z + dz);
    l.castShadow = true;
    scene.add(l);
  }
  box(3, 0.24, 0.5, yellow, tx, load + 2.1, z);
  for (const dx of [-1.2, 1.2]) for (let i = 0; i < 9; i++) {
    const l = part(i);
    l.position.set(tx + dx, load + 2.05 - i * 0.24, z);
    l.castShadow = true;
    scene.add(l);
  }
  const hook = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.08, 6, 12, 4.4), mat(0x2d2f2f, STEEL));
  hook.position.set(tx, load + 1.75, z);
  hook.castShadow = true;
  scene.add(hook);
  const spare = buildTank('heavy', 'blue');
  if (spare.turret) {
    spare.group.updateMatrixWorld(true);
    const t = spare.turret;
    t.position.set(tx, load - 0.7, z);
    t.rotation.set(0, 0.55, 0);
    scene.add(t);
  }
}

// ---------- Tanks in for work ----------
function tanks() {
  // Hero, under the main lamp, panels off.
  const hero = buildTank('superheavy', 'blue');
  hero.group.position.set(2, 0.05, 2.5);
  hero.group.rotation.y = 0.5;
  if (hero.turret) hero.turret.rotation.y = -0.5;
  scene.add(hero.group);
  // Jacked up with a track off, wheels beside it.
  const lifted = buildTank('medium', 'blue');
  lifted.group.position.set(-22, 1.1, -4);
  lifted.group.rotation.y = 0.15;
  scene.add(lifted.group);
  for (const [x, z] of [[-24.4, -6.6], [-19.6, -6], [-24.4, -1.8], [-19.6, -1.2]]) {
    box(1.1, 0.9, 1.1, 0x3a4232, x, 0, z, { opts: STEEL });
    box(0.75, 0.2, 0.75, 0x26261f, x, 0.9, z);
  }
  trackRun(-29, 0, -8, 24, 0.1, false);
  for (let i = 0; i < 4; i++) {
    const w = roadWheel(0.46);
    w.rotation.y = rr(1, 2);
    w.rotation.x = 0.26;
    w.position.set(-27.5 + rr(-0.2, 0.2), 0.46, -3.5 + i * 0.9);
  }
  // Waiting at the back, by the door.
  const waiting = buildTank('heavy', 'blue');
  waiting.group.position.set(9, 0, -17);
  scene.add(waiting.group);
  // Another under a sheet of work on the right.
  const right = buildTank('destroyer', 'blue');
  right.group.position.set(24, 0, -4);
  right.group.rotation.y = -0.2;
  scene.add(right.group);
  // Spare gun barrel on trestles.
  cyl(0.15, 0.2, 6.6, 0x31362d, 21.5, 1.26, 8, { rz: Math.PI / 2, sides: 12, ry: 0.2, opts: STEEL });
  cyl(0.3, 0.3, 0.8, 0x31362d, 18.4, 1.26, 8.65, { rz: Math.PI / 2, sides: 10, ry: 0.2, opts: STEEL });
  for (const [x, z] of [[19.5, 8.4], [23.5, 7.6]]) {
    box(0.16, 1.1, 1.2, 0x7c552f, x, 0, z, { ry: 0.2 });
    box(0.5, 0.1, 1.3, 0x5e4427, x, 1.04, z, { ry: 0.2 });
  }
}

function floorThings() {
  engineStand(-6.6, 13, 0.8);
  welding(-13, 12);
  wheelStack(-34, -15, 5, 0.86);
  wheelStack(-32.2, -15.6, 3, 0.86);
  wheelStack(-34, -21, 7, 0.72);
  wheelStack(33.5, 15, 6, 0.86);
  wheelStack(31.7, 15.6, 4, 0.72);
  wheelStack(-1, -22, 4, 0.9);
  // A wheel leaning on the wall, another rolled away.
  const lean = roadWheel(0.9);
  lean.position.set(-34.6, 0.9, 1.6);
  lean.rotation.set(0, Math.PI / 2, 0.14);
  const rolled = roadWheel(0.86);
  rolled.position.set(-13.2, 0.86, 2);
  rolled.rotation.set(0.12, 1, 0);

  // Bench down the left wall and at the back, with stools and tool chests.
  workbench(-33.5, -9, 15, Math.PI / 2);
  stool(-31.2, -12);
  stool(-31, -5.4);
  workbench(-13, -24.4, 13, 0);
  stool(-15, -22.6);
  stool(-10.6, -22.5);
  drawers(-31.6, 0, 3, 1.5, 1.5, 0.75, 7, 0xb5352a, 1.1);
  box(1.56, 0.42, 0.82, 0xc8453a, -31.6, 1.5, 3, { ry: 1.1 });
  for (const s of [[-0.6, -0.3], [0.6, -0.3], [-0.6, 0.3], [0.6, 0.3]]) cyl(0.09, 0.09, 0.08, 0x1f1f1b, -31.6 + s[0] * 0.5, 0.05, 3 + s[1], { rz: Math.PI / 2 });
  drawers(-5.4, 0, 20, 1.3, 1.3, 0.7, 5, 0x24567a, -0.4);

  // Racks of supplies down the right wall.
  shelving(W / 2 - 1.5, -17, 14, Math.PI / 2);
  shelving(W / 2 - 1.5, 3.5, 10, Math.PI / 2);
  shelving(29, -D / 2 + 1.5, 12, 0);
  shelving(-28.5, -D / 2 + 1.5, 13, 0);

  lockers();
  deskCorner();
  ladder(-35, -1.5, -Math.PI / 2);

  // Drums and cans.
  for (const [x, z, c] of [[33.8, 9, 0x2f5f35], [32.9, 10.2, 0x2f5f35], [34.2, 10.7, 0x7a2720], [32.9, 11.6, 0x274d70], [34.2, 12.2, 0x2f5f35], [15, -23, 0x274d70], [16.3, -23.6, 0x2f5f35], [-4, -24.5, 0x7a2720], [-30, 11, 0x2f5f35], [-29, 12, 0x7a2720]]) drum(x, z, c);
  drum(11, 13, 0x2f5f35, 0, true);
  for (let i = 0; i < 9; i++) jerrycan(13.2 + (i % 3) * 0.42, 0, 15.6 + Math.floor(i / 3) * 0.36, rr(-0.1, 0.1));
  // Ammunition and spares, stacked.
  crate(28, 0, 11, 2, 0.15, 0x6c5a31, 'SPARES');
  crate(30.3, 0, 11.4, 2, -0.1, 0x6c5a31, '85MM');
  crate(29, 1.44, 11.2, 2, 0.5, 0x7e6339, 'TRACK PINS');
  crate(-20, 0, 20.5, 2.2, 0.3, 0x7e6339, 'FRAGILE');
  crate(-22.5, 0, 21, 1.8, -0.2, 0x5f6b3d, 'OIL');
  crate(-21.1, 1.58, 20.7, 1.8, 0.7, 0x5f6b3d);
  crate(16, 0, -19, 1.8, 0.2, 0x5f6b3d, 'HE');
  crate(16.4, 1.3, -19, 1.6, -0.2, 0x6c5a31);
  // Trolley jack, creeper board with a mechanic's boots sticking out under the tank, bucket and broom.
  box(1, 0.16, 0.42, 0xb5352a, -6, 0.1, 6.5, { ry: 0.5 });
  cyl(0.05, 0.05, 1.5, 0x25241f, -6.5, 0.55, 6.2, { rz: 0.9, ry: 0.5, sides: 6 });
  box(0.7, 0.08, 1.7, 0x7c552f, 8.2, 0.14, 6.8, { ry: 0.5 });
  cyl(0.3, 0.22, 0.42, 0x6a6e6d, -8, 0.21, 16, { opts: { side: THREE.DoubleSide, ...STEEL } });
  cyl(0.02, 0.02, 2.7, 0x8a5a2f, -35, 1.3, 13, { sides: 6, rx: 0.16 });
  box(0.75, 0.3, 0.12, 0xa98d4f, -35, 0, 13.2);
  // Coil of hose and an air line.
  for (let i = 0; i < 4; i++) {
    const t = new THREE.Mesh(new THREE.TorusGeometry(0.55 - i * 0.02, 0.035, 5, 22), mat(0xb0321f));
    t.rotation.x = Math.PI / 2;
    t.position.set(10.5, 0.05 + i * 0.07, 16);
    t.castShadow = true;
    scene.add(t);
  }
}

function people() {
  // Mechanics on the floor: standing at the tank, and talking by the bench.
  for (const [x, z, h] of [[-3.6, 5.6, 1.2], [-27.8, -6, 0.2], [-27, -10, -1.9], [-14.2, 11.6, 1.4], [-12.8, 11.9, -1.8], [-31, 7.6, -1.5], [-20, -19, 0.4]]) {
    const r = new SoldierRig('blue', 'crew');
    r.group.position.set(x, 0.02, z);
    r.group.rotation.y = h;
    for (let i = 0; i < 50; i++) r.update({ dt: 0.1, speed: 0, fwd: 0, side: 0, turn: 0, code: 0, aimPitch: 0, aiming: false, lod: 1, ground: null });
    scene.add(r.group);
  }
}

hall();
lights();
walls();
crane();
tanks();
floorThings();
people();

const camera = new THREE.PerspectiveCamera(48, SIZE[0] / SIZE[1], 0.2, 300);
camera.position.set(15, 5.6, 23.5);
camera.lookAt(-17, 3.7, -7);

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(SIZE[0], SIZE[1], false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.86;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
renderer.render(scene, camera);
renderer.render(scene, camera);
window.__picture = () => renderer.domElement.toDataURL('image/jpeg', 0.88);
