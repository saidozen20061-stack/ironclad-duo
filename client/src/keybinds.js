import { settings, saveSettings, keyLabel } from './settings.js';

// Every rebindable action: its default key or mouse button ('Mouse0' left, 'Mouse1' middle,
// 'Mouse2' right), fixed extra keys that work while it's on its default, and its group.
const list = (group, rows) => rows.map(([id, label, def, alts = []]) => ({ id: `${group}.${id}`, group, label, def, alts }));

export const GROUPS = {
  drive: 'Tank: driving (driver and solo)',
  driver: 'Tank: driver seat',
  gun: 'Tank: gun (gunner and solo)',
  gunner: 'Tank: gunner seat',
  solo: 'Tank: solo',
  plane: 'Plane: flying (pilot and solo)',
  planeSolo: 'Plane: solo',
  door: 'Plane: side gunner',
  foot: 'On foot',
  death: 'When destroyed',
  all: 'Everywhere',
};

export const ACTIONS = [
  ...list('drive', [
    ['forward', 'Forward', 'KeyW', ['ArrowUp']],
    ['back', 'Reverse', 'KeyS', ['ArrowDown']],
    ['left', 'Steer left', 'KeyA', ['ArrowLeft']],
    ['right', 'Steer right', 'KeyD', ['ArrowRight']],
    ['boost', 'Boost', 'ShiftLeft', ['ShiftRight']],
    ['brake', 'Brake', 'Space'],
    ['repair', 'Repair (hold, stopped)', 'KeyR'],
  ]),
  ...list('driver', [
    ['look', 'Look around (hold)', 'Mouse2'],
    ['free', 'Free look on/off', 'KeyL'],
  ]),
  ...list('gun', [
    ['fire', 'Fire main gun', 'Mouse0'],
    ['ap', 'AP shells', 'Digit1'],
    ['he', 'HE shells', 'Digit2'],
    ['thermal', 'Thermal on/off', 'KeyT'],
  ]),
  ...list('gunner', [
    ['mg', 'Machine gun (or zoom)', 'Mouse2'],
    ['ping', 'Ping', 'KeyQ', ['Mouse1']],
  ]),
  ...list('solo', [
    ['sight', 'Gun sight (hold)', 'Mouse2'],
    ['mg', 'Machine gun', 'Mouse1'],
  ]),
  ...list('plane', [
    ['up', 'Nose up (climb)', 'KeyW'],
    ['down', 'Nose down (descend)', 'KeyS'],
    ['left', 'Turn left', 'KeyA'],
    ['right', 'Turn right', 'KeyD'],
    ['more', 'More throttle', 'KeyE', ['ShiftLeft', 'ShiftRight']],
    ['less', 'Less throttle', 'KeyQ'],
    ['fire', 'Fire guns', 'Mouse0'],
    ['bomb', 'Drop bombs', 'Space'],
    ['rocket', 'Fire rockets', 'KeyR'],
    ['ahead', 'Look ahead again', 'KeyC'],
    ['bail', 'Bail out', 'KeyX'],
  ]),
  ...list('planeSolo', [
    ['cockpit', 'Cockpit view (hold)', 'Mouse2'],
    ['thermal', 'Thermal on/off', 'KeyT'],
  ]),
  ...list('door', [
    ['fire', 'Fire side gun / drop in sight', 'Mouse0'],
    ['sight', 'Bomb sight on/off', 'KeyF'],
    ['thermal', 'Thermal on/off', 'KeyT'],
    ['ping', 'Ping', 'KeyQ'],
    ['bail', 'Bail out', 'KeyX'],
  ]),
  ...list('foot', [
    ['forward', 'Forward', 'KeyW'],
    ['back', 'Back', 'KeyS'],
    ['left', 'Left', 'KeyA'],
    ['right', 'Right', 'KeyD'],
    ['sprint', 'Sprint', 'ShiftLeft', ['ShiftRight']],
    ['jump', 'Jump', 'Space'],
    ['crouch', 'Crouch', 'KeyC'],
    ['fire', 'Fire', 'Mouse0'],
    ['aim', 'Aim down sights', 'Mouse2'],
    ['reload', 'Reload', 'KeyR'],
    ['grenade', 'Grenade', 'KeyG'],
    ['ping', 'Ping', 'KeyQ', ['Mouse1']],
    ['garage', 'Get a new vehicle (at garage)', 'KeyE'],
  ]),
  ...list('death', [
    ['respawn', 'Wait for a new vehicle', 'Digit1'],
    ['foot', 'Go on foot', 'Digit2'],
    ['skip', 'Skip the timer', 'Digit3'],
  ]),
  ...list('all', [
    ['board', 'Scoreboard (hold)', 'Tab'],
    ['talk', 'Talk to crew', 'KeyV'],
    ['team', 'Talk to team', 'KeyB'],
  ]),
];

const BY_ID = new Map(ACTIONS.map((a) => [a.id, a]));
// Actions used on the same screen at the same time: only those can clash with each other.
const SCREENS = [
  ['drive', 'driver', 'all'],
  ['gun', 'gunner', 'all'],
  ['drive', 'gun', 'solo', 'all'],
  ['plane', 'planeSolo', 'all'],
  ['door', 'all'],
  ['foot', 'all'],
  ['death', 'all'],
];
// The voice code reads the keyboard directly, so talking can't be on a mouse button.
export const KEY_ONLY = new Set(['all.talk', 'all.team']);

export function binding(id) {
  if (id === 'all.talk') return settings.pttKey;
  return settings.keybinds?.[id] ?? BY_ID.get(id).def;
}

// All the codes that trigger an action right now.
export function codesFor(id) {
  const a = BY_ID.get(id);
  const code = binding(id);
  return code === a.def ? [code, ...a.alts] : [code];
}

function store(id, code) {
  if (id === 'all.talk') settings.pttKey = code;
  else settings.keybinds = { ...settings.keybinds, [id]: code };
}

// Bind an action. Anything on the same screen already using that code trades places with it.
export function setBinding(id, code) {
  const old = binding(id);
  const screens = SCREENS.filter((s) => s.includes(BY_ID.get(id).group));
  for (const a of ACTIONS) {
    if (a.id === id || binding(a.id) !== code) continue;
    if (screens.some((s) => s.includes(a.group))) store(a.id, old);
  }
  store(id, code);
  saveSettings();
}

export function resetBindings() {
  settings.keybinds = {};
  settings.pttKey = BY_ID.get('all.talk').def;
  saveSettings();
}

// Is this code in use anywhere (the browser shouldn't act on it during a match)?
export function isBound(code) {
  return ACTIONS.some((a) => codesFor(a.id).includes(code));
}

export const keyName = (id) => keyLabel(binding(id));
