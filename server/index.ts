import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, mkdirSync, statSync, createReadStream } from 'node:fs';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { networkInterfaces } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { isRoomCode, type ServerConfig, type ServerMsg } from '../shared/protocol';
import { Room } from './room';
import { RoomManager } from './rooms';
import { HighscoreStore, SaveStore } from './store';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STATIC_DIR = join(ROOT, 'dist', 'client');
const env = process.env;
/** `lan` (default): one room, started on a player's PC. `online`: many rooms with codes (public web server). */
const MODE: ServerConfig['mode'] = env.TD_MODE === 'online' ? 'online' : 'lan';
const ONLINE = MODE === 'online';
/** Persistent data (highscores, saves) – online it should live outside the deployed code directory. */
const DATA_DIR = resolve(env.DATA_DIR ?? ROOT);
const SAVE_DIR = resolve(env.SAVE_DIR ?? join(DATA_DIR, 'saves'));
const PORT = Number(env.PORT ?? process.argv[2] ?? 3000);
const num = (v: string | undefined, def: number) => (v && Number.isFinite(Number(v)) ? Number(v) : def);
const LIMITS = {
  maxRooms: num(env.MAX_ROOMS, 100),
  roomTtlMs: num(env.ROOM_TTL_MIN, 10) * 60_000,
  connPerIp: num(env.MAX_CONN_PER_IP, 20),
  roomsPerIpPer10Min: num(env.MAX_ROOMS_PER_IP, 10),
  msgRate: num(env.MSG_RATE, 60),
  savesPerOwner: num(env.MAX_SAVES, 20),
};
/** Online: allowed Origin header of WebSocket/API requests (e.g. https://td.rennecke.org); empty = any. */
const ALLOWED_ORIGINS = (env.TD_ORIGIN ?? '').split(',').map((s) => s.trim()).filter(Boolean);

mkdirSync(DATA_DIR, { recursive: true });
const highscores = new HighscoreStore(join(DATA_DIR, 'highscore.json'));
const saves = new SaveStore(SAVE_DIR, ONLINE, ONLINE ? LIMITS.savesPerOwner : Infinity);
const lanRoom = ONLINE ? null : new Room({ code: null, name: 'LAN', isPublic: false, highscores, saves });
const rooms = new RoomManager({ highscores, saves, maxRooms: LIMITS.maxRooms, emptyTtl: LIMITS.roomTtlMs, msgRate: LIMITS.msgRate });

// ------------------------------------------------------------------ HTTP

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.zip': 'application/zip',
};

function serveStatic(req: IncomingMessage, res: ServerResponse) {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
  let file = normalize(join(STATIC_DIR, url === '/' ? 'index.html' : url));
  if (!file.startsWith(STATIC_DIR)) { res.writeHead(403).end(); return; }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(STATIC_DIR, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
      .end('Client wurde noch nicht gebaut. Bitte "npm start" (oder "npm run build") ausführen.');
    return;
  }
  const headers: Record<string, string> = { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' };
  // Vite puts a content hash into asset names, so they never change.
  if (url.startsWith('/assets/')) headers['Cache-Control'] = 'public, max-age=31536000, immutable';
  else if (extname(file) === '.html') headers['Cache-Control'] = 'no-cache';
  res.writeHead(200, headers);
  createReadStream(file).pipe(res);
}

/** Client IP – online the server runs behind the Uberspace reverse proxy, which sets X-Forwarded-For. */
function clientIp(req: IncomingMessage): string {
  const fwd = ONLINE ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() : '';
  return fwd || req.socket.remoteAddress || '?';
}

const originOk = (req: IncomingMessage) => !ALLOWED_ORIGINS.length || !req.headers.origin || ALLOWED_ORIGINS.includes(req.headers.origin);

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(body));
}

const roomCreations = new Map<string, number[]>();

function readBody(req: IncomingMessage, max = 2048): Promise<string> {
  return new Promise((resolveBody, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > max) { reject(new Error('too large')); req.destroy(); } });
    req.on('end', () => resolveBody(data));
    req.on('error', reject);
  });
}

async function handleApi(req: IncomingMessage, res: ServerResponse, path: string) {
  if (path === '/api/config' && req.method === 'GET') return json(res, 200, { mode: MODE } satisfies ServerConfig);
  if (!ONLINE) return json(res, 404, { error: 'Nur im Online-Modus verfügbar.' });
  if (path === '/api/rooms' && req.method === 'GET') return json(res, 200, { rooms: rooms.publicList() });
  if (path === '/api/rooms' && req.method === 'POST') {
    if (!originOk(req)) return json(res, 403, { error: 'Ungültige Herkunft.' });
    const ip = clientIp(req);
    const now = Date.now();
    const recent = (roomCreations.get(ip) ?? []).filter((t) => now - t < 600_000);
    if (recent.length >= LIMITS.roomsPerIpPer10Min) return json(res, 429, { error: 'Zu viele neue Räume – bitte kurz warten.' });
    let body: { name?: unknown; public?: unknown } = {};
    try { body = JSON.parse((await readBody(req)) || '{}'); } catch { return json(res, 400, { error: 'Ungültige Anfrage.' }); }
    const room = rooms.create(String(body.name ?? ''), body.public !== false);
    if (!room) return json(res, 503, { error: 'Der Server ist voll – bitte später erneut versuchen.' });
    recent.push(now);
    roomCreations.set(ip, recent);
    return json(res, 201, { code: room.code });
  }
  if (path.startsWith('/api/rooms/') && req.method === 'GET') {
    const room = rooms.get(path.slice('/api/rooms/'.length));
    return room ? json(res, 200, room.info()) : json(res, 404, { error: 'Raum nicht gefunden.' });
  }
  return json(res, 404, { error: 'Unbekannt.' });
}

const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  if (path.startsWith('/api/')) {
    handleApi(req, res, path).catch(() => { if (!res.headersSent) json(res, 500, { error: 'Serverfehler.' }); });
    return;
  }
  serveStatic(req, res);
});
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });

// ------------------------------------------------------------------ connections

const connPerIp = new Map<string, number>();
const alive = new WeakMap<WebSocket, boolean>();

wss.on('connection', (ws, req) => {
  const reject = (msg: ServerMsg) => { ws.send(JSON.stringify(msg)); ws.close(); };
  if (!originOk(req)) { ws.close(1008, 'origin'); return; }
  const ip = clientIp(req);
  if (ONLINE) {
    const n = connPerIp.get(ip) ?? 0;
    if (n >= LIMITS.connPerIp) { reject({ t: 'error', msg: 'Zu viele Verbindungen von deiner Adresse.' }); return; }
    connPerIp.set(ip, n + 1);
    ws.on('close', () => {
      const left = (connPerIp.get(ip) ?? 1) - 1;
      if (left > 0) connPerIp.set(ip, left); else connPerIp.delete(ip);
    });
  }
  alive.set(ws, true);
  ws.on('pong', () => alive.set(ws, true));

  let room: Room | undefined;
  if (lanRoom) room = lanRoom;
  else {
    const code = new URL(req.url ?? '/', 'http://x').searchParams.get('room')?.toUpperCase() ?? '';
    room = isRoomCode(code) ? rooms.get(code) : undefined;
  }
  if (!room) { reject({ t: 'noRoom' }); return; }
  room.connect(ws);
});

// Keep connections alive through proxies and drop dead ones.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!alive.get(ws)) { ws.terminate(); continue; }
    alive.set(ws, false);
    ws.ping();
  }
}, 30000).unref();

setInterval(() => {
  lanRoom?.sweep();
  rooms.sweep();
}, 5000).unref();
function announce() {
  if (ONLINE) {
    // Tests and tools wait for "localhost" in the output.
    console.log(`\n  ❄  LAN TD Online-Modus läuft auf http://localhost:${PORT}  (Daten: ${DATA_DIR})\n`);
    return;
  }
  const virtual = /vethernet|virtualbox|vmware|vbox|wsl|docker|hyper-v|loopback|tailscale|zerotier|hamachi|vpn|tap|tun/i;
  const nets = Object.entries(networkInterfaces()).flatMap(([name, list]) => (list ?? [])
    .filter((i) => i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.'))
    .map((i) => ({ name, ip: i.address, virt: virtual.test(name), priv: /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(i.address) })))
    .sort((a, b) => Number(a.virt) - Number(b.virt) || Number(b.priv) - Number(a.priv));
  console.log('\n  ❄  LAN TD läuft!\n');
  console.log(`  Lokal:   http://localhost:${PORT}`);
  nets.forEach((n, i) => {
    const note = i === 0 ? '  ← wahrscheinlich diese' : n.virt ? '  (virtueller Adapter, meist nicht passend)' : '';
    console.log(`  Im LAN:  http://${n.ip}:${PORT}   [${n.name}]${note}`);
  });
  if (nets.length > 1) console.log('\n  Mehrere Netzwerke gefunden: Mitspieler probieren die Adresse, die zu ihrem Netzwerk (gleiche ersten Zahlen) passt.');
  console.log('\n  Mitspieler öffnen die LAN-Adresse im Browser (Chrome/Firefox/Edge).');
  console.log('  Windows: ggf. Firewall-Freigabe für Node.js / Port ' + PORT + ' erlauben.\n');
}

/** Process ids that listen on the port (Windows: netstat, otherwise lsof). */
function pidsOnPort(): number[] {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8' });
      const pids = out.split(/\r?\n/).map((l) => l.trim().split(/\s+/)).filter((c) => c.length >= 5 && c[1].endsWith(`:${PORT}`) && /:0$/.test(c[2])).map((c) => Number(c[c.length - 1]));
      return [...new Set(pids)];
    }
    return execFileSync('lsof', ['-ti', `tcp:${PORT}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).split(/\s+/).filter(Boolean).map(Number);
  } catch { return []; }
}

/** Stops an old LAN TD server that still holds the port. Anything else on the port is left alone. */
async function stopOldServer(): Promise<boolean> {
  // Online the process manager (supervisord) owns the port – never kill anything there.
  if (ONLINE) return false;
  try {
    const html = await (await fetch(`http://127.0.0.1:${PORT}/`, { signal: AbortSignal.timeout(2000) })).text();
    if (!html.includes('LAN TD')) return false;
  } catch { return false; }
  const pids = pidsOnPort().filter((p) => p > 0 && p !== process.pid);
  if (!pids.length) return false;
  for (const pid of pids) {
    try {
      if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
      else process.kill(pid, 'SIGTERM');
    } catch { /* already gone */ }
  }
  console.log(`  Port ${PORT} war von einem alten LAN-TD-Server belegt (PID ${pids.join(', ')}) – wurde beendet, starte neu …`);
  return true;
}

let retried = false;
let handlingError = false;
function onListenError(err: NodeJS.ErrnoException) {
  if (err.code !== 'EADDRINUSE') { console.error(err); process.exit(1); }
  if (handlingError) return;
  handlingError = true;
  void (async () => {
    if (!retried && await stopOldServer()) {
      retried = true;
      setTimeout(() => { handlingError = false; listen(); }, 1000);
    } else {
      console.error(`\n  Port ${PORT} ist belegt (nicht von LAN TD). Anderen Port wählen: PORT=3001 npm start\n`);
      process.exit(1);
    }
  })();
}
server.on('error', onListenError);
wss.on('error', onListenError);

server.once('listening', announce);
function listen() { server.listen(PORT, '0.0.0.0'); }
listen();
