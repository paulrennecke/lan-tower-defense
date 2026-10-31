import type { ChildProcess } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { SECTION_OF, MAP_H, MAP_W, cellIndex } from '../shared/map';
import { Client, randomPort, startServer } from './helpers';

const SAVE_DIR = mkdtempSync(join(tmpdir(), 'td-saves-'));
const servers: ChildProcess[] = [];

afterAll(() => {
  for (const s of servers) s.kill();
  rmSync(SAVE_DIR, { recursive: true, force: true });
});

function ownCell(sectionOwners: string[], pid: string) {
  for (let cy = 0; cy < MAP_H; cy++) for (let cx = 0; cx < MAP_W; cx++) {
    const s = SECTION_OF[cellIndex(cx, cy)];
    if (s >= 0 && sectionOwners[s] === pid) return { cx, cy };
  }
  throw new Error('no cell');
}

async function joinAs(port: number, name: string) {
  const c = new Client(port);
  await c.open();
  c.send({ t: 'hello', name });
  const w = await c.wait('welcome');
  return { c, w };
}

describe('pause, save & load over the network', () => {
  it('pauses, saves, and restores the game on a fresh server', async () => {
    const port1 = randomPort();
    servers.push(await startServer(port1, { SAVE_DIR }));
    const { c: a, w: wa } = await joinAs(port1, 'Alice');
    const { c: b, w: wb } = await joinAs(port1, 'Bob');
    a.send({ t: 'setClass', classId: 'human' });
    b.send({ t: 'setClass', classId: 'orc' });
    b.send({ t: 'lobbyReady', ready: true });
    await a.wait('lobby', (m) => !!m.players.find((p) => p.id === wb.you)?.ready);
    a.send({ t: 'start' });
    const g = await a.wait('game');

    // Pause blocks building, resume allows it again.
    b.send({ t: 'pause', paused: true });
    await a.wait('snap', (s) => s.paused === 'Bob');
    const cell = ownCell(g.state.sectionOwners, wa.you);
    a.send({ t: 'build', def: 'h_watch', cx: cell.cx, cy: cell.cy });
    await a.wait('error', (m) => m.msg.includes('pausiert'));
    a.send({ t: 'pause', paused: false });
    await a.wait('snap', (s) => s.paused === null && a.msgs.some((m) => m.t === 'snap' && m.paused === 'Bob'));
    a.send({ t: 'build', def: 'h_watch', cx: cell.cx, cy: cell.cy });
    await b.wait('tower');

    a.send({ t: 'save', name: 'Mein <Test> Spiel' });
    await b.wait('event', (e) => e.text.includes('gespeichert'));
    const lobby = await b.wait('lobby', (m) => m.saves.length === 1);
    expect(lobby.saves[0].name).toBe('Mein Test Spiel');
    expect(lobby.saves[0].players.map((p) => p.classId).sort()).toEqual(['human', 'orc']);
    expect(readdirSync(SAVE_DIR)).toHaveLength(1);
    a.close(); b.close();

    // A fresh server: Bob joins first (host), loads; Alice joins later and takes over her old slot.
    const port2 = randomPort() + 1000;
    servers.push(await startServer(port2, { SAVE_DIR }));
    const { c: b2 } = await joinAs(port2, 'Bob');
    const l2 = await b2.wait('lobby', (m) => m.saves.length === 1);
    b2.send({ t: 'load', id: l2.saves[0].id });
    const rw = await b2.wait('welcome', (w) => w.you === wb.you);
    expect(rw.you).toBe(wb.you);
    const g2 = await b2.wait('game');
    expect(g2.state.towers).toHaveLength(1);
    expect(g2.state.players.find((p) => p.id === wb.you)!.classId).toBe('orc');
    await b2.wait('snap', (s) => s.paused === 'Bob');

    const { c: a2, w: wa2 } = await joinAs(port2, 'Alice');
    expect(wa2.you).toBe(wa.you);
    const ga = await a2.wait('game');
    expect(ga.state.towers[0].owner).toBe(wa.you);
    const l3 = await a2.wait('lobby', (m) => m.players.some((p) => p.id === wa.you && !p.spectator && p.classId === 'human'));
    expect(l3.phase).toBe('playing');

    // Delete is only possible in the lobby.
    b2.send({ t: 'deleteSave', id: l2.saves[0].id });
    await b2.wait('error', (m) => m.msg.includes('Host'));
    a2.close(); b2.close();
  }, 40000);
});
