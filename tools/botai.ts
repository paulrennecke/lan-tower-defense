import { CLASS_BY_ID, towerDps, type TowerDef } from '../shared/data/classes';
import { GATE, MAP_DEF, MAP_H, MAP_ID, MAP_W, SECTION_OF, SPAWNS, cellIndex, computeFlow, lanesOf, nextCell, traceRoute } from '../shared/map';
import type { Game } from '../server/game';

/**
 * Serpentine maze plan for a build zone: walls across the creep flow every third row/column, each leaving a
 * one-cell gap on alternating sides – the classic Wintermaul maze.
 */
const planCache = new Map<string, number[][]>();
let emptyFlow: { map: string; flow: Float32Array } | null = null;
export function zonePlan(zone: number): number[][] {
  const key = MAP_ID + ':' + zone;
  let plan = planCache.get(key);
  if (plan) return plan;
  if (emptyFlow?.map !== MAP_ID) emptyFlow = { map: MAP_ID, flow: computeFlow(new Uint8Array(MAP_W * MAP_H)) };
  const empty = new Uint8Array(MAP_W * MAP_H);
  const cells: number[] = [];
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1, fx = 0, fy = 0;
  for (let i = 0; i < SECTION_OF.length; i++) {
    if (SECTION_OF[i] !== zone) continue;
    cells.push(i);
    const x = i % MAP_W, y = Math.floor(i / MAP_W);
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    const j = nextCell(emptyFlow.flow, empty, x, y);
    if (j >= 0) { fx += (j % MAP_W) - x; fy += Math.floor(j / MAP_W) - y; }
  }
  const inZone = new Set(cells);
  const vertical = Math.abs(fy) >= Math.abs(fx);
  plan = [];
  const [a0, a1] = vertical ? [y0, y1] : [x0, x1];
  for (let k = a0 + 1, w = 0; k <= a1 - 1; k += 3, w++) {
    const line: number[] = [];
    if (vertical) { for (let x = x0; x <= x1; x++) if (inZone.has(cellIndex(x, k))) line.push(cellIndex(x, k)); }
    else { for (let y = y0; y <= y1; y++) if (inZone.has(cellIndex(k, y))) line.push(cellIndex(k, y)); }
    if (line.length < 3) continue;
    // Leave a gap at alternating ends and fill from the closed end towards the gap.
    if ((w + zone) % 2) line.reverse();
    plan.push(line.slice(0, -1));
  }
  planCache.set(key, plan);
  return plan;
}

/** Cells where building failed (creep in the way / would block) – skipped for the rest of the wave. */
const failed = new WeakMap<Game, Map<number, number>>();

const isSupport = (d: TowerDef) => !!(d.levels[0].aura || d.levels[0].income);
const isBlock = (d: TowerDef) => d.shape === 'block';
const value = (d: TowerDef, lvl: number) => {
  const s = d.levels[lvl];
  if (s.aura) return 25 + lvl * 15;
  if (s.income) return s.income * 0.8;
  return towerDps(s) * (1 + (s.splash ?? 0) * 0.4 + (s.chain ?? 0) * 0.3 + (s.multi ?? 1) * 0.1 + (s.slow ?? 0)) * (s.ground ? 1 : 0.35);
};

/** Greedy bot used for balance simulations and load tests: maze, research, build, upgrade by value per gold. */
export function botAct(game: Game, pid: string, rnd: () => number = Math.random) {
  const p = game.players.get(pid)!;
  const cls = CLASS_BY_ID[p.classId];
  const towers = game.towersOf(pid);
  const zones = game.sectionOwners.map((o, s) => (o === pid ? s : -1)).filter((s) => s >= 0);
  const priority: number[] = [];
  for (const [x0, y0, x1, y1] of MAP_DEF.botWalls ?? []) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (zones.includes(SECTION_OF[cellIndex(x, y)])) priority.push(cellIndex(x, y));
  }
  const plan = [...(priority.length ? [priority] : []), ...zones.flatMap((z) => zonePlan(z))];

  // 1) Keep the maze walls growing: cheap blocks on the first unfinished wall cells (about 3 per attack tower).
  const blockDef = cls.towers.find(isBlock);
  const blocks = towers.filter((t) => t.def === blockDef?.id).length;
  const attackers = towers.length - blocks;
  if (blockDef && p.gold >= blockDef.cost && blocks < 12 + attackers * 4) {
    let fails = failed.get(game);
    if (!fails) failed.set(game, (fails = new Map()));
    for (const wall of plan) {
      const cell = wall.find((c) => !game.blocked[c] && fails!.get(c) !== game.wave);
      if (cell === undefined) continue;
      if (!game.build(pid, blockDef.id, cell % MAP_W, Math.floor(cell / MAP_W))) break;
      fails.set(cell, game.wave);
    }
  }

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
  const defsOwned = towers.map((t) => cls.towers.find((x) => x.id === t.def)!).filter((d) => !isBlock(d));
  const hasDetect = defsOwned.some((d) => d.levels[0].detect);
  const airCount = defsOwned.filter((d) => d.levels[0].air && towerDps(d.levels[0]) > 0).length;
  const supports = defsOwned.filter(isSupport).length;

  for (const t of towers) {
    const def = cls.towers.find((d) => d.id === t.def)!;
    if (t.level >= (def.maxLevel ?? 2)) continue;
    if (p.lumber < def.upLumber[t.level]) continue;
    const cost = def.upCost[t.level];
    actions.push({ cost, score: ((value(def, t.level + 1) - value(def, t.level)) / cost) * (0.8 + rnd() * 0.4), run: () => game.upgrade(pid, t.id) });
  }
  for (const def of cls.towers) {
    if (isBlock(def)) continue;
    if (def.requires && !p.research[def.requires]) continue;
    if (p.lumber < def.lumber) continue;
    if (isSupport(def) && supports >= Math.max(1, Math.floor(defsOwned.length / 6))) continue;
    let s = (value(def, 0) / def.cost) * (0.8 + rnd() * 0.4) * 1.2;
    if (def.lumber) s *= 3;
    if (!hasDetect && def.levels[0].detect && game.wave >= 4) s *= 5;
    if (airCount < Math.max(2, defsOwned.length / 3) && def.levels[0].air) s *= 2;
    actions.push({ cost: def.cost, score: s, run: () => buildBest(game, pid, def, plan), tag: def.levels[0].detect ? 'detect' : def.levels[0].air && towerDps(def.levels[0]) > 0 ? 'air' : undefined });
  }
  if (!actions.length) return;
  actions.sort((a, b) => b.score - a.score);
  const needAir = airCount < 2 + Math.floor(defsOwned.length / 5) && game.wave >= 1;
  const needDetect = !hasDetect && game.wave >= 5;
  const urgent = actions.filter((a) => (needDetect && a.tag === 'detect') || (needAir && a.tag === 'air'));
  const list = urgent.length ? urgent : actions;
  const affordable = list.filter((a) => a.cost <= p.gold);
  if (affordable.length && affordable[0].score >= list[0].score * 0.6) affordable[0].run();
}

/** Attack towers go onto maze wall cells (or replace a block there) where they cover the most route. */
function buildBest(game: Game, pid: string, def: TowerDef, plan: number[][]) {
  const range = def.levels[0].range || 4;
  const lanes = lanesOf(game.sectionOwners);
  const ground = lanes.map((l) => traceRoute(game.flow, game.blocked, SPAWNS[l].x, SPAWNS[l].y));
  // Flyers go straight from the portal to the gate – air towers belong next to that line.
  const flight = lanes.map((l) => {
    const s = SPAWNS[l], pts: { x: number; y: number }[] = [];
    const n = Math.ceil(Math.hypot(GATE.x - s.x, GATE.y - s.y));
    for (let i = 0; i <= n; i++) pts.push({ x: s.x + ((GATE.x - s.x) * i) / n, y: s.y + ((GATE.y - s.y) * i) / n });
    return pts;
  });
  const st = def.levels[0];
  const routes = st.ground ? (st.air ? [...ground, ...flight] : ground) : flight;
  const cover = (c: number) => {
    const x = (c % MAP_W) + 0.5, y = Math.floor(c / MAP_W) + 0.5;
    let n = 0;
    for (const r of routes) for (const pt of r) if (Math.hypot(pt.x - x, pt.y - y) <= range) n++;
    return n;
  };
  const blockId = CLASS_BY_ID[game.players.get(pid)!.classId].towers.find(isBlock)?.id;
  const occupant = (c: number) => game.towersOf(pid).find((t) => cellIndex(t.cx, t.cy) === c);
  let best: { c: number; score: number; replace?: number } | null = null;
  for (const c of plan.flat()) {
    const occ = occupant(c);
    if (occ && occ.def !== blockId) continue;
    if (!occ && SECTION_OF[c] < 0) continue;
    const score = cover(c) + Math.random();
    if (!best || score > best.score) best = { c, score, replace: occ?.id };
  }
  if (!best) return;
  if (best.replace !== undefined) game.sell(pid, best.replace);
  // If the tower cannot be built (e.g. a creep stands there), put the block back.
  if (game.build(pid, def.id, best.c % MAP_W, Math.floor(best.c / MAP_W)) && best.replace !== undefined && blockId) {
    game.build(pid, blockId, best.c % MAP_W, Math.floor(best.c / MAP_W));
  }
}
