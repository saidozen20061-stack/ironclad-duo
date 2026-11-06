import { initControlsScreen, onControlsOpen } from './ui/controlsScreen.js';
import { net } from './net.js';
import { settings, saveSettings } from './settings.js';
import { setActiveView } from './render.js';
import { MenuScene } from './scenes/menuScene.js';
import { introReady } from './intro.js';
import { initStoryHub, renderHub } from './story/hub.js';
import { initStoryMap, showResults } from './story/map.js';
import { useSpec } from './story/tanks.js';
import { initCoop, onJoined, onLobbyState, coop } from './story/coop.js';
import { openMap } from './story/map.js';
import { $, showScreen, hideScreens, backScreen, clearHistory, currentScreen, onScreenChange, toast, setStatus } from './ui/screens.js';
import { initSettingsScreen, onSettingsOpen } from './ui/settingsScreen.js';
import { initLobbyScreen, renderLobby, lobby, setSpeaking, showOfflineTeams } from './ui/lobbyScreen.js';
import { voice } from './voice.js';
import { MatchClient } from './game/matchClient.js';
import { RadioLines } from './game/radioLines.js';
import { AchievementTracker, achievementList } from './game/achievements.js';
import { PlaneWear } from './game/planeWear.js';
import { RainSound } from './game/rainSound.js';
import { setWorldMood } from './game/world.js';
import { TANKS, TANK_IDS, MODES, KILL_LIMITS, DIFFICULTY } from '../../shared/constants.js';
import { PAINT } from './models/paint.js';
import { PLANES, PLANE_IDS } from '../../shared/planes.js';

const menuScene = new MenuScene();
setActiveView(menuScene);

let match = null; // MatchClient while a match is running
let radio = null; // what command says over the radio during that match
let tracker = null; // and what counts towards the achievements
let wear = null;
let rainSound = null;

if (import.meta.env.DEV) window.__game = { net, voice, get match() { return match; }, get radio() { return radio; }, get tracker() { return tracker; } };

// ---------- Main menu ----------
const nameInput = $('#input-name');
nameInput.value = settings.name || `Tanker${Math.floor(Math.random() * 900 + 100)}`;
const commitName = () => {
  settings.name = nameInput.value.trim().slice(0, 16) || 'Tanker';
  saveSettings();
  net.send({ t: 'hello', name: settings.name });
};
nameInput.addEventListener('change', commitName);

// Peer-to-peer: hosting registers the room code with the PeerJS broker, joining dials
// the host directly. Progress and errors show under the button that started it.
$('#btn-host').addEventListener('click', () => {
  commitName();
  setStatus('menu-status', 'Creating room…');
  net.send({ t: 'host' });
});

$('#btn-join').addEventListener('click', () => {
  commitName();
  setStatus('join-status', '');
  showScreen('join');
  $('#input-code').focus();
});

const codeInput = $('#input-code');
codeInput.addEventListener('input', () => {
  codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z]/g, '');
});
async function doJoin() {
  const code = codeInput.value.trim();
  if (code.length !== 5) return setStatus('join-status', 'Room codes are 5 letters.', true);
  commitName();
  setStatus('join-status', 'Connecting to the host…');
  net.send({ t: 'join', code });
}
$('#btn-join-go').addEventListener('click', doJoin);
codeInput.addEventListener('keydown', (e) => e.key === 'Enter' && doJoin());
$('#btn-join-back').addEventListener('click', () => backScreen());

$('#btn-settings').addEventListener('click', () => showScreen('settings'));
$('#btn-controls').addEventListener('click', () => showScreen('controls'));
$('#btn-achievements').addEventListener('click', () => {
  renderAchievements();
  showScreen('achievements');
});
$('#btn-achievements-back').addEventListener('click', () => backScreen());
function renderAchievements() {
  const list = achievementList();
  $('#achievement-count').textContent = `${list.filter((a) => a.unlockedAt).length} of ${list.length} unlocked`;
  $('#achievement-list').innerHTML = list.map((a) => `<div class="achievement${a.unlockedAt ? ' got' : ''}"><b>${a.unlockedAt ? '🏆' : '🔒'} ${a.name}</b><span>${a.desc}</span></div>`).join('');
}

// ---------- Solo setup: tank, camo, mode; the match runs locally ----------
const solo = { tank: 'medium', paint: 'medium', mode: 'flags', killLimit: 20, difficulty: 'easy', airStart: false, night: false, rain: false, team: 'blue' };
const hex = (h) => `#${h.toString(16).padStart(6, '0')}`;
function renderSolo() {
  const pick = (root, items, cur, key) => {
    $(root).innerHTML = items.map(([id, html]) => `<button data-${key}="${id}" class="${id === cur ? 'sel' : ''}">${html}</button>`).join('');
  };
  pick('#solo-tanks', TANK_IDS.map((id) => [id, `${TANKS[id].name} <small>${TANKS[id].class}</small>`]), solo.tank, 'tank');
  pick('#solo-planes', PLANE_IDS.map((id) => [id, `${PLANES[id].name} <small>${PLANES[id].class}</small>`]), solo.tank, 'tank');
  // Tanks wear tank paints, planes their own schemes.
  const flying = !!PLANES[solo.tank];
  pick('#solo-camo', Object.entries(PAINT).filter(([id, p]) => (flying ? p.plane && (!p.for || p.for === solo.tank) : !p.plane && !p.story)).map(([id, p]) => [id, `<i class="swatch" style="background:linear-gradient(135deg, ${hex(p.colors[0])} 50%, ${hex(p.colors[1])} 50%)"></i>${p.name}`]), solo.paint, 'paint');
  pick('#solo-modes', Object.entries(MODES).map(([id, m]) => [id, m.name]), solo.mode, 'mode');
  $('#solo-kills').innerHTML = `<label>Kill limit</label>${KILL_LIMITS.map((k) => `<button class="btn small${k === solo.killLimit ? ' on' : ''}" data-kills="${k}">${k}</button>`).join('')}`;
  $('#solo-kills').style.display = solo.mode === 'tdm' ? '' : 'none';
  $('#solo-diff').innerHTML = `<label>NPC difficulty</label>${Object.entries(DIFFICULTY).map(([id, d]) => `<button class="btn small${id === solo.difficulty ? ' on' : ''}" data-diff="${id}">${d.name}</button>`).join('')}${flying ? `<button class="btn small${solo.airStart ? ' on' : ''}" data-air="1">Air start</button>` : ''}<button class="btn small${solo.night ? ' on' : ''}" data-night="1">Night</button><button class="btn small${solo.rain ? ' on' : ''}" data-rain="1">Rain</button>`;
  menuScene.setShowcase(solo.tank, solo.paint);
  previewCaption('#preview-solo', solo.tank, solo.paint);
}
$('#screen-solo').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.tank) solo.tank = solo.paint = b.dataset.tank; // a new tank starts in its own camo
  else if (b.dataset.paint) solo.paint = b.dataset.paint;
  else if (b.dataset.mode) solo.mode = b.dataset.mode;
  else if (b.dataset.kills) solo.killLimit = Number(b.dataset.kills);
  else if (b.dataset.diff) solo.difficulty = b.dataset.diff;
  else if (b.dataset.air) solo.airStart = !solo.airStart;
  else if (b.dataset.night) solo.night = !solo.night;
  else if (b.dataset.rain) solo.rain = !solo.rain;
  else return;
  renderSolo();
});
$('#btn-solo').addEventListener('click', () => {
  commitName();
  menuScene.setCrews({ crews: [], players: [], mode: 'flags' });
  showScreen('solo');
  renderSolo();
});
$('#btn-solo-back').addEventListener('click', () => backScreen());
$('#btn-solo-go').addEventListener('click', () => showOfflineTeams(solo));
$('#btn-quit').addEventListener('click', () => {
  leaveRoom();
  window.close(); // only works for script-opened tabs; otherwise show a farewell screen
  showScreen('quit');
});
$('#btn-quit-back').addEventListener('click', () => goMenu());

// Name and stats over the big vehicle preview.
function previewCaption(root, id, paint) {
  const t = TANKS[id] ?? PLANES[id];
  if (!t) return;
  const bars = Object.entries(t.stats ?? {}).map(([k, v]) => `<label>${k}</label><div class="bar"><i style="width:${v * 20}%"></i></div>`).join('');
  $(`${root} .preview-cap`).innerHTML = `<b>${t.name}</b><small>${t.class}${paint ? ` · ${PAINT[paint]?.name ?? ''}` : ''}${t.inspired ? `<br>Inspired by the ${t.inspired}` : ''}</small><div class="bars">${bars}</div>`;
}

onScreenChange((name) => {
  menuScene.preview.attach(name === 'solo' ? $('#preview-solo') : name === 'lobby' ? $('#preview-lobby') : name === 'story' ? $('#preview-story') : name === 'workshop' ? $('#preview-workshop') : null);
  if (name === 'settings') onSettingsOpen();
  if (name === 'controls') onControlsOpen();
  if (name === 'menu' || name === 'join' || name === 'quit') menuScene.setMode('menu');
  if (name === 'lobby' || name === 'solo' || name === 'teams') menuScene.setMode('lobby');
  if (['story', 'storymap', 'shop', 'workshop'].includes(name)) menuScene.setMode('story');
});

initSettingsScreen();
initControlsScreen();
initStoryHub(menuScene);
initCoop({
  openMap,
  leave: () => {
    coop.browsing = false;
    leaveRoom();
    clearHistory();
    setActiveView(menuScene);
    showScreen('story', { remember: false });
    renderHub();
  },
});
initStoryMap({
  renderHub,
  leaveMatch: () => {
    leaveRoom();
    clearHistory();
    setActiveView(menuScene);
  },
});

// ---------- Lobby ----------
function leaveRoom() {
  voice.stop();
  net.send({ t: 'leave' });
  lobby.state = null;
  endMatchClient();
}

function goMenu() {
  clearHistory();
  setActiveView(menuScene);
  showScreen('menu', { remember: false });
}

initLobbyScreen({
  onLeave: () => {
    leaveRoom();
    goMenu();
  },
});

net.on('joined', () => {
  setStatus('menu-status', '');
  setStatus('join-status', '');
  clearHistory();
  if (onJoined()) return;
  showScreen('lobby', { remember: false });
});

// Voice links: our crewmate plus everyone on our team (all crews are Blue in Fortress).
function rosterFrom(crews, mode, myId) {
  const mine = crews.find((c) => c.driver === myId || c.gunner === myId);
  if (!mine) return null;
  const team = mode === 'fortress' ? null : mine.team;
  const ids = crews.filter((c) => !team || c.team === team).flatMap((c) => [c.driver, c.gunner]).filter((id) => id != null);
  return { crewmate: mine.driver === myId ? mine.gunner : mine.driver, team: ids };
}

net.on('lobby', (msg) => {
  lobby.state = msg;
  menuScene.setCrews(msg);
  // The preview follows our own crew's tank (the first crew's until we take a seat).
  const previewTank = (lobby.myCrew ?? msg.crews[0])?.tank;
  if (previewTank) {
    menuScene.setShowcase(previewTank);
    previewCaption('#preview-lobby', previewTank, previewTank);
  }
  renderLobby();
  onLobbyState(msg);
  if (msg.phase === 'lobby') voice.setRoster(rosterFrom(msg.crews, msg.mode, net.id));
});

voice.onChange((sp) => {
  setSpeaking(net.id, sp.local);
  for (const p of lobby.state?.players ?? []) if (p.id !== net.id) setSpeaking(p.id, !!sp.remote.get(p.id));
  setStatus('lobby-voice', voice.hint());
});

net.on('error', (msg) => {
  const screen = currentScreen();
  if (screen === 'join' || msg.where === 'join') {
    if (screen !== 'join') showScreen('join');
    setStatus('join-status', msg.msg, true);
  } else if (screen === 'menu' || msg.where === 'host') setStatus('menu-status', msg.msg, true);
  else toast(msg.msg, { error: true });
});

net.on('peerLeft', (msg) => {
  const why = msg.reason === 'disconnected' ? 'disconnected' : 'left';
  if (msg.duringMatch) {
    endMatchClient();
    toast(`${msg.name} ${why}. Match ended — back to the lobby.`, { error: true, ms: 6000 });
    returnToLobbyView();
  } else {
    toast(match ? `${msg.name} ${why}. Esc, Switch Seat to take over, or they can rejoin with the room code.` : `${msg.name} ${why} the lobby.`);
  }
});

net.on('peerBack', (msg) => toast(`${msg.name} took the empty seat.`));
net.on('crewNames', (msg) => match?.setCrewNames(msg.crews, msg.names));

net.on('disconnected', (msg) => {
  const wasInRoom = !!lobby.state;
  lobby.state = null;
  voice.stop();
  endMatchClient();
  if (wasInRoom) {
    toast(msg?.reason ?? 'Connection lost.', { error: true, ms: 7000 });
    goMenu();
  }
});

// ---------- Match ----------
function returnToLobbyView() {
  setActiveView(menuScene);
  clearHistory();
  if (lobby.state?.mode === 'story') {
    // Story co-op: the room's own screen, unless the host is busy picking the next stage.
    if (!coop.browsing) showScreen('storycoop', { remember: false });
    return;
  }
  showScreen('lobby', { remember: false });
  renderLobby();
}

let undoSpec = null; // a story tank's stats stand in for its model's during the stage

function endMatchClient() {
  undoSpec?.();
  undoSpec = null;
  radio?.dispose();
  radio = null;
  tracker?.dispose();
  tracker = null;
  wear?.dispose();
  wear = null;
  rainSound?.dispose();
  rainSound = null;
  match?.dispose();
  match = null;
}

net.on('matchStart', (msg) => {
  endMatchClient();
  const crew = msg.crews.find((c) => c.driver === net.id || c.gunner === net.id);
  if (msg.story?.spec) undoSpec = useSpec(crew.tank, msg.story.spec);
  const role = msg.solo || msg.style === 'solo' ? 'solo' : crew.driver === net.id ? 'driver' : 'gunner';
  if (!msg.solo) voice.setRoster(rosterFrom(msg.crews, msg.mode, net.id));
  setWorldMood({ night: !!msg.night, rain: !!msg.rain, snow: !!msg.snow });
  match = new MatchClient({
    role,
    tank: crew.tank,
    crew,
    info: msg,
    onPause: () => {
      showScreen('pause');
      // Alone in the crew: the other seat can be taken.
      const mine = lobby.myCrew;
      $('#btn-pause-swap').style.display = lobby.state?.style === 'duo' && mine && (mine.driver == null || mine.gunner == null) ? '' : 'none';
    },
  });
  radio = new RadioLines(match.hud, crew.id);
  tracker = new AchievementTracker(crew.id, { night: !!msg.night, rain: !!msg.rain, vehicle: crew.tank });
  wear = new PlaneWear(() => match);
  if (msg.rain) rainSound = new RainSound();
  clearHistory();
  hideScreens();
  setActiveView(match);
});

net.on('toLobby', () => {
  endMatchClient();
  returnToLobbyView();
});

net.on('matchEnd', (msg) => {
  const victory = msg.winner === (match?.team ?? 'blue');
  const draw = msg.winner == null;
  const mine = msg.crews.find((c) => c[0] === match?.crew.id) ?? [0, 0, 0, 0];
  const res = $('#end-result');
  res.textContent = draw ? 'DRAW' : victory ? 'VICTORY' : 'DEFEAT';
  res.className = `result ${draw ? '' : victory ? 'win' : 'lose'}`;
  $('#end-reason').textContent = msg.reason ?? '';
  const secs = Math.floor(msg.time);
  $('#end-time').textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  $('#end-kills').textContent = mine[1];
  $('#end-caps').textContent = mine[3];
  $('#end-caps').parentElement.style.display = msg.mode === 'fortress' ? 'none' : '';
  $('#end-board').innerHTML = match?.scoreboardHtml(msg.crews, msg.npcs) ?? '';
  const earned = tracker?.finish(victory && !draw, mine[2]) ?? [];
  $('#end-achievements').innerHTML = earned.map((a) => `<div class="achievement got"><b>🏆 ${a.name}</b><span>${a.desc}</span></div>`).join('');
  match?.onMatchEnd?.(msg);
  if (msg.story) return showResults(msg);
  $('#btn-end-lobby').textContent = net.mode === 'solo' ? 'Back to Menu' : lobby.isHost ? 'Return to Lobby' : 'Leave to Menu';
  showScreen('end', { remember: false });
});

$('#btn-end-lobby').addEventListener('click', () => {
  if (net.mode !== 'solo' && lobby.isHost) return net.send({ t: 'toLobby' });
  leaveRoom();
  goMenu();
});

// Pause menu
function resume() {
  hideScreens();
  match?.resume();
}
$('#btn-resume').addEventListener('click', resume);
$('#btn-pause-settings').addEventListener('click', () => showScreen('settings'));
$('#btn-pause-controls').addEventListener('click', () => showScreen('controls'));
$('#btn-pause-swap').addEventListener('click', () => net.send({ t: 'swapSeat' }));
$('#btn-pause-leave').addEventListener('click', () => {
  const story = match?.mode === 'story';
  leaveRoom();
  if (!story) return goMenu();
  clearHistory();
  setActiveView(menuScene);
  showScreen('story', { remember: false });
  renderHub();
});

window.addEventListener('keydown', (e) => {
  if (e.code !== 'Escape' || !match) return;
  // The same Esc press that released the mouse already opened the pause menu.
  if (performance.now() - match.lastUnlock < 400) return;
  const s = currentScreen();
  if (s === null) match.pause();
  else if (s === 'pause') resume();
  else if (s === 'settings' || s === 'controls') backScreen('pause');
});

// Keep the server warm-ish and the name in sync once connected.
goMenu();
introReady();
