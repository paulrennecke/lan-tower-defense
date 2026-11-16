import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Version of the built client (dist/client/version.json, written by the build) – the version this server belongs to. */
export const VERSION: string = (() => {
  try {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    return JSON.parse(readFileSync(join(root, 'dist', 'client', 'version.json'), 'utf8')).version;
  } catch { return 'dev'; }
})();
