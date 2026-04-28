import { Service } from 'typedi';
import { DeviceStoreFactory } from '../../data-service/device-store';
import { inspectManualLock } from './manualLock';

export type BusyReason =
  | 'automation'
  | 'manual_other'
  | 'recording_other_group'
  | 'unknown';

export interface BusyEntry {
  udid: string;
  reason: BusyReason;
  sessionId?: string;
  blockId?: string;
}

/**
 * Atomic multi-UDID busy detection. Used by RecordingOrchestrator before
 * starting a new recording group: if ANY requested UDID is busy, the whole
 * request is rejected without taking any side effects.
 *
 * Decoding rules for an existing session_id on a busy device:
 *   - id is exactly "manual_<udid>" → the mosaic preview's canonical lock
 *     for THIS device. The same dashboard owns it, so the recording can
 *     take it over. NOT a blocker.
 *   - id starts with "manual_" but is for a different udid → manual_other
 *     (a manual session for some other context — treat as foreign).
 *   - any other id → automation (a real Appium session).
 *   - missing/null   → unknown (defensive fallback).
 */
@Service()
export class BusyPrecheck {
  // Allow injection in tests; default to the real device store.
  private readonly storeProvider: () => any;
  constructor(store?: any) {
    this.storeProvider = store ? () => store : () => DeviceStoreFactory.getStore();
  }

  /**
   * @param udids   Devices to inspect.
   * @param actorId Identity of the caller (api-key id). When provided, manual
   *                locks owned by this actor are treated as self and skipped.
   *                Omit only for legacy/internal call sites that don't have a
   *                user identity available.
   */
  async findBusy(udids: string[], actorId?: string): Promise<BusyEntry[]> {
    const store = this.storeProvider();
    const out: BusyEntry[] = [];
    for (const udid of udids) {
      const device = await store.findDevice({ udid });
      if (!device) {
        out.push({ udid, reason: 'unknown' });
        continue;
      }
      if (!device.busy) continue;
      const blockId: string | undefined = device.session_id ?? undefined;
      const lock = inspectManualLock(blockId, actorId, udid);
      if (lock?.self) {
        // Self-owned manual lock — caller can take it over.
        continue;
      }
      if (lock) {
        // Foreign manual lock (legacy `manual_<udid>` or another user's).
        out.push({ udid, reason: 'manual_other', blockId });
        continue;
      }
      if (blockId) {
        out.push({ udid, reason: 'automation', sessionId: blockId });
      } else {
        out.push({ udid, reason: 'unknown' });
      }
    }
    return out;
  }
}
