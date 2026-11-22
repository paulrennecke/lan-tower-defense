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

export const githubLinkHtml = () => `<div class="github-link">
  <a href="https://github.com/paulrennecke/lan-tower-defense" target="_blank" rel="noopener noreferrer" aria-label="GitHub-Repository">
    <svg width="24" height="24" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.012 8.012 0 0 0 16 8c0-4.42-3.58-8-8-8z"/>
    </svg>
  </a>
</div>`;

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
