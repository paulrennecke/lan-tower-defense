/**
 * Map definitions. Maps are drawn on a character grid:
 *   '#' ice cliff / rock   '~' water   '.' walkable, not buildable   'E' exit (gate)
 *   '0'-'9','a'-'f' build zone 0..15 (zone index = order in which zones are dealt to players)
 *
 * Every map has up to four spawns ("lanes"). Each zone has a home lane; zones of inactive lanes stay empty unless
 * they are marked as shared (always in use, e.g. the merged lower part of Wintermaul X9).
 */

export interface MapDef {
  id: string;
  name: string;
  desc: string;
  w: number;
  h: number;
  grid: string[];
  /** Spawn per lane in logic coordinates (cell units). */
  spawns: { x: number; y: number }[];
  /** Home lane of every zone (16 entries). */
  zoneHome: number[];
  /** Zones that are used even if their home lane is inactive. */
  shared: boolean[];
  /** Lanes that receive creeps for a given number of players. */
  lanesFor(players: number): number[];
  /** Creep HP factor (maps with open, branching areas are harder to maze). */
  hpScale: number;
  /** Walls the bots build first, e.g. to close one branch so all creeps take the other (x0, y0, x1, y1). */
  botWalls?: [number, number, number, number][];
}

function canvas(w: number, h: number) {
  const rows = Array.from({ length: h }, () => new Array<string>(w).fill('#'));
  const fill = (x0: number, y0: number, x1: number, y1: number, ch: string) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) rows[y][x] = ch;
  };
  return { fill, rows, done: () => rows.map((r) => r.join('')) };
}

// ---------------------------------------------------------------- Wintermaul X9 (classic)

function x9(): MapDef {
  const c = canvas(50, 50);
  // Three spawn mouths in the north, three areas separated by cliff pillars.
  c.fill(5, 0, 8, 0, '.'); c.fill(23, 0, 26, 0, '.'); c.fill(41, 0, 44, 0, '.');
  c.fill(2, 1, 11, 2, '.'); c.fill(16, 1, 33, 2, '.'); c.fill(38, 1, 47, 2, '.');
  c.fill(2, 3, 11, 10, '0'); c.fill(16, 3, 33, 10, '1'); c.fill(38, 3, 47, 10, '2');
  c.fill(2, 11, 11, 17, '9'); c.fill(16, 11, 33, 17, 'a'); c.fill(38, 11, 47, 17, 'b');
  // Middle band with ice ponds and water channels between the zones.
  c.fill(2, 18, 13, 27, '3'); c.fill(16, 18, 33, 27, '4'); c.fill(36, 18, 47, 27, '5');
  c.fill(14, 18, 15, 20, '.'); c.fill(14, 21, 15, 26, '~'); c.fill(14, 27, 15, 27, '.');
  c.fill(34, 18, 35, 20, '.'); c.fill(34, 21, 35, 26, '~'); c.fill(34, 27, 35, 27, '.');
  c.fill(4, 19, 7, 20, '~'); c.fill(42, 19, 45, 20, '~');
  // The big rock trench (∩) forces the creeps around both sides.
  c.fill(2, 28, 9, 35, '6'); c.fill(40, 28, 47, 35, '8');
  c.fill(2, 36, 9, 40, 'c'); c.fill(40, 36, 47, 40, 'd');
  c.fill(14, 34, 35, 40, '7');
  // Bottom corridor to the gate in the frozen lake.
  c.fill(2, 41, 21, 46, 'e'); c.fill(22, 41, 27, 46, '.'); c.fill(28, 41, 47, 46, 'f');
  c.fill(22, 47, 27, 48, '.'); c.fill(22, 49, 27, 49, 'E');
  c.fill(2, 47, 21, 49, '~'); c.fill(28, 47, 47, 49, '~');
  return {
    id: 'x9', name: 'Wintermaul X9', w: 50, h: 50, grid: c.done(),
    desc: 'Die klassische Karte: drei Portale im Norden, Felsgraben in der Mitte, Tor im zugefrorenen See.',
    spawns: [{ x: 7, y: 0.5 }, { x: 25, y: 0.5 }, { x: 43, y: 0.5 }],
    //         0  1  2  3  4  5  6  7  8  9  a  b  c  d  e  f
    zoneHome: [0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 2, 0, 2],
    shared: [false, false, false, true, false, true, true, true, true, false, false, false, true, true, true, true],
    lanesFor: (n) => (n >= 3 ? [0, 1, 2] : n === 2 ? [0, 2] : [1]),
    hpScale: 0.7,
    // Like real X9 players: close the right side of the trench so every creep has to take the long left route.
    botWalls: [[40, 28, 47, 28]],
  };
}

// ---------------------------------------------------------------- Nordend (four lanes)

function nordend(): MapDef {
  const W = 64, H = 56, laneX = [2, 17, 34, 49], laneW = 13, zoneBottom = 43;
  const c = canvas(W, H);
  const zc = '0123456789abcdef';
  for (let l = 0; l < 4; l++) {
    c.fill(laneX[l], 0, laneX[l] + laneW - 1, 2, '.');
    for (let band = 0; band < 4; band++) c.fill(laneX[l], 3 + band * 10, laneX[l] + laneW - 1, 12 + band * 10, zc[band * 4 + l]);
  }
  for (let y = zoneBottom; y < H; y++) {
    const t = (y - zoneBottom) / (H - 1 - zoneBottom);
    const half = 31 + (2.5 - 31) * t;
    for (let x = 0; x < W; x++) if (Math.abs(x + 0.5 - W / 2) <= half) c.rows[y][x] = y === H - 1 ? 'E' : '.';
  }
  return {
    id: 'nordend', name: 'Nordend (4 Spuren)', w: W, h: H, grid: c.done(),
    desc: 'Vier getrennte Spuren zwischen Eisklippen – jeder verteidigt seine eigene Spur, unten treffen sich alle.',
    spawns: laneX.map((x) => ({ x: x + laneW / 2, y: 0.5 })),
    zoneHome: Array.from({ length: 16 }, (_, s) => s % 4),
    shared: new Array(16).fill(false),
    lanesFor: (n) => (n >= 4 ? [0, 1, 2, 3] : n === 3 ? [0, 1, 2] : n === 2 ? [1, 2] : [1]),
    hpScale: 1,
  };
}

// ---------------------------------------------------------------- Zwillingsgletscher (two lanes merge)

function twin(): MapDef {
  const c = canvas(50, 56);
  c.fill(6, 0, 11, 0, '.'); c.fill(38, 0, 43, 0, '.');
  c.fill(2, 1, 15, 2, '.'); c.fill(34, 1, 47, 2, '.');
  ['0', '2', '4', '6'].forEach((z, i) => c.fill(2, 3 + i * 7, 15, Math.min(29, 9 + i * 7), z));
  ['1', '3', '5', '7'].forEach((z, i) => c.fill(34, 3 + i * 7, 47, Math.min(29, 9 + i * 7), z));
  // Both lanes turn inwards and meet at the junction, then run south together.
  c.fill(2, 30, 17, 37, '8'); c.fill(32, 30, 47, 37, '9');
  c.fill(18, 30, 24, 37, 'a'); c.fill(25, 30, 31, 37, 'f');
  ['b', 'c', 'd', 'e'].forEach((z, i) => c.fill(18, 38 + i * 4, 31, 41 + i * 4, z));
  c.fill(18, 54, 31, 54, '.'); c.fill(18, 55, 31, 55, 'E');
  c.fill(4, 40, 15, 53, '~'); c.fill(34, 40, 45, 53, '~');
  c.fill(19, 6, 30, 24, '~');
  return {
    id: 'twin', name: 'Zwillingsgletscher', w: 50, h: 56, grid: c.done(),
    desc: 'Zwei Spuren biegen nach innen ab und vereinen sich zu einer gemeinsamen Schlucht nach Süden.',
    spawns: [{ x: 9, y: 0.5 }, { x: 41, y: 0.5 }],
    //         0  1  2  3  4  5  6  7  8  9  a  b  c  d  e  f
    zoneHome: [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 0, 1, 0, 1, 1],
    shared: [false, false, false, false, false, false, false, false, false, false, true, true, true, true, true, true],
    lanesFor: (n) => (n >= 2 ? [0, 1] : [0]),
    hpScale: 1,
  };
}

export const MAPS: MapDef[] = [x9(), nordend(), twin()];
export const MAP_BY_ID: Record<string, MapDef> = Object.fromEntries(MAPS.map((m) => [m.id, m]));
export const DEFAULT_MAP = 'x9';
