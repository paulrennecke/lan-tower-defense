import type { ChildProcess } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SECTION_OF, MAP_H, MAP_W, cellIndex, setActiveMap } from '../shared/map';
import type { RoomInfo } from '../shared/protocol';
import { Client, randomPort, startServer } from './helpers';

const DATA_DIR = mkdtempSync(join(tmpdir(), 'td-online-'));
const PORT = randomPort();
const BASE = `http://127.0.0.1:${PORT}`;
let server: ChildProcess;
const clients: Client[] = [];

beforeAll(async () => { server = await startServer(PORT, { TD_MODE: 'online', DATA_DIR, MAX_ROOMS_PER_IP: '50' }); });
afterAll(() => {
  for (const c of clients) c.close();
  server?.kill();
  rmSync(DATA_DIR, { recursive: true, force: true });
});

async function createRoom(name: string, isPublic = true): Promise<string> {
  const res = await fetch(`${BASE}/api/rooms`, { method: 'POST', body: JSON.stringify({ name, public: isPublic }) });
  expect(res.status).toBe(201);
  return (await res.json()).code;
}

async function joinRoom(code: string, name: string, owner?: string) {
  const c = new Client(PORT, `?room=${code}`);
  clients.push(c);
  await c.open();
  c.send({ t: 'hello', name, owner });
  const w = await c.wait('welcome');
  return { c, w };
}

function buildCell(map: string) {
  setActiveMap(map);
  for (let cy = 0; cy < MAP_H; cy++) for (let cx = 0; cx < MAP_W; cx++) {
    if (SECTION_OF[cellIndex(cx, cy)] >= 0) return { cx, cy };
  }
  throw new Error('no cell');
}

const OWNER_A = 'owner-aaaaaaaaaaaaaaaa';
const OWNER_B = 'owner-bbbbbbbbbbbbbbbb';

describe('room manager', () => {
  it('removes abandoned rooms and respects the room limit', async () => {
    const { RoomManager } = await import('../server/rooms');
    const { HighscoreStore, SaveStore } = await import('../server/store');
    const mgr = new RoomManager({
      highscores: new HighscoreStore(join(DATA_DIR, 'hs-unit.json')), saves: new SaveStore(join(DATA_DIR, 'unit'), true),
      maxRooms: 2, emptyTtl: 1000, msgRate: 10,
    });
    const r1 = mgr.create('  A  <x> ', true)!;
    expect(r1.name).toBe('A x');
    expect(mgr.create('', false)!.name).toMatch(/^Raum [A-Z2-9]{4}$/);
    expect(mgr.create('C', true)).toBeNull();
    expect(mgr.get(r1.code!.toLowerCase())).toBe(r1);
    mgr.sweep(Date.now() + 500);
    expect(mgr.size).toBe(2);
    mgr.sweep(Date.now() + 2000);
    expect(mgr.size).toBe(0);
  });
});

describe('online mode', () => {
  it('reports the mode and rejects unknown rooms', async () => {
    expect(await (await fetch(`${BASE}/api/config`)).json()).toMatchObject({ mode: 'online', version: expect.any(String) });
    const c = new Client(PORT, '?room=ZZZZ');
    clients.push(c);
    await c.open();
    await c.wait('noRoom');
    const none = new Client(PORT);
    clients.push(none);
    await none.open();
    await none.wait('noRoom');
  });

  it('lists only public rooms with players', async () => {
    const pub = await createRoom('Öffentlich <b>');
    const priv = await createRoom('Geheim', false);
    let list: RoomInfo[] = (await (await fetch(`${BASE}/api/rooms`)).json()).rooms;
    expect(list.some((r) => r.code === pub)).toBe(false); // nobody joined yet
    await joinRoom(pub, 'Alice');
    await joinRoom(priv, 'Bob');
    list = (await (await fetch(`${BASE}/api/rooms`)).json()).rooms;
    const mine = list.find((r) => r.code === pub)!;
    expect(mine.name).toBe('Öffentlich b');
    expect(mine.players).toBe(1);
    expect(list.some((r) => r.code === priv)).toBe(false);
    // Private rooms can still be joined and looked up by code.
    const info = await (await fetch(`${BASE}/api/rooms/${priv}`)).json();
    expect(info.public).toBe(false);
  });

  it('runs two rooms with different maps at the same time and keeps saves per owner', async () => {
    const r1 = await createRoom('Raum Eins');
    const r2 = await createRoom('Raum Zwei');
    const { c: a, w: wa } = await joinRoom(r1, 'Alice', OWNER_A);
    const { c: b, w: wb } = await joinRoom(r2, 'Bob', OWNER_B);
    const lobbyA = await a.wait('lobby');
    expect(lobbyA.room?.code).toBe(r1);
    expect(lobbyA.hostId).toBe(wa.you);
    // Players of one room never see the other room.
    expect(lobbyA.players.map((p) => p.name)).toEqual(['Alice']);

    a.send({ t: 'setClass', classId: 'human' });
    b.send({ t: 'setClass', classId: 'human' });
    b.send({ t: 'setMap', id: 'nordend' });
    await b.wait('lobby', (m) => m.map === 'nordend');
    a.send({ t: 'start' });
    b.send({ t: 'start' });
    const ga = await a.wait('game');
    const gb = await b.wait('game');
    expect(ga.state.map).toBe('x9');
    expect(gb.state.map).toBe('nordend');

    const ca = buildCell('x9'), cb = buildCell('nordend');
    a.send({ t: 'build', def: 'h_watch', cx: ca.cx, cy: ca.cy });
    b.send({ t: 'build', def: 'h_watch', cx: cb.cx, cy: cb.cy });
    expect((await a.wait('tower')).tower.owner).toBe(wa.you);
    expect((await b.wait('tower')).tower.owner).toBe(wb.you);
    expect(a.msgs.some((m) => m.t === 'tower' && m.tower.owner === wb.you)).toBe(false);
    await a.wait('snap', (s) => s.time > 1);
    await b.wait('snap', (s) => s.time > 1);

    a.send({ t: 'save', name: 'Alices Spiel' });
    await a.wait('lobby', (m) => m.saves.length === 1);
    expect(readdirSync(join(DATA_DIR, 'saves'))).toHaveLength(1);
    // Bob (other owner) has no saves; a new connection with Alice's key sees hers.
    expect(b.msgs.filter((m) => m.t === 'lobby').every((m) => m.saves.length === 0)).toBe(true);
    const r3 = await createRoom('Raum Drei');
    const { c: a2 } = await joinRoom(r3, 'Alice2', OWNER_A);
    expect((await a2.wait('lobby')).saves.map((s) => s.name)).toEqual(['Alices Spiel']);
    const { c: anon } = await joinRoom(r3, 'Anon');
    expect((await anon.wait('lobby')).saves).toEqual([]);
  });
});
