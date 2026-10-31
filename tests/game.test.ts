import { describe, expect, it } from 'vitest';
import { Game, SELL_REFUND } from '../server/game';
import { TOWER_BY_ID } from '../shared/data/classes';
import { FIRST_COUNTDOWN, START_GOLD, START_LIVES, VICTORY_WAVE } from '../shared/data/waves';
import { MAP_H, MAP_W, PATH, SECTION_OF, cellIndex } from '../shared/map';
import { simulate } from '../tools/balance';

const mkGame = (classes: string[], hooks = {}) =>
  new Game(classes.map((c, i) => ({ id: 'p' + i, name: 'P' + i, color: 0, classId: c })), hooks);

/** Own buildable cell closest to the given path distance. */
function cellNear(g: Game, pid: string, d: number) {
  const target = PATH.posAt(d);
  let best: { cx: number; cy: number } | null = null, bestD = Infinity;
  for (let cy = 0; cy < MAP_H; cy++) for (let cx = 0; cx < MAP_W; cx++) {
    const s = SECTION_OF[cellIndex(cx, cy)];
    if (s < 0 || g.sectionOwners[s] !== pid || g.canBuildAt(pid, cx, cy)) continue;
    const dist = Math.hypot(cx + 0.5 - target.x, cy + 0.5 - target.y);
    if (dist < bestD) { bestD = dist; best = { cx, cy }; }
  }
  return best!;
}

const run = (g: Game, seconds: number) => { for (let t = 0; t < seconds; t += 0.05) g.tick(0.05); };

describe('Game commands', () => {
  it('validates building', () => {
    const g = mkGame(['human', 'orc']);
    const own = cellNear(g, 'p0', 10);
    const foreign = cellNear(g, 'p1', 10);
    expect(g.build('p0', 'o_spear', own.cx, own.cy)).toMatch(/Klasse/);
    expect(g.build('p0', 'h_watch', foreign.cx, foreign.cy)).toMatch(/Bauabschnitt/);
    expect(g.build('p0', 'h_mage', own.cx, own.cy)).toMatch(/erforschen/i);
    expect(g.build('p0', 'h_watch', 2, 2)).toMatch(/nicht gebaut/);
    expect(g.build('p0', 'h_watch', own.cx, own.cy)).toBeNull();
    expect(g.build('p0', 'h_watch', own.cx, own.cy)).toMatch(/belegt/);
    expect(g.players.get('p0')!.gold).toBe(START_GOLD - TOWER_BY_ID.h_watch.cost);
    g.players.get('p0')!.gold = 10;
    const other = cellNear(g, 'p0', 20);
    expect(g.build('p0', 'h_watch', other.cx, other.cy)).toMatch(/Gold/);
  });

  it('upgrades and sells with refund', () => {
    const g = mkGame(['human']);
    const c = cellNear(g, 'p0', 10);
    g.build('p0', 'h_watch', c.cx, c.cy);
    const t = [...g.towers.values()][0];
    expect(g.upgrade('p0', t.id)).toBeNull();
    expect(t.level).toBe(1);
    const invested = TOWER_BY_ID.h_watch.cost + TOWER_BY_ID.h_watch.upCost[0];
    const gold = g.players.get('p0')!.gold;
    expect(g.sell('p0', t.id)).toBeNull();
    expect(g.players.get('p0')!.gold).toBe(gold + Math.floor(invested * SELL_REFUND));
    expect(g.towers.size).toBe(0);
  });

  it('research unlocks ultimate towers and costs lumber', () => {
    const g = mkGame(['human']);
    const p = g.players.get('p0')!;
    p.gold = 2000;
    expect(g.research('p0', 'h_r_mage')).toMatch(/Holz/);
    p.lumber = 10;
    expect(g.research('p0', 'h_r_mage')).toBeNull();
    expect(g.research('p0', 'h_r_mage')).toMatch(/vollständig/);
    const c = cellNear(g, 'p0', 10);
    expect(g.build('p0', 'h_mage', c.cx, c.cy)).toBeNull();
    expect(p.lumber).toBe(10 - 3 - 3);
  });

  it('ready vote shortens the countdown', () => {
    const g = mkGame(['human', 'orc']);
    expect(g.timer).toBe(FIRST_COUNTDOWN);
    g.setReady('p0', true);
    g.tick(0.05);
    expect(g.timer).toBeGreaterThan(10);
    g.setReady('p1', true);
    g.tick(0.05);
    expect(g.timer).toBeLessThanOrEqual(3);
    run(g, 3.1);
    expect(g.wave).toBe(1);
    // Disconnected players do not block the vote.
    g.setConnected('p1', false);
  });
});

describe('Game simulation', () => {
  it('kill gold is shared by all players and leaks cost lives', () => {
    let over = false;
    const g = mkGame(['human', 'orc'], { gameOver: () => { over = true; } });
    g.startWave();
    const goldBefore = g.players.get('p1')!.gold;
    g.players.get('p0')!.gold = 10000;
    for (const d of [3, 8, 13]) { const c = cellNear(g, 'p0', d); g.build('p0', 'h_watch', c.cx, c.cy); }
    run(g, 15);
    expect(g.players.get('p0')!.kills).toBeGreaterThan(0);
    expect(g.players.get('p1')!.gold).toBeGreaterThan(goldBefore);
    // Let everything else leak.
    for (const t of [...g.towers.values()]) g.sell('p0', t.id);
    g.lives = 2;
    run(g, 120);
    expect(g.lives).toBe(0);
    expect(over).toBe(true);
  });

  it('magic towers cannot damage magic immune enemies', () => {
    const g = mkGame(['human']);
    const c = cellNear(g, 'p0', 5);
    g.players.get('p0')!.gold = 10000;
    g.build('p0', 'h_arcane', c.cx, c.cy);
    const golem = g.spawnEnemy('golem', 5, 1, 0);
    run(g, 5);
    expect(golem.hp).toBe(golem.maxHp);
  });

  it('invisible enemies need detection', () => {
    const g = mkGame(['human']);
    g.players.get('p0')!.gold = 10000;
    const c = cellNear(g, 'p0', 5);
    g.build('p0', 'h_watch', c.cx, c.cy);
    const shade = g.spawnEnemy('shade', 5, 1, 0);
    run(g, 4);
    expect(shade.hp).toBe(shade.maxHp);
    const c2 = cellNear(g, 'p0', 12);
    g.build('p0', 'h_arcane', c2.cx, c2.cy);
    const shade2 = g.spawnEnemy('shade', 5, 1, 0);
    run(g, 4);
    expect(shade2.hp).toBeLessThan(shade2.maxHp);
  });

  it('splitting enemies spawn children on death', () => {
    const g = mkGame(['human']);
    const slime = g.spawnEnemy('slime', 1, 1, 20);
    g.players.get('p0')!.gold = 10000;
    const c = cellNear(g, 'p0', 21);
    g.build('p0', 'h_cannon', c.cx, c.cy);
    let sawChildren = false;
    for (let i = 0; i < 100 && !sawChildren; i++) {
      g.tick(0.05);
      sawChildren = g.enemies.some((e) => e.def.id === 'slimelet');
    }
    expect(slime.dead).toBe(true);
    expect(sawChildren).toBe(true);
  });

  it('announces victory after the last wave and continues endlessly', () => {
    const events: string[] = [];
    const g = mkGame(['human'], { event: (k: string) => events.push(k) });
    g.wave = VICTORY_WAVE - 1;
    g.startWave();
    while (g.pendingSpawns > 0) { g.tick(0.05); g.enemies.forEach((e) => { e.hp = 0.001; }); }
    g.enemies.length = 0;
    run(g, 0.2);
    expect(g.victory).toBe(true);
    expect(events).toContain('victory');
    g.startWave();
    expect(g.wave).toBe(VICTORY_WAVE + 1);
    expect(g.over).toBe(false);
    expect(g.lives).toBe(START_LIVES);
  });

  it('bots survive the first waves (balance smoke test)', () => {
    const r = simulate(2, 8);
    expect(r.wave).toBeGreaterThanOrEqual(8);
    expect(r.lives).toBeGreaterThan(30);
  });
});

describe('Pause, save & load', () => {
  it('pause freezes the simulation', () => {
    const g = mkGame(['human']);
    g.startWave();
    run(g, 2);
    g.paused = 'P0';
    const snap = JSON.stringify(g.enemies.map((e) => [e.id, e.d, e.hp]));
    const t = g.time;
    run(g, 5);
    expect(g.time).toBe(t);
    expect(JSON.stringify(g.enemies.map((e) => [e.id, e.d, e.hp]))).toBe(snap);
    expect(g.snapshot().paused).toBe('P0');
    g.paused = null;
    run(g, 1);
    expect(g.time).toBeGreaterThan(t);
  });

  it('round-trips a running game through JSON', () => {
    const g = mkGame(['human', 'undead']);
    g.players.get('p0')!.gold = 10000;
    g.players.get('p1')!.gold = 10000;
    g.players.get('p0')!.lumber = 10;
    g.research('p0', 'h_r_mage');
    for (const d of [4, 9, 14]) { const c = cellNear(g, 'p0', d); g.build('p0', 'h_watch', c.cx, c.cy); }
    const c1 = cellNear(g, 'p1', 6);
    g.build('p1', 'u_plague', c1.cx, c1.cy);
    g.upgrade('p0', [...g.towers.keys()][0]);
    g.startWave();
    run(g, 4);
    expect(g.enemies.length + g.pendingSpawns).toBeGreaterThan(0);

    const data = JSON.parse(JSON.stringify(g.toSave()));
    const r = Game.fromSave(data, {}, 'Host');
    expect(r.paused).toBe('Host');
    expect(r.time).toBe(g.time);
    expect(r.wave).toBe(g.wave);
    expect(r.lives).toBe(g.lives);
    expect(r.sectionOwners).toEqual(g.sectionOwners);
    expect(r.fullState('p0', new Map(), 0).towers).toEqual(g.fullState('p0', new Map(), 0).towers);
    expect(r.playerStats().map((p) => ({ ...p, ready: false }))).toEqual(g.playerStats().map((p) => ({ ...p, ready: false })));
    const { fx: _a, paused: _b, ...rs } = r.snapshot();
    const { fx: _c, paused: _d, ...gs } = g.snapshot();
    expect(rs).toEqual(gs);
    expect(r.pendingSpawns).toBe(g.pendingSpawns);
    expect([...r.players.values()].every((p) => !p.connected)).toBe(true);

    // Occupancy and stats are rebuilt: building on an occupied cell fails, the restored game keeps running.
    const t = [...r.towers.values()][0];
    expect(r.build(t.owner, t.def, t.cx, t.cy)).toMatch(/belegt/);
    r.setConnected('p0', true);
    r.paused = null;
    run(r, 30);
    expect(r.time).toBeGreaterThan(g.time + 29);
    expect(r.players.get('p0')!.kills).toBeGreaterThan(0);
  });

  it('rejects invalid saves', () => {
    expect(() => Game.fromSave({ version: 99 } as never)).toThrow(/Spielstand/);
  });
});
