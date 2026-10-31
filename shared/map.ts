/**
 * Active map shared by server and client. All logic coordinates are in cell units.
 *
 * There is no fixed path: creeps walk the shortest route around the towers (flow field), so players build mazes.
 * The exported map state uses ES module live bindings and is switched with setActiveMap().
 */
import { DEFAULT_MAP, MAP_BY_ID, type MapDef } from './maps';

export const CELL_SIZE = 2; // world units per cell (client rendering)
export const SECTION_COUNT = 16;
const ZONE_CHARS = '0123456789abcdef';

export let MAP_ID = '';
export let MAP_DEF: MapDef;
export let MAP_W = 0;
export let MAP_H = 0;
/** Number of spawns (lanes). */
export let LANES = 0;
/** 1 = terrain can be walked on (snow/ice), 0 = cliff or water. */
export let WALKABLE = new Uint8Array(0);
/** 1 = frozen water (not walkable, rendered as ice/water). */
export let WATER = new Uint8Array(0);
/** 1 = exit cell (creeps reaching it leak). */
export let EXIT = new Uint8Array(0);
/** Build zone (0..15) for every buildable cell, -1 if not buildable. */
export let SECTION_OF = new Int8Array(0);
/** Spawn points (logic coordinates) – one per lane. */
export let SPAWNS: { x: number; y: number }[] = [];
/** Where the gate model stands (just outside the exit). */
export let GATE = { x: 0, y: 0, rot: 0 };
/** Centre of every zone (logic coordinates). */
export let ZONE_CENTER: { x: number; y: number }[] = [];
/** Cells flyers may cross: everything except rock (water is fine, towers do not block them). */
export let FLY_PASSABLE = new Uint8Array(0);
/** Distance to the exit for flyers – they fly around cliffs but over towers and water. */
export let FLY_FLOW: Float32Array = new Float32Array(0);

export const cellIndex = (x: number, y: number) => y * MAP_W + x;
export const inMap = (x: number, y: number) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;

export function setActiveMap(id: string) {
  const def = MAP_BY_ID[id] ?? MAP_BY_ID[DEFAULT_MAP];
  if (def.id === MAP_ID) return;
  MAP_ID = def.id;
  MAP_DEF = def;
  MAP_W = def.w;
  MAP_H = def.h;
  LANES = def.spawns.length;
  SPAWNS = def.spawns;
  const n = MAP_W * MAP_H;
  WALKABLE = new Uint8Array(n);
  WATER = new Uint8Array(n);
  EXIT = new Uint8Array(n);
  SECTION_OF = new Int8Array(n).fill(-1);
  const sum = Array.from({ length: SECTION_COUNT }, () => ({ x: 0, y: 0, n: 0 }));
  let ex = 0, ey = 0, en = 0;
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const ch = def.grid[y][x], i = y * MAP_W + x;
      if (ch === '~') { WATER[i] = 1; continue; }
      if (ch === '#') continue;
      WALKABLE[i] = 1;
      if (ch === 'E') { EXIT[i] = 1; ex += x + 0.5; ey += y + 0.5; en++; }
      const z = ZONE_CHARS.indexOf(ch);
      if (z >= 0) { SECTION_OF[i] = z; sum[z].x += x + 0.5; sum[z].y += y + 0.5; sum[z].n++; }
    }
  }
  ZONE_CENTER = sum.map((s) => ({ x: s.x / Math.max(1, s.n), y: s.y / Math.max(1, s.n) }));
  ex /= en; ey /= en;
  // The gate stands just beyond the map edge closest to the exit.
  const edges = [
    { d: ey, x: ex, y: -1.2, rot: Math.PI }, { d: MAP_H - ey, x: ex, y: MAP_H + 1.2, rot: 0 },
    { d: ex, x: -1.2, y: ey, rot: -Math.PI / 2 }, { d: MAP_W - ex, x: MAP_W + 1.2, y: ey, rot: Math.PI / 2 },
  ].sort((a, b) => a.d - b.d);
  GATE = { x: edges[0].x, y: edges[0].y, rot: edges[0].rot };
  FLY_PASSABLE = new Uint8Array(n);
  for (let i = 0; i < n; i++) FLY_PASSABLE[i] = WALKABLE[i] | WATER[i];
  FLY_FLOW = computeFlow(new Uint8Array(n), FLY_PASSABLE);
}

export function isBuildable(x: number, y: number): boolean {
  return inMap(x, y) && SECTION_OF[cellIndex(x, y)] >= 0;
}

/** Lanes (spawns) that receive creeps for a number of players. */
export function activeLanes(players: number): number[] {
  return MAP_DEF.lanesFor(players);
}

/** Zones that lie in a lane (used by bots to plan mazes). */
export function laneZones(lane: number): number[] {
  const zones: number[] = [];
  for (let s = 0; s < SECTION_COUNT; s++) if (MAP_DEF.zoneHome[s] === lane) zones.push(s);
  return zones;
}

// ---------------------------------------------------------------- pathfinding

const SQRT2 = Math.SQRT2;
const DIRS: [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2],
];

const free = (blocked: Uint8Array, x: number, y: number, ok: Uint8Array) => inMap(x, y) && ok[cellIndex(x, y)] === 1 && !blocked[cellIndex(x, y)];

/** Diagonal steps are only allowed if both adjacent orthogonal cells are free (no corner cutting). */
function canStep(blocked: Uint8Array, x: number, y: number, dx: number, dy: number, ok: Uint8Array) {
  if (!free(blocked, x + dx, y + dy, ok)) return false;
  return dx === 0 || dy === 0 || (free(blocked, x + dx, y, ok) && free(blocked, x, y + dy, ok));
}

/** Distance (in cells) from every cell to the nearest exit. Infinity = unreachable. `blocked` marks towers. */
export function computeFlow(blocked: Uint8Array, passable: Uint8Array = WALKABLE): Float32Array {
  const dist = new Float32Array(MAP_W * MAP_H).fill(Infinity);
  // Binary heap of [dist, index].
  const heapD: number[] = [], heapI: number[] = [];
  const push = (d: number, i: number) => {
    let k = heapD.length;
    heapD.push(d); heapI.push(i);
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heapD[p] <= d) break;
      heapD[k] = heapD[p]; heapI[k] = heapI[p];
      k = p;
    }
    heapD[k] = d; heapI[k] = i;
  };
  const pop = () => {
    const d = heapD[0], i = heapI[0];
    const ld = heapD.pop()!, li = heapI.pop()!;
    if (heapD.length) {
      let k = 0;
      const n = heapD.length;
      for (;;) {
        let c = 2 * k + 1;
        if (c >= n) break;
        if (c + 1 < n && heapD[c + 1] < heapD[c]) c++;
        if (heapD[c] >= ld) break;
        heapD[k] = heapD[c]; heapI[k] = heapI[c];
        k = c;
      }
      heapD[k] = ld; heapI[k] = li;
    }
    return [d, i] as const;
  };
  for (let i = 0; i < EXIT.length; i++) if (EXIT[i] && !blocked[i]) { dist[i] = 0; push(0, i); }
  while (heapD.length) {
    const [d, i] = pop();
    if (d > dist[i]) continue;
    const x = i % MAP_W, y = (i - x) / MAP_W;
    for (const [dx, dy, c] of DIRS) {
      // Steps are symmetric, so walking backwards from the exit uses the same rule.
      if (!canStep(blocked, x, y, dx, dy, passable)) continue;
      const j = cellIndex(x + dx, y + dy);
      const nd = Math.fround(d + c);
      if (nd < dist[j]) { dist[j] = nd; push(nd, j); }
    }
  }
  return dist;
}

/** Next cell (index) to walk to from (cx, cy), or -1 if there is none. */
export function nextCell(dist: Float32Array, blocked: Uint8Array, cx: number, cy: number, passable: Uint8Array = WALKABLE): number {
  let best = -1, bestD = dist[cellIndex(cx, cy)];
  for (const [dx, dy] of DIRS) {
    if (!canStep(blocked, cx, cy, dx, dy, passable)) continue;
    const j = cellIndex(cx + dx, cy + dy);
    if (dist[j] < bestD) { bestD = dist[j]; best = j; }
  }
  return best;
}

/** True if every spawn can still reach the exit. */
export function spawnsConnected(dist: Float32Array): boolean {
  return SPAWNS.every((s) => Number.isFinite(dist[cellIndex(Math.floor(s.x), Math.floor(s.y))]));
}

/** Cell route (logic coordinates of cell centres) from a point to the exit – used for previews and bots. */
export function traceRoute(dist: Float32Array, blocked: Uint8Array, x: number, y: number, max = 2000, passable: Uint8Array = WALKABLE): { x: number; y: number }[] {
  let cx = Math.floor(x), cy = Math.floor(y);
  const pts = [{ x, y }];
  for (let n = 0; n < max; n++) {
    if (!inMap(cx, cy) || !Number.isFinite(dist[cellIndex(cx, cy)]) || dist[cellIndex(cx, cy)] === 0) break;
    const j = nextCell(dist, blocked, cx, cy, passable);
    if (j < 0) break;
    cx = j % MAP_W; cy = (j - cx) / MAP_W;
    pts.push({ x: cx + 0.5, y: cy + 0.5 });
  }
  return pts;
}

/** True if a straight flight (with a little clearance to both sides) only crosses cells flyers can pass. */
function flyClear(x0: number, y0: number, x1: number, y1: number): boolean {
  const len = Math.hypot(x1 - x0, y1 - y0);
  if (len < 1e-6) return true;
  const nx = -(y1 - y0) / len, ny = (x1 - x0) / len;
  const n = Math.ceil(len / 0.15);
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    for (const off of [0, 0.3, -0.3]) {
      const x = Math.floor(x0 + (x1 - x0) * t + nx * off), y = Math.floor(y0 + (y1 - y0) * t + ny * off);
      if (!inMap(x, y) || !FLY_PASSABLE[cellIndex(x, y)]) return false;
    }
  }
  return true;
}

let noBlock = new Uint8Array(0);

/**
 * Point a flyer at (x, y) should head for: the farthest point of its way around the cliffs that it can reach in
 * a straight line (so it flies smoothly instead of cell by cell). Towers do not matter to flyers.
 */
export function flyTarget(x: number, y: number): { x: number; y: number; done: boolean } {
  if (noBlock.length !== MAP_W * MAP_H) noBlock = new Uint8Array(MAP_W * MAP_H);
  let cx = Math.floor(x), cy = Math.floor(y);
  if (!inMap(cx, cy) || !Number.isFinite(FLY_FLOW[cellIndex(cx, cy)])) return { x: GATE.x, y: GATE.y, done: false };
  if (EXIT[cellIndex(cx, cy)]) return { x: cx + 0.5, y: cy + 0.5, done: true };
  const way: { x: number; y: number }[] = [];
  for (let k = 0; k < 10; k++) {
    const j = nextCell(FLY_FLOW, noBlock, cx, cy, FLY_PASSABLE);
    if (j < 0) break;
    cx = j % MAP_W; cy = (j - cx) / MAP_W;
    way.push({ x: cx + 0.5, y: cy + 0.5 });
    if (EXIT[j]) break;
  }
  if (!way.length) return { x: GATE.x, y: GATE.y, done: false };
  for (let i = way.length - 1; i > 0; i--) if (flyClear(x, y, way[i].x, way[i].y)) return { ...way[i], done: false };
  return { ...way[0], done: false };
}

export function routeLength(pts: { x: number; y: number }[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return len;
}

setActiveMap(DEFAULT_MAP);
