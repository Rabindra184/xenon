import { defineConfig } from '@playwright/test';

// Electron e2e: a single serial worker drives one real app instance. These
// tests launch the built app (out/) with an isolated user-data-dir so they
// never touch the developer's real profiles or Keychain secrets.
export default defineConfig({
  testDir: './test/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'test/e2e/report' }]],
  use: {
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  }
});
