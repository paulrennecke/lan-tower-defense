import type { AttackType } from '../damage';

export type ProjKind =
  | 'arrow' | 'cannon' | 'orb' | 'bolt' | 'spear' | 'rock' | 'lightning' | 'poison'
  | 'frost' | 'skull' | 'fire' | 'water' | 'wind' | 'bullet' | 'rocket' | 'leaf' | 'moon' | 'none';

export interface Aura { range: number; speed?: number; dmg?: number }

export interface TowerStats {
  dmg: number;        // average base damage per hit
  cd: number;         // seconds between attacks
  range: number;      // cells
  atk: AttackType;
  ground: boolean;
  air: boolean;
  proj: ProjKind;
  projSpeed: number;  // cells/s, 0 = instant
  splash?: number;    // radius in cells
  slow?: number;      // 0..1
  slowDur?: number;
  dot?: number;       // damage per second
  dotDur?: number;
  stun?: number;      // chance 0..1
  stunDur?: number;
  chain?: number;     // extra jumps
  chainFalloff?: number;
  armorRed?: number;
  armorRedDur?: number;
  multi?: number;     // number of simultaneous targets
  crit?: number;
  critMult?: number;
  aura?: Aura;
  detect?: boolean;   // reveals invisible enemies within range
  mine?: { dmg: number; radius: number; max: number };
  income?: number;    // gold per wave
}

export type TowerShape =
  | 'watchtower' | 'cannon' | 'arcane' | 'church' | 'gryphon' | 'mage'
  | 'spear' | 'catapult' | 'drum' | 'shaman' | 'wyvern' | 'fortress'
  | 'ziggurat' | 'plague' | 'frost' | 'wagon' | 'obelisk' | 'throne'
  | 'ancient' | 'moonwell' | 'vines' | 'dryad' | 'nest' | 'worldtree'
  | 'fire' | 'water' | 'earth' | 'air' | 'magma' | 'vortex'
  | 'gun' | 'rocket' | 'tesla' | 'mines' | 'bank' | 'zeppelin';

export interface TowerDef {
  id: string;
  cls: string;
  name: string;
  levelNames: [string, string, string];
  desc: string;
  cost: number;
  lumber: number;
  upCost: [number, number];
  upLumber: [number, number];
  levels: [TowerStats, TowerStats, TowerStats];
  shape: TowerShape;
  color: number;
  requires?: string;
}

export interface ResearchEffect {
  dmgPct?: number;
  speedPct?: number;
  rangePct?: number;
  crit?: number;
  bounty?: number;
  dotPct?: number;
  income?: number;
  unlock?: string;
}

export interface ResearchDef {
  id: string;
  name: string;
  desc: string;
  maxLevel: number;
  gold: number[];
  lumber: number[];
  perLevel: ResearchEffect;
}

export interface ClassDef {
  id: string;
  name: string;
  desc: string;
  color: number;
  towers: TowerDef[];
  research: ResearchDef[];
}

type Over = Partial<TowerStats>;

/** Builds a tower with 3 levels. Damage scales x2.3 / x5 unless overridden. */
function tower(
  cls: string, id: string, name: string, levelNames: [string, string, string], desc: string,
  cost: number, base: TowerStats, shape: TowerShape, color: number,
  opts: { lumber?: number; up?: [number, number]; upLumber?: [number, number]; l2?: Over; l3?: Over; requires?: string; dmgMul?: [number, number] } = {},
): TowerDef {
  const m = opts.dmgMul ?? [2.3, 5.0];
  const scale = (lvl: 1 | 2, over: Over | undefined): TowerStats => {
    const mul = m[lvl - 1];
    const s: TowerStats = { ...base, dmg: base.dmg * mul, range: base.range + 0.5 * lvl };
    if (s.dot) s.dot = s.dot * mul;
    if (s.mine) s.mine = { ...s.mine, dmg: s.mine.dmg * mul, max: s.mine.max + lvl * 2 };
    if (s.aura) s.aura = { ...s.aura, range: s.aura.range + 0.5 * lvl };
    return { ...s, ...over };
  };
  return {
    id, cls, name, levelNames, desc, cost,
    lumber: opts.lumber ?? 0,
    upCost: opts.up ?? [Math.round(cost * 1.1), Math.round(cost * 2.4)],
    upLumber: opts.upLumber ?? [0, 0],
    levels: [base, scale(1, opts.l2), scale(2, opts.l3)],
    shape, color, requires: opts.requires,
  };
}

const B = (s: Partial<TowerStats> & Pick<TowerStats, 'dmg' | 'cd' | 'range' | 'atk' | 'proj'>): TowerStats => ({
  ground: true, air: true, projSpeed: 16, ...s,
});

const dmgResearch = (id: string, name: string, desc: string): ResearchDef => ({
  id, name, desc, maxLevel: 3, gold: [150, 350, 700], lumber: [1, 2, 3], perLevel: { dmgPct: 0.12 },
});
const speedResearch = (id: string, name: string, desc: string): ResearchDef => ({
  id, name, desc, maxLevel: 3, gold: [150, 350, 700], lumber: [1, 2, 3], perLevel: { speedPct: 0.1 },
});
const unlockResearch = (id: string, name: string, desc: string, towerId: string, gold = 400, lumber = 3): ResearchDef => ({
  id, name, desc, maxLevel: 1, gold: [gold], lumber: [lumber], perLevel: { unlock: towerId },
});

// ---------------------------------------------------------------- Allianz
const H = 'human';
const human: ClassDef = {
  id: H, name: 'Allianz', color: 0x3b6fd6,
  desc: 'Disziplinierte Menschen mit soliden Allroundern: Bogenschützen, Kanonen und Arkanmagie. Leicht zu spielen.',
  towers: [
    tower(H, 'h_watch', 'Wachturm', ['Wachturm', 'Wehrturm', 'Bergfried'], 'Schneller Pfeilturm gegen Boden & Luft.', 90,
      B({ dmg: 15, cd: 0.85, range: 5, atk: 'pierce', proj: 'arrow', projSpeed: 20 }), 'watchtower', 0x8a8f99),
    tower(H, 'h_cannon', 'Kanonenturm', ['Kanonenturm', 'Mörserturm', 'Belagerungsbastion'], 'Flächenschaden gegen Bodentruppen. Stark gegen Befestigt.', 130,
      B({ dmg: 34, cd: 2.0, range: 4.5, atk: 'siege', proj: 'cannon', projSpeed: 10, air: false, splash: 1.5 }), 'cannon', 0x6b6b6b),
    tower(H, 'h_arcane', 'Arkaner Turm', ['Arkaner Turm', 'Arkanes Heiligtum', 'Violette Zitadelle'], 'Magischer Schaden, deckt Unsichtbare auf. Stark gegen Schwer.', 120,
      B({ dmg: 24, cd: 1.3, range: 5, atk: 'magic', proj: 'orb', projSpeed: 14, detect: true }), 'arcane', 0x7a5cff),
    tower(H, 'h_church', 'Kirche', ['Kirche', 'Kathedrale', 'Kathedrale des Lichts'], 'Heilige Aura: erhöht das Angriffstempo naher Türme.', 150,
      B({ dmg: 8, cd: 1.5, range: 4, atk: 'magic', proj: 'orb', aura: { range: 4, speed: 0.15 } }), 'church', 0xf2e6b8,
      { l2: { aura: { range: 4.5, speed: 0.22 } }, l3: { aura: { range: 5, speed: 0.3 } } }),
    tower(H, 'h_gryphon', 'Greifenhorst', ['Greifenhorst', 'Greifenfeste', 'Sturmhammer-Horst'], 'Nur Luftziele, aber sehr hoher Schaden.', 120,
      B({ dmg: 30, cd: 0.8, range: 6, atk: 'normal', proj: 'bolt', projSpeed: 18, ground: false }), 'gryphon', 0xc9a227),
    tower(H, 'h_mage', 'Erzmagierturm', ['Erzmagierturm', 'Turm von Dalaran', 'Kirin Tor'], 'Ultimativ: Kettenblitz der auf viele Gegner überspringt.', 450,
      B({ dmg: 90, cd: 1.0, range: 6.5, atk: 'magic', proj: 'lightning', projSpeed: 0, chain: 4, chainFalloff: 0.85, detect: true }), 'mage', 0x4fc3ff,
      { lumber: 3, requires: 'h_r_mage', upLumber: [1, 2] }),
  ],
  research: [
    dmgResearch('h_r_dmg', 'Eisenschmiede', '+12% Schaden aller Türme je Stufe.'),
    speedResearch('h_r_speed', 'Drillausbildung', '+10% Angriffstempo je Stufe.'),
    { id: 'h_r_crit', name: 'Treffsicherheit', desc: '+8% Chance auf doppelten Schaden je Stufe.', maxLevel: 3, gold: [200, 400, 700], lumber: [1, 2, 2], perLevel: { crit: 0.08 } },
    unlockResearch('h_r_mage', 'Kirin-Tor-Pakt', 'Schaltet den Erzmagierturm frei.', 'h_mage'),
  ],
};

// ---------------------------------------------------------------- Horde
const O = 'orc';
const orc: ClassDef = {
  id: O, name: 'Horde', color: 0xc0392b,
  desc: 'Brutale Orcs mit Katapulten, Kettenblitzen und Kriegstrommeln, die nahe Türme in Raserei versetzen.',
  towers: [
    tower(O, 'o_spear', 'Speerwerfer', ['Speerwerfer', 'Kopfjäger-Bau', 'Berserker-Turm'], 'Wirft Speere auf Boden & Luft.', 85,
      B({ dmg: 16, cd: 1.0, range: 4.5, atk: 'pierce', proj: 'spear', projSpeed: 16 }), 'spear', 0x8b5a2b),
    tower(O, 'o_catapult', 'Katapult', ['Katapult', 'Zerstörer', 'Verwüster'], 'Riesige Reichweite und Flächenschaden gegen Boden.', 150,
      B({ dmg: 52, cd: 3.0, range: 6, atk: 'siege', proj: 'rock', projSpeed: 8, air: false, splash: 2.0 }), 'catapult', 0x7a4a1e),
    tower(O, 'o_drum', 'Kriegstrommel', ['Kriegstrommel', 'Donnertrommel', 'Trommel des Krieges'], 'Aura: erhöht den Schaden naher Türme.', 140,
      B({ dmg: 0, cd: 99, range: 0, atk: 'normal', proj: 'none', ground: false, air: false, aura: { range: 4.5, dmg: 0.15 } }), 'drum', 0xa0522d,
      { l2: { aura: { range: 5, dmg: 0.22 } }, l3: { aura: { range: 5.5, dmg: 0.3 } } }),
    tower(O, 'o_shaman', 'Schamanenturm', ['Schamanenturm', 'Geisterlodge', 'Thrall-Schrein'], 'Kettenblitz, deckt Unsichtbare auf (Geisterwolf-Sicht).', 140,
      B({ dmg: 26, cd: 1.6, range: 5, atk: 'magic', proj: 'lightning', projSpeed: 0, chain: 3, chainFalloff: 0.8, detect: true }), 'shaman', 0x3fa9f5),
    tower(O, 'o_wyvern', 'Windreiter-Horst', ['Windreiter-Horst', 'Windreiter-Bau', 'Himmelsfeste'], 'Nur Luft. Fangnetz kann Flieger betäuben.', 120,
      B({ dmg: 26, cd: 0.7, range: 6, atk: 'pierce', proj: 'spear', projSpeed: 20, ground: false, stun: 0.15, stunDur: 1 }), 'wyvern', 0x9b3d2f),
    tower(O, 'o_fortress', 'Festung des Häuptlings', ['Festung des Häuptlings', 'Höllschrei-Feste', 'Zorn des Kriegshäuptlings'], 'Ultimativ: Erdbeben mit Chaos-Schaden in großem Radius.', 450,
      B({ dmg: 130, cd: 1.4, range: 4, atk: 'chaos', proj: 'none', projSpeed: 0, air: false, splash: 2.5, stun: 0.15, stunDur: 0.6 }), 'fortress', 0x5c1f14,
      { lumber: 3, requires: 'o_r_fort', upLumber: [1, 2] }),
  ],
  research: [
    dmgResearch('o_r_dmg', 'Kriegsmühle', '+12% Schaden aller Türme je Stufe.'),
    speedResearch('o_r_speed', 'Blutrausch', '+10% Angriffstempo je Stufe.'),
    { id: 'o_r_loot', name: 'Plündern', desc: '+1 Gold für jeden Kill deiner Türme je Stufe.', maxLevel: 3, gold: [150, 300, 500], lumber: [1, 1, 2], perLevel: { bounty: 1 } },
    unlockResearch('o_r_fort', 'Ruf des Kriegshäuptlings', 'Schaltet die Festung des Häuptlings frei.', 'o_fortress'),
  ],
};

// ---------------------------------------------------------------- Untote
const U = 'undead';
const undead: ClassDef = {
  id: U, name: 'Geißel', color: 0x7d3c98,
  desc: 'Die Untoten verlangsamen, vergiften und zersetzen die Rüstung ihrer Feinde. Stark im Zusammenspiel.',
  towers: [
    tower(U, 'u_spirit', 'Geisterturm', ['Geisterturm', 'Nerubischer Turm', 'Ziggurat der Verdammnis'], 'Seelenprojektile gegen Boden & Luft.', 100,
      B({ dmg: 19, cd: 0.95, range: 5, atk: 'normal', proj: 'skull', projSpeed: 15 }), 'ziggurat', 0x5b4a7a),
    tower(U, 'u_plague', 'Seuchenturm', ['Seuchenturm', 'Pestkessel', 'Seuchenquelle'], 'Giftwolke: Flächenschaden über Zeit.', 120,
      B({ dmg: 6, cd: 1.5, range: 4, atk: 'normal', proj: 'poison', projSpeed: 10, air: false, splash: 1.6, dot: 12, dotDur: 4 }), 'plague', 0x6fbf3a),
    tower(U, 'u_frost', 'Frostturm', ['Frostturm', 'Eisturm', 'Turm des Lichkönigs'], 'Verlangsamt Gegner stark.', 110,
      B({ dmg: 10, cd: 1.2, range: 4.5, atk: 'magic', proj: 'frost', projSpeed: 14, slow: 0.25, slowDur: 2 }), 'frost', 0x9fd8ff,
      { l2: { slow: 0.35 }, l3: { slow: 0.45 } }),
    tower(U, 'u_wagon', 'Fleischwagen', ['Fleischwagen', 'Leichenkarren', 'Knochenkatapult'], 'Wirft Leichen: Fläche + Seuche gegen Boden.', 150,
      B({ dmg: 40, cd: 2.5, range: 6, atk: 'siege', proj: 'skull', projSpeed: 8, air: false, splash: 1.5, dot: 8, dotDur: 3 }), 'wagon', 0x6d5a4a),
    tower(U, 'u_obelisk', 'Obsidianstatue', ['Obsidianstatue', 'Schattenobelisk', 'Monolith der Verzweiflung'], 'Chaos-Schaden, senkt Rüstung, deckt Unsichtbare auf.', 140,
      B({ dmg: 14, cd: 1.0, range: 5, atk: 'chaos', proj: 'bolt', projSpeed: 18, armorRed: 3, armorRedDur: 5, detect: true }), 'obelisk', 0x222233,
      { l2: { armorRed: 5 }, l3: { armorRed: 8 } }),
    tower(U, 'u_throne', 'Frostthron', ['Frostthron', 'Eiskrone', 'Thron des Lichkönigs'], 'Ultimativ: Frostnova – Flächenschaden, massiver Slow, Betäubung.', 450,
      B({ dmg: 75, cd: 1.5, range: 5.5, atk: 'magic', proj: 'frost', projSpeed: 12, splash: 2.5, slow: 0.5, slowDur: 2.5, stun: 0.15, stunDur: 1 }), 'throne', 0x6ec6ff,
      { lumber: 3, requires: 'u_r_throne', upLumber: [1, 2] }),
  ],
  research: [
    dmgResearch('u_r_dmg', 'Nekromantie', '+12% Schaden aller Türme je Stufe.'),
    speedResearch('u_r_speed', 'Unheilige Raserei', '+10% Angriffstempo je Stufe.'),
    { id: 'u_r_dot', name: 'Seuchenwolke', desc: '+35% Gift-/Seuchenschaden je Stufe.', maxLevel: 3, gold: [150, 300, 500], lumber: [1, 1, 2], perLevel: { dotPct: 0.35 } },
    unlockResearch('u_r_throne', 'Wille des Lichkönigs', 'Schaltet den Frostthron frei.', 'u_throne'),
  ],
};

// ---------------------------------------------------------------- Nachtelfen
const N = 'nightelf';
const nightelf: ClassDef = {
  id: N, name: 'Nachtelfen', color: 0x1abc9c,
  desc: 'Uralte Wächter und Naturmagie. Kritische Treffer, Wurzeln und der Mondbrunnen stärken alle Türme in der Nähe.',
  towers: [
    tower(N, 'n_ancient', 'Uralter Schütze', ['Uralter Schütze', 'Uralter Wächter', 'Uralter Krieger'], 'Präzise Pfeile mit Chance auf kritische Treffer.', 95,
      B({ dmg: 15, cd: 0.8, range: 5.5, atk: 'pierce', proj: 'arrow', projSpeed: 20, crit: 0.15, critMult: 2 }), 'ancient', 0x4e7d3a),
    tower(N, 'n_moonwell', 'Mondbrunnen', ['Mondbrunnen', 'Mondquelle', 'Elunes Segen'], 'Aura: Angriffstempo + Schaden naher Türme. Deckt Unsichtbare auf.', 160,
      B({ dmg: 0, cd: 99, range: 4, atk: 'magic', proj: 'none', ground: false, air: false, detect: true, aura: { range: 4, speed: 0.1, dmg: 0.08 } }), 'moonwell', 0x7fd3ff,
      { l2: { aura: { range: 4.5, speed: 0.15, dmg: 0.12 } }, l3: { aura: { range: 5, speed: 0.2, dmg: 0.16 } } }),
    tower(N, 'n_vines', 'Dornenranke', ['Dornenranke', 'Wurzelgeflecht', 'Herz des Waldes'], 'Wurzeln halten Bodengegner fest.', 110,
      B({ dmg: 16, cd: 1.3, range: 4, atk: 'normal', proj: 'leaf', projSpeed: 14, air: false, stun: 0.25, stunDur: 0.8 }), 'vines', 0x2e7d32,
      { l2: { stun: 0.3 }, l3: { stun: 0.35, stunDur: 1.1 } }),
    tower(N, 'n_dryad', 'Dryadenhain', ['Dryadenhain', 'Cenarius-Hain', 'Hain der Ewigkeit'], 'Giftspeere verlangsamen. Eulenwächter decken Unsichtbare auf.', 120,
      B({ dmg: 20, cd: 0.9, range: 5, atk: 'pierce', proj: 'spear', projSpeed: 18, slow: 0.15, slowDur: 1.5, detect: true }), 'dryad', 0x8bc34a),
    tower(N, 'n_nest', 'Hippogreifen-Nest', ['Hippogreifen-Nest', 'Hippogreifen-Horst', 'Sturmkrähen-Nest'], 'Nur Luft, sehr schnelle Angriffe.', 120,
      B({ dmg: 22, cd: 0.6, range: 6.5, atk: 'normal', proj: 'moon', projSpeed: 20, ground: false }), 'nest', 0x9575cd),
    tower(N, 'n_worldtree', 'Weltenbaum', ['Weltenbaum', 'Nordrassil', 'Teldrassil'], 'Ultimativ: schießt auf 3 Ziele, Aura + Unsichtbarkeitserkennung.', 450,
      B({ dmg: 45, cd: 0.7, range: 6, atk: 'normal', proj: 'leaf', projSpeed: 18, multi: 3, detect: true, aura: { range: 5, speed: 0.15 } }), 'worldtree', 0x2ecc71,
      { lumber: 3, requires: 'n_r_tree', upLumber: [1, 2] }),
  ],
  research: [
    dmgResearch('n_r_dmg', 'Klingen des Mondes', '+12% Schaden aller Türme je Stufe.'),
    { id: 'n_r_range', name: 'Elunes Licht', desc: '+8% Reichweite je Stufe.', maxLevel: 3, gold: [150, 300, 500], lumber: [1, 1, 2], perLevel: { rangePct: 0.08 } },
    speedResearch('n_r_speed', 'Mondklingen', '+10% Angriffstempo je Stufe.'),
    unlockResearch('n_r_tree', 'Samen des Weltenbaums', 'Schaltet den Weltenbaum frei.', 'n_worldtree'),
  ],
};

// ---------------------------------------------------------------- Elementar
const E = 'element';
const element: ClassDef = {
  id: E, name: 'Elementarist', color: 0xe67e22,
  desc: 'Wie Element TD: Feuer, Wasser, Erde und Luft – erforsche Fusionen für den Magmaturm und den Elementarvortex.',
  towers: [
    tower(E, 'e_fire', 'Feuerturm', ['Feuerturm', 'Flammenturm', 'Inferno'], 'Brennt Gegner (Schaden über Zeit) in kleinem Radius.', 110,
      B({ dmg: 18, cd: 1.0, range: 4.5, atk: 'magic', proj: 'fire', projSpeed: 14, splash: 1.0, dot: 6, dotDur: 3 }), 'fire', 0xff5722),
    tower(E, 'e_water', 'Wasserturm', ['Wasserturm', 'Flutturm', 'Gezeitenturm'], 'Verlangsamt mit Wasserstrahlen.', 110,
      B({ dmg: 14, cd: 1.0, range: 5, atk: 'magic', proj: 'water', projSpeed: 14, slow: 0.2, slowDur: 2 }), 'water', 0x2196f3,
      { l2: { slow: 0.28 }, l3: { slow: 0.36 } }),
    tower(E, 'e_earth', 'Erdturm', ['Erdturm', 'Felsturm', 'Bergfeste'], 'Schwere Felsen, Fläche & Betäubung gegen Boden.', 120,
      B({ dmg: 36, cd: 1.8, range: 4.5, atk: 'siege', proj: 'rock', projSpeed: 10, air: false, splash: 1.2, stun: 0.1, stunDur: 0.6 }), 'earth', 0x8d6e63),
    tower(E, 'e_air', 'Luftturm', ['Luftturm', 'Sturmturm', 'Zyklon'], 'Zwei Ziele gleichzeitig, deckt Unsichtbare auf.', 110,
      B({ dmg: 8, cd: 0.7, range: 5.5, atk: 'pierce', proj: 'wind', projSpeed: 22, multi: 2, detect: true }), 'air', 0xb2ebf2),
    tower(E, 'e_magma', 'Magmaturm', ['Magmaturm', 'Vulkan', 'Herz des Feuers'], 'Fusion Feuer+Erde: Chaos-Lava mit Brand.', 250,
      B({ dmg: 60, cd: 2.2, range: 5, atk: 'chaos', proj: 'fire', projSpeed: 9, air: false, splash: 1.6, dot: 10, dotDur: 3 }), 'magma', 0xd84315,
      { lumber: 1, requires: 'e_r_fusion' }),
    tower(E, 'e_vortex', 'Elementarvortex', ['Elementarvortex', 'Urgewalt', 'Avatar der Elemente'], 'Ultimativ: alle vier Elemente – Kette, Slow und Brand.', 450,
      B({ dmg: 55, cd: 0.5, range: 5, atk: 'magic', proj: 'lightning', projSpeed: 0, chain: 2, chainFalloff: 0.8, slow: 0.2, slowDur: 1.5, dot: 10, dotDur: 3 }), 'vortex', 0xffeb3b,
      { lumber: 3, requires: 'e_r_vortex', upLumber: [1, 2] }),
  ],
  research: [
    dmgResearch('e_r_dmg', 'Elementare Macht', '+12% Schaden aller Türme je Stufe.'),
    speedResearch('e_r_speed', 'Elementarer Fluss', '+10% Angriffstempo je Stufe.'),
    unlockResearch('e_r_fusion', 'Elementfusion', 'Schaltet den Magmaturm frei.', 'e_magma', 200, 1),
    unlockResearch('e_r_vortex', 'Konvergenz', 'Schaltet den Elementarvortex frei.', 'e_vortex'),
  ],
};

// ---------------------------------------------------------------- Goblins
const G = 'goblin';
const goblin: ClassDef = {
  id: G, name: 'Goblin-Ingenieure', color: 0xf1c40f,
  desc: 'Technik und Profit! Maschinengewehre, Raketen, Teslaspulen, Minen – und eine Bank, die Zinsen abwirft.',
  towers: [
    tower(G, 'g_gun', 'Maschinengewehr', ['Maschinengewehr', 'Gatling', 'Bleisturm'], 'Extrem schnelle, schwache Schüsse.', 100,
      B({ dmg: 5, cd: 0.3, range: 4.5, atk: 'normal', proj: 'bullet', projSpeed: 30 }), 'gun', 0x9e9e9e),
    tower(G, 'g_rocket', 'Raketenturm', ['Raketenturm', 'Raketenbatterie', 'Goblin-Artillerie'], 'Raketen mit Flächenschaden auf Boden & Luft.', 140,
      B({ dmg: 32, cd: 1.6, range: 6, atk: 'siege', proj: 'rocket', projSpeed: 11, splash: 1.2 }), 'rocket', 0xb71c1c),
    tower(G, 'g_tesla', 'Teslaspule', ['Teslaspule', 'Hochspannungsspule', 'Blitzableiter 9000'], 'Kettenblitze, Radar erkennt Unsichtbare.', 140,
      B({ dmg: 24, cd: 1.2, range: 4.5, atk: 'magic', proj: 'lightning', projSpeed: 0, chain: 3, chainFalloff: 0.75, stun: 0.1, stunDur: 0.3, detect: true }), 'tesla', 0x00e5ff),
    tower(G, 'g_mines', 'Minenleger', ['Minenleger', 'Sprengmeister', 'Bombenwerkstatt'], 'Verteilt Minen auf dem Pfad in Reichweite.', 120,
      B({ dmg: 0, cd: 2.5, range: 4, atk: 'siege', proj: 'none', air: false, mine: { dmg: 55, radius: 1.3, max: 6 } }), 'mines', 0x795548),
    tower(G, 'g_bank', 'Goblin-Bank', ['Goblin-Bank', 'Handelskontor', 'Goldenes Kartell'], 'Greift nicht an, bringt aber Gold zu jeder Welle.', 200,
      B({ dmg: 0, cd: 99, range: 0, atk: 'normal', proj: 'none', ground: false, air: false, income: 15 }), 'bank', 0xffd54f,
      { up: [250, 400], l2: { income: 38 }, l3: { income: 80 } }),
    tower(G, 'g_zeppelin', 'Zeppelin-Werft', ['Zeppelin-Werft', 'Bombenwerft', 'Goblin-Armada'], 'Ultimativ: Bombenteppich auf riesige Distanz.', 450,
      B({ dmg: 140, cd: 2.2, range: 8, atk: 'siege', proj: 'rocket', projSpeed: 9, splash: 2.5 }), 'zeppelin', 0xff9800,
      { lumber: 3, requires: 'g_r_zep', upLumber: [1, 2] }),
  ],
  research: [
    dmgResearch('g_r_dmg', 'Sprengstoff-Labor', '+12% Schaden aller Türme je Stufe.'),
    speedResearch('g_r_speed', 'Schmieröl', '+10% Angriffstempo je Stufe.'),
    { id: 'g_r_invest', name: 'Investitionen', desc: '+15 Gold zu jeder Welle je Stufe.', maxLevel: 3, gold: [150, 300, 450], lumber: [1, 1, 2], perLevel: { income: 15 } },
    unlockResearch('g_r_zep', 'Zeppelin-Baupläne', 'Schaltet die Zeppelin-Werft frei.', 'g_zeppelin'),
  ],
};

export const CLASSES: ClassDef[] = [human, orc, undead, nightelf, element, goblin];
export const CLASS_BY_ID: Record<string, ClassDef> = Object.fromEntries(CLASSES.map((c) => [c.id, c]));
export const TOWER_BY_ID: Record<string, TowerDef> = Object.fromEntries(CLASSES.flatMap((c) => c.towers.map((t) => [t.id, t])));
export const RESEARCH_BY_ID: Record<string, ResearchDef> = Object.fromEntries(CLASSES.flatMap((c) => c.research.map((r) => [r.id, r])));

export function towerDps(s: TowerStats): number {
  if (s.mine) return s.mine.dmg / s.cd;
  return (s.dmg * (s.multi ?? 1)) / s.cd + (s.dot ?? 0);
}
