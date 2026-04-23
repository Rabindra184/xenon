import { Service } from 'typedi';
import log from '../logger';

// Hub-process health metrics. Individual sessions don't spawn child
// processes (Appium is one Node process, sessions are logical constructs
// inside it), so true per-session RSS doesn't make sense. What DOES matter
// is whether the hub process itself is getting starved:
//
//   - heap growing while session count is flat = memory leak
//   - event-loop lag climbing while CPU is unsaturated = blocking work
//     sneaking into the hot path (sync fs, bad JSON, etc)
//
// Memory is cheap to read on demand in getMetrics(). Event-loop lag needs
// a periodic sampler because by the time /metrics is scraped, the blocking
// moment is gone — we report the max lag observed since the last scrape.
@Service()
export class ProcessMetricsService {
  private readonly logger = log.scope('ProcessMetrics');
  private sampleIntervalMs = 1000;
  private maxLagSinceScrapeMs = 0;
  private lastLagMs = 0;
  private timer: NodeJS.Timeout | null = null;
  private commandsProcessed = 0;
  private commandDurationMsSum = 0;

  public start(intervalMs = 1000): void {
    if (this.timer) return;
    this.sampleIntervalMs = intervalMs;
    this.scheduleNextSample();
    this.logger.info(`Event-loop lag sampling every ${intervalMs}ms`);
  }

  public stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleNextSample(): void {
    const scheduledAt = Date.now();
    this.timer = setTimeout(() => {
      // Lag = actual delay beyond the scheduled interval. A healthy loop
      // wakes up within a few ms of the deadline; sustained double-digit
      // ms means something is blocking.
      const actualDelay = Date.now() - scheduledAt;
      const lag = Math.max(0, actualDelay - this.sampleIntervalMs);
      this.lastLagMs = lag;
      if (lag > this.maxLagSinceScrapeMs) this.maxLagSinceScrapeMs = lag;
      this.scheduleNextSample();
    }, this.sampleIntervalMs);
    // Don't keep the process alive just for this sampler.
    this.timer.unref?.();
  }

  public recordCommand(durationMs: number): void {
    this.commandsProcessed++;
    this.commandDurationMsSum += durationMs;
  }

  public snapshot() {
    const mem = process.memoryUsage();
    // Reading /metrics resets the max-since-scrape counter so Prometheus
    // rate() sees actual per-interval peaks rather than a monotonic climb.
    const maxLag = this.maxLagSinceScrapeMs;
    this.maxLagSinceScrapeMs = 0;
    return {
      memory: {
        rss: mem.rss,
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        external: mem.external,
        arrayBuffers: mem.arrayBuffers,
      },
      eventLoop: {
        lagMs: this.lastLagMs,
        maxLagSinceScrapeMs: maxLag,
      },
      commands: {
        processed: this.commandsProcessed,
        durationMsSum: this.commandDurationMsSum,
      },
    };
  }
}
