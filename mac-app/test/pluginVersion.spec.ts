import { describe, expect, it } from 'vitest';
import type { ServerStatus } from '../src/shared/types';
import { statusInvalidatesPluginVersion } from '../src/renderer/src/pluginVersion';

describe('statusInvalidatesPluginVersion', () => {
  it('re-reads on a start, so Setup agrees with the banner that launch printed', () => {
    expect(statusInvalidatesPluginVersion('running')).to.equal(true);
  });

  // Nothing else touches node_modules, and re-reading on them would be noise.
  it('does not re-read on any status that leaves the plugin on disk alone', () => {
    const others: ServerStatus[] = ['stopped', 'starting', 'stopping', 'crashed'];
    for (const s of others) expect(statusInvalidatesPluginVersion(s), s).to.equal(false);
  });
});
