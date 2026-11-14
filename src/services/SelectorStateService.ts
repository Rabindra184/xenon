import { Container, Service } from 'typedi';
import { prisma as defaultPrisma } from '../prisma';
import { SocketServer } from './SocketServer';
import { SocketEvents } from '../enums/SocketEvents';
import log from '../logger';
import type { SelectorState } from '../generated/client';
import {
  NO_FIX,
  SelectorStatus,
  WATCHED_STATUSES,
  keepsRowWhenActive,
} from './selector-health/selectorStatus';

/**
 * Thrown when a state-machine transition is invalid for the row's current
 * status (e.g. trying to mark a muted selector as fixed). Callers in the
 * router layer should map this to HTTP 409.
 */
export class SelectorStateConflictError extends Error {
  constructor(
    message: string,
    public currentStatus: string,
  ) {
    super(message);
    this.name = 'SelectorStateConflictError';
  }
}

/** Identifies the (strategy, selector) tuple a transition operates on. */
export interface SelectorTuple {
  strategy: string;
  selector: string;
}

/** What happened to a selector, as a SelectorEvent row records it. */
export type SelectorEventAction =
  | 'marked_fixed'
  | 'verification_cancelled'
  | 'verified'
  | 'broke_again'
  | 'muted'
  | 'unmuted';

export interface ActorContext extends SelectorTuple {
  /** API key id of the caller, for the older `*_by_api_key` columns; '' for a dashboard user. */
  apiKeyId: string;
  /** The person acting (`resolveActor(req).userId`), recorded on the SelectorEvent. */
  userId?: string | null;
  /** Why the selector is muted. Mute only. */
  reason?: string | null;
}

export interface HealRecordedContext extends SelectorTuple {
  sessionId: string;
}

/**
 * Minimal subset of `prisma.selectorState` we depend on. Defining the shape
 * locally lets tests pass plain Sinon stubs in via the constructor without
 * pulling Prisma's full type surface into the test file.
 */
interface SelectorStateDelegate {
  findUnique(args: any): Promise<SelectorState | null>;
  upsert(args: any): Promise<SelectorState>;
  create(args: any): Promise<SelectorState>;
  update(args: any): Promise<SelectorState>;
  updateMany(args: any): Promise<{ count: number }>;
  deleteMany(args: any): Promise<{ count: number }>;
}

interface SelectorEventDelegate {
  create(args: any): Promise<unknown>;
}

/** The tables one change writes, inside its transaction. */
export interface SelectorWriteTx {
  selectorState: SelectorStateDelegate;
  selectorEvent: SelectorEventDelegate;
}

interface PrismaLike extends SelectorWriteTx {
  $transaction<T>(fn: (tx: SelectorWriteTx) => Promise<T>): Promise<T>;
}

/** Sends a selector's event to the dashboards whose caller may see the selector. */
interface SocketLike {
  emitToDashboardForSelector(event: string, data: any, selector: SelectorTuple): Promise<void>;
}

const scopedLog = log.scope('SelectorState');

/** Compound-key `where` clause for the (strategy, selector) unique index. */
function whereTuple(strategy: string, selector: string) {
  return {
    original_strategy_original_selector: {
      original_strategy: strategy,
      original_selector: selector,
    },
  };
}

/** Just the selector a change is about, for the socket server's scoped emit. */
function selectorOf(tuple: SelectorTuple): SelectorTuple {
  return { strategy: tuple.strategy, selector: tuple.selector };
}

/** The SelectorEvent row for one change. */
export function selectorEventData(
  tuple: SelectorTuple,
  action: SelectorEventAction,
  userId?: string | null,
  reason?: string | null,
) {
  return {
    data: {
      original_strategy: tuple.strategy,
      original_selector: tuple.selector,
      action,
      user_id: userId ?? null,
      reason: reason ?? null,
    },
  };
}

/**
 * Convert a SelectorState row into a plain object with ISO-8601 timestamps
 * suitable for socket.io broadcast and JSON serialization.
 */
function serialize(row: SelectorState) {
  return {
    id: row.id,
    original_strategy: row.original_strategy,
    original_selector: row.original_selector,
    status: row.status,
    fixed_at: row.fixed_at ? row.fixed_at.toISOString() : null,
    fixed_by_api_key: row.fixed_by_api_key,
    resolved_at: row.resolved_at ? row.resolved_at.toISOString() : null,
    muted_at: row.muted_at ? row.muted_at.toISOString() : null,
    muted_by_api_key: row.muted_by_api_key,
    regression_count: row.regression_count,
    clean_builds_count: row.clean_builds_count,
    last_event_at: row.last_event_at ? row.last_event_at.toISOString() : null,
    createdAt: row.createdAt ? row.createdAt.toISOString() : null,
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
  };
}

/**
 * A person's change (mark fixed, unmute, cancel) reads the row, decides, then
 * writes only where the row is still as it read it: the same status and
 * `regression_count` (`asRead`). If it isn't (a heal, a mute or another
 * person's change committed in between), the write changes nothing, the
 * transaction throws this and rolls back, and the change starts again from a
 * fresh read, which then decides: a 409 when the new status doesn't allow it,
 * or the row as it is. Through 2.36 they read and then wrote by key alone, so
 * a mute landing in between ended `pending` with `muted_at` set, and a heal
 * landing during a cancel had its regression deleted with the row.
 */
class ChangedMeanwhile extends Error {
  constructor() {
    super('the selector changed while this change was being written');
    this.name = 'ChangedMeanwhile';
  }
}

/** How often a person's change starts again after the row changed under it. */
const MAX_ATTEMPTS = 3;

/** The row as a change read it: written only while it still is. */
function asRead(row: SelectorState) {
  return {
    original_strategy: row.original_strategy,
    original_selector: row.original_selector,
    status: row.status,
    regression_count: row.regression_count,
  };
}

/** Throws `ChangedMeanwhile` when a conditional write changed no row. */
function changedOne({ count }: { count: number }): void {
  if (count === 0) throw new ChangedMeanwhile();
}

/** Another change created the row first (the unique key on strategy and selector). */
function isCreatedMeanwhile(err: any): boolean {
  return err?.code === 'P2002';
}

/**
 * Sends a muted or pending selector back to "To fix": the row is kept as
 * `active`, with no fix and no mute on it, when it has something to show
 * (`keepsRowWhenActive`), else deleted. Unmute and cancelVerification both
 * end this way, inside their transaction, and only while the row is as they
 * read it.
 */
async function toActive(
  tx: SelectorWriteTx,
  tuple: SelectorTuple,
  existing: SelectorState,
): Promise<SelectorState | null> {
  if (!keepsRowWhenActive(existing)) {
    changedOne(await tx.selectorState.deleteMany({ where: asRead(existing) }));
    return null;
  }
  changedOne(
    await tx.selectorState.updateMany({
      where: asRead(existing),
      data: {
        status: 'active' satisfies SelectorStatus,
        ...NO_FIX,
        muted_at: null,
        muted_by_api_key: null,
        last_event_at: new Date(),
      },
    }),
  );
  return tx.selectorState.findUnique({ where: whereTuple(tuple.strategy, tuple.selector) });
}

/**
 * Owns SelectorState lifecycle transitions. Every transition is idempotent
 * where the spec allows, emits the corresponding `SELECTOR_*` socket event,
 * and uses lazy row creation — rows only exist once a user has taken an
 * action against the selector. Each change and its SelectorEvent are one
 * transaction, so the status and its history can't disagree.
 *
 * The constructor accepts both prisma + socket as parameters (defaulting to
 * the real implementations) so tests can pass Sinon stubs without going
 * through TypeDI.
 */
@Service()
export class SelectorStateService {
  private readonly prisma: PrismaLike;
  private readonly socket: SocketLike;

  constructor(prisma?: PrismaLike, socket?: SocketLike) {
    this.prisma = prisma ?? (defaultPrisma as unknown as PrismaLike);
    this.socket = socket ?? Container.get(SocketServer);
  }

  /**
   * Run a person's change, starting again from a fresh read while the row
   * changed under it (`ChangedMeanwhile`) or was created by another change
   * first (P2002). After `MAX_ATTEMPTS` it answers 409 with the row's status.
   */
  private async retrying<T>(ctx: SelectorTuple, change: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await change();
      } catch (err) {
        if (!(err instanceof ChangedMeanwhile) && !isCreatedMeanwhile(err)) throw err;
        if (attempt >= MAX_ATTEMPTS) {
          const current = await this.prisma.selectorState.findUnique({
            where: whereTuple(ctx.strategy, ctx.selector),
          });
          throw new SelectorStateConflictError(
            `The selector kept changing while this change was being made (${ctx.strategy}=${ctx.selector})`,
            current ? current.status : 'none',
          );
        }
        scopedLog.info(`${ctx.strategy}=${ctx.selector} changed meanwhile; reading it again`);
      }
    }
  }

  /**
   * Mark a healed selector as "fixed pending verification". Resets the
   * clean-build counter so progress restarts from zero. Rejects if the
   * selector is currently muted (would silently re-arm regressions).
   *
   * The write is conditional on the row it read (`asRead`), or a create when
   * it read none; another change in between starts it again (`retrying`), so
   * a mute committed meanwhile answers 409 rather than ending `pending`.
   */
  async markFixed(ctx: ActorContext): Promise<SelectorState> {
    const row = await this.retrying(ctx, async () => {
      const existing = await this.prisma.selectorState.findUnique({
        where: whereTuple(ctx.strategy, ctx.selector),
      });
      if (existing && existing.status === 'muted') {
        throw new SelectorStateConflictError(
          `Cannot markFixed on a muted selector (${ctx.strategy}=${ctx.selector})`,
          existing.status,
        );
      }

      const now = new Date();
      const fix = {
        status: 'pending' satisfies SelectorStatus,
        fixed_at: now,
        fixed_by_api_key: ctx.apiKeyId,
        clean_builds_count: 0,
        resolved_at: null,
        muted_at: null,
        muted_by_api_key: null,
        last_event_at: now,
      };
      return this.prisma.$transaction(async (tx) => {
        if (existing) {
          changedOne(await tx.selectorState.updateMany({ where: asRead(existing), data: fix }));
        } else {
          await tx.selectorState.create({
            data: { original_strategy: ctx.strategy, original_selector: ctx.selector, ...fix },
          });
        }
        await tx.selectorEvent.create(selectorEventData(ctx, 'marked_fixed', ctx.userId));
        const written = await tx.selectorState.findUnique({
          where: whereTuple(ctx.strategy, ctx.selector),
        });
        if (!written) throw new ChangedMeanwhile();
        return written;
      });
    });

    scopedLog.info(
      `markFixed: ${ctx.strategy}=${ctx.selector} → pending (api_key=${ctx.apiKeyId})`,
    );
    void this.socket.emitToDashboardForSelector(
      SocketEvents.SELECTOR_FIXED,
      serialize(row),
      selectorOf(ctx),
    );
    return row;
  }

  /**
   * Silence a selector. Idempotent — re-muting an already-muted selector
   * just refreshes muted_at / muted_by_api_key, and records the new reason.
   * A fix being verified (or verified) is dropped: a muted row carries none
   * (`selectorStatus.ts`), and markFixed refuses a muted selector, so it
   * could never be verified. Through 2.36 mute kept it, and unmute left the
   * selector "To fix" shown as fixed by whoever had marked it.
   */
  async mute(ctx: ActorContext): Promise<SelectorState> {
    const row = await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const upserted = await tx.selectorState.upsert({
        where: whereTuple(ctx.strategy, ctx.selector),
        create: {
          original_strategy: ctx.strategy,
          original_selector: ctx.selector,
          status: 'muted' satisfies SelectorStatus,
          muted_at: now,
          muted_by_api_key: ctx.apiKeyId,
          last_event_at: now,
        },
        update: {
          status: 'muted' satisfies SelectorStatus,
          ...NO_FIX,
          muted_at: now,
          muted_by_api_key: ctx.apiKeyId,
          last_event_at: now,
        },
      });
      await tx.selectorEvent.create(selectorEventData(ctx, 'muted', ctx.userId, ctx.reason));
      return upserted;
    });

    scopedLog.info(`mute: ${ctx.strategy}=${ctx.selector} → muted (api_key=${ctx.apiKeyId})`);
    void this.socket.emitToDashboardForSelector(
      SocketEvents.SELECTOR_MUTED,
      serialize(row),
      selectorOf(ctx),
    );
    return row;
  }

  /**
   * Lift a mute: the selector is "To fix" again. The row is kept, as
   * `active` with no fix on it, only when it has something to show
   * (`keepsRowWhenActive`: it broke again at least once); otherwise it is
   * deleted, so the table doesn't accumulate rows for selectors that were
   * only ever muted. cancelVerification follows the same rule.
   *
   * Calling `unmute` on a row whose status is not `'muted'` (including a
   * missing row) is a silent no-op: the existing row is returned unchanged,
   * nothing is recorded and no socket event is emitted. That includes a row
   * another change unmuted or deleted between this one's read and its write
   * (`retrying` reads it again).
   */
  async unmute(ctx: ActorContext): Promise<SelectorState | null> {
    const outcome = await this.retrying(ctx, async () => {
      const existing = await this.prisma.selectorState.findUnique({
        where: whereTuple(ctx.strategy, ctx.selector),
      });
      if (!existing || existing.status !== 'muted') {
        return { changed: false, row: existing };
      }
      return this.prisma.$transaction(async (tx) => {
        const result = await toActive(tx, ctx, existing);
        await tx.selectorEvent.create(selectorEventData(ctx, 'unmuted', ctx.userId));
        return { changed: true, row: result };
      });
    });
    if (!outcome.changed) return outcome.row;

    const result = outcome.row;
    scopedLog.info(
      `unmute: ${ctx.strategy}=${ctx.selector} → ${result ? 'active' : 'deleted'} (api_key=${ctx.apiKeyId})`,
    );
    // Emit the post-state. When the row was deleted, surface the prior tuple
    // so the dashboard can drop it from the muted list.
    void this.socket.emitToDashboardForSelector(
      SocketEvents.SELECTOR_UNMUTED,
      result
        ? serialize(result)
        : {
            original_strategy: ctx.strategy,
            original_selector: ctx.selector,
            status: 'deleted',
          },
      selectorOf(ctx),
    );
    return result;
  }

  /**
   * Cancel a pending verification (user clicked "undo" before clean-builds
   * count tipped over). Only valid from status='pending'. The selector is
   * "To fix" again, by unmute's rule (`toActive`). A heal that ended the
   * verification between this one's read and its write answers 409 with the
   * new status, and its regression stays.
   */
  async cancelVerification(ctx: ActorContext): Promise<SelectorState | null> {
    const result = await this.retrying(ctx, async () => {
      const existing = await this.prisma.selectorState.findUnique({
        where: whereTuple(ctx.strategy, ctx.selector),
      });
      if (!existing || existing.status !== 'pending') {
        throw new SelectorStateConflictError(
          `cancelVerification requires status=pending (${ctx.strategy}=${ctx.selector})`,
          existing ? existing.status : 'none',
        );
      }
      return this.prisma.$transaction(async (tx) => {
        const row = await toActive(tx, ctx, existing);
        await tx.selectorEvent.create(selectorEventData(ctx, 'verification_cancelled', ctx.userId));
        return row;
      });
    });

    scopedLog.info(
      `cancelVerification: ${ctx.strategy}=${ctx.selector} → ${result ? 'active' : 'deleted'} (api_key=${ctx.apiKeyId})`,
    );
    void this.socket.emitToDashboardForSelector(
      SocketEvents.SELECTOR_CANCELLED,
      result
        ? serialize(result)
        : {
            original_strategy: ctx.strategy,
            original_selector: ctx.selector,
            status: 'deleted',
          },
      selectorOf(ctx),
    );
    return result;
  }

  /**
   * Heal-write hook called from the heal write path when `is_healed=true` is
   * about to be persisted. If the (strategy, selector) row is in `'pending'`
   * or `'resolved'` state, transitions it back to `'active'`, increments
   * `regression_count`, records `broke_again`, and emits `SELECTOR_REGRESSED`.
   * No-op if the row is absent, muted, or already active.
   *
   * The change is one conditional update (`status in (pending, resolved)`),
   * and the event is written only when it changed the row. The read before
   * it only saves a transaction for the many heals that change nothing.
   * Through 2.36 the update was unconditional after that read: two heals of
   * one selector at once (two shards) both counted a regression and both
   * wrote `broke_again`, and a mute made in between ended `active` with
   * `muted_at` still set.
   *
   * Return value: provided for testing/integration scenarios. Production
   * callers in the heal write path (`event-manager.ts`) should treat this
   * as fire-and-forget and wrap the call with `.catch()` so a failure here
   * never blocks or breaks the heal write itself.
   */
  async onHealRecorded(ctx: HealRecordedContext): Promise<SelectorState | null> {
    // Read outside a transaction: this runs on every heal, and almost every
    // heal changes nothing.
    const existing = await this.prisma.selectorState.findUnique({
      where: whereTuple(ctx.strategy, ctx.selector),
    });
    if (!existing) return null;
    if (!(WATCHED_STATUSES as string[]).includes(existing.status)) return existing;

    const outcome = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.selectorState.updateMany({
        where: {
          original_strategy: ctx.strategy,
          original_selector: ctx.selector,
          status: { in: WATCHED_STATUSES },
        },
        data: {
          status: 'active' satisfies SelectorStatus,
          ...NO_FIX,
          regression_count: { increment: 1 },
          last_event_at: new Date(),
        },
      });
      const current = await tx.selectorState.findUnique({
        where: whereTuple(ctx.strategy, ctx.selector),
      });
      if (count === 0) return { changed: false, row: current };
      await tx.selectorEvent.create(selectorEventData(ctx, 'broke_again'));
      return { changed: true, row: current };
    });
    // Changed meanwhile (another heal sent it back first, or it was muted,
    // cancelled or deleted): nothing to record.
    if (!outcome.changed || !outcome.row) return outcome.row;
    const row = outcome.row;

    scopedLog.warn(
      `onHealRecorded: ${ctx.strategy}=${ctx.selector} regressed from ${existing.status} (session=${ctx.sessionId})`,
    );
    void this.socket.emitToDashboardForSelector(
      SocketEvents.SELECTOR_REGRESSED,
      serialize(row),
      selectorOf(ctx),
    );
    return row;
  }

  /** Read-through accessor for callers that need the current row (or null). */
  async getState(strategy: string, selector: string): Promise<SelectorState | null> {
    return this.prisma.selectorState.findUnique({
      where: whereTuple(strategy, selector),
    });
  }
}
