// Runs Lighthouse (desktop + mobile) against the production preview and prints the scores.
// Usage: npm run build && npx vite preview --port 4173 & node scripts/lighthouse.mjs [url]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const url = process.argv[2] ?? 'http://localhost:4173/';
const candidates = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
const chrome = candidates.find((p) => fs.existsSync(p));
if (!chrome) {
  console.error('Chrome/Edge não encontrado. Defina CHROME_PATH.');
  process.exit(1);
}

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fenda-lh-'));
const categories = ['performance', 'accessibility', 'best-practices', 'seo'];
let failed = false;
for (const preset of ['desktop', 'mobile']) {
  const out = path.join(outDir, `${preset}.json`);
  const args = [
    'lighthouse',
    url,
    `--only-categories=${categories.join(',')}`,
    '--output=json',
    `--output-path=${out}`,
    '--chrome-flags="--headless=new --use-angle=swiftshader --enable-unsafe-swiftshader"',
    '--quiet',
  ];
  if (preset === 'desktop') args.push('--preset=desktop');
  // chrome-launcher reads CHROME_PATH (paths with spaces break CLI flags under a shell).
  const r = spawnSync('npx', args, { stdio: 'inherit', shell: true, env: { ...process.env, CHROME_PATH: chrome } });
  if (r.status !== 0 || !fs.existsSync(out)) {
    console.error(`Lighthouse (${preset}) falhou.`);
    failed = true;
    continue;
  }
  const report = JSON.parse(fs.readFileSync(out, 'utf8'));
  const scores = categories.map((c) => `${c} ${Math.round((report.categories[c]?.score ?? 0) * 100)}`).join(' · ');
  console.log(`[${preset}] ${scores}`);
  for (const c of categories) {
    const cat = report.categories[c];
    if (!cat || cat.score >= 0.9) continue;
    failed = true;
    const misses = cat.auditRefs
      .map((ref) => report.audits[ref.id])
      .filter((a) => a && a.score !== null && a.score < 0.9 && a.scoreDisplayMode !== 'informative')
      .map((a) => `  - ${a.id}: ${a.title}${a.displayValue ? ` (${a.displayValue})` : ''}`);
    console.log(`  ${c} abaixo de 90:\n${misses.slice(0, 10).join('\n')}`);
  }
  const m = report.audits;
  console.log(`  FCP ${m['first-contentful-paint']?.displayValue} · LCP ${m['largest-contentful-paint']?.displayValue} · TBT ${m['total-blocking-time']?.displayValue} · CLS ${m['cumulative-layout-shift']?.displayValue}`);
}
console.log(`Relatórios: ${outDir}`);
process.exit(failed ? 1 : 0);
