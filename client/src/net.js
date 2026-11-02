import Peer from 'peerjs';
import { RoomManager, Player } from './host/rooms.js';
import { iceServers, hasTurn } from './iceConfig.js';

// Peer-to-peer networking. There is no game server: the HOST's browser runs the lobby
// and the simulation (in a Web Worker), and the guest connects straight to it over a
// WebRTC data channel. PeerJS's free public broker is only used to find each other:
// the room code is part of the host's PeerJS id.
//
// The rest of the game talks to `net` exactly as it did to the old WebSocket server:
// net.send({ t: ... }) and net.on('lobby' | 's' | 'matchStart' | ..., fn).

export const PEER_PREFIX = 'ironclad-duo-v1-';
const HEARTBEAT_MS = 2000;
const TIMEOUT_MS = 12000;
const CONNECT_TIMEOUT_MS = 20000;

const peerOptions = () => ({ debug: 1, config: { iceServers: iceServers() } });

function friendlyPeerError(err, code) {
  switch (err?.type) {
    case 'peer-unavailable':
      return `No game found with code ${code}. Check the code, and make sure the host is still in the lobby.`;
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
      return "Can't reach the matchmaking service. Check your internet connection and try again.";
    case 'browser-incompatible':
      return "This browser doesn't support WebRTC. Try a current Chrome, Edge or Firefox.";
    case 'ssl-unavailable':
      return 'Online play needs the game to be opened over https:// (or localhost).';
    default:
      return `Connection error (${err?.type ?? err?.message ?? 'unknown'}). Please try again.`;
  }
}

const iceHelp = () =>
  hasTurn()
    ? 'Could not connect to the host. Your networks may block the connection even through the relay server — try again or check the TURN settings.'
    : 'Could not open a direct connection to the host. One of you is probably behind a strict firewall or mobile network. Both players can add a TURN relay server in Settings → Network (see the README), then try again.';

// Runs the room + simulation for both players inside the host's browser.
class LocalHost {
  constructor(net) {
    this.net = net;
    this.manager = new RoomManager();
    this.manager.onMatchStart = (room) => {
      room.match = new SimProxy(room);
    };
    this.guests = new Map(); // conn -> { player, lastSeen }
  }

  async start(name) {
    let lastErr = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      const code = this.manager.newCode();
      try {
        this.peer = await openPeer(PEER_PREFIX + code);
        this.code = code;
        break;
      } catch (err) {
        lastErr = err;
        if (err?.type !== 'unavailable-id') throw err;
      }
    }
    if (!this.peer) throw lastErr;
    this.peer.on('connection', (conn) => this.accept(conn));
    // Keep the broker connection alive so the friend can still find us.
    // (A peer that's being torn down also reports 'disconnected': don't revive it.)
    this.peer.on('disconnected', () => {
      if (this.closed || this.peer.destroyed) return;
      try {
        this.peer.reconnect();
      } catch {
        // already destroyed in the meantime
      }
    });
    this.peer.on('error', (err) => console.warn('peer error', err?.type, err));

    this.room = this.manager.create(this.code);
    this.me = new Player((msg) => this.net.deliver(msg));
    this.me.name = name;
    this.net.id = this.me.id;
    this.room.add(this.me);
    this.me.send({ t: 'joined', code: this.code, you: this.me.id });
    this.room.sync();
    this.heartbeat = setInterval(() => this.checkGuests(), HEARTBEAT_MS);
    return this.code;
  }

  accept(conn) {
    conn.on('open', () => {
      const running = this.room.phase !== 'lobby';
      if (this.closed || this.room.full || (running && !this.room.freeMatchSeat())) {
        conn.send({ t: 'error', msg: running ? 'That match is running and every seat is taken.' : 'That room is full (10 players).' });
        setTimeout(() => conn.close(), 500);
        return;
      }
      const player = new Player((msg) => conn.open && conn.send(msg));
      const g = { player, lastSeen: performance.now(), conn };
      this.guests.set(conn, g);
      conn.send({ t: 'welcome', id: player.id });
      conn.on('data', (msg) => {
        g.lastSeen = performance.now();
        if (!msg || typeof msg.t !== 'string' || msg.t === 'hb') return;
        if (msg.t === 'leave') return this.dropGuest(conn, 'left');
        if (!this.manager.handle(player, msg)) player.room?.match?.onMessage(player, msg);
      });
      conn.on('close', () => this.dropGuest(conn, 'disconnected'));
      conn.on('error', () => this.dropGuest(conn, 'disconnected'));
    });
  }

  dropGuest(conn, reason) {
    const g = this.guests.get(conn);
    if (!g) return;
    this.guests.delete(conn);
    g.player.room?.remove(g.player, reason);
    try {
      conn.close();
    } catch {
      // already closed
    }
  }

  checkGuests() {
    const now = performance.now();
    for (const [conn, g] of this.guests) {
      if (now - g.lastSeen > TIMEOUT_MS) this.dropGuest(conn, 'disconnected');
      else if (conn.open) conn.send({ t: 'hb' });
    }
  }

  fromLocal(msg) {
    if (msg.t === 'hb' || msg.t === 'hello' && !msg.name) return;
    if (!this.manager.handle(this.me, msg)) this.room?.match?.onMessage(this.me, msg);
  }

  shutdown() {
    this.closed = true;
    clearInterval(this.heartbeat);
    for (const conn of this.guests.keys()) {
      try {
        conn.send({ t: 'hostLeft' });
      } catch {
        // ignore
      }
    }
    // Give the goodbye a moment to leave before tearing the peer down.
    const peer = this.peer;
    setTimeout(() => peer?.destroy(), 300);
    this.room?.endMatch();
  }
}

// The match simulation lives in a worker; this forwards inputs in and snapshots out.
// Snapshots are tailored per player before they go on the wire:
//  - only unit rows that changed since that player's last packet are sent (+ removals),
//    with a full keyframe every few seconds;
//  - units far from the player's crew are refreshed at a quarter of the tick rate;
//  - shot/impact events far away are dropped.
const FAR = 350; // m: beyond this, units update at 5 Hz
const EVENT_RANGE = 750; // m: shots / impacts further away aren't sent
const KEYFRAME = 60; // ticks between full unit lists

class SimProxy {
  constructor(room) {
    this.room = room;
    this.over = false;
    this.views = new Map(); // player -> { last: Map(id -> row), n }
    this.worker = new Worker(new URL('./host/simWorker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => {
      const msg = e.data;
      if (msg.t === 'matchEnd') this.over = true;
      if (msg.t === 's') this.sendSnapshot(msg);
      else room.broadcast(msg);
    };
    this.worker.onerror = (e) => console.error('simulation worker error', e.message ?? e);
    const info = room.matchInfo;
    this.worker.postMessage({ type: 'start', crews: info.crews, mode: info.mode, killLimit: info.killLimit, difficulty: info.difficulty, airStart: info.airStart });
  }

  sendSnapshot(msg) {
    const { crews, focus, u, ev, ...common } = msg;
    const ids = new Set();
    for (const a of u) ids.add(a[0]);
    for (const p of this.room.players) {
      let v = this.views.get(p);
      if (!v) this.views.set(p, (v = { last: new Map(), n: 0 }));
      const f = focus[p.crew];
      const full = v.n++ % KEYFRAME === 0;
      const slow = msg.tick % 4 !== 0;
      const rows = [];
      for (const a of u) {
        const prev = v.last.get(a[0]);
        if (!full && prev && same(prev, a)) continue;
        // Far away and only moving: wait for the 5 Hz slot (state changes like death go now).
        if (!full && prev && slow && f && prev[9] === a[9] && Math.hypot(a[3] / 10 - f[0], a[4] / 10 - f[1]) > FAR) continue;
        rows.push(a);
        v.last.set(a[0], a);
      }
      const rm = [];
      for (const id of v.last.keys()) if (!ids.has(id)) rm.push(id);
      for (const id of rm) v.last.delete(id);
      const out = { ...common, me: crews[p.crew], u: rows };
      if (rm.length) out.rm = rm;
      if (full) out.full = 1;
      if (ev) {
        const near = f ? ev.filter((e) => (e.k !== 'f' && e.k !== 'i') || e.o === crews[p.crew]?.id || Math.hypot(e.x - f[0], e.z - f[1]) < EVENT_RANGE) : ev;
        if (near.length) out.ev = near;
      }
      p.send(out);
    }
  }

  onMessage(player, msg) {
    if (msg.t === 'toLobby') return;
    this.worker.postMessage({ type: 'input', crew: player.crew, role: player.role, msg });
  }

  playerLeft(crew, role) {
    this.worker.postMessage({ type: 'left', crew, role });
  }

  playerJoined(crew, role) {
    this.worker.postMessage({ type: 'joined', crew, role });
  }

  swapSeat(crew, from, to) {
    this.worker.postMessage({ type: 'swap', crew, from, to });
  }

  dispose() {
    this.worker.terminate();
  }
}

function same(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function openPeer(id) {
  return new Promise((resolve, reject) => {
    const peer = id ? new Peer(id, peerOptions()) : new Peer(peerOptions());
    const timer = setTimeout(() => {
      peer.destroy();
      reject({ type: 'network' });
    }, CONNECT_TIMEOUT_MS);
    peer.once('open', () => {
      clearTimeout(timer);
      resolve(peer);
    });
    peer.once('error', (err) => {
      clearTimeout(timer);
      peer.destroy();
      reject(err);
    });
  });
}

export class Net {
  constructor() {
    this.handlers = new Map();
    this.id = null;
    this.mode = null; // null | 'host' | 'guest'
    this.name = 'Tanker';
    this.host = null;
    this.peer = null;
    this.conn = null;
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.handlers.get(type).delete(fn);
  }

  emit(type, msg) {
    for (const fn of this.handlers.get(type) ?? []) fn(msg);
    for (const fn of this.handlers.get('*') ?? []) fn(msg);
  }

  // A message from the (local or remote) host to this client.
  deliver(msg) {
    // Async like a real network hop, so handlers never run re-entrantly.
    queueMicrotask(() => this.emit(msg.t, msg));
  }

  get connected() {
    return this.mode === 'host' || (this.mode === 'guest' && !!this.conn?.open);
  }

  // Kept for compatibility with the menu code: P2P needs no up-front connection.
  connect() {
    return Promise.resolve();
  }

  // Solo: the simulation worker runs right here, no PeerJS / room. One player drives and
  // shoots; their crew's gunner seat stays empty so only one soldier bails out.
  startSolo({ tank, paint, mode, killLimit, difficulty, airStart }) {
    this.leave();
    this.mode = 'solo';
    this.id = 1;
    const me = { id: 1, crew: 0, role: 'driver', send: (msg) => this.deliver(msg) };
    const crew = { id: 0, team: 'blue', tank, driver: 1, gunner: 1 };
    const room = { players: [me], matchInfo: { mode, killLimit, difficulty, airStart, crews: [crew] }, broadcast: (msg) => this.deliver(msg) };
    this.solo = new SimProxy(room);
    this.solo.playerLeft(0, 'gunner');
    this.deliver({ t: 'matchStart', solo: true, paint, ...room.matchInfo, names: { 1: this.name } });
  }

  send(msg) {
    if (this.mode === 'solo') {
      if (msg.t === 'leave') return this.leave();
      if (!this.solo || ['hello', 'hb', 'toLobby', 'signal'].includes(msg.t)) return;
      // Gun inputs act as the gunner seat, everything else (drive, bail-out, on foot) as the driver.
      const role = ['aim', 'trigger', 'shell', 'rear'].includes(msg.t) ? 'gunner' : 'driver';
      return this.solo.onMessage({ crew: 0, role }, msg);
    }
    switch (msg.t) {
      case 'hello':
        this.name = msg.name || this.name;
        break;
      case 'host':
        return this.startHost();
      case 'join':
        return this.startJoin(String(msg.code ?? '').toUpperCase().trim());
      case 'leave':
        return this.leave();
    }
    if (this.mode === 'host') this.host.fromLocal(msg);
    else if (this.mode === 'guest' && this.conn?.open) this.conn.send(msg);
  }

  async startHost() {
    this.leave();
    this.mode = 'host';
    this.host = new LocalHost(this);
    try {
      await this.host.start(this.name);
    } catch (err) {
      this.host.shutdown();
      this.host = null;
      this.mode = null;
      this.emit('error', { t: 'error', msg: friendlyPeerError(err, ''), where: 'host' });
    }
  }

  startJoin(code) {
    this.leave();
    if (!/^[A-Z]{5}$/.test(code)) {
      this.emit('error', { t: 'error', msg: 'Room codes are 5 letters.', where: 'join' });
      return;
    }
    this.mode = 'guest';
    const fail = (msg) => {
      if (this.mode !== 'guest' || this.joinedOk) return;
      this.emit('error', { t: 'error', msg, where: 'join' });
      this.leave();
    };
    this.joinedOk = false;
    openPeer(null)
      .then((peer) => {
        if (this.mode !== 'guest') return peer.destroy();
        this.peer = peer;
        peer.on('error', (err) => {
          if (!this.joinedOk) fail(friendlyPeerError(err, code));
        });
        const conn = peer.connect(PEER_PREFIX + code, { reliable: true, serialization: 'json' });
        this.conn = conn;
        const timer = setTimeout(() => fail(iceHelp()), CONNECT_TIMEOUT_MS);
        conn.on('open', () => {
          clearTimeout(timer);
          this.lastSeen = performance.now();
          conn.send({ t: 'hello', name: this.name });
          conn.send({ t: 'join', code });
          this.heartbeat = setInterval(() => this.guestHeartbeat(), HEARTBEAT_MS);
        });
        conn.on('data', (msg) => this.fromHost(msg));
        conn.on('close', () => this.lostHost('Connection to the host was lost.'));
        conn.on('error', () => this.lostHost('Connection to the host was lost.'));
        // Surface ICE failures quickly instead of waiting for the timeout.
        const watchIce = () => {
          const pc = conn.peerConnection;
          if (!pc) return setTimeout(watchIce, 200);
          pc.addEventListener('iceconnectionstatechange', () => {
            if (pc.iceConnectionState === 'failed') {
              clearTimeout(timer);
              if (this.joinedOk) this.lostHost('The connection to the host failed.');
              else fail(iceHelp());
            }
          });
        };
        watchIce();
      })
      .catch((err) => fail(friendlyPeerError(err, code)));
  }

  fromHost(msg) {
    this.lastSeen = performance.now();
    if (!msg || typeof msg.t !== 'string' || msg.t === 'hb') return;
    if (msg.t === 'welcome') this.id = msg.id;
    if (msg.t === 'joined') this.joinedOk = true;
    if (msg.t === 'hostLeft') return this.lostHost('The host left the game.');
    if (msg.t === 'error' && !this.joinedOk) {
      this.emit('error', { ...msg, where: 'join' });
      return this.leave();
    }
    this.emit(msg.t, msg);
  }

  guestHeartbeat() {
    if (!this.conn?.open) return;
    this.conn.send({ t: 'hb' });
    if (performance.now() - this.lastSeen > TIMEOUT_MS) this.lostHost('The host stopped responding.');
  }

  lostHost(reason) {
    if (this.mode !== 'guest') return;
    const wasJoined = this.joinedOk;
    this.leave();
    if (wasJoined) this.emit('disconnected', { reason });
  }

  leave() {
    clearInterval(this.heartbeat);
    if (this.mode === 'host') this.host?.shutdown();
    if (this.mode === 'solo') this.solo?.dispose();
    this.solo = null;
    if (this.mode === 'guest') {
      try {
        if (this.conn?.open) this.conn.send({ t: 'leave' });
      } catch {
        // ignore
      }
      const peer = this.peer;
      setTimeout(() => peer?.destroy(), 200);
    }
    this.mode = null;
    this.host = null;
    this.peer = null;
    this.conn = null;
    this.joinedOk = false;
    this.id = null;
  }
}

export const net = new Net();
window.addEventListener('beforeunload', () => net.leave());
