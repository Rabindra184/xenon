// In-process counters for healing tier outcomes. Deliberately in-memory:
// existing DB-backed counters (MetricsService.incrementHealing*) cover
// session-lifetime totals, but tier-level data ticks on every findElement
// failure — writing that through SQLite would thrash the DB. Prom scrapes
// pull the current values; restarts reset counters, which matches Prom's
// standard reset-semantics anyway.
//
// In addition to the in-memory snapshot consumed by /metrics, every
// record*() call fans out to the OpenTelemetry MeterProvider registered by
// TracingService. Until that provider exists (boot order: HealingMetrics is
// a module-load singleton, TracingService.initialize() runs at server start)
// the OTel API returns Noop instruments and the calls are free.

import { metrics, Counter, Histogram } from '@opentelemetry/api';
import { METRIC, OUTCOME } from '../telemetry/attributes';

export type HealingOutcome = 'success' | 'failure';

interface TierBucket {
  attempts: number;
  successes: number;
  failures: number;
  durationMsSum: number;
}

export interface TierMetricSnapshot {
  tier: number;
  name: string;
  attempts: number;
  successes: number;
  failures: number;
  durationMsSum: number;
}

interface SkipBucket {
  tier: number;
  name: string;
  count: number;
}

class HealingMetricsRegistry {
  // Key: `${tier}:${name}` so the same tier number with a renamed provider
  // lands in a separate bucket instead of silently merging.
  private readonly buckets = new Map<string, TierBucket>();
  private readonly skipBuckets = new Map<string, SkipBucket>();
  private allTiersFailedCount = 0;

  // OTel instruments are lazy-loaded on first record*() call so module load
  // ordering vs. TracingService.initialize() doesn't matter.
  private otelLoaded = false;
  private attemptsCounter?: Counter;
  private successesCounter?: Counter;
  private failuresCounter?: Counter;
  private allTiersFailedCounter?: Counter;
  private tierSkippedCounter?: Counter;
  private durationHistogram?: Histogram;

  private ensureOtelInstruments() {
    if (this.otelLoaded) return;
    const meter = metrics.getMeter('xenon.healing');
    this.attemptsCounter = meter.createCounter(METRIC.HEALING_ATTEMPTS, {
      description: 'Number of healing tier attempts, labeled by tier name.',
    });
    this.successesCounter = meter.createCounter(METRIC.HEALING_SUCCESSES, {
      description: 'Number of healing tier successes, labeled by tier name.',
    });
    this.failuresCounter = meter.createCounter(METRIC.HEALING_FAILURES, {
      description: 'Number of healing tier failures, labeled by tier name.',
    });
    this.allTiersFailedCounter = meter.createCounter(METRIC.HEALING_ALL_TIERS_FAILED, {
      description: 'Number of healing attempts where every tier failed.',
    });
    this.tierSkippedCounter = meter.createCounter(METRIC.HEALING_TIER_SKIPPED, {
      description:
        'Number of times a tier short-circuited the remaining tiers via shouldSkipRemaining.',
    });
    this.durationHistogram = meter.createHistogram(METRIC.HEALING_DURATION_MS, {
      description: 'Per-tier healing latency in milliseconds, labeled by tier and outcome.',
      unit: 'ms',
    });
    this.otelLoaded = true;
  }

  public record(tier: number, name: string, outcome: HealingOutcome, durationMs: number): void {
    const key = `${tier}:${name}`;
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { attempts: 0, successes: 0, failures: 0, durationMsSum: 0 };
      this.buckets.set(key, bucket);
    }
    bucket.attempts++;
    bucket.durationMsSum += durationMs;
    if (outcome === 'success') bucket.successes++;
    else bucket.failures++;

    this.ensureOtelInstruments();
    const labels = { tier: name };
    this.attemptsCounter!.add(1, labels);
    if (outcome === OUTCOME.SUCCESS) {
      this.successesCounter!.add(1, labels);
    } else {
      this.failuresCounter!.add(1, labels);
    }
    this.durationHistogram!.record(durationMs, { tier: name, outcome });
  }

  public recordAllTiersFailed(): void {
    this.allTiersFailedCount++;
    this.ensureOtelInstruments();
    this.allTiersFailedCounter!.add(1);
  }

  public recordSkippedRemaining(tier: number, name: string): void {
    const key = `${tier}:${name}`;
    let bucket = this.skipBuckets.get(key);
    if (!bucket) {
      bucket = { tier, name, count: 0 };
      this.skipBuckets.set(key, bucket);
    }
    bucket.count++;
    this.ensureOtelInstruments();
    this.tierSkippedCounter!.add(1, { tier: name });
  }

  public skipSnapshot(): SkipBucket[] {
    return Array.from(this.skipBuckets.values()).sort(
      (a, b) => a.tier - b.tier || a.name.localeCompare(b.name),
    );
  }

  public snapshot(): TierMetricSnapshot[] {
    const out: TierMetricSnapshot[] = [];
    for (const [key, bucket] of this.buckets) {
      const sep = key.indexOf(':');
      const tier = Number(key.slice(0, sep));
      const name = key.slice(sep + 1);
      out.push({ tier, name, ...bucket });
    }
    // Stable order by tier then name — makes the /metrics output deterministic
    // so alert rules and grafana variables don't see label reshuffling.
    return out.sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));
  }

  public getAllTiersFailedCount(): number {
    return this.allTiersFailedCount;
  }
}

export const HEALING_METRICS = new HealingMetricsRegistry();
