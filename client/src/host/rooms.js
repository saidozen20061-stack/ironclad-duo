import { COOP_PLANE_IDS, PLANE_IDS, PLANES, MAX_SIDE_PLANES } from '../../../shared/planes.js';
import { ROOM_CODE_LETTERS, ROOM_CODE_LENGTH, MAX_NAME_LENGTH, ROLES, TANK_IDS, MAX_CREWS, MAX_PLAYERS, MODES, KILL_LIMITS, DIFFICULTY, PLAY_STYLES } from '../../../shared/constants.js';

// Lobby logic, run inside the HOST player's browser. A Player's transport is just a
// function: the host's own client gets messages delivered locally, guests' go over
// their WebRTC data channels (star setup: everyone talks to the host).
//
// A room has five vehicle slots per team. In a 'duo' room a slot is a driver seat + a gunner
// seat; in a 'solo' room each player has a vehicle to themselves, in the driver's seat.
// Players click a free seat on either team to move there.

let nextPlayerId = 1;

function cleanName(name) {
  const s = String(name ?? '').replace(/[^\p{L}\p{N} _\-.]/gu, '').trim().slice(0, MAX_NAME_LENGTH);
  return s || 'Tanker';
}

export class Player {
  constructor(sendFn) {
    this.id = nextPlayerId++;
    this.sendFn = sendFn;
    this.name = 'Tanker';
    this.crew = null; // crew index or null
    this.role = null;
    this.ready = false;
    this.room = null;
  }
  send(msg) {
    this.sendFn(msg);
  }
}

export class Room {
  constructor(code, manager) {
    this.code = code;
    this.manager = manager;
    this.players = [];
    this.hostId = null;
    this.crews = Array.from({ length: MAX_CREWS }, (_, id) => ({ id, team: id % 2 ? 'red' : 'blue', tank: 'medium', driver: null, gunner: null }));
    this.style = 'duo';
    this.mode = 'flags';
    this.killLimit = 20;
    this.difficulty = 'easy';
    this.airStart = false;
    this.phase = 'lobby'; // 'lobby' | 'match'
    this.match = null;
  }

  get full() {
    return this.players.length >= MAX_PLAYERS;
  }

  byId(id) {
    return this.players.find((p) => p.id === id) ?? null;
  }

  broadcast(msg, except = null) {
    for (const p of this.players) if (p !== except) p.send(msg);
  }

  occupied() {
    return this.crews.filter((c) => c.driver != null || c.gunner != null);
  }

  add(player) {
    this.players.push(player);
    player.room = this;
    player.ready = false;
    if (this.hostId == null) this.hostId = player.id;
    // Auto-seat: complete a half-filled crew first (duo), otherwise start a new one.
    const half = this.style === 'duo' ? this.crews.find((c) => (c.driver == null) !== (c.gunner == null)) : null;
    const crew = half ?? this.crews.find((c) => c.driver == null && c.gunner == null);
    if (crew) this.place(player, crew, crew.driver == null ? 'driver' : 'gunner');
    this.sync();
  }

  place(player, crew, role) {
    this.unseat(player);
    crew[role] = player.id;
    player.crew = crew.id;
    player.role = role;
  }

  unseat(player) {
    for (const c of this.crews) {
      if (c.driver === player.id) c.driver = null;
      if (c.gunner === player.id) c.gunner = null;
    }
    player.crew = null;
    player.role = null;
  }

  remove(player, reason = 'left') {
    const idx = this.players.indexOf(player);
    if (idx < 0) return;
    this.players.splice(idx, 1);
    const crew = player.crew;
    const role = player.role;
    this.unseat(player);
    player.room = null;
    if (this.players.length === 0) {
      this.endMatch();
      this.manager.delete(this.code);
      return;
    }
    if (this.hostId === player.id) this.hostId = this.players[0].id;
    const duringMatch = this.phase === 'match';
    // Guests leaving mid-match free their seat; the match carries on without them.
    if (duringMatch) this.match?.playerLeft?.(crew, role);
    else for (const p of this.players) if (p.crew === crew) p.ready = false;
    this.broadcast({ t: 'peerLeft', name: player.name, reason, duringMatch: false, id: player.id });
    this.sync();
  }

  lobbyState() {
    return {
      t: 'lobby',
      code: this.code,
      hostId: this.hostId,
      phase: this.phase,
      style: this.style,
      mode: this.mode,
      killLimit: this.killLimit,
      difficulty: this.difficulty,
      airStart: this.airStart,
      crews: this.crews,
      players: this.players.map((p) => ({ id: p.id, name: p.name, crew: p.crew, role: p.role, ready: p.ready })),
    };
  }

  sideOf(crew) {
    return this.mode === 'fortress' ? 'blue' : crew.team;
  }

  // The planes this play style can use: single-seat fighters need a solo pilot.
  planeIds() {
    return this.style === 'solo' ? PLANE_IDS : COOP_PLANE_IDS;
  }

  // Too many planes on a side after a team change, or one that doesn't fit the play style:
  // the later crew goes back to a tank.
  limitPlanes() {
    const taken = { blue: 0, red: 0 };
    const unique = new Set();
    for (const c of this.occupied()) {
      if (!PLANE_IDS.includes(c.tank)) continue;
      const key = `${this.sideOf(c)}|${c.tank}`;
      if (!this.planeIds().includes(c.tank) || taken[this.sideOf(c)] >= MAX_SIDE_PLANES || (PLANES[c.tank].onePerTeam && unique.has(key))) {
        c.tank = 'medium';
        this.unready(c);
      } else {
        taken[this.sideOf(c)]++;
        unique.add(key);
      }
    }
  }

  // Switching play style: in a solo room nobody shares a vehicle.
  setStyle(style) {
    if (style === this.style) return;
    this.style = style;
    for (const p of this.players) p.ready = false;
    if (style !== 'solo') return;
    for (const c of this.crews) {
      if (c.gunner == null) continue;
      const p = this.byId(c.gunner);
      const free = c.driver == null ? c : this.crews.find((q) => q.driver == null && q.gunner == null && q.team === c.team) ?? this.crews.find((q) => q.driver == null && q.gunner == null);
      if (!free) continue;
      if (free !== c) free.tank = c.tank;
      c.gunner = null;
      free.driver = p.id;
      p.crew = free.id;
      p.role = 'driver';
    }
  }

  sync() {
    this.limitPlanes();
    this.broadcast(this.lobbyState());
  }

  isHost(player) {
    return player.id === this.hostId;
  }

  // A seat emptied during the running match, if any: { crew, role }.
  freeMatchSeat() {
    if (this.phase !== 'match') return null;
    for (const c of this.matchInfo.crews) {
      for (const role of this.style === 'solo' ? ['driver'] : ROLES) if (this.crews[c.id][role] == null) return { crew: c, role };
    }
    return null;
  }

  // Someone joined a running match: they take over the empty seat.
  addToMatch(player) {
    const { crew, role } = this.freeMatchSeat();
    this.players.push(player);
    player.room = this;
    player.ready = true;
    this.place(player, this.crews[crew.id], role);
    crew[role] = player.id;
    this.match?.playerJoined?.(crew.id, role);
    player.send({ t: 'joined', code: this.code, you: player.id });
    this.sendMatchStart(player);
    this.broadcast({ t: 'crewNames', crews: this.matchInfo.crews, names: this.names() }, player);
    this.broadcast({ t: 'peerBack', name: player.name }, player);
    this.sync();
  }

  // Alone in a crew during a match: move to the other seat.
  swapSeat(player) {
    if (this.phase !== 'match' || player.crew == null || this.style === 'solo') return;
    const live = this.crews[player.crew];
    const to = player.role === 'driver' ? 'gunner' : 'driver';
    if (live[to] != null) return;
    const from = player.role;
    this.place(player, live, to);
    const crew = this.matchInfo.crews.find((c) => c.id === live.id);
    crew[from] = null;
    crew[to] = player.id;
    this.match?.swapSeat?.(live.id, from, to);
    this.sendMatchStart(player);
    this.sync();
  }

  names() {
    return Object.fromEntries(this.players.map((p) => [p.id, p.name]));
  }

  sendMatchStart(player) {
    player.send({ t: 'matchStart', ...this.matchInfo, names: this.names() });
  }

  unready(crew) {
    for (const p of this.players) if (p.crew === crew.id) p.ready = false;
  }

  seat(player, crewId, role) {
    if (this.phase !== 'lobby') return;
    const crew = this.crews[crewId];
    if (!crew || !ROLES.includes(role) || (this.style === 'solo' && role !== 'driver')) return;
    if (crew[role] != null && crew[role] !== player.id) {
      player.send({ t: 'error', msg: 'That seat is taken.' });
      return;
    }
    const old = this.crews[player.crew];
    // Moving to an empty slot, you bring the vehicle you picked.
    if (old && old !== crew && crew.driver == null && crew.gunner == null) crew.tank = old.tank;
    this.place(player, crew, role);
    player.ready = false;
    if (old) this.unready(old);
    this.unready(crew);
    this.sync();
  }

  setCrewTank(player, crewId, tank) {
    const crew = this.crews[crewId];
    if (this.phase !== 'lobby' || !crew || !(TANK_IDS.includes(tank) || this.planeIds().includes(tank))) return;
    if (player.crew !== crewId && !this.isHost(player)) return;
    if (PLANE_IDS.includes(tank) && this.occupied().filter((c) => c !== crew && PLANE_IDS.includes(c.tank) && this.sideOf(c) === this.sideOf(crew)).length >= MAX_SIDE_PLANES) {
      return player.send({ t: 'error', msg: `Your side already has ${MAX_SIDE_PLANES} planes.` });
    }
    if (PLANES[tank]?.onePerTeam && this.occupied().some((c) => c !== crew && c.tank === tank && this.sideOf(c) === this.sideOf(crew))) {
      return player.send({ t: 'error', msg: `Your side already has a ${PLANES[tank].name}.` });
    }
    crew.tank = tank;
    this.unready(crew);
    this.sync();
  }

  setCrewTeam(player, crewId, team) {
    const crew = this.crews[crewId];
    if (this.phase !== 'lobby' || !crew || !this.isHost(player) || (team !== 'blue' && team !== 'red')) return;
    crew.team = team;
    this.sync();
  }

  // Alternate the occupied crews between Blue and Red.
  autoBalance(player) {
    if (this.phase !== 'lobby' || !this.isHost(player)) return;
    this.occupied().forEach((c, i) => (c.team = i % 2 ? 'red' : 'blue'));
    this.sync();
  }

  setMode(player, mode, killLimit, difficulty, airStart, style) {
    if (this.phase !== 'lobby' || !this.isHost(player)) return;
    if (Object.hasOwn(PLAY_STYLES, style ?? '')) this.setStyle(style);
    if (Object.hasOwn(MODES, mode ?? '')) this.mode = mode;
    if (KILL_LIMITS.includes(killLimit)) this.killLimit = killLimit;
    if (Object.hasOwn(DIFFICULTY, difficulty ?? '')) this.difficulty = difficulty;
    if (typeof airStart === 'boolean') this.airStart = airStart;
    this.sync();
  }

  setReady(player, ready) {
    if (this.phase !== 'lobby') return;
    const crew = this.crews[player.crew];
    if (ready && !crew) return player.send({ t: 'error', msg: 'Take a seat in a crew first.' });
    if (ready && this.style === 'duo' && (crew.driver == null || crew.gunner == null)) return player.send({ t: 'error', msg: 'Your crew needs both a driver and a gunner.' });
    player.ready = !!ready;
    this.sync();
  }

  // Why the host can't start yet, or null when everything is set.
  startProblem() {
    const crews = this.occupied();
    if (!crews.length) return 'No crews yet.';
    if (this.players.some((p) => p.crew == null)) return 'Everyone needs a seat.';
    if (this.style === 'duo' && crews.some((c) => c.driver == null || c.gunner == null)) return 'Every crew needs a driver and a gunner.';
    if (this.players.some((p) => !p.ready && p.id !== this.hostId)) return 'Waiting for everyone to ready up…';
    return null;
  }

  start(player) {
    if (this.phase !== 'lobby' || !this.isHost(player)) return;
    const problem = this.startProblem();
    if (problem) return player.send({ t: 'error', msg: problem });
    const crews = this.occupied().map((c) => ({ ...c, team: this.mode === 'fortress' ? 'blue' : c.team }));
    this.phase = 'match';
    this.matchInfo = { style: this.style, mode: this.mode, killLimit: this.killLimit, difficulty: this.difficulty, airStart: this.airStart, crews };
    this.manager.onMatchStart?.(this);
    this.broadcast({
      t: 'matchStart',
      ...this.matchInfo,
      names: this.names(),
    });
    this.sync();
  }

  endMatch() {
    this.match?.dispose?.();
    this.match = null;
    this.phase = 'lobby';
  }

  returnToLobby() {
    this.endMatch();
    for (const p of this.players) p.ready = false;
    this.broadcast({ t: 'toLobby' });
    this.sync();
  }
}

export class RoomManager {
  constructor() {
    this.rooms = new Map();
    this.onMatchStart = null;
  }

  newCode() {
    for (let attempt = 0; attempt < 1000; attempt++) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
        code += ROOM_CODE_LETTERS[Math.floor(Math.random() * ROOM_CODE_LETTERS.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('Could not allocate room code');
  }

  create(code = this.newCode()) {
    const room = new Room(code, this);
    this.rooms.set(room.code, room);
    return room;
  }

  delete(code) {
    this.rooms.delete(code);
  }

  // Lobby-level messages. Returns true if handled.
  handle(player, msg) {
    const room = player.room;
    switch (msg.t) {
      case 'hello':
        player.name = cleanName(msg.name);
        room?.sync();
        return true;
      case 'host': {
        room?.remove(player);
        const r = this.create();
        r.add(player);
        player.send({ t: 'joined', code: r.code, you: player.id });
        r.sync();
        return true;
      }
      case 'join': {
        const code = String(msg.code ?? '').toUpperCase().trim();
        const r = this.rooms.get(code);
        if (!r) return player.send({ t: 'error', msg: `No room with code ${code || '(empty)'}.` }), true;
        if (r === room) return true;
        if (r.full) return player.send({ t: 'error', msg: 'That room is full (10 players).' }), true;
        if (r.phase !== 'lobby') {
          if (!r.freeMatchSeat()) return player.send({ t: 'error', msg: 'That match is running and every seat is taken.' }), true;
          room?.remove(player);
          r.addToMatch(player);
          return true;
        }
        room?.remove(player);
        r.add(player);
        player.send({ t: 'joined', code: r.code, you: player.id });
        r.sync();
        return true;
      }
      case 'leave':
        room?.remove(player);
        player.send({ t: 'left' });
        return true;
      case 'seat':
        room?.seat(player, Number(msg.crew), msg.role);
        return true;
      case 'crewTank':
        room?.setCrewTank(player, Number(msg.crew), msg.tank);
        return true;
      case 'crewTeam':
        room?.setCrewTeam(player, Number(msg.crew), msg.team);
        return true;
      case 'balance':
        room?.autoBalance(player);
        return true;
      case 'mode':
        room?.setMode(player, msg.mode, Number(msg.killLimit), msg.difficulty, msg.airStart, msg.style);
        return true;
      case 'swapSeat':
        room?.swapSeat(player);
        return true;
      case 'ready':
        room?.setReady(player, msg.ready);
        return true;
      case 'start':
        room?.start(player);
        return true;
      case 'toLobby':
        if (room && room.phase === 'match' && room.match?.over && room.isHost(player)) room.returnToLobby();
        return true;
      case 'signal':
        // WebRTC voice signaling relay to one player; payload is opaque to the host.
        room?.byId(msg.to)?.send({ t: 'signal', from: player.id, data: msg.data });
        return true;
      default:
        return false;
    }
  }
}
