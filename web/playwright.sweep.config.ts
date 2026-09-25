import { defineConfig } from '@playwright/test';

// Control sweep (test/sweep): clicks every control on every page against a
// running Xenon server and fails on any that does nothing. Writes are stubbed
// and devices mocked, so it changes nothing. About 20 minutes; run it before a
// release rather than on every change. See the header of controls.spec.ts.
export default defineConfig({
  testDir: './test/sweep',
  fullyParallel: true,
  workers: 4,
  retries: 0,
  timeout: 20 * 60_000,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'test/sweep/report' }]],
  use: {
    baseURL: process.env.XENON_BASE_URL || 'http://127.0.0.1:4723',
    screenshot: 'only-on-failure',
  },
});
