export type AttackType = 'normal' | 'pierce' | 'siege' | 'magic' | 'chaos';
export type ArmorType = 'unarmored' | 'light' | 'medium' | 'heavy' | 'fortified' | 'hero';

export const ATTACK_NAMES: Record<AttackType, string> = {
  normal: 'Normal',
  pierce: 'Durchbohren',
  siege: 'Belagerung',
  magic: 'Magie',
  chaos: 'Chaos',
};

export const ARMOR_NAMES: Record<ArmorType, string> = {
  unarmored: 'Ungerüstet',
  light: 'Leicht',
  medium: 'Mittel',
  heavy: 'Schwer',
  fortified: 'Befestigt',
  hero: 'Held',
};

/** Classic Warcraft 3 damage table (attack type vs. armor type). */
export const DAMAGE_TABLE: Record<AttackType, Record<ArmorType, number>> = {
  normal: { unarmored: 1.0, light: 1.0, medium: 1.5, heavy: 1.0, fortified: 0.7, hero: 1.0 },
  pierce: { unarmored: 1.5, light: 2.0, medium: 0.75, heavy: 1.0, fortified: 0.35, hero: 0.5 },
  siege: { unarmored: 1.5, light: 1.0, medium: 0.5, heavy: 1.0, fortified: 1.5, hero: 0.5 },
  magic: { unarmored: 1.0, light: 1.25, medium: 0.75, heavy: 2.0, fortified: 0.35, hero: 0.5 },
  chaos: { unarmored: 1.0, light: 1.0, medium: 1.0, heavy: 1.0, fortified: 1.0, hero: 1.0 },
};

/** WC3 armor formula: each point of armor reduces damage by ~6% (diminishing). */
export function armorMultiplier(armor: number): number {
  if (armor >= 0) return 1 - (armor * 0.06) / (1 + armor * 0.06);
  return 2 - Math.pow(0.94, -armor);
}

export function computeDamage(
  base: number,
  atk: AttackType,
  armorType: ArmorType,
  armor: number,
  magicImmune: boolean,
): number {
  if (magicImmune && atk === 'magic') return 0;
  return base * DAMAGE_TABLE[atk][armorType] * armorMultiplier(armor);
}
