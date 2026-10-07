import { describe, expect, it } from 'vitest';
import type { ServerStatus } from '../src/shared/types';
import { pluginVersionLine, statusInvalidatesPluginVersion } from '../src/renderer/src/pluginVersion';

describe('pluginVersionLine', () => {
  it('says which Xenon is installed once it has been read', () => {
    expect(pluginVersionLine('1.20.0')).to.equal('Xenon 1.20.0 is installed');
  });

  it('says Xenon is not installed when the read came back empty', () => {
    expect(pluginVersionLine(null)).to.equal('Xenon isn’t installed yet');
  });

  it('says nothing until the first read lands', () => {
    expect(pluginVersionLine(undefined)).to.equal(null);
  });

  // The bug this replaced: `installed ?? meta.pluginVersion` named the version
  // baked into the app bundle at build time whenever the live read was empty,
  // so a machine with no plugin installed read `plugin 1.11.2`.
  it('never substitutes a version for one it does not have', () => {
    expect(pluginVersionLine(null)).to.not.match(/\d+\.\d+\.\d+/);
    expect(pluginVersionLine(undefined)).to.equal(null);
  });
});

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
