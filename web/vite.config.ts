/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import pkg from './package.json';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/xenon/',
  build: {
    outDir: 'build',
  },
  server: {
    port: 3000,
    open: true,
  },
  define: {
    __XENON_VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    css: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', 'build', 'src/App.test.tsx'],
  },
});
