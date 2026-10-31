// End-to-end smoke test: two browser players join, pick classes, start, build, and survive a wave.
// Usage: npx tsx tools/e2e.ts <path-to-playwright-core> [url]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { MAP_W, MAP_H, SECTION_OF, cellIndex, PATH } from '../shared/map';

const require = createRequire(import.meta.url);
const pw = require(process.argv[2]);
const URL = process.argv[3] ?? 'http://localhost:3000';
const OUT = 'e2e-shots';
mkdirSync(OUT, { recursive: true });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const browser = await pw.chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const errors: string[] = [];
  const mk = async (label: string) => {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e: Error) => errors.push(`${label}: ${e.message}`));
    page.on('console', (m: any) => { if (m.type() === 'error') errors.push(`${label} console: ${m.text()}`); });
    await page.goto(URL);
    return page;
  };
  const a = await mk('A');
  await a.waitForSelector('.class-card');
  await a.fill('#lobby .name', 'Arthas');
  await a.click('#lobby .rename');
  await a.click('.class-card[data-class="human"]');
  const b = await mk('B');
  await b.waitForSelector('.class-card');
  await b.click('.class-card[data-class="orc"]');
  await sleep(300);
  await b.click('#lobby .ready');
  await sleep(500);
  await a.screenshot({ path: `${OUT}/1-lobby.png` });
  const startDisabled = await a.$eval('#lobby .start', (el: HTMLButtonElement) => el.disabled);
  console.log('start disabled?', startDisabled);
  await a.click('#lobby .start');
  await a.waitForSelector('#game:not(.hidden)', { timeout: 10000 });
  await sleep(1500);
  await a.screenshot({ path: `${OUT}/2-game-start.png` });

  // Find own buildable cells for player A, prefer near path corners.
  const state = await a.evaluate(() => { const g = (window as any).__td.game; return { you: g.you, owners: g.sectionOwners }; });
  const cells: { cx: number; cy: number; score: number }[] = [];
  for (let cy = 0; cy < MAP_H; cy++) for (let cx = 0; cx < MAP_W; cx++) {
    const s = SECTION_OF[cellIndex(cx, cy)];
    if (s < 0 || state.owners[s] !== state.you) continue;
    const { dist } = PATH.project(cx + 0.5, cy + 0.5);
    cells.push({ cx, cy, score: dist });
  }
  cells.sort((x, y) => x.score - y.score);
  const target = cells[0];
  // Focus camera on the cell and project it to screen coordinates.
  const screen = await a.evaluate(({ cx, cy }: { cx: number; cy: number }) => {
    const g = (window as any).__td.game;
    g.world.focus(cx + 0.5, cy + 0.5);
    g.world.render(0.016, 0);
    const v = g.world.camTarget.clone();
    v.project(g.world.camera);
    return { x: (v.x + 1) / 2 * window.innerWidth, y: (1 - v.y) / 2 * window.innerHeight };
  }, target);
  await a.mouse.move(screen.x, screen.y);
  await a.keyboard.press('1');
  await a.mouse.move(screen.x + 1, screen.y + 1);
  await sleep(200);
  await a.screenshot({ path: `${OUT}/3-build-preview.png` });
  await a.mouse.click(screen.x + 1, screen.y + 1);
  await sleep(500);
  let towers = await a.evaluate(() => (window as any).__td.game.ent.towers.size);
  console.log('towers after click build:', towers);

  // Build a few more via protocol for both players.
  for (const [page, cls] of [[a, 'h_watch'], [b, 'o_spear']] as const) {
    const st = await page.evaluate(() => { const g = (window as any).__td.game; return { you: g.you, owners: g.sectionOwners }; });
    const own = [] as { cx: number; cy: number; d: number }[];
    for (let cy = 0; cy < MAP_H; cy++) for (let cx = 0; cx < MAP_W; cx++) {
      const s = SECTION_OF[cellIndex(cx, cy)];
      if (s >= 0 && st.owners[s] === st.you) own.push({ cx, cy, d: PATH.project(cx + 0.5, cy + 0.5).dist });
    }
    own.sort((x, y) => x.d - y.d);
    for (const c of own.slice(1, 4)) await page.evaluate(({ c, cls }: any) => (window as any).__td.net.send({ t: 'build', def: cls, cx: c.cx, cy: c.cy }), { c, cls });
  }
  await sleep(500);
  towers = await a.evaluate(() => (window as any).__td.game.ent.towers.size);
  console.log('towers total:', towers);

  // Select a tower by clicking it and upgrade with U.
  await a.mouse.click(screen.x + 1, screen.y + 1);
  await sleep(300);
  const selVisible = await a.$eval('.sel-panel', (el: HTMLElement) => !el.classList.contains('hidden'));
  console.log('selection panel visible:', selVisible);
  await a.keyboard.press('u');
  await sleep(400);
  await a.screenshot({ path: `${OUT}/4-selected.png` });

  // Both ready -> wave starts in 3s.
  await a.keyboard.press('n');
  await b.keyboard.press('n');
  await sleep(9000);
  const enemies = await a.evaluate(() => (window as any).__td.game.ent.enemies.size);
  console.log('enemies visible:', enemies);
  // Look at the spawn.
  await a.evaluate(() => { const g = (window as any).__td.game; g.world.focus(6, 3); g.world.camDist = 35; });
  await sleep(1500);
  await a.screenshot({ path: `${OUT}/5-wave.png` });
  await a.keyboard.press('f');
  await sleep(300);
  await a.screenshot({ path: `${OUT}/6-research.png` });
  await a.keyboard.press('Escape');
  await a.keyboard.down('Tab');
  await sleep(300);
  await a.screenshot({ path: `${OUT}/7-score.png` });
  await a.keyboard.up('Tab');
  const hud = await a.evaluate(() => ({ wave: document.querySelector('.h-wave')!.textContent, gold: document.querySelector('.h-gold')!.textContent, lives: document.querySelector('.h-lives')!.textContent }));
  console.log('hud', JSON.stringify(hud));
  const fps = await a.evaluate('new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else res(n / 2); }; requestAnimationFrame(f); })');
  console.log('fps (software GL):', fps);
  console.log('errors:', errors.length ? errors : 'none');
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
