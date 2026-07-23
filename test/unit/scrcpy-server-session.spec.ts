import { expect } from 'chai';
import { buildScrcpyServerArgs, SCRCPY_DEVICE_JAR_PATH } from '../../src/device-managers/android/ScrcpyServerSession';

describe('buildScrcpyServerArgs', () => {
  it('builds the exact video-only app_process argv', () => {
    const argv = buildScrcpyServerArgs({ version: '3.3.4', jarDevicePath: SCRCPY_DEVICE_JAR_PATH, maxSize: 1560 });
    expect(argv).to.deep.equal([
      'shell',
      `CLASSPATH=${SCRCPY_DEVICE_JAR_PATH}`,
      'app_process',
      '/',
      'com.genymobile.scrcpy.Server',
      '3.3.4',
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
