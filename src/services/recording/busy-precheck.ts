import { Container, Service } from 'typedi';
import { DeviceStoreFactory } from '../../data-service/device-store';
import { inspectManualLock } from './manualLock';
import { isLeaseHolder, isSelfManualLock } from '../device-access/deviceAccessPolicy';
import { leaseHoldFor } from '../device-access/leaseHold';
import { SessionOwnerResolver } from '../device-access/SessionOwnerResolver';
import { activeLeaseOn } from '../lease/activeLeases';
import { RecordingStore } from './recording-store';

export type BusyReason =
  | 'automation'
  | 'manual_other'
  | 'recording_other_group'
  /** Held by another user's SDK lease. */
  | 'leased'
  | 'unknown';

/** The live SDK lease on a phone, and the user behind its actorId. */
export interface LeaseLookup {
  find(udid: string, host: string): Promise<{ actorId: string } | null>;
  holderOf(actorId: string): Promise<string | null>;
}

/** Whether a device already has a capture running. */
export interface RecordingLookup {
  isRecording(udid: string): Promise<boolean>;
}

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
  private readonly recordings: RecordingLookup;
  private readonly leases: LeaseLookup;
  // Every parameter must emit `Object` metadata: TypeDI injects constructor
  // parameters by type, and a function type made it look up `Function` in the
  // container, failing every recording start.
  constructor(store?: any, recordings?: RecordingLookup, leases?: LeaseLookup) {
    this.storeProvider = store ? () => store : () => DeviceStoreFactory.getStore();
    this.recordings = recordings ?? {
      isRecording: (udid: string) => Container.get(RecordingStore).isRecording(udid),
    };
    this.leases = leases ?? {
      find: (udid, host) => activeLeaseOn(udid, host),
      holderOf: (actorId) => Container.get(SessionOwnerResolver).leaseHolderOf(actorId),
    };
  }

  /**
   * @param udids   Devices to inspect.
   * @param actorId Identity of the caller — the USER id (see
   *                src/services/device-access/deviceAccessPolicy.ts; locks are
   *                keyed on the user, not the credential). When provided,
   *                manual locks owned by this actor are treated as self and
   *                skipped. Omit only for legacy/internal call sites that
   *                don't have a user identity available.
   * @param actorApiKeyId The caller's API-key id, when they have one. Purely
   *                an upgrade tolerance: locks written by versions that keyed
   *                on apiKey.id are still recognised as this caller's, exactly
   *                as isSelfManualLock does for /control. Droppable a release
   *                after ship — locks are ephemeral device-row state.
   */
  async findBusy(udids: string[], actorId?: string, actorApiKeyId?: string): Promise<BusyEntry[]> {
    const store = this.storeProvider();
    const out: BusyEntry[] = [];
    for (const udid of udids) {
      const device = await store.findDevice({ udid });
      if (!device) {
        out.push({ udid, reason: 'unknown' });
        continue;
      }
      // One capture per device. Checked before the lock rules: the owner of
      // the lock is exactly who a lost page state lets start a duplicate.
      if (await this.recordings.isRecording(udid)) {
        out.push({ udid, reason: 'recording_other_group' });
        continue;
      }
      // A leased phone is its lease holder's, whatever `busy` says (a lease
      // locks with `busy` alone, which other writes can clear). Anyone else
      // is refused; for the holder the lease itself is no conflict, though a
      // session or hold on the phone still is, below. A failed lookup throws:
      // the start fails rather than records someone's leased phone.
      const lease = await leaseHoldFor(device, this.leases.find, this.leases.holderOf);
      if (lease) {
        if (!isLeaseHolder(lease, actorId, actorApiKeyId)) {
          out.push({ udid, reason: 'leased' });
          continue;
        }
        if (!device.session_id) continue;
      }
      if (!device.busy) continue;
      // This server's own hold, else, on a hub, a node phone's preview hold
      // its node reports (nodeHold): session_id is the hub's and stays empty
      // for it, which read as unknown and refused the holder their own phone.
      const blockId: string | undefined = device.session_id ?? device.nodeHold ?? undefined;
      const lock = inspectManualLock(blockId, actorId, udid);
      // Single source of truth for "is this lock mine" — the same helper
      // /control's guard, stream/start and stream/stop use. Checking only
      // `lock.self` here was a fourth, narrower variant of that question.
      if (isSelfManualLock(blockId, udid, actorId, actorApiKeyId)) {
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
