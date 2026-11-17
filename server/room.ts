import { randomBytes } from 'node:crypto';
import { WebSocket } from 'ws';
import { CLASSES, CLASS_BY_ID } from '../shared/data/classes';
import {
  MAX_PLAYERS, PLAYER_COLORS, type ClientMsg, type GamePhase, type LobbyPlayer, type RoomInfo, type ServerMsg, type TargetMode,
} from '../shared/protocol';
import { Game, type GameHooks, type GamePlayer } from './game';
import { setActiveMap } from '../shared/map';
import { DEFAULT_MAP, MAP_BY_ID } from '../shared/maps';
import type { HighscoreStore, SaveStore } from './store';
import { VERSION } from './version';

const TICK = 0.05;
/** Upper bound for the cells / towers of one batch message. */
const MAX_BATCH = 300;
const SNAP_EVERY = 2;

interface Entry extends LobbyPlayer { token: string; ws: WebSocket | null; leftAt: number; owner: string | null }

export interface RoomOptions {
  /** Room code (online) – null for the single LAN room. */
  code: string | null;
  name: string;
  isPublic: boolean;
  highscores: HighscoreStore;
  saves: SaveStore;
  /** Max. messages per second and connection (token bucket), Infinity = unlimited. */
  msgRate?: number;
}

const randomClass = () => CLASSES[Math.floor(Math.random() * CLASSES.length)].id;
const cleanName = (s: unknown) => String(s ?? '').replace(/[<>]/g, '').trim().slice(0, 20) || 'Spieler';
const cleanOwner = (s: unknown) => (typeof s === 'string' && /^[\w-]{16,64}$/.test(s) ? s : null);

/**
 * One lobby with (at most) one running game. LAN servers have exactly one room; online servers many.
 *
 * Map data in shared/map.ts is global, so every entry point (message, tick, timer) first activates the map of the
 * room. All game logic is synchronous, so rooms cannot interfere with each other.
 */
export class Room {
  readonly code: string | null;
  readonly name: string;
  readonly isPublic: boolean;
  /** Last time somebody was connected (for cleaning up abandoned rooms). */
  lastActive = Date.now();

  private entries = new Map<string, Entry>();
  private hostId: string | null = null;
  private phase: GamePhase = 'lobby';
  private mapId = DEFAULT_MAP;
  private game: Game | null = null;
  private tickCount = 0;
  private loop: NodeJS.Timeout | null = null;
  private lastGameOver: Extract<ServerMsg, { t: 'gameOver' }> | null = null;
  private highscores: HighscoreStore;
  private saves: SaveStore;
  private msgRate: number;

  constructor(opts: RoomOptions) {
    this.code = opts.code;
    this.name = opts.name;
    this.isPublic = opts.isPublic;
    this.highscores = opts.highscores;
    this.saves = opts.saves;
    this.msgRate = opts.msgRate ?? Infinity;
  }

  // ---------------------------------------------------------------- info

  get connectedCount() { return [...this.entries.values()].filter((e) => e.connected).length; }

  info(): RoomInfo {
    const list = [...this.entries.values()].filter((e) => e.connected);
    return {
      code: this.code ?? '', name: this.name, public: this.isPublic, phase: this.phase,
      map: this.game?.mapId ?? this.mapId, players: list.filter((e) => !e.spectator).length,
      spectators: list.filter((e) => e.spectator).length, wave: this.game?.wave ?? 0,
    };
  }

  /** Stops the game loop and closes all connections. */
  dispose() {
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
    this.game = null;
    for (const e of this.entries.values()) e.ws?.close();
    this.entries.clear();
  }

  private activate() { setActiveMap(this.game?.mapId ?? this.mapId); }

  // ---------------------------------------------------------------- messaging

  private send(ws: WebSocket | null, msg: ServerMsg) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }
  private broadcast(msg: ServerMsg) {
    const data = JSON.stringify(msg);
    for (const e of this.entries.values()) if (e.ws && e.ws.readyState === WebSocket.OPEN) e.ws.send(data);
  }
  private sysChat(text: string) {
    this.broadcast({ t: 'chat', from: null, name: 'System', color: 0xffcc00, text });
  }

  private lobbyMsg(to: Entry): ServerMsg {
    const players: LobbyPlayer[] = [...this.entries.values()].map(({ id, name, color, classId, ready, connected, spectator, pos }) => ({
      id, name, color, classId, ready, connected, spectator, pos,
    }));
    return {
      t: 'lobby', players, hostId: this.hostId, phase: this.phase,
      highscore: this.highscores.of(this.phase === 'lobby' ? this.mapId : this.game?.mapId ?? this.mapId),
      saves: this.saves.list(to.owner), map: this.mapId, room: this.code ? this.info() : null,
    };
  }
  private broadcastLobby() {
    for (const e of this.entries.values()) this.send(e.ws, this.lobbyMsg(e));
  }

  private sendGameState(e: Entry) {
    if (!this.game) return;
    this.send(e.ws, { t: 'game', state: this.game.fullState(e.id, this.entries, this.highscores.of(this.game.mapId)) });
    // Players who (re)connect after the game ended must see the game-over screen, too.
    if (this.phase === 'gameover' && this.lastGameOver) {
      this.send(e.ws, this.game.snapshot());
      this.send(e.ws, this.lastGameOver);
    }
  }

  private freeColor(): number {
    const used = new Set([...this.entries.values()].map((e) => e.color));
    return PLAYER_COLORS.find((c) => !used.has(c)) ?? PLAYER_COLORS[this.entries.size % PLAYER_COLORS.length];
  }

  private activePlayers() { return [...this.entries.values()].filter((e) => !e.spectator); }

  private ensureHost() {
    const host = this.hostId ? this.entries.get(this.hostId) : undefined;
    if (host && host.connected && !host.spectator) return;
    const next = this.activePlayers().find((e) => e.connected);
    this.hostId = next?.id ?? null;
    if (next) this.sysChat(`${next.name} ist jetzt Host.`);
  }

  // ---------------------------------------------------------------- game control

  private gameHooks(): GameHooks {
    return {
      tower: (t) => this.broadcast({ t: 'tower', tower: t }),
      towerGone: (id) => this.broadcast({ t: 'towerGone', id }),
      event: (kind, text) => this.broadcast({ t: 'event', kind, text }),
      gameOver: (wave, victory) => this.endGame(wave, victory),
    };
  }

  private saveGame(owner: string | null, name: string): string {
    const game = this.game;
    if (!game) throw new Error('Kein Spiel aktiv.');
    this.saves.write(owner, {
      name, date: new Date().toISOString(), wave: game.wave, lives: game.lives,
      players: [...game.players.values()].map((p) => ({ name: p.name, classId: p.classId })), map: game.mapId,
    }, game.toSave());
    return name;
  }

  private startGame() {
    const players = this.activePlayers().filter((e) => e.connected);
    setActiveMap(this.mapId);
    this.runGame(new Game(players.map((p) => ({ id: p.id, name: p.name, color: p.color, classId: p.classId! })), this.gameHooks()));
    this.sysChat(`Das Spiel beginnt mit ${players.length} Spieler(n)! Baut eure Verteidigung – die erste Welle kommt bald.`);
  }

  private loadGame(id: string, host: Entry): string | null {
    let data;
    let g: Game;
    try {
      data = this.saves.read(host.owner, id);
      if (!data) return 'Spielstand nicht gefunden.';
      g = Game.fromSave(data.game, this.gameHooks(), host.name);
    } catch (e) {
      return 'Spielstand konnte nicht geladen werden: ' + (e as Error).message;
    }
    this.mapId = g.mapId;
    // Connected players take over the saved slots: same name first, then in join order (host first).
    const free = [...g.players.values()];
    const lobby = this.activePlayers().filter((e) => e.connected).sort((a, b) => Number(b === host) - Number(a === host));
    const assigned = new Map<Entry, GamePlayer>();
    for (const e of lobby) {
      const i = free.findIndex((p) => p.name.toLowerCase() === e.name.toLowerCase());
      if (i >= 0) assigned.set(e, free.splice(i, 1)[0]);
    }
    for (const e of lobby) if (!assigned.has(e) && free.length) assigned.set(e, free.shift()!);

    const rekeyed = new Map<string, Entry>();
    for (const e of this.entries.values()) {
      const slot = assigned.get(e);
      const oldId = e.id;
      if (slot) {
        this.claimSlot(e, slot, g);
      } else {
        e.spectator = true;
        if (g.players.has(e.id)) e.id = randomBytes(4).toString('hex');
      }
      if (this.hostId === oldId) this.hostId = e.id;
      rekeyed.set(e.id, e);
    }
    this.entries.clear();
    for (const [k, v] of rekeyed) this.entries.set(k, v);
    for (const e of this.entries.values()) this.send(e.ws, { t: 'welcome', you: e.id, token: e.token, version: VERSION });
    this.runGame(g);
    this.sysChat(`Spielstand „${data.info.name}“ geladen (Welle ${g.wave}). Das Spiel ist pausiert – mit P oder ⏸ fortsetzen.`);
    if (free.length) this.sysChat(`Freie Plätze: ${free.map((p) => p.name).join(', ')}. Neue Mitspieler übernehmen sie automatisch.`);
    return null;
  }

  /** Lets a lobby entry take over a player slot of a (loaded) game. */
  private claimSlot(e: Entry, slot: GamePlayer, g: Game) {
    e.id = slot.id;
    e.color = slot.color;
    e.classId = slot.classId;
    e.spectator = false;
    slot.name = e.name;
    g.setConnected(slot.id, true);
  }

  private runGame(g: Game) {
    this.game = g;
    // Lobby members without a slot in the game become spectators.
    for (const e of this.entries.values()) if (!g.players.has(e.id)) e.spectator = true;
    this.phase = 'playing';
    this.tickCount = 0;
    this.broadcastLobby();
    for (const e of this.entries.values()) this.sendGameState(e);
    let last = performance.now();
    let acc = 0;
    this.loop = setInterval(() => {
      const now = performance.now();
      acc += Math.min(0.5, (now - last) / 1000);
      last = now;
      if (this.game) this.activate();
      while (acc >= TICK && this.game) {
        acc -= TICK;
        this.game.tick(TICK);
        if (++this.tickCount % SNAP_EVERY === 0 && this.game) this.broadcast(this.game.snapshot());
      }
    }, 15);
  }

  private endGame(wave: number, victory: boolean) {
    const game = this.game;
    if (!game) return;
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
    const reached = Math.max(0, wave - 1);
    const newRecord = this.highscores.submit(game.mapId, reached);
    this.phase = 'gameover';
    this.broadcast(game.snapshot());
    this.lastGameOver = { t: 'gameOver', wave: reached, victory, highscore: this.highscores.of(game.mapId), newRecord, ...game.endStats() };
    this.broadcast(this.lastGameOver);
    this.broadcastLobby();
  }

  private backToLobby() {
    this.lastGameOver = null;
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
    this.game = null;
    this.phase = 'lobby';
    for (const [id, e] of this.entries) {
      if (!e.connected) { this.entries.delete(id); continue; }
      e.ready = false;
    }
    let count = 0;
    for (const e of this.entries.values()) {
      e.spectator = count >= MAX_PLAYERS;
      if (!e.spectator) count++;
    }
    this.ensureHost();
    this.broadcastLobby();
  }

  // ---------------------------------------------------------------- connections

  connect(ws: WebSocket) {
    let me: Entry | null = null;
    let tokens = this.msgRate * 2, lastRefill = Date.now();

    ws.on('message', (raw) => {
      if (this.msgRate !== Infinity) {
        const now = Date.now();
        tokens = Math.min(this.msgRate * 2, tokens + ((now - lastRefill) / 1000) * this.msgRate);
        lastRefill = now;
        if (tokens < 1) return;
        tokens--;
      }
      let msg: ClientMsg;
      try { msg = JSON.parse(String(raw)); } catch { return; }
      if (!msg || typeof msg !== 'object') return;
      this.activate();
      if (msg.t === 'hello') { me = this.hello(ws, msg); return; }
      if (me) this.handle(me, ws, msg);
    });

    ws.on('close', () => {
      if (!me || me.ws !== ws) return;
      this.activate();
      me.ws = null;
      me.connected = false;
      me.ready = false;
      me.leftAt = Date.now();
      this.lastActive = Date.now();
      this.game?.setConnected(me.id, false);
      this.sysChat(`${me.name} hat die Verbindung verloren.`);
      this.ensureHost();
      this.broadcastLobby();
    });
  }

  private hello(ws: WebSocket, msg: Extract<ClientMsg, { t: 'hello' }>): Entry {
    let me: Entry;
    const existing = msg.token ? [...this.entries.values()].find((e) => e.token === msg.token) : undefined;
    if (existing) {
      if (existing.ws && existing.ws !== ws) existing.ws.close();
      me = existing;
      me.ws = ws;
      me.connected = true;
      me.owner = cleanOwner(msg.owner) ?? me.owner;
      this.game?.setConnected(me.id, true);
      this.sysChat(`${me.name} ist wieder verbunden.`);
    } else {
      const full = this.activePlayers().length >= MAX_PLAYERS;
      me = {
        id: randomBytes(4).toString('hex'), name: cleanName(msg.name), color: this.freeColor(), classId: randomClass(),
        ready: false, connected: true, spectator: full || this.phase !== 'lobby', token: randomBytes(12).toString('hex'), ws,
        leftAt: 0, pos: null, owner: cleanOwner(msg.owner),
      };
      this.entries.set(me.id, me);
      // In a loaded game, newcomers take over unclaimed player slots (same name preferred).
      const game = this.game;
      const orphans = this.phase === 'playing' && game && !full ? [...game.players.values()].filter((gp) => !this.entries.has(gp.id)) : [];
      const slot = orphans.find((gp) => gp.name.toLowerCase() === me.name.toLowerCase()) ?? orphans[0];
      if (slot && game) {
        this.entries.delete(me.id);
        this.claimSlot(me, slot, game);
        this.entries.set(me.id, me);
      }
      this.sysChat(`${me.name} ist beigetreten${me.spectator ? (this.phase === 'lobby' ? ' (Zuschauer)' : ' (kann über das Baumenü mitspielen)') : slot ? ` und übernimmt einen freien Platz` : ''}.`);
    }
    this.lastActive = Date.now();
    this.ensureHost();
    this.send(ws, { t: 'welcome', you: me.id, token: me.token, version: VERSION });
    this.broadcastLobby();
    if (this.phase !== 'lobby') this.sendGameState(me);
    return me;
  }

  private handle(p: Entry, ws: WebSocket, msg: ClientMsg) {
    const game = this.game;
    const err = (m: string | null) => { if (m) this.send(ws, { t: 'error', msg: m }); };
    const paused = () => { if (game?.paused) { err('Das Spiel ist pausiert.'); return true; } return false; };
    const phase = this.phase;
    const isHost = p.id === this.hostId;

    switch (msg.t) {
      case 'setName':
        p.name = cleanName(msg.name);
        this.broadcastLobby();
        break;
      case 'setClass':
        if (phase === 'lobby' && !p.spectator && CLASS_BY_ID[msg.classId]) { p.classId = msg.classId; this.broadcastLobby(); }
        break;
      case 'lobbyReady':
        if (phase === 'lobby' && !p.spectator) { p.ready = !!msg.ready && !!p.classId; this.broadcastLobby(); }
        break;
      case 'setMap':
        if (phase === 'lobby' && isHost && MAP_BY_ID[msg.id]) {
          this.mapId = msg.id;
          for (const e of this.entries.values()) e.pos = null;
          this.broadcastLobby();
        }
        break;
      case 'setPos':
        if (phase === 'lobby' && !p.spectator && Number.isFinite(msg.x) && Number.isFinite(msg.y)) {
          p.pos = { x: Math.min(1, Math.max(0, msg.x)), y: Math.min(1, Math.max(0, msg.y)) };
          this.broadcastLobby();
        }
        break;
      case 'kick': {
        if (phase !== 'lobby' || !isHost) return err('Nur der Host kann Spieler entfernen.');
        const target = this.entries.get(String(msg.id));
        if (!target || target.id === p.id) return;
        this.send(target.ws, { t: 'kicked' });
        target.ws?.close();
        this.entries.delete(target.id);
        this.sysChat(`${target.name} wurde vom Host entfernt.`);
        this.ensureHost();
        this.broadcastLobby();
        break;
      }
      case 'gift':
        if (game && phase === 'playing' && !p.spectator) err(game.gift(p.id, String(msg.to), Number(msg.amount)));
        break;
      case 'joinGame': {
        // Late join: spectators become players of the running game.
        if (!game || phase !== 'playing' || !p.spectator || !CLASS_BY_ID[msg.classId]) return;
        if (game.players.size >= MAX_PLAYERS) return err('Das Spiel ist voll.');
        p.classId = msg.classId;
        p.spectator = false;
        game.addPlayer({ id: p.id, name: p.name, color: p.color, classId: msg.classId });
        this.sysChat(`${p.name} steigt als ${CLASS_BY_ID[msg.classId].name} ins laufende Spiel ein.`);
        this.broadcastLobby();
        this.sendGameState(p);
        const joined = game.fullState(p.id, this.entries, 0).players.find((x) => x.id === p.id);
        if (joined) for (const e of this.entries.values()) if (e !== p) this.send(e.ws, { t: 'joined', player: joined });
        break;
      }
      case 'start': {
        if (phase !== 'lobby' || !isHost) return;
        const players = this.activePlayers().filter((e) => e.connected);
        const missing = players.filter((e) => !e.classId || (!e.ready && e.id !== this.hostId));
        if (!p.classId) return err('Wähle zuerst eine Klasse.');
        if (missing.length) return err('Noch nicht bereit: ' + missing.map((e) => e.name).join(', '));
        this.startGame();
        break;
      }
      case 'chat': {
        const text = String(msg.text ?? '').slice(0, 200).trim();
        if (text) this.broadcast({ t: 'chat', from: p.id, name: p.name, color: p.color, text });
        break;
      }
      case 'ping':
        if (Number.isFinite(msg.x) && Number.isFinite(msg.y)) this.broadcast({ t: 'ping', x: msg.x, y: msg.y, color: p.color });
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
      case 'sellMany':
        if (game && !paused() && Array.isArray(msg.ids)) {
          let sold = 0, first: string | null = null;
          for (const id of msg.ids.slice(0, MAX_BATCH)) { const e = game.sell(p.id, Number(id)); if (e) first ??= e; else sold++; }
          if (!sold) err(first);
        }
        break;
      case 'buildMany':
        if (game && !paused() && Array.isArray(msg.cells)) {
          let built = 0, first: string | null = null;
          for (const c of msg.cells.slice(0, MAX_BATCH)) {
            if (!Array.isArray(c)) continue;
            const e = game.build(p.id, String(msg.def), Math.floor(Number(c[0])), Math.floor(Number(c[1])));
            if (e) first ??= e; else built++;
          }
          // A drag over occupied cells is normal – only complain when nothing could be built.
          if (!built) err(first);
        }
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
          this.sysChat(`⏸ ${p.name} hat das Spiel pausiert.`);
        } else if (!msg.paused && game.paused) {
          game.paused = null;
          this.sysChat(`▶ ${p.name} setzt das Spiel fort.`);
        }
        this.broadcast(game.snapshot());
        break;
      }
      case 'save': {
        if (!game || phase !== 'playing' || p.spectator) return err('Speichern ist nur während eines laufenden Spiels möglich.');
        const name = String(msg.name ?? '').replace(/[<>]/g, '').trim().slice(0, 40) || `Welle ${game.wave}`;
        try {
          const saved = this.saveGame(p.owner, name);
          this.broadcast({ t: 'event', kind: 'info', text: `💾 ${p.name} hat das Spiel gespeichert: „${saved}“` });
          this.broadcastLobby();
        } catch (e) {
          err('Speichern fehlgeschlagen: ' + (e as Error).message);
        }
        break;
      }
      case 'load':
        if (phase !== 'lobby' || !isHost) return err('Nur der Host kann in der Lobby einen Spielstand laden.');
        err(this.loadGame(String(msg.id), p));
        break;
      case 'deleteSave': {
        if (phase !== 'lobby' || !isHost) return err('Nur der Host kann Spielstände löschen.');
        if (!this.saves.remove(p.owner, String(msg.id))) return err('Spielstand nicht gefunden.');
        this.broadcastLobby();
        break;
      }
      case 'quitGame': {
        if (phase === 'lobby' || !isHost) return err('Nur der Host kann das Spiel beenden.');
        if (msg.save !== undefined && game && phase === 'playing') {
          const name = String(msg.save).replace(/[<>]/g, '').trim().slice(0, 40) || `Welle ${game.wave}`;
          try { this.sysChat(`💾 Spiel gespeichert: „${this.saveGame(p.owner, name)}“`); } catch (e) { return err('Speichern fehlgeschlagen: ' + (e as Error).message); }
        }
        this.sysChat(`${p.name} hat das Spiel beendet. Zurück in der Lobby.`);
        this.backToLobby();
        break;
      }
      case 'backToLobby':
        if (phase === 'gameover' && isHost) this.backToLobby();
        break;
    }
  }

  /** Removes players that left the lobby and did not come back (called periodically). */
  sweep() {
    if (this.connectedCount > 0) this.lastActive = Date.now();
    if (this.phase !== 'lobby') return;
    let changed = false;
    for (const [id, e] of this.entries) {
      if (!e.connected && Date.now() - e.leftAt > 20000) { this.entries.delete(id); changed = true; }
    }
    if (changed) { this.ensureHost(); this.broadcastLobby(); }
  }
}
