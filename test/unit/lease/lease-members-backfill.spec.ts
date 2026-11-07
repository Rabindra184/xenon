import 'reflect-metadata';
import { expect } from 'chai';
import { backfillLeaseMembers } from '../../../src/services/lease/leaseMembers';
import { useScratchDatabase } from '../../helpers/scratch-database';

/**
 * A lease's phones are its LeaseMember rows, and every reader of a lease
 * relies on them. A lease taken before the upgrade has none: its one phone is
 * in its own columns. At boot each such active lease gets member 0, written
 * from those columns.
 */
describe('member 0 for leases from before the upgrade', () => {
  const scratch = useScratchDatabase({ wholeSuite: true });

  const base = {
    tokenHash: 'h'.repeat(64),
    actorId: 'usr_alice',
    heartbeatSeconds: 30,
    expiresAt: Date.now() + 60_000,
    lastHeartbeatAt: Date.now(),
  };

  beforeEach(async () => {
    await scratch.db.leaseMember.deleteMany({});
    await scratch.db.lease.deleteMany({});
  });

  it('gives an active lease from before the upgrade its member 0, from its own columns', async () => {
    const lease = await scratch.db.lease.create({
      data: {
        ...base,
        id: 'lse_old',
        status: 'active',
        deviceUdid: 'u1',
        deviceHost: 'http://h:4723',
        allocatedPorts: '{"systemPort":9001}',
        capabilityBag: '{"x":1}',
      },
    });

    const written = await backfillLeaseMembers();

    expect(written).to.equal(1);
    const members = await scratch.db.leaseMember.findMany({ where: { leaseId: 'lse_old' } });
    expect(members).to.have.length(1);
    expect(members[0]).to.include({
      index: 0,
      udid: 'u1',
      host: 'http://h:4723',
      allocatedPorts: '{"systemPort":9001}',
      capabilityBag: '{"x":1}',
      heldAt: lease.createdAt.getTime(),
    });
  });

  it('leaves ended leases and leases that have members alone', async () => {
    await scratch.db.lease.create({
      data: {
        ...base,
        id: 'lse_released',
        status: 'released',
        deviceUdid: 'u2',
        deviceHost: 'http://h:4723',
        allocatedPorts: '{}',
        capabilityBag: '{}',
      },
    });
    await scratch.db.lease.create({
      data: {
        ...base,
        id: 'lse_new',
        status: 'active',
        deviceUdid: 'u3',
        deviceHost: 'http://h:4723',
        allocatedPorts: '{}',
        capabilityBag: '{}',
        members: {
          create: { index: 0, udid: 'u3', host: 'http://h:4723', heldAt: Date.now() },
        },
      },
    });

    expect(await backfillLeaseMembers()).to.equal(0);
    expect(await scratch.db.leaseMember.count({ where: { leaseId: 'lse_released' } })).to.equal(0);
    expect(await scratch.db.leaseMember.count({ where: { leaseId: 'lse_new' } })).to.equal(1);
  });

  it('writes nothing the second time', async () => {
    await scratch.db.lease.create({
      data: {
        ...base,
        id: 'lse_twice',
        status: 'active',
        deviceUdid: 'u4',
        deviceHost: 'http://h:4723',
        allocatedPorts: '{}',
        capabilityBag: '{}',
      },
    });

    expect(await backfillLeaseMembers()).to.equal(1);
    expect(await backfillLeaseMembers()).to.equal(0);
    expect(await scratch.db.leaseMember.count({ where: { leaseId: 'lse_twice' } })).to.equal(1);
  });

  it('counts a member 0 another server wrote meanwhile as already there', async () => {
    const db = {
      lease: {
        findMany: async () => [
          {
            id: 'lse_raced',
            deviceUdid: 'u5',
            deviceHost: 'http://h:4723',
            allocatedPorts: '{}',
            capabilityBag: '{}',
            createdAt: new Date(),
          },
        ],
      },
      leaseMember: {
        create: async () => {
          throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
        },
      },
    };

    expect(await backfillLeaseMembers(db)).to.equal(0);
  });
});
