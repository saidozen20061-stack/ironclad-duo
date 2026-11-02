import * as THREE from 'three';
import { renderer } from '../render.js';
import { quality } from '../settings.js';

// Thermal sight: the world is drawn once more as a heat picture (one value per pixel), then
// a full-screen pass turns heat into the camera image: cold is black to dark green, warm is
// light green to white, hot glows red and white. Grain, scanlines, slight blur and white-out
// from nearby explosions on top.
//
// Layers: 0 = world, 1 = translucent particles (second pass), 2 = never in the heat picture.
export const LAYER_FX = 1;
export const LAYER_NOHEAT = 2;

const HEAT_VERT = `
  #include <common>
  #include <skinning_pars_vertex>
  varying vec3 vW;
  void main() {
    #include <skinbase_vertex>
    #include <begin_vertex>
    #include <skinning_vertex>
    vec4 p = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      p = instanceMatrix * p;
    #endif
    vec4 w = modelMatrix * p;
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const HEAT_FRAG = `
  uniform float uHeat;
  uniform float uAlpha;
  uniform vec4 uEngine;
  uniform vec4 uBarrel;
  uniform vec3 uSun;
  uniform vec3 uCam;
  uniform float uRange;
  uniform vec2 uHot;
  varying vec3 vW;
  void main() {
    vec3 n = normalize(cross(dFdx(vW), dFdy(vW)));
    float sun = max(dot(n, uSun), 0.0);
    float h;
    if (uHeat < 0.0) {
      // Cold world: ground and buildings only hold a little of the day's sun.
      float patchy = sin(vW.x * 0.035) * sin(vW.z * 0.03) * 0.5 + 0.5;
      h = 0.1 + sun * 0.16 + patchy * 0.03;
    } else {
      h = uHeat * (0.92 + sun * 0.08);
    }
    // uEngine / uBarrel: xyz world position, w radius; their heat in uHot.x / uHot.y.
    if (uEngine.w > 0.0) h = max(h, uHot.x * (1.0 - smoothstep(uEngine.w * 0.25, uEngine.w, distance(vW, uEngine.xyz))));
    if (uBarrel.w > 0.0) h = max(h, uHot.y * (1.0 - smoothstep(0.0, uBarrel.w, distance(vW, uBarrel.xyz))));
    // Fog and haze: thermal sees far further than the eye, but things still fade out.
    float d = distance(vW, uCam);
    float fade = smoothstep(uRange * 0.3, uRange, d);
    h = mix(h, 0.05, fade * (uHeat < 0.0 ? 1.0 : 0.6));
    gl_FragColor = vec4(h, h, h, uAlpha);
  }`;

const FINAL_FRAG = `
  uniform sampler2D tHeat;
  uniform vec2 uTexel;
  uniform float uTime;
  uniform float uFlash;
  varying vec2 vUv;
  vec3 ramp(float h) {
    // Black -> dark green -> light green -> white -> red -> near white.
    vec3 c = mix(vec3(0.008, 0.03, 0.016), vec3(0.04, 0.24, 0.1), smoothstep(0.03, 0.22, h));
    c = mix(c, vec3(0.42, 0.78, 0.46), smoothstep(0.22, 0.46, h));
    c = mix(c, vec3(0.93, 1.0, 0.86), smoothstep(0.46, 0.68, h));
    c = mix(c, vec3(1.0, 0.36, 0.14), smoothstep(0.7, 0.86, h));
    c = mix(c, vec3(1.0, 0.94, 0.84), smoothstep(0.88, 1.0, h));
    return c;
  }
  float noise(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  void main() {
    // Slight blur, and hot things bloom a little into their surroundings.
    float h = texture2D(tHeat, vUv).r * 0.5;
    h += (texture2D(tHeat, vUv + uTexel * vec2(1.2, 0.0)).r + texture2D(tHeat, vUv - uTexel * vec2(1.2, 0.0)).r + texture2D(tHeat, vUv + uTexel * vec2(0.0, 1.2)).r + texture2D(tHeat, vUv - uTexel * vec2(0.0, 1.2)).r) * 0.125;
    float wide = 0.0;
    for (int i = 0; i < 6; i++) {
      float a = float(i) * 1.0472;
      wide += texture2D(tHeat, vUv + uTexel * 7.0 * vec2(cos(a), sin(a))).r;
    }
    wide /= 6.0;
    h = max(h, wide * 0.82);
    h += (noise(vUv * vec2(811.0, 637.0) + uTime * 37.0) - 0.5) * 0.028;
    vec3 c = ramp(h);
    c *= 0.94 + 0.06 * sin(vUv.y / uTexel.y * 1.6);
    float v = length(vUv - 0.5);
    c *= 1.0 - v * v * 0.55;
    c = mix(c, vec3(1.0), uFlash);
    gl_FragColor = vec4(c, 1.0);
  }`;

function heatUniforms() {
  return {
    uHeat: { value: -1 },
    uAlpha: { value: 1 },
    uEngine: { value: new THREE.Vector4(0, 0, 0, 0) },
    uBarrel: { value: new THREE.Vector4(0, 0, 0, 0) },
    uHot: { value: new THREE.Vector2() },
    uSun: { value: new THREE.Vector3(0, 1, 0) },
    uCam: { value: new THREE.Vector3() },
    uRange: { value: 1500 },
  };
}

function resetHeat(u) {
  u.uHeat.value = -1;
  u.uAlpha.value = 1;
  u.uEngine.value.w = 0;
  u.uBarrel.value.w = 0;
}

function onBefore(_r, _s, _c, _g, material) {
  if (!material.isHeat) return;
  const src = this.userData.heatSrc;
  const u = material.uniforms;
  u.uHeat.value = src.heat ?? -1;
  u.uAlpha.value = src.alpha ?? 1;
  if (src.engine) {
    u.uEngine.value.copy(src.engine);
    u.uHot.value.x = src.hotE ?? 0;
  }
  if (src.barrel) {
    u.uBarrel.value.copy(src.barrel);
    u.uHot.value.y = src.hotB ?? 0;
  }
  material.uniformsNeedUpdate = true;
}

function onAfter(_r, _s, _c, _g, material) {
  if (!material.isHeat) return;
  resetHeat(material.uniforms);
  material.uniformsNeedUpdate = true;
}

// Give an object its own heat. src: { heat, alpha?, engine?: Vector4, hotE?, barrel?: Vector4, hotB? }.
export function markHeat(obj, src) {
  obj.traverse((o) => {
    if (!o.isMesh) return;
    o.userData.heatSrc = src;
    o.onBeforeRender = onBefore;
    o.onAfterRender = onAfter;
  });
}

export function noHeat(obj) {
  obj.traverse((o) => o.layers.set(LAYER_NOHEAT));
}

// A camera that looks at the world sees all three layers.
export function seeAllLayers(camera) {
  camera.layers.enable(LAYER_FX);
  camera.layers.enable(LAYER_NOHEAT);
}

const _clear = new THREE.Color();

export class ThermalRenderer {
  constructor(world) {
    this.world = world;
    this.flash = 0;
    this.time = 0;
    this.heatMat = new THREE.ShaderMaterial({ vertexShader: HEAT_VERT, fragmentShader: HEAT_FRAG, uniforms: heatUniforms() });
    this.heatMat.isHeat = true;
    this.fxMat = new THREE.ShaderMaterial({ vertexShader: HEAT_VERT, fragmentShader: HEAT_FRAG, uniforms: heatUniforms(), transparent: true, depthWrite: false });
    this.fxMat.isHeat = true;
    for (const m of [this.heatMat, this.fxMat]) m.uniforms.uSun.value.copy(world.sunDir);
    this.rt = new THREE.WebGLRenderTarget(4, 4, { depthBuffer: true, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.finalScene = new THREE.Scene();
    this.finalCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.finalMat = new THREE.ShaderMaterial({
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: FINAL_FRAG,
      uniforms: { tHeat: { value: this.rt.texture }, uTexel: { value: new THREE.Vector2() }, uTime: { value: 0 }, uFlash: { value: 0 } },
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.finalScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.finalMat));
  }

  // White-out when an explosion goes off in view; strength 0..1.
  addFlash(strength) {
    this.flash = Math.min(1, Math.max(this.flash, strength));
  }

  render(scene, camera, dt) {
    this.time += dt;
    this.flash = Math.max(0, this.flash - dt * 2.2);
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const k = quality().pixelRatio < 1 ? 0.7 : 0.85;
    const w = Math.max(4, Math.round(size.x * k)), h = Math.max(4, Math.round(size.y * k));
    if (this.rt.width !== w || this.rt.height !== h) this.rt.setSize(w, h);
    const range = (scene.fog?.far ?? 900) * 2;
    for (const m of [this.heatMat, this.fxMat]) {
      m.uniforms.uCam.value.copy(camera.position);
      m.uniforms.uRange.value = range;
      resetHeat(m.uniforms);
      m.uniformsNeedUpdate = true;
    }

    // The heat pass needs neither shadows nor the sky.
    const shadowUpdate = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    const bg = scene.background;
    const over = scene.overrideMaterial;
    const mask = camera.layers.mask;
    const autoClear = renderer.autoClear;
    renderer.getClearColor(_clear);
    const clearA = renderer.getClearAlpha();
    scene.background = null;
    renderer.setRenderTarget(this.rt);
    renderer.setClearColor(0x0b0b0b, 1); // the sky is cold
    renderer.clear();
    renderer.autoClear = false;
    scene.overrideMaterial = this.heatMat;
    camera.layers.mask = 1 << 0;
    renderer.render(scene, camera);
    scene.overrideMaterial = this.fxMat;
    camera.layers.mask = 1 << LAYER_FX;
    renderer.render(scene, camera);
    scene.overrideMaterial = over;
    camera.layers.mask = mask;
    scene.background = bg;
    renderer.setClearColor(_clear, clearA);
    renderer.autoClear = autoClear;
    renderer.setRenderTarget(null);
    renderer.shadowMap.autoUpdate = shadowUpdate;

    const f = this.finalMat.uniforms;
    f.uTexel.value.set(1 / w, 1 / h);
    f.uTime.value = this.time % 100;
    f.uFlash.value = this.flash;
    renderer.render(this.finalScene, this.finalCam);
  }

  dispose() {
    this.rt.dispose();
    this.heatMat.dispose();
    this.fxMat.dispose();
    this.finalMat.dispose();
  }
}
