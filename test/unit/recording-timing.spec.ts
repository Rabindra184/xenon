import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  markShiftMs,
  readRecordingTiming,
  recordingTimingPath,
  shiftAnnotations,
  writeRecordingTiming,
} from '../../src/services/recording/recordingTiming';

describe('recording timing', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-timing-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const video = () => path.join(dir, 'rec-1', 'video', 'rec-1.mp4');

  it('lives in the recording directory, so cleanup removes it with the video', () => {
    expect(recordingTimingPath('/r/rec-1/video/rec-1.mp4')).to.equal('/r/rec-1/timing.json');
  });

  it('round-trips, and reads nothing when the file is missing or corrupt', () => {
    expect(readRecordingTiming(video())).to.equal(undefined);
    writeRecordingTiming(video(), { spawnedAtMs: 1000, groupT0Ms: 2200 });
    expect(readRecordingTiming(video())).to.deep.equal({
      version: 1,
      spawnedAtMs: 1000,
      groupT0Ms: 2200,
    });
    fs.writeFileSync(recordingTimingPath(video()), '{"version":1,"spawnedAtMs":"x"}');
    expect(readRecordingTiming(video())).to.equal(undefined);
  });

  // The dashboard stamps t=0 when start() returns; a device's video starts
  // when its ffmpeg spawns. A mark at timecode T is at T + (t0 - spawn) in it.
  it('shifts by how long before t=0 the video started', () => {
    expect(markShiftMs({ version: 1, spawnedAtMs: 1000, groupT0Ms: 2200 })).to.equal(1200);
  });

  it('shifts backwards for a device added after t=0', () => {
    expect(markShiftMs({ version: 1, spawnedAtMs: 9000, groupT0Ms: 2200 })).to.equal(-6800);
  });

  it('does not shift without timing, or with a clearly corrupt one', () => {
    expect(markShiftMs(undefined)).to.equal(0);
    expect(markShiftMs({ version: 1, spawnedAtMs: 0, groupT0Ms: 10 * 60 * 1000 })).to.equal(0);
  });

  it('moves start and end, and keeps an open mark open', () => {
    const out = shiftAnnotations(
      [
        { shape: 'RECT', geometry: '{}', timecode_ms: 1000, end_timecode_ms: 3000 },
        { shape: 'RECT', geometry: '{}', timecode_ms: 500, end_timecode_ms: null },
      ],
      1200,
    );
    expect(out.map((a) => [a.timecode_ms, a.end_timecode_ms])).to.deep.equal([
      [2200, 4200],
      [1700, null],
    ]);
  });

  it('returns the same marks when there is nothing to shift', () => {
    const anns = [{ shape: 'RECT', geometry: '{}', timecode_ms: 1000 }];
    expect(shiftAnnotations(anns, 0)).to.equal(anns);
  });
});
