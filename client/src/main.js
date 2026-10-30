import { net } from './net.js';
import { settings, saveSettings } from './settings.js';
import { setActiveView } from './render.js';
import { MenuScene } from './scenes/menuScene.js';
import { $, showScreen, hideScreens, backScreen, clearHistory, currentScreen, onScreenChange, toast, setStatus } from './ui/screens.js';
import { initSettingsScreen, onSettingsOpen } from './ui/settingsScreen.js';
import { initLobbyScreen, renderLobby, lobby, setSpeaking } from './ui/lobbyScreen.js';
import { voice } from './voice.js';
import { MatchClient } from './game/matchClient.js';

const menuScene = new MenuScene();
setActiveView(menuScene);

let match = null; // MatchClient while a match is running

if (import.meta.env.DEV) window.__game = { net, voice, get match() { return match; } };

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
$('#btn-quit').addEventListener('click', () => {
  leaveRoom();
  window.close(); // only works for script-opened tabs; otherwise show a farewell screen
  showScreen('quit');
});
$('#btn-quit-back').addEventListener('click', () => goMenu());

onScreenChange((name) => {
  if (name === 'settings') onSettingsOpen();
  if (name === 'menu' || name === 'join' || name === 'quit') menuScene.setMode('menu');
  if (name === 'lobby') menuScene.setMode('lobby');
});

initSettingsScreen();

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
  showScreen('lobby', { remember: false });
});

net.on('lobby', (msg) => {
  lobby.state = msg;
  menuScene.setShowcase(msg.tank);
  renderLobby();
  voice.syncPeers(msg);
});

voice.onChange((sp) => {
  setSpeaking(net.id, sp.local);
  const other = lobby.state?.players.find((p) => p.id !== net.id);
  if (other) setSpeaking(other.id, sp.remote);
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
    toast(`${msg.name} ${why} the lobby.`);
  }
});

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
  showScreen('lobby', { remember: false });
  renderLobby();
}

function endMatchClient() {
  match?.dispose();
  match = null;
}

net.on('matchStart', (msg) => {
  endMatchClient();
  const role = msg.roles[net.id];
  match = new MatchClient({ role, tank: msg.tank, onPause: () => showScreen('pause') });
  clearHistory();
  hideScreens();
  setActiveView(match);
});

net.on('toLobby', () => {
  endMatchClient();
  returnToLobbyView();
});

net.on('matchEnd', (msg) => {
  match?.onMatchEnd?.(msg);
  const res = $('#end-result');
  res.textContent = msg.victory ? 'VICTORY' : 'DEFEAT';
  res.className = `result ${msg.victory ? 'win' : 'lose'}`;
  const secs = Math.floor(msg.time);
  $('#end-time').textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  $('#end-kills').textContent = msg.kills;
  $('#end-caps').textContent = msg.captures;
  showScreen('end', { remember: false });
});

$('#btn-end-lobby').addEventListener('click', () => net.send({ t: 'toLobby' }));

// Pause menu
function resume() {
  hideScreens();
  match?.resume();
}
$('#btn-resume').addEventListener('click', resume);
$('#btn-pause-settings').addEventListener('click', () => showScreen('settings'));
$('#btn-pause-leave').addEventListener('click', () => {
  leaveRoom();
  goMenu();
});

window.addEventListener('keydown', (e) => {
  if (e.code !== 'Escape' || !match) return;
  // The same Esc press that released the mouse already opened the pause menu.
  if (performance.now() - match.lastUnlock < 400) return;
  const s = currentScreen();
  if (s === null) match.pause();
  else if (s === 'pause') resume();
  else if (s === 'settings') backScreen('pause');
});

// Keep the server warm-ish and the name in sync once connected.
goMenu();
