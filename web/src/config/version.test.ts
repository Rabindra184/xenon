import { describe, it, expect } from 'vitest';
import pluginPkg from '../../../package.json';

describe('__XENON_VERSION__', () => {
  // Guards the define in vite.config.ts: it once read web/package.json,
  // which is never bumped, so the header showed v0.3.0 on every release.
  it('is the plugin version from the root package.json', () => {
    expect(__XENON_VERSION__).toBe(pluginPkg.version);
  });
});
