import { Service } from 'typedi';
import { v4 as uuidv4 } from 'uuid';
import { prisma as defaultPrisma } from '../../prisma';
import { DeviceStoreFactory } from '../../data-service/device-store';
import { withAllocationLock } from '../../device-utils';
import type { IDevice } from '../../interfaces/IDevice';
import log from '../../logger';
import { PortAllocatorClient } from '../ports/PortAllocatorClient';
import { leaseKey, leasedDeviceKeys } from './activeLeases';
import { clientFilters, leasable, LeaseFilters, nameMatches, teamScope } from './leaseFilters';
import { GrantPortClient, GroupLeaseRow, LeaseGranter } from './LeaseGranter';
import { defaultNodePairAuthProvider, NodePairAuthProvider } from './LeaseService';
import { onPhoneFreed } from './leaseQueueKick';
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

/** How often the backstop pass runs (start's default). */
export const LEASE_QUEUE_INTERVAL_MS = 5_000;

/** How many grants one request may try before it is answered. */
const MAX_GRANT_TRIES = 8;

interface HeldRow {
  id: string;
  index: number;
  key: string;
  heldAt: number;
}

/** A waiting lease row as a pass reads it. */
interface Waiter {
  id: string;
  durationMs: number;
  buildId: string | null;
  filters: LeaseFilters[];
  callerTeamIds: string[] | undefined;
  holds: HeldRow[];
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
}

/**
 * The queue of waiting leases, and its grant passes.
 *
 * The queue is the `waiting` lease rows still inside their `waitUntil`, in
 * `createdAt` order, ties by id: one server's queue. A pass goes down it
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
 *    new index, and a hold out of the matching is let go.
 * 3. Each later waiter is granted only if it can be filled completely from
 *    free phones the head neither holds nor matched. It never holds.
 *
 * A free phone is one a lease may take now (`leasable`), that no lease holds
 * or leases, that the request's stored teams can see, and that no failed
 * port reservation is skipping (LeaseGranter.isSkipped).
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
  private interval?: NodeJS.Timeout;
  private unsubscribe?: () => void;

  constructor(
    private readonly db: any = defaultPrisma,
    private readonly store: any = DeviceStoreFactory.getStore(),
    portClient: any = new PortAllocatorClient(),
    authProvider: NodePairAuthProvider = defaultNodePairAuthProvider(),
  ) {
    this.granter = new LeaseGranter(db, store, portClient as GrantPortClient, authProvider);
  }

  /** One grant pass. Never throws: a failure is logged, and the next pass tries again. */
  async pass(): Promise<void> {
    let state: PassState | undefined;
    try {
      await withAllocationLock(async () => {
        this.kickWaiting = undefined;
        state = this.newState();
        await this.serveQueue(state);
      });
    } catch (err) {
      this.logger.warn(`a grant pass failed: ${(err as Error)?.message ?? err}`);
    }
    if (state) this.notify(state.changed);
  }

  /** Runs one pass soon. Kicks before that pass has the lock are that one pass. */
  kick(): void {
    if (this.kickTimer || this.kickWaiting) return;
    this.kickTimer = setTimeout(() => {
      this.kickTimer = undefined;
      const mine = {};
      this.kickWaiting = mine;
      void this.pass().finally(() => {
        if (this.kickWaiting === mine) this.kickWaiting = undefined;
      });
    }, 0);
    this.kickTimer.unref?.();
  }

  /** The backstop timer and the phoneFreed() subscription. */
  start(intervalMs: number = LEASE_QUEUE_INTERVAL_MS): void {
    this.stop();
    this.interval = setInterval(() => this.kick(), intervalMs);
    this.interval.unref?.();
    this.unsubscribe = onPhoneFreed(() => this.kick());
  }

  stop(): void {
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
   * Errors other than a failed grant propagate.
   */
  async tryNow(request: TryNowRequest): Promise<TryNowOutcome> {
    let state: PassState | undefined;
    try {
      return await withAllocationLock(async () => {
        this.kickWaiting = undefined;
        state = this.newState();
        await this.serveQueue(state);
        return this.tryRequest(state, request);
      });
    } finally {
      if (state) this.notify(state.changed);
    }
  }

  /** The lease's place in the queue, 1 for the head; null when it isn't waiting. */
  async positionOf(leaseId: string): Promise<number | null> {
    const rows: Array<{ id: string }> = await this.db.lease.findMany({
      where: this.queueWhere(Date.now()),
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    const at = rows.findIndex((row) => row.id === leaseId);
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
    };
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

  /** The waiting leases still inside their wait. */
  private queueWhere(now: number) {
    return { status: 'waiting', OR: [{ waitUntil: null }, { waitUntil: { gte: now } }] };
  }

  /** Steps 1 to 3 of a pass, for every waiter. The caller holds the lock. */
  private async serveQueue(state: PassState): Promise<void> {
    const rows: any[] = await this.db.lease.findMany({
      where: this.queueWhere(state.now),
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: { members: true },
    });
    if (rows.length === 0) return;
    for (const key of await leasedDeviceKeys(this.db)) state.taken.add(key);

    let headFound = false;
    for (const row of rows) {
      const waiter = this.readWaiter(row);
      if (!waiter) continue;
      if (headFound) {
        await this.backfill(state, waiter);
        continue;
      }
      headFound = await this.serveHead(state, waiter);
    }
  }

  /** A row as a waiter, or null (logged) when its request can't be read. */
  private readWaiter(row: any): Waiter | null {
    let filters: unknown;
    let teams: unknown = null;
    try {
      filters = JSON.parse(row.requestedMembers ?? 'null');
      teams = row.callerTeamIds == null ? null : JSON.parse(row.callerTeamIds);
    } catch {
      filters = null;
    }
    const validTeams =
      teams === null || (Array.isArray(teams) && teams.every((t) => typeof t === 'string'));
    if (!Array.isArray(filters) || filters.length === 0 || !validTeams) {
      this.logger.warn(`waiting lease ${row.id} has no request a pass can read; left as it is`);
      return null;
    }
    return {
      id: row.id,
      durationMs: row.durationMs ?? 0,
      buildId: row.buildId ?? null,
      filters: filters as LeaseFilters[],
      callerTeamIds: teams === null ? undefined : (teams as string[]),
      holds: (row.members ?? []).map((m: any) => ({
        id: m.id,
        index: m.index,
        key: leaseKey(m.udid, m.host),
        heldAt: m.heldAt,
      })),
    };
  }

  /**
   * The head's turn. True when the waiter is the head that stays waiting;
   * false when it was granted or is gone, so the next waiter is the head.
   */
  private async serveHead(state: PassState, waiter: Waiter): Promise<boolean> {
    const own = new Set(waiter.holds.map((h) => h.key));
    const prefer = waiter.filters.map(
      (_f, index) => waiter.holds.find((h) => h.index === index)?.key ?? null,
    );
    let candidates = await this.candidates(state, waiter.filters, waiter.callerTeamIds, own);
    let match = maxMatching(candidates.keys, prefer);

    if (filledCount(match) === waiter.filters.length) {
      const outcome = await this.granter.grant(
        this.groupRow(waiter, own),
        match.map((key) => candidates.devices.get(key as string)!),
      );
      if (outcome === 'granted') {
        state.changed.add(waiter.id);
        for (const key of match) state.taken.add(key as string);
        for (const key of own) if (!match.includes(key)) state.taken.delete(key);
        return false;
      }
      if (outcome === 'gone') {
        state.changed.add(waiter.id);
        for (const key of own) state.taken.delete(key);
        return false;
      }
      // Failed: a phone was taken since it was read, or its port reservation
      // failed (now skipped). The waiter keeps its place and holds what it can.
      state.reads.clear();
      candidates = await this.candidates(state, waiter.filters, waiter.callerTeamIds, own);
      match = maxMatching(candidates.keys, prefer);
    }

    const held = await this.hold(state, waiter, match);
    for (const key of held) state.forHead.add(key);
    for (const key of match) if (key !== null) state.forHead.add(key);
    return true;
  }

  /**
   * Makes the head's holds the phones of `match`: lets go of the others,
   * moves a hold whose member changed, locks and writes the new ones.
   * Answers the keys held afterwards.
   */
  private async hold(
    state: PassState,
    waiter: Waiter,
    match: (string | null)[],
  ): Promise<Set<string>> {
    const wanted = new Map<string, number>();
    match.forEach((key, index) => {
      if (key !== null) wanted.set(key, index);
    });

    const dropped = waiter.holds.filter((h) => !wanted.has(h.key));
    const moved = waiter.holds.filter((h) => wanted.has(h.key) && wanted.get(h.key) !== h.index);
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
    // through an index no member has before it takes its new one.
    for (const h of moved) {
      await this.db.leaseMember.update({
        where: { id: h.id },
        data: { index: -1 - wanted.get(h.key)! },
      });
    }
    for (const h of moved) {
      await this.db.leaseMember.update({
        where: { id: h.id },
        data: { index: wanted.get(h.key)! },
      });
    }
    if (moved.length > 0) state.changed.add(waiter.id);

    const locked: Array<{ index: number; device: IDevice }> = [];
    for (const [key, index] of added) {
      const device = await this.lockPhone(key);
      if (device) locked.push({ index, device });
    }
    const held = new Set(kept);
    if (locked.length > 0) {
      const now = Date.now();
      try {
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
      } catch (err) {
        for (const { device } of locked) {
          await this.releaseLock(waiter.id, leaseKey(device.udid, device.host));
        }
        // No longer waiting: its holder gave up, or the sweeper ended it.
        if ((err as { code?: string })?.code === 'P2025') return held;
        throw err;
      }
      for (const { device } of locked) {
        const key = leaseKey(device.udid, device.host);
        held.add(key);
        state.taken.add(key);
      }
      state.changed.add(waiter.id);
    }
    return held;
  }

  /** A later waiter: granted only on a full match from what the head can't use. */
  private async backfill(state: PassState, waiter: Waiter): Promise<void> {
    // Only the head holds. A later waiter's holds (none, unless a pass went
    // wrong) are its own candidates, and let go when it isn't granted.
    const own = new Set(waiter.holds.map((h) => h.key));
    const candidates = await this.candidates(state, waiter.filters, waiter.callerTeamIds, own);
    const match = maxMatching(candidates.keys);
    if (filledCount(match) === waiter.filters.length) {
      const outcome = await this.granter.grant(
        this.groupRow(waiter, own),
        match.map((key) => candidates.devices.get(key as string)!),
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
    }
    if (waiter.holds.length > 0) {
      const none = waiter.filters.map(() => null);
      await this.hold(state, waiter, none);
    }
  }

  /** tryNow's request, as the last backfill of the pass it has just run. */
  private async tryRequest(state: PassState, request: TryNowRequest): Promise<TryNowOutcome> {
    const filters = request.members.map((member) => member.filters);
    const leaseId = uuidv4();
    const row: GroupLeaseRow = {
      id: leaseId,
      status: 'trying',
      durationMs: request.durationMs,
      buildId: request.buildId ?? null,
      heldKeys: new Set(),
      createData: {
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
      },
    };

    let failed: string | undefined;
    for (let tries = 0; tries < MAX_GRANT_TRIES; tries++) {
      const candidates = await this.candidates(state, filters, request.callerTeamIds, new Set());
      const match = maxMatching(candidates.keys);
      if (filledCount(match) < filters.length) break;
      // The same phones as the grant that just failed, none of them to blame
      // (a failed write): trying again would fail again.
      const phones = match.join(' ');
      if (phones === failed) break;
      const outcome = await this.granter.grant(
        row,
        match.map((key) => candidates.devices.get(key as string)!),
      );
      if (outcome === 'granted') {
        for (const key of match) state.taken.add(key as string);
        return { leaseId };
      }
      failed = phones;
      // Its phones may have changed: read them again.
      state.reads.clear();
    }

    // Busy, unless the skipped phones would have filled it.
    const withSkipped = await this.candidates(state, filters, request.callerTeamIds, new Set(), {
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
    { includeSkipped = false }: { includeSkipped?: boolean } = {},
  ): Promise<Candidates> {
    const devices = new Map<string, IDevice>();
    const keys: string[][] = [];
    for (const memberFilters of filters) {
      const matching = (await this.read(state, memberFilters, callerTeamIds)).filter(
        nameMatches(memberFilters.deviceName),
      );
      const accepted: string[] = [];
      for (const device of matching) {
        const key = leaseKey(device.udid, device.host);
        if (!includeSkipped && this.granter.isSkipped(key, state.now)) continue;
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

  /** The phone, locked by its exact udid and host, or null. */
  private async lockPhone(key: string): Promise<IDevice | null> {
    const at = key.indexOf('@');
    const udid = key.slice(0, at);
    const host = key.slice(at + 1);
    const locked = await this.store.findAndLockDevice({ udid: [udid], filterByHost: host });
    if (!locked) return null;
    if (locked.udid === udid && locked.host === host) return locked;
    // The host filter is a substring match: another row of that udid was
    // locked. Give it back.
    await this.store.updateDevice(locked.udid, locked.host, { busy: false });
    return null;
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
