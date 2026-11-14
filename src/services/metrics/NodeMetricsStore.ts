import { Service } from 'typedi';
import { KEEP_AFTER_END_MS, NodeMetricsAnswer, NodeMetricsState } from './nodeMetrics';
import { MAX_BUFFERED_SAMPLES, MetricSample } from './types';

interface Entry {
  platform: string;
  state: Exclude<NodeMetricsState, 'off'>;
  samples: MetricSample[];
  /** A hub has asked about the session. */
  claimed: boolean;
  endedAt: number | null;
}

/**
 * On a node: each sampled session's CPU and memory, held in memory until the
 * hub collects them. A node has no Session row for a session its hub created,
 * so it can't write them to SessionMetric. The newest MAX_BUFFERED_SAMPLES per
 * session; what the hub has collected is dropped; an ended session is kept
 * KEEP_AFTER_END_MS, then forgotten, whether or not a hub asked. A session
 * no hub asks about is dropped sooner (SessionMetricsService, UNCLAIMED_MS).
 */
@Service()
export class NodeMetricsStore {
  now: () => number = () => Date.now();
  private readonly entries = new Map<string, Entry>();

  begin(sessionId: string, platform: string): void {
    this.prune();
    this.entries.set(sessionId, {
      platform: platform.toLowerCase(),
      state: 'sampling',
      samples: [],
      claimed: false,
      endedAt: null,
    });
  }

  add(sessionId: string, sample: MetricSample): void {
    const entry = this.entries.get(sessionId);
    if (!entry) return;
    entry.samples.push(sample);
    const over = entry.samples.length - MAX_BUFFERED_SAMPLES;
    if (over > 0) entry.samples.splice(0, over);
  }

  gaveUp(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (entry && entry.state === 'sampling') entry.state = 'stopped';
  }

  end(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (!entry) return;
    entry.state = 'ended';
    entry.endedAt = this.now();
  }

  /** Drops the session at once: it isn't sampled any more. */
  forget(sessionId: string): void {
    this.entries.delete(sessionId);
  }

  /** Whether a hub has asked about the session. */
  claimed(sessionId: string): boolean {
    return this.entries.get(sessionId)?.claimed === true;
  }

  /** The samples newer than `after` (all, without it). Those at or before it the hub has, so they go. */
  read(sessionId: string, after: number | null): NodeMetricsAnswer {
    this.prune();
    const entry = this.entries.get(sessionId);
    if (!entry) return { platform: '', state: 'off', samples: [] };
    entry.claimed = true;
    if (after !== null) entry.samples = entry.samples.filter((s) => s.at > after);
    return { platform: entry.platform, state: entry.state, samples: entry.samples.slice() };
  }

  private prune(): void {
    const cutoff = this.now() - KEEP_AFTER_END_MS;
    for (const [id, entry] of this.entries) {
      if (entry.endedAt !== null && entry.endedAt <= cutoff) this.entries.delete(id);
    }
  }
}
