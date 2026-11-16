// Rolling-deploy front router: listens on the public port and forwards to the running game server instances.
// New rooms and the web client go to the newest ("current") instance, while every request that belongs to an
// existing room (WebSocket, /api/rooms/CODE) goes to the instance that owns the room – so running games are
// never interrupted by a deployment. Old instances are stopped by the deploy script once they are empty.
//
// Usage: ROUTER_STATE=/path/state.json PORT=61235 node --import tsx server/router.ts
// State file: {"current": 61236, "ports": [61236, 61237]} – re-read on change, no restart needed.
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { connect, type Socket } from 'node:net';
import { readFileSync, statSync } from 'node:fs';

const PORT = Number(process.env.PORT ?? 3000);
const STATE_FILE = process.env.ROUTER_STATE ?? 'router.json';
const HOST = '127.0.0.1';

interface State { current: number; ports: number[] }

let state: State | null = null;
let stateMtime = 0;
function readState(): State {
  try {
    const mtime = statSync(STATE_FILE).mtimeMs;
    if (!state || mtime !== stateMtime) {
      const s = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as State;
      if (Number.isInteger(s.current) && Array.isArray(s.ports)) { state = { current: s.current, ports: [...new Set([s.current, ...s.ports])] }; stateMtime = mtime; }
    }
  } catch { /* keep the last good state */ }
  if (!state) throw new Error('no router state');
  return state;
}

const owners = new Map<string, { port: number; at: number }>();

async function fetchJson(port: number, path: string): Promise<{ status: number; body: any } | null> {
  try {
    const res = await fetch(`http://${HOST}:${port}${path}`, { signal: AbortSignal.timeout(1500) });
    return { status: res.status, body: await res.json().catch(() => null) };
  } catch { return null; }
}

/** Port of the instance that owns the room (the current one if nobody does). */
async function ownerOf(code: string): Promise<number> {
  const { current, ports } = readState();
  const hit = owners.get(code);
  if (hit && Date.now() - hit.at < 30_000 && ports.includes(hit.port)) return hit.port;
  // The current instance first – the common case needs one request only.
  for (const port of [current, ...ports.filter((p) => p !== current)]) {
    const r = await fetchJson(port, `/api/rooms/${encodeURIComponent(code)}`);
    if (r?.status === 200) { owners.set(code, { port, at: Date.now() }); return port; }
  }
  return current;
}

const roomCode = (path: string) => /^\/api\/rooms\/([A-Za-z0-9]+)$/.exec(path)?.[1]?.toUpperCase();

function proxyHttp(req: IncomingMessage, res: ServerResponse, port: number) {
  const up = httpRequest({ host: HOST, port, method: req.method, path: req.url, headers: req.headers }, (r) => {
    res.writeHead(r.statusCode ?? 502, r.headers);
    r.pipe(res);
  });
  up.on('error', () => { if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' }); res.end('Server wird gerade aktualisiert – bitte kurz warten.'); });
  req.pipe(up);
}

const server = createServer(async (req, res) => {
  try {
    const path = (req.url ?? '/').split('?')[0];
    if (path === '/api/rooms' && req.method === 'GET') {
      const rooms = (await Promise.all(readState().ports.map((p) => fetchJson(p, '/api/rooms')))).flatMap((r) => r?.body?.rooms ?? []);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify({ rooms }));
      return;
    }
    const code = roomCode(path);
    proxyHttp(req, res, code ? await ownerOf(code) : readState().current);
  } catch { res.writeHead(503).end(); }
});

server.on('upgrade', async (req: IncomingMessage, client: Socket, head: Buffer) => {
  client.on('error', () => client.destroy());
  try {
    const code = new URL(req.url ?? '/', 'http://x').searchParams.get('room')?.toUpperCase();
    const port = code ? await ownerOf(code) : readState().current;
    const up = connect(port, HOST, () => {
      const lines = [`${req.method} ${req.url} HTTP/1.1`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      up.write(lines.join('\r\n') + '\r\n\r\n');
      if (head.length) up.write(head);
      up.pipe(client);
      client.pipe(up);
    });
    up.on('error', () => client.destroy());
    client.on('close', () => up.destroy());
    up.on('close', () => client.destroy());
  } catch { client.destroy(); }
});

server.listen(PORT, '0.0.0.0', () => console.log(`LAN TD router on :${PORT} (state: ${STATE_FILE})`));
