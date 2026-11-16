import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

// CI sets APP_VERSION (plain version on main, "-dev.<sha>" suffix on other branches).
const pkgVersion = JSON.parse(readFileSync('package.json', 'utf8')).version as string;
const version = process.env.APP_VERSION || `${pkgVersion}-local`;

export default defineConfig({
  root: 'client',
  // Relative asset URLs so the game also works below a path prefix (paul-rennecke.de/td/).
  base: './',
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [{
    name: 'version-json',
    generateBundle(this: any) { this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version }) }); },
  }],
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
  server: {
    host: true,
    fs: { allow: ['..'] },
    proxy: {
      '/ws': { target: 'ws://localhost:3000', ws: true },
      '/api': { target: 'http://localhost:3000' },
    },
  },
  test: {
    root: '.',
    include: ['tests/**/*.test.ts'],
    testTimeout: 120000,
  },
} as any);
