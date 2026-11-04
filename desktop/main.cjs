// Ironclad Duo as a Windows app: the game in its own full-screen window.
// Online it runs the published site, so it's always the same version as everyone else (host and guest
// have to match). If the site can't be reached it falls back to the copy built in, so Solo still works.
const { app, BrowserWindow, Menu, net, powerSaveBlocker, protocol, session, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const LIVE = 'https://saidozen20061-stack.github.io/ironclad-duo/';
const LOCAL = 'app://game/index.html';
const LIVE_TIMEOUT = 15000; // ms: slower than this, and the built-in copy is better than a black screen
const GAME = path.join(__dirname, 'game');
const ALLOWED = ['media', 'pointerLock', 'fullscreen', 'clipboard-sanitized-write']; // voice chat, mouse aim, Copy code

// A real origin for the built-in copy: the game's worker and audio don't load from file://.
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }]);

// Sound and music shouldn't wait for a click, and a blocklisted graphics driver shouldn't stop the game.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

function serveBuiltInGame() {
  protocol.handle('app', (request) => {
    const file = path.join(GAME, decodeURIComponent(new URL(request.url).pathname));
    if (file !== GAME && !file.startsWith(GAME + path.sep)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

function loadGame(win) {
  let live = true;
  const useBuiltIn = () => {
    if (!live) return;
    live = false;
    clearTimeout(timer);
    win.loadURL(LOCAL);
  };
  const timer = setTimeout(useBuiltIn, LIVE_TIMEOUT);
  const web = win.webContents;
  web.once('did-finish-load', () => clearTimeout(timer));
  web.on('did-fail-load', (_e, code, _text, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) useBuiltIn(); // -3 is only a navigation being replaced
  });
  web.on('did-navigate', (_e, _url, status) => {
    if (status >= 400) useBuiltIn();
  });
  // Ask the site whether there's a new version every time; the game's own files are cached by name.
  win.loadURL(LIVE, { extraHeaders: 'pragma: no-cache\n' }).catch(() => useBuiltIn());
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
  // F11 or Alt+Enter: full screen or a window.
  web.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && (input.key === 'F11' || (input.alt && input.key === 'Enter'))) {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    }
  });
  // The game stays in this window; its web links open in the normal browser.
  const inGame = (url) => url.startsWith(LIVE) || url.startsWith('app://game/');
  web.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  web.on('will-navigate', (event, url) => {
    if (inGame(url)) return;
    event.preventDefault();
    if (/^https?:/.test(url)) shell.openExternal(url);
  });
  loadGame(win);
  return win;
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  serveBuiltInGame();
  session.defaultSession.setPermissionRequestHandler((_web, permission, grant) => grant(ALLOWED.includes(permission)));
  powerSaveBlocker.start('prevent-display-sleep');
  openWindow();
});

app.on('window-all-closed', () => app.quit());
