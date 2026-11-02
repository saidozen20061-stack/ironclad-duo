import * as THREE from 'three';

// The inside of the hull as seen by the driver: walls, fittings, the turret basket
// behind/above with the gunner sitting in it, the gun breech, the shell rack, and
// damage effects (sparks, smoke, flickering lights).
//
// Frame: the driver's head is near (0, 1.08, 0) looking towards +Z (the dashboard).
// +X is the driver's left. The turret axis is at (0, *, TURRET_Z) behind the driver.

const TURRET_Z = -1.3;
const RING_R = 0.9;
const ROOF_Y = 1.8;

const M = {
  wall: new THREE.MeshStandardMaterial({ color: 0x5b624c, flatShading: true, roughness: 0.95, side: THREE.DoubleSide }),
  paint: new THREE.MeshStandardMaterial({ color: 0x8c927a, flatShading: true, roughness: 0.85 }),
  metal: new THREE.MeshStandardMaterial({ color: 0x3c4632, flatShading: true, roughness: 0.8, metalness: 0.3 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x23281d, flatShading: true, roughness: 0.9 }),
  brass: new THREE.MeshStandardMaterial({ color: 0x9a7a3a, flatShading: true, metalness: 0.6, roughness: 0.4 }),
  steel: new THREE.MeshStandardMaterial({ color: 0x6c6e68, flatShading: true, metalness: 0.5, roughness: 0.45 }),
  rubber: new THREE.MeshStandardMaterial({ color: 0x1a1a18, flatShading: true, roughness: 1 }),
  red: new THREE.MeshStandardMaterial({ color: 0xa83020, flatShading: true }),
  leather: new THREE.MeshStandardMaterial({ color: 0x5a3e28, flatShading: true, roughness: 0.9 }),
  olive: new THREE.MeshStandardMaterial({ color: 0x55603f, flatShading: true }),
  trousers: new THREE.MeshStandardMaterial({ color: 0x4d5538, flatShading: true, roughness: 0.95 }),
  boots: new THREE.MeshStandardMaterial({ color: 0x2a2220, flatShading: true, roughness: 0.8 }),
  belt: new THREE.MeshStandardMaterial({ color: 0x3a2c1e, flatShading: true }),
  jacket: new THREE.MeshStandardMaterial({ color: 0x3f4a30, flatShading: true }),
  wire: new THREE.MeshStandardMaterial({ color: 0x202020, flatShading: true }),
  wireRed: new THREE.MeshStandardMaterial({ color: 0x6a1a14, flatShading: true }),
};

function mesh(geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  return m;
}
const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const CY = (r, h, seg = 8, r2 = r) => new THREE.CylinderGeometry(r, r2, h, seg);

// A pipe between two points.
function pipe(a, b, r, mat) {
  const d = new THREE.Vector3().subVectors(b, a);
  const m = new THREE.Mesh(CY(r, d.length(), 6), mat);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return m;
}

export function buildShell(type) {
  // One round: brass case + projectile (AP grey / HE olive with yellow band).
  const big = type === 'heavy' ? 1.45 : type === 'light' ? 0.45 : 1;
  const g = new THREE.Group();
  g.add(mesh(CY(0.045 * big, 0.36 * big, 7), M.brass, 0, 0, 0));
  return { g, big };
}

export class ShellRack {
  constructor(parent, tankType, weapon) {
    this.type = tankType;
    this.weapon = weapon;
    // Light tank: one autocannon magazine of rounds. Others: ready rack of shells.
    this.capacity = weapon.kind === 'autocannon' ? Math.min(12, weapon.magazine) : tankType === 'heavy' ? 6 : 10;
    this.count = this.capacity;
    this.restockT = 0;
    const group = new THREE.Group();
    group.position.set(-0.84, 0.25, -0.15); // driver's right-hand wall, clear of the ribs
    group.rotation.y = Math.PI / 2;
    parent.add(group);

    const big = tankType === 'heavy' ? 1.35 : tankType === 'light' ? 0.5 : 1;
    const span = this.capacity * 0.12 * Math.max(0.75, big);
    // Frame: two rails with clamps.
    for (const y of [0.05, 0.42 * big]) group.add(mesh(B(span + 0.1, 0.03, 0.12), M.metal, 0, y, 0));
    for (const x of [-span / 2 - 0.05, span / 2 + 0.05]) group.add(mesh(B(0.04, 0.5 * big + 0.1, 0.14), M.metal, x, 0.22 * big, 0));
    this.shells = [];
    const caseMat = M.brass;
    const apMat = new THREE.MeshStandardMaterial({ color: 0x7a7c78, flatShading: true, metalness: 0.5 });
    const heMat = new THREE.MeshStandardMaterial({ color: 0x5a6438, flatShading: true });
    const band = new THREE.MeshStandardMaterial({ color: 0xc8a020, flatShading: true });
    for (let i = 0; i < this.capacity; i++) {
      const s = new THREE.Group();
      const he = weapon.shells && i % 3 === 2;
      s.add(mesh(CY(0.05 * big, 0.32 * big, 7), caseMat, 0, 0.16 * big, 0));
      s.add(mesh(CY(0.04 * big, 0.14 * big, 7, 0.05 * big), he ? heMat : apMat, 0, 0.39 * big, 0));
      s.add(mesh(new THREE.ConeGeometry(0.04 * big, 0.08 * big, 7), he ? heMat : apMat, 0, 0.5 * big, 0));
      if (he) s.add(mesh(CY(0.052 * big, 0.02, 7), band, 0, 0.36 * big, 0));
      s.position.set(-span / 2 + (i + 0.5) * (span / this.capacity), 0.02, 0);
      group.add(s);
      this.shells.push(s);
    }
  }

  // Own main-gun shot: a round leaves the rack.
  fired() {
    this.count = Math.max(0, this.count - 1);
    this.restockT = 0;
  }

  refill() {
    this.count = this.capacity;
  }

  update(dt, me) {
    if (this.weapon.kind === 'autocannon') {
      // The magazine in the rack mirrors the gun's magazine and refills on reload.
      this.count = me.mag;
    } else if (this.count < this.capacity) {
      // The crew restocks the ready rack from hull stowage over time.
      this.restockT += dt;
      if (this.restockT > 14) {
        this.restockT = 0;
        this.count++;
      }
    }
    this.shells.forEach((s, i) => (s.visible = i < this.count));
  }
}

// The gunner, seated in the turret basket. Only the lower body is modelled: that's
// what the driver sees when looking up and back through the turret ring.
class GunnerRig {
  constructor(parent, tankType) {
    this.root = new THREE.Group(); // rotates with the turret
    this.root.position.set(0, 0, TURRET_Z);
    parent.add(this.root);
    const r = this.root;

    // Short basket struts hanging below the ring, seat post and seat.
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.5;
      r.add(mesh(B(0.03, 0.3, 0.03), M.steel, Math.cos(a) * (RING_R - 0.06), 1.66, Math.sin(a) * (RING_R - 0.06)));
    }
    const seatX = 0.42;
    r.add(mesh(B(0.06, 0.5, 0.06), M.steel, seatX, 1.45, -0.25));
    r.add(mesh(B(0.38, 0.07, 0.34), M.leather, seatX, 1.72, -0.18));
    r.add(mesh(B(0.36, 0.42, 0.06), M.leather, seatX, 1.98, -0.38, -0.15));
    // Foot rest bar
    r.add(mesh(B(0.5, 0.04, 0.06), M.steel, seatX, 1.2, 0.3));

    // Gun breech in the middle of the turret; slides back when the gun fires.
    const big = tankType === 'heavy' ? 1.35 : tankType === 'light' ? 0.6 : 1;
    this.breech = new THREE.Group();
    this.breech.position.set(-0.05, 2.25, 0.25);
    this.breech.add(mesh(B(0.32 * big, 0.36 * big, 0.8 * big), M.steel, 0, 0, -0.1));
    this.breech.add(mesh(B(0.42 * big, 0.12 * big, 0.5 * big), M.metal, 0, -0.2 * big, 0.1));
    this.breech.add(mesh(B(0.12, 0.12, 0.2), M.brass, 0.18 * big, 0.05, -0.45 * big));
    // Breech ring, opening lever, recoil guards and buffers along the gun.
    this.breech.add(mesh(B(0.38 * big, 0.42 * big, 0.14 * big), M.metal, 0, 0, -0.5 * big));
    this.breech.add(mesh(B(0.04, 0.3 * big, 0.04), M.steel, -0.24 * big, 0.08, -0.48 * big));
    for (const s of [-1, 1]) {
      this.breech.add(mesh(B(0.03, 0.34 * big, 0.75 * big), M.metal, s * 0.26 * big, -0.02, -0.72 * big));
      this.breech.add(mesh(B(0.07, 0.07, 0.62 * big), M.steel, s * 0.15 * big, 0.22 * big, 0.12));
    }
    // Spent-case deflector bag under the breech
    this.breech.add(mesh(B(0.3 * big, 0.25, 0.35), M.olive, 0, -0.38 * big, -0.4 * big));
    r.add(this.breech);

    // Lower body: belt/hips, two legs (thigh -> knee -> shin -> boot).
    this.body = new THREE.Group();
    this.body.position.set(seatX, 1.79, -0.16);
    r.add(this.body);
    this.body.add(mesh(B(0.36, 0.2, 0.26), M.trousers, 0, 0.02, 0));
    this.body.add(mesh(B(0.38, 0.06, 0.28), M.belt, 0, 0.13, 0));
    this.body.add(mesh(B(0.34, 0.32, 0.22), M.jacket, 0, 0.32, -0.03)); // jacket hem, disappears up into the turret
    this.legs = [];
    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(side * 0.09, 0, 0.02);
      this.body.add(hip);
      const thigh = mesh(B(0.14, 0.14, 0.44), M.trousers, 0, 0, 0.2);
      hip.add(thigh);
      const knee = new THREE.Group();
      knee.position.set(0, 0, 0.42);
      hip.add(knee);
      knee.add(mesh(B(0.15, 0.15, 0.15), M.trousers, 0, 0, 0)); // knee
      const shin = mesh(B(0.12, 0.42, 0.13), M.trousers, 0, -0.22, 0);
      knee.add(shin);
      const ankle = new THREE.Group();
      ankle.position.set(0, -0.44, 0);
      knee.add(ankle);
      ankle.add(mesh(B(0.14, 0.16, 0.14), M.boots, 0, 0.02, 0)); // boot shaft
      ankle.add(mesh(B(0.13, 0.08, 0.27), M.boots, 0, -0.07, 0.07)); // sole
      ankle.add(mesh(B(0.135, 0.02, 0.28), M.rubber, 0, -0.115, 0.07));
      this.legs.push({ hip, knee, ankle, side });
    }

    // Upper part of the basket: the turret interior above the ring.
    const basket = new THREE.Mesh(new THREE.CylinderGeometry(RING_R, RING_R, 1.15, 16, 1, true), new THREE.MeshStandardMaterial({ color: 0x4f5642, flatShading: true, side: THREE.BackSide }));
    basket.position.y = ROOF_Y + 0.55;
    r.add(basket);
    r.add(mesh(new THREE.CircleGeometry(RING_R, 16), M.wall, 0, ROOF_Y + 1.12, 0, Math.PI / 2));
    // Ammo ready-box and a periscope on the turret wall.
    r.add(mesh(B(0.3, 0.25, 0.2), M.olive, -0.55, 2.1, -0.5));
    r.add(mesh(B(0.16, 0.22, 0.16), M.dark, 0.42, 2.7, 0.2));

    this.kick = 0; // own shot
    this.jolt = 0; // hit on the tank
    this.lastTy = null;
    this.traverse = 0;
    this.t = 0;
  }

  update(dt, ty, gp, recoilKind) {
    this.t += dt;
    // Turret traverse speed drives foot shuffling.
    if (this.lastTy !== null) {
      let d = ty - this.lastTy;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.traverse += (Math.min(1, Math.abs(d / Math.max(dt, 1e-3)) / 0.6) - this.traverse) * Math.min(1, dt * 6);
    }
    this.lastTy = ty;
    this.root.rotation.y = ty;

    this.kick = Math.max(0, this.kick - dt * 3.2);
    this.jolt = Math.max(0, this.jolt - dt * 2.2);
    const k = this.kick, j = this.jolt;
    // Breech recoil: snaps back, returns slower.
    this.breech.position.z = 0.25 - Math.min(1, k * 1.6) * 0.35;
    this.breech.rotation.x = -gp; // follows gun elevation

    // Aiming: elevating the gun makes the gunner lean back (legs straighten);
    // depressing it pulls the feet in. Kick/jolt shake everything.
    const lean = Math.max(-0.3, Math.min(0.35, gp * 1.6));
    this.body.rotation.x = -lean * 0.4 + Math.sin(this.t * 40) * (k * 0.05 + j * 0.12);
    this.body.position.y = 1.79 + j * 0.05 * Math.sin(this.t * 33);
    for (const leg of this.legs) {
      const shuffle = this.traverse * Math.sin(this.t * 7 + leg.side * 1.6) * 0.25;
      const tap = Math.max(0, Math.sin(this.t * 1.3 + leg.side)) ** 8 * 0.18; // idle foot tap
      leg.hip.rotation.x = 0.05 - lean * 0.6 + shuffle * 0.5 - k * 0.3 + j * Math.sin(this.t * 25 + leg.side) * 0.35;
      leg.hip.rotation.y = leg.side * 0.08 + shuffle * 0.2;
      leg.knee.rotation.x = 0.1 + lean * 1.1 + shuffle + tap + k * 0.45;
      leg.ankle.rotation.x = -0.15 - lean * 0.5 - tap * 0.5;
    }
  }
}

export class InteriorFX {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
    this.sparkMat = new THREE.MeshBasicMaterial({ color: 0xffd060 });
    this.smokeMat = new THREE.MeshStandardMaterial({ color: 0x3a3632, transparent: true, opacity: 0.5, flatShading: true, depthWrite: false });
    this.sparkGeo = new THREE.BoxGeometry(0.012, 0.012, 0.05);
    this.puffGeo = new THREE.IcosahedronGeometry(0.12, 0);
    this.smokeT = 0;
  }

  sparks(pos, n = 18) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this.sparkGeo, this.sparkMat);
      m.position.copy(pos);
      const v = new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 2.5, (Math.random() - 0.5) * 3);
      this.scene.add(m);
      this.items.push({ m, v, life: 0.35 + Math.random() * 0.4, t: 0, kind: 'spark' });
    }
  }

  smoke(pos, n = 1) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this.puffGeo, this.smokeMat.clone());
      m.position.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * 0.3, 0, (Math.random() - 0.5) * 0.3));
      this.scene.add(m);
      this.items.push({ m, v: new THREE.Vector3((Math.random() - 0.5) * 0.15, 0.18 + Math.random() * 0.15, (Math.random() - 0.5) * 0.15), life: 3 + Math.random() * 2, t: 0, kind: 'smoke' });
    }
  }

  // Shells landing close shake dust down from the roof.
  dust(n = 12) {
    this.dustMat ??= new THREE.MeshBasicMaterial({ color: 0xb0a184, transparent: true, opacity: 0.6, depthWrite: false });
    this.dustGeo ??= new THREE.IcosahedronGeometry(0.02, 0);
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this.dustGeo, this.dustMat);
      m.position.set((Math.random() - 0.5) * 1.7, 1.72, -0.8 + (Math.random() - 0.5) * 2.4);
      this.scene.add(m);
      this.items.push({ m, v: new THREE.Vector3((Math.random() - 0.5) * 0.08, -0.25 - Math.random() * 0.5, (Math.random() - 0.5) * 0.08), life: 1.4 + Math.random() * 1.8, t: 0, kind: 'dust' });
    }
  }

  // A random spot on the hull walls/ceiling for damage effects.
  static randomWallPoint() {
    const spots = [
      [0.9, 1.2, 0.6], [-0.9, 1.0, 0.3], [0.6, 1.7, 1.0], [-0.5, 1.6, -0.3], [0.95, 0.6, -0.8], [-0.95, 1.3, -1.6], [0.2, 1.75, 0.9],
    ];
    const s = spots[Math.floor(Math.random() * spots.length)];
    return new THREE.Vector3(...s);
  }

  update(dt, smokeLevel) {
    // Persistent haze when the tank is burning or badly damaged.
    if (smokeLevel > 0) {
      this.smokeT -= dt;
      if (this.smokeT <= 0) {
        this.smokeT = 0.5 / smokeLevel;
        this.smoke(new THREE.Vector3((Math.random() - 0.5) * 1.6, 0.4, -0.6 + (Math.random() - 0.5) * 1.6));
      }
    }
    const keep = [];
    for (const it of this.items) {
      it.t += dt;
      const k = it.t / it.life;
      if (k >= 1) {
        this.scene.remove(it.m);
        if (it.kind === 'smoke') it.m.material.dispose();
        continue;
      }
      if (it.kind === 'dust') {
        it.m.scale.setScalar(1 + k * 1.5);
      } else if (it.kind === 'spark') {
        it.v.y -= 9.8 * dt;
        it.m.lookAt(it.m.position.clone().add(it.v));
      } else {
        it.m.scale.setScalar(1 + k * 4);
        it.m.material.opacity = 0.45 * (1 - k);
        // Smoke pools under the roof.
        if (it.m.position.y > 1.6) it.v.y = 0;
      }
      it.m.position.addScaledVector(it.v, dt);
      keep.push(it);
    }
    this.items = keep;
  }
}

// Static hull interior + the dynamic pieces. Returns handles the driver view animates.
export function buildInterior(scene, tankType, weapon) {
  const s = scene;
  const add = (o) => (s.add(o), o);
  const L = 4.0, Z0 = -2.5, Z1 = 1.5, W = 2.2;
  const zc = (Z0 + Z1) / 2;

  // Hull walls (planes so the roof can have the turret ring opening).
  add(mesh(new THREE.PlaneGeometry(W, L), M.wall, 0, 0, zc, -Math.PI / 2));
  add(mesh(new THREE.PlaneGeometry(L, ROOF_Y), M.wall, W / 2, ROOF_Y / 2, zc, 0, -Math.PI / 2));
  add(mesh(new THREE.PlaneGeometry(L, ROOF_Y), M.wall, -W / 2, ROOF_Y / 2, zc, 0, Math.PI / 2));
  add(mesh(new THREE.PlaneGeometry(W, ROOF_Y), M.wall, 0, ROOF_Y / 2, Z1, 0, Math.PI));
  add(mesh(new THREE.PlaneGeometry(W, ROOF_Y), M.wall, 0, ROOF_Y / 2, Z0));
  // Roof: everything except a square around the turret ring.
  const ringZ0 = TURRET_Z - RING_R - 0.05, ringZ1 = TURRET_Z + RING_R + 0.05;
  add(mesh(new THREE.PlaneGeometry(W, Z1 - ringZ1), M.wall, 0, ROOF_Y, (Z1 + ringZ1) / 2, Math.PI / 2));
  add(mesh(new THREE.PlaneGeometry(W, ringZ0 - Z0), M.wall, 0, ROOF_Y, (Z0 + ringZ0) / 2, Math.PI / 2));
  for (const sx of [-1, 1]) add(mesh(new THREE.PlaneGeometry(W / 2 - RING_R, ringZ1 - ringZ0), M.wall, sx * (RING_R + (W / 2 - RING_R) / 2), ROOF_Y, TURRET_Z, Math.PI / 2));
  // Corner fillers so the square hole reads as a round ring.
  const filler = new THREE.Shape();
  filler.moveTo(-RING_R - 0.05, -RING_R - 0.05);
  filler.lineTo(RING_R + 0.05, -RING_R - 0.05);
  filler.lineTo(RING_R + 0.05, RING_R + 0.05);
  filler.lineTo(-RING_R - 0.05, RING_R + 0.05);
  const hole = new THREE.Path();
  hole.absarc(0, 0, RING_R, 0, Math.PI * 2, true);
  filler.holes.push(hole);
  add(mesh(new THREE.ShapeGeometry(filler, 24), M.wall, 0, ROOF_Y - 0.001, TURRET_Z, Math.PI / 2));
  add(mesh(new THREE.TorusGeometry(RING_R + 0.02, 0.06, 6, 32), M.steel, 0, ROOF_Y - 0.03, TURRET_Z, Math.PI / 2));

  // Sloped glacis inside the front
  add(mesh(B(W, 0.08, 1.3), M.metal, 0, 1.55, 1.05, -0.55));
  // Ribs, rivet rows along the walls and roof
  for (const x of [-0.95, 0.95]) for (const z of [1.0, -0.2, -1.6]) add(mesh(B(0.06, 1.7, 0.1), M.metal, x, 0.9, z));
  const rivet = new THREE.SphereGeometry(0.016, 5, 3);
  for (let i = 0; i < 10; i++) add(mesh(rivet, M.brass, -0.9 + i * 0.2, 1.74, 0.82));
  for (const x of [-1.08, 1.08]) for (let i = 0; i < 16; i++) add(mesh(rivet, M.brass, x, 1.62, 1.35 - i * 0.22));
  for (let i = 0; i < 10; i++) add(mesh(rivet, M.brass, -0.9 + i * 0.2, 0.25, 1.48));

  // Driver's hatch overhead with handle, sealed vision port.
  add(mesh(CY(0.32, 0.06, 12), M.metal, 0.05, 1.77, 0.35));
  add(mesh(B(0.18, 0.05, 0.05), M.brass, 0.22, 1.72, 0.35));
  add(mesh(B(0.04, 0.12, 0.04), M.brass, 0.13, 1.7, 0.35));
  add(mesh(B(0.04, 0.12, 0.04), M.brass, 0.31, 1.7, 0.35));
  add(mesh(B(0.5, 0.12, 0.08), M.dark, 0, 1.42, 0.86, -0.55));
  add(mesh(B(0.56, 0.04, 0.1), M.red, 0, 1.49, 0.83, -0.55)); // "sealed" strap

  // Dashboard console
  add(mesh(B(1.75, 0.62, 0.12), M.metal, 0, 0.82, 0.62, 0.42));
  add(mesh(B(1.8, 0.1, 0.5), M.dark, 0, 0.53, 0.5));
  for (let i = 0; i < 8; i++) add(mesh(B(0.04, 0.03, 0.04), [M.red, M.brass, M.steel][i % 3], -0.7 + i * 0.2, 0.585, 0.32)); // switches

  // Driver's seat (visible when looking down/back).
  add(mesh(B(0.5, 0.08, 0.45), M.leather, 0, 0.42, -0.15));
  add(mesh(B(0.5, 0.55, 0.08), M.leather, 0, 0.72, -0.42, 0.12));
  add(mesh(B(0.06, 0.4, 0.06), M.steel, 0, 0.2, -0.15));

  // Pedals and steering levers
  for (const x of [-0.15, 0.15]) add(mesh(B(0.1, 0.03, 0.2), M.dark, x, 0.12, 0.65, -0.6));
  const levers = [];
  for (const x of [-0.5, 0.5]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.24, 0.3);
    pivot.add(mesh(CY(0.016, 0.42, 6, 0.02), M.metal, 0, 0.21, 0));
    pivot.add(mesh(CY(0.027, 0.1, 6), M.rubber, 0, 0.44, 0));
    pivot.rotation.x = -0.25;
    add(pivot);
    levers.push(pivot);
  }

  // Pipes and wiring along the walls.
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  add(pipe(V(1.02, 1.42, 1.3), V(1.02, 1.42, -1.9), 0.03, M.brass));
  add(pipe(V(1.02, 1.42, -1.9), V(1.02, 0.3, -1.9), 0.03, M.brass));
  add(pipe(V(-1.02, 1.22, 1.2), V(-1.02, 1.22, -1.8), 0.025, M.metal));
  add(pipe(V(0.7, 1.74, 1.3), V(0.7, 1.74, 0.0), 0.018, M.steel));
  for (const [y, mat] of [[1.55, M.wire], [1.5, M.wireRed], [1.46, M.wire]]) add(pipe(V(1.05, y, 1.35), V(1.05, y - 0.15, -1.2), 0.008, mat));
  for (const [y, mat] of [[1.66, M.wire], [1.62, M.wireRed]]) add(pipe(V(-0.4, y, 1.4), V(-1.05, y - 0.2, 0.5), 0.008, mat));
  // Wire loops hanging down a little
  add(pipe(V(-0.2, 1.75, 0.15), V(-0.35, 1.6, 0.0), 0.007, M.wire));
  add(pipe(V(-0.35, 1.6, 0.0), V(-0.55, 1.73, -0.1), 0.007, M.wire));

  // Fire extinguisher (driver's left), radio set, map case, first-aid box.
  add(mesh(CY(0.08, 0.45, 8), M.red, 0.88, 0.25, 0.7));
  add(mesh(CY(0.03, 0.08, 6), M.dark, 0.88, 0.52, 0.7));
  add(mesh(B(0.04, 0.03, 0.2), M.dark, 0.88, 0.55, 0.62));
  add(mesh(B(0.42, 0.28, 0.3), M.olive, 0.8, 1.35, -0.6));
  add(mesh(B(0.3, 0.06, 0.02), M.dark, 0.8, 1.38, -0.44));
  for (let i = 0; i < 3; i++) add(mesh(CY(0.02, 0.02, 6), M.brass, 0.68 + i * 0.1, 1.29, -0.445, Math.PI / 2));
  add(pipe(V(0.8, 1.5, -0.6), V(0.8, 1.79, -0.7), 0.006, M.wire)); // antenna lead
  add(mesh(B(0.04, 0.3, 0.42), M.leather, 1.07, 0.95, 0.2));
  add(mesh(B(0.25, 0.18, 0.12), new THREE.MeshStandardMaterial({ color: 0xd8d0c0, flatShading: true }), 0.85, 0.65, -1.3));
  add(mesh(B(0.1, 0.03, 0.125), M.red, 0.85, 0.65, -1.235));
  add(mesh(B(0.03, 0.1, 0.125), M.red, 0.85, 0.65, -1.235));

  // Small caged lamps (warm light).
  const lampSpots = [[0.45, 1.68, 0.2], [-0.6, 1.6, -1.7]];
  const lampBulbs = [];
  for (const [x, y, z] of lampSpots) {
    add(mesh(B(0.14, 0.04, 0.14), M.dark, x, y + 0.08, z));
    const bulb = add(mesh(new THREE.SphereGeometry(0.04, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe0a0 }), x, y, z));
    for (let i = 0; i < 4; i++) add(mesh(B(0.008, 0.1, 0.008), M.dark, x + Math.cos((i * Math.PI) / 2) * 0.055, y, z + Math.sin((i * Math.PI) / 2) * 0.055));
    lampBulbs.push(bulb);
  }

  // Warning lamps on top of the console.
  const lamps = {};
  ['engine', 'tracks', 'fire'].forEach((name, i) => {
    lamps[name] = add(mesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshStandardMaterial({ color: 0x401010, emissive: 0x000000, flatShading: true }), -0.12 + i * 0.12, 1.12, 0.73));
    add(mesh(CY(0.04, 0.03, 8), M.dark, -0.12 + i * 0.12, 1.09, 0.73));
  });

  const rack = new ShellRack(s, tankType, weapon);
  const rig = new GunnerRig(s, tankType);

  // Lighting: fixed count; intensities are animated for flicker/damage.
  s.add(new THREE.AmbientLight(0x404838, 0.8));
  const lights = lampSpots.map(([x, y, z], i) => {
    const l = new THREE.PointLight(0xffd59a, i === 0 ? 2.2 : 1.4, 4, 1.5);
    l.position.set(x, y - 0.05, z);
    s.add(l);
    return l;
  });
  const basketLight = new THREE.PointLight(0xffd59a, 0.9, 3, 1.6);
  basketLight.position.set(0, 2.5, TURRET_Z);
  s.add(basketLight);
  const glow = new THREE.PointLight(0x60ff9a, 0.9, 1.6, 2);
  glow.position.set(0, 0.95, 0.35);
  s.add(glow);
  const warnLight = new THREE.PointLight(0xff2010, 0, 3, 2);
  warnLight.position.set(0, 1.3, 0.6);
  s.add(warnLight);

  return { levers, lamps, lampBulbs, lights, basketLight, warnLight, rack, rig, fx: new InteriorFX(s) };
}
