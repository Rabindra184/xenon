import 'reflect-metadata';
import { expect } from 'chai';
import {
  ENDED_LEASE_RETENTION_MS,
  pruneEndedLeases,
} from '../../../src/services/lease/leaseRetention';
import { hashToken, generateToken } from '../../../src/services/lease/leaseToken';
import { useScratchDatabase } from '../../helpers/scratch-database';

// A lease that has ended (released, expired, ended) is kept for
// ENDED_LEASE_RETENTION_MS after its end, then deleted with its member rows.
// A live lease (waiting, active) is never deleted, however old. Through 2.36
// every ended lease and its members stayed for ever.

const HOST = 'http://127.0.0.1:4723';
const DAY = 24 * 60 * 60 * 1000;

describe('Ended leases are deleted after their retention', () => {
  const scratch = useScratchDatabase({ wholeSuite: true });
  const now = Date.now();
  const old = now - ENDED_LEASE_RETENTION_MS - DAY;

  /** A lease row whose every time is `at`, with `members` phones. */
  async function lease(
    id: string,
    status: string,
    at: number,
    over: Record<string, unknown> = {},
    members = 1,
  ) {
    await scratch.db.lease.create({
      data: {
        id,
        tokenHash: hashToken(generateToken()),
        deviceUdid: `${id}-0`,
        deviceHost: HOST,
        actorId: 'key_owner',
        status,
        expiresAt: at,
        heartbeatSeconds: 30,
        lastHeartbeatAt: at,
        allocatedPorts: '{}',
        capabilityBag: '',
        createdAt: new Date(at),
        ...over,
        members: {
          create: Array.from({ length: members }, (_, index) => ({
            index,
            udid: `${id}-${index}`,
            host: HOST,
            heldAt: at,
          })),
        },
      },
    });
  }

  const leaseIds = async () =>
    (await scratch.db.lease.findMany({ select: { id: true }, orderBy: { id: 'asc' } })).map(
      (l) => l.id,
    );
  const memberLeaseIds = async () =>
    [
      ...new Set(
        (await scratch.db.leaseMember.findMany({ select: { leaseId: true } })).map(
          (m) => m.leaseId,
        ),
      ),
    ].sort();

  beforeEach(async () => {
    await scratch.db.leaseMember.deleteMany({});
    await scratch.db.lease.deleteMany({});
  });

  it('deletes each kind of ended lease past its retention, with its members', async () => {
    await lease('released-old', 'released', old, { endReason: 'client_released' }, 2);
    await lease('expired-old', 'expired', old, { endReason: 'past_end' });
    await lease('ended-old', 'ended', old, { endReason: 'member_lost: member 1 (u) gone' }, 3);
    // A waiter that gave up: no end time of its own, its wait ran out long ago.
    await lease('waiter-old', 'expired', old, { expiresAt: 0, waitUntil: old }, 0);

    const pruned = await pruneEndedLeases({ db: scratch.db, now });

    expect(pruned.deleted).to.equal(4);
    expect(await leaseIds()).to.deep.equal([]);
    expect(await memberLeaseIds()).to.deep.equal([]);
  });

  it('keeps an ended lease inside its retention', async () => {
    await lease('released-recent', 'released', now - DAY, { endReason: 'client_released' }, 2);

    expect((await pruneEndedLeases({ db: scratch.db, now })).deleted).to.equal(0);
    expect(await leaseIds()).to.deep.equal(['released-recent']);
    expect(await memberLeaseIds()).to.deep.equal(['released-recent']);
  });

  it('judges the end by the latest time the row holds', async () => {
    // Created and last heard from long ago, but it ran (or waited) until recently.
    await lease('ran-late', 'expired', old, { expiresAt: now - DAY });
    await lease('waited-late', 'expired', old, { expiresAt: 0, waitUntil: now - DAY }, 0);
    await lease('heard-late', 'released', old, { lastHeartbeatAt: now - DAY });

    expect((await pruneEndedLeases({ db: scratch.db, now })).deleted).to.equal(0);
    expect(await leaseIds()).to.deep.equal(['heard-late', 'ran-late', 'waited-late']);
  });

  it('never deletes a live lease, however old', async () => {
    await lease('active-old', 'active', old, {}, 2);
    await lease('waiting-old', 'waiting', old, { expiresAt: 0, waitUntil: null }, 1);

    expect((await pruneEndedLeases({ db: scratch.db, now })).deleted).to.equal(0);
    expect(await leaseIds()).to.deep.equal(['active-old', 'waiting-old']);
    expect(await memberLeaseIds()).to.deep.equal(['active-old', 'waiting-old']);
  });

  it('deletes in batches, until none is left', async () => {
    for (let i = 0; i < 5; i++) await lease(`old-${i}`, 'released', old, {}, 2);
    await lease('active-old', 'active', old);

    const pruned = await pruneEndedLeases({ db: scratch.db, now, batchSize: 2 });

    expect(pruned).to.deep.equal({ deleted: 5, batches: 3 });
    expect(await leaseIds()).to.deep.equal(['active-old']);
    expect(await memberLeaseIds()).to.deep.equal(['active-old']);
  });

  it('a lease that came back to life between the read and the delete is kept', async () => {
    await lease('old-0', 'released', old);
    // A write that makes the row live after the read (never happens to a real
    // lease, which never leaves an ended status) must not lose the row.
    const db = new Proxy(scratch.db as any, {
      get(target, prop) {
        if (prop !== 'lease') return target[prop];
        return new Proxy(target.lease, {
          get(model, method) {
            if (method !== 'findMany') return model[method];
            return async (args: any) => {
              const rows = await model.findMany(args);
              await model.update({ where: { id: 'old-0' }, data: { status: 'active' } });
              return rows;
            };
          },
        });
      },
    });

    expect((await pruneEndedLeases({ db, now })).deleted).to.equal(0);
    expect(await leaseIds()).to.deep.equal(['old-0']);
    expect(await memberLeaseIds()).to.deep.equal(['old-0']);
  });
});
