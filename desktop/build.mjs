// Builds the Windows installer: `npm run app`. Ends up in desktop/release/.
// Everything happens in the temp folder: the packaging tools are hundreds of MB that have no business
// syncing to OneDrive, and the installer builder doesn't like non-English letters in a path.
import { execSync } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const WORK = path.join(os.tmpdir(), 'ironclad-duo-app');
const SETUP = 'Ironclad-Duo-Setup.exe';

const run = (cmd, cwd, env = {}) => execSync(cmd, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });

mkdirSync(WORK, { recursive: true });
for (const file of ['package.json', 'main.cjs', 'updater.cjs', 'splash.html', 'icon.svg', 'render-icon.cjs']) copyFileSync(path.join(HERE, file), path.join(WORK, file));

run('npm install --no-audit --no-fund', WORK);
run('node node_modules/electron/install.js', WORK);
const electron = path.join('node_modules', 'electron', 'dist', 'electron.exe');
run(`"${electron}" render-icon.cjs . icon.png:512`, WORK);
// The version built into the app, for its first start and in case the site can't be reached.
run(`npx vite build --outDir "${path.join(WORK, 'game')}" --emptyOutDir`, ROOT, { BASE_PATH: '/ironclad-duo/' });
rmSync(path.join(WORK, 'release'), { recursive: true, force: true });
run('npx electron-builder --win --publish never', WORK);

mkdirSync(path.join(HERE, 'release'), { recursive: true });
copyFileSync(path.join(WORK, 'release', SETUP), path.join(HERE, 'release', SETUP));
console.log(`\nDone: ${path.join(HERE, 'release', SETUP)}`);
