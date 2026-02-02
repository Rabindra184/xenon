import { XenonPlugin } from './plugin';
import { path as ffmpeg } from '@ffmpeg-installer/ffmpeg';
import log from './logger';

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
    const { default: AndroidStreamService } = await import(
      './device-managers/android/AndroidStreamService'
    );

    // Shutdown all independent MJPEG streams and tunnels
    await IOSStreamService.getInstance().cleanup();
    await AndroidStreamService.getInstance().cleanup();

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
