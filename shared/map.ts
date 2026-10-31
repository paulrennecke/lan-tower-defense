/**
 * Wintermaul-style map shared by server and client. All logic coordinates are in cell units.
 *
 * Four spawns at the top open into four snowy lanes (separated by ice cliffs). Every lane is split into four
 * build zones (16 in total). There is no fixed path: creeps walk the shortest route around the towers, so players
 * build mazes. At the bottom the lanes merge into a funnel that leads to the gate (exit).
 */

export const CELL_SIZE = 2; // world units per cell (client rendering)
export const MAP_W = 64;
export const MAP_H = 56;
export const SECTION_COUNT = 16;
export const LANES = 4;
export const LANE_W = 13;
export const LANE_X = [2, 17, 34, 49];
const ZONE_TOP = 3;
const ZONE_H = 10;
const ZONE_BOTTOM = ZONE_TOP + 4 * ZONE_H; // first row of the funnel
const FUNNEL_HALF_TOP = 31;
const FUNNEL_HALF_BOTTOM = 2.5;

export const cellIndex = (x: number, y: number) => y * MAP_W + x;
export const inMap = (x: number, y: number) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;

export const GATE = { x: MAP_W / 2, y: MAP_H - 0.5 };
/** Spawn points (logic coordinates) – one per lane. */
export const SPAWNS = LANE_X.map((x) => ({ x: x + LANE_W / 2, y: 0.5 }));

function funnelHalf(y: number) {
  const t = (y - ZONE_BOTTOM) / (MAP_H - 1 - ZONE_BOTTOM);
  return FUNNEL_HALF_TOP + (FUNNEL_HALF_BOTTOM - FUNNEL_HALF_TOP) * Math.min(1, Math.max(0, t));
}

/** 1 = terrain can be walked on (snow), 0 = ice cliff / rock. */
export const WALKABLE = new Uint8Array(MAP_W * MAP_H);
/** 1 = exit cell (creeps reaching it leak). */
export const EXIT = new Uint8Array(MAP_W * MAP_H);
/** Build zone (0..15) for every buildable cell, -1 if not buildable. Zone index = band * 4 + lane. */
export const SECTION_OF = new Int8Array(MAP_W * MAP_H).fill(-1);
/** Lane (0..3) of every lane cell, -1 elsewhere. */
export const LANE_OF = new Int8Array(MAP_W * MAP_H).fill(-1);

for (let y = 0; y < MAP_H; y++) {
  for (let x = 0; x < MAP_W; x++) {
    const i = cellIndex(x, y);
    if (y < ZONE_BOTTOM) {
      const lane = LANE_X.findIndex((lx) => x >= lx && x < lx + LANE_W);
      if (lane < 0) continue;
      WALKABLE[i] = 1;
      LANE_OF[i] = lane;
      if (y >= ZONE_TOP) SECTION_OF[i] = Math.floor((y - ZONE_TOP) / ZONE_H) * LANES + lane;
    } else if (Math.abs(x + 0.5 - MAP_W / 2) <= funnelHalf(y)) {
      WALKABLE[i] = 1;
      if (y === MAP_H - 1) EXIT[i] = 1;
    }
  }
}

export function isBuildable(x: number, y: number): boolean {
  return inMap(x, y) && SECTION_OF[cellIndex(x, y)] >= 0;
}

/** Zone index for a lane and band (0 = top). */
export const zoneOf = (lane: number, band: number) => band * LANES + lane;

/** Lanes that receive creeps: one lane per player (centred) up to all four. */
export function activeLanes(players: number): number[] {
  return players >= 4 ? [0, 1, 2, 3] : players === 3 ? [0, 1, 2] : players === 2 ? [1, 2] : [1];
}

/**
 * Zones of the active lanes are dealt round-robin ('' = unused zone). Because zone index = band * 4 + lane,
 * up to 4 players get one full lane each; with more players the lanes are shared band by band.
 */
export function assignSections(playerIds: string[]): string[] {
  const lanes = activeLanes(playerIds.length);
  const owners: string[] = [];
  let k = 0;
  for (let s = 0; s < SECTION_COUNT; s++) owners.push(lanes.includes(s % LANES) ? playerIds[k++ % playerIds.length] : '');
  return owners;
}

/** Lanes that have at least one owned zone. */
export function lanesOf(sectionOwners: string[]): number[] {
  const lanes: number[] = [];
  for (let l = 0; l < LANES; l++) if (sectionOwners.some((o, s) => o && s % LANES === l)) lanes.push(l);
  return lanes;
}

// ---------------------------------------------------------------- pathfinding

const SQRT2 = Math.SQRT2;
const DIRS: [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2],
];

const free = (blocked: Uint8Array, x: number, y: number) => inMap(x, y) && WALKABLE[cellIndex(x, y)] === 1 && !blocked[cellIndex(x, y)];

/** Diagonal steps are only allowed if both adjacent orthogonal cells are free (no corner cutting). */
function canStep(blocked: Uint8Array, x: number, y: number, dx: number, dy: number) {
  if (!free(blocked, x + dx, y + dy)) return false;
  return dx === 0 || dy === 0 || (free(blocked, x + dx, y) && free(blocked, x, y + dy));
}

/** Distance (in cells) from every cell to the nearest exit. Infinity = unreachable. `blocked` marks towers. */
export function computeFlow(blocked: Uint8Array): Float32Array {
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
      if (!canStep(blocked, x, y, dx, dy)) continue;
      const j = cellIndex(x + dx, y + dy);
      const nd = Math.fround(d + c);
      if (nd < dist[j]) { dist[j] = nd; push(nd, j); }
    }
  }
  return dist;
}

/** Next cell (index) to walk to from (cx, cy), or -1 if there is none. */
export function nextCell(dist: Float32Array, blocked: Uint8Array, cx: number, cy: number): number {
  let best = -1, bestD = dist[cellIndex(cx, cy)];
  for (const [dx, dy] of DIRS) {
    if (!canStep(blocked, cx, cy, dx, dy)) continue;
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
export function traceRoute(dist: Float32Array, blocked: Uint8Array, x: number, y: number, max = 2000): { x: number; y: number }[] {
  let cx = Math.floor(x), cy = Math.floor(y);
  const pts = [{ x, y }];
  for (let n = 0; n < max; n++) {
    if (!inMap(cx, cy) || !Number.isFinite(dist[cellIndex(cx, cy)]) || dist[cellIndex(cx, cy)] === 0) break;
    const j = nextCell(dist, blocked, cx, cy);
    if (j < 0) break;
    cx = j % MAP_W; cy = (j - cx) / MAP_W;
    pts.push({ x: cx + 0.5, y: cy + 0.5 });
  }
  return pts;
}

export function routeLength(pts: { x: number; y: number }[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return len;
}
