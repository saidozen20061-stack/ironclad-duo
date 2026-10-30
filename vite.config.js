import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

// GitHub Pages serves a project site from /<repo-name>/. The deploy workflow sets
// BASE_PATH to that; locally the game runs from the root.
const base = process.env.BASE_PATH || '/';

export default defineConfig({
  root: path.join(ROOT, 'client'),
  base,
  server: { port: 3000, host: true, fs: { allow: [ROOT] } },
  preview: { port: 4173, host: true },
  worker: { format: 'es' },
  build: {
    outDir: path.join(ROOT, 'client', 'dist'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
  },
});
