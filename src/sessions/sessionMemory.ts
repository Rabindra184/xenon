import { Container } from 'typedi';
import { OmniVisionService } from '../services/omni-vision/OmniVisionService';
import { AutowaitService } from '../services/autowait/AutowaitService';
import IOSStreamService from '../device-managers/ios/IOSStreamService';
import { RecordingOrchestrator } from '../services/recording/RecordingOrchestrator';
import log from '../logger';

/**
 * Drop what this server keeps in memory for a session's commands: the
 * elements its finds and heals found in screenshots (OmniVisionService), its
 * autowait settings (AutowaitService), and a simulator's live preview of its
 * picture (IOSStreamService). It also tells RecordingOrchestrator, so an
 * observer recording filming the session stops at once rather than film the
 * next test on its phone. Called however the session ends
 * here: the test's delete (SessionLifecycleService.deleteSession), Appium's
 * new-command timeout or a crash (XenonPlugin.onUnexpectedShutdown), the idle
 * release (releaseBlockedDevices), a stale heartbeat (OrphanSweeper) and a
 * shutdown's drain (stopSessionForShutdown). Safe to call more than once.
 *
 * Through 2.14 the elements were never dropped, and the autowait settings
 * only by the interceptor on `deleteSession`, a command Appium never hands
 * it: XenonPlugin answers `deleteSession` itself.
 */
export function forgetSessionMemory(sessionId: string | null | undefined): void {
  if (!sessionId) return;
  // Each step on its own, the recordings first: a service that can't be built
  // (TypeDI doesn't keep a failed construction) or a drop that throws must not
  // skip the others, nor throw at the ending, whose callers don't catch it
  // (deleteSession's finally would skip onSessionStopped, OrphanSweeper the
  // phone's release).
  // In the background: no caller waits for it. sessionEnded never throws by
  // design; the catch keeps a failure there a log line rather than an
  // unhandled rejection.
  forgetStep(sessionId, 'Telling the recordings', () =>
    Container.get(RecordingOrchestrator)
      .sessionEnded(sessionId)
      .catch((err: any) =>
        log.warn(`Telling the recordings that ${sessionId} ended failed: ${err?.message ?? err}`),
      ),
  );
  forgetStep(sessionId, 'Dropping the virtual elements', () =>
    Container.get(OmniVisionService).forgetSession(sessionId),
  );
  forgetStep(sessionId, 'Dropping the autowait settings', () =>
    Container.get(AutowaitService).clearSession(sessionId),
  );
  forgetStep(sessionId, 'Ending the simulator preview', () =>
    Container.get(IOSStreamService)
      .endSimulatorPreviews(sessionId)
      .catch((err: any) =>
        log.warn(`Ending the simulator preview of ${sessionId} failed: ${err?.message ?? err}`),
      ),
  );
}

/** One of forgetSessionMemory's steps; a synchronous throw is logged, never passed on. */
function forgetStep(sessionId: string, what: string, step: () => unknown): void {
  try {
    step();
  } catch (err: any) {
    log.warn(`${what} failed for session ${sessionId}: ${err?.message ?? err}`);
  }
}
