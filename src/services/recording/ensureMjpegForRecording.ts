import { Container } from 'typedi';
import { DeviceStoreFactory } from '../../data-service/device-store';
import log from '../../logger';

const ensureLog = log.scope('EnsureMjpegForRecording');

/**
 * Recording always consumes the local MJPEG HTTP server (ffmpeg `-f mjpeg -i
 * http://127.0.0.1:<port>`). Android live preview may instead be on the H.264
 * path (`streaming.androidH264`), which never starts that MJPEG server — so
 * Record / Record All would spawn ffmpeg against a missing or stale port and
 * produce empty / unplayable mp4s.
 *
 * Call this before spawning ffmpeg: stop H.264 if active, start (or reuse) the
 * platform MJPEG stream, and return the live loopback port.
 */
export async function ensureMjpegForRecording(udid: string): Promise<number> {
  const device = await DeviceStoreFactory.getStore().findDevice({ udid });
  if (!device) {
    throw new Error(`Device ${udid} not found`);
  }

  const platform = String(device.platform ?? '').toLowerCase();
  const isAndroid =
    platform === 'android' || platform === 'androidtv' || platform === 'android-tv';
  const isIOS = platform === 'ios' || platform === 'tvos';

  if (isAndroid) {
    try {
      const { default: AndroidH264StreamService } = await import(
        '../../device-managers/android/AndroidH264StreamService'
      );
      const h264 = Container.get(AndroidH264StreamService);
      if (h264.getMultiplexer(udid)) {
        ensureLog.info(`[${udid}] Stopping H.264 preview so MJPEG can feed recording`);
        await h264.stop(udid);
      }
    } catch (err: any) {
      ensureLog.debug(`[${udid}] H.264 stop skipped: ${err?.message ?? err}`);
    }

    const { default: AndroidStreamService } = await import(
      '../../device-managers/android/AndroidStreamService'
    );
    const { mjpegPort } = await Container.get(AndroidStreamService).startStream(udid);
    return mjpegPort;
  }

  if (isIOS) {
    const { default: IOSStreamService } = await import(
      '../../device-managers/ios/IOSStreamService'
    );
    const { mjpegPort } = await Container.get(IOSStreamService).startStream(udid);
    return mjpegPort;
  }

  // Unknown platform: fall back to whatever the device row already has.
  if (device.mjpegServerPort) {
    return device.mjpegServerPort;
  }
  throw new Error(
    `Cannot resolve MJPEG port for ${udid} (platform=${device.platform ?? 'unknown'})`,
  );
}
