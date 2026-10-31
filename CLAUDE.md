# Ironclad Duo — notes for Claude

## Standing rule: publish automatically
Never ask before publishing. After every finished change that works (builds and was tested):
1. commit with a clear message,
2. push to `main`,
3. let the GitHub Actions workflow (`.github/workflows/deploy.yml`) deploy to GitHub Pages and check that the run succeeded,
4. then tell the user it is live: https://saidozen20061-stack.github.io/ironclad-duo/

## Project basics
- Vite + Three.js, all code in `client/` and `shared/`. `npm run dev` serves on port 3000.
- Peer-to-peer (PeerJS): the host's browser runs the lobby (`client/src/host/rooms.js`) and the
  simulation in a Web Worker (`client/src/host/simWorker.js` → `match.js`). Guests connect to the host.
- The Vite dev server does not watch `shared/`; restart it after editing files there.
- Dev-only test hooks: `window.__game` (net, voice, match) and `net.send({ t: 'debugKill' })`.
