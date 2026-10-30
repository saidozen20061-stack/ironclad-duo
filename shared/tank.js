// Tank pose and gun kinematics shared by server (hit tests, muzzle) and client (rendering).
import { Vector3, Quaternion, Matrix4 } from 'three';
import { groundAt } from './map.js';

const _f = new Vector3();
const _l = new Vector3();
const _u = new Vector3();
const _m = new Matrix4();

export const forwardOf = (h) => [Math.sin(h), Math.cos(h)];

// Hull pose from planar position + heading, tilted to sit on the ground under its tracks.
// Returns { y, quat, up } where quat maps hull-local (X=left, Y=up, Z=forward) to world.
export function tankPose(spec, x, z, h, out = { y: 0, quat: new Quaternion(), up: new Vector3() }) {
  const L = spec.size.length * 0.42;
  const W = spec.size.width * 0.42;
  const fx = Math.sin(h);
  const fz = Math.cos(h);
  const lx = fz; // left = (cos h, 0, -sin h)
  const lz = -fx;
  const hf = groundAt(x + fx * L, z + fz * L);
  const hb = groundAt(x - fx * L, z - fz * L);
  const hl = groundAt(x + lx * W, z + lz * W);
  const hr = groundAt(x - lx * W, z - lz * W);
  out.y = (hf + hb + hl + hr) / 4;
  _f.set(fx * 2 * L, hf - hb, fz * 2 * L).normalize();
  _l.set(lx * 2 * W, hl - hr, lz * 2 * W).normalize();
  _u.crossVectors(_f, _l).normalize();
  _l.crossVectors(_u, _f).normalize();
  _m.makeBasis(_l, _u, _f);
  out.quat.setFromRotationMatrix(_m);
  out.up.copy(_u);
  return out;
}

const _q = new Quaternion();
const _qy = new Quaternion();
const _qx = new Quaternion();
const _v = new Vector3();
const AX_Y = new Vector3(0, 1, 0);
const AX_X = new Vector3(1, 0, 0);

// World-space muzzle position and barrel direction.
export function muzzlePose(spec, pose, x, z, turretYaw, elevation, outPos = new Vector3(), outDir = new Vector3()) {
  const m = spec.mount;
  _qy.setFromAxisAngle(AX_Y, turretYaw);
  _qx.setFromAxisAngle(AX_X, -elevation);
  // gun-local barrel tip -> turret frame
  _v.set(0, 0, m.barrel).applyQuaternion(_qx);
  _v.x += m.gun[0];
  _v.y += m.gun[1];
  _v.z += m.gun[2];
  // turret frame -> hull frame
  _v.applyQuaternion(_qy);
  _v.x += m.turret[0];
  _v.y += m.turret[1];
  _v.z += m.turret[2];
  outPos.copy(_v).applyQuaternion(pose.quat);
  outPos.x += x;
  outPos.y += pose.y;
  outPos.z += z;
  _q.copy(pose.quat).multiply(_qy).multiply(_qx);
  outDir.set(0, 0, 1).applyQuaternion(_q);
  return { pos: outPos, dir: outDir };
}

// Gunner sight position (rides on the turret roof).
export function sightPos(spec, pose, x, z, turretYaw, out = new Vector3()) {
  const m = spec.mount;
  _qy.setFromAxisAngle(AX_Y, turretYaw);
  out.set(m.sight[0], m.sight[1], m.sight[2]).applyQuaternion(_qy);
  out.x += m.turret[0];
  out.y += m.turret[1];
  out.z += m.turret[2];
  out.applyQuaternion(pose.quat);
  out.x += x;
  out.y += pose.y;
  out.z += z;
  return out;
}

// Slope of the hull plane along a world yaw direction (radians, + = nose up).
export function planePitchAlong(up, yaw) {
  const dx = Math.sin(yaw);
  const dz = Math.cos(yaw);
  return Math.atan(-(up.x * dx + up.z * dz) / Math.max(0.2, up.y));
}

export function wrapAngle(a) {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

export function yawOf(dx, dz) {
  return Math.atan2(dx, dz);
}
