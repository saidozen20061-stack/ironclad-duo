import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Low-poly rocket and bomb. Built along +Y, then turned so the nose points along +Z like everything else.
const OLIVE = 0x8a9562;
const OLIVE_D = 0x687248;
const STEEL = 0xa4a8aa;
const DARK = 0x46484a;
const YELLOW = 0xd8b030;
const RED = 0xa8382a;

function tinted(geo, color) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('uv');
  return g;
}

const tube = (color, y, len, rNose, rTail = rNose, sides = 8) => tinted(new THREE.CylinderGeometry(rNose, rTail, len, sides).translate(0, y, 0), color);

function fins(color, y, span, height, out) {
  const parts = [];
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.BoxGeometry(span, height, 0.03).translate(out, y, 0).rotateY((i * Math.PI) / 2);
    parts.push(tinted(fin, color));
  }
  return parts;
}

const finish = (parts) => mergeGeometries(parts).rotateX(Math.PI / 2);

// 2.8 m long, drawn a little oversized so it reads in flight.
export function rocketGeometry() {
  return finish([
    tube(OLIVE, -0.05, 1.8, 0.17),
    tube(YELLOW, 0.72, 0.1, 0.178),
    tube(RED, 0.5, 0.06, 0.176),
    tube(STEEL, 1.15, 0.6, 0.02, 0.17),
    tube(DARK, -1.07, 0.25, 0.15, 0.11),
    ...fins(OLIVE_D, -0.72, 0.34, 0.5, 0.3),
  ]);
}

// 2.2 m long: round nose, fat body, tapered tail inside a box fin.
export function bombGeometry() {
  const nose = new THREE.SphereGeometry(0.3, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 1.25, 1).translate(0, 0.45, 0);
  return finish([
    tinted(nose, OLIVE_D),
    tube(OLIVE, 0, 0.9, 0.3),
    tube(YELLOW, 0.32, 0.09, 0.308),
    tube(YELLOW, -0.3, 0.09, 0.308),
    tube(OLIVE, -0.8, 0.7, 0.3, 0.09),
    ...fins(OLIVE_D, -0.95, 0.3, 0.42, 0.24),
    tube(OLIVE_D, -1.05, 0.2, 0.39, 0.39, 4),
  ]);
}

export const ROCKET_TAIL = -1.2;

// The rocket's exhaust: base at the origin, point towards -Z, so it can flicker in length.
export function flameGeometry() {
  return new THREE.ConeGeometry(0.16, 0.9, 7).translate(0, 0.45, 0).rotateX(-Math.PI / 2);
}
