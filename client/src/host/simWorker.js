// The authoritative game simulation, running in a Web Worker on the host's machine.
// Workers keep ticking at full rate even when the host's tab is in the background.
import { Match } from './match.js';

let match = null;

self.onmessage = (e) => {
  const d = e.data;
  if (d.type === 'start') {
    match?.dispose();
    match = new Match({ crews: d.crews, mode: d.mode, killLimit: d.killLimit, difficulty: d.difficulty, airStart: d.airStart, broadcast: (msg) => self.postMessage(msg) });
  } else if (d.type === 'input') {
    match?.onMessage({ crew: d.crew, role: d.role }, d.msg);
  } else if (d.type === 'left') {
    match?.playerLeft(d.crew, d.role);
  } else if (d.type === 'joined') {
    match?.playerJoined(d.crew, d.role);
  } else if (d.type === 'swap') {
    match?.swapSeat(d.crew, d.from, d.to);
  } else if (d.type === 'stop') {
    match?.dispose();
    match = null;
  }
};
