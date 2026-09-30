#!/usr/bin/env node
// Frame-stepped screenshots of the app: a list of steps (store changes, frame advances,
// captures). Uses ?virt=1 so every frame is exactly 1/30 s of simulated time.
//   node scripts/shots.mjs <outDir> <plan.json|inline-json> [--url http://127.0.0.1:5174] [--size 1280x800] [--quality low]
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2];
const planArg = process.argv[3];
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const url = arg('--url', 'http://127.0.0.1:5174');
const [w, h] = arg('--size', '1280x800').split('x').map(Number);
const quality = arg('--quality', 'low');
const dpr = Number(arg('--dpr', '1'));
const extraQuery = arg('--query', '');
const plan = JSON.parse(planArg.trim().startsWith('[') ? planArg : readFileSync(planArg, 'utf8'));
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
const errors = [];
page.on('pageerror', (e) => { errors.push(e.message); console.error('pageerror', e.message); });
page.on('console', (m) => { if (m.type() === 'error') { errors.push(m.text()); console.log('console error', m.text().slice(0, 400)); } });
const t0 = Date.now();
await page.goto(`${url}/?virt=1&capture=1&quality=${quality}${extraQuery ? '&' + extraQuery : ''}`);
await page.waitForFunction(() => !!window.__fabAdvance && window.__fabStores?.useApp.getState().ready, undefined, { timeout: 180000 });
console.log('ready in', ((Date.now() - t0) / 1000).toFixed(1), 's');
let n = 0;
for (const s of plan) {
  if (s.set) await page.evaluate((p) => window.__fabStores.useApp.getState().go(p), s.set);
  if (s.lab) await page.evaluate((p) => window.__fabStores.useLab.getState().set(p), s.lab);
  if (s.app) await page.evaluate((p) => window.__fabStores.useApp.getState().set(p), s.app);
  if (s.eval) await page.evaluate(s.eval);
  if (s.click) await page.locator(s.click).first().click();
  if (s.advance) {
    const per = s.every ?? 0;
    if (!per) {
      // logic only, drawing just the last frame (fast)
      await page.evaluate((k) => window.__fabAdvance(k, false), s.advance);
    } else
      for (let i = 0; i < s.advance; i += per) {
        await page.evaluate((k) => window.__fabAdvance(k, false), Math.min(per, s.advance - i));
        await page.screenshot({ path: join(out, `${String(n++).padStart(3, '0')}-${s.name ?? 'f'}-${i + per}.png`), timeout: 300000 });
      }
  }
  if (s.shot) { const ts = Date.now(); await page.screenshot({ path: join(out, `${String(n++).padStart(3, '0')}-${s.shot}.png`), timeout: 300000 }); console.log("shot", s.shot, ((Date.now() - ts) / 1000).toFixed(1), "s"); }
  if (s.log) console.log(s.log, await page.evaluate(s.logEval ?? '0'));
}
console.log('errors', errors.length, 'time', ((Date.now() - t0) / 1000).toFixed(0), 's');
await browser.close();
