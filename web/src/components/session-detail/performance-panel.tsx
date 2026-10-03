import React, { useEffect, useMemo, useState } from 'react';
import { Activity } from 'lucide-react';
import { Card } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';
import XenonApiService from '../../api-service';
import { ChartSeries, LineChart, niceMax } from './line-chart';
import { SessionMetrics, asSessionMetrics, formatMb, formatPct, stats } from './performance';

/** How often a running session's figures are asked for: one write's worth. */
export const METRICS_REFRESH_MS = 10_000;

const DEVICE = 'var(--color-info)';
const APP = 'var(--color-accent)';
const TOTAL = 'var(--border-strong)';

/** The top of a memory axis: a round number of MB below a gigabyte, of GB above. */
export function memoryAxisMax(maxMb: number): number {
  return maxMb >= 1024 ? niceMax(maxMb / 1024) * 1024 : niceMax(maxMb);
}

const peakOf = (series: ChartSeries[]): number => {
  let max = 0;
  for (const s of series) for (const v of s.values) if (v !== null && v > max) max = v;
  return max;
};

interface Props {
  sessionId: string;
  running: boolean;
  hasTrace: boolean;
}

const ChartBlock: React.FC<{
  title: string;
  series: ChartSeries[];
  times: number[];
  yMax?: number;
  format: (v: number) => string;
  ariaLabel: string;
}> = ({ title, series, times, yMax, format, ariaLabel }) => (
  <section aria-label={title}>
    <div className="mb-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
      <h3 className="text-xs font-semibold text-[var(--text)]">{title}</h3>
      {series.map((s) => {
        const st = stats(s.values);
        return (
          <span
            key={s.key}
            className="flex min-w-0 items-center gap-1.5 text-[11px] tabular-nums text-[var(--text-muted)]"
          >
            <span className="inline-block h-0.5 w-3 shrink-0" style={{ background: s.color }} />
            <span className="max-w-[16rem] truncate" title={s.label}>
              {s.label}
            </span>
            {st &&
              (s.dashed ? (
                <span>{format(st.peak)}</span>
              ) : (
                <span>
                  peak {format(st.peak)} · avg {format(st.average)}
                </span>
              ))}
          </span>
        );
      })}
    </div>
    <LineChart
      times={times}
      series={series}
      yMax={yMax}
      formatValue={format}
      ariaLabel={ariaLabel}
    />
  </section>
);

/**
 * CPU and memory over the session (SessionMetricsService). Android: the app
 * under test and the device; an iPhone: device CPU only.
 */
export const PerformancePanel: React.FC<Props> = ({ sessionId, running, hasTrace }) => {
  const [metrics, setMetrics] = useState<SessionMetrics | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () =>
      XenonApiService.getSessionMetrics(sessionId)
        .then((body: unknown) => {
          if (!alive) return;
          setMetrics(asSessionMetrics(body));
          setLoaded(true);
        })
        .catch(() => {
          if (alive) setLoaded(true);
        });
    void load();
    if (!running) {
      return () => {
        alive = false;
      };
    }
    const id = setInterval(() => void load(), METRICS_REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [sessionId, running]);

  const samples = metrics?.samples ?? [];
  const times = useMemo(() => samples.map((s) => s.t - (samples[0]?.t ?? 0)), [samples]);
  // Without appPackage the app is the foreground one, which can change: a
  // line that followed several apps is the foreground app's, each point
  // names its own, and the line breaks where the app changed.
  const apps = new Set(samples.map((s) => s.app).filter((a): a is string => !!a));
  const appLabel =
    apps.size > 1 ? 'Foreground app' : (Array.from(apps)[0] ?? metrics?.appId ?? 'App');
  const appOf = samples.map((s) => s.app ?? null);
  const changed = (i: number) => i > 0 && !!appOf[i] && !!appOf[i - 1] && appOf[i] !== appOf[i - 1];

  const cpu: ChartSeries[] = [];
  // The app's memory has its own chart: beside the device's gigabytes its
  // line would lie flat along the bottom.
  const appMem: ChartSeries[] = [];
  const deviceMem: ChartSeries[] = [];
  if (metrics) {
    if (metrics.series.deviceCpu) {
      cpu.push({
        key: 'deviceCpu',
        label: 'Device',
        color: DEVICE,
        values: samples.map((s) => s.deviceCpu),
      });
    }
    if (metrics.series.appCpu) {
      cpu.push({
        key: 'appCpu',
        label: appLabel,
        color: APP,
        values: samples.map((s, i) => (changed(i) ? null : s.appCpu)),
        pointLabels: appOf,
      });
    }
    if (metrics.series.appMem) {
      appMem.push({
        key: 'appMem',
        label: appLabel,
        color: APP,
        values: samples.map((s, i) => (changed(i) ? null : s.appMemMb)),
        pointLabels: appOf,
      });
    }
    if (metrics.series.deviceMem) {
      deviceMem.push({
        key: 'deviceMem',
        label: 'Device used',
        color: DEVICE,
        values: samples.map((s) => s.deviceMemMb),
      });
      deviceMem.push({
        key: 'deviceTotal',
        label: 'Device total',
        color: TOTAL,
        values: samples.map((s) => s.deviceMemTotalMb),
        dashed: true,
      });
    }
  }

  const notRecorded = running && metrics?.recording === 'off';
  const stopped = metrics?.recording === 'stopped';
  const stoppedNote = 'Recording stopped: the device stopped responding.';

  let body: React.ReactNode;
  if (!loaded) {
    body = <div className="text-xs text-[var(--text-dim)]">Loading performance…</div>;
  } else if (notRecorded) {
    body = (
      <EmptyState
        title="Performance isn't recorded for this session"
        description="CPU and memory are recorded for Android devices and iPhones. This session runs on an iOS simulator or on a machine that needs updating, or recording is turned off."
      />
    );
  } else if (samples.length === 0 && !running) {
    body = (
      <EmptyState
        title="No performance data for this session"
        description="CPU and memory are recorded for Android devices and iPhones. This session ran on an iOS simulator or on a machine that needed updating, before recording was available, or with recording turned off."
      />
    );
  } else if (samples.length < 2) {
    body = (
      <div className="text-xs text-[var(--text-dim)]">
        {stopped
          ? stoppedNote
          : running
            ? 'Collecting… The first figures appear within 10 seconds.'
            : 'Too few figures were recorded to draw a chart.'}
      </div>
    );
  } else {
    body = (
      <div className="space-y-4">
        {stopped && (
          <p className="text-xs text-[var(--color-warning)]">{stoppedNote} The data ends there.</p>
        )}
        {metrics?.platform === 'ios' && (
          <p className="text-xs text-[var(--text-dim)]">
            On iPhones, only the device's overall CPU is recorded.
            {hasTrace ? ' For more detail, download the Performance trace under Details.' : ''}
          </p>
        )}
        {cpu.length > 0 && (
          <ChartBlock
            title="CPU"
            series={cpu}
            times={times}
            yMax={100}
            format={formatPct}
            ariaLabel="CPU over the session"
          />
        )}
        {appMem.length > 0 && (
          <ChartBlock
            title="App memory"
            series={appMem}
            times={times}
            yMax={memoryAxisMax(peakOf(appMem))}
            format={formatMb}
            ariaLabel="App memory over the session"
          />
        )}
        {deviceMem.length > 0 && (
          <ChartBlock
            title="Device memory"
            series={deviceMem}
            times={times}
            yMax={memoryAxisMax(peakOf(deviceMem))}
            format={formatMb}
            ariaLabel="Device memory over the session"
          />
        )}
      </div>
    );
  }

  return (
    <Card
      header={
        <span className="flex items-center gap-2">
          <Activity size={14} /> Performance
        </span>
      }
    >
      {body}
    </Card>
  );
};
