import { test } from '@playwright/test';
import { advance, expect, go, lab, open, readouts, settle, watchErrors } from './helpers';


// Engineering behaviour, checked in the running app (the models themselves have unit tests).

test('walking: feet carry the weight, power and cost of transport are plausible', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, 'mode=simulate&lab=walk');
  await settle(page);
  await lab(page, { walking: true, gait: 'normal' });
  await advance(page, 30 * 6);
  const r = await readouts(page);
  expect(r.wWalking).toBe(true);
  // ground reaction ≈ weight on average; the battery supplies a few hundred watts
  expect(Number(r.batteryW)).toBeGreaterThan(150);
  expect(Number(r.batteryW)).toBeLessThan(1200);
  expect(Number(r.hottestC)).toBeLessThan(120);
  await lab(page, { walking: false });
  await advance(page, 30 * 4);
  expect((await readouts(page)).wWalking).toBe(false);
  expect(errors).toEqual([]);
});

test('balance: a 300 N push is caught (with a step) and the robot walks its feet back', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, 'mode=simulate&lab=balance');
  await settle(page);
  await lab(page, { pushForce: 300, pushDir: 'front' });
  await page.getByRole('button', { name: 'Apply push' }).click();
  await advance(page, 30 * 5);
  const r = await readouts(page);
  expect(String(r.outStrategies)).toContain('ankle');
  expect(r.outFailed).toBe('');
  await advance(page, 30 * 6);
  expect((await readouts(page)).balPhase).toBe('task');
  expect(errors).toEqual([]);
});

test('joint lab: the leg straightens with 5 kg at 30:1; with 20 kg an 8:1 reducer saturates short of straight', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, 'mode=simulate&lab=joint');
  await settle(page);
  await lab(page, { jointTarget: 0, jointPayload: 5, jointRatio: 30 });
  await advance(page, 30 * 4);
  let r = await readouts(page);
  expect(Math.abs(Number(r.jQ))).toBeLessThan(1.5);
  expect(r.jLimitedI).toBe(false);
  // with an 8 : 1 reducer and 20 kg, lifting from hanging stops where gravity's torque
  // (m·g·r·cos θ) meets the actuator's peak: well short of straight
  await lab(page, { jointRatio: 8, jointReducer: 'planetary', jointPayload: 20, jointSpeed: 30, jointTarget: 90 });
  await advance(page, 30 * 5);
  await lab(page, { jointTarget: 0 });
  await advance(page, 30 * 8);
  r = await readouts(page);
  expect(r.jLimitedI).toBe(true);
  expect(Number(r.jQ)).toBeGreaterThan(10);
  expect(errors).toEqual([]);
});

test('manipulation: the box is held; the wet bottle slips, is caught and held', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, 'mode=simulate&lab=manipulation');
  await settle(page, 400);
  await page.getByRole('button', { name: 'Pick up' }).click();
  await advance(page, 30 * 6);
  let r = await readouts(page);
  expect(r.mStage).toBe('hold');
  expect(Number(r.mNormal)).toBeGreaterThan(Number(r.mRequiredNow));
  await page.getByRole('button', { name: 'Put down' }).click();
  await advance(page, 30 * 5);
  await lab(page, { task: 'wet' });
  await advance(page, 10);
  await page.getByRole('button', { name: 'Pick up' }).click();
  await advance(page, 30 * 7);
  r = await readouts(page);
  expect(Number(r.mDetections)).toBeGreaterThan(0);
  expect(r.mStage).toBe('hold');
  expect(Number(r.mSlip)).toBeLessThan(30);
  expect(errors).toEqual([]);
});

test('the scene stays within its drawing budget', async ({ page }) => {
  await open(page);
  await go(page, { mode: 'explore', system: 'overview' });
  await settle(page);
  await advance(page, 2);
  await page.evaluate(() => (window as unknown as { __fabAdvance: (n: number, r: boolean) => void }).__fabAdvance(1, true));
  const stats = await page.evaluate(() => (window as unknown as { __fab: { stage: { stats: { calls: number; triangles: number } } } }).__fab.stage.stats);
  expect(stats.calls).toBeLessThan(700);
  expect(stats.triangles).toBeLessThan(2_500_000);
});
