// Keeps the game's files on disk up to date from the published site. Every deploy publishes update.json,
// a list of every file with its hash, so only what changed is downloaded. A new version goes into a
// folder of its own and takes over once it's complete: a failed download never touches the one that works.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { app, net } = require('electron');

const SITE = 'https://saidozen20061-stack.github.io/ironclad-duo/';
const LIST = 'update.json';
const CHECK_TIMEOUT = 6000; // ms: any slower and it plays the version it already has
const FILE_TIMEOUT = 60000;
const TRIES = 3;
const BUILT_IN = path.join(__dirname, 'game');

const store = () => path.join(app.getPath('userData'), 'game');
const pointer = () => path.join(store(), 'current.txt');
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

function readList(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, LIST), 'utf8'));
  } catch {
    return null;
  }
}

// Plain relative paths only: nothing a list says can write outside the game's folder.
const safePath = (p) => typeof p === 'string' && /^[\w@.-]+(\/[\w@.-]+)*$/.test(p) && !p.split('/').includes('..');
const validList = (list) => typeof list?.version === 'string' && /^\w+$/.test(list.version) && Array.isArray(list.files) && list.files.every((f) => safePath(f.path) && Number.isFinite(f.size) && /^[0-9a-f]{64}$/.test(f.sha256));

// The version to run: the last one downloaded if all its files are there, otherwise the one built in.
function installed() {
  try {
    const version = fs.readFileSync(pointer(), 'utf8').trim();
    const dir = path.join(store(), version);
    const list = readList(dir);
    if (validList(list) && list.files.every((f) => fs.statSync(path.join(dir, f.path)).size === f.size)) return { dir, list };
  } catch {
    // Nothing downloaded yet, or some of it is gone.
  }
  return { dir: BUILT_IN, list: readList(BUILT_IN) };
}

// What's published now, or null when the site can't be reached.
async function latest() {
  try {
    const res = await net.fetch(`${SITE}${LIST}?t=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(CHECK_TIMEOUT) });
    if (!res.ok) return null;
    const list = await res.json();
    return validList(list) ? list : null;
  } catch {
    return null;
  }
}

async function download(file, version, onBytes) {
  const res = await net.fetch(`${SITE}${file.path}?v=${version}`, { cache: 'no-store', signal: AbortSignal.timeout(FILE_TIMEOUT) });
  if (!res.ok) throw new Error(`${file.path}: ${res.status}`);
  const parts = [];
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    onBytes(value.length);
  }
  const data = Buffer.concat(parts);
  if (sha256(data) !== file.sha256) throw new Error(`${file.path}: damaged download`);
  return data;
}

// Downloads what's different from `current`, and returns the new version once it's complete.
// onProgress gets bytes done and bytes in all.
async function install(list, current, onProgress) {
  const have = new Map((current.list?.files ?? []).map((f) => [f.sha256, f.path]));
  const total = list.files.filter((f) => !have.has(f.sha256)).reduce((sum, f) => sum + f.size, 0);
  const part = path.join(store(), `${list.version}.partial`);
  fs.rmSync(part, { recursive: true, force: true });
  let done = 0;
  onProgress(0, total);
  for (const file of list.files) {
    let data;
    if (have.has(file.sha256)) data = fs.readFileSync(path.join(current.dir, have.get(file.sha256)));
    else {
      for (let tryNo = 1; !data; tryNo++) {
        const before = done;
        try {
          data = await download(file, list.version, (n) => {
            done += n;
            onProgress(done, total);
          });
        } catch (err) {
          done = before;
          if (tryNo >= TRIES) throw err;
        }
      }
    }
    const out = path.join(part, file.path);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, data);
  }
  fs.writeFileSync(path.join(part, LIST), JSON.stringify(list));
  const dir = path.join(store(), list.version);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.renameSync(part, dir);
  fs.writeFileSync(pointer(), list.version);
  // Older versions aren't needed any more.
  for (const name of fs.readdirSync(store())) {
    if (name !== list.version && name !== path.basename(pointer())) fs.rmSync(path.join(store(), name), { recursive: true, force: true });
  }
  return { dir, list };
}

module.exports = { installed, latest, install };
