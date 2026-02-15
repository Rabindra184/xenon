import 'reflect-metadata';
import { XenonPlugin } from './plugin';
import { path as ffmpeg } from '@ffmpeg-installer/ffmpeg';
import log from './logger';
import { Container } from 'typedi';

// Add FFMPEG to path for appium to record video of the session
process.env.PATH = process.env.PATH + ':' + ffmpeg.replace(/ffmpeg$/g, '');

/**
 * Global Lifecycle Orchestrator
 * Ensures that whenever the Appium process is terminated (SIGINT, SIGTERM),
 * all spawned sidecar processes (go-ios, iproxy, tunnels) are killed.
 */
const cleanup = async () => {
  log.info('🚀 [Xenon] Shutdown signal received. Performing graceful cleanup...');

  try {
    const { default: IOSStreamService } = await import('./device-managers/ios/IOSStreamService');
    const { default: AndroidStreamService } =
      await import('./device-managers/android/AndroidStreamService');
    const { VideoPipelineService } = await import('./services/VideoPipelineService');

    // Shutdown all independent MJPEG streams, tunnels, and video recordings
    await Container.get(IOSStreamService).cleanup();
    await Container.get(AndroidStreamService).cleanup();
    await Container.get(VideoPipelineService).cleanup();

    log.info('✅ [Xenon] Infrastructure components sanitized. Safe to exit.');
  } catch (err: any) {
    log.error(`❌ [Xenon] Cleanup failed: ${err.message}`);
  } finally {
    process.exit(0);
  }
};

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

export default XenonPlugin;
export { XenonPlugin };
