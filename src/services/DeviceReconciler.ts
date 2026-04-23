import { Service } from 'typedi';
import log from '../logger';
import { DeviceStoreFactory } from '../data-service/device-store';
import { SESSION_MANAGER } from '../sessions/SessionManager';
import { unblockDevice } from '../data-service/device-service';

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
      // Device is busy but isn't tied to an active session at the driver
      // layer. A known session in SESSION_MANAGER means a real driver is
      // holding it — leave those alone.
      if (SESSION_MANAGER.isValidSession(d.session_id)) return false;
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
        await unblockDevice(device.udid, device.host);
        this.orphansFreed++;
      } catch (err: any) {
        this.logger.error(`Failed to unblock ghost device ${device.udid}: ${err.message}`);
      }
    }
  }

  public getOrphansFreedCount(): number {
    return this.orphansFreed;
  }
}
