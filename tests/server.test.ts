import { spawn, type ChildProcess } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { ClientMsg, ServerMsg } from '../shared/protocol';

const PORT = 3900 + Math.floor(Math.random() * 90);
let server: ChildProcess;

class Client {
  ws: WebSocket;
  msgs: ServerMsg[] = [];
  constructor() { this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`); this.ws.on('message', (d) => this.msgs.push(JSON.parse(String(d)))); }
  open() { return new Promise<void>((r) => this.ws.once('open', () => r())); }
  send(m: ClientMsg) { this.ws.send(JSON.stringify(m)); }
  async wait<T extends ServerMsg['t']>(t: T, pred: (m: Extract<ServerMsg, { t: T }>) => boolean = () => true, ms = 5000): Promise<Extract<ServerMsg, { t: T }>> {
    const start = Date.now();
    while (Date.now() - start < ms) {
      const found = this.msgs.find((m) => m.t === t && pred(m as Extract<ServerMsg, { t: T }>));
      if (found) return found as Extract<ServerMsg, { t: T }>;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('timeout waiting for ' + t);
  }
  close() { this.ws.close(); }
}

beforeAll(async () => {
  server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'pipe' });
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 15000);
    server.stdout!.on('data', (d) => { if (String(d).includes('localhost')) { clearTimeout(t); resolve(); } });
  });
});

afterAll(() => { server?.kill(); });

describe('server protocol', () => {
  it('runs lobby -> game -> build -> reconnect', async () => {
    const a = new Client(); await a.open();
    a.send({ t: 'hello', name: 'Alice' });
    const wa = await a.wait('welcome');
    const b = new Client(); await b.open();
    b.send({ t: 'hello', name: 'Bob<script>' });
    const wb = await b.wait('welcome');

    let lobby = await a.wait('lobby', (m) => m.players.length === 2);
    expect(lobby.hostId).toBe(wa.you);
    expect(lobby.players.find((p) => p.id === wb.you)!.name).toBe('Bobscript');

    a.send({ t: 'setClass', classId: 'human' });
    b.send({ t: 'setClass', classId: 'undead' });
    a.send({ t: 'start' });
    await a.wait('error', (m) => m.msg.includes('Bereit') || m.msg.includes('bereit'));
    b.send({ t: 'lobbyReady', ready: true });
    await a.wait('lobby', (m) => !!m.players.find((p) => p.id === wb.you)?.ready);
    b.send({ t: 'start' }); // not host -> ignored
    a.send({ t: 'start' });
    const game = await b.wait('game');
    expect(game.state.players).toHaveLength(2);
    expect(game.state.sectionOwners).toHaveLength(16);

    // Build in an own section.
    const { SECTION_OF, MAP_W, MAP_H, cellIndex } = await import('../shared/map');
    let cell: { cx: number; cy: number } | null = null;
    for (let cy = 0; cy < MAP_H && !cell; cy++) for (let cx = 0; cx < MAP_W && !cell; cx++) {
      const s = SECTION_OF[cellIndex(cx, cy)];
      if (s >= 0 && game.state.sectionOwners[s] === wa.you) cell = { cx, cy };
    }
    a.send({ t: 'build', def: 'h_watch', cx: cell!.cx, cy: cell!.cy });
    const tower = await b.wait('tower');
    expect(tower.tower.owner).toBe(wa.you);
    const snap = await b.wait('snap');
    expect(snap.players.find((p) => p.id === wa.you)!.gold).toBeLessThan(350);

    // Reconnect with token restores the game state.
    b.close();
    await a.wait('lobby', (m) => m.players.some((p) => p.id === wb.you && !p.connected));
    const b2 = new Client(); await b2.open();
    b2.send({ t: 'hello', name: 'Bob', token: wb.token });
    const w2 = await b2.wait('welcome');
    expect(w2.you).toBe(wb.you);
    const g2 = await b2.wait('game');
    expect(g2.state.towers).toHaveLength(1);

    // Late joiner becomes spectator.
    const c = new Client(); await c.open();
    c.send({ t: 'hello', name: 'Carl' });
    const wc = await c.wait('welcome');
    lobby = await c.wait('lobby', (m) => m.players.some((p) => p.id === wc.you));
    expect(lobby.players.find((p) => p.id === wc.you)!.spectator).toBe(true);
    await c.wait('game');

    a.close(); b2.close(); c.close();
  }, 30000);
});
