import type { ClientMsg, ServerMsg } from '../../shared/protocol';

type Handler = (msg: ServerMsg) => void;

export class Net {
  private ws: WebSocket | null = null;
  private handlers: Handler[] = [];
  private statusHandlers: ((connected: boolean) => void)[] = [];
  connected = false;
  private stopped = false;

  constructor(private getHello: () => ClientMsg, private room: string | null = null) {}

  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws${this.room ? `?room=${encodeURIComponent(this.room)}` : ''}`);
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true;
      this.statusHandlers.forEach((h) => h(true));
      ws.send(JSON.stringify(this.getHello()));
    };
    ws.onmessage = (ev) => {
      let msg: ServerMsg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      for (const h of this.handlers) h(msg);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.connected = false;
      this.statusHandlers.forEach((h) => h(false));
      if (!this.stopped) setTimeout(() => this.connect(), 2000);
    };
  }

  /** Closes the connection for good (no automatic reconnect). */
  stop() {
    this.stopped = true;
    this.ws?.close();
  }

  send(msg: ClientMsg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  onMessage(h: Handler) { this.handlers.push(h); }
  onStatus(h: (connected: boolean) => void) { this.statusHandlers.push(h); }
}
