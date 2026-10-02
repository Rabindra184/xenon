import { Service } from 'typedi';
import net from 'net';
import { prisma } from '../prisma';
import log from '../logger';

export type PortPurpose = 'wda' | 'mjpeg' | 'system' | 'proxy' | 'tunnel';

export interface PortRanges {
  wda?: [number, number];
  mjpeg?: [number, number];
  system?: [number, number];
  proxy?: [number, number];
  /** go-ios tunnels, leased in pairs (acquirePair). */
  tunnel?: [number, number];
}

const DEFAULT_RANGES: Required<PortRanges> = {
  wda: [8100, 8199],
  mjpeg: [9100, 9199],
  system: [10100, 10199],
  proxy: [11100, 11199],
  tunnel: [12100, 12199],
};

/** Loopback and wildcard, in both families. See isOsFree. */
const PROBE_HOSTS = ['127.0.0.1', '::1', '0.0.0.0', '::'];

/**
 * Bind errors meaning the host can't use that address at all (IPv6 disabled),
 * not that something holds the port. Any other error still counts as in use.
 */
const ADDRESS_UNAVAILABLE = new Set(['EADDRNOTAVAIL', 'EAFNOSUPPORT']);

export class PortRangeExhaustedError extends Error {
  constructor(purpose: PortPurpose) {
    super(`Port range for purpose '${purpose}' is exhausted`);
    this.name = 'PortRangeExhaustedError';
  }
}

@Service()
export class PortAllocator {
  private log = log.scope('PortAllocator');
  private ranges: Required<PortRanges> = { ...DEFAULT_RANGES };

  constructor() {}

  configure(overrides: PortRanges): void {
    this.ranges = { ...DEFAULT_RANGES, ...overrides };
  }

  async acquire(
    purpose: PortPurpose,
    udid: string,
    opts: { pid?: number; ttlMs?: number } = {},
  ): Promise<number> {
    const [start, end] = this.ranges[purpose];
    const ttlMs = opts.ttlMs ?? 60 * 60 * 1000;
    const now = Date.now();

    await prisma.portLease.deleteMany({ where: { expiresAt: { lt: now } } });

    const existing = await prisma.portLease.findFirst({
      where: { purpose, leasedToUdid: udid, port: { gte: start, lte: end } },
      select: { port: true },
    });
    if (existing) {
      // Stale reuse is a footgun: Android may still hold an mjpeg lease on 9100
      // while iOS iproxy is the real listener. Returning that lease without an
      // OS probe makes the Android tile proxy the iPhone feed.
      const osOk = await this.isOsFree(existing.port);
      if (osOk) {
        await prisma.portLease
          .update({
            where: { port: existing.port },
            data: { leasedAt: now, expiresAt: now + ttlMs, leasedToPid: opts.pid },
          })
          .catch(() => undefined);
        return existing.port;
      }
      this.log.warn(
        `Dropping stale ${purpose} lease on ${existing.port} for ${udid} — port is in use by another process`,
      );
      await prisma.portLease.delete({ where: { port: existing.port } }).catch(() => undefined);
    }

    const active = await prisma.portLease.findMany({
      where: { purpose, port: { gte: start, lte: end } },
      select: { port: true },
    });
    const taken = new Set(active.map((l: { port: number }) => l.port));

    for (let port = start; port <= end; port++) {
      if (taken.has(port)) continue;
      try {
        await prisma.portLease.create({
          data: {
            port,
            purpose,
            leasedToUdid: udid,
            leasedToPid: opts.pid,
            leasedAt: now,
            expiresAt: now + ttlMs,
          },
        });
      } catch (err: any) {
        if (err.code === 'P2002') continue;
        throw err;
      }

      const osOk = await this.isOsFree(port);
      if (!osOk) {
        await prisma.portLease.delete({ where: { port } }).catch(() => undefined);
        continue;
      }

      this.log.debug(`Leased port ${port} (${purpose}) to ${udid}`);
      return port;
    }

    throw new PortRangeExhaustedError(purpose);
  }

  /**
   * `acquire`, but exhaustion is `undefined` rather than a throw.
   *
   * For callers where a port is nice-to-have rather than required — device
   * discovery being the one that matters. A device that cannot get a port yet
   * is still a device, and must still be listed: when an exhausted range threw
   * out of the discovery pass, the whole platform's device list came back
   * empty and `removeStaleDevices` then deleted a physically-attached iPhone
   * for not being in it.
   *
   * Only exhaustion is swallowed. A database or probe failure is a different
   * kind of problem and still raises.
   */
  async tryAcquire(
    purpose: PortPurpose,
    udid: string,
    opts: { pid?: number; ttlMs?: number } = {},
  ): Promise<number | undefined> {
    try {
      return await this.acquire(purpose, udid, opts);
    } catch (err: any) {
      if (err instanceof PortRangeExhaustedError) {
        this.log.warn(
          `No ${purpose} port available for ${udid}; continuing without one. It will be acquired when the device actually needs it.`,
        );
        return undefined;
      }
      throw err;
    }
  }

  /**
   * Lease two adjacent ports, an even P and P + 1, and return P. A go-ios
   * tunnel needs both: P for its tunnel-info API, and P + 1, which go-ios
   * itself picks for the phone's traffic.
   *
   * Both must be free in the lease table, whatever purpose holds them, and at
   * the OS. A half-taken pair is given back before the next one is tried.
   */
  async acquirePair(
    purpose: PortPurpose,
    udid: string,
    opts: { pid?: number; ttlMs?: number } = {},
  ): Promise<number> {
    const [start, end] = this.ranges[purpose];
    const ttlMs = opts.ttlMs ?? 60 * 60 * 1000;
    const now = Date.now();

    await prisma.portLease.deleteMany({ where: { expiresAt: { lt: now } } });

    const active = await prisma.portLease.findMany({
      where: { port: { gte: start, lte: end } },
      select: { port: true },
    });
    const taken = new Set(active.map((l: { port: number }) => l.port));
    const lease = {
      purpose,
      leasedToUdid: udid,
      leasedToPid: opts.pid,
      leasedAt: now,
      expiresAt: now + ttlMs,
    };

    for (let port = start + (start % 2); port + 1 <= end; port += 2) {
      if (taken.has(port) || taken.has(port + 1)) continue;
      const leased: number[] = [];
      try {
        for (const p of [port, port + 1]) {
          await prisma.portLease.create({ data: { port: p, ...lease } });
          leased.push(p);
        }
      } catch (err: any) {
        await this.releaseAll(leased, udid);
        if (err.code === 'P2002') continue;
        throw err;
      }

      if ((await this.isOsFree(port)) && (await this.isOsFree(port + 1))) {
        this.log.debug(`Leased ports ${port}-${port + 1} (${purpose}) to ${udid}`);
        return port;
      }
      await this.releaseAll(leased, udid);
    }

    throw new PortRangeExhaustedError(purpose);
  }

  /** Delete every lease of `purpose`. At boot, when nothing of this server holds one. */
  async releasePurpose(purpose: PortPurpose): Promise<void> {
    await prisma.portLease.deleteMany({ where: { purpose } });
  }

  private async releaseAll(ports: number[], udid: string): Promise<void> {
    for (const port of ports) await this.release(port, udid);
  }

  /**
   * Soft-block a port so the next `acquire` for the same purpose skips it.
   * Used when bind fails (EADDRINUSE) even though our lease owned the number —
   * typically another process (e.g. iOS iproxy) is the real listener.
   */
  async blockPort(port: number, purpose: PortPurpose, ttlMs = 60_000): Promise<void> {
    const now = Date.now();
    await prisma.portLease
      .upsert({
        where: { port },
        create: {
          port,
          purpose,
          leasedToUdid: `__blocked__:${port}`,
          leasedAt: now,
          expiresAt: now + ttlMs,
        },
        update: {
          purpose,
          leasedToUdid: `__blocked__:${port}`,
          leasedAt: now,
          expiresAt: now + ttlMs,
        },
      })
      .catch(() => undefined);
  }

  /**
   * Lease a port `udid` is already serving on. acquire() would refuse it,
   * because its OS probe sees the listener, and that listener is the device's
   * own: iOS attaching to the WDA an Appium session forwards is the case. The
   * lease is what keeps the port from being handed to another device once the
   * listener closes.
   *
   * Returns false, and leaves the row alone, when another udid holds an
   * unexpired lease on the port.
   */
  async claim(
    purpose: PortPurpose,
    udid: string,
    port: number,
    opts: { ttlMs?: number } = {},
  ): Promise<boolean> {
    const now = Date.now();
    const ttlMs = opts.ttlMs ?? 60 * 60 * 1000;
    const held = await prisma.portLease.findUnique({ where: { port } });
    if (held && held.leasedToUdid !== udid && held.expiresAt >= now) return false;
    const lease = { purpose, leasedToUdid: udid, leasedAt: now, expiresAt: now + ttlMs };
    await prisma.portLease.upsert({
      where: { port },
      create: { port, ...lease },
      update: lease,
    });
    return true;
  }

  /**
   * Release `port` if `udid` holds it. A port number alone doesn't say whose
   * lease it is: a stale session releasing "its" port used to delete whatever
   * lease held that number by then, including another device's live one.
   */
  async release(port: number, udid: string): Promise<void> {
    await prisma.portLease
      .deleteMany({ where: { port, leasedToUdid: udid } })
      .catch(() => undefined);
  }

  /**
   * Extend the lease on a specific port without re-running allocation. Used to
   * keep a long-lived stream's port from expiring out from under it (which would
   * let the allocator hand the same port to another device). No-op if the port
   * isn't currently leased.
   */
  async touch(port: number, ttlMs = 60 * 60 * 1000): Promise<void> {
    const now = Date.now();
    await prisma.portLease
      .update({ where: { port }, data: { leasedAt: now, expiresAt: now + ttlMs } })
      .catch(() => undefined);
  }

  async releaseForUdid(udid: string): Promise<void> {
    await prisma.portLease.deleteMany({ where: { leasedToUdid: udid } });
  }

  async purgeExpired(): Promise<void> {
    await prisma.portLease.deleteMany({ where: { expiresAt: { lt: Date.now() } } });
  }

  /**
   * Whether nothing listens on `port` on any local address.
   *
   * One bind can't tell. On macOS a bind to 127.0.0.1 succeeds beside a
   * wildcard listener, and the more specific socket then takes every
   * 127.0.0.1 connection. iproxy listens on the IPv6 wildcard, so a
   * 127.0.0.1-only probe called an iPhone's 9100 free, the S9+'s MJPEG server
   * bound 127.0.0.1:9100 over it, and the iPhone's recording showed the S9+.
   *
   * Each listener shape fails at least one of these binds (checked on macOS
   * with Node's default SO_REUSEADDR): 127.0.0.1 → 127.0.0.1, ::1 → ::1,
   * 0.0.0.0 → 0.0.0.0, dual-stack :: → 0.0.0.0 and ::, v6-only :: → ::.
   */
  protected async isOsFree(port: number): Promise<boolean> {
    let probed = 0;
    // One at a time: probes in flight together can fail on each other (a
    // 0.0.0.0 bind fails beside a :: one).
    for (const host of PROBE_HOSTS) {
      const code = await this.bindProbe(port, host);
      if (code === null) probed++;
      else if (!ADDRESS_UNAVAILABLE.has(code)) return false;
    }
    return probed > 0;
  }

  /** Bind `host:port` and close it again. Resolves null on success, else the error code. */
  protected bindProbe(port: number, host: string): Promise<string | null> {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', (err: NodeJS.ErrnoException) => resolve(err.code ?? 'UNKNOWN'));
      server.once('listening', () => server.close(() => resolve(null)));
      server.listen(port, host);
    });
  }
}
