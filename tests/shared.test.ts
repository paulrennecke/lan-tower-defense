import { describe, expect, it } from 'vitest';
import { armorMultiplier, computeDamage, DAMAGE_TABLE } from '../shared/damage';
import { CLASSES, TOWER_BY_ID, RESEARCH_BY_ID } from '../shared/data/classes';
import { ENEMY_BY_ID, ENEMIES } from '../shared/data/enemies';
import { getWave, playerHpMul, VICTORY_WAVE, waveBaseHp } from '../shared/data/waves';
import {
  assignSections, computeFlow, lanesOf, MAP_H, MAP_W, routeLength, SECTION_COUNT, SECTION_OF, SPAWNS, WALKABLE, cellIndex,
  setActiveMap, spawnsConnected, traceRoute, MAP_ID, EXIT, LANES, LANE_LAST_ZONE,
} from '../shared/map';
import { MAPS } from '../shared/maps';
import { auraBuffs, effectiveStats } from '../shared/stats';

describe('damage', () => {
  it('uses the WC3 armor formula', () => {
    expect(armorMultiplier(0)).toBe(1);
    expect(armorMultiplier(10)).toBeCloseTo(1 - 0.6 / 1.6, 5);
    expect(armorMultiplier(-5)).toBeGreaterThan(1);
  });

  it('applies the attack/armor table', () => {
    expect(computeDamage(100, 'pierce', 'light', 0, false)).toBe(200);
    expect(computeDamage(100, 'siege', 'fortified', 0, false)).toBe(150);
    expect(computeDamage(100, 'chaos', 'hero', 0, false)).toBe(100);
    expect(DAMAGE_TABLE.magic.heavy).toBe(2);
  });

  it('magic immune units take no magic damage', () => {
    expect(computeDamage(100, 'magic', 'fortified', 0, true)).toBe(0);
    expect(computeDamage(100, 'siege', 'fortified', 0, true)).toBe(150);
  });
});

describe('content', () => {
  it('has 6 classes with a maze block, 6 towers and 4 research items each', () => {
    expect(CLASSES).toHaveLength(6);
    for (const c of CLASSES) {
      expect(c.towers).toHaveLength(7);
      expect(c.towers[0].shape).toBe('block');
      expect(c.towers[0].maxLevel).toBe(0);
      expect(c.research).toHaveLength(4);
      for (const t of c.towers) {
        expect(t.levels).toHaveLength(3);
        if (t.requires) expect(RESEARCH_BY_ID[t.requires]?.perLevel.unlock).toBe(t.id);
      }
    }
  });

  it('every class can reveal invisible units and hit air', () => {
    for (const c of CLASSES) {
      expect(c.towers.some((t) => t.levels[0].detect && !t.requires), c.id + ' detect').toBe(true);
      expect(c.towers.some((t) => t.levels[0].air && t.levels[0].dmg > 0 && !t.requires), c.id + ' air').toBe(true);
    }
  });

  it('every wave up to the victory wave references existing enemies', () => {
    for (let n = 1; n <= VICTORY_WAVE + 20; n++) {
      const w = getWave(n);
      expect(w.groups.length).toBeGreaterThan(0);
      for (const g of w.groups) expect(ENEMY_BY_ID[g.enemy], `wave ${n}: ${g.enemy}`).toBeDefined();
    }
    for (const e of ENEMIES) if (e.split) expect(ENEMY_BY_ID[e.split.into]).toBeDefined();
  });

  it('has boss waves every 10 waves and in endless mode every 5', () => {
    for (const n of [10, 20, 30, 40, 45, 50]) expect(getWave(n).boss, `wave ${n}`).toBe(true);
  });

  it('wave HP grows monotonically and scales with players', () => {
    for (let n = 2; n < 80; n++) expect(waveBaseHp(n)).toBeGreaterThan(waveBaseHp(n - 1));
    expect(playerHpMul(1)).toBe(1);
    expect(playerHpMul(16)).toBeGreaterThan(playerHpMul(4));
  });
});

describe('map', () => {
  it('every map is valid: 16 zones, reachable spawns and exits, zones for every player count', () => {
    for (const def of MAPS) {
      setActiveMap(def.id);
      expect(MAP_ID).toBe(def.id);
      expect(def.grid).toHaveLength(def.h);
      for (const row of def.grid) expect(row).toHaveLength(def.w);
      const counts = new Array(SECTION_COUNT).fill(0);
      for (let i = 0; i < MAP_W * MAP_H; i++) if (SECTION_OF[i] >= 0) counts[SECTION_OF[i]]++;
      for (const c of counts) expect(c, def.id).toBeGreaterThan(30);
      expect(EXIT.some((e) => e === 1)).toBe(true);
      expect(spawnsConnected(computeFlow(new Uint8Array(MAP_W * MAP_H))), def.id).toBe(true);
      expect(LANE_LAST_ZONE.every((z) => z >= 0)).toBe(true);
      for (let n = 1; n <= 16; n++) {
        const ids = Array.from({ length: n }, (_, i) => 'p' + i);
        const owners = assignSections(ids);
        for (const id of ids) expect(owners.includes(id), `${def.id} n=${n} ${id}`).toBe(true);
        const lanes = lanesOf(owners);
        expect(lanes).toEqual(def.lanesFor(n));
        expect(lanes.every((l) => l < LANES)).toBe(true);
      }
    }
    setActiveMap('nordend');
  });

  it('has four lanes with 16 build zones of equal size', () => {
    setActiveMap('nordend');
    const counts = new Array(SECTION_COUNT).fill(0);
    for (let i = 0; i < MAP_W * MAP_H; i++) if (SECTION_OF[i] >= 0) counts[SECTION_OF[i]]++;
    for (const c of counts) expect(c).toBe(130);
    for (let i = 0; i < MAP_W * MAP_H; i++) if (SECTION_OF[i] >= 0) expect(WALKABLE[i]).toBe(1);
  });

  it('creeps find a route from every spawn and towers lengthen it', () => {
    const blocked = new Uint8Array(MAP_W * MAP_H);
    const flow = computeFlow(blocked);
    expect(spawnsConnected(flow)).toBe(true);
    const before = routeLength(traceRoute(flow, blocked, SPAWNS[0].x, SPAWNS[0].y));
    // A wall across lane 0 with a gap on the left (away from the exit) forces a detour.
    for (let x = 3; x < 15; x++) blocked[cellIndex(x, 10)] = 1;
    const flow2 = computeFlow(blocked);
    expect(routeLength(traceRoute(flow2, blocked, SPAWNS[0].x, SPAWNS[0].y))).toBeGreaterThan(before);
    // Closing the gap blocks the lane completely.
    blocked[cellIndex(2, 10)] = 1;
    expect(spawnsConnected(computeFlow(blocked))).toBe(false);
  });

  it('assigns one lane per player up to four players', () => {
    expect(lanesOf(assignSections(['a']))).toEqual([1]);
    expect(assignSections(['a']).filter((x) => x === 'a')).toHaveLength(4);
    const two = assignSections(['a', 'b']);
    expect(lanesOf(two)).toEqual([1, 2]);
    expect(two.every((o, s) => !o || o === (s % 4 === 1 ? 'a' : 'b'))).toBe(true);
    expect(lanesOf(assignSections(['a', 'b', 'c', 'd', 'e']))).toEqual([0, 1, 2, 3]);
    const sixteen = assignSections(Array.from({ length: 16 }, (_, i) => 'p' + i));
    expect(new Set(sixteen).size).toBe(16);
  });
});

describe('stats', () => {
  it('applies research and the strongest aura', () => {
    const base = TOWER_BY_ID.h_watch.levels[0];
    const s = effectiveStats('h_watch', 0, { h_r_dmg: 2, h_r_speed: 1 }, { dmg: 0.1, speed: 0.2 });
    expect(s.dmg).toBeCloseTo(base.dmg * (1 + 0.24 + 0.1));
    expect(s.cd).toBeCloseTo(base.cd / 1.3);
    const towers = [
      { id: 1, def: 'h_watch', level: 0, cx: 5, cy: 5, owner: 'a' },
      { id: 2, def: 'h_church', level: 0, cx: 7, cy: 5, owner: 'b' },
      { id: 3, def: 'h_church', level: 2, cx: 6, cy: 6, owner: 'b' },
    ];
    expect(auraBuffs(towers[0], towers).speed).toBe(0.3);
    expect(auraBuffs({ ...towers[0], cx: 30, cy: 30 }, towers).speed).toBe(0);
  });
});
