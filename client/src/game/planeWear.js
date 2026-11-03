import * as THREE from 'three';
import { net } from '../net.js';
import { PLANES } from '../../../shared/planes.js';
import { groundAt } from '../../../shared/map.js';

// Damaged planes come apart where you can see it: each engine in turn starts to smoke and then burn,
// with a bang and flying pieces as it goes, and a wreck leaves a fire trail all the way down.
// Driven by the game's 20-a-second updates, with a budget, so a big air battle can't eat the frame rate.
const NEAR = 700; // m: further away only the big ones are worth drawing
const BUDGET = 16; // puffs per update, across all planes

const _e = new THREE.Euler();
const _p = new THREE.Vector3();

function engineSpots(spec) {
  if (spec.id === 'leviathan') return [[-17.5, 6.2, -8], [17.5, 6.2, -8], [-25, 6.4, -12], [25, 6.4, -12]];
  if (spec.engines === 1) return [[0, 0, spec.size.length * (spec.afterburner ? -0.42 : 0.32)]];
  const x = spec.size.width * 0.16;
  return [[-x, 0, spec.size.length * 0.08], [x, 0, spec.size.length * 0.08]];
}

// This engine's turn: the first one goes at 80% health on a four-engine plane, the last at 20%.
const smokesBelow = (i, n) => 1 - (i + 1) / (n + 1);

export class PlaneWear {
  constructor(getMatch) {
    this.getMatch = getMatch;
    this.stage = new Map(); // id -> how many engines have gone so far
    this.off = net.on('s', () => this.tick());
  }

  tick() {
    const match = this.getMatch();
    const fx = match?.fx;
    const cam = match?.view?.camera?.position;
    const units = match?.buffer?.latest?.units;
    if (!fx || !cam || !units || match.view.isFoot === undefined && !match.view.isPlane && !match.view.camera) return;
    let budget = BUDGET;
    for (const u of units.values()) {
      const spec = PLANES[u.type];
      if (!spec || budget <= 0) continue;
      const far = spec.seeFar ? NEAR * 2 : NEAR;
      if (Math.hypot(u.x - cam.x, u.y - cam.y, u.z - cam.z) > far) {
        this.stage.set(u.id, this.goneAt(u, spec));
        continue;
      }
      budget -= u.dead ? this.fallingFire(fx, u, spec) : this.engines(fx, u, spec);
    }
  }

  goneAt(u, spec) {
    const n = engineSpots(spec).length;
    let gone = 0;
    for (let i = 0; i < n; i++) if (u.hp < smokesBelow(i, n)) gone = i + 1;
    return gone;
  }

  at(u, [x, y, z]) {
    return _p.set(x, y, z).applyEuler(_e.set(-u.gp, u.h, u.ty, 'YXZ')).add(new THREE.Vector3(u.x, u.y, u.z)).clone();
  }

  engines(fx, u, spec) {
    const spots = engineSpots(spec);
    const k = Math.min(3, Math.max(0.7, spec.size.width / 18));
    const gone = this.goneAt(u, spec);
    const was = this.stage.get(u.id);
    this.stage.set(u.id, gone);
    // Just lost one: a bang and pieces, but not for a plane we've only just seen.
    if (was !== undefined && gone > was) {
      const pos = this.at(u, spots[gone - 1]);
      fx.explosion(pos, 2.4 * k);
      for (let i = 0; i < 8; i++) {
        fx.particle({ geo: fx.chunkGeo, mat: fx.mats.dirt, pos: pos.clone(), vel: new THREE.Vector3((Math.random() - 0.5) * 14, Math.random() * 7, (Math.random() - 0.5) * 14), size: 0.5 * k, life: 3, gravity: 1, fade: 0, spin: true });
      }
    }
    let used = 0;
    for (let i = 0; i < gone; i++) {
      // A little longer after it goes, this engine is on fire rather than just smoking.
      const burning = u.hp < smokesBelow(i, spots.length) - 0.25;
      if (Math.random() > (burning ? 0.8 : 0.45)) continue;
      const pos = this.at(u, spots[i]);
      fx.particle({ geo: fx.puffGeo, mat: fx.mats.smoke, pos: pos.clone(), vel: new THREE.Vector3(0, 1.2, 0), size: 0.5 * k, grow: 1.6, life: 2.4, fade: 0.7 });
      used++;
      if (burning) {
        fx.particle({ geo: fx.puffGeo, mat: fx.mats.fire, pos, vel: new THREE.Vector3(0, 0.6, 0), size: 0.45 * k, grow: 0.6, life: 0.45, fade: 0.2 });
        used++;
      }
    }
    return used;
  }

  fallingFire(fx, u, spec) {
    if (u.y - groundAt(u.x, u.z) < 3) return 0; // already on the ground: the normal wreck smoke takes over
    const k = Math.min(3, Math.max(0.8, spec.size.width / 16));
    const pos = new THREE.Vector3(u.x, u.y, u.z);
    fx.particle({ geo: fx.puffGeo, mat: fx.mats.smoke, pos: pos.clone(), vel: new THREE.Vector3(0, 1, 0), size: 0.8 * k, grow: 2, life: 3, fade: 0.7 });
    fx.particle({ geo: fx.puffGeo, mat: fx.mats.fire, pos, vel: new THREE.Vector3(0, 0.5, 0), size: 0.7 * k, grow: 0.8, life: 0.5, fade: 0.2 });
    return 2;
  }

  dispose() {
    this.off();
  }
}
