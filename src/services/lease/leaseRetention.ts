import { prisma as defaultPrisma } from '../../prisma';
import log from '../../logger';
import { ENDED_LEASE_STATUSES } from './leaseStatus';

/**
 * How long an ended lease (released, expired, ended) is kept after its end:
 * 30 days, the event log's default. Then it is deleted with its member rows
 * (pruneEndedLeases). Through 2.36 every ended lease stayed for ever.
 */
export const ENDED_LEASE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** How many leases one delete takes, so a large table never holds one long transaction. */
export const LEASE_PRUNE_BATCH = 500;

/** How often the server prunes (ServerManager): at its start, then daily. */
export const LEASE_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * An ended lease whose end is before `cutoff`, as a Prisma `where`.
 *
 * A row records no end time, so the end is judged by the latest time it
 * holds: `createdAt`, `lastHeartbeatAt`, `expiresAt` and `waitUntil` all
 * before the cutoff. A lease never ends later than that by more than three
 * missed heartbeats and a sweep (at most 15 minutes and 30 s): an active
 * lease ends by `expiresAt` or three heartbeats after its last, a waiting one
 * by `waitUntil` or the same, and a heartbeat on an ended lease is refused,
 * so nothing moves them after the end. A lease released early is kept up to
 * a day longer (its `expiresAt`), never less.
 */
function endedBefore(cutoff: number) {
  return {
    status: { in: [...ENDED_LEASE_STATUSES] },
    createdAt: { lt: new Date(cutoff) },
    lastHeartbeatAt: { lt: cutoff },
    expiresAt: { lt: cutoff },
    OR: [{ waitUntil: null }, { waitUntil: { lt: cutoff } }],
  };
}

export interface PruneEndedLeasesOptions {
  db?: any;
  now?: number;
  retentionMs?: number;
  batchSize?: number;
}

/**
 * Deletes the ended leases past their retention (endedBefore), with their
 * member rows, a batch at a time, until none is left. A live lease (waiting,
 * active) is never deleted, however old: each delete asks for an ended
 * status again, so a row read as ended that isn't any more is kept. Nothing
 * reads an ended lease but its own client (GET, heartbeat, extend, DELETE
 * answer 410 with its reason); once deleted, its id answers as an unknown
 * one does (403 `token_mismatch`, as a wrong token). A Session row keeps its
 * `lease_id`. Never throws: a failure is logged, and the next run goes on.
 */
export async function pruneEndedLeases(
  options: PruneEndedLeasesOptions = {},
): Promise<{ deleted: number; batches: number }> {
  const db = options.db ?? defaultPrisma;
  const now = options.now ?? Date.now();
  const batchSize = Math.max(1, options.batchSize ?? LEASE_PRUNE_BATCH);
  const retentionMs = options.retentionMs ?? ENDED_LEASE_RETENTION_MS;
  const where = endedBefore(now - retentionMs);
  let deleted = 0;
  let batches = 0;
  try {
    for (;;) {
      const rows: Array<{ id: string }> = await db.lease.findMany({
        where,
        select: { id: true },
        take: batchSize,
      });
      if (rows.length === 0) break;
      batches++;
      const ids = rows.map((row) => row.id);
      const [, gone] = await db.$transaction([
        db.leaseMember.deleteMany({ where: { leaseId: { in: ids }, lease: where } }),
        db.lease.deleteMany({ where: { id: { in: ids }, ...where } }),
      ]);
      deleted += gone?.count ?? 0;
      // Fewer than asked: none is left. None deleted: what is left changed
      // since the read, and the next run looks again.
      if (rows.length < batchSize || !gone?.count) break;
    }
  } catch (err) {
    log.warn(`ended lease prune failed: ${(err as Error)?.message ?? err}`);
  }
  if (deleted > 0) {
    const days = Math.round(retentionMs / (24 * 60 * 60 * 1000));
    log.info(`deleted ${deleted} lease(s) ended more than ${days} days ago`);
  }
  return { deleted, batches };
}
