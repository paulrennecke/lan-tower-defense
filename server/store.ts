import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { SaveInfo } from '../shared/protocol';
import type { GameSave } from './game';

export interface SaveFile { info: SaveInfo; game: GameSave }

/** Record wave per map, shared by all rooms of the server. */
export class HighscoreStore {
  private maps: Record<string, number>;

  constructor(private file: string) {
    try {
      const data = JSON.parse(readFileSync(file, 'utf8'));
      this.maps = data && typeof data.maps === 'object' ? data.maps : {};
    } catch { this.maps = {}; }
  }

  of(map: string) { return this.maps[map] ?? 0; }

  /** Stores the record if the wave beats it; returns true for a new record. */
  submit(map: string, wave: number): boolean {
    if (wave <= this.of(map)) return false;
    this.maps[map] = wave;
    try { writeFileSync(this.file, JSON.stringify({ maps: this.maps, date: new Date().toISOString() })); } catch { /* ignore */ }
    return true;
  }
}

const saveId = (name: string) => name.normalize('NFKD').replace(/[^\w\- ]/g, '').trim().replace(/\s+/g, '_').slice(0, 40) || 'spielstand';

/**
 * Save games. In LAN mode all saves live in one directory; online every browser (owner key) gets its own
 * sub directory so players only see and load their own saves.
 */
export class SaveStore {
  private cache = new Map<string, SaveInfo[]>();

  constructor(private root: string, private perOwner: boolean, private maxPerOwner = Infinity) {}

  /** Directory for an owner key, null if the owner may not use saves (online without key). */
  dir(owner: string | null): string | null {
    if (!this.perOwner) return this.root;
    if (!owner) return null;
    return join(this.root, createHash('sha256').update(owner).digest('hex').slice(0, 24));
  }

  list(owner: string | null): SaveInfo[] {
    const dir = this.dir(owner);
    if (!dir) return [];
    let list = this.cache.get(dir);
    if (!list) {
      list = readSaves(dir);
      this.cache.set(dir, list);
    }
    return list;
  }

  path(owner: string | null, id: string): string | null {
    const dir = this.dir(owner);
    return dir && this.list(owner).some((s) => s.id === id) ? join(dir, id + '.json') : null;
  }

  read(owner: string | null, id: string): SaveFile | null {
    const file = this.path(owner, id);
    return file ? JSON.parse(readFileSync(file, 'utf8')) : null;
  }

  /** Writes a save game, returns its id. */
  write(owner: string | null, info: Omit<SaveInfo, 'id'>, game: GameSave): string {
    const dir = this.dir(owner);
    if (!dir) throw new Error('Spielstände sind in diesem Browser nicht verfügbar.');
    const id = saveId(info.name);
    const existing = this.list(owner);
    if (existing.length >= this.maxPerOwner && !existing.some((s) => s.id === id)) {
      throw new Error(`Maximal ${this.maxPerOwner} Spielstände – bitte alte in der Lobby löschen.`);
    }
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, id + '.json'), JSON.stringify({ info: { ...info, id }, game } satisfies SaveFile));
    this.cache.delete(dir);
    return id;
  }

  remove(owner: string | null, id: string): boolean {
    const file = this.path(owner, id);
    if (!file) return false;
    rmSync(file, { force: true });
    this.cache.delete(this.dir(owner)!);
    return true;
  }
}

function readSaves(dir: string): SaveInfo[] {
  if (!existsSync(dir)) return [];
  const list: SaveInfo[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const data = JSON.parse(readFileSync(join(dir, f), 'utf8')) as SaveFile;
      if (!data?.info?.date || !data.game) continue;
      list.push({ ...data.info, id: f.slice(0, -5) });
    } catch { /* skip broken files */ }
  }
  return list.sort((a, b) => b.date.localeCompare(a.date));
}
