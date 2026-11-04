// Turns icon.svg into the PNGs the app and the website use. Run with Electron:
//   electron render-icon.cjs <folder with icon.svg> <output.png>:<size> ...
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const [folder, ...outputs] = process.argv.slice(2);

app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(folder, 'icon.svg'), 'utf8');
  const win = new BrowserWindow({ show: false });
  await win.loadURL('about:blank');
  for (const out of outputs) {
    const i = out.lastIndexOf(':');
    const file = out.slice(0, i), size = Number(out.slice(i + 1));
    const data = await win.webContents.executeJavaScript(`new Promise((done, fail) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = c.height = ${size};
        const ctx = c.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, ${size}, ${size});
        done(c.toDataURL('image/png').split(',')[1]);
      };
      img.onerror = () => fail(new Error('bad svg'));
      img.src = 'data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}';
    })`);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
  }
  app.quit();
});
