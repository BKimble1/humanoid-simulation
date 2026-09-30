import { test, type Page } from '@playwright/test';
import { advance, expect, go, isPhone, lab, open, settle, watchErrors } from './helpers';

/**
 * The visitor's hands on the camera: drag to orbit (with a fling measured from the events'
 * own timestamps), a cancelled pointer (no fling), a two-finger pinch that zooms without
 * orbiting and hands back to one finger without a jump, dragging the IK target (the camera
 * stays put), Recenter (shown only when off the framing; it returns smoothly), and the framing
 * following the layout (orientation changes, the phone sheet collapsed and expanded). Pointer
 * events are dispatched on the canvas as the browser would send them.
 */

// input handling is the same at any viewport (the framing test sets its own): run once
test.beforeEach(({}, info) => test.skip(info.project.name !== 'desktop', 'viewport-independent'));

type Dir = { user: { az: number; el: number; zoom: number }; offFraming: boolean; moving: boolean; shot: { id: string } | null };
type W = { __fab: { director: Dir; stage: { camera: { position: { x: number; y: number; z: number } } }; reach: { target: { x: number; y: number; z: number } } } };

const user = (page: Page) => page.evaluate(() => ({ ...(window as unknown as W).__fab.director.user }));

/** Dispatch pointer events on the canvas: [type, id, x, y, pointerType], with increasing timestamps. */
async function pointers(page: Page, seq: [string, number, number, number, string?][], frameEvery = 0) {
  for (let i = 0; i < seq.length; i++) {
    const [type, id, x, y, kind] = seq[i];
    await page.evaluate(
      ({ type, id, x, y, kind }) => {
        const c = document.querySelector('canvas')!;
        const r = c.getBoundingClientRect();
        c.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: r.left + x, clientY: r.top + y, pointerType: kind ?? 'mouse', isPrimary: id === 1 || id === 11, button: 0, buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1, bubbles: true, cancelable: true }));
      },
      { type, id, x, y, kind },
    );
    if (frameEvery && i % frameEvery === 0) await advance(page, 1);
  }
}

test('drag orbits and flings; a cancelled pointer does not fling; Recenter appears only off the framing and returns smoothly', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, 'mode=explore&system=overview');
  await settle(page);
  await expect(page.getByRole('button', { name: 'Recenter the view' })).toHaveCount(0);
  // a drag to the left: the camera orbits
  const drag: [string, number, number, number][] = [['pointerdown', 1, 500, 400]];
  for (let k = 1; k <= 12; k++) drag.push(['pointermove', 1, 500 - k * 14, 400]);
  drag.push(['pointerup', 1, 500 - 12 * 14, 400]);
  await pointers(page, drag);
  const u1 = await user(page);
  expect(u1.az, 'orbited').toBeGreaterThan(0.5);
  await advance(page, 20);
  const u2 = await user(page);
  expect(u2.az, 'the fling carries on a little, then stops').toBeGreaterThanOrEqual(u1.az);
  await advance(page, 60);
  const u3 = await user(page);
  await advance(page, 30);
  expect((await user(page)).az, 'stopped').toBeCloseTo(u3.az, 3);
  await expect(page.getByRole('button', { name: 'Recenter the view' })).toBeVisible();

  // a cancelled pointer (the browser took the gesture): no fling
  const cancel: [string, number, number, number][] = [['pointerdown', 2, 500, 400]];
  for (let k = 1; k <= 8; k++) cancel.push(['pointermove', 2, 500 + k * 12, 400]);
  cancel.push(['pointercancel', 2, 500 + 8 * 12, 400]);
  await pointers(page, cancel);
  const c1 = await user(page);
  await advance(page, 30);
  expect((await user(page)).az, 'nothing carried on after the cancel').toBeCloseTo(c1.az, 4);

  // Recenter: back to the directed framing, smoothly (no step larger than a normal move)
  await page.evaluate(() => (window as unknown as { __fabTelemetry: { start(): void } }).__fabTelemetry.start());
  await page.getByRole('button', { name: 'Recenter the view' }).click();
  await advance(page, 60);
  const t = await page.evaluate(() => (window as unknown as { __fabTelemetry: { samples: { ca: number; cv: number }[] } }).__fabTelemetry.samples);
  expect(Math.max(...t.map((s) => s.ca)), 'camera acceleration while recentring').toBeLessThanOrEqual(15);
  const back = await user(page);
  expect(Math.abs(back.az) + Math.abs(back.el) + Math.abs(back.zoom - 1)).toBeLessThan(1e-6);
  await advance(page, 10);
  await expect(page.getByRole('button', { name: 'Recenter the view' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('two fingers pinch to zoom without orbiting; lifting one carries on orbiting from there, without a jump', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, 'mode=explore&system=overview');
  await settle(page);
  const u0 = await user(page);
  await pointers(page, [
    ['pointerdown', 11, 400, 400, 'touch'],
    ['pointerdown', 12, 520, 400, 'touch'],
    ['pointermove', 11, 380, 400, 'touch'],
    ['pointermove', 12, 540, 400, 'touch'],
    ['pointermove', 11, 350, 400, 'touch'],
    ['pointermove', 12, 570, 400, 'touch'],
  ]);
  const u1 = await user(page);
  expect(u1.zoom, 'spreading the fingers zooms in').toBeLessThan(0.7);
  expect(Math.abs(u1.az - u0.az), 'a pinch does not orbit').toBeLessThan(1e-9);
  // one finger lifts; the other moves on: an orbit by exactly its own movement
  await pointers(page, [
    ['pointerup', 12, 570, 400, 'touch'],
    ['pointermove', 11, 340, 400, 'touch'],
  ]);
  const u2 = await user(page);
  expect(u2.az - u1.az, 'the remaining finger orbits from where it is').toBeCloseTo(10 * 0.0055, 6);
  expect(u2.zoom).toBeCloseTo(u1.zoom, 9);
  await pointers(page, [['pointerup', 11, 340, 400, 'touch']]);
  await advance(page, 10);
  expect(errors).toEqual([]);
});

test('dragging the IK target moves the target, not the camera', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, 'mode=simulate&lab=kinematics');
  await lab(page, { ikMode: 'ik' });
  await settle(page);
  await advance(page, 20);
  // where the handle is on screen
  const h = await page.evaluate(() => {
    const w = (window as unknown as { __fab: { stage: { camera: import('three').Camera; renderer: { domElement: HTMLCanvasElement } }; reach: { target: import('three').Vector3 } } }).__fab;
    const p = w.reach.target.clone().project(w.stage.camera);
    const c = w.stage.renderer.domElement.getBoundingClientRect();
    return { x: ((p.x + 1) / 2) * c.width, y: ((1 - p.y) / 2) * c.height };
  });
  const u0 = await user(page);
  const t0 = await page.evaluate(() => ({ ...(window as unknown as W).__fab.reach.target }));
  const kind = isPhone(page) ? 'touch' : 'mouse';
  const seq: [string, number, number, number, string][] = [['pointerdown', 5, h.x, h.y, kind]];
  for (let k = 1; k <= 10; k++) seq.push(['pointermove', 5, h.x - k * 6, h.y - k * 4, kind]);
  seq.push(['pointerup', 5, h.x - 60, h.y - 40, kind]);
  await pointers(page, seq, 3);
  await advance(page, 20);
  const u1 = await user(page);
  const t1 = await page.evaluate(() => ({ ...(window as unknown as W).__fab.reach.target }));
  expect(Math.hypot(t1.x - t0.x, t1.y - t0.y, t1.z - t0.z), 'the target moved').toBeGreaterThan(0.03);
  expect(Math.abs(u1.az - u0.az) + Math.abs(u1.el - u0.el), 'the camera did not orbit').toBeLessThan(1e-9);
  expect(errors).toEqual([]);
});

test('the framing follows the layout: orientation changes and the phone sheet keep the subject in the free area', async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, 'mode=explore&system=overview');
  await settle(page);
  /** The robot's screen bounds (head to feet) against the area not covered by the header and panels. */
  const fit = () =>
    page.evaluate(() => {
      const w = (window as unknown as { __fab: { kin: { point(f: string, p: number[]): import('three').Vector3; soleCorners(s: 'L' | 'R'): import('three').Vector3[] }; stage: { camera: import('three').Camera } } }).__fab;
      const cam = w.stage.camera;
      const pts = [w.kin.point('neck', [0, 0.32, 0]), ...w.kin.soleCorners('L'), ...w.kin.soleCorners('R')];
      const c = document.querySelector('canvas')!.getBoundingClientRect();
      const sp = pts.map((p) => {
        const q = p.clone().project(cam);
        return { x: ((q.x + 1) / 2) * c.width, y: ((1 - q.y) / 2) * c.height };
      });
      const header = document.querySelector('header')?.getBoundingClientRect();
      const panel = Array.from(document.querySelectorAll('aside.side, .watchbar')).map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
      const top = header ? header.bottom : 0;
      const bottom = Math.min(c.height, ...panel.filter((r) => r.width > c.width * 0.6).map((r) => r.top));
      return { top: Math.min(...sp.map((p) => p.y)), bottom: Math.max(...sp.map((p) => p.y)), left: Math.min(...sp.map((p) => p.x)), right: Math.max(...sp.map((p) => p.x)), free: { top, bottom, width: c.width } };
    });
  const inside = (f: Awaited<ReturnType<typeof fit>>, what: string) => {
    expect(f.top, `${what}: head below the header`).toBeGreaterThanOrEqual(f.free.top - 2);
    expect(f.bottom, `${what}: feet above the panel`).toBeLessThanOrEqual(f.free.bottom + 2);
    expect(f.left, `${what}: on screen`).toBeGreaterThanOrEqual(0);
    expect(f.right, `${what}: on screen`).toBeLessThanOrEqual(f.free.width);
  };
  inside(await fit(), 'portrait');
  const tall = await fit();
  // the sheet collapsed: more room, the robot is framed larger
  await page.getByRole('button', { name: 'Collapse the panel' }).click();
  await advance(page, 60);
  const collapsed = await fit();
  inside(collapsed, 'sheet collapsed');
  expect(collapsed.bottom - collapsed.top, 'larger with the sheet collapsed').toBeGreaterThan((tall.bottom - tall.top) * 1.1);
  await page.getByRole('button', { name: 'Expand the panel' }).click();
  await advance(page, 60);
  inside(await fit(), 'sheet expanded again');
  // turned to landscape and back
  await page.setViewportSize({ width: 844, height: 390 });
  await advance(page, 60);
  const land = await fit();
  expect(Number.isFinite(land.top) && Number.isFinite(land.bottom)).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await advance(page, 60);
  inside(await fit(), 'portrait again');
  const cam = await page.evaluate(() => (window as unknown as W).__fab.stage.camera.position);
  expect([cam.x, cam.y, cam.z].every(Number.isFinite)).toBe(true);
  await go(page, { mode: 'explore', system: 'hands' });
  await settle(page);
  expect(errors).toEqual([]);
});

test('with reduced motion, camera moves are short and scene changes quick', async ({ page }) => {
  const errors = watchErrors(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await open(page, 'mode=explore&system=overview');
  await settle(page);
  await page.evaluate(() => (window as unknown as { __fabTelemetry: { start(): void } }).__fabTelemetry.start());
  await go(page, { mode: 'explore', system: 'hands' });
  await advance(page, 30);
  await go(page, { mode: 'explore', system: 'actuators', exploded: true });
  await advance(page, 60);
  await go(page, { mode: 'simulate', lab: 'walk', exploded: false });
  await advance(page, 60);
  const t = await page.evaluate(() => {
    const w = window as unknown as { __fabTelemetry: { events: { kind: string; detail?: string }[] }; __fab: { ch: { speed: number } } };
    return { moves: w.__fabTelemetry.events.filter((e) => e.kind === 'camera-move').map((e) => Number(e.detail!.split(' ')[1])), speed: w.__fab.ch.speed };
  });
  expect(t.moves.length).toBeGreaterThanOrEqual(3);
  expect(Math.max(...t.moves), 'camera moves at most 0.5 s').toBeLessThanOrEqual(0.5);
  expect(t.speed, 'channel changes about three times quicker').toBeLessThan(0.5);
  expect(errors).toEqual([]);
});
