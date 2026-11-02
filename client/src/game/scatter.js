import * as THREE from 'three';
import { heightAt } from '../../../shared/map.js';

// Instanced scatter layer with distance LOD.
//
// All items of one kind live in a spatial grid. Each layer owns one InstancedMesh for
// the detailed model (filled with items within `radius` of the camera) and optionally
// one for a cheap far model (items between `radius` and `farRadius`). The instance
// buffers are only refilled when the camera has moved a few metres, so thousands of
// grass tufts cost one draw call and almost no CPU per frame.
//
// Items: { x, y, z, rot, s, sy?, tilt?, color? }. Knockable layers also track
// { fall, fallDir, falling } and animate trees / poles falling over.

const CELL = 40;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

export class Scatter {
  constructor(scene, { geo, mat, items, radius, farGeo = null, farMat = null, farRadius = 0, shadows = false, receive = true, knockable = false, knockRadius = 2.4, maxFall = 1.45 }) {
    this.items = items;
    this.radius = radius;
    this.farRadius = farRadius;
    this.knockable = knockable;
    this.knockRadius = knockRadius;
    this.maxFall = maxFall;
    this.last = new THREE.Vector3(1e9, 0, 1e9);
    this.dirty = true;

    // Cached matrices + colours per item so refills are plain array copies.
    this.mats = new Float32Array(items.length * 16);
    this.cols = items.some((i) => i.color) ? new Float32Array(items.length * 3) : null;
    items.forEach((it, i) => this.writeItem(i));

    this.cells = new Map();
    items.forEach((it, i) => {
      const k = cellKey(it.x, it.z);
      if (!this.cells.has(k)) this.cells.set(k, []);
      this.cells.get(k).push(i);
    });

    const nearMax = Math.min(items.length, estimate(items, radius));
    this.near = new THREE.InstancedMesh(geo, mat, Math.max(1, nearMax));
    this.near.count = 0;
    this.near.castShadow = shadows;
    this.near.receiveShadow = receive;
    this.near.frustumCulled = false; // bounds change with every refill
    scene.add(this.near);
    if (farGeo) {
      this.far = new THREE.InstancedMesh(farGeo, farMat ?? mat, Math.max(1, Math.min(items.length, estimate(items, farRadius))));
      this.far.count = 0;
      this.far.frustumCulled = false;
      this.far.receiveShadow = receive;
      scene.add(this.far);
    }
    this.slot = new Int32Array(items.length).fill(-1);
  }

  writeItem(i) {
    const it = this.items[i];
    const f = it.fall ?? 0;
    _e.set((it.tilt ?? 0) + Math.cos(it.fallDir ?? 0) * f, it.rot ?? 0, Math.sin(it.fallDir ?? 0) * f);
    _q.setFromEuler(_e);
    _s.set(it.s ?? 1, (it.sy ?? 1) * (it.s ?? 1), it.sz ?? it.s ?? 1);
    _p.set(it.x, it.y, it.z);
    _m.compose(_p, _q, _s);
    _m.toArray(this.mats, i * 16);
    if (this.cols) {
      _c.set(it.color ?? 0xffffff);
      _c.toArray(this.cols, i * 3);
    }
  }

  // Refill instance buffers around the camera when it has moved enough.
  update(cam, force = false) {
    const moved = Math.hypot(cam.x - this.last.x, cam.z - this.last.z);
    if (!force && !this.dirty && moved < Math.max(4, this.radius * 0.08)) return;
    this.last.copy(cam);
    this.dirty = false;
    const outer = Math.max(this.radius, this.farRadius);
    const r2 = this.radius * this.radius;
    const f2 = this.farRadius * this.farRadius;
    const nearArr = this.near.instanceMatrix.array;
    const farArr = this.far?.instanceMatrix.array;
    const nearCap = this.near.instanceMatrix.count;
    const farCap = this.far?.instanceMatrix.count ?? 0;
    let n = 0;
    let fN = 0;
    this.slot.fill(-1);
    const ci0 = Math.floor((cam.x - outer) / CELL), ci1 = Math.floor((cam.x + outer) / CELL);
    const cj0 = Math.floor((cam.z - outer) / CELL), cj1 = Math.floor((cam.z + outer) / CELL);
    for (let ci = ci0; ci <= ci1; ci++) {
      for (let cj = cj0; cj <= cj1; cj++) {
        const list = this.cells.get(ci * 4096 + cj);
        if (!list) continue;
        for (const i of list) {
          const it = this.items[i];
          const dx = it.x - cam.x, dz = it.z - cam.z;
          const d2 = dx * dx + dz * dz;
          if (d2 < r2 && n < nearCap) {
            nearArr.set(this.mats.subarray(i * 16, i * 16 + 16), n * 16);
            if (this.cols) this.setColor(this.near, n, i);
            this.slot[i] = n++;
          } else if (this.far && d2 < f2 && fN < farCap) {
            farArr.set(this.mats.subarray(i * 16, i * 16 + 16), fN * 16);
            if (this.cols) this.setColor(this.far, fN, i);
            fN++;
          }
        }
      }
    }
    this.near.count = n;
    this.near.instanceMatrix.needsUpdate = true;
    if (this.near.instanceColor) this.near.instanceColor.needsUpdate = true;
    if (this.far) {
      this.far.count = fN;
      this.far.instanceMatrix.needsUpdate = true;
      if (this.far.instanceColor) this.far.instanceColor.needsUpdate = true;
    }
  }

  setColor(mesh, slot, i) {
    _c.fromArray(this.cols, i * 3);
    mesh.setColorAt(slot, _c);
  }

  // Tanks push over anything knockable they drive into.
  knock(dt, units) {
    if (!this.knockable) return;
    for (const u of units) {
      const ci = Math.floor(u.x / CELL), cj = Math.floor(u.z / CELL);
      for (let a = -1; a <= 1; a++) {
        for (let b = -1; b <= 1; b++) {
          for (const i of this.cells.get((ci + a) * 4096 + cj + b) ?? []) {
            const it = this.items[i];
            if (it.falling) continue;
            if (Math.abs(it.x - u.x) < 4 && Math.abs(it.z - u.z) < 4 && Math.hypot(it.x - u.x, it.z - u.z) < this.knockRadius * (it.s ?? 1) + 1) {
              it.falling = true;
              it.fall = it.fall ?? 0;
              // Fall away from the tank. writeItem tips the top towards local
              // (-sin d, cos d), so convert the world direction into the item's frame.
              it.fallDir = (it.rot ?? 0) - Math.atan2(it.x - u.x, it.z - u.z);
              (this.fallingList ??= []).push(i);
            }
          }
        }
      }
    }
    if (!this.fallingList?.length) return;
    const still = [];
    let touched = false;
    for (const i of this.fallingList) {
      const it = this.items[i];
      it.fall = Math.min(this.maxFall, it.fall + dt * (0.4 + it.fall * 2.5));
      this.writeItem(i);
      const s = this.slot[i];
      if (s >= 0) {
        this.near.instanceMatrix.array.set(this.mats.subarray(i * 16, i * 16 + 16), s * 16);
        touched = true;
      } else this.dirty = true;
      if (it.fall < this.maxFall) still.push(i);
    }
    this.fallingList = still;
    if (touched) this.near.instanceMatrix.needsUpdate = true;
  }

  dispose(scene) {
    scene.remove(this.near);
    if (this.far) scene.remove(this.far);
  }
}

function cellKey(x, z) {
  return Math.floor(x / CELL) * 4096 + Math.floor(z / CELL);
}

// Upper bound on how many items can be inside `radius` at once (densest neighbourhood).
function estimate(items, radius) {
  if (!radius) return 0;
  const cells = new Map();
  for (const it of items) {
    const k = cellKey(it.x, it.z);
    cells.set(k, (cells.get(k) ?? 0) + 1);
  }
  let max = 0;
  for (const v of cells.values()) max = Math.max(max, v);
  const cellsInRadius = Math.PI * ((radius + CELL) / CELL) ** 2;
  return Math.ceil(Math.min(items.length, max * cellsInRadius * 0.75 + 64));
}

// Merge simple parts into one vertex-coloured geometry for an instanced model.
export function mergeParts(parts) {
  const geos = parts.map(({ geo, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1 }) => {
    const g = (geo.index ? geo.toNonIndexed() : geo.clone());
    if (g.attributes.uv) g.deleteAttribute('uv');
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz)));
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    _c.set(color);
    for (let i = 0; i < n; i++) _c.toArray(col, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  });
  let total = 0;
  for (const g of geos) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  let o = 0;
  for (const g of geos) {
    g.computeVertexNormals();
    pos.set(g.attributes.position.array, o);
    nor.set(g.attributes.normal.array, o);
    col.set(g.attributes.color.array, o);
    o += g.attributes.position.array.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}

// Ground markings (mud, ruts, scorch, craters, puddles): baked into one mesh per map chunk
// with every vertex following the terrain, so nothing cuts into a slope or floats over one.
// Unless `solid`, they draw straight after the terrain without touching the depth buffer,
// so they can never fight with the ground or with each other.
export function bakeOnGround(scene, geo, mat, items, { lift = 0.05, order = 1, solid = false, chunk = 180 } = {}) {
  const src = (geo.index ? geo.toNonIndexed() : geo).attributes;
  const n = src.position.count;
  const groups = new Map();
  for (const it of items) {
    const k = `${Math.floor(it.x / chunk)},${Math.floor(it.z / chunk)}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it);
  }
  const meshes = [];
  for (const list of groups.values()) {
    const pos = new Float32Array(list.length * n * 3);
    const col = src.color ? new Float32Array(list.length * n * 3) : null;
    let o = 0;
    for (const it of list) {
      const c = Math.cos(it.rot ?? 0), sn = Math.sin(it.rot ?? 0);
      const sx = it.s ?? 1, sz = it.sz ?? sx, sy = it.sy ?? 1;
      for (let i = 0; i < n; i++, o += 3) {
        const lx = src.position.getX(i) * sx, lz = src.position.getZ(i) * sz;
        const x = it.x + lx * c + lz * sn, z = it.z - lx * sn + lz * c;
        pos[o] = x;
        pos[o + 1] = heightAt(x, z) + lift + src.position.getY(i) * sy;
        pos[o + 2] = z;
        if (col) {
          col[o] = src.color.getX(i);
          col[o + 1] = src.color.getY(i);
          col[o + 2] = src.color.getZ(i);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    if (col) g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, mat);
    mesh.receiveShadow = true;
    if (!solid) mesh.renderOrder = order;
    scene.add(mesh);
    meshes.push(mesh);
  }
  return meshes;
}
