import { expect, type Page } from '@playwright/test';

/**
 * Where the app is: the server's root on its own, or its route inside FAB / ONE (SIM_PATH,
 * e.g. /humanoid, set by the site's `npm run e2e:humanoid`).
 */
export const APP_PATH = (process.env.SIM_PATH ?? '').replace(/\/+$/, '');
export const at = (path: string): string => (APP_PATH ? APP_PATH + path.replace(/^\/(?=\?|$)/, '') : path);

/** Uncaught errors and console errors for the whole test. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  return errors;
}

type Win = {
  __fab: {
    sceneId: string;
    director: { moving: boolean };
    stage: { stats: { calls: number; triangles: number }; renderer: { domElement: HTMLCanvasElement } };
    ch: { busy: boolean };
    body: { com: { x: number; y: number; z: number } };
  };
  __fabAdvance: (n: number, render?: boolean) => void;
  __fabStores: { useApp: { getState: () => Record<string, unknown> & { go: (p: object) => void; set: (p: object) => void; setConfig: (p: object) => void } }; useLab: { getState: () => Record<string, unknown> & { set: (p: object) => void } } };
};

/** Open the app (frame-stepped) and wait until it is ready. */
export async function open(page: Page, query = ''): Promise<void> {
  await page.goto(at(`/?virt=1&quality=low${query ? '&' + query : ''}`));
  await page.waitForFunction(() => {
    const w = window as unknown as Win;
    return !!w.__fabAdvance && (w.__fabStores?.useApp.getState().ready as boolean);
  }, undefined, { timeout: 180_000 });
}

/** Advance n frames of 1/30 s (drawing only the last one). */
export async function advance(page: Page, n: number): Promise<void> {
  await page.evaluate((k) => (window as unknown as Win).__fabAdvance(k, false), n);
}

/** Advance until the camera and every scene channel have arrived (at most `max` frames). */
export async function settle(page: Page, max = 300): Promise<number> {
  let n = 0;
  for (; n < max; n += 10) {
    const done = await page.evaluate(() => {
      const w = (window as unknown as Win).__fab;
      return !w.director.moving && !w.ch.busy;
    });
    if (done && n > 0) break;
    await advance(page, 10);
  }
  await advance(page, 2);
  return n;
}

export async function go(page: Page, p: object): Promise<void> {
  await page.evaluate((x) => (window as unknown as Win).__fabStores.useApp.getState().go(x), p);
}

export async function lab(page: Page, p: object): Promise<void> {
  await page.evaluate((x) => (window as unknown as Win).__fabStores.useLab.getState().set(x), p);
}

export async function readouts(page: Page): Promise<Record<string, number | string | boolean>> {
  return page.evaluate(() => (window as unknown as Win).__fabStores.useApp.getState().readouts as Record<string, number | string | boolean>);
}

export async function scene(page: Page): Promise<string> {
  return page.evaluate(() => (window as unknown as Win).__fab.sceneId);
}

/** Luminance statistics of what was drawn last (read back in the same task after a frame). */
export async function picture(page: Page): Promise<{ std: number; mean: number; grid: number[] }> {
  return page.evaluate(() => {
    const w = window as unknown as Win;
    w.__fabAdvance(1, true);
    const c = w.__fab.stage.renderer.domElement;
    const g = c.getContext('webgl2')!;
    const W = g.drawingBufferWidth;
    const H = g.drawingBufferHeight;
    const px = new Uint8Array(W * H * 4);
    g.readPixels(0, 0, W, H, g.RGBA, g.UNSIGNED_BYTE, px);
    const N = 12;
    const grid = new Array(N * N).fill(0);
    const cnt = new Array(N * N).fill(0);
    let s = 0;
    let s2 = 0;
    let n = 0;
    for (let y = 0; y < H; y += 3)
      for (let x = 0; x < W; x += 3) {
        const i = (y * W + x) * 4;
        const l = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
        s += l;
        s2 += l * l;
        n++;
        const k = Math.min(N - 1, Math.floor((y / H) * N)) * N + Math.min(N - 1, Math.floor((x / W) * N));
        grid[k] += l;
        cnt[k]++;
      }
    const mean = s / n;
    return { std: Math.sqrt(Math.max(0, s2 / n - mean * mean)), mean, grid: grid.map((v, i) => v / Math.max(1, cnt[i])) };
  });
}

export const change = (a: { grid: number[] }, b: { grid: number[] }) => a.grid.reduce((s, v, i) => s + Math.abs(v - b.grid[i]), 0) / a.grid.length;

export function isPhone(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1440) < 760;
}

export { expect };
