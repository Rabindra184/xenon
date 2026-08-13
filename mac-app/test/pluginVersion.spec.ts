import { describe, expect, it } from 'vitest';
import type { ServerStatus } from '../src/shared/types';
import {
  pluginVersionLabel,
  statusInvalidatesPluginVersion,
} from '../src/renderer/src/pluginVersion';

describe('pluginVersionLabel', () => {
  it('shows the version once it has been read', () => {
    expect(pluginVersionLabel('1.20.0')).to.equal('1.20.0');
  });

  it('says nothing is installed when the read came back empty', () => {
    expect(pluginVersionLabel(null)).to.equal('not installed');
  });

  it('shows a placeholder until the first read lands', () => {
    expect(pluginVersionLabel(undefined)).to.equal('…');
  });

  // The bug this replaced: `installed ?? meta.pluginVersion` named the version
  // baked into the app bundle at build time whenever the live read was empty,
  // so a machine with no plugin installed read `plugin 1.11.2`.
  it('never substitutes a version for one it does not have', () => {
    expect(pluginVersionLabel(null)).to.not.match(/\d+\.\d+\.\d+/);
    expect(pluginVersionLabel(undefined)).to.not.match(/\d+\.\d+\.\d+/);
  });
});

describe('statusInvalidatesPluginVersion', () => {
  it('re-reads on a start, so the footer agrees with the banner that launch printed', () => {
    expect(statusInvalidatesPluginVersion('running')).to.equal(true);
  });

  // Nothing else touches node_modules, and re-reading on them would be noise.
  it('does not re-read on any status that leaves the plugin on disk alone', () => {
    const others: ServerStatus[] = ['stopped', 'starting', 'stopping', 'crashed'];
    for (const s of others) expect(statusInvalidatesPluginVersion(s), s).to.equal(false);
  });
});
