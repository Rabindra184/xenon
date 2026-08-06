import { expect } from 'chai';
import * as path from 'path';
import { resolveFfmpegPath } from '../../src/helpers/ffmpegPath';

describe('resolveFfmpegPath', () => {
  it('resolves the bundled @ffmpeg-installer binary, not a bare name', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const bundled = require('@ffmpeg-installer/ffmpeg').path as string;
    const resolved = resolveFfmpegPath();
    expect(resolved).to.equal(bundled);
    // Never a bare `ffmpeg` — that ENOENTs when the server is launched with no
    // inherited shell PATH (Mac-app launch).
    expect(resolved).to.not.equal('ffmpeg');
    expect(path.isAbsolute(resolved)).to.equal(true);
  });

  it('is cached / idempotent', () => {
    expect(resolveFfmpegPath()).to.equal(resolveFfmpegPath());
  });
});
