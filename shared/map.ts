/** Map definition shared by server and client. All logic coordinates are in cell units. */

export const CELL_SIZE = 2; // world units per cell (client rendering)
export const MAP_W = 36;
export const MAP_H = 35;
export const SECTION_COUNT = 16;

/** Serpentine path through the map (cell coordinates). */
const WAYPOINTS: [number, number][] = [
  [0, 2], [33, 2], [33, 7], [2, 7], [2, 12], [33, 12], [33, 17], [2, 17],
  [2, 22], [33, 22], [33, 27], [2, 27], [2, 32], [34, 32],
];

export interface PathPos { x: number; y: number; dir: number }

export class PathLine {
  readonly pts: { x: number; y: number }[];
  readonly cum: number[] = [0];
  readonly total: number;

  constructor(pts: { x: number; y: number }[]) {
    this.pts = pts;
    for (let i = 1; i < pts.length; i++) {
      this.cum.push(this.cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    }
    this.total = this.cum[this.cum.length - 1];
  }

  posAt(d: number): PathPos {
    if (d <= 0) {
      const a = this.pts[0], b = this.pts[1];
      return { x: a.x, y: a.y, dir: Math.atan2(b.y - a.y, b.x - a.x) };
    }
    if (d >= this.total) {
      const a = this.pts[this.pts.length - 2], b = this.pts[this.pts.length - 1];
      return { x: b.x, y: b.y, dir: Math.atan2(b.y - a.y, b.x - a.x) };
    }
    let lo = 0, hi = this.cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid] <= d) lo = mid; else hi = mid;
    }
    const a = this.pts[lo], b = this.pts[lo + 1];
    const t = (d - this.cum[lo]) / (this.cum[lo + 1] - this.cum[lo]);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, dir: Math.atan2(b.y - a.y, b.x - a.x) };
  }

  /** Path distance of the point on the path closest to (x, y). */
  project(x: number, y: number): { d: number; dist: number } {
    let best = { d: 0, dist: Infinity };
    for (let i = 0; i < this.pts.length - 1; i++) {
      const a = this.pts[i], b = this.pts[i + 1];
      const vx = b.x - a.x, vy = b.y - a.y;
      const len2 = vx * vx + vy * vy;
      const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (y - a.y) * vy) / len2));
      const px = a.x + vx * t, py = a.y + vy * t;
      const dist = Math.hypot(x - px, y - py);
      if (dist < best.dist) best = { d: this.cum[i] + Math.sqrt(len2) * t, dist };
    }
    return best;
  }
}

export const PATH = new PathLine(WAYPOINTS.map(([x, y]) => ({ x: x + 0.5, y: y + 0.5 })));
export const SPAWN_CELL = WAYPOINTS[0];
export const BASE_CELL = WAYPOINTS[WAYPOINTS.length - 1];

export const cellIndex = (x: number, y: number) => y * MAP_W + x;
export const inMap = (x: number, y: number) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;

/** 1 = path cell */
export const PATH_CELLS = new Uint8Array(MAP_W * MAP_H);
for (let i = 0; i < WAYPOINTS.length - 1; i++) {
  const [ax, ay] = WAYPOINTS[i], [bx, by] = WAYPOINTS[i + 1];
  const steps = Math.max(Math.abs(bx - ax), Math.abs(by - ay));
  for (let s = 0; s <= steps; s++) {
    const x = ax + Math.sign(bx - ax) * s, y = ay + Math.sign(by - ay) * s;
    if (inMap(x, y)) PATH_CELLS[cellIndex(x, y)] = 1;
  }
}

/** Section (0..15) for every buildable cell, -1 if not buildable. */
export const SECTION_OF = new Int8Array(MAP_W * MAP_H).fill(-1);
for (let y = 0; y < MAP_H; y++) {
  for (let x = 0; x < MAP_W; x++) {
    const idx = cellIndex(x, y);
    if (PATH_CELLS[idx]) continue;
    // Keep the spawn portal and the base free.
    if (Math.abs(x - SPAWN_CELL[0]) <= 1 && Math.abs(y - SPAWN_CELL[1]) <= 1) continue;
    if (Math.abs(x - BASE_CELL[0]) <= 1 && Math.abs(y - BASE_CELL[1]) <= 2) continue;
    const { d } = PATH.project(x + 0.5, y + 0.5);
    SECTION_OF[idx] = Math.min(SECTION_COUNT - 1, Math.floor((d / PATH.total) * SECTION_COUNT));
  }
}

export function isBuildable(x: number, y: number): boolean {
  return inMap(x, y) && SECTION_OF[cellIndex(x, y)] >= 0;
}

/** Sections are dealt round-robin so every player gets early and late parts of the path. */
export function assignSections(playerIds: string[]): string[] {
  const owners: string[] = [];
  for (let s = 0; s < SECTION_COUNT; s++) owners.push(playerIds[s % playerIds.length]);
  return owners;
}
