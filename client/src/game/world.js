import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GRID, CELL, HALF, MAP_SIZE, WATER_LEVEL, BRIDGES, BRIDGE_DECK, POINTS, BASES, gridHeight, riverZ, RIVER_HALF_WIDTH, smoothstep } from '../../../shared/map.js';
import { createNoise2D } from '../../../shared/noise.js';
import { distToRoad, fieldAt } from '../../../shared/props.js';
import { quality } from '../settings.js';
import { renderer } from '../render.js';
import { SkyLife } from './sky.js';
import { BASE_FLAG_SPOTS } from './props.js';
import { markHeat, noHeat } from './thermal.js';

// Battlefield fog: distance fog that gets thicker in low ground (valleys, the river) and
// comes in uneven patches across the map. Patched into every material that uses fog.
THREE.ShaderChunk.fog_pars_vertex = `#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorld;
#endif`;
THREE.ShaderChunk.fog_vertex = `#ifdef USE_FOG
  vFogDepth = -mvPosition.z;
  vFogWorld = (inverse(viewMatrix) * vec4(mvPosition.xyz, 1.0)).xyz;
#endif`;
THREE.ShaderChunk.fog_pars_fragment = `#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogWorld;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif`;
THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
  float fogPatch = 0.82 + 0.28 * sin(vFogWorld.x * 0.0071 + 1.3) * sin(vFogWorld.z * 0.0053 + 0.4);
  float fogDist = vFogDepth / fogPatch;
  float fogFactor = smoothstep(fogNear, fogFar, fogDist);
  float fogLow = 1.0 - smoothstep(6.0, 24.0, vFogWorld.y);
  fogFactor = max(fogFactor, smoothstep(fogNear * 0.35, fogFar * 0.62, fogDist) * fogLow * 0.92);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
#endif`;

// The outdoor battlefield scene (what the gunner sees).
const colorNoise = createNoise2D(777);
const dryNoise = createNoise2D(778);

const GROUND = {
  grass: new THREE.Color(),
  dry: new THREE.Color().setHSL(0.13, 0.36, 0.43),
  dirt: new THREE.Color().setHSL(0.085, 0.24, 0.38),
  mud: new THREE.Color().setHSL(0.075, 0.3, 0.22),
  rock: new THREE.Color().setHSL(0.08, 0.07, 0.4),
  sand: new THREE.Color().setHSL(0.11, 0.3, 0.52),
  gravel: new THREE.Color().setHSL(0.09, 0.1, 0.42),
};
const CROPS = {
  wheat: [new THREE.Color(0xb89a48), new THREE.Color(0xa58840)],
  green: [new THREE.Color(0x587a30), new THREE.Color(0x4c6a2a)],
  stubble: [new THREE.Color(0x9c8e60), new THREE.Color(0x8a7c52)],
  plowed: [new THREE.Color(0x4a3a2a), new THREE.Color(0x3a2c20)],
};

export function buildTerrainGeometry() {
  // Non-indexed: every triangle owns its vertices so it can carry a flat colour.
  const tris = GRID * GRID * 2;
  const pos = new Float32Array(tris * 9);
  const col = new Float32Array(tris * 9);
  const c = new THREE.Color();
  let p = 0;
  const push = (i, j) => {
    pos[p] = -HALF + i * CELL;
    pos[p + 1] = gridHeight(i, j);
    pos[p + 2] = -HALF + j * CELL;
    p += 3;
  };
  const colorTri = (o) => {
    const ax = pos[o], ay = pos[o + 1], az = pos[o + 2];
    const by = pos[o + 4], cy = pos[o + 7];
    const cx = (ax + pos[o + 3] + pos[o + 6]) / 3;
    const cz = (az + pos[o + 5] + pos[o + 8]) / 3;
    const y = (ay + by + cy) / 3;
    const steep = Math.max(Math.abs(ay - by), Math.abs(by - cy), Math.abs(ay - cy)) / CELL;
    const n = colorNoise(cx / 40, cz / 40);
    const n2 = colorNoise(cx / 9 + 50, cz / 9);
    const riverD = Math.abs(cz - riverZ(cx));
    const inMap = Math.abs(cx) < 720 && Math.abs(cz) < 720;
    const road = riverD > RIVER_HALF_WIDTH + 2 && inMap ? distToRoad(cx, cz) : 99;
    const field = inMap ? fieldAt(cx, cz) : null;
    const baseD = Math.min(...Object.values(BASES).map((b) => Math.hypot(b.x - cx, b.z - cz)));
    if (y < WATER_LEVEL + 0.4) c.setHSL(0.09, 0.25, 0.22 + n2 * 0.02); // riverbed mud
    else if (road < 3.6) c.setHSL(0.085, 0.24, 0.4 + n2 * 0.03); // dirt road
    else if (field) {
      // Crop rows: alternating stripes across the field.
      const pal = CROPS[field.f.crop];
      c.copy(pal[Math.floor((field.lx + 500) / 2.5) % 2]).multiplyScalar(0.95 + n2 * 0.08);
    } else {
      // Blend grass -> dry grass -> mud -> dirt verge -> river sand -> rock by height,
      // slope and noise.
      GROUND.grass.setHSL(0.2 + n * 0.035, 0.38, 0.3 + n2 * 0.035 + n * 0.02);
      c.copy(GROUND.grass);
      const dry = Math.min(1, smoothstep(14, 42, y) * 0.55 + Math.max(0, dryNoise(cx / 70, cz / 70)) * 0.7);
      c.lerp(GROUND.dry, dry);
      c.lerp(GROUND.mud, smoothstep(0.3, 0.6, -n) * 0.85);
      if (road < 7) c.lerp(GROUND.dirt, 1 - smoothstep(3.6, 7, road));
      if (baseD < 95) c.lerp(GROUND.gravel, (1 - smoothstep(55, 95, baseD)) * 0.7);
      c.lerp(GROUND.sand, (1 - smoothstep(RIVER_HALF_WIDTH + 1, RIVER_HALF_WIDTH + 11, riverD)) * (y < WATER_LEVEL + 3 ? 0.9 : 0.3));
      c.lerp(GROUND.rock, Math.min(1, smoothstep(0.45, 0.85, steep) + smoothstep(52, 68, y)));
      c.multiplyScalar(0.96 + n2 * 0.08);
    }
    for (let k = 0; k < 3; k++) c.toArray(col, o + k * 3);
  };
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      // Triangle 1: (i,j) (i,j+1) (i+1,j)   Triangle 2: (i+1,j+1) (i+1,j) (i,j+1)
      // Winding chosen so faces point up (+Y).
      let o = p;
      push(i, j);
      push(i, j + 1);
      push(i + 1, j);
      colorTri(o);
      o = p;
      push(i + 1, j + 1);
      push(i + 1, j);
      push(i, j + 1);
      colorTri(o);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

function buildSky() {
  const geo = new THREE.SphereGeometry(4000, 24, 12);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { sunDir: { value: new THREE.Vector3() }, fogCol: { value: new THREE.Color() } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform vec3 sunDir; uniform vec3 fogCol; varying vec3 vDir;
      void main(){
        float h = clamp(vDir.y, -0.2, 1.0);
        vec3 horizon = vec3(0.92, 0.72, 0.52);
        vec3 zenith = vec3(0.42, 0.46, 0.5); // smoke-stained
        vec3 col = mix(horizon, zenith, pow(max(h, 0.0), 0.6));
        float s = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
        col += vec3(1.0, 0.75, 0.45) * pow(s, 8.0) * 0.35 + vec3(1.0, 0.9, 0.7) * pow(s, 600.0) * 2.0;
        // The horizon is exactly what fully fogged geometry looks like on screen, so far
        // terrain and tanks melt into the sky instead of standing out as silhouettes.
        vec3 fogged = fogCol;
        #ifdef TONE_MAPPING
          fogged = toneMapping(fogged);
        #endif
        fogged = linearToOutputTexel(vec4(fogged, 1.0)).rgb;
        col = mix(fogged, col, smoothstep(0.02, 0.3, h));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  return new THREE.Mesh(geo, mat);
}

function buildBridge(b) {
  // Everything hangs off the deck: rails stand on its edges, piers reach up into it.
  const stone = new THREE.Color(0x8b8475), wood = new THREE.Color(0x6b5238);
  const len = b.halfLength * 2;
  const DECK_T = 0.6;
  const piece = (w, h, d, x, y, z, color) => {
    const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
    g.deleteAttribute('uv');
    g.translate(x, y, z);
    const col = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < g.attributes.position.count; i++) color.toArray(col, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  };
  const parts = [piece(b.halfWidth * 2 + 0.8, DECK_T, len, 0, BRIDGE_DECK - DECK_T / 2, 0, wood)];
  for (const s of [-1, 1]) parts.push(piece(0.4, 1.0, len, s * (b.halfWidth + 0.2), BRIDGE_DECK + 0.5, 0, stone));
  const pierTop = BRIDGE_DECK - DECK_T + 0.1, pierBottom = -1;
  for (const z of [-10, 0, 10]) parts.push(piece(b.halfWidth * 2 + 1, pierTop - pierBottom, 2.2, 0, (pierTop + pierBottom) / 2, z, stone));
  // The ramped banks run just under the deck, so the deck draws slightly in front of them.
  const mesh = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  mesh.position.set(b.x, 0, b.z);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

function buildPointMarker(pt) {
  // Tall translucent flag pole; colour is updated by the capture system later.
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 9, 5), new THREE.MeshStandardMaterial({ color: 0x555555 }));
  pole.position.y = 4.5;
  g.add(pole);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.5, 8, 3), new THREE.MeshStandardMaterial({ color: 0xdddddd, side: THREE.DoubleSide, flatShading: true }));
  flag.position.set(1.2, 8.1, 0);
  flag.userData.rest = Float32Array.from(flag.geometry.attributes.position.array);
  g.add(flag);
  g.userData.flag = flag;
  return g;
}

// Flags ripple: a travelling wave that grows towards the free end.
function waveFlag(flag, t, phase) {
  const pos = flag.geometry.attributes.position;
  const rest = flag.userData.rest;
  for (let i = 0; i < pos.count; i++) {
    const x = rest[i * 3];
    const k = (x + 1.2) / 2.4;
    pos.setZ(i, Math.sin(t * 6 + phase - x * 2.6) * 0.32 * k + Math.sin(t * 2.3 + phase) * 0.1 * k);
    pos.setY(i, rest[i * 3 + 1] - k * k * 0.15);
  }
  pos.needsUpdate = true;
  flag.geometry.computeVertexNormals();
}

// Pre-filtered sky reflection for water and puddles.
function skyEnvironment(skyMesh) {
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(skyMesh.geometry, skyMesh.material));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(scene, 0.02, 1, 5000).texture;
  pmrem.dispose();
  return env;
}

const FLASH_COLOR = new THREE.Color(0xff9040);
const _shadowFocus = new THREE.Vector3();
const _camDir = new THREE.Vector3();

export class World {
  constructor() {
    const q = quality();
    this.scene = new THREE.Scene();
    const fogColor = new THREE.Color(0xb4997c); // dusty orange-grey haze
    this.fogBase = fogColor.clone();
    this.fogNear = 60;
    this.fogFarGround = 400; // visibility down on the battlefield
    this.fogFlashK = 0;
    this.scene.fog = new THREE.Fog(fogColor, this.fogNear, this.fogFarGround);
    this.scene.background = fogColor;

    // Late-afternoon sun, low in the west-south-west for long shadows.
    this.sunDir = new THREE.Vector3(0.75, 0.32, -0.45).normalize();
    this.hemi = new THREE.HemisphereLight(0xffe4c0, 0x40402c, 0.85);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffc690, 2.35);
    this.sun.castShadow = q.shadows;
    this.sun.shadow.mapSize.set(q.shadowMap, q.shadowMap);
    const S = 110;
    Object.assign(this.sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 1, far: 600 });
    // Tight bias: a large normalBias detaches shadows from walls, which looks like gaps
    // under roofs and buildings hovering over the ground.
    this.shadowTexel = (2 * S) / q.shadowMap;
    this.sun.shadow.bias = -0.0002;
    this.sun.shadow.normalBias = this.shadowTexel * 1.1;
    this.scene.add(this.sun, this.sun.target);

    this.sky = buildSky();
    this.sky.material.uniforms.sunDir.value.copy(this.sunDir);
    this.sky.material.uniforms.fogCol.value.copy(fogColor);
    // Shadow map axes: the same ones the shadow camera ends up with when it looks at the sun.
    this.sunRight = new THREE.Vector3(0, 1, 0).cross(this.sunDir).normalize();
    this.sunUp = this.sunDir.clone().cross(this.sunRight);
    noHeat(this.sky);
    this.scene.add(this.sky);

    const terrain = new THREE.Mesh(buildTerrainGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }));
    terrain.receiveShadow = true;
    this.terrain = terrain;
    this.scene.add(terrain);

    this.envMap = skyEnvironment(this.sky);
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x4a6d73, roughness: 0.12, metalness: 0.55, envMap: this.envMap, envMapIntensity: 0.9, transparent: true, opacity: 0.88, flatShading: true }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.y = WATER_LEVEL;
    water.receiveShadow = true;
    markHeat(water, { heat: 0.04 });
    this.scene.add(water);

    for (const b of BRIDGES) this.scene.add(buildBridge(b));

    this.pointMarkers = {};
    for (const pt of POINTS) {
      const m = buildPointMarker(pt);
      m.position.set(pt.x, gridHeightAt(pt.x, pt.z), pt.z);
      this.scene.add(m);
      this.pointMarkers[pt.id] = m;
    }

    // Base flags
    this.flags = Object.values(this.pointMarkers).map((m) => m.userData.flag);
    for (const [team, x, z] of BASE_FLAG_SPOTS) {
      const m = buildPointMarker({ x, z });
      m.userData.flag.material = new THREE.MeshStandardMaterial({ color: team === 'blue' ? 0x3f7fd0 : 0xc84a3f, side: THREE.DoubleSide, flatShading: true });
      m.position.set(x, gridHeightAt(x, z), z);
      this.scene.add(m);
      this.flags.push(m.userData.flag);
    }

    this.skyLife = new SkyLife(this.scene);
    this.t = 0;
  }

  // Keep the shadow frustum on what the viewer sees, moving it in whole shadow-map texels
  // only: otherwise every shadow edge crawls and shimmers as the camera moves.
  update(focus, camera) {
    const c = _shadowFocus.copy(focus);
    if (camera) {
      camera.getWorldDirection(_camDir);
      c.addScaledVector(_camDir.setY(0), 70);
    }
    const t = this.shadowTexel;
    const u = c.dot(this.sunRight), v = c.dot(this.sunUp);
    c.addScaledVector(this.sunRight, Math.round(u / t) * t - u).addScaledVector(this.sunUp, Math.round(v / t) * t - v);
    this.sun.position.copy(c).addScaledVector(this.sunDir, 300);
    this.sun.target.position.copy(c);
    this.sky.position.copy(focus);
    // High up you look out over the haze; down in a valley it closes in.
    const alt = focus.y - Math.max(gridHeightAt(focus.x, focus.z), WATER_LEVEL);
    const up = smoothstep(25, 240, alt);
    const low = 1 - smoothstep(8, 28, focus.y);
    const far = this.fogFarGround * (1 - low * 0.22) * (1 + up * 2.2);
    this.scene.fog.far = far;
    this.scene.fog.near = this.fogNear + up * 200;
  }

  // Explosions light the haze from inside for a moment.
  fogFlash(k) {
    this.fogFlashK = Math.min(1, Math.max(this.fogFlashK, k));
  }

  // Per-frame life: flags, clouds, birds, drifting leaves.
  animate(dt, cam) {
    this.t += dt;
    this.fogFlashK = Math.max(0, this.fogFlashK - dt * 2.8);
    const fc = this.scene.fog.color.copy(this.fogBase);
    if (this.fogFlashK > 0.001) fc.lerp(FLASH_COLOR, this.fogFlashK * 0.28);
    this.sky.material.uniforms.fogCol.value.copy(fc);
    this.flags.forEach((f, i) => {
      if (Math.hypot(f.parent.position.x - cam.x, f.parent.position.z - cam.z) < 500) waveFlag(f, this.t, i * 1.7);
    });
    this.skyLife.update(dt, cam);
  }
}

function gridHeightAt(x, z) {
  const i = Math.round((x + HALF) / CELL);
  const j = Math.round((z + HALF) / CELL);
  return gridHeight(i, j);
}
