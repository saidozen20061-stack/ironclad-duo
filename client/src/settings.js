const KEY = 'ironclad-duo-settings';

const DEFAULTS = {
  name: '',
  masterVolume: 0.8,
  voiceVolume: 1,
  sensitivity: 1,
  micId: '',
  voiceMode: 'ptt',
  pttKey: 'KeyV',
  keybinds: {}, // action id -> key or mouse code, where it differs from the default
  quality: 'medium',
  autoQuality: true,
  // Optional TURN relay for players behind strict networks (see README).
  turnUrl: '',
  turnUser: '',
  turnPass: '',
  seenTutorial: { driver: false, gunner: false },
};

const listeners = new Set();

function load() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export const settings = load();

export function saveSettings() {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Storage blocked (private mode etc.) — settings just won't persist.
  }
  for (const fn of listeners) fn(settings);
}

export function onSettingsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const MOUSE_NAMES = ['Left Mouse', 'Middle Mouse', 'Right Mouse'];

export function keyLabel(code) {
  if (code.startsWith('Mouse')) return MOUSE_NAMES[Number(code.slice(5))] ?? `Mouse ${Number(code.slice(5)) + 1}`;
  if (code.startsWith('Arrow')) return `${code.slice(5)} Arrow`;
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  if (code === 'ShiftLeft') return 'Shift';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code === 'Space') return 'Space';
  return code.replace(/(Left|Right)$/, ' $1');
}

// Quality presets consumed by the renderer and (later) the effects/NPC systems.
export const QUALITY = {
  // scatter = density of grass/bushes/rocks/debris; lod = multiplier on scatter view radii.
  low: { maxRatio: 1, pixelRatio: 0.75, shadows: false, shadowMap: 1024, drawDistance: 600, particles: 0.4, trees: 0.4, scatter: 0.35, lod: 0.6, atmos: 0.35 },
  medium: { maxRatio: 1.25, pixelRatio: 1, shadows: true, shadowMap: 2048, drawDistance: 900, particles: 0.7, trees: 0.7, scatter: 0.65, lod: 0.85, atmos: 0.7 },
  high: { maxRatio: 1.75, pixelRatio: 1.5, shadows: true, shadowMap: 4096, drawDistance: 1400, particles: 1, trees: 1, scatter: 1, lod: 1, atmos: 1 },
};

export function quality() {
  return QUALITY[settings.quality] ?? QUALITY.medium;
}
