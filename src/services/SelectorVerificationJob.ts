import { Container, Service } from 'typedi';
import { prisma as defaultPrisma } from '../prisma';
import { SocketServer } from './SocketServer';
import { SocketEvents } from '../enums/SocketEvents';
import logger from '../logger';
import type { SelectorState } from '../generated/client';
import { SelectorStateService, selectorEventData } from './SelectorStateService';
import { tupleWhere } from './selector-health/selectorKeys';
import { SelectorStatus } from './selector-health/selectorStatus';

const log = logger.scope('SelectorVerification');

/**
 * Threshold of distinct clean build_ids required to promote a Pending
 * SelectorState row to Resolved. "Clean" means the selector was found without
 * healing in the build: a findElement of the (strategy, selector) tuple that
 * answered an element, or a findElements that answered at least one, and no
 * heal of it. Through 2.14 a find that failed outright counted too, so a
 * selector that was never found again was verified as fixed.
 */
const CLEAN_BUILDS_TO_RESOLVE = 3;

interface PrismaSelectorStateDelegate {
  findMany(args: any): Promise<SelectorState[]>;
  findUnique(args: any): Promise<SelectorState | null>;
  updateMany(args: any): Promise<{ count: number }>;
}

interface PrismaSessionLogDelegate {
  findFirst(args: any): Promise<{ session_id: string } | null>;
}

interface PrismaSelectorEventDelegate {
  create(args: any): Promise<unknown>;
}

/** The tables a promotion writes, inside its transaction. */
interface VerifyTx {
  selectorState: PrismaSelectorStateDelegate;
  selectorEvent: PrismaSelectorEventDelegate;
}

interface PrismaLike extends VerifyTx {
  sessionLog: PrismaSessionLogDelegate;
  $queryRaw<T = unknown>(strings: TemplateStringsArray, ...values: any[]): Promise<T>;
  $transaction<T>(fn: (tx: VerifyTx) => Promise<T>): Promise<T>;
}

/** Sends a selector's event to the dashboards whose caller may see the selector. */
interface SocketLike {
  emitToDashboardForSelector(
    event: string,
    data: any,
    selector: { strategy: string; selector: string },
  ): Promise<void>;
}

/** The selector a row is about, as the socket server's scoped emit names it. */
function keyOfRow(row: SelectorState) {
  return { strategy: row.original_strategy, selector: row.original_selector };
}

/** Per-build heal status row returned by the verifier query. */
interface BuildHealRow {
  build_id: string;
  healed: number | bigint;
  found: number | bigint;
}

/**
 * Periodically scans Pending SelectorState rows and promotes them to Resolved
 * once enough clean CI builds have been observed (no heals on the selector
 * since fixed_at). Also keeps `clean_builds_count` fresh on every run so the
 * dashboard's "1/3, 2/3" progress indicator reflects the latest evidence.
 *
 * Wiring: schedule via `setupCronSelectorVerification` in `device-utils.ts`,
 * not via `start()/stop()` on the class — that matches the existing cron
 * model in this codebase (OrphanSweeper, CleanupService, …).
 */
@Service()
export class SelectorVerificationJob {
  private readonly prisma: PrismaLike;
  private readonly socket: SocketLike;
  /** The run going on, if any. */
  private running: Promise<void> | null = null;

  constructor(prisma?: PrismaLike, socket?: SocketLike) {
    this.prisma = prisma ?? (defaultPrisma as unknown as PrismaLike);
    this.socket = socket ?? Container.get(SocketServer);
  }

  /**
   * Process every row currently in `'pending'`, then look for a heal of every
   * `'resolved'` one. Each row is wrapped in its own try/catch so a query
   * failure on one selector can't take down the remainder of the run.
   *
   * One run at a time (the cron uses the one instance, `Container.get`): a
   * run asked for while one is going gets that run's promise and starts
   * nothing. Through 2.36 a run slower than the cron's 15 minutes overlapped
   * the next, and both counted and promoted the same rows.
   */
  run(): Promise<void> {
    if (this.running) {
      log.info('a verification run is still going; not starting another');
      return this.running;
    }
    const run = this.runOnce().finally(() => {
      if (this.running === run) this.running = null;
    });
    this.running = run;
    return run;
  }

  private async runOnce(): Promise<void> {
    const pending = await this.prisma.selectorState.findMany({
      where: { status: 'pending' satisfies SelectorStatus },
    });
    for (const row of pending) {
      try {
        if (!(await this.brokeAgain(row))) await this.processOne(row);
      } catch (err: any) {
        log.error(
          `[${row.id}] processing failed (${row.original_strategy}=${row.original_selector}): ${err?.message ?? err}`,
        );
      }
    }
    const resolved = await this.prisma.selectorState.findMany({
      where: { status: 'resolved' satisfies SelectorStatus },
    });
    for (const row of resolved) {
      try {
        await this.brokeAgain(row);
      } catch (err: any) {
        log.error(
          `[${row.id}] heal check failed (${row.original_strategy}=${row.original_selector}): ${err?.message ?? err}`,
        );
      }
    }
  }

  /**
   * A heal since the selector was marked fixed means it broke again. The heal
   * write path says so at once (`onHealRecorded`), but that call can fail and
   * isn't tried again, and the clean-build count below doesn't look at healed
   * builds: a selector with three clean builds was promoted however often it
   * healed in others. So the job checks too, and makes the same change.
   */
  private async brokeAgain(row: SelectorState): Promise<boolean> {
    if (!row.fixed_at) return false;
    const heal = await this.prisma.sessionLog.findFirst({
      where: {
        AND: [
          // After the fix, strictly: a heal recorded in the same millisecond
          // as the fix is the one that made someone mark it fixed. Through
          // 2.36 `gte` counted it as breaking the selector again.
          { is_healed: true, createdAt: { gt: row.fixed_at } },
          tupleWhere(row.original_strategy, row.original_selector),
        ],
      },
      orderBy: { createdAt: 'desc' },
      select: { session_id: true },
    });
    if (!heal) return false;
    log.warn(
      `[${row.id}] healed again after being marked fixed, unnoticed when it healed (${row.original_strategy}=${row.original_selector}, session=${heal.session_id})`,
    );
    await new SelectorStateService(this.prisma as never, this.socket).onHealRecorded({
      strategy: row.original_strategy,
      selector: row.original_selector,
      sessionId: heal.session_id,
    });
    return true;
  }

  private async processOne(row: SelectorState): Promise<void> {
    if (!row.fixed_at) {
      // Defensive — Pending without a fixed_at is a schema violation; skip
      // rather than crashing the whole run.
      return;
    }

    // Per-build heal aggregation since fixed_at. Only considers sessions
    // that ran under a CI build (build_id IS NOT NULL); ad-hoc local runs
    // intentionally don't move verification forward.
    //
    // A find that found the selector is one that didn't fail (`is_error`,
    // the dashboard's record of an error answer) and didn't answer an empty
    // list (`{"value":[]`, findElements finding nothing). The command log
    // keeps the answer as JSON.stringify wrote it, or as the node sent it.
    //
    // Identifier names (PascalCase tables, camelCase createdAt) match the
    // actual SQLite schema generated by Prisma — see
    // `sqlite3 prisma/dev.db ".schema SessionLog"`.
    const heals = await this.prisma.$queryRaw<BuildHealRow[]>`
      SELECT s."build_id" AS build_id,
             MAX(CASE WHEN sl."is_healed" THEN 1 ELSE 0 END) AS healed,
             MAX(CASE WHEN NOT sl."is_healed" AND NOT sl."is_error"
                       AND sl."response" NOT LIKE '{"value":[]%'
                      THEN 1 ELSE 0 END) AS found
      FROM "SessionLog" sl
      INNER JOIN "Session" s ON sl."session_id" = s."id"
      WHERE sl."original_strategy" = ${row.original_strategy}
        AND sl."original_selector" = ${row.original_selector}
        AND sl."command_name" IN ('findElement', 'findElements')
        AND sl."createdAt" >= ${row.fixed_at}
        AND s."build_id" IS NOT NULL
      GROUP BY s."build_id"
    `;

    const cleanBuildCount = heals.filter(
      (r) => Number(r.healed) === 0 && Number(r.found) === 1,
    ).length;

    if (cleanBuildCount >= CLEAN_BUILDS_TO_RESOLVE) {
      await this.promoteToResolved(row);
    } else if (cleanBuildCount !== row.clean_builds_count) {
      await this.updateProgress(row, cleanBuildCount);
    }
    // else: nothing changed — skip the write.
  }

  /**
   * Promote and progress are written only where the row is still what this
   * run read: pending, under the same fix (`fixed_at`). A mute, a
   * cancellation, a heal or a second "mark fixed" made since leaves the row
   * as that change left it, and nothing is recorded or sent. Through 2.36
   * both wrote by id alone: a selector muted during the run came back
   * verified (with `muted_at` still set), and one marked fixed again was
   * verified on its previous fix's builds.
   */
  private unchangedSince(row: SelectorState) {
    return { id: row.id, status: 'pending' satisfies SelectorStatus, fixed_at: row.fixed_at };
  }

  private async promoteToResolved(row: SelectorState): Promise<void> {
    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.selectorState.updateMany({
        where: this.unchangedSince(row),
        data: {
          status: 'resolved' satisfies SelectorStatus,
          resolved_at: now,
          clean_builds_count: CLEAN_BUILDS_TO_RESOLVE,
          last_event_at: now,
        },
      });
      if (count === 0) return null;
      await tx.selectorEvent.create(
        selectorEventData(
          { strategy: row.original_strategy, selector: row.original_selector },
          'verified',
        ),
      );
      return tx.selectorState.findUnique({ where: { id: row.id } });
    });
    if (!updated) {
      log.info(
        `[${row.id}] changed during the run, not promoted (${row.original_strategy}=${row.original_selector})`,
      );
      return;
    }
    log.info(
      `[${row.id}] promoted to resolved (${row.original_strategy}=${row.original_selector})`,
    );
    void this.socket.emitToDashboardForSelector(
      SocketEvents.SELECTOR_RESOLVED,
      this.serialize(updated),
      keyOfRow(row),
    );
  }

  private async updateProgress(row: SelectorState, cleanBuildCount: number): Promise<void> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.selectorState.updateMany({
        where: this.unchangedSince(row),
        data: { clean_builds_count: cleanBuildCount, last_event_at: new Date() },
      });
      return count === 0 ? null : tx.selectorState.findUnique({ where: { id: row.id } });
    });
    if (!updated) return;
    void this.socket.emitToDashboardForSelector(
      SocketEvents.SELECTOR_PROGRESS,
      this.serialize(updated),
      keyOfRow(row),
    );
  }

  private serialize(row: SelectorState) {
    return {
      id: row.id,
      original_strategy: row.original_strategy,
      original_selector: row.original_selector,
      status: row.status,
      clean_builds_count: row.clean_builds_count,
      resolved_at: row.resolved_at ? row.resolved_at.toISOString() : null,
    };
  }
}
