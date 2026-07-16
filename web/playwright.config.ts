import { defineConfig } from '@playwright/test';

// Viewport guard: loads the dashboard against a running Xenon server and asserts
// no element escapes the viewport at any supported width (1280-1440).
// Device data is route-mocked, so this needs no attached hardware and no DB state.
export default defineConfig({
  testDir: './test/viewport',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'test/viewport/report' }]],
  use: {
    baseURL: process.env.XENON_BASE_URL || 'http://127.0.0.1:4723',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
