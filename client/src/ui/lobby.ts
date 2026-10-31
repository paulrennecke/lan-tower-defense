import { CLASSES, CLASS_BY_ID } from '../../../shared/data/classes';
import { MAX_PLAYERS, type LobbyPlayer, type ServerMsg } from '../../../shared/protocol';
import { CLASS_ICONS, TOWER_ICONS, damageTableHtml, esc, hex } from './format';
import { MAPS, type MapDef } from '../../../shared/maps';

/** Small top-down preview of a map (like the WC3 minimap). */
export function drawMapPreview(cv: HTMLCanvasElement, def: MapDef) {
  const ctx = cv.getContext('2d')!;
  const s = Math.min(cv.width / def.w, cv.height / def.h);
  ctx.fillStyle = '#1b2430';
  ctx.fillRect(0, 0, cv.width, cv.height);
  const ox = (cv.width - def.w * s) / 2, oy = (cv.height - def.h * s) / 2;
  for (let y = 0; y < def.h; y++) {
    for (let x = 0; x < def.w; x++) {
      const ch = def.grid[y][x];
      ctx.fillStyle = ch === '#' ? '#2b3644' : ch === '~' ? '#3f78a8' : ch === '.' ? '#cfe3f1' : ch === 'E' ? '#ffffff' : '#5f9fae';
      ctx.fillRect(ox + x * s, oy + y * s, s + 0.4, s + 0.4);
    }
  }
  ctx.fillStyle = '#c040ff';
  for (const sp of def.spawns) { ctx.beginPath(); ctx.arc(ox + sp.x * s, oy + (sp.y + 0.5) * s, 3, 0, Math.PI * 2); ctx.fill(); }
}

export interface LobbyActions {
  setName(name: string): void;
  setClass(id: string): void;
  ready(r: boolean): void;
  start(): void;
  chat(text: string): void;
  load(id: string): void;
  deleteSave(id: string): void;
  setMap(id: string): void;
}

type LobbyMsg = Extract<ServerMsg, { t: 'lobby' }>;

export class LobbyUI {
  readonly el: HTMLElement;
  private selectedClass: string | null = null;
  private me: LobbyPlayer | undefined;

  constructor(root: HTMLElement, private actions: LobbyActions, initialName: string) {
    this.el = document.createElement('div');
    this.el.id = 'lobby';
    this.el.innerHTML = `
      <h1>❄ Wintermaul TD ❄</h1>
      <div class="subtitle">Kooperatives Maze-Tower-Defense im Stil der Warcraft-III-Karte Wintermaul – bis zu ${MAX_PLAYERS} Spieler, 40 Wellen, danach Endlos-Modus</div>
      <div class="lobby-grid">
        <div>
          <div class="panel">
            <h2 style="margin-top:0">🗺 Karte <small class="muted map-hint"></small></h2>
            <div class="map-cards">${MAPS.map((m) => `
              <div class="map-card" data-map="${m.id}" title="${esc(m.desc)}">
                <canvas width="150" height="150"></canvas>
                <b>${esc(m.name)}</b>
                <div class="muted" style="font-size:12px">${esc(m.desc)}</div>
              </div>`).join('')}
            </div>
          </div>
          <div class="panel" style="margin-top:16px">
            <h2 style="margin-top:0">Wähle deine Klasse</h2>
            <div class="class-cards">${CLASSES.map((c) => `
              <div class="class-card" data-class="${c.id}" style="border-left: 5px solid ${hex(c.color)}">
                <h3>${CLASS_ICONS[c.id]} ${esc(c.name)}</h3>
                <p>${esc(c.desc)}</p>
                <div class="icons">${c.towers.map((t) => TOWER_ICONS[t.shape]).join('')}</div>
              </div>`).join('')}
            </div>
            <div class="class-detail"></div>
          </div>
          <div class="panel help" style="margin-top:16px">
            <h2 style="margin-top:0">So wird gespielt</h2>
            <ul>
              <li>Die Gegner kommen oben aus bis zu <b>vier Portalen</b> und laufen durch die verschneiten Spuren zum <b>Tor</b> im Süden. Jeder Spieler verteidigt farbig markierte <b>Bauzonen</b> einer Spur.</li>
              <li><b>Es gibt keinen festen Weg:</b> Die Gegner nehmen immer den kürzesten Weg um eure Türme herum. Baut <b>Labyrinthe</b> (Mazes) mit billigen <b>Mauerblöcken</b> (Taste 1, 5 Gold), damit sie lange unter Beschuss laufen. Die rote Linie zeigt den aktuellen Weg.</li>
              <li>Den Weg <b>komplett blockieren</b> geht nicht – es muss immer ein Durchgang bleiben. <b>Flieger</b> ignorieren das Labyrinth und fliegen direkt zum Tor.</li>
              <li>Kills bringen den Verteidigern der Spur Gold. Zu jeder Welle gibt es Einkommen und <b>Holz</b> für Forschung &amp; Ultimate-Türme.</li>
              <li>Durchgelassene Gegner kosten gemeinsame Leben. Bosse kosten viele Leben!</li>
              <li>Achtung: <b>Luft</b>-Wellen, <b>unsichtbare</b> Gegner (brauchen Erkennung) und <b>Magieimmune</b> (kein Magieschaden).</li>
            </ul>
            <h3>Steuerung</h3>
            <ul>
              <li><b>1</b> Mauerblock · <b>2–7</b> Turm wählen · <b>Linksklick</b> bauen (<b>Shift</b> = mehrere) · <b>Rechtsklick/Esc</b> abbrechen</li>
              <li>Turm anklicken: <b>U</b> aufwerten · <b>V</b> verkaufen · <b>F</b> Forschung · <b>N</b> bereit für nächste Welle</li>
              <li>Kamera: <b>Pfeiltasten</b>, Bildschirmrand, <b>rechte/mittlere Maustaste</b> ziehen, <b>Mausrad</b> zoomen, <b>Leertaste</b> = eigener Abschnitt</li>
              <li><b>Alt+Klick</b> Ping für alle · <b>Enter</b> Chat · <b>Tab</b> Punktestand</li>
              <li><b>P</b> Pause · <b>💾</b> Spiel speichern · Spielstände lädt der Host hier in der Lobby</li>
            </ul>
            <h3>Schadenstabelle</h3>
            ${damageTableHtml()}
          </div>
        </div>
        <div>
          <div class="panel">
            <h2 style="margin-top:0">Spieler <span class="count"></span></h2>
            <div class="row"><input class="name" maxlength="20" placeholder="Dein Name" style="flex:1"><button class="rename">Ändern</button></div>
            <ul class="player-list"></ul>
            <div class="row">
              <button class="ready primary" style="flex:1">Bereit</button>
              <button class="start primary hidden" style="flex:1">Spiel starten</button>
            </div>
            <div class="info muted" style="margin-top:6px;font-size:13px"></div>
            <div class="muted" style="margin-top:6px;font-size:13px">🏆 Rekord: Welle <span class="hs">0</span></div>
          </div>
          <div class="panel saves-panel" style="margin-top:16px">
            <h3 style="margin-top:0">💾 Spielstände</h3>
            <ul class="save-list"></ul>
          </div>
          <div class="panel" style="margin-top:16px">
            <h3 style="margin-top:0">Chat</h3>
            <div class="chat-log"></div>
            <input class="chat-in" placeholder="Nachricht… (Enter)" style="width:100%" maxlength="200">
          </div>
          <div class="panel" style="margin-top:16px;font-size:13px">
            <b class="gold">Mitspieler einladen:</b> Andere Rechner im selben Netzwerk öffnen
            <div style="font-size:16px;margin:4px 0"><code>${esc(location.host)}</code></div>
            <span class="muted">(Statt "localhost" die LAN-IP verwenden, die der Server beim Start anzeigt.)</span>
          </div>
        </div>
      </div>`;
    root.appendChild(this.el);

    const nameIn = this.q<HTMLInputElement>('.name');
    nameIn.value = initialName;
    const rename = () => { const n = nameIn.value.trim(); if (n) actions.setName(n); };
    this.q('.rename').onclick = rename;
    nameIn.onkeydown = (e) => { if (e.key === 'Enter') rename(); };
    this.el.querySelectorAll<HTMLElement>('.class-card').forEach((card) => {
      card.onclick = () => { actions.setClass(card.dataset.class!); this.showClass(card.dataset.class!); };
    });
    this.q('.ready').onclick = () => actions.ready(!this.me?.ready);
    this.q('.start').onclick = () => actions.start();
    const chatIn = this.q<HTMLInputElement>('.chat-in');
    chatIn.onkeydown = (e) => {
      if (e.key === 'Enter' && chatIn.value.trim()) { actions.chat(chatIn.value.trim()); chatIn.value = ''; }
    };
    this.showClass(CLASSES[0].id, false);
    this.el.querySelectorAll<HTMLElement>('.map-card').forEach((card) => {
      drawMapPreview(card.querySelector('canvas')!, MAPS.find((m) => m.id === card.dataset.map)!);
      card.onclick = () => { if (this.isHost) actions.setMap(card.dataset.map!); };
    });
  }

  private isHost = false;

  private q<T extends HTMLElement = HTMLElement>(sel: string): T { return this.el.querySelector(sel) as T; }

  private showClass(id: string, select = true) {
    const c = CLASS_BY_ID[id];
    if (select) this.selectedClass = id;
    this.el.querySelectorAll<HTMLElement>('.class-card').forEach((card) => card.classList.toggle('selected', card.dataset.class === this.selectedClass));
    this.q('.class-detail').innerHTML = c.towers.map((t) => `
      <div class="tower-line"><span class="ico">${TOWER_ICONS[t.shape]}</span>
        <div><b>${esc(t.name)}</b> <span class="muted">${t.cost} Gold${t.lumber ? ` + ${t.lumber} Holz` : ''}${t.requires ? ' · Forschung nötig' : ''}</span><br>${esc(t.desc)}</div>
      </div>`).join('');
  }

  update(msg: LobbyMsg, you: string) {
    this.me = msg.players.find((p) => p.id === you);
    const active = msg.players.filter((p) => !p.spectator);
    this.q('.count').textContent = `(${active.length}/${MAX_PLAYERS})`;
    this.q('.hs').textContent = String(msg.highscore);
    if (this.me?.classId && this.me.classId !== this.selectedClass) this.showClass(this.me.classId);
    this.q('.player-list').innerHTML = msg.players.map((p) => `
      <li style="opacity:${p.connected ? 1 : 0.45}">
        <span class="dot" style="background:${hex(p.color)}"></span>
        <span>${esc(p.name)}${p.id === msg.hostId ? ' 👑' : ''}${p.id === you ? ' <span class="muted">(du)</span>' : ''}</span>
        <span class="cls">${p.spectator ? 'Zuschauer' : p.classId ? CLASS_ICONS[p.classId] + ' ' + esc(CLASS_BY_ID[p.classId].name) : '—'}</span>
        <span class="rdy">${p.spectator ? '' : p.ready || p.id === msg.hostId ? '<span class="good">✔ bereit</span>' : '<span class="muted">wartet</span>'}</span>
      </li>`).join('');
    const isHost = msg.hostId === you;
    this.isHost = isHost;
    this.el.querySelectorAll<HTMLElement>('.map-card').forEach((card) => {
      card.classList.toggle('selected', card.dataset.map === msg.map);
      card.classList.toggle('clickable', isHost);
    });
    this.q('.map-hint').textContent = isHost ? '– wähle die Karte' : '– der Host wählt die Karte';
    const readyBtn = this.q<HTMLButtonElement>('.ready');
    readyBtn.classList.toggle('hidden', isHost || !!this.me?.spectator);
    readyBtn.textContent = this.me?.ready ? 'Nicht bereit' : 'Bereit';
    readyBtn.disabled = !this.me?.classId;
    const startBtn = this.q<HTMLButtonElement>('.start');
    startBtn.classList.toggle('hidden', !isHost);
    const waiting = active.filter((p) => p.connected && (!p.classId || (!p.ready && p.id !== msg.hostId)));
    startBtn.disabled = waiting.length > 0;
    let info = '';
    if (this.me?.spectator) info = msg.phase === 'lobby' ? 'Das Spiel ist voll – du schaust zu.' : 'Ein Spiel läuft – du schaust zu und kannst in der nächsten Runde mitspielen.';
    else if (!this.me?.classId) info = 'Wähle eine Klasse, um bereit zu sein.';
    else if (isHost) info = waiting.length ? `Warte auf: ${waiting.map((p) => esc(p.name)).join(', ')}` : 'Alle bereit – du kannst starten!';
    else info = 'Der Host 👑 startet das Spiel.';
    this.q('.info').innerHTML = info;
    this.renderSaves(msg, isHost);
  }

  private renderSaves(msg: LobbyMsg, isHost: boolean) {
    const list = this.q('.save-list');
    if (!msg.saves.length) {
      list.innerHTML = '<li class="muted">Noch keine Spielstände. Im Spiel mit 💾 speichern.</li>';
      return;
    }
    list.innerHTML = msg.saves.map((s) => `
      <li data-id="${esc(s.id)}">
        <div style="flex:1">
          <b>${esc(s.name)}</b><br>
          <span class="muted" style="font-size:12px">Welle ${s.wave} · ❤ ${s.lives} · ${new Date(s.date).toLocaleString()}<br>
          ${s.players.map((p) => `${CLASS_ICONS[p.classId] ?? ''} ${esc(p.name)}`).join(', ')}${s.map ? ` · 🗺 ${esc(MAPS.find((m) => m.id === s.map)?.name ?? s.map)}` : ''}</span>
        </div>
        ${isHost ? '<button class="load primary">Laden</button><button class="del" title="Löschen">🗑</button>' : ''}
      </li>`).join('') + (isHost ? '' : '<li class="muted" style="font-size:12px">Nur der Host 👑 kann Spielstände laden.</li>');
    list.querySelectorAll<HTMLElement>('li[data-id]').forEach((li) => {
      const id = li.dataset.id!;
      const name = msg.saves.find((s) => s.id === id)?.name ?? id;
      li.querySelector<HTMLButtonElement>('.load')?.addEventListener('click', () => this.actions.load(id));
      const del = li.querySelector<HTMLButtonElement>('.del');
      del?.addEventListener('click', () => {
        // Two-step confirmation: the first click arms the button.
        if (del.dataset.armed) { this.actions.deleteSave(id); return; }
        del.dataset.armed = '1';
        del.textContent = 'Löschen?';
        del.title = `„${name}“ endgültig löschen`;
        setTimeout(() => { if (del.isConnected) { delete del.dataset.armed; del.textContent = '🗑'; } }, 3000);
      });
    });
  }

  addChat(name: string, color: number, text: string) {
    const log = this.q('.chat-log');
    const div = document.createElement('div');
    div.innerHTML = `<b style="color:${hex(color)}">${esc(name)}:</b> ${esc(text)}`;
    log.appendChild(div);
    while (log.children.length > 100) log.firstChild!.remove();
    log.scrollTop = log.scrollHeight;
  }

  show(v: boolean) { this.el.classList.toggle('hidden', !v); }
}
