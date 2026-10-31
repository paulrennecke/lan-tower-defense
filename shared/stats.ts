import { RESEARCH_BY_ID, TOWER_BY_ID, type TowerStats } from './data/classes';

export interface TowerLike { id: number; def: string; level: number; cx: number; cy: number; owner: string }

export interface Buffs { dmg: number; speed: number }

/** Strongest aura buffs (they do not stack per type) affecting a tower from other towers in range. */
export function auraBuffs(t: TowerLike, towers: Iterable<TowerLike>): Buffs {
  let dmg = 0, speed = 0;
  for (const o of towers) {
    if (o.id === t.id) continue;
    const aura = TOWER_BY_ID[o.def].levels[o.level].aura;
    if (!aura || Math.hypot(o.cx - t.cx, o.cy - t.cy) > aura.range) continue;
    dmg = Math.max(dmg, aura.dmg ?? 0);
    speed = Math.max(speed, aura.speed ?? 0);
  }
  return { dmg, speed };
}

/** Applies research of the owner and aura buffs to the base stats of a tower level. */
export function effectiveStats(defId: string, level: number, research: Record<string, number>, buffs: Buffs): TowerStats {
  const base = TOWER_BY_ID[defId].levels[level];
  let dmgPct = 0, speedPct = 0, rangePct = 0, crit = 0, dotPct = 0;
  for (const [rid, lvl] of Object.entries(research)) {
    const eff = RESEARCH_BY_ID[rid]?.perLevel;
    if (!eff) continue;
    dmgPct += (eff.dmgPct ?? 0) * lvl;
    speedPct += (eff.speedPct ?? 0) * lvl;
    rangePct += (eff.rangePct ?? 0) * lvl;
    crit += (eff.crit ?? 0) * lvl;
    dotPct += (eff.dotPct ?? 0) * lvl;
  }
  const dm = 1 + dmgPct + buffs.dmg;
  const s: TowerStats = {
    ...base,
    dmg: base.dmg * dm,
    cd: base.cd / (1 + speedPct + buffs.speed),
    range: base.range * (1 + rangePct),
  };
  if (base.dot) s.dot = base.dot * dm * (1 + dotPct);
  if (crit || base.crit) { s.crit = (base.crit ?? 0) + crit; s.critMult = base.critMult ?? 2; }
  if (base.mine) s.mine = { ...base.mine, dmg: base.mine.dmg * dm };
  return s;
}
