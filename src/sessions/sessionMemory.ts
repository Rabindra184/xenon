import { Container } from 'typedi';
import { OmniVisionService } from '../services/omni-vision/OmniVisionService';
import { AutowaitService } from '../services/autowait/AutowaitService';
import IOSStreamService from '../device-managers/ios/IOSStreamService';
import { RecordingOrchestrator } from '../services/recording/RecordingOrchestrator';
import { PortAllocator } from '../services/PortAllocator';
import log from '../logger';

/**
 * Drop what this server keeps in memory for a session's commands: the
 * elements its finds and heals found in screenshots (OmniVisionService), its
 * autowait settings (AutowaitService), a simulator's live preview of its
 * picture (IOSStreamService), and the ports it leased for itself
 * (PortAllocator.releaseForSession; through 2.36 only finalizeCleanup gave
 * them back, for a session in SESSION_MANAGER). It also tells
 * RecordingOrchestrator, so an observer recording filming the session stops
 * at once rather than film the next test on its phone. Called however the
 * session ends
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
  tellRecordingsSessionEnded(sessionId);
  forgetStep(sessionId, 'Dropping the virtual elements', () =>
    Container.get(OmniVisionService).forgetSession(sessionId),
  );
  forgetStep(sessionId, 'Dropping the autowait settings', () =>
    Container.get(AutowaitService).clearSession(sessionId),
  );
  forgetStep(sessionId, "Giving back the session's ports", () =>
    Container.get(PortAllocator)
      .releaseForSession(sessionId)
      .catch((err: any) =>
        log.warn(`Giving back the ports of ${sessionId} failed: ${err?.message ?? err}`),
      ),
  );
  forgetStep(sessionId, 'Ending the simulator preview', () =>
    Container.get(IOSStreamService)
      .endSimulatorPreviews(sessionId)
      .catch((err: any) =>
        log.warn(`Ending the simulator preview of ${sessionId} failed: ${err?.message ?? err}`),
      ),
  );
}

/**
 * Tell RecordingOrchestrator that a session ended, so an observer recording
 * filming it stops. In the background: no caller waits for it. Neither a
 * synchronous throw (an orchestrator that can't be built) nor a rejection
 * reaches the caller; each is a log line. sessionEnded is safe to call twice.
 *
 * The test's own quit (deleteSession) calls this first thing in its cleanup
 * lock, before the phone is released: forgetSessionMemory runs only after the
 * video archive and the driver's own delete, which can take 30 s, and the
 * recording would film the freed phone until then.
 */
export function tellRecordingsSessionEnded(sessionId: string): void {
  forgetStep(sessionId, 'Telling the recordings', () =>
    Container.get(RecordingOrchestrator)
      .sessionEnded(sessionId)
      .catch((err: any) =>
        log.warn(`Telling the recordings that ${sessionId} ended failed: ${err?.message ?? err}`),
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
