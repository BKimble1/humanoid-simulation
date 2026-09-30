import { test, type Page } from '@playwright/test';
import { advance, at, expect, go, lab, open, settle, watchErrors } from './helpers';

/**
 * The guided tour as a presentation: pause holds the whole demonstration still (in frame-stepped
 * time and over real elapsed time with the page's own requestAnimationFrame loop), resuming
 * continues from the same moment without catching up, chapters start from the same baseline
 * however they are reached, timed actions fire once per visit, pause survives navigation, and
 * leaving restores what the visitor had.
 */

test.beforeEach(({}, info) => test.skip(info.project.name !== 'desktop', 'viewport-independent'));

type State = Record<string, unknown> & { tourT: number; config: string; source: string; soc: number; temps: number[]; camera: number[] };
type Tour = { index: number; t: number; paused: boolean; playing: boolean; visits: number; holdsPresentation: boolean; jump(i: number): void; toggle(): void; next(): void; prev(): void };
type W = { __fab: { tour: Tour }; __fabState: () => State; __fabTelemetry: { start(): void; events: { kind: string; detail?: string }[] }; __fabPerf: () => { frames: { frames: number } } };

const CH = { intro: 0, structure: 1, actuators: 2, inside: 3, power: 4, compute: 5, vision: 6, grip: 7, balance: 8, walk: 9, thermal: 10, limit: 11, end: 12 };

const state = (page: Page) => page.evaluate(() => (window as unknown as W).__fabState());
const tour = (page: Page) =>
  page.evaluate(() => {
    const t = (window as unknown as W).__fab.tour;
    return { index: t.index, t: t.t, paused: t.paused, playing: t.playing, visits: t.visits, holds: t.holdsPresentation };
  });
const jump = (page: Page, i: number) => page.evaluate((k) => (window as unknown as W).__fab.tour.jump(k), i);
const toggle = (page: Page) => page.evaluate(() => (window as unknown as W).__fab.tour.toggle());
const events = (page: Page) => page.evaluate(() => (window as unknown as W).__fabTelemetry.events.map((e) => `${e.kind}:${e.detail ?? ''}`));
const payload = (s: State) => (JSON.parse(s.config) as { payload: number }).payload;
/** The balance demonstration's result: which strategies caught the push, in how many steps. */
const outcome = (page: Page) =>
  page.evaluate(() => {
    const o = (window as unknown as { __fab: { balance: { outcome: { strategies: string[]; steps: number; failed: string | null } | null } } }).__fab.balance.outcome;
    return o ? { strategies: [...o.strategies], steps: o.steps, failed: o.failed } : null;
  });

test('paused in several chapters, nothing presented moves; play continues from the same moment without catching up', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, 'mode=explore&system=overview');
  await settle(page);
  await go(page, { mode: 'watch' });
  await advance(page, 30);
  // mid-demonstration: the actuator running its stride, the bottle in the hand, the push being
  // caught, walking on the belt, the squats heating the joints, the limits being analysed
  for (const [ch, into] of [
    [CH.inside, 150],
    [CH.grip, 160],
    [CH.balance, 100],
    [CH.walk, 150],
    [CH.thermal, 120],
    [CH.limit, 120],
  ]) {
    await jump(page, ch);
    await advance(page, into);
    await toggle(page);
    expect((await tour(page)).holds, `chapter ${ch}: the pause holds at once`).toBe(true);
    const a = await state(page);
    await advance(page, 90);
    const b = await state(page);
    expect(b, `chapter ${ch}: nothing presented changed in 3 s of pause`).toEqual(a);
    await toggle(page);
    await advance(page, 1);
    const c = await state(page);
    expect(c.tourT - a.tourT, `chapter ${ch}: one frame later, one frame on`).toBeCloseTo(1 / 30, 5);
  }
  expect(errors).toEqual([]);
});

test('pause holds over real elapsed time with the page running its own frames, and play does not catch up', async ({ page }) => {
  const errors = watchErrors(page);
  // real time: the page's requestAnimationFrame loop, not the frame-stepped clock
  await page.goto(at('/?quality=low&hooks=1&mode=explore&system=overview'));
  await page.waitForFunction(() => !!(window as unknown as { __fab?: unknown }).__fab && (window as unknown as { __fabStores: { useApp: { getState: () => { ready: boolean } } } }).__fabStores.useApp.getState().ready, undefined, { timeout: 180_000 });
  await go(page, { mode: 'watch' });
  await page.waitForTimeout(500);
  await jump(page, CH.walk);
  await page.waitForTimeout(3000);
  await toggle(page);
  await expect.poll(async () => (await tour(page)).holds).toBe(true);
  await page.evaluate(() => (window as unknown as { __fabPerfReset: () => void }).__fabPerfReset());
  const a = await state(page);
  const t0 = Date.now();
  await page.waitForTimeout(4000);
  const b = await state(page);
  const frames1 = await page.evaluate(() => (window as unknown as W).__fabPerf().frames.frames);
  // (a handful at least: a software renderer on a busy machine draws a frame or two a second)
  expect(frames1, 'the page kept drawing frames while paused').toBeGreaterThanOrEqual(3);
  expect(b, `nothing presented changed in ${((Date.now() - t0) / 1000).toFixed(1)} s of real time`).toEqual(a);
  // play: the tour clock moves on by no more than the real time since, from where it was
  const r0 = Date.now();
  await toggle(page);
  await page.waitForTimeout(1200);
  const c = await tour(page);
  const elapsed = (Date.now() - r0) / 1000;
  expect(c.index).toBe(CH.walk);
  expect(c.t - a.tourT, 'the clock moved on').toBeGreaterThan(0.05);
  expect(c.t - a.tourT, `no catching up (${elapsed.toFixed(2)} s real)`).toBeLessThanOrEqual(elapsed + 0.1);
  expect(errors).toEqual([]);
});

test('navigating after the 30 kg chapter: every chapter starts from its baseline, timed actions fire once, pause survives, leaving restores the visitor', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, 'mode=engineer');
  await settle(page);
  // the visitor's own choices before the tour
  await page.evaluate(() => (window as unknown as { __fabStores: { useApp: { getState: () => { setConfig: (p: object) => void } } } }).__fabStores.useApp.getState().setConfig({ payload: 5 }));
  await lab(page, { gait: 'fast', task: 'tool', balanceTask: 'oneFoot' });
  await go(page, { actuator: 'hip' });
  await advance(page, 30);
  const mine = await page.evaluate(() => {
    const s = (window as unknown as { __fabStores: { useApp: { getState: () => { config: unknown; actuator: string } }; useLab: { getState: () => Record<string, unknown> } } }).__fabStores;
    const { set: _s, ...l } = s.useLab.getState();
    void _s;
    return { config: JSON.stringify(s.useApp.getState().config), actuator: s.useApp.getState().actuator, lab: JSON.stringify(l) };
  });
  await page.evaluate(() => (window as unknown as W).__fabTelemetry.start());
  await go(page, { mode: 'watch' });
  await advance(page, 30);
  expect(payload(await state(page)), 'the tour starts from the default design').toBe(0);

  // in order through Grasp and Balance: each timed action once
  await jump(page, CH.grip);
  await advance(page, 18 * 30 + 10);
  const entered = await tour(page);
  expect(entered.index).toBe(CH.balance);
  await advance(page, Math.round((6 - entered.t) * 30));
  const inOrder = { ...(await state(page)), outcome: await outcome(page) };
  expect(inOrder.outcome, 'the push has been caught 6 s into the chapter').not.toBeNull();

  // the 30 kg chapter, then back with the Previous button (restart, then the chapter before)
  await jump(page, CH.limit);
  await advance(page, 90);
  expect(payload(await state(page))).toBe(30);
  await page.getByRole('button', { name: 'Previous chapter' }).click();
  expect((await tour(page)).index, 'Previous after 2 s restarts the chapter').toBe(CH.limit);
  await page.getByRole('button', { name: 'Previous chapter' }).click();
  expect((await tour(page)).index).toBe(CH.thermal);
  await advance(page, 2);
  expect(payload(await state(page)), 'Heat after the 30 kg chapter has the default design').toBe(0);
  await page.getByRole('button', { name: 'Next chapter' }).click();
  await advance(page, 2);
  expect(payload(await state(page))).toBe(30);
  await page.getByRole('button', { name: 'Next chapter' }).click();
  await advance(page, 2);
  expect(payload(await state(page)), 'the last chapter has the default design').toBe(0);

  // Balance again, reached by jumping back from the end: the same starting point and the same push
  await jump(page, CH.balance);
  await advance(page, 6 * 30);
  const jumped = { ...(await state(page)), outcome: await outcome(page) };
  expect(jumped.config).toBe(inOrder.config);
  expect(Math.abs(jumped.soc - inOrder.soc), 'the same charge (from the tour baseline)').toBeLessThan(2e-4);
  // the temperatures start from the same baseline; the robot's entry into the chapter blends
  // from what was shown (an arm lowering a bottle, or standing), which loads the joints
  // differently for about a second, and a winding answers within seconds: tenths of a kelvin
  for (const [k, v] of jumped.temps.entries()) expect(Math.abs(v - inOrder.temps[k]), 'temperatures from the same baseline').toBeLessThan(0.5);
  // the demonstration itself is the same: the same push, caught the same way
  expect(jumped.outcome, 'the same recovery').toEqual(inOrder.outcome);
  const ev = await events(page);
  const actions = ev.filter((e) => e.startsWith('tour-action:'));
  expect(actions.filter((e) => e === 'tour-action:grip#0'), 'the pick fired once').toHaveLength(1);
  expect(actions.filter((e) => e === 'tour-action:grip#1'), 'the place fired once').toHaveLength(1);
  expect(actions.filter((e) => e === 'tour-action:balance#0'), 'the push fired once per visit (two visits)').toHaveLength(2);

  // pause, then navigate: still paused; the new chapter settles its framing and then holds
  await toggle(page);
  await page.getByRole('button', { name: 'Next chapter' }).click();
  let tt = await tour(page);
  expect(tt.index).toBe(CH.walk);
  expect(tt.paused, 'navigation keeps the pause').toBe(true);
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await advance(page, 90);
  tt = await tour(page);
  expect(tt.holds, 'settled, then held').toBe(true);
  const h1 = await state(page);
  await advance(page, 60);
  expect(await state(page)).toEqual(h1);
  expect(h1.tourT, 'the chapter has not started playing').toBe(0);

  // leaving restores the visitor's design, lab settings and actuator
  await page.getByRole('button', { name: 'Leave the tour' }).click();
  await advance(page, 30);
  const back = await page.evaluate(() => {
    const s = (window as unknown as { __fabStores: { useApp: { getState: () => { config: unknown; actuator: string; mode: string } }; useLab: { getState: () => Record<string, unknown> } } }).__fabStores;
    const { set: _s, ...l } = s.useLab.getState();
    void _s;
    return { config: JSON.stringify(s.useApp.getState().config), actuator: s.useApp.getState().actuator, lab: JSON.stringify(l), mode: s.useApp.getState().mode };
  });
  expect(back.mode).toBe('explore');
  expect(back.config).toBe(mine.config);
  expect(back.actuator).toBe(mine.actuator);
  expect(back.lab).toBe(mine.lab);
  expect(errors).toEqual([]);
});
