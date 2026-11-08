import { prisma } from '../../prisma';
import log from '../../logger';
import { isPortFree } from '../PortAllocator';

export type PortPurpose = 'systemPort' | 'wdaLocalPort' | 'chromedriverPort' | 'mjpegServerPort';

/** How long a port stays reserved past the end of the lease it is for. */
export const PORT_GRACE_MS = 5 * 60 * 1000;
/** No port is held further ahead than a lease can last (24 hours). */
const MAX_PORT_HOLD_MS = 24 * 60 * 60 * 1000;

export interface ExtendRequest {
  udid: string;
  ports: number[];
  /** The lease's new end, epoch milliseconds. */
  expiresAt: number;
}

export interface ReleaseRequest {
  udid: string;
  ports: number[];
}

/**
 * Where a lease's driver ports come from: Xenon's own range, beside its
 * others (wda 8100, mjpeg 9100, system 10100, proxy 11100, tunnel 12100),
 * below every OS's ephemeral ports (macOS and Windows 49152-65535, Linux
 * 32768-60999). Through 2.20 they were get-port's OS-assigned ports, the
 * range every other program draws on too: between a lease's reservation and
 * its session, Android Studio took one.
 */
export const LEASE_PORT_RANGE: [number, number] = [13100, 13999];

/** The next port to reserve, other than those in `avoid`. */
export type PortPicker = (avoid: Set<number>) => Promise<number>;

interface PortLeaseTable {
  portLease: { create: any; deleteMany: any; updateMany: any; findMany?: any };
}

/**
 * The first port of `range` that no reservation holds and nothing on this
 * machine listens on. Reservations in the range that have expired are
 * cleared first. The caller writes the row; a row another reservation wrote
 * meanwhile fails there, and the caller asks again with that port avoided.
 */
export function leasePortPicker(
  db: PortLeaseTable,
  isFree: (port: number) => Promise<boolean> = (port) => isPortFree(port),
  range: [number, number] = LEASE_PORT_RANGE,
): PortPicker {
  const [start, end] = range;
  return async (avoid) => {
    await db.portLease.deleteMany({
      where: { port: { gte: start, lte: end }, expiresAt: { lt: Date.now() } },
    });
    const held: Array<{ port: number }> = await db.portLease.findMany({
      where: { port: { gte: start, lte: end } },
      select: { port: true },
    });
    const taken = new Set(held.map((row) => row.port));
    for (let port = start; port <= end; port++) {
      if (taken.has(port) || avoid.has(port)) continue;
      if (await isFree(port)) return port;
    }
    throw new Error(`No lease port is free in ${start}-${end}`);
  };
}

export interface AllocateRequest {
  udid: string;
  host: string;
  purposes: PortPurpose[];
  durationMs: number;
  leaseId?: string;
}

export class PortAllocatorService {
  private logger = log.scope('PortAllocatorService');

  private readonly pickPort: PortPicker;

  constructor(
    private readonly db: PortLeaseTable = prisma as any,
    pickPort?: PortPicker,
  ) {
    this.pickPort = pickPort ?? leasePortPicker(db);
  }

  async allocate(req: AllocateRequest): Promise<Record<PortPurpose, number>> {
    const ports: Partial<Record<PortPurpose, number>> = {};
    const allocated: number[] = [];
    const expiresAt = Date.now() + req.durationMs + PORT_GRACE_MS;
    try {
      for (const purpose of req.purposes) {
        const port = await this.reserve(purpose, req, expiresAt, new Set(allocated));
        ports[purpose] = port;
        allocated.push(port);
      }
      return ports as Record<PortPurpose, number>;
    } catch (err) {
      this.logger.warn(`allocate failed; rolling back ${allocated.length} port(s): ${(err as Error).message}`);
      if (allocated.length > 0) {
        await this.db.portLease.deleteMany({ where: { port: { in: allocated } } });
      }
      throw err;
    }
  }

  /** One port for `purpose`, written as reserved; a port taken meanwhile is skipped. */
  private async reserve(
    purpose: PortPurpose,
    req: AllocateRequest,
    expiresAt: number,
    avoid: Set<number>,
  ): Promise<number> {
    for (;;) {
      const port = await this.pickPort(avoid);
      try {
        await this.db.portLease.create({
          data: {
            port,
            purpose,
            leasedToUdid: req.udid,
            leasedToHost: req.host,
            leaseId: req.leaseId ?? null,
            leasedAt: Date.now(),
            expiresAt,
          },
        });
        return port;
      } catch (err: any) {
        if (err?.code !== 'P2002') throw err;
        avoid.add(port);
      }
    }
  }

  /**
   * Holds a lease's ports until its new end, plus the grace allocate gives.
   * Only rows still leased to that phone, and never earlier than a row
   * already says, so a late or repeated call can't shorten anything.
   */
  async extend(req: ExtendRequest): Promise<{ extended: number }> {
    const until = Math.min(req.expiresAt, Date.now() + MAX_PORT_HOLD_MS) + PORT_GRACE_MS;
    const result = await this.db.portLease.updateMany({
      where: { port: { in: req.ports }, leasedToUdid: req.udid, expiresAt: { lt: until } },
      data: { expiresAt: until },
    });
    return { extended: result?.count ?? 0 };
  }

  /**
   * Frees a lease's ports when the lease ends: the rows still leased to that
   * phone. Ports another phone has since been given are left alone.
   */
  async release(req: ReleaseRequest): Promise<{ released: number }> {
    const result = await this.db.portLease.deleteMany({
      where: { port: { in: req.ports }, leasedToUdid: req.udid },
    });
    return { released: result?.count ?? 0 };
  }
}
