// Builds the downloadable LAN package (dist/client/download/lan-td.zip) – run after `npm run build`.
// Usage: npx tsx tools/package-lan.ts
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT = join(ROOT, 'dist', 'client');
if (!existsSync(join(CLIENT, 'index.html'))) {
  console.error('dist/client fehlt – zuerst "npm run build" ausführen.');
  process.exit(1);
}

const stage = join(tmpdir(), `lan-td-pkg-${process.pid}`);
const pkg = join(stage, 'lan-td');
rmSync(stage, { recursive: true, force: true });
mkdirSync(pkg, { recursive: true });

for (const f of ['server', 'shared', 'package.json', 'package-lock.json', 'tsconfig.json', '.npmrc', 'Start-Server.cmd', 'start-server.sh', 'README.md']) {
  cpSync(join(ROOT, f), join(pkg, f), { recursive: true });
}
// The prebuilt client (without the download folder itself).
cpSync(CLIENT, join(pkg, 'dist', 'client'), { recursive: true, filter: (src) => !src.startsWith(join(CLIENT, 'download')) });
// Marker: the start scripts skip the client build and only install runtime dependencies.
writeFileSync(join(pkg, 'PREBUILT'), 'Client ist bereits gebaut – Start mit Start-Server.cmd bzw. ./start-server.sh\n');
chmodSync(join(pkg, 'start-server.sh'), 0o755);

const outDir = join(CLIENT, 'download');
const out = join(outDir, 'lan-td.zip');
mkdirSync(outDir, { recursive: true });
rmSync(out, { force: true });
if (process.platform === 'win32') execFileSync('tar', ['-a', '-c', '-f', out, 'lan-td'], { cwd: stage, stdio: 'inherit' });
else execFileSync('zip', ['-r', '-q', '-X', out, 'lan-td'], { cwd: stage, stdio: 'inherit' });
rmSync(stage, { recursive: true, force: true });
console.log('LAN-Paket erstellt:', out);
