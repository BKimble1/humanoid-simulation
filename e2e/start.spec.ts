import { advance, at, change, expect, isPhone, open, picture, scene, watchErrors } from './helpers';
import { test } from '@playwright/test';

test('the opening loads, draws the robot in the lab, and is alive', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page);
  // the loading veil goes, the title and the three ways in are there
  await expect(page.locator('.veil')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'HUMANOID' })).toBeVisible();
  for (const name of ['EXPLORE', 'ENGINEER', 'SIMULATE']) await expect(page.locator('.cta', { hasText: name })).toBeVisible();
  await expect(page.locator('.intro__watch')).toBeVisible();
  expect(await scene(page)).toBe('intro');
  // a real picture, not a blank or uniform canvas
  await advance(page, 30);
  const a = await picture(page);
  expect(a.std).toBeGreaterThan(12);
  expect(a.mean).toBeGreaterThan(8);
  // and it moves (idle motion and the slow camera drift), without jumping
  await advance(page, 60);
  const b = await picture(page);
  const d = change(a, b);
  expect(d).toBeGreaterThan(0.05);
  expect(d).toBeLessThan(25);
  expect(errors).toEqual([]);
});

test('the header links back to FAB / ONE only inside the site', async ({ page }) => {
  await open(page);
  const back = page.getByRole('link', { name: 'Back to FAB / ONE' });
  if (process.env.SIM_PATH) await expect(back).toHaveAttribute('href', '/');
  else await expect(back).toHaveCount(0);
});

test('deep links open a mode directly', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, 'mode=simulate&lab=walk');
  expect(await scene(page)).toBe('sim.walk');
  await expect(page.locator('#lab-title')).toHaveText('Walking');
  await page.goto(at('/?virt=1&quality=low&system=power'));
  await page.waitForFunction(() => (window as unknown as { __fab?: { sceneId: string } }).__fab?.sceneId === 'explore.power', undefined, { timeout: 120_000 });
  expect(errors).toEqual([]);
});

test('no horizontal scroll and the header fits', async ({ page }) => {
  await open(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  // header items do not overlap each other
  const boxes = await page.locator('.top .wordmark, .top .tabs, .top__right').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON() as DOMRect));
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const overlap = a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
      expect(overlap, `header items ${i} and ${j} overlap`).toBe(false);
    }
  if (isPhone(page)) await expect(page.locator('.tabs')).toBeVisible();
});
