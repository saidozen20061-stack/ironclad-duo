import { $, showScreen, currentScreen, toast, escapeHtml } from '../ui/screens.js';
import { net } from '../net.js';
import { lobby } from '../ui/lobbyScreen.js';
import { COOP_PLANE_IDS } from '../../../shared/planes.js';

// Co-op story: the host hosts a room from the briefing card, a friend joins with the code and sits in
// the gunner's seat of the host's tank. The host's save decides the stage, tank and parts; the friend
// gets a share of the silver and XP in their own save.

export const coop = {
  pending: null, // a stage waiting for the room to open
  browsing: false, // the host is on the war map between stages: stay there
  get active() {
    return (net.mode === 'host' || net.mode === 'guest') && lobby.state?.mode === 'story';
  },
  get host() {
    return net.mode === 'host';
  },
};

export const coopAllowed = (stage) => !stage.plane || COOP_PLANE_IDS.includes(stage.plane);

let hooks = null;
export function initCoop(h) {
  hooks = h;
  $('#btn-coop-copy').addEventListener('click', () => {
    navigator.clipboard?.writeText(lobby.state?.code ?? '').then(() => toast('Room code copied.'), () => {});
  });
  $('#btn-coop-start').addEventListener('click', () => net.send({ t: 'start' }));
  $('#btn-coop-map').addEventListener('click', () => {
    coop.browsing = true;
    hooks.openMap();
  });
  $('#btn-coop-leave').addEventListener('click', () => hooks.leave());
}

// Host a room for this stage; the room's code shows on the co-op screen once it's open.
export function hostCoop(payload) {
  coop.pending = payload;
  net.send({ t: 'host' });
}

// Called when our room opens (host) or its state changes. Returns true when story mode took it.
export function onJoined() {
  if (!coop.pending) return false;
  net.send({ t: 'storyStage', story: coop.pending });
  coop.pending = null;
  showScreen('storycoop', { remember: false });
  return true;
}

export function onLobbyState(state) {
  if (state.mode !== 'story' || state.phase !== 'lobby') return;
  if (!coop.browsing && ['lobby', 'teams', 'storycoop', 'menu', 'join'].includes(currentScreen())) showScreen('storycoop', { remember: false });
  renderCoop();
}

export function renderCoop() {
  const s = lobby.state;
  if (!s) return;
  $('#coop-code').textContent = s.code;
  const crew = s.crews.find((c) => c.driver === s.hostId) ?? s.crews[0];
  const name = (id) => escapeHtml(s.players.find((p) => p.id === id)?.name ?? '');
  $('#coop-seats').innerHTML = `<div class="seat"><small>Driver (host)</small><span>${name(crew.driver)}</span></div><div class="seat${crew.gunner == null ? ' free' : ''}"><small>Gunner</small><span>${crew.gunner == null ? 'Waiting for a friend: send them the code' : name(crew.gunner)}</span></div>`;
  $('#coop-stage').textContent = s.story ? s.story.name : 'No stage picked yet';
  const host = s.hostId === net.id;
  $('#btn-coop-start').style.display = host ? '' : 'none';
  $('#btn-coop-map').style.display = host ? '' : 'none';
  $('#coop-note').textContent = host ? "Your save picks the stage, the tank and its parts. Your friend gets half the silver and XP in their own save." : 'The host picks the stage and starts it. You get half the silver and XP in your own save.';
}
