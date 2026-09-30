import { test, type Page } from '@playwright/test';
import { advance, expect, go, lab, open, settle, watchErrors } from './helpers';

/**
 * Continuity: every frame of what the visitor sees, measured by the developer telemetry
 * (src/world/telemetry.ts), not only where a move ends. Limits, and why:
 *
 *  - joint speed ≤ 4.5 rad/s outside walking (the pose driver's blends are held to 2.4 rad/s;
 *    a blend interrupted by another adds the two motions), ≤ 12 rad/s while walking (a knee in
 *    swing reaches 6–10 rad/s, as a person's does);
 *  - joint acceleration ≤ 90 rad/s² outside walking (a blend starts with the displayed
 *    velocity but not its acceleration: one-frame steps of this size are invisible);
 *  - hand pose rate ≤ 3.5 per second (a full grip closes in about 0.3 s);
 *  - pelvis ≤ 0.5 m/s when not walking (weight shifts and blends);
 *  - a planted sole slides ≤ 0.02 m/s relative to what supports it — the floor, or the belt
 *    (sub-millimetre per frame: rolling heel and toe contacts move a corner slightly);
 *  - a held object is within 2 mm of where the hand holds it, and moves ≤ 1 m/s unless it is
 *    falling;
 *  - the camera never comes within the near plane of the robot's collision proxies, and its
 *    acceleration stays ≤ 15 m/s² (≤ 40 when the scene is changed every 100–300 ms: the
 *    velocity a move carries into the next is bounded so it cannot throw the path wide, and
 *    when that bound acts the speed changes within a frame).
 *
 * Intentional discontinuities are telemetry events (a chapter reset, the cart's objects put
 * back while it is away); a forced hand-over or a camera clamp is a failure.
 */

// the motion is the same at any viewport: these run once, on the desktop project
test.beforeEach(({}, info) => test.skip(info.project.name !== 'desktop', 'viewport-independent'));

interface Sample {
  i: number;
  scene: string;
  source: string;
  jv: number;
  ja: number;
  jvJoint: string;
  hv: number;
  pv: number;
  cv: number;
  ca: number;
  cc: number;
  slipL: number;
  slipR: number;
  soleMin: number;
  ov: number;
  attach: number;
  explode: number;
  actuatorOut: number;
  assemblies: string;
}
type Tel = { samples: Sample[]; events: { kind: string; i: number; detail?: string }[] };

async function startTelemetry(page: Page) {
  await page.evaluate(() => (window as unknown as { __fabTelemetry: { start(): void } }).__fabTelemetry.start());
}
async function telemetry(page: Page): Promise<Tel> {
  return page.evaluate(() => {
    const t = (window as unknown as { __fabTelemetry: Tel }).__fabTelemetry;
    return { samples: t.samples, events: t.events };
  });
}
const worst = (s: Sample[], k: keyof Sample) => s.reduce((m, x) => (Math.abs(x[k] as number) > Math.abs(m[k] as number) ? x : m), s[0]);
function expectWithin(s: Sample[], k: keyof Sample, max: number, what: string) {
  const w = worst(s, k);
  expect(Math.abs(w[k] as number), `${what}: ${String(k)} ${(w[k] as number).toFixed(3)} at frame ${w.i} (${w.scene}, ${w.source}${k === 'jv' ? ', ' + w.jvJoint : ''})`).toBeLessThanOrEqual(max);
}
function noFailures(t: Tel) {
  const bad = t.events.filter((e) => e.kind === 'forced-handover' || e.kind === 'camera-clamp');
  expect(bad, 'no forced hand-over or camera clamp').toEqual([]);
}

test('overview → hand → actuators → forces, repeated clicks and a payload change: body and fingers stay continuous', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, 'mode=explore&system=overview');
  await settle(page);
  await startTelemetry(page);
  for (const system of ['hands', 'actuators', 'forces']) {
    await go(page, { mode: 'explore', system });
    await advance(page, 75);
  }
  for (const system of ['hands', 'overview', 'hands', 'actuators', 'hands']) {
    await go(page, { mode: 'explore', system });
    await advance(page, 6);
  }
  await advance(page, 60);
  await page.evaluate(() => (window as unknown as { __fabStores: { useApp: { getState: () => { setConfig: (p: object) => void } } } }).__fabStores.useApp.getState().setConfig({ payload: 15 }));
  await advance(page, 40);
  await page.evaluate(() => (window as unknown as { __fabStores: { useApp: { getState: () => { setConfig: (p: object) => void } } } }).__fabStores.useApp.getState().setConfig({ payload: 0 }));
  await advance(page, 70);
  const t = await telemetry(page);
  expectWithin(t.samples, 'jv', 4.5, 'joints');
  expectWithin(t.samples, 'ja', 90, 'joints');
  expectWithin(t.samples, 'hv', 3.5, 'hands');
  expectWithin(t.samples, 'pv', 0.5, 'pelvis');
  expectWithin(t.samples, 'ca', 15, 'camera');
  expect(Math.min(...t.samples.map((s) => s.cc)), 'camera clear of the robot').toBeGreaterThan(0.05);
  // camera moves: most take 0.8–1.8 s, none more than 2 s unless it swings out around the robot
  const moves = t.events.filter((e) => e.kind === 'camera-move').map((e) => Number(e.detail!.split(' ')[1]));
  expect(moves.length).toBeGreaterThan(5);
  expect(moves.filter((d) => d >= 0.8 && d <= 1.8).length / moves.length, `move durations ${moves.join(', ')}`).toBeGreaterThanOrEqual(0.6);
  expect(Math.max(...moves)).toBeLessThanOrEqual(3.4);
  noFailures(t);
  expect(errors).toEqual([]);
});

test('an actuator switch while open closes the old one before the new one appears; reversing midway re-opens it', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, 'mode=explore&system=actuators');
  await settle(page);
  await go(page, { exploded: true });
  await settle(page);
  await startTelemetry(page);
  for (const [to, n] of [['hip', 110], ['elbow', 110], ['knee', 110], ['elbow', 110], ['hip', 110], ['knee', 110]] as const) {
    await go(page, { actuator: to });
    await advance(page, n);
  }
  await go(page, { actuator: 'hip' });
  await advance(page, 18);
  await go(page, { actuator: 'knee' });
  await advance(page, 120);
  const t = await telemetry(page);
  let prev = t.samples[0].assemblies;
  let appearances = 0;
  for (const s of t.samples) {
    expect(s.assemblies.split(',').filter(Boolean).length, `frame ${s.i}: one assembly at most`).toBeLessThanOrEqual(1);
    if (s.assemblies && s.assemblies !== prev) {
      appearances++;
      // a newly shown assembly starts closed, in the limb
      expect(s.explode, `frame ${s.i}: ${s.assemblies} appears closed`).toBeLessThan(0.05);
      expect(s.actuatorOut, `frame ${s.i}: ${s.assemblies} appears in the limb`).toBeLessThan(0.05);
    }
    prev = s.assemblies;
  }
  expect(appearances, 'all six directional handoffs happened').toBeGreaterThanOrEqual(6);
  // the reversal: the knee was never hidden (hip never appeared in the last 138 frames)
  const tail = t.samples.slice(-138);
  expect(tail.every((s) => s.assemblies === '' || s.assemblies === 'knee')).toBe(true);
  expect(tail[tail.length - 1].explode).toBeGreaterThan(0.95);
  expectWithin(t.samples, 'ca', 15, 'camera');
  expect(Math.min(...t.samples.map((s) => s.cc)), 'camera clear of the robot').toBeGreaterThan(0.05);
  noFailures(t);
  expect(errors).toEqual([]);
});

test('pick and place with one hand and with two: no stage-boundary jump, the object stays in the hand', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, 'mode=simulate&lab=manipulation');
  await settle(page);
  await startTelemetry(page);
  for (const task of ['box', 'tool', 'vial']) {
    await lab(page, { task });
    await advance(page, 30);
    await page.evaluate(() => (window as unknown as { __fab: { manip: { pick(): void } } }).__fab.manip.pick());
    await advance(page, 190);
    await page.evaluate(() => (window as unknown as { __fab: { manip: { place(): void } } }).__fab.manip.place());
    await advance(page, 150);
  }
  const t = await telemetry(page);
  expectWithin(t.samples, 'jv', 4.5, 'joints');
  expectWithin(t.samples, 'ja', 90, 'joints (no IK chatter)');
  expectWithin(t.samples, 'hv', 3.5, 'hands');
  expectWithin(t.samples, 'ov', 1.0, 'objects');
  expectWithin(t.samples.filter((x) => x.attach >= 0), 'attach', 0.002, 'held object');
  expectWithin(t.samples, 'pv', 0.5, 'pelvis');
  expect(Math.max(...t.samples.map((s) => Math.max(s.slipL, s.slipR))), 'feet planted').toBeLessThanOrEqual(0.02);
  noFailures(t);
  const stage = await page.evaluate(() => (window as unknown as { __fab: { manip: { stage: string } } }).__fab.manip.stage);
  expect(stage).toBe('rest');
  expect(errors).toEqual([]);
});

test('leaving mid-grasp: the object is put back before the robot hands over, and nothing is left in the hand', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, 'mode=simulate&lab=manipulation');
  await settle(page);
  await lab(page, { task: 'tool' });
  await advance(page, 20);
  await page.evaluate(() => (window as unknown as { __fab: { manip: { pick(): void } } }).__fab.manip.pick());
  await advance(page, 150); // holding
  await startTelemetry(page);
  await go(page, { mode: 'explore', system: 'hands' });
  await advance(page, 200);
  const t = await telemetry(page);
  const st = await page.evaluate(() => {
    const w = (window as unknown as { __fab: { driver: { source: { id: string } }; manip: { stage: string; held: unknown } } }).__fab;
    return { source: w.driver.source.id, stage: w.manip.stage, held: w.manip.held };
  });
  expect(st.source).toBe('idle');
  expect(st.stage).toBe('rest');
  expect(st.held).toBeNull();
  expectWithin(t.samples, 'ov', 1.0, 'objects');
  expectWithin(t.samples, 'jv', 4.5, 'joints');
  expectWithin(t.samples, 'hv', 3.5, 'hands');
  noFailures(t);
  expect(errors).toEqual([]);
});

test('walking: start, gait change, stop, carrying, and walk → balance → one foot → overview keep planted soles on their support', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, 'mode=simulate&lab=walk');
  await settle(page);
  await startTelemetry(page);
  await lab(page, { walking: true, gait: 'normal', carry: false });
  await advance(page, 150);
  await lab(page, { gait: 'fast' });
  await advance(page, 120);
  await lab(page, { walking: false });
  await advance(page, 90);
  await lab(page, { carry: true, walking: true, gait: 'slow' });
  await advance(page, 150);
  await lab(page, { walking: false });
  await advance(page, 60);
  await lab(page, { carry: false, walking: true, gait: 'normal' });
  await advance(page, 75);
  await go(page, { mode: 'simulate', lab: 'balance' });
  await advance(page, 150);
  await lab(page, { balanceTask: 'oneFoot' });
  await advance(page, 90);
  await go(page, { mode: 'explore', system: 'overview' });
  await advance(page, 150);
  const t = await telemetry(page);
  expect(Math.max(...t.samples.map((s) => Math.max(s.slipL, s.slipR))), 'planted soles do not slide').toBeLessThanOrEqual(0.02);
  expect(Math.min(...t.samples.map((s) => s.soleMin)), 'no sole through the floor').toBeGreaterThan(-0.003);
  expectWithin(t.samples, 'jv', 12, 'joints');
  // outside walking's own strides (a knee in swing), no joint snaps: stepping feet land softly
  expectWithin(t.samples.filter((s) => s.source !== 'walk'), 'ja', 90, 'joints when not walking');
  expectWithin(t.samples.filter((s) => s.source !== 'walk'), 'pv', 0.5, 'pelvis when not walking');
  noFailures(t);
  const src = await page.evaluate(() => (window as unknown as { __fab: { driver: { source: { id: string } } } }).__fab.driver.source.id);
  expect(src).toBe('idle');
  expect(errors).toEqual([]);
});

test('scene changes every 100–300 ms while everything moves: no invalid state, no clipping, nothing left over', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page);
  await advance(page, 30);
  await startTelemetry(page);
  const places = [
    { mode: 'explore', system: 'overview' },
    { mode: 'explore', system: 'actuators', exploded: true },
    { mode: 'simulate', lab: 'walk' },
    { mode: 'explore', system: 'power' },
    { mode: 'simulate', lab: 'manipulation' },
    { mode: 'explore', system: 'hands' },
    { mode: 'simulate', lab: 'balance' },
    { mode: 'engineer' },
    { mode: 'explore', system: 'thermal' },
    { mode: 'simulate', lab: 'joint' },
    { mode: 'explore', system: 'vision' },
    { mode: 'simulate', lab: 'kinematics' },
    { mode: 'intro' },
  ];
  let seed = 11;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  await lab(page, { walking: true });
  for (let k = 0; k < 50; k++) {
    await go(page, { exploded: false, ...places[Math.floor(rnd() * places.length)] });
    await advance(page, 3 + Math.floor(rnd() * 7));
  }
  await go(page, { mode: 'explore', system: 'overview', exploded: false });
  await advance(page, 300);
  const t = await telemetry(page);
  expectWithin(t.samples, 'jv', 12, 'joints');
  expectWithin(t.samples.filter((s) => s.source !== 'walk'), 'pv', 0.6, 'pelvis');
  expectWithin(t.samples, 'ca', 40, 'camera');
  expect(Math.min(...t.samples.map((s) => s.cc)), 'camera clear of the robot').toBeGreaterThan(0.05);
  expect(Math.max(...t.samples.map((s) => Math.max(s.slipL, s.slipR))), 'planted soles').toBeLessThanOrEqual(0.02);
  noFailures(t);
  const st = await page.evaluate(() => (window as unknown as { __fabState: () => Record<string, unknown> }).__fabState());
  expect(JSON.stringify(st)).not.toMatch(/null|NaN/);
  expect(st.source).toBe('idle');
  const ch = st.channels as Record<string, number>;
  for (const k of ['cart', 'explode', 'actuatorOut', 'chestOpen', 'thermal', 'vision', 'rigLight']) expect(ch[k], `${k} closed`).toBeLessThan(0.01);
  expect(errors).toEqual([]);
});

test('equal simulated time at 30, 60 and 120 Hz and irregular steps: same state, same energy, no double counting while blending into walking', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, 'mode=explore&system=overview');
  await settle(page);
  type W = {
    __fab: { energy: { snapshot(): unknown; restore(s: unknown): void }; driver: { source: { id: string } } };
    __fabSetStep: (d: number) => void;
    __fabAdvance: (n: number, r: boolean) => void;
    __fabSteps: (steps: number[]) => void;
    __fabState: () => { soc: number; temps: number[]; belt: number };
  };
  await page.evaluate(() => {
    const w = window as unknown as W & { __energy0: unknown };
    w.__energy0 = w.__fab.energy.snapshot();
  });
  const results: { soc: number; temp: number; belt: number }[] = [];
  // the first cycle is a warm-up: every measured run then starts from the same place (back from
  // the treadmill, standing in Overview), not the first from a robot that has not walked yet
  for (const rate of [30, 30, 60, 120, 0]) {
    // the same starting point every time: standing in Overview, the same charge and heat
    await page.evaluate(() => (window as unknown as W).__fabSetStep(1 / 30));
    await lab(page, { walking: false });
    await go(page, { mode: 'explore', system: 'overview' });
    await advance(page, 120);
    await page.evaluate(() => {
      const w = window as unknown as W & { __energy0: unknown };
      w.__fab.energy.restore(w.__energy0);
    });
    // 1 s standing, then walking (entered with its blend) for 3 s: 4 s of simulated time
    const run = (seconds: number) =>
      page.evaluate(
        ({ s, r }) => {
          const w = window as unknown as W;
          const steps: number[] = [];
          let t = 0;
          let k = 0;
          while (t < s - 1e-9) {
            const d = r ? 1 / r : Math.min(s - t, [1 / 24, 1 / 90, 1 / 50, 1 / 33, 1 / 144][k++ % 5]);
            steps.push(d);
            t += d;
          }
          w.__fabSteps(steps);
        },
        { s: seconds, r: rate },
      );
    await run(1);
    await go(page, { mode: 'simulate', lab: 'walk' });
    await lab(page, { walking: true, gait: 'normal' });
    await run(3);
    const s = await page.evaluate(() => (window as unknown as W).__fabState());
    results.push({ soc: s.soc, temp: Math.max(...s.temps), belt: s.belt });
  }
  await page.evaluate(() => (window as unknown as W).__fabSetStep(1 / 30));
  const [, ref, ...rest] = results;
  const s0 = await page.evaluate(() => ((window as unknown as { __energy0: { soc: number } }).__energy0).soc);
  for (const r of rest) {
    // charge used within 1 %, winding temperature within 0.05 K, belt travel within 2 cm
    expect(Math.abs(1 - (s0 - r.soc) / (s0 - ref.soc)), JSON.stringify(results)).toBeLessThan(0.01);
    expect(Math.abs(r.temp - ref.temp), JSON.stringify(results)).toBeLessThan(0.05);
    expect(Math.abs(r.belt - ref.belt), JSON.stringify(results)).toBeLessThan(0.02);
  }
  expect(errors).toEqual([]);
});
