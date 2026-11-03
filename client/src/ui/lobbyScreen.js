import { TANKS, TANK_IDS, MODES, KILL_LIMITS, DIFFICULTY, PLAY_STYLES } from '../../../shared/constants.js';
import { PLANES, PLANE_IDS, COOP_PLANE_IDS, MAX_SIDE_PLANES } from '../../../shared/planes.js';
import { net } from '../net.js';
import { PAINT } from '../models/paint.js';
import { $, $$, escapeHtml, toast, setStatus, showScreen } from './screens.js';

// Renders lobby state pushed by the host. All mutations go through the host.

export const lobby = {
  state: null,
  get me() {
    return this.state?.players.find((p) => p.id === net.id) ?? null;
  },
  get isHost() {
    return this.state?.hostId === net.id;
  },
  get myCrew() {
    const me = this.me;
    return me?.crew != null ? this.state.crews[me.crew] : null;
  },
  speaking: new Map(), // playerId -> bool, filled in by voice chat
};

const STAT_LABELS = { speed: 'Speed', armor: 'Armor', firepower: 'Firepower', reload: 'Reload', agility: 'Agility' };

function buildTankCards() {
  const root = $('#tank-pick');
  root.innerHTML = '';
  for (const id of [...TANK_IDS, ...PLANE_IDS]) {
    const t = TANKS[id] ?? PLANES[id];
    if (id === PLANE_IDS[0]) root.insertAdjacentHTML('beforeend', `<h3 class="pick-head">Planes <small>${MAX_SIDE_PLANES} per side</small></h3>`);
    const btn = document.createElement('button');
    btn.className = 'tank-card';
    btn.dataset.tank = id;
    const bars = Object.entries(t.stats)
      .map(([k, v]) => `<label>${STAT_LABELS[k]}</label><div class="bar"><i style="width:${v * 20}%"></i></div>`)
      .join('');
    btn.innerHTML = `<div class="cls">${t.class}</div><b>${t.name}</b><span>${t.blurb}</span><div class="wpn">${t.weapon.label}</div>${t.inspired ? `<div class="paint">Inspired by the ${t.inspired}</div>` : ''}<div class="paint">Paint: ${PAINT[id]?.name ?? 'Standard'}</div><div class="bars">${bars}</div>`;
    btn.addEventListener('click', () => {
      const crew = lobby.myCrew;
      if (crew) net.send({ t: 'crewTank', crew: crew.id, tank: id });
      else toast('Take a seat on the team screen first.');
    });
    root.appendChild(btn);
  }
}

function buildModeCards() {
  $('#style-pick').innerHTML = `<label>Play style</label>${Object.entries(PLAY_STYLES).map(([id, name]) => `<button class="btn small" data-style="${id}" title="${id === 'solo' ? 'Each player alone in their own vehicle, driving and shooting' : 'A driver and a gunner in each vehicle'}">${name}</button>`).join('')}`;
  for (const b of $$('[data-style]')) b.addEventListener('click', () => net.send({ t: 'mode', style: b.dataset.style }));
  const root = $('#mode-pick');
  root.innerHTML = Object.entries(MODES)
    .map(([id, m]) => `<button class="mode-card" data-mode="${id}"><b>${m.name}</b><span>${m.blurb}</span></button>`)
    .join('');
  for (const b of $$('.mode-card')) b.addEventListener('click', () => net.send({ t: 'mode', mode: b.dataset.mode }));
  $('#kill-pick').innerHTML = `<label>Kill limit</label>${KILL_LIMITS.map((k) => `<button class="btn small" data-kills="${k}">${k}</button>`).join('')}`;
  for (const b of $$('[data-kills]')) b.addEventListener('click', () => net.send({ t: 'mode', killLimit: Number(b.dataset.kills) }));
  $('#diff-pick').innerHTML = `<label>NPC difficulty</label>${Object.entries(DIFFICULTY).map(([id, d]) => `<button class="btn small" data-diff="${id}">${d.name}</button>`).join('')}`;
  for (const b of $$('[data-diff]')) b.addEventListener('click', () => net.send({ t: 'mode', difficulty: b.dataset.diff }));
  $('#diff-pick').insertAdjacentHTML('beforeend', '<button class="btn small" id="air-start" title="Planes start in the air instead of on the runway">Air start</button>');
  $('#air-start').addEventListener('click', () => net.send({ t: 'mode', airStart: !lobby.state?.airStart }));
  $('#diff-pick').insertAdjacentHTML('beforeend', '<button class="btn small" id="night-mode" title="Fight in the dark: thermal sights really help">Night</button><button class="btn small" id="rain-mode" title="Rain cuts how far everyone can see">Rain</button>');
  $('#night-mode').addEventListener('click', () => net.send({ t: 'mode', night: !lobby.state?.night }));
  $('#rain-mode').addEventListener('click', () => net.send({ t: 'mode', rain: !lobby.state?.rain }));
}

export function initLobbyScreen({ onLeave }) {
  buildTankCards();
  buildModeCards();
  // Slots are re-rendered, so listen on the container.
  $('.teams-body').addEventListener('click', (e) => {
    const pick = e.target.closest('[data-offline-team]');
    if (pick && offline) {
      offline.state.team = pick.dataset.offlineTeam;
      return renderOffline();
    }
    const seat = e.target.closest('[data-seat]');
    if (seat) net.send({ t: 'seat', crew: Number(seat.dataset.crew), role: seat.dataset.seat });
  });
  $('#btn-lobby-next').addEventListener('click', () => showScreen('teams'));
  $('#btn-teams-back').addEventListener('click', () => {
    if (offline) showScreen('solo', { remember: false });
    else showScreen('lobby', { remember: false });
  });
  $('#btn-balance').addEventListener('click', () => net.send({ t: 'balance' }));
  $('#btn-ready').addEventListener('click', () => net.send({ t: 'ready', ready: !lobby.me?.ready }));
  $('#btn-start').addEventListener('click', () => {
    if (!offline) return net.send({ t: 'start' });
    const { state } = offline;
    offline = null;
    net.startSolo({ ...state });
  });
  $('#btn-lobby-leave').addEventListener('click', onLeave);
  $('#btn-copy-code').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(lobby.state?.code ?? '');
      toast('Room code copied');
    } catch {
      toast('Copy failed — read the code out to your friends.', { error: true });
    }
  });
}

// Offline solo: the same screen, with you the only player on it.
let offline = null;

export function showOfflineTeams(state) {
  offline = { state };
  renderOffline();
  showScreen('teams');
}

function renderOffline() {
  const { state } = offline;
  const t = TANKS[state.tank] ?? PLANES[state.tank];
  const fortress = state.mode === 'fortress';
  if (fortress) state.team = 'blue';
  $('#teams-room').style.display = 'none';
  $('#btn-balance').style.display = 'none';
  $('#teams-title').textContent = 'Choose Your Team';
  $('#teams-hint').textContent = fortress ? 'Fortress Defence: you defend with Blue against the Red waves.' : 'Pick a side. NPC armies fill out both teams.';
  $('#teams-blue-count').textContent = $('#teams-red-count').textContent = '';
  for (const team of ['blue', 'red']) {
    const you = `<div class="crew-card team-slot ${team} mine"><header><b>${escapeHtml(t.name)}</b><span class="crew-tank">${t.class}</span></header><div class="seats"><div class="seat you"><span>You</span></div></div></div>`;
    const join = fortress ? '' : `<button class="btn team-switch" data-offline-team="${team}">Join ${team === 'blue' ? 'Blue' : 'Red'}</button>`;
    $(`#teams-${team}`).innerHTML = state.team === team ? you : join;
  }
  $('#btn-ready').style.display = 'none';
  $('#btn-start').style.display = '';
  $('#btn-start').disabled = false;
  $('#lobby-voice').textContent = '';
  setStatus('lobby-status', '');
}

function seatHtml(s, crew, role) {
  const p = s.players.find((q) => q.id === crew[role]);
  const label = s.style === 'solo' ? 'Player' : role === 'driver' ? 'Driver' : 'Gunner';
  if (!p) return `<button class="seat free" data-crew="${crew.id}" data-seat="${role}"><small>${label}</small><span>Join here</span></button>`;
  const you = p.id === net.id ? ' you' : '';
  const tags = `${p.id === s.hostId ? '<i class="tag host">Host</i>' : ''}${p.ready || p.id === s.hostId ? '<i class="tag ready">Ready</i>' : ''}`;
  const speaking = lobby.speaking.get(p.id) ? ' on' : '';
  return `<div class="seat${you}"><small>${label}</small><span><i class="speak-dot${speaking}" data-speak="${p.id}"></i>${escapeHtml(p.name)}${p.id === net.id ? ' (you)' : ''}</span>${tags}</div>`;
}

// One vehicle slot: who's in it and what they're driving; an empty slot can be joined.
function slotHtml(s, c, me) {
  const used = c.driver != null || c.gunner != null;
  const t = TANKS[c.tank] ?? PLANES[c.tank];
  const roles = s.style === 'solo' ? ['driver'] : ['driver', 'gunner'];
  const side = s.mode === 'fortress' ? 'blue' : c.team;
  return `<div class="crew-card team-slot ${side}${used ? '' : ' empty'}${me?.crew === c.id ? ' mine' : ''}">
    <header><b>${PLANES[c.tank] ? 'Plane' : 'Tank'} ${c.id + 1}</b>${used ? `<span class="crew-tank">${escapeHtml(t.name)} · ${t.class}</span>` : ''}</header>
    <div class="seats">${roles.map((r) => seatHtml(s, c, r)).join('')}</div>
  </div>`;
}

function renderTeams(s, me) {
  offline = null;
  const fortress = s.mode === 'fortress';
  $('#teams-room').style.display = '';
  $('#teams-code').textContent = s.code;
  $('#teams-title').textContent = 'Choose Your Team';
  $('#teams-hint').textContent = fortress
    ? 'Fortress Defence: every player defends with Blue against the Red waves.'
    : `Click "Join here" to move, on either team. ${s.style === 'solo' ? 'Everyone has their own vehicle.' : 'Each vehicle needs a driver and a gunner.'} NPC armies fill out both teams.`;
  for (const team of ['blue', 'red']) {
    const crews = s.crews.filter((c) => (fortress ? 'blue' : c.team) === team);
    const players = crews.reduce((n, c) => n + (c.driver != null ? 1 : 0) + (c.gunner != null ? 1 : 0), 0);
    $(`#teams-${team}`).innerHTML = fortress && team === 'red' ? '<p class="hint">Red is all NPC attackers in this mode.</p>' : crews.map((c) => slotHtml(s, c, me)).join('');
    $(`#teams-${team}-count`).textContent = fortress && team === 'red' ? '' : `${players} player${players === 1 ? '' : 's'}`;
  }
  const unseated = s.players.filter((p) => p.crew == null);
  if (unseated.length) $('#teams-blue').insertAdjacentHTML('beforeend', `<p class="hint small">Not on a team yet: ${unseated.map((p) => escapeHtml(p.name)).join(', ')}</p>`);
  $('#btn-balance').style.display = lobby.isHost && !fortress ? '' : 'none';
}

export function renderLobby() {
  const s = lobby.state;
  if (!s) return;
  $('#lobby-code').textContent = s.code;
  const me = lobby.me;
  const fortress = s.mode === 'fortress';
  renderTeams(s, me);

  for (const b of $$('[data-style]')) {
    b.classList.toggle('on', b.dataset.style === s.style);
    b.disabled = !lobby.isHost;
  }
  for (const b of $$('.mode-card')) {
    b.classList.toggle('sel', b.dataset.mode === s.mode);
    b.disabled = !lobby.isHost;
  }
  $('#kill-pick').style.display = s.mode === 'tdm' ? '' : 'none';
  for (const b of $$('[data-diff]')) {
    b.classList.toggle('on', b.dataset.diff === s.difficulty);
    b.disabled = !lobby.isHost;
  }
  $('#air-start').classList.toggle('on', !!s.airStart);
  $('#night-mode').classList.toggle('on', !!s.night);
  $('#rain-mode').classList.toggle('on', !!s.rain);
  $('#air-start').disabled = !lobby.isHost;
  for (const b of $$('[data-kills]')) {
    b.classList.toggle('on', Number(b.dataset.kills) === s.killLimit);
    b.disabled = !lobby.isHost;
  }
  $('#mode-host-note').textContent = lobby.isHost ? '(you choose)' : '(host chooses)';
  const crew = lobby.myCrew;
  for (const card of $$('.tank-card')) {
    card.classList.toggle('sel', card.dataset.tank === crew?.tank);
    // Planes are greyed out once a side has its share; single-seat fighters are solo only.
    const side = (c) => (fortress ? 'blue' : c.team);
    const onSide = crew ? s.crews.filter((c) => c !== crew && (c.driver != null || c.gunner != null) && PLANES[c.tank] && side(c) === side(crew)).length : 0;
    const twin = crew && PLANES[card.dataset.tank]?.onePerTeam && s.crews.some((c) => c !== crew && (c.driver != null || c.gunner != null) && c.tank === card.dataset.tank && side(c) === side(crew));
    card.classList.toggle('taken', (!!PLANES[card.dataset.tank] && onSide >= MAX_SIDE_PLANES) || !!twin);
    card.style.display = PLANES[card.dataset.tank] && s.style !== 'solo' && !COOP_PLANE_IDS.includes(card.dataset.tank) ? 'none' : '';
    card.disabled = !crew;
  }
  $('#tank-host-note').textContent = crew ? (s.style === 'solo' ? '(just you)' : '(your crew shares it)') : '(take a seat on the team screen first)';

  const ready = $('#btn-ready');
  ready.style.display = lobby.isHost ? 'none' : '';
  ready.textContent = me?.ready ? 'Ready ✓' : 'Ready';
  ready.classList.toggle('on', !!me?.ready);
  $('#btn-start').style.display = lobby.isHost ? '' : 'none';

  // Same rules as the host's start check.
  const used = s.crews.filter((c) => c.driver != null || c.gunner != null);
  let status = '';
  if (s.players.some((p) => p.crew == null)) status = 'Everyone needs a seat.';
  else if (s.style === 'duo' && used.some((c) => c.driver == null || c.gunner == null)) status = 'Every vehicle needs a driver and a gunner.';
  else if (s.players.some((p) => !p.ready && p.id !== s.hostId)) status = 'Waiting for everyone to ready up…';
  else status = lobby.isHost ? 'All set — start the match!' : 'Waiting for the host to start…';
  const players = `${s.players.length}/10 players · ${used.length} vehicle${used.length === 1 ? '' : 's'}`;
  setStatus('lobby-status', `${players} — ${status}`);
  setStatus('lobby-setup-status', `${players} · ${PLAY_STYLES[s.style]}. Pick a vehicle, then choose your team.`);
  $('#btn-start').disabled = !status.startsWith('All set');
}

export function setSpeaking(id, on) {
  lobby.speaking.set(id, on);
  for (const el of $$(`[data-speak="${id}"]`)) el.classList.toggle('on', on);
}
