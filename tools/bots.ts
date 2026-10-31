// Network bots for load testing / filling a LAN lobby.
// Usage: npx tsx tools/bots.ts [count=15] [url=ws://localhost:3000/ws] [--start]
import WebSocket from 'ws';
import { CLASSES, CLASS_BY_ID, TOWER_BY_ID } from '../shared/data/classes';
import { MAP_H, MAP_W, PATH, SECTION_OF, cellIndex } from '../shared/map';
import type { ClientMsg, ServerMsg, TowerInfo } from '../shared/protocol';

const count = Number(process.argv[2] ?? 15);
const url = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : 'ws://localhost:3000/ws';
const autoStart = process.argv.includes('--start');

let bytes = 0, msgs = 0, snaps = 0, maxGap = 0, lastSnap = 0;

function bot(i: number) {
  const ws = new WebSocket(url);
  const send = (m: ClientMsg) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(m));
  const cls = CLASSES[i % CLASSES.length].id;
  let you = '';
  let owners: string[] = [];
  const towers = new Map<number, TowerInfo>();
  let gold = 0, lumber = 0, timer = 0;
  let free: { cx: number; cy: number }[] = [];

  ws.on('open', () => send({ t: 'hello', name: `Bot${i + 1}` }));
  ws.on('message', (raw) => {
    if (i === 0) { bytes += (raw as Buffer).length; msgs++; }
    const msg = JSON.parse(String(raw)) as ServerMsg;
    switch (msg.t) {
      case 'welcome':
        you = msg.you;
        send({ t: 'setClass', classId: cls });
        setTimeout(() => send({ t: 'lobbyReady', ready: true }), 300);
        break;
      case 'lobby':
        if (autoStart && msg.phase === 'lobby' && msg.hostId === you) {
          const others = msg.players.filter((p) => !p.spectator && p.connected);
          if (others.length >= count && others.every((p) => p.classId)) setTimeout(() => send({ t: 'start' }), 500);
        }
        break;
      case 'game':
        owners = msg.state.sectionOwners;
        free = [];
        for (let cy = 0; cy < MAP_H; cy++) for (let cx = 0; cx < MAP_W; cx++) {
          const s = SECTION_OF[cellIndex(cx, cy)];
          if (s >= 0 && owners[s] === you) free.push({ cx, cy });
        }
        free.sort((a, b) => PATH.project(a.cx + 0.5, a.cy + 0.5).dist - PATH.project(b.cx + 0.5, b.cy + 0.5).dist);
        break;
      case 'snap': {
        if (i === 0) {
          const now = performance.now();
          if (lastSnap) maxGap = Math.max(maxGap, now - lastSnap);
          lastSnap = now;
          snaps++;
        }
        const me = msg.players.find((p) => p.id === you);
        if (me) { gold = me.gold; lumber = me.lumber; }
        timer = msg.timer;
        break;
      }
      case 'tower': towers.set(msg.tower.id, msg.tower); break;
      case 'towerGone': towers.delete(msg.id); break;
    }
  });

  setInterval(() => {
    if (!free.length && !towers.size) return;
    const mine = [...towers.values()].filter((t) => t.owner === you);
    const c = CLASS_BY_ID[cls];
    if (mine.length > 5 && Math.random() < 0.5) {
      const t = mine[Math.floor(Math.random() * mine.length)];
      const def = TOWER_BY_ID[t.def];
      if (t.level < 2 && gold >= def.upCost[t.level] && lumber >= def.upLumber[t.level]) { send({ t: 'upgrade', id: t.id }); return; }
    }
    const options = c.towers.filter((d) => !d.requires && d.cost <= gold);
    const occupied = new Set([...towers.values()].map((t) => `${t.cx},${t.cy}`));
    const cell = free.find((f) => !occupied.has(`${f.cx},${f.cy}`));
    if (options.length && cell) send({ t: 'build', def: options[Math.floor(Math.random() * options.length)].id, cx: cell.cx, cy: cell.cy });
    if (timer > 3) send({ t: 'callWave', ready: true });
  }, 700);
}

for (let i = 0; i < count; i++) setTimeout(() => bot(i), i * 100);
setInterval(() => {
  console.log(`[bot1] ${msgs} msgs, ${(bytes / 1024).toFixed(0)} KiB received, ${snaps} snapshots, max snapshot gap ${maxGap.toFixed(0)} ms`);
  bytes = 0; msgs = 0; snaps = 0; maxGap = 0;
}, 5000);
