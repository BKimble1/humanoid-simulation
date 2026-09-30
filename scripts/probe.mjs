#!/usr/bin/env node
// Runs a scenario in the app on its frame-stepped clock (?virt=1) with the developer telemetry
// on, writes every frame's measurements to JSON and prints a summary; optionally records the
// frames to a video.
//
//   node scripts/probe.mjs <scenario> [--url http://127.0.0.1:5174] [--size 1280x720] [--dpr 1]
//        [--quality low|medium|high] [--out dir] [--video] [--every 1] [--query k=v&…]
//
// Scenarios are in scripts/scenarios.mjs. `--video` renders and captures every `--every`-th
// frame (1: all) and encodes <out>/<scenario>.mp4 (H.264, 30 fps / every).
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCENARIOS } from './scenarios.mjs';

const name = process.argv[2];
const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
};
const has = (k) => process.argv.includes(k);
if (!name || !SCENARIOS[name]) {
  console.error(`usage: node scripts/probe.mjs <${Object.keys(SCENARIOS).join('|')}> [options]`);
  process.exit(2);
}
const url = arg('--url', 'http://127.0.0.1:5174');
const [W, H] = arg('--size', '1280x720').split('x').map(Number);
const dpr = Number(arg('--dpr', '1'));
const quality = arg('--quality', has('--video') ? 'high' : 'low');
const out = arg('--out', 'probe-out');
const every = Number(arg('--every', '1'));
const video = has('--video');
const extra = arg('--query', '');
const touch = has('--touch');
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: dpr, hasTouch: touch, isMobile: touch });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
const sc = SCENARIOS[name];
const t0 = Date.now();
await page.goto(`${url}/?virt=1&hooks=1&capture=1&quality=${quality}${sc.query ? '&' + sc.query : ''}${extra ? '&' + extra : ''}`);
await page.waitForFunction(() => !!window.__fabAdvance && window.__fabStores?.useApp.getState().ready, undefined, { timeout: 240000 });
await page.evaluate(() => window.__fabAdvance(2, false));
await page.evaluate(() => window.__fabTelemetry.start());

const frames = join(out, `${name}-frames`);
if (video) {
  rmSync(frames, { recursive: true, force: true });
  mkdirSync(frames, { recursive: true });
}
let n = 0;
let shot = 0;
const marks = [];
async function advance(k) {
  if (!video) {
    await page.evaluate((m) => window.__fabAdvance(m, false), k);
    n += k;
    return;
  }
  for (let i = 0; i < k; i++) {
    const draw = (n + 1) % every === 0;
    await page.evaluate((d) => window.__fabAdvance(1, d), draw);
    n++;
    if (draw) await page.screenshot({ path: join(frames, `${String(shot++).padStart(5, '0')}.png`), timeout: 600000 });
  }
}
const api = {
  page,
  advance,
  set: (p) => page.evaluate((x) => window.__fabStores.useApp.getState().go(x), p),
  app: (p) => page.evaluate((x) => window.__fabStores.useApp.getState().set(x), p),
  lab: (p) => page.evaluate((x) => window.__fabStores.useLab.getState().set(x), p),
  eval: (fn, a) => page.evaluate(fn, a),
  mark: (label) => marks.push({ frame: n, label }),
};
await sc.run(api);
const data = await page.evaluate(() => ({ samples: window.__fabTelemetry.samples, events: window.__fabTelemetry.events }));
writeFileSync(join(out, `${name}.json`), JSON.stringify({ scenario: name, marks, ...data, errors }, null, 0));

// summary: the worst frames for each measure
const S = data.samples;
const top = (k, f = (s) => s[k], dir = -1) =>
  [...S].sort((a, b) => dir * (f(a) - f(b))).slice(0, 3).map((s) => `${f(s).toFixed(3)}@${s.i}(${s.scene}${s.blending ? ',blend' : ''})`).join(' ');
console.log(`${name}: ${S.length} frames, ${((Date.now() - t0) / 1000).toFixed(0)} s, errors ${errors.length}`);
console.log(`  joint speed max rad/s   ${top('jv')}`);
console.log(`  joint accel max rad/s²  ${top('ja')}`);
console.log(`  hand rate max 1/s       ${top('hv')}`);
console.log(`  pelvis speed max m/s    ${top('pv')}`);
console.log(`  camera speed max m/s    ${top('cv')}`);
console.log(`  camera accel max m/s²   ${top('ca')}`);
console.log(`  camera clearance min m  ${top('cc', (s) => s.cc, 1)}`);
console.log(`  sole slip max m/s       ${top('slip', (s) => Math.max(s.slipL, s.slipR))}`);
console.log(`  sole min m              ${top('soleMin', (s) => s.soleMin, 1)}`);
console.log(`  object speed max m/s    ${top('ov')}`);
console.log(`  attach err max m        ${top('attach')}`);
if (data.events.length) console.log(`  events: ${data.events.map((e) => `${e.kind}@${e.i}`).join(' ')}`);
for (const e of errors.slice(0, 5)) console.log('  error:', e.slice(0, 200));
if (video) {
  let ff = 'ffmpeg';
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  } catch {
    ff = execFileSync('python3', ['-c', 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())']).toString().trim();
  }
  const mp4 = join(out, `${name}.mp4`);
  execFileSync(ff, ['-y', '-loglevel', 'error', '-framerate', String(30 / every), '-i', join(frames, '%05d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '22', '-preset', 'slow', '-movflags', '+faststart', mp4]);
  console.log(`  video: ${mp4}`);
}
await browser.close();
