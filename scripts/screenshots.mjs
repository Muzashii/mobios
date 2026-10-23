// Captures the README screenshots from the running app with the system's Edge/Chrome.
// Usage: node scripts/screenshots.mjs [url]   (default: the published GitHub Pages site)
// Output: docs/images/*.jpg
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const url = process.argv[2] ?? 'https://muzashii.github.io/mobios/';
const only = process.argv[3]; // optional: run a single scene
const out = path.resolve('docs/images');
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  channel: fs.existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe') ? 'chrome' : 'msedge',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

/** Fresh app (no saved project, tour dismissed) at desktop size. */
async function fresh() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: 'dark' });
  const page = await context.newPage();
  await page.addInitScript(() => localStorage.setItem('mobios-onboarding-done', '1'));
  await page.goto(url);
  await page.getByTestId('open-example').click();
  await page.getByTestId('part-row').first().waitFor();
  await page.waitForTimeout(1500);
  await page.keyboard.press('f'); // frame the model
  await page.waitForTimeout(4500); // let the welcome toast fade
  return { page, context };
}

const shot = async (page, name, clip) => {
  await page.mouse.move(1, 1); // no hover highlight
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(out, `${name}.jpg`), type: 'jpeg', quality: 86, clip });
  console.log('✓', name);
};

// Page helpers (run inside the app).
const helpers = () => {
  const setInput = (el, v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const label = (text) => [...document.querySelectorAll('aside label')].find((x) => x.textContent.trim() === text);
  window.__set = (text, v) => setInput(document.getElementById(label(text).htmlFor), v);
  window.__origin = (x, y, z) => {
    const ins = label('Origem X/Y/Z').parentElement.querySelectorAll('input');
    [x, y, z].forEach((v, i) => v !== null && setInput(ins[i], v));
  };
  window.__type = (t) => {
    const sel = [...document.querySelectorAll('aside select')].find((s) => [...s.options].some((o) => o.value === 'key'));
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, t);
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  };
};

async function selectPart(page, name) {
  await page.getByTestId('part-row').filter({ hasText: name }).first().click();
  await page.waitForTimeout(400);
}

async function cut(page, part, setup) {
  await selectPart(page, part);
  await page.keyboard.press('c');
  await page.getByTestId('commit-cut').waitFor();
  await page.waitForTimeout(400);
  await page.evaluate(helpers);
  await setup();
  await page.waitForTimeout(400);
  await page.getByTestId('commit-cut').click();
  await page.waitForTimeout(4500);
}

/** Head (key), both arms (bounded), legs+base (dowels): a figure in five printable parts. */
async function buildFigure(page) {
  await cut(page, 'Figura de exemplo', () => page.evaluate(() => (window.__origin(null, null, 83), window.__type('key'))));
  for (const side of [1, -1]) {
    await cut(page, 'Figura de exemplo A', async () => {
      await page.getByRole('button', { name: 'X', exact: true }).click();
      if (side < 0) await page.getByRole('button', { name: 'X', exact: true }).click();
      await page.evaluate((s) => window.__origin(22 * s, 0, 68), side);
      await page.getByRole('switch', { name: 'Corte limitado' }).click();
      await page.waitForTimeout(300);
      await page.evaluate(() => window.__set('Raio', 12));
    });
  }
  await cut(page, 'Figura de exemplo A', () => page.evaluate(() => (window.__origin(null, null, 40), window.__type('dowel'))));
}

/** Turns the camera to a 3/4 view (framing snaps to the front). */
async function orbit(page, dx = -70, dy = -30) {
  await page.mouse.move(1050, 700);
  await page.mouse.down();
  for (let i = 1; i <= 15; i++) await page.mouse.move(1050 + (dx * i) / 15, 700 + (dy * i) / 15);
  await page.mouse.up();
  await page.waitForTimeout(900);
}

async function paint(page, name, slot) {
  await selectPart(page, name);
  await page.getByRole('radio', { name: `Slot ${slot}` }).first().click();
  await page.waitForTimeout(300);
}

const scenes = {
  async hero() {
    const { page, context } = await fresh();
    await buildFigure(page);
    // Friendly names + filament slots (both are app features worth showing).
    const plan = [
      ['Figura de exemplo B', 'Cabeça', 2],
      ['Figura de exemplo A1ab', 'Tronco', 3],
      ['Figura de exemplo A2', 'Braço direito', 2],
      ['Figura de exemplo A1b', 'Braço esquerdo', 2],
      ['Figura de exemplo A1aa', 'Pernas e base', 1],
    ];
    for (const [from, to, slot] of plan) {
      await paint(page, from, slot);
      await page.getByLabel('Nome', { exact: true }).fill(to);
      await page.waitForTimeout(300);
    }
    // Leave the name field (shortcuts are ignored while typing) and clear the selection.
    await page.evaluate(() => (document.activeElement)?.blur?.());
    await page.mouse.click(260, 180);
    await page.keyboard.press('Escape');
    await page.keyboard.press('e');
    await page.waitForTimeout(600);
    await page.keyboard.press('f');
    await page.waitForTimeout(1500);
    await orbit(page);
    await shot(page, 'hero');
    // Assembly simulation mid-way, with the collision verdict.
    await page.keyboard.press('m');
    await page.waitForTimeout(2600);
    await page.getByRole('button', { name: 'Pausar' }).click();
    await page.waitForTimeout(800);
    await shot(page, 'montagem');
    await context.close();
  },

  async corte() {
    const { page, context } = await fresh();
    await selectPart(page, 'Figura de exemplo');
    await page.keyboard.press('c');
    await page.getByTestId('commit-cut').waitFor();
    await page.evaluate(helpers);
    await page.evaluate(() => (window.__set('Inclinação', 18), window.__origin(null, null, 66)));
    await page.waitForTimeout(1200);
    await orbit(page, -60, -25);
    await shot(page, 'corte');
    await context.close();
  },

  async smartcut() {
    const { page, context } = await fresh();
    await page.keyboard.press('s');
    await page.waitForTimeout(800);
    // Stroke along the figure's right forearm (screen coordinates at 1440×900).
    const [x0, y0, x1, y1] = JSON.parse(process.env.ARM ?? '[727,338,767,392]');
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    for (let i = 1; i <= 20; i++) await page.mouse.move(x0 + ((x1 - x0) * i) / 20, y0 + ((y1 - y0) * i) / 20);
    await page.mouse.up();
    await page.waitForTimeout(500);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(4000);
    await shot(page, 'smartcut');
    await context.close();
  },

  async analise() {
    const { page, context } = await fresh();
    await selectPart(page, 'Figura de exemplo');
    await page.getByTestId('analyze-part').click();
    await page.waitForTimeout(3500);
    await page.getByText('Análise de impressão', { exact: false }).first().scrollIntoViewIfNeeded();
    await shot(page, 'analise');
    await context.close();
  },

  async probe() {
    const { page, context } = await fresh();
    await shot(page, 'probe');
    await context.close();
  },
};

for (const [name, run] of Object.entries(scenes)) {
  if (only ? name !== only : name === 'probe') continue;
  await run();
}
await browser.close();
