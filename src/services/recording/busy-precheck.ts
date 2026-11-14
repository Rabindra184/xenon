import { Container, Service } from 'typedi';
import { DeviceStoreFactory } from '../../data-service/device-store';
import { holdsClaim } from '../../data-service/deviceClaims';
import { inspectManualLock, isManualLock } from './manualLock';
import { isLeaseHolder, isSelfManualLock } from '../device-access/deviceAccessPolicy';
import { leaseHoldFor } from '../device-access/leaseHold';
import { SessionOwnerResolver } from '../device-access/SessionOwnerResolver';
import { activeLeaseOn } from '../lease/activeLeases';
import { RecordingStore } from './recording-store';
import { phoneKey, type RecordedPhone } from './recordedPhone';

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

/** Whether a phone, by udid and host, already has a capture running. */
export interface RecordingLookup {
  isRecording(udid: string, host: string): Promise<boolean>;
}

export interface BusyEntry {
  udid: string;
  /** The phone's host: two servers can name a phone alike. */
  host?: string;
  reason: BusyReason;
  sessionId?: string;
  blockId?: string;
}

/**
 * Atomic multi-phone busy detection. Used by RecordingOrchestrator before
 * starting a new recording group: if ANY requested phone is busy, the whole
 * request is rejected without taking any side effects. A phone is its udid
 * and host: each is read by both, since another server's phone can carry the
 * same udid (an emulator's name repeats).
 *
 * Decoding rules for the hold on a busy device (its session_id, else on a
 * hub a node phone's nodeHold):
 *   - the caller's own manual hold ("manual_<userId>_<udid>", or one keyed
 *     on the caller's API-key id, written before 1.13; isSelfManualLock)
 *     → not a blocker: the recording takes it over.
 *   - any other "manual_" hold, the legacy actor-less "manual_<udid>"
 *     included → manual_other. A legacy hold names no owner, so it is never
 *     the caller's.
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
      isRecording: (udid: string, host: string) =>
        Container.get(RecordingStore).isRecording(udid, host),
    };
    this.leases = leases ?? {
      find: (udid, host) => activeLeaseOn(udid, host),
      holderOf: (actorId) => Container.get(SessionOwnerResolver).leaseHolderOf(actorId),
    };
  }

  /**
   * @param phones  Phones to inspect, by udid and host.
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
   * @param observed The sessions the caller asked to observe, `udid@host`
   *                (phoneKey) → session id. A phone whose claim is that
   *                session is no conflict: recording it is the point.
   *                Anything else on it still is.
   */
  async findBusy(
    phones: RecordedPhone[],
    actorId?: string,
    actorApiKeyId?: string,
    observed?: ReadonlyMap<string, string>,
  ): Promise<BusyEntry[]> {
    const store = this.storeProvider();
    const out: BusyEntry[] = [];
    for (const phone of phones) {
      const { udid, host } = phone;
      const device = await store.findDevice({ udid, host });
      if (!device) {
        out.push({ udid, host, reason: 'unknown' });
        continue;
      }
      // One capture per device. Checked before the lock rules: the owner of
      // the lock is exactly who a lost page state lets start a duplicate.
      if (await this.recordings.isRecording(udid, host)) {
        out.push({ udid, host, reason: 'recording_other_group' });
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
          out.push({ udid, host, reason: 'leased' });
          continue;
        }
        if (!device.session_id) continue;
      }
      // The very session the caller asked to observe. holdsClaim reads the
      // claim the way a release does: claimSessionId first (a node's phone on
      // a hub, where session_id stays empty), else session_id. Checked after
      // the recording and lease rules, which still refuse. So does another
      // user's preview or recording hold on the phone (session_id, or on a
      // hub a node's report of one in nodeHold): the claim and the hold are
      // separate columns, and observing the session takes no hold over.
      const observedSession = observed?.get(phoneKey(phone));
      if (observedSession !== undefined && holdsClaim(device, { sessionId: observedSession })) {
        const foreign = [device.session_id, device.nodeHold].find(
          (hold) => isManualLock(hold) && !isSelfManualLock(hold, udid, actorId, actorApiKeyId),
        );
        if (foreign) out.push({ udid, host, reason: 'manual_other', blockId: foreign });
        continue;
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
        out.push({ udid, host, reason: 'manual_other', blockId });
        continue;
      }
      if (blockId) {
        out.push({ udid, host, reason: 'automation', sessionId: blockId });
      } else {
        out.push({ udid, host, reason: 'unknown' });
      }
    }
    return out;
  }
}
