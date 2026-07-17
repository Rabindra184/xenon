import 'reflect-metadata';
import { expect } from 'chai';
import { buildRecordArgs } from '../../src/services/VideoPipelineService';

/**
 * Guards the F7 fix: the single-device recorder must stamp MJPEG frames with
 * wall-clock arrival time so the mp4 duration tracks real elapsed time, rather
 * than assuming a fixed 25fps (verified live: a 15s capture produced 7.48s
 * before this flag and 14.84s after).
 */
describe('VideoPipelineService.buildRecordArgs — F7 wall-clock timing', () => {
  const base = { mjpegUrl: 'http://127.0.0.1:9101', outputPath: '/tmp/rec/out.mp4' };

  it('stamps frames with wall-clock time, positioned before the input', () => {
    const args = buildRecordArgs({ ...base, isMac: true });
    const wallIdx = args.indexOf('-use_wallclock_as_timestamps');
    const inputIdx = args.indexOf('-i');
    expect(wallIdx).to.be.greaterThan(-1);
    expect(args[wallIdx + 1]).to.equal('1');
    // Must precede -i to apply to that input.
    expect(wallIdx).to.be.lessThan(inputIdx);
  });

  it('keeps variable frame timing on output (-vsync vfr)', () => {
    const args = buildRecordArgs({ ...base, isMac: true });
    const vsyncIdx = args.indexOf('-vsync');
    expect(vsyncIdx).to.be.greaterThan(-1);
    expect(args[vsyncIdx + 1]).to.equal('vfr');
  });

  it('feeds the mjpeg source and writes the output path last', () => {
    const args = buildRecordArgs({ ...base, isMac: false });
    expect(args.indexOf('-f')).to.be.greaterThan(-1);
    expect(args[args.indexOf('-f') + 1]).to.equal('mjpeg');
    expect(args[args.indexOf('-i') + 1]).to.equal(base.mjpegUrl);
    expect(args[args.length - 1]).to.equal(base.outputPath);
  });

  it('uses VideoToolbox on mac and libx264 elsewhere', () => {
    expect(buildRecordArgs({ ...base, isMac: true })).to.include('h264_videotoolbox');
    expect(buildRecordArgs({ ...base, isMac: false })).to.include('libx264');
  });

  it('still emits fragmented-mp4 flags for instant playback / crash resiliency', () => {
    const args = buildRecordArgs({ ...base, isMac: true });
    const mv = args.indexOf('-movflags');
    expect(mv).to.be.greaterThan(-1);
    expect(args[mv + 1]).to.equal('frag_keyframe+empty_moov+default_base_moof');
  });
});
