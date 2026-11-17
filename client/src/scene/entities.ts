import * as THREE from 'three';
import { TOWER_BY_ID } from '../../../shared/data/classes';
import { ENEMIES, type EnemyDef } from '../../../shared/data/enemies';
import { EF_ARMORRED, EF_INVIS, EF_POISON, EF_REVEALED, EF_SLOW, EF_STUN, type Snapshot, type TowerInfo } from '../../../shared/protocol';
import { FxManager, projColor } from './fx';
import { createEnemyModel, createMine, createTowerModel, type EnemyModel, type TowerModel } from './models';
import { toWorld, type World } from './world';

export interface ClientTower { info: TowerInfo; group: TowerModel }

export interface ClientEnemy {
  id: number;
  def: EnemyDef;
  from: { x: number; y: number };
  to: { x: number; y: number };
  /** Interpolated logic position. */
  rx: number;
  ry: number;
  /** Small per-creep offset so creeps on the same route do not overlap exactly. */
  ox: number;
  oy: number;
  dir: number;
  hp: number;
  maxHp: number;
  flags: number;
  root: THREE.Group;
  model: EnemyModel;
  ghost?: EnemyModel;
  barFg: THREE.Mesh;
  bar: THREE.Group;
  status: THREE.Mesh;
  pos: THREE.Vector3;
}

const barGeo = new THREE.PlaneGeometry(1, 1);
const barMat = (color: number) => new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true });
const BAR_BG = barMat(0x111111), BAR_HI = barMat(0x3cd43c), BAR_MID = barMat(0xe0c030), BAR_LO = barMat(0xe03030), BAR_BOSS = barMat(0xc040ff);
const statusGeo = new THREE.RingGeometry(0.55, 0.75, 20);
const statusMat = (color: number) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide });
const ST_STUN = statusMat(0xffee40), ST_SLOW = statusMat(0x60c0ff), ST_POISON = statusMat(0x60ff40), ST_ARMOR = statusMat(0xc040ff), ST_REVEAL = statusMat(0xff60ff);

export class Entities {
  readonly towers = new Map<number, ClientTower>();
  readonly enemies = new Map<number, ClientEnemy>();
  private mines = new Map<number, THREE.Group>();
  private lastSnapAt = performance.now();
  private snapInterval = 100;
  readonly fx: FxManager;
  onKillGold?: (gold: number) => void;
  /** Own player id – decides which part of a kill bounty is shown. */
  youId = '';
  /** Freezes enemy walk animations while the game is paused. */
  paused = false;

  constructor(private world: World, private colorOf: (pid: string) => number) {
    this.fx = new FxManager(world.scene);
  }

  // ------------------------------------------------------------------ towers

  setTower(info: TowerInfo) {
    const existing = this.towers.get(info.id);
    if (existing && existing.info.level === info.level) { existing.info = info; return; }
    if (existing) this.removeTowerMesh(existing);
    const group = createTowerModel(TOWER_BY_ID[info.def], info.level, this.colorOf(info.owner));
    toWorld(info.cx + 0.5, info.cy + 0.5, 0, group.position);
    group.userData.pickId = 't' + info.id;
    this.world.scene.add(group);
    this.world.addAnimated(group);
    this.towers.set(info.id, { info, group });
    if (existing) this.fx.ring(group.position, 0xffd040, 2, 0.6);
    else this.fx.death(group.position.clone().setY(0.3), 0x9a8a70, false);
  }

  removeTower(id: number) {
    const t = this.towers.get(id);
    if (!t) return;
    this.removeTowerMesh(t);
    this.fx.death(t.group.position.clone().setY(0.5), 0x8a7a60, true);
    this.towers.delete(id);
  }

  private removeTowerMesh(t: ClientTower) {
    this.world.scene.remove(t.group);
    this.world.removeAnimated(t.group);
  }

  clear() {
    for (const t of this.towers.values()) this.removeTowerMesh(t);
    this.towers.clear();
    for (const e of this.enemies.values()) this.world.scene.remove(e.root);
    this.enemies.clear();
    for (const m of this.mines.values()) { this.world.scene.remove(m); this.world.removeAnimated(m); }
    this.mines.clear();
  }

  addMine(id: number, x: number, y: number) {
    const m = createMine();
    toWorld(x, y, 0, m.position);
    this.world.scene.add(m);
    this.world.addAnimated(m);
    this.mines.set(id, m);
  }

  private removeMine(id: number) {
    const m = this.mines.get(id);
    if (!m) return;
    this.world.scene.remove(m);
    this.world.removeAnimated(m);
    this.mines.delete(id);
  }

  // ------------------------------------------------------------------ enemies

  private createEnemy(id: number, typeIdx: number, x: number, y: number, hp: number, maxHp: number, flags: number): ClientEnemy {
    const def = ENEMIES[typeIdx];
    const root = new THREE.Group();
    const model = createEnemyModel(def);
    root.add(model);
    let ghost: EnemyModel | undefined;
    if (def.invisible) {
      ghost = createEnemyModel(def, true);
      root.add(ghost);
    }
    const bar = new THREE.Group();
    const w = def.boss ? 2.4 : 1.2;
    const bg = new THREE.Mesh(barGeo, BAR_BG);
    bg.scale.set(w + 0.08, 0.2, 1);
    bg.renderOrder = 5;
    const fg = new THREE.Mesh(barGeo, def.boss ? BAR_BOSS : BAR_HI);
    fg.scale.set(w, 0.14, 1);
    fg.position.z = 0.01;
    fg.renderOrder = 6;
    fg.userData.w = w;
    bar.add(bg, fg);
    bar.position.y = model.userData.height + 0.5;
    root.add(bar);
    const status = new THREE.Mesh(statusGeo, ST_SLOW);
    status.rotation.x = -Math.PI / 2;
    status.position.y = 0.08;
    status.scale.setScalar(def.scale * 2);
    root.add(status);
    root.userData.pickId = 'e' + id;
    this.world.scene.add(root);
    const h = Math.sin(id * 12.9898) * 43758.5453;
    const ox = def.boss ? 0 : ((h - Math.floor(h)) - 0.5) * 0.5, oy = def.boss ? 0 : ((h * 7 - Math.floor(h * 7)) - 0.5) * 0.5;
    const e: ClientEnemy = { id, def, from: { x, y }, to: { x, y }, rx: x, ry: y, ox, oy, dir: Math.PI / 2, hp, maxHp, flags, root, model, ghost, barFg: fg, bar, status, pos: new THREE.Vector3() };
    this.placeEnemy(e);
    return e;
  }

  private placeEnemy(e: ClientEnemy) {
    toWorld(e.rx + e.ox, e.ry + e.oy, 0, e.root.position);
    e.root.rotation.y = Math.atan2(Math.cos(e.dir), Math.sin(e.dir));
    e.pos.copy(e.root.position);
    e.pos.y += e.model.userData.height * 0.6;
  }

  enemyPos(id: number): THREE.Vector3 | null {
    return this.enemies.get(id)?.pos ?? null;
  }

  applySnapshot(snap: Snapshot) {
    const now = performance.now();
    const gap = now - this.lastSnapAt;
    if (gap > 20 && gap < 400) this.snapInterval = this.snapInterval * 0.8 + gap * 0.2;
    this.lastSnapAt = now;

    const leaked = new Set<number>();
    for (const f of snap.fx) if (f[0] === 'l') leaked.add(f[1]);

    const seen = new Set<number>();
    for (const [id, typeIdx, x, y, hp, maxHp, flags] of snap.enemies) {
      seen.add(id);
      let e = this.enemies.get(id);
      if (!e) {
        e = this.createEnemy(id, typeIdx, x, y, hp, maxHp, flags);
        this.enemies.set(id, e);
      }
      e.from = { x: e.rx, y: e.ry };
      e.to = { x, y };
      if (Math.hypot(x - e.rx, y - e.ry) > 0.01) e.dir = Math.atan2(y - e.ry, x - e.rx);
      e.hp = hp;
      e.maxHp = maxHp;
      e.flags = flags;
    }
    for (const [id, e] of this.enemies) {
      if (seen.has(id)) continue;
      if (!leaked.has(id)) this.fx.death(e.pos, e.def.color, !!e.def.boss);
      else this.fx.ring(e.root.position, 0xff2020, 3, 0.8);
      this.world.scene.remove(e.root);
      this.enemies.delete(id);
    }

    for (const f of snap.fx) this.handleFx(f);
  }

  private towerMuzzle(id: number): THREE.Vector3 | null {
    const t = this.towers.get(id);
    if (!t) return null;
    return t.group.position.clone().add(t.group.userData.muzzle);
  }

  private aimTurret(towerId: number, target: THREE.Vector3 | null) {
    const t = this.towers.get(towerId);
    const turret = t?.group.userData.turret;
    if (!t || !turret || !target) return;
    turret.rotation.y = Math.atan2(target.x - t.group.position.x, target.z - t.group.position.z);
  }

  private handleFx(f: Snapshot['fx'][number]) {
    switch (f[0]) {
      case 's': {
        const [, towerId, enemyId, flight] = f;
        const from = this.towerMuzzle(towerId);
        const tower = this.towers.get(towerId);
        if (!from || !tower) return;
        const target = this.enemyPos(enemyId);
        this.aimTurret(towerId, target);
        const stats = TOWER_BY_ID[tower.info.def].levels[tower.info.level];
        let lastKnown = target?.clone() ?? null;
        this.fx.projectile(from, () => {
          const p = this.enemyPos(enemyId);
          if (p) lastKnown = p.clone();
          return lastKnown;
        }, flight, stats.proj);
        break;
      }
      case 'c': {
        const [, towerId, ids] = f;
        const from = this.towerMuzzle(towerId);
        if (!from) return;
        const pts = [from, ...ids.map((id) => this.enemyPos(id)).filter((p): p is THREE.Vector3 => !!p).map((p) => p.clone())];
        const tower = this.towers.get(towerId)!;
        const kind = TOWER_BY_ID[tower.info.def].levels[tower.info.level].proj;
        this.fx.lightning(pts, kind === 'lightning' ? 0x9fe0ff : projColor(kind));
        break;
      }
      case 'a': {
        const t = this.towers.get(f[1]);
        if (t) this.fx.ring(t.group.position, 0xff6030, 3, 0.4);
        break;
      }
      case 'x': {
        const [, x, y, r, kind] = f;
        this.fx.explosion(toWorld(x, y, 0.4), r, projColor(kind as never));
        break;
      }
      case 'm': this.addMine(f[1], f[2], f[3]); break;
      case 'mx': this.removeMine(f[1]); break;
      case 'k': {
        const [, x, y, , shares] = f;
        // Everybody sees the kill, but only their own share of the gold.
        const mine = shares.find(([pid]) => pid === this.youId)?.[1] ?? 0;
        if (mine > 0) this.fx.text(toWorld(x, y, 2), `+${mine}`);
        this.onKillGold?.(mine);
        break;
      }
      case 'd': {
        // Damage numbers in the colour of the player who caused them.
        const [, x, y, amount, owner] = f;
        const css = '#' + this.colorOf(owner).toString(16).padStart(6, '0');
        const own = owner === this.youId;
        this.fx.text(toWorld(x + (Math.random() - 0.5) * 0.8, y, own ? 1.8 : 1.3), String(amount), css, own ? 1.1 : 0.5);
        break;
      }
      case 'h': {
        const e = this.enemies.get(f[1]);
        if (e) this.fx.ring(e.root.position, 0x60ff60, 1.5, 0.5);
        break;
      }
    }
  }

  update(dt: number, t: number) {
    const k = Math.min(1.3, (performance.now() - this.lastSnapAt) / this.snapInterval);
    const camQ = this.world.camera.quaternion;
    for (const e of this.enemies.values()) {
      e.rx = e.from.x + (e.to.x - e.from.x) * k;
      e.ry = e.from.y + (e.to.y - e.from.y) * k;
      this.placeEnemy(e);
      if (!(e.flags & EF_STUN) && !this.paused) e.model.userData.anim(t);
      const r = Math.max(0, e.hp / e.maxHp);
      const w = e.barFg.userData.w as number;
      e.barFg.scale.x = Math.max(0.001, w * r);
      e.barFg.position.x = -(w * (1 - r)) / 2;
      if (!e.def.boss) e.barFg.material = r > 0.6 ? BAR_HI : r > 0.3 ? BAR_MID : BAR_LO;
      e.bar.quaternion.copy(e.root.quaternion).invert().multiply(camQ);
      const f = e.flags;
      e.status.visible = !!(f & (EF_STUN | EF_SLOW | EF_POISON | EF_ARMORRED)) || !!(f & EF_INVIS && f & EF_REVEALED);
      e.status.material = f & EF_STUN ? ST_STUN : f & EF_SLOW ? ST_SLOW : f & EF_POISON ? ST_POISON : f & EF_ARMORRED ? ST_ARMOR : ST_REVEAL;
      if (e.ghost) {
        const hidden = !(f & EF_REVEALED);
        e.ghost.visible = hidden;
        e.model.visible = !hidden;
        if (hidden) e.ghost.userData.anim(t);
      }
    }
    this.fx.update(dt);
  }

  pickables(): THREE.Object3D[] {
    const list: THREE.Object3D[] = [];
    for (const e of this.enemies.values()) list.push(e.root);
    for (const t of this.towers.values()) list.push(t.group);
    return list;
  }
}
