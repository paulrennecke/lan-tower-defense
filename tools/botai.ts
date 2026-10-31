import { CLASS_BY_ID, towerDps, type TowerDef } from '../shared/data/classes';
import { PATH, MAP_W, MAP_H, isBuildable, cellIndex, SECTION_OF } from '../shared/map';
import type { Game } from '../server/game';

/** Number of path sample points within range of a cell – a simple placement heuristic. */
const coverageCache = new Map<string, number>();
export function pathCoverage(cx: number, cy: number, range: number): number {
  const key = `${cx},${cy},${range}`;
  let v = coverageCache.get(key);
  if (v === undefined) {
    v = 0;
    for (let d = 0; d < PATH.total; d += 0.5) {
      const p = PATH.posAt(d);
      if (Math.hypot(p.x - cx - 0.5, p.y - cy - 0.5) <= range) v++;
    }
    coverageCache.set(key, v);
  }
  return v;
}

const isSupport = (d: TowerDef) => !!(d.levels[0].aura || d.levels[0].income);
const value = (d: TowerDef, lvl: number) => {
  const s = d.levels[lvl];
  if (s.aura) return 25 + lvl * 15;
  if (s.income) return s.income * 0.8;
  return towerDps(s) * (1 + (s.splash ?? 0) * 0.4 + (s.chain ?? 0) * 0.3 + (s.multi ?? 1) * 0.1 + (s.slow ?? 0)) * (s.ground ? 1 : 0.35);
};

/** Greedy bot used for balance simulations and load tests: research, build, upgrade by value per gold. */
export function botAct(game: Game, pid: string, rnd: () => number = Math.random) {
  const p = game.players.get(pid)!;
  const cls = CLASS_BY_ID[p.classId];
  const towers = game.towersOf(pid);
  const totalValue = towers.reduce((s, t) => s + value(cls.towers.find((d) => d.id === t.def)!, t.level), 0);

  type Action = { score: number; cost: number; run: () => void; tag?: 'air' | 'detect' };
  const actions: Action[] = [];
  for (const r of cls.research) {
    const lvl = p.research[r.id] ?? 0;
    if (lvl >= r.maxLevel || p.lumber < r.lumber[lvl] || game.wave < 5) continue;
    const e = r.perLevel;
    const gain = e.unlock ? totalValue * 0.5 + 100 : totalValue * ((e.dmgPct ?? 0) + (e.speedPct ?? 0) + (e.rangePct ?? 0) * 0.8 + (e.crit ?? 0) + (e.dotPct ?? 0) * 0.2) + (e.income ?? 0) + (e.bounty ?? 0) * 15;
    actions.push({ cost: r.gold[lvl], score: (gain / r.gold[lvl]) * (0.8 + rnd() * 0.4), run: () => game.research(pid, r.id) });
  }
  const defsOwned = towers.map((t) => cls.towers.find((x) => x.id === t.def)!);
  const hasDetect = defsOwned.some((d) => d.levels[0].detect);
  const airCount = defsOwned.filter((d) => d.levels[0].air && towerDps(d.levels[0]) > 0).length;
  const supports = defsOwned.filter(isSupport).length;

  for (const t of towers) {
    if (t.level >= 2) continue;
    const def = cls.towers.find((d) => d.id === t.def)!;
    if (p.lumber < def.upLumber[t.level]) continue;
    const cost = def.upCost[t.level];
    actions.push({ cost, score: ((value(def, t.level + 1) - value(def, t.level)) / cost) * (0.8 + rnd() * 0.4), run: () => game.upgrade(pid, t.id) });
  }
  for (const def of cls.towers) {
    if (def.requires && !p.research[def.requires]) continue;
    if (p.lumber < def.lumber) continue;
    if (isSupport(def) && supports >= Math.max(1, Math.floor(towers.length / 6))) continue;
    let s = (value(def, 0) / def.cost) * (0.8 + rnd() * 0.4) * 1.2;
    if (def.lumber) s *= 3;
    if (!hasDetect && def.levels[0].detect && game.wave >= 4) s *= 5;
    if (airCount < Math.max(2, towers.length / 3) && def.levels[0].air) s *= 2;
    actions.push({ cost: def.cost, score: s, run: () => buildBest(game, pid, def), tag: def.levels[0].detect ? 'detect' : def.levels[0].air && towerDps(def.levels[0]) > 0 ? 'air' : undefined });
  }
  if (!actions.length) return;
  actions.sort((a, b) => b.score - a.score);
  const needAir = airCount < 2 + Math.floor(towers.length / 5) && game.wave >= 1;
  const needDetect = !hasDetect && game.wave >= 5;
  const urgent = actions.filter((a) => (needDetect && a.tag === 'detect') || (needAir && a.tag === 'air'));
  const list = urgent.length ? urgent : actions;
  const affordable = list.filter((a) => a.cost <= p.gold);
  if (affordable.length && affordable[0].score >= list[0].score * 0.6) affordable[0].run();
}

function buildBest(game: Game, pid: string, def: TowerDef) {
  const range = def.levels[0].range || 4;
  let best: { cx: number; cy: number; score: number } | null = null;
  for (let cy = 0; cy < MAP_H; cy++) {
    for (let cx = 0; cx < MAP_W; cx++) {
      if (!isBuildable(cx, cy) || game.sectionOwners[SECTION_OF[cellIndex(cx, cy)]] !== pid) continue;
      if (game.canBuildAt(pid, cx, cy)) continue;
      const score = pathCoverage(cx, cy, range) + Math.random();
      if (!best || score > best.score) best = { cx, cy, score };
    }
  }
  if (best) game.build(pid, def.id, best.cx, best.cy);
}
