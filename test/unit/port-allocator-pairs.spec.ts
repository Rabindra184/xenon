import { expect } from 'chai';
import net from 'net';
import { PortAllocator, PortRangeExhaustedError } from '../../src/services/PortAllocator';
import { useScratchPortLeases } from '../helpers/scratch-port-leases';

/**
 * A go-ios tunnel needs two adjacent ports: P for its tunnel-info API and
 * P + 1, which go-ios derives for the phone's userspace traffic. These run
 * PortAllocator's real queries against a scratch lease table, and real binds.
 */
describe('PortAllocator.acquirePair (go-ios tunnel ports)', () => {
  const scratch = useScratchPortLeases();
  const listeners: net.Server[] = [];

  function allocator(range: [number, number]): PortAllocator {
    const a = new PortAllocator();
    a.configure({ tunnel: range });
    return a;
  }

  /** Something else listening on `port`, as another program's socket would. */
  function hold(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once('error', reject);
      server.listen(port, '0.0.0.0', () => resolve());
      listeners.push(server);
    });
  }

  async function leasesOf(udid: string): Promise<number[]> {
    const rows = await scratch.db.portLease.findMany({
      where: { leasedToUdid: udid },
      orderBy: { port: 'asc' },
    });
    return rows.map((r) => r.port);
  }

  async function leaseTo(udid: string, port: number, purpose: string): Promise<void> {
    const now = Date.now();
    await scratch.db.portLease.create({
      data: { port, purpose, leasedToUdid: udid, leasedAt: now, expiresAt: now + 60_000 },
    });
  }

  afterEach(async () => {
    await Promise.all(
      listeners.splice(0).map((s) => new Promise((resolve) => s.close(() => resolve(undefined)))),
    );
  });

  it('leases an even port and the next one, and returns the even one', async () => {
    const b = scratch.base;

    const port = await allocator([b, b + 5]).acquirePair('tunnel', 'phone-a', { ttlMs: 60_000 });

    expect(port).to.equal(b);
    expect(await leasesOf('phone-a')).to.deep.equal([b, b + 1]);
    const rows = await scratch.db.portLease.findMany({ where: { leasedToUdid: 'phone-a' } });
    expect(rows.map((r) => r.purpose)).to.deep.equal(['tunnel', 'tunnel']);
  });

  it('gives a second phone the next pair', async () => {
    const b = scratch.base;
    const a = allocator([b, b + 5]);
    await a.acquirePair('tunnel', 'phone-a');

    expect(await a.acquirePair('tunnel', 'phone-b')).to.equal(b + 2);
    expect(await leasesOf('phone-b')).to.deep.equal([b + 2, b + 3]);
  });

  it('skips a pair whose second port is leased, whatever for, and keeps none of it', async () => {
    const b = scratch.base;
    await leaseTo('another-device', b + 1, 'wda');

    expect(await allocator([b, b + 5]).acquirePair('tunnel', 'phone-a')).to.equal(b + 2);
    expect(await leasesOf('phone-a')).to.deep.equal([b + 2, b + 3]);
  });

  it('skips a pair whose second port something else listens on', async () => {
    const b = scratch.base;
    await hold(b + 1);

    expect(await allocator([b, b + 5]).acquirePair('tunnel', 'phone-a')).to.equal(b + 2);
    expect(await leasesOf('phone-a')).to.deep.equal([b + 2, b + 3]);
  });

  it('starts at the first even port of a range that starts odd', async () => {
    const b = scratch.base;

    expect(await allocator([b + 1, b + 4]).acquirePair('tunnel', 'phone-a')).to.equal(b + 2);
  });

  it('throws PortRangeExhaustedError when no pair is left, and keeps no half pair', async () => {
    const b = scratch.base;
    await leaseTo('another-phone', b + 1, 'tunnel');

    const err = await allocator([b, b + 1])
      .acquirePair('tunnel', 'phone-a')
      .then(
        () => null,
        (e: Error) => e,
      );

    expect(err).to.be.instanceOf(PortRangeExhaustedError);
    expect(err?.message).to.match(/tunnel/);
    expect(await leasesOf('phone-a')).to.deep.equal([]);
  });

  it("releasePurpose deletes only that purpose's leases", async () => {
    const b = scratch.base;
    const a = allocator([b, b + 5]);
    await a.acquirePair('tunnel', 'phone-a');
    await leaseTo('phone-a', b + 50, 'wda');

    await a.releasePurpose('tunnel');

    expect(await leasesOf('phone-a')).to.deep.equal([b + 50]);
  });
});
