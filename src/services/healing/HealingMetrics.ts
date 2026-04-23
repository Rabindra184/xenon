// In-process counters for healing tier outcomes. Deliberately in-memory:
// existing DB-backed counters (MetricsService.incrementHealing*) cover
// session-lifetime totals, but tier-level data ticks on every findElement
// failure — writing that through SQLite would thrash the DB. Prom scrapes
// pull the current values; restarts reset counters, which matches Prom's
// standard reset-semantics anyway.

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

class HealingMetricsRegistry {
  // Key: `${tier}:${name}` so the same tier number with a renamed provider
  // lands in a separate bucket instead of silently merging.
  private readonly buckets = new Map<string, TierBucket>();
  private allTiersFailedCount = 0;

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
  }

  public recordAllTiersFailed(): void {
    this.allTiersFailedCount++;
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
