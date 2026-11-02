import { TANKS, TANK_IDS, MODES, KILL_LIMITS, DIFFICULTY } from '../../../shared/constants.js';
import { PLANES, COOP_PLANE_IDS } from '../../../shared/planes.js';
import { net } from '../net.js';
import { PAINT } from '../models/paint.js';
import { $, $$, escapeHtml, toast, setStatus } from './screens.js';

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
  for (const id of [...TANK_IDS, ...COOP_PLANE_IDS]) {
    const t = TANKS[id] ?? PLANES[id];
    if (id === COOP_PLANE_IDS[0]) root.insertAdjacentHTML('beforeend', '<h3 class="pick-head">Planes <small>pilot + rear gunner · one per side</small></h3>');
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
      else toast('Take a seat in a crew first.');
    });
    root.appendChild(btn);
  }
}

function buildModeCards() {
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
}

export function initLobbyScreen({ onLeave }) {
  buildTankCards();
  buildModeCards();
  // Seat and team buttons are re-rendered, so listen on the container.
  $('#lobby-crews').addEventListener('click', (e) => {
    const seat = e.target.closest('[data-seat]');
    if (seat) return net.send({ t: 'seat', crew: Number(seat.dataset.crew), role: seat.dataset.seat });
    const team = e.target.closest('[data-team-toggle]');
    if (team && lobby.isHost) {
      const crew = lobby.state.crews[Number(team.dataset.teamToggle)];
      net.send({ t: 'crewTeam', crew: crew.id, team: crew.team === 'blue' ? 'red' : 'blue' });
    }
  });
  $('#btn-balance').addEventListener('click', () => net.send({ t: 'balance' }));
  $('#btn-ready').addEventListener('click', () => net.send({ t: 'ready', ready: !lobby.me?.ready }));
  $('#btn-start').addEventListener('click', () => net.send({ t: 'start' }));
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

function seatHtml(s, crew, role) {
  const p = s.players.find((q) => q.id === crew[role]);
  const label = role === 'driver' ? 'Driver' : 'Gunner';
  if (!p) return `<button class="seat free" data-crew="${crew.id}" data-seat="${role}"><small>${label}</small><span>Take seat</span></button>`;
  const you = p.id === net.id ? ' you' : '';
  const tags = `${p.id === s.hostId ? '<i class="tag host">Host</i>' : ''}${p.ready || p.id === s.hostId ? '<i class="tag ready">Ready</i>' : ''}`;
  const speaking = lobby.speaking.get(p.id) ? ' on' : '';
  return `<div class="seat${you}"><small>${label}</small><span><i class="speak-dot${speaking}" data-speak="${p.id}"></i>${escapeHtml(p.name)}${p.id === net.id ? ' (you)' : ''}</span>${tags}</div>`;
}

export function renderLobby() {
  const s = lobby.state;
  if (!s) return;
  $('#lobby-code').textContent = s.code;
  const me = lobby.me;
  const fortress = s.mode === 'fortress';

  $('#lobby-crews').innerHTML = s.crews
    .map((c) => {
      const used = c.driver != null || c.gunner != null;
      const t = TANKS[c.tank] ?? PLANES[c.tank];
      const team = fortress ? 'blue' : c.team;
      const mine = me?.crew === c.id ? ' mine' : '';
      return `<div class="crew-card ${team}${used ? '' : ' empty'}${mine}">
        <header><b>Tank ${c.id + 1}</b>
          <button class="team-badge ${team}" data-team-toggle="${c.id}" ${lobby.isHost && !fortress ? '' : 'disabled'}>${team === 'blue' ? 'BLUE' : 'RED'}</button>
          <span class="crew-tank">${t.name} · ${t.class} · <em>${PAINT[c.tank]?.name ?? ''}</em></span></header>
        <div class="seats">${seatHtml(s, c, 'driver')}${seatHtml(s, c, 'gunner')}</div>
      </div>`;
    })
    .join('');
  const unseated = s.players.filter((p) => p.crew == null);
  if (unseated.length) $('#lobby-crews').insertAdjacentHTML('beforeend', `<p class="hint small">Not in a crew: ${unseated.map((p) => escapeHtml(p.name)).join(', ')}</p>`);

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
  $('#air-start').disabled = !lobby.isHost;
  for (const b of $$('[data-kills]')) {
    b.classList.toggle('on', Number(b.dataset.kills) === s.killLimit);
    b.disabled = !lobby.isHost;
  }
  $('#mode-host-note').textContent = lobby.isHost ? '(you choose)' : '(host chooses)';
  $('#host-tools').style.display = lobby.isHost && !fortress ? '' : 'none';

  const crew = lobby.myCrew;
  for (const card of $$('.tank-card')) {
    card.classList.toggle('sel', card.dataset.tank === crew?.tank);
    // One plane per side: taken planes are greyed out for everyone else on that side.
    const side = (c) => (fortress ? 'blue' : c.team);
    card.classList.toggle('taken', !!PLANES[card.dataset.tank] && !!crew && s.crews.some((c) => c !== crew && (c.driver != null || c.gunner != null) && PLANES[c.tank] && side(c) === side(crew)));
    card.disabled = !crew;
  }
  $('#tank-host-note').textContent = crew ? `(Tank ${crew.id + 1})` : '(join a crew first)';

  const ready = $('#btn-ready');
  ready.style.display = lobby.isHost ? 'none' : '';
  ready.textContent = me?.ready ? 'Ready ✓' : 'Ready';
  ready.classList.toggle('on', !!me?.ready);
  $('#btn-start').style.display = lobby.isHost ? '' : 'none';

  // Same rules as the host's start check.
  const used = s.crews.filter((c) => c.driver != null || c.gunner != null);
  let status = '';
  if (s.players.some((p) => p.crew == null)) status = 'Everyone needs a seat.';
  else if (used.some((c) => c.driver == null || c.gunner == null)) status = 'Every crew needs a driver and a gunner.';
  else if (s.players.some((p) => !p.ready && p.id !== s.hostId)) status = 'Waiting for everyone to ready up…';
  else status = lobby.isHost ? 'All set — start the match!' : 'Waiting for the host to start…';
  const players = `${s.players.length}/10 players · ${used.length} crew${used.length === 1 ? '' : 's'}`;
  setStatus('lobby-status', `${players} — ${status}`);
  $('#btn-start').disabled = !status.startsWith('All set');
}

export function setSpeaking(id, on) {
  lobby.speaking.set(id, on);
  for (const el of $$(`[data-speak="${id}"]`)) el.classList.toggle('on', on);
}
