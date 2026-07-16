import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/renderer/src')
    }
  },
  test: {
    environment: 'node',
    // Unit tests only; Playwright drives the e2e suite under test/e2e.
    include: ['test/*.spec.ts'],
    exclude: ['test/e2e/**', 'node_modules/**']
  }
});
