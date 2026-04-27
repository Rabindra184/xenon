import { Service } from 'typedi';
import { DeviceStoreFactory } from '../../data-service/device-store';

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
 *   - id starts with "manual_" → manual_other (single-device control panel
 *     or another mosaic group). We do not have per-user identity in Phase 1
 *     so we conservatively treat all such blocks as foreign.
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

  async findBusy(udids: string[]): Promise<BusyEntry[]> {
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
      if (blockId && blockId.startsWith('manual_')) {
        out.push({ udid, reason: 'manual_other', blockId });
      } else if (blockId) {
        out.push({ udid, reason: 'automation', sessionId: blockId });
      } else {
        out.push({ udid, reason: 'unknown' });
      }
    }
    return out;
  }
}
