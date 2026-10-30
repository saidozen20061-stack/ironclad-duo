import { ROOM_CODE_LETTERS, ROOM_CODE_LENGTH, MAX_NAME_LENGTH, ROLES, TANK_IDS } from '../../../shared/constants.js';

// Lobby logic, run inside the HOST player's browser. A Player's transport is just a
// function: the host's own client gets messages delivered locally, the guest's go
// over the WebRTC data channel.

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
    this.tank = 'medium';
    this.phase = 'lobby'; // 'lobby' | 'match'
    this.match = null;
  }

  other(player) {
    return this.players.find((p) => p !== player) ?? null;
  }

  broadcast(msg, except = null) {
    for (const p of this.players) if (p !== except) p.send(msg);
  }

  add(player) {
    this.players.push(player);
    player.room = this;
    player.role = null;
    player.ready = false;
    if (this.hostId == null) this.hostId = player.id;
    // Auto-pick the free role so a fresh lobby is one click from ready.
    const taken = new Set(this.players.map((p) => p.role).filter(Boolean));
    player.role = ROLES.find((r) => !taken.has(r)) ?? null;
    this.sync();
  }

  remove(player, reason = 'left') {
    const idx = this.players.indexOf(player);
    if (idx < 0) return;
    this.players.splice(idx, 1);
    player.room = null;
    const wasMatch = this.phase === 'match';
    if (this.players.length === 0) {
      this.endMatch();
      this.manager.delete(this.code);
      return;
    }
    if (this.hostId === player.id) this.hostId = this.players[0].id;
    if (wasMatch) this.endMatch();
    for (const p of this.players) p.ready = false;
    this.broadcast({ t: 'peerLeft', name: player.name, reason, duringMatch: wasMatch });
    this.sync();
  }

  lobbyState() {
    return {
      t: 'lobby',
      code: this.code,
      hostId: this.hostId,
      tank: this.tank,
      phase: this.phase,
      players: this.players.map((p) => ({ id: p.id, name: p.name, role: p.role, ready: p.ready })),
    };
  }

  sync() {
    this.broadcast(this.lobbyState());
  }

  setRole(player, role) {
    if (this.phase !== 'lobby') return;
    if (role !== null && !ROLES.includes(role)) return;
    if (role && this.players.some((p) => p !== player && p.role === role)) {
      player.send({ t: 'error', msg: 'That role is already taken.' });
      return;
    }
    player.role = role;
    for (const p of this.players) p.ready = false;
    this.sync();
  }

  setTank(player, tank) {
    if (this.phase !== 'lobby' || player.id !== this.hostId || !TANK_IDS.includes(tank)) return;
    this.tank = tank;
    for (const p of this.players) p.ready = false;
    this.sync();
  }

  setReady(player, ready) {
    if (this.phase !== 'lobby') return;
    if (ready && !player.role) {
      player.send({ t: 'error', msg: 'Pick a role before readying up.' });
      return;
    }
    player.ready = !!ready;
    this.sync();
    this.tryStart();
  }

  tryStart() {
    if (this.players.length !== 2) return;
    if (!this.players.every((p) => p.ready && p.role)) return;
    if (this.players[0].role === this.players[1].role) return;
    this.phase = 'match';
    this.manager.onMatchStart?.(this);
    this.broadcast({
      t: 'matchStart',
      tank: this.tank,
      roles: Object.fromEntries(this.players.map((p) => [p.id, p.role])),
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
        if (r.players.length >= 2) return player.send({ t: 'error', msg: 'That room is full.' }), true;
        if (r.phase !== 'lobby') return player.send({ t: 'error', msg: 'That match is already running.' }), true;
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
      case 'role':
        room?.setRole(player, msg.role ?? null);
        return true;
      case 'tank':
        room?.setTank(player, msg.tank);
        return true;
      case 'ready':
        room?.setReady(player, msg.ready);
        return true;
      case 'toLobby':
        if (room && room.phase === 'match' && room.match?.over) room.returnToLobby();
        return true;
      case 'signal':
        // WebRTC voice signaling relay; payload is opaque to the server.
        room?.other(player)?.send({ t: 'signal', from: player.id, data: msg.data });
        return true;
      default:
        return false;
    }
  }
}
