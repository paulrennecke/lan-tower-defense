import changelogMd from '../../../CHANGELOG.md?raw';
import { esc } from './format';

export const APP_VERSION = __APP_VERSION__;

interface Release { version: string; date: string; items: string[] }

function parseChangelog(md: string): Release[] {
  const releases: Release[] = [];
  for (const line of md.split(/\r?\n/)) {
    const h = /^##\s+(\S+)(?:\s+[–-]\s+(.+))?$/.exec(line);
    if (h) releases.push({ version: h[1], date: h[2] ?? '', items: [] });
    else if (releases.length && /^\s*[-*]\s+/.test(line)) releases[releases.length - 1].items.push(line.replace(/^\s*[-*]\s+/, ''));
  }
  return releases;
}

const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code>$1</code>');

/** Shows the changelog as a closable overlay. */
export function showChangelog() {
  if (document.querySelector('.o-changelog')) return;
  const box = document.createElement('div');
  box.className = 'overlay o-changelog';
  box.innerHTML = `<div class="panel changelog">
    <h2 style="margin-top:0">🆕 Neuigkeiten <small class="muted">· Version ${esc(APP_VERSION)}</small></h2>
    ${parseChangelog(changelogMd).map((r) => `
      <h3>${esc(r.version)} <small class="muted">${esc(r.date)}</small></h3>
      <ul>${r.items.map((i) => `<li>${inline(i)}</li>`).join('')}</ul>`).join('')}
    <div style="text-align:right"><button class="primary close">Schließen <kbd>Esc</kbd></button></div>
  </div>`;
  const close = () => { box.remove(); window.removeEventListener('keydown', onKey, true); };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    close();
  };
  window.addEventListener('keydown', onKey, true);
  box.addEventListener('click', (e) => { if (e.target === box) close(); });
  box.querySelector<HTMLElement>('.close')!.onclick = close;
  document.body.appendChild(box);
}

/** Small "v1.1.0 · Neuigkeiten" link; call `bindVersionLink` on the container afterwards. */
export const versionLinkHtml = () => `<a href="#" class="version-link" title="Neuigkeiten anzeigen">v${esc(APP_VERSION)} · Neuigkeiten</a>`;

export function bindVersionLink(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('.version-link').forEach((a) => {
    a.onclick = (e) => { e.preventDefault(); showChangelog(); };
  });
}

/**
 * The page (client) and the room (server) can differ after a rolling deployment: rooms that were already running keep
 * their old server until they are empty. Shows the server version and warns about a mismatch.
 */
export function showServerVersion(serverVersion: string) {
  document.querySelectorAll<HTMLElement>('.version-link').forEach((a) => {
    let s = a.parentElement?.querySelector<HTMLElement>('.server-version');
    if (!s) { s = document.createElement('span'); s.className = 'server-version muted'; a.after(s); }
    s.textContent = ` · Server v${serverVersion}`;
  });
  document.querySelector('.version-warn')?.remove();
  if (serverVersion === APP_VERSION) return;
  const box = document.createElement('div');
  box.className = 'version-warn';
  box.innerHTML = `⚠ Dieser Raum läuft noch auf <b>v${esc(serverVersion)}</b>, deine Seite ist <b>v${esc(APP_VERSION)}</b>. Neueste Änderungen gelten erst in einem neu erstellten Raum. <button>OK</button>`;
  box.querySelector('button')!.onclick = () => box.remove();
  document.body.appendChild(box);
}
