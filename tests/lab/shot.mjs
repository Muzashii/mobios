// Screenshot the lab viewer. Usage: node tests/lab/shot.mjs "<query>" out.png [w h]
import { chromium } from '@playwright/test';
const [query, out, w = '1400', h = '1000'] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
await page.goto(`http://localhost:5173/tests/lab/viewer/index.html?${query}`);
await page.waitForFunction(() => document.body.dataset.ready, null, { timeout: 120000 });
if (await page.evaluate(() => document.body.dataset.ready === 'error')) console.error(await page.evaluate(() => document.body.innerText));
await page.screenshot({ path: out });
await browser.close();
console.log('ok', out);
