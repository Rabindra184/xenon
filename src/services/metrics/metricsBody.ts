import { RecordingState, SAMPLE_INTERVAL_MS } from './types';

export interface SessionMetricRow {
  at: number;
  device_cpu_pct: number | null;
  device_mem_mb: number | null;
  device_mem_total: number | null;
  app_cpu_pct: number | null;
  app_mem_mb: number | null;
  app_id: string | null;
}

export interface MetricSeries {
  deviceCpu: boolean;
  deviceMem: boolean;
  appCpu: boolean;
  appMem: boolean;
}

export interface SessionMetricsBody {
  platform: string;
  intervalMs: number;
  appId: string | null;
  series: MetricSeries;
  /** For a running session: whether it is being sampled. Null once it ended. */
  recording: RecordingState | null;
  samples: Array<{
    t: number;
    deviceCpu: number | null;
    deviceMemMb: number | null;
    deviceMemTotalMb: number | null;
    appCpu: number | null;
    appMemMb: number | null;
    /** The app this sample's app figures are for: the foreground app can change. */
    app: string | null;
  }>;
}

/** What a session on this platform can have: Android everything, an iPhone device CPU. */
export function seriesFor(platform: string): MetricSeries {
  const p = platform.toLowerCase();
  const android = p === 'android';
  return {
    deviceCpu: android || p === 'ios',
    deviceMem: android,
    appCpu: android,
    appMem: android,
  };
}

export function sessionMetricsBody(
  platform: string,
  rows: SessionMetricRow[],
  recording: RecordingState | null = null,
): SessionMetricsBody {
  const sorted = [...rows].sort((a, b) => a.at - b.at);
  const lastApp = [...sorted].reverse().find((r) => r.app_id);
  return {
    platform: platform.toLowerCase(),
    intervalMs: SAMPLE_INTERVAL_MS,
    appId: lastApp?.app_id ?? null,
    series: seriesFor(platform),
    recording,
    samples: sorted.map((r) => ({
      t: r.at,
      deviceCpu: r.device_cpu_pct,
      deviceMemMb: r.device_mem_mb,
      deviceMemTotalMb: r.device_mem_total,
      appCpu: r.app_cpu_pct,
      appMemMb: r.app_mem_mb,
      app: r.app_id,
    })),
  };
}
