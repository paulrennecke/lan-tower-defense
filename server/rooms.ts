import { randomInt } from 'node:crypto';
import { ROOM_CODE_CHARS, ROOM_CODE_LEN, type RoomInfo } from '../shared/protocol';
import { Room } from './room';
import type { HighscoreStore, SaveStore } from './store';

export interface RoomManagerOptions {
  highscores: HighscoreStore;
  saves: SaveStore;
  maxRooms: number;
  /** Rooms without connected players are removed after this time (ms). */
  emptyTtl: number;
  msgRate: number;
}

export const cleanRoomName = (s: unknown) => String(s ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 30);

/** Online rooms, addressed by a short code (td.example.org/#ABCD). */
export class RoomManager {
  private rooms = new Map<string, Room>();

  constructor(private opts: RoomManagerOptions) {}

  get size() { return this.rooms.size; }

  get(code: string): Room | undefined { return this.rooms.get(code.toUpperCase()); }

  /** Creates a room; null if the server is full. */
  create(name: string, isPublic: boolean): Room | null {
    if (this.rooms.size >= this.opts.maxRooms) return null;
    let code: string;
    do {
      code = Array.from({ length: ROOM_CODE_LEN }, () => ROOM_CODE_CHARS[randomInt(ROOM_CODE_CHARS.length)]).join('');
    } while (this.rooms.has(code));
    const room = new Room({
      code, name: cleanRoomName(name) || `Raum ${code}`, isPublic,
      highscores: this.opts.highscores, saves: this.opts.saves, msgRate: this.opts.msgRate,
    });
    this.rooms.set(code, room);
    return room;
  }

  /** Public rooms with at least one connected player – newest activity first. */
  publicList(): RoomInfo[] {
    return [...this.rooms.values()]
      .filter((r) => r.isPublic && r.connectedCount > 0)
      .map((r) => r.info())
      .sort((a, b) => Number(a.phase !== 'lobby') - Number(b.phase !== 'lobby') || b.players - a.players);
  }

  /** Housekeeping: drops disconnected lobby players and abandoned rooms. */
  sweep(now = Date.now()) {
    for (const [code, room] of this.rooms) {
      room.sweep();
      if (room.connectedCount === 0 && now - room.lastActive > this.opts.emptyTtl) {
        room.dispose();
        this.rooms.delete(code);
      }
    }
  }
}
