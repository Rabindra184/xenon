import { Service } from 'typedi';
import { v4 as uuidv4 } from 'uuid';
import { prisma as defaultPrisma } from '../../prisma';
import { DeviceStoreFactory } from '../../data-service/device-store';
import { withAllocationLock } from '../../device-utils';
import type { IDevice } from '../../interfaces/IDevice';
import log from '../../logger';
import { PortAllocatorClient } from '../ports/PortAllocatorClient';
import { isUnheld } from '../../data-service/deviceClaims';
import {
  ActiveLease,
  activeLeaseOn,
  activeLeasesByDevice,
  leaseKey,
  leasedDeviceKeys,
} from './activeLeases';
import { clientFilters, leasable, LeaseFilters, memberMatches, teamScope } from './leaseFilters';
import { GrantPortClient, GroupLeaseCreateData, GroupLeaseRow, LeaseGranter } from './LeaseGranter';
import { defaultNodePairAuthProvider, MAX_MEMBERS, NodePairAuthProvider } from './LeaseService';
import { onPhoneFreed, phoneFreed } from './leaseQueueKick';
import { lockExactPhone } from './lockExactPhone';
import {
  endedData,
  LeaseEndReason,
  missedHeartbeats,
  waiterEnd,
  waitingWhere,
} from './leaseStatus';
import { filledCount, maxMatching } from './memberMatch';

/** One member of a lease request. */
export interface MemberRequest {
  filters: LeaseFilters;
}

/** A `waitMs: 0` request: LeaseService.create's, with its token's hash. */
export interface TryNowRequest {
  members: MemberRequest[];
  callerTeamIds?: string[];
  durationMs: number;
  buildId?: string;
  actorId: string;
  teamId: string | null;
  reason?: string;
  heartbeatSeconds: number;
  tokenHash: string;
}

export type TryNowOutcome = { leaseId: string } | 'busy' | 'unhealthy';

/** What giveUp is told: why the lease gives up, and what it was judged on. */
export interface GiveUpOptions {
  /** Whether to call phoneFreed() when a phone was let go (default true). */
  kick?: boolean;
  /** Its `endReason` (default `wait_ran_out`, giveUp's first use). */
  reason?: LeaseEndReason;
  /**
   * Given up only while its `lastHeartbeatAt` is still this: a lease judged
   * on missed heartbeats whose client heartbeated since keeps waiting.
   */
  lastHeartbeatAt?: number;
}

/** How often the backstop pass runs (start's default). */
export const LEASE_QUEUE_INTERVAL_MS = 5_000;

interface HeldRow {
  id: string;
  index: number;
  key: string;
  heldAt: number;
}

/** What a waiting lease asked for, as its row stores it. */
interface StoredRequest {
  filters: LeaseFilters[];
  callerTeamIds: string[] | undefined;
  durationMs: number;
}

/** A waiting lease row as a pass reads it. */
interface Waiter extends StoredRequest {
  id: string;
  buildId: string | null;
  /** Its member rows; reloaded by the pass after a grant fails. */
  holds: HeldRow[];
}

const isFilters = (value: unknown): boolean =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  typeof (value as { platform?: unknown }).platform === 'string';

/**
 * A waiting row's request, or null when it can't be served: `requestedMembers`
 * a JSON array of 1 to 8 member filters (each an object with its `platform`),
 * `callerTeamIds` null or a JSON array of team ids, `durationMs` a positive
 * integer.
 */
function readRequest(row: any): StoredRequest | null {
  let filters: unknown;
  let teams: unknown;
  try {
    filters = JSON.parse(row.requestedMembers ?? 'null');
    teams = row.callerTeamIds == null ? null : JSON.parse(row.callerTeamIds);
  } catch {
    return null;
  }
  if (!Array.isArray(filters) || filters.length < 1 || filters.length > MAX_MEMBERS) return null;
  if (!filters.every(isFilters)) return null;
  const teamsOk =
    teams === null || (Array.isArray(teams) && teams.every((t) => typeof t === 'string'));
  if (!teamsOk) return null;
  if (!Number.isInteger(row.durationMs) || row.durationMs <= 0) return null;
  return {
    filters: filters as LeaseFilters[],
    callerTeamIds: teams === null ? undefined : (teams as string[]),
    durationMs: row.durationMs,
  };
}

/** A lease row's member rows as holds. */
function heldRows(row: { members?: any[] }): HeldRow[] {
  return (row.members ?? []).map((m: any) => ({
    id: m.id,
    index: m.index,
    key: leaseKey(m.udid, m.host),
    heldAt: m.heldAt,
  }));
}

/** What a request may take, member by member. */
interface Candidates {
  /** `keys[i]`: the phones member `i` accepts, in the store's order. */
  keys: string[][];
  devices: Map<string, IDevice>;
}

/** What one pass knows as it goes down the queue. */
interface PassState {
  now: number;
  /** Phones a lease holds or leases (its member rows), and what this pass gave out. */
  taken: Set<string>;
  /** Phones the head holds or matched: no later request may take them. */
  forHead: Set<string>;
  /** The leases whose status or holds this pass changed. */
  changed: Set<string>;
  /** The store's answer per (filters, teams), read once a pass. */
  reads: Map<string, Promise<IDevice[]>>;
  /** The granter's reservationFailures when the lock was taken (reservationFailed). */
  failuresBefore: number;
}

/**
 * The queue of waiting leases, and its grant passes.
 *
 * The queue is the `waiting` lease rows still inside their `waitUntil` (none:
 * for ever, waitingWhere) whose client hasn't missed three heartbeats, in
 * `createdAt` order, ties by id: one server's queue. A pass first gives up
 * every waiter past its wait or its heartbeats (endGoneWaiters), as the
 * sweeper would, so a waiter whose client went away is never granted. A pass goes down it
 * under the allocation lock (withAllocationLock), so a grant and a session's
 * allocation never pick the same free phone:
 *
 * 1. The head, the oldest waiter, gets a maximum matching of its members to
 *    the free phones it may take plus the phones it holds, keeping as many
 *    of its holds where they are as any maximum matching can (maxMatching).
 *    A full match is granted (LeaseGranter). Granted or gone, the next
 *    waiter is the head.
 * 2. Otherwise the head holds the phones of that matching, and nothing else:
 *    each new one locked (findAndLockDevice) and written as its member row
 *    with `heldAt`, a hold moved to another member keeps its row under the
 *    new index, and a hold out of the matching is let go. A hold whose phone
 *    has no Device row (a hub clears its own at boot and finds them again)
 *    is kept as it is, counted as held, and no grant waits on less: the
 *    sweeper decides when such a phone is gone.
 * 3. Each later waiter is granted only if it can be filled completely from
 *    free phones the head neither holds nor matched. It never holds.
 *
 * A free phone is one a lease may take now (`leasable`), that no lease holds
 * or leases (its member rows, whatever its `busy` says), that the request's
 * stored teams can see, and that no failed port reservation is skipping
 * (LeaseGranter.isSkipped: that phone, or every phone of a server that
 * couldn't be reached). A hold of the lock tries at most one grant that
 * fails on a port reservation (reservationFailed); the next pass goes on. A waiting row whose request can't be read is set
 * aside: not served, not counted by positionOf, its holds let go.
 *
 * A pass runs on `kick()` (several before it starts are one), on every
 * phoneFreed() once started, and every 5 s as a backstop. It never throws.
 */
@Service()
export class LeaseQueue {
  private readonly logger = log.scope('LeaseQueue');
  /** Grants the leases a pass matched; also read by tests. */
  readonly granter: LeaseGranter;
  private readonly listeners = new Map<string, Set<() => void>>();
  private kickTimer?: NodeJS.Timeout;
  /** Set from a kick's pass being called until it has the lock. */
  private kickWaiting?: object;
  /** The token the next pass() call takes: its kick's. */
  private nextPassToken?: object;
  /** Waiting leases already warned about an unreadable request. */
  private readonly unreadable = new Set<string>();
  private interval?: NodeJS.Timeout;
  private unsubscribe?: () => void;
  /** Set by stop() until the next start(): a kick then runs no pass. */
  private stopped = false;
  /** The passes running now (idle). */
  private readonly running = new Set<Promise<void>>();

  constructor(
    private readonly db: any = defaultPrisma,
    private readonly store: any = DeviceStoreFactory.getStore(),
    portClient: any = new PortAllocatorClient(),
    private readonly authProvider: NodePairAuthProvider = defaultNodePairAuthProvider(),
  ) {
    this.granter = new LeaseGranter(db, store, portClient as GrantPortClient, authProvider);
  }

  /** One grant pass. Never throws: a failure is logged, and the next pass tries again. */
  async pass(): Promise<void> {
    const run = this.runPass();
    this.running.add(run);
    try {
      await run;
    } finally {
      this.running.delete(run);
    }
  }

  /** For tests: resolves once every pass started so far, and a kick's pending one, has finished. */
  async idle(): Promise<void> {
    while (this.kickTimer || this.running.size > 0) {
      if (this.running.size > 0) await Promise.all([...this.running]);
      else await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  private async runPass(): Promise<void> {
    // A kick's own pass takes the kick's token; any other call takes none.
    const token = this.nextPassToken;
    this.nextPassToken = undefined;
    let state: PassState | undefined;
    try {
      await withAllocationLock(async () => {
        // Kicks from here on need a pass of their own: this one may have read
        // the queue before what they report.
        if (token && this.kickWaiting === token) this.kickWaiting = undefined;
        state = this.newState();
        await this.serveQueue(state);
      });
    } catch (err) {
      this.logger.warn(`a grant pass failed: ${(err as Error)?.message ?? err}`);
    }
    if (state) this.notify(state.changed);
  }

  /**
   * Runs one pass soon. Kicks before that pass has the lock are that one
   * pass. After stop() (a shutdown), until the next start(), a kick does
   * nothing.
   */
  kick(): void {
    if (this.stopped || this.kickTimer || this.kickWaiting) return;
    this.kickTimer = setTimeout(() => {
      this.kickTimer = undefined;
      const mine = {};
      this.kickWaiting = mine;
      this.nextPassToken = mine;
      void this.pass().finally(() => {
        if (this.kickWaiting === mine) this.kickWaiting = undefined;
      });
    }, 0);
    this.kickTimer.unref?.();
  }

  /** The backstop timer and the phoneFreed() subscription. */
  start(intervalMs: number = LEASE_QUEUE_INTERVAL_MS): void {
    this.stop();
    this.stopped = false;
    this.interval = setInterval(() => this.kick(), intervalMs);
    this.interval.unref?.();
    this.unsubscribe = onPhoneFreed(() => this.kick());
  }

  /** Synchronous, and waits for nothing: a pass already running goes on to its end. */
  stop(): void {
    this.stopped = true;
    if (this.interval) clearInterval(this.interval);
    this.interval = undefined;
    if (this.kickTimer) clearTimeout(this.kickTimer);
    this.kickTimer = undefined;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  /**
   * A `waitMs: 0` request, tried once under the lock. The queue is served
   * first, so the request comes after every waiter, as the last backfill: it
   * may use only free phones the head neither holds nor matched. 'busy' when
   * those can't fill every member; 'unhealthy' when they could, but only with
   * a phone whose port reservation failed (now, or within the skip window),
   * which is what LeaseService.create answers a failed reservation with.
   * When the queue's pass just had a grant fail on its ports, the request
   * tries none and is 'busy' if it could have been filled. A
   * grant that fails for any other reason (the lease couldn't be written)
   * throws, as do the pass's own errors.
   */
  async tryNow(request: TryNowRequest): Promise<TryNowOutcome> {
    let state: PassState | undefined;
    try {
      return await withAllocationLock(async () => {
        state = this.newState();
        await this.serveQueue(state);
        return this.tryRequest(state, request);
      });
    } finally {
      if (state) this.notify(state.changed);
    }
  }

  /**
   * Ends a waiting lease that gave up (its wait ran out before its create
   * was answered, its client released it, the sweeper found it quiet):
   * `expired` with `reason` as its `endReason`, its member rows deleted and
   * each held phone's lease lock released, as a pass lets a hold go. Under
   * the allocation lock, so no pass is holding for it or granting it
   * meanwhile. 'not-waiting' when it no longer was (a pass granted it, or it
   * ended otherwise), or when `lastHeartbeatAt` was given and a heartbeat
   * has moved it since.
   *
   * It calls phoneFreed() when it let a phone go, unless `kick` is false: the
   * sweeper ends several leases a sweep and kicks the queue once for them all.
   */
  async giveUp(
    leaseId: string,
    { kick = true, reason = 'wait_ran_out', lastHeartbeatAt }: GiveUpOptions = {},
  ): Promise<'expired' | 'not-waiting'> {
    const { outcome, freed } = await withAllocationLock(() =>
      this.endWaiting(leaseId, reason, lastHeartbeatAt),
    );
    if (outcome === 'expired') this.notify(new Set([leaseId]));
    if (freed && kick) phoneFreed();
    return outcome;
  }

  /**
   * giveUp's work, for a caller that holds the allocation lock: the lease
   * `expired` (with `reason`) if it still waits, and still has the
   * `lastHeartbeatAt` it was judged on when one is given, its member rows
   * deleted and each held phone's lease lock released. `freed` when it let
   * a phone go.
   */
  private async endWaiting(
    leaseId: string,
    reason: LeaseEndReason,
    lastHeartbeatAt?: number,
  ): Promise<{ outcome: 'expired' | 'not-waiting'; freed: boolean }> {
    const ended = await this.db.lease.updateMany({
      where: {
        id: leaseId,
        status: 'waiting',
        ...(lastHeartbeatAt === undefined ? {} : { lastHeartbeatAt }),
      },
      data: endedData('expired', reason),
    });
    if (!ended || ended.count === 0) return { outcome: 'not-waiting', freed: false };
    const holds = await this.currentHolds(leaseId);
    if (holds.length === 0) return { outcome: 'expired', freed: false };
    await this.db.leaseMember.deleteMany({ where: { leaseId } });
    for (const h of holds) await this.releaseLock(leaseId, h.key);
    return { outcome: 'expired', freed: true };
  }

  /**
   * Gives up each waiter the sweeper would (waiterEnd): its wait ran out
   * (`waitUntil` past), or its client missed three heartbeats. Either is out
   * of the queue already, but its holds are leased phones (leasedDeviceKeys)
   * until something ends it, and the sweeper may be 30 s away. Under this
   * pass's lock, so its phones go to the waiters this pass serves. One judged
   * on its heartbeats is given up only while its `lastHeartbeatAt` is still
   * the one read: a heartbeat landing meanwhile keeps it. Never throws: a
   * lease that can't be ended now is left for the sweeper.
   *
   * Through 2.36 only an ended wait counted, so a waiter whose client had
   * gone could be granted and then reaped as "missed heartbeats" by the
   * next sweep.
   */
  private async endGoneWaiters(state: PassState): Promise<void> {
    let waiters: Array<{
      id: string;
      waitUntil: number | null;
      heartbeatSeconds: number | null;
      lastHeartbeatAt: number;
    }>;
    try {
      waiters = await this.db.lease.findMany({
        where: { status: 'waiting' },
        select: { id: true, waitUntil: true, heartbeatSeconds: true, lastHeartbeatAt: true },
      });
    } catch (err) {
      this.logger.warn(`couldn't read the waiting leases: ${(err as Error)?.message}`);
      return;
    }
    for (const lease of waiters) {
      const end = waiterEnd(lease, state.now);
      if (!end) continue;
      try {
        const judgedOn = end.reason === 'missed_heartbeats' ? lease.lastHeartbeatAt : undefined;
        const { outcome, freed } = await this.endWaiting(lease.id, end.reason, judgedOn);
        if (outcome !== 'expired') continue;
        state.changed.add(lease.id);
        this.logger.info(
          `expired waiting lease ${lease.id}: ${end.text}` +
            (freed ? '; let go of its held phones' : ''),
        );
      } catch (err) {
        this.logger.warn(`couldn't end waiting lease ${lease.id}: ${(err as Error)?.message}`);
      }
    }
  }

  /**
   * A waiting lease lets go of one held phone that is lost (the sweeper's
   * decision: gone, unhealthy or blocked): its member row deleted
   * and the phone's lease lock released, as a pass lets a hold go. The lease
   * keeps waiting, and a later pass may hold another phone for that member.
   * Under the allocation lock, so no pass is moving or granting its holds
   * meanwhile. False when there was nothing to drop: the lease no longer
   * waits (granted or ended), or the row is gone. The caller kicks the queue
   * (phoneFreed).
   */
  async dropHold(leaseId: string, memberId: string): Promise<boolean> {
    const dropped = await withAllocationLock(async () => {
      const lease = await this.db.lease.findUnique({
        where: { id: leaseId },
        select: { status: true },
      });
      if (lease?.status !== 'waiting') return false;
      const row = await this.db.leaseMember.findFirst({ where: { id: memberId, leaseId } });
      if (!row) return false;
      const deleted = await this.db.leaseMember.deleteMany({ where: { id: memberId, leaseId } });
      if (!deleted || deleted.count === 0) return false;
      await this.releaseLock(leaseId, leaseKey(row.udid, row.host));
      return true;
    });
    if (dropped) this.notify(new Set([leaseId]));
    return dropped;
  }

  /**
   * The lease's place in the queue, 1 for the head; null when it isn't in it:
   * not waiting, past its wait, quiet for three heartbeats, or with a request
   * no pass can read.
   */
  async positionOf(leaseId: string): Promise<number | null> {
    const now = Date.now();
    const rows: any[] = await this.db.lease.findMany({
      where: this.queueWhere(now),
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        requestedMembers: true,
        callerTeamIds: true,
        durationMs: true,
        heartbeatSeconds: true,
        lastHeartbeatAt: true,
      },
    });
    const at = rows.filter((row) => this.inQueue(row, now)).findIndex((row) => row.id === leaseId);
    return at === -1 ? null : at + 1;
  }

  /** Calls `fn` after each pass that changes the lease's status or holds. */
  onChange(leaseId: string, fn: () => void): () => void {
    const listener = () => fn();
    let set = this.listeners.get(leaseId);
    if (!set) {
      set = new Set();
      this.listeners.set(leaseId, set);
    }
    set.add(listener);
    return () => {
      const current = this.listeners.get(leaseId);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) this.listeners.delete(leaseId);
    };
  }

  private newState(): PassState {
    return {
      now: Date.now(),
      taken: new Set(),
      forHead: new Set(),
      changed: new Set(),
      reads: new Map(),
      failuresBefore: this.granter.reservationFailures,
    };
  }

  /**
   * Whether a grant under this hold of the lock failed on a port
   * reservation. Then no other grant is tried until the next hold: each
   * reservation may wait out a timeout, and every session's allocation waits
   * for the lock meanwhile. The failed phone, or its whole server, is skipped
   * by then (LeaseGranter.isSkipped).
   */
  private reservationFailed(state: PassState): boolean {
    return this.granter.reservationFailures > state.failuresBefore;
  }

  private notify(changed: Set<string>): void {
    for (const leaseId of changed) {
      for (const listener of [...(this.listeners.get(leaseId) ?? [])]) {
        try {
          listener();
        } catch (err) {
          this.logger.warn(`a listener of lease ${leaseId} failed: ${(err as Error)?.message}`);
        }
      }
    }
  }

  /** The waiting leases still inside their wait (waitingWhere: none waits for ever). */
  private queueWhere(now: number) {
    return waitingWhere(now);
  }

  /**
   * Whether a row queueWhere read is in the queue: its client hasn't missed
   * three heartbeats (a Prisma `where` can't compare two columns), and a
   * pass can read its request.
   */
  private inQueue(row: any, now: number): boolean {
    if (missedHeartbeats(row, now)) return false;
    return readRequest(row) !== null;
  }

  /** Steps 1 to 3 of a pass, for every waiter. The caller holds the lock. */
  private async serveQueue(state: PassState): Promise<void> {
    await this.endGoneWaiters(state);
    await this.relockLeasedPhones(state.now);
    const rows: any[] = await this.db.lease.findMany({
      where: this.queueWhere(state.now),
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: { members: true },
    });
    // Every phone a lease holds or leases, whether anybody waits or not: a
    // tryNow after an empty queue must not offer one whose `busy` a node's
    // report, a forced release or a recovery has cleared.
    for (const key of await leasedDeviceKeys(this.db)) state.taken.add(key);

    let headFound = false;
    for (const row of rows) {
      // Quiet for three heartbeats and not given up just now (its end
      // failed): never served, never the head. The sweeper ends it.
      if (missedHeartbeats(row, state.now)) continue;
      const holds = heldRows(row);
      const request = readRequest(row);
      if (!request) {
        await this.setAside(state, row.id, holds);
        continue;
      }
      const waiter: Waiter = { id: row.id, buildId: row.buildId ?? null, ...request, holds };
      if (headFound) {
        await this.backfill(state, waiter);
        continue;
      }
      headFound = await this.serveHead(state, waiter);
    }
  }

  /**
   * Puts the lease's lock (`busy`) back on each phone a live lease holds or
   * leases whose row says it is free. A hub clears its own rows at boot and
   * discovery writes them again with `busy: false`; a node's report, a forced
   * release and a recovery clear `busy` without asking about leases. Only a
   * phone nothing else holds (isUnheld) and that isn't offline, as
   * findAndLockDevice would lock it (which itself skips a leased phone);
   * then, as a session's release hands a phone back to its lease
   * (keepLeaseLock), the lease is checked again and the lock undone if it
   * ended in between. The caller holds the lock. Never throws: a failure is
   * logged, and the pass goes on.
   */
  private async relockLeasedPhones(now: number): Promise<void> {
    let leased: Map<string, ActiveLease>;
    let rows: IDevice[];
    try {
      leased = await activeLeasesByDevice(this.db, now);
      if (leased.size === 0) return;
      const udids = [...new Set([...leased.values()].map((lease) => lease.deviceUdid))];
      rows = (await this.store.getDevices({ udid: udids })) ?? [];
    } catch (err) {
      this.logger.warn(`couldn't lock leased phones again: ${(err as Error)?.message ?? err}`);
      return;
    }
    // Each phone on its own: one that can't be written doesn't keep the
    // others free.
    for (const device of rows) {
      const lease = leased.get(leaseKey(device.udid, device.host));
      if (!lease || device.busy || device.offline || !isUnheld(device)) continue;
      try {
        // lastCmdExecutedAt, as keepLeaseLock: should this lock outlive its
        // lease, the idle sweeper still frees the phone.
        await this.store.updateDevice(device.udid, device.host, {
          busy: true,
          lastCmdExecutedAt: Date.now(),
        });
        if (!(await activeLeaseOn(device.udid, device.host, this.db))) {
          await this.store.releaseLeaseLock(device.udid, device.host);
          continue;
        }
        this.logger.info(
          `${device.udid} at ${device.host} was free on record; locked again for lease ${lease.id}`,
        );
      } catch (err) {
        this.logger.warn(
          `couldn't lock ${device.udid} at ${device.host} again for lease ${lease.id}: ` +
            `${(err as Error)?.message ?? err}`,
        );
      }
    }
  }

  /**
   * A waiting lease whose stored request a pass can't read: it is neither
   * served nor counted (positionOf), and holds nothing. Warned once per lease.
   */
  private async setAside(state: PassState, leaseId: string, holds: HeldRow[]): Promise<void> {
    if (!this.unreadable.has(leaseId)) {
      if (this.unreadable.size >= 10_000) this.unreadable.clear();
      this.unreadable.add(leaseId);
      this.logger.warn(`waiting lease ${leaseId} has no request a pass can read; it isn't served`);
    }
    if (holds.length === 0) return;
    await this.db.leaseMember.deleteMany({
      where: { leaseId, id: { in: holds.map((h) => h.id) } },
    });
    for (const h of holds) {
      await this.releaseLock(leaseId, h.key);
      state.taken.delete(h.key);
    }
    state.changed.add(leaseId);
  }

  /**
   * The head's turn. True when the waiter is the head that stays waiting;
   * false when it was granted or is gone, so the next waiter is the head.
   *
   * A hold whose phone has no Device row now stays as it is: a hub clears its
   * own rows at boot and finds the phones again, and a hold is respected once
   * its phone is back. Its member keeps it, and the head isn't granted until
   * it is back. Dropping such a hold is the sweeper's (LeaseOrphanSweeper).
   */
  private async serveHead(state: PassState, waiter: Waiter): Promise<boolean> {
    const members = waiter.filters.length;
    const present = await this.presentKeys(waiter.holds);
    const absent = waiter.holds.filter((h) => !present.has(h.key));
    const pinned = new Map<number, string>();
    for (const h of absent) if (h.index >= 0 && h.index < members) pinned.set(h.index, h.key);
    const keepAsIs = new Set(absent.map((h) => h.id));
    const own = new Set(waiter.holds.filter((h) => present.has(h.key)).map((h) => h.key));

    const matchNow = async (): Promise<{ match: (string | null)[]; candidates: Candidates }> => {
      const candidates = await this.candidates(state, waiter.filters, waiter.callerTeamIds, own);
      const open = waiter.filters.map((_f, index) => index).filter((i) => !pinned.has(i));
      const sub = maxMatching(
        open.map((i) => candidates.keys[i]),
        open.map((i) => {
          const h = waiter.holds.find((row) => row.index === i && present.has(row.key));
          return h?.key ?? null;
        }),
      );
      const match: (string | null)[] = waiter.filters.map((_f, i) => pinned.get(i) ?? null);
      open.forEach((i, at) => {
        match[i] = sub[at];
      });
      return { match, candidates };
    };

    let { match, candidates } = await matchNow();
    if (pinned.size === 0 && filledCount(match) === members) {
      // A grant has exactly the members asked for. A row under an index no
      // member has (a move cut short) whose phone is away holds no member's
      // place, so it goes now rather than outlive the grant.
      const strays = waiter.holds.filter(
        (h) => keepAsIs.has(h.id) && (h.index < 0 || h.index >= members),
      );
      if (strays.length > 0) {
        await this.db.leaseMember.deleteMany({
          where: { leaseId: waiter.id, id: { in: strays.map((h) => h.id) } },
        });
        for (const h of strays) {
          await this.releaseLock(waiter.id, h.key);
          state.taken.delete(h.key);
          keepAsIs.delete(h.id);
        }
        waiter.holds = waiter.holds.filter((h) => !strays.includes(h));
        state.changed.add(waiter.id);
      }
      let heldKeys = own;
      let ready = !this.reservationFailed(state);
      // A present hold under such an index is seated first: the grant writes
      // members by index and wouldn't remove it.
      if (waiter.holds.some((h) => h.index < 0 || h.index >= members)) {
        heldKeys = await this.hold(state, waiter, match, keepAsIs);
        // Locked just now, so their rows are there.
        for (const key of heldKeys) present.add(key);
        ready &&= match.every((key) => heldKeys.has(key as string));
      }
      if (ready) {
        const outcome = await this.granter.grant(
          this.groupRow(waiter, heldKeys),
          match.map((key) => candidates.devices.get(key as string) as IDevice),
        );
        if (outcome === 'granted') {
          state.changed.add(waiter.id);
          for (const key of match) state.taken.add(key as string);
          for (const key of heldKeys) if (!match.includes(key)) state.taken.delete(key);
          return false;
        }
        if (outcome === 'gone') {
          state.changed.add(waiter.id);
          for (const key of heldKeys) state.taken.delete(key);
          return false;
        }
      }
      // Failed: a phone was taken since it was read, or its port reservation
      // failed (now skipped), or one already failed under this hold, so none
      // was tried. The waiter keeps its place and holds what it can.
      state.reads.clear();
      waiter.holds = await this.currentHolds(waiter.id);
      own.clear();
      for (const h of waiter.holds) if (present.has(h.key)) own.add(h.key);
      ({ match, candidates } = await matchNow());
    }

    const held = await this.hold(state, waiter, match, keepAsIs);
    for (const key of held) state.forHead.add(key);
    for (const key of match) if (key !== null) state.forHead.add(key);
    return true;
  }

  /** The waiter's member rows as they are now. */
  private async currentHolds(leaseId: string): Promise<HeldRow[]> {
    const rows: any[] = await this.db.leaseMember.findMany({ where: { leaseId } });
    return heldRows({ members: rows });
  }

  /** Which of these holds' phones have a Device row. */
  private async presentKeys(holds: HeldRow[]): Promise<Set<string>> {
    if (holds.length === 0) return new Set();
    const udids = [...new Set(holds.map((h) => h.key.slice(0, h.key.indexOf('@'))))];
    const rows: IDevice[] = (await this.store.getDevices({ udid: udids })) ?? [];
    return new Set(rows.map((d) => leaseKey(d.udid, d.host)));
  }

  /**
   * Makes the waiter's holds the phones of `match`: lets go of the others
   * (except the rows in `keepAsIs`, left exactly as they are), moves a hold
   * whose member changed, locks and writes the new ones. Answers the keys
   * held afterwards.
   */
  private async hold(
    state: PassState,
    waiter: Waiter,
    match: (string | null)[],
    keepAsIs: Set<string> = new Set(),
  ): Promise<Set<string>> {
    const wanted = new Map<string, number>();
    match.forEach((key, index) => {
      if (key !== null) wanted.set(key, index);
    });

    const movable = waiter.holds.filter((h) => !keepAsIs.has(h.id));
    const dropped = movable.filter((h) => !wanted.has(h.key));
    const moved = movable.filter((h) => wanted.has(h.key) && wanted.get(h.key) !== h.index);
    const kept = new Set(waiter.holds.filter((h) => wanted.has(h.key)).map((h) => h.key));
    const added = [...wanted.entries()].filter(([key]) => !kept.has(key));

    if (dropped.length > 0) {
      await this.db.leaseMember.deleteMany({
        where: { leaseId: waiter.id, id: { in: dropped.map((h) => h.id) } },
      });
      for (const h of dropped) {
        await this.releaseLock(waiter.id, h.key);
        state.taken.delete(h.key);
      }
      state.changed.add(waiter.id);
    }

    // Each member's index is unique within the lease, so a moved hold goes
    // through an index of its own first: below every index a row of the lease
    // has, a leftover of a move cut short included.
    const lowest = Math.min(-1, ...waiter.holds.map((h) => h.index));
    for (const [i, h] of moved.entries()) {
      await this.db.leaseMember.update({ where: { id: h.id }, data: { index: lowest - 1 - i } });
    }
    for (const h of moved) {
      await this.db.leaseMember.update({
        where: { id: h.id },
        data: { index: wanted.get(h.key) as number },
      });
    }
    if (moved.length > 0) state.changed.add(waiter.id);

    const locked: Array<{ index: number; device: IDevice }> = [];
    const held = new Set(kept);
    let written = false;
    try {
      for (const [key, index] of added) {
        const device = await this.lockPhone(key);
        if (device) locked.push({ index, device });
      }
      if (locked.length > 0) {
        const now = Date.now();
        await this.db.lease.update({
          where: { id: waiter.id, status: 'waiting' },
          data: {
            members: {
              create: locked.map(({ index, device }) => ({
                index,
                udid: device.udid,
                host: device.host,
                heldAt: now,
              })),
            },
          },
        });
        written = true;
      }
    } catch (err) {
      // No longer waiting: its holder gave up, or the sweeper ended it.
      if ((err as { code?: string })?.code === 'P2025') return held;
      throw err;
    } finally {
      // Whatever went wrong, the phones locked here and not written as holds
      // go back.
      if (!written) {
        for (const { device } of locked) {
          await this.releaseLock(waiter.id, leaseKey(device.udid, device.host));
        }
      }
    }
    for (const { device } of locked) {
      const key = leaseKey(device.udid, device.host);
      held.add(key);
      state.taken.add(key);
    }
    if (locked.length > 0) state.changed.add(waiter.id);
    return held;
  }

  /** A later waiter: granted only on a full match from what the head can't use. */
  private async backfill(state: PassState, waiter: Waiter): Promise<void> {
    // Only the head holds. A later waiter's holds (none, unless a pass went
    // wrong) are its own candidates, and let go when it isn't granted, except
    // one whose phone has no Device row, which the sweeper decides about.
    const present = await this.presentKeys(waiter.holds);
    const own = new Set(waiter.holds.filter((h) => present.has(h.key)).map((h) => h.key));
    const keepAsIs = new Set(waiter.holds.filter((h) => !present.has(h.key)).map((h) => h.id));
    const candidates = await this.candidates(state, waiter.filters, waiter.callerTeamIds, own);
    const match = maxMatching(candidates.keys);
    const full = keepAsIs.size === 0 && filledCount(match) === waiter.filters.length;
    // After a failed reservation under this hold it waits for the next pass.
    if (full && !this.reservationFailed(state)) {
      const outcome = await this.granter.grant(
        this.groupRow(waiter, own),
        match.map((key) => candidates.devices.get(key as string) as IDevice),
      );
      if (outcome !== 'failed') state.changed.add(waiter.id);
      if (outcome === 'granted') {
        for (const key of match) state.taken.add(key as string);
        return;
      }
      if (outcome === 'gone') return;
      // Failed: what it took is given back, and a phone whose ports failed
      // is skipped. Read again for the waiters after it.
      state.reads.clear();
      waiter.holds = await this.currentHolds(waiter.id);
    }
    if (waiter.holds.length > keepAsIs.size) {
      const none = waiter.filters.map(() => null);
      await this.hold(state, waiter, none, keepAsIs);
    }
  }

  /**
   * tryNow's request, as the last backfill of the pass it has just run. Each
   * matched phone is locked here before the grant, so a phone the lock
   * refuses is known and left out of the next match; the grant then fails
   * only on a port reservation (that phone, or its server, is skipped from
   * then on, and no other grant is tried under this hold) or on something
   * else, which is thrown.
   */
  private async tryRequest(state: PassState, request: TryNowRequest): Promise<TryNowOutcome> {
    const filters = request.members.map((member) => member.filters);
    const leaseId = uuidv4();
    const createData: GroupLeaseCreateData = {
      tokenHash: request.tokenHash,
      actorId: request.actorId,
      teamId: request.teamId,
      buildId: request.buildId ?? null,
      reason: request.reason ?? null,
      heartbeatSeconds: request.heartbeatSeconds,
      requestedMembers: JSON.stringify(filters),
      callerTeamIds:
        request.callerTeamIds === undefined ? null : JSON.stringify(request.callerTeamIds),
      durationMs: request.durationMs,
    };
    /** Phones the lock refused: taken since they were read. */
    const refused = new Set<string>();

    // The queue's pass, just now under this hold, had a grant fail on its
    // ports: this request tries none. Phones it could have mean busy for a
    // moment (retry), as nothing of its own failed.
    if (this.reservationFailed(state)) {
      const free = await this.candidates(state, filters, request.callerTeamIds, new Set());
      if (filledCount(maxMatching(free.keys)) === filters.length) return 'busy';
    }

    // One grant at most: it is granted, fails on a port reservation (the
    // loop ends) or throws. Only a lock the store refuses tries again, on
    // the phones left, and each refusal leaves one out.
    while (!this.reservationFailed(state)) {
      const candidates = await this.candidates(state, filters, request.callerTeamIds, new Set(), {
        exclude: refused,
      });
      const match = maxMatching(candidates.keys) as string[];
      if (filledCount(match) < filters.length) break;

      // Locked here for this try; given back unless the grant took them, also
      // when a lock or the grant throws.
      const locked: string[] = [];
      let granted = false;
      try {
        let lockRefused = false;
        for (const key of match) {
          if (await this.lockPhone(key)) {
            locked.push(key);
            continue;
          }
          refused.add(key);
          lockRefused = true;
          break;
        }
        if (lockRefused) continue;

        const outcome = await this.granter.grant(
          {
            id: leaseId,
            status: 'trying',
            durationMs: request.durationMs,
            buildId: request.buildId ?? null,
            // Locked above, so the grant takes no lock of its own. A failed
            // grant keeps them held: the `finally` gives them back.
            heldKeys: new Set(locked),
            createData,
          },
          match.map((key) => candidates.devices.get(key) as IDevice),
        );
        if (outcome === 'granted') {
          granted = true;
          for (const key of match) state.taken.add(key);
          return { leaseId };
        }
        if (!this.reservationFailed(state)) {
          // Not a port reservation: the lease couldn't be written.
          throw new Error(`lease ${leaseId}: couldn't be granted on ${match.join(', ')}`);
        }
      } finally {
        if (!granted) for (const key of locked) await this.releaseLock(leaseId, key);
      }
      state.reads.clear();
    }

    // Busy, unless the skipped phones would have filled it.
    const withSkipped = await this.candidates(state, filters, request.callerTeamIds, new Set(), {
      exclude: refused,
      includeSkipped: true,
    });
    return filledCount(maxMatching(withSkipped.keys)) === filters.length ? 'unhealthy' : 'busy';
  }

  /**
   * Each member's candidates: the phones matching its filters that the
   * request's teams can see, that a lease may take now and no failed port
   * reservation is skipping, that no lease holds or leases and the head
   * neither holds nor matched; plus the request's own holds (`own`) where
   * they still match and could be taken.
   */
  private async candidates(
    state: PassState,
    filters: LeaseFilters[],
    callerTeamIds: string[] | undefined,
    own: Set<string>,
    { includeSkipped = false, exclude }: { includeSkipped?: boolean; exclude?: Set<string> } = {},
  ): Promise<Candidates> {
    const devices = new Map<string, IDevice>();
    const keys: string[][] = [];
    // A phone whose server this one can't reserve ports on (another
    // server's, with no node credentials) is never granted, so it is no
    // candidate: a lease that also matches an own phone gets that one.
    const reachable = new Map<string, boolean>();
    const reaches = async (host: string) => {
      if (!this.authProvider.reaches) return true;
      if (!reachable.has(host)) reachable.set(host, await this.authProvider.reaches(host));
      return reachable.get(host) as boolean;
    };
    for (const memberFilters of filters) {
      const matching = (await this.read(state, memberFilters, callerTeamIds)).filter(
        memberMatches(memberFilters),
      );
      const accepted: string[] = [];
      for (const device of matching) {
        const key = leaseKey(device.udid, device.host);
        if (exclude?.has(key)) continue;
        if (!includeSkipped && this.granter.isSkipped(key, state.now)) continue;
        if (!(await reaches(String(device.host)))) continue;
        if (own.has(key)) {
          // Held, so busy by its own lease's lock: judged as if free.
          if (!leasable({ ...device, busy: false }, state.now)) continue;
        } else if (!leasable(device, state.now) || state.taken.has(key) || state.forHead.has(key)) {
          continue;
        }
        accepted.push(key);
        devices.set(key, device);
      }
      keys.push(accepted);
    }
    return { keys, devices };
  }

  /** The store's phones for one member's filters and the request's teams, once a pass. */
  private read(
    state: PassState,
    filters: LeaseFilters,
    callerTeamIds: string[] | undefined,
  ): Promise<IDevice[]> {
    const query = { ...clientFilters(filters), ...teamScope(callerTeamIds) };
    const cacheKey = JSON.stringify(query);
    let read = state.reads.get(cacheKey);
    if (!read) {
      read = Promise.resolve(this.store.getDevices(query)).then((d: IDevice[] | null) => d ?? []);
      state.reads.set(cacheKey, read);
    }
    return read;
  }

  private groupRow(waiter: Waiter, own: Set<string>): GroupLeaseRow {
    return {
      id: waiter.id,
      status: 'waiting',
      durationMs: waiter.durationMs,
      buildId: waiter.buildId,
      heldKeys: new Set(own),
    };
  }

  /** The phone, locked by its exact udid and host (lockExactPhone), or null. */
  private lockPhone(key: string): Promise<IDevice | null> {
    const at = key.indexOf('@');
    return lockExactPhone(this.store, key.slice(0, at), key.slice(at + 1));
  }

  /** The lease's lock only: a session or hold on the phone keeps it busy. */
  private async releaseLock(leaseId: string, key: string): Promise<void> {
    const at = key.indexOf('@');
    try {
      await this.store.releaseLeaseLock(key.slice(0, at), key.slice(at + 1));
    } catch (err) {
      this.logger.warn(`lease ${leaseId}: couldn't release ${key}: ${(err as Error).message}`);
    }
  }
}
