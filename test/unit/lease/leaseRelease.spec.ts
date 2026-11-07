import { expect } from 'chai';
import sinon from 'sinon';
import { leaseMembersOf, releaseLeaseMembers } from '../../../src/services/lease/leaseRelease';

// What an ended lease's members give back: their port rows, their ports on
// their phones' servers and their lease locks, every step for every member.

describe('releaseLeaseMembers', () => {
  const ports = JSON.stringify({ systemPort: 8201, chromedriverPort: 9515 });
  const members = [
    { udid: 'E', host: 'http://node:4723', allocatedPorts: ports },
    { udid: 'E', host: 'http://hub:4723', allocatedPorts: ports },
  ];

  let db: any;
  let store: any;
  let phoneServerPorts: any;
  let logger: any;
  const deps = () => ({ db, store, phoneServerPorts, logger });

  beforeEach(() => {
    db = { portLease: { deleteMany: sinon.stub().resolves({ count: 0 }) } };
    store = { releaseLeaseLock: sinon.stub().resolves(true) };
    phoneServerPorts = { free: sinon.stub() };
    logger = { warn: sinon.stub() };
  });

  it("deletes each member's rows by its udid and host, then the lease's others", async () => {
    db.portLease.deleteMany.onSecondCall().resolves({ count: 2 });

    const out = await releaseLeaseMembers(deps(), { id: 'lse_1' }, members);

    expect(db.portLease.deleteMany.getCalls().map((c: any) => c.args[0].where)).to.deep.equal([
      {
        leaseId: 'lse_1',
        port: { in: [8201, 9515] },
        leasedToUdid: 'E',
        leasedToHost: 'http://node:4723',
      },
      {
        leaseId: 'lse_1',
        port: { in: [8201, 9515] },
        leasedToUdid: 'E',
        leasedToHost: 'http://hub:4723',
      },
      { leaseId: 'lse_1' },
    ]);
    const freed = phoneServerPorts.free
      .getCalls()
      .map((c: any) => [c.args[0].deviceHost, c.args[1]]);
    expect(freed).to.deep.equal([
      ['http://node:4723', 0],
      ['http://hub:4723', 2],
    ]);
    expect(out).to.deep.equal({ freed: 2 });
  });

  it('tries every step for every member, then throws the first failure', async () => {
    const first = new Error('database is locked');
    db.portLease.deleteMany.onFirstCall().rejects(first);
    store.releaseLeaseLock.onFirstCall().rejects(new Error('store down'));

    let thrown: unknown;
    await releaseLeaseMembers(deps(), { id: 'lse_1' }, members).catch((err) => (thrown = err));

    expect(thrown).to.equal(first);
    expect(db.portLease.deleteMany.callCount).to.equal(3);
    // The failed delete counts as nothing deleted here: the server is asked.
    expect(phoneServerPorts.free.getCalls().map((c: any) => c.args[1])).to.deep.equal([0, 0]);
    expect(store.releaseLeaseLock.callCount).to.equal(2);
    expect(logger.warn.callCount).to.equal(2);
  });

  it('counts only the locks it released', async () => {
    store.releaseLeaseLock.onFirstCall().resolves(false);
    expect(await releaseLeaseMembers(deps(), { id: 'lse_1' }, members)).to.deep.equal({
      freed: 1,
    });
  });

  it('reads a lease from before groups as member 0 from its own columns', () => {
    expect(
      leaseMembersOf({ deviceUdid: 'u1', deviceHost: 'h1', allocatedPorts: ports, members: [] }),
    ).to.deep.equal([
      { index: 0, udid: 'u1', host: 'h1', allocatedPorts: ports, capabilityBag: '' },
    ]);
    expect(leaseMembersOf({ deviceUdid: '', members: [] })).to.deep.equal([]);
  });
});
