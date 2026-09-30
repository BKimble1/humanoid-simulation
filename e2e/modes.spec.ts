import { test } from '@playwright/test';
import { advance, expect, go, isPhone, lab, open, readouts, scene, settle, watchErrors } from './helpers';

const SYSTEMS = ['overview', 'structure', 'actuators', 'hands', 'vision', 'balance', 'forces', 'power', 'compute', 'thermal'];
const LABS = ['joint', 'kinematics', 'balance', 'walk', 'manipulation', 'wholebody', 'limits'];

test('Explore: every subsystem, and an actuator opened and closed', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page);
  await page.locator('.cta', { hasText: 'EXPLORE' }).click();
  await settle(page);
  for (const s of SYSTEMS) {
    await go(page, { system: s });
    await settle(page);
    expect(await scene(page)).toBe(`explore.${s}`);
    await expect(page.locator('#sys-title')).toBeVisible();
  }
  await go(page, { system: 'actuators' });
  await settle(page);
  await page.getByRole('button', { name: 'Open the actuator' }).click();
  await settle(page, 400);
  expect(await scene(page)).toBe('explore.actuators.open');
  const r = await readouts(page);
  // motor speed = output speed × ratio (the live duty cycle through the actuator model)
  expect(Math.abs(Number(r.motorRpm) - Number(r.outRpm) * Number(r.ratio))).toBeLessThan(1);
  await page.getByRole('option', { name: 'Cycloidal discs' }).click();
  await advance(page, 20);
  await page.getByRole('button', { name: 'Close it up' }).click();
  await settle(page, 400);
  expect(await scene(page)).toBe('explore.actuators');
  expect(errors).toEqual([]);
});

test('Simulate: every lab opens and runs', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page);
  await page.locator('.cta', { hasText: 'SIMULATE' }).click();
  await settle(page);
  await expect(page.locator('#lab-title')).toHaveText('Seven labs');
  for (const l of LABS) {
    await go(page, { lab: l });
    await settle(page);
    expect(await scene(page)).toBe(`sim.${l}`);
    await advance(page, 30);
  }
  expect(errors).toEqual([]);
});

test('Engineer: a heavier payload is carried, analysed and reported against the limits', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page);
  await page.locator('.cta', { hasText: 'ENGINEER' }).click();
  await settle(page);
  await expect(page.getByText('WITHIN LIMITS')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('radio', { name: 'Payload' }).click();
  await page.getByRole('button', { name: '30 kg' }).click();
  // the analysis runs in a worker: wait for its report while the world keeps running
  await expect(page.locator('.callout--bad').first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.callout--bad .callout__title').first()).toContainText('LIMIT');
  await advance(page, 30);
  const r = await readouts(page);
  expect(Number(r.totalMass)).toBeGreaterThan(Number(r.mass) + 29);
  await page.getByRole('button', { name: 'Reset to the FO-H1 design' }).click();
  await expect(page.getByText('WITHIN LIMITS')).toBeVisible({ timeout: 60_000 });
  expect(errors).toEqual([]);
});

test('Watch: the tour plays, can be paused and left at any time', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page);
  await page.locator('.intro__watch').click();
  await expect(page.getByRole('region', { name: 'Guided tour' })).toBeVisible();
  await advance(page, 30 * 14);
  await expect(page.getByRole('region', { name: 'Guided tour' })).toContainText('02 /');
  await page.getByRole('button', { name: 'Next chapter' }).click();
  await page.getByRole('button', { name: 'Next chapter' }).click();
  await advance(page, 60);
  expect(await scene(page)).toBe('explore.actuators.open');
  await page.getByRole('button', { name: 'Pause' }).click();
  await page.getByRole('button', { name: 'Play' }).click();
  // leaving mid-transition puts the visitor in Explore with everything restored
  await page.getByRole('button', { name: 'Leave the tour' }).click();
  await settle(page, 400);
  expect(await scene(page)).toBe('explore.overview');
  await expect(page.getByRole('region', { name: 'Guided tour' })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('interrupting transitions in quick succession ends in a consistent state', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page);
  const steps = [
    { mode: 'explore', system: 'actuators' },
    { exploded: true },
    { system: 'power' },
    { mode: 'simulate', lab: 'walk' },
    { mode: 'explore', system: 'thermal' },
    { mode: 'simulate', lab: 'manipulation' },
    { mode: 'engineer' },
    { mode: 'explore', system: 'actuators', exploded: true },
  ];
  for (const s of steps) {
    await go(page, s);
    await advance(page, 7);
  }
  await lab(page, { walking: true });
  await settle(page, 500);
  expect(await scene(page)).toBe('explore.actuators.open');
  // the camera stays above the floor and below the ceiling throughout
  const cam = await page.evaluate(() => (window as unknown as { __fab: { stage: { camera: { position: { y: number } } } } }).__fab.stage.camera.position.y);
  expect(cam).toBeGreaterThan(0.1);
  expect(cam).toBeLessThan(4.3);
  expect(errors).toEqual([]);
});

test('the technical information opens and closes; overlays can be hidden', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page);
  await page.getByRole('button', { name: /About this simulation/ }).click();
  await expect(page.getByRole('dialog', { name: 'How FO-H1 is simulated' })).toBeVisible();
  await expect(page.getByText('Visual approximations')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await go(page, { mode: 'explore', system: 'overview' });
  await settle(page);
  const visibleLabels = () => page.locator('.lbl').evaluateAll((els) => els.filter((e) => Number((e as HTMLElement).style.opacity) > 0.05).length);
  expect(await visibleLabels()).toBeGreaterThan(2);
  await page.getByRole('button', { name: 'Hide overlays' }).click();
  await advance(page, 20);
  expect(await visibleLabels()).toBe(0);
  if (isPhone(page)) {
    await page.getByRole('button', { name: 'Collapse the panel' }).click();
    await expect(page.locator('.side--min')).toHaveCount(1);
  }
  expect(errors).toEqual([]);
});
