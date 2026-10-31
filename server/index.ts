import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync, writeFileSync, createReadStream } from 'node:fs';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { networkInterfaces } from 'node:os';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { CLASS_BY_ID } from '../shared/data/classes';
import {
  MAX_PLAYERS, PLAYER_COLORS, type ClientMsg, type GamePhase, type LobbyPlayer, type ServerMsg, type TargetMode,
} from '../shared/protocol';
import { Game } from './game';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STATIC_DIR = join(ROOT, 'dist', 'client');
const HIGHSCORE_FILE = join(ROOT, 'highscore.json');
const PORT = Number(process.env.PORT ?? process.argv[2] ?? 3000);
const TICK = 0.05;
const SNAP_EVERY = 2;

interface Entry extends LobbyPlayer { token: string; ws: WebSocket | null; leftAt: number }

const entries = new Map<string, Entry>();
let hostId: string | null = null;
let phase: GamePhase = 'lobby';
let game: Game | null = null;
let highscore = loadHighscore();

function loadHighscore(): number {
  try { return JSON.parse(readFileSync(HIGHSCORE_FILE, 'utf8')).wave ?? 0; } catch { return 0; }
}
function saveHighscore(wave: number) {
  if (wave <= highscore) return;
  highscore = wave;
  try { writeFileSync(HIGHSCORE_FILE, JSON.stringify({ wave, date: new Date().toISOString() })); } catch { /* ignore */ }
}

// ------------------------------------------------------------------ HTTP

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
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
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}

const server = createServer(serveStatic);
const wss = new WebSocketServer({ server, path: '/ws' });

// ------------------------------------------------------------------ messaging

function send(ws: WebSocket | null, msg: ServerMsg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}
function broadcast(msg: ServerMsg) {
  const data = JSON.stringify(msg);
  for (const e of entries.values()) if (e.ws && e.ws.readyState === WebSocket.OPEN) e.ws.send(data);
}
function sysChat(text: string) {
  broadcast({ t: 'chat', from: null, name: 'System', color: 0xffcc00, text });
}

function lobbyMsg(): ServerMsg {
  const players: LobbyPlayer[] = [...entries.values()].map(({ id, name, color, classId, ready, connected, spectator }) => ({
    id, name, color, classId, ready, connected, spectator,
  }));
  return { t: 'lobby', players, hostId, phase, highscore };
}
function broadcastLobby() { broadcast(lobbyMsg()); }

function sendGameState(e: Entry) {
  if (!game) return;
  send(e.ws, { t: 'game', state: game.fullState(e.id, entries, highscore) });
}

function freeColor(): number {
  const used = new Set([...entries.values()].map((e) => e.color));
  return PLAYER_COLORS.find((c) => !used.has(c)) ?? PLAYER_COLORS[entries.size % PLAYER_COLORS.length];
}

function activePlayers() { return [...entries.values()].filter((e) => !e.spectator); }

function ensureHost() {
  const host = hostId ? entries.get(hostId) : undefined;
  if (host && host.connected && !host.spectator) return;
  const next = activePlayers().find((e) => e.connected);
  hostId = next?.id ?? null;
  if (next) sysChat(`${next.name} ist jetzt Host.`);
}

const cleanName = (s: unknown) => String(s ?? '').replace(/[<>]/g, '').trim().slice(0, 20) || 'Spieler';

// ------------------------------------------------------------------ game control

let tickCount = 0;
let loop: NodeJS.Timeout | null = null;

function startGame() {
  const players = activePlayers().filter((e) => e.connected);
  game = new Game(players.map((p) => ({ id: p.id, name: p.name, color: p.color, classId: p.classId! })), {
    tower: (t) => broadcast({ t: 'tower', tower: t }),
    towerGone: (id) => broadcast({ t: 'towerGone', id }),
    event: (kind, text) => broadcast({ t: 'event', kind, text }),
    gameOver: (wave, victory) => endGame(wave, victory),
  });
  // Players who are not connected at start become spectators.
  for (const e of entries.values()) if (!game.players.has(e.id)) e.spectator = true;
  phase = 'playing';
  tickCount = 0;
  broadcastLobby();
  for (const e of entries.values()) sendGameState(e);
  sysChat(`Das Spiel beginnt mit ${players.length} Spieler(n)! Baut eure Verteidigung – die erste Welle kommt bald.`);
  let last = performance.now();
  let acc = 0;
  loop = setInterval(() => {
    const now = performance.now();
    acc += Math.min(0.5, (now - last) / 1000);
    last = now;
    while (acc >= TICK && game) {
      acc -= TICK;
      game.tick(TICK);
      if (++tickCount % SNAP_EVERY === 0 && game) broadcast(game.snapshot());
    }
  }, 15);
}

function endGame(wave: number, victory: boolean) {
  if (!game) return;
  if (loop) clearInterval(loop);
  loop = null;
  const reached = Math.max(0, wave - 1);
  saveHighscore(reached);
  phase = 'gameover';
  broadcast(game.snapshot());
  broadcast({
    t: 'gameOver', wave: reached, victory, highscore,
    stats: [...game.players.values()].map((p) => ({ id: p.id, name: p.name, color: p.color, kills: p.kills, damage: Math.round(p.damage), leaks: p.leaks })),
  });
  broadcastLobby();
}

function backToLobby() {
  if (loop) clearInterval(loop);
  loop = null;
  game = null;
  phase = 'lobby';
  for (const [id, e] of entries) {
    if (!e.connected) { entries.delete(id); continue; }
    e.ready = false;
  }
  let count = 0;
  for (const e of entries.values()) {
    e.spectator = count >= MAX_PLAYERS;
    if (!e.spectator) count++;
  }
  ensureHost();
  broadcastLobby();
}

// ------------------------------------------------------------------ connections

wss.on('connection', (ws) => {
  let me: Entry | null = null;

  ws.on('message', (raw) => {
    let msg: ClientMsg;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    if (!msg || typeof msg !== 'object') return;

    if (msg.t === 'hello') {
      const existing = msg.token ? [...entries.values()].find((e) => e.token === msg.token) : undefined;
      if (existing) {
        if (existing.ws && existing.ws !== ws) existing.ws.close();
        me = existing;
        me.ws = ws;
        me.connected = true;
        game?.setConnected(me.id, true);
        sysChat(`${me.name} ist wieder verbunden.`);
      } else {
        const full = activePlayers().length >= MAX_PLAYERS;
        me = {
          id: randomBytes(4).toString('hex'), name: cleanName(msg.name), color: freeColor(), classId: null,
          ready: false, connected: true, spectator: full || phase !== 'lobby', token: randomBytes(12).toString('hex'), ws, leftAt: 0,
        };
        entries.set(me.id, me);
        sysChat(`${me.name} ist beigetreten${me.spectator ? ' (Zuschauer)' : ''}.`);
      }
      ensureHost();
      send(ws, { t: 'welcome', you: me.id, token: me.token });
      broadcastLobby();
      if (phase !== 'lobby') sendGameState(me);
      return;
    }
    if (!me) return;
    const p = me;
    const err = (m: string | null) => { if (m) send(ws, { t: 'error', msg: m }); };

    switch (msg.t) {
      case 'setName':
        p.name = cleanName(msg.name);
        broadcastLobby();
        break;
      case 'setClass':
        if (phase === 'lobby' && !p.spectator && CLASS_BY_ID[msg.classId]) { p.classId = msg.classId; broadcastLobby(); }
        break;
      case 'lobbyReady':
        if (phase === 'lobby' && !p.spectator) { p.ready = !!msg.ready && !!p.classId; broadcastLobby(); }
        break;
      case 'start': {
        if (phase !== 'lobby' || p.id !== hostId) return;
        const players = activePlayers().filter((e) => e.connected);
        const missing = players.filter((e) => !e.classId || (!e.ready && e.id !== hostId));
        if (!p.classId) return err('Wähle zuerst eine Klasse.');
        if (missing.length) return err('Noch nicht bereit: ' + missing.map((e) => e.name).join(', '));
        startGame();
        break;
      }
      case 'chat': {
        const text = String(msg.text ?? '').slice(0, 200).trim();
        if (text) broadcast({ t: 'chat', from: p.id, name: p.name, color: p.color, text });
        break;
      }
      case 'ping':
        if (Number.isFinite(msg.x) && Number.isFinite(msg.y)) broadcast({ t: 'ping', x: msg.x, y: msg.y, color: p.color });
        break;
      case 'build':
        if (game) err(game.build(p.id, String(msg.def), Math.floor(msg.cx), Math.floor(msg.cy)));
        break;
      case 'upgrade':
        if (game) err(game.upgrade(p.id, Number(msg.id)));
        break;
      case 'sell':
        if (game) err(game.sell(p.id, Number(msg.id)));
        break;
      case 'mode':
        if (game && ['first', 'last', 'strong', 'weak', 'close'].includes(msg.mode)) err(game.setMode(p.id, Number(msg.id), msg.mode as TargetMode));
        break;
      case 'research':
        if (game) err(game.research(p.id, String(msg.id)));
        break;
      case 'callWave':
        game?.setReady(p.id, !!msg.ready);
        break;
      case 'backToLobby':
        if (phase === 'gameover' && p.id === hostId) backToLobby();
        break;
    }
  });

  ws.on('close', () => {
    if (!me || me.ws !== ws) return;
    me.ws = null;
    me.connected = false;
    me.ready = false;
    me.leftAt = Date.now();
    game?.setConnected(me.id, false);
    sysChat(`${me.name} hat die Verbindung verloren.`);
    ensureHost();
    broadcastLobby();
  });
});

// Remove players that left the lobby and did not come back.
setInterval(() => {
  if (phase !== 'lobby') return;
  let changed = false;
  for (const [id, e] of entries) {
    if (!e.connected && Date.now() - e.leftAt > 20000) { entries.delete(id); changed = true; }
  }
  if (changed) { ensureHost(); broadcastLobby(); }
}, 5000);

server.listen(PORT, '0.0.0.0', () => {
  const ips = Object.values(networkInterfaces()).flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i!.address);
  console.log('\n  ⚔  LAN Tower Defense läuft!\n');
  console.log(`  Lokal:   http://localhost:${PORT}`);
  for (const ip of ips) console.log(`  Im LAN:  http://${ip}:${PORT}`);
  console.log('\n  Mitspieler öffnen die LAN-Adresse im Browser (Chrome/Firefox/Edge).');
  console.log('  Windows: ggf. Firewall-Freigabe für Node.js / Port ' + PORT + ' erlauben.\n');
});
