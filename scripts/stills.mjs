#!/usr/bin/env node
// Renders stills of the dev harness (?dev=1) from named camera views, for visual review.
//   node scripts/stills.mjs <outDir> [baseUrl] [--views a,b] [--size 1280x800] [--quality low|medium|high]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] ?? 'stills';
const base = process.argv[3]?.startsWith('http') ? process.argv[3] : 'http://127.0.0.1:5174';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const [w, h] = arg('--size', '1280x800').split('x').map(Number);
const quality = arg('--quality', 'low');
const only = arg('--views', '').split(',').filter(Boolean);
const extra = arg('--eval', '');
mkdirSync(out, { recursive: true });

const VIEWS = {
  hero: [1.7, 1.25, 3.6, 0, 0.95, 0, 30],
  front: [0, 1.0, 4.2, 0, 0.9, 0, 30],
  side: [4.2, 1.0, 0, 0, 0.9, 0, 30],
  back: [-1.6, 1.3, -3.4, 0, 1.0, 0, 30],
  torso: [0.9, 1.45, 1.4, 0, 1.25, 0, 30],
  head: [0.55, 1.62, 0.75, 0, 1.58, 0.02, 30],
  hip: [0.9, 0.95, 0.95, 0.08, 0.86, 0, 30],
  knee: [0.9, 0.62, 0.8, 0.08, 0.6, 0, 30],
  foot: [0.7, 0.25, 0.8, 0.09, 0.1, 0.03, 30],
  hand: [0.55, 0.85, 0.5, 0.26, 0.78, 0.02, 30],
  arm: [0.9, 1.15, 0.9, 0.22, 1.1, 0, 30],
  wide: [3.6, 2.2, 6.2, 0, 1.0, -0.5, 38],
};

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: w, height: h } });
page.on('pageerror', (e) => console.error('pageerror', e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('console', m.type(), m.text().slice(0, 300)); });
await page.goto(`${base}/?dev=1&quality=${quality}&capture=1`);
await page.waitForFunction(() => !!window.__dev, undefined, { timeout: 120000 });
await page.evaluate(() => window.__dev.stop());
if (extra) await page.evaluate(extra);
console.log(await page.evaluate(() => JSON.stringify(window.__dev.stats())));
for (const [name, v] of Object.entries(VIEWS)) {
  if (only.length && !only.includes(name)) continue;
  await page.evaluate((v) => window.__dev.view(...v), v);
  await page.evaluate(() => window.__dev.render());
  await page.screenshot({ path: join(out, `${name}.png`) });
  console.log('wrote', name);
}
await browser.close();
