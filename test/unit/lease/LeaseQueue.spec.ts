import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';
import { LeaseQueue, MemberRequest } from '../../../src/services/lease/LeaseQueue';
import { phoneFreed } from '../../../src/services/lease/leaseQueueKick';
import { LeaseFilters } from '../../../src/services/lease/leaseFilters';
import { DeviceStoreFactory } from '../../../src/data-service/device-store';
import { withAllocationLock } from '../../../src/device-utils';
import { prisma } from '../../../src/prisma';
import { useScratchDatabase } from '../../helpers/scratch-database';
import { usePrismaStores } from '../../helpers/loki-stores';
import { OWN_NODE_ID, useOwnNodeId } from '../../helpers/own-node-id';

// Waiting leases form one queue, first come, first served. Only the head
// holds phones (a maximum matching of its members); a later request is
// granted only from phones the head neither holds nor matched.

const HOST = 'http://127.0.0.1:4723';
const HOUR = 60 * 60 * 1000;
const PORTS: Record<string, Record<string, number>> = {
  A: { systemPort: 8201, chromedriverPort: 9515, mjpegServerPort: 7811 },
  B: { systemPort: 8202, chromedriverPort: 9516, mjpegServerPort: 7812 },
  C: { systemPort: 8203, chromedriverPort: 9517, mjpegServerPort: 7813 },
};

const want = (udid: string): LeaseFilters => ({ platform: 'android', udid });

describe('LeaseQueue', () => {
  const scratch = useScratchDatabase();
  usePrismaStores();
  useOwnNodeId();

  let portClient: { allocate: sinon.SinonStub; release: sinon.SinonStub };
  let queue: LeaseQueue;
  let createdAt: number;

  const phone = (udid: string, over: Record<string, unknown> = {}) =>
    scratch.db.device.create({
      data: {
        udid,
        host: HOST,
        nodeId: OWN_NODE_ID,
        name: `Phone ${udid}`,
        platform: 'android',
        sdk: '13',
        busy: false,
        offline: false,
        userBlocked: false,
        deviceType: 'real',
        ...over,
      } as any,
    });

  /** A waiting lease, each one created after the one before. */
  async function waiter(
    id: string,
    members: LeaseFilters[],
    over: Record<string, unknown> = {},
  ): Promise<void> {
    createdAt += 1_000;
    await scratch.db.lease.create({
      data: {
        id,
        tokenHash: 'h',
        deviceUdid: '',
        deviceHost: '',
        actorId: 'key_owner',
        status: 'waiting',
        waitUntil: Date.now() + HOUR,
        expiresAt: 0,
        heartbeatSeconds: 30,
        lastHeartbeatAt: Date.now(),
        allocatedPorts: '{}',
        capabilityBag: '',
        requestedMembers: JSON.stringify(members),
        durationMs: 600_000,
        createdAt: new Date(createdAt),
        ...over,
      },
    });
  }

  const status = async (id: string) =>
    (await scratch.db.lease.findUnique({ where: { id } }))?.status;
  const members = (leaseId: string) =>
    scratch.db.leaseMember.findMany({ where: { leaseId }, orderBy: { index: 'asc' } });
  const busy = async (udid: string) =>
    (await scratch.db.device.findUnique({ where: { udid_host: { udid, host: HOST } } }))?.busy;

  beforeEach(async () => {
    await scratch.db.portLease.deleteMany({});
    await scratch.db.lease.deleteMany({});
    await scratch.db.device.deleteMany({});
    await scratch.db.team.deleteMany({});
    createdAt = Date.now() - HOUR;
    for (const udid of ['A', 'B', 'C']) await phone(udid);
    portClient = {
      allocate: sinon.stub().callsFake(async ({ udid }: any) => PORTS[udid]),
      release: sinon.stub().resolves({ released: 3 }),
    };
    queue = new LeaseQueue(prisma, DeviceStoreFactory.getStore(), portClient, {
      nodePairAuth: async () => ({ accessKey: '', token: '' }),
    });
  });

  afterEach(() => {
    queue.stop();
    sinon.restore();
  });

  it('grants the head when every member can be filled', async () => {
    await waiter('lse_head', [want('A'), want('B')]);

    await queue.pass();

    expect(await status('lse_head')).to.equal('active');
    const rows = await members('lse_head');
    expect(rows.map((r) => [r.index, r.udid])).to.deep.equal([
      [0, 'A'],
      [1, 'B'],
    ]);
    expect(JSON.parse(rows[1].allocatedPorts)).to.deep.equal(PORTS.B);
    expect(await busy('A')).to.equal(true);
    expect(await busy('B')).to.equal(true);
  });

  it('lets the head hold a maximum matching and nothing more', async () => {
    await scratch.db.device.update({
      where: { udid_host: { udid: 'B', host: HOST } },
      data: { busy: true },
    });
    await waiter('lse_head', [want('A'), want('B')]);

    await queue.pass();

    expect(await status('lse_head')).to.equal('waiting');
    const rows = await members('lse_head');
    expect(rows.map((r) => [r.index, r.udid])).to.deep.equal([[0, 'A']]);
    expect(rows[0].heldAt).to.be.greaterThan(0);
    expect(await busy('A')).to.equal(true);
    // Holding reserves nothing yet.
    expect(portClient.allocate.called).to.equal(false);

    // A second pass changes nothing.
    await queue.pass();
    expect((await members('lse_head')).map((r) => r.udid)).to.deep.equal(['A']);
  });

  it('grants a head from its holds once the rest come free', async () => {
    await scratch.db.device.update({
      where: { udid_host: { udid: 'B', host: HOST } },
      data: { busy: true },
    });
    await waiter('lse_head', [want('A'), want('B')]);
    await queue.pass();

    await scratch.db.device.update({
      where: { udid_host: { udid: 'B', host: HOST } },
      data: { busy: false },
    });
    await queue.pass();

    expect(await status('lse_head')).to.equal('active');
    expect((await members('lse_head')).map((r) => [r.index, r.udid])).to.deep.equal([
      [0, 'A'],
      [1, 'B'],
    ]);
  });

  it('moves a hold to another member when that grows the matching', async () => {
    // Member 0 takes A or C (both named Twin), member 1 only A, member 2
    // only B. B and C are busy: member 0 holds A.
    for (const udid of ['A', 'C']) {
      await scratch.db.device.update({
        where: { udid_host: { udid, host: HOST } },
        data: { name: 'Twin' },
      });
    }
    for (const udid of ['B', 'C']) {
      await scratch.db.device.update({
        where: { udid_host: { udid, host: HOST } },
        data: { busy: true },
      });
    }
    await waiter('lse_head', [{ platform: 'android', deviceName: 'twin' }, want('A'), want('B')]);

    await queue.pass();
    const first = await members('lse_head');
    expect(first.map((r) => [r.index, r.udid])).to.deep.equal([[0, 'A']]);
    const heldAt = first[0].heldAt;

    // C comes free: A moves to member 1, member 0 holds C.
    await scratch.db.device.update({
      where: { udid_host: { udid: 'C', host: HOST } },
      data: { busy: false },
    });
    await queue.pass();
    const rows = await members('lse_head');
    expect(rows.map((r) => [r.index, r.udid])).to.deep.equal([
      [0, 'C'],
      [1, 'A'],
    ]);
    expect(rows[1].heldAt, "A's hold keeps its time").to.equal(heldAt);
    expect(await status('lse_head')).to.equal('waiting');
  });

  it('backfills a later request only from phones the head cannot use', async () => {
    await scratch.db.device.update({
      where: { udid_host: { udid: 'B', host: HOST } },
      data: { busy: true },
    });
    await waiter('lse_head', [want('A'), want('B')]);
    await waiter('lse_second', [want('C')]);
    await waiter('lse_third', [want('A')]);

    await queue.pass();

    expect(await status('lse_head')).to.equal('waiting');
    expect(await status('lse_second')).to.equal('active');
    expect((await members('lse_second')).map((r) => r.udid)).to.deep.equal(['C']);
    expect(await status('lse_third')).to.equal('waiting');
    expect(await members('lse_third')).to.deep.equal([]);
  });

  it('serves waiters first come, first served', async () => {
    await scratch.db.device.update({
      where: { udid_host: { udid: 'A', host: HOST } },
      data: { busy: true },
    });
    await waiter('lse_older', [want('A')]);
    await waiter('lse_younger', [want('A')]);
    await queue.pass();
    expect(await status('lse_older')).to.equal('waiting');
    expect(await status('lse_younger')).to.equal('waiting');

    await scratch.db.device.update({
      where: { udid_host: { udid: 'A', host: HOST } },
      data: { busy: false },
    });
    await queue.pass();

    expect(await status('lse_older')).to.equal('active');
    expect(await status('lse_younger')).to.equal('waiting');
    expect(await queue.positionOf('lse_younger')).to.equal(1);
  });

  it('shows each waiter only phones its teams can see', async () => {
    const team = await scratch.db.team.create({ data: { name: 'Team T' } });
    await scratch.db.device.update({
      where: { udid_host: { udid: 'C', host: HOST } },
      data: { teamId: team.id },
    });
    await waiter('lse_shared_only', [want('C')], { callerTeamIds: '[]' });
    await waiter('lse_any', [{ platform: 'android' }, { platform: 'android' }], {
      callerTeamIds: '[]',
    });

    await queue.pass();
    await queue.pass();

    expect(await status('lse_shared_only')).to.equal('waiting');
    expect(await members('lse_shared_only')).to.deep.equal([]);
    expect(await busy('C')).to.equal(false);
    // The other waiter gets the shared pool's A and B, never C.
    expect(await status('lse_any')).to.equal('active');
    expect((await members('lse_any')).map((r) => r.udid).sort()).to.deep.equal(['A', 'B']);
  });

  it('logs a pass that throws, and the next pass works', async () => {
    await waiter('lse_head', [want('A')]);
    const findMany = prisma.lease.findMany as sinon.SinonStub;
    findMany.onCall(findMany.callCount).rejects(new Error('database is locked'));
    const warn = sinon.stub((queue as any).logger, 'warn');

    await queue.pass();
    expect(warn.calledOnce).to.equal(true);
    expect(String(warn.firstCall.args[0])).to.contain('database is locked');
    expect(await status('lse_head')).to.equal('waiting');

    await queue.pass();
    expect(await status('lse_head')).to.equal('active');
  });

  it('collapses kicks into one pass', async () => {
    const pass = sinon.stub(queue, 'pass').resolves();

    queue.kick();
    queue.kick();
    queue.kick();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(pass.callCount).to.equal(1);
  });

  it('runs a pass when a phone comes free, once started, and not after stop', async () => {
    const pass = sinon.stub(queue, 'pass').resolves();
    queue.start(60_000);

    phoneFreed();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(pass.callCount).to.equal(1);

    queue.stop();
    phoneFreed();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(pass.callCount).to.equal(1);
  });

  it('tells the listeners of a lease a pass changed, and a failing listener harms nothing', async () => {
    await scratch.db.device.update({
      where: { udid_host: { udid: 'B', host: HOST } },
      data: { busy: true },
    });
    await waiter('lse_head', [want('A'), want('B')]);
    await waiter('lse_other', [want('B')]);
    const head = sinon.spy();
    const other = sinon.spy();
    queue.onChange('lse_head', () => {
      throw new Error('listener broke');
    });
    const unsubscribe = queue.onChange('lse_head', head);
    queue.onChange('lse_other', other);

    await queue.pass();
    expect(head.callCount, 'the head took a hold').to.equal(1);
    expect(other.called, 'nothing changed for the other').to.equal(false);

    await queue.pass();
    expect(head.callCount, 'a pass that changed nothing').to.equal(1);

    unsubscribe();
    await scratch.db.device.update({
      where: { udid_host: { udid: 'B', host: HOST } },
      data: { busy: false },
    });
    await queue.pass();
    expect(await status('lse_head')).to.equal('active');
    expect(head.callCount).to.equal(1);
  });

  it('answers each waiter its place in the queue', async () => {
    await scratch.db.device.update({
      where: { udid_host: { udid: 'A', host: HOST } },
      data: { busy: true },
    });
    await waiter('lse_1', [want('A')]);
    await waiter('lse_2', [want('A')]);

    expect(await queue.positionOf('lse_1')).to.equal(1);
    expect(await queue.positionOf('lse_2')).to.equal(2);
    expect(await queue.positionOf('lse_unknown')).to.equal(null);
  });

  describe('tryNow', () => {
    const request = (memberFilters: LeaseFilters[]) => ({
      members: memberFilters.map((filters): MemberRequest => ({ filters })),
      durationMs: 600_000,
      actorId: 'key_now',
      teamId: null,
      buildId: 'b-1',
      reason: 'smoke',
      heartbeatSeconds: 30,
      tokenHash: 'hash-of-token',
    });

    it('grants a request every member of which a free phone fills', async () => {
      const out = await queue.tryNow({ ...request([want('A'), want('C')]), callerTeamIds: ['t1'] });

      expect(out).to.have.property('leaseId');
      const { leaseId } = out as { leaseId: string };
      const row = await scratch.db.lease.findUnique({ where: { id: leaseId } });
      expect(row).to.deep.include({
        status: 'active',
        tokenHash: 'hash-of-token',
        actorId: 'key_now',
        teamId: null,
        buildId: 'b-1',
        reason: 'smoke',
        heartbeatSeconds: 30,
        durationMs: 600_000,
        deviceUdid: 'A',
        callerTeamIds: '["t1"]',
      });
      expect(JSON.parse(row!.requestedMembers!)).to.deep.equal([want('A'), want('C')]);
      expect((await members(leaseId)).map((r) => [r.index, r.udid])).to.deep.equal([
        [0, 'A'],
        [1, 'C'],
      ]);
    });

    it('is busy when it would need a phone the head holds or matched', async () => {
      await scratch.db.device.update({
        where: { udid_host: { udid: 'B', host: HOST } },
        data: { busy: true },
      });
      await waiter('lse_head', [want('A'), want('B')]);

      expect(await queue.tryNow(request([want('A')]))).to.equal('busy');
      expect(await busy('A'), 'held for the head').to.equal(true);
      expect((await members('lse_head')).map((r) => r.udid)).to.deep.equal(['A']);

      // C is nobody's: granted.
      expect(await queue.tryNow(request([want('C')]))).to.have.property('leaseId');
    });

    it('is unhealthy when the phone it could have fails its port reservation', async () => {
      portClient.allocate.rejects(new Error('node down'));

      expect(await queue.tryNow(request([want('A')]))).to.equal('unhealthy');
      expect(await busy('A')).to.equal(false);
      expect(await scratch.db.lease.count()).to.equal(0);

      // Skipped for a while, and still unhealthy rather than busy.
      expect(await queue.tryNow(request([want('A')]))).to.equal('unhealthy');
      expect(portClient.allocate.callCount).to.equal(1);
    });

    it('tries another phone when the first one fails its port reservation', async () => {
      portClient.allocate.callsFake(async ({ udid }: any) => {
        if (udid === 'A') throw new Error('node down');
        return PORTS[udid];
      });

      const out = await queue.tryNow(request([{ platform: 'android' }]));

      expect(out).to.have.property('leaseId');
      const rows = await members((out as { leaseId: string }).leaseId);
      expect(rows.map((r) => r.udid)).to.have.length(1);
      expect(rows[0].udid).to.not.equal('A');
    });

    it("never offers another lease's phone whose busy was cleared", async () => {
      // A node's report, a forced release or a recovery can clear `busy` on a
      // leased phone. Nobody waits, and A is the store's first android phone.
      await scratch.db.lease.create({
        data: {
          id: 'lse_active',
          tokenHash: 'h',
          deviceUdid: 'A',
          deviceHost: HOST,
          actorId: 'key_other',
          status: 'active',
          expiresAt: Date.now() + HOUR,
          heartbeatSeconds: 30,
          lastHeartbeatAt: Date.now(),
          allocatedPorts: '{}',
          capabilityBag: '',
          members: { create: [{ index: 0, udid: 'A', host: HOST, heldAt: Date.now() }] },
        },
      });

      const out = await queue.tryNow(request([{ platform: 'android' }]));

      expect(out).to.have.property('leaseId');
      const rows = await members((out as { leaseId: string }).leaseId);
      expect(rows.map((r) => r.udid)).to.have.length(1);
      expect(rows[0].udid).to.not.equal('A');
    });

    it('leaves out a phone the lock refuses and tries the others', async () => {
      const store = DeviceStoreFactory.getStore() as any;
      const lock = store.findAndLockDevice.bind(store);
      const refused: string[] = [];
      sinon.stub(store, 'findAndLockDevice').callsFake(async (filter: any, options: any) => {
        if (refused.length === 0) {
          refused.push(filter.udid[0]);
          return null;
        }
        return lock(filter, options);
      });

      const out = await queue.tryNow(request([{ platform: 'android' }]));

      expect(out).to.have.property('leaseId');
      const rows = await members((out as { leaseId: string }).leaseId);
      expect(rows[0].udid).to.not.equal(refused[0]);
      expect(portClient.allocate.callCount, 'one grant, on a phone it could lock').to.equal(1);
    });

    it("throws when the lease can't be written, and gives the phone back", async () => {
      const create = prisma.lease.create as sinon.SinonStub;
      create.onCall(create.callCount).rejects(new Error('disk I/O error'));

      let thrown: Error | undefined;
      try {
        await queue.tryNow(request([want('A')]));
      } catch (err) {
        thrown = err as Error;
      }

      expect(thrown?.message).to.match(/couldn't be granted/);
      expect(await busy('A')).to.equal(false);
      expect(queue.granter.isSkipped(`A@${HOST}`), "not the phone's fault").to.equal(false);
      expect(await scratch.db.lease.count()).to.equal(0);
    });
  });

  describe('fix round 1', () => {
    const setBusy = (udid: string, value: boolean) =>
      scratch.db.device.update({
        where: { udid_host: { udid, host: HOST } },
        data: { busy: value },
      });

    it("keeps a hold whose phone's row is gone, and grants once the phone is back", async () => {
      await setBusy('B', true);
      await waiter('lse_head', [want('A'), want('B')]);
      await queue.pass();
      const [hold] = await members('lse_head');
      expect(hold).to.deep.include({ index: 0, udid: 'A' });

      // A hub clears its own rows at boot, then finds the phones again.
      await scratch.db.device.delete({ where: { udid_host: { udid: 'A', host: HOST } } });
      await setBusy('B', false);
      await queue.pass();

      const rows = await members('lse_head');
      expect(rows[0], 'the same row, untouched').to.deep.include({
        id: hold.id,
        index: 0,
        udid: 'A',
        heldAt: hold.heldAt,
      });
      // Member 1 holds B as before; A still counts as held for member 0.
      expect(rows.map((r) => [r.index, r.udid])).to.deep.equal([
        [0, 'A'],
        [1, 'B'],
      ]);
      expect(await status('lse_head'), 'not granted without A').to.equal('waiting');

      // A is found again (free, as discovery writes it).
      await phone('A');
      await queue.pass();
      expect(await status('lse_head')).to.equal('active');
      expect((await members('lse_head')).map((r) => [r.index, r.udid])).to.deep.equal([
        [0, 'A'],
        [1, 'B'],
      ]);
    });

    it('lets a later request past a head whose hold is away, but not onto its phone', async () => {
      await setBusy('B', true);
      await waiter('lse_head', [want('A'), want('B')]);
      await queue.pass();
      await scratch.db.device.delete({ where: { udid_host: { udid: 'A', host: HOST } } });
      await queue.pass();
      await phone('A', { busy: false });
      // A second request for A: the head holds it.
      await waiter('lse_later', [want('A')]);
      await queue.pass();
      expect(await status('lse_later')).to.equal('waiting');
    });

    it('re-seats a hold a move left under a negative index', async () => {
      await setBusy('A', true);
      await setBusy('B', true);
      await waiter('lse_head', [want('A'), want('B')]);
      await scratch.db.leaseMember.create({
        data: { leaseId: 'lse_head', index: -5, udid: 'A', host: HOST, heldAt: 123 },
      });

      await queue.pass();
      expect((await members('lse_head')).map((r) => [r.index, r.udid, r.heldAt])).to.deep.equal([
        [0, 'A', 123],
      ]);

      await setBusy('B', false);
      await queue.pass();
      expect(await status('lse_head')).to.equal('active');
      expect((await members('lse_head')).map((r) => [r.index, r.udid])).to.deep.equal([
        [0, 'A'],
        [1, 'B'],
      ]);
    });

    it('grants a head with a leftover negative-index hold without leaving that row', async () => {
      await setBusy('A', true);
      await waiter('lse_head', [want('A'), want('B')]);
      await scratch.db.leaseMember.create({
        data: { leaseId: 'lse_head', index: -3, udid: 'A', host: HOST, heldAt: 123 },
      });

      await queue.pass();

      expect(await status('lse_head')).to.equal('active');
      expect((await members('lse_head')).map((r) => [r.index, r.udid])).to.deep.equal([
        [0, 'A'],
        [1, 'B'],
      ]);
    });

    it('moves holds through temporary indices of their own, past leftovers', async () => {
      // A leftover row of a move cut short, at the temporary index the first
      // version would pick again.
      for (const udid of ['A', 'C']) {
        await scratch.db.device.update({
          where: { udid_host: { udid, host: HOST } },
          data: { name: 'Twin' },
        });
      }
      await setBusy('B', true);
      await setBusy('C', true);
      await waiter('lse_head', [{ platform: 'android', deviceName: 'twin' }, want('A'), want('B')]);
      await queue.pass();
      // C, busy so far, has a stray row of this lease at -2.
      await scratch.db.leaseMember.create({
        data: { leaseId: 'lse_head', index: -2, udid: 'C', host: HOST, heldAt: 77 },
      });
      await setBusy('C', true);

      await queue.pass();

      const rows = await members('lse_head');
      expect(rows.map((r) => [r.index, r.udid])).to.deep.equal([
        [0, 'C'],
        [1, 'A'],
      ]);
    });

    it('sets aside a waiter whose request it cannot read: warned once, never counted, holding nothing', async () => {
      await setBusy('C', true);
      const warn = sinon.stub((queue as any).logger, 'warn');
      await waiter('lse_bad', [{ filters: { platform: 'android' } } as any]);
      await scratch.db.leaseMember.create({
        data: { leaseId: 'lse_bad', index: 0, udid: 'C', host: HOST, heldAt: Date.now() },
      });
      await waiter('lse_zero', [want('B')], { durationMs: 0 });
      await waiter('lse_good', [want('A')]);

      expect(await queue.positionOf('lse_good')).to.equal(1);
      expect(await queue.positionOf('lse_bad')).to.equal(null);
      await queue.pass();
      await queue.pass();

      const warned = warn.getCalls().map((c) => String(c.args[0]));
      expect(warned.filter((m) => m.includes('lse_bad'))).to.have.length(1);
      expect(warned.filter((m) => m.includes('lse_zero'))).to.have.length(1);
      expect(await members('lse_bad')).to.deep.equal([]);
      expect(await busy('C'), 'its hold is let go').to.equal(false);
      expect(await status('lse_bad')).to.equal('waiting');
      expect(await status('lse_zero')).to.equal('waiting');
      expect(await status('lse_good'), 'the head').to.equal('active');
    });

    it('leaves out a waiter past its waitUntil', async () => {
      await waiter('lse_lapsed', [want('A')], { waitUntil: Date.now() - 1_000 });

      await queue.pass();

      expect(await status('lse_lapsed')).to.equal('waiting');
      expect(await members('lse_lapsed')).to.deep.equal([]);
      expect(await busy('A')).to.equal(false);
      expect(await queue.positionOf('lse_lapsed')).to.equal(null);
    });

    it('breaks a tie in createdAt by id', async () => {
      const at = new Date(Date.now() - HOUR / 2);
      await waiter('lse_b', [want('A')], { createdAt: at });
      await waiter('lse_a', [want('A')], { createdAt: at });

      expect(await queue.positionOf('lse_a')).to.equal(1);
      await queue.pass();

      expect(await status('lse_a')).to.equal('active');
      expect(await status('lse_b')).to.equal('waiting');
    });

    it("grants nothing on a head's failed grant, and holds what it still can", async () => {
      portClient.allocate.callsFake(async ({ udid }: any) => {
        if (udid === 'B') throw new Error('node down');
        return PORTS[udid];
      });
      await waiter('lse_head', [want('A'), want('B')]);

      await queue.pass();
      await queue.granter.settled();

      expect(await status('lse_head')).to.equal('waiting');
      expect((await members('lse_head')).map((r) => [r.index, r.udid])).to.deep.equal([[0, 'A']]);
      expect(await busy('A')).to.equal(true);
      expect(await busy('B')).to.equal(false);
      expect(queue.granter.isSkipped(`B@${HOST}`)).to.equal(true);
    });

    describe('kicks around the lock', () => {
      const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

      it('runs a pass that waited for the lock, once, for every kick while it waited', async () => {
        const serve = sinon.stub(queue as any, 'serveQueue').resolves();
        let unlock!: () => void;
        const held = withAllocationLock(() => new Promise<void>((r) => (unlock = r)));

        queue.kick();
        await tick();
        queue.kick();
        queue.kick();
        await tick();
        expect(serve.called, 'still waiting for the lock').to.equal(false);

        unlock();
        await held;
        await tick();
        expect(serve.callCount).to.equal(1);
      });

      it('runs one more pass for a kick that comes while a pass runs', async () => {
        let finish!: () => void;
        const serve = sinon.stub(queue as any, 'serveQueue');
        serve.onFirstCall().callsFake(() => new Promise<void>((r) => (finish = r)));
        serve.resolves();

        queue.kick();
        await tick();
        expect(serve.callCount, 'the first pass runs').to.equal(1);
        queue.kick();
        queue.kick();
        await tick();

        finish();
        await tick();
        expect(serve.callCount).to.equal(2);
      });

      it('keeps the kick of a waiting pass when another pass takes the lock first', async () => {
        const serve = sinon.stub(queue as any, 'serveQueue').resolves();
        let unlock!: () => void;
        const held = withAllocationLock(() => new Promise<void>((r) => (unlock = r)));

        const direct = queue.pass();
        queue.kick();
        await tick();
        queue.kick();
        unlock();
        await held;
        await direct;
        await tick();
        // The direct pass, then the kicked one; the second kick joined it.
        expect(serve.callCount).to.equal(2);
      });
    });
  });
});
