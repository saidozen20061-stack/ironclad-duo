import * as THREE from 'three';
import { PLANES, FLIGHT } from '../../../shared/planes.js';
import { groundAt, WATER_LEVEL } from '../../../shared/map.js';
import { PROPS } from '../../../shared/props.js';
import { wrapAngle } from '../../../shared/tank.js';
import { net } from '../net.js';
import { settings, saveSettings } from '../settings.js';
import { keyName } from '../keybinds.js';
import { GunnerView } from './gunner.js';
import { planeEye, sideGunPos } from '../models/planes.js';
import { buildMinigunViewmodel } from '../models/guns.js';

// The three ways to sit in a plane: pilot (cockpit), side gunner (door minigun + bomb sight) and
// solo (chase camera with mouse aim, right click for the cockpit). They reuse the gunner's
// pointer lock, minimap, ping, banners and thermal; only the HUD and camera are their own.

const DEG = 180 / Math.PI;
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const BANK_LIMIT = 1.1; // rad: how far A and D lean the plane over
const BANK_EASE = 2.5; // how firmly the stick holds that angle
const AIM_FAR = 900; // m: where the guns converge with nothing under the crosshair
const FLIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);

const HUD = `
  <div class="p-warn"></div>
  <div class="p-pipper"><i></i></div>
  <div class="p-nose"></div>
  <div class="p-bombsight"><svg viewBox="-100 -100 200 200"><g stroke="#ffd080" fill="none" stroke-width="1"><circle r="62"/><circle r="22"/><line x1="-90" x2="90" y1="0" y2="0"/><line y1="-90" y2="90" x1="0" x2="0"/><line x1="-8" x2="8" y1="-40" y2="-40"/><line x1="-8" x2="8" y1="40" y2="40"/></g></svg><div class="p-drift"></div></div>
  <div class="p-panel panel">
    <div class="p-name"></div>
    <div class="p-row"><span>SPD</span><b class="p-speed">0</b><small>km/h</small></div>
    <div class="p-row"><span>ALT</span><b class="p-alt">0</b><small>m</small></div>
    <div class="p-bar"><label>THR</label><i><u class="p-th"></u></i></div>
    <div class="p-bar"><label>FUEL</label><i><u class="p-fuel"></u></i></div>
    <div class="p-arms"></div>
    <div class="p-mods"></div>
  </div>
  <div class="p-hint"></div>
`;

const MODS = { engine: 'ENG', engine2: 'EN2', engine3: 'EN3', engine4: 'EN4', engine5: 'EN5', engine6: 'EN6', wingL: 'L.W', wingR: 'R.W', tail: 'TAIL', fuel: 'FUEL', gear: 'GEAR', guns: 'GUN', crew: 'CREW' };

function planeQuaternion(u, out = new THREE.Quaternion()) {
  return out.setFromEuler(_e.set(-u.gp, u.h, u.ty));
}

// How each plane's cockpit differs: colours, what kind of flight deck, and `extra` for the
// details that make it that plane. `tint` turns the instrument panel into a one-colour glass screen.
const COCKPITS = {
  stuka: { paint: 0x4f5546, floor: 0x5c6052, extra: (k) => {
    // Dive angle lines painted on the side glass, and the bomb release handle.
    for (const [y, c] of [[0.02, 0xc83a2a], [0.14, 0xd8d6c4], [0.26, 0xc83a2a]]) k.add(k.box(0.012, 0.012, 0.5), k.flat(c), -0.52, y, -0.45, 0, 0.5);
    k.add(k.box(0.05, 0.16, 0.05), k.flat(0xc83a2a), 0.5, -0.5, -0.2);
  } },
  sturmovik: { paint: 0x5c6242, floor: 0x4a4e38, heavyFrame: true, extra: (k) => {
    // Sits in an armoured bathtub, behind a thick block of glass.
    for (const s of [-1, 1]) k.add(k.box(0.12, 0.34, 1.6), k.dark, s * 0.66, -0.22, -0.2);
    k.add(k.box(0.34, 0.22, 0.06), k.glass, 0, 0.0, -0.8);
  } },
  dauntless: { paint: 0x55687a, floor: 0x46535f, extra: (k) => {
    // A long telescopic gun sight through the windscreen.
    k.add(new THREE.CylinderGeometry(0.03, 0.03, 0.7, 8).rotateX(Math.PI / 2), k.dark, 0, -0.02, -0.75);
  } },
  heavyfighter: { paint: 0x6c716e, floor: 0x54585a, wide: 1.15, extra: (k) => {
    // Breech blocks of the nose cannons either side of the legs.
    for (const s of [-1, 1]) k.add(k.box(0.14, 0.2, 0.7), k.metal, s * 0.5, -0.78, -0.35);
  } },
  mosquito: { paint: 0x6a5234, floor: 0x7a6244, wide: 1.3, seat2: 0x4c3a24, extra: (k) => {
    // Plywood: a wooden-walled cabin with a navigator beside you and a chart table.
    k.add(k.box(0.5, 0.03, 0.34), k.flat(0xcfc6a8), 0.78, -0.42, -0.42, -0.4);
  } },
  mitchell: { paint: 0x5a5c3e, floor: 0x4c4e38, wide: 1.55, seat2: 0x4a4c34, pedestal: 2, yoke: true },
  mustang: { paint: 0x7f9256, floor: 0x6e7f4a, extra: (k) => {
    // Zinc-chromate green, a gyro gun sight, and a spade grip.
    k.add(k.box(0.09, 0.11, 0.16), k.dark, 0, -0.04, -0.78);
    k.add(k.box(0.08, 0.002, 0.07), k.glow(0xb8ffb0), 0, 0.06, -0.78, 0.5);
  } },
  spitfire: { paint: 0x4f5b3d, floor: 0x424c32, extra: (k) => {
    // A ring-topped stick, and the little fold-down door on the left.
    k.add(new THREE.TorusGeometry(0.06, 0.012, 6, 12), k.dark, 0, -0.4, -0.42, 0.3);
    k.add(k.box(0.03, 0.28, 0.5), k.flat(0x5f6b4a), -0.72, -0.28, -0.1);
  } },
  messer: { paint: 0x68706f, floor: 0x54595a, heavyFrame: true, extra: (k) => {
    // The squared-off canopy framing, and the cannon breech between the legs.
    for (const y of [0.22, 0.42]) k.add(k.box(1.1, 0.04, 0.04), k.dark, 0, y, -0.72);
    k.add(k.box(0.16, 0.2, 0.55), k.metal, 0, -0.85, -0.35);
  } },
  f16: { modern: true, paint: 0x2c3036, floor: 0x24272c, tint: '#46ff9a', extra: (k) => {
    // A sloped glass panel, two glowing screens, a head-up display in the windscreen, and a side stick.
    k.add(k.box(0.3, 0.26, 0.03), k.glow(0x123a24), -0.62, -0.42, -0.72);
    k.add(k.box(0.3, 0.26, 0.03), k.glow(0x123a24), 0.62, -0.42, -0.72);
    for (const s of [-1, 1]) for (const y of [-0.5, -0.42, -0.34]) k.add(k.box(0.22, 0.012, 0.005), k.glow(0x46ff9a), s * 0.62, y, -0.7);
    k.add(k.box(0.28, 0.32, 0.01), k.hud, 0, 0.06, -0.72, 0.12);
    k.add(k.box(0.16, 0.006, 0.002), k.glow(0x46ff9a), 0, 0.06, -0.71, 0.12);
    k.add(k.box(0.006, 0.16, 0.002), k.glow(0x46ff9a), 0, 0.06, -0.71, 0.12);
    k.add(k.box(0.3, 0.05, 0.14), k.dark, 0, -0.1, -0.72);
    k.add(k.box(0.12, 0.08, 0.34), k.dark, 0.6, -0.62, -0.25);
    k.add(new THREE.CylinderGeometry(0.018, 0.022, 0.2, 6), k.dark, 0.6, -0.48, -0.32, 0.2);
    // The ejection seat's yellow-and-black firing handle, and the second seat's bulkhead behind.
    k.add(k.box(0.26, 0.05, 0.04), k.flat(0xe2b420), 0, -0.58, -0.08);
    k.add(k.box(1.3, 0.8, 0.08), k.paint, 0, -0.4, 0.7);
  } },
  heli: { modern: true, paint: 0x2f3530, floor: 0x262a26, tint: '#7dff9a', narrow: true, extra: (k) => {
    // A narrow tandem cockpit: two green screens, a collective on the left and a cyclic between the knees.
    for (const s of [-1, 1]) {
      k.add(k.box(0.26, 0.22, 0.03), k.glow(0x123a24), s * 0.34, -0.2, -0.74);
      for (const y of [-0.26, -0.2, -0.14]) k.add(k.box(0.2, 0.012, 0.005), k.glow(0x7dff9a), s * 0.34, y, -0.72);
    }
    k.add(new THREE.CylinderGeometry(0.02, 0.025, 0.42, 6), k.dark, 0, -0.56, -0.38, 0.15);
    k.add(k.box(0.05, 0.04, 0.42), k.dark, -0.42, -0.62, -0.22, 0.3);
  } },
  wraith: { modern: true, paint: 0x17181b, floor: 0x121316, wide: 1.5, seat2: 0x1f2024, narrow: true, tint: '#ffb23c', extra: (k) => {
    // Black, wide and windowless but for two small panes, with a wall of amber screens.
    for (const x of [-1.05, -0.62, 0.62, 1.05]) {
      k.add(k.box(0.36, 0.26, 0.03), k.glow(0x2c1c06), x, -0.42, -0.76);
      for (const y of [-0.5, -0.42, -0.34]) k.add(k.box(0.28, 0.012, 0.005), k.glow(0xffb23c), x, y, -0.74);
    }
    k.add(k.box(2.9, 0.55, 0.05), k.dark, 0, 0.56, -0.74); // the low roof of the slit windows
    for (const s of [-1, 1]) k.add(k.box(0.5, 1.1, 0.05), k.dark, s * 1.3, 0.05, -0.74);
  } },
  leviathan: { modern: false, deck: true, paint: 0x5a6066, floor: 0x3c4046, extra: (k) => {
    // A flight deck you could walk around, with the pilot on its left: wide panel, overhead switches, copilot, big windows.
    k.add(k.box(5.2, 0.6, 0.1), k.dark, 1, -0.55, -1.3);
    k.add(k.box(5.2, 0.14, 0.7), k.paint, 1, -0.06, -1.72);
    for (let x = -1.45; x < 3.3; x += 0.42) {
      if (Math.abs(x) < 0.85) continue;
      k.add(new THREE.CircleGeometry(0.15, 12), k.flat(0x101210), x, -0.55, -1.24);
      k.add(k.box(0.012, 0.11, 0.004), k.glow(0xffb040), x, -0.55, -1.23, 0, 0.6);
    }
    // Windscreen frames, up to the overhead panel.
    for (const x of [-1.6, 1, 2.7, 3.5]) k.add(k.box(0.12, 1.1, 0.12), k.dark, x, 0.35, -1.5, 0, x < 1 ? 0.12 : -0.12);
    k.add(k.box(5.2, 0.16, 1.5), k.paint, 1, 0.92, -0.75);
    for (let z = -1.3; z < -0.1; z += 0.28) for (let x = -0.6; x <= 2.6; x += 0.32) k.add(k.box(0.14, 0.02, 0.12), k.flat(z < -0.8 ? 0x2c2e30 : 0x505458), x, 0.83, z);
    // Four throttles on a centre pedestal between the seats.
    k.add(k.box(0.7, 0.55, 1.1), k.dark, 0.9, -0.82, -0.5);
    // Copilot's seat and the wide floor, with side windows and walls.
    k.add(k.box(0.72, 0.1, 0.6), k.paint, 1.85, -0.75, 0.2);
    k.add(k.box(0.72, 0.8, 0.1), k.dark, 1.85, -0.42, 0.5);
    k.add(k.box(5.6, 0.06, 4), k.floorM, 1, -1.1, 0.6);
    for (const x of [-1.8, 3.8]) {
      k.add(k.box(0.08, 0.95, 4), k.paint, x, -0.6, 0.6);
      k.add(k.box(0.08, 1.1, 0.14), k.dark, x, 0.4, 0.3);
    }
    k.add(k.box(5.6, 2.2, 0.1), k.paint, 1, -0.1, 2.5); // the bulkhead behind the seats
  } },
};

// Low-poly cockpit in its own little scene, drawn over the world so it never clips.
function buildCockpit(spec) {
  const cfg = COCKPITS[spec.id] ?? {};
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xdfe4e8, 0x4a4030, 1.25));
  const sun = new THREE.DirectionalLight(0xfff0d8, 1.3);
  sun.position.set(0.5, 1, 0.4);
  scene.add(sun);
  const root = new THREE.Group();
  scene.add(root);
  const flat = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.8, ...opts });
  const paint = flat(cfg.paint ?? 0x4f5546);
  const dark = flat(cfg.modern ? 0x101114 : 0x24261f);
  const floor = flat(cfg.floor ?? 0x5c6052, { roughness: 0.9 });
  const add = (g, m, x, y, z, rx = 0, rz = 0) => {
    const o = new THREE.Mesh(g, m);
    o.position.set(x, y, z);
    o.rotation.set(rx, 0, rz);
    root.add(o);
    return o;
  };
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const wide = cfg.wide ?? 1;
  // Instrument panel with a live canvas face.
  const canvas = document.createElement('canvas');
  canvas.width = 720;
  canvas.height = 240;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  // A flight deck's panel sits further out, in front of the pilot's seat.
  const panelZ = cfg.deck ? -1.22 : -0.76;
  add(box(cfg.deck ? 1.5 : 1.0, 0.36, 0.08), dark, 0, -0.33, panelZ);
  add(new THREE.PlaneGeometry(cfg.deck ? 1.4 : 0.94, cfg.deck ? 0.467 : 0.313), new THREE.MeshBasicMaterial({ map: tex }), 0, -0.33, panelZ + 0.045);
  if (!cfg.deck) {
    // Coaming over the panel, side rails, and a canopy frame around the view, none on a bubble canopy.
    add(box(1.25 * wide, 0.1, 0.32), paint, 0, -0.12, -0.82);
    if (spec.engines === 1 && !cfg.modern) add(box(0.8, 0.14, 1.6), paint, 0, -0.18, -1.65, 0.08);
    for (const s of [-1, 1]) {
      add(box(0.11, 0.4, 1.8), paint, s * 0.76 * wide, -0.4, 0.05);
      if (cfg.modern && !cfg.narrow) continue;
      const bar = cfg.heavyFrame ? 0.1 : 0.05;
      add(box(bar, 0.75, bar), dark, s * 0.55 * wide, 0.13, -0.8, 0.12, s * -0.34);
      add(box(0.04, 0.04, 1.6), dark, s * 0.55 * wide, 0.4, 0.05);
    }
    if (!cfg.modern) {
      add(box(1.2 * wide, 0.05, 0.05), dark, 0, 0.47, -0.7);
      add(box(1.16 * wide, 0.05, 0.05), dark, 0, 0.5, 0.05);
      add(box(0.03, 0.07, 0.03), dark, 0, -0.03, -0.78); // gun sight post
    }
    // The tub the pilot sits in: floor, footwell under the panel, side walls, seat and pedals.
    // The plane itself is hidden from this seat, so without these you'd look straight through to the ground.
    add(box(1.56 * wide, 0.06, 3.1), floor, 0, -1.02, 0.65);
    add(box(1.56 * wide, 0.96, 0.06), floor, 0, -0.56, -0.82); // front wall, behind the panel
    for (const s of [-1, 1]) {
      add(box(0.06, 0.8, 3.1), paint, s * 0.78 * wide, -0.62, 0.65);
      add(box(0.04, 0.3, 1.4), dark, s * 0.72 * wide, -0.72, 0.2); // floor ribs along the walls
    }
  }
  for (const s of [-1, 1]) add(box(0.24, 0.05, 0.1), dark, s * 0.2, cfg.deck ? -1.04 : -0.95, -0.6, -0.5); // rudder pedals
  add(box(0.72, 0.1, 0.56), paint, 0, -0.72, 0.2); // seat cushion
  add(box(0.6, 0.3, 0.46), dark, 0, -0.88, 0.2); // seat base
  // A second seat beside you, on the wider planes.
  if (cfg.seat2) {
    const m = flat(cfg.seat2);
    add(box(0.62, 0.1, 0.5), m, 0.98, -0.72, 0.2);
    add(box(0.62, 0.62, 0.08), m, 0.98, -0.42, 0.48);
  }
  // Stick and throttle, or a wheel on the big ones.
  if (cfg.yoke || cfg.deck) {
    add(new THREE.CylinderGeometry(0.035, 0.04, 0.5, 6), dark, 0, -0.78, -0.5, -0.15);
    add(new THREE.TorusGeometry(0.15, 0.022, 6, 14), dark, 0, -0.52, -0.55);
  } else if (!cfg.modern) add(new THREE.CylinderGeometry(0.02, 0.025, 0.62, 6), dark, 0, -0.72, -0.35, -0.2);
  const leverMat = flat(cfg.modern ? 0x202226 : 0x8a3a2a);
  const levers = cfg.deck ? 4 : cfg.pedestal ?? 1;
  const lever = new THREE.Group();
  const baseX = cfg.deck ? 0.9 - 0.3 : levers > 1 ? 0.4 : -0.62;
  for (let i = 0; i < levers; i++) {
    const m = new THREE.Mesh(box(0.035, 0.035, 0.2), leverMat);
    m.position.x = baseX + i * (cfg.deck ? 0.2 : 0.08);
    lever.add(m);
  }
  lever.position.set(0, cfg.deck ? -0.5 : -0.47, -0.25);
  root.add(lever);
  if (cfg.pedestal) add(box(0.3, 0.5, 0.7), dark, 0.44, -0.74, -0.3);
  // Seat armour behind the head: the pilot can't see behind the plane.
  add(box(0.72, 0.62, 0.08), dark, 0, -0.42, 0.5);
  if (!cfg.deck && !cfg.modern) add(box(1.4, 0.75, 0.5), paint, 0, -0.62, 1.9); // turtle deck blocks the view aft
  // The gunner's back and legs, behind the seat, for when the pilot looks round.
  if (spec.seats === 2 && spec.rear && !cfg.deck) {
    const cloth = flat(0x5a4c34);
    add(box(0.44, 0.55, 0.26), cloth, 0.08, -0.2, 1.2);
    add(new THREE.SphereGeometry(0.13, 7, 5), flat(0x3a3c32), 0.08, 0.17, 1.2);
    for (const s of [-1, 1]) add(box(0.14, 0.14, 0.45), cloth, 0.08 + s * 0.13, -0.5, 1.02);
  }
  cfg.extra?.({
    add, box, paint, dark, flat,
    floorM: floor,
    metal: flat(0x6e7270, { metalness: 0.5 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x9fb4b0, transparent: true, opacity: 0.25, roughness: 0.1 }),
    hud: new THREE.MeshBasicMaterial({ color: 0x46ff9a, transparent: true, opacity: 0.1, depthWrite: false }),
    glow: (color) => new THREE.MeshBasicMaterial({ color }),
  });
  return { scene, root, canvas, ctx: canvas.getContext('2d'), tex, lever, tint: cfg.tint };
}

function drawGauge(ctx, cx, cy, r, label, frac, value) {
  ctx.fillStyle = '#10120e';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#8c8f82';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.strokeStyle = '#d8d6c4';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 8; i++) {
    const a = Math.PI * 0.75 + (i / 8) * Math.PI * 1.5;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r * 0.8, cy + Math.sin(a) * r * 0.8);
    ctx.lineTo(cx + Math.cos(a) * r * 0.94, cy + Math.sin(a) * r * 0.94);
    ctx.stroke();
  }
  const a = Math.PI * 0.75 + Math.max(0, Math.min(1, frac)) * Math.PI * 1.5;
  ctx.strokeStyle = '#ffb040';
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(a) * r * 0.78, cy + Math.sin(a) * r * 0.78);
  ctx.stroke();
  ctx.fillStyle = '#d8d6c4';
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(label, cx, cy - r * 0.32);
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText(value, cx, cy + r * 0.62);
}

// Wheels above the ground (or water), the same figure on every altitude readout.
function heightAboveGround(self, pl, spec) {
  return Math.max(0, (pl.y ?? 0) - Math.max(groundAt(self.x, self.z), WATER_LEVEL) - spec.gearH);
}

function flightHint(spec) {
  if (spec?.heli) return `${keyName('plane.up')}/${keyName('plane.down')} forward/back · ${keyName('plane.left')}/${keyName('plane.right')} sideways · ${keyName('plane.more')} rise · ${keyName('plane.less')} sink · Mouse turns and aims · ${keyName('plane.fire')} miniguns`;
  return `${keyName('plane.up')} up · ${keyName('plane.down')} down · ${keyName('plane.left')}/${keyName('plane.right')} turn · ${keyName('plane.more')}/${keyName('plane.less')} throttle · Mouse aims guns · ${keyName('plane.fire')} guns · ${keyName('plane.bomb')} bombs · ${keyName('plane.rocket')} rockets`;
}

function drawInstruments(cp, self, me, spec, pingBearing) {
  const ctx = cp.ctx;
  const pl = me.pl ?? {};
  const W = 720, H = 240;
  ctx.fillStyle = '#20221c';
  ctx.fillRect(0, 0, W, H);
  drawGauge(ctx, 92, 120, 84, 'SPEED', Math.abs(self.v ?? me.v) / (spec.maxSpeed * 1.4), `${Math.round(Math.abs(me.v) * 3.6)}`);
  const alt = heightAboveGround(self, pl, spec);
  drawGauge(ctx, 268, 120, 84, 'ALT', alt / FLIGHT.maxAlt, `${Math.round(alt)}`);
  // Artificial horizon.
  ctx.save();
  ctx.beginPath();
  ctx.arc(444, 120, 84, 0, Math.PI * 2);
  ctx.clip();
  ctx.translate(444, 120);
  ctx.rotate(self.ty);
  const off = self.gp * 120;
  ctx.fillStyle = '#38648a';
  ctx.fillRect(-200, -300 + off, 400, 300);
  ctx.fillStyle = '#5a452c';
  ctx.fillRect(-200, off, 400, 300);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-90, off);
  ctx.lineTo(90, off);
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = '#ffb040';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(392, 120);
  ctx.lineTo(432, 120);
  ctx.moveTo(456, 120);
  ctx.lineTo(496, 120);
  ctx.stroke();
  ctx.strokeStyle = '#8c8f82';
  ctx.beginPath();
  ctx.arc(444, 120, 84, 0, Math.PI * 2);
  ctx.stroke();
  // Compass strip with the gunner's ping.
  ctx.fillStyle = '#10120e';
  ctx.fillRect(546, 18, 164, 46);
  const hdg = (((-self.h * DEG) % 360) + 360) % 360;
  ctx.fillStyle = '#d8d6c4';
  ctx.font = 'bold 15px sans-serif';
  for (const [d, n] of [[0, 'N'], [90, 'E'], [180, 'S'], [270, 'W'], [360, 'N']]) {
    const dx = wrapAngle(((d - hdg) * Math.PI) / 180) * DEG;
    if (Math.abs(dx) < 42) ctx.fillText(n, 628 + dx * 1.9, 46);
  }
  if (pingBearing !== null) {
    const dx = Math.max(-40, Math.min(40, pingBearing * DEG)) * 1.9;
    ctx.fillStyle = '#ffd040';
    ctx.beginPath();
    ctx.moveTo(628 + dx, 62);
    ctx.lineTo(620 + dx, 74);
    ctx.lineTo(636 + dx, 74);
    ctx.fill();
  }
  ctx.fillStyle = '#ffb040';
  ctx.fillRect(627, 16, 2, 10);
  // Throttle and fuel bars.
  const bar = (x, label, f, col) => {
    ctx.fillStyle = '#10120e';
    ctx.fillRect(x, 84, 30, 112);
    ctx.fillStyle = col;
    ctx.fillRect(x + 3, 193 - 106 * Math.max(0, Math.min(1, f)), 24, 106 * Math.max(0, Math.min(1, f)));
    ctx.fillStyle = '#d8d6c4';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText(label, x + 15, 214);
  };
  bar(552, 'THR', pl.th ?? 0, '#c8a040');
  bar(592, 'FUEL', pl.fuel ?? 0, '#70b060');
  // Damage lights.
  const keys = Object.keys(me.mods ?? {});
  keys.forEach((k, i) => {
    const v = me.mods[k];
    ctx.fillStyle = v <= 0 ? '#ff3020' : v < 0.5 ? '#ffa020' : '#2c5a2c';
    const x = 642 + (i % 2) * 36, y = 88 + Math.floor(i / 2) * 26;
    ctx.fillRect(x, y, 30, 18);
    ctx.fillStyle = '#10120e';
    ctx.font = 'bold 10px sans-serif';
    ctx.fillText(MODS[k] ?? k, x + 15, y + 13);
  });
  // A glass cockpit: the same readouts, as a one-colour screen.
  if (cp.tint) {
    ctx.globalCompositeOperation = 'color';
    ctx.fillStyle = cp.tint;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
  }
  cp.tex.needsUpdate = true;
}

const HANGARS = PROPS.filter((p) => p.type === 'hangar');
const HANGAR_CAM_HEIGHT = 14; // m above the ground

class PlaneBase extends GunnerView {
  constructor(opts) {
    super(opts);
    this.isPlane = true;
    this.plane = PLANES[opts.tank];
    this.spotRange = 700;
    this.minimapSpan = 1100;
    this.el.classList.add('plane');
    this.el.insertAdjacentHTML('beforeend', HUD);
    this.$('.p-name').textContent = `${this.plane.name} · ${this.plane.class}`;
    this.flySend = { key: '', at: 0 };
    this.lastMods = '';
    this.camera.far = 4600;
    this.instrT = 0;
    this.cockpit = null;
    this.ownHidden = false;
  }

  // Pilot-style controls and the fire buttons.
  bindFlight() {
    const canvas = document.getElementById('scene');
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    this.mouseBtn = { left: false, right: false };
    this.onMouseDown = (e) => {
      if (this.aiming()) return;
      this.keys.swallow(`Mouse${e.button}`);
      if (e.target === canvas && !this.paused) this.requestLock();
    };
    this.onMouseMove = (e) => {
      if (this.aiming()) this.onLook(e.movementX, e.movementY);
    };
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mousemove', this.onMouseMove);
  }

  setPaused(p) {
    this.paused = p;
    if (p && this.mouseBtn) {
      this.mouseBtn.left = false;
      this.mouseBtn.right = false;
    }
  }

  // Mouse: where you look, and where the guns point.
  onLook(dx, dy) {
    const k = 0.0022 * settings.sensitivity;
    this.aim.yaw = wrapAngle(this.aim.yaw - dx * k);
    this.aim.pitch = Math.max(-1.45, Math.min(1.45, this.aim.pitch - dy * k));
  }

  // The view turns along with the plane, and the mouse looks around from there. C looks ahead again.
  followPlane(self) {
    const a = this.aim;
    // A helicopter's nose turns to the view, not the other way round.
    if (this.plane.heli) {
      if (!a.initialised) a.yaw = self.h;
      if (!a.initialised || this.keys.hit('plane.ahead')) a.pitch = 0;
      a.initialised = true;
      return;
    }
    if (!a.initialised || this.keys.hit('plane.ahead')) {
      a.yaw = self.h;
      a.pitch = self.gp;
      a.initialised = true;
    } else {
      a.yaw = wrapAngle(a.yaw + wrapAngle(self.h - this.lastH));
      a.pitch = Math.max(-1.45, Math.min(1.45, a.pitch + self.gp - this.lastGp));
    }
    this.lastH = self.h;
    this.lastGp = self.gp;
  }

  // The look direction as seen from the plane's own seat.
  lookFromSeat(self) {
    planeQuaternion(self, _q);
    const l = _v.set(Math.sin(this.aim.yaw) * Math.cos(this.aim.pitch), Math.sin(this.aim.pitch), Math.cos(this.aim.yaw) * Math.cos(this.aim.pitch)).applyQuaternion(_q.invert());
    this.look.yaw = Math.atan2(l.x, l.z);
    this.look.pitch = Math.asin(Math.max(-1, Math.min(1, l.y)));
    return this.look;
  }

  // Fire and the other held button, read every frame.
  readButtons(fire, other) {
    const on = this.aiming();
    this.mouseBtn.left = on && this.keys.on(fire);
    this.mouseBtn.right = !!other && on && this.keys.on(other);
  }

  // By default W climbs, S descends, A/D bank and turn, E or Shift more throttle, Q less. On the
  // runway W is also the throttle, so holding it takes off. The guns go to what the crosshair is on.
  sendControls(self, me) {
    const k = this.keys;
    if (k.hit('plane.bail')) net.send({ t: 'jump' });
    const onGround = !!me.pl?.ground;
    const turn = (k.on('plane.right') ? 1 : 0) - (k.on('plane.left') ? 1 : 0);
    // Eases to the bank angle while A or D is held, and back to level when they're let go.
    const roll = Math.max(-1, Math.min(1, (turn * BANK_LIMIT - self.ty) * BANK_EASE));
    const up = (k.on('plane.more') || (onGround && k.on('plane.up')) ? 1 : 0) - (k.on('plane.less') || (onGround && k.on('plane.down')) ? 1 : 0);
    const look = this.camera.getWorldDirection(_v);
    const reach = this.raycast(this.camera.position, look, this.states, me.id) ?? AIM_FAR;
    const gun = _v2.copy(look).multiplyScalar(reach).add(this.camera.position).sub(_v3.set(self.x, self.y, self.z)).normalize();
    if (this.plane.heli) {
      this.sendFly({
        t: 'fly',
        th: (k.on('plane.more') ? 1 : 0) - (k.on('plane.less') ? 1 : 0),
        pitch: (k.on('plane.up') ? 1 : 0) - (k.on('plane.down') ? 1 : 0),
        roll: turn,
        yaw: 0,
        face: +this.aim.yaw.toFixed(3),
        gun: [+gun.x.toFixed(3), +gun.y.toFixed(3), +gun.z.toFixed(3)],
        fire: !!this.mouseBtn.left,
      });
      return;
    }
    this.sendFly({
      t: 'fly',
      th: up,
      pitch: (k.on('plane.up') ? 1 : 0) - (k.on('plane.down') && !onGround ? 1 : 0),
      roll: +roll.toFixed(2),
      yaw: -turn * 0.5,
      gun: [+gun.x.toFixed(3), +gun.y.toFixed(3), +gun.z.toFixed(3)],
      fire: !!this.mouseBtn.left,
      bomb: k.on('plane.bomb'),
      rocket: k.on('plane.rocket'),
    });
  }

  // Flying a plane, from the seat or from behind. The view button stays until it's pressed again;
  // `hold` is an extra button for a quick look from the cockpit (solo).
  flyUpdate(dt, states, me, hold = null) {
    this.me = me;
    this.states = states;
    this.renderDt = dt;
    const self = states.get(me.id);
    if (!self) return;
    this.readButtons('plane.fire', hold);
    if (!this.paused && this.keys.hit('plane.view')) {
      settings.firstPerson = !settings.firstPerson;
      saveSettings();
      this.showBanner(settings.firstPerson ? '1ST PERSON' : '3RD PERSON');
    }
    this.followPlane(self);
    if (this.plane.afterburner) {
      const ab = !!me.pl?.ab;
      if (ab && !this.abOn) this.showBanner('AFTERBURNER');
      this.abOn = ab;
    }
    const inCockpit = settings.firstPerson || !!this.mouseBtn.right;
    this.inCockpit = inCockpit;
    const cam = this.camera;
    const dir = _v.set(Math.sin(this.aim.yaw) * Math.cos(this.aim.pitch), Math.sin(this.aim.pitch), Math.cos(this.aim.yaw) * Math.cos(this.aim.pitch));
    if (inCockpit) {
      this.planePoint(self, 0, planeEye(this.tank) + 0.55, this.plane.size.length * 0.03, cam.position);
      const look = this.lookFromSeat(self);
      planeQuaternion(self, _q);
      cam.quaternion.copy(_q).multiply(FLIP);
      cam.rotateY(look.yaw);
      cam.rotateX(look.pitch);
      this.showOwn(false);
      this.updateCockpit(dt, self, me, look);
    } else {
      this.cockpitOn = false;
      this.showOwn(true);
      const want = this.plane.size.length * 1.5 + 9;
      const up = this.plane.size.height * 0.9 + 1.5;
      const reach = this.reachInHangar(dt, self, dir, want, up);
      const px = self.x - dir.x * reach, pz = self.z - dir.z * reach;
      let py = self.y - dir.y * reach + up * Math.min(1, reach / want);
      py = Math.max(py, Math.max(groundAt(px, pz), WATER_LEVEL) + 1.2);
      cam.position.set(px, py, pz);
      cam.rotation.order = 'YXZ';
      // Looks along the aim direction, so the crosshair stays in the centre.
      cam.rotation.set(this.aim.pitch, this.aim.yaw + Math.PI, 0);
    }
    cam.fov += (70 - cam.fov) * Math.min(1, dt * 6);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    this.world.update(cam.position, cam);
    if (!this.paused) this.sendControls(self, me);
    this.placeNose(self);
    this.planeHud(self, me);
  }

  // How far back the chase camera can sit: rolling around a hangar, it stays in rather than ending up
  // behind a wall. It closes in at once and eases back out.
  reachInHangar(dt, self, dir, want, up) {
    let limit = want;
    if (self.y - groundAt(self.x, self.z) < HANGAR_CAM_HEIGHT) {
      const inside = (x, y, z) => HANGARS.some((p) => Math.abs(x - p.x) < p.w / 2 - 1 && Math.abs(z - p.z) < p.d / 2 - 1 && y - p.y < p.h * 0.66);
      let was = inside(self.x, self.y, self.z);
      for (let r = 1; r <= want; r += 1) {
        const k = r / want;
        const now = inside(self.x - dir.x * r, self.y - dir.y * r + up * k, self.z - dir.z * r);
        if (was && !now) {
          limit = Math.max(1, r - 1);
          break;
        }
        was = now;
      }
    }
    this.camReach ??= limit;
    this.camReach = limit < this.camReach ? limit : this.camReach + (limit - this.camReach) * Math.min(1, dt * 3);
    return this.camReach;
  }

  // Send a control message at 20 Hz, or at once when it changes.
  sendFly(msg) {
    const key = JSON.stringify(msg);
    const now = performance.now();
    if (key !== this.flySend.key || now - this.flySend.at > 200) {
      if (now - this.flySend.at < 40) return;
      net.send(msg);
      this.flySend = { key, at: now };
    }
  }

  // A marker for where the nose really points; the crosshair stays in the middle, on the guns.
  placeNose(self) {
    const n = _v2.copy(fwdOf(self)).multiplyScalar(420).add(_v3.set(self.x, self.y, self.z)).project(this.camera);
    const nose = this.$('.p-nose');
    nose.style.display = n.z < 1 && Math.abs(n.x) < 1.1 && Math.abs(n.y) < 1.1 ? 'block' : 'none';
    nose.style.left = `${((n.x + 1) / 2) * 100}%`;
    nose.style.top = `${((1 - n.y) / 2) * 100}%`;
  }

  // Parts of the HUD every seat shares.
  planeHud(self, me) {
    const pl = me.pl ?? {};
    const $ = this.$;
    $('.g-lock').style.display = this.aiming() || this.paused ? 'none' : '';
    $('.g-thermal').classList.toggle('on', this.thermalActive());
    $('.p-speed').textContent = Math.round(Math.abs(me.v) * 3.6);
    $('.p-alt').textContent = Math.round(heightAboveGround(self, pl, this.plane));
    this.el.classList.toggle('cockpit', !!this.cockpitOn);
    $('.p-th').style.width = `${(pl.th ?? 0) * 100}%`;
    $('.p-fuel').style.width = `${(pl.fuel ?? 0) * 100}%`;
    const s = this.plane;
    $('.p-arms').innerHTML = `${s.guns.ammo ? `<span>GUN <b>${pl.ammo ?? 0}</b></span>` : ''}${s.bombs ? `<span>BOMB <b>${s.bombs.infinite ? '∞' : pl.bombs ?? 0}</b></span>` : ''}${s.rockets?.count ? `<span>RKT <b>${pl.rockets ?? 0}</b></span>` : ''}${s.rear ? `<span>MINIGUN <b>${pl.rear ?? 0}</b></span>` : ''}`;
    const modKey = JSON.stringify(me.mods);
    if (modKey !== this.lastMods) {
      this.lastMods = modKey;
      $('.p-mods').innerHTML = Object.entries(me.mods ?? {}).map(([k, v]) => `<i class="${v <= 0 ? 'dead' : v < 0.5 ? 'dmg' : ''}">${MODS[k] ?? k}</i>`).join('');
    }
    // Warnings, worst first.
    const aa = pl.aa ?? 0;
    const w = me.dead ? '' : pl.stall ? 'STALL!' : pl.low ? 'PULL UP!' : aa < 0 ? 'ENEMY AA TURRETS FIRING! GET OUT OF THEIR HALF' : pl.edge ? 'RETURN TO BATTLE' : pl.six ? 'ENEMY ON OUR SIX!' : aa > 0 ? `ENEMY AA TURRETS IN ${Math.ceil(aa)}s` : pl.y > FLIGHT.maxAlt - 30 ? 'TOO HIGH' : '';
    const warnEl = $('.p-warn');
    if (warnEl.textContent !== w) warnEl.textContent = w;
    warnEl.classList.toggle('show', !!w);
    const dead = $('.g-dead');
    dead.style.display = me.dead ? '' : 'none';
    if (me.dead) dead.innerHTML = `PLANE DESTROYED<small>${me.respawnIn < 1e6 ? `New plane in ${Math.ceil(me.respawnIn)}s` : ''}</small>`;
    this.drawMinimap(self, this.states);
    const cd = me.pingCd ?? 0;
    $('.g-pingcd u').style.width = `${(1 - cd / 5) * 100}%`;
    $('.g-pingcd').classList.toggle('ready', cd <= 0);
    $('.g-pingcd span').textContent = cd > 0 ? `${cd.toFixed(1)}s` : me.ping ? `active ${Math.round(Math.hypot(me.ping.x - self.x, me.ping.z - self.z))}m` : 'ready';
  }

  // Bearing from the plane's nose to the gunner's ping (null without one).
  pingBearing(self, me) {
    return me.ping ? wrapAngle(self.h - Math.atan2(me.ping.x - self.x, me.ping.z - self.z)) : null;
  }

  // World-space placement of a point in the plane's own frame.
  planePoint(self, x, y, z, out) {
    planeQuaternion(self, _q);
    return out.set(x, y, z).applyQuaternion(_q).add(_v2.set(self.x, self.y, self.z));
  }

  showOwn(on) {
    const own = this.units.get(this.me?.id);
    if (own) own.handles.group.visible = on;
  }

  // Draw the world (or the heat picture), then the cockpit on top.
  render(renderer) {
    super.render(renderer);
    if (this.cockpitOn && this.cockpit) {
      const auto = renderer.autoClear;
      renderer.autoClear = false;
      renderer.clearDepth();
      const far = this.cockpitCam;
      far.aspect = this.camera.aspect;
      far.fov = this.camera.fov;
      far.updateProjectionMatrix();
      renderer.render(this.cockpit.scene, far);
      renderer.autoClear = auto;
    }
  }

  showBannerOnce(key, text) {
    if (this.lastBanner === key) return;
    this.lastBanner = key;
    this.showBanner(text);
  }

  ensureCockpit() {
    if (this.cockpit) return;
    this.cockpit = buildCockpit(this.plane);
    this.cockpitCam = new THREE.PerspectiveCamera(66, 1, 0.02, 10);
    this.cockpitCam.rotation.order = 'YXZ';
  }

  updateCockpit(dt, self, me, look) {
    this.ensureCockpit();
    this.cockpitOn = true;
    this.cockpitCam.rotation.set(look.pitch, look.yaw, 0);
    this.instrT -= dt;
    if (this.instrT <= 0) {
      this.instrT = 0.09;
      drawInstruments(this.cockpit, self, me, this.plane, this.pingBearing(self, me));
    }
    this.cockpit.lever.position.z = -0.25 - (me.pl?.th ?? 0) * 0.18;
    // Warning shake when stalling.
    this.cockpit.root.position.y = me.pl?.stall ? (Math.random() - 0.5) * 0.012 : 0;
  }

  dispose() {
    if (this.me) this.showOwn(true);
    window.removeEventListener('mousemove', this.onMouseMove);
    super.dispose();
  }

  // Gunner's update bits this class doesn't use.
  updateHud() {}
}

// ---------- Pilot ----------
export class PilotView extends PlaneBase {
  constructor(opts) {
    super(opts);
    this.el.classList.add('pilot');
    this.$('.g-lock').textContent = 'Click to take control';
    this.look = { yaw: 0, pitch: 0 };
    this.refreshHints();
    this.$('.g-pingcd').style.display = 'none';
    this.onPing = null;
    this.bindFlight();
  }

  refreshHints() {
    this.$('.p-hint').textContent = `${flightHint(this.plane)} · ${keyName('plane.view')} 1st/3rd person · ${keyName('plane.ahead')} look ahead · ${keyName('plane.bail')} bail out`;
  }

  update(dt, states, me) {
    this.flyUpdate(dt, states, me);
  }
}

function fwdOf(u, out = new THREE.Vector3()) {
  return out.set(Math.sin(u.h) * Math.cos(u.gp), Math.sin(u.gp), Math.cos(u.h) * Math.cos(u.gp));
}

// ---------- Side gunner ----------
// Sits at the door with a minigun. Like a tank gunner, the aim stays on target while the
// plane manoeuvres; the gun turns anywhere on its mount except up past its stop.
const SIDE_MAX_PITCH = 0.6;
const SIDE_MIN_PITCH = -1.4;
const MOUNT_Y = -0.2;

export class PlaneGunnerView extends PlaneBase {
  constructor(opts) {
    super(opts);
    this.el.classList.add('rearg');
    this.bombSight = !!this.plane.bombardier; // no gun in this seat: it's all bomb sight
    this.drift = 0;
    this.spin = 0;
    this.lastSend = { key: '', at: 0 };
    this.thermalAction = 'door.thermal';
    this.refreshHints();
    this.bindFlight();
    // The minigun, drawn over the world so it never clips into the plane.
    this.gunScene = new THREE.Scene();
    this.gunScene.add(new THREE.HemisphereLight(0xe8ecf0, 0x4a4030, 1.15));
    const sun = new THREE.DirectionalLight(0xfff0d8, 1.9);
    sun.position.set(0.5, 1, 0.4);
    this.gunScene.add(sun);
    this.gunCam = new THREE.PerspectiveCamera(60, 1, 0.02, 10);
    const gun = buildMinigunViewmodel();
    this.mount = gun.group;
    this.barrels = gun.barrels;
    this.muzzle = gun.flash;
    // Low and to the right, angled in: the barrels run up towards the crosshair.
    this.mount.position.set(0.17, MOUNT_Y, -0.52);
    this.mount.rotation.set(0.14, 0.26, 0);
    this.gunScene.add(this.mount);
  }

  thermalActive() {
    return this.thermal;
  }

  refreshHints() {
    this.$('.g-pingcd b').textContent = keyName('door.ping');
    if (this.plane.bombardier) {
      this.$('.p-hint').textContent = `Bomb sight · ${keyName('door.fire')} drops · ${keyName('door.thermal')} thermal · ${keyName('door.ping')} ping · ${keyName('door.bail')} bail out`;
      return;
    }
    if (this.plane.operator) {
      this.$('.p-hint').textContent = `Mouse turns the camera · ${keyName('door.fire')} fires 2 rockets along the nose · ${keyName('door.thermal')} thermal · ${keyName('door.ping')} ping · ${keyName('door.bail')} bail out`;
      return;
    }
    this.$('.p-hint').textContent = `Mouse turns the gun · ${keyName('door.fire')} fires${this.plane.bombs ? ` · ${keyName('door.sight')} bomb sight (${keyName('door.fire')} drops)` : ''} · ${keyName('door.thermal')} thermal · ${keyName('door.ping')} ping · ${keyName('door.bail')} bail out`;
  }

  onLook(dx, dy) {
    if (this.bombSight) return;
    const k = 0.0022 * settings.sensitivity;
    const rear = this.plane.rear;
    const max = this.plane.operator ? 1.45 : rear?.up ? Math.asin(rear.up) : SIDE_MAX_PITCH;
    const min = this.plane.operator ? -1.45 : rear?.down !== undefined ? Math.asin(rear.down) : SIDE_MIN_PITCH;
    this.aim.yaw = wrapAngle(this.aim.yaw - dx * k);
    this.aim.pitch = Math.max(min, Math.min(max, this.aim.pitch - dy * k));
  }

  // Weapons operator: a camera under the nose. It turns with the plane, the mouse looks around from
  // there, and the rockets leave along the nose. Thermal comes from the base class.
  updateOperator(dt, self, me) {
    const k = this.keys;
    this.readButtons('door.fire');
    if (!this.paused) {
      if (k.hit('door.ping')) this.onPing?.();
      if (k.hit('door.bail')) net.send({ t: 'jump' });
    }
    this.followPlane(self);
    const cam = this.camera;
    this.planePoint(self, 0, -1.1, this.plane.size.length * 0.42, cam.position);
    cam.quaternion.setFromEuler(_e.set(this.aim.pitch, this.aim.yaw + Math.PI, 0));
    cam.fov += (45 - cam.fov) * Math.min(1, dt * 8);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    this.showOwn(false);
    this.world.update(cam.position, cam);
    if (!this.paused) {
      const rocket = !!this.mouseBtn.left;
      const now = performance.now();
      if (rocket !== this.lastSend.key || now - this.lastSend.at > 50) {
        const dir = cam.getWorldDirection(_v);
        net.send({ t: 'rear', dir: [+dir.x.toFixed(3), +dir.y.toFixed(3), +dir.z.toFixed(3)], fire: false, bomb: false, rocket });
        this.lastSend = { key: rocket, at: now };
      }
    }
    this.mount.visible = false;
    this.cockpitOn = false;
    this.$('.p-pipper').style.left = '50%';
    this.$('.p-pipper').style.top = '50%';
    this.planeHud(self, me);
  }

  update(dt, states, me) {
    this.me = me;
    this.states = states;
    this.renderDt = dt;
    this.thermalKey();
    const self = states.get(me.id);
    if (!self) return;
    if (this.plane.operator) return this.updateOperator(dt, self, me);
    const topTurret = !this.plane.door?.[0];
    if (!this.aim.initialised) {
      this.aim.yaw = topTurret ? self.h : self.h - Math.PI / 2; // ahead, or out of the door
      this.aim.pitch = topTurret ? 0.05 : -0.1;
      this.aim.initialised = true;
    }
    const k = this.keys;
    this.readButtons('door.fire');
    if (!this.paused) {
      if (k.hit('door.ping')) this.onPing?.();
      if (k.hit('door.bail')) net.send({ t: 'jump' });
      if (this.plane.bombs && !this.plane.bombardier && k.hit('door.sight')) this.bombSight = !this.bombSight;
    }
    const cam = this.camera;
    const [dx, dy, dz] = sideGunPos(this.tank);
    this.$('.p-bombsight').classList.toggle('on', this.bombSight);
    this.$('.p-pipper').style.display = this.bombSight ? 'none' : '';
    const own = this.units.get(me.id);
    if (own?.handles.rear) own.handles.rear.visible = this.bombSight;
    this.showOwn(true);
    if (this.bombSight) {
      // Straight down through the floor, zoomed.
      this.planePoint(self, 0, -(this.plane.bombs.sightY ?? 1.2), 0.5, cam.position);
      cam.quaternion.setFromEuler(_e.set(-Math.PI / 2, self.h + Math.PI, 0));
      cam.fov += (22 - cam.fov) * Math.min(1, dt * 8);
      // Which way should the pilot steer: a bank shifts the fall line.
      this.drift += (self.ty - this.drift) * Math.min(1, dt * 2);
      this.$('.p-drift').textContent = Math.abs(this.drift) < 0.05 ? 'STEADY' : this.drift > 0 ? 'STEER LEFT ◂' : '▸ STEER RIGHT';
    } else {
      // At the door, just over and outboard of the gun, looking along the aim.
      this.planePoint(self, dx - (topTurret ? 0 : 0.2), dy + (topTurret ? 1.6 : 0.42), dz - 0.1, cam.position);
      cam.quaternion.setFromEuler(_e.set(this.aim.pitch, this.aim.yaw + Math.PI, 0));
      cam.fov += (66 - cam.fov) * Math.min(1, dt * 8);
    }
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    this.world.update(cam.position, cam);

    const dir = cam.getWorldDirection(_v).clone();
    this.range = this.raycast(cam.position, dir, states, me.id);
    if (!this.paused) {
      const fire = !this.bombSight && this.mouseBtn.left;
      const bomb = this.bombSight && this.mouseBtn.left;
      const key = JSON.stringify([fire, bomb]);
      const now = performance.now();
      if (key !== this.lastSend.key || now - this.lastSend.at > 50) {
        net.send({ t: 'rear', dir: [+dir.x.toFixed(3), +dir.y.toFixed(3), +dir.z.toFixed(3)], fire, bomb });
        this.lastSend = { key, at: now };
      }
    }
    // Barrels spin up while the trigger is held.
    this.spin += ((this.mouseBtn.left && !this.bombSight ? 38 : 0) - this.spin) * Math.min(1, dt * 5);
    this.barrels.rotation.z += this.spin * dt;
    const firing = this.mouseBtn.left && !this.bombSight && (me.pl?.rear ?? 0) > 0;
    this.muzzle.visible = firing && Math.random() < 0.6;
    if (this.muzzle.visible) this.muzzle.rotation.z = Math.random() * 6;
    this.mount.position.y = MOUNT_Y + (firing ? (Math.random() - 0.5) * 0.004 : 0);
    this.cockpitOn = false;
    this.mount.visible = !this.bombSight;
    this.$('.p-pipper').style.left = '50%';
    this.$('.p-pipper').style.top = '50%';
    this.planeHud(self, me);
  }

  render(renderer) {
    super.render(renderer);
    if (!this.bombSight) {
      const auto = renderer.autoClear;
      renderer.autoClear = false;
      renderer.clearDepth();
      this.gunCam.aspect = this.camera.aspect;
      this.gunCam.updateProjectionMatrix();
      renderer.render(this.gunScene, this.gunCam);
      renderer.autoClear = auto;
    }
  }
}

// ---------- Solo ----------
export class PlaneSoloView extends PlaneBase {
  constructor(opts) {
    super(opts);
    this.el.classList.add('psolo');
    this.solo = true;
    this.$('.g-pingcd').style.display = 'none';
    this.onPing = null;
    this.camDist = null;
    this.$('.g-lock').textContent = 'Click to take control';
    this.thermalAction = 'planeSolo.thermal';
    this.refreshHints();
    this.bindFlight();
    this.look = { yaw: 0, pitch: 0 };
  }

  thermalActive() {
    return this.thermal && this.inCockpit;
  }

  refreshHints() {
    this.$('.p-hint').textContent = `${flightHint(this.plane)} · ${keyName('plane.view')} 1st/3rd person · ${keyName('plane.ahead')} look ahead · ${keyName('plane.bail')} bail out`;
  }

  update(dt, states, me) {
    this.thermalKey();
    this.flyUpdate(dt, states, me, 'planeSolo.cockpit');
  }
}

export function planeViewFor(role, opts) {
  if (role === 'solo') return new PlaneSoloView(opts);
  return role === 'gunner' ? new PlaneGunnerView(opts) : new PilotView(opts);
}
