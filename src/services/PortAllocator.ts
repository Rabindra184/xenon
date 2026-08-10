import { Service } from 'typedi';
import net from 'net';
import { prisma } from '../prisma';
import log from '../logger';

export type PortPurpose = 'wda' | 'mjpeg' | 'system' | 'proxy';

export interface PortRanges {
  wda?: [number, number];
  mjpeg?: [number, number];
  system?: [number, number];
  proxy?: [number, number];
}

const DEFAULT_RANGES: Required<PortRanges> = {
  wda: [8100, 8199],
  mjpeg: [9100, 9199],
  system: [10100, 10199],
  proxy: [11100, 11199],
};

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

  async release(port: number): Promise<void> {
    await prisma.portLease.delete({ where: { port } }).catch(() => undefined);
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

  protected isOsFree(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();
      let settled = false;
      const done = (ok: boolean) => {
        if (settled) return;
        settled = true;
        server.removeAllListeners();
        if (ok) server.close(() => resolve(true));
        else resolve(false);
      };
      server.once('error', () => done(false));
      server.once('listening', () => done(true));
      server.listen(port, '127.0.0.1');
    });
  }
}
