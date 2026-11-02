import { PROPS, setFortress, fortressOn } from '../../../shared/props.js';
import { mulberry32 } from '../../../shared/noise.js';
import { propParts } from './props.js';

// Dev-only check of every structure generator. For one prop of each type it reports:
//  - parts that don't touch any neighbour and don't reach the ground (floating pieces),
//  - axis-aligned parts sharing a face plane with overlapping area (they would z-fight).
// Runs when a match world is built in dev; also __game.checkStructures().

const GAP = 0.06; // a part this close counts as touching
const GROUND = 0.15;
const AREA = 0.02;

function bounds(geo) {
  geo.computeBoundingBox();
  return geo.boundingBox;
}

function touching(a, b) {
  return a.min.x <= b.max.x + GAP && b.min.x <= a.max.x + GAP && a.min.y <= b.max.y + GAP && b.min.y <= a.max.y + GAP && a.min.z <= b.max.z + GAP && b.min.z <= a.max.z + GAP;
}

// An unrotated box: 36 vertices, every normal along an axis.
function isAxisBox(geo) {
  const n = geo.attributes.normal;
  if (!n || n.count !== 36) return false;
  for (let i = 0; i < n.count; i++) {
    const m = Math.max(Math.abs(n.getX(i)), Math.abs(n.getY(i)), Math.abs(n.getZ(i)));
    if (m < 0.999) return false;
  }
  return true;
}

const overlap = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

function sharedFace(a, b) {
  const axes = ['x', 'y', 'z'];
  for (const k of axes) {
    const [u, v] = axes.filter((q) => q !== k);
    const area = overlap(a.min[u], a.max[u], b.min[u], b.max[u]) * overlap(a.min[v], a.max[v], b.min[v], b.max[v]);
    if (area < AREA) continue;
    if (Math.abs(a.max[k] - b.max[k]) < 0.004) return `+${k}`;
    if (k !== 'y' && Math.abs(a.min[k] - b.min[k]) < 0.004) return `-${k}`; // shared bottoms stay buried
  }
  return null;
}

export function checkStructures({ log = true } = {}) {
  const hadFort = fortressOn();
  setFortress(true);
  const seen = new Set();
  const problems = [];
  for (const p of PROPS) {
    if (seen.has(p.type)) continue;
    seen.add(p.type);
    const parts = propParts(p, mulberry32(p.id * 7919 + 13));
    const boxes = parts.map((g) => bounds(g).clone());
    // Group parts that touch, then each group must reach the ground.
    const group = parts.map((_, i) => i);
    const find = (i) => (group[i] === i ? i : (group[i] = find(group[i])));
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (touching(boxes[i], boxes[j])) group[find(i)] = find(j);
    const grounded = new Set();
    boxes.forEach((b, i) => {
      if (b.min.y <= GROUND) grounded.add(find(i));
    });
    boxes.forEach((b, i) => {
      if (!grounded.has(find(i))) problems.push({ type: p.type, issue: 'floating', part: i, y: +b.min.y.toFixed(2) });
    });
    const axis = parts.map(isAxisBox);
    for (let i = 0; i < parts.length; i++) {
      if (!axis[i]) continue;
      for (let j = i + 1; j < parts.length; j++) {
        if (!axis[j]) continue;
        const face = sharedFace(boxes[i], boxes[j]);
        if (face) problems.push({ type: p.type, issue: 'coplanar', parts: [i, j], face });
      }
    }
  }
  if (!hadFort) setFortress(false);
  if (log) {
    if (problems.length) console.warn(`[structures] ${problems.length} problem(s) in ${seen.size} types`, problems);
    else console.info(`[structures] ${seen.size} types checked, all parts connected`);
  }
  return problems;
}
