import { CLASSES } from '../shared/data/classes';
import { Game } from '../server/game';
import { botAct } from './botai';

/** Headless balance simulation: `npx tsx tools/balance.ts [players] [maxWave]` */
export function simulate(players: number, maxWave = 45, classes?: string[]) {
  const list = Array.from({ length: players }, (_, i) => ({
    id: 'p' + i, name: 'Bot' + i, color: 0xffffff, classId: classes?.[i % classes.length] ?? CLASSES[i % CLASSES.length].id,
  }));
  let over = false;
  const game = new Game(list, { gameOver: () => { over = true; } });
  const dt = 0.05;
  let t = 0;
  while (!over && game.wave <= maxWave) {
    game.tick(dt);
    t += dt;
    if (Math.round(t / dt) % 10 === 0) for (const p of list) botAct(game, p.id);
    if (game.pendingSpawns === 0 && game.enemyCount === 0) for (const p of list) game.setReady(p.id, true);
    game.snapshot();
  }
  return { wave: game.wave, lives: game.lives, victory: game.victory, towers: game.towers.size, time: Math.round(t) };
}

if (process.argv[1]?.endsWith('balance.ts')) {
  const n = Number(process.argv[2] ?? 1);
  const max = Number(process.argv[3] ?? 45);
  for (const cls of process.argv[4] ? [process.argv[4]] : CLASSES.map((c) => c.id)) {
    const r = simulate(n, max, n === 1 ? [cls] : undefined);
    console.log(n === 1 ? cls.padEnd(10) : `mixed(${n})`.padEnd(10), JSON.stringify(r));
    if (n > 1) break;
  }
}
