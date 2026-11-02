import * as THREE from 'three';

// The selected vehicle, big and clear: its own little scene (turntable, spotlight, nothing
// else) drawn over the garage into the rectangle of a page element, so nothing in the garage
// can cover or darken it. Turns slowly on its own; drag to turn it by hand.

const FOV = 30;
const ELEVATION = 0.3;

export class VehiclePreview {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 300);
    this.el = null;
    this.key = null;
    this.spin = new THREE.Group();
    this.scene.add(this.spin);
    this.holder = new THREE.Group();
    this.spin.add(this.holder);
    this.t = 0;
    this.anim = 1;
    this.drag = null;
    this.radius = 5;
    this.centerY = 1;

    this.scene.add(new THREE.HemisphereLight(0xfff0dc, 0x3a3428, 0.9));
    this.spot = new THREE.SpotLight(0xfff0d8, 900, 0, 0.55, 0.5, 1.6);
    this.spot.position.set(5, 18, 8);
    this.spot.castShadow = true;
    this.spot.shadow.mapSize.set(1024, 1024);
    this.spot.shadow.bias = -0.0006;
    this.spot.shadow.normalBias = 0.04;
    this.scene.add(this.spot, this.spot.target);
    const rim = new THREE.DirectionalLight(0xbcd4ff, 0.8);
    rim.position.set(-8, 6, -10);
    this.scene.add(rim);

    // Turntable: a low steel disc with a ring of hazard marks.
    const table = new THREE.Group();
    const steel = new THREE.MeshStandardMaterial({ color: 0x4a4d48, roughness: 0.55, metalness: 0.5, flatShading: true });
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.03, 0.18, 48), steel);
    disc.position.y = -0.09;
    disc.receiveShadow = true;
    table.add(disc);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.93, 0.98, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xd9a441, roughness: 0.7 }));
    ring.position.y = 0.005;
    table.add(ring);
    this.table = table;
    this.spin.add(table);

    // Pool of spotlight on the dark floor; the page behind stays visible around it.
    this.backdrop = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.999, 1.0); }',
        fragmentShader: 'varying vec2 vUv; void main() { vec2 e = abs(vUv - 0.5) * 2.0; float d = max(e.x, e.y); gl_FragColor = vec4(0.06, 0.065, 0.055, 0.97 * (1.0 - smoothstep(0.86, 1.0, d))); }',
      }),
    );
    this.backdrop.frustumCulled = false;
    this.backdrop.renderOrder = -10;
    this.scene.add(this.backdrop);

    this.onDown = (e) => {
      this.drag = { x: e.clientX, id: e.pointerId };
      this.el.setPointerCapture?.(e.pointerId);
      this.el.classList.add('dragging');
    };
    this.onMove = (e) => {
      if (!this.drag || e.pointerId !== this.drag.id) return;
      this.spin.rotation.y += (e.clientX - this.drag.x) * 0.012;
      this.drag.x = e.clientX;
      this.idle = 0;
    };
    this.onUp = () => {
      this.drag = null;
      this.el?.classList.remove('dragging');
    };
  }

  // Show on this page element (null hides the preview).
  attach(el) {
    if (el === this.el) return;
    this.detach();
    this.el = el;
    if (!el) return;
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointercancel', this.onUp);
  }

  detach() {
    const el = this.el;
    if (!el) return;
    el.removeEventListener('pointerdown', this.onDown);
    el.removeEventListener('pointermove', this.onMove);
    el.removeEventListener('pointerup', this.onUp);
    el.removeEventListener('pointercancel', this.onUp);
    this.el = null;
  }

  // key: identifies the model and paint; build() returns an Object3D with its base at y = 0.
  set(key, build) {
    if (key === this.key) return;
    this.key = key;
    this.holder.clear();
    const obj = build();
    obj.position.set(0, 0, 0);
    obj.rotation.set(0, 0, 0);
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    const c = box.getCenter(new THREE.Vector3());
    obj.position.x -= c.x;
    obj.position.z -= c.z;
    obj.traverse((o) => {
      if (o.isMesh) o.castShadow = o.receiveShadow = true;
    });
    this.holder.add(obj);
    this.radius = Math.max(1.5, Math.hypot(size.x, size.z) / 2);
    this.height = size.y;
    this.table.scale.set(this.radius * 1.08, 1, this.radius * 1.08);
    this.anim = 0;
  }

  update(dt) {
    this.t += dt;
    this.idle = (this.idle ?? 1) + dt;
    if (!this.drag && this.idle > 0.8) this.spin.rotation.y += dt * 0.35;
    this.anim = Math.min(1, this.anim + dt * 4);
    const k = 1 - (1 - this.anim) ** 3;
    this.holder.position.x = (1 - k) * this.radius * 1.2;
    this.holder.position.y = (1 - k) * 0.5;
    const s = 0.82 + 0.18 * k;
    this.holder.scale.setScalar(s);
    this.spot.target.position.set(0, this.height * 0.3, 0);
    this.spot.position.set(this.radius * 1.2, this.radius * 3.6 + 6, this.radius * 1.8);
    this.spot.intensity = 70 * (this.radius * 3.6 + 6) ** 0.8 * Math.min(1, 0.6 + k * 0.4);
    this.spot.shadow.camera.far = this.radius * 8 + 30;
  }

  render(renderer) {
    if (!this.el) return;
    const r = this.el.getBoundingClientRect();
    if (r.width < 40 || r.height < 40) return;
    const canvas = renderer.domElement.getBoundingClientRect();
    const x = r.left - canvas.left, y = canvas.bottom - r.bottom;
    const aspect = r.width / r.height;
    const cam = this.camera;
    cam.aspect = aspect;
    cam.updateProjectionMatrix();
    // Frame the whole model: it has to fit both across and up, at any window shape.
    const half = Math.tan((FOV / 2) * (Math.PI / 180));
    const needed = (this.radius * 1.14) / (half * Math.min(1, aspect));
    const up = (this.height * 0.5 + this.radius * Math.sin(ELEVATION) + 0.6) / half;
    const dist = Math.max(needed, up);
    const cy = this.height * 0.42;
    cam.position.set(0, cy + Math.sin(ELEVATION) * dist, Math.cos(ELEVATION) * dist);
    cam.lookAt(0, cy, 0);

    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setViewport(x, y, r.width, r.height);
    renderer.setScissor(x, y, r.width, r.height);
    renderer.setScissorTest(true);
    renderer.clearDepth();
    renderer.render(this.scene, cam);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, canvas.width, canvas.height);
    renderer.autoClear = autoClear;
  }
}
