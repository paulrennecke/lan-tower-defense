import type { ChildProcess } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client as BaseClient, randomPort, startServer } from './helpers';

const PORT = randomPort();
let server: ChildProcess;

class Client extends BaseClient { constructor() { super(PORT); } }

beforeAll(async () => { server = await startServer(PORT); });

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
    expect(game.state.lanes.length).toBeGreaterThan(0);

    // Build in an own section.
    const { SECTION_OF, MAP_W, MAP_H, cellIndex } = await import('../shared/map');
    let cell: { cx: number; cy: number } | null = null;
    for (let cy = 0; cy < MAP_H && !cell; cy++) for (let cx = 0; cx < MAP_W && !cell; cx++) {
      const s = SECTION_OF[cellIndex(cx, cy)];
      if (s >= 0) cell = { cx, cy };
    }
    a.send({ t: 'build', def: 'h_watch', cx: cell!.cx, cy: cell!.cy });
    const tower = await b.wait('tower');
    expect(tower.tower.owner).toBe(wa.you);
    const snap = await b.wait('snap');
    expect(snap.players.find((p) => p.id === wa.you)!.gold).toBeLessThan(450);

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
