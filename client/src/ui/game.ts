import { ARMOR_NAMES } from '../../../shared/damage';
import { CLASSES, CLASS_BY_ID, TOWER_BY_ID, type TowerDef } from '../../../shared/data/classes';
import { MAPS } from '../../../shared/maps';
import { ENEMY_BY_ID } from '../../../shared/data/enemies';
import { VICTORY_WAVE, getWave } from '../../../shared/data/waves';
import {
  GATE, MAP_H, MAP_W, SECTION_OF, SPAWNS, WALKABLE, WATER, cellIndex, setActiveMap, computeFlow, isBuildable, routeLength,
  spawnsConnected, traceRoute,
} from '../../../shared/map';
import {
  TARGET_MODE_NAMES, type FullState, type LobbyPlayer, type PlayerStats, type ServerMsg, type Snapshot, type TargetMode, type TowerInfo,
} from '../../../shared/protocol';
import { auraBuffs, effectiveStats } from '../../../shared/stats';
import type { Net } from '../net';
import { Entities } from '../scene/entities';
import { World, toWorld } from '../scene/world';
import { sfx } from '../sfx';
import { CLASS_ICONS, ENEMY_ICONS, TOWER_ICONS, enemyTags, esc, fmt, hex, statLines, towerTooltip } from './format';

type CPlayer = LobbyPlayer & PlayerStats;
type Selection = { kind: 'tower' | 'enemy'; id: number } | null;
const SELL_REFUND = 0.75;

export class GameView {
  readonly el: HTMLElement;
  private world: World;
  private ent: Entities;
  private players = new Map<string, CPlayer>();
  /** Lanes (spawns) that receive creeps. */
  private lanes: number[] = [];
  /** Where this player wished to play in the lobby (0..1 on the map). */
  private wish: { x: number; y: number } | null = null;
  private focusCycle = 0;
  private lastUpgradeAt = 0;
  private you = '';
  private wave = 0;
  private lives = 0;
  private timer = 0;
  private highscore = 0;
  private buildDef: TowerDef | null = null;
  private selected: Selection = null;
  private hover: { cx: number; cy: number; x: number; y: number } | null = null;
  private pings: { x: number; y: number; color: number; until: number }[] = [];
  private active = false;
  private over = false;
  private lastHud = 0;
  private lastMinimap = 0;
  private sectionCycle = 0;
  private minimapBg: HTMLCanvasElement | null = null;
  private clock = performance.now();
  private hostId: string | null = null;
  private paused: string | null = null;
  /** Local display preferences (only this screen, stored in the browser). */
  private view = { route: localStorage.getItem('td-route') !== '0', zones: localStorage.getItem('td-zones') !== '0' };
  /** Client-side copy of the tower grid and flow field for route previews and the "don't block" check. */
  private blocked = new Uint8Array(MAP_W * MAP_H);
  private routes: { x: number; y: number }[][] = [];
  private blockCheck = { key: '', blocks: false };

  constructor(root: HTMLElement, private net: Net) {
    this.el = document.createElement('div');
    this.el.id = 'game';
    this.el.className = 'hidden';
    root.appendChild(this.el);
    this.world = new World(this.el);
    this.ent = new Entities(this.world, (pid) => this.players.get(pid)?.color ?? 0xffffff);

    const hud = document.createElement('div');
    hud.id = 'hud';
    hud.innerHTML = `
      <div class="topbar panel">
        <div class="stat" title="Welle">⚔ <b class="h-wave">0</b></div>
        <div class="stat timer h-timer"></div>
        <button class="h-ready" title="Bereit für die nächste Welle (N)">Bereit <kbd>N</kbd></button>
        <div class="stat" title="Gemeinsame Leben">❤ <b class="h-lives">0</b></div>
        <div class="stat" title="Dein Gold">💰 <b class="h-gold gold">0</b></div>
        <div class="stat" title="Dein Holz">🌲 <b class="h-lumber">0</b></div>
        <div class="stat muted" title="Rekord">🏆 <span class="h-hs">0</span></div>
      </div>
      <div class="wave-preview panel"></div>
      <div class="build-panel panel">
        <h3 class="h-class"></h3>
        <div class="build-grid"></div>
        <div class="build-hint muted hidden" style="margin-top:6px;font-size:12px"><kbd>←↑↓→</kbd> Cursor <kbd>⇧</kbd> schneller<br><kbd>Enter</kbd> bauen <kbd>⇧+Enter</kbd> mehrere <kbd>Esc</kbd> Abbruch</div>
        <div class="h-maze muted" style="margin-top:6px;font-size:12px" title="Länge des Gegnerwegs je Spur – baut Labyrinthe, um ihn zu verlängern!"></div>
        <button class="h-research" style="width:100%;margin-top:8px">📜 Forschung <kbd>F</kbd></button>
        <div class="h-spectator hidden" style="margin-top:6px">
          <div class="muted">Du schaust zu. Steige mit einer Klasse ins laufende Spiel ein:</div>
          <select class="j-class" style="width:100%;margin:6px 0">${CLASSES.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
          <button class="primary j-join" style="width:100%">⚔ Mitspielen</button>
        </div>
      </div>
      <div class="sel-panel panel hidden"></div>
      <div class="minimap panel"><canvas width="230" height="202"></canvas></div>
      <div class="chat"><div class="lines"></div><input class="hidden" maxlength="200" placeholder="Nachricht an alle…"></div>
      <div class="banner"></div>
      <div class="toast"></div>
      <div class="bottom-right">
        <div class="game-menu panel hidden">
          <button class="h-pause">⏸ Pause <kbd>P</kbd></button>
          <button class="h-save">💾 Spiel speichern <kbd>Strg+S</kbd></button>
          <button class="h-score">📊 Punktestand <kbd>Tab</kbd></button>
          <button class="h-route">🧭 Laufweg: an <kbd>R</kbd></button>
          <button class="h-zones">🔲 Bauraster: an <kbd>G</kbd></button>
          <button class="h-gift">💸 Gold senden <kbd>T</kbd></button>
          <button class="h-sound">🔊 Ton: an <kbd>M</kbd></button>
          <button class="h-quit hidden">🚪 Spiel beenden <kbd>Q</kbd></button>
        </div>
        <button class="h-menu" title="Menü (F10)">☰ Menü <kbd>F10</kbd></button>
      </div>
      <div class="pause-box panel hidden">
        <h2>PAUSIERT</h2>
        <div class="muted p-by"></div>
        <button class="primary p-resume">▶ Fortsetzen <kbd>P</kbd></button>
      </div>
      <div class="tooltip panel hidden"></div>
      <div class="overlay hidden o-research"><div class="panel"></div></div>
      <div class="overlay hidden o-score"><div class="panel scoreboard"></div></div>
      <div class="overlay hidden o-over"><div class="panel"></div></div>
      <div class="overlay hidden o-quit"><div class="panel" style="min-width:440px">
        <h2 style="margin-top:0">🚪 Spiel beenden?</h2>
        <div class="muted">Alle Spieler kehren ins Hauptmenü (Lobby) zurück. Möchtest du das Spiel vorher speichern?</div>
        <input class="quit-name" maxlength="40" style="width:100%;margin-top:10px" placeholder="Name des Spielstands">
        <div class="row" style="margin-top:12px;justify-content:flex-end;gap:6px">
          <button class="q-cancel">Abbrechen</button><button class="q-nosave">Nicht speichern</button><button class="primary q-save">Speichern &amp; beenden</button>
        </div>
      </div></div>
      <div class="overlay hidden o-gift"><div class="panel" style="min-width:380px">
        <h2 style="margin-top:0">💸 Gold senden</h2>
        <select class="g-to" style="width:100%"></select>
        <div class="row" style="margin-top:8px;gap:6px">
          <input type="number" class="g-amount" min="1" value="100" style="flex:1">
          <button data-add="50">50</button><button data-add="100">100</button><button data-add="250">250</button><button data-add="all">Alles</button>
        </div>
        <div class="muted" style="margin-top:4px">Dein Gold: <b class="gold g-have"></b></div>
        <div class="row" style="margin-top:10px;justify-content:flex-end;gap:6px"><button class="g-cancel">Abbrechen</button><button class="primary g-send">Senden</button></div>
      </div></div>
      <div class="overlay hidden o-save"><div class="panel" style="min-width:420px">
        <h2 style="margin-top:0">💾 Spiel speichern</h2>
        <input class="save-name" maxlength="40" style="width:100%" placeholder="Name des Spielstands">
        <div class="muted" style="font-size:12px;margin-top:4px">Gleicher Name überschreibt einen vorhandenen Spielstand. Laden kann der Host in der Lobby.</div>
        <div class="row" style="margin-top:10px;justify-content:flex-end;gap:6px">
          <button class="s-cancel">Abbrechen</button><button class="primary s-ok">Speichern</button>
        </div>
      </div></div>`;
    this.el.appendChild(hud);

    this.q('.h-ready').onclick = () => this.toggleReady();
    this.q('.h-research').onclick = () => this.toggleResearch();
    // Every menu entry closes the menu after its action.
    this.q('.h-menu').onclick = () => this.toggleMenu();
    this.q('.h-gift').onclick = () => this.openGift();
    this.q('.g-cancel').onclick = () => this.q('.o-gift').classList.add('hidden');
    this.q('.g-send').onclick = () => this.sendGift();
    this.q('.o-gift').querySelectorAll<HTMLButtonElement>('[data-add]').forEach((b) => {
      b.onclick = () => { this.q<HTMLInputElement>('.g-amount').value = b.dataset.add === 'all' ? String(Math.floor(this.me?.gold ?? 0)) : b.dataset.add!; };
    });
    this.q<HTMLInputElement>('.g-amount').onkeydown = (e) => { if (e.key === 'Enter') this.sendGift(); else if (e.key === 'Escape') this.q('.o-gift').classList.add('hidden'); };
    const jc = this.q<HTMLSelectElement>('.j-class');
    jc.value = CLASSES[Math.floor(Math.random() * CLASSES.length)].id;
    this.q('.j-join').onclick = () => this.net.send({ t: 'joinGame', classId: jc.value });
    this.q('.h-route').onclick = () => this.toggleRoute();
    this.q('.h-zones').onclick = () => this.toggleGrid();
    this.q('.game-menu').addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('button')) this.toggleMenu(false); });
    window.addEventListener('mousedown', (e) => { if (!(e.target as HTMLElement).closest?.('.bottom-right')) this.toggleMenu(false); });
    this.q('.h-score').onclick = () => this.toggleScore();
    this.q('.h-pause').onclick = () => this.togglePause();
    this.q('.p-resume').onclick = () => this.togglePause();
    this.q('.h-save').onclick = () => this.saveGame();
    this.q('.h-quit').onclick = () => this.openQuit();
    const quitIn = this.q<HTMLInputElement>('.quit-name');
    const closeQuit = () => this.q('.o-quit').classList.add('hidden');
    this.q('.q-cancel').onclick = closeQuit;
    this.q('.q-nosave').onclick = () => { closeQuit(); this.net.send({ t: 'quitGame' }); };
    const saveQuit = () => { closeQuit(); this.net.send({ t: 'quitGame', save: quitIn.value.trim() || quitIn.placeholder }); };
    this.q('.q-save').onclick = saveQuit;
    quitIn.onkeydown = (e) => { if (e.key === 'Enter') saveQuit(); else if (e.key === 'Escape') closeQuit(); };
    const saveIn = this.q<HTMLInputElement>('.save-name');
    const submitSave = () => {
      const name = saveIn.value.trim() || saveIn.placeholder;
      this.net.send({ t: 'save', name });
      this.q('.o-save').classList.add('hidden');
    };
    this.q('.s-ok').onclick = submitSave;
    this.q('.s-cancel').onclick = () => this.q('.o-save').classList.add('hidden');
    saveIn.onkeydown = (e) => {
      if (e.key === 'Enter') submitSave();
      else if (e.key === 'Escape') this.q('.o-save').classList.add('hidden');
    };
    this.q('.h-sound').onclick = () => this.toggleSound();
    this.el.querySelectorAll<HTMLElement>('.overlay').forEach((o) => {
      o.addEventListener('mousedown', (e) => { if (e.target === o) o.classList.add('hidden'); });
    });
    this.q<HTMLCanvasElement>('.minimap canvas').addEventListener('mousedown', (e) => this.minimapClick(e));
    this.q<HTMLCanvasElement>('.minimap canvas').addEventListener('mousemove', (e) => { if (e.buttons & 1) this.minimapClick(e); });
    this.bindInput();
    requestAnimationFrame(() => this.loop());
  }

  private q<T extends HTMLElement = HTMLElement>(sel: string): T { return this.el.querySelector(sel) as T; }

  private get me(): CPlayer | undefined { return this.players.get(this.you); }
  private get myClass() { const c = this.me?.classId; return c ? CLASS_BY_ID[c] : undefined; }
  private get spectator() { return !this.players.has(this.you); }

  // ------------------------------------------------------------------ lifecycle

  load(state: FullState, hostId: string | null) {
    // Switch to the game's map before anything reads the map state.
    this.ent.clear();
    setActiveMap(state.map);
    if (this.world.mapId !== state.map) this.world.loadMap();
    this.blocked = new Uint8Array(MAP_W * MAP_H);
    const mm = this.q<HTMLCanvasElement>('.minimap canvas');
    mm.height = Math.round((230 * MAP_H) / MAP_W);
    mm.style.height = mm.height + 'px';
    this.you = state.you;
    this.hostId = hostId;
    this.players = new Map(state.players.map((p) => [p.id, p]));
    this.lanes = state.lanes;
    this.wave = state.wave;
    this.lives = state.lives;
    this.highscore = state.highscore;
    this.over = false;
    this.setPaused(null);
    this.selected = null;
    this.buildDef = null;
    this.ent.clear();
    for (const t of state.towers) this.ent.setTower(t);
    for (const [id, x, y] of state.mines) this.ent.addMine(id, x, y);
    this.refreshRoutes();
    this.repaintZones();
    this.updateViewButtons();
    this.buildBuildPanel();
    this.q('.o-over').classList.add('hidden');
    this.q('.o-research').classList.add('hidden');
    this.show(true);
    this.focusStart();
    this.updateHud(true);
  }

  setHost(hostId: string | null) { this.hostId = hostId; }

  /** Updates connection state and names from lobby broadcasts. */
  updateLobby(players: LobbyPlayer[], you: string) {
    let changed = false;
    for (const lp of players) {
      const p = this.players.get(lp.id);
      if (p) {
        if (p.connected !== lp.connected) changed = true;
        p.connected = lp.connected;
        p.name = lp.name;
      }
      if (lp.id === you) this.wish = lp.pos;
    }
    // Towers of disconnected players can be used by everybody – refresh the selection panel.
    if (changed && this.selected?.kind === 'tower') this.renderSelection();
  }

  show(v: boolean) {
    this.active = v;
    this.el.classList.toggle('hidden', !v);
    if (!v) this.ent.clear();
    else this.world.resize();
  }

  // ------------------------------------------------------------------ messages

  handle(msg: ServerMsg) {
    switch (msg.t) {
      case 'snap': this.onSnapshot(msg); break;
      case 'tower': {
        const prev = this.ent.towers.get(msg.tower.id);
        if (msg.tower.owner === this.you) sfx.play(prev ? (prev.info.level !== msg.tower.level ? 'upgrade' : 'click') : 'build');
        this.ent.setTower(msg.tower);
        if (!prev) this.refreshRoutes();
        if (this.selected?.kind === 'tower' && this.selected.id === msg.tower.id) this.renderSelection();
        break;
      }
      case 'towerGone':
        this.ent.removeTower(msg.id);
        this.refreshRoutes();
        if (this.selected?.kind === 'tower' && this.selected.id === msg.id) this.select(null);
        break;
      case 'joined': this.players.set(msg.player.id, msg.player); break;
      case 'chat': this.chatLine(msg.from ? `<b style="color:${hex(msg.color)}">${esc(msg.name)}:</b> ${esc(msg.text)}` : `<span class="gold">${esc(msg.text)}</span>`); break;
      case 'event': this.onEvent(msg.kind, msg.text); break;
      case 'ping': {
        this.pings.push({ x: msg.x, y: msg.y, color: msg.color, until: performance.now() + 4000 });
        this.ent.fx.ring(toWorld(msg.x, msg.y), msg.color, 5, 3, 3);
        sfx.play('ping');
        break;
      }
      case 'error': this.toast(msg.msg); sfx.play('error'); break;
      case 'gameOver': this.onGameOver(msg); break;
    }
  }

  private onSnapshot(s: Snapshot) {
    if (this.lives && s.lives < this.lives) sfx.play('leak');
    this.wave = s.wave;
    this.lives = s.lives;
    this.timer = s.timer;
    if (s.paused !== this.paused) this.setPaused(s.paused);
    for (const ps of s.players) {
      const p = this.players.get(ps.id);
      if (p) {
        const researchChanged = JSON.stringify(p.research) !== JSON.stringify(ps.research);
        Object.assign(p, ps);
        if (researchChanged && ps.id === this.you) { this.renderResearch(); sfx.play('research'); }
      }
    }
    this.ent.applySnapshot(s);
  }

  private onEvent(kind: string, text: string) {
    this.chatLine(`<span style="color:${kind === 'boss' ? '#ff6060' : kind === 'victory' ? '#80ff80' : '#ffd84a'}">${esc(text)}</span>`);
    if (kind === 'wave' || kind === 'boss' || kind === 'victory') {
      const b = this.q('.banner');
      b.className = 'banner ' + kind;
      b.textContent = kind === 'victory' ? 'SIEG! Endlos-Modus beginnt' : text.split('(')[0].trim();
      b.style.opacity = '1';
      clearTimeout((b as any)._t);
      (b as any)._t = setTimeout(() => { b.style.opacity = '0'; }, kind === 'victory' ? 6000 : 3000);
      sfx.play(kind === 'boss' ? 'boss' : kind === 'victory' ? 'victory' : 'wave');
    }
  }

  private onGameOver(msg: Extract<ServerMsg, { t: 'gameOver' }>) {
    this.over = true;
    sfx.play(msg.victory ? 'victory' : 'defeat');
    const o = this.q('.o-over');
    const isHost = this.hostId === this.you;
    const sm = msg.summary;
    const mapName = MAPS.find((m) => m.id === sm.map)?.name ?? sm.map;
    const time = `${Math.floor(sm.time / 60)}:${String(sm.time % 60).padStart(2, '0')}`;
    const tile = (icon: string, label: string, value: string) => `<div class="tile"><div class="ti">${icon}</div><div class="tv">${value}</div><div class="tl">${label}</div></div>`;
    const tower = sm.topTower ? `${esc(TOWER_BY_ID[sm.topTower.def]?.levelNames[sm.topTower.level] ?? sm.topTower.def)} von ${esc(sm.topTower.owner)} (${fmt(sm.topTower.damage)} Schaden, ${sm.topTower.kills} Kills)` : '–';
    const list = (l: [string, number][]) => (l.length ? l.map(([id, n]) => `${esc(ENEMY_BY_ID[id]?.name ?? id)} (${n}×)`).join(', ') : '–');
    const rows = [...msg.stats].sort((a, b) => b.damage - a.damage).map((s, i) => `
      <tr><td>${i + 1}.</td><td><span class="dot" style="background:${hex(s.color)}"></span>${esc(s.name)} <span class="muted">${CLASS_ICONS[s.classId] ?? ''}</span></td><td>${s.kills}</td><td>${fmt(s.damage)}</td><td>${s.towersBuilt}</td><td>${s.upgrades}</td><td>${fmt(s.goldEarned)}</td><td>${s.goldSent ? fmt(s.goldSent) : '–'}</td></tr>`).join('');
    o.querySelector('.panel')!.innerHTML = `
      <h1 style="text-align:center;margin:4px 0">${msg.victory ? '🏆 Ruhmreicher Kampf!' : '💀 Niederlage'}</h1>
      <p style="text-align:center;font-size:18px;margin:4px">${msg.victory ? `Ihr habt alle ${VICTORY_WAVE} Wellen besiegt und im Endlos-Modus bis Welle <b>${msg.wave}</b> durchgehalten!` : `Das Tor ist gefallen. Überstanden: <b>${msg.wave}</b> Wellen.`}</p>
      <p style="text-align:center" class="${msg.newRecord ? 'gold' : 'muted'}">${msg.newRecord ? '🎉 Neuer Rekord' : '🏆 Rekord'} auf „${esc(mapName)}“: Welle ${msg.highscore}</p>
      <div class="tiles">
        ${tile('⏱', 'Spielzeit', time)}${tile('🗺', 'Karte', esc(mapName))}${tile('👥', 'Spieler', String(sm.players))}${tile('❤', 'Leben übrig / verloren', `${sm.livesLeft} / ${sm.livesLost}`)}
        ${tile('☠', 'Gegner besiegt', fmt(sm.creepsKilled))}${tile('👑', 'Bosse besiegt', String(sm.bossesKilled))}${tile('💥', 'Gesamtschaden', fmt(sm.totalDamage))}${tile('🏗', 'Türme gebaut / stehen', `${sm.towersBuilt} / ${sm.towersAlive}`)}
      </div>
      <div class="muted" style="font-size:13px;margin:8px 0">
        <div>⭐ Stärkster Turm: <b>${tower}</b></div>
        <div>☠ Am häufigsten besiegt: ${list(sm.topKilled)}</div>
        <div>🚪 Am häufigsten durchgekommen: ${list(sm.topLeaked)}</div>
      </div>
      <table class="scoreboard" style="width:100%"><tr><th>#</th><th>Spieler</th><th>Kills</th><th>Schaden</th><th>Türme</th><th>Upgrades</th><th>Gold verdient</th><th>Gold gesendet</th></tr>${rows}</table>
      <div style="text-align:center;margin-top:12px">${isHost ? '<button class="primary back">Zurück zur Lobby</button>' : '<span class="muted">Warte auf den Host…</span>'}</div>`;
    o.querySelector<HTMLButtonElement>('.back')?.addEventListener('click', () => this.net.send({ t: 'backToLobby' }));
    o.classList.remove('hidden');
  }

  // ------------------------------------------------------------------ build panel & research

  private buildBuildPanel() {
    const cls = this.myClass;
    const grid = this.q('.build-grid');
    this.q('.h-spectator').classList.toggle('hidden', !this.spectator);
    this.q('.h-research').classList.toggle('hidden', this.spectator);
    if (!cls || this.spectator) { grid.innerHTML = ''; this.q('.h-class').textContent = 'Zuschauer'; return; }
    this.q('.h-class').innerHTML = `${CLASS_ICONS[cls.id]} ${esc(cls.name)}`;
    grid.innerHTML = cls.towers.map((t, i) => `
      <button class="build-btn" data-def="${t.id}">
        <kbd class="hk">${i + 1}</kbd>
        <span class="ico">${TOWER_ICONS[t.shape]}</span>
        <span class="nm">${esc(t.name)}</span>
        <span class="cost">${t.cost}${t.lumber ? ` +${t.lumber}🌲` : ''}</span>
      </button>`).join('');
    grid.querySelectorAll<HTMLButtonElement>('.build-btn').forEach((b) => {
      const def = TOWER_BY_ID[b.dataset.def!];
      b.onclick = () => this.startBuild(def);
      b.onmouseenter = () => this.showTooltip(b, towerTooltip(def, 0, def.requires && !this.me?.research[def.requires] ? `<div class="bad">🔒 Benötigt Forschung: ${esc(cls.research.find((r) => r.id === def.requires)!.name)}</div>` : ''));
      b.onmouseleave = () => this.hideTooltip();
    });
  }

  private updateBuildButtons() {
    // While a tower is being placed the arrow keys move the build cursor instead of the camera.
    this.world.arrowKeysMoveCamera = !this.buildDef;
    this.q('.build-hint').classList.toggle('hidden', !this.buildDef);
    const me = this.me;
    if (!me) return;
    this.el.querySelectorAll<HTMLButtonElement>('.build-btn').forEach((b) => {
      const def = TOWER_BY_ID[b.dataset.def!];
      const locked = !!def.requires && !me.research[def.requires];
      b.classList.toggle('locked', locked);
      b.disabled = locked || me.gold < def.cost || me.lumber < def.lumber;
      b.classList.toggle('active', this.buildDef?.id === def.id);
    });
  }

  private startBuild(def: TowerDef) {
    const me = this.me;
    if (!me || this.spectator || this.over) return;
    if (def.requires && !me.research[def.requires]) { this.toast('Erst erforschen!'); sfx.play('error'); return; }
    this.buildDef = this.buildDef?.id === def.id ? null : def;
    if (this.buildDef) {
      this.select(null);
      if (!this.hover) this.hover = this.world.pickGround(window.innerWidth / 2, window.innerHeight / 2);
    }
    this.updateBuildButtons();
    this.updateHoverVisuals();
  }

  private toggleResearch() {
    if (this.spectator) return;
    const o = this.q('.o-research');
    o.classList.toggle('hidden');
    this.renderResearch();
  }

  private renderResearch() {
    const o = this.q('.o-research');
    const cls = this.myClass, me = this.me;
    if (o.classList.contains('hidden') || !cls || !me) return;
    o.querySelector('.panel')!.innerHTML = `
      <h2 style="margin-top:0">📜 Forschung – ${esc(cls.name)}</h2>
      <p class="muted" style="margin-top:0">Forschung gilt für alle deine Türme. Kostet Gold und Holz (Holz gibt es zu jeder Welle).</p>
      <div class="research-list">${cls.research.map((r) => {
        const lvl = me.research[r.id] ?? 0;
        const maxed = lvl >= r.maxLevel;
        const can = !maxed && me.gold >= r.gold[lvl] && me.lumber >= r.lumber[lvl];
        return `<div class="research-item">
          <div class="desc"><b class="gold">${esc(r.name)}</b> <span class="lvl">Stufe ${lvl}/${r.maxLevel}</span><br>${esc(r.desc)}</div>
          <button class="primary" data-r="${r.id}" ${can ? '' : 'disabled'}>${maxed ? 'Fertig ✔' : `${r.gold[lvl]} 💰 ${r.lumber[lvl]} 🌲`}</button>
        </div>`;
      }).join('')}</div>
      <div style="text-align:right;margin-top:10px"><button class="close">Schließen (Esc)</button></div>`;
    o.querySelectorAll<HTMLButtonElement>('[data-r]').forEach((b) => { b.onclick = () => this.net.send({ t: 'research', id: b.dataset.r! }); });
    o.querySelector<HTMLButtonElement>('.close')!.onclick = () => o.classList.add('hidden');
  }

  private toggleScore(show?: boolean) {
    const o = this.q('.o-score');
    const v = show ?? o.classList.contains('hidden');
    o.classList.toggle('hidden', !v);
    if (v) this.renderScore();
  }

  private renderScore() {
    const o = this.q('.o-score');
    if (o.classList.contains('hidden')) return;
    const towerCount = new Map<string, number>();
    for (const t of this.ent.towers.values()) towerCount.set(t.info.owner, (towerCount.get(t.info.owner) ?? 0) + 1);
    const rows = [...this.players.values()].sort((a, b) => b.damage - a.damage).map((p) => `
      <tr style="opacity:${p.connected ? 1 : 0.5}">
        <td><span class="dot" style="background:${hex(p.color)}"></span>${esc(p.name)}${p.id === this.you ? ' (du)' : ''}</td>
        <td>${p.classId ? CLASS_ICONS[p.classId] + ' ' + esc(CLASS_BY_ID[p.classId].name) : ''}</td>
        <td>${towerCount.get(p.id) ?? 0}</td><td>${p.kills}</td><td>${fmt(p.damage)}</td><td class="gold">${fmt(p.gold)}</td><td>${p.lumber}</td>
        <td>${p.ready ? '✔' : ''}${p.connected ? '' : ' ⚠ getrennt'}</td>
      </tr>`).join('');
    o.querySelector('.panel')!.innerHTML = `<h2 style="margin-top:0">📊 Punktestand – Welle ${this.wave}</h2>
      <table><tr><th>Spieler</th><th>Klasse</th><th>Türme</th><th>Kills</th><th>Schaden</th><th>Gold</th><th>Holz</th><th></th></tr>${rows}</table>`;
  }

  private toggleReady() {
    if (!this.me || this.over) return;
    this.net.send({ t: 'callWave', ready: !this.me.ready });
    this.me.ready = !this.me.ready;
    this.updateHud(true);
  }

  // ------------------------------------------------------------------ selection

  /** Own towers – and, while the owner is disconnected, everybody's towers – can be used. */
  private canUse(info: TowerInfo): boolean {
    if (this.spectator || this.over) return false;
    return info.owner === this.you || this.players.get(info.owner)?.connected === false;
  }

  private select(sel: Selection) {
    this.selected = sel;
    this.renderSelection();
    this.updateHoverVisuals();
  }

  private renderSelection() {
    const panel = this.q('.sel-panel');
    const sel = this.selected;
    if (!sel) { panel.classList.add('hidden'); this.world.selectRing.visible = false; return; }
    panel.classList.remove('hidden');
    if (sel.kind === 'tower') {
      const t = this.ent.towers.get(sel.id);
      if (!t) { this.select(null); return; }
      const info = t.info;
      const def = TOWER_BY_ID[info.def];
      const owner = this.players.get(info.owner);
      const eff = effectiveStats(info.def, info.level, owner?.research ?? {}, auraBuffs(info, [...this.ent.towers.values()].map((x) => x.info)));
      const mine = this.canUse(info);
      const shared = mine && info.owner !== this.you;
      const maxLevel = def.maxLevel ?? 2;
      const next = info.level < maxLevel ? def.levels[info.level + 1] : null;
      const upLabel = next
        ? `<span>⬆ Aufwerten <kbd>U</kbd></span><small>${def.upCost[info.level]} 💰${def.upLumber[info.level] ? ` ${def.upLumber[info.level]} 🌲` : ''}</small>`
        : '<span>Max. Stufe</span><small>&nbsp;</small>';
      panel.innerHTML = `
        <div class="portrait" style="border-color:${hex(owner?.color ?? 0xffffff)}">${TOWER_ICONS[def.shape]}</div>
        <div class="info">
          <h3>${esc(def.levelNames[info.level])} <span class="gold">${'★'.repeat(info.level + 1)}</span><span class="muted">${'☆'.repeat(maxLevel - info.level)}</span> <small class="muted">Stufe ${info.level + 1}/${maxLevel + 1}</small></h3>
          <div class="muted" style="margin-bottom:4px"><span class="dot" style="background:${hex(owner?.color ?? 0xffffff)}"></span>${esc(owner?.name ?? '?')}${shared ? ' <span class="bad">(getrennt – gemeinsam nutzbar)</span>' : ''} · Kills: ${info.kills} · Schaden: ${fmt(info.damage)}</div>
          <div class="stats">${statLines(eff, def.levels[info.level]).map(([k, v]) => `<div><span class="muted">${k}:</span> ${v}</div>`).join('')}</div>
        </div>
        ${mine ? `<div class="actions">
          <button class="primary up" ${next ? '' : 'disabled'}>${upLabel}</button>
          <button class="sell"><span>Verkaufen <kbd>V</kbd></span><small>+${Math.floor(info.invested * SELL_REFUND)} 💰</small></button>
        </div>` : ''}
        ${mine && eff.dmg > 0 ? `<div class="modes">${(Object.keys(TARGET_MODE_NAMES) as TargetMode[]).map((m) => `<button data-mode="${m}" class="${info.mode === m ? 'active' : ''}">${TARGET_MODE_NAMES[m]}</button>`).join('')}</div>` : ''}`;
      const upBtn = panel.querySelector<HTMLButtonElement>('.up');
      upBtn?.addEventListener('click', () => { this.lastUpgradeAt = performance.now(); this.net.send({ t: 'upgrade', id: info.id }); });
      if (upBtn && next) {
        upBtn.onmouseenter = () => this.showTooltip(upBtn, towerTooltip(def, info.level + 1));
        upBtn.onmouseleave = () => this.hideTooltip();
      }
      // Right after an upgrade the panel is redrawn – ignore clicks on "sell" for a moment so a double click cannot sell the tower.
      panel.querySelector<HTMLButtonElement>('.sell')?.addEventListener('click', () => {
        if (performance.now() - this.lastUpgradeAt < 900) return;
        this.net.send({ t: 'sell', id: info.id });
      });
      panel.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => { b.onclick = () => this.net.send({ t: 'mode', id: info.id, mode: b.dataset.mode as TargetMode }); });
      this.world.showRange(this.world.rangeRing, info.cx + 0.5, info.cy + 0.5, eff.range);
      if (eff.aura) this.world.showRange(this.world.auraRing, info.cx + 0.5, info.cy + 0.5, eff.aura.range); else this.world.auraRing.visible = false;
      this.world.selectRing.visible = true;
      this.world.selectRing.position.copy(t.group.position).setY(0.1);
      this.world.selectRing.scale.setScalar(1);
    } else {
      this.renderEnemySelection();
    }
  }

  private renderEnemySelection() {
    const panel = this.q('.sel-panel');
    const e = this.selected && this.ent.enemies.get(this.selected.id);
    if (!e) { this.select(null); return; }
    const d = e.def;
    panel.innerHTML = `
      <div class="portrait">${ENEMY_ICONS[d.shape]}</div>
      <div class="info">
        <h3>${esc(d.name)}</h3>
        <div>${enemyTags(d)}</div>
        <div class="stats" style="margin-top:4px">
          <div><span class="muted">Leben:</span> ${fmt(e.hp)} / ${fmt(e.maxHp)}</div>
          <div><span class="muted">Rüstung:</span> ${ARMOR_NAMES[d.armorType]} (${d.armor})</div>
          <div><span class="muted">Tempo:</span> ${d.speed}</div>
          <div><span class="muted">Kostet Leben:</span> ${d.lives}</div>
        </div>
        <div class="muted" style="margin-top:4px">${esc(d.desc)}</div>
      </div>`;
    this.world.rangeRing.visible = false;
    this.world.auraRing.visible = false;
    this.world.selectRing.visible = true;
  }

  // ------------------------------------------------------------------ input

  private bindInput() {
    const canvas = this.world.renderer.domElement;
    canvas.addEventListener('mousemove', (e) => {
      this.hover = this.world.pickGround(e.clientX, e.clientY);
      this.updateHoverVisuals();
    });
    canvas.addEventListener('mousedown', (e) => {
      if (!this.active) return;
      if (e.button === 2) { this.buildDef = null; this.updateBuildButtons(); this.updateHoverVisuals(); return; }
      if (e.button !== 0) return;
      const g = this.world.pickGround(e.clientX, e.clientY);
      if (e.altKey && g) { this.net.send({ t: 'ping', x: g.x, y: g.y }); return; }
      if (this.buildDef && g) {
        this.net.send({ t: 'build', def: this.buildDef.id, cx: g.cx, cy: g.cy });
        if (!e.shiftKey) { this.buildDef = null; this.updateBuildButtons(); }
        this.updateHoverVisuals();
        return;
      }
      const obj = this.world.pickObjects(e.clientX, e.clientY, this.ent.pickables());
      const id = obj?.userData.pickId as string | undefined;
      if (id) this.select({ kind: id[0] === 't' ? 'tower' : 'enemy', id: Number(id.slice(1)) });
      else if (g) {
        const t = [...this.ent.towers.values()].find((x) => x.info.cx === g.cx && x.info.cy === g.cy);
        this.select(t ? { kind: 'tower', id: t.info.id } : null);
      }
    });
    window.addEventListener('keyup', (e) => { if (e.key === 'Tab' && this.active) { e.preventDefault(); this.toggleScore(false); } });
    window.addEventListener('keydown', (e) => {
      if (!this.active) return;
      const chatIn = this.q<HTMLInputElement>('.chat input');
      if (document.activeElement === chatIn) {
        if (e.key === 'Enter') {
          const text = chatIn.value.trim();
          if (text) this.net.send({ t: 'chat', text });
          chatIn.value = '';
          this.closeChat();
        } else if (e.key === 'Escape') this.closeChat();
        return;
      }
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && key === 's') { e.preventDefault(); this.saveGame(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // Shortcuts that open a dialog must not type their letter into the dialog's input field.
      if (key.length === 1 && 'rgtmq'.includes(key)) e.preventDefault();
      // Place towers with the keyboard: arrows move the cursor, Enter builds (Shift+Enter keeps the build mode).
      if (this.buildDef && e.key.startsWith('Arrow')) {
        e.preventDefault();
        const n = e.shiftKey ? 5 : 1;
        this.moveCursor(e.key === 'ArrowLeft' ? -n : e.key === 'ArrowRight' ? n : 0, e.key === 'ArrowUp' ? -n : e.key === 'ArrowDown' ? n : 0);
        return;
      }
      if (e.key === 'Enter' && this.buildDef && this.hover) { e.preventDefault(); this.placeAtCursor(e.shiftKey); return; }
      if (e.key === 'Tab') { e.preventDefault(); if (!e.repeat) this.toggleScore(true); return; }
      if (e.key === 'Enter') { e.preventDefault(); this.openChat(); return; }
      if (e.key === 'Escape') {
        this.el.querySelectorAll('.overlay:not(.o-over)').forEach((o) => o.classList.add('hidden'));
        this.toggleMenu(false);
        this.buildDef = null; this.select(null); this.updateBuildButtons(); return;
      }
      if (e.key === ' ') { e.preventDefault(); this.focusNext(); return; }
      if (/^[1-9]$/.test(e.key) && this.myClass) {
        const def = this.myClass.towers[Number(e.key) - 1];
        if (def) this.startBuild(def);
        return;
      }
      const sel = this.selected?.kind === 'tower' ? this.ent.towers.get(this.selected.id) : undefined;
      if (key === 'u' && sel && this.canUse(sel.info)) { this.lastUpgradeAt = performance.now(); this.net.send({ t: 'upgrade', id: sel.info.id }); }
      else if (key === 'v' && sel && this.canUse(sel.info)) this.net.send({ t: 'sell', id: sel.info.id });
      else if (key === 'f') this.toggleResearch();
      else if (key === 'n') this.toggleReady();
      else if (key === 'p') this.togglePause();
      else if (key === 'r') this.toggleRoute();
      else if (key === 'g') this.toggleGrid();
      else if (key === 't') this.openGift();
      else if (key === 'm') this.toggleSound();
      else if (key === 'q') this.openQuit();
      else if (e.key === 'F10') { e.preventDefault(); this.toggleMenu(); }
    });
  }

  /** Route lines are shown unless the player has hidden them. */
  private get routeVisible() { return this.view.route; }

  private repaintZones() {
    this.world.paintMap(this.view.zones);
    this.minimapBg = null;
  }

  private updateViewButtons() {
    const r = this.q('.h-route');
    r.innerHTML = `🧭 Laufweg: ${this.view.route ? 'an' : 'aus'} <kbd>R</kbd>`;
    this.q('.h-zones').innerHTML = `🔲 Bauraster: ${this.view.zones ? 'an' : 'aus'} <kbd>G</kbd>`;
  }

  private toggleRoute() {
    this.view.route = !this.view.route;
    localStorage.setItem('td-route', this.view.route ? '1' : '0');
    this.refreshRoutes();
    this.updateViewButtons();
  }

  private toggleGrid() {
    this.view.zones = !this.view.zones;
    localStorage.setItem('td-zones', this.view.zones ? '1' : '0');
    this.repaintZones();
    this.updateViewButtons();
  }

  private toggleSound() {
    sfx.setEnabled(!sfx.enabled);
    this.q('.h-sound').innerHTML = `${sfx.enabled ? '🔊' : '🔇'} Ton: ${sfx.enabled ? 'an' : 'aus'} <kbd>M</kbd>`;
  }

  // ------------------------------------------------------------------ keyboard build cursor

  /** Moves the build cursor (shared with the mouse hover) and keeps it on screen. */
  private moveCursor(dx: number, dy: number) {
    const base = this.hover ?? this.world.pickGround(window.innerWidth / 2, window.innerHeight / 2);
    if (!base) return;
    const cx = Math.min(MAP_W - 1, Math.max(0, base.cx + dx)), cy = Math.min(MAP_H - 1, Math.max(0, base.cy + dy));
    this.hover = { x: cx + 0.5, y: cy + 0.5, cx, cy };
    const v = toWorld(cx + 0.5, cy + 0.5, 0).project(this.world.camera);
    if (Math.abs(v.x) > 0.8 || Math.abs(v.y) > 0.8) this.world.focus(cx + 0.5, cy + 0.5);
    this.updateHoverVisuals();
  }

  private placeAtCursor(keepMode: boolean) {
    const h = this.hover;
    if (!h || !this.buildDef) return;
    this.net.send({ t: 'build', def: this.buildDef.id, cx: h.cx, cy: h.cy });
    if (!keepMode) { this.buildDef = null; this.updateBuildButtons(); }
    this.updateHoverVisuals();
  }

  private toggleMenu(open?: boolean) {
    const m = this.q('.game-menu');
    const show = open ?? m.classList.contains('hidden');
    m.classList.toggle('hidden', !show);
    this.q('.h-menu').classList.toggle('active', show);
  }

  private togglePause() {
    if (this.spectator || this.over) return;
    this.net.send({ t: 'pause', paused: !this.paused });
  }

  private setPaused(by: string | null) {
    this.paused = by;
    this.ent.paused = !!by;
    this.el.classList.toggle('paused', !!by);
    this.q('.pause-box').classList.toggle('hidden', !by);
    this.q('.p-by').textContent = by ? `von ${by}` : '';
    this.q('.p-resume').classList.toggle('hidden', this.spectator);
    this.q('.h-pause').classList.toggle('hidden', this.spectator);
    this.q('.h-save').classList.toggle('hidden', this.spectator);
    this.q('.h-gift').classList.toggle('hidden', this.spectator);
    this.q('.h-pause').classList.toggle('active', !!by);
    this.q('.h-pause').innerHTML = by ? '▶ Fortsetzen <kbd>P</kbd>' : '⏸ Pause <kbd>P</kbd>';
    this.updateHud(true);
  }

  private openQuit() {
    if (this.hostId !== this.you) return;
    const d = new Date();
    const input = this.q<HTMLInputElement>('.quit-name');
    input.value = '';
    input.placeholder = `Welle ${this.wave} – ${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    input.classList.toggle('hidden', this.over);
    this.q<HTMLButtonElement>('.q-save').classList.toggle('hidden', this.over);
    this.q('.o-quit').classList.remove('hidden');
    input.focus();
  }

  private saveGame() {
    if (this.spectator || this.over) return;
    const d = new Date();
    const input = this.q<HTMLInputElement>('.save-name');
    input.value = '';
    input.placeholder = `Welle ${this.wave} – ${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    this.q('.o-save').classList.remove('hidden');
    input.focus();
  }

  private openChat() {
    const c = this.q('.chat');
    const input = this.q<HTMLInputElement>('.chat input');
    c.classList.add('open');
    input.classList.remove('hidden');
    input.focus();
  }

  private closeChat() {
    const input = this.q<HTMLInputElement>('.chat input');
    input.blur();
    input.classList.add('hidden');
    this.q('.chat').classList.remove('open');
  }

  private updateHoverVisuals() {
    const w = this.world;
    const h = this.hover;
    if (this.buildDef && h && this.me) {
      const def = this.buildDef;
      const occupied = [...this.ent.towers.values()].some((t) => t.info.cx === h.cx && t.info.cy === h.cy);
      const own = isBuildable(h.cx, h.cy);
      const ok = own && !occupied && this.me.gold >= def.cost && this.me.lumber >= def.lumber && !this.wouldBlock(h.cx, h.cy);
      w.hoverMesh.visible = h.cx >= 0 && h.cy >= 0 && h.cx < MAP_W && h.cy < MAP_H;
      toWorld(h.cx + 0.5, h.cy + 0.5, 0.06, w.hoverMesh.position);
      (w.hoverMesh.material as any).color.setHex(ok ? 0x40ff40 : 0xff4040);
      const eff = effectiveStats(def.id, 0, this.me.research, { dmg: 0, speed: 0 });
      w.showRange(w.rangeRing, h.cx + 0.5, h.cy + 0.5, eff.range);
      if (eff.aura) w.showRange(w.auraRing, h.cx + 0.5, h.cy + 0.5, eff.aura.range); else w.auraRing.visible = false;
      return;
    }
    w.hoverMesh.visible = false;
    if (!this.selected) { w.rangeRing.visible = false; w.auraRing.visible = false; }
  }

  /** First camera position: the player's wish from the lobby, else the first active portal. */
  private focusStart() {
    if (this.wish) this.world.focus(this.wish.x * MAP_W, this.wish.y * MAP_H);
    else this.world.focus(SPAWNS[this.lanes[0] ?? 0].x, SPAWNS[this.lanes[0] ?? 0].y + 8);
  }

  /** Space: cycles the camera through the active portals and the gate. */
  private focusNext() {
    const spots = [...this.lanes.map((l) => ({ x: SPAWNS[l].x, y: SPAWNS[l].y + 6 })), { x: Math.min(MAP_W - 1, Math.max(1, GATE.x)), y: MAP_H - 8 }];
    const p = spots[this.focusCycle++ % spots.length];
    this.world.focus(p.x, p.y);
  }

  /** Recomputes the creep routes from the current towers (shown as dashed lines, like the Wintermaul maze preview). */
  private refreshRoutes() {
    this.blocked.fill(0);
    for (const t of this.ent.towers.values()) this.blocked[cellIndex(t.info.cx, t.info.cy)] = 1;
    const flow = computeFlow(this.blocked);
    this.routes = this.lanes.map((l) => traceRoute(flow, this.blocked, SPAWNS[l].x, SPAWNS[l].y));
    this.world.setRoutes(this.routeVisible ? this.routes : []);
    this.blockCheck.key = '';
    this.renderMazeInfo();
  }

  /** True if a tower at (cx, cy) would cut every route (the server rejects that, too). */
  private wouldBlock(cx: number, cy: number): boolean {
    const key = `${cx},${cy}`;
    if (this.blockCheck.key === key) return this.blockCheck.blocks;
    let blocks = false;
    if (cx >= 0 && cy >= 0 && cx < MAP_W && cy < MAP_H && WALKABLE[cellIndex(cx, cy)] && !this.blocked[cellIndex(cx, cy)]) {
      this.blocked[cellIndex(cx, cy)] = 1;
      blocks = !spawnsConnected(computeFlow(this.blocked));
      this.blocked[cellIndex(cx, cy)] = 0;
    }
    this.blockCheck = { key, blocks };
    return blocks;
  }

  /** Length of the creep route through the lanes the player builds in. */
  private renderMazeInfo() {
    const el = this.q('.h-maze');
    el.classList.toggle('hidden', !this.routeVisible);
    const parts = this.lanes.map((_, i) => `<span class="gold">${Math.round(routeLength(this.routes[i] ?? []))}</span>`);
    el.innerHTML = `🧭 Weglänge: ${parts.join(' · ')}`;
  }

  // ------------------------------------------------------------------ gold gifts

  private openGift() {
    if (this.spectator || this.over) return;
    const sel = this.q<HTMLSelectElement>('.g-to');
    const others = [...this.players.values()].filter((p) => p.id !== this.you);
    if (!others.length) { this.toast('Es gibt keine Mitspieler.'); return; }
    sel.innerHTML = others.map((p) => `<option value="${p.id}">${esc(p.name)}${p.connected ? '' : ' (getrennt)'}</option>`).join('');
    this.q('.g-have').textContent = String(Math.floor(this.me?.gold ?? 0));
    this.q('.o-gift').classList.remove('hidden');
    this.q<HTMLInputElement>('.g-amount').focus();
  }

  private sendGift() {
    const to = this.q<HTMLSelectElement>('.g-to').value;
    const amount = Math.floor(Number(this.q<HTMLInputElement>('.g-amount').value));
    if (!to || !(amount > 0)) return;
    this.net.send({ t: 'gift', to, amount });
    this.q('.o-gift').classList.add('hidden');
  }

  private minimapClick(e: MouseEvent) {
    const c = e.currentTarget as HTMLCanvasElement;
    const r = c.getBoundingClientRect();
    this.world.focus(((e.clientX - r.left) / r.width) * MAP_W, ((e.clientY - r.top) / r.height) * MAP_H);
  }

  // ------------------------------------------------------------------ HUD

  private showTooltip(anchor: HTMLElement, html: string) {
    const tt = this.q('.tooltip');
    tt.innerHTML = html;
    tt.classList.remove('hidden');
    const r = anchor.getBoundingClientRect();
    const w = 300;
    let left = r.left - w - 10;
    if (left < 5) left = r.right + 10;
    tt.style.left = left + 'px';
    tt.style.top = Math.min(window.innerHeight - tt.offsetHeight - 10, Math.max(5, r.top)) + 'px';
  }
  private hideTooltip() { this.q('.tooltip').classList.add('hidden'); }

  toast(text: string) {
    const t = this.q('.toast');
    t.textContent = text;
    t.style.opacity = '1';
    clearTimeout((t as any)._t);
    (t as any)._t = setTimeout(() => { t.style.opacity = '0'; }, 2200);
  }

  chatLine(html: string) {
    const lines = this.q('.chat .lines');
    const div = document.createElement('div');
    div.className = 'line';
    div.innerHTML = html;
    lines.appendChild(div);
    while (lines.children.length > 12) lines.firstChild!.remove();
    setTimeout(() => div.classList.add('fade'), 9000);
  }

  private updateHud(force = false) {
    const now = performance.now();
    if (!force && now - this.lastHud < 200) return;
    this.lastHud = now;
    const me = this.me;
    this.q('.h-wave').textContent = this.wave > VICTORY_WAVE ? `Endlos ${this.wave}` : `${this.wave}/${VICTORY_WAVE}`;
    const connected = [...this.players.values()].filter((p) => p.connected);
    const readyCount = connected.filter((p) => p.ready).length;
    this.q('.h-timer').innerHTML = this.over ? 'Spiel vorbei' : this.paused ? '⏸ <b>Pausiert</b>' : this.timer >= 0
      ? `Nächste Welle in <b>${Math.ceil(this.timer)}s</b> <span class="ready-list">(${readyCount}/${connected.length} bereit)</span>`
      : 'Welle läuft…';
    const readyBtn = this.q<HTMLButtonElement>('.h-ready');
    readyBtn.classList.toggle('hidden', this.spectator || this.timer < 0 || this.over);
    readyBtn.classList.toggle('active', !!me?.ready);
    readyBtn.innerHTML = me?.ready ? '✔ Bereit' : 'Bereit <kbd>N</kbd>';
    this.q('.h-quit').classList.toggle('hidden', this.hostId !== this.you || !this.active);
    this.q('.h-lives').textContent = String(this.lives);
    this.q('.h-gold').textContent = me ? fmt(me.gold) : '–';
    this.q('.h-lumber').textContent = me ? String(me.lumber) : '–';
    this.q('.h-hs').textContent = String(Math.max(this.highscore, this.wave - 1));
    this.updateBuildButtons();
    this.renderWavePreview();
    this.renderScore();
    this.renderResearchButtonsState();
    if (this.selected?.kind === 'enemy') this.renderEnemySelection();
  }

  private lastResearchKey = '';
  private renderResearchButtonsState() {
    const me = this.me;
    if (!me) return;
    const key = `${me.gold >= 0 ? Math.floor(me.gold / 10) : 0}|${me.lumber}`;
    if (key !== this.lastResearchKey) { this.lastResearchKey = key; this.renderResearch(); }
  }

  private lastPreview = '';
  private renderWavePreview() {
    const n = this.timer >= 0 ? this.wave + 1 : this.wave;
    const key = `${n}|${this.timer >= 0}`;
    if (key === this.lastPreview) return;
    this.lastPreview = key;
    const w = getWave(n);
    const tips = new Set<string>();
    for (const g of w.groups) {
      const d = ENEMY_BY_ID[g.enemy];
      if (d.flying) tips.add('Luft! Nur Türme mit „Luft“-Zielen treffen.');
      if (d.invisible) tips.add('Unsichtbar! Türme mit „Erkennung“ nötig.');
      if (d.immune) tips.add('Magieimmun! Magie-Schaden und Slows wirken nicht.');
      if (d.boss) tips.add('Boss! Kostet viele Leben – konzentriert das Feuer.');
    }
    this.q('.wave-preview').innerHTML = `
      <h3>${this.timer >= 0 ? 'Nächste' : 'Aktuelle'} Welle: ${n}</h3>
      ${w.groups.map((g) => {
        const d = ENEMY_BY_ID[g.enemy];
        return `<div class="grp">${ENEMY_ICONS[d.shape]} <b>${g.count}× ${esc(d.name)}</b><br>
          <span class="muted">Rüstung: ${ARMOR_NAMES[d.armorType]} (${d.armor})</span> ${enemyTags(d)}</div>`;
      }).join('')}
      ${[...tips].map((t) => `<div class="bad" style="font-size:12px">⚠ ${t}</div>`).join('')}
      ${n < VICTORY_WAVE ? `<div class="muted" style="font-size:12px;margin-top:4px">Danach: ${getWave(n + 1).groups.map((g) => esc(ENEMY_BY_ID[g.enemy].name)).join(', ')}</div>` : ''}`;
  }

  private drawMinimap() {
    const now = performance.now();
    if (now - this.lastMinimap < 120) return;
    this.lastMinimap = now;
    const c = this.q<HTMLCanvasElement>('.minimap canvas');
    const ctx = c.getContext('2d')!;
    const sx = c.width / MAP_W, sy = c.height / MAP_H;
    if (!this.minimapBg) {
      const bg = document.createElement('canvas');
      bg.width = c.width; bg.height = c.height;
      const b = bg.getContext('2d')!;
      b.fillStyle = '#e8eef5';
      b.fillRect(0, 0, bg.width, bg.height);
      for (let y = 0; y < MAP_H; y++) {
        for (let x = 0; x < MAP_W; x++) {
          const i = cellIndex(x, y);
          b.fillStyle = WATER[i] ? '#3f78a8' : WALKABLE[i] ? (SECTION_OF[i] < 0 ? '#c4dcec' : '#e8eef5') : '#3a4552';
          b.fillRect(x * sx, y * sy, sx + 0.5, sy + 0.5);
        }
      }
      this.minimapBg = bg;
    }
    ctx.drawImage(this.minimapBg, 0, 0);
    for (const t of this.ent.towers.values()) {
      ctx.fillStyle = hex(this.players.get(t.info.owner)?.color ?? 0xffffff);
      ctx.fillRect(t.info.cx * sx + 1, t.info.cy * sy + 1, sx - 2, sy - 2);
    }
    for (const e of this.ent.enemies.values()) {
      const p = { x: e.rx, y: e.ry };
      ctx.fillStyle = e.def.boss ? '#ff40ff' : e.def.flying ? '#60c0ff' : '#ff3030';
      const r = e.def.boss ? 4 : 2;
      ctx.fillRect(p.x * sx - r / 2, p.y * sy - r / 2, r, r);
    }
    ctx.strokeStyle = 'rgba(230,60,40,0.8)';
    ctx.lineWidth = 1;
    for (const r of this.routeVisible ? this.routes : []) {
      ctx.beginPath();
      r.forEach((p, i) => (i ? ctx.lineTo(p.x * sx, p.y * sy) : ctx.moveTo(p.x * sx, p.y * sy)));
      ctx.stroke();
    }
    this.pings = this.pings.filter((p) => p.until > now);
    for (const p of this.pings) {
      ctx.strokeStyle = hex(p.color);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x * sx, p.y * sy, 4 + ((now / 80) % 10), 0, Math.PI * 2);
      ctx.stroke();
    }
    const fp = this.world.viewFootprint();
    if (fp.length === 4) {
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      fp.forEach((p, i) => (i ? ctx.lineTo(p.x * sx, p.y * sy) : ctx.moveTo(p.x * sx, p.y * sy)));
      ctx.closePath();
      ctx.stroke();
    }
  }

  // ------------------------------------------------------------------ loop

  private loop() {
    requestAnimationFrame(() => this.loop());
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.clock) / 1000);
    this.clock = now;
    if (!this.active) return;
    if (this.timer > 0 && !this.paused) this.timer = Math.max(0, this.timer - dt);
    this.ent.update(dt, now / 1000);
    if (this.selected?.kind === 'enemy') {
      const e = this.ent.enemies.get(this.selected.id);
      if (e) { this.world.selectRing.position.copy(e.root.position).setY(0.1); this.world.selectRing.scale.setScalar(e.def.scale * 1.4); }
      else this.select(null);
    }
    this.world.render(dt, now / 1000);
    this.updateHud();
    this.drawMinimap();
  }
}
