import getPort from 'get-port';
import { prisma } from '../../prisma';
import log from '../../logger';

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

export interface AllocateRequest {
  udid: string;
  host: string;
  purposes: PortPurpose[];
  durationMs: number;
  leaseId?: string;
}

export class PortAllocatorService {
  private logger = log.scope('PortAllocatorService');

  constructor(
    private readonly db: {
      portLease: { create: any; deleteMany: any; updateMany: any };
    } = prisma as any,
    private readonly getPortImpl: () => Promise<number> = getPort,
  ) {}

  async allocate(req: AllocateRequest): Promise<Record<PortPurpose, number>> {
    const ports: Partial<Record<PortPurpose, number>> = {};
    const allocated: number[] = [];
    const expiresAt = Date.now() + req.durationMs + PORT_GRACE_MS;
    try {
      for (const purpose of req.purposes) {
        const port = await this.getPortImpl();
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
