import type { LeaseQueue } from '../../src/services/lease/LeaseQueue';
import type { LeaseService } from '../../src/services/lease/LeaseService';

/**
 * Stops each lease queue and waits for every grant pass it has started, and
 * the one a kick has pending. A LeaseService stands for the queue it built
 * for itself, if it built one (a release kicks it).
 *
 * A pass a release or a kick started runs after the test's own `await`s,
 * against the database the queue was given. Drain it while the scratch
 * database is still in place: in an `afterEach` of a suite under
 * `useScratchDatabase({ wholeSuite: true })`, or inside the test. A plain
 * `useScratchDatabase()` restores the real `prisma` in an `afterEach` of its
 * own, which runs before the spec's, and a pass still running there reaches
 * the developer's database.
 */
export async function drainLeaseQueues(
  ...owners: Array<LeaseQueue | LeaseService | undefined>
): Promise<void> {
  for (const owner of owners) {
    const queue: LeaseQueue | undefined =
      owner && 'idle' in owner ? owner : (owner as any)?.leaseQueue;
    if (typeof queue?.idle !== 'function') continue;
    queue.stop();
    await queue.idle();
  }
}
