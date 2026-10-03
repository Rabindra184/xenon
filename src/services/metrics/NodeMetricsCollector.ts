import { NodeMetricsSource, NodeMetricsSupport } from './nodeMetrics';
import { MetricsSampler, RecordingState, SamplerHooks } from './types';

/** How often the hub asks a node for a session's new figures. */
export const COLLECT_INTERVAL_MS = 10_000;

export interface NodeCollectorOptions {
  source: NodeMetricsSource;
  hooks: SamplerHooks;
  support: Pick<NodeMetricsSupport, 'shouldAsk' | 'unsupported'>;
  logger: { info(message: string): void; warn(message: string): void };
  /** Ask only for figures newer than this: the newest the hub stored before a restart. */
  after?: number | null;
  intervalMs?: number;
}

/**
 * On a hub: a session on a node's phone, sampled by asking the node
 * (GET /node/sessions/:id/metrics) every COLLECT_INTERVAL_MS instead of
 * reading the phone. Its samples go through the same hooks as a phone
 * sampler's, so SessionMetricsService buffers and writes them as its own.
 * Asks never overlap. An unreachable node is asked again; whether the
 * session is alive is the heartbeat's call. When the session ends it asks
 * once more, for the last seconds.
 */
export class NodeMetricsCollector implements MetricsSampler {
  private after: number | null;
  private current: RecordingState = 'sampling';
  private done = false;
  private timer?: ReturnType<typeof setInterval>;
  private asking: Promise<void> | null = null;
  private outage = false;

  constructor(private readonly o: NodeCollectorOptions) {
    this.after = o.after ?? null;
  }

  state(): RecordingState {
    return this.current;
  }

  start(): void {
    const origin = this.o.source.nodeOrigin();
    if (!origin || !this.o.support.shouldAsk(origin)) {
      this.finish('off');
      return;
    }
    this.timer = setInterval(() => void this.tick(), this.o.intervalMs ?? COLLECT_INTERVAL_MS);
    this.timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    if (this.asking) await this.asking;
    if (!this.done) await this.ask();
    this.done = true;
  }

  private tick(): Promise<void> | undefined {
    if (this.done || this.asking) return undefined;
    this.asking = this.ask().finally(() => {
      this.asking = null;
    });
    return this.asking;
  }

  private async ask(): Promise<void> {
    const reply = await this.o.source.nodeMetrics(this.after);
    switch (reply.kind) {
      case 'answer': {
        if (this.outage) {
          this.outage = false;
          this.o.logger.info(`${this.o.source.nodeOrigin()} answers again`);
        }
        for (const s of reply.answer.samples) {
          if (this.after !== null && s.at <= this.after) continue;
          this.o.hooks.onSample(s);
          this.after = s.at;
        }
        const state = reply.answer.state;
        if (state === 'sampling') this.current = 'sampling';
        else this.finish(state === 'off' ? 'off' : 'stopped');
        return;
      }
      case 'unsupported':
        this.o.support.unsupported(this.o.source.nodeOrigin() ?? '', reply.status);
        this.finish('off');
        return;
      case 'refused':
        this.finish('off');
        return;
      case 'unavailable':
        if (!this.outage) {
          this.outage = true;
          this.o.logger.warn(
            `Can't collect CPU and memory from ${this.o.source.nodeOrigin()}: ${reply.reason}. Asking again.`,
          );
        }
        return;
    }
  }

  private finish(state: RecordingState): void {
    this.current = state;
    this.done = true;
    if (this.timer) clearInterval(this.timer);
  }
}
