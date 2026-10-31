import { CLASSES, CLASS_BY_ID } from '../../../shared/data/classes';
import { MAX_PLAYERS, type LobbyPlayer, type ServerMsg } from '../../../shared/protocol';
import { CLASS_ICONS, TOWER_ICONS, damageTableHtml, esc, hex } from './format';

export interface LobbyActions {
  setName(name: string): void;
  setClass(id: string): void;
  ready(r: boolean): void;
  start(): void;
  chat(text: string): void;
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
      <h1>⚔ Schlacht um Azeroth ⚔</h1>
      <div class="subtitle">Kooperatives LAN Tower Defense für bis zu ${MAX_PLAYERS} Spieler – 40 Wellen, danach Endlos-Modus</div>
      <div class="lobby-grid">
        <div>
          <div class="panel">
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
              <li>Alle Spieler verteidigen <b>gemeinsam</b> einen Pfad. Jeder hat eigene, farbig markierte <b>Bauabschnitte</b>.</li>
              <li>Jeder Kill bringt <b>allen</b> Spielern Gold. Zu jeder Welle gibt es Einkommen und <b>Holz</b> für Forschung &amp; Ultimate-Türme.</li>
              <li>Durchgelassene Gegner kosten gemeinsame Leben. Bosse kosten viele Leben!</li>
              <li>Achtung: <b>Luft</b>-Wellen, <b>unsichtbare</b> Gegner (brauchen Erkennung) und <b>Magieimmune</b> (kein Magieschaden).</li>
            </ul>
            <h3>Steuerung</h3>
            <ul>
              <li><b>1–6</b> Turm wählen · <b>Linksklick</b> bauen (<b>Shift</b> = mehrere) · <b>Rechtsklick/Esc</b> abbrechen</li>
              <li>Turm anklicken: <b>U</b> aufwerten · <b>V</b> verkaufen · <b>F</b> Forschung · <b>N</b> bereit für nächste Welle</li>
              <li>Kamera: <b>Pfeiltasten</b>, Bildschirmrand, <b>rechte/mittlere Maustaste</b> ziehen, <b>Mausrad</b> zoomen, <b>Leertaste</b> = eigener Abschnitt</li>
              <li><b>Alt+Klick</b> Ping für alle · <b>Enter</b> Chat · <b>Tab</b> Punktestand</li>
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
  }

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
