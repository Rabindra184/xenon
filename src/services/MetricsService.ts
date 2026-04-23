import { Service } from 'typedi';
import { SESSION_MANAGER } from '../sessions/SessionManager';
import { DeviceStoreFactory } from '../data-service/device-store';
import { prisma } from '../prisma';
import log from '../logger';
import { HEALING_METRICS } from './healing/HealingMetrics';
import { CIRCUIT_BREAKERS } from './CircuitBreaker';

// Label values must escape backslash, double-quote, and newline per the
// Prometheus exposition format. Breaker keys contain colons which are fine.
function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

const BREAKER_STATE_CODE: Record<string, number> = {
  closed: 0,
  half_open: 1,
  open: 2,
};

@Service()
export class MetricsService {
  private readonly CONFIG_ID = 'metrics';

  private async incrementMetric(name: string) {
    try {
      const config = await prisma.webConfig.findUnique({
        where: { name },
      });
      const currentValue = config ? parseInt(config.value) : 0;
      await prisma.webConfig.upsert({
        where: { name },
        update: { value: (currentValue + 1).toString() },
        create: { id: name, name, value: '1' },
      });
    } catch (error: any) {
      const msg = error?.message ?? String(error);
      log.error(`[MetricsService] Failed to increment ${name}: ${msg}`, error);
    }
  }

  private async getMetric(name: string): Promise<number> {
    try {
      const config = await prisma.webConfig.findUnique({
        where: { name },
      });
      return config ? parseInt(config.value) : 0;
    } catch (error) {
      return 0;
    }
  }

  public async incrementSessionStart() {
    await this.incrementMetric('metric_session_starts');
  }

  public async incrementSessionSuccess() {
    await this.incrementMetric('metric_session_successes');
  }

  public async incrementSessionFailure() {
    await this.incrementMetric('metric_session_failures');
  }

  public async incrementHealingAttempt() {
    await this.incrementMetric('metric_healing_attempts');
  }

  public async incrementHealingSuccess() {
    await this.incrementMetric('metric_healing_successes');
  }

  public async getMetrics(): Promise<string> {
    const sessions = SESSION_MANAGER.getStats();
    const devices = await DeviceStoreFactory.getStore().getAllDevices();
    const totalDevices = devices.length;
    const busyDevices = devices.filter((d) => d.busy).length;
    const offlineDevices = devices.filter((d) => d.offline).length;

    // Fetch persisted counters
    const [sessionStarts, sessionSuccesses, sessionFailures, healingAttempts, healingSuccesses] =
      await Promise.all([
        this.getMetric('metric_session_starts'),
        this.getMetric('metric_session_successes'),
        this.getMetric('metric_session_failures'),
        this.getMetric('metric_healing_attempts'),
        this.getMetric('metric_healing_successes'),
      ]);

    const lines = [
      '# HELP xenon_sessions_total Total number of sessions across all time',
      '# TYPE xenon_sessions_total counter',
      `xenon_sessions_total{status="started"} ${sessionStarts}`,
      `xenon_sessions_total{status="success"} ${sessionSuccesses}`,
      `xenon_sessions_total{status="failure"} ${sessionFailures}`,

      '# HELP xenon_sessions_active Current active sessions in the hub',
      '# TYPE xenon_sessions_active gauge',
      `xenon_sessions_active ${sessions.total}`,

      '# HELP xenon_devices_total Total managed devices in the fleet',
      '# TYPE xenon_devices_total gauge',
      `xenon_devices_total ${totalDevices}`,

      '# HELP xenon_devices_busy Current devices in active use',
      '# TYPE xenon_devices_busy gauge',
      `xenon_devices_busy ${busyDevices}`,

      '# HELP xenon_devices_offline Devices currently not reachable',
      '# TYPE xenon_devices_offline gauge',
      `xenon_devices_offline ${offlineDevices}`,

      '# HELP xenon_healing_total AI self-healing operations',
      '# TYPE xenon_healing_total counter',
      `xenon_healing_total{status="attempt"} ${healingAttempts}`,
      `xenon_healing_total{status="success"} ${healingSuccesses}`,
    ];

    // Per-tier healing metrics (in-process; resets on restart — fine for Prom
    // scrape semantics). Tells us which tier is actually earning its compute.
    const tiers = HEALING_METRICS.snapshot();
    if (tiers.length > 0) {
      lines.push(
        '# HELP xenon_heal_tier_attempts_total Healing attempts per tier',
        '# TYPE xenon_heal_tier_attempts_total counter',
      );
      for (const t of tiers) {
        const labels = `tier="${t.tier}",name="${escapeLabel(t.name)}"`;
        lines.push(`xenon_heal_tier_attempts_total{${labels}} ${t.attempts}`);
      }
      lines.push(
        '# HELP xenon_heal_tier_successes_total Healing successes per tier',
        '# TYPE xenon_heal_tier_successes_total counter',
      );
      for (const t of tiers) {
        const labels = `tier="${t.tier}",name="${escapeLabel(t.name)}"`;
        lines.push(`xenon_heal_tier_successes_total{${labels}} ${t.successes}`);
      }
      lines.push(
        '# HELP xenon_heal_tier_failures_total Healing failures per tier',
        '# TYPE xenon_heal_tier_failures_total counter',
      );
      for (const t of tiers) {
        const labels = `tier="${t.tier}",name="${escapeLabel(t.name)}"`;
        lines.push(`xenon_heal_tier_failures_total{${labels}} ${t.failures}`);
      }
      lines.push(
        '# HELP xenon_heal_tier_duration_seconds_sum Cumulative time spent in each tier',
        '# TYPE xenon_heal_tier_duration_seconds_sum counter',
      );
      for (const t of tiers) {
        const labels = `tier="${t.tier}",name="${escapeLabel(t.name)}"`;
        const seconds = (t.durationMsSum / 1000).toFixed(3);
        lines.push(`xenon_heal_tier_duration_seconds_sum{${labels}} ${seconds}`);
      }
    }
    lines.push(
      '# HELP xenon_heal_all_tiers_failed_total Healing calls where no tier matched',
      '# TYPE xenon_heal_all_tiers_failed_total counter',
      `xenon_heal_all_tiers_failed_total ${HEALING_METRICS.getAllTiersFailedCount()}`,
    );

    // Circuit breaker state — makes it obvious from a dashboard alert when
    // an AI provider or any future wrapped dependency is shedding traffic.
    // State encoded as int so Grafana can threshold on it easily:
    //   0=closed (healthy), 1=half_open (probing), 2=open (shedding).
    const breakers = CIRCUIT_BREAKERS.snapshot();
    if (breakers.length > 0) {
      lines.push(
        '# HELP xenon_circuit_breaker_state 0=closed, 1=half_open, 2=open',
        '# TYPE xenon_circuit_breaker_state gauge',
      );
      for (const b of breakers) {
        lines.push(
          `xenon_circuit_breaker_state{key="${escapeLabel(b.key)}"} ${BREAKER_STATE_CODE[b.state] ?? 0}`,
        );
      }
      lines.push(
        '# HELP xenon_circuit_breaker_consecutive_failures Current failure streak',
        '# TYPE xenon_circuit_breaker_consecutive_failures gauge',
      );
      for (const b of breakers) {
        lines.push(
          `xenon_circuit_breaker_consecutive_failures{key="${escapeLabel(b.key)}"} ${b.consecutiveFailures}`,
        );
      }
    }

    return lines.join('\n') + '\n';
  }
}
