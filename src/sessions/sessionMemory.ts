import { Container } from 'typedi';
import { OmniVisionService } from '../services/omni-vision/OmniVisionService';
import { AutowaitService } from '../services/autowait/AutowaitService';
import IOSStreamService from '../device-managers/ios/IOSStreamService';
import log from '../logger';

/**
 * Drop what this server keeps in memory for a session's commands: the
 * elements its finds and heals found in screenshots (OmniVisionService), its
 * autowait settings (AutowaitService), and a simulator's live preview of its
 * picture (IOSStreamService). Called however the session ends
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
  Container.get(OmniVisionService).forgetSession(sessionId);
  Container.get(AutowaitService).clearSession(sessionId);
  Container.get(IOSStreamService)
    .endSimulatorPreviews(sessionId)
    .catch((err: any) =>
      log.warn(`Ending the simulator preview of ${sessionId} failed: ${err?.message ?? err}`),
    );
}
