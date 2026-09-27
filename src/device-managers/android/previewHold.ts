import { Container } from 'typedi';
import log from '../../logger';
import { DeviceStoreFactory } from '../../data-service/device-store';
import { unblockDevice } from '../../data-service/device-service';
import { isManualLock } from '../../services/recording/manualLock';
import { RecordingStore } from '../../services/recording/recording-store';

/** Who still uses a device whose preview stream is stopping. */
export interface PreviewHoldUse {
  /** The device's current lock: a preview hold is `manual_…`. */
  sessionId?: string | null;
  h264Clients: number;
  mjpegViewers: number;
  recording: boolean;
}

/**
 * Whether a live-preview hold can go: it is a preview hold (never an Appium
 * session's lock), nobody watches over either transport, and no recording
 * holds the device.
 */
export function mayReleasePreviewHold(use: PreviewHoldUse): boolean {
  return (
    isManualLock(use.sessionId) && !use.recording && use.h264Clients === 0 && use.mjpegViewers === 0
  );
}

/**
 * Release a device's live-preview hold when a stream stops, unless something
 * still uses the device. One hold covers both Android transports, so neither
 * stream service may drop it while the other has viewers, and a recording
 * holds the device the same way.
 *
 * The services are looked up by their registered names rather than imported:
 * both of them call this, and importing them here would make the imports
 * circular.
 */
export async function releaseIdlePreviewHold(udid: string): Promise<boolean> {
  try {
    const device = await DeviceStoreFactory.getStore().findDevice({ udid });
    if (!device) return false;
    const h264 = Container.get<{
      getMultiplexer(udid: string): { clientCount: number } | undefined;
    }>('AndroidH264StreamService');
    const mjpeg = Container.get<{
      getStreamStatus(udid: string): { viewerCount: number } | undefined;
    }>('AndroidStreamService');
    const use: PreviewHoldUse = {
      sessionId: device.session_id,
      h264Clients: h264.getMultiplexer(udid)?.clientCount ?? 0,
      mjpegViewers: mjpeg.getStreamStatus(udid)?.viewerCount ?? 0,
      recording: await Container.get(RecordingStore).isRecording(udid),
    };
    if (!mayReleasePreviewHold(use)) return false;
    await unblockDevice(udid, device.host);
    log.info(`[${udid}] Released the live-preview hold: no viewers and no recording.`);
    return true;
  } catch (e: any) {
    log.warn(`[${udid}] Could not check or release the live-preview hold: ${e?.message ?? e}`);
    return false;
  }
}
