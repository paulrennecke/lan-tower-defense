import { describe, expect, it } from 'vitest';
import { armorMultiplier, computeDamage, DAMAGE_TABLE } from '../shared/damage';
import { CLASSES, TOWER_BY_ID, RESEARCH_BY_ID } from '../shared/data/classes';
import { ENEMY_BY_ID, ENEMIES } from '../shared/data/enemies';
import { getWave, playerHpMul, VICTORY_WAVE, waveBaseHp } from '../shared/data/waves';
import { assignSections, MAP_H, MAP_W, PATH, PATH_CELLS, SECTION_COUNT, SECTION_OF, cellIndex } from '../shared/map';
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
  it('has 6 classes with 6 towers and 4 research items each', () => {
    expect(CLASSES).toHaveLength(6);
    for (const c of CLASSES) {
      expect(c.towers).toHaveLength(6);
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
  it('path runs through the map and sections cover all 16 slots', () => {
    expect(PATH.total).toBeGreaterThan(200);
    const counts = new Array(SECTION_COUNT).fill(0);
    for (let i = 0; i < MAP_W * MAP_H; i++) if (SECTION_OF[i] >= 0) counts[SECTION_OF[i]]++;
    for (const c of counts) expect(c).toBeGreaterThan(20);
  });

  it('path cells are not buildable', () => {
    for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
      if (PATH_CELLS[cellIndex(x, y)]) expect(SECTION_OF[cellIndex(x, y)]).toBe(-1);
    }
  });

  it('assigns sections round-robin', () => {
    expect(assignSections(['a'])).toEqual(new Array(16).fill('a'));
    const s = assignSections(['a', 'b', 'c']);
    expect(s.filter((x) => x === 'a')).toHaveLength(6);
    expect(s.filter((x) => x === 'c')).toHaveLength(5);
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
