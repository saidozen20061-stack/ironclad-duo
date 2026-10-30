import { TANKS, TANK_IDS } from '../../../shared/constants.js';
import { net } from '../net.js';
import { PAINT } from '../models/paint.js';
import { $, $$, escapeHtml, toast, setStatus } from './screens.js';

// Renders lobby state pushed by the server. All mutations go through the server.

export const lobby = {
  state: null,
  get me() {
    return this.state?.players.find((p) => p.id === net.id) ?? null;
  },
  get isHost() {
    return this.state?.hostId === net.id;
  },
  speaking: new Map(), // playerId -> bool, filled in by voice chat
};

const STAT_LABELS = { speed: 'Speed', armor: 'Armor', firepower: 'Firepower', reload: 'Reload' };

function buildTankCards() {
  const root = $('#tank-pick');
  root.innerHTML = '';
  for (const id of TANK_IDS) {
    const t = TANKS[id];
    const btn = document.createElement('button');
    btn.className = 'tank-card';
    btn.dataset.tank = id;
    const bars = Object.entries(t.stats)
      .map(([k, v]) => `<label>${STAT_LABELS[k]}</label><div class="bar"><i style="width:${v * 20}%"></i></div>`)
      .join('');
    btn.innerHTML = `<div class="cls">${t.class}</div><b>${t.name}</b><span>${t.blurb}</span><div class="wpn">${t.weapon.label}</div><div class="paint">Paint: ${PAINT[id]?.name ?? 'Standard'}</div><div class="bars">${bars}</div>`;
    btn.addEventListener('click', () => net.send({ t: 'tank', tank: id }));
    root.appendChild(btn);
  }
}

export function initLobbyScreen({ onLeave }) {
  buildTankCards();
  for (const card of $$('.role-card')) {
    card.addEventListener('click', () => {
      const role = card.dataset.role;
      net.send({ t: 'role', role: lobby.me?.role === role ? null : role });
    });
  }
  $('#btn-ready').addEventListener('click', () => net.send({ t: 'ready', ready: !lobby.me?.ready }));
  $('#btn-lobby-leave').addEventListener('click', onLeave);
  $('#btn-copy-code').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(lobby.state?.code ?? '');
      toast('Room code copied');
    } catch {
      toast('Copy failed — read the code out to your friend.', { error: true });
    }
  });
}

export function renderLobby() {
  const s = lobby.state;
  if (!s) return;
  $('#lobby-code').textContent = s.code;

  const rows = s.players.map((p) => {
    const tags = [
      p.id === s.hostId ? '<span class="tag host">Host</span>' : '',
      p.role ? `<span class="tag role">${p.role}</span>` : '<span class="tag">No role</span>',
      p.ready ? '<span class="tag ready">Ready</span>' : '',
    ].join('');
    const you = p.id === net.id ? ' (you)' : '';
    const speaking = lobby.speaking.get(p.id) ? ' on' : '';
    return `<div class="player-row"><i class="speak-dot${speaking}" data-speak="${p.id}"></i><span class="name">${escapeHtml(p.name)}${you}</span>${tags}</div>`;
  });
  if (s.players.length < 2) rows.push('<div class="player-row empty">Waiting for your crewmate… share the room code.</div>');
  $('#lobby-players').innerHTML = rows.join('');

  const me = lobby.me;
  for (const card of $$('.role-card')) {
    const role = card.dataset.role;
    const holder = s.players.find((p) => p.role === role);
    card.classList.toggle('sel', me?.role === role);
    card.classList.toggle('taken', !!holder && holder.id !== net.id);
  }

  for (const card of $$('.tank-card')) {
    card.classList.toggle('sel', card.dataset.tank === s.tank);
    card.disabled = !lobby.isHost;
  }
  $('#tank-host-note').textContent = lobby.isHost ? '(you choose)' : '(host chooses)';

  const ready = $('#btn-ready');
  ready.textContent = me?.ready ? 'Ready ✓' : 'Ready';
  ready.classList.toggle('on', !!me?.ready);

  let status = '';
  if (s.players.length < 2) status = 'Need 2 players.';
  else if (!s.players.every((p) => p.role)) status = 'Both players need a role.';
  else if (!s.players.every((p) => p.ready)) status = 'Waiting for both players to ready up…';
  else status = 'Starting…';
  setStatus('lobby-status', status);
}

export function setSpeaking(id, on) {
  lobby.speaking.set(id, on);
  for (const el of $$(`[data-speak="${id}"]`)) el.classList.toggle('on', on);
}
