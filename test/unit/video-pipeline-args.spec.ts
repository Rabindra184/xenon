import 'reflect-metadata';
import { expect } from 'chai';
import { buildRecordArgs, buildCompositeArgs } from '../../src/services/VideoPipelineService';

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

  it('keeps variable frame timing on output (-vsync vfr, kept for ffmpeg<5.1 compat)', () => {
    const args = buildRecordArgs({ ...base, isMac: true });
    const vsyncIdx = args.indexOf('-vsync');
    expect(vsyncIdx).to.be.greaterThan(-1);
    expect(args[vsyncIdx + 1]).to.equal('vfr');
    // `-fps_mode` is fatal on ffmpeg <5.1, so it must NOT be used here.
    expect(args).to.not.include('-fps_mode');
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

  it('does not force a constant output frame rate (-r/-framerate reintroduces the 2× bug)', () => {
    // Live on a real Samsung S9+ (source ~15.6fps) the wall-clock flags give a
    // 1.00× duration; pinning a fixed fps would restore the ~1.6–2× fast bug.
    const args = buildRecordArgs({ ...base, isMac: true });
    expect(args).to.not.include('-r');
    expect(args).to.not.include('-framerate');
  });
});

/**
 * Guards D1 on the multi-device mosaic path. The composite recorder stacks N
 * live MJPEG inputs into one mp4; each input must carry the same wall-clock
 * stamp as the single-device recorder, and the output must stay VFR, or the
 * composite replays fast just like the per-device file did before the fix.
 */
describe('VideoPipelineService.buildCompositeArgs — mosaic wall-clock timing', () => {
  const inputs = [
    { mjpegPort: 9101, udid: 'A' },
    { mjpegPort: 9102, udid: 'B' },
  ];
  const base = {
    inputs,
    filterGraph: '[0:v]scale=1[v0];[1:v]scale=1[v1];[v0][v1]hstack=inputs=2[v]',
    outputPath: '/tmp/rec/_groups/g1/composite.mp4',
    isMac: true,
  };
  const indicesOf = (args: string[], token: string) =>
    args.reduce<number[]>((acc, v, i) => (v === token ? [...acc, i] : acc), []);

  it('stamps every input with wall-clock time, each before that input’s -i', () => {
    const args = buildCompositeArgs(base);
    const wall = indicesOf(args, '-use_wallclock_as_timestamps');
    const inp = indicesOf(args, '-i');
    expect(wall.length).to.equal(inputs.length);
    expect(inp.length).to.equal(inputs.length);
    for (let k = 0; k < inputs.length; k++) {
      expect(args[wall[k] + 1]).to.equal('1');
      expect(wall[k]).to.be.lessThan(inp[k]); // stamp precedes its own input
    }
  });

  it('keeps variable frame timing on output (-vsync vfr, kept for ffmpeg<5.1 compat)', () => {
    const args = buildCompositeArgs(base);
    const vsyncIdx = args.indexOf('-vsync');
    expect(vsyncIdx).to.be.greaterThan(-1);
    expect(args[vsyncIdx + 1]).to.equal('vfr');
    // `-fps_mode` is fatal on ffmpeg <5.1, so the composite path must not use it either.
    expect(args).to.not.include('-fps_mode');
    expect(args).to.not.include('-r');
  });

  it('passes the filtergraph through verbatim and writes the output path last', () => {
    const args = buildCompositeArgs(base);
    const fc = args.indexOf('-filter_complex');
    expect(fc).to.be.greaterThan(-1);
    expect(args[fc + 1]).to.equal(base.filterGraph);
    expect(args[args.length - 1]).to.equal(base.outputPath);
  });

  it('scales with input count: N inputs → N mjpeg demuxers', () => {
    const three = buildCompositeArgs({
      ...base,
      inputs: [...inputs, { mjpegPort: 9103, udid: 'C' }],
    });
    expect(indicesOf(three, '-i').length).to.equal(3);
    expect(indicesOf(three, '-f').length).to.equal(3);
  });

  it('uses VideoToolbox on mac and libx264 elsewhere', () => {
    expect(buildCompositeArgs({ ...base, isMac: true })).to.include('h264_videotoolbox');
    expect(buildCompositeArgs({ ...base, isMac: false })).to.include('libx264');
  });
});
