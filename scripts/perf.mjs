#!/usr/bin/env node
// Real-time performance and resource measurements, on the page's own requestAnimationFrame
// loop (not the frame-stepped clock). Frame intervals are the real ones (Stage.frames: the
// unclamped interval between frames), not the simulation's clamped step.
//
//   node scripts/perf.mjs [--url http://127.0.0.1:4174] [--size 1280x720] [--dpr 1]
//        [--quality high|medium|low] [--tour 60] [--soak 600] [--out dir] [--skip cold,visits,tour,soak]
//
// Parts:
//   cold    each deep link opened in a fresh browser context (empty cache): time to ready, and
//           the frames of the first 4 s after it
//   visits  in one session, every scene visited for the first time: the frames of the 3 s after
//           each change (shader compiles and uploads show as long frames here)
//   tour    the guided tour in real time for --tour seconds: frame statistics per chapter
//   soak    scenes cycled every 5 s for --soak seconds: GPU objects (geometries, textures,
//           programs) and the JS heap sampled every 30 s
//
// Writes <out>/perf.json and prints a summary. Report the renderer with the numbers: on a
// software renderer (SwiftShader) they say nothing about real-time performance on a device.
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { join } from 'node:path';

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
};
const url = arg('--url', 'http://127.0.0.1:4174');
const [W, H] = arg('--size', '1280x720').split('x').map(Number);
const dpr = Number(arg('--dpr', '1'));
const quality = arg('--quality', '');
const tourS = Number(arg('--tour', '60'));
const soakS = Number(arg('--soak', '600'));
const out = arg('--out', 'perf-out');
const skip = new Set(arg('--skip', '').split(',').filter(Boolean));
mkdirSync(out, { recursive: true });

const launch = () => chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--enable-precise-memory-info'] });
const q = (extra = '') => `${url}/?hooks=1${quality ? `&quality=${quality}` : ''}${extra ? '&' + extra : ''}`;
const ready = (page) => page.waitForFunction(() => !!window.__fabPerf && window.__fabStores?.useApp.getState().ready, undefined, { timeout: 300000 });
const perf = (page) => page.evaluate(() => window.__fabPerf());
const reset = (page) => page.evaluate(() => window.__fabPerfReset());
const go = (page, p) => page.evaluate((x) => window.__fabStores.useApp.getState().go(x), p);
const heap = (page) => page.evaluate(() => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e5) / 10 : null));
const fmt = (f) => `median ${f.medianMs.toFixed(1)} ms, p95 ${f.p95Ms.toFixed(1)} ms, max ${f.maxMs.toFixed(0)} ms, >100 ms: ${f.stalls100}, >250 ms: ${f.stalls250} (${f.frames} frames)`;

const report = { url, viewport: `${W}x${H}`, dpr, quality: quality || 'auto', cpus: cpus().length, cpu: cpus()[0]?.model, started: new Date().toISOString() };
const browser = await launch();
report.browser = `Chromium ${browser.version()}`;

async function session() {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: dpr });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return { ctx, page, errors };
}

// ── cold loads ──
if (!skip.has('cold')) {
  report.cold = [];
  for (const link of ['', 'mode=explore&system=overview', 'mode=explore&system=actuators', 'mode=simulate&lab=walk', 'mode=simulate&lab=manipulation', 'mode=engineer', 'mode=watch']) {
    const { ctx, page, errors } = await session();
    const t0 = Date.now();
    await page.goto(q(link));
    await ready(page);
    const readyS = (Date.now() - t0) / 1000;
    await reset(page);
    await page.waitForTimeout(4000);
    const p = await perf(page);
    report.renderer ??= await page.evaluate(() => {
      const gl = window.__fab.stage.renderer.getContext();
      const d = gl.getExtension('WEBGL_debug_renderer_info');
      return String(gl.getParameter(d ? d.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    });
    report.cold.push({ link: link || '(opening)', readyS, first4s: p.frames, tier: p.tier, calls: p.calls, triangles: p.triangles, errors });
    console.log(`cold ${link || '(opening)'}: ready ${readyS.toFixed(1)} s; first 4 s: ${fmt(p.frames)} [${p.tier}]`);
    await ctx.close();
  }
}

// ── first visits within a session ──
if (!skip.has('visits')) {
  const { ctx, page, errors } = await session();
  await page.goto(q('mode=explore&system=overview'));
  await ready(page);
  await page.waitForTimeout(3000);
  report.visits = [];
  const places = [
    { mode: 'explore', system: 'hands' },
    { mode: 'explore', system: 'actuators' },
    { mode: 'explore', system: 'actuators', exploded: true },
    { mode: 'explore', system: 'actuators', exploded: true, actuator: 'hip' },
    { mode: 'explore', system: 'power' },
    { mode: 'explore', system: 'thermal' },
    { mode: 'explore', system: 'vision' },
    { mode: 'simulate', lab: 'walk' },
    { mode: 'simulate', lab: 'manipulation' },
    { mode: 'simulate', lab: 'balance' },
    { mode: 'simulate', lab: 'joint' },
    { mode: 'engineer' },
    { mode: 'explore', system: 'overview', exploded: false },
  ];
  for (const p of places) {
    await reset(page);
    await go(page, p);
    await page.waitForTimeout(3000);
    const f = (await perf(page)).frames;
    report.visits.push({ to: p, frames: f });
    console.log(`visit ${JSON.stringify(p)}: ${fmt(f)}`);
  }
  report.visitErrors = errors;
  await ctx.close();
}

// ── the tour in real time ──
if (!skip.has('tour')) {
  const { ctx, page, errors } = await session();
  await page.goto(q('mode=explore&system=overview'));
  await ready(page);
  await page.waitForTimeout(2000);
  await go(page, { mode: 'watch' });
  report.tour = { chapters: [] };
  const t0 = Date.now();
  let idx = -1;
  await reset(page);
  while ((Date.now() - t0) / 1000 < tourS) {
    await page.waitForTimeout(500);
    const i = await page.evaluate(() => window.__fab.tour.index);
    if (i !== idx) {
      if (idx >= 0) report.tour.chapters.push({ index: idx, frames: (await perf(page)).frames });
      await reset(page);
      idx = i;
      if (i < 0) break;
    }
  }
  if (idx >= 0) report.tour.chapters.push({ index: idx, frames: (await perf(page)).frames });
  report.tour.seconds = (Date.now() - t0) / 1000;
  report.tour.tourClock = await page.evaluate(() => {
    const t = window.__fab.tour;
    return { index: t.index, t: t.t };
  });
  report.tour.errors = errors;
  for (const c of report.tour.chapters) console.log(`tour chapter ${c.index}: ${fmt(c.frames)}`);
  await ctx.close();
}

// ── soak ──
if (!skip.has('soak') && soakS > 0) {
  const { ctx, page, errors } = await session();
  await page.goto(q('mode=explore&system=overview'));
  await ready(page);
  const cycle = [
    { mode: 'explore', system: 'hands' },
    { mode: 'simulate', lab: 'manipulation' },
    { mode: 'explore', system: 'actuators', exploded: true },
    { mode: 'simulate', lab: 'walk' },
    { mode: 'engineer' },
    { mode: 'explore', system: 'vision', exploded: false },
    { mode: 'simulate', lab: 'balance' },
    { mode: 'explore', system: 'thermal' },
    { mode: 'simulate', lab: 'kinematics' },
    { mode: 'explore', system: 'overview' },
  ];
  report.soak = { samples: [] };
  const t0 = Date.now();
  let k = 0;
  let nextSample = 0;
  await reset(page);
  while ((Date.now() - t0) / 1000 < soakS) {
    const el = (Date.now() - t0) / 1000;
    if (el >= nextSample) {
      const p = await perf(page);
      report.soak.samples.push({ t: Math.round(el), geometries: p.memory.geometries, textures: p.memory.textures, programs: p.programs, heapMB: await heap(page), frames: p.frames });
      console.log(`soak ${Math.round(el)} s: geometries ${p.memory.geometries}, textures ${p.memory.textures}, programs ${p.programs}, heap ${await heap(page)} MB; ${fmt(p.frames)}`);
      await reset(page);
      nextSample += 30;
    }
    const place = cycle[k++ % cycle.length];
    await go(page, place);
    if (place.lab === 'walk') await page.evaluate(() => window.__fabStores.useLab.getState().set({ walking: true }));
    if (place.lab === 'manipulation') await page.evaluate(() => window.__fab.manip.pick());
    await page.waitForTimeout(5000);
  }
  const p = await perf(page);
  report.soak.samples.push({ t: Math.round((Date.now() - t0) / 1000), geometries: p.memory.geometries, textures: p.memory.textures, programs: p.programs, heapMB: await heap(page), frames: p.frames });
  report.soak.errors = errors;
  await ctx.close();
}

await browser.close();
writeFileSync(join(out, 'perf.json'), JSON.stringify(report, null, 2));
console.log(`\n${report.browser}, renderer: ${report.renderer ?? 'see the page'}, ${report.viewport} at DPR ${dpr}, ${report.cpus} CPUs (${report.cpu}). Written to ${join(out, 'perf.json')}`);
