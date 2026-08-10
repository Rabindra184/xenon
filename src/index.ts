import 'reflect-metadata';
import { XenonPlugin } from './plugin';
import { path as ffmpeg } from '@ffmpeg-installer/ffmpeg';
import log from './logger';
import { Container } from 'typedi';
import _ from 'lodash';

// Add FFMPEG to path for appium to record video of the session
process.env.PATH = process.env.PATH + ':' + ffmpeg.replace(/ffmpeg$/g, '');

/**
 * Global Lifecycle Orchestrator
 * Ensures that whenever the Appium process is terminated (SIGINT, SIGTERM),
 * all spawned sidecar processes (go-ios, iproxy, tunnels) are killed.
 */
const cleanup = async () => {
  log.info('🚀 [Xenon] Shutdown signal received. Performing graceful drain + cleanup...');

  try {
    // Phase 1: drain active sessions so in-flight video gets archived,
    // ports get released, and the DB rows don't stay "running" forever.
    // Bounded so a hung driver can't hold up systemd (default 90s timeout).
    const { ShutdownCoordinator } = await import('./services/ShutdownCoordinator');
    await Container.get(ShutdownCoordinator).drain(15_000);

    const { default: IOSStreamService } = await import('./device-managers/ios/IOSStreamService');
    const { default: AndroidStreamService } =
      await import('./device-managers/android/AndroidStreamService');
    const { LogcatStreamService } = await import('./device-managers/android/LogcatStreamService');
    const { stopAllTimers } = await import('./device-utils');
    const { VideoPipelineService } = await import('./services/VideoPipelineService');

    const { ProcessRegistry } = await import('./services/ProcessRegistry');

    // Phase 2: tear down infra (timers, sidecars, MJPEG streams).
    stopAllTimers();
    await Container.get(IOSStreamService).cleanup();
    await Container.get(AndroidStreamService).cleanup();
    // Its `adb logcat` children are spawned directly, not registered, so
    // Phase 3's terminateAll() does not reach them — without this a SIGTERM
    // orphans one per streamed device plus its device-side reader, and every
    // restart leaks another pair.
    await Container.get(LogcatStreamService).cleanup();
    await Container.get(VideoPipelineService).cleanup();

    // Phase 3: kill anything that's still running
    await Container.get(ProcessRegistry).terminateAll();

    log.info('✅ [Xenon] Infrastructure components sanitized. Safe to exit.');
  } catch (err: any) {
    log.error(`❌ [Xenon] Cleanup failed: ${err.message}`);
  } finally {
    // Principal Delay: Wait 2 seconds before hard-exiting to allow
    // other async handlers (like hub unregistration) to finish.
    setTimeout(() => process.exit(0), 2000);
  }
};

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// Last-resort synchronous net for every long-lived sidecar.
//
// `cleanup()` above is async, and on SIGTERM Appium's own handler closes the
// HTTP server and exits the process before Phases 2 and 3 run — measured
// against a real device: "Shutdown signal received" is logged, then Appium's
// "Received SIGTERM", then the process is gone without ever reaching
// "sanitized". So neither the per-service cleanups nor ProcessRegistry's
// terminateAll() can be relied on for the case that matters, and their
// children survive the restart. Another set leaks on the next one, which adds
// up fastest on the desktop launcher where restarts are routine.
//
// 'exit' always runs and forbids async work, so everything below must be
// synchronous — `kill()` is a syscall, so it qualifies. Each entry is
// independently guarded: one throwing service must not stop the others, and
// nothing here may mask the real exit reason.
//
// Not covered, deliberately: AndroidStreamService's MJPEG capture spawns a
// short-lived `adb exec-out screencap` per frame rather than holding a
// long-lived child, so at worst a single in-flight frame is orphaned and it
// exits on its own. Its http.Server dies with the process.
process.on('exit', () => {
  // require, not await import: 'exit' handlers cannot await.
  /* eslint-disable @typescript-eslint/no-var-requires */
  const nets: [string, () => unknown][] = [
    [
      'logcat',
      () =>
        Container.get(
          (
            require('./device-managers/android/LogcatStreamService') as {
              LogcatStreamService: new () => { killAllSync(): number | void };
            }
          ).LogcatStreamService,
        ).killAllSync(),
    ],
    [
      'h264',
      () =>
        Container.get(
          (
            require('./device-managers/android/AndroidH264StreamService') as {
              default: new () => { killAllSync(): number };
            }
          ).default,
        ).killAllSync(),
    ],
    [
      'tracked processes',
      () =>
        Container.get(
          (
            require('./services/ProcessRegistry') as {
              ProcessRegistry: new () => { killAllSync(): number };
            }
          ).ProcessRegistry,
        ).killAllSync(),
    ],
  ];
  /* eslint-enable @typescript-eslint/no-var-requires */

  for (const [, kill] of nets) {
    try {
      kill();
    } catch {
      /* never let a shutdown-path failure mask the real exit reason */
    }
  }
});

process.on('unhandledRejection', (reason, promise) => {
  log.error('❌ [Xenon] Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
  const errorDetails =
    err instanceof Error
      ? {
          name: err.name,
          message: err.message,
          stack: err.stack,
          // Add other non-standard properties if they exist
          ..._.omit(err as any, ['name', 'message', 'stack']),
        }
      : err;
  log.error('❌ [Xenon] Uncaught Exception:', JSON.stringify(errorDetails, null, 2));
  log.error('❌ [Xenon] Stack Trace:', err instanceof Error ? err.stack : new Error().stack);
  // Give logger time to flush before exiting
  setTimeout(() => process.exit(1), 1000);
});

export default XenonPlugin;
export { XenonPlugin };
