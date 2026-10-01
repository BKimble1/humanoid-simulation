#!/usr/bin/env node
// Records the Watch pause in real time (the page's own requestAnimationFrame loop, as a visitor
// sees it), with Playwright's screen recording: the Walking chapter plays, is paused for 4 s of
// wall-clock time, then plays again. Samples what is presented before and after the pause.
//
//   node scripts/realtime-pause.mjs --url http://127.0.0.1:4182 --out dir [--size 960x540] [--quality low]
//
// Works with V1 builds too (no tour.jump there: the chapter is reached with next()).
import { chromium } from '@playwright/test';
import { mkdirSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
};
const url = arg('--url', 'http://127.0.0.1:4182');
const out = arg('--out', 'realtime-out');
const [W, H] = arg('--size', '960x540').split('x').map(Number);
const quality = arg('--quality', 'low');
const name = arg('--name', 'realtime-pause');
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: out, size: { width: W, height: H } } });
const page = await ctx.newPage();
await page.goto(`${url}/?hooks=1&quality=${quality}&mode=explore&system=overview`);
await page.waitForFunction(() => !!window.__fab && window.__fabStores?.useApp.getState().ready, undefined, { timeout: 240000 });
await page.waitForTimeout(1500);
await page.evaluate(() => window.__fabStores.useApp.getState().go({ mode: 'watch' }));
await page.waitForTimeout(500);
await page.evaluate(() => {
  const t = window.__fab.tour;
  if (t.jump) return t.jump(9);
  let g = 20;
  while (t.index !== 9 && g-- > 0) t.next();
});
await page.waitForTimeout(3500);
// what is presented: the pelvis, a knee, the belt and the camera
const sample = () =>
  page.evaluate(() => {
    const w = window.__fab;
    const o = w.driver.out;
    const c = w.stage.camera.position;
    return { t: performance.now(), pelvis: o.pelvisPos.toArray(), q: Array.from(o.q).slice(0, 12), belt: w.walk.beltNow, cam: [c.x, c.y, c.z], tourT: w.tour.t };
  });
await page.evaluate(() => window.__fab.tour.toggle());
await page.waitForTimeout(300);
const a = await sample();
await page.waitForTimeout(4000);
const b = await sample();
await page.evaluate(() => window.__fab.tour.toggle());
await page.waitForTimeout(2500);
const c = await sample();
const moved = (x, y) => Math.hypot(...x.pelvis.map((v, i) => v - y.pelvis[i])) + Math.max(...x.q.map((v, i) => Math.abs(v - y.q[i]))) + Math.abs(x.belt - y.belt) + Math.hypot(...x.cam.map((v, i) => v - y.cam[i]));
const result = {
  url,
  paused_s: (b.t - a.t) / 1000,
  changeWhilePaused: moved(a, b),
  beltWhilePaused_m: b.belt - a.belt,
  tourClockWhilePaused_s: b.tourT - a.tourT,
  afterPlay_s: (c.t - b.t) / 1000,
  tourClockAfterPlay_s: c.tourT - b.tourT,
};
console.log(JSON.stringify(result, null, 2));
writeFileSync(join(out, `${name}.json`), JSON.stringify(result, null, 2));
await ctx.close();
await browser.close();
// Playwright names the recording with a hash: give this run's its name
const v = readdirSync(out).filter((f) => /^[0-9a-f]{32}\.webm$/.test(f));
if (v.length === 1) renameSync(join(out, v[0]), join(out, `${name}.webm`));
