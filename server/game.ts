import { computeDamage } from '../shared/damage';
import { MAP_BY_ID } from '../shared/maps';
import { CLASS_BY_ID, RESEARCH_BY_ID, TOWER_BY_ID, type TowerStats } from '../shared/data/classes';
import { auraBuffs, effectiveStats } from '../shared/stats';
import { ENEMIES, ENEMY_BY_ID, ENEMY_INDEX, type EnemyDef } from '../shared/data/enemies';
import {
  FIRST_COUNTDOWN, START_GOLD, START_LIVES, START_LUMBER, VICTORY_WAVE, WAVE_COUNTDOWN,
  getWave, playerHpMul, waveBaseHp, waveBounty, waveIncome, waveLumber,
} from '../shared/data/waves';
import {
  EXIT, FLY_FLOW, MAP_H, MAP_ID, MAP_W, SPAWNS, WALKABLE, activeLanes, cellIndex, computeFlow, flyTarget, isBuildable,
  nextCell, setActiveMap, spawnsConnected,
} from '../shared/map';
import {
  EF_ARMORRED, EF_INVIS, EF_POISON, EF_REVEALED, EF_SLOW, EF_STUN,
  type EnemySnap, type FullState, type Fx, type GameSummary, type PlayerEndStats, type PlayerStats, type Snapshot, type TargetMode, type TowerInfo,
} from '../shared/protocol';

export interface GamePlayer {
  id: string;
  name: string;
  color: number;
  classId: string;
  gold: number;
  lumber: number;
  kills: number;
  damage: number;
  towersBuilt: number;
  upgrades: number;
  goldEarned: number;
  goldSent: number;
  ready: boolean;
  connected: boolean;
  research: Record<string, number>;
}

interface Tower extends TowerInfo {
  x: number;
  y: number;
  cdLeft: number;
  stats: TowerStats;
  minePoints?: number[]; // cell indices
}

interface Dot { dps: number; until: number; owner: string; towerId: number }

export interface Enemy {
  id: number;
  typeIdx: number;
  def: EnemyDef;
  wave: number;
  /** Lane (0..3) the enemy spawned in. */
  lane: number;
  /** Remaining distance to the exit (cells). Smaller = further ahead. */
  rem: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  bounty: number;
  slow: number;
  slowUntil: number;
  stunUntil: number;
  armorRed: number;
  armorRedUntil: number;
  dots: Dot[];
  healCd: number;
  revealed: boolean;
  dead: boolean;
}

interface Proj {
  towerId: number;
  owner: string;
  targetId: number;
  x: number;
  y: number;
  t: number;
  stats: TowerStats;
  dmg: number;
}

interface Mine { id: number; x: number; y: number; dmg: number; radius: number; towerId: number; owner: string }

export interface GameHooks {
  tower?(t: TowerInfo): void;
  towerGone?(id: number): void;
  event?(kind: 'wave' | 'boss' | 'victory' | 'info' | 'warn', text: string): void;
  gameOver?(wave: number, victory: boolean): void;
}

export const SELL_REFUND = 0.75;

export const SAVE_VERSION = 4;

export interface GameSave {
  version: number;
  map: string;
  time: number;
  wave: number;
  lives: number;
  timer: number;
  victory: boolean;
  nextId: number;
  lanes: number[];
  leaksByWave: Record<number, number>;
  killsByType: Record<string, number>;
  leaksByType: Record<string, number>;
  bossesKilled: number;
  livesLost: number;
  creepsKilled: number;
  players: GamePlayer[];
  towers: (TowerInfo & { cdLeft: number })[];
  enemies: Omit<Enemy, 'def'>[];
  projectiles: Proj[];
  mines: Mine[];
  spawnQueue: { at: number; enemy: string; hpMul: number; wave: number; lane: number }[];
}

export class Game {
  /** Map the game is played on (the active map when the game was created). */
  readonly mapId = MAP_ID;
  time = 0;
  wave = 0;
  lives = START_LIVES;
  timer = FIRST_COUNTDOWN;
  over = false;
  victory = false;
  /** Name of the player who paused the game; null while running. */
  paused: string | null = null;
  readonly leaksByWave: Record<number, number> = {};
  readonly killsByType: Record<string, number> = {};
  readonly leaksByType: Record<string, number> = {};
  bossesKilled = 0;
  livesLost = 0;
  creepsKilled = 0;
  readonly players = new Map<string, GamePlayer>();
  /** Lanes (spawns) that receive creeps – fixed when the game starts. */
  lanes: number[];
  readonly towers = new Map<number, Tower>();
  enemies: Enemy[] = [];
  private enemyById = new Map<number, Enemy>();
  private projectiles: Proj[] = [];
  readonly mines = new Map<number, Mine>();
  private occupancy = new Map<number, number>();
  /** 1 = cell is occupied by a tower (blocks creeps). */
  readonly blocked = new Uint8Array(MAP_W * MAP_H);
  /** Distance to the exit for every cell (flow field for ground creeps). */
  flow: Float32Array = computeFlow(this.blocked);
  private spawnQueue: { at: number; enemy: string; hpMul: number; wave: number; lane: number }[] = [];
  private fx: Fx[] = [];
  private nextId = 1;
  private towersDirty = true;

  constructor(players: { id: string; name: string; color: number; classId: string }[], private hooks: GameHooks = {}) {
    for (const p of players) {
      this.players.set(p.id, {
        ...p, gold: START_GOLD, lumber: START_LUMBER, kills: 0, damage: 0, towersBuilt: 0, upgrades: 0, goldEarned: 0, goldSent: 0,
        ready: false, connected: true, research: {},
      });
    }
    this.lanes = activeLanes(players.length);
    // All lanes leak into the shared lives, so more lanes get a little slack.
    this.lives = START_LIVES + 10 * (this.lanes.length - 1);
  }

  /**
   * Creep HP: every lane gets the whole wave, so HP scales with the players per lane (more players = more towers).
   * Computed live so players who join later make the game harder.
   */
  private get hpMul(): number {
    const lanes = this.lanes.length;
    return (playerHpMul(this.players.size) / lanes) * Math.pow(0.93, lanes - 1) * MAP_BY_ID[this.mapId].hpScale;
  }

  /** Adds a player to a running game (late join). Starts with the average resources of the others. */
  addPlayer(p: { id: string; name: string; color: number; classId: string }): GamePlayer {
    const others = [...this.players.values()];
    const avg = (key: 'gold' | 'lumber') => (others.length ? Math.round(others.reduce((sum, o) => sum + o[key], 0) / others.length) : 0);
    const player: GamePlayer = {
      ...p, gold: Math.max(START_GOLD, avg('gold')), lumber: Math.max(START_LUMBER, avg('lumber')), kills: 0, damage: 0,
      towersBuilt: 0, upgrades: 0, goldEarned: 0, goldSent: 0, ready: false, connected: true, research: {},
    };
    this.players.set(p.id, player);
    return player;
  }

  /** A tower can be used by its owner – and by everybody while the owner is disconnected. */
  canControl(pid: string, t: { owner: string }): boolean {
    return t.owner === pid || !this.players.get(t.owner)?.connected;
  }

  /** Sends gold to another player. */
  gift(from: string, to: string, amount: number): string | null {
    const a = this.players.get(from), b = this.players.get(to);
    if (!a || !b || from === to) return 'Ungültig.';
    if (!Number.isInteger(amount) || amount <= 0) return 'Ungültiger Betrag.';
    if (a.gold < amount) return 'Nicht genug Gold.';
    a.gold -= amount;
    b.gold += amount;
    a.goldSent += amount;
    this.hooks.event?.('info', `💸 ${a.name} schickt ${b.name} ${amount} Gold.`);
    return null;
  }

  // ------------------------------------------------------------------ commands

  canBuildAt(pid: string, cx: number, cy: number): string | null {
    if (!isBuildable(cx, cy)) return 'Hier kann nicht gebaut werden.';
    if (this.occupancy.has(cellIndex(cx, cy))) return 'Feld ist belegt.';
    return null;
  }

  /** Flow field with an extra tower at (cx, cy), or an error if that would trap creeps. */
  private flowWith(cx: number, cy: number): Float32Array | string {
    for (const e of this.enemies) {
      if (!e.dead && !e.def.flying && Math.abs(e.x - (cx + 0.5)) < 0.95 && Math.abs(e.y - (cy + 0.5)) < 0.95) return 'Ein Gegner steht im Weg.';
    }
    const i = cellIndex(cx, cy);
    this.blocked[i] = 1;
    const flow = computeFlow(this.blocked);
    this.blocked[i] = 0;
    const trapped = !spawnsConnected(flow) || this.enemies.some((e) => !e.dead && !e.def.flying && !Number.isFinite(flow[cellIndex(Math.floor(e.x), Math.floor(e.y))]));
    return trapped ? 'Das würde den Weg blockieren! Die Gegner brauchen immer einen Durchgang.' : flow;
  }

  build(pid: string, defId: string, cx: number, cy: number): string | null {
    const p = this.players.get(pid);
    const def = TOWER_BY_ID[defId];
    if (this.over) return 'Das Spiel ist vorbei.';
    if (!p || !def) return 'Ungültig.';
    if (def.cls !== p.classId) return 'Dieser Turm gehört nicht zu deiner Klasse.';
    if (def.requires && !p.research[def.requires]) return 'Erst erforschen: ' + RESEARCH_BY_ID[def.requires].name;
    const err = this.canBuildAt(pid, cx, cy);
    if (err) return err;
    if (p.gold < def.cost) return 'Nicht genug Gold.';
    if (p.lumber < def.lumber) return 'Nicht genug Holz.';
    const flow = this.flowWith(cx, cy);
    if (typeof flow === 'string') return flow;
    p.gold -= def.cost;
    p.lumber -= def.lumber;
    const t: Tower = {
      id: this.nextId++, owner: pid, def: defId, level: 0, cx, cy, x: cx + 0.5, y: cy + 0.5,
      mode: 'first', kills: 0, damage: 0, invested: def.cost, cdLeft: 0.2, stats: def.levels[0],
    };
    this.towers.set(t.id, t);
    this.occupancy.set(cellIndex(cx, cy), t.id);
    this.blocked[cellIndex(cx, cy)] = 1;
    this.flow = flow;
    p.towersBuilt++;
    this.towersDirty = true;
    this.hooks.tower?.(this.towerInfo(t));
    return null;
  }

  upgrade(pid: string, id: number): string | null {
    const p = this.players.get(pid);
    const t = this.towers.get(id);
    if (this.over) return 'Das Spiel ist vorbei.';
    if (!p || !t || !this.canControl(pid, t)) return 'Ungültig.';
    if (t.level >= (TOWER_BY_ID[t.def].maxLevel ?? 2)) return 'Maximale Stufe erreicht.';
    const def = TOWER_BY_ID[t.def];
    const cost = def.upCost[t.level], lumber = def.upLumber[t.level];
    if (p.gold < cost) return 'Nicht genug Gold.';
    if (p.lumber < lumber) return 'Nicht genug Holz.';
    p.gold -= cost;
    p.lumber -= lumber;
    t.level++;
    p.upgrades++;
    t.invested += cost;
    this.towersDirty = true;
    this.hooks.tower?.(this.towerInfo(t));
    return null;
  }

  sell(pid: string, id: number): string | null {
    const p = this.players.get(pid);
    const t = this.towers.get(id);
    if (this.over) return 'Das Spiel ist vorbei.';
    if (!p || !t || !this.canControl(pid, t)) return 'Ungültig.';
    p.gold += Math.floor(t.invested * SELL_REFUND);
    this.towers.delete(id);
    this.occupancy.delete(cellIndex(t.cx, t.cy));
    this.blocked[cellIndex(t.cx, t.cy)] = 0;
    this.flow = computeFlow(this.blocked);
    for (const m of [...this.mines.values()]) if (m.towerId === id) this.removeMine(m.id);
    this.towersDirty = true;
    this.hooks.towerGone?.(id);
    return null;
  }

  setMode(pid: string, id: number, mode: TargetMode): string | null {
    const t = this.towers.get(id);
    if (!t || !this.canControl(pid, t)) return 'Ungültig.';
    t.mode = mode;
    this.hooks.tower?.(this.towerInfo(t));
    return null;
  }

  research(pid: string, rid: string): string | null {
    const p = this.players.get(pid);
    const r = RESEARCH_BY_ID[rid];
    if (this.over) return 'Das Spiel ist vorbei.';
    if (!p || !r) return 'Ungültig.';
    if (!CLASS_BY_ID[p.classId].research.includes(r)) return 'Gehört nicht zu deiner Klasse.';
    const lvl = p.research[rid] ?? 0;
    if (lvl >= r.maxLevel) return 'Bereits vollständig erforscht.';
    if (p.gold < r.gold[lvl]) return 'Nicht genug Gold.';
    if (p.lumber < r.lumber[lvl]) return 'Nicht genug Holz.';
    p.gold -= r.gold[lvl];
    p.lumber -= r.lumber[lvl];
    p.research[rid] = lvl + 1;
    this.towersDirty = true;
    return null;
  }

  setReady(pid: string, ready: boolean) {
    const p = this.players.get(pid);
    if (p) p.ready = ready;
  }

  setConnected(pid: string, connected: boolean) {
    const p = this.players.get(pid);
    if (p) { p.connected = connected; if (!connected) p.ready = false; }
  }

  // ------------------------------------------------------------------ simulation

  tick(dt: number) {
    if (this.over || this.paused) return;
    this.time += dt;
    if (this.towersDirty) this.recalcTowers();
    this.updateWaves(dt);
    this.updateEnemies(dt);
    this.updateDetection();
    this.updateTowers(dt);
    this.updateProjectiles(dt);
    this.updateMines();
    if (this.enemies.some((e) => e.dead)) {
      this.enemies = this.enemies.filter((e) => !e.dead);
    }
    this.checkVictory();
  }

  private updateWaves(dt: number) {
    if (this.spawnQueue.length > 0) {
      while (this.spawnQueue.length && this.spawnQueue[0].at <= this.time) {
        const s = this.spawnQueue.shift()!;
        this.spawnEnemy(s.enemy, s.wave, s.hpMul, s.lane);
      }
      return;
    }
    // The countdown to the next wave only starts once the last creep of the current wave is gone.
    if (this.timer < 0) {
      if (this.enemies.some((e) => !e.dead)) return;
      this.timer = WAVE_COUNTDOWN;
    }
    const active = [...this.players.values()].filter((p) => p.connected);
    // Before the first wave nobody is rushed: it starts as soon as every connected player is ready.
    if (this.wave === 0) {
      this.timer = FIRST_COUNTDOWN;
      if (active.length > 0 && active.every((p) => p.ready)) this.startWave();
      return;
    }
    if (active.length > 0 && active.every((p) => p.ready) && this.timer > 3) this.timer = 3;
    this.timer -= dt;
    if (this.timer <= 0) this.startWave();
  }

  startWave() {
    this.wave++;
    const n = this.wave;
    const def = getWave(n);
    const entries: typeof this.spawnQueue = [];
    const lanes = this.lanes;
    for (const grp of def.groups) {
      // Every active lane spawns the whole wave (like the per-player spawns in Wintermaul).
      for (const lane of lanes) {
        for (let i = 0; i < grp.count; i++) {
          entries.push({ at: this.time + (grp.delay ?? 0) + i * grp.interval, enemy: grp.enemy, hpMul: grp.hpMul ?? 1, wave: n, lane });
        }
      }
    }
    entries.sort((a, b) => a.at - b.at);
    this.spawnQueue = entries;
    this.timer = -1;
    const income = waveIncome(n), lumber = waveLumber(n);
    for (const p of this.players.values()) {
      p.ready = false;
      p.gold += income + this.playerIncomeBonus(p.id);
      p.goldEarned += income + this.playerIncomeBonus(p.id);
      p.lumber += lumber;
    }
    const names = [...new Set(def.groups.map((g) => ENEMY_BY_ID[g.enemy].name))].join(' + ');
    if (def.boss) this.hooks.event?.('boss', `Welle ${n}: BOSS – ${names}!`);
    else this.hooks.event?.('wave', `Welle ${n}: ${names} (+${income} Gold, +${lumber} Holz)`);
  }

  private playerIncomeBonus(pid: string): number {
    let bonus = 0;
    for (const t of this.towers.values()) if (t.owner === pid && t.stats.income) bonus += t.stats.income;
    const p = this.players.get(pid)!;
    for (const [rid, lvl] of Object.entries(p.research)) bonus += (RESEARCH_BY_ID[rid]?.perLevel.income ?? 0) * lvl;
    return bonus;
  }

  spawnEnemy(enemyId: string, wave: number, hpMul: number, lane: number, pos?: { x: number; y: number }): Enemy {
    const def = ENEMY_BY_ID[enemyId];
    const hp = Math.max(1, Math.round(waveBaseHp(wave) * def.hp * hpMul * this.hpMul));
    const start = pos ?? { x: SPAWNS[lane].x + (Math.random() - 0.5) * 2, y: SPAWNS[lane].y };
    const e: Enemy = {
      id: this.nextId++, typeIdx: ENEMY_INDEX[enemyId], def, wave, lane, rem: 0, x: start.x, y: start.y,
      hp, maxHp: hp, bounty: Math.max(1, Math.round(waveBounty(wave) * def.bounty)),
      slow: 0, slowUntil: 0, stunUntil: 0, armorRed: 0, armorRedUntil: 0, dots: [],
      healCd: def.heal?.cd ?? 0, revealed: false, dead: false,
    };
    e.rem = this.remaining(e);
    this.enemies.push(e);
    this.enemyById.set(e.id, e);
    return e;
  }

  private remaining(e: Enemy): number {
    const field = e.def.flying ? FLY_FLOW : this.flow;
    const d = field[cellIndex(Math.floor(e.x), Math.floor(e.y))];
    return Number.isFinite(d) ? d : 1e6;
  }

  /** Moves a creep: ground creeps follow the flow field around towers, flyers fly around cliffs but over towers. */
  private move(e: Enemy, step: number): boolean {
    if (e.def.flying) {
      const t = flyTarget(e.x, e.y);
      if (t.done) return true;
      const dx = t.x - e.x, dy = t.y - e.y, dd = Math.hypot(dx, dy);
      if (dd <= step) { e.x = t.x; e.y = t.y; } else { e.x += (dx / dd) * step; e.y += (dy / dd) * step; }
      return EXIT[cellIndex(Math.floor(e.x), Math.floor(e.y))] === 1;
    }
    let left = step;
    for (let k = 0; k < 4 && left > 1e-6; k++) {
      const cx = Math.floor(e.x), cy = Math.floor(e.y);
      if (EXIT[cellIndex(cx, cy)]) return true;
      const j = nextCell(this.flow, this.blocked, cx, cy);
      // Off the flow field (should not happen): stay on the cell centre.
      const tx = j >= 0 ? (j % MAP_W) + 0.5 : cx + 0.5;
      const ty = j >= 0 ? Math.floor(j / MAP_W) + 0.5 : cy + 0.5;
      const dx = tx - e.x, dy = ty - e.y, dd = Math.hypot(dx, dy);
      if (dd <= left) { e.x = tx; e.y = ty; left -= dd; if (dd < 1e-6) break; } else { e.x += (dx / dd) * left; e.y += (dy / dd) * left; left = 0; }
    }
    return EXIT[cellIndex(Math.floor(e.x), Math.floor(e.y))] === 1;
  }

  private updateEnemies(dt: number) {
    const now = this.time;
    for (const e of this.enemies) {
      if (e.dead) continue;
      if (e.def.regen) e.hp = Math.min(e.maxHp, e.hp + e.maxHp * e.def.regen * dt);
      if (e.dots.length) {
        e.dots = e.dots.filter((d) => d.until > now);
        for (const d of e.dots) {
          this.damageEnemy(e, d.dps * dt, d.owner, d.towerId);
          if (e.dead) break;
        }
        if (e.dead) continue;
      }
      if (e.def.heal) {
        e.healCd -= dt;
        if (e.healCd <= 0) {
          e.healCd = e.def.heal.cd;
          for (const o of this.enemies) {
            if (!o.dead && o.hp < o.maxHp && Math.hypot(o.x - e.x, o.y - e.y) <= e.def.heal.range) {
              o.hp = Math.min(o.maxHp, o.hp + o.maxHp * e.def.heal.pct);
              this.fx.push(['h', o.id]);
            }
          }
        }
      }
      if (e.stunUntil > now) continue;
      const slow = e.slowUntil > now ? e.slow : 0;
      if (this.move(e, e.def.speed * (1 - slow) * dt)) {
        this.leak(e);
        continue;
      }
      e.rem = this.remaining(e);
    }
  }

  private leak(e: Enemy) {
    e.dead = true;
    this.enemyById.delete(e.id);
    const lost = Math.min(this.lives, e.def.lives);
    this.lives -= lost;
    this.livesLost += lost;
    this.leaksByWave[e.wave] = (this.leaksByWave[e.wave] ?? 0) + e.def.lives;
    this.leaksByType[e.def.id] = (this.leaksByType[e.def.id] ?? 0) + 1;
    this.fx.push(['l', e.id]);
    if (this.lives <= 0 && !this.over) {
      this.over = true;
      this.hooks.gameOver?.(this.wave, this.victory);
    }
  }

  private updateDetection() {
    const detectors = [...this.towers.values()].filter((t) => t.stats.detect);
    for (const e of this.enemies) {
      if (!e.def.invisible || e.dead) continue;
      e.revealed = detectors.some((t) => Math.hypot(t.x - e.x, t.y - e.y) <= t.stats.range);
    }
  }

  private targetable(t: Tower, e: Enemy): boolean {
    if (e.dead) return false;
    if (e.def.flying ? !t.stats.air : !t.stats.ground) return false;
    if (e.def.invisible && !e.revealed) return false;
    return Math.hypot(t.x - e.x, t.y - e.y) <= t.stats.range;
  }

  private pickTargets(t: Tower, count: number): Enemy[] {
    const c = this.enemies.filter((e) => this.targetable(t, e));
    if (c.length === 0) return c;
    const key: Record<TargetMode, (e: Enemy) => number> = {
      first: (e) => -e.rem,
      last: (e) => e.rem,
      strong: (e) => e.hp,
      weak: (e) => -e.hp,
      close: (e) => -Math.hypot(t.x - e.x, t.y - e.y),
    };
    const k = key[t.mode];
    if (count === 1) {
      let best = c[0];
      for (const e of c) if (k(e) > k(best)) best = e;
      return [best];
    }
    return c.sort((a, b) => k(b) - k(a)).slice(0, count);
  }

  private updateTowers(dt: number) {
    for (const t of this.towers.values()) {
      const s = t.stats;
      if (s.income || (s.dmg <= 0 && !s.mine)) continue;
      t.cdLeft -= dt;
      if (t.cdLeft > 0) continue;
      if (s.mine) {
        if (!t.minePoints?.length) continue;
        const count = [...this.mines.values()].filter((m) => m.towerId === t.id).length;
        if (count >= s.mine.max) continue;
        const c = t.minePoints[Math.floor(Math.random() * t.minePoints.length)];
        const pos = { x: (c % MAP_W) + 0.5, y: Math.floor(c / MAP_W) + 0.5 };
        const m: Mine = {
          id: this.nextId++, x: pos.x + (Math.random() - 0.5) * 0.6, y: pos.y + (Math.random() - 0.5) * 0.6,
          dmg: s.mine.dmg, radius: s.mine.radius, towerId: t.id, owner: t.owner,
        };
        this.mines.set(m.id, m);
        this.fx.push(['m', m.id, m.x, m.y]);
        t.cdLeft = s.cd;
        continue;
      }
      const targets = this.pickTargets(t, s.multi ?? 1);
      if (targets.length === 0) continue;
      t.cdLeft = s.cd;
      for (const target of targets) this.fire(t, target);
    }
  }

  private fire(t: Tower, target: Enemy) {
    const s = t.stats;
    let dmg = s.dmg * (0.85 + Math.random() * 0.3);
    if (s.crit && Math.random() < s.crit) dmg *= s.critMult ?? 2;
    if (s.chain) {
      const hit: Enemy[] = [target];
      let cur = target;
      for (let i = 0; i < s.chain; i++) {
        let best: Enemy | null = null, bestD = 3.5;
        for (const e of this.enemies) {
          if (e.dead || hit.includes(e) || (e.def.invisible && !e.revealed)) continue;
          if (e.def.flying ? !s.air : !s.ground) continue;
          const dd = Math.hypot(e.x - cur.x, e.y - cur.y);
          if (dd < bestD) { bestD = dd; best = e; }
        }
        if (!best) break;
        hit.push(best);
        cur = best;
      }
      this.fx.push(['c', t.id, hit.map((e) => e.id)]);
      let m = 1;
      for (const e of hit) {
        this.hitEnemy(e, s, dmg * m, t.owner, t.id);
        m *= s.chainFalloff ?? 0.8;
      }
      return;
    }
    if (s.projSpeed <= 0) {
      this.fx.push(['a', t.id]);
      this.impact({ towerId: t.id, owner: t.owner, targetId: target.id, x: target.x, y: target.y, t: 0, stats: s, dmg });
      return;
    }
    const flight = Math.hypot(t.x - target.x, t.y - target.y) / s.projSpeed;
    this.projectiles.push({ towerId: t.id, owner: t.owner, targetId: target.id, x: target.x, y: target.y, t: flight, stats: s, dmg });
    this.fx.push(['s', t.id, target.id, Math.round(flight * 1000) / 1000]);
  }

  private updateProjectiles(dt: number) {
    if (!this.projectiles.length) return;
    const remaining: Proj[] = [];
    for (const p of this.projectiles) {
      const target = this.enemyById.get(p.targetId);
      if (target && !target.dead) { p.x = target.x; p.y = target.y; }
      p.t -= dt;
      if (p.t > 0) { remaining.push(p); continue; }
      this.impact(p);
    }
    this.projectiles = remaining;
  }

  private impact(p: Proj) {
    const s = p.stats;
    if (s.splash) {
      this.fx.push(['x', Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100, s.splash, s.proj]);
      // Iterate over a copy: enemies spawned by splits during this impact must not be hit by it.
      for (const e of this.enemies.slice()) {
        if (e.dead || (e.def.flying ? !s.air : !s.ground)) continue;
        const dist = Math.hypot(e.x - p.x, e.y - p.y);
        if (dist > s.splash) continue;
        this.hitEnemy(e, s, p.dmg * (dist <= s.splash * 0.5 ? 1 : 0.5), p.owner, p.towerId);
      }
      return;
    }
    const target = this.enemyById.get(p.targetId);
    if (target && !target.dead) this.hitEnemy(target, s, p.dmg, p.owner, p.towerId);
  }

  private hitEnemy(e: Enemy, s: TowerStats, dmg: number, owner: string, towerId: number) {
    const now = this.time;
    const immune = !!e.def.immune;
    if (s.slow && !immune && (e.slowUntil <= now || s.slow >= e.slow)) {
      e.slow = s.slow;
      e.slowUntil = now + (s.slowDur ?? 2);
    }
    if (s.stun && !immune && Math.random() < s.stun && !e.def.boss) e.stunUntil = Math.max(e.stunUntil, now + (s.stunDur ?? 0.5));
    if (s.armorRed && (e.armorRedUntil <= now || s.armorRed >= e.armorRed)) {
      e.armorRed = s.armorRed;
      e.armorRedUntil = now + (s.armorRedDur ?? 5);
    }
    if (s.dot) {
      const existing = e.dots.find((d) => d.towerId === towerId);
      const until = now + (s.dotDur ?? 3);
      if (existing) { existing.until = until; existing.dps = s.dot; } else e.dots.push({ dps: s.dot, until, owner, towerId });
    }
    const armor = e.def.armor - (e.armorRedUntil > now ? e.armorRed : 0);
    const real = computeDamage(dmg, s.atk, e.def.armorType, armor, immune);
    this.damageEnemy(e, real, owner, towerId);
  }

  private damageEnemy(e: Enemy, amount: number, owner: string, towerId: number) {
    if (e.dead || amount <= 0) return;
    const dealt = Math.min(e.hp, amount);
    e.hp -= amount;
    const p = this.players.get(owner);
    const t = this.towers.get(towerId);
    if (p) p.damage += dealt;
    if (t) t.damage += dealt;
    if (e.hp <= 0) this.kill(e, owner, towerId);
  }

  private kill(e: Enemy, owner: string, towerId: number) {
    e.dead = true;
    this.enemyById.delete(e.id);
    const killer = this.players.get(owner);
    const t = this.towers.get(towerId);
    if (t) t.kills++;
    // Kill gold is shared by all players. Every lane spawns the full wave, so the bounty is divided by the number of
    // lanes – income per player then does not depend on how many lanes are in play.
    this.creepsKilled++;
    this.killsByType[e.def.id] = (this.killsByType[e.def.id] ?? 0) + 1;
    const share = e.bounty / Math.max(1, this.lanes.length);
    for (const p of this.players.values()) { p.gold += share; p.goldEarned += share; }
    if (killer) {
      killer.kills++;
      for (const [rid, lvl] of Object.entries(killer.research)) {
        const extra = (RESEARCH_BY_ID[rid]?.perLevel.bounty ?? 0) * lvl;
        killer.gold += extra;
        killer.goldEarned += extra;
      }
    }
    if (e.def.boss) {
      this.bossesKilled++;
      for (const p of this.players.values()) p.lumber += 2;
      this.hooks.event?.('info', `${e.def.name} wurde besiegt! +2 Holz für alle.`);
    }
    this.fx.push(['k', Math.round(e.x * 10) / 10, Math.round(e.y * 10) / 10, Math.round(share * 10) / 10]);
    if (e.def.split) {
      for (let i = 0; i < e.def.split.count; i++) {
        const child = this.spawnEnemy(e.def.split.into, e.wave, 1, e.lane, { x: e.x + (Math.random() - 0.5) * 0.6, y: e.y + (Math.random() - 0.5) * 0.6 });
        child.revealed = e.revealed;
      }
    }
  }

  private updateMines() {
    if (!this.mines.size) return;
    for (const m of [...this.mines.values()]) {
      const trigger = this.enemies.find((e) => !e.dead && !e.def.flying && Math.hypot(e.x - m.x, e.y - m.y) < 0.7);
      if (!trigger) continue;
      const t = this.towers.get(m.towerId);
      const stats: TowerStats = t?.stats ?? { dmg: m.dmg, cd: 1, range: 0, atk: 'siege', ground: true, air: false, proj: 'none', projSpeed: 0 };
      this.removeMine(m.id);
      this.impact({ towerId: m.towerId, owner: m.owner, targetId: trigger.id, x: m.x, y: m.y, t: 0, stats: { ...stats, splash: m.radius }, dmg: m.dmg });
    }
  }

  private removeMine(id: number) {
    if (this.mines.delete(id)) this.fx.push(['mx', id]);
  }

  private checkVictory() {
    if (this.victory || this.wave < VICTORY_WAVE || this.spawnQueue.length) return;
    if (this.enemies.some((e) => e.wave <= VICTORY_WAVE)) return;
    this.victory = true;
    this.hooks.event?.('victory', `SIEG! Alle ${VICTORY_WAVE} Wellen überstanden. Weiter im Endlos-Modus – wie weit schafft ihr es?`);
  }

  // ------------------------------------------------------------------ stats

  effectiveStats(t: Tower): TowerStats {
    return effectiveStats(t.def, t.level, this.players.get(t.owner)?.research ?? {}, auraBuffs(t, this.towers.values()));
  }

  private recalcTowers() {
    this.towersDirty = false;
    for (const t of this.towers.values()) {
      t.stats = this.effectiveStats(t);
      if (t.stats.mine) {
        t.minePoints = [];
        const r = Math.ceil(t.stats.range);
        for (let y = Math.floor(t.y) - r; y <= Math.floor(t.y) + r; y++) {
          for (let x = Math.floor(t.x) - r; x <= Math.floor(t.x) + r; x++) {
            if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) continue;
            const c = cellIndex(x, y);
            if (!WALKABLE[c] || this.blocked[c] || !Number.isFinite(this.flow[c])) continue;
            if (Math.hypot(x + 0.5 - t.x, y + 0.5 - t.y) <= t.stats.range) t.minePoints.push(c);
          }
        }
      }
    }
  }

  // ------------------------------------------------------------------ serialization

  towerInfo(t: Tower): TowerInfo {
    return {
      id: t.id, owner: t.owner, def: t.def, level: t.level, cx: t.cx, cy: t.cy, mode: t.mode,
      kills: t.kills, damage: Math.round(t.damage), invested: t.invested,
    };
  }

  playerStats(): PlayerStats[] {
    return [...this.players.values()].map((p) => ({
      id: p.id, gold: Math.floor(p.gold), lumber: p.lumber, kills: p.kills, damage: Math.round(p.damage), goldEarned: Math.round(p.goldEarned),
      ready: p.ready, research: p.research,
    }));
  }

  snapshot(): Snapshot {
    const now = this.time;
    const enemies: EnemySnap[] = this.enemies.filter((e) => !e.dead).map((e) => {
      let flags = 0;
      if (e.slowUntil > now) flags |= EF_SLOW;
      if (e.stunUntil > now) flags |= EF_STUN;
      if (e.dots.length) flags |= EF_POISON;
      if (e.def.invisible) flags |= EF_INVIS;
      if (e.revealed) flags |= EF_REVEALED;
      if (e.armorRedUntil > now) flags |= EF_ARMORRED;
      return [e.id, e.typeIdx, Math.round(e.x * 100) / 100, Math.round(e.y * 100) / 100, Math.ceil(e.hp), e.maxHp, flags];
    });
    const fx = this.fx;
    this.fx = [];
    // Kill stats are refreshed on towers lazily via snapshot consumers; tower kill counts are in tower events.
    return {
      t: 'snap', time: Math.round(now * 1000) / 1000, wave: this.wave, timer: this.timer < 0 ? -1 : Math.max(0, this.timer),
      lives: this.lives, paused: this.paused, enemies, players: this.playerStats(), fx,
    };
  }

  fullState(you: string, lobby: Map<string, { name: string; color: number; classId: string | null; connected: boolean; spectator: boolean; pos: { x: number; y: number } | null }>, highscore: number): FullState {
    const stats = this.playerStats();
    return {
      you,
      players: stats.map((s) => {
        const p = this.players.get(s.id)!;
        return { ...s, name: p.name, color: p.color, classId: p.classId, connected: lobby.get(s.id)?.connected ?? false, spectator: false, pos: null };
      }),
      map: this.mapId,
      lanes: this.lanes,
      towers: [...this.towers.values()].map((t) => this.towerInfo(t)),
      mines: [...this.mines.values()].map((m) => [m.id, m.x, m.y]),
      wave: this.wave,
      lives: this.lives,
      highscore,
    };
  }

  /** Total current tower count per player (used by tests/bots). */
  towersOf(pid: string) {
    return [...this.towers.values()].filter((t) => t.owner === pid);
  }

  // ------------------------------------------------------------------ save / load

  toSave(): GameSave {
    return {
      version: SAVE_VERSION, map: this.mapId, lanes: [...this.lanes],
      time: this.time, wave: this.wave, lives: this.lives, timer: this.timer, victory: this.victory,
      nextId: this.nextId, leaksByWave: { ...this.leaksByWave }, killsByType: { ...this.killsByType }, leaksByType: { ...this.leaksByType },
      bossesKilled: this.bossesKilled, livesLost: this.livesLost, creepsKilled: this.creepsKilled,
      players: [...this.players.values()].map((p) => ({ ...p, research: { ...p.research }, ready: false, connected: false })),
      towers: [...this.towers.values()].map((t) => ({ ...this.towerInfo(t), damage: t.damage, cdLeft: t.cdLeft })),
      enemies: this.enemies.filter((e) => !e.dead).map(({ def: _def, dots, ...e }) => ({ ...e, dots: dots.map((d) => ({ ...d })) })),
      projectiles: this.projectiles.map((p) => ({ ...p })),
      mines: [...this.mines.values()].map((m) => ({ ...m })),
      spawnQueue: this.spawnQueue.map((s) => ({ ...s })),
    };
  }

  /** Restores a saved game. All players start disconnected; the game starts paused. */
  static fromSave(s: GameSave, hooks: GameHooks = {}, pausedBy = 'Spielstand'): Game {
    if (!s || s.version !== SAVE_VERSION || !Array.isArray(s.players) || s.players.length === 0) {
      throw new Error('Ungültiger oder inkompatibler Spielstand.');
    }
    setActiveMap(s.map);
    const players = s.players.filter((p) => CLASS_BY_ID[p.classId]);
    if (players.length !== s.players.length) throw new Error('Spielstand enthält unbekannte Klassen.');
    const g = new Game(players, hooks);
    g.lanes = s.lanes.slice();
    for (const p of players) g.players.set(p.id, { ...p, research: { ...p.research }, ready: false, connected: false });
    g.time = s.time;
    g.wave = s.wave;
    g.lives = s.lives;
    g.timer = s.timer;
    g.victory = s.victory;
    g.nextId = s.nextId;
    Object.assign(g.leaksByWave, s.leaksByWave);
    Object.assign(g.killsByType, s.killsByType);
    Object.assign(g.leaksByType, s.leaksByType);
    g.bossesKilled = s.bossesKilled;
    g.livesLost = s.livesLost;
    g.creepsKilled = s.creepsKilled;
    for (const t of s.towers) {
      if (!TOWER_BY_ID[t.def] || !g.players.has(t.owner)) continue;
      const tower: Tower = { ...t, x: t.cx + 0.5, y: t.cy + 0.5, stats: TOWER_BY_ID[t.def].levels[t.level] };
      g.towers.set(t.id, tower);
      g.occupancy.set(cellIndex(t.cx, t.cy), t.id);
      g.blocked[cellIndex(t.cx, t.cy)] = 1;
    }
    g.flow = computeFlow(g.blocked);
    for (const e of s.enemies) {
      const def = ENEMIES[e.typeIdx];
      if (!def) continue;
      const enemy: Enemy = { ...e, def, dots: e.dots.map((d) => ({ ...d })) };
      g.enemies.push(enemy);
      g.enemyById.set(enemy.id, enemy);
    }
    g.projectiles = s.projectiles.map((p) => ({ ...p }));
    for (const m of s.mines) g.mines.set(m.id, { ...m });
    g.spawnQueue = s.spawnQueue.filter((q) => ENEMY_BY_ID[q.enemy]).map((q) => ({ ...q }));
    g.recalcTowers();
    g.paused = pausedBy;
    return g;
  }

  // ------------------------------------------------------------------ end of game

  endStats(): { stats: PlayerEndStats[]; summary: GameSummary } {
    const top = (rec: Record<string, number>): [string, number][] => Object.entries(rec).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const towers = [...this.towers.values()].filter((t) => TOWER_BY_ID[t.def].maxLevel !== 0);
    const best = towers.sort((a, b) => b.damage - a.damage)[0];
    const players = [...this.players.values()];
    return {
      stats: players.map((p) => ({
        id: p.id, name: p.name, color: p.color, classId: p.classId, kills: p.kills, damage: Math.round(p.damage),
        towersBuilt: p.towersBuilt, upgrades: p.upgrades, goldEarned: Math.round(p.goldEarned), goldSent: p.goldSent,
      })),
      summary: {
        map: this.mapId, players: players.length, time: Math.round(this.time), livesLeft: this.lives, livesLost: this.livesLost,
        creepsKilled: this.creepsKilled, bossesKilled: this.bossesKilled, totalDamage: Math.round(players.reduce((s, p) => s + p.damage, 0)),
        towersBuilt: players.reduce((s, p) => s + p.towersBuilt, 0), towersAlive: this.towers.size,
        topTower: best ? { def: best.def, owner: this.players.get(best.owner)?.name ?? '?', kills: best.kills, damage: Math.round(best.damage), level: best.level } : null,
        topKilled: top(this.killsByType), topLeaked: top(this.leaksByType),
      },
    };
  }

  get enemyCount() { return this.enemies.length; }
  get pendingSpawns() { return this.spawnQueue.length; }
  get enemyTypes() { return ENEMIES; }
}
