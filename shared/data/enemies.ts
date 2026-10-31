import type { ArmorType } from '../damage';

export type EnemyShape = 'biped' | 'beast' | 'spider' | 'flyer' | 'golem' | 'blob' | 'dragon' | 'demon' | 'fish';

export interface EnemyDef {
  id: string;
  name: string;
  desc: string;
  armorType: ArmorType;
  armor: number;
  speed: number;      // cells per second
  hp: number;         // multiplier on wave base HP
  bounty: number;     // multiplier on wave bounty
  lives: number;      // lives lost on leak
  flying?: boolean;
  immune?: boolean;   // magic immune: no magic damage, no slow/stun
  invisible?: boolean;
  regen?: number;     // fraction of max HP per second
  heal?: { pct: number; range: number; cd: number };
  split?: { into: string; count: number };
  boss?: boolean;
  shape: EnemyShape;
  color: number;
  color2: number;
  scale: number;
}

const e = (d: EnemyDef) => d;

export const ENEMIES: EnemyDef[] = [
  e({ id: 'ghoul', name: 'Ghul', desc: 'Ausgehungerte Untote.', armorType: 'medium', armor: 0, speed: 3, hp: 1, bounty: 1, lives: 1, shape: 'biped', color: 0x8d8f6a, color2: 0x3e3a2a, scale: 0.8 }),
  e({ id: 'wolf', name: 'Timberwolf', desc: 'Schnell, aber zerbrechlich.', armorType: 'light', armor: 0, speed: 4.4, hp: 0.65, bounty: 0.8, lives: 1, shape: 'beast', color: 0x7b7b7b, color2: 0xdddddd, scale: 0.75 }),
  e({ id: 'murloc', name: 'Murloc', desc: 'Mrglglgl!', armorType: 'unarmored', armor: 0, speed: 3.2, hp: 0.9, bounty: 1, lives: 1, shape: 'fish', color: 0x3fa36b, color2: 0xe0c070, scale: 0.7 }),
  e({ id: 'bat', name: 'Vampirfledermaus', desc: 'Luft-Einheit.', armorType: 'light', armor: 0, speed: 3.6, hp: 0.8, bounty: 1, lives: 1, flying: true, shape: 'flyer', color: 0x4a2f4f, color2: 0xa04060, scale: 0.7 }),
  e({ id: 'gnoll', name: 'Gnoll-Plünderer', desc: 'Leicht gepanzerte Banditen.', armorType: 'light', armor: 1, speed: 3, hp: 1.05, bounty: 1, lives: 1, shape: 'biped', color: 0xa67c52, color2: 0x5a3d22, scale: 0.85 }),
  e({ id: 'troll', name: 'Waldtroll', desc: 'Regeneriert Lebenspunkte.', armorType: 'medium', armor: 2, speed: 3, hp: 1.1, bounty: 1.1, lives: 1, regen: 0.02, shape: 'biped', color: 0x3f8f8f, color2: 0x6b3f2a, scale: 0.9 }),
  e({ id: 'spider', name: 'Nerubische Spinne', desc: 'Zerfällt bei Tod in zwei Spinnlinge.', armorType: 'medium', armor: 1, speed: 3.3, hp: 0.9, bounty: 0.8, lives: 1, split: { into: 'spiderling', count: 2 }, shape: 'spider', color: 0x2f2f3f, color2: 0x8a7a40, scale: 0.85 }),
  e({ id: 'spiderling', name: 'Spinnling', desc: 'Klein und flink.', armorType: 'medium', armor: 0, speed: 3.8, hp: 0.3, bounty: 0.2, lives: 1, shape: 'spider', color: 0x3f3f4f, color2: 0x8a7a40, scale: 0.5 }),
  e({ id: 'shade', name: 'Schatten', desc: 'UNSICHTBAR – braucht Türme mit Erkennung!', armorType: 'light', armor: 0, speed: 3.2, hp: 0.85, bounty: 1.2, lives: 1, invisible: true, shape: 'biped', color: 0x6a5acd, color2: 0x1a1a40, scale: 0.85 }),
  e({ id: 'ogre', name: 'Oger', desc: 'Schwer gepanzert und zäh.', armorType: 'heavy', armor: 3, speed: 2.6, hp: 1.7, bounty: 1.4, lives: 1, shape: 'biped', color: 0xb07040, color2: 0x604020, scale: 1.15 }),
  e({ id: 'abomination', name: 'Monstrosität', desc: 'BOSS: Ein gewaltiges Flickwerk aus Leichen.', armorType: 'hero', armor: 5, speed: 2.2, hp: 10, bounty: 20, lives: 10, boss: true, regen: 0.004, shape: 'golem', color: 0x9caf88, color2: 0x6b2a2a, scale: 2.0 }),
  e({ id: 'harpy', name: 'Harpyie', desc: 'Luft-Einheit mit leichter Rüstung.', armorType: 'light', armor: 1, speed: 3.5, hp: 0.95, bounty: 1, lives: 1, flying: true, shape: 'flyer', color: 0x9b6b9b, color2: 0xe0b0e0, scale: 0.8 }),
  e({ id: 'slime', name: 'Schleim', desc: 'Teilt sich bei Tod in zwei kleine Schleime.', armorType: 'unarmored', armor: 0, speed: 2.8, hp: 1.2, bounty: 0.8, lives: 1, split: { into: 'slimelet', count: 2 }, shape: 'blob', color: 0x66dd55, color2: 0x228822, scale: 0.9 }),
  e({ id: 'slimelet', name: 'Schleimling', desc: 'Kleiner Schleim.', armorType: 'unarmored', armor: 0, speed: 3.2, hp: 0.4, bounty: 0.2, lives: 1, shape: 'blob', color: 0x88ee77, color2: 0x228822, scale: 0.55 }),
  e({ id: 'skeleton', name: 'Skelettkrieger', desc: 'Klappernde Knochen.', armorType: 'heavy', armor: 2, speed: 3, hp: 1, bounty: 1, lives: 1, shape: 'biped', color: 0xe8e0c8, color2: 0x555555, scale: 0.85 }),
  e({ id: 'necro', name: 'Nekromant', desc: 'Heilt nahe Verbündete.', armorType: 'unarmored', armor: 1, speed: 2.8, hp: 1.1, bounty: 1.5, lives: 1, heal: { pct: 0.08, range: 3, cd: 2 }, shape: 'biped', color: 0x3a1a4a, color2: 0x80ff80, scale: 0.9 }),
  e({ id: 'golem', name: 'Felsgolem', desc: 'MAGIEIMMUN und befestigt.', armorType: 'fortified', armor: 4, speed: 2.3, hp: 1.8, bounty: 1.5, lives: 1, immune: true, shape: 'golem', color: 0x8a8a7a, color2: 0x5a5a4a, scale: 1.1 }),
  e({ id: 'centaur', name: 'Zentaur', desc: 'Schnelle mittlere Rüstung.', armorType: 'medium', armor: 2, speed: 4.0, hp: 1, bounty: 1.1, lives: 1, shape: 'beast', color: 0x8b5a2b, color2: 0xd2b48c, scale: 1.0 }),
  e({ id: 'gargoyle', name: 'Gargoyle', desc: 'Schwer gepanzerte Luft-Einheit.', armorType: 'heavy', armor: 3, speed: 3.2, hp: 1.3, bounty: 1.2, lives: 1, flying: true, shape: 'flyer', color: 0x5a5a6a, color2: 0x903030, scale: 0.95 }),
  e({ id: 'naga', name: 'Naga-Sirene', desc: 'Heilt Verbündete, mittlere Rüstung.', armorType: 'medium', armor: 3, speed: 2.9, hp: 1.3, bounty: 1.4, lives: 1, heal: { pct: 0.1, range: 3, cd: 2.5 }, shape: 'fish', color: 0x2f7f9f, color2: 0xd0a040, scale: 1.0 }),
  e({ id: 'satyr', name: 'Satyr-Schattentänzer', desc: 'UNSICHTBAR und schnell.', armorType: 'medium', armor: 2, speed: 3.8, hp: 1, bounty: 1.3, lives: 1, invisible: true, shape: 'beast', color: 0x6b3a5a, color2: 0x2a1a2a, scale: 0.9 }),
  e({ id: 'pitlord', name: 'Grubenlord', desc: 'BOSS: Dämonischer Koloss mit Regeneration.', armorType: 'hero', armor: 7, speed: 2.0, hp: 12, bounty: 30, lives: 10, boss: true, regen: 0.006, shape: 'demon', color: 0x7a2a1a, color2: 0x3a3a3a, scale: 2.2 }),
  e({ id: 'giant', name: 'Berggigant', desc: 'Befestigt, sehr zäh, regeneriert.', armorType: 'fortified', armor: 5, speed: 2.1, hp: 2.6, bounty: 1.8, lives: 2, regen: 0.01, shape: 'golem', color: 0x6a7a5a, color2: 0x4a3a2a, scale: 1.4 }),
  e({ id: 'felhound', name: 'Teufelshund', desc: 'MAGIEIMMUN und schnell.', armorType: 'medium', armor: 3, speed: 4.0, hp: 1.1, bounty: 1.3, lives: 1, immune: true, shape: 'beast', color: 0x8a2a1a, color2: 0x40ff40, scale: 0.95 }),
  e({ id: 'whelp', name: 'Drachenwelpe', desc: 'Junge Drachen in der Luft.', armorType: 'medium', armor: 3, speed: 3.4, hp: 1.2, bounty: 1.2, lives: 1, flying: true, shape: 'dragon', color: 0x2a5aaf, color2: 0x9fd8ff, scale: 0.8 }),
  e({ id: 'frostwyrm', name: 'Frostwyrm', desc: 'BOSS: Untoter Drache – fliegt!', armorType: 'hero', armor: 8, speed: 2.1, hp: 12, bounty: 40, lives: 15, boss: true, flying: true, shape: 'dragon', color: 0x9fd8ff, color2: 0x30508f, scale: 2.2 }),
  e({ id: 'infernal', name: 'Höllenbestie', desc: 'Magieimmun, befestigt, zerbricht in zwei Teile.', armorType: 'fortified', armor: 6, speed: 2.4, hp: 2.2, bounty: 1.6, lives: 2, immune: true, split: { into: 'felhound', count: 2 }, shape: 'golem', color: 0x3a6a2a, color2: 0x80ff40, scale: 1.3 }),
  e({ id: 'doomguard', name: 'Verdammniswache', desc: 'Elite-Dämonen in schwerer Rüstung.', armorType: 'heavy', armor: 6, speed: 2.9, hp: 2.4, bounty: 1.8, lives: 2, shape: 'demon', color: 0xa02020, color2: 0xffa040, scale: 1.25 }),
  e({ id: 'demonlord', name: 'Dämonenfürst', desc: 'ENDBOSS: Der Verschlinger der Welten.', armorType: 'hero', armor: 10, speed: 1.8, hp: 30, bounty: 80, lives: 50, boss: true, regen: 0.004, shape: 'demon', color: 0x4a1a6a, color2: 0x40ff80, scale: 2.8 }),
];

export const ENEMY_BY_ID: Record<string, EnemyDef> = Object.fromEntries(ENEMIES.map((d) => [d.id, d]));
export const ENEMY_INDEX: Record<string, number> = Object.fromEntries(ENEMIES.map((d, i) => [d.id, i]));
