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
      // Serialize defensively: a circular/unserializable payload must degrade
      // to a placeholder, never throw. The throw would be uncaught here (it
      // happens while building the .create() args, before the promise/.catch
      // exists), and the global uncaughtException handler in src/index.ts would
      // process.exit(1) — a single bad dashboard-event payload cannot be allowed
      // to crash the whole plugin process.
      let payloadStr: string;
      try {
        payloadStr = JSON.stringify(entry.payload ?? null);
      } catch {
        payloadStr = JSON.stringify({ _unserializable: true, type: entry.type });
      }
      this.prismaService.client.eventLog
        .create({
          data: {
            type: entry.type,
            payload: payloadStr,
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
