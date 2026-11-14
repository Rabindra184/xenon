import { Service } from 'typedi';
import log from '../logger';
import { DeviceStoreFactory } from '../data-service/device-store';
import { isSessionLiveHere } from '../sessions/sessionLiveness';
import { releaseSessionDevice } from '../data-service/device-service';
import { isManualLock } from './recording/manualLock';

// Closes a gap left by OrphanSweeper (which operates on prisma.session + the
// Prisma device table via a heartbeat cutoff) and releaseBlockedDevices
// (which only triggers on newCommandTimeout after a session has actually run
// a command). Neither covers the case where:
//   - blockDevice() marks a device busy with session_id = X
//   - but X never makes it into SESSION_MANAGER (driver crash during startup,
//     allocation failed after the lock but before registration, Loki store
//     drift, etc.)
//   - the session also never reaches Prisma with a heartbeat, so OrphanSweeper
//     doesn't see it; lastCmdExecutedAt stays undefined, so
//     releaseBlockedDevices skips it too.
// Result: a ghost "busy" device that blocks allocation forever. This sweep
// cross-references the device store against SESSION_MANAGER and unblocks
// those ghosts.
@Service()
export class DeviceReconciler {
  private readonly logger = log.scope('DeviceReconciler');
  private orphansFreed = 0;

  // Grace window after sessionStartTime within which we trust the session
  // is still bootstrapping (driver.createSession can legitimately take
  // 30s+ for simulator boot). Below this age we skip the device even if
  // SESSION_MANAGER doesn't know it yet.
  private static readonly MIN_BUSY_AGE_MS = 60_000;

  public async reconcile(): Promise<void> {
    const store = DeviceStoreFactory.getStore();
    let devices;
    try {
      devices = await store.getAllDevices();
    } catch (err: any) {
      this.logger.error(`getAllDevices failed: ${err.message}`);
      return;
    }

    const now = Date.now();
    const orphans = devices.filter((d) => {
      if (!d.busy || !d.session_id) return false;
      // A preview's or a recording's hold isn't a session: its own paths
      // release it (the leave, the idle preview release, the recording's
      // end). Its id is in no map, so judged as a session it was freed a
      // minute in whenever the row still carried a sessionStartTime.
      if (isManualLock(d.session_id)) return false;
      // Device is busy but isn't tied to a session that still runs here.
      // Asked of Appium too, not SESSION_MANAGER alone: a local session with
      // the dashboard off and no video is in no map (isSessionLiveHere).
      if (isSessionLiveHere(d.session_id)) return false;
      if (d.claimSessionId && isSessionLiveHere(d.claimSessionId)) return false;
      // Respect the bootstrap grace window: if sessionStartTime is 0 or
      // null we don't know when allocation happened, so fall back to
      // requiring SESSION_MANAGER knowledge (i.e. don't touch it).
      if (!d.sessionStartTime || d.sessionStartTime <= 0) return false;
      return now - d.sessionStartTime >= DeviceReconciler.MIN_BUSY_AGE_MS;
    });

    if (orphans.length === 0) return;

    this.logger.warn(
      `Found ${orphans.length} ghost device(s); releasing: ${orphans
        .map((d) => `${d.udid}@${d.host}(session=${d.session_id})`)
        .join(', ')}`,
    );

    for (const device of orphans) {
      try {
        // Keyed on the session read above: if it ended meanwhile and the
        // phone went to another session, that one keeps it.
        if (await releaseSessionDevice(device.udid, device.host, device.session_id as string)) {
          this.orphansFreed++;
        }
      } catch (err: any) {
        this.logger.error(`Failed to unblock ghost device ${device.udid}: ${err.message}`);
      }
    }
  }

  public getOrphansFreedCount(): number {
    return this.orphansFreed;
  }
}
