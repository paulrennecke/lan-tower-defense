import { ARMOR_NAMES, ATTACK_NAMES, DAMAGE_TABLE, type ArmorType, type AttackType } from '../../../shared/damage';
import type { TowerDef, TowerShape, TowerStats } from '../../../shared/data/classes';
import type { EnemyDef } from '../../../shared/data/enemies';

export const TOWER_ICONS: Record<TowerShape, string> = {
  watchtower: '🏹', cannon: '💣', arcane: '🔮', church: '⛪', gryphon: '🦅', mage: '⚡',
  spear: '🗡️', catapult: '🪨', drum: '🥁', shaman: '🌩️', wyvern: '🐉', fortress: '🏯',
  ziggurat: '💀', plague: '☣️', frost: '❄️', wagon: '🛒', obelisk: '🗿', throne: '👑',
  ancient: '🌳', moonwell: '🌙', vines: '🌿', dryad: '🍃', nest: '🪶', worldtree: '🌲',
  fire: '🔥', water: '💧', earth: '⛰️', air: '🌪️', magma: '🌋', vortex: '🌀',
  gun: '🔫', rocket: '🚀', tesla: '🔌', mines: '💥', bank: '💰', zeppelin: '🎈',
};

export const CLASS_ICONS: Record<string, string> = {
  human: '🛡️', orc: '🪓', undead: '☠️', nightelf: '🌙', element: '🔥', goblin: '⚙️',
};

export const ENEMY_ICONS: Record<string, string> = {
  biped: '👹', beast: '🐺', spider: '🕷️', flyer: '🦇', golem: '🗿', blob: '🟢', dragon: '🐉', demon: '😈', fish: '🐟',
};

export const hex = (c: number) => '#' + c.toString(16).padStart(6, '0');
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export const fmt = (n: number) => (n >= 10000 ? (n / 1000).toFixed(1) + 'k' : Math.round(n).toString());

export function statLines(s: TowerStats, base?: TowerStats): [string, string][] {
  const lines: [string, string][] = [];
  const bonus = (v: number, b?: number, dec = 0) => (b !== undefined && Math.abs(v - b) > 0.001 ? ` <span class="good">(+${(v - b).toFixed(dec)})</span>` : '');
  if (s.dmg > 0) {
    lines.push(['Schaden', `${Math.round(s.dmg * 0.85)}–${Math.round(s.dmg * 1.15)}${bonus(s.dmg, base?.dmg)}`]);
    lines.push(['Angriffstyp', ATTACK_NAMES[s.atk]]);
    lines.push(['Angriffstempo', `${s.cd.toFixed(2)} s${base && base.cd - s.cd > 0.001 ? ` <span class="good">(−${(base.cd - s.cd).toFixed(2)})</span>` : ''}`]);
  }
  if (s.range > 0) lines.push(['Reichweite', `${s.range.toFixed(1)}${bonus(s.range, base?.range, 1)}`]);
  if (s.dmg > 0 || s.mine) lines.push(['Ziele', s.ground && s.air ? 'Boden & Luft' : s.air ? 'Nur Luft' : 'Nur Boden']);
  if (s.splash) lines.push(['Flächenschaden', `Radius ${s.splash}`]);
  if (s.multi) lines.push(['Mehrfachschuss', `${s.multi} Ziele`]);
  if (s.chain) lines.push(['Kettenblitz', `${s.chain} Sprünge (−${Math.round((1 - (s.chainFalloff ?? 0.8)) * 100)}%)`]);
  if (s.slow) lines.push(['Verlangsamung', `${Math.round(s.slow * 100)}% für ${s.slowDur ?? 2}s`]);
  if (s.dot) lines.push(['Gift/Brand', `${Math.round(s.dot)}/s für ${s.dotDur ?? 3}s`]);
  if (s.stun) lines.push(['Betäubung', `${Math.round(s.stun * 100)}% für ${s.stunDur ?? 0.5}s`]);
  if (s.armorRed) lines.push(['Rüstung senken', `−${s.armorRed} für ${s.armorRedDur ?? 5}s`]);
  if (s.crit) lines.push(['Kritisch', `${Math.round(s.crit * 100)}% ×${s.critMult ?? 2}`]);
  if (s.aura) {
    const parts = [];
    if (s.aura.speed) parts.push(`+${Math.round(s.aura.speed * 100)}% Tempo`);
    if (s.aura.dmg) parts.push(`+${Math.round(s.aura.dmg * 100)}% Schaden`);
    lines.push(['Aura', `${parts.join(', ')} (R ${s.aura.range})`]);
  }
  if (s.detect) lines.push(['Erkennung', 'Deckt Unsichtbare auf']);
  if (s.mine) lines.push(['Minen', `${Math.round(s.mine.dmg)} Schaden, max. ${s.mine.max}`]);
  if (s.income) lines.push(['Einkommen', `+${s.income} Gold/Welle`]);
  return lines;
}

export function towerTooltip(def: TowerDef, level = 0, extra = ''): string {
  const s = def.levels[level];
  const cost = level === 0 ? `${def.cost} Gold${def.lumber ? `, ${def.lumber} Holz` : ''}` : '';
  return `<h4>${TOWER_ICONS[def.shape]} ${esc(def.levelNames[level])}</h4>
    <div class="muted">${esc(def.desc)}</div>
    ${cost ? `<div class="gold">Kosten: ${cost}</div>` : ''}
    ${extra}
    <div style="margin-top:4px">${statLines(s).map(([k, v]) => `<div class="line"><span class="muted">${k}</span><span>${v}</span></div>`).join('')}</div>
    ${s.dmg > 0 ? `<div style="margin-top:4px;font-size:12px">${effectivenessLine(s.atk)}</div>` : ''}`;
}

export function effectivenessLine(atk: AttackType): string {
  const row = DAMAGE_TABLE[atk];
  const good = (Object.keys(row) as ArmorType[]).filter((a) => row[a] > 1).map((a) => ARMOR_NAMES[a]);
  const bad = (Object.keys(row) as ArmorType[]).filter((a) => row[a] < 1).map((a) => ARMOR_NAMES[a]);
  return `${good.length ? `<span class="good">Stark: ${good.join(', ')}</span>` : ''} ${bad.length ? `<span class="bad">Schwach: ${bad.join(', ')}</span>` : ''}`;
}

export function enemyTags(d: EnemyDef): string {
  const t: string[] = [];
  if (d.boss) t.push('<span class="tag warn">BOSS</span>');
  if (d.flying) t.push('<span class="tag air">Luft</span>');
  if (d.immune) t.push('<span class="tag imm">Magieimmun</span>');
  if (d.invisible) t.push('<span class="tag inv">Unsichtbar</span>');
  if (d.heal) t.push('<span class="tag">Heiler</span>');
  if (d.regen && !d.boss) t.push('<span class="tag">Regeneration</span>');
  if (d.split) t.push('<span class="tag">Teilt sich</span>');
  if (d.speed >= 3.8) t.push('<span class="tag">Schnell</span>');
  return t.join('');
}

export function damageTableHtml(): string {
  const atks = Object.keys(ATTACK_NAMES) as AttackType[];
  const arms = Object.keys(ARMOR_NAMES) as ArmorType[];
  return `<table class="dmg"><tr><th>Angriff \\ Rüstung</th>${arms.map((a) => `<th>${ARMOR_NAMES[a]}</th>`).join('')}</tr>
    ${atks.map((a) => `<tr><th>${ATTACK_NAMES[a]}</th>${arms.map((r) => {
      const v = DAMAGE_TABLE[a][r];
      return `<td class="${v > 1 ? 'good' : v < 1 ? 'bad' : ''}">${Math.round(v * 100)}%</td>`;
    }).join('')}</tr>`).join('')}</table>`;
}
