import type { ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { MAP_H, MAP_W, SECTION_OF, cellIndex } from '../shared/map';
import { Client, randomPort, startServer } from './helpers';

let server: ChildProcess;
const SAVE_DIR = mkdtempSync(pathJoin(tmpdir(), 'td-lobby-'));
afterAll(() => { server?.kill(); rmSync(SAVE_DIR, { recursive: true, force: true }); });

async function join(port: number, name: string) {
  const c = new Client(port);
  await c.open();
  c.send({ t: 'hello', name });
  const w = await c.wait('welcome');
  return { c, id: w.you };
}

function buildCell() {
  for (let cy = 0; cy < MAP_H; cy++) for (let cx = 0; cx < MAP_W; cx++) if (SECTION_OF[cellIndex(cx, cy)] >= 0) return { cx, cy };
  throw new Error('no cell');
}

describe('lobby and running game', () => {
  it('random classes, wish crosses, kick, late join, shared towers of disconnected players, gifts', async () => {
    const port = randomPort() + 2000;
    server = await startServer(port, { SAVE_DIR });
    const { c: a, id: ida } = await join(port, 'Alice');
    const { c: b, id: idb } = await join(port, 'Bob');
    const { c: k, id: idk } = await join(port, 'Kevin');

    // Everybody gets a class preselected; wishes are shared with all players.
    const lobby = await a.wait('lobby', (m) => m.players.length === 3);
    expect(lobby.players.every((p) => !!p.classId)).toBe(true);
    a.send({ t: 'setPos', x: 0.25, y: 0.5 });
    const withPos = await b.wait('lobby', (m) => !!m.players.find((p) => p.id === ida)?.pos);
    expect(withPos.players.find((p) => p.id === ida)!.pos).toEqual({ x: 0.25, y: 0.5 });

    // Only the host can kick; a kicked player gets told and is removed.
    b.send({ t: 'kick', id: idk });
    await b.wait('error', (m) => m.msg.includes('Host'));
    a.send({ t: 'kick', id: idk });
    await k.wait('kicked');
    await a.wait('lobby', (m) => m.players.length === 2);

    // Start with the preselected classes.
    b.send({ t: 'lobbyReady', ready: true });
    await a.wait('lobby', (m) => !!m.players.find((p) => p.id === idb)?.ready);
    a.send({ t: 'start' });
    const game = await a.wait('game');
    expect(game.state.players).toHaveLength(2);
    const classA = game.state.players.find((p) => p.id === ida)!.classId!;
    const towerDef = { human: 'h_block', orc: 'o_block', undead: 'u_block', nightelf: 'n_block', element: 'e_block', goblin: 'g_block' }[classA]!;

    // Alice builds, then loses the connection.
    const cell = buildCell();
    a.send({ t: 'build', def: towerDef, cx: cell.cx, cy: cell.cy });
    const tower = (await a.wait('tower')).tower;
    expect(tower.owner).toBe(ida);

    // Bob cannot touch Alice's tower while she is connected ...
    b.send({ t: 'sell', id: tower.id });
    await new Promise((r) => setTimeout(r, 300));
    expect(b.msgs.some((m) => m.t === 'towerGone')).toBe(false);
    a.close();
    await b.wait('lobby', (m) => m.players.some((p) => p.id === ida && !p.connected));

    // ... but can after she left. A newcomer joins the running game as a player.
    const { c: d, id: idd } = await join(port, 'Dora');
    await d.wait('game');
    d.send({ t: 'joinGame', classId: 'human' });
    const dg = await d.wait('game', (m) => m.state.players.length === 3);
    expect(dg.state.players.find((p) => p.id === idd)!.classId).toBe('human');
    const joined = await b.wait('joined');
    expect(joined.player.id).toBe(idd);

    // Gold gift to another player.
    d.send({ t: 'gift', to: idb, amount: 50 });
    await b.wait('event', (e) => e.text.includes('50 Gold'));

    // Dora can now sell Alice's tower (owner disconnected).
    d.send({ t: 'sell', id: tower.id });
    await b.wait('towerGone', (m) => m.id === tower.id);

    b.close(); d.close();
  }, 40000);
});
