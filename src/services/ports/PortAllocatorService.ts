import getPort from 'get-port';
import { prisma } from '../../prisma';
import log from '../../logger';

export type PortPurpose = 'systemPort' | 'wdaLocalPort' | 'chromedriverPort' | 'mjpegServerPort';

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
    private readonly db: { portLease: { create: any; deleteMany: any } } = prisma as any,
    private readonly getPortImpl: () => Promise<number> = getPort,
  ) {}

  async allocate(req: AllocateRequest): Promise<Record<PortPurpose, number>> {
    const ports: Partial<Record<PortPurpose, number>> = {};
    const allocated: number[] = [];
    const expiresAt = Date.now() + req.durationMs + 5 * 60 * 1000; // 5-min grace
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
}
