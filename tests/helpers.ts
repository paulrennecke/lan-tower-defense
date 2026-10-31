import { spawn, type ChildProcess } from 'node:child_process';
import WebSocket from 'ws';
import type { ClientMsg, ServerMsg } from '../shared/protocol';

export class Client {
  ws: WebSocket;
  msgs: ServerMsg[] = [];
  constructor(port: number) { this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws`); this.ws.on('message', (d) => this.msgs.push(JSON.parse(String(d)))); }
  open() { return new Promise<void>((r) => this.ws.once('open', () => r())); }
  send(m: ClientMsg) { this.ws.send(JSON.stringify(m)); }
  async wait<T extends ServerMsg['t']>(t: T, pred: (m: Extract<ServerMsg, { t: T }>) => boolean = () => true, ms = 5000): Promise<Extract<ServerMsg, { t: T }>> {
    const start = Date.now();
    while (Date.now() - start < ms) {
      const found = this.msgs.find((m) => m.t === t && pred(m as Extract<ServerMsg, { t: T }>));
      if (found) return found as Extract<ServerMsg, { t: T }>;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('timeout waiting for ' + t);
  }
  close() { this.ws.close(); }
}

export const randomPort = () => 3900 + Math.floor(Math.random() * 1000);

export async function startServer(port: number, env: Record<string, string> = {}): Promise<ChildProcess> {
  const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { env: { ...process.env, ...env, PORT: String(port) }, stdio: 'pipe' });
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 15000);
    server.stdout!.on('data', (d) => { if (String(d).includes('localhost')) { clearTimeout(t); resolve(); } });
  });
  return server;
}
