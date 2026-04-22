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
  private ranges: Required<PortRanges>;

  constructor(overrides: PortRanges = {}) {
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

  async release(port: number): Promise<void> {
    await prisma.portLease.delete({ where: { port } }).catch(() => undefined);
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
