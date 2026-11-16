export type TargetMode = 'first' | 'last' | 'strong' | 'weak' | 'close';
export const TARGET_MODE_NAMES: Record<TargetMode, string> = {
  first: 'Vorderster', last: 'Hinterster', strong: 'Stärkster', weak: 'Schwächster', close: 'Nächster',
};

export const PLAYER_COLORS = [
  0xe53935, 0x1e88e5, 0x43a047, 0xfdd835, 0x8e24aa, 0xfb8c00, 0x00acc1, 0xd81b60,
  0x7cb342, 0x5e35b1, 0x6d4c41, 0xffffff, 0x3949ab, 0x00897b, 0xc0ca33, 0x546e7a,
];

export const MAX_PLAYERS = 16;

export type GamePhase = 'lobby' | 'playing' | 'gameover';

export interface LobbyPlayer {
  id: string;
  name: string;
  color: number;
  classId: string | null;
  ready: boolean;
  connected: boolean;
  spectator: boolean;
  /** Where the player would like to play (0..1 on the lobby map preview), null = no wish. */
  pos: { x: number; y: number } | null;
}

export interface TowerInfo {
  id: number;
  owner: string;
  def: string;
  level: number;
  cx: number;
  cy: number;
  mode: TargetMode;
  kills: number;
  damage: number;
  invested: number;
}

export interface PlayerStats {
  id: string;
  gold: number;
  lumber: number;
  kills: number;
  damage: number;
  goldEarned: number;
  ready: boolean;
  research: Record<string, number>;
}

/** [id, enemyTypeIndex, x, y, hp, maxHp, flags] */
export type EnemySnap = [number, number, number, number, number, number, number];
export const EF_SLOW = 1, EF_STUN = 2, EF_POISON = 4, EF_INVIS = 8, EF_REVEALED = 16, EF_ARMORRED = 32;

export type Fx =
  | ['s', number, number, number]            // shot: towerId, enemyId, flightTime
  | ['c', number, number[]]                  // chain lightning: towerId, enemyIds
  | ['x', number, number, number, string]    // explosion x, y, radius, kind
  | ['m', number, number, number]            // mine placed: id, x, y
  | ['mx', number]                           // mine removed
  | ['k', number, number, number, [string, number][]] // kill: x, y, total gold, gold per player
  | ['l', number]                            // leak: enemyId
  | ['h', number]                            // heal: enemyId
  | ['a', number];                           // tower attack anim (no projectile): towerId

export interface FullState {
  you: string;
  map: string;
  /** Lanes (spawns) that receive creeps. */
  lanes: number[];
  players: (LobbyPlayer & PlayerStats)[];
  towers: TowerInfo[];
  mines: [number, number, number][];
  wave: number;
  lives: number;
  highscore: number;
}

export interface Snapshot {
  t: 'snap';
  time: number;
  wave: number;
  timer: number;        // seconds until next wave, -1 while spawning
  lives: number;
  /** Name of the player who paused the game, null while running. */
  paused: string | null;
  enemies: EnemySnap[];
  players: PlayerStats[];
  fx: Fx[];
}

export interface SaveInfo {
  id: string;
  name: string;
  date: string;
  wave: number;
  lives: number;
  players: { name: string; classId: string }[];
  map?: string;
}

export interface PlayerEndStats {
  id: string;
  name: string;
  color: number;
  classId: string;
  kills: number;
  damage: number;
  towersBuilt: number;
  upgrades: number;
  goldEarned: number;
  goldSent: number;
}

export interface GameSummary {
  map: string;
  players: number;
  /** Simulated play time in seconds. */
  time: number;
  livesLeft: number;
  livesLost: number;
  creepsKilled: number;
  bossesKilled: number;
  totalDamage: number;
  towersBuilt: number;
  towersAlive: number;
  /** Tower that dealt the most damage. */
  topTower: { def: string; owner: string; kills: number; damage: number; level: number } | null;
  /** Creep types that were killed / leaked most (id, count), top entries. */
  topKilled: [string, number][];
  topLeaked: [string, number][];
}

export type ClientMsg =
  /** `owner` is a permanent per-browser key – online, save games belong to it. */
  | { t: 'hello'; name: string; token?: string; owner?: string }
  | { t: 'setClass'; classId: string }
  | { t: 'setName'; name: string }
  | { t: 'lobbyReady'; ready: boolean }
  | { t: 'start' }
  | { t: 'setMap'; id: string }
  | { t: 'setPos'; x: number; y: number }
  | { t: 'kick'; id: string }
  | { t: 'gift'; to: string; amount: number }
  | { t: 'joinGame'; classId: string }
  | { t: 'chat'; text: string }
  | { t: 'build'; def: string; cx: number; cy: number }
  | { t: 'upgrade'; id: number }
  | { t: 'sell'; id: number }
  | { t: 'mode'; id: number; mode: TargetMode }
  | { t: 'research'; id: string }
  | { t: 'callWave'; ready: boolean }
  | { t: 'ping'; x: number; y: number }
  | { t: 'pause'; paused: boolean }
  | { t: 'save'; name: string }
  | { t: 'load'; id: string }
  | { t: 'deleteSave'; id: string }
  | { t: 'backToLobby' }
  /** Host ends the running game for everybody (optionally saving it first). */
  | { t: 'quitGame'; save?: string };

export type ServerMsg =
  | { t: 'welcome'; you: string; token: string }
  | { t: 'lobby'; players: LobbyPlayer[]; hostId: string | null; phase: GamePhase; highscore: number; saves: SaveInfo[]; map: string; room?: RoomInfo | null }
  | { t: 'game'; state: FullState }
  | Snapshot
  | { t: 'tower'; tower: TowerInfo }
  | { t: 'towerGone'; id: number }
  | { t: 'chat'; from: string | null; name: string; color: number; text: string }
  | { t: 'ping'; x: number; y: number; color: number }
  | { t: 'event'; kind: 'wave' | 'boss' | 'victory' | 'info' | 'warn'; text: string }
  | { t: 'kicked' }
  /** A player joined the running game. */
  | { t: 'joined'; player: LobbyPlayer & PlayerStats }
  | { t: 'gameOver'; wave: number; victory: boolean; highscore: number; newRecord: boolean; stats: PlayerEndStats[]; summary: GameSummary }
  | { t: 'error'; msg: string }
  /** Online: the room code does not exist (any more). */
  | { t: 'noRoom' };

/** Online room as shown in the room list (`GET /api/rooms`) and the lobby. */
export interface RoomInfo {
  code: string;
  name: string;
  public: boolean;
  phase: GamePhase;
  map: string;
  players: number;
  spectators: number;
  wave: number;
}

/** `GET /api/config` */
export interface ServerConfig {
  mode: 'lan' | 'online';
  version?: string;
}

export const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LEN = 4;
export const isRoomCode = (s: string) => new RegExp(`^[${ROOM_CODE_CHARS}]{${ROOM_CODE_LEN}}$`).test(s);
