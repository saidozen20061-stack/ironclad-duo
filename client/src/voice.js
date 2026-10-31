import { net } from './net.js';
import { settings, onSettingsChange, keyLabel } from './settings.js';
import { audio } from './audio.js';
import { iceServers } from './iceConfig.js';

// Voice chat: one small WebRTC audio connection to each teammate (a mesh of at most 9).
// Two channels share those links:
//   crew  — your crewmate, push-to-talk on V (or open mic in Settings),
//   team  — every crew on your team, push-to-talk on B.
// The handshake ('signal' messages) travels over the game's data channels, relayed by the
// host. Each link uses "perfect negotiation" so either side can (re)start without glare.

const SPEAK_THRESHOLD = 0.035;
export const TEAM_KEY = 'KeyB';

class Link {
  constructor(voice, peerId) {
    this.voice = voice;
    this.peerId = peerId;
    this.polite = net.id > peerId;
    this.makingOffer = false;
    this.ignoreOffer = false;
    this.ready = false;
    this.pending = [];
    this.track = null; // our own clone of the mic track for this listener
    const pc = new RTCPeerConnection({ iceServers: iceServers() });
    this.pc = pc;
    pc.onicecandidate = ({ candidate }) => candidate && this.send({ candidate });
    pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true;
        await pc.setLocalDescription();
        this.send({ description: pc.localDescription });
      } catch (err) {
        console.warn('voice negotiation failed', err);
      } finally {
        this.makingOffer = false;
      }
    };
    pc.ontrack = (ev) => this.playRemote(ev.streams[0] ?? new MediaStream([ev.track]));
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') pc.restartIce?.();
    };
  }

  send(data) {
    net.send({ t: 'signal', to: this.peerId, data });
  }

  async start(micTrack) {
    this.setMic(micTrack);
    // Exactly one audio channel: the impolite side creates it, the polite side attaches
    // its mic when the offer arrives (see attachMic). Avoids competing offers.
    if (!this.polite) {
      const tr = this.pc.addTransceiver('audio', { direction: 'sendrecv' });
      if (this.track) await tr.sender.replaceTrack(this.track);
    }
    this.ready = true;
    const queued = this.pending;
    this.pending = [];
    for (const d of queued) await this.onSignal(d);
  }

  setMic(micTrack) {
    this.track?.stop();
    this.track = micTrack ? micTrack.clone() : null;
    if (this.track) this.track.enabled = false;
  }

  async attachMic() {
    const tr = this.pc.getTransceivers()[0];
    if (!tr) return;
    tr.direction = 'sendrecv';
    if (this.track && tr.sender.track !== this.track) await tr.sender.replaceTrack(this.track);
  }

  playRemote(stream) {
    const { ctx, master } = audio();
    // Chrome only routes remote WebRTC audio into Web Audio if a media element plays it too.
    this.remoteEl?.remove();
    const el = document.createElement('audio');
    el.srcObject = stream;
    el.muted = true;
    el.autoplay = true;
    el.play?.().catch(() => {});
    this.remoteEl = el;
    const src = ctx.createMediaStreamSource(stream);
    this.gain = ctx.createGain();
    this.gain.gain.value = settings.voiceVolume;
    src.connect(this.gain).connect(master);
    this.level = analyser(ctx, src);
  }

  async onSignal(data) {
    if (!this.ready) {
      this.pending.push(data);
      return;
    }
    const pc = this.pc;
    try {
      if (data.description) {
        const d = data.description;
        const collision = d.type === 'offer' && (this.makingOffer || pc.signalingState !== 'stable');
        this.ignoreOffer = !this.polite && collision;
        if (this.ignoreOffer) return;
        await pc.setRemoteDescription(d);
        if (d.type === 'offer') {
          await this.attachMic();
          await pc.setLocalDescription();
          this.send({ description: pc.localDescription });
        }
      } else if (data.candidate) {
        try {
          await pc.addIceCandidate(data.candidate);
        } catch (err) {
          if (!this.ignoreOffer) throw err;
        }
      }
    } catch (err) {
      console.warn('voice signal error', err);
    }
  }

  close() {
    this.pc.close();
    this.track?.stop();
    this.gain?.disconnect();
    this.remoteEl?.remove();
  }
}

class Voice {
  constructor() {
    this.links = new Map(); // peerId -> Link
    this.early = new Map(); // signals from peers we haven't linked yet
    this.roster = { crewmate: null, team: [] };
    this.localStream = null;
    this.micTrack = null;
    this.micError = null;
    this.micPromise = null;
    this.crewKey = false;
    this.teamKey = false;
    this.listeners = new Set();
    this.speaking = { local: false, channel: null, remote: new Map() };
    this.localLevel = null;

    net.on('signal', (msg) => this.onSignal(msg));
    window.addEventListener('keydown', (e) => {
      if (e.repeat || isTyping(e)) return;
      if (e.code === settings.pttKey) this.crewKey = true;
      else if (e.code === TEAM_KEY) this.teamKey = true;
      else return;
      this.applyTransmit();
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === settings.pttKey) this.crewKey = false;
      else if (e.code === TEAM_KEY) this.teamKey = false;
      else return;
      this.applyTransmit();
    });
    window.addEventListener('blur', () => {
      this.crewKey = this.teamKey = false;
      this.applyTransmit();
    });
    let lastMic = settings.micId;
    onSettingsChange(() => {
      this.applyTransmit();
      for (const l of this.links.values()) if (l.gain) l.gain.gain.value = settings.voiceVolume;
      if (settings.micId !== lastMic) {
        lastMic = settings.micId;
        if (this.links.size) this.restartMic();
      }
    });
    setInterval(() => this.pollLevels(), 80);
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    for (const fn of this.listeners) fn(this.speaking);
  }

  // Which channel we're talking on right now (team wins while B is held).
  get channel() {
    if (!this.micTrack) return null;
    if (this.teamKey) return 'team';
    if (this.crewKey || settings.voiceMode === 'open') return 'crew';
    return null;
  }

  hint() {
    if (this.micError) return 'Mic unavailable — you can still hear your team';
    const crew = settings.voiceMode === 'open' ? 'Crew: open mic' : `Crew: hold ${keyLabel(settings.pttKey)}`;
    return `${crew} · Team: hold ${keyLabel(TEAM_KEY)}`;
  }

  applyTransmit() {
    const ch = this.channel;
    for (const [id, l] of this.links) if (l.track) l.track.enabled = ch === 'team' || (ch === 'crew' && id === this.roster.crewmate);
  }

  // Who we should be connected to: our crewmate plus everyone on our team.
  setRoster(roster) {
    this.roster = { crewmate: roster?.crewmate ?? null, team: roster?.team ?? [] };
    const want = new Set(this.roster.team);
    if (this.roster.crewmate != null) want.add(this.roster.crewmate);
    want.delete(net.id);
    for (const [id, l] of this.links) {
      if (!want.has(id)) {
        l.close();
        this.links.delete(id);
        this.speaking.remote.delete(id);
      }
    }
    for (const id of want) if (!this.links.has(id)) this.connect(id);
    this.applyTransmit();
    if (!want.size) this.releaseMic();
    this.emit();
  }

  async connect(id) {
    const link = new Link(this, id);
    this.links.set(id, link);
    await this.openMic();
    if (this.links.get(id) !== link) return link.close(); // roster changed meanwhile
    await link.start(this.micTrack);
    this.applyTransmit();
    const early = this.early.get(id) ?? [];
    this.early.delete(id);
    for (const d of early) await link.onSignal(d);
  }

  onSignal({ from, data }) {
    if (!data) return;
    const link = this.links.get(from);
    if (link) return link.onSignal(data);
    // The other side may connect a moment before our roster catches up.
    if (!this.early.has(from)) this.early.set(from, []);
    this.early.get(from).push(data);
  }

  openMic() {
    if (this.micTrack || this.micError) return Promise.resolve();
    this.micPromise ??= this.getMic().finally(() => (this.micPromise = null));
    return this.micPromise;
  }

  async getMic() {
    this.micError = null;
    try {
      const constraints = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, ...(settings.micId ? { deviceId: { exact: settings.micId } } : {}) } };
      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      try {
        if (!settings.micId) throw err;
        this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (err2) {
        this.micError = err2;
        this.localStream = null;
        this.micTrack = null;
        this.emit();
        return;
      }
    }
    this.micTrack = this.localStream.getAudioTracks()[0];
    const { ctx } = audio();
    this.localLevel = analyser(ctx, ctx.createMediaStreamSource(this.localStream));
    this.emit();
  }

  async restartMic() {
    const old = this.localStream;
    this.micTrack = null;
    this.micError = null;
    await this.openMic();
    for (const l of this.links.values()) {
      l.setMic(this.micTrack);
      await l.attachMic();
    }
    this.applyTransmit();
    old?.getTracks().forEach((t) => t.stop());
  }

  releaseMic() {
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
    this.micTrack = null;
    this.micError = null;
    this.localLevel = null;
  }

  pollLevels() {
    const ch = this.channel;
    const local = !!ch && !!this.localLevel && this.localLevel() > SPEAK_THRESHOLD;
    let changed = local !== this.speaking.local || (local && ch !== this.speaking.channel);
    this.speaking.local = local;
    this.speaking.channel = local ? ch : null;
    for (const [id, l] of this.links) {
      const on = !!l.level && l.level() > SPEAK_THRESHOLD;
      if (on !== !!this.speaking.remote.get(id)) {
        this.speaking.remote.set(id, on);
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  stop() {
    this.setRoster(null);
    this.early.clear();
    this.speaking = { local: false, channel: null, remote: new Map() };
    this.emit();
  }
}

function analyser(ctx, source) {
  const a = ctx.createAnalyser();
  a.fftSize = 512;
  source.connect(a);
  const buf = new Float32Array(a.fftSize);
  return () => {
    a.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += v * v;
    return Math.sqrt(sum / buf.length);
  };
}

function isTyping(e) {
  return e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement;
}

export const voice = new Voice();
