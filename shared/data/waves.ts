import { ENEMY_BY_ID } from './enemies';

export const VICTORY_WAVE = 40;
export const START_GOLD = 350;
export const START_LIVES = 50;
export const START_LUMBER = 0;
export const FIRST_COUNTDOWN = 45;
export const WAVE_COUNTDOWN = 22;

export interface WaveGroup { enemy: string; count: number; interval: number; hpMul?: number; delay?: number }
export interface WaveDef { groups: WaveGroup[]; boss?: boolean }

const g = (enemy: string, count: number, interval = 1.0, hpMul = 1, delay = 0): WaveGroup => ({ enemy, count, interval, hpMul, delay });

const WAVES: WaveDef[] = [
  /* 1 */ { groups: [g('ghoul', 18)] },
  /* 2 */ { groups: [g('wolf', 22, 0.6)] },
  /* 3 */ { groups: [g('murloc', 20)] },
  /* 4 */ { groups: [g('bat', 18)] },
  /* 5 */ { groups: [g('gnoll', 20)] },
  /* 6 */ { groups: [g('troll', 18)] },
  /* 7 */ { groups: [g('spider', 16, 1.1)] },
  /* 8 */ { groups: [g('shade', 16)] },
  /* 9 */ { groups: [g('ogre', 14, 1.4)] },
  /* 10 */ { boss: true, groups: [g('ghoul', 10, 0.8, 1.5), g('abomination', 1, 1, 1, 9)] },
  /* 11 */ { groups: [g('harpy', 18)] },
  /* 12 */ { groups: [g('slime', 14, 1.2)] },
  /* 13 */ { groups: [g('skeleton', 16), g('necro', 5, 3, 1, 1.5)] },
  /* 14 */ { groups: [g('golem', 12, 1.5)] },
  /* 15 */ { groups: [g('centaur', 20, 0.7)] },
  /* 16 */ { groups: [g('gargoyle', 16)] },
  /* 17 */ { groups: [g('troll', 10), g('shade', 10, 1, 1, 0.5)] },
  /* 18 */ { groups: [g('naga', 16, 1.1)] },
  /* 19 */ { groups: [g('satyr', 18)] },
  /* 20 */ { boss: true, groups: [g('ogre', 8, 1.2), g('pitlord', 1, 1, 1, 10)] },
  /* 21 */ { groups: [g('giant', 12, 1.6)] },
  /* 22 */ { groups: [g('felhound', 18, 0.8)] },
  /* 23 */ { groups: [g('whelp', 18)] },
  /* 24 */ { groups: [g('spider', 12), g('necro', 6, 2, 1, 0.5)] },
  /* 25 */ { groups: [g('slime', 18, 0.9)] },
  /* 26 */ { groups: [g('golem', 10, 1.4), g('gargoyle', 10, 1.2, 1, 0.7)] },
  /* 27 */ { groups: [g('satyr', 12), g('naga', 8, 1.5, 1, 0.7)] },
  /* 28 */ { groups: [g('doomguard', 14, 1.4)] },
  /* 29 */ { groups: [g('wolf', 30, 0.4, 1.4)] },
  /* 30 */ { boss: true, groups: [g('gargoyle', 10, 1.0), g('frostwyrm', 1, 1, 1, 10)] },
  /* 31 */ { groups: [g('infernal', 10, 1.8)] },
  /* 32 */ { groups: [g('whelp', 12), g('harpy', 12, 0.8, 1.2, 0.5)] },
  /* 33 */ { groups: [g('giant', 10, 1.6), g('naga', 6, 2, 1, 0.8)] },
  /* 34 */ { groups: [g('shade', 14, 0.8, 1.3), g('satyr', 10, 1, 1, 0.5)] },
  /* 35 */ { groups: [g('felhound', 14, 0.7), g('golem', 8, 1.5, 1, 0.5)] },
  /* 36 */ { groups: [g('doomguard', 16, 1.2)] },
  /* 37 */ { groups: [g('centaur', 16, 0.6), g('gargoyle', 12, 1, 1, 0.5)] },
  /* 38 */ { groups: [g('infernal', 12, 1.5)] },
  /* 39 */ { groups: [g('doomguard', 8, 1.2), g('frostwyrm', 2, 6, 0.4, 0.6)] },
  /* 40 */ { boss: true, groups: [g('doomguard', 6, 1.0), g('infernal', 4, 1.5, 1, 0.3), g('demonlord', 1, 1, 1, 14)] },
];

const ENDLESS_POOL = ['ghoul', 'wolf', 'gnoll', 'troll', 'spider', 'shade', 'ogre', 'harpy', 'slime', 'skeleton', 'golem',
  'centaur', 'gargoyle', 'naga', 'satyr', 'giant', 'felhound', 'whelp', 'infernal', 'doomguard'];
const ENDLESS_BOSSES = ['abomination', 'pitlord', 'frostwyrm', 'demonlord'];

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function getWave(n: number): WaveDef {
  if (n <= WAVES.length) return WAVES[n - 1];
  const rnd = mulberry32(n * 7919);
  if (n % 5 === 0) {
    const boss = ENDLESS_BOSSES[Math.floor(rnd() * ENDLESS_BOSSES.length)];
    const esc = ENDLESS_POOL[Math.floor(rnd() * ENDLESS_POOL.length)];
    return { boss: true, groups: [g(esc, 10, 1), g(boss, 1 + Math.floor((n - 40) / 20), 4, 1, 10)] };
  }
  const a = ENDLESS_POOL[Math.floor(rnd() * ENDLESS_POOL.length)];
  const b = ENDLESS_POOL[Math.floor(rnd() * ENDLESS_POOL.length)];
  return { groups: [g(a, 12, 1), g(b, 10, 1, 1, 0.5)] };
}

/** Base HP of a "normal" enemy in wave n (single player). */
export function waveBaseHp(n: number): number {
  const hp = 0.75 * (30 + 2.2 * n + 0.38 * n * n) * (1 + n / 50);
  return n > VICTORY_WAVE ? hp * Math.pow(1.09, n - VICTORY_WAVE) : hp;
}

/** Enemy HP multiplier for the number of players (each player adds firepower along the whole path). */
export function playerHpMul(players: number): number {
  return 1 + 1.15 * (Math.max(1, players) - 1);
}

export function waveBounty(n: number): number {
  return 2 + Math.floor(n / 3);
}

export function waveIncome(n: number): number {
  return 25 + 5 * n;
}

export function waveLumber(n: number): number {
  return getWave(n).boss ? 2 : 1;
}

export function describeWave(n: number): { name: string; count: number; armor: string; tags: string[] }[] {
  return getWave(n).groups.map((grp) => {
    const d = ENEMY_BY_ID[grp.enemy];
    const tags: string[] = [];
    if (d.boss) tags.push('Boss');
    if (d.flying) tags.push('Luft');
    if (d.immune) tags.push('Magieimmun');
    if (d.invisible) tags.push('Unsichtbar');
    if (d.regen && !d.boss) tags.push('Regeneration');
    if (d.heal) tags.push('Heiler');
    if (d.split) tags.push('Teilt sich');
    if (d.speed >= 3.8) tags.push('Schnell');
    return { name: d.name, count: grp.count, armor: d.armorType, tags };
  });
}
