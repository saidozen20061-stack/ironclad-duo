import * as THREE from 'three';
import { quality, onSettingsChange, settings, saveSettings } from './settings.js';

// One renderer for the whole app; scenes/cameras swap in and out.
export const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('scene'), antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const resizeHandlers = new Set();
let active = null; // { update(dt), render(), resize?() }
export function onResize(fn) {
  resizeHandlers.add(fn);
  return () => resizeHandlers.delete(fn);
}

// Automatic detail: during a match, a low frame rate first lowers the render resolution
// and, if that isn't enough, drops the graphics preset one step (kept for the next match).
let autoScale = 1;
let autoFrames = 0;
let autoTime = 0;
let autoGood = 0;
export function autoQuality(dt) {
  // dt is the real frame time; a very long one is a stalled or hidden tab, not a slow PC.
  if (!active?.isMatch || settings.autoQuality === false || document.hidden || dt > 0.5) return;
  autoFrames++;
  autoTime += dt;
  if (autoTime < 3) return;
  const fps = autoFrames / autoTime;
  autoFrames = 0;
  autoTime = 0;
  if (fps < 32) {
    autoGood = 0;
    if (autoScale > 0.56) {
      autoScale -= 0.15;
      applyQuality();
    } else if (fps < 26 && settings.quality !== 'low') {
      settings.quality = settings.quality === 'high' ? 'medium' : 'low';
      autoScale = 0.85;
      saveSettings();
    }
  } else if (fps > 57 && autoScale < 1 && ++autoGood >= 3) {
    autoGood = 0;
    autoScale = Math.min(1, autoScale + 0.15);
    applyQuality();
  }
}

function applyQuality() {
  const q = quality();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * q.pixelRatio * autoScale);
  renderer.shadowMap.enabled = q.shadows;
  resize();
}

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  active?.resize?.(w, h);
  for (const fn of resizeHandlers) fn(w, h);
}

window.addEventListener('resize', resize);
onSettingsChange(applyQuality);
applyQuality();

export function setActiveView(view) {
  active?.onDeactivate?.();
  active = view;
  active?.onActivate?.();
  resize();
}

// ---------- F3: performance overlay ----------
const stats = document.createElement('pre');
stats.id = 'perf-stats';
stats.style.display = 'none';
document.body.appendChild(stats);
let statsOn = false;
window.addEventListener('keydown', (e) => {
  if (e.code !== 'F3') return;
  e.preventDefault();
  statsOn = !statsOn;
  stats.style.display = statsOn ? '' : 'none';
});
let frames = 0;
let frameTime = 0;
let worst = 0;
let statsT = 0;

function countObjects(scene) {
  let objects = 0;
  let instanced = 0;
  scene?.traverse((o) => {
    objects++;
    if (o.isInstancedMesh) instanced += o.count;
  });
  return { objects, instanced };
}

function updateStats(dt) {
  frames++;
  frameTime += dt;
  worst = Math.max(worst, dt);
  statsT += dt;
  if (statsT < 0.5) return;
  const info = renderer.info;
  const scene = active?.view?.world?.scene ?? active?.view?.scene ?? active?.scene;
  const { objects, instanced } = countObjects(scene);
  const lines = [
    `FPS ${(frames / frameTime).toFixed(0)}  (worst frame ${(worst * 1000).toFixed(1)} ms)`,
    `draw calls ${info.render.calls} · triangles ${(info.render.triangles / 1000).toFixed(0)}k`,
    `scene objects ${objects} · instances ${instanced}`,
    `geometries ${info.memory.geometries} · textures ${info.memory.textures} · programs ${info.programs?.length ?? 0}`,
    `pixel ratio ${renderer.getPixelRatio().toFixed(2)} (auto ×${autoScale.toFixed(2)}, ${settings.quality}) · ${renderer.domElement.width}×${renderer.domElement.height}`,
    ...(active?.debugStats?.() ?? []),
  ];
  stats.textContent = lines.join('\n');
  frames = 0;
  frameTime = 0;
  worst = 0;
  statsT = 0;
}

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const frameTime = clock.getDelta();
  const dt = Math.min(frameTime, 0.1);
  if (active) {
    active.update(dt);
    active.render(renderer);
    autoQuality(frameTime);
  }
  if (statsOn) updateStats(dt);
});
