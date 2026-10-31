import './style.css';
import type { ServerMsg } from '../../shared/protocol';
import { Net } from './net';
import { GameView } from './ui/game';
import { LobbyUI } from './ui/lobby';

const app = document.getElementById('app')!;
const randomName = () => ['Arthas', 'Thrall', 'Jaina', 'Illidan', 'Sylvanas', 'Uther', 'Rexxar', 'Tyrande', 'Grom', 'Kael', 'Medivh', 'Gazlowe'][Math.floor(Math.random() * 12)] + Math.floor(Math.random() * 100);
let name = localStorage.getItem('td-name') || randomName();
let you = '';
let hostId: string | null = null;
let phase: 'lobby' | 'playing' | 'gameover' = 'lobby';

const net = new Net(() => ({ t: 'hello', name, token: sessionStorage.getItem('td-token') ?? undefined }));

const lobby = new LobbyUI(app, {
  setName: (n) => { name = n; localStorage.setItem('td-name', n); net.send({ t: 'setName', name: n }); },
  setClass: (classId) => net.send({ t: 'setClass', classId }),
  ready: (ready) => net.send({ t: 'lobbyReady', ready }),
  start: () => net.send({ t: 'start' }),
  chat: (text) => net.send({ t: 'chat', text }),
  load: (id) => net.send({ t: 'load', id }),
  deleteSave: (id) => net.send({ t: 'deleteSave', id }),
  setMap: (id) => net.send({ t: 'setMap', id }),
  setOptions: (options) => net.send({ t: 'setOptions', options }),
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
      sessionStorage.setItem('td-token', msg.token);
      break;
    case 'lobby':
      hostId = msg.hostId;
      phase = msg.phase;
      lobby.update(msg, you);
      game.setHost(hostId);
      game.updateLobby(msg.players);
      if (phase === 'lobby') { game.show(false); lobby.show(true); }
      break;
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
