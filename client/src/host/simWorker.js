// The authoritative game simulation, running in a Web Worker on the host's machine.
// Workers keep ticking at full rate even when the host's tab is in the background.
import { Match } from './match.js';

let match = null;

self.onmessage = (e) => {
  const d = e.data;
  if (d.type === 'start') {
    match?.dispose();
    match = new Match({ tank: d.tank, broadcast: (msg) => self.postMessage(msg) });
  } else if (d.type === 'input') {
    match?.onMessage({ role: d.role }, d.msg);
  } else if (d.type === 'stop') {
    match?.dispose();
    match = null;
  }
};
