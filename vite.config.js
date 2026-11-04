import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

// GitHub Pages serves a project site from /<repo-name>/. The deploy workflow sets
// BASE_PATH to that; locally the game runs from the root.
const base = process.env.BASE_PATH || '/';

// Writes update.json into the build: every file with its hash, which is how the Windows app knows what
// changed and fetches only that.
function updateList() {
  let outDir;
  return {
    name: 'update-list',
    apply: 'build',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const files = readdirSync(outDir, { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile() && e.name !== 'update.json')
        .map((e) => {
          const data = readFileSync(path.join(e.parentPath, e.name));
          return { path: path.relative(outDir, path.join(e.parentPath, e.name)).split(path.sep).join('/'), size: data.length, sha256: createHash('sha256').update(data).digest('hex') };
        })
        .sort((a, b) => (a.path < b.path ? -1 : 1));
      const version = createHash('sha256').update(files.map((f) => f.path + f.sha256).join()).digest('hex').slice(0, 16);
      writeFileSync(path.join(outDir, 'update.json'), JSON.stringify({ version, files }));
    },
  };
}

export default defineConfig({
  root: path.join(ROOT, 'client'),
  base,
  plugins: [updateList()],
  server: { port: 3000, host: true, fs: { allow: [ROOT] } },
  preview: { port: 4173, host: true },
  worker: { format: 'es' },
  build: {
    outDir: path.join(ROOT, 'client', 'dist'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
  },
});
