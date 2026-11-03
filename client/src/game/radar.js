import { RADAR_RANGE } from '../../../shared/constants.js';
import { POINTS } from '../../../shared/map.js';
import { obstacleImage, worldToImage } from './mapImage.js';

// Heading-up sweep radar drawn into a canvas (used as a texture on the driver's dashboard).
// Units only show as blips when the sweep passes them, then fade. Friendly = green,
// anything else = grey: the driver can't tell what a contact is.

const SWEEP_PERIOD = 2.2; // seconds per revolution
const BLIP_FADE = 2.4;

export class Radar {
  constructor(size = 512) {
    this.size = size;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = size;
    this.ctx = this.canvas.getContext('2d');
    this.sweep = 0; // screen angle, 0 = up, clockwise
    this.blips = new Map(); // id -> { x, z, t, friendly }
    this.noise = 0; // 0..1 electronics damage
    this.ping = null; // { x, z, t0 }
    this.obstacles = obstacleImage();
    this.time = 0;
  }

  // Screen-space bearing of a world point relative to the tank (0 = ahead, clockwise).
  bearing(tank, x, z) {
    const dx = x - tank.x;
    const dz = z - tank.z;
    const f = dx * Math.sin(tank.h) + dz * Math.cos(tank.h);
    const l = dx * Math.cos(tank.h) - dz * Math.sin(tank.h);
    return Math.atan2(-l, f); // left is negative (counter-clockwise)
  }

  update(dt, tank, states, selfTeam = 'blue') {
    this.time += dt;
    const prev = this.sweep;
    this.sweep = (this.sweep + (dt / SWEEP_PERIOD) * Math.PI * 2) % (Math.PI * 2);
    const wrapped = this.sweep < prev;
    const inSweep = (a) => {
      a = (a + Math.PI * 2) % (Math.PI * 2);
      return wrapped ? a > prev || a <= this.sweep : a > prev && a <= this.sweep;
    };
    // Damaged electronics miss contacts and see ghosts.
    const missChance = this.noise * 0.7;
    for (const u of states.values()) {
      if (u.id === tank.id || u.dead) continue;
      const d = Math.hypot(u.x - tank.x, u.z - tank.z);
      if (d > RADAR_RANGE) continue;
      if (inSweep(this.bearing(tank, u.x, u.z)) && Math.random() >= missChance) {
        const jitter = this.noise * 8;
        this.blips.set(u.id, {
          x: u.x + (Math.random() - 0.5) * jitter,
          z: u.z + (Math.random() - 0.5) * jitter,
          t: this.time,
          friendly: u.team === selfTeam,
        });
      }
    }
    if (this.noise > 0.2 && Math.random() < this.noise * dt * 6) {
      const a = this.sweep + tank.h;
      const r = Math.random() * RADAR_RANGE;
      this.blips.set(`ghost${Math.random()}`, { x: tank.x - Math.sin(a) * r, z: tank.z + Math.cos(a) * r, t: this.time, friendly: false });
    }
    for (const [id, b] of this.blips) if (this.time - b.t > BLIP_FADE) this.blips.delete(id);
  }

  draw(tank, turretRel = 0) {
    const ctx = this.ctx;
    const S = this.size;
    const c = S / 2;
    const R = S / 2 - 18;
    const k = R / RADAR_RANGE; // px per metre
    const blank = this.noise >= 0.98;

    ctx.save();
    ctx.fillStyle = '#04120c';
    ctx.fillRect(0, 0, S, S);
    ctx.beginPath();
    ctx.arc(c, c, R, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#062016';
    ctx.fillRect(0, 0, S, S);

    if (blank) {
      this.drawStatic(ctx, S, 0.9);
      ctx.restore();
      this.drawText(ctx, c, 'NO SIGNAL', '#3f8a5c');
      return;
    }

    // Obstacles (map image rotated heading-up around the tank).
    const ob = this.obstacles;
    const [ix, iy] = worldToImage(tank.x, tank.z, ob.scale);
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(tank.h);
    ctx.scale(k / ob.scale, k / ob.scale);
    ctx.globalAlpha = 0.85 - this.noise * 0.5;
    ctx.drawImage(ob.canvas, -ix, -iy);
    ctx.restore();

    // Range rings + crosshair
    ctx.strokeStyle = 'rgba(90,220,140,0.22)';
    ctx.lineWidth = 1.5;
    for (const r of [40, 80, 120]) {
      ctx.beginPath();
      ctx.arc(c, c, r * k, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(c, c - R);
    ctx.lineTo(c, c + R);
    ctx.moveTo(c - R, c);
    ctx.lineTo(c + R, c);
    ctx.stroke();

    // Sweep with trailing glow
    const flicker = this.noise > 0 ? 1 - Math.random() * this.noise * 0.6 : 1;
    for (let i = 0; i < 24; i++) {
      const a0 = this.sweep - (i + 1) * 0.035;
      ctx.fillStyle = `rgba(90,255,150,${(0.16 * (1 - i / 24) * flicker).toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(c, c);
      ctx.arc(c, c, R, a0 - Math.PI / 2, a0 + 0.035 - Math.PI / 2);
      ctx.fill();
    }
    ctx.strokeStyle = `rgba(140,255,180,${0.9 * flicker})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.lineTo(c + Math.sin(this.sweep) * R, c - Math.cos(this.sweep) * R);
    ctx.stroke();

    // Blips
    const toScreen = (x, z) => {
      const dx = x - tank.x;
      const dz = z - tank.z;
      const f = dx * Math.sin(tank.h) + dz * Math.cos(tank.h);
      const l = dx * Math.cos(tank.h) - dz * Math.sin(tank.h);
      return [c - l * k, c - f * k];
    };
    for (const b of this.blips.values()) {
      const age = (this.time - b.t) / BLIP_FADE;
      const [sx, sy] = toScreen(b.x, b.z);
      const a = Math.max(0, 1 - age);
      ctx.fillStyle = b.friendly ? `rgba(110,255,120,${a})` : `rgba(200,210,200,${a})`;
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(sx, sy, 7, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;

    // Capture points: inside range drawn in place, otherwise letters on the rim.
    ctx.font = 'bold 26px Rajdhani, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const onRim = [];
    for (const pt of this.hidePoints ? [] : POINTS) {
      let [sx, sy] = toScreen(pt.x, pt.z);
      const dist = Math.hypot(pt.x - tank.x, pt.z - tank.z);
      const col = this.pointColor?.(pt.id) ?? 'rgba(230,230,200,0.9)';
      if (dist > RADAR_RANGE - 8) {
        let ang = Math.atan2(sx - c, -(sy - c));
        // Two flags the same way go side by side on the rim, not on top of each other.
        const gap = 36 / (R - 22);
        for (let n = 0; n < POINTS.length && onRim.some((a) => Math.abs(Math.atan2(Math.sin(a - ang), Math.cos(a - ang))) < gap); n++) ang += gap;
        onRim.push(ang);
        sx = c + Math.sin(ang) * (R - 22);
        sy = c - Math.cos(ang) * (R - 22);
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.beginPath();
        ctx.arc(sx, sy, 17, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.strokeStyle = col;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.arc(sx, sy, pt.r * k, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.fillStyle = col;
      ctx.fillText(pt.id, sx, sy + 1);
    }

    this.drawPing(ctx, tank, toScreen, c, R, k);

    if (this.noise > 0.05) this.drawStatic(ctx, S, this.noise * 0.5);
    ctx.restore();

    // Own tank + turret direction (always on top).
    ctx.strokeStyle = 'rgba(255,220,140,0.55)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.lineTo(c - Math.sin(turretRel) * 46, c - Math.cos(turretRel) * 46);
    ctx.stroke();
    ctx.fillStyle = '#b8ffc8';
    ctx.beginPath();
    ctx.moveTo(c, c - 13);
    ctx.lineTo(c - 9, c + 10);
    ctx.lineTo(c + 9, c + 10);
    ctx.closePath();
    ctx.fill();

    // Bezel
    ctx.strokeStyle = '#2a4a38';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(c, c, R + 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(140,255,180,0.6)';
    ctx.font = 'bold 18px Rajdhani, sans-serif';
    ctx.fillText('120m', c + R * 0.72, c + R * 0.95);
  }

  drawPing(ctx, tank, toScreen, c, R, k) {
    if (!this.ping) return;
    const p = this.ping;
    const age = this.time - p.t0;
    let [sx, sy] = toScreen(p.x, p.z);
    const dist = Math.hypot(p.x - tank.x, p.z - tank.z);
    const out = Math.hypot(sx - c, sy - c) > R - 26;
    if (out) {
      const ang = Math.atan2(sx - c, -(sy - c));
      sx = c + Math.sin(ang) * (R - 26);
      sy = c - Math.cos(ang) * (R - 26);
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(ang);
      ctx.fillStyle = '#ffd040';
      ctx.beginPath();
      ctx.moveTo(0, -20);
      ctx.lineTo(-13, 4);
      ctx.lineTo(13, 4);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    const pulse = (age * 1.6) % 1;
    ctx.strokeStyle = `rgba(255,208,64,${1 - pulse})`;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(sx, sy, 10 + pulse * 36, 0, Math.PI * 2);
    ctx.stroke();
    if (!out) {
      ctx.fillStyle = '#ffd040';
      ctx.beginPath();
      ctx.arc(sx, sy, 9, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#ffe58a';
    ctx.font = 'bold 22px Rajdhani, sans-serif';
    ctx.fillText(`${Math.round(dist)}m`, sx, sy + (sy > c ? -30 : 30));
  }

  drawStatic(ctx, S, amount) {
    const n = Math.floor(400 * amount);
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = `rgba(150,255,190,${Math.random() * 0.5})`;
      ctx.fillRect(Math.random() * S, Math.random() * S, 2 + Math.random() * 6, 1 + Math.random() * 2);
    }
    if (Math.random() < amount * 0.3) {
      ctx.fillStyle = 'rgba(150,255,190,0.08)';
      ctx.fillRect(0, Math.random() * S, S, 8 + Math.random() * 30);
    }
  }

  drawText(ctx, c, text, color) {
    ctx.fillStyle = color;
    ctx.font = 'bold 40px Rajdhani, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(text, c, c);
  }
}
