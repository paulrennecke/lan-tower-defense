import { MAX_PLAYERS, isRoomCode, type RoomInfo } from '../../../shared/protocol';
import { MAP_BY_ID } from '../../../shared/maps';
import { esc } from './format';
import { bindVersionLink, githubLinkHtml, versionLinkHtml } from './about';
import { rulesHtml } from './rules';

export interface RoomsActions {
  setName(name: string): void;
  /** Enter a room by code. */
  join(code: string): void;
}

const phaseText = (r: RoomInfo) => (r.phase === 'lobby' ? 'Lobby' : r.phase === 'playing' ? `Spiel läuft · Welle ${r.wave}` : 'Spiel beendet');

/** Start page in online mode: open rooms, create a room, join by code – and the LAN download. */
export class RoomsUI {
  readonly el: HTMLElement;
  private timer = 0;

  constructor(root: HTMLElement, private actions: RoomsActions, name: string, notice = '') {
    this.el = document.createElement('div');
    this.el.id = 'rooms';
    this.el.innerHTML = `
      <h1>❄ LAN TD ❄</h1>
      <div class="subtitle">Kooperatives Maze-Tower-Defense im Stil von Wintermaul TD – online mit Freunden oder als LAN-Runde<br>${versionLinkHtml()}</div>
      <div class="notice panel ${notice ? '' : 'hidden'}">${esc(notice)}</div>
      <div class="rooms-grid">
        <div class="panel">
          <h2 style="margin-top:0">🌐 Online spielen</h2>
          <label class="muted">Dein Name</label>
          <div class="row"><input class="name" maxlength="20" style="flex:1"></div>
          <h3>Neuen Raum erstellen</h3>
          <div class="row">
            <input class="room-name" maxlength="30" placeholder="Raumname (optional)" style="flex:1">
          </div>
          <div class="row" style="margin-top:6px">
            <label><input type="checkbox" class="public" checked> In der Raumliste anzeigen</label>
            <button class="create primary" style="margin-left:auto">Raum erstellen</button>
          </div>
          <div class="muted" style="font-size:12px;margin-top:4px">Private Räume erreicht man nur über den Einladungslink bzw. den Code.</div>
          <h3>Mit Code beitreten</h3>
          <div class="row">
            <input class="code" maxlength="4" placeholder="z. B. K7QD" style="width:120px;text-transform:uppercase;letter-spacing:3px">
            <button class="join primary">Beitreten</button>
          </div>
          <div class="error bad" style="margin-top:8px"></div>
        </div>
        <div class="panel">
          <h2 style="margin-top:0">🏰 Offene Räume</h2>
          <ul class="room-list save-list" style="max-height:420px"></ul>
        </div>
        <div class="panel lan-panel">
          <h2 style="margin-top:0">🖧 Lokale LAN-Runde</h2>
          <p>Ohne Internet im eigenen Netzwerk spielen (z. B. auf einer LAN-Party): Ein Rechner startet den Server, alle anderen
          öffnen die angezeigte Adresse im Browser.</p>
          <ol>
            <li><a href="https://nodejs.org/" target="_blank" rel="noopener">Node.js</a> (22 LTS) auf dem Host-Rechner installieren.</li>
            <li><a class="gold" href="download/lan-td.zip" download><b>⬇ LAN-TD herunterladen</b></a> und entpacken.</li>
            <li>Windows: <code>Start-Server.cmd</code> doppelklicken – Linux/macOS: <code>./start-server.sh</code>.</li>
            <li>Mitspieler öffnen die angezeigte <b>LAN-Adresse</b> (z. B. <code>http://192.168.0.33:3000</code>).</li>
          </ol>
          <p class="muted" style="font-size:13px">Spielstände und Rekorde der LAN-Runde bleiben auf dem Host-Rechner.</p>
        </div>
        <details class="panel rules rules-box">
          <summary><b>📖 Spielregeln</b> <span class="muted">– anklicken zum Aufklappen</span></summary>
          ${rulesHtml()}
        </details>
      </div>
      ${githubLinkHtml()}`;
    root.appendChild(this.el);
    bindVersionLink(this.el);

    const nameIn = this.q<HTMLInputElement>('.name');
    nameIn.value = name;
    nameIn.onchange = () => { const n = nameIn.value.trim(); if (n) actions.setName(n); };
    this.q('.create').onclick = () => void this.create();
    const codeIn = this.q<HTMLInputElement>('.code');
    const join = () => {
      const code = codeIn.value.trim().toUpperCase();
      if (!isRoomCode(code)) { this.error('Der Code besteht aus 4 Zeichen (z. B. K7QD).'); return; }
      this.saveName();
      actions.join(code);
    };
    this.q('.join').onclick = join;
    codeIn.onkeydown = (e) => { if (e.key === 'Enter') join(); };
    void this.refresh();
    this.timer = window.setInterval(() => void this.refresh(), 5000);
  }

  private q<T extends HTMLElement = HTMLElement>(sel: string): T { return this.el.querySelector(sel) as T; }

  private error(msg: string) { this.q('.error').textContent = msg; }

  private saveName() {
    const n = this.q<HTMLInputElement>('.name').value.trim();
    if (n) this.actions.setName(n);
  }

  private async create() {
    this.saveName();
    const btn = this.q<HTMLButtonElement>('.create');
    btn.disabled = true;
    try {
      const res = await fetch('api/rooms', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: this.q<HTMLInputElement>('.room-name').value, public: this.q<HTMLInputElement>('.public').checked }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Fehler');
      this.actions.join(data.code);
    } catch (e) {
      this.error('Raum konnte nicht erstellt werden: ' + (e as Error).message);
    } finally {
      btn.disabled = false;
    }
  }

  private async refresh() {
    let rooms: RoomInfo[];
    try {
      rooms = (await (await fetch('api/rooms')).json()).rooms;
    } catch { return; }
    const list = this.q('.room-list');
    if (!rooms.length) {
      list.innerHTML = '<li class="muted">Gerade ist kein öffentlicher Raum offen – erstelle einen!</li>';
      return;
    }
    list.innerHTML = rooms.map((r) => `
      <li>
        <div style="flex:1">
          <b>${esc(r.name)}</b> <span class="muted">· ${esc(r.code)}</span><br>
          <span class="muted" style="font-size:12px">🗺 ${esc(MAP_BY_ID[r.map]?.name ?? r.map)} · 👥 ${r.players}/${MAX_PLAYERS}${r.spectators ? ` (+${r.spectators} 👁)` : ''} · ${phaseText(r)}</span>
        </div>
        <button class="primary" data-code="${esc(r.code)}">${r.phase === 'lobby' ? 'Beitreten' : 'Zuschauen'}</button>
      </li>`).join('');
    list.querySelectorAll<HTMLButtonElement>('button[data-code]').forEach((b) => {
      b.onclick = () => { this.saveName(); this.actions.join(b.dataset.code!); };
    });
  }

  destroy() {
    clearInterval(this.timer);
    this.el.remove();
  }
}
