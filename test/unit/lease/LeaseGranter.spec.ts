import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import {
  GroupLeaseRow,
  LeaseGranter,
  SKIP_FAILED_PHONE_MS,
} from '../../../src/services/lease/LeaseGranter';
import { prisma } from '../../../src/prisma';
import { useScratchDatabase } from '../../helpers/scratch-database';

const PHONE_1 = {
  udid: 'u1',
  host: 'http://h1:4723',
  platform: 'android',
  sdk: '14',
  name: 'Pixel 7',
} as any;
const PHONE_2 = {
  udid: 'u2',
  host: 'http://h2:4723',
  platform: 'android',
  sdk: '13',
  name: 'Galaxy S9',
} as any;
const KEY_1 = 'u1@http://h1:4723';
/** What Prisma throws for an update whose `where` matches no row. */
const NOT_FOUND = Object.assign(new Error('Record to update not found.'), { code: 'P2025' });
const KEY_2 = 'u2@http://h2:4723';
const PORTS: Record<string, Record<string, number>> = {
  [PHONE_1.host]: { systemPort: 8201, chromedriverPort: 9515, mjpegServerPort: 7811 },
  [PHONE_2.host]: { systemPort: 8202, chromedriverPort: 9516, mjpegServerPort: 7812 },
};

describe('LeaseGranter', () => {
  let db: any;
  let store: any;
  let portClient: any;
  let granter: LeaseGranter;

  beforeEach(() => {
    db = {
      lease: {
        update: sinon.stub().callsFake(async ({ data }: any) => data),
        create: sinon.stub().callsFake(async ({ data }: any) => data),
      },
      portLease: {
        updateMany: sinon.stub().resolves({ count: 3 }),
        // The phones are other servers': their port rows aren't here.
        deleteMany: sinon.stub().resolves({ count: 0 }),
      },
    };
    const phones = [PHONE_1, PHONE_2];
    store = {
      findAndLockDevice: sinon
        .stub()
        .callsFake(
          async ({ udid, filterByHost }: any) =>
            phones.find((p) => p.udid === udid[0] && p.host === filterByHost) ?? null,
        ),
      releaseLeaseLock: sinon.stub().resolves(true),
      updateDevice: sinon.stub().resolves(),
    };
    portClient = {
      allocate: sinon.stub().callsFake(async ({ nodeHost }: any) => PORTS[nodeHost]),
      release: sinon.stub().resolves({ released: 3 }),
    };
    granter = new LeaseGranter(db, store, portClient, {
      nodePairAuth: async () => ({ accessKey: 'k', token: 't' }),
    });
  });

  function waiting(heldKeys: string[]): GroupLeaseRow {
    return {
      id: 'lse_1',
      status: 'waiting',
      durationMs: 600_000,
      buildId: 'b-1',
      heldKeys: new Set(heldKeys),
    };
  }

  const released = () => store.releaseLeaseLock.getCalls().map((c: any) => c.args.join('@'));
  const freedHosts = () => portClient.release.getCalls().map((c: any) => c.args[0].nodeHost);

  it("reserves each member's ports on its own server and activates the lease", async () => {
    const before = Date.now();
    const out = await granter.grant(waiting([KEY_1]), [PHONE_1, PHONE_2]);
    expect(out).to.equal('granted');

    // A held phone is already locked; only the new one is.
    expect(store.findAndLockDevice.callCount).to.equal(1);
    expect(store.findAndLockDevice.firstCall.args[0]).to.deep.equal({
      udid: ['u2'],
      filterByHost: PHONE_2.host,
    });

    expect(portClient.allocate.callCount).to.equal(2);
    const allocated = portClient.allocate.getCalls().map((c: any) => c.args[0]);
    expect(allocated.map((a: any) => a.nodeHost)).to.have.members([PHONE_1.host, PHONE_2.host]);
    for (const a of allocated) {
      expect(a.leaseId).to.equal('lse_1');
      expect(a.durationMs).to.equal(600_000);
      expect(a.purposes).to.deep.equal(['systemPort', 'chromedriverPort', 'mjpegServerPort']);
      // Sent once: the pass holds the allocation lock while it waits.
      expect(a.once).to.equal(true);
    }

    // One conditional write activates the lease with every member.
    expect(db.lease.update.calledOnce).to.equal(true);
    const { where, data } = db.lease.update.firstCall.args[0];
    expect(where).to.deep.equal({ id: 'lse_1', status: 'waiting' });
    expect(data.status).to.equal('active');
    expect(data.expiresAt).to.be.within(before + 600_000, Date.now() + 600_000);
    expect(data.deviceUdid).to.equal('u1');
    expect(data.deviceHost).to.equal(PHONE_1.host);
    expect(JSON.parse(data.allocatedPorts)).to.deep.equal(PORTS[PHONE_1.host]);
    const bag0 = JSON.parse(data.capabilityBag);
    expect(bag0['appium:udid']).to.equal('u1');
    expect(bag0['xe:options']).to.deep.equal({ leaseId: 'lse_1', buildId: 'b-1', leaseMember: 0 });

    const upserts = data.members.upsert;
    expect(upserts).to.have.length(2);
    [PHONE_1, PHONE_2].forEach((phone, index) => {
      const { where: w, update, create } = upserts[index];
      expect(w).to.deep.equal({ leaseId_index: { leaseId: 'lse_1', index } });
      expect(create.index).to.equal(index);
      for (const row of [update, create]) {
        expect(row).to.deep.include({ udid: phone.udid, host: phone.host });
        expect(JSON.parse(row.allocatedPorts)).to.deep.equal(PORTS[phone.host]);
        const bag = JSON.parse(row.capabilityBag);
        expect(bag['appium:udid']).to.equal(phone.udid);
        expect(bag['xe:options'].leaseMember).to.equal(index);
      }
      expect(create.heldAt).to.be.at.least(before);
    });
    // No member beyond the group's.
    expect(data.members.deleteMany).to.deep.equal({ index: { gte: 2 } });

    // Each member's port rows carry the lease, scoped to its own phone.
    expect(db.portLease.updateMany.callCount).to.equal(2);
    const backfilled = db.portLease.updateMany.getCalls().map((c: any) => c.args[0]);
    expect(backfilled).to.deep.include({
      where: { port: { in: [8202, 9516, 7812] }, leasedToUdid: 'u2', leasedToHost: PHONE_2.host },
      data: { leaseId: 'lse_1' },
    });

    // Nothing rolled back.
    expect(store.releaseLeaseLock.called).to.equal(false);
    await granter.settled();
    expect(portClient.release.called).to.equal(false);
  });

  it("rolls back what it took when one member's ports fail, keeps the holds, and skips that phone for 60 s", async () => {
    portClient.allocate.callsFake(async ({ nodeHost }: any) => {
      if (nodeHost === PHONE_2.host) throw new Error('node down');
      return PORTS[nodeHost];
    });
    const before = Date.now();
    const out = await granter.grant(waiting([KEY_1]), [PHONE_1, PHONE_2]);
    expect(out).to.equal('failed');

    // Member 0's new ports are freed on its server.
    await granter.settled();
    expect(portClient.release.callCount).to.equal(1);
    expect(portClient.release.firstCall.args[0]).to.deep.include({
      nodeHost: PHONE_1.host,
      udid: 'u1',
      ports: [8201, 9515, 7811],
    });
    // The new phone's lock goes back; the held phone stays held.
    expect(released()).to.deep.equal([KEY_2]);

    // Nothing was activated or written.
    expect(db.lease.update.called).to.equal(false);
    expect(db.portLease.updateMany.called).to.equal(false);

    expect(granter.isSkipped(KEY_2)).to.equal(true);
    expect(granter.isSkipped(KEY_1)).to.equal(false);
    expect(SKIP_FAILED_PHONE_MS).to.equal(60_000);
    expect(granter.isSkipped(KEY_2, before + 59_000)).to.equal(true);
    expect(granter.isSkipped(KEY_2, Date.now() + 60_001)).to.equal(false);
    // Why, while it is skipped: what the phone's server said.
    expect(granter.skipReason(KEY_2)).to.equal('node down');
    expect(granter.skipReason(KEY_1)).to.equal(undefined);
    expect(granter.skipReason(KEY_2, Date.now() + 60_001)).to.equal(undefined);
  });

  describe("a phone's server that can't be reached", () => {
    // Axios's shapes: a timeout, a refused connection, a 5xx; a 4xx is the
    // server refusing that phone.
    const timeout = () =>
      Object.assign(new Error('timeout of 10000ms exceeded'), { code: 'ECONNABORTED' });
    const refused = () =>
      Object.assign(new Error('connect ECONNREFUSED 10.0.0.2:4723'), { code: 'ECONNREFUSED' });
    const status = (code: number) =>
      Object.assign(new Error(`Request failed with status code ${code}`), {
        response: { status: code },
      });
    const SAME_SERVER = 'u9@http://h2:4723';
    const OTHER_PORT = 'u9@http://h2:4799';

    for (const [what, error] of [
      ['a timeout', timeout],
      ['a refused connection', refused],
      ['a 5xx', () => status(502)],
    ] as const) {
      it(`${what} skips every phone on that server for 60 s`, async () => {
        portClient.allocate.callsFake(async ({ nodeHost }: any) => {
          if (nodeHost === PHONE_2.host) throw error();
          return PORTS[nodeHost];
        });
        const before = Date.now();

        expect(await granter.grant(waiting([]), [PHONE_1, PHONE_2])).to.equal('failed');

        expect(granter.isSkipped(KEY_2)).to.equal(true);
        expect(granter.isSkipped(SAME_SERVER), 'another phone of that server').to.equal(true);
        expect(granter.skipReason(SAME_SERVER)).to.equal(error().message);
        expect(granter.isSkipped(SAME_SERVER, before + 59_000)).to.equal(true);
        expect(granter.isSkipped(SAME_SERVER, Date.now() + 60_001)).to.equal(false);
        expect(granter.skipReason(SAME_SERVER, Date.now() + 60_001)).to.equal(undefined);
        expect(granter.isSkipped(OTHER_PORT), 'another server on that machine').to.equal(false);
        expect(granter.isSkipped(KEY_1), 'the server that answered').to.equal(false);
      });
    }

    it("a 4xx skips only that phone: the server answered, about it", async () => {
      portClient.allocate.callsFake(async ({ nodeHost }: any) => {
        if (nodeHost === PHONE_2.host) throw status(403);
        return PORTS[nodeHost];
      });

      expect(await granter.grant(waiting([]), [PHONE_1, PHONE_2])).to.equal('failed');

      expect(granter.isSkipped(KEY_2)).to.equal(true);
      expect(granter.isSkipped(SAME_SERVER)).to.equal(false);
      expect(granter.skipReason(SAME_SERVER)).to.equal(undefined);
    });

    it('counts each grant whose reservation failed, once', async () => {
      expect(granter.reservationFailures).to.equal(0);
      portClient.allocate.rejects(timeout());

      await granter.grant(waiting([]), [PHONE_1, PHONE_2]);
      expect(granter.reservationFailures, 'two members failed, one grant').to.equal(1);

      store.findAndLockDevice.resolves(null);
      await granter.grant(waiting([]), [PHONE_1]);
      expect(granter.reservationFailures, 'a phone taken meanwhile is no reservation').to.equal(1);
    });
  });

  it('rolls back everything, holds included, when the lease is no longer waiting', async () => {
    db.lease.update.rejects(NOT_FOUND);
    // A hold the grant doesn't use goes too: nobody else will release it.
    const away = 'u3@http://h3:4723';
    const out = await granter.grant(waiting([KEY_1, away]), [PHONE_1, PHONE_2]);
    expect(out).to.equal('gone');

    await granter.settled();
    expect(freedHosts()).to.have.members([PHONE_1.host, PHONE_2.host]);
    expect(released()).to.have.members([KEY_1, KEY_2, away]);
    expect(db.portLease.updateMany.called).to.equal(false);
    // Neither phone is to blame.
    expect(granter.isSkipped(KEY_1)).to.equal(false);
    expect(granter.isSkipped(KEY_2)).to.equal(false);
  });

  it('frees nothing on the phone server when this server deleted the port rows itself', async () => {
    db.lease.update.rejects(NOT_FOUND);
    db.portLease.deleteMany.resolves({ count: 3 });
    await granter.grant(waiting([]), [PHONE_1, PHONE_2]);
    await granter.settled();
    expect(portClient.release.called).to.equal(false);
    const deleted = db.portLease.deleteMany.getCalls().map((c: any) => c.args[0]);
    expect(deleted).to.deep.include({
      where: { port: { in: [8201, 9515, 7811] }, leasedToUdid: 'u1', leasedToHost: PHONE_1.host },
    });
  });

  it('gives up without skipping a phone when a new phone was taken meanwhile', async () => {
    store.findAndLockDevice.callsFake(async ({ udid }: any) => (udid[0] === 'u1' ? PHONE_1 : null));
    const out = await granter.grant(waiting([]), [PHONE_1, PHONE_2]);
    expect(out).to.equal('failed');
    expect(released()).to.deep.equal([KEY_1]);
    expect(portClient.allocate.called).to.equal(false);
    expect(granter.isSkipped(KEY_2)).to.equal(false);
  });

  it('gives back a lock taken on another row of the udid', async () => {
    const twin = { ...PHONE_2, host: 'http://h2:47230' };
    store.findAndLockDevice.callsFake(async ({ udid }: any) => (udid[0] === 'u1' ? PHONE_1 : twin));
    const out = await granter.grant(waiting([]), [PHONE_1, PHONE_2]);
    expect(out).to.equal('failed');
    expect(store.updateDevice.calledOnceWith('u2', twin.host, { busy: false })).to.equal(true);
    expect(released()).to.deep.equal([KEY_1]);
  });

  it('releases a held phone the grant no longer uses', async () => {
    const out = await granter.grant(waiting([KEY_1, 'u3@http://h3:4723']), [PHONE_1, PHONE_2]);
    expect(out).to.equal('granted');
    expect(released()).to.deep.equal(['u3@http://h3:4723']);
  });

  it('keeps the holds and gives back the rest when the activation fails', async () => {
    db.lease.update.rejects(new Error('database is locked'));
    const out = await granter.grant(waiting([KEY_1]), [PHONE_1, PHONE_2]);
    expect(out).to.equal('failed');
    expect(released()).to.deep.equal([KEY_2]);
    await granter.settled();
    expect(freedHosts()).to.have.members([PHONE_1.host, PHONE_2.host]);
    expect(granter.isSkipped(KEY_1)).to.equal(false);
    expect(granter.isSkipped(KEY_2)).to.equal(false);
  });

  it('stays granted when marking the port rows fails', async () => {
    db.portLease.updateMany.rejects(new Error('database is locked'));
    expect(await granter.grant(waiting([]), [PHONE_1, PHONE_2])).to.equal('granted');
    expect(store.releaseLeaseLock.called).to.equal(false);
  });

  describe("a request not yet written ('trying')", () => {
    const createData = {
      tokenHash: 'hash',
      actorId: 'actor-1',
      teamId: null,
      buildId: 'b-1',
      reason: 'ci',
      heartbeatSeconds: 30,
      requestedMembers: JSON.stringify([{ platform: 'android' }, { platform: 'android' }]),
      callerTeamIds: null,
      durationMs: 600_000,
    };
    const trying = (): GroupLeaseRow => ({
      id: 'lse_new',
      status: 'trying',
      durationMs: 600_000,
      buildId: 'b-1',
      heldKeys: new Set(),
      createData,
    });

    it('creates an active row with all its members', async () => {
      const before = Date.now();
      const out = await granter.grant(trying(), [PHONE_1, PHONE_2]);
      expect(out).to.equal('granted');
      expect(store.findAndLockDevice.callCount).to.equal(2);
      expect(db.lease.update.called).to.equal(false);

      expect(db.lease.create.calledOnce).to.equal(true);
      const { data } = db.lease.create.firstCall.args[0];
      expect(data).to.deep.include({ ...createData, id: 'lse_new', status: 'active' });
      expect(data.expiresAt).to.be.within(before + 600_000, Date.now() + 600_000);
      expect(data.lastHeartbeatAt).to.be.within(before, Date.now());
      expect(data.deviceUdid).to.equal('u1');
      expect(data.deviceHost).to.equal(PHONE_1.host);
      expect(JSON.parse(data.allocatedPorts)).to.deep.equal(PORTS[PHONE_1.host]);
      expect(JSON.parse(data.capabilityBag)['xe:options'].leaseMember).to.equal(0);
      expect(data.members.create).to.have.length(2);
      data.members.create.forEach((m: any, index: number) => {
        const phone = [PHONE_1, PHONE_2][index];
        expect(m).to.deep.include({ index, udid: phone.udid, host: phone.host });
        expect(JSON.parse(m.allocatedPorts)).to.deep.equal(PORTS[phone.host]);
        expect(JSON.parse(m.capabilityBag)['xe:options']).to.deep.equal({
          leaseId: 'lse_new',
          buildId: 'b-1',
          leaseMember: index,
        });
        expect(m.heldAt).to.be.at.least(before);
      });
      expect(db.portLease.updateMany.callCount).to.equal(2);
    });

    it('writes nothing, and gives back its locks and ports, when a member fails', async () => {
      portClient.allocate.callsFake(async ({ nodeHost }: any) => {
        if (nodeHost === PHONE_2.host) throw new Error('node down');
        return PORTS[nodeHost];
      });
      const out = await granter.grant(trying(), [PHONE_1, PHONE_2]);
      expect(out).to.equal('failed');
      expect(db.lease.create.called).to.equal(false);
      expect(db.portLease.updateMany.called).to.equal(false);
      expect(released()).to.have.members([KEY_1, KEY_2]);
      await granter.settled();
      expect(freedHosts()).to.deep.equal([PHONE_1.host]);
      expect(granter.isSkipped(KEY_2)).to.equal(true);
    });

    it('rolls back like a failure when the row cannot be created', async () => {
      db.lease.create.rejects(
        Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
      );
      const out = await granter.grant(trying(), [PHONE_1, PHONE_2]);
      expect(out).to.equal('failed');
      expect(released()).to.have.members([KEY_1, KEY_2]);
      await granter.settled();
      expect(freedHosts()).to.have.members([PHONE_1.host, PHONE_2.host]);
      expect(granter.isSkipped(KEY_1)).to.equal(false);
      expect(granter.isSkipped(KEY_2)).to.equal(false);
    });
  });

  // The same writes against a real database, through the `prisma` wrapper
  // every lease service uses: the shapes the stubs above accept must be ones
  // Prisma takes.
  describe('against a database', () => {
    const scratch = useScratchDatabase();

    beforeEach(async () => {
      granter = new LeaseGranter(prisma, store, portClient, {
        nodePairAuth: async () => ({ accessKey: 'k', token: 't' }),
      });
      await scratch.db.leaseMember.deleteMany({});
      await scratch.db.lease.deleteMany({});
      await scratch.db.portLease.deleteMany({});
    });

    /** A waiting lease holding PHONE_1 as member 0. */
    const seedWaiting = (status = 'waiting') =>
      scratch.db.lease.create({
        data: {
          id: 'lse_1',
          tokenHash: 'h',
          deviceUdid: '',
          deviceHost: '',
          actorId: 'actor-1',
          status,
          waitUntil: Date.now() + 60_000,
          expiresAt: 0,
          lastHeartbeatAt: Date.now(),
          allocatedPorts: '{}',
          capabilityBag: '',
          members: { create: [{ index: 0, udid: 'u1', host: PHONE_1.host, heldAt: 1 }] },
        },
      });

    it("activates a waiting lease with every member, keeping a hold's heldAt", async () => {
      await seedWaiting();
      // This server's own reservation of member 1's ports.
      await scratch.db.portLease.createMany({
        data: Object.entries(PORTS[PHONE_2.host]).map(([purpose, port]) => ({
          port,
          purpose,
          leasedToUdid: 'u2',
          leasedToHost: PHONE_2.host,
          leasedAt: Date.now(),
          expiresAt: Date.now() + 60_000,
        })),
      });
      expect(await granter.grant(waiting([KEY_1]), [PHONE_1, PHONE_2])).to.equal('granted');

      const lease = await scratch.db.lease.findUniqueOrThrow({
        where: { id: 'lse_1' },
        include: { members: { orderBy: { index: 'asc' } } },
      });
      expect(lease.status).to.equal('active');
      expect(lease.deviceUdid).to.equal('u1');
      expect(lease.members.map((m) => [m.index, m.udid])).to.deep.equal([
        [0, 'u1'],
        [1, 'u2'],
      ]);
      expect(lease.members[0].heldAt).to.equal(1);
      expect(JSON.parse(lease.members[1].capabilityBag)['xe:options'].leaseMember).to.equal(1);
      const portRows = await scratch.db.portLease.findMany({ where: { leaseId: 'lse_1' } });
      expect(portRows).to.have.length(3);
    });

    it('changes nothing for a lease that is no longer waiting', async () => {
      await seedWaiting('expired');
      expect(await granter.grant(waiting([KEY_1]), [PHONE_1, PHONE_2])).to.equal('gone');
      const lease = await scratch.db.lease.findUniqueOrThrow({
        where: { id: 'lse_1' },
        include: { members: true },
      });
      expect(lease.status).to.equal('expired');
      expect(lease.members).to.have.length(1);
      expect(lease.members[0].allocatedPorts).to.equal('{}');
    });

    it("creates a 'trying' request's row active with its members, and nothing when it fails", async () => {
      const trying: GroupLeaseRow = {
        id: 'lse_new',
        status: 'trying',
        durationMs: 600_000,
        heldKeys: new Set(),
        createData: {
          tokenHash: 'hash',
          actorId: 'actor-1',
          teamId: null,
          heartbeatSeconds: 30,
          requestedMembers: '[]',
          callerTeamIds: null,
          durationMs: 600_000,
        },
      };
      expect(await granter.grant(trying, [PHONE_1, PHONE_2])).to.equal('granted');
      const lease = await scratch.db.lease.findUniqueOrThrow({
        where: { id: 'lse_new' },
        include: { members: { orderBy: { index: 'asc' } } },
      });
      expect(lease.status).to.equal('active');
      expect(lease.durationMs).to.equal(600_000);
      expect(lease.members.map((m) => m.udid)).to.deep.equal(['u1', 'u2']);

      // The same id again: the create fails, and nothing more is written.
      expect(await granter.grant(trying, [PHONE_1, PHONE_2])).to.equal('failed');
      expect(await scratch.db.lease.count()).to.equal(1);
      expect(await scratch.db.leaseMember.count()).to.equal(2);
    });
  });
});
