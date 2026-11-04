import './style.css';
import { isRoomCode, type ServerConfig, type ServerMsg } from '../../shared/protocol';
import { Net } from './net';
import { GameView } from './ui/game';
import { LobbyUI } from './ui/lobby';
import { RoomsUI } from './ui/rooms';

const app = document.getElementById('app')!;
const randomName = () => ['Arthas', 'Thrall', 'Jaina', 'Illidan', 'Sylvanas', 'Uther', 'Rexxar', 'Tyrande', 'Grom', 'Kael', 'Medivh', 'Gazlowe'][Math.floor(Math.random() * 12)] + Math.floor(Math.random() * 100);
let name = localStorage.getItem('td-name') || randomName();
const saveName = (n: string) => { name = n; localStorage.setItem('td-name', n); };

/** Permanent key of this browser – online, save games belong to it. */
function ownerKey(): string {
  let key = localStorage.getItem('td-owner');
  if (!key) {
    // crypto.randomUUID needs a secure context, which plain-http LAN addresses are not.
    key = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem('td-owner', key);
  }
  return key;
}

async function loadConfig(): Promise<ServerConfig> {
  try {
    const res = await fetch('api/config');
    if (res.ok) return await res.json();
  } catch { /* old/dev server without API */ }
  return { mode: 'lan' };
}

const roomFromHash = () => location.hash.replace(/^#\/?/, '').trim().toUpperCase();
// Switching rooms reloads the page so no state of the old room survives.
window.addEventListener('hashchange', () => location.reload());

async function boot() {
  const config = await loadConfig();
  if (config.mode === 'online') {
    const code = roomFromHash();
    if (!isRoomCode(code)) {
      showRooms(code ? `Ungültiger Raumcode „${code}“.` : '');
      return;
    }
    playRoom(code);
  } else {
    playRoom(null);
  }
}

function showRooms(notice = '') {
  new RoomsUI(app, { setName: saveName, join: (code) => { location.hash = code; } }, name, notice);
}

function playRoom(room: string | null) {
  let you = '';
  let hostId: string | null = null;
  let phase: 'lobby' | 'playing' | 'gameover' = 'lobby';
  const tokenKey = room ? `td-token-${room}` : 'td-token';

  const net = new Net(() => ({ t: 'hello', name, token: sessionStorage.getItem(tokenKey) ?? undefined, owner: ownerKey() }), room);

  const lobby = new LobbyUI(app, {
    setName: (n) => { saveName(n); net.send({ t: 'setName', name: n }); },
    setClass: (classId) => net.send({ t: 'setClass', classId }),
    ready: (ready) => net.send({ t: 'lobbyReady', ready }),
    start: () => net.send({ t: 'start' }),
    chat: (text) => net.send({ t: 'chat', text }),
    load: (id) => net.send({ t: 'load', id }),
    deleteSave: (id) => net.send({ t: 'deleteSave', id }),
    setMap: (id) => net.send({ t: 'setMap', id }),
    setPos: (x, y) => net.send({ t: 'setPos', x, y }),
    kick: (id) => net.send({ t: 'kick', id }),
    leave: room ? () => { net.stop(); sessionStorage.removeItem(tokenKey); location.hash = ''; } : undefined,
  }, name);

  const game = new GameView(app, net);

  const banner = document.createElement('div');
  banner.className = 'disconnected hidden';
  banner.textContent = 'Verbindung zum Server verloren – versuche erneut…';
  document.body.appendChild(banner);
  net.onStatus((ok) => banner.classList.toggle('hidden', ok));

  net.onMessage((msg: ServerMsg) => {
    switch (msg.t) {
      case 'welcome':
        you = msg.you;
        sessionStorage.setItem(tokenKey, msg.token);
        break;
      case 'noRoom':
        net.stop();
        sessionStorage.removeItem(tokenKey);
        banner.remove();
        lobby.el.remove();
        game.show(false);
        history.replaceState(null, '', location.pathname + location.search);
        showRooms(`Den Raum ${room} gibt es nicht (mehr).`);
        break;
      case 'lobby':
        hostId = msg.hostId;
        phase = msg.phase;
        lobby.update(msg, you);
        game.setHost(hostId);
        game.updateLobby(msg.players, you);
        if (phase === 'lobby') { game.show(false); lobby.show(true); }
        break;
      case 'kicked': {
        // Stop reconnecting and drop the session token so a reload joins as a new player.
        net.stop();
        sessionStorage.removeItem(tokenKey);
        const box = document.createElement('div');
        box.className = 'overlay';
        box.innerHTML = '<div class="panel" style="text-align:center"><h2 style="margin-top:0">Du wurdest vom Host entfernt</h2><button class="primary">Neu verbinden</button></div>';
        box.querySelector('button')!.addEventListener('click', () => location.reload());
        document.body.appendChild(box);
        break;
      }
      case 'game':
        lobby.show(false);
        game.load(msg.state, hostId);
        break;
      case 'chat':
        lobby.addChat(msg.name, msg.color, msg.text);
        game.handle(msg);
        break;
      case 'error':
        if (phase === 'lobby') alert(msg.msg);
        else game.handle(msg);
        break;
      default:
        game.handle(msg);
    }
  });

  net.connect();

  // Debug handle for automated browser tests.
  (window as any).__td = { game, net };
}

void boot();
