import { Container, Service } from 'typedi';
import { prisma as defaultPrisma } from '../prisma';
import { SocketServer } from './SocketServer';
import { SocketEvents } from '../enums/SocketEvents';
import log from '../logger';
import type { SelectorState } from '../generated/client';

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

export interface ActorContext extends SelectorTuple {
  /** API key id of the user performing the action (audit trail). */
  apiKeyId: string;
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
  update(args: any): Promise<SelectorState>;
  delete(args: any): Promise<SelectorState>;
}

interface PrismaLike {
  selectorState: SelectorStateDelegate;
}

interface SocketLike {
  emitToDashboard(event: string, data: any): void;
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
 * Owns SelectorState lifecycle transitions. Every transition is idempotent
 * where the spec allows, emits the corresponding `SELECTOR_*` socket event,
 * and uses lazy row creation — rows only exist once a user has taken an
 * action against the selector.
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
   * Mark a healed selector as "fixed pending verification". Resets the
   * clean-build counter so progress restarts from zero. Rejects if the
   * selector is currently muted (would silently re-arm regressions).
   */
  async markFixed(ctx: ActorContext): Promise<SelectorState> {
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
    const row = await this.prisma.selectorState.upsert({
      where: whereTuple(ctx.strategy, ctx.selector),
      create: {
        original_strategy: ctx.strategy,
        original_selector: ctx.selector,
        status: 'pending',
        fixed_at: now,
        fixed_by_api_key: ctx.apiKeyId,
        clean_builds_count: 0,
        last_event_at: now,
      },
      update: {
        status: 'pending',
        fixed_at: now,
        fixed_by_api_key: ctx.apiKeyId,
        clean_builds_count: 0,
        resolved_at: null,
        last_event_at: now,
      },
    });

    scopedLog.info(
      `markFixed: ${ctx.strategy}=${ctx.selector} → pending (api_key=${ctx.apiKeyId})`,
    );
    this.socket.emitToDashboard(SocketEvents.SELECTOR_FIXED, serialize(row));
    return row;
  }

  /**
   * Silence a selector. Idempotent — re-muting an already-muted selector
   * just refreshes muted_at / muted_by_api_key.
   */
  async mute(ctx: ActorContext): Promise<SelectorState> {
    const now = new Date();
    const row = await this.prisma.selectorState.upsert({
      where: whereTuple(ctx.strategy, ctx.selector),
      create: {
        original_strategy: ctx.strategy,
        original_selector: ctx.selector,
        status: 'muted',
        muted_at: now,
        muted_by_api_key: ctx.apiKeyId,
        last_event_at: now,
      },
      update: {
        // Preserve any prior fixed_at / resolved_at history (Pending → Muted spec).
        status: 'muted',
        muted_at: now,
        muted_by_api_key: ctx.apiKeyId,
        last_event_at: now,
      },
    });

    scopedLog.info(`mute: ${ctx.strategy}=${ctx.selector} → muted (api_key=${ctx.apiKeyId})`);
    this.socket.emitToDashboard(SocketEvents.SELECTOR_MUTED, serialize(row));
    return row;
  }

  /**
   * Lift a mute. If the row had no other history, deletes it (lazy cleanup
   * so the table doesn't accumulate phantom rows for selectors that were
   * only ever muted). Otherwise resets to active and preserves history.
   *
   * "History" here means any of:
   *   - `regression_count > 0` (the selector has regressed at least once), OR
   *   - `fixed_at != null` (someone has marked it fixed), OR
   *   - `resolved_at != null` (it has reached the resolved terminal state).
   *
   * Calling `unmute` on a row whose status is not `'muted'` (including a
   * missing row) is a silent no-op: the existing row is returned unchanged
   * and no socket event is emitted.
   */
  async unmute(ctx: ActorContext): Promise<SelectorState | null> {
    const existing = await this.prisma.selectorState.findUnique({
      where: whereTuple(ctx.strategy, ctx.selector),
    });
    if (!existing || existing.status !== 'muted') {
      return existing;
    }

    const hasOtherHistory =
      existing.regression_count > 0 || existing.fixed_at !== null || existing.resolved_at !== null;

    let result: SelectorState | null;
    if (!hasOtherHistory) {
      await this.prisma.selectorState.delete({
        where: whereTuple(ctx.strategy, ctx.selector),
      });
      result = null;
    } else {
      const now = new Date();
      result = await this.prisma.selectorState.update({
        where: whereTuple(ctx.strategy, ctx.selector),
        data: {
          status: 'active',
          muted_at: null,
          muted_by_api_key: null,
          last_event_at: now,
        },
      });
    }

    scopedLog.info(
      `unmute: ${ctx.strategy}=${ctx.selector} → ${result ? 'active' : 'deleted'} (api_key=${ctx.apiKeyId})`,
    );
    // Emit the post-state. When the row was deleted, surface the prior tuple
    // so the dashboard can drop it from the muted list.
    this.socket.emitToDashboard(
      SocketEvents.SELECTOR_UNMUTED,
      result
        ? serialize(result)
        : {
            original_strategy: ctx.strategy,
            original_selector: ctx.selector,
            status: 'deleted',
          },
    );
    return result;
  }

  /**
   * Cancel a pending verification (user clicked "undo" before clean-builds
   * count tipped over). Only valid from status='pending'. If no other
   * history was accumulated, removes the row entirely.
   */
  async cancelVerification(ctx: ActorContext): Promise<SelectorState | null> {
    const existing = await this.prisma.selectorState.findUnique({
      where: whereTuple(ctx.strategy, ctx.selector),
    });
    if (!existing || existing.status !== 'pending') {
      throw new SelectorStateConflictError(
        `cancelVerification requires status=pending (${ctx.strategy}=${ctx.selector})`,
        existing ? existing.status : 'none',
      );
    }

    const hasOtherHistory = existing.regression_count > 0 || existing.resolved_at !== null;

    let result: SelectorState | null;
    if (!hasOtherHistory) {
      await this.prisma.selectorState.delete({
        where: whereTuple(ctx.strategy, ctx.selector),
      });
      result = null;
    } else {
      const now = new Date();
      result = await this.prisma.selectorState.update({
        where: whereTuple(ctx.strategy, ctx.selector),
        data: {
          status: 'active',
          fixed_at: null,
          fixed_by_api_key: null,
          clean_builds_count: 0,
          last_event_at: now,
        },
      });
    }

    scopedLog.info(
      `cancelVerification: ${ctx.strategy}=${ctx.selector} → ${result ? 'active' : 'deleted'} (api_key=${ctx.apiKeyId})`,
    );
    this.socket.emitToDashboard(
      SocketEvents.SELECTOR_CANCELLED,
      result
        ? serialize(result)
        : {
            original_strategy: ctx.strategy,
            original_selector: ctx.selector,
            status: 'deleted',
          },
    );
    return result;
  }

  /**
   * Heal-write hook called from the heal write path when `is_healed=true` is
   * about to be persisted. If the (strategy, selector) row is in `'pending'`
   * or `'resolved'` state, transitions it back to `'active'`, increments
   * `regression_count`, and emits `SELECTOR_REGRESSED`. No-op if the row is
   * absent, muted, or already active.
   *
   * Return value: provided for testing/integration scenarios. Production
   * callers in the heal write path (`event-manager.ts`) should treat this
   * as fire-and-forget and wrap the call with `.catch()` so a failure here
   * never blocks or breaks the heal write itself.
   */
  async onHealRecorded(ctx: HealRecordedContext): Promise<SelectorState | null> {
    const existing = await this.prisma.selectorState.findUnique({
      where: whereTuple(ctx.strategy, ctx.selector),
    });
    if (!existing) return null;
    if (existing.status !== 'pending' && existing.status !== 'resolved') {
      return existing;
    }

    const now = new Date();
    const row = await this.prisma.selectorState.update({
      where: whereTuple(ctx.strategy, ctx.selector),
      data: {
        status: 'active',
        fixed_at: null,
        resolved_at: null,
        regression_count: { increment: 1 },
        clean_builds_count: 0,
        last_event_at: now,
      },
    });

    scopedLog.warn(
      `onHealRecorded: ${ctx.strategy}=${ctx.selector} regressed from ${existing.status} (session=${ctx.sessionId})`,
    );
    this.socket.emitToDashboard(SocketEvents.SELECTOR_REGRESSED, serialize(row));
    return row;
  }

  /** Read-through accessor for callers that need the current row (or null). */
  async getState(strategy: string, selector: string): Promise<SelectorState | null> {
    return this.prisma.selectorState.findUnique({
      where: whereTuple(strategy, selector),
    });
  }
}
