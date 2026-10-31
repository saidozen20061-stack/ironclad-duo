import * as THREE from 'three';
import { TANKS, UNITS } from '../../../shared/constants.js';
import { tankPose, muzzlePose, sightPos, wrapAngle } from '../../../shared/tank.js';
import { groundAt, WATER_LEVEL, POINTS, BASES, MAP_SIZE } from '../../../shared/map.js';
import { net } from '../net.js';
import { settings } from '../settings.js';
import { terrainImage, worldToImage } from './mapImage.js';
import { propsNear, segmentHitsProp } from '../../../shared/props.js';

const ZOOMS = [1, 2, 6];
const BASE_FOV = 62;
const DEG = 180 / Math.PI;

const HUD_HTML = `
  <div class="g-scope"></div>
  <svg class="g-sight" viewBox="-100 -100 200 200">
    <g stroke="#f4e2b0" stroke-width="1.2" fill="none" opacity="0.9">
      <line x1="-90" y1="0" x2="-8" y2="0"/><line x1="8" y1="0" x2="90" y2="0"/>
      <line x1="0" y1="8" x2="0" y2="90"/>
      <path d="M -4 0 L 0 -6 L 4 0" stroke-width="1.6"/>
      <g stroke-width="1"><line x1="-6" y1="14" x2="6" y2="14"/><line x1="-4" y1="24" x2="4" y2="24"/><line x1="-6" y1="34" x2="6" y2="34"/><line x1="-4" y1="44" x2="4" y2="44"/></g>
      <g stroke-width="1"><line x1="-30" y1="-3" x2="-30" y2="3"/><line x1="-50" y1="-3" x2="-50" y2="3"/><line x1="30" y1="-3" x2="30" y2="3"/><line x1="50" y1="-3" x2="50" y2="3"/></g>
    </g>
  </svg>
  <div class="g-gunmark"></div>
  <div class="g-hitmark">✕</div>
  <div class="g-range"><span>RNG</span> <b>----</b> m</div>
  <div class="g-zoom">1×</div>
  <div class="g-banner"></div>
  <div class="g-weapon panel">
    <div class="w-name"></div>
    <div class="w-shells"></div>
    <div class="w-ammo"></div>
    <div class="w-reload"><i></i></div>
    <div class="w-state"></div>
    <div class="w-coax"></div>
  </div>
  <div class="g-hull panel">
    <svg viewBox="-50 -50 100 100">
      <circle r="44" fill="none" stroke="#a39f8c" stroke-opacity="0.4"/>
      <path d="M 0 -46 L -5 -38 L 5 -38 Z" fill="#d9a441"/>
      <g class="hull-rot"><rect x="-13" y="-22" width="26" height="44" rx="3" fill="#56708a" stroke="#cfe0f5" stroke-width="1.5"/><path d="M -7 -16 L 0 -26 L 7 -16" fill="none" stroke="#cfe0f5" stroke-width="2"/></g>
      <g class="turret-rot"><circle r="8" fill="#3c4f62" stroke="#cfe0f5" stroke-width="1.2"/><line x1="0" y1="0" x2="0" y2="-34" stroke="#cfe0f5" stroke-width="3"/></g>
    </svg>
    <div class="label">HULL</div>
    <div class="g-speed">0 km/h</div>
  </div>
  <canvas class="g-minimap panel" width="200" height="200"></canvas>
  <div class="g-mods panel"><div class="hp"><span>HULL</span><b>100%</b></div><div data-m="tracks">TRK</div><div data-m="engine">ENG</div><div data-m="turret">TUR</div><div data-m="gun">GUN</div><div data-m="radar">RAD</div></div>
  <div class="g-pingcd panel"><b>Q</b> PING <i><u></u></i><span></span></div>
  <div class="g-lock">Click to take the gun</div>
  <div class="g-dead"></div>
`;

export class GunnerView {
  constructor({ world, units, tank, hud, keys }) {
    this.world = world;
    this.units = units;
    this.spec = TANKS[tank];
    this.tank = tank;
    this.keys = keys;
    this.camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.1, 5000);
    this.camera.rotation.order = 'YXZ';
    this.zoomIdx = 0;
    this.aim = { yaw: 0, pitch: 0, initialised: false };
    this.lastAimSent = { yaw: NaN, pitch: NaN, at: 0 };
    this.trigger = { main: false, coax: false };
    this.range = null;
    this.pose = { y: 0, quat: new THREE.Quaternion(), up: new THREE.Vector3() };
    this.hitT = 0;
    this.bannerT = 0;

    this.el = document.createElement('div');
    this.el.className = 'hud gunner';
    this.el.innerHTML = HUD_HTML;
    hud.appendChild(this.el);
    this.$ = (s) => this.el.querySelector(s);
    this.minimap = this.$('.g-minimap').getContext('2d');
    this.mapBase = terrainImage(360);

    this.$('.w-name').textContent = this.spec.weapon.label;
    this.onPing = () => this.placePing();
    this.buildPingMarker();
    this.bind();
  }

  buildPingMarker() {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0xffd040, transparent: true, opacity: 0.55, fog: false, depthWrite: false });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 60, 6, 1, true), mat);
    beam.position.y = 30;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(4, 0.35, 4, 16), new THREE.MeshBasicMaterial({ color: 0xffd040, fog: false }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.5;
    g.add(beam, ring);
    g.visible = false;
    this.pingMarker = g;
    this.pingRing = ring;
    this.world.scene.add(g);
  }

  placePing() {
    if (this.paused || !this.me || this.me.pingCd > 0 || !this.range) {
      if (this.me?.pingCd > 0) this.showBanner(`PING READY IN ${Math.ceil(this.me.pingCd)}s`);
      return;
    }
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const p = this.camera.position.clone().addScaledVector(dir, this.range);
    net.send({ t: 'ping', x: +p.x.toFixed(2), z: +p.z.toFixed(2) });
  }

  // True when the mouse controls the gun: pointer locked, or the free-mouse fallback
  // used when the browser refuses pointer lock.
  aiming() {
    const canvas = document.getElementById('scene');
    return !this.paused && (document.pointerLockElement === canvas || this.freeMouse);
  }

  requestLock() {
    const canvas = document.getElementById('scene');
    const fail = () => {
      this.freeMouse = true;
      canvas.style.cursor = 'none';
    };
    try {
      const p = canvas.requestPointerLock?.();
      if (p?.catch) p.catch(fail);
      else if (!canvas.requestPointerLock) fail();
    } catch {
      fail();
    }
    // Some embedded browsers ignore the request silently.
    setTimeout(() => {
      if (document.pointerLockElement !== canvas && !this.paused) fail();
    }, 600);
  }

  bind() {
    const canvas = document.getElementById('scene');
    this.freeMouse = false;
    this.onLockError = () => {
      this.freeMouse = true;
      canvas.style.cursor = 'none';
    };
    document.addEventListener('pointerlockerror', this.onLockError);
    this.onMouseMove = (e) => {
      if (!this.aiming()) return;
      const zoom = ZOOMS[this.zoomIdx];
      const k = 0.0022 * settings.sensitivity / zoom;
      // Mouse right turns right: yaw decreases (yaw increases towards +X, which is left).
      this.aim.yaw = wrapAngle(this.aim.yaw - e.movementX * k);
      this.aim.pitch = Math.max(-0.45, Math.min(0.55, this.aim.pitch - e.movementY * k));
    };
    this.onMouseDown = (e) => {
      if (!this.aiming()) {
        if (e.target === canvas && !this.paused) this.requestLock();
        return;
      }
      if (e.button === 0) this.setTrigger('main', true);
      if (e.button === 2) {
        if (this.spec.weapon.coax) this.setTrigger('coax', true);
        else this.cycleZoom(1, true);
      }
      if (e.button === 1) {
        e.preventDefault();
        this.onPing?.();
      }
    };
    this.onMouseUp = (e) => {
      if (e.button === 0) this.setTrigger('main', false);
      if (e.button === 2) this.setTrigger('coax', false);
    };
    this.onWheel = (e) => {
      if (!this.aiming()) return;
      this.cycleZoom(e.deltaY < 0 ? 1 : -1);
    };
    this.onContext = (e) => e.preventDefault();
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('wheel', this.onWheel, { passive: true });
    window.addEventListener('contextmenu', this.onContext);
  }

  cycleZoom(dir, wrap = false) {
    let i = this.zoomIdx + dir;
    if (wrap) i = (i + ZOOMS.length) % ZOOMS.length;
    this.zoomIdx = Math.max(0, Math.min(ZOOMS.length - 1, i));
  }

  setTrigger(which, on) {
    if (this.trigger[which] === on) return;
    this.trigger[which] = on;
    net.send({ t: 'trigger', ...this.trigger });
  }

  setPaused(p) {
    this.paused = p;
    if (p) {
      this.setTrigger('main', false);
      this.setTrigger('coax', false);
    }
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  showHit(kill) {
    const hm = this.$('.g-hitmark');
    hm.classList.remove('show', 'kill');
    void hm.offsetWidth;
    hm.classList.add('show');
    if (kill) hm.classList.add('kill');
  }

  showBanner(text) {
    const b = this.$('.g-banner');
    b.textContent = text;
    b.classList.remove('show');
    void b.offsetWidth;
    b.classList.add('show');
  }

  update(dt, states, me) {
    this.me = me;
    const self = me && states.get(me.id);
    if (!self) return;

    // Active ping marker in the world.
    const mk = this.pingMarker;
    mk.visible = !!me.ping;
    if (me.ping) {
      mk.position.set(me.ping.x, groundAt(me.ping.x, me.ping.z), me.ping.z);
      const pulse = (performance.now() / 600) % 1;
      this.pingRing.scale.setScalar(1 + pulse * 1.5);
      // Shrink the marker when it's close so it doesn't swallow the gunner's view.
      const near = Math.hypot(me.ping.x - self.x, me.ping.z - self.z);
      mk.scale.setScalar(Math.max(0.15, Math.min(1, near / 80)));
    }

    if (!this.aim.initialised) {
      this.aim.yaw = self.h;
      this.aim.initialised = true;
    }

    // Shell switching (medium tank).
    if (this.spec.weapon.shells) {
      if (this.keys.took('Digit1')) net.send({ t: 'shell', shell: 'AP' });
      if (this.keys.took('Digit2')) net.send({ t: 'shell', shell: 'HE' });
    }
    if (this.keys.took('KeyQ')) this.onPing?.();

    // Send aim at ~20 Hz when it changes.
    const now = performance.now();
    if (now - this.lastAimSent.at > 50 && (this.aim.yaw !== this.lastAimSent.yaw || this.aim.pitch !== this.lastAimSent.pitch)) {
      net.send({ t: 'aim', yaw: +this.aim.yaw.toFixed(4), pitch: +this.aim.pitch.toFixed(4) });
      this.lastAimSent = { yaw: this.aim.yaw, pitch: this.aim.pitch, at: now };
    }

    // Camera rides the sight on the turret roof but looks where the gunner aims.
    tankPose(this.spec, self.x, self.z, self.h, this.pose);
    const cam = this.camera;
    sightPos(this.spec, this.pose, self.x, self.z, self.ty, cam.position);
    // Recoil kick from our own shots, settling quickly.
    this.kick = (this.kick ?? 0) * Math.max(0, 1 - dt * 10);
    cam.rotation.set(this.aim.pitch + this.kick, this.aim.yaw + Math.PI, (Math.random() - 0.5) * this.kick * 0.5);
    const zoom = ZOOMS[this.zoomIdx];
    const fov = 2 * Math.atan(Math.tan((BASE_FOV / 2 / DEG)) / zoom) * DEG;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov += (fov - cam.fov) * Math.min(1, dt * 14);
      cam.updateProjectionMatrix();
    }
    const own = this.units.get(me.id);
    if (own) own.handles.group.visible = zoom === 1;
    // Dev-only free camera for inspecting the map: __game.match.view.debugCam = { x, y, z, yaw, pitch }.
    if (import.meta.env.DEV && this.debugCam) {
      const d = this.debugCam;
      cam.position.set(d.x, d.y, d.z);
      cam.rotation.set(d.pitch ?? 0, (d.yaw ?? 0) + Math.PI, 0);
    }
    this.world.update(cam.position);

    // Range finder: what the crosshair is on.
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    this.range = this.raycast(cam.position, dir, states, me.id);

    // Where the gun actually points (lags behind the aim while the turret traverses).
    const mz = muzzlePose(this.spec, this.pose, self.x, self.z, self.ty, self.gp);
    const gunRange = this.raycast(mz.pos, mz.dir, states, me.id) ?? 800;
    const p = mz.pos.clone().addScaledVector(mz.dir, gunRange).project(cam);
    const gm = this.$('.g-gunmark');
    const onScreen = p.z < 1 && Math.abs(p.x) < 1.2 && Math.abs(p.y) < 1.2;
    gm.style.display = onScreen ? '' : 'none';
    if (onScreen) {
      gm.style.left = `${((p.x + 1) / 2) * 100}%`;
      gm.style.top = `${((1 - p.y) / 2) * 100}%`;
      const aligned = Math.hypot(p.x * cam.aspect, p.y) < 0.012;
      gm.classList.toggle('aligned', aligned);
    }

    this.updateHud(dt, self, me, states, zoom);
  }

  raycast(origin, dir, states, selfId) {
    let best = null;
    for (const u of states.values()) {
      if (u.id === selfId || u.dead) continue;
      const m = this.units.get(u.id);
      const cy = (m?.pose.y ?? 0) + 1.2;
      const ox = u.x - origin.x, oy = cy - origin.y, oz = u.z - origin.z;
      const t = ox * dir.x + oy * dir.y + oz * dir.z;
      if (t < 0 || t > 1500) continue;
      const d2 = ox * ox + oy * oy + oz * oz - t * t;
      const r = (TANKS[u.type] ?? UNITS[u.type]).size.width * 0.6;
      if (d2 < r * r && (best === null || t < best)) best = t;
    }
    // Buildings and other solid props, checked in 60 m chunks along the ray.
    const reach = Math.min(best ?? 1500, 1500);
    for (let s = 0; s < reach; s += 60) {
      const mx = origin.x + dir.x * (s + 30), mz = origin.z + dir.z * (s + 30);
      for (const p of propsNear(mx, mz, 45)) {
        if (!p.solid || this.deadProps?.has(p.id)) continue;
        const t = segmentHitsProp(p, origin.x, origin.y, origin.z, dir.x * 1500, dir.y * 1500, dir.z * 1500);
        if (t !== null && t * 1500 > 1 && (best === null || t * 1500 < best)) best = t * 1500;
      }
      if (best !== null && best < s) break;
    }
    let t = 2;
    const max = Math.min(best ?? 1500, 1500);
    while (t < max) {
      const x = origin.x + dir.x * t, y = origin.y + dir.y * t, z = origin.z + dir.z * t;
      if (y < Math.max(groundAt(x, z), WATER_LEVEL)) return t;
      t += t < 60 ? 1 : t < 300 ? 2.5 : 5;
    }
    return best;
  }

  updateHud(dt, self, me, states, zoom) {
    const $ = this.$;
    const w = this.spec.weapon;
    $('.g-lock').style.display = this.aiming() || this.paused ? 'none' : '';
    $('.g-scope').classList.toggle('on', zoom > 1);
    $('.g-zoom').textContent = `${zoom}×`;
    $('.g-range b').textContent = this.range ? String(Math.round(this.range)).padStart(4, ' ') : '----';

    // Weapon panel
    const ready = me.reload <= 0;
    let ammo = '';
    if (w.kind === 'autocannon') ammo = `${me.mag} / ${w.magazine}`;
    else ammo = ready ? 'LOADED' : 'LOADING';
    $('.w-ammo').textContent = ammo;
    if (w.shells) {
      $('.w-shells').innerHTML = ['AP', 'HE'].map((s, i) => `<span class="${me.shell === s ? 'sel' : ''}">${i + 1} ${s}</span>`).join('');
    }
    const frac = me.reload > 0 ? 1 - me.reload / me.reloadTotal : 1;
    const bar = $('.w-reload i');
    bar.style.width = `${frac * 100}%`;
    bar.classList.toggle('ready', ready);
    const gunDead = (me.mods?.gun ?? 1) <= 0;
    // Casemate guns: warn when the target is outside the gun's arc.
    const outOfArc = this.spec.traverse && Math.abs(wrapAngle(this.aim.yaw - self.h)) > this.spec.traverse + 0.05;
    $('.w-state').textContent = me.dead ? 'TANK DESTROYED' : gunDead ? 'GUN DESTROYED — driver must repair' : outOfArc ? 'OUT OF ARC — driver: turn the hull' : ready ? 'READY' : `RELOAD ${me.reload.toFixed(1)}s`;
    // Module diagram
    if (me.mods) {
      $('.g-mods .hp b').textContent = `${Math.round((me.hp / this.spec.hp) * 100)}%${me.burning ? ' 🔥' : ''}`;
      for (const [k, v] of Object.entries(me.mods)) {
        const el = $(`.g-mods [data-m="${k}"]`);
        el.className = v <= 0 ? 'dead' : v < 0.5 ? 'dmg' : '';
      }
    }
    if (w.coax) $('.w-coax').textContent = me.coaxReload > 0 ? `MG reloading ${me.coaxReload.toFixed(1)}s` : `MG ${me.coax} (RMB)`;

    // Ping cooldown
    const cd = me.pingCd ?? 0;
    $('.g-pingcd u').style.width = `${(1 - cd / 5) * 100}%`;
    $('.g-pingcd').classList.toggle('ready', cd <= 0);
    $('.g-pingcd span').textContent = cd > 0 ? `${cd.toFixed(1)}s` : me.ping ? `active ${Math.round(Math.hypot(me.ping.x - self.x, me.ping.z - self.z))}m` : 'ready';

    // Hull direction relative to where the gunner is looking.
    const rel = wrapAngle(self.h - this.aim.yaw);
    $('.hull-rot').setAttribute('transform', `rotate(${(-rel * DEG).toFixed(1)})`);
    const trel = wrapAngle(self.h + self.ty - this.aim.yaw);
    $('.turret-rot').setAttribute('transform', `rotate(${(-trel * DEG).toFixed(1)})`);
    $('.g-speed').textContent = `${Math.round(Math.abs(me.v) * 3.6)} km/h ${me.v < -0.2 ? 'R' : ''}`;

    // Hit marker / banner timers handled by CSS animation.
    const dead = $('.g-dead');
    dead.style.display = me.dead ? '' : 'none';
    if (me.dead) dead.innerHTML = `TANK DESTROYED<small>Respawning in ${Math.ceil(me.respawnIn)}s</small>`;

    this.drawMinimap(self, states);
  }

  drawMinimap(self, states) {
    const ctx = this.minimap;
    const S = 200;
    // Zoomed minimap: 600 m across, centred on the tank, north up.
    const span = 600;
    const k = S / span; // px per metre
    const img = this.mapBase;
    const imgScale = img.width / MAP_SIZE;
    const [cx, cy] = worldToImage(self.x, self.z, imgScale);
    ctx.save();
    ctx.clearRect(0, 0, S, S);
    ctx.globalAlpha = 0.9;
    const srcSpan = span * imgScale;
    ctx.drawImage(img, cx - srcSpan / 2, cy - srcSpan / 2, srcSpan, srcSpan, 0, 0, S, S);
    ctx.globalAlpha = 1;
    const toMap = (x, z) => [S / 2 + (self.x - x) * k, S / 2 + (self.z - z) * k];

    ctx.font = 'bold 13px Rajdhani, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const pt of POINTS) {
      let [px, py] = toMap(pt.x, pt.z);
      const out = px < 8 || px > S - 8 || py < 8 || py > S - 8;
      px = Math.max(10, Math.min(S - 10, px));
      py = Math.max(10, Math.min(S - 10, py));
      ctx.fillStyle = 'rgba(20,20,16,0.75)';
      ctx.beginPath();
      ctx.arc(px, py, out ? 8 : Math.max(8, pt.r * k), 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = this.pointColor?.(pt.id) ?? '#ddd';
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.fillText(pt.id, px, py + 1);
    }
    for (const [team, b] of Object.entries(BASES)) {
      const [px, py] = toMap(b.x, b.z);
      if (px < 0 || px > S || py < 0 || py > S) continue;
      ctx.fillStyle = team === 'blue' ? '#5fa0e0' : '#e0645a';
      ctx.fillRect(px - 5, py - 5, 10, 10);
    }

    for (const u of states.values()) {
      if (u.id === self.id || u.dead) continue;
      // Enemies only show once they're close enough to be spotted.
      if (u.team !== (this.team ?? 'blue') && Math.hypot(u.x - self.x, u.z - self.z) > 400) continue;
      const [px, py] = toMap(u.x, u.z);
      if (px < 0 || px > S || py < 0 || py > S) continue;
      ctx.fillStyle = u.team === (this.team ?? 'blue') ? '#7fd36a' : '#ff5a4a';
      ctx.beginPath();
      ctx.arc(px, py, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    if (this.me?.ping) {
      const [px, py] = toMap(this.me.ping.x, this.me.ping.z);
      ctx.strokeStyle = '#ffd040';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(Math.max(6, Math.min(S - 6, px)), Math.max(6, Math.min(S - 6, py)), 6, 0, Math.PI * 2);
      ctx.stroke();
    }
    this.drawExtraMinimap?.(ctx, toMap);

    // Own tank: view cone + hull arrow. In image space east is right, so a world
    // direction (sin a, cos a) maps to (-sin a, -cos a) on the canvas.
    const c = S / 2;
    const ay = this.aim.yaw;
    const half = Math.atan(Math.tan(this.camera.fov / 2 / DEG) * this.camera.aspect);
    ctx.fillStyle = 'rgba(244,226,176,0.18)';
    ctx.beginPath();
    ctx.moveTo(c, c);
    for (const a of [ay + half, ay - half]) ctx.lineTo(c - Math.sin(a) * 70, c - Math.cos(a) * 70);
    ctx.fill();
    ctx.translate(c, c);
    ctx.rotate(-self.h);
    ctx.fillStyle = '#5fa0e0';
    ctx.strokeStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(-5, 6);
    ctx.lineTo(5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  render(renderer) {
    renderer.render(this.world.scene, this.camera);
  }

  dispose() {
    document.removeEventListener('pointerlockerror', this.onLockError);
    document.getElementById('scene').style.cursor = '';
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('contextmenu', this.onContext);
    this.world.scene.remove(this.pingMarker);
    this.el.remove();
  }
}
