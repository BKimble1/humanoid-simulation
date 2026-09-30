import { defineConfig } from '@playwright/test';

/**
 * End-to-end checks against the production build (vite preview). WebGL runs on SwiftShader, so
 * the suite also runs on machines without a GPU; frames are stepped on the app's own clock
 * (?virt=1), so results do not depend on how fast the machine renders.
 *
 * Inside FAB / ONE the same checks run against the whole site with the app at its route:
 * SITE_URL is the site's server and SIM_PATH the route (e2e/helpers.ts). The site's
 * `npm run e2e:humanoid` builds the site, serves it as Netlify does and sets both.
 */
const SITE_URL = process.env.SITE_URL;

export default defineConfig({
  testDir: 'e2e',
  timeout: 600_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: SITE_URL ?? 'http://127.0.0.1:4174',
    trace: 'retain-on-failure',
    launchOptions: {
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
    },
  },
  webServer: SITE_URL
    ? undefined
    : {
        command: 'npm run build && npm run preview -- --port 4174 --strictPort',
        url: 'http://127.0.0.1:4174',
        reuseExistingServer: true,
        timeout: 600_000,
      },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'laptop', use: { viewport: { width: 1280, height: 720 } } },
    { name: 'tablet', use: { viewport: { width: 820, height: 1180 }, hasTouch: true } },
    { name: 'phone', use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } },
  ],
});
