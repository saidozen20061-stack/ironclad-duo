import { settings } from './settings.js';

// ICE servers for both WebRTC connections (game data + voice).
// STUN finds a direct route between the two players; TURN relays the traffic when no
// direct route exists (strict corporate/mobile/university networks). TURN is optional:
// set it in Settings → Network, or at build time with VITE_TURN_URL/USER/PASS.

const STUN = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:global.stun.twilio.com:3478' },
];

export function iceServers() {
  const list = [...STUN];
  const env = import.meta.env;
  const add = (url, username, credential) => {
    if (!url) return;
    const urls = String(url).split(/[\s,]+/).filter(Boolean);
    if (urls.length) list.push({ urls, username: username || undefined, credential: credential || undefined });
  };
  add(env.VITE_TURN_URL, env.VITE_TURN_USER, env.VITE_TURN_PASS);
  add(settings.turnUrl, settings.turnUser, settings.turnPass);
  return list;
}

export function hasTurn() {
  return iceServers().some((s) => [].concat(s.urls).some((u) => /^turns?:/.test(u)));
}
