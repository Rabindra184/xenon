export interface MetricPoint {
  t: number;
  deviceCpu: number | null;
  deviceMemMb: number | null;
  deviceMemTotalMb: number | null;
  appCpu: number | null;
  appMemMb: number | null;
}

export interface SessionMetrics {
  platform: string;
  intervalMs: number;
  appId: string | null;
  series: { deviceCpu: boolean; deviceMem: boolean; appCpu: boolean; appMem: boolean };
  /** For a running session: whether it is being sampled. Null once it ended. */
  recording: 'sampling' | 'stopped' | 'off' | null;
  samples: MetricPoint[];
}

/** The metrics endpoint's answer, or null for anything else (an error body, a `[]`). */
export function asSessionMetrics(body: unknown): SessionMetrics | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const b = body as Partial<SessionMetrics>;
  if (!Array.isArray(b.samples) || !b.series || typeof b.series !== 'object') return null;
  return {
    platform: String(b.platform ?? ''),
    intervalMs: Number(b.intervalMs) || 2000,
    appId: typeof b.appId === 'string' ? b.appId : null,
    series: {
      deviceCpu: !!b.series.deviceCpu,
      deviceMem: !!b.series.deviceMem,
      appCpu: !!b.series.appCpu,
      appMem: !!b.series.appMem,
    },
    recording:
      b.recording === 'sampling' || b.recording === 'stopped' || b.recording === 'off'
        ? b.recording
        : null,
    samples: b.samples,
  };
}

export function stats(values: Array<number | null>): { peak: number; average: number } | null {
  let peak = -Infinity;
  let sum = 0;
  let n = 0;
  for (const v of values) {
    if (v === null || !Number.isFinite(v)) continue;
    peak = Math.max(peak, v);
    sum += v;
    n += 1;
  }
  return n === 0 ? null : { peak, average: sum / n };
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

export function formatPct(p: number): string {
  if (p === 0) return '0%';
  return `${p < 10 ? p.toFixed(1) : Math.round(p)}%`;
}

export function formatMb(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}
