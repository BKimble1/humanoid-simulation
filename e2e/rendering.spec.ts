import { test } from '@playwright/test';
import { advance, at, expect, picture, watchErrors } from './helpers';

/**
 * Each rendering tier draws the robot (not a blank or black frame), with its own pipeline, and
 * the tiers agree on brightness: tone mapping is the same everywhere; low has no ambient
 * occlusion or vignette, so it is a few per cent brighter, never a different picture.
 */

test.beforeEach(({}, info) => test.skip(info.project.name !== 'desktop', 'one viewport is enough'));

test('high, medium and low draw the same scene with consistent brightness', async ({ page }) => {
  test.setTimeout(900_000);
  const errors = watchErrors(page);
  const seen: Record<string, { mean: number; std: number; tier: string; calls: number }> = {};
  for (const tier of ['high', 'medium', 'low']) {
    // (the shared open() forces the low tier; this page asks for each tier itself)
    await page.goto(at(`/?virt=1&quality=${tier}&mode=explore&system=overview`));
    await page.waitForFunction(() => {
      const w = window as unknown as { __fabAdvance?: unknown; __fabStores?: { useApp: { getState: () => { ready: boolean } } } };
      return !!w.__fabAdvance && !!w.__fabStores?.useApp.getState().ready;
    }, undefined, { timeout: 180_000 });
    await advance(page, 90);
    const p = await picture(page);
    const s = await page.evaluate(() => {
      const w = (window as unknown as { __fab: { stage: { currentTier: string; stats: { calls: number } } } }).__fab;
      return { tier: w.stage.currentTier, calls: w.stage.stats.calls };
    });
    seen[tier] = { mean: p.mean, std: p.std, ...s };
  }
  for (const [tier, s] of Object.entries(seen)) {
    expect(s.tier, 'the tier asked for').toBe(tier);
    expect(s.std, `${tier}: a picture, not a flat frame`).toBeGreaterThan(12);
    expect(s.mean, `${tier}: not black`).toBeGreaterThan(15);
    expect(s.calls, `${tier}: the scene was drawn`).toBeGreaterThan(20);
  }
  expect(Math.abs(seen.medium.mean / seen.high.mean - 1), JSON.stringify(seen)).toBeLessThan(0.03);
  expect(Math.abs(seen.low.mean / seen.high.mean - 1), JSON.stringify(seen)).toBeLessThan(0.1);
  expect(errors).toEqual([]);
});
