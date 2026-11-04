// Ironclad Duo as a Windows app: the game in its own full-screen window, from files kept on disk.
// Each time it starts it waits on a loading screen while it fetches whatever was published since last
// time, so every player is on the same version (host and guest have to match). Offline, it plays what it has.
const { app, BrowserWindow, Menu, net, powerSaveBlocker, protocol, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const updater = require('./updater.cjs');

const BASE = '/ironclad-duo/'; // where the site's own links expect the game to be
const HOME = `app://game${BASE}index.html`;
const SPLASH = 'splash.html';
const RECHECK = 120000; // ms between looks for an update while the app stays open
const FAILED_PAUSE = 2000; // ms to read that the update didn't work
const ALLOWED = ['media', 'pointerLock', 'fullscreen', 'clipboard-sanitized-write']; // voice chat, mouse aim, Copy code

// A real origin for the game: its worker and audio don't load from file://.
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }]);

// Sound and music shouldn't wait for a click, and a blocklisted graphics driver shouldn't stop the game.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

let game = null; // the version being served: { dir, list }
let updating = false;
let failed = null; // a version that wouldn't download: left for the next start, not retried from the menu

function serveGame() {
  protocol.handle('app', (request) => {
    const url = new URL(request.url).pathname;
    const name = url.startsWith(BASE) ? url.slice(BASE.length) : url.slice(1);
    const file = path.join(game.dir, decodeURIComponent(name));
    if (!file.startsWith(game.dir + path.sep)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

const megabytes = (bytes) => (bytes / 1048576).toFixed(1);

// The waiting screen comes with the game, so it can be changed by publishing like everything else.
// A version downloaded before it did has none: then it's the one built in.
const showSplash = (win) => (fs.existsSync(path.join(game.dir, SPLASH)) ? win.loadURL(`app://game${BASE}${SPLASH}`) : win.loadFile(path.join(updater.BUILT_IN, SPLASH)));

// The waiting screen: fetch what's new, if anything, then start the game. `found` skips the check when
// a new version is already known about.
async function updateAndPlay(win, found = null) {
  updating = true;
  const web = win.webContents;
  const say = (text, share = null) => web.executeJavaScript(`show(${JSON.stringify(text)}, ${share})`).catch(() => {});
  try {
    await showSplash(win);
    say('Checking for updates…');
    const list = found ?? (await updater.latest());
    if (list && list.version !== game.list?.version) {
      try {
        game = await updater.install(list, game, (done, total) => say(`Downloading update… ${megabytes(done)} of ${megabytes(total)} MB`, total ? Math.min(1, done / total) : 1));
      } catch {
        failed = list.version;
        say('The update could not be downloaded. Starting the version you have…');
        await new Promise((resolve) => setTimeout(resolve, FAILED_PAUSE));
      }
    }
    say('Starting…');
    await win.loadURL(HOME);
  } catch {
    // The window closed while it was busy.
  }
  updating = false;
}

// Left open across an update: it waits for the main menu, so nobody is pulled out of a match or a lobby.
function watchForUpdates(win) {
  setInterval(async () => {
    if (updating || win.isDestroyed()) return;
    const list = await updater.latest();
    if (!list || list.version === game.list?.version || list.version === failed || updating || win.isDestroyed()) return;
    const atMenu = await win.webContents.executeJavaScript(`document.querySelector('.screen.active')?.id === 'screen-menu'`).catch(() => false);
    if (atMenu) updateAndPlay(win, list);
  }, RECHECK);
}

function openWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 960,
    minHeight: 600,
    fullscreen: true,
    backgroundColor: '#14160f',
    title: 'Ironclad Duo',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false, // a host who alt-tabs out mustn't slow the match down for everyone
    },
  });
  const web = win.webContents;
  // The window's title stays the game's, whatever page is showing.
  win.on('page-title-updated', (event) => event.preventDefault());
  // F11 or Alt+Enter: full screen or a window.
  web.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && (input.key === 'F11' || (input.alt && input.key === 'Enter'))) {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    }
  });
  // The game stays in this window; its web links open in the normal browser.
  web.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  web.on('will-navigate', (event, url) => {
    if (url.startsWith('app://game/')) return;
    event.preventDefault();
    if (/^https?:/.test(url)) shell.openExternal(url);
  });
  return win;
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  game = updater.installed();
  serveGame();
  session.defaultSession.setPermissionRequestHandler((_web, permission, grant) => grant(ALLOWED.includes(permission)));
  powerSaveBlocker.start('prevent-display-sleep');
  const win = openWindow();
  updateAndPlay(win);
  watchForUpdates(win);
});

app.on('window-all-closed', () => app.quit());
