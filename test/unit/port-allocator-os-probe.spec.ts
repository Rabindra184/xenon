import 'reflect-metadata';
import { expect } from 'chai';
import net from 'net';
import sinon from 'sinon';
import { PortAllocator } from '../../src/services/PortAllocator';
import { useScratchPortLeases } from '../helpers/scratch-port-leases';

/**
 * PortAllocator against real sockets and a scratch lease table.
 *
 * On the lab an iPhone's iproxy listened on the IPv6 wildcard (`*:9100`). The
 * allocator probed by binding 127.0.0.1:9100, which macOS allows beside a
 * wildcard listener, so it called 9100 free and leased it to the S9+. The
 * S9+'s MJPEG server then bound 127.0.0.1:9100, took every 127.0.0.1
 * connection from the iPhone's iproxy, and the iPhone's recording read the
 * S9+'s screen.
 */

type Shape = { host: string; ipv6Only?: boolean; label: string };

const SHAPES: Shape[] = [
  { host: '127.0.0.1', label: 'IPv4 loopback (127.0.0.1)' },
  { host: '::1', label: 'IPv6 loopback (::1)' },
  { host: '0.0.0.0', label: 'IPv4 wildcard (0.0.0.0)' },
  { host: '::', label: 'IPv6 wildcard, dual-stack (::) — what iproxy does' },
  { host: '::', ipv6Only: true, label: 'IPv6 wildcard, v6-only (::)' },
];

function listen(port: number, host: string, ipv6Only = false): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => socket.destroy());
    server.once('error', reject);
    server.listen({ port, host, ipv6Only }, () => resolve(server));
  });
}

function close(server: net.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe('PortAllocator OS probe and lease ownership (real sockets, scratch DB)', () => {
  const scratch = useScratchPortLeases();
  let allocator: PortAllocator;
  let servers: net.Server[];

  beforeEach(() => {
    allocator = new PortAllocator();
    allocator.configure({
      mjpeg: [scratch.base, scratch.base + 1],
      wda: [scratch.base + 50, scratch.base + 51],
    });
    servers = [];
  });

  afterEach(async () => {
    await Promise.all(servers.map(close));
    sinon.restore();
  });

  async function occupy(port: number, shape: Shape) {
    servers.push(await listen(port, shape.host, shape.ipv6Only));
  }

  async function leaseOf(port: number) {
    return scratch.db.portLease.findUnique({ where: { port } });
  }

  describe('acquire skips a port something is listening on', () => {
    for (const shape of SHAPES) {
      it(`a listener on ${shape.label}`, async () => {
        await occupy(scratch.base, shape);

        const port = await allocator.acquire('mjpeg', 'android-s9');

        expect(port, `must not lease a port with a listener on ${shape.host}`).to.equal(
          scratch.base + 1,
        );
        expect(await leaseOf(scratch.base)).to.equal(null);
        expect((await leaseOf(scratch.base + 1))?.leasedToUdid).to.equal('android-s9');
      });
    }

    it("drops the udid's own stale lease when an iproxy-shaped listener holds the port", async () => {
      // The reuse path: the S9+ still has a lease row on the port while the
      // iPhone's iproxy is the one listening there.
      const now = Date.now();
      await scratch.db.portLease.create({
        data: {
          port: scratch.base,
          purpose: 'mjpeg',
          leasedToUdid: 'android-s9',
          leasedAt: now,
          expiresAt: now + 60_000,
        },
      });
      await occupy(scratch.base, SHAPES[3]);

      const port = await allocator.acquire('mjpeg', 'android-s9');

      expect(port).to.equal(scratch.base + 1);
      expect(await leaseOf(scratch.base)).to.equal(null);
    });
  });

  it('still leases a port nothing is listening on', async () => {
    const port = await allocator.acquire('mjpeg', 'android-s9');
    expect(port).to.equal(scratch.base);
    const row = await leaseOf(scratch.base);
    expect(row?.leasedToUdid).to.equal('android-s9');
    expect(row?.purpose).to.equal('mjpeg');
  });

  describe('a host without IPv6', () => {
    it('does not count an IPv6 address it cannot bind as "in use"', async () => {
      const probe = sinon.stub(allocator as any, 'bindProbe').callsFake(async (...args: any[]) => {
        const host = args[1] as string;
        if (host === '::') return 'EAFNOSUPPORT';
        if (host === '::1') return 'EADDRNOTAVAIL';
        return null;
      });

      expect(await allocator.acquire('mjpeg', 'android-s9')).to.equal(scratch.base);
      const hosts = probe.getCalls().map((c) => c.args[1]);
      expect(hosts).to.include.members(['127.0.0.1', '0.0.0.0', '::1', '::']);
    });

    it('still counts EADDRINUSE on an IPv6 address as in use', async () => {
      sinon.stub(allocator as any, 'bindProbe').callsFake(async (...args: any[]) => {
        const [port, host] = args as [number, string];
        return host === '::' && port === scratch.base ? 'EADDRINUSE' : null;
      });

      expect(await allocator.acquire('mjpeg', 'android-s9')).to.equal(scratch.base + 1);
    });
  });

  describe('release is scoped to the lease holder', () => {
    it("leaves another udid's lease on the same port alone", async () => {
      const port = await allocator.acquire('mjpeg', 'android-s9');

      await allocator.release(port, 'iphone-17');

      expect(
        (await leaseOf(port))?.leasedToUdid,
        'a stale owner must not free a live lease',
      ).to.equal('android-s9');
    });

    it('deletes the lease when the holder releases it', async () => {
      const port = await allocator.acquire('mjpeg', 'android-s9');

      await allocator.release(port, 'android-s9');

      expect(await leaseOf(port)).to.equal(null);
    });
  });

  describe('claim: leasing a port the udid is already serving on', () => {
    it('leases a port with a live listener, which acquire would refuse', async () => {
      await occupy(scratch.base + 50, SHAPES[3]);

      expect(await allocator.claim('wda', 'iphone-17', scratch.base + 50)).to.equal(true);

      const row = await leaseOf(scratch.base + 50);
      expect(row?.leasedToUdid).to.equal('iphone-17');
      expect(row?.purpose).to.equal('wda');
    });

    it("refuses, and keeps the row, when another udid holds the port's lease", async () => {
      const held = await allocator.acquire('wda', 'iphone-other');

      expect(await allocator.claim('wda', 'iphone-17', held)).to.equal(false);

      expect((await leaseOf(held))?.leasedToUdid).to.equal('iphone-other');
    });
  });
});
