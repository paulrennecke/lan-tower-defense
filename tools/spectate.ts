// Opens a spectator browser, waits, takes screenshots and measures FPS.
// Usage: npx tsx tools/spectate.ts <path-to-playwright-core> [seconds=60] [url]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const pw = require(process.argv[2]);
const seconds = Number(process.argv[3] ?? 60);
const URL = process.argv[4] ?? 'http://localhost:3000';
mkdirSync('e2e-shots', { recursive: true });

const browser = await pw.chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
const errors: string[] = [];
page.on('pageerror', (e: Error) => errors.push(e.message));
await page.goto(URL);
await page.waitForSelector('#game:not(.hidden)', { timeout: 60000 });
for (let s = 0; s < seconds; s += 15) {
  await page.waitForTimeout(15000);
  const info = await page.evaluate('({ wave: document.querySelector(".h-wave").textContent, lives: document.querySelector(".h-lives").textContent, enemies: window.__td.game.ent.enemies.size, towers: window.__td.game.ent.towers.size, fx: window.__td.game.ent.fx.count, calls: window.__td.game.world.renderer.info.render.calls })');
  console.log(JSON.stringify(info));
}
await page.evaluate('(() => { const g = window.__td.game; g.world.focus(18, 17); g.world.camDist = 75; })()');
await page.waitForTimeout(1000);
await page.screenshot({ path: 'e2e-shots/load.png' });
await page.evaluate('(() => { const g = window.__td.game; g.world.focus(10, 8); g.world.camDist = 30; })()');
await page.waitForTimeout(1000);
await page.screenshot({ path: 'e2e-shots/load-close.png' });
const fps = await page.evaluate('new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else res(n / 3); }; requestAnimationFrame(f); })');
console.log('fps (software rendering, no GPU):', fps);
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
