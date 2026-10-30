import { net } from './net.js';
import { settings, onSettingsChange, keyLabel } from './settings.js';
import { audio } from './audio.js';
import { iceServers } from './iceConfig.js';

// Two-person voice chat over its own WebRTC connection. The handshake ('signal'
// messages) travels over the game's peer-to-peer data channel, relayed by the host.
// Uses the "perfect negotiation" pattern so either side can (re)start without glare.

const SPEAK_THRESHOLD = 0.035;

class Voice {
  constructor() {
    this.pc = null;
    this.ready = false;
    this.pending = [];
    this.peerId = null;
    this.polite = false;
    this.makingOffer = false;
    this.ignoreOffer = false;
    this.localStream = null;
    this.micTrack = null;
    this.micError = null;
    this.pttDown = false;
    this.remoteGain = null;
    this.remoteEl = null;
    this.listeners = new Set();
    this.speaking = { local: false, remote: false };
    this.localLevel = null;
    this.remoteLevel = null;

    net.on('signal', (msg) => this.onSignal(msg));
    window.addEventListener('keydown', (e) => {
      if (e.code !== settings.pttKey || e.repeat || isTyping(e)) return;
      this.pttDown = true;
      this.applyTransmit();
    });
    window.addEventListener('keyup', (e) => {
      if (e.code !== settings.pttKey) return;
      this.pttDown = false;
      this.applyTransmit();
    });
    window.addEventListener('blur', () => {
      this.pttDown = false;
      this.applyTransmit();
    });
    let lastMic = settings.micId;
    onSettingsChange(() => {
      this.applyTransmit();
      if (this.remoteGain) this.remoteGain.gain.value = settings.voiceVolume;
      if (settings.micId !== lastMic) {
        lastMic = settings.micId;
        if (this.pc) this.restartMic();
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

  get transmitting() {
    return !!this.micTrack && (settings.voiceMode === 'open' || this.pttDown);
  }

  hint() {
    if (this.micError) return 'Mic unavailable — you can still hear your crewmate';
    return settings.voiceMode === 'open' ? 'Open mic' : `Hold ${keyLabel(settings.pttKey)} to talk`;
  }

  applyTransmit() {
    if (this.micTrack) this.micTrack.enabled = this.transmitting;
  }

  // Called whenever lobby state changes: connect when there's a partner, drop otherwise.
  syncPeers(lobbyState) {
    const other = lobbyState?.players.find((p) => p.id !== net.id) ?? null;
    if (!other) return this.stop();
    if (this.peerId === other.id && this.pc) return;
    this.stop();
    this.start(other.id);
  }

  async start(peerId) {
    this.peerId = peerId;
    this.polite = net.id > peerId;
    const pc = new RTCPeerConnection({ iceServers: iceServers() });
    this.pc = pc;

    pc.onicecandidate = ({ candidate }) => candidate && net.send({ t: 'signal', data: { candidate } });
    pc.onnegotiationneeded = async () => {
      try {
        this.makingOffer = true;
        await pc.setLocalDescription();
        net.send({ t: 'signal', data: { description: pc.localDescription } });
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

    await this.openMic();
    if (this.pc !== pc) return; // stopped meanwhile
    // Exactly one audio channel: the impolite side creates it, the polite side attaches
    // its mic to it when the offer arrives (see attachMic). Avoids competing offers.
    if (!this.polite) {
      const tr = pc.addTransceiver('audio', { direction: 'sendrecv' });
      if (this.micTrack) await tr.sender.replaceTrack(this.micTrack);
    }
    this.ready = true;
    const queued = this.pending;
    this.pending = [];
    for (const msg of queued) await this.onSignal(msg);
  }

  async openMic() {
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
    this.applyTransmit();
    const { ctx } = audio();
    this.localLevel = analyser(ctx, ctx.createMediaStreamSource(this.localStream));
    this.emit();
  }

  async attachMic() {
    const tr = this.pc?.getTransceivers()[0];
    if (!tr) return;
    tr.direction = 'sendrecv';
    if (this.micTrack && tr.sender.track !== this.micTrack) await tr.sender.replaceTrack(this.micTrack);
  }

  async restartMic() {
    const old = this.localStream;
    await this.openMic();
    await this.attachMic();
    old?.getTracks().forEach((t) => t.stop());
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
    this.remoteGain = ctx.createGain();
    this.remoteGain.gain.value = settings.voiceVolume;
    src.connect(this.remoteGain).connect(master);
    this.remoteLevel = analyser(ctx, src);
  }

  async onSignal({ data }) {
    if (!data) return;
    // The partner may start negotiating before our connection exists; hold those messages.
    if (!this.pc || !this.ready) {
      this.pending.push({ data });
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
          net.send({ t: 'signal', data: { description: pc.localDescription } });
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

  pollLevels() {
    const local = this.transmitting && this.localLevel ? this.localLevel() > SPEAK_THRESHOLD : false;
    const remote = this.remoteLevel ? this.remoteLevel() > SPEAK_THRESHOLD : false;
    if (local !== this.speaking.local || remote !== this.speaking.remote) {
      this.speaking = { local, remote };
      this.emit();
    }
  }

  stop() {
    this.pc?.close();
    this.pc = null;
    this.ready = false;
    this.peerId = null;
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
    this.micTrack = null;
    this.localLevel = null;
    this.remoteLevel = null;
    this.remoteGain?.disconnect();
    this.remoteGain = null;
    this.remoteEl?.remove();
    this.remoteEl = null;
    this.speaking = { local: false, remote: false };
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
