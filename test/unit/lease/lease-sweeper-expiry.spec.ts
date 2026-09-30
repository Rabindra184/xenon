import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import {
  LeaseOrphanSweeper,
  leaseReapReason,
} from '../../../src/services/lease/LeaseOrphanSweeper';
import { useScratchDatabase } from '../../helpers/scratch-database';

/**
 * A lease ends at expiresAt. Since #366 heartbeat and extend refuse a lease
 * past it, but the sweeper reaped only on missed heartbeats, so the lease
 * stayed 'active', its phone busy and out of allocation, for up to
 * 3 x heartbeatSeconds (15 minutes at the 300 s maximum) after it ended.
 *
 * The sweeper runs its real queries against a scratch SQLite file.
 */
describe('LeaseOrphanSweeper: a lease ends at expiresAt (scratch DB)', () => {
  const scratch = useScratchDatabase();
  let releaseLeaseLock: sinon.SinonStub;
  let sweeper: LeaseOrphanSweeper;
  let now: number;

  async function lease(id: string, over: { expiresAt: number; lastHeartbeatAt: number }) {
    await scratch.db.lease.create({
      data: {
        id,
        tokenHash: `hash-${id}`,
        deviceUdid: `udid-${id}`,
        deviceHost: 'http://127.0.0.1:4723',
        actorId: 'usr_alice',
        status: 'active',
        heartbeatSeconds: 30,
        allocatedPorts: '{}',
        capabilityBag: '{}',
        ...over,
      },
    });
  }

  async function portLease(port: number, leaseId: string) {
    await scratch.db.portLease.create({
      data: {
        port,
        purpose: 'wdaLocalPort',
        leasedToUdid: `udid-${leaseId}`,
        leaseId,
        leasedAt: now,
        expiresAt: now + 3_600_000,
      },
    });
  }

  const statusOf = async (id: string) =>
    (await scratch.db.lease.findUnique({ where: { id } }))?.status;
  const portsOf = async (leaseId: string) =>
    (await scratch.db.portLease.findMany({ where: { leaseId } })).map((p) => p.port);

  beforeEach(async () => {
    await scratch.db.portLease.deleteMany({});
    await scratch.db.lease.deleteMany({});
    now = Date.now();
    releaseLeaseLock = sinon.stub().resolves(true);
    sweeper = new LeaseOrphanSweeper(scratch.db, { releaseLeaseLock });
  });

  it('reaps a lease past expiresAt whose client is still heartbeating, like a missed-heartbeat reap', async () => {
    await lease('ended', { expiresAt: now - 500, lastHeartbeatAt: now - 1_000 });
    await portLease(28301, 'ended');

    await sweeper.sweep();

    expect(await statusOf('ended')).to.equal('expired');
    expect(await portsOf('ended'), 'its ports are freed').to.deep.equal([]);
    expect(releaseLeaseLock.calledOnceWith('udid-ended', 'http://127.0.0.1:4723')).to.equal(true);
  });

  it('leaves a heartbeating lease alone until expiresAt', async () => {
    await lease('live', { expiresAt: now + 60_000, lastHeartbeatAt: now - 1_000 });
    await portLease(28302, 'live');

    await sweeper.sweep();

    expect(await statusOf('live')).to.equal('active');
    expect(await portsOf('live')).to.deep.equal([28302]);
    expect(releaseLeaseLock.called).to.equal(false);
  });

  it('still reaps on missed heartbeats before expiresAt', async () => {
    await lease('silent', { expiresAt: now + 60_000, lastHeartbeatAt: now - 120_000 });

    await sweeper.sweep();

    expect(await statusOf('silent')).to.equal('expired');
    expect(releaseLeaseLock.calledOnceWith('udid-silent', 'http://127.0.0.1:4723')).to.equal(true);
  });

  it('never touches a lease that was released', async () => {
    await lease('gone', { expiresAt: now - 500, lastHeartbeatAt: now - 1_000 });
    await scratch.db.lease.update({ where: { id: 'gone' }, data: { status: 'released' } });

    await sweeper.sweep();

    expect(await statusOf('gone')).to.equal('released');
    expect(releaseLeaseLock.called).to.equal(false);
  });
});

describe('leaseReapReason', () => {
  // Past expiresAt, heartbeat and extend refuse the lease (410), so by the next
  // sweep its heartbeats are missed too. The end time is the cause; the lab's
  // log said "missed heartbeats" for every such lease.
  it('names the end time for a lease past expiresAt, even when its heartbeats are missed too', () => {
    const now = Date.now();
    const reason = leaseReapReason(
      { heartbeatSeconds: 10, lastHeartbeatAt: now - 60_000, expiresAt: now - 1_000 },
      now,
    );
    expect(reason).to.match(/^expired at /);
  });

  it('names missed heartbeats for a lease before its end time', () => {
    const now = Date.now();
    const reason = leaseReapReason(
      { heartbeatSeconds: 10, lastHeartbeatAt: now - 60_000, expiresAt: now + 60_000 },
      now,
    );
    expect(reason).to.equal('missed heartbeats');
  });
});
