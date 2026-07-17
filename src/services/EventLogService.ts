import { Service } from 'typedi';
import { PrismaService } from '../data-service/prisma-service';
import log from '../logger';

export interface EventLogEntry {
  type: string;
  payload: unknown;
  correlationId?: string;
  teamId?: string;
}

/**
 * Transactional-outbox seed (ARB foreclosure guard #1). Append-only log of
 * every dashboard-visible domain event. Fire-and-forget by design: the
 * broadcast hot path must gain zero latency and never fail because of the log.
 */
@Service()
export class EventLogService {
  constructor(private prismaService: PrismaService) {}

  appendSafe(entry: EventLogEntry): void {
    if (process.env.XENON_EVENT_LOG === 'off') return;
    setImmediate(() => {
      this.prismaService.client.eventLog
        .create({
          data: {
            type: entry.type,
            payload: JSON.stringify(entry.payload ?? null),
            correlationId: entry.correlationId ?? null,
            teamId: entry.teamId ?? null,
          },
        })
        .catch((err: any) => log.debug(`EventLog append failed (non-fatal): ${err?.message}`));
    });
  }

  async prune(retentionDays: number): Promise<number> {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const res = await this.prismaService.client.eventLog.deleteMany({
      where: { occurredAt: { lt: cutoff } },
    });
    return res.count;
  }
}
