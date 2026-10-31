let ctx: AudioContext | null = null;
let enabled = true;
let lastPlay: Record<string, number> = {};

function ac(): AudioContext | null {
  if (!enabled) return null;
  if (!ctx) {
    try { ctx = new AudioContext(); } catch { enabled = false; return null; }
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.15, slide = 0, delay = 0) {
  const a = ac();
  if (!a) return;
  const t0 = a.currentTime + delay;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

/** Rate-limited sound effects. */
export const sfx = {
  setEnabled(v: boolean) { enabled = v; },
  get enabled() { return enabled; },
  play(name: 'build' | 'upgrade' | 'sell' | 'error' | 'wave' | 'boss' | 'leak' | 'ping' | 'victory' | 'defeat' | 'click' | 'research') {
    const now = performance.now();
    if (now - (lastPlay[name] ?? 0) < 80) return;
    lastPlay[name] = now;
    switch (name) {
      case 'build': tone(220, 0.12, 'square', 0.08); tone(330, 0.12, 'square', 0.06, 0, 0.08); break;
      case 'upgrade': [392, 494, 587].forEach((f, i) => tone(f, 0.15, 'triangle', 0.1, 0, i * 0.08)); break;
      case 'research': [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.18, 'triangle', 0.08, 0, i * 0.07)); break;
      case 'sell': tone(600, 0.1, 'triangle', 0.08); tone(900, 0.15, 'triangle', 0.08, 0, 0.06); break;
      case 'error': tone(160, 0.18, 'sawtooth', 0.06); break;
      case 'click': tone(800, 0.04, 'square', 0.03); break;
      case 'wave': tone(196, 0.6, 'sawtooth', 0.07, 0); tone(147, 0.8, 'sawtooth', 0.06, 0, 0.25); break;
      case 'boss': tone(98, 1.2, 'sawtooth', 0.1, -40); tone(73, 1.4, 'square', 0.06, -20, 0.3); break;
      case 'leak': tone(120, 0.3, 'sine', 0.2, -60); break;
      case 'ping': tone(1200, 0.12, 'sine', 0.1); tone(1500, 0.15, 'sine', 0.08, 0, 0.1); break;
      case 'victory': [523, 659, 784, 1046, 784, 1046].forEach((f, i) => tone(f, 0.3, 'triangle', 0.1, 0, i * 0.15)); break;
      case 'defeat': [392, 330, 262, 196].forEach((f, i) => tone(f, 0.5, 'sawtooth', 0.07, 0, i * 0.3)); break;
    }
  },
};
