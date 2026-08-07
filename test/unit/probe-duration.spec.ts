import { expect } from 'chai';
import {
  parseFfmpegHeaderDurationSec,
  parseFfmpegProgressDurationSec,
} from '../../src/services/recording/probeDuration';

// Issue #204. duration_ms was wall-clock — Date.now() minus started_at — and
// nothing ever consulted the file. It agreed with reality only while capture
// kept up. During the #200 cable-pull test a recording reported 335964ms
// against an mp4 that is 35.16s: a 9.5x overstatement that really measured how
// long it took someone to press Stop.
//
// The repo deliberately has no ffprobe dependency (it is not bundled, and a
// bare binary ENOENTs under the Mac-app launch), so duration comes out of
// ffmpeg's own output. These are the parsers for that output.

describe('parseFfmpegHeaderDurationSec', () => {
  it('reads the Duration line ffmpeg prints for a faststart mp4', () => {
    const stderr = [
      "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from '/tmp/video.mp4':",
      '  Duration: 00:00:35.16, start: 0.000000, bitrate: 201 kb/s',
      '  Stream #0:0(und): Video: h264 (avc1), yuv420p, 720x1480',
    ].join('\n');
    expect(parseFfmpegHeaderDurationSec(stderr)).to.be.closeTo(35.16, 0.001);
  });

  it('handles hours and minutes', () => {
    expect(parseFfmpegHeaderDurationSec('  Duration: 01:02:03.50, start: 0')).to.be.closeTo(
      3723.5,
      0.001,
    );
  });

  it('returns undefined for a fragmented mp4 whose header carries no duration', () => {
    // What a failed remux leaves behind — ffmpeg prints N/A.
    expect(parseFfmpegHeaderDurationSec('  Duration: N/A, start: 0.000000, bitrate: N/A')).to.equal(
      undefined,
    );
  });

  it('returns undefined for a zero duration rather than reporting 0', () => {
    // A zero-length file is not a real answer; the caller should fall back.
    expect(parseFfmpegHeaderDurationSec('  Duration: 00:00:00.00, start: 0')).to.equal(undefined);
  });

  it('returns undefined when ffmpeg printed nothing useful', () => {
    expect(parseFfmpegHeaderDurationSec('')).to.equal(undefined);
    expect(parseFfmpegHeaderDurationSec('No such file or directory')).to.equal(undefined);
  });
});

describe('parseFfmpegProgressDurationSec', () => {
  it('takes the LAST out_time_us, which is the end of the decode', () => {
    const stdout = ['out_time_us=1000000', 'out_time_us=20000000', 'out_time_us=35160000'].join(
      '\n',
    );
    expect(parseFfmpegProgressDurationSec(stdout)).to.be.closeTo(35.16, 0.001);
  });

  it('returns undefined when no progress was emitted', () => {
    expect(parseFfmpegProgressDurationSec('')).to.equal(undefined);
  });

  it('returns undefined for a zero-length decode', () => {
    expect(parseFfmpegProgressDurationSec('out_time_us=0')).to.equal(undefined);
  });
});
