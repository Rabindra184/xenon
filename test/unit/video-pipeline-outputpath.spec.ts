import 'reflect-metadata';
import { expect } from 'chai';
import * as path from 'path';
import { resolveOutputPath } from '../../src/services/VideoPipelineService';
import { config } from '../../src/config';

describe('VideoPipelineService.resolveOutputPath — additive outputPath option', () => {
  it('writes to the default sessionAssetsPath when outputPath is omitted (regression)', () => {
    const out = resolveOutputPath('sess-A');
    expect(out).to.equal(
      path.join(config.sessionAssetsPath, 'sess-A', 'video', 'sess-A.mp4'),
    );
  });

  it('honors outputPath when provided', () => {
    const custom = path.join(config.recordingsAssetsPath, 'rec-1', 'video', 'rec-1.mp4');
    expect(resolveOutputPath('rec-1', custom)).to.equal(custom);
  });

  it('default path is unchanged for any sessionId, no matter the underscore/hyphen mix', () => {
    expect(resolveOutputPath('abc-123_xyz')).to.equal(
      path.join(config.sessionAssetsPath, 'abc-123_xyz', 'video', 'abc-123_xyz.mp4'),
    );
  });
});
