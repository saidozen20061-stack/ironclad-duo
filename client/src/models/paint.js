import * as THREE from 'three';

// Paint schemes: one per tank class, drawn into small tiling canvases and projected onto
// the hull in the tank's own space (so the camo sticks to the vehicle as it moves).
// The red team gets the same pattern tinted dark red-brown, so teams stay readable.

export const PAINT = {
  light: { name: 'Ambush spots', colors: [0x6b6e3e, 0x4a3a26, 0x2a2a22, 0xa59a62], draw: spots },
  medium: { name: 'Woodland', colors: [0x55603a, 0x3e3324, 0x22231d, 0x7c7a4c], draw: blobs },
  heavy: { name: 'Tiger stripes', colors: [0xa08a4f, 0x4c5232, 0x5a4026], draw: stripes },
  scout: { name: 'Desert beige', colors: [0xc2a878, 0xb39868, 0xd0b88a], draw: plain },
  wheeled: { name: 'Digital', colors: [0x8d8360, 0x6b5f45, 0x4b4433, 0xa99d74], draw: digital },
  destroyer: { name: 'Ambush dots', colors: [0x9c8a55, 0x6a3d2a, 0x4e5a35, 0xb9a46c], draw: ambush },
  aa: { name: 'Winter wash', colors: [0xd6d8d2, 0x5d6a45, 0x8d8f86], draw: winter },
  assault: { name: 'Urban splinter', colors: [0x9a9d9a, 0x60706a, 0xc4c5be, 0x3e4242], draw: splinter },
  superheavy: { name: 'Two-tone bands', colors: [0x3f4d2e, 0x5f6c3f, 0x2d3822], draw: bands },
  t26: { name: 'Factory green', colors: [0x4f5c38, 0x3c4630, 0x5e6b45], draw: plain },
  // Story mode's tanks, one scheme each (not offered in the paint picker).
  'story-stuart': { name: 'Olive drab', colors: [0x5a5c3a, 0x4a4c30, 0x666845], draw: plain, story: true },
  'story-stug': { name: 'Dark yellow', colors: [0xb59a5a, 0x6a6a3c, 0x7a4e30, 0xc4ab6c], draw: ambush, story: true },
  'story-sherman': { name: 'Army olive', colors: [0x55593a, 0x3f432c, 0x666a45], draw: plain, story: true },
  'story-hellcat': { name: 'Two-tone olive', colors: [0x5d6240, 0x3d3a28, 0x22231d, 0x777a52], draw: blobs, story: true },
  'story-t3485': { name: 'Soviet green', colors: [0x4c5a34, 0x43502e, 0x56663c], draw: plain, story: true },
  'story-panther': { name: 'Ambush', colors: [0xa89558, 0x4d5a33, 0x6b442a], draw: stripes, story: true },
  'story-kv2': { name: 'Dark green', colors: [0x3f4b2e, 0x35402a, 0x4a5736], draw: plain, story: true },
  'story-is2': { name: 'Winter green', colors: [0x4a5636, 0xbfc2b6, 0x5b6845], draw: spots, story: true },
  'story-tiger': { name: 'Dark yellow', colors: [0xb39a5e, 0xa68d52, 0xc0a86a], draw: plain, story: true },
  flak: { name: 'Grey splinter', colors: [0x7c8078, 0x4c504a, 0x9a9c92, 0x35382f], draw: splinter },
  // Planes
  stuka: { name: 'Splinter', colors: [0x4a5540, 0x2f3a2c, 0x62705a, 0x3d4737], draw: splinter, plane: true },
  sturmovik: { name: 'Green and black', colors: [0x4c5d38, 0x1f2219, 0x3b4a2c], draw: blobs3, plane: true },
  sturmovikWinter: { name: 'Winter white', colors: [0xd8dad2, 0x8a8d84, 0xbfc2b8], draw: winter, plane: true, for: 'sturmovik' },
  dauntless: { name: 'Navy blue-grey', colors: [0x6a7f92, 0x8a9caa, 0x5a6e80], draw: plain, plane: true },
  heavyfighter: { name: 'Grey mottle', colors: [0x8a8f8c, 0x5e6562, 0x6f7572, 0x9a9f9c], draw: spots, plane: true },
  mosquito: { name: 'Green and grey', colors: [0x7c8580, 0x3f4f36, 0x55644a], draw: blobs3, plane: true },
  mitchell: { name: 'Olive drab', colors: [0x56583a, 0x4c4e33, 0x62643f], draw: plain, plane: true },
  mustang: { name: 'Polished silver', colors: [0xbcc0c2, 0xa8acae, 0xcdd0d0], draw: plain, plane: true },
  spitfire: { name: 'Green and brown', colors: [0x56613e, 0x6e5a3a, 0x4c5636], draw: blobs3, plane: true },
  messer: { name: 'Luftwaffe grey', colors: [0x7f8a8c, 0x5f6a6c, 0x8e9698, 0x6e787a], draw: spots, plane: true },
  leviathan: { name: 'Strategic grey', colors: [0x6a7686, 0x647080, 0x707c8c], draw: plain, plane: true, for: 'leviathan' },
  escort: { name: 'Strategic grey', colors: [0x6a7686, 0x647080, 0x707c8c], draw: plain, plane: true, for: 'escort' },
  heli: { name: 'Army olive', colors: [0x5d6b4c, 0x566446, 0x647254], draw: plain, plane: true, for: 'heli' },
  f16: { name: 'Fighter grey', colors: [0x8b9198, 0x7a8087, 0x969ca3], draw: plain, plane: true, for: 'f16' },
  wraith: { name: 'Stealth black', colors: [0x1d1f23, 0x191b1e, 0x212327], draw: plain, plane: true, for: 'wraith' },
};

const S = 256; // texture size in px
const TILE = 3.5; // metres per texture repeat

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hash = (s) => [...s].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619), 2166136261);
const css = (hex) => `#${hex.toString(16).padStart(6, '0')}`;
const RED = new THREE.Color(0x6a3328);
function teamColor(hex, team) {
  if (team !== 'red') return css(hex);
  const c = new THREE.Color(hex).lerp(RED, 0.45).multiplyScalar(0.85);
  return `#${c.getHexString()}`;
}

// Draw a shape at every wrap-around offset so the tile repeats seamlessly.
function wrap(fn) {
  for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) fn(dx, dy);
}

function circle(ctx, x, y, r) {
  wrap((dx, dy) => {
    ctx.beginPath();
    ctx.arc(x + dx, y + dy, r, 0, Math.PI * 2);
    ctx.fill();
  });
}

function poly(ctx, pts) {
  wrap((dx, dy) => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x + dx, y + dy) : ctx.moveTo(x + dx, y + dy)));
    ctx.closePath();
    ctx.fill();
  });
}

// Irregular patch: a cluster of overlapping circles.
function blob(ctx, r, size) {
  const x = r() * S, y = r() * S;
  for (let k = 0; k < 6; k++) circle(ctx, x + (r() - 0.5) * size * 1.6, y + (r() - 0.5) * size, size * (0.35 + r() * 0.4));
}

function grime(ctx, r) {
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,240,0.06)';
    ctx.fillRect(r() * S, r() * S, 1 + r() * 3, 1 + r() * 3);
  }
}

// ---------- Patterns ----------
function plain(ctx, c, r) {
  for (let i = 0; i < 18; i++) {
    ctx.fillStyle = c[1 + (i % 2)];
    ctx.globalAlpha = 0.35;
    blob(ctx, r, 30 + r() * 30);
  }
  ctx.globalAlpha = 1;
}

function spots(ctx, c, r) {
  for (let i = 0; i < 70; i++) {
    ctx.fillStyle = c[1 + (i % 3)];
    circle(ctx, r() * S, r() * S, 4 + r() * 10);
  }
}

function blobs(ctx, c, r) {
  for (const [col, n, size] of [[c[3], 5, 38], [c[1], 6, 34], [c[2], 5, 22]]) {
    ctx.fillStyle = col;
    for (let i = 0; i < n; i++) blob(ctx, r, size);
  }
}

function stripes(ctx, c, r) {
  for (let i = 0; i < 9; i++) {
    ctx.fillStyle = c[1 + (i % 2)];
    const x = r() * S, w = 6 + r() * 10, amp = 6 + r() * 10, ph = r() * 6;
    const left = [], right = [];
    for (let y = -10; y <= S + 10; y += 16) {
      const off = Math.sin((y / S) * Math.PI * 4 + ph) * amp;
      left.push([x + off, y]);
      right.unshift([x + off + w * (0.6 + 0.4 * Math.sin(y * 0.05 + ph)), y]);
    }
    poly(ctx, [...left, ...right]);
  }
}

function blobs3(ctx, c, r) {
  for (const [col, n, size] of [[c[1], 7, 42], [c[2], 5, 30]]) {
    ctx.fillStyle = col;
    for (let i = 0; i < n; i++) blob(ctx, r, size);
  }
}

function digital(ctx, c, r) {
  const cell = 16;
  for (const [col, n] of [[c[3], 14], [c[1], 16], [c[2], 12]]) {
    ctx.fillStyle = col;
    for (let i = 0; i < n; i++) {
      // Random walk of pixels makes the blocky clusters.
      let gx = Math.floor(r() * 16), gy = Math.floor(r() * 16);
      for (let k = 0; k < 7; k++) {
        poly(ctx, [[gx * cell, gy * cell], [(gx + 1) * cell, gy * cell], [(gx + 1) * cell, (gy + 1) * cell], [gx * cell, (gy + 1) * cell]]);
        if (r() < 0.5) gx = (gx + (r() < 0.5 ? 1 : -1) + 16) % 16;
        else gy = (gy + (r() < 0.5 ? 1 : -1) + 16) % 16;
      }
    }
  }
}

function ambush(ctx, c, r) {
  for (const [col, n, size] of [[c[1], 5, 36], [c[2], 5, 32]]) {
    ctx.fillStyle = col;
    for (let i = 0; i < n; i++) blob(ctx, r, size);
  }
  // Light dots sprinkled over the dark patches, darker dots on the base.
  for (let i = 0; i < 90; i++) {
    ctx.fillStyle = i % 2 ? c[3] : c[1];
    circle(ctx, r() * S, r() * S, 2 + r() * 2.5);
  }
}

function winter(ctx, c, r) {
  ctx.fillStyle = c[1];
  for (let i = 0; i < 9; i++) blob(ctx, r, 20 + r() * 18);
  // Streaks where the whitewash has run.
  ctx.fillStyle = c[2];
  ctx.globalAlpha = 0.35;
  for (let i = 0; i < 40; i++) {
    const x = r() * S, y = r() * S, h = 20 + r() * 40;
    poly(ctx, [[x, y], [x + 2, y], [x + 2, y + h], [x, y + h]]);
  }
  ctx.globalAlpha = 1;
}

function splinter(ctx, c, r) {
  for (let i = 0; i < 22; i++) {
    ctx.fillStyle = c[1 + (i % 3)];
    const x = r() * S, y = r() * S, a = r() * Math.PI, len = 40 + r() * 70, w = 10 + r() * 22;
    const dx = Math.cos(a), dy = Math.sin(a);
    poly(ctx, [[x, y], [x + dx * len, y + dy * len], [x + dx * len * 0.6 - dy * w, y + dy * len * 0.6 + dx * w], [x - dy * w * 0.4, y + dx * w * 0.4]]);
  }
}

function bands(ctx, c, r) {
  ctx.lineCap = 'round';
  for (let i = 0; i < 4; i++) {
    ctx.strokeStyle = c[1];
    ctx.lineWidth = 26 + r() * 16;
    const y0 = r() * S, ph = r() * 6;
    wrap((dx, dy) => {
      ctx.beginPath();
      for (let x = -20; x <= S + 20; x += 8) {
        const y = y0 + x * 0.5 + Math.sin((x / S) * Math.PI * 2 + ph) * 14;
        x === -20 ? ctx.moveTo(x + dx, y + dy) : ctx.lineTo(x + dx, y + dy);
      }
      ctx.stroke();
    });
  }
  ctx.fillStyle = c[2];
  for (let i = 0; i < 4; i++) blob(ctx, r, 12);
}

// ---------- Textures + materials ----------
const texCache = new Map();
function paintTexture(type, team) {
  const key = type + team;
  if (texCache.has(key)) return texCache.get(key);
  const scheme = PAINT[type] ?? PAINT.medium;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d');
  const cols = scheme.colors.map((h) => teamColor(h, team));
  ctx.fillStyle = cols[0];
  ctx.fillRect(0, 0, S, S);
  const r = rng(hash(type)); // same pattern for both players
  scheme.draw(ctx, cols, r);
  grime(ctx, r);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  if (scheme.draw === digital) tex.magFilter = THREE.NearestFilter;
  texCache.set(key, tex);
  return tex;
}

const matCache = new Map();
// shade < 1 darkens the pattern for secondary parts (fenders, barrels, hatches).
// `smooth` shades across the faces instead of showing each one, for curved bodies.
export function paintMaterial(type, team, shade = 1, smooth = false) {
  const key = `${type}|${team}|${shade}|${smooth}`;
  if (matCache.has(key)) return matCache.get(key);
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: !smooth, roughness: smooth ? 0.6 : 0.85, metalness: 0.1 });
  const map = paintTexture(type, team);
  m.onBeforeCompile = (shader) => {
    shader.uniforms.camoMap = { value: map };
    shader.uniforms.camoShade = { value: shade };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 camoPos;\nvarying vec3 vCamo;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCamo = camoPos;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D camoMap;\nuniform float camoShade;\nvarying vec3 vCamo;')
      .replace(
        '#include <map_fragment>',
        `{
          // Project the pattern along the face's dominant axis (faces are flat).
          vec3 fn = abs(normalize(cross(dFdx(vCamo), dFdy(vCamo))));
          vec3 p = vCamo / ${TILE.toFixed(2)};
          vec2 uv = fn.x > fn.y && fn.x > fn.z ? p.zy : fn.y > fn.z ? p.xz : p.xy;
          diffuseColor.rgb *= texture2D(camoMap, uv).rgb * camoShade;
        }`,
      );
  };
  m.customProgramCacheKey = () => 'tank-paint';
  matCache.set(key, m);
  return m;
}

// Bake each painted vertex's position in the tank's rest pose, so the pattern is
// continuous across parts and follows the turret when it turns.
export function bakePaintCoords(mesh, root) {
  const geo = mesh.geometry;
  if (geo.attributes.camoPos) return;
  const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert().multiply(mesh.matrixWorld);
  const pos = geo.attributes.position.clone();
  pos.applyMatrix4(toRoot);
  geo.setAttribute('camoPos', pos);
}
