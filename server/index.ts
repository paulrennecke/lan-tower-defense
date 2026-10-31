import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, createReadStream } from 'node:fs';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { networkInterfaces } from 'node:os';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { CLASS_BY_ID } from '../shared/data/classes';
import {
  MAX_PLAYERS, PLAYER_COLORS, type ClientMsg, type GamePhase, type LobbyPlayer, type SaveInfo, type ServerMsg, type TargetMode,
} from '../shared/protocol';
import { Game, type GameHooks, type GamePlayer, type GameSave } from './game';
import { setActiveMap } from '../shared/map';
import { DEFAULT_MAP, MAP_BY_ID } from '../shared/maps';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STATIC_DIR = join(ROOT, 'dist', 'client');
const HIGHSCORE_FILE = join(ROOT, 'highscore.json');
const SAVE_DIR = resolve(process.env.SAVE_DIR ?? join(ROOT, 'saves'));
const PORT = Number(process.env.PORT ?? process.argv[2] ?? 3000);
const TICK = 0.05;
const SNAP_EVERY = 2;

interface Entry extends LobbyPlayer { token: string; ws: WebSocket | null; leftAt: number }

const entries = new Map<string, Entry>();
let hostId: string | null = null;
let phase: GamePhase = 'lobby';
let mapId = DEFAULT_MAP;
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

// ------------------------------------------------------------------ save games

interface SaveFile { info: SaveInfo; game: GameSave }

let saves = listSaves();

function listSaves(): SaveInfo[] {
  if (!existsSync(SAVE_DIR)) return [];
  const list: SaveInfo[] = [];
  for (const f of readdirSync(SAVE_DIR)) {
    if (!f.endsWith('.json')) continue;
    try {
      const data = JSON.parse(readFileSync(join(SAVE_DIR, f), 'utf8')) as SaveFile;
      list.push({ ...data.info, id: f.slice(0, -5) });
    } catch { /* skip broken files */ }
  }
  return list.sort((a, b) => b.date.localeCompare(a.date));
}

const saveId = (name: string) => name.normalize('NFKD').replace(/[^\w\- ]/g, '').trim().replace(/\s+/g, '_').slice(0, 40) || 'spielstand';
const savePath = (id: string) => saves.some((s) => s.id === id) ? join(SAVE_DIR, id + '.json') : null;

function saveGame(name: string): string {
  if (!game) throw new Error('Kein Spiel aktiv.');
  const info: SaveInfo = {
    id: saveId(name), name, date: new Date().toISOString(), wave: game.wave, lives: game.lives,
    players: [...game.players.values()].map((p) => ({ name: p.name, classId: p.classId })), map: game.mapId,
  };
  mkdirSync(SAVE_DIR, { recursive: true });
  writeFileSync(join(SAVE_DIR, info.id + '.json'), JSON.stringify({ info, game: game.toSave() } satisfies SaveFile));
  saves = listSaves();
  return info.name;
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
  return { t: 'lobby', players, hostId, phase, highscore, saves, map: mapId };
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

function gameHooks(): GameHooks {
  return {
    tower: (t) => broadcast({ t: 'tower', tower: t }),
    towerGone: (id) => broadcast({ t: 'towerGone', id }),
    event: (kind, text) => broadcast({ t: 'event', kind, text }),
    gameOver: (wave, victory) => endGame(wave, victory),
  };
}

function startGame() {
  const players = activePlayers().filter((e) => e.connected);
  setActiveMap(mapId);
  runGame(new Game(players.map((p) => ({ id: p.id, name: p.name, color: p.color, classId: p.classId! })), gameHooks()));
  sysChat(`Das Spiel beginnt mit ${players.length} Spieler(n)! Baut eure Verteidigung – die erste Welle kommt bald.`);
}

function loadGame(id: string, host: Entry): string | null {
  const file = savePath(id);
  if (!file) return 'Spielstand nicht gefunden.';
  let data: SaveFile;
  let g: Game;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
    g = Game.fromSave(data.game, gameHooks(), host.name);
  } catch (e) {
    return 'Spielstand konnte nicht geladen werden: ' + (e as Error).message;
  }
  mapId = g.mapId;
  // Connected players take over the saved slots: same name first, then in join order (host first).
  const free = [...g.players.values()];
  const lobby = activePlayers().filter((e) => e.connected).sort((a, b) => Number(b === host) - Number(a === host));
  const assigned = new Map<Entry, GamePlayer>();
  for (const e of lobby) {
    const i = free.findIndex((p) => p.name.toLowerCase() === e.name.toLowerCase());
    if (i >= 0) assigned.set(e, free.splice(i, 1)[0]);
  }
  for (const e of lobby) if (!assigned.has(e) && free.length) assigned.set(e, free.shift()!);

  const rekeyed = new Map<string, Entry>();
  for (const e of entries.values()) {
    const slot = assigned.get(e);
    const oldId = e.id;
    if (slot) {
      claimSlot(e, slot, g);
    } else {
      e.spectator = true;
      if (g.players.has(e.id)) e.id = randomBytes(4).toString('hex');
    }
    if (hostId === oldId) hostId = e.id;
    rekeyed.set(e.id, e);
  }
  entries.clear();
  for (const [k, v] of rekeyed) entries.set(k, v);
  for (const e of entries.values()) send(e.ws, { t: 'welcome', you: e.id, token: e.token });
  runGame(g);
  sysChat(`Spielstand „${data.info.name}“ geladen (Welle ${g.wave}). Das Spiel ist pausiert – mit P oder ⏸ fortsetzen.`);
  if (free.length) sysChat(`Freie Plätze: ${free.map((p) => p.name).join(', ')}. Neue Mitspieler übernehmen sie automatisch.`);
  return null;
}

/** Lets a lobby entry take over a player slot of a (loaded) game. */
function claimSlot(e: Entry, slot: GamePlayer, g: Game) {
  e.id = slot.id;
  e.color = slot.color;
  e.classId = slot.classId;
  e.spectator = false;
  slot.name = e.name;
  g.setConnected(slot.id, true);
}

function runGame(g: Game) {
  game = g;
  // Lobby members without a slot in the game become spectators.
  for (const e of entries.values()) if (!g.players.has(e.id)) e.spectator = true;
  phase = 'playing';
  tickCount = 0;
  broadcastLobby();
  for (const e of entries.values()) sendGameState(e);
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
        // In a loaded game, newcomers take over unclaimed player slots (same name preferred).
        const orphans = phase === 'playing' && game && !full ? [...game.players.values()].filter((gp) => !entries.has(gp.id)) : [];
        const slot = orphans.find((gp) => gp.name.toLowerCase() === me!.name.toLowerCase()) ?? orphans[0];
        if (slot && game) {
          entries.delete(me.id);
          claimSlot(me, slot, game);
          entries.set(me.id, me);
        }
        sysChat(`${me.name} ist beigetreten${me.spectator ? ' (Zuschauer)' : slot ? ` und übernimmt einen freien Platz` : ''}.`);
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
    const paused = () => { if (game?.paused) { err('Das Spiel ist pausiert.'); return true; } return false; };

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
      case 'setMap':
        if (phase === 'lobby' && p.id === hostId && MAP_BY_ID[msg.id]) { mapId = msg.id; broadcastLobby(); }
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
        if (game && !paused()) err(game.build(p.id, String(msg.def), Math.floor(msg.cx), Math.floor(msg.cy)));
        break;
      case 'upgrade':
        if (game && !paused()) err(game.upgrade(p.id, Number(msg.id)));
        break;
      case 'sell':
        if (game && !paused()) err(game.sell(p.id, Number(msg.id)));
        break;
      case 'mode':
        if (game && ['first', 'last', 'strong', 'weak', 'close'].includes(msg.mode)) err(game.setMode(p.id, Number(msg.id), msg.mode as TargetMode));
        break;
      case 'research':
        if (game && !paused()) err(game.research(p.id, String(msg.id)));
        break;
      case 'callWave':
        game?.setReady(p.id, !!msg.ready);
        break;
      case 'pause': {
        if (!game || phase !== 'playing' || p.spectator) return;
        if (msg.paused && !game.paused) {
          game.paused = p.name;
          sysChat(`⏸ ${p.name} hat das Spiel pausiert.`);
        } else if (!msg.paused && game.paused) {
          game.paused = null;
          sysChat(`▶ ${p.name} setzt das Spiel fort.`);
        }
        broadcast(game.snapshot());
        break;
      }
      case 'save': {
        if (!game || phase !== 'playing' || p.spectator) return err('Speichern ist nur während eines laufenden Spiels möglich.');
        const name = String(msg.name ?? '').replace(/[<>]/g, '').trim().slice(0, 40) || `Welle ${game.wave}`;
        try {
          const saved = saveGame(name);
          broadcast({ t: 'event', kind: 'info', text: `💾 ${p.name} hat das Spiel gespeichert: „${saved}“` });
          broadcastLobby();
        } catch (e) {
          err('Speichern fehlgeschlagen: ' + (e as Error).message);
        }
        break;
      }
      case 'load':
        if (phase !== 'lobby' || p.id !== hostId) return err('Nur der Host kann in der Lobby einen Spielstand laden.');
        err(loadGame(String(msg.id), p));
        break;
      case 'deleteSave': {
        if (phase !== 'lobby' || p.id !== hostId) return err('Nur der Host kann Spielstände löschen.');
        const file = savePath(String(msg.id));
        if (!file) return err('Spielstand nicht gefunden.');
        rmSync(file, { force: true });
        saves = listSaves();
        broadcastLobby();
        break;
      }
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
