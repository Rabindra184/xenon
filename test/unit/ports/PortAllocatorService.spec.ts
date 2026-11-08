import 'reflect-metadata';
import { expect } from 'chai';
import sinon from 'sinon';

describe('PortAllocatorService', () => {
  let prismaStub: any;
  let getPortStub: any;
  let svc: any;

  beforeEach(async () => {
    getPortStub = sinon.stub().resolves(0);
    let n = 9001;
    getPortStub.callsFake(async () => n++);

    prismaStub = {
      portLease: {
        create: sinon.stub().callsFake(async ({ data }: any) => data),
        deleteMany: sinon.stub().resolves({ count: 0 }),
        updateMany: sinon.stub().resolves({ count: 3 }),
      },
    };

    const { PortAllocatorService } = await import('../../../src/services/ports/PortAllocatorService');
    svc = new PortAllocatorService(prismaStub as any, getPortStub);
  });

  it('returns one port per requested purpose', async () => {
    const ports = await svc.allocate({
      udid: 'u1',
      host: 'h1',
      purposes: ['systemPort', 'chromedriverPort', 'mjpegServerPort'],
      durationMs: 60_000,
    });
    expect(ports.systemPort).to.equal(9001);
    expect(ports.chromedriverPort).to.equal(9002);
    expect(ports.mjpegServerPort).to.equal(9003);
    expect(prismaStub.portLease.create.callCount).to.equal(3);
  });

  it('rolls back PortLease rows when a later get-port call throws', async () => {
    // 9001 ok, then throw, so the first row should be cleaned up.
    getPortStub.onFirstCall().resolves(9001);
    getPortStub.onSecondCall().rejects(new Error('boom'));

    let thrown: any = null;
    try {
      await svc.allocate({
        udid: 'u1',
        host: 'h1',
        purposes: ['systemPort', 'chromedriverPort'],
        durationMs: 60_000,
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).to.be.an('Error');
    expect(thrown.message).to.include('boom');
    expect(prismaStub.portLease.deleteMany.callCount).to.equal(1);
    expect(prismaStub.portLease.deleteMany.firstCall.args[0].where.port).to.deep.equal({ in: [9001] });
  });
  describe('extend', () => {
    // The lease's end, plus the same 5 minutes allocate adds.
    it("holds the lease's ports until its new end plus 5 minutes, only for that phone", async () => {
      const expiresAt = Date.now() + 60 * 60_000;
      const out = await svc.extend({ udid: 'u1', ports: [9001, 9002], expiresAt });
      expect(out).to.deep.equal({ extended: 3 });
      const { where, data } = prismaStub.portLease.updateMany.firstCall.args[0];
      expect(where.port).to.deep.equal({ in: [9001, 9002] });
      expect(where.leasedToUdid).to.equal('u1');
      expect(data.expiresAt).to.equal(expiresAt + 5 * 60_000);
      // Never earlier than a row already says.
      expect(where.expiresAt).to.deep.equal({ lt: expiresAt + 5 * 60_000 });
    });

    it('holds no port longer than 24 hours from now', async () => {
      const before = Date.now();
      await svc.extend({ udid: 'u1', ports: [9001], expiresAt: before + 72 * 60 * 60_000 });
      const { data } = prismaStub.portLease.updateMany.firstCall.args[0];
      expect(data.expiresAt).to.be.at.most(Date.now() + 24 * 60 * 60_000 + 5 * 60_000);
      expect(data.expiresAt).to.be.at.least(before + 24 * 60 * 60_000 + 5 * 60_000);
    });
  });
  describe('release', () => {
    it('deletes the ports still leased to that phone, and says how many', async () => {
      prismaStub.portLease.deleteMany.resolves({ count: 2 });
      const out = await svc.release({ udid: 'u1', ports: [9001, 9002] });
      expect(out).to.deep.equal({ released: 2 });
      const { where } = prismaStub.portLease.deleteMany.firstCall.args[0];
      expect(where).to.deep.equal({ port: { in: [9001, 9002] }, leasedToUdid: 'u1' });
    });
  });
});

/**
 * A lease's ports come from Xenon's own range, never from the OS's ephemeral
 * ports. Through 2.20 they were get-port's OS-assigned ports (49152-65535 on
 * macOS), the range every program's outgoing connections and listeners draw
 * on: between the reservation and the session, Android Studio took one, and
 * the session failed with "adb: error: cannot bind listener: Address already
 * in use".
 */
describe('PortAllocatorService — the lease port range', () => {
  let rows: Array<{ port: number; expiresAt: number }>;
  let db: any;
  let busyOnMachine: Set<number>;
  let svc: any;
  let LEASE_PORT_RANGE: [number, number];

  const allocate = (purposes: string[]) =>
    svc.allocate({ udid: 'u1', host: 'h1', purposes, durationMs: 60_000 });

  beforeEach(async () => {
    rows = [];
    busyOnMachine = new Set();
    db = {
      portLease: {
        findMany: sinon.stub().callsFake(async () => rows.map((r) => ({ port: r.port }))),
        create: sinon.stub().callsFake(async ({ data }: any) => {
          if (rows.some((r) => r.port === data.port)) {
            throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
          }
          rows.push(data);
          return data;
        }),
        deleteMany: sinon.stub().resolves({ count: 0 }),
        updateMany: sinon.stub().resolves({ count: 0 }),
      },
    };
    const mod = await import('../../../src/services/ports/PortAllocatorService');
    LEASE_PORT_RANGE = mod.LEASE_PORT_RANGE;
    svc = new mod.PortAllocatorService(
      db,
      mod.leasePortPicker(db, async (port: number) => !busyOnMachine.has(port)),
    );
  });

  it('is 13100-13999, outside every OS ephemeral range and Xenon’s other ranges', () => {
    expect(LEASE_PORT_RANGE).to.deep.equal([13100, 13999]);
  });

  it('gives each purpose the first free port of the range', async () => {
    const ports = await allocate(['systemPort', 'chromedriverPort', 'mjpegServerPort']);
    expect(ports).to.deep.equal({
      systemPort: 13100,
      chromedriverPort: 13101,
      mjpegServerPort: 13102,
    });
  });

  it('skips a port another lease holds', async () => {
    rows.push({ port: 13100, expiresAt: Date.now() + 60_000 });
    const ports = await allocate(['wdaLocalPort']);
    expect(ports.wdaLocalPort).to.equal(13101);
  });

  it('skips a port something on this machine listens on', async () => {
    busyOnMachine.add(13100);
    const ports = await allocate(['wdaLocalPort']);
    expect(ports.wdaLocalPort).to.equal(13101);
  });

  it('tries the next port when another reservation took this one meanwhile', async () => {
    // Free when the picker read the table, taken by the time the row is written.
    db.portLease.findMany.callsFake(async () => []);
    rows.push({ port: 13100, expiresAt: Date.now() + 60_000 });
    const ports = await allocate(['wdaLocalPort']);
    expect(ports.wdaLocalPort).to.equal(13101);
  });

  it('first clears reservations in the range that have expired', async () => {
    await allocate(['wdaLocalPort']);
    const where = db.portLease.deleteMany.firstCall.args[0].where;
    expect(where.port).to.deep.equal({ gte: 13100, lte: 13999 });
    expect(where.expiresAt.lt).to.be.a('number');
  });

  it('says so when the range is used up, and gives back what it took', async () => {
    for (let p = 13101; p <= 13999; p++) busyOnMachine.add(p);
    const err = await allocate(['systemPort', 'chromedriverPort']).then(
      () => null,
      (e: Error) => e,
    );
    expect(err?.message).to.equal('No lease port is free in 13100-13999');
    expect(rows.map((r) => r.port)).to.deep.equal([13100]);
    expect(db.portLease.deleteMany.lastCall.args[0].where.port).to.deep.equal({ in: [13100] });
  });
});
