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
  leaks: number;
  ready: boolean;
  research: Record<string, number>;
}

/** [id, enemyTypeIndex, pathDistance, hp, maxHp, flags] */
export type EnemySnap = [number, number, number, number, number, number];
export const EF_SLOW = 1, EF_STUN = 2, EF_POISON = 4, EF_INVIS = 8, EF_REVEALED = 16, EF_ARMORRED = 32;

export type Fx =
  | ['s', number, number, number]            // shot: towerId, enemyId, flightTime
  | ['c', number, number[]]                  // chain lightning: towerId, enemyIds
  | ['x', number, number, number, string]    // explosion x, y, radius, kind
  | ['m', number, number, number]            // mine placed: id, x, y
  | ['mx', number]                           // mine removed
  | ['k', number, number, number]            // kill: x, y, gold
  | ['l', number]                            // leak: enemyId
  | ['h', number]                            // heal: enemyId
  | ['a', number];                           // tower attack anim (no projectile): towerId

export interface FullState {
  you: string;
  players: (LobbyPlayer & PlayerStats)[];
  sectionOwners: string[];
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
  enemies: EnemySnap[];
  players: PlayerStats[];
  fx: Fx[];
}

export type ClientMsg =
  | { t: 'hello'; name: string; token?: string }
  | { t: 'setClass'; classId: string }
  | { t: 'setName'; name: string }
  | { t: 'lobbyReady'; ready: boolean }
  | { t: 'start' }
  | { t: 'chat'; text: string }
  | { t: 'build'; def: string; cx: number; cy: number }
  | { t: 'upgrade'; id: number }
  | { t: 'sell'; id: number }
  | { t: 'mode'; id: number; mode: TargetMode }
  | { t: 'research'; id: string }
  | { t: 'callWave'; ready: boolean }
  | { t: 'ping'; x: number; y: number }
  | { t: 'backToLobby' };

export type ServerMsg =
  | { t: 'welcome'; you: string; token: string }
  | { t: 'lobby'; players: LobbyPlayer[]; hostId: string | null; phase: GamePhase; highscore: number }
  | { t: 'game'; state: FullState }
  | Snapshot
  | { t: 'tower'; tower: TowerInfo }
  | { t: 'towerGone'; id: number }
  | { t: 'chat'; from: string | null; name: string; color: number; text: string }
  | { t: 'ping'; x: number; y: number; color: number }
  | { t: 'event'; kind: 'wave' | 'boss' | 'victory' | 'info' | 'warn'; text: string }
  | { t: 'gameOver'; wave: number; victory: boolean; highscore: number; stats: { id: string; name: string; color: number; kills: number; damage: number; leaks: number }[] }
  | { t: 'error'; msg: string };
