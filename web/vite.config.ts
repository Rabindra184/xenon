/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// The plugin's package.json, not web/'s. web/package.json is a private
// workspace manifest that is never bumped (it read 0.3.0 while the plugin
// was 1.20.5); the root one is what every release bumps and publishes.
import pluginPkg from '../package.json';

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
    __XENON_VERSION__: JSON.stringify(pluginPkg.version),
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    css: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', 'build', 'src/App.test.tsx'],
    server: {
      deps: {
        inline: [/@radix-ui\/.*/],
      },
    },
  },
});
