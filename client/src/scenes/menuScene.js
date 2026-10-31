import * as THREE from 'three';
import { createNoise2D, fbm, mulberry32 } from '../../../shared/noise.js';
import { buildTank } from '../models/tanks.js';
import { buildSoldier } from '../models/infantry.js';
import { quality } from '../settings.js';

// Slowly rotating low-poly battlefield behind the menus. In lobby mode the camera
// moves in on a showcase tank that reflects the host's current tank choice.

const SIZE = 420;
const SEG = 70;

function terrainHeight(noise, x, z) {
  const d = Math.hypot(x, z);
  const flat = Math.min(1, Math.max(0, (d - 25) / 60)); // flat clearing in the centre
  return fbm(noise, x / 140, z / 140, 4) * 18 * flat + Math.max(0, d - 150) * 0.12;
}

function buildTerrain(noise) {
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG).toNonIndexed();
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, terrainHeight(noise, x, z));
  }
  // Colour per triangle for the faceted look.
  for (let i = 0; i < pos.count; i += 3) {
    const y = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
    const n = noise(pos.getX(i) / 30, pos.getZ(i) / 30);
    if (y > 14) c.setHSL(0.1, 0.12, 0.42 + n * 0.04);
    else if (n > 0.45) c.setHSL(0.08, 0.3, 0.3); // mud patches
    else c.setHSL(0.2 + n * 0.03, 0.35, 0.32 + n * 0.05);
    for (let k = 0; k < 3; k++) c.toArray(colors, (i + k) * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }));
  mesh.receiveShadow = true;
  return mesh;
}

function buildForest(noise, rand) {
  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 2, 5);
  trunkGeo.translate(0, 1, 0);
  const crownGeo = new THREE.ConeGeometry(2.2, 6, 6);
  crownGeo.translate(0, 5, 0);
  const count = Math.floor(260 * quality().trees);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x4a3626, flatShading: true }), count);
  const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ color: 0x2f4a2a, flatShading: true }), count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  let n = 0;
  for (let tries = 0; n < count && tries < count * 20; tries++) {
    const x = (rand() - 0.5) * SIZE * 0.95;
    const z = (rand() - 0.5) * SIZE * 0.95;
    if (Math.hypot(x, z) < 55) continue;
    if (noise(x / 90 + 10, z / 90) < 0.1) continue; // clump into forests
    const sc = 0.7 + rand() * 0.7;
    p.set(x, terrainHeight(noise, x, z) - 0.2, z);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI);
    s.set(sc, sc * (0.85 + rand() * 0.4), sc);
    m.compose(p, q, s);
    trunks.setMatrixAt(n, m);
    crowns.setMatrixAt(n, m);
    n++;
  }
  trunks.count = crowns.count = n;
  for (const im of [trunks, crowns]) {
    im.castShadow = true;
    im.receiveShadow = true;
  }
  return [trunks, crowns];
}

function buildProps(noise, rand) {
  const g = new THREE.Group();
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x8a8578, flatShading: true });
  const sandMat = new THREE.MeshStandardMaterial({ color: 0x9c8a62, flatShading: true });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x5c4630, flatShading: true });
  // Ruined houses on the ring around the clearing
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + rand();
    const r = 70 + rand() * 40;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const y = terrainHeight(noise, x, z);
    const house = new THREE.Group();
    const w = 6 + rand() * 4;
    const d = 5 + rand() * 3;
    const walls = [
      [w, 4 + rand() * 2, 0.5, 0, d / 2],
      [w * (0.4 + rand() * 0.6), 2 + rand() * 3, 0.5, 0, -d / 2],
      [0.5, 3 + rand() * 2, d, w / 2, 0],
    ];
    for (const [ww, hh, dd, xx, zz] of walls) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(ww, hh, dd), stoneMat);
      m.position.set(xx, hh / 2, zz);
      m.castShadow = m.receiveShadow = true;
      house.add(m);
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(w * 0.6, 0.3, d * 1.1), woodMat);
    roof.position.set(-w * 0.1, 3.6, 0);
    roof.rotation.z = 0.5;
    roof.castShadow = true;
    house.add(roof);
    house.position.set(x, y - 0.3, z);
    house.rotation.y = rand() * Math.PI;
    g.add(house);
  }
  // Sandbag walls around the showcase (hidden in the lobby, where the garage stands)
  const bags = new THREE.Group();
  g.add(bags);
  const bagGeo = new THREE.BoxGeometry(1.1, 0.45, 0.6);
  for (let ring = 0; ring < 22; ring++) {
    const a = (ring / 22) * Math.PI * 2;
    if (Math.abs(Math.sin(a)) > 0.92) continue;
    for (let row = 0; row < 2; row++) {
      const b = new THREE.Mesh(bagGeo, sandMat);
      b.position.set(Math.cos(a) * 16, 0.22 + row * 0.42, Math.sin(a) * 16);
      b.rotation.y = -a + Math.PI / 2 + row * 0.1;
      b.castShadow = b.receiveShadow = true;
      bags.add(b);
    }
  }
  g.userData.ring = bags;
  return g;
}

// Open-fronted vehicle garage the lobby crews line up in.
function buildGarage() {
  const g = new THREE.Group();
  const wall = new THREE.MeshStandardMaterial({ color: 0x6f6a5c, flatShading: true });
  const steel = new THREE.MeshStandardMaterial({ color: 0x3d413a, flatShading: true });
  const floor = new THREE.MeshStandardMaterial({ color: 0x55524a, flatShading: true });
  const W = 64, D = 22, H = 10;
  const add = (geo, mat, x, y, z, ry = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    return m;
  };
  add(new THREE.BoxGeometry(W, 0.2, D), floor, 0, 0.1, -D / 2 + 9);
  add(new THREE.BoxGeometry(W, H, 0.6), wall, 0, H / 2, -D + 9);
  for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.6, H, D), wall, sx * W / 2, H / 2, -D / 2 + 9);
  for (const sx of [-1, 1]) {
    const roof = add(new THREE.BoxGeometry(W / 2 + 1, 0.35, D + 1), steel, sx * W / 4, H + 1.4, -D / 2 + 9);
    roof.rotation.z = -sx * 0.12;
  }
  for (let i = 0; i <= 8; i++) add(new THREE.BoxGeometry(0.4, H, 0.4), steel, -W / 2 + (W / 8) * i, H / 2, 8.6);
  // Let the low sun in under the roof and hang a few work lamps.
  g.traverse((o) => {
    if (o.isMesh && o.position.y > H) o.castShadow = false;
  });
  for (const x of [-22, 0, 22]) {
    const lamp = new THREE.PointLight(0xffe2b0, 60, 40, 1.4);
    lamp.position.set(x, H - 1, 0);
    g.add(lamp);
  }
  // Painted bay lines on the floor, one per crew.
  const line = new THREE.MeshStandardMaterial({ color: 0xd9c46a, flatShading: true });
  for (let i = 0; i <= 5; i++) add(new THREE.BoxGeometry(0.25, 0.05, 14), line, (i - 2.5) * 11, 0.22, -2);
  g.visible = false;
  return g;
}

// Canvas-text sprite for names above the lobby crews.
function labelSprite(text, color = '#f4e8c8') {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d');
  ctx.font = 'bold 30px Rajdhani, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.strokeText(text, 128, 32);
  ctx.fillStyle = color;
  ctx.fillText(text, 128, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set(4, 1, 1);
  sp.renderOrder = 10;
  return sp;
}

export class MenuScene {
  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xc9a77c);
    this.scene.fog = new THREE.Fog(0xc9a77c, 120, 380);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.5, 1000);
    this.t = 0;
    this.mode = 'menu';
    this.blend = 0; // 0 = wide orbit, 1 = showcase close-up

    const noise = createNoise2D(1337);
    const rand = mulberry32(42);

    const hemi = new THREE.HemisphereLight(0xffe2b8, 0x3a3a28, 0.9);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffc98a, 2.6);
    sun.position.set(-120, 70, -60);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 10, far: 400 });
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);

    this.scene.add(buildTerrain(noise));
    for (const m of buildForest(noise, rand)) this.scene.add(m);
    const props = buildProps(noise, rand);
    this.ring = props.userData.ring;
    this.scene.add(props);
    this.garage = buildGarage();
    this.scene.add(this.garage);
    this.lineup = new THREE.Group();
    this.scene.add(this.lineup);
    this.lineupKey = '';
    this.crewCount = 1;

    // Background tanks fighting at a distance.
    this.extras = [];
    const spots = [
      ['heavy', 'blue', -48, 30, 0.6],
      ['light', 'blue', -35, -40, 1.2],
      ['medium', 'red', 55, -20, -2.3],
      ['heavy', 'red', 40, 45, -2.0],
    ];
    for (const [type, team, x, z, rot] of spots) {
      const t = buildTank(type, team);
      t.group.position.set(x, terrainHeight(noise, x, z), z);
      t.group.rotation.y = rot;
      this.scene.add(t.group);
      this.extras.push(t);
    }

    // Smoke columns
    this.smoke = [];
    const smokeMat = new THREE.MeshStandardMaterial({ color: 0x3a3632, flatShading: true, transparent: true, opacity: 0.55 });
    const puffGeo = new THREE.IcosahedronGeometry(3, 0);
    for (const [x, z] of [[-150, 90], [160, -60], [40, 170]]) {
      for (let i = 0; i < 9; i++) {
        const m = new THREE.Mesh(puffGeo, smokeMat);
        m.userData = { x, z, base: terrainHeight(noise, x, z), phase: i / 9 };
        this.scene.add(m);
        this.smoke.push(m);
      }
    }

    this.showcase = null;
    this.setShowcase('medium');
  }

  setShowcase(type) {
    if (this.showcase?.type === type) return;
    if (this.showcase) this.scene.remove(this.showcase.group);
    this.showcase = buildTank(type, 'blue');
    this.scene.add(this.showcase.group);
  }

  // Lobby: every crew's tank in its garage bay, crew standing in front with names above.
  setCrews(state) {
    const used = state.crews.filter((c) => c.driver != null || c.gunner != null);
    const name = (id) => state.players.find((p) => p.id === id)?.name ?? null;
    const team = (c) => (state.mode === 'fortress' ? 'blue' : c.team);
    const key = JSON.stringify(used.map((c) => [c.id, c.tank, team(c), name(c.driver), name(c.gunner)]));
    if (key === this.lineupKey) return;
    this.lineupKey = key;
    this.lineup.clear();
    this.crewCount = Math.max(1, used.length);
    used.forEach((c, i) => {
      const x = (i - (used.length - 1) / 2) * 11;
      const tank = buildTank(c.tank, team(c));
      tank.group.position.set(x, 0.2, -2);
      tank.turret.rotation.y = (i % 2 ? 1 : -1) * 0.25;
      this.lineup.add(tank.group);
      const tag = labelSprite(`TANK ${c.id + 1}`, team(c) === 'blue' ? '#8fc4f5' : '#f39a90');
      tag.position.set(x, 5.2, -2);
      this.lineup.add(tag);
      for (const [role, dx] of [['driver', -1.6], ['gunner', 1.6]]) {
        const n = name(c[role]);
        if (!n) continue;
        const s = buildSoldier(team(c), 'crew');
        s.group.position.set(x + dx, 0.2, 4.2);
        s.group.rotation.y = Math.PI * 0.02 * dx;
        this.lineup.add(s.group);
        const label = labelSprite(n);
        label.position.set(x + dx, 2.55, 4.2);
        label.scale.set(3.2, 0.8, 1);
        this.lineup.add(label);
      }
    });
  }

  setMode(mode) {
    this.mode = mode;
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  update(dt) {
    this.t += dt;
    const target = this.mode === 'lobby' ? 1 : 0;
    this.blend += (target - this.blend) * Math.min(1, dt * 2);
    const b = this.blend * this.blend * (3 - 2 * this.blend);

    const angle = this.t * 0.05;
    const radius = 85;
    // Wide orbit in the menu; in the lobby, a slow drift in front of the garage bays.
    const orbit = new THREE.Vector3(Math.cos(angle) * radius, 32, Math.sin(angle) * radius);
    const span = this.crewCount * 11;
    const front = new THREE.Vector3(Math.sin(this.t * 0.15) * 3, 6 + span * 0.08, 14 + span * 0.55);
    this.camera.position.lerpVectors(orbit, front, b);
    // In the main menu the battlefield sits right-of-centre, clear of the menu panel.
    const look = new THREE.Vector3(0, 2 - b * 0.4, -b * 1.5);
    this.camera.lookAt(look);
    const inLobby = this.blend > 0.5;
    this.garage.visible = inLobby;
    this.lineup.visible = inLobby;
    this.ring.visible = !inLobby;
    if (b < 0.99) {
      const shift = (1 - b) * 0.16 * (this.camera.aspect > 1 ? 1 : 0);
      this.camera.setViewOffset(1000, 1000, -shift * 1000, 0, 1000, 1000);
    } else {
      this.camera.clearViewOffset();
    }

    // Showcase turret sweeps lazily.
    if (this.showcase) {
      this.showcase.group.position.z = inLobby ? -2 : 0;
      // Before anyone is seated, the lobby keeps the single showcase tank.
      this.showcase.group.visible = !inLobby || !this.lineup.children.length;
      this.showcase.turret.rotation.y = Math.sin(this.t * 0.4) * 0.6;
      this.showcase.gun.rotation.x = -0.05 - Math.sin(this.t * 0.3) * 0.05;
    }
    for (const [i, e] of this.extras.entries()) e.turret.rotation.y = Math.sin(this.t * 0.3 + i) * 0.8;
    for (const m of this.smoke) {
      const u = (m.userData.phase + this.t * 0.04) % 1;
      m.position.set(m.userData.x + u * 18, m.userData.base + 2 + u * 45, m.userData.z + u * 6);
      m.scale.setScalar(0.6 + u * 2.6);
      m.rotation.set(u * 3, u * 2, 0);
    }
  }

  render(renderer) {
    renderer.render(this.scene, this.camera);
  }
}
