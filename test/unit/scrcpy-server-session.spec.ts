import { expect } from 'chai';
import { buildScrcpyServerArgs, SCRCPY_DEVICE_JAR_PATH, scrcpyMaxSizeFromDims, parseAdbForwardPort } from '../../src/device-managers/android/ScrcpyServerSession';

describe('buildScrcpyServerArgs', () => {
  it('builds the exact video-only app_process argv', () => {
    const argv = buildScrcpyServerArgs({ version: '2.7', jarDevicePath: SCRCPY_DEVICE_JAR_PATH, maxSize: 1560 });
    expect(argv).to.deep.equal([
      'shell',
      `CLASSPATH=${SCRCPY_DEVICE_JAR_PATH}`,
      'app_process',
      '/',
      'com.genymobile.scrcpy.Server',
      '2.7',
      'tunnel_forward=true',
      'audio=false',
      'control=false',
      'video=true',
      'video_codec=h264',
      'max_size=1560',
      'video_bit_rate=4000000',
      'max_fps=30',
      'send_device_meta=false',
      'send_codec_meta=false',
      'send_frame_meta=false',
      'send_dummy_byte=true',
      'cleanup=true',
    ]);
  });
});

describe('scrcpyMaxSizeFromDims', () => {
  it('caps the LONGER edge so the shorter edge lands near the target', () => {
    // 1080x2340: short=1080 → scale 720/1080; long=2340*0.6667 ≈ 1560
    expect(scrcpyMaxSizeFromDims(1080, 2340)).to.equal(1560);
  });
  it('is orientation-agnostic (landscape same result)', () => {
    expect(scrcpyMaxSizeFromDims(2340, 1080)).to.equal(1560);
  });
  it('never upscales when the short edge is already below target', () => {
    expect(scrcpyMaxSizeFromDims(480, 800)).to.equal(800);
  });
  it('returns safe default (1440) for non-finite or non-positive dimensions', () => {
    expect(scrcpyMaxSizeFromDims(NaN, 800)).to.equal(1440);
    expect(scrcpyMaxSizeFromDims(0, 800)).to.equal(1440);
    expect(scrcpyMaxSizeFromDims(-100, 800)).to.equal(1440);
  });
});

describe('parseAdbForwardPort', () => {
  it('reads the assigned port from `adb forward tcp:0` output', () => {
    expect(parseAdbForwardPort('41337\n')).to.equal(41337);
  });
  it('throws on non-numeric output', () => {
    expect(() => parseAdbForwardPort('error: device offline')).to.throw();
  });
  it('throws on zero or negative port numbers', () => {
    expect(() => parseAdbForwardPort('0')).to.throw();
    expect(() => parseAdbForwardPort('-1')).to.throw();
  });
});
